export const sleep = ms => new Promise(r => setTimeout(r, ms));

// Seeded random numbers (mulberry32): the same seed and decks replay the exact same game
export function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// JSON with object keys in sorted order, so the same data always gives the same text (replay card hashes)
export function stableJson(v) {
  return JSON.stringify(v, (_, x) => (x instanceof Set ? [...x].sort() : x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map(k => [k, x[k]])) : x));
}
// A short fingerprint of a text (cyrb53, 53 bits as 14 hex digits): replays use it to notice changed card data
export function hashText(str) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}

// A moment for the page (or Node's event loop) between pieces of a long computation; nothing in a game depends on it
/** @type {any} */
const G = globalThis;
export const yieldTick = () => new Promise(r => (typeof window === 'undefined' && typeof G.setImmediate === 'function' ? G.setImmediate(r) : setTimeout(r, 0)));

export function shuffle(a, rand = Math.random) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Replace {W}, {2/U}, {T} etc. with Scryfall's mana symbol SVGs.
export function symbolize(text) {
  return esc(text).replace(/\{([^}]+)\}/g, (_, s) =>
    `<img class="sym" alt="{${s}}" src="${esc(imgUrl(`https://svgs.scryfall.io/card-symbols/${encodeURIComponent(s.replace('/', '').toUpperCase())}.svg`))}">`);
}

// On the host's own page, Scryfall images go through the local server, which keeps them in data\images
// for offline play. Friends' pages (play.html) load them from Scryfall directly.
const HOSTED = typeof location !== 'undefined' && ['localhost', '127.0.0.1'].includes(location.hostname) && !/play\.html$/.test(location.pathname);
export const imgUrl = u => (HOSTED && u && /^https:\/\/(cards|svgs)\.scryfall\.io\//.test(u) ? `/api/img?u=${encodeURIComponent(u)}` : u);
export const unproxy = u => (u && u.startsWith('/api/img?u=') ? decodeURIComponent(u.slice(11)) : u);

// Large saved data lives in IndexedDB (item 179), where there's room for it; the rest stays in localStorage. The large
// keys are read once when the page starts (this module waits for that, so every module that saves things finds them
// loaded) and kept in memory as JSON text, so store() stays synchronous: a write updates memory at once and is saved
// in the background. Other tabs of the game hear about each write. Without IndexedDB (an old browser, Node, a worker)
// everything stays in localStorage as before. The first start after this change moves the keys over.
const BIG = new Set(['ct.autosave', 'ct.spellbook', 'ct.learn', 'ct.history', 'ct.libVersions', 'ct.threat', 'ct.people', 'ct.collection',
  'ct.otags2', 'ct.precons', 'ct.preconList', 'ct.rulings', 'ct.i18nCards2', 'ct.planar.archenemy', 'ct.planar.planechase']);
/** @type {Map<string, string>} */
const bigVals = new Map();
/** @type {IDBDatabase | null} */
let bigDb = null;
/** @type {BroadcastChannel | null} */
let bigChan = null;
function bigPut(k, v) { try { bigDb?.transaction('kv', 'readwrite').objectStore('kv').put(v, k); } catch { /* saved again on the next write */ } }
async function loadBig() {
  if (typeof window === 'undefined' || typeof indexedDB === 'undefined') return;
  try {
    /** @type {IDBDatabase} */
    const db = await Promise.race([
      new Promise((res, rej) => { const r = indexedDB.open('ct-store', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('IndexedDB did not open')), 4000)),
    ]);
    const st = db.transaction('kv', 'readonly').objectStore('kv');
    await Promise.all([...BIG].map(k => new Promise(res => { const q = st.get(k); q.onsuccess = () => { if (typeof q.result === 'string') bigVals.set(k, q.result); res(undefined); }; q.onerror = () => res(undefined); })));
    // (moving keys from localStorage: removed there only once IndexedDB has them)
    const move = [];
    for (const k of BIG) { let v = null; try { v = localStorage.getItem(k); } catch { /* blocked */ } if (v != null) move.push([k, v]); }
    if (move.length) {
      const tx = db.transaction('kv', 'readwrite');
      for (const [k, v] of move) if (!bigVals.has(k)) { bigVals.set(k, v); tx.objectStore('kv').put(v, k); }
      tx.oncomplete = () => { for (const [k] of move) try { localStorage.removeItem(k); } catch { /* blocked */ } };
    }
    bigDb = db;
    if (typeof BroadcastChannel === 'function') {
      bigChan = new BroadcastChannel('ct-store');
      bigChan.onmessage = ({ data }) => { if (data && BIG.has(data.k) && typeof data.v === 'string') bigVals.set(data.k, data.v); };
    }
  } catch { bigDb = null; }
}
await loadBig();
// Where the large keys are kept now ('IndexedDB' or 'localStorage'), and how big a key is in bytes (UTF-16, as browsers count)
export const storeWhere = () => (bigDb ? 'IndexedDB' : 'localStorage');
export const storeIsBig = k => !!bigDb && BIG.has(k);
export function storeSize(key) {
  if (bigDb && BIG.has(key)) { const v = bigVals.get(key); return v ? (v.length + key.length) * 2 : 0; }
  try { const v = localStorage.getItem(key); return v ? (v.length + key.length) * 2 : 0; } catch { return 0; }
}

export function store(key, value) {
  if (bigDb && BIG.has(key)) {
    if (value === undefined) { try { return JSON.parse(bigVals.get(key) || 'null'); } catch { return null; } }
    const s = JSON.stringify(value);
    bigVals.set(key, s);
    bigPut(key, s);
    bigChan?.postMessage({ k: key, v: s });
    return;
  }
  try {
    if (value === undefined) return JSON.parse(localStorage.getItem(key) || 'null');
    localStorage.setItem(key, JSON.stringify(value));
  } catch { return null; }
}
