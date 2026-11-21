// Rules validation (Phase 2O, rules 20): small boards of real cards played through the engine, each checking the
// sequence of events (tests/scenario.mjs record: casts, stack pushes and pops, zone changes, damage with its combat
// flag, life changes, state-based action passes), not only the final board. Every test has an id, the feature, the
// Comprehensive Rules sections it checks, the source files involved and a severity if it fails. Areas covered in depth
// elsewhere are named in the report (stack.mjs, mana.mjs, replacements.mjs, abilities.mjs, multiplayer.mjs).
//   node tests/rules.mjs [id or word]
//   node tests/rules.mjs --report tests/rules-report.md   (also writes the results table)
import { writeFileSync } from 'node:fs';
import { scenario, find, all, P, settle, record, evText, inOrder, logText, errors, card } from './scenario.mjs';
import { RULES } from '../public/js/engine.js';
import { ignoredText } from '../public/js/effects.js';

const reportAt = process.argv.indexOf('--report');
const filter = reportAt < 0 ? process.argv[2]?.toLowerCase() : undefined;
/** @type {{ id: string, feature: string, rule: string, files: string, severity: string, expect: string, fn: Function, known: string }[]} */
const tests = [];
// known: a deviation from the rules that is reproduced, documented and left for now (the test checks the real rule;
// it is listed as KNOWN, not counted as a failure, and says FIXED once the engine gets it right)
const test = (id, feature, rule, files, severity, expect, fn, known = '') => tests.push({ id, feature, rule, files, severity, expect, fn, known });
class Fail extends Error {}
const ok = (c, what) => { if (!c) throw new Fail(what); };
const eq = (got, want, what) => { if (JSON.stringify(got) !== JSON.stringify(want)) throw new Fail(`${what}: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`); };
const seq = (ev, what, ...tests_) => { const k = inOrder(ev, ...tests_); if (k >= 0) throw new Fail(`${what}: step ${k + 1} of ${tests_.length} never happened in order. Events: ${evText(ev)}`); };
const noErrors = g => eq(errors(g), [], 'simulator errors');

// A table with seat 0 active in its first main phase; every seat passes priority unless told otherwise
const table = async (seats, opts = {}) => { const g = await scenario(seats, opts); g.active = opts.active ?? 0; g.phase = 'main1'; for (const q of g.players) q.agent.respondAt = () => null; return g; };
const cast = async (g, i, name, choice = {}) => { const o = find(g, i, name, 'hand'); ok(o, `${name} in P${i + 1}'s hand`); const r = await g.cast(P(g, i), o, choice); await settle(g); return r; };
// Scripted combat: attacks [{ o, target, obj }] for the active seat, blocks [{ b, a }] for each defender
function script(g, attacks, blocks = []) {
  const att = P(g, g.active);
  att.agent.declareAttackers = () => attacks;
  att.agent.declareAttackersPlan = () => attacks;
  for (const q of g.players) if (q !== att) q.agent.declareBlockers = () => blocks.filter(x => x.b.controller === q.idx);
}
const quiet = g => { for (const q of g.players) { q.agent.mainPhase = async () => {}; q.agent.endOfTurn = async () => {}; q.agent.declareAttackers = () => []; q.agent.declareAttackersPlan = () => []; } };
const isMove = (name, from, to) => e => e.t === 'move' && e.name === name && (!from || e.from === from) && (!to || e.to === to);
const isPop = name => e => e.t === 'pop' && e.name === name;
const isPush = name => e => e.t === 'push' && e.name === name;
const isDamage = (to, n, combat) => e => e.t === 'damage' && e.to === to && e.n === n && (combat === undefined || e.combat === combat);
const isHit = (name, n) => e => e.t === 'hit' && e.name === name && (n === undefined || e.n === n);
const isLife = (p, d) => e => e.t === 'life' && e.p === p && e.d === d;

// ================================================================== casting and paying costs (601, 307)
test('R01', 'Casting a spell', '601.2, 608.2', 'engine.js cast, stack.js', 'High', 'cast, put on the stack, resolved from the top, two cards drawn, the card to the graveyard',
  async () => {
    const g = await table([{ battlefield: ['Island', 'Island', 'Island'], hand: ['Divination'], library: ['Opt', 'Opt', 'Opt'] }, {}]);
    const ev = record(g), hand = P(g, 0).hand.length;
    ok(await cast(g, 0, 'Divination'), 'cast');
    // (601.2a: the card moves to the stack first; it becomes cast when the steps are done, 601.2i)
    seq(ev, 'order', isPush('Divination'), e => e.t === 'cast' && e.name === 'Divination', e => isPop('Divination')(e) && e.top, isMove('Divination', 'stack', 'graveyard'));
    eq(P(g, 0).hand.length, hand - 1 + 2, 'hand: Divination left, two cards drawn');
    eq(P(g, 0).battlefield.filter(o => o.tapped).length, 3, 'three lands tapped');
    noErrors(g);
  });
test('R02', 'Casting failure without partial payment', '601.2h, 601.5', 'engine.js cast, mana.js', 'Critical', 'a spell that can\'t be paid for is not cast: nothing tapped, nothing paid, the card stays in hand',
  async () => {
    const g = await table([{ battlefield: ['Island', 'Island'], hand: ['Divination'] }, {}]);
    const ev = record(g);
    eq(await cast(g, 0, 'Divination'), false, 'refused');
    eq(ev.filter(e => ['cast', 'push', 'move', 'life'].includes(e.t)).length, 0, `no event (${evText(ev)})`);
    eq([P(g, 0).battlefield.filter(o => o.tapped).length, P(g, 0).pool.length, !!find(g, 0, 'Divination', 'hand')], [0, 0, true], 'untapped, empty pool, still in hand');
  });
test('R03', 'Timing restrictions (engine-enforced)', '307.1, 117.1a, 702.8', 'mana.js timingRefuses, engine.js cast', 'High', 'rules 20: a sorcery is refused on an opponent\'s turn and with a spell on the stack; an instant and a flash creature are not; rules 19 replays keep the old answer',
  async () => {
    const g = await table([{ battlefield: ['Island', 'Island', 'Island', 'Forest', 'Forest'], hand: ['Divination', 'Opt', 'Ambush Viper'] }, {}], { active: 1 });
    const ev = record(g);
    eq(g.canCast(P(g, 0), find(g, 0, 'Divination', 'hand')), false, 'canCast on the opponent\'s turn');
    eq(await cast(g, 0, 'Divination'), false, 'cast on the opponent\'s turn');
    eq(ev.filter(e => e.t === 'cast').length, 0, 'no cast event');
    ok(await cast(g, 0, 'Opt'), 'an instant on the opponent\'s turn');
    ok(await cast(g, 0, 'Ambush Viper'), 'a flash creature on the opponent\'s turn');
    const s = await table([{ battlefield: ['Island', 'Island', 'Island'], hand: ['Divination'] }, {}]);
    s.stack.push({ o: find(s, 0, 'Island'), p: P(s, 0), effects: [], targets: [], name: 'something' });
    eq(await cast(s, 0, 'Divination'), false, 'a sorcery with an object on the stack');
    const old = await table([{ battlefield: ['Island', 'Island', 'Island'], hand: ['Divination'] }, {}], { active: 1, rules: 19 });
    ok(await cast(old, 0, 'Divination'), 'rules 19 (old replays): the engine let the caller decide, as before');
  });
test('R04', 'Additional costs paid while casting', '601.2a, 601.2h, 608.2h', 'engine.js cast, resolve.js damage', 'Low', 'Fling: the card goes on the stack (601.2a), then the creature is sacrificed as a cost (601.2h); the damage uses its last known power',
  async () => {
    const g = await table([{ battlefield: ['Mountain', 'Mountain', 'Hill Giant'], hand: ['Fling'] }, {}]);
    const ev = record(g);
    ok(await cast(g, 0, 'Fling', { targets: [{ player: 1 }] }), 'cast');
    eq(P(g, 1).life, 37, 'P2 took 3');
    seq(ev, 'cost paid after the card is on the stack, before it resolves', isPush('Fling'), isMove('Hill Giant', 'battlefield', 'graveyard'), isPop('Fling'), isDamage(1, 3, false));
  }, 'the engine pays additional costs (sacrifice, discard) before putting the card on the stack. The result is the same unless something triggers on the cost and looks at the stack; the damage and last known power are right.');

// ================================================================== the stack and priority (117, 405, 605)
test('R05', 'Responses to responses, last in first out', '117.3c, 405.5, 608.1', 'stack.js priority15, engine.js', 'Critical', 'Grizzly Bears, then Lightning Bolt in response, then Shock: they leave the stack top first: Shock, Bolt, Bears',
  async () => {
    const g = await table([{ battlefield: ['Forest', 'Forest', 'Mountain'], hand: ['Grizzly Bears', 'Shock'] }, { battlefield: ['Mountain'], hand: ['Lightning Bolt'] }]);
    let bolted = false, shocked = false;
    P(g, 1).agent.respondAt = (gg, q, item) => (item.name === 'Grizzly Bears' && !bolted ? (bolted = true, { kind: 'cast', card: find(g, 1, 'Lightning Bolt', 'hand'), targets: [{ player: 0 }] }) : null);
    P(g, 0).agent.respondAt = (gg, q, item) => (item.name === 'Lightning Bolt' && !shocked ? (shocked = true, { kind: 'cast', card: find(g, 0, 'Shock', 'hand'), targets: [{ player: 1 }] }) : null);
    const ev = record(g);
    ok(await cast(g, 0, 'Grizzly Bears'), 'cast');
    const pops = ev.filter(e => e.t === 'pop');
    eq(pops.map(e => e.name), ['Shock', 'Lightning Bolt', 'Grizzly Bears'], 'resolution order');
    ok(pops.every(e => e.top), 'every object left from the top of the stack');
    seq(ev, 'damage in resolution order', isDamage(1, 2, false), isDamage(0, 3, false), e => e.t === 'enter' && e.name === 'Grizzly Bears');
    noErrors(g);
  });
test('R06', 'Countering a spell', '701.5, 608.2b', 'resolve.js counter, stack.js', 'High', 'Counterspell resolves first and the countered spell goes to the graveyard without resolving (no cards drawn)',
  async () => {
    const g = await table([{ battlefield: ['Island', 'Island', 'Island'], hand: ['Divination'] }, { battlefield: ['Island', 'Island'], hand: ['Counterspell'] }]);
    let done = false;
    P(g, 1).agent.respondAt = (gg, q, item) => (item.name === 'Divination' && !done ? (done = true, { kind: 'cast', card: find(g, 1, 'Counterspell', 'hand'), targets: [{ spell: item }] }) : null);
    const ev = record(g), hand = P(g, 0).hand.length;
    ok(await cast(g, 0, 'Divination'), 'cast');
    seq(ev, 'counter first', isPush('Divination'), isPush('Counterspell'), isPop('Counterspell'), isPop('Divination'), isMove('Divination', 'stack', 'graveyard'));
    eq(P(g, 0).hand.length, hand - 1, 'no cards drawn');
    eq(P(g, 0).battlefield.filter(o => o.tapped).length, 3, 'its costs stay paid');
  });
test('R07', 'Mana abilities don\'t use the stack', '605.3a, 605.3b', 'engine.js tapForMana', 'Medium', 'tapping Sol Ring adds {C}{C} at once with nothing put on the stack',
  async () => {
    const g = await table([{ battlefield: ['Sol Ring'] }, {}]);
    const ev = record(g);
    ok(g.tapForMana(P(g, 0), find(g, 0, 'Sol Ring')), 'tapped');
    eq([P(g, 0).pool.length, ev.filter(e => e.t === 'push').length], [2, 0], 'pool and stack pushes');
  });

// ================================================================== combat (506–511, 702)
const fight = async (g, attacks, blocks = []) => { script(g, attacks, blocks); g.phase = 'combat'; await g.combat(P(g, g.active)); await settle(g); };
test('R08', 'First strike', '510.4, 702.7b', 'combat.js, engine.js combatDamage', 'High', 'Lyra (5/5 first strike, lifelink) kills a blocking Serra Angel in the first-strike step; Serra never deals damage; Lyra\'s controller gains 5',
  async () => {
    const g = await table([{ battlefield: ['Lyra Dawnbringer'] }, { battlefield: ['Serra Angel'] }]);
    const lyra = find(g, 0, 'Lyra Dawnbringer'), serra = find(g, 1, 'Serra Angel');
    const ev = record(g);
    await fight(g, [{ o: lyra, target: 1 }], [{ b: serra, a: lyra }]);
    seq(ev, 'first-strike damage, life, then the death', isHit('Serra Angel', 5), isLife(0, 5), e => e.t === 'sba', isMove('Serra Angel', 'battlefield', 'graveyard'));
    ok(!ev.some(isHit('Lyra Dawnbringer')), `Serra dealt no damage (${evText(ev)})`);
    eq(P(g, 1).life, 40, 'blocked: no damage to P2');
  });
test('R09', 'Double strike', '702.4b, 510.4', 'combat.js', 'High', 'an unblocked Boros Swiftblade deals combat damage twice, once in each step',
  async () => {
    const g = await table([{ battlefield: ['Boros Swiftblade'] }, {}]);
    const ev = record(g);
    await fight(g, [{ o: find(g, 0, 'Boros Swiftblade'), target: 1 }]);
    eq(ev.filter(isDamage(1, 1, true)).length, 2, `two combat damage events (${evText(ev)})`);
    eq(P(g, 1).life, 38, 'P2 at 38');
  });
test('R10', 'Trample with deathtouch, and lifelink', '702.19c, 702.2c, 702.15b, 510.1c', 'combat.js, combatai.js', 'High', 'a 2/2 deathtouch trample lifelink attacker blocked by a 3/3 assigns 1 (lethal with deathtouch) to it and 1 to the player; both die; its controller gains 2',
  async () => {
    const g = await table([{ battlefield: ['Grizzly Bears'] }, { battlefield: ['Hill Giant'] }]);
    const hawk = find(g, 0, 'Grizzly Bears'), giant = find(g, 1, 'Hill Giant');
    // (a 2/2 given deathtouch, trample and lifelink until end of turn, as a pump spell would)
    hawk.tempKw = new Set(['trample', 'deathtouch', 'lifelink']);
    const ev = record(g);
    await fight(g, [{ o: hawk, target: 1 }], [{ b: giant, a: hawk }]);
    ok(ev.some(isHit('Hill Giant', 1)) && ev.some(isDamage(1, 1, true)), `1 to the blocker, 1 tramples over (${evText(ev)})`);
    ok(ev.some(isLife(0, 2)) || (ev.filter(e => e.t === 'life' && e.p === 0).reduce((s, e) => s + e.d, 0) === 2), 'lifelink: +2');
    seq(ev, 'the blocker dies by state-based action', e => e.t === 'sba', isMove('Hill Giant', 'battlefield', 'graveyard'));
    seq(ev, 'the attacker took 3 and died too', isHit('Grizzly Bears', 3), isMove('Grizzly Bears', 'battlefield', 'graveyard'));
  });
test('R11', 'Flying, reach and menace in block legality', '702.9b, 702.17b, 702.110b, 509.1b', 'combat.js, engine.js canBlock', 'High', 'a non-flyer can\'t block a flyer, reach can; a menace attacker blocked by one creature is unblocked',
  async () => {
    const g = await table([{ battlefield: ['Serra Angel', 'Hill Giant'] }, { battlefield: ['Grizzly Bears', 'Llanowar Elves'] }]);
    const serra = find(g, 0, 'Serra Angel'), giant = find(g, 0, 'Hill Giant'), bears = find(g, 1, 'Grizzly Bears');
    eq(g.canBlock(bears, serra), false, 'Bears can\'t block a flyer');
    bears.tempKw = new Set(['reach']);
    eq(g.canBlock(bears, serra), true, 'with reach it can');
    bears.tempKw = null;
    giant.tempKw = new Set(['menace']);
    const ev = record(g);
    await fight(g, [{ o: giant, target: 1 }], [{ b: bears, a: giant }]);
    ok(ev.some(isDamage(1, 3, true)) && !ev.some(isHit('Grizzly Bears')), `one blocker isn't enough: 3 to P2 (${evText(ev)})`);
  });
test('R12', 'Attacking a planeswalker', '506.3, 510.1, 120.3c, 704.5i', 'combat.js, resolve.js damageObj', 'High', 'damage to an attacked planeswalker removes loyalty, not life; at 0 loyalty it goes to the graveyard',
  async () => {
    const g = await table([{ battlefield: ['Grizzly Bears', 'Hill Giant'] }, { battlefield: ['Jace Beleren'] }]);
    const jace = find(g, 1, 'Jace Beleren');
    const loyalty = jace.loyalty;
    ok(loyalty > 0, `Jace has loyalty (${loyalty})`);
    const ev = record(g);
    await fight(g, [{ o: find(g, 0, 'Grizzly Bears'), target: 1, obj: jace }, { o: find(g, 0, 'Hill Giant'), target: 1, obj: jace }]);
    eq(P(g, 1).life, 40, 'no life lost');
    ok(!ev.some(e => e.t === 'damage' && e.to === 1), 'no damage to the player');
    seq(ev, 'loyalty gone, then the planeswalker dies', e => e.t === 'sba', isMove('Jace Beleren', 'battlefield', 'graveyard'));
  });
test('R13', 'Additional combat phase', '500.8, 506.1', 'resolve.js extraCombat, engine.js restOfTurn', 'Medium', 'Relentless Assault: the creatures untap and attack again in a second combat phase; two rounds of combat damage',
  async () => {
    const g = await table([{ battlefield: ['Mountain', 'Mountain', 'Mountain', 'Mountain', 'Grizzly Bears'], hand: ['Relentless Assault'] }, {}]);
    quiet(g);
    const bears = find(g, 0, 'Grizzly Bears');
    // (cast in the second main phase, after the first attack: it untaps the creatures that attacked)
    let casted = false;
    P(g, 0).agent.mainPhase = async (gg, p, phase) => { if (phase === 'main2' && !casted) { casted = true; ok(await gg.cast(p, find(gg, 0, 'Relentless Assault', 'hand')), 'cast in main 2'); await settle(gg); } };
    const ev = record(g);
    script(g, [{ o: bears, target: 1 }]);
    await g.restOfTurn(P(g, 0));
    seq(ev, 'combat, the spell, combat again', isDamage(1, 2, true), isPop('Relentless Assault'), isDamage(1, 2, true));
    eq(ev.filter(isDamage(1, 2, true)).length, 2, `two combats (${evText(ev)})`);
    eq(P(g, 1).life, 36, 'P2 at 36');
  });

// ================================================================== state-based actions (704)
test('R14', 'Simultaneous state-based actions', '704.3, 704.5f, 704.5g', 'engine.js sba, triggers.js', 'Critical', 'a creature with lethal damage and one with 0 toughness die in the same pass, as state-based actions (not triggers: nothing goes on the stack)',
  async () => {
    const g = await table([{ battlefield: ['Grizzly Bears', 'Llanowar Elves'] }, {}]);
    find(g, 0, 'Grizzly Bears').damage = 2; find(g, 0, 'Llanowar Elves').tempT = -1;
    const ev = record(g);
    await g.sba();
    const firstSba = ev.findIndex(e => e.t === 'sba');
    const moves = ev.filter(e => e.t === 'move').map(e => `${e.name}→${e.to}`);
    eq(moves.sort(), ['Grizzly Bears→graveyard', 'Llanowar Elves→graveyard'], 'both died');
    ok(firstSba === 0 && ev.slice(1).findIndex(e => e.t === 'sba') > ev.findLastIndex(e => e.t === 'move') - 1 || ev.filter(e => e.t === 'sba').length === 1, `one pass (${ev.map(e => e.t).join(',')})`);
    eq(ev.filter(e => e.t === 'push').length, 0, 'nothing used the stack');
  });
test('R15', 'Legend rule', '704.5j', 'engine.js sba', 'High', 'with two copies of a legendary permanent, its controller keeps one', async () => {
  const g = await table([{ battlefield: ['Thalia, Guardian of Thraben', 'Plains', 'Plains'], hand: ['Thalia, Guardian of Thraben'] }, {}]);
  const ev = record(g);
  ok(await cast(g, 0, 'Thalia, Guardian of Thraben'), 'second copy cast');
  eq(all(g, 0, 'Thalia, Guardian of Thraben').length, 1, 'one left');
  eq(ev.filter(isMove('Thalia, Guardian of Thraben', 'battlefield', 'graveyard')).length, 1, 'one put into the graveyard');
});
test('R16', 'A player at 0 life loses', '704.5a, 120.3a', 'engine.js sba', 'Critical', 'Lightning Bolt to a player at 3 life: damage, life to 0, the player loses at the next state-based check', async () => {
  const g = await table([{ battlefield: ['Mountain'], hand: ['Lightning Bolt'] }, { life: 3 }, {}]);
  const ev = record(g);
  ok(await cast(g, 0, 'Lightning Bolt', { targets: [{ player: 1 }] }), 'cast');
  seq(ev, 'damage then loss', isDamage(1, 3, false), isLife(1, -3), e => e.t === 'sba');
  ok(P(g, 1).lost, 'P2 lost');
});

// ================================================================== replacement effects (614, 616)
test('R17', 'Replacement effect on dying: Rest in Peace', '614.1a, 614.6', 'replacements.js, zones.js move', 'Critical', 'a creature that would die is exiled instead and is never in the graveyard',
  async () => {
    const g = await table([{ battlefield: ['Rest in Peace'] }, { battlefield: ['Grizzly Bears'] }]);
    const ev = record(g);
    find(g, 1, 'Grizzly Bears').damage = 2; await settle(g);
    ok(ev.some(isMove('Grizzly Bears', 'battlefield', 'exile')), `exiled (${evText(ev)})`);
    ok(!ev.some(e => e.t === 'move' && e.name === 'Grizzly Bears' && e.to === 'graveyard'), 'never moved to the graveyard');
    eq(P(g, 1).graveyard.length, 0, 'graveyard empty');
  });
test('R18', 'Replacement effect: Leyline of the Void', '614.1a', 'replacements.js, zones.js move', 'High', 'an opponent\'s creature that dies is exiled instead; its controller\'s own isn\'t',
  async () => {
    const g = await table([{ battlefield: ['Leyline of the Void', 'Llanowar Elves'] }, { battlefield: ['Grizzly Bears'] }]);
    const ev = record(g);
    find(g, 1, 'Grizzly Bears').damage = 2; find(g, 0, 'Llanowar Elves').damage = 1; await settle(g);
    ok(ev.some(isMove('Grizzly Bears', 'battlefield', 'exile')) && !ev.some(isMove('Grizzly Bears', null, 'graveyard')), `opponent's: exiled (${evText(ev)})`);
    ok(ev.some(isMove('Llanowar Elves', 'battlefield', 'graveyard')), 'own: graveyard');
  });
test('R19', 'Token doubling: Doubling Season and Anointed Procession', '614.1a, 616.1, 111.1', 'replacements.js', 'High', 'Raise the Alarm makes 2 soldiers; with Doubling Season 4; with Anointed Procession too 8',
  async () => {
    const count = async extra => {
      const g = await table([{ battlefield: ['Plains', 'Plains', ...extra], hand: ['Raise the Alarm'] }, {}]);
      ok(await cast(g, 0, 'Raise the Alarm'), 'cast');
      return P(g, 0).battlefield.filter(o => o.token).length;
    };
    eq([await count([]), await count(['Doubling Season']), await count(['Doubling Season', 'Anointed Procession'])], [2, 4, 8], 'tokens');
  });

// ================================================================== continuous effects and layers (611, 613)
test('R20', 'Until-end-of-turn effects expire at cleanup', '514.2, 611.2a', 'engine.js endSteps', 'High', 'Giant Growth makes Grizzly Bears 5/5 until the cleanup step, then 2/2 again; damage is removed then too',
  async () => {
    const g = await table([{ battlefield: ['Forest', 'Grizzly Bears'], hand: ['Giant Growth'] }, {}]);
    quiet(g);
    const bears = find(g, 0, 'Grizzly Bears');
    ok(await cast(g, 0, 'Giant Growth', { targets: [{ obj: bears }] }), 'cast');
    eq([g.power(bears), g.toughness(bears)], [5, 5], 'pumped');
    bears.damage = 3;
    await g.endSteps(P(g, 0));
    eq([g.power(bears), g.toughness(bears), bears.damage, bears.zone], [2, 2, 0, 'battlefield'], 'after cleanup');
  });
test('R21', 'Control change until end of turn', '108.4, 613.1b, 514.2', 'resolve.js steal, engine.js endSteps', 'High', 'Act of Treason: P1 controls P2\'s Hill Giant, untapped and with haste, this turn; it returns at cleanup; ownership never changes',
  async () => {
    const g = await table([{ battlefield: ['Mountain', 'Mountain', 'Mountain'], hand: ['Act of Treason'] }, { battlefield: [{ name: 'Hill Giant', tapped: true }] }]);
    quiet(g);
    const giant = find(g, 1, 'Hill Giant');
    ok(await cast(g, 0, 'Act of Treason', { targets: [{ obj: giant }] }), 'cast');
    eq([giant.controller, giant.owner, giant.tapped, g.has(giant, 'haste'), P(g, 0).battlefield.includes(giant)], [0, 1, false, true, true], 'stolen: controller, owner, untapped, haste, on P1\'s side');
    await g.endSteps(P(g, 0));
    eq([giant.controller, P(g, 1).battlefield.includes(giant)], [1, true], 'back at cleanup');
  });
test('R22', 'Ability removal and base P/T in layers: Humility', '613.1f, 613.4b, 613.4c', 'effects.js, engine.js humility/setLayer, triggers.js', 'High', 'rules 20: with Humility and Glorious Anthem a creature is 2/2 (1/1 set in 7b, +1/+1 in 7c) with no keywords; Craterhoof\'s enters trigger doesn\'t trigger; rules 19 keeps the old reading',
  async () => {
    const g = await table([{ battlefield: ['Humility', 'Glorious Anthem', 'Serra Angel', 'Forest', 'Forest', 'Forest', 'Forest', 'Forest', 'Forest', 'Forest', 'Forest'], hand: ['Craterhoof Behemoth'] }, {}]);
    const serra = find(g, 0, 'Serra Angel');
    eq([g.power(serra), g.toughness(serra), g.has(serra, 'flying'), g.has(serra, 'vigilance')], [2, 2, false, false], 'Serra Angel');
    const ev = record(g);
    ok(await cast(g, 0, 'Craterhoof Behemoth'), 'Craterhoof cast');
    const hoof = find(g, 0, 'Craterhoof Behemoth');
    ok(!ev.some(e => e.t === 'push' && e.name !== 'Craterhoof Behemoth'), `no trigger went on the stack (${evText(ev)})`);
    eq([g.power(hoof), g.power(serra)], [2, 2], 'no team pump');
    const old = await table([{ battlefield: ['Humility', 'Glorious Anthem', 'Serra Angel'] }, {}], { rules: 19 });
    eq(g.rules, RULES, 'newest rules');
    eq(old.power(find(old, 0, 'Serra Angel')), 5, 'rules 19 (old replays): Humility unread, as before');
  });

// ================================================================== zones and object identity (400.7, 110.5)
test('R23', 'A permanent that changes zones is a new object', '400.7, 303.4d, 704.5m', 'zones.js move, engine.js sba', 'High', 'bounced Grizzly Bears with counters, damage and an Aura comes back clean: no counters or damage, untapped; the Aura goes to the graveyard',
  async () => {
    const g = await table([{ battlefield: [{ name: 'Grizzly Bears', counters: 2, tapped: true }, 'Plains', 'Plains'], hand: ['Pacifism'] }, {}]);
    const bears = find(g, 0, 'Grizzly Bears');
    ok(await cast(g, 0, 'Pacifism', { auraTarget: bears }), 'Pacifism cast on it');
    eq(find(g, 0, 'Pacifism')?.attachedTo, bears, 'attached');
    bears.damage = 1;
    const ev = record(g);
    g.move(bears, 'hand'); await settle(g);
    // (the engine puts the Aura into the graveyard as part of its host leaving rather than at the next state-based check;
    // no player gets priority in between, so the result is the one 704.5m gives)
    seq(ev, 'bounce, then the Aura falls off', isMove('Grizzly Bears', 'battlefield', 'hand'), isMove('Pacifism', 'battlefield', 'graveyard'));
    eq([bears.counters, bears.damage, bears.tapped], [0, 0, false], 'state reset');
  });
test('R24', 'Tokens cease to exist outside the battlefield', '111.7, 704.5d', 'zones.js move', 'High', 'a dying token is gone, not in a graveyard', async () => {
  const g = await table([{ battlefield: ['Plains', 'Plains'], hand: ['Raise the Alarm'] }, {}]);
  ok(await cast(g, 0, 'Raise the Alarm'), 'cast');
  const tok = P(g, 0).battlefield.find(o => o.token);
  tok.damage = 1; await settle(g);
  eq([tok.zone !== 'battlefield', P(g, 0).graveyard.some(o => o.token), g.players.every(q => !['hand', 'graveyard', 'exile', 'library'].some(z => q[z].includes(tok)))], [true, false, true], 'gone everywhere');
});

// ================================================================== Commander (903)
test('R25', 'Commander tax', '903.8', 'mana.js costOf, engine.js cast', 'High', 'a commander cast a second time from the command zone costs {2} more', async () => {
  const g = await table([{ battlefield: Array(8).fill('Plains'), commander: 'Thalia, Guardian of Thraben', commanderOut: false }, {}]);
  const thalia = () => P(g, 0).command.find(o => o.isCommander);
  ok(thalia(), 'in the command zone');
  ok(await g.cast(P(g, 0), thalia()), 'first cast'); await settle(g);
  const tapped1 = P(g, 0).battlefield.filter(o => o.tapped && o.fx.type.land).length;
  const t = find(g, 0, 'Thalia, Guardian of Thraben');
  for (const o of P(g, 0).battlefield) o.tapped = false;
  P(g, 0).agent.commanderZone = () => 'command';
  g.move(t, 'graveyard'); await settle(g);
  ok(thalia(), 'back in the command zone (owner\'s choice)');
  ok(await g.cast(P(g, 0), thalia()), 'second cast'); await settle(g);
  const tapped2 = P(g, 0).battlefield.filter(o => o.tapped && o.fx.type.land).length;
  eq([tapped1, tapped2], [2, 4], 'lands tapped for the first and second cast');
});
test('R26', 'Commander damage', '903.10a, 704.6c, 510.2', 'resolve.js damagePlayer, combat.js', 'Critical', 'combat damage from each commander is counted apart; noncombat damage from a commander doesn\'t count; 21 from one commander loses even at high life',
  async () => {
    const g = await table([{ battlefield: ['Kraum, Ludevic\'s Opus', 'Tymna the Weaver'] }, {}]);
    const kraum = find(g, 0, 'Kraum, Ludevic\'s Opus'), tymna = find(g, 0, 'Tymna the Weaver');
    kraum.isCommander = true; tymna.isCommander = true;
    const ev = record(g);
    g.damagePlayer(P(g, 1), 5, kraum, false); await settle(g);
    eq(P(g, 1).cmdDamage[kraum.iid] || 0, 0, 'noncombat damage not counted');
    await fight(g, [{ o: kraum, target: 1 }, { o: tymna, target: 1 }]);
    eq([P(g, 1).cmdDamage[kraum.iid], P(g, 1).cmdDamage[tymna.iid]], [4, 2], 'counted per commander');
    ok(ev.filter(e => e.t === 'damage' && e.combat).length === 2, 'two combat damage events');
    P(g, 1).cmdDamage[kraum.iid] = 18; P(g, 1).life = 100;
    for (const o of [kraum, tymna]) { o.tapped = false; o.attacking = null; }
    await fight(g, [{ o: kraum, target: 1 }]);
    ok(P(g, 1).lost, `22 commander damage from Kraum: lost at ${P(g, 1).life} life`);
  });

// ================================================================== honest card support
test('R27', 'Unread card text is reported, not approximated', '— (coverage)', 'effects.js ignoredText', 'Medium', 'Fireball\'s divided damage isn\'t read, and the game says so', async () => {
  ok(ignoredText(card('Fireball')), 'reported as unread');
  ok(!ignoredText(card('Lightning Bolt')), 'Lightning Bolt fully read');
});

// ---------- run
const results = [];
for (const t of tests) {
  if (filter && !`${t.id} ${t.feature}`.toLowerCase().includes(filter)) continue;
  let status = 'pass', why = '';
  try { await t.fn(); } catch (e) { status = e instanceof Fail ? 'fail' : 'error'; why = String(e.message || e).split('\n')[0]; }
  if (t.known) { if (status === 'fail') { status = 'known'; why = `${t.known} (${why})`; } else if (status === 'pass') status = 'fixed'; }
  results.push({ ...t, status, why });
  if (status === 'known') console.log(`  KNOWN ${t.id}  ${t.feature}  [${t.severity}]: ${t.known}`);
  else if (status === 'fixed') console.log(`  FIXED ${t.id}  ${t.feature}: the known deviation is gone; remove its note`);
  else if (status === 'pass') console.log(`  ok    ${t.id}  ${t.feature}`);
  else console.log(`  FAIL  ${t.id}  ${t.feature}  [${t.severity}]\n        rules: ${t.rule}   files: ${t.files}\n        expected: ${t.expect}\n        actual:   ${why}`);
}
if (reportAt >= 0) {
  const md = ['# Rules validation results', '', `\`node tests/rules.mjs --report tests/rules-report.md\` · rules version ${RULES} · ${results.filter(r => r.status === 'pass').length} of ${results.length} pass`, '',
    '| ID | Feature | Rules | Expected | Result | Files | Severity if it fails |', '|---|---|---|---|---|---|---|',
    ...results.map(r => `| ${r.id} | ${r.feature} | ${r.rule} | ${r.expect.replace(/\|/g, '/')} | ${r.status === 'pass' ? 'pass' : r.status === 'known' ? `known deviation: ${r.known.replace(/\|/g, '/')}` : `**${r.status}**: ${r.why.replace(/\|/g, '/').slice(0, 200)}`} | ${r.files} | ${r.severity} |`), ''].join('\n');
  writeFileSync(process.argv[reportAt + 1] || 'tests/rules-report.md', md);
}
const failed = results.filter(r => r.status === 'fail' || r.status === 'error').length, known = results.filter(r => r.status === 'known').length;
console.log(`Rules validation: ${results.length} tests, ${results.length - failed - known} passed, ${known} known deviation${known === 1 ? '' : 's'}, ${failed} failed.`);
process.exit(failed ? 1 : 0);
