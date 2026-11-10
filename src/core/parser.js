// Turns a Sluglines document ({ lines: [{type, text}] }) into structured scenes.
// A scene starts at each "scene-heading" line and runs until the next one.

const HEADING_RE = /^\s*(INT\.\/EXT\.|INT\/EXT\.?|I\/E\.?|INT\.?|EXT\.?)\s+(.+?)(?:\s+[-—–]\s+([A-Z][A-Z .\/]*))?\s*$/i;

export function parseSceneHeading(text) {
  const raw = (text || "").trim();
  const m = raw.match(HEADING_RE);
  if (!m) return { raw, setting: "UNKNOWN", location: raw.toUpperCase(), timeOfDay: "DAY" };
  const prefix = m[1].toUpperCase().replace(/\./g, "");
  const setting = prefix.startsWith("I") && prefix.includes("E") ? "INT/EXT" : prefix.startsWith("INT") ? "INT" : "EXT";
  return {
    raw,
    setting,
    location: m[2].trim().toUpperCase(),
    timeOfDay: (m[3] || "DAY").trim().toUpperCase(),
  };
}

// "JOHN (V.O.)" / "JOHN (CONT'D)" -> "JOHN"
export function cleanCharacterName(text) {
  return (text || "").replace(/\(.*?\)/g, "").replace(/\^$/, "").trim().toUpperCase();
}

export function parseScript(doc) {
  const lines = (doc && doc.lines) || [];
  const scenes = [];
  let current = null;
  let lastSpeaker = null;

  for (const line of lines) {
    const text = (line.text || "").trim();
    if (line.type === "scene-heading") {
      if (!text) continue;
      current = {
        number: scenes.length + 1,
        heading: parseSceneHeading(text),
        blocks: [],
      };
      scenes.push(current);
      lastSpeaker = null;
      continue;
    }
    if (!current || !text) continue;
    if (line.type === "character") {
      lastSpeaker = cleanCharacterName(text);
      current.blocks.push({ type: "character", text, name: lastSpeaker });
    } else if (line.type === "dialogue") {
      current.blocks.push({ type: "dialogue", text, speaker: lastSpeaker });
    } else {
      current.blocks.push({ type: line.type, text });
    }
  }
  return scenes;
}
