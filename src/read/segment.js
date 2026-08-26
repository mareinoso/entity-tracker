// src/read/segment.js
//
// Where a paragraph divides. Sentences and quoted ranges, computed once per paragraph and stored
// on the Reading, so nothing downstream ever re-splits text and disagrees about which sentence a
// character offset belongs to.
//
// Nothing here knows about entities.

import { SENTENCE_ABBR } from '../lexicon/grammar.js'

// A terminator inside quotes usually is not one: `"Get down!" she shouted` is one sentence, and
// this register is full of them. A lowercase next word means the line continues — which covers
// every speech verb, so no speech list is needed here.
const CONTINUES = /^\s*[a-z]/
const TERMINATOR = /[.!?]+["'”’)\]]*\s+/g

/** @returns {{text: string, start: number, end: number}[]} */
export function sentences(text) {
  const out = []
  let start = 0
  TERMINATOR.lastIndex = 0
  let m
  while ((m = TERMINATOR.exec(text)) !== null) {
    const head = text.slice(start, m.index + 1)
    if (SENTENCE_ABBR.test(head.trim())) continue
    const closedQuote = /["'”’)\]]/.test(m[0])
    if (closedQuote && CONTINUES.test(text.slice(m.index + m[0].length))) continue
    const end = m.index + m[0].length
    out.push({ text: text.slice(start, end), start, end })
    start = end
  }
  if (start < text.length) out.push({ text: text.slice(start), start, end: text.length })
  return out
}

/**
 * Character ranges covered by quoted speech.
 *
 * Marked rather than stripped: characters talk *about* places while narration describes being *in*
 * them, and every false location signal in the AI Dungeon transcript was dialogue-only.
 */
export function quotedRanges(text) {
  const ranges = []
  const re = /[“"][^”"]*[”"]/g
  let m
  while ((m = re.exec(text)) !== null) ranges.push([m.index, m.index + m[0].length])
  return ranges
}

export const inRanges = (offset, ranges) => ranges.some(([a, b]) => offset >= a && offset < b)

/** Do [a,b) and [c,d) share any character? */
export const overlaps = (a, b, c, d) => a < d && c < b

/** Which sentence contains this offset. Sentences are ordered and disjoint, so binary search. */
export function sentenceAt(sents, offset) {
  let lo = 0, hi = sents.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (offset < sents[mid].start) hi = mid - 1
    else if (offset >= sents[mid].end) lo = mid + 1
    else return mid
  }
  return -1
}
