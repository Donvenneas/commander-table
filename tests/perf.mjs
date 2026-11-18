// Performance measurements (Phase 2O). Not a pass/fail test: it prints numbers for the report, with the conditions.
//   node --expose-gc tests/perf.mjs
// 1. A large board: 2 players with 100 creatures each (plus anthems): one state-based-actions pass, every creature's
//    power, toughness and keywords, the AI's attack and block decisions.
// 2. AI decision time: 8 four-player games with the built-in cEDH decks (look-ahead on two seats), every AI decision
//    timed: median, 95th percentile and slowest, by kind.
// 3. Long sessions: 50 games in a row, heap after each 10 (after a garbage collection when --expose-gc is given).
import { readFileSync } from 'node:fs';
import os from 'node:os';
import { scenario, find, P, settle } from './scenario.mjs';
import { Game, RULES } from '../public/js/engine.js';
import { Agent } from '../public/js/ai.js';
import { normalize } from '../public/js/scryfall.js';
import { parseText } from '../public/js/decks.js';
import { CEDH_PRESETS } from '../public/js/presets.js';

const ms = (f, n = 1) => { const t = performance.now(); for (let i = 0; i < n; i++) f(); return (performance.now() - t) / n; };
const pct = (a, q) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : 0; };
const f1 = x => x.toFixed(1);
console.log(`Conditions: Node ${process.version}, ${os.cpus()[0]?.model?.trim()} (${os.cpus().length} threads), ${(os.totalmem() / 2 ** 30).toFixed(0)} GB, rules ${RULES}`);

// ---------- 1. large board
{
  const names = ['Grizzly Bears', 'Hill Giant', 'Serra Angel', 'Llanowar Elves', 'Vampire Nighthawk'];
  const side = () => ({ battlefield: [...Array.from({ length: 100 }, (_, i) => names[i % names.length]), 'Glorious Anthem'], filler: 10 });
  const t0 = performance.now();
  const g = await scenario([side(), side()]);
  const setup = performance.now() - t0;
  const creatures = g.players.flatMap(p => p.battlefield.filter(o => o.fx.type.creature));
  const sba = await (async () => { const t = performance.now(); for (let i = 0; i < 20; i++) await g.sba(); return (performance.now() - t) / 20; })();
  const pt = ms(() => { for (const o of creatures) { g.power(o); g.toughness(o); g.has(o, 'flying'); g.has(o, 'deathtouch'); } }, 20);
  const att = ms(() => P(g, 0).agent.declareAttackers(g, P(g, 0)), 3);
  const attackers = P(g, 0).battlefield.filter(o => o.fx.type.creature).slice(0, 40);
  for (const o of attackers) o.attacking = 1;
  const blk = ms(() => P(g, 1).agent.declareBlockers(g, P(g, 1), attackers), 3);
  console.log(`\n1. Large board (${creatures.length} creatures, 2 anthems): setup ${f1(setup)} ms · one state-based-actions pass ${f1(sba)} ms · power/toughness/2 keywords for all ${f1(pt)} ms · AI attack decision ${f1(att)} ms · AI blocks against 40 attackers ${f1(blk)} ms`);
}

// ---------- 2 and 3: games with the built-in decks
const RAW = JSON.parse(readFileSync(new URL('./golden-cards.json', import.meta.url), 'utf8'));
const findRaw = n => { const k = n.toLowerCase(); return RAW[k] || Object.values(RAW).find(c => c.name.toLowerCase().split(' // ')[0] === k.split(' // ')[0]); };
const decks = CEDH_PRESETS.map(p => { const commanders = [], cards = []; for (const e of parseText(p.list).entries) { const raw = findRaw(e.name); if (!raw) continue; if (e.commander) commanders.push(normalize(raw)); else cards.push({ card: normalize(raw), qty: e.qty }); } return { deckName: commanders.map(c => c.name).join(' & '), commanders, cards }; });
const styles = ['cedh', 'combo', 'balanced', 'aggressive', 'defensive'];
const KINDS = ['mainPhase', 'respond', 'respondAt', 'declareAttackers', 'declareBlockers', 'chooseTargets', 'mulligan'];
function newGame(i, timing) {
  const seats = [0, 1, 2, 3].map(k => {
    const d = decks[(i + k) % 4];
    const agent = new Agent(styles[(i + k) % 5], { lookahead: k % 2 === 0 });
    if (timing) for (const m of KINDS) if (typeof agent[m] === 'function') {
      const orig = agent[m].bind(agent);
      agent[m] = (...a) => { const t = performance.now(); const r = orig(...a); const done = () => (timing[m] ||= []).push(performance.now() - t); if (r && typeof r.then === 'function') return r.then(v => { done(); return v; }); done(); return r; };
    }
    return { playerName: `P${k + 1}`, deckName: d.deckName, color: '#888', agent, commanders: d.commanders, cards: d.cards };
  });
  return new Game(seats, { beat: async () => {} }, { seed: 90000 + i, noLearning: true });
}
{
  /** @type {Record<string, number[]>} */
  const timing = {};
  const t0 = performance.now();
  let steps = 0;
  for (let i = 0; i < 8; i++) { const g = newGame(i, timing); await g.run(); steps += g.steps; }
  const wall = performance.now() - t0;
  console.log(`\n2. AI decisions over 8 games (${steps} steps, ${f1(wall / 1000)} s, look-ahead on seats 1 and 3). mainPhase is a whole main phase (every play in it, with look-ahead), not one choice:`);
  for (const [k, a] of Object.entries(timing)) console.log(`   ${k.padEnd(17)} ${String(a.length).padStart(5)} calls · median ${f1(pct(a, 0.5))} ms · 95% ${f1(pct(a, 0.95))} ms · slowest ${f1(Math.max(...a))} ms`);
}
{
  const gc = globalThis.gc;
  gc?.();
  const heap = () => process.memoryUsage().heapUsed / 2 ** 20;
  const marks = [f1(heap())];
  const t0 = performance.now();
  for (let i = 0; i < 50; i++) { const g = newGame(i + 100, null); await g.run(); if (i % 10 === 9) { gc?.(); marks.push(f1(heap())); } }
  console.log(`\n3. 50 games in a row: ${f1((performance.now() - t0) / 1000)} s; heap in MB at the start and after each 10 games${gc ? ' (after a collection)' : ' (no --expose-gc: without a forced collection)'}: ${marks.join(' → ')}`);
}
