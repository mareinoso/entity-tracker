// src/attribute/attribute.js
//
// Whose sentence is this, and whose trait is that.
//
// One paragraph in, one verdict per sentence out. Everything the old package split across
// `observe()`'s rules 1-4, its rule 3b, `classifyPhrases`' propose/block/waive/redirect verdicts,
// `creditMixedPronouns` and `claimReferents` happens here, in one pass, sharing one focus window
// (./focus.js) and one agreement gate. Those mechanisms were not redundant — each answers a real
// question — but they were five callers of four half-copies of the same "who is in play" state, and
// three of them had independently drifted into the same bug.
//
// The output is keyed by KEY, never by entity: attribution runs before this paragraph is folded
// into the story's identity grouping, exactly as the old package did, so identity can be recomputed
// from scratch later without invalidating any of this.

import { ANIMATE_MIN, BLOCK_MIN, genderOfHead } from '../read/phrases.js'
import { speaksAt } from '../read/speech.js'
import { normalizeName, looksDescriptive, analyseName, genderFromTitles } from '../names.js'
import { headTypeOf } from '../profile/type.js'
import {
  createFocus, enter, shade, owned, tick, candidates, namedInFocus, uniqueAgreeing, isShaded, BLOCKED,
} from './focus.js'

// Names ending in s take a bare apostrophe — "Holmes' pipe". Requiring `'s` missed every one.
const possessiveRe = (key) => {
  const last = key.trim().split(/\s+/).pop().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`\\b${last}['’]s?(?![\\w])`, 'i')
}

// `sm`/`sf` count the male/female credits that did NOT come from the deferred `carry` rule. Gender
// is normally settled by a 2:1 majority over two observations; one strong observation is allowed to
// settle it for an entity already established as a person by other means (src/profile/gender.js),
// and this is how the resolver knows whether the evidence it has is that kind. Two counters rather
// than full per-rule provenance because measured, excluding `carry` is the whole of the difference:
// after its two gates the other rules sit at 0-3% error.
const emptyTally = () => ({ m: 0, f: 0, n: 0, sm: 0, sf: 0 })

/**
 * @param {object} reading                     src/read/reading.js
 * @param {import('../admit.js').Mention[]} mentions
 * @param {object} ctx
 * @param {(key: string) => 'm'|'f'|'n'|null} ctx.genderOf     settled gender BEFORE this paragraph
 * @param {(key: string) => object|null} ctx.tallyOf           raw gender tally before this paragraph
 * @param {(key: string) => boolean} ctx.isKnown               did this key exist before this paragraph
 * @param {(key: string) => boolean} ctx.isNonPerson           known, several mentions, still no gender
 * @param {object} [ctx.options]
 * @param {object} [ctx.focus]                 carry a previous paragraph's focus in (off by default)
 * @returns {{
 *   sentences: {owner: string|null, pronounClass: string|null}[],
 *   traits: {text: string, offset: number, sentence: number, key: string|null, from: string|null}[],
 *   genderEvidence: Map<string, {m,f,n}>,
 *   descriptors: {key, sentence, gender, source, distinctive, at, end}[],
 *   claims: Map<string, string>,     descriptor key -> the name that claimed it, this paragraph
 *   genderTrace: object[]|null,      one entry per gender credit when `traceGender` is on
 *   speakers: Set<string>,           keys that self-identified inside a quote
 *   focus: object,                   trailing focus state
 * }}
 */
export function attributeParagraph(reading, mentions, ctx) {
  const {
    genderOf = () => null, tallyOf = () => null, isKnown = () => false, isNonPerson = () => false,
    options = {}, focus: priorFocus = null,
  } = ctx
  const {
    definiteDescriptors = true,   // propose "the mage" as a descriptor, not just "a mage"
    widenWaiver = true,           // let a predicative description rename a name from an earlier sentence
    forwardClaim = true,          // "a stern-faced woman ... I am Ophira"
    mixedPronouns = true,         // credit gender per pronoun in a sentence that mixes classes
    // Record where every gender data point came from. Off by default and free when off; gender is
    // the signal with the widest blast radius (it steers attribution, typing and the trait filter)
    // and "which sentence said that" had no answer before this.
    traceGender = false,
  } = options

  const text = reading.text
  const sents = reading.sentences
  const focus = createFocus(priorFocus)

  const genderEvidence = new Map()
  const traits = []
  const descriptors = []
  const claims = new Map()
  const sentences = []
  const speakers = new Set()

  const genderTrace = traceGender ? [] : null
  let tracedSentence = -1
  const bumpGender = (key, cls, why = 'sentence') => {
    if (!key || key === BLOCKED) return
    const t = genderEvidence.get(key) ?? emptyTally()
    t[cls]++
    if (why !== 'carry' && cls !== 'n') t[cls === 'm' ? 'sm' : 'sf']++
    genderEvidence.set(key, t)
    genderTrace?.push({ key, cls, why, sentence: tracedSentence })
  }

  // A key's gender as this paragraph sees it: the story's settled verdict, or a descriptor's own
  // head noun, which is a lexical fact rather than evidence needing corroboration.
  const localGender = new Map()
  const genderNow = (key) => localGender.get(key) ?? genderOf(key) ?? null

  // Rule 3b's forward binding is deliberately tolerant of an UNRESOLVED gender (a brand-new name
  // has none, and that is exactly the case it exists for). "Unresolved" is not "no evidence": a
  // candidate can have same-paragraph evidence that already disagrees. Any opposing evidence with
  // zero supporting evidence blocks — looser than the bar for SETTLING a gender, because this only
  // flags disagreement with something already known.
  const disagrees = (key, want) => {
    if (!want || !key) return false
    const settled = genderNow(key)
    if (settled === 'm' || settled === 'f') return settled !== want
    const t = genderEvidence.get(key)
    if (!t) return false
    const opp = want === 'm' ? t.f : t.m
    const sup = want === 'm' ? t.m : t.f
    return opp > 0 && sup === 0
  }

  // ── mentions, indexed ──────────────────────────────────────────────────────
  const bySentence = new Map()
  for (const m of mentions) {
    const arr = bySentence.get(m.sentence) ?? []
    arr.push(m)
    bySentence.set(m.sentence, arr)
  }
  // A leading title genders a name on sight — "Queen Livara" is female before the story has said
  // one pronoun about her. Read here, from the surface, because the accumulated tally is only
  // updated once this paragraph is finished: a name introduced in this very paragraph would
  // otherwise read as ungendered for the whole of it, which is exactly when its own description
  // arrives.
  for (const m of mentions) {
    if (m.form !== 'name' || localGender.has(m.key)) continue
    const g = genderFromTitles(Object.fromEntries(analyseName(m.surface).titles.map(t => [t, 1])))
    if (g) localGender.set(m.key, g)
  }

  // A capitalised descriptor span ("Dwarven Blacksmith") is a description that happens to be title
  // cased. It enters as a descriptor anchor here, with no second detector involved: the phrase pass
  // never sees those characters, because reading already marked the phrase `coveredBySpan`.
  for (const m of mentions) {
    if (m.form !== 'descriptor') continue
    if (descriptors.some(d => d.key === m.key)) continue
    const g = genderOfHead(m.key.split(' ').pop())
    if (g) localGender.set(m.key, g)
    descriptors.push({
      key: m.key, sentence: m.sentence, gender: g, source: 'span', surface: m.surface,
      distinctive: true, at: m.offset, end: m.offset + m.surface.length,
    })
  }

  // Self-identification inside a quote whose sentence has no verb-tagged speaker of its own.
  const mentionAt = new Map(mentions.map(m => [m.offset, m]))
  for (const at of reading.selfIdAt) {
    const m = mentionAt.get(at)
    if (!m || m.form !== 'name') continue
    const sentenceHasTag = (bySentence.get(m.sentence) ?? []).some(x => x.spoke)
    if (!sentenceHasTag) speakers.add(m.key)
  }

  // Does this paragraph use ONE pronoun class throughout? If it does, a credit cannot pick up the
  // wrong gender even when it picks the wrong person — there is no other gender in the paragraph
  // to pick up. That is the same argument the sole-name rule makes at sentence scale, one level up.
  const paragraphClasses = new Set(reading.pronouns.map(x => x.cls).filter(c => c === 'm' || c === 'f'))
  const uniformParagraph = paragraphClasses.size === 1

  // ── the pass ───────────────────────────────────────────────────────────────
  let soleNamed = null          // named alone in a sentence that had an owner: its gender shows up
  let activeDescriptors = []    // unclaimed descriptors still in play, for the forward claim
  const claimedKeys = new Set()
  const proposedThisParagraph = new Set()

  for (const [si, s] of sents.entries()) {
    tracedSentence = si
    const here = bySentence.get(si) ?? []
    const namedHere = here.filter(m => m.form === 'name')
    const pronounsHere = reading.pronouns.filter(p => p.sentence === si)
    const hasM = pronounsHere.some(p => p.cls === 'm')
    const hasF = pronounsHere.some(p => p.cls === 'f')
    const pronounClass = hasM && hasF ? null : hasM ? 'm' : hasF ? 'f' : (pronounsHere.some(p => p.cls === 'n') ? 'n' : null)

    // Names currently in focus that could take a widened waiver. A known entity with several
    // mentions and still no resolved gender is excluded: nothing structurally CAN give a place or a
    // spell name a gendered pronoun, so it would otherwise sit in the window forever as the sole
    // candidate and absorb unrelated scenery — confirmed live twice in the old package.
    const focusNames = namedInFocus(focus).filter(k => !isNonPerson(k))

    // 1. Phrases: what does this sentence's prose introduce, block, or hand to somebody already
    //    named? One verdict per phrase.
    const nameOffsets = namedHere.map(m => m.offset)
    const blocks = []
    const selfSpans = []
    let boundTo = null
    for (const p of reading.phrases) {
      if (p.sentence !== si || p.coveredBySpan) continue
      if (p.kind === 'possessive') continue          // "his mother" is relational, a different problem
      if (p.kind === 'refers-back' && !definiteDescriptors) continue

      let namedBefore = nameOffsets.some(off => off < p.start)
      let widenedTo = null
      if (!namedBefore && widenWaiver && focusNames.length) {
        // Gender agreement against the pronouns BEFORE the phrase. An unresolved candidate is not
        // ruled out — a name introduced this turn has no gender yet, and that is the case the
        // widening exists for — only one confirmed to disagree is.
        const before = pronounsHere.filter(x => x.at < p.start)
        const want = before.some(x => x.cls === 'm') && before.some(x => x.cls === 'f') ? null
          : before.some(x => x.cls === 'm') ? 'm' : before.some(x => x.cls === 'f') ? 'f' : null
        // ...unless the phrase itself is gendered by its own head noun. "A stern-faced WOMAN" is
        // female by English vocabulary, so handing it to a candidate with no gender at all is a
        // guess, not a match — and the candidate in focus is often a place, which can never earn
        // one. Confirmed on the real transcript this package was built against: without this, the
        // school absorbed the principal's entire description on the turn she was introduced.
        const fits = focusNames.filter(k => {
          if (p.gender) return genderNow(k) === p.gender
          return !disagrees(k, want)
        })
        if (fits.length === 1) { namedBefore = true; widenedTo = fits[0] }
      }
      // Predicative or dash-appositive: "the Comtesse ... was a most conspicuous figure" renames
      // whoever the sentence is already about rather than introducing anybody.
      if (namedBefore && (p.predicativeBefore || p.dashBefore)) {
        // The widening just resolved WHICH named subject this description belongs to — a verdict
        // continuity cannot re-derive for a brand-new name (its gate needs a settled gender to
        // agree with, and a name introduced this turn has none). Carried forward instead of
        // discarded and asked for again under a stricter gate.
        if (widenedTo) boundTo = widenedTo
        continue
      }
      if (p.namesItself) continue                    // "a young woman named Talis" — an introduction
      if (isAppositive(p, nameOffsets, s)) continue  // "Chauvelin, a tall man in a red coat"

      const key = normalizeName(p.phrase)
      if (!key) continue

      if (!p.plural && p.kind === 'refers-back' && focusNames.length && !proposedThisParagraph.has(key)) {
        // A DEFINITE phrase means "already established" in English — "the mage" continuing someone
        // just named is doing what a pronoun does, and proposing it manufactures a rival to the
        // person it actually means. Continuity first: does exactly one name in focus fit?
        const want = p.gender
        const fits = want ? focusNames.filter(k => genderNow(k) === want) : focusNames
        if (fits.length === 1) {
          // Forwarded only for the gendered-head case. The ungendered case ("exactly one candidate,
          // no gender check at all") was tried in the old package and confirmed live to let a place
          // or an item name absorb unrelated action; skipping the phrase is still right there, but
          // binding the sentence to that candidate is not.
          if (want) boundTo = fits[0]
          continue
        }
      }

      if (!p.plural && p.animacy >= ANIMATE_MIN) {
        // "The first person you encounter IS a stern-faced woman with pale skin." The subject of
        // the copula and this phrase are the same person, so a block the subject raised is about
        // to strip the description off the very anchor it introduces. Only the copula case: a
        // phrase merely standing before another ("a tall man walked past a stern-faced woman")
        // has no `predicativeBefore` and keeps its block.
        if (p.predicativeBefore) {
          for (let i = blocks.length - 1; i >= 0; i--) if (blocks[i][0] < p.start) blocks.splice(i, 1)
        }
        if (!descriptors.some(d => d.key === key)) {
          const g = p.gender
          if (g && !localGender.has(key)) localGender.set(key, g)
          descriptors.push({
            key, sentence: si, gender: g, source: 'phrase', surface: p.phrase,
            // Worth remembering past this paragraph only if the description individuates: a
            // race/kind or notable-mark compound ("Dwarven Blacksmith", "Scarred Woman"), or a bare
            // role noun ("the matron") that the story keeps coming back to. See src/anchors.js.
            distinctive: looksDescriptive(key) || (p.mods.length > 0 && key.split(' ').length >= 2),
            at: p.start, end: p.end,
          })
          proposedThisParagraph.add(key)
        }
        // The phrase describes the descriptor, so the trait extractor would otherwise hand its own
        // words back as its one feature ("figure" inside "a hulking figure").
        selfSpans.push([p.start, p.end])
        continue
      }
      if (p.plural || p.animacy >= BLOCK_MIN) {
        // Not worth tracking, but real enough that crediting a named character with its description
        // would be wrong. A group blocks too: "the guards" has no single face to own "scarred".
        const next = nameOffsets.find(off => off > p.start)
        blocks.push([p.start, next ?? s.end, p.gender])
      }
    }

    const descriptorsHere = descriptors.filter(d => d.sentence === si)
    const onStage = [...new Set([...namedHere.map(m => m.key), ...descriptorsHere.map(d => d.key)])]

    // 2. Traits this sentence offers. A trait inside a descriptor's own phrase is that phrase, not
    //    a fact about anybody; a trait inside a blocked passer-by's span is real but unassignable.
    const all = reading.traits.filter(t => t.sentence === si && !inSpans(t.at, selfSpans))
    const assignable = blocks.length ? all.filter(t => !inSpans(t.at, blocks)) : all
    const ownerOf = new Map(all.map(t => [t, null]))

    // 3. Ownership. First match wins; each rule refuses rather than guesses when two candidates fit.
    const firstMention = Math.min(...here.map(m => m.offset), ...descriptorsHere.map(d => d.at), Infinity)
    const firstPronoun = pronounsHere.length ? pronounsHere[0].at : Infinity
    const nameLeads = firstMention < firstPronoun

    // (1) A possessive binds hardest: "Chauvelin's hands" is his even with three names in the line.
    const possessive = onStage.filter(k => possessiveRe(k).test(s.text))
    // A pronoun that is ITSELF the subject of a speech verb ("'Ask for Talis,' HE says") names the
    // SPEAKER, not whichever name sits inside the preceding quote — position alone cannot tell the
    // difference, since "Talis" precedes "he" either way.
    const pronounIsSpeaker = onStage.length === 1 && nameLeads && firstPronoun !== Infinity
      && speaksAt(text, pronounsHere[0].at, pronounsHere[0].word.length, reading.quotes)

    let owner = possessive.length === 1 ? possessive[0]
      // (2) One person in the sentence, no competing possessive, and they lead any pronoun.
      : (onStage.length === 1 && nameLeads && !pronounIsSpeaker) ? onStage[0]
      : null
    const viaName = owner !== null

    if (!owner && onStage.length === 0) {
      // (3) Nobody here at all — continue whoever is in focus, chosen by pronoun agreement.
      const fit = uniqueAgreeing(focus, pronounClass, genderNow)
      if (fit && !fit.blocked) owner = fit.key
      // (3b) ...or take the binding the phrase pass already resolved, which reaches the case (3)
      //      structurally cannot: a brand-new name with no settled gender to agree with.
      if (!owner && !isShaded(focus) && boundTo && !disagrees(boundTo, pronounClass)) owner = boundTo
    }

    // (4) Several people are in play. Each trait goes to its NEAREST owner marker — a possessive, or
    //     a pronoun resolving to exactly one candidate. A tie attributes nothing.
    if (!owner && assignable.length && !isShaded(focus)) {
      const pool = [...new Set([...onStage, ...candidates(focus).map(c => c.key)])].filter(k => k !== BLOCKED)
      const markers = []
      for (const k of pool) {
        const mm = possessiveRe(k).exec(s.text)
        if (mm) markers.push({ at: s.start + mm.index, key: k })
      }
      for (const p of pronounsHere) {
        const fits = pool.filter(k => genderNow(k) === p.cls)
        if (fits.length === 1) markers.push({ at: p.at, key: fits[0] })
      }
      if (markers.length) {
        for (const t of assignable) {
          let best = null, bestD = Infinity
          for (const mk of markers) {
            const d = Math.abs(mk.at - t.at)
            if (d < bestD) { bestD = d; best = mk.key } else if (d === bestD && best !== mk.key) best = null
          }
          ownerOf.set(t, best)
        }
      }
    }

    if (owner) {
      for (const t of assignable) ownerOf.set(t, owner)
      // A name being ADDRESSED inside dialogue is not being described by it: "I knew your father,
      // Marrow, and I knew HE had a good supply of weapons" says nothing about Marrow's gender —
      // the pronouns in a line belong to the speaker's frame of reference, not to whoever is
      // spoken to. Measured: eight of Marrow's nine male data points came from this shape, for a
      // female character, and it was enough to push her below the majority bar.
      //
      // Comma-delimited address only, and only inside a quote. A blunter "mention is in a quote"
      // version was tried and cost more than it saved — in this register plenty of correct
      // evidence sits inside quotes ("The Snow Queen's army," he says), and that lost two more
      // characters their gender than it recovered.
      const ownerMentions = here.filter(m => m.key === owner)
      const vocativeOnly = ownerMentions.length > 0
        && ownerMentions.every(m => m.inQuote && isVocative(text, m))
      if (viaName && !vocativeOnly) noteSentenceGender(owner, pronounClass, bumpGender, 'sentence')
      owned(focus, owner)
      soleNamed = onStage.length === 1 ? owner : null
    } else if (soleNamed && onStage.length === 0) {
      // Gender cannot be learned from the naming sentence itself ("Ophira walked the corridor" has no
      // pronoun) — the evidence is in the sentence after. Tally only; never places a trait.
      //
      // Not from inside quoted speech, though. Carrying a name forward one sentence assumes the
      // narration is still following that person, and a line of dialogue is not narration: its
      // pronouns are about whoever the speaker is discussing. Measured across six transcripts,
      // this rule is wrong 63% of the time when the pronoun sits inside a quote — the only place
      // in the package found to cost more than it earns — against 21% outside one.
      const spoken = pronounsHere.length > 0
        && pronounsHere.every(x => reading.quotes.some(([a, b]) => x.at >= a && x.at < b))
      // ...and only when the paragraph is of one mind about gender. Carrying a name into the next
      // sentence is a guess about who the narration is still following; in a paragraph that uses
      // both classes the guess can pick up the wrong one, and measured across six transcripts it
      // does so 43% of the time, against 16% when the paragraph is uniform.
      if (!spoken && uniformParagraph) noteSentenceGender(soleNamed, pronounClass, bumpGender, 'carry')
      soleNamed = null
    }

    // A sentence that mixes pronoun classes credits nobody under the rule above, and those are
    // common in this register. Credit each pronoun individually when exactly one candidate LEANS
    // that way on the evidence so far — still agreement, never position.
    if (mixedPronouns && pronounClass === null && hasM && hasF) {
      creditMixedPronouns(pronounsHere, [...onStage, ...candidates(focus).map(c => c.key)], {
        tallyOf, genderEvidence, bump: bumpGender,
      })
    }

    for (const t of all) {
      traits.push({
        text: t.text, offset: t.at, sentence: si, key: ownerOf.get(t) ?? null,
        // The sentence's own pronoun class, kept so a wrong attribution can be dropped later once
        // gender settles, without needing to know the intruder exists.
        from: pronounClass,
      })
    }

    // 4. The forward claim: a description introduced earlier in this paragraph, claimed by a name
    //    arriving later in it. Gated hard on the name being NEW TO THE STORY — most of the time a
    //    name following a description is an already-tracked character being mentioned again, and
    //    "new to story" is what tells the two apart.
    if (forwardClaim) {
      for (const m of namedHere) {
        const open = activeDescriptors.filter(d => !claimedKeys.has(d.key))
        if (!open.length) break
        if (isKnown(m.key) || claimedKeys.has(m.key)) continue
        // A genuine self-introduction ("I am Ophira") offers zero external type signal, so requiring a
        // POSITIVE character type would reject the flagship case. Only a confirmed wrong type
        // disqualifies, and a head noun is the only thing that can say so this early.
        const t = headTypeOf(m.surface)
        if (t === 'location' || t === 'organization') continue
        let target = open.length === 1 ? open[0] : null
        if (!target) {
          const g = genderNow(m.key)
          const same = g ? open.filter(d => (d.gender ?? genderNow(d.key)) === g) : []
          if (same.length === 1) target = same[0]
        }
        if (!target) continue
        claims.set(target.key, m.key)
        claimedKeys.add(target.key)
        claimedKeys.add(m.key)
        // A descriptor's gender comes from its head noun, which stops applying the moment its data
        // becomes a named character's — carry it across as real evidence rather than losing it.
        const g = target.gender ?? genderNow(target.key)
        if (g && !genderNow(m.key)) { bumpGender(m.key, g, 'claim'); bumpGender(m.key, g, 'claim') }
      }
      // The window moves with the sentence, claim or no claim: a sentence naming somebody with no
      // description of its own correctly empties it, because the old description is no longer what
      // the paragraph is about.
      if (here.length || descriptorsHere.length) {
        activeDescriptors = descriptorsHere.map(d => ({ ...d }))
      }
    }

    sentences.push({ owner: owner ?? null, pronounClass })

    // 5. Focus moves on.
    tick(focus)
    if (onStage.length) {
      enter(focus, [
        ...namedHere.map(m => ({ key: m.key, gender: genderNow(m.key), descriptor: false })),
        ...descriptorsHere.map(d => ({ key: d.key, gender: d.gender ?? null, descriptor: true })),
      ])
    } else if (blocks.length) {
      // Somebody unnamed walked through and is not worth tracking. Hold the window so the next
      // sentence's description does not land on whoever was named last.
      shade(focus, blocks[blocks.length - 1][2])
    }
  }

  return { sentences, traits, genderEvidence, descriptors, claims, speakers, focus, genderTrace }
}

/** Direct address: `"Marrow, ...` or `..., Marrow, ...` — a name set off by commas inside a line. */
const VOCATIVE_BEFORE = /(?:^|["“”]\s*|,\s*)$/
const VOCATIVE_AFTER = /^\s*[,!?]/
function isVocative(text, mention) {
  const before = text.slice(Math.max(0, mention.offset - 3), mention.offset)
  const after = text.slice(mention.offset + mention.surface.length)
  return VOCATIVE_BEFORE.test(before) && VOCATIVE_AFTER.test(after)
}

/** Only unambiguous sentences count — exactly one of m/f/n present, never two. */
function noteSentenceGender(key, cls, bump, why) {
  if (cls) bump(key, cls, why)
}

/**
 * Per-pronoun crediting for a sentence that mixes classes, where the sentence-level rule refuses.
 *
 * Compares against the RAW, not-yet-settled tally rather than requiring a resolved gender, because
 * the sentences this helps are exactly the ones where nobody has settled yet. Still agreement-based:
 * exactly one candidate must lean that way, and leaning means "more evidence for this class than
 * the other, and at least one real data point". Never falls back to distance — matching a pronoun
 * to its nearest name was tried in the old package and falsified on both a real and a constructed
 * sentence, because raw distance does not track grammar.
 */
function creditMixedPronouns(pronouns, pool, { tallyOf, genderEvidence, bump }) {
  const keys = [...new Set(pool)].filter(k => k && k !== BLOCKED)
  const leans = (key, cls) => {
    const opp = cls === 'm' ? 'f' : 'm'
    const prior = tallyOf(key), sofar = genderEvidence.get(key)
    const have = (prior?.[cls] ?? 0) + (sofar?.[cls] ?? 0)
    const other = (prior?.[opp] ?? 0) + (sofar?.[opp] ?? 0)
    return have > 0 && have > other
  }
  const credited = new Set()
  for (const p of pronouns) {
    if (p.cls === 'n') continue
    const fits = keys.filter(k => leans(k, p.cls))
    if (fits.length !== 1) continue
    if (credited.has(fits[0])) continue
    bump(fits[0], p.cls, 'mixed')
    credited.add(fits[0])
  }
}

/** "Chauvelin, a tall man in a red coat" renames a character; everything after is still theirs. */
function isAppositive(phrase, nameOffsets, sentence) {
  const at = phrase.start
  for (const off of nameOffsets) {
    if (off >= at) continue
    const between = sentence.text.slice(off - sentence.start, at - sentence.start)
    if (/^\s*[\p{L}'’-]*\s*,\s*$/u.test(between)) return true
    if (phrase.commaBefore && at - off < 40 && !/[.;!?]/.test(between)) return true
  }
  return false
}

const inSpans = (at, spans) => spans.some(([a, b]) => at >= a && at < b)
