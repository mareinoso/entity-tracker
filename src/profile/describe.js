// src/profile/describe.js
//
// How much a mention DESCRIBES its entity. Ranks which turns' text is worth keeping — nothing else
// reads the number, so cheap and approximate is fine. Add a type by adding a scorer below.
//
// Person vocabulary comes from lexicon/appearanceLexicon.js; that file's table says which groups
// are also traits and why. Place/org/item vocab comes from lexicon/placesOrgsItems.js — used only
// by scoring, which is why it isn't in the same file as the person groups.

import {
  HAIR, FACE, BODY, GARMENT, WORN_MARK, GROOMING, WEAR_VERB,
  NOTABLE, INHUMAN, EXPRESSION, COLOUR, NATURE, FIGURE, BEAUTY, KIN, anyOf,
} from '../lexicon/appearance.js'
import {
  LOCATION_FORM, LOCATION_TERRAIN, LOCATION_SCALE, LOCATION_SITING,
  ORG_BODY, ORG_POWER, ORG_AIM, ITEM_MATTER, ITEM_STATE, ITEM_DOES,
} from '../lexicon/world.js'

const hits = (win, re, cap) => Math.min(cap, (win.match(re) || []).length) * 2

// Appositives: "X, the …" / "X was a …". Every type fires these, but the relative clause differs
// (who vs which), so each scorer states its own below rather than sharing it.
export const APPOS_THE = /^\s*,\s+(?:the|a|an)\s/i
export const APPOS_WAS = /^\s+(?:is|was|are|were)\s+(?:the|a|an)\s/i

// Per-type lexicons, never shared: what makes a passage worth keeping for a character (looks,
// temperament) has no counterpart for a place (extent, terrain), and merging them would give each
// type a diluted version of the other's rules.
// Hair state scores as body, not clothing — "cropped", "tousled" describe hair.
export const CHARACTER_BODY = anyOf(HAIR, FACE, BODY, GROOMING, EXPRESSION, NOTABLE, INHUMAN)
export const CHARACTER_WEAR = anyOf(GARMENT, WORN_MARK, WEAR_VERB)
export const CHARACTER_NATURE = anyOf(NATURE)
export const CHARACTER_FIGURE = anyOf(FIGURE)
export const CHARACTER_BEAUTY = anyOf(BEAUTY)
export const CHARACTER_KIN = anyOf(KIN)

// Colour alone is noise — 9% of person mentions and 8% of place mentions, so it says nothing about
// which is being described. Bound to a head noun it is the highest-lift signal in the file (3.35x,
// 0% on places). It must cover the orders prose actually uses: colour before eyes, before hair or
// a hairstyle, before a garment; plus skin tone, stated the other way round about as often.
// Up to two words may sit between colour and noun — "long dark curly hair", "black leather jacket".
// Beyond two the pair is usually unrelated.
const HEAD = `(?:${HAIR}|${FACE}|${GARMENT}|${WORN_MARK})`
const C = `(?:${COLOUR})`
export const CHARACTER_COLOUR = new RegExp(
  `\\b${C}(?:[-,\\s]+\\w+){0,2}[-\\s]+${HEAD}\\b` +
  `|\\b${HEAD}\\s+(?:\\w+\\s+){0,2}(?:was|were|of|in)\\s+(?:an?\\s+)?(?:\\w+\\s+){0,1}${C}\\b` +
  `|\\b${HEAD},\\s+(?:an?\\s+)?(?:\\w+\\s+){0,1}${C}\\b`,
  'gi')

/**
 * Each scorer: (win, after) => number. `win` is the surrounding window, `after` the text
 * immediately following the mention. Exported so benchmarks measure what ships.
 */
export const DESCRIBE_SCORERS = {
  character: (win, after) => {
    // Colour scores lowest and caps soonest — least specific of the three, since prose colours
    // everything. It counts only as corroboration of body/garment terms nearby.
    let s = hits(win, CHARACTER_BODY, 4) + hits(win, CHARACTER_WEAR, 3)
      + hits(win, CHARACTER_NATURE, 3) + hits(win, CHARACTER_COLOUR, 2)
      + hits(win, CHARACTER_FIGURE, 2) + hits(win, CHARACTER_KIN, 2) + hits(win, CHARACTER_BEAUTY, 1)
    if (APPOS_THE.test(after)) s += 3
    if (APPOS_WAS.test(after)) s += 3
    if (/^\s*,\s+who\b/i.test(after)) s += 2
    return s
  },

  location: (win, after) => {
    let s = hits(win, LOCATION_FORM, 4) + hits(win, LOCATION_TERRAIN, 3) + hits(win, LOCATION_SCALE, 3)
      + hits(win, LOCATION_SITING, 2)
    if (APPOS_THE.test(after)) s += 3
    if (APPOS_WAS.test(after)) s += 3
    // "the harbour, which lay below" — places take `which`/`where`, not `who`.
    if (/^\s*,\s+(?:which|where)\b/i.test(after)) s += 2
    return s
  },

  organization: (win, after) => {
    let s = hits(win, ORG_BODY, 4) + hits(win, ORG_POWER, 3) + hits(win, ORG_AIM, 3)
    if (APPOS_THE.test(after)) s += 3
    if (APPOS_WAS.test(after)) s += 3
    if (/^\s*,\s+(?:which|who|whose)\b/i.test(after)) s += 2
    return s
  },

  item: (win, after) => {
    let s = hits(win, ITEM_MATTER, 4) + hits(win, ITEM_STATE, 3) + hits(win, ITEM_DOES, 3)
    if (APPOS_THE.test(after)) s += 3
    if (APPOS_WAS.test(after)) s += 3
    if (/^\s*,\s+(?:which|its)\b/i.test(after)) s += 2
    return s
  },
}

// Everything is untyped until typing lands, so something has to run. Character, because candidates
// run ~6:1 person-to-place — and it beats scoring nothing even on places, where the shared
// appositive patterns still fire 23% of the time. An assumption; change this line, not the scorers.
const DEFAULT_TYPE = 'character'

/** Score one mention against the entity's OWN type. */
export function scoreDescription(text, offset, surface, type = null) {
  const scorer = DESCRIBE_SCORERS[type] ?? DESCRIBE_SCORERS[DEFAULT_TYPE]
  return scorer(
    text.slice(Math.max(0, offset - 120), offset + 260),
    text.slice(offset + surface.length, offset + surface.length + 90),
  )
}
