// Learn to play: short lessons for people new to Magic. Each is a set board (the puzzle engine) with
// one turn to reach a goal, and a coach panel beside the table that explains what to do. A lesson's
// goal is either winning or its own check, tested when the turn ends.
import { store } from './util.js';

const has = (g, name) => g.players[0].battlefield.some(o => o.card.name === name);

export const LESSONS = [
  {
    id: 'mana', name: 'Lands and mana', goal: 'get Grizzly Bears onto the battlefield', format: 'limited',
    check: g => has(g, 'Grizzly Bears'),
    coach: [
      'Spells cost <b>mana</b>, and mana comes mostly from <b>lands</b>. Grizzly Bears costs {1}{G}: two mana, one of them green.',
      'You may play <b>one land each turn</b>. Click the Forest in your hand to play it.',
      'Now click <b>Grizzly Bears</b>. The game taps your two Forests to pay for it. (You can also click a land first to tap it yourself.)',
      'Then click <b>End turn</b>. Creatures can’t attack the turn they arrive (“summoning sickness”, the ☾ on the card).',
    ],
    players: [
      { name: 'You', battlefield: ['Forest'], hand: ['Forest', 'Grizzly Bears'] },
      { name: 'Training dummy', life: 20, battlefield: ['Plains'] },
    ],
  },
  {
    id: 'attack', name: 'Attacking', goal: 'win this turn', format: 'limited',
    coach: [
      'Creatures deal damage by <b>attacking</b>. Hill Giant has power 3, and your opponent has 3 life.',
      'Click <b>Go to combat</b>, then click Hill Giant to choose it as an attacker, then <b>Attack</b> your opponent.',
      'Nothing can block it, so it deals 3 damage. A player at 0 life loses.',
    ],
    players: [
      { name: 'You', battlefield: ['Mountain', 'Mountain', 'Hill Giant'] },
      { name: 'Training dummy', life: 3, battlefield: ['Plains'] },
    ],
  },
  {
    id: 'block', name: 'Blockers', goal: 'win this turn', format: 'limited',
    coach: [
      'The defending player may <b>block</b> an attacker with an untapped creature. A blocked attacker deals its damage to the blocker instead of the player.',
      'Your opponent has 2 life and one Grizzly Bears to block with. You have two Grizzly Bears.',
      'Attack with <b>both</b>. They can only block one, so the other gets through.',
    ],
    players: [
      { name: 'You', battlefield: ['Forest', 'Forest', 'Grizzly Bears', 'Grizzly Bears'] },
      { name: 'Training dummy', life: 2, battlefield: ['Forest', 'Grizzly Bears'] },
    ],
  },
  {
    id: 'removal', name: 'Removal', goal: 'win this turn', format: 'limited',
    coach: [
      'Some spells deal with your opponent’s creatures. <b>Swords to Plowshares</b> exiles a creature for just {W}.',
      'Wall of Omens can block Hill Giant all day (it has 4 toughness). Cast Swords to Plowshares on it first: click the card, then click the Wall.',
      'Then attack with Hill Giant for the win.',
    ],
    players: [
      { name: 'You', battlefield: ['Plains', 'Mountain', 'Hill Giant'], hand: ['Swords to Plowshares'] },
      { name: 'Training dummy', life: 3, battlefield: ['Island', 'Wall of Omens'] },
    ],
  },
  {
    id: 'trick', name: 'Combat tricks', goal: 'win this turn', format: 'limited',
    coach: [
      '<b>Instants</b> can be cast at almost any time, even during combat. Giant Growth gives a creature +3/+3 until the end of the turn.',
      'Your opponent has 5 life. Grizzly Bears alone deals 2.',
      'Cast Giant Growth on your Bears (now, or after you attack, when the game asks if you want to cast a trick), then attack: 2 + 3 = 5.',
    ],
    players: [
      { name: 'You', battlefield: ['Forest', 'Grizzly Bears'], hand: ['Giant Growth'] },
      { name: 'Training dummy', life: 5, battlefield: ['Plains'] },
    ],
  },
  {
    id: 'command', name: 'Your commander', goal: 'cast your commander', format: 'commander',
    check: g => g.players[0].battlefield.some(o => o.isCommander),
    coach: [
      'In <b>Commander</b>, everyone starts at 40 life with a legendary creature, the <b>commander</b>, waiting in the <b>command zone</b> (the gold area of your board).',
      'You can cast it from there whenever you could cast a creature. Each time it goes back there, it costs {2} more.',
      'Click <b>Krenko, Tin Street Kingpin</b> in your command zone and cast it with your three Mountains. Then end your turn.',
    ],
    players: [
      { name: 'You', commander: 'Krenko, Tin Street Kingpin', battlefield: ['Mountain', 'Mountain', 'Mountain'] },
      { name: 'Training dummy', commander: 'Kenrith, the Returned King', life: 40, battlefield: ['Plains'] },
    ],
  },
  {
    id: 'exam', name: 'Final exam: burn them out', goal: 'win this turn', format: 'commander',
    coach: [
      'Everything together. Your opponent has 8 life. You have three Mountains and four burn spells.',
      'Lightning Bolt deals 3 for {R}, Lava Spike 3 for {R}, Shock 2 for {R}, Lightning Strike 3 for {1}{R}.',
      'Which three add up to 8 or more for three mana? (Hint: the cheapest ones.)',
    ],
    players: [
      { name: 'You', commander: 'Krenko, Tin Street Kingpin', battlefield: ['Mountain', 'Mountain', 'Mountain'], hand: ['Lightning Bolt', 'Lava Spike', 'Shock', 'Lightning Strike'] },
      { name: 'Training dummy', commander: 'Kenrith, the Returned King', life: 8, battlefield: ['Plains', 'Plains'] },
    ],
  },
];

const KEY = 'ct.tutorial';
export const lessonsDone = () => store(KEY) || {};
export function markLesson(id) { const d = lessonsDone(); d[id] = Date.now(); store(KEY, d); }
// A lesson as a puzzle the engine runs (the check function stays with it; lessons aren't saved as files)
export const lessonPuzzle = l => ({ name: l.name, goal: l.goal, format: l.format, check: l.check, players: l.players });
export const coachHtml = (l, i) => `<div class="coach-head"><b>Lesson ${i + 1} of ${LESSONS.length}: ${l.name}</b><button class="btn small ghost" id="btnCoachHide" title="Hide the coach">×</button></div>
  <p class="muted">Goal: ${l.goal}.</p><ol>${l.coach.map(s => `<li>${s}</li>`).join('')}</ol>`;
