// Combat (rules 506–511): attacks, blocks, combat keywords, ninjutsu and combat damage.
// Split out of engine.js (Round 5, item 176): each function is one of Game's methods, with the game as `g`; Game keeps
// a one-line method that calls it, so nothing else changes.
import * as K from './kingdomsPlay.js';
import { parseCost } from './engine.js';

/** @param {import('./engine.js').Game} g */
export async function combat(g, p) {
  g.setPhase('combat');
  g.fire('begCombat', { p: p.idx });
  if (g.queue.length) { await g.sba(); if (g.over || p.lost) return; }
  await g.stopFor('combat', p);
  if (g.over || p.lost) return;
  // Kingdoms: the Knight in Shining Armor made this player skip their next combat
  if (p.skipCombat) { p.skipCombat = false; g.log(`${g.pn(p)} skips this combat`, { kind: 'minor', rule: 'Kingdoms' }); return; }
  let decl = (await p.agent.declareAttackers(g, p)).filter(d => g.canAttack(d.o) && d.target !== p.idx && !g.players[d.target].lost && (!g.kingdoms || !K.teammates(p, g.players[d.target])) && !(g.teams && g.players[d.target].team === p.team));
  // (an attack on a battle or planeswalker is an attack on its protector or controller: d.obj is the permanent)
  for (const d of decl) if (d.obj && !g.attackable(p, d.obj)) d.obj = null;
  if (g.rules >= 5 && p.agent.battleAttacks) p.agent.battleAttacks(g, p, decl);
  // Goad (701.15): a goaded creature attacks each combat if able, and attacks someone other than the goader
  for (const o of p.battlefield) {
    if (!o.goaded || o.goaded.until < g.turn || !g.canAttack(o)) continue;
    const d = decl.find(x => x.o === o);
    const others = g.opponents(p).filter(q => q.idx !== o.goaded.by);
    if (d && d.target === o.goaded.by && others.length) d.target = others.sort((a, b) => a.life - b.life)[0].idx;
    if (!d) decl.push({ o, target: (others.length ? others : g.opponents(p)).sort((a, b) => a.life - b.life)[0].idx });
  }
  // "Attacks each combat if able" (Toski, Juggernaut)
  for (const o of p.battlefield) if ((o.fx.mustAttack || (o.fx.condBuff?.mustAttack && g.condBuff(o))) && g.canAttack(o) && !decl.some(x => x.o === o) && g.opponents(p).length) {
    decl.push({ o, target: p.agent.weakestOpponent(g, p).idx });
  }
  // Kingdoms, the Straw Man: every creature able to attack them does (until their next turn)
  const straw = g.strawMan && g.players[g.strawMan.idx];
  if (straw && !straw.lost && straw.idx !== p.idx) {
    for (const o of p.battlefield) if (o.fx.type.creature && g.canAttack(o)) {
      const d = decl.find(x => x.o === o);
      if (d) { d.target = straw.idx; d.obj = null; } else decl.push({ o, target: straw.idx });
    }
  }
  // Propaganda-style taxes: each attacker costs mana, and any that can't be paid for stay home
  for (const t of new Set(decl.map(d => d.target))) {
    const tax = g.players[t].battlefield.reduce((s, o) => s + (o.fx.attackTax || 0) + (o.fx.attackTaxDyn ? g.countControlled(g.players[t], o.fx.attackTaxDyn) : 0), 0);
    if (!tax) continue;
    const mine = decl.filter(d => d.target === t).sort((a, b) => g.power(b.o) - g.power(a.o));
    let paid = 0;
    for (; paid < mine.length; paid++) {
      const plan = g.planPayment(p, { generic: tax, pips: [], x: 0 });
      if (!plan) break;
      g.commitPayment(p, plan);
    }
    if (paid < mine.length) decl = decl.filter(d => !mine.slice(paid).includes(d));
    g.log(`${g.pn(p)} pays {${tax * paid}} to attack ${g.pn(g.players[t])}${paid < mine.length ? ` and holds ${mine.length - paid} back` : ''}`, { kind: 'minor' });
  }
  // Silent Arbiter: no more than one creature can attack each combat (Mirri: you); the strongest go
  // Sandwurm Convergence: flyers can't attack its controller
  decl = decl.filter(d => !(g.has(d.o, 'flying') && g.players[d.target]?.battlefield.some(s => s.fx.noFlyAttack)));
  if (g.alive().some(q => q.battlefield.some(o => o.fx.attackCap))) decl = decl.sort((a, b) => g.power(b.o) - g.power(a.o)).slice(0, 1);
  for (const q of g.alive()) {
    const cap = q.battlefield.filter(o => o.fx.attackMeCap && (!o.fx.attackMeCap.tapped || o.tapped)).map(o => o.fx.attackMeCap.n);
    if (!cap.length) continue;
    const at = decl.filter(d => d.target === q.idx).sort((a, b) => g.power(b.o) - g.power(a.o)).slice(0, Math.min(...cap));
    decl = decl.filter(d => d.target !== q.idx || at.includes(d));
  }
  if (!decl.length) { await g.beat(0.3); return; }
  for (const d of decl) {
    Object.assign(d.o, { attacking: d.target, attackingObj: d.obj || null, blockedBy: [], blocked: false });
    if (!g.has(d.o, 'vigilance')) { d.o.tapped = true; g.fire('tapped', { o: d.o, p: p.idx }); }
  }
  const byTarget = new Map();
  for (const d of decl) byTarget.set(d.target, [...(byTarget.get(d.target) || []), d.o]);
  for (const [t, os] of byTarget) g.log(`${g.pn(p)} attacks ${g.pn(g.players[t])} with ${os.map(o => g.cn(o)).join(', ')}`, { kind: 'combat', rule: '508.1' });
  for (const t of byTarget.keys()) if (g.dealBetween(p.idx, t)) g.breakDeal(p, g.players[t]);
  for (const d of decl) if (d.obj) g.log(`${g.cn(d.o)} attacks ${g.cn(d.obj)}`, { kind: 'combat', rule: '506.3' });
  await g.beat(1.4);
  p.attackedTurn = g.turn;
  g.attackKeywords(p, decl);
  if (g.rules >= 5) await g.enlist(p, decl);
  for (const d of decl) {
    g.trigger(d.o, 'attack');
    g.fire('allyAttacks', { o: d.o, p: p.idx });
    g.fire('attachedAttacks', { o: d.o, p: p.idx });
  }
  g.fire('youAttack', { p: p.idx, n: decl.length, os: decl.map(d => d.o) });
  await g.sba();
  if (g.over) return;
  const attackers = () => p.battlefield.filter(o => o.attacking != null);

  for (const q of g.order(p.idx)) {
    if (q === p || q.lost) continue;
    let mine = attackers().filter(a => a.attacking === q.idx);
    if (!mine.length) continue;
    const r = await q.agent.combatResponse(g, q, mine);
    if (r) { await g.cast(q, r.card, { targets: r.targets }); if (g.over) return; mine = attackers().filter(a => a.attacking === q.idx); }
    const used = new Set();
    // Silent Arbiter: no more than one creature can block each combat
    const cap = g.alive().some(x => x.battlefield.some(o => o.fx.blockCap)) ? 1 : Infinity;
    for (const { b, a } of await q.agent.declareBlockers(g, q, mine)) {
      if (used.has(b) || !mine.includes(a) || !g.canBlock(b, a)) continue;
      if (g.alive().reduce((s, x) => s + x.battlefield.filter(o => o.blocking != null).length, 0) >= cap) break;
      used.add(b); b.blocking = a.iid; a.blockedBy.push(b);
      // (item 109: a chump block — the blocker dies and the attacker lives)
      if (q.tells && !g.sim) { q.tells.blocks++; if (g.toughness(b) - b.damage <= g.power(a) && g.power(b) < g.toughness(a) - a.damage) q.tells.chumps++; }
    }
    // Two-Headed Giant: the defender's teammate blocks too, among the attackers still unblocked (810.7)
    const mate = g.teammate(q);
    const free = mate ? mine.filter(a => !a.blockedBy.length) : [];
    if (mate && free.length && mate.battlefield.some(o => o.fx.type.creature && !o.tapped)) {
      for (const { b, a } of await mate.agent.declareBlockers(g, mate, free)) {
        if (used.has(b) || b.controller !== mate.idx || !free.includes(a) || !g.canBlock(b, a)) continue;
        if (g.alive().reduce((s, x) => s + x.battlefield.filter(o => o.blocking != null).length, 0) >= cap) break;
        used.add(b); b.blocking = a.iid; a.blockedBy.push(b);
      }
    }
    if (q.tells && !g.sim && q.battlefield.some(o => o.fx.type.creature && !o.tapped)) q.tells.faced++;
    for (const a of mine) {
      if (g.has(a, 'menace') && a.blockedBy.length === 1) { a.blockedBy[0].blocking = null; a.blockedBy = []; }
      a.blocked = a.blockedBy.length > 0;
    }
    const lines = mine.filter(a => a.blocked).map(a => `${a.blockedBy.map(b => g.cn(b)).join(' + ')} blocks ${g.cn(a)}`);
    g.log(lines.length ? `${g.pn(q)}: ${lines.join('; ')}` : `${g.pn(q)} declares no blockers`, { kind: 'combat', rule: '509.1' });
    g.blockKeywords(q, mine);
  }
  await g.sba();
  if (g.over) return;
  // Ninjutsu (702.49): swap an unblocked attacker for a ninja from hand
  if (!p.agent.human) {
    const swap = p.agent.ninjutsu?.(g, p, attackers().filter(a => !a.blocked));
    if (swap) await g.ninjutsu(p, swap.ninja, swap.out);
  }
  // The table shows a battle preview of every attacker, its blockers and the expected result
  g.emit('battle', { p, attackers: attackers() });
  await g.beat(1.6);
  // Priority after blockers: attacker first, then each defender, may cast a combat trick
  for (const q of g.order(p.idx)) {
    if (q.lost || g.over) continue;
    const r = await q.agent.combatTrick(g, q, p);
    if (r) await g.cast(q, r.card, { targets: r.targets });
  }
  if (g.over) return;
  const participants = () => [...attackers(), ...g.players.flatMap(q => q.battlefield.filter(o => o.blocking != null))];
  const fsStep = participants().some(o => g.has(o, 'first strike') || g.has(o, 'double strike'));
  if (fsStep) { await g.combatDamage(p, true, true); await g.sba(); if (g.over) return; }
  await g.combatDamage(p, false, fsStep);
  await g.sba();
  // Decayed (702.147): sacrificed at end of combat after it attacked
  for (const o of attackers()) if (g.has(o, 'decayed')) g.sacrifice(p, o, ' (decayed)');
  for (const q of g.players) for (const o of q.battlefield) Object.assign(o, { attacking: null, blocking: null, blockedBy: [], blocked: false });
  await g.sba();
}
// Attack keywords: exalted, battle cry, annihilator, melee, dethrone, training, mentor
/** @param {import('./engine.js').Game} g */
export function attackKeywords(g, p, decl) {
  const atk = decl.map(d => d.o);
  if (atk.length === 1) {
    const ex = p.battlefield.filter(o => o.fx.kw.has('exalted')).length;
    if (ex) { atk[0].tempP += ex; atk[0].tempT += ex; g.log(`${g.cn(atk[0])} attacks alone: +${ex}/+${ex} (exalted)`, { kind: 'minor', rule: '702.83a' }); }
  }
  const targets = new Set(decl.map(d => d.target));
  for (const d of decl) {
    const o = d.o, q = g.players[d.target];
    if (g.has(o, 'battle cry')) { for (const x of atk) if (x !== o) x.tempP++; g.log(`${g.cn(o)}: battle cry (+1/+0 to the other attackers)`, { kind: 'minor', rule: '702.91a' }); }
    const ann = o.fx.kwN?.annihilator;
    if (ann) {
      const perms = q.battlefield.map(x => ({ x, v: x.fx.type.land ? 0.8 : q.agent.value(g, x) + q.agent.pieceWorth(g, q, x) })).sort((a, b) => a.v - b.v).slice(0, ann).map(y => y.x);
      for (const x of perms) g.sacrifice(q, x, ` (annihilator ${ann})`);
    }
    if (g.has(o, 'melee') && targets.size) { o.tempP += targets.size; o.tempT += targets.size; }
    if (g.has(o, 'dethrone') && g.alive().every(r => r.life <= q.life)) { o.counters++; g.log(`${g.cn(o)} attacks the player with the most life: +1/+1 counter (dethrone)`, { kind: 'minor', rule: '702.105a' }); }
    if (g.has(o, 'training') && atk.some(x => x !== o && g.power(x) > g.power(o))) { o.counters++; g.log(`${g.cn(o)} trains: +1/+1 counter`, { kind: 'minor', rule: '702.149a' }); }
    if (g.has(o, 'mentor')) {
      const pupil = atk.filter(x => x !== o && g.power(x) < g.power(o)).sort((a, b) => g.power(b) - g.power(a))[0];
      if (pupil) { pupil.counters++; g.log(`${g.cn(o)} mentors ${g.cn(pupil)}: +1/+1 counter`, { kind: 'minor', rule: '702.134a' }); }
    }
  }
}
// Block keywords: bushido, rampage, flanking, afflict, and block/blocked watchers
/** @param {import('./engine.js').Game} g */
export function blockKeywords(g, q, attackers) {
  for (const a of attackers) {
    if (!a.blocked) continue;
    const bu = a.fx.kwN?.bushido;
    if (bu) { a.tempP += bu; a.tempT += bu; }
    const ra = a.fx.kwN?.rampage;
    if (ra && a.blockedBy.length > 1) { a.tempP += ra * (a.blockedBy.length - 1); a.tempT += ra * (a.blockedBy.length - 1); }
    if (g.has(a, 'flanking')) for (const b of a.blockedBy) if (!g.has(b, 'flanking')) { b.tempP--; b.tempT--; }
    const af = a.fx.kwN?.afflict;
    if (af) { q.life -= af; g.emit('life', { p: q.idx, d: -af }); g.log(`${g.pn(q)} loses ${af} life (afflict)`, { kind: 'damage', rule: '702.130a' }); }
    g.fire('blocked', { o: a, p: a.controller });
    for (const b of a.blockedBy) {
      const bb = b.fx.kwN?.bushido;
      if (bb) { b.tempP += bb; b.tempT += bb; }
      g.fire('block', { o: b, p: q.idx });
    }
  }
}
/** @param {import('./engine.js').Game} g */
export async function ninjutsu(g, p, ninja, out) {
  const plan = g.planPayment(p, parseCost(ninja.fx.ninjutsu), 0);
  if (!plan || ninja.zone !== 'hand' || out.zone !== 'battlefield' || out.blocked) return false;
  g.commitPayment(p, plan);
  const target = out.attacking;
  g.move(out, 'hand');
  g.move(ninja, 'battlefield', { tapped: true });
  Object.assign(ninja, { attacking: target, blockedBy: [], blocked: false });
  g.log(`${g.pn(p)} returns ${g.cn(out)} to hand and ninjutsus in ${g.cn(ninja)}, attacking ${g.pn(g.players[target])}`, { kind: 'combat', rule: '702.49a' });
  g.trigger(ninja, 'etb');
  await g.sba();
  return true;
}

// A division of an attacker's combat damage: [{ obj, n } for blockers, { player: true, n } for trample-over].
// Returns it if it adds up and gives the player nothing before every blocker has lethal damage, else null.
/** @param {import('./engine.js').Game} g */
export function lethalFor(g, b, dt) { return dt ? 1 : Math.max(0, g.toughness(b) - b.damage); }
/** @param {import('./engine.js').Game} g */
export function validDamagePlan(g, plan, blockers, dmg, tr, dt) {
  if (!Array.isArray(plan) || plan.some(x => !(x.n >= 0) || (x.obj && !blockers.includes(x.obj)))) return null;
  if (plan.reduce((s, x) => s + x.n, 0) !== dmg) return null;
  const toPlayer = plan.filter(x => !x.obj).reduce((s, x) => s + x.n, 0);
  if (toPlayer && (!tr || blockers.some(b => plan.filter(x => x.obj === b).reduce((s, x) => s + x.n, 0) < g.lethalFor(b, dt)))) return null;
  return plan;
}
/** @param {import('./engine.js').Game} g */
export async function combatDamage(g, p, first, hadFirst) {
  // Fog effects
  if (g.fogTurn === g.turn && !g.noPrevent()) { if (!first) g.log('All combat damage is prevented this turn', { kind: 'combat', rule: '615.1' }); return; }
  const fs = o => g.has(o, 'first strike'), ds = o => g.has(o, 'double strike');
  const deals = o => (first ? fs(o) || ds(o) : !hadFirst || !fs(o) || ds(o));
  /** @type {any[]} */
  const evs = [];
  for (const a of p.battlefield.filter(o => o.attacking != null)) {
    const blockers = a.blockedBy.filter(b => b.zone === 'battlefield');
    if (deals(a)) {
      let dmg = g.power(a);
      const tr = g.has(a, 'trample'), dt = g.has(a, 'deathtouch');
      if (dmg > 0) {
        const def = n => (a.attackingObj?.zone === 'battlefield' ? { src: a, obj: a.attackingObj, n, attacked: true } : { src: a, player: a.attacking, n });
        if (!a.blocked) evs.push(def(dmg));
        else if (!blockers.length) { if (tr) evs.push(def(dmg)); }
        else {
          // The attacking player divides the damage among the blockers as they choose (510.1c); with trample, the
          // rest goes to the player once every blocker has been assigned lethal damage (702.19c). Rules 4: in order.
          const plan = g.rules >= 5 && (blockers.length > 1 || tr) && p.agent.assignCombatDamage
            ? g.validDamagePlan(await p.agent.assignCombatDamage(g, p, a, blockers, dmg, tr, dt), blockers, dmg, tr, dt) : null;
          if (plan) { for (const x of plan) if (x.n > 0) evs.push(x.obj ? { src: a, obj: x.obj, n: x.n } : def(x.n)); }
          else {
            blockers.forEach((b, k) => {
              if (dmg <= 0) return;
              const lethal = dt ? 1 : Math.max(0, g.toughness(b) - b.damage);
              const amt = k === blockers.length - 1 && !tr ? dmg : Math.min(dmg, lethal);
              evs.push({ src: a, obj: b, n: amt });
              dmg -= amt;
            });
            if (dmg > 0 && tr) evs.push(def(dmg));
          }
        }
      }
    }
    for (const b of blockers) if (deals(b) && g.power(b) > 0) evs.push({ src: b, obj: a, n: g.power(b) });
  }
  if (!evs.length) return;
  const toPlayer = new Map();
  let initiativeTo = null;
  // Fog Bank: no combat damage to or from it
  for (let k = evs.length - 1; k >= 0; k--) if (evs[k].src?.fx.fogBank || evs[k].obj?.fx.fogBank) evs.splice(k, 1);
  for (const ev of evs) {
    if (ev.player != null) {
      const q = g.players[ev.player];
      if (q.lost) continue;
      g.damagePlayer(q, ev.n, ev.src, true);
      // (combat damage to the player with the initiative takes it from them: 725.2)
      if (g.rules >= 5 && g.initiative === ev.player && ev.src.controller !== ev.player && initiativeTo == null) initiativeTo = ev.src.controller;
      // Ragavan and other "deals combat damage to a player" triggers
      if (ev.src.fx.combatDamage?.length) g.queue.push({ o: ev.src, effects: ev.src.fx.combatDamage, label: 'combat damage', p: g.players[ev.src.controller], trig: { o: ev.src, target: ev.player, n: ev.n } });
      const info = { o: ev.src, p: ev.src.controller, target: ev.player, n: ev.n };
      g.fire('allyCombat', info); g.fire('attachedDamage', info); g.fire('selfCombat', info);
      toPlayer.set(q, [...(toPlayer.get(q) || []), ev]);
    } else { g.damageObj(ev.obj, ev.n, ev.src); g.fire('selfCombat', { o: ev.src, p: ev.src.controller }); }
  }
  for (const [q, list] of toPlayer) {
    const total = list.reduce((s, e) => s + e.n, 0);
    const cmd = list.filter(e => e.src.isCommander).map(e => `${g.cn(e.src)} commander damage ${q.cmdDamage[e.src.iid]}/${g.format.cmdDamage || 21}`);
    g.log(`${list.map(e => g.cn(e.src)).join(', ')} deal${list.length === 1 ? 's' : ''} ${total} combat damage to ${g.pn(q)}${cmd.length ? ` (${cmd.join(', ')})` : ''}`, { kind: 'damage', rule: first ? '510.4' : '510.2' });
  }
  if (initiativeTo != null) await g.takeInitiative(g.players[initiativeTo]);
  await g.beat(1.2);
}
