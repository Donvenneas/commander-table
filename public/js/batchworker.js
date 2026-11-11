// Batch games on another CPU core (item 170). The page sends the table (each seat's deck as a card list, its play
// style and its learned table) and a list of seeds; this worker plays one game per seed at full speed and posts back
// a short summary of each. A game depends only on its seed and what it was given, so any number of workers gives the
// same results as one.
import { Game } from './engine.js';
import { Agent } from './ai.js';
import { loadDeck } from './decks.js';

let table = null;
self.onmessage = async ({ data }) => {
  try {
    if (data.kind === 'table') {
      const decks = [];
      for (const s of data.seats) decks.push(await loadDeck(s.text, () => {}, { format: data.format }));
      table = { ...data, decks };
      self.postMessage({ kind: 'ready' });
      return;
    }
    if (data.kind === 'play' && table) {
      const { seats, decks, format } = table;
      const g = new Game(seats.map((s, i) => ({ playerName: s.name, deckName: decks[i].deckName, color: s.color, agent: new Agent(data.styles[i]), commanders: decks[i].commanders, cards: decks[i].cards })),
        { beat: async () => {} }, { seed: data.seed, format, learned: seats.map(s => s.learned || null) });
      await g.run();
      self.postMessage({
        kind: 'result', seed: data.seed, over: g.over, round: g.round, winReason: g.winReason || '', winner: g.winner ? g.winner.idx : null,
        errors: g.logEntries.filter(e => e.html.startsWith('Simulator error')).length,
        comboLog: g.comboLog.map(c => ({ label: c.label, landed: !!c.landed, p: c.p })),
        players: g.players.map(p => ({ place: p.place, lost: !!p.lost, lossReason: p.lossReason || '', style: p.style, stats: { combos: p.stats.combos, damage: p.stats.damage, interaction: p.stats.interaction || 0 }, castNames: [...(p.castNames || [])], keptHand: p.keptHand || null })),
      });
    }
  } catch (e) { self.postMessage({ kind: 'error', message: e.message }); }
};
