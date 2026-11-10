// Call sheet: the one-page document every crew member on a film knows.
import { requirementsByLocation } from "./breakdown.js";
import { castForScene } from "./casting.js";

export function buildCallSheet(day, breakdown, { assignments, actors, crew = [], projectTitle = breakdown.title }) {
  const byNum = new Map(breakdown.scenes.map((s) => [s.number, s]));
  const scenes = day.sceneNumbers.map((n) => byNum.get(n));
  const reqs = requirementsByLocation({ scenes })[day.location] || {};
  const cast = new Map();
  for (const s of scenes) for (const { character, actor } of castForScene(s, assignments, actors)) {
    const key = character;
    if (!cast.has(key)) cast.set(key, { character, actor: actor ? actor.name : "UNCAST", scenes: [] });
    cast.get(key).scenes.push(s.number);
  }
  return {
    project: projectTitle,
    date: day.date,
    callTime: day.callTime,
    location: day.location,
    shootType: day.night ? "NIGHT" : "DAY",
    scenes: scenes.map((s) => ({ number: s.number, heading: s.heading, eighths: s.eighths })),
    cast: [...cast.values()],
    crew: crew.map((c) => ({ name: c.name, department: c.department || "", role: c.role || "" })),
    requirements: {
      props: reqs.props || [], vehicles: reqs.vehicles || [], sfx: reqs.sfx || [], animals: reqs.animals || [],
      needsNightLighting: !!reqs.needsNightLighting, needsCrowd: !!reqs.needsCrowd,
    },
    totalEighths: day.eighths,
  };
}

export function callSheetToText(cs) {
  const L = [];
  L.push(`${cs.project.toUpperCase()} - CALL SHEET`);
  L.push(`${cs.date}   Call: ${cs.callTime}   ${cs.shootType} shoot`);
  L.push(`Location: ${cs.location}`, "");
  L.push("SCENES");
  cs.scenes.forEach((s) => L.push(`  ${s.number}. ${s.heading}  (${s.eighths}/8 pg)`));
  L.push("", "CAST");
  cs.cast.forEach((c) => L.push(`  ${c.character.padEnd(18)} ${c.actor}  [sc ${c.scenes.join(", ")}]`));
  const r = cs.requirements;
  const need = [["Props", r.props], ["Vehicles", r.vehicles], ["SFX", r.sfx], ["Animals", r.animals]].filter(([, v]) => v.length);
  if (need.length || r.needsNightLighting || r.needsCrowd) {
    L.push("", "REQUIREMENTS");
    need.forEach(([k, v]) => L.push(`  ${k}: ${v.join(", ")}`));
    if (r.needsNightLighting) L.push("  Night lighting package");
    if (r.needsCrowd) L.push("  Background / crowd artists");
  }
  if (cs.crew.length) { L.push("", "CREW"); cs.crew.forEach((c) => L.push(`  ${c.name}${c.role ? " - " + c.role : ""}${c.department ? " (" + c.department + ")" : ""}`)); }
  return L.join("\n") + "\n";
}
