// entity-tracker — public API
//
// Two ways in, the same code underneath:
//
//   const t = new EntityTracker()          object facade, what a host usually wants
//   t.addTurn('t1', text)
//   t.suggestions()
//
//   import { createTracker, addTurn } from 'entity-tracker/index.js'    plain functions over
//                                                                        plain data
//
// The tracker is plain JSON-serialisable data with derived caches hanging off it. `snapshot()` gives
// you the storable half; `EntityTracker.restore(snap)` brings it back and recomputes the rest.

import {
  createTracker, addTurn, setTurn, setParagraph, removeParagraph, removeTurn, truncateAfter,
  syncParagraphs, setAliases, exportTurnLayout, restoreTurns, undo, redo, entities, entity, resolve, paragraphText, ensureReplay,
  dismiss, postpone, promote, release, snapshot, restore, DEFAULT_OPTIONS,
} from './src/tracker.js'
import { suggestions, debugRows, admits, overlapsPromoted, DEFAULT_THRESHOLDS } from './src/surface.js'

export {
  createTracker, addTurn, setTurn, setParagraph, removeParagraph, removeTurn, truncateAfter,
  syncParagraphs, setAliases, exportTurnLayout, restoreTurns, undo, redo, entities, entity, resolve, paragraphText, ensureReplay,
  dismiss, postpone, promote, release, snapshot, restore,
  suggestions, debugRows, admits, overlapsPromoted,
  DEFAULT_OPTIONS, DEFAULT_THRESHOLDS,
}

// Tier 1 — pure, per-paragraph, no accumulation. Usable on their own for a one-shot pass over text.
export { readParagraph } from './src/read/reading.js'
export { admitMentions } from './src/admit.js'
export { attributeParagraph } from './src/attribute/attribute.js'

// Identity and name handling, exported because a host needs the tracker's own key scheme to build
// an exclusion list out of names it already owns.
export { normalizeName, analyseName, isNoise, looksDescriptive } from './src/names.js'
export { groupSurfaces } from './src/identity/group.js'

// Appearance slots the story has already settled — a host building a card generator needs this to
// avoid offering a hair colour for a character the text already describes.
export { establishedSlots } from './src/read/traits.js'

/** Object facade over the functional core. Holds no state of its own beyond the tracker. */
export class EntityTracker {
  constructor(options = {}) { this.t = createTracker(options) }

  /** Append one generation. `content` is text (split on blank lines) or an array of paragraphs. */
  addTurn(turnId, content) { addTurn(this.t, turnId, content); return this }
  /** Replace a turn's text — a retry. Everything from it onward is recomputed. */
  setTurn(turnId, content) { setTurn(this.t, turnId, content); return this }
  setParagraph(paragraphId, text) { setParagraph(this.t, paragraphId, text); return this }
  removeParagraph(paragraphId) { removeParagraph(this.t, paragraphId); return this }
  removeTurn(turnId) { removeTurn(this.t, turnId); return this }
  /** Make the corpus match this exact ordered paragraph list — see syncParagraphs. */
  sync(paragraphs) { syncParagraphs(this.t, paragraphs); return this }
  /** Replace the user-declared alias table (a card's own keys). Authoritative over every heuristic. */
  setAliases(aliases) { setAliases(this.t, aliases); return this }
  /** The turn shape, for a host to store alongside the story so a rebuild is exact. */
  turnLayout() { return exportTurnLayout(this.t) }
  restoreTurns(layout, paragraphs) { restoreTurns(this.t, layout, paragraphs); return this }
  /** Drop everything after this turn — an adventure's "undo to here". */
  truncateAfter(turnId) { truncateAfter(this.t, turnId); return this }

  undo() { return undo(this.t) }
  redo() { return redo(this.t) }

  entities() { return [...entities(this.t).values()] }
  entity(id) { return entity(this.t, id) }
  /** Follow a reference of any age to the entity that currently holds it. */
  resolve(id) { return resolve(this.t, id) }
  paragraphText(id) { return paragraphText(this.t, id) }
  /** Excerpts for an entity, resolved to text: the paragraphs that describe it best. */
  excerpts(id) {
    const e = this.entity(id)
    return e ? e.bestParagraphs.map(p => paragraphText(this.t, p)).filter(Boolean) : []
  }

  suggestions(opts) { return suggestions(this.t, opts) }
  debug(thresholds) { return debugRows(this.t, thresholds) }

  dismiss(ref) { dismiss(this.t, ref); return this }
  postpone(ref) { postpone(this.t, ref); return this }
  promote(ref) { promote(this.t, ref); return this }
  release(ref) { release(this.t, ref); return this }
  overlapsPromoted(id) { return overlapsPromoted(this.t, id) }

  snapshot() { return snapshot(this.t) }
  static restore(snap, options) {
    const w = new EntityTracker()
    w.t = restore(snap, options)
    return w
  }
}
