// Commander Brackets (Wizards of the Coast's power-level system for Commander decks):
//   1 Exhibition: ultra-casual, built around a theme
//   2 Core: about the power of a modern preconstructed deck
//   3 Upgraded: stronger, up to three Game Changers
//   4 Optimized: high power, no restrictions beyond the ban list
//   5 cEDH: competitive, built for the tournament meta
// Game Changers come from Scryfall's copy of the official list (card.gameChanger).
import { combosIn } from './combos.js';
import { guessStyle } from './ai.js';

export const BRACKETS = {
  1: { name: 'Exhibition', blurb: 'Ultra-casual and themed. No Game Changers, combos, extra turns or mass land destruction.' },
  2: { name: 'Core', blurb: 'Precon level. No Game Changers, two-card combos or mass land destruction; extra turns not chained.' },
  3: { name: 'Upgraded', blurb: 'Up to three Game Changers. No early two-card combos, no mass land destruction.' },
  4: { name: 'Optimized', blurb: 'High power. Anything legal goes.' },
  5: { name: 'cEDH', blurb: 'Competitive: tournament decks built for the meta.' },
};

const MLD = /destroy all lands|each player sacrifices (?:all|five|four|three|x) lands|destroy all nonbasic lands|lands don't untap during their controllers' untap steps/i;

// Which bracket a deck plays at, and why. Bracket 1 is about intent (a theme), which can't be read
// from a list, so the lowest estimate is 2.
export function estimateBracket(deck) {
  const all = [...deck.commanders, ...deck.cards.map(c => c.card)];
  const changers = [...new Set(all.filter(c => c.gameChanger).map(c => c.name))];
  const twoCard = combosIn(all).filter(c => c.pieces.length === 2);
  const mld = all.filter(c => MLD.test(c.text || '')).map(c => c.name);
  const extraTurns = all.filter(c => [...c.fx.spell, ...c.fx.etb].some(e => e.k === 'extraTurn')).map(c => c.name);
  const reasons = [];
  if (changers.length) reasons.push(`${changers.length} Game Changer${changers.length === 1 ? '' : 's'}: ${changers.slice(0, 6).join(', ')}${changers.length > 6 ? '…' : ''}`);
  if (twoCard.length) reasons.push(`two-card combo${twoCard.length === 1 ? '' : 's'}: ${twoCard.slice(0, 3).map(c => c.label).join('; ')}`);
  if (mld.length) reasons.push(`mass land destruction: ${mld.join(', ')}`);
  if (extraTurns.length) reasons.push(`extra turns: ${extraTurns.join(', ')}`);
  let bracket = 2;
  if (deck.source === 'edhtop16' || guessStyle(deck) === 'cedh') bracket = 5;
  else if (changers.length > 3 || twoCard.length || mld.length || extraTurns.length >= 3) bracket = 4;
  else if (changers.length || extraTurns.length >= 2) bracket = 3;
  if (deck.source === 'edhtop16') reasons.unshift('a tournament list from EDHTop16');
  return { bracket, changers, reasons };
}

// How sharply AI pilots play at each bracket: low brackets make looser, more casual choices
export const BRACKET_NOISE = { 1: 0.45, 2: 0.2, 3: 0.05, 4: 0, 5: 0 };
