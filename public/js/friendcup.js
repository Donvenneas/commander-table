// Friend tournaments (item 143): 4–16 people (you, friends online, AI decks) in Swiss rounds or single elimination.
// Pods are a table's worth of players (two in duel formats, four in Commander); a short pod is filled with AI
// fill-ins, who score nothing and never advance. Pods with people are played at the table one at a time; pods of
// AI entrants are played at full speed. Only the plan and the results live here; main.js plays the games.

// entrants: [{ name, kind: 'you' | 'friend' | 'ai', source }]
export function newCup({ entrants, mode = 'swiss', rounds = 3, pod = 4, format = 'commander' }) {
  return {
    v: 1, mode: mode === 'elim' ? 'elim' : 'swiss', rounds: Math.max(1, Math.min(10, rounds)), pod, format,
    entrants: entrants.map(e => ({ name: e.name, kind: e.kind, source: e.source, points: 0, wins: 0, games: 0, out: false })),
    round: 0, pods: [], history: [], done: false, champion: null,
  };
}

const shuffle = (a, rng) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

// The next round's pods: Swiss pairs players on the same points; elimination draws the players still in at random
export function pairRound(cup, rng = Math.random) {
  if (cup.done) return cup;
  const alive = cup.entrants.map((e, i) => i).filter(i => !cup.entrants[i].out);
  let order = shuffle(alive, rng);
  if (cup.mode === 'swiss') order = order.sort((a, b) => cup.entrants[b].points - cup.entrants[a].points);
  cup.round++;
  cup.pods = [];
  for (let k = 0; k < order.length; k += cup.pod) {
    const seats = order.slice(k, k + cup.pod);
    while (seats.length < cup.pod) seats.push(-1);
    cup.pods.push({ seats, places: null });
  }
  return cup;
}

// Swiss points for a place in a pod: 3 for first, then 2, 1, 0 in a four-player pod (0 for losing a duel)
export const pointsFor = (place, pod) => (place === 1 ? 3 : Math.max(0, pod - place));

// Results for pod k: places[i] for each seat (1 is the winner), life[i] to break ties in elimination
export function recordPod(cup, k, places, life = []) {
  const p = cup.pods[k];
  if (!p || p.places) return cup;
  p.places = places;
  p.seats.forEach((ei, i) => {
    if (ei < 0) return;
    const e = cup.entrants[ei];
    e.games++;
    e.points += pointsFor(places[i], cup.pod);
    if (places[i] === 1) e.wins++;
  });
  if (cup.mode === 'elim') {
    // (the best-placed entrant goes on; when an AI fill-in wins, the best-placed person does)
    const real = p.seats.map((ei, i) => ({ ei, i })).filter(x => x.ei >= 0);
    real.sort((a, b) => places[a.i] - places[b.i] || (life[b.i] || 0) - (life[a.i] || 0));
    real.slice(1).forEach(x => { cup.entrants[x.ei].out = true; });
  }
  if (cup.pods.every(q => q.places)) {
    cup.history.push({ round: cup.round, pods: cup.pods.map(q => ({ seats: q.seats, places: q.places })) });
    const alive = cup.entrants.filter(e => !e.out);
    if ((cup.mode === 'swiss' && cup.round >= cup.rounds) || (cup.mode === 'elim' && alive.length <= 1)) {
      cup.done = true;
      cup.champion = cup.entrants.indexOf(standings(cup)[0]);
    }
  }
  return cup;
}

export const roundDone = cup => cup.pods.length > 0 && cup.pods.every(p => p.places);

// Standings: still in (elimination), then points, then wins, then fewer games
export function standings(cup) {
  return [...cup.entrants].sort((a, b) => Number(a.out) - Number(b.out) || b.points - a.points || b.wins - a.wins || a.games - b.games);
}

// The standings as plain text, to paste into a chat
export function standingsText(cup) {
  const head = `${cup.mode === 'elim' ? 'Single elimination' : `Swiss, ${cup.rounds} rounds`} · round ${cup.round}${cup.done ? ' (final)' : ''}`;
  return [head, ...standings(cup).map((e, i) => `${i + 1}. ${e.name}: ${e.points} pts, ${e.wins} win${e.wins === 1 ? '' : 's'} in ${e.games}${e.out ? ' (out)' : ''}`)].join('\n');
}
