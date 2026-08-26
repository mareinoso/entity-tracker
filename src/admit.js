// src/admit.js
//
// Raw capitalised spans -> Mentions. Every judgement that needs more than one paragraph of story
// lives here: trimming discourse pollution off a span, deciding whether a span is an entity at all,
// and re-seeing a name the story already established.
//
// In the old package these three jobs were spread across `entitySourceCapitalisation.js` (trimming,
// using the evidence store), `admit.js` (admission) and `candidatePool.js`'s `withKnownMentions`
// (re-seeing), with the span source itself reaching into accumulated state. Collapsing them here is
// what lets `src/read/` stay a pure function of text — see that folder's header.

import {
  isStrongHead, isStrongSpan, isStrongTail, isOrdinaryWord, lowercaseShare, seenLowercase,
} from './lexis.js'
import { isOpener } from './lexicon/openers.js'
import { LOCATIVE } from './lexicon/world.js'
import { SAY, SAY_AMBIG, SAY_LOUD } from './lexicon/speech.js'
import { inRanges } from './read/segment.js'
import { speaksAt } from './read/speech.js'
import { isNoise, normalizeName, trimLeadingStopwords, looksDescriptive, analyseName } from './names.js'
import { headTypeOf } from './profile/type.js'

const DEAR_POOR = /\b(?:dear|poor)\s+$/i
const SAY_NEAR = new RegExp(`\b(?:${SAY}|${SAY_AMBIG}|${SAY_LOUD})\b`, 'i')

/**
 * @typedef {object} Mention
 * @property {string} id           `${paragraphId}#${offset}`
 * @property {string} paragraphId
 * @property {number} sentence
 * @property {number} offset       start of the surface within the paragraph
 * @property {string} surface      as the text spells it
 * @property {string} key          normalizeName(surface)
 * @property {'name'|'descriptor'} form
 * @property {boolean} inQuote     inside quoted speech: being talked ABOUT
 * @property {boolean} spoke       verb-adjacent speech tag: this mention SPOKE
 * @property {boolean} possessive
 * @property {boolean} standalone  ends a clause, so the span can stand alone as a noun phrase
 * @property {'position'|'speech'|'possessive'|'honorific'|'known'|'repetition'} via
 */

/**
 * Per-mention lexical facts. All four are lookups at an offset the caller already holds — no pass
 * over the text — and they are computed exactly once, here, because four unrelated consumers
 * (typing, attribution, surfacing, the attributive test) each used to derive their own copy.
 */
function factsAt(text, offset, surface, quotes) {
  const tail = text.slice(offset + surface.length)
  return {
    inQuote: inRanges(offset, quotes),
    spoke: speaksAt(text, offset, surface.length, quotes),
    // "Chauvelin's" — the surface may swallow the possessive, or the text may still carry it.
    possessive: /['’]s?$/.test(surface) || /^['’]s?(?![\w])/.test(tail),
    // Ends a clause, so the span can stand alone as a noun phrase. An attributive modifier
    // ("Imperial walker") never can — see src/profile/type.js.
    standalone: /^\s*[.,;:!?"”')\]]/.test(tail),
    // Address forms and the locative frame, read here for the same reason as the four above: they
    // are lookups in a window around an offset the caller already holds, and every consumer that
    // derived its own copy in the old package (typing did, the bare-token signal did) was one more
    // place for the window size to drift. Typing and the usage signal are now text-free.
    dearPoor: DEAR_POOR.test(text.slice(Math.max(0, offset - 16), offset)),
    locative: LOCATIVE.test(text.slice(Math.max(0, offset - 12), offset)),
    nearSpeech: SAY_NEAR.test(text.slice(Math.max(0, offset - 40), offset + surface.length + 40)),
  }
}

/**
 * Trim discourse pollution off a raw span, using both this paragraph's own attestations and the
 * story's accumulated ones. Returns the surviving words, or `null` when nothing survives.
 *
 * Three rules, all evidence-driven, none of them a verb list:
 *   1. trailing  — "Kade Rourke Enters": drop a final word that never ENDS a span whose capital is
 *      unexplained, provided it also looks like pollution (`isOpener`) and what remains is attested.
 *      Requiring positive junk-evidence is what protects a one-off surname ("Corren Vantage")
 *      whose last word has no independent attestation yet either.
 *   2. interior  — "Because Ferrite", "Denix Says Denix": an opener at any position SPLITS the span
 *      (removing and rejoining would yield "Denix Denix"); the longest surviving run wins.
 *   3. leading   — at a sentence start only, drop a first word that never opens a span elsewhere
 *      when what remains DOES, and the dropped word behaves like ordinary vocabulary. Requiring
 *      that last condition is what stopped this rule stripping "John" from "John Smith" on every
 *      sentence-initial mention once "Smith" was independently established.
 */
function trimSpan(span, lexis, local) {
  let words = span.words
  let atSentenceStart = span.atSentenceStart

  // A word a head-noun lexicon claims is never pollution, whatever the opener list says. "Keep",
  // "Order", "Watch" and "Guild" are all imperative verbs AND the exact span-final nouns that type
  // an entity outright, and the opener rules used to cut them: "Duskmere Keep" was trimmed to
  // "Duskmere", which then had no head noun left to type it as a location (confirmed in both this
  // package and the old one before this guard). Protecting them costs nothing — a genuine
  // sentence-opening "Keep going" is a one-word span the noise and positional gates already handle.
  const isHeadNoun = (w) => Boolean(headTypeOf(w))

  const attestedHead = w => Boolean(local.headMid[w.toLowerCase()]) || isStrongHead(lexis, w)
  const attestedSpan = ws => {
    const k = ws.map(x => x.text).join(' ').toLowerCase()
    return Boolean(local.span[k]) || isStrongSpan(lexis, k)
  }
  const attestedTail = w => Boolean(local.tail[w.toLowerCase()]) || isStrongTail(lexis, w)

  while (words.length > 1
    && !attestedSpan(words)
    && !attestedTail(words[words.length - 1].text)
    && isOpener(words[words.length - 1].text)
    && !isHeadNoun(words[words.length - 1].text)
    && attestedSpan(words.slice(0, -1))) {
    words = words.slice(0, -1)
  }

  const cut = words.map(w => isOpener(w.text) && !isStrongHead(lexis, w.text) && !isHeadNoun(w.text))
  if (cut.some(Boolean)) {
    const runs = []
    let cur = []
    for (const [i, w] of words.entries()) {
      if (cut[i]) { if (cur.length) runs.push(cur); cur = [] }
      else cur.push(w)
    }
    if (cur.length) runs.push(cur)
    const best = runs.sort((a, b) => b.length - a.length || a[0].at - b[0].at)[0]
    if (!best) return null
    // Anything after a cut is no longer sentence-initial: "Because" explained the capital,
    // "Ferrite" does not.
    if (best[0].at > words[0].at) atSentenceStart = false
    words = best
  } else if (atSentenceStart && words.length > 1
    && !attestedHead(words[0].text) && attestedHead(words[1].text)
    && isOrdinaryWord(lexis, words[0].text)) {
    words = words.slice(1)
    atSentenceStart = false
  }

  if (!words.length) return null
  return { words, atSentenceStart }
}

/**
 * Admit one paragraph's spans.
 *
 * @param {object} reading             from src/read/reading.js
 * @param {string} paragraphId
 * @param {object} lexis               accumulated word history, INCLUDING this paragraph
 * @param {Set<string>} knownKeys      normalised keys the story has already established as entities
 * @returns {Mention[]} ordered by offset
 */
export function admitMentions(reading, paragraphId, lexis, knownKeys = new Set()) {
  const text = reading.text
  const local = reading.spanStats

  // 1. Trim, then reject orthographic junk. Trim first: "Where's Black Dog" is noise as a whole and
  //    a real character once its interrogative is removed.
  const trimmed = []
  for (const span of reading.spans) {
    const t = trimSpan(span, lexis, local)
    if (!t) continue
    let surface = t.words.map(w => w.text).join(' ')
    let offset = t.words[0].at
    const lead = trimLeadingStopwords(surface)
    if (lead !== surface) { offset += surface.length - lead.length; surface = lead }
    if (surface.length < 2 || isNoise(surface)) continue
    const key = normalizeName(surface)
    if (!key) continue
    trimmed.push({
      surface, offset, key,
      sentence: span.sentence,
      atSentenceStart: t.atSentenceStart,
      ...factsAt(text, offset, surface, reading.quotes),
    })
  }

  // 2. Positional evidence, per surface, within this paragraph. A single-word candidate needs its
  //    capital to be unexplained by position — seen mid-sentence, or seen twice. Dialogue-heavy
  //    prose puts names at sentence start constantly ("Talis snorted."), and requiring mid-sentence
  //    alone hid main characters entirely. Multi-word candidates pass regardless: the SECOND word's
  //    capital has no excuse.
  const seen = new Map()
  for (const s of trimmed) {
    const e = seen.get(s.surface) ?? { mid: false, count: 0, spoke: false, possessive: false }
    e.count++
    if (!s.atSentenceStart) e.mid = true
    e.spoke ||= s.spoke
    e.possessive ||= s.possessive
    seen.set(s.surface, e)
  }

  // "Sparks", "Farmers", "Minutes": a capitalised plural whose singular the story writes in
  // lowercase is ordinary vocabulary that happened to start a sentence, not somebody's name. The
  // singular is where the evidence is — the plural form itself may never appear lowercase at all,
  // which is exactly why the ratio test above lets it through.
  // Inflected like a verb or an adverb rather than named like a person: "Burning", "Crumbling",
  // "Especially". Scoped to the repetition rescue ALONE, deliberately. As a general rule this
  // would be indefensible — it deletes Qing, Ming and King to catch Nothing and During, which is
  // exactly the trap the old package documented and refused. On the weakest admission path, where
  // the alternative is admitting a word whose only evidence is that it starts sentences, the
  // trade goes the other way: a character called Qing who is ALSO ever mentioned mid-sentence,
  // possessively, or with a speech tag is admitted by one of the three stronger rules anyway.
  const inflectedLikeVocabulary = (surface) => /(?:ing|ly|ed)$/i.test(surface)

  const pluralOfOrdinary = (surface) => {
    if (!/s$/i.test(surface)) return false
    return seenLowercase(lexis, surface.slice(0, -1))
      || (/es$/i.test(surface) && seenLowercase(lexis, surface.slice(0, -2)))
  }

  // How often the story has seen this word open a span at all. A name that only ever appears at a
  // sentence start ("Renjo waved.", "Renjo slid the paper across.") carries no positional evidence
  // in any single paragraph, so neither this package's predecessor nor its own first draft admitted
  // such a character at all — measured on the labelled corpus, that was three of five recall misses,
  // every one of them a main character. Repetition ACROSS paragraphs is the evidence one paragraph
  // cannot supply, and the lexis already has it.
  const openedSpans = (surface) => (lexis?.headStart?.[surface.toLowerCase()] ?? 0)
    + (lexis?.headMid?.[surface.toLowerCase()] ?? 0)

  // 3. Admit. Position first; then a rescue on speech or a possessive, refused when the word
  //    behaves like ordinary vocabulary (rescuing on speech alone scored 33% precision, and the
  //    ordinariness test raised it while losing none of the 27 real recoveries); then a name the
  //    story already knows, which needs no evidence of its own — a single-word name seen once at a
  //    sentence start carries no positional evidence, which is right for INTRODUCING a candidate
  //    and wrong for RE-SEEING one.
  const out = []
  for (const s of trimmed) {
    const e = seen.get(s.surface)
    const positional = e.mid || e.count >= 2 || s.surface.includes(' ')
    const rescuable = (e.spoke || e.possessive)
      && !(s.surface.includes(' ') ? false : isOrdinaryWord(lexis, s.surface))
    // An honorific is the highest-precision person signal in the text and costs nothing to read:
    // "-san"/"-sensei" attaches to nothing but a person's name. The old package parsed honorifics
    // onto every entity and then never read them anywhere (its own audit lists the field as
    // computed-but-unwired); admission is where they are worth something.
    const honorific = analyseName(s.surface).honorifics.length > 0
    // Never lowercase anywhere in the story, not discourse vocabulary, opened a span more than
    // once, and — the two conditions that make it safe — this occurrence is in NARRATION and is
    // the SUBJECT OF SOMETHING rather than a standalone exclamation. Without those two, the rule
    // is a junk generator in this register: player-typed dialogue capitalises "Yeah", "Damn",
    // "Whoa" at sentence start and never uses them lowercase, so they look exactly like a name
    // that only ever opens sentences (measured: +26 junk entities on one real transcript). An
    // interjection ends its clause immediately; a character does something next.
    const repeated = !s.surface.includes(' ') && openedSpans(s.surface) >= 2
      && !isOpener(s.surface) && !isNoise(s.surface)
      && lowercaseShare(lexis, s.surface) === 0
      && !s.inQuote && !s.standalone
      && !pluralOfOrdinary(s.surface) && !inflectedLikeVocabulary(s.surface)
    const via = positional ? 'position'
      : rescuable ? (e.spoke ? 'speech' : 'possessive')
      : honorific ? 'honorific'
      : knownKeys.has(s.key) ? 'known'
      : repeated ? 'repetition'
      : null
    if (!via) continue
    out.push({
      id: `${paragraphId}#${s.offset}`,
      paragraphId,
      sentence: s.sentence,
      offset: s.offset,
      surface: s.surface,
      key: s.key,
      // A capitalised "[kind adjective][role noun]" span ("Dwarven Blacksmith") reads as a name to
      // an orthographic source, but it is a DESCRIPTION. Classified once, here, and carried — the
      // phrase pass never sees it (its characters are already covered by this span), so there is
      // exactly one verdict per span rather than two detectors quietly disagreeing.
      form: looksDescriptive(s.key) ? 'descriptor' : 'name',
      inQuote: s.inQuote,
      spoke: s.spoke,
      possessive: s.possessive,
      standalone: s.standalone,
      dearPoor: s.dearPoor,
      locative: s.locative,
      nearSpeech: s.nearSpeech,
      atSentenceStart: s.atSentenceStart,
      via,
    })
  }
  return out.sort((a, b) => a.offset - b.offset)
}
