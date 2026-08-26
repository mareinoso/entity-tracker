// src/lexicon/speech.js  (data, carried over from text-entity-tracker/lexicon/speechLexicon.js)
//
// Speech verbs, defined once — three files had grown their own copy before, the same drift the
// appearance lexicon had.
//
// The split is the point, not the convenience. Some verbs only ever take a speaker; others take a
// plain complement just as readily, and treating the two alike is what made "Instantly I began to
// extricate myself" read as tagged speech.
//
//   group      alone?   why
//   SAY        yes      a subject that `whispered` is speaking, full stop
//   SAY_AMBIG  no       "began to climb", "continued down the path", "laughed at the joke" —
//                       needs a quoted line nearby before it counts as speech
//   SAY_LOUD   no       same shape as SAY_AMBIG (needs a quote nearby), but ALSO excluded from
//                       SAY_ANY — see its own comment below for why
//
// Consumers pick the pair that suits them: speech DETECTION wants the distinction (a false
// speaker corrupts a surfacing signal), while "how did they say it" phrasing does not, because
// there the verb is only a frame for the adverb that follows.

/**
 * Speech-exclusive. Safe to fire on its own.
 *
 * `speaks`/`exclaims`/`remarks`/`stammers`/`drawls`/`retorts` added alongside their already-listed
 * past tense — a systematic tense-pairing audit found these six missing their present-tense twin
 * (`spoke` had no `speak(s)` at all). Not new vocabulary: the codebase already trusted the word,
 * this only adds the inflection it was missing.
 */
export const SAY = `said|says|asked|asks|replied|replies|answered|answers|whispered|whispers|muttered|mutters|murmured|murmurs|shouted|shouts|exclaimed|exclaims|remarked|remarks|stammered|stammers|drawled|drawls|retorted|retorts|spoke|speaks`

/**
 * Also take a non-speech complement. Require corroborating quotes before trusting these.
 *
 * `observes`/`declares`/`insists`/`protests`/`breathes`/`hisses`/`barks`/`counters`/`agrees`/
 * `argues` are the same tense-pairing gap as `SAY` above, just for this tier's existing entries —
 * completing a word family the codebase already trusted here, not adding a new one, so they stay
 * safe for every existing `SAY_AMBIG` consumer including `SAY_ANY`.
 */
export const SAY_AMBIG = `cried|cries|observed|observes|added|adds|continued|continues|began|begins|snapped|snaps|growled|growls|laughed|laughs|sighed|sighs|repeated|repeats|declared|declares|insisted|insists|protested|protests|admitted|admits|explained|explains|demanded|demands|warned|warns|breathed|breathes|hissed|hisses|barked|barks|countered|counters|agreed|agrees|argued|argues`

/**
 * Real, new dialogue-tag verb families — `shriek(s/ed)`, `scream(s/ed)`, `snarl(s/ed)`,
 * `roar(s/ed)`, `bellow(s/ed)`, `gasp(s/ed)`, `sneer(s/ed)`, `wail(s/ed)`, `yell(s/ed)`,
 * `respond(s/ed)`, `announce(s/d)` — each confirmed via a real dialogue-tag-shaped hit in the RP
 * corpus (`"Ferro shrieks"`, `"Odile... yells"`, `"Brant hisses"`), not just plausible-sounding.
 *
 * Kept OUT of `SAY_ANY` on purpose, unlike `SAY_AMBIG` above — most of this family doubles as a
 * plain loud NON-speech sound (an engine screams, the wind wails, thunder roars), which is exactly
 * wrong for `SAY_ANY`'s other consumers: `referent.js`'s `animacyOf` treats "a SAY_ANY verb
 * anywhere in the sentence" as animacy evidence with NO adjacency requirement at all, and
 * `characterTraits.js` uses it as a loose adverb frame — neither has `speaksAt`'s adjacency+quote-
 * gating protection. Confirmed live: adding this family to `SAY_AMBIG` (and therefore `SAY_ANY`)
 * made `"An Imperial TIE fighter screamed overhead"` score as animate and get proposed as a
 * referent — a fighter jet, not a person. `speaksAt`'s own `MAYBE` tier (`speech.js`) checks this
 * list directly (still quote-gated, still adjacency-shaped, so still safe there); nothing else
 * should.
 *
 * Deliberately NOT added at all, any tier: the long tail of pure action/gesture verbs (`nods`,
 * `steps`, `glances`, `watches`, `leans`, `approaches`, `notices`, `gestures`, ...) that sit in the
 * identical textual position but describe a body-language beat before a SEPARATE line of dialogue,
 * not the speech act itself — see `text-entity-tracker/IDENTITY.md`'s locative-preposition section
 * for the corpus check that ruled these out.
 */
export const SAY_LOUD = `shrieked|shrieks|screamed|screams|snarled|snarls|roared|roars|bellowed|bellows|gasped|gasps|sneered|sneers|wailed|wails|yelled|yells|responded|responds|announced|announces`

/** Both, for callers that only need the verb as a frame — "said angrily". Deliberately excludes
 * `SAY_LOUD` — see its own comment for why. */
export const SAY_ANY = `${SAY}|${SAY_AMBIG}`
