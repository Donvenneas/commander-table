// Look-ahead for main-phase decisions (Round 4, item 83).
// For the AI's best few candidate plays, each one is tried on a copy of the game: the play, the rest of the
// main phase (the pilot's usual choices), the rest of the turn (combat, main 2, end step, opponents' end-of-turn
// plays) and then each opponent's next combat. The play whose result scores best is chosen.
//  • The copy is a deep copy of the game state; card definitions are shared (they never change).
//  • Hidden information is guessed, not read: every library is shuffled, and each opponent's hand is redealt from
//    their hand and library together, using a random number stream forked from the game's seed (never Math.random),
//    so the same seed always gives the same game.
//  • Each simulation has a step budget (engine beats): a copy that runs over it is dropped and the pilot keeps its
//    usual pick. The budget counts simulated steps, not milliseconds, so the result never depends on the computer.
import { Agent } from './ai.js';
import { keyValue } from './combatai.js';
import { makeRng, shuffle } from './util.js';

// Tuning (head-to-head runs; see ROADMAP item 83)
export const LOOKAHEAD = {
  cands: 3,        // candidate plays simulated per decision
  steps: 400,      // engine beats one simulation may take
  perTurn: 3,      // decisions per turn that look ahead
  margin: 1.5,     // how much better (position score) an alternative must be to replace the usual pick
  sameSkip: true,
  samples: 1,      // guesses at the hidden cards per candidate
  pass: false,     // also try stopping here (casting the rest after combat, or holding it)
  oppTurns: false, // play the opponents' whole next turns, not just their combats  // ignore alternatives that only change the order of the same plays
};

class OverBudget extends Error { constructor() { super('look-ahead budget'); this.name = 'OverBudget'; } }

// ---------- copying a game
export function cloneGame(g, seed, budget = LOOKAHEAD.steps) {
  const shared = new Set();
  for (const o of g.objects.values()) { shared.add(o.card); shared.add(o.card.fx); shared.add(o.fx); if (o.baseCard) { shared.add(o.baseCard); shared.add(o.baseCard.fx); } }
  const ng = Object.create(Object.getPrototypeOf(g));
  const map = new Map([[g, ng]]);
  const cp = x => {
    if (x === null || typeof x !== 'object') return x;
    if (shared.has(x)) return x;
    const m = map.get(x);
    if (m) return m;
    if (x instanceof Map) { const r = new Map(); map.set(x, r); for (const [k, v] of x) r.set(cp(k), cp(v)); return r; }
    if (x instanceof Set) { const r = new Set(); map.set(x, r); for (const v of x) r.add(cp(v)); return r; }
    if (Array.isArray(x)) { const r = new Array(x.length); map.set(x, r); for (let i = 0; i < x.length; i++) r[i] = cp(x[i]); return r; }
    if (x instanceof Agent) return simAgent(x, map);
    const r = Object.create(Object.getPrototypeOf(x));
    map.set(x, r);
    for (const k of Object.keys(x)) r[k] = cp(x[k]);
    // Game objects know their owner and game (non-enumerable)
    if (Object.prototype.hasOwnProperty.call(x, 'ownerP')) {
      Object.defineProperty(r, 'ownerP', { value: cp(x.ownerP), enumerable: false });
      Object.defineProperty(r, 'game', { value: ng, enumerable: false });
    }
    return r;
  };
  const SKIP = new Set(['clock', 'handlers', 'logEntries', 'rand', 'comboLog', 'chat', 'format', 'puzzle']);
  for (const k of Object.keys(g)) if (!SKIP.has(k)) ng[k] = cp(g[k]);
  // (players' deck lists and combo definitions never change: copied by reference above via shared card defs)
  Object.assign(ng, {
    format: g.format, puzzle: g.puzzle, handlers: {}, logEntries: [], comboLog: [], explain: false, sim: true,
    rand: makeRng(seed), steps: 0,
    clock: { beat: async () => { if (ng.steps > budget) throw new OverBudget(); } },
  });
  ng.log = () => {};
  return ng;
}

// The copy's pilots: the same settings, no look-ahead of their own, and the AI for human and online seats
function simAgent(a, map) {
  let r;
  if (Object.getPrototypeOf(a) === Agent.prototype) r = Object.assign(Object.create(Agent.prototype), a);
  else { r = new Agent(a.style); r.learned = a.learned; }
  r.lookahead = false;
  map.set(a, r);
  return r;
}

// Hidden information: shuffle every library, and redeal each opponent's hand from their hand and library
function determinize(ng, me, rand) {
  for (const q of ng.players) {
    if (q.lost) continue;
    if (q.idx === me) { shuffle(q.library, rand); continue; }
    const n = q.hand.length;
    const pool = [...q.hand, ...q.library];
    shuffle(pool, rand);
    q.hand = pool.slice(0, n);
    q.library = pool.slice(n);
    for (const o of q.hand) o.zone = 'hand';
    for (const o of q.library) o.zone = 'library';
  }
}

// ---------- scoring a position (from p's side)
const lifeVal = l => (l <= 0 ? -40 : 14 * Math.log1p(l));
function sideScore(agent, g, q) {
  if (q.lost) return -250;
  let s = lifeVal(q.life) - q.poison * 3;
  const cmd = Math.max(0, ...Object.values(q.cmdDamage || {}));
  if (cmd > 10) s -= (cmd - 10) * 1.5;
  for (const o of q.battlefield) s += o.fx.type.land ? 1.5 : keyValue(agent, g, o);
  s += q.hand.length * 1.5;
  return s;
}
// (opps: the seats that were opponents when the decision was made)
export function positionScore(agent, g, p, opps = g.opponents(p).map(q => q.idx)) {
  if (p.lost || (g.over && g.winner && g.winner !== p && !(g.winners || []).includes(p))) return -1000;
  if (g.over && (g.winner === p || (g.winners || []).includes(p))) return 1000;
  opps = opps.map(i => g.players[i]);
  if (!opps.length) return sideScore(agent, g, p);
  const os = opps.map(q => sideScore(agent, g, q));
  return sideScore(agent, g, p) - (os.reduce((a, b) => a + b, 0) / os.length * 0.6 + Math.max(...os) * 0.4);
}

// ---------- simulating one candidate
const keysOf = opts => {
  const seen = new Map();
  return opts.map(o => { const w = o.why || '?'; const k = seen.get(w) || 0; seen.set(w, k + 1); return `${w}#${k}`; });
};

async function simulate(agent, g, p, phase, key, seed, oppIdx) {
  const ng = cloneGame(g, seed);
  determinize(ng, p.idx, ng.rand);
  const cp = ng.players[p.idx];
  const ca = cp.agent;
  const first = ca.bestPlay(ng, cp, phase);
  const opts = first?.opts;
  if (!opts) return null;
  const ks = keysOf(opts);
  const opt = key === PASS.k ? PASS.o : opts[ks.indexOf(key)];
  if (!opt) return null;
  const ok = await opt.run();
  if (ok && !ng.over && !cp.lost) await ca.mainPhase(ng, cp, phase);
  if (!ng.over && !cp.lost) {
    if (phase === 'main1') await ng.restOfTurn(cp);
    else await ng.endSteps(cp);
  }
  // What this turn did on our side (the same cards in the same places means only the order differed)
  const sig = ['hand', 'battlefield', 'graveyard', 'exile'].map(z => cp[z].map(o => o.iid).sort((a, b) => a - b).join(',')).join('|');
  // Each opponent's next combat (their creatures untap; their main phases are skipped)
  for (const q of ng.order(p.idx)) {
    if (ng.over || cp.lost) break;
    if (q === cp || q.lost) continue;
    if (LOOKAHEAD.oppTurns) { ng.active = q.idx; await ng.takeTurn(q); continue; }
    ng.turn++;
    ng.active = q.idx;
    for (const o of q.battlefield) { o.tapped = false; o.sick = false; }
    await ng.combat(q);
  }
  return { score: positionScore(ca, ng, cp, oppIdx), steps: ng.steps, sig };
}

// "Nothing more this phase": the rest waits for combat, main 2 or the opponents' turns
const PASS = { k: 'pass', o: { why: 'holds the rest of the hand for later', s: 0, run: async () => false } };

// Debug counters (selftest and tuning read these)
export const laStats = { decisions: 0, sims: 0, changed: 0, dropped: 0, errors: 0, steps: 0, lastError: '' };

// The pilot's pick for this main-phase decision, checked by look-ahead
export async function lookAheadPlay(agent, g, p, phase) {
  const best = agent.bestPlay(g, p, phase);
  if (!best || !best.opts || g.sim || g.kingdoms || g.puzzle || agent.noise > 0.05) return best;
  if (agent.laTurn !== g.turn) { agent.laTurn = g.turn; agent.laCount = 0; }
  if (agent.laCount >= LOOKAHEAD.perTurn) return best;
  const ks = keysOf(best.opts);
  const order = best.opts.map((o, i) => ({ o, k: ks[i] })).filter(x => x.o !== best).sort((a, b) => b.o.s - a.o.s);
  const cands = [{ o: best, k: ks[best.opts.indexOf(best)] }, ...order].filter(x => x.o.why).slice(0, LOOKAHEAD.cands);
  if (LOOKAHEAD.pass) cands.push(PASS);
  if (cands.length < 2 || cands[0].o !== best) return best;
  agent.laCount++;
  laStats.decisions++;
  // One random stream for every candidate (the same guessed hands and draws), forked from the game's seed
  const seed = (Math.imul(g.seed ^ 0x9e3779b9, 31) + g.steps * 977 + g.turn * 131 + p.idx) >>> 0;
  const oppIdx = g.opponents(p).map(q => q.idx);
  const res = [];
  for (const c of cands) {
    try {
      let score = 0, sig = '';
      // (several guesses at the hidden cards, each with its own random stream, averaged)
      for (let k = 0; k < LOOKAHEAD.samples; k++) {
        laStats.sims++;
        const r = await simulate(agent, g, p, phase, c.k, (seed + k * 0x51ed27) >>> 0, oppIdx);
        if (!r) { laStats.dropped++; return best; }
        laStats.steps += r.steps;
        score += r.score / LOOKAHEAD.samples;
        sig += `${r.sig}/`;
      }
      res.push({ ...c, score, sig });
    } catch (e) {
      if (e.name === 'OverBudget') laStats.dropped++;
      else { laStats.errors++; laStats.lastError = `${e.message} ${(e.stack || '').split('\n')[1] || ''}`; }
      return best;
    }
  }
  const base = res[0];
  // (an alternative that ends the turn with the same cards in the same places is only a different order: keep ours)
  const top = res.filter(r => r === base || !LOOKAHEAD.sameSkip || r.sig !== base.sig).reduce((a, b) => (b.score > a.score ? b : a));
  if (top === base || top.score < base.score + LOOKAHEAD.margin) return best;
  laStats.changed++;
  const run = top.o.run;
  return {
    ...top.o,
    run: () => {
      agent.explain(g, p, `looks ahead: ${top.o.why} leaves a better position after the turn and the next attacks (${top.score.toFixed(1)}) than ${base.o.why} (${base.score.toFixed(1)})`);
      return run();
    },
  };
}
