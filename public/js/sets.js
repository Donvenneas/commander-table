// New card sets: Scryfall's list of sets, compared with the last check. A new set means new cards to
// draft and new legalities (Standard rotates, ban lists change with set releases), so saved card data
// from before it counts as out of date and is fetched again the next time a deck needs it.
import { sf } from './scryfall.js';
import { store } from './util.js';

const KEY = 'ct.sets';
// The kinds of sets worth showing: main releases, Commander products and draft-focused sets
const PLAYABLE = ['expansion', 'core', 'draft_innovation', 'masters', 'commander', 'funny'];
const DRAFTABLE = ['expansion', 'core', 'draft_innovation', 'masters'];
const today = () => new Date().toISOString().slice(0, 10);

export const setsState = () => store(KEY) || { known: [], list: [], checkedAt: 0 };

// Asks Scryfall for its sets. Returns { first, added: [released sets new since last time], upcoming,
// latest }. The first check only remembers what exists (nothing counts as new yet).
export async function checkSets() {
  const j = await sf('/sets');
  const list = (j.data || []).filter(s => PLAYABLE.includes(s.set_type) && !s.digital && s.card_count > 0)
    .map(s => ({ code: s.code, name: s.name, released: s.released_at || '', type: s.set_type, count: s.card_count }))
    .sort((a, b) => (b.released || '').localeCompare(a.released || ''));
  const st = setsState();
  const first = !st.known.length;
  const known = new Set(st.known);
  const now = today();
  // (a set announced but not out yet stays "upcoming", and counts as new on the check after it comes out)
  const released = list.filter(s => s.released && s.released <= now);
  const added = first ? [] : released.filter(s => !known.has(s.code));
  const upcoming = list.filter(s => s.released > now).reverse();
  store(KEY, { known: released.map(s => s.code), list, checkedAt: Date.now() });
  // Saved cards from before a new release are refreshed (legalities, rotations)
  if (added.length) store('ct.cardsStaleBefore', Date.now());
  return { first, added, upcoming, latest: released.slice(0, 5) };
}

// Checks at most once a day (startup); quietly does nothing offline
export async function dailySetCheck() {
  const st = setsState();
  if (Date.now() - (st.checkedAt || 0) < 20 * 3600 * 1000) return null;
  try { return await checkSets(); } catch { return null; }
}

// The newest sets to draft (for Draft / Sealed and the Expedition), from the last check
export function draftableSets(n = 10) {
  const now = today();
  return setsState().list.filter(s => DRAFTABLE.includes(s.type) && s.released && s.released <= now && s.count >= 150).slice(0, n).map(s => [s.code, s.name]);
}
