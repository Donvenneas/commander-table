#!/usr/bin/env node
// Expedition runs played by the AI (item 163): whole runs, every fight a real one-on-one game with an AI pilot in your
// seat, events and rewards chosen by a simple rule (the first reward, rest for life). Reports how far each run got, so
// difficulties and modifiers can be checked end to end. Card data comes from Scryfall (needs the internet).
//   node tools/expeditionsim.mjs [--runs 6] [--set fdn] [--difficulty hard] [--modifier none] [--seed 1] [--win-all]
// Scryfall from a script: name ourselves (the browser sends its own User-Agent), remember every answer (there's no
// card cache outside the browser, and the same lands are asked for every fight), and leave at least half a second
// between requests, well inside their rate limit.
const nodeFetch = globalThis.fetch;
const answers = new Map();
let nextAt = 0;
globalThis.fetch = async (url, init = {}) => {
  if (!String(url).startsWith('https://api.scryfall.com')) return nodeFetch(url, init);
  const key = `${init.method || 'GET'} ${url} ${init.body || ''}`;
  if (!answers.has(key)) {
    const wait = Math.max(0, nextAt - Date.now());
    nextAt = Date.now() + wait + 500;
    if (wait) await new Promise(r => setTimeout(r, wait));
    const r = await nodeFetch(url, { ...init, headers: { ...(init.headers || {}), 'User-Agent': 'CommanderTable-tools/1.0' } });
    if (r.status === 429) throw new Error('Scryfall asked us to slow down: stopping (try again in a few minutes)');
    answers.set(key, { status: r.status, body: await r.text() });
  }
  const a = answers.get(key);
  return new Response(a.body, { status: a.status, headers: { 'Content-Type': 'application/json' } });
};
import { Game } from '../public/js/engine.js';
import { Agent, guessStyle } from '../public/js/ai.js';
import { startRun, yourDeck, rivalDeck, fightLife, currentChoices, fightOver, rewardChoices, takeReward, eventFor, resolveEvent, actName } from '../public/js/campaign.js';

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const RUNS = +arg('runs', 6), SET = arg('set', 'fdn'), DIFF = arg('difficulty', 'hard'), MOD = arg('modifier', 'none'), SEED = +arg('seed', 1);
// --win-all: count every fight as won (after playing it), to walk the whole road through all four acts
const WIN_ALL = argv.includes('--win-all');
const results = [];
for (let n = 0; n < RUNS; n++) {
  const r = await startRun({ set: SET, setName: SET.toUpperCase(), difficulty: DIFF, modifier: MOD, seed: SEED + n * 7919, onStatus: () => {} });
  let fights = 0;
  while (!r.over) {
    const options = currentChoices(r);
    // (fights where they're offered: duels first; events and rests otherwise)
    const kind = options.includes('boss') ? 'boss' : options.find(k => k === 'duel') || options.find(k => k === 'elite') || options[0];
    if (kind === 'event' || kind === 'rest') {
      const ev = kind === 'rest' ? { choice: 'rest' } : eventFor(r);
      if (ev.choice === 'rest' || ev.choice === 'life4' || ev.choice === 'life6') resolveEvent(r, 'life', ev.choice === 'life6' ? 6 : ev.choice === 'life4' ? 4 : 3);
      else if (ev.choice === 'rare') { const c = await rewardChoices(r, 'elite'); resolveEvent(r, 'add', c[0]?.name); }
      else resolveEvent(r, 'life', 0);
      continue;
    }
    const mine = await yourDeck(r, () => {});
    const theirs = await rivalDeck(r, kind, () => {});
    const g = new Game([{ d: mine, name: 'You' }, { d: theirs.deck, name: theirs.name }].map(({ d, name }) => ({ playerName: name, deckName: d.deckName, color: '#888', agent: new Agent(guessStyle(d)), commanders: [], cards: d.cards })),
      { beat: async () => {} }, { seed: SEED * 1000 + n * 97 + fights, noLearning: true, format: 'limited', lifeBonus: fightLife(r, kind) });
    await g.run();
    fights++;
    if (process.env.EXDEBUG) console.log(kind, `you ${mine.cards.reduce((a, c) => a + c.qty, 0)} cards (${mine.cards.length} kinds)`, `them ${theirs.deck.cards.reduce((a, c) => a + c.qty, 0)}`, `winner ${g.winner?.name}`, `round ${g.round}`, g.winReason, g.logEntries.slice(-3).map(e => e.html.replace(/<[^>]+>/g, "")).join(" | "));
    fightOver(r, kind, WIN_ALL || g.winner === g.players[0]);
    if (r.pending?.reward) { const c = await rewardChoices(r, r.pending.reward); takeReward(r, c[0]?.name); }
  }
  results.push({ result: r.result, act: r.result === 'won' ? r.acts : r.act + 1, fights: r.fights, wins: r.wins });
  console.log(`run ${n + 1}: ${r.result === 'won' ? `cleared all ${r.acts} acts` : `fell in act ${r.act + 1} (${actName(r.act)})`}, ${r.wins}/${r.fights} fights won`);
}
const cleared = results.filter(x => x.result === 'won').length;
console.log(`${DIFF}, ${MOD}: ${cleared}/${RUNS} runs cleared all four acts; reached act ${results.map(x => x.act).join(', ')}`);
