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

export function store(key, value) {
  try {
    if (value === undefined) return JSON.parse(localStorage.getItem(key) || 'null');
    localStorage.setItem(key, JSON.stringify(value));
  } catch { return null; }
}
