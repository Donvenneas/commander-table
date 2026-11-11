// Four-player Commander game engine. Rule numbers in the log refer to the Comprehensive Rules.
import { analyzeCard, needsTarget, condText } from './effects.js';
import { combosIn, comboState, comboBlocked, cardKey, RESULT_TEXT } from './combos.js';
import { shuffle, esc, makeRng } from './util.js';
import { learnedBonus, learnedPerson } from './learn.js';
import { threatFeatures, threatMult } from './threat.js';
import { setupPlanar, planarStartLog, planarMain } from './planar.js';
import * as combat from './combat.js';
import * as mana from './mana.js';
import * as resolve from './resolve.js';
import * as triggers from './triggers.js';
import * as zones from './zones.js';
import { formatOf } from './formats.js';
import * as K from './kingdomsPlay.js';
import { DUNGEONS, roomEffects, ventureChoices } from './dungeons.js';

export const PHASES = [
  ['untap', 'Untap'], ['upkeep', 'Upkeep'], ['draw', 'Draw'], ['main1', 'Main 1'],
  ['combat', 'Combat'], ['main2', 'Main 2'], ['end', 'End'],
];
export const COLORS = ['W', 'U', 'B', 'R', 'G'];
// Rules version: rules added in Round 5 and later only apply to games started at this version or newer, so
// replays saved before them still play out the same (a replay with no "rules" field is version 4)
export const RULES = 5;

export class Abort extends Error { constructor() { super('aborted'); this.name = 'Abort'; } }

export function parseCost(str) {
  /** @type {{ generic: number, pips: string[][], x: number }} */
  const cost = { generic: 0, pips: [], x: 0 };
  for (const [, s] of (str || '').matchAll(/\{([^}]+)\}/g)) {
    const u = s.toUpperCase();
    if (/^\d+$/.test(u)) cost.generic += +u;
    else if (u === 'X') cost.x++;
    else if (u === 'C' || COLORS.includes(u)) cost.pips.push([u]);
    else if (u.includes('/')) {
      const parts = u.split('/');
      if (parts[1] === 'P') cost.pips.push([parts[0]]);
      else if (/^\d$/.test(parts[0])) cost.pips.push([parts[1]]);
      else cost.pips.push(parts.filter(c => COLORS.includes(c)));
    } else cost.generic += 1;
  }
  return cost;
}

const basePT = v => { const n = parseInt(v, 10); return Number.isNaN(n) ? (String(v || '').includes('*') ? 2 : 0) : n; };

export class Game {
  constructor(seats, clock, opts = {}) {
    this.clock = clock;
    // (set as the game goes: recent trigger signatures for loop detection, tokens to sacrifice at end of turn, the
    // page's chat log for friends, and whether AI reasons are logged)
    /** @type {string[] | undefined} */ this.trigSig = undefined;
    /** @type {any} (the read-only cache while the AI plans combat: withEvalCache) */ this._ev = null;
    /** @type {any[] | undefined} */ this.endSac = undefined;
    /** @type {any[] | undefined} */ this.chat = undefined;
    this.explain = false;
    /** a look-ahead copy (lookahead.js) */ this.sim = false;
    /** who controls the effect resolving now (runEffects) @type {number | null | undefined} */ this.effectP = undefined;
    /** the turn of a Fog (all combat damage prevented) @type {number | undefined} */ this.fogTurn = undefined;
    /** set as the game goes (left undefined until then, as before the split of item 176) @type {any} */ this.winners = undefined;
    /** @type {any} */ this.winReason = undefined;
    /** @type {any} */ this.diedTurn = undefined;
    /** @type {any} */ this.inThief = undefined;
    /** the X already paid, while targets are chosen (stackAbility) @type {any} */ this.xNow = undefined;
    /** each player's public board at the start of each round (threat.js, item 108) @type {{round: number, idx: number, f: Record<string, number>}[]} */ this.threatLog = [];
    /** look-ahead copies: a spell one seat lets through (lookahead.js, item 101) @type {{q: number, iid: number} | null} */ this.laHold = null;
    // The format's rules (formats.js): starting life, commander damage, the free mulligan
    this.formatKey = opts.format || 'commander';
    // Kingdoms (kingdomsPlay.js): secret roles decide who wins
    this.kingdoms = !!opts.roles;
    this.format = formatOf(this.formatKey);
    this.startLife = this.format.life;
    // Best of three: the player the previous game's loser chose to go first (else random)
    this.firstPlayer = opts.firstPlayer ?? null;
    this.maxRounds = opts.maxRounds || 30;
    this.puzzle = opts.puzzle || null;
    this.rules = opts.rules ?? RULES;
    // Every random choice comes from this seed, so a game can be replayed exactly
    this.seed = opts.seed ?? Math.floor(Math.random() * 2 ** 32);
    this.rand = makeRng(this.seed);
    this.steps = 0;
    // Object ids count from 1 in every game, so a rebuilt game has the same ids (replays rely on it)
    this.nextId = 1;
    // Timestamps (613.7): later effects that set power and toughness win over earlier ones
    this.tsN = 0;
    /** Kingdoms: the Straw Man whose Announce forces attacks at them (kingdomsPlay.js) @type {any} */
    this.strawMan = null;
    /** For the post-game report (main.js gameReport): life totals at each turn start, the biggest hits @type {any[]} */
    this.lifeLog = [];
    /** @type {any[]} */
    this.bigHits = [];
    this.objects = new Map();
    this.handlers = {};
    this.logEntries = [];
    this.turn = 0;
    this.round = 0;
    this.active = 0;
    this.phase = 'setup';
    this.stack = [];
    this.queue = [];
    this.over = false;
    this.winner = null;
    this.players = seats.map((s, i) => ({
      idx: i, name: s.playerName, deckName: s.deckName, color: s.color, agent: s.agent, style: s.agent.style,
      life: this.startLife, poison: 0, cmdDamage: {}, library: [], hand: [], graveyard: [], exile: [], battlefield: [], command: [],
      pool: [], lost: false, place: null, lossReason: '', landsPlayed: 0, castCount: {}, drewFromEmpty: false,
      mulligans: 0, grudge: seats.map(() => 0), stats: { spells: 0, damage: 0, combos: 0 },
      combos: [], infiniteMana: -1, comboTried: { turn: -1, ids: new Set() }, castNames: new Set(), extraTurns: 0, extraCombats: 0,
    }));
    seats.forEach((s, i) => {
      const p = this.players[i];
      p.commanders = s.commanders;
      // What the deck is remembered by (learn.js learnAs: its commanders, or a name for decks without one)
      p.learnAs = s.learnAs || s.commanders;
      // Per-deck memory from earlier games (learn.js): given by the setup for replays, else read now
      p.learned = opts.learned ? opts.learned[i] || null : opts.noLearning ? null : learnedBonus(p.learnAs);
      // Reading human players (rules 5, item 109): a person's tendencies so far travel in their seat's learned table
      if (this.rules >= 5 && !opts.learned && !opts.noLearning && s.agent?.human) { const per = learnedPerson(p.name); if (per) p.learned = { ...(p.learned || {}), '#person': per }; }
      // (and this game's are noted for next time)
      if (s.agent?.human && !opts.noLearning) p.tells = { turns: 0, held: 0, used: 0, counters: 0, faced: 0, blocks: 0, chumps: 0 };
      p.agent.learned = p.learned;
      // A companion waits outside the game until it's put into hand for {3} (702.139c)
      if (s.companion && this.rules >= 5) { p.companion = this.mk(s.companion, p); p.companion.zone = 'outside'; }
      for (const c of s.commanders) {
        const o = this.mk(c, p, { commander: true }); o.zone = 'command'; p.command.push(o);
        // Oathbreaker: the planeswalker is the oathbreaker, the instant or sorcery its signature spell
        // (cast only while the oathbreaker is on the battlefield; it goes back to the command zone too)
        if (this.format.signature) { if (o.fx.type.planeswalker) o.oathbreaker = true; else if (o.fx.type.instant || o.fx.type.sorcery) o.signature = true; }
      }
      for (const { card, qty } of s.cards) for (let k = 0; k < qty; k++) { const o = this.mk(card, p); o.zone = 'library'; p.library.push(o); }
      p.combos = combosIn([...p.command, ...p.library].map(o => o.card));
      // (win-the-game combos do nothing in Kingdoms)
      if (this.kingdoms) p.combos = p.combos.filter(c => c.result !== 'win');
    });
    /** Two-Headed Giant teams (item 159) @type {number[][] | null} */ this.teams = null; /** @type {number[] | null} */ this.firstTeam = null;
    if (this.format.teams && this.players.length === 4) {
      this.linkTeams();
      // (a team's turn starts with its first seat)
      if (this.firstPlayer != null) this.firstPlayer -= this.firstPlayer % 2;
    }
    // Archenemy and Planechase (item 160): the scheme or planar deck from the setup
    /** @type {any} */ this.planar = null;
    if (opts.planar && this.format.planar) setupPlanar(this, opts.planar);
    // Extra starting life per seat (campaign fights: difficulty, rest stops, bosses)
    if (opts.lifeBonus) opts.lifeBonus.forEach((b, i) => { if (this.players[i] && b) this.players[i].life += b; });
    // Kingdoms: the King reveals, starts with 10 extra life and takes the first turn
    if (this.kingdoms) { K.setupRoles(this, opts.roles); const k = this.players.findIndex(p => p.role.id === 'king'); if (k >= 0) this.firstPlayer = k; }
    this.winNote = null;
    // Every combo attempt (for batch statistics)
    this.comboLog = [];
    this.deals = [];
    // Deals offered from the chat, waiting for the next turn
    this.pendingDeals = [];
    this.archenemy = null;
    this.delayed = [];
    this.tempSteals = [];
    // Players who can't cast spells this turn (Silence): player index → turn number
    this.silenced = {};
    this.extraTurnsTaken = 0;
    // The monarch draws a card at their end step (and loses the title to combat damage)
    this.monarch = null;
    // Triggers queued this turn by the generic watchers (capped, so a loop can't run forever)
    this.trigCount = { turn: -1, n: 0 };
  }

  // ---------- plumbing
  on(ev, fn) { (this.handlers[ev] ||= []).push(fn); }
  emit(ev, d) {
    // Every life change passes through here, so "whenever you gain life" watchers are fired from it
    if (ev === 'life' && d.d) {
      const q = this.players[d.p];
      if (d.d > 0) q.gainedTurn = this.turn; else {
        // (how much this turn: Wound Reflection, Archfiend of Despair)
        q.lostAmt = (q.lostLifeTurn === this.turn ? q.lostAmt || 0 : 0) - d.d;
        q.lostLifeTurn = this.turn; if (this.effectP != null && this.effectP !== d.p) q.lastHitBy = this.effectP;
      }
      this.fire(d.d > 0 ? 'gainLife' : 'loseLife', { p: d.p, n: Math.abs(d.d) });
    }
    for (const fn of this.handlers[ev] || []) fn(d);
  }
  async beat(w = 1) { this.steps++; this.emit('update'); await this.clock.beat(w); }

  mk(card, p, x = {}) {
    /** @type {any} (an object in play: its fields are filled in as it moves between zones) */
    const o = {
      iid: this.nextId++, card, fx: card.fx, owner: p.idx, controller: p.idx, zone: null, tapped: false, sick: false,
      damage: 0, deathtouched: false, counters: 0, tempP: 0, tempT: 0, tempKw: null, attachedTo: null,
      attacking: null, blockedBy: [], blocked: false, blocking: null, loyalty: 0,
      isCommander: !!x.commander, token: !!x.token, usedPW: false, usedAbility: -1,
    };
    // (not enumerable: keeps objects plain when they're logged or compared)
    Object.defineProperty(o, 'ownerP', { value: p, enumerable: false });
    Object.defineProperty(o, 'game', { value: this, enumerable: false });
    this.objects.set(o.iid, o);
    return o;
  }

  cn(o) { return `<span class="cn" data-iid="${o.iid}">${esc(o.card.name)}</span>`; }
  pn(p) { return `<span class="pn" data-p="${p.idx}" style="--pc:${p.color}">${esc(p.name)}</span>`; }
  log(html, opt = {}) {
    const e = { turn: this.turn, html, rule: opt.rule || null, kind: opt.kind || '', p: opt.p ?? null };
    this.logEntries.push(e);
    this.emit('log', e);
  }

  alive() { return this.players.filter(p => !p.lost); }
  opponents(p) { return this.players.filter(q => q !== p && !q.lost && !(this.kingdoms && K.teammates(p, q)) && !(this.teams && p.team === q.team)); }
  // Two-Headed Giant (item 159): seats 1–2 and 3–4 are teams sharing one life total and one poison count (each
  // member's life and poison read and write the team's). Look-ahead copies link their teams again (lookahead.js).
  linkTeams() {
    this.teams = [[0, 1], [2, 3]];
    for (const t of this.teams) {
      const share = { life: this.players[t[0]].life, poison: this.players[t[0]].poison };
      for (const i of t) {
        const p = this.players[i];
        p.team = t;
        for (const k of /** @type {const} */ (['life', 'poison'])) Object.defineProperty(p, k, { get: () => share[k], set: v => { share[k] = v; }, enumerable: true, configurable: true });
      }
    }
  }
  /** @param {any} p */ teammate(p) { return this.teams ? this.players.find(q => q !== p && q.team === p.team && !q.lost) || null : null; }
  order(from) { const n = this.players.length; return Array.from({ length: n }, (_, k) => this.players[(from + k) % n]); }
  // Mana empties between steps (Leyline Tyrant, Ashling: red mana stays)
  setPhase(ph) { this.phase = ph; for (const p of this.players) p.pool = (p.pool || []).length && p.battlefield.some(o => o.fx.keepRed) ? p.pool.filter(u => u.colors.length === 1 && u.colors[0] === 'R') : []; this.emit('update'); }

  // ---------- characteristics
  attachments(o) {
    // (while the AI plans combat the board doesn't change: who is attached to what is worked out once)
    const ev = this._ev;
    if (ev) {
      if (!ev.att) { ev.att = new Map(); for (const q of this.players) for (const a of q.battlefield) if (a.attachedTo) { const l = ev.att.get(a.attachedTo); if (l) l.push(a); else ev.att.set(a.attachedTo, [a]); } }
      const l = ev.att.get(o);
      return l ? l.slice() : [];
    }
    const r = []; for (const q of this.players) for (const a of q.battlefield) if (a.attachedTo === o) r.push(a); return r;
  }
  // Speed (item 171): f runs with a read-only cache of board facts that many checks repeat (attachments, keyword-
  // removing effects). Only for planning code that doesn't change the board, and doesn't wait (no await) inside.
  withEvalCache(f) {
    if (this._ev) return f();
    /** @type {any} */
    const ev = { att: null, memo: new Map(), p: new Map(), t: new Map(), kw: new Map() };
    this._ev = ev;
    try { return f(); } finally { this._ev = null; }
  }
  evalMemo(key, f) { const ev = this._ev; if (!ev) return f(); if (!ev.memo.has(key)) ev.memo.set(key, f()); return ev.memo.get(key); }
  anthemApplies(s, o) {
    const an = s.fx.anthem;
    if (!o.fx.type.creature || (an.other && s === o)) return false;
    // "Attacking creatures you control have deathtouch" (Ohran Frostfang)
    if (an.cond) {
      if (this.inCond) return false;
      this.inCond = true;
      try { if (!this.evalCond(this.players[s.controller], s, an.cond, {})) return false; } finally { this.inCond = false; }
    }
    if (an.tribe === 'attacking') return o.attacking != null;
    if (an.tribe === 'token') return !!o.token;
    if (an.what && !this.fits(o, an.what)) return false;
    if (an.desc) return this.fits(o, null, an.desc);
    if (an.tribe === 'chosenColor') return !!s.chosenColor && (o.card.colors || []).includes(s.chosenColor);
    const tribe = an.tribe === 'chosen' ? s.chosenType : an.tribe;
    return !tribe || o.fx.subtypes.includes(tribe) || o.fx.subtypes.includes(tribe.replace(/s$/, '')) || o.fx.kw.has('changeling');
  }
  bonus(o) {
    let p = 0, t = 0;
    if (o.zone !== 'battlefield') return { p, t };
    for (const s of this.players[o.controller].battlefield) if (s.fx.anthem && this.anthemApplies(s, o)) {
      // Door of Destinies, Chitterspitter: +1/+1 for each counter of a kind on the source
      const an = s.fx.anthem;
      const k = an.perCounter ? s.named?.[an.perCounter] || 0 : an.perOther ? this.players[o.controller].battlefield.filter(x => x !== o && x.fx.type.creature && this.isA(x, an.perOther)).length : 0;
      // (Kellan: +1/+0 for each aura and equipment attached to it)
      const kp = an.perAttachedP ? this.attachments(s).filter(a => a.fx.type.aura || a.fx.type.equipment).length : 0;
      p += an.p + k + kp; t += an.t + k;

    }
    for (const a of this.attachments(o)) {
      if (a.fx.attachBuff) { p += a.fx.attachBuff.p; t += a.fx.attachBuff.t; }
      if (a.fx.attachBuff2 && this.isA(o, a.fx.attachBuff2.needs)) { p += a.fx.attachBuff2.p; t += a.fx.attachBuff2.t; }
    }
    const cb = this.condBuff(o);
    if (cb) { p += cb.p; t += cb.t; }
    // Elesh Norn-style: opponents' creatures get -N/-N
    for (const q of this.opponents(this.players[o.controller])) for (const s of q.battlefield) if (s.fx.oppAnthem && o.fx.type.creature) { p += s.fx.oppAnthem.p; t += s.fx.oppAnthem.t; }
    // "~ gets +1/+0 for each artifact you control"
    const eb = o.fx.eachBuff;
    if (eb) {
      const q = this.players[o.controller];
      const pool = eb.where === 'attached' ? this.attachments(o) : eb.where === 'on the battlefield' ? this.alive().flatMap(x => x.battlefield) : /graveyard/.test(eb.where) ? q.graveyard : q.battlefield;
      const k = pool.filter(x => (!eb.other || x !== o) && this.isA(x, eb.what)).length;
      p += eb.p * k; t += eb.t * k;
    }
    return { p, t };
  }
  // "As long as …, ~ gets +1/+1": checked whenever it's looked at (a condition about power can't recurse)
  condBuff(o) {
    const cb = o.fx.condBuff;
    if (!cb || o.zone !== 'battlefield' || this.inCond) return null;
    this.inCond = true;
    try { return this.evalCond(this.players[o.controller], o, cb.cond, {}) ? cb : null; } finally { this.inCond = false; }
  }
  basePower(card) { return basePT(card.power); }
  baseToughness(card) { return basePT(card.toughness); }
  // Auras like Kenrith's Transformation set the creature's base power and toughness
  setPT(o) { if (o.zone !== 'battlefield') return null; for (const a of this.attachments(o)) if (a.fx.attachSet) return a.fx.attachSet; return null; }
  // Layer 7b (613.4b): the effect that sets power and toughness with the latest timestamp (an aura such as Kenrith's
  // Transformation, or an animation until end of turn). Rules 4 and earlier: an animation always won.
  setLayer(o) {
    const anim = o.animPT?.turn === this.turn ? o.animPT : null;
    if (this.rules < 5) return anim || this.setPT(o);
    if (o.zone !== 'battlefield') return null;
    let best = anim, ts = anim ? anim.ts ?? 0 : -1;
    for (const a of this.attachments(o)) if (a.fx.attachSet && (a.ts ?? 0) > ts) { best = a.fx.attachSet; ts = a.ts ?? 0; }
    return best;
  }
  // (while the AI plans combat, power, toughness and keywords are worked out once per object: item 171)
  power(o) { const ev = this._ev; if (!ev) return this.powerNow(o); let v = ev.p.get(o); if (v === undefined) { v = this.powerNow(o); ev.p.set(o, v); } return v; }
  toughness(o) { const ev = this._ev; if (!ev) return this.toughnessNow(o); let v = ev.t.get(o); if (v === undefined) { v = this.toughnessNow(o); ev.t.set(o, v); } return v; }
  has(o, kw) {
    const ev = this._ev;
    if (!ev) return this.hasNow(o, kw);
    let m = ev.kw.get(o);
    if (!m) { m = new Map(); ev.kw.set(o, m); }
    let v = m.get(kw);
    if (v === undefined) { v = this.hasNow(o, kw); m.set(kw, v); }
    return v;
  }
  powerNow(o) { const st = this.setLayer(o); if (st) return st.p + o.counters + o.tempP + this.bonus(o).p; return (o.zone === 'battlefield' && (o.fx.ptDyn || o.fx.pDyn) ? this.dynPT(o, o.fx.ptDyn || o.fx.pDyn) ?? basePT(o.card.power) : basePT(o.card.power)) + o.counters + o.tempP + this.bonus(o).p; }
  toughnessNow(o) { const st = this.setLayer(o); if (st) return st.t + o.counters + o.tempT + this.bonus(o).t; return (o.zone === 'battlefield' && (o.fx.ptDyn || o.fx.tDyn) ? this.dynPT(o, o.fx.ptDyn || o.fx.tDyn) ?? basePT(o.card.toughness) : basePT(o.card.toughness)) + o.counters + o.tempT + this.bonus(o).t; }
  hasNow(o, kw) {
    // Shadowspear, Arcane Lighthouse: hexproof and indestructible are switched off this turn
    if (o.stripped?.turn === this.turn && o.stripped.kws.includes(kw)) return false;
    // Archetype of Imagination / Endurance / Aggression: opponents' creatures lose the keyword
    if ((kw === 'flying' || kw === 'hexproof' || kw === 'trample') && o.zone === 'battlefield' && o.fx.type.creature && this.evalMemo(`lose:${o.controller}:${kw}`, () => this.opponents(this.players[o.controller]).some(q => q.battlefield.some(s => s.fx.oppLoseKw === kw)))) return false;
    if (o.tempKw?.has(kw) || o.permKw?.has(kw) || (kw === 'menace' && o.suspected)) return true;
    // Oviya: creatures attacking one of its controller's opponents have trample
    if (kw === 'trample' && o.attacking != null && o.zone === 'battlefield' && this.evalMemo(`oviya:${o.attacking}`, () => this.alive().some(q => q.idx !== o.attacking && q.battlefield.some(s => s.fx.attackTrample) && this.opponents(q).some(x => x.idx === o.attacking)))) return true;
    // Stinkweed Imp: creatures it deals combat damage to are destroyed (deathtouch does the same in combat)
    if (kw === 'deathtouch' && o.fx.combatKill && o.zone === 'battlefield') return true;
    // (an aura that makes it lose all abilities leaves only what's granted)
    if (o.fx.kw.has(kw) && !(o.zone === 'battlefield' && this.setPT(o))) return true;
    if (o.zone === 'battlefield') {
      // Concordant Crossroads: all creatures have haste
      if (kw === 'haste' && o.fx.type.creature && this.alive().some(q => q.battlefield.some(s => s.fx.hasteAll))) return true;
      for (const s of this.players[o.controller].battlefield) if (s.fx.permAnthem?.kw.includes(kw) && (!s.fx.permAnthem.other || s !== o) && (!s.fx.permAnthem.what || this.spellIs(o, s.fx.permAnthem.what))) return true;      for (const a of this.attachments(o)) if (a.fx.attachBuff2?.kw.includes(kw) && this.isA(o, a.fx.attachBuff2.needs)) return true;
    }
    // Anger, Wonder, Brawn: in the graveyard, with the right land on the battlefield
    if (o.zone === 'battlefield' && o.fx.type.creature) {
      const q = this.players[o.controller];
      if (q.graveyard.some(g => g.fx.gyAnthem?.kw.includes(kw) && q.battlefield.some(l => l.fx.type.land && l.fx.subtypes.includes(g.fx.gyAnthem.land)))) return true;
    }
    if (o.zone !== 'battlefield') return false;
    for (const a of this.attachments(o)) if (a.fx.attachBuff?.kw.includes(kw)) return true;
    for (const s of this.players[o.controller].battlefield) if (s.fx.anthem?.kw.includes(kw) && this.anthemApplies(s, o)) return true;
    return !!o.fx.condBuff?.kw.includes(kw) && !!this.condBuff(o);
  }
  pacified(o) { return this.attachments(o).some(a => a.fx.pacify); }
  // Its own activated abilities, plus any it borrows (Marvin, Murderous Mimic; Necrotic Ooze)
  abilitiesOf(o) {
    const b = o.fx.borrow;
    if (!b || o.zone !== 'battlefield') return o.fx.abilities;
    const p = this.players[o.controller];
    const pool = {
      creatures: () => p.battlefield.filter(x => x.fx.type.creature),
      artifacts: () => p.battlefield.filter(x => x.fx.type.artifact),
      lands: () => p.battlefield.filter(x => x.fx.type.land),
      allCreatures: () => this.alive().flatMap(q => q.battlefield.filter(x => x.fx.type.creature)),
      myGy: () => p.graveyard.filter(x => x.fx.type.creature),
      allGy: () => this.alive().flatMap(q => q.graveyard.filter(x => x.fx.type.creature)),
    }[b.from]?.() || [];
    const seen = new Set();
    const borrowed = pool.filter(x => x !== o && !x.fx.borrow && (!b.sameName || x.card.name !== o.card.name)).flatMap(x => x.fx.abilities)
      .filter(ab => !seen.has(ab) && seen.add(ab));
    return [...o.fx.abilities, ...borrowed];
  }
  // Power/toughness that count something ("equal to the number of lands you control")
  dynPT(o, what) {
    const p = this.players[o.controller];
    if (!what) return null;
    if (what === 'cards in your hand') return p.hand.length;
    if (what === 'cards in your graveyard') return p.graveyard.length;
    if (what === 'creature cards in your graveyard') return p.graveyard.filter(x => x.fx.type.creature).length;
    if (what === 'cards in all graveyards') return this.players.reduce((s, q) => s + q.graveyard.length, 0);
    // (1.6.0) "1 plus …", opponents' graveyards, card types (Tarmogoyf), the whole battlefield
    if (what.startsWith('1+')) return 1 + (this.dynPT(o, what.slice(2)) || 0);
    const types = gy => new Set(gy.flatMap(c => ['creature', 'artifact', 'enchantment', 'instant', 'sorcery', 'planeswalker', 'land', 'battle'].filter(t => c.fx.type[t]))).size;
    if (what === "cards in your opponents' graveyards") return this.opponents(p).reduce((s, q) => s + q.graveyard.length, 0);
    if (what === 'card types among cards in all graveyards') return types(this.players.flatMap(q => q.graveyard));
    if (what === "card types among cards in your opponents' graveyards") return types(this.opponents(p).flatMap(q => q.graveyard));
    if (what === 'creatures on the battlefield') return this.alive().reduce((s, q) => s + q.battlefield.filter(c => c.fx.type.creature).length, 0);
    if (what === 'creature cards in all graveyards') return this.players.reduce((s, q) => s + q.graveyard.filter(c => c.fx.type.creature).length, 0);
    if (what === 'lands on the battlefield') return this.alive().reduce((s, q) => s + q.battlefield.filter(c => c.fx.type.land).length, 0);
    if (what === "cards in all players' hands") return this.alive().reduce((s, q) => s + q.hand.length, 0);
    if (what === 'artifacts and enchantments you control') return p.battlefield.filter(c => c.fx.type.artifact || c.fx.type.enchantment).length;
    if (what === 'cards in your library') return p.library.length;
    if (what === 'instant and sorcery cards in your graveyard') return p.graveyard.filter(c => c.fx.type.instant || c.fx.type.sorcery).length;
    if (what === 'the greatest mana value among artifacts you control') return this.dynValue(p, { dyn: 'maxMv', what: 'artifact' });
    const dev = what.match(/your devotion to (\w+)/);
    if (dev) return this.dynValue(p, { dyn: 'devotion', color: { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' }[dev[1]] });
    const m = what.match(/^(\w+)s you control$/);
    return m ? this.countControlled(p, m[1]) : null;
  }
  colorsOf(o) { return o.card.colors || []; }
  canTarget(p, o) {
    if (!o || o.zone !== 'battlefield') return false;
    if (this.has(o, 'shroud')) return false;
    return !(o.controller !== p.idx && this.has(o, 'hexproof'));
  }
  // Theros gods: not a creature until their controller's devotion is high enough
  dormant(o) {
    // Spacecraft: a creature only once it has enough charge counters (station); Imprisoned in the Moon: a land now
    if (o.fx.stationN && (o.named?.charge || 0) < o.fx.stationN) return true;
    if (o.zone === 'battlefield' && this.attachments(o).some(a => a.fx.attachSet?.land)) return true;
    const gd = o.fx.godDevotion;
    if (!gd) return false;
    const p = this.players[o.controller];
    const dev = p.battlefield.reduce((s, x) => s + parseCost(x.card.manaCost).pips.filter(pip => pip.some(c => gd.colors.includes(c))).length, 0);
    return dev < gd.n;
  }
  canAttack(o) {
    if (o.zone !== 'battlefield') return false;
    const q = this.players[o.controller];
    if (o.noAttackTurn === this.turn) return false;
    if (q.battlefield.some(s => s.fx.noAttack) || (o.fx.needsBlessing && !this.evalCond(q, o, { c: 'blessing' })) || (o.fx.attackCond && !this.evalCond(q, o, o.fx.attackCond))) return false;
    return o.fx.type.creature && !o.tapped && (!o.sick || this.has(o, 'haste'))
      && !this.has(o, 'defender') && !this.pacified(o) && !this.dormant(o);
  }
  canBlock(b, a) {
    if (b.zone !== 'battlefield' || b.tapped || !b.fx.type.creature || this.dormant(b)) return false;
    if (b.suspected || this.has(b, 'cantblock') || this.has(b, 'decayed') || this.pacified(b) || this.has(a, 'unblockable')) return false;
    if (b.noBlockTurn === this.turn || (b.fx.blockFlyersOnly && !this.has(a, 'flying'))) return false;
    // Bothersome Quasit: goaded creatures can't block
    if (b.goaded && this.opponents(this.players[b.controller]).some(q => q.battlefield.some(s => s.fx.goadNoBlock))) return false;
    if (b.fx.needsBlessing && !this.evalCond(this.players[b.controller], b, { c: 'blessing' })) return false;
    if (b.fx.attackCond && !this.evalCond(this.players[b.controller], b, b.fx.attackCond)) return false;
    // Evasion from the attacker's side of the table: small creatures (Tetsuko), countered creatures, the Ring-bearer, bullies (Champion of Lambholt)
    const ab = this.players[a.controller].battlefield;
    for (const s of ab) {
      const se = s.fx.smallEvasion;
      if (se && ((se.pw && this.power(a) <= se.n) || (se.tough && this.toughness(a) <= se.n)) && (!se.by || this.power(b) >= se.by)) return false;
      if (s.fx.counterEvasion && a.counters > 0) return false;
      if (s.fx.bullyEvasion && this.power(b) < this.power(s)) return false;
    }
    if (this.has(a, 'unblockable-bigger') && this.power(b) > this.power(a)) return false;
    if (this.has(a, 'flying') && !this.has(b, 'flying') && !this.has(b, 'reach')) return false;
    // Evasion keywords (702.36 fear, 702.13 intimidate, 702.28 shadow, 702.31 horsemanship, 702.118 skulk, 702.14 landwalk)
    const bc = this.colorsOf(b);
    if (this.has(a, 'fear') && !b.fx.type.artifact && !bc.includes('B')) return false;
    if (this.has(a, 'intimidate') && !b.fx.type.artifact && !bc.some(c => this.colorsOf(a).includes(c))) return false;
    if (this.has(a, 'shadow') !== this.has(b, 'shadow')) return false;
    if (this.has(a, 'horsemanship') && !this.has(b, 'horsemanship')) return false;
    if (this.has(a, 'skulk') && this.power(b) > this.power(a)) return false;
    if (a.fx.landwalk && this.players[b.controller].battlefield.some(l => l.fx.type.land && l.fx.subtypes.includes(a.fx.landwalk))) return false;
    // (landwalk granted by a lord: Goblin King, Zombie Master)
    for (const t of ['island', 'swamp', 'forest', 'mountain', 'plains']) if (this.has(a, t + 'walk') && this.players[b.controller].battlefield.some(l => l.fx.type.land && l.fx.subtypes.includes(t))) return false;
    // Protection from a color: can't be blocked by creatures of that color
    return !a.fx.prot?.some(c => bc.includes(c));
  }

  // ---------- mana
  sources(p, exclude) { return mana.sources(this, p, exclude); }
  // A creature can use {T} abilities (mana included) once it's been under your control since your turn began,
  // or with haste, or with Shang-Chi / Thousand-Year Elixir-style "as though it had haste"
  canTapNow(p, o) { return mana.canTapNow(this, p, o); }
  // Mana with a spending restriction (Shang-Chi: only creature abilities) is only offered for what it may pay for
  spendOk(only) { return mana.spendOk(this, only); }
  // Mana abilities that count something: Gaea's Cradle (creatures), Bloom Tender (colors), Nykthos (devotion)
  manaAmount(p, s) { return mana.manaAmount(this, p, s); }
  units(p, exclude) { return mana.units(this, p, exclude); }
  // The mana one permanent would make if tapped now (restricted mana included; it keeps its restriction in the pool)
  manaUnitsOf(p, o) { return mana.manaUnitsOf(this, p, o); }
  // Tapping a permanent for mana by hand: the mana goes into the pool, which empties at the end of the step
  tapForMana(p, o) { return mana.tapForMana(this, p, o); }
  // Taking a tap back: a source you tapped by hand this step, whose mana is all still in your pool,
  // that didn't sacrifice itself or set off a "becomes tapped" trigger
  canUntapForMana(p, o) { return mana.canUntapForMana(this, p, o); }
  untapForMana(p, o) { return mana.untapForMana(this, p, o); }
  poolText(p) { return mana.poolText(this, p); }
  // A mana combo gives its controller unbounded mana for the rest of the turn
  infinite(p) { return mana.infinite(this, p); }
  availableMana(p) { return mana.availableMana(this, p); }
  // avoid: colors needed by spells still to be cast this turn, kept back when paying generic costs
  // help: extra one-shot payers for this spell (convoke creatures, delve graveyard cards)
  /**
   * @param {any} p @param {any} cost @param {number} [extra] @param {any} [exclude] @param {Set<string> | null} [avoid] @param {any[]} [help]
   */
  planPayment(p, cost, extra = 0, exclude = null, avoid = null, help = []) { return mana.planPayment(this, p, cost, extra, exclude, avoid, help); }
  commitPayment(p, plan) { return mana.commitPayment(this, p, plan); }
  // Convoke creatures and delve cards that can help pay for this spell
  helpUnits(p, o) { return mana.helpUnits(this, p, o); }
  // A spell description from card text: "black", "green permanent", "aura, equipment, or vehicle", "zombie"
  spellIs(o, what) { return mana.spellIs(this, o, what); }
  // How many permanents p controls of a type or subtype ("creature", "elf", "artifact creature")
  countControlled(p, what) { return mana.countControlled(this, p, what); }
  isA(o, what) { return mana.isA(this, o, what); }
  // A permanent letting p cast o from their graveyard once this turn (Kess, Serra Paragon, Muldrotha)
  gyOnceSource(p, o) { return mana.gyOnceSource(this, p, o); }
  handOnlyAgainst(p) { return mana.handOnlyAgainst(this, p); }
  // n other cards of a color in hand to exile for an alternative cost (cheapest first), or null
  pitchCards(p, o, color, n) { return mana.pitchCards(this, p, o, color, n); }
  // The creature a Flare would sacrifice: the least valuable one that fits (never a commander)
  altSacFodder(p, o) { return mana.altSacFodder(this, p, o); }
  // A card in hand that shares a color with o, to exile for a Force of Will style pitch cost
  pitchCard(p, o) { return mana.pitchCard(this, p, o); }
  dynValue(p, d, ctx = {}) { return mana.dynValue(this, p, d, ctx); }
  // How p could pay for o right now: its normal cost (with convoke/delve help) or an alternative
  // (what's being paid for decides which restricted mana can help: see spendOk)
  castMode(p, o) { return mana.castMode(this, p, o); }
  castModeRaw(p, o) { return mana.castModeRaw(this, p, o); }
  costOf(p, o) { return mana.costOf(this, p, o); }
  // The top card of p's library, when a permanent lets them play it (Courser of Kruphix, Future Sight)
  topPlayable(p, o) { return mana.topPlayable(this, p, o); }
  // The cost of an alternative way to cast (or extra costs added on top)
  altCost(o, alt) { return mana.altCost(this, o, alt); }
  addCost(a, b) { return mana.addCost(this, a, b); }
  reduces(what, o) { return mana.reduces(this, what, o); }
  canCast(p, o) { return mana.canCast(this, p, o); }
  // The spells p has cast this turn (Rule of Law, Conduit of Ruin)
  castThisTurn(p) { return mana.castThisTurn(this, p); }
  // Rule of Law, Deafening Silence, Ethersworn Canonist: one spell (of a kind) per player each turn
  spellCapped(p, o) { return mana.spellCapped(this, p, o); }
  // Ward on a permanent, its own or granted (Bronze Guardian, Innkeeper's Talent): { n: mana, life }
  wardOf(o) { return mana.wardOf(this, o); }
  // "Damage can't be prevented" (Questing Beast, Sunspine Lynx)
  noPrevent() { return mana.noPrevent(this); }

  // ---------- zones
  move(o, to, opts = {}) { return zones.move(this, o, to, opts); }
  // "Choose a creature type" on resolution: the commonest type among these cards (p's creatures by default)
  bestType(p, cards = p.battlefield.filter(o => o.fx.type.creature)) { return zones.bestType(this, p, cards); }
  // A permanent arrived (cast, put there, or created as a token): "whenever a creature enters" watchers,
  // evolve, bloodthirst, and the upkeep keywords that start counting now
  entered(o) { return zones.entered(this, o); }
  leaveBattlefield(o) { return zones.leaveBattlefield(this, o); }
  draw(p, n = 1, quiet = false) { return zones.draw(this, p, n, quiet); }
  destroy(o) { return zones.destroy(this, o); }
  // A regeneration shield (701.15): instead of being destroyed, tap it, remove its damage and take it out of combat
  regenerate(o) { return zones.regenerate(this, o); }
  // A creature died (700.4): its own "when ~ dies" and every "whenever a creature dies" watcher trigger
  /** @param {any} o @param {any} [snap] */
  noteDeath(o, snap = {}) { return zones.noteDeath(this, o, snap); }
  sacrifice(p, o, why = '') { return zones.sacrifice(this, p, o, why); }
  // Discarding (701.8): "whenever you discard" watchers and madness-style payoffs see it
  /** @param {any} p @param {any[]} cards @param {string | null} [why] */
  discard(p, cards, why = '') { return zones.discard(this, p, cards, why); }
  // Exile and return (blink): a new object with fresh ETB triggers, no counters, auras fall off
  blink(o) { return zones.blink(this, o); }
  createToken(p, e, src) { return zones.createToken(this, p, e, src); }
  createTreasure(p, src) { return zones.createTreasure(this, p, src); }
  // Treasure, Clue, Food, Blood, Map and Powerstone tokens, with their own abilities written out as text
  createArtifactToken(p, kind, src) { return zones.createArtifactToken(this, p, kind, src); }
  // Land searches (fetch lands, Cultivate, landcycling): you pick in your seat; the AI takes the colors it's short of
  async fetchLands(p, e, src) { return zones.fetchLands(this, p, e, src); }

  // ---------- triggers & state-based actions
  trigger(o, kind) { return triggers.trigger(this, o, kind); }
  // Elesh Norn, Mother of Machines (and Torpor Orb-style effects): entering doesn't trigger this player's abilities
  etbSuppressed(q) { return triggers.etbSuppressed(this, q); }
  async flushTriggers() { return triggers.flushTriggers(this); }

  // The last 60 triggers are one short pattern (period 1 to 6) repeated over and over
  periodicTriggers() { return triggers.periodicTriggers(this); }
  // Priority stops (people only): the steps where a seat played here asked to stop, or every step
  // with Full control. The AI pilots have no stopAt, so this changes nothing for them.
  async stopFor(step, active) { return triggers.stopFor(this, step, active); }

  // How many extra times a queued trigger happens because of trigger doublers its controller has
  extraTriggers(t) { return triggers.extraTriggers(this, t); }
  // Generic triggers (effects.js WATCHERS): every permanent watching for this event queues its ability.
  // info: { p: the player it happened to, o: the object involved, n: amount }
  fire(ev, info = {}) { return triggers.fire(this, ev, info); }
  // Abilities past a threshold: station charge counters, class level, max speed
  gateOk(s, gate) { return triggers.gateOk(this, s, gate); }
  // A creature matching a description from card text: "artifact", "non-human", "ninja or rogue", "modified", plus "with power 4 or greater"…
  fits(o, what, w) { return triggers.fits(this, o, what, w); }
  whoOk(w, q, i) { return triggers.whoOk(this, w, q, i); }
  watchLabel(ev, info) { return triggers.watchLabel(this, ev, info); }
  watchMatches(w, s, q, info) { return triggers.watchMatches(this, w, s, q, info); }
  // Conditions of "if" effects, intervening-if triggers and "as long as" bonuses (effects.js parseCond)
  evalCond(p, src, c, ctx = {}) { return triggers.evalCond(this, p, src, c, ctx); }

  // Triggered and activated abilities use the stack too: targets are chosen as the ability is put
  // on the stack, every player gets priority, and an ability whose targets are all gone does nothing
  async stackAbility(p, src, effects, label, kind = 'ability', trig = null, x = 0) { return triggers.stackAbility(this, p, src, effects, label, kind, trig, x); }
  sbaPass() { return triggers.sbaPass(this); }
  async sba() { return triggers.sba(this); }
  // 903.9a: a commander put into a graveyard or exile since the last check may go to the command zone (its owner's
  // choice; the AI keeps it there only to reanimate or recast it from there, people are asked)
  async commanderChoices() { return triggers.commanderChoices(this); }
  cantLose(q) { return triggers.cantLose(this, q); }
  lose(q, reason, rule) { return triggers.lose(this, q, reason, rule); }
  /** @param {any} winner @param {string} why @param {any[] | null} [team] */
  finish(winner, why, team = null) { return triggers.finish(this, winner, why, team); }

  // ---------- effects
  validTarget(t, p) { return resolve.validTarget(this, t, p); }
  // (who controls the effect resolving now: life they make others lose counts as eliminating them, for Kingdoms)
  async runEffects(p, src, effects, ctx = {}) { return resolve.runEffects(this, p, src, effects, ctx); }
  async runEffects0(p, src, effects, ctx = {}) { return resolve.runEffects0(this, p, src, effects, ctx); }
  async doEffect(p, src, e, ctx, i) { return resolve.doEffect(this, p, src, e, ctx, i); }
  // Xorn, Academy Manufactor, Peregrin Took: making tokens makes an extra artifact token too
  extraTokens(p, kind, src) { return resolve.extraTokens(this, p, kind, src); }
  // Doubling Season, Anointed Procession (twice as many tokens), and one-more effects
  tokenCount(p, n) { return resolve.tokenCount(this, p, n); }
  // Land drops this turn: one, plus Exploration-style permanents and "play an additional land this turn"
  landDrops(p) { return resolve.landDrops(this, p); }
  // Hardened Scales (one more) and Doubling Season-style (twice as many) +1/+1 counter replacements
  moreCounters(o, n) { return resolve.moreCounters(this, o, n); }
  // Several replacement effects on one event (616.1): the affected player chooses the order they apply in. Every
  // choice here is about an amount, so the order that's best for that player is used (most counters or life
  // gained, least damage taken). Rules 4 and earlier applied them in battlefield order.
  applyOps(n, ops) { return resolve.applyOps(this, n, ops); }
  replaceInOrder(n, ops, want) { return resolve.replaceInOrder(this, n, ops, want); }
  // Choosing cards from a zone: a human seat picks, the AI takes the most valuable
  async pickCards(p, cards, n, text) { return resolve.pickCards(this, p, cards, n, text); }
  // A creature p would like to grow, pump or protect (their best one)
  bestOwnCreature(p, filter = (/** @type {any} */ _o) => true) { return resolve.bestOwnCreature(this, p, filter); }

  // The newer effects: library manipulation, keyword actions, conditions, graveyard work
  async doEffectMore(p, src, e, ctx, tgt, X) { return resolve.doEffectMore(this, p, src, e, ctx, tgt, X); }
  // "That player": whoever the trigger was about (the player dealt combat damage, whose creature died, whose upkeep it is)
  thatPlayer(p, ctx) { return resolve.thatPlayer(this, p, ctx); }
  setMonarch(p, why = '') { return resolve.setMonarch(this, p, why); }
  // Boon Reflection, Rhox Faithmender: life gained is doubled
  lifeGain(p, n) { return resolve.lifeGain(this, p, n); }
  // Committing a crime (700.13): targeting an opponent, or something an opponent controls
  noteCrime(p, targets) { return resolve.noteCrime(this, p, targets); }
  // Fiery Emancipation, Torbran-style: damage from your sources to opponents and their permanents is doubled
  moreDamage(src, victimIdx, n) { return resolve.moreDamage(this, src, victimIdx, n); }
  damagePlayer(q, n, src, combat) { return resolve.damagePlayer(this, q, n, src, combat); }
  damageObj(o, n, src) { return resolve.damageObj(this, o, n, src); }

  // ---------- actions the agents take
  async playLand(p, o) {
    if (p.landsPlayed >= this.landDrops(p) ||!(p.hand.includes(o) || (o.zone === 'library' && this.topPlayable(p, o)) || (o.zone === 'exile' && o.mayPlay?.p === p.idx && o.mayPlay.until >= this.turn))) return false;
    // (a modal double-faced card with a land back is played as that land)
    if (!o.fx.type.land) { if (!this.canPlayBackLand(p, o)) return false; this.useFace(o, o.card.altFace); }
    p.landsPlayed++;
    // Thespian's Stage-style lands (Vesuva): enter as a copy of the best land on the battlefield
    if (o.fx.clone === 'land') {
      const model = this.alive().flatMap(q => q.battlefield).filter(x => x.fx.type.land && !x.fx.clone && x.fx.mana).sort((a, b) => (b.fx.mana.amount + b.fx.mana.colors.length * 0.1 + (b.fx.abilities.length ? 1 : 0)) - (a.fx.mana.amount + a.fx.mana.colors.length * 0.1 + (a.fx.abilities.length ? 1 : 0)))[0];
      this.move(o, 'battlefield', { tapped: true });
      if (model) { o.baseCard = o.card; o.card = model.card; o.fx = model.card.fx; this.log(`${this.pn(p)} plays ${this.cn(o)} as a copy of ${esc(model.card.name)} (tapped)`, { kind: 'land' }); }
      this.fire('landPlay', { o, p: p.idx });
      this.trigger(o, 'etb');
      await this.sba();
      return true;
    }
    this.move(o, 'battlefield', { tapped: o.fx.entersTapped });
    this.log(`${this.pn(p)} plays ${this.cn(o)}${o.fx.entersTapped ? ' (tapped)' : ''}`, { kind: 'land' });
    this.fire('landPlay', { o, p: p.idx });
    await this.beat(0.6);
    if (o.fx.fetch) {
      this.move(o, 'graveyard');
      this.log(`${this.pn(p)} sacrifices ${this.cn(o)} to search for a land`, { kind: 'minor' });
      // (Polluted Delta: "an Island or Swamp card"; Evolving Wilds: "a basic land card")
      const named = (o.card.text || '').match(/search your library for an? ((?:basic )?(?:plains|island|swamp|mountain|forest)(?:,? (?:or )?(?:plains|island|swamp|mountain|forest))*) card/i);
      await this.fetchLands(p, { n: 1, bf: true, tapped: /tapped/i.test(o.card.text) && !/untapped/i.test(o.card.text), basic: /basic/i.test(o.card.text), subs: named ? named[1].toLowerCase().match(/plains|island|swamp|mountain|forest/g) : null }, o);
      await this.beat(0.5);
    }
    this.trigger(o, 'etb');
    await this.sba();
    return true;
  }

  async cast(p, o, choice = {}) {
    if (this.over || p.lost) return false;
    // (a bestow or mutate attempt that didn't go through leaves the card as it was)
    if (o.zone === 'hand') { if (o.bestowed) this.unbestow(o); o.mutateOnto = null; }
    const mode = choice.mode || this.castMode(p, o);
    if (!mode) return false;
    this.payingFor = { o, ability: false };
    o.castFrom = o.zone;
    // (a foretold or plotted card is cast now)
    if (o.foretold != null && o.zone === 'exile' && mode.alt !== 'foretell' && mode.alt !== 'plot') { o.foretold = null; o.mayPlay = null; }
    // (Kess and friends: their once-a-turn permission is used up)
    if (o.zone === 'graveyard' && !mode.alt) { const s = this.gyOnceSource(p, o); if (s) { s.gyOnceTurn = this.turn; if (s.fx.gyCastOnce.exile) o.gyOnceExile = true; } }
    let { c, extra } = this.costOf(p, o);
    let help = this.helpUnits(p, o);
    // Alternative costs replace the mana cost (and commander tax doesn't apply to flashback from a graveyard)
    if (mode.alt) {
      c = this.altCost(o, mode.alt);
      extra = mode.alt === 'free' || mode.alt === 'pitch' ? extra : 0;
      help = [];
    }
    o.escaped = mode.alt === 'escapeOwn' || mode.alt === 'escape';
    if (mode.alt === 'morph') { if (!this.canCastFaceDown(p, o)) return false; this.makeFaceDown(o, o.fx.morph.disguise ? 'disguise' : 'morph'); }
    // Cleave: the text without its [bracketed] words; fuse: both halves of a split card (702.102)
    if (mode.alt === 'cleave' && o.fx.cleaveSpell) choice = { ...choice, effects: o.fx.cleaveSpell };
    if (mode.alt === 'fuse') { if (!this.canFuse(p, o)) return false; choice = { ...choice, effects: [...o.fx.spell, ...o.card.altFace.fx.spell] }; }
    // Bestow: an Aura spell with enchant creature; mutate: a creature spell that targets a creature to merge onto
    if (mode.alt === 'bestow') { if (!this.canBestow(p, o)) return false; o.bestowed = true; o.fx = this.bestowFx(o); }
    if (mode.alt === 'mutate') {
      if (!this.canMutate(p, o)) return false;
      const t = choice.mutateOnto || (p.agent.chooseMutateTarget ? await p.agent.chooseMutateTarget(this, p, o, this.mutateTargets(p, o)) : this.mutateTargets(p, o)[0]);
      if (!t) return false;
      o.mutateOnto = t;
    }
    o.impendingCast = mode.alt === 'impending';
    // Foretell and plot: pay, exile it face down, and cast it on a later turn (see castModeRaw)
    if (mode.alt === 'foretell' || mode.alt === 'plot') {
      const sp = this.planPayment(p, c, 0);
      if (!sp) return false;
      this.commitPayment(p, sp);
      this.move(o, 'exile');
      o.foretold = this.turn;
      o.mayPlay = { p: p.idx, until: Infinity };
      this.log(`${this.pn(p)} ${mode.alt === 'plot' ? 'plots' : 'foretells'} a card`, { kind: 'cast', p: p.idx, rule: mode.alt === 'plot' ? '702.170a' : '702.143a' });
      await this.beat(0.6);
      return true;
    }
    if (mode.alt === 'forestGift') {
      const q = p.agent.weakestOpponent(this, p);
      if (q) { const n = this.lifeGain(q, 3); q.life += n; this.emit('life', { p: q.idx, d: n }); this.log(`${this.pn(q)} gains ${n} life (${this.cn(o)}'s alternative cost)`, { kind: 'minor' }); }
    }
    // Suspend: pay, exile it with time counters, and it's cast for free when the last one comes off (see upkeepCosts)
    if (mode.alt === 'suspend') {
      const sp = this.planPayment(p, c, 0);
      if (!sp) return false;
      this.commitPayment(p, sp);
      this.move(o, 'exile');
      o.timeCounters = o.fx.suspend.n;
      (p.suspended ||= []).push(o);
      this.log(`${this.pn(p)} suspends ${this.cn(o)} with ${o.timeCounters} time counter${o.timeCounters === 1 ? '' : 's'}`, { kind: 'cast', p: p.idx, rule: '702.62a' });
      await this.beat(0.6);
      return true;
    }
    // Optional additional costs: kicker (702.33) and buyback (702.27), paid when there's mana for them
    o.kicked = false;
    let buyback = false;
    for (const [k, flag] of [['kicker', 'kick'], ['buyback', 'buyback']]) {
      if (!o.fx[k] || choice[flag] === false || mode.alt === 'free') continue;
      const more = this.addCost(c, parseCost(o.fx[k]));
      const want = choice[flag] ?? (p.agent.wantsExtraCost ? p.agent.wantsExtraCost(this, p, o, k) : true);
      if (want && this.planPayment(p, more, extra, null, choice.avoid, help)) { c = more; if (k === 'kicker') o.kicked = true; else buyback = true; }
    }
    // Entwine (702.42): pay the extra cost for every mode at once
    let entwined = false;
    if (o.fx.entwine && o.fx.modes && !choice.effects && mode.alt !== 'free') {
      const more = this.addCost(c, parseCost(o.fx.entwine));
      if (this.planPayment(p, more, extra, null, choice.avoid, help)) { c = more; entwined = true; }
    }
    // Spree (702.172): each chosen mode adds its cost; take the useful ones that fit the mana
    let spreeEffects = null;
    if (o.fx.spree?.length && !choice.effects) {
      spreeEffects = [];
      const modes = o.fx.spree.map(sm => ({ sm, v: sm.effects.reduce((s, e) => s + p.agent.effectValue(this, p, o, e, true), 0) })).filter(m => m.v > 0).sort((a, b) => b.v - a.v);
      for (const { sm } of modes) {
        const more = this.addCost(c, parseCost(sm.cost));
        if (this.planPayment(p, more, extra, null, choice.avoid, help)) { c = more; spreeEffects.push(...sm.effects); }
      }
      if (!spreeEffects.length) return false;
    }
    let x = 0;
    if (c.x) {
      const maxX = Math.max(0, Math.floor((this.availableMana(p) + help.length - (c.generic + c.pips.length + extra)) / c.x));
      // (rules 5: the caster picks X; the AI by what it achieves, people from buttons. Before, always the most mana)
      x = choice.x ?? (this.rules >= 5 && maxX > 0 ? Math.min(maxX, Math.max(0, await (p.agent.chooseSpellXAsync ? p.agent.chooseSpellXAsync(this, p, o, maxX) : p.agent.chooseSpellX ? p.agent.chooseSpellX(this, p, o, maxX) : maxX))) : maxX);
      // (an AI pilot doesn't cast an X spell for X = 0: it would do nothing)
      if (this.rules >= 5 && x === 0 && choice.x == null && !p.agent.human && !o.fx.type.permanent) return false;
    }
    const plan = this.planPayment(p, c, extra + x * c.x, null, choice.avoid, help);
    if (!plan) return false;
    let effects = o.fx.type.permanent ? [] : choice.effects || spreeEffects || (entwined ? o.fx.modes.modes.flat() : o.fx.modes ? p.agent.chooseModes(this, p, o, o.fx.modes) : o.fx.spell);
    if (entwined) this.log(`${this.pn(p)} pays the entwine cost for ${this.cn(o)}: all modes`, { kind: 'minor', rule: '702.42a' });
    // (Boromir, Lavinia: whether any mana is spent on it)
    const spent = c.generic + c.pips.length + extra + x * (c.x || 0);
    // Overloaded: "target" becomes "each" (the opponents' permanents for removal, bounce and damage)
    if (mode.alt === 'overload') effects = effects.map(e => ({ remove: { k: 'wipeOpp', mode: e.mode, what: e.what }, bounce: { k: 'wipeOpp', mode: 'bounce', what: e.what }, damage: { k: 'wipeOpp', mode: 'damage', n: e.n, what: 'creature' }, tap: { k: 'tapAll', what: 'creatures' }, pump: { k: 'teamPump', p: e.p, t: e.t, kw: e.kw }, counters: { ...e, on: 'each creature you control' } }[e.k] || e));
    const targets = choice.targets || effects.map(e => (needsTarget(e) ? p.agent.chooseTarget(this, p, e, o) : null));
    let auraTarget = null;
    if (o.fx.type.aura) { auraTarget = choice.auraTarget || p.agent.chooseAuraTarget(this, p, o); if (!auraTarget) return false; }
    p.casting = o;   // (Lion's Eye Diamond discards the hand, but not the spell it pays for)
    this.commitPayment(p, plan);
    p.casting = null;
    if (o.fx.lifeCost) {
      p.life -= o.fx.lifeCost;
      this.emit('life', { p: p.idx, d: -o.fx.lifeCost });
      this.log(`${this.pn(p)} pays ${o.fx.lifeCost} life to cast ${this.cn(o)}`, { kind: 'minor' });
    }
    // Additional costs (601.2f): sacrifice a creature, discard a card… and flashback's own non-mana costs
    if (o.fx.addCost) await this.payCosts(p, o, o.fx.addCost, o);
    if (mode.alt === 'flashback' && o.fx.flashbackCosts && !mode.granted) await this.payCosts(p, o, o.fx.flashbackCosts, o);
    if (mode.alt === 'life') await this.payCosts(p, o, { life: o.fx.altLife.n }, o);
    if (mode.alt === 'escape') {
      // Exile the three least useful other cards (lands first)
      const fodder = p.graveyard.filter(x => x !== o).sort((a, b) => (b.fx.type.land ? 1 : 0) - (a.fx.type.land ? 1 : 0) || (a.card.cmc || 0) - (b.card.cmc || 0)).slice(0, 3);
      for (const f of fodder) this.move(f, 'exile');
      this.log(`${this.pn(p)} casts ${this.cn(o)} from their graveyard with escape, exiling ${fodder.length} other cards (Underworld Breach)`, { kind: 'minor', rule: '702.138a' });
    } else if (mode.alt === 'pitch') {
      const pitched = this.pitchCard(p, o);
      this.move(pitched, 'exile');
      p.life -= 1;
      this.emit('life', { p: p.idx, d: -1 });
      this.log(`${this.pn(p)} pays 1 life and exiles ${this.cn(pitched)} instead of paying ${this.cn(o)}'s mana cost`, { kind: 'minor', rule: '118.9' });
    } else if (mode.alt === 'evokePitch' || mode.alt === 'altPitch') {
      const cards = (mode.alt === 'evokePitch' ? this.pitchCards(p, o, o.fx.evokePitch, 1) : this.pitchCards(p, o, o.fx.altPitch.color, o.fx.altPitch.n)) || [];
      for (const c of cards) this.move(c, 'exile');
      this.log(`${this.pn(p)} exiles ${cards.map(c => this.cn(c)).join(' and ')} from their hand instead of paying ${this.cn(o)}'s mana cost`, { kind: 'minor', rule: mode.alt === 'evokePitch' ? '702.74a' : '118.9' });
    } else if (mode.alt === 'altSac') {
      const f = this.altSacFodder(p, o);
      if (f) { this.log(`${this.pn(p)} sacrifices ${this.cn(f)} instead of paying ${this.cn(o)}'s mana cost`, { kind: 'minor', rule: '118.9' }); this.sacrifice(p, f); }
    } else if (mode.alt === 'altBounce') {
      const land = p.battlefield.filter(x => x.fx.type.land && (o.fx.altBounce === 'land' || x.fx.subtypes.includes(o.fx.altBounce))).sort((a, b) => (b.tapped ? 1 : 0) - (a.tapped ? 1 : 0))[0];
      if (land) { this.move(land, 'hand'); this.log(`${this.pn(p)} returns ${this.cn(land)} to their hand instead of paying ${this.cn(o)}'s mana cost`, { kind: 'minor', rule: '118.9' }); }
    } else if (mode.alt === 'escapeOwn') {
      const fodder = p.graveyard.filter(x => x !== o).sort((a, b) => p.agent.value(this, a) - p.agent.value(this, b)).slice(0, o.fx.escape.n);
      for (const f of fodder) this.move(f, 'exile');
      this.log(`${this.pn(p)} casts ${this.cn(o)} with escape, exiling ${fodder.length} other cards from their graveyard`, { kind: 'minor', rule: '702.138a' });
    } else if (mode.alt === 'jumpstart') {
      const [d] = (await p.agent.chooseDiscard(this, p, 1)) || [];
      if (d) this.discard(p, [d], null);
      this.log(`${this.pn(p)} casts ${this.cn(o)} from their graveyard with jump-start${d ? `, discarding ${this.cn(d)}` : ''}`, { kind: 'minor', rule: '702.133a' });
    }
    // (how it was cast goes into the cast line below: "casts X with flashback")
    const altText = { flashback: ' with flashback', evoke: ' for its evoke cost', evokePitch: ' for its evoke cost', miracle: ' for its miracle cost', free: ' without paying its mana cost', dash: ' for its dash cost', blitz: ' for its blitz cost', spectacle: ' for its spectacle cost', bestow: ` bestowed on ${auraTarget ? this.cn(auraTarget) : 'a creature'}`, mutate: ` to mutate onto ${o.mutateOnto ? this.cn(o.mutateOnto) : 'a creature'}`, morph: ' face down', madness: ' for its madness cost', cleave: ' with cleave', fuse: ' fused (both halves)', aftermath: ' from their graveyard (aftermath)' }[mode.alt] || '';
    if (o.kicked) this.log(`${this.pn(p)} pays the kicker for ${this.cn(o)}`, { kind: 'minor', rule: '702.33a' });
    if (buyback) this.log(`${this.pn(p)} pays buyback for ${this.cn(o)}`, { kind: 'minor', rule: '702.27a' });
    // Ward (702.21): targeting an opponent's warded permanent costs extra, or the spell is countered
    if (!this.payWard(p, [...targets, auraTarget && { obj: auraTarget }], o)) {
      const zoneArr0 = p[o.zone];
      if (Array.isArray(zoneArr0)) zoneArr0.splice(zoneArr0.indexOf(o), 1);
      o.zone = 'stack';
      this.move(o, 'graveyard');
      return true;
    }
    const fromCommand = o.zone === 'command';
    const fromHand = o.zone === 'hand';
    if (fromCommand) {
      const n = p.castCount[o.iid] || 0;
      if (n) this.log(`Commander tax: ${this.cn(o)} costs {${2 * n}} more`, { rule: '903.8', kind: 'minor' });
      p.castCount[o.iid] = n + 1;
    }
    const zoneArr = p[o.zone];
    if (Array.isArray(zoneArr)) zoneArr.splice(zoneArr.indexOf(o), 1);
    o.zone = 'stack';
    const item = { o, p, x, targets, effects, auraTarget, countered: false, combo: !!choice.combo, response: choice.response || null };
    // "The next spell you cast this turn can't be countered"
    if (p.uncounterTurn === this.turn) { item.uncounterable = true; p.uncounterTurn = 0; }
    // Boromir, Lavinia, Vexing Bauble: a spell cast without spending mana is countered
    if (!spent && !item.uncounterable && !o.fx.uncounterable) {
      const watcher = this.alive().flatMap(q => q.battlefield.filter(s => s.fx.freeCounter && (s.fx.freeCounter === 'any' || q !== p)))[0];
      if (watcher) { item.countered = true; this.log(`${this.cn(watcher)} counters ${this.cn(o)}: no mana was spent to cast it`, { kind: 'removal' }); }
    }
    choice.item = item;
    // (item 109: held-up mana used on someone else's turn, and whether for a counterspell)
    if (p.tells && !this.sim && this.active !== p.idx && p.holdTurn != null) { p.tells.used++; p.holdTurn = null; if (o.fx.spell.some(e => e.k === 'counter')) p.tells.counters++; }
    this.stack.push(item);
    p.stats.spells++;
    p.castNames.add(o.card.name);
    if (p.castList?.turn !== this.turn) p.castList = { turn: this.turn, list: [] };
    p.castList.list.push(o);
    // Spells cast this turn (Mindbreak Trap counts them)
    if (p.turnSpells?.turn !== this.turn) p.turnSpells = { turn: this.turn, n: 0 };
    p.turnSpells.n++;
    // Storm counts every spell cast this turn, by anyone
    if (this.turnSpellCount?.turn !== this.turn) this.turnSpellCount = { turn: this.turn, n: 0 };
    const stormCopies = o.fx.storm ? this.turnSpellCount.n : 0;
    this.turnSpellCount.n++;
    // Counterspells shown so far (opponents read this when guessing what's in hand)
    // Interaction: spells that answer someone else's (counters, removal, bounce, wipes)
    if ([...o.fx.spell, ...o.fx.etb].some(e => ['counter', 'counterAbility', 'remove', 'bounce', 'wipe', 'sweep', 'silence'].includes(e.k))) p.stats.interaction = (p.stats.interaction || 0) + 1;
    if (o.fx.spell.some(e => e.k === 'counter' || e.k === 'counterAbility')) {
      p.countersCast = (p.countersCast || 0) + 1;
      // Countering a partner in a no-counter deal breaks it
      for (const t of targets) if (t?.spell && this.dealBetween(p.idx, t.spell.p.idx)?.kind === 'noCounter') this.breakDeal(p, t.spell.p);
    }
    const tgtText = [...targets, auraTarget && { obj: auraTarget }].filter(Boolean).map(t => this.tname(t)).join(', ');
    this.emit('cast', { o, p });
    this.log(`${this.pn(p)} ${choice.response ? 'responds with' : 'casts'} ${this.cn(o)}${fromCommand ? ' from the command zone' : ''}${altText}${x ? ` (X=${x})` : ''}${tgtText ? ` targeting ${tgtText}` : ''}`, { kind: 'cast', p: p.idx, rule: choice.response ? '117.7' : { flashback: '702.34a', evoke: '702.74a', dash: '702.109a', blitz: '702.152a', spectacle: '702.137a', free: '118.9' }[mode.alt] || null });
    await this.beat(1.3);
    // Eldrazi cast triggers ("When you cast ~, …") go on the stack above the spell
    if (o.fx.castSelf) this.queue.push({ o, effects: o.fx.castSelf, label: 'cast trigger', p, trig: { o, p: p.idx, x } });
    // Becoming a target: heroic and "whenever ~ becomes the target" watchers
    for (const t of targets) if (t?.obj) { this.fire('targeted', { o: t.obj, p: p.idx }); if (t.obj.controller === p.idx) this.fire('heroic', { o: t.obj, p: p.idx }); }
    this.noteCrime(p, targets);
    // "Whenever you cast" triggers and prowess go on the stack above the spell and resolve first
    this.castTriggers(p, o, mode);
    await this.flushTriggers();

    await this.priority(item);
    this.stack.splice(this.stack.indexOf(item), 1);
    // A flashback (or jump-start) spell is exiled instead of going anywhere else (702.34a); buyback returns it to hand
    // (Yawgmoth's Will: a card cast from the graveyard this way is exiled instead of returning there)
    const gone = mode.alt === 'flashback' || mode.alt === 'jumpstart' || o.castAftermath || (o.castFrom === 'graveyard' && (p.gyCast?.turn === this.turn || o.gyOnceExile)) ? 'exile' : buyback ? 'hand' : 'graveyard';
    o.gyOnceExile = false;
    if (item.countered) { this.move(o, item.toExile ? 'exile' : item.toHand ? 'hand' : gone === 'hand' ? 'graveyard' : gone); await this.beat(0.4); return true; }
    // A spell whose every target has become illegal doesn't resolve
    const chosen = targets.filter(Boolean);
    if (!o.fx.type.permanent && chosen.length && chosen.every(t => !this.validTarget(t, p))) {
      this.log(`${this.cn(o)} fizzles: its target is no longer legal`, { rule: '608.2b', kind: 'minor' });
      this.move(o, gone === 'hand' ? 'graveyard' : gone);
      await this.sba();
      return true;
    }

    // Mutate: merge onto its target if that's still legal; otherwise it enters as a plain creature (702.140b)
    if (o.mutateOnto) {
      const host = o.mutateOnto;
      o.mutateOnto = null;
      if (host.zone === 'battlefield' && host.controller === p.idx && host.fx.type.creature && !host.fx.subtypes.includes('human')) {
        this.mergeOnto(p, o, host);
        await this.sba();
        return true;
      }
    }
    // Bestow: with its target gone it resolves as an enchantment creature spell (702.103e)
    if (o.bestowed && !(auraTarget?.zone === 'battlefield')) { this.unbestow(o); auraTarget = null; }
    if (o.fx.type.permanent) {
      this.move(o, 'battlefield', { tapped: o.fx.entersTapped && !o.fx.type.creature });
      if (o.fx.entersCounters === 'X') o.counters = x;
      if (o.kicked && o.fx.kickCounters) o.counters += this.moreCounters(o, o.fx.kickCounters);
      const imprint = choice.imprint || (o.fx.imprint && p.agent.chooseImprint(this, p, o));
      if (imprint && imprint.zone === 'hand') {
        this.move(imprint, 'exile');
        o.imprinted = cardKey(imprint.card);
        this.log(`${this.cn(o)} imprints ${this.cn(imprint)}`, { kind: 'minor' });
      }
      if (auraTarget) {
        if (auraTarget.zone === 'battlefield') o.attachedTo = auraTarget;
        // Control Magic and friends: the enchanted permanent changes sides
        if (auraTarget.zone !== 'battlefield') this.log(`${this.cn(o)} has no legal target`, { kind: 'minor' });
        else if (o.fx.controlAura) await this.doEffect(p, o, { k: 'steal', what: 'permanent', temp: false }, { targets: [{ obj: auraTarget }] }, 0);
      }
      // Clones enter as a copy of the best matching permanent on the battlefield
      if (o.fx.clone) {
        const wanted = { creature: x => x.fx.type.creature, artifact: x => x.fx.type.artifact, enchantment: x => x.fx.type.enchantment, equipment: x => x.fx.type.equipment, 'artifact or enchantment': x => x.fx.type.artifact || x.fx.type.enchantment, 'nonland permanent': x => !x.fx.type.land, land: x => x.fx.type.land }[o.fx.clone] || (x => x.fx.type.creature);
        const model = p.agent.pickBest(this, this.alive().flatMap(q => q.battlefield).filter(x => x !== o && !x.token && wanted(x) && !x.fx.clone));
        if (model) {
          o.baseCard = o.card;
          o.card = model.card;
          o.fx = model.card.fx;
          this.log(`${this.cn(o)} enters as a copy of ${esc(model.card.name)}`, { kind: 'minor', rule: '707.2' });
        }
      }
      this.emit('enter', o);
      this.trigger(o, 'etb');
      if (mode.alt === 'evoke' || mode.alt === 'evokePitch') this.queue.push({ o, effects: [{ k: 'sacSelf' }], label: 'evoked, so it is sacrificed', p });
      // Dash and blitz: haste now, and back to hand (dash) or sacrificed (blitz) at the end step
      if (mode.alt === 'dash' || mode.alt === 'blitz') { o.tempKw = new Set([...(o.tempKw || []), 'haste']); o.hasteUntil = this.turn; o[mode.alt === 'dash' ? 'dashed' : 'blitzed'] = true; }
      if (o.fx.saga) { o.lore = 1; this.chapter(o); }
      await this.beat(0.5);
    } else {
      // Storm: the copies resolve with the original (their effects are added up for mill; otherwise repeated)
      if (stormCopies) this.log(`Storm: ${this.cn(o)} is copied ${stormCopies} time${stormCopies === 1 ? '' : 's'}`, { kind: 'minor', rule: '702.40a' });
      if (stormCopies && effects.every(e => e.k === 'mill')) await this.runEffects(p, o, effects, { x, targets, strict: true, copies: stormCopies + 1 });
      else for (let c = 0; c <= stormCopies && !this.over; c++) await this.runEffects(p, o, effects, { x, targets, strict: true });
      if (!effects.length && !choice.combo) this.log(`${this.cn(o)} resolves (its effect isn't modelled by the simulator)`, { kind: 'minor' });
      // An adventure resolves into exile, and the card's creature may be cast from there later (715.4)
      if (o.zone === 'stack' && o.onAdventure) {
        this.move(o, 'exile');
        o.onAdventure = false;
        o.mayPlay = { p: p.idx, until: Infinity, adventure: true };
        this.log(`${this.cn(o)} goes on an adventure: it can be cast from exile later`, { kind: 'minor', rule: '715.4' });
      }
      // Rebound (702.88): cast from hand, it's exiled and cast again at the next upkeep
      if (o.zone === 'stack' && (o.fx.rebound || o.reboundGrant) && fromHand && !mode.alt) {
        o.reboundGrant = false; this.move(o, 'exile'); (p.rebounds ||= []).push(o); this.log(`${this.cn(o)} is exiled with rebound`, { kind: 'minor', rule: '702.88a' }); }
      if (o.zone === 'stack') this.move(o, gone);
    }
    await this.sba();
    return true;
  }

  castTriggers(p, o, mode = {}) {
    const t = o.fx.type;
    const matches = { any: true, noncreature: !t.creature, creature: t.creature, 'instant or sorcery': t.instant || t.sorcery, instant: t.instant, sorcery: t.sorcery, artifact: t.artifact, enchantment: t.enchantment, multicolored: (o.card.colors || []).length > 1, colorless: !(o.card.colors || []).length, legendary: t.legendary, historic: t.artifact || t.legendary || o.fx.subtypes.includes('saga'), kicked: !!o.kicked };
    // Cascade (702.85): exile from the top until a cheaper nonland card, and cast it free
    // (Imoti, Zhulodok: granted cascade; Wild-Magic Sorcerer: the first spell cast from exile each turn)
    let casc = o.fx.cascade ? 1 : 0;
    for (const s of p.battlefield) {
      const cg = s.fx.cascadeGrant;
      if (!cg || (o.card.cmc || 0) < cg.minMv || (cg.colorless && (o.card.colors || []).length) || (cg.fromHand && o.castFrom !== 'hand')) continue;
      if (cg.fromExile) { if (o.castFrom !== 'exile' || s.cascadeTurn === this.turn) continue; s.cascadeTurn = this.turn; }
      casc += cg.n || 1;
    }
    for (let k = 0; k < casc; k++) this.queue.push({ o, effects: [{ k: 'cascade', n: o.card.cmc || 0 }], label: 'cascade', p });
    let extort = 0;
    for (const s of p.battlefield) {
      if (s.fx.kw.has('prowess') && !t.creature) { s.tempP++; s.tempT++; this.log(`${this.cn(s)} gets +1/+1 (prowess)`, { kind: 'minor', rule: '702.108a' }); }
      if (s.fx.onCast && (!s.fx.onCast.notHand || o.castFrom !== 'hand') && (!s.fx.onCast.fromHand || o.castFrom === 'hand') && (!s.fx.onCast.minPower || this.basePower(o.card) >= s.fx.onCast.minPower) && (s.fx.onCast.what === 'chosen' ? !!s.chosenType && this.isA(o, s.chosenType) : matches[s.fx.onCast.what] ?? this.spellIs(o, s.fx.onCast.what)) && s !== o) this.queue.push({ o: s, effects: s.fx.onCast.effects, label: `${o.card.name} was cast`, p, trig: { o, p: p.idx } });
      if (s.fx.kw.has('extort')) extort++;
    }
    // Extort (702.101): pay {1} per extort permanent to drain each opponent for 1, while there's spare mana
    for (let k = 0; k < extort; k++) {
      const plan = this.availableMana(p) > (p.agent.reserveFor ? p.agent.reserveFor(this, p) : 0) && this.planPayment(p, { generic: 1, pips: [], x: 0 });
      if (!plan) break;
      this.commitPayment(p, plan);
      const opps = this.opponents(p);
      for (const q of opps) { q.life -= 1; this.emit('life', { p: q.idx, d: -1 }); }
      p.life += opps.length; this.emit('life', { p: p.idx, d: opps.length });
      this.log(`${this.pn(p)} extorts: each opponent loses 1 life and ${this.pn(p)} gains ${opps.length}`, { kind: 'minor', rule: '702.101a' });
    }
    this.fire('anyCast', { o, p: p.idx, nth: p.turnSpells?.turn === this.turn ? p.turnSpells.n : 1, from: o.castFrom });
    // Rhystic Study and friends: the caster pays the tax, or the watcher gets the effect
    for (const q of this.opponents(p)) for (const s of q.battlefield) {
      const oc = s.fx.onOppCast;
      if (!oc || (oc.noncreature && t.creature) || (oc.what === 'creature' && !t.creature) || (oc.what === 'instant or sorcery' && !t.instant && !t.sorcery)) continue;
      // Only an opponent's second spell each turn
      if (oc.second && !(p.turnSpells?.turn === this.turn && p.turnSpells.n === 2)) continue;
      // Esper Sentinel: only each player's first such spell each turn
      if (oc.first) { const key = `${this.turn}:${p.idx}`; if (s.firstSeen === key) continue; s.firstSeen = key; }
      // A tax ("unless that player pays {1}") is decided when the trigger resolves (603.3, 117.12)
      const effects = oc.tax ? [{ k: 'tax', tax: oc.tax, payer: p.idx, effects: oc.effects }] : oc.effects;
      this.queue.push({ o: s, effects, label: `${p.name} cast ${o.card.name}`, p: q });
    }
  }
  // Saga chapter abilities trigger as lore counters are added; the saga is sacrificed after the last one
  chapter(o) {
    o.chapterPending = true;
    this.queue.push({ o, kind: 'saga', effects: o.fx.saga[o.lore - 1] || [], label: `chapter ${['I', 'II', 'III', 'IV', 'V', 'VI'][o.lore - 1]}`, p: this.players[o.controller], saga: true });
  }

  // Priority: after a spell is cast, each player in turn order may respond. A response goes on the
  // stack above it and gets its own round (so counter wars and "respond to the response" work), and
  // the round starts over after every response until everyone passes in succession.
  async priority(item) {
    const n = this.players.length;
    // Split second (702.61): nobody can cast spells or activate abilities while it's on the stack
    if (!item.ability && item.o.fx.splitSecond) { this.log(`${this.cn(item.o)} has split second: no responses`, { kind: 'minor', rule: '702.61a' }); return; }
    for (let actions = 0; actions < 8 && !this.over; actions++) {
      let acted = false;
      for (const q of this.order((item.p.idx + 1) % n)) {
        if (item.countered || this.over) break;
        if (q.lost) continue;
        // (Kingdoms: the Wizard may Announce to exile the spell)
        const wiz = this.kingdoms ? K.aiWizard(this, q, item) : null;
        if (wiz) { await K.announce(this, q, wiz); acted = true; break; }
        const r = await (q.agent.respondAt ? q.agent.respondAt(this, q, item) : q.agent.respond(this, q, item));
        if (r?.announce) { await K.announce(this, q, { item }); acted = true; break; }
        if (r) acted = await this.doResponse(q, r, item);
        if (acted) break;
      }
      if (!acted) return;
    }
  }
  async doResponse(q, r, item) {
    if (r.kind === 'cast') return this.cast(q, r.card, { targets: r.targets, response: item });
    if (r.kind === 'sac') return this.sacTo(q, r.outlet, r.victim, ` in response to ${item.o.card.name}`);
    if (r.kind === 'ping') return this.ping(q, r.source, r.targets);
    if (r.kind === 'human') return q.agent.castWithChoices(this, q, r.card, { spellTarget: item, response: item });
    return false;
  }
  tname(t) {
    if (t?.obj) return this.cn(t.obj);
    if (t?.spell) return this.cn(t.spell.o);
    return t?.player != null ? this.pn(this.players[t.player]) : '';
  }

  // Walking Ballista: remove a +1/+1 counter for each ping (an instant-speed ability)
  async ping(p, o, targets) {
    if (o.zone !== 'battlefield' || !o.counters) return false;
    let n = 0;
    for (const t of targets) {
      if (!o.counters || this.over) break;
      o.counters--;
      if (t.obj && t.obj.zone === 'battlefield' && this.canTarget(p, t.obj)) this.damageObj(t.obj, 1, o);
      else if (t.player != null && !this.players[t.player].lost) this.damagePlayer(this.players[t.player], 1, o, false);
      else continue;
      n++;
    }
    if (!n) return false;
    const names = [...new Set(targets.slice(0, n).map(t => this.tname(t)))].join(', ');
    this.log(`${this.pn(p)} removes ${n} counter${n === 1 ? '' : 's'} from ${this.cn(o)} to ping ${names}`, { kind: 'damage', p: p.idx });
    await this.beat(0.6);
    await this.sba();
    return true;
  }

  // Activate a sacrifice outlet: the death triggers fire, then the outlet's own effect
  async sacTo(p, outlet, victim, why = '') {
    const so = outlet.fx.sacOutlet;
    if (!so || outlet.zone !== 'battlefield' || victim.zone !== 'battlefield' || (so.tap && outlet.tapped)) return false;
    if (so.cost) {
      const plan = this.planPayment(p, parseCost(so.cost), 0);
      if (!plan) return false;
      this.commitPayment(p, plan);
    }
    if (so.tap) outlet.tapped = true;
    this.log(`${this.pn(p)} sacrifices ${this.cn(victim)} to ${this.cn(outlet)}${esc(why)}`, { kind: 'removal', p: p.idx });
    this.move(victim, 'graveyard');
    await this.beat(0.6);
    if (so.effects.length) await this.stackAbility(p, outlet, so.effects, so.text);
    await this.sba();
    return true;
  }

  // ---------- combos
  async goOff(p, combo) {
    const st = comboState(this, p, combo);
    if (this.over || !st.ready) return false;
    // Pieces that have to tap are on the battlefield, untapped, without summoning sickness; the board has
    // what the combo needs (Commander Spellbook's prerequisites too)
    const blocked = comboBlocked(this, p, combo, st);
    if (blocked) { this.log(`${this.pn(p)} can't start ${esc(combo.label)} yet: ${esc(blocked)}`, { kind: 'minor', p: p.idx }); return false; }
    if (p.comboTried.turn !== this.turn) p.comboTried = { turn: this.turn, ids: new Set() };
    p.comboTried.ids.add(combo.id);
    this.log(`${this.pn(p)} goes for a combo: ${st.found.map(f => this.cn(f.o)).join(' + ')}`, { kind: 'combo', p: p.idx });
    this.emit('combo', { p, combo, stage: 'start' });
    await this.beat(1.2);

    const key = n => n?.toLowerCase();
    const imprintCard = combo.imprint && st.found.find(f => f.key === key(combo.imprint.card) && f.zone === 'hand');
    const toCast = st.found.filter(f => (f.zone === 'hand' || f.zone === 'command') && f !== imprintCard);
    const isLast = f => f.key === key(combo.last);
    const order = [
      ...toCast.filter(f => f.o.fx.type.permanent && !f.o.fx.type.aura && !isLast(f)),
      ...toCast.filter(f => f.o.fx.type.aura && !isLast(f)),
      ...toCast.filter(f => !f.o.fx.type.permanent && !isLast(f)),
      ...toCast.filter(isLast),
    ];
    for (const [i, f] of order.entries()) {
      const o = f.o;
      // Keep the colors the later pieces need when paying for this one
      const avoid = new Set(order.slice(i + 1).flatMap(r => parseCost(r.o.card.manaCost).pips.flat()));
      const choice = { combo: true, avoid };
      if (combo.x?.[f.name] != null) choice.x = combo.x[f.name];
      if (o.fx.type.aura) choice.auraTarget = st.found.find(x => x !== f && x.o.zone === 'battlefield' && !x.o.fx.type.aura)?.o;
      if (imprintCard && f.key === key(combo.imprint.host)) choice.imprint = imprintCard.o;
      const ok = await this.cast(p, o, choice);
      if (this.over) return true;
      if (!ok) return this.fizzle(p, combo, `${this.pn(p)} can't pay for ${this.cn(o)}`);
      if (choice.item?.countered) return this.fizzle(p, combo, `${this.cn(o)} was countered`);
      if (o.fx.type.permanent && o.zone !== 'battlefield') return this.fizzle(p, combo, `${this.cn(o)} didn't stay on the battlefield`);
    }
    if (combo.mana) {
      const plan = this.planPayment(p, { generic: combo.mana, pips: [], x: 0 });
      if (!plan) return this.fizzle(p, combo, `${this.pn(p)} doesn't have {${combo.mana}} left to start the loop`);
      this.commitPayment(p, plan);
    }

    // The loop starts with a trigger or activation on the stack: last chance for a Stifle-style answer (rule 701.6b)
    const starter = [...st.found].reverse().find(f => f.o.zone === 'battlefield')?.o;
    if (starter) {
      const item = { o: starter, p, x: 0, targets: [], effects: [], ability: true, loopStart: true, combo: true, label: 'starts the loop', countered: false };
      this.stack.push(item);
      this.log(`${this.cn(starter)} — the ability that starts the loop goes on the stack`, { kind: 'minor', rule: '405.1' });
      await this.priority(item);
      this.stack.splice(this.stack.indexOf(item), 1);
      if (this.over) return true;
      if (item.countered) return this.fizzle(p, combo, `the ability that starts the loop was countered`);
    }
    this.log(`The loop begins: ${esc(combo.note)}`, { kind: 'combo', p: p.idx });
    this.emit('combo', { p, combo, stage: 'loop' });
    await this.beat(1.2);
    if (!(await this.playLoop(p, combo, st))) { this.winNote = null; return true; }

    p.stats.combos++;
    this.comboLog.push({ p: p.idx, label: combo.label, landed: true });
    this.log(`Combo!${esc(combo.label)}: nobody can stop it, so the loop repeats as many times as ${this.pn(p)} likes`, { kind: 'combo', p: p.idx });
    this.emit('combo', { p, combo, stage: 'resolve' });
    await this.beat(1.6);
    await this.comboResult(p, combo, st);
    await this.sba();
    this.winNote = null;
    return true;
  }

  // The first few iterations are played one at a time; between them every opponent gets priority
  // and can break the loop with instant-speed removal (the controller may protect the piece).
  async playLoop(p, combo, st) {
    const pieces = () => st.found.filter(f => f.o.fx.type.permanent && f.zone !== 'imprinted').map(f => f.o);
    const steps = combo.result === 'win' ? 1 : 3;
    for (let i = 1; i <= steps; i++) {
      const gone = pieces().find(o => o.zone !== 'battlefield');
      if (gone) { this.fizzle(p, combo, `${this.cn(gone)} left the battlefield after ${i - 1} iteration${i === 2 ? '' : 's'}`); return false; }
      await this.loopStep(p, combo, st, i);
      await this.sba();
      if (this.over || p.lost) return false;
      if (combo.result === 'win') break;
      for (const q of this.order(p.idx)) {
        if (q === p || q.lost) continue;
        const r = await q.agent.respondToLoop(this, q, p, pieces().filter(o => o.zone === 'battlefield'), combo);
        if (!r) continue;
        await this.cast(q, r.card, { targets: r.targets });
        if (this.over) return false;
        const broken = pieces().find(o => o.zone !== 'battlefield');
        if (broken) { this.fizzle(p, combo, `${this.pn(q)} broke the loop by removing ${this.cn(broken)}`); return false; }
      }
    }
    return true;
  }

  async loopStep(p, combo, st, i) {
    const opps = this.opponents(p);
    const onBf = st.found.filter(f => f.o.zone === 'battlefield').map(f => f.o);
    const src = [...onBf].reverse().find(o => o.fx.type.creature) || onBf[0] || st.found[0].o;
    const tag = `Loop ${i}:`;
    switch (combo.result) {
      case 'damage': {
        const q = opps[(i - 1) % opps.length];
        this.damagePlayer(q, 1, src, false);
        this.log(`${tag} ${this.cn(src)} deals 1 damage to ${this.pn(q)}`, { kind: 'damage' });
        break;
      }
      case 'drain':
        for (const q of opps) { q.life -= 1; q.grudge[p.idx] += 1; this.emit('life', { p: q.idx, d: -1 }); }
        p.life += opps.length; this.emit('life', { p: p.idx, d: opps.length });
        this.log(`${tag} each opponent loses 1 life and ${this.pn(p)} gains ${opps.length}`, { kind: 'damage' });
        break;
      case 'attack': {
        const model = [...st.found].reverse().find(f => f.o.zone === 'battlefield' && f.o.fx.type.creature && !f.o.fx.type.legendary)?.o || src;
        this.createCopy(p, model);
        this.log(`${tag} ${this.pn(p)} creates a hasty token copy of ${this.cn(model)}`, { kind: 'minor' });
        break;
      }
      case 'mill': {
        const q = combo.millOne ? opps.sort((a, b) => this.threatOf(p, b) - this.threatOf(p, a))[0] : opps[(i - 1) % opps.length];
        const n = Math.min(q.library.length, combo.millOne ? 2 : 5);
        for (const o of q.library.splice(q.library.length - n, n)) { o.zone = 'graveyard'; q.graveyard.push(o); }
        this.log(`${tag} ${this.pn(q)} mills ${n} cards`, { kind: 'minor' });
        break;
      }
      case 'mana':
        p.pool.push({ colors: ['C'] });
        this.log(`${tag} ${this.pn(p)} nets one more mana`, { kind: 'minor' });
        break;
      case 'win': {
        const n = p.library.length;
        for (const o of p.library.splice(0)) { o.zone = 'exile'; p.exile.push(o); }
        this.log(`${this.pn(p)} exiles their library (${n} cards); with no cards left, the win condition is met`, { kind: 'combo' });
        break;
      }
      default: break;
    }
    await this.beat(0.9);
  }

  fizzle(p, combo, why) {
    this.comboLog.push({ p: p.idx, label: combo.label, landed: false });
    this.log(`The combo fizzles: ${why}`, { kind: 'combo', p: p.idx });
    this.emit('combo', { p, combo, stage: 'fizzle' });
    return true;
  }

  async comboResult(p, combo, st) {
    // (Kingdoms, rules 5: damage, drain and attack combos spare known allies, item 115)
    const opps = this.opponents(p).filter(q => !(['damage', 'drain', 'attack'].includes(combo.result) && K.comboSpares(this, p, q)));
    const onBf = st.found.filter(f => f.o.zone === 'battlefield').map(f => f.o);
    const src = [...onBf].reverse().find(o => o.fx.type.creature) || onBf[0] || st.found[0].o;
    this.winNote = `${combo.label} (${RESULT_TEXT[combo.result]})`;
    switch (combo.result) {
      case 'win':
        for (const q of opps) this.lose(q, `${p.name} won with ${combo.label}`, '104.2b');
        break;
      case 'attack': {
        const model = [...st.found].reverse().find(f => f.o.zone === 'battlefield' && f.o.fx.type.creature && !f.o.fx.type.legendary)?.o || src;
        for (let k = 0; k < 2; k++) this.createCopy(p, model);
        this.log(`${this.pn(p)} makes an endless stream of hasty ${this.cn(model)} copies and attacks everyone`, { kind: 'combat', rule: '508.1' });
        await this.beat(1.2);
        for (const q of opps) this.damagePlayer(q, Math.max(1, q.life), src, false);
        this.log(`Each opponent takes lethal combat damage`, { kind: 'damage', rule: '510.2' });
        break;
      }
      case 'damage':
        for (const q of opps) this.damagePlayer(q, Math.max(1, q.life), src, false);
        this.log(`${this.cn(src)} deals damage to each opponent until they're dead`, { kind: 'damage', rule: '120.3a' });
        break;
      case 'drain':
        for (const q of opps) { const n = Math.max(1, q.life); q.life -= n; p.life += n; q.grudge[p.idx] += n; this.emit('life', { p: q.idx, d: -n }); }
        this.log(`Each opponent loses life over and over; ${this.pn(p)} gains it all`, { kind: 'damage', rule: '119.3' });
        break;
      case 'mill': {
        const targets = combo.millOne ? [opps.sort((a, b) => this.threatOf(p, b) - this.threatOf(p, a))[0]] : opps;
        for (const q of targets) {
          const n = q.library.length;
          for (const o of q.library.splice(0)) { o.zone = 'graveyard'; q.graveyard.push(o); }
          this.log(`${this.pn(q)} mills their entire library (${n} cards) and will lose on their next draw`, { kind: 'removal', rule: '704.5b' });
        }
        this.winNote = null;
        break;
      }
      case 'mana': {
        p.infiniteMana = this.turn;
        this.log(`${this.pn(p)} has unbounded mana for the rest of the turn`, { kind: 'combo' });
        // The usual ways to turn unbounded mana into a win, played out for real: the finisher is cast
        // (on the stack, so it can be countered) or activated, and a tutor in hand can find it first
        this.winNote = null;
        const won = await this.manaFinish(p, combo);
        if (won) this.winNote = `${combo.label} (infinite mana, then ${won})`;
        break;
      }
      default: break;
    }
  }
  // Is there anything to do with unbounded mana? (the AI holds an infinite-mana combo until there is)
  manaOutlet(p) {
    const has = (name, zones) => zones.some(z => p[z].some(o => o.card.name === name));
    if (has('Walking Ballista', ['hand', 'command', 'battlefield'])) return true;
    const finds = (card, e) => e.k === 'tutor' && !e.bf && !e.top && !e.gy && (!e.types?.length || e.types.some(t => card.fx.type[t]));
    const wb = p.library.find(o => o.card.name === 'Walking Ballista');
    if (wb && (p.hand.some(o => !o.fx.type.land && [...o.fx.spell, ...o.fx.etb].some(e => finds(wb, e))) || p.battlefield.some(o => this.abilitiesOf(o).some(ab => (ab.effects || []).some(e => finds(wb, e)))))) return true;
    if (p.battlefield.some(o => o.card.name === 'Thrasios, Triton Hero') && has("Thassa's Oracle", ['hand', 'library'])) return true;
    // (or a hand of expensive or X spells worth casting all at once)
    return p.hand.filter(o => !o.fx.type.land && ((o.card.cmc || 0) >= 6 || /\{X\}/.test(o.card.manaCost || ''))).length >= 2;
  }
  // Unbounded mana into a win: Walking Ballista (cast for a huge X, or pumped with its {4} ability if it's
  // already out, then it pings everyone), or Thrasios drawing the library into Thassa's Oracle. A tutor in
  // hand finds the missing piece first. Every step uses the stack, so opponents can still answer.
  async manaFinish(p, combo) {
    const find = (name, zones = ['hand', 'command', 'battlefield']) => zones.flatMap(z => p[z]).find(o => o.card.name === name);
    const opps = () => this.opponents(p);
    const lethal = () => opps().reduce((s, q) => s + Math.max(1, q.life), 0);
    // A tutor in hand that can find a finisher in the library (Gamble, Enlightened Tutor, Demonic Tutor…)
    const fetch = async name => {
      const card = p.library.find(o => o.card.name === name);
      if (!card) return null;
      // (a tutor that puts it into the hand: one onto the battlefield would bring Ballista in with no counters)
      const finds = e => e.k === 'tutor' && !e.bf && !e.top && !e.gy && (!e.types?.length || e.types.some(t => card.fx.type[t]));
      const tutor = p.hand.find(o => !o.fx.type.land && this.canCast(p, o) && [...o.fx.spell, ...o.fx.etb].some(finds));
      // …or an activated one on the battlefield (Survival of the Fittest)
      const engineCard = !tutor && p.battlefield.find(o => this.abilitiesOf(o).some(ab => (ab.effects || []).some(finds) && this.canActivate(p, o, ab)));
      if (!tutor && !engineCard) return null;
      p.tutorWant = name;
      try {
        if (tutor) { this.log(`${this.pn(p)} casts ${this.cn(tutor)} to find ${this.cn(card)}`, { kind: 'combo' }); await this.cast(p, tutor); }
        else { const ab = this.abilitiesOf(engineCard).find(a => (a.effects || []).some(finds) && this.canActivate(p, engineCard, a)); this.log(`${this.pn(p)} uses ${this.cn(engineCard)} to find ${this.cn(card)}`, { kind: 'combo' }); await this.activate(p, engineCard, ab); }
      } finally { p.tutorWant = null; }
      return find(name);
    };
    // Walking Ballista
    let wb = find('Walking Ballista') || (await fetch('Walking Ballista'));
    if (wb && !this.over) {
      const need = lethal();
      if (wb.zone !== 'battlefield') {
        const choice = { combo: true, x: need };
        const ok = await this.cast(p, wb, choice);
        if (this.over) return 'Walking Ballista';
        if (!ok || choice.item?.countered || wb.zone !== 'battlefield') { this.log(`The finisher didn't land: ${this.cn(wb)} ${choice.item?.countered ? 'was countered' : "didn't stay on the battlefield"}`, { kind: 'combo' }); return null; }
      } else {
        // (the {4} counter ability, over and over with unbounded mana)
        wb.counters += need;
        this.log(`${this.pn(p)} activates ${this.cn(wb)}'s counter ability ${need} times with the unbounded mana (${wb.counters} counters)`, { kind: 'combo' });
      }
      await this.sba();
      const targets = opps().flatMap(q => Array(Math.max(1, q.life)).fill({ player: q.idx }));
      if (wb.zone === 'battlefield' && targets.length) await this.ping(p, wb, targets.slice(0, wb.counters));
      await this.sba();
      return 'Walking Ballista';
    }
    // Thrasios draws the whole library, then Thassa's Oracle is cast with no cards left
    const thrasios = p.battlefield.find(o => o.card.name === 'Thrasios, Triton Hero');
    const oracleAnywhere = find("Thassa's Oracle", ['hand', 'library']);
    if (thrasios && oracleAnywhere) {
      const n = p.library.length;
      for (const o of p.library.splice(0)) { o.zone = 'hand'; p.hand.push(o); }
      this.log(`${this.cn(thrasios)} digs through the whole library (${n} cards) with the unbounded mana`, { kind: 'combo' });
      const oracle = p.hand.find(o => o.card.name === "Thassa's Oracle");
      const choice = { combo: true };
      await this.cast(p, oracle, choice);
      await this.sba();
      return this.over ? "Thassa's Oracle" : null;
    }
    return null;
  }
  threatOf(p, q) { return p.agent.threat(this, p, q); }

  createCopy(p, model, haste = true) {
    const card = { ...model.card, isToken: true };
    const o = this.mk(card, p, { token: true });
    o.zone = 'battlefield'; o.sick = !haste; o.tempKw = haste ? new Set(['haste']) : null;
    p.battlefield.push(o);
    this.entered(o);
    return o;
  }

  // Puresteel Paladin: equip {0} (with metalcraft)
  equipCost(p, eq) {
    const free = p.battlefield.some(s => s.fx.freeEquip != null && p.battlefield.filter(x => x.fx.type.artifact).length >= s.fx.freeEquip);
    return free ? parseCost('{0}') : this.reducedEquip(p, eq, parseCost(eq.fx.equip));
  }
  async equip(p, eq, target) {
    const plan = this.planPayment(p, this.equipCost(p, eq), 0);
    if (!plan) return false;
    if (target === eq || (eq.fx.reconfigure && this.rules < 5)) return false;
    this.commitPayment(p, plan);
    eq.attachedTo = target;
    // Reconfigure (702.151): an equipment creature stops being a creature while it's attached
    if (eq.fx.reconfigure && eq.fx.type.creature && this.rules >= 5) {
      eq.reconfigured = true;
      eq.fx = { ...eq.card.fx, type: { ...eq.card.fx.type, creature: false } };
      Object.assign(eq, { attacking: null, blocking: null, blockedBy: [], blocked: false });
      // (equipment on it falls off, now that it isn't a creature: 704.5n)
      for (const x of this.players[eq.controller].battlefield) if (x.attachedTo === eq && x.fx.type.equipment) x.attachedTo = null;
    }
    this.log(`${this.pn(p)} ${eq.reconfigured ? 'reconfigures' : 'equips'} ${this.cn(eq)} ${eq.reconfigured ? 'onto' : 'to'} ${this.cn(target)}`, { kind: 'minor' });
    await this.beat(0.7);
    return true;
  }

  async activatePW(p, pw, ab) {
    pw.loyalty += ab.cost;
    pw.usedPW = true;
    this.log(`${this.pn(p)} activates ${this.cn(pw)} [${ab.cost > 0 ? '+' : ''}${ab.cost}]`, { kind: 'cast', p: p.idx });
    await this.beat(0.6);
    await this.stackAbility(p, pw, ab.effects, ab.text);
    await this.sba();
  }

  // The non-mana parts of a cost, and what could pay each (602.2b: costs are paid in full or not at all)
  costPools(p, o, c, spell = null) {
    const t = c.discard?.types || [];
    return {
      discard: p.hand.filter(x => x !== o && x !== spell && (!t.length || t.some(k => x.fx.type[k]))),
      sac: c.sac ? p.battlefield.filter(x => (x !== o || !c.sac.other) && this.spellIs(x, c.sac.what)) : [],
      untapOthers: c.untapOthers ? p.battlefield.filter(x => x !== o && x.tapped && this.isA(x, c.untapOthers.what)) : [],
      exileOwn: c.exileOwn ? p.battlefield.filter(x => x !== o && this.isA(x, c.exileOwn.what)) : [],
      removeAny: c.removeAny ? p.battlefield.filter(x => x.counters > 0 || (x.named && Object.values(x.named).some(v => v > 0))) : [],
      exileGy: p.graveyard.filter(x => x !== o),
      // Tapping other permanents as a cost isn't limited by summoning sickness (302.6 is only about {T})
      tapOthers: c.tapOthers ? p.battlefield.filter(x => x !== o && !x.tapped && this.isA(x, c.tapOthers.what)) : [],
      bounce: c.bounce ? p.battlefield.filter(x => this.isA(x, c.bounce.what)) : [],
    };
  }
  canPayCosts(p, o, c, spell = null) {
    if (!c) return true;
    const pool = this.costPools(p, o, c, spell);
    if (c.life && p.life <= c.life) return false;
    if (c.discard && pool.discard.length < c.discard.n) return false;
    if (c.sac && pool.sac.length < c.sac.n) return false;
    if (c.exileGy && pool.exileGy.length < c.exileGy) return false;
    if (c.tapOthers && pool.tapOthers.length < c.tapOthers.n) return false;
    if (c.removeCounters && o.counters < c.removeCounters) return false;
    if (c.removeNamed && Math.max(o.named?.[c.removeNamed.kind] || 0, o.counters) < c.removeNamed.n) return false;
    // {Q} (untap this permanent, Pili-Pala): it has to be tapped, and like {T} it needs no summoning sickness
    if (c.untapSelf && (!o.tapped || o.zone !== 'battlefield' || !this.canTapNow(p, o))) return false;
    if (c.bounce && !pool.bounce.length) return false;
    if ((c.sacSelf || c.exileSelf || c.removeCounters || c.removeNamed || c.bounceSelf) && o.zone !== 'battlefield') return false;
    if (c.mill && p.library.length < c.mill) return false;
    if (c.untapOthers && pool.untapOthers.length < c.untapOthers.n) return false;
    if (c.exileOwn && !pool.exileOwn.length) return false;
    if (c.removeAny && pool.removeAny.reduce((s, x) => s + Math.max(0, x.counters) + Object.values(x.named || {}).reduce((a, v) => a + Math.max(0, v), 0), 0) < c.removeAny) return false;
    if (c.forage && p.graveyard.filter(x => x !== o).length < 3 && !p.battlefield.some(x => x.card.name === 'Food')) return false;
    if (c.energy && (p.energy || 0) < c.energy) return false;
    if (c.exert && o.exerted) return false;
    return true;
  }
  // Whether p could activate this ability of o right now (tap symbol, mana and every other cost)
  canActivate(p, o, ab) {
    const prev = this.payingFor;
    this.payingFor = { o, ability: true };
    try { return this.canActivateRaw(p, o, ab); } finally { this.payingFor = prev; }
  }
  canActivateRaw(p, o, ab) {
    if (ab.tap && (o.tapped || !this.canTapNow(p, o))) return false;
    if (ab.gate && !this.gateOk(o, ab.gate)) return false;
    if (ab.levelTo && (o.level || 1) !== ab.levelTo - 1) return false;
    if (this.abilityLocked(p, o)) return false;
    if (!this.canPayCosts(p, o, ab.costs || { life: ab.life || 0, discard: ab.discard ? { n: ab.discard, types: [] } : null })) return false;
    // (creatures tapped for a "tap an untapped creature" cost can't also pay mana)
    return !!this.planPayment(p, this.abilityCost(p, o, ab), 0, ab.tap ? o : null);
  }
  // Training Grounds, Biomancer's Familiar: activated abilities cost less (never below one mana)
  // Zirda, the Dawnwaker: every ability you activate that isn't a mana ability. Power Artifact: the
  // enchanted artifact's abilities.
  abilityCost(p, o, ab) {
    const c = parseCost(ab.cost);
    const before = c.generic + c.pips.length;
    const manaAbility = (ab.effects || []).some(e => e.k === 'addMana');
    for (const s of p.battlefield) {
      const r = s.fx.abilityReduce;
      if (r && (!r.nonMana || !manaAbility) && (r.what === 'any' || this.spellIs(o, r.what))) c.generic = Math.max(0, c.generic - r.n);
    }
    for (const a of this.attachments(o)) if (a.fx.attachReduce && !manaAbility) c.generic = Math.max(0, c.generic - a.fx.attachReduce);
    if (before > 0 && c.generic + c.pips.length < 1) c.generic = 1;
    return c;
  }
  // (equip is an activated ability too: Zirda makes it cheaper)
  reducedEquip(p, eq, c) {
    const before = c.generic + c.pips.length;
    for (const s of p.battlefield) if (s.fx.abilityReduce?.what === 'any') c.generic = Math.max(0, c.generic - s.fx.abilityReduce.n);
    if (before > 0 && c.generic + c.pips.length < 1) c.generic = 1;
    return c;
  }
  // Linvala, Collector Ouphe, Karn: some activated abilities can't be activated
  abilityLocked(p, o) {
    for (const q of this.alive()) for (const s of q.battlefield) {
      const l = s.fx.abilityLock;
      if (!l || (l.opp && q.idx === p.idx)) continue;
      const kinds = { creatures: o.fx.type.creature, artifacts: o.fx.type.artifact, 'artifacts and creatures': o.fx.type.artifact || o.fx.type.creature, 'nonland permanents': !o.fx.type.land, 'artifacts, creatures, and enchantments': o.fx.type.artifact || o.fx.type.creature || o.fx.type.enchantment };
      if (kinds[l.what]) return true;
    }
    return false;
  }
  // Pay the non-mana costs; choices go to the player (a human seat is asked, the AI gives up its least useful)
  async payCosts(p, o, c, spell = null) {
    if (!c) return;
    const pool = this.costPools(p, o, c, spell);
    const worst = (cards, n, text) => (p.agent.chooseCostAsync ? p.agent.chooseCostAsync(this, p, cards, n, text)
      : Promise.resolve([...cards].sort((a, b) => keep(a) - keep(b)).slice(0, n)));
    const keep = x => p.agent.value(this, x) * (x.token ? 0.5 : 1) + p.agent.pieceWorth(this, p, x) + (x.isCommander ? 8 : 0);
    const why = ` to pay for ${this.cn(spell || o)}`;
    if (c.life) { p.life -= c.life; this.emit('life', { p: p.idx, d: -c.life }); this.log(`${this.pn(p)} pays ${c.life} life${why}`, { kind: 'minor' }); }
    if (c.tapOthers) {
      // (station taps the strongest creature: its power becomes charge counters)
      const ts = c.stationTap ? [...pool.tapOthers].filter(x => x.fx.type.creature).sort((a, b) => this.power(b) - this.power(a)).slice(0, 1)
        : await worst(pool.tapOthers, c.tapOthers.n, `Tap ${c.tapOthers.n} untapped ${c.tapOthers.what}${c.tapOthers.n > 1 ? 's' : ''}${why}`);
      p.lastTapPower = ts.reduce((s, x) => s + Math.max(0, this.power(x)), 0);
      for (const x of ts) x.tapped = true;
      this.log(`${this.pn(p)} taps ${ts.map(x => this.cn(x)).join(', ')}${why}`, { kind: 'minor' });
    }
    if (c.discardHand) this.discard(p, p.hand.filter(x => x !== spell), why);
    if (c.discard) {
      const n = c.discard.n;
      let cards;
      if (pool.discard.length <= n) cards = pool.discard.slice(0, n);
      else if (c.discard.types.length) cards = await worst(pool.discard, n, `Discard ${n} ${c.discard.types.join(' or ')} card${n > 1 ? 's' : ''}${why}`);
      else cards = ((await p.agent.chooseDiscard(this, p, n)) || []).filter(x => pool.discard.includes(x));
      if (cards.length < n) cards = [...cards, ...pool.discard.filter(x => !cards.includes(x))].slice(0, n);
      this.discard(p, cards, why);
    }
    if (c.exileGy) {
      const xs = [...pool.exileGy].sort((a, b) => p.agent.value(this, a) - p.agent.value(this, b)).slice(0, c.exileGy);
      for (const x of xs) this.move(x, 'exile');
      this.log(`${this.pn(p)} exiles ${xs.length} card${xs.length === 1 ? '' : 's'} from their graveyard${why}`, { kind: 'minor' });
    }
    if (c.removeCounters) o.counters -= c.removeCounters;
    // (named counters, or +1/+1-style ones where the engine keeps that kind as plain counters)
    if (c.removeNamed) { const k = c.removeNamed.kind; if ((o.named?.[k] || 0) >= c.removeNamed.n) o.named[k] -= c.removeNamed.n; else o.counters -= c.removeNamed.n; }
    if (c.bounce) { const [x] = await worst(pool.bounce, 1, `Return a ${c.bounce.what} to your hand${why}`); if (x) { this.move(x, 'hand'); this.log(`${this.pn(p)} returns ${this.cn(x)} to hand${why}`, { kind: 'minor' }); } }
    if (c.sac) for (const x of await worst(pool.sac, c.sac.n, `Sacrifice ${c.sac.n > 1 ? c.sac.n : 'a'} ${c.sac.what}${why}`)) this.sacrifice(p, x, why);
    if (c.sacSelf && o.zone === 'battlefield') this.sacrifice(p, o, ' as a cost');
    if (c.bounceSelf && o.zone === 'battlefield') { this.move(o, 'hand'); this.log(`${this.pn(p)} returns ${this.cn(o)} to hand as a cost`, { kind: 'minor' }); }
    if (c.exileSelf && o.zone === 'battlefield') { this.move(o, 'exile'); this.log(`${this.pn(p)} exiles ${this.cn(o)} as a cost`, { kind: 'minor' }); }
    // ---- 1.6.0 costs
    if (c.mill) { for (let k = 0; k < c.mill && p.library.length; k++) this.move(p.library[p.library.length - 1], 'graveyard'); this.log(`${this.pn(p)} mills ${c.mill}${why}`, { kind: 'minor' }); }
    if (c.untapOthers) {
      const us = [...pool.untapOthers].sort((a, b) => this.power(a) - this.power(b)).slice(0, c.untapOthers.n);
      for (const x of us) x.tapped = false;
      this.log(`${this.pn(p)} untaps ${us.map(x => this.cn(x)).join(', ')}${why}`, { kind: 'minor' });
    }
    if (c.exert) { o.exerted = true; this.log(`${this.pn(p)} exerts ${this.cn(o)}`, { kind: 'minor', rule: '701.43a' }); }
    if (c.untapSelf && o.zone === 'battlefield') o.tapped = false;
    if (c.minusSelf && o.zone === 'battlefield') {
      // Vizier of Remedies: one fewer -1/-1 counter on creatures you control
      const n = this.players[o.controller].battlefield.some(s => s.fx.minusLess) && o.fx.type.creature ? c.minusSelf - 1 : c.minusSelf;
      if (n > 0) { o.counters -= n; o.hadMinus = true; }
      else this.log(`${this.cn(o)} gets no -1/-1 counter (Vizier of Remedies)`, { kind: 'minor' });
    }
    if (c.exileOwn) { const [x] = await worst(pool.exileOwn, 1, `Exile a ${c.exileOwn.what}${why}`); if (x) { p.lastExiledMv = x.card.cmc || 0; this.move(x, 'exile'); this.log(`${this.pn(p)} exiles ${this.cn(x)}${why}`, { kind: 'minor' }); } }
    if (c.removeAny) {
      let left = c.removeAny;
      for (const x of pool.removeAny.sort((a, b) => p.agent.value(this, a) - p.agent.value(this, b))) {
        while (left > 0 && x.counters > 0) { x.counters--; left--; }
        for (const k of Object.keys(x.named || {})) while (left > 0 && x.named[k] > 0) { x.named[k]--; left--; }
        if (!left) break;
      }
    }
    if (c.forage) {
      const gy = p.graveyard.filter(x => x !== o);
      if (gy.length >= 3) { for (const x of [...gy].sort((a, b) => p.agent.value(this, a) - p.agent.value(this, b)).slice(0, 3)) this.move(x, 'exile'); this.log(`${this.pn(p)} forages (exiles three cards from their graveyard)`, { kind: 'minor' }); }
      else { const f = p.battlefield.find(x => x.card.name === 'Food'); if (f) this.sacrifice(p, f, ' (forage)'); }
    }
    if (c.energy) p.energy -= c.energy;
  }
  // ---------- the other face: adventures (715) and modal double-faced cards (712)
  // The card takes its other face's characteristics while on the stack (and, for a modal double-faced card, on
  // the battlefield); it turns back as it leaves (leaveBattlefield restores baseCard, move() the stack).
  useFace(o, face) {
    if (!o.baseCard) o.baseCard = o.card;
    o.card = face; o.fx = face.fx; o.altFaceOn = true;
  }
  mainFace(o) {
    if (!o.altFaceOn) return;
    if (o.baseCard) { o.card = o.baseCard; o.fx = o.baseCard.fx; o.baseCard = null; }
    o.altFaceOn = false;
  }
  // The face that can be cast instead of the front from the hand (an adventure, or an MDFC's spell back), if castable now
  // (a split card's second half with aftermath is cast only from the graveyard, and exiled after: 702.127)
  aftermath(o) { return o.card.layout === 'split' && /^aftermath\b/im.test(o.card.altFace?.text || ''); }
  faceCastMode(p, o) {
    const f = o.card.altFace;
    if (!f || this.rules < 5 || o.altFaceOn || f.fx.type.land) return null;
    if (o.zone !== (this.aftermath(o) ? 'graveyard' : 'hand') || (o.zone === 'graveyard' && o.owner !== p.idx)) return null;
    this.useFace(o, f);
    // (from the graveyard, aftermath is its permission: the half's own cost, at its own timing)
    try {
      if (o.zone === 'graveyard') {
        if (this.silenced[p.idx] === this.turn) return null;
        const timing = f.fx.type.instant || (this.active === p.idx && (this.phase === 'main1' || this.phase === 'main2') && !this.stack.length);
        return timing && this.planPayment(p, parseCost(f.manaCost), 0) ? { alt: 'aftermath' } : null;
      }
      return this.castMode(p, o);
    } finally { this.mainFace(o); }
  }
  async castFace(p, o) {
    const mode = this.faceCastMode(p, o);
    if (!mode) return false;
    const fromGy = o.zone === 'graveyard';
    this.useFace(o, o.card.altFace);
    o.onAdventure = o.baseCard.layout === 'adventure';
    o.castAftermath = fromGy;
    const ok = await this.cast(p, o, { mode });
    o.castAftermath = false;
    if (!ok && (o.zone === 'hand' || o.zone === 'graveyard')) { this.mainFace(o); o.onAdventure = false; }
    return ok;
  }
  canCleave(p, o) {
    return !!o.fx.cleave && !!o.fx.cleaveSpell?.length && this.rules >= 5 && o.zone === 'hand' && this.silenced[p.idx] !== this.turn && !this.spellCapped(p, o)
      && (o.fx.type.instant || this.has(o, 'flash') || (this.active === p.idx && (this.phase === 'main1' || this.phase === 'main2') && !this.stack.length))
      && !!this.planPayment(p, parseCost(o.fx.cleave), 0);
  }
  // Fuse: both halves of a split card from the hand, paying both costs
  canFuse(p, o) {
    const f = o.card.altFace;
    return !!f && this.rules >= 5 && o.zone === 'hand' && o.card.layout === 'split' && /^fuse\b/im.test(o.card.text || '') && !this.aftermath(o)
      && this.silenced[p.idx] !== this.turn && (o.fx.type.instant || (this.active === p.idx && (this.phase === 'main1' || this.phase === 'main2') && !this.stack.length))
      && !!this.planPayment(p, this.altCost(o, 'fuse'), 0);
  }
  // A modal double-faced card whose back is a land: played as that land (uses the land drop)
  canPlayBackLand(p, o) {
    const f = o.card.altFace;
    return !!f && this.rules >= 5 && o.card.layout === 'modal_dfc' && f.fx.type.land && !o.fx.type.land && o.zone === 'hand' && p.landsPlayed < this.landDrops(p);
  }
  // ---------- bestow (702.103) and mutate (702.140): other ways to cast a creature card from hand
  // (both at the creature's own timing, for their own cost, and only with something to enchant or merge onto)
  creatureTiming(p, o) {
    return this.has(o, 'flash') || o.fx.kw.has('flash') || (this.active === p.idx && (this.phase === 'main1' || this.phase === 'main2') && !this.stack.length);
  }
  canBestow(p, o) {
    return !!o.fx.bestow && this.rules >= 5 && o.zone === 'hand' && !o.faceDown && this.silenced[p.idx] !== this.turn && !this.spellCapped(p, o)
      && this.creatureTiming(p, o) && this.alive().some(q => q.battlefield.some(x => x.fx.type.creature && this.canTarget(p, x)))
      && !!this.planPayment(p, parseCost(o.fx.bestow), 0);
  }
  bestowFx(o) { return { ...o.card.fx, type: { ...o.card.fx.type, creature: false, aura: true } }; }
  // A bestowed Aura that's no longer attached becomes an enchantment creature again (702.103e)
  unbestow(o) {
    if (!o.bestowed) return;
    o.bestowed = false; o.fx = o.card.fx; o.attachedTo = null;
    if (o.zone === 'battlefield') this.log(`${this.cn(o)} is no longer attached: it's a creature again`, { kind: 'minor', rule: '702.103e' });
  }
  mutateTargets(p, o) {
    return p.battlefield.filter(x => x.fx.type.creature && x.owner === o.owner && !x.fx.subtypes.includes('human') && !x.faceDown && this.canTarget(p, x));
  }
  canMutate(p, o) {
    return !!o.fx.mutate && this.rules >= 5 && o.zone === 'hand' && this.silenced[p.idx] !== this.turn && !this.spellCapped(p, o)
      && this.creatureTiming(p, o) && this.mutateTargets(p, o).length > 0 && !!this.planPayment(p, parseCost(o.fx.mutate), 0);
  }
  // The merged permanent has the top card's characteristics and every card's abilities (702.140c, e)
  mergeFx(cards) {
    const top = cards[0].fx;
    const out = { ...top, kw: new Set(cards.flatMap(c => [...c.fx.kw])), kwN: Object.assign({}, ...cards.map(c => c.fx.kwN || {}).reverse()) };
    for (const k of ['abilities', 'attack', 'dies', 'upkeep', 'endstep', 'combatDamage', 'landfall', 'watch', 'pw']) out[k] = cards.flatMap(c => c.fx[k] || []);
    out.onMutate = cards.flatMap(c => c.fx.onMutate || []);
    return out;
  }
  mergeOnto(p, m, host) {
    this.log(`${this.cn(m)} mutates onto ${this.cn(host)}`, { kind: 'cast', p: p.idx, rule: '702.140c' });
    host.mutBase ||= host.card;
    (host.merged ||= []).push(m);
    // (the mutating card goes on top, and the merged permanent takes its name, cost and power/toughness)
    m.zone = 'merged';
    host.mergeCards = [m.card, ...(host.mergeCards || [host.card])];
    const top = { ...m.card, fx: this.mergeFx(host.mergeCards) };
    host.card = top; host.fx = top.fx;
    const trig = host.mergeCards.flatMap(c => c.fx.onMutate || []);
    if (trig.length) this.queue.push({ o: host, effects: trig, label: 'mutates', p });
    this.emit('update');
  }
  // When a merged permanent leaves, every card in it goes to the same zone (721.3 / 702.140f)
  unmerge(o, to) {
    if (!o.mutBase) return;
    const under = o.merged || [];
    o.card = o.mutBase; o.fx = o.mutBase.fx;
    o.mutBase = null; o.merged = null; o.mergeCards = null;
    for (const u of under) { u.zone = 'merged-left'; this.move(u, to === 'battlefield' ? 'graveyard' : to); }
  }
  // Enlist (702.154): as each enlisting creature attacks, tap a creature of yours that isn't attacking and has no
  // summoning sickness; the attacker gets its power until end of turn
  async enlist(p, decl) {
    for (const d of decl) {
      if (!d.o.fx.enlist) continue;
      const pool = p.battlefield.filter(x => x !== d.o && x.fx.type.creature && !x.tapped && x.attacking == null && (!x.sick || this.has(x, 'haste')) && this.power(x) > 0);
      if (!pool.length) continue;
      const pick = await (p.agent.chooseEnlistAsync ? p.agent.chooseEnlistAsync(this, p, d.o, pool) : p.agent.chooseEnlist(this, p, d.o, pool));
      if (!pick || !pool.includes(pick)) continue;
      pick.tapped = true;
      d.o.tempP += this.power(pick);
      this.log(`${this.pn(p)} enlists ${this.cn(pick)}: ${this.cn(d.o)} gets +${this.power(pick)}/+0`, { kind: 'combat', rule: '702.154a' });
    }
  }
  // ---------- Rooms (709.5): a split card cast one door at a time; the other door is unlocked later for its cost
  isRoom(o) { return /\broom\b/i.test((o.baseCard || o.card).typeLine || '') && (o.baseCard || o.card).layout === 'split'; }
  lockedDoor(o) {
    if (!this.isRoom(o) || o.roomUnlocked || o.zone !== 'battlefield') return null;
    const main = o.baseCard || o.card;
    return o.altFaceOn ? main : main.altFace;
  }
  canUnlock(p, o) {
    const d = this.lockedDoor(o);
    return !!d && this.rules >= 5 && o.controller === p.idx && this.active === p.idx && (this.phase === 'main1' || this.phase === 'main2') && !this.stack.length && !!this.planPayment(p, parseCost(d.manaCost), 0);
  }
  async unlockRoom(p, o) {
    if (!this.canUnlock(p, o)) return false;
    const door = this.lockedDoor(o), open = o.card;
    this.commitPayment(p, this.planPayment(p, parseCost(door.manaCost), 0));
    // (both doors' abilities apply once it's fully unlocked)
    const fx = { ...open.fx };
    for (const [k, v] of Object.entries(door.fx)) {
      if (Array.isArray(v)) fx[k] = [...(fx[k] || []), ...v];
      else if (v instanceof Set) fx[k] = new Set([...(fx[k] || []), ...v]);
      else if (fx[k] == null || fx[k] === false || fx[k] === 0) fx[k] = v;
    }
    o.fx = fx;
    o.roomUnlocked = true;
    this.log(`${this.pn(p)} pays ${door.manaCost} and unlocks ${esc(door.name)}`, { kind: 'cast', p: p.idx, rule: '709.5' });
    if (door.fx.onUnlock?.length) this.queue.push({ o, effects: door.fx.onUnlock, label: `unlocked ${door.name}`, p });
    this.emit('update');
    await this.sba();
    return true;
  }
  // ---------- battles (310)
  battleEnters(o) {
    const ctl = this.players[o.controller];
    o.defense = parseInt(o.card.defense, 10) || 0;
    const opps = this.opponents(ctl);
    // (the protector: the AI picks the opponent with the least to block with; people are asked through chooseProtector)
    const pick = ctl.agent.chooseProtector ? ctl.agent.chooseProtector(this, ctl, o, opps) : opps[0];
    o.protector = (pick || opps[0])?.idx ?? null;
    if (o.protector != null) this.log(`${this.cn(o)} enters with ${o.defense} defense counters, protected by ${this.pn(this.players[o.protector])}`, { kind: 'minor', rule: '310.5' });
  }
  // A permanent p's creatures may attack: a battle whose protector is someone else, or an opponent's planeswalker
  attackable(p, o) {
    if (!o || o.zone !== 'battlefield') return false;
    if (o.fx.type.battle && this.rules >= 5) return o.protector != null && o.protector !== p.idx && !this.players[o.protector]?.lost;
    if (o.fx.type.planeswalker && this.rules >= 5) return o.controller !== p.idx;
    return false;
  }
  // ---------- companions (702.139): {3}, put it from outside the game into your hand, once, at sorcery speed
  canCompanion(p) {
    const c = p.companion;
    return !!c && c.zone === 'outside' && this.rules >= 5 && this.active === p.idx && (this.phase === 'main1' || this.phase === 'main2') && !this.stack.length && !!this.planPayment(p, { generic: 3, pips: [], x: 0 }, 0);
  }
  useCompanion(p) {
    if (!this.canCompanion(p)) return false;
    this.commitPayment(p, this.planPayment(p, { generic: 3, pips: [], x: 0 }, 0));
    const c = p.companion;
    c.zone = 'hand'; p.hand.push(c);
    this.log(`${this.pn(p)} pays {3} and puts their companion ${this.cn(c)} into their hand`, { kind: 'cast', p: p.idx, rule: '702.139c' });
    this.emit('update');
    return true;
  }
  // ---------- day and night (726)
  flipFace(o) {
    const b = (o.frontCard || o.card).backCard;
    if (!b) return;
    o.frontCard ||= o.card;
    o.card = o.card === o.frontCard ? b : o.frontCard;
    o.fx = o.card.fx;
  }
  setDayNight(v) {
    this.dayNight = v;
    const turned = [];
    for (const q of this.players) for (const o of q.battlefield) {
      if ((v === 'night' && o.fx.daybound) || (v === 'day' && o.fx.nightbound)) { const was = o.card.name; this.flipFace(o); if (o.card.name !== was) turned.push(o); }
    }
    this.log(`It becomes ${v}${turned.length ? `: ${turned.map(o => this.cn(o)).join(', ')} transform${turned.length === 1 ? 's' : ''}` : ''}`, { kind: 'minor', rule: '726.2' });
  }
  // ---------- dungeons (701.49) and the initiative (725)
  // Venture: enter a dungeon's first room, or move to one of the rooms below the current one; the room's ability
  // triggers. Finishing the last room completes the dungeon (it's removed once that ability has resolved).
  async venture(p, undercity = false) {
    if (p.lost) return;
    if (p.dungeon && !DUNGEONS[p.dungeon.name].rooms[p.dungeon.room].next.length) this.completeDungeon(p);
    let room;
    if (!p.dungeon) {
      const names = undercity ? ['Undercity'] : ventureChoices();
      const name = names.length === 1 ? names[0] : await (p.agent.chooseDungeonAsync ? p.agent.chooseDungeonAsync(this, p, names) : p.agent.chooseDungeon(this, p, names));
      p.dungeon = { name: DUNGEONS[name] ? name : names[0] };
      room = DUNGEONS[p.dungeon.name].start;
    } else {
      const next = DUNGEONS[p.dungeon.name].rooms[p.dungeon.room].next;
      room = next.length === 1 ? next[0] : await (p.agent.chooseRoomAsync ? p.agent.chooseRoomAsync(this, p, p.dungeon.name, next) : p.agent.chooseRoom(this, p, p.dungeon.name, next));
      if (!next.includes(room)) room = next[0];
    }
    p.dungeon.room = room;
    if (!p.dungeonObj) {
      const card = { name: 'Dungeon', typeLine: 'Dungeon', manaCost: '', cmc: 0, colors: [], colorIdentity: [], text: '' };
      card.fx = analyzeCard(card);
      p.dungeonObj = this.mk(card, p);
      p.dungeonObj.zone = 'command-dungeon';
    }
    p.dungeonObj.card = { ...p.dungeonObj.card, name: p.dungeon.name };
    this.log(`${this.pn(p)} ventures into ${esc(room)} (${esc(p.dungeon.name)})`, { kind: 'cast', p: p.idx, rule: undercity ? '725.2' : '701.49a' });
    this.queue.push({ o: p.dungeonObj, effects: roomEffects(p.dungeon.name, room), label: `room: ${room}`, p });
    this.emit('update');
  }
  completeDungeon(p) {
    if (!p.dungeon) return;
    p.dungeonsDone = (p.dungeonsDone || 0) + 1;
    this.log(`${this.pn(p)} completes ${esc(p.dungeon.name)}`, { kind: 'minor', rule: '309.7' });
    p.dungeon = null;
  }
  // Take the initiative: you have it until someone takes it from you, and venture into Undercity now and at each of
  // your upkeeps; a player dealt combat damage by your creature... (the creature's controller takes it from them)
  async takeInitiative(p) {
    if (p.lost) return;
    if (this.initiative !== p.idx) this.log(`${this.pn(p)} takes the initiative`, { kind: 'cast', p: p.idx, rule: '725.2' });
    this.initiative = p.idx;
    await this.venture(p, true);
  }
  // ---------- face-down permanents (708): morph, megamorph, disguise, manifest, manifest dread, cloak
  canCastFaceDown(p, o) {
    const m = o.fx.morph;
    if (!m || this.rules < 5 || o.zone !== 'hand' || o.faceDown) return false;
    if (this.silenced[p.idx] === this.turn || this.spellCapped(p, o)) return false;
    if (!(this.active === p.idx && (this.phase === 'main1' || this.phase === 'main2') && !this.stack.length)) return false;
    return !!this.planPayment(p, { generic: 3, pips: [], x: 0 }, 0);
  }
  // A face-down object is a nameless, colorless 2/2 creature with no text (disguise and cloak: ward {2})
  makeFaceDown(o, how) {
    if (o.faceDown) return;
    const ward = how === 'disguise' || how === 'cloak';
    const card = { name: 'Face-down creature', typeLine: 'Creature', manaCost: '', cmc: 0, colors: [], colorIdentity: [], power: '2', toughness: '2', text: ward ? 'Ward {2}' : '', keywords: ward ? ['Ward'] : [], faceDownCard: true };
    card.fx = analyzeCard(card);
    o.faceCard = o.card; o.faceFx = o.fx; o.faceDown = how;
    o.card = card; o.fx = card.fx;
  }
  restoreFace(o) {
    if (!o.faceDown) return;
    o.card = o.faceCard; o.fx = o.faceFx;
    o.faceDown = null; o.faceCard = null; o.faceFx = null;
  }
  // Turning a face-down permanent face up is a special action (116.2b): its morph or disguise cost, or for a
  // manifested or cloaked creature card its mana cost. Returns that cost, or null.
  faceUpCost(p, o) {
    if (!o.faceDown || o.zone !== 'battlefield' || o.controller !== p.idx) return null;
    const real = o.faceFx;
    if (real.morph) return real.morph.cost;
    if ((o.faceDown === 'manifest' || o.faceDown === 'cloak') && real.type.creature && o.faceCard.manaCost) return o.faceCard.manaCost;
    return null;
  }
  canTurnFaceUp(p, o) {
    const c = this.faceUpCost(p, o);
    return c != null && !!this.planPayment(p, parseCost(c), 0);
  }
  async turnFaceUp(p, o) {
    if (!this.canTurnFaceUp(p, o)) return false;
    const cost = this.faceUpCost(p, o);
    this.commitPayment(p, this.planPayment(p, parseCost(cost), 0));
    const mega = o.faceFx.morph?.mega;
    this.restoreFace(o);
    this.log(`${this.pn(p)} pays ${cost} and turns ${this.cn(o)} face up`, { kind: 'cast', p: p.idx, rule: '702.37e' });
    if (mega) { o.counters += this.moreCounters(o, 1); this.log(`${this.cn(o)} gets a +1/+1 counter (megamorph)`, { kind: 'minor', rule: '702.37b' }); }
    // "When ~ is turned face up" (it wasn't cast and didn't enter, so nothing else triggers)
    if (o.fx.turnedUp?.length) this.queue.push({ o, effects: o.fx.turnedUp, label: 'turned face up', p });
    this.emit('update');
    await this.sba();
    return true;
  }
  // Manifest (701.40), manifest dread (701.62), cloak (701.58): the top card of the library onto the battlefield face down
  manifest(p, e, ctx) {
    const made = [];
    for (let k = 0; k < (e.n || 1); k++) {
      let card;
      if (e.dread) {
        const top = p.library.slice(-2).reverse();
        if (!top.length) break;
        // (keep a creature card, which can be turned up later, else the better card; the other goes to the graveyard)
        const worth = x => (x.fx.type.creature ? 5 : 0) + p.agent.value(this, x);
        card = [...top].sort((a, b) => worth(b) - worth(a))[0];
        for (const x of top) if (x !== card) this.move(x, 'graveyard');
      } else card = p.library[p.library.length - 1];
      if (!card) break;
      this.makeFaceDown(card, e.cloak ? 'cloak' : 'manifest');
      this.move(card, 'battlefield', { under: p.idx });
      if (card.zone !== 'battlefield') { this.restoreFace(card); continue; }
      made.push(card);
    }
    if (made.length) this.log(`${this.pn(p)} ${e.cloak ? 'cloaks' : 'manifests'} the top card${made.length > 1 ? 's' : ''} of their library${e.dread ? ' (manifest dread)' : ''}`, { kind: 'minor', rule: e.cloak ? '701.58a' : e.dread ? '701.62a' : '701.40a' });
    if (ctx) ctx.made = made[made.length - 1] || null;
    return made;
  }
  // The most X an ability with {X} in its cost can be paid with right now (107.3, 602.2b)
  maxAbilityX(p, o, ab) {
    const prev = this.payingFor;
    this.payingFor = { o, ability: true };
    try {
      const c = this.abilityCost(p, o, ab);
      if (!c.x) return 0;
      let x = 0;
      while (x < 99 && this.planPayment(p, c, (x + 1) * c.x, ab.tap ? o : null)) x++;
      return x;
    } finally { this.payingFor = prev; }
  }
  async activate(p, o, ab, opts = {}) {
    if (!this.canActivate(p, o, ab)) return false;
    // {X} in the cost (Crypt Rats, Helix Pinnacle): X is chosen before paying (601.2b through 602.2b).
    // The AI passes the X it valued, a human seat is asked. (Rules 4 and earlier played every X as 0.)
    const cost0 = this.abilityCost(p, o, ab);
    const hasX = !!cost0.x && this.rules >= 5;
    let x = 0;
    if (hasX) {
      const max = this.maxAbilityX(p, o, ab);
      const want = opts.x ?? (p.agent.chooseAbilityXAsync ? await p.agent.chooseAbilityXAsync(this, p, o, ab, max) : p.agent.chooseAbilityX ? p.agent.chooseAbilityX(this, p, o, ab, max) : max);
      x = Math.max(0, Math.min(max, want ?? 0));
    }
    this.payingFor = { o, ability: true };
    const plan = this.planPayment(p, this.abilityCost(p, o, ab), x * (cost0.x || 0), ab.tap ? o : null);
    if (!plan) { this.payingFor = null; return false; }
    this.commitPayment(p, plan);
    if (ab.tap) { o.tapped = true; this.fire('tapped', { o, p: p.idx }); }
    o.usedAbility = this.turn;
    this.log(`${this.pn(p)} activates ${this.cn(o)}${hasX ? ` with X = ${x}` : ''}${ab.text ? `: ${esc(ab.text.replace(/\.$/, '').slice(0, 80))}` : ''}`, { kind: 'minor' });
    // Other costs: life, discards, sacrifices, tapping other permanents… (Clue, Food, Survival of the Fittest, Springleaf Drum)
    await this.payCosts(p, o, ab.costs || { life: ab.life || 0, discard: ab.discard ? { n: ab.discard, types: [] } : null, sacSelf: !!ab.sacSelf });
    // Rings of Brighthearth: pay {2} to copy an ability that isn't a mana ability (the copy resolves first).
    // Copying "untap ~" gains nothing here, since mana can't be made between the copy and the original.
    const copyable = !(ab.effects || []).some(e => e.k === 'addMana' || e.k === 'untapSelf');
    if (copyable && p.battlefield.some(s => s.fx.copyAbility)) {
      const plan2 = this.planPayment(p, { generic: 2, pips: [], x: 0 });
      if (plan2 && (await (p.agent.wantsAbilityCopy?.(this, p, o, ab) ?? true))) {
        this.commitPayment(p, plan2);
        this.log(`${this.pn(p)} pays {2}: Rings of Brighthearth copies ${this.cn(o)}'s ability`, { kind: 'minor' });
        await this.stackAbility(p, o, ab.effects, `${ab.text || 'ability'} (copy)`, 'ability', null, x);
      }
    }
    await this.stackAbility(p, o, ab.effects, ab.text, 'ability', null, x);
    await this.sba();
    return true;
  }
  // Ward: p pays the ward cost of each opponent's permanent it targets, or the spell/ability is countered
  payWard(p, targets, src) {
    for (const t of targets) {
      const o = t?.obj;
      if (!o || o.controller === p.idx || o.zone !== 'battlefield') continue;
      // (its own ward or one granted by a permanent; Gisa, the Hellraiser asks for mana and life)
      const w = this.wardOf(o);
      if (!w.n && !w.life) continue;
      const plan = w.n ? this.planPayment(p, { generic: w.n, pips: [], x: 0 }) : true;
      if (plan && (!w.life || p.life > w.life + 5)) {
        if (w.n) this.commitPayment(p, plan);
        if (w.life) { p.life -= w.life; this.emit('life', { p: p.idx, d: -w.life }); }
        this.log(`${this.pn(p)} pays ${[w.n && `{${w.n}}`, w.life && `${w.life} life`].filter(Boolean).join(' and ')} for ${this.cn(o)}'s ward`, { kind: 'minor', rule: '702.21a' });
        continue;
      }
      this.log(`${this.cn(src)} is countered by ${this.cn(o)}'s ward`, { kind: 'removal', rule: '702.21a' });
      return false;
    }
    return true;
  }

  // Simian / Elvish Spirit Guide: exile it from hand for mana that stays in the pool until the phase ends
  exileForMana(p, o) {
    if (o.zone !== 'hand' || !o.fx.handMana) return false;
    this.move(o, 'exile');
    for (const c of o.fx.handMana) p.pool.push({ colors: [c] });
    this.log(`${this.pn(p)} exiles ${this.cn(o)} from their hand: adds ${o.fx.handMana.map(c => `{${c}}`).join('')}`, { kind: 'minor' });
    this.emit('update');
    return true;
  }

  // ---------- costs and abilities used from other zones
  // Cycling (702.29) and landcycling, and channel: pay, discard it, then draw (or search, or the channel effect)
  canCycle(p, o) {
    const c = o.fx.cycling || o.fx.channel;
    return !!c && o.zone === 'hand' && !!this.planPayment(p, parseCost(c.cost), 0);
  }
  async cycle(p, o) {
    const ch = !o.fx.cycling && o.fx.channel;
    const c = ch || o.fx.cycling;
    const plan = this.planPayment(p, parseCost(c.cost), 0);
    if (!plan || o.zone !== 'hand') return false;
    this.commitPayment(p, plan);
    this.discard(p, [o], null);
    if (ch) {
      this.log(`${this.pn(p)} channels ${this.cn(o)}`, { kind: 'cast', p: p.idx });
      await this.stackAbility(p, o, ch.effects, 'channel');
    } else if (c.tribe) {
      // Wizardcycling and friends: search for a creature card of that type
      this.log(`${this.pn(p)} ${c.tribe}cycles ${this.cn(o)}`, { kind: 'minor', rule: '702.29e' });
      const pick = p.agent.pickBest(this, p.library.filter(x => x.fx.type.creature && this.isA(x, c.tribe)));
      if (pick) { this.move(pick, 'hand'); shuffle(p.library, this.rand); this.log(`${this.pn(p)} finds ${this.cn(pick)}`, { kind: 'minor' }); }
    } else if (c.land) {
      this.log(`${this.pn(p)} ${c.land === 'land' || c.land === 'basic' ? 'landcycles' : c.land + 'cycles'} ${this.cn(o)}`, { kind: 'minor', rule: '702.29e' });
      await this.fetchLands(p, { n: 1, bf: false, basic: c.land === 'basic', sub: ['plains', 'island', 'swamp', 'mountain', 'forest'].includes(c.land) ? c.land : null }, o);
    } else {
      this.log(`${this.pn(p)} cycles ${this.cn(o)}`, { kind: 'minor', rule: '702.29a' });
      this.draw(p, 1, true);
    }
    // "When you cycle ~" (Shark Typhoon, Titanoth Rex)
    if (!ch) for (const w of o.fx.watch || []) if (w.ev === 'cycled') await this.stackAbility(p, o, w.effects, 'cycled', 'trigger');
    await this.sba();
    return true;
  }
  // Unearth (702.84), embalm (702.128), eternalize (702.129): abilities of a card in the graveyard
  graveAbility(p, o) {
    if (o.zone !== 'graveyard' || o.owner !== p.idx) return null;
    for (const k of ['unearth', 'embalm', 'eternalize']) if (o.fx[k] && this.planPayment(p, parseCost(o.fx[k]), 0)) return k;
    // Encore (702.141): only as a sorcery
    if (o.fx.encore && this.active === p.idx && (this.phase === 'main1' || this.phase === 'main2') && !this.stack.length && this.planPayment(p, parseCost(o.fx.encore), 0)) return 'encore';
    if (o.fx.graveReturn && this.planPayment(p, parseCost(o.fx.graveReturn.cost), 0)) return 'graveReturn';
    return null;
  }
  async useGraveAbility(p, o, k) {
    const plan = this.planPayment(p, parseCost(k === 'graveReturn' ? o.fx.graveReturn.cost : o.fx[k]), 0);
    if (!plan) return false;
    this.commitPayment(p, plan);
    if (k === 'graveReturn') {
      const r = o.fx.graveReturn;
      this.move(o, r.to, { tapped: r.tapped });
      this.log(`${this.pn(p)} returns ${this.cn(o)} from their graveyard to ${r.to === 'hand' ? 'their hand' : 'the battlefield'}`, { kind: 'cast', p: p.idx });
      if (r.to === 'battlefield') this.trigger(o, 'etb');
    } else if (k === 'encore') {
      // A hasty token copy for each opponent, sacrificed at the end step
      this.move(o, 'exile');
      for (const q of this.opponents(p)) {
        const t = this.createCopy(p, { card: o.card }, true);
        t.blitzed = true;
        this.trigger(t, 'etb');
      }
      this.log(`${this.pn(p)} encores ${this.cn(o)}: a token copy with haste for each opponent, sacrificed at the end step`, { kind: 'cast', p: p.idx, rule: '702.141a' });
    } else if (k === 'unearth') {
      this.move(o, 'battlefield');
      o.unearthed = true;
      o.tempKw = new Set([...(o.tempKw || []), 'haste']);
      this.log(`${this.pn(p)} unearths ${this.cn(o)}: it has haste and is exiled at the end of the turn`, { kind: 'cast', p: p.idx, rule: '702.84a' });
      this.trigger(o, 'etb');
    } else {
      this.move(o, 'exile');
      const card = k === 'eternalize' ? { ...o.card, power: '4', toughness: '4' } : o.card;
      const t = this.createCopy(p, { card }, false);
      this.log(`${this.pn(p)} ${k === 'embalm' ? 'embalms' : 'eternalizes'} ${this.cn(o)}: a token copy${k === 'eternalize' ? ' (4/4)' : ''}`, { kind: 'cast', p: p.idx, rule: k === 'embalm' ? '702.128a' : '702.129a' });
      this.trigger(t, 'etb');
    }
    await this.sba();
    return true;
  }
  // Crew N (702.122): tap creatures with total power N or more and the vehicle becomes a creature this turn
  async crew(p, v, crew) {
    const power = crew.reduce((s, c) => s + Math.max(0, this.power(c)), 0);
    if (!v.fx.crew || v.crewed || power < v.fx.crew || crew.some(c => c.tapped)) return false;
    for (const c of crew) c.tapped = true;
    v.crewed = true;
    v.fx = { ...v.card.fx, type: { ...v.card.fx.type, creature: true } };
    this.log(`${this.pn(p)} crews ${this.cn(v)} with ${crew.map(c => this.cn(c)).join(', ')}`, { kind: 'minor', rule: '702.122a' });
    await this.beat(0.5);
    return true;
  }
  // Echo, vanishing, fading and cumulative upkeep: costs and counters at the beginning of the upkeep
  async upkeepCosts(p) {
    // Rebound: cast the exiled spell again for free
    for (const o of (p.rebounds || []).splice(0)) if (o.zone === 'exile') { this.log(`${this.cn(o)} rebounds`, { kind: 'minor', rule: '702.88a' }); await this.cast(p, o, { mode: { alt: 'free' } }); }
    // Suspend: a time counter comes off each upkeep; with the last one it's cast free (a creature gains haste)
    for (const o of [...(p.suspended || [])]) {
      if (o.zone !== 'exile') { p.suspended.splice(p.suspended.indexOf(o), 1); continue; }
      o.timeCounters--;
      if (o.timeCounters > 0) { this.log(`${this.cn(o)} has ${o.timeCounters} time counter${o.timeCounters === 1 ? '' : 's'} left`, { kind: 'minor', rule: '702.62a' }); continue; }
      p.suspended.splice(p.suspended.indexOf(o), 1);
      this.log(`The last time counter comes off ${this.cn(o)}: it's cast without paying its mana cost`, { kind: 'minor', rule: '702.62a' });
      const wasCreature = o.fx.type.creature;
      await this.cast(p, o, { mode: { alt: 'free' } });
      if (wasCreature && o.zone === 'battlefield') o.permKw = new Set([...(o.permKw || []), 'haste']);
      if (this.over || p.lost) return;
    }
    // Pacts cast since the last upkeep: pay now or lose the game
    for (const pact of (p.pacts || []).splice(0)) {
      if (pact.from >= this.turn) { p.pacts.push(pact); continue; }
      const plan = this.planPayment(p, parseCost(pact.cost), 0);
      if (plan) { this.commitPayment(p, plan); this.log(`${this.pn(p)} pays ${esc(pact.cost)} for ${esc(pact.name)}`, { kind: 'minor' }); }
      else { this.lose(p, `couldn't pay for ${pact.name}`, '104.3'); return; }
    }
    for (const o of [...p.battlefield]) {
      if (o.zone !== 'battlefield') continue;
      if (o.echoDue) {
        o.echoDue = false;
        const plan = this.planPayment(p, parseCost(o.fx.echo), 0);
        if (plan && p.agent.value(this, o) >= 2) { this.commitPayment(p, plan); this.log(`${this.pn(p)} pays echo for ${this.cn(o)}`, { kind: 'minor', rule: '702.30a' }); }
        else { this.sacrifice(p, o, " (echo wasn't paid)"); continue; }
      }
      if (o.fx.kwN?.vanishing) {
        if (--o.timeCounters <= 0) { this.sacrifice(p, o, ' (vanishing: last time counter removed)'); continue; }
      }
      if (o.fx.kwN?.fading) {
        if (o.timeCounters <= 0) { this.sacrifice(p, o, ' (fading)'); continue; }
        o.timeCounters--;
      }
      if (o.fx.cumulative) {
        o.age = (o.age || 0) + 1;
        const cu = o.fx.cumulative;
        let paid = false;
        if (cu.life) { if (p.life - cu.life * o.age > 15 && p.agent.value(this, o) >= o.age * 1.5) { p.life -= cu.life * o.age; this.emit('life', { p: p.idx, d: -cu.life * o.age }); paid = true; } }
        else {
          const one = parseCost(cu.cost);
          /** @type {{ generic: number, pips: string[][], x: number }} */
          let total = { generic: 0, pips: [], x: 0 };
          for (let k = 0; k < o.age; k++) total = this.addCost(total, one);
          const plan = p.agent.value(this, o) >= o.age * 1.5 && this.planPayment(p, total, 0);
          if (plan) { this.commitPayment(p, plan); paid = true; }
        }
        if (paid) this.log(`${this.pn(p)} pays cumulative upkeep ×${o.age} for ${this.cn(o)}`, { kind: 'minor', rule: '702.24a' });
        else this.sacrifice(p, o, ' (cumulative upkeep not paid)');
      }
    }
  }

  // ---------- combat
  async combat(p) { return combat.combat(this, p); }
  // Attack keywords: exalted, battle cry, annihilator, melee, dethrone, training, mentor
  attackKeywords(p, decl) { return combat.attackKeywords(this, p, decl); }
  // Block keywords: bushido, rampage, flanking, afflict, and block/blocked watchers
  blockKeywords(q, attackers) { return combat.blockKeywords(this, q, attackers); }
  async ninjutsu(p, ninja, out) { return combat.ninjutsu(this, p, ninja, out); }

  // A division of an attacker's combat damage: [{ obj, n } for blockers, { player: true, n } for trample-over].
  // Returns it if it adds up and gives the player nothing before every blocker has lethal damage, else null.
  lethalFor(b, dt) { return combat.lethalFor(this, b, dt); }
  validDamagePlan(plan, blockers, dmg, tr, dt) { return combat.validDamagePlan(this, plan, blockers, dmg, tr, dt); }
  async combatDamage(p, first, hadFirst) { return combat.combatDamage(this, p, first, hadFirst); }

  // ---------- politics
  // Not rules, just table talk: who the table should gang up on, and short non-aggression deals.
  // Deals are between AI agents only and can be broken; breaking one earns a lasting grudge.
  tablePower(q) {
    let v = q.life * 0.08 + q.hand.length * 0.4;
    for (const o of q.battlefield) v += o.fx.type.land ? 0.3 : q.agent.value(this, o) + q.agent.comboDanger(this, o);
    return v;
  }
  dealBetween(a, b) { return this.deals.find(d => !d.broken && d.until >= this.round && ((d.a === a && d.b === b) || (d.a === b && d.b === a))); }
  breakDeal(p, q) {
    const d = this.dealBetween(p.idx, q.idx);
    if (!d) return;
    d.broken = true;
    q.grudge[p.idx] += 15;
    for (const r of this.opponents(p)) if (r !== q) r.grudge[p.idx] += 4;
    this.log(`${this.pn(p)} breaks the truce with ${this.pn(q)}. The table won't forget it.`, { kind: 'politics', p: p.idx });
  }
  async politics(p) {
    this.deals = this.deals.filter(d => !d.broken && d.until >= this.round);
    const alive = this.alive();
    if (alive.length < 3) { this.archenemy = null; return; }
    // (rules 5, item 108: scaled by what finished games say about boards like theirs, when there's a learned table)
    const T = this.rules >= 5 ? this.players.find(q => q.learned?.['#threat'])?.learned['#threat'] : null;
    const ranked = alive.map(q => [q, this.tablePower(q) * (T ? threatMult(T, this, q) : 1)]).sort((a, b) => b[1] - a[1]);
    const [lead, lv] = ranked[0];
    const next = ranked[1][1];
    // Hysteresis: it takes a clear lead to become the archenemy, and a real fall to stop being one
    const keep = this.archenemy === lead.idx && lv >= next * 1.15;
    const arch = keep || (this.round >= 3 && lv >= 22 && lv >= next * 1.4) ? lead.idx : null;
    if (arch !== this.archenemy) {
      this.archenemy = arch;
      if (arch != null) this.log(`The table sees ${this.pn(lead)} as the biggest threat, and the others focus on them`, { kind: 'politics' });
      else this.log('No single player is running away with the game any more', { kind: 'politics' });
    }
    // Deals people offered from the chat since the last turn began (handled here, between decisions)
    for (const d of this.pendingDeals.splice(0)) {
      const from = this.players[d.from], to = this.players[d.to];
      if (!from || !to || from.lost || to.lost || from === to || this.dealBetween(from.idx, to.idx)) continue;
      if (d.kind === 'gangUp' && (this.archenemy == null || [from.idx, to.idx].includes(this.archenemy))) continue;
      await this.offerDeal(from, to, d.kind, d.rounds);
    }
    // The active player may offer someone a deal. Every deal includes "neither attacks the other";
    // the kinds add a trade on top (see dealText)
    const offer = p.agent.proposeDeal(this, p);
    if (!offer) return;
    await this.offerDeal(p, offer.to, offer.kind || 'truce', offer.rounds);
  }
  // rounds: how long the deal lasts. 0 = the rest of this round, n = this round and n more (1 to 5)
  async offerDeal(p, q, kind, rounds = 2) {
    rounds = Math.max(0, Math.min(5, Number.isFinite(+rounds) ? +rounds : 2));
    const target = kind === 'gangUp' ? this.players[this.archenemy] : null;
    this.log(`${this.pn(p)} offers ${this.pn(q)} a deal: ${this.dealText(kind, p, q, target, rounds)}`, { kind: 'politics', p: p.idx });
    if (await q.agent.considerDeal(this, q, p, kind, rounds)) {
      this.deals.push({ a: p.idx, b: q.idx, kind, target: target?.idx ?? null, until: this.round + rounds, rounds, broken: false });
      this.log(`${this.pn(q)} accepts`, { kind: 'politics', p: q.idx });
      // Tribute: the one asking for peace pays up front
      if (kind === 'tribute') { this.draw(q, 1); this.log(`${this.pn(q)} draws a card as tribute from ${this.pn(p)}`, { kind: 'politics' }); }
    } else this.log(`${this.pn(q)} declines`, { kind: 'politics', p: q.idx });
  }
  dealLength(rounds) {
    return rounds === 0 ? 'until the end of this round' : `for ${rounds === 1 ? 'one more round' : `${['', 'one', 'two', 'three', 'four', 'five'][rounds] || rounds} more rounds`} (to the end of round ${this.round + rounds})`;
  }
  dealText(kind, p, q, target, rounds = 2) {
    const len = this.dealLength(rounds);
    return {
      truce: `neither attacks the other ${len}`,
      gangUp: `neither attacks the other, and both go after ${target ? this.pn(target) : 'the leader'} ${len}`,
      noCounter: `neither attacks nor counters the other's spells ${len}`,
      tribute: `${this.pn(q)} draws a card now and doesn't attack ${this.pn(p)} ${len}`,
    }[kind];
  }

  // ---------- game flow
  async run() {
    try {
      // A puzzle: a set board, one turn for seat 1 starting in its first main phase, win it or fail
      // A set board played as a whole game from it (story chapters): no mulligans, seat 1 starts
      if (this.puzzle?.fullGame) await this.setupPuzzle(this.puzzle);
      else if (this.puzzle) {
        await this.setupPuzzle(this.puzzle);
        await this.takeTurn(this.players[0], { fromMain: true });
        // A lesson's own goal (tutorial.js: "get Grizzly Bears onto the battlefield"), checked when the turn ends
        if (!this.over && typeof this.puzzle.check === 'function' && this.puzzle.check(this)) {
          this.log(`Lesson complete: ${esc(this.puzzle.goal || '')}`, { kind: 'turn' });
          this.finish(this.players[0], 'lesson complete');
        }
        if (!this.over) {
          this.log(`Puzzle failed: ${esc(this.puzzle.goal || 'win this turn')} didn't happen`, { kind: 'loss' });
          this.puzzleFailed = true;
          this.finish(null, 'puzzle failed');
        }
        this.emit('update');
        return;
      }
      if (!this.puzzle) await this.setup();
      while (!this.over) {
        const p = this.players[this.active];
        if (!p.lost) await this.takeTurn(p);
        // Extra turns (capped so a loop of them can't run forever)
        while (!this.over && !p.lost && p.extraTurns > 0 && this.extraTurnsTaken < 8) {
          p.extraTurns--;
          // Stranglehold, Ugin's Nexus: an opponent's extra turn is skipped
          if (this.opponents(p).some(q => q.battlefield.some(o => o.fx.noExtraTurns))) { this.log(`${this.pn(p)}'s extra turn is skipped`, { kind: 'turn' }); continue; }
          this.extraTurnsTaken++;
          this.log(`${this.pn(p)} takes an extra turn`, { kind: 'turn', rule: '500.7' });
          await this.takeTurn(p);
        }
        if (this.over) break;
        const prev = this.active;
        this.active = this.nextAlive(this.active);
        if (this.active <= prev) {
          this.round++;
          // (learned threat, item 108: every player's public board at the start of each round, for learn.js)
          if (this.rules >= 5 && !this.sim && this.players.length >= 3) for (const q of this.alive()) this.threatLog.push({ round: this.round, idx: q.idx, f: threatFeatures(this, q) });
          if (this.round > this.maxRounds) {
            const best = [...this.alive()].sort((a, b) => b.life - a.life)[0];
            this.log(`Round limit (${this.maxRounds}) reached — highest life total wins`, { kind: 'turn' });
            this.finish(best, `highest life after ${this.maxRounds} rounds`);
          }
        }
      }
    } catch (e) {
      if (e.name !== 'Abort') { console.error(e); this.log(`Simulator error: ${esc(e.message)}`, { kind: 'loss' }); }
    }
    this.emit('update');
  }

  nextAlive(i) {
    for (let k = 1; k <= this.players.length; k++) { const j = (i + k) % this.players.length; if (!this.players[j].lost) return j; }
    return i;
  }

  async setup() {
    if (this.format.signature) this.log(`Oathbreaker: each player starts at ${this.startLife} life with their oathbreaker and signature spell in the command zone`, { rule: '903.7', kind: 'turn' });
    else if (this.format.commander) this.log(`${this.formatKey === 'commander' ? 'Each player' : `${esc(this.format.name)}: each player`} starts at ${this.startLife} life with their commander in the command zone`, { rule: '903.7', kind: 'turn' });
    else if (this.teams && this.format.teams) this.log(`${esc(this.format.name)}: each team starts at ${this.startLife} life, shared by both players`, { rule: '810.9', kind: 'turn' });
    else this.log(`${esc(this.format.name)}: each player starts at ${this.startLife} life`, { rule: '103.4', kind: 'turn' });
    for (const p of this.players) {
      shuffle(p.library, this.rand);
      this.draw(p, 7, true);
      while (p.mulligans < 3 && !(await p.agent.keepHand(this, p))) {
        p.mulligans++;
        for (const o of p.hand.splice(0)) { o.zone = 'library'; p.library.push(o); }
        shuffle(p.library, this.rand);
        this.draw(p, 7, true);
      }
      // (for learned mulligans, item 110: the kept seven's land count, before any card goes to the bottom)
      p.keptHand = { lands: p.hand.filter(o => o.fx.type.land).length, mulls: p.mulligans };
      // London mulligan: a card to the bottom per mulligan, the first one free in Commander (103.5c)
      const bottom = Math.max(0, p.mulligans - (this.format.freeMull ? 1 : 0));
      for (const o of await p.agent.bottomCards(this, p, bottom)) { p.hand.splice(p.hand.indexOf(o), 1); o.zone = 'library'; p.library.unshift(o); }
      this.log(p.mulligans ? `${this.pn(p)} mulligans ${p.mulligans}× and keeps ${p.hand.length}` : `${this.pn(p)} keeps 7`, { rule: p.mulligans ? (this.format.freeMull ? '103.5c' : '103.5') : null, kind: 'minor' });
      await this.beat(0.4);
    }
    // Who goes first: in best of three the last game's loser chose; otherwise random (drawn here, after
    // the mulligans, so replays saved by earlier versions still play out the same)
    this.active = this.firstPlayer != null && this.players[this.firstPlayer] ? this.firstPlayer : Math.floor(this.rand() * this.players.length);
    planarStartLog(this);
    if (this.teams && this.format.teams) {
      this.active -= this.active % 2;
      this.firstTeam = this.players[this.active].team;
      this.log(`Two-Headed Giant: ${this.pn(this.players[0])} and ${this.pn(this.players[1])} share ${this.startLife} life against ${this.pn(this.players[2])} and ${this.pn(this.players[3])}`, { rule: '810.1', kind: 'turn' });
    }
    this.round = 1;
    // Leylines start on the battlefield
    for (const p of this.players) for (const o of p.hand.filter(x => x.fx.leyline)) {
      this.move(o, 'battlefield');
      this.log(`${this.pn(p)} begins the game with ${this.cn(o)} on the battlefield`, { kind: 'minor' });
    }
    this.log(this.firstPlayer != null ? `${this.pn(this.players[this.active])} goes first` : `${this.pn(this.players[this.active])} is randomly chosen to go first`, { rule: '103.1', kind: 'turn' });
  }

  // Puzzle boards: every zone given by card name in the puzzle's cards (decks are built from those names)
  async setupPuzzle(pz) {
    this.log(`${pz.fullGame ? 'Chapter' : pz.check ? 'Lesson' : 'Puzzle'}: ${esc(pz.name || 'untitled')} · ${esc(pz.goal || 'win this turn')}`, { kind: 'turn' });
    const take = (p, name) => {
      const o = p.library.find(x => x.card.name.toLowerCase() === name.toLowerCase() || (x.card.frontName || '').toLowerCase() === name.toLowerCase());
      if (o) p.library.splice(p.library.indexOf(o), 1);
      return o;
    };
    pz.players.forEach((spec, i) => {
      const p = this.players[i];
      if (!p) return;
      p.life = spec.life ?? this.startLife;
      for (const [zone, list] of [['battlefield', spec.battlefield], ['hand', spec.hand], ['graveyard', spec.graveyard], ['exile', spec.exile]]) {
        for (const entry of list || []) {
          const { name, tapped, counters } = typeof entry === 'string' ? { name: entry } : entry;
          const o = take(p, name);
          if (!o) { this.log(`Puzzle: ${esc(name)} isn't in ${this.pn(p)}'s card list`, { kind: 'minor' }); continue; }
          o.zone = 'library'; p.library.push(o);
          this.move(o, zone);
          if (zone === 'battlefield') { o.tapped = !!tapped; o.counters = counters || 0; o.sick = false; }
        }
      }
      // Commanders: "commanderOnBattlefield" puts them out; otherwise they wait in the command zone
      if (spec.commanderOnBattlefield) for (const c of [...p.command]) { this.move(c, 'battlefield', { stay: true }); c.sick = false; }
      for (const [k, v] of Object.entries(spec.commanderDamage || {})) { const src = this.players[+k]?.command[0] || this.players[+k]?.battlefield.find(x => x.isCommander); if (src) p.cmdDamage[src.iid] = v; }
      // What's left of the list is the library (shuffled; a puzzle can also fix the top cards)
      shuffle(p.library, this.rand);
      for (const name of [...(spec.libraryTop || [])].reverse()) { const o = take(p, name); if (o) p.library.push(o); }
      // A board played as a whole game (story chapters) deals an opening hand when none is set
      if (pz.fullGame && !spec.hand) this.draw(p, spec.handSize ?? 7, true);
    });
    this.active = 0;
    this.round = 1;
    await this.sba();
  }

  async takeTurn(p, opts = {}) {
    // (life totals at the start of each turn, for the post-game report's graph; read only by the results screen)
    (this.lifeLog ||= []).push({ turn: this.turn + 1, life: this.players.map(q => (q.lost ? 0 : q.life)) });
    // Day and night (726.2): night if last turn's active player cast no spells, day again if they cast two or more
    const prevP = this.players[this.active];
    const prevSpells = prevP?.turnSpells?.turn === this.turn ? prevP.turnSpells.n : 0;
    this.turn++;
    if (this.rules >= 5 && this.dayNight && this.turn > 1) {
      if (this.dayNight === 'day' && prevSpells === 0) this.setDayNight('night');
      else if (this.dayNight === 'night' && prevSpells >= 2) this.setDayNight('day');
    }
    this.active = p.idx;
    for (const q of this.players) q.flashNow = false;
    this.log(`Turn ${this.turn} · ${this.pn(p)}`, { kind: 'turn', p: p.idx });
    this.emit('turn', p);
    if (opts.fromMain) {
      // (a puzzle starts here: no untap, upkeep or draw)
      p.landsPlayed = 0;
      this.setPhase('main1');
      await p.agent.mainPhase(this, p, 'main1');
      if (this.over || p.lost) return;
      return this.restOfTurn(p);
    }
    await this.politics(p);
    this.setPhase('untap');
    // Intruder Alarm, Meekstone, Winter Orb, Winter Moon: what can't untap (or only one land)
    const locks = this.alive().flatMap(q => q.battlefield.filter(s => s.fx.untapLock && !(s.fx.untapLock.whileUntapped && s.tapped)).map(s => s.fx.untapLock));
    const landLock = locks.find(l => l.what === 'land');
    let landsLeft = 1;
    // (the land it does untap: your pick in your seat, otherwise the one that makes the most mana)
    let order = landLock ? [...p.battlefield].sort((a, b) => (b.fx.mana?.amount || 0) - (a.fx.mana?.amount || 0)) : p.battlefield;
    if (landLock && p.agent.chooseCostAsync) {
      const tappedLands = p.battlefield.filter(o => o.tapped && o.fx.type.land && (!landLock.nonbasic || !o.fx.type.basic));
      if (tappedLands.length > 1) {
        const [pick] = await p.agent.chooseCostAsync(this, p, tappedLands, 1, `Only one ${landLock.nonbasic ? 'nonbasic ' : ''}land untaps this turn: choose it`);
        if (pick) order = [pick, ...p.battlefield.filter(o => o !== pick)];
      }
    }
    for (const o of [...order]) {
      o.sick = false; o.usedPW = false;
      // Exerted creatures and "doesn't untap during your untap step" stay tapped
      if (o.exerted || o.fx.noUntap || (this.rules >= 5 && this.attachments(o).some(a => a.fx.attachNoUntap))) { o.exerted = false; continue; }
      if (o.tapped && o.fx.type.creature && locks.some(l => l.what === 'creature' && (!l.minPower || this.power(o) >= l.minPower))) continue;
      if (o.tapped && landLock && o.fx.type.land && (!landLock.nonbasic || !o.fx.type.basic)) { if (landsLeft <= 0) continue; landsLeft--; }
      if (o.tapped) { o.tapped = false; if (o.fx.watch?.some(w => w.ev === 'untapped')) this.queue.push({ o, effects: o.fx.watch.find(w => w.ev === 'untapped').effects, label: 'untapped', p }); }
    }
    // Speed (start your engines!) starts at 1; it rises at the end of a turn of yours in which an opponent lost life
    if (!p.speed && p.battlefield.some(o => o.fx.speed)) p.speed = 1;
    // Seedborn Muse: its controller untaps on everyone else's turn too
    for (const q of this.opponents(p)) {
      // (Quest for Renewal: creatures only, once it has its counters)
      const us = q.battlefield.filter(o => o.fx.untapOthers && (!o.fx.untapOthersCond || this.evalCond(q, o, o.fx.untapOthersCond, {})));
      if (us.length) for (const o of q.battlefield) if (us.some(s => !s.fx.untapOthersCond) || o.fx.type.creature) o.tapped = false;
    }
    // Bender's Waterskin: untaps during each other player's untap step
    for (const q of this.opponents(p)) for (const o of q.battlefield) if (o.fx.untapSelfOthers) o.tapped = false;
    p.landsPlayed = 0;
    p.extraCombats = 0;
    await this.beat(0.4);
    this.setPhase('upkeep');
    await this.upkeepCosts(p);
    for (const o of p.battlefield) this.trigger(o, 'upkeep');
    this.fire('upkeep', { p: p.idx });
    if (this.initiative != null && this.players[this.initiative]?.lost) await this.takeInitiative(p);
    else if (this.initiative === p.idx) await this.venture(p, true);
    if (this.kingdoms) K.upkeep(this, p);
    await this.sba();
    if (this.over || p.lost) return;
    await this.stopFor('upkeep', p);
    if (this.over || p.lost) return;
    this.setPhase('draw');
    this.fire('drawStep', { p: p.idx });
    if (p.battlefield.some(o => o.fx.skipDraw)) this.log(`${this.pn(p)} skips their draw step`, { kind: 'minor' });
    // In a two-player game the player who goes first skips the draw of their first turn (103.8a);
    // multiplayer games (Commander pods) don't
    else if (this.turn === 1 && this.players.length === 2) this.log(`${this.pn(p)} goes first and skips the first draw`, { rule: '103.8a', kind: 'minor' });
    // (Two-Headed Giant: the team that goes first skips its first draw, 810.4c)
    else if (this.teams && this.turn <= 2 && this.firstTeam === p.team) this.log(`${this.pn(p)}'s team goes first and skips the first draw`, { rule: '103.8a', kind: 'minor' });
    else this.draw(p, 1);
    await this.sba();
    await this.beat(0.4);
    if (this.over || p.lost) return;
    await this.stopFor('draw', p);
    if (this.over || p.lost) return;
    this.setPhase('main1');
    this.fire('main1', { p: p.idx });
    // Sagas get a lore counter after the draw step
    for (const o of p.battlefield.filter(x => x.fx.saga)) { o.lore++; this.chapter(o); }
    await this.sba();
    if (this.over || p.lost) return;
    if (this.kingdoms) { await K.aiAnnounce(this, p); if (this.over || p.lost) return; }
    if (this.planar) { await planarMain(this, p); if (this.over || p.lost) return; }
    await p.agent.mainPhase(this, p, 'main1');
    if (this.over || p.lost) return;
    return this.restOfTurn(p);
  }

  // Combat, the second main phase and the end of the turn
  async restOfTurn(p) {
    await this.combat(p);
    for (let k = 0; k < 3 && p.extraCombats > 0 && !this.over && !p.lost; k++) { p.extraCombats--; await this.combat(p); }
    if (this.over || p.lost) return;
    this.setPhase('main2');
    this.fire('main2', { p: p.idx });
    await this.sba();
    if (this.over || p.lost) return;
    await p.agent.mainPhase(this, p, 'main2');
    // An extra combat granted in the second main phase comes with another main phase
    for (let k = 0; k < 2 && p.extraCombats > 0 && !this.over && !p.lost; k++) {
      p.extraCombats--;
      await this.combat(p);
      if (this.over || p.lost) return;
      this.setPhase('main2');
      await p.agent.mainPhase(this, p, 'main2');
    }
    if (this.over || p.lost) return;
    return this.endSteps(p);
  }

  // The end step and cleanup (also run on its own by the AI's look-ahead, lookahead.js)
  async endSteps(p) {
    this.setPhase('end');
    // (item 109: a person ending their turn with mana held up and cards in hand)
    if (p.tells && !this.sim) { p.holdTurn = null; p.tells.turns++; if (p.hand.length && this.availableMana(p) >= 2) { p.tells.held++; p.holdTurn = this.turn; } }
    // Necropotence: pay life for cards (the pilot keeps a safe life total)
    if (p.battlefield.some(o => o.fx.necro)) {
      const n = Math.min(6, p.life - 15, p.library.length - 1);
      if (n > 0) { p.life -= n; this.emit('life', { p: p.idx, d: -n }); this.draw(p, n, true); this.log(`${this.pn(p)} pays ${n} life to Necropotence for ${n} cards`, { kind: 'minor' }); }
    }
    // Mobilize tokens are sacrificed at the end step
    for (const o of (this.endSac || []).splice(0)) if (o.zone === 'battlefield') this.sacrifice(this.players[o.controller], o);
    // Cards exiled "until the next end step" come back
    for (const o of this.delayed.splice(0)) {
      if (o.zone !== 'exile') continue;
      this.move(o, 'battlefield');
      this.log(`${this.cn(o)} returns to the battlefield`, { kind: 'minor' });
      this.trigger(o, 'etb');
    }
    for (const o of p.battlefield) this.trigger(o, 'endstep');
    this.fire('endStep', { p: p.idx });
    if (p.speed && p.speed < 4 && this.opponents(p).some(q => q.lostLifeTurn === this.turn)) { p.speed++; this.log(`${this.pn(p)}'s speed rises to ${p.speed}${p.speed === 4 ? ' (max speed)' : ''}`, { kind: 'minor' }); }
    // The monarch draws a card at the beginning of their end step (724.1)
    if (this.monarch === p.idx) { this.draw(p, 1, true); this.log(`👑 ${this.pn(p)} draws a card as the monarch`, { kind: 'minor', rule: '724.1' }); }
    // Liesa: creature cards that return to their owners' hands at the end step
    for (const q of this.alive()) for (const c of (q.handLater || []).splice(0)) if (c.zone === 'graveyard') { this.move(c, 'hand'); this.log(`${this.cn(c)} returns to ${this.pn(q)}'s hand`, { kind: 'minor' }); }
    // Underworld Breach is sacrificed at the beginning of every end step

    for (const q of this.alive()) for (const o of q.battlefield.filter(x => x.fx.sacAtEnd)) {
      this.move(o, 'graveyard');
      this.log(`${this.cn(o)} is sacrificed at the end step`, { kind: 'minor' });
    }
    // Dash returns to hand, blitz is sacrificed, unearth is exiled
    for (const o of [...p.battlefield]) {
      if (o.dashed) { this.move(o, 'hand'); this.log(`${this.cn(o)} returns to ${this.pn(p)}'s hand (dash)`, { kind: 'minor', rule: '702.109a' }); }
      else if (o.blitzed) this.sacrifice(p, o, ' (blitz)');
      else if (o.unearthed) this.move(o, 'exile');
      // Impending: a time counter comes off at its controller's end step; with the last one it's a creature
      if (o.impending > 0 && o.zone === 'battlefield' && --o.impending === 0) { o.fx = o.card.fx; this.log(`The last time counter comes off ${this.cn(o)}: it's a creature now`, { kind: 'minor', rule: '702.176a' }); }
    }
    await this.sba();
    if (this.over || p.lost) return;
    // (your own end step, when you asked to stop there; opponents get the window below)
    await this.stopFor('end', p);
    if (this.over || p.lost) return;
    // Opponents spend the mana they held up on instants and flash cards before their own untap
    for (const q of this.order(p.idx)) {
      if (q === p || q.lost) continue;
      await q.agent.endOfTurn(this, q, p);
      if (this.over) return;
    }
    if (p.lost) return;
    // (Jin-Gitaxias, Core Augur shrinks opponents' hand size; Folio of Fancies removes it for everyone)
    const maxHand = 7 - this.opponents(p).reduce((s, q) => s + q.battlefield.reduce((t, o) => t + (o.fx.oppHandLess || 0), 0), 0);
    const excess = p.battlefield.some(o => o.fx.noMaxHand) || this.alive().some(q => q.battlefield.some(o => o.fx.noMaxHandAll)) ? 0 : p.hand.length - Math.max(0, maxHand);
    if (excess > 0) {
      const disc = await p.agent.chooseDiscard(this, p, excess);
      this.discard(p, disc, null);
      this.log(`${this.pn(p)} discards ${disc.map(o => this.cn(o)).join(', ')} down to seven cards`, { rule: '514.1', kind: 'minor' });
    }
    for (const q of this.players) for (const o of q.battlefield) {
      Object.assign(o, { damage: 0, deathtouched: false, tempP: 0, tempT: 0, tempKw: null, regen: 0 });
      // "Becomes a copy … until end of turn" ends (Mirage Mirror, Shifting Woodland, Cursed Mirror)
      if (o.copyUntil != null && o.baseCard) { o.card = o.baseCard; o.fx = o.baseCard.fx; o.baseCard = null; o.copyUntil = null; }
      // A crewed vehicle stops being a creature at end of turn
      if (o.crewed) { o.crewed = false; o.fx = o.card.fx; }
    }
    // "Until end of turn" control changes end
    for (const { o, back } of this.tempSteals.splice(0)) {
      const now = this.players[o.controller];
      if (o.zone !== 'battlefield' || this.players[back].lost || now.idx === back) continue;
      now.battlefield.splice(now.battlefield.indexOf(o), 1);
      o.controller = back;
      this.players[back].battlefield.push(o);
      this.log(`${this.cn(o)} returns to ${this.pn(this.players[back])}`, { kind: 'minor' });
    }
    await this.beat(0.4);
  }
}
