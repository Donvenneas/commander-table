#!/usr/bin/env node
// Kingdoms balance (item 115): AI games at 5 to 9 seats with the built-in cEDH decks, counting which role type wins.
//   node tools/kingdoms-balance.mjs [--games 60] [--seed 920000] [--rules 4]   (rules 4: the AI before item 115)
import { readFileSync } from 'node:fs';
import { Game } from '../public/js/engine.js';
import { Agent } from '../public/js/ai.js';
import { normalize } from '../public/js/scryfall.js';
import { parseText } from '../public/js/decks.js';
import { CEDH_PRESETS } from '../public/js/presets.js';
import { dealRoles } from '../public/js/kingdoms.js';
import { makeRng } from '../public/js/util.js';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? +argv[i + 1] : d; };
const GAMES = opt('games', 60), SEED = opt('seed', 920000), RULES_V = opt('rules', undefined);
const cards = JSON.parse(readFileSync(new URL('../tests/golden-cards.json', import.meta.url), 'utf8'));
const find = n => { const k = n.toLowerCase(); return cards[k] || Object.values(cards).find(c => c.name.toLowerCase().split(' // ')[0] === k.split(' // ')[0]); };
const decks = CEDH_PRESETS.map(p => { const commanders = [], main = []; for (const e of parseText(p.list).entries) { const raw = find(e.name); if (e.commander) commanders.push(normalize(raw)); else main.push({ card: normalize(raw), qty: e.qty }); } return { deckName: 'x', commanders, cards: main }; });
const styles = ['cedh', 'combo', 'balanced', 'aggressive', 'defensive'];
const wins = {}, bySize = {};
let ended = 0, errs = 0, rounds = 0;
for (let i = 0; i < GAMES; i++) {
  const n = 5 + (i % 5), seed = SEED + i;
  const g = new Game(Array.from({ length: n }, (_, k) => { const d = decks[(i + k) % 4]; return { playerName: `P${k + 1}`, deckName: 'x', color: '#888', agent: new Agent(styles[(i + k) % 5]), commanders: d.commanders, cards: d.cards }; }),
    { beat: async () => {} }, { seed, noLearning: true, format: 'kingdoms', roles: dealRoles(n, makeRng(seed)), ...(RULES_V ? { rules: RULES_V } : {}) });
  await g.run();
  errs += g.logEntries.filter(e => /Simulator error/.test(e.html)).length;
  rounds += g.round;
  if (g.winners?.length) { ended++; const t = g.winners[0].role.type; wins[t] = (wins[t] || 0) + 1; (bySize[n] ||= {})[t] = (bySize[n][t] || 0) + 1; }
}
console.log(`${GAMES} games: ${ended} ended on a role win, ${errs} errors, ${(rounds / GAMES).toFixed(1)} rounds on average`);
console.log('wins by role type:', Object.entries(wins).map(([t, k]) => `${t} ${k} (${Math.round((k / ended) * 100)}%)`).join(', '));
for (const [n, w] of Object.entries(bySize)) console.log(`  ${n} players:`, Object.entries(w).map(([t, k]) => `${t} ${k}`).join(', '));
