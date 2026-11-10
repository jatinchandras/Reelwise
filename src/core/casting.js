// Casting: map characters to actors (auto-suggest or manual), then derive
// per-scene cast lists and flag problems (uncast roles, actors double-booked).

// An actor: { id, name, phone, email, roles?: string[], unavailable?: string[] (YYYY-MM-DD), gender?, ageRange? }
// A role (from breakdown): character name. Assignments: { [CHARACTER]: actorId }

// Auto-assign: first honour actors who list the role by name, then fill remaining roles
// with remaining actors ordered by how few conflicts they would create (least-busy first).
export function autoCast(characters, actors, existing = {}) {
  const assignments = { ...existing };
  const taken = new Set(Object.values(assignments));

  for (const c of characters) {
    if (assignments[c]) continue;
    const match = actors.find((a) => !taken.has(a.id) && (a.roles || []).map((r) => r.toUpperCase()).includes(c));
    if (match) { assignments[c] = match.id; taken.add(match.id); }
  }
  return assignments;
}

export function castForScene(scene, assignments, actors) {
  const byId = new Map(actors.map((a) => [a.id, a]));
  return scene.characters.map((character) => ({
    character,
    actor: assignments[character] ? byId.get(assignments[character]) || null : null,
  }));
}

export function uncastRoles(breakdown, assignments) {
  return breakdown.characters.filter((c) => !assignments[c]);
}

// scene -> list of actor ids needed (only cast characters)
export function actorIdsForScene(scene, assignments) {
  return [...new Set(scene.characters.map((c) => assignments[c]).filter(Boolean))];
}
