import { pathToFileURL } from 'node:url';
const root = process.argv[2];
const { scenario, find, P, tgtObj, resolveEffects } = await import(pathToFileURL(root + '/tests/scenario.mjs'));
const show = (id, s) => console.log(id, s);
{ const g = await scenario([{ hand: ['Persist'], graveyard: ['Sheoldred, the Apocalypse'] }, {}]);
  const o = find(g, 0, 'Persist', 'hand'); const gr = find(g, 0, 'Sheoldred, the Apocalypse', 'graveyard');
  await resolveEffects(g, 0, o, o.fx.spell, [tgtObj(gr)]);
  show('P33 Persist', `legendary Sheoldred zone=${gr.zone} counters=${gr.counters}`); }
{ const g = await scenario([{ battlefield: ['Springheart Nantuko', 'Forest'] }, {}]);
  const s = find(g, 0, 'Springheart Nantuko'), f = find(g, 0, 'Forest');
  await resolveEffects(g, 0, s, s.fx.landfall, [], { trig: { o: f } });
  show('P34 Springheart Nantuko (unattached)', `tokens=${JSON.stringify(P(g,0).battlefield.filter(x=>x.token).map(x=>x.card.name))} (want one 1/1 Insect)`); }
{ const g = await scenario([{ hand: ['Artifact Mutation'] }, { battlefield: ['Gilded Lotus'] }]);
  const o = find(g, 0, 'Artifact Mutation', 'hand'), a = find(g, 1, 'Gilded Lotus');
  await resolveEffects(g, 0, o, o.fx.spell, [tgtObj(a)]);
  show('P35 Artifact Mutation', `Gilded Lotus zone=${a.zone}; P1 tokens=${P(g,0).battlefield.filter(x=>x.token).length}`); }
{ const g = await scenario([{ battlefield: ['Great Hall of the Citadel'], hand: ['Lightning Bolt'] }, {}]);
  g.active = 0; show('P36 Great Hall of the Citadel', `fx.mana=${JSON.stringify(find(g,0,'Great Hall of the Citadel').fx.mana)}; Lightning Bolt castable from {T} alone=${!!g.canCast(P(g,0), find(g,0,'Lightning Bolt','hand'))}`); }
{ const g = await scenario([{ battlefield: ['Mox Jasper'], hand: ['Lightning Bolt'] }, {}]);
  g.active = 0; show('P37 Mox Jasper (no Dragon)', `Lightning Bolt castable=${!!g.canCast(P(g,0), find(g,0,'Lightning Bolt','hand'))}`); }
{ const g = await scenario([{ battlefield: ['Birgi, God of Storytelling'], hand: ['Lightning Bolt'] }, {}]);
  const b = find(g, 0, 'Birgi, God of Storytelling'); await resolveEffects(g, 0, b, b.fx.onCast.effects, []);
  const n0 = P(g,0).pool.length; g.setPhase('combat'); show('P38 Birgi', `pool after trigger=${n0}; after a phase change=${P(g,0).pool.length}`); }
{ const g = await scenario([{ battlefield: ['Training Grounds', 'Llanowar Elves'] }, {}]);
  const c = g.abilityCost(P(g,0), find(g,0,'Llanowar Elves'), { cost: '{2}', effects: [] });
  show('P39 Training Grounds floor', `a {2} creature ability costs ${JSON.stringify(c)}`); }
{ const g = await scenario([{ battlefield: ['Maelstrom of the Spirit Dragon'], library: ['Lightning Bolt'], filler: 3 }, {}]);
  const m = find(g, 0, 'Maelstrom of the Spirit Dragon'); g.active = 0; P(g,0).infiniteMana = g.turn;
  const h = P(g,0).hand.length; await resolveEffects(g, 0, m, m.fx.abilities[0].effects, []);
  show('P40 Maelstrom tutor', `hand ${h}->${P(g,0).hand.length}: ${P(g,0).hand.map(o=>o.card.name)} (only a Dragon is legal; library has none)`); }
{ const g = await scenario([{ hand: ['Delay'] }, {}]);
  show('P41 Delay', `spell reading=${JSON.stringify(find(g,0,'Delay','hand').fx.spell)}`); }
