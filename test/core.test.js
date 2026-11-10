import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseSceneHeading, parseScript, cleanCharacterName } from "../src/core/parser.js";
import { breakdownScript, requirementsByLocation } from "../src/core/breakdown.js";
import { autoCast, uncastRoles } from "../src/core/casting.js";
import { autoSchedule, moveScene } from "../src/core/scheduler.js";
import { buildCallSheet, callSheetToText } from "../src/core/callsheet.js";
import { buildDayMessages, diffSchedules, upcomingDays } from "../src/core/notifications.js";

const doc = JSON.parse(readFileSync(new URL("../data/sample.sluglines", import.meta.url), "utf8"));
const actors = [
  { id: "a1", name: "Arjun", email: "arjun@x.com", roles: ["DEV"] },
  { id: "a2", name: "Priya", email: "priya@x.com", roles: ["MEERA"], unavailable: ["2026-12-01"] },
  { id: "a3", name: "Kiran", phone: "+910000000", roles: ["RAO"] },
];
const crew = [{ id: "c1", name: "Sam", email: "sam@x.com", department: "Camera", role: "DOP" }];

test("scene headings parse setting, location, time", () => {
  assert.deepEqual(parseSceneHeading("INT. OLD CINEMA - NIGHT"), { raw: "INT. OLD CINEMA - NIGHT", setting: "INT", location: "OLD CINEMA", timeOfDay: "NIGHT" });
  assert.equal(parseSceneHeading("EXT. RIVER BANK - DAY").setting, "EXT");
  assert.equal(parseSceneHeading("INT/EXT. CAR - DUSK").setting, "INT/EXT");
  assert.equal(parseSceneHeading("INT. KITCHEN").timeOfDay, "DAY");
});

test("character extensions are stripped", () => {
  assert.equal(cleanCharacterName("MEERA (O.S.)"), "MEERA");
});

test("script splits into scenes", () => {
  const scenes = parseScript(doc);
  assert.equal(scenes.length, 5);
  assert.equal(scenes[0].blocks.filter((b) => b.type === "dialogue")[1].speaker, "MEERA");
});

test("breakdown finds characters, props, vehicles, sfx, animals, crowd", () => {
  const b = breakdownScript(doc);
  assert.deepEqual(b.characters, ["DEV", "MEERA", "RAO"]);
  assert.equal(b.scenes.length, 5);
  const s1 = b.scenes[0];
  assert.deepEqual(s1.characters, ["DEV", "MEERA"]);
  assert.ok(s1.props.includes("PROJECTOR"));
  assert.ok(s1.hasCrowd);
  const s2 = b.scenes[1];
  assert.ok(s2.vehicles.includes("JEEP"));
  assert.ok(s2.animals.includes("DOG"));
  assert.ok(b.scenes[2].isNight);
  assert.ok(b.scenes[2].sfx.includes("FOG"));
  assert.ok(b.scenes[3].sfx.includes("RAIN"));
  // character names appearing in action must not become props
  assert.ok(!b.scenes[0].props.includes("DEV"));
  // crowd words are background artists, not props
  assert.ok(!b.scenes[0].props.includes("VILLAGERS"));
  assert.ok(!b.scenes[4].props.includes("CROWD"));
  // "INSPECTOR RAO" in action is the character RAO, not a prop
  assert.ok(!b.scenes[3].props.includes("INSPECTOR RAO"));
  assert.ok(b.scenes[3].props.includes("LANTERN"));
});

test("location requirements roll up", () => {
  const r = requirementsByLocation(breakdownScript(doc));
  assert.deepEqual(r["OLD CINEMA"].scenes, [1, 3, 5]);
  assert.ok(r["OLD CINEMA"].needsNightLighting);
  assert.ok(r["OLD CINEMA"].needsCrowd);
});

test("auto-cast honours listed roles and reports uncast", () => {
  const b = breakdownScript(doc);
  const a = autoCast(b.characters, actors);
  assert.deepEqual(a, { DEV: "a1", MEERA: "a2", RAO: "a3" });
  assert.deepEqual(uncastRoles(b, {}), ["DEV", "MEERA", "RAO"]);
  assert.deepEqual(autoCast(b.characters, actors, { DEV: "a3" }).DEV, "a3");
});

test("scheduler schedules every scene exactly once, one location per date", () => {
  const b = breakdownScript(doc);
  const assignments = autoCast(b.characters, actors);
  const s = autoSchedule(b, { assignments, actors });
  const all = s.days.flatMap((d) => d.sceneNumbers).sort();
  assert.deepEqual(all, [1, 2, 3, 4, 5]);
  assert.equal(s.unscheduled.length, 0);
  for (const date of new Set(s.days.map((d) => d.date))) {
    assert.equal(new Set(s.days.filter((d) => d.date === date).map((d) => d.location)).size, 1);
  }
});

test("scheduler never books an actor on an unavailable date", () => {
  const b = breakdownScript(doc);
  const assignments = autoCast(b.characters, actors);
  const s = autoSchedule(b, { assignments, actors, options: { startDate: "2026-12-01" } });
  assert.equal(s.conflicts.filter((c) => c.type === "actor-unavailable").length, 0);
  const day1 = s.days.find((d) => d.sceneNumbers.some((n) => b.scenes[n - 1].characters.includes("MEERA")));
  assert.notEqual(day1.date, "2026-12-01");
});

test("scheduler skips non-shoot weekdays and blackout dates", () => {
  const b = breakdownScript(doc);
  // 2026-12-06 is a Sunday
  const s = autoSchedule(b, { options: { startDate: "2026-12-06", blackoutDates: ["2026-12-07"] } });
  for (const d of s.days) {
    assert.notEqual(new Date(d.date + "T00:00:00Z").getUTCDay(), 0);
    assert.notEqual(d.date, "2026-12-07");
  }
});

test("manual pin is respected and conflicts are flagged", () => {
  const b = breakdownScript(doc);
  const assignments = autoCast(b.characters, actors);
  const { schedule } = moveScene(b, { assignments, actors }, 2, "2026-12-01");
  const day = schedule.days.find((d) => d.sceneNumbers.includes(2));
  assert.equal(day.date, "2026-12-01");
  assert.ok(schedule.conflicts.some((c) => c.type === "actor-unavailable" && c.scene === 2 && c.date === "2026-12-01"));
});

test("dependencies keep scene order", () => {
  const b = breakdownScript(doc);
  const s = autoSchedule(b, { dependencies: { 4: [5] } });
  const date = (n) => s.days.find((d) => d.sceneNumbers.includes(n)).date;
  assert.ok(date(5) <= date(4));
});

test("call sheet and notifications", () => {
  const b = breakdownScript(doc);
  const assignments = autoCast(b.characters, actors);
  const s = autoSchedule(b, { assignments, actors });
  const day = s.days[0];
  const sheet = buildCallSheet(day, b, { assignments, actors, crew });
  assert.equal(sheet.location, day.location);
  assert.ok(callSheetToText(sheet).includes("CALL SHEET"));
  const msgs = buildDayMessages(day, b, { assignments, actors, crew });
  assert.ok(msgs.some((m) => m.person === "Sam" && m.kind === "crew"));
  assert.ok(msgs.every((m) => m.subject.includes(day.date)));
  const changed = buildDayMessages(day, b, { assignments, actors, crew }, { reason: "changed" });
  assert.ok(changed[0].subject.startsWith("CHANGE:"));
  assert.equal(upcomingDays(s, day.date, 0).length >= 1, true);
});

test("diffSchedules reports moved scenes", () => {
  const b = breakdownScript(doc);
  const before = autoSchedule(b, {});
  const after = moveScene(b, {}, 4, "2027-01-15").schedule;
  const diff = diffSchedules(before, after);
  assert.ok(diff.some((d) => d.scene === 4 && d.to === "2027-01-15"));
});

test("pinning a scene on a non-shoot weekday is flagged", () => {
  const b = breakdownScript(doc);
  // 2026-12-20 is a Sunday
  const { schedule } = moveScene(b, {}, 4, "2026-12-20");
  assert.ok(schedule.conflicts.some((c) => c.type === "non-shoot-day" && c.scene === 4));
});
