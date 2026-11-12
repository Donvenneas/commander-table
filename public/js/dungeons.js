// Dungeons (309, 701.49 venture into the dungeon, 725 the initiative). Each room's ability is read by the same
// card-text reader as everything else (effects.js parseEffects), so a room the reader doesn't understand just logs.
// Rooms list the rooms below them; the last room has none (finishing it completes the dungeon).
import { parseEffects } from './effects.js';

export const DUNGEONS = {
  'Lost Mine of Phandelver': {
    start: 'Cave Entrance',
    rooms: {
      'Cave Entrance': { text: 'Scry 1.', next: ['Goblin Lair', 'Mine Tunnels'] },
      'Goblin Lair': { text: 'Create a 1/1 red Goblin creature token.', next: ['Storeroom', 'Dark Pool'] },
      'Mine Tunnels': { text: 'Create a Treasure token.', next: ['Dark Pool', 'Fungi Cavern'] },
      'Storeroom': { text: 'Put a +1/+1 counter on target creature.', next: ['Temple of Dumathoin'] },
      'Dark Pool': { text: 'Each opponent loses 1 life and you gain 1 life.', next: ['Temple of Dumathoin'] },
      'Fungi Cavern': { text: 'Target creature gets -4/-0 until end of turn.', next: ['Temple of Dumathoin'] },
      'Temple of Dumathoin': { text: 'Draw a card.', next: [] },
    },
  },
  'Dungeon of the Mad Mage': {
    start: 'Yawning Portal',
    rooms: {
      'Yawning Portal': { text: 'You gain 1 life.', next: ['Dungeon Level'] },
      'Dungeon Level': { text: 'Scry 1.', next: ['Goblin Bazaar', 'Twisted Caverns'] },
      'Goblin Bazaar': { text: 'Create a Treasure token.', next: ['Lost Level'] },
      'Twisted Caverns': { text: "Target creature can't attack until end of turn.", next: ['Lost Level'] },
      'Lost Level': { text: 'Scry 2.', next: ['Runestone Caverns', "Muiral's Graveyard"] },
      'Runestone Caverns': { text: 'Exile the top two cards of your library. You may play them this turn.', next: ['Deep Mines'] },
      "Muiral's Graveyard": { text: 'Create two 1/1 black Skeleton creature tokens.', next: ['Deep Mines'] },
      'Deep Mines': { text: 'Scry 3.', next: ["Mad Wizard's Lair"] },
      "Mad Wizard's Lair": { text: 'Draw three cards.', next: [] },
    },
  },
  'Tomb of Annihilation': {
    start: 'Trapped Entry',
    rooms: {
      'Trapped Entry': { text: 'Each player loses 1 life.', next: ['Veils of Fear', 'Oubliette'] },
      'Veils of Fear': { text: 'Each player loses 2 life.', next: ['Sandfall Cell'] },
      'Sandfall Cell': { text: 'Each player loses 2 life.', next: ['Cradle of the Death God'] },
      'Oubliette': { text: 'Discard a card.', next: ['Cradle of the Death God'] },
      'Cradle of the Death God': { text: 'Create a 4/4 black God Horror creature token with deathtouch.', next: [] },
    },
  },
  // Only through the initiative (725.2), and the initiative always ventures here
  'Undercity': {
    start: 'Secret Entrance',
    initiative: true,
    rooms: {
      'Secret Entrance': { text: 'Search your library for a basic land card, reveal it, put it into your hand, then shuffle.', next: ['Forge', 'Lost Well'] },
      'Forge': { text: 'Put two +1/+1 counters on target creature.', next: ['Trap!', 'Arena'] },
      'Lost Well': { text: 'Scry 2.', next: ['Arena', 'Stash'] },
      'Trap!': { text: 'Target player loses 5 life.', next: ['Archives'] },
      'Arena': { text: 'Goad target creature.', next: ['Archives', 'Catacombs'] },
      'Stash': { text: 'Create a Treasure token.', next: ['Catacombs'] },
      'Archives': { text: 'Draw a card.', next: ['Throne of the Dead Three'] },
      'Catacombs': { text: 'Create a 4/1 black Skeleton creature token with menace.', next: ['Throne of the Dead Three'] },
      'Throne of the Dead Three': { text: 'Reveal the top ten cards of your library. Put a creature card from among them onto the battlefield with three +1/+1 counters on it. Put the rest on the bottom of your library in a random order.', next: [] },
    },
  },
};

const cache = new Map();
// A room's ability as engine effects (parsed once)
export function roomEffects(dungeon, room) {
  const key = `${dungeon}/${room}`;
  if (!cache.has(key)) cache.set(key, parseEffects(DUNGEONS[dungeon].rooms[room].text.toLowerCase()));
  return cache.get(key);
}
// The dungeons a player can choose when venturing (not the Undercity, which only the initiative uses)
export const ventureChoices = () => Object.keys(DUNGEONS).filter(d => !DUNGEONS[d].initiative);
