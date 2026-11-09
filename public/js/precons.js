// Commander precons (item 146): the official preconstructed Commander decks from MTGJSON's deck files (free, open
// license, https://mtgjson.com). The list of decks is kept for a week and each deck once, in the browser profile, so
// a deck seated before plays offline. A seat's source "precon:<file name>" loads one (decks.js).
import { store } from './util.js';

const API = 'https://mtgjson.com/api/v5';
const LIST = 'ct.preconList', DECKS = 'ct.precons';

// [{ file, name, code, released }] newest first
export async function preconList({ refresh = false } = {}) {
  const saved = store(LIST);
  if (saved && !refresh && Date.now() - saved.at < 7 * 864e5) return saved.list;
  try {
    const r = await fetch(`${API}/DeckList.json`);
    if (!r.ok) throw new Error(`MTGJSON answered ${r.status}`);
    const list = (await r.json()).data.filter(d => d.type === 'Commander Deck')
      .map(d => ({ file: d.fileName, name: d.name, code: d.code, released: d.releaseDate || '' }))
      .sort((a, b) => b.released.localeCompare(a.released) || a.name.localeCompare(b.name));
    try { store(LIST, { at: Date.now(), list }); } catch { /* full */ }
    return list;
  } catch (e) {
    if (saved) return saved.list;
    throw e;
  }
}

// One precon as a decklist: { name, text } ("Commander" and "Deck" sections, as a pasted list)
export async function preconText(file) {
  if (!/^[\w-]+$/.test(file)) throw new Error('That isn\'t a precon name.');
  const saved = store(DECKS) || {};
  if (saved[file]) return saved[file];
  const r = await fetch(`${API}/decks/${file}.json`);
  if (!r.ok) throw new Error(r.status === 404 ? 'MTGJSON has no deck by that name.' : `MTGJSON answered ${r.status}`);
  const d = (await r.json()).data;
  const line = c => `${c.count} ${c.name}`;
  const text = ['Commander', ...(d.commander || []).map(line), 'Deck', ...(d.mainBoard || []).map(line)].join('\n');
  const out = { name: `${d.name} (${d.code})`, text };
  saved[file] = out;
  try { store(DECKS, saved); } catch { /* full: fetched again next time */ }
  return out;
}
