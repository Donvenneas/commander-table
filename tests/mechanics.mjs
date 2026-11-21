// Phase 2D reusable mechanics (rules 25): each test builds a small board from real cards (tests/scenario.mjs) and checks
// one mechanic as the rules give it, an edge case, an interaction, and that a rules 24 game (older replays) still plays
// the old way. The Phase 2C audit (audit/phase-2c) lists the defects these close.
//   node tests/mechanics.mjs              run them all (exit 1 on any failure)
//   node tests/mechanics.mjs Persist      only the tests whose name contains "Persist"
import { scenario, find, all, P, tgtObj, resolveEffects, settle, errors, logText, card } from './scenario.mjs';
import { HumanAgent } from '../public/js/human.js';
import { targetLegal, counterFits, legalTargets } from '../public/js/resolve.js';

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
const tokens = (g, i, re) => P(g, i).battlefield.filter(o => o.token && re.test(o.card.name)).length;
// A spell on the stack, as a stack item a counterspell can target (controller, targets)
const onStack = (g, i, name, targets = [], zone = 'hand') => {
  const o = find(g, i, name, zone);
  const arr = P(g, i)[zone]; arr.splice(arr.indexOf(o), 1); o.zone = 'stack';
  const item = { o, p: P(g, i), targets, x: 0, ability: false };
  g.stack.push(item);
  return item;
};

// ======================================================================================== 2D-1 conditions
await test('Unread condition outside resolution is not met: Not of This World costs {7} (rules 25), {0} before', async () => {
  const g = await scenario([{ hand: ['Not of This World'] }, {}]);
  const c = g.costOf(P(g, 0), find(g, 0, 'Not of This World', 'hand')).c;
  eq(c.generic, 7, 'generic cost');
  const old = await scenario([{ hand: ['Not of This World'] }, {}], { rules: 24 });
  eq(old.costOf(P(old, 0), find(old, 0, 'Not of This World', 'hand')).c.generic, 0, 'rules 24: as before');
});
await test('Unread condition outside resolution: The Indomitable is not castable from the graveyard (rules 25)', async () => {
  const g = await scenario([{ graveyard: ['The Indomitable'] }, {}]);
  mana(g, 0);
  eq(g.castModeRaw(P(g, 0), find(g, 0, 'The Indomitable', 'graveyard')), null, 'cast mode');
});
await test('"If a creature is destroyed this way": Noxious Gearhulk gains the toughness it last had', async () => {
  const g = await scenario([{ battlefield: ['Noxious Gearhulk'] }, { battlefield: ['Craterhoof Behemoth'] }]);
  const n = find(g, 0, 'Noxious Gearhulk'), v = find(g, 1, 'Craterhoof Behemoth');
  await resolveEffects(g, 0, n, n.fx.etb, [tgtObj(v)]);
  eq([v.zone, P(g, 0).life], ['graveyard', 45], 'destroyed and life (toughness 5)'); noErrors(g);
});
await test('"Destroyed this way" edge: an indestructible target is not destroyed, so no life (Noxious Gearhulk)', async () => {
  const g = await scenario([{ battlefield: ['Noxious Gearhulk'] }, { battlefield: ['Craterhoof Behemoth'] }]);
  const n = find(g, 0, 'Noxious Gearhulk'), v = find(g, 1, 'Craterhoof Behemoth');
  v.tempKw = new Set(['indestructible']);
  await resolveEffects(g, 0, n, n.fx.etb, [tgtObj(v)]);
  eq([v.zone, P(g, 0).life], ['battlefield', 40], 'not destroyed, no life');
});
await test('"Destroyed this way" with a replacement: under Rest in Peace the creature is exiled but was destroyed (life gained)', async () => {
  const g = await scenario([{ battlefield: ['Noxious Gearhulk', 'Rest in Peace'] }, { battlefield: ['Craterhoof Behemoth'] }]);
  const n = find(g, 0, 'Noxious Gearhulk'), v = find(g, 1, 'Craterhoof Behemoth');
  await resolveEffects(g, 0, n, n.fx.etb, [tgtObj(v)]);
  eq([v.zone, P(g, 0).life], ['exile', 45], 'exiled, life gained');
});
await test('"Destroyed this way" rules 24: no life, as before', async () => {
  const g = await scenario([{ battlefield: ['Noxious Gearhulk'] }, { battlefield: ['Craterhoof Behemoth'] }], { rules: 24 });
  const n = find(g, 0, 'Noxious Gearhulk');
  await resolveEffects(g, 0, n, n.fx.etb, [tgtObj(find(g, 1, 'Craterhoof Behemoth'))]);
  eq(P(g, 0).life, 40, 'life');
});
await test('"If you can\'t": Eldrazi Monument is sacrificed with no creature, stays when one is sacrificed', async () => {
  const g = await scenario([{ battlefield: ['Eldrazi Monument'] }, {}]);
  const m = find(g, 0, 'Eldrazi Monument');
  await resolveEffects(g, 0, m, m.fx.upkeep);
  eq(m.zone, 'graveyard', 'no creature: Monument sacrificed');
  const g2 = await scenario([{ battlefield: ['Eldrazi Monument', 'Grizzly Bears'] }, {}]);
  const m2 = find(g2, 0, 'Eldrazi Monument');
  await resolveEffects(g2, 0, m2, m2.fx.upkeep);
  eq([m2.zone, find(g2, 0, 'Grizzly Bears', 'graveyard')?.zone], ['battlefield', 'graveyard'], 'creature sacrificed, Monument stays'); noErrors(g2);
});
await test('Last-known information: Unstoppable Slasher returns when it died with no counters, not with one', async () => {
  const g = await scenario([{ battlefield: ['Unstoppable Slasher'] }, {}]);
  const s = find(g, 0, 'Unstoppable Slasher');
  g.sacrifice(P(g, 0), s); await settle(g);
  eq(s.zone, 'battlefield', 'returned');
  const g2 = await scenario([{ battlefield: [{ name: 'Unstoppable Slasher', counters: 1 }] }, {}]);
  const s2 = find(g2, 0, 'Unstoppable Slasher');
  g2.sacrifice(P(g2, 0), s2); await settle(g2);
  eq(s2.zone, 'graveyard', 'had a counter: stays'); noErrors(g2);
});
await test('Cost paid: Witch\'s Oven makes two Food for a creature with toughness 4+, one otherwise', async () => {
  const g = await scenario([{ battlefield: ["Witch's Oven", "Witch's Oven", 'Craterhoof Behemoth', 'Grizzly Bears'] }, {}]);
  const [o1, o2] = all(g, 0, "Witch's Oven");
  await g.sacTo(P(g, 0), o1, find(g, 0, 'Craterhoof Behemoth')); await settle(g);
  eq(tokens(g, 0, /food/i), 2, 'toughness 9: two');
  await g.sacTo(P(g, 0), o2, find(g, 0, 'Grizzly Bears')); await settle(g);
  eq(tokens(g, 0, /food/i), 3, 'toughness 2: one more'); noErrors(g);
});
await test('Cost paid: Nasty End draws three when the sacrificed creature was legendary', async () => {
  const g = await scenario([{ hand: ['Nasty End'], battlefield: ['Sheoldred, the Apocalypse'] }, {}]);
  mana(g, 0);
  const h = P(g, 0).hand.length;
  ok(await g.cast(P(g, 0), find(g, 0, 'Nasty End', 'hand')), 'cast'); await settle(g);
  eq(P(g, 0).hand.length - (h - 1), 3, 'cards drawn'); noErrors(g);
});
await test('Alternative cost paid: Baleful Mastery for {1}{B} makes an opponent draw; the full cost does not', async () => {
  const g = await scenario([{ hand: ['Baleful Mastery'] }, { battlefield: ['Craterhoof Behemoth'] }]);
  mana(g, 0);
  const h = P(g, 1).hand.length;
  ok(await g.cast(P(g, 0), find(g, 0, 'Baleful Mastery', 'hand'), { mode: { alt: 'altMana' } }), 'cast');
  await settle(g);
  eq(P(g, 1).hand.length - h, 1, 'opponent drew one');
  const g2 = await scenario([{ hand: ['Baleful Mastery'] }, { battlefield: ['Craterhoof Behemoth'] }]);
  mana(g2, 0);
  const h2 = P(g2, 1).hand.length;
  ok(await g2.cast(P(g2, 0), find(g2, 0, 'Baleful Mastery', 'hand'), { mode: { alt: null } }), 'cast');
  await settle(g2);
  eq(P(g2, 1).hand.length - h2, 0, 'normal cost: nobody draws'); noErrors(g2);
});
await test('Cast history: Approach of the Second Sun goes 7th from the top, then the second cast from hand wins', async () => {
  const g = await scenario([{ hand: ['Approach of the Second Sun'], library: ['Forest', 'Forest', 'Forest', 'Forest', 'Forest', 'Forest', 'Forest', 'Forest'], filler: 0 }, {}]);
  mana(g, 0);
  const a = find(g, 0, 'Approach of the Second Sun', 'hand');
  ok(await g.cast(P(g, 0), a, { mode: { alt: null } }), 'first cast'); await settle(g);
  const lib = P(g, 0).library;
  eq([a.zone, lib.length - 1 - lib.indexOf(a), P(g, 0).life, g.over], ['library', 6, 47, false], 'seventh from the top, +7, no win');
  // (draw down to it and cast it again)
  lib.splice(lib.indexOf(a), 1); P(g, 0).hand.push(a); a.zone = 'hand';
  ok(await g.cast(P(g, 0), a, { mode: { alt: null } }), 'second cast'); await settle(g);
  eq(g.winner?.idx, 0, 'second cast from hand wins');
});
await test('"Then if you\'re the monarch": Court of Garenbrig doubles only for the monarch (rules 25), always at rules 24', async () => {
  for (const [rules, monarch, want] of [[25, 1, 2], [25, 0, 4], [24, 1, 4]]) {
    const g = await scenario([{ battlefield: ['Court of Garenbrig', { name: 'Grizzly Bears', counters: 2 }] }, {}], { rules });
    g.monarch = monarch;
    const c = find(g, 0, 'Court of Garenbrig');
    await resolveEffects(g, 0, c, c.fx.upkeep.slice(1));
    eq(find(g, 0, 'Grizzly Bears').counters, want, `rules ${rules}, monarch P${monarch + 1}`);
  }
});
await test('Intervening if (603.4): Revel in Riches does not trigger with nine Treasures, and checks again on resolution', async () => {
  const g = await scenario([{ battlefield: ['Revel in Riches'] }, {}]);
  const p = P(g, 0), r = find(g, 0, 'Revel in Riches');
  for (let k = 0; k < 9; k++) g.createArtifactToken(p, 'treasure', r);
  g.trigger(r, 'upkeep'); await settle(g);
  ok(/doesn't trigger/.test(logText(g)) && !g.over, 'nine: no trigger');
  g.createArtifactToken(p, 'treasure', r);
  g.trigger(r, 'upkeep'); await settle(g);
  eq(g.winner?.idx, 0, 'ten: wins');
});
await test('Multiple simultaneous triggers: two Unstoppable Slashers dying together each check their own counters', async () => {
  const g = await scenario([{ battlefield: ['Unstoppable Slasher', { name: 'Unstoppable Slasher', counters: 2 }] }, { hand: ['Damnation'] }]);
  const [a, b] = all(g, 0, 'Unstoppable Slasher');
  const w = find(g, 1, 'Damnation', 'hand');
  await resolveEffects(g, 1, w, w.fx.spell);
  eq([a.zone, b.zone].sort(), ['battlefield', 'graveyard'], 'only the one without counters returns'); noErrors(g);
});

await test('"Then if your library has no cards in it": Jace, Wielder of Mysteries -8 wins only with an empty library (rules 24: always)', async () => {
  for (const [rules, lib, want] of [[25, 3, false], [25, 0, true], [24, 3, true]]) {
    const g = await scenario([{ battlefield: ['Jace, Wielder of Mysteries'], library: Array(lib).fill('Island'), filler: 0 }, {}], { rules });
    const j = find(g, 0, 'Jace, Wielder of Mysteries');
    const ab = j.fx.pw.find(a => a.cost === -8);
    // (it draws seven first: ten cards leave three; none leaves the library empty)
    P(g, 0).library.length = 0;
    if (lib) { const filler = await scenario([{ library: Array(10).fill('Island'), filler: 0 }, {}]); for (const c of P(filler, 0).library) { c.owner = 0; c.controller = 0; P(g, 0).library.push(c); } }
    await resolveEffects(g, 0, j, ab.effects);
    eq(g.winner?.idx === 0, want, `rules ${rules}, ${lib ? 'cards left after drawing' : 'library empty'}`);
  }
});
await test('"Then if there are three or more landmark counters on it": Treasure Map transforms only on the third', async () => {
  const g = await scenario([{ battlefield: ['Treasure Map // Treasure Cove'] }, {}]);
  const t = P(g, 0).battlefield[0];
  const ab = t.fx.abilities.find(a => a.effects.some(e => e.k === 'if'));
  await resolveEffects(g, 0, t, ab.effects);
  eq(tokens(g, 0, /treasure/i), 0, 'first activation: no Treasures');
  t.named = { landmark: 2 };
  await resolveEffects(g, 0, t, ab.effects);
  eq(tokens(g, 0, /treasure/i), 3, 'third landmark counter: three Treasures');
});

// ======================================================================================== 2D-1 targets
await test('Graveyard target words: Persist can\'t return a legendary creature; a nonlegendary one gets a -1/-1 counter', async () => {
  const g = await scenario([{ hand: ['Persist', 'Persist'], graveyard: ['Sheoldred, the Apocalypse'] }, {}]);
  const [p1] = all(g, 0, 'Persist', 'hand');
  await resolveEffects(g, 0, p1, p1.fx.spell);
  eq(find(g, 0, 'Sheoldred, the Apocalypse', 'graveyard')?.zone, 'graveyard', 'legendary stays');
  const g2 = await scenario([{ hand: ['Persist'], graveyard: ['Grizzly Bears', 'Sheoldred, the Apocalypse'] }, {}]);
  const p2 = find(g2, 0, 'Persist', 'hand');
  await resolveEffects(g2, 0, p2, p2.fx.spell);
  const c = find(g2, 0, 'Grizzly Bears');
  ok(c, 'Bears returned'); eq([c.counters, g2.power(c)], [-1, 1], 'with a -1/-1 counter'); noErrors(g2);
});
await test('Graveyard target words for a person: Persist offers only nonlegendary creature cards', async () => {
  const g = await scenario([{ hand: ['Persist'], graveyard: ['Craterhoof Behemoth', 'Sheoldred, the Apocalypse'] }, {}]);
  const offered = [];
  P(g, 0).agent = new HumanAgent('balanced', { ask: async (html, o) => { offered.push(...(o.objs || o.cards || []).map(x => x.card.name)); return { obj: (o.objs || o.cards || [])[0] }; } });
  const p = find(g, 0, 'Persist', 'hand');
  await resolveEffects(g, 0, p, p.fx.spell);
  ok(!offered.includes('Sheoldred, the Apocalypse'), `offered: ${offered.join(', ')}`);
});
await test('Rules 24: Persist still returns a legendary creature without a counter (old replays)', async () => {
  const g = await scenario([{ hand: ['Persist'], graveyard: ['Sheoldred, the Apocalypse'] }, {}], { rules: 24 });
  const p = find(g, 0, 'Persist', 'hand');
  await resolveEffects(g, 0, p, p.fx.spell);
  eq(find(g, 0, 'Sheoldred, the Apocalypse')?.counters, 0, 'returned as before');
});
await test('Counted mana value limit: Drown in the Loch\'s destroy mode depends on the controller\'s graveyard size', async () => {
  const g = await scenario([{ hand: ['Drown in the Loch'] }, { battlefield: ['Craterhoof Behemoth'] }]);
  const o = find(g, 0, 'Drown in the Loch', 'hand'), v = find(g, 1, 'Craterhoof Behemoth');
  const e = o.fx.modes.modes[1][0];
  eq(targetLegal(g, P(g, 0), e, tgtObj(v), o), false, 'MV 8, empty graveyard: illegal');
  for (let k = 0; k < 8; k++) g.move(P(g, 1).library.at(-1), 'graveyard');
  eq(targetLegal(g, P(g, 0), e, tgtObj(v), o), true, 'eight cards: legal');
});
await test('Counterspell limits: Drown in the Loch can\'t counter a spell above the graveyard count', async () => {
  const g = await scenario([{ hand: ['Drown in the Loch'] }, { hand: ['Craterhoof Behemoth'] }]);
  const d = find(g, 0, 'Drown in the Loch', 'hand');
  const item = onStack(g, 1, 'Craterhoof Behemoth');
  eq(counterFits(g, d.fx.modes.modes[0][0], item, P(g, 0)), false, 'MV 8 against 0 cards');
  await resolveEffects(g, 0, d, d.fx.modes.modes[0], [{ spell: item }]);
  ok(!item.countered, 'not countered');
});
await test('Counterspell limits: Not of This World counters only what targets your permanents', async () => {
  const g = await scenario([{ hand: ['Not of This World'], battlefield: ['Grizzly Bears'] }, { hand: ['Swords to Plowshares', 'Lightning Bolt'], battlefield: ['Llanowar Elves'] }]);
  const n = find(g, 0, 'Not of This World', 'hand'), e = n.fx.spell[0];
  const atMine = onStack(g, 1, 'Swords to Plowshares', [tgtObj(find(g, 0, 'Grizzly Bears'))]);
  const atTheirs = onStack(g, 1, 'Lightning Bolt', [tgtObj(find(g, 1, 'Llanowar Elves'))]);
  eq([counterFits(g, e, atMine, P(g, 0)), counterFits(g, e, atTheirs, P(g, 0))], [true, false], 'legal targets');
  await resolveEffects(g, 0, n, n.fx.spell, [{ spell: atTheirs }]);
  ok(!atTheirs.countered, 'a spell aimed elsewhere is not countered');
});
await test('Attach target words: Mithril Coat attaches only to a legendary creature you control (none: unattached)', async () => {
  const g = await scenario([{ battlefield: ['Mithril Coat', 'Grizzly Bears'] }, { battlefield: ['Sheoldred, the Apocalypse'] }]);
  const m = find(g, 0, 'Mithril Coat');
  await resolveEffects(g, 0, m, m.fx.etb);
  eq(m.attachedTo?.card.name ?? null, null, 'no legendary creature of yours: unattached');
  const g2 = await scenario([{ battlefield: ['Mithril Coat', 'Grizzly Bears', 'Sheoldred, the Apocalypse'] }, {}]);
  const m2 = find(g2, 0, 'Mithril Coat');
  await resolveEffects(g2, 0, m2, m2.fx.etb);
  eq(m2.attachedTo?.card.name, 'Sheoldred, the Apocalypse', 'attached to the legend'); noErrors(g2);
});
await test('Determinism: the same game with the 2D-1 cards gives the same log twice', async () => {
  const run = async () => {
    const g = await scenario([{ battlefield: ['Noxious Gearhulk', 'Eldrazi Monument', "Witch's Oven", 'Craterhoof Behemoth'] }, { battlefield: ['Grizzly Bears'] }], { seed: 7 });
    const n = find(g, 0, 'Noxious Gearhulk'), m = find(g, 0, 'Eldrazi Monument');
    await resolveEffects(g, 0, n, n.fx.etb, [tgtObj(find(g, 1, 'Grizzly Bears'))]);
    await resolveEffects(g, 0, m, m.fx.upkeep);
    return logText(g);
  };
  eq(await run(), await run(), 'logs');
});

// ======================================================================================== 2D-2 mana restrictions
const untapped = (g, i, name) => { const o = find(g, i, name); o.sick = false; o.tapped = false; return o; };
await test("Spend restriction: Delighted Halfling's colored mana pays a legendary spell, not Lightning Bolt", async () => {
  const g = await scenario([{ battlefield: ['Delighted Halfling'], hand: ['Lightning Bolt', 'Ragavan, Nimble Pilferer'] }, {}]);
  untapped(g, 0, 'Delighted Halfling'); g.active = 0;
  eq([!!g.canCast(P(g, 0), find(g, 0, 'Lightning Bolt', 'hand')), !!g.canCast(P(g, 0), find(g, 0, 'Ragavan, Nimble Pilferer', 'hand'))], [false, true], 'Bolt, Ragavan');
  const old = await scenario([{ battlefield: ['Delighted Halfling'], hand: ['Lightning Bolt'] }, {}], { rules: 24 });
  untapped(old, 0, 'Delighted Halfling'); old.active = 0;
  eq(!!old.canCast(P(old, 0), find(old, 0, 'Lightning Bolt', 'hand')), true, 'rules 24: as before');
});
await test("Spend restriction rider: a legendary spell paid with Delighted Halfling's mana can't be countered", async () => {
  const g = await scenario([{ battlefield: ['Delighted Halfling'], hand: ['Ragavan, Nimble Pilferer'] }, {}]);
  untapped(g, 0, 'Delighted Halfling'); g.active = 0;
  const r = find(g, 0, 'Ragavan, Nimble Pilferer', 'hand');
  g.payingFor = { o: r, ability: false };
  const us = g.units(P(g, 0));
  g.payingFor = null;
  ok(us.some(u => u.cavern && u.colors.includes('R')), 'the unit carries the rider');
  ok(await g.cast(P(g, 0), r), 'cast'); await settle(g);
  eq(r.zone, 'battlefield', 'resolved'); noErrors(g);
});
await test("Spend restriction tapped by hand: the mana in the pool still can't pay Lightning Bolt", async () => {
  const g = await scenario([{ battlefield: ['Delighted Halfling'], hand: ['Lightning Bolt'] }, {}]);
  const h = untapped(g, 0, 'Delighted Halfling'); g.active = 0;
  g.tapForMana(P(g, 0), h);
  eq(P(g, 0).pool.length, 1, 'one mana in the pool');
  eq(!!g.canCast(P(g, 0), find(g, 0, 'Lightning Bolt', 'hand')), false, 'Bolt');
});
await test("Chosen type: Secluded Courtyard's colored mana pays an Elf; for anything else only {C}", async () => {
  const g = await scenario([{ battlefield: ['Secluded Courtyard'], hand: ['Llanowar Elves'] }, {}]);
  untapped(g, 0, 'Secluded Courtyard').chosenType = 'elf'; g.active = 0;
  eq(!!g.canCast(P(g, 0), find(g, 0, 'Llanowar Elves', 'hand')), true, 'Elf');
  const g2 = await scenario([{ battlefield: ['Secluded Courtyard', 'Forest'], hand: ['Grizzly Bears'] }, {}]);
  untapped(g2, 0, 'Secluded Courtyard').chosenType = 'elf'; untapped(g2, 0, 'Forest'); g2.active = 0;
  eq(!!g2.canCast(P(g2, 0), find(g2, 0, 'Grizzly Bears', 'hand')), true, 'Bears with a Forest ({C} for the generic)');
  const g3 = await scenario([{ battlefield: ['Secluded Courtyard'], hand: ['Grizzly Bears'] }, {}]);
  untapped(g3, 0, 'Secluded Courtyard').chosenType = 'elf'; g3.active = 0;
  g3.payingFor = { o: find(g3, 0, 'Grizzly Bears', 'hand'), ability: false };
  eq(g3.units(P(g3, 0)).map(u => u.colors.join('')).join(), 'C', 'for a Bear: only {C}');
  g3.payingFor = null;
});
await test('Mana ability condition: Mox Jasper makes mana only while you control a Dragon', async () => {
  const g = await scenario([{ battlefield: ['Mox Jasper'], hand: ['Lightning Bolt'] }, {}]);
  untapped(g, 0, 'Mox Jasper'); g.active = 0;
  eq(!!g.canCast(P(g, 0), find(g, 0, 'Lightning Bolt', 'hand')), false, 'no Dragon');
  const g2 = await scenario([{ battlefield: ['Mox Jasper', 'Ancient Bronze Dragon'], hand: ['Lightning Bolt'] }, {}]);
  untapped(g2, 0, 'Mox Jasper'); g2.active = 0;
  eq(!!g2.canCast(P(g2, 0), find(g2, 0, 'Lightning Bolt', 'hand')), true, 'with a Dragon');
});
await test('Mana ability condition: Floodfarm Verge adds {U} only with a Plains or an Island', async () => {
  const g = await scenario([{ battlefield: ['Floodfarm Verge'] }, {}]);
  untapped(g, 0, 'Floodfarm Verge');
  eq(g.manaUnitsOf(P(g, 0), find(g, 0, 'Floodfarm Verge')).map(u => [...u.colors].sort().join('')).join(), 'W', 'alone: {W}');
  const g2 = await scenario([{ battlefield: ['Floodfarm Verge', 'Island'] }, {}]);
  untapped(g2, 0, 'Floodfarm Verge');
  eq(g2.manaUnitsOf(P(g2, 0), find(g2, 0, 'Floodfarm Verge')).map(u => [...u.colors].sort().join('')).join(), 'UW', 'with an Island: {W} or {U}');
});
await test("Mana kept all turn: Birgi's {R} survives phase changes this turn and empties next turn", async () => {
  const g = await scenario([{ battlefield: ['Birgi, God of Storytelling // Harnfel, Horn of Bounty'] }, {}]);
  const b = P(g, 0).battlefield.find(o => /Birgi/.test(o.card.name));
  await resolveEffects(g, 0, b, b.fx.onCast.effects);
  g.setPhase('combat'); g.setPhase('main2');
  eq(P(g, 0).pool.length, 1, 'kept through combat');
  g.turn++; g.setPhase('upkeep');
  eq(P(g, 0).pool.length, 0, 'gone next turn');
  const old = await scenario([{ battlefield: ['Birgi, God of Storytelling // Harnfel, Horn of Bounty'] }, {}], { rules: 24 });
  const b2 = P(old, 0).battlefield.find(o => /Birgi/.test(o.card.name));
  await resolveEffects(old, 0, b2, b2.fx.onCast.effects);
  old.setPhase('combat');
  eq(P(old, 0).pool.length, 0, 'rules 24: emptied as before');
});
await test("Spend restriction for spells only: Gwenna's mana pays a creature spell, not Lightning Bolt", async () => {
  const g = await scenario([{ battlefield: ['Gwenna, Eyes of Gaea'], hand: ['Grizzly Bears', 'Lightning Bolt'] }, {}]);
  untapped(g, 0, 'Gwenna, Eyes of Gaea'); g.active = 0;
  eq([!!g.canCast(P(g, 0), find(g, 0, 'Grizzly Bears', 'hand')), !!g.canCast(P(g, 0), find(g, 0, 'Lightning Bolt', 'hand'))], [true, false], 'Bears, Bolt');
});

// ======================================================================================== 2D-2 permissions
await test('Graveyard lands: Crucible of Worlds plays a land from the graveyard, not from the top of the library', async () => {
  const g = await scenario([{ battlefield: ['Crucible of Worlds'], graveyard: ['Polluted Delta'], library: ['Island'], filler: 0 }, {}]);
  g.active = 0;
  eq(g.topPlayable(P(g, 0), P(g, 0).library.at(-1)), false, 'top of the library');
  ok(await g.playLand(P(g, 0), find(g, 0, 'Polluted Delta', 'graveyard')), 'played from the graveyard');
  eq(P(g, 0).landsPlayed, 1, 'uses the land drop');
  const g2 = await scenario([{ battlefield: ['Crucible of Worlds'], graveyard: ['Forest'], hand: ['Island'] }, {}]);
  g2.active = 0; P(g2, 0).landsPlayed = 1;
  eq(await g2.playLand(P(g2, 0), find(g2, 0, 'Forest', 'graveyard')), false, 'no land drop left');
});
await test('Graveyard lands: the AI replays a fetch land from its graveyard with Crucible of Worlds', async () => {
  const g = await scenario([{ battlefield: ['Crucible of Worlds'], graveyard: ['Polluted Delta'], hand: ['Forest'] }, {}]);
  g.active = 0;
  eq(P(g, 0).agent.chooseLand(g, P(g, 0))?.card.name, 'Polluted Delta', 'chosen land');
});
await test('Free casting from hand: Omniscience casts Craterhoof for nothing; the top of the library stays shut', async () => {
  const g = await scenario([{ battlefield: ['Omniscience'], hand: ['Craterhoof Behemoth'], library: ['Lightning Bolt'], filler: 0 }, {}]);
  g.active = 0;
  eq(g.castModeRaw(P(g, 0), find(g, 0, 'Craterhoof Behemoth', 'hand'))?.alt, 'free', 'free from hand');
  eq(g.topPlayable(P(g, 0), P(g, 0).library.at(-1)), false, 'library top');
});
await test('Flash for kinds of spells: Yeva lets green creature spells be cast at instant speed, not others', async () => {
  const g = await scenario([{ battlefield: ["Yeva, Nature's Herald"], hand: ['Llanowar Elves', 'Sheoldred, the Apocalypse'] }, {}]);
  g.active = 1; g.phase = 'combat';
  const { castTimingOk } = await import('../public/js/mana.js');
  eq([castTimingOk(g, P(g, 0), find(g, 0, 'Llanowar Elves', 'hand')), castTimingOk(g, P(g, 0), find(g, 0, 'Sheoldred, the Apocalypse', 'hand'))], [true, false], 'Elves, Sheoldred');
});
await test('Graveyard casting: Chainer allows one creature spell, not Lightning Bolt', async () => {
  const g = await scenario([{ battlefield: ['Chainer, Nightmare Adept'], graveyard: ['Lightning Bolt', 'Grizzly Bears', 'Llanowar Elves'], hand: ['Forest'] }, {}]);
  mana(g, 0);
  const c = find(g, 0, 'Chainer, Nightmare Adept');
  await resolveEffects(g, 0, c, c.fx.abilities[0].effects);
  eq([!!g.canCast(P(g, 0), find(g, 0, 'Lightning Bolt', 'graveyard')), !!g.canCast(P(g, 0), find(g, 0, 'Grizzly Bears', 'graveyard'))], [false, true], 'Bolt, Bears');
  ok(await g.cast(P(g, 0), find(g, 0, 'Grizzly Bears', 'graveyard')), 'Bears cast'); await settle(g);
  eq(!!g.canCast(P(g, 0), find(g, 0, 'Llanowar Elves', 'graveyard')), false, 'a second creature: no');
});
await test('Graveyard casting: Emry allows the one chosen artifact card, not another', async () => {
  const g = await scenario([{ battlefield: ['Emry, Lurker of the Loch'], graveyard: ['Sol Ring', 'Mox Jasper'] }, {}]);
  mana(g, 0);
  const e = find(g, 0, 'Emry, Lurker of the Loch');
  await resolveEffects(g, 0, e, e.fx.abilities[0].effects);
  const can = ['Sol Ring', 'Mox Jasper'].map(n => !!g.canCast(P(g, 0), find(g, 0, n, 'graveyard')));
  eq(can.filter(Boolean).length, 1, `exactly one castable (${can})`);
});

// ======================================================================================== 2D-3 dynamic X
await test('Converge: Painful Truths cast with three colors draws three and loses three', async () => {
  const g = await scenario([{ hand: ['Painful Truths'], battlefield: ['Swamp', 'Island', 'Forest'] }, {}]);
  for (const o of P(g, 0).battlefield) o.tapped = false;
  g.active = 0;
  const h = P(g, 0).hand.length;
  ok(await g.cast(P(g, 0), find(g, 0, 'Painful Truths', 'hand')), 'cast'); await settle(g);
  eq([P(g, 0).hand.length - (h - 1), P(g, 0).life], [3, 37], 'drew 3, lost 3');
});
await test('Converge edge: two colors spent (Swamp, Swamp, Island) is two', async () => {
  const g = await scenario([{ hand: ['Painful Truths'], battlefield: ['Swamp', 'Swamp', 'Island'] }, {}]);
  g.active = 0;
  const h = P(g, 0).hand.length;
  ok(await g.cast(P(g, 0), find(g, 0, 'Painful Truths', 'hand')), 'cast'); await settle(g);
  eq([P(g, 0).hand.length - (h - 1), P(g, 0).life], [2, 38], 'drew 2, lost 2');
});
await test('Converge for a copy: no mana was spent on it, so X is 0 (707.10)', async () => {
  const g = await scenario([{ hand: ['Painful Truths'] }, {}]);
  const o = find(g, 0, 'Painful Truths', 'hand');
  o.convergeN = 3;
  const h = P(g, 0).hand.length;
  await resolveEffects(g, 0, o, o.fx.spell, [], { copy: true });
  eq(P(g, 0).hand.length - h, 0, 'copy draws nothing');
});
await test('"The number of creatures exiled this way": Sunfall makes a token as big as the creatures it exiled', async () => {
  const g = await scenario([{ hand: ['Sunfall'], battlefield: ['Grizzly Bears', 'Llanowar Elves'] }, { battlefield: ['Craterhoof Behemoth'] }]);
  const o = find(g, 0, 'Sunfall', 'hand');
  await resolveEffects(g, 0, o, o.fx.spell);
  const t = P(g, 0).battlefield.filter(x => x.token);
  eq(t.map(x => [g.power(x), g.toughness(x)]), [[3, 3]], 'one 3/3'); noErrors(g);
});
await test('"Where X is the result": Ancient Bronze Dragon puts as many counters as the d20 rolled', async () => {
  const g = await scenario([{ battlefield: ['Ancient Bronze Dragon', 'Grizzly Bears'] }, {}], { seed: 3 });
  const d = find(g, 0, 'Ancient Bronze Dragon');
  await resolveEffects(g, 0, d, d.fx.combatDamage, [], { trig: { o: d, target: 1, n: 7 } });
  const roll = +(logText(g).match(/rolls a d20: (\d+)/) || [])[1];
  const got = P(g, 0).battlefield.reduce((s, o) => s + Math.max(0, o.counters), 0);
  ok(roll > 0 && got === 2 * roll, `roll ${roll}, counters ${got} (X on each of two creatures)`);
});
await test('"Enters with X counters, X = greatest other power": Prime Speaker Zegana enters with 5 beside Craterhoof', async () => {
  const g = await scenario([{ battlefield: ['Craterhoof Behemoth'], hand: ['Prime Speaker Zegana'] }, {}]);
  mana(g, 0);
  const z = find(g, 0, 'Prime Speaker Zegana', 'hand');
  const h = P(g, 0).hand.length;
  ok(await g.cast(P(g, 0), z), 'cast'); await settle(g);
  eq([z.counters, P(g, 0).hand.length - (h - 1)], [5, 6], 'counters, cards drawn (its power)');
});
await test("Named counters in X: Palantír of Orthanc's mill counts its influence counters (rules 25; rules 26: tests/repairs.mjs)", async () => {
  const g = await scenario([{ battlefield: ['Palantír of Orthanc'], library: ['Forest', 'Forest', 'Forest', 'Forest', 'Forest'], filler: 0 }, {}], { rules: 25 });
  const pal = P(g, 0).battlefield[0];
  pal.named = { influence: 2 };
  const mill = pal.fx.endstep.find(e => e.k === 'mill');
  await resolveEffects(g, 0, pal, [mill]);
  eq(P(g, 0).graveyard.length, 2, 'milled 2');
});
await test('Batch amount: Quartzwood Crasher makes one token as big as all trampling damage to that player', async () => {
  const g = await scenario([{ battlefield: ['Quartzwood Crasher', 'Craterhoof Behemoth'] }, {}]);
  const q = find(g, 0, 'Quartzwood Crasher'), c = find(g, 0, 'Craterhoof Behemoth');
  c.tempKw = new Set(['trample']);
  g.fire('allyCombat', { o: q, p: 0, target: 1, n: 6 });
  g.fire('allyCombat', { o: c, p: 0, target: 1, n: 5 });
  await settle(g);
  const t = P(g, 0).battlefield.filter(x => x.token);
  eq(t.map(x => g.power(x)), [11], 'one 11/11');
});

// ======================================================================================== 2D-3 optional costs
await test('Optional cost: Grist\'s -2 destroys only when a creature is sacrificed (AI pays with a spare creature)', async () => {
  const g = await scenario([{ battlefield: ['Grist, the Hunger Tide', 'Llanowar Elves'] }, { battlefield: ['Craterhoof Behemoth'] }]);
  const gr = find(g, 0, 'Grist, the Hunger Tide');
  await resolveEffects(g, 0, gr, gr.fx.pw[1].effects);
  eq([find(g, 0, 'Llanowar Elves', 'graveyard')?.zone, find(g, 1, 'Craterhoof Behemoth', 'graveyard')?.zone], ['graveyard', 'graveyard'], 'Elves sacrificed, Craterhoof destroyed');
  const g2 = await scenario([{ battlefield: ['Grist, the Hunger Tide'] }, { battlefield: ['Craterhoof Behemoth'] }]);
  const gr2 = find(g2, 0, 'Grist, the Hunger Tide');
  await resolveEffects(g2, 0, gr2, gr2.fx.pw[1].effects);
  eq(find(g2, 1, 'Craterhoof Behemoth')?.zone, 'battlefield', 'no creature to sacrifice: nothing destroyed');
});
await test('Optional cost for a person: Wilhelt asks before sacrificing a Zombie; saying no draws nothing', async () => {
  const g = await scenario([{ battlefield: ['Wilhelt, the Rotcleaver', 'Gravecrawler'] }, {}]);
  const asked = [];
  P(g, 0).agent = new HumanAgent('balanced', { ask: async (html) => { asked.push(html.replace(/<[^>]+>/g, '')); return { button: 'no' }; } });
  const w = find(g, 0, 'Wilhelt, the Rotcleaver');
  const h = P(g, 0).hand.length;
  await resolveEffects(g, 0, w, w.fx.endstep);
  ok(asked.some(a => /sacrifice a zombie/i.test(a)), `asked: ${asked.join(' | ')}`);
  eq([P(g, 0).hand.length - h, find(g, 0, 'Gravecrawler')?.zone], [0, 'battlefield'], 'no draw, Zombie kept');
});
await test('Optional cost, rules 24: Springbloom Druid fetched without sacrificing a land (old replays)', async () => {
  const g = await scenario([{ battlefield: ['Springbloom Druid'], library: ['Forest', 'Forest'] }, {}], { rules: 24 });
  const d = find(g, 0, 'Springbloom Druid');
  const lands = P(g, 0).battlefield.filter(o => o.fx.type.land).length;
  await resolveEffects(g, 0, d, d.fx.etb);
  eq(P(g, 0).battlefield.filter(o => o.fx.type.land).length - lands, 2, 'two lands, none sacrificed');
  const g2 = await scenario([{ battlefield: ['Springbloom Druid'], library: ['Forest', 'Forest'] }, {}]);
  const d2 = find(g2, 0, 'Springbloom Druid');
  await resolveEffects(g2, 0, d2, d2.fx.etb);
  eq(P(g2, 0).battlefield.filter(o => o.fx.type.land).length, 0, 'rules 25: no land to sacrifice, nothing fetched');
});

// ======================================================================================== 2D-4 tokens, delayed and granted triggers
await test("Token for that player: Rite of the Raging Storm gives the upkeep player a Lightning Rager and stays", async () => {
  const g = await scenario([{ battlefield: ['Rite of the Raging Storm'] }, {}, {}]);
  const r = find(g, 0, 'Rite of the Raging Storm');
  g.active = 1;
  g.fire('upkeep', { p: 1 }); await settle(g);
  const rager = P(g, 1).battlefield.find(o => o.token);
  eq([r.zone, rager?.card.name, rager && g.power(rager), rager && g.has(rager, 'haste'), rager && g.has(rager, 'trample')], ['battlefield', 'Lightning Rager', 5, true, true], 'Rite, the Rager');
  ok((g.endSac || []).includes(rager), 'sacrificed at the next end step');
  eq(P(g, 2).battlefield.length, 0, 'the other opponent gets none this upkeep'); noErrors(g);
});
await test('Rules 24: Rite of the Raging Storm still sacrifices itself (old replays)', async () => {
  const g = await scenario([{ battlefield: ['Rite of the Raging Storm'] }, {}], { rules: 24 });
  g.active = 1; g.fire('upkeep', { p: 1 }); await settle(g);
  eq(find(g, 0, 'Rite of the Raging Storm', 'graveyard')?.zone, 'graveyard', 'as before');
});
await test("Granted trigger: Hunter's Insight draws as many cards as the creature's combat damage to a player, not to a creature", async () => {
  const g = await scenario([{ hand: ["Hunter's Insight"], battlefield: ['Craterhoof Behemoth'] }, { battlefield: ['Grizzly Bears'] }]);
  const o = find(g, 0, "Hunter's Insight", 'hand'), c = find(g, 0, 'Craterhoof Behemoth');
  const h = P(g, 0).hand.length;
  await resolveEffects(g, 0, o, o.fx.spell, [tgtObj(c)]);
  eq(P(g, 0).hand.length - h, 0, 'nothing drawn on resolution');
  g.fire('selfCombat', { o: c, p: 0 }); await settle(g);
  eq(P(g, 0).hand.length - h, 0, 'damage to a creature: nothing');
  g.fire('selfCombat', { o: c, p: 0, target: 1, n: 5 }); await settle(g);
  eq(P(g, 0).hand.length - h, 5, 'damage to a player: five cards');
  g.turn++;
  g.fire('selfCombat', { o: c, p: 0, target: 1, n: 5 }); await settle(g);
  eq(P(g, 0).hand.length - h, 5, 'next turn: the ability is gone');
});
await test("Untap restriction: Junk Winder's tapped permanent doesn't untap during its controller's next untap step", async () => {
  const g = await scenario([{ battlefield: ['Junk Winder'] }, { battlefield: ['Craterhoof Behemoth'] }]);
  const j = find(g, 0, 'Junk Winder'), c = find(g, 1, 'Craterhoof Behemoth');
  const tap = j.fx.watch.find(w => w.ev === 'enter').effects;
  await resolveEffects(g, 0, j, tap, [tgtObj(c)]);
  eq([c.tapped, !!c.exerted], [true, true], 'tapped and held');
});

// ======================================================================================== 2D-5 graveyard, exile and library
await test('Expressive Iteration: one card to hand, one exiled and playable this turn, one to the bottom', async () => {
  const g = await scenario([{ hand: ['Expressive Iteration'], library: ['Forest', 'Lightning Bolt', 'Grizzly Bears'], filler: 0 }, {}]);
  mana(g, 0);
  const o = find(g, 0, 'Expressive Iteration', 'hand');
  await resolveEffects(g, 0, o, o.fx.spell);
  const ex = P(g, 0).exile.filter(c => c.mayPlay?.p === 0);
  eq([P(g, 0).hand.length, ex.length, P(g, 0).library.length], [2, 1, 1], 'hand (with the spell), exiled, library');
  const c = ex[0];
  ok(c.fx.type.land ? true : !!g.canCast(P(g, 0), c), `${c.card.name} playable from exile`);
  g.turn++;
  eq(!!g.canCast(P(g, 0), c) && !c.fx.type.land, false, 'not next turn');
});
await test('Containment Construct: a discarded card is exiled and may be played this turn', async () => {
  const g = await scenario([{ battlefield: ['Containment Construct'], hand: ['Lightning Bolt'] }, {}]);
  mana(g, 0);
  const cc = find(g, 0, 'Containment Construct'), b = find(g, 0, 'Lightning Bolt', 'hand');
  g.discard(P(g, 0), [b]); await settle(g);
  eq([b.zone, b.mayPlay?.p], ['exile', 0], 'exiled with a permission');
  ok(!!g.canCast(P(g, 0), b), 'castable from exile');
});
await test('Tablet of Discovery: the milled card may be played from the graveyard this turn (a land uses the land drop)', async () => {
  const g = await scenario([{ battlefield: ['Tablet of Discovery'], library: ['Forest'], filler: 0 }, {}]);
  g.active = 0;
  const t = find(g, 0, 'Tablet of Discovery');
  await resolveEffects(g, 0, t, t.fx.etb);
  const f = find(g, 0, 'Forest', 'graveyard');
  ok(f && f.mayPlay?.p === 0, 'milled with a permission');
  ok(await g.playLand(P(g, 0), f), 'played from the graveyard');
});
await test("Mnemonic Betrayal: the caster casts an opponent's exiled spell; leftovers return at the end step; lands can't be played", async () => {
  const g = await scenario([{ hand: ['Mnemonic Betrayal'] }, { graveyard: ['Lightning Bolt', 'Forest'] }]);
  mana(g, 0);
  const m = find(g, 0, 'Mnemonic Betrayal', 'hand');
  await resolveEffects(g, 0, m, m.fx.spell);
  const bolt = find(g, 1, 'Lightning Bolt', 'exile'), forest = find(g, 1, 'Forest', 'exile');
  ok(bolt && forest, 'exiled');
  ok(!!g.canCast(P(g, 0), bolt), 'Bolt castable by the caster');
  eq(await g.playLand(P(g, 0), forest), false, 'their land: not playable ("cast spells")');
  const myExile = P(g, 0).exile.length;
  ok(await g.cast(P(g, 0), bolt, { targets: [{ player: 1 }] }), 'cast'); await settle(g);
  eq([P(g, 1).life, P(g, 0).exile.length, bolt.zone, bolt.owner], [37, myExile, 'graveyard', 1], "damage dealt, the caster's exile untouched, Bolt to its owner's graveyard");
  for (const o of (g.endReturn25 || []).splice(0)) if (o.zone === 'exile') g.move(o, 'graveyard');
  eq(forest.zone, 'graveyard', 'the Forest returns at the end step');
});
await test('Valakut Exploration: the exiled card may be played for as long as it remains exiled', async () => {
  const g = await scenario([{ battlefield: ['Valakut Exploration'], library: ['Lightning Bolt', 'Forest'], filler: 0 }, {}]);
  mana(g, 0);
  const v = find(g, 0, 'Valakut Exploration');
  await resolveEffects(g, 0, v, v.fx.landfall);
  const c = P(g, 0).exile[0];
  g.turn += 4;
  ok(c && c.mayPlay?.until === Infinity, 'permission kept');
});

// ======================================================================================== 2D-6 replacements
await test('Counter replacement: Benevolent Hydra adds one more +1/+1 counter to your other creatures, not to itself', async () => {
  const g = await scenario([{ battlefield: ['Benevolent Hydra', 'Grizzly Bears'] }, {}]);
  const h = find(g, 0, 'Benevolent Hydra'), b = find(g, 0, 'Grizzly Bears');
  eq([g.moreCounters(b, 1), g.moreCounters(h, 1)], [2, 1], 'Bears, Hydra');
});
await test('Two counter replacements (616.1): Benevolent Hydra and Hardened Scales give three for one', async () => {
  const g = await scenario([{ battlefield: ['Benevolent Hydra', 'Hardened Scales', 'Grizzly Bears'] }, {}]);
  eq(g.moreCounters(find(g, 0, 'Grizzly Bears'), 1), 3, 'one counter becomes three');
});
await test("Enter replacement: Mox Diamond discards a land as it enters; with no land it goes to the graveyard", async () => {
  const g = await scenario([{ hand: ['Mox Diamond', 'Forest'] }, {}]);
  mana(g, 0);
  const m = find(g, 0, 'Mox Diamond', 'hand');
  ok(await g.cast(P(g, 0), m), 'cast'); await settle(g);
  eq([m.zone, find(g, 0, 'Forest', 'graveyard')?.zone], ['battlefield', 'graveyard'], 'Mox in play, Forest discarded');
  const g2 = await scenario([{ hand: ['Mox Diamond', 'Forest'] }, {}]);
  mana(g2, 0);
  const m2 = find(g2, 0, 'Mox Diamond', 'hand');
  // (the land leaves the hand while the Mox is on the stack, as with a response: nothing to discard as it enters)
  const beat = g2.clock.beat;
  g2.clock.beat = async () => { const f = find(g2, 0, 'Forest', 'hand'); if (f && m2.zone === 'stack') g2.move(f, 'exile'); };
  ok(await g2.cast(P(g2, 0), m2), 'cast');
  g2.clock.beat = beat;
  await settle(g2);
  eq(m2.zone, 'graveyard', 'no land: graveyard');
  const g3 = await scenario([{ hand: ['Mox Diamond'] }, {}]);
  mana(g3, 0);
  eq(g3.castModeRaw(P(g3, 0), find(g3, 0, 'Mox Diamond', 'hand')), null, 'the AI never casts it with no land in hand');
});
await test('Mox Diamond on the stack: the land is still in hand (the discard is not a cost); rules 24 paid it on casting', async () => {
  for (const [rules, want] of [[25, 'hand'], [24, 'graveyard']]) {
    const g = await scenario([{ hand: ['Mox Diamond', 'Forest'] }, {}], { rules });
    mana(g, 0);
    const m = find(g, 0, 'Mox Diamond', 'hand'), f = find(g, 0, 'Forest', 'hand');
    let seen = null;
    g.clock.beat = async () => { if (m.zone === 'stack' && seen == null) seen = f.zone; };
    ok(await g.cast(P(g, 0), m), 'cast'); await settle(g);
    eq(seen, want, `rules ${rules}: Forest while Mox is on the stack`);
  }
});

// ======================================================================================== 2D-7 continuous effects and riders
await test('Protection, not hexproof: Giver of Runes gives protection from a color (damage from it is prevented)', async () => {
  const g = await scenario([{ battlefield: ['Giver of Runes', 'Grizzly Bears'] }, { hand: ['Lightning Bolt'] }]);
  const gv = find(g, 0, 'Giver of Runes'), b = find(g, 0, 'Grizzly Bears');
  await resolveEffects(g, 0, gv, gv.fx.abilities[0].effects, [tgtObj(b)]);
  ok(b.tempProt?.q?.length === 1, `protection: ${JSON.stringify(b.tempProt)}`);
  ok(!(b.tempKw && [...b.tempKw].includes('hexproof')), 'no hexproof');
  eq(g.protectedFrom(b, find(g, 1, 'Lightning Bolt', 'hand')), b.tempProt.q[0] === 'R', 'red sources are stopped when red was chosen');
});
await test("Rider: Damn's destroyed creature can't be regenerated (rules 25)", async () => {
  const g = await scenario([{ hand: ['Damn'] }, { battlefield: ['Grizzly Bears'] }]);
  const d = find(g, 0, 'Damn', 'hand'), b = find(g, 1, 'Grizzly Bears');
  b.regen = 1;
  ok(d.fx.spell[0].noRegen25, 'read');
  await resolveEffects(g, 0, d, d.fx.spell, [tgtObj(b)]);
  eq(b.zone, 'graveyard', 'destroyed');
});
await test('Rider: Kappa Cannoneer can\'t be blocked the turn it gets a counter', async () => {
  const g = await scenario([{ battlefield: ['Kappa Cannoneer'] }, {}]);
  const k = find(g, 0, 'Kappa Cannoneer');
  await resolveEffects(g, 0, k, k.fx.watch[0].effects, [], { trig: { o: k } });
  ok(g.has(k, 'unblockable'), 'unblockable');
});
await test('Rule change: The Immortal Sun stops every player\'s loyalty abilities', async () => {
  const g = await scenario([{ battlefield: ['The Immortal Sun'] }, { battlefield: ['Grist, the Hunger Tide'] }]);
  const gr = find(g, 1, 'Grist, the Hunger Tide');
  const before = gr.loyalty;
  eq(await g.activatePW(P(g, 1), gr, gr.fx.pw[0]), false, 'refused');
  eq(gr.loyalty, before, 'loyalty unchanged');
});
await test('Attack restriction: Port Razer can\'t attack a player it already attacked this turn (another one is fine)', async () => {
  const g = await scenario([{ battlefield: ['Port Razer'] }, {}, {}]);
  const r = find(g, 0, 'Port Razer');
  r.sick = false; g.active = 0;
  let pick = 1;
  P(g, 0).agent.declareAttackers = () => [{ o: r, target: pick }];
  await g.combat(P(g, 0)); await settle(g);
  r.tapped = false; r.attacking = null;
  await g.combat(P(g, 0)); await settle(g);
  eq(r.attackedPlayers25.list, [1], 'the second attack on P2 is refused');
  pick = 2; r.tapped = false; r.attacking = null;
  await g.combat(P(g, 0)); await settle(g);
  eq(r.attackedPlayers25.list, [1, 2], 'P3 is fine');
});

// ======================================================================================== 2D-8 keyword mechanics
await test('Hideaway: Mosswort Bridge exiles one card face down, the rest go to the bottom, nothing to hand', async () => {
  const g = await scenario([{ battlefield: ['Mosswort Bridge'], library: ['Forest', 'Island', 'Craterhoof Behemoth', 'Lightning Bolt', 'Sol Ring'], filler: 0 }, {}]);
  const m = find(g, 0, 'Mosswort Bridge');
  const h = P(g, 0).hand.length, untouched = P(g, 0).library[0];
  await resolveEffects(g, 0, m, m.fx.etb);
  const hidden = g.objects.get(m.hidden25);
  eq([P(g, 0).hand.length - h, hidden?.zone, !!hidden?.hiddenExile, P(g, 0).library.length], [0, 'exile', true, 4], 'hand, hidden card, library');
  eq(P(g, 0).library.at(-1), untouched, 'the card not looked at is now on top (the other three went under it)');
});
await test('Hideaway: Mosswort Bridge plays the hidden card for free only with total power 10 or more', async () => {
  const g = await scenario([{ battlefield: ['Mosswort Bridge', 'Grizzly Bears'], library: ['Glorious Anthem'], filler: 0 }, {}]);
  g.active = 0;
  const m = find(g, 0, 'Mosswort Bridge');
  await resolveEffects(g, 0, m, m.fx.etb);
  const play = m.fx.abilities.find(a => a.effects.some(e => e.k === 'playHidden')).effects;
  await resolveEffects(g, 0, m, play);
  eq(find(g, 0, 'Glorious Anthem', 'exile')?.zone, 'exile', 'power 2: stays hidden');
  const g2 = await scenario([{ battlefield: ['Mosswort Bridge', 'Craterhoof Behemoth', 'Craterhoof Behemoth'], library: ['Glorious Anthem'], filler: 0 }, {}]);
  g2.active = 0;
  const m2 = find(g2, 0, 'Mosswort Bridge');
  await resolveEffects(g2, 0, m2, m2.fx.etb);
  const play2 = m2.fx.abilities.find(a => a.effects.some(e => e.k === 'playHidden')).effects;
  await resolveEffects(g2, 0, m2, play2); await settle(g2);
  eq(find(g2, 0, 'Glorious Anthem')?.zone, 'battlefield', 'power 10: cast for free');
});
await test('Hideaway condition: Windbrisk Heights needs three attackers this turn', async () => {
  const g = await scenario([{ battlefield: ['Windbrisk Heights'] }, {}]);
  const w = find(g, 0, 'Windbrisk Heights');
  const c = w.fx.abilities.find(a => a.effects.some(e => e.k === 'playHidden')).effects[0].cond;
  eq(g.evalCond(P(g, 0), w, c, {}), false, 'no attack');
  P(g, 0).attackCount25 = { turn: g.turn, n: 3 };
  eq(g.evalCond(P(g, 0), w, c, {}), true, 'three attackers');
});
await test('Rules 24: hideaway still puts the card into hand (old replays)', async () => {
  const g = await scenario([{ battlefield: ['Mosswort Bridge'], library: ['Forest', 'Island', 'Sol Ring', 'Lightning Bolt'], filler: 0 }, {}], { rules: 24 });
  const m = find(g, 0, 'Mosswort Bridge');
  const h = P(g, 0).hand.length;
  await resolveEffects(g, 0, m, m.fx.etb);
  eq(P(g, 0).hand.length - h, 1, 'one card to hand');
});
await test('Escalate: Collective Resistance takes two modes when it can pay {G} more, one otherwise', async () => {
  const g = await scenario([{ hand: ['Collective Resistance'], battlefield: ['Forest', 'Forest', 'Forest'] }, { battlefield: ['Sol Ring', 'Glorious Anthem'] }]);
  for (const o of P(g, 0).battlefield) o.tapped = false;
  g.active = 0;
  ok(await g.cast(P(g, 0), find(g, 0, 'Collective Resistance', 'hand')), 'cast'); await settle(g);
  eq([find(g, 1, 'Sol Ring')?.zone ?? 'gone', find(g, 1, 'Glorious Anthem')?.zone ?? 'gone'], ['gone', 'gone'], 'both destroyed with {1}{G} + {G}');
  ok(/escalates/.test(logText(g)), 'logged');
  const g2 = await scenario([{ hand: ['Collective Resistance'], battlefield: ['Forest', 'Forest'] }, { battlefield: ['Sol Ring', 'Glorious Anthem'] }]);
  for (const o of P(g2, 0).battlefield) o.tapped = false;
  g2.active = 0;
  ok(await g2.cast(P(g2, 0), find(g2, 0, 'Collective Resistance', 'hand')), 'cast'); await settle(g2);
  eq(P(g2, 1).battlefield.length, 1, 'only one destroyed with two lands');
});
await test('Copy plus: Twinning Staff makes Reverberate copy a spell twice', async () => {
  const g = await scenario([{ battlefield: ['Twinning Staff'], hand: ['Reverberate'] }, { hand: ['Lightning Bolt'] }]);
  const item = onStack(g, 1, 'Lightning Bolt', [{ player: 0 }]);
  const r = find(g, 0, 'Reverberate', 'hand');
  await resolveEffects(g, 0, r, r.fx.spell, [{ spell: item }]);
  eq((logText(g).match(/copies Lightning Bolt/g) || []).length, 2, 'two copies');
});
await test('Abundance: a draw becomes revealing until a nonland card; the lands revealed go to the bottom; no draw is counted', async () => {
  const g = await scenario([{ battlefield: ['Abundance'], hand: ['Forest'], library: ['Lightning Bolt', 'Island', 'Island'], filler: 0 }, {}]);
  g.draw(P(g, 0), 1);
  eq([P(g, 0).hand.map(o => o.card.name).sort(), P(g, 0).library.map(o => o.card.name)], [['Forest', 'Lightning Bolt'], ['Island', 'Island']], 'hand and library');
  eq(P(g, 0).drawsThisTurn?.n || 0, 0, 'not a draw');
});

const failed = results.filter(([, e]) => e);
for (const [n, e] of failed) console.log(`FAIL ${n}\n     ${e.message.split('\n')[0]}`);
for (const [n, e] of results) if (!e) console.log(`  ok   ${n}`);
console.log(`Mechanics (Phase 2D): ${results.length} tests, ${results.length - failed.length} passed, ${failed.length} failed.`);
process.exit(failed.length ? 1 : 0);
