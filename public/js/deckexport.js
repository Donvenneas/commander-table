// More deck exports (item 153): an MTGO .dek file, MTG Arena text and a printable checklist.
// (The decklist text the game itself reads is the deck editor's own text.)

const xml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const front = name => String(name).split(' // ')[0];

// MTGO's deck file. Cards are matched by name (CatID 0); MTGO puts a Commander deck's commander in the sideboard.
export function dekXml(deck) {
  const row = (name, qty, side) => `  <Cards CatID="0" Quantity="${qty}" Sideboard="${side}" Name="${xml(front(name))}" Annotation="0" />`;
  return ['<?xml version="1.0" encoding="utf-8"?>',
    '<Deck xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">',
    '  <NetDeckID>0</NetDeckID>', '  <PreconstructedDeckID>0</PreconstructedDeckID>',
    ...deck.cards.map(({ card, qty }) => row(card.name, qty, false)),
    ...(deck.commanders || []).map(c => row(c.name, 1, true)),
    ...(deck.sideboard || []).map(({ card, qty }) => row(card.name, qty, true)),
    '</Deck>'].join('\r\n');
}

// MTG Arena's import text: names only, so Arena picks its own printing of each card
export function arenaText(deck) {
  const line = (name, qty) => `${qty} ${front(name)}`;
  return [...(deck.commanders?.length ? ['Commander', ...deck.commanders.map(c => line(c.name, 1)), ''] : []),
    'Deck', ...deck.cards.map(({ card, qty }) => line(card.name, qty)),
    ...(deck.sideboard?.length ? ['', 'Sideboard', ...deck.sideboard.map(({ card, qty }) => line(card.name, qty))] : [])].join('\n');
}

// A checklist to print or tick off while pulling cards from binders: by card type, then name, with the set and number
export function checklistText(deck) {
  const TYPES = [['Commander', null], ['Creatures', 'creature'], ['Planeswalkers', 'planeswalker'], ['Instants', 'instant'], ['Sorceries', 'sorcery'], ['Artifacts', 'artifact'], ['Enchantments', 'enchantment'], ['Battles', 'battle'], ['Lands', 'land']];
  const typeOf = c => (c.fx?.type.land ? 'land' : TYPES.slice(1).find(([, t]) => t !== 'land' && c.fx?.type[t])?.[1] || 'other');
  const where = c => (c.set ? ` (${String(c.set).toUpperCase()}${c.cn ? ` ${c.cn}` : ''})` : '');
  const box = (c, qty) => `[ ] ${qty} ${c.name}${where(c)}`;
  const total = deck.cards.reduce((a, x) => a + x.qty, 0) + (deck.commanders?.length || 0);
  const out = [`${deck.deckName || 'Deck'}: ${total} cards`, ''];
  if (deck.commanders?.length) out.push('Commander', ...deck.commanders.map(c => box(c, 1)), '');
  for (const [label, t] of [...TYPES.slice(1), ['Other', 'other']]) {
    const rows = deck.cards.filter(x => typeOf(x.card) === t).sort((a, b) => a.card.name.localeCompare(b.card.name));
    if (rows.length) out.push(`${label} (${rows.reduce((a, x) => a + x.qty, 0)})`, ...rows.map(x => box(x.card, x.qty)), '');
  }
  if (deck.sideboard?.length) out.push(`Sideboard (${deck.sideboard.reduce((a, x) => a + x.qty, 0)})`, ...deck.sideboard.map(x => box(x.card, x.qty)), '');
  return out.join('\n').trim() + '\n';
}
