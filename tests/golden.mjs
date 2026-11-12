// Golden games (item 173): AI games over the four built-in cEDH decks with fixed seeds, played under each rules
// version a replay can carry (rules 4 before round 5, rules 5 for 1.18–1.19, rules 6 for 1.20, rules 7 for 1.21, rules 8 for 1.22, rules 9 now). Each game's result and a hash
// of its whole log are kept in tests/golden-games.json. A change that alters how any of them plays fails here, so
// changes to old replays are caught and a new rules version is made on purpose.
//   node tests/golden.mjs            compare (exit 1 on any difference)
//   node tests/golden.mjs --update   accept the current results (after a deliberate change)
//   node tests/golden.mjs --fetch    download the decks' card data into tests/golden-cards.json
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Game, RULES } from '../public/js/engine.js';
import { Agent } from '../public/js/ai.js';
import { normalize } from '../public/js/scryfall.js';
import { parseText } from '../public/js/decks.js';
import { CEDH_PRESETS } from '../public/js/presets.js';

const CARDS = new URL('./golden-cards.json', import.meta.url), GOLD = new URL('./golden-games.json', import.meta.url);
const args = new Set(process.argv.slice(2));
const lists = CEDH_PRESETS.map(p => parseText(p.list));

if (args.has('--fetch')) {
  const names = [...new Set(lists.flatMap(l => l.entries.map(e => e.name.split(' // ')[0])))];
  const out = {};
  for (let i = 0; i < names.length; i += 75) {
    const r = await fetch('https://api.scryfall.com/cards/collection', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': 'CommanderTable-tests/1.0' },
      body: JSON.stringify({ identifiers: names.slice(i, i + 75).map(name => ({ name })) }),
    });
    if (!r.ok) throw new Error(`Scryfall answered ${r.status}`);
    const j = await r.json();
    for (const c of j.data || []) {
      const { prices, purchase_uris, related_uris, image_uris, card_faces, ...rest } = c;
      out[c.name.toLowerCase()] = { ...rest, image_uris: {}, ...(card_faces ? { card_faces: card_faces.map(({ image_uris: _, ...f }) => f) } : {}) };
    }
    for (const nf of j.not_found || []) console.warn(`not found: ${nf.name}`);
    await new Promise(res => setTimeout(res, 120));
  }
  writeFileSync(CARDS, JSON.stringify(out) + '\n');
  console.log(`Card data for ${Object.keys(out).length} cards saved. Run node tests/golden.mjs --update to record the games.`);
  process.exit(0);
}

const cards = JSON.parse(readFileSync(CARDS, 'utf8'));
const find = n => { const k = n.toLowerCase(); return cards[k] || Object.values(cards).find(c => c.name.toLowerCase().split(' // ')[0] === k.split(' // ')[0]); };
const decks = lists.map(l => {
  const commanders = [], main = [];
  for (const e of l.entries) {
    const raw = find(e.name);
    if (!raw) throw new Error(`No card data for ${e.name}: run node tests/golden.mjs --fetch`);
    if (e.commander) commanders.push(normalize(raw)); else main.push({ card: normalize(raw), qty: e.qty });
  }
  return { deckName: commanders.map(c => c.name).join(' & '), commanders, cards: main };
});

const styles = ['cedh', 'combo', 'balanced', 'aggressive', 'defensive'];
const results = {};
for (const rules of [4, 5, 6, 7, 8, RULES]) {
  for (let i = 0; i < 6; i++) {
    const seed = 50000 + i;
    const g = new Game([0, 1, 2, 3].map(k => {
      const d = decks[(i + k) % 4];
      return { playerName: `P${k + 1}`, deckName: d.deckName, color: '#888', agent: new Agent(styles[(i + k) % 5], { lookahead: rules >= 5 && i % 2 === 0 && k % 2 === 0 }), commanders: d.commanders, cards: d.cards };
    }), { beat: async () => {} }, { seed, noLearning: true, rules });
    await g.run();
    const log = g.logEntries.map(e => e.html).join('\n');
    results[`rules ${rules} · seed ${seed}`] = {
      winner: g.winner?.name ?? null, round: g.round, steps: g.steps, lines: g.logEntries.length,
      errors: g.logEntries.filter(e => /Simulator error/.test(e.html)).length,
      log: createHash('sha1').update(log).digest('hex').slice(0, 16),
    };
  }
}

if (args.has('--update') || !existsSync(GOLD)) {
  writeFileSync(GOLD, JSON.stringify(results, null, 1) + '\n');
  console.log(`Golden games recorded: ${Object.keys(results).length}.`);
  process.exit(0);
}
const gold = JSON.parse(readFileSync(GOLD, 'utf8'));
const diff = Object.keys(results).filter(k => JSON.stringify(results[k]) !== JSON.stringify(gold[k]));
const errors = Object.values(results).reduce((a, r) => a + r.errors, 0);
console.log(`Golden games: ${Object.keys(results).length} played, ${diff.length} differ, ${errors} simulator errors.`);
for (const k of diff) console.log(`  ${k}: was ${JSON.stringify(gold[k])}\n  ${' '.repeat(k.length)}  now ${JSON.stringify(results[k])}`);
if (diff.length) console.log(`\nA rules 4 difference changes replays saved before round 5: undo it, or gate the new behaviour behind a rules version.\nIf the change is intended, run: node tests/golden.mjs --update`);
if (diff.length || errors) process.exit(1);
