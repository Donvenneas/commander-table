// Card and interaction tests: small boards built from card names (tests/scenario.mjs), each checking one card's rules
// text or one interaction between cards. Every rules fix has a test here showing the old problem is gone; the ones
// gated behind a rules version also check that older replays (rules 5) still play the old way.
//   node tests/interactions.mjs              run them all (exit 1 on any failure)
//   node tests/interactions.mjs Swords       only the tests whose name contains "Swords"
// Cards the snapshots don't have are kept in tests/interaction-cards.json (node tests/fetch-interaction-cards.mjs "Name").
import { scenario, find, all, P, tgtObj, tgtPlayer, resolveEffects, settle, errors, hasCard, logText } from './scenario.mjs';
import { HumanAgent } from '../public/js/human.js';
import { COMBOS } from '../public/js/combos.js';

const only = process.argv[2];
const results = [];
const test = async (name, fn) => {
  if (only && !name.toLowerCase().includes(only.toLowerCase())) return;
  try { await fn(); results.push([name, null]); } catch (e) { results.push([name, e]); }
};
const eq = (got, want, what) => { if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`${what}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); };
const ok = (cond, what) => { if (!cond) throw new Error(what); };
const names = (g, i, zone = 'battlefield') => P(g, i)[zone].map(o => o.card.name).sort();
const noErrors = g => eq(errors(g).length, 0, 'simulator errors');
// Unbounded mana for one seat (the engine's own "infinite mana" state), so a test can cast without lands
const mana = (g, i) => { g.active = i; P(g, i).infiniteMana = g.turn; };
const cast = async (g, i, name, choice = {}) => { const o = find(g, i, name, 'hand'); ok(o, `${name} in hand`); const r = await g.cast(P(g, i), o, choice); await settle(g); return r; };
const spell = async (g, i, name, targets = []) => { const o = find(g, i, name, 'hand'); ok(o, `${name} in hand`); await resolveEffects(g, i, o, o.fx.spell, targets); return o; };
// Combat damage between one attacker and its blockers (both steps when first or double strike is involved)
const fight = async (g, att, blockers, target = 1) => {
  att.attacking = target; att.blocked = blockers.length > 0; att.blockedBy = blockers;
  for (const b of blockers) b.blocking = att;
  const p = P(g, att.controller);
  const first = [att, ...blockers].some(o => g.has(o, 'first strike') || g.has(o, 'double strike'));
  if (first) { await g.combatDamage(p, true, false); await settle(g); }
  await g.combatDamage(p, false, first); await settle(g);
};

// ---------- Removal: what the target's controller gets back (rules 6)
await test('Swords to Plowshares: its controller gains life equal to its power', async () => {
  const g = await scenario([{ hand: ['Swords to Plowshares'] }, { battlefield: ['Craterhoof Behemoth'] }]);
  const v = find(g, 1, 'Craterhoof Behemoth');
  await spell(g, 0, 'Swords to Plowshares', [tgtObj(v)]);
  eq(v.zone, 'exile', 'Craterhoof zone'); eq(P(g, 1).life, 45, "controller's life"); eq(P(g, 0).life, 40, "caster's life"); noErrors(g);
});
await test('Swords to Plowshares under rules 5 (old replays): no life, as before', async () => {
  const g = await scenario([{ hand: ['Swords to Plowshares'] }, { battlefield: ['Craterhoof Behemoth'] }], { rules: 5 });
  await spell(g, 0, 'Swords to Plowshares', [tgtObj(find(g, 1, 'Craterhoof Behemoth'))]);
  eq(P(g, 1).life, 40, "controller's life");
});
await test('Swords to Plowshares uses the power the creature last had (pumped)', async () => {
  const g = await scenario([{ hand: ['Swords to Plowshares'] }, { battlefield: ['Grizzly Bears', 'Glorious Anthem'] }]);
  await spell(g, 0, 'Swords to Plowshares', [tgtObj(find(g, 1, 'Grizzly Bears'))]);
  eq(P(g, 1).life, 43, "controller's life (2 power +1 anthem)");
});
await test('Path to Exile: its controller gets a basic land, tapped', async () => {
  const g = await scenario([{ hand: ['Path to Exile'] }, { battlefield: ['Craterhoof Behemoth'], library: ['Forest'], filler: 0 }]);
  await spell(g, 0, 'Path to Exile', [tgtObj(find(g, 1, 'Craterhoof Behemoth'))]);
  const f = find(g, 1, 'Forest');
  ok(f, 'Forest on the battlefield'); eq(f.tapped, true, 'Forest tapped'); eq(names(g, 0), [], "caster's battlefield"); noErrors(g);
});
await test("Beast Within: the permanent's controller gets a 3/3 Beast", async () => {
  const g = await scenario([{ hand: ['Beast Within'] }, { battlefield: ['Sol Ring'] }]);
  await spell(g, 0, 'Beast Within', [tgtObj(find(g, 1, 'Sol Ring'))]);
  eq(names(g, 1), ['Beast'], "target controller's battlefield");
  const b = find(g, 1, 'Beast'); eq([g.power(b), g.toughness(b)], [3, 3], 'Beast size'); eq(names(g, 0), [], "caster's battlefield");
});
await test("Beast Within on an indestructible permanent: the token still comes", async () => {
  const g = await scenario([{ hand: ['Beast Within'] }, { commander: 'Heliod, Sun-Crowned' }]);
  await spell(g, 0, 'Beast Within', [tgtObj(find(g, 1, 'Heliod, Sun-Crowned'))]);
  eq(names(g, 1), ['Beast', 'Heliod, Sun-Crowned'], "target controller's battlefield");
});
await test("Nature's Claim: one target destroyed, its controller gains 4 life", async () => {
  const g = await scenario([{ hand: ["Nature's Claim"] }, { battlefield: ['Sol Ring', 'Rhystic Study'] }]);
  await spell(g, 0, "Nature's Claim", [tgtObj(find(g, 1, 'Sol Ring'))]);
  eq(names(g, 1), ['Rhystic Study'], 'left on the battlefield'); eq(P(g, 1).life, 44, "controller's life");
});
await test('Feed the Swarm: you lose life equal to its mana value', async () => {
  const g = await scenario([{ hand: ['Feed the Swarm'] }, { battlefield: ['Rhystic Study'] }]);
  await spell(g, 0, 'Feed the Swarm', [tgtObj(find(g, 1, 'Rhystic Study'))]);
  eq(names(g, 1), [], 'opponent battlefield'); eq(P(g, 0).life, 37, "caster's life");
});

// ---------- One effect read twice (rules 6)
await test('Disenchant destroys only its one target (was: a second artifact too)', async () => {
  const g = await scenario([{ hand: ['Disenchant'] }, { battlefield: ['Sol Ring', 'Rhystic Study', 'Smothering Tithe'] }]);
  await spell(g, 0, 'Disenchant', [tgtObj(find(g, 1, 'Sol Ring'))]);
  eq(names(g, 1), ['Rhystic Study', 'Smothering Tithe'], 'left on the battlefield'); noErrors(g);
});
await test('Disenchant under rules 5 (old replays): two permanents, as before', async () => {
  const g = await scenario([{ hand: ['Disenchant'] }, { battlefield: ['Sol Ring', 'Rhystic Study', 'Smothering Tithe'] }], { rules: 5 });
  await spell(g, 0, 'Disenchant', [tgtObj(find(g, 1, 'Sol Ring'))]);
  eq(P(g, 1).battlefield.length, 1, 'left on the battlefield');
});
await test('Reclamation Sage entering destroys one artifact', async () => {
  const g = await scenario([{ hand: ['Reclamation Sage'] }, { battlefield: ['Sol Ring', 'Mana Crypt'] }]);
  mana(g, 0); await cast(g, 0, 'Reclamation Sage');
  eq(P(g, 1).battlefield.length, 1, 'artifacts left');
});

// ---------- Land destruction aims at lands (rules 6)
await test('Strip Mine destroys a land (was: the best creature)', async () => {
  const g = await scenario([{ battlefield: ['Strip Mine'] }, { battlefield: ['Shivan Dragon', 'Island'] }]);
  const s = find(g, 0, 'Strip Mine');
  ok(await g.activate(P(g, 0), s, s.fx.abilities.find(a => a.effects.some(e => e.k === 'remove'))), 'activated');
  await settle(g);
  eq(names(g, 1), ['Shivan Dragon'], 'opponent battlefield'); eq(names(g, 1, 'graveyard'), ['Island'], 'opponent graveyard');
  eq(names(g, 0, 'graveyard'), ['Strip Mine'], 'Strip Mine sacrificed');
});
await test('Wasteland only hits a nonbasic land', async () => {
  const g = await scenario([{ battlefield: ['Wasteland'] }, { battlefield: ['Island', 'Ancient Tomb', 'Grizzly Bears'] }]);
  const w = find(g, 0, 'Wasteland');
  await g.activate(P(g, 0), w, w.fx.abilities.find(a => a.effects.some(e => e.k === 'remove'))); await settle(g);
  eq(names(g, 1, 'graveyard'), ['Ancient Tomb'], 'opponent graveyard');
});
await test('Strip Mine under rules 5 (old replays): unchanged', async () => {
  const g = await scenario([{ battlefield: ['Strip Mine'] }, { battlefield: ['Shivan Dragon', 'Island'] }], { rules: 5 });
  const s = find(g, 0, 'Strip Mine');
  await g.activate(P(g, 0), s, s.fx.abilities.find(a => a.effects.some(e => e.k === 'remove'))); await settle(g);
  eq(names(g, 1), ['Island'], 'opponent battlefield (the old behaviour)');
});

// ---------- Deathrite Shaman (rules 6)
await test('Deathrite Shaman: no land card in a graveyard, no mana; never exiles a creature', async () => {
  const g = await scenario([{ battlefield: ['Deathrite Shaman'] }, { battlefield: ['Shivan Dragon', 'Island'] }]);
  const d = find(g, 0, 'Deathrite Shaman');
  for (const ab of d.fx.abilities) { d.tapped = false; eq(await g.activate(P(g, 0), d, ab), false, `ability "${ab.text}"`); }
  eq(names(g, 1), ['Island', 'Shivan Dragon'], 'opponent battlefield'); eq(P(g, 1).life, 40, 'opponent life');
});
await test('Deathrite Shaman exiles a land card from a graveyard for mana, and drains with an instant there', async () => {
  const g = await scenario([{ battlefield: ['Deathrite Shaman', 'Swamp'] }, { battlefield: ['Shivan Dragon'], graveyard: ['Island', 'Lightning Bolt'] }]);
  const d = find(g, 0, 'Deathrite Shaman');
  ok(await g.activate(P(g, 0), d, d.fx.abilities[0]), 'mana ability'); await settle(g);
  eq(names(g, 1, 'exile'), ['Island'], 'exiled'); eq(P(g, 0).pool.length, 1, 'mana in pool'); eq(names(g, 1), ['Shivan Dragon'], 'opponent battlefield');
  d.tapped = false; P(g, 0).pool = [];
  ok(await g.activate(P(g, 0), d, d.fx.abilities[1]), 'drain ability'); await settle(g);
  eq(names(g, 1, 'exile'), ['Island', 'Lightning Bolt'], 'exiled'); eq(P(g, 1).life, 38, 'opponent life');
});

// ---------- Drains that gain (rules 6)
await test('Gray Merchant: each opponent loses its devotion, you gain the life lost', async () => {
  const g = await scenario([{ hand: ['Gray Merchant of Asphodel'] }, {}, {}]);
  mana(g, 0); await cast(g, 0, 'Gray Merchant of Asphodel');
  eq([P(g, 1).life, P(g, 2).life], [38, 38], 'opponents'); eq(P(g, 0).life, 44, 'you');
});
await test('Exsanguinate X=3 in a four-player game: you gain 9', async () => {
  const g = await scenario([{ hand: ['Exsanguinate'] }, {}, {}, {}]);
  await resolveEffects(g, 0, find(g, 0, 'Exsanguinate', 'hand'), find(g, 0, 'Exsanguinate', 'hand').fx.spell, [], { x: 3 });
  eq(P(g, 0).life, 49, 'you'); eq(P(g, 3).life, 37, 'an opponent');
});
await test('Reanimate: you lose life equal to the mana value', async () => {
  const g = await scenario([{ hand: ['Reanimate'] }, { graveyard: ['Craterhoof Behemoth'] }]);
  await spell(g, 0, 'Reanimate');
  ok(find(g, 0, 'Craterhoof Behemoth'), 'Craterhoof under your control'); eq(P(g, 0).life, 32, 'you');
});

// ---------- Token copies (rules 6)
await test('Kiki-Jiki + Pestermite: hasty copies untap Kiki-Jiki, sacrificed at the end step', async () => {
  const g = await scenario([{ battlefield: ['Kiki-Jiki, Mirror Breaker', 'Pestermite'] }, {}]);
  const k = find(g, 0, 'Kiki-Jiki, Mirror Breaker');
  for (let i = 0; i < 3; i++) { ok(await g.activate(P(g, 0), k, k.fx.abilities[0]), `activation ${i + 1}`); await settle(g); }
  const tokens = P(g, 0).battlefield.filter(o => o.token);
  eq(tokens.length, 3, 'copies'); ok(tokens.every(o => g.has(o, 'haste') && g.canAttack(o)), 'copies have haste and can attack');
  eq(k.tapped, false, 'Kiki-Jiki untapped by the last copy');
  await g.endSteps(P(g, 0)); await settle(g);
  eq(P(g, 0).battlefield.filter(o => o.token).length, 0, 'copies after the end step');
  noErrors(g);
});
await test('Kiki-Jiki copies only a nonlegendary creature you control', async () => {
  const g = await scenario([{ battlefield: ['Kiki-Jiki, Mirror Breaker', 'Heliod, Sun-Crowned'] }, { battlefield: ['Shivan Dragon'] }]);
  const k = find(g, 0, 'Kiki-Jiki, Mirror Breaker');
  await g.activate(P(g, 0), k, k.fx.abilities[0]); await settle(g);
  eq(P(g, 0).battlefield.filter(o => o.token).length, 0, 'copies');
});
await test('Twinflame-style exile: a temporary copy is exiled, not sacrificed (no dies trigger)', async () => {
  const g = await scenario([{ hand: ['Heat Shimmer'], battlefield: ['Grizzly Bears', 'Blood Artist'] }, {}]);
  await spell(g, 0, 'Heat Shimmer', [tgtObj(find(g, 0, 'Grizzly Bears'))]);
  const t = P(g, 0).battlefield.find(o => o.token);
  ok(t && g.has(t, 'haste'), 'hasty copy');
  await g.endSteps(P(g, 0)); await settle(g);
  // (a token that leaves the battlefield ceases to exist: 111.7)
  ok(t.zone !== 'battlefield' && t.zone !== 'graveyard', `copy exiled (zone ${t.zone})`); eq(P(g, 1).life, 40, 'no Blood Artist drain');
});

// ---------- Counters (rules 6)
await test('Walking Ballista X=2 with Hardened Scales enters with 3 counters', async () => {
  const g = await scenario([{ battlefield: ['Hardened Scales'], hand: ['Walking Ballista'] }, {}]);
  mana(g, 0); ok(await cast(g, 0, 'Walking Ballista', { x: 2 }), 'cast');
  eq(find(g, 0, 'Walking Ballista').counters, 3, 'counters');
});
await test('Walking Ballista X=2 with Doubling Season enters with 4 counters', async () => {
  const g = await scenario([{ battlefield: ['Doubling Season'], hand: ['Walking Ballista'] }, {}]);
  mana(g, 0); await cast(g, 0, 'Walking Ballista', { x: 2 });
  eq(find(g, 0, 'Walking Ballista').counters, 4, 'counters');
});
await test('Hardened Scales + Doubling Season: ordered for the most counters (2 → 6)', async () => {
  const g = await scenario([{ battlefield: ['Hardened Scales', 'Doubling Season', 'Grizzly Bears'] }, {}]);
  const b = find(g, 0, 'Grizzly Bears');
  await resolveEffects(g, 0, b, [{ k: 'counters', n: 2, on: 'target creature' }], [tgtObj(b)]);
  eq(b.counters, 6, 'counters ((2+1)×2)');
});
await test('Heliod + Walking Ballista: each lifelink ping puts the counter back on the Ballista', async () => {
  const g = await scenario([{ battlefield: ['Heliod, Sun-Crowned', { name: 'Walking Ballista', counters: 2 }] }, {}]);
  const h = find(g, 0, 'Heliod, Sun-Crowned'), b = find(g, 0, 'Walking Ballista');
  ok(g.dormant(h), 'Heliod is not a creature (devotion 1)');
  await resolveEffects(g, 0, h, h.fx.abilities[0].effects, [tgtObj(b)]);
  for (let i = 0; i < 6; i++) { await g.ping(P(g, 0), b, [tgtPlayer(1)]); await settle(g); }
  eq(b.zone, 'battlefield', 'Ballista zone'); eq(b.counters, 2, 'Ballista counters'); eq(h.counters, 0, 'counters on Heliod');
  eq([P(g, 0).life, P(g, 1).life], [46, 34], 'life totals');
});

// ---------- Mana that costs life (rules 6)
const payWith = async (land, pips, generic) => {
  const g = await scenario([{ battlefield: [land] }, {}]);
  const plan = g.planPayment(P(g, 0), { generic, pips, x: 0 });
  ok(plan, `${land} pays`); g.commitPayment(P(g, 0), plan); await settle(g);
  return P(g, 0).life;
};
await test('Painland: colored mana deals 1 damage, colorless is free', async () => {
  eq(await payWith('Shivan Reef', [['R']], 0), 39, 'life after {R}');
  eq(await payWith('Shivan Reef', [], 1), 40, 'life after {1}');
});
await test('Talisman: colored mana deals 1 damage', async () => { eq(await payWith('Talisman of Dominance', [['B']], 0), 39, 'life after {B}'); });
await test('Ancient Tomb: 2 damage whenever it taps for mana', async () => { eq(await payWith('Ancient Tomb', [], 2), 38, 'life after {2}'); });
await test('Mana Confluence: pay 1 life for any color', async () => { eq(await payWith('Mana Confluence', [['G']], 0), 39, 'life after {G}'); });
await test('Painland under rules 5 (old replays): no damage, as before', async () => {
  const g = await scenario([{ battlefield: ['Shivan Reef'] }, {}], { rules: 5 });
  g.commitPayment(P(g, 0), g.planPayment(P(g, 0), { generic: 0, pips: [['R']], x: 0 }));
  eq(P(g, 0).life, 40, 'life');
});

// ---------- Interactions that already worked (kept working)
await test('Blood Artist + Viscera Seer: a sacrifice drains 1', async () => {
  const g = await scenario([{ battlefield: ['Blood Artist', 'Viscera Seer', 'Grizzly Bears'] }, {}]);
  await g.sacTo(P(g, 0), find(g, 0, 'Viscera Seer'), find(g, 0, 'Grizzly Bears')); await settle(g);
  eq([P(g, 0).life, P(g, 1).life], [41, 39], 'life totals');
});
await test('Zulaport Cutthroat sees itself die', async () => {
  const g = await scenario([{ battlefield: ['Zulaport Cutthroat', 'Viscera Seer'] }, {}, {}]);
  await g.sacTo(P(g, 0), find(g, 0, 'Viscera Seer'), find(g, 0, 'Zulaport Cutthroat')); await settle(g);
  eq([P(g, 0).life, P(g, 1).life, P(g, 2).life], [41, 39, 39], 'life totals');
});
await test('Rest in Peace: a sacrificed creature is exiled and never dies (no Blood Artist trigger)', async () => {
  const g = await scenario([{ battlefield: ['Rest in Peace', 'Blood Artist', 'Viscera Seer', 'Grizzly Bears'] }, {}]);
  await g.sacTo(P(g, 0), find(g, 0, 'Viscera Seer'), find(g, 0, 'Grizzly Bears')); await settle(g);
  eq(names(g, 0, 'exile'), ['Grizzly Bears'], 'exile'); eq(P(g, 1).life, 40, 'opponent life');
});
await test("Kitchen Finks persist returns it with a -1/-1 counter, and its ETB gains 2", async () => {
  const g = await scenario([{ battlefield: ['Kitchen Finks', 'Viscera Seer'] }, {}]);
  await g.sacTo(P(g, 0), find(g, 0, 'Viscera Seer'), find(g, 0, 'Kitchen Finks')); await settle(g);
  const f = find(g, 0, 'Kitchen Finks');
  ok(f, 'Finks back'); eq([g.power(f), g.toughness(f)], [2, 1], 'size'); eq(P(g, 0).life, 42, 'life');
});
await test('Exquisite Blood + Sanguine Bond: one life gain loops until the opponent is dead', async () => {
  const g = await scenario([{ battlefield: ['Sanguine Bond', 'Exquisite Blood'], hand: ['Healing Salve'] }, {}]);
  P(g, 1).life = 10;
  await resolveEffects(g, 0, find(g, 0, 'Healing Salve', 'hand'), [{ k: 'gain', n: 3 }]);
  eq(P(g, 1).lost, true, 'opponent lost'); noErrors(g);
});
await test('Doubling Season + Raise the Alarm: four Soldiers', async () => {
  const g = await scenario([{ battlefield: ['Doubling Season'], hand: ['Raise the Alarm'] }, {}]);
  await spell(g, 0, 'Raise the Alarm');
  eq(P(g, 0).battlefield.filter(o => o.token).length, 4, 'tokens');
});
await test('Anointed Procession + Parallel Lives: two tokens become eight', async () => {
  const g = await scenario([{ battlefield: ['Anointed Procession', 'Parallel Lives'], hand: ['Raise the Alarm'] }, {}]);
  await spell(g, 0, 'Raise the Alarm');
  eq(P(g, 0).battlefield.filter(o => o.token).length, 8, 'tokens');
});
await test('Impact Tremors: each token entering pings each opponent', async () => {
  const g = await scenario([{ battlefield: ['Impact Tremors'], hand: ['Raise the Alarm'] }, {}, {}]);
  await spell(g, 0, 'Raise the Alarm');
  eq([P(g, 1).life, P(g, 2).life], [38, 38], 'opponents');
});
await test('Torpor Orb stops an enters-the-battlefield draw and "whenever a creature enters" (rules 6)', async () => {
  const g = await scenario([{ battlefield: ['Torpor Orb', 'Soul Warden'], hand: ['Wall of Omens'] }, {}]);
  mana(g, 0); await cast(g, 0, 'Wall of Omens');
  eq(P(g, 0).hand.length, 0, 'hand'); eq(P(g, 0).life, 40, 'life (no Soul Warden)');
});
await test('Torpor Orb leaves noncreature enter triggers alone', async () => {
  const g = await scenario([{ battlefield: ['Torpor Orb', 'Impact Tremors'], hand: ['Smothering Tithe'] }, {}]);
  mana(g, 0); await cast(g, 0, 'Smothering Tithe');
  ok(find(g, 0, 'Smothering Tithe'), 'Tithe on the battlefield'); eq(P(g, 1).life, 40, 'no Tremors (not a creature)');
});
await test('Hushbringer: no dies triggers, no persist', async () => {
  const g = await scenario([{ battlefield: ['Hushbringer', 'Blood Artist', 'Viscera Seer', 'Kitchen Finks'] }, {}]);
  await g.sacTo(P(g, 0), find(g, 0, 'Viscera Seer'), find(g, 0, 'Kitchen Finks')); await settle(g);
  eq(P(g, 1).life, 40, 'no drain'); eq(names(g, 0, 'graveyard'), ['Kitchen Finks'], 'Finks stays dead');
});
await test('Torpor Orb under rules 5 (old replays): not read, the draw happens', async () => {
  const g = await scenario([{ battlefield: ['Torpor Orb'], hand: ['Wall of Omens'] }, {}], { rules: 5 });
  mana(g, 0); await cast(g, 0, 'Wall of Omens');
  eq(P(g, 0).hand.length, 1, 'hand');
});
await test('Clone copies a creature as it enters', async () => {
  const g = await scenario([{ hand: ['Clone'] }, { battlefield: ['Shivan Dragon'] }]);
  mana(g, 0); await cast(g, 0, 'Clone');
  const c = P(g, 0).battlefield[0];
  eq([c.card.name, g.power(c), g.has(c, 'flying')], ['Shivan Dragon', 5, true], 'clone');
});
await test('Legend rule: a second Kiki-Jiki goes to the graveyard', async () => {
  const g = await scenario([{ battlefield: ['Kiki-Jiki, Mirror Breaker', 'Kiki-Jiki, Mirror Breaker'] }, {}]);
  await settle(g); eq(all(g, 0, 'Kiki-Jiki, Mirror Breaker').length, 1, 'Kiki-Jikis');
});
await test('Wrath of God leaves an indestructible God', async () => {
  const g = await scenario([{ hand: ['Wrath of God'], battlefield: ['Grizzly Bears'], commander: 'Heliod, Sun-Crowned' }, { battlefield: ['Hill Giant'] }]);
  await spell(g, 0, 'Wrath of God');
  eq(names(g, 0), ['Heliod, Sun-Crowned'], 'your battlefield'); eq(names(g, 1), [], 'opponent battlefield');
});
await test('Platinum Angel: its controller can\'t lose at 0 life', async () => {
  const g = await scenario([{ battlefield: ['Platinum Angel'] }, {}]);
  P(g, 0).life = -3; await settle(g); eq(P(g, 0).lost, false, 'lost');
});
await test('Combat: double strike kills a 1-toughness... and dies to the 3/3 it only hurt', async () => {
  const g = await scenario([{ battlefield: ['Boros Swiftblade'] }, { battlefield: ['Hill Giant'] }]);
  const a = find(g, 0, 'Boros Swiftblade'), b = find(g, 1, 'Hill Giant');
  await fight(g, a, [b]);
  eq([a.zone, b.zone, b.damage], ['graveyard', 'battlefield', 2], 'after combat');
});
await test('Combat: deathtouch blocker kills a trampler, the rest tramples over', async () => {
  const g = await scenario([{ battlefield: ['Colossal Dreadmaw'] }, { battlefield: ['Typhoid Rats'] }]);
  const a = find(g, 0, 'Colossal Dreadmaw'), b = find(g, 1, 'Typhoid Rats');
  await fight(g, a, [b]);
  eq([a.zone, b.zone, P(g, 1).life], ['graveyard', 'graveyard', 35], 'after combat');
});
await test('Combat: lifelink gains as much as the damage', async () => {
  const g = await scenario([{ battlefield: ['Vampire Nighthawk'] }, {}]);
  await fight(g, find(g, 0, 'Vampire Nighthawk'), []);
  eq([P(g, 0).life, P(g, 1).life], [42, 38], 'life totals');
});
await test('Lightning Bolt kills a 3-toughness creature (state-based action)', async () => {
  const g = await scenario([{ hand: ['Lightning Bolt'] }, { battlefield: ['Hill Giant'] }]);
  await spell(g, 0, 'Lightning Bolt', [tgtObj(find(g, 1, 'Hill Giant'))]);
  eq(names(g, 1, 'graveyard'), ['Hill Giant'], 'graveyard');
});

// ---------- Combo audit (rules 7): each combo played with the real cards, step by step, not the combo shortcut
const ab = (g, o, k) => g.abilitiesOf(o).find(a => a.effects?.some(e => e.k === k));
const tokens = (g, i) => P(g, i).battlefield.filter(o => o.token).length;
// Library: 7 Wastes on top, the rest shuffled under them
const top7 = { filler: 10, libraryTop: Array(7).fill('Wastes') };

await test("Thassa's Oracle + Demonic Consultation: the library is exiled and Oracle wins", async () => {
  const g = await scenario([{ hand: ["Thassa's Oracle", 'Demonic Consultation'] }, {}]);
  mana(g, 0); await cast(g, 0, 'Demonic Consultation');
  eq(P(g, 0).library.length, 0, 'library after Consultation');
  await cast(g, 0, "Thassa's Oracle");
  eq(g.over && g.winner === P(g, 0), true, 'Oracle player won'); noErrors(g);
});
await test('Demonic Consultation as a tutor: exiles six, then finds the named card', async () => {
  const g = await scenario([{ hand: ['Demonic Consultation'], library: ['Sol Ring'], ...top7 }, {}]);
  P(g, 0).agent.pickTutor = (gg, p) => p.library.find(o => o.card.name === 'Sol Ring');
  mana(g, 0); await cast(g, 0, 'Demonic Consultation');
  ok(find(g, 0, 'Sol Ring', 'hand'), 'Sol Ring in hand'); ok(P(g, 0).exile.length >= 7, 'six exiled, then the seventh Wastes revealed'); eq(P(g, 0).exile.length + P(g, 0).library.length, 10, 'only Sol Ring left the library otherwise');
});
await test('Demonic Consultation under rules 6 (old replays): still a plain tutor', async () => {
  const g = await scenario([{ hand: ["Thassa's Oracle", 'Demonic Consultation'] }, {}], { rules: 6 });
  mana(g, 0); await cast(g, 0, 'Demonic Consultation');
  ok(P(g, 0).library.length > 0, 'library not exiled');
});
await test('Laboratory Maniac + Demonic Consultation: the next draw wins', async () => {
  const g = await scenario([{ battlefield: ['Laboratory Maniac'], hand: ['Demonic Consultation'] }, {}]);
  mana(g, 0); await cast(g, 0, 'Demonic Consultation');
  eq(P(g, 0).library.length, 0, 'library'); g.draw(P(g, 0), 1); await settle(g);
  eq([P(g, 0).lost, P(g, 1).lost], [false, true], 'lost');
});
await test("Tainted Pact + Thassa's Oracle: a library of different names is exiled", async () => {
  const g = await scenario([{ hand: ["Thassa's Oracle", 'Tainted Pact'], library: ['Island', 'Swamp', 'Forest', 'Mountain'], filler: 0 }, {}]);
  mana(g, 0); await cast(g, 0, 'Tainted Pact');
  eq(P(g, 0).library.length, 0, 'library'); await cast(g, 0, "Thassa's Oracle");
  eq(g.winner === P(g, 0), true, 'won');
});
await test('Tainted Pact stops at the second card with the same name (the combo fails)', async () => {
  const g = await scenario([{ hand: ["Thassa's Oracle", 'Tainted Pact'], filler: 6 }, {}]);
  mana(g, 0); await cast(g, 0, 'Tainted Pact');
  eq([P(g, 0).library.length, P(g, 0).exile.length], [4, 2], 'library and exile'); await cast(g, 0, "Thassa's Oracle");
  eq(g.over, false, 'no win');
});

await test('Niv-Mizzet, Parun + Curiosity: one spell draws and pings until the opponent is dead', async () => {
  const g = await scenario([{ battlefield: ['Niv-Mizzet, Parun'], hand: ['Curiosity', 'Opt'], filler: 30 }, {}]);
  P(g, 1).life = 12;
  mana(g, 0); await cast(g, 0, 'Curiosity', { auraTarget: find(g, 0, 'Niv-Mizzet, Parun') }); await cast(g, 0, 'Opt');
  eq(P(g, 1).lost, true, 'opponent lost'); eq(P(g, 0).lost, false, 'Niv player alive'); noErrors(g);
});
await test('Niv-Mizzet + Curiosity: the optional draw stops at an empty library (no self-decking)', async () => {
  const g = await scenario([{ battlefield: ['Niv-Mizzet, the Firemind'], hand: ['Curiosity'], filler: 5 }, {}]);
  mana(g, 0); await cast(g, 0, 'Curiosity', { auraTarget: find(g, 0, 'Niv-Mizzet, the Firemind') });
  const n = find(g, 0, 'Niv-Mizzet, the Firemind');
  await g.activate(P(g, 0), n, ab(g, n, 'draw')); await settle(g);
  eq([P(g, 0).library.length, P(g, 0).lost, P(g, 1).life], [0, false, 35], 'library, lost, opponent life (5 cards, 5 pings)');
});
await test('Curiosity under rules 6 (old replays): noncombat damage draws nothing', async () => {
  const g = await scenario([{ battlefield: ['Niv-Mizzet, the Firemind'], hand: ['Curiosity'], filler: 20 }, {}], { rules: 6 });
  mana(g, 0); await cast(g, 0, 'Curiosity', { auraTarget: find(g, 0, 'Niv-Mizzet, the Firemind') });
  const n = find(g, 0, 'Niv-Mizzet, the Firemind');
  await g.activate(P(g, 0), n, ab(g, n, 'draw')); await settle(g);
  eq(P(g, 1).life, 39, 'opponent life');
});

for (const partner of ['Zealous Conscripts', 'Deceiver Exarch', 'Restoration Angel', 'Felidar Guardian']) {
  await test(`Kiki-Jiki + ${partner}: every copy untaps (or blinks) Kiki-Jiki, five times over`, async () => {
    const g = await scenario([{ battlefield: ['Kiki-Jiki, Mirror Breaker', partner] }, { battlefield: ['Sol Ring'] }]);
    for (let i = 0; i < 5; i++) {
      const k = find(g, 0, 'Kiki-Jiki, Mirror Breaker');
      ok(k && (await g.activate(P(g, 0), k, k.fx.abilities[0])), `activation ${i + 1}`); await settle(g);
    }
    eq(tokens(g, 0), 5, 'hasty copies'); ok(P(g, 0).battlefield.filter(o => o.token).every(o => g.canAttack(o)), 'copies can attack');
    await g.endSteps(P(g, 0)); await settle(g);
    eq(tokens(g, 0), 0, 'copies after the end step'); noErrors(g);
  });
}
await test('Kiki-Jiki + Zealous Conscripts under rules 6 (old replays): the copy steals, Kiki stays tapped', async () => {
  const g = await scenario([{ battlefield: ['Kiki-Jiki, Mirror Breaker', 'Zealous Conscripts'] }, { battlefield: ['Sol Ring'] }], { rules: 6 });
  const k = find(g, 0, 'Kiki-Jiki, Mirror Breaker');
  await g.activate(P(g, 0), k, k.fx.abilities[0]); await settle(g);
  eq(k.tapped, true, 'Kiki tapped');
});
await test('Splinter Twin + Pestermite: the enchanted creature gets the copy ability, and each copy untaps it', async () => {
  const g = await scenario([{ battlefield: ['Pestermite'], hand: ['Splinter Twin'] }, {}]);
  mana(g, 0);
  const pm = find(g, 0, 'Pestermite');
  await cast(g, 0, 'Splinter Twin', { auraTarget: pm });
  for (let i = 0; i < 5; i++) { ok(await g.activate(P(g, 0), pm, ab(g, pm, 'copyToken')), `activation ${i + 1}`); await settle(g); }
  eq(tokens(g, 0), 5, 'copies'); noErrors(g);
});
await test('Splinter Twin under rules 6 (old replays): no ability granted', async () => {
  const g = await scenario([{ battlefield: ['Pestermite'], hand: ['Splinter Twin'] }, {}], { rules: 6 });
  mana(g, 0);
  const pm = find(g, 0, 'Pestermite');
  await cast(g, 0, 'Splinter Twin', { auraTarget: pm });
  eq(ab(g, pm, 'copyToken'), undefined, 'granted ability');
});
await test('Saheeli Rai + Felidar Guardian: each copy blinks Saheeli back with fresh loyalty', async () => {
  const g = await scenario([{ battlefield: ['Saheeli Rai', 'Felidar Guardian'] }, {}]);
  for (let i = 0; i < 4; i++) {
    const s = find(g, 0, 'Saheeli Rai');
    ok(s && !s.usedPW && s.loyalty >= 2, `Saheeli ready (${i + 1})`);
    await g.activatePW(P(g, 0), s, s.fx.pw[1]); await settle(g);
  }
  eq(tokens(g, 0), 4, 'hasty Guardian copies'); noErrors(g);
});

await test('Mikaeus, the Unhallowed + Triskelion: undying (granted) brings Triskelion back with fresh counters', async () => {
  const g = await scenario([{ battlefield: ['Mikaeus, the Unhallowed'], hand: ['Triskelion'] }, {}]);
  mana(g, 0); await cast(g, 0, 'Triskelion');
  const t = find(g, 0, 'Triskelion');
  for (let loop = 0; loop < 3; loop++) {
    eq(t.zone, 'battlefield', `Triskelion back (loop ${loop})`);
    // two counters at the opponent (one on the first pass), the last two at itself: it dies as a 2/2 with no counters
    while (t.counters > 2) { await g.ping(P(g, 0), t, [tgtPlayer(1)]); await settle(g); }
    for (let k = 0; k < 2; k++) { await g.ping(P(g, 0), t, [tgtObj(t)]); await settle(g); }
  }
  eq(P(g, 1).life, 35, 'opponent life (1 + 2 + 2)'); eq(t.zone, 'battlefield', 'Triskelion still looping'); noErrors(g);
});
await test('Mikaeus + Triskelion under rules 6 (old replays): granted undying was not seen', async () => {
  const g = await scenario([{ battlefield: ['Mikaeus, the Unhallowed', 'Triskelion'] }, {}], { rules: 6 });
  const t = find(g, 0, 'Triskelion');
  g.damageObj(t, 5, t); await settle(g);
  eq(t.zone, 'graveyard', 'Triskelion stays dead');
});
await test('Professor Onyx + Chain of Smog: copying the spell at yourself drains the table', async () => {
  const g = await scenario([{ battlefield: ['Professor Onyx'], hand: ['Chain of Smog'] }, {}, {}]);
  mana(g, 0);
  await g.cast(P(g, 0), find(g, 0, 'Chain of Smog', 'hand'), { targets: [tgtPlayer(0)] }); await settle(g);
  eq([P(g, 1).lost, P(g, 2).lost], [true, true], 'opponents lost'); noErrors(g);
});
await test("Painter's Servant + Grindstone: every pair shares a color, so the whole library is milled", async () => {
  const g = await scenario([{ battlefield: ["Painter's Servant", 'Grindstone'] }, { filler: 40 }]);
  mana(g, 0);
  const gs = find(g, 0, 'Grindstone');
  await g.activate(P(g, 0), gs, gs.fx.abilities[0]); await settle(g);
  eq(P(g, 1).library.length, 0, 'opponent library');
});
await test('Grindstone alone: colorless cards share no color, so it mills just two', async () => {
  const g = await scenario([{ battlefield: ['Grindstone'] }, { filler: 40 }]);
  mana(g, 0);
  const gs = find(g, 0, 'Grindstone');
  await g.activate(P(g, 0), gs, gs.fx.abilities[0]); await settle(g);
  eq(P(g, 1).library.length, 38, 'opponent library');
});

// Mana loops: [pool after tapping, pool after untapping] per iteration, paid for by the real costs
const manaLoop = async (bf, opts = {}, n = 4) => {
  const g = await scenario([{ battlefield: bf }, {}], opts);
  const m = P(g, 0).battlefield.find(o => /Monolith|Devoted Druid/.test(o.card.name));
  const out = [];
  for (let i = 0; i < n; i++) {
    if (!m.tapped) g.tapForMana(P(g, 0), m);
    const a = g.abilitiesOf(m).find(x => x.effects.some(e => e.k === 'untapSelf'));
    if (!(await g.activate(P(g, 0), m, a))) break;
    await settle(g);
    out.push(P(g, 0).pool.length);
  }
  return { g, out };
};
await test('Basalt Monolith + Rings of Brighthearth: the copied untap nets one mana per loop', async () => {
  const { out } = await manaLoop(['Basalt Monolith', 'Rings of Brighthearth', 'Sol Ring']);
  eq(out, [3, 4, 5, 6], 'mana in pool after each loop');
});
await test('Basalt Monolith + Rings under rules 6 (old replays): no copy of the untap, no gain', async () => {
  const { out } = await manaLoop(['Basalt Monolith', 'Rings of Brighthearth', 'Sol Ring'], { rules: 6 });
  eq(out.every(n => n <= 2), true, `no growth (${out})`);
});
for (const [bf, per] of [[['Basalt Monolith', 'Power Artifact'], 2], [['Basalt Monolith', 'Zirda, the Dawnwaker'], 2], [['Grim Monolith', 'Zirda, the Dawnwaker'], 1], [['Basalt Monolith', 'Kinnan, Bonder Prodigy'], 1]]) {
  await test(`${bf.join(' + ')}: ${per} more mana each loop`, async () => {
    const g0 = await scenario([{ battlefield: bf.filter(n => n !== 'Power Artifact'), hand: bf.filter(n => n === 'Power Artifact') }, {}]);
    let out;
    if (bf.includes('Power Artifact')) {
      mana(g0, 0); await cast(g0, 0, 'Power Artifact', { auraTarget: find(g0, 0, 'Basalt Monolith') }); P(g0, 0).infiniteMana = 0;
      const m = find(g0, 0, 'Basalt Monolith');
      out = [];
      for (let i = 0; i < 4; i++) { g0.tapForMana(P(g0, 0), m); await g0.activate(P(g0, 0), m, m.fx.abilities[0]); await settle(g0); out.push(P(g0, 0).pool.length); }
    } else out = (await manaLoop(bf)).out;
    eq(out.slice(1).map((n, i) => n - out[i]), [per, per, per], `gain per loop (${out})`);
  });
}
await test('Devoted Druid + Vizier of Remedies: untaps forever; without Vizier the Druid dies on the second untap', async () => {
  const { g, out } = await manaLoop(['Devoted Druid', 'Vizier of Remedies'], {}, 8);
  eq(out, [1, 2, 3, 4, 5, 6, 7, 8], 'mana');
  const d = find(g, 0, 'Devoted Druid');
  g.move(find(g, 0, 'Vizier of Remedies'), 'graveyard');
  for (let i = 0; i < 3 && d.zone === 'battlefield'; i++) { g.tapForMana(P(g, 0), d); await g.activate(P(g, 0), d, d.fx.abilities[0]); await settle(g); }
  eq(d.zone, 'graveyard', 'the loop stops: Druid dies');
});
await test('Pili-Pala + Grand Architect: Pili-Pala made blue taps for {C}{C} and untaps for one colored mana', async () => {
  const g = await scenario([{ battlefield: ['Pili-Pala', 'Grand Architect', 'Island'] }, {}]);
  const pp = find(g, 0, 'Pili-Pala'), ga = find(g, 0, 'Grand Architect');
  ok(await g.activate(P(g, 0), ga, ab(g, ga, 'makeColor')), 'Pili-Pala becomes blue'); await settle(g);
  ok(g.isA(pp, 'blue creature'), 'blue creature');
  const tapBlue = ga.fx.abilities.find(a => a.costs?.tapOthers);
  const trace = [];
  for (let i = 0; i < 4; i++) {
    ok(await g.activate(P(g, 0), ga, tapBlue), `tap Pili-Pala (${i + 1})`); await settle(g);
    ok(pp.tapped, 'Pili-Pala tapped');
    ok(await g.activate(P(g, 0), pp, pp.fx.abilities[0]), `Pili-Pala untaps (${i + 1})`); await settle(g);
    trace.push(P(g, 0).pool.length);
  }
  eq(trace, [1, 2, 3, 4], 'one mana more each loop');
});
await test('Isochron Scepter + Dramatic Reversal: each activation untaps the rocks that paid for it (net +1)', async () => {
  const g = await scenario([{ battlefield: ['Sol Ring', 'Arcane Signet'], hand: ['Isochron Scepter', 'Dramatic Reversal'] }, {}]);
  mana(g, 0); await cast(g, 0, 'Isochron Scepter', { imprint: find(g, 0, 'Dramatic Reversal', 'hand') }); P(g, 0).infiniteMana = 0;
  const sc = find(g, 0, 'Isochron Scepter');
  for (const o of P(g, 0).battlefield) o.tapped = false;
  const trace = [];
  for (let i = 0; i < 4; i++) {
    for (const o of P(g, 0).battlefield) if (o.fx.mana && !o.tapped) g.tapForMana(P(g, 0), o);
    ok(await g.activate(P(g, 0), sc, ab(g, sc, 'castImprint')), `activation ${i + 1}`); await settle(g);
    trace.push(P(g, 0).pool.length);
  }
  eq(trace, [1, 2, 3, 4], 'floating mana'); eq(P(g, 0).exile.map(o => o.card.name), ['Dramatic Reversal'], 'the card stays imprinted'); noErrors(g);
});
await test('Isochron Scepter under rules 6 (old replays): the ability is not there', async () => {
  const g = await scenario([{ battlefield: ['Isochron Scepter'] }, {}], { rules: 6 });
  const sc = find(g, 0, 'Isochron Scepter');
  eq(g.canActivate(P(g, 0), sc, sc.fx.abilities.find(a => a.minRules) || { cost: '', minRules: 7, effects: [] }), false, 'activatable');
});
await test('Food Chain + Squee: exiling Squee makes 4 creature-only mana, recasting costs 3 (net +1 each loop)', async () => {
  const g = await scenario([{ battlefield: ['Food Chain', 'Squee, the Immortal'], hand: ['Lightning Bolt'] }, {}]);
  const fc = find(g, 0, 'Food Chain');
  const trace = [];
  for (let i = 0; i < 3; i++) {
    ok(await g.activate(P(g, 0), fc, fc.fx.abilities[0]), `exile Squee (${i + 1})`); await settle(g);
    const sq = find(g, 0, 'Squee, the Immortal', 'exile');
    ok(sq && (await g.cast(P(g, 0), sq)), `recast Squee (${i + 1})`); await settle(g);
    trace.push(P(g, 0).pool.length);
  }
  eq(trace, [1, 2, 3], 'creature mana left'); eq(g.canCast(P(g, 0), find(g, 0, 'Lightning Bolt', 'hand')), false, 'the mana cannot pay for Lightning Bolt');
});
await test('Food Chain + Eternal Scourge: Eternal Scourge can be cast from exile', async () => {
  const g = await scenario([{ battlefield: ['Food Chain', 'Eternal Scourge'] }, {}]);
  const fc = find(g, 0, 'Food Chain');
  await g.activate(P(g, 0), fc, fc.fx.abilities[0]); await settle(g);
  eq(P(g, 0).pool.length, 4, 'mana (1 + its mana value 3)');
  ok(await g.cast(P(g, 0), find(g, 0, 'Eternal Scourge', 'exile')), 'cast from exile'); await settle(g);
  ok(find(g, 0, 'Eternal Scourge'), 'on the battlefield');
});
await test('Gravecrawler + Phyrexian Altar + Blood Artist: sacrifice, drain, recast while you control another Zombie', async () => {
  const g = await scenario([{ battlefield: ['Gravecrawler', 'Phyrexian Altar', 'Blood Artist', 'Carrion Feeder'] }, {}]);
  for (let i = 0; i < 3; i++) {
    await g.sacTo(P(g, 0), find(g, 0, 'Phyrexian Altar'), find(g, 0, 'Gravecrawler')); await settle(g);
    ok(await g.cast(P(g, 0), find(g, 0, 'Gravecrawler', 'graveyard')), `recast ${i + 1}`); await settle(g);
  }
  eq(P(g, 1).life, 37, 'drained three times'); eq(P(g, 0).pool.length, 0, 'mana used up');
  g.move(find(g, 0, 'Carrion Feeder'), 'graveyard'); await settle(g);
  await g.sacTo(P(g, 0), find(g, 0, 'Phyrexian Altar'), find(g, 0, 'Gravecrawler')); await settle(g);
  eq(g.castMode(P(g, 0), find(g, 0, 'Gravecrawler', 'graveyard')), null, 'no other Zombie: the loop stops');
});
await test('Reveillark + Karmic Guide + Viscera Seer: each returns the other, Blood Artist drains every time', async () => {
  const g = await scenario([{ battlefield: ['Reveillark', 'Viscera Seer', 'Blood Artist'], graveyard: ['Karmic Guide'] }, {}]);
  for (let i = 0; i < 3; i++) {
    await g.sacTo(P(g, 0), find(g, 0, 'Viscera Seer'), find(g, 0, 'Reveillark')); await settle(g);
    ok(find(g, 0, 'Karmic Guide'), `Lark returned Karmic Guide (${i + 1})`);
    ok(find(g, 0, 'Reveillark'), `Guide returned Reveillark (${i + 1})`);
    await g.sacTo(P(g, 0), find(g, 0, 'Viscera Seer'), find(g, 0, 'Karmic Guide')); await settle(g);
  }
  eq(P(g, 1).life, 34, 'six deaths drained'); noErrors(g);
});
await test('Temur Sabertooth returns another creature to hand (then gains indestructible)', async () => {
  const g = await scenario([{ battlefield: ['Temur Sabertooth', 'Peregrine Drake'] }, {}]);
  mana(g, 0);
  const t = find(g, 0, 'Temur Sabertooth');
  await g.activate(P(g, 0), t, t.fx.abilities[0]); await settle(g);
  eq(names(g, 0, 'hand'), ['Peregrine Drake'], 'hand'); ok(g.has(t, 'indestructible'), 'indestructible');
});
await test("Nim Deathmantle + Ashnod's Altar + Peregrine Drake: pay {4}, the Drake returns and untaps five lands", async () => {
  const g = await scenario([{ battlefield: ['Nim Deathmantle', "Ashnod's Altar", 'Peregrine Drake', 'Island', 'Island', 'Island', 'Island', 'Island'] }, {}]);
  const trace = [];
  for (let i = 0; i < 3; i++) {
    await g.sacTo(P(g, 0), find(g, 0, "Ashnod's Altar"), find(g, 0, 'Peregrine Drake')); await settle(g);
    const d = find(g, 0, 'Peregrine Drake');
    ok(d && find(g, 0, 'Nim Deathmantle').attachedTo === d, `Drake back with Deathmantle (${i + 1})`);
    for (const o of P(g, 0).battlefield) if (o.fx.type.land && !o.tapped) g.tapForMana(P(g, 0), o);
    trace.push(P(g, 0).pool.length);
  }
  eq(trace.slice(1).map((n, i) => n - trace[i]), [3, 3], `net mana per loop (${trace})`);
});

// The AI's combo shortcut (Game.goOff) with every built-in combo, as games at rules 10 and earlier (and their replays)
// play it: it lands, or the real cards win on the way. (Rules 11 plays combos out with the real cards: tests/combos.mjs)
for (const c of COMBOS.filter(c => !c.source && c.pieces.every(hasCard))) {
  await test(`Combo shortcut (rules 10): ${c.label} lands`, async () => {
    const spellLike = n => /Consultation|Tainted Pact|Dramatic Reversal|Chain of Smog|Twinflame|Heat Shimmer|Brain Freeze|Splinter Twin|Power Artifact|Curiosity|Ophidian Eye|Walking Ballista/.test(n);
    const bf = c.pieces.filter(n => !spellLike(n) && n !== c.last && !(c.imprint && n === c.imprint.host));
    const pact = /Tainted Pact/.test(c.label);
    const g = await scenario([{ battlefield: [...bf, ...Array(8).fill('Island'), ...(c.imprint ? ['Sol Ring', 'Arcane Signet'] : []), 'Grizzly Bears'],
      hand: c.pieces.filter(n => !bf.includes(n)), filler: pact ? 0 : 20, library: pact ? ['Forest', 'Mountain', 'Plains'] : [], graveyard: /Breach/.test(c.label) ? Array(6).fill('Wastes') : [] }, {}, {}], { rules: 10 });
    mana(g, 0);
    await g.goOff(P(g, 0), c); await settle(g);
    ok(g.comboLog.some(x => x.landed) || g.winner === P(g, 0), 'landed or won'); noErrors(g);
  });
}

// The loop shortcut for people (rules 7: sacrifices and creature spells too): played twice, then repeated
await test('Loop shortcut: Gravecrawler sacrificed and recast twice by hand, then repeated ×10 (stops when the Zombie is gone)', async () => {
  const g = await scenario([{ battlefield: ['Gravecrawler', 'Phyrexian Altar', 'Blood Artist', 'Carrion Feeder'] }, {}]);
  // (the seat's own choices, such as Blood Artist's target, stay with the AI; only the shortcut is the human seat's)
  const human = Object.assign(P(g, 0).agent, { acts: [], loopBlock: HumanAgent.prototype.loopBlock, repeatLoop: HumanAgent.prototype.repeatLoop });
  const alt = find(g, 0, 'Phyrexian Altar');
  for (let i = 0; i < 2; i++) {
    await g.sacTo(P(g, 0), alt, find(g, 0, 'Gravecrawler')); await settle(g);
    await g.cast(P(g, 0), find(g, 0, 'Gravecrawler', 'graveyard')); await settle(g);
    human.acts.push({ k: 'sac', iid: alt.iid, name: 'Gravecrawler' }, { k: 'cast', name: 'Gravecrawler', zone: 'graveyard' });
  }
  const block = human.loopBlock();
  eq(block?.map(x => x.k), ['sac', 'cast'], 'loop found');
  await human.repeatLoop(g, P(g, 0), block, 10); await settle(g);
  eq(P(g, 1).life, 28, 'two by hand + ten repeated drains');
  g.move(find(g, 0, 'Carrion Feeder'), 'graveyard'); await settle(g);
  await human.repeatLoop(g, P(g, 0), block, 10); await settle(g);
  eq(P(g, 1).life, 26, 'Carrion Feeder dying and one more sacrifice drain, then the recast is refused');
  ok(/repeated the loop 0 of 10 times \(stopped: Gravecrawler can(&#39;|')t be cast/.test(logText(g)), 'stop reason logged'); noErrors(g);
});

// ---------- Loops: no fixed cap on legitimate ones, and endless mandatory loops are a draw (rules 7)
await test('Exquisite Blood + Sanguine Bond against 1,000 life: the long loop runs to the end (was cut off at 600 triggers)', async () => {
  const g = await scenario([{ battlefield: ['Sanguine Bond', 'Exquisite Blood'] }, {}]);
  P(g, 1).life = 1000;
  await resolveEffects(g, 0, find(g, 0, 'Exquisite Blood'), [{ k: 'gain', n: 1 }]);
  eq(P(g, 1).lost, true, 'opponent lost'); noErrors(g);
});
await test('Exquisite Blood + Sanguine Bond in a four-player game: every opponent dies', async () => {
  const g = await scenario([{ battlefield: ['Vito, Thorn of the Dusk Rose', 'Exquisite Blood'] }, {}, {}, {}]);
  await resolveEffects(g, 0, find(g, 0, 'Exquisite Blood'), [{ k: 'gain', n: 1 }]);
  eq([1, 2, 3].map(i => P(g, i).lost), [true, true, true], 'opponents lost');
});
await test('An endless mandatory loop that changes nothing is a draw as soon as it repeats (104.4b)', async () => {
  const g = await scenario([{ battlefield: ['Grizzly Bears'] }, {}]);
  const b = find(g, 0, 'Grizzly Bears');
  // (a made-up pair of triggers: losing life gains it back, gaining life loses it again)
  b.fx = { ...b.fx, watch: [{ ev: 'loseLife', who: 'you', effects: [{ k: 'gain', n: 1 }] }, { ev: 'gainLife', who: 'you', effects: [{ k: 'loseSelf', n: 1 }] }] };
  await resolveEffects(g, 0, b, [{ k: 'loseSelf', n: 1 }]);
  eq([g.over, g.winner], [true, null], 'game over as a draw'); ok(g.trigCount.n < 200, `found early (${g.trigCount.n} triggers)`);
});

// ---------- Cards with more than one face (rules 8): each face has only its own keywords and mana value
await test('Westvale Abbey: the land has none of Ormendahl\'s keywords (rules 8)', async () => {
  const g = await scenario([{ battlefield: ['Westvale Abbey'] }, {}]);
  const o = find(g, 0, 'Westvale Abbey');
  eq(['flying', 'lifelink', 'indestructible', 'haste'].map(k => g.has(o, k)), [false, false, false, false], 'front face keywords');
  eq(['flying', 'lifelink', 'indestructible', 'haste'].map(k => o.card.backCard.fx.kw.has(k)), [true, true, true, true], 'back face keywords');
  noErrors(g);
});
await test('Westvale Abbey under rules 7 (old replays): the front has the back\'s keywords, as before', async () => {
  const g = await scenario([{ battlefield: ['Westvale Abbey'] }, {}], { rules: 7 });
  ok(g.has(find(g, 0, 'Westvale Abbey'), 'flying'), 'old reading kept');
});
await test('Lunarch Veteran and Etali: front faces without back-face flying/indestructible (rules 8)', async () => {
  const g = await scenario([{ battlefield: ['Lunarch Veteran', 'Etali, Primal Conqueror'] }, {}]);
  eq(g.has(find(g, 0, 'Lunarch Veteran'), 'flying'), false, 'Lunarch Veteran flying');
  eq(g.has(find(g, 0, 'Etali, Primal Conqueror'), 'indestructible'), false, 'Etali indestructible');
  eq(g.has(find(g, 0, 'Etali, Primal Conqueror'), 'trample'), true, 'Etali trample');
  ok(find(g, 0, 'Lunarch Veteran').card.backCard.fx.kw.has('flying'), 'Luminous Phantom flies');
});
const stackMv = g => { const seen = []; g.on('cast', ({ o }) => seen.push([o.card.name, o.card.cmc])); return seen; };
await test('Wear // Tear: Wear on the stack has mana value 2, the card 3 everywhere else (709.3b, 709.4b)', async () => {
  const g = await scenario([{ hand: ['Wear // Tear'] }, { battlefield: ['Sol Ring'] }]);
  mana(g, 0);
  const seen = stackMv(g), o = find(g, 0, 'Wear // Tear', 'hand');
  eq(o.card.cmc, 3, 'in hand');
  await cast(g, 0, 'Wear // Tear');
  eq(seen, [['Wear // Tear', 2]], 'on the stack');
  eq([o.zone, o.card.cmc], ['graveyard', 3], 'in the graveyard');
  eq(find(g, 1, 'Sol Ring'), undefined, 'Sol Ring destroyed'); noErrors(g);
});
await test('Wear // Tear under rules 7 (old replays): mana value 3 on the stack, as before', async () => {
  const g = await scenario([{ hand: ['Wear // Tear'] }, { battlefield: ['Sol Ring'] }], { rules: 7 });
  mana(g, 0);
  const seen = stackMv(g);
  await cast(g, 0, 'Wear // Tear');
  eq(seen, [['Wear // Tear', 3]], 'on the stack');
});
await test('Dazzling Theater // Prop Room: one door unlocked has that door\'s mana value, both doors the sum (709.5)', async () => {
  const g = await scenario([{ hand: ['Dazzling Theater // Prop Room'] }, {}]);
  mana(g, 0);
  await cast(g, 0, 'Dazzling Theater // Prop Room');
  const o = find(g, 0, 'Dazzling Theater // Prop Room');
  ok(o, 'Room on the battlefield');
  eq(o.card.cmc, 4, 'Dazzling Theater unlocked');
  eq(g.lockedDoor(o)?.name, 'Prop Room', 'locked door');
  ok(await g.unlockRoom(P(g, 0), o), 'unlocks Prop Room');
  eq([o.card.cmc, g.lockedDoor(o)], [7, null], 'fully unlocked');
  g.move(o, 'hand');
  eq(o.card.cmc, 7, 'back in hand'); noErrors(g);
});

// ---------- Sentences the reader used to skip (rules 9, item 188)
const handN = (g, i) => P(g, i).hand.length;
const killBears = async (g, n) => { for (let k = 0; k < n; k++) { const b = find(g, 1, 'Grizzly Bears'); g.destroy(b); await settle(g); } };
await test('Morbid Opportunist: "triggers only once each turn" — three deaths, one card', async () => {
  const g = await scenario([{ battlefield: ['Morbid Opportunist'] }, { battlefield: ['Grizzly Bears', 'Grizzly Bears', 'Grizzly Bears'] }]);
  const before = handN(g, 0);
  await killBears(g, 3);
  eq(handN(g, 0) - before, 1, 'cards drawn this turn'); noErrors(g);
});
await test('Morbid Opportunist: the next turn it triggers again', async () => {
  const g = await scenario([{ battlefield: ['Morbid Opportunist'] }, { battlefield: ['Grizzly Bears', 'Grizzly Bears'] }]);
  const before = handN(g, 0);
  await killBears(g, 1);
  g.turn++;
  await killBears(g, 1);
  eq(handN(g, 0) - before, 2, 'one card each turn');
});
await test('Morbid Opportunist under rules 8 (old replays): a card for every death, as before', async () => {
  const g = await scenario([{ battlefield: ['Morbid Opportunist'] }, { battlefield: ['Grizzly Bears', 'Grizzly Bears', 'Grizzly Bears'] }], { rules: 8 });
  const before = handN(g, 0);
  await killBears(g, 3);
  eq(handN(g, 0) - before, 3, 'cards drawn');
});
const landIn = async (g, name, opts = {}) => { const o = find(g, 0, name, 'hand'); ok(o, `${name} in hand`); g.move(o, 'battlefield', opts); await settle(g); return o; };
await test('Watery Grave: paying 2 life lets it enter untapped; not paying, tapped', async () => {
  const g = await scenario([{ hand: ['Watery Grave', 'Watery Grave'] }, {}]);
  const a = await landIn(g, 'Watery Grave', { payLife: true });
  eq([a.tapped, P(g, 0).life], [false, 38], 'paid');
  const b = await landIn(g, 'Watery Grave', { payLife: false });
  eq([b.tapped, P(g, 0).life], [true, 38], 'not paid'); noErrors(g);
});
await test('Watery Grave: the AI pays when it has a spell to cast with the mana, and not at low life', async () => {
  const g = await scenario([{ hand: ['Watery Grave', 'Lightning Bolt'] }, {}]);
  g.active = 0;
  const a = await landIn(g, 'Watery Grave');
  eq([a.tapped, P(g, 0).life], [false, 38], 'paid for Lightning Bolt');
  const h = await scenario([{ hand: ['Watery Grave', 'Lightning Bolt'], life: 9 }, {}]);
  h.active = 0;
  const b = await landIn(h, 'Watery Grave');
  eq([b.tapped, P(h, 0).life], [true, 9], 'kept life at 9');
});
await test('Watery Grave under rules 8 (old replays): untapped for free, as before', async () => {
  const g = await scenario([{ hand: ['Watery Grave'] }, {}], { rules: 8 });
  const a = await landIn(g, 'Watery Grave', { payLife: false });
  eq([a.tapped, P(g, 0).life], [false, 40], 'free and untapped');
});
await test('Check, fast and "two or more opponents" lands check their condition as they enter', async () => {
  const g = await scenario([{ battlefield: ['Island', 'Island', 'Island'], hand: ['Drowned Catacomb', 'Isolated Chapel', 'Blooming Marsh', 'Sea of Clouds'] }, {}, {}]);
  eq((await landIn(g, 'Drowned Catacomb')).tapped, false, 'Drowned Catacomb with an Island');
  eq((await landIn(g, 'Isolated Chapel')).tapped, true, 'Isolated Chapel without Plains or Swamp');
  eq((await landIn(g, 'Blooming Marsh')).tapped, true, 'Blooming Marsh with five other lands');
  eq((await landIn(g, 'Sea of Clouds')).tapped, false, 'Sea of Clouds with two opponents');
  const h = await scenario([{ hand: ['Blooming Marsh', 'Sea of Clouds'] }, {}]);
  eq((await landIn(h, 'Blooming Marsh')).tapped, false, 'Blooming Marsh as the first land');
  eq((await landIn(h, 'Sea of Clouds')).tapped, true, 'Sea of Clouds with one opponent'); noErrors(g); noErrors(h);
});
await test('Terminate: "it can\'t be regenerated" goes through a regeneration shield', async () => {
  const g = await scenario([{ hand: ['Terminate'] }, { battlefield: ['Grizzly Bears'] }]);
  const v = find(g, 1, 'Grizzly Bears'); v.regen = 1;
  await spell(g, 0, 'Terminate', [tgtObj(v)]);
  eq(v.zone, 'graveyard', 'Grizzly Bears zone'); noErrors(g);
});
await test('Terminate under rules 8 (old replays): the shield saves it, as before', async () => {
  const g = await scenario([{ hand: ['Terminate'] }, { battlefield: ['Grizzly Bears'] }], { rules: 8 });
  const v = find(g, 1, 'Grizzly Bears'); v.regen = 1;
  await spell(g, 0, 'Terminate', [tgtObj(v)]);
  eq(v.zone, 'battlefield', 'Grizzly Bears zone');
});
await test('Skipped sentences are reported (Tainted Wood, Mob Rule) and read ones are not', async () => {
  const { droppedSentences, ignoredText } = await import('../public/js/effects.js');
  const g = await scenario([{ battlefield: ['Tainted Wood', 'Watery Grave', 'Morbid Opportunist', 'Terminate', 'Insurrection', 'Mob Rule'] }, {}]);
  const d = n => droppedSentences(find(g, 0, n).card);
  eq(d('Tainted Wood'), ['Activate only if you control a Swamp.'], 'Tainted Wood');
  ok(/^partly read: /.test(ignoredText(find(g, 0, 'Tainted Wood').card) || ''), 'Tainted Wood counts as partly read');
  ok(d('Mob Rule').includes('They gain haste until end of turn.'), 'Mob Rule haste');
  for (const n of ['Watery Grave', 'Morbid Opportunist', 'Terminate', 'Insurrection']) eq(d(n), [], n);
});

const failed = results.filter(([, e]) => e);
for (const [n, e] of failed) console.log(`FAIL ${n}\n     ${e.message.split('\n')[0]}`);
console.log(`Interactions: ${results.length} tests, ${results.length - failed.length} passed, ${failed.length} failed.`);
process.exit(failed.length ? 1 : 0);
