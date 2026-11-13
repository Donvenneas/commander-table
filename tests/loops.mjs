// Loops of triggers (Phase 2B, rules 10, public/js/loops.js): mandatory loops that never end are a draw, loops that end
// by themselves run to the end, optional loops are their controller's choice, long chains keep the page responsive,
// and nothing about priority, APNAP order or a legitimate long chain changes. Boards come from tests/scenario.mjs;
// the loop cards are made up for the test (their text is read by the real card reader, effects.js).
//   node tests/loops.mjs            run them all (exit 1 on any failure)
//   node tests/loops.mjs Token      only the tests whose name contains "Token"
import { scenario, P, logText, errors, settle } from './scenario.mjs';
import { analyzeCard } from '../public/js/effects.js';
import { HumanAgent } from '../public/js/human.js';
import { RULES } from '../public/js/engine.js';
import { AI_LOOP_REPS, optionalTrigger } from '../public/js/loops.js';

const only = process.argv[2];
const results = [];
const test = async (name, fn) => {
  if (only && !name.toLowerCase().includes(only.toLowerCase())) return;
  const t0 = Date.now();
  try { await fn(); results.push([name, null, Date.now() - t0]); } catch (e) { results.push([name, e, Date.now() - t0]); }
};
const eq = (got, want, what) => { if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`${what}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); };
const ok = (cond, what) => { if (!cond) throw new Error(what); };
const noErrors = g => eq(errors(g).length, 0, 'simulator errors');

// A made-up creature whose text the card reader reads like any card's
const made = new Map();
function fake(name, text) {
  if (!made.has(name + text)) {
    const c = { id: `test-${name}`, name, frontName: name, typeLine: 'Creature — Test', text, manaCost: '{1}', cmc: 1, power: '1', toughness: '1', colors: [], colorIdentity: [], keywords: [], produced: [] };
    c.fx = analyzeCard(c);
    if (c.fx.unread.length) throw new Error(`the card reader didn't read ${name}: ${c.fx.unread.join(' / ')}`);
    made.set(name + text, c);
  }
  return made.get(name + text);
}
const put = (g, i, c) => { const p = P(g, i); const o = g.mk(c, p); o.zone = 'battlefield'; p.battlefield.push(o); return o; };
const TOKEN = { k: 'token', n: 1, p: 1, t: 1, desc: 'white soldier', kw: [] };
const MAKER = 'Whenever another creature you control enters, create a 1/1 white Soldier creature token.';
const MAY_MAKER = 'Whenever another creature you control enters, you may create a 1/1 white Soldier creature token.';
const PINGER = 'Whenever a creature you control enters, each opponent loses 1 life.';
// Something happens (a token for seat i, life gained…), then everything it sets off resolves
const start = async (g, i, effects = [TOKEN]) => { await g.runEffects(P(g, i), P(g, i).battlefield[0], effects, { targets: [], strict: true }); await settle(g); };
const table = (n = 2, life = 40) => scenario(Array.from({ length: n }, () => ({ battlefield: ['Wastes'], life })), { rules: RULES });
const loops = g => g.loopLog.map(e => e.cls);

// ---------- 1, 11: a mandatory trigger that makes a token each time never ends: a draw, recognised quickly
await test('1. Tokens: a mandatory loop that makes a token every time is a draw (104.4b), found in under a second', async () => {
  const g = await table();
  put(g, 0, fake('Loop Maker', MAKER));
  const t0 = Date.now();
  await start(g, 0);
  ok(Date.now() - t0 < 1500, `took ${Date.now() - t0} ms`);
  ok(g.over && !g.winner, 'the game should be a draw');
  eq(loops(g), ['endless'], 'loop classes');
  const e = g.loopLog[0];
  ok(e.reps >= 60 && e.reps < 200, `repetitions before the decision: ${e.reps}`);
  eq(e.change, 'P1: +1 permanents, +1 tokens', 'change per repetition');
  eq(e.sources, ['Loop Maker'], 'sources');
  ok(/mandatory/.test(e.reason) && /104\.4b/.test(e.reason), `reason: ${e.reason}`);
  ok(/^Loop: Loop Maker .* never stops by itself; each repetition: P1: \+1 permanents, \+1 tokens\. The game is a draw\./m.test(logText(g)), 'one clear log line');
  eq(logText(g).split('\n').filter(l => l.startsWith('Loop:')).length, 1, 'log lines about the loop');
  noErrors(g);
});

await test('11. A loop that changes the board each time but ends by itself (tokens + an opponent losing life) runs to the end', async () => {
  const g = await table(2, 100);
  put(g, 0, fake('Loop Maker', MAKER));
  put(g, 0, fake('Loop Pinger', PINGER));
  await start(g, 0);
  // (first the Pinger's triggers pile up under the Maker's: P1 orders them first from then on (603.3b); after that
  // the loop takes one life a repetition and is seen to end by itself)
  eq(loops(g), ['endless', 'ends'], 'loop classes');
  ok(/puts the trigger of Loop Pinger first/.test(g.loopLog[0].decision), `first decision: ${g.loopLog[0].decision}`);
  ok(/P2: -1 life/.test(g.loopLog[1].change) && /\+1 tokens/.test(g.loopLog[1].change), `change: ${g.loopLog[1].change}`);
  ok(g.over && g.winner === P(g, 0), 'P1 should win when P2 runs out of life');
  ok(P(g, 1).life <= 0, `P2's life: ${P(g, 1).life}`);
  noErrors(g);
});

// ---------- 2: life totals
await test('2. Life: Exquisite Blood + Sanguine Bond drain the opponent to 0 (a loop that ends by itself)', async () => {
  const g = await scenario([{ battlefield: ['Exquisite Blood', 'Sanguine Bond'] }, { battlefield: ['Wastes'] }], { rules: RULES });
  await start(g, 0, [{ k: 'gain', n: 1 }]);
  ok(g.over && g.winner === P(g, 0), `P1 should win (over: ${g.over}, reason: ${g.winReason})`);
  ok(P(g, 1).life <= 0, `P2's life: ${P(g, 1).life}`);
  ok(loops(g).every(c => c === 'ends'), `classes: ${loops(g)}`);
  noErrors(g);
});
await test('2b. Life: a mandatory "whenever you gain life, gain 1 life" loop gains for ever: a draw', async () => {
  const g = await table();
  put(g, 0, fake('Life Spring', 'Whenever you gain life, you gain 1 life.'));
  await start(g, 0, [{ k: 'gain', n: 1 }]);
  ok(g.over && !g.winner, 'should be a draw');
  eq(loops(g), ['endless'], 'classes');
  eq(g.loopLog[0].change, 'P1: +1 life', 'change');
  noErrors(g);
});

// ---------- 3: counters
await test('3. Counters: a mandatory "+1/+1 counter put → put a +1/+1 counter" loop is a draw', async () => {
  const g = await table();
  put(g, 0, fake('Swell Engine', 'Whenever one or more +1/+1 counters are put on another creature you control, put a +1/+1 counter on target creature you control.'));
  put(g, 0, fake('Swell Engine', 'Whenever one or more +1/+1 counters are put on another creature you control, put a +1/+1 counter on target creature you control.'));
  const v = P(g, 0).battlefield[1];
  await g.runEffects(P(g, 0), v, [{ k: 'counters', n: 1, on: 'target creature' }], { targets: [{ obj: v }], strict: true });
  await settle(g);
  ok(g.over && !g.winner, `should be a draw (log: ${g.loopLog.map(e => e.cls + ' ' + e.change).join('; ')})`);
  eq(loops(g), ['endless'], 'classes');
  ok(/\+1 counters/.test(g.loopLog[0].change), `change: ${g.loopLog[0].change}`);
  noErrors(g);
});

// ---------- 4, 5, 12: legitimate chains are never cut short
await test('4. A loop that ends by itself: the drain stops when the opponent dies, not before', async () => {
  const g = await table(2, 500);
  put(g, 0, fake('Loop Maker', MAKER));
  put(g, 0, fake('Loop Pinger', PINGER));
  await start(g, 0);
  ok(g.over && g.winner === P(g, 0), 'P1 should win');
  eq(P(g, 1).life, 0, "P2's life at the end");
  // (500 life, one point a repetition: 500 repetitions of two triggers, all resolved)
  ok(P(g, 0).battlefield.filter(o => o.token).length >= 499, `tokens: ${P(g, 0).battlefield.filter(o => o.token).length}`);
  noErrors(g);
});
await test('5. A long finite chain: 120 creatures entering at once trigger 120 times, all resolve', async () => {
  const g = await table(2, 1000);
  put(g, 0, fake('Loop Pinger', PINGER));
  // (one token effect makes at most 40: three of them)
  await start(g, 0, [{ ...TOKEN, n: 40 }, { ...TOKEN, n: 40 }, { ...TOKEN, n: 40 }]);
  eq(P(g, 1).life, 880, "P2's life (one point for each creature)");
  ok(!g.over, 'the game goes on');
  ok(loops(g).every(c => c === 'ends'), `classes: ${loops(g)}`);
  noErrors(g);
});
await test('12. The watcher never ends a legitimate interaction: a 1,500-life drain runs all 3,000 triggers to a win', async () => {
  const g = await table(2, 1500);
  put(g, 0, fake('Loop Maker', MAKER));
  put(g, 0, fake('Loop Pinger', PINGER));
  await start(g, 0);
  ok(g.over && g.winner === P(g, 0), `P1 should win (reason: ${g.winReason})`);
  eq(P(g, 1).life, 0, "P2's life");
  ok(!g.loopLog.some(e => /draw/.test(e.decision)), 'no draw was declared');
  noErrors(g);
});

await test('12b. Four players: Exquisite Blood + Vito drain one opponent out, then the next, until all three are gone', async () => {
  // (the moment an opponent is eliminated, the change just measured still shows their life running out: that's a
  // loop that ends things, not one that "never ends", so no draw is called while it moves to the next opponent)
  const g = await scenario([{ battlefield: ['Vito, Thorn of the Dusk Rose', 'Exquisite Blood'] }, {}, {}, {}], { rules: RULES });
  await start(g, 0, [{ k: 'gain', n: 1 }]);
  eq([1, 2, 3].map(i => P(g, i).lost), [true, true, true], 'opponents lost');
  ok(g.winner === P(g, 0), 'P1 wins');
  ok(!g.loopLog.some(e => /draw/.test(e.decision)), `no draw: ${g.loopLog.map(e => e.decision).join(' | ')}`);
  noErrors(g);
});

// ---------- 6: optional loops
await test('6. Optional loop, AI: an AI repeats a "you may" loop that helps it, then stops it; the game goes on', async () => {
  const g = await table();
  put(g, 0, fake('Loop Maker', MAY_MAKER));
  eq(optionalTrigger({ o: P(g, 0).battlefield[1], ev: 'enter' }), true, 'the trigger reads as optional');
  await start(g, 0);
  ok(!g.over, 'the game goes on');
  const e = g.loopLog[g.loopLog.length - 1];
  ok(/stops it/.test(e.decision), `decision: ${e.decision}`);
  const tokens = P(g, 0).battlefield.filter(o => o.token).length;
  ok(tokens >= AI_LOOP_REPS - 1 && tokens <= AI_LOOP_REPS + 2, `tokens made: ${tokens}`);
  ok(/declines Loop Maker's optional trigger/.test(logText(g)), 'the declined trigger is logged');
  noErrors(g);
});
await test('6b. Optional loop, person: "10 more times", then "Stop the loop"', async () => {
  const g = await table();
  put(g, 0, fake('Loop Maker', MAY_MAKER));
  const asked = [];
  const answers = [10, 0];
  Object.assign(P(g, 0).agent, { ui: { ask: async text => { asked.push(text); return { button: answers.shift() }; } }, loopRepsAsync: HumanAgent.prototype.loopRepsAsync });
  await start(g, 0);
  eq(asked.length, 2, 'times asked');
  ok(/optional, so you choose/.test(asked[0]), `question: ${asked[0]}`);
  const [first, second] = g.loopLog[0].askedAt;
  eq(second - first, 10, 'repetitions between the two questions');
  const tokens = P(g, 0).battlefield.filter(o => o.token).length;
  ok(Math.abs(tokens - second) <= 1, `tokens: ${tokens} (asked after ${first} and ${second} repetitions)`);
  ok(!g.over, 'the game goes on');
  noErrors(g);
});

// ---------- 7, 9: priority is never skipped
await test('7. An opponent gets priority on every trigger of a loop', async () => {
  const g = await table(2, 60);
  put(g, 0, fake('Loop Maker', MAKER));
  put(g, 0, fake('Loop Pinger', PINGER));
  let asked = 0;
  const a = P(g, 1).agent, orig = a.respondAt || a.respond;
  a.respondAt = (...x) => { asked++; return orig.apply(a, x); };
  await start(g, 0);
  // (rules 10 counts each trigger that goes on the stack: trigCount)
  const resolved = g.trigCount.n;
  ok(resolved > 100, `triggers resolved: ${resolved}`);
  eq(asked, resolved, 'priority answers from the opponent (one for each trigger)');
  ok(g.over && g.winner === P(g, 0), 'the loop ends with P2 out of life');
  noErrors(g);
});
await test('9. Three AI opponents pass priority on every trigger, and the loop still resolves in well under a second a trigger', async () => {
  const g = await table(4, 40);
  put(g, 0, fake('Loop Maker', MAKER));
  let asked = 0;
  for (const i of [1, 2, 3]) { const a = P(g, i).agent, orig = a.respondAt || a.respond; a.respondAt = (...x) => { asked++; return orig.apply(a, x); }; }
  const t0 = Date.now();
  await start(g, 0);
  const n = g.trigCount.n;
  eq(asked, 3 * n, `priority answers from three opponents for ${n} triggers`);
  ok(Date.now() - t0 < 3000, `took ${Date.now() - t0} ms`);
  ok(g.over && !g.winner, 'draw');
  noErrors(g);
});

// ---------- 8: APNAP order (603.3b) still holds in rules 10
await test('8. Two players\' triggers on the same event resolve in APNAP order (the non-active player\'s first)', async () => {
  const g = await table();
  g.active = 0;
  put(g, 0, fake('Alpha Watcher', 'Whenever a creature enters, you gain 1 life.'));
  put(g, 1, fake('Beta Watcher', 'Whenever a creature enters, you gain 1 life.'));
  const gains = [];
  g.on('life', d => { if (d.d > 0) gains.push(d.p); });
  await start(g, 0);
  const lines = logText(g).split('\n');
  const a = lines.findIndex(l => l.startsWith('Alpha Watcher —')), b = lines.findIndex(l => l.startsWith('Beta Watcher —'));
  ok(a >= 0 && b >= 0, 'both triggered');
  eq(gains.slice(0, 2), [1, 0], 'Beta (non-active) resolves first');
  // (rules 15: both go on the stack together, the active player's first, at the bottom; before, each was put on the
  // stack when the one before it had resolved, so the lines came in resolution order)
  ok(g.rules >= 15 ? a < b : b < a, `put on the stack in APNAP order: lines ${a} and ${b}`);
  eq([P(g, 0).life, P(g, 1).life], [41, 41], 'life totals');
  noErrors(g);
});

// ---------- 10: the page keeps getting time during a long chain
await test('10. A 6,000-trigger chain at full speed never blocks the event loop for long', async () => {
  const g = await table(2, 3000);
  put(g, 0, fake('Loop Maker', MAKER));
  put(g, 0, fake('Loop Pinger', PINGER));
  let last = Date.now(), worst = 0, ticks = 0;
  const timer = setInterval(() => { const n = Date.now(); worst = Math.max(worst, n - last); last = n; ticks++; }, 5);
  const t0 = Date.now();
  await start(g, 0);
  clearInterval(timer);
  ok(g.over && g.winner === P(g, 0), 'P1 wins');
  ok(ticks > 10, `timer ticks during the chain: ${ticks} in ${Date.now() - t0} ms`);
  ok(worst < 400, `longest time without a tick: ${worst} ms`);
  noErrors(g);
});

// ---------- the last resort: a chain the watcher can't classify
await test('Backstop: with no person at the table, a chain past the safety limit is a draw, with the reason', async () => {
  const g = await table();
  put(g, 0, fake('Loop Maker', MAKER));
  g.trigCount = { turn: g.turn, n: 0, limit: 30 };
  await start(g, 0);
  ok(g.over && !g.winner, 'draw');
  eq(g.loopLog.map(e => e.cls), ['backstop'], 'entries');
  ok(/safety limit/.test(g.loopLog[0].reason), `reason: ${g.loopLog[0].reason}`);
  noErrors(g);
});
await test('Backstop: a person chooses "Keep going", and the loop watcher then decides as usual', async () => {
  const g = await table();
  put(g, 0, fake('Loop Maker', MAKER));
  Object.assign(P(g, 1).agent, { ui: { ask: async () => ({ button: 'go' }) }, loopBackstopAsync: HumanAgent.prototype.loopBackstopAsync });
  g.trigCount = { turn: g.turn, n: 0, limit: 30 };
  await start(g, 0);
  eq(g.loopLog.map(e => e.cls), ['backstop', 'endless'], 'entries');
  ok(g.over && !g.winner, 'the endless mandatory loop is then a draw');
  noErrors(g);
});

// ---------- older rules versions keep their loop handling (replays)
await test('Rules 9 games still use the old handling (no loop watcher entries)', async () => {
  const g = await scenario([{ battlefield: ['Exquisite Blood', 'Sanguine Bond'] }, { battlefield: ['Wastes'] }], { rules: 9 });
  await start(g, 0, [{ k: 'gain', n: 1 }]);
  ok(g.over && g.winner === P(g, 0), 'P1 wins');
  eq(g.loopLog.length, 0, 'loop watcher entries');
});

let failed = 0;
for (const [name, e, ms] of results) {
  if (e) { failed++; console.log(`FAIL  ${name}\n      ${e.message}`); } else console.log(`ok    ${name} (${ms} ms)`);
}
console.log(`Loops: ${results.length} tests, ${results.length - failed} passed, ${failed} failed.`);
if (failed) process.exit(1);
