// Scheduler: groups scenes into shoot days under real-world constraints.
//
// Constraints handled:
//  - location grouping (shoot everything at a location together)
//  - day/night separation within a shoot day
//  - max page-eighths per day
//  - actor unavailability dates
//  - locked scenes (manual overrides stay exactly where the director put them)
//  - optional "scene must come after" dependencies
//
// Output: { days: [{ date, location, sceneNumbers, eighths, callTime }], unscheduled: [...], conflicts: [...] }

import { actorIdsForScene } from "./casting.js";

const DEFAULTS = {
  startDate: "2026-12-01",
  maxEighthsPerDay: 32,        // ~4 script pages a day
  shootWeekdays: [1, 2, 3, 4, 5, 6], // Mon-Sat (0 = Sunday)
  dayCallTime: "07:00",
  nightCallTime: "17:00",
  blackoutDates: [],
};

const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (isoDate, n) => { const d = new Date(isoDate + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
const weekday = (isoDate) => new Date(isoDate + "T00:00:00Z").getUTCDay();

function isShootable(date, opts) {
  return opts.shootWeekdays.includes(weekday(date)) && !opts.blackoutDates.includes(date);
}

function nextShootDate(date, opts) {
  let d = date;
  while (!isShootable(d, opts)) d = addDays(d, 1);
  return d;
}

// manual: { [sceneNumber]: "YYYY-MM-DD" } - these scenes are pinned to that date
export function autoSchedule(breakdown, { assignments = {}, actors = [], manual = {}, dependencies = {}, options = {} } = {}) {
  const opts = { ...DEFAULTS, ...options };
  const actorById = new Map(actors.map((a) => [a.id, a]));
  const sceneByNum = new Map(breakdown.scenes.map((s) => [s.number, s]));
  const unavailableOn = (scene, date) =>
    actorIdsForScene(scene, assignments).filter((id) => (actorById.get(id)?.unavailable || []).includes(date));

  const days = []; // { date, location, night, sceneNumbers, eighths }
  const conflicts = [];
  const placed = new Set();

  const dayAt = (date, location, night) => days.find((d) => d.date === date && d.location === location && d.night === night);
  const eighthsOn = (date) => days.filter((d) => d.date === date).reduce((n, d) => n + d.eighths, 0);

  // 1) pinned scenes first
  for (const [numStr, date] of Object.entries(manual)) {
    const scene = sceneByNum.get(Number(numStr));
    if (!scene) continue;
    let day = dayAt(date, scene.location, scene.isNight);
    if (!day) { day = { date, location: scene.location, night: scene.isNight, sceneNumbers: [], eighths: 0, locked: true }; days.push(day); }
    day.sceneNumbers.push(scene.number);
    day.eighths += scene.eighths;
    placed.add(scene.number);
    if (!isShootable(date, opts)) conflicts.push({ type: "non-shoot-day", scene: scene.number, date, manual: true });
    for (const id of unavailableOn(scene, date)) {
      conflicts.push({ type: "actor-unavailable", scene: scene.number, date, actorId: id, actorName: actorById.get(id)?.name, manual: true });
    }
  }

  // 2) group remaining scenes by location (and day/night), biggest groups first
  const remaining = breakdown.scenes.filter((s) => !placed.has(s.number));
  const groups = new Map();
  for (const s of remaining) {
    const key = s.location + "|" + (s.isNight ? "N" : "D");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(s);
  }
  const ordered = [...groups.values()].sort((a, b) => b.reduce((n, s) => n + s.eighths, 0) - a.reduce((n, s) => n + s.eighths, 0));

  const unscheduled = [];
  let cursor = nextShootDate(opts.startDate, opts);

  for (const group of ordered) {
    group.sort((a, b) => a.number - b.number);
    for (const scene of group) {
      // find the earliest workable date >= cursor for this scene
      let date = cursor;
      let guard = 0;
      let placedHere = false;
      while (guard++ < 400) {
        date = nextShootDate(date, opts);
        const depDates = (dependencies[scene.number] || []).map((n) => days.find((d) => d.sceneNumbers.includes(n))?.date).filter(Boolean);
        const depOk = depDates.every((dd) => dd <= date);
        const blocked = unavailableOn(scene, date).length > 0;
        const existingDay = dayAt(date, scene.location, scene.isNight);
        const roomToday = eighthsOn(date) + scene.eighths <= opts.maxEighthsPerDay || (!existingDay && eighthsOn(date) === 0);
        const sameLocationOk = !days.some((d) => d.date === date && d.location !== scene.location);
        if (depOk && !blocked && roomToday && sameLocationOk) {
          let day = existingDay;
          if (!day) { day = { date, location: scene.location, night: scene.isNight, sceneNumbers: [], eighths: 0 }; days.push(day); }
          day.sceneNumbers.push(scene.number);
          day.eighths += scene.eighths;
          placed.add(scene.number);
          placedHere = true;
          break;
        }
        date = addDays(date, 1);
      }
      if (!placedHere) unscheduled.push(scene.number);
    }
    // next location group starts on a fresh day
    const last = days.length ? days[days.length - 1].date : cursor;
    cursor = nextShootDate(addDays(last, 1), opts);
  }

  days.sort((a, b) => a.date.localeCompare(b.date) || Number(a.night) - Number(b.night));
  for (const d of days) {
    d.sceneNumbers.sort((a, b) => a - b);
    d.callTime = d.night ? opts.nightCallTime : opts.dayCallTime;
  }
  return { days, unscheduled, conflicts: [...conflicts, ...findConflicts(days, sceneByNum, assignments, actorById)], options: opts };
}

// Works on any schedule (auto or hand-edited): finds actor conflicts and over-full days.
export function findConflicts(days, sceneByNum, assignments, actorById, maxEighths = DEFAULTS.maxEighthsPerDay) {
  const out = [];
  const perDate = new Map();
  for (const d of days) {
    if (!perDate.has(d.date)) perDate.set(d.date, []);
    perDate.get(d.date).push(d);
    for (const n of d.sceneNumbers) {
      const scene = sceneByNum.get(n);
      if (!scene) continue;
      for (const id of actorIdsForScene(scene, assignments)) {
        if ((actorById.get(id)?.unavailable || []).includes(d.date)) {
          out.push({ type: "actor-unavailable", scene: n, date: d.date, actorId: id, actorName: actorById.get(id)?.name });
        }
      }
    }
  }
  for (const [date, list] of perDate) {
    const total = list.reduce((n, d) => n + d.eighths, 0);
    if (total > maxEighths) out.push({ type: "overfull-day", date, eighths: total, max: maxEighths });
    const locs = new Set(list.map((d) => d.location));
    if (locs.size > 1) out.push({ type: "company-move", date, locations: [...locs] });
  }
  // de-duplicate identical records
  const seen = new Set();
  return out.filter((c) => { const k = JSON.stringify(c); if (seen.has(k)) return false; seen.add(k); return true; });
}

// Manual scheduling: move a scene to a date, returns a recalculated schedule.
export function moveScene(breakdown, ctx, sceneNumber, date) {
  const manual = { ...(ctx.manual || {}), [sceneNumber]: date };
  return { manual, schedule: autoSchedule(breakdown, { ...ctx, manual }) };
}
