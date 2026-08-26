// src/read/traits.js
//
// What is TRUE and DISTINCTIVE about a character — what is worth writing onto a card. Same
// vocabulary as describeScore.js, different question, so it takes a different cut: that file asks
// whether a passage describes anyone at all, where `hands` and `eyes` are excellent signals and
// useless content, because the default is having them.
//
// The rule: THE DEFAULT STATE IS NOT A TRAIT — only a departure counts.
//   nose -> nothing,  crooked nose -> trait      arms -> nothing,  one arm -> trait
// Some groups are already the departure and pass bare (a scar, horns, glasses). Which is which
// lives in appearanceLexicon.js's table; this file only wires it up.

import {
  PART, FIGURE_FORM, BEAUTY, KIN, NATURE, NOTABLE, INHUMAN, WORN_MARK, POSSESSIVE_BOUND,
  HAIR, COLOUR, anyOf,
} from '../lexicon/appearance.js'
import { CHARACTER_COLOUR } from '../profile/describe.js'
import { SAY_ANY } from '../lexicon/speech.js'

const COMMON_PART = `(?:${PART})`

// Passes bare: no modifier can make these more of a departure than they already are.
const STANDALONE = [anyOf(NOTABLE), anyOf(INHUMAN), anyOf(WORN_MARK), anyOf(FIGURE_FORM),
  anyOf(BEAUTY), anyOf(KIN), CHARACTER_COLOUR]

// ...unless the word is sitting in front of a body part, in which case it's MODIFYING that part
// rather than making a claim of its own, and MODIFIED_PART has already captured it bound. Guards
// against two failures: a duplicate fact (`scarred face` + bare `scarred`) and a false claim
// ("piercing green eyes" yielding a bare `piercing`, i.e. jewellery nobody has). Position, not
// vocabulary, tells the two apart — "a silver piercing glints in her ear" still counts standalone.
const AS_MODIFIER = new RegExp(String.raw`^\s*(?:[\p{L}-]+\s+)?${COMMON_PART}\b`, 'iu')

// Words that sit in front of a noun without describing it. A possessive is not a trait, and
// neither is a side or a position — everyone has a left hand. Same default-state test.
// The tail after `one two` are function words that can follow a copula: "his eyes were like river
// stones" was yielding the trait "like eyes", which then told establishedSlots the eyes were done.
const NOT_A_MODIFIER = new Set(`the a an his her their its my your our this that these those
some any each every another such what which said same own
left right both other upper lower front back near far first second next last
one two
like as not still there here also now then too quite more most less very`.split(/\s+/))

// Absence or an abnormal count, in the ways prose states them.
//
// The numeric branch excludes hands/arms/legs/fingers via lookahead — fingers run to ten and
// hands/arms/legs come up constantly in ordinary action ("placing two fingers beneath her chin"),
// so a bare number in front of one is almost never a departure, just narrating which/how many are
// doing something. Eyes, ears and the rest stay: a small deviation from THEIR norm (one eye, three
// ears) really is unusual on its own. A genuine limb/finger departure still has a home — the
// vocabulary branch just above ("missing an arm", "only one hand") and NOTABLE's standalone
// `maimed`/`missing` both already catch it without needing the numeric form at all.
const DEPARTURE = new RegExp(
  `\\b(?:missing|lost|lacking|without|no|only)\\s+(?:\\w+\\s+){0,2}${COMMON_PART}\\b` +
  `|\\b(?:one|two|three|four|six|eight|a\\s+single|a\\s+dozen)\\s+(?!hands?\\b|arms?\\b|legs?\\b|fingers?\\b)${COMMON_PART}\\b` +
  `|\\b${COMMON_PART}\\s+(?:was|were|is|are)\\s+(?:gone|missing|shattered|ruined)\\b`,
  'gi')

// A common part with a real adjective attached — "crooked nose", "narrow waist".
// One word of modifier, not two: a wider window swallowed the verb in "showing yellow teeth" and
// the possessive in "his dark hair". A single qualifier is already the whole trait, and multi-word
// colour phrases are covered by CHARACTER_COLOUR, which binds properly.
const MODIFIED_PART = new RegExp(`\\b([\\p{L}-]+)\\s+(${COMMON_PART})\\b`, 'giu')

/** The reverse order — "his nose was crooked", "her teeth are yellow". */
const PART_PREDICATE = new RegExp(
  `\\b(${COMMON_PART})\\s+(?:was|were|is|are|seemed|looked)\\s+(?:so\\s+|very\\s+|rather\\s+)?([\\p{L}-]+)\\b`,
  'giu')

// POSSESSIVE_BOUND ("scales", "muzzle", "horns", "wings"...) collides too often with unrelated
// senses (weighing/measurement, a gun's muzzle, a building wing) to pass bare the way the rest of
// INHUMAN does — see appearanceLexicon.js's comment. A possessive immediately before ("his scales",
// "the drake's muzzle") is what actually separates "this creature's body" from those senses.
const POSSESSIVE_TRAIT = new RegExp(`(?:\\bhis\\b|\\bher\\b|\\bits\\b|[\\p{L}]+'s)\\s*(?:[\\p{L}-]+\\s+){0,2}(${POSSESSIVE_BOUND})\\b`, 'giu')

// Temperament, bound like colour. A bare adjective is ambient: "footsteps echoing softly on the
// cold stone floor" describes a floor and a sound, and unbound it credited Alistair with
// "softly, cold". It counts when predicated of someone, modifying a part of them, or qualifying
// how they spoke.
const N = `(?:${NATURE})`
const NATURE_BOUND = new RegExp(
  `\\b(?:was|were|is|are|seemed|looked|felt|remained|sounded)\\s+(?:so\\s+|very\\s+|rather\\s+|quite\\s+)?(${N})\\b`
  + `|\\b(${N})[-\\s]+${COMMON_PART}\\b`
  // SAY_ANY, not the detection split: here the verb is only a frame for the adverb after it, so
  // "laughed nervously" is as good as "said nervously" and a false speaker costs nothing.
  + `|\\b(?:${SAY_ANY})\\s+(${N})\\b`
  + `|\\b(?:a|an|the)\\s+(${N})\\s+(?:man|woman|girl|boy|figure|voice|smile|glance|look)\\b`,
  'gi')

const push = (out, text, at) => {
  const clean = text.replace(/\s+/g, ' ').trim().toLowerCase()
  if (clean && !out.some(t => t.text === clean)) out.push({ text: clean, at })
}

// Which appearance slot a trait speaks to. Traits are bound phrases — "sandy hair", "mismatched
// eyes" — so the head noun names the slot and a COLOUR word says whether it settles the colour.
const HAIR_SLOT = new RegExp(`\\b(?:${HAIR})\\b`, 'i')
const EYE_SLOT = /\b(?:eyes?|eyed)\b/i
const COLOUR_WORD = new RegExp(`\\b(?:${COLOUR})\\b`, 'i')

/**
 * What the story has already settled, so callers can stop offering help where none is needed.
 * Drives the conditional palette: suggest colours only for slots the story left open. Offering a
 * hair palette to a character the text already calls sandy-haired invites the model to reconsider
 * a decision already made.
 *
 * `described` is the weaker signal and the right one for suppression — "mismatched eyes" settles
 * the eyes without naming a colour, and a palette would still be an intrusion.
 *
 * Deliberately unwired (no caller outside scratchpad/) — `COLOUR` (appearanceLexicon.js) is a flat
 * word list with no family grouping, so `coloured` can't tell "red hair" and "crimson hair" apart
 * from a genuine two-colour inconsistency, nor pick a canonical one when they disagree. `entry.
 * features` already carries the counts a resolver would need to pick the best-attested variant
 * (`sumCounts` in candidatePool.js) — the missing piece is the colour-family grouping, not counts.
 */
export function establishedSlots(traits = []) {
  const has = (slot, needColour) => traits.some(t =>
    slot.test(t) && (!needColour || COLOUR_WORD.test(t)))
  return {
    hairDescribed: has(HAIR_SLOT, false),
    hairColoured:  has(HAIR_SLOT, true),
    eyesDescribed: has(EYE_SLOT, false),
    eyesColoured:  has(EYE_SLOT, true),
  }
}

/**
 * Traits worth putting on a card. Returns [] for a character the story never described, which is
 * the correct and useful answer — it is what tells card generation not to invent from nothing.
 */
export function extractTraits(text) {
  if (!text) return []
  const out = []

  for (const re of [...STANDALONE, DEPARTURE]) {
    re.lastIndex = 0
    let m
    while ((m = re.exec(text)) !== null) {
      // `re === DEPARTURE` already spans its part, so the modifier test would misread it.
      const modifying = re !== DEPARTURE && AS_MODIFIER.test(text.slice(m.index + m[0].length))
      if (!modifying) push(out, m[0], m.index)
      if (m.index === re.lastIndex) re.lastIndex++
    }
  }

  NATURE_BOUND.lastIndex = 0
  let n
  while ((n = NATURE_BOUND.exec(text)) !== null) {
    const word = n[1] ?? n[2] ?? n[3] ?? n[4]
    if (word) push(out, word, n.index)
    if (n.index === NATURE_BOUND.lastIndex) NATURE_BOUND.lastIndex++
  }

  MODIFIED_PART.lastIndex = 0
  let m
  while ((m = MODIFIED_PART.exec(text)) !== null) {
    const modifier = m[1].trim()
    // "his crooked nose" -> "crooked nose"; "his nose" and "left hand" -> nothing. The length test
    // drops the possessive tail: "Chauvelin's hands" would otherwise yield "s hands".
    if (modifier.length > 2 && !NOT_A_MODIFIER.has(modifier.toLowerCase())) {
      push(out, `${modifier} ${m[2]}`, m.index)
    }
    if (m.index === MODIFIED_PART.lastIndex) MODIFIED_PART.lastIndex++
  }

  PART_PREDICATE.lastIndex = 0
  let p
  while ((p = PART_PREDICATE.exec(text)) !== null) {
    // Normalised into the same shape as the other form, so "her hands were calloused" and "her
    // calloused hands" produce one trait rather than two spellings of it.
    if (!NOT_A_MODIFIER.has(p[2].toLowerCase())) push(out, `${p[2]} ${p[1]}`, p.index)
    if (p.index === PART_PREDICATE.lastIndex) PART_PREDICATE.lastIndex++
  }

  POSSESSIVE_TRAIT.lastIndex = 0
  let pb
  while ((pb = POSSESSIVE_TRAIT.exec(text)) !== null) {
    push(out, pb[1], pb.index + pb[0].indexOf(pb[1]))
    if (pb.index === POSSESSIVE_TRAIT.lastIndex) POSSESSIVE_TRAIT.lastIndex++
  }

  // Drop anything wholly contained in a longer trait: NOTABLE matches "missing" and DEPARTURE
  // matches "missing an arm" — only the specific one is worth keeping.
  const kept = out.filter(t => !out.some(o => o !== t && o.text.includes(t.text)))
  return kept.sort((a, b) => a.at - b.at)
}
