// Zero-dependency HTTP server: REST API + static files (dashboard at /, editor at /editor/).
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { breakdownScript, requirementsByLocation } from "./core/breakdown.js";
import { autoCast, uncastRoles } from "./core/casting.js";
import { autoSchedule, moveScene } from "./core/scheduler.js";
import { buildCallSheet, callSheetToText } from "./core/callsheet.js";
import { notifyDay, fileChannel, consoleChannel, diffSchedules } from "./core/notifications.js";
import { load, save } from "./core/store.js";

const WEB = join(fileURLToPath(new URL(".", import.meta.url)), "..", "web");
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };
const PORT = process.env.PORT || 3000;

const uid = (p) => p + "_" + Math.random().toString(36).slice(2, 8);
const json = (res, code, body) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
const readBody = async (req) => { let s = ""; for await (const c of req) s += c; return s ? JSON.parse(s) : {}; };

function derive(p) {
  const breakdown = breakdownScript(p.doc);
  const ctx = { assignments: p.assignments, actors: p.actors, manual: p.manual, dependencies: p.dependencies, options: p.options };
  const schedule = autoSchedule(breakdown, ctx);
  return { breakdown, schedule, ctx, requirements: requirementsByLocation(breakdown), uncast: uncastRoles(breakdown, p.assignments) };
}

async function api(req, res, url) {
  const p = await load();
  const route = `${req.method} ${url.pathname}`;
  const d = () => derive(p);

  if (route === "GET /api/sample") return json(res, 200, JSON.parse(await readFile(join(WEB, "..", "data", "sample.sluglines"), "utf8")));

  if (route === "GET /api/project") return json(res, 200, { ...p, ...d() });

  if (route === "PUT /api/script") {            // body = a .sluglines document
    const doc = await readBody(req);
    if (!doc || !Array.isArray(doc.lines)) return json(res, 400, { error: "Expected a Sluglines document with a lines array" });
    p.doc = doc; await save(p);
    return json(res, 200, { ...p, ...d() });
  }

  if (route === "POST /api/actors") {
    const a = await readBody(req);
    if (!a.name) return json(res, 400, { error: "name is required" });
    p.actors.push({ id: uid("actor"), name: a.name, email: a.email || "", phone: a.phone || "", roles: a.roles || [], unavailable: a.unavailable || [] });
    await save(p); return json(res, 201, { ...p, ...d() });
  }
  if (route === "POST /api/crew") {
    const c = await readBody(req);
    if (!c.name) return json(res, 400, { error: "name is required" });
    p.crew.push({ id: uid("crew"), name: c.name, email: c.email || "", phone: c.phone || "", department: c.department || "", role: c.role || "" });
    await save(p); return json(res, 201, { ...p, ...d() });
  }

  const del = url.pathname.match(/^\/api\/(actors|crew)\/([\w-]+)$/);
  if (req.method === "DELETE" && del) {
    const [, kind, id] = del;
    p[kind] = p[kind].filter((x) => x.id !== id);
    if (kind === "actors") for (const [ch, aid] of Object.entries(p.assignments)) if (aid === id) delete p.assignments[ch];
    await save(p); return json(res, 200, { ...p, ...d() });
  }

  if (route === "POST /api/casting/auto") {
    const { breakdown } = d();
    p.assignments = autoCast(breakdown.characters, p.actors, p.assignments);
    await save(p); return json(res, 200, { ...p, ...d() });
  }
  if (route === "PUT /api/casting") {           // { character, actorId } (actorId null clears)
    const { character, actorId } = await readBody(req);
    if (!character) return json(res, 400, { error: "character is required" });
    if (actorId) p.assignments[character.toUpperCase()] = actorId; else delete p.assignments[character.toUpperCase()];
    await save(p); return json(res, 200, { ...p, ...d() });
  }

  if (route === "POST /api/schedule/move") {    // manual scheduling: pin a scene to a date
    const { scene, date } = await readBody(req);
    if (!scene || !/^\d{4}-\d{2}-\d{2}$/.test(date || "")) return json(res, 400, { error: "scene and date (YYYY-MM-DD) are required" });
    const before = d().schedule;
    p.manual[scene] = date; await save(p);
    const after = d();
    return json(res, 200, { ...p, ...after, changes: diffSchedules(before, after.schedule) });
  }
  if (route === "POST /api/schedule/unpin") {
    const { scene } = await readBody(req);
    delete p.manual[scene]; await save(p); return json(res, 200, { ...p, ...d() });
  }
  if (route === "PUT /api/schedule/options") {
    p.options = { ...p.options, ...(await readBody(req)) }; await save(p); return json(res, 200, { ...p, ...d() });
  }

  const cs = url.pathname.match(/^\/api\/callsheet\/(\d{4}-\d{2}-\d{2})$/);
  if (req.method === "GET" && cs) {
    const { breakdown, schedule } = d();
    const days = schedule.days.filter((x) => x.date === cs[1]);
    if (!days.length) return json(res, 404, { error: "No shoot scheduled on that date" });
    const sheets = days.map((day) => buildCallSheet(day, breakdown, p));
    if (url.searchParams.get("format") === "text") { res.writeHead(200, { "content-type": "text/plain" }); return res.end(sheets.map(callSheetToText).join("\n")); }
    return json(res, 200, sheets);
  }

  if (route === "POST /api/notify") {           // { date, reason?: "scheduled"|"changed"|"reminder", channel?: "file"|"console" }
    const { date, reason = "scheduled", channel = "file" } = await readBody(req);
    const { breakdown, schedule } = d();
    const days = schedule.days.filter((x) => x.date === date);
    if (!days.length) return json(res, 404, { error: "No shoot scheduled on that date" });
    const ch = channel === "console" ? consoleChannel : fileChannel();
    const out = [];
    for (const day of days) out.push(await notifyDay(day, breakdown, p, [ch], { reason }));
    return json(res, 200, { date, sent: out.reduce((n, o) => n + o.sent, 0) });
  }

  return json(res, 404, { error: "Not found" });
}

async function serveStatic(res, pathname) {
  let rel = pathname === "/" ? "/index.html" : pathname;
  if (rel.endsWith("/")) rel += "index.html";
  const file = normalize(join(WEB, rel));
  if (!file.startsWith(WEB)) { res.writeHead(403); return res.end(); }
  try {
    const data = await readFile(file);
    res.writeHead(200, { "content-type": MIME[extname(file)] || "application/octet-stream" });
    res.end(data);
  } catch { res.writeHead(404); res.end("Not found"); }
}

export const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname.startsWith("/api/")) return await api(req, res, url);
    return await serveStatic(res, url.pathname);
  } catch (err) {
    console.error(err);
    json(res, err instanceof SyntaxError ? 400 : 500, { error: err instanceof SyntaxError ? "Invalid JSON" : "Server error" });
  }
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  server.listen(PORT, () => console.log(`Slate running at http://localhost:${PORT}  (editor: /editor/)`));
}
