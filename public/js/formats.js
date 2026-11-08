// Formats: the rules that differ between them. The engine, deck import, random decks and the setup
// screen all read this table, so a new format is one entry here (plus any rules of its own).
//   life       starting life total
//   seats      players at the table (2 for duel formats)
//   deck       deck size (exact for Commander, minimum otherwise)
//   copies     most copies of a card that isn't a basic land
//   commander  decks have a commander in the command zone
//   cmdDamage  combat damage from one commander that loses the game (0: no commander damage)
//   freeMull   the first mulligan is free (Commander's rule 103.5c)
//   legal      Scryfall's legality key, for the legality check
//   sideboard  sideboard size (0: none)
//   bo3        best of three is offered
//   rarity     only these rarities (Pauper)
export const FORMATS = {
  commander: { name: 'Commander', life: 40, seats: 4, deck: 100, exact: true, copies: 1, commander: true, cmdDamage: 21, freeMull: true, legal: 'commander', sideboard: 0, bo3: false, about: '100-card singleton, a commander, 40 life, four players' },
  standard: { name: 'Standard', life: 20, seats: 2, deck: 60, copies: 4, commander: false, cmdDamage: 0, freeMull: false, legal: 'standard', sideboard: 15, bo3: true, about: 'Cards from the newest sets, 60 cards, 20 life, one on one' },
  pioneer: { name: 'Pioneer', life: 20, seats: 2, deck: 60, copies: 4, commander: false, cmdDamage: 0, freeMull: false, legal: 'pioneer', sideboard: 15, bo3: true, about: 'Return to Ravnica (2012) onward, 60 cards, 20 life' },
  modern: { name: 'Modern', life: 20, seats: 2, deck: 60, copies: 4, commander: false, cmdDamage: 0, freeMull: false, legal: 'modern', sideboard: 15, bo3: true, about: 'Eighth Edition (2003) onward, 60 cards, 20 life' },
  legacy: { name: 'Legacy', life: 20, seats: 2, deck: 60, copies: 4, commander: false, cmdDamage: 0, freeMull: false, legal: 'legacy', sideboard: 15, bo3: true, about: 'Every set, with a ban list, 60 cards, 20 life' },
  pauper: { name: 'Pauper', life: 20, seats: 2, deck: 60, copies: 4, commander: false, cmdDamage: 0, freeMull: false, legal: 'pauper', sideboard: 15, bo3: true, rarity: ['common'], about: 'Commons only, 60 cards, 20 life' },
  premodern: { name: 'Premodern', life: 20, seats: 2, deck: 60, copies: 4, commander: false, cmdDamage: 0, freeMull: false, legal: 'premodern', sideboard: 15, bo3: true, about: 'Fourth Edition to Scourge (1995–2003), 60 cards, 20 life' },
  // Commander variants (multiplayer). cmdRule: what may be the commander (see commanderOk)
  brawl: { name: 'Brawl', life: 25, seats: 4, deck: 60, exact: true, copies: 1, commander: true, cmdDamage: 0, freeMull: true, legal: 'brawl', sideboard: 0, bo3: false, cmdRule: 'brawl', lands: 24, about: '60-card singleton with Standard cards, a legendary creature or planeswalker as commander, 25 life, no commander damage' },
  paupercommander: { name: 'Pauper Commander', life: 30, seats: 4, deck: 100, exact: true, copies: 1, commander: true, cmdDamage: 16, freeMull: true, legal: 'paupercommander', sideboard: 0, bo3: false, cmdRule: 'uncommon', rarity: ['common'], lands: 37, about: 'Commons only, an uncommon creature as commander, 30 life, 16 commander damage' },
  oathbreaker: { name: 'Oathbreaker', life: 20, seats: 4, deck: 60, exact: true, copies: 1, commander: true, cmdDamage: 0, freeMull: true, legal: 'oathbreaker', sideboard: 0, bo3: false, cmdRule: 'oathbreaker', signature: true, lands: 20, about: 'A planeswalker (the oathbreaker) and an instant or sorcery (its signature spell) in the command zone, 60 cards, 20 life' },
  // Manual tables (manual.js): no rules engine, no AI. Players do everything by hand. seats is the default
  // table size; the setup screen picks 2–9 (Kingdoms 5–9). anyDeck: Commander lists and 60-card lists both load.
  manual: { name: 'Manual tabletop (2–9 players)', life: 40, seats: 4, minSeats: 2, maxSeats: 9, deck: 0, copies: 99, commander: true, anyDeck: true, cmdDamage: 21, freeMull: true, legal: null, sideboard: 0, bo3: false, manual: true, about: 'Fully manual: nothing is automated, every move is yours. Any decks, house rules, cards the engine can\'t read' },
  kingdoms: { name: 'Kingdoms (5–9 players, secret roles)', life: 40, seats: 6, minSeats: 5, maxSeats: 9, deck: 100, exact: true, copies: 1, commander: true, cmdDamage: 21, freeMull: true, legal: 'commander', sideboard: 0, bo3: false, manual: true, roles: true, about: 'Advanced Kingdoms on the manual tabletop: Commander with secret roles (King, Knights, Assassins, Bandits, Renegades)' },
  // Limited: decks from a draft or sealed pool, one on one; the rest of the pool is the sideboard
  limited: { name: 'Limited (draft or sealed)', life: 20, seats: 2, deck: 40, copies: 99, commander: false, cmdDamage: 0, freeMull: false, legal: null, sideboard: 999, bo3: true, about: '40-card decks from a draft or sealed pool, 20 life, one on one; the rest of the pool is the sideboard' },
};

export const formatOf = key => FORMATS[key] || FORMATS.commander;

// May this card be the format's commander? (Oathbreaker: the planeswalker; the signature spell is checked apart)
export function commanderOk(c, key) {
  const f = formatOf(key);
  const t = c.typeLine || '';
  if (f.cmdRule === 'uncommon') return /\bcreature\b/i.test(t) && (c.rarity === 'uncommon' || /legendary/i.test(t) && c.rarity === 'common');
  if (f.cmdRule === 'brawl') return /legendary/i.test(t) && /\b(creature|planeswalker)\b/i.test(t) || !!c.canBeCommander;
  if (f.cmdRule === 'oathbreaker') return /\bplaneswalker\b/i.test(t);
  return /legendary/i.test(t) && /\bcreature\b/i.test(t) || !!c.canBeCommander;
}

// Cards any deck may run any number of (basic lands, and cards that say so)
const ANY_NUMBER = /a deck can have any number of cards named/i;
const isBasic = c => /\bbasic\b/i.test(c.typeLine) && /\bland\b/i.test(c.typeLine);

// Deck checks for a format: size, copies, commander, sideboard and legality. Warnings only: an
// illegal deck still plays (the game is for testing as much as for tournaments).
// A companion's deck-building condition (702.139a), for the companions printed so far. A deck that breaks it
// gets a warning (the game still lets the companion be used, as with every other deck check here).
export function companionCheck(deck, f) {
  const c = deck.companion;
  const out = [];
  const starting = [...deck.commanders, ...deck.cards.map(x => x.card)];
  const nonland = starting.filter(x => !/\bland\b/i.test(x.typeLine.split('—')[0]));
  const permanent = starting.filter(x => !/\b(instant|sorcery)\b/i.test(x.typeLine));
  const bad = list => [...new Set(list.map(x => x.name))];
  const name = c.name.split(',')[0];
  const rule = {
    'Lurrus of the Dream-Den': () => bad(permanent.filter(x => (x.cmc || 0) > 2)),
    'Obosh, the Preypiercer': () => bad(nonland.filter(x => (x.cmc || 0) % 2 === 0)),
    'Gyruda, Doom of Depths': () => bad(starting.filter(x => (x.cmc || 0) % 2 === 1)),
    'Keruga, the Macrosage': () => bad(nonland.filter(x => (x.cmc || 0) < 3)),
    'Kaheera, the Orphanguard': () => bad(starting.filter(x => /\bcreature\b/i.test(x.typeLine) && !/\b(cat|elemental|nightmare|dinosaur|beast)\b/i.test(x.typeLine))),
    'Jegantha, the Wellspring': () => bad(starting.filter(x => { const syms = (x.manaCost || '').match(/\{[^}]+\}/g) || []; return syms.some((s, i) => !/^\{\d+\}$/.test(s) && syms.indexOf(s) !== i); })),
    'Umori, the Collector': () => { const types = ['artifact', 'creature', 'enchantment', 'instant', 'sorcery', 'planeswalker', 'battle']; return types.some(t => nonland.every(x => new RegExp(`\\b${t}\\b`, 'i').test(x.typeLine))) ? [] : ['nonland cards of different types']; },
    'Lutri, the Spellchaser': () => bad(deck.cards.filter(x => x.qty > 1 && !/\bland\b/i.test(x.card.typeLine)).map(x => x.card)),
    'Yorion, Sky Nomad': () => (starting.length + deck.cards.reduce((a, x) => a + x.qty - 1, 0) < f.deck + 20 ? [`fewer than ${f.deck + 20} cards`] : []),
  }[c.name];
  if (rule) { const b = rule(); if (b.length) out.push(`Companion ${name}'s condition isn't met: ${b.slice(0, 4).join(', ')}${b.length > 4 ? `, and ${b.length - 4} more` : ''}.`); }
  // (in Commander, the companion must fit the commanders' color identity too)
  if (f.commander && deck.commanders.length) {
    const ci = new Set(deck.commanders.flatMap(x => x.colorIdentity || []));
    if ((c.colorIdentity || []).some(x => !ci.has(x))) out.push(`Companion ${name} is outside the commander's colors.`);
  }
  return out;
}
export function checkDeck(deck, key) {
  const f = formatOf(key);
  const out = [];
  // (a manual table takes any deck as it is)
  if (f.anyDeck) return out;
  const main = deck.commanders.length + deck.cards.reduce((a, c) => a + c.qty, 0);
  if (f.exact ? main !== f.deck : main < f.deck) out.push(`Deck has ${main} cards (${f.name} decks have ${f.exact ? 'exactly' : 'at least'} ${f.deck}).`);
  if (f.commander && !deck.commanders.length) out.push(`${f.name} decks need a commander.`);
  if (f.signature) {
    if (!deck.commanders.some(c => /\bplaneswalker\b/i.test(c.typeLine))) out.push('Oathbreaker decks need a planeswalker as the oathbreaker.');
    if (!deck.commanders.some(c => /\b(instant|sorcery)\b/i.test(c.typeLine))) out.push('No signature spell: put an instant or sorcery under the "Commander" heading with the oathbreaker.');
  } else if (f.commander && f.cmdRule) for (const c of deck.commanders) if (!commanderOk(c, key)) out.push(`${c.name} can't be a ${f.name} commander.`);
  if (deck.companion) out.push(...companionCheck(deck, f));
  const side = (deck.sideboard || []).reduce((a, c) => a + c.qty, 0);
  if (side > f.sideboard) out.push(f.sideboard ? `Sideboard has ${side} cards (at most ${f.sideboard}).` : `${f.name} has no sideboard; its ${side} cards are left out.`);
  // Copies across the main deck and sideboard
  const counts = new Map();
  for (const { card, qty } of [...deck.cards, ...(deck.sideboard || [])]) {
    if (isBasic(card) || ANY_NUMBER.test(card.text || '')) continue;
    counts.set(card.name, (counts.get(card.name) || 0) + qty);
  }
  const tooMany = [...counts].filter(([, n]) => n > f.copies).map(([name, n]) => `${name} ×${n}`);
  if (tooMany.length) out.push(`More than ${f.copies === 1 ? 'one copy' : `${f.copies} copies`}: ${tooMany.slice(0, 4).join(', ')}${tooMany.length > 4 ? `, and ${tooMany.length - 4} more` : ''}.`);
  // Legality from Scryfall (cards saved before this version only know their Commander legality)
  // (Scryfall lists uncommon creatures as not legal in Pauper Commander, though one may be the
  // commander: commanders there are checked by commanderOk above instead)
  const all = [...(f.cmdRule === 'uncommon' ? [] : deck.commanders), ...deck.cards.map(c => c.card), ...(deck.sideboard || []).map(c => c.card)];
  if (!f.legal) return out;
  const illegal = all.filter(c => {
    const l = c.legalities ? c.legalities[f.legal] : f.legal === 'commander' ? c.legal : undefined;
    return l && l !== 'legal' && l !== 'restricted';
  }).map(c => c.name);
  const uniq = [...new Set(illegal)];
  if (uniq.length) out.push(`Not legal in ${f.name}: ${uniq.slice(0, 5).join(', ')}${uniq.length > 5 ? `, and ${uniq.length - 5} more` : ''}.`);
  return out;
}
