// Triggered abilities (603) and state-based actions (704), losing and winning.
// Split out of engine.js (Round 5, item 176): each function is one of Game's methods, with the game as `g`; Game keeps
// a one-line method that calls it, so nothing else changes.
import { parseCost, COLORS, Abort } from './engine.js';
import { analyzeCard, needsTarget, needsTargetIn, condText } from './effects.js';
import { combosIn, comboState, comboBlocked, cardKey, RESULT_TEXT } from './combos.js';
import { shuffle, esc, makeRng, yieldTick } from './util.js';
import { loopWatch, loopEnded, backstop, preferredFirst } from './loops.js';
import { stamp } from './stack.js';
import * as K from './kingdomsPlay.js';
import { DUNGEONS, roomEffects, ventureChoices } from './dungeons.js';

/** @param {import('./engine.js').Game} g */
export function trigger(g, o, kind) {
  // (a card stopped on its way in, by Grafdigger's Cage, never entered)
  if (kind === 'etb' && (o.zone !== 'battlefield' || g.etbSuppressed(g.players[o.controller]) || creatureTriggersStopped(g, o, 'noEtbCreature'))) return;
  if (o.fx[kind]?.length || (kind === 'etb' && o.fx.etbModes)) g.queue.push({ o, kind, p: g.players[o.controller] });
}
// Elesh Norn, Mother of Machines (and Torpor Orb-style effects): entering doesn't trigger this player's abilities
/** @param {import('./engine.js').Game} g */
export function etbSuppressed(g, q) { return !!q && g.opponents(q).some(x => x.battlefield.some(s => s.fx.noEtbOpp)); }
// Torpor Orb, Hushbringer (rules 6): a creature entering (noEtbCreature) or dying (noDieCreature) triggers nothing
/** @param {import('./engine.js').Game} g @param {any} o @param {string} flag */
export function creatureTriggersStopped(g, o, flag) { return g.rules >= 6 && !!o?.fx.type.creature && g.alive().some(q => q.battlefield.some(s => s.fx[flag])); }
/** @param {import('./engine.js').Game} g */
export async function flushTriggers(g) {
  g._flushDepth = (g._flushDepth || 0) + 1;
  try { await flushTriggers0(g); } finally {
    // (rules 10: when the whole chain of triggers is done, the loop it held, if any, is over)
    if (--g._flushDepth === 0 && g.rules >= 10 && g.loop10 && !g.queue.length) loopEnded(g, 'the chain of triggers ended');
  }
}
// (every this many resolved triggers the page gets a moment, so a long chain at full speed doesn't freeze it; this
// changes nothing in the game)
const YIELD_EVERY = 64;
let resolvedTriggers = 0;
// Triggers that have just triggered, in APNAP order (603.3b): see flushTriggers0
/** @param {import('./engine.js').Game} g */
function sortFresh(g) {
  const fresh = g.queue.filter(x => !x.queued);
  if (!fresh.length) return;
  const n = g.players.length, a = g.active;
  const d = x => (x.p.idx - a + n) % n;
  fresh.sort((x, y) => d(y) - d(x));
  if (g.rules >= 10 && g.loop10?.order.size) fresh.sort((x, y) => d(y) - d(x) || +preferredFirst(g, y) - +preferredFirst(g, x));
  for (const x of fresh) x.queued = true;
  g.queue.splice(0, g.queue.length, ...fresh, ...g.queue.filter(x => !fresh.includes(x)));
}
// (rules 15, Phase 2G) All the triggers waiting at once go on the stack together (603.3b): the active player's first,
// then each other player's in turn order, so the last player's are on top and resolve first; each player orders their
// own (a person is asked). Targets and modes are chosen as each goes on the stack (603.3d), and they are all real
// objects there: players can respond to the top one with the others under it, and a Stifle can target any of them.
// They then resolve one at a time from the top, each with its own round of priority; a trigger that triggers while
// one resolves goes on the stack above the rest before the next resolves. The loop watcher (rules 10) still sees each
// trigger just before it resolves.
/** @param {import('./engine.js').Game} g */
async function flushTriggers15(g) {
  while (g.queue.length && !g.over) {
    sortFresh(g);
    // each player's own group of simultaneous triggers: a person orders theirs
    for (let i = 0; i < g.queue.length;) {
      const head = g.queue[i];
      let n = i;
      while (n < g.queue.length && g.queue[n].p === head.p) n++;
      if (!head.ordered && head.p.agent.orderTriggersAsync && !head.p.lost) {
        const group = g.queue.slice(i, n);
        group.forEach(x => { x.ordered = true; });
        if (group.length > 1 && group.length <= 8) {
          const order = await head.p.agent.orderTriggersAsync(g, head.p, group);
          if (order?.length === group.length) g.queue.splice(i, group.length, ...order);
        }
      }
      i = n;
    }
    // (the queue is in resolution order: the last of it goes on the stack first)
    const batch = g.queue.splice(0);
    /** @type {any[]} */
    const items = [];
    for (const t of [...batch].reverse()) {
      const { o, kind, p } = t;
      if (p.lost || g.over) continue;
      const label = t.label || { etb: 'enters', attack: 'attack trigger', upkeep: 'upkeep trigger', endstep: 'end step trigger', dies: 'dies trigger', cast: 'cast trigger', saga: 'chapter' }[kind];
      const effects = kind === 'etb' && o.fx.etbModes ? p.agent.chooseModes(g, p, o, o.fx.etbModes) : t.effects || o.fx[kind];
      // Panharmonicon, Yarok: the ability triggers additional times (the extra ones resolve after the first)
      for (let k = g.extraTriggers(t); k > 0 && !g.over && !p.lost; k--) {
        const it = await g.putAbility(p, o, kind === 'etb' && o.fx.etbModes ? p.agent.chooseModes(g, p, o, o.fx.etbModes) : effects, `${label} (again)`, 'trigger', t.trig);
        if (it) { it.t = t; it.pending = true; items.push(it); }
      }
      const it = await g.putAbility(p, o, effects, label, 'trigger', t.trig);
      if (it) { it.t = t; it.pending = true; items.push(it); }
      if (t.saga && !it) o.chapterPending = false;
    }
    const drop = () => { for (const it of items) { const i = g.stack.indexOf(it); if (i >= 0) { g.stack.splice(i, 1); it.status = 'removed'; } } };
    for (let i = items.length - 1; i >= 0 && !g.over; i--) {
      const it = items[i];
      // (triggers that came up meanwhile go on top and resolve first)
      if (g.queue.length) await flushTriggers15(g);
      if (g.over) break;
      if (!g.stack.includes(it)) continue;
      if (g.trigCount.turn !== g.turn) g.trigCount = { turn: g.turn, n: 0 };
      if (++resolvedTriggers % YIELD_EVERY === 0) await yieldTick();
      if (g.over) break;
      const r = await loopWatch(g, it.t);
      if (r === 'stop') { drop(); return; }
      if (r === 'skip') { g.stack.splice(g.stack.indexOf(it), 1); it.status = 'removed'; it.pending = false; if (it.t.saga) it.t.o.chapterPending = false; continue; }
      if (++g.trigCount.n > (g.trigCount.limit || LOOP_BACKSTOP) && (await backstop(g, LOOP_BACKSTOP)) === 'stop') { drop(); return; }
      it.pending = false;
      await g.resolveAbility(it);
      if (it.t.saga) it.t.o.chapterPending = false;
    }
    if (g.over) drop();
  }
}
/** @param {import('./engine.js').Game} g */
async function flushTriggers0(g) {
  if (g.rules >= 15) return flushTriggers15(g);
  while (g.queue.length && !g.over) {
    // Triggers that have just triggered go on the stack in APNAP order (603.3b): the active player's first, then
    // each other player's in turn order, so the last player's resolve first. They sit above any triggers still
    // waiting from before, so they resolve before those. (Rules 4 and earlier: first triggered, first resolved.)
    if (g.rules >= 5) {
      const fresh = g.queue.filter(x => !x.queued);
      if (fresh.length) {
        const n = g.players.length, a = g.active;
        const d = x => (x.p.idx - a + n) % n;
        fresh.sort((x, y) => d(y) - d(x));
        // (rules 10) Among one player's simultaneous triggers, the kinds they chose to put first to let a loop end
        // (loops.js: triggers that were piling up under it)
        if (g.rules >= 10 && g.loop10?.order.size) fresh.sort((x, y) => d(y) - d(x) || +preferredFirst(g, y) - +preferredFirst(g, x));
        for (const x of fresh) x.queued = true;
        g.queue.splice(0, g.queue.length, ...fresh, ...g.queue.filter(x => !fresh.includes(x)));
      }
    }
    // Several of a person's triggers waiting at once: they choose the order (603.3b)
    const head = g.queue[0];
    if (!head.ordered && head.p.agent.orderTriggersAsync && !head.p.lost) {
      let n = 0;
      while (n < g.queue.length && g.queue[n].p === head.p) n++;
      const group = g.queue.slice(0, n);
      group.forEach(x => { x.ordered = true; });
      if (n > 1 && n <= 8) {
        const order = await head.p.agent.orderTriggersAsync(g, head.p, group);
        if (order?.length === n) g.queue.splice(0, n, ...order);
      }
    }
    const t = g.queue.shift();
    const { o, kind, p } = t;
    if (p.lost) continue;
    // A loop the pilots can't stop on their own (two blinkers, a trigger feeding itself) ends here
    if (g.trigCount.turn !== g.turn) g.trigCount = { turn: g.turn, n: 0 };
    if (++resolvedTriggers % YIELD_EVERY === 0) await yieldTick();
    if (g.over) return;
    // (rules 10) The loop watcher (loops.js) sees every trigger first: a loop that ends by itself goes on, a mandatory
    // one that can't end is a draw, an optional one is its controller's choice. The backstop is the last resort,
    // for a chain the watcher can't classify: a person chooses to go on or call a draw, never a silent skip.
    if (g.rules >= 10) {
      const r = await loopWatch(g, t);
      if (r === 'stop') return;
      if (r === 'skip') continue;
      if (++g.trigCount.n > (g.trigCount.limit || LOOP_BACKSTOP) && (await backstop(g, LOOP_BACKSTOP)) === 'stop') return;
    } else {
    // (the last triggers' sources, to tell an endless loop from a long but finite chain)
    (g.trigSig ||= []).push(`${o?.iid}:${t.label || kind}`);
    if (g.trigSig.length > 60) g.trigSig.shift();
    // (rules 7) An endless loop of mandatory triggers is a draw (104.4b) as soon as it is recognised: the same few
    // triggers repeating while the game comes back to the same state. A loop that changes something each time
    // (life totals, cards drawn) runs until it ends by itself; LOOP_BACKSTOP only guards against an engine fault.
    if (g.rules >= 7 && g.trigCount.n > 60 && g.periodicTriggers() && g.loopRepeats()) {
      g.log('The same triggers keep repeating with nothing changing, and no player can stop them: the game is a draw', { kind: 'loss', rule: '104.4b' });
      g.queue.length = 0;
      g.finish(null, 'a loop nobody could stop (a draw)');
      return;
    }
    if (++g.trigCount.n > (g.rules >= 7 ? LOOP_BACKSTOP : 600)) {
      // The same few triggers repeating with nothing else happening: a loop of mandatory actions
      // nobody can stop is a draw (104.4b). Otherwise (a huge chain of different triggers) the
      // rest of the waiting triggers are skipped, as before
      if (g.trigCount.n === (g.rules >= 7 ? LOOP_BACKSTOP : 600) + 1 && g.periodicTriggers()) {
        g.log('The same triggers keep repeating and no player can stop them: the game is a draw', { kind: 'loss', rule: '104.4b' });
        g.queue.length = 0;
        g.finish(null, 'a loop nobody could stop (a draw)');
        return;
      }
      if (g.trigCount.n === (g.rules >= 7 ? LOOP_BACKSTOP : 600) + 1) g.log('Trigger limit for this turn reached: the rest of the waiting triggers are skipped (a loop would never end)', { kind: 'minor' });
      g.queue.length = 0;
      return;
    }
    }
    const label = t.label || { etb: 'enters', attack: 'attack trigger', upkeep: 'upkeep trigger', endstep: 'end step trigger', dies: 'dies trigger', cast: 'cast trigger', saga: 'chapter' }[kind];
    let effects = t.effects || o.fx[kind];
    // Modal enters-the-battlefield abilities ("When ~ enters, choose one —")
    if (kind === 'etb' && o.fx.etbModes) effects = p.agent.chooseModes(g, p, o, o.fx.etbModes);
    await g.stackAbility(p, o, effects, label, 'trigger', t.trig);
    // Panharmonicon, Yarok, Roaming Throne: the ability triggers an additional time
    for (let k = g.extraTriggers(t); k > 0 && !g.over && !p.lost; k--) await g.stackAbility(p, o, kind === 'etb' && o.fx.etbModes ? p.agent.chooseModes(g, p, o, o.fx.etbModes) : effects, `${label} (again)`, 'trigger', t.trig);
    if (t.saga) o.chapterPending = false;
  }
}

// (rules 7) Triggers in one turn before the engine gives up on a chain as a fault rather than a loop
export const LOOP_BACKSTOP = 20000;
// (rules 7) The game state a loop leaves behind: if it comes back to one it has been in, while the triggers repeat,
// the loop can never end on its own
/** @param {import('./engine.js').Game} g */
export function loopRepeats(g) {
  const sig = g.players.map(q => [q.lost ? 'x' : q.life, q.poison, q.library.length, q.hand.length, q.graveyard.length, q.exile.length,
    q.battlefield.map(o => `${o.card.name}${o.tapped ? 't' : ''}${o.counters}${o.damage}`).join(','), (q.pool || []).length].join('/')).join('|');
  if (g.loopStates?.turn !== g.turn) g.loopStates = { turn: g.turn, seen: new Set() };
  if (g.loopStates.seen.has(sig)) return true;
  g.loopStates.seen.add(sig);
  return false;
}
// The last 60 triggers are one short pattern (period 1 to 6) repeated over and over
/** @param {import('./engine.js').Game} g */
export function periodicTriggers(g) {
  const s = g.trigSig || [];
  if (s.length < 60) return false;
  for (let k = 1; k <= 6; k++) if (s.every((x, i) => i < k || x === s[i - k])) return true;
  return false;
}
// Priority stops (people only): the steps where a seat played here asked to stop, or every step
// with Full control. The AI pilots have no stopAt, so this changes nothing for them.
/** @param {import('./engine.js').Game} g */
export async function stopFor(g, step, active) {
  for (const q of g.order(active.idx)) {
    if (g.over || active.lost) return;
    if (!q.lost && q.agent.stopAt) await q.agent.stopAt(g, q, step, active);
  }
}

// How many extra times a queued trigger happens because of trigger doublers its controller has
/** @param {import('./engine.js').Game} g */
export function extraTriggers(g, t) {
  const { o, p } = t;
  if (!o || !p || t.saga) return 0;
  let n = 0;
  for (const s of p.battlefield) {
    const d = s.fx.trigTwice;
    if (!d) continue;
    if (d.kind === 'enter') {
      const entered = t.kind === 'etb' ? o : t.ev === 'enter' ? t.trig?.o : null;
      if (entered && entered.controller === p.idx && g.spellIs(entered, d.what || 'permanent')) n++;
    } else if (d.kind === 'attack') { if (t.kind === 'attack' || t.ev === 'allyAttacks' || t.ev === 'youAttack') n++; }
    else if (d.kind === 'any') { if (o.zone === 'battlefield' && (!d.other || o !== s) && (!d.what || g.fits(o, d.what, d.with))) n++; }
    else if (d.kind === 'chosen') { if (s.chosenType && o.zone === 'battlefield' && o !== s && g.isA(o, s.chosenType)) n++; }
    else if (d.kind === 'equipped') { if (s.attachedTo && o === s.attachedTo) n++; }
    else if (d.kind === 'self') { if ((o === s || o.attachedTo === s) && g.attachments(s).some(a => a.fx.type.equipment)) n++; }
  }
  return Math.min(n, 3);
}
// Generic triggers (effects.js WATCHERS): every permanent watching for this event queues its ability.
// info: { p: the player it happened to, o: the object involved, n: amount }
/** @param {import('./engine.js').Game} g */
export function fire(g, ev, info = {}) {
  if (g.over) return;
  if (g.trigCount.turn !== g.turn) g.trigCount = { turn: g.turn, n: 0 };
  if (ev === 'enter' && creatureTriggersStopped(g, info.o, 'noEtbCreature')) return;
  for (const q of g.alive()) for (const s of q.battlefield) {
    const ws = s.fx.watch;
    if (!ws?.length) continue;
    if (ev === 'enter' && g.etbSuppressed(q)) continue;
    for (const w of ws) {
      if (w.ev !== ev || (w.gate && !g.gateOk(s, w.gate))) continue;
      const r = g.watchMatches(w, s, q, info);
      if (!r) continue;
      // "Whenever one or more …" triggers once for a batch of events still waiting to resolve
      if (w.once && g.queue.some(it => it.w === w && it.o === s)) continue;
      // (rules 9) "This ability triggers only once each turn"
      if (w.turnOnce9 && !g.onceOk(s, `w${ws.indexOf(w)}`)) continue;
      // (rules 7: no fixed cap on legitimate loops; flushTriggers tells an endless mandatory loop from a long chain)
      // (rules 10: nothing is dropped here; flushTriggers counts the triggers that resolve and has the backstop)
      if (g.rules < 10 && ++g.trigCount.n > (g.rules >= 7 ? LOOP_BACKSTOP : 300)) {
        if (g.trigCount.n === (g.rules >= 7 ? LOOP_BACKSTOP : 300) + 1) g.log('Trigger limit for this turn reached: further triggers are skipped (a loop would never end)', { kind: 'minor' });
        return;
      }
      g.queue.push({ o: s, effects: w.effects, label: g.watchLabel(ev, info), p: q, trig: r === true ? info : r, w, ev });
    }
  }
}
// Abilities past a threshold: station charge counters, class level, max speed
/** @param {import('./engine.js').Game} g */
export function gateOk(g, s, gate) {
  if (gate.kind === 'charge') return (s.named?.charge || 0) >= gate.n;
  if (gate.kind === 'level') return (s.level || 1) >= gate.n;
  if (gate.kind === 'speed') return (g.players[s.controller]?.speed || 0) >= gate.n;
  return true;
}
// A creature matching a description from card text: "artifact", "non-human", "ninja or rogue", "modified", plus "with power 4 or greater"…
/** @param {import('./engine.js').Game} g */
export function fits(g, o, what, w) {
  if (what && what !== 'creature' && !what.split(' or ').some(alt => alt.split(/\s+/).every(x => (x === 'modified' ? o.counters > 0 || !!o.named && Object.values(o.named).some(v => v > 0) || g.attachments(o).length > 0
    : x === 'attacking' ? o.attacking != null : x === 'commander' ? !!o.isCommander : x.startsWith('non-') ? !g.isA(o, x.slice(4))
    : ['white', 'blue', 'black', 'red', 'green', 'colorless', 'multicolored'].includes(x) ? g.spellIs(o, x) : g.isA(o, x))))) return false;
  if (!w) return true;
  let m;
  if (/counters? on (?:it|them)/.test(w)) return o.counters > 0;
  if (/greater than its base power/.test(w)) return g.power(o) > g.basePower(o.card);
  if ((m = w.match(/power (\d+) or greater/))) return g.power(o) >= +m[1];
  if ((m = w.match(/power (\d+) or less/))) return g.power(o) <= +m[1];
  if ((m = w.match(/toughness greater than its power/))) return g.toughness(o) > g.power(o);
  if ((m = w.match(/^without (\w+(?: \w+)?)/))) return !g.has(o, m[1]);
  if ((m = w.match(/with (flying|trample|deathtouch|lifelink|menace|haste|vigilance|reach|first strike|double strike)/))) return g.has(o, m[1]);
  if (/enchanted or equipped/.test(w)) return g.attachments(o).length > 0;
  if ((m = w.match(/that are (\w+) and\/or tokens/))) return !!o.token || g.isA(o, m[1].replace(/s$/, ''));
  return true;
}
/** @param {import('./engine.js').Game} g */
export function whoOk(g, w, q, i) { return w.who === 'you' ? i === q.idx : w.who === 'opp' ? i !== q.idx : true; }
/** @param {import('./engine.js').Game} g */
export function watchLabel(g, ev, info) {
  const who = info.p != null ? g.players[info.p]?.name : '';
  const what = info.o ? info.o.card.name : '';
  return {
    gainLife: `${who} gained life`, loseLife: `${who} lost life`, draw: `${who} drew a card`, sac: `${who} sacrificed ${what}`, discard: `${who} discarded ${what}`,
    enter: `${what} entered`, tokenMade: `${who} created a token`, upkeep: 'upkeep trigger', endStep: 'end step trigger', begCombat: 'beginning of combat',
    main1: 'main phase trigger', drawStep: 'draw step trigger', youAttack: 'attack trigger', allyAttacks: `${what} attacks`, allyCombat: `${what} dealt combat damage`,
    attachedAttacks: `${what} attacks`, attachedDamage: `${what} dealt combat damage`, block: 'block trigger', blocked: 'blocked trigger', damaged: 'was dealt damage',
    selfCombat: 'combat damage trigger', targeted: 'became a target', heroic: 'heroic', anyCast: `${who} cast ${what}`,
  }[ev] || ev;
}
/** @param {import('./engine.js').Game} g */
export function watchMatches(g, w, s, q, info) {
  const mine = info.p === q.idx;
  if (w.self && info.o !== s) return false;
  // A background's granted trigger needs a commander on the battlefield
  if (w.cmdr && !q.battlefield.some(o => o.isCommander)) return false;
  switch (w.ev) {
    case 'draw':
      if (w.nth && info.nth !== w.nth) return false;
      if (w.ownTurn && g.active !== info.p) return false;
      return g.whoOk(w, q, info.p);
    case 'gainLife': case 'loseLife': case 'discard': case 'tokenMade':
      if (w.ev === 'discard' && w.what && !(w.what === 'spell' ? info.o && !info.o.fx.type.creature && !info.o.fx.type.land : w.what === 'permanentCard' ? info.o?.fx.type.permanent : info.o?.fx.type[w.what])) return false;

      return w.who === 'you' ? mine : w.who === 'opp' ? !mine : true;
    // ---- 1.6.0 events
    case 'landPlay': return g.whoOk(w, q, info.p) && (!w.other || info.o !== s);
    case 'search': case 'crime': case 'ring': case 'proliferate': return g.whoOk(w, q, info.p);
    case 'counterPut':
      if (w.self) return true;
      return w.ctl === 'opp' ? info.by === q.idx && info.o.controller !== q.idx : info.o.controller === q.idx;
    case 'gyLeave': return info.p === q.idx && (!w.what || !!info.o.fx.type[w.what]);
    case 'toGy': return g.whoOk(w, q, info.p) && (!w.what || !!info.o.fx.type[w.what]) && (!w.fromBf || info.from === 'battlefield');
    case 'selfGy': case 'cycled': case 'untapped': case 'level': return !w.n || info.n === w.n;
    case 'tapped': return w.self || (info.o.controller === q.idx && g.isA(info.o, w.what));
    case 'noncombat': return info.p === q.idx && info.target !== q.idx;
    case 'main2': return mine;
    case 'damaged':
      if (w.attached) return s.attachedTo === info.o;
      if (w.what) return info.o.controller === q.idx && g.isA(info.o, w.what);
      return true;
    case 'targeted':
      if (w.what) return info.o.controller === q.idx && g.isA(info.o, w.what) && (!w.byOpp || info.p !== q.idx);
      return true;
    case 'leaveBf': {
      const o = info.o;
      if (w.other && o === s) return false;
      if (w.nontoken && o.token) return false;
      if (w.ctl === 'you' && info.ctl !== q.idx) return false;
      if (w.ctl === 'opp' && info.ctl === q.idx) return false;
      if (w.toGy && info.to !== 'graveyard') return false;
      if (w.exiled && info.to !== 'exile') return false;
      if (w.noDie && info.to === 'graveyard' && o.fx.type.creature) return false;
      return g.fits(o, w.what);
    }
    case 'sac': return (w.who === 'you' ? mine : w.who === 'opp' ? !mine : true) && g.isA(info.o, w.what === 'token' ? 'token' : w.what);
    case 'enter': {
      const o = info.o;
      if (w.other && o === s) return false;
      if (w.commander && !o.isCommander) return false;
      if (w.nontoken && o.token) return false;
      if (w.ctl === 'you' && o.controller !== q.idx) return false;
      if (w.ctl === 'opp' && o.controller === q.idx) return false;
      return g.isA(o, w.what);
    }
    case 'upkeep': case 'endStep': case 'begCombat':
      return w.whose === 'you' ? mine : w.whose === 'opp' ? !mine : true;
    case 'main1': case 'drawStep': return mine;
    case 'youAttack': {
      if (!g.whoOk({ who: w.who || 'you' }, q, info.p)) return false;
      if (w.min && info.n < w.min) return false;
      if (w.selfAttacking && s.attacking == null) return false;
      if (w.atMe && !(info.os || []).some(o => o.attacking === q.idx)) return false;
      if (!w.what && !w.with) return true;
      const n = (info.os || []).filter(o => g.fits(o, w.what, w.with)).length;
      return n ? { ...info, n } : false;
    }
    case 'allyAttacks':
      if (w.who === 'opp') return info.o.controller !== q.idx && (!w.atMe || info.o.attacking === q.idx);
      return info.o.controller === q.idx && (!w.other || info.o !== s) && (!w.commander || info.o.isCommander) && g.fits(info.o, w.what, w.with);
    case 'countered': return info.p === q.idx;
    case 'allyCombat': return info.o.controller === q.idx && (!w.other || info.o !== s) && (!w.commander || info.o.isCommander) && g.fits(info.o, w.what, w.with);
    case 'attachedAttacks': return s.attachedTo === info.o;
    // (rules 7) Curiosity: "deals damage to an opponent" counts noncombat damage too, but only to an opponent
    case 'attachedDamage': return s.attachedTo === info.o && (!info.noncombat || (!!w.anyDamage && info.target !== q.idx));
    case 'anyCast':
      if (w.who && !g.whoOk(w, q, info.p)) return false;
      if (w.nth && info.nth !== w.nth) return false;
      if (w.ownTurn && g.active !== info.p) return false;
      if (w.notHand && info.from === 'hand') return false;
      return w.what === 'any' || g.spellIs(info.o, w.what);
    default: return true;
  }
}
// Conditions of "if" effects, intervening-if triggers and "as long as" bonuses (effects.js parseCond)
/** @param {import('./engine.js').Game} g */
export function evalCond(g, p, src, c, ctx = {}) {
  const bf = p.battlefield;
  switch (c.c) {
    case 'kicked': return !!(src?.kicked || ctx.kicked);
    case 'gy': return p.graveyard.length >= c.n;
    case 'gyTypes': return new Set(p.graveyard.flatMap(o => ['creature', 'artifact', 'enchantment', 'instant', 'sorcery', 'planeswalker', 'land', 'battle'].filter(t => o.fx.type[t]))).size >= c.n;
    case 'gyType': return p.graveyard.filter(o => c.types.some(t => o.fx.type[t])).length >= c.n;
    case 'died': return g.diedTurn === g.turn;
    case 'attacked': return p.attackedTurn === g.turn;
    case 'handEmpty': return p.hand.length === 0;
    case 'power': return bf.some(o => o.fx.type.creature && g.power(o) >= c.n);
    case 'revolt': return p.leftTurn === g.turn;
    case 'coven': return new Set(bf.filter(o => o.fx.type.creature).map(o => g.power(o))).size >= 3;
    case 'totalPower': return bf.filter(o => o.fx.type.creature).reduce((s, o) => s + g.power(o), 0) >= c.n;
    case 'poison': return g.opponents(p).some(q => q.poison >= c.n);
    case 'lifeLE': return p.life <= c.n;
    case 'lifeGE': return p.life >= c.n;
    case 'commander': return bf.some(o => o.isCommander);
    case 'blessing': return bf.length >= 10 && bf.some(o => o.fx.ascend);
    case 'named': return (c.kind === '+1/+1' ? src?.counters || 0 : src?.named?.[c.kind] || 0) >= c.n;
    case 'selfAttacking': return src?.attacking != null;
    case 'selfUntapped': return !!src && !src.tapped !== !!c.neg;
    case 'controlAny': return bf.some(o => c.what.some(w => g.isA(o, w)));
    case 'oracle': return g.dynValue(p, { dyn: 'devotion', color: 'U' }) >= p.library.length;
    case 'oppMore': return g.opponents(p).some(q => g.countControlled(q, c.what) > g.countControlled(p, c.what));
    case 'myTurn': return (g.active === p.idx) !== !!c.neg;
    case 'gainedLife': return p.gainedTurn === g.turn;
    case 'castOther': return (p.turnSpells?.turn === g.turn ? p.turnSpells.n : 0) >= 2;
    case 'x': return (ctx.x || 0) >= c.n;
    case 'oppLostLife': return g.opponents(p).some(q => q.lostLifeTurn === g.turn);
    case 'bfCreatures': return g.alive().reduce((s, q) => s + q.battlefield.filter(o => o.fx.type.creature).length, 0) >= c.n;
    case 'castFromHand': return src?.castFrom === 'hand';
    case 'monarch': return g.monarch === p.idx;
    case 'gift': return false;
    case 'control': return bf.filter(o => (!c.other || o !== src) && g.isA(o, c.what)).length >= (c.n === 'X' ? 1 : c.n);
    // (item 206, rules 17) A condition read since the audit is checked through its reading (c.r). One that still can't
    // be read is not met when a conditional effect resolves (ctx.resolving: the effect is reported, never assumed);
    // elsewhere, and in games at rules 16 and earlier, it counts as met as before.
    case '?':
      if (g.rules < 17) return true;
      if (c.r) return evalCond(g, p, src, c.r, ctx);
      return !ctx.resolving;
    // A seeded flip as the effect resolves; a look ahead of time (the AI valuing the card) never flips
    case 'coin': return ctx.resolving ? (g.rand() < 0.5) === !!c.win : !!c.win;
    case 'trigIs': return !!ctx.trig?.o && c.types.some(t => ctx.trig.o.fx.type[t]);
    case 'wasCast': return !!src?.wasCast;
    case 'gainedN': return p.gainedTurn === g.turn && (p.gainedAmt || 0) >= c.n;
    case 'lostN': return (c.any ? g.alive() : g.opponents(p)).some(q => q.lostLifeTurn === g.turn && (q.lostAmt || 0) >= c.n);
    case 'noLifeLost': return p.lostLifeTurn !== g.turn;
    case 'selfGyControl': return src?.zone === 'graveyard' && bf.some(o => g.isA(o, c.what));
    case 'controlNone': return !bf.some(o => g.isA(o, c.what));
    case 'oppLifeLE': return g.opponents(p).some(q => q.life <= c.n);
    case 'oppControl': return g.opponents(p).some(q => q.battlefield.filter(o => g.isA(o, c.what)).length >= c.n);
    case 'oppMonarch': return g.monarch != null && g.monarch !== p.idx && g.opponents(p).some(q => q.idx === g.monarch);
    case 'bfNoCreatures': return !g.alive().some(q => q.battlefield.some(o => o.fx.type.creature));
    case 'selfCounters': { const n = src ? (src.zone === 'battlefield' ? src.counters || 0 : src.lastCounters || 0) : 0; return (c.min == null || n >= c.min) && (c.max == null || n <= c.max); }
    case 'handLT': return p.hand.length < c.n;
    // "This is the second time this ability has resolved this turn": counted on the source as it resolves
    case 'nthResolve': {
      if (!src) return false;
      if (!ctx.resolving) return false;
      const r = src.resolvedTurn?.turn === g.turn ? src.resolvedTurn : (src.resolvedTurn = { turn: g.turn, n: 0 });
      return ++r.n === c.n;
    }
    // A condition the simulator can't read (it depends on a revealed card, say) counts as met
    default: return true;
  }
}

// Triggered and activated abilities use the stack too: targets are chosen as the ability is put
// on the stack, every player gets priority, and an ability whose targets are all gone does nothing
/** @param {import('./engine.js').Game} g @param {any} [trig] @param {any[] | null} [pre] */
export async function stackAbility(g, p, src, effects, label, kind = 'ability', trig = null, x = 0, pre = null) {
  const item = await putAbility(g, p, src, effects, label, kind, trig, x, pre);
  if (item) await resolveAbility(g, item);
}
// Put an ability on the stack: targets (pre: already chosen, 602.2b at rules 15), ward, the stack object. Returns it,
// or null (nothing to do, or countered by ward).
/** @param {import('./engine.js').Game} g @param {any} [trig] @param {any[] | null} [pre] */
export async function putAbility(g, p, src, effects, label, kind = 'ability', trig = null, x = 0, pre = null) {
  if (!effects?.length) return null;
  // (a human player is asked; the AI answers straight away)
  const targets = [];
  if (pre) targets.push(...pre);
  else {
    // (the X already paid, for players choosing targets for "X damage")
    g.xNow = x || null;
    try {
      for (const e of effects) targets.push(needsTargetIn(e, g.rules) ? await (p.agent.chooseTargetAsync?.(g, p, e, src) ?? p.agent.chooseTarget(g, p, e, src)) : null);
    } finally { g.xNow = null; }
  }
  if (!g.payWard(p, targets, src)) return null;
  for (const t of targets) if (t?.obj) g.fire('targeted', { o: t.obj, p: p.idx });
  g.noteCrime(p, targets);
  const item = stamp(g, { o: src, p, x, targets, effects, ability: true, label, countered: false, kind, trig }, kind, { x });

  g.stack.push(item);
  const tgtText = targets.filter(Boolean).map(t => g.tname(t)).join(', ');
  g.log(`${g.cn(src)} — ${esc(label)}${tgtText ? ` targeting ${tgtText}` : ''}`, { kind: kind === 'trigger' ? 'trigger' : 'minor', rule: kind === 'trigger' ? '603.3' : null });
  await g.beat(0.5);
  return item;
}
// Priority for an ability on the stack, then it resolves (or not: countered, or every target gone, 608.2b)
/** @param {import('./engine.js').Game} g */
export async function resolveAbility(g, item) {
  const { o: src, p, x, targets, effects, trig } = item;
  await g.priority(item);
  const at = g.stack.indexOf(item);
  if (at >= 0 || g.rules < 15) g.stack.splice(at, 1);
  if (item.countered) { item.status = 'countered'; return; }
  const chosen = targets.filter(Boolean);
  if (chosen.length && chosen.every(t => !g.validTarget(t, p, src))) {
    item.status = 'fizzled';
    g.log(`${g.cn(src)}'s ability does nothing: its target is no longer legal`, { rule: '608.2b', kind: 'minor' });
    return;
  }
  item.status = 'resolving';
  await g.runEffects(p, src, effects, { targets, strict: true, trig, x });
  item.status = 'resolved';
  // (rules 15) state-based actions and the triggers waiting are done before anyone gets priority again (117.5)
  if (g.rules >= 15 && !g.over) await g.sba();
}
/** @param {import('./engine.js').Game} g */
export function sbaPass(g) {
  // (Phase 2B, every rules version: while state-based actions are checked nothing gets attached and no anthem appears,
  // so when the board has none, each creature's toughness skips those whole-table scans; Game.attachments and
  // Game.bonus read this. The results are the same; a board of N tokens costs N steps here instead of N².)
  const prevFacts = g._sbaFacts;
  try {
    return sbaPass0(g);
  } finally { g._sbaFacts = prevFacts; }
}
/** @param {import('./engine.js').Game} g */
export function sbaFacts(g) {
  const anthem = new Set();
  let attach = false, oppAnthem = false;
  for (const q of g.players) for (const o of q.battlefield) {
    if (o.attachedTo) attach = true;
    if (o.fx.anthem) anthem.add(q.idx);
    if (o.fx.oppAnthem) oppAnthem = true;
  }
  return { attach, anthem, oppAnthem };
}
/** @param {import('./engine.js').Game} g */
function sbaPass0(g) {
  let any = false;
  for (let again = true; again;) {
    again = false;
    g._sbaFacts = sbaFacts(g);
    for (const q of g.alive()) {
      // Platinum Angel, Angel's Grace: this player can't lose right now
      if (g.cantLose(q)) continue;
      if (q.life <= 0) { g.lose(q, 'life total reached 0', '704.5a'); again = true; continue; }
      if (q.drewFromEmpty && q.battlefield.some(o => o.fx.labMan)) {
        // Laboratory Maniac, Jace: drawing from an empty library wins instead
        q.drewFromEmpty = false;
        g.winNote = 'drew from an empty library with Laboratory Maniac';
        for (const r of g.opponents(q)) g.lose(r, `${q.name} drew from an empty library and won`, '104.2b');
        continue;
      }
      if (q.drewFromEmpty) { g.lose(q, 'drew from an empty library', '704.5b'); again = true; continue; }
      if (q.poison >= (g.format.poison || 10)) { g.lose(q, `${g.format.poison || 'ten'} poison counters`, '704.5c'); again = true; continue; }
      if (g.format.cmdDamage) for (const [iid, n] of Object.entries(q.cmdDamage)) if (n >= g.format.cmdDamage) {
        const src = g.objects.get(+iid);
        g.lose(q, `${g.format.cmdDamage} combat damage from ${src.card.name}`, '903.10a'); again = true; break;
      }
    }
    for (const q of g.alive()) {
      for (const o of [...q.battlefield]) {
        if (o.fx.type.creature) {
          const t = g.toughness(o);
          if (t <= 0) { g.move(o, 'graveyard'); g.log(`${g.cn(o)} dies (0 toughness)`, { rule: '704.5f', kind: 'death' }); again = true; }
          else if ((o.damage >= t || (o.deathtouched && (o.damage > 0 || o.deathtouched === 'counters'))) && !g.has(o, 'indestructible')) {
            const dt = o.deathtouched && o.damage < t;
            if (g.regenerate(o)) continue;
            g.move(o, 'graveyard');
            g.log(`${g.cn(o)} dies`, { rule: dt ? '704.5h' : '704.5g', kind: 'death' }); again = true;
          }
        } else if (o.fx.type.planeswalker && o.loyalty <= 0) {
          g.move(o, 'graveyard'); g.log(`${g.cn(o)} has no loyalty left`, { rule: '704.5i', kind: 'death' }); again = true;
        }
        if (o.fx.saga && o.zone === 'battlefield' && !o.chapterPending && o.lore >= o.fx.saga.length) {
          g.move(o, 'graveyard'); g.log(`${g.cn(o)} is sacrificed after its final chapter`, { rule: '714.4', kind: 'minor' }); again = true;
        }
        if (o.fx.type.battle && !o.fx.type.creature && g.rules >= 5 && o.zone === 'battlefield' && (o.defense || 0) <= 0) {
          const siege = /\bsiege\b/i.test(o.card.typeLine) && !!o.card.backCard;
          g.log(`${g.cn(o)} has no defense counters left`, { rule: '704.5v', kind: 'combat' });
          g.move(o, 'graveyard'); again = true;
          if (siege) g.queue.push({ o, effects: [{ k: 'siegeCast' }], label: 'defeated', p: g.players[o.owner] });
        }
        // (rules 16) Protection (702.16c–d): an Aura on a permanent with protection from it is put into its owner's
        // graveyard (704.5m), an Equipment becomes unattached and stays on the battlefield (704.5n)
        if (g.rules >= 16 && o.zone === 'battlefield' && o.attachedTo?.zone === 'battlefield' && (o.fx.type.aura || o.fx.type.equipment) && g.protectedFrom(o.attachedTo, o)) {
          g.log(`${g.cn(o)} ${o.fx.type.aura ? 'is put into the graveyard' : 'becomes unattached'}: ${g.cn(o.attachedTo)} has protection from it`, { rule: o.fx.type.aura ? '704.5m' : '704.5n', kind: 'minor' });
          if (o.fx.type.aura && !o.bestowed) g.move(o, 'graveyard'); else if (o.bestowed) { g.unbestow(o); g._sbaFacts = sbaFacts(g); } else o.attachedTo = null;
          again = true;
          continue;
        }
        if (o.fx.type.aura && o.zone === 'battlefield' && (!o.attachedTo || o.attachedTo.zone !== 'battlefield')) {
          if (o.bestowed) { g.unbestow(o); g._sbaFacts = sbaFacts(g); } else g.move(o, 'graveyard');
          again = true;
        }
        // Equipment on something that is no longer a creature (a Vehicle after the turn it was crewed, an animated
        // land or artifact) becomes unattached and stays on the battlefield (704.5n; found by the fuzz games)
        if (g.rules >= 5 && o.fx.type.equipment && o.zone === 'battlefield' && o.attachedTo?.zone === 'battlefield' && !o.attachedTo.fx.type.creature) {
          g.log(`${g.cn(o)} becomes unattached from ${g.cn(o.attachedTo)}, which isn't a creature`, { rule: '704.5n', kind: 'minor' });
          o.attachedTo = null;
          again = true;
        }
      }
      const legends = {};
      // (Sakashima, Mirror Gallery: the legend rule doesn't apply)
      if (!q.battlefield.some(s => s.fx.noLegendRule)) for (const o of q.battlefield) if (o.fx.type.legendary) (legends[o.card.name] ||= []).push(o);
      for (const group of Object.values(legends)) if (group.length > 1) {
        for (const o of group.slice(0, -1)) { g.move(o, 'graveyard'); g.log(`${g.cn(o)} is put into the graveyard (legend rule)`, { rule: '704.5j' }); }
        again = true;
      }
    }
    if (again) any = true;
  }
  return any;
}
/** @param {import('./engine.js').Game} g */
export async function sba(g) {
  // Teferi, Time Raveler: this player's opponents can only cast spells at sorcery speed (read by the seats' instant-speed check)
  for (const q of g.players) q.sorceryLocked = g.opponents(q).some(x => x.battlefield.some(s => s.fx.oppSorcery));
  if (g.kingdoms) K.tick(g);
  for (let guard = 0; guard < 25 && !g.over; guard++) {
    let changed = g.sbaPass();
    if (await g.commanderChoices()) changed = true;
    if (g.queue.length) { await g.flushTriggers(); changed = true; }
    if (!changed) break;
  }
}
// 903.9a: a commander put into a graveyard or exile since the last check may go to the command zone (its owner's
// choice; the AI keeps it there only to reanimate or recast it from there, people are asked)
/** @param {import('./engine.js').Game} g */
export async function commanderChoices(g) {
  let any = false;
  for (const p of g.players) for (const o of [...p.graveyard, ...p.exile]) {
    if (!o.cmdChoicePending) continue;
    o.cmdChoicePending = false;
    if (p.lost) continue;
    const back = await (p.agent.commanderToCommandZoneAsync ? p.agent.commanderToCommandZoneAsync(g, p, o, o.zone) : p.agent.commanderToCommandZone ? p.agent.commanderToCommandZone(g, p, o, o.zone) : true);
    if (back) {
      g.log(`${g.cn(o)} returns to ${g.pn(p)}'s command zone`, { rule: '903.9a' });
      g.move(o, 'command', { stay: true });
      any = true;
    } else { o.cmdStay = true; g.log(`${g.pn(p)} leaves ${g.cn(o)} in their ${o.zone}`, { kind: 'minor', rule: '903.9a' }); }
  }
  return any;
}
/** @param {import('./engine.js').Game} g */
export function cantLose(g, q) { return q.cantLoseTurn === g.turn || q.battlefield.some(s => s.fx.cantLose); }
/** @param {import('./engine.js').Game} g */
export function lose(g, q, reason, rule) {
  if (q.lost || g.cantLose(q)) return;
  if (g.kingdoms && K.preventLoss(g, q)) return;
  q.lost = true;
  q.lossReason = reason;
  q.place = g.alive().length + 1;
  g.log(`${g.pn(q)} is eliminated — ${esc(reason)}`, { rule, kind: 'loss' });
  g.log(`All of ${g.pn(q)}'s permanents leave the game`, { rule: '800.4a', kind: 'minor' });
  // (all of them leave at once: an aura of theirs on a creature of theirs leaves the game with it,
  // rather than being put into a graveyard as "no longer attached")
  // Cards they controlled but someone else owns go back to their owners (800.4a: control effects end)
  const borrowed = q.battlefield.filter(o => o.owner !== q.idx && !g.players[o.owner]?.lost);
  const leaving = q.battlefield.filter(o => !borrowed.includes(o));
  for (const o of leaving) o.zone = 'gone';
  q.battlefield = [];
  for (const o of borrowed) {
    const back = g.players[o.owner];
    o.controller = back.idx;
    Object.assign(o, { attacking: null, blocking: null, blockedBy: [], blocked: false, stolenBy: null, stolenFrom: null });
    back.battlefield.push(o);
    g.log(`${g.cn(o)} returns to its owner, ${g.pn(back)}`, { kind: 'minor', rule: '800.4a' });
  }
  for (const o of leaving) g.leaveBattlefield(o);
  // Their cards that someone else controls leave too
  for (const r of g.players) for (const o of [...r.battlefield]) if (o.owner === q.idx) { r.battlefield.splice(r.battlefield.indexOf(o), 1); g.leaveBattlefield(o); o.zone = 'gone'; }
  g.emit('loss', q);
  // A monarch who leaves the game passes the title to the active player (or the next one) (724.4)
  if (g.monarch === q.idx) { const n = g.players[g.active].lost ? g.players[g.nextAlive(g.active)] : g.players[g.active]; g.monarch = null; if (!n.lost) g.setMonarch(n, `${q.name} left the game`); }
  if (g.kingdoms) { K.onEliminated(g, q); return; }
  // Two-Headed Giant: a team loses together (810.8a), and the team left standing wins together
  if (g.teams) {
    const mate = g.format.teams ? g.teammate(q) : null;
    if (mate) g.lose(mate, reason, '810.8a');
    const left = g.alive();
    if (left.length && !g.over && left.every(r => r.team === left[0].team)) {
      g.log(`🏆 ${left.map(r => g.pn(r)).join(' and ')} win as a team`, { kind: 'win' });
      g.finish(left[0], 'the other team is out', left);
    }
    return;
  }
  if (g.alive().length <= 1) g.finish(g.alive()[0], g.winNote || 'last player standing');
}
/** @param {import('./engine.js').Game} g @param {any} winner @param {string} why @param {any[] | null} [team] */
export function finish(g, winner, why, team = null) {
  if (g.over) return;
  g.over = true;
  g.winner = winner || null;
  // (Kingdoms: a whole team can win together)
  g.winners = team?.length ? team : winner ? [winner] : [];
  g.winReason = winner ? why : 'draw';
  for (const w of g.winners) w.place = 1;
  if (team) { g.emit('over', winner); g.emit('update'); return; }
  g.log(winner ? `🏆 ${g.pn(winner)} wins — ${esc(why)}` : 'The game is a draw', { kind: 'win' });
  g.emit('over', winner);
  g.emit('update');
}
