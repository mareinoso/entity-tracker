// src/lexicon/appearance.js  (data, carried over from text-entity-tracker/lexicon/appearanceLexicon.js)
//
// Appearance vocabulary, defined once — describeScore.js and characterTraits.js used to keep
// hand-copied subsets that had already drifted apart.
//
// Each group answers two questions; read the table, not the imports, to know where a word lands.
// "bound" = only counts against a head noun. Word-level audit decisions (what got removed, gated,
// or kept, and why) are in README.md §9, not repeated here.
//
//   group       SCORE  TRAIT   why they differ
//   PART        yes    bound   prose reaches for "hands" when describing — but everyone has hands
//   GARMENT     yes    bound   the trait is "red coat", never "coat"
//   GROOMING    yes    bound   binds to hair — "cropped hair"
//   WORN_MARK   yes    YES     glasses, eyepatch: wearing one IS the departure
//   EXPRESSION  yes    no      transient — the moment, not the person
//   NOTABLE     yes    yes     a scar needs no qualifier
//   INHUMAN     yes    yes     nor do horns
//   COLOUR      bound  bound   unbound: 9% of person and 8% of place windows — no signal
//   NATURE      yes    bound   "the cold stone floor" is not a cold person
//   FIGURE_PART yes    bound   a waist is a part; "narrow waist" is the trait
//   FIGURE_FORM yes    yes     `buxom`, `lanky` are already the departure
//   BEAUTY      yes    yes
//   KIN         yes    yes
//
// Fragments are bare alternations — no \b, no group, no flags. Consumers wrap them. Each group is
// a CLOSED CATEGORY, not remembered examples.

// ---------------------------------------------------------------------------- body

// `hair(?:ed)?`: "a dark-haired woman" is as common as "dark hair", and `hair\b` cannot reach it.
export const HAIR = `hair(?:ed)?|curls?|locks|mane|braids?|plaits?|ponytails?|bangs|fringe|tresses`

// Plural only where a person has more than one — `noses`/`jaws`/`beards`/`chins`/`necks` plural is
// always a crowd or a corpse. `stubble` is facial hair, so it sits here, not in HAIR.
export const FACE = `eyes?|eyed|face|skin|complexion|features?|cheeks?|brows?|forehead|beard|moustache|stubble|lips?|chin|jaw|nose|ears?|neck|throat`

// Common action-narration parts only, not full anatomy (`torso`/`elbows`/`height` excluded — near
// zero in practice; `back`/`foot`/`chest` excluded — fire on places as readily as people).
// `figure`/`build`/`stature` are head nouns awaiting a qualifier, not FIGURE_FORM descriptions —
// standalone they yielded the non-trait "build". `muscles` is here, not FIGURE_FORM: see README.md
// §9's lexicon audit for why.
export const BODY = `hands?|arms?|legs?|fingers?|shoulders?|teeth|mouth|voice|body|figure|build|stature|muscles?`

// Parts, not descriptions — everyone has a waist, so bare `waist` is no more a trait than bare
// `nose`. Standalone these emitted "hip"; bound they give the real content, "narrow waist".
export const FIGURE_PART = `bosom|breasts|cleavage|waist|hips?|thighs?|midriff|navel`

/** Everything a person simply has. Worthless as a trait alone; the qualifier carries it. */
export const PART = `${HAIR}|${FACE}|${BODY}|${FIGURE_PART}`

// ---------------------------------------------------------------------------- worn

// One coat, one hat. Plural only where a person wears several (`rings`), the garment comes in
// pairs (`boots`, `gloves`), or it has paired parts (`sleeves`, `cuffs`).
export const GARMENT = `outfit|coat|cloak|robe|jacket|shirt|suit|dress|gown|blouse|sweater|jumper|waistcoat|vest|skirt|trousers|breeches|jeans|boots?|shoes?|sandals?|hat|cap|hood|gloves?|scarf|tie|necktie|collar|sleeves?|cuffs?|uniform|armou?r|apron|jewell?ery|rings?|necklace`

// Worn but not default — that's what makes these traits and the garments above not.
export const WORN_MARK = `glasses|spectacles|monocle|eyepatch|blindfold|veil|mask|masked|prosthetic`

export const GROOMING = `styled|braided|plaited|cropped|shaved|shorn|combed|brushed|trimmed|groomed|curled|tousled|dishevelled|disheveled|unkempt`

// For when no specific garment is named — "in ragged clothing". `clothes`/`dressed`/`clad` excluded:
// no more common near people than near places, and the garment noun they precede scores anyway.
export const WEAR_VERB = `wore|wearing|clothing|garments?|pockets?`

// ---------------------------------------------------------------------------- marks

// `piercing` is a noun/adjective homograph ("a silver piercing" vs "piercing green eyes") —
// position separates them (see AS_MODIFIER in characterTraits.js), so it stays here unqualified.
export const NOTABLE = `scars?|scarred|tattoos?|tattooed|birthmarks?|brands?|branded|freckles?|freckled|wrinkles?|wrinkled|piercings?|pierced|burns?|burned|blind|deaf|mute|limp|limping|crippled|maimed`

// Non-human anatomy — notable by existing at all, which is the point for a fantasy cast.
// `scales`/`muzzle`/`horns`/`wings` (noun forms) moved to POSSESSIVE_BOUND below — each collides
// with a common non-anatomy sense; see README.md §9. Adjectives (`horned`/`winged`) stay here,
// unambiguous.
export const INHUMAN = `winged|tails?|tailed|horned|hooves|hoofed|claws?|clawed|fangs?|fanged|fur|furred|feathers?|feathered|antlers?|paws?|talons?|tentacles?|snout|whiskers|gills|fins?`

// Words that need a possessive right in front (`his`/`her`/`its`/`X's`) to count — the bare noun
// has a common non-anatomy sense a possessive reliably rules out. Not INHUMAN-specific; any word
// with this shape belongs here regardless of which group it would otherwise sit in.
export const POSSESSIVE_BOUND = `scales?|scaled|muzzle|horns?|wings?`

// Stems, not the fifteen spellings this used to list. `grin` needs its own arm or the stem
// swallows "grind". `furrow` participle only — the bare noun describes land as readily as a face.
export const EXPRESSION = `(?:scowl|frown|sneer|smirk|glower)(?:s|ed|ing)?|grin(?:s|ned|ning)?|(?:smil|glar)(?:e|es|ed|ing)|furrow(?:ed|ing)`

// ---------------------------------------------------------------------------- qualities

// Compound shades need no entry — "jet black", "ash blonde" resolve through their base colour.
// Only shades with no base colour word are listed alone (`brunette`, `raven`, `platinum`).
export const COLOUR = `black|white|red|blue|green|yellow|orange|purple|violet|pink|brown|grey|gray|greying|graying|golden|gold|silver|bronze|copper|auburn|blonde?|ginger|chestnut|olive|crimson|scarlet|emerald|amber|hazel|ashen|pale|fair|light|dark|sandy|ruddy|swarthy|dusky|ebony|tan|tanned|sun-kissed|brunette|raven|platinum|salt-and-pepper`

// Opposed pairs so neither pole is favoured, plus transient feeling — "said angrily" attaches a
// state to a person the way "the angry sea" does not.
export const NATURE = `stern|gentle|kind|cruel|harsh|proud|humble|quiet|loud|shy|bold|timid|brave|nervous|calm|fierce|meek|weary|eager|patient|impatient|arrogant|modest|cheerful|grim|sullen|warm|cold|sharp|dull|clever|stupid|shrewd|stubborn|reserved|solemn|merry|bitter|generous|greedy|honest|sly|loyal|treacherous|angry|sad|happy|afraid|frightened|anxious|furious|jealous|ashamed|startled|puzzled|amused|annoyed|worried|relieved|delighted|angrily|sadly|happily|anxiously|wearily|furiously|nervously|quietly|softly|proudly|bitterly|gently|sharply`

// RP-register specific — 19th-century novels essentially never describe a build. Excludes words
// that describe objects too (`bust`, `curves`, `chest`) or split evenly with places (`slender`).
export const FIGURE_FORM = `physique|muscular|toned|curvy|petite|buxom|stocky|lanky|plump`

/** Scoring wants both halves; only FIGURE_FORM stands alone as a trait. */
export const FIGURE = `${FIGURE_PART}|${FIGURE_FORM}`

// Lowest scoring weight regardless. See README.md §9 for which words were removed/kept and why.
export const BEAUTY = `cute|handsome|beautiful|lovely|gorgeous|comely|good-looking|graceful|scruffy|shabby`

// Closed and register-free, so nothing here needs re-measuring on real saves. `wife`/`children`
// look like noise and stay — a spouse is worth keeping however often families come up near a town.
// (`father`/`sister` are clerical titles too; candidateIndex strips leading titles when
// normalising, so "Father Brown" never arrives here as a kinship claim.)
export const KIN = `husbands?|wife|wives|spouses?|mother|father|parents?|sons?|daughters?|child|children|brothers?|sisters?|siblings?|uncles?|aunts?|nephews?|nieces?|cousins?|grandmothers?|grandfathers?|grandsons?|granddaughters?|widows?|widowers?|heirs?|betrothed|fiancee?`

/** Wrap fragments as one anchored, global, case-insensitive alternation. */
export const anyOf = (...frags) => new RegExp(`\\b(?:${frags.join('|')})\\b`, 'gi')
