#!/usr/bin/env node
// Puzzle of the day (item 165): finds win-this-turn positions in AI games and checks each with the engine.
// For every game (the four built-in cEDH decks, fixed seeds) the board at the start of the winner's last main phase
// is saved as a puzzle, with the winner as seat 1. A position is kept only when an AI pilot, starting from that
// board, wins within the turn on three different shuffles of the libraries (so the solution doesn't hang on a lucky
// draw). The list goes to public/data/daily-puzzles.json; the game picks one by the date.
//   node tools/dailypuzzles.mjs [--games 60] [--seed 70000]
import { readFileSync, writeFileSync } from 'node:fs';
import { Game } from '../public/js/engine.js';
import { Agent } from '../public/js/ai.js';
import { normalize } from '../public/js/scryfall.js';
import { parseText } from '../public/js/decks.js';
import { CEDH_PRESETS } from '../public/js/presets.js';
import { boardToPuzzle, puzzleDeckText } from '../public/js/puzzles.js';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? +argv[i + 1] : d; };
const GAMES = opt('games', 60), SEED = opt('seed', 70000);
const cards = JSON.parse(readFileSync(new URL('../tests/golden-cards.json', import.meta.url), 'utf8'));
const find = n => { const k = n.toLowerCase(); return cards[k] || Object.values(cards).find(c => c.name.toLowerCase().split(' // ')[0] === k.split(' // ')[0]); };
const deckOf = text => {
  const commanders = [], main = [];
  for (const e of parseText(text).entries) {
    const raw = find(e.name);
    if (!raw) continue;
    if (e.commander) commanders.push(normalize(raw)); else main.push({ card: normalize(raw), qty: e.qty });
  }
  return { deckName: commanders.map(c => c.name).join(' & '), commanders, cards: main };
};
const decks = CEDH_PRESETS.map(p => deckOf(p.list));
const styles = ['cedh', 'combo', 'balanced', 'aggressive', 'defensive'];

// The AI plays seat 1 of a puzzle from its first main phase; did it win that turn?
async function solves(pz, seed) {
  const pdecks = pz.players.map(spec => deckOf(puzzleDeckText(spec)));
  const g = new Game(pdecks.map((d, i) => ({ playerName: pz.players[i].name, deckName: d.deckName, color: '#888', agent: new Agent(i === 0 ? pz.style : 'balanced'), commanders: d.commanders, cards: d.cards })),
    { beat: async () => {} }, { seed, noLearning: true, puzzle: pz });
  await g.run();
  return g.winner === g.players[0] && !g.puzzleFailed;
}

const found = [];
for (let i = 0; i < GAMES; i++) {
  const seed = SEED + i;
  const seats = [0, 1, 2, 3].map(k => ({ d: decks[(i + k) % 4], style: styles[(i + k) % 5] }));
  const snaps = new Map();
  const g = new Game(seats.map((s, k) => ({ playerName: `P${k + 1}`, deckName: s.d.deckName, color: '#888', agent: new Agent(s.style), commanders: s.d.commanders, cards: s.d.cards })), {
    beat: async () => {
      // (the board as each player's first main phase starts: nothing played yet this phase)
      if (g.phase === 'main1' && !g.stack.length && !snaps.has(g.turn)) snaps.set(g.turn, { active: g.active, lost: g.players.map(p => !!p.lost), pz: boardToPuzzle(g, '') });
    },
  }, { seed, noLearning: true });
  await g.run();
  const w = g.winner;
  const snap = w && snaps.get(g.turn);
  if (!snap || snap.active !== w.idx || g.round < 3) continue;
  // Seat 1 is the winner; the others follow in turn order
  const order = [w.idx, ...[1, 2, 3].map(k => (w.idx + k) % 4)];
  // (players already out of the game are left out of the puzzle)
  const pz = { ...snap.pz, style: seats[w.idx].style };
  pz.players = order.filter(k => !snap.lost[k])
    .map((k, n) => ({ ...snap.pz.players[k], name: k === w.idx ? 'You' : `Opponent ${n}` }));
  if (pz.players.length < 2) continue;
  pz.name = `${seats[w.idx].d.commanders[0]?.name.split(',')[0] || 'Puzzle'}: win on turn ${g.round}`;
  const ok = (await solves(pz, 1)) && (await solves(pz, 2)) && (await solves(pz, 3));
  if (ok) {
    // (the hint says what kind of win it was, not how)
    const combo = g.logEntries.some(e => e.p === w.idx && /goes for a combo/.test(e.html) && g.logEntries.indexOf(e) > g.logEntries.findLastIndex(x => x.kind === 'turn'));
    found.push({ ...pz, hint: combo ? 'There is a combo in your cards: find the pieces and the mana for them.' : 'No combo needed: count the damage you can deal this turn.', from: `seed ${seed}` });
    console.log(`kept: ${pz.name} (seed ${seed}, ${combo ? 'combo' : 'damage'})`);
  }
}
writeFileSync(new URL('../public/data/daily-puzzles.json', import.meta.url), JSON.stringify({ made: new Date().toISOString().slice(0, 10), puzzles: found.map(({ style, ...p }) => ({ ...p, app: 'commander-table-puzzle', aiStyle: style })) }) + '\n');
console.log(`${found.length} puzzles from ${GAMES} games saved to public/data/daily-puzzles.json`);
