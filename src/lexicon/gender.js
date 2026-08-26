// src/lexicon/gender.js  (data, carried over from text-entity-tracker/lexicon/genderLexicon.js)
//
// Two things: pronoun word lists (no other home) and the union of every gendered noun declared
// elsewhere — this file doesn't declare word-gender itself. See titles.js/people.js for why.
//
// Every consumer reads the union, even genderFromTitles (candidateIndex.js), which could read the
// narrower FEMALE_TITLES/MALE_TITLES directly. Deliberate: that would assume the three gender
// resolvers (title-implied, noun-head-implied, pronoun-tally) stay separate, which is still an open
// question — not one to settle by accident here.

import { MALE_TITLES, FEMALE_TITLES } from './titles.js'
import {
  MALE_PERSON, FEMALE_PERSON, MALE_ROLES, FEMALE_ROLES, MALE_KINDS, FEMALE_KINDS,
} from './people.js'

// ---------------------------------------------------------------------------- pronouns

export const MALE_PRONOUN = `he|him|his|himself`
export const FEMALE_PRONOUN = `she|her|hers|herself`
// `its`/`itself` only, never bare `it` — see observe.js for why (expletive/object uses of "it"
// refer to no entity and would hand a dummy subject to whoever spoke last).
export const NEUTER_PRONOUN = `its|itself`
// The union referent.js's GENDERED used to retype by hand.
export const HUMAN_PRONOUN = `${MALE_PRONOUN}|${FEMALE_PRONOUN}`

// ---------------------------------------------------------------------------- accumulated

export const MALE_WORDS = new Set([...MALE_TITLES, ...MALE_PERSON, ...MALE_ROLES, ...MALE_KINDS])
export const FEMALE_WORDS = new Set([...FEMALE_TITLES, ...FEMALE_PERSON, ...FEMALE_ROLES, ...FEMALE_KINDS])
