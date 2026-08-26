// src/profile/type.js
//
// What kind of thing is this? Three types and no fallback:
//
//     character | location | organization        untypeable -> null, and null is never surfaced
//
// There is deliberately no default type. A wrong card costs the author attention and puts invented
// detail into the story; staying silent costs nothing.
//
// Evidence is counted per TURN, not per mention and not per paragraph: the weights are about how
// many independent turns agreed, so a character mentioned possessively forty times in one paragraph
// must not outvote forty turns of anything else. The old package stored a running `leanings` object
// on every paragraph record and deduplicated at projection time — 12% of serialised pool weight,
// and a documented double-counting bug when a turn held several paragraphs. Here nothing is stored:
// the lean is computed from the mentions themselves, which are already grouped by turn.

import { PLACE_HEAD, ORG_HEAD } from '../lexicon/world.js'
import { TITLE_HEAD } from '../lexicon/titles.js'

/** The type a span's own final head noun asserts outright, if any. */
export function headTypeOf(name) {
  const head = String(name ?? '').trim().replace(/['’]s?$/, '').split(/\s+/).pop()?.toLowerCase() ?? ''
  if (!head) return null
  // Title first — "Snow Queen" is a person, and epithet-people are exactly what made a
  // "the X -> location" rule look like noise when it was tried.
  if (TITLE_HEAD.test(head)) return 'character'
  if (PLACE_HEAD.test(head)) return 'location'
  if (ORG_HEAD.test(head)) return 'organization'
  return null
}

const THRESHOLD = 3
const POSSESSIVE_MIN = 2

/**
 * An attributive modifier is not a mistyped entity — it is not an entity.
 * "Imperial walker", "Alliance uniform": never possessive, never speaks, never ends a clause.
 * A real name fails this on at least one count; Groff fails on two.
 */
export function isAttributive(profile) {
  if (!profile || profile.mentions < 8) return false
  return profile.possessive === 0 && profile.spoke === 0
    && profile.standalone / profile.mentions < 0.05
}

/**
 * @param {object} e
 * @param {string} e.name                        display name, for the head-noun test
 * @param {Map<string, object[]>} e.mentionsByTurn
 * @param {Set<string>} e.speakerTurns           turns where this key self-identified in a quote
 * @param {boolean} e.hasTitle                   a leading title was parsed off some surface
 * @param {'m'|'f'|'n'|null} e.gender
 * @returns {{type: string|null, lean: object, profile: object}}
 */
export function resolveType(e) {
  const lean = { character: 0, location: 0, organization: 0 }
  const profile = { mentions: 0, possessive: 0, spoke: 0, standalone: 0 }

  // A span-final head noun DECIDES the type — it does not vote alongside the rest. Usage signals
  // (possessive, speech) treat organisations and places exactly like people: they own things, they
  // get quoted too. Letting the head noun merely vote made `Rebel Alliance`/`Empire`/`Imperial
  // Science Center` all resolve to `character`.
  const headType = headTypeOf(e.name)

  for (const [turn, ms] of e.mentionsByTurn) {
    let possessive = false, spoke = false, dearPoor = false, locative = false
    for (const m of ms) {
      profile.mentions++
      if (m.possessive) { profile.possessive++; possessive = true }
      if (m.spoke) { profile.spoke++; spoke = true }
      if (m.standalone) profile.standalone++
      if (m.dearPoor) dearPoor = true
      // Possessive occurrences excluded unconditionally: "in Korrath's eyes" is a body-part
      // possessive, nothing to do with place, and was 10 false turns for a real protagonist.
      if (!m.possessive && m.locative) locative = true
    }
    if (spoke) lean.character += 3            // speaksAt, 99.5% precision
    if (dearPoor) lean.character += 2         // 84 / 0
    if (e.speakerTurns.has(turn)) lean.character += 3   // "I am X", same bar as a speech tag
    // Weight 1, deliberately below every other signal here. At 3 (matching speech) several
    // genuinely correct characters with thin evidence tied or flipped; at 1, all five confirmed
    // place mistypings this exists for still resolve correctly and zero real characters flip.
    if (locative) lean.location += 1
    // `possessive` contributes nothing per turn — it is scored below from the ACCUMULATED count,
    // because a boolean throws away the difference between a character with 3 possessives and a
    // place with 1 across 15 mentions.
  }

  if (headType) return { type: headType, lean, profile }

  // Usage pattern only decides when nothing names the kind outright; otherwise the attributive test
  // suppressed real locations.
  if (isAttributive(profile)) return { type: null, lean, profile }

  // Places, ships and nations own things constantly, so once is not evidence; twice reliably is.
  if (profile.possessive >= POSSESSIVE_MIN) lean.character += 3
  // A parsed leading title ("Commander Thane") is already on the entity.
  if (e.hasTitle) lean.character += 3
  // Resolved gender is a person-detector we already run. Concluding an entity is "she" IS the claim
  // that it is a character, and the pronoun evidence behind it needed a 2:1 majority over at least
  // two sentences — stricter than most rules here. `m`/`f` only: an organisation takes "its"
  // ("the Empire... its forces"), so neuter is for attribution, never for typing.
  if (e.gender === 'm' || e.gender === 'f') lean.character += 3

  let best = null, bestScore = 0, tied = false
  for (const [t, v] of Object.entries(lean)) {
    if (v > bestScore) { best = t; bestScore = v; tied = false }
    else if (v === bestScore && v > 0 && t !== best) tied = true
  }
  if (tied || bestScore < THRESHOLD) return { type: null, lean, profile }
  return { type: best, lean, profile }
}
