// src/lexicon/titles.js  (data, carried over from text-entity-tracker/lexicon/titles.js)
//
// Forms of address (candidateIndex.js strips these from names) and the head-noun test for typing a
// span as a character (typing.js's TITLE_HEAD).
//
// MALE_TITLES/FEMALE_TITLES/NEUTRAL_TITLES declared first, TITLES is their union — don't add a
// title directly to TITLES, it needs a gender tag (or NEUTRAL_TITLES) too.
//
// Gender lives here rather than centrally because ROLE_NOUN (people.js) reuses a third of these
// words verbatim and imports the tags instead of re-declaring them.
//
// Bar for gendered vs. neutral: would BARE use of the word reliably signal gender in a story?
// Fiction uses `knight`/`master`/`priest`-type words for either gender without switching words;
// `king`/`duke` always switch to a different word (`queen`/`duchess`). The first group is neutral
// even when its marked opposite (`mistress`/`priestess`) stays confident.
export const MALE_TITLES = new Set(`mr mister sir sire messrs esq uncle father brother monk
abbot king emperor tsar czar sultan prince archduke duke marquis marquess
earl count viscount baron lord dauphin don capo`.split(/\s+/))

export const FEMALE_TITLES = new Set(`mrs ms miss missus madam madame maam dame aunt mother sister
mistress abbess priestess nun matron queen empress princess archduchess duchess marchioness
countess viscountess baroness lady saintess heroine`.split(/\s+/))

// Gender-free by convention (captain, mayor, archmage) or by the bar above (knight, priest...).
// Some are ordinary nouns too (`boss`, `elder`), but stripping only fires on a Title Case span, so
// "Boss Battle" is safe. `mate` stays out — still ambiguous even capitalised.
// lt/col/gen/sgt/capt alongside their full forms: without an abbreviation, "Lieutenant Data" and
// "Lt Data" normalize to different keys ("data" vs "lt data") and never merge — found live once
// split (candidatePool.js, IDENTITY.md Case 5) made stale entities stop riding on whatever they
// happened to fuse into early. Not a guess at which abbreviations are worth adding: all five are
// already in `grammar.js`'s SENTENCE_ABBR, so the codebase already expects them in real prose for
// sentence-boundary detection — same evidence, applied here too. The other NEUTRAL_TITLES ranks
// (cmdr/adm/maj/brig/etc.) have no such confirmation and are left alone.
const NEUTRAL_TITLES = `
  dr doctor prof professor principal master saint st mt ft
  reverend bishop archbishop cardinal priest deacon prior oracle

  emir sheikh shah khan pharaoh squire knight regent consort heir

  captain capt lieutenant lt colonel col general gen sergeant sgt corporal private ensign commander
  commodore admiral marshal brigadier major

  boss chief chieftain headman elder overseer foreman warden steward seneschal
  castellan magistrate constable sheriff deputy quartermaster bosun underboss
  warchief warlord

  president premier chancellor minister senator ambassador envoy consul
  commissioner councillor councilor advisor adviser
  mayor governor prefect tribune praetor archon doge burgomaster

  guildmaster grandmaster archmage magus sage seer shaman druid paladin templar
  inquisitor herald executioner hero
`.trim().split(/\s+/)

// Dropped only when followed by something, so a bare "Captain" still survives. Grouped by source —
// a guild's Guildmaster and a crew's Quartermaster name people the same way "Captain" does.
export const TITLES = new Set([...MALE_TITLES, ...FEMALE_TITLES, ...NEUTRAL_TITLES])

// The three parts partition TITLES — a word in two of them is a stale reclassification, not a valid
// double-membership.
for (const w of MALE_TITLES) {
  if (FEMALE_TITLES.has(w)) throw new Error(`lexicon/titles.js: '${w}' is tagged both male and female`)
  if (NEUTRAL_TITLES.includes(w)) throw new Error(`lexicon/titles.js: '${w}' is in both MALE_TITLES and NEUTRAL_TITLES`)
}
for (const w of FEMALE_TITLES) {
  if (NEUTRAL_TITLES.includes(w)) throw new Error(`lexicon/titles.js: '${w}' is in both FEMALE_TITLES and NEUTRAL_TITLES`)
}

// Considered and dropped: `warrant` (needs "officer"), `secretary`/`delegate` (never precede a name
// in fiction), `champion` (weak, and "Champion Hill" is a place), `apprentice`/`acolyte` (nobody's
// addressed as "Apprentice Bob"), `heir`/`consort`/`regent` (states, not forms of address).

// Titles that can't stand alone — `Mr`/`Dr` name nobody without someone attached. The rest of TITLES
// stays a candidate alone ("the Count" is Dracula throughout) and the surfacing threshold decides.
// Address forms (`Madame`, `Sire`) are the exception even alone — standing alone is what makes them
// vocative, not referential.
export const BOUND_TITLES = new Set(`mr mrs ms miss mister missus messrs dr prof st mt ft esq
sir sire madam madame maam dame`.split(/\s+/))

// High value for anime/JP-flavoured settings, where the honorific is part of nearly every mention.
export const HONORIFICS = /(?:[-‑]?(?:san|sama|sensei|kun|chan|senpai|sempai|dono|shi|tan))$/i

// Audited for AMBIGUITY, not frequency — a word is out if it describes an ordinary object as
// readily as the category, however often it fires.
export const TITLE_HEAD = /^(?:queens?|kings?|princes?|princess(?:es)?|lords?|ladies|lady|dukes?|duchess(?:es)?|barons?|baroness(?:es)?|counts?|countess(?:es)?|emperors?|empress(?:es)?|masters?|mistress(?:es)?|captains?|commanders?|generals?|knights?|saints?|priests?|priestess(?:es)?|witch(?:es)?|warlocks?|sages?|elders?|chiefs?|chieftains?|warchiefs?|khans?|sultans?|hunters?|slayers?)$/i
