#!/usr/bin/env node
// Story balance (item 164): plays each chapter of The Lantern Road with an AI pilot in your seat (the same rules as
// the game: a set board played as a whole Limited game) and reports how often it wins, so new chapters can be tuned
// to sit near the first four.
//   node tools/storybalance.mjs [--games 30] [--seed 1]
// Card data comes from Scryfall's /cards/collection once and is kept in data/tune-cache.json (shared with
// tools/tune.mjs; data/ is private and never committed).
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const js = f => new URL(`file:///${path.join(root, 'public', 'js', f).replace(/\\/g, '/')}`).href;
const { Game } = await import(js('engine.js'));
const { Agent } = await import(js('ai.js'));
const { normalize } = await import(js('scryfall.js'));
const { parseText } = await import(js('decks.js'));
const { CHAPTERS, chapterPuzzle } = await import(js('story.js'));
const { puzzleDeckText } = await import(js('puzzles.js'));

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? +argv[i + 1] : d; };
const GAMES = opt('games', 30), SEED = opt('seed', 1);
const cacheFile = path.join(root, 'data', 'tune-cache.json');
const cache = fs.existsSync(cacheFile) ? JSON.parse(fs.readFileSync(cacheFile, 'utf8')) : {};
async function fetchNames(names) {
  const need = [...new Set(names.map(n => n.toLowerCase()))].filter(n => !cache[n]);
  for (let i = 0; i < need.length; i += 75) {
    const r = await fetch('https://api.scryfall.com/cards/collection', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': 'CommanderTable-tune/1.0' },
      body: JSON.stringify({ identifiers: need.slice(i, i + 75).map(n => ({ name: n })) }),
    });
    if (!r.ok) throw new Error(`Scryfall ${r.status}`);
    const j = await r.json();
    for (const c of j.data || []) { cache[c.name.toLowerCase()] = c; cache[c.name.split(' // ')[0].toLowerCase()] ||= c; }
    for (const nf of j.not_found || []) console.warn(`not found: ${nf.name}`);
    await new Promise(res => setTimeout(res, 110));
  }
  fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
  fs.writeFileSync(cacheFile, JSON.stringify(cache));
}
const deckOf = async text => {
  const entries = parseText(text, { commander: false }).entries;
  await fetchNames(entries.map(e => e.name));
  return { deckName: 'x', commanders: [], cards: entries.map(e => ({ card: normalize(cache[e.name.toLowerCase()]), qty: e.qty })) };
};

for (const c of CHAPTERS) {
  const pz = chapterPuzzle(c);
  const decks = [];
  for (const spec of pz.players) decks.push(await deckOf(puzzleDeckText(spec)));
  let wins = 0, turns = 0, errors = 0;
  for (let s = 0; s < GAMES; s++) {
    const g = new Game(decks.map((d, i) => ({ playerName: pz.players[i].name, deckName: d.deckName, color: '#888', agent: new Agent('balanced'), commanders: [], cards: d.cards })),
      { beat: async () => {} }, { seed: SEED + s, noLearning: true, puzzle: pz, format: 'limited' });
    await g.run();
    if (g.winner === g.players[0]) wins++;
    turns += g.turn;
    errors += g.logEntries.filter(e => /Simulator error/.test(e.html)).length;
  }
  console.log(`${c.name.padEnd(28)} you win ${String(Math.round((wins / GAMES) * 100)).padStart(3)}% (${wins}/${GAMES}), ${(turns / GAMES).toFixed(1)} turns, ${errors} errors`);
}
