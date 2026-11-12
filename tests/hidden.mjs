// Hidden information (ROADMAP item 100): an AI decision must not read cards its pilot can't see. At each decision of
// every AI seat (main-phase plays, attacks, blocks, responses to spells), the decision is asked twice more on the same
// position: once as it is, once with every opponent's hand and library scrambled (the same number of cards in each,
// their library shuffled, hand cards swapped with library cards). Both extra asks use the same fixed random stream,
// the agent's own notes are put back after each, and the position is restored exactly, so the games play as they
// would without the check. A decision that changes when only hidden cards changed is reported (and fails the run).
//   node tests/hidden.mjs              8 games with the built-in cEDH decks (CI)
//   node tests/hidden.mjs --games 20 --seed 81000
import { readFileSync } from 'node:fs';
import { Game } from '../public/js/engine.js';
import { Agent } from '../public/js/ai.js';
import { normalize } from '../public/js/scryfall.js';
import { parseText } from '../public/js/decks.js';
import { CEDH_PRESETS } from '../public/js/presets.js';
import { makeRng, shuffle } from '../public/js/util.js';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? +argv[i + 1] : d; };
const GAMES = opt('games', 8), SEED = opt('seed', 80000);
const cards = JSON.parse(readFileSync(new URL('./golden-cards.json', import.meta.url), 'utf8'));
const find = n => { const k = n.toLowerCase(); return cards[k] || Object.values(cards).find(c => c.name.toLowerCase().split(' // ')[0] === k.split(' // ')[0]); };
const decks = CEDH_PRESETS.map(p => { const commanders = [], main = []; for (const e of parseText(p.list).entries) { const raw = find(e.name); if (e.commander) commanders.push(normalize(raw)); else main.push({ card: normalize(raw), qty: e.qty }); } return { deckName: p.name, commanders, cards: main }; });
const styles = ['cedh', 'balanced', 'aggressive', 'defensive', 'combo'];

// What each checked decision comes to, as text
const SIGS = {
  bestPlay: best => (best ? `${best.why || '?'}@${Math.round((best.s || 0) * 100)}` : 'nothing'),
  declareAttackersPlan: list => (list || []).map(x => `${x.o.iid}>${x.target}`).sort().join(',') || 'no attack',
  declareBlockers: list => (list || []).map(x => `${x.b.iid}>${x.a.iid}`).sort().join(',') || 'no blocks',
  respond: r => (r ? `${r.kind}:${r.card?.card.name || r.source?.card.name || ''}` : 'pass'),
};
let checked = 0, changed = 0;
const counts = {};
const reports = new Map();
for (let i = 0; i < GAMES; i++) {
  const g = new Game([0, 1, 2, 3].map(k => { const d = decks[(i + k) % 4]; return { playerName: `P${k + 1}`, deckName: d.deckName, color: '#888', agent: new Agent(styles[(i + k) % 5]), commanders: d.commanders, cards: d.cards }; }),
    { beat: async () => {} }, { seed: SEED + i, noLearning: true });
  const scramble = makeRng((SEED + i) ^ 0x51ed);
  for (const p of g.players) {
    const agent = p.agent;
    for (const [method, toSig] of Object.entries(SIGS)) {
      const orig = agent[method].bind(agent);
      agent[method] = (gg, pp, ...rest) => {
        if (gg === g && pp === p && !g.over) {
          const realRand = g.rand, notes = { ...agent };
          const ask = () => { g.rand = makeRng(12345); try { return toSig(orig(gg, pp, ...rest)); } finally { Object.assign(agent, notes); } };
          const before = ask();
          const saved = g.players.map(q => ({ hand: q.hand, library: q.library, zones: [...q.hand, ...q.library].map(o => o.zone) }));
          for (const q of g.opponents(p)) {
            const pool = [...q.hand, ...q.library];
            shuffle(pool, scramble);
            q.hand = pool.slice(0, q.hand.length);
            q.library = pool.slice(q.hand.length);
            for (const o of q.hand) o.zone = 'hand';
            for (const o of q.library) o.zone = 'library';
          }
          let after;
          try { after = ask(); } finally {
            g.players.forEach((q, k) => { q.hand = saved[k].hand; q.library = saved[k].library; [...q.hand, ...q.library].forEach((o, j) => { o.zone = saved[k].zones[j]; }); });
            g.rand = realRand;
          }
          checked++;
          counts[method] = (counts[method] || 0) + 1;
          if (before !== after) {
            changed++;
            const key = `${method}: ${before} → ${after}`;
            if (!reports.has(key)) reports.set(key, `seed ${SEED + i}, turn ${g.turn}, ${p.name}, ${method}: ${before}  became  ${after}`);
          }
        }
        return orig(gg, pp, ...rest);
      };
    }
  }
  await g.run();
}
console.log(`Hidden information: ${GAMES} games, ${checked} decisions asked again with the opponents' hidden cards scrambled (${Object.entries(counts).map(([k, n]) => `${k} ${n}`).join(', ')}), ${changed} changed.`);
for (const r of [...reports.values()].slice(0, 10)) console.log(`  ${r}`);
if (changed) process.exitCode = 1;
