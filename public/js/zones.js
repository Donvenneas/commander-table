// Zones (rule 400): moving objects, drawing, milling, searching, entering and leaving the battlefield.
// Split out of engine.js (Round 5, item 176): each function is one of Game's methods, with the game as `g`; Game keeps
// a one-line method that calls it, so nothing else changes.
import { parseCost, COLORS, Abort } from './engine.js';
import { analyzeCard, needsTarget, condText, droppedSentences } from './effects.js';
import { combosIn, comboState, comboBlocked, cardKey, RESULT_TEXT } from './combos.js';
import { shuffle, esc, makeRng } from './util.js';
import * as K from './kingdomsPlay.js';
import { DUNGEONS, roomEffects, ventureChoices } from './dungeons.js';
import * as R from './replacements.js';

/** @param {import('./engine.js').Game} g */
export function move(g, o, to, opts = {}) {
  const p = g.players[o.owner];
  const from = o.zone;
  // Grafdigger's Cage, Soulless Jailer: cards in graveyards (and libraries) can't enter the battlefield
  if (to === 'battlefield' && (from === 'graveyard' || from === 'library') && g.alive().some(q => q.battlefield.some(s => s.fx.gyLock && (from === 'graveyard' || s.fx.gyLock.lib) && (s.fx.gyLock.what === 'permanent' || o.fx.type.creature)))) {
    g.log(`${g.cn(o)} can't enter the battlefield from the ${from}`, { kind: 'minor' });
    return o;
  }
  // Exile-instead replacements decide whether it "dies" at all: Rest in Peace, Yawgmoth's Will (this turn, your
  // cards), and Liesa, Gisa, The Darkness Crystal (opponents' creatures)
  let dieExiler = null;
  // (rules 14) Through the replacement-effect loop (replacements.js): the object's own effects first, then the affected
  // player's choice of order; the event that happens is the final one (so a creature exiled instead never died)
  const r14 = g.rules >= 14 && from !== to;
  if (r14) {
    const ev = R.replace(g, { type: 'move', o, from, to, opts }, R.moveDefs(g, { o }), R.moveScore, g.players[from === 'battlefield' ? o.controller : o.owner]);
    to = ev.to; opts = ev.opts || opts;
  } else {
  if (to === 'graveyard' && !o.fx.shuffleOnGy) {
    if (g.alive().some(q => q.battlefield.some(s => s.fx.rip)) || (!o.token && p.gyExileTurn === g.turn)) to = 'exile';
    else if (from === 'battlefield' && o.fx.type.creature) {
      dieExiler = g.alive().find(q => q.idx !== o.controller && q.battlefield.some(s => s.fx.oppDieExile && (!s.fx.oppDieExile.nontoken || !o.token))) || null;
      if (dieExiler) to = 'exile';
    }
  }
  // God-Eternals: third from the top of the library instead of the graveyard or exile
  if (from === 'battlefield' && (to === 'graveyard' || to === 'exile') && o.fx.godEternal && !o.token && !o.isCommander) { to = 'library'; opts = { ...opts, third: true }; g.log(`${g.cn(o)} is put into its owner's library third from the top`, { kind: 'minor' }); }
  }
  const died = from === 'battlefield' && to === 'graveyard' && o.fx.type.creature;
  // (the table animates draws, discards, deaths and exiles; it reads the card's spot before it moves)
  g.emit('move', { iid: o.iid, owner: o.owner, from, to, died, token: !!o.token });
  // A permanent sits on its controller's battlefield, which isn't always its owner's
  // (rules 7) undying and persist granted by another permanent (Mikaeus, the Unhallowed) count as it leaves (603.10a)
  const granted = from === 'battlefield' && g.rules >= 7 ? { undying: g.has(o, 'undying'), persist: g.has(o, 'persist') } : null;
  const fromArr = from === 'battlefield' ? g.players[o.controller].battlefield : p[from];
  if (Array.isArray(fromArr)) { const i = fromArr.indexOf(o); if (i >= 0) fromArr.splice(i, 1); }
  let snap = null;
  if (from === 'battlefield') {
    // What the permanent was like as it left (undying, persist, modular and "when it leaves" look back at it)
    const ctl = g.players[o.controller];
    snap = { counters: o.counters, minus: !!o.hadMinus, controller: o.controller, blitzed: !!o.blitzed, granted };
    ctl.leftTurn = g.turn;
    for (const w of [...(o.fx.watch || []), ...(g.rules >= 7 ? o.fx.watch7 || [] : [])]) if (w.ev === 'ltb' || (w.ev === 'selfGy' && to === 'graveyard')) g.queue.push({ o, effects: w.effects, label: w.ev === 'ltb' ? 'leaves the battlefield' : 'put into a graveyard', p: ctl });
    if (died) for (const a of g.attachments(o)) for (const w of a.fx.watch || []) if (w.ev === 'attachedDies') g.queue.push({ o: a, effects: w.effects, label: `${o.card.name} died`, p: g.players[a.controller], trig: { o, p: o.controller } });
    g.fire('leaveBf', { o, p: o.controller, ctl: o.controller, to });
    o.lastCounters = o.counters;
    g.leaveBattlefield(o);
    o.controller = o.owner;
    // Unearth: a card returned with unearth is exiled instead of going anywhere else (702.84a)
    if (o.unearthed) { o.unearthed = false; if (to !== 'exile') { to = 'exile'; g.log(`${g.cn(o)} is exiled (unearth)`, { kind: 'minor', rule: '702.84a' }); } }
    o.escaped = false;
    if (o.impending) { o.impending = 0; o.fx = o.card.fx; }
  }
  if (died) { g.diedTurn = g.turn; g.noteDeath(o, snap); }
  if (dieExiler) {
    const gain = Math.max(0, ...dieExiler.battlefield.map(s => s.fx.oppDieExile?.gain || 0));
    if (gain) { const n = g.lifeGain(dieExiler, gain); dieExiler.life += n; g.emit('life', { p: dieExiler.idx, d: n }); }
    g.log(`${g.cn(o)} is exiled instead of dying`, { kind: 'minor' });
  }
  // Blightsteel Colossus: shuffled into the library instead; Dauthi Voidwalker: opponents' cards are exiled instead
  if (to === 'graveyard' && !o.token) {
    // (rules 14: these replacements were applied above; only the "put into a graveyard from anywhere" trigger is left)
    if (r14) { if (from !== 'battlefield') for (const w of o.fx.watch || []) if (w.ev === 'selfGy') g.queue.push({ o, effects: w.effects, label: 'put into a graveyard', p }); }
    else if (o.fx.shuffleOnGy) { to = 'library'; opts = { ...opts, shuffle: true }; g.log(`${g.cn(o)} is shuffled into its owner's library instead`, { kind: 'minor' }); }
    else if (g.players.some(q => q.idx !== o.owner && !q.lost && q.battlefield.some(s => s.fx.oppGyExile))) to = 'exile';
    // "When ~ is put into a graveyard from anywhere" (Kozilek, Emrakul)
    else if (from !== 'battlefield') for (const w of o.fx.watch || []) if (w.ev === 'selfGy') g.queue.push({ o, effects: w.effects, label: 'put into a graveyard', p });
  }
  // Graveyard watchers: cards leaving your graveyard (Insidious Roots), cards arriving (The Gitrog Monster)
  if (from === 'graveyard' && to !== 'graveyard') g.fire('gyLeave', { o, p: o.owner });
  if (to === 'graveyard' && !o.token && from !== 'graveyard') g.fire('toGy', { o, p: o.owner, from });
  // A face-down permanent or spell is turned face up as it goes anywhere else (708.9)
  if (o.faceDown && to !== 'battlefield' && (from === 'battlefield' || from === 'stack')) {
    const hidden = o.card.name;
    g.restoreFace(o);
    g.log(`${esc(hidden)} is revealed: ${g.cn(o)}`, { kind: 'minor', rule: '708.9' });
  }
  // (a bestowed card is a creature card again off the battlefield; a merged permanent's other cards follow it)
  if (o.bestowed && to !== 'battlefield') { o.bestowed = false; o.fx = o.card.fx; }
  if (o.reconfigured) { o.reconfigured = false; o.fx = o.card.fx; }
  if (o.roomUnlocked && from === 'battlefield') { o.roomUnlocked = false; o.fx = o.card.fx; }
  if (o.mutBase && from === 'battlefield') g.unmerge(o, to);
  // (an adventure or the back of a modal double-faced card is the whole card again anywhere but the stack and battlefield)
  if (o.altFaceOn && to !== 'battlefield' && to !== 'stack') { g.mainFace(o); if (to !== 'exile') o.onAdventure = false; }
  if (o.token && to !== 'battlefield') { o.zone = 'gone'; return o; }
  o.mayPlay = null;
  o.cmdStay = false;
  if (o.isCommander && !opts.stay && ['graveyard', 'exile', 'hand', 'library'].includes(to) && !p.lost) {
    // Rules 5: the owner may choose (903.9). To a graveyard or exile it goes there and the choice is made as a
    // state-based action (Game.commanderChoices); to a hand or library it's a replacement, decided now.
    if (g.rules >= 5 && (to === 'graveyard' || to === 'exile')) o.cmdChoicePending = true;
    else if (g.rules >= 5 && p.agent.commanderToCommandZone && !p.agent.commanderToCommandZone(g, p, o, to)) {
      o.cmdStay = true;
      g.log(`${g.pn(p)} lets ${g.cn(o)} go to their ${to} instead of the command zone`, { kind: 'minor', rule: '903.9b' });
    } else {
      g.log(`${g.cn(o)} returns to ${g.pn(p)}'s command zone`, { rule: to === 'graveyard' || to === 'exile' ? '903.9a' : '903.9b' });
      to = 'command';
    }
  }
  o.zone = to;
  if (to === 'battlefield') {
    o.controller = opts.under ?? o.owner; g.players[o.controller].battlefield.push(o);
    o.ts = ++g.tsN;
    // A battle enters with defense counters, and its controller chooses an opponent to protect it (310.4, 310.5)
    if (o.fx.type.battle && g.rules >= 5) g.battleEnters(o);
    // (a daybound or nightbound permanent makes it day if it's neither; at night a daybound one enters transformed)
    if (g.rules >= 5 && (o.fx.daybound || o.fx.nightbound)) {
      if (!g.dayNight) { g.dayNight = 'day'; g.log('It becomes day', { kind: 'minor', rule: '726.2' }); }
      else if (g.dayNight === 'night' && o.fx.daybound && o.card.backCard) g.flipFace(o);
    }
    // Authority of the Consuls, Blind Obedience: opponents' creatures (and more) enter tapped
    const kinds = { creatures: x => x.fx.type.creature, 'creatures and nonbasic lands': x => x.fx.type.creature || (x.fx.type.land && !x.fx.type.basic), 'artifacts and creatures': x => x.fx.type.creature || x.fx.type.artifact, permanents: () => true, 'nonbasic lands': x => x.fx.type.land && !x.fx.type.basic, artifacts: x => x.fx.type.artifact };
    if (!r14 && g.opponents(g.players[o.controller]).some(q => q.battlefield.some(s => s.fx.oppEnterTapped && kinds[s.fx.oppEnterTapped]?.(o)))) opts = { ...opts, tapped: true };
    // (rules 9) shock, check, fast and reveal lands: tapped unless their condition holds as they enter
    if (g.rules >= 9 && o.fx.enterCond9 && from !== 'battlefield' && !opts.tapped && g.entersTappedNow(o, g.players[o.controller], opts.payLife)) opts = { ...opts, tapped: true };
    // (rules 14) Whether it enters tapped, through the replacement-effect loop: an opponent's "enter tapped" (Authority of
    // the Consuls) and your "lands enter untapped" (Amulet of Vigor) both apply, in the order you choose (616.1)
    if (r14) { const ev = R.replace(g, { type: 'enter', o, tapped: !!opts.tapped }, R.enterDefs(g, { o }), R.enterScore, g.players[o.controller]); opts = { ...opts, tapped: ev.tapped, enterDone: true }; }
  }
  else if (to === 'library' && opts.bottom) p.library.unshift(o);
  else if (to === 'library' && opts.third) p.library.splice(Math.max(0, p.library.length - 2), 0, o);
  else p[to].push(o);
  if (to === 'library' && opts.shuffle) shuffle(p.library, g.rand);
  if (to === 'battlefield' && o.fx.type.land) {
    const q = g.players[o.controller];
    for (const s of q.battlefield) {
      const effects = s.fx.landfallModes ? q.agent.chooseModes(g, q, s, s.fx.landfallModes) : s.fx.landfall;
      if (effects?.length) g.queue.push({ o: s, effects, label: `landfall (${o.card.name})`, p: q });
    }
    // Bloodghast-style landfall that brings the card back from the graveyard
    for (const s of q.graveyard) if (s.fx.landfall.some(e => e.fromGy)) g.queue.push({ o: s, effects: s.fx.landfall, label: `landfall (${o.card.name})`, p: q });
  }
  if (to === 'battlefield') {
    o.lore = 0;
    // (a new object: its once-each-turn abilities haven't triggered yet, 400.7)
    if (o.onceUsed) o.onceUsed = '';
    o.tapped = !!opts.tapped; o.sick = true; o.damage = 0; o.usedPW = false;
    o.counters = typeof o.fx.entersCounters === 'number' ? g.moreCounters(o, o.fx.entersCounters) : 0;
    o.enteredTurn = g.turn;
    const ctl = g.players[o.controller];
    // Amulet of Vigor-style "lands you control enter untapped"
    if (!opts.enterDone && o.fx.type.land && o.tapped && ctl.battlefield.some(s => s.fx.landsUntapped && (typeof s.fx.landsUntapped !== 'object' || g.isA(o, s.fx.landsUntapped.what)))) o.tapped = false;
    // Woe Strider: escapes with counters; the Overlords cast for their impending cost aren't creatures yet
    if (o.escaped && o.fx.escapeCounters) o.counters += g.moreCounters(o, o.fx.escapeCounters);
    if (o.impendingCast && o.fx.impending) {
      o.impendingCast = false;
      o.impending = o.fx.impending.n;
      o.fx = { ...o.card.fx, type: { ...o.card.fx.type, creature: false } };
      g.log(`${g.cn(o)} enters with ${o.impending} time counters (impending): it isn't a creature yet`, { kind: 'minor', rule: '702.176a' });
    }
    // Riot for the team, and "each other creature you control enters with an additional +1/+1 counter"
    if (o.fx.type.creature) for (const s of ctl.battlefield) {
      if (s === o) continue;
      if (s.fx.teamRiot && !o.token) o.counters += 1;
      const tc = s.fx.teamCounter;
      // (Arwen, Master Biomancer: as many as its toughness or power; Giada: one for each Angel already there)
      if (tc?.dynSelf || tc?.perTribe) { if (!tc.tribe || g.isA(o, tc.tribe)) { const k = tc.dynSelf === 'power' ? g.power(s) : tc.dynSelf === 'toughness' ? g.toughness(s) : ctl.battlefield.filter(x => x !== o && x.fx.type.creature && g.isA(x, tc.tribe)).length; if (k > 0) o.counters += g.moreCounters(o, k); } }
      else if (tc && (tc === 'any' || (tc.tribe ? g.isA(o, tc.tribe) : s.chosenType && g.isA(o, s.chosenType)))) o.counters += g.moreCounters(o, 1);
    }
    if (o.fx.type.planeswalker) o.loyalty = parseInt(o.card.loyalty, 10) || 3;
    g.entered(o);
  }
  return o;
}
// "Choose a creature type" on resolution: the commonest type among these cards (p's creatures by default)
/** @param {import('./engine.js').Game} g */
export function bestType(g, p, cards = p.battlefield.filter(o => o.fx.type.creature)) {
  const n = {};
  for (const c of cards) for (const s of c.fx.subtypes) n[s] = (n[s] || 0) + 1;
  return Object.entries(n).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
}
// A permanent arrived (cast, put there, or created as a token): "whenever a creature enters" watchers,
// evolve, bloodthirst, and the upkeep keywords that start counting now
/** @param {import('./engine.js').Game} g */
export function entered(g, o) {
  const p = g.players[o.controller];
  o.monstrous = false;
  // (rules 14) Replacement text this card has that the reader didn't read: said once a game, never applied approximately
  if (g.rules >= 14 && !g.sim) for (const x of R.replacementGaps(o.card, [...(o.fx.unread || []), ...droppedSentences(o.card)])) R.gap(g, o.card, x.line, x.why);
  // "Choose a creature type": the commonest type among the controller's creatures (Kindred Discovery, Vanquisher's Banner)
  if (o.fx.chooseType && !o.chosenType) {
    const n = {};
    for (const c of [...p.battlefield, ...p.hand, ...p.library, ...p.command]) if (c.fx.type.creature) for (const s of c.fx.subtypes) n[s] = (n[s] || 0) + 1;
    o.chosenType = Object.entries(n).sort((a, b) => b[1] - a[1])[0]?.[0] || 'human';
    g.log(`${g.cn(o)}: ${g.pn(p)} chooses ${esc(o.chosenType)}`, { kind: 'minor' });
  }
  // "As ~ enters, choose a color": the commonest color among the controller's cards (Caged Sun, Heraldic Banner)
  if (o.fx.chooses === 'a color' && !o.chosenColor) {
    const n = {};
    for (const c of [...p.battlefield, ...p.hand, ...p.library, ...p.command]) for (const col of c.card.colors || []) n[col] = (n[col] || 0) + 1;
    o.chosenColor = Object.entries(n).sort((a, b) => b[1] - a[1])[0]?.[0] || 'W';
  }
  if (o.fx.kwN?.bloodthirst && g.opponents(p).some(q => q.damagedTurn === g.turn)) o.counters += o.fx.kwN.bloodthirst;
  if (o.fx.echo) o.echoDue = true;
  if (o.fx.entersNamed) (o.named ||= {})[o.fx.entersNamed.kind] = o.fx.entersNamed.n === 'X' ? 0 : o.fx.entersNamed.n;
  // Everflowing Chalice: a charge counter if it was kicked
  if (o.fx.chargeKick) (o.named ||= {}).charge = o.kicked ? 1 : 0;
  if (o.fx.kwN?.vanishing) o.timeCounters = o.fx.kwN.vanishing;
  if (o.fx.kwN?.fading) o.timeCounters = o.fx.kwN.fading;
  if (o.fx.cumulative) o.age = 0;
  // Evolve (702.100): a bigger creature entering under your control grows the evolver
  if (o.fx.type.creature) for (const e of p.battlefield) {
    if (e === o || !e.fx.kw.has('evolve') || !e.fx.type.creature) continue;
    if (g.basePower(o.card) > g.power(e) || g.baseToughness(o.card) > g.toughness(e)) { e.counters++; g.log(`${g.cn(e)} evolves`, { kind: 'minor', rule: '702.100a' }); }
  }
  g.fire('enter', { o, p: p.idx });
  if (o.token) g.fire('tokenMade', { o, p: p.idx });
}
/** @param {import('./engine.js').Game} g */
export function leaveBattlefield(g, o) {
  // A clone stops being a copy when it leaves (and a crewed vehicle stops being a creature)
  if (o.baseCard) { o.card = o.baseCard; o.fx = o.baseCard.fx; o.baseCard = null; }
  if (o.crewed) { o.fx = o.card.fx; o.crewed = false; }
  Object.assign(o, { tapped: false, damage: 0, deathtouched: false, counters: 0, tempP: 0, tempT: 0, tempKw: null, attachedTo: null, attacking: null, blocking: null, blockedBy: [], blocked: false, stolenBy: null, stolenFrom: null, hadMinus: false, regen: 0, suspected: false, chosenType: null, permKw: null, animPT: null, goaded: null, dashed: false, blitzed: false, echoDue: false, kicked: false, chosenColor: null, level: null, exerted: false });
  // Whatever this permanent was holding on to goes back to the player it was taken from (or its owner)
  for (const q of g.players) for (const s of [...q.battlefield]) {
    if (s.stolenBy !== o.iid) continue;
    const back = g.players[s.stolenFrom]?.lost ? g.players[s.owner] : g.players[s.stolenFrom];
    s.stolenBy = s.stolenFrom = null;
    if (!back || back.lost || back === q) continue;
    q.battlefield.splice(q.battlefield.indexOf(s), 1);
    s.controller = back.idx;
    Object.assign(s, { attacking: null, blocking: null, blockedBy: [], blocked: false });
    back.battlefield.push(s);
    g.log(`${g.cn(s)} returns to ${g.pn(back)} now that ${g.cn(o)} is gone`, { kind: 'minor', rule: '611.2a' });
  }
  for (const q of g.players) for (const a of [...q.battlefield]) if (a.attachedTo === o) {
    a.attachedTo = null;
    // (a bestowed Aura becomes a creature again; a reconfigured equipment creature too)
    if (a.bestowed) { g.unbestow(a); continue; }
    if (a.reconfigured) { a.reconfigured = false; a.fx = a.card.fx; continue; }
    if (a.fx.type.aura) { g.move(a, 'graveyard'); g.log(`${g.cn(a)} is put into the graveyard (not attached)`, { rule: '704.5m', kind: 'minor' }); }
  }
}
/** @param {import('./engine.js').Game} g */
export function draw(g, p, n = 1, quiet = false) {
  if (g.rules >= 14) return draw14(g, p, n, quiet);
  let drawn = 0;
  // Alhammarret's Archive, Teferi's Ageless Insight: every draw but the first in your draw step is doubled
  const firstInStep = g.phase === 'draw' && g.active === p.idx && !(p.drawsThisTurn?.turn === g.turn && p.drawsThisTurn.n);
  if (n > 0 && p.battlefield.some(s => s.fx.drawDouble)) n = firstInStep ? 1 + (n - 1) * 2 : n * 2;
  // Dredge (702.52): an AI pilot with a big library swaps a draw for milling and taking the dredge card back
  if (n === 1 && !p.agent.human && g.turn) {
    const d = p.graveyard.filter(c => c.fx.dredge && p.library.length > c.fx.dredge + 8).sort((a, b) => p.agent.value(g, b) - p.agent.value(g, a))[0];
    if (d && p.agent.value(g, d) >= 2.5) {
      for (let k = 0; k < d.fx.dredge; k++) g.move(p.library[p.library.length - 1], 'graveyard');
      g.move(d, 'hand');
      g.log(`${g.pn(p)} dredges ${g.cn(d)} instead of drawing (mills ${d.fx.dredge})`, { kind: 'minor', rule: '702.52a' });
      return;
    }
  }
  // Underrealm Lich: each draw looks at three, keeps one and puts the rest into the graveyard
  const lich = p.battlefield.some(s => s.fx.lichDraw);
  // Narset, Parter of Veils: an opponent's draws stop after the first each turn
  const capped = g.opponents(p).some(q => q.battlefield.some(s => s.fx.drawCap));
  // Notion Thief: an opponent's extra draws are made by the thief's controller instead
  const thief = !g.inThief && g.opponents(p).find(q => q.battlefield.some(s => s.fx.notionThief));
  for (let i = 0; i < n; i++) {
    if (thief && !(firstInStep && i === 0)) { g.inThief = true; try { g.draw(thief, 1, true); } finally { g.inThief = false; } g.log(`${g.pn(thief)} draws instead of ${g.pn(p)} (Notion Thief)`, { kind: 'minor' }); continue; }
    if (capped && p.drawsThisTurn?.turn === g.turn && p.drawsThisTurn.n >= 1) { g.log(`${g.pn(p)} can't draw more than one card this turn (Narset)`, { kind: 'minor' }); break; }
    if (lich && p.library.length > 3) for (let k = 0; k < 2; k++) g.move(p.library[p.library.length - 2], 'graveyard');
    if (!drawCardNow(g, p, i)) break;
    drawn++;
  }
  if (!quiet && drawn) g.log(`${g.pn(p)} draws ${drawn === 1 ? 'a card' : drawn + ' cards'}`, { kind: 'minor' });
}
// (rules 14) Each card drawn is its own event through the replacement-effect loop (replacements.js drawDefs): drawn
// twice (Alhammarret's Archive), by an opponent instead (Notion Thief), looked at three (Underrealm Lich) or dredged.
// A doubled draw becomes two draws that the same effect doesn't double again (614.5), but other effects still can.
/** @param {import('./engine.js').Game} g */
function draw14(g, p, n, quiet) {
  let drawn = 0, i = 0;
  // (Narset, Parter of Veils: a restriction, not a replacement: an opponent's draws stop after the first each turn)
  const capped = g.opponents(p).some(q => q.battlefield.some(s => s.fx.drawCap));
  const queue = Array.from({ length: Math.max(0, n) }, () => ({ applied: new Set() }));
  for (let guard = 0; queue.length && guard < 400; guard++) {
    const base = queue.shift() || { applied: new Set() };
    const first = g.phase === 'draw' && g.active === p.idx && !(p.drawsThisTurn?.turn === g.turn && p.drawsThisTurn.n);
    const ev = R.replace(g, { type: 'draw', p, first, applied: base.applied }, R.drawDefs(g, { p }), R.drawScore, p);
    const count = ev.count || 1;
    if (ev.instead === 'thief') {
      const q = g.players[ev.thief];
      g.inThief = true; try { g.draw(q, count, true); } finally { g.inThief = false; }
      g.log(`${g.pn(q)} draws instead of ${g.pn(p)} (Notion Thief)`, { kind: 'minor' });
      continue;
    }
    if (ev.instead === 'dredge') {
      const d = ev.dredge;
      for (let k = 0; k < d.fx.dredge; k++) g.move(p.library[p.library.length - 1], 'graveyard');
      g.move(d, 'hand');
      g.log(`${g.pn(p)} dredges ${g.cn(d)} instead of drawing (mills ${d.fx.dredge})`, { kind: 'minor', rule: '702.52a' });
      continue;
    }
    if (count > 1) { for (let k = 0; k < count; k++) queue.unshift({ applied: new Set(ev.applied) }); continue; }
    if (capped && p.drawsThisTurn?.turn === g.turn && p.drawsThisTurn.n >= 1) { g.log(`${g.pn(p)} can't draw more than one card this turn (Narset)`, { kind: 'minor' }); break; }
    if (ev.instead === 'lich' && p.library.length > 3) for (let k = 0; k < 2; k++) g.move(p.library[p.library.length - 2], 'graveyard');
    if (!drawCardNow(g, p, i++)) break;
    drawn++;
  }
  if (!quiet && drawn) g.log(`${g.pn(p)} draws ${drawn === 1 ? 'a card' : drawn + ' cards'}`, { kind: 'minor' });
}
// One card from the top of the library into the hand, with everything that notices a draw (false: the library is empty)
/** @param {import('./engine.js').Game} g */
function drawCardNow(g, p, i) {
  {
    const o = p.library.pop();
    if (!o) { p.drewFromEmpty = true; g.log(`${g.pn(p)} tries to draw from an empty library`, { rule: '704.5b' }); return false; }
    o.zone = 'hand'; p.hand.push(o); p.stats.draws = (p.stats.draws || 0) + 1;
    // Faerie Mastermind: an opponent's second draw each turn
    if (p.drawsThisTurn?.turn !== g.turn) p.drawsThisTurn = { turn: g.turn, n: 0 };
    ++p.drawsThisTurn.n;
    // Miracle (702.94): the first card drawn this turn may be cast for its miracle cost
    if (o.fx.miracle && p.drawsThisTurn.n === 1) { o.miracleTurn = g.turn; g.log(`${g.pn(p)} reveals a miracle: ${g.cn(o)}`, { kind: 'minor', rule: '702.94a' }); }
    if (g.turn) g.fire('draw', { p: p.idx, nth: p.drawsThisTurn.n });
    if (p.drawsThisTurn.n === 2) for (const q of g.opponents(p)) for (const s of q.battlefield) if (s.fx.onOppSecondDraw) g.queue.push({ o: s, effects: s.fx.onOppSecondDraw, label: `${p.name} drew their second card this turn`, p: q });
    if (i < 3) g.emit('move', { iid: o.iid, owner: p.idx, from: 'library', to: 'hand' });
    // Smothering Tithe: pay up or the watcher gets the effect
    for (const q of g.opponents(p)) for (const s of q.battlefield) {
      const od = s.fx.onOppDraw;
      if (!od) continue;
      g.queue.push({ o: s, effects: [{ k: 'tax', tax: od.tax, payer: p.idx, effects: od.effects }], label: `${p.name} drew a card`, p: q });
    }
  }
  return true;
}
/** @param {import('./engine.js').Game} g */
export function destroy(g, o, noRegen = false) {
  if (g.has(o, 'indestructible')) return false;
  // ("It can't be regenerated": rules 9, see effects.js)
  if (!noRegen && g.regenerate(o)) return false;
  // Umbra armor (702.89): the aura is destroyed instead, and the damage is removed
  const umbra = g.attachments(o).find(a => a.fx.umbra);
  if (umbra) { o.damage = 0; o.deathtouched = false; g.move(umbra, 'graveyard'); g.log(`${g.cn(umbra)} is destroyed instead of ${g.cn(o)} (umbra armor)`, { kind: 'minor', rule: '702.89a' }); return false; }
  g.move(o, 'graveyard');
  return true;
}
// A regeneration shield (701.15): instead of being destroyed, tap it, remove its damage and take it out of combat
/** @param {import('./engine.js').Game} g */
export function regenerate(g, o) {
  if (!(o.regen > 0)) return false;
  o.regen--;
  Object.assign(o, { tapped: true, damage: 0, deathtouched: false, attacking: null, blocking: null, blockedBy: [], blocked: false });
  g.log(`${g.cn(o)} regenerates`, { kind: 'minor', rule: '701.15a' });
  return true;
}
// A creature died (700.4): its own "when ~ dies" and every "whenever a creature dies" watcher trigger
/** @param {import('./engine.js').Game} g @param {any} o @param {any} [snap] */
export function noteDeath(g, o, snap = {}) {
  // (Hushbringer, rules 6: a creature dying triggers nothing, its own undying and persist included)
  if (g.rules >= 6 && o.fx.type.creature && g.alive().some(q => q.battlefield.some(s => s.fx.noDieCreature))) { if (o.fx.kwN?.modular && snap.counters > 0) o.lastCounters = snap.counters; return; }
  g.trigger(o, 'dies');
  const p = g.players[o.owner];
  // Undying and persist bring it back with a counter, if it didn't already have one (702.93, 702.79)
  const undying = snap.granted ? snap.granted.undying : o.fx.kw.has('undying');
  const persist = snap.granted ? snap.granted.persist : o.fx.kw.has('persist');
  if (!o.token && undying && !(snap.counters > 0)) g.queue.push({ o, effects: [{ k: 'returnSelf', counters: 1 }], label: 'undying', p });
  else if (!o.token && persist && !snap.minus) g.queue.push({ o, effects: [{ k: 'returnSelf', counters: -1 }], label: 'persist', p });
  if (o.fx.kwN?.modular && snap.counters > 0) o.lastCounters = snap.counters;
  if (snap.blitzed) g.queue.push({ o, effects: [{ k: 'draw', n: 1 }], label: 'blitz', p });
  for (const q of g.alive()) for (const w of q.battlefield) {
    const d = w.fx.onDeath;
    if (!d || (d.other && w === o)) continue;
    if (d.who === 'yours' && o.controller !== q.idx) continue;
    if (d.who === 'opponents' && o.controller === q.idx) continue;
    if (d.nontoken && o.token) continue;
    if (d.what && !g.isA(o, d.what)) continue;
    if (d.without && o.fx.kw.has(d.without)) continue;
    if (d.turnOnce9 && !g.onceOk(w, 'death')) continue;
    g.queue.push({ o: w, effects: d.effects, label: `${o.card.name} died`, p: q, trig: { o, p: o.controller } });
    // Teysa Karlov: death triggers happen an additional time
    if (q.battlefield.some(x => x.fx.deathTwice)) g.queue.push({ o: w, effects: d.effects, label: `${o.card.name} died (again)`, p: q, trig: { o, p: o.controller } });
  }
}
/** @param {import('./engine.js').Game} g */
export function sacrifice(g, p, o, why = '') {
  // (Fling and friends use the sacrificed creature's power)
  if (o.fx.type.creature) { p.lastSacPower = Math.max(0, g.power(o)); p.lastSacMv = o.card.cmc || 0; }
  g.log(`${g.pn(p)} sacrifices ${g.cn(o)}${why}`, { kind: 'removal' });
  g.move(o, 'graveyard');
  g.fire('sac', { o, p: p.idx });
}
// Discarding (701.8): "whenever you discard" watchers and madness-style payoffs see it
/** @param {import('./engine.js').Game} g @param {any} p @param {any[]} cards @param {string | null} [why] */
export function discard(g, p, cards, why = '') {
  for (const c of cards) {
    // Madness (702.35): a discarded madness card is exiled instead, and its owner may cast it for the madness cost
    if (c.fx.madness && g.rules >= 5 && c.zone === 'hand') {
      g.move(c, 'exile');
      c.madnessPending = true;
      g.queue.push({ o: c, effects: [{ k: 'madnessCast' }], label: 'madness', p: g.players[c.owner] });
    } else g.move(c, 'graveyard');
    g.fire('discard', { o: c, p: p.idx });
  }
  if (cards.length && why !== null) g.log(`${g.pn(p)} discards ${cards.map(c => g.cn(c)).join(', ')}${why}`, { kind: 'removal' });
}
// Exile and return (blink): a new object with fresh ETB triggers, no counters, auras fall off
/** @param {import('./engine.js').Game} g */
export function blink(g, o) {
  const owner = g.players[o.owner];
  if (o.token) { g.move(o, 'exile'); return null; }
  g.move(o, 'exile', { stay: true });
  o.controller = owner.idx;
  g.move(o, 'battlefield');
  g.trigger(o, 'etb');
  return o;
}
/** @param {import('./engine.js').Game} g */
export function createToken(g, p, e, src) {
  // Divine Visitation: creature tokens are 4/4 flying Angels instead
  if (p.battlefield.some(s => s.fx.tokenAngel)) e = { ...e, p: 4, t: 4, desc: 'white angel', kw: ['flying'] };
  const kw = e.kw || [];
  const sub = (e.desc || '').split(' ').filter(w => w && !['white', 'blue', 'black', 'red', 'green', 'colorless', 'and', 'legendary', 'artifact', 'enchantment'].includes(w));
  const name = sub.map(w => w[0].toUpperCase() + w.slice(1)).join(' ') || 'Token';
  const card = {
    name, frontName: name, typeLine: `Token Creature — ${name}`, manaCost: '', cmc: 0, text: '',
    power: String(e.p), toughness: String(e.t), keywords: kw.map(k => k[0].toUpperCase() + k.slice(1)), produced: [],
    art: src.card.art, colorIdentity: [], colors: [], isToken: true, fullText: kw.join(', '),
  };
  card.fx = analyzeCard(card);
  const o = g.mk(card, p, { token: true });
  o.zone = 'battlefield'; o.sick = true;
  p.battlefield.push(o);
  g.entered(o);
  return o;
}
/** @param {import('./engine.js').Game} g */
export function createTreasure(g, p, src) { return g.createArtifactToken(p, 'treasure', src); }
// Treasure, Clue, Food, Blood, Map and Powerstone tokens, with their own abilities written out as text
/** @param {import('./engine.js').Game} g */
export function createArtifactToken(g, p, kind, src) {
  const TEXT = {
    treasure: '{T}, Sacrifice this artifact: Add one mana of any color.',
    clue: '{2}, Sacrifice this artifact: Draw a card.',
    food: '{2}, {T}, Sacrifice this artifact: You gain 3 life.',
    blood: '{1}, {T}, Discard a card, Sacrifice this artifact: Draw a card.',
    map: '{1}, {T}, Sacrifice this artifact: Target creature you control explores. Activate only as a sorcery.',
    powerstone: '{T}: Add {C}. This mana can\'t be spent to cast a nonartifact spell.',
  };
  const name = kind[0].toUpperCase() + kind.slice(1);
  const card = {
    name, frontName: name, typeLine: `Token Artifact — ${name}`, manaCost: '', cmc: 0, text: TEXT[kind], fullText: TEXT[kind],
    keywords: [], produced: kind === 'treasure' ? [...COLORS] : kind === 'powerstone' ? ['C'] : [], art: src.card.art, isToken: true, colorIdentity: [], colors: [],
  };
  card.fx = analyzeCard(card);
  const o = g.mk(card, p, { token: true });
  o.zone = 'battlefield';
  p.battlefield.push(o);
  g.entered(o);
  return o;
}
// Land searches (fetch lands, Cultivate, landcycling): you pick in your seat; the AI takes the colors it's short of
/** @param {import('./engine.js').Game} g */
export async function fetchLands(g, p, e, src) {
  const n = e.n === 'X' ? 1 : e.n;
  g.fire('search', { p: p.idx });
  const identity = new Set(p.command.concat(p.battlefield.filter(o => o.isCommander)).flatMap(o => o.card.colorIdentity));
  const have = c => p.battlefield.filter(o => o.fx.mana?.colors.includes(c)).length;
  // ("an Island or Swamp card": only those types; "a basic land card": only basics)
  const subs = e.subs?.length ? e.subs : e.sub ? [e.sub] : null;
  const cands = p.library.filter(o => o.fx.type.land && (!e.basic || o.fx.type.basic) && (!subs || subs.some(s => o.fx.subtypes.includes(s))) && (o.fx.mana || p.agent.chooseCardsAsync));
  const score = o => Math.max(0, ...(o.fx.mana?.colors || []).map(c => (identity.has(c) ? 10 - have(c) : 0)));
  cands.sort((a, b) => score(b) - score(a));
  let got = cands.slice(0, n);
  if (p.agent.chooseCardsAsync && cands.length) {
    const what = `${e.basic ? 'basic ' : ''}${subs ? subs.join(' or ') : 'land'}`;
    const where = e.split && n > 1 ? ' (the first one you pick goes onto the battlefield, the rest to your hand)' : e.bf ? ` (onto the battlefield${e.tapped ? ' tapped' : ''})` : ' (to your hand)';
    const picked = await p.agent.chooseCardsAsync(g, p, cands, n, `<b>${src ? g.cn(src) : 'Search'}</b>: search your library for ${n > 1 ? `up to ${n} ${what} cards` : `a ${what} card`}${where}`);
    if (picked) got = picked;
  }
  for (const [i, o] of got.entries()) {
    const toBf = e.bf && !(e.split && i > 0);
    const payLife = toBf && !e.tapped ? await g.askPayForLand(p, o) : undefined;
    g.move(o, toBf ? 'battlefield' : 'hand', { tapped: e.tapped, payLife });
  }
  shuffle(p.library, g.rand);
  if (got.length) g.log(`${g.pn(p)} searches for ${got.map(o => g.cn(o)).join(', ')}${e.bf ? '' : ' (to hand)'}`, { kind: 'minor' });
}
