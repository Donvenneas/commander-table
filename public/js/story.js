// Story mode: "The Lantern Road", an original short story in four chapters. Each chapter is a line of
// story, then a whole game from a special starting board (puzzle engine, fullGame), one on one at the
// Limited format's rules. Winning opens the next chapter.
import { store } from './util.js';

const many = (n, name) => Array(n).fill(name);
// Your deck grows a little each chapter (the lamplighter gathers allies on the road)
const yourDeck = extra => [
  ...many(8, 'Forest'), ...many(8, 'Mountain'),
  ...many(2, 'Grizzly Bears'), ...many(2, 'Hill Giant'), ...many(4, 'Lightning Bolt'), ...many(2, 'Giant Growth'),
  ...many(3, 'Llanowar Elves'), ...many(3, 'Centaur Courser'), ...many(2, 'Shock'), ...many(1, 'Craw Wurm'),
  ...many(2, 'Flametongue Kavu'), ...many(2, 'Rampant Growth'),
  ...extra,
];

export const CHAPTERS = [
  {
    id: 'road', name: 'I. The Ember Road',
    story: [
      'The last lamplighter of Varn sets out at dusk with a lantern that will not go out. The road east is long, and the hill bandits know every bend of it.',
      'They wait at the old toll bridge, three of them, laughing. You have two friends from the village and a satchel of charms. It will have to be enough.',
    ],
    goal: 'defeat the bandits',
    players: [
      { name: 'You', life: 20, battlefield: ['Forest', 'Mountain', 'Grizzly Bears'], library: yourDeck([]) },
      { name: 'Hill Bandits', life: 14, battlefield: ['Swamp', 'Typhoid Rats'], library: [...many(15, 'Swamp'), ...many(4, 'Typhoid Rats'), ...many(4, 'Walking Corpse'), ...many(3, 'Duress'), ...many(1, 'Murder'), ...many(3, 'Gravedigger'), ...many(2, 'Zombie Goliath')] },
    ],
  },
  {
    id: 'bell', name: 'II. The Drowned Bell',
    story: [
      'Past the bridge the road drops into the marsh town of Lowmere, where a bell rings beneath the water every hour. The townsfolk will not look at you.',
      'The Tidewarden who keeps the bell does not want your light here. Her spells come and go like the tide: what you play, she sends back.',
    ],
    goal: 'outlast the Tidewarden',
    players: [
      { name: 'You', life: 20, battlefield: ['Forest', 'Mountain', 'Forest'], library: yourDeck(['Fireball', 'Fireball']) },
      { name: 'The Tidewarden', life: 17, battlefield: ['Island', 'Island', 'Island', 'Island'], library: [...many(14, 'Island'), ...many(4, "Man-o'-War"), ...many(4, 'Unsummon'), ...many(2, 'Counterspell'), ...many(3, 'Wind Drake'), ...many(3, 'Air Elemental'), ...many(3, 'Opt')] },
    ],
  },
  {
    id: 'ossuary', name: 'III. Night at the Ossuary',
    story: [
      'The road climbs to the Ossuary of Saint Ilse, where the dead of three wars rest. Tonight they do not rest. Something in the crypt is calling them up again.',
      'Its graveyard is already stirring. Every creature you defeat may stand back up, so a centaur from the village walks with you.',
    ],
    goal: 'silence the crypt',
    players: [
      { name: 'You', life: 24, battlefield: ['Forest', 'Mountain', 'Forest', 'Mountain', 'Centaur Courser'], library: yourDeck(['Fireball', 'Shivan Dragon', 'Flametongue Kavu']) },
      { name: 'The Crypt Caller', life: 16, battlefield: ['Swamp', 'Swamp', 'Swamp'], graveyard: ['Walking Corpse', 'Typhoid Rats'], library: [...many(15, 'Swamp'), ...many(2, 'Reanimate'), ...many(3, 'Gravedigger'), ...many(4, 'Walking Corpse'), ...many(1, 'Vampire Nighthawk'), ...many(1, 'Doom Blade'), ...many(2, 'Zombie Goliath'), ...many(2, 'Typhoid Rats')] },
    ],
  },
  {
    id: 'crown', name: 'IV. Crown of Storms',
    story: [
      'At the top of the pass waits the one who put out every other lantern: the Storm Regent, crowned in lightning, with a dragon already circling above her.',
      'The village gave you everything it had. You climb with more life than you started with, and every friend you made on the road.',
    ],
    goal: 'bring down the Storm Regent',
    players: [
      { name: 'You', life: 30, battlefield: ['Forest', 'Mountain', 'Forest', 'Mountain', 'Llanowar Elves'], library: yourDeck(['Fireball', 'Shivan Dragon', 'Craw Wurm']) },
      { name: 'The Storm Regent', life: 16, battlefield: ['Mountain', 'Island', 'Island', 'Wind Drake'], library: [...many(13, 'Mountain'), ...many(5, 'Island'), ...many(3, 'Lightning Bolt'), ...many(3, 'Counterspell'), ...many(2, 'Air Elemental'), ...many(1, 'Shivan Dragon'), ...many(2, 'Fireball'), ...many(2, 'Mahamoti Djinn')] },
    ],
  },
];

const KEY = 'ct.story';
export const storyDone = () => store(KEY) || {};
export function markChapter(id) { const d = storyDone(); d[id] = Date.now(); store(KEY, d); }
// Open when the chapter before it is won
export const chapterOpen = (i, done = storyDone()) => i === 0 || !!done[CHAPTERS[i - 1].id];
export const chapterPuzzle = c => ({ name: c.name, goal: c.goal, format: 'limited', fullGame: true, players: c.players });
