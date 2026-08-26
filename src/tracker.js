// src/tracker.js
//
// The tracker: a corpus of turns, and everything derived from it.
//
// THE MODEL
//
//   corpus            the only thing that is stored. Turns, each holding ordered paragraphs of text.
//   readings          pure per-paragraph parses, cached by content hash. Never stale.
//   replay            interpret(paragraph) applied in order — admission, attribution, scoring.
//   entities          a view over the replayed records, rebuilt on demand.
//
// Every question a host asks is answered from the corpus. Nothing else is authoritative, which is
// what makes the two features this package exists for actually work rather than nearly work:
//
//   RECOMPUTE. `interpret` is a pure function of (reading, replay state). Replaying the same
//   corpus produces byte-identical results, so re-ingesting an edited paragraph is not an
//   approximation of what a fresh build would have said — it IS a fresh build, from the first
//   paragraph the edit could possibly affect. The old package could not promise this: its span
//   source read accumulated pool state, so paragraph 5 re-processed at turn 50 saw a different
//   story than paragraph 5 originally did.
//
//   DROPPING WHAT CHANGED. Editing or deleting a paragraph rolls the replay back to just before
//   it and runs forward again. There is no subtraction, no inverse merge, no un-merge problem:
//   whatever the removed paragraphs contributed simply never happens the second time. The old
//   package's `removeParagraph` stripped per-entity records but could not undo a MERGE those
//   records had caused, so deleting the one paragraph that bridged two identities left them
//   permanently fused (its README documents this and recommends hosts rebuild from scratch after
//   any large edit — which is what this does automatically, and only as far back as it must).

import { readParagraph } from './read/reading.js'
import { createLexis, addReading, createUsage, addMentionUsage } from './lexis.js'
import { admitMentions } from './admit.js'
import { attributeParagraph } from './attribute/attribute.js'
import { scoreParagraph } from './profile/score.js'
import { groupSurfaces } from './identity/group.js'
import { createRegistry, resolveId } from './identity/registry.js'
import { resolveAnchors, DEFAULT_WINDOW_TURNS } from './anchors.js'
import { buildEntities } from './entities.js'
import { analyseName, normalizeName, genderFromTitles } from './names.js'
import { settleGender } from './profile/gender.js'

export const DEFAULT_OPTIONS = {
  /** How many turns a description may vanish for and still be the same person. */
  windowTurns: DEFAULT_WINDOW_TURNS,
  /** A known entity with this many mentions and still no gender is not a person — see attribute. */
  nonPersonMentions: 3,
  attribution: {
    definiteDescriptors: true,
    widenWaiver: true,
    forwardClaim: true,
    mixedPronouns: true,
  },
  /** User-declared equivalences: [['Kaelen Voss', 'Nightshade'], ...]. Authoritative. */
  aliases: [],
}

const splitParagraphs = (text) => String(text ?? '')
  .split(/\n\s*\n|\n/)
  .map(s => s.trim())
  .filter(Boolean)

export function createTracker(options = {}) {
  return {
    options: { ...DEFAULT_OPTIONS, ...options, attribution: { ...DEFAULT_OPTIONS.attribution, ...(options.attribution ?? {}) } },
    turns: [],                 // [{id, paragraphs: [{id, text}]}]
    readings: new Map(),       // content hash -> Reading
    registry: createRegistry(),
    decisions: {},             // normalised display name -> {dismissed, promoted, postponed, ...}
    state: freshState(),
    entities: null,            // memoised view, invalidated by any corpus or decision change
    journal: { undo: [], redo: [] },
  }
}

const freshState = () => ({
  records: [],               // one per live paragraph, in corpus order
  lexis: createLexis(),
  usage: createUsage(),
  keyAgg: new Map(),         // key -> {tally, titles, mentions, descriptor}
  grouping: null,            // {root, groups} over the keys seen so far
  groupCache: new Map(),     // root -> {tally, titles, mentions}
  // Copied here so the running grouping applies it too — otherwise aliases reach the entity view
  // but not attribution's gender question, and two halves of one identity answer differently.
  aliases: [],
})

// ── corpus mutation ──────────────────────────────────────────────────────────

const turnIndexOf = (t, turnId) => t.turns.findIndex(x => x.id === turnId)

function makeTurn(turnId, content) {
  const paragraphs = Array.isArray(content)
    ? content.map((p, i) => (typeof p === 'string'
      ? { id: `${turnId}/${i}`, text: p }
      : { id: p.id ?? `${turnId}/${i}`, text: p.text }))
    : splitParagraphs(content).map((text, i) => ({ id: `${turnId}/${i}`, text }))
  return { id: turnId, paragraphs }
}

/**
 * Every corpus change is one splice of the turn list, which is what makes undo/redo exact and
 * cheap: the inverse of a splice is another splice, and only the turns actually touched are copied.
 */
function spliceTurns(tracker, index, deleteCount, inserted, label) {
  const removed = tracker.turns.splice(index, deleteCount, ...inserted)
  tracker.journal.undo.push({ label, index, removed, insertedCount: inserted.length })
  tracker.journal.redo.length = 0
  invalidateFrom(tracker, index)
  return tracker
}

/** Roll the replay back to the first paragraph of turn `index`, and drop the entity view. */
function invalidateFrom(tracker, index) {
  let ordinal = 0
  for (let i = 0; i < index && i < tracker.turns.length; i++) ordinal += tracker.turns[i].paragraphs.length
  tracker.dirtyFrom = tracker.dirtyFrom == null ? ordinal : Math.min(tracker.dirtyFrom, ordinal)
  tracker.entities = null
}

/** Append a generation. `content` is text (split on blank lines) or an array of paragraphs. */
export function addTurn(tracker, turnId, content) {
  if (turnIndexOf(tracker, turnId) >= 0) return setTurn(tracker, turnId, content)
  return spliceTurns(tracker, tracker.turns.length, 0, [makeTurn(turnId, content)], 'addTurn')
}

/** Replace a turn's text wholesale — what "retry this generation" actually is. */
export function setTurn(tracker, turnId, content) {
  const i = turnIndexOf(tracker, turnId)
  if (i < 0) return addTurn(tracker, turnId, content)
  return spliceTurns(tracker, i, 1, [makeTurn(turnId, content)], 'setTurn')
}

/** Edit one paragraph in place. Everything from that paragraph onward is recomputed. */
export function setParagraph(tracker, paragraphId, text) {
  const i = tracker.turns.findIndex(t => t.paragraphs.some(p => p.id === paragraphId))
  if (i < 0) return tracker
  const turn = tracker.turns[i]
  const next = { ...turn, paragraphs: turn.paragraphs.map(p => p.id === paragraphId ? { ...p, text } : p) }
  return spliceTurns(tracker, i, 1, [next], 'setParagraph')
}

export function removeParagraph(tracker, paragraphId) {
  const i = tracker.turns.findIndex(t => t.paragraphs.some(p => p.id === paragraphId))
  if (i < 0) return tracker
  const turn = tracker.turns[i]
  const paragraphs = turn.paragraphs.filter(p => p.id !== paragraphId)
  return spliceTurns(tracker, i, 1, paragraphs.length ? [{ ...turn, paragraphs }] : [], 'removeParagraph')
}

export function removeTurn(tracker, turnId) {
  const i = turnIndexOf(tracker, turnId)
  if (i < 0) return tracker
  return spliceTurns(tracker, i, 1, [], 'removeTurn')
}

/**
 * Make the corpus match this exact ordered paragraph list — the path for a host whose editor is
 * the source of truth.
 *
 * `addTurn`/`setTurn` are generation-shaped: whole turns, arriving at the end. A document someone
 * is typing in is not — paragraphs get split, deleted from the middle, merged, restored by undo.
 * Translating those into turn splices is work every host would repeat and get wrong, so hand over
 * the list and let this diff it.
 *
 * Turn assignment, in order: an explicit `turnId`, the turn this paragraph is already in, the turn
 * of whatever it REPLACED here, or the turn of the paragraph before it. The last two keep a split
 * paragraph — or a rewritten span — from inventing turns and inflating every threshold that counts
 * them.
 *
 * Only the first position that differs is invalidated, so a change at the end of a long story
 * costs what an append costs.
 *
 * @param {{id: string, text: string, turnId?: string}[]} paragraphs  in document order
 */
export function syncParagraphs(tracker, paragraphs) {
  const currentTurn = new Map()
  const oldOrder = []
  for (const t of tracker.turns) {
    for (const para of t.paragraphs) {
      currentTurn.set(para.id, t.id)
      oldOrder.push({ id: para.id, turnId: t.id })
    }
  }
  const oldIndex = new Map(oldOrder.map((x, i) => [x.id, i]))
  const incoming = new Set(paragraphs.map(x => x?.id).filter(Boolean))

  // Inherit from whatever STOOD IN THIS PLACE before, falling back to the previous paragraph only
  // when nothing did. This is what makes a rewrite not a turn: it replaces a run of paragraphs
  // with brand-new ids, in a different count, and inheriting from the previous paragraph would
  // collapse every boundary inside the rewritten span. Walking the replaced slots keeps them.
  let cursor = 0
  const takeReplacedTurn = () => {
    while (cursor < oldOrder.length && incoming.has(oldOrder[cursor].id)) cursor++
    return cursor < oldOrder.length ? oldOrder[cursor++].turnId : null
  }

  const turns = []
  const used = new Set()
  let previousTurn = null
  for (const para of paragraphs) {
    if (!para?.id) continue
    let tid = para.turnId ?? currentTurn.get(para.id)
    if (currentTurn.has(para.id)) {
      // Keep the walk aligned with the document: a paragraph that survived consumes its own slot.
      const at = oldIndex.get(para.id)
      if (at != null && at >= cursor) cursor = at + 1
    } else if (tid == null) {
      tid = takeReplacedTurn() ?? previousTurn ?? `turn:${para.id}`
    }
    const open = turns[turns.length - 1]
    if (!open || open.id !== tid) {
      // A turn id that comes back after something else interrupted it is not the same turn any
      // more — the author moved text across a boundary. Give the second run its own id rather
      // than producing two turns that answer to the same name.
      if (used.has(tid)) { let n = 2; while (used.has(`${tid}#${n}`)) n++; tid = `${tid}#${n}` }
      used.add(tid)
      turns.push({ id: tid, paragraphs: [] })
    }
    turns[turns.length - 1].paragraphs.push({ id: para.id, text: para.text ?? '' })
    previousTurn = tid
  }

  keepEmptiedTurns(tracker.turns, turns, incoming)

  const at = firstDifference(tracker.turns, turns)
  if (at == null) return tracker   // nothing moved; do not touch the replay or the journal
  return spliceTurns(tracker, at, tracker.turns.length - at, turns.slice(at), 'sync')
}

/**
 * A turn that lost every paragraph to a LATER turn is kept, empty. Mutates `turns` in place.
 *
 * A generation usually appends into the previous one's last paragraph; when it adds no paragraph
 * of its own, stamping that one empties the turn it came from. Two such generations in a row and
 * the second takes the seam from the first — so without this a run of inline-only continuations
 * moves the turn clock once and then stops, freezing `staleFor`/`sinceBest` and the whole
 * settle-then-fire model with it.
 *
 * Only when the paragraphs are still IN the document: a turn whose paragraphs were deleted is
 * genuinely gone, which is what stops undo and truncation leaving phantom turns behind.
 */
function keepEmptiedTurns(oldTurns, turns, incoming) {
  const indexOfTurn = new Map(turns.map((t, i) => [t.id, i]))
  const turnOfParagraph = new Map()
  for (const [i, t] of turns.entries()) for (const para of t.paragraphs) turnOfParagraph.set(para.id, i)

  // Where each old turn lands: a survivor on itself, an emptied one wherever its earliest
  // paragraph went, an already-empty one just before whichever later turn does land.
  const pending = []
  const insertions = new Map()   // new-list index -> ids to insert there, in order
  const placeBefore = (at, id) => {
    const arr = insertions.get(at)
    if (arr) arr.push(id); else insertions.set(at, [id])
  }

  for (const old of oldTurns) {
    let at = indexOfTurn.get(old.id) ?? null
    if (at == null) {
      for (const para of old.paragraphs) {
        if (!incoming.has(para.id)) continue
        const i = turnOfParagraph.get(para.id)
        if (i != null && (at == null || i < at)) at = i
      }
    }
    if (at == null) {
      // Nowhere to land: either still waiting for an anchor, or its paragraphs were deleted and
      // the turn goes with them.
      if (!old.paragraphs.length) pending.push(old.id)
      continue
    }
    for (const id of pending) placeBefore(at, id)
    pending.length = 0
    if (!indexOfTurn.has(old.id)) placeBefore(at, old.id)
  }

  // Right to left, so the indices computed above stay valid.
  for (const at of [...insertions.keys()].sort((a, b) => b - a)) {
    turns.splice(at, 0, ...insertions.get(at).map(id => ({ id, paragraphs: [] })))
  }
}

/** Index of the first turn that differs, or null when the two lists are identical. */
function firstDifference(a, b) {
  const n = Math.max(a.length, b.length)
  for (let i = 0; i < n; i++) {
    const x = a[i], y = b[i]
    if (!x || !y) return i
    if (x.id !== y.id || x.paragraphs.length !== y.paragraphs.length) return i
    for (let j = 0; j < x.paragraphs.length; j++) {
      if (x.paragraphs[j].id !== y.paragraphs[j].id || x.paragraphs[j].text !== y.paragraphs[j].text) return i
    }
  }
  return null
}
/** Undo back to this turn: drop everything after it. The shape an adventure's "undo" really has. */
export function truncateAfter(tracker, turnId) {
  const i = turnIndexOf(tracker, turnId)
  if (i < 0) return tracker
  return spliceTurns(tracker, i + 1, tracker.turns.length - i - 1, [], 'truncateAfter')
}

export function undo(tracker) {
  const op = tracker.journal.undo.pop()
  if (!op) return false
  const removed = tracker.turns.splice(op.index, op.insertedCount, ...op.removed)
  tracker.journal.redo.push({ ...op, removed, insertedCount: op.removed.length })
  invalidateFrom(tracker, op.index)
  return true
}

export function redo(tracker) {
  const op = tracker.journal.redo.pop()
  if (!op) return false
  const removed = tracker.turns.splice(op.index, op.insertedCount, ...op.removed)
  tracker.journal.undo.push({ ...op, removed, insertedCount: op.removed.length })
  invalidateFrom(tracker, op.index)
  return true
}

// ── replay ───────────────────────────────────────────────────────────────────

/** Every live paragraph, in corpus order, with its turn coordinates. */
function paragraphSequence(tracker) {
  const out = []
  for (const [ti, turn] of tracker.turns.entries()) {
    for (const p of turn.paragraphs) out.push({ id: p.id, text: p.text, turnId: turn.id, turnIndex: ti })
  }
  return out
}

function readingFor(tracker, text) {
  const r = readParagraph(text)
  const cached = tracker.readings.get(r.hash)
  if (cached) return cached
  tracker.readings.set(r.hash, r)
  return r
}

/**
 * Bring the replay up to date. Rolls back to `dirtyFrom` (rebuilding the prefix-only structures
 * from cached readings, which needs no text processing) and runs `interpret` forward from there.
 */
export function ensureReplay(tracker) {
  const seq = paragraphSequence(tracker)
  const from = tracker.dirtyFrom ?? (tracker.state.records.length < seq.length ? tracker.state.records.length : null)
  if (from == null && tracker.state.records.length === seq.length) return tracker

  const start = from ?? 0
  const st = tracker.state
  st.aliases = tracker.options.aliases ?? []
  // Everything downstream of `start` is dropped rather than unwound. Nothing here needs an inverse.
  //
  // The prefix is refolded from its cached Readings rather than unfolded: `case.low` counts depend
  // on the order words were first capitalised in, so subtracting a paragraph's contribution is not
  // the same as never having added it. Refolding is exact by construction and costs one pass over
  // small per-paragraph summaries — no text is touched. Appending skips it entirely, because
  // nothing before the new paragraph changed.
  if (start < st.records.length) {
    st.records = st.records.slice(0, start)
    st.lexis = createLexis()
    st.usage = createUsage()
    st.keyAgg = new Map()
    st.grouping = null
    st.groupCache = new Map()
    for (const rec of st.records) {
      addReading(st.lexis, rec.reading)
      for (const m of rec.mentions) addMentionUsage(st.usage, m)
      absorbKeys(st, rec)
    }
    regroup(st)
  }

  for (let i = start; i < seq.length; i++) {
    st.records.push(interpret(tracker, seq[i]))
  }
  tracker.dirtyFrom = null
  tracker.entities = null
  return tracker
}

/**
 * One paragraph, start to finish. The only place a paragraph is ever processed — "rebuild" is this
 * function in a loop, so there is no second path that can disagree with it.
 */
function interpret(tracker, para) {
  const st = tracker.state
  const reading = readingFor(tracker, para.text)

  // The paragraph joins the word history BEFORE it is admitted, so it is judged with its own
  // evidence as well as the story's. Turn-scope behaviour is then the first-turn case of the same
  // rule rather than a separate one.
  addReading(st.lexis, reading)

  const knownNameKeys = new Set()
  for (const [key, agg] of st.keyAgg) if (!agg.descriptor) knownNameKeys.add(key)

  const mentions = admitMentions(reading, para.id, st.lexis, knownNameKeys)
  for (const m of mentions) addMentionUsage(st.usage, m)

  const attribution = attributeParagraph(reading, mentions, {
    genderOf: key => groupGender(st, key),
    tallyOf: key => groupTally(st, key),
    isKnown: key => st.keyAgg.has(key),
    isNonPerson: key => isNonPerson(st, key, tracker.options.nonPersonMentions),
    options: tracker.options.attribution,
  })

  const scores = scoreParagraph(reading, mentions, attribution)

  const rec = {
    id: para.id, turnId: para.turnId, turnIndex: para.turnIndex,
    reading, mentions, attribution, scores,
  }
  absorbKeys(st, rec)
  return rec
}

/**
 * Fold a finished record into the running per-key aggregates.
 *
 * These exist ONLY to answer attribution's three questions about the story so far (is this key
 * known, what gender has it settled on, is it structurally not a person). They are not entity
 * state: entities are rebuilt from records, and nothing here is read once replay finishes.
 */
function absorbKeys(st, rec) {
  const descriptors = new Set((rec.attribution?.descriptors ?? []).map(d => d.key))
  let introduced = false
  const agg = (key, isDescriptor) => {
    let a = st.keyAgg.get(key)
    if (!a) {
      a = {
        tally: { m: 0, f: 0, n: 0, sm: 0, sf: 0 }, titles: {}, mentions: 0,
        spoke: 0, possessive: 0, descriptor: isDescriptor,
      }
      st.keyAgg.set(key, a)
      introduced = true
    }
    if (!isDescriptor) a.descriptor = false
    return a
  }
  for (const m of rec.mentions) {
    const a = agg(m.key, m.form === 'descriptor')
    a.mentions++
    // Character signals that owe nothing to gender — a speech tag, repeated possessives. Read here
    // so `settleGender` can tell an entity already established as a person from one that would be
    // established BY the gender it is about to be given.
    if (m.spoke) a.spoke++
    if (m.possessive) a.possessive++
    for (const t of analyseName(m.surface).titles) a.titles[t] = (a.titles[t] ?? 0) + 1
  }
  for (const d of rec.attribution?.descriptors ?? []) agg(d.key, true)
  for (const [key, t] of rec.attribution?.genderEvidence ?? []) {
    const a = agg(key, descriptors.has(key))
    a.tally.m += t.m ?? 0; a.tally.f += t.f ?? 0; a.tally.n += t.n ?? 0
    a.tally.sm += t.sm ?? 0; a.tally.sf += t.sf ?? 0
  }
  // Descriptions carry their gender in their head noun, which is a lexical fact rather than a
  // tally — record it so continuity can agree with "a woman" on the sentence she appears in.
  for (const d of rec.attribution?.descriptors ?? []) {
    if (!d.gender) continue
    const a = st.keyAgg.get(d.key)
    if (a) a.headGender = d.gender
  }
  if (introduced) { st.grouping = null; st.groupCache = new Map() }
}

/**
 * Regroup the keys seen so far, so attribution's "what gender has this settled on" question is
 * asked of the ENTITY, not of one of its surface forms ("Voss" and "Kaelen Voss" share a
 * verdict). Recomputed only when a new key appears, which is the same condition the old package
 * used — but here it is a cache, not a second code path: the answer is identical either way.
 */
function regroup(st) {
  const entries = new Map()
  for (const [key, a] of st.keyAgg) {
    if (a.descriptor) continue
    entries.set(key, { count: a.mentions, forms: new Map() })
  }
  st.grouping = groupSurfaces(entries, { lexis: st.lexis, usage: st.usage, aliases: st.aliases })
  st.groupCache = new Map()
}

function groupOf(st, key) {
  if (!st.grouping) regroup(st)
  const rootKey = st.grouping.root.get(key) ?? key
  let g = st.groupCache.get(rootKey)
  if (!g) {
    const members = st.grouping.groups.get(rootKey) ?? [key]
    g = {
      tally: { m: 0, f: 0, n: 0, sm: 0, sf: 0 }, titles: {}, mentions: 0,
      spoke: 0, possessive: 0, headGender: null,
    }
    for (const k of members) {
      const a = st.keyAgg.get(k)
      if (!a) continue
      g.tally.m += a.tally.m; g.tally.f += a.tally.f; g.tally.n += a.tally.n
      g.tally.sm += a.tally.sm ?? 0; g.tally.sf += a.tally.sf ?? 0
      for (const [t, n] of Object.entries(a.titles)) g.titles[t] = (g.titles[t] ?? 0) + n
      g.mentions += a.mentions
      g.spoke += a.spoke ?? 0
      g.possessive += a.possessive ?? 0
      g.headGender ??= a.headGender ?? null
    }
    st.groupCache.set(rootKey, g)
  }
  return g
}

function groupGender(st, key) {
  const a = st.keyAgg.get(key)
  if (!a) return null
  if (a.descriptor) return a.headGender ?? settleGender(genderFromTitles(a.titles), a.tally)
  const g = groupOf(st, key)
  const characterSignal = g.spoke > 0 || g.possessive >= 2 || Object.keys(g.titles).length > 0
  return settleGender(genderFromTitles(g.titles), g.tally, { characterSignal })
}

const groupTally = (st, key) => (st.keyAgg.has(key) ? groupOf(st, key).tally : null)

/**
 * A known entity with several mentions and still no gender is structurally not a person: nothing
 * CAN give a place or a spell name a gendered pronoun. A genuinely brand-new character is a
 * different case and is never caught by this, because they are simply absent from the aggregates
 * on the turn that introduces them.
 */
function isNonPerson(st, key, floor) {
  const a = st.keyAgg.get(key)
  if (!a || a.descriptor) return false
  if (groupGender(st, key)) return false
  return groupOf(st, key).mentions >= floor
}

// ── entity view ──────────────────────────────────────────────────────────────

/**
 * The turn shape, without text: how many paragraphs each turn holds, in order.
 *
 * Turns are not in the document — a paragraph carries its id, not the generation that wrote it —
 * so a rebuild from text alone cannot recover the boundaries, and a story reads as younger than it
 * is. Store this alongside the story to make the rebuild exact. A few bytes per turn.
 */
export const exportTurnLayout = (tracker) => tracker.turns.map(t => t.paragraphs.length)

/**
 * Rebuild the corpus from an ordered paragraph list plus a saved turn shape.
 *
 * Paragraphs go to turns by position, which is exact: the order they come back in is the order
 * they went in. A layout short of the document (the story grew) puts the remainder in one final
 * turn; a layout longer than it leaves empty turns, which is right — those turns happened, into a
 * paragraph since merged or deleted.
 *
 * @param {{id: string, text: string}[]} paragraphs  in document order
 * @param {number[]} layout                          from `exportTurnLayout`
 */
export function restoreTurns(tracker, layout, paragraphs) {
  const list = (paragraphs ?? []).filter(x => x?.id)
  const turns = []
  let at = 0
  for (const [i, n] of (layout ?? []).entries()) {
    const take = Math.max(0, Math.min(n | 0, list.length - at))
    turns.push({ id: `t${i}`, paragraphs: list.slice(at, at + take).map(x => ({ id: x.id, text: x.text ?? '' })) })
    at += take
  }
  if (at < list.length) {
    turns.push({ id: `t${turns.length}`, paragraphs: list.slice(at).map(x => ({ id: x.id, text: x.text ?? '' })) })
  }
  tracker.turns = turns
  tracker.journal.undo.length = 0
  tracker.journal.redo.length = 0
  tracker.dirtyFrom = 0
  tracker.entities = null
  return tracker
}
/**
 * Replace the user-declared alias table. Invalidates the replay, not just the entity view:
 * attribution asks the running grouping what gender a name settled on, and that answer has to
 * agree with the identity the aliases declare.
 */
export function setAliases(tracker, aliases = []) {
  const next = JSON.stringify(aliases)
  if (next === JSON.stringify(tracker.options.aliases ?? [])) return tracker
  tracker.options.aliases = aliases
  tracker.dirtyFrom = 0
  tracker.entities = null
  return tracker
}

export function entities(tracker) {
  ensureReplay(tracker)
  if (tracker.entities) return tracker.entities
  const st = tracker.state
  const anchors = resolveAnchors(st.records, { windowTurns: tracker.options.windowTurns })
  tracker.entities = buildEntities({
    records: st.records,
    anchors,
    lexis: st.lexis,
    usage: st.usage,
    aliases: tracker.options.aliases,
    registry: tracker.registry,
    turnCount: tracker.turns.length,
    decisions: tracker.decisions,
    paragraphTurn: new Map(st.records.map(r => [r.id, r.turnIndex])),
  })
  tracker.anchors = anchors
  return tracker.entities
}

export const entity = (tracker, id) => entities(tracker).get(resolveId(tracker.registry, id)) ?? null

export const resolve = (tracker, id) => resolveId(tracker.registry, id)

/** Paragraph text by id — the tracker holds the corpus, so hosts do not have to mirror it. */
export function paragraphText(tracker, paragraphId) {
  for (const t of tracker.turns) {
    for (const p of t.paragraphs) if (p.id === paragraphId) return p.text
  }
  return null
}

// ── decisions ────────────────────────────────────────────────────────────────
//
// Decisions are keyed by the normalised NAME the user acted on, never by entity — so they survive
// regrouping, renaming, deletion and rebuild without any merge rules of their own. The old package
// carried eight decision fields on every entity and had to combine them pairwise on a merge and
// replicate them across fragments on a split; there is nothing to combine here.

function decisionFor(tracker, ref) {
  const e = entity(tracker, ref)
  const name = e ? e.name : ref
  return normalizeName(name) || String(ref)
}

const touch = (tracker) => { tracker.entities = null }

/** Permanent: the user rejected this candidate. Survives the entity being rebuilt from scratch. */
export function dismiss(tracker, ref) {
  const k = decisionFor(tracker, ref)
  tracker.decisions[k] = { ...tracker.decisions[k], dismissed: true, at: tracker.turns.length }
  touch(tracker)
  return tracker
}

/**
 * Soft: "not sure yet". Automatically lifted when the entity's display name changes to one the user
 * has not seen, because they set it aside on less information than exists now.
 */
export function postpone(tracker, ref) {
  const k = decisionFor(tracker, ref)
  tracker.decisions[k] = { ...tracker.decisions[k], postponed: true, at: tracker.turns.length }
  touch(tracker)
  return tracker
}

/** The host built something from this candidate, so stop suggesting it. Reversible, unlike dismiss. */
export function promote(tracker, ref) {
  const k = decisionFor(tracker, ref)
  tracker.decisions[k] = { ...tracker.decisions[k], promoted: true, at: tracker.turns.length }
  touch(tracker)
  return tracker
}

/** Whatever was built is gone; the candidate can be offered again. */
export function release(tracker, ref) {
  const k = decisionFor(tracker, ref)
  if (tracker.decisions[k]) {
    const { promoted, ...rest } = tracker.decisions[k]
    tracker.decisions[k] = rest
  }
  touch(tracker)
  return tracker
}

// ── persistence ──────────────────────────────────────────────────────────────

/**
 * Everything needed to reconstruct this tracker. Plain JSON: no Maps, no Sets, nothing that needs a
 * revival step — the perennial bug of the old package's pool, whose caches came back from
 * localStorage as `{}` and had to be defended against with `instanceof` checks at four call sites.
 *
 * The derived layers are deliberately NOT serialised. They are a function of what is here.
 */
export function snapshot(tracker) {
  return {
    version: 1,
    turns: tracker.turns,
    decisions: tracker.decisions,
    // Carried so an entity id issued in an earlier session still means the same person after a
    // restore. Decisions do not need it (they are keyed by name), but anything the host stored by
    // id does — and it is three small plain objects.
    registry: tracker.registry,
    options: { ...tracker.options },
  }
}

export function restore(snap, options = {}) {
  const tracker = createTracker({ ...(snap.options ?? {}), ...options })
  tracker.turns = snap.turns ?? []
  tracker.decisions = snap.decisions ?? {}
  if (snap.registry) tracker.registry = { byKey: {}, alias: {}, next: 1, ...snap.registry }
  tracker.dirtyFrom = 0
  return tracker
}
