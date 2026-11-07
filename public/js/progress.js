// Your progress, all offline and kept in the browser profile (inside the game folder's data\ when
// started from Commander Table.exe): the ranked ladder against the AI, daily and weekly challenges
// with a streak, and badges. Nothing is bought or spent: badges are only for show.
import { store } from './util.js';

const LADDER = 'ct.ladder';
const CHALLENGES = 'ct.challenges';
const BADGES = 'ct.badges';

// ---------- ranked ladder
// An Elo rating per format. Your opponents are AI pilots with a fixed rating by how sharply they play
// (Commander brackets: 1 = 1200 … 5 = 1800; other formats 1500). In a multiplayer game you're scored
// against each opponent: beating them if you placed above them. The first 5 games are placement
// games (counted double, rank hidden until they're done).
export const PLACEMENT = 5;
export const TIERS = [
  { name: 'Bronze', min: 0 }, { name: 'Silver', min: 1300 }, { name: 'Gold', min: 1450 },
  { name: 'Platinum', min: 1600 }, { name: 'Diamond', min: 1750 }, { name: 'Mythic', min: 1900 },
];
export function rankOf(rating, games) {
  if (games < PLACEMENT) return { tier: 'Unranked', division: '', label: `Placement ${games}/${PLACEMENT}` };
  let k = 0;
  for (let i = 0; i < TIERS.length; i++) if (rating >= TIERS[i].min) k = i;
  const t = TIERS[k];
  if (t.name === 'Mythic') return { tier: 'Mythic', division: '', label: 'Mythic' };
  const span = TIERS[k + 1].min - t.min;
  const base = k === 0 ? 1150 : t.min;
  const step = (k === 0 ? TIERS[1].min - base : span) / 3;
  const div = ['III', 'II', 'I'][Math.max(0, Math.min(2, Math.floor((rating - base) / step)))];
  return { tier: t.name, division: div, label: `${t.name} ${div}` };
}
export const aiRating = bracket => (bracket ? 1200 + (bracket - 1) * 150 : 1500);

export function ladder() {
  const l = store(LADDER) || { season: 1, startedAt: Date.now(), formats: {}, past: [] };
  l.formats ||= {}; l.past ||= [];
  return l;
}
// A ranked game you played: you = your seat, place per seat (1 = winner), opponents' AI ratings
export function recordRanked({ format, you, places, oppRatings }) {
  const l = ladder();
  const f = l.formats[format] ||= { rating: 1500, games: 0, wins: 0, peak: 1500, history: [] };
  const K = f.games < PLACEMENT ? 64 : 32;
  let delta = 0;
  const n = places.length;
  for (let j = 0; j < n; j++) {
    if (j === you) continue;
    const expect = 1 / (1 + 10 ** ((oppRatings[j] - f.rating) / 400));
    const score = places[you] < places[j] ? 1 : places[you] > places[j] ? 0 : 0.5;
    // (multiplayer: each opponent counts a share, so a four-player win isn't worth three duels)
    delta += (K * (score - expect)) / (n > 2 ? (n - 1) / 1.5 : 1);
  }
  delta = Math.round(delta);
  const before = { rating: f.rating, rank: rankOf(f.rating, f.games) };
  f.rating += delta;
  f.games++;
  if (places[you] === 1) f.wins++;
  if (f.games >= PLACEMENT) f.peak = Math.max(f.peak, f.rating);
  f.history.unshift({ at: Date.now(), delta, rating: f.rating, won: places[you] === 1 });
  f.history = f.history.slice(0, 50);
  store(LADDER, l);
  return { delta, rating: f.rating, before, after: rankOf(f.rating, f.games), games: f.games };
}
// A new season: every rating moves halfway back to 1500 and placement starts over; the old season's
// final and peak ratings are kept
export function newSeason() {
  const l = ladder();
  l.past.unshift({ season: l.season, endedAt: Date.now(), formats: Object.fromEntries(Object.entries(l.formats).map(([k, f]) => [k, { rating: f.rating, peak: f.peak, games: f.games, wins: f.wins, rank: rankOf(f.rating, f.games).label }])) });
  l.past = l.past.slice(0, 20);
  for (const f of Object.values(l.formats)) { f.rating = Math.round((f.rating + 1500) / 2); f.games = 0; f.wins = 0; f.peak = f.rating; f.history = []; }
  l.season++;
  l.startedAt = Date.now();
  store(LADDER, l);
  return l;
}

// ---------- challenges
// Each template checks one finished game you played (or a match). Daily: three a day; weekly: two a
// week. They're chosen from the date, so everyone with the same version sees the same ones.
// r: { won, format, formatName, seats, rounds, spells, damage, colors (deck's), matchWon, oneVsOne, commander }
const COLOR_NAME = { W: 'white', U: 'blue', B: 'black', R: 'red', G: 'green' };
const DAILY = [
  ...['W', 'U', 'B', 'R', 'G'].map(c => ({ id: `win-${c}`, text: `Win a game with a ${COLOR_NAME[c]} deck`, need: 1, test: r => r.won && r.colors.includes(c) })),
  { id: 'cast-15', text: 'Cast 15 spells in one game', need: 1, test: r => r.spells >= 15 },
  { id: 'damage-25', text: 'Deal 25 damage in one game', need: 1, test: r => r.damage >= 25 },
  { id: 'fast-win', text: 'Win a game by round 8', need: 1, test: r => r.won && r.rounds <= 8 },
  { id: 'play-3', text: 'Play 3 games', need: 3, test: () => true },
  { id: 'win-duel', text: 'Win a one-on-one game', need: 1, test: r => r.won && r.oneVsOne },
  { id: 'win-pod', text: 'Win a four-player game', need: 1, test: r => r.won && r.seats >= 4 },
  { id: 'win-multi', text: 'Win a game with a deck of three or more colors', need: 1, test: r => r.won && r.colors.length >= 3 },
  { id: 'win-mono', text: 'Win a game with a one-color deck', need: 1, test: r => r.won && r.colors.length === 1 },
];
const WEEKLY = [
  { id: 'w-win-5', text: 'Win 5 games', need: 5, test: r => r.won },
  { id: 'w-play-12', text: 'Play 12 games', need: 12, test: () => true },
  { id: 'w-match', text: 'Win a best-of-three match', need: 1, test: r => r.matchWon },
  { id: 'w-formats', text: 'Win in 3 different formats', need: 3, distinct: r => (r.won ? r.format : null) },
  { id: 'w-colors', text: 'Win with 4 different colors (any decks)', need: 4, distinct: r => (r.won ? r.colors : null) },
  { id: 'w-spells', text: 'Cast 100 spells', need: 100, add: r => r.spells },
];
const dayKey = (t = Date.now()) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
// The Monday of the week
const weekKey = (t = Date.now()) => { const d = new Date(t); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return dayKey(d.getTime()); };
const hash = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0; return h; };
function pickN(list, n, seed) {
  const out = [], pool = [...list];
  let h = hash(seed);
  while (out.length < n && pool.length) { h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0; out.push(pool.splice(h % pool.length, 1)[0]); }
  return out;
}

function challengeState(now = Date.now()) {
  const s = store(CHALLENGES) || {};
  const day = dayKey(now), week = weekKey(now);
  if (s.day !== day) { s.day = day; s.daily = pickN(DAILY, 3, `d${day}`).map(c => ({ id: c.id, n: 0, done: false })); }
  if (s.week !== week) { s.week = week; s.weekly = pickN(WEEKLY, 2, `w${week}`).map(c => ({ id: c.id, n: 0, done: false, seen: [] })); }
  s.streak ||= { count: 0, last: null, best: 0 };
  s.completed ||= 0;
  return s;
}
const templ = id => DAILY.find(c => c.id === id) || WEEKLY.find(c => c.id === id);

export function challenges() {
  const s = challengeState();
  store(CHALLENGES, s);
  const view = list => list.map(c => ({ ...c, text: templ(c.id)?.text || c.id, need: templ(c.id)?.need || 1 }));
  return { daily: view(s.daily), weekly: view(s.weekly), streak: s.streak, completed: s.completed, day: s.day, week: s.week };
}

// A finished game you played: progress every open challenge; returns what was just completed
export function recordChallenges(r) {
  const s = challengeState();
  const done = [];
  for (const c of [...s.daily, ...s.weekly]) {
    if (c.done) continue;
    const t = templ(c.id);
    if (!t) continue;
    if (t.distinct) {
      const v = t.distinct(r);
      for (const x of [].concat(v ?? [])) if (!c.seen.includes(x)) c.seen.push(x);
      c.n = c.seen.length;
    } else if (t.add) c.n += t.add(r) || 0;
    else if (t.test(r)) c.n++;
    if (c.n >= t.need) { c.n = t.need; c.done = true; s.completed++; done.push(t.text); }
  }
  // The streak: days in a row with at least one daily challenge done
  if (s.daily.some(c => c.done) && s.streak.last !== s.day) {
    const yesterday = dayKey(Date.now() - 864e5);
    s.streak.count = s.streak.last === yesterday ? s.streak.count + 1 : 1;
    s.streak.last = s.day;
    s.streak.best = Math.max(s.streak.best, s.streak.count);
  }
  store(CHALLENGES, s);
  const badges = checkBadges(s);
  return { done, badges };
}

// ---------- badges (only for show)
export const BADGE_LIST = [
  { id: 'first-challenge', name: 'First Steps', text: 'Complete a challenge', test: s => s.completed >= 1 },
  { id: 'ten-challenges', name: 'Taskmaster', text: 'Complete 10 challenges', test: s => s.completed >= 10 },
  { id: 'fifty-challenges', name: 'Relentless', text: 'Complete 50 challenges', test: s => s.completed >= 50 },
  { id: 'streak-3', name: 'Warming Up', text: 'A 3-day challenge streak', test: s => s.streak.best >= 3 },
  { id: 'streak-7', name: 'Week of Wins', text: 'A 7-day challenge streak', test: s => s.streak.best >= 7 },
  { id: 'streak-30', name: 'Unbroken', text: 'A 30-day challenge streak', test: s => s.streak.best >= 30 },
  { id: 'weekly', name: 'Weekender', text: 'Complete a weekly challenge', test: s => s.weekly.some(c => c.done) || s.weeklyEver },
  { id: 'rank-gold', name: 'Gilded', text: 'Reach Gold on the ladder', test: (s, l) => Object.values(l.formats).some(f => f.games >= PLACEMENT && f.peak >= 1450) },
  { id: 'rank-diamond', name: 'Brilliant', text: 'Reach Diamond on the ladder', test: (s, l) => Object.values(l.formats).some(f => f.games >= PLACEMENT && f.peak >= 1750) },
  { id: 'rank-mythic', name: 'Mythic', text: 'Reach Mythic on the ladder', test: (s, l) => Object.values(l.formats).some(f => f.games >= PLACEMENT && f.peak >= 1900) },
  { id: 'mastery-5', name: 'Seasoned', text: 'Get a deck to mastery level 5', test: (s, l, m) => m >= 5 },
  { id: 'mastery-10', name: 'Old Friend', text: 'Get a deck to mastery level 10', test: (s, l, m) => m >= 10 },
];
export function badges() { return store(BADGES) || {}; }
// Checks every badge; returns the names of the ones just earned. maxMastery: the best deck level known.
export function checkBadges(s = challengeState(), maxMastery = 0) {
  const got = badges();
  if (s.weekly?.some(c => c.done)) s.weeklyEver = true;
  const l = ladder();
  const fresh = [];
  for (const b of BADGE_LIST) if (!got[b.id] && b.test(s, l, maxMastery)) { got[b.id] = Date.now(); fresh.push(b.name); }
  if (s.weeklyEver) store(CHALLENGES, s);
  store(BADGES, got);
  return fresh;
}
