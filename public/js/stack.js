// The stack and priority (Phase 2G, rules 15): stack objects with their own identity, the priority loop that ends only
// when every player still in the game has passed in succession, and the checks made while casting or activating.
//
// Stack objects (405.1): each item on g.stack is a plain object made by cast() (a spell) or triggers.putAbility() (an
// activated or triggered ability). stamp() gives every item, at every rules version (these fields change nothing in
// play), its identity and what was announced for it:
//   sid         unique id in this game (a card cast twice, or two abilities of one card, are two objects)
//   kind        'spell' | 'ability' | 'trigger'
//   controller  player index; srcIid: the source card's object id (the card may change zones meanwhile: the item
//               keeps its own record, and an ability resolves even after its source has left, 113.7a)
//   name        the source's name when it was put on the stack
//   status      'stack' → 'resolving' → 'resolved' | 'countered' | 'fizzled' (all targets illegal, 608.2b) | 'removed'
//   announced   frozen copy of the announced values: targets (as ids), X, modes chosen (effect kinds)
//   paid        what was paid to cast or activate it (mana units, life, X): costs stay paid if it's countered
// The objects resolve last in, first out: the newest object's own priority loop runs (and it resolves) before the loop
// of the object under it carries on, so only the top object ever resolves.
//
// Priority (117): priority15() replaces the old loop, which asked each object at most 8 times and then resolved it
// even if players still wanted to respond (that was the "responses stop after eight rounds" limit). Now:
//   - the object's controller gets priority first (117.3c), then each player in turn order (117.3d);
//   - a player who acts (casts a spell, activates an ability) puts a new object on top, and the pass count starts
//     over (117.4: all players must pass in succession); when that object has resolved, the active player gets
//     priority (117.3b), after state-based actions and waiting triggers (117.5, done as the object resolves);
//   - when every player still in the game has passed in succession, the object resolves (117.4, 608.1).
// Safeguards instead of the 8-round cap: a player giving the same answer (same card or ability) to one object more
// than SAME_RESPONSE times is taken to pass; more than MAX_RESPONSES responses to a single object is an engine fault,
// reported once (the object then resolves); every YIELD_EVERY responses the page gets a moment. Loops of triggers
// stay with loops.js (Phase 2B).
import { yieldTick } from './util.js';
import { needsTargetIn } from './effects.js';
import * as K from './kingdomsPlay.js';

export const MAX_RESPONSES = 200;
export const SAME_RESPONSE = 30;
const YIELD_EVERY = 16;

const tid = t => (!t ? null : t.spell ? { spell: t.spell.sid ?? null } : t.obj ? { obj: t.obj.iid } : t.player != null ? { player: t.player } : null);

/** Give a stack item its identity and announced values. @param {import('./engine.js').Game} g @param {any} item @param {string} kind @param {any} [paid] */
export function stamp(g, item, kind, paid = null) {
  item.sid = (g.stackSeq = (g.stackSeq || 0) + 1);
  item.kind = item.kind && item.ability ? item.kind : kind;
  item.controller = item.p.idx;
  item.srcIid = item.o?.iid ?? null;
  item.name = item.o?.card?.name || '?';
  item.status = 'stack';
  item.announced = Object.freeze({ targets: (item.targets || []).map(tid), x: item.x || 0, modes: (item.effects || []).map(e => e?.k || null) });
  item.paid = paid;
  return item;
}

// The player after idx in turn order who is still in the game
const nextAlive = (g, idx) => {
  const n = g.players.length;
  for (let k = 1; k <= n; k++) { const q = g.players[(idx + k) % n]; if (!q.lost) return q.idx; }
  return idx;
};
const responseKey = (q, r) => `${q.idx}|${r.kind}|${r.card?.iid ?? r.o?.iid ?? r.source?.iid ?? r.outlet?.iid ?? ''}|${r.ab?.text ?? ''}`;

/** The priority loop for one object on the stack (rules 15). @param {import('./engine.js').Game} g */
export async function priority15(g, item) {
  if (!item.ability && item.o.fx.splitSecond) { g.log(`${g.cn(item.o)} has split second: no responses`, { kind: 'minor', rule: '702.61a' }); return; }
  const prev = g.prio;
  const P = g.prio = { sid: item.sid, holder: item.p.lost ? nextAlive(g, item.p.idx) : item.p.idx, passes: 0, actions: 0 };
  const same = new Map();
  try {
    while (!g.over && !item.countered) {
      const alive = g.players.filter(q => !q.lost).length;
      if (P.passes >= alive) break;
      const q = g.players[P.holder];
      let acted = false;
      if (!q.lost) {
        // (Kingdoms: the Wizard may Announce to exile the spell)
        const wiz = g.kingdoms ? K.aiWizard(g, q, item) : null;
        if (wiz) { await K.announce(g, q, wiz); acted = true; }
        else {
          // (a person sees who has priority in the stack panel while they decide)
          if (q.agent.human && !g.sim) g.emit('update');
          let r = await (q.agent.respondAt ? q.agent.respondAt(g, q, item) : q.agent.respond(g, q, item));
          if (r?.announce) { await K.announce(g, q, { item }); acted = true; r = null; }
          if (r) {
            const key = responseKey(q, r);
            const n = (same.get(key) || 0) + 1;
            same.set(key, n);
            if (n > SAME_RESPONSE) {
              if (n === SAME_RESPONSE + 1) g.log(`${g.pn(q)} has given the same response to ${g.cn(item.o)} ${SAME_RESPONSE} times: taken as passing`, { kind: 'minor', rule: '117.3d' });
            } else acted = await g.doResponse(q, r, item);
          }
        }
      }
      if (g.over) break;
      if (acted) {
        P.actions++;
        P.passes = 0;
        // (the response has resolved by now: the active player gets priority, 117.3b)
        P.holder = g.players[g.active]?.lost ? nextAlive(g, g.active) : g.active;
        if (P.actions % YIELD_EVERY === 0) await yieldTick();
        if (P.actions >= MAX_RESPONSES) {
          g.log(`${MAX_RESPONSES} responses to ${g.cn(item.o)}: the engine's safety limit; it resolves now`, { kind: 'minor' });
          (g.stackGaps ||= []).push({ turn: g.turn, sid: item.sid, name: item.name, why: 'response safety limit' });
          break;
        }
        continue;
      }
      P.passes++;
      P.holder = nextAlive(g, P.holder);
    }
  } finally { g.prio = prev; }
}

// (rules 15) 601.2c / 602.2b: the announced targets must be legal, and a spell or ability that needs targets can't be
// cast or activated without them. given: the caller chose the targets (a person, a test, a script): each must be legal.
// An effect with "up to" in the card's text may go without a target. Returns a reason, or null when the targets are ok.
/** @param {import('./engine.js').Game} g */
export function targetsBad(g, p, src, effects, targets, given) {
  const need = effects.map((e, i) => (e && needsTargetIn(e, g.rules) ? i : -1)).filter(i => i >= 0);
  if (!need.length) return null;
  for (const i of need) {
    const t = targets[i];
    if (!t) continue;
    if (t.spell && (t.spell.o === src)) return 'a spell can\'t target itself';
    if (given && !g.validTarget(t, p, src)) return `${g.tname(t) || 'that target'} is not a legal target`;
  }
  if (need.every(i => !targets[i]) && !/\bup to (one|two|three|four|five|x|\w+) (other )?target/i.test(src?.card?.text || '')) return 'it has no legal target';
  return null;
}
export const reasonText = (g, src, why) => `${g.cn(src)} can't be ${src?.zone === 'battlefield' ? 'activated' : 'cast'}: ${why}`;
