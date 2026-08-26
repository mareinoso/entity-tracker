// src/lexis.js
//
// What the story so far has taught us about WORDS — casing history, which spans/heads/tails have
// been attested where their capital has no positional excuse, and how a bare token behaves when it
// stands alone. Flat lookups keyed by word, so cost is independent of how many entities exist.
//
// Two structures, two inputs, one direction each:
//
//   lexis  <- readings          (text only)      read by admission
//   usage  <- admitted mentions (facts)          read by identity
//
// Keeping them apart is what removes the old package's cycle, where the bare-token signal had to be
// folded in halfway through `putParagraph` because it needed extraction's output while extraction
// needed the evidence store. Nothing here reads anything above it.
//
// Both are built by repeatedly applying the same `add*` primitive, so "rebuild from these
// paragraphs" and "append this paragraph" are the same code, not two implementations that can
// disagree.

import { normalizeName } from './names.js'

export const createLexis = () => ({
  // "kade rourke" -> times seen as a whole span mid-sentence. Strong evidence the span is a name.
  span: {},
  // "kade" -> how often it BEGAN a span mid-sentence versus at a sentence start. A ratio, because a
  // single mid-sentence "Help" anywhere in a long story would otherwise protect it forever.
  headMid: {}, headStart: {},
  // "rourke" -> times seen ENDING a span mid-sentence. No ratio needed: a span's last word has no
  // sentence-start explanation to rule out in the first place.
  tail: {},
  // "before" -> {cap, low}. Only words seen capitalised at least once are kept — the set is only
  // ever queried with candidate surfaces. That restriction has a second effect worth stating
  // because it was luck rather than design in the original: everything before a word's FIRST
  // capital is invisible, so "silver" the metal appearing fifty times in early chapters cannot
  // drown Long John Silver when he arrives.
  case: {},
  // Every word ever seen lowercase, counted. The map above deliberately keeps only words that
  // have been capitalised at least once — it is queried with candidate surfaces, so the rest
  // would be weight. This one answers a different question ("is this word ordinary vocabulary in
  // its own right"), needs exactly the words the other one throws away, and costs nothing to
  // keep because the lexis is derived and never serialised: a snapshot stores the corpus.
  low: {},
})

const bump = (obj, key, n = 1) => { obj[key] = (obj[key] ?? 0) + n }

/** Fold one paragraph's Reading into the lexis. The only mutation primitive. */
export function addReading(lexis, reading) {
  const st = reading.spanStats
  for (const [k, n] of Object.entries(st.span)) bump(lexis.span, k, n)
  for (const [k, n] of Object.entries(st.headMid)) bump(lexis.headMid, k, n)
  for (const [k, n] of Object.entries(st.headStart)) bump(lexis.headStart, k, n)
  for (const [k, n] of Object.entries(st.tail)) bump(lexis.tail, k, n)
  // Capitals first, then lowercase — so a word capitalised for the FIRST time in this paragraph
  // still counts its own lowercase occurrences here, and everything before its first capital stays
  // invisible. This ordering is the rule, not an accident of loop order.
  for (const [w, n] of Object.entries(reading.words.cap)) {
    const c = (lexis.case[w] ??= { cap: 0, low: 0 })
    c.cap += n
  }
  for (const [w, n] of Object.entries(reading.words.low)) {
    bump(lexis.low, w, n)
    const c = lexis.case[w]
    if (c) c.low += n
  }
  return lexis
}

/** Fold a whole ordered corpus. `buildLexis(rs)` === `rs.reduce(addReading, createLexis())`. */
export function buildLexis(readings) {
  const lexis = createLexis()
  for (const r of readings) addReading(lexis, r)
  return lexis
}

// ── queries ──────────────────────────────────────────────────────────────────

export const isStrongSpan = (lexis, surface) => Boolean(lexis?.span?.[String(surface).toLowerCase()])
export const isStrongTail = (lexis, word) => Boolean(lexis?.tail?.[String(word).toLowerCase()])

/** Below this share of unexplained openings, a capital is positional rather than nominal. */
export const HEAD_STRONG = 0.2

/**
 * Does this word behave like part of a name when it OPENS a span, or only like a sentence opener?
 * `Help` opens sentences constantly and spans almost never; `Li` and `Mia` do both.
 */
export function isStrongHead(lexis, word) {
  const w = String(word).toLowerCase()
  const mid = lexis?.headMid?.[w] ?? 0
  const start = lexis?.headStart?.[w] ?? 0
  const total = mid + start
  return total > 0 && mid / total >= HEAD_STRONG
}

/**
 * Share of this word's appearances that are lowercase; 0 when never seen lowercase.
 *
 * A ratio, not "was it ever lowercase". The binary form is fragile in the way that matters for an
 * authoring tool: one accidental lowercase typing of a name would blacklist it permanently, since
 * the history never forgets. Measured, the two populations barely overlap — real names top out at
 * 0.125 (`Silver`, the metal) against a junk median of 0.867 — so a typo among fifty mentions
 * scores 0.02 and changes nothing.
 */
export function lowercaseShare(lexis, word) {
  const w = String(word).replace(/['’]s?$/, '').toLowerCase()
  const c = lexis?.case?.[w]
  if (!c || !(c.cap + c.low)) return 0
  return c.low / (c.cap + c.low)
}

/** Has the story ever written this word in lowercase — anywhere, in any form? */
export const seenLowercase = (lexis, word) => (lexis?.low?.[String(word).toLowerCase()] ?? 0) > 0

/** Above this share, the word behaves like ordinary vocabulary rather than a name. */
export const LOWERCASE_REJECT = 0.5

/**
 * Enough capitalised mentions to be a name regardless of the ratio.
 *
 * Lifetime scoping protects a name from its common-noun history, but not from its future: Silver
 * arriving first and then eight turns of "silver" the metal pushes the share to 0.923, which would
 * reject him. Capital COUNT is the missing half — junk words sit at 2-5 capitals against 60+
 * lowercase, while real names in the same corpora start at 7 and run to 119.
 */
export const CAP_ESTABLISHED = 6

/** Does this word behave like ordinary vocabulary rather than a name? */
export function isOrdinaryWord(lexis, word, threshold = LOWERCASE_REJECT) {
  const w = String(word).replace(/['’]s?$/, '').toLowerCase()
  const c = lexis?.case?.[w]
  if (!c) return false
  if (c.cap >= CAP_ESTABLISHED) return false
  return lowercaseShare(lexis, word) >= threshold
}

/**
 * Is this token distinctive enough for a shared occurrence of it to justify merging two entities?
 *
 * Deliberately NOT `isOrdinaryWord`: that function's CAP_ESTABLISHED floor ("6+ capitalised
 * appearances means treat as a name regardless of ratio") answers a different question and is wrong
 * here — "demon"/"prince" hit 20-30 capitals purely from being *part of* the "Demon Prince" phrase,
 * not from standing alone. Raw share instead, with "never capitalised alone" also counting as
 * ordinary: a token that has only ever appeared inside a compound has no standalone evidence either
 * way, and treating that as neutral let "craftsman" merge unchecked.
 */
export function tokenIsDistinctive(lexis, token) {
  if (!lexis) return true
  const c = lexis.case?.[String(token).toLowerCase()]
  if (!c) return false
  return lowercaseShare(lexis, token) < LOWERCASE_REJECT
}

// ── usage: how a BARE token behaves once it is a mention ──────────────────────

export const createUsage = () => ({
  // "wrenmoor" -> {total, locative, speech, possessive}
  bare: {},
})

const blank = () => ({ total: 0, locative: 0, speech: 0, possessive: 0 })

/**
 * Fold one admitted mention into the usage signal. Single-token surfaces only — a mention of
 * "Wrenmoor" inside "Garreth Wrenmoor" says nothing about the bare word's own behaviour.
 *
 * Reads the mention's own facts, never the text: `locative`/`nearSpeech`/`possessive` are computed
 * once in `src/admit.js`, so the windows they use cannot drift from the ones typing uses.
 */
export function addMentionUsage(usage, mention) {
  const token = mention.key
  if (!token || token.includes(' ')) return usage
  const s = (usage.bare[token] ??= blank())
  s.total++
  if (mention.possessive) s.possessive++
  // Possessive occurrences are excluded from the locative count unconditionally: a body-part
  // possessive ("across Senna's skin") is not a locative mention of a place.
  else if (mention.locative) s.locative++
  if (mention.nearSpeech) s.speech++
  return usage
}

const BARE_TOKEN_MIN = 5           // fewer occurrences than this is too thin to trust either way
const LOCATIVE_DOMINANT_SHARE = 0.5

/**
 * Does this token's own bare-form history look confidently like a PLACE rather than half of a
 * person's name?
 *
 * `Garreth Wrenmoor`: 40 of 46 story-wide mentions are bare "Wrenmoor", every one the object of a
 * locative preposition ("of Wrenmoor", "across Wrenmoor"), none possessive, none speech-adjacent — a
 * shape no legitimate character produces (a person known mostly by one half of their name is still
 * SPOKEN or POSSESSES something, sooner or later). Thresholds validated against six real stories
 * plus a constructed adversarial case (siblings sharing a territory's name as their surname — that
 * shape fails on speech/possessive alone, correctly staying mergeable): exactly one token flags,
 * zero false positives; loosening to total>=2, share>=0.3 is where noise starts.
 */
export function isLocativeDominant(usage, token) {
  const s = usage?.bare?.[normalizeName(token)]
  if (!s || s.total < BARE_TOKEN_MIN) return false
  if (s.speech > 0 || s.possessive > 0) return false
  return s.locative / s.total >= LOCATIVE_DOMINANT_SHARE
}
