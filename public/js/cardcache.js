// Offline card data: every card Scryfall sends is saved in the browser's database (IndexedDB, inside the
// browser profile that lives in the game folder's data/), keyed by how the deck asked for it. Decks load
// from here first and only ask Scryfall for cards not seen before, so a deck loaded once works offline.
// Card images are kept by the local server in data\images (see /api/img).
//
// (1.56.0, Phase 2N) Each record is { raw, at, v } (v: carddata.js CARD_SCHEMA; older records have none and are still
// read). A card is also saved under its other keys (its id, its name, its front face's name, its oracle id and its set
// + collector number) when nothing is saved there yet, so a deck saved as names loads offline after it was imported by
// ids, and the other way round. Records are checked when read: a damaged one is skipped (and fetched again when
// online), never used. Only cards that passed carddata.js check() are saved (scryfall.js), so a failed or odd answer
// never replaces a good saved card.
import { check, aliasKeys, CARD_SCHEMA } from './carddata.js';

const DB = 'ct-cards', STORE = 'cards', META = 'ct.cards.meta';
let dbp = null;
let damaged = 0;

function open() {
  if (!('indexedDB' in globalThis)) return Promise.resolve(null);
  dbp ||= new Promise(res => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => res(req.result);
      req.onerror = () => res(null);
    } catch { res(null); }
  });
  return dbp;
}

const readMeta = () => { try { return JSON.parse(globalThis.localStorage?.getItem(META) || 'null') || {}; } catch { return {}; } };
const writeMeta = m => { try { globalThis.localStorage?.setItem(META, JSON.stringify(m)); } catch { /* no storage */ } };

// keys → Map(key → raw Scryfall card) for the ones saved (and usable)
export async function getCards(keys) {
  const db = await open();
  const out = new Map();
  if (!db || !keys.length) return out;
  await new Promise(res => {
    try {
      const tx = db.transaction(STORE, 'readonly');
      const st = tx.objectStore(STORE);
      for (const k of keys) {
        const r = st.get(k);
        r.onsuccess = () => {
          const rec = r.result;
          if (!rec) return;
          if (!rec.raw || !check(rec.raw).ok) { damaged++; return; }
          out.set(k, rec.raw);
        };
      }
      tx.oncomplete = tx.onerror = tx.onabort = () => res();
    } catch { res(); }
  });
  return out;
}

// entries: [key, raw][]; every card is saved under its key, and under its other keys where nothing is saved yet
export async function putCards(entries) {
  const db = await open();
  entries = entries.filter(([, raw]) => check(raw).ok);
  if (!db || !entries.length) return 0;
  const at = Date.now();
  const ok = await new Promise(res => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      const st = tx.objectStore(STORE);
      for (const [k, raw] of entries) {
        st.put({ raw, at, v: CARD_SCHEMA }, k);
        for (const a of aliasKeys(raw)) {
          if (a === k) continue;
          // (add, not put: an alias never replaces a card saved under that key; its "already there" error is expected)
          const r = st.add({ raw, at, v: CARD_SCHEMA, alias: true }, a);
          r.onerror = e => { e?.preventDefault?.(); e?.stopPropagation?.(); };
        }
      }
      tx.oncomplete = () => res(true);
      tx.onerror = tx.onabort = () => res(false);
    } catch { res(false); }
  });
  if (ok) writeMeta({ ...readMeta(), schema: CARD_SCHEMA, source: 'Scryfall API', lastOk: at });
  return ok ? entries.length : 0;
}

export async function cardCount() {
  const db = await open();
  if (!db) return 0;
  return new Promise(res => {
    try { const r = db.transaction(STORE, 'readonly').objectStore(STORE).count(); r.onsuccess = () => res(r.result); r.onerror = () => res(0); } catch { res(0); }
  });
}

// What the card database holds and when it was last updated (Storage window, tests)
export async function cacheInfo() {
  const m = readMeta();
  return { records: await cardCount(), schema: m.schema || 1, source: m.source || 'Scryfall API', lastOk: m.lastOk || null, damagedSkipped: damaged };
}

export async function clearCards() {
  const db = await open();
  if (!db) return;
  await new Promise(res => { try { const tx = db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).clear(); tx.oncomplete = tx.onerror = () => res(); } catch { res(); } });
}
