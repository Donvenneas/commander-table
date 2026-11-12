// Card and interaction tests: small boards built from card names (tests/scenario.mjs), each checking one card's rules
// text or one interaction between cards. Every rules fix has a test here showing the old problem is gone; the ones
// gated behind a rules version also check that older replays (rules 5) still play the old way.
//   node tests/interactions.mjs              run them all (exit 1 on any failure)
//   node tests/interactions.mjs Swords       only the tests whose name contains "Swords"
// Cards the snapshots don't have are kept in tests/interaction-cards.json (node tests/fetch-interaction-cards.mjs "Name").
import { scenario, find, all, P, tgtObj, tgtPlayer, resolveEffects, settle, errors } from './scenario.mjs';

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

const failed = results.filter(([, e]) => e);
for (const [n, e] of failed) console.log(`FAIL ${n}\n     ${e.message.split('\n')[0]}`);
console.log(`Interactions: ${results.length} tests, ${results.length - failed.length} passed, ${failed.length} failed.`);
process.exit(failed.length ? 1 : 0);
