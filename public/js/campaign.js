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
  normal: { name: 'Normal', you: 0, them: 0, bracket: 3, forgive: false, about: 'Even fights; a loss ends the expedition' },
  hard: { name: 'Hard', you: 0, them: 4, bracket: 4, forgive: false, about: 'Rivals start with 4 extra life and play at full strength; a loss ends the expedition' },
};
export const NODE = {
  duel: { icon: '⚔', name: 'Duel', text: 'A rival with a deck from three packs' },
  elite: { icon: '☠', name: 'Elite rival', text: 'A stronger deck from six packs, with a rare card as the reward' },
  event: { icon: '✦', name: 'Event', text: 'Something happens on the road' },
  rest: { icon: '☕', name: 'Rest stop', text: 'Thin your deck, or rest for extra life in the next fight' },
  boss: { icon: '♛', name: 'Boss', text: 'The end of the act: a strong deck from eight packs, with extra life' },
};
const ACT_NAMES = ['The Low Road', 'The Broken Hills', 'The Summit'];
const BOSSES = ['the Gatewarden', 'the Hill Tyrant', 'the Summit Sovereign'];

export const runState = () => store(KEY);
const save = r => store(KEY, r);
export const stats = () => store(STATS) || { runs: 0, won: 0, best: 0 };

// The map: three acts of four steps (two roads each) and a boss
function makeMap(rand) {
  const kinds = ['duel', 'duel', 'elite', 'event', 'rest'];
  return [0, 1, 2].map(a => [
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
export async function startRun({ set, setName, difficulty = 'normal', onStatus }) {
  const seed = Math.floor(Math.random() * 2 ** 32);
  const rand = makeRng(seed);
  const pool = await setPool(set, onStatus);
  const packs = Array.from({ length: 4 }, () => makePack(pool, rand)).flat().filter(c => c.rarity === 'common' || c.rarity === 'uncommon');
  const built = buildLimited(packs);
  const deck = built.cards.filter(c => !c.fx.type.land).slice(0, 16).map(c => c.name);
  const r = { v: 1, seed, set, setName, difficulty, colors: built.colors, act: 0, step: 0, map: makeMap(rand), deck, lifeNext: 0, forgiven: [false, false, false], fights: 0, wins: 0, log: [`Set out with ${deck.length} cards in ${built.colors.join('')}.`], over: false, result: null, pending: null };
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
  return [D.you + (r.lifeNext || 0), D.them + (kind === 'boss' ? 4 + r.act * 3 : kind === 'elite' ? 2 : 0)];
}

export const currentChoices = r => (r && !r.over ? r.map[r.act][r.step] : []);
function advance(r) {
  r.step++;
  if (r.step >= r.map[r.act].length) { r.act++; r.step = 0; }
  if (r.act >= 3) { r.over = true; r.result = 'won'; const s = stats(); s.won++; s.best = 3; store(STATS, s); r.log.push('The expedition reached the summit!'); }
}

// Three cards to choose from after a win (rares for elites and bosses)
export async function rewardChoices(r, kind) {
  const cards = await cardsOf(r);
  const rand = makeRng(r.seed + r.fights * 13 + 5);
  const fits = c => !c.fx.type.land && (c.colorIdentity || []).every(x => r.colors.includes(x));
  const wantRare = kind !== 'duel';
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
    if (kind === 'boss' && act === 2) { advance(r); r.pending = null; }
    else advance(r);
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
