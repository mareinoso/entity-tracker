# entity-tracker

Finds the people (and places, and organisations) a piece of prose is talking about, accumulates what
the story says about each of them across many turns, and decides when there is enough to suggest one
as worth turning into something else promoting an entry to whatever the host builds from a
name and a pile of accumulated description.

Built for a text that is expected to mutate oftenfixed: turns get retried, paragraphs
get edited, the author undoes back three generations and goes a different way. That is the design
constraint everything below follows from.

```js
import { EntityTracker } from 'entity-tracker'

const tracker = new EntityTracker()
tracker.addTurn('turn-1', generatedText)      // a generation arrives
tracker.setTurn('turn-1', regeneratedText)    // ...the player retries it
tracker.truncateAfter('turn-8')               // ...and later undoes back to turn 8

for (const e of tracker.suggestions()) {
  console.log(e.name, e.type, e.gender, e.traits, tracker.excerpts(e.id))
}
```

---

## 1. The one idea

**The corpus is the only state. Everything else is a view.**

```
turns of text  ─┬─▶ Reading      pure parse of one paragraph, cached by content hash
                │
                ├─▶ replay       admission → attribution → scoring, paragraph by paragraph
                │
                └─▶ entities     grouped, typed, gendered, ranked — rebuilt on demand
```

Nothing is accumulated into an entity. An entity is a projection over the mentions and attributions
that currently exist, computed when asked for and discarded when the corpus changes. That single
decision is what makes the two things this package exists for work exactly rather than approximately:

**Recompute.** Re-ingesting an edited paragraph is not a patch applied to stale state — the replay
rolls back to the earliest paragraph the edit could affect and runs forward again. Same corpus, same
result, byte for byte, whatever order the edits arrived in.

**Dropping what changed.** Removing a paragraph removes everything it caused, including *merges it
caused*. Two identities fused by one bridging sentence come apart again when that sentence is
deleted, because the bridge was an input to grouping, not a fact recorded inside an entity.

```js
tracker.addTurn('t1', 'Corren drew his sword. Corren was tired. Corren walked on.')
tracker.addTurn('t2', 'Vantage rode north. Vantage rode fast. Vantage did not look back.')
// two entities: Corren, Vantage
tracker.addTurn('t3', 'Corren Vantage raised the banner high above the field.')
// one entity: Corren Vantage
tracker.removeTurn('t3')
// two entities again
```

Cost, measured on a real 644-turn / 1020-paragraph transcript: a cold build is ~500ms, appending a
turn ~12ms, retrying the last turn ~30ms, and editing the very first paragraph — the worst case, a
full replay — ~390ms. The expensive half (parsing text) is cached per paragraph and never redone.

---

## 2. The layers

Each is a pure function of the layer above it. There are no cycles, and nothing reads downward.

| Layer | File | Answers |
|---|---|---|
| **Reading** | `src/read/` | What does this paragraph's *text* say? Sentences, quotes, capitalised spans, noun phrases, traits, pronouns, speech tags. Depends on nothing but the text, so it is cached by content hash and never invalidated. |
| **Lexis** | `src/lexis.js` | What has the story taught us about *words*? Casing history, which spans are attested where their capital has no positional excuse, how a bare token behaves. |
| **Admission** | `src/admit.js` | Which spans are real entities? Trimming, the noise gate, and five admission rules. Every judgement that needs more than one paragraph lives here. |
| **Attribution** | `src/attribute/` | Whose sentence is this, whose trait is that? One pass, one focus window, one agreement gate. |
| **Anchors** | `src/anchors.js` | What happens to a description of somebody unnamed? |
| **Identity** | `src/identity/` | Which surface forms are the same entity, and what is that entity's stable id? |
| **Entities** | `src/entities.js` | The view: surfaces, traits, gender, type, counts, excerpts. |
| **Surfacing** | `src/surface.js` | Is there enough here to suggest? |
| **Tracker** | `src/tracker.js` | The corpus, the replay, undo/redo, decisions, persistence. |

---

## 3. Descriptions — the part that used to be called "referents"

Prose introduces unnamed people constantly: *"a stern-faced woman stepped through the door"*, *"the
matron watched from the doorway"*, *"the Dwarven Blacksmith looked up"*. Everything said about them
belongs to **them** — and if it has nowhere to go, it lands on whichever named character happens to
be nearby. That is the single most damaging failure this package can have, because a character card
built from another character's description is worse than no card.

So a description always gets an **anchor**, and the anchor always absorbs what is said about it.
Unconditional. What is *conditional* is whether the anchor outlives its paragraph:

| Outcome | When | What happens to its data |
|---|---|---|
| **claimed** | a name arrives later in the same paragraph — *"...I am Ophira"* | becomes that name's: traits, gender, the phrase itself as a description |
| **recurrent** | the same individuating description returns within `windowTurns` (default 3) | becomes an entity in its own right, `kind: 'description'` |
| **dropped** | anything else | dies with its paragraph, taking everything credited to it |

Dropping is not a failure mode, it is the product: a passer-by described in one sentence should leave
no trace anywhere. And because promotion is *derived from the paragraphs currently live*, deleting
the paragraphs that made a description recurrent un-promotes it on the next rebuild. There is no
eviction pass, no grace-period bookkeeping, and no way for a stale anonymous entity to survive.

A description is never suggested as a candidate. It exists to hold data, not to be offered.

**Individuating** means a modified compound (`"Dwarven Blacksmith"`, `"Scarred Woman"`) or a bare
role noun the story keeps returning to (`"the noblewoman"`). A plain `"a woman"` never promotes: two
unrelated women normalise to exactly the same string, and merging them is precisely the bug this
rule exists to prevent.

---

## 4. Attribution — whose trait is this

One pass per paragraph, one shared focus window, rules in order, first match wins. Every rule
refuses rather than guesses when two candidates fit — the refusal is the safety mechanism, not a
shortcoming of it.

| # | Rule | Refuses when |
|---|---|---|
| 1 | Possessive (`Peter's hands`) | two possessives compete |
| 2 | One person in the sentence, leading any pronoun | a pronoun precedes them, or that pronoun is itself a speech subject |
| 3 | Continuation by pronoun agreement, against the focus window | zero or two-plus candidates agree |
| 3b | A binding the phrase pass already resolved (a predicative description renaming somebody named earlier) | its gender disagrees with the sentence's pronoun |
| 4 | Nearest possessive-or-pronoun marker, per trait | distance ties |

### The focus window

Who is in play, and therefore who a pronoun may continue. **A replacing window**: whoever a sentence
mentions replaces its occupants wholesale; a sentence mentioning nobody leaves it alone. Three kinds
of occupant, one shape — a name, a description, or a **blocked passer-by** (described strongly enough
that crediting anyone else would be wrong, not strongly enough to track), which holds the window for
two sentences and lets nothing continue past it.

This is one structure. The predecessor package had four, in five places, and its own documentation
records fixing the same bug in three of them independently.

---

## 5. Typing — character, location, or organisation

Three types, no fallback. An untyped candidate is never surfaced: a wrong card costs the author
attention and puts invented detail into the story, while silence costs nothing.

A **span-final head noun decides outright** (`Duskmere Keep` → location, `Rebel Alliance` →
organisation, `Snow Queen` → character). Usage signals treat organisations and places exactly like
people — they own things, they get quoted — so the head noun does not merely vote.

With no head noun, evidence accumulates **per turn**, and each signal fires at most once per turn:

| Signal | Weight |
|---|---|
| speech tag | character +3 |
| self-identification inside a quote (*"I am X"*) | character +3 |
| `dear`/`poor` before the name | character +2 |
| accumulated possessives ≥ 2 | character +3 |
| a parsed leading title (`Commander Richard`) | character +3 |
| resolved gender (m/f — `n` is attribution-only) | character +3 |
| locative frame (`of`/`in`/`across` before the name, non-possessive) | location +1 |
| attributive profile (never possessive, never speaks, rarely standalone) | suppresses entirely |

`argmax ≥ 3`, ties and anything below → untyped.

---

## 6. Identity

Grouping is a pure function of the live mentions. Passes, each with the same guard — count distinct
roots, merge only when there is exactly one:

1. **user aliases** — authoritative, past every gate
2. **nested forms** — `ua` ⊂ `ua high` ⊂ `ua high school`, run to a fixpoint, longest first
3. **initials** — `s holmes` → `sherlock holmes`
4. **single tokens** into the one multi-word form containing them

Blockers, each from a confirmed real failure: an `X of Y` compound is never a merge target (it
bridges two unrelated names through itself); a possessed item (`Zhukan's Nodachi`) never competes
with its owner; a stranded title word (`King` into `Vordun King`) stays put; a token that behaves like
ordinary vocabulary cannot drive a merge; a token whose bare-form history is locative
(`of Wrenmoor`, `across Wrenmoor`, never possessive, never speaking) cannot either; and two keys the
story has already gendered differently are not the same person.

**Ids are stable across regrouping.** Each group keeps the id it has the most mention weight for; a
merge records the absorbed id as an alias, so a reference of any age resolves in one lookup
(`tracker.resolve(oldId)`), and a split gives the lighter fragment a fresh id.

---

## 7. Surfacing

Six thresholds ANDed, with speech ORed around the turn requirement specifically — a tagged speech
event is high-precision and low-recall, an accelerator rather than another AND term. `allowedTypes`
is absolute and runs first. Defaults in `src/surface.js`:

```js
{ allowedTypes: ['character'], minTurns: 3, minMentions: 4, minScore: 4,
  minReturns: 0, minNarration: 0.5, minStaleFor: 0, minSinceBest: 1, speechCredit: 1 }
```

`minSinceBest` is the settle clock: turns since the entity's best-described paragraph, i.e. "has the
description stopped growing", as opposed to `staleFor`'s "has anyone mentioned them lately".

**Deliberately out of scope**, host-side entirely: how many suggestions are on screen, what a card
is, how one is generated, and any UI pacing.

---

## 7b. Two ways to feed it

A generation arrives as a turn; a person editing text does not. Both are supported, and they are
the same machinery underneath.

```js
tracker.addTurn('gen-42', paragraphs)   // text arrived at the end, as one turn
tracker.sync(allParagraphs)             // the document is now exactly this
```

`sync` takes the whole ordered paragraph list, diffs it against the corpus, and invalidates from
the first position that actually differs — so a change at the end of a long story costs what an
append costs (measured: 6ms against 1000 paragraphs; 46ms if the change is at the very start).
It covers every shape an editor reports: a paragraph split in two, one deleted from the middle,
two merged, an undo restoring three.

A paragraph with no `turnId` of its own inherits the turn of **whatever it replaced at that
position**, and only falls back to the paragraph before it when nothing did. Both halves matter:

- a paragraph the author splits off joins its neighbour rather than inventing a turn
- a span the model rewrites keeps the turn boundaries it spanned, even when it comes back as a
  different number of paragraphs — a rewrite is not a turn

Stamp an explicit `turnId` when text genuinely arrives: it overrides both. That is also how a
generation appended *inline into an existing paragraph* still advances the turn clock — stamp the
paragraph it wrote into, and it moves to the new turn. A turn left holding nothing because the
next generation took its paragraph is **kept, empty**: it happened, and without it a run of
inline-only continuations would stop the clock and with it every threshold measured in turns. A
turn whose paragraphs were *deleted* is not kept — the story got shorter.

```js
// a generation that appended into the last paragraph and added one more
tracker.sync([
  ...untouched,
  { id: seamId, text: seamText, turnId: 'gen-42' },   // moves forward with the generation
  { id: newId,  text: newText,  turnId: 'gen-42' },
])

// a rewrite: no turnId at all, let the replaced positions decide
tracker.sync(documentParagraphs)
```

---

## 8. Decisions

Keyed by the **normalised name the user acted on**, never by entity — so they survive regrouping,
renaming, deletion and rebuild with no merge rules of their own.

| Call | Meaning |
|---|---|
| `dismiss(ref)` | permanent. The user rejected this candidate; it stays rejected even if the entity is rebuilt from scratch later |
| `postpone(ref)` | soft. Lifted automatically when the display name changes to one the user has not seen, because they set it aside on less information than exists now |
| `promote(ref)` | the host built something from it, so stop suggesting it |
| `release(ref)` | whatever was built is gone; it can be offered again |

`overlapsPromoted(id)` reports whether a candidate's identity is a *fragment* of one already promoted
(bare `Bennet` against `Elizabeth Bennet`), by set containment, so it generalises across name length,
order and family-name-first conventions. Read-only: the host decides what to do about it.

---

## 9. API

```js
new EntityTracker(options?)

// corpus
.addTurn(turnId, text | paragraphs)   .setTurn(turnId, ...)      // retry
.setParagraph(paragraphId, text)      .removeParagraph(id)
.removeTurn(turnId)                   .truncateAfter(turnId)     // undo to here
.undo()                               .redo()

// reading out
.entities()          .entity(id)      .resolve(oldId)
.suggestions({ thresholds?, exclude? })
.excerpts(id)        // best paragraphs, resolved to text
.paragraphText(id)   .debug(thresholds?)

// decisions
.dismiss(ref) .postpone(ref) .promote(ref) .release(ref) .overlapsPromoted(id)

// persistence — plain JSON: the corpus and the decisions, nothing derived
.snapshot()          EntityTracker.restore(snap, options?)
```

Options: `windowTurns`, `nonPersonMentions`, `aliases`, and an `attribution` block
(`definiteDescriptors`, `widenWaiver`, `forwardClaim`, `mixedPronouns`) — all on by default.

The functional core is exported too (`createTracker`, `addTurn`, `entities`, …) for hosts that would
rather hold plain data, plus the stateless tier: `readParagraph`, `admitMentions`,
`attributeParagraph`, `groupSurfaces`, `normalizeName`, `establishedSlots`.

### An entity

```js
{
  id, key, keys, name,
  kind: 'name' | 'description',
  type: 'character' | 'location' | 'organization' | null,
  gender: 'm' | 'f' | 'n' | null,
  surfaces, descriptions, titles, honorifics,   // {form: count}
  traits,                                        // string[], best-attested first, gender-filtered
  traitCounts,                                   // {trait: {count, from}}
  mentions, turnsSeen, spoke, inQuote, narrationRatio, returns,
  firstTurn, lastTurn, staleFor, sinceBest, bestScore, bestParagraphs,
  dismissed, postponed, promoted,
}
```

---

## 10. Measured

`node test/run.js` — 56 assertions, covering replay determinism, edit round-trips, removal, un-merge,
undo/redo, claiming, description isolation, every grouping blocker, typing, gender, decisions, id
stability and serialisation.

`node bench/labelled.mjs` — the hand-labelled corpus, against the predecessor package:

```
        recall           traps tripped
new     24/24 (100%)     0
old     19/24 (79.2%)    0
```

The five recovered are main characters whose name only ever opens a sentence (`Renjo waved.`,
`Talis counted the coins.`) and so carried no positional evidence in any single paragraph — plus
`Duskmere Keep`, whose head noun the opener trim used to eat, taking with it the only signal that
could type it.

`node bench/rp-compare.mjs` — six real AI Dungeon transcripts (93–644 turns), both packages side by
side. Named-entity sets agree on 5 of 6 stories exactly; suggestion lists agree on 4 of 6 exactly and
differ by one or two elsewhere. Timings are 2–6× faster than the predecessor, because nothing is
accumulated.

`node bench/edit-cost.mjs` — what an edit costs at each position in a story.

`node bench/compare.mjs` — a general behavioural diff against the predecessor: entity sets, typing,
gender, how much description each manages to attribute, and what each would suggest.

`node bench/gender-trace.mjs`, `gender-buckets.mjs`, `gender-pronouns.mjs`, `gender-uniform.mjs`,
`gender-signals.mjs`, `gender-truth.mjs`, `gender-latency.mjs` — where every gender data point came
from, which rules under which conditions are wrong more often than right, and how many turns a
character waits before having a gender at all. Gender steers attribution, typing and the trait
filter, so it has its own document: see `GENDER.md`.

---

## 11. Known limits — real, not hypothetical

- **The repetition rescue trades precision for early recall.** Admitting a word that only ever opens
  sentences (never lowercase, never in dialogue, never standalone, not inflected like vocabulary,
  seen more than once) recovers main characters in the first few turns of a story — which is exactly
  when a tracker is most useful — at a cost of roughly 0–6 low-value untyped entities per long
  transcript (`sparks`, `energy`, `stalactites`). None of them reach a suggestion, because untyped
  candidates never surface. If a host wants the old behaviour, the rule is one condition in
  `src/admit.js`.
- **A new character sharing an established surname is absorbed until their own gender settles.**
  `Marisol Halden` arriving after three turns of a male `Halden` merges into him, because one
  pronoun cannot distinguish "a different person sharing a surname" from "a fuller form of the same
  name" — measured across six transcripts, the two shapes are identical at one data point. It
  corrects itself: once she has a settled gender of her own, the next rebuild splits them and each
  reads correctly. A merge is not permanent here, which is the whole reason it can be wrong for a
  while and still recover. The guard that refuses the merge outright requires a settled verdict on
  both sides; a lean-based version was tried and fired once on the real corpus, wrongly.
- **A description binds by uniqueness when nobody in focus has any gender evidence.** If a
  character's introducing sentence mixes pronoun classes ("Beside him Marisol waited, her spear
  steady") it produces no gender evidence at all, and a later same-paragraph description with no
  gendered head noun of its own can bind to her on uniqueness alone. Unchanged from the
  predecessor; a description whose head noun IS gendered requires a positive match.
- **Two unnamed people described identically at the same time** are one anchor. Normalised phrases
  are the only identity a description has.
- **Location and organisation recall is capped by vocabulary, not logic.** A single-word name with no
  head noun (`Veyrin`, `Duskmere`) has nothing left to type it once possessive-only evidence is
  correctly demoted. Needs a gazetteer or a model pass; not attempted.
- **The deferred gender credit is the weakest rule here, and it is kept anyway.** When a naming
  sentence has no pronoun ("Ophira walked the corridor"), the next sentence's pronoun is credited to
  it. Scored against what each story eventually settled on, that rule is wrong 25% of the time,
  against 3% for ordinary sentence ownership and 0% for the per-pronoun leaning rule. It is still
  net-positive (106 right, 35 wrong) and it is the only evidence some characters ever get, so it
  stays — but it produces 37% of all remaining gender errors from 7% of the credits. Its worst
  case is gated: carrying into a line of DIALOGUE was wrong 63% of the time, the only measured
  place in this package where a rule cost more than it earned, and it now refuses.
  Re-measure with `node bench/gender-buckets.mjs`.
- **Weights are ordered by measurement, not individually fitted.** The *ranking* of typing signals is
  measured; the numbers (3, 2, 1) are reasonable and would benefit from a fitting harness.
- **Author input quality is out of scope.** Stage directions typed in title case (`Kade Rourke Enters`)
  are orthographically indistinguishable from names; the opener rules catch the common shapes and
  nothing catches the rest.
- **Cross-paragraph attribution continuity is available but off.** `attributeParagraph` accepts a
  focus to carry in; the tracker does not thread one, because the predecessor measured the yield at
  10 recovered traits across a six-story corpus, several of them visibly wrong.

## 12. Further reading

`GENDER.md` — every source of gender, its measured error rate, and what the numbers say about
weighting, thresholds and the signals still unexplored. Gender steers attribution, typing and the
trait filter, so it is the one signal documented separately.
