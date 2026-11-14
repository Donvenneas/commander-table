// Replacement effects (Phase 2F, rules 14 and later; rules 614–616). An event that is about to happen is described as
// a plain object, the replacement effects that apply to it are collected from the board, and they modify it before it
// happens. Then the engine does what the event has become.
//
//   events   move   { o, from, to, opts }          a card changing zones (zones.move)
//            draw   { p, first }                   one card drawn (zones.draw)
//            damage { q, n, src, combat }          damage about to be dealt to a player (resolve.damagePlayer)
//            tokens { p, groups: [{ kind, n, spec }] }   tokens about to be created (resolve.js token effects)
//            enter  { o, tapped }                  a permanent entering the battlefield (zones.move)
//   effect   { id, self, label, applies(ev), apply(ev), after?(g, ev) }: apply returns the modified event and must not
//            touch the game (so the order can be tried out); after does the rest once the event is final (life gained,
//            a log line). self: a self-replacement effect (the object's own "if ~ would…"), applied first (616.1a).
//
// The loop (616.1–616.5): while some effect applies that hasn't applied to this event yet (614.5: an effect gets one
// chance at an event and at whatever replaced it), the self-replacement effects go first, then the affected player
// (or the affected object's controller) chooses which applies next; after each one the others are checked again, since
// the event has changed. A step cap guards against a loop that should be impossible.
//   Choosing: when the order makes no difference, the first is taken. When it does, a person is asked where the event
//   can wait for an answer (token creation: replaceAsync); the AI, and people where the engine can't wait (a card
//   moving, a draw, damage), get the order that is best for them, logged as their choice.
import { esc } from './util.js';

const MAX_STEPS = 40;
const cloneEv = ev => ({ ...ev, applied: new Set(ev.applied || []), notes: [...(ev.notes || [])], opts: ev.opts ? { ...ev.opts } : ev.opts, groups: ev.groups?.map(x => ({ ...x })) });

// The best final score reachable from this event for its chooser, trying every order (few effects ever apply at once)
function bestScore(ev, defs, score, depth = 0) {
  const open = defs.filter(d => !ev.applied.has(d.id) && d.applies(ev));
  if (!open.length || depth > 6) return score(ev);
  const selfs = open.filter(d => d.self);
  let best = -Infinity;
  for (const d of selfs.length ? selfs.slice(0, 1) : open) {
    const next = cloneEv(ev); next.applied.add(d.id);
    best = Math.max(best, bestScore(d.apply(next) || next, defs, score, depth + 1));
  }
  return best;
}
// Which of these effects applies next: [the effect, whether the choice mattered]
function pick(ev, open, defs, score) {
  const selfs = open.filter(d => d.self);
  if (selfs.length) return [selfs[0], false];
  if (open.length === 1) return [open[0], false];
  const scored = open.map(d => { const next = cloneEv(ev); next.applied.add(d.id); return { d, s: bestScore(d.apply(next) || next, defs, score) }; });
  const top = Math.max(...scored.map(x => x.s));
  return [scored.find(x => x.s === top).d, scored.some(x => x.s !== top)];
}
// The event after every remaining effect, in the best order (nothing is logged or done: for showing a choice)
function complete(ev, defs, score) {
  for (let k = 0; k < MAX_STEPS; k++) {
    const open = defs.filter(d => !ev.applied.has(d.id) && d.applies(ev));
    if (!open.length) break;
    const [d] = pick(ev, open, defs, score);
    ev.applied.add(d.id);
    ev = d.apply(ev) || ev;
  }
  return ev;
}
function step(g, ev, d, mattered, chooser) {
  ev.applied.add(d.id);
  const out = d.apply(ev) || ev;
  out.done = [...(out.done || []), d];
  if (mattered && chooser) out.notes.push(`${chooser.name} applies ${d.label} first`);
  return out;
}
function finish(g, ev) {
  for (const d of ev.done || []) d.after?.(g, ev);
  for (const n of ev.notes || []) g.log(esc(n), { kind: 'minor', rule: '616.1' });
  if ((ev.done || []).length) (g.replaceLog ||= []).push({ type: ev.type, applied: ev.done.map(d => d.label), turn: g.turn });
  return ev;
}

/** Apply the replacement effects to an event (no waiting: the best order for the chooser) @param {import('./engine.js').Game} g */
export function replace(g, ev, defs, score, chooser = null) {
  ev = cloneEv(ev);
  for (let k = 0; k < MAX_STEPS; k++) {
    const open = defs.filter(d => !ev.applied.has(d.id) && d.applies(ev));
    if (!open.length) return finish(g, ev);
    const [d, mattered] = pick(ev, open, defs, score);
    ev = step(g, ev, d, mattered, chooser);
  }
  gap(g, null, `${ev.type} event`, 'more replacement effects kept applying than any real board can produce; the rest were left out');
  return finish(g, ev);
}
/** The same, where a person can be asked which effect applies first when it changes the result @param {import('./engine.js').Game} g */
export async function replaceAsync(g, ev, defs, score, chooser, describe) {
  ev = cloneEv(ev);
  for (let k = 0; k < MAX_STEPS; k++) {
    const open = defs.filter(d => !ev.applied.has(d.id) && d.applies(ev));
    if (!open.length) return finish(g, ev);
    let [d, mattered] = pick(ev, open, defs, score);
    if (mattered && chooser?.agent.chooseReplacementAsync && !open.some(x => x.self)) {
      // (each option shows where it leads: that effect first, then the rest in the order best for this player)
      const options = open.map(x => { const next = cloneEv(ev); next.applied.add(x.id); return { d: x, result: describe(complete(x.apply(next) || next, defs, score)) }; });
      const i = await chooser.agent.chooseReplacementAsync(g, chooser, options.map(o => ({ label: o.d.label, result: o.result })), describe(ev));
      if (Number.isInteger(i) && options[i]) { d = options[i].d; mattered = true; }
    }
    ev = step(g, ev, d, mattered, chooser);
  }
  gap(g, null, `${ev.type} event`, 'more replacement effects kept applying than any real board can produce; the rest were left out');
  return finish(g, ev);
}

// ---------- the effects the board holds, for each kind of event

const RANK = { battlefield: 6, hand: 5, graveyard: 4, library: 3, command: 3, exile: 1 };
/** A card about to change zones: where it goes instead @param {import('./engine.js').Game} g */
export function moveDefs(g, ev) {
  const o = ev.o, defs = [];
  // (its own "if ~ would be put into a graveyard, shuffle it into its owner's library instead", God-Eternals)
  if (o.fx.shuffleOnGy) defs.push({ id: 'self:shuffle', self: true, label: `${o.card.name} (shuffled into its owner's library)`, applies: e => e.to === 'graveyard' && !o.token, apply: e => { e.to = 'library'; e.opts = { ...e.opts, shuffle: true }; e.notes.push(`${o.card.name} is shuffled into its owner's library instead`); return e; } });
  // (unearth: a card returned with it is exiled instead of going anywhere else, 702.84a: decided before it "dies")
  if (o.unearthed) defs.push({ id: 'self:unearth', self: true, label: `${o.card.name} (unearth)`, applies: e => e.from === 'battlefield' && e.to !== 'exile', apply: e => { e.to = 'exile'; e.notes.push(`${o.card.name} is exiled (unearth)`); return e; } });
  if (o.fx.godEternal) defs.push({ id: 'self:eternal', self: true, label: `${o.card.name} (third from the top)`, applies: e => e.from === 'battlefield' && (e.to === 'graveyard' || e.to === 'exile') && !o.token && !o.isCommander, apply: e => { e.to = 'library'; e.opts = { ...e.opts, third: true }; e.notes.push(`${o.card.name} is put into its owner's library third from the top instead`); return e; } });
  const owner = g.players[o.owner];
  for (const q of g.alive()) for (const s of q.battlefield) {
    if (s.fx.rip) defs.push({ id: `rip:${s.iid}`, label: s.card.name, applies: e => e.to === 'graveyard', apply: e => { e.to = 'exile'; return e; } });
    if (s.fx.oppGyExile && q.idx !== o.owner) defs.push({ id: `oppGy:${s.iid}`, label: s.card.name, applies: e => e.to === 'graveyard' && !o.token, apply: e => { e.to = 'exile'; return e; } });
    const de = s.fx.oppDieExile;
    if (de && q.idx !== o.controller && (!de.nontoken || !o.token)) defs.push({
      id: `oppDie:${s.iid}`, label: s.card.name, applies: e => e.from === 'battlefield' && e.to === 'graveyard' && o.fx.type.creature,
      apply: e => { e.to = 'exile'; e.notes.push(`${o.card.name} is exiled instead of dying`); return e; },
      after: (gg) => { if (de.gain) { const n = gg.lifeGain(q, de.gain); q.life += n; gg.emit('life', { p: q.idx, d: n }); } },
    });
  }
  if (owner.gyExileTurn === g.turn && !o.token) defs.push({ id: 'gyExileTurn', label: "Yawgmoth's Will", applies: e => e.to === 'graveyard', apply: e => { e.to = 'exile'; return e; } });
  return defs;
}
export const moveScore = ev => RANK[ev.to] ?? 2;

/** One card about to be drawn: drawn twice, by someone else, or something else instead @param {import('./engine.js').Game} g */
export function drawDefs(g, ev) {
  const p = ev.p, defs = [];
  for (const s of p.battlefield) {
    if (s.fx.drawDouble) defs.push({ id: `double:${s.iid}`, label: s.card.name, applies: e => !e.first && !e.instead, apply: e => { e.count = (e.count || 1) * 2; return e; } });
    if (s.fx.lichDraw) defs.push({ id: `lich:${s.iid}`, label: s.card.name, applies: e => !e.instead && p.library.length > 3, apply: e => { e.instead = 'lich'; return e; } });
  }
  if (!g.inThief) for (const q of g.opponents(p)) for (const s of q.battlefield) if (s.fx.notionThief) defs.push({ id: `thief:${s.iid}`, label: s.card.name, applies: e => !e.first && !e.instead, apply: e => { e.instead = 'thief'; e.thief = q.idx; return e; } });
  // Dredge (optional): offered to the AI, as before (its value decides); people aren't asked here (the draw can't wait)
  if (!p.agent.human && g.turn) {
    const d = p.graveyard.filter(c => c.fx.dredge && p.library.length > c.fx.dredge + 8).sort((a, b) => p.agent.value(g, b) - p.agent.value(g, a))[0];
    if (d && p.agent.value(g, d) >= 2.5) defs.push({ id: `dredge:${d.iid}`, label: `dredge ${d.card.name}`, applies: e => !e.instead && (e.count || 1) === 1, apply: e => { e.instead = 'dredge'; e.dredge = d; return e; } });
  }
  return defs;
}
// (for the drawing player: cards they draw, minus cards an opponent draws instead)
export const drawScore = ev => (ev.instead === 'thief' ? -(ev.count || 1) : ev.instead === 'dredge' ? 1.5 : (ev.count || 1) * (ev.instead === 'lich' ? 1 : 1));

/** Damage about to be dealt to a player: prevented @param {import('./engine.js').Game} g */
export function damageDefs(g, ev) {
  const q = ev.q, defs = [];
  if (g.noPrevent()) return defs;
  if (q.shield >= g.turn) defs.push({ id: 'shield', label: 'protection from everything', applies: e => e.n > 0, apply: e => { e.notes.push(`${e.n} damage to ${q.name} is prevented`); e.n = 0; e.prevented = true; return e; } });
  if (q.preventTurn === g.turn) defs.push({ id: 'preventTurn', label: 'damage to them is prevented this turn', applies: e => e.n > 0, apply: e => { e.notes.push(`${e.n} damage to ${q.name} is prevented`); e.n = 0; e.prevented = true; return e; } });
  for (const s of q.battlefield) if (s.fx.preventMe) defs.push({ id: `prevent:${s.iid}`, label: s.card.name, applies: e => e.n > 0, apply: e => { e.notes.push(`${e.n} damage to ${q.name} is prevented`); e.n = 0; e.prevented = true; return e; } });
  return defs;
}
export const damageScore = ev => -ev.n;

/** Tokens about to be created: more of them, or others too @param {import('./engine.js').Game} g */
export function tokenDefs(g, ev) {
  const p = ev.p, defs = [];
  const mul = (id, label, k) => defs.push({ id, label, applies: () => true, apply: e => { for (const x of e.groups) x.n *= k; return e; } });
  for (const q of g.alive()) for (const s of q.battlefield) if (s.fx.tokenBonusAll) mul(`all:${s.iid}`, s.card.name, 2);
  for (const s of p.battlefield) {
    if (s.fx.tokenBonus === 'double') mul(`x2:${s.iid}`, s.card.name, 2);
    else if (s.fx.tokenBonus === 'triple') mul(`x3:${s.iid}`, s.card.name, 3);
    else if (s.fx.tokenBonus === 'plus') defs.push({ id: `plus:${s.iid}`, label: s.card.name, applies: () => true, apply: e => { e.groups[0].n += 1; return e; } });
    const k = s.fx.extraToken, on = s.fx.extraTokenOn;
    if (!k) continue;
    const kindOk = x => on === 'any' || on === x.kind || (on === 'artifact' && x.kind !== 'creature' && x.kind !== 'squirrel') || (/clue, food, or treasure/.test(on || '') && ['clue', 'food', 'treasure'].includes(x.kind));
    // Academy Manufactor: a Clue, Food or Treasure becomes one of each
    if (/clue, food, or treasure/.test(on || '')) defs.push({ id: `each:${s.iid}`, label: s.card.name, applies: e => e.groups.some(kindOk), apply: e => {
      const n = e.groups.filter(kindOk).reduce((t, x) => t + x.n, 0);
      e.groups = [...e.groups.filter(x => !kindOk(x)), ...['clue', 'food', 'treasure'].map(kind => ({ kind, n }))];
      return e;
    } });
    // Chatterfang: those tokens plus as many Squirrels
    else if (k === 'squirrel') defs.push({ id: `squirrel:${s.iid}`, label: s.card.name, applies: () => true, apply: e => { e.groups.push({ kind: 'squirrel', n: e.groups.reduce((t, x) => t + x.n, 0) }); return e; } });
    // Xorn (one more Treasure), Stridehangar Automaton (a Thopter with artifact tokens) and the like
    else defs.push({ id: `extra:${s.iid}`, label: s.card.name, applies: e => e.groups.some(kindOk), apply: e => {
      if (s.fx.extraTokenStats) e.groups.push({ kind: 'thopter', n: 1, spec: { ...s.fx.extraTokenStats, desc: `colorless ${k} artifact` } });
      else { const gx = e.groups.find(x => x.kind === k); if (gx) gx.n += 1; else e.groups.push({ kind: k, n: 1 }); }
      return e;
    } });
  }
  return defs;
}
export const tokenScore = ev => ev.groups.reduce((t, x) => t + x.n, 0);
export const tokenText = ev => ev.groups.filter(x => x.n).map(x => `${x.n} ${x.kind}`).join(', ') || 'no tokens';

/** A permanent about to enter: tapped or untapped @param {import('./engine.js').Game} g */
export function enterDefs(g, ev) {
  const o = ev.o, ctl = g.players[o.controller], defs = [];
  // (the same kinds zones.move knows)
  const kinds = { creatures: x => x.fx.type.creature, 'creatures and nonbasic lands': x => x.fx.type.creature || (x.fx.type.land && !x.fx.type.basic), 'artifacts and creatures': x => x.fx.type.creature || x.fx.type.artifact, permanents: () => true, 'nonbasic lands': x => x.fx.type.land && !x.fx.type.basic, artifacts: x => x.fx.type.artifact };
  for (const q of g.opponents(ctl)) for (const s of q.battlefield) if (s.fx.oppEnterTapped && kinds[s.fx.oppEnterTapped]?.(o)) defs.push({ id: `tapped:${s.iid}`, label: s.card.name, applies: e => !e.tapped, apply: e => { e.tapped = true; return e; } });
  for (const s of ctl.battlefield) if (s.fx.landsUntapped && o.fx.type.land && (typeof s.fx.landsUntapped !== 'object' || g.isA(o, s.fx.landsUntapped.what))) defs.push({ id: `untapped:${s.iid}`, label: s.card.name, applies: e => e.tapped, apply: e => { e.tapped = false; return e; } });
  return defs;
}
export const enterScore = ev => (ev.tapped ? 0 : 1);

// ---------- what isn't supported: said once a game for each card, never applied approximately
const GAP_RE = /\bwould\b[^.]*\binstead\b|\binstead\b[^.]*\bwould\b|^prevent (?:all|the next)|\bthe next time\b[^.]*\bwould\b|\bis dealt to\b[^.]*\binstead\b/i;
/** @type {[RegExp, string][]} */
const WHY = [
  [/dealt to [^.]* instead|deals? that damage to [^.]* instead/i, 'damage redirection is not modelled'],
  [/the next time/i, 'one-shot "the next time" shields are not modelled'],
  [/would (?:draw|be drawn)/i, 'this draw replacement is not read'],
  [/would (?:die|be put into|leave|be exiled)/i, 'this zone-change replacement is not read'],
  [/would (?:enter|create)/i, 'this entering or token replacement is not read'],
  [/would (?:deal|be dealt)|prevent/i, 'this damage replacement is not read'],
  [/would (?:gain|lose)/i, 'this life replacement is not read'],
];
/** A card's replacement-like text the reader didn't read: [{ line, why }] */
export function replacementGaps(card, unread) {
  return unread.filter(l => GAP_RE.test(l)).map(line => ({ line, why: (WHY.find(([re]) => re.test(line)) || [, 'this replacement effect is not read'])[1] }));
}
/** @param {import('./engine.js').Game} g */
export function gap(g, card, line, why) {
  const key = `${card?.name || ''}|${line}`;
  if ((g.replaceGaps ||= []).some(x => x.key === key)) return;
  g.replaceGaps.push({ key, card: card?.name || null, line, why });
  g.log(`${card ? `${esc(card.name)}: ` : ''}"${esc(line)}" does nothing here: ${esc(why)}`, { kind: 'minor', rule: '614' });
}
