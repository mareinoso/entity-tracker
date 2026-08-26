// src/identity/group.js
//
// Which surface forms mean the same entity.
//
// The one rule every pass shares: count DISTINCT ROOTS and merge only when there is exactly one. A
// duplicate candidate is a minor annoyance; a wrong merge silently fuses two characters and
// corrupts everything downstream that references them.
//
// This is a PURE FUNCTION of the surfaces currently live in the corpus. That is the structural fix
// for the old package's worst known limit: there, grouping decisions were baked into materialised
// entity records, so removing the one paragraph that ever bridged two identities left them
// permanently fused ("un-merge isn't representable" — text-entity-tracker README §8). Here the
// bridge is an input, not a record: delete the paragraph, its surfaces disappear from this
// function's input, and the group falls apart on the next rebuild with no un-merge machinery at
// all.

import { ITEM_HEAD } from '../lexicon/world.js'
import { normalizeName, isTitleWord } from '../names.js'
import { tokenIsDistinctive, isLocativeDominant } from '../lexis.js'

const isInitial = t => t.length === 1
// A form must be ATTESTED (2+ occurrences) to BLOCK a merge — a one-off typo (a missing space
// fusing two names into a false second root) must not veto a real merge. Applies only to blocking,
// never to absorption, or a full name seen once would never absorb its own short form.
const ROOT_MIN = 2

/**
 * @param {Map<string, {count: number, forms: Map<string, number>}>} entries  live surface keys
 * @param {object} opts
 * @param {string[][]} [opts.aliases]        user-declared equivalences — authoritative
 * @param {object} [opts.lexis]              word history, for the distinctiveness gate
 * @param {object} [opts.usage]              bare-token behaviour, for the locative-dominant gate
 * @param {Set<string>} [opts.descriptorKeys]  keys that are DESCRIPTIONS, never merge targets
 * @param {(key: string) => 'm'|'f'|'n'|null} [opts.genderOf]  which way a key's pronoun evidence
 *   leans, to refuse a merge between two keys the story is gendering differently
 * @returns {{root: Map<string, string>, groups: Map<string, string[]>, links: object[]}}
 */
export function groupSurfaces(entries, {
  aliases = [], lexis = null, usage = null, descriptorKeys = new Set(), genderOf = () => null,
} = {}) {
  const keys = [...entries.keys()]
  const parent = new Map(keys.map(k => [k, k]))
  const find = k => { while (parent.get(k) !== k) k = parent.get(k); return k }
  const links = []
  const union = (a, b, reason) => {
    const ra = find(a), rb = find(b)
    if (ra === rb) return false
    parent.set(ra, rb)
    links.push({ from: a, to: b, reason })
    return true
  }

  const tokenCache = new Map()
  const toks = (k) => {
    let t = tokenCache.get(k)
    if (!t) { t = k.split(' '); tokenCache.set(k, t) }
    return t
  }

  // User aliases are authoritative — applied before any heuristic, and past every gate below.
  for (const group of aliases) {
    const present = group.map(normalizeName).filter(k => entries.has(k))
    for (let i = 1; i < present.length; i++) union(present[i], present[0], 'alias')
  }

  const attested = k => (entries.get(k)?.count ?? 0) >= ROOT_MIN
  const settle = (cands) => {
    const all = new Set(cands.map(find))
    if (all.size <= 1) return all
    const strong = new Set(cands.filter(attested).map(find))
    return strong.size === 1 ? strong : all
  }

  // Two keys the story is gendering differently are not the same person, however their tokens
  // overlap. The old package applied this at mention-write time (refusing to record a mention whose
  // pronoun evidence disagreed with the target); refusing the LINK is the same protection one layer
  // earlier, where it prevents the merge rather than starving it.
  //
  // `genderOf` reports a LEAN, not a settled verdict — see `genderLean` in src/entities.js. A
  // surname established male over three turns absorbing a new "Marisol Halden" whose own
  // introduction says "She smiled" is the documented corruption this exists for, and by the time
  // she has settled a gender of her own she has already inherited his. The costs are asymmetric:
  // a wrong block leaves two entities that a later shared mention can still join, a wrong merge
  // rewrites a character's gender and everything attributed through it.
  const genderClash = (a, b) => {
    const ga = genderOf(a), gb = genderOf(b)
    if (!ga || !gb) return false
    if (ga === 'n' || gb === 'n') return false   // neuter is not the opposite of either
    return ga !== gb
  }

  // A compound ending in an item noun ("Zhukan's Nodachi") must not compete with its owner for the
  // owner's OWN bare-name token. Deliberately NOT a blanket "last token is an item word" rule —
  // ITEM_HEAD also matches real surnames ("Brittany Blade" is a character). The distinguishing
  // signal is an INTERNAL possessive in the raw form: "Zhukan's Nodachi" has one, "Blade's" (her
  // own possessive, trailing) does not.
  const INTERNAL_POSSESSIVE = /['’]s\s+\S/i
  const isPossessedItem = key => {
    const tb = toks(key)
    if (!ITEM_HEAD.test(tb[tb.length - 1])) return false
    for (const raw of entries.get(key)?.forms.keys() ?? []) if (INTERNAL_POSSESSIVE.test(raw)) return true
    return false
  }

  // "X of Y" is excluded as a merge TARGET unconditionally. Confirmed live: a bare token that is
  // individually distinctive ("bladewarden", "duskmere") skips the ordinariness gate entirely and
  // merges straight into "Bladewarden of Duskmere", transitively fusing two unrelated identities
  // through the compound as a shared bridge.
  const isBridge = key => toks(key).includes('of')

  // `analyseName` strips titles by PREFIX only, so "King Garreth" normalises to "garreth" but
  // "Vordun King" keeps the whole compound — leaving it as the only key still holding a bare "king"
  // for every stray "King" mention to fall into. Scoped to the title token itself: "Vordun" merging
  // into "Vordun King" is legitimate shorthand and stays allowed.
  const isStrandedTitle = (token, target) => {
    const tb = toks(target)
    return tb.length === 2 && tb[1] === token && isTitleWord(token)
  }

  const badTarget = (key) => isBridge(key) || isPossessedItem(key) || descriptorKeys.has(key)

  const multi = keys.filter(k => k.includes(' '))
  const byToken = new Map()
  for (const m of multi) {
    for (const t of new Set(toks(m))) {
      const arr = byToken.get(t)
      if (arr) arr.push(m); else byToken.set(t, [m])
    }
  }
  // Forms that could contain EVERY token of `ta`: start from the rarest one, since a form
  // containing all of them necessarily contains that. Exact, not an approximation — and it keeps
  // this linear in distinct forms rather than quadratic.
  const containingAll = (ta) => {
    let best = null
    for (const t of ta) {
      const post = byToken.get(t)
      if (!post) return []
      if (best === null || post.length < best.length) best = post
    }
    return best ?? []
  }

  // 1. Nested forms: "ua" ⊂ "ua high" ⊂ "ua high school" are one entity. Run to a fixpoint,
  //    longest first, so genuine chains collapse before a shorter form looks at them. Ambiguity is
  //    the guard: a short form fitting inside TWO longer names identifies neither, which is what
  //    keeps "Marisol Vantage" from binding to both "Marisol Marie Vantage" and "Marisol Rose
  //    Vantage". Suffixes come free — "John Smith Jr" merges when there is one Smith.
  const byLength = [...multi].sort((a, b) => toks(b).length - toks(a).length)
  for (let changed = true; changed;) {
    changed = false
    for (const a of byLength) {
      const ta = toks(a)
      if (ta.some(t => isLocativeDominant(usage, t))) continue
      if (!ta.every(t => tokenIsDistinctive(lexis, t))) continue
      const roots = settle(containingAll(ta).filter(b => {
        if (b === a) return false
        const tb = toks(b)
        if (!(ta.length < tb.length && ta.every(t => tb.includes(t)))) return false
        return !badTarget(b)
      }))
      if (roots.size === 1) {
        const [only] = roots
        if (find(a) !== only && !genderClash(a, only) && union(a, only, 'nested')) changed = true
      }
    }
  }

  // 2. Initials: "s holmes" -> "sherlock holmes". Ambiguous ones ("s" could be Sherlock or Sarah)
  //    bind to nothing. The match must agree exactly on every NON-initial token.
  for (const a of multi) {
    const ta = toks(a)
    if (!ta.some(isInitial)) continue
    const anchor = ta.find(t => !isInitial(t))
    const pool = anchor ? (byToken.get(anchor) ?? []) : multi
    const roots = new Set(pool.filter(b => {
      if (b === a) return false
      const tb = toks(b)
      if (ta.length !== tb.length) return false
      return ta.every((t, i) => t === tb[i] || (isInitial(t) && tb[i].startsWith(t)))
    }).map(find))
    if (roots.size === 1 && !genderClash(a, [...roots][0])) union(a, [...roots][0], 'initials')
  }

  // 3. Single tokens into the one multi-word form containing them. "bennet" inside both "elizabeth
  //    bennet" and "jane bennet" has two roots, so it stays its own entity.
  for (const key of keys) {
    if (key.includes(' ')) continue
    const posts = (byToken.get(key) ?? []).filter(b =>
      !badTarget(b) && !isStrandedTitle(key, b))
    const eligible = isLocativeDominant(usage, key) ? []
      : tokenIsDistinctive(lexis, key) ? posts
      : []
    const roots = settle(eligible)
    // The clash is checked AFTER the roots are counted, never as part of counting them: a clash
    // means "these two are not the same person", and using it to thin the candidate list would
    // let it manufacture the unambiguous single root that triggers a merge.
    if (roots.size === 1 && !genderClash(key, [...roots][0])) union(key, [...roots][0], 'single-token')
  }

  const root = new Map(keys.map(k => [k, find(k)]))
  const groups = new Map()
  for (const k of keys) {
    const r = root.get(k)
    const arr = groups.get(r)
    if (arr) arr.push(k); else groups.set(r, [k])
  }
  for (const arr of groups.values()) arr.sort()
  return { root, groups, links }
}
