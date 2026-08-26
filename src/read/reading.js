// src/read/reading.js
//
// A Reading is everything one paragraph's TEXT says, and nothing else. Pure function of the text,
// cached by content hash, never invalidated by anything happening elsewhere in the story.
//
// This is the layer that makes recompute exact. Ingesting a paragraph twice, or re-ingesting it
// after fifty more turns, produces a byte-identical Reading — so an edit re-reads exactly one
// paragraph and everything downstream is replayed from readings that were already correct.
//
// Deliberately NOT here: admission (which spans are real), identity (which spans are the same
// person), attribution (who owns what), typing. All of those need the rest of the story.

import { sentences as splitSentences, quotedRanges, sentenceAt, inRanges } from './segment.js'
import { rawSpans, spanSurface } from './spans.js'
import { phrasesIn } from './phrases.js'
import { extractTraits } from './traits.js'
import { selfIdentifiedSpeaker } from './speech.js'
import { isNoise } from '../names.js'
import { MALE_PRONOUN, FEMALE_PRONOUN, NEUTER_PRONOUN } from '../lexicon/gender.js'

const PRONOUN_RE = new RegExp(`\\b(${MALE_PRONOUN}|${FEMALE_PRONOUN}|${NEUTER_PRONOUN})\\b`, 'gi')
// `its`/`itself` only, never bare `it` (expletive/object uses: "it was cold"). Neuter is a POSITIVE
// class earned by a majority, not "neither male nor female" by default.
const classOfPronoun = (w) => /^(he|him|his|himself)$/i.test(w) ? 'm'
  : /^(she|her|hers|herself)$/i.test(w) ? 'f' : 'n'

const CAP_RE = /\b\p{Lu}[\p{L}'’-]*\b/gu
const LOW_RE = /\b\p{Ll}[\p{L}'’-]*\b/gu

/** Cheap, stable content hash — identifies a Reading's input so the cache can skip re-reading. */
export function hashText(text) {
  let h1 = 0x811c9dc5, h2 = 0x01000193
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 16777619) >>> 0
    h2 = Math.imul(h2 + c + i, 2654435761) >>> 0
  }
  return `${h1.toString(36)}${h2.toString(36)}:${text.length}`
}

/**
 * @param {string} text  one paragraph
 * @returns {{
 *   text: string, hash: string,
 *   sentences: {start, end, text}[],
 *   quotes: [number, number][],
 *   spans: {words: {text, at}[], surface: string, start, end, sentence, atSentenceStart,
 *           inQuote: boolean}[],
 *   phrases: object[],           see ./phrases.js, plus `sentence` and `coveredBySpan`
 *   traits: {text, at, sentence}[],
 *   pronouns: {at, word, cls, sentence}[],
 *   selfIdAt: number[],          offsets right after an "I am"/"I'm" inside a quote
 *   sentenceQuoted: boolean[],   does this sentence contain a quote at all
 *   words: {cap: Record<string, number>, low: Record<string, number>},
 *   spanStats: {span: Record<string, number>, headMid: Record<string, number>,
 *               headStart: Record<string, number>, tail: Record<string, number>},
 * }}
 */
export function readParagraph(text) {
  const t = text ?? ''
  const sents = splitSentences(t)
  const quotes = quotedRanges(t)

  const spans = rawSpans(t).map(s => ({
    ...s,
    surface: spanSurface(s.words),
    sentence: Math.max(0, sentenceAt(sents, s.start)),
    inQuote: inRanges(s.start, quotes),
  }))

  // A phrase whose characters are already covered by a capitalised span is NOT independently
  // classified. The old package needed two separate guards for this (`knownKeys` and `knownSpans`),
  // passed down through the phrase classifier, because the two detectors ran on different data and
  // could derive different keys for the same characters — a bug that corrupted a settled 56-mention
  // entity. Here both live in the same Reading, so overlap is checked once, structurally.
  const phrases = []
  for (const [si, s] of sents.entries()) {
    for (const p of phrasesIn(s.text, s.start)) {
      phrases.push({
        ...p,
        sentence: si,
        coveredBySpan: spans.some(sp => sp.start < p.end && p.start < sp.end),
      })
    }
  }

  // Extracted per SENTENCE, not over the whole paragraph: several trait patterns span a copula
  // ("her hands were calloused") and running them across a sentence boundary would invent traits
  // out of two unrelated clauses. Offsets are lifted back to paragraph coordinates.
  const traits = []
  for (const [si, s] of sents.entries()) {
    for (const h of extractTraits(s.text)) traits.push({ text: h.text, at: s.start + h.at, sentence: si })
  }

  const pronouns = []
  PRONOUN_RE.lastIndex = 0
  let pm
  while ((pm = PRONOUN_RE.exec(t)) !== null) {
    pronouns.push({
      at: pm.index, word: pm[1], cls: classOfPronoun(pm[1]),
      sentence: Math.max(0, sentenceAt(sents, pm.index)),
    })
  }

  // Self-identification inside a quote ("I am Ophira") — the one speaker signal that needs nothing
  // external. Recorded as offsets; admission decides later whether a candidate actually starts
  // there.
  const selfIdAt = []
  for (const [qa, qb] of quotes) selfIdAt.push(...selfIdentifiedSpeaker(t.slice(qa, qb), qa))

  const sentenceQuoted = sents.map(s => quotes.some(([a, b]) => a < s.end && s.start < b))

  return {
    text: t, hash: hashText(t),
    sentences: sents, quotes, spans, phrases, traits, pronouns, selfIdAt, sentenceQuoted,
    words: wordCase(t),
    spanStats: spanStats(spans),
  }
}

/**
 * Capitalised/lowercase counts for every word in this paragraph, so the story-wide lexis is a
 * plain sum over paragraphs and therefore exactly reversible when one is removed.
 *
 * Noise is dropped here rather than at query time: anything the noise gate rejects can never be a
 * candidate, so the casing test is never asked about it and storing it is pure weight (that
 * restriction turned ~5300 entries into ~290 in the old package).
 */
function wordCase(text) {
  const cap = {}, low = {}
  CAP_RE.lastIndex = 0
  for (const m of text.matchAll(CAP_RE)) {
    if (isNoise(m[0])) continue
    const w = m[0].toLowerCase()
    cap[w] = (cap[w] ?? 0) + 1
  }
  LOW_RE.lastIndex = 0
  for (const m of text.matchAll(LOW_RE)) {
    const w = m[0]
    low[w] = (low[w] ?? 0) + 1
  }
  return { cap, low }
}

/**
 * Which spans/heads/tails this paragraph attested, and where. "Mid-sentence" means the capital has
 * no positional excuse, which is the whole signal.
 */
function spanStats(spans) {
  const span = {}, headMid = {}, headStart = {}, tail = {}
  for (const s of spans) {
    if (isNoise(s.surface)) continue
    const head = s.words[0].text.toLowerCase()
    if (s.atSentenceStart) headStart[head] = (headStart[head] ?? 0) + 1
    else {
      headMid[head] = (headMid[head] ?? 0) + 1
      const key = s.surface.toLowerCase()
      span[key] = (span[key] ?? 0) + 1
      const last = s.words[s.words.length - 1].text.toLowerCase()
      tail[last] = (tail[last] ?? 0) + 1
    }
  }
  return { span, headMid, headStart, tail }
}
