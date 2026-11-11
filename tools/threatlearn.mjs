// Learned threat (ROADMAP item 108) without the browser: learn a table from --learn games, then play pilots that use it
// against pilots that don't, with the table frozen into every game's setup. Card data comes from data/tune-cache.json
// (fill it with tools/tune.mjs first). Node 18+, no npm packages.
//   node tools/threatlearn.mjs style=cedh learn=200 games=80
//   node tools/threatlearn.mjs decks=a.txt,b.txt,c.txt,d.txt format=standard
import fs from 'fs';
const mem = new Map();
globalThis.localStorage = { getItem: k => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: k => mem.delete(k) };
import path from 'path';
import { fileURLToPath } from 'url';
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url))).replace(/\\/g, '/');
const js = f => `file:///${root}/public/js/${f}`;
const { Game } = await import(js('engine.js'));
const { Agent } = await import(js('ai.js'));
const { normalize } = await import(js('scryfall.js'));
const { parseText } = await import(js('decks.js'));
const { CEDH_PRESETS } = await import(js('presets.js'));
const { recordThreat, learnedThreat } = await import(js('threat.js'));
const { watchGame } = await import(js('invariants.js'));
const cache = JSON.parse(fs.readFileSync(`${root}/data/tune-cache.json`, 'utf8'));
const args = Object.fromEntries(process.argv.slice(2).map(a => a.split('=')));
const format = args.format || 'commander';
const deckFrom = text => {
  const parsed = parseText(text, { commander: format === 'commander' });
  const commanders = [], cards = [];
  for (const e of parsed.entries) {
    const raw = cache[(e.name || '').toLowerCase()] || cache[(e.name || '').split(' // ')[0].toLowerCase()];
    if (!raw || e.side || e.companion) continue;
    if (e.commander) commanders.push(normalize(raw)); else cards.push({ card: normalize(raw), qty: e.qty });
  }
  return { deckName: parsed.deckName || commanders.map(c => c.name).join(' & ') || 'deck', commanders, cards };
};
const decks = (args.decks ? args.decks.split(',').map(f => fs.readFileSync(f, 'utf8')) : CEDH_PRESETS.map(p => p.list)).map(deckFrom);
const style = args.style || 'balanced';
const learnN = +(args.learn || 120), testN = +(args.games || 80);
const mk = (i, seed, agentFor, learned) => new Game([0, 1, 2, 3].map(k => {
  const d = decks[(i + k) % decks.length];
  return { playerName: `P${k + 1}`, deckName: d.deckName, color: '#888', agent: agentFor(k), commanders: d.commanders, cards: d.cards };
}), { beat: async () => {} }, { seed, format, ...(learned ? { learned } : { noLearning: true }) });
let t0 = Date.now();
for (let i = 0; i < learnN; i++) {
  const g = mk(i, 70000 + i, () => new Agent(style), null);
  await g.run();
  recordThreat(g);
}
const T = learnedThreat();
console.log(`learned from ${learnN} games in ${((Date.now() - t0) / 1000).toFixed(0)} s:`, JSON.stringify(T));
const w = { A: 0, B: 0, d: 0, err: 0, prob: 0 };
for (let i = 0; i < testN; i++) {
  const pair = Math.floor(i / 2);
  const isA = k => (k < 2) === (i % 2 === 0);
  const g = mk(pair, 80000 + pair, k => Object.assign(new Agent(style), { noThreatTable: !isA(k) }), [0, 1, 2, 3].map(() => ({ '#threat': T })));
  const found = watchGame(g);
  await g.run();
  w.prob += found.size;
  w.err += g.logEntries.filter(e => /Simulator error/.test(e.html)).length;
  if (!g.winner) w.d++; else w[isA(g.winner.idx) ? 'A' : 'B']++;
}
console.log(`A (uses the table) ${w.A} – B ${w.B}, ${w.d} draws, ${w.err} errors, ${w.prob} rule problems`);
