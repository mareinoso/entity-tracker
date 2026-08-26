// src/lexicon/people.js  (data, carried over from text-entity-tracker/lexicon/people.js)
//
// Who counts as a person, by noun vocabulary — generic nouns, RP/fantasy roles, non-human kinds.
// Data the bystander and referent-proposal rules (referent.js) consult, not logic they contain.

import { KIN } from './appearance.js'
import { MALE_TITLES, FEMALE_TITLES } from './titles.js'

// Closed set on purpose — an open-ended occupation list is the cherry-picking failure again, and
// the generic half below carries almost all of it anyway.
export const PERSON_NOUN = `man|woman|men|women|boy|girl|lad|lass|fellow|gentleman|lady|person|stranger|figure|child|youth|soldier|guard|officer|servant|maid|sailor|priest|monk|merchant|beggar|rider|knight|nurse|driver|innkeeper|blacksmith|farmer|hunter|thief`

// `priest`/`monk`/`knight`/`lady` are gendered too, but tagged in titles.js instead — not repeated
// here. `nurse` stays untagged: gendered historically, neutral in modern usage, and unlike
// `waitress` there's no marked/unmarked pair to lean on.
export const MALE_PERSON = new Set(`man men boy lad fellow gentleman`.split(' '))
export const FEMALE_PERSON = new Set(`woman women girl lass maid`.split(' '))

// RP roles, written from general knowledge, deliberately generic — a list derived from the test
// set would measure nothing.
export const ROLE_NOUN = `warrior|fighter|mage|wizard|sorcerer|sorceress|witch|warlock|cleric|priestess|paladin|druid|bard|ranger|rogue|assassin|scout|spy|agent|captain|commander|lieutenant|sergeant|general|admiral|king|queen|prince|princess|emperor|empress|lord|noble|nobleman|noblewoman|matron|baron|duke|duchess|shaman|elder|chief|champion|mercenary|bandit|raider|pirate|smith|healer|alchemist|scholar|student|apprentice|master|mistress|teacher|slave|prisoner|captive|guardian|sentry|watchman|bartender|barkeep|cook|clerk|scribe|messenger|courier|acolyte|initiate|recruit|veteran|survivor|traveler|traveller|wanderer|pilot|engineer|mechanic|medic|doctor|operative|technician`
+ `|adventurer|companion|ally|rival|partner|guide|mentor|disciple|cultivator|samurai|ninja|shinobi|gladiator|barbarian|berserker|archer|swordsman|spearman|gunner|sniper|trooper|marine|cadet|squire|herald|envoy|ambassador|diplomat|magistrate|governor|steward|butler|maidservant|waitress|waiter|fisherman|miner|tracker|exorcist|inquisitor|templar|crusader|nun|abbot|oracle|seer|prophet|sage|artificer|tinkerer|inventor|professor|librarian|historian|dancer|singer|poet|thug|ruffian|outlaw|smuggler|gangster|foreman|overseer|warden|jailer|executioner|informant|courtesan|concubine|attendant|retainer|bodyguard|surgeon|apothecary|herbalist|scientist|researcher|nomad|settler|refugee|villager|townsfolk|commoner|peasant|noblewoman|heir|heiress`
+ `|craftsman|craftswoman|artisan|shopkeeper|storekeeper|innkeep|carpenter|mason|baker|butcher|brewer|tailor|seamstress|weaver|potter|cobbler|shoemaker|goldsmith|silversmith|gunsmith|swordsmith|armorer|armourer|jeweler|jeweller|banker|moneylender|lawyer|judge|constable|detective|watchman|gatekeeper|gardener|groom|stablehand|porter|dockworker|labourer|laborer|supplier|trader|peddler|hawker|barber|undertaker|midwife|physician|dentist|teacher|tutor|preacher|deacon|bishop|cardinal|monk|abbess|hermit|beggar|urchin|orphan|hag|crone|witchdoctor|shipwright|sailor|helmsman|navigator|quartermaster|boatswain|ferryman|coachman|courier|scribe|clerk|accountant|steward|chef|barmaid|hostess`
// `host` is out: already in COLLECTIVE ("a host of angels"), the group sense wins. `serving` is out
// because it's not a noun — it came from "serving girl", where `girl` is the head.

// A third of ROLE_NOUN is also in TITLES (king, duke, master, monk...) — gendered there, not here.
// What's left is the `craftsman`/`craftswoman` shape: the unmarked form (`sorcerer`, `waiter`,
// `warlock`) reads generic and stays untagged, only the marked form is confident. `witch` is the
// exception — fantasy-genre convention keeps it specifically female.
export const MALE_ROLES = new Set(`nobleman`.split(' '))
export const FEMALE_ROLES = new Set(`sorceress witch noblewoman waitress maidservant courtesan
concubine heiress craftswoman seamstress midwife hag crone barmaid hostess`.split(/\s+/))

// Non-human kinds — every setting invents its own, so this is only the common core.
export const KIND_NOUN = `elf|elves|dwarf|dwarves|orc|goblin|hobgoblin|kobold|troll|ogre|giant|halfling|gnome|drow|tiefling|dragonborn|dragonkin|dragon|wyrm|drake|demon|devil|fiend|angel|celestial|undead|zombie|skeleton|ghoul|wraith|specter|spectre|ghost|vampire|werewolf|lycan|beast|creature|monster|golem|construct|automaton|android|droid|robot|cyborg|alien|mutant|elemental|fae|fairy|faerie|nymph|centaur|minotaur|satyr|naga|lizardfolk|merfolk|siren|harpy|griffin|familiar|spirit|entity`
+ `|gnoll|bugbear|imp|succubus|incubus|revenant|lich|banshee|wisp|treant|dryad|sylph|salamander|homunculus|chimera|phoenix|basilisk|wyvern|manticore|sphinx|kraken|leviathan|behemoth|titan|jotun|oni|yokai|tengu|kitsune|beastman|beastfolk|beastkin|shifter|changeling|warforged|genasi|aasimar|firbolg|slime|ooze|mimic|shade|husk|abomination|horror|deity|god|goddess|avatar|clone|replicant|synth|drone|sentinel|hound|steed|mount|serpent|wolf|bear|hawk`

// Adjective forms of the common core above — "Dwarven", not "Dwarf", is the real corpus's own
// observed convention for a race-modifier in front of another noun. Only words whose adjective
// reads differently enough from the noun to be worth listing separately; where fiction just reuses
// the noun as its own modifier (`goblin`, `troll`, `zombie`) there's nothing to add here, KIND_NOUN
// already covers that spelling. Bounded the same way KIND_NOUN itself is bounded — the common core,
// not an attempt at every setting's invented race. Used only to decide when a capitalized
// `[kind-adjective][role/person-noun]` compound (`"Dwarven Blacksmith"`) should be classified as a
// referent instead of a name — see `extractCandidates.js` and IDENTITY.md's `KIND_NOUN` section.
export const KIND_ADJ = `dwarven|elven|elvish|orcish|gnomish|draconic|demonic|devilish|angelic|vampiric|lycan|fae|elemental`

// Lexically distinct pairs, no unmarked side to leave untagged. `sylph` dropped: classical lore has
// both male and female sylphs, "sylph-like" is poetic connotation, not a definitional fact.
export const MALE_KINDS = new Set(`incubus satyr god`.split(' '))
export const FEMALE_KINDS = new Set(`succubus nymph siren banshee dryad goddess`.split(/\s+/))

// A tagged word must be in its own source list and absent from titles.js's tags — repeating a
// title here would be the same-fact-twice risk this split exists to avoid.
const sourceWords = new Set([...PERSON_NOUN.split('|'), ...ROLE_NOUN.split('|'), ...KIND_NOUN.split('|')])
const allTagged = [
  ...MALE_PERSON, ...FEMALE_PERSON, ...MALE_ROLES, ...FEMALE_ROLES, ...MALE_KINDS, ...FEMALE_KINDS,
]
for (const w of allTagged) {
  if (!sourceWords.has(w)) throw new Error(`lexicon/people.js: '${w}' is gender-tagged but not in PERSON_NOUN/ROLE_NOUN/KIND_NOUN`)
  if (MALE_TITLES.has(w) || FEMALE_TITLES.has(w)) throw new Error(`lexicon/people.js: '${w}' duplicates a tag already in titles.js`)
}
const maleSet = new Set([...MALE_PERSON, ...MALE_ROLES, ...MALE_KINDS])
const femaleSet = new Set([...FEMALE_PERSON, ...FEMALE_ROLES, ...FEMALE_KINDS])
for (const w of maleSet) {
  if (femaleSet.has(w)) throw new Error(`lexicon/people.js: '${w}' is tagged both male and female`)
}

// KIN (appearanceLexicon.js) was never wired into the head list before — "an affectionate mother"
// wasn't a person as far as the referent proposal was concerned.
export const PERSON_NOUN_WIDE = `${PERSON_NOUN}|${ROLE_NOUN}|${KIND_NOUN}|${KIN}`
