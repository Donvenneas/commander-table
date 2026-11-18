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

// What a symbol is called when read aloud: {W} "white mana", {2} "2 generic mana", {T} "tap", {W/U} "white or blue mana",
// {2/W} "2 generic or white mana", {B/P} "black mana or 2 life".
const SYMBOL_WORDS = { W: 'white', U: 'blue', B: 'black', R: 'red', G: 'green', C: 'colorless', S: 'snow' };
const SYMBOL_NAMES = { T: 'tap', Q: 'untap', E: 'energy', X: 'X generic mana', Y: 'Y generic mana', Z: 'Z generic mana', P: 'Phyrexian mana', CHAOS: 'chaos', TK: 'ticket', A: 'acorn', '∞': 'infinite mana', '½': 'half a generic mana' };
export function symbolName(sym) {
  const s = String(sym).toUpperCase();
  if (SYMBOL_NAMES[s]) return SYMBOL_NAMES[s];
  const part = x => SYMBOL_WORDS[x] || (/^\d+$/.test(x) ? `${x} generic` : x === 'P' ? null : x.toLowerCase());
  const bits = s.split('/');
  const life = bits.includes('P') && bits.length > 1;
  const words = bits.map(part).filter(Boolean);
  return `${words.join(' or ')} mana${life ? ' or 2 life' : ''}`;
}
// Replace {W}, {2/U}, {T} etc. with Scryfall's mana symbol SVGs.
export function symbolize(text) {
  return esc(text).replace(/\{([^}]+)\}/g, (_, s) =>
    `<img class="sym" alt="${esc(symbolName(s))}" src="${esc(imgUrl(`https://svgs.scryfall.io/card-symbols/${encodeURIComponent(s.replace('/', '').toUpperCase())}.svg`))}">`);
}

// A card's face in words (moved here from builder.js in 1.55.0): under a picture while it loads, and instead of it
// when there is none or it fails to load (installImageFallback). Built only from the card's own data.
const TYPE_MARK = [['Creature', '◆'], ['Planeswalker', '✪'], ['Instant', '⚡'], ['Sorcery', '✦'], ['Artifact', '⚙'], ['Enchantment', '✧'], ['Battle', '⛨'], ['Land', '▲']];
const typeMark = c => (TYPE_MARK.find(([t]) => String(c.typeLine || '').includes(t)) || ['', '•'])[1];
export const ptOf = c => (c.power != null ? `${c.power}/${c.toughness}` : c.loyalty ? `Loyalty ${c.loyalty}` : c.defense ? `Defense ${c.defense}` : c.pt || '');
export const colorBar = c => {
  const cs = c.colors?.length ? c.colors : /\bLand\b/.test(c.typeLine || '') ? c.colorIdentity || [] : [];
  const v = cs.filter(x => 'WUBRG'.includes(x)).map(x => `var(--mana-${x.toLowerCase()})`);
  return v.length > 1 ? `linear-gradient(90deg, ${v.join(', ')})` : v[0] || 'var(--mana-c)';
};
export const cardFace = c => `<div class="cface" style="--cf:${colorBar(c)}"><i class="cface-type" aria-hidden="true">${typeMark(c)}</i><b>${esc(c.name)}</b><small>${esc(c.typeLine || '')}</small>${c.manaCost ? `<span class="cost">${symbolize(c.manaCost)}</span>` : ''}${ptOf(c) ? `<span class="pt">${esc(ptOf(c))}</span>` : ''}</div>`;

// (1.55.0) One listener for every card picture on a page: a picture that fails to load (offline, Scryfall busy) is
// replaced by the card's face in words, or simply removed where it was only decoration (log thumbnails, stack art).
// cardFor(el) finds the card for the element holding the picture (by its data-iid), or returns null.
export function installImageFallback(cardFor) {
  if (typeof document === 'undefined' || document.documentElement.dataset.imgFallback) return;
  document.documentElement.dataset.imgFallback = '1';
  document.addEventListener('error', ev => {
    const img = ev.target;
    // (mana symbols keep their alt text; the deck builder's tiles already have a face under the picture)
    if (!(img instanceof HTMLImageElement) || img.classList.contains('sym') || img.closest('.ctile-img, .insp-img')) return;
    if (img.closest('.le, .sp-art, .pile, .mt-roleart, .mt-tips') || img.classList.contains('le-thumb')) {
      if (img.closest('.mt-tips')) img.closest('.mt-tips')?.remove(); else img.remove();
      return;
    }
    const host = /** @type {HTMLElement | null} */ (img.closest('[data-iid]'));
    const card = cardFor(host, img);
    if (!card) { img.remove(); return; }
    const d = document.createElement('div');
    d.className = `img-fallback${img.classList.contains('big') ? ' big' : ''}`;
    d.innerHTML = cardFace(card);
    d.setAttribute('role', 'img');
    d.setAttribute('aria-label', `${card.name} (picture unavailable)`);
    img.replaceWith(d);
    host?.classList.add('noimg-failed');
  }, true);
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

// (Phase 2O) Saved data that can't be read, and writes that fail, are counted and reported (a "ct-store" event on the
// page, which main.js turns into one notice), never thrown at the caller. A read of damaged data gives null (the
// caller's defaults) and leaves the saved text alone; a failed write (storage full, blocked) keeps the last value
// that was saved. storeProblems() is what happened this session.
const problems = { damaged: /** @type {string[]} */ ([]), failed: /** @type {string[]} */ ([]), quota: false };
export const storeProblems = () => ({ damaged: [...problems.damaged], failed: [...problems.failed], quota: problems.quota });
function storeReport(kind, key, e) {
  const list = problems[kind];
  if (!list.includes(key)) list.push(key);
  if (kind === 'failed' && /quota/i.test(`${e?.name || ''} ${e?.message || ''}`)) problems.quota = true;
  try { if (typeof dispatchEvent === 'function' && typeof CustomEvent === 'function') dispatchEvent(new CustomEvent('ct-store', { detail: { kind, key, quota: problems.quota } })); } catch { /* no page */ }
}
const parseSaved = (key, text) => { if (text == null || text === '') return null; try { return JSON.parse(text); } catch { storeReport('damaged', key); return null; } };

export function store(key, value) {
  if (bigDb && BIG.has(key)) {
    if (value === undefined) return parseSaved(key, bigVals.get(key));
    const s = JSON.stringify(value);
    bigVals.set(key, s);
    try {
      const req = bigDb.transaction('kv', 'readwrite').objectStore('kv').put(s, key);
      req.onerror = () => storeReport('failed', key, req.error);
    } catch (e) { storeReport('failed', key, e); }
    bigChan?.postMessage({ k: key, v: s });
    return true;
  }
  let text = null;
  try { if (value === undefined) text = localStorage.getItem(key); } catch { return null; }
  if (value === undefined) return parseSaved(key, text);
  try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch (e) { storeReport('failed', key, e); return false; }
}

// Dates and numbers in the language chosen in Display (i18n.js sets it on <html lang>), not the browser's own
// (design roadmap item 374). The game log stays in English and does not use these.
const lang = () => (typeof document !== 'undefined' && document.documentElement.lang) || undefined;
/** A date and time, e.g. for "saved at". */
export function whenText(at, opts) { try { return new Date(at).toLocaleString(lang(), opts); } catch { return new Date(at).toLocaleString(); } }
/** A date without the time. */
export function dayText(at, opts) { try { return new Date(at).toLocaleDateString(lang(), opts); } catch { return new Date(at).toLocaleDateString(); } }
/** A number with the language's thousands separators. */
export function numText(n) { try { return Number(n).toLocaleString(lang()); } catch { return String(n); } }
