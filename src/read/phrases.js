// src/read/phrases.js
//
// Noun phrases that could denote somebody: "a large woman with a heavy fur boa", "the drow",
// "the Dwarven Blacksmith". Found structurally (determiner, modifiers, head) rather than by head
// vocabulary, and scored for animacy by four corroborating signals.
//
// WHAT THIS FILE NO LONGER DOES, on purpose. The old `classifyPhrases` also decided, in the same
// pass, whether a phrase became a tracked entity, blocked attribution, or was waived onto a named
// character — three verdicts that need the admitted mention list, the accumulated gender tally and
// the paragraph's focus state, none of which belong to reading. It read them through six optional
// parameters and produced one bundled result that its caller then partly re-derived. Here reading
// reports only what the TEXT says (shape, head, animacy, what precedes the phrase), and
// `src/attribute/` makes every verdict, once.

import { PART, INHUMAN, GARMENT, WORN_MARK } from '../lexicon/appearance.js'
import { SAY_ANY } from '../lexicon/speech.js'
import { PERSON_NOUN_WIDE } from '../lexicon/people.js'
import {
  PREPOSITION, AUXILIARY, CONJUNCTION, PRONOUN_TOK, RELATIVISER, BARE_VERB,
  DETERMINER, COLLECTIVE, IRREGULAR_PLURAL,
} from '../lexicon/grammar.js'
import { FEMALE_WORDS, MALE_WORDS, HUMAN_PRONOUN } from '../lexicon/gender.js'
import { quotedRanges, inRanges } from './segment.js'

// Verb-ish by inflection — `-ed` and `-ing` ONLY. `-s` would read every plural noun as a verb
// ("the rebel officers" terminates one token early and loses its head); third-person `-s` verbs are
// covered by BARE_VERB instead, a closed list that can tell `walks` from `officers`.
const VERBY = /(?:ed|ing)$/i

// HEAD_LISTED locates the head INSIDE a phrase and must match plurals — "the rebel officers" has
// to parse as head `officers`, or the walk hands back `rebel`.
const HEAD_LISTED = new RegExp(`^(?:${PERSON_NOUN_WIDE})s?$`, 'i')
const HEAD_SINGULAR = new RegExp(`^(?:${PERSON_NOUN_WIDE})$`, 'i')

/** Does this head denote a group rather than an individual? */
export function isPluralHead(head) {
  if (IRREGULAR_PLURAL.test(head) || COLLECTIVE.test(head)) return true
  if (!/s$/i.test(head)) return false
  // Both plural forms have to be tried — creature/creatures needs `-s`, witch/witches needs `-es`
  // — and each strip must be applied ONLY when it matches: testing `princess.replace(/es$/)` on a
  // miss returns `princess` itself, which is in the role list, so every -ess word would read as
  // plural (princess, goddess, mistress, heiress) without this guard.
  const stems = []
  if (/es$/i.test(head)) stems.push(head.replace(/es$/i, ''))
  stems.push(head.replace(/s$/i, ''))
  return stems.some(st => HEAD_SINGULAR.test(st))
}

const NP_START = new RegExp(`\\b(?:${DETERMINER})\\s`, 'gi')
const BOUNDARY = new RegExp(`^(?:${PREPOSITION}|${AUXILIARY}|${CONJUNCTION}|${PRONOUN_TOK}|${RELATIVISER}|(?:${BARE_VERB})(?:s|es|ed|ing)?)$`, 'i')

// Determiners that INTRODUCE somebody new to the reader, versus ones that refer BACK to somebody
// already on stage ("the drow", "this figure"). Possessives (`his mother`) are deliberately
// neither: relational, defined by somebody ELSE, a different problem from a standalone description.
const INTRODUCES = /^(?:a|an|another|some|one|other)$/i
const REFERS_BACK = /^(?:the|this|that)$/i

// Predicative, not introductory: "the Comtesse ... was a most conspicuous figure" renames whoever
// the sentence is already about. Copulas and `as` only — `made`/`called` are not predicative
// markers ("I made a very fine figure" predicates the narrator, not whoever the sentence mentions).
const PREDICATIVE = /\b(?:was|were|is|are|seemed|became|looked|remained|appeared|as)\s+$/i
// A dash introduces an appositive as readily as a comma, and RP prose prefers it:
//   "a crude sketch of Ferro - a thin man with hollow eyes"
const DASH_APPOSITIVE = /[-–—]\s*$/
const COMMA_BEFORE = /,\s*$/
// The phrase names itself just after — an introduction, not a passer-by: "a young woman named Talis".
const NAMES_ITSELF = /\b(?:introduc(?:es|ed|ing)\s+(?:him|her|them)sel(?:f|ves)\s+as|named|called|goes\s+by|known\s+as|who\s+is)\s+\p{Lu}/u

const BODY_PART = new RegExp(`^(?:${PART}|${INHUMAN})$`, 'i')
// The attributive form of the same claim — "a wiry man WITH a scarred face". Window kept short so
// "a man with a plan for the hands of fate" doesn't qualify.
const WITH_PART = new RegExp(
  String.raw`^\s*(?:with|in|wearing|clad\s+in|dressed\s+in|sporting)\s+(?:[\p{L}'’-]+\s+){0,3}(?:${PART}|${INHUMAN}|${GARMENT}|${WORN_MARK})\b`,
  'iu')
const SPEAKS = new RegExp(`\\b(?:${SAY_ANY})\\b`, 'i')
const GENDERED = new RegExp(`\\b(?:${HUMAN_PRONOUN})\\b`, 'i')

/** Gender settled by the head noun alone — "a woman" is female by English vocabulary. */
export const genderOfHead = (head) =>
  FEMALE_WORDS.has(head) ? 'f' : MALE_WORDS.has(head) ? 'm' : null

/**
 * How strongly does this phrase denote somebody? Four independent signals, summed — no single one
 * is trusted alone, since a head-noun match by itself can't tell a person from an invented-race
 * noun no vocabulary has ever seen.
 */
function animacyOf(np, sentenceText, quotes) {
  const why = []
  let score = 0
  if (HEAD_LISTED.test(np.head)) { score += 3; why.push('head') }
  const tail = sentenceText.slice(np.at + np.phrase.length)
  // Body part — possessive ("the drow's crimson eyes") or attributive ("a wiry man with a scarred
  // face"). Corroboration only: the `with`-construction lands on things 103 times out of 121, but
  // on the 18 whose head already matched a person noun, every one is a person.
  if (np.possessive) {
    const next = tail.slice(0, 40).trim().split(/\s+/).find(w => /\p{L}/u.test(w))?.replace(/[^\p{L}-]/gu, '')
    if (next && BODY_PART.test(next)) { score += 3; why.push('body-part') }
  } else if (HEAD_LISTED.test(np.head) && WITH_PART.test(tail)) {
    score += 3; why.push('has-part')
  }
  // A relative `who` — grammar rather than vocabulary, so it reaches heads no list contains.
  if (HEAD_LISTED.test(np.head) && /^\s*who\b/i.test(tail)) { score += 3; why.push('who') }
  // Subject of a speech verb: the phrase isn't itself inside quotes, and the verb is the very next
  // word — a bare 40-char lookahead credited whatever the quote ended on ("This blade," he says).
  if (!inRanges(np.at, quotes)) {
    const after = tail.replace(/^[\s,;:—–-]+/, '')
    const nextWord = after.split(/\s+/)[0]?.replace(/[^\p{L}]/gu, '') ?? ''
    if (nextWord && SPEAKS.test(nextWord)) { score += 3; why.push('speaks') }
  }
  // A gendered pronoun elsewhere in the sentence — weakest signal, may belong to someone else.
  if (GENDERED.test(sentenceText)) { score += 1; why.push('pronoun') }
  return { score, why }
}

/** Two signals, or one strong one plus corroboration — a bare head match alone does not qualify. */
export const ANIMATE_MIN = 4
/** Enough to refuse crediting a named character, not enough to track anybody of its own. */
export const BLOCK_MIN = 3

/**
 * Every determiner-headed noun phrase in one sentence, with everything the TEXT can say about it.
 *
 * @param {string} sentenceText
 * @param {number} sentenceStart   offset of the sentence within the paragraph
 * @returns {{start, end, at, phrase, det, kind, head, mods, possessive, plural,
 *            animacy: number, why: string[], gender: 'm'|'f'|null,
 *            predicativeBefore: boolean, dashBefore: boolean, commaBefore: boolean,
 *            namesItself: boolean}[]}
 *   `at` is relative to the sentence; `start`/`end` are absolute paragraph offsets.
 */
export function phrasesIn(sentenceText, sentenceStart = 0) {
  const quotes = quotedRanges(sentenceText)
  const out = []
  NP_START.lastIndex = 0
  let m
  while ((m = NP_START.exec(sentenceText)) !== null) {
    const det = m[0].trim()
    const rest = sentenceText.slice(m.index + m[0].length)
    const words = []
    // Up to five tokens; longer than that and the phrase has run into something else.
    let possessive = false
    for (const tok of rest.split(/\s+/).slice(0, 5)) {
      // A possessive ends the phrase ON its own head: in "the soldier's posture", the person is
      // the soldier and `posture` belongs to them.
      const poss = /['’]s?$/.test(tok)
      const bare = tok.replace(/^[^\p{L}-]+/u, '').replace(/['’]s?$/, '').replace(/[^\p{L}-]+$/u, '')
      if (!bare) break
      if (BOUNDARY.test(bare)) break
      if (poss) { words.push(bare); possessive = true; break }
      // An inflected verb ends the phrase — but only once a head exists, or "The scarred man"
      // would stop at "scarred" and "the drow's eyes" would never yield "drow".
      if (words.length && VERBY.test(bare) && !/^[\p{Lu}]/u.test(bare)) break
      words.push(bare)
      // Trailing punctuation on the raw token closes the phrase: "The drow, silent, waits".
      if (/[^\p{L}-]$/u.test(tok)) break
    }
    if (!words.length) continue

    // The head is picked INSIDE the phrase rather than trusting the boundary walk to have stopped
    // in the right place — no fix is possible without a POS tagger. A known person-noun anywhere in
    // the phrase claims headship; the list is the ANCHOR for finding the head, not the test for
    // animacy. LAST match, not first: English heads are rightmost, so "the dragonborn warrior" has
    // head `warrior` and modifier `dragonborn` — which is also where the race belongs.
    const lower = words.map(w => w.toLowerCase())
    let at = -1
    for (let i = lower.length - 1; i >= 0; i--) if (HEAD_LISTED.test(lower[i])) { at = i; break }
    const cut = at >= 0 ? at : lower.length - 1

    const np = {
      at: m.index,
      phrase: `${det} ${words.slice(0, cut + 1).join(' ')}`,
      det: det.toLowerCase(),
      head: lower[cut],
      mods: lower.slice(0, cut),
      possessive,
    }
    const before = sentenceText.slice(0, np.at)
    const plural = isPluralHead(np.head)
    const { score, why } = plural ? { score: 0, why: [] } : animacyOf(np, sentenceText, quotes)

    out.push({
      ...np,
      start: sentenceStart + np.at,
      end: sentenceStart + np.at + np.phrase.length,
      kind: INTRODUCES.test(np.det) ? 'introduces' : REFERS_BACK.test(np.det) ? 'refers-back' : 'possessive',
      plural,
      animacy: score,
      why,
      gender: genderOfHead(np.head),
      predicativeBefore: PREDICATIVE.test(before),
      dashBefore: DASH_APPOSITIVE.test(before),
      commaBefore: COMMA_BEFORE.test(before),
      namesItself: NAMES_ITSELF.test(sentenceText.slice(np.at, np.at + 160)),
    })
  }
  return out
}
