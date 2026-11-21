// Phase 2F completions (rules 27): each test builds a small board from real cards (tests/scenario.mjs) and checks a card
// whose text was only partly simulated before Phase 2F (audit/phase-2f): the part that was missing, the parts that
// already worked, an illegal or missing target or resource where there is one, several opponents where relevant, a
// person's choice where there is one, the AI, and that a rules 26 game (older replays) plays the old way.
//   node tests/completions.mjs              run them all (exit 1 on any failure)
//   node tests/completions.mjs Sokenzan     only the tests whose name contains "Sokenzan"
import { scenario, find, all, P, tgtObj, resolveEffects, settle, errors, logText, card } from './scenario.mjs';
import { HumanAgent } from '../public/js/human.js';

const only = process.argv[2];
const results = [];
const test = async (name, fn) => {
  if (only && !name.toLowerCase().includes(only.toLowerCase())) return;
  try { await fn(); results.push([name, null]); } catch (e) { results.push([name, e]); }
};
const eq = (got, want, what) => { if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`${what}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); };
const ok = (cond, what) => { if (!cond) throw new Error(what); };
const noErrors = g => eq(errors(g).length, 0, 'simulator errors');
const person = (g, i, answer) => { const asked = []; P(g, i).agent = new HumanAgent('balanced', { ask: async (html, o) => { asked.push(html.replace(/<[^>]+>/g, '')); return answer(html, o); } }); return asked; };
const fxOf = name => { const c = card(name); return (c.v26 || c).fx; };
const has = (o, kw) => !!(o.tempKw?.has(kw) || o.permKw?.has(kw));
// the end step of player i, with its delayed actions
const endStep = async (g, i) => { g.active = i; await g.endSteps(P(g, i)); await settle(g); };

// ======================================================================================== 2F-1 follow-up sentences
await test('Them: Sokenzan channel makes two Spirits that gain haste (rules 27); rules 26 left them without haste', async () => {
  for (const [rules, want] of [[27, [2, true]], [26, [2, false]]]) {
    const g = await scenario([{ hand: ['Sokenzan, Crucible of Defiance'] }, {}], { rules });
    const s = find(g, 0, 'Sokenzan, Crucible of Defiance', 'hand');
    await resolveEffects(g, 0, s, s.fx.channel.effects);
    const spirits = P(g, 0).battlefield.filter(o => o.token);
    eq([spirits.length, spirits.every(o => has(o, 'haste'))], want, `rules ${rules}`); noErrors(g);
  }
});
await test('Them: Felidar Retreat counter mode gives only the creatures it put counters on vigilance', async () => {
  const g = await scenario([{ battlefield: ['Felidar Retreat', 'Grizzly Bears', 'Llanowar Elves', 'Sol Ring'] }, { battlefield: ['Craterhoof Behemoth'] }]);
  const f = find(g, 0, 'Felidar Retreat');
  await resolveEffects(g, 0, f, f.fx.landfallModes.modes[1]);
  const bears = find(g, 0, 'Grizzly Bears'), elf = find(g, 0, 'Llanowar Elves'), hoof = find(g, 1, 'Craterhoof Behemoth');
  eq([bears.counters, elf.counters, has(bears, 'vigilance'), has(elf, 'vigilance'), has(hoof, 'vigilance')], [1, 1, true, true, false], 'counters and vigilance'); noErrors(g);
});
await test('Them: Shore Up pumps, gives hexproof and untaps its target; an opponent\'s creature is not a legal target', async () => {
  const g = await scenario([{ battlefield: ['Grizzly Bears'], hand: ['Shore Up'] }, { battlefield: ['Llanowar Elves'] }]);
  const b = find(g, 0, 'Grizzly Bears'); b.tapped = true;
  const s = find(g, 0, 'Shore Up', 'hand');
  await resolveEffects(g, 0, s, s.fx.spell, [tgtObj(b)]);
  eq([b.tapped, has(b, 'hexproof'), b.tempP], [false, true, 1], 'untapped, hexproof, +1');
  const g2 = await scenario([{ hand: ['Shore Up'] }, { battlefield: ['Llanowar Elves'] }]);
  const e = find(g2, 1, 'Llanowar Elves'); e.tapped = true;
  const s2 = find(g2, 0, 'Shore Up', 'hand');
  await resolveEffects(g2, 0, s2, s2.fx.spell, [tgtObj(e)]);
  eq([e.tapped, e.tempP], [true, 0], 'illegal target: nothing happens, not untapped'); noErrors(g2);
});
await test('Them: Gift of the Viper puts the counters on and untaps the creature', async () => {
  const g = await scenario([{ battlefield: ['Grizzly Bears'], hand: ['Gift of the Viper'] }, {}]);
  const b = find(g, 0, 'Grizzly Bears'); b.tapped = true;
  const s = find(g, 0, 'Gift of the Viper', 'hand');
  await resolveEffects(g, 0, s, s.fx.spell, [tgtObj(b)]);
  eq([b.tapped, b.counters, has(b, 'deathtouch'), has(b, 'reach')], [false, 1, true, true], 'untapped with counters');
});
await test('Them: Virtue of Loyalty untaps the creatures it put counters on at the end step', async () => {
  const g = await scenario([{ battlefield: ['Virtue of Loyalty', 'Grizzly Bears', 'Llanowar Elves'] }, { battlefield: ['Craterhoof Behemoth'] }]);
  const v = find(g, 0, 'Virtue of Loyalty'), b = find(g, 0, 'Grizzly Bears'), h = find(g, 1, 'Craterhoof Behemoth');
  b.tapped = true; h.tapped = true;
  await resolveEffects(g, 0, v, v.fx.endstep);
  eq([b.tapped, b.counters, h.tapped], [false, 1, true], 'own creature untapped, opponent\'s not');
});
await test('Them: Siege-Gang Lieutenant\'s Goblins gain haste only when its condition is met', async () => {
  for (const [commander, want] of [['Siege-Gang Lieutenant', [2, true]], [null, [0, false]]]) {
    const g = await scenario([{ battlefield: ['Siege-Gang Lieutenant'], commander: commander || undefined }, {}]);
    const s = find(g, 0, 'Siege-Gang Lieutenant');
    const w = s.fx.watch.find(x => x.ev === 'begCombat');
    await resolveEffects(g, 0, s, w.effects);
    const gob = P(g, 0).battlefield.filter(o => o.token);
    eq([gob.length, gob.length > 0 && gob.every(o => has(o, 'haste'))], want, commander ? 'with its commander' : 'without');
  }
});
await test('Them: Legion Warboss\'s Goblin gains haste and must attack this combat', async () => {
  const g = await scenario([{ battlefield: ['Legion Warboss'] }, { life: 40 }]);
  const s = find(g, 0, 'Legion Warboss');
  await resolveEffects(g, 0, s, s.fx.watch.find(x => x.ev === 'begCombat').effects);
  const t = P(g, 0).battlefield.find(o => o.token);
  eq([has(t, 'haste'), t.mustAttack27 === g.turn], [true, true], 'haste and must attack');
  // (its controller declares no attackers: the token attacks anyway)
  P(g, 0).agent.declareAttackers = async () => [];
  g.active = 0;
  await g.combat(P(g, 0)); await settle(g);
  // (beginning this combat triggers the Warboss again: that second Goblin must attack too)
  eq([P(g, 1).life, P(g, 0).battlefield.filter(o => o.token).length, find(g, 0, 'Legion Warboss').attacking ?? null], [38, 2, null], 'both Goblins attacked, the Warboss stayed home'); noErrors(g);
});
await test('Them: Urabrask\'s Forge sacrifices its Horror at the next end step, not before', async () => {
  const g = await scenario([{ battlefield: ["Urabrask's Forge"] }, {}]);
  const f = find(g, 0, "Urabrask's Forge");
  await resolveEffects(g, 0, f, f.fx.watch.find(x => x.ev === 'begCombat').effects);
  const t = P(g, 0).battlefield.find(o => o.token);
  ok(t && t.zone === 'battlefield', 'Horror made');
  await endStep(g, 0);
  eq(t.zone === 'battlefield', false, 'gone at the end step'); noErrors(g);
});
await test('Them: Flameshadow Conjuring: paying makes a hasty copy exiled at the end step; not paying makes nothing', async () => {
  const g = await scenario([{ battlefield: ['Flameshadow Conjuring', 'Grizzly Bears', 'Mountain'] }, {}]);
  const f = find(g, 0, 'Flameshadow Conjuring'), b = find(g, 0, 'Grizzly Bears');
  const w = f.fx.watch[0];
  await resolveEffects(g, 0, f, w.effects, [], { trig: { o: b } });
  const copy = P(g, 0).battlefield.find(o => o.token);
  ok(copy, 'a copy was made');
  eq(has(copy, 'haste'), true, 'the copy has haste');
  await endStep(g, 0);
  eq([copy.zone === 'battlefield', b.zone], [false, 'battlefield'], 'the copy is exiled, the original stays'); noErrors(g);
  const g2 = await scenario([{ battlefield: ['Flameshadow Conjuring', 'Grizzly Bears'] }, {}], { seed: 2 });
  const f2 = find(g2, 0, 'Flameshadow Conjuring');
  await resolveEffects(g2, 0, f2, f2.fx.watch[0].effects, [], { trig: { o: find(g2, 0, 'Grizzly Bears') } });
  eq(P(g2, 0).battlefield.filter(o => o.token).length, 0, 'no mana: no copy, nothing gains haste'); noErrors(g2);
});
await test('Them: Wake the Past\'s returned artifacts gain haste', async () => {
  const g = await scenario([{ hand: ['Wake the Past'], graveyard: ['Solemn Simulacrum', 'Sol Ring'] }, {}]);
  const s = find(g, 0, 'Wake the Past', 'hand');
  await resolveEffects(g, 0, s, s.fx.spell);
  const sol = find(g, 0, 'Solemn Simulacrum');
  eq([sol?.zone, sol && has(sol, 'haste')], ['battlefield', true], 'returned with haste');
});
await test('Them: Slip Out the Back phases the creature out after the counter', async () => {
  const g = await scenario([{ battlefield: ['Grizzly Bears'], hand: ['Slip Out the Back'] }, {}]);
  const b = find(g, 0, 'Grizzly Bears'), s = find(g, 0, 'Slip Out the Back', 'hand');
  await resolveEffects(g, 0, s, s.fx.spell, [tgtObj(b)]);
  eq([b.counters, b.zone], [1, 'phased'], 'counter, phased out');
});
await test('Them: Jeskai Ascendancy has both its noncreature-spell triggers (pump and untap; loot)', async () => {
  const fx = fxOf('Jeskai Ascendancy');
  const casts = [...(fx.onCast27 || []), fx.onCast].filter(Boolean);
  ok(casts.length >= 2, `two cast triggers read (got ${casts.length})`);
  const g = await scenario([{ battlefield: ['Jeskai Ascendancy', 'Grizzly Bears'] }, { battlefield: ['Llanowar Elves'] }]);
  const j = find(g, 0, 'Jeskai Ascendancy'), b = find(g, 0, 'Grizzly Bears'), e = find(g, 1, 'Llanowar Elves');
  b.tapped = true; e.tapped = true;
  const pump = casts.find(w => w.effects.some(x => x.k === 'teamPump'));
ok(casts.some(w => w.effects.some(x => x.k === 'draw')), 'the loot trigger is still there');
  await resolveEffects(g, 0, j, pump.effects);
  eq([b.tempP, b.tapped, e.tapped], [1, false, true], 'own creatures pumped and untapped');
});
await test('Them: Sneak Attack (found in 2F: haste and the sacrifice were never applied) gives haste and sacrifices at the end step', async () => {
  for (const rules of [27, 26]) {
    const g = await scenario([{ battlefield: ['Sneak Attack', 'Mountain'], hand: ['Craterhoof Behemoth'] }, {}], { rules });
    g.active = 0;
    const s = find(g, 0, 'Sneak Attack');
    ok(await g.activate(P(g, 0), s, s.fx.abilities[0], {}), 'activated'); await settle(g);
    const h = find(g, 0, 'Craterhoof Behemoth');
    ok(h, 'Craterhoof put onto the battlefield');
    const haste = has(h, 'haste');
    await endStep(g, 0);
    eq([haste, h.zone], rules === 27 ? [true, 'graveyard'] : [false, 'battlefield'], `rules ${rules}`); noErrors(g);
  }
});
await test('Them: Sneak Attack by a person: they choose the creature; it still gains haste and is sacrificed', async () => {
  const g = await scenario([{ battlefield: ['Sneak Attack', 'Mountain'], hand: ['Craterhoof Behemoth', 'Grizzly Bears'] }, {}]);
  g.active = 0;
  const asked = person(g, 0, (html, o) => ({ button: (o?.buttons?.find(b => /Grizzly/.test(b.label)) ?? o?.buttons?.[0])?.value }));
  const s = find(g, 0, 'Sneak Attack');
  await g.activate(P(g, 0), s, s.fx.abilities[0], {}); await settle(g);
  const put = find(g, 0, 'Grizzly Bears');
  ok(put && asked.some(q => /Sneak Attack/.test(q)), `a creature was put onto the battlefield (asked: ${asked.join(' | ')})`);
  eq(has(put, 'haste'), true, 'haste');
  await endStep(g, 0);
  eq(put.zone, 'graveyard', 'sacrificed');
});
await test('Them: Puppeteer Clique exiles its creature at its controller\'s next end step, not an opponent\'s', async () => {
  const g = await scenario([{ battlefield: ['Puppeteer Clique'] }, { graveyard: ['Craterhoof Behemoth'] }, {}]);
  const c = find(g, 0, 'Puppeteer Clique');
  await resolveEffects(g, 0, c, c.fx.etb, [tgtObj(find(g, 1, 'Craterhoof Behemoth', 'graveyard'))]);
  const h = find(g, 0, 'Craterhoof Behemoth');
  eq([h?.controller, h && has(h, 'haste')], [0, true], 'stolen from the graveyard with haste');
  await endStep(g, 1);
  eq(h.zone, 'battlefield', "still there after an opponent's end step");
  await endStep(g, 0);
  eq(h.zone, 'exile', 'exiled at its own end step'); noErrors(g);
});
await test('Them: a delayed end-step action skips a permanent that left and came back (a new object)', async () => {
  const g = await scenario([{ battlefield: ['Puppeteer Clique'] }, { graveyard: ['Craterhoof Behemoth'] }]);
  const c = find(g, 0, 'Puppeteer Clique');
  await resolveEffects(g, 0, c, c.fx.etb, [tgtObj(find(g, 1, 'Craterhoof Behemoth', 'graveyard'))]);
  const h = find(g, 0, 'Craterhoof Behemoth');
  g.move(h, 'exile'); g.move(h, 'battlefield', { under: 0 });
  await endStep(g, 0);
  eq(h.zone, 'battlefield', 'the returned Behemoth is a new object: not exiled');
});
await test('Them: Ilharg puts the creature in tapped and attacking and returns it to hand at the end step', async () => {
  const g = await scenario([{ battlefield: ['Ilharg, the Raze-Boar'], hand: ['Craterhoof Behemoth'] }, {}]);
  const il = find(g, 0, 'Ilharg, the Raze-Boar');
  il.attacking = 1; il.tapped = true;
  await resolveEffects(g, 0, il, il.fx.attack);
  const h = find(g, 0, 'Craterhoof Behemoth');
  eq([h?.tapped, h?.attacking], [true, 1], 'tapped and attacking');
  await endStep(g, 0);
  eq(h.zone, 'hand', 'back in hand'); noErrors(g);
});
await test('Them: Summon: Knights of Round chapter V puts indestructible counters on the creatures it pumped', async () => {
  const g = await scenario([{ battlefield: ['Summon: Knights of Round', 'Grizzly Bears'] }, { battlefield: ['Llanowar Elves'] }]);
  const s = find(g, 0, 'Summon: Knights of Round');
  await resolveEffects(g, 0, s, s.fx.saga[4]);
  const b = find(g, 0, 'Grizzly Bears'), e = find(g, 1, 'Llanowar Elves');
  eq([b.tempP, b.permKw?.has('indestructible'), !!e.permKw?.has('indestructible')], [2, true, false], 'own creatures only');
});
await test('Them: Ovika makes X hasty Goblins for a noncreature spell, X its mana value', async () => {
  const g = await scenario([{ battlefield: ['Ovika, Enigma Goliath'], hand: ['Cultivate'] }, {}, {}]);
  const o = find(g, 0, 'Ovika, Enigma Goliath'), cv = find(g, 0, 'Cultivate', 'hand');
  await resolveEffects(g, 0, o, o.fx.onCast.effects, [], { trig: { o: cv, p: 0 } });
  const gob = P(g, 0).battlefield.filter(x => x.token);
  eq([gob.length, gob.every(x => has(x, 'haste'))], [3, true], 'three hasty Goblins');
});
await test('Them: the AI values a follow-up and plays it legally (Valley Floodcaller untaps only its own pumped creatures)', async () => {
  const g = await scenario([{ battlefield: ['Valley Floodcaller', 'Grizzly Bears'] }, { battlefield: ['Llanowar Elves'] }]);
  const v = find(g, 0, 'Valley Floodcaller'); v.tapped = true;
  const b = find(g, 0, 'Grizzly Bears'); b.tapped = true;
  const e = find(g, 1, 'Llanowar Elves'); e.tapped = true;
  await resolveEffects(g, 0, v, v.fx.onCast.effects);
  eq([v.tapped, b.tapped, e.tapped], [false, true, true], 'the Otter untaps; the Bears (not a Bird/Frog/Otter/Rat) and the opponent\'s Elf stay tapped');
  ok(P(g, 0).agent.effectValue(g, P(g, 0), v, v.fx.onCast.effects[1], false) > 0, 'the AI values untapping');
});
await test('Them: a rules 26 game keeps the old readings (no untap from Shore Up)', async () => {
  const g = await scenario([{ battlefield: ['Grizzly Bears'], hand: ['Shore Up'] }, {}], { rules: 26 });
  const b = find(g, 0, 'Grizzly Bears'); b.tapped = true;
  const s = find(g, 0, 'Shore Up', 'hand');
  await resolveEffects(g, 0, s, s.fx.spell, [tgtObj(b)]);
  eq(b.tapped, true, 'still tapped');
});

// ======================================================================================== 2F-3 costs
await test('Channel: Otawara costs {1} less for each legendary creature; without enough mana it can\'t be channeled', async () => {
  for (const [rules, legends, lands, want] of [[27, 2, 2, true], [27, 0, 2, false], [26, 2, 2, false], [27, 3, 1, true]]) {
    const bf = [...["Atraxa, Praetors' Voice", 'Thalia, Guardian of Thraben', 'Ragavan, Nimble Pilferer'].slice(0, legends), ...Array(lands).fill('Island')];
    const g = await scenario([{ battlefield: bf, hand: ['Otawara, Soaring City'] }, {}], { rules });
    eq(g.canCycle(P(g, 0), find(g, 0, 'Otawara, Soaring City', 'hand')), want, `rules ${rules}, ${legends} legends, ${lands} Islands`);
  }
});
await test('Channel: Otawara returns an opponent\'s permanent of a listed type; a land is not a legal target', async () => {
  const g = await scenario([{ battlefield: ['Island', 'Island', 'Island', 'Island'], hand: ['Otawara, Soaring City'] }, { battlefield: ['Sol Ring', 'Forest'] }]);
  g.active = 0;
  const o = find(g, 0, 'Otawara, Soaring City', 'hand'), e = o.fx.channel.effects[0];
  const { legalTargets } = await import('../public/js/resolve.js');
  const names = legalTargets(g, P(g, 0), e, o).objs.map(x => x.card.name);
  ok(names.includes('Sol Ring') && !names.includes('Forest'), `legal targets: ${names}`);
  await resolveEffects(g, 0, o, o.fx.channel.effects, [tgtObj(find(g, 1, 'Sol Ring'))]);
  eq(find(g, 1, 'Sol Ring', 'hand')?.zone, 'hand', 'Sol Ring returned'); noErrors(g);
});
await test('Channel: Boseiju destroys, and that player may search for a land with a basic land type (a dual counts)', async () => {
  const g = await scenario([{ hand: ['Boseiju, Who Endures'] }, { battlefield: ['Sol Ring'], library: ['Tropical Island'], filler: 0 }]);
  const b = find(g, 0, 'Boseiju, Who Endures', 'hand');
  await resolveEffects(g, 0, b, b.fx.channel.effects, [tgtObj(find(g, 1, 'Sol Ring'))]);
  eq([find(g, 1, 'Sol Ring', 'graveyard')?.zone, find(g, 1, 'Tropical Island')?.zone], ['graveyard', 'battlefield'], 'destroyed; the dual land fetched');
  const g2 = await scenario([{ hand: ['Boseiju, Who Endures'] }, { battlefield: ['Sol Ring'] }], { rules: 26 });
  const b2 = find(g2, 0, 'Boseiju, Who Endures', 'hand');
  const before = P(g2, 1).battlefield.length;
  await resolveEffects(g2, 0, b2, b2.fx.channel.effects, [tgtObj(find(g2, 1, 'Sol Ring'))]);
  eq(P(g2, 1).battlefield.length, before - 1, 'rules 26: no land');
});
await test('Channel: Sokenzan channeled through the real activation pays the reduced cost and makes hasty Spirits', async () => {
  const g = await scenario([{ battlefield: ["Atraxa, Praetors' Voice", 'Mountain', 'Mountain', 'Mountain'], hand: ['Sokenzan, Crucible of Defiance'] }, {}]);
  g.active = 0;
  ok(await g.cycle(P(g, 0), find(g, 0, 'Sokenzan, Crucible of Defiance', 'hand')), 'channeled');
  await settle(g);
  const sp = P(g, 0).battlefield.filter(o => o.token);
  eq([sp.length, sp.every(o => has(o, 'haste')), P(g, 0).battlefield.filter(o => o.card.name === 'Mountain' && !o.tapped).length], [2, true, 0], '{2}{R} paid with one legend');
});

// ======================================================================================== 2F-5 zones
// (priority answers on the real stack, as tests/stack.mjs does: seat i casts the named card from hand in response)
const respondWith = (g, seat, name, when) => { for (const q of g.players) q.agent.respondAt = (gg, qq, item) => (qq.idx === seat && when(item) && find(g, seat, name, 'hand') ? { kind: 'cast', card: find(g, seat, name, 'hand'), targets: [{ spell: item }] } : null); };
await test('Counter: Memory Lapse puts the countered spell on top of its owner\'s library (rules 27); rules 26 used the graveyard', async () => {
  for (const [rules, want] of [[27, 'library'], [26, 'graveyard']]) {
    const g = await scenario([{ battlefield: ['Forest', 'Forest'], hand: ['Grizzly Bears'] }, { battlefield: ['Island', 'Island'], hand: ['Memory Lapse'] }], { rules });
    g.active = 0; g.phase = 'main1';
    respondWith(g, 1, 'Memory Lapse', item => item.name === 'Grizzly Bears');
    await g.cast(P(g, 0), find(g, 0, 'Grizzly Bears', 'hand'), {}); await settle(g);
    const lib = P(g, 0).library;
    const bears = [...lib, ...P(g, 0).graveyard].find(o => o.card.name === 'Grizzly Bears');
    eq([bears?.zone, rules === 27 ? lib[lib.length - 1] === bears : true], [want, true], `rules ${rules}`); noErrors(g);
  }
});
await test('Counter: Force of Negation exiles the countered noncreature spell; a creature spell is not a legal target', async () => {
  const g = await scenario([{ battlefield: ['Island', 'Island', 'Island'], hand: ['Divination'] }, { battlefield: ['Island', 'Island', 'Island'], hand: ['Force of Negation'] }]);
  g.active = 0; g.phase = 'main1';
  respondWith(g, 1, 'Force of Negation', item => item.name === 'Divination');
  await g.cast(P(g, 0), find(g, 0, 'Divination', 'hand'), {}); await settle(g);
  eq(find(g, 0, 'Divination', 'exile')?.zone, 'exile', 'exiled, not in the graveyard');
  const g2 = await scenario([{ battlefield: ['Forest', 'Forest'], hand: ['Grizzly Bears'] }, { battlefield: ['Island', 'Island', 'Island'], hand: ['Force of Negation'] }]);
  g2.active = 0; g2.phase = 'main1';
  respondWith(g2, 1, 'Force of Negation', item => item.name === 'Grizzly Bears');
  await g2.cast(P(g2, 0), find(g2, 0, 'Grizzly Bears', 'hand'), {}); await settle(g2);
  eq(find(g2, 0, 'Grizzly Bears')?.zone, 'battlefield', 'a creature spell resolves');
});
await test('Counter: Memory Lapse on a flashback spell: it is exiled (flashback wins), not put on top', async () => {
  const g = await scenario([{ battlefield: ['Mountain', 'Mountain', 'Mountain'], graveyard: ['Faithless Looting'] }, { battlefield: ['Island', 'Island'], hand: ['Memory Lapse'] }]);
  g.active = 0; g.phase = 'main1';
  respondWith(g, 1, 'Memory Lapse', item => item.name === 'Faithless Looting');
  const fl = find(g, 0, 'Faithless Looting', 'graveyard');
  await g.cast(P(g, 0), fl, { alt: 'flashback' }); await settle(g);
  eq(fl.zone, 'exile', 'exiled');
});
await test('Enduring Curiosity dies and returns as an enchantment, not a creature; destroyed again, it stays in the graveyard', async () => {
  // (rules 26 and earlier: "if it was a creature" was never met, so it never returned; kept for older replays)
  for (const [rules, zone, creature] of [[27, 'battlefield', false], [26, 'graveyard', true]]) {
    const g = await scenario([{ battlefield: ['Enduring Curiosity'] }, {}], { rules });
    const c = find(g, 0, 'Enduring Curiosity');
    g.destroy(c);
    await settle(g);
    eq([c.zone, !!c.fx.type.creature, !!c.fx.type.enchantment], [zone, creature, true], `rules ${rules}`);
    if (rules === 27) {
      g.move(c, 'graveyard'); await settle(g);
      eq([c.zone, !!c.fx.type.creature], ['graveyard', true], 'not a creature when it went: no return; a creature card again in the graveyard');
    }
    noErrors(g);
  }
});
await test('Snapcaster Mage: the granted flashback costs the card\'s mana cost; a person chooses the card', async () => {
  const g = await scenario([{ battlefield: ['Snapcaster Mage', 'Island', 'Island'], graveyard: ['Brainstorm', 'Counterspell'] }, {}]);
  g.active = 0; g.phase = 'main1';
  const asked = person(g, 0, (html, o) => ({ button: (o?.buttons?.find(b => /Brainstorm/.test(b.label)) ?? o?.buttons?.[0])?.value }));
  const s = find(g, 0, 'Snapcaster Mage');
  await resolveEffects(g, 0, s, s.fx.etb);
  const bs = find(g, 0, 'Brainstorm', 'graveyard');
  eq([bs.tempFlashback === g.turn, find(g, 0, 'Counterspell', 'graveyard').tempFlashback === g.turn], [true, false], `the chosen card (asked: ${asked.length})`);
  const { castMode } = await import('../public/js/mana.js').catch(() => ({}));
  ok(await g.cast(P(g, 0), bs, { alt: 'flashback' }), 'cast for {U} with flashback');
  await settle(g);
  eq([bs.zone, P(g, 0).battlefield.filter(o => o.card.name === 'Island' && o.tapped).length], ['exile', 1], 'exiled after, one Island paid');
});

// ---------------------------------------------------------------------------------------------------------- report
const failed = results.filter(([, e]) => e);
for (const [name, e] of results) console.log(`${e ? 'FAIL' : 'ok  '} ${name}${e ? `\n       ${e.stack?.split('\n').slice(0, 3).join('\n       ')}` : ''}`);
console.log(`Phase 2F completions: ${results.length - failed.length} of ${results.length} passed`);
process.exit(failed.length ? 1 : 0);
