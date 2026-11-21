// Phase 2C runtime probes: each builds a small board with real cards and reports what the engine does.
// Read-only use of the project: imports tests/scenario.mjs and public/js; writes nothing.
import { pathToFileURL } from 'node:url';
const root = process.argv[2];
const S = await import(pathToFileURL(root + '/tests/scenario.mjs'));
const R = await import(pathToFileURL(root + '/public/js/resolve.js'));
const { scenario, find, P, tgtObj, resolveEffects, settle, logText } = S;
const out = [];
const probe = async (id, card, expected, fn) => {
  try { const r = await fn(); out.push({ id, card, expected, actual: r.actual, defect: r.defect, note: r.note || '' }); }
  catch (e) { out.push({ id, card, expected, actual: 'PROBE ERROR: ' + String(e.message).split('\n')[0], defect: null }); }
};
const hand = (g, i) => P(g, i).hand.length;

await probe('P01', 'Delina, Wild Mage', 'On 1-14 create a tapped attacking token copy of target creature you control; Delina stays', async () => {
  for (let seed = 1; seed < 60; seed++) {
    const g = await scenario([{ battlefield: ['Delina, Wild Mage', 'Grizzly Bears'] }, {}], { seed });
    const d = find(g, 0, 'Delina, Wild Mage');
    await resolveEffects(g, 0, d, d.fx.attack, []);
    const roll = (logText(g).match(/rolls a d20: (\d+)/) || [])[1];
    if (roll && +roll <= 14) return { actual: `roll ${roll}: Delina zone=${d.zone}; tokens=${P(g, 0).battlefield.filter(o => o.token).length}`, defect: d.zone !== 'battlefield' };
  }
  return { actual: 'no low roll found', defect: null };
});
await probe('P02', 'Rite of the Raging Storm', 'Each upkeep, that player creates a 5/1 Lightning Rager; Rite stays', async () => {
  const g = await scenario([{ battlefield: ['Rite of the Raging Storm'] }, {}]);
  const r = find(g, 0, 'Rite of the Raging Storm');
  await resolveEffects(g, 0, r, r.fx.watch[0].effects, []);
  return { actual: `Rite zone=${r.zone}; P2 permanents=${P(g, 1).battlefield.length}`, defect: r.zone !== 'battlefield' };
});
await probe('P03', 'Noxious Gearhulk', 'Destroy target creature, gain life equal to its toughness (Craterhoof: 9)', async () => {
  const g = await scenario([{ battlefield: ['Noxious Gearhulk'] }, { battlefield: ['Craterhoof Behemoth'] }]);
  const n = find(g, 0, 'Noxious Gearhulk'), v = find(g, 1, 'Craterhoof Behemoth');
  await resolveEffects(g, 0, n, n.fx.etb, [tgtObj(v)]);
  return { actual: `Craterhoof zone=${v.zone}; life=${P(g, 0).life} (start 40)`, defect: P(g, 0).life === 40 && v.zone === 'graveyard' };
});
await probe('P04', 'Not of This World', 'Costs {7} unless it targets a spell/ability targeting your power-7+ creature', async () => {
  const g = await scenario([{ hand: ['Not of This World'] }, {}]);
  const o = find(g, 0, 'Not of This World', 'hand');
  const c = g.costOf(P(g, 0), o);
  return { actual: `cost with nothing on the stack: ${JSON.stringify(c.c ?? c)}`, defect: /"generic":0/.test(JSON.stringify(c)) };
});
await probe('P05', 'The Indomitable', 'Castable from graveyard only with three or more tapped Pirates/Vehicles', async () => {
  const g = await scenario([{ graveyard: ['The Indomitable'] }, {}]);
  const o = find(g, 0, 'The Indomitable', 'graveyard');
  g.active = 0; P(g, 0).infiniteMana = g.turn;
  const m = g.castModeRaw(P(g, 0), o);
  return { actual: `castModeRaw from graveyard with no Pirates/Vehicles: ${JSON.stringify(m)}`, defect: m != null };
});
await probe('P06', 'Painful Truths', 'Draw X and lose X life, X = colors spent (e.g. 2 or 3)', async () => {
  const g = await scenario([{ hand: ['Painful Truths'] }, {}]);
  const o = find(g, 0, 'Painful Truths', 'hand'); const h = hand(g, 0);
  await resolveEffects(g, 0, o, o.fx.spell, []);
  return { actual: `cards drawn=${hand(g, 0) - h}; life=${P(g, 0).life}`, defect: hand(g, 0) - h === 0 };
});
await probe('P07', 'Gilded Drake', 'Exchange control with up to one target opponent creature; sacrifice only if no exchange', async () => {
  const g = await scenario([{ battlefield: ['Gilded Drake'] }, { battlefield: ['Craterhoof Behemoth'] }]);
  const d = find(g, 0, 'Gilded Drake'), v = find(g, 1, 'Craterhoof Behemoth');
  await resolveEffects(g, 0, d, d.fx.etb, [tgtObj(v)]);
  return { actual: `Drake zone=${d.zone}, Craterhoof controller=P${v.controller + 1}`, defect: d.zone !== 'battlefield' && v.controller === 1 };
});
await probe('P08', 'Charming Scoundrel', 'Mode 1: discard a card, then draw a card (hand size unchanged)', async () => {
  const g = await scenario([{ battlefield: ['Charming Scoundrel'], hand: ['Forest', 'Island'] }, {}]);
  const c = find(g, 0, 'Charming Scoundrel'); const h = hand(g, 0); const gy = P(g, 0).graveyard.length;
  await resolveEffects(g, 0, c, c.fx.etbModes.modes[0], []);
  return { actual: `hand ${h}->${hand(g, 0)}, graveyard ${gy}->${P(g, 0).graveyard.length}`, defect: hand(g, 0) === h + 1 };
});
await probe('P09', 'Drown in the Loch', 'Destroy mode: only a creature with MV <= cards in its controller graveyard (0 here)', async () => {
  const g = await scenario([{ hand: ['Drown in the Loch'] }, { battlefield: ['Craterhoof Behemoth'] }]);
  const o = find(g, 0, 'Drown in the Loch', 'hand'), v = find(g, 1, 'Craterhoof Behemoth');
  const e = o.fx.modes.modes[1][0];
  const legal = R.targetLegal(g, P(g, 0), e, tgtObj(v), o);
  return { actual: `Craterhoof (MV 8, empty graveyard) legal target: ${legal}`, defect: legal === true };
});
await probe('P10', 'Thieving Skydiver', 'Kicked X=1: only an artifact with MV <= 1', async () => {
  const g = await scenario([{ battlefield: ['Thieving Skydiver'] }, { battlefield: ['Gilded Lotus'] }]);
  const s = find(g, 0, 'Thieving Skydiver'), a = find(g, 1, 'Gilded Lotus');
  const e = s.fx.etb[0].effects[0];
  const legal = R.targetLegal(g, P(g, 0), e, tgtObj(a), s);
  return { actual: `Gilded Lotus (MV 5) legal for the steal: ${legal}`, defect: legal === true };
});
await probe('P11', 'Approach of the Second Sun', 'Second cast from hand wins; otherwise put 7th from top and gain 7', async () => {
  const g = await scenario([{ hand: ['Approach of the Second Sun'] }, {}]);
  const o = find(g, 0, 'Approach of the Second Sun', 'hand');
  o.castFrom = 'hand';
  await resolveEffects(g, 0, o, o.fx.spell, []);
  return { actual: `winner=${g.winner ?? 'none'}; life=${P(g, 0).life}; reading=${JSON.stringify(o.fx.spell)}`, defect: true, note: 'win branch is never taken (unread condition with an else); no "seventh from the top" effect in the reading' };
});
await probe('P12', 'Eldrazi Monument', 'Upkeep with no creatures: sacrifice the Monument', async () => {
  const g = await scenario([{ battlefield: ['Eldrazi Monument'] }, {}]);
  const m = find(g, 0, 'Eldrazi Monument');
  await resolveEffects(g, 0, m, m.fx.upkeep, []);
  return { actual: `Monument zone=${m.zone}`, defect: m.zone === 'battlefield' };
});
await probe('P13', 'Combustible Gearhulk', 'Opponent chooses: you draw 3, or you mill 3 and it deals damage = total MV', async () => {
  const g = await scenario([{ battlefield: ['Combustible Gearhulk'] }, {}]);
  const c = find(g, 0, 'Combustible Gearhulk'); const h = hand(g, 0);
  await resolveEffects(g, 0, c, c.fx.etb, []);
  return { actual: `drew ${hand(g, 0) - h}; P2 life=${P(g, 1).life}; opponent never asked`, defect: hand(g, 0) - h === 3 };
});
await probe('P14', 'Baleful Mastery', 'Alternative {1}{B} cost: an opponent draws a card', async () => {
  const g = await scenario([{ hand: ['Baleful Mastery'] }, { battlefield: ['Craterhoof Behemoth'] }]);
  const o = find(g, 0, 'Baleful Mastery', 'hand'), v = find(g, 1, 'Craterhoof Behemoth'); const h = hand(g, 1);
  o.castAlt = 'altMana';
  await resolveEffects(g, 0, o, o.fx.spell, [tgtObj(v)], { alt: 'altMana' });
  return { actual: `Craterhoof zone=${v.zone}; opponent drew ${hand(g, 1) - h}`, defect: hand(g, 1) - h === 0 };
});
await probe('P15', "Hunter's Insight", 'No draw on resolution; later draw equal to combat damage the chosen creature deals', async () => {
  const g = await scenario([{ hand: ["Hunter's Insight"], battlefield: ['Craterhoof Behemoth'] }, {}]);
  const o = find(g, 0, "Hunter's Insight", 'hand'); const h = hand(g, 0);
  await resolveEffects(g, 0, o, o.fx.spell, [tgtObj(find(g, 0, 'Craterhoof Behemoth'))]);
  return { actual: `hand ${h}->${hand(g, 0)} on resolution; reading=${JSON.stringify(o.fx.spell)}; no delayed trigger exists in the reading`, defect: true };
});
await probe('P16', 'Sunfall', 'Exile all creatures; incubate X (Incubator artifact token with X +1/+1 counters)', async () => {
  const g = await scenario([{ hand: ['Sunfall'], battlefield: ['Grizzly Bears', 'Llanowar Elves'] }, { battlefield: ['Craterhoof Behemoth'] }]);
  const o = find(g, 0, 'Sunfall', 'hand');
  await resolveEffects(g, 0, o, o.fx.spell, []);
  const toks = P(g, 0).battlefield.filter(x => x.token).map(x => `${x.card.name} ${g.power(x)}/${g.toughness(x)}`);
  return { actual: `P1 tokens after resolution: ${JSON.stringify(toks)}`, defect: !toks.some(t => /incubator/i.test(t)) };
});
await probe('P17', 'Court of Garenbrig', 'Double counters only if you are the monarch', async () => {
  const g = await scenario([{ battlefield: ['Court of Garenbrig', { name: 'Grizzly Bears', counters: 2 }] }, {}]);
  g.monarch = 1;
  const c = find(g, 0, 'Court of Garenbrig'), b = find(g, 0, 'Grizzly Bears');
  const before = b.counters;
  await resolveEffects(g, 0, c, c.fx.upkeep.slice(1), []);
  return { actual: `not the monarch: Bears counters ${before} -> ${b.counters}`, defect: b.counters === before * 2 && before > 0 };
});
await probe('P18', 'Mithril Coat', 'ETB attach only to a legendary creature you control', async () => {
  const g = await scenario([{ battlefield: ['Mithril Coat', 'Grizzly Bears'] }, {}]);
  const m = find(g, 0, 'Mithril Coat');
  await resolveEffects(g, 0, m, m.fx.etb, []);
  return { actual: `attached to: ${m.attachedTo?.card.name || 'nothing'}`, defect: m.attachedTo?.card.name === 'Grizzly Bears' };
});
await probe('P19', 'Delighted Halfling', 'Its colored mana pays only for legendary spells', async () => {
  const g = await scenario([{ battlefield: ['Delighted Halfling'], hand: ['Lightning Bolt'] }, {}]);
  const h = find(g, 0, 'Delighted Halfling'); h.sick = false; g.active = 0;
  const can = g.canCast(P(g, 0), find(g, 0, 'Lightning Bolt', 'hand'));
  return { actual: `Lightning Bolt castable with only the Halfling: ${!!can}; fx.mana=${JSON.stringify(h.fx.mana)}`, defect: !!can };
});
await probe('P20', 'Chainer, Nightmare Adept', 'Only a creature spell may be cast from the graveyard', async () => {
  const g = await scenario([{ battlefield: ['Chainer, Nightmare Adept'], graveyard: ['Lightning Bolt'], hand: ['Forest'] }, {}]);
  const c = find(g, 0, 'Chainer, Nightmare Adept'); g.active = 0; P(g, 0).infiniteMana = g.turn;
  await resolveEffects(g, 0, c, c.fx.abilities[0].effects, []);
  const can = g.canCast(P(g, 0), find(g, 0, 'Lightning Bolt', 'graveyard'));
  return { actual: `gyCast=${JSON.stringify(P(g, 0).gyCast)}; Lightning Bolt castable from graveyard: ${!!can}`, defect: !!can };
});
await probe('P21', 'Unstoppable Slasher', 'Dies with no counters: returns tapped with two stun counters', async () => {
  const g = await scenario([{ graveyard: ['Unstoppable Slasher'] }, {}]);
  const s = find(g, 0, 'Unstoppable Slasher', 'graveyard');
  await resolveEffects(g, 0, s, s.fx.dies, []);
  return { actual: `Slasher zone=${s.zone}`, defect: s.zone === 'graveyard' };
});
await probe('P22', 'Inti, Seneschal of the Sun', 'Optional discard; when you do, +1/+1 counter on target attacking creature, it gains trample', async () => {
  const g = await scenario([{ battlefield: ['Inti, Seneschal of the Sun', 'Grizzly Bears'], hand: ['Forest'] }, {}]);
  const i = find(g, 0, 'Inti, Seneschal of the Sun'), b = find(g, 0, 'Grizzly Bears'); b.attacking = 1;
  const h = hand(g, 0);
  await resolveEffects(g, 0, i, i.fx.watch[0].effects, [], { trig: {} });
  return { actual: `Bears counters=${b.counters}, temp kw=${[...(b.tempKw || [])]}; hand ${h}->${hand(g, 0)}`, defect: b.counters === 0 };
});
await probe('P23', "Witch's Oven", 'Sacrificed creature toughness >= 4: two Food', async () => {
  const g = await scenario([{ battlefield: ["Witch's Oven"] }, {}]);
  const w = find(g, 0, "Witch's Oven");
  await resolveEffects(g, 0, w, w.fx.sacOutlet.effects, []);
  const n = P(g, 0).battlefield.filter(o => /food/i.test(o.card.name)).length;
  return { actual: `Food tokens=${n} (always the else branch, whatever was sacrificed)`, defect: n === 1 };
});
await probe('P24', "Kozilek's Command", 'Mode 1: target player creates X Eldrazi Spawn tokens', async () => {
  const g = await scenario([{ hand: ["Kozilek's Command"] }, {}]);
  const o = find(g, 0, "Kozilek's Command", 'hand'); const pool = P(g, 0).pool.length;
  await resolveEffects(g, 0, o, o.fx.modes.modes[0], [], { x: 3 });
  const t = P(g, 0).battlefield.filter(x => x.token).length;
  return { actual: `mana pool ${pool}->${P(g, 0).pool.length}; Spawn tokens=${t}`, defect: t === 0 };
});
await probe('P25', 'Not Dead After All', 'Target creature returns when it dies this turn (with a Wicked Role)', async () => {
  const g = await scenario([{ hand: ['Not Dead After All'], battlefield: ['Grizzly Bears'] }, {}]);
  const o = find(g, 0, 'Not Dead After All', 'hand'), b = find(g, 0, 'Grizzly Bears');
  await resolveEffects(g, 0, o, o.fx.spell, [tgtObj(b)]);
  g.sacrifice(P(g, 0), b); await settle(g);
  return { actual: `Bears zone after dying=${b.zone}`, defect: b.zone === 'graveyard' };
});
await probe('P26', "Chandra's Ignition", 'Caster chooses target creature they control (here Grizzly Bears)', async () => {
  const g = await scenario([{ hand: ["Chandra's Ignition"], battlefield: ['Grizzly Bears', 'Craterhoof Behemoth'] }, { battlefield: ['Llanowar Elves'] }]);
  const o = find(g, 0, "Chandra's Ignition", 'hand');
  const lt = R.legalTargets(g, P(g, 0), o.fx.spell[0], o);
  await resolveEffects(g, 0, o, o.fx.spell, [tgtObj(find(g, 0, 'Grizzly Bears'))]);
  return { actual: `legalTargets=${JSON.stringify(lt)}; P2 life=${P(g, 1).life} (Bears would deal 2 -> 38)`, defect: P(g, 1).life !== 38, note: 'no target is chosen; the engine picks the best own creature' };
});
await probe('P27', 'Court of Vantress', 'Copy target artifact or enchantment (Sol Ring here)', async () => {
  const g = await scenario([{ battlefield: ['Court of Vantress', 'Sol Ring'] }, {}]);
  g.monarch = 0;
  const c = find(g, 0, 'Court of Vantress');
  await resolveEffects(g, 0, c, c.fx.upkeep, [tgtObj(find(g, 0, 'Sol Ring'))]);
  const toks = P(g, 0).battlefield.filter(x => x.token).map(x => x.card.name);
  return { actual: `tokens=${JSON.stringify(toks)}`, defect: !toks.includes('Sol Ring') };
});
await probe('P28', 'Emergence Zone', 'Spells castable as though they had flash this turn', async () => {
  const g = await scenario([{ battlefield: ['Emergence Zone'] }, {}]);
  const z = find(g, 0, 'Emergence Zone');
  await resolveEffects(g, 0, z, z.fx.abilities[0].effects, []);
  return { actual: `flashNow=${P(g, 0).flashNow}`, defect: P(g, 0).flashNow !== true };
});
await probe('P29', 'Prime Speaker Zegana', 'Enters with X counters, X = greatest power among other creatures (Craterhoof: 5)', async () => {
  const g = await scenario([{ battlefield: ['Craterhoof Behemoth'], hand: ['Prime Speaker Zegana'] }, {}]);
  g.active = 0; P(g, 0).infiniteMana = g.turn;
  const z = find(g, 0, 'Prime Speaker Zegana', 'hand');
  await g.cast(P(g, 0), z, {}); await settle(g);
  return { actual: `Zegana zone=${z.zone} counters=${z.counters} power=${g.power(z)}`, defect: z.zone === 'battlefield' && z.counters === 0 };
});
await probe('P30', 'Sepulchral Primordial', 'Up to one creature card from each opponent graveyard onto your battlefield', async () => {
  const g = await scenario([{ battlefield: ['Sepulchral Primordial'] }, { graveyard: ['Craterhoof Behemoth'] }]);
  const s = find(g, 0, 'Sepulchral Primordial');
  await resolveEffects(g, 0, s, s.fx.etb, []);
  return { actual: `Craterhoof on P1 battlefield: ${!!find(g, 0, 'Craterhoof Behemoth')}`, defect: !find(g, 0, 'Craterhoof Behemoth') };
});
await probe('P31', 'Giver of Runes', 'Protection from colorless or a chosen color (blocks damage, blocking, Auras too)', async () => {
  const g = await scenario([{ battlefield: ['Giver of Runes', 'Grizzly Bears'] }, {}]);
  const gv = find(g, 0, 'Giver of Runes'), b = find(g, 0, 'Grizzly Bears');
  await resolveEffects(g, 0, gv, gv.fx.abilities[0].effects, [tgtObj(b), tgtObj(b)]);
  return { actual: `Bears temp keywords=${JSON.stringify([...(b.tempKw || [])])}; protection=${JSON.stringify(b.tempProt || b.protFrom || null)}`, defect: !(b.tempProt || b.protFrom) && [...(b.tempKw || [])].includes('hexproof') };
});
await probe('P32', 'Rionya / Terastodon-style "nothing read" control', 'Terastodon ETB destroys up to three noncreature permanents', async () => {
  const g = await scenario([{ battlefield: ['Terastodon'] }, { battlefield: ['Sol Ring'] }]);
  const t = find(g, 0, 'Terastodon');
  return { actual: `etb effects=${JSON.stringify(t.fx.etb)}; unread=${JSON.stringify(t.fx.unread)}`, defect: !t.fx.etb.length };
});
console.log(JSON.stringify(out, null, 1));
for (const o of out) console.error(o.id, o.defect === true ? 'DEFECT' : o.defect === false ? 'ok    ' : '??    ', o.card, '|', o.actual);
