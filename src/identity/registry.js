// src/identity/registry.js
//
// Stable entity ids across regroupings.
//
// Grouping is recomputed from scratch whenever the corpus changes, so the "key" of an entity (which
// surface represents the group) is not stable — a fuller name arriving in turn 40 legitimately
// renames the group. Hosts, decisions and any UI holding a reference need something that does not
// move under them, so each group is matched to the previous build's ids by shared mention weight
// and keeps the heaviest one.
//
// This replaces the old package's `resolveKey`, which asked callers to re-resolve a key that a
// regroup may have renamed and could only follow a rename forward one step. Here a merge records
// the absorbed id as an alias, so a reference of any age resolves in one lookup, and a SPLIT is
// representable too: the heavier fragment keeps the id, the lighter one gets a fresh one.

export const createRegistry = () => ({ byKey: {}, alias: {}, next: 1 })

/**
 * @param {object} registry            mutated in place
 * @param {Map<string, string[]>} groups   root key -> member keys
 * @param {Map<string, number>} weight     key -> mention count, for choosing which id a group keeps
 * @returns {Map<string, string>} root key -> stable entity id
 */
export function assignIds(registry, groups, weight) {
  const priorByKey = registry.byKey
  const scored = []
  for (const [rootKey, keys] of groups) {
    const claims = new Map()   // prior id -> weight this group brings to it
    let total = 0
    for (const k of keys) {
      const w = weight.get(k) ?? 1
      total += w
      const prior = priorByKey[k]
      if (prior) claims.set(prior, (claims.get(prior) ?? 0) + w)
    }
    scored.push({ rootKey, keys, claims, total })
  }
  // Heaviest group picks first, so when two groups both descend from one id, the id follows the
  // bulk of the evidence rather than whichever happened to be visited first.
  scored.sort((a, b) => b.total - a.total)

  const taken = new Set()
  const out = new Map()
  const assigned = []
  for (const g of scored) {
    let best = null, bestW = 0
    for (const [id, w] of g.claims) {
      if (taken.has(id)) continue
      if (w > bestW) { bestW = w; best = id }
    }
    if (!best) { assigned.push(g); continue }
    taken.add(best)
    out.set(g.rootKey, best)
    for (const [id] of g.claims) if (id !== best) registry.alias[id] = best
  }
  // Anything that could not keep a prior id is genuinely new (or is the lighter half of a split).
  for (const g of assigned) {
    const id = `e${registry.next++}`
    out.set(g.rootKey, id)
    for (const [prior] of g.claims) registry.alias[prior] = id
  }

  registry.byKey = {}
  for (const g of scored) {
    const id = out.get(g.rootKey)
    for (const k of g.keys) registry.byKey[k] = id
  }
  // An id that has come back into use is no longer an alias for anything.
  for (const id of out.values()) if (registry.alias[id]) delete registry.alias[id]
  return out
}

/** Follow a reference of any age to the id that currently holds it. */
export function resolveId(registry, id) {
  let cur = id, hops = 0
  while (registry.alias?.[cur] && hops++ < 32) cur = registry.alias[cur]
  return cur
}
