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

// A short pause for the page (a message to ourselves runs sooner than setTimeout's 4 ms floor); not in Node or workers
const YIELD = typeof window !== 'undefined' && typeof MessageChannel === 'function';
const yieldToPage = () => new Promise(res => { const ch = new MessageChannel(); ch.port1.onmessage = () => res(undefined); ch.port2.postMessage(0); });
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
  const SKIP = new Set(['clock', 'handlers', 'logEntries', 'rand', 'comboLog', 'chat', 'format', 'puzzle', 'comboBook']);
  // (functions put on the game object itself, like the self-test's rules watcher, act on the real game: the copy
  // keeps the plain engine methods instead)
  for (const k of Object.keys(g)) if (!SKIP.has(k) && typeof g[k] !== 'function') ng[k] = cp(g[k]);
  // (players' deck lists and combo definitions never change: copied by reference above via shared card defs)
  Object.assign(ng, {
    format: g.format, puzzle: g.puzzle, comboBook: g.comboBook, handlers: {}, logEntries: [], comboLog: [], explain: false, sim: true,
    rand: makeRng(seed), steps: 0,
    // (in a page, every 25 simulated steps hand the browser a moment so the table stays smooth while the AI thinks,
    // item 169; the steps and the result are the same either way)
    clock: { beat: async () => { if (ng.steps > budget) throw new OverBudget(); if (YIELD && ng.steps % 25 === 0) await yieldToPage(); } },
  });
  ng.log = () => {};
  // (Two-Headed Giant: the copied teammates share their life again)
  if (g.teams) ng.linkTeams();
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

// The look-ahead budget for a decision. Item 103 tried more in duels and late game (600 steps, 5–6 decisions a turn)
// and less at cEDH tables (300, 2): 80-game duels came out identical (39–41 for every variant against 400/3) and 16
// cEDH-preset games differed in one game, 4% faster. Since budget size made no measurable difference, every table
// keeps the tuned defaults; agent.budget overrides them for tuning runs (tools/tune.mjs).
export function budgetFor(agent, g) {
  if (agent.budget) return agent.budget;
  return { steps: LOOKAHEAD.steps, perTurn: LOOKAHEAD.perTurn };
}
async function simulate(agent, g, p, phase, key, seed, oppIdx) {
  const ng = cloneGame(g, seed, budgetFor(agent, g).steps);
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
export const laStats = { decisions: 0, sims: 0, changed: 0, dropped: 0, errors: 0, steps: 0, lastError: '', eot: 0, eotHeld: 0 };

// The pilot's pick for this main-phase decision, checked by look-ahead
export async function lookAheadPlay(agent, g, p, phase) {
  const best = agent.bestPlay(g, p, phase);
  if (!best || !best.opts || g.sim || g.kingdoms || g.puzzle || agent.noise > 0.05) return best;
  if (agent.laTurn !== g.turn) { agent.laTurn = g.turn; agent.laCount = 0; }
  if (agent.laCount >= budgetFor(agent, g).perTurn) return best;
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

// ---------- instant speed: counter or let it resolve (item 101)
// When a pilot with look-ahead could counter a spell, both answers are tried on a copy of the game: the counterspell
// (with everyone's chance to fight back) or the spell resolving, then the rest of the active player's turn and each
// opponent's next combat. The usual answer stays unless the other one scores better by the same margin as main-phase
// look-ahead. A combo piece is always countered; counter wars and abilities keep the usual answer.
// (the spell resolving is played on the copy by casting it again without paying, from its caster's hand)
async function simulateRespond(agent, g, q, item, counter, seed, oppIdx) {
  const ng = cloneGame(g, seed, budgetFor(agent, g).steps);
  determinize(ng, q.idx, ng.rand);
  const at = g.stack.indexOf(item);
  const ci = ng.stack[at];
  const cq = ng.players[q.idx];
  if (!ci || !cq) return null;
  const caster = ci.p;
  if (counter) {
    const card = cq.hand.find(o => o.iid === counter.card.iid);
    if (!card) return null;
    // (the response's targets on the copy: the spell, a permanent by id, or a player)
    const tgt = t => (!t ? null : t.spell ? { spell: t.spell === item ? ci : ng.stack[g.stack.indexOf(t.spell)] } : t.obj ? { obj: ng.objects.get(t.obj.iid) } : { ...t });
    const targets = (counter.targets || []).map(tgt);
    if (targets.some((t, k) => counter.targets[k] && (!t || (t.spell === undefined && t.obj === undefined && t.player == null)))) return null;
    await ng.doResponse(cq, { kind: 'cast', card, targets }, ci);
  }
  ng.stack.splice(ng.stack.indexOf(ci), 1);
  if (ci.countered) ng.move(ci.o, 'graveyard');
  else if (!ng.over) {
    // (the copy's pilot for q lets it through this time)
    ng.laHold = { q: q.idx, iid: ci.o.iid };
    ci.o.zone = 'hand';
    caster.hand.push(ci.o);
    await ng.cast(caster, ci.o, { mode: { alt: 'free' }, targets: ci.targets, x: ci.x, response: ci.response });
    ng.laHold = null;
  }
  // The rest of the active player's turn, then each opponent's next combat (as for main-phase look-ahead)
  const ap = ng.players[ng.active];
  const phase = ng.phase;
  if (!ng.over && !cq.lost && ap && !ap.lost && !ng.stack.length) {
    if ((phase === 'main1' || phase === 'main2') && ap.agent) await ap.agent.mainPhase(ng, ap, phase);
    if (!ng.over && !ap.lost) {
      if (phase === 'main1') await ng.restOfTurn(ap);
      else if (phase === 'main2') await ng.endSteps(ap);
    }
  }
  for (const r of ng.order(ng.active)) {
    if (ng.over || cq.lost) break;
    if (r.idx === ng.active || r.lost || r === cq) continue;
    ng.turn++;
    ng.active = r.idx;
    for (const o of r.battlefield) { o.tapped = false; o.sick = false; }
    await ng.combat(r);
  }
  return { score: positionScore(cq.agent, ng, cq, oppIdx), steps: ng.steps };
}

export async function lookAheadRespond(agent, g, q, item, isCounter) {
  const usual = agent.respond(g, q, item);
  if (g.sim || g.kingdoms || g.puzzle || agent.noise > 0.05 || item.ability || item.loopStart || item.countered) return usual;
  // (any spell cast in response — removal, protection — is checked against letting the spell resolve; a counterspell
  // also when the usual answer is to let it through)
  if (usual && usual.kind !== 'cast') return usual;
  const other = !!usual && !isCounter(usual.card);
  if (!usual && (item.p === q || item.targets.some(t => t?.spell))) return null;
  if (!other && (item.o.fx.uncounterable || item.uncounterable || agent.comboSpell(g, item))) return usual;
  const usable = other ? [] : q.hand.filter(o => isCounter(o) && g.canCast(q, o) && agent.counterUsable(g, q, o, item)).sort((a, b) => (a.card.cmc || 0) - (b.card.cmc || 0));
  if (!other && !usable.length) return usual;
  if (other && (item.loopStart || item.combo)) return usual;
  if (agent.laTurn !== g.turn) { agent.laTurn = g.turn; agent.laCount = 0; }
  if (agent.laCount >= budgetFor(agent, g).perTurn) return usual;
  agent.laCount++;
  laStats.decisions++;
  const counter = usual || { kind: 'cast', card: usable[0], targets: usable[0].fx.spell.map(e => (e.k === 'counter' ? { spell: item } : null)) };
  const seed = (Math.imul(g.seed ^ 0x7f4a7c15, 31) + g.steps * 977 + g.turn * 131 + q.idx) >>> 0;
  const oppIdx = g.opponents(q).map(r => r.idx);
  const res = [];
  for (const c of [usual, usual ? null : counter]) {
    try {
      laStats.sims++;
      const r = await simulateRespond(agent, g, q, item, c, seed, oppIdx);
      if (!r) { laStats.dropped++; return usual; }
      laStats.steps += r.steps;
      res.push(r.score);
    } catch (e) {
      if (e.name === 'OverBudget') laStats.dropped++;
      else { laStats.errors++; laStats.lastError = `${e.message} ${(e.stack || '').split('\n')[1] || ''}`; }
      return usual;
    }
  }
  if (res[1] < res[0] + LOOKAHEAD.margin) return usual;
  laStats.changed++;
  if (usual) {
    agent.explain(g, q, `looks ahead: letting ${item.o.card.name} resolve leaves a better position (${res[1].toFixed(1)}) than ${other ? `responding with ${usual.card.card.name}` : 'countering it'} (${res[0].toFixed(1)})`);
    return null;
  }
  agent.explain(g, q, `looks ahead: countering ${item.o.card.name} leaves a better position (${res[1].toFixed(1)}) than letting it resolve (${res[0].toFixed(1)})`);
  return counter;
}

// ---------- attacks (item 102)
// A look-ahead pilot's attack is checked by whole-turn rollouts: the combat planner's attack, no attack, and every
// ready creature at the opponent with the least life are each played on a copy of the game (the combat again from the
// start, the second main phase, the end step), then each opponent plays a whole turn of their own. The planner's
// attack stays unless another scores better by item 83's margin. Shares the decisions-a-turn budget.
async function simulateAttack(agent, g, p, plan, seed, oppIdx) {
  const ng = cloneGame(g, seed, budgetFor(agent, g).steps * 2);
  determinize(ng, p.idx, ng.rand);
  const cp = ng.players[p.idx];
  cp.agent.forcedAttacks = plan;
  await ng.combat(cp);
  cp.agent.forcedAttacks = null;
  if (!ng.over && !cp.lost) {
    ng.setPhase('main2');
    await cp.agent.mainPhase(ng, cp, 'main2');
    if (!ng.over && !cp.lost) await ng.endSteps(cp);
  }
  for (const q of ng.order(p.idx)) {
    if (ng.over || cp.lost) break;
    if (q === cp || q.lost) continue;
    ng.active = q.idx;
    await ng.takeTurn(q);
  }
  return { score: positionScore(cp.agent, ng, cp, oppIdx), steps: ng.steps };
}
export async function lookAheadAttacks(agent, g, p, usual) {
  if (g.sim || g.kingdoms || g.puzzle || agent.noise > 0.05 || g.stack.length) return usual;
  const ready = p.battlefield.filter(o => g.canAttack(o) && g.power(o) > 0);
  const opps = g.opponents(p);
  if (!ready.length || !opps.length) return usual;
  if (agent.laTurn !== g.turn) { agent.laTurn = g.turn; agent.laCount = 0; }
  if (agent.laCount >= budgetFor(agent, g).perTurn) return usual;
  const key = plan => plan.map(x => `${x.o.iid}>${x.target}`).sort().join(',');
  const low = [...opps].sort((a, b) => a.life - b.life)[0];
  const cands = [usual, [], ready.map(o => ({ o, target: low.idx }))];
  const seen = new Set();
  const plans = cands.filter(c => { const k = key(c); if (seen.has(k)) return false; seen.add(k); return true; });
  if (plans.length < 2) return usual;
  agent.laCount++;
  laStats.decisions++;
  const seed = (Math.imul(g.seed ^ 0x2545f491, 31) + g.steps * 977 + g.turn * 131 + p.idx) >>> 0;
  const oppIdx = opps.map(q => q.idx);
  const res = [];
  for (const plan of plans) {
    try {
      laStats.sims++;
      const r = await simulateAttack(agent, g, p, plan.map(x => ({ iid: x.o.iid, target: x.target, obj: x.obj?.iid })), seed, oppIdx);
      laStats.steps += r.steps;
      res.push({ plan, score: r.score });
    } catch (e) {
      if (e.name === 'OverBudget') laStats.dropped++;
      else { laStats.errors++; laStats.lastError = `${e.message} ${(e.stack || '').split('\n')[1] || ''}`; }
      return usual;
    }
  }
  const base = res[0];
  const top = res.reduce((a, b) => (b.score > a.score ? b : a));
  if (top === base || top.score < base.score + LOOKAHEAD.margin) return usual;
  laStats.changed++;
  const what = top.plan.length ? `attacking ${g.players[top.plan[0].target].name} with everything` : 'not attacking';
  agent.explain(g, p, `looks ahead: ${what} leaves a better position after everyone's next turn (${top.score.toFixed(1)}) than the planned attack (${base.score.toFixed(1)})`);
  return top.plan;
}

// ---------- end-of-turn plays (item 101)
// Before a look-ahead pilot spends held-up mana at the end of someone else's turn, both choices are played on a copy
// of the game: casting it now, or holding the mana (for answers during the next turn, or the card for later), then the
// next player's whole turn. The usual choice (cast) stays unless holding scores better by item 83's margin.
async function simulateEot(agent, g, q, card, cast, seed, oppIdx) {
  const ng = cloneGame(g, seed, budgetFor(agent, g).steps * 2);
  determinize(ng, q.idx, ng.rand);
  const cq = ng.players[q.idx];
  if (cast) {
    const c = cq.hand.find(o => o.iid === card.iid) || [...cq.exile, ...cq.graveyard, ...cq.command].find(o => o.iid === card.iid);
    if (!c) return null;
    await ng.cast(cq, c);
  }
  if (!ng.over && !cq.lost) {
    const next = ng.players[ng.nextAlive(ng.active)];
    ng.active = next.idx;
    await ng.takeTurn(next);
  }
  return { score: positionScore(cq.agent, ng, cq, oppIdx), steps: ng.steps };
}
export async function lookAheadEot(agent, g, q, card) {
  if (g.sim || g.kingdoms || g.puzzle || agent.noise > 0.05 || g.stack.length) return true;
  if (agent.laTurn !== g.turn) { agent.laTurn = g.turn; agent.laCount = 0; }
  if (agent.laCount >= budgetFor(agent, g).perTurn) return true;
  agent.laCount++;
  laStats.decisions++;
  laStats.eot++;
  const seed = (Math.imul(g.seed ^ 0x6c8e9cf5, 31) + g.steps * 977 + g.turn * 131 + q.idx) >>> 0;
  const oppIdx = g.opponents(q).map(r => r.idx);
  const res = [];
  for (const cast of [true, false]) {
    try {
      laStats.sims++;
      const r = await simulateEot(agent, g, q, card, cast, seed, oppIdx);
      if (!r) { laStats.dropped++; return true; }
      laStats.steps += r.steps;
      res.push(r.score);
    } catch (e) {
      if (e.name === 'OverBudget') laStats.dropped++;
      else { laStats.errors++; laStats.lastError = `${e.message} ${(e.stack || '').split('\n')[1] || ''}`; }
      return true;
    }
  }
  if (res[1] < res[0] + LOOKAHEAD.margin) return true;
  laStats.changed++;
  laStats.eotHeld++;
  agent.explain(g, q, `looks ahead: holding ${card.card.name} and the mana through the next turn leaves a better position (${res[1].toFixed(1)}) than casting it now (${res[0].toFixed(1)})`);
  return false;
}
