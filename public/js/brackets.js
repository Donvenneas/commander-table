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
  3: { name: 'Upgraded', blurb: 'Up to three Game Changers. No early two-card combos, no mass land destruction; extra turns not chained.' },
  4: { name: 'Optimized', blurb: 'High power. Anything legal goes.' },
  5: { name: 'cEDH', blurb: 'Competitive: tournament decks built for the meta.' },
};

const MLD = /destroy all lands|each player sacrifices (?:all|five|four|three|x) lands|destroy all nonbasic lands|lands don't untap during their controllers' untap steps/i;

// Which bracket a deck plays at, and why. Bracket 1 is about intent (a theme), which can't be read
// from a list, so the lowest estimate is 2.
// The rules followed (item 152): Game Changers (Scryfall's copy of the official list) — none in brackets 1–2, up to
// three in 3; two-card combos — none in 1–2, only late-game ones in 3 (we call a combo "early" when its two pieces
// cost 6 mana or less together, so it can come together before turn six); extra turns — not chained in 1–3 (two or
// more extra-turn cards count as able to chain); mass land destruction — 4 and up. Tutors no longer limit a bracket,
// but they are counted and shown, since they make a deck more consistent.
const TUTOR = /search your library for (?:a|an|up to (?:one|two)) (?![^.]*\b(?:basic|lands?|plains|island|swamp|mountain|forest)\b)[^.]*card/i;
export function estimateBracket(deck) {
  const all = [...deck.commanders, ...deck.cards.map(c => c.card)];
  const changers = [...new Set(all.filter(c => c.gameChanger).map(c => c.name))];
  const twoCard = combosIn(all).filter(c => c.pieces.length === 2);
  const cost = name => all.find(c => c.name.toLowerCase() === String(name).toLowerCase())?.cmc ?? 0;
  const early = twoCard.filter(c => c.pieces.reduce((a, p) => a + cost(p), 0) <= 6);
  const mld = all.filter(c => MLD.test(c.text || '')).map(c => c.name);
  const extraTurns = all.filter(c => [...c.fx.spell, ...c.fx.etb].some(e => e.k === 'extraTurn')).map(c => c.name);
  const tutors = [...new Set(all.filter(c => !c.fx?.type.land && TUTOR.test(c.text || '')).map(c => c.name))];
  const reasons = [];
  if (changers.length) reasons.push(`${changers.length} Game Changer${changers.length === 1 ? '' : 's'}: ${changers.slice(0, 6).join(', ')}${changers.length > 6 ? '…' : ''}`);
  if (early.length) reasons.push(`early two-card combo${early.length === 1 ? '' : 's'}: ${early.slice(0, 3).map(c => c.label).join('; ')}`);
  if (twoCard.length > early.length) reasons.push(`late-game two-card combo${twoCard.length - early.length === 1 ? '' : 's'}: ${twoCard.filter(c => !early.includes(c)).slice(0, 3).map(c => c.label).join('; ')}`);
  if (mld.length) reasons.push(`mass land destruction: ${mld.join(', ')}`);
  if (extraTurns.length) reasons.push(`extra turns${extraTurns.length >= 2 ? ' (can chain)' : ''}: ${extraTurns.join(', ')}`);
  if (tutors.length) reasons.push(`${tutors.length} tutor${tutors.length === 1 ? '' : 's'} (no limit, but more consistent): ${tutors.slice(0, 5).join(', ')}${tutors.length > 5 ? '…' : ''}`);
  let bracket = 2;
  if (deck.source === 'edhtop16' || guessStyle(deck) === 'cedh') bracket = 5;
  else if (changers.length > 3 || early.length || mld.length || extraTurns.length >= 3) bracket = 4;
  else if (changers.length || twoCard.length || extraTurns.length >= 2) bracket = 3;
  if (deck.source === 'edhtop16') reasons.unshift('a tournament list from EDHTop16');
  return { bracket, changers, reasons, twoCard: twoCard.length, early: early.length, tutors, extraTurns, mld };
}

// Why our estimate and Commander Spellbook's differ (sb: fetchSpellbookBracket's answer): sentences, empty if they agree
export function bracketDifferences(est, sb) {
  if (!sb || !sb.about || sb.about === est.bracket) return [];
  const out = [`Ours says bracket ${est.bracket} (${BRACKETS[est.bracket].name}); Spellbook says "${sb.name}", about bracket ${sb.about}.`];
  if (sb.gameChangers !== est.changers.length) out.push(`Game Changers: we count ${est.changers.length}, Spellbook ${sb.gameChangers} (the lists can differ for a few days after the official list changes, and Spellbook may read a card's other face).`);
  if (sb.twoCard !== est.twoCard) out.push(`Two-card combos: we know ${est.twoCard}, Spellbook finds ${sb.twoCard}. Spellbook's database is bigger; ours only has combos the simulator can play.`);
  if (est.twoCard && est.early === 0 && sb.about > est.bracket) out.push('Our combos are all late-game (6+ mana together), which bracket 3 allows; Spellbook does not separate early and late combos.');
  if (est.extraTurns.length >= 2 && sb.about < est.bracket) out.push(`We count ${est.extraTurns.length} extra-turn cards as able to chain; Spellbook looks at combos and Game Changers only.`);
  if (est.mld.length && sb.about < est.bracket) out.push('Mass land destruction puts a deck in bracket 4 by the official rules; Spellbook may not flag these cards.');
  if (sb.about === 3 && est.bracket === 2) out.push('Spellbook\'s "Powerful" and "Spicy" tags sit around bracket 3 but are not the official brackets.');
  if (sb.about === 1 && est.bracket === 2) out.push('Bracket 1 is about a deck\'s intent (a theme, playing for fun), which a list can\'t show, so our lowest estimate is 2. If the deck is built that way, set the seat to bracket 1.');
  if (est.bracket === 5) out.push('Bracket 5 (cEDH) is about intent and the tournament meta; Spellbook does not tag it.');
  return out;
}

// How sharply AI pilots play at each bracket: low brackets make looser, more casual choices
export const BRACKET_NOISE = { 1: 0.45, 2: 0.2, 3: 0.05, 4: 0, 5: 0 };
