// src/read/speech.js
//
// Did this mention SPEAK, as opposed to being spoken about? A property of one mention, decided by
// verb adjacency — a tighter binding than sentence ownership, because the name and the verb touch.
// What it cannot see is UNTAGGED dialogue, and that is what caps its recall, not misattribution.

import { SAY, SAY_AMBIG, SAY_LOUD } from '../lexicon/speech.js'
import { AUX_BE } from '../lexicon/grammar.js'
import { inRanges } from './segment.js'

// Four shapes per verb class. `called` is in neither list — "called Silver a liar" is naming.
const shapes = (V) => ({
  // "Silver said, …" — two words of slack for "Silver, grinning, said".
  direct: new RegExp(`^[,\\s]*((?:\\w+[,\\s]+){0,2})(?:${V})\\b`, 'i'),
  // "Silver, said Jim" — comma, verb, capitalised name, nothing between: the verb is Jim's. The
  // comma is what separates it from plain SVO, where "Soren warned Alistair" IS Soren speaking.
  handoff: new RegExp(`^,\\s*(?:${V})\\s+\\p{Lu}`, 'iu'),
  // '…," said Silver'. The closing quote is required, and is what separates this from "They asked
  // Silver to come below", where the verb governs the name as its object.
  inverted: new RegExp(`["“”'][,\\s]*(?:\\w+[,\\s]+){0,1}(?:${V})\\s*$`, 'i'),
  // "Marguerite, after a long pause, replied" — more slack than `direct` allows, but only when
  // commas bracket it as an aside. Widening `direct` instead would credit Silver in "Silver went
  // below and Jim said"; the enclosing commas are what make the extra distance safe.
  aside: new RegExp(`^,\\s*[^,]{1,30},\\s*(?:${V})\\b`, 'i'),
})
const SURE = shapes(SAY)
// SAY_LOUD folded in here, not into SAY_AMBIG itself — this shape gate (adjacency + a quote
// nearby) is exactly what makes a loud-noise-prone verb ("screamed", "roared") safe to trust as
// speech. SAY_ANY (used by referent.js/characterTraits.js's much looser, no-adjacency checks)
// deliberately does NOT include SAY_LOUD — see speechLexicon.js's own comment.
const MAYBE = shapes(`${SAY_AMBIG}|${SAY_LOUD}`)

// 40, not 28: ", after a long pause, replied" is 29 chars and a shorter window cut the verb apart.
const WINDOW = 40
const quotedNearby = (quotes, at) => quotes.some(([a, b]) => a < at + 80 && b > at - 80)

const matches = (P, after, before) => {
  if (P.handoff.test(after)) return false
  const d = P.direct.exec(after)
  // An auxiliary in the slack means the passive: "Ophira was asked" is the one being addressed.
  if (d && !AUX_BE.test(d[1])) return true
  return P.aside.test(after) || P.inverted.test(before)
}

export function speaksAt(text, offset, len, quotes) {
  if (inRanges(offset, quotes)) return false
  const after = text.slice(offset + len, offset + len + WINDOW)
  const before = text.slice(Math.max(0, offset - WINDOW), offset)
  if (matches(SURE, after, before)) return true
  // An ambiguous verb needs a quoted line in the vicinity before it counts. Without this,
  // "Instantly I began to extricate myself" reads as tagged speech.
  return matches(MAYBE, after, before) && quotedNearby(quotes, offset)
}

// "I am"/"I'm" only — the two forms actually confirmed in the RP corpus (119 real hits across all
// 6 stories). Not "My name is"/"Call me" — no confirmed instance of either, and "Call me" doubles
// as a common idiom with no name at all ("call me crazy", "call me old-fashioned"). Same
// discipline as the verb-lexicon work: add a form once it's seen, not because it sounds plausible.
const SELF_ID = /\bI(?:'m|’m| am)\s+/g

/**
 * Offsets, within the whole paragraph, where a first-person self-introduction hands over to a name:
 * the character position immediately after "I am " / "I'm " inside a quote.
 *
 * Reading reports the POSITION only. Whether a real candidate starts exactly there is admission's
 * question, asked once it knows which spans survived — this reuses extraction's own name-boundary
 * handling (multi-word/hyphen/apostrophe names, and a leading title: `"I am Archmage Eldric"` is
 * ONE span starting right after "I am ") instead of re-parsing a name here.
 *
 * "I am"/"I'm" only — the two forms actually confirmed in the RP corpus (119 real hits across six
 * stories). Not "My name is"/"Call me": no confirmed instance of either, and "Call me" doubles as
 * an idiom with no name in it at all ("call me crazy").
 *
 * The one speaker signal that needs nothing external: a character's very first self-introduction
 * has no possessive, no narrated speech tag and no continuity context to lean on, by definition.
 *
 * @param {string} quoteText   the quote's own text, INCLUDING its quote marks
 * @param {number} quoteStart  where that text starts in the paragraph
 * @returns {number[]}
 */
export function selfIdentifiedSpeaker(quoteText, quoteStart) {
  const out = []
  SELF_ID.lastIndex = 0
  let m
  while ((m = SELF_ID.exec(quoteText)) !== null) out.push(quoteStart + m.index + m[0].length)
  return out
}
