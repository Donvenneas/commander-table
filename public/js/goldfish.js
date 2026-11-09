// Goldfish (item 149): how a deck draws and how fast it comes together with nobody in the way.
// Sample hands: shuffle, draw 7, mulligan (London: draw 7 again, then put one card per mulligan on the bottom), and
// the next draws. Solo runs: the AI pilot plays the deck many times (one seed each) against an opponent who only
// plays lands, for up to ten of its own turns, and reports the average turn the commander came down, the turn a
// combo was started and the turn it won.
import { Game, Abort } from './engine.js';
import { Agent, guessStyle } from './ai.js';
import { makeRng, sleep } from './util.js';

const shuffle = (a, rng) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

// A shuffled library of the deck's cards (commanders stay out); returns a sampler with draw / mulligan
export function sampleHands(deck, seed = Date.now()) {
  const rng = makeRng(seed >>> 0);
  const pool = deck.cards.flatMap(({ card, qty }) => Array.from({ length: qty }, () => card));
  const st = { lib: [], hand: [], mulligans: 0, drawn: [] };
  const deal = () => { st.lib = shuffle([...pool], rng); st.hand = st.lib.splice(0, 7); st.drawn = []; };
  deal();
  return {
    get hand() { return st.hand; }, get mulligans() { return st.mulligans; }, get drawn() { return st.drawn; },
    // (London mulligan: a fresh 7; the player then puts this many on the bottom)
    mulligan() { st.mulligans++; deal(); return st.mulligans; },
    newHand() { st.mulligans = 0; deal(); },
    draw() { const c = st.lib.shift(); if (c) st.drawn.push(c); return c; },
  };
}

/**
 * @param {any} deck
 * @param {{ runs?: number, format?: string, onProgress?: (done: number, total: number) => void, stop?: () => boolean }} [opts]
 */
export async function goldfishRuns(deck, { runs = 100, format = 'commander', onProgress = undefined, stop = undefined } = {}) {
  const land = deck.cards.find(x => /\bbasic\b/i.test(x.card.typeLine || '') && x.card.fx?.type.land)?.card || deck.cards.find(x => x.card.fx?.type.land)?.card;
  if (!land) throw new Error('The deck has no lands to build the practice opponent from.');
  const out = { runs: 0, cmd: [], combo: [], win: [], noCmd: 0, landsT3: [], mulls: 0 };
  const MAX = 10;
  for (let r = 0; r < runs; r++) {
    if (stop?.()) break;
    let myTurns = 0, cmdAt = null, comboAt = null;
    const pilot = { playerName: 'Pilot', deckName: deck.deckName, color: '#f2a93b', agent: new Agent(guessStyle(deck)), commanders: deck.commanders, cards: deck.cards };
    const dummy = { playerName: 'Practice opponent', deckName: 'Lands', color: '#888', agent: new Agent('defensive'), commanders: [], cards: [{ card: land, qty: Math.max(60, deck.cards.reduce((a, c) => a + c.qty, 0)) }] };
    const g = new Game([pilot, dummy], { beat: async () => { if (myTurns > MAX) throw new Abort(); } }, { seed: 7919 * (r + 1), noLearning: true, format, firstPlayer: 0 });
    g.on('turn', p => {
      if (p.idx !== 0) return;
      myTurns++;
      if (myTurns === 4) out.landsT3.push(g.players[0].battlefield.filter(o => o.fx.type.land).length);
    });
    g.on('cast', ({ o, p }) => { if (p.idx === 0 && o.isCommander && cmdAt == null) cmdAt = myTurns; });
    g.on('combo', ({ p, stage }) => { if (p.idx === 0 && stage === 'start' && comboAt == null) comboAt = myTurns; });
    try { await g.run(); } catch (e) { if (!(e instanceof Abort)) throw e; }
    out.runs++;
    out.mulls += g.players[0].mulligans || 0;
    if (cmdAt != null) out.cmd.push(cmdAt); else if (deck.commanders.length) out.noCmd++;
    if (comboAt != null) out.combo.push(comboAt);
    if (g.winner?.idx === 0 && myTurns <= MAX) out.win.push(myTurns);
    onProgress?.(r + 1, runs);
    if (r % 5 === 4) await sleep(0);
  }
  const avg = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  return { ...out, avgCmd: avg(out.cmd), avgCombo: avg(out.combo), avgWin: avg(out.win), avgLandsT3: avg(out.landsT3), avgMulls: out.runs ? out.mulls / out.runs : 0 };
}
