# Design notes — what changed from `text-entity-tracker`, and why

The predecessor works. Its rules are measured, its lexicons are audited word by word, and its
documentation records what was tried and refuted so nobody re-proposes it. Almost all of that is kept
here verbatim.

What is *not* kept is its shape. It grew feature by feature, and the cost shows up in one specific
way: **several mechanisms writing to the same data with no single owner**. Its own docs name this
repeatedly — three implementations of one focus window, two detectors deriving different keys for the
same characters, a fast merge path and a slow one that disagreed, a merge primitive that had to
deliberately drop a field because the general one re-split what it merged.

This document maps old to new so nothing is lost by accident.

---

## 1. The structural change

| | old | new |
|---|---|---|
| what is stored | per-entity `records[paragraphId]` with a dozen pre-merged fields | the corpus text, and nothing else |
| how an entity forms | fields folded in on ingest, re-projected on change | derived on demand from live mentions |
| editing a paragraph | strip its record, re-project the rest | roll the replay back, run forward |
| removing a merge | **not representable** (documented) | falls out — the bridge is an input |
| regrouping | rebuild entities, split records by majority share | re-partition mentions; nothing to split |
| merge paths | fast path + slow path, known to disagree | one |
| replay determinism | **not guaranteed** (extraction read pool state) | guaranteed |

The old package's README §8 says it plainly: *"`stripParagraphContribution` never calls
`canonicalise` … removing the ONE paragraph that ever bridged two identities leaves them merged, with
no automatic path back to split"*, and recommends hosts rebuild from scratch after a large edit. This
package does that rebuild automatically and only as far back as the edit reaches.

Its other documented limit — *"extraction depends on accumulated pool state, so replay isn't strictly
deterministic"* — is closed by moving every evidence-dependent judgement out of the span source
(`src/read/` is now a pure function of one paragraph's text) and into a layer that is recomputed from
whatever paragraphs are currently live.

---

## 2. Referents → descriptions

The old referent was a pool entity with `named: false`. That one decision — making an anonymous
description a first-class entity competing in the same identity space as real characters — is what
required all of the following, each of which has its own section in `IDENTITY.md`:

- `evictStaleReferents`, a per-paragraph eviction pass
- `referentGraceTurns`, a survival window
- `isDistinguishableReferent`, deciding which referents deserve the window
- `isBareRoleReferent`, a second predicate for the same question, documented at length as
  deliberately *not* unifiable with the first
- `foldReferentIntoNamed` + `foldReferentRecord`, a merge primitive that drops `surfaces` because the
  ordinary one let a claimed referent's phrase re-split the entity on the next unrelated regroup
- an unconditional rejection in `admits()` so a referent is never surfaced
- an exclusion in `canonicalise` so a referent is never a merge target
- `named` as a sticky-OR field defended at four write sites

`src/anchors.js` is all of that, as one rule with one window: claimed, recurrent, or dropped. The
mechanisms above do not have replacements because the questions they answered do not arise:

- nothing needs evicting, because nothing was stored — promotion is recomputed from live paragraphs
- there is one predicate (`looksDescriptive`, plus "is a bare role noun"), used in one place
- a description's phrase lands in `descriptions`, a name's in `surfaces`; they are different fields,
  so no merge primitive has to strip anything
- descriptions are isolated from surface grouping entirely, so no merge target exclusion is needed
- "names win over descriptions" is decided once, in `resolveAnchors`

**What got better, concretely.** The old design's protection against description polluting a real
character depended on a pool entry existing to absorb it, which is why so much machinery existed to
keep the right ones alive. Here the absorption is unconditional and the *survival* is what is
conditional — the same protection with the risk inverted.

**What got stricter.** Two occurrences of the same description more than `windowTurns` apart are now
two separate entities rather than one (each run of occurrences is its own identity). The old package
could not represent that and fixed the resulting collisions by evicting aggressively.

---

## 3. One focus window instead of four

Old: `prevNamed`, `soleNamed`, `pendingUnnamed`, `precedingNamed`, `paragraphNamedSoFar`,
`activeReferents` — six variables, four of them independent implementations of "who is still in
play", each fixed separately for the same bug (something named early in a busy paragraph staying a
valid continuation target after the passage moved on).

New: `src/attribute/focus.js`. A replacing window with three kinds of occupant and per-item
lifetimes. `pendingUnnamed`'s shadow is an occupant with a TTL rather than a parallel mechanism, and
`soleNamed` survives as the one genuinely different thing it was doing — a *deferred* gender credit,
where the naming sentence has no pronoun and the evidence is in the next sentence.

## 4. Rules kept unchanged

Carried over as-is, because they are measured and this rewrite has no better information:

- every lexicon (`src/lexicon/`), including the word-by-word appearance audit
- span discovery, the opener trims, the noise gate, the positional and rescue admission rules
- sentence splitting, quote ranges, `speaksAt`'s four verb shapes and the SAY/SAY_AMBIG/SAY_LOUD split
- trait extraction in full, including the "default state is not a trait" rule
- the description scorers and their per-type lexicons
- gender: 2:1 over at least two sentences, neuter as a positive class, titles settling outright
- typing weights and the head-noun-decides rule
- `canonicalise`'s passes and every blocker, including the `X of Y`, possessed-item, stranded-title
  and locative-dominant-token guards
- the surfacing threshold set and the speech OR

## 5. Rules changed on purpose

| Change | Why |
|---|---|
| A span-final head noun is protected from the opener trim | `Duskmere Keep` was trimmed to `Duskmere`, destroying the only signal that could type it. Confirmed in both packages before the fix; recovers a ground-truth entity, no corpus regression. |
| Honorifics admit a span | `-san`/`-sensei` never attaches to anything but a person. The old package parsed honorifics onto every entity and its own audit lists the field as computed-but-never-read. |
| A word that only ever opens sentences can be admitted on story-wide repetition | Three of five ground-truth misses were main characters (`Renjo`, `Talis`, `Doyle`) invisible to a per-paragraph positional rule. Gated hard — see README §11 for the precision cost, which is measured. |
| `sinceBest` measured in turns | It is compared against a turn count; the old code's paragraph/turn mixing is a bug this rewrite reproduced once and then fixed. |
| Gender conflict blocks the merge, not the mention write | Old refused to *record a mention* whose local gender evidence disagreed with the target — starving the merge instead of preventing it. Same evidence, one layer earlier. |
| `paragraphOwners` / sentence-adjacency merge override dropped | The old docs record it as shipped with "zero measured cost … zero benefit measured either". It is the only signal that would make identity depend on attribution, i.e. the only cycle in the layering. Cut. |
| Per-record `leanings`/`typeProfile` accumulators dropped | The old audit measured them at ~20-25% of serialised pool weight, and their turn-level dedup had a documented double-counting bug. Typing is now computed from mentions, which are already grouped by turn. |
| `offsets` array dropped | Unbounded, unioned on every merge, read by nothing. Mentions carry their own offsets and are dropped with their paragraph. |
| Decisions keyed by name, not by entity | Eight decision fields that had to be combined pairwise on merge and replicated across fragments on split become a lookup. `postponed`'s revival-on-rename falls out for free rather than needing `reconcileName`. |
| `liveFeatures` wired in by default | Built, correct, and never called in the old package (its own §8 asks for a decision). It is now how `entity.traits` is produced. |
| `obs.attributed` / `obs.ambiguous` dropped | Computed every paragraph, read by nothing, in both packages. |

## 5b. Added for the host, not carried over

`syncParagraphs` has no predecessor. The old package took one paragraph at a time and inferred an
edit from the id already being known, which covers a retry and covers nothing else: a host whose
editor emits paragraph-level changes (split, merge, delete-from-the-middle, undo) had to translate
those into per-paragraph calls itself, and there was no call at all for "this paragraph no longer
exists in the middle of the story" that also rebuilt what it had caused. Handing over the document
and diffing it is both less work for the host and the only version that is correct by
construction — the corpus is the state, so setting the corpus is the operation.

### The turn clock, for a host whose editor appends into the previous paragraph

Two mechanisms exist only because of how a real editor commits generated text, and both were found
by wiring this to one rather than by reasoning about it:

- **Emptied turns are kept.** A generation usually appends into the last paragraph of the previous
  one. Stamping that paragraph with the new turn is what moves the clock — but two inline-only
  generations in a row means the second takes the seam from the first, emptying it. Keeping the
  emptied turn (and only when its paragraphs moved rather than being deleted) is what stops the
  clock stalling, which would freeze `staleFor`/`sinceBest` and with them the whole settle-then-fire
  surfacing model.
- **`exportTurnLayout`/`restoreTurns`.** Turn boundaries are not in the document — a paragraph
  carries its id, not the generation that wrote it — so a rebuild from the text alone reads a story
  as younger than it is. The layout is a few bytes per turn and makes the rebuild exact.

## 6. Old open problems, and where they stand

| From the old docs | Status here |
|---|---|
| Un-merge isn't representable | **Closed.** Grouping is derived; deleting the bridge splits the entity. Tested. |
| Bulk deletion leaves stale identity merges (host should rebuild) | **Closed.** That rebuild is the normal path, scoped to what changed. |
| Replay isn't deterministic | **Closed.** Reading is text-only; the replay is order-defined and reproducible. Tested. |
| A retroactive record split divides aggregates by majority, losing information | **Closed.** There are no aggregates to split — mentions are re-partitioned. |
| Fast and slow merge paths can disagree | **Closed.** One path. |
| Two detectors compute different keys for the same span | **Closed structurally.** The phrase pass sees span coverage from the same Reading; `knownKeys`/`knownSpans` are gone. |
| `postpone` implemented but not exported | **Closed.** Exported. |
| `establishedSlots` has no caller | Still true, and still blocked on the same thing: `COLOUR` has no family grouping, so it cannot tell "red hair" from "crimson hair". Exported for hosts. |
| `honorifics` computed but unread | **Closed.** Admission reads them. |
| Group/plural bystander phrases block nothing | **Closed.** A plural head blocks (it just never proposes). |
| Case 2, two people sharing a surname | Unchanged, and still the hardest one. The merge-time protections are all carried over (ambiguity tie-block, gender clash, containment overlap at promotion time). Which of two same-named people a *subsequent* bare mention belongs to has no cheap answer here or anywhere the old docs surveyed. |
| Case 3, exact-key collision via normalisation | Unchanged, accepted. |
| Location/org recall capped by vocabulary | Unchanged. |
| Idiomatic `[X] of a [noun]` false-positive animacy | Unchanged — measured at 2 occurrences in a 2637-paragraph corpus. |

## 7. What a host has to change

- `createPool()` → `new EntityTracker()`
- `putParagraph(pool, {id, turnId, text})` → `addTurn(turnId, text)`, or `setParagraph(id, text)` for
  a single-paragraph edit. Paragraph ids are generated from the turn id unless you pass them.
- `removeParagraph` / `dropParagraphs` → `removeParagraph`, `removeTurn`, `truncateAfter`. The
  "rebuild from scratch after a bulk edit" advice is no longer needed.
- `pendingSurface(pool, thresholds, {excludeNames})` → `suggestions({thresholds, exclude})`
- `resolveKey(pool, key)` → `resolve(id)`, and ids are stable rather than surface-derived
- `entry.bestParagraphs.map(getText)` → `excerpts(id)` — the tracker holds the corpus, so a host no
  longer mirrors it
- `dismiss` / `markPromoted` / `releasePromoted` → `dismiss` / `promote` / `release`, plus `postpone`
- `debugSnapshot(pool, thresholds)` → `debug(thresholds)`
- Persistence: store `snapshot()` (plain JSON — the corpus and the decisions). Nothing derived is
  serialised, so there are no Maps to revive and no `instanceof` guards.
