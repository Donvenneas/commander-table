// Combat planning by simulation. The approach follows the open-source rules engines' AIs (Forge's
// ordered block passes and attack-aggression checks, XMage's simulate-and-search players), written
// fresh for this engine:
//  • simulate(): exactly what a set of attacks and blocks does: first and double strike, deathtouch,
//    trample, lifelink, indestructible, menace and commander damage
//  • bestBlocks(): a local search over block assignments for the defender, scored by life at risk
//    (lethal or "dead to the next attacker" counts hugely), commander damage, and what dies on each
//    side. Key cards (the commander, combo pieces, engines) are worth far more, so they don't trade or
//    chump unless the alternative is losing.
//  • bestAttacks(): attacks chosen one ply deep: every candidate attack is scored against the
//    defender's best blocks, plus the risk of the backswing on the next turns.

const has = (g, o, k) => g.has(o, k);
const P = (g, o) => Math.max(0, g.power(o));

// plan: [{ a, target, blockers: [] }] → { toPlayer: Map(seat → damage), cmd: Map(seat → highest commander
// damage total after combat), dead: Set(objects), gain: Map(seat → life gained) }
export function simulate(g, plan) {
  const dmgOn = new Map(), touched = new Set(), dead = new Set();
  const toPlayer = new Map(), cmdHit = new Map(), gain = new Map(), byAttacker = new Map();
  const firsty = o => has(g, o, 'first strike') || has(g, o, 'double strike');
  const fsAny = plan.some(x => firsty(x.a) || x.blockers.some(firsty));
  const left = (o, src) => (has(g, src, 'deathtouch') ? ((dmgOn.get(o) || 0) > 0 ? 0 : 1) : Math.max(0, g.toughness(o) - o.damage - (dmgOn.get(o) || 0)));
  for (const first of fsAny ? [true, false] : [false]) {
    const deals = o => !dead.has(o) && (!fsAny || (first ? firsty(o) : !has(g, o, 'first strike') || has(g, o, 'double strike')));
    const evs = [];
    for (const { a, target, blockers } of plan) {
      const blocked = blockers.length > 0 && !(has(g, a, 'menace') && blockers.length === 1);
      const live = blocked ? blockers.filter(b => !dead.has(b)) : [];
      if (deals(a)) {
        let d = P(g, a);
        if (!blocked) evs.push({ src: a, player: target, n: d });
        else if (!live.length) { if (has(g, a, 'trample')) evs.push({ src: a, player: target, n: d }); }
        else {
          live.forEach((b, k) => {
            if (d <= 0) return;
            const amt = k === live.length - 1 && !has(g, a, 'trample') ? d : Math.min(d, left(b, a));
            evs.push({ src: a, obj: b, n: amt });
            d -= amt;
          });
          if (d > 0 && has(g, a, 'trample')) evs.push({ src: a, player: target, n: d });
        }
      }
      for (const b of live) if (deals(b) && P(g, b) > 0) evs.push({ src: b, obj: a, n: P(g, b) });
    }
    for (const e of evs) {
      if (e.n <= 0) continue;
      if (has(g, e.src, 'lifelink')) gain.set(e.src.controller, (gain.get(e.src.controller) || 0) + e.n);
      if (e.player != null) {
        toPlayer.set(e.player, (toPlayer.get(e.player) || 0) + e.n);
        byAttacker.set(e.src, (byAttacker.get(e.src) || 0) + e.n);
        if (e.src.isCommander) {
          const q = g.players[e.player];
          const k = `${e.player}:${e.src.iid}`;
          cmdHit.set(k, (cmdHit.get(k) ?? (q.cmdDamage[e.src.iid] || 0)) + e.n);
        }
      } else {
        dmgOn.set(e.obj, (dmgOn.get(e.obj) || 0) + e.n);
        if (has(g, e.src, 'deathtouch')) touched.add(e.obj);
      }
    }
    for (const [o, n] of dmgOn) if (!dead.has(o) && !has(g, o, 'indestructible') && (n + o.damage >= g.toughness(o) || touched.has(o))) dead.add(o);
  }
  const cmd = new Map();
  for (const [k, v] of cmdHit) { const seat = +k.split(':')[0]; cmd.set(seat, Math.max(cmd.get(seat) || 0, v)); }
  return { toPlayer, cmd, dead, gain, byAttacker };
}

// What a permanent is worth to the player who controls it: key cards (commander, combo pieces, engines) far more
export function keyValue(agent, g, o) {
  const owner = g.players[o.controller];
  let v = agent.value(g, o);
  v += agent.pieceWorth(g, owner, o) * 1.25;
  if (o.isCommander) v += 4 + 2 * (owner.castCount?.[o.iid] || 0);
  if (o.fx.onCast || o.fx.onOppCast || o.fx.upkeep.length || o.fx.anthem || o.fx.manaAnthem || o.fx.manaBoost) v += 2.5;
  if (o.token) v *= 0.8;
  return v;
}

// The most a player's opponents (other than `except`) could swing at them next turn
function nextHitOn(g, q, except = null) {
  let worst = 0;
  for (const r of g.opponents(q)) {
    if (r === except) continue;
    worst = Math.max(worst, r.battlefield.filter(o => o.fx.type.creature && !has(g, o, 'defender')).reduce((s, o) => s + P(g, o), 0));
  }
  return worst;
}

// How bad losing d life is for q: steep as life gets low, enormous when it's lethal or leaves q dead to the next swing
export function lifeCost(g, q, d, nextHit = nextHitOn(g, q), k = 1) {
  if (d <= 0) return 0;
  const after = q.life - d;
  if (after <= 0) return 1000;
  let c = d * (0.3 * k + 6 / Math.max(4, after));
  if (nextHit > 0 && after <= nextHit) c += 30 * (1 - after / (nextHit + 1)) + 10;
  return c;
}
// How much a point of life weighs against creatures when blocking (tuned in head-to-head runs)
const LIFE_K = 3;
const cmdCost = total => (total >= 21 ? 1000 : total >= 14 ? (total - 13) * 3 : 0);

// ---------- blocks
function defenderScore(g, q, agent, plan, nextHit) {
  const r = simulate(g, plan);
  // Attacks on our planeswalkers (rules 5, item 105): that damage takes loyalty, not life; a walker brought to 0 is
  // lost, so blocks protect walkers worth keeping
  let walkerCost = 0, offWalkers = 0;
  if (g.rules >= 5) {
    const onWalker = new Map();
    for (const { a } of plan) {
      const w = a.attackingObj;
      if (!w || w.zone !== 'battlefield' || w.controller !== q.idx || !w.fx.type.planeswalker) continue;
      const d = r.byAttacker.get(a) || 0;
      if (!d) continue;
      onWalker.set(w, (onWalker.get(w) || 0) + d);
      offWalkers += d;
    }
    for (const [w, d] of onWalker) walkerCost += d >= (w.loyalty || 0) ? keyValue(agent, g, w) : keyValue(agent, g, w) * 0.5 * (d / Math.max(1, w.loyalty));
  }
  let s = -lifeCost(g, q, Math.max(0, (r.toPlayer.get(q.idx) || 0) - offWalkers), nextHit, agent.combatTune?.life ?? LIFE_K) - walkerCost;
  s -= cmdCost(r.cmd.get(q.idx) || 0);
  for (const o of r.dead) {
    if (o.controller === q.idx) s -= keyValue(agent, g, o);
    else s += (agent.value(g, o) + agent.comboDanger(g, o)) * 0.9;
  }
  return s;
}

export function bestBlocks(g, q, attackers, agent, { quick = false } = {}) {
  const blockers = q.battlefield.filter(o => o.fx.type.creature && !o.tapped && !has(g, o, 'cantblock'));
  const nextHit = nextHitOn(g, q, g.players[attackers[0]?.controller]);
  const assign = new Map(blockers.map(b => [b, null]));
  const plan = () => attackers.map(a => ({ a, target: q.idx, blockers: blockers.filter(b => assign.get(b) === a) }));
  let best = defenderScore(g, q, agent, plan(), nextHit);
  const tryIt = (changes) => {
    const old = changes.map(([b]) => [b, assign.get(b)]);
    for (const [b, a] of changes) assign.set(b, a);
    const s = defenderScore(g, q, agent, plan(), nextHit);
    if (s > best + 1e-6) { best = s; return true; }
    for (const [b, a] of old) assign.set(b, a);
    return false;
  };
  for (let pass = 0; pass < (quick ? 2 : 4); pass++) {
    let improved = false;
    // Move one blocker (onto an attacker, onto another, or off)
    for (const b of blockers) for (const a of [null, ...attackers]) {
      if (assign.get(b) === a || (a && !g.canBlock(b, a))) continue;
      if (tryIt([[b, a]])) improved = true;
    }
    // Gang blocks: two free blockers onto one attacker (also how menace attackers get blocked)
    if (!quick || attackers.some(a => has(g, a, 'menace'))) {
      const free = blockers.filter(b => !assign.get(b)).sort((x, y) => keyValue(agent, g, x) - keyValue(agent, g, y)).slice(0, 7);
      for (const a of attackers) for (let i = 0; i < free.length; i++) for (let j = i + 1; j < free.length; j++) {
        const [x, y] = [free[i], free[j]];
        if (assign.get(x) || assign.get(y) || !g.canBlock(x, a) || !g.canBlock(y, a)) continue;
        if (tryIt([[x, a], [y, a]])) improved = true;
      }
    }
    if (!improved) break;
  }
  return { blocks: [...assign].filter(([, a]) => a).map(([b, a]) => ({ b, a })), score: best };
}

// ---------- attacks
export function bestAttacks(g, p, agent, { style = 'balanced', noise = 0 } = {}) {
  const ready = p.battlefield.filter(o => g.canAttack(o) && P(g, o) > 0).sort((a, b) => P(g, b) - P(g, a)).slice(0, 9);
  const opps = g.opponents(p);
  if (!ready.length || !opps.length) return { attacks: [], why: '' };
  // (tuned in head-to-head runs against the rule-of-thumb pilots)
  const w = {
    aggressive: { dmg: 2.1, loss: 0.65, back: 0.45 }, balanced: { dmg: 1.6, loss: 0.85, back: 0.8 }, defensive: { dmg: 1.3, loss: 1.05, back: 1.2 },
    combo: { dmg: 1.35, loss: 1.15, back: 1 }, cedh: { dmg: 1.3, loss: 1.25, back: 0.9 },
  }[style] || { dmg: 1.6, loss: 0.85, back: 0.8 };
  Object.assign(w, agent.combatTune || {});
  // Long games push everyone to finish them
  if (g.round >= 12) { w.dmg *= 1.25; w.back *= 0.8; }
  if (g.round >= 20) { w.dmg *= 1.5; w.back *= 0.4; }
  const myOthers = p.battlefield.filter(o => o.fx.type.creature && !ready.includes(o) && !o.tapped);
  const threatOf = new Map(opps.map(q => [q, opps.reduce((s, r) => s + (r === q ? 0 : 1), 0)]));

  const evaluate = attacks => {
    let s = 0;
    const byT = new Map();
    for (const x of attacks) byT.set(x.target, [...(byT.get(x.target) || []), x.o]);
    for (const [t, group] of byT) {
      const q = g.players[t];
      const dAgent = q.agent?.value ? q.agent : agent;
      const { blocks } = bestBlocks(g, q, group, dAgent, { quick: true });
      const plan = group.map(a => ({ a, target: t, blockers: blocks.filter(x => x.a === a).map(x => x.b) }));
      const r = simulate(g, plan);
      const d = r.toPlayer.get(t) || 0;
      const pol = agent.politicalWeight(g, p, q) * (1 + (p.grudge[t] || 0) * 0.02);
      // An elimination (Kingdoms: only of someone your role wants gone; finishing off an ally is a blunder)
      if (d >= q.life || (r.cmd.get(t) || 0) >= 21) s += g.kingdoms && pol < 0.5 ? -60 : 80 + q.battlefield.length * 0.5;
      else s += w.dmg * pol * d * (0.35 + 8 / Math.max(6, q.life - d));
      if ((r.cmd.get(t) || 0) >= 14) s += w.dmg * ((r.cmd.get(t) || 0) - 13);
      for (const o of r.dead) s += o.controller === p.idx ? -w.loss * keyValue(agent, g, o) : (agent.value(g, o) + agent.comboDanger(g, o)) * 0.9;
      // Combat tricks (rules 5, item 112): a blocked attacker that only just survives is at risk when the defender has
      // two or more mana open and cards in hand (so open mana deters attacks, and holding it up means something)
      if (agent.trickFear && g.rules >= 5 && q.hand.length && g.availableMana(q) >= 2) {
        const risk = Math.min(0.35, 0.1 * q.hand.length);
        for (const x of plan) if (x.blockers.length && !r.dead.has(x.a) && g.toughness(x.a) - x.a.damage - x.blockers.reduce((a, b) => a + P(g, b), 0) <= 2) s -= w.loss * risk * keyValue(agent, g, x.a);
      }
      // Attacking a deal partner breaks the deal (and earns a grudge) unless it finishes them
      if (g.dealBetween(p.idx, t) && d < q.life) s -= 12;
    }
    // Backswing: what's left untapped at home against what the table could send next turn
    const home = { battlefield: [...myOthers, ...ready.filter(o => !attacks.some(x => x.o === o) || has(g, o, 'vigilance'))] };
    const incoming = opps.map(q => agent.estimateDamage(g, q.battlefield.filter(c => c.fx.type.creature && P(g, c) > 0 && !has(g, c, 'defender')), home));
    const backDmg = Math.max(0, ...incoming) + incoming.reduce((a, b) => a + b, 0) * 0.25;
    s -= w.back * lifeCost(g, p, Math.round(backDmg * 0.8), 0);
    if (noise) s *= 1 + noise * (g.rand() * 2 - 1) * 0.5;
    return s;
  };

  let chosen = [];
  let cur = evaluate(chosen);
  const base = cur;
  // Greedy: add the attack that helps most, until none does
  for (let k = 0; k < ready.length; k++) {
    let bestS = cur, bestC = null;
    for (const o of ready) {
      if (chosen.some(x => x.o === o)) continue;
      for (const q of opps) {
        if (!g.canAttack(o)) continue;
        const s = evaluate([...chosen, { o, target: q.idx }]);
        if (s > bestS + 0.05) { bestS = s; bestC = { o, target: q.idx }; }
      }
    }
    if (!bestC) break;
    chosen.push(bestC);
    cur = bestS;
  }
  // All-in on one player can be better than any one-at-a-time build (lethal through blockers)
  for (const q of opps) {
    const all = ready.map(o => ({ o, target: q.idx }));
    const s = evaluate(all);
    if (s > cur + 0.05) { cur = s; chosen = all; }
  }
  const why = chosen.length ? `expects ${(cur - base).toFixed(1)} value from the attack` : '';
  return { attacks: chosen, why, gain: cur - base };
}

// The predicted result of the blocks just declared (for the battle preview)
export function preview(g, attackers) {
  const plan = attackers.map(a => ({ a, target: a.attacking, blockers: a.blockedBy.filter(b => b.zone === 'battlefield') }));
  const r = simulate(g, plan);
  return plan.map(x => ({ a: x.a, target: x.target, blockers: x.blockers, dies: r.dead.has(x.a), blockersDie: x.blockers.map(b => r.dead.has(b)), damage: r.byAttacker.get(x.a) || 0 }));
}
