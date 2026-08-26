// src/lexicon/openers.js  (data, carried over from text-entity-tracker/lexicon/openers.js)
//
// Words that open a sentence and glue to the name that follows — "Help Mia", "Hopefully Thaddeus".
// A cold-start PRIOR, not a replacement for the evidence rule: a story's first turns have no
// accumulated history, which is exactly when this pollution reaches a card title.
//
// Hand-written, deliberately — deriving it from 6660 turns produced 16 words, several of them real
// name components (`Seward's`, `Sergeant`, `Ashgrave`), because chapter headings and title-case runs
// look identical to sentence-initial gluing at this corpus size. The justification here is CATEGORY
// (imperatives, participles, discourse markers, subordinators), checkable by someone else — "words
// I saw glued to a name" isn't.
//
// SAFETY: this only ever ARGUES for a trim. `isStrongHead` overrides it, so a character named Chase
// or Grant is still caught by the evidence that they open spans mid-sentence — two guards, not one,
// which is also why plausible given names (will, mark, grant, chase, hunter, grace, hope, jack...)
// are kept out of the list itself rather than relied on being overridden. `said` belongs with them —
// it glues to names constantly but is also a given name — and stays out for the same reason.

const WORDS = `
help take look go come stop wait tell ask give get find keep let make put try turn watch leave
bring call follow move open close pull push run send show start stay talk think use check grab
head listen walk attack defend search enter exit climb jump throw drop pick read sit stand sleep
wake eat drink buy sell pay fight hide wear examine inspect approach greet reach touch say

carrying holding standing looking watching moving walking running taking going getting feeling
seeing hearing thinking trying turning entering leaving reaching keeping letting making putting
coming saying doing being having following pulling pushing opening closing waiting listening

hey alright hopefully thanks well okay anyway meanwhile suddenly finally perhaps maybe instead
however therefore besides still again soon presently eventually actually honestly seriously
unfortunately luckily surely certainly clearly obviously apparently probably possibly
then next later indeed truly frankly sadly thankfully evidently naturally undoubtedly admittedly
strangely curiously oddly notably importantly ultimately initially subsequently previously
additionally alternatively conversely incidentally generally typically usually normally
occasionally briefly lastly firstly secondly

because although though unless whether whereas despite besides moreover furthermore nonetheless
nevertheless regardless accordingly consequently otherwise likewise similarly
if when while since after before until once whenever wherever whereupon provided assuming as
`
// Discourse markers and subordinators are CLOSED classes, finished on purpose (last two groups
// above). Imperatives are OPEN and can never be complete — for verbs this list is a cold-start prior
// only, the `-ing`/`-ed` suffix test below does the real work, and the accumulated evidence rule
// carries the general case. `argue` is deliberately absent (so "General Vesna Thorne Arguing" still
// survives) rather than patched in for one corpus case.

export const SENTENCE_OPENERS = new Set(WORDS.trim().split(/\s+/))

// Inflected forms count — what glues to a name is usually conjugated ("Kade Rourke Enters"). Stripping
// is safe here because the list is verbs and discourse markers, not name-shaped words.
const STEMS = [/ing$/i, /ed$/i, /es$/i, /s$/i]
// Possessive comes off FIRST and separately — stripping all punctuation in one pass turns `Waite's`
// into `waites`, which the `-es` stem then reduces to `wait`, an opener — costing Treasure Island's
// `Harry Waite` half his name. A clitic is not an inflection.
const POSSESSIVE = /['’]s?$/

/** Is this word a known sentence-opener rather than part of the name it is glued to? */
export function isOpener(word) {
  const w = String(word ?? '').toLowerCase().replace(POSSESSIVE, '').replace(/[^\p{L}-]/gu, '')
  if (!w) return false
  if (SENTENCE_OPENERS.has(w)) return true
  return STEMS.some(re => re.test(w) && SENTENCE_OPENERS.has(w.replace(re, '')))
}
