// Kingdoms (Advanced Kingdoms v1.56, a fan-made Commander variant for 5–9 players): secret roles with
// their own Victory and Defeat conditions and abilities, played on the manual tabletop. Nothing here
// is automated beyond dealing the roles: players announce, resolve abilities and declare victory
// themselves, using the role text below (written in our own words from the role cards).
// Role pictures (public/roles/<id>.png, tips on <id>-tips.png) come from the player's own copy of the
// role card PDF and aren't part of the shareable game folder.

export const ROLE_TYPES = { king: 'King', knight: 'Knight', assassin: 'Assassin', bandit: 'Bandit', renegade: 'Renegade' };
const KING_WINS = 'The King wins.';
const KING_DIES = 'The King is eliminated.';
const NON_BANDITS = 'All non-Bandits are eliminated.';
const BANDIT_DEFEAT = 'You or a teammate are eliminated.';

export const ROLES = [
  { id: 'king', type: 'king', name: 'The King', victory: 'All Assassins, Bandits and Renegades are eliminated.', defeat: '',
    text: 'Always face up. Whenever you eliminate a player who has a Knight role card, discard your hand, sacrifice half your permanents (rounded up) and lose half your life (rounded up). If you would win the game this turn, you lose instead.' },
  // Knights
  { id: 'queen', type: 'knight', name: 'The Queen', victory: KING_WINS, defeat: KING_DIES,
    text: 'If damage another player deals would eliminate the King, you may Announce instead. If you do, the next time a player of your choice would deal damage to the King this turn, prevent it; the King gains that much life.' },
  { id: 'heir', type: 'knight', name: 'The Rightful Heir', victory: KING_WINS, defeat: 'The King is eliminated while the Rightful Heir is face down.',
    text: 'When you eliminate a player, Announce. When the King is eliminated, if the Rightful Heir is face up, you gain the King role card (and discard this one); if you do, gain 10 life.' },
  { id: 'shining', type: 'knight', name: 'The Knight in Shining Armor', victory: KING_WINS, defeat: KING_DIES,
    text: 'Announce (only during combat, after blockers are declared): this turn, whenever the King would be dealt damage by an opponent, that much damage is dealt to that opponent instead, and that opponent skips their next combat step.' },
  { id: 'marshal', type: 'knight', name: 'The Field Marshal', victory: KING_WINS, defeat: KING_DIES,
    text: "Announce (only in the declare blockers step of an opponent's turn): remove all attacking creatures from combat and untap them. After this phase there's an extra combat phase: all creatures gain double strike and attack that combat if able, but can't attack you or the King." },
  { id: 'kingslayer', type: 'knight', name: 'The Kingslayer', victory: KING_WINS, defeat: 'The King is eliminated by another player.',
    text: 'When you eliminate the King, Announce. The King chooses another player (not you), who gains the King role card. Your Defeat condition becomes: the King is eliminated.' },
  // Assassins
  { id: 'marksman', type: 'assassin', name: 'The Marksman', victory: KING_DIES, defeat: '',
    text: 'Announce: creatures lose hexproof and shroud until end of turn. Deal damage to up to three targets equal to the highest mana value among permanents you control.' },
  { id: 'priestess', type: 'assassin', name: 'The Priestess', victory: KING_DIES, defeat: '',
    text: 'Announce (only during your turn): exchange life totals, commander damage received and poison counters with target player.' },
  { id: 'beartrainer', type: 'assassin', name: 'The Bear Trainer', victory: KING_DIES, defeat: '',
    text: 'Announce (only if an opponent has 30 or less life): create three 2/2 green Bear tokens named War Bear with haste and "{Q}: this deals damage equal to its power to target creature; if that creature dies this turn, put a +1/+1 counter on this creature."' },
  { id: 'schemer', type: 'assassin', name: 'The Schemer', victory: KING_DIES, defeat: '',
    text: "Announce (only during your turn), choosing one: during the King's next turn you control that player during all combat phases; or during the King's next turn you control that player during all main phases. (You may look at and cast from their hand then.)" },
  { id: 'thief', type: 'assassin', name: 'The Thief', victory: KING_DIES, defeat: '',
    text: 'Announce: untap target permanent and gain control of it until end of turn. It gains haste until end of turn.' },
  // Bandits
  { id: 'giant', type: 'bandit', name: 'The Giant', victory: NON_BANDITS, defeat: BANDIT_DEFEAT,
    text: 'Announce (only during your turn): choose the creature with the highest combined power and toughness; destroy all other creatures.' },
  { id: 'necromancer', type: 'bandit', name: 'The Necromancer', victory: NON_BANDITS, defeat: BANDIT_DEFEAT,
    text: "Announce: exile all creature cards from target player's graveyard. An opponent with a face-up role card splits them into two piles; put the pile of your choice onto the battlefield under your control and exile the other." },
  { id: 'stalker', type: 'bandit', name: 'The Stalker', victory: NON_BANDITS, defeat: BANDIT_DEFEAT,
    text: 'Announce: exile target permanent.' },
  { id: 'wizard', type: 'bandit', name: 'The Wizard', victory: NON_BANDITS, defeat: BANDIT_DEFEAT,
    text: 'Announce, choosing one: exile target spell; or change the target of target spell or ability (role abilities can\'t be targeted).' },
  { id: 'zealot', type: 'bandit', name: 'The Zealot', victory: NON_BANDITS, defeat: BANDIT_DEFEAT,
    text: "Announce: each player with a face-up role card reveals cards from the top of their library until they reveal a creature card. You may put each creature revealed this way onto the battlefield under your control; shuffle the rest into their owners' libraries. Those creatures gain vigilance, haste and double strike until end of turn." },
  // Renegades
  { id: 'mimic', type: 'renegade', name: 'The Mimic', victory: 'All other players are eliminated.', defeat: '',
    text: 'When you have 20 or less life, Announce; if you do, draw a card. At the beginning of your upkeep, target player loses 1 life and another target player gains 1 life. Whenever you and an opponent have the same life total, that opponent is eliminated.' },
  { id: 'sellsword', type: 'renegade', name: 'The Sellsword', victory: 'Your teammate wins.', defeat: 'You or your teammate are eliminated.',
    text: 'When a player Announces, you may Announce. If you do, starting with that player and going in turn order, each player may bid any amount of life over the high bid, until a bid stands. The high bidder loses that much life and sacrifices a quarter of the lands they control (rounded up), and becomes your teammate.' },
  { id: 'cultist', type: 'renegade', name: 'The Cultist', victory: 'More than half of the players in the game are Cultists.', defeat: '',
    text: "Whenever you would eliminate an opponent, Announce instead. That player's role card becomes a copy of the Cultist (keeping the King type if they were the King), all their commander damage and poison counters are removed, and their life total becomes 10." },
  { id: 'strawman', type: 'renegade', name: 'The Straw Man', victory: 'You are the first player eliminated, and another player eliminated you.', defeat: '',
    text: 'Announce (only on your turn): until your next turn, all opponents\' creatures attack you if able. At the beginning of your next upkeep your Victory condition becomes: you eliminate yourself (by life loss, drawing from an empty library, commander damage or poison counters).' },
  { id: 'champion', type: 'renegade', name: 'The Champion', victory: 'The Challenger is eliminated.', defeat: '',
    text: 'When a player has 25 or less life, Announce, and choose at random a non-King opponent with the highest life total: they become the Challenger. At the beginning of your upkeep, scry 1.' },
];
export const roleById = id => ROLES.find(r => r.id === id) || null;

// How many of each role type, by table size (5 to 9 players)
export const ROLE_TABLE = {
  5: { king: 1, knight: 1, assassin: 2, renegade: 1 },
  6: { king: 1, knight: 1, bandit: 2, assassin: 2 },
  7: { king: 1, knight: 1, bandit: 2, assassin: 2, renegade: 1 },
  8: { king: 1, knight: 1, bandit: 2, assassin: 3, renegade: 1 },
  9: { king: 1, knight: 2, bandit: 3, assassin: 3 },
};
export const tableText = n => Object.entries(ROLE_TABLE[n] || {}).map(([t, k]) => `${k} ${ROLE_TYPES[t]}${k > 1 ? 's' : ''}`).join(', ');

// Deal roles for n players: random characters of each type, shuffled, one face down each
export function dealRoles(n, rand = Math.random) {
  const need = ROLE_TABLE[n];
  if (!need) return null;
  const pick = [];
  for (const [type, k] of Object.entries(need)) {
    const pool = ROLES.filter(r => r.type === type).sort(() => rand() - 0.5);
    pick.push(...pool.slice(0, k).map(r => r.id));
  }
  for (let i = pick.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [pick[i], pick[j]] = [pick[j], pick[i]]; }
  return pick.map(id => ({ id, up: id === 'king' }));
}

// The role card picture and its tips, when the player's own copy has been added to public/roles
export const roleArt = id => `roles/${id}.png`;
export const roleTips = id => `roles/${id}-tips.png`;

export const KINGDOMS_RULES = [
  'Roles are secret (face down) unless they say otherwise; you may never show a face-down role. When a player is eliminated, their role is revealed.',
  'Face-up roles of the same type are teammates, not opponents. A face-up Knight and the King are teammates too.',
  'Players win or lose only by their role\'s Victory and Defeat conditions: card abilities that say "win the game" or "can\'t win" do nothing. The first to meet their Victory condition wins (if several do at once, they share the win). "[Role type] are eliminated" counts however they left the game. Without a Defeat condition, you lose when you are eliminated. A role can win while eliminated (the King wins, so an eliminated Knight wins too).',
  'Announce: turn your face-down role face up to use its ability. Role abilities use the stack and can be responded to, but can\'t be targeted, countered or exiled.',
  'If you control another player\'s turn you can\'t look at their face-down role; they can\'t Announce during that turn.',
  'If a player loses by drawing from an empty library, whoever made them draw (or else whoever removed the last card) eliminated them. If a role keeps them alive (the Cultist), they may shuffle their graveyard, exile or hand into their library.',
  'You eliminate a player when an effect you control made them lose (life, empty library, commander damage or poison).',
  'Setup: the King reveals their role, takes the first turn and starts with 10 extra life. With Bandits in the game, the Bandits secretly learn who each other are.',
];
