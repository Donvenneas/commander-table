// Learned threat assessment (Round 5, item 108).
// At the start of every round of a game with three or more players, each player's public board is noted as a few
// coarse features (creature power, life, other permanents, lands, cards in hand, combo pieces out, commander out).
// When the game ends, each note is marked by whether that player won within the next two rounds. Over many games
// (batch runs especially) every feature value gets a win-soon rate against the average; the pilots' threat ranking
// and the table's choice of archenemy are scaled by what the current board says. The table is a plain object that
// travels in each seat's learned table (learn.js, key '#threat'), so a game and its replay use the same numbers.
import { store } from './util.js';

const KEY = 'ct.threat';
const MIN_GAMES = 30, MIN_NOTES = 12, SOON = 2;

const bucket = (x, edges) => { let i = 0; while (i < edges.length && x >= edges[i]) i++; return i; };
// A player's public board (nothing from hidden zones but the hand's size)
export function threatFeatures(g, q) {
  let power = 0, other = 0, lands = 0, danger = 0, cmd = 0;
  for (const o of q.battlefield) {
    if (o.fx.type.land) { lands++; continue; }
    if (o.fx.type.creature) power += Math.max(0, g.power(o));
    else other++;
    if (o.isCommander) cmd = 1;
    if (q.agent?.comboDanger) danger = Math.max(danger, q.agent.comboDanger(g, o));
  }
  return {
    power: bucket(power, [1, 5, 10, 20]),
    life: bucket(q.life / (g.startLife || 40), [0.25, 0.5, 0.75, 1]),
    other: bucket(other, [3, 6, 10]),
    lands: bucket(lands, [4, 7, 10]),
    hand: bucket(q.hand.length, [2, 4, 7]),
    combo: bucket(danger, [1, 5, 10]),
    cmd,
  };
}

// After a game: count each note under its feature values
export function recordThreat(g) {
  if (!g.threatLog?.length || !g.over) return;
  const t = store(KEY) || { games: 0, notes: 0, soon: 0, f: {} };
  t.games++;
  const wIdx = g.winner ? g.winner.idx : -1;
  for (const n of g.threatLog) {
    const won = n.idx === wIdx && g.round - n.round < SOON;
    t.notes++;
    if (won) t.soon++;
    for (const [k, v] of Object.entries(n.f)) {
      const c = ((t.f[k] ||= {})[v] ||= [0, 0]);
      c[0]++;
      if (won) c[1]++;
    }
  }
  store(KEY, t);
}

// The table a game uses: each feature value's win-soon rate as a log ratio against the average (small samples shrunk
// toward it), or null with too little history
export function learnedThreat() {
  const t = store(KEY);
  if (!t || t.games < MIN_GAMES || !t.soon) return null;
  const base = t.soon / t.notes;
  const out = { games: t.games, f: {} };
  for (const [k, vals] of Object.entries(t.f)) for (const [v, [n, w]] of Object.entries(vals)) {
    if (n < MIN_NOTES) continue;
    const rate = (w + base * 4) / (n + 4);
    (out.f[k] ||= {})[v] = Math.round(Math.log(Math.max(0.05, rate / base)) * 100) / 100;
  }
  return out;
}

// How much more (or less) of a threat q is than their raw board suggests: the feature log ratios summed and damped
// (the features overlap), between 0.4 and 2.5
export function threatMult(table, g, q) {
  if (!table?.f) return 1;
  const f = threatFeatures(g, q);
  let s = 0;
  for (const [k, v] of Object.entries(f)) s += table.f[k]?.[v] || 0;
  return Math.max(0.4, Math.min(2.5, Math.exp(s * 0.5)));
}

export function threatSummary() {
  const t = store(KEY);
  return t ? { games: t.games, notes: t.notes, soon: t.soon } : null;
}
export function forgetThreat() { store(KEY, null); }
