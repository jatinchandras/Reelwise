// Notifications: build per-person messages for upcoming shoot days and send them
// through pluggable channels. Real email/SMS providers plug in by implementing
// { name, send({ to, subject, body }) }. Default channel writes to data/outbox/.

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { actorIdsForScene } from "./casting.js";

export const consoleChannel = {
  name: "console",
  async send(msg) { console.log(`\n--- to ${msg.to} ---\n${msg.subject}\n${msg.body}`); return { ok: true }; },
};

export function fileChannel(dir = "data/outbox") {
  return {
    name: "file",
    async send(msg) {
      await mkdir(dir, { recursive: true });
      const safe = msg.to.replace(/[^\w.@-]+/g, "_");
      await writeFile(join(dir, `${Date.now()}_${safe}.txt`), `To: ${msg.to}\nSubject: ${msg.subject}\n\n${msg.body}\n`);
      return { ok: true };
    },
  };
}

// Example of a real provider: POSTs JSON to any webhook (Slack, Zapier, your SMS gateway...)
export function webhookChannel(url) {
  return {
    name: "webhook",
    async send(msg) {
      const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(msg) });
      return { ok: res.ok, status: res.status };
    },
  };
}

// Who is needed on a shoot day: cast from scenes + the whole crew (or crew filtered by department).
export function peopleForDay(day, breakdown, { assignments, actors, crew }) {
  const byNum = new Map(breakdown.scenes.map((s) => [s.number, s]));
  const actorIds = new Set();
  for (const n of day.sceneNumbers) actorIdsForScene(byNum.get(n), assignments).forEach((id) => actorIds.add(id));
  const cast = actors.filter((a) => actorIds.has(a.id)).map((a) => ({ ...a, kind: "cast" }));
  const team = crew.map((c) => ({ ...c, kind: "crew" }));
  return [...cast, ...team];
}

export function buildDayMessages(day, breakdown, ctx, { projectTitle = breakdown.title, reason = "scheduled" } = {}) {
  const byNum = new Map(breakdown.scenes.map((s) => [s.number, s]));
  const scenesText = day.sceneNumbers.map((n) => `  Scene ${n}: ${byNum.get(n).heading}`).join("\n");
  const prefix = reason === "changed" ? "CHANGE: " : reason === "reminder" ? "Reminder: " : "";
  return peopleForDay(day, breakdown, ctx).map((p) => ({
    to: p.email || p.phone,
    person: p.name,
    kind: p.kind,
    subject: `${prefix}${projectTitle} shoot on ${day.date} - call ${day.callTime}`,
    body:
      `Hi ${p.name},\n\n` +
      `${reason === "changed" ? "The schedule has changed. " : ""}You are called for ${projectTitle} on ${day.date}.\n` +
      `Location: ${day.location} (${day.night ? "night" : "day"} shoot)\n` +
      `Call time: ${day.callTime}\n` +
      `Scenes:\n${scenesText}\n\nPlease confirm you have seen this.\n`,
  })).filter((m) => m.to);
}

export async function notifyDay(day, breakdown, ctx, channels = [consoleChannel], opts = {}) {
  const messages = buildDayMessages(day, breakdown, ctx, opts);
  const results = [];
  for (const m of messages) for (const ch of channels) results.push({ to: m.to, channel: ch.name, ...(await ch.send(m)) });
  return { sent: messages.length, results };
}

// Days starting within `withinDays` of `today` (default: tomorrow)
export function upcomingDays(schedule, today, withinDays = 1) {
  const t = new Date(today + "T00:00:00Z").getTime();
  return schedule.days.filter((d) => {
    const diff = (new Date(d.date + "T00:00:00Z").getTime() - t) / 86400000;
    return diff >= 0 && diff <= withinDays;
  });
}

// When a day moves or changes, tell only the people affected by the difference.
export function diffSchedules(before, after) {
  const key = (s) => Object.fromEntries(s.days.flatMap((d) => d.sceneNumbers.map((n) => [n, d.date])));
  const a = key(before), b = key(after);
  return Object.keys(b).filter((n) => a[n] !== b[n]).map((n) => ({ scene: Number(n), from: a[n] || null, to: b[n] }));
}
