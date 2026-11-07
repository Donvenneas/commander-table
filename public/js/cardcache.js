// Offline card data: every card Scryfall sends is saved in the browser's database (IndexedDB, inside the
// browser profile that lives in the game folder's data/), keyed by how the deck asked for it. Decks load
// from here first and only ask Scryfall for cards not seen before, so a deck loaded once works offline.
// Card images are kept by the local server in data\images (see /api/img).

const DB = 'ct-cards', STORE = 'cards';
let dbp = null;

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

// keys → Map(key → raw Scryfall card) for the ones saved
export async function getCards(keys) {
  const db = await open();
  const out = new Map();
  if (!db || !keys.length) return out;
  await new Promise(res => {
    try {
      const tx = db.transaction(STORE, 'readonly');
      const st = tx.objectStore(STORE);
      for (const k of keys) { const r = st.get(k); r.onsuccess = () => { if (r.result) out.set(k, r.result.raw); }; }
      tx.oncomplete = tx.onerror = tx.onabort = () => res();
    } catch { res(); }
  });
  return out;
}

export async function putCards(entries) {
  const db = await open();
  if (!db || !entries.length) return;
  await new Promise(res => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      const st = tx.objectStore(STORE);
      const at = Date.now();
      for (const [k, raw] of entries) st.put({ raw, at }, k);
      tx.oncomplete = tx.onerror = tx.onabort = () => res();
    } catch { res(); }
  });
}

export async function cardCount() {
  const db = await open();
  if (!db) return 0;
  return new Promise(res => {
    try { const r = db.transaction(STORE, 'readonly').objectStore(STORE).count(); r.onsuccess = () => res(r.result); r.onerror = () => res(0); } catch { res(0); }
  });
}

export async function clearCards() {
  const db = await open();
  if (!db) return;
  await new Promise(res => { try { const tx = db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).clear(); tx.oncomplete = tx.onerror = () => res(); } catch { res(); } });
}
