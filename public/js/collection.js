// Collection (item 147): the cards you own, imported from a ManaBox or Deckbox export, any CSV with a name and a
// quantity column, or a plain "4 Lightning Bolt" list. Kept in the browser profile by card name (front face, any
// printing). The builder marks owned cards and can show only those; the deck viewer lists what a deck is missing.
// No prices.
import { store } from './util.js';
import { parseText } from './decks.js';

const KEY = 'ct.collection';
const key = name => String(name || '').split(' // ')[0].trim().toLowerCase();
let cache = null;
const load = () => (cache ||= store(KEY) || null);

// Reads an export; returns { unique, total }. replace: drop the old collection first (otherwise counts are added)
export function importCollection(text, { replace = true } = {}) {
  const parsed = parseText(text, { commander: false });
  const cards = replace ? {} : { ...(load()?.cards || {}) };
  let total = 0;
  for (const e of parsed.entries) {
    const name = e.name || e.ident?.name;
    if (!name) continue;
    const k = key(name);
    cards[k] = (cards[k] || 0) + (e.qty || 1);
    total += e.qty || 1;
  }
  if (!total) throw new Error('No cards found: export a CSV with a name and a quantity column, or a list like "4 Lightning Bolt".');
  cache = { at: Date.now(), cards };
  store(KEY, cache);
  return summary();
}
export function clearCollection() { cache = null; store(KEY, null); }
export const hasCollection = () => !!load();
export function summary() {
  const c = load();
  if (!c) return null;
  const v = Object.values(c.cards);
  return { unique: v.length, total: v.reduce((a, n) => a + n, 0), at: c.at };
}
// How many copies you own (0 when there's no collection or you own none)
export const owned = name => load()?.cards[key(name)] || 0;
const basic = c => /\bbasic\b/i.test(c.typeLine || '') && /\bland\b/i.test(c.typeLine || '');

// What a deck needs that the collection doesn't have: [{ name, need, have }] (basic lands left out)
export function missingCards(deck) {
  if (!hasCollection()) return [];
  const need = new Map();
  for (const { card, qty } of [...(deck.commanders || []).map(card => ({ card, qty: 1 })), ...deck.cards, ...(deck.sideboard || [])]) {
    if (basic(card)) continue;
    const e = need.get(card.name) || { name: card.name, need: 0, have: owned(card.name) };
    e.need += qty;
    need.set(card.name, e);
  }
  return [...need.values()].filter(e => e.have < e.need).sort((a, b) => a.name.localeCompare(b.name));
}
