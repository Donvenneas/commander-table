// Per-deck memory: after every finished game, each deck remembers which of its cards it cast and whether
// it won. Over many games (batch runs especially) cards that show up in wins more than the deck's
// average get a small bonus when its AI pilot chooses what to cast, and cards seen mostly in losses a penalty.
// Stored in the browser profile, which lives in the game folder's data/ when started from Commander Table.exe.
import { store } from './util.js';

const KEY = 'ct.learn';
// (kept for deck mastery too, so more than before)
const MAX_DECKS = 200;
const MIN_GAMES = 5;

export const deckKey = commanders => commanders.map(c => c.name).sort().join(' + ');

// What a deck is remembered by: its commanders, or for a deck without one (Standard, Limited…) its
// format, name and a short fingerprint of its main-deck card names
export function learnAs(deck) {
  if (deck.commanders?.length) return deck.commanders;
  const names = [...new Set((deck.cards || []).map(c => c.card.name))].sort().join('|');
  let h = 0;
  for (let i = 0; i < names.length; i++) h = (h * 31 + names.charCodeAt(i)) >>> 0;
  return [{ name: `${deck.format || 'deck'}: ${deck.deckName} #${h.toString(36).slice(0, 5)}` }];
}

function load() { return store(KEY) || {}; }

export function recordGame(g) {
  if (!g.over || g.players.length < 2) return;
  const all = load();
  for (const p of g.players) {
    const key = deckKey(p.learnAs || p.commanders || p.command.map(o => o.card));
    if (!key) continue;
    const d = all[key] ||= { games: 0, wins: 0, cards: {}, at: 0 };
    const won = g.winner === p;
    d.games++;
    if (won) d.wins++;
    // Results per play style (batch runs and "Tune styles" fill this in)
    const st = (d.styles ||= {})[p.style] ||= [0, 0];
    st[0]++;
    if (won) st[1]++;
    d.at = Date.now();
    for (const name of p.castNames || []) {
      const c = d.cards[name] ||= [0, 0];
      c[0]++;
      if (won) c[1]++;
    }
    // Learned mulligans (item 110): results by the kept hand's land count (seven-card keeps only)
    if (p.keptHand && p.keptHand.mulls === 0) {
      const h = (d.hands ||= {})[Math.min(6, p.keptHand.lands)] ||= [0, 0];
      h[0]++;
      if (won) h[1]++;
    }
  }
  // Keep the most recently played decks only
  const keys = Object.keys(all);
  if (keys.length > MAX_DECKS) keys.sort((a, b) => all[a].at - all[b].at).slice(0, keys.length - MAX_DECKS).forEach(k => delete all[k]);
  store(KEY, all);
}

// A table of card name → bonus (about −2 to +2), or null when the deck has too little history.
// It's a plain object so a game can keep it in its setup: replays then play exactly the same.
export function learnedBonus(commanders) {
  const d = load()[deckKey(commanders)];
  if (!d || d.games < MIN_GAMES) return null;
  const base = d.wins / d.games;
  const out = {};
  for (const [name, c] of Object.entries(d.cards)) {
    if (c[0] < MIN_GAMES) continue;
    // Shrink toward the deck average when the sample is small
    const rate = (c[1] + base * 3) / (c[0] + 3);
    const b = Math.round(Math.max(-2, Math.min(2, (rate - base) * 6)) * 100) / 100;
    if (b) out[name] = b;
  }
  // Seven-card keeps by land count, as win-rate points against the deck average (shrunk the same way); kept under a
  // key no card has, so the table stays one plain object saved with each game
  const hands = {};
  for (const [n, h] of Object.entries(d.hands || {})) if (h[0] >= 6) hands[n] = Math.round(((h[1] + base * 4) / (h[0] + 4) - base) * 100) / 100;
  if (Object.keys(hands).length) out['#hands'] = hands;
  return out;
}

// The play style this deck wins most with, once there's enough evidence: at least 12 games in all,
// 4 with that style, and a win rate clearly (8 points) above the deck's average. Null otherwise.
export function learnedStyle(commanders) {
  const d = load()[deckKey(commanders)];
  if (!d?.styles || d.games < 12) return null;
  const base = d.wins / d.games;
  let best = null, rate = base + 0.08;
  for (const [style, [games, wins]] of Object.entries(d.styles)) {
    if (games < 4 || !['aggressive', 'balanced', 'defensive', 'combo', 'cedh'].includes(style)) continue;
    // Shrink small samples toward the average
    const r = (wins + base * 2) / (games + 2);
    if (r > rate) { rate = r; best = style; }
  }
  return best;
}

export function learnedSummary(commanders) {
  const d = load()[deckKey(commanders)];
  if (!d) return null;
  const bonus = learnedBonus(commanders) || {};
  const ranked = Object.entries(bonus).sort((a, b) => b[1] - a[1]);
  const styles = Object.entries(d.styles || {}).map(([s, [n, w]]) => ({ style: s, games: n, wins: w })).sort((a, b) => b.games - a.games);
  return { games: d.games, wins: d.wins, best: ranked.slice(0, 5), worst: ranked.slice(-5).reverse().filter(x => x[1] < 0), styles, style: learnedStyle(commanders) };
}

// Deck mastery: a level from the games it has played (10 points each) and won (15 more), with
// level n reached at 25·(n−1)² points (level 2 at 25, 5 at 400, 10 at 2,025), up to 20; plus the
// cards it cast most often in its wins
export function mastery(who) {
  const d = load()[deckKey(who)];
  if (!d) return { level: 1, games: 0, wins: 0, xp: 0, next: 25, into: 0, span: 25, top: [] };
  const xp = d.games * 10 + d.wins * 15;
  const level = Math.min(20, Math.floor(Math.sqrt(xp / 25)) + 1);
  const at = n => 25 * (n - 1) ** 2;
  const top = Object.entries(d.cards).filter(([, c]) => c[1] > 0).sort((a, b) => b[1][1] - a[1][1] || b[1][0] - a[1][0]).slice(0, 5).map(([name, c]) => ({ name, casts: c[0], wins: c[1] }));
  return { level, games: d.games, wins: d.wins, xp, next: level >= 20 ? null : at(level + 1), into: xp - at(level), span: level >= 20 ? 1 : at(level + 1) - at(level), top };
}

export function forgetDeck(commanders) {
  const all = load();
  delete all[deckKey(commanders)];
  store(KEY, all);
}
