// Expedition: an original solo roguelike campaign. Three acts of a map: at each step you choose one of
// two roads (a duel, an elite rival, an event or a rest stop), and every act ends with a boss. Every
// fight is a real one-on-one game (Limited rules: 20 life, 40+ cards). Win and you take one of three
// cards from the set for your deck; lose and the expedition ends (on Easy, one loss per act is
// forgiven). There's no shop and nothing to buy: rewards are cards for this run only.
import { store, makeRng } from './util.js';
import { setPool, makePack, buildLimited, deckObject, pickScore } from './limited.js';

const KEY = 'ct.expedition';
const STATS = 'ct.expeditionStats';
export const DIFFICULTY = {
  easy: { name: 'Easy', you: 5, them: 0, bracket: 1, forgive: true, about: 'You start fights with 5 extra life, rivals play loosely, and one lost fight per act is forgiven' },
  normal: { name: 'Normal', you: 0, them: 0, bracket: 3, forgive: false, forgiveRun: 1, about: 'Even fights; one lost fight is forgiven over the whole expedition, the next ends it' },
  hard: { name: 'Hard', you: 0, them: 4, bracket: 4, forgive: false, about: 'Rivals start with 4 extra life and play at full strength; a loss ends the expedition' },
};
export const NODE = {
  duel: { icon: '⚔', name: 'Duel', text: 'A rival with a deck from three packs' },
  elite: { icon: '☠', name: 'Elite rival', text: 'A stronger deck from six packs, with a rare card as the reward' },
  event: { icon: '✦', name: 'Event', text: 'Something happens on the road' },
  rest: { icon: '☕', name: 'Rest stop', text: 'Thin your deck, or rest for extra life in the next fight' },
  boss: { icon: '♛', name: 'Boss', text: 'The end of the act: a strong deck from eight packs, with extra life' },
};
const ACT_NAMES = ['The Low Road', 'The Broken Hills', 'The Summit', 'The Starlit Peak'];
const BOSSES = ['the Gatewarden', 'the Hill Tyrant', 'the Summit Sovereign', 'the Star Herald'];
// Run modifiers (item 163), our own: chosen when setting out, kept with the run
export const MODIFIERS = {
  none: { name: 'No modifier', about: 'The usual road' },
  glass: { name: 'Glass cannon', about: 'You start every fight with 5 less life, but every reward is a rare or mythic' },
  laden: { name: 'Laden pack', about: 'You start with 27 cards instead of 23, but every rival has 2 extra life' },
  forced: { name: 'Forced march', about: 'No rest stops (they become duels), but bosses have no extra life' },
};
// (runs from before item 163 have three acts; new ones have four)
const actsOf = r => r.acts || 3;

export const runState = () => store(KEY);
const save = r => store(KEY, r);
export const stats = () => store(STATS) || { runs: 0, won: 0, best: 0 };

// The map: three acts of four steps (two roads each) and a boss
function makeMap(rand, acts = 3, modifier = 'none') {
  const kinds = modifier === 'forced' ? ['duel', 'duel', 'elite', 'event', 'duel'] : ['duel', 'duel', 'elite', 'event', 'rest'];
  return Array.from({ length: acts }, (_, a) => a).map(a => [
    ...Array.from({ length: 4 }, (_, s) => {
      const pick = () => kinds[Math.floor(rand() * kinds.length)];
      let x = s === 0 ? 'duel' : pick(), y = pick();
      for (let k = 0; k < 5 && y === x; k++) y = pick();
      return [x, y];
    }),
    ['boss'],
  ]);
}

// A new expedition: a starting deck of 16 of the set's commons and uncommons in two colors
// seed: a run code's seed, to walk the same road again (the same map, starting deck, rivals and rewards)
export async function startRun({ set, setName, difficulty = 'normal', modifier = 'none', seed = null, onStatus }) {
  seed = seed ?? Math.floor(Math.random() * 2 ** 32);
  if (!MODIFIERS[modifier]) modifier = 'none';
  const rand = makeRng(seed);
  const pool = await setPool(set, onStatus);
  const packs = Array.from({ length: 5 }, () => makePack(pool, rand)).flat().filter(c => c.rarity === 'common' || c.rarity === 'uncommon');
  const built = buildLimited(packs);
  // (23 spells and 17 lands, a normal Limited deck: with 16 spells and 24 lands the first rivals won almost every fight)
  const deck = built.cards.filter(c => !c.fx.type.land).slice(0, modifier === 'laden' ? 27 : 23).map(c => c.name);
  const acts = 4;
  const r = { v: 2, seed, set, setName, difficulty, modifier, acts, colors: built.colors, act: 0, step: 0, map: makeMap(rand, acts, modifier), deck, lifeNext: 0, forgiven: Array(acts).fill(false), fights: 0, wins: 0, log: [`Set out with ${deck.length} cards in ${built.colors.join('')}.`], over: false, result: null, pending: null };
  save(r);
  const s = stats(); s.runs++; store(STATS, s);
  return r;
}
export function abandonRun() { const r = runState(); if (r && !r.over) { r.over = true; r.result = 'abandoned'; save(r); } store(KEY, null); }

// The set's cards, loaded once per session
let poolCache = { set: null, cards: [] };
async function cardsOf(r, onStatus) {
  if (poolCache.set !== r.set) poolCache = { set: r.set, cards: await setPool(r.set, onStatus) };
  return poolCache.cards;
}
const byName = (cards, names) => names.map(n => cards.find(c => c.name === n)).filter(Boolean);

// Your deck for a fight: your cards, basics to at least 40 (about 17 lands)
export async function yourDeck(r, onStatus) {
  const cards = byName(await cardsOf(r, onStatus), r.deck);
  return deckObject(cards, r.colors, `Your expedition deck (${r.colors.join('')})`, cards, Math.max(40, cards.length + 17));
}
// A rival's deck for a node: more packs (and rares) the harder the node and the later the act
export async function rivalDeck(r, kind, onStatus) {
  const cards = await cardsOf(r, onStatus);
  const rand = makeRng(r.seed + r.act * 101 + r.step * 7 + 1);
  const packs = { duel: 3, elite: 6, boss: 8 }[kind] + r.act;
  const pool = Array.from({ length: packs }, () => makePack(cards, rand)).flat();
  const d = buildLimited(pool);
  const name = kind === 'boss' ? BOSSES[r.act] : `${kind === 'elite' ? 'Elite ' : ''}rival of ${ACT_NAMES[r.act]}`;
  const deck = await deckObject(d.cards, d.colors, `${name} (${d.colors.join('')})`, d.cards);
  return { deck, name: name[0].toUpperCase() + name.slice(1) };
}
// Extra starting life for a fight: [you, them]
export function fightLife(r, kind) {
  const D = DIFFICULTY[r.difficulty];
  const m = r.modifier || 'none';
  const boss = m === 'forced' ? 0 : 4 + r.act * 3;
  return [D.you + (r.lifeNext || 0) - (m === 'glass' ? 5 : 0), D.them + (kind === 'boss' ? boss : kind === 'elite' ? 2 : 0) + (m === 'laden' ? 2 : 0)];
}
// A run code (item 163): set, difficulty, modifier and seed, to share a run or walk it again, like "FDN-N-G-1A2B3C"
const DIFF_CODE = { easy: 'E', normal: 'N', hard: 'H' }, MOD_CODE = { none: 'X', glass: 'G', laden: 'L', forced: 'F' };
export const runCode = r => `${r.set.toUpperCase()}-${DIFF_CODE[r.difficulty] || 'N'}-${MOD_CODE[r.modifier || 'none']}-${(r.seed >>> 0).toString(36).toUpperCase()}`;
export function parseRunCode(code) {
  const m = String(code).trim().toUpperCase().match(/^([A-Z0-9]{2,6})-([ENH])-([XGLF])-([0-9A-Z]{1,7})$/);
  if (!m) return null;
  const seed = parseInt(m[4], 36);
  if (!Number.isFinite(seed) || seed >= 2 ** 32) return null;
  return { set: m[1].toLowerCase(), difficulty: Object.keys(DIFF_CODE).find(k => DIFF_CODE[k] === m[2]), modifier: Object.keys(MOD_CODE).find(k => MOD_CODE[k] === m[3]), seed };
}

export const currentChoices = r => (r && !r.over ? r.map[r.act][r.step] : []);
function advance(r) {
  r.step++;
  if (r.step >= r.map[r.act].length) { r.act++; r.step = 0; }
  if (r.act >= actsOf(r)) { r.over = true; r.result = 'won'; const s = stats(); s.won++; s.best = actsOf(r); store(STATS, s); r.log.push(actsOf(r) > 3 ? 'The expedition reached the Starlit Peak!' : 'The expedition reached the summit!'); }
}

// Three cards to choose from after a win (rares for elites and bosses)
export async function rewardChoices(r, kind) {
  const cards = await cardsOf(r);
  const rand = makeRng(r.seed + r.fights * 13 + 5);
  const fits = c => !c.fx.type.land && (c.colorIdentity || []).every(x => r.colors.includes(x));
  const wantRare = kind !== 'duel' || r.modifier === 'glass';
  const pool = cards.filter(c => fits(c) && (wantRare ? ['rare', 'mythic'].includes(c.rarity) : true));
  const list = (pool.length >= 3 ? pool : cards.filter(fits));
  const out = [];
  for (let k = 0; k < 60 && out.length < 3 && list.length; k++) {
    const c = list[Math.floor(rand() * list.length)];
    if (!out.includes(c)) out.push(c);
  }
  return out.sort((a, b) => pickScore(b, []) - pickScore(a, []));
}

// A finished fight: won or lost
export function fightOver(r, kind, won) {
  r.fights++;
  r.lifeNext = 0;
  const act = r.act;
  if (won) {
    r.wins++;
    r.log.push(`Won the ${NODE[kind].name.toLowerCase()} in act ${act + 1}.`);
    r.pending = { reward: kind };
    if (kind === 'boss' && act === actsOf(r) - 1) { advance(r); r.pending = null; }
    else advance(r);
  } else if (r.v >= 2 && !DIFFICULTY[r.difficulty].forgive && (r.forgivenRun || 0) < (DIFFICULTY[r.difficulty].forgiveRun || 0)) {
    // (item 163: a four-act Normal run forgives one lost fight in all)
    r.forgivenRun = (r.forgivenRun || 0) + 1;
    r.log.push(`Lost the ${NODE[kind].name.toLowerCase()} in act ${act + 1}: Normal forgives one loss an expedition.`);
    advance(r);
  } else if (DIFFICULTY[r.difficulty].forgive && !r.forgiven[act]) {
    r.forgiven[act] = true;
    r.log.push(`Lost the ${NODE[kind].name.toLowerCase()} in act ${act + 1}, but Easy forgives one loss an act.`);
    advance(r);
  } else {
    r.over = true; r.result = 'lost';
    r.log.push(`Fell to the ${NODE[kind].name.toLowerCase()} in act ${act + 1}, step ${r.step + 1}.`);
    const s = stats(); s.best = Math.max(s.best, act); store(STATS, s);
  }
  save(r);
  return r;
}
export function takeReward(r, name) {
  if (name) { r.deck.push(name); r.log.push(`Added ${name} to the deck.`); }
  r.pending = null;
  save(r);
}

// Events and rest stops (no fight): what you may choose
export function eventFor(r) {
  const rand = makeRng(r.seed + r.act * 31 + r.step * 17 + 3);
  const all = [
    { id: 'smith', text: 'A wandering smith offers you one of her finest pieces.', choice: 'rare' },
    { id: 'shrine', text: 'A quiet shrine by the road. Leave behind up to two cards that weigh you down.', choice: 'remove2' },
    { id: 'healer', text: 'A traveling healer tends your wounds: +4 life at the start of your next fight.', choice: 'life4' },
    { id: 'gamble', text: 'A stranger offers a trade: one of your cards for one of three from his satchel.', choice: 'swap' },
    // (item 163)
    { id: 'pilgrims', text: 'Pilgrims on the same road share their bread and their songs: +6 life at the start of your next fight.', choice: 'life6' },
    { id: 'archive', text: 'A ruined archive. Among the scrolls, one card of real power still glows.', choice: 'rare' },
    { id: 'ferry', text: 'The ferryman takes no coin, only a card. In return he offers one of three he has collected.', choice: 'swap' },
    { id: 'storm', text: 'A storm forces you to lighten your pack. Leave behind up to two cards.', choice: 'remove2' },
  ];
  return all[Math.floor(rand() * all.length)];
}
export function resolveEvent(r, what, value) {
  if (what === 'life') { r.lifeNext = value; r.log.push(`Rested: +${value} life next fight.`); }
  if (what === 'remove') { for (const n of value) { const i = r.deck.indexOf(n); if (i >= 0) r.deck.splice(i, 1); } if (value.length) r.log.push(`Left behind ${value.join(', ')}.`); }
  if (what === 'add') { r.deck.push(value); r.log.push(`Gained ${value}.`); }
  advance(r);
  save(r);
}
export const actName = i => ACT_NAMES[i] || '';
