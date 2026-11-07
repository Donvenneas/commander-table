// Puzzles: a set board where seat 1 has one turn (starting in its first main phase) to win.
// A puzzle is plain JSON, so boards can be saved, shared and loaded as files:
// { app: 'commander-table-puzzle', name, goal, players: [{ name, commander, life, battlefield: [name |
//   { name, tapped, counters }], hand, graveyard, exile, library: [names], libraryTop: [names],
//   commanderOnBattlefield, commanderDamage: { seat: n } }] }

export const BUILT_IN = [
  {
    name: 'Burn them out', goal: 'win this turn',
    hint: 'Three Mountains, four burn spells. Only one way adds up to 8.',
    players: [
      { name: 'You', commander: 'Krenko, Tin Street Kingpin', battlefield: ['Mountain', 'Mountain', 'Mountain'], hand: ['Lightning Bolt', 'Lava Spike', 'Shock', 'Lightning Strike'] },
      { name: 'Opponent', commander: 'Kenrith, the Returned King', life: 8, battlefield: ['Plains', 'Plains'] },
    ],
  },
  {
    name: 'Through the wall', goal: 'win this turn',
    hint: 'The wall will block your biggest attacker. Two lands, two answers: only one gets you there.',
    players: [
      { name: 'You', commander: 'Kenrith, the Returned King', battlefield: ['Plains', 'Forest', 'Grizzly Bears', 'Hill Giant'], hand: ['Pacifism', 'Giant Growth'] },
      { name: 'Opponent', commander: 'Kenrith, the Returned King', life: 5, battlefield: ['Wall of Omens', 'Island'] },
    ],
  },
  {
    name: 'Sun-crowned', goal: 'win this turn',
    hint: 'Heliod is already out. You have exactly enough mana.',
    players: [
      { name: 'You', commander: 'Heliod, Sun-Crowned', commanderOnBattlefield: true, battlefield: ['Plains', 'Plains', 'Plains', 'Plains'], hand: ['Walking Ballista', 'Swords to Plowshares'] },
      { name: 'Opponent', commander: 'Kenrith, the Returned King', life: 20, battlefield: ['Island', 'Island'] },
    ],
  },
];

// The decklist each puzzle player needs: every named card, plus a library (basic lands if none is given)
export function puzzleDeckText(spec) {
  const names = [];
  for (const z of ['battlefield', 'hand', 'graveyard', 'exile', 'library', 'libraryTop']) for (const e of spec[z] || []) names.push(typeof e === 'string' ? e : e.name);
  const filler = (spec.library?.length || 0) >= 10 ? [] : ['20 Wastes'];
  const counts = new Map();
  for (const n of names) counts.set(n, (counts.get(n) || 0) + 1);
  // (formats without a commander, for lessons and story chapters: just the deck)
  if (!spec.commander) return ['Deck', ...[...counts].map(([n, k]) => `${k} ${n}`), ...filler].join('\n');
  return ['Commander', `1 ${spec.commander}`, '', 'Deck', ...[...counts].map(([n, k]) => `${k} ${n}`), ...filler].join('\n');
}

// A puzzle may name a format (default Commander); without a commander format, players need no commander
export function validPuzzle(pz) {
  const cmd = !pz?.format || pz.format === 'commander' || ['brawl', 'paupercommander', 'oathbreaker'].includes(pz.format);
  return pz && Array.isArray(pz.players) && pz.players.length >= 2 && pz.players.length <= 4 && pz.players.every(p => !cmd || (typeof p.commander === 'string' && p.commander));
}

// The current board as a puzzle (for "Save board as puzzle")
export function boardToPuzzle(g, name) {
  const n = o => o.card.name;
  return {
    app: 'commander-table-puzzle', name, goal: 'win this turn',
    players: g.players.map((p, i) => ({
      name: p.name,
      commander: (p.command[0] || p.battlefield.find(o => o.isCommander))?.card.name || p.commanders?.[0]?.name || '',
      commanderOnBattlefield: p.battlefield.some(o => o.isCommander),
      life: p.life,
      battlefield: p.battlefield.filter(o => !o.isCommander && !o.token).map(o => (o.tapped || o.counters ? { name: n(o), tapped: o.tapped, counters: o.counters } : n(o))),
      hand: p.hand.map(n), graveyard: p.graveyard.map(n), exile: p.exile.filter(o => !o.token).map(n),
      library: p.library.map(n).reverse(),
      commanderDamage: Object.fromEntries(Object.entries(p.cmdDamage).map(([iid, v]) => [g.objects.get(+iid)?.owner, v]).filter(([k]) => k != null)),
    })),
  };
}
