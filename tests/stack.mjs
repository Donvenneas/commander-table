// The stack and priority (Phase 2G, rules 15: public/js/stack.js). Each test plays real cards on a known board and
// checks the mechanics themselves: who was asked for priority and when (with how many passes so far), what was on the
// stack at that moment, the order things resolved in, and where cards went, not only the final board.
//   node tests/stack.mjs            run them all (exit 1 on any failure)
//   node tests/stack.mjs counter    only the tests whose name contains "counter"
import { scenario, find, P, logText, errors, settle } from './scenario.mjs';
import { RULES } from '../public/js/engine.js';
import { MAX_RESPONSES, SAME_RESPONSE } from '../public/js/stack.js';

const only = process.argv[2];
const results = [];
const test = async (name, fn) => {
  if (only && !name.toLowerCase().includes(only.toLowerCase())) return;
  try { await fn(); results.push([name, null]); } catch (e) { results.push([name, e]); }
};
const eq = (got, want, what) => { if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`${what}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); };
const ok = (cond, what) => { if (!cond) throw new Error(what); };
const noErrors = g => eq(errors(g).length, 0, 'simulator errors');
const lines = g => logText(g).replace(/&#39;/g, "'").replace(/&quot;/g, '"').split('\n');
ok(RULES >= 15, `these tests are for rules 15 and later (RULES is ${RULES})`);

// A table with seats 0..n-1 (seat 0 active, main phase). Every seat's priority answers come from `answer` (null:
// pass), and every time a seat is asked, what it saw is recorded: who, for which object, passes so far, the stack.
const table = async (seats, opts = {}) => { const g = await scenario(seats, opts); g.active = opts.active ?? 0; g.phase = 'main1'; return g; };
const script = (g, answer = () => null) => {
  const asks = [];
  for (const q of g.players) {
    q.agent.respondAt = (gg, qq, item) => {
      asks.push({ q: qq.idx, sid: item.sid, name: item.name, kind: item.kind, passes: gg.prio?.passes ?? null, stack: gg.stack.map(x => x.name), ctl: gg.stack.map(x => x.controller) });
      return answer(qq.idx, item, gg) || null;
    };
  }
  return asks;
};
// a response: cast the named card from seat i's hand
const resp = (g, i, name, targets) => ({ kind: 'cast', card: find(g, i, name, 'hand'), targets });
const once = () => { const done = new Set(); return k => (done.has(k) ? false : (done.add(k), true)); };
const order = g => { const ev = []; g.on('life', d => ev.push(`life P${d.p + 1} ${d.d > 0 ? '+' : ''}${d.d}`)); g.on('enter', o => ev.push(`enters ${o.card.name}`)); return ev; };
const cast = async (g, i, name, choice = {}) => { const r = await g.cast(P(g, i), find(g, i, name, 'hand'), choice); await settle(g); return r; };

// ---------- 1–4: casting, responses, responses to responses, last in first out
await test('1–4. A casts a creature, B responds with an instant, A responds to that; they resolve in reverse order', async () => {
  const g = await table([{ battlefield: ['Forest', 'Forest', 'Mountain'], hand: ['Grizzly Bears', 'Shock'] }, { battlefield: ['Mountain'], hand: ['Lightning Bolt'] }]);
  const first = once();
  const asks = script(g, (i, item) => {
    if (i === 1 && item.name === 'Grizzly Bears' && first('bolt')) return resp(g, 1, 'Lightning Bolt', [{ player: 0 }]);
    if (i === 0 && item.name === 'Lightning Bolt' && first('shock')) return resp(g, 0, 'Shock', [{ player: 1 }]);
  });
  const ev = order(g);
  ok(await cast(g, 0, 'Grizzly Bears'), 'cast');
  // (when Shock was cast, all three were on the stack, Shock on top)
  ok(asks.some(a => JSON.stringify(a.stack) === JSON.stringify(['Grizzly Bears', 'Lightning Bolt', 'Shock'])), 'three objects on the stack at once');
  eq(ev, ['life P2 -2', 'life P1 -3', 'enters Grizzly Bears'], 'Shock resolved first, then Lightning Bolt, then Grizzly Bears');
  ok(lines(g).some(l => /P1 responds with Shock/.test(l)) && lines(g).some(l => /P2 responds with Lightning Bolt/.test(l)), 'logged as responses');
  noErrors(g);
});

// ---------- 5, 18: a counterspell counters the right object; costs stay paid
await test('5, 18. Counterspell counters the spell it targets (not the one under it), and the countered spell\'s costs stay paid', async () => {
  const g = await table([{ battlefield: ['Forest', 'Forest', 'Island', 'Island'], hand: ['Grizzly Bears', 'Counterspell'] }, { battlefield: ['Mountain'], hand: ['Lightning Bolt'] }]);
  const first = once();
  script(g, (i, item) => {
    if (i === 1 && item.name === 'Grizzly Bears' && first('bolt')) return resp(g, 1, 'Lightning Bolt', [{ player: 0 }]);
    if (i === 0 && item.name === 'Lightning Bolt' && first('cs')) return resp(g, 0, 'Counterspell', [{ spell: item }]);
  });
  ok(await cast(g, 0, 'Grizzly Bears'), 'cast');
  eq(P(g, 0).life, 40, 'the Bolt did nothing');
  ok(find(g, 0, 'Grizzly Bears'), 'Grizzly Bears (under it) resolved');
  ok(find(g, 1, 'Lightning Bolt', 'graveyard'), 'Lightning Bolt went to the graveyard');
  ok(find(g, 1, 'Mountain').tapped, "the Bolt's mana stays spent (costs aren't refunded when countered)");
  ok(lines(g).some(l => /Lightning Bolt is countered/.test(l)), 'logged');
  noErrors(g);
});
await test('18. A countered creature spell: the card goes to the graveyard, the lands that paid for it stay tapped', async () => {
  const g = await table([{ battlefield: ['Forest', 'Forest'], hand: ['Grizzly Bears'] }, { battlefield: ['Island', 'Island'], hand: ['Counterspell'] }]);
  script(g, (i, item) => (i === 1 && item.name === 'Grizzly Bears' ? resp(g, 1, 'Counterspell', [{ spell: item }]) : null));
  ok(await cast(g, 0, 'Grizzly Bears'), 'cast');
  ok(find(g, 0, 'Grizzly Bears', 'graveyard'), 'in the graveyard');
  ok(P(g, 0).battlefield.filter(o => o.card.name === 'Forest').every(o => o.tapped), 'both Forests still tapped');
  eq(P(g, 0).pool.length, 0, 'no mana given back');
});

// ---------- 6: an activated ability outlives its source
await test('6. An activated ability stays on the stack and resolves after its source is destroyed in response', async () => {
  const g = await table([{ battlefield: ['Prodigal Pyromancer'] }, { battlefield: ['Mountain'], hand: ['Lightning Bolt'] }]);
  const pyro = find(g, 0, 'Prodigal Pyromancer');
  pyro.sick = false; pyro.enteredTurn = -1;
  let seen = null;
  script(g, (i, item) => {
    if (i === 1 && item.kind === 'ability' && !seen) { seen = item; return resp(g, 1, 'Lightning Bolt', [{ obj: pyro }]); }
  });
  ok(await g.activate(P(g, 0), pyro, pyro.fx.abilities[0], { targets: [{ player: 1 }] }), 'activated');
  await settle(g);
  eq(pyro.zone, 'graveyard', 'the Pyromancer died in response');
  eq(P(g, 1).life, 39, 'its ability still dealt 1 damage');
  eq([seen.kind, seen.status, seen.srcIid === pyro.iid], ['ability', 'resolved', true], 'the stack object: an ability, resolved, still knows its source');
  noErrors(g);
});

// ---------- 7, 8: triggers in APNAP order, all on the stack; responding to a trigger
await test('7. Simultaneous triggers of two players all go on the stack together in APNAP order (the non-active player\'s on top)', async () => {
  const g = await table([{ battlefield: ['Blood Artist', 'Grizzly Bears'] }, { battlefield: ['Blood Artist'] }]);
  const asks = script(g);
  g.destroy(find(g, 0, 'Grizzly Bears')); await settle(g);
  const firstAsk = asks.find(a => a.kind === 'trigger');
  ok(firstAsk, 'players got priority with the triggers on the stack');
  eq([firstAsk.stack, firstAsk.ctl], [['Blood Artist', 'Blood Artist'], [0, 1]], "both on the stack at once: the active player's (P1) at the bottom, P2's on top");
  eq(firstAsk.q, 1, "P2's trigger resolves first, so P2 (its controller) gets priority first");
  eq(asks.filter(a => a.kind === 'trigger').map(a => `P${a.q + 1}:${a.stack.length}`), ['P2:2', 'P1:2', 'P1:1', 'P2:1'], 'priority for the top trigger (two on the stack), then for the other (one left)');
  noErrors(g);
});
await test('8. A player responds to a triggered ability: the response resolves first, then the trigger', async () => {
  const g = await table([{ battlefield: ['Blood Artist', 'Grizzly Bears'] }, { battlefield: ['Mountain'], hand: ['Lightning Bolt'] }]);
  const first = once();
  script(g, (i, item) => (i === 1 && item.kind === 'trigger' && first('bolt') ? resp(g, 1, 'Lightning Bolt', [{ player: 0 }]) : null));
  const ev = order(g);
  g.destroy(find(g, 0, 'Grizzly Bears')); await settle(g);
  eq(ev.slice(0, 2), ['life P1 -3', ev[1]], 'Lightning Bolt resolved first');
  ok(/life P\d [-+]1/.test(ev[1]), 'then the trigger (1 life)');
  noErrors(g);
});

// ---------- 9–11: targets checked while casting and again on resolution
await test('9. An illegal target is rejected while casting: nothing is paid and the card stays in hand', async () => {
  const g = await table([{ battlefield: ['Mountain'], hand: ['Lightning Bolt'] }, { battlefield: ['Slippery Bogle'] }]);
  script(g);
  const bogle = find(g, 1, 'Slippery Bogle');
  eq(await g.cast(P(g, 0), find(g, 0, 'Lightning Bolt', 'hand'), { targets: [{ obj: bogle }] }), false, 'cast refused');
  ok(find(g, 0, 'Lightning Bolt', 'hand'), 'still in hand');
  eq(find(g, 0, 'Mountain').tapped, false, 'the Mountain was not tapped');
  eq(g.stack.length, 0, 'nothing on the stack');
  ok(lines(g).some(l => /can't be cast: .*not a legal target/.test(l)), 'the reason is logged (601.2c)');
});
await test('9b. A spell that needs a target can\'t be cast with none; an ability with an illegal target can\'t be activated', async () => {
  const g = await table([{ battlefield: ['Island', 'Prodigal Pyromancer'], hand: ['Unsummon'] }, { battlefield: ['Slippery Bogle'] }]);
  script(g);
  eq(await g.cast(P(g, 0), find(g, 0, 'Unsummon', 'hand'), { targets: [null] }), false, 'Unsummon with no target refused');
  const pyro = find(g, 0, 'Prodigal Pyromancer');
  pyro.sick = false; pyro.enteredTurn = -1;
  eq(await g.activate(P(g, 0), pyro, pyro.fx.abilities[0], { targets: [{ obj: find(g, 1, 'Slippery Bogle') }] }), false, 'activation refused');
  eq(pyro.tapped, false, 'the {T} cost was not paid');
});
await test('10. The target leaves before resolution (bounced in response): the spell does nothing and goes to the graveyard', async () => {
  const g = await table([{ battlefield: ['Mountain'], hand: ['Lightning Bolt'] }, { battlefield: ['Island', 'Grizzly Bears'], hand: ['Unsummon'] }]);
  const bears = find(g, 1, 'Grizzly Bears');
  let bolt = null;
  script(g, (i, item) => (i === 1 && item.name === 'Lightning Bolt' && !bolt ? (bolt = item, resp(g, 1, 'Unsummon', [{ obj: bears }])) : null));
  ok(await cast(g, 0, 'Lightning Bolt', { targets: [{ obj: bears }] }), 'cast');
  eq(bears.zone, 'hand', 'bounced');
  eq(bolt.status, 'fizzled', 'the Bolt did not resolve (608.2b)');
  ok(find(g, 0, 'Lightning Bolt', 'graveyard'), 'Bolt in the graveyard');
  ok(lines(g).some(l => /Lightning Bolt fizzles/.test(l)), 'logged');
});
await test('11. Every target illegal by resolution (hexproof given in response): the spell doesn\'t resolve; the creature is untouched', async () => {
  const g = await table([{ battlefield: ['Mountain'], hand: ['Lightning Bolt'] }, { battlefield: ['Forest', 'Grizzly Bears'], hand: ['Blossoming Defense'] }]);
  const bears = find(g, 1, 'Grizzly Bears');
  let bolt = null;
  script(g, (i, item) => (i === 1 && item.name === 'Lightning Bolt' && !bolt ? (bolt = item, resp(g, 1, 'Blossoming Defense', [{ obj: bears }])) : null));
  ok(await cast(g, 0, 'Lightning Bolt', { targets: [{ obj: bears }] }), 'cast');
  eq([bears.zone, bears.damage || 0], ['battlefield', 0], 'alive, no damage');
  eq(bolt.status, 'fizzled', 'fizzled');
});

// ---------- 12: mana abilities don't use the stack
await test('12. A mana ability resolves at once, without the stack or priority', async () => {
  const g = await table([{ battlefield: ['Forest', 'Forest'], hand: ['Grizzly Bears'] }, { battlefield: ['Sol Ring', 'Mountain'], hand: ['Lightning Bolt'] }]);
  let during = null;
  const asks = script(g, (i, item, gg) => {
    if (i === 1 && item.name === 'Grizzly Bears' && !during) {
      const before = { stack: gg.stack.length, asks: asks.length };
      gg.tapForMana(P(gg, 1), find(gg, 1, 'Sol Ring'));
      during = { before, after: { stack: gg.stack.length, asks: asks.length, pool: P(gg, 1).pool.length } };
    }
    return null;
  });
  ok(await cast(g, 0, 'Grizzly Bears'), 'cast');
  eq(during.after.stack, during.before.stack, 'nothing went on the stack');
  eq(during.after.asks, during.before.asks, 'nobody was given priority for it');
  eq(during.after.pool, 2, 'the mana is in the pool at once');
});

// ---------- 13, 14, 19: priority order, passes, resolving
await test('13, 14. Priority: the caster first, then turn order; all passing resolves the top object; a new object resets the passes', async () => {
  const g = await table([{ battlefield: ['Forest', 'Forest'], hand: ['Grizzly Bears'] }, { battlefield: ['Mountain'], hand: ['Lightning Bolt'] }, {}]);
  const first = once();
  const asks = script(g, (i, item) => (i === 1 && item.name === 'Grizzly Bears' && first('bolt') ? resp(g, 1, 'Lightning Bolt', [{ player: 2 }]) : null));
  let resolvedAfter = null;
  g.on('enter', o => { if (o.card.name === 'Grizzly Bears') resolvedAfter = asks.length; });
  ok(await cast(g, 0, 'Grizzly Bears'), 'cast');
  const seq = asks.map(a => `P${a.q + 1}:${a.name}:${a.passes}`);
  eq(seq, [
    'P1:Grizzly Bears:0', 'P2:Grizzly Bears:1',                                   // P2 responds (P1 had passed)
    'P2:Lightning Bolt:0', 'P3:Lightning Bolt:1', 'P1:Lightning Bolt:2',          // the Bolt: its caster first; all pass
    'P1:Grizzly Bears:0', 'P2:Grizzly Bears:1', 'P3:Grizzly Bears:2',             // back to the Bears: the active player first, passes reset
  ], 'who was asked, about what, with how many passes');
  eq(resolvedAfter, asks.length, 'Grizzly Bears resolved only after the third pass in a row');
});
await test('19. Four players, on another player\'s turn: the caster, then turn order; after a response the active player first', async () => {
  const g = await table([{ battlefield: ['Mountain'], hand: ['Shock'] }, {}, { battlefield: ['Mountain'], hand: ['Lightning Bolt'] }, {}], { active: 1 });
  const first = once();
  const asks = script(g, (i, item) => (i === 0 && item.name === 'Lightning Bolt' && first('shock') ? resp(g, 0, 'Shock', [{ player: 2 }]) : null));
  ok(await cast(g, 2, 'Lightning Bolt', { targets: [{ player: 3 }] }), 'P3 casts on P2\'s turn');
  eq(asks.filter(a => a.name === 'Lightning Bolt').map(a => a.q + 1), [3, 4, 1, 2, 3, 4, 1], 'Bolt: P3 P4 P1 (responds) … then P2 (active) P3 P4 P1');
  eq(asks.filter(a => a.name === 'Shock').map(a => a.q + 1), [1, 2, 3, 4], 'Shock: its caster P1, then P2 P3 P4');
  eq(P(g, 3).life, 37, 'Bolt resolved');
});

// ---------- 15: an empty stack, everyone passing, moves the game on
await test('15. With the stack empty and every player passing, the turn moves through its steps to the next player', async () => {
  const g = await table([{ battlefield: ['Forest'] }, { battlefield: ['Forest'] }]);
  script(g);
  for (const q of g.players) { q.agent.mainPhase = async () => {}; q.agent.declareAttackers = () => []; q.agent.declareAttackersPlan = () => []; q.agent.endOfTurn = async () => {}; }
  const phases = [];
  g.on('update', () => { if (phases[phases.length - 1] !== g.phase) phases.push(g.phase); });
  await g.takeTurn(P(g, 1));
  eq(g.stack.length, 0, 'stack empty');
  for (const ph of ['untap', 'upkeep', 'draw', 'main1', 'main2', 'end']) ok(phases.includes(ph), `went through ${ph} (${phases.join(' ')})`);
  ok(phases.indexOf('end') > phases.indexOf('main1'), 'in order');
  noErrors(g);
});

// ---------- 16: more than eight responses
await test('16. More than eight responses to one spell: all ten are cast and resolve before it (rules 14 stopped at eight)', async () => {
  for (const rules of [RULES, 14]) {
    const g = await table([{ battlefield: ['Forest', 'Forest'], hand: ['Grizzly Bears'] }, { battlefield: Array(10).fill('Mountain'), hand: Array(10).fill('Shock') }], { rules });
    script(g, (i, item, gg) => {
      if (i !== 1 || item.name !== 'Grizzly Bears') return null;
      const s = find(gg, 1, 'Shock', 'hand');
      return s ? { kind: 'cast', card: s, targets: [{ player: 0 }] } : null;
    });
    let lifeAtBears = null;
    g.on('enter', o => { if (o.card.name === 'Grizzly Bears') lifeAtBears = P(g, 0).life; });
    ok(await cast(g, 0, 'Grizzly Bears'), 'cast');
    const want = rules >= 15 ? 10 : 8;
    eq([P(g, 1).graveyard.filter(o => o.card.name === 'Shock').length, lifeAtBears], [want, 40 - 2 * want], `rules ${rules}: ${want} Shocks resolved before the Bears`);
    if (rules >= 15) noErrors(g);
  }
});
await test(`16b. Safety: a pilot repeating the same response without end is taken to pass after ${SAME_RESPONSE} times (no freeze); a failed response is a pass`, async () => {
  const g = await table([{ battlefield: ['Forest', 'Forest'], hand: ['Grizzly Bears'] }, { battlefield: ['Mountain'], hand: ['Shock'] }]);
  // (a broken pilot: always offers the same Shock, and the engine is told each time that it acted, though nothing changes)
  let offered = 0;
  script(g, (i, item, gg) => (i === 1 && item.name === 'Grizzly Bears' ? (offered++, { kind: 'cast', card: find(gg, 1, 'Shock', 'hand'), targets: [{ player: 0 }] }) : null));
  g.doResponse = async () => true;
  ok(await cast(g, 0, 'Grizzly Bears'), 'cast');
  ok(find(g, 0, 'Grizzly Bears'), 'the spell still resolved');
  eq(offered, SAME_RESPONSE + 1, 'asked until the repeat guard took it as a pass');
  ok(lines(g).some(l => /same response to Grizzly Bears/.test(l)), 'logged');
  ok(MAX_RESPONSES >= 100, 'the hard limit is far above any real game');
  // (a response that can't be done, like casting a card no longer in hand, is a pass)
  const g2 = await table([{ battlefield: ['Forest', 'Forest'], hand: ['Grizzly Bears'] }, { battlefield: ['Mountain'], hand: ['Shock'] }]);
  let n2 = 0;
  script(g2, (i, item, gg) => (i === 1 && item.name === 'Grizzly Bears' ? (n2++, { kind: 'cast', card: find(gg, 1, 'Shock', 'hand') || find(gg, 1, 'Shock', 'graveyard'), targets: [{ player: 0 }] }) : null));
  ok(await cast(g2, 0, 'Grizzly Bears'), 'cast');
  eq([n2, P(g2, 0).life], [2, 38], 'one Shock, then the failed offer counted as a pass');
});

// ---------- 17: uncounterable
await test("17. Counterspell can't counter Carnage Tyrant: the Tyrant resolves; the Counterspell is still spent", async () => {
  const g = await table([{ battlefield: Array(6).fill('Forest'), hand: ['Carnage Tyrant'] }, { battlefield: ['Island', 'Island'], hand: ['Counterspell'] }]);
  const first = once();
  script(g, (i, item) => (i === 1 && item.name === 'Carnage Tyrant' && first('cs') ? resp(g, 1, 'Counterspell', [{ spell: item }]) : null));
  ok(await cast(g, 0, 'Carnage Tyrant'), 'cast');
  ok(find(g, 0, 'Carnage Tyrant'), 'on the battlefield');
  ok(find(g, 1, 'Counterspell', 'graveyard'), 'Counterspell resolved and went to the graveyard');
  ok(lines(g).some(l => /Carnage Tyrant can't be countered/.test(l)), 'logged');
});

// ---------- Part 9 extras: countering abilities and triggers, a counter war
await test('Stifle counters a triggered ability (the trigger does nothing; Stifle is a spell on the stack above it)', async () => {
  const g = await table([{ battlefield: ['Blood Artist', 'Grizzly Bears'] }, { battlefield: ['Island'], hand: ['Stifle'] }]);
  let trig = null;
  script(g, (i, item) => (i === 1 && item.kind === 'trigger' && !trig ? (trig = item, resp(g, 1, 'Stifle', [{ spell: item }])) : null));
  const ev = order(g);
  g.destroy(find(g, 0, 'Grizzly Bears')); await settle(g);
  eq(trig.status, 'countered', 'the trigger was countered');
  eq(ev.filter(e => /life/.test(e)), [], 'no life changed');
});
await test('Stifle counters an activated ability (the Pyromancer stays tapped: its cost was paid)', async () => {
  const g = await table([{ battlefield: ['Prodigal Pyromancer'] }, { battlefield: ['Island'], hand: ['Stifle'] }]);
  const pyro = find(g, 0, 'Prodigal Pyromancer');
  pyro.sick = false; pyro.enteredTurn = -1;
  script(g, (i, item) => (i === 1 && item.kind === 'ability' ? resp(g, 1, 'Stifle', [{ spell: item }]) : null));
  ok(await g.activate(P(g, 0), pyro, pyro.fx.abilities[0], { targets: [{ player: 1 }] }), 'activated');
  await settle(g);
  eq([P(g, 1).life, pyro.tapped], [40, true], 'no damage; still tapped');
});
await test('A counter war: Counterspell on Counterspell — the second counters the first, and the original spell resolves', async () => {
  const g = await table([{ battlefield: ['Forest', 'Forest', 'Island', 'Island'], hand: ['Grizzly Bears', 'Counterspell'] }, { battlefield: ['Island', 'Island'], hand: ['Counterspell'] }]);
  const first = once();
  const asks = script(g, (i, item) => {
    if (i === 1 && item.name === 'Grizzly Bears' && first('b')) return resp(g, 1, 'Counterspell', [{ spell: item }]);
    if (i === 0 && item.name === 'Counterspell' && item.p.idx === 1 && first('a')) return resp(g, 0, 'Counterspell', [{ spell: item }]);
  });
  ok(await cast(g, 0, 'Grizzly Bears'), 'cast');
  ok(find(g, 0, 'Grizzly Bears'), 'the Bears resolved');
  ok(asks.some(a => a.stack.length === 3), 'three objects on the stack at once');
});

// ---------- 20: state-based actions and waiting triggers before priority
await test('20. After an object resolves, state-based actions and the triggers they cause happen before anyone gets priority again', async () => {
  const g = await table([{ battlefield: ['Forest', 'Forest', 'Blood Artist', 'Llanowar Elves'], hand: ['Grizzly Bears'] }, { battlefield: ['Mountain'], hand: ['Lightning Bolt'] }]);
  const elves = find(g, 0, 'Llanowar Elves');
  const first = once();
  const seen = [];
  const asks = script(g, (i, item, gg) => {
    seen.push({ name: item.name, kind: item.kind, elves: elves.zone, stack: gg.stack.map(x => x.name) });
    if (i === 1 && item.name === 'Grizzly Bears' && first('bolt')) return resp(g, 1, 'Lightning Bolt', [{ obj: elves }]);
  });
  ok(await cast(g, 0, 'Grizzly Bears'), 'cast');
  const afterBolt = seen.findIndex((s, k) => k > 0 && s.name !== 'Lightning Bolt' && seen[k - 1].name === 'Lightning Bolt');
  ok(afterBolt > 0, 'priority was given after the Bolt resolved');
  eq([seen[afterBolt].kind, seen[afterBolt].elves], ['trigger', 'graveyard'], 'the next priority is for the Blood Artist trigger, with the Elves already dead (704) — not for the Bears');
  eq(seen[afterBolt].stack, ['Grizzly Bears', 'Blood Artist'], 'the trigger is on the stack above the Bears');
  ok(find(g, 0, 'Grizzly Bears'), 'and then the Bears resolved');
  ok(asks.length > 0, 'asked');
  noErrors(g);
});

// ---------- stack objects keep their own identity
await test('Stack objects: unique ids, kinds, announced targets frozen, what was paid', async () => {
  const g = await table([{ battlefield: ['Mountain', 'Mountain'], hand: ['Lightning Bolt', 'Shock'] }, { battlefield: ['Grizzly Bears'] }]);
  const items = [];
  script(g, (i, item) => { if (!items.includes(item)) items.push(item); return null; });
  const bears = find(g, 1, 'Grizzly Bears');
  ok(await cast(g, 0, 'Lightning Bolt', { targets: [{ obj: bears }] }), 'cast');
  ok(await cast(g, 0, 'Shock', { targets: [{ player: 1 }] }), 'cast');
  eq(items.map(x => [x.kind, x.name, x.status]), [['spell', 'Lightning Bolt', 'resolved'], ['spell', 'Shock', 'resolved']], 'kinds and statuses');
  ok(items[0].sid !== items[1].sid, 'different ids');
  eq(items[0].announced.targets, [{ obj: bears.iid }], 'the announced target, by object id');
  ok(Object.isFrozen(items[0].announced), 'frozen');
  eq(items[0].paid.mana, 1, 'paid {R}');
});

const failed = results.filter(([, e]) => e);
for (const [name, e] of results) console.log(`${e ? 'FAIL' : 'ok  '} ${name}${e ? `\n       ${e.message}` : ''}`);
console.log(`Stack and priority: ${results.length} tests, ${results.length - failed.length} passed, ${failed.length} failed.`);
process.exit(failed.length ? 1 : 0);
