// Real booster contents from MTGJSON (mtgjson.com, free and open): each set's booster sheets say which
// slots a pack has (commons, uncommons, rare/mythic, wildcard, foil, land…), how often each pack layout
// appears, and how likely each card is on its sheet. Packs built from them match the real product much
// better than a fixed 1 rare + 3 uncommons + 9 commons.
//
// Only the small part the packs need is kept (card names, weights, colors), in the browser profile
// (inside the game folder's data\) so drafts work offline after one load. Refreshed after 30 days.
// Simplifications: foils are normal copies of their card; basic lands and cards from other sets
// (Special Guests, The List) are left out, since the pool only has this set's non-basic cards.
import { store } from './util.js';
import { fetchCollection } from './scryfall.js';

const FRESH = 30 * 86400000;
const KINDS = ['play', 'draft', 'default'];          // never collector or set boosters
const RESERVED = new Set(['CON', 'PRN', 'AUX', 'NUL']); // MTGJSON adds "_" to Windows-reserved file names

// The set's draft-style booster as compact data, or null when MTGJSON has none for it
async function fetchSheets(code) {
  const file = RESERVED.has(code) ? `${code}_` : code;
  const r = await fetch(`https://mtgjson.com/api/v5/${file}.json`);
  if (r.status === 404) return { none: true };
  if (!r.ok) throw new Error(`MTGJSON answered HTTP ${r.status}`);
  const set = (await r.json()).data;
  const kind = KINDS.find(k => set.booster?.[k]);
  if (!kind) return { none: true };
  const b = set.booster[kind];
  const byUuid = new Map(set.cards.map(c => [c.uuid, c]));
  const sheets = {};
  for (const [name, sh] of Object.entries(b.sheets)) {
    const cards = new Map();
    for (const [uuid, w] of Object.entries(sh.cards)) {
      const c = byUuid.get(uuid);
      if (!c || c.supertypes?.includes('Basic')) continue;
      const prev = cards.get(c.name);
      cards.set(c.name, [c.name, (prev?.[1] || 0) + w, (c.colors || []).join('')]);
    }
    sheets[name] = { cards: [...cards.values()], balance: !!sh.balanceColors };
  }
  return { kind, name: b.name || kind, boosters: b.boosters.map(x => ({ c: x.contents, w: x.weight })), sheets };
}

// Booster data for a set code: saved copy when fresh, else MTGJSON (the saved copy is used offline)
export async function boosterData(code, onStatus) {
  code = code.toUpperCase();
  const k = `ct.boosters.${code}`;
  const saved = store(k);
  if (saved && Date.now() - saved.at < FRESH) return saved.none ? null : saved;
  try {
    onStatus?.(`Loading ${code}'s booster contents from MTGJSON…`);
    const d = { ...(await fetchSheets(code)), at: Date.now() };
    store(k, d);
    return d.none ? null : d;
  } catch (e) {
    if (saved) return saved.none ? null : saved;
    console.warn('MTGJSON booster data unavailable:', e.message);
    return null;
  }
}

function weighted(list, rand, weightOf) {
  let total = 0;
  for (const x of list) total += weightOf(x);
  let r = rand() * total;
  for (const x of list) { r -= weightOf(x); if (r < 0) return x; }
  return list[list.length - 1];
}

const isLegendaryCreature = c => /legendary/i.test(c.typeLine) && (/creature/i.test(c.typeLine) || c.canBeCommander);

// A pack function (pool, rand) → cards for limited.js, from booster data and the set's cards.
// Card names on the sheets that Scryfall's booster list doesn't have are fetched by name.
// legend: every pack gets a legendary creature (Commander pods), replacing its last common if needed.
export async function boosterPacker(data, pool, { legend = false } = {}) {
  const byName = new Map();
  for (const c of pool) { byName.set(c.name, c); if (c.frontName && !byName.has(c.frontName)) byName.set(c.frontName, c); }
  const want = new Set();
  for (const sh of Object.values(data.sheets)) for (const [n] of sh.cards) if (!byName.has(n)) want.add(n);
  if (want.size) {
    try {
      const { cards, key } = await fetchCollection([...want].map(name => ({ name })));
      for (const n of want) { const c = cards.get(key({ name: n })); if (c) byName.set(n, c); }
    } catch { /* offline: those cards are left out */ }
  }
  // Only cards we have; empty sheets are skipped
  const sheets = Object.fromEntries(Object.entries(data.sheets).map(([k, sh]) => [k, { ...sh, cards: sh.cards.filter(([n]) => byName.has(n)) }]));
  const legends = pool.filter(isLegendaryCreature);
  return (_, rand) => {
    const layout = weighted(data.boosters, rand, x => x.w).c;
    const pack = [];
    for (const [name, n] of Object.entries(layout)) {
      const sh = sheets[name];
      if (!sh?.cards.length) continue;
      const left = [...sh.cards];
      let got = 0;
      const take = entry => { left.splice(left.indexOf(entry), 1); pack.push(byName.get(entry[0])); got++; };
      // Color-balanced sheets (commons in many sets): one card of each color first
      if (sh.balance && n >= 5) for (const col of 'WUBRG') { const mono = left.filter(e => e[2] === col); if (mono.length) take(weighted(mono, rand, e => e[1])); }
      while (got < n && left.length) take(weighted(left, rand, e => e[1]));
    }
    if (legend && legends.length && !pack.some(isLegendaryCreature)) {
      const options = legends.filter(c => !pack.includes(c));
      const i = pack.map(c => c.rarity).lastIndexOf('common');
      if (options.length) pack.splice(i >= 0 ? i : pack.length, i >= 0 ? 1 : 0, options[Math.floor(rand() * options.length)]);
    }
    return pack;
  };
}
