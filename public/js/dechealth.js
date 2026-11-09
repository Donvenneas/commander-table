// Deck health (item 145): lands, curve and the counts of ramp, card draw, targeted removal and board wipes in a
// Commander deck, measured against a template, with suggestions. The roles come from Scryfall's community card tags
// (otag: searches), asked about only for this deck's cards; each card's answer is kept in the browser profile, so
// a card is asked about once.
import { sf } from './scryfall.js';
import { store } from './util.js';

// The template: a common rule of thumb for 100-card Commander decks (ranges, not rules)
export const HEALTH_TEMPLATE = {
  lands: { label: 'Lands', min: 35, max: 39 },
  ramp: { label: 'Ramp', tag: '(otag:mana-rock or otag:mana-dork or otag:land-ramp or otag:ritual)', min: 10, max: 15 },
  draw: { label: 'Card draw', tag: 'otag:draw', min: 10, max: 15 },
  removal: { label: 'Targeted removal', tag: 'otag:spot-removal', min: 8, max: 12 },
  wipe: { label: 'Board wipes', tag: 'otag:board-wipe', min: 2, max: 5 },
};
const TAGGED = Object.entries(HEALTH_TEMPLATE).filter(([, t]) => t.tag);
const CACHE = 'ct.otags2';

// For each tag, the names of the deck's cards that have it (asked in groups of 20 names to keep searches short)
async function tagsFor(names, say) {
  const cache = store(CACHE) || {};
  const todo = names.filter(n => !cache[n]);
  for (const [k, t] of TAGGED) {
    for (let i = 0; i < todo.length; i += 20) {
      const group = todo.slice(i, i + 20);
      say?.(`Asking Scryfall about ${t.label.toLowerCase()} (${Math.min(todo.length, i + 20)} of ${todo.length} cards)…`);
      const q = `${t.tag} (${group.map(n => `!"${n.split(' // ')[0].replace(/"/g, '')}"`).join(' or ')})`;
      const hit = new Set();
      try {
        let r = await sf(`/cards/search?q=${encodeURIComponent(q)}&unique=cards`);
        for (;;) {
          for (const c of r.data || []) hit.add(c.name);
          if (!r.has_more) break;
          r = await sf(r.next_page.replace('https://api.scryfall.com', ''));
        }
      } catch (e) { if (!/match|No cards/i.test(e.message)) throw e; }
      for (const n of group) {
        const tags = (cache[n] ||= { at: Date.now(), tags: [] }).tags;
        if ([...hit].some(h => h === n || h.split(' // ')[0] === n.split(' // ')[0]) && !tags.includes(k)) tags.push(k);
      }
    }
  }
  // (only marked as known once every tag was asked)
  try { store(CACHE, cache); } catch { /* full: ask again next time */ }
  const out = Object.fromEntries(TAGGED.map(([k]) => [k, []]));
  for (const n of names) for (const k of cache[n]?.tags || []) out[k].push(n);
  return out;
}

// deck: a loaded deck ({ commanders, cards }); returns counts, the cards in each role and suggestions
export async function deckHealth(deck, say) {
  const all = [...deck.commanders.map(c => ({ card: c, qty: 1 })), ...deck.cards];
  const lands = all.filter(x => x.card.fx?.type.land).reduce((a, x) => a + x.qty, 0);
  const names = [...new Set(all.filter(x => !x.card.fx?.type.land).map(x => x.card.name))];
  const tagged = await tagsFor(names, say);
  const qty = Object.fromEntries(all.map(x => [x.card.name, x.qty]));
  /** @type {Record<string, number>} */
  const counts = { lands, ...Object.fromEntries(Object.entries(tagged).map(([k, list]) => [k, list.reduce((a, n) => a + (qty[n] || 1), 0)])) };
  const spells = all.filter(x => !x.card.fx?.type.land);
  const avg = spells.reduce((a, x) => a + (x.card.cmc || 0) * x.qty, 0) / Math.max(1, spells.reduce((a, x) => a + x.qty, 0));
  const notes = [];
  for (const [k, t] of Object.entries(HEALTH_TEMPLATE)) {
    if (counts[k] < t.min) notes.push({ k, text: `${t.label}: ${counts[k]}, below ${t.min}. Consider ${t.min - counts[k]} more.` });
    else if (counts[k] > t.max) notes.push({ k, text: `${t.label}: ${counts[k]}, above ${t.max}. ${k === 'lands' ? 'You could cut a land or two for spells.' : 'Fine if it is your plan; otherwise room for other cards.'}` });
  }
  if (avg > 3.6 && counts.ramp < 12) notes.push({ k: 'curve', text: `The average mana value is ${avg.toFixed(2)}: a heavy curve wants 12+ ramp or a lower curve.` });
  if (avg < 2.4 && lands > 33) notes.push({ k: 'curve', text: `The average mana value is ${avg.toFixed(2)}: a low curve can run fewer lands (about 32–34).` });
  return { counts, tagged, avg, notes };
}

// A few popular cards in the deck's colors with the tag the deck is short of (not already in the deck)
export async function healthSuggestions(deck, key) {
  const t = HEALTH_TEMPLATE[key];
  if (!t?.tag) return [];
  const id = [...new Set(deck.commanders.flatMap(c => c.colorIdentity || []))].join('') || 'c';
  const have = new Set(deck.cards.map(x => x.card.name));
  try {
    const r = await sf(`/cards/search?q=${encodeURIComponent(`${t.tag} id<=${id} legal:commander -t:land`)}&order=edhrec&unique=cards`);
    return (r.data || []).map(c => c.name).filter(n => !have.has(n)).slice(0, 8);
  } catch { return []; }
}
