// AI decisions (Phase 2K, rules 19): what the AI pilots choose on known boards, checked against the play a competent
// player would make, and that the choice is legal and carried out by the real engine. Every strategic test records its
// board, the plays that were legal, the expected play, the AI's actual play and why the expected one is better.
//   node tests/ai.mjs                 run them all (exit 1 on any failure)
//   node tests/ai.mjs combat          only the tests whose name contains "combat"
//   node tests/ai.mjs --report FILE   also write every recorded decision to a Markdown file
import { writeFileSync } from 'node:fs';
import { scenario, card, find, P, logText, errors, settle } from './scenario.mjs';
import { RULES } from '../public/js/engine.js';
import { Agent } from '../public/js/ai.js';
import { lookAheadPlay } from '../public/js/lookahead.js';
import { targetLegal } from '../public/js/resolve.js';

const args = process.argv.slice(2);
const reportAt = args.indexOf('--report');
const reportFile = reportAt >= 0 ? args[reportAt + 1] : null;
const only = args.find((a, i) => !a.startsWith('--') && i !== reportAt + 1);
const results = [];
const decisions = [];
let current = '';
const test = async (name, fn) => {
  if (only && !name.toLowerCase().includes(only.toLowerCase())) return;
  current = name;
  try { await fn(); results.push([name, null]); } catch (e) { results.push([name, e]); }
};
const eq = (got, want, what) => { if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`${what}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); };
const ok = (cond, what) => { if (!cond) throw new Error(what); };
const noErrors = g => eq(errors(g), [], 'simulator errors');
const lines = g => logText(g).replace(/&#39;/g, "'").replace(/&quot;/g, '"').split('\n');
// A strategic decision: recorded for the report, and the actual choice must be the expected one
const decision = ({ state, legal, expected, actual, why }) => {
  decisions.push({ test: current, state, legal, expected, actual, why });
  eq(actual, expected, `${state} — the AI's choice`);
};
ok(RULES >= 19, `these tests are for rules 19 and later (RULES is ${RULES})`);

const table = async (seats, opts = {}) => { const g = await scenario(seats, opts); g.active = opts.active ?? 0; g.phase = opts.phase || 'main1'; g.round = opts.round ?? 4; return g; };
const nm = o => o?.card?.name ?? null;
const play = (g, i, phase = 'main1') => P(g, i).agent.bestPlay(g, P(g, i), phase);
const options = best => (best?.opts || []).filter(o => o.s > 0.5).map(o => o.why).sort();
const target = (g, i, name) => { const c = find(g, i, name, 'hand'); return P(g, i).agent.chooseTarget(g, P(g, i), c.fx.spell[0], c); };
// (the engine's own checks: who may be targeted, and what the card's words allow)
const legalTargets = (g, i, name) => { const c = find(g, i, name, 'hand'); return g.players.flatMap(q => q.battlefield).filter(o => g.validTarget({ obj: o }, P(g, i), c) && targetLegal(g, P(g, i), c.fx.spell[0], { obj: o }, c)).map(nm); };
const ready = (g, i) => { for (const o of P(g, i).battlefield) o.sick = false; };
const attacks = (g, i) => P(g, i).agent.declareAttackers(g, P(g, i)).map(d => `${nm(d.o)} → P${d.target + 1}`);
const blocksOf = (g, i, attackers) => P(g, i).agent.declareBlockers(g, P(g, i), attackers);
const attacking = (g, i, names, t) => names.map(n => { const o = find(g, i, n); o.attacking = t; o.tapped = !g.has(o, 'vigilance'); return o; });
// A real combat: seat i attacks with the named creatures; the defenders' own AI declares the blocks
const combat = async (g, i, names, t) => {
  g.active = i;
  for (const o of P(g, i).battlefield) { o.sick = false; o.tapped = false; }
  P(g, i).agent.declareAttackers = () => names.map(n => ({ o: find(g, i, n), target: t }));
  const blocks = [];
  for (const q of g.players) {
    const real = q.agent.declareBlockers.bind(q.agent);
    q.agent.declareBlockers = (gg, qq, ats) => { const b = real(gg, qq, ats); for (const x of b) blocks.push({ b: x.b, a: x.a, legal: gg.canBlock(x.b, x.a) }); return b; };
  }
  await g.combat(P(g, i));
  await settle(g);
  return blocks;
};
const castBy = async (g, i, name, choice = {}) => { const r = await g.cast(P(g, i), find(g, i, name, 'hand'), choice); await settle(g); return r; };
// Everything the decision could have changed, to check it changed nothing
const stateKey = g => JSON.stringify({ turn: g.turn, phase: g.phase, stack: g.stack.length, players: g.players.map(p => ({ life: p.life, pool: p.pool.length, zones: ['hand', 'library', 'graveyard', 'exile', 'battlefield', 'command'].map(z => p[z].map(o => `${o.iid}:${o.tapped ? 1 : 0}:${o.damage}:${o.counters}`)), cmd: p.cmdDamage })) });

// ======================= mana and sequencing
await test('1. Mana: the AI casts a spell it can pay for (and the payment really happens)', async () => {
  const g = await table([{ battlefield: ['Forest', 'Island'], hand: ['Counterspell', 'Grizzly Bears', 'Shivan Dragon'] }, {}]);
  const best = play(g, 0);
  decision({ state: 'Forest + Island; hand Counterspell, Grizzly Bears, Shivan Dragon; empty opponent', legal: options(best), expected: 'casts Grizzly Bears', actual: best?.why,
    why: 'Shivan Dragon needs six mana; Counterspell has nothing to counter on the AI\'s own turn; Grizzly Bears is the one useful spell it can pay for.' });
  ok(await best.run(), 'the engine accepted it');
  await settle(g);
  eq([!!find(g, 0, 'Grizzly Bears'), P(g, 0).battlefield.filter(o => o.tapped).length], [true, 2], 'Bears on the battlefield, both lands tapped');
  noErrors(g);
});
await test('2. Mana: no attempt at a spell whose colored mana it doesn\'t have', async () => {
  const g = await table([{ battlefield: ['Forest', 'Forest', 'Forest'], hand: ['Murder'] }, { battlefield: ['Hill Giant'] }]);
  ok(!g.canCast(P(g, 0), find(g, 0, 'Murder', 'hand')), 'the engine says Murder can\'t be cast with three Forests');
  const best = play(g, 0);
  decision({ state: 'three Forests; hand Murder ({1}{B}{B}); opponent has Hill Giant', legal: [], expected: null, actual: best?.why ?? null,
    why: 'There is no black mana: Murder is not a legal play, so the AI must not offer it at all.' });
});
await test('3. Mana: holding up a counterspell instead of spending the mana on removal for a minor creature', async () => {
  const g = await table([{ battlefield: ['Island', 'Island', 'Swamp', 'Swamp'], hand: ['Counterspell', 'Murder'] }, { battlefield: ['Llanowar Elves', ...Array(6).fill('Mountain')], hand: ['Shivan Dragon'] }]);
  const m1 = play(g, 0, 'main1'), m2 = play(g, 0, 'main2');
  decision({ state: 'four lands (UU and BB); hand Counterspell and Murder (one or the other, not both); the opponent has only Llanowar Elves and six lands', legal: ['casts Murder (on Llanowar Elves)', 'pass'], expected: [null, null], actual: [m1?.why ?? null, m2?.why ?? null],
    why: 'Murder on a 1/1 mana creature is a poor trade, and it would leave too little for Counterspell when a real threat comes.' });
  // and the held mana is used when the threat arrives
  g.active = 1; g.phase = 'main1';
  await castBy(g, 1, 'Shivan Dragon');
  eq([!!find(g, 1, 'Shivan Dragon'), !!find(g, 0, 'Counterspell', 'graveyard')], [false, true], 'the Dragon was countered with the mana that was held');
  noErrors(g);
});
await test('4. Mana: generic costs are paid with mana the other spells don\'t need (Sol Ring, then Llanowar Elves)', async () => {
  const run = async rules => {
    const g = await table([{ battlefield: ['Forest', 'Mountain'], hand: ['Sol Ring', 'Llanowar Elves'] }, {}], { rules });
    await P(g, 0).agent.mainPhase(g, P(g, 0), 'main1');
    return P(g, 0).battlefield.filter(o => !o.fx.type.land).map(nm).sort();
  };
  decision({ state: 'Forest + Mountain; hand Sol Ring ({1}) and Llanowar Elves ({G})', legal: ['Sol Ring paid with the Forest (Elves can\'t follow)', 'Sol Ring paid with the Mountain (Elves follows)'], expected: ['Llanowar Elves', 'Sol Ring'], actual: await run(RULES),
    why: 'Paying Sol Ring\'s {1} with the Mountain keeps the Forest\'s {G} for Llanowar Elves: two spells this turn instead of one.' });
  eq(await run(18), ['Sol Ring'], 'rules 18 (old replays) still taps the Forest');
});

// ======================= threats
await test('5. Threats: the creature that would kill the AI next turn is removed before a bigger one that can\'t', async () => {
  const g = await table([{ battlefield: ['Swamp', 'Swamp', 'Swamp', 'Wall of Roots'], hand: ['Murder'], life: 5 }, { battlefield: ['Shivan Dragon'] }, { battlefield: ['Colossal Dreadmaw', 'Sol Ring', 'Rhystic Study', 'Phyrexian Arena'] }]);
  const a = P(g, 0).agent;
  decision({ state: 'AI at 5 life with Wall of Roots (0/5); P2 has Shivan Dragon (5/5 flying); P3 has Colossal Dreadmaw (6/6 trample) and three engines; hand Murder', legal: legalTargets(g, 0, 'Murder'), expected: 'Shivan Dragon', actual: nm(target(g, 0, 'Murder')?.obj),
    why: 'The Wall can\'t block a flyer, so the Dragon\'s next attack is lethal; the Wall holds the Dreadmaw to 1 trample damage. The bigger, more valuable creature is not the urgent one.' });
  eq([a.threatKind(g, P(g, 0), find(g, 1, 'Shivan Dragon')), a.threatKind(g, P(g, 0), find(g, 2, 'Colossal Dreadmaw')), a.threatKind(g, P(g, 0), find(g, 2, 'Rhystic Study'))], ['lethal', 'minor', 'engine'], 'threat kinds');
  // (rules 18 picked by value and the leader's rank)
  const g18 = await table([{ battlefield: ['Swamp', 'Swamp', 'Swamp', 'Wall of Roots'], hand: ['Murder'], life: 5 }, { battlefield: ['Shivan Dragon'] }, { battlefield: ['Colossal Dreadmaw', 'Hill Giant', 'Sol Ring', 'Rhystic Study', 'Phyrexian Arena'] }], { rules: 18 });
  ok(['Colossal Dreadmaw', 'Hill Giant', 'Shivan Dragon'].includes(nm(target(g18, 0, 'Murder')?.obj)), 'rules 18 still chooses a creature');
});
await test('6. Threats: a combo piece comes before a big creature', async () => {
  const g = await table([{ battlefield: ['Forest', 'Forest', 'Forest'], hand: ['Beast Within'] }, { battlefield: ['Sanguine Bond', 'Exquisite Blood'] }, { battlefield: ['Colossal Dreadmaw'] }]);
  const t = nm(target(g, 0, 'Beast Within')?.obj);
  decision({ state: 'P2 has Sanguine Bond and Exquisite Blood (together they drain everyone on any life gain); P3 has Colossal Dreadmaw; hand Beast Within', legal: legalTargets(g, 0, 'Beast Within'), expected: true, actual: ['Sanguine Bond', 'Exquisite Blood'].includes(t),
    why: `Either enchantment breaks a combo that ends the game; the 6/6 is only a creature. Chosen: ${t}.` });
  eq(P(g, 0).agent.threatKind(g, P(g, 0), find(g, 1, 'Sanguine Bond')), 'combo', 'threat kind');
});
await test('7. Threats: removal never aims at a target its own words forbid', async () => {
  const g = await table([{ battlefield: ['Swamp', 'Swamp'], hand: ['Doom Blade'] }, { battlefield: ['Typhoid Rats', 'Vampire Nighthawk'] }]);
  decision({ state: 'hand Doom Blade ("destroy target nonblack creature"); the opponent has only black creatures', legal: legalTargets(g, 0, 'Doom Blade'), expected: [null, null], actual: [nm(target(g, 0, 'Doom Blade')?.obj), play(g, 0)?.why ?? null],
    why: 'Both creatures are black: Doom Blade has no legal target, so it is neither targeted nor cast.' });
  const g2 = await table([{ battlefield: ['Swamp', 'Forest'], hand: ['Abrupt Decay'] }, { battlefield: ['Shivan Dragon', 'Llanowar Elves'] }]);
  decision({ state: 'hand Abrupt Decay (mana value 3 or less); opponent has Shivan Dragon (6) and Llanowar Elves (1)', legal: legalTargets(g2, 0, 'Abrupt Decay'), expected: 'Llanowar Elves', actual: nm(target(g2, 0, 'Abrupt Decay')?.obj),
    why: 'The Dragon is the bigger threat but has mana value 6: only the Elves is a legal target.' });
});
await test('8. Threats: a spell that can\'t be countered is recognised (Cavern of Souls, "next spell", Veil of Summer)', async () => {
  const g = await table([{ battlefield: Array(6).fill('Mountain'), hand: ['Shivan Dragon'] }, { battlefield: ['Island', 'Island'], hand: ['Counterspell'] }]);
  const a = P(g, 1).agent;
  const item = { o: find(g, 0, 'Shivan Dragon', 'hand'), p: P(g, 0), targets: [], effects: [], ability: false };
  ok(a.wantCountered(g, P(g, 1), item), 'a plain Shivan Dragon is worth countering');
  eq([a.wantCountered(g, P(g, 1), { ...item, uncounterable: true }), (P(g, 0).shieldTurn = g.turn, a.wantCountered(g, P(g, 1), item))], [false, false], 'uncounterable as cast; caster shielded this turn');
  P(g, 0).shieldTurn = 0;
  eq(a.wantCountered(g, P(g, 1), item), true, 'back to counterable');
});

// ======================= combat
await test('9. Combat: no attack into a blocker that wins the fight', async () => {
  const g = await table([{ battlefield: ['Grizzly Bears'] }, { battlefield: ['Hill Giant'] }]);
  ready(g, 0);
  decision({ state: 'AI has Grizzly Bears (2/2); the opponent has an untapped Hill Giant (3/3) at 40 life', legal: ['attack with Grizzly Bears', 'no attack'], expected: [], actual: attacks(g, 0),
    why: 'The Giant blocks and kills the Bears without dying; 2 damage to a player at 40 isn\'t worth a creature.' });
});
await test('10. Combat: attacking when nothing can block (and the damage is dealt by the real combat)', async () => {
  const g = await table([{ battlefield: ['Hill Giant'] }, { battlefield: ['Forest'] }]);
  ready(g, 0);
  decision({ state: 'AI has Hill Giant (3/3); the opponent has no creatures', legal: ['attack with Hill Giant', 'no attack'], expected: ['Hill Giant → P2'], actual: attacks(g, 0),
    why: 'Free damage: nothing can block, and the Giant isn\'t needed as a blocker against an empty board.' });
  const real = P(g, 0).agent.declareAttackers.bind(P(g, 0).agent);
  P(g, 0).agent.declareAttackers = real;
  await g.combat(P(g, 0)); await settle(g);
  eq(P(g, 1).life, 37, 'the real combat dealt 3');
});
await test('11. Combat: a legal chump block against a lethal attacker', async () => {
  const g = await table([{ battlefield: ['Hill Giant'] }, { battlefield: ['Grizzly Bears'], life: 3 }]);
  const blocks = await combat(g, 0, ['Hill Giant'], 1);
  decision({ state: 'AI at 3 life with Grizzly Bears; Hill Giant (3/3) attacks it', legal: ['block with Grizzly Bears', 'no block (dies)'], expected: ['Grizzly Bears blocks Hill Giant'], actual: blocks.map(x => `${nm(x.b)} blocks ${nm(x.a)}`),
    why: 'Not blocking loses the game; losing the Bears doesn\'t.' });
  ok(blocks.every(x => x.legal), 'the block was legal');
  eq([P(g, 1).lost, P(g, 1).life], [false, 3], 'it survived');
  noErrors(g);
});
await test('12. Combat: deathtouch: a 1/1 deathtouch blocker trades with a 6/6; no attack into deathtouch', async () => {
  const g = await table([{ battlefield: ['Colossal Dreadmaw'] }, { battlefield: ['Typhoid Rats', 'Grizzly Bears'] }]);
  const blocks = await combat(g, 0, ['Colossal Dreadmaw'], 1);
  decision({ state: 'Colossal Dreadmaw (6/6 trample) attacks; the AI has Typhoid Rats (1/1 deathtouch) and Grizzly Bears', legal: ['Rats block', 'Bears block', 'both block', 'no block'], expected: ['Typhoid Rats blocks Colossal Dreadmaw'], actual: blocks.map(x => `${nm(x.b)} blocks ${nm(x.a)}`),
    why: 'Deathtouch kills the Dreadmaw for a 1-mana creature; the Bears would die for nothing.' });
  eq([!!find(g, 0, 'Colossal Dreadmaw'), P(g, 1).life], [false, 35], 'the Dreadmaw died; 5 trample damage got through');
  const g2 = await table([{ battlefield: ['Hill Giant'] }, { battlefield: ['Typhoid Rats'] }]);
  ready(g2, 0);
  decision({ state: 'AI has Hill Giant (3/3); the opponent has Typhoid Rats (1/1 deathtouch)', legal: ['attack', 'no attack'], expected: [], actual: attacks(g2, 0),
    why: 'The Rats block and kill the Giant: a 4-mana creature for a 1-mana one.' });
  noErrors(g);
});
await test('13. Combat: first strike and double strike: a double striker attacks into a 1/1, which doesn\'t block it', async () => {
  const g = await table([{ battlefield: ['Boros Swiftblade'] }, { battlefield: ['Llanowar Elves'] }]);
  ready(g, 0);
  decision({ state: 'AI has Boros Swiftblade (1/2 double strike); the opponent has Llanowar Elves (1/1)', legal: ['attack', 'no attack'], expected: ['Boros Swiftblade → P2'], actual: attacks(g, 0),
    why: 'If the Elves block, first-strike damage kills them before they deal any: the attack is safe.' });
  const blocks = await combat(g, 0, ['Boros Swiftblade'], 1);
  decision({ state: 'Boros Swiftblade attacks; the AI defends with Llanowar Elves', legal: ['block', 'no block'], expected: [], actual: blocks.map(x => `${nm(x.b)} blocks ${nm(x.a)}`),
    why: 'The Elves would die in the first-strike step without dealing damage: the block only loses a creature.' });
  eq(P(g, 1).life, 38, 'two strikes of 1');
});
await test('14. Combat: flying, reach, menace and trample are respected', async () => {
  const g = await table([{ battlefield: ['Serra Angel', 'Sengir Vampire'] }, { battlefield: ['Grizzly Bears', 'Giant Spider'], life: 6 }]);
  const blocks = await combat(g, 0, ['Serra Angel', 'Sengir Vampire'], 1);
  ok(blocks.every(x => x.legal) && !blocks.some(x => nm(x.b) === 'Grizzly Bears'), `only reach can block flyers: ${blocks.map(x => nm(x.b))}`);
  decision({ state: 'Serra Angel (4/4 flying) and Sengir Vampire (4/4 flying) attack the AI at 6 life; it has Grizzly Bears and Giant Spider (2/4 reach)', legal: ['Spider blocks one flyer', 'no block'], expected: 1, actual: blocks.length,
    why: '8 damage would kill; the Spider (the only creature that can block a flyer) blocks one, and the AI lives at 2.' });
  eq(P(g, 1).lost, false, 'alive');
  const g2 = await table([{ battlefield: ['Professional Face-Breaker'] }, { battlefield: ['Grizzly Bears', 'Wall of Roots'], life: 2 }]);
  const b2 = await combat(g2, 0, ['Professional Face-Breaker'], 1);
  decision({ state: 'Professional Face-Breaker (2/3 menace) attacks the AI at 2 life; it has Grizzly Bears and Wall of Roots', legal: ['both block', 'no block'], expected: 2, actual: b2.length,
    why: 'Menace needs two blockers, and 2 damage is lethal: both block.' });
  eq(P(g2, 1).lost, false, 'alive');
  const g3 = await table([{ battlefield: ['Colossal Dreadmaw'] }, { battlefield: ['Wall of Omens'], life: 40 }]);
  await combat(g3, 0, ['Colossal Dreadmaw'], 1);
  eq(P(g3, 1).life, 38, 'trample: 2 of the 6 over the Wall\'s toughness of 4');
  noErrors(g); noErrors(g2); noErrors(g3);
});

// ======================= interaction
await test('15. Interaction: the AI counters a big threat cast by an opponent', async () => {
  const g = await table([{ battlefield: Array(6).fill('Mountain'), hand: ['Shivan Dragon'] }, { battlefield: ['Island', 'Island'], hand: ['Counterspell'] }]);
  await castBy(g, 0, 'Shivan Dragon');
  decision({ state: 'the opponent casts Shivan Dragon; the AI has Counterspell and UU open', legal: ['Counterspell', 'pass'], expected: 'countered', actual: find(g, 0, 'Shivan Dragon', 'graveyard') ? 'countered' : 'resolved',
    why: 'A 6-mana 5/5 flyer is a major threat and the AI has nothing else to save the counter for.' });
  noErrors(g);
});
await test('16. Interaction: the AI answers a triggered ability on the stack (Stifle, or protection)', async () => {
  const g = await table([{ battlefield: Array(4).fill('Swamp'), hand: ['Ravenous Chupacabra'] }, { battlefield: ['Island', 'Shivan Dragon'], hand: ['Stifle'] }]);
  await castBy(g, 0, 'Ravenous Chupacabra');
  decision({ state: 'the opponent\'s Ravenous Chupacabra enters, its trigger aimed at the AI\'s Shivan Dragon; the AI holds Stifle', legal: ['Stifle the trigger', 'pass'], expected: 'Dragon kept', actual: find(g, 1, 'Shivan Dragon') ? 'Dragon kept' : 'Dragon destroyed',
    why: 'Countering the trigger saves the AI\'s best creature for one mana.' });
  ok(lines(g).some(l => /Stifle targeting Ravenous Chupacabra/.test(l)), 'Stifle was cast at the trigger');
  const g2 = await table([{ battlefield: Array(4).fill('Swamp'), hand: ['Ravenous Chupacabra'] }, { battlefield: ['Forest', 'Shivan Dragon'], hand: ['Tamiyo\'s Safekeeping'] }]);
  await castBy(g2, 0, 'Ravenous Chupacabra');
  eq(!!find(g2, 1, 'Shivan Dragon'), true, 'protected with Tamiyo\'s Safekeeping instead');
  noErrors(g); noErrors(g2);
});
await test('17. Interaction: the AI passes priority on a spell not worth answering', async () => {
  const g = await table([{ battlefield: ['Forest', 'Forest'], hand: ['Grizzly Bears'] }, { battlefield: ['Island', 'Island'], hand: ['Counterspell'] }]);
  const asked = [];
  const real = P(g, 1).agent.respondAt.bind(P(g, 1).agent);
  P(g, 1).agent.respondAt = (gg, qq, it) => { const r = real(gg, qq, it); asked.push(r ? 'acts' : 'passes'); return r; };
  await castBy(g, 0, 'Grizzly Bears');
  decision({ state: 'the opponent casts Grizzly Bears; the AI holds Counterspell', legal: ['Counterspell', 'pass'], expected: ['passes'], actual: asked,
    why: 'A 2/2 isn\'t worth a counterspell; keeping it for a real threat is better.' });
  eq([!!find(g, 0, 'Grizzly Bears'), !!find(g, 1, 'Counterspell', 'hand')], [true, true], 'the Bears resolved and the counter was kept');
});
await test('18. Interaction: no counterspell at a spell that can\'t be countered', async () => {
  for (const [label, seats, setupFn] of [
    ['next spell can\'t be countered', [{ battlefield: Array(6).fill('Mountain'), hand: ['Shivan Dragon'] }, { battlefield: ['Island', 'Island'], hand: ['Counterspell'] }], g => { P(g, 0).uncounterTurn = g.turn; }],
    ['paid with Cavern of Souls', [{ battlefield: [...Array(5).fill('Mountain'), 'Cavern of Souls'], hand: ['Shivan Dragon'] }, { battlefield: ['Island', 'Island'], hand: ['Counterspell'] }], () => {}],
  ]) {
    const g = await table(seats);
    setupFn(g);
    await castBy(g, 0, 'Shivan Dragon');
    decision({ state: `the opponent casts Shivan Dragon (${label}); the AI holds Counterspell`, legal: ['pass (Counterspell would do nothing)'], expected: 'Counterspell kept', actual: find(g, 1, 'Counterspell', 'hand') ? 'Counterspell kept' : 'Counterspell wasted',
      why: 'The spell can\'t be countered: casting Counterspell would only lose a card.' });
    ok(find(g, 0, 'Shivan Dragon'), 'the Dragon resolved');
  }
  // (rules 18 wasted it)
  const g18 = await table([{ battlefield: Array(6).fill('Mountain'), hand: ['Shivan Dragon'] }, { battlefield: ['Island', 'Island'], hand: ['Counterspell'] }], { rules: 18 });
  P(g18, 0).uncounterTurn = g18.turn;
  await castBy(g18, 0, 'Shivan Dragon');
  ok(find(g18, 1, 'Counterspell', 'graveyard'), 'rules 18 still casts it (old replays)');
});
await test('19. Interaction: no removal in response at a target its words forbid; a legal target is answered', async () => {
  const g = await table([{ battlefield: ['Forest', 'Typhoid Rats'], hand: ['Giant Growth'] }, { battlefield: ['Swamp', 'Swamp'], hand: ['Doom Blade'] }]);
  await castBy(g, 0, 'Giant Growth', { targets: [{ obj: find(g, 0, 'Typhoid Rats') }] });
  decision({ state: 'the opponent pumps its Typhoid Rats (black) with Giant Growth; the AI holds Doom Blade', legal: ['pass (Doom Blade can\'t target black creatures)'], expected: 'Doom Blade kept', actual: find(g, 1, 'Doom Blade', 'hand') ? 'Doom Blade kept' : 'Doom Blade used',
    why: 'The Rats are black: Doom Blade has no legal target.' });
  ok(!lines(g).some(l => /can't be cast/.test(l)), 'no refused cast either');
  const g2 = await table([{ battlefield: ['Forest', 'Shivan Dragon'], hand: ['Giant Growth'] }, { battlefield: ['Swamp', 'Swamp'], hand: ['Doom Blade'] }]);
  await castBy(g2, 0, 'Giant Growth', { targets: [{ obj: find(g2, 0, 'Shivan Dragon') }] });
  eq(!!find(g2, 0, 'Shivan Dragon', 'graveyard'), true, 'a nonblack Dragon being pumped is killed in response');
  // a creature already being removed isn't answered twice
  const g3 = await table([{ battlefield: ['Swamp', 'Swamp', 'Swamp'], hand: ['Murder'] }, { battlefield: ['Shivan Dragon', 'Hill Giant'], hand: ['Murder'] }, { battlefield: ['Island'] }]);
  g3.stack.push({ o: find(g3, 1, 'Murder', 'hand'), p: P(g3, 2), targets: [{ obj: find(g3, 1, 'Shivan Dragon') }], effects: card('Murder').fx.spell, ability: false });
  decision({ state: 'a Murder aimed at P2\'s Shivan Dragon is already on the stack; the AI chooses a target for its own Murder', legal: ['Shivan Dragon', 'Hill Giant'], expected: 'Hill Giant', actual: nm(target(g3, 0, 'Murder')?.obj),
    why: 'The Dragon is already going; a second removal on it would be wasted.' });
  noErrors(g); noErrors(g2);
});

// ======================= combos and multiplayer
await test('20. Combos: an executable combo is played out with the real cards and wins', async () => {
  const g = await table([{ battlefield: ['Island', 'Island', 'Swamp'], hand: ['Thassa\'s Oracle', 'Demonic Consultation'] }, {}]);
  const best = play(g, 0);
  decision({ state: 'UUB open; hand Thassa\'s Oracle and Demonic Consultation', legal: options(best).concat(['the combo']), expected: 'combo', actual: best?.s >= 500 ? 'combo' : best?.why,
    why: 'Consultation exiles the library, then the Oracle\'s trigger wins: every piece is in hand and paid for.' });
  await P(g, 0).agent.mainPhase(g, P(g, 0), 'main1'); await settle(g);
  eq([g.over, g.winner?.idx], [true, 0], 'won through the cards themselves');
  ok(lines(g).some(l => /casts Demonic Consultation/.test(l)) && lines(g).some(l => /casts Thassa's Oracle/.test(l)), 'both cards were cast');
});
await test('21. Combos: not started when a prerequisite is missing (mana for the second piece)', async () => {
  const g = await table([{ battlefield: ['Swamp', 'Island'], hand: ['Thassa\'s Oracle', 'Demonic Consultation'] }, {}]);
  await P(g, 0).agent.mainPhase(g, P(g, 0), 'main1'); await settle(g);
  decision({ state: 'only Swamp + Island; hand Thassa\'s Oracle ({U}{U}) and Demonic Consultation ({B})', legal: ['cast Consultation alone (exiles the library, no win)', 'wait'], expected: [false, 10], actual: [g.over, P(g, 0).library.length],
    why: 'Without UU after Consultation the Oracle can\'t follow: casting Consultation would exile the AI\'s own library for nothing.' });
});
await test('22. Win: the AI takes a lethal line over a strong play', async () => {
  const g = await table([{ battlefield: Array(7).fill('Mountain'), hand: ['Lightning Bolt', 'Shivan Dragon'] }, { life: 3, battlefield: ['Giant Spider'] }]);
  const best = play(g, 0);
  decision({ state: 'seven Mountains; hand Lightning Bolt and Shivan Dragon; the opponent is at 3 life', legal: options(best), expected: 'casts Lightning Bolt', actual: best?.why,
    why: 'Bolt to the face wins now; the Dragon only wins later.' });
  await best.run(); await settle(g);
  eq([g.over, g.winner?.idx], [true, 0], 'won');
});
await test('23. Multiplayer: each opponent judged on their own board (who to attack, whose creature to remove)', async () => {
  const g = await table([{ battlefield: ['Hill Giant'] }, { life: 3 }, { life: 40 }]);
  ready(g, 0);
  decision({ state: 'AI has Hill Giant; P2 is at 3 life, P3 at 40, neither has creatures', legal: ['attack P2', 'attack P3', 'no attack'], expected: ['Hill Giant → P2'], actual: attacks(g, 0),
    why: 'Three damage eliminates P2: one fewer opponent.' });
  const g2 = await table([{ battlefield: ['Swamp', 'Swamp', 'Swamp', 'Wall of Roots'], hand: ['Murder'], life: 5 }, { battlefield: ['Colossal Dreadmaw', 'Sol Ring', 'Rhystic Study'] }, { battlefield: ['Shivan Dragon'] }, { battlefield: ['Grizzly Bears'] }]);
  const a = P(g2, 0).agent;
  eq([1, 2, 3].map(i => a.nextAttackOn(g2, P(g2, 0), P(g2, i))), [1, 5, 0], 'each opponent\'s next attack on the AI, worked out separately');
  decision({ state: 'four players; the AI at 5 life with Wall of Roots; P2 Dreadmaw and engines, P3 Shivan Dragon, P4 Grizzly Bears (the Wall stops it)', legal: legalTargets(g2, 0, 'Murder'), expected: 'Shivan Dragon', actual: nm(target(g2, 0, 'Murder')?.obj),
    why: 'Only P3 can kill the AI next turn, whichever seat they sit in.' });
});
await test('24. Commander: commander damage is counted per commander: block at 18, not at 0', async () => {
  const g = await table([{ commander: 'Krenko, Mob Boss' }, { battlefield: ['Grizzly Bears'] }]);
  const k = find(g, 0, 'Krenko, Mob Boss');
  P(g, 1).cmdDamage[k.iid] = 18;
  ready(g, 0);
  decision({ state: 'Krenko (3/3 commander) attacks; the AI at 40 life has taken 18 commander damage from it; it has Grizzly Bears', legal: ['block', 'no block'], expected: ['Grizzly Bears'], actual: blocksOf(g, 1, attacking(g, 0, ['Krenko, Mob Boss'], 1)).map(x => nm(x.b)),
    why: '3 more from the same commander is 21: the AI loses at 40 life unless it blocks.' });
  const g2 = await table([{ commander: 'Krenko, Mob Boss' }, { battlefield: ['Grizzly Bears'] }]);
  ready(g2, 0);
  decision({ state: 'the same attack with no commander damage taken yet', legal: ['block', 'no block'], expected: [], actual: blocksOf(g2, 1, attacking(g2, 0, ['Krenko, Mob Boss'], 1)).map(x => nm(x.b)),
    why: '3 damage at 40 life isn\'t worth a creature that dies without killing the 3/3.' });
  // noncombat damage from a commander adds nothing
  g2.damagePlayer(P(g2, 1), 20, find(g2, 0, 'Krenko, Mob Boss'), false);
  eq(P(g2, 1).cmdDamage[k.iid] ?? 0, 0, 'noncombat damage is not commander damage');
});

// ======================= reliability
await test('25. Reliability: look-ahead plays on a copy; the real game is unchanged and its dice are untouched', async () => {
  const mk = () => table([{ battlefield: ['Forest', 'Forest', 'Mountain', 'Mountain', 'Grizzly Bears'], hand: ['Hill Giant', 'Lightning Bolt', 'Llanowar Elves'] }, { battlefield: ['Giant Spider', 'Forest'], hand: ['Giant Growth'] }]);
  const g = await mk(), h = await mk();
  P(g, 0).agent = new Agent('balanced', { lookahead: true });
  const before = stateKey(g);
  const best = await lookAheadPlay(P(g, 0).agent, g, P(g, 0), 'main1');
  ok(best, 'the look-ahead made a choice');
  eq(stateKey(g), before, 'the real game after the look-ahead');
  eq([g.rand(), g.rand()], [h.rand(), h.rand()], 'the game\'s random numbers are where they were');
  ok(await best.run(), 'the choice is legal in the real game');
});
await test('26. Reliability: no decision reads hidden cards (opponents\' hands and libraries changed: the same choices)', async () => {
  const mk = async hidden => {
    const g = await table([{ battlefield: ['Swamp', 'Swamp', 'Swamp', 'Island', 'Island', 'Wall of Roots'], hand: ['Murder', 'Counterspell', 'Grizzly Bears'], life: 5 }, { battlefield: ['Shivan Dragon'], hand: hidden }, { battlefield: ['Colossal Dreadmaw'], hand: hidden }]);
    ready(g, 1);
    return g;
  };
  const a = await mk(['Lightning Bolt', 'Counterspell', 'Fog']), b = await mk(['Grizzly Bears', 'Forest']);
  const pick = async g => {
    const p0 = P(g, 0), ag = p0.agent;
    return { play: ag.bestPlay(g, p0, 'main1')?.why, murder: nm(target(g, 0, 'Murder')?.obj), blocks: blocksOf(g, 0, attacking(g, 2, ['Colossal Dreadmaw'], 0)).map(x => nm(x.b)) };
  };
  eq(await pick(a), await pick(b), 'the same decisions whatever the hidden cards are');
});
await test('27. Reliability: an action the engine keeps refusing ends the phase after three tries, not in a loop', async () => {
  const g = await table([{ battlefield: Array(6).fill('Forest'), hand: ['Grizzly Bears', 'Llanowar Elves', 'Giant Spider'] }, {}]);
  let tries = 0;
  g.cast = async () => { tries++; return false; };
  const t0 = Date.now();
  await P(g, 0).agent.mainPhase(g, P(g, 0), 'main1');
  eq(tries, 3, 'attempts');
  ok(Date.now() - t0 < 2000, 'finished quickly');
});
await test('28. Reliability: decisions on a 240-permanent, four-player board stay fast', async () => {
  const big = [...Array(40).fill('Grizzly Bears'), ...Array(20).fill('Forest')];
  const g = await table([{ battlefield: big, hand: ['Hill Giant', 'Murder', 'Lightning Bolt'] }, { battlefield: big }, { battlefield: big }, { battlefield: big }]);
  for (const q of g.players) ready(g, q.idx);
  const time = fn => { const t = Date.now(); const r = fn(); return [r, Date.now() - t]; };
  const [atk, ta] = time(() => P(g, 0).agent.declareAttackers(g, P(g, 0)));
  const [, tp] = time(() => P(g, 0).agent.bestPlay(g, P(g, 0), 'main1'));
  const [, tt] = time(() => target(g, 0, 'Murder'));
  const ats = P(g, 0).battlefield.filter(o => o.fx.type.creature).slice(0, 10);
  ats.forEach(o => { o.attacking = 1; });
  const [, tb] = time(() => blocksOf(g, 1, ats));
  ok(Array.isArray(atk), 'attacks chosen');
  ok(ta + tp + tt + tb < 4000, `attack ${ta} ms, play ${tp} ms, target ${tt} ms, blocks ${tb} ms`);
});
await test('29. Reliability: after a refused action the AI picks again and makes its other plays', async () => {
  const run = async rules => {
    const g = await table([{ battlefield: [...Array(4).fill('Mountain'), 'Forest', 'Forest'], hand: ['Hill Giant', 'Grizzly Bears'] }, {}], { rules });
    const real = g.cast.bind(g);
    let refused = 0;
    g.cast = async (p, o, c) => { if (o.card.name === 'Hill Giant') { refused++; return false; } return real(p, o, c); };
    await P(g, 0).agent.mainPhase(g, P(g, 0), 'main1');
    return [refused, P(g, 0).battlefield.filter(o => !o.fx.type.land).map(nm)];
  };
  decision({ state: 'six lands; hand Hill Giant and Grizzly Bears; the engine refuses Hill Giant', legal: ['Grizzly Bears'], expected: [1, ['Grizzly Bears']], actual: await run(RULES),
    why: 'One refused play shouldn\'t end the turn: Grizzly Bears can still be cast.' });
  eq(await run(18), [1, []], 'rules 18 (old replays) stopped there');
});
await test('30. Difficulty: Beginner plays worse than Strong, with the same rules, mana and cards', async () => {
  const mk = async (strength, seed) => {
    const g = await table([{ battlefield: Array(7).fill('Mountain'), hand: ['Lightning Bolt', 'Shivan Dragon', 'Hill Giant'] }, { life: 3, battlefield: ['Giant Spider'] }], { seed });
    P(g, 0).agent = Object.assign(new Agent('balanced', { noise: strength.noise }), { handicap: strength.handicap });
    return g;
  };
  const counts = { strong: { lethal: 0, legal: 0 }, beginner: { lethal: 0, legal: 0 } };
  for (const [name, s] of [['strong', { noise: 0, handicap: 0 }], ['beginner', { noise: 0.35, handicap: 1 }]]) {
    for (let seed = 1; seed <= 12; seed++) {
      const g = await mk(s, seed);
      const before = { life: P(g, 0).life, hand: P(g, 0).hand.length, mana: g.availableMana(P(g, 0)), lib: P(g, 0).library.length };
      const best = play(g, 0);
      eq({ life: P(g, 0).life, hand: P(g, 0).hand.length, mana: g.availableMana(P(g, 0)), lib: P(g, 0).library.length }, before, 'deciding changes nothing');
      if (!best) { counts[name].legal++; continue; }
      if (best.why === 'casts Lightning Bolt') counts[name].lethal++;
      ok(await best.run(), `${name}: the engine accepted ${best.why}`);
      counts[name].legal++;
    }
  }
  decision({ state: 'the lethal-Bolt board from test 22, decided 12 times by each strength', legal: ['Lightning Bolt (wins)', 'Shivan Dragon', 'Hill Giant', 'stop'], expected: { strong: 12, beginnerBelow: true, allLegal: true },
    actual: { strong: counts.strong.lethal, beginnerBelow: counts.beginner.lethal < 12, allLegal: counts.strong.legal === 12 && counts.beginner.legal === 12 },
    why: `Strong finds the win every time; Beginner sometimes plays something else or stops (found it ${counts.beginner.lethal} of 12). Both only ever make legal plays.` });
});

for (const [name, e] of results) console.log(`${e ? 'FAIL' : 'ok  '}  ${name}${e ? `\n        ${e.message}` : ''}`);
const bad = results.filter(r => r[1]).length;
console.log(`AI decisions: ${results.length} tests, ${results.length - bad} passed, ${bad} failed (${decisions.length} decisions recorded).`);
if (reportFile) {
  const cell = v => String(typeof v === 'string' ? v : JSON.stringify(v)).replace(/\|/g, '\\|');
  const md = ['# AI decisions (Phase 2K, rules 19)', '', `Written by \`node tests/ai.mjs --report ${reportFile}\`. Each row is one decision on a known board: the plays that were legal, the play a competent player would make, what the AI chose, and why the expected play is better.`, '',
    '| Test | Board | Legal plays | Expected | Actual | Why |', '|---|---|---|---|---|---|',
    ...decisions.map(d => `| ${cell(d.test.split('.')[0])} | ${cell(d.state)} | ${cell((d.legal || []).join('; '))} | ${cell(d.expected)} | ${cell(d.actual)} | ${cell(d.why)} |`), ''];
  writeFileSync(reportFile, md.join('\n'));
  console.log(`Report: ${reportFile}`);
}
process.exit(bad ? 1 : 0);
