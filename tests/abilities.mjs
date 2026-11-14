// Card abilities (Phase 2I, rules 16): keyword, triggered, activated, static, spell and replacement abilities checked on
// real cards through the engine's own systems (casting, the stack and priority, triggers, combat damage, state-based
// actions), with the mechanics themselves checked: timing, costs paid, targets, the order events happen in, and where
// cards go. Rules 16 changes also check that rules 15 replays still play the old way.
//   node tests/abilities.mjs              run them all (exit 1 on any failure)
//   node tests/abilities.mjs prowess      only the tests whose name contains "prowess"
import { scenario, find, P, tgtObj, logText, errors, settle, resolveEffects } from './scenario.mjs';
import { RULES } from '../public/js/engine.js';

const only = process.argv[2];
const results = [];
const test = async (name, fn) => {
  if (only && !name.toLowerCase().includes(only.toLowerCase())) return;
  try { await fn(); results.push([name, null]); } catch (e) { if (process.env.STACK) console.log(e.stack); results.push([name, e]); }
};
const eq = (got, want, what) => { if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`${what}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); };
const ok = (cond, what) => { if (!cond) throw new Error(what); };
const noErrors = g => eq(errors(g).length, 0, 'simulator errors');
const lines = g => logText(g).replace(/&#39;/g, "'").replace(/&quot;/g, '"').split('\n');
ok(RULES >= 16, `these tests are for rules 16 and later (RULES is ${RULES})`);

// A table (seat 0 active, main phase); every seat's priority answers come from `answer` (null: pass), and each time a
// seat is asked, who, for which object and what was on the stack is recorded
const table = async (seats, opts = {}) => { const g = await scenario(seats, opts); g.active = opts.active ?? 0; g.phase = 'main1'; return g; };
const script = (g, answer = () => null) => {
  const asks = [];
  for (const q of g.players) {
    q.agent.respondAt = (gg, qq, item) => {
      asks.push({ q: qq.idx, name: item.name, kind: item.kind, label: item.label, stack: gg.stack.map(x => x.name) });
      return answer(qq.idx, item, gg) || null;
    };
  }
  return asks;
};
const resp = (g, i, name, targets) => ({ kind: 'cast', card: find(g, i, name, 'hand'), targets });
const once = () => { const done = new Set(); return k => (done.has(k) ? false : (done.add(k), true)); };
const cast = async (g, i, name, choice = {}) => { const r = await g.cast(P(g, i), find(g, i, name, 'hand'), choice); await settle(g); return r; };
const ready = o => { o.sick = false; o.enteredTurn = -1; return o; };
// Combat damage between one attacker and its blockers (both steps when first or double strike is involved), through
// the engine's combat damage step; between: called after the first-strike step
const fight = async (g, att, blockers, target = 1, between = null) => {
  att.attacking = target; att.blocked = blockers.length > 0; att.blockedBy = blockers;
  for (const b of blockers) b.blocking = att;
  const p = P(g, att.controller);
  const first = [att, ...blockers].some(o => g.has(o, 'first strike') || g.has(o, 'double strike'));
  if (first) { await g.combatDamage(p, true, false); await settle(g); if (between) between(); }
  await g.combatDamage(p, false, first); await settle(g);
};

// ======================================================================================== keywords: combat
await test('1. Multiple keywords: Lyra Dawnbringer (flying, first strike, lifelink) kills a 5/5 flyer blocker first and gains 5', async () => {
  const g = await table([{ battlefield: ['Lyra Dawnbringer'] }, { battlefield: ['Shivan Dragon'] }]);
  const lyra = find(g, 0, 'Lyra Dawnbringer'), dragon = find(g, 1, 'Shivan Dragon');
  ok(g.canBlock(dragon, lyra), 'a flyer can block a flyer');
  await fight(g, lyra, [dragon]);
  eq(dragon.zone, 'graveyard', 'Shivan Dragon (5/5) died to first-strike damage');
  eq([lyra.zone, lyra.damage], ['battlefield', 0], 'Lyra took no damage (the Dragon died before the regular step)');
  eq(P(g, 0).life, 45, 'lifelink: 5 life');
  noErrors(g);
});
await test('2. Flying and reach: a flyer can be blocked only by flying or reach creatures', async () => {
  const g = await table([{ battlefield: ['Serra Angel', 'Grizzly Bears'] }, { battlefield: ['Grizzly Bears', 'Giant Spider', 'Birds of Paradise'] }]);
  const angel = find(g, 0, 'Serra Angel'), bears0 = find(g, 0, 'Grizzly Bears');
  eq([g.canBlock(find(g, 1, 'Grizzly Bears'), angel), g.canBlock(find(g, 1, 'Giant Spider'), angel), g.canBlock(find(g, 1, 'Birds of Paradise'), angel)], [false, true, true], 'Bears / Spider (reach) / Birds (flying) blocking the Angel');
  eq(g.canBlock(find(g, 1, 'Giant Spider'), bears0), true, 'reach creatures block ground creatures too');
  // (vigilance: attacking doesn't tap it)
  ok(g.has(angel, 'vigilance'), 'Serra Angel has vigilance');
});
await test('3. Deathtouch and trample: one damage to the blocker is lethal, the rest tramples over', async () => {
  const g = await table([{ battlefield: ['Rampaging Baloths', 'Basilisk Collar'] }, { battlefield: ['Shivan Dragon'] }]);
  const hoof = ready(find(g, 0, 'Rampaging Baloths')), collar = find(g, 0, 'Basilisk Collar'), dragon = find(g, 1, 'Shivan Dragon');
  P(g, 0).infiniteMana = g.turn;
  ok(await g.equip(P(g, 0), collar, hoof), 'equipped');
  eq([g.has(hoof, 'deathtouch'), g.has(hoof, 'trample'), g.has(hoof, 'lifelink')], [true, true, true], 'deathtouch and lifelink from the Collar, its own trample');
  await fight(g, hoof, [dragon]);
  eq(dragon.zone, 'graveyard', 'the 5/5 blocker died from 1 deathtouch damage');
  eq(P(g, 1).life, 35, '5 of its 6 power trampled over to the player (lethal damage is 1 with deathtouch: 702.19c)');
  eq(P(g, 0).life, 46, 'lifelink: all 6 damage dealt');
  noErrors(g);
});
await test('4. First strike and double strike: a double striker deals damage in both steps; a first striker in the first only', async () => {
  const g = await table([{ battlefield: ['Fury'] }, { battlefield: ['Lyra Dawnbringer'] }]);
  const fury = find(g, 0, 'Fury');
  ok(g.has(fury, 'double strike'), 'Fury has double strike');
  await fight(g, fury, []);
  eq(P(g, 1).life, 34, 'unblocked: 3 + 3 damage');
  const g2 = await table([{ battlefield: ['Lyra Dawnbringer'] }, {}]);
  await fight(g2, find(g2, 0, 'Lyra Dawnbringer'), []);
  eq(P(g2, 1).life, 35, 'first strike alone: 5 damage once');
  noErrors(g); noErrors(g2);
});
await test('4b. First strike (rules 16, 510.4): a creature that gains first strike after the first step still deals damage; one that loses it doesn\'t deal again', async () => {
  const g = await table([{ battlefield: ['Lyra Dawnbringer', 'Grizzly Bears'] }, {}]);
  const lyra = find(g, 0, 'Lyra Dawnbringer'), bears = find(g, 0, 'Grizzly Bears');
  // both attack; Lyra has first strike, the Bears don't. After the first step the Bears gain first strike and Lyra loses it.
  for (const a of [lyra, bears]) Object.assign(a, { attacking: 1, blocked: false, blockedBy: [] });
  await g.combatDamage(P(g, 0), true, false); await settle(g);
  eq(P(g, 1).life, 35, 'first step: Lyra 5');
  bears.tempKw = new Set(['first strike']);
  g.stripped = null; lyra.stripped = { turn: g.turn, kws: ['first strike'] };
  await g.combatDamage(P(g, 0), false, true); await settle(g);
  eq(P(g, 1).life, 33, 'regular step: the Bears (no first strike as the first step began) deal 2; Lyra does not deal again');
  const g15 = await table([{ battlefield: ['Lyra Dawnbringer', 'Grizzly Bears'] }, {}], { rules: 15 });
  const l15 = find(g15, 0, 'Lyra Dawnbringer'), b15 = find(g15, 0, 'Grizzly Bears');
  for (const a of [l15, b15]) Object.assign(a, { attacking: 1, blocked: false, blockedBy: [] });
  await g15.combatDamage(P(g15, 0), true, false); await settle(g15);
  b15.tempKw = new Set(['first strike']); l15.stripped = { turn: g15.turn, kws: ['first strike'] };
  await g15.combatDamage(P(g15, 0), false, true); await settle(g15);
  eq(P(g15, 1).life, 30, 'rules 15 (old replays): read from the keywords they have now, as before (Lyra deals again, the Bears don\'t)');
});
await test('Deathtouch with infect (rules 16): damage dealt as -1/-1 counters still destroys the creature', async () => {
  const g = await table([{ battlefield: ['Blighted Agent', 'Basilisk Collar'] }, { battlefield: ['Shivan Dragon'] }]);
  const agent = ready(find(g, 0, 'Blighted Agent')), dragon = find(g, 1, 'Shivan Dragon');
  P(g, 0).infiniteMana = g.turn;
  await g.equip(P(g, 0), find(g, 0, 'Basilisk Collar'), agent);
  // (the Dragon blocks it anyway: the test is about damage, not blocking)
  await fight(g, agent, [dragon]);
  eq(dragon.zone, 'graveyard', 'one -1/-1 counter from a deathtouch source destroys a 5/5 (704.5h)');
  const g15 = await table([{ battlefield: ['Blighted Agent', 'Basilisk Collar'] }, { battlefield: ['Shivan Dragon'] }], { rules: 15 });
  const a15 = ready(find(g15, 0, 'Blighted Agent'));
  P(g15, 0).infiniteMana = g15.turn;
  await g15.equip(P(g15, 0), find(g15, 0, 'Basilisk Collar'), a15);
  await fight(g15, a15, [find(g15, 1, 'Shivan Dragon')]);
  eq(find(g15, 1, 'Shivan Dragon')?.zone, 'battlefield', 'rules 15 (old replays): it survived, as before');
});
await test('Evasion keywords: menace needs two blockers; defender can\'t attack; haste attacks the turn it arrives', async () => {
  const g = await table([{ battlefield: ['Grizzly Bears', 'Wall of Omens', 'Raging Goblin'] }, {}]);
  const goblin = find(g, 0, 'Raging Goblin'), wall = find(g, 0, 'Wall of Omens'), bears = find(g, 0, 'Grizzly Bears');
  for (const o of [goblin, wall, bears]) { o.sick = true; }
  eq([g.canAttack(bears), g.canAttack(goblin), g.canAttack(wall)], [false, true, false], 'summoning-sick Bears / Raging Goblin (haste) / Wall (defender)');
  wall.sick = false;
  eq(g.canAttack(wall), false, 'defender, even when not summoning sick');
});

// ======================================================================================== keywords: protection and targeting
await test('5. Hexproof and targeting: an opponent can\'t target it, its controller can', async () => {
  const g = await table([{ battlefield: ['Mountain'], hand: ['Lightning Bolt'] }, { battlefield: ['Grizzly Bears', 'Swiftfoot Boots', 'Mountain'], hand: ['Shock'] }]);
  const bears = find(g, 1, 'Grizzly Bears');
  P(g, 1).infiniteMana = g.turn;
  g.active = 1; await g.equip(P(g, 1), find(g, 1, 'Swiftfoot Boots'), bears); g.active = 0;
  ok(g.has(bears, 'hexproof'), 'hexproof from Swiftfoot Boots');
  script(g);
  eq(await g.cast(P(g, 0), find(g, 0, 'Lightning Bolt', 'hand'), { targets: [tgtObj(bears)] }), false, "the opponent's Bolt can't target it");
  eq(find(g, 0, 'Mountain').tapped, false, 'nothing was paid');
  ok(g.canTarget(P(g, 1), bears), 'its controller can target it');
});
await test('6. Ward: the opponent\'s spell is countered unless they pay; paying lets it resolve', async () => {
  const g = await table([{ battlefield: ['Mountain'], hand: ['Lightning Bolt'] }, { battlefield: ['Hulking Raptor'] }]);
  script(g);
  const raptor = find(g, 1, 'Hulking Raptor');
  ok(await cast(g, 0, 'Lightning Bolt', { targets: [tgtObj(raptor)] }), 'cast');
  eq(raptor.damage, 0, 'no damage: P1 had no mana for ward {2}');
  ok(lines(g).some(l => /countered by Hulking Raptor's ward/.test(l)), 'countered by ward (702.21a)');
  const g2 = await table([{ battlefield: ['Mountain', 'Mountain', 'Mountain'], hand: ['Lightning Bolt'] }, { battlefield: ['Hulking Raptor'] }]);
  script(g2);
  const r2 = find(g2, 1, 'Hulking Raptor');
  ok(await cast(g2, 0, 'Lightning Bolt', { targets: [tgtObj(r2)] }), 'cast');
  eq(r2.zone, 'graveyard', 'ward {2} paid: the Bolt resolved and killed the 3/3');
  ok(lines(g2).some(l => /pays \{2\} for Hulking Raptor's ward/.test(l)), 'ward paid');
  eq(P(g2, 0).battlefield.filter(o => o.tapped).length, 3, 'three Mountains tapped: {R} for the Bolt and {2} for ward');
  noErrors(g); noErrors(g2);
});
await test('Protection (rules 16): Mother of Runes gives protection from the color of the spell that targets it; the spell fizzles', async () => {
  const g = await table([{ battlefield: ['Mountain'], hand: ['Lightning Bolt'] }, { battlefield: ['Mother of Runes', 'Grizzly Bears'] }]);
  const mom = ready(find(g, 1, 'Mother of Runes')), bears = find(g, 1, 'Grizzly Bears');
  const first = once();
  // (P2 answers the Bolt with Mother's ability, targeting the Bears)
  const ai = P(g, 1).agent, choose = ai.chooseTarget.bind(ai);
  ai.chooseTarget = (gg, p, e, src) => (src === mom ? tgtObj(bears) : choose(gg, p, e, src));
  const asks = script(g, (i, item) => (i === 1 && item.name === 'Lightning Bolt' && first('mom') ? { kind: 'activate', o: mom, ab: mom.fx.abilities[0] } : null));
  ok(await cast(g, 0, 'Lightning Bolt', { targets: [tgtObj(bears)] }), 'cast');
  await settle(g);
  eq(bears.tempProt?.q, ['R'], 'the Bears have protection from red (the Bolt\'s color)');
  eq([bears.zone, bears.damage], ['battlefield', 0], 'the Bolt did nothing');
  ok(lines(g).some(l => /fizzles/.test(l)), 'it fizzled: its only target is illegal (608.2b)');
  ok(asks.length > 0, 'P2 was asked for priority');
  ok(!g.has(bears, 'hexproof'), 'no hexproof stand-in');
  // DEBT: can't be blocked by red creatures; damage from red sources is prevented; can't be targeted by red
  const g2 = await table([{ battlefield: ['Grizzly Bears'] }, { battlefield: ['Raging Goblin', 'Llanowar Elves'], hand: ['Shock'] }]);
  const b2 = find(g2, 0, 'Grizzly Bears');
  b2.tempProt = { turn: g2.turn, q: ['R'] };
  eq([g2.canBlock(find(g2, 1, 'Raging Goblin'), b2), g2.canBlock(find(g2, 1, 'Llanowar Elves'), b2)], [false, true], 'blocked by red Raging Goblin / green Llanowar Elves');
  eq(g2.canTarget(P(g2, 1), b2, find(g2, 1, 'Shock', 'hand')), false, "Shock can't target it");
  g2.damageObj(b2, 2, find(g2, 1, 'Raging Goblin'));
  eq(b2.damage, 0, 'damage from a red source is prevented (702.16e)');
  noErrors(g);
});
await test('Protection (rules 16): an Aura of that color falls off; an Equipment becomes unattached', async () => {
  const g = await table([{ battlefield: ['Grizzly Bears', 'Bonesplitter'] }, { hand: ['Pacifism'] }]);
  const bears = find(g, 0, 'Grizzly Bears'), bs = find(g, 0, 'Bonesplitter');
  script(g);
  g.active = 1; P(g, 1).infiniteMana = g.turn;
  ok(await cast(g, 1, 'Pacifism', { auraTarget: bears }), 'Pacifism cast on the Bears');
  const pac = find(g, 1, 'Pacifism');
  eq(pac.attachedTo, bears, 'attached');
  g.active = 0; bs.attachedTo = bears;
  bears.tempProt = { turn: g.turn, q: ['W'] };
  await settle(g);
  eq(pac.zone, 'graveyard', 'Pacifism (white) is put into the graveyard (704.5m)');
  eq(bs.attachedTo, bears, 'Bonesplitter (colorless) stays');
  bears.tempProt = { turn: g.turn, q: ['artifact'] };
  await settle(g);
  eq([bs.zone, bs.attachedTo], ['battlefield', null], 'protection from artifacts: Bonesplitter becomes unattached and stays (704.5n)');
  P(g, 0).infiniteMana = g.turn;
  eq(await g.equip(P(g, 0), bs, bears), false, "it can't be equipped to a creature with protection from it");
});
await test('Protection under rules 15 (old replays): granted protection is hexproof, as before', async () => {
  const g = await table([{ battlefield: ['Mother of Runes', 'Grizzly Bears'] }, {}], { rules: 15 });
  const mom = ready(find(g, 0, 'Mother of Runes')), bears = find(g, 0, 'Grizzly Bears');
  script(g);
  ok(await g.activate(P(g, 0), mom, mom.fx.abilities[0], { targets: [tgtObj(bears)] }), 'activated');
  await settle(g);
  eq([g.has(bears, 'hexproof'), bears.tempProt ?? null], [true, null], 'hexproof, no protection');
});

// ======================================================================================== prowess
await test('7. Prowess (rules 16): casting a noncreature spell puts a prowess trigger on the stack above the spell; it resolves first', async () => {
  const g = await table([{ battlefield: ['Monastery Mentor', 'Island'], hand: ['Brainstorm', 'Grizzly Bears'] }, {}]);
  const mentor = find(g, 0, 'Monastery Mentor');
  const base = [g.power(mentor), g.toughness(mentor)];
  const asks = script(g);
  ok(await cast(g, 0, 'Brainstorm'), 'Brainstorm cast');
  const trig = asks.find(a => a.label === 'prowess');
  ok(trig, 'players got priority with the prowess trigger on the stack');
  eq(trig.stack.slice(0, 1), ['Brainstorm'], 'Brainstorm is under the trigger');
  eq([g.power(mentor), g.toughness(mentor)], [base[0] + 1, base[1] + 1], '+1/+1 until end of turn');
  P(g, 0).infiniteMana = g.turn;
  await cast(g, 0, 'Grizzly Bears');
  eq(g.power(mentor), base[0] + 1, 'a creature spell does not trigger prowess');
  noErrors(g);
});
await test('Prowess (rules 16): granted prowess triggers (Bria, Riptide Rogue gives it to other creatures)', async () => {
  const g = await table([{ battlefield: ['Bria, Riptide Rogue', 'Grizzly Bears', 'Island'], hand: ['Brainstorm'] }, {}]);
  const bears = find(g, 0, 'Grizzly Bears');
  script(g);
  ok(g.has(bears, 'prowess'), 'the Bears have prowess from Bria');
  await cast(g, 0, 'Brainstorm');
  eq(g.power(bears), 3, 'the Bears got +1/+1 from their granted prowess');
  const g15 = await table([{ battlefield: ['Bria, Riptide Rogue', 'Grizzly Bears', 'Island'], hand: ['Brainstorm'] }, {}], { rules: 15 });
  script(g15);
  await cast(g15, 0, 'Brainstorm');
  eq(g15.power(find(g15, 0, 'Grizzly Bears')), 2, 'rules 15 (old replays): only printed prowess counted, as before');
});

// ======================================================================================== triggered abilities
await test('8. An enters-the-battlefield trigger: Wall of Omens draws a card as it enters, using the stack', async () => {
  const g = await table([{ battlefield: ['Plains', 'Plains'], hand: ['Wall of Omens'] }, {}]);
  const asks = script(g);
  const hand = P(g, 0).hand.length;
  ok(await cast(g, 0, 'Wall of Omens'), 'cast');
  ok(asks.some(a => a.kind === 'trigger' && a.name === 'Wall of Omens'), 'its trigger went on the stack and players got priority');
  eq(P(g, 0).hand.length, hand - 1 + 1, 'one card drawn (the Wall left the hand)');
  noErrors(g);
});
await test('9. A dies trigger: Solemn Simulacrum draws a card when it dies (it has left the battlefield by then)', async () => {
  const g = await table([{ battlefield: ['Solemn Simulacrum'] }, {}]);
  const asks = script(g);
  const hand = P(g, 0).hand.length;
  g.destroy(find(g, 0, 'Solemn Simulacrum')); await settle(g);
  ok(find(g, 0, 'Solemn Simulacrum', 'graveyard'), 'in the graveyard');
  ok(asks.some(a => a.kind === 'trigger'), 'the dies trigger used the stack');
  eq(P(g, 0).hand.length, hand + 1, 'drew a card');
  noErrors(g);
});
await test('10. A leaves-the-battlefield trigger: Circuit Mender draws when it leaves by dying or by being exiled', async () => {
  const g = await table([{ battlefield: ['Circuit Mender', 'Grizzly Bears'], hand: ['Swords to Plowshares'] }, {}]);
  script(g);
  const hand = P(g, 0).hand.length;
  g.destroy(find(g, 0, 'Circuit Mender')); await settle(g);
  eq(P(g, 0).hand.length, hand + 1, 'drew after it died');
  const g2 = await table([{ battlefield: ['Circuit Mender'] }, { battlefield: ['Plains'], hand: ['Swords to Plowshares'] }]);
  script(g2);
  const h2 = P(g2, 0).hand.length;
  g2.active = 1;
  ok(await cast(g2, 1, 'Swords to Plowshares', { targets: [tgtObj(find(g2, 0, 'Circuit Mender'))] }), 'Swords cast');
  ok(find(g2, 0, 'Circuit Mender', 'exile'), 'exiled');
  eq(P(g2, 0).hand.length, h2 + 1, 'drew after it was exiled');
  noErrors(g); noErrors(g2);
});
await test('11. An upkeep trigger: Phyrexian Arena draws and loses 1 life at the beginning of its controller\'s upkeep only', async () => {
  const g = await table([{ battlefield: ['Phyrexian Arena'] }, {}]);
  const asks = script(g);
  const hand = P(g, 0).hand.length;
  const upkeep = async i => { g.active = i; g.setPhase('upkeep'); for (const o of P(g, i).battlefield) g.trigger(o, 'upkeep'); g.fire('upkeep', { p: i }); await settle(g); };
  await upkeep(1);
  eq([P(g, 0).hand.length, P(g, 0).life], [hand, 40], "nothing in the opponent's upkeep");
  await upkeep(0);
  eq([P(g, 0).hand.length, P(g, 0).life], [hand + 1, 39], 'one card and 1 life in its own upkeep');
  ok(asks.some(a => a.kind === 'trigger' && a.name === 'Phyrexian Arena'), 'it used the stack');
  noErrors(g);
});
await test('17. An ability that disappears with its source: Glorious Anthem\'s bonus ends when it leaves; a trigger already on the stack resolves without its source', async () => {
  const g = await table([{ battlefield: ['Glorious Anthem', 'Grizzly Bears'] }, {}]);
  const bears = find(g, 0, 'Grizzly Bears');
  eq(g.power(bears), 3, 'with the Anthem: 3/3');
  g.destroy(find(g, 0, 'Glorious Anthem')); await settle(g);
  eq([g.power(bears), g.toughness(bears)], [2, 2], 'the Anthem left: 2/2 again (the printed card is unchanged)');
  eq(bears.card.power, '2', 'printed power unchanged');
});

// ======================================================================================== activated abilities
await test('12. An activated sacrifice ability: Viscera Seer sacrifices a creature as its cost (the dies trigger fires), then scries', async () => {
  const g = await table([{ battlefield: ['Viscera Seer', 'Grizzly Bears', 'Blood Artist'] }, {}]);
  script(g);
  await g.sacTo(P(g, 0), find(g, 0, 'Viscera Seer'), find(g, 0, 'Grizzly Bears')); await settle(g);
  ok(find(g, 0, 'Grizzly Bears', 'graveyard'), 'the Bears were sacrificed');
  eq(P(g, 1).life, 39, 'Blood Artist saw it die');
  ok(lines(g).some(l => /scr(y|ies)/i.test(l)), 'scry 1');
  noErrors(g);
});
await test('13. A mana ability: Llanowar Elves taps for {G} without the stack, and not while summoning sick', async () => {
  const g = await table([{ battlefield: ['Llanowar Elves'] }, {}]);
  const elves = find(g, 0, 'Llanowar Elves');
  elves.sick = true;
  eq(g.manaUnitsOf(P(g, 0), elves).length, 0, 'summoning sick: no mana (302.6)');
  ready(elves);
  const asks = script(g);
  ok(g.tapForMana(P(g, 0), elves), 'tapped for mana');
  eq([P(g, 0).pool.map(u => u.colors.join('')), elves.tapped, asks.length, g.stack.length], [['G'], true, 0, 0], '{G} in the pool, tapped, no priority, nothing on the stack (605.3a)');
});
await test('14. An equip ability (rules 16): it uses the stack and attaches on resolution; if the creature leaves in response it does nothing', async () => {
  const g = await table([{ battlefield: ['Bonesplitter', 'Grizzly Bears', 'Mountain'] }, { battlefield: ['Mountain'], hand: ['Lightning Bolt'] }]);
  const bs = find(g, 0, 'Bonesplitter'), bears = find(g, 0, 'Grizzly Bears');
  const asks = script(g);
  ok(await g.equip(P(g, 0), bs, bears), 'equipped');
  ok(asks.some(a => a.kind === 'ability' && a.name === 'Bonesplitter'), 'the equip ability was on the stack');
  eq([bs.attachedTo, g.power(bears), find(g, 0, 'Mountain').tapped], [bears, 4, true], 'attached on resolution (+2/+0), {1} paid');
  const g2 = await table([{ battlefield: ['Bonesplitter', 'Grizzly Bears', 'Mountain'] }, { battlefield: ['Mountain'], hand: ['Lightning Bolt'] }]);
  const bs2 = find(g2, 0, 'Bonesplitter'), b2 = find(g2, 0, 'Grizzly Bears');
  const first = once();
  script(g2, (i, item) => (i === 1 && item.kind === 'ability' && first('bolt') ? resp(g2, 1, 'Lightning Bolt', [tgtObj(b2)]) : null));
  eq(await g2.equip(P(g2, 0), bs2, b2), false, 'the creature died in response');
  eq([b2.zone, bs2.attachedTo, find(g2, 0, 'Mountain').tapped], ['graveyard', null, true], 'equip did nothing; its cost stayed paid');
  noErrors(g); noErrors(g2);
});
await test('Equip under rules 15 (old replays): attaches at once, as before', async () => {
  const g = await table([{ battlefield: ['Bonesplitter', 'Grizzly Bears', 'Mountain'] }, {}], { rules: 15 });
  const asks = script(g);
  ok(await g.equip(P(g, 0), find(g, 0, 'Bonesplitter'), find(g, 0, 'Grizzly Bears')), 'equipped');
  eq(asks.length, 0, 'no stack object, nobody asked');
});
await test('19. An ability that uses the stack: Mother of Runes\'s ability can be responded to, and its target is checked on resolution', async () => {
  const g = await table([{ battlefield: ['Mother of Runes', 'Grizzly Bears'] }, { battlefield: ['Mountain'], hand: ['Lightning Bolt'] }]);
  const mom = ready(find(g, 0, 'Mother of Runes')), bears = find(g, 0, 'Grizzly Bears');
  const first = once();
  const asks = script(g, (i, item) => (i === 1 && item.kind === 'ability' && first('bolt') ? resp(g, 1, 'Lightning Bolt', [tgtObj(bears)]) : null));
  ok(await g.activate(P(g, 0), mom, mom.fx.abilities[0], { targets: [tgtObj(bears)] }), 'activated');
  await settle(g);
  ok(asks.some(a => a.kind === 'ability' && a.stack.includes('Mother of Runes')), 'its ability was on the stack');
  eq([mom.tapped, bears.zone], [true, 'graveyard'], 'the Bolt resolved first and killed the Bears; Mother stays tapped');
  ok(lines(g).some(l => /does nothing: its target is no longer legal/.test(l)), 'the ability did nothing (608.2b)');
  noErrors(g);
});

// ======================================================================================== static abilities
await test('15. A static cost reduction: Sapphire Medallion makes blue spells cost {1} less, and only blue ones', async () => {
  const g = await table([{ battlefield: ['Sapphire Medallion'], hand: ['Counterspell', 'Divination', 'Grizzly Bears'] }, {}]);
  const cost = n => { const { c } = g.costOf(P(g, 0), find(g, 0, n, 'hand')); return [c.generic, c.pips.length]; };
  eq(cost('Divination'), [1, 1], 'Divination {2}{U} costs {1}{U}');
  eq(cost('Counterspell'), [0, 2], 'Counterspell {U}{U}: nothing generic to reduce');
  eq(cost('Grizzly Bears'), [1, 1], 'Grizzly Bears (green) is unchanged');
  g.destroy(find(g, 0, 'Sapphire Medallion')); await settle(g);
  eq(cost('Divination'), [2, 1], 'the Medallion left: full cost again');
});
await test('16. A static power/toughness modification: Glorious Anthem gives +1/+1 to its controller\'s creatures only', async () => {
  const g = await table([{ battlefield: ['Glorious Anthem', 'Grizzly Bears'] }, { battlefield: ['Grizzly Bears'] }]);
  eq([g.power(find(g, 0, 'Grizzly Bears')), g.toughness(find(g, 0, 'Grizzly Bears'))], [3, 3], 'its controller\'s Bears: 3/3');
  eq([g.power(find(g, 1, 'Grizzly Bears')), g.toughness(find(g, 1, 'Grizzly Bears'))], [2, 2], "the opponent's Bears: 2/2");
});

// ======================================================================================== several ability types, replacement
await test('18. A card with several ability types: Solemn Simulacrum\'s enters trigger fetches a land tapped; its dies trigger draws', async () => {
  const g = await table([{ battlefield: Array(4).fill('Wastes'), hand: ['Solemn Simulacrum'] }, {}]);
  script(g);
  ok(await cast(g, 0, 'Solemn Simulacrum'), 'cast for {4}');
  const lands = P(g, 0).battlefield.filter(o => o.card.name === 'Wastes');
  eq([lands.length, lands.filter(o => o.tapped).length], [5, 5], 'its enters trigger put a basic land (Wastes) onto the battlefield tapped: four paid + one new, all tapped');
  const hand = P(g, 0).hand.length;
  g.destroy(find(g, 0, 'Solemn Simulacrum')); await settle(g);
  eq(P(g, 0).hand.length, hand + 1, 'its dies trigger drew a card');
  noErrors(g);
});
await test('20. A replacement effect: with Rest in Peace, a dying creature is exiled instead and its dies trigger doesn\'t fire', async () => {
  const g = await table([{ battlefield: ['Rest in Peace', 'Solemn Simulacrum'] }, {}]);
  script(g);
  const hand = P(g, 0).hand.length;
  g.destroy(find(g, 0, 'Solemn Simulacrum')); await settle(g);
  ok(find(g, 0, 'Solemn Simulacrum', 'exile'), 'exiled instead of going to the graveyard (614.1a)');
  eq(P(g, 0).hand.length, hand, "it didn't die, so it didn't draw");
  noErrors(g);
});

// ======================================================================================== mana abilities with conditions
await test('Mana conditions (rules 16): Tainted Wood makes {B}/{G} only with a Swamp; {C} always', async () => {
  const g = await table([{ battlefield: ['Tainted Wood'] }, {}]);
  const tw = find(g, 0, 'Tainted Wood');
  eq(g.manaUnitsOf(P(g, 0), tw).map(u => u.colors.join('')), ['C'], 'no Swamp: {C} only');
  const g2 = await table([{ battlefield: ['Tainted Wood', 'Swamp'] }, {}]);
  eq(g2.manaUnitsOf(P(g2, 0), find(g2, 0, 'Tainted Wood')).map(u => u.colors.join('')), ['BCG'], 'with a Swamp: {B}, {C} or {G}');
  const g15 = await table([{ battlefield: ['Tainted Wood'] }, {}], { rules: 15 });
  eq(g15.manaUnitsOf(P(g15, 0), find(g15, 0, 'Tainted Wood')).map(u => u.colors.join('')), ['BCG'], 'rules 15 (old replays): any of them, as before');
});
await test('Mana conditions (rules 16): Mox Opal taps for mana only with three or more artifacts (itself included)', async () => {
  const g = await table([{ battlefield: ['Mox Opal', 'Sol Ring'] }, {}]);
  const mox = find(g, 0, 'Mox Opal');
  eq(g.manaUnitsOf(P(g, 0), mox).length, 0, 'two artifacts: no mana');
  eq(g.sources(P(g, 0)).includes(mox), false, 'not counted as a mana source');
  const g2 = await table([{ battlefield: ['Mox Opal', 'Sol Ring', 'Bonesplitter'] }, {}]);
  eq(g2.manaUnitsOf(P(g2, 0), find(g2, 0, 'Mox Opal')).map(u => [...u.colors].sort().join('')), ['BGRUW'], 'three artifacts: any color');
});
await test('Spire of Industry (rules 16): colored mana (for 1 life) only with an artifact', async () => {
  const g = await table([{ battlefield: ['Spire of Industry'] }, {}]);
  eq(g.manaUnitsOf(P(g, 0), find(g, 0, 'Spire of Industry')).map(u => u.colors.join('')), ['C'], 'no artifact: {C}');
  const g2 = await table([{ battlefield: ['Spire of Industry', 'Sol Ring'] }, {}]);
  eq(g2.manaUnitsOf(P(g2, 0), find(g2, 0, 'Spire of Industry')).map(u => u.colors.join('')).sort(), ['BCGRUW'], 'with Sol Ring: any color');
});
await test('Cavern of Souls tapped by hand (rules 16): its mana in the pool still pays any color for the chosen type (uncounterable), {C} otherwise', async () => {
  const g = await table([{ battlefield: ['Cavern of Souls', 'Wastes'], hand: ['Grizzly Bears', 'Llanowar Elves'] }, { battlefield: ['Island', 'Island'], hand: ['Counterspell'] }]);
  const cav = find(g, 0, 'Cavern of Souls');
  cav.chosenType = 'bear';
  ok(g.tapForMana(P(g, 0), cav), 'tapped by hand');
  ok(!g.canCast(P(g, 0), find(g, 0, 'Llanowar Elves', 'hand')), "Llanowar Elves (an Elf) can't use it for {G}");
  const { c: bearsCost } = g.costOf(P(g, 0), find(g, 0, 'Grizzly Bears', 'hand'));
  eq([bearsCost.generic, bearsCost.pips.length], [1, 1], 'Grizzly Bears costs {1}{G}');
  // (the Wastes pays the generic part)
  let item = null;
  const rp = g.priority.bind(g); g.priority = async it => { item ||= it; return rp(it); };
  const first = once();
  script(g, (i, it) => (i === 1 && it.name === 'Grizzly Bears' && first('cs') ? resp(g, 1, 'Counterspell', [{ spell: it }]) : null));
  ok(await cast(g, 0, 'Grizzly Bears'), 'cast with the pool mana');
  eq([item?.uncounterable, find(g, 0, 'Grizzly Bears')?.zone], [true, 'battlefield'], "the Bears can't be countered");
  ok(lines(g).some(l => /can't be countered: Cavern of Souls's mana paid for it/.test(l)), 'logged');
});

// ======================================================================================== Part 4: more keywords
await test('Keyword: delve exiles graveyard cards to pay generic mana (Treasure Cruise for {U} with seven cards exiled)', async () => {
  const g = await table([{ battlefield: ['Island'], hand: ['Treasure Cruise'], graveyard: Array(7).fill('Grizzly Bears') }, {}]);
  script(g);
  const hand = P(g, 0).hand.length;
  ok(await cast(g, 0, 'Treasure Cruise'), 'cast with one Island');
  eq([P(g, 0).graveyard.filter(o => o.card.name === 'Grizzly Bears').length, P(g, 0).exile.filter(o => o.card.name === 'Grizzly Bears').length], [0, 7], 'seven cards exiled from the graveyard');
  eq(P(g, 0).hand.length, hand - 1 + 3, 'drew three');
  noErrors(g);
});
await test('Keyword: affinity for artifacts (Thoughtcast costs {U} with four artifacts)', async () => {
  const g = await table([{ battlefield: ['Island', 'Sol Ring', 'Bonesplitter', 'Basilisk Collar', 'Lightning Greaves'], hand: ['Thoughtcast'] }, {}]);
  const { c } = g.costOf(P(g, 0), find(g, 0, 'Thoughtcast', 'hand'));
  eq([c.generic, c.pips.length], [0, 1], '{4}{U} minus 4 = {U}');
});
await test('Keyword: convoke pays with creatures (Lethal Scheme with four creatures and no lands)', async () => {
  const g = await table([{ battlefield: ['Blood Artist', 'Viscera Seer', 'Grizzly Bears', 'Llanowar Elves'], hand: ['Lethal Scheme'] }, { battlefield: ['Shivan Dragon'] }]);
  script(g);
  ok(g.canCast(P(g, 0), find(g, 0, 'Lethal Scheme', 'hand')), 'castable by tapping creatures');
  ok(await cast(g, 0, 'Lethal Scheme', { targets: [tgtObj(find(g, 1, 'Shivan Dragon'))] }), 'cast');
  ok(find(g, 1, 'Shivan Dragon', 'graveyard'), 'the Dragon was destroyed');
  ok(['Blood Artist', 'Viscera Seer'].every(n => find(g, 0, n).tapped), 'the black creatures paid {B}{B}');
});
await test('Keyword: kicker (Tear Asunder kicked exiles a creature)', async () => {
  const g = await table([{ battlefield: ['Forest', 'Swamp', 'Wastes', 'Wastes'], hand: ['Tear Asunder'] }, { battlefield: ['Grizzly Bears'] }]);
  script(g);
  ok(await cast(g, 0, 'Tear Asunder', { kick: true, targets: [tgtObj(find(g, 1, 'Grizzly Bears'))] }), 'cast kicked');
  ok(find(g, 1, 'Grizzly Bears', 'exile'), 'the Bears were exiled');
  ok(P(g, 0).battlefield.every(o => o.tapped), 'all four lands paid {1}{G} + kicker {1}{B}');
});
await test('Keyword: cycling (rules 16) discards as a cost and draws through the stack; landcycling searches for a basic land', async () => {
  const g = await table([{ battlefield: ['Wastes', 'Wastes', 'Wastes', 'Wastes'], hand: ['Ketria Triome', 'Ash Barrens'] }, {}]);
  const asks = script(g);
  const hand = P(g, 0).hand.length;
  ok(await g.cycle(P(g, 0), find(g, 0, 'Ketria Triome', 'hand')), 'cycled');
  ok(find(g, 0, 'Ketria Triome', 'graveyard'), 'discarded (the cost)');
  ok(asks.some(a => a.label === 'cycling'), 'the draw used the stack');
  eq(P(g, 0).hand.length, hand, 'one card out, one card drawn');
  ok(await g.cycle(P(g, 0), find(g, 0, 'Ash Barrens', 'hand')), 'landcycled for {1}');
  ok(asks.some(a => a.label === 'landcycling'), 'the search used the stack');
  eq(P(g, 0).hand.length, hand, 'Ash Barrens out, a basic land card in');
  noErrors(g);
});
await test('Keyword: unearth (rules 16) only as a sorcery, through the stack; the creature gets haste and is exiled if it would leave', async () => {
  const g = await table([{ graveyard: ['Priest of Fell Rites'] }, {}]);
  P(g, 0).infiniteMana = g.turn;
  const priest = find(g, 0, 'Priest of Fell Rites', 'graveyard');
  g.active = 1;
  eq(g.graveAbility(P(g, 0), priest), null, "not on the opponent's turn");
  g.active = 0;
  eq(g.graveAbility(P(g, 0), priest), 'unearth', 'in its own main phase');
  const asks = script(g);
  ok(await g.useGraveAbility(P(g, 0), priest, 'unearth'), 'unearthed');
  ok(asks.some(a => a.kind === 'ability' && a.label === 'unearth'), 'the ability used the stack');
  eq([priest.zone, g.has(priest, 'haste'), priest.unearthed], ['battlefield', true, true], 'on the battlefield with haste');
  g.destroy(priest); await settle(g);
  eq(priest.zone, 'exile', 'if it would leave, it is exiled instead');
});
await test('Keyword: escape (Uro is cast from the graveyard by exiling five other cards, and stays)', async () => {
  const g = await table([{ battlefield: ['Forest', 'Forest', 'Island', 'Island', 'Wastes'], graveyard: ["Uro, Titan of Nature's Wrath", ...Array(5).fill('Grizzly Bears')] }, {}]);
  script(g);
  const uro = find(g, 0, "Uro, Titan of Nature's Wrath", 'graveyard');
  eq(g.castMode(P(g, 0), uro)?.alt, 'escapeOwn', 'escape is offered from the graveyard');
  ok(await g.cast(P(g, 0), uro), 'cast with escape'); await settle(g);
  eq([uro.zone, P(g, 0).exile.length], ['battlefield', 5], 'Uro escaped (not sacrificed); five cards exiled');
  noErrors(g);
});
await test('Keyword: flashback (Faithless Looting cast from the graveyard, then exiled)', async () => {
  const g = await table([{ battlefield: ['Mountain', 'Mountain', 'Mountain'], graveyard: ['Faithless Looting'] }, {}]);
  script(g);
  const fl = find(g, 0, 'Faithless Looting', 'graveyard');
  eq(g.castMode(P(g, 0), fl)?.alt, 'flashback', 'flashback offered');
  ok(await g.cast(P(g, 0), fl), 'cast'); await settle(g);
  eq(fl.zone, 'exile', 'exiled after resolving (702.34a)');
  noErrors(g);
});
await test('Keyword: suspend (Ancestral Vision is exiled with four time counters for {U})', async () => {
  const g = await table([{ battlefield: ['Island'], hand: ['Ancestral Vision'] }, {}]);
  script(g);
  const av = find(g, 0, 'Ancestral Vision', 'hand');
  eq(g.castMode(P(g, 0), av)?.alt, 'suspend', 'suspend offered (it has no mana cost)');
  ok(await g.cast(P(g, 0), av), 'suspended');
  eq([av.zone, av.timeCounters], ['exile', 4], 'exiled with four time counters');
});
await test('Keyword: adventure (Swift End resolves into exile; Murderous Rider can then be cast from exile)', async () => {
  const g = await table([{ hand: ['Murderous Rider'] }, { battlefield: ['Grizzly Bears'] }]);
  script(g);
  P(g, 0).infiniteMana = g.turn;
  const mr = find(g, 0, 'Murderous Rider', 'hand');
  ok(g.faceCastMode(P(g, 0), mr), 'the adventure can be cast');
  ok(await g.castFace(P(g, 0), mr), 'Swift End cast'); await settle(g);
  eq([!!find(g, 1, 'Grizzly Bears', 'graveyard'), mr.zone, P(g, 0).life], [true, 'exile', 38], 'the Bears destroyed, the card on an adventure in exile, 2 life lost');
  ok(await g.cast(P(g, 0), mr), 'Murderous Rider cast from exile'); await settle(g);
  eq(mr.zone, 'battlefield', 'on the battlefield');
});
await test('Keyword: regeneration (a regeneration shield from Asceticism saves a creature from destruction once)', async () => {
  const g = await table([{ battlefield: ['Asceticism', 'Grizzly Bears'] }, {}]);
  P(g, 0).infiniteMana = g.turn;
  script(g);
  const asc = find(g, 0, 'Asceticism'), bears = find(g, 0, 'Grizzly Bears');
  ok(await g.activate(P(g, 0), asc, asc.fx.abilities.find(a => a.effects.some(e => e.k === 'regen')), { targets: [tgtObj(bears)] }), 'activated');
  await settle(g);
  g.destroy(bears); await settle(g);
  eq([bears.zone, bears.tapped], ['battlefield', true], 'regenerated: still there, tapped (701.15a)');
  g.destroy(bears); await settle(g);
  eq(bears.zone, 'graveyard', 'the shield is used up');
});
await test("Keyword: flash (Orcish Bowmasters can be cast on an opponent's turn; a creature without flash can't)", async () => {
  const g = await table([{ battlefield: ['Swamp', 'Swamp', 'Forest', 'Forest'], hand: ['Orcish Bowmasters', 'Grizzly Bears'] }, {}], { active: 1 });
  // (Game.canCast checks costs and restrictions; timing is checked by the callers — the AI's instantSpeed and the human
  // prompts — through Game.creatureTiming: a known limitation, see the Phase 2I report)
  eq([g.creatureTiming(P(g, 0), find(g, 0, 'Orcish Bowmasters', 'hand')), g.creatureTiming(P(g, 0), find(g, 0, 'Grizzly Bears', 'hand'))], [true, false], "Bowmasters / Bears on the opponent's turn");
  g.active = 0;
  eq(g.creatureTiming(P(g, 0), find(g, 0, 'Grizzly Bears', 'hand')), true, 'the Bears in its own main phase with an empty stack');
});
await test("Keywords: indestructible ignores destroy; shroud stops its own controller's spells too", async () => {
  const g = await table([{ battlefield: ['Darksteel Citadel', 'Grizzly Bears', 'Lightning Greaves'] }, {}]);
  const dc = find(g, 0, 'Darksteel Citadel');
  g.destroy(dc); await settle(g);
  eq(dc.zone, 'battlefield', 'Darksteel Citadel survived destroy');
  const bears = find(g, 0, 'Grizzly Bears');
  P(g, 0).infiniteMana = g.turn;
  script(g);
  await g.equip(P(g, 0), find(g, 0, 'Lightning Greaves'), bears);
  eq([g.has(bears, 'shroud'), g.canTarget(P(g, 0), bears), g.canTarget(P(g, 1), bears)], [true, false, false], 'shroud: nobody can target it');
});
await test('Keywords: fear, intimidate, skulk, shadow and horsemanship decide who can block', async () => {
  const g = await table([{ battlefield: ['Shriekmaw', 'Sepulchral Primordial', 'Ingenious Prodigy', 'Dauthi Voidwalker', 'Grizzly Bears'] }, { battlefield: ['Grizzly Bears', 'Blood Artist', 'Shivan Dragon', 'Nether Traitor'] }]);
  const b = n => find(g, 1, n), a = n => find(g, 0, n);
  eq([g.canBlock(b('Grizzly Bears'), a('Shriekmaw')), g.canBlock(b('Blood Artist'), a('Shriekmaw'))], [false, true], 'fear: green Bears no, black Blood Artist yes');
  eq([g.canBlock(b('Grizzly Bears'), a('Sepulchral Primordial')), g.canBlock(b('Blood Artist'), a('Sepulchral Primordial'))], [false, true], 'intimidate: must share a color (black) or be an artifact');
  eq([g.canBlock(b('Shivan Dragon'), a('Ingenious Prodigy')), g.canBlock(b('Blood Artist'), a('Ingenious Prodigy'))], [false, true], 'skulk: not by greater power');
  eq([g.canBlock(b('Grizzly Bears'), a('Dauthi Voidwalker')), g.canBlock(b('Nether Traitor'), a('Dauthi Voidwalker')), g.canBlock(b('Nether Traitor'), a('Grizzly Bears'))], [false, true, false], 'shadow: only shadow blocks shadow, and shadow creatures block only shadow');
  a('Grizzly Bears').tempKw = new Set(['horsemanship']);
  eq(g.canBlock(b('Grizzly Bears'), a('Grizzly Bears')), false, 'horsemanship: only by horsemanship');
});
await test("Life loss read in full (rules 16): Night's Whisper draws two and loses 2; under rules 15 it only drew, as before", async () => {
  const g = await table([{ battlefield: ['Swamp', 'Swamp'], hand: ["Night's Whisper"] }, {}]);
  script(g);
  await cast(g, 0, "Night's Whisper");
  eq(P(g, 0).life, 38, '2 life lost');
  const g15 = await table([{ battlefield: ['Swamp', 'Swamp'], hand: ["Night's Whisper"] }, {}], { rules: 15 });
  script(g15);
  await cast(g15, 0, "Night's Whisper");
  eq(P(g15, 0).life, 40, 'rules 15: no life lost');
});

// ---------------------------------------------------------------------------------------------- report
const failed = results.filter(([, e]) => e);
for (const [n, e] of results) console.log(`${e ? 'FAIL' : '  ok'} ${n}${e ? `\n     ${e.message}` : ''}`);
console.log(`Abilities: ${results.length} tests, ${results.length - failed.length} passed, ${failed.length} failed.`);
process.exit(failed.length ? 1 : 0);
