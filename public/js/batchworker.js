// Games on another CPU core (item 170): batch runs, the matchup grid and the AI tournament. Each job names its seats
// (a deck as a card list, a play style, a learned table) and a seed; this worker plays it at full speed and posts back
// a short summary. A game depends only on its seed and what it was given, so any number of workers gives the same
// results as one. Decks are loaded once per worker and kept by their card list.
import { Game } from './engine.js';
import { Agent } from './ai.js';
import { loadDeck } from './decks.js';

const decks = new Map();
const deckFor = async (text, format) => {
  const key = `${format}\n${text}`;
  if (!decks.has(key)) decks.set(key, await loadDeck(text, () => {}, { format }));
  return decks.get(key);
};
self.onmessage = async ({ data }) => {
  if (data.kind !== 'game') return;
  try {
    const ds = [];
    for (const s of data.seats) ds.push(await deckFor(s.text, data.format));
    const g = new Game(data.seats.map((s, i) => ({ playerName: s.name, deckName: ds[i].deckName, color: s.color, agent: new Agent(s.style), commanders: ds[i].commanders, cards: ds[i].cards })),
      { beat: async () => {} }, { seed: data.seed, format: data.format, learned: data.seats.map(s => s.learned || null) });
    await g.run();
    self.postMessage({
      kind: 'result', id: data.id, seed: data.seed, over: g.over, round: g.round, winReason: g.winReason || '', winner: g.winner ? g.winner.idx : null,
      errors: g.logEntries.filter(e => e.html.startsWith('Simulator error')).length,
      comboLog: g.comboLog.map(c => ({ label: c.label, landed: !!c.landed, p: c.p })),
      players: g.players.map(p => ({ place: p.place, lost: !!p.lost, lossReason: p.lossReason || '', style: p.style, stats: { combos: p.stats.combos, damage: p.stats.damage, interaction: p.stats.interaction || 0, spells: p.stats.spells || 0 }, castNames: [...(p.castNames || [])], keptHand: p.keptHand || null })),
    });
  } catch (e) { self.postMessage({ kind: 'error', id: data.id, message: e.message }); }
};
