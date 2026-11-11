// Seat colors, a deck as text, and games on every CPU core (batchworker.js) — split out of main.js (Round 5, item 176)
import { learnedBonus, learnAs } from './learn.js';

export const SEAT_COLORS = ['#f2a93b', '#3bb6f2', '#b07cff', '#4cd18a', '#ef6b6b', '#e8d44d', '#5fd3c6', '#ff8fd8', '#9aa7ff'];

export function deckText(deck) {
  const line = c => `${c.qty ?? 1} ${c.card?.name ?? c.name}${(c.card ?? c).set ? ` (${(c.card ?? c).set.toUpperCase()}) ${(c.card ?? c).cn}` : ''}`;
  const side = deck.sideboard?.length ? ['', 'Sideboard', ...deck.sideboard.map(line)] : [];
  // (a companion that isn't also in the sideboard gets its own section, so replays and challenge links keep it)
  const comp = deck.companion && !(deck.sideboard || []).some(c => c.card === deck.companion) ? ['', 'Companion', line({ card: deck.companion })] : [];
  if (!deck.commanders.length) return ['Deck', ...deck.cards.map(line), ...side, ...comp].join('\n');
  return ['Commander', ...deck.commanders.map(c => line({ card: c })), '', 'Deck', ...deck.cards.map(line), ...side, ...comp].join('\n');
}

// jobs: [{ seed, format, decks, styles, names?, colors? }]. Every job's message (with the learned tables of the
// moment) is made before any game starts, so the results don't depend on the number of cores or on timing.
// onResult(result, job) is called in job order. Returns false when workers aren't available.
/** @param {any[]} jobs @param {(r: any, job: any) => void} onResult @param {{ cores?: number, stop?: () => boolean }} [opts] */
export async function runOnCores(jobs, onResult, { cores = 0, stop = () => false } = {}) {
  if (typeof Worker !== 'function' || !jobs.length) return false;
  const n = Math.min(jobs.length, cores || Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 2) - 1)));
  const msgs = jobs.map((job, id) => ({ kind: 'game', id, seed: job.seed, format: job.format, seats: job.decks.map((d, i) => ({ text: deckText(d), name: job.names?.[i] || `Player ${i + 1}`, color: job.colors?.[i] || SEAT_COLORS[i], style: job.styles[i], learned: learnedBonus(learnAs(d)) })) }));
  const results = new Array(jobs.length);
  let next = 0, sent = 0;
  const workers = Array.from({ length: n }, () => new Worker(new URL('./batchworker.js', import.meta.url), { type: 'module' }));
  try {
    await Promise.all(workers.map(w => new Promise((resolve, reject) => {
      const give = () => { if (stop() || sent >= msgs.length) { resolve(); return; } w.postMessage(msgs[sent++]); };
      w.onmessage = ({ data }) => {
        if (data.kind === 'error') { reject(new Error(data.message)); return; }
        results[data.id] = data;
        // (handed on in job order, so running totals don't depend on which core finished first)
        while (results[next]) { onResult(results[next], jobs[next]); next++; }
        give();
      };
      w.onerror = e => reject(new Error(e.message || 'the worker failed'));
      give();
    })));
  } finally { workers.forEach(w => w.terminate()); }
  return true;
}
// A worker's summary of a game, shaped like a game for the tallies and for deck learning
export function gameFromSummary(r, decks) {
  const players = r.players.map((p, i) => ({ ...p, idx: i, castNames: new Set(p.castNames), learnAs: learnAs(decks[i]), commanders: decks[i].commanders, command: [] }));
  return { over: r.over, round: r.round, winReason: r.winReason, winner: r.winner != null ? players[r.winner] : null, players, comboLog: r.comboLog, errors: r.errors, logEntries: [], threatLog: r.threatLog || [] };
}
