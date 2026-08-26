// src/lexicon/world.js  (data, carried over from text-entity-tracker/lexicon/placesOrgsItems.js)
//
// Non-person entity vocabulary. Sibling to appearanceLexicon.js's person vocab, but for the other
// three candidate types: what a span's own head noun says it is (typing.js's PLACE_HEAD/ORG_HEAD),
// and what a passage's surrounding words say it's describing (describeScore.js's per-type scorers).

// ---------------------------------------------------------------------------- head nouns (typing)

// Dropped from an earlier draft: `fist` (Jimmy's fist), `band`, `house`, `chapter`, `division`,
// `corps` from organizations; `watch` (a timepiece) and `ward` from places.
export const PLACE_HEAD = /^(?:streets?|roads?|avenues?|lanes?|boulevards?|squares?|plazas?|bridges?|gates?|towers?|castles?|keeps?|manors?|halls?|inns?|taverns?|temples?|shrines?|academies|academy|institutes?|universit(?:y|ies)|schools?|hospitals?|prisons?|markets?|harbou?rs?|docks?|districts?|quarters?|provinces?|kingdoms?|realms?|cit(?:y|ies)|towns?|villages?|valleys?|mountains?|rivers?|lakes?|forests?|woods?|deserts?|plains?|islands?|bays?|seas?|oceans?|peaks?|ridges?|canyons?|palaces?|fortress(?:es)?|citadels?|caverns?|caves?|mesas?|outposts?|camps?|ruins?|cent(?:er|re)s?|bases?|stations?|spires?|vaults?|sanctums?|arenas?|libraries|library|gardens?)$/i
export const ORG_HEAD = /^(?:guilds?|alliances?|orders?|collectives?|compan(?:y|ies)|clans?|legions?|empires?|federations?|councils?|senates?|cults?|brotherhoods?|sisterhoods?|factions?|corporations?|syndicates?|cartels?|tribes?|armies|army|regiments?|squads?|agencies|agency|bureaus?|crews?|covens?|circles?)$/i
// Closed weapon/armor/wearable/relic noun class — bounded the same way PLACE_HEAD/ORG_HEAD are
// (a large but finite vocabulary), not the open-ended "occupations, invented-race nouns" class
// README.md §10 rejects word-listing. Used to keep a possessed item ("Zhukan's Nodachi") from
// competing with its owner's own name for a canonicalise key — see IDENTITY.md.
export const ITEM_HEAD = /^(?:swords?|blades?|daggers?|knives|knife|katanas?|nodachis?|rapiers?|sab(?:er|re)s?|axes?|hammers?|maces?|spears?|lances?|halberds?|glaives?|scythes?|claymores?|bows?|crossbows?|whips?|staffs?|staves|wands?|rods?|shields?|armou?rs?|helms?|helmets?|gauntlets?|cloaks?|robes?|capes?|mantles?|boots?|rings?|amulets?|talismans?|pendants?|necklaces?|bracelets?|circlets?|crowns?|orbs?|tomes?|grimoires?|scrolls?|potions?|elixirs?|vials?|phials?|relics?|artifacts?|trinkets?|charms?)$/i

// Region/containment prepositions only — `of`/`in`/`across`/`throughout`/`within`. Directional and
// proximity words (`at`/`toward(s)`/`over`/`near`/`into`) were tried and dropped: checked directly
// against the real corpus, `"at"` alone is 78-of-80 hits on a PERSON ("glared at Senna"), not a
// place — a directional word describes approaching someone as often as approaching somewhere, so
// it is evidence for the wrong thing, not weaker evidence for the right one. `of`/`in` are not
// perfectly clean either (real people get "a sketch OF Ferro") but the discriminator for THAT
// ambiguity is the noun BEFORE the preposition, a classifier that does not exist here.
//
// Read by two consumers — the location lean (src/profile/type.js) and the bare-token usage signal
// (src/lexis.js). One definition, not two that can drift.
export const LOCATIVE = /\b(?:of|in|across|throughout|within)\s*$/i

// ---------------------------------------------------------------------------- description scoring

export const LOCATION_FORM = /\b(street|streets|road|gate|gates|wall|walls|tower|towers|roof|roofs|door|doors|window|windows|courtyard|square|hall|halls|corridor|stair|stairs|bridge|harbour|harbor|dock|quay|market|shop|shops|inn|tavern|church|temple|chapel|castle|keep|fort|ruins?|village|town|city|hamlet|district|quarter|building|buildings|house|houses|room|rooms)\b/gi
export const LOCATION_TERRAIN = /\b(hill|hills|mountain|mountains|valley|river|stream|lake|sea|coast|cliff|cliffs|forest|wood|woods|trees|marsh|swamp|desert|plain|plains|island|shore|beach|cave|caverns?|peak|ridge|slope|meadow|field|fields)\b/gi
export const LOCATION_SCALE = /\b(vast|huge|enormous|immense|sprawling|narrow|wide|deep|steep|tiny|cramped|towering|ancient|crumbling|ruined|abandoned|bustling|crowded|deserted|silent|dim|shadowed|gloomy|lit|walled|fortified|hidden|remote)\b/gi
// "north of", "lies beyond", "stood at the edge of" — siting a place is describing it.
export const LOCATION_SITING = /\b(north|south|east|west|beyond|below|above|behind|outskirts|edge|centre|center|midst|border|foot|summit|mouth|bank)\s+of\b|\b(?:lies|lay|stood|stands|sits|sat|rose|nestled|perched|situated)\b/gi

export const ORG_BODY = /\b(members?|ranks?|order|guild|company|house|clan|tribe|band|crew|army|legion|council|court|senate|cult|brotherhood|sisterhood|chapter|faction|allies|rivals?|enemies)\b/gi
export const ORG_POWER = /\b(led|leader|leads|commanded|commands|rules?|ruled|founded|serves?|served|sworn|oath|loyal|loyalty|betrayed|controls?|governs?|answers? to|banner|sigil|colors|colours)\b/gi
export const ORG_AIM = /\b(seeks?|sought|aims?|purpose|mission|cause|creed|doctrine|law|laws|tribute|trade|war|feud|alliance|treaty|territory|influence|power|wealth)\b/gi

export const ITEM_MATTER = /\b(steel|iron|silver|gold|bronze|copper|wood|wooden|stone|leather|cloth|silk|glass|crystal|bone|obsidian|blade|edge|hilt|haft|pommel|shaft|chain|links?|inlaid|engraved|carved|forged|wrought|woven|set with)\b/gi
export const ITEM_STATE = /\b(sharp|dull|notched|chipped|rusted|worn|polished|gleaming|tarnished|cracked|broken|pristine|heavy|light|balanced|ornate|plain|crude|fine|ancient|new)\b/gi
export const ITEM_DOES = /\b(wielded|carried|bore|drew|swung|struck|cut|pierced|glowed|burned|hummed|enchanted|cursed|blessed|magic|magical|power|effect|grants?|heals?|protects?)\b/gi
