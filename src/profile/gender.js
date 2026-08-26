// src/profile/gender.js
//
// Pronoun evidence folded into a per-entity verdict, and the one read-time filter that depends on
// it.
//
// Never an input to detection. Gender exists so a nameless sentence ("She wore a white coat") can
// be attached to the right character; typing then reads the conclusion, because deciding an entity
// is "she" IS deciding it is a character.

/**
 * A 2:1 majority over at least two sentences before committing. Stricter than most rules here,
 * which is why typing weights it as heavily as a possessive or a speech tag.
 *
 * `n` is neuter — an entity the prose calls "it". Needed because a wyvern, a droid or a creature
 * loses every pronoun-attributed trait otherwise, and it is a POSITIVE class rather than "not male
 * and not female": binding "it" to anything merely unresolved would hand a dummy subject ("It was
 * cold") to whichever person happened to be nearby.
 *
/**
 * A gendered title settles gender outright — unless the story disagrees overwhelmingly.
 *
 * The override is normally right: a title is vocabulary, not inference. But it was absolute, and
 * measured on the corpus that loses to nothing: one entity is addressed as "Lord Doran" nine times
 * while carrying 35 unanimous female pronoun credits, and shipped as male. A contradiction that
 * lopsided is not a gendered title being informative, it is two identities sharing a name.
 *
 * So the conflict resolves to UNRESOLVED rather than to the pronouns: with the evidence this
 * divided, neither answer is worth asserting, and unresolved is the safe state everywhere
 * downstream — it withholds a type signal rather than inventing one, and lets the trait filter
 * keep everything rather than dropping half of it against the wrong verdict.
 */
const CONTRADICTION_RATIO = 3
const CONTRADICTION_FLOOR = 6

/**
 * One strong, uncontradicted observation, for an entity already established as a person.
 *
 * The 2:1 majority normally needs two observations. That floor is not protecting characters —
 * measured, a single non-`carry` credit agrees with what the story eventually settles on 98% of the
 * time. It is protecting everything ELSE: dropping the floor outright genders 112 entities of which
 * only 10 are characters, and since a resolved gender adds +3 to the character lean, gendering that
 * population is how junk becomes suggestible.
 *
 * So the floor is lifted only where gender cannot manufacture a person, because something
 * gender-free already established one: a speech tag, repeated possessives, a parsed title. Measured
 * across six transcripts: 9 characters settle earlier (median 2 turns, one of them 61), 4 more
 * settle at all, and ZERO non-characters gain a gender.
 *
 * `carry` credits are excluded (`sm`/`sf` count the rest). It is the one rule still wrong often
 * enough — 15% after two gates — that a single one of them should not decide anything.
 */
function loneStrongCredit(tally) {
  const m = tally?.m ?? 0, f = tally?.f ?? 0
  if ((tally?.sm ?? 0) >= 1 && f === 0) return 'm'
  if ((tally?.sf ?? 0) >= 1 && m === 0) return 'f'
  return null
}

/**
 * @param {boolean} [opts.characterSignal]  the entity is already known to be a person by something
 *   that owes nothing to gender. Lets one observation settle what normally needs two.
 */
export function settleGender(fromTitle, tally, { characterSignal = false } = {}) {
  if (fromTitle === 'm' || fromTitle === 'f') {
    const mine = tally?.[fromTitle] ?? 0
    const other = tally?.[fromTitle === 'm' ? 'f' : 'm'] ?? 0
    if (other >= CONTRADICTION_FLOOR && other > mine * CONTRADICTION_RATIO) return null
    return fromTitle
  }
  return resolveGender(tally) ?? (characterSignal ? loneStrongCredit(tally) : null)
}

/**
 * Pronoun evidence folded into a verdict: a 2:1 majority over at least two sentences. Stricter
 * than most rules here, which is why typing weights it as heavily as a possessive or a speech tag.
 * @param {{m: number, f: number, n: number}|null} tally
 * @returns {'m'|'f'|'n'|null}
 */
export function resolveGender(tally) {
  if (!tally) return null
  const m = tally.m ?? 0, f = tally.f ?? 0, n = tally.n ?? 0
  if (m > (f + n) * 2 && m >= 2) return 'm'
  if (f > (m + n) * 2 && f >= 2) return 'f'
  if (n > (m + f) * 2 && n >= 2) return 'n'
  return null
}

/**
 * Traits whose source sentence agrees with the entity's settled gender, most-attested first.
 *
 * A trait carries the pronoun class of the sentence it came from. If the entity later resolves to
 * something else, that trait was about somebody else — measured case: Thaddeus accumulated
 * `{m: 53, f: 14}` and a set of `emerald eyes` belonging to Tuesday, whose name is eaten by the
 * stopword list and whose sentences therefore read as nameless.
 *
 * Applied at READ time, not at write: gender firms up over many turns, so a trait attributed in
 * turn 3 may only become recognisably wrong at turn 20. Traits from a sentence with no pronoun at
 * all are always kept — there is nothing to disagree with.
 *
 * Only male-vs-female is a contradiction. Neuter is not the opposite of either: prose calls the
 * same creature `its claws` in one line and `he` in the next, and treating that as a conflict
 * dropped the frost-beast's fur, the dragon turtle's ancient eyes and Korrath's claws — 6 of 9 drops
 * were this, against 1 real fix.
 *
 * @param {Record<string, {count: number, from: string|null}>} traits
 * @param {'m'|'f'|'n'|null} gender
 * @returns {string[]}
 */
export function consistentTraits(traits, gender) {
  const human = c => c === 'm' || c === 'f'
  const entries = Object.entries(traits ?? {})
  const kept = human(gender)
    ? entries.filter(([, t]) => !human(t.from) || t.from === gender)
    : entries
  return kept.sort((a, b) => b[1].count - a[1].count).map(([text]) => text)
}
