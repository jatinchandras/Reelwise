// Run `npm run demo` to see the whole pipeline on the sample script, no server needed.
import { readFileSync } from "node:fs";
import { breakdownScript } from "./core/breakdown.js";
import { autoCast, uncastRoles } from "./core/casting.js";
import { autoSchedule } from "./core/scheduler.js";
import { buildCallSheet, callSheetToText } from "./core/callsheet.js";

const doc = JSON.parse(readFileSync(new URL("../data/sample.sluglines", import.meta.url), "utf8"));
const actors = [
  { id: "a1", name: "Arjun", roles: ["DEV"] },
  { id: "a2", name: "Priya", roles: ["MEERA"], unavailable: ["2026-12-01"] },
  { id: "a3", name: "Kiran", roles: ["RAO"] },
];
const crew = [{ name: "Sam", department: "Camera", role: "DOP" }];

const b = breakdownScript(doc);
console.log(`${b.title}: ${b.scenes.length} scenes, ${b.characters.length} characters, ${b.locations.length} locations\n`);
const assignments = autoCast(b.characters, actors);
console.log("Uncast roles:", uncastRoles(b, assignments).join(", ") || "none");
const schedule = autoSchedule(b, { assignments, actors });
for (const d of schedule.days) console.log(`${d.date}  ${d.callTime}  ${d.location} (${d.night ? "night" : "day"})  scenes ${d.sceneNumbers.join(",")}`);
console.log("Conflicts:", schedule.conflicts.length ? JSON.stringify(schedule.conflicts) : "none");
console.log("\n" + callSheetToText(buildCallSheet(schedule.days[0], b, { assignments, actors, crew })));
