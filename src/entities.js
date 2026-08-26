// src/entities.js
//
// Entities, assembled from the paragraphs currently live.
//
// THE CENTRAL DESIGN DECISION OF THIS PACKAGE LIVES HERE. An entity owns no data. It is a view over
// (mentions, attributions) grouped by the current identity partition, computed on demand and thrown
// away when the corpus changes.
//
// The old package accumulated instead: every entity held per-paragraph records with a dozen
// pre-merged fields, a declarative merge table, a projection pass to re-fold them, a retroactive
// per-record splitter that had to divide a record's aggregates by majority when a regroup disagreed
// (losing information by construction, as its own comment admitted), a fast merge path and a slow
// one that were known to disagree, and a documented inability to un-merge. All of that is what it
// costs to keep derived data around. Deriving it instead deletes the whole category:
//
//   * un-merge is free           — the bridge surface is gone, so the group is gone
//   * removing a paragraph is a  — nothing to subtract, nothing to invert
//     deletion, not an inverse
//   * a regroup cannot lose data — mentions are re-partitioned, never split by majority
//   * there is one path          — the "fast path" was an optimisation over accumulated state
//
// The cost is recomputation, and it is bounded: everything below is a scan over mention records,
// with no text processing (that is cached in Readings) and no regex work.

import { groupSurfaces } from './identity/group.js'
import { assignIds } from './identity/registry.js'
import { route } from './anchors.js'
import { analyseName, normalizeName, genderFromTitles } from './names.js'
import { resolveGender, settleGender, consistentTraits } from './profile/gender.js'
import { resolveType } from './profile/type.js'

const KEEP_PARAGRAPHS = 3   // per entity — top 3 by description score covered the richest passage
                            // 100% of the time in the old package's measurement

const bump = (obj, k, n = 1) => { obj[k] = (obj[k] ?? 0) + n }


/**
 * Route every paragraph's contribution to the key that owns it, and drop what belongs to a
 * description that never earned an identity.
 *
 * @param {object[]} records   live paragraph records, in corpus order
 * @param {object} anchors     from src/anchors.js
 */
export function collectKeys(records, anchors) {
  const keys = new Map()
  const of = (key) => {
    let d = keys.get(key)
    if (!d) {
      d = {
        key,
        surfaces: {}, descriptions: {}, titles: {}, honorifics: {},
        mentions: [], mentionsByTurn: new Map(),
        traits: {}, genderTally: { m: 0, f: 0, n: 0, sm: 0, sf: 0 },
        speakerTurns: new Set(), scores: new Map(),
        turns: new Set(), firstTurn: Infinity, lastTurn: -1,
      }
      keys.set(key, d)
    }
    return d
  }

  for (const rec of records) {
    const descriptorKeys = new Set((rec.attribution?.descriptors ?? [])
      .map(d => d.key).filter(k => !anchors.nameKeys.has(k)))
    const target = (key) => route(anchors, rec.id, key, descriptorKeys.has(key))

    for (const m of rec.mentions) {
      const t = target(m.key)
      if (!t) continue
      const d = of(t)
      // A description contributes to what this entity is CALLED only when it is a name. The old
      // package had to strip `surfaces` in a bespoke merge primitive to achieve this, because a
      // claimed referent's phrase leaking into the survivor made the next regroup split them apart
      // again. Here the two are simply different fields.
      if (descriptorKeys.has(m.key) || m.form === 'descriptor') bump(d.descriptions, m.surface)
      else {
        bump(d.surfaces, m.surface)
        const parts = analyseName(m.surface)
        for (const x of parts.titles) bump(d.titles, x)
        for (const x of parts.honorifics) bump(d.honorifics, x)
      }
      d.mentions.push(m)
      const arr = d.mentionsByTurn.get(rec.turnId) ?? []
      arr.push(m)
      d.mentionsByTurn.set(rec.turnId, arr)
      d.turns.add(rec.turnIndex)
      d.firstTurn = Math.min(d.firstTurn, rec.turnIndex)
      d.lastTurn = Math.max(d.lastTurn, rec.turnIndex)
    }

    // A phrase description is a real reference to somebody — "the kraken" is a mention of the
    // Kraken, and "a wiry agent" is where race, role and build live, none of which the trait
    // extractor returns anything for. It has no admitted span of its own (it is not capitalised),
    // so it contributes a mention record here, carrying no name-evidence facts: a description never
    // speaks, never possesses and never counts as a surface form.
    for (const desc of rec.attribution?.descriptors ?? []) {
      if (desc.source !== 'phrase') continue
      const t = target(desc.key)
      if (!t) continue
      const d = of(t)
      bump(d.descriptions, desc.surface ?? desc.key)
      const m = {
        id: `${rec.id}#d${desc.at}`, paragraphId: rec.id, sentence: desc.sentence,
        offset: desc.at, surface: desc.surface ?? desc.key, key: desc.key, form: 'descriptor',
        inQuote: false, spoke: false, possessive: false, standalone: false,
        dearPoor: false, locative: false, nearSpeech: false, via: 'description',
      }
      d.mentions.push(m)
      const arr = d.mentionsByTurn.get(rec.turnId) ?? []
      arr.push(m)
      d.mentionsByTurn.set(rec.turnId, arr)
      d.turns.add(rec.turnIndex)
      d.firstTurn = Math.min(d.firstTurn, rec.turnIndex)
      d.lastTurn = Math.max(d.lastTurn, rec.turnIndex)
    }

    for (const tr of rec.attribution?.traits ?? []) {
      if (!tr.key) continue
      const t = target(tr.key)
      if (!t) continue
      const d = of(t)
      const cur = d.traits[tr.text] ?? { count: 0, from: tr.from ?? null }
      cur.count++
      // First-seen pronoun class wins: the trait is being counted, not re-decided.
      if (cur.from == null) cur.from = tr.from ?? null
      d.traits[tr.text] = cur
    }

    for (const [key, tally] of rec.attribution?.genderEvidence ?? []) {
      const t = target(key)
      if (!t) continue
      const d = of(t)
      d.genderTally.m += tally.m ?? 0
      d.genderTally.f += tally.f ?? 0
      d.genderTally.n += tally.n ?? 0
      d.genderTally.sm += tally.sm ?? 0
      d.genderTally.sf += tally.sf ?? 0
    }

    for (const key of rec.attribution?.speakers ?? []) {
      const t = target(key)
      if (t) of(t).speakerTurns.add(rec.turnId)
    }

    for (const [key, score] of Object.entries(rec.scores ?? {})) {
      const t = target(key)
      if (!t || !score) continue
      of(t).scores.set(rec.id, Math.max(of(t).scores.get(rec.id) ?? 0, score))
    }
  }
  return keys
}

/**
 * Build every entity. Pure: same inputs, same output, in any order of ingest.
 *
 * @param {object} args
 * @param {object[]} args.records      live paragraph records, in corpus order
 * @param {object} args.anchors        from resolveAnchors
 * @param {object} args.lexis
 * @param {object} args.usage
 * @param {string[][]} args.aliases
 * @param {object} args.registry       mutated: stable ids are assigned here
 * @param {number} args.turnCount
 * @param {Map<string, number>} args.paragraphTurn  paragraph id -> its turn's index, so
 *   `sinceBest` is measured in TURNS like every other surfacing threshold
 * @param {object} args.decisions      keyed by normalised display name
 * @param {(key: string) => 'm'|'f'|'n'|null} [args.priorGender]  used only to refuse a merge
 *   between two keys the story has already gendered differently
 * @returns {Map<string, object>} entity id -> entity
 */
export function buildEntities({
  records, anchors, lexis, usage, aliases = [], registry, turnCount, decisions = {},
  paragraphTurn = new Map(),
}) {
  const keys = collectKeys(records, anchors)

  // Each key's own settled gender, for identity's merge guard — a title, or a 2:1 pronoun majority.
  // Deliberately not a mere lean: measured across six real transcripts, a lean-based guard fired
  // exactly once and was wrong both times it could have been right, because a one-mention variant of
  // an established name ("Garreth Wrenmoor" against "Garreth") and a genuinely different person
  // sharing a surname ("Marisol Halden" against "Halden") are indistinguishable at one data
  // point. See README's known limits.
  const keyGender = new Map()
  for (const [key, d] of keys) {
    keyGender.set(key, settleGender(genderFromTitles(d.titles), d.genderTally))
  }

  // Descriptions are grouped by nothing at all. They are isolated from surface grouping on purpose:
  // two unrelated descriptions can normalise to the identical string, which is exactly how the old
  // package's referents silently merged strangers, and a description is never the right target for
  // a real name to bind to either.
  const nameEntries = new Map()
  for (const [key, d] of keys) {
    if (anchors.descriptorKeys.has(key)) continue
    const forms = new Map(Object.entries(d.surfaces))
    nameEntries.set(key, { count: d.mentions.length, forms })
  }

  const { root, groups } = groupSurfaces(nameEntries, {
    aliases, lexis, usage,
    descriptorKeys: anchors.descriptorKeys,
    genderOf: k => keyGender.get(k) ?? null,
  })
  for (const key of keys.keys()) {
    if (anchors.descriptorKeys.has(key) && !groups.has(key)) groups.set(key, [key])
  }

  const weight = new Map([...keys].map(([k, d]) => [k, d.mentions.length]))
  const ids = assignIds(registry, groups, weight)

  const out = new Map()
  for (const [rootKey, memberKeys] of groups) {
    const id = ids.get(rootKey)
    const parts = memberKeys.map(k => keys.get(k)).filter(Boolean)
    if (!parts.length) continue
    out.set(id, buildOne({
      id, rootKey, memberKeys, parts, anchors, turnCount, decisions, paragraphTurn,
    }))
  }
  return out
}

function buildOne({ id, rootKey, memberKeys, parts, anchors, turnCount, decisions, paragraphTurn }) {
  const surfaces = {}, descriptions = {}, titles = {}, honorifics = {}, traits = {}
  const tally = { m: 0, f: 0, n: 0, sm: 0, sf: 0 }
  const mentionsByTurn = new Map()
  const speakerTurns = new Set()
  const scores = new Map()
  const turns = new Set()
  let mentions = 0, inQuote = 0, spoke = 0, possessive = 0

  for (const p of parts) {
    for (const [k, n] of Object.entries(p.surfaces)) bump(surfaces, k, n)
    for (const [k, n] of Object.entries(p.descriptions)) bump(descriptions, k, n)
    for (const [k, n] of Object.entries(p.titles)) bump(titles, k, n)
    for (const [k, n] of Object.entries(p.honorifics)) bump(honorifics, k, n)
    for (const [text, t] of Object.entries(p.traits)) {
      const cur = traits[text] ?? { count: 0, from: t.from }
      cur.count += t.count
      if (cur.from == null) cur.from = t.from
      traits[text] = cur
    }
    tally.m += p.genderTally.m; tally.f += p.genderTally.f; tally.n += p.genderTally.n
    tally.sm += p.genderTally.sm ?? 0; tally.sf += p.genderTally.sf ?? 0
    for (const [turnId, ms] of p.mentionsByTurn) {
      const arr = mentionsByTurn.get(turnId) ?? []
      arr.push(...ms)
      mentionsByTurn.set(turnId, arr)
    }
    for (const t of p.speakerTurns) speakerTurns.add(t)
    for (const [pid, s] of p.scores) scores.set(pid, Math.max(scores.get(pid) ?? 0, s))
    for (const t of p.turns) turns.add(t)
    for (const m of p.mentions) {
      mentions++
      if (m.inQuote) inQuote++
      if (m.spoke) spoke++
      if (m.possessive) possessive++
    }
  }

  const isDescription = anchors.descriptorKeys.has(rootKey)
  const name = isDescription
    ? (pickName(descriptions, {}) || rootKey)
    : (pickName(surfaces, titles) || pickName(descriptions, {}) || rootKey)

  // A gendered title settles it outright. For a description, its own head noun is next: "a woman"
  // is gendered by English vocabulary, not by how many times she happens to get "she"'d — the
  // accumulated-majority threshold exists for entities of unknown type (an org, a place) where a
  // pronoun might be incidental, and a description was already screened as a person.
  // A title decides, and `settleGender` may deliberately decide NOTHING when the pronouns
  // overwhelmingly contradict it — so a title present is the end of the question either way, and
  // must not fall through to the tally it just refused.
  const fromTitle = genderFromTitles(titles)
  // Gender-free evidence that this is a person at all — the same facts typing reads, never typing's
  // verdict, which would invert the dependency.
  const characterSignal = spoke > 0 || possessive >= 2 || Object.keys(titles).length > 0
  const gender = fromTitle
    ? settleGender(fromTitle, tally)
    : (isDescription ? (anchors.descriptorInfo.get(rootKey)?.gender ?? null) : null)
      ?? settleGender(null, tally, { characterSignal })

  const { type, lean, profile } = resolveType({
    name, mentionsByTurn, speakerTurns, hasTitle: Object.keys(titles).length > 0, gender,
  })

  const turnList = [...turns].sort((a, b) => a - b)
  let returns = 0
  for (let i = 1; i < turnList.length; i++) if (turnList[i] - turnList[i - 1] > 1) returns++

  const ranked = [...scores.entries()].filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1])
  const bestScore = ranked.length ? ranked[0][1] : 0
  const bestParagraphs = ranked.slice(0, KEEP_PARAGRAPHS).map(([pid]) => pid)
  const lastTurn = turnList[turnList.length - 1] ?? -1
  const bestTurnIndex = ranked.length ? paragraphTurn.get(ranked[0][0]) : null

  const decisionKey = normalizeName(name)
  const decision = decisions[decisionKey] ?? {}

  return {
    id,
    key: rootKey,
    keys: memberKeys,
    name,
    kind: isDescription ? 'description' : 'name',
    surfaces, descriptions, titles, honorifics,
    gender, type, lean, typeProfile: profile,
    traits: consistentTraits(traits, gender),
    traitCounts: traits,
    mentions,
    turnsSeen: turns.size,
    spoke,
    inQuote,
    narrationRatio: mentions ? 1 - inQuote / mentions : 0,
    returns,
    firstTurn: turnList[0] ?? -1,
    lastTurn,
    staleFor: Math.max(0, turnCount - 1 - lastTurn),
    // Turns since the best-described paragraph — "has the description stopped growing", as opposed
    // to staleFor's "has anyone mentioned them". Zero until there IS a description worth waiting
    // past, or it would fire EARLIER than no rule at all for anyone never described.
    sinceBest: bestTurnIndex == null ? 0 : Math.max(0, turnCount - 1 - bestTurnIndex),
    bestScore,
    bestParagraphs,
    dismissed: Boolean(decision.dismissed),
    postponed: Boolean(decision.postponed),
    promoted: Boolean(decision.promoted),
  }
}

// Display name: the most COMPLETE form. Frequency alone picks the least informative name —
// "Alaric" outnumbers "Alaric Stormbrand" heavily, and a card wants the full one. Ranked by
// descriptive-looking last, then token count, then non-possessive, then frequency, then length.
//
// A mononym then gets its title back: "Principal Ophira" identifies her, "Ophira" barely does. Only
// for single-token names — "Kaelen Voss" is already specific and does not need "Teacher" bolted on.
const TITLE_MIN = 2
const UNNAMED_FORM = /^(?:the|a|an|another|some|one)\s+/i
const isUnnamedForm = (form) => UNNAMED_FORM.test(form) || !/^\p{Lu}/u.test(form)

export function pickName(surfaces, titles = {}) {
  const best = Object.entries(surfaces)
    .map(([form, c]) => ({
      form, c,
      tokens: normalizeName(form).split(' ').filter(Boolean).length,
      poss: /['’]s?\s*$/.test(form) ? 1 : 0,
      unnamed: isUnnamedForm(form) ? 1 : 0,
    }))
    .sort((a, b) => a.unnamed - b.unnamed
      || b.tokens - a.tokens || a.poss - b.poss || b.c - a.c || b.form.length - a.form.length)[0]
  if (!best) return ''
  // A name only ever seen possessively ("Ophira's desk") still names the entity. Ranking pushes
  // possessives last, but when it is the only form it wins by default and must be cleaned.
  const form = best.form.replace(/['’]s?\s*$/, '')
  if (best.tokens !== 1) return form
  const [title, n] = Object.entries(titles).sort((a, b) => b[1] - a[1])[0] ?? []
  if (!title || n < TITLE_MIN) return form
  // Reuse a form the text actually used if there is a clean one; only construct as a fallback.
  const attested = Object.keys(surfaces).find(f =>
    !/['’]s?\s*$/.test(f) && f.toLowerCase().startsWith(title.toLowerCase() + ' '))
  return attested ?? `${title[0].toUpperCase()}${title.slice(1)} ${form}`
}
