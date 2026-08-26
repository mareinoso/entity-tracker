# Gender — where it comes from, how strong each source is, and what that implies

Gender has the widest blast radius of any signal here. It steers attribution (a nameless sentence is
continued by pronoun agreement), typing (deciding an entity is "she" IS deciding it is a character),
and the trait filter (a trait from a contradicting pronoun class is dropped at read time). So it is
worth knowing which of its sources are trustworthy, and by how much.

Everything below is measured on six real AI Dungeon transcripts (1,907 turns, 2,637 paragraphs) with
`bench/gender-trace.mjs`, `bench/gender-buckets.mjs`, `bench/gender-pronouns.mjs` and
`bench/gender-signals.mjs`. Re-run them after any change to this area.

**How the scoring works.** For every entity the corpus gives a decisive majority to (one class at
least twice the other, four credits minimum), each individual credit is scored against that
majority. Credits in the minority are counted as errors. This is a proxy, not ground truth — it
cannot catch an entity that is wrong *consistently* — but it is unbiased between rules, which is
what makes the comparison between them meaningful.

---

## 1. The sources, and what each is worth

| source | what it reads | strength | measured |
|---|---|---|---|
| **title** | `Lady Greymark`, `King Garreth`, `Sister Ashka` | decides outright, but see §4 | 7 entities corpus-wide |
| **descriptor head noun** | `a stern-faced woman` → f | decides outright for that description | lexical, not scored |
| **sentence** (rules 1–2) | the pronoun class of a sentence whose owner was resolved by a possessive or by leading a pronoun | 1 credit | **3% error**, 1,802 credits |
| **mixed** (leaning) | one pronoun at a time, in a sentence that mixes classes, where exactly one candidate leans that way | 1 credit | **0% error**, 115 credits |
| **carry** (deferred) | the *next* sentence's pronoun, credited to the sole name of the previous one — only in narration, and only in a gender-uniform paragraph (§4b) | 1 credit | **15% error**, 106 credits |
| **claim** | a description's head-noun gender, transferred to the name that claimed it | 2 credits | 25% error, 8 credits |

Then `resolveGender`: a 2:1 majority over at least two credits, or nothing.

The spread is the story. `sentence` and `mixed` are trustworthy; `carry` is not, and it is the only
rule whose credits are wrong at a rate that would matter if they were ever decisive.

---

## 2. Should the rules be more decisive? No — and here is why

The instinct is that a 25%-error rule must be corrupting verdicts. It is not, and the measurement
says something more useful:

> **Bad gender evidence in this design costs COVERAGE, not CORRECTNESS.**

- 140 entities get a verdict from the tally. Exactly **one** rests on `carry` alone — and that one is
  `elmhollow`, a place, which should not have a gender at all.
- Meanwhile **14 entities have four or more credits and no verdict**, and 3 of them would resolve —
  correctly — if `carry` were removed entirely (`korvash` → f, `ashgrave` → m, `vask` → m).

The 2:1 threshold is already doing its job: it converts a noisy minority stream into *unresolved*
rather than into a wrong answer. The failure mode is an entity that stays ungendered because its
evidence is polluted, not one that is confidently mislabelled.

Two things follow, and they run against the obvious instincts:

- **Lowering the threshold would convert that noise into wrong answers.** The current bar is not too
  strict; it is what makes the noise harmless.
- **Weighting the rules buys very little.** Because `carry` almost never decides alone, halving its
  weight changes almost no verdicts. The productive direction is removing noise at the source, so
  more entities clear the existing bar cleanly. That is what §5's two gates do.

## 3. Should we weight by the kind of pronoun? No — measured, no signal

"Talis steadied herself" feels like better evidence than "Talis watched his approach". It is, but not
by enough to be worth encoding:

| rule | reflexive | subject (he/she) | object (him/her) | possessive (his/hers) |
|---|---|---|---|---|
| `sentence` | 0% (n=11) | 4% | 3% | 4% |
| `carry` | — | 23% | 17% | 32% |
| `mixed` | — | 0% | 0% | 0% |

Within a rule the spread is 2–4 points. Between rules it is 25. **The rule that read the pronoun
predicts reliability; the pronoun does not.** A "reflexives count double" rule would also be nearly
inert: 47 credits corpus-wide, already at 4% error.

---

## 4. Where the design was actually wrong

### A title overrode everything, including the story

`genderFromTitles` decided outright, ahead of any amount of pronoun evidence. On the corpus that
loses to exactly one case, and it loses badly: an entity addressed as **"Lord Doran" nine times**
(plus `Master`, `Brother`) carries **35 unanimous female pronoun credits**, and shipped as male.

A contradiction that lopsided is not a title being informative — it is two identities sharing a name.
`settleGender` now returns **unresolved** when the tally opposes the title by 3:1 with at least six
credits. Deliberately not "the pronouns win": with the evidence this divided neither answer is worth
asserting, and unresolved is the safe state everywhere downstream — it withholds a type signal rather
than inventing one, and leaves the trait filter passing everything rather than dropping half of it
against the wrong verdict.

### Two rules were wrong more often than right

Both found by slicing, both now gated, both with a regression test:

- **`carry` into a line of dialogue — 63% wrong** (17 of 27). Carrying a name forward assumes the
  narration is still following that person; a quoted line is about whoever the *speaker* is
  discussing. `"He's lucky you were there."` was giving Vesna a male data point. This was the only
  place in the package measured to cost more than it earned.
- **A name addressed inside dialogue** (`"I knew your father, Marrow, and I knew he kept…"`) was
  credited with the pronouns of the line addressed *to* it. Eight of Marrow's nine male data points,
  for a male character the old package had confidently called female.

Together these removed 12 wrong credits at a cost of 3 correct ones.

---

## 4b. Paragraph uniformity — a proposed rule, measured, adopted in half

The proposal: treat "this character was completely female in this paragraph" as a signal in its own
right, the way the sole-name rule already treats "exactly one candidate in this sentence".

The argument is sound, and sharper than it first looks: **in a paragraph where every pronoun is
female, a credit cannot pick up the wrong gender even if it picks the wrong person** — there is no
other gender in the paragraph to pick up. Misattribution stops mattering, which is exactly the
failure mode the weak rules have.

Measured (`bench/gender-uniform.mjs`), it holds, and it discriminates hardest where the error is:

| bucket | error | n |
|---|---|---|
| `carry` · mixed paragraph | **43%** | 42 |
| `carry` · uniform paragraph | 16% | 106 |
| `sentence` · mixed paragraph | 5% | 792 |
| `sentence` · uniform paragraph | 2% | 1077 |

**Adopted as a gate**: `carry` now requires a gender-uniform paragraph. Its error rate fell 25% →
**15%**, and total wrong credits across the corpus fell 94 → **73**, against 28 correct credits
lost. That is the largest single improvement to gender quality in this package.

**Rejected as a weight.** Counting a uniform-paragraph credit double was simulated with the
two-observation floor kept honest: 307 verdicts unchanged, **4 newly resolved, 0 lost, 0 flipped** —
and two of the four are a place (`veyrin`) and a common noun (`man`). At triple weight it starts
losing verdicts it had (`korvash`, `demon prince`). Amplification is nearly inert because the
entities it would help already have enough evidence; what binds is the 2:1 threshold, not the
magnitude of the credits. Uniformity earns its place as a qualifier on weak evidence, not as an
amplifier of strong evidence.

**Also rejected: uniformity as a rescue.** Resolving an otherwise-unresolved entity from its
uniform-paragraph credits alone looks attractive (it would resolve 4 of 8) but it can invert a
verdict rather than supply a missing one: `vask` has a flat tally of m:8 f:4 and a uniform-only tally
of m:0 f:4. A subset of the evidence is not a cleaner view of it.

## 4c. How long does a character wait for a gender?

Accuracy is half the question. Gender feeds typing, typing gates surfacing, so an entity that takes
twenty turns to settle is a card offered twenty turns late. Measured by replaying turn by turn and
recording the first turn each entity has a gender against the first turn it appeared at all
(`bench/gender-latency.mjs`), for entities with 3+ mentions that end up typed `character`:

| turns from first appearance to a settled gender | new | old |
|---|---|---|
| settled at all | 83 of 104 (80%) | 89 of 109 (82%) |
| median | 2 | 1 |
| p75 | **6** | 10 |
| p90 | **64** | 98 |
| settled on first appearance | 21 (25%) | 25 (28%) |

So: **four characters in five get a gender, half of them within two turns, and a quarter
immediately** — but the tail is long, and one in five never settles at all.

The gates in §4 and §4b cost a turn of median and three points of same-turn resolution, and bought
a much shorter tail (p90 98 → 64, p75 10 → 6). That is the trade in one line: slightly slower to
first answer, considerably faster to *most* answers, and fewer wrong ones.

### Could it be faster? The evidence says yes; the risk says no

The 2:1 threshold needs two observations, so a character with one clean gendered sentence waits for
a second. How safe would settling on the first be? Measured against what each entity eventually
settled on:

| if a single credit of this kind settled gender immediately | agrees |
|---|---|
| first `sentence` credit | **98%** (2 wrong of 82) |
| first credit of any rule | 95% (4 of 83) |
| first `mixed` credit | 97% (1 of 33) |
| first `sentence` credit in a uniform paragraph | 92% (6 of 79) |

On characters, one sentence-rule credit is essentially as good as two. **The floor is not there to
protect characters.** Lowering it to one uncontradicted `sentence` credit would newly gender 112
entities — and only **10 of them are characters**. The other 102 are untyped descriptions and junk
(`this droid`, `new recruit`, `young officer`) plus 3 places. Since a resolved gender adds +3 to the
character lean, gendering that population is how junk becomes suggestible.

So the global floor stays. The **targeted** version, measured: lower it to one uncontradicted
`sentence` credit only for an entity that already has an independent character signal — a speech
tag, two possessives, or a parsed title. There, gender confirms a reading rather than creating one,
so the population the floor protects is untouched:

| | drop the floor globally | drop it only with a character signal |
|---|---|---|
| characters settling earlier | — | **9** (median 2 turns, max 61) |
| characters newly settling | 10 | 4 |
| **non-characters newly gendered** | **102** | **0** |

`See Captain Kade Rourke` settles 61 turns earlier; Groff, Denix Calvert and Rennick
Ashvane 1-3 turns earlier. Nothing untyped or locative gains a gender at all.

Note what this rule would and would not read. It consults the raw mention facts — `spoke`,
`possessive`, a title on the surface — which are gender-free, NOT `resolveType`'s verdict, which is
not. So it does not invert the dependency: typing keeps reading gender, and gender reads mention
facts. (An earlier draft of this document claimed the opposite; it was wrong.)

**Shipped** (`loneStrongCredit`, `src/profile/gender.js`). The contract is now: a gender rests on two
observations, unless something gender-free has already established a person, in which case one
strong observation is enough. `carry` credits never count as that observation — the tally carries
`sm`/`sf` alongside `m`/`f`/`n` for exactly this, two counters rather than full per-rule provenance
because measured, excluding `carry` is the whole of the difference.

What it bought, on the character cohort:

| | before | after | old package |
|---|---|---|---|
| settled | 83 | **89** | 89 |
| never settles | 21 | **16** | 20 |
| settled on first appearance | 21 (25%) | **25 (28%)** | 25 (28%) |
| p90 turns | 64 | **64** | 98 |

So coverage and immediacy now match the predecessor while the tail stays a third shorter and the
error rate stays at 73 wrong credits — the leniency added none. Across the whole corpus only 6
non-characters carry a gender at all (3 untyped, 2 locations, 1 organisation).

The reason this is worth more than the 13 entities suggests: gender is an INPUT to the merge guard
(two keys gendered differently do not merge), to attribution continuity, to the definite-phrase
redirect and to forward-claim tier 2. Settling it earlier makes all four available earlier.

## 5. What is left, and what is not worth doing

**`carry` stays**, now gated twice (§4, §4b). 90 right against 16 wrong is comfortably net-positive,
it is the only evidence some characters ever get (a naming sentence frequently has no pronoun of its
own), and its remaining errors are absorbed by the threshold. A stricter alternative — *carry may
corroborate but never decide alone* — was measured: it would change exactly one entity, and that
entity is a place. Not implemented, because it costs a rule for no measured gain.

**Apposition is dead.** The obvious unexplored signal is a gendered head noun attached to a NAME —
`Talis, a tall woman, …` or `Brant was a merchant`. The machinery already exists (`genderOfHead` runs
on every phrase; it is simply never read for a named entity). Measured across 2,637 paragraphs:
**two occurrences.** Both would gender an entity that has none, and neither contradicts anything, so
the rule would be free — and it would gender two entities in six novels' worth of text. Recorded here
so nobody proposes it a second time.

---

## 6. Unexplored, ranked by what the register suggests

None of these are measured yet. Ordered by expected yield in this register, with the reason each is
plausible and the reason each is not obviously safe.

1. **Speaker identity → speaker gender.** `speaksAt` already resolves, at high precision, that a
   given mention spoke. When a *pronoun* is the speech-tag subject instead (`"Fine," she said`) the
   package uses it only to REFUSE attribution (`pronounIsSpeaker`), never to credit gender to whoever
   the dialogue turn-taking implies. In a dialogue-heavy register this is the largest untapped
   surface. The risk is the usual one — knowing *that* somebody spoke is not knowing *who* — so it
   would need the same uniqueness gate everything else here uses.
2. **Kinship nouns bound by possessive.** `her brother Wystan`, `Talis's daughter` — the possessive
   binds a gendered noun to a named person. High precision grammatically; the vocabulary already
   exists in `KIN`. Modest volume expected, and the relation is easy to invert by mistake (the
   gendered word describes the relative, not the possessor).
3. **Self-identification inside a quote.** `selfIdentifiedSpeaker` already finds `"I am X"` and uses
   it for typing. `"I am his wife"` / `"I'm her brother"` in the same construction would gender the
   speaker. Rare, but nearly free given the detector exists.
4. **Contradiction as a merge signal rather than a gender signal.** An entity with a lopsided,
   unanimous contradiction (the `doran` shape) is more likely two people than one ambiguous person.
   Today that produces "unresolved"; it could instead flag the identity for splitting. This is the
   most interesting of the four, because it turns the worst gender data into the best identity data.

Explicitly **not** worth pursuing: a given-name gazetteer (invented names dominate this register),
honorific-based inference beyond what `titles.js` already tags, and any weighting scheme — see §2
and §3.
