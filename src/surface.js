// src/surface.js
//
// Which candidates are worth showing the author, and a flat debug view of everything.
//
// The package's whole job ends here: it says "there is enough about this one to be worth offering".
// What a host does with that — how many are on screen, what a card is, how one gets generated — is
// deliberately outside. Pacing is a UI question and the tracker cannot see the UI.

import { entities } from './tracker.js'
import { normalizeName } from './names.js'

/**
 * Six count thresholds ANDed, with speech ORed around the turn requirement specifically: a tagged
 * speech event is high-precision and low-recall, so it is an accelerator rather than another AND
 * term. `allowedTypes` is absolute and runs first.
 */
export const DEFAULT_THRESHOLDS = {
  allowedTypes: ['character'],
  minTurns: 3,
  minMentions: 4,
  minScore: 4,
  minReturns: 0,
  minNarration: 0.5,
  /** Turns since anyone mentioned them — a settling delay, so a card is not offered mid-scene. */
  minStaleFor: 0,
  /** Turns since their best description — "has the description stopped growing". */
  minSinceBest: 1,
  /** How many turns of evidence a tagged speech event may substitute for. */
  speechCredit: 1,
}

/** Does this entity clear the thresholds, or has it spoken enough to skip the turn count? */
export function admits(e, t = DEFAULT_THRESHOLDS) {
  const r = { ...DEFAULT_THRESHOLDS, ...t }
  // A description is never suggested on its own. It exists to hold what is said about somebody
  // unnamed until a name claims it — offering "the tall woman" as a card names nobody.
  if (e.kind !== 'name') return false
  if (r.allowedTypes?.length && !r.allowedTypes.includes(e.type ?? 'untyped')) return false
  const turnsNeeded = Math.max(1, r.minTurns - Math.min(e.spoke ?? 0, r.speechCredit ?? 0))
  return e.turnsSeen >= turnsNeeded
    && e.mentions >= r.minMentions
    && (e.bestScore ?? 0) >= (r.minScore ?? 0)
    && e.returns >= r.minReturns
    && e.narrationRatio >= r.minNarration
    && e.staleFor >= r.minStaleFor
    && e.sinceBest >= r.minSinceBest
}

/**
 * Candidates with enough evidence to show, best first.
 *
 * `exclude` is whatever names the host already owns (an existing card's title and keys). Raw
 * strings: the host hands over what it has and this normalises them, so matching stays correct
 * against the tracker's own key scheme without the host knowing anything about it.
 */
export function suggestions(tracker, { thresholds = DEFAULT_THRESHOLDS, exclude = [] } = {}) {
  const skip = new Set(exclude.map(normalizeName).filter(Boolean))
  return [...entities(tracker).values()]
    .filter(e => !e.dismissed && !e.postponed && !e.promoted)
    .filter(e => !skip.has(normalizeName(e.name)) && !e.keys.some(k => skip.has(k)))
    .filter(e => admits(e, thresholds))
    .sort((a, b) => (b.returns - a.returns) || (b.turnsSeen - a.turnsSeen) || (b.mentions - a.mentions))
}

/** Every entity as a flat row, for a debug view. Includes what the gates said and why. */
export function debugRows(tracker, thresholds = DEFAULT_THRESHOLDS) {
  const rows = [...entities(tracker).values()].map(e => ({
    id: e.id,
    name: e.name,
    kind: e.kind,
    type: e.type ?? '—',
    gender: e.gender ?? '—',
    turns: e.turnsSeen,
    mentions: e.mentions,
    returns: e.returns,
    spoke: e.spoke,
    narration: `${Math.round(e.narrationRatio * 100)}%`,
    staleFor: e.staleFor,
    sinceBest: e.sinceBest,
    bestScore: e.bestScore,
    passes: admits(e, thresholds),
    dismissed: e.dismissed,
    postponed: e.postponed,
    promoted: e.promoted,
    titles: Object.keys(e.titles).join(', ') || '—',
    traits: e.traits.join(', ') || '—',
    descriptions: Object.keys(e.descriptions).join(' | ') || '—',
    surfaces: Object.keys(e.surfaces).join(' | ') || '—',
  })).sort((a, b) => Number(b.passes) - Number(a.passes) || b.turns - a.turns)

  return {
    turns: tracker.turns.length,
    paragraphs: tracker.turns.reduce((n, t) => n + t.paragraphs.length, 0),
    entities: rows.length,
    passing: rows.filter(r => r.passes).length,
    rows,
  }
}

/**
 * Does this candidate's identity look like a FRAGMENT of one already promoted, rather than a
 * distinct person? Set containment, so it generalises across name length, order and family-name-
 * first conventions without guessing which token is the surname: two siblings sharing a surname
 * ("Elizabeth Bennet"/"Jane Bennet") each carry a token the other lacks and never trip this; a bare
 * "Bennet" against either does.
 *
 * Read-only and non-blocking: returns what it overlaps and lets the host decide, same split as
 * everything else here.
 */
export function overlapsPromoted(tracker, id) {
  const all = entities(tracker)
  const e = all.get(id)
  if (!e) return []
  const ta = normalizeName(e.name).split(' ')
  const out = []
  for (const other of all.values()) {
    if (other === e || !other.promoted) continue
    const tb = normalizeName(other.name).split(' ')
    if (!ta.every(t => tb.includes(t))) continue
    out.push(other)
  }
  return out
}
