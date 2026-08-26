// src/names.js
//
// Name shape: normalising a surface form to a key, and the orthographic noise gate. Pure string
// functions over one surface — no story history, no entity state — so every layer can share them
// without creating a dependency on anything above it.

import { TITLES, BOUND_TITLES, HONORIFICS } from './lexicon/titles.js'
import { STOPWORDS } from './lexicon/grammar.js'
import { FEMALE_WORDS, MALE_WORDS } from './lexicon/gender.js'
import { KIND_ADJ, PERSON_NOUN, ROLE_NOUN } from './lexicon/people.js'
import { NOTABLE } from './lexicon/appearance.js'

const STRIP_ARTICLES = /^(the|a|an)\s+/i
// Removed, not replaced with a space, so "U.A." and "UA" land on the same key. Hyphens kept until
// after tokenisation so the honorific rule can see "-sensei", then dropped.
const STRIP_PUNCT    = /[''"`.,]/g
const COLLAPSE_WS    = /\s+/g
const POSSESSIVE     = /[''’]s\b/gi

/**
 * Normalised key, plus what was stripped to get there.
 *
 * Titles and honorifics are identity, not noise — "Principal Ophira"/"Doyle-sensei" belong on a
 * card and are the highest-precision person signal available.
 */
export function analyseName(name) {
  let s = String(name ?? '').replace(POSSESSIVE, '')
  s = s.toLowerCase()
    .replace(STRIP_ARTICLES, '')
    .replace(STRIP_PUNCT, '')
    .replace(COLLAPSE_WS, ' ')
    .trim()

  const honorifics = []
  let tokens = s.split(' ').map(t => {
    const m = t.match(HONORIFICS)
    if (m && t.length > m[0].length) honorifics.push(m[0].replace(/^[-‑]/, ''))
    return t.replace(HONORIFICS, '')
  }).filter(Boolean)

  const titles = []
  while (tokens.length > 1 && TITLES.has(tokens[0])) titles.push(tokens.shift())

  return { key: tokens.join(' ').replace(/-/g, '').trim(), titles, honorifics }
}

export const normalizeName = (name) => analyseName(name).key

export const nameTokens = (name) => normalizeName(name).split(' ').filter(Boolean)

/**
 * Gender implied by the titles a character has been addressed with. `null` when nothing is
 * gendered, or when both are — "Lord" and "Lady" both attested is a mistake in the data, not a
 * person to guess at.
 */
export function genderFromTitles(titles = {}) {
  let m = 0, f = 0
  for (const [title, n] of Object.entries(titles)) {
    if (FEMALE_WORDS.has(title)) f += n
    else if (MALE_WORDS.has(title)) m += n
  }
  if (m && f) return null
  return m ? 'm' : f ? 'f' : null
}

/**
 * A surface that is nothing but a *bound* title ("Mr" alone). `analyseName` only strips a title
 * when something follows it, so a bare one would otherwise survive and clear any surfacing
 * threshold on repetition alone. Only BOUND_TITLES, never the whole set — nobility and ranks are
 * how characters are named and must stay valid standalone.
 */
export function isBareTitle(surface) {
  const tokens = String(surface ?? '').toLowerCase().replace(STRIP_PUNCT, '').trim().split(/\s+/)
  return tokens.length > 0 && tokens.every(t => !t || BOUND_TITLES.has(t))
}

// Contractions hide a stopword ("I'll", "Where's", "They've") — a name never carries one. `n't` is
// its own branch, tried first, so "isn't" reduces to "is" rather than "isn". `won't`/`can't`/
// `shan't` listed explicitly — their stems ("wo"/"ca"/"sha") aren't real words to reduce to.
const IRREGULAR_NEGATIVE = new Map([["won't", 'will'], ["can't", 'can'], ["shan't", 'shall']])
const CONTRACTION = /n['’]t$|[‘’'](?:s|ll|d|re|ve|m|t)$/i
const bareWord = w => {
  const lower = w.toLowerCase().replace(/[‘’]/g, "'")
  return IRREGULAR_NEGATIVE.get(lower) ?? lower.replace(CONTRACTION, '').replace(STRIP_PUNCT, '')
}

/** A single word that is only a stopword once its contraction is removed — `I'll`, `That's`. */
export function isContractedStopword(surface) {
  const words = String(surface ?? '').trim().split(/\s+/)
  return words.length === 1 && CONTRACTION.test(words[0]) && STOPWORDS.has(bareWord(words[0]))
}

/** Drops leading stopwords glued onto a captured span ("Where's Black Dog" -> "Black Dog"). */
export function trimLeadingStopwords(surface) {
  const words = String(surface ?? '').trim().split(/\s+/)
  let i = 0
  while (i < words.length - 1) {
    if (!STOPWORDS.has(bareWord(words[i]))) break
    i++
  }
  return words.slice(i).join(' ')
}

// Descriptors that indicate a missing proper name rather than a real entity name.
const DESCRIPTOR_PREFIX = /^(the|a|an|her|his|their|its|your|our|my|this|that|some|one|another)\s+/i

// Inside an all-caps run, capitalisation carries no signal, so every word looks like a name.
// Single tokens survive — that's where real acronyms are (UA, NASA); a multi-token all-caps span
// is dropped. A genuine shouted name almost always appears in normal case elsewhere too.
const ALL_CAPS_RUN = /^[^\p{Ll}]+$/u

/**
 * Semantic noise, not orthographic — nothing here may require capitals, since a model-based span
 * source can legitimately return lowercase spans ("main building") that are exactly the finds
 * worth having.
 */
export function isNoise(surface) {
  if (ALL_CAPS_RUN.test(surface) && surface.trim().split(/\s+/).length > 1) return true
  // "Mr" and "Dr" on their own: a title with nobody attached names no one.
  if (isBareTitle(surface)) return true
  // "I'll", "That's" — the clitic hides a stopword, and no name carries one.
  if (isContractedStopword(surface)) return true
  const s = String(surface ?? '').trim()
  if (s.length < 2) return true
  if (DESCRIPTOR_PREFIX.test(s)) return true
  // Every token is a stopword, including contracted ones — a span made entirely of function words
  // names nobody, however many of them there are.
  return s.toLowerCase().split(/\s+/).every(w => STOPWORDS.has(w) || isContractedStopword(w))
}

/**
 * Does this key read as a DESCRIPTION rather than a name — `[race/kind adjective][role noun]`
 * ("dwarven blacksmith") or `[notable physical mark][role noun]` ("scarred woman")?
 *
 * One definition, used in exactly one place: admission tags such a span `form: 'descriptor'`, so it
 * enters the pipeline as an anonymous anchor rather than as a name. The old package asked this
 * question from three call sites with two different predicates (`isDistinguishableReferent` for
 * classification and merge-blocking, `isBareRoleReferent` for eviction grace) and had to document
 * at length why they must not be unified. Here the second question doesn't exist: an anonymous
 * anchor's survival is decided by recurrence over live paragraphs (`src/anchors.js`), not by a
 * key-shape predicate.
 *
 * Exactly 2 tokens, singular only — a plural head is a group, never an individual.
 */
const KIND_ADJ_RE = new RegExp(`^(?:${KIND_ADJ})$`, 'i')
const NOTABLE_RE = new RegExp(`^(?:${NOTABLE})$`, 'i')
const ROLE_HEAD_RE = new RegExp(`^(?:${PERSON_NOUN}|${ROLE_NOUN})$`, 'i')
export function looksDescriptive(key) {
  const tokens = String(key ?? '').split(' ')
  if (tokens.length !== 2) return false
  if (!ROLE_HEAD_RE.test(tokens[1])) return false
  return KIND_ADJ_RE.test(tokens[0]) || NOTABLE_RE.test(tokens[0])
}

/** Is this single token a bare role/person noun ("matron", "blacksmith")? */
export const isRoleNoun = (token) => ROLE_HEAD_RE.test(String(token ?? ''))

/** Is this token a title word that only ever appears bound to a name ("king", "queen")? */
export const isTitleWord = (token) => TITLES.has(String(token ?? '').toLowerCase())
