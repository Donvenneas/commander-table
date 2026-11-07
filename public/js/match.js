// Best-of-three matches: the score, who goes first next game, and AI sideboarding between games.
// The AI only sideboards against what it saw: the cards the opponent played or revealed in earlier
// games of the match, never their decklist.

// What a player showed in a finished game: every card that left the library and hand (cast, played,
// discarded, milled) plus the commanders
export function revealedCards(g, idx) {
  const p = g.players[idx];
  const seen = new Map();
  const add = o => { if (o?.card && !o.token) seen.set(o.card.name, o.card); };
  for (const zone of ['battlefield', 'graveyard', 'exile', 'command']) for (const o of p[zone] || []) if (o.owner === idx) add(o);
  for (const q of g.players) for (const o of q.battlefield) if (o.owner === idx) add(o);
  // (cards it cast that went back to the hand or library still count: castNames has their names)
  return { cards: [...seen.values()], names: new Set([...seen.keys(), ...(p.castNames || [])]) };
}

const txt = c => `${c.typeLine || ''}\n${c.text || ''}`.toLowerCase();
const isLand = c => /\bland\b/i.test(c.typeLine || '');
const isCreature = c => /\bcreature\b/i.test(c.typeLine || '');

// A rough picture of an opponent from what they showed
export function profile(cards) {
  const spells = cards.filter(c => !isLand(c));
  const n = Math.max(1, spells.length);
  const share = f => spells.filter(f).length / n;
  return {
    seen: spells.length,
    creatures: share(isCreature),
    fliers: share(c => isCreature(c) && /\bflying\b/.test(txt(c))),
    artifacts: share(c => /\bartifact\b/i.test(c.typeLine || '')),
    enchantments: share(c => /\benchantment\b/i.test(c.typeLine || '')),
    graveyard: share(c => /flashback|escape|unearth|from (your|a) graveyard|delve|dredge|reanimate/.test(txt(c))),
    spellsShare: share(c => /\b(instant|sorcery)\b/i.test(c.typeLine || '')),
    cheap: share(c => (c.cmc || 0) <= 2),
    avgMv: spells.reduce((a, c) => a + (c.cmc || 0), 0) / n,
  };
}

// How much a card helps against that opponent (higher: bring it in; for main-deck cards, low: cut it)
export function matchupValue(c, pr) {
  const t = txt(c);
  let v = 0;
  const aggro = pr.creatures >= 0.55 && pr.avgMv <= 2.8;
  const control = pr.creatures <= 0.35;
  const killsCreature = /(destroy|exile) target (attacking |tapped |nonblack |nonwhite )?creature|damage to (any target|target creature)|target creature gets -\d|fights? target creature/.test(t);
  if (killsCreature) v += pr.creatures >= 0.5 ? 2 : pr.creatures <= 0.3 ? -2 : 0.5;
  if (/sweeper|destroy all creatures|damage to each creature|all creatures get -/.test(t)) v += aggro ? 2.5 : control ? -2 : 0;
  if (/(destroy|exile) target (artifact|noncreature permanent|nonland permanent|permanent)|artifacts? (and|or) enchantments?/.test(t) || /destroy target artifact/.test(t)) v += pr.artifacts >= 0.2 ? 2.5 : pr.artifacts < 0.08 ? -1.5 : 0;
  if (/(destroy|exile) target enchantment|artifact or enchantment/.test(t)) v += pr.enchantments >= 0.15 ? 2.5 : pr.enchantments < 0.06 ? -1.5 : 0;
  if (/creature with flying|\breach\b|flying creatures?/.test(t) && !/^creature.*flying/.test(t)) v += pr.fliers >= 0.25 ? 2 : -0.5;
  if (/graveyard/.test(t) && /exile (all|each|target player's|target card|cards? from)/.test(t)) v += pr.graveyard >= 0.12 ? 2.5 : -1;
  if (/counter target (spell|noncreature|instant|sorcery)/.test(t)) v += control || pr.avgMv >= 3.2 ? 1.5 : aggro ? -1 : 0.3;
  if (/target (player|opponent) (reveals|discards)|discards? (a|two) cards?/.test(t)) v += control ? 1.5 : aggro ? -1 : 0;
  if (/gain \d+ life|you gain life/.test(t) && !isCreature(c)) v += aggro ? 1 : -0.5;
  if (/hexproof|protection from|can't be countered/.test(t) && !isCreature(c)) v += control ? 0.8 : 0;
  return v;
}

// Swap cards between deck and sideboard against what the opponent showed. Returns a new
// { cards, sideboard, swaps } (one copy at a time, at most 7 copies, deck size unchanged).
export function aiSideboard(deck, oppCards) {
  const cards = deck.cards.map(x => ({ ...x }));
  const side = (deck.sideboard || []).map(x => ({ ...x }));
  const swaps = [];
  if (!side.length) return { cards, sideboard: side, swaps };
  const pr = profile(oppCards);
  // Too little seen (a quick loss): only the obvious swaps
  const need = pr.seen >= 6 ? 1 : 2.5;
  for (let k = 0; k < 7; k++) {
    const inCands = side.filter(x => x.qty > 0).map(x => [x, matchupValue(x.card, pr)]).sort((a, b) => b[1] - a[1]);
    const outCands = cards.filter(x => x.qty > 0 && !isLand(x.card)).map(x => [x, matchupValue(x.card, pr) + (isCreature(x.card) ? 0.6 : 0) - (x.card.cmc || 0) * 0.1]).sort((a, b) => a[1] - b[1]);
    if (!inCands.length || !outCands.length) break;
    const [inn, iv] = inCands[0], [out, ov] = outCands[0];
    if (iv - ov < need) break;
    inn.qty--; out.qty--;
    const into = cards.find(x => x.card.name === inn.card.name);
    if (into) into.qty++; else cards.push({ card: inn.card, qty: 1 });
    const back = side.find(x => x.card.name === out.card.name);
    if (back) back.qty++; else side.push({ card: out.card, qty: 1 });
    swaps.push({ in: inn.card.name, out: out.card.name });
  }
  return { cards: cards.filter(x => x.qty > 0), sideboard: side.filter(x => x.qty > 0), swaps };
}

// "−1 Shock, +1 Duress" style summary of a list of single-copy swaps
export function swapText(swaps) {
  const count = list => [...list.reduce((m, n) => m.set(n, (m.get(n) || 0) + 1), new Map())].map(([n, k]) => `${k} ${n}`);
  if (!swaps.length) return 'no changes';
  return `in: ${count(swaps.map(s => s.in)).join(', ')} · out: ${count(swaps.map(s => s.out)).join(', ')}`;
}
