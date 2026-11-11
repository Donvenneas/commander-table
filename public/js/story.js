// Story mode: "The Lantern Road", an original short story in eight chapters. Each chapter is a line of
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
  // Part two (item 164): beyond the pass, the lantern's light is wanted elsewhere
  {
    id: 'glass', name: 'V. The Glass Desert',
    story: [
      'With the Regent gone, the lantern burns brighter, and on the far side of the pass a whole desert answers it: glass dunes that catch the light and throw it back as a hundred suns.',
      'The Glass Saint has ruled here since the sand melted. Her knights march in perfect lines and her angels never tire. She would like your lantern for her collection.',
    ],
    goal: 'shatter the Glass Saint\'s court',
    players: [
      { name: 'You', life: 26, battlefield: ['Forest', 'Mountain', 'Forest', 'Mountain'], library: yourDeck(['Fireball', 'Shivan Dragon', 'Craw Wurm']) },
      { name: 'The Glass Saint', life: 16, battlefield: ['Plains', 'Plains', 'Savannah Lions'], library: [...many(15, 'Plains'), ...many(3, 'Savannah Lions'), ...many(3, 'White Knight'), ...many(2, 'Serra Angel'), ...many(3, 'Pacifism'), ...many(1, 'Glorious Anthem'), ...many(2, 'Swords to Plowshares'), ...many(2, 'Benalish Knight')] },
    ],
  },
  {
    id: 'wolf', name: 'VI. Under the Wolf Moon',
    story: [
      'Beyond the desert the forest is older than any map. On the night of the wolf moon its hunters run, and they do not care whose light it is.',
      'The Pack Mother does not speak. She simply grows larger every time you look away. Your own green friends know these woods, and they are not afraid.',
    ],
    goal: 'outlast the Pack Mother',
    players: [
      { name: 'You', life: 22, battlefield: ['Forest', 'Mountain', 'Forest', 'Llanowar Elves'], library: yourDeck(['Fireball', 'Shivan Dragon', 'Flametongue Kavu', 'Craw Wurm']) },
      { name: 'The Pack Mother', life: 22, battlefield: ['Forest', 'Forest', 'Forest', 'Forest', 'Grizzly Bears', 'Centaur Courser'], library: [...many(15, 'Forest'), ...many(3, 'Grizzly Bears'), ...many(3, 'Centaur Courser'), ...many(2, 'Giant Spider'), ...many(2, 'Craw Wurm'), ...many(3, 'Giant Growth'), ...many(2, 'Llanowar Elves'), ...many(1, 'Overrun')] },
    ],
  },
  {
    id: 'tide', name: 'VII. The Clockwork Tide',
    story: [
      'The forest ends at Hollow Bay, where the sea comes in on gears. A tinker lives on the lighthouse rock and has wound the tide to his own schedule.',
      'He wants the lantern for his lighthouse, and he is clever: his spells answer yours before they land, and his night creatures drink from the bay.',
    ],
    goal: 'unwind the Tinker of Hollow Bay',
    players: [
      { name: 'You', life: 24, battlefield: ['Forest', 'Mountain', 'Forest', 'Mountain', 'Centaur Courser'], library: yourDeck(['Fireball', 'Shivan Dragon', 'Flametongue Kavu', 'Craw Wurm']) },
      { name: 'The Tinker of Hollow Bay', life: 22, battlefield: ['Island', 'Island', 'Swamp', 'Swamp', 'Island', 'Sengir Vampire'], library: [...many(8, 'Island'), ...many(7, 'Swamp'), ...many(2, 'Merfolk Looter'), ...many(2, 'Doom Blade'), ...many(2, 'Counterspell'), ...many(2, 'Sengir Vampire'), ...many(3, 'Phantom Warrior'), ...many(2, 'Mind Rot'), ...many(2, 'Wind Drake')] },
    ],
  },
  {
    id: 'ash', name: 'VIII. The Last Lantern',
    story: [
      'At the end of the world\'s last road stands the Ash King\'s furnace, where every lantern but yours was melted down. The Regent was only his steward.',
      'Everyone you met on the road has come: villagers, the marsh folk, the centaurs, even a knight of glass who changed sides. The light has to reach the furnace.',
    ],
    goal: 'put out the Ash King\'s furnace',
    players: [
      { name: 'You', life: 30, battlefield: ['Forest', 'Mountain', 'Forest', 'Mountain', 'Llanowar Elves', 'Centaur Courser'], library: yourDeck(['Fireball', 'Shivan Dragon', 'Flametongue Kavu', 'Craw Wurm', 'Shivan Dragon']) },
      { name: 'The Ash King', life: 20, battlefield: ['Mountain', 'Swamp', 'Mountain', 'Swamp', 'Hill Giant'], library: [...many(8, 'Mountain'), ...many(8, 'Swamp'), ...many(3, 'Lightning Bolt'), ...many(2, 'Terminate'), ...many(2, 'Vampire Nighthawk'), ...many(1, 'Shivan Dragon'), ...many(1, 'Fireball'), ...many(2, 'Hill Giant'), ...many(2, 'Gravedigger'), ...many(1, 'Sengir Vampire')] },
    ],
  },
];

const KEY = 'ct.story';
export const storyDone = () => store(KEY) || {};
export function markChapter(id) { const d = storyDone(); d[id] = Date.now(); store(KEY, d); }
// Open when the chapter before it is won
export const chapterOpen = (i, done = storyDone()) => i === 0 || !!done[CHAPTERS[i - 1].id];
export const chapterPuzzle = c => ({ name: c.name, goal: c.goal, format: 'limited', fullGame: true, players: c.players });
