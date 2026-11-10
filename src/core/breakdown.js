// Scene breakdown: pulls out everything the production needs for each scene.
// Props/vehicles/etc. are detected from ALL-CAPS words in action lines
// (standard screenplay convention) and keyword lists, and can be edited by hand.

import { parseScript } from "./parser.js";

const VEHICLE_WORDS = ["CAR", "TRUCK", "BUS", "BIKE", "MOTORCYCLE", "AUTO", "TAXI", "JEEP", "VAN", "TRAIN", "BOAT", "HELICOPTER"];
const SFX_WORDS = ["EXPLOSION", "GUNSHOT", "FIRE", "RAIN", "SMOKE", "FOG", "THUNDER", "CRASH", "BLOOD", "SPARK"];
const ANIMAL_WORDS = ["DOG", "HORSE", "CAT", "BIRD", "COW", "ELEPHANT"];
const CROWD_RE = /\b(crowd|villagers|passers-?by|extras|audience|guests|students|mob)\b/i;
const NIGHT_LIKE = new Set(["NIGHT", "DUSK", "EVENING", "MIDNIGHT", "DAWN", "SUNSET"]);

// ALL-CAPS runs of 3+ letters inside action text
function capsWords(text) {
  return (text.match(/\b[A-Z][A-Z'\-]{2,}(?:\s+[A-Z][A-Z'\-]{2,})*\b/g) || []).map((s) => s.trim());
}

// Rough page-eighths estimate (industry convention: 1 page = 8 eighths, ~55 lines/page)
export function estimateEighths(blocks) {
  const lines = blocks.reduce((n, b) => n + Math.max(1, Math.ceil((b.text || "").length / (b.type === "dialogue" ? 35 : 60))), 0) + 2;
  return Math.max(1, Math.round((lines / 55) * 8));
}

export function breakdownScene(scene, knownCharacters = new Set()) {
  const characters = new Set();
  const props = new Set();
  const vehicles = new Set();
  const sfx = new Set();
  const animals = new Set();
  let hasCrowd = false;

  for (const b of scene.blocks) {
    if (b.type === "character") characters.add(b.name);
    if (b.type === "action" || b.type === "description") {
      if (CROWD_RE.test(b.text)) hasCrowd = true;
      for (const w of capsWords(b.text)) {
        // crowd words are tracked as background artists, not props
        if (CROWD_RE.test(w)) { hasCrowd = true; continue; }
        // "INSPECTOR RAO" -> the known character RAO (titles/descriptors before a name)
        const tokens = w.split(" ");
        const who = tokens.find((t) => knownCharacters.has(t));
        if (who) { characters.add(who); continue; }
        const first = tokens[0];
        if (VEHICLE_WORDS.includes(first)) vehicles.add(w);
        else if (SFX_WORDS.includes(first)) sfx.add(w);
        else if (ANIMAL_WORDS.includes(first)) animals.add(w);
        else props.add(w);
      }
    }
  }
  return {
    number: scene.number,
    heading: scene.heading.raw,
    setting: scene.heading.setting,
    location: scene.heading.location,
    timeOfDay: scene.heading.timeOfDay,
    isNight: NIGHT_LIKE.has(scene.heading.timeOfDay),
    characters: [...characters].sort(),
    props: [...props].sort(),
    vehicles: [...vehicles].sort(),
    sfx: [...sfx].sort(),
    animals: [...animals].sort(),
    hasCrowd,
    eighths: estimateEighths(scene.blocks),
    dialogueLines: scene.blocks.filter((b) => b.type === "dialogue").length,
  };
}

export function breakdownScript(doc) {
  const scenes = parseScript(doc);
  const speakers = new Set();
  scenes.forEach((s) => s.blocks.forEach((b) => b.type === "character" && speakers.add(b.name)));
  const items = scenes.map((s) => breakdownScene(s, speakers));
  return {
    title: doc.title || "Untitled",
    scenes: items,
    characters: [...speakers].sort(),
    locations: [...new Set(items.map((s) => s.location))].sort(),
    totalEighths: items.reduce((n, s) => n + s.eighths, 0),
  };
}

// Production requirements rolled up per location: what to arrange before shooting there.
export function requirementsByLocation(breakdown) {
  const out = {};
  for (const s of breakdown.scenes) {
    const r = (out[s.location] ||= { scenes: [], props: new Set(), vehicles: new Set(), sfx: new Set(), animals: new Set(), needsNightLighting: false, needsCrowd: false });
    r.scenes.push(s.number);
    s.props.forEach((p) => r.props.add(p));
    s.vehicles.forEach((p) => r.vehicles.add(p));
    s.sfx.forEach((p) => r.sfx.add(p));
    s.animals.forEach((p) => r.animals.add(p));
    if (s.isNight) r.needsNightLighting = true;
    if (s.hasCrowd) r.needsCrowd = true;
  }
  return Object.fromEntries(Object.entries(out).map(([loc, r]) => [loc, {
    ...r, props: [...r.props], vehicles: [...r.vehicles], sfx: [...r.sfx], animals: [...r.animals],
  }]));
}
