#!/usr/bin/env node
// Head-to-head tuning runs without the browser (ROADMAP item 113). Node 18+, no npm packages.
//
//   node tools/tune.mjs --a '{"lookahead":true}' --b '{}' --games 40
//   node tools/tune.mjs --decks cedh --style cedh --a '{"budget":{"steps":300,"perTurn":2},"lookahead":true}' --b '{"lookahead":true}'
//   node tools/tune.mjs --decks my1.txt,my2.txt --format standard --seats 2 --a '{"style":"aggressive"}' --b '{}'
//
// --a / --b are the two pilots: "style" picks the play style, every other key is set on the Agent (lookahead,
// noise, budget, or any field an experiment reads, such as a weight). Seats alternate between A and B game by game
// and each deck layout and seed is played twice with the sides swapped, so neither keeps the better seat or deck
// (use an even --games). Seeds are fixed (--seed, then +1 a pair), so
// a run can be repeated exactly. --control also plays B against B as a check that the setup itself is fair.
//
// Card data comes from Scryfall's /cards/collection once and is kept in data/tune-cache.json (data/ is private and
// never committed). Scryfall is free and needs no account; the tool waits 100 ms between requests as they ask.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const js = f => new URL(`file:///${path.join(root, 'public', 'js', f).replace(/\\/g, '/')}`).href;
const { Game } = await import(js('engine.js'));
const { Agent } = await import(js('ai.js'));
const { normalize } = await import(js('scryfall.js'));
const { parseText } = await import(js('decks.js'));
const { CEDH_PRESETS } = await import(js('presets.js'));
const { watchGame } = await import(js('invariants.js'));

const args = Object.fromEntries(process.argv.slice(2).reduce((out, a, i, all) => (a.startsWith('--') ? [...out, [a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]] : out), []));
const games = +(args.games || 40), seed0 = +(args.seed || 30000), format = args.format || 'commander';
const style = args.style || 'balanced';
const A = JSON.parse(args.a || '{}'), B = JSON.parse(args.b || '{}');

// ---- card data
const cacheFile = path.join(root, 'data', 'tune-cache.json');
const cache = fs.existsSync(cacheFile) ? JSON.parse(fs.readFileSync(cacheFile, 'utf8')) : {};
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function fetchNames(names) {
  const need = [...new Set(names.map(n => n.toLowerCase()))].filter(n => !cache[n]);
  for (let i = 0; i < need.length; i += 75) {
    const part = need.slice(i, i + 75);
    const r = await fetch('https://api.scryfall.com/cards/collection', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': 'CommanderTable-tune/1.0' },
      body: JSON.stringify({ identifiers: part.map(n => ({ name: n.split(' // ')[0] })) }),
    });
    if (!r.ok) throw new Error(`Scryfall ${r.status}`);
    const j = await r.json();
    for (const c of j.data || []) {
      cache[c.name.toLowerCase()] = c;
      for (const f of c.card_faces || []) cache[f.name.toLowerCase()] ||= c;
      cache[c.name.split(' // ')[0].toLowerCase()] ||= c;
    }
    for (const nf of j.not_found || []) console.warn(`not found: ${nf.name}`);
    await sleep(100);
  }
  fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
  fs.writeFileSync(cacheFile, JSON.stringify(cache));
}
async function deckFrom(text) {
  const parsed = parseText(text, { commander: format === 'commander' });
  await fetchNames(parsed.entries.map(e => e.name));
  const commanders = [], cards = [];
  for (const e of parsed.entries) {
    const raw = cache[(e.name || '').toLowerCase()] || cache[(e.name || '').split(' // ')[0].toLowerCase()];
    if (!raw || e.side || e.companion) continue;
    if (e.commander) commanders.push(normalize(raw)); else cards.push({ card: normalize(raw), qty: e.qty });
  }
  return { deckName: parsed.deckName || commanders.map(c => c.name).join(' & ') || 'deck', commanders, cards };
}
const sources = !args.decks || args.decks === 'cedh' ? CEDH_PRESETS.map(p => p.list) : String(args.decks).split(',').map(f => fs.readFileSync(f, 'utf8'));
const decks = [];
for (const s of sources) decks.push(await deckFrom(s));
const seats = +(args.seats || (format === 'commander' ? 4 : 2));

// ---- games
const agentFrom = opts => { const { style: st, ...rest } = opts; return Object.assign(new Agent(st || style, { lookahead: !!rest.lookahead }), rest); };
async function run(a, b, label) {
  const w = { A: 0, B: 0, draw: 0, problems: 0, errors: 0 };
  const t0 = Date.now();
  for (let i = 0; i < games; i++) {
    // Games come in pairs with the same decks in the same seats and the same seed: A takes the
    // first half of the seats in the first game of a pair and the second half in the second, so every deck and seat is played
    // by both sides equally, and each side has a copy of each deck at the table.
    const pair = Math.floor(i / 2);
    const isA = k => (k < seats / 2) === (i % 2 === 0);
    const g = new Game(Array.from({ length: seats }, (_, k) => {
      const d = decks[(pair + k) % decks.length];
      return { playerName: `P${k + 1}`, deckName: d.deckName, color: '#888', agent: agentFrom(isA(k) ? a : b), commanders: d.commanders, cards: d.cards };
    }), { beat: async () => {} }, { seed: seed0 + pair, noLearning: true, format });
    const found = watchGame(g);
    await g.run();
    w.problems += found.size;
    w.errors += g.logEntries.filter(e => /Simulator error/.test(e.html)).length;
    if (!g.winner) w.draw++; else w[isA(g.winner.idx) ? 'A' : 'B']++;
  }
  const n = w.A + w.B;
  console.log(`${label}: A ${w.A} – B ${w.B}${w.draw ? `, ${w.draw} draws` : ''} (A ${n ? Math.round(100 * w.A / n) : 0}%), ${games} games, ${((Date.now() - t0) / games / 1000).toFixed(2)} s a game, ${w.errors} simulator errors, ${w.problems} rule problems`);
  return w;
}
console.log(`${decks.length} decks (${decks.map(d => d.deckName).join('; ')}), ${seats} seats, format ${format}, seeds ${seed0}–${seed0 + games - 1}`);
console.log(`A = ${JSON.stringify(A)}  B = ${JSON.stringify(B)}`);
if (args.control) await run(B, B, 'control (B vs B)');
await run(A, B, 'A vs B');
