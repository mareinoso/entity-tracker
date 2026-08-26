// src/profile/score.js
//
// How much does this paragraph DESCRIBE this entity? Ranks which paragraphs are worth keeping as
// excerpts. Nothing else reads the number, so cheap and approximate is fine.
//
// Scores the SENTENCES the entity is in or owns, not a character window around each mention. A
// window straddles clause and speaker boundaries freely: on "Marguerite walked to Paris. 'It is
// far,' said Marguerite, and Paris said nothing to her." the window around "Paris" is the entire
// paragraph, so Paris would collect every word written about Marguerite.

import { DESCRIBE_SCORERS } from './describe.js'
import { headTypeOf } from './type.js'

// Everything is untyped early on, so something has to run. Character, because candidates run ~6:1
// person-to-place — and it beats scoring nothing even on places, where the shared appositive
// patterns still fire 23% of the time. An assumption; change this line, not the scorers.
const DEFAULT_TYPE = 'character'

/**
 * Sentences that speak for this key: the ones mentioning it, plus the ones attribution assigned to
 * it. The union matters — a name's own sentence is fair even when ownership was ambiguous, and an
 * owned sentence counts even when the name itself is absent ("She wore a white coat").
 */
function sentencesFor(reading, mentions, attribution, key) {
  const idx = new Set()
  for (const m of mentions) if (m.key === key) idx.add(m.sentence)
  for (const d of attribution.descriptors) if (d.key === key) idx.add(d.sentence)
  for (const [i, s] of attribution.sentences.entries()) if (s.owner === key) idx.add(i)
  // Continuation: description routinely lands in the sentence AFTER the name — "Silver came up the
  // ladder. He was very tall." Ownership refuses that sentence unless pronoun gender resolves,
  // which it usually cannot this early, and refusing it cost 17 points of coverage against the old
  // character window. Only taken when the next sentence mentions nobody else, so it cannot steal
  // another character's text — which is the failure the window had.
  const mentioned = new Set()
  for (const m of mentions) mentioned.add(m.sentence)
  for (const d of attribution.descriptors) mentioned.add(d.sentence)
  for (const i of [...idx]) {
    const next = i + 1
    if (next < reading.sentences.length && !mentioned.has(next)) idx.add(next)
  }
  return [...idx].sort((a, b) => a - b)
}

/**
 * @returns {Record<string, number>} key -> this paragraph's description score for it
 *
 * The entity's sentences are JOINED and scored once, not scored individually and maxed. Scoring per
 * sentence and taking the best was measured clearly worse than a character window (held-out
 * people-vs-places separation 13 -> 10, coverage 61% -> 44%): the scorers cap each lexicon at 3-4
 * hits, which a 380-character window can reach and a single sentence almost never can, so
 * per-sentence scoring throws away the corroboration the caps were tuned for.
 */
export function scoreParagraph(reading, mentions, attribution) {
  const keys = new Set([...mentions.map(m => m.key), ...attribution.descriptors.map(d => d.key)])
  const out = {}
  for (const key of keys) {
    const idx = sentencesFor(reading, mentions, attribution, key)
    if (!idx.length) continue
    const joined = idx.map(i => reading.sentences[i].text).join(' ')
    const first = mentions.find(m => m.key === key && idx.includes(m.sentence))
      ?? attribution.descriptors.find(d => d.key === key && idx.includes(d.sentence))
    // `after` is the text following the first mention, for the appositive tests ("X, the …",
    // "X was a …").
    const end = first ? (first.offset ?? first.at) + (first.surface?.length ?? 0) : null
    const after = end == null ? '' : reading.text.slice(end, end + 90)
    // Typed by the span's own head noun where it has one. The old package used the entity's
    // accumulated type here, which made an excerpt score depend on when it happened to be
    // computed; a head noun is the same signal that DECIDES the type anyway, and it is stable.
    const scorer = DESCRIBE_SCORERS[headTypeOf(first?.surface ?? key) ?? DEFAULT_TYPE]
      ?? DESCRIBE_SCORERS[DEFAULT_TYPE]
    const score = scorer(joined, after)
    if (score > 0) out[key] = score
  }
  return out
}
