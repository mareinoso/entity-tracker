// src/anchors.js
//
// What happens to a description of somebody with no name — "a stern-faced woman", "the matron",
// "Dwarven Blacksmith".
//
// This is the file that replaces the old package's "referents", and it is worth stating plainly why
// they were hard to reason about. A referent there was a full pool entity with `named: false`, so it
// competed for identity with real characters, could be merged by the same grouping rules, had to be
// deliberately excluded from surfacing, and needed its own eviction pass, its own grace-turn window,
// two separate key-shape predicates deciding which referents deserved to survive, and a special
// merge primitive that dropped `surfaces` because the ordinary one re-split the entity on the next
// unrelated regroup. Six mechanisms, all in service of one job.
//
// The job is worth keeping, and it is the reason to have this concept at all:
//
//   A description of an unnamed person must land on SOMEBODY, or it lands on the wrong person.
//
// So a description always gets an anchor and always absorbs what is said about it — that part is
// unconditional here, where the old package's protection depended on a pool entry existing. What is
// conditional is whether the anchor OUTLIVES its paragraph, and that is one rule with one window:
//
//   * CLAIMED — a name arriving later in the same paragraph took it ("a stern-faced woman ... I am
//     Ophira"). Its data becomes that name's, and no anonymous entity is created at all.
//   * RECURRENT — the same description comes back within `windowTurns`, and the description
//     individuates ("Dwarven Blacksmith", "the matron"). It becomes an entity in its own right.
//   * otherwise it dies with its paragraph, taking everything credited to it with it.
//
// Nothing is evicted, because nothing was stored: this is a function of the paragraphs currently
// live, so deleting the paragraphs that made a description recurrent un-promotes it on the next
// rebuild, with no eviction pass to get that wrong.

import { isRoleNoun } from './names.js'

/** How many turns may pass before a returning description reads as a different person. */
export const DEFAULT_WINDOW_TURNS = 3

const at = (paragraphId, key) => `${paragraphId}|${key}`

/**
 * @param {{id: string, turnIndex: number, attribution: object}[]} records  live paragraphs, in order
 * @param {{windowTurns?: number}} [opts]
 * @returns {{
 *   redirect: Map<string, string>,     "paragraphId|key" -> the name that claimed it
 *   promoted: Map<string, string>,     "paragraphId|key" -> the descriptor entity key it belongs to
 *   descriptorKeys: Set<string>,       every descriptor entity key that exists
 *   descriptorInfo: Map<string, {gender: string|null, phrase: string}>,
 *   nameKeys: Set<string>,             every key the story uses as a name somewhere
 * }}
 */
export function resolveAnchors(records, { windowTurns = DEFAULT_WINDOW_TURNS } = {}) {
  const redirect = new Map()
  const occurrences = new Map()   // descriptor key -> [{recordIndex, paragraphId, turnIndex, ...}]

  // A key the story also uses as a NAME is a name, wherever else it may have been described. "the
  // Kraken" and "Kraken" normalise identically, and a description must never shadow the name it
  // shares a key with: that would drop the name's own mentions, since unpromoted description is
  // dropped by design. Names win, once, here — the old package expressed the same rule as a sticky
  // `named` latch on every record and had to defend it at four write sites.
  const nameKeys = new Set()
  for (const rec of records) {
    for (const m of rec.mentions) if (m.form === 'name') nameKeys.add(m.key)
  }

  for (const [ri, rec] of records.entries()) {
    const claims = rec.attribution?.claims
    for (const d of rec.attribution?.descriptors ?? []) {
      if (nameKeys.has(d.key)) continue
      const claimedBy = claims?.get(d.key)
      if (claimedBy) { redirect.set(at(rec.id, d.key), claimedBy); continue }
      const arr = occurrences.get(d.key) ?? []
      arr.push({ ri, paragraphId: rec.id, turnIndex: rec.turnIndex, distinctive: d.distinctive, gender: d.gender })
      occurrences.set(d.key, arr)
    }
  }

  const promoted = new Map()
  const descriptorKeys = new Set()
  const descriptorInfo = new Map()

  for (const [key, occ] of occurrences) {
    // A description only earns an identity if it individuates. "a woman" does not: two unrelated
    // "a woman"s share a normalised phrase exactly, and letting that merge is the concrete bug the
    // old package spent an eviction pass fixing. A modified compound ("Dwarven Blacksmith") or a
    // bare role noun the story keeps returning to ("the matron") does.
    const eligible = occ.some(o => o.distinctive) || isRoleNoun(key)
    if (!eligible) continue

    // Runs of occurrences no more than `windowTurns` apart. A gap wider than that is a different
    // person wearing the same words, so each run is its own entity — which is representable here
    // precisely because entities are derived rather than accumulated.
    let run = [occ[0]]
    let runIndex = 0
    const flush = () => {
      if (run.length >= 2) {
        const entityKey = runIndex === 0 ? key : `${key}~${runIndex + 1}`
        descriptorKeys.add(entityKey)
        descriptorInfo.set(entityKey, {
          gender: run.find(o => o.gender)?.gender ?? null,
          phrase: key,
        })
        for (const o of run) promoted.set(at(o.paragraphId, key), entityKey)
      }
      runIndex++
    }
    for (let i = 1; i < occ.length; i++) {
      if (occ[i].turnIndex - run[run.length - 1].turnIndex <= windowTurns) run.push(occ[i])
      else { flush(); run = [occ[i]] }
    }
    flush()
  }

  return { redirect, promoted, descriptorKeys, descriptorInfo, nameKeys }
}

/**
 * Where does data credited to `key` in this paragraph actually belong?
 *
 * @returns {string|null} the entity key, or null when the anchor died with its paragraph — which is
 *   the whole point: unpromoted description never reaches any entity, so it cannot pollute one.
 */
export function route(anchors, paragraphId, key, isDescriptor) {
  const k = at(paragraphId, key)
  const claimed = anchors.redirect.get(k)
  if (claimed) return claimed
  if (!isDescriptor || anchors.nameKeys.has(key)) return key
  return anchors.promoted.get(k) ?? null
}
