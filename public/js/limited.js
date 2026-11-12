// Sealed and draft pods: packs from a real set (card lists from Scryfall), AI drafters, and deck building
// into small Commander decks (a legendary creature from the pool as commander, 39 more cards, basics added).
import { sf, normalize, fetchCollection } from './scryfall.js';
import { makeRng } from './util.js';
import { boosterData, boosterPacker } from './boosters.js';

const RARITY = { common: 1, uncommon: 2.5, rare: 4, mythic: 5, special: 3, bonus: 3 };
const COLORS = ['W', 'U', 'B', 'R', 'G'];
const BASIC = { W: 'Plains', U: 'Island', B: 'Swamp', R: 'Mountain', G: 'Forest' };
export const DECK_SIZE = 40;

// Every card that can appear in a booster of the set (Scryfall's own "is:booster" flag)
export async function setPool(code, onStatus) {
  const cards = [];
  let path = `/cards/search?q=${encodeURIComponent(`e:${code} is:booster -t:basic`)}&unique=cards&order=set`;
  for (let page = 1; path && page <= 8; page++) {
    onStatus?.(`Loading the set's cards from Scryfall (page ${page})…`);
    const j = await sf(path);
    cards.push(...j.data.map(normalize));
    path = j.has_more ? j.next_page.replace('https://api.scryfall.com', '') : null;
  }
  if (cards.length < 40) throw new Error(`Scryfall has too few booster cards for set "${code}"`);
  return cards;
}

const isLegendaryCreature = c => /legendary/i.test(c.typeLine) && (/creature/i.test(c.typeLine) || c.canBeCommander);

// A pack: 1 rare or mythic (mythic 1 time in 8), 3 uncommons, 9 commons, and 1 legendary card,
// so every pool has commanders to choose from
export function makePack(pool, rand) {
  const by = r => pool.filter(c => c.rarity === r);
  const pick = (list, n, taken) => {
    const out = [];
    for (let i = 0; i < n * 20 && out.length < n && list.length; i++) {
      const c = list[Math.floor(rand() * list.length)];
      if (!taken.has(c.name)) { taken.add(c.name); out.push(c); }
    }
    return out;
  };
  const taken = new Set();
  const mythics = by('mythic'), rares = by('rare');
  const top = (rand() < 0.125 && mythics.length) || !rares.length ? mythics : rares;
  const legends = pool.filter(isLegendaryCreature);
  return [...pick(top, 1, taken), ...pick(legends, 1, taken), ...pick(by('uncommon'), 3, taken), ...pick(by('common'), 9, taken)];
}

const identity = c => c.colorIdentity || [];

// Card ratings for the set being drafted: each card's win rate when drawn, computed from 17Lands' public game
// data (CC BY 4.0; tools/ratings_17lands.py builds public/data/ratings/<SET>.json). null: no ratings for this set.
let RATINGS = null;
export async function loadRatings(code) {
  RATINGS = null;
  try {
    const r = await fetch(`/data/ratings/${code.toUpperCase()}.json`);
    if (r.ok) RATINGS = await r.json();
  } catch { /* no ratings: the heuristics alone pick */ }
  return RATINGS;
}
// weight: how much the rating leads over the heuristics; readOnly: trust ratings only for cards the simulator
// reads fully (a card that wins for people can do nothing here if part of its text isn't simulated)
// (tuned 2026-11-07, BLB + FDN drafts, 96 games per setting, rated vs plain seat-0 decks: weight 0.7 with every
// rated card 12-36; readOnly 0.7 56-40; readOnly 0.4 59-37; readOnly 0.2 59-37)
export const RATING_OPTS = { weight: 0.4, readOnly: true };
const ratingOf = c => RATINGS && !(RATING_OPTS.readOnly && c.fx.unread?.length) && (RATINGS.cards[c.name] || RATINGS.cards[c.frontName]);

// How much a drafter wants a card, given what it already picked
// HEURISTIC.v2 (item 116): more kinds of removal, creature size for its cost, the curve, and cards the simulator
// can't fully read count for less
export const HEURISTIC = { v2: true };
const REMOVAL_V2 = ['remove', 'wipe', 'counter', 'damage', 'bounce', 'tuck', 'fight', 'edict', 'shrink', 'minus', 'sweep'];
export function pickScore(c, picks, v2 = HEURISTIC.v2) {
  let s = RARITY[c.rarity] || 1;
  if (c.fx.type.land && !c.fx.mana) s -= 1;
  if (c.fx.type.creature) s += 0.4;
  if (c.fx.spell.some(e => (v2 ? REMOVAL_V2 : ['remove', 'wipe', 'counter', 'damage']).includes(e.k))) s += 1;
  if (v2) {
    const mv = c.cmc || 0;
    if (c.fx.type.creature) s += Math.max(-0.5, Math.min(0.8, ((+c.power || 0) + (+c.toughness || 0)) / (2 * Math.max(1, mv)) - 1));
    if (c.fx.etb.some(e => REMOVAL_V2.includes(e.k))) s += 0.8;
    const twos = picks.filter(p => p.fx.type.creature && (p.cmc || 0) <= 2).length;
    if (picks.length >= 10 && twos < 4 && c.fx.type.creature && mv <= 2) s += 0.5;
    if (mv >= 6 && picks.filter(p => (p.cmc || 0) >= 6).length >= 2) s -= 1;
    if (c.fx.unread?.length) s -= 0.5;
  }
  // With ratings, the card's real win rate counts too (5 points of win rate over the set's average ≈ +2.5)
  const r = ratingOf(c);
  if (r) s = (1 - RATING_OPTS.weight) * s + RATING_OPTS.weight * (2.5 + (r.gihwr - RATINGS.average) * 50);
  if (isLegendaryCreature(c)) s += picks.some(isLegendaryCreature) ? 0.3 : 2;
  // Stay in the colors already taken (strongly, once there are a few picks)
  const counts = {};
  for (const p of picks) for (const col of identity(p)) counts[col] = (counts[col] || 0) + 1;
  const main = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 2).map(x => x[0]);
  const off = identity(c).filter(col => !main.includes(col)).length;
  if (picks.length >= 4 && off) s -= off * Math.min(3, picks.length / 4);
  if (!identity(c).length) s += 0.3;
  return s;
}
export const aiPick = (pack, picks) => [...pack].sort((a, b) => pickScore(b, picks) - pickScore(a, picks))[0];

// A Commander deck from a pool: the best commander, the best cards in its colors, then basic lands
export function buildDeck(pool, commander = null) {
  const legends = pool.filter(isLegendaryCreature);
  if (!commander) {
    commander = legends.map(c => {
      const ci = identity(c);
      const fits = pool.filter(x => x !== c && !x.fx.type.land && identity(x).every(col => ci.includes(col)));
      return { c, s: fits.reduce((a, x) => a + (RARITY[x.rarity] || 1), 0) + (RARITY[c.rarity] || 1) * 2 };
    }).sort((a, b) => b.s - a.s)[0]?.c;
  }
  if (!commander) return null;
  const ci = identity(commander);
  const fits = x => x !== commander && identity(x).every(col => ci.includes(col));
  const spells = pool.filter(x => fits(x) && !x.fx.type.land)
    .sort((a, b) => pickScore(b, []) - pickScore(a, []) || (a.cmc || 0) - (b.cmc || 0));
  // Keep the curve sane: few cards over five mana
  const chosen = [];
  let big = 0;
  for (const c of spells) {
    if (chosen.length >= 23) break;
    if ((c.cmc || 0) >= 6) { if (big >= 2) continue; big++; }
    chosen.push(c);
  }
  const lands = pool.filter(x => fits(x) && x.fx.type.land && x.fx.mana).slice(0, 3);
  return { commander, cards: [...chosen, ...lands] };
}

// The deck as a decklist the loader reads; basics fill it to DECK_SIZE, split by the colored pips
export function deckText(deck, name) {
  const ci = deck.commander.colorIdentity?.length ? deck.commander.colorIdentity : ['C'];
  const pips = Object.fromEntries(ci.map(c => [c, 0]));
  for (const c of [deck.commander, ...deck.cards]) for (const [, col] of (c.manaCost || '').matchAll(/\{([WUBRG])/g)) if (col in pips) pips[col]++;
  const free = DECK_SIZE - 1 - deck.cards.length;
  const total = Object.values(pips).reduce((a, b) => a + b, 0) || 1;
  const basics = [];
  let left = free;
  ci.forEach((col, i) => {
    const n = i === ci.length - 1 ? left : Math.round((free * (pips[col] || 0)) / total);
    if (n > 0) basics.push(`${n} ${col === 'C' ? 'Wastes' : BASIC[col]}`);
    left -= Math.max(0, n);
  });
  const line = c => `1 ${c.name} (${(c.set || '').toUpperCase()}) ${c.cn}`;
  return [`About`, `Name ${name}`, '', 'Commander', line(deck.commander), '', 'Deck', ...deck.cards.map(line), ...basics].join('\n');
}

// ---------- one-on-one Limited (40 cards, no commander, 20 life; the rest of the pool is the sideboard)
// The best two colors of a pool (by how much it wants the cards in them), 23 spells and 17 lands
export function buildLimited(pool, colors = null) {
  const spellsIn = cols => pool.filter(c => !c.fx.type.land && identity(c).every(col => cols.includes(col)));
  if (!colors) {
    let best = null, bv = -1;
    for (let i = 0; i < 5; i++) for (let j = i + 1; j < 5; j++) {
      const cols = [COLORS[i], COLORS[j]];
      const top = spellsIn(cols).map(c => pickScore(c, [])).sort((a, b) => b - a).slice(0, 23);
      const v = top.reduce((a, b) => a + b, 0) + top.length * 0.5;
      if (v > bv) { bv = v; best = cols; }
    }
    colors = best || ['W', 'U'];
  }
  const spells = spellsIn(colors).sort((a, b) => pickScore(b, []) - pickScore(a, []) || (a.cmc || 0) - (b.cmc || 0));
  const chosen = [];
  let big = 0;
  for (const c of spells) {
    if (chosen.length >= 23) break;
    if ((c.cmc || 0) >= 6) { if (big >= 2) continue; big++; }
    chosen.push(c);
  }
  const lands = pool.filter(x => x.fx.type.land && x.fx.mana && identity(x).length && identity(x).every(col => colors.includes(col))).slice(0, 2);
  return { colors, cards: [...chosen, ...lands] };
}
// Basic lands that fill a 40-card deck, split by the colored pips
function basicsFor(cards, colors, size = DECK_SIZE) {
  const pips = Object.fromEntries(colors.map(c => [c, 0]));
  for (const c of cards) for (const [, col] of (c.manaCost || '').matchAll(/\{([WUBRG])/g)) if (col in pips) pips[col]++;
  const free = Math.max(0, size - cards.length);
  const total = Object.values(pips).reduce((a, b) => a + b, 0) || 1;
  const out = [];
  let left = free;
  colors.forEach((col, i) => {
    const n = i === colors.length - 1 ? left : Math.round((free * (pips[col] || (total === 1 ? 1 : 0))) / total);
    if (n > 0) out.push([BASIC[col], n]);
    left -= Math.max(0, n);
  });
  return out;
}
// The deck as a decklist (Deck, then Sideboard: every pool card not in the deck)
export function limitedText(deck, pool, name) {
  const line = c => `1 ${c.name} (${(c.set || '').toUpperCase()}) ${c.cn}`;
  const inDeck = [...deck.cards];
  const side = [];
  for (const c of pool) { const k = inDeck.indexOf(c); if (k >= 0) inDeck.splice(k, 1); else side.push(c); }
  const basics = basicsFor(deck.cards, deck.colors);
  return [`About`, `Name ${name}`, '', 'Deck', ...deck.cards.map(line), ...basics.map(([n, q]) => `${q} ${n}`), '', 'Sideboard', ...side.map(line)].join('\n');
}

// Sealed: six packs each (packFn: a set's booster, or a cube's)
export function sealedPools(pool, players, seed, packFn = makePack) {
  const rand = makeRng(seed);
  return Array.from({ length: players }, () => Array.from({ length: 6 }, () => packFn(pool, rand)).flat());
}

// ---------- cubes: a list of cards drafted instead of a set. Packs are 15 cards dealt from the
// shuffled cube without repeats (every card at most once per draft), like a real cube.
export function cubePacker(cube, rand, size = 15) {
  const deck = [...cube];
  for (let i = deck.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [deck[i], deck[j]] = [deck[j], deck[i]]; }
  return () => deck.splice(0, size);
}
// Card names from a cube list: CubeCobra's plain list, or any pasted list ("1 Name", "Name", headings skipped)
export function cubeNames(text) {
  return text.split(/\r?\n/).map(l => l.trim()).filter(l => l && !/^(#|\/\/)/.test(l))
    .map(l => l.replace(/^\d+\s*x?\s+/i, '').replace(/\s+\([A-Za-z0-9]{2,6}\)\s*[\w★-]*\s*$/, '').trim())
    .filter(l => l && !/^(mainboard|maybeboard|sideboard|deck|commander)$/i.test(l));
}

// Draft: three rounds of packs passed left, right, left. pickFor(seat, pack, picks) chooses for a person
// (it can be async); the AI picks for everyone else.
// humanSeat: the seat a person picks for, or (item 136, drafting with friends) a test for the seats people pick for;
// everyone picks from their pack at the same time, and the AI drafters straight away
export async function runDraft(pool, players, seed, humanSeat, pickFor, onStatus, packFn = makePack) {
  const asks = typeof humanSeat === 'function' ? humanSeat : s => s === humanSeat;
  const rand = makeRng(seed);
  const picks = Array.from({ length: players }, () => []);
  for (let round = 0; round < 3; round++) {
    let packs = Array.from({ length: players }, () => packFn(pool, rand));
    const size = packs[0].length || 14;
    const dir = round % 2 ? -1 : 1;
    while (packs.some(p => p.length)) {
      onStatus?.(`Pack ${round + 1}, pick ${picks[0].length % size + 1}`);
      const chosen = await Promise.all(packs.map((pack, s) => (!pack.length ? null : asks(s) ? pickFor(s, pack, picks[s]) : aiPick(pack, picks[s]))));
      for (let s = 0; s < players; s++) {
        const pack = packs[s], c = chosen[s] && pack.includes(chosen[s]) ? chosen[s] : pack.length ? aiPick(pack, picks[s]) : null;
        if (!c) continue;
        pack.splice(pack.indexOf(c), 1);
        picks[s].push(c);
      }
      packs = packs.map((_, s) => packs[(s - dir + players) % players]);
    }
  }
  return picks;
}

// A playable deck object (as decks.js loads them) from chosen cards: grouped, basics added to `size`
// split by the colored pips, and the rest of the pool as the sideboard
const group = list => [...list.reduce((m, c) => m.set(c.name, { card: c, qty: (m.get(c.name)?.qty || 0) + 1 }), new Map()).values()];
export async function deckObject(chosen, colors, name, pool = chosen, size = DECK_SIZE) {
  const inDeck = [...chosen];
  const side = pool.filter(c => { const k = inDeck.indexOf(c); if (k >= 0) { inDeck.splice(k, 1); return false; } return true; });
  const basics = basicsFor(chosen, colors.length ? colors : ['G'], size);
  const { cards: got, key } = await fetchCollection(basics.map(([n]) => ({ name: n })));
  return {
    deckName: name, commanders: [], format: 'limited',
    cards: [...group(chosen), ...basics.map(([n, qty]) => ({ card: got.get(key({ name: n })), qty }))],
    sideboard: group(side), warnings: [],
  };
}

// A random sealed deck for the Limited format's empty seats: six packs of a recent set, auto-built
export async function randomSealed(onStatus) {
  const [code, setName] = SUGGESTED_SETS[2 + Math.floor(Math.random() * (SUGGESTED_SETS.length - 2))];
  const pool = await setPool(code, onStatus);
  const sheets = await boosterData(code, onStatus);
  await loadRatings(code);
  const mine = sealedPools(pool, 1, Math.floor(Math.random() * 2 ** 32), sheets ? await boosterPacker(sheets, pool) : makePack)[0];
  const d = buildLimited(mine);
  return deckObject(d.cards, d.colors, `${setName} sealed (${d.colors.join('')})`, mine);
}

// Sets that make good Commander pods (legendary creatures in every pack); any set code works
export const SUGGESTED_SETS = [
  ['cmr', 'Commander Legends'], ['clb', "Commander Legends: Battle for Baldur's Gate"], ['dmu', 'Dominaria United'],
  ['mom', 'March of the Machine'], ['woe', 'Wilds of Eldraine'], ['mkm', 'Murders at Karlov Manor'], ['blb', 'Bloomburrow'],
  ['dsk', 'Duskmourn'], ['fdn', 'Foundations'],
];
