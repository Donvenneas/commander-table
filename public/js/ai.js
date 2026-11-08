// Heuristic AI pilots. Each agent evaluates board state, threat level of every opponent,
// and remembers who has been hitting it (grudges) when choosing attacks and removal targets.
// Beyond combat they assemble known combos, tutor for missing pieces, hold pieces until the
// combo can win, bait out counterspells, fight counter wars, break opponents' combos, and
// spend mana they held up on instants at the end of other players' turns.
import { parseCost } from './engine.js';
import { combosFor, combosIn, comboState, comboBlocked } from './combos.js';
import { esc } from './util.js';
import { bestAttacks, bestBlocks } from './combatai.js';
import { knownType, isKing } from './kingdomsPlay.js';
import { lookAheadPlay } from './lookahead.js';

// Kingdoms: how much this pilot wants to fight player q, by its own role and what it can see of q's
function kingdomsWeight(g, me, q) {
  if (!me.role || !q.role) return 1;
  const mt = me.role.type, qt = knownType(g, me, q);
  // (the table's role counts are public: while Assassins remain, the King falling ends the game in their favour)
  const assassinsLeft = g.players.some(r => r.role?.type === 'assassin' && !r.lost);
  // Whoever has been hurting the King draws the fire of everyone who needs the King alive
  const king = g.players.find(r => isKing(r) && !r.lost);
  const guard = king && king !== q ? 1 + Math.min(2, (king.grudge[q.idx] || 0) / 10) : 1;
  if (mt === 'king') return qt === 'knight' ? 0.1 : qt ? 1.5 : 1;
  if (mt === 'knight') return qt === 'king' ? 0.05 : (qt === 'knight' ? 0.3 : qt ? 1.4 : 1) * guard;
  if (mt === 'assassin') return qt === 'king' ? 1.8 : qt === 'assassin' ? 0.1 : qt === 'knight' ? 1.3 : qt === 'bandit' ? 0.9 : 0.7;
  if (mt === 'bandit') return qt === 'bandit' ? 0.05 : qt === 'assassin' ? 1.5 : qt === 'king' ? (assassinsLeft ? 0.3 : 1.2) : assassinsLeft ? guard : 1;
  // Renegades: the Champion hunts the Challenger, Cultists spare Cultists, the rest wear down the leader
  if (me.role.id === 'champion' && g.kd?.challenger === q.idx) return 3;
  if (me.role.id === 'cultist' && q.role.up && q.role.id === 'cultist') return 0.1;
  return isKing(q) ? (assassinsLeft ? 0.4 : 1) : (qt === 'assassin' ? 1.2 : 1) * (assassinsLeft ? guard : 1);
}

const KW_VALUE = {
  flying: 1.5, trample: 1, deathtouch: 1.5, lifelink: 1, vigilance: 0.5, haste: 0.5, 'first strike': 0.8,
  'double strike': 2, menace: 1, hexproof: 1.2, indestructible: 2, unblockable: 2, reach: 0.4, shroud: 1,
  infect: 2, wither: 0.8, fear: 1, intimidate: 1, shadow: 1.5, horsemanship: 1.5, skulk: 0.8, ward: 1, exalted: 0.8,
  undying: 1.5, persist: 1.5, annihilator: 3, toxic: 1, 'battle cry': 0.8, afflict: 0.8, evolve: 0.6, decayed: -1,
};
const INTERACTION = ['counter', 'remove', 'wipe', 'bounce'];
const COMBO_SCORE = { win: 1000, damage: 1000, drain: 1000, attack: 1000, mill: 500, mana: 40 };
// Cards that turn unbounded mana into a win (see Game.comboResult)
const hasManaSink = p => [...p.hand, ...p.command, ...p.battlefield, ...p.library].some(o => ['Walking Ballista', 'Thrasios, Triton Hero', 'Kinnan, Bonder Prodigy'].includes(o.card.name));
const comboScore = (c, p) => (c.result === 'mana' && hasManaSink(p) ? 950 : COMBO_SCORE[c.result]);

export const STYLES = {
  aggressive: 'Aggressive',
  balanced: 'Balanced',
  defensive: 'Defensive',
  combo: 'Combo',
  cedh: 'cEDH',
};

// Pilots that check their main-phase plays by look-ahead (lookahead.js) when the table has it switched on
// (Setup: "AI look-ahead"). Casual pilots (brackets 1 and 2) don't: they aren't meant to find the best play.
export const LOOKAHEAD_STYLES = new Set(['cedh', 'balanced', 'combo', 'aggressive', 'defensive']);
export const wantsLookahead = (style, noise = 0) => LOOKAHEAD_STYLES.has(style) && noise <= 0.05;

export function guessStyle(deck) {
  const all = deck.cards.flatMap(({ card, qty }) => Array(qty).fill(card));
  const combos = combosIn([...deck.commanders, ...all]);
  // cEDH: real win combos plus lots of tutors and fast mana
  const tutors = all.filter(c => [...c.fx.spell, ...c.fx.etb].some(e => e.k === 'tutor')).length;
  const fast = all.filter(c => !c.fx.type.land && (c.cmc || 0) <= 2 && (c.fx.mana || c.fx.spell.some(e => e.k === 'addMana'))).length;
  if (combos.some(c => c.result !== 'mana') && tutors >= 4 && fast >= 6) return 'cedh';
  if (combos.some(c => c.result !== 'mana') || combos.length >= 2) return 'combo';
  const creatures = all.filter(c => c.fx.type.creature).length;
  const interaction = all.filter(c => [...c.fx.spell, ...c.fx.etb].some(e => INTERACTION.includes(e.k))).length;
  const avgCmc = all.filter(c => !c.fx.type.land).reduce((s, c) => s + c.cmc, 0) / Math.max(1, all.filter(c => !c.fx.type.land).length);
  if (creatures >= 28 && avgCmc < 3.5) return 'aggressive';
  if (interaction >= 16 && interaction > creatures) return 'defensive';
  return 'balanced';
}

const isCounter = o => o.fx.spell.some(e => e.k === 'counter');
// (Valley Floodcaller and friends let noncreature, or all, spells be cast as though they had flash)
const instantSpeed = o => !o.ownerP?.sorceryLocked && (o.fx.type.instant || o.fx.kw.has('flash')
  || (!o.fx.type.land && (!!o.ownerP?.flashNow || !!o.ownerP?.battlefield.some(x => x.fx.flashGrant === 'any' || (x.fx.flashGrant === 'noncreature' && !o.fx.type.creature)))));
const needsOwnTarget = e => e.k === 'pump' || e.k === 'blink' || (e.k === 'protect' && e.scope === 'one');

export class Agent {
  // noise: how loosely this pilot plays (low brackets play more casually; see brackets.js)
  // lookahead: check the best main-phase plays by simulating the rest of the turn (lookahead.js)
  constructor(style = 'balanced', { noise = 0, lookahead = false } = {}) { this.style = style; this.baited = -1; this.noise = noise; this.lookahead = !!lookahead;
    // (per-deck memory, filled in by the engine from learn.js; how many look-aheads this turn)
    this.learned = null; this.laTurn = -1; this.laCount = 0;
  }
  // Combo pilots fight like defensive players: they only need to survive until the combo
  get cstyle() { return this.style === 'combo' || this.style === 'cedh' ? 'defensive' : this.style; }

  // ---------- evaluation
  value(g, o) {
    const f = o.fx, t = f.type;
    const onBf = o.zone === 'battlefield';
    let v = 0;
    if (t.creature) {
      const p = onBf ? g.power(o) : g.basePower(o.card);
      const tt = onBf ? g.toughness(o) : g.baseToughness(o.card);
      v += p * 1.4 + tt * 0.8;
      for (const [k, kv] of Object.entries(KW_VALUE)) if (onBf ? g.has(o, k) : f.kw.has(k)) v += k === 'double strike' ? p : kv;
    } else if (t.planeswalker) v += 5 + (o.loyalty || parseInt(o.card.loyalty, 10) || 3) * 0.6;
    else if (t.land) v += 0.5;
    else v += 1 + (o.card.cmc || 0) * 0.5;
    if (f.anthem) v += 3;
    if (f.mana && !t.land) v += 1.5;
    if (f.upkeep.length || f.endstep.length || f.attack.length || f.abilities.length || f.watch?.length) v += 2;
    if (o.isCommander) v += 4;
    return v;
  }
  // The AI's wish for the top of its library: lands while it's short of them, castable spells, combo pieces
  topWorth(g, p, o) {
    const lands = p.battlefield.filter(x => x.fx.type.land).length + p.hand.filter(x => x.fx.type.land).length;
    if (o.fx.type.land) return lands < 5 ? 3 : lands < 7 ? 1 : -1;
    if (this.pieceWorth(g, p, o)) return 4;
    const cmc = o.card.cmc || 0;
    if (cmc > lands + 3) return -0.5;
    return Math.min(3, this.value(g, o) * 0.4) + ([...o.fx.spell, ...o.fx.etb].some(e => ['tutor', 'draw', 'remove', 'wipe', 'counter'].includes(e.k)) ? 1 : 0);
  }
  // Scry and surveil: keep the cards worth drawing soon on top (best first), the rest go away
  chooseScry(g, p, cards, kind) {
    const scored = cards.map(o => ({ o, s: this.topWorth(g, p, o) + (kind === 'surveil' && (o.fx.flashback || o.fx.escape || o.fx.unearth || o.fx.embalm) ? -2 : 0) }));
    const keep = scored.filter(x => x.s > 0.5).sort((a, b) => b.s - a.s).map(x => x.o);
    return { keep, away: cards.filter(o => !keep.includes(o)) };
  }
  // Ninjutsu: trade an unblocked attacker for a ninja worth more in combat
  ninjutsu(g, p, unblocked) {
    if (!unblocked.length) return null;
    for (const ninja of p.hand.filter(o => o.fx.ninjutsu && g.planPayment(p, parseCost(o.fx.ninjutsu), 0))) {
      const out = [...unblocked].sort((a, b) => this.value(g, a) - this.value(g, b))[0];
      const gain = g.basePower(ninja.card) - g.power(out) + (ninja.fx.combatDamage.length ? 3 : 0) + (out.token ? -0.5 : 0) + (out.fx.etb.length ? 1 : 0);
      if (gain > 0.5) return { ninja, out };
    }
    return null;
  }
  // Crew a vehicle with creatures that won't attack anyway (summoning sick, or small)
  crewPlan(g, p, v) {
    if (!v.fx.crew || v.crewed || v.tapped || (v.sick && !g.has(v, 'haste'))) return null;
    const pool = p.battlefield.filter(c => c !== v && c.fx.type.creature && !c.tapped && g.power(c) > 0)
      .sort((a, b) => (a.sick ? 0 : 1) - (b.sick ? 0 : 1) || g.power(a) - g.power(b));
    const crew = [];
    let pw = 0, lost = 0;
    for (const c of pool) { if (pw >= v.fx.crew) break; crew.push(c); pw += g.power(c); if (!c.sick) lost += g.power(c); }
    if (pw < v.fx.crew) return null;
    const gain = g.basePower(v.card) - lost;
    return gain > 0 ? { crew, gain } : null;
  }

  // How close a permanent is to completing a known combo, judged only from what's on the battlefield
  comboDanger(g, o) {
    const list = combosFor(o.card);
    if (!list.length || o.zone !== 'battlefield') return 0;
    const q = g.players[o.controller];
    let d = 2;
    for (const c of list) {
      const n = comboState(g, q, c).onBoard;
      if (n >= c.pieces.length) d = Math.max(d, 15);
      else if (n >= c.pieces.length - 1) d = Math.max(d, c.result === 'mana' ? 4 : 7);
    }
    return d;
  }

  threat(g, me, q) {
    let v = 0;
    for (const o of q.battlefield) v += o.fx.type.land ? 0.3 : this.value(g, o) + this.comboDanger(g, o) * 0.8;
    v += q.hand.length * 0.4;
    if (q.life <= 10 * (g.startLife || 40) / 40) v *= 0.8;
    return (v + (me.grudge[q.idx] || 0) * 0.25) * this.politicalWeight(g, me, q);
  }

  pickBest(g, objs) {
    let best = null, bv = -1;
    for (const o of objs) { const v = this.value(g, o) + (o.card.cmc || 0) * 0.3; if (v > bv) { bv = v; best = o; } }
    return best;
  }
  // How to spend Walking Ballista's counters: lethal on a player, else the best creature it can finish
  pingPlan(g, p, o, all = false) {
    const n = o.counters;
    const lethal = g.opponents(p).filter(q => q.life <= n).sort((a, b) => a.life - b.life)[0];
    if (lethal) return { value: 60, targets: Array(lethal.life).fill({ player: lethal.idx }) };
    const kill = g.opponents(p).flatMap(q => q.battlefield)
      .filter(c => c.fx.type.creature && g.canTarget(p, c) && !g.has(c, 'indestructible') && g.toughness(c) - c.damage <= n)
      .map(c => ({ c, need: g.toughness(c) - c.damage, v: this.value(g, c) + this.comboDanger(g, c) }))
      .sort((a, b) => b.v / b.need - a.v / a.need)[0];
    if (kill && (all || kill.v >= 4)) {
      const targets = Array(kill.need).fill({ obj: kill.c });
      if (all) { const q = this.weakestOpponent(g, p); for (let i = kill.need; i < n; i++) targets.push({ player: q.idx }); }
      return { value: kill.v * 0.9, targets };
    }
    if (all) { const q = this.weakestOpponent(g, p); return q ? { value: 1, targets: Array(n).fill({ player: q.idx }) } : null; }
    return null;
  }

  // Rhystic Study and friends: pay the tax (giving a card away is usually worse than {1})
  // Rhystic Study, Smothering Tithe: pay when what the watcher would get is worth more than what the
  // mana would do for us. On our own turn the mana is needed for spells (and never during a combo);
  // on someone else's turn it would mostly sit idle, so pay unless that breaks our counterspell mana.
  payTax(g, p, src, t) {
    const avail = g.availableMana(p);
    if (avail < t.tax || g.infinite(p)) return g.infinite(p);
    const left = avail - t.tax;
    const watcher = g.players[src.controller];
    const gift = (t.effects || []).reduce((s, e) => s + (e.k === 'draw' ? 3 : e.k === 'treasure' ? 1.5 : 1.5), 0)
      * (g.archenemy === watcher?.idx ? 1.4 : 1) * (this.style === 'cedh' ? 1.2 : 1);
    if (g.active !== p.idx) return left >= this.reserveFor(g, p) || gift >= 4;
    // Our turn: what still needs casting?
    const ready = this.readyCombos(g, p, 'main1');
    if (ready.some(r => r.payable)) {
      const need = ready.find(r => r.payable).cost;
      return left >= need.generic + need.pips.length;
    }
    const wants = p.hand.filter(o => !o.fx.type.land && g.canCast(p, o)).map(o => o.card.cmc || 0).sort((a, b) => b - a);
    if (!wants.length) return true;
    // Paying is fine if the best spell we can afford afterwards is about as good as before
    const before = wants.find(c => c <= avail) ?? 0, after = wants.find(c => c <= left) ?? 0;
    return before - after <= 1 || gift >= 4.5;
  }
  pickSacrifice(g, p) {
    const cs = p.battlefield.filter(o => o.fx.type.creature);
    return cs.sort((a, b) => this.value(g, a) + this.pieceWorth(g, p, a) - this.value(g, b) - this.pieceWorth(g, p, b))[0] || null;
  }

  // Tutors finish our own combos first, then look for an answer to an opponent's combo
  pickTutor(g, p, e = {}) {
    const okType = o => !e.types?.length || e.types.some(t => o.fx.type[t]);
    const lib = p.library.filter(okType);
    if (!lib.length) return null;
    // (finishing an unbounded-mana combo: the finisher it was cast to find; engine.manaFinish)
    if (p.tutorWant) { const want = lib.find(o => o.card.name === p.tutorWant); if (want) return want; }
    let best = null, bs = 0;
    for (const c of p.combos) {
      if (c.check && !c.check(g, p)) continue;
      const lacking = comboState(g, p, c).missing;
      if (!lacking.length || lacking.some(f => f.zone !== 'library')) continue;
      const pick = lacking.find(f => okType(f.o));
      if (!pick) continue;
      // Planning a turn ahead: prefer the combo next turn's mana can actually pay for
      const st = comboState(g, p, c);
      const cost = st.found.concat(lacking).filter(f => f.zone !== 'battlefield').reduce((a, f) => a + (f.o.card.cmc || 0), 0) + (c.mana || 0);
      const fits = cost <= this.nextTurnMana(g, p);
      const s = (comboScore(c, p) >= 500 ? 10 : 4) + (lacking.length === 1 ? 10 : 0) + (fits ? 5 : 0);
      if (s > bs) { bs = s; best = pick.o; this.plan = { combo: c, turn: g.turn, fits }; }
    }
    if (best) {
      this.explain(g, p, `tutors for ${best.card.name} to set up ${this.plan.combo.label || 'a combo'}${this.plan.fits ? ', planning to go off as soon as the mana is there' : ' (needs more mana first)'}`);
      return best;
    }
    if (g.opponents(p).some(q => q.battlefield.some(o => this.comboDanger(g, o) >= 7))) {
      const answers = lib.filter(o => [...o.fx.spell, ...o.fx.etb].some(x => INTERACTION.includes(x.k)));
      if (answers.length) return this.pickBest(g, answers);
    }
    const lands = p.battlefield.filter(o => o.fx.type.land).length;
    const pool = lib.filter(o => !o.fx.type.land && (o.card.cmc || 0) <= lands + 2);
    return this.pickBest(g, pool.length ? pool : lib.filter(o => !o.fx.type.land)) || lib[0];
  }

  // Which opponent looks closest to going off, from public information only: combos (known to the
  // table) whose pieces are visible on their battlefield, command zone or graveyard. 0â€“1.
  comboCloseness(g, q) {
    const seen = [...q.battlefield, ...q.command, ...q.graveyard];
    let best = 0;
    const keys = new Set(seen.flatMap(x => [x.card.name.toLowerCase(), (x.card.frontName || '').toLowerCase()]));
    for (const o of seen) for (const c of combosFor(o.card)) {
      const have = c.keys.filter(k => keys.has(k)).length;
      best = Math.max(best, have / c.keys.length);
    }
    return best;
  }
  closestCombo(g, me) {
    let q = null, v = 0;
    for (const o of g.opponents(me)) { const c = this.comboCloseness(g, o); if (c > v) { v = c; q = o; } }
    return { q, closeness: v };
  }

  // Mana we expect to have next turn: today's sources plus a land drop if one is in hand
  nextTurnMana(g, p) {
    return g.sources(p).reduce((a, s) => a + (s.fx.mana?.amount || 1), 0) + (p.hand.some(o => o.fx.type.land) ? 1 : 0);
  }
  // Explain-the-play mode: the log says why the AI made a decision (it can reveal hidden cards)
  explain(g, p, text) {
    if (g.explain) g.log(`ðŸ§  ${esc(p.name)} ${esc(text)}`, { kind: 'why', p: p.idx });
  }

  // Value of a card as part of one of our combos (kept in hand, not discarded or bottomed)
  pieceWorth(g, p, o) {
    return combosFor(o.card).some(c => p.combos.includes(c)) ? 8 : 0;
  }

  chooseImprint(g, p, host) {
    const options = p.hand.filter(o => o.fx.type.instant && (o.card.cmc || 0) <= 2);
    const piece = options.find(o => combosFor(o.card).some(c => c.imprint && p.combos.includes(c)));
    return piece || this.pickBest(g, options.filter(o => o.fx.spell.some(e => e.k === 'draw' || e.k === 'remove')));
  }

  // ---------- opening hand
  // Keep a hand that can actually play: enough lands, the right colors, and something to do early
  // How well an opening hand works toward the deck's plan: combo pieces (more when a combo is nearly
  // assembled with the command zone), tutors that can find the rest, card engines, and a commander
  // that is part of the plan and castable early
  planScore(g, p) {
    let s = 0;
    const hand = new Set(p.hand);
    for (const c of p.combos) {
      if (c.check && !c.check(g, p)) continue;
      const st = comboState(g, p, c);
      const held = st.found.filter(f => hand.has(f.o) || f.zone === 'command').length;
      if (held >= 2) s += held >= c.pieces.length - 1 ? 4 : 2;
    }
    const tutors = p.hand.filter(o => [...o.fx.spell, ...o.fx.etb].some(e => e.k === 'tutor')).length;
    s += Math.min(2, tutors) * (p.combos.length ? 1.5 : 0.5);
    s += p.hand.filter(o => this.pieceWorth(g, p, o)).length;
    s += p.hand.filter(o => o.fx.onOppCast || o.fx.onCast?.effects.some(e => e.k === 'draw') || o.fx.upkeep.some(e => e.k === 'draw') || o.fx.necro).length;
    const fast = p.hand.filter(o => (o.fx.mana && (o.card.cmc || 0) <= 2 && !o.fx.type.land) || o.fx.spell.some(e => e.k === 'addMana')).length;
    const cmd = p.command.find(o => this.pieceWorth(g, p, o) || o.fx.onCast || o.fx.manaBoost);
    if (cmd && (cmd.card.cmc || 0) <= p.hand.filter(o => o.fx.type.land).length + fast + 1) s += 1.5;
    return s;
  }
  keepHand(g, p) {
    const plan = this.planScore(g, p);
    // cEDH: a hand needs to do something fast (tutors, fast mana, combo pieces, free interaction)
    if (this.style === 'cedh' && p.mulligans < 2) {
      const lands = p.hand.filter(o => o.fx.type.land || (g.rules >= 5 && o.card.layout === 'modal_dfc' && o.card.altFace?.fx.type.land)).length;
      const good = p.hand.filter(o => this.pieceWorth(g, p, o) || [...o.fx.spell, ...o.fx.etb].some(e => e.k === 'tutor' || e.k === 'addMana') || (o.fx.mana && (o.card.cmc || 0) <= 2) || o.fx.altFree).length;
      return lands >= 1 && lands <= 4 && (good >= 2 || plan >= 4);
    }
    // (a modal double-faced card with a land back counts as a land)
    const lands = p.hand.filter(o => o.fx.type.land || (g.rules >= 5 && o.card.layout === 'modal_dfc' && o.card.altFace?.fx.type.land));
    const n = lands.length;
    if (p.mulligans >= 2) return true;
    // A hand with a whole combo is worth keeping on fewer lands
    if (n >= 1 && p.combos.some(c => comboState(g, p, c).found.every(f => f.zone === 'hand' || f.zone === 'command'))) return true;
    // One land is fine with fast mana and a strong plan; a combo deck throws back hands with no plan at all
    if (n === 1) return plan >= 4 && p.hand.filter(o => o.fx.mana && (o.card.cmc || 0) <= 1).length >= 1;
    if (n < 2 || n > 5) return false;
    if (this.style === 'combo' && plan === 0 && p.mulligans === 0 && p.combos.length) return false;
    if (plan >= 5 && n >= 2 && n <= 4) return true;
    const colors = new Set(lands.flatMap(o => (o.fx.fetch ? ['W', 'U', 'B', 'R', 'G'] : o.fx.mana?.colors || [])));
    const spells = p.hand.filter(o => !o.fx.type.land);
    const castable = o => parseCost(o.card.manaCost).pips.every(pip => pip.some(c => c === 'C' || colors.has(c)));
    const ramp = spells.filter(o => (o.card.cmc || 0) <= 2 && castable(o) && (o.fx.mana || o.fx.spell.some(e => e.k === 'rampLand') || o.fx.etb.some(e => e.k === 'rampLand')));
    const early = spells.filter(o => (o.card.cmc || 0) <= 3 && castable(o));
    const playable = spells.filter(o => (o.card.cmc || 0) <= n + 2 && castable(o));
    if (n === 2) return ramp.length >= 1 || early.filter(o => (o.card.cmc || 0) <= 2).length >= 2;
    if (n === 5) return playable.length >= 2;
    return early.length >= 1 || playable.length >= 2;
  }
  bottomCards(g, p, n) {
    const lands = p.hand.filter(o => o.fx.type.land);
    // Keep combo pieces, tutors and fast mana; bottom the most expensive of the rest
    const keepScore = o => this.pieceWorth(g, p, o) + ([...o.fx.spell, ...o.fx.etb].some(e => e.k === 'tutor') ? 5 : 0) + ((o.fx.mana && (o.card.cmc || 0) <= 2) || o.fx.spell.some(e => e.k === 'addMana') ? 3 : 0);
    const spells = p.hand.filter(o => !o.fx.type.land)
      .sort((a, b) => (keepScore(a) - keepScore(b)) || (b.card.cmc - a.card.cmc));
    const out = [];
    while (out.length < n) {
      if (lands.length > 4) out.push(lands.pop());
      else if (spells.length) out.push(spells.shift());
      else out.push(lands.pop());
    }
    return out;
  }
  chooseDiscard(g, p, n) {
    const landsOut = p.battlefield.filter(o => o.fx.type.land).length;
    return [...p.hand].sort((a, b) => {
      const interaction = o => (o.fx.spell.some(e => INTERACTION.includes(e.k)) ? 3 : 0);
      const s = o => (o.fx.type.land ? (landsOut >= 6 ? -10 : 5) : -(o.card.cmc || 0) + this.value(g, o) * 0.3 + this.pieceWorth(g, p, o) + interaction(o));
      return s(a) - s(b);
    }).slice(0, n);
  }

  // ---------- targeting
  matches(o, what) {
    const t = o.fx.type;
    switch (what) {
      case 'creature': return t.creature;
      case 'artifact': return t.artifact;
      case 'enchantment': return t.enchantment;
      case 'planeswalker': return t.planeswalker;
      case 'creature or planeswalker': return t.creature || t.planeswalker;
      case 'artifact or enchantment': return t.artifact || t.enchantment;
      case 'nonland permanent': return !t.land;
      case 'permanent': return true;
      default: return t.creature;
    }
  }
  threatRank(g, p) {
    const opps = g.opponents(p).map(q => [q.idx, this.threat(g, p, q)]).sort((a, b) => b[1] - a[1]);
    const m = new Map();
    opps.forEach(([i], k) => m.set(i, 1.3 - k * 0.15));
    return m;
  }
  bestEnemy(g, p, filter) {
    const rank = this.threatRank(g, p);
    let best = null, bv = 0;
    for (const q of g.opponents(p)) for (const o of q.battlefield) {
      if (!filter(o) || !g.canTarget(p, o)) continue;
      const v = (this.value(g, o) + this.comboDanger(g, o)) * (rank.get(q.idx) || 1);
      if (v > bv) { bv = v; best = o; }
    }
    return best ? { obj: best, v: bv } : null;
  }
  bestOwn(g, p, filter = o => o.fx.type.creature) {
    let best = null, bv = -1;
    for (const o of p.battlefield) if (filter(o)) { const v = this.value(g, o); if (v > bv) { bv = v; best = o; } }
    return best;
  }
  weakestOpponent(g, p) {
    return g.opponents(p).sort((a, b) => (a.life - b.life) || (this.threat(g, p, b) - this.threat(g, p, a)))[0];
  }

  chooseTarget(g, p, e, src) {
    // (an ability's X is already paid while its targets are chosen: g.xNow)
    const xGuess = () => this.xOverride ?? g.xNow ?? Math.max(1, g.availableMana(p) - 1);
    const n = e.n === 'X' ? xGuess() : e.n;
    const N0 = v => (v === 'X' ? xGuess() : v && typeof v === 'object' ? g.dynValue(p, v) : v);
    switch (e.k) {
      case 'remove': return this.bestEnemy(g, p, o => this.matches(o, e.what) && (e.mode === 'exile' || !g.has(o, 'indestructible')) && (e.maxMv == null || ((o.card.cmc || 0) <= e.maxMv && !o.token))
        // ("nonartifact, nonblack creature")
        && !(e.not || []).some(w => o.fx.type[w] || (o.card.colors || []).includes({ white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' }[w])));
      case 'bounce': return this.bestEnemy(g, p, o => this.matches(o, e.what) && !o.fx.type.land);
      // (an untapped creature that could block, or attack)
      case 'noBlock': return this.bestEnemy(g, p, o => o.fx.type.creature && !o.tapped);
      case 'loseLife': { const q = this.weakestOpponent(g, p); return q ? { player: q.idx } : null; }
      case 'discard': { const q = g.opponents(p).sort((a, b) => b.hand.length - a.hand.length)[0]; return q ? { player: q.idx } : null; }
      case 'silence': { const q = [...g.opponents(p)].sort((a, b) => this.threat(g, p, b) - this.threat(g, p, a))[0]; return q ? { player: q.idx } : null; }
      // Mill whoever is closest to running out
      case 'mill': { const q = [...g.opponents(p)].sort((a, b) => a.library.length - b.library.length)[0]; return q ? { player: q.idx } : null; }
      case 'copyToken': { const o = this.bestOwn(g, p, x => this.matches(x, e.what) && !x.fx.type.legendary); return o ? { obj: o, v: this.value(g, o) } : null; }
      case 'pump': case 'counters': case 'protect': case 'doublePT': { const o = this.bestOwn(g, p); return o ? { obj: o } : null; }
      case 'blink': {
        // The creature whose enters-the-battlefield effect is worth the most to repeat
        let best = null, bv = 0;
        for (const o of p.battlefield) {
          // (a blinker never blinks itself: its own enter trigger would start over and over)
          if (!this.matches(o, e.what === 'creature' ? 'creature' : 'nonland permanent') || o.token || o === src || o.fx.etb.some(x => x.k === 'blink')) continue;
          // (blink-on-ETB creatures like Restoration Angel aren't counted, or the valuation would recurse)
          const v = o.fx.etb.filter(x => x.k !== 'blink').reduce((s, x) => s + this.effectValue(g, p, o, x, false), 0);
          if (v > bv) { bv = v; best = o; }
        }
        return best ? { obj: best, v: bv } : null;
      }
      case 'steal':
        // A creature borrowed for a turn is only worth taking if it can swing hard
        return this.bestEnemy(g, p, o => this.matches(o, e.what) && !o.fx.type.land
          && (!e.temp || (o.fx.type.creature && g.power(o) >= 3 && !g.has(o, 'defender'))));
      case 'flickerDelay': return this.bestEnemy(g, p, o => this.matches(o, e.what) && !o.fx.type.land && !o.token);
      case 'fight': {
        const mine = src.zone === 'battlefield' && src.fx.type.creature ? src : this.bestOwn(g, p);
        if (!mine) return null;
        return this.bestEnemy(g, p, o => o.fx.type.creature && !g.has(o, 'indestructible') && g.toughness(o) - o.damage <= g.power(mine) && (e.bite || g.power(o) < g.toughness(mine) || this.value(g, o) > this.value(g, mine)));
      }
      case 'shrink': return this.bestEnemy(g, p, o => o.fx.type.creature && g.toughness(o) <= N0(e.t));
      case 'minus': return this.bestEnemy(g, p, o => o.fx.type.creature && g.toughness(o) <= N0(e.n)) || this.bestEnemy(g, p, o => o.fx.type.creature);
      case 'tap': return this.bestEnemy(g, p, o => this.matches(o, e.what) && !o.tapped && !o.fx.type.land);
      case 'goad': return this.bestEnemy(g, p, o => o.fx.type.creature && g.power(o) >= 2);
      case 'regen': { const o = this.bestOwn(g, p); return o ? { obj: o } : null; }
      case 'copySpell': {
        let best = null, bv = 3;
        for (const it of g.stack) {
          if (it.o === src || !(it.o.fx.type.instant || it.o.fx.type.sorcery)) continue;
          const v = it.o.fx.spell.reduce((s, x) => s + (x.k === 'counter' ? 0 : this.effectValue(g, p, it.o, x, true)), 0);
          if (v > bv) { bv = v; best = it; }
        }
        return best ? { spell: best } : null;
      }
      case 'damage': {
        const canFace = /any|player|opponent/.test(e.to);
        const canCreature = /any|creature/.test(e.to);
        let best = null, bv = 0;
        if (canCreature) {
          const kill = this.bestEnemy(g, p, o => o.fx.type.creature && !g.has(o, 'indestructible') && g.toughness(o) - o.damage <= n);
          if (kill) { best = { obj: kill.obj }; bv = kill.v; }
        }
        if (canFace) {
          const q = this.weakestOpponent(g, p);
          if (q) { const v = q.life <= n ? 100 : n * 0.6; if (v > bv) { best = { player: q.idx }; bv = v; } }
        }
        return best;
      }
      default: return null;
    }
  }
  // Modal spells: score each mode on its own and take the best ones the card allows
  chooseModes(g, p, o, modal) {
    const scored = modal.modes.map(es => ({ es, v: es.reduce((s, e) => s + this.effectValue(g, p, o, e, true), 0) }))
      .filter(m => m.v > 0).sort((a, b) => b.v - a.v);
    // "If you control a commander as you cast it, you may choose both instead"
    const n = modal.up && g.evalCond(p, o, modal.up.cond, { kicked: o.kicked }) ? modal.up.n : modal.n;
    return scored.slice(0, n).flatMap(m => m.es);
  }
  // Rings of Brighthearth: copy an ability when the {2} isn't needed for something better this turn
  wantsAbilityCopy(g, p, o, ab) {
    if ((ab.effects || []).some(e => ['sacSelf', 'exileSelf'].includes(e.k))) return false;
    const after = g.availableMana(p) - 2;
    const wanted = p.hand.filter(x => !x.fx.type.land && (x.card.cmc || 0) > after && (x.card.cmc || 0) <= after + 2 && g.canCast(p, x));
    return after >= 0 && !wanted.length;
  }
  chooseAuraTarget(g, p, aura) {
    const buff = aura.fx.attachBuff;
    // "Enchant artifact" (Power Artifact): the artifact of ours whose activated abilities it helps most
    const what = (aura.card.text.match(/^enchant (\w+)/im) || [])[1]?.toLowerCase();
    if (what === 'artifact') {
      const mine = p.battlefield.filter(o => o.fx.type.artifact && g.canTarget(p, o));
      const gain = o => g.abilitiesOf(o).reduce((s, ab) => s + (parseCost(ab.cost).generic > 0 ? 2 : 0), 0) + (o.fx.noUntap && o.fx.mana ? 3 : 0);
      if (aura.fx.attachReduce) return mine.sort((a, b) => gain(b) - gain(a))[0] || null;
      return this.bestEnemy(g, p, o => o.fx.type.artifact)?.obj || mine[0] || null;
    }
    if (aura.fx.pacify || aura.fx.controlAura || (buff && buff.p + buff.t < 0)) return this.bestEnemy(g, p, o => o.fx.type.creature)?.obj || null;
    return this.bestOwn(g, p) || null;
  }

  // ---------- combos
  comboCost(g, p, combo, st) {
    const total = { generic: combo.mana || 0, pips: [], x: 0 };
    for (const f of st.found) {
      if (f.zone !== 'hand' && f.zone !== 'command') continue;
      if (combo.imprint && f.key === combo.imprint.card.toLowerCase()) continue;
      const { c, extra } = g.costOf(p, f.o);
      total.generic += c.generic + extra + c.x * (combo.x?.[f.name] ?? 0);
      total.pips.push(...c.pips);
    }
    return total;
  }
  // Is this combo fully assembled (bar mana), and can it be fired this phase?
  comboAssembled(g, p, combo, phase) {
    if (p.comboTried.turn === g.turn && p.comboTried.ids.has(combo.id)) return null;
    const st = comboState(g, p, combo);
    if (!st.ready) return null;
    if (combo.result === 'attack' && phase !== 'main1') return null;
    // (pieces that tap must be on the battlefield untapped and free of summoning sickness, and so on)
    if (comboBlocked(g, p, combo, st)) return null;
    // Unbounded mana with nothing to spend it on wins nothing: hold it until there's an outlet
    if (combo.result === 'mana' && !g.manaOutlet(p)) return null;
    // Kingdoms: a combo that hits every opponent mustn't take down a secret ally (a face-down Knight's King),
    // nor end the game for the wrong side (a Bandit or Renegade killing the King while Assassins remain)
    if (g.kingdoms && !this.human && ['damage', 'drain', 'attack', 'mill'].includes(combo.result) && g.opponents(p).some(q => kingdomsWeight(g, p, q) < 0.5)) return null;
    return st;
  }
  readyCombos(g, p, phase) {
    const out = [];
    for (const combo of p.combos) {
      const st = this.comboAssembled(g, p, combo, phase);
      if (!st) continue;
      const cost = this.comboCost(g, p, combo, st);
      out.push({ combo, st, cost, payable: !!g.planPayment(p, cost, 0) });
    }
    return out.sort((a, b) => comboScore(b.combo, p) - comboScore(a.combo, p));
  }
  // Pieces we hold back so they aren't exposed to removal before the combo can be fired
  heldPieces(g, p) {
    const held = new Set();
    if (g.round >= 15) return held;
    for (const combo of p.combos) {
      if (comboScore(combo, p) < 500 || (combo.check && !combo.check(g, p))) continue;
      const st = comboState(g, p, combo);
      if (!st.ready || g.planPayment(p, this.comboCost(g, p, combo, st), 0)) continue;
      for (const f of st.found) if ((f.zone === 'hand' || f.zone === 'command') && !f.o.fx.mana) held.add(f.o);
    }
    return held;
  }
  // Reading an opponent from public information only: the chance they hold a counterspell they can cast now.
  // Blue decks run about one counter in 12 cards (cEDH lists one in 10, and many cost nothing); every
  // counter they've already shown makes more likely; open mana decides whether they can cast one.
  counterOdds(g, q) {
    const blue = q.command.concat(q.battlefield.filter(o => o.isCommander)).some(o => (o.card.colorIdentity || []).includes('U'))
      || g.sources(q).some(s => s.fx.mana.colors.includes('U'));
    if (!blue || !q.hand.length) return 0;
    const cedh = q.agent?.style === 'cedh';
    const density = Math.min(0.25, (cedh ? 0.1 : 0.075) + 0.03 * (q.countersCast || 0));
    const holds = 1 - (1 - density) ** q.hand.length;
    const open = g.availableMana(q);
    const castable = open >= 2 ? 1 : open === 1 ? 0.65 : cedh ? 0.35 : 0.08;
    return holds * castable;
  }
  // The chance at least one opponent stops our next spell
  counterRisk(g, p) {
    return 1 - g.opponents(p).reduce((s, q) => s * (1 - this.counterOdds(g, q)), 1);
  }
  // Someone could counter us
  shieldsUp(g, p) {
    return this.counterRisk(g, p) >= 0.3;
  }

  // ---------- main phase
  async mainPhase(g, p, phase) {
    for (let guard = 0; guard < 40 && !g.over && !p.lost; guard++) {
      if (p.landsPlayed < g.landDrops(p)) {
        const land = this.chooseLand(g, p);
        if (land) { await g.playLand(p, land); continue; }
      }
      const best = this.lookahead && !g.sim ? await lookAheadPlay(this, g, p, phase) : this.bestPlay(g, p, phase);
      if (!best) break;
      const ok = await best.run();
      if (!ok) break;
    }
  }

  chooseLand(g, p) {
    // (lands exiled with "you may play it" and the top of the library with Courser of Kruphix count too; they go first)
    const extra = [...p.exile.filter(o => o.fx.type.land && o.mayPlay?.p === p.idx && o.mayPlay.until >= g.turn), p.library[p.library.length - 1]].filter(o => o && o.fx.type.land && (o.zone === 'exile' || g.topPlayable(p, o)));
    if (extra.length) return extra[0];
    const lands = p.hand.filter(o => o.fx.type.land);
    if (!lands.length) {
      // Modal double-faced cards with a land back: play one as a land when there's no other land and mana is short
      // (the cheapest front first; never while the front could be cast and the board has 6+ lands)
      const onBf = p.battlefield.filter(o => o.fx.type.land).length;
      const backs = p.hand.filter(o => g.canPlayBackLand(p, o)).sort((a, b) => (a.card.cmc || 0) - (b.card.cmc || 0));
      return backs.find(o => onBf < 6 || !g.canCast(p, o)) || null;
    }
    const have = new Set(p.battlefield.flatMap(o => o.fx.mana?.colors || []));
    const wanted = new Set(p.hand.concat(p.command).flatMap(o => [...o.card.manaCost.matchAll(/\{([WUBRG])\}/g)].map(m => m[1])));
    // Is there a spell that needs this land's mana right now? If not, a tapped land costs nothing today
    const avail = g.availableMana(p);
    const needNow = p.hand.concat(p.command).some(o => !o.fx.type.land && o.card.manaCost && (o.card.cmc || 0) === avail + 1);
    const score = o => {
      let s = 0;
      for (const c of o.fx.mana?.colors || []) if (wanted.has(c) && !have.has(c)) s += 3;
      if (o.fx.entersTapped) s += needNow ? -3 : 0.5;
      if (o.fx.fetch) s += 1;
      return s;
    };
    return lands.sort((a, b) => score(b) - score(a))[0];
  }

  // Mana to keep open after main phase 2: counterspells first, then instant-speed answers.
  // Whatever isn't needed gets spent at the end of an opponent's turn (endOfTurn).
  reserveFor(g, p) {
    if (this.style === 'aggressive') return 0;
    const counters = p.hand.filter(isCounter);
    const instants = p.hand.filter(o => instantSpeed(o) && !isCounter(o) && !o.fx.type.land);
    const pool = counters.length || this.style === 'balanced' ? counters : instants;
    let keep = pool.length ? Math.min(...pool.map(o => o.card.cmc || 0)) : 0;
    // Protection for a key card on the battlefield (commander, combo piece) is worth keeping up too
    const keyOut = p.battlefield.some(o => o.isCommander || this.pieceWorth(g, p, o));
    const shield = keyOut && p.hand.filter(o => instantSpeed(o) && o.fx.spell.some(e => e.k === 'protect' || e.k === 'counter'));
    if (shield?.length) keep = Math.max(keep, Math.min(...shield.map(o => o.card.cmc || 0)));
    return keep;
  }
  // A board already well ahead is exposed to a board wipe: more creatures add little but risk a lot
  overextended(g, p) {
    const mine = p.battlefield.filter(o => o.fx.type.creature);
    if (mine.length < 3) return false;
    const myV = mine.reduce((s, o) => s + this.value(g, o), 0);
    const best = Math.max(0, ...g.opponents(p).map(q => q.battlefield.filter(o => o.fx.type.creature).reduce((s, o) => s + this.value(g, o), 0)));
    return myV >= Math.max(12, best * 1.6);
  }

  bestPlay(g, p, phase) {
    // 1. Fire a combo if one is ready and paid for
    const ready = this.readyCombos(g, p, phase);
    const go = ready.find(r => r.payable);
    // Short on mana for a ready combo? Cast a ritual first if that covers it
    if (!go) {
      const near = ready.find(r => !r.payable);
      if (near) {
        const short = near.cost.generic + near.cost.pips.length - g.availableMana(p);
        const pieces = new Set(near.st.found.map(f => f.o));
        const ritual = p.hand.find(o => !pieces.has(o) && g.canCast(p, o) && o.fx.spell.some(e => e.k === 'addMana' && e.syms.length - (o.card.cmc || 0) >= short));
        if (ritual) return { s: 900, run: () => g.cast(p, ritual) };
      }
    }
    if (go) {
      // Silence the table first when someone could stop the combo (and there's mana for both)
      if (this.shieldsUp(g, p) && comboScore(go.combo, p) >= 500) {
        const need = go.cost.generic + go.cost.pips.length;
        const pieces = new Set(go.st.found.map(f => f.o));
        const silence = p.hand.find(o => !pieces.has(o) && g.canCast(p, o) && o.fx.spell.some(e => e.k === 'silence' && !e.who.startsWith('target'))
          && g.availableMana(p) - (o.card.cmc || 0) >= need && !Object.values(g.silenced).includes(g.turn));
        if (silence) return { s: 999, run: () => { g.log(`${g.pn(p)} casts ${g.cn(silence)} to clear the way for a combo`, { kind: 'minor' }); return g.cast(p, silence); } };
      }
      // Against open blue mana, cast another real threat first to draw out the counterspell
      if (this.shieldsUp(g, p) && !p.hand.some(o => isCounter(o) && g.canCast(p, o)) && this.baited !== g.turn && comboScore(go.combo, p) >= 500) {
        const need = go.cost.generic + go.cost.pips.length;
        const pieces = new Set(go.st.found.map(f => f.o));
        const bait = p.hand.filter(o => !pieces.has(o) && !o.fx.type.land && !isCounter(o) && (o.card.cmc || 0) >= 3 && g.canCast(p, o)
          && g.availableMana(p) - (o.card.cmc || 0) >= need && this.scoreCast(g, p, o, phase) > 3)
          .sort((a, b) => this.scoreCast(g, p, b, phase) - this.scoreCast(g, p, a, phase))[0];
        if (bait) {
          this.baited = g.turn;
          return { s: 999, run: () => { g.log(`${g.pn(p)} leads with ${g.cn(bait)} to bait out a counterspell`, { kind: 'minor' }); return g.cast(p, bait); } };
        }
      }
      return { s: comboScore(go.combo, p), run: () => {
        const risk = this.counterRisk(g, p);
        this.explain(g, p, `goes for ${go.combo.label || 'the combo'}: every piece is ready and paid for${risk >= 0.05 ? ` (about ${Math.round(risk * 100)}% chance someone counters it)` : ', and nobody looks able to stop it'}`);
        return g.goOff(p, go.combo);
      } };
    }

    const opts = [];
    // Walking Ballista: ping to kill something worth it, or to finish a player
    for (const o of p.battlefield.filter(x => x.fx.pingCounters && x.counters > 0)) {
      const plan = this.pingPlan(g, p, o);
      if (plan) opts.push({ s: plan.value, why: `pings with ${o.card.name} to ${plan.value >= 60 ? 'finish a player' : 'kill a creature'}`, run: () => g.ping(p, o, plan.targets) });
    }
    const avail = g.availableMana(p);
    const reserve = phase === 'main2' && !g.infinite(p) ? this.reserveFor(g, p) : 0;
    const held = this.heldPieces(g, p);
    // (with Underworld Breach out, every nonland card in the graveyard can be cast again with escape)
    const breach = p.battlefield.some(x => x.fx.breach);
    const top = p.library[p.library.length - 1];
    const fromElsewhere = [...p.exile.filter(c => c.mayPlay?.p === p.idx && !c.fx.type.land), ...(top && !top.fx.type.land && g.topPlayable(p, top) ? [top] : [])];
    for (const o of [...p.hand, ...p.command, ...fromElsewhere, ...p.graveyard.filter(c => c.fx.flashback || c.tempFlashback === g.turn || c.fx.escape || c.fx.jumpstart || (breach && !c.fx.type.land))]) {
      if (o.fx.type.land || held.has(o)) continue;
      // A ritual is worth more next turn when a ready combo is short on mana (planning a turn ahead)
      if (ready.length && !o.fx.type.permanent && o.fx.spell.some(e => e.k === 'addMana')) continue;
      const mode = g.castMode(p, o);
      const faceMode = o.zone === 'hand' ? g.faceCastMode(p, o) : null;
      const bestowOk = o.zone === 'hand' && g.canBestow(p, o), mutateOk = o.zone === 'hand' && g.canMutate(p, o);
      if (!mode && !faceMode && !bestowOk && !mutateOk) continue;
      // A combo spell that does nothing on its own (Tainted Pact without Oracle) waits for its partner
      if (!o.fx.type.permanent && !o.fx.spell.length && this.pieceWorth(g, p, o)) continue;
      let s = mode ? this.scoreCast(g, p, o, phase) : 0;
      // Don't overextend into a wipe: a plain extra creature is worth less when the board is already well ahead
      if (o.fx.type.creature && !o.fx.etb.length && !o.isCommander && !this.pieceWorth(g, p, o) && !g.has(o, 'haste') && this.overextended(g, p)) s *= 0.55;
      // An evoked creature is sacrificed at once, so only its enters-the-battlefield effect counts
      if (mode?.alt === 'evoke') s = o.fx.etb.reduce((a, e) => a + this.effectValue(g, p, o, e, false), 0) * 0.9 - 1;
      // Cast face down (morph, disguise): a 2/2 now, and the real card later
      if (mode?.alt === 'morph') s = 2 + Math.min(3, s * 0.3);
      // An adventure (the creature is cast from exile later) or an MDFC's back face, when it scores better
      // Bestow: the creature as an Aura on our best creature (it stays as a creature when that one dies)
      if (bestowOk) {
        const host = this.bestOwn(g, p, x => x.fx.type.creature);
        const b = o.card.fx.attachBuff;
        if (host && b) {
          const bs = (b.p + b.t * 0.6 + (b.kw || []).length * 1.2) * (host.sick ? 0.7 : 1) + Math.max(0, mode ? s : this.scoreCast(g, p, o, phase)) * 0.35 + 1;
          if (bs > s && bs > 0.5) opts.push({ s: bs, why: `bestows ${o.card.name} on ${host.card.name}`, run: () => g.cast(p, o, { mode: { alt: 'bestow' } }) });
        }
      }
      // Mutate: merge onto a creature we own (no summoning sickness if it's been around; the mutate triggers fire)
      if (mutateOk) {
        const host = this.chooseMutateTarget(g, p, o, g.mutateTargets(p, o));
        const base = Math.max(0, mode ? s : this.scoreCast(g, p, o, phase));
        const ms = base + (o.fx.onMutate || []).reduce((a, e) => a + this.effectValue(g, p, o, e, false), 0) + (host && !host.sick ? 1.5 : 0) - 1;
        if (host && ms > s && ms > 0.5) opts.push({ s: ms, why: `mutates ${o.card.name} onto ${host.card.name}`, run: () => g.cast(p, o, { mode: { alt: 'mutate' }, mutateOnto: host }) });
      }
      if (!mode && !faceMode) continue;
      if (faceMode) {
        g.useFace(o, o.card.altFace);
        let fs;
        try { fs = this.scoreCast(g, p, o, phase); } finally { g.mainFace(o); }
        if (o.card.layout === 'adventure') fs += Math.max(0, mode ? s : this.scoreCast(g, p, o, phase)) * 0.6;
        if (fs > s || !mode) {
          if (fs > 0.5) opts.push({ s: fs, why: `casts ${o.card.altFace.name}${o.card.layout === 'adventure' ? ' (adventure)' : ''}`, run: () => g.castFace(p, o), o });
          continue;
        }
      }
      // Pitching a card is a real cost; free spells are mostly for responses
      if (mode.alt === 'pitch') s -= 4;
      if (mode.alt === 'jumpstart') s -= 1.5;
      // Cards exiled "until end of turn" are lost if not played now
      if (o.zone === 'exile' && o.mayPlay?.until === g.turn) s += 2;
      // A dashed or blitzed creature only fights this turn
      if (mode.alt === 'dash' || mode.alt === 'blitz') s = phase === 'main1' ? s * 0.6 + (mode.alt === 'blitz' ? 2 : 0) : 0;
      if (s <= 0) continue;
      const cost = mode.alt && !['free', 'pitch'].includes(mode.alt) ? g.altCost(o, mode.alt) : mode.alt ? null : parseCost(o.card.manaCost);
      const mana = cost ? cost.generic + cost.pips.length : 0;
      if (reserve && avail - mana < reserve && s < 9) continue;
      opts.push({ s, cost: mana, why: `casts ${o.card.name}${mode.alt ? ` (${mode.alt})` : ''}`, run: () => g.cast(p, o, { mode }) });
    }
    if (phase === 'main1') {
      for (const eq of p.battlefield.filter(o => o.fx.equip && (!o.fx.reconfigure || g.rules >= 5))) {
        const holder = eq.attachedTo;
        const best = this.bestOwn(g, p, o => o.fx.type.creature && !o.sick && o !== eq);
        if (!best || holder === best || !g.planPayment(p, g.equipCost(p, eq), 0)) continue;
        if (holder && holder.zone === 'battlefield' && !holder.sick) continue;
        const b = eq.fx.attachBuff || { p: 1, t: 1 };
        opts.push({ s: 2 + b.p + b.t * 0.5, why: `equips ${eq.card.name} to ${best.card.name}`, run: () => g.equip(p, eq, best) });
      }
      // Turn face-down creatures face up when the real card is worth the mana (megamorph adds a counter)
      for (const o of p.battlefield.filter(x => x.faceDown && g.canTurnFaceUp(p, x))) {
        const s = this.faceUpValue(g, p, o);
        if (s > 1) opts.push({ s, why: `turns ${o.faceCard.name} face up`, run: () => g.turnFaceUp(p, o) });
      }
      for (const pw of p.battlefield.filter(o => o.fx.type.planeswalker && !o.usedPW)) {
        const ab = this.pickPW(g, p, pw);
        if (ab) opts.push({ s: 6, why: `activates ${pw.card.name}`, run: () => g.activatePW(p, pw, ab).then(() => true) });
      }
    }
    if (phase === 'main2') {
      // Aristocrats: sacrifice spare tokens and small creatures when the death triggers are worth more
      for (const outlet of p.battlefield.filter(o => o.fx.sacOutlet && !o.fx.sacOutlet.mana && o.fx.sacOutlet.what !== 'artifact')) {
        const so = outlet.fx.sacOutlet;
        if ((so.tap && outlet.tapped) || (so.cost && !g.planPayment(p, parseCost(so.cost), 0))) continue;
        const payoff = so.effects.reduce((s, e) => s + this.effectValue(g, p, outlet, e, false), 0)
          + p.battlefield.filter(w => w.fx.onDeath && w.fx.onDeath.who !== 'opponents').reduce((s, w) => s + w.fx.onDeath.effects.reduce((a, e) => a + this.effectValue(g, p, w, e, false), 0), 0);
        const fodder = p.battlefield.filter(o => o.fx.type.creature && o !== outlet && !o.isCommander && !this.pieceWorth(g, p, o) && !o.fx.onDeath && !o.fx.sacOutlet)
          .map(o => ({ o, cost: this.value(g, o) * (o.token ? 0.5 : 1) - o.fx.dies.length * 1.5 }))
          .sort((a, b) => a.cost - b.cost)[0];
        if (fodder && payoff - fodder.cost > 0.3) opts.push({ s: payoff - fodder.cost, why: `sacrifices ${fodder.o.card.name}: the death triggers are worth more than the creature`, run: () => g.sacTo(p, outlet, fodder.o) });
      }
    }
    // Vehicles: crew with creatures that wouldn't attack anyway
    if (phase === 'main1') for (const v of p.battlefield.filter(o => o.fx.crew)) {
      const plan = this.crewPlan(g, p, v);
      if (plan) opts.push({ s: 2 + plan.gain * 0.6, why: `crews ${v.card.name}`, run: () => g.crew(p, v, plan.crew) });
    }
    // Cycling and landcycling: trade a card we can't use well for a fresh one (or the land we need)
    const landCount = p.battlefield.filter(o => o.fx.type.land).length + p.hand.filter(o => o.fx.type.land).length;
    for (const o of p.hand.filter(x => (x.fx.cycling || x.fx.channel) && g.canCycle(p, x))) {
      let s;
      if (o.fx.channel && !o.fx.cycling) s = o.fx.channel.effects.reduce((a, e) => a + this.effectValue(g, p, o, e, true), 0) - (o.fx.type.land ? 1 : 3);
      else if (o.fx.cycling.land) s = landCount < 5 ? 4 : 0.5;
      else s = (g.canCast(p, o) ? this.scoreCast(g, p, o, phase) < 2 : (o.card.cmc || 0) > landCount + 1) ? 2 : 0;
      if (s > 0.5 && (phase === 'main2' || s >= 3)) opts.push({ s, why: `${o.fx.channel && !o.fx.cycling ? 'channels' : 'cycles'} ${o.card.name}`, run: () => g.cycle(p, o) });
    }
    // Unearth, embalm and eternalize from the graveyard
    for (const o of p.graveyard) {
      const k = g.graveAbility(p, o);
      if (!k || ((k === 'unearth' || o.fx.graveReturn?.to === 'battlefield') && phase !== 'main1' && o.fx.type.creature)) continue;
      const s = this.value(g, o) * (k === 'unearth' ? 0.5 : 0.9) + o.fx.etb.reduce((a, e) => a + Math.max(0, this.effectValue(g, p, o, e, false)), 0);
      if (s > 2) opts.push({ s, why: `uses ${k} on ${o.card.name}`, run: () => g.useGraveAbility(p, o, k) });
    }
    // Activated abilities: sorcery-speed ones (and anything worth doing now) in either main phase;
    // instant-speed ones in main 1 only when clearly good, the rest wait for an opponent's end step
    for (const ab of this.usableAbilities(g, p, reserve)) {
      const instant = !ab.ab.sorcery;
      if (phase === 'main1' && instant && ab.s < 3) continue;
      if (ab.s > 0.5) opts.push({ s: ab.s * 0.8, why: `uses ${ab.o.card.name}'s ability${ab.x ? ` (X = ${ab.x})` : ''}`, run: () => g.activate(p, ab.o, ab.ab, { x: ab.x }) });
    }
    if (!opts.length) return null;
    // Casual pilots don't always find the best play
    if (this.noise) for (const o of opts) o.s *= 1 + this.noise * (g.rand() * 2 - 1);
    // Use the turn's mana well: among the best spells, find the set that fits the available mana
    // with the highest total value, and cast its best card first (rather than one big card that wastes mana)
    const casts = opts.filter(x => x.cost != null).sort((a, b) => b.s - a.s).slice(0, 8);
    let pick = casts[0];
    if (casts.length > 1 && !g.infinite(p)) {
      let bestSum = -1;
      for (let mask = 1; mask < (1 << casts.length); mask++) {
        let cost = 0, sum = 0, cnt = 0, top = null;
        casts.forEach((c, i) => { if (mask & (1 << i)) { cost += c.cost; sum += c.s; cnt++; if (!top || c.s > top.s) top = c; } });
        if (cnt <= 3 && cost <= avail && sum > bestSum) { bestSum = sum; pick = top; }
      }
    }
    const best = [pick, ...opts.filter(x => x.cost == null)].filter(Boolean).sort((a, b) => b.s - a.s)[0];
    if (best && g.explain && best.why) {
      const others = opts.filter(x => x !== best && x.why).sort((a, b) => b.s - a.s).slice(0, 2);
      const run = best.run;
      best.run = () => {
        this.explain(g, p, `${best.why} (value ${best.s.toFixed(1)}${others.length ? `; next best: ${others.map(x => `${x.why.replace(/^\w+ /, '')} ${x.s.toFixed(1)}`).join(', ')}` : ''})`);
        return run();
      };
    }
    // (the look-ahead tries the other options too)
    if (best) /** @type {any} */ (best).opts = opts;
    return best;
  }

  pickPW(g, p, pw) {
    let best = null, bv = -1e9;
    for (const ab of pw.fx.pw) {
      if (pw.loyalty + ab.cost < 0 || (ab.cost < 0 && pw.loyalty + ab.cost === 0 && g.opponents(p).length > 1)) continue;
      let v = ab.effects.reduce((s, e) => s + this.effectValue(g, p, pw, e, false), 0);
      if (!ab.effects.length) v = ab.cost >= 0 ? 0.5 : -5;
      v += ab.cost * 0.6;
      if (v > bv) { bv = v; best = ab; }
    }
    return bv > -1 ? best : null;
  }

  scoreCast(g, p, o, phase) {
    const f = o.fx, t = f.type;
    if (!t.permanent && isCounter(o)) return 0;
    const round = g.round;
    let s = 0;
    if (t.creature) s += this.value(g, o);
    if (o.isCommander) s += 4;
    if (f.mana && !t.creature) s += round <= 6 ? 7 : 2;
    if (f.mana && t.creature) s += round <= 5 ? 3 : 0.5;
    const effects = t.permanent ? (f.etbModes ? this.chooseModes(g, p, o, f.etbModes) : f.etb)
      : f.spree?.length ? f.spree.filter(sm => sm.effects.reduce((a, e) => a + this.effectValue(g, p, o, e, true), 0) > 0).flatMap(sm => sm.effects)
        : (f.modes ? this.chooseModes(g, p, o, f.modes) : f.spell);
    if (f.modes && !effects.length) return 0;
    if (f.saga) s += f.saga.reduce((a, ch) => a + (ch || []).reduce((b, e) => b + Math.max(0, this.effectValue(g, p, o, e, false)), 0), 0) * 0.7;
    if (f.onCast) s += 3;
    if (f.costReduce) s += 1.5 + f.costReduce.n;
    if (f.landfall?.length) s += 2 + f.landfall.reduce((a, e) => a + Math.max(0, this.effectValue(g, p, o, e, false)), 0);
    if (f.onOppCast) s += 4;
    if (f.attackTax) s += 2 + g.opponents(p).reduce((a, q) => a + q.battlefield.filter(c => c.fx.type.creature).length, 0) * 0.3;
    if (f.handOnly) s += 2;
    for (const e of effects) {
      if (phase === 'eot' && (e.k === 'pump' || e.k === 'teamPump')) return 0;
      const v = this.effectValue(g, p, o, e, !t.permanent);
      if (v <= -50) return 0;
      s += v;
    }
    if (t.planeswalker) s += 5 + (parseInt(o.card.loyalty, 10) || 3) * 0.4;
    // Additional costs (sacrifice a creature, discard a card) are part of the price
    if (f.addCost) { s -= this.extraCostValue(g, p, o, f.addCost, { spell: o }); if (s <= 0) return 0; }
    if (t.aura && f.controlAura) { const tg = this.bestEnemy(g, p, x => x.fx.type.creature); return tg ? tg.v * 1.3 : 0; }
    if (t.aura) { if (!this.chooseAuraTarget(g, p, o)) return 0; s += 2 + (f.attachBuff ? Math.abs(f.attachBuff.p) + Math.abs(f.attachBuff.t) * 0.5 : 2); }
    if (t.equipment) s += 2 + (p.battlefield.some(c => c.fx.type.creature) ? 2 : 0);
    if (f.anthem) s += 2 + p.battlefield.filter(c => c.fx.type.creature).length * (f.anthem.p + f.anthem.t) * 0.5;
    if ((t.artifact || t.enchantment || t.battle) && s === 0) s = 1 + (o.card.cmc || 0) * 0.4;
    if ((t.instant || t.sorcery) && !effects.length) s = 0.3;
    // Instant-speed cards are better saved for an opponent's end step than cast in our own main phase
    if (instantSpeed(o) && this.style !== 'aggressive' && phase === 'main1' && !t.land) s *= t.creature ? 0.7 : 0.4;
    // Per-deck memory: cards that showed up in this deck's wins get a nudge (learn.js)
    if (this.learned?.[o.card.name] && s > 0) s = Math.max(0.1, s + this.learned[o.card.name]);
    // Big spells into likely counterspell mana are worth less (unless we can fight back); cheap ones are fine
    if ((o.card.cmc || 0) >= 4 && this.style !== 'aggressive' && !p.hand.some(c => c !== o && isCounter(c) && g.canCast(p, c))) {
      const risk = this.counterRisk(g, p);
      if (risk > 0.25) s *= 1 - risk * 0.45;
    }
    return s + (o.card.cmc || 0) * 0.2;
  }

  effectValue(g, p, src, e, isSpell) {
    const opps = g.opponents(p);
    const N = v => (v === 'X' ? this.xOverride ?? Math.max(1, g.availableMana(p) - (src.card.cmc || 0)) : v && typeof v === 'object' ? g.dynValue(p, v) : v);
    const myCreatures = p.battlefield.filter(o => o.fx.type.creature);
    // Life thresholds below were set for Commander's 40; L scales them to the format (0.5 at 20 life)
    const L = (g.startLife || 40) / 40;
    switch (e.k) {
      case 'draw': return 2 * N(e.n) * (p.hand.length <= 2 ? 1.5 : 1);
      case 'gain': return N(e.n) * (p.life < 20 * L ? 0.3 : 0.12) / L;
      case 'drain': return N(e.n) * 0.5 * opps.length;
      case 'loseLife': return N(e.n) * 0.5;
      case 'damage': {
        if (e.to.startsWith('each')) return N(e.n) * 0.6 * opps.length;
        if (e.to === 'defender') return N(e.n) * 0.6;
        const tgt = this.chooseTarget(g, p, e, src);
        if (!tgt) return isSpell ? -100 : 0;
        return tgt.obj ? this.value(g, tgt.obj) + this.comboDanger(g, tgt.obj) : (g.players[tgt.player].life <= N(e.n) ? 50 : N(e.n) * 0.5);
      }
      case 'remove': {
        // Don't spend a removal spell on something minor; save it for a real threat
        const t = this.chooseTarget(g, p, e, src);
        if (!t) return isSpell ? -100 : 0;
        if (isSpell && t.v < 3.5) return -100;
        return t.v * 1.1;
      }
      case 'bounce': { const t = this.chooseTarget(g, p, e, src); return t ? t.v * 0.5 : (isSpell ? -100 : 0); }
      case 'wipe': case 'sweep': {
        const dies = o => (e.k === 'sweep' ? o.fx.type.creature && g.toughness(o) <= N(e.n) && !g.has(o, 'indestructible')
          : this.matches(o, { 'other creatures': 'creature', creatures: 'creature', 'nonland permanents': 'nonland permanent', artifacts: 'artifact', enchantments: 'enchantment', 'artifacts and enchantments': 'artifact or enchantment',
            'nontoken creatures': 'creature', 'nonartifact creatures': 'creature', "creatures you don't control": 'creature', 'creatures your opponents control': 'creature', "nonland permanents you don't control": 'nonland permanent', planeswalkers: 'planeswalker', lands: 'land' }[e.what] || 'creature') && (e.mode === 'exile' || !g.has(o, 'indestructible')));
        const theirs = opps.reduce((s, q) => s + q.battlefield.filter(dies).reduce((a, o) => a + this.value(g, o) + this.comboDanger(g, o), 0), 0);
        // (one-sided wipes leave our own board alone)
        const mine = /you don't control|opponents control/.test(e.what || '') ? 0 : p.battlefield.filter(dies).reduce((a, o) => a + this.value(g, o), 0);
        const net = theirs - mine * (this.cstyle === 'defensive' ? 1.1 : 1.5);
        // Hold a wipe while nobody is pressuring us and it would only clear a modest board
        const pressure = opps.reduce((s, q) => s + q.battlefield.filter(c => c.fx.type.creature).reduce((a, c) => a + g.power(c), 0), 0);
        if (net <= 8 || (isSpell && net < 16 && pressure < p.life * 0.35)) return -100;
        return net * 0.6;
      }
      case 'token': return N(e.n) * (N(e.p) + N(e.t)) * 0.7 + e.kw.length * 0.5;
      case 'manifest': return N(e.n || 1) * (e.cloak ? 3.2 : 2.8);
      case 'treasure': return N(e.n) * 1.5;
      case 'rampLand': return g.round <= 7 ? 4 * N(e.n) + (e.bf ? 2 : 0) : 1.5;
      case 'tutor': {
        // Worth much more when it finds the last piece of a combo
        const close = p.combos.some(c => { const m = comboState(g, p, c).missing; return m.length === 1 && m[0].zone === 'library'; });
        return close ? (this.style === 'cedh' ? 20 : 14) : this.style === 'cedh' ? 7 : 4;
      }
      case 'teamPump': {
        const attackers = myCreatures.filter(o => g.canAttack(o));
        return isSpell && attackers.length >= 2 ? attackers.length * N(e.p) * 0.8 : (isSpell ? -100 : 1);
      }
      case 'pump': return myCreatures.length ? 1.5 : (isSpell ? -100 : 0);
      case 'counters': return e.on.startsWith('target') ? (myCreatures.length ? N(e.n) * 1.5 : (isSpell ? -100 : 0)) : N(e.n) * Math.max(1, myCreatures.length) * 1.2;
      case 'reanimate': {
        const types = e.types?.length ? e.types : ['creature'];
        const pool = (e.any ? g.alive().flatMap(q => q.graveyard) : p.graveyard).filter(o => types.some(t => o.fx.type[t]) && o !== src);
        const c = this.pickBest(g, pool);
        return c ? this.value(g, c) + 1 : (isSpell ? -100 : 0);
      }
      case 'regrow': {
        const n = p.graveyard.filter(o => o !== src && (e.types?.length ? e.types.some(t => o.fx.type[t]) : !o.fx.type.land)).length;
        return n ? 2.5 * Math.min(n, e.n || 1) : (isSpell ? -100 : 0);
      }
      case 'edict': {
        if (e.that) return 2.5;
        const theirs = opps.filter(q => q.battlefield.some(o => o.fx.type.creature)).length * 2.5 * (e.n || 1);
        return e.all ? theirs - (this.pickSacrifice(g, p) ? Math.min(6, this.value(g, this.pickSacrifice(g, p))) * (e.n || 1) : 0) : theirs;
      }
      case 'discard': return N(e.n) * (e.who.startsWith('each') ? opps.length : 1) * (e.named || e.chosen ? 2 : 1.1);
      // Past in Flames is worth the spells it lets us cast again
      case 'freeCast': return p.hand.some(o => !o.fx.type.land && (o.card.cmc || 0) <= e.maxMv && o !== src) ? 2 + e.maxMv * 0.6 : 0;
      case 'addManaN': {
        // (Jeska's Will, Sacrifice: worth it when the mana unlocks something in hand)
        if (!e.n || typeof e.n !== 'object') return 0;
        const n = g.dynValue(p, e.n, { src });
        const after = g.availableMana(p) - (src.card.cmc || 0) + n;
        const unlocks = [...p.hand, ...p.command].some(o => o !== src && !o.fx.type.land && (o.card.cmc || 0) > g.availableMana(p) && (o.card.cmc || 0) <= after && (this.value(g, o) >= 3 || this.pieceWorth(g, p, o)));
        return unlocks ? 3 + n - (src.card.cmc || 0) : n >= 5 ? n - (src.card.cmc || 0) : 0;
      }
      case 'drawThat': return -0.5;
      case 'namedCounter': return 0.3;
      case 'grantFlashback': {
        const pool = p.graveyard.filter(o => (o.fx.type.instant || o.fx.type.sorcery) && o !== src && o.fx.spell.length);
        return e.all ? pool.length * 1.5 : pool.length ? 3 : (isSpell ? -100 : 0);
      }
      case 'copyToken': { const t = this.chooseTarget(g, p, e, src); return t ? t.v : (isSpell ? -100 : 0); }
      case 'sacSelf': return 0;
      // Silence is saved for protecting a combo (see bestPlay); Ad Nauseam wants a healthy life total
      case 'silence': return isSpell ? -100 : 0;
      case 'redirect': return isSpell ? -100 : 0;
      // Untapping mana sources is worth the mana it gives back, if there's something left to spend it on
      case 'untapAll': {
        const kinds = { 'nonland permanents': o => !o.fx.type.land, artifacts: o => o.fx.type.artifact, creatures: o => o.fx.type.creature, lands: o => o.fx.type.land };
        const ok = kinds[e.what] || (() => true);
        let tapped = p.battlefield.filter(o => o.tapped && o.fx.mana && ok(o)).map(o => o.fx.mana.amount).sort((a, b) => b - a);
        if (e.n) tapped = tapped.slice(0, e.n);
        const back = tapped.reduce((a, b) => a + b, 0) - (src.card.cmc || 0);
        const more = p.hand.some(o => o !== src && !o.fx.type.land && (o.card.cmc || 0) > 0);
        return back > 0 && more ? back * 2 : isSpell ? -100 : 0;
      }
      case 'mill': {
        // Storm multiplies it; it only matters when a library actually runs out
        const n = N(e.n) * (src.fx.storm ? (g.turnSpellCount?.turn === g.turn ? g.turnSpellCount.n : 0) + 1 : 1);
        const low = Math.min(...g.opponents(p).map(q => q.library.length));
        return n >= low ? 40 : n * 0.08;
      }
      case 'adNauseam': return p.life >= 25 * L ? 10 + Math.min(8, (p.life - 20 * L) / (3 * L)) : -100;
      case 'addMana': {
        // A ritual is only worth casting if the extra mana lets us cast something we otherwise couldn't
        const before = g.availableMana(p) - (src.card.cmc || 0);
        const after = before + e.syms.length;
        const unlocks = [...p.hand, ...p.command].some(o => o !== src && !o.fx.type.land && !o.fx.spell.some(x => x.k === 'addMana')
          && (o.card.cmc || 0) > g.availableMana(p) && (o.card.cmc || 0) <= after && (this.value(g, o) >= 3 || o.fx.spell.length || this.pieceWorth(g, p, o)));
        return unlocks ? 3 + e.syms.length - (src.card.cmc || 0) : (isSpell ? -100 : 0);
      }
      case 'blink': { const t = this.chooseTarget(g, p, e, src); return t ? t.v * 0.9 : (isSpell ? -100 : 0); }
      case 'steal': {
        const t = this.chooseTarget(g, p, e, src);
        if (!t) return isSpell ? -100 : 0;
        // Borrowing a creature is only worth it before combat
        return e.temp ? (g.phase === 'main1' ? t.v * 0.6 : (isSpell ? -100 : 0)) : t.v * 1.4;
      }
      case 'flickerDelay': { const t = this.chooseTarget(g, p, e, src); return t ? t.v * 0.45 : (isSpell ? -100 : 0); }
      case 'extraTurn': return 14;
      case 'extraCombat': return 2 + myCreatures.filter(o => g.power(o) > 0).reduce((s, o) => s + g.power(o), 0) * 0.5;
      case 'counter': case 'counterAbility': case 'copySpell': case 'protect': return isSpell ? -100 : 0;
      case 'if': {
        const ok = g.evalCond(p, src, e.cond, { x: e.cond.c === 'x' ? N('X') : 0, kicked: g.availableMana(p) >= (src.card.cmc || 0) + 2 });
        const branch = ok && !(e.cond.c === '?' && (e.else || e.effects.some(x => x.k === 'win'))) ? e.effects : e.else || [];
        return branch.reduce((s, x) => s + this.effectValue(g, p, src, x, false), 0);
      }
      case 'scry': return N(e.n) * 0.5;
      case 'surveil': return N(e.n) * 0.6;
      case 'dig': return Math.min(N(e.n), e.take) * (e.types.length ? 1.2 : 1.6) + (e.bf ? 1.5 : 0);
      case 'impulse': return N(e.n) * (g.availableMana(p) >= 3 ? 1.5 : 0.8);
      case 'artifactToken': return N(e.n) * ({ clue: 1.6, food: 0.7, blood: 0.8, map: 0.7, powerstone: 1.3 }[e.kind] || 1);
      case 'fight': case 'shrink': case 'minus': {
        if (e.k === 'minus' && !e.on.startsWith('target')) {
          const n = N(e.n);
          const pool = e.on.includes('opponent') || e.on.includes("don't") ? opps.flatMap(q => q.battlefield) : g.alive().flatMap(q => q.battlefield);
          return pool.filter(o => o.fx.type.creature && g.toughness(o) <= n).reduce((s, o) => s + (o.controller === p.idx ? -this.value(g, o) : this.value(g, o)), 0) * 0.8;
        }
        const t = this.chooseTarget(g, p, e, src);
        return t ? t.v * 0.9 : (isSpell ? -100 : 0);
      }
      case 'shrinkAll': {
        const dies = o => o.fx.type.creature && g.toughness(o) <= N(e.t);
        const theirs = opps.reduce((s, q) => s + q.battlefield.filter(dies).reduce((a, o) => a + this.value(g, o), 0), 0);
        const mine = e.opp ? 0 : p.battlefield.filter(dies).reduce((a, o) => a + this.value(g, o), 0);
        const net = theirs - mine * 1.5;
        return net > 4 ? net * 0.6 : (isSpell ? -100 : 0);
      }
      case 'tap': { const t = this.chooseTarget(g, p, e, src); return t ? Math.min(3, t.v * 0.2) : 0; }
      case 'tapAll': return opps.reduce((s, q) => s + q.battlefield.filter(o => o.fx.type.creature && !o.tapped).length, 0) * 0.7;
      case 'goad': return e.all ? opps.reduce((s, q) => s + q.battlefield.filter(o => o.fx.type.creature).length, 0) * 1.2 : (this.chooseTarget(g, p, e, src) ? 2.5 : 0);
      case 'proliferate': return p.battlefield.filter(o => o.counters > 0 || o.fx.type.planeswalker).length * 0.8 + opps.filter(q => q.poison > 0).length * 1.5;
      case 'populate': return p.battlefield.some(o => o.token && o.fx.type.creature) ? 2.5 : 0;
      case 'monstrous': return src.monstrous ? -1 : N(e.n) * 1.3;
      case 'adapt': return src.counters > 0 ? 0 : N(e.n) * 1.2;
      case 'bolster': case 'support': return myCreatures.length ? N(e.n) * 1.1 : 0;
      case 'connive': return 1.5;
      case 'explore': return 1.6;
      case 'cascade': return e.discover ? 1 + N(e.n) * 0.8 : 3;
      case 'regen': return myCreatures.length ? 0.6 : 0;
      case 'drawEach': return N(e.n) * (2 - opps.length * 0.5);
      case 'discardSelf': return -N(e.n) * (p.hand.length <= 2 ? 1.5 : 0.6);
      case 'sacOwn': return -(this.pickSacrifice(g, p) ? Math.min(4, this.value(g, this.pickSacrifice(g, p))) : 0);
      // A self-pump is only worth it in combat (as a trick) or when it makes the creature survive
      case 'modal': return [...e.modes].map(es => es.reduce((s, x) => s + this.effectValue(g, p, src, x, false), 0)).sort((a, b) => b - a).slice(0, e.n).reduce((s, v) => s + Math.max(0, v), 0);
      case 'doubleCounters': return p.battlefield.reduce((s, o) => s + Math.max(0, o.counters), 0) * 1.1;
      case 'returnSelfHand': return 2;
      // A Fog is held for an opponent's attack (see combatTrick)
      case 'fog': return isSpell ? -100 : 0;
      case 'win': return g.kingdoms ? 0 : 1000;
      case 'exileSelf': return -1;
      // Untapping a mana source just gives back what it costs (combos handle the loops)
      case 'untapSelf': return src.tapped && !src.fx.mana ? 1.5 : 0;
      case 'payFor': return e.effects.reduce((s, x) => s + this.effectValue(g, p, src, x, false), 0) * 0.7;
      case 'evade': return e.self ? (g.phase === 'main1' ? 1.5 : 0) : (myCreatures.length && g.phase === 'main1' ? 1.5 : 0);
      case 'kwCounter': return 2;
      case 'topLandOrHand': return 2;
      case 'animate': return g.phase === 'main1' && g.active === p.idx ? (N(e.p) >= 3 ? 2 : 0.5) : 0;
      case 'attachSelf': return myCreatures.length ? 1.5 : 0;
      case 'loseThat': return N(e.n) * 0.5;
      case 'poison': return N(e.n) * (e.who === 'each player' ? 0.5 : 1.5) * (e.who.startsWith('each') && e.who !== 'each player' ? opps.length : 1);
      case 'pact': return 0;
      case 'bounceOwn': return e.what === 'land' ? -0.5 : -2;
      case 'extraLand': return p.hand.some(o => o.fx.type.land) ? 2.5 : 0;
      case 'pumpSelf': return src.attacking != null || src.blocking != null ? (N(e.p) + N(e.t)) * 0.8 + e.kw.length : 0;
      case 'loseAll': return N(e.n) * (0.5 * opps.length - (p.life < 15 * L ? 0.6 : 0.15)) / L;
      case 'loseSelf': return -N(e.n) * (p.life < 15 * L ? 0.6 : 0.15) / L;
      case 'monarch': return g.monarch === p.idx ? 0 : 5;
      case 'fromHand': return p.hand.some(o => o !== src && (e.what === 'land' ? o.fx.type.land : this.matches(o, e.what))) ? (e.what === 'land' ? 2.5 : 4) : 0;
      case 'reshuffle': return p.library.length < 15 ? 3 : 0;
      case 'exileGy': return e.all ? opps.reduce((s, q) => s + q.graveyard.filter(o => o.fx.type.creature || o.fx.flashback).length, 0) * 0.3 : 0.5;
      case 'massReanimate': {
        const pool = (e.all ? g.alive() : [p]).flatMap(q => q.graveyard.filter(o => g.isA(o, e.what) && o.fx.type.permanent));
        return pool.reduce((s, o) => s + (o.owner === p.idx || !e.all ? this.value(g, o) : -this.value(g, o)), 0) * 0.7;
      }
      case 'germ': return 2 + e.p;
      case 'modular': case 'returnSelf': return 2;
      // ---- 1.6.0 effects
      case 'doublePT': return e.all ? (g.phase === 'main1' || g.phase === 'combat' ? myCreatures.filter(o => g.canAttack(o) || o.attacking != null).reduce((s, o) => s + Math.max(0, g.power(o)), 0) * 0.6 : 0) : (myCreatures.length ? 2 : (isSpell ? -100 : 0));
      case 'pumpTrig': case 'pumpAttached': return (N(e.p) + N(e.t)) * 0.4 + e.kw.length * 0.5;
      case 'copyTrig': return 3;
      case 'shieldSelf': return isSpell ? (opps.some(q => q.battlefield.filter(o => o.fx.type.creature).reduce((s, o) => s + g.power(o), 0) >= p.life) ? 12 : -100) : 4;
      case 'ring': return 2;
      case 'playerCounter': return N(e.n) * 0.5;
      case 'uncounterNext': return isSpell ? -100 : 0.3;
      case 'bottomSelf': return -0.5;
      case 'returnTrig': return 3;
      case 'transform': return 1;
      case 'bounceAll': return e.what === 'attacking' ? 3 : opps.reduce((s, q) => s + q.battlefield.filter(o => o.fx.type.creature).reduce((a, o) => a + this.value(g, o) * 0.5, 0), 0) - myCreatures.reduce((a, o) => a + this.value(g, o) * 0.3, 0);
      case 'roll': return (e.table || []).reduce((s, r) => s + r.effects.reduce((a, x) => a + this.effectValue(g, p, src, x, false), 0) * (r.hi - r.lo + 1) / e.d, 0) || 0.5;
      case 'flashTurn': return 0.5;
      case 'gyCastTurn': return p.graveyard.filter(o => !o.fx.type.land && (!e.types.length || e.types.some(t => o.fx.type[t]))).length * 1.2;
      case 'stealAll': return 6;
      case 'level': return 2.5 + e.n;
      case 'station': return src.fx.stationN && (src.named?.charge || 0) < src.fx.stationN ? 3 : 1;
      case 'wheel': return Math.max(...g.alive().map(q => q.hand.length)) - p.hand.length + 1;
      case 'commanderToHand': return p.command.length ? 3 : 0;
      case 'stripProt': return isSpell ? -100 : 0.5;
      case 'livingDeath': {
        const mineGy = p.graveyard.filter(o => o.fx.type.creature).reduce((s, o) => s + this.value(g, o), 0) - myCreatures.reduce((s, o) => s + this.value(g, o), 0);
        const theirs = opps.reduce((s, q) => s + q.battlefield.filter(o => o.fx.type.creature).reduce((a, o) => a + this.value(g, o), 0) - q.graveyard.filter(o => o.fx.type.creature).reduce((a, o) => a + this.value(g, o), 0), 0);
        return mineGy + theirs * 0.5 > 6 ? (mineGy + theirs * 0.5) * 0.6 : (isSpell ? -100 : 0);
      }
      case 'ignition': { const m = this.bestOwn(g, p); return m ? g.power(m) * opps.length * 0.8 + opps.reduce((s, q) => s + q.battlefield.filter(o => o.fx.type.creature && g.toughness(o) <= g.power(m)).length, 0) * 2 : (isSpell ? -100 : 0); }
      case 'copyAllTokens': return p.battlefield.filter(o => o.token).length * 1.2;
      case 'maze': return 1;
      case 'attachTrig': return 1;
      case 'oppToken': return -0.5;
      case 'tempLandBoost': return p.battlefield.filter(o => g.isA(o, e.what)).length - 1;
      case 'sacUnless': return -1;
      case 'allIsDust': return opps.reduce((s, q) => s + q.battlefield.filter(o => (o.card.colors || []).length).reduce((a, o) => a + this.value(g, o), 0), 0) - p.battlefield.filter(o => (o.card.colors || []).length).reduce((a, o) => a + this.value(g, o), 0) * 1.3;
      case 'exileTrigCard': case 'peek': return 0;
      case 'sweepThat': return 3;
      case 'untapAttached': return 0.5;
      case 'insurrection': return g.phase === 'main1' ? opps.reduce((s, q) => s + q.battlefield.filter(o => o.fx.type.creature).reduce((a, o) => a + Math.max(0, g.power(o)), 0), 0) * 0.5 : (isSpell ? -100 : 0);
      case 'cantLoseTurn': return isSpell ? -100 : 0;
      case 'wipeOpp': return opps.reduce((s, q) => s + q.battlefield.filter(o => g.isA(o, (e.what || 'creature').replace(/ or .*/, ''))).length, 0) * 2;
      // ---- 1.7.0
      case 'preventMe': return isSpell ? (g.phase === 'combat' && opps.some(q => q.battlefield.some(o => o.attacking === p.idx)) ? 4 : -100) : 1;
      case 'millHalf': return opps.length ? 4 : 0;
      case 'doubleLife': return p.life >= 10 ? p.life / 5 : 1;
      case 'shuffleSelf': return 0;
      case 'loseHalf': return 4;
      case 'bounceOpp': return Math.max(...opps.map(q => q.battlefield.filter(o => !o.fx.type.land).reduce((a, o) => a + this.value(g, o), 0)), 0) * 0.5;
      case 'nonbasicBurn': return g.alive().reduce((s, q) => s + (q === p ? -1 : 1) * q.battlefield.filter(o => o.fx.type.land && !o.fx.type.basic).length * (e.times || 1), 0);
      case 'sacUnlessPay': case 'sacUnlessTap': return -0.5;
      case 'noBlock': return isSpell ? (g.phase === 'main1' && g.active === p.idx ? 1.5 : -100) : 0.8;
      case 'gyExileTurn': return 0;
      case 'exploit': return p.battlefield.some(o => o !== src && o.fx.type.creature && o.token) || src?.fx.exploitFx ? 1 : 0;
      case 'keepOne': {
        // What everyone else loses against what this player loses
        const loss = q => q.battlefield.filter(o => o.fx.type.creature || (e.pw && o.fx.type.planeswalker)).map(o => this.value(g, o)).sort((a, b) => b - a).slice(e.n).reduce((s, v) => s + v, 0);
        return e.who === 'each' ? opps.reduce((s, q) => s + loss(q), 0) - loss(p) * 1.3 : 3;
      }
      // ---- 1.17.0 (card scan, item 82)
      case 'deadbridge': return p.graveyard.length ? 2.5 : 0;
      case 'hermit': return p.library.some(o => o.fx.type.basic) ? 1.5 : (p.battlefield.some(o => o.fx.labMan) || p.hand.some(o => o.fx.labMan) ? 30 : (isSpell ? -100 : -5));
      case 'bribery': return Math.max(0, ...opps.flatMap(q => q.library.filter(o => o.fx.type.creature).map(o => this.value(g, o)))) * 0.9;
      case 'peer': return p.library.length > 25 && p.life > 20 * L ? 6 : (isSpell ? -100 : -5);
      case 'moveEquip': return p.battlefield.some(o => o.fx.type.equipment && !o.attachedTo) && myCreatures.length ? 1.5 : 0;
      case 'tapAttached': return 0;
      case 'doublePool': return p.pool.length * 0.8;
      case 'halfLifeDamage': return opps.reduce((s, q) => s + Math.floor(q.life / 2), 0) * 0.5 - Math.floor(p.life / 2) * 0.7;
      case 'lostAgain': return opps.reduce((s, q) => s + (q.lostLifeTurn === g.turn ? q.lostAmt || 0 : 0), 0) * 0.5;
      case 'copyAbility': { const it = [...g.stack].reverse().find(x => x.ability && x.p === p && x.o !== src); return it ? it.effects.reduce((s, x) => s + this.effectValue(g, p, it.o, x, false), 0) : 0; }
      case 'grasp': return 4;
      case 'sacUnlessEscaped': return src?.escaped ? 0 : -this.value(g, src) * 0.6;
      case 'gyFreeCast': return Math.max(0, ...p.graveyard.filter(o => e.types.some(t => o.fx.type[t])).map(o => o.fx.spell.reduce((s, x) => s + this.effectValue(g, p, o, x, true), 0)));
      case 'castCommanderFree': return p.command.length ? 5 : 0;
      case 'reanimateTrig': return 3;
      case 'becomeCopy': {
        if (!src || src.zone !== 'battlefield') return e.eot ? 0.5 : 2;
        const pool = e.trig ? [] : (e.gy ? p.graveyard : e.own ? p.battlefield : g.alive().flatMap(q => q.battlefield)).filter(x => x !== src && !x.token && e.what.split(' or ').some(w => w === 'permanent' ? x.fx.type.permanent : g.isA(x, w)));
        const best = Math.max(0, ...pool.map(x => this.value(g, x)));
        return Math.max(0, best - this.value(g, src)) * (e.eot ? 0.3 : 0.8);
      }
      case 'grantRebound': return 1.5;
      case 'returnTrigHand': return 2;
      case 'teamBase': return myCreatures.filter(o => !e.what || g.isA(o, e.what)).reduce((s, o) => s + Math.max(0, N(e.p) - g.power(o)), 0) * (g.active === p.idx && g.phase === 'main1' ? 0.6 : 0.1);
      case 'animateAll': return g.active === p.idx && g.phase === 'main1' ? p.battlefield.filter(o => o.fx.type.artifact && !o.fx.type.creature).length * 1.5 : 0;
      case 'devour': return 0;
      default: return 0;
    }
  }

  // What paying a cost's non-mana parts gives up (cheapest choices assumed)
  extraCostValue(g, p, o, c, ab = {}) {
    if (!c) return (ab.life || 0) * 0.25 + (ab.discard || 0) * 1.5;
    const pool = g.costPools(p, o, c, ab.spell);
    const cheapest = (cards, n) => cards.map(x => this.value(g, x) * (x.token ? 0.5 : 1) + this.pieceWorth(g, p, x) + (x.isCommander ? 8 : 0)).sort((a, b) => a - b).slice(0, n).reduce((s, v) => s + v, 0);
    let v = c.life * 0.25;
    if (c.discard) v += c.discard.n * 1.2 + cheapest(pool.discard.filter(x => !x.fx.type.land || p.battlefield.filter(l => l.fx.type.land).length < 4), c.discard.n) * 0.15;
    if (c.discardHand) v += p.hand.length * 1.5;
    if (c.sac) v += cheapest(pool.sac, c.sac.n);
    if (c.exileGy) v += c.exileGy * 0.2;
    if (c.tapOthers) v += c.tapOthers.n * (g.phase === 'main1' ? 1 : 0.2);
    if (c.removeCounters) v += c.removeCounters * 1.2;
    if (c.bounce) v += 1;
    if (c.mill) v += c.mill * 0.1;
    if (c.untapOthers) v += c.untapOthers.n * 0.2;
    if (c.exert) v += 1;
    if (c.minusSelf) v += 1.5;
    if (c.exileOwn) v += cheapest(pool.exileOwn, 1);
    if (c.removeAny) v += c.removeAny * 1;
    if (c.forage) v += 1;
    if (c.energy) v += c.energy * 0.5;
    return v;
  }
  // Activated abilities that can be paid for now while leaving `keep` mana open, with their value
  usableAbilities(g, p, keep = 0) {
    const out = [];
    const avail = g.availableMana(p);
    for (const o of p.battlefield.filter(x => g.abilitiesOf(x).length && x.usedAbility !== g.turn)) {
      for (const ab of g.abilitiesOf(o)) {
        const cost = parseCost(ab.cost);
        if (keep && avail - (cost.generic + cost.pips.length) < keep) continue;
        if (!g.canActivate(p, o, ab)) continue;
        if (ab.life && p.life <= ab.life + 5) continue;
        // What it costs besides mana: the permanent itself, life, cards, other permanents
        const extra = (ab.sacSelf ? (o.token && !o.fx.type.creature ? 0.3 : this.value(g, o) + this.pieceWorth(g, p, o)) : 0) + this.extraCostValue(g, p, o, ab.costs, ab);
        // {X} in the cost: value the best X that leaves the kept mana open (an X of 0 does nothing)
        if (cost.x && g.rules >= 5) {
          const max = g.maxAbilityX(p, o, ab) - Math.ceil(keep / cost.x);
          const best = this.bestAbilityX(g, p, o, ab, max);
          if (best.x < 1) continue;
          out.push({ o, ab, s: best.s - extra, x: best.x });
          continue;
        }
        out.push({ o, ab, s: ab.effects.reduce((sum, e) => sum + this.effectValue(g, p, o, e, false), 0) - extra });
      }
    }
    return out;
  }
  // The X worth paying for an ability: each X is valued as the ability's effects with that X, less a little for
  // the mana spent (so 1 more damage that changes nothing doesn't eat the rest of the mana)
  bestAbilityX(g, p, o, ab, max) {
    const per = parseCost(ab.cost).x || 1;
    let best = { x: 0, s: 0 };
    const prev = this.xOverride;
    try {
      for (let x = 1; x <= Math.min(max, 20); x++) {
        this.xOverride = x;
        const s = ab.effects.reduce((sum, e) => sum + this.effectValue(g, p, o, e, false), 0) - x * per * 0.15;
        if (s > best.s + 0.05) best = { x, s };
      }
    } finally { this.xOverride = prev; }
    return best;
  }
  // Mutate onto the creature that gains most from it: one that can attack now, and not our commander
  chooseMutateTarget(g, p, o, hosts) {
    return [...hosts].sort((a, b) => (this.value(g, b) + (b.sick ? 0 : 2) - (b.isCommander ? 3 : 0)) - (this.value(g, a) + (a.sick ? 0 : 2) - (a.isCommander ? 3 : 0)))[0] || null;
  }
  chooseAbilityX(g, p, o, ab, max) { return this.bestAbilityX(g, p, o, ab, max).x; }
  // What turning a face-down permanent up gains: the real card over a vanilla 2/2, plus its "turned face up" effect
  faceUpValue(g, p, o) {
    if (!o.faceDown) return 0;
    const real = Object.assign(Object.create(Object.getPrototypeOf(o)), o, { card: o.faceCard, fx: o.faceFx, faceDown: null });
    const gain = (o.faceFx.type.creature ? this.value(g, real) : 0) - this.value(g, o) + (o.faceFx.morph?.mega ? 1 : 0);
    return gain + (o.faceFx.turnedUp || []).reduce((s, e) => s + this.effectValue(g, p, o, e, false), 0);
  }

  // ---------- instant speed
  // Mana held up through an opponent's turn gets used before it would untap anyway
  async endOfTurn(g, q, active) {
    const nextUp = g.nextAlive(active.idx) === q.idx;
    for (let i = 0; i < 3 && !g.over && !q.lost; i++) {
      // Until our own turn is next, keep enough open for a counterspell
      const counters = q.hand.filter(isCounter);
      const keep = nextUp || !counters.length ? 0 : Math.min(...counters.map(o => o.card.cmc || 0));
      let best = null, bs = 2;
      // Someone visibly close to a combo: keep instant-speed removal for their pieces, not for small stuff
      const close = this.closestCombo(g, q);
      const lastAnswer = close.closeness >= 0.5 && q.hand.filter(o => instantSpeed(o) && o.fx.spell.some(e => e.k === 'remove' || e.k === 'bounce')).length <= 1;
      for (const o of q.hand) {
        if (!instantSpeed(o) || o.fx.type.land || isCounter(o) || !g.canCast(q, o)) continue;
        if (g.availableMana(q) - (o.card.cmc || 0) < keep) continue;
        if (lastAnswer && o.fx.spell.some(e => e.k === 'remove' || e.k === 'bounce')) {
          const tgt = this.chooseTarget(g, q, o.fx.spell.find(e => e.k === 'remove' || e.k === 'bounce'), o);
          if (!tgt?.obj || this.comboDanger(g, tgt.obj) < 5) continue;
        }
        let s = this.scoreCast(g, q, o, 'eot');
        if (!nextUp && o.fx.spell.some(e => e.k === 'draw')) s *= 0.5;
        if (s > bs) { bs = s; best = o; }
      }
      // Activated abilities are instant speed too: spend leftover mana on them before untapping.
      // Before other opponents' turns, only what leaves the counterspell mana open
      let ability = null;
      for (const a of this.usableAbilities(g, q, keep)) {
        if (a.ab.sorcery) continue;
        const s = nextUp ? a.s : a.s * 0.6;
        if (s > bs) { bs = s; best = null; ability = a; }
      }
      // Walking Ballista: pick off whatever its counters can kill
      let ping = null;
      for (const o of q.battlefield.filter(x => x.fx.pingCounters && x.counters > 0)) {
        const plan = this.pingPlan(g, q, o);
        if (plan && plan.value > bs) { bs = plan.value; best = ability = null; ping = { o, plan }; }
      }
      if (!best && !ability && !ping) return;
      g.log(`End of ${g.pn(active)}'s turn: ${g.pn(q)} ${ping ? 'uses ' + g.cn(ping.o) : 'uses mana held up'}`, { kind: 'minor' });
      if (ping) { await g.ping(q, ping.o, ping.plan.targets); continue; }
      if (ability) { await g.activate(q, ability.o, ability.ab, { x: ability.x }); continue; }
      await g.cast(q, best);
    }
  }

  // An instant in hand that can remove/bounce/kill one of the given permanents
  instantAnswer(g, q, candidates) {
    for (const card of q.hand) {
      if (!card.fx.type.instant || !g.canCast(q, card)) continue;
      const e = card.fx.spell.find(x => x.k === 'remove' || x.k === 'damage' || x.k === 'bounce');
      if (!e || card.fx.spell.indexOf(e) !== 0) continue;
      const n = e.n === 'X' ? g.availableMana(q) - 1 : e.n;
      const ok = a => g.canTarget(q, a) && (e.k === 'remove' ? this.matches(a, e.what) && (e.mode === 'exile' || !g.has(a, 'indestructible'))
        : e.k === 'bounce' ? this.matches(a, e.what) : /any|creature/.test(e.to) && a.fx.type.creature && g.toughness(a) - a.damage <= n && !g.has(a, 'indestructible'));
      const target = candidates.filter(ok).sort((a, b) => this.value(g, b) - this.value(g, a))[0];
      if (target) return { card, target, targets: card.fx.spell.map((x, i) => (i === 0 ? { obj: target } : null)) };
    }
    return null;
  }

  // Between iterations of an opponent's combo loop: kill a piece if we can
  respondToLoop(g, q, p, pieces) {
    const r = this.instantAnswer(g, q, pieces);
    if (r) g.log(`${g.pn(q)} sees the loop and responds`, { kind: 'minor' });
    return r;
  }

  // After blockers: a pump spell that wins a fight, or saves a creature
  combatTrick(g, q, active) {
    // A Fog when the unblocked damage coming at us is lethal, or a big share of our life
    if (q !== active && g.fogTurn !== g.turn) {
      const fog = q.hand.find(o => instantSpeed(o) && g.canCast(q, o) && o.fx.spell.some(e => e.k === 'fog'));
      if (fog) {
        const incoming = active.battlefield.filter(a => a.attacking === q.idx && (!a.blocked || g.has(a, 'trample'))).reduce((s, a) => s + Math.max(0, g.power(a)), 0);
        const cmd = active.battlefield.some(a => a.attacking === q.idx && !a.blocked && a.isCommander && (q.cmdDamage[a.iid] || 0) + g.power(a) >= 21);
        if (incoming >= q.life || cmd || incoming >= Math.max(8, q.life * 0.4)) {
          this.explain(g, q, `casts ${fog.card.name}: ${incoming} damage was about to get through`);
          return { card: fog, targets: [] };
        }
      }
    }
    const tricks = q.hand.filter(o => o.fx.type.instant && g.canCast(q, o) && o.fx.spell[0]?.k === 'pump');
    if (!tricks.length) return null;
    const fights = [];
    for (const o of q.battlefield) {
      if (o.attacking != null) for (const b of o.blockedBy) fights.push([o, b]);
      if (o.blocking != null) { const a = g.objects.get(o.blocking); if (a) fights.push([o, a]); }
    }
    for (const card of tricks.sort((a, b) => a.card.cmc - b.card.cmc)) {
      const e = card.fx.spell[0];
      for (const [mine, foe] of fights) {
        if (!g.canTarget(q, mine) || g.has(mine, 'indestructible')) continue;
        const dies = this.canKill(g, foe, mine);
        const p0 = g.power(mine), t0 = g.toughness(mine) - mine.damage;
        const after = { saves: g.power(foe) < t0 + e.t || e.kw.includes('indestructible'), kills: p0 + e.p >= g.toughness(foe) - foe.damage || e.kw.includes('deathtouch') };
        if ((dies && after.saves) || (!this.canKill(g, mine, foe) && after.kills && after.saves)) {
          g.log(`${g.pn(q)} has a combat trick`, { kind: 'minor' });
          return { card, targets: card.fx.spell.map((x, i) => (i === 0 ? { obj: mine } : null)) };
        }
      }
    }
    return null;
  }

  // ---------- politics
  // Offer a truce to someone who isn't the leader, so both can deal with the bigger threat
  // Only when someone is running away with the game, at most every few rounds
  // Deal kinds: truce (no attacks), gangUp (no attacks, both hit the archenemy), noCounter (no attacks,
  // no counterspells between us: good for a combo deck), tribute (we give a card for safety when we're losing)
  proposeDeal(g, p) {
    if (g.alive().length < 3 || g.round - (this.lastOffer ?? -9) < 3 || g.rand() < 0.5) return null;
    const free = g.opponents(p).filter(q => !g.dealBetween(p.idx, q.idx) && (p.grudge[q.idx] || 0) < 12);
    const arch = g.archenemy != null && g.archenemy !== p.idx ? g.archenemy : null;
    const cands = free.filter(q => q.idx !== arch).sort((a, b) => (p.grudge[b.idx] || 0) - (p.grudge[a.idx] || 0));
    if (!cands.length) return null;
    const to = cands[0];
    const lowest = Math.min(...g.alive().map(x => x.life));
    let kind = null;
    if (arch != null) kind = 'gangUp';
    else if (p.life === lowest && p.life <= 20 && (p.grudge[to.idx] || 0) >= 3) kind = 'tribute';
    else if (this.style === 'combo' || this.style === 'cedh') kind = this.counterOdds(g, to) > 0.15 ? 'noCounter' : null;
    if (!kind) return null;
    this.lastOffer = g.round;
    // How long to ask for: long enough to matter, short enough to be accepted
    const rounds = kind === 'gangUp' ? 2 : kind === 'tribute' ? (p.life <= 10 ? 3 : 1) : kind === 'noCounter' ? 3 : 2;
    this.explain(g, p, `offers ${to.name} a ${kind} deal for ${rounds} round${rounds === 1 ? '' : 's'}: ${kind === 'gangUp' ? 'the archenemy needs stopping' : kind === 'tribute' ? 'we are lowest on life and they keep hitting us' : 'their counterspells are what could stop our combo'}`);
    return { to, kind, rounds };
  }
  considerDeal(g, q, from, kind = 'truce', rounds = 2) {
    if (from.idx === g.archenemy || (q.grudge[from.idx] || 0) >= 12) return false;
    // Not if they're the biggest threat to us, or we were about to kill them
    if ((this.threatRank(g, q).get(from.idx) || 0) >= 1.3) return false;
    const myPower = q.battlefield.filter(o => o.fx.type.creature).reduce((s, o) => s + g.power(o), 0);
    if (myPower >= from.life) return false;
    // Promising not to counter a combo player is how you lose to them
    if (kind === 'noCounter' && (q.hand.some(isCounter) || from.battlefield.some(o => this.comboDanger(g, o) >= 5))) return false;
    // Short deals are easy to agree to; long ones tie our hands
    const odds = ({ gangUp: 0.85, tribute: 0.9, noCounter: 0.5, truce: 0.75 }[kind] ?? 0.75) * (rounds <= 1 ? 1.1 : rounds >= 4 ? 0.65 : rounds === 3 ? 0.85 : 1);
    return g.rand() < (this.style === 'aggressive' ? odds * 0.4 : odds);
  }
  // How much we want to hit this player: the table leader is everyone's target, truce partners aren't
  politicalWeight(g, me, q) {
    let w = 1;
    // Kingdoms: who's worth fighting depends on your secret role (and what you can see of theirs)
    if (g.kingdoms) w *= kingdomsWeight(g, me, q);
    if (g.archenemy === q.idx && g.archenemy !== me.idx) w *= 1.4;
    if (g.dealBetween(me.idx, q.idx)) w *= 0.5;
    return w;
  }

  // ---------- priority: responding to a spell on the stack
  respond(g, q, item) {
    if (item.p === q) return null;
    // A combo loop is about to start: kill one of its pieces now if there's no Stifle
    if (item.loopStart) {
      const r = this.counterResponse(g, q, item) || this.instantAnswer(g, q, item.p.battlefield.filter(o => this.comboDanger(g, o) >= 5 || o === item.o));
      if (r?.kind) return r;
      if (r) { g.log(`${g.pn(q)} responds before the loop starts`, { kind: 'minor' }); return { kind: 'cast', card: r.card, targets: r.targets }; }
      return null;
    }
    return this.counterResponse(g, q, item) || this.protectResponse(g, q, item)
      || this.redirectResponse(g, q, item) || this.pingResponse(g, q, item) || this.wipeSacResponse(g, q, item) || this.punishResponse(g, q, item) || this.copyResponse(g, q, item);
  }

  // A board wipe is coming: feed creatures that would die anyway to a free sacrifice outlet
  wipeSacResponse(g, q, item) {
    const wipe = item.o.fx.spell?.find(e => e.k === 'wipe' && e.mode === 'destroy' && /creature|nonland/.test(e.what)
      || e.k === 'sweep' && e.n !== 'X');
    if (!wipe) return null;
    const outlet = q.battlefield.find(s => s.fx.sacOutlet && !s.fx.sacOutlet.cost && !(s.fx.sacOutlet.tap && s.tapped) && s.fx.sacOutlet.what !== 'artifact');
    if (!outlet) return null;
    const dies = o => wipe.k === 'wipe' ? !g.has(o, 'indestructible') : g.toughness(o) - o.damage <= wipe.n && !g.has(o, 'indestructible');
    const victim = q.battlefield.filter(o => o.fx.type.creature && o !== outlet && dies(o))
      .sort((a, b) => (b.isCommander ? 1 : 0) - (a.isCommander ? 1 : 0) || this.value(g, b) - this.value(g, a))[0];
    return victim ? { kind: 'sac', outlet, victim } : null;
  }

  // Redirect Lightning: removal or burn aimed at us (or our best permanent) gets pointed at an opponent
  redirectResponse(g, q, item) {
    const ts = (item.targets || []).filter(Boolean);
    if (ts.length !== 1) return null;
    const t = ts[0];
    const hitsMe = (t.obj && t.obj.controller === q.idx && this.value(g, t.obj) + this.pieceWorth(g, q, t.obj) >= 4) || (t.player === q.idx && (item.effects || []).some(e => e.k === 'damage' || e.k === 'loseLife'));
    if (!hitsMe) return null;
    const card = q.hand.find(o => o.fx.spell.some(e => e.k === 'redirect') && instantSpeed(o) && g.canCast(q, o));
    if (!card || !this.redirectTarget(g, q, item, item.targets.indexOf(t))) return null;
    g.log(`${g.pn(q)} turns ${g.cn(item.o)} around`, { kind: 'minor' });
    return { kind: 'cast', card, targets: card.fx.spell.map(e => (e.k === 'redirect' ? { spell: item } : null)) };
  }
  // A new target for someone else's spell: the same kind of thing, on the opponent we most want to hurt
  redirectTarget(g, p, item, idx) {
    const old = item.targets[idx];
    if (old?.player != null) {
      const q = [...g.opponents(p)].sort((a, b) => this.threat(g, p, b) - this.threat(g, p, a))[0];
      return q ? { player: q.idx } : null;
    }
    if (old?.obj) {
      const o = old.obj;
      const kind = x => (o.fx.type.creature ? x.fx.type.creature : o.fx.type.artifact ? x.fx.type.artifact : o.fx.type.enchantment ? x.fx.type.enchantment : !x.fx.type.land);
      const best = this.bestEnemy(g, p, x => x !== o && kind(x));
      return best ? { obj: best.obj || best } : null;
    }
    return null;
  }

  // Walking Ballista about to be removed: fire off every counter first
  pingResponse(g, q, item) {
    const doomed = q.battlefield.find(o => o.fx.pingCounters && o.counters > 0
      && (item.targets.some(t => t?.obj === o) || item.o.fx.spell?.some(e => e.k === 'wipe' || e.k === 'sweep')));
    if (!doomed) return null;
    const plan = this.pingPlan(g, q, doomed, true);
    return plan ? { kind: 'ping', source: doomed, targets: plan.targets } : null;
  }

  // Abilities can only be countered by Stifle-style cards; worth it against something big or aimed at us
  abilityCounter(g, q, item) {
    const card = q.hand.find(o => o.fx.spell.some(e => e.k === 'counterAbility') && instantSpeed(o) && g.canCast(q, o));
    if (!card) return null;
    if (item.loopStart) {
      g.log(`${g.pn(q)} answers the loop before it starts`, { kind: 'minor' });
      return { kind: 'cast', card, targets: card.fx.spell.map(e => (e.k === 'counterAbility' ? { spell: item } : null)) };
    }
    const hitsMe = item.targets.some(t => (t?.obj?.controller === q.idx && this.value(g, t.obj) >= 4) || t?.player === q.idx);
    const v = item.effects.reduce((s, e) => s + Math.max(0, this.effectValue(g, item.p, item.o, e, false)), 0);
    if (!hitsMe && v < 6) return null;
    return { kind: 'cast', card, targets: card.fx.spell.map(e => (e.k === 'counterAbility' ? { spell: item } : null)) };
  }

  counterResponse(g, q, item) {
    if (item.ability) return this.abilityCounter(g, q, item);
    if (item.o.fx.uncounterable || g.players[item.o.owner]?.battlefield.some(o => o.fx.protectsSpells)) return null;
    const usable = q.hand.filter(o => isCounter(o) && g.canCast(q, o) && this.fits(o, item.o));
    if (!usable.length) return null;
    const as = c => ({ kind: 'cast', card: c, targets: c.fx.spell.map(e => (e.k === 'counter' ? { spell: item } : null)) });
    const cheapest = () => usable.sort((a, b) => a.card.cmc - b.card.cmc)[0];
    // Counter war: something is trying to counter one of our spells
    const mySpell = item.targets.find(t => t?.spell && t.spell.p === q)?.spell;
    if (mySpell) {
      const s = mySpell.o;
      const worth = mySpell.combo || s.isCommander || (s.card.cmc || 0) >= 4 || s.fx.spell.some(e => e.k === 'wipe' || e.k === 'counter' || e.k === 'remove')
        || (mySpell.targets || []).some(t => t?.obj?.controller === q.idx);
      if (worth) g.log(`${g.pn(q)} fights back over ${g.cn(s)}`, { kind: 'minor' });
      return worth ? as(cheapest()) : null;
    }
    if (item.targets.some(t => t?.spell)) return null;
    const spell = item.o;
    const combo = this.comboSpell(g, item);
    const mineHit = spell.fx.spell.some(e => e.k === 'wipe' || e.k === 'sweep') && q.battlefield.filter(o => !o.fx.type.land).reduce((s, o) => s + this.value(g, o), 0) > 6;
    const targetsMe = item.targets.some(tg => (tg?.obj && tg.obj.controller === q.idx && this.value(g, tg.obj) >= 5) || tg?.player === q.idx);
    const rank = this.threatRank(g, q).get(item.p.idx) || 1;
    const big = (spell.card.cmc || 0) >= 5 || spell.isCommander || spell.fx.type.planeswalker;
    // cEDH pilots also stop tutors and draw engines from whoever is ahead
    const engine = this.style === 'cedh' && rank >= 1 && (spell.fx.spell.some(e => e.k === 'tutor') || spell.fx.onOppCast);
    const worth = combo || mineHit || targetsMe || engine || (big && rank >= 1.15) || ((spell.card.cmc || 0) >= 6 && rank >= 0.9);
    if (!worth) return null;
    // A no-counter deal holds unless the spell would win the game or wreck us; countering anyway breaks it
    const pact = g.dealBetween(q.idx, item.p.idx);
    if (pact?.kind === 'noCounter') {
      if (!combo && !mineHit) return null;
      g.breakDeal(q, item.p);
    }
    if (!combo) {
      // With only one counter left, save it if another opponent has a combo on the table, or is visibly
      // closer to one than this caster
      const otherCombo = g.opponents(q).some(o => o !== item.p && o.battlefield.some(x => this.comboDanger(g, x) >= 7));
      const close = this.closestCombo(g, q);
      const saveFor = close.q && close.q !== item.p && close.closeness >= 0.5 && close.closeness > this.comboCloseness(g, item.p);
      if ((otherCombo || saveFor) && usable.length === 1 && !mineHit && !targetsMe) {
        if (saveFor) this.explain(g, q, `holds its counterspell for ${close.q.name}, who is closer to a combo`);
        return null;
      }
      if (this.style === 'aggressive' && !mineHit && !targetsMe && g.rand() < 0.5) return null;
      // A free counterspell costs a card (Force of Will): save it for things that really matter
      const pick = usable.sort((a, b) => a.card.cmc - b.card.cmc)[0];
      if (g.castMode(q, pick)?.alt === 'pitch' && !mineHit && !targetsMe && !(big && rank >= 1.15)) return null;
    }
    if (combo) g.log(`${g.pn(q)} recognises a combo piece`, { kind: 'minor' });
    this.explain(g, q, `counters ${spell.card.name}: ${combo ? 'it is a combo piece' : mineHit ? 'it would wipe our board' : targetsMe ? 'it targets us or our best permanent' : engine ? 'tutors and card engines from the leader get stopped' : 'it is a big threat from the player furthest ahead'}`);
    return as(cheapest());
  }

  // One of our permanents is about to be removed: give it hexproof or indestructible, blink it,
  // or sacrifice it for value first
  protectResponse(g, q, item) {
    const fx = item.effects || [];
    const wipe = fx.find(e => e.k === 'wipe' || e.k === 'sweep');
    if (wipe) {
      const atStake = q.battlefield.filter(o => o.fx.type.creature).reduce((s, o) => s + this.value(g, o), 0);
      if (atStake < 8 || wipe.mode === 'exile') return null;
      const card = q.hand.find(o => instantSpeed(o) && g.canCast(q, o) && o.fx.spell.some(e => e.k === 'protect' && e.scope === 'all' && e.kw.includes('indestructible')));
      return card ? { kind: 'cast', card, targets: card.fx.spell.map(() => null) } : null;
    }
    for (const [i, t] of item.targets.entries()) {
      const o = t?.obj;
      const e = fx[i];
      if (!o || o.controller !== q.idx || o.zone !== 'battlefield' || !e) continue;
      const lethal = e.k === 'remove' || e.k === 'bounce' || (e.k === 'damage' && g.toughness(o) - o.damage <= (e.n === 'X' ? item.x : e.n));
      if (!lethal) continue;
      const worth = this.value(g, o) + this.pieceWorth(g, q, o) + (o.isCommander ? 4 : 0);
      if (worth < 4 && !o.token) continue;
      const destroyish = e.k === 'damage' || (e.k === 'remove' && e.mode === 'destroy');
      for (const card of q.hand) {
        if (!instantSpeed(card) || !g.canCast(q, card)) continue;
        const pe = card.fx.spell[0];
        if (!pe) continue;
        const shields = pe.k === 'protect' || pe.k === 'pump' ? (pe.kw.includes('hexproof') || pe.kw.includes('shroud') || (destroyish && pe.kw.includes('indestructible'))) : false;
        const blink = pe.k === 'blink' && o.fx.type.creature;
        if (!shields && !blink) continue;
        if ((pe.k === 'protect' && pe.scope !== 'one') || g.canTarget(q, o)) {
          g.log(`${g.pn(q)} protects ${g.cn(o)}`, { kind: 'minor' });
          return { kind: 'cast', card, targets: card.fx.spell.map((x, k) => (k === 0 && needsOwnTarget(x) ? { obj: o } : null)) };
        }
      }
      // No protection: if it's going away anyway, sacrifice it for value
      if (o.fx.type.creature && (e.k !== 'bounce' || o.token)) {
        const outlet = q.battlefield.find(s => s.fx.sacOutlet && s !== o && !(s.fx.sacOutlet.tap && s.tapped)
          && (!s.fx.sacOutlet.cost || g.planPayment(q, parseCost(s.fx.sacOutlet.cost), 0)));
        if (outlet) return { kind: 'sac', outlet, victim: o };
      }
    }
    return null;
  }

  // An opponent is pumping, protecting or enchanting their creature: kill it in response
  punishResponse(g, q, item) {
    if (item.p === q) return null;
    const buffs = ['pump', 'protect', 'counters'];
    const target = item.auraTarget && !item.o.fx.pacify ? item.auraTarget
      : item.targets.find((t, i) => t?.obj && t.obj.controller === item.p.idx && buffs.includes(item.effects?.[i]?.k))?.obj;
    if (!target || target.controller === q.idx || this.value(g, target) * this.politicalWeight(g, q, item.p) < 4) return null;
    const r = this.instantAnswer(g, q, [target]);
    if (!r) return null;
    g.log(`${g.pn(q)} answers ${g.cn(target)} before ${g.cn(item.o)} resolves`, { kind: 'minor' });
    return { kind: 'cast', card: r.card, targets: r.targets };
  }

  // A juicy instant or sorcery: copy it for ourselves
  copyResponse(g, q, item) {
    const o = item.o;
    if (item.ability || !(o.fx.type.instant || o.fx.type.sorcery) || !o.fx.spell.length || o.fx.spell.some(e => e.k === 'counter')) return null;
    const card = q.hand.find(c => instantSpeed(c) && g.canCast(q, c) && [...c.fx.spell, ...c.fx.etb].some(e => e.k === 'copySpell'));
    if (!card) return null;
    const v = o.fx.spell.reduce((s, e) => s + this.effectValue(g, q, o, e, true), 0);
    if (v < 5) return null;
    return { kind: 'cast', card, targets: card.fx.spell.map(e => (e.k === 'copySpell' ? { spell: item } : null)) };
  }

  // ---------- combat
  canKill(g, attacker, defender) {
    return g.power(attacker) >= g.toughness(defender) - defender.damage || (g.has(attacker, 'deathtouch') && g.power(attacker) > 0);
  }
  survives(g, o, against) {
    if (g.has(o, 'indestructible')) return true;
    return !this.canKill(g, against, o);
  }

  // Attacks and blocks are planned by simulation (combatai.js); the older rule-of-thumb versions remain as a fallback
  declareAttackers(g, p) {
    try {
      const { attacks, gain } = bestAttacks(g, p, this, { style: this.style, noise: this.noise || 0 });
      if (attacks.length) {
        const targets = [...new Set(attacks.map(x => g.players[x.target].name))];
        this.explain(g, p, `attacks ${targets.join(' and ')} with ${attacks.length} creature${attacks.length === 1 ? '' : 's'}: the combat simulation expects ${gain.toFixed(1)} value after the defenders' best blocks and the backswing`);
      }
      return attacks;
    } catch (e) {
      console.warn('combat planner failed, using the simple rules', e);
      return this.declareAttackersHeuristic(g, p);
    }
  }
  declareBlockers(g, q, attackers) {
    try {
      const { blocks } = bestBlocks(g, q, attackers, this);
      if (this.noise && g.rand() < this.noise * 0.5) return this.declareBlockersHeuristic(g, q, attackers);
      const kept = q.battlefield.filter(o => o.fx.type.creature && !o.tapped && (this.pieceWorth(g, q, o) || o.isCommander) && !blocks.some(x => x.b === o));
      if (blocks.length || kept.length) this.explain(g, q, `${blocks.length ? `blocks with ${blocks.map(x => x.b.card.name).join(', ')}` : 'takes the hit'}${kept.length ? `; keeps ${kept.map(o => o.card.name).join(', ')} out of combat` : ''} (best result of the block search)`);
      return blocks;
    } catch (e) {
      console.warn('block planner failed, using the simple rules', e);
      return this.declareBlockersHeuristic(g, q, attackers);
    }
  }

  declareAttackersHeuristic(g, p) {
    const ready = p.battlefield.filter(o => g.canAttack(o) && g.power(o) > 0);
    if (!ready.length) return [];
    const opps = g.opponents(p);
    if (!opps.length) return [];
    // Long games make everyone push for the finish
    const base = this.cstyle;
    // Long games make everyone push harder; past round 20 everybody swings to break the stall
    const style = g.round >= 20 ? 'aggressive' : g.round >= 12 && base !== 'aggressive' ? (base === 'defensive' ? 'balanced' : 'aggressive') : base;

    // How hard can the table hit me back?
    const incoming = opps.map(q => q.battlefield.filter(o => o.fx.type.creature && !g.has(o, 'defender')).reduce((s, o) => s + g.power(o), 0));
    const danger = Math.max(0, ...incoming) + incoming.reduce((a, b) => a + b, 0) * 0.25;
    let keep = new Set();
    if (style !== 'aggressive' && danger >= p.life * (style === 'defensive' ? 0.5 : 0.75)) {
      const guards = ready.filter(o => !g.has(o, 'vigilance')).sort((a, b) => g.toughness(b) - g.toughness(a));
      const n = Math.ceil(guards.length * (style === 'defensive' ? 0.6 : 0.4));
      keep = new Set(guards.slice(0, n));
    }
    // Combo pieces stay home where they're safe
    for (const o of ready) if (this.pieceWorth(g, p, o) && !g.has(o, 'vigilance')) keep.add(o);
    const pool = ready.filter(o => !keep.has(o));
    if (!pool.length) return [];

    let target = null, ts = -1e9;
    for (const q of opps) {
      const est = this.estimateDamage(g, pool, q);
      const cmdKill = pool.some(o => o.isCommander && (q.cmdDamage[o.iid] || 0) + g.power(o) >= 21);
      // Truces hold unless we can kill the partner outright (aggressive pilots are tempted sooner)
      if (g.dealBetween(p.idx, q.idx) && est < q.life && !cmdKill && !(style === 'aggressive' && est >= q.life * 0.6 && g.rand() < 0.3)) continue;
      let s = est + this.threat(g, p, q) * 0.25 + (p.grudge[q.idx] || 0) * 0.15 - q.life * 0.05;
      // Keep our side of a gang-up deal
      if (g.deals.some(d => d.kind === 'gangUp' && !d.broken && d.until >= g.round && d.target === q.idx && (d.a === p.idx || d.b === p.idx))) s += 12;
      if (est >= q.life) s += 100;
      if (cmdKill) s += 80;
      if (s > ts) { ts = s; target = q; }
    }
    if (!target) return [];
    const blockers = target.battlefield.filter(o => o.fx.type.creature && !o.tapped);
    const lethal = this.estimateDamage(g, pool, target) >= target.life;
    const out = [];
    for (const o of pool) {
      const able = blockers.filter(b => g.canBlock(b, o));
      const killers = able.filter(b => this.canKill(g, b, o) && !g.has(o, 'indestructible'));
      const safe = killers.length === 0;
      const trade = killers.every(b => this.canKill(g, o, b) && this.value(g, b) >= this.value(g, o) * 0.8);
      if (safe || lethal || (style === 'aggressive' && (trade || g.power(o) >= 3)) || (style === 'balanced' && trade && able.length <= 1))
        out.push({ o, target: target.idx });
    }
    // Don't swing so wide that the table kills us on the backswing (our attackers stay tapped until our untap)
    if (!lethal && g.round < 20) {
      const backswing = () => {
        const home = { battlefield: p.battlefield.filter(o => o.fx.type.creature && (!out.some(d => d.o === o) || g.has(o, 'vigilance'))) };
        return opps.reduce((s, q) => s + this.estimateDamage(g, q.battlefield.filter(c => c.fx.type.creature && g.power(c) > 0 && !g.has(c, 'defender')), home), 0) * 0.7;
      };
      while (out.length && backswing() >= p.life) {
        // Keep home the attacker that blocks best
        const stay = [...out].sort((a, b) => g.toughness(b.o) - g.toughness(a.o))[0];
        out.splice(out.indexOf(stay), 1);
      }
    }
    if (out.length) this.explain(g, p, `attacks ${target.name} with ${out.length} creature${out.length === 1 ? '' : 's'}: ${lethal ? 'it should be lethal' : g.archenemy === target.idx ? 'they are the archenemy' : (p.grudge[target.idx] || 0) >= 5 ? 'payback for earlier hits' : 'the best damage for the risk'}${keep.size ? `; ${keep.size} stay home ${[...keep].some(o => this.pieceWorth(g, p, o)) ? '(combo pieces and blockers)' : 'to block'}` : ''}`);
    return out;
  }

  estimateDamage(g, attackers, q) {
    const blockers = q.battlefield.filter(o => o.fx.type.creature && !o.tapped && !g.has(o, 'cantblock'));
    const sorted = [...attackers].sort((a, b) => g.power(b) - g.power(a));
    const used = new Set();
    let dmg = 0;
    for (const a of sorted) {
      const b = blockers.find(x => !used.has(x) && g.canBlock(x, a));
      if (b && !g.has(a, 'menace')) { used.add(b); if (g.has(a, 'trample')) dmg += Math.max(0, g.power(a) - g.toughness(b)); }
      else dmg += g.power(a);
    }
    return dmg;
  }

  declareBlockersHeuristic(g, q, attackers) {
    const avail = q.battlefield.filter(o => o.fx.type.creature && !o.tapped);
    const used = new Set();
    const blocks = [];
    const sorted = [...attackers].sort((a, b) => g.power(b) - g.power(a));
    const style = this.cstyle;
    // Good blocks: kill it and live, or eat it for free
    for (const a of sorted) {
      if (g.has(a, 'menace')) continue;
      const cands = avail.filter(b => !used.has(b) && g.canBlock(b, a));
      const free = cands.filter(b => this.survives(g, b, a)).sort((x, y) => Number(this.canKill(g, y, a)) - Number(this.canKill(g, x, a)) || this.value(g, x) - this.value(g, y));
      if (free.length && (this.canKill(g, free[0], a) || style !== 'aggressive')) { used.add(free[0]); blocks.push({ b: free[0], a }); continue; }
      const traders = cands.filter(b => this.canKill(g, b, a) && this.value(g, a) > this.value(g, b) * 1.2 && !this.pieceWorth(g, q, b));
      if (traders.length && style !== 'aggressive') {
        const b = traders.sort((x, y) => this.value(g, x) - this.value(g, y))[0];
        used.add(b); blocks.push({ b, a });
      }
    }
    // Double blocks: two creatures that together kill a big attacker, when that costs less than the attacker
    // is worth (it kills at most what its power reaches; menace attackers need two blockers anyway)
    for (const a of sorted) {
      if (blocks.some(x => x.a === a) || style === 'aggressive') continue;
      if (g.has(a, 'first strike') || g.has(a, 'double strike') || g.has(a, 'indestructible')) continue;
      const need = g.toughness(a) - a.damage;
      const cands = avail.filter(b => !used.has(b) && g.canBlock(b, a) && !this.pieceWorth(g, q, b) && !b.isCommander);
      const dt = b => g.has(b, 'deathtouch') && g.power(b) > 0;
      const left = b => g.toughness(b) - b.damage;
      let best = null, bestLoss = Infinity;
      for (let i = 0; i < cands.length; i++) for (let j = i + 1; j < cands.length; j++) {
        const [x, y] = [cands[i], cands[j]];
        if (!(dt(x) || dt(y)) && g.power(x) + g.power(y) < need) continue;
        // What the attacker can take down: both if its power covers both, or else the pricier one it can reach
        const pw = g.power(a), killsAll = g.has(a, 'deathtouch') ? pw >= 2 : pw >= left(x) + left(y);
        const reach = [x, y].filter(b => g.has(a, 'deathtouch') ? pw >= 1 : pw >= left(b)).map(b => this.value(g, b));
        const loss = killsAll ? this.value(g, x) + this.value(g, y) : Math.max(0, ...reach);
        if (loss < bestLoss) { bestLoss = loss; best = [x, y]; }
      }
      if (best && this.value(g, a) + (a.isCommander ? 3 : 0) > bestLoss * 1.1) {
        for (const b of best) { used.add(b); blocks.push({ b, a }); }
      }
    }
    // Chump blocks only when it matters: the damage would be lethal (or leave us one hit from dead),
    // or a commander is about to reach 21 commander damage
    const unblocked = () => sorted.filter(a => !blocks.some(x => x.a === a));
    const incoming = () => unblocked().reduce((s, a) => s + g.power(a), 0);
    const cmdLethal = a => a.isCommander && (q.cmdDamage[a.iid] || 0) + g.power(a) >= (style === 'defensive' ? 18 : 21);
    const biggestOther = Math.max(0, ...g.opponents(q).filter(o => !attackers.some(a => a.controller === o.idx)).map(o => o.battlefield.filter(c => c.fx.type.creature).reduce((s, c) => s + g.power(c), 0)));
    const buffer = style === 'defensive' ? Math.max(4, biggestOther) : Math.min(4, biggestOther);
    for (const a of unblocked()) {
      if (!(incoming() >= q.life - buffer || cmdLethal(a))) continue;
      const cands = avail.filter(b => !used.has(b) && g.canBlock(b, a)).sort((x, y) => this.value(g, x) + this.pieceWorth(g, q, x) - this.value(g, y) - this.pieceWorth(g, q, y));
      const need = g.has(a, 'menace') ? 2 : 1;
      if (cands.length < need) continue;
      for (const b of cands.slice(0, need)) { used.add(b); blocks.push({ b, a }); }
    }
    return blocks;
  }

  combatResponse(g, q, attackers) {
    const incoming = attackers.reduce((s, a) => s + g.power(a), 0);
    const r = this.instantAnswer(g, q, attackers);
    if (r && (this.value(g, r.target) >= 5 || incoming >= q.life - 3)) return { card: r.card, targets: r.targets };
    return null;
  }

  // ---------- counterspells
  fits(c, spell) {
    const t = spell.fx.type;
    const what = c.fx.spell.find(e => e.k === 'counter').what;
    if (what === 'any') return true;
    if (what.includes('noncreature')) return !t.creature;
    if (what.includes('creature')) return t.creature;
    if (what.includes('instant or sorcery')) return t.instant || t.sorcery;
    if (what.includes('artifact')) return t.artifact;
    if (what.includes('enchantment')) return t.enchantment;
    return true;
  }

  // Is this spell part of a combo the caster is visibly close to completing?
  comboSpell(g, item) {
    if (item.combo) return true;
    return combosFor(item.o.card).some(c => {
      const st = comboState(g, item.p, c);
      return comboScore(c, item.p) >= 500 && st.onBoard >= c.pieces.length - 1;
    });
  }

}
