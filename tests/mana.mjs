// Phyrexian, hybrid and two-brid mana (Phase 2D, rules 12): parseCost tags the symbols, mana.js plans every way of
// paying before anything is paid, and the payer chooses how many Phyrexian symbols to pay with life
// (Game.withPhyrexianChoice). Real cards' costs come from the card data (tests/scenario.mjs).
//   node tests/mana.mjs            run them all (exit 1 on any failure)
//   node tests/mana.mjs Dismember  only the tests whose name contains "Dismember"
import { scenario, find, P, logText, errors, settle, card } from './scenario.mjs';
import { RULES, parseCost } from '../public/js/engine.js';
import { HumanAgent } from '../public/js/human.js';
import { watchGame } from '../public/js/invariants.js';

const only = process.argv[2];
const results = [];
const test = async (name, fn) => {
  if (only && !name.toLowerCase().includes(only.toLowerCase())) return;
  try { await fn(); results.push([name, null]); } catch (e) { results.push([name, e]); }
};
const eq = (got, want, what) => { if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`${what}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); };
const ok = (cond, what) => { if (!cond) throw new Error(what); };
const noErrors = g => eq(errors(g).length, 0, 'simulator errors');
ok(RULES >= 12, `these tests are for rules 12 and later (RULES is ${RULES})`);

// A table where seat 0 has these lands untapped and these cards in hand, in its main phase
const table = async (lands, hand = [], { life = 40, opp = ['Grizzly Bears'], rules } = {}) => {
  const g = await scenario([{ battlefield: lands, hand, life }, { battlefield: opp }], { rules: rules ?? RULES });
  g.active = 0; g.phase = 'main1';
  return g;
};
const tapped = g => P(g, 0).battlefield.filter(o => o.tapped).map(o => o.card.name).sort();
// A plan for a bare cost (no card): what the planner would do, then paid, as a cast pays
const pay = async (g, cost, payLife) => {
  const c = parseCost(cost);
  const plan = await g.withPhyrexianChoice(P(g, 0), null, c, 0, payLife, [], null, () => g.planPayment(P(g, 0), c, 0));
  if (plan) g.commitPayment(P(g, 0), plan);
  return plan;
};
const cast = async (g, name, choice = {}) => { const r = await g.cast(P(g, 0), find(g, 0, name, 'hand'), choice); await settle(g); return r; };
const bears = g => find(g, 1, 'Grizzly Bears');

// ---------- parsing
await test('Parsing: the symbols keep their colors, and Phyrexian and two-brid ones are tagged', async () => {
  const c = parseCost('{1}{B/P}{W/U}{2/W}{G/W/P}{C}{X}');
  eq([c.generic, c.x, c.pips.length], [1, 1, 5], 'generic, X, pips');
  eq(c.pips.map(x => [x.join('/'), !!x.phy, x.two || 0]), [['B', true, 0], ['W/U', false, 0], ['W', false, 2], ['G/W', true, 0], ['C', false, 0]], 'pips');
  eq(parseCost(card('Dismember').manaCost).pips.map(x => [x.join(), !!x.phy]), [['B', true], ['B', true]], 'Dismember {1}{B/P}{B/P}');
  eq(parseCost(card('Reaper King').manaCost).pips.map(x => [x.join(), x.two]), [['W', 2], ['U', 2], ['B', 2], ['R', 2], ['G', 2]], 'Reaper King');
});

// ---------- 1–4. Phyrexian
await test('1. {B/P} with black mana: a Swamp pays it, no life', async () => {
  const g = await table(['Swamp']);
  const plan = await pay(g, '{B/P}', 0);
  ok(plan && !plan.life, 'paid with mana');
  eq([tapped(g), P(g, 0).life], [['Swamp'], 40], 'tapped, life');
});
await test('2. {B/P} with two life: no black mana needed', async () => {
  const g = await table(['Island']);
  const plan = await pay(g, '{B/P}', 1);
  eq([plan?.life, tapped(g), P(g, 0).life], [2, [], 38], 'life paid, tapped, life');
  ok(/pays 2 life for a Phyrexian mana symbol/.test(logText(g)), 'logged as a payment');
});
await test('3. {U/P}: Gitaxian Probe cast with no lands at all, for 2 life', async () => {
  const g = await table([], ['Gitaxian Probe']);
  const hand0 = P(g, 0).hand.length;
  ok(await cast(g, 'Gitaxian Probe'), 'cast');
  eq(P(g, 0).life, 38, 'life');
  eq(P(g, 0).hand.length, hand0, 'hand (Probe left, a card was drawn)');
  ok(P(g, 0).graveyard.some(o => o.card.name === 'Gitaxian Probe'), 'Probe resolved');
  noErrors(g);
});
await test('4. Not enough life: at 2 life Gitaxian Probe needs {U}; at 3 life it can be paid', async () => {
  const g2 = await table([], ['Gitaxian Probe'], { life: 2 });
  ok(!g2.canCast(P(g2, 0), find(g2, 0, 'Gitaxian Probe', 'hand')), 'not castable at 2 life with no blue mana');
  ok(!(await cast(g2, 'Gitaxian Probe')), 'the cast is refused');
  eq(P(g2, 0).life, 2, 'life unchanged');
  const g3 = await table([], ['Gitaxian Probe'], { life: 3 });
  ok(await cast(g3, 'Gitaxian Probe'), 'castable at 3 life (it leaves 1)');
  eq(P(g3, 0).life, 1, 'life');
});

// ---------- 5–9. Hybrid and two-brid
await test('5. {W/U} with white mana', async () => {
  const g = await table(['Plains']);
  ok(await pay(g, '{W/U}'), 'paid'); eq(tapped(g), ['Plains'], 'tapped');
});
await test('6. {W/U} with blue mana', async () => {
  const g = await table(['Island']);
  ok(await pay(g, '{W/U}'), 'paid'); eq(tapped(g), ['Island'], 'tapped');
  const g2 = await table(['Swamp']);
  ok(!(await pay(g2, '{W/U}')), 'black mana can\'t pay it'); eq(tapped(g2), [], 'nothing tapped');
});
await test('7. {2/W} with two generic mana: Spectral Procession for six Swamps', async () => {
  const g = await table(Array(6).fill('Swamp'), ['Spectral Procession']);
  ok(await cast(g, 'Spectral Procession'), 'cast');
  eq(tapped(g).length, 6, 'six Swamps tapped');
  eq(P(g, 0).battlefield.filter(o => o.token).length, 3, 'three Spirit tokens');
  noErrors(g);
});
await test('8. {2/W} with one white mana each: Spectral Procession for three Plains', async () => {
  const g = await table([...Array(3).fill('Plains'), ...Array(3).fill('Swamp')], ['Spectral Procession']);
  ok(await cast(g, 'Spectral Procession'), 'cast');
  eq(tapped(g), ['Plains', 'Plains', 'Plains'], 'the Plains paid, the Swamps are left');
  noErrors(g);
});
await test('9. {2/W} with neither a white mana nor two others: refused, nothing tapped', async () => {
  const g = await table(['Swamp']);
  ok(!(await pay(g, '{2/W}')), 'not payable'); eq(tapped(g), [], 'nothing tapped');
  const g5 = await table(Array(5).fill('Swamp'), ['Spectral Procession']);
  ok(!g5.canCast(P(g5, 0), find(g5, 0, 'Spectral Procession', 'hand')), 'Spectral Procession with 5 Swamps (needs 6)');
});

// ---------- 10–15. Ordinary costs and mixtures
await test('10. Ordinary costs: {2}{U}{U} and {3}{B} are paid as before', async () => {
  const g = await table(['Island', 'Island', 'Swamp', 'Swamp']);
  ok(await pay(g, '{2}{U}{U}'), '{2}{U}{U} with two Islands and two Swamps'); eq(tapped(g).length, 4, 'all four tapped');
  const g2 = await table(['Island', 'Swamp', 'Swamp', 'Swamp']);
  ok(!(await pay(g2, '{2}{U}{U}')), '{2}{U}{U} with one Island'); eq(tapped(g2), [], 'nothing tapped');
  const g3 = await table(['Swamp', 'Island', 'Island', 'Island']);
  ok(await pay(g3, '{3}{B}'), '{3}{B}');
});
await test('11. Several hybrid symbols: Kitchen Finks {1}{G/W}{G/W}, and Reaper King\'s five two-brid symbols', async () => {
  const g = await table(['Forest', 'Plains', 'Swamp'], ['Kitchen Finks']);
  ok(await cast(g, 'Kitchen Finks'), 'Finks with a Forest, a Plains and a Swamp');
  ok(find(g, 0, 'Kitchen Finks'), 'on the battlefield');
  const g2 = await table(['Swamp', 'Swamp', 'Swamp'], ['Kitchen Finks']);
  ok(!(await cast(g2, 'Kitchen Finks')), 'not with three Swamps');
  const rk = async lands => { const t = await table(lands, ['Reaper King']); return [await cast(t, 'Reaper King'), tapped(t).length]; };
  eq(await rk(['Plains', 'Island', 'Swamp', 'Mountain', 'Forest']), [true, 5], 'one of each color: five lands');
  eq(await rk(Array(10).fill('Wastes')), [true, 10], 'ten colorless: {2} each');
  eq(await rk(['Plains', 'Island', ...Array(6).fill('Wastes')]), [true, 8], 'two colors and six colorless');
  eq(await rk(Array(9).fill('Wastes')), [false, 0], 'nine colorless: refused, nothing tapped');
});
await test('12. Several Phyrexian symbols: Dismember with one Swamp pays {1} and 4 life, and kills a 2/2', async () => {
  const g = await table(['Swamp'], ['Dismember']);
  ok(await cast(g, 'Dismember', { targets: [{ obj: bears(g) }], phyLife: 2 }), 'cast');
  eq([P(g, 0).life, tapped(g)], [36, ['Swamp']], 'life, tapped');
  ok(!bears(g), 'the Bears died (-5/-5)');
  noErrors(g);
});
await test('13. Phyrexian with ordinary mana: Phyrexian Metamorph {3}{U/P}; Ajani, Sleeper Agent {1}{G}{G/W/P}{W}', async () => {
  const g = await table(['Swamp', 'Swamp', 'Swamp'], ['Phyrexian Metamorph']);
  ok(await cast(g, 'Phyrexian Metamorph'), 'Metamorph with three Swamps and 2 life');
  eq([P(g, 0).life, tapped(g).length], [38, 3], 'life, tapped');
  const g2 = await table(['Swamp', 'Swamp', 'Swamp', 'Island'], ['Phyrexian Metamorph']);
  ok(await cast(g2, 'Phyrexian Metamorph', { phyLife: 0 }), 'Metamorph paid all with mana when chosen');
  eq([P(g2, 0).life, tapped(g2).length], [40, 4], 'life, tapped');
  const g3 = await table(['Forest', 'Plains', 'Swamp'], ['Ajani, Sleeper Agent']);
  ok(await cast(g3, 'Ajani, Sleeper Agent'), 'Ajani: {G/W/P} paid with life');
  eq(P(g3, 0).life, 38, 'life');
  const g4 = await table(['Forest', 'Plains', 'Plains', 'Swamp'], ['Ajani, Sleeper Agent']);
  ok(await cast(g4, 'Ajani, Sleeper Agent', { phyLife: 0 }), 'Ajani: {G/W/P} paid with the second Plains');
  eq([P(g4, 0).life, tapped(g4).length], [40, 4], 'life, tapped');
  noErrors(g); noErrors(g3);
});
await test('14. {C}: Wastes pays it, Plains can\'t', async () => {
  const g = await table(['Wastes']);
  ok(await pay(g, '{C}'), 'Wastes');
  const g2 = await table(['Plains']);
  ok(!(await pay(g2, '{C}')), 'Plains');
});
await test('15. {X}: Walking Ballista for X = 2 with four lands', async () => {
  const g = await table(Array(4).fill('Wastes'), ['Walking Ballista']);
  ok(await cast(g, 'Walking Ballista', { x: 2 }), 'cast');
  eq(find(g, 0, 'Walking Ballista')?.counters, 2, 'counters');
  eq(tapped(g).length, 4, 'tapped');
});

// ---------- 16, 17. No partial payments; people and the AI use the same rules
await test('16. A cost that can\'t be paid in full takes nothing: no mana, no life, the card stays in hand', async () => {
  const g = await table(['Swamp'], ['Dismember'], { life: 4 });
  const pool0 = P(g, 0).pool.length;
  ok(!(await cast(g, 'Dismember', { targets: [{ obj: bears(g) }] })), 'refused');
  eq([P(g, 0).life, tapped(g), P(g, 0).pool.length], [4, [], pool0], 'life, tapped, pool');
  ok(find(g, 0, 'Dismember', 'hand'), 'still in hand');
  ok(bears(g), 'nothing happened to the Bears');
});
await test('17. A person and the AI pay through the same rules: same options, same plan for the same choice', async () => {
  const run = async (person, life) => {
    const g = await table(['Swamp', 'Swamp', 'Swamp'], ['Dismember'], { life });
    let asked = null;
    if (person) Object.assign(P(g, 0).agent, { ui: { ask: async (text, o) => { asked = { text, options: o.buttons.map(b => b.value) }; return { button: o.buttons[o.buttons.length - 1].value }; } }, phyrexianLifeAsync: HumanAgent.prototype.phyrexianLifeAsync });
    else { const ai = P(g, 0).agent, orig = ai.phyrexianLife; ai.phyrexianLife = (gg, p, s, info) => { asked = { options: info.options }; return orig.call(ai, gg, p, s, info); }; }
    await cast(g, 'Dismember', { targets: [{ obj: bears(g) }] });
    return { asked, life: P(g, 0).life, tapped: tapped(g).length, bears: !!bears(g) };
  };
  const person = await run(true, 40), ai = await run(false, 40);
  eq(person.asked.options, [0, 1, 2], 'the person is offered every complete payment');
  eq(ai.asked.options, [0, 1, 2], 'the AI is offered the same');
  ok(/Phyrexian mana symbols? \(\{B\/P\}\{B\/P\}\)/.test(person.asked.text), `the question names the symbols: ${person.asked.text}`);
  eq([person.life, person.tapped, ai.life, ai.tapped], [36, 1, 36, 1], 'both paid 4 life and one Swamp (the person chose it; the AI at 40 life keeps mana)');
  ok(!person.bears && !ai.bears, 'both resolved');
  // (low on life, the AI pays with mana: 22 - 4 would leave it under half its starting life)
  const low = await run(false, 22);
  eq([low.life, low.tapped], [22, 3], 'AI at 22 life pays all with mana');
  // (Birthing Pod's {1}{G/P} ability cost goes through the same choice)
  const g = await table(['Forest', 'Forest'], [], { opp: ['Grizzly Bears'] });
  const pod = g.mk(card('Birthing Pod'), P(g, 0)); pod.zone = 'battlefield'; P(g, 0).battlefield.push(pod);
  const podAb = g.abilitiesOf(pod)[0];
  ok(podAb && /\{G\/P\}/i.test(podAb.cost), `Birthing Pod's ability cost: ${podAb?.cost}`);
  const opts = (await import('../public/js/mana.js')).phyrexianOptions(g, P(g, 0), g.abilityCost(P(g, 0), pod, podAb), 0, pod, []);
  eq(opts, [0, 1], "Birthing Pod's {G/P}: mana or life");
});

// ---------- the rules checker, and old replays
await test('The rules checker counts life-paid symbols as paid (no false "mana" finding)', async () => {
  const g = await table(['Swamp'], ['Dismember']);
  const found = watchGame(g);
  await cast(g, 'Dismember', { targets: [{ obj: bears(g) }], phyLife: 2 });
  eq([...found.keys()].filter(k => k.startsWith('mana')), [], 'mana findings');
});
await test('Rules 11 (old replays): Phyrexian symbols need their color and {2/W} needs white, as before', async () => {
  const g = await table(['Swamp'], ['Dismember'], { rules: 11 });
  ok(!g.canCast(P(g, 0), find(g, 0, 'Dismember', 'hand')), 'Dismember with one Swamp');
  const g2 = await table(Array(6).fill('Swamp'), ['Spectral Procession'], { rules: 11 });
  ok(!g2.canCast(P(g2, 0), find(g2, 0, 'Spectral Procession', 'hand')), 'Spectral Procession with six Swamps');
  const g3 = await table([], ['Gitaxian Probe'], { rules: 11 });
  ok(!g3.canCast(P(g3, 0), find(g3, 0, 'Gitaxian Probe', 'hand')), 'Gitaxian Probe with no lands');
});
await test('Mental Misstep {U/P} can be paid with 2 life (as a response, the usual way it is cast)', async () => {
  const g = await table([], ['Mental Misstep']);
  const c = parseCost(card('Mental Misstep').manaCost);
  ok(c.pips[0].phy && c.pips[0][0] === 'U', 'read as {U/P}');
  const plan = await pay(g, card('Mental Misstep').manaCost, 1);
  eq([plan?.life, P(g, 0).life], [2, 38], 'paid with life');
});

let failed = 0;
for (const [name, e] of results) { if (e) { failed++; console.log(`FAIL  ${name}\n      ${e.message}`); } else console.log(`ok    ${name}`); }
console.log(`Mana: ${results.length} tests, ${results.length - failed} passed, ${failed} failed.`);
if (failed) process.exit(1);
