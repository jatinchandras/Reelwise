// Tiny JSON-file persistence. Swap for SQLite/Postgres later; the rest of the app only
// calls load() / save().
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

export const DB_PATH = process.env.SLATE_DB || "data/db.json";

export const emptyProject = () => ({
  doc: { title: "", author: "", lines: [] },
  actors: [],
  crew: [],
  assignments: {},     // CHARACTER -> actorId
  manual: {},          // sceneNumber -> "YYYY-MM-DD" (pinned by the director)
  dependencies: {},    // sceneNumber -> [sceneNumbers that must shoot first]
  options: {},         // scheduler overrides (startDate, maxEighthsPerDay, ...)
});

export async function load(path = DB_PATH) {
  try { return { ...emptyProject(), ...JSON.parse(await readFile(path, "utf8")) }; }
  catch { return emptyProject(); }
}

export async function save(project, path = DB_PATH) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(project, null, 2));
}
