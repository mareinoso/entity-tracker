// src/lexicon/grammar.js  (data, carried over from text-entity-tracker/lexicon/grammar.js)
//
// Closed-class function words — structural words several modules test against independently.
//
// PREPOSITION/AUXILIARY/CONJUNCTION/PRONOUN_TOK/RELATIVISER/DETERMINER declared first, STOPWORDS is
// their union plus a residual — never add a word straight into STOPWORDS, add it to the list it
// belongs to (or the residual) instead. The six stay pipe-separated strings, not Sets, because
// referent.js composes them into one regex; STOPWORDS splits each on load.
//
// BARE_VERB is excluded from the union — content verbs (hold/stand/walk...) that stop referent.js's
// noun-phrase walk, not function words, and several could be a surname.
//
// AUX_BE (speech.js) and AUXILIARY (referent.js) look like one list duplicated; they aren't. AUX_BE
// catches the passive around a speech verb and needs `got`/`gets`; AUXILIARY ends a noun-phrase walk
// and needs the modals that make no sense in a passive check. Kept as two lists.

// CLOSED is the point (referent.js's noun-phrase walker) — enumerating what's genuinely finite is
// what let the open person-noun class fall out safely, instead of grabbing `under`/`attention` by
// mistake the way an earlier no-list attempt did.
export const PREPOSITION = `about|above|across|after|against|along|amid|among|around|as|at|before|behind|below|beneath|beside|besides|between|beyond|by|despite|down|during|except|for|from|in|inside|into|near|of|off|on|onto|out|outside|over|past|since|through|throughout|to|toward|towards|under|underneath|until|up|upon|via|with|within|without`
export const AUXILIARY = `is|are|was|were|be|been|being|has|have|had|do|does|did|done|can|could|will|would|shall|should|may|might|must|am`
// Added after each produced a wrong phrase: "the stars and the" (conjunction), "a man You stand"
// (pronoun), "the Force bind the very fabric" (bare verb), "a dead man who you think" (relativiser).
export const CONJUNCTION = `and|or|but|nor|yet|so|then|than`
export const PRONOUN_TOK = `i|you|he|she|it|we|they|him|them|me|us|myself|yourself|himself|herself|itself|themselves`
export const RELATIVISER = `who|whom|whose|which|that|where|when|while|because|if|though|although|until|unless|as`
// Open class, can't be listed — only the handful that actually appeared as phrase-runners in the
// corpus. The animacy score rejects a bad phrase; this just stops it running on.
export const BARE_VERB = `bind|hold|stand|sit|move|turn|walk|look|watch|seek|make|take|give|feel|seem|keep|let|find|know|think|say|tell|come|go|get|put|run|leave|bring|wear|carry|reach|step`
export const DETERMINER = `the|a|an|another|some|one|other|this|that|these|those|his|her|its|their|our|your|my`

// A sentence-initial stopword glues itself to whatever follows ("Where's Black Dog" hides a real
// character) — this is what trimLeadingStopwords/isNoise refuse.
//
// Residual is everything not already in the six lists: weekdays/months/numbers/reported-speech
// verbs, plus a discourse cluster (`now`/`oh`/`thank`/`hush`/`alas`...) found by scanning what
// actually opens a sentence or paragraph across the corpus (sentence-initial-scan.mjs) rather than
// guessed. Corpus-checked before adding — zero ground-truth entities damaged
// (stopword-expansion.mjs, kept as a record). Not filtered by dialogue vs. narration: this package
// has no notion of the app's `"` speech delimiter.
const STOPWORD_RESIDUAL = `
ah alas all almost already any april asked august autumn both called chapter day december
each eight enough even evening every february few finally first five four friday good hardly
here how hush instead january july june just least less let many march maybe meanwhile monday
more morning most much nay nearly never night nine no none not nothing november now october oh
only perhaps please pray quite replied said saturday says scarcely second september seven
several six somehow something spring still suddenly summer sunday ten thank there third three
thursday thus today told tomorrow tonight tuesday two very wednesday what why winter yes
yesterday
`.trim().split(/\s+/)

export const STOPWORDS = new Set([
  ...PREPOSITION.split('|'), ...AUXILIARY.split('|'), ...CONJUNCTION.split('|'),
  ...PRONOUN_TOK.split('|'), ...RELATIVISER.split('|'), ...DETERMINER.split('|'),
  ...STOPWORD_RESIDUAL,
])

// Singular in form, plural in meaning ("a couple who were..."), so no suffix test catches them.
export const COLLECTIVE = /^(?:couples?|families|family|groups?|crowds?|parties|party|teams?|crews?|bands?|packs?|herds?|flocks?|swarms?|hordes?|mobs?|throngs?|gangs?|squads?|troops?|nations?|tribes?|clans?|councils?|armies|army|companies|company|hosts?|legions?)$/i
// Plurals the -s test can't see (`men`, `women`, `elves`, `dwarves`...).
export const IRREGULAR_PLURAL = /^(?:men|women|children|people|folk|elves|dwarves|wives|spouses|feet|teeth|geese|mice)$/i

// A be-form before a speech verb means the passive: "Ophira was asked" is the one addressed, not the
// one speaking. See the file header for why this isn't AUXILIARY.
export const AUX_BE = /\b(?:was|were|is|are|be|been|being|had|has|have|got|gets)\b/i

// Abbreviations whose period doesn't end a sentence.
export const SENTENCE_ABBR = /\b(?:mr|mrs|ms|dr|st|prof|lt|col|gen|sgt|capt|jr|sr|vs|etc|i\.e|e\.g)\.$/i
