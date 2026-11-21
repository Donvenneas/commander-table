// Phase 2E repairs (rules 26): each test builds a small board from real cards (tests/scenario.mjs) and checks a repaired
// card or mechanic from the Phase 2C audit (audit/phase-2c): normal use, illegal or missing targets, missing resources,
// several opponents, a person's choice where there is one, and that a rules 25 game (older replays) plays the old way.
//   node tests/repairs.mjs              run them all (exit 1 on any failure)
//   node tests/repairs.mjs Drake        only the tests whose name contains "Drake"
import { scenario, find, all, P, tgtObj, resolveEffects, settle, errors, logText } from './scenario.mjs';
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
const mana = (g, i) => { g.active = i; P(g, i).infiniteMana = g.turn; };
const person = (g, i, answer) => { const asked = []; P(g, i).agent = new HumanAgent('balanced', { ask: async (html, o) => { asked.push(html.replace(/<[^>]+>/g, '')); return answer(html, o); } }); return asked; };

// ======================================================================================== 2E-1 targets and choices
await test('Activate only once each turn: Quirion Ranger untaps once a turn (rules 26); rules 25 allowed more', async () => {
  for (const [rules, want] of [[26, [true, false]], [25, [true, true]]]) {
    const g = await scenario([{ battlefield: ['Quirion Ranger', 'Forest', 'Forest', 'Llanowar Elves'] }, {}], { rules });
    g.active = 0;
    const r = find(g, 0, 'Quirion Ranger'), ab = r.fx.abilities[0];
    const elf = find(g, 0, 'Llanowar Elves'); elf.tapped = true;
    const first = await g.activate(P(g, 0), r, ab, { targets: [tgtObj(elf)] }); await settle(g);
    elf.tapped = true;
    const second = g.canActivate(P(g, 0), r, ab);
    eq([!!first, !!second], want, `rules ${rules}`);
  }
});
await test('Activate only once each turn: the limit resets next turn', async () => {
  const g = await scenario([{ battlefield: ['Quirion Ranger', 'Forest', 'Forest', 'Llanowar Elves'] }, {}]);
  g.active = 0;
  const r = find(g, 0, 'Quirion Ranger'), ab = r.fx.abilities[0];
  await g.activate(P(g, 0), r, ab, { targets: [tgtObj(find(g, 0, 'Llanowar Elves'))] }); await settle(g);
  g.turn++;
  ok(g.canActivate(P(g, 0), r, ab), 'next turn: allowed again (with a Forest to return)');
});
await test("Gilded Drake exchanges control with the opponent's creature (701.12)", async () => {
  const g = await scenario([{ battlefield: ['Gilded Drake'] }, { battlefield: ['Craterhoof Behemoth'] }]);
  const d = find(g, 0, 'Gilded Drake'), c = find(g, 1, 'Craterhoof Behemoth');
  await resolveEffects(g, 0, d, d.fx.etb, [tgtObj(c)]);
  eq([d.zone, d.controller, c.controller, P(g, 0).battlefield.includes(c), P(g, 1).battlefield.includes(d)], ['battlefield', 1, 0, true, true], 'swapped'); noErrors(g);
});
await test('Gilded Drake with no target, or a target that left: no exchange, the Drake is sacrificed', async () => {
  const g = await scenario([{ battlefield: ['Gilded Drake'] }, {}]);
  const d = find(g, 0, 'Gilded Drake');
  await resolveEffects(g, 0, d, d.fx.etb, [{ none: true }]);
  eq(d.zone, 'graveyard', 'no target');
  const g2 = await scenario([{ battlefield: ['Gilded Drake'] }, { battlefield: ['Craterhoof Behemoth'] }]);
  const d2 = find(g2, 0, 'Gilded Drake'), c2 = find(g2, 1, 'Craterhoof Behemoth');
  g2.move(c2, 'hand');
  await resolveEffects(g2, 0, d2, d2.fx.etb, [tgtObj(c2)], { strict: false });
  eq([d2.zone, c2.zone], ['graveyard', 'hand'], 'target gone: still resolves, Drake sacrificed');
});
await test('Gilded Drake on the stack: its target leaves in response, the ability still resolves and the Drake is sacrificed', async () => {
  const g = await scenario([{ battlefield: ['Gilded Drake'] }, { battlefield: ['Craterhoof Behemoth'] }]);
  const d = find(g, 0, 'Gilded Drake'), c = find(g, 1, 'Craterhoof Behemoth');
  const item = await g.putAbility(P(g, 0), d, d.fx.etb, 'enters', 'trigger', null, 0, [tgtObj(c), null, null]);
  ok(item, 'on the stack');
  g.move(c, 'hand');
  await g.resolveAbility(item); await settle(g);
  eq([d.zone, item.status], ['graveyard', 'resolved'], 'resolved anyway (not fizzled): no exchange, Drake sacrificed');
});
await test('Gilded Drake under rules 25: sacrificed as before (old replays)', async () => {
  const g = await scenario([{ battlefield: ['Gilded Drake'] }, { battlefield: ['Craterhoof Behemoth'] }], { rules: 25 });
  const d = find(g, 0, 'Gilded Drake');
  await resolveEffects(g, 0, d, d.fx.etb, [tgtObj(find(g, 1, 'Craterhoof Behemoth'))]);
  eq([d.zone, find(g, 1, 'Craterhoof Behemoth').controller], ['graveyard', 1], 'as before');
});
await test('Gilded Drake: a creature its opponent controls only (an own creature is not a legal target)', async () => {
  const g = await scenario([{ battlefield: ['Gilded Drake', 'Grizzly Bears'] }, { battlefield: ['Llanowar Elves'] }]);
  const d = find(g, 0, 'Gilded Drake');
  const { legalTargets } = await import('../public/js/resolve.js');
  eq(legalTargets(g, P(g, 0), d.fx.etb[0], d).objs.map(o => o.card.name), ['Llanowar Elves'], 'legal targets');
  eq(P(g, 0).agent.chooseTarget(g, P(g, 0), d.fx.etb[0], d)?.obj?.card.name, 'Llanowar Elves', 'AI choice');
});
await test('Punisher: Combustible Gearhulk at high life the opponent refuses: three milled, damage equal to their mana value', async () => {
  const g = await scenario([{ battlefield: ['Combustible Gearhulk'], library: ['Craterhoof Behemoth', 'Lightning Bolt', 'Sol Ring'], filler: 0 }, {}]);
  const c = find(g, 0, 'Combustible Gearhulk');
  const h = P(g, 0).hand.length;
  await resolveEffects(g, 0, c, c.fx.etb, [null, null, { player: 1 }]);
  eq([P(g, 0).hand.length - h, P(g, 0).graveyard.length, P(g, 1).life], [0, 3, 40 - (8 + 1 + 1)], 'no draw, milled 3, 10 damage'); noErrors(g);
});
await test('Punisher: at low life the opponent lets Combustible Gearhulk draw three', async () => {
  const g = await scenario([{ battlefield: ['Combustible Gearhulk'] }, { life: 12 }]);
  const c = find(g, 0, 'Combustible Gearhulk');
  const h = P(g, 0).hand.length;
  await resolveEffects(g, 0, c, c.fx.etb, [null, null, { player: 1 }]);
  eq([P(g, 0).hand.length - h, P(g, 1).life], [3, 12], 'drew 3');
});
await test('Punisher for a person: the targeted player is asked; refusing mills and hurts only that player (four players)', async () => {
  const g = await scenario([{ battlefield: ['Combustible Gearhulk'], library: ['Sol Ring', 'Sol Ring', 'Sol Ring'], filler: 0 }, {}, {}, {}]);
  const asked = person(g, 2, () => ({ button: 'no' }));
  const c = find(g, 0, 'Combustible Gearhulk');
  await resolveEffects(g, 0, c, c.fx.etb, [null, null, { player: 2 }]);
  ok(asked.some(a => /let P1 draw 3/.test(a)), `asked: ${asked.join(' | ')}`);
  eq([P(g, 1).life, P(g, 2).life, P(g, 3).life], [40, 37, 40], 'only P3 takes damage');
});
await test("Punisher: Palantír of Orthanc's refusal costs life equal to the milled cards' mana value (X = influence counters)", async () => {
  const g = await scenario([{ battlefield: ['Palantír of Orthanc'], library: ['Sol Ring', 'Craterhoof Behemoth', 'Forest', 'Forest'], filler: 0 }, {}]);
  const pal = P(g, 0).battlefield[0];
  pal.named = { influence: 1 };
  P(g, 0).agent.chooseScry = (gg, pp, top) => ({ keep: top, away: [] });
  await resolveEffects(g, 0, pal, pal.fx.endstep, [null, null, { player: 1 }]);
  eq(pal.named.influence, 2, 'a second influence counter');
  eq(P(g, 0).graveyard.length, 2, 'refused at 40 life: milled X = 2');
  ok(P(g, 1).life < 40, `lost life: ${P(g, 1).life}`);
});
await test("Rules 25: Combustible Gearhulk still draws three without asking (old replays)", async () => {
  const g = await scenario([{ battlefield: ['Combustible Gearhulk'] }, {}], { rules: 25 });
  const c = find(g, 0, 'Combustible Gearhulk');
  const h = P(g, 0).hand.length;
  await resolveEffects(g, 0, c, c.fx.etb);
  eq(P(g, 0).hand.length - h, 3, 'drew 3');
});
await test('Tataru Taru: you draw one and the targeted opponent draws one (not you twice)', async () => {
  const g = await scenario([{ battlefield: ['Tataru Taru'] }, {}, {}]);
  const t = find(g, 0, 'Tataru Taru');
  const h0 = P(g, 0).hand.length, h2 = P(g, 2).hand.length;
  await resolveEffects(g, 0, t, t.fx.etb, [null, null, { player: 2 }]);
  eq([P(g, 0).hand.length - h0, P(g, 2).hand.length - h2, P(g, 1).hand.length], [1, 1, 0], 'one each');
});
await test("Chandra's Ignition: the targeted creature deals the damage; if it has left, the spell does nothing", async () => {
  const g = await scenario([{ hand: ["Chandra's Ignition"], battlefield: ['Grizzly Bears', 'Craterhoof Behemoth'] }, { battlefield: ['Llanowar Elves'] }]);
  const o = find(g, 0, "Chandra's Ignition", 'hand');
  await resolveEffects(g, 0, o, o.fx.spell, [tgtObj(find(g, 0, 'Grizzly Bears'))]);
  eq([P(g, 1).life, find(g, 1, 'Llanowar Elves', 'graveyard')?.zone], [38, 'graveyard'], 'Bears dealt 2');
  const g2 = await scenario([{ hand: ["Chandra's Ignition"], battlefield: ['Grizzly Bears', 'Craterhoof Behemoth'] }, {}]);
  const o2 = find(g2, 0, "Chandra's Ignition", 'hand'), b2 = find(g2, 0, 'Grizzly Bears');
  g2.move(b2, 'graveyard');
  await resolveEffects(g2, 0, o2, o2.fx.spell, [tgtObj(b2)]);
  eq(P(g2, 1).life, 40, 'target gone: no damage (Craterhoof is not used instead)');
});
await test("Chandra's Ignition: an opponent's creature is not a legal target; the AI picks its biggest", async () => {
  const g = await scenario([{ hand: ["Chandra's Ignition"], battlefield: ['Grizzly Bears', 'Craterhoof Behemoth'] }, { battlefield: ['Llanowar Elves'] }]);
  const o = find(g, 0, "Chandra's Ignition", 'hand');
  const { legalTargets } = await import('../public/js/resolve.js');
  eq(legalTargets(g, P(g, 0), o.fx.spell[0], o).objs.map(x => x.card.name).sort(), ['Craterhoof Behemoth', 'Grizzly Bears'], 'legal');
  eq(P(g, 0).agent.chooseTarget(g, P(g, 0), o.fx.spell[0], o)?.obj?.card.name, 'Craterhoof Behemoth', 'AI');
});

// ======================================================================================== 2E-2 costs, permissions, searches
await test('Search words: Natural Order finds only a green creature (Sheoldred is not found); rules 25 found any creature', async () => {
  for (const [rules, want] of [[26, 'Craterhoof Behemoth'], [25, 'Sheoldred, the Apocalypse']]) {
    const g = await scenario([{ hand: ['Natural Order'], battlefield: ['Llanowar Elves'], library: ['Craterhoof Behemoth', 'Sheoldred, the Apocalypse'], filler: 0 }, {}], { rules });
    const o = find(g, 0, 'Natural Order', 'hand');
    // (the AI wants the strongest card: Sheoldred is worth more to it than Craterhoof here only if allowed)
    P(g, 0).agent.pickTutor = function (gg, pp, e) { return Object.getPrototypeOf(this).pickTutor.call(this, gg, pp, e); };
    const lib = P(g, 0).library;
    const { tutorFits } = await import('../public/js/resolve.js');
    const e = o.fx.spell.find(x => x.k === 'tutor');
    const ok26 = lib.filter(c => tutorFits(g, e, c)).map(c => c.card.name);
    ok(ok26.includes(want), `rules ${rules}: ${ok26}`);
    if (rules === 26) eq(ok26, ['Craterhoof Behemoth'], 'only green');
  }
});
await test('Search words: Maelstrom of the Spirit Dragon finds a Dragon, and nothing when there is none', async () => {
  const g = await scenario([{ battlefield: ['Maelstrom of the Spirit Dragon'], library: ['Lightning Bolt', 'Ancient Bronze Dragon'], filler: 0 }, {}]);
  mana(g, 0);
  const m = find(g, 0, 'Maelstrom of the Spirit Dragon');
  await resolveEffects(g, 0, m, m.fx.abilities.find(a => a.effects.some(e => e.k === 'tutor')).effects);
  eq(P(g, 0).hand.map(o => o.card.name), ['Ancient Bronze Dragon'], 'found the Dragon');
  const g2 = await scenario([{ battlefield: ['Maelstrom of the Spirit Dragon'], library: ['Lightning Bolt'], filler: 0 }, {}]);
  const m2 = find(g2, 0, 'Maelstrom of the Spirit Dragon');
  await resolveEffects(g2, 0, m2, m2.fx.abilities.find(a => a.effects.some(e => e.k === 'tutor')).effects);
  eq(P(g2, 0).hand.length, 0, 'no Dragon: nothing');
});
await test('Search words for a person: only cards the search allows are offered (Maelstrom)', async () => {
  const g = await scenario([{ battlefield: ['Maelstrom of the Spirit Dragon'], library: ['Lightning Bolt', 'Ancient Bronze Dragon'], filler: 0 }, {}]);
  const offered = [];
  const h = new HumanAgent('balanced', { ask: async () => ({ button: 'cancel' }) });
  h.chooseCardsAsync = async (gg, pp, cards) => { offered.push(...cards.map(c => c.card.name)); return [cards[0]]; };
  P(g, 0).agent = h;
  const m = find(g, 0, 'Maelstrom of the Spirit Dragon');
  await resolveEffects(g, 0, m, m.fx.abilities.find(a => a.effects.some(e => e.k === 'tutor')).effects);
  ok(offered.length && !offered.includes('Lightning Bolt'), `offered: ${offered}`);
});
await test("Second reading for non-legendary names: Artifact Mutation destroys the artifact; Spell Swindle counters (rules 26)", async () => {
  const g = await scenario([{ hand: ['Artifact Mutation'] }, { battlefield: ['Gilded Lotus'] }]);
  const o = find(g, 0, 'Artifact Mutation', 'hand'), a = find(g, 1, 'Gilded Lotus');
  await resolveEffects(g, 0, o, o.fx.spell, [tgtObj(a)]);
  eq([a.zone, P(g, 0).battlefield.filter(x => x.token).length], ['graveyard', 5], 'destroyed, five Saprolings');
  const old = await scenario([{ hand: ['Artifact Mutation'] }, { battlefield: ['Gilded Lotus'] }], { rules: 25 });
  const o2 = find(old, 0, 'Artifact Mutation', 'hand');
  await resolveEffects(old, 0, o2, o2.fx.spell, [tgtObj(find(old, 1, 'Gilded Lotus'))]);
  eq(find(old, 1, 'Gilded Lotus').zone, 'battlefield', 'rules 25: as before (not destroyed)');
  const g3 = await scenario([{ hand: ['Spell Swindle'] }, {}]);
  eq(find(g3, 0, 'Spell Swindle', 'hand').fx.spell.map(e => e.k), ['counter', 'treasure'], 'Spell Swindle counters');
});
await test("Mana of any type: Mnemonic Betrayal lets an opponent's red spell be paid with any mana", async () => {
  const g = await scenario([{ hand: ['Mnemonic Betrayal'], battlefield: ['Island'] }, { graveyard: ['Lightning Bolt'] }]);
  mana(g, 0);
  const m = find(g, 0, 'Mnemonic Betrayal', 'hand');
  await resolveEffects(g, 0, m, m.fx.spell);
  P(g, 0).infiniteMana = -1;
  const bolt = find(g, 1, 'Lightning Bolt', 'exile');
  eq(g.costOf(P(g, 0), bolt).c, { generic: 1, pips: [], x: 0 }, '{R} paid as generic');
  const isl = find(g, 0, 'Island'); isl.tapped = false;
  ok(!!g.canCast(P(g, 0), bolt), 'castable with an Island');
});

// ======================================================================================== 2E-3 stack, copies and modes
await test('Delay: the countered spell is exiled with three time counters and suspended', async () => {
  const g = await scenario([{ hand: ['Delay'] }, { hand: ['Craterhoof Behemoth'] }]);
  const d = find(g, 0, 'Delay', 'hand');
  const c = find(g, 1, 'Craterhoof Behemoth', 'hand');
  P(g, 1).hand.splice(P(g, 1).hand.indexOf(c), 1); c.zone = 'stack';
  const item = { o: c, p: P(g, 1), targets: [], x: 0, ability: false };
  g.stack.push(item);
  await resolveEffects(g, 0, d, d.fx.spell, [{ spell: item }]);
  eq([item.countered, item.toExile, c.timeCounters, (P(g, 1).suspended || []).includes(c)], [true, true, 3, true], 'suspended');
});
await test("Render Silent: the countered spell's controller can't cast spells this turn", async () => {
  const g = await scenario([{ hand: ['Render Silent'] }, { hand: ['Lightning Bolt', 'Craterhoof Behemoth'] }]);
  const r = find(g, 0, 'Render Silent', 'hand');
  const c = find(g, 1, 'Craterhoof Behemoth', 'hand');
  P(g, 1).hand.splice(P(g, 1).hand.indexOf(c), 1); c.zone = 'stack';
  const item = { o: c, p: P(g, 1), targets: [], x: 0, ability: false };
  g.stack.push(item);
  await resolveEffects(g, 0, r, r.fx.spell, [{ spell: item }]);
  mana(g, 1);
  eq([item.countered, !!g.canCast(P(g, 1), find(g, 1, 'Lightning Bolt', 'hand'))], [true, false], 'silenced');
});
await test('Court of Vantress copies the chosen artifact, not itself', async () => {
  const g = await scenario([{ battlefield: ['Court of Vantress', 'Sol Ring'] }, {}]);
  g.monarch = 0;
  const c = find(g, 0, 'Court of Vantress');
  await resolveEffects(g, 0, c, c.fx.upkeep);
  eq(P(g, 0).battlefield.filter(x => x.token).map(x => x.card.name), ['Sol Ring'], 'a Sol Ring token');
});
await test('Yenna copies an enchantment you control (not itself); an opponent\'s enchantment is not a legal target', async () => {
  const g = await scenario([{ battlefield: ['Yenna, Redtooth Regent', 'Glorious Anthem'] }, { battlefield: ['Rest in Peace'] }]);
  const y = find(g, 0, 'Yenna, Redtooth Regent');
  const ab = y.fx.abilities[0];
  const e = ab.effects.find(x => x.k === 'copyToken' && x.since === 26);
  const { legalTargets, targetFits } = await import('../public/js/resolve.js');
  const objs = legalTargets(g, P(g, 0), e, y).objs.filter(o => targetFits(g, P(g, 0), e, o, y)).map(o => o.card.name);
  eq(objs, ['Glorious Anthem'], 'legal targets');
  await resolveEffects(g, 0, y, ab.effects);
  eq(P(g, 0).battlefield.filter(x => x.token).map(x => x.card.name), ['Glorious Anthem'], 'copied the Anthem');
});
await test('Charming Scoundrel: the first mode discards, then draws (hand size kept)', async () => {
  const g = await scenario([{ battlefield: ['Charming Scoundrel'], hand: ['Forest', 'Island'] }, {}]);
  const c = find(g, 0, 'Charming Scoundrel');
  await resolveEffects(g, 0, c, c.fx.etbModes.modes[0]);
  eq([P(g, 0).hand.length, P(g, 0).graveyard.length], [2, 1], 'hand 2, one discarded');
});
await test("Spawn tokens: Kozilek's Command makes X Eldrazi Spawn that sacrifice for {C}; the spell adds no mana itself", async () => {
  const g = await scenario([{ hand: ["Kozilek's Command"] }, {}]);
  const o = find(g, 0, "Kozilek's Command", 'hand');
  await resolveEffects(g, 0, o, o.fx.modes.modes[0], [], { x: 3 });
  const spawn = P(g, 0).battlefield.filter(x => x.token);
  eq([spawn.length, P(g, 0).pool.length, !!spawn[0]?.fx.abilities?.some(a => a.sacSelf && a.effects.some(e => e.k === 'addMana'))], [3, 0, true], 'three Spawn with a sacrifice mana ability');
});
await test('Spawn tokens: Awakening Zone at rules 25 still adds {C} (old replays)', async () => {
  const g = await scenario([{ battlefield: ['Awakening Zone'] }, {}], { rules: 25 });
  const a = find(g, 0, 'Awakening Zone');
  await resolveEffects(g, 0, a, a.fx.upkeep);
  eq(P(g, 0).pool.length, 1, 'as before');
});

// ======================================================================================== 2E-4 triggers and delayed effects
const delinaGame = async (pred, rules) => {
  for (let seed = 1; seed < 200; seed++) {
    const g = await scenario([{ battlefield: ['Delina, Wild Mage', 'Grizzly Bears'] }, {}], { seed, rules });
    const d = find(g, 0, 'Delina, Wild Mage');
    d.attacking = 1;
    await resolveEffects(g, 0, d, d.fx.attack, []);
    const rolls = [...logText(g).matchAll(/rolls a d20: (\d+)/g)].map(m => +m[1]);
    if (pred(rolls)) return { g, d, rolls };
  }
  throw new Error('no seed gave that roll');
};
await test('Delina: on 1-14 a tapped, attacking, non-legendary token copy; Delina stays; the token is exiled at end of combat', async () => {
  const { g, d, rolls } = await delinaGame(r => r[0] <= 14);
  const toks = P(g, 0).battlefield.filter(o => o.token);
  eq([d.zone, toks.length, toks[0]?.tapped, toks[0]?.attacking, rolls.length], ['battlefield', 1, true, 1, 1], 'one attacking copy');
  ok((g.endCombat26 || []).includes(toks[0]), 'marked for end of combat');
  for (const o of (g.endCombat26 || []).splice(0)) g.move(o, 'exile');
  eq(P(g, 0).battlefield.filter(o => o.token).length, 0, 'gone after combat');
});
await test('Delina: on 15-20 one token and a reroll; the copies are of the same creature', async () => {
  const { g, rolls } = await delinaGame(r => r[0] >= 15);
  const toks = P(g, 0).battlefield.filter(o => o.token);
  ok(rolls.length >= 2, `rolled again: ${rolls}`);
  eq(toks.length, rolls.length, 'a token per roll');
  eq(new Set(toks.map(o => o.card.name)).size, 1, 'all copies of one creature');
});
await test('Delina at rules 25: nothing is created and Delina stays (old replays: the 2D reading)', async () => {
  const { g, d } = await delinaGame(r => r[0] <= 14, 25);
  eq([d.zone, P(g, 0).battlefield.filter(o => o.token).length], ['battlefield', 0], 'as at rules 25');
});
await test('Not Dead After All: the creature returns tapped when it dies this turn; not next turn', async () => {
  const g = await scenario([{ hand: ['Not Dead After All'], battlefield: ['Grizzly Bears', 'Llanowar Elves'] }, {}]);
  const o = find(g, 0, 'Not Dead After All', 'hand'), b = find(g, 0, 'Grizzly Bears'), e = find(g, 0, 'Llanowar Elves');
  await resolveEffects(g, 0, o, o.fx.spell, [tgtObj(b)]);
  g.sacrifice(P(g, 0), b); await settle(g);
  eq([b.zone, b.tapped], ['battlefield', true], 'returned tapped');
  await resolveEffects(g, 0, o, o.fx.spell, [tgtObj(e)]);
  g.turn++;
  g.sacrifice(P(g, 0), e); await settle(g);
  eq(e.zone, 'graveyard', 'the next turn it stays dead');
});
await test('Undying Malice (same mechanic): the creature returns tapped with a +1/+1 counter; any creature is a legal target', async () => {
  const g = await scenario([{ hand: ['Undying Malice'] }, { battlefield: ['Grizzly Bears'] }]);
  const o = find(g, 0, 'Undying Malice', 'hand'), b = find(g, 1, 'Grizzly Bears');
  await resolveEffects(g, 0, o, o.fx.spell, [tgtObj(b)]);
  g.sacrifice(P(g, 1), b); await settle(g);
  eq([b.zone, b.controller, b.tapped, b.counters], ['battlefield', 1, true, 1], "returned under its owner's control, tapped, with a counter");
});
await test("Not Dead After All: an opponent's creature is not a legal target", async () => {
  const g = await scenario([{ hand: ['Not Dead After All'], battlefield: ['Grizzly Bears'] }, { battlefield: ['Llanowar Elves'] }]);
  const o = find(g, 0, 'Not Dead After All', 'hand');
  const { targetLegal } = await import('../public/js/resolve.js');
  eq([targetLegal(g, P(g, 0), o.fx.spell[0], tgtObj(find(g, 0, 'Grizzly Bears')), o), targetLegal(g, P(g, 0), o.fx.spell[0], tgtObj(find(g, 1, 'Llanowar Elves')), o)], [true, false], 'yours, theirs');
});

// ======================================================================================== 2E-5 zones and 2E-7 combat
await test('Terastodon destroys up to three noncreature permanents; each controller gets an Elephant per permanent (multiplayer)', async () => {
  const g = await scenario([{ battlefield: ['Terastodon'] }, { battlefield: ['Sol Ring', 'Glorious Anthem'] }, { battlefield: ['Gilded Lotus', 'Grizzly Bears'] }]);
  const t = find(g, 0, 'Terastodon');
  await resolveEffects(g, 0, t, t.fx.etb, [tgtObj(find(g, 1, 'Sol Ring')), tgtObj(find(g, 1, 'Glorious Anthem')), tgtObj(find(g, 2, 'Gilded Lotus'))]);
  const eleph = i => P(g, i).battlefield.filter(o => o.token).length;
  eq([eleph(0), eleph(1), eleph(2), find(g, 2, 'Grizzly Bears')?.zone], [0, 2, 1, 'battlefield'], 'two for P2, one for P3, the creature untouched');
  noErrors(g);
});
await test("Terastodon: a creature is not a legal target; rules 25: the ETB does nothing (old replays)", async () => {
  const g = await scenario([{ battlefield: ['Terastodon'] }, { battlefield: ['Grizzly Bears'] }]);
  const t = find(g, 0, 'Terastodon');
  const { targetLegal } = await import('../public/js/resolve.js');
  eq(targetLegal(g, P(g, 0), t.fx.etb[0], tgtObj(find(g, 1, 'Grizzly Bears')), t), false, 'creature');
  const old = await scenario([{ battlefield: ['Terastodon'] }, { battlefield: ['Sol Ring'] }], { rules: 25 });
  const t2 = find(old, 0, 'Terastodon');
  await resolveEffects(old, 0, t2, t2.fx.etb, [tgtObj(find(old, 1, 'Sol Ring'))]);
  eq(find(old, 1, 'Sol Ring').zone, 'battlefield', 'rules 25');
});
await test('The Eternal Wanderer: only one creature can attack it each combat; the others are not declared', async () => {
  const g = await scenario([{ battlefield: ['Grizzly Bears', 'Craterhoof Behemoth'] }, { battlefield: ['The Eternal Wanderer'] }]);
  const w = find(g, 1, 'The Eternal Wanderer');
  w.loyalty = 5;
  for (const o of P(g, 0).battlefield) o.sick = false;
  g.active = 0;
  P(g, 0).agent.declareAttackers = () => P(g, 0).battlefield.filter(o => o.fx.type.creature).map(o => ({ o, target: 1, obj: w }));
  P(g, 1).agent.declareBlockers = () => [];
  await g.combat(P(g, 0)); await settle(g);
  eq(P(g, 0).battlefield.filter(o => o.tapped).map(o => o.card.name), ['Craterhoof Behemoth'], 'only the strongest attacked');
});
await test("Rite of the Raging Storm: a Lightning Rager can't attack the Rite's controller, but can attack another player", async () => {
  const g = await scenario([{ battlefield: ['Rite of the Raging Storm'] }, {}, {}]);
  g.active = 1;
  g.fire('upkeep', { p: 1 }); await settle(g);
  const rager = P(g, 1).battlefield.find(o => o.token);
  rager.sick = false;
  P(g, 1).agent.declareAttackers = () => [{ o: rager, target: 0 }];
  await g.combat(P(g, 1)); await settle(g);
  eq([rager.tapped, P(g, 0).life], [false, 40], 'no attack on the Rite player');
  rager.tapped = false;
  P(g, 1).agent.declareAttackers = () => [{ o: rager, target: 2 }];
  P(g, 2).agent.declareBlockers = () => [];
  await g.combat(P(g, 1)); await settle(g);
  ok(P(g, 2).life < 40, `P3 hit: ${P(g, 2).life}`);
});

const failed = results.filter(([, e]) => e);
for (const [n, e] of failed) console.log(`FAIL ${n}\n     ${e.message.split('\n')[0]}`);
for (const [n, e] of results) if (!e) console.log(`  ok   ${n}`);
console.log(`Repairs (Phase 2E): ${results.length} tests, ${results.length - failed.length} passed, ${failed.length} failed.`);
process.exit(failed.length ? 1 : 0);
