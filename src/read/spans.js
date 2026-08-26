// src/read/spans.js
//
// Capitalised runs — the raw orthographic proposal, and nothing else.
//
// This file is deliberately EVIDENCE-FREE. The old package trimmed spans here using the accumulated
// word history, which made extraction a function of pool state and cost the package deterministic
// replay ("re-processing paragraph 5 after paragraph 50 saw more of the story than paragraph 5
// originally had" — text-entity-tracker README §8). Reading is now a pure function of one
// paragraph's text, cached by content hash; every judgement that needs the rest of the story
// (opener trimming, ordinariness, admission) lives in `src/admit.js`, one layer up, and is
// recomputed from whatever paragraphs are currently live.
//
// A span source is swappable: return `{words: [{text, at}], start, end, atSentenceStart}` and the
// rest of the pipeline neither knows nor cares how the spans were found.

import { STOPWORDS } from '../lexicon/grammar.js'

// Abbreviations are their own alternative rather than a looser character class: "U.A." is
// capital-dot-capital-dot, a shape a sentence ending cannot produce, so the trailing period is
// never swallowed and a match cannot run across a sentence boundary.
const ABBR = `(?:\\p{Lu}\\.){2,}`               // U.A.  N.A.S.A.
const WORD = `\\p{Lu}[\\p{L}\\p{M}\\d'’-]*`     // Class  Kh'zaeth  Sol-leks  R2-D2
const NUM  = `\\d[\\p{L}\\d-]*`                 // 1-A — only ever a continuation
const UNIT = `(?:${ABBR}|${WORD})`
const TOKEN_RE = new RegExp(
  `${UNIT}(?:\\s+(?:of|the|de|von)\\s+${UNIT}|\\s+(?:${UNIT}|${NUM}))*`,
  'gu'
)

const SENTENCE_START = /(?:^|[.!?…]["'”’)\]]*\s+|\n\s*|["“]\s*)$/

/**
 * Every capitalised run in the text, tokenised, with each word's own absolute offset.
 *
 * Two text-only normalisations are applied, because both are facts about English orthography
 * rather than judgements about this story:
 *   - a leading `The ` is dropped ("The Silver City" and "the Silver City" are one entity)
 *   - stopwords are trimmed off both ends ("Instead Aoi" -> "Aoi")
 *
 * `atSentenceStart` reports whether the SURVIVING first word is still sentence-initial: once
 * `Instead` is gone, `Aoi`'s capital has no positional excuse any more, and admission must not be
 * told otherwise.
 *
 * @returns {{words: {text: string, at: number}[], start: number, end: number,
 *            atSentenceStart: boolean}[]}
 */
export function rawSpans(text) {
  const out = []
  if (!text) return out
  TOKEN_RE.lastIndex = 0
  let m
  while ((m = TOKEN_RE.exec(text)) !== null) {
    const atSentenceStart = SENTENCE_START.test(text.slice(Math.max(0, m.index - 40), m.index))

    // Tokenise with real offsets, so any later trim is exact rather than reconstructed by string
    // arithmetic (the old package recomputed offsets after trimming and got them wrong once).
    const words = []
    const wordRe = /\S+/g
    let w
    while ((w = wordRe.exec(m[0])) !== null) words.push({ text: w[0], at: m.index + w.index })

    // "The Silver City" and "the Silver City" are the same entity.
    let trimmedLead = false
    if (words.length > 1 && /^The$/.test(words[0].text)) { words.shift(); trimmedLead = true }
    while (words.length && STOPWORDS.has(words[words.length - 1].text.toLowerCase())) words.pop()
    while (words.length && STOPWORDS.has(words[0].text.toLowerCase())) { words.shift(); trimmedLead = true }
    if (!words.length) continue

    out.push({
      words,
      start: words[0].at,
      end: words[words.length - 1].at + words[words.length - 1].text.length,
      atSentenceStart: atSentenceStart && !trimmedLead,
    })
  }
  return out
}

/** The surface a word list spells, joined the way the text spelled it. */
export const spanSurface = (words) => words.map(w => w.text).join(' ')
