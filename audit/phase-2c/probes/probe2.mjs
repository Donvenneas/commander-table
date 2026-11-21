import { pathToFileURL } from 'node:url';
const root = process.argv[2];
const { scenario, find, P } = await import(pathToFileURL(root + '/tests/scenario.mjs'));
const M = await import(pathToFileURL(root + '/public/js/mana.js'));
// Crucible: land in graveyard playable? land on top of library playable?
{ const g = await scenario([{ battlefield: ['Crucible of Worlds'], graveyard: ['Forest'], library: ['Island'], filler: 0 }, {}]);
  g.active = 0; g.phase = 'main1';
  const gyLand = find(g, 0, 'Forest', 'graveyard'); const top = P(g,0).library.at(-1);
  console.log('Crucible: top card', top.card.name, 'topPlayable=', M.topPlayable(g, P(g,0), top), '| canPlayLand(gy Forest)=', g.canPlayLand ? g.canPlayLand(P(g,0), gyLand) : 'n/a');
  const lands = g.playableLands ? g.playableLands(P(g,0)).map(o=>o.card.name+'@'+o.zone) : 'n/a'; console.log('  playableLands', lands); }
{ const g = await scenario([{ battlefield: ['Omniscience'], hand: ['Craterhoof Behemoth'], library: ['Lightning Bolt'], filler: 0 }, {}]);
  g.active = 0; const top = P(g,0).library.at(-1);
  console.log('Omniscience: Lightning Bolt on top playable=', M.topPlayable(g, P(g,0), top), '| canCast Craterhoof from hand with no mana=', !!g.canCast(P(g,0), find(g,0,'Craterhoof Behemoth','hand'))); }
{ const g = await scenario([{ battlefield: ["Yeva, Nature's Herald"], library: ['Llanowar Elves'], filler: 0 }, {}]);
  g.active = 0; P(g,0).infiniteMana = g.turn; const top = P(g,0).library.at(-1);
  console.log('Yeva: Llanowar Elves on top of library playable=', M.topPlayable(g, P(g,0), top), 'canCast=', !!g.canCast(P(g,0), top)); }
