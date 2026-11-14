// Replay exactness (Phase 2A): what a replay saves besides the seed and the answers, so loading it later plays the
// same game without asking Scryfall or Commander Spellbook again.
//   cards     Scryfall's data for every card in the decks, as the game read it (scryfall.js slimCard), by card id
//   hashes    a hash of each saved card; a card that doesn't match its hash means the file was damaged or edited
//   readings  a hash of how the game's card reader read each card, to tell when a newer version reads it differently
//   spellbook each seat's Commander Spellbook combos (definitions with their prerequisites), in seat order
//   builtinCombos  a fingerprint of the built-in combo list the game had
//   engineRules    the newest rules version of the app that saved it (the game's own rules version is `rules`)
// Replays from before format 7 have none of this: they're rebuilt from today's card data and Spellbook answers, and
// the person loading one is told so.
import { cardDataHash } from './scryfall.js';
import { BUILTIN_COMBOS_HASH } from './combos.js';
import { RULES } from './engine.js';
import { hashText, stableJson } from './util.js';

export const REPLAY_FORMAT = 7;

/** Every card a deck holds: commanders, the main deck, the sideboard and a companion */
export const deckCards = d => [...(d.commanders || []), ...(d.cards || []).map(c => c.card), ...(d.sideboard || []).map(c => c.card), ...(d.companion ? [d.companion] : [])].filter(Boolean);

// How the card reader read a card (every face and reading the game can use)
export function readingHash(card) {
  try { return hashText(stableJson([card.fx, card.v8?.fx, card.backCard?.fx, card.altFace?.fx, card.v8?.backCard?.fx, card.v8?.altFace?.fx])); } catch { return ''; }
}

// The combo definitions of a table: each seat's Spellbook combos in seat order (Game opts.spellbook)
export const tableSpellbook = decks => decks.flatMap(d => d?.spellbook || []);

// What a new replay saves about its decks and combos (made once when the game starts: Game setup.snapshot)
export function snapshotDecks(decks) {
  /** @type {Record<string, any>} */ const cards = {};
  /** @type {Record<string, string>} */ const hashes = {};
  /** @type {Record<string, string>} */ const readings = {};
  for (const d of decks) for (const c of deckCards(d)) {
    if (!c.src || cards[c.id]) continue;
    cards[c.id] = c.src;
    hashes[c.id] = c.srcHash;
    readings[c.id] = readingHash(c);
  }
  return {
    cards, hashes, readings,
    spellbook: decks.map(d => JSON.parse(JSON.stringify(d.spellbook || []))),
    builtinCombos: BUILTIN_COMBOS_HASH,
    engineRules: RULES,
  };
}

// Before a replay is loaded: whether it can be restored exactly, with plain-language notes.
// problems: reasons it can't be loaded at all (damaged card data, rules newer than this app); notes: what may differ.
export function checkReplay(data) {
  const problems = [], notes = [];
  if ((data.rules ?? 4) > RULES) problems.push(`it was played under rules version ${data.rules}, newer than this app's (${RULES}). Update Commander Table to load it`);
  if (!data.cards || !data.hashes) {
    notes.push(`This replay was saved before replays kept their own card data (replay format ${data.version ?? 1}, before ${REPLAY_FORMAT}). It is rebuilt with today's Scryfall card data and today's Commander Spellbook combos, so if either has changed since, it can play differently from the original game.`);
    return { exact: false, problems, notes };
  }
  const bad = Object.keys(data.cards).filter(id => cardDataHash(data.cards[id]) !== data.hashes[id]);
  if (bad.length) problems.push(`the saved data of ${bad.length} card${bad.length === 1 ? '' : 's'} doesn't match its hash (${bad.slice(0, 5).map(id => data.cards[id]?.name || id).join(', ')}${bad.length > 5 ? '…' : ''}): the file was damaged or edited`);
  if (!Array.isArray(data.spellbook)) problems.push('its Commander Spellbook combos are missing');
  if (data.builtinCombos && data.builtinCombos !== BUILTIN_COMBOS_HASH) notes.push("The built-in combo list has changed since this replay was saved, so a game that went for a built-in combo can play differently.");
  return { exact: !problems.length && !notes.length, problems, notes };
}

// After the replay's decks are built from its saved cards: cards today's card reader reads differently
export function readingChanges(data, decks) {
  if (!data.readings) return [];
  const out = new Set();
  for (const d of decks) for (const c of deckCards(d)) {
    const was = data.readings[c.id];
    if (was && was !== readingHash(c)) out.add(c.name);
  }
  return [...out];
}
