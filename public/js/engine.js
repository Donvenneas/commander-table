// Four-player Commander game engine. Rule numbers in the log refer to the Comprehensive Rules.
import { analyzeCard, needsTarget, condText } from './effects.js';
import { combosIn, comboState, comboBlocked, cardKey, RESULT_TEXT } from './combos.js';
import { shuffle, esc, makeRng } from './util.js';
import { learnedBonus, learnedPerson } from './learn.js';
import { threatFeatures, threatMult } from './threat.js';
import { setupPlanar, planarStartLog, planarMain } from './planar.js';
import { formatOf } from './formats.js';
import * as K from './kingdomsPlay.js';
import { DUNGEONS, roomEffects, ventureChoices } from './dungeons.js';

export const PHASES = [
  ['untap', 'Untap'], ['upkeep', 'Upkeep'], ['draw', 'Draw'], ['main1', 'Main 1'],
  ['combat', 'Combat'], ['main2', 'Main 2'], ['end', 'End'],
];
const COLORS = ['W', 'U', 'B', 'R', 'G'];
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
  sources(p, exclude) {
    return p.battlefield.filter(o => o !== exclude && !o.tapped && o.fx.mana && this.canTapNow(p, o)
      && (!o.fx.mana.gate || this.gateOk(o, o.fx.mana.gate)) && (o.fx.type.land || !this.abilityLocked(p, o))
      && this.spendOk(o.fx.mana.only));
  }
  // A creature can use {T} abilities (mana included) once it's been under your control since your turn began,
  // or with haste, or with Shang-Chi / Thousand-Year Elixir-style "as though it had haste"
  canTapNow(p, o) { return !o.fx.type.creature || !o.sick || this.has(o, 'haste') || p.battlefield.some(s => s.fx.hasteAbilities); }
  // Mana with a spending restriction (Shang-Chi: only creature abilities) is only offered for what it may pay for
  spendOk(only) {
    if (!only) return true;
    const f = this.payingFor;
    if (f?.all) return true;
    if (only === 'creatureAbility') return !!f?.ability && !!f.o?.fx.type.creature;
    if (only === 'creatureSpell') return !!f && !f.ability && !!f.o?.fx.type.creature;
    return true;
  }
  // Mana abilities that count something: Gaea's Cradle (creatures), Bloom Tender (colors), Nykthos (devotion)
  manaAmount(p, s) {
    const m = s.fx.mana;
    let n;
    if (m.dyn === 'colors') n = Math.max(1, new Set(p.battlefield.flatMap(o => o.card.colors || [])).size);
    else if (m.dyn === 'devotionMax') n = Math.max(m.floor || 0, Math.max(...'WUBRG'.split('').map(c => this.dynValue(p, { dyn: 'devotion', color: c }))) - (m.less || 0));
    else if (m.dyn === 'tribeMax') {
      const k = {};
      for (const o of p.battlefield) if (o.fx.type.creature) for (const t of o.fx.subtypes) k[t] = (k[t] || 0) + 1;
      n = Math.max(m.floor || 0, Math.max(0, ...Object.values(k)) - (m.less || 0));
    } else if (m.dyn === 'charge') n = s.named?.charge || 0;
    else n = m.dyn ? this.countControlled(p, m.dyn) : m.amount;
    // Goldspan Dragon: Treasures make two; Nyxbloom Ancient: everything makes three times as much
    if (s.card.name === 'Treasure' && p.battlefield.some(o => o.fx.treasureTwo)) n *= 2;
    for (const o of p.battlefield) if (o.fx.manaMult && (!o.fx.manaMultBasic || (s.fx.type.basic && s.fx.type.land))) n *= o.fx.manaMult;
    return n;
  }
  units(p, exclude) {
    const u = p.pool.filter(x => this.spendOk(x.only)).map(x => ({ ref: x, colors: x.colors, pool: true }));
    // Kinnan: nonland mana sources make one extra
    const boost = p.battlefield.some(o => o.fx.manaBoost);
    // Chromatic Lantern: lands tap for any color; Crypt Ghast, Mirari's Wake: extra mana from some sources
    const lands = p.battlefield.filter(o => o.fx.type.land).length;
    const anyColor = p.battlefield.some(o => o.fx.landsAnyColor && (!o.fx.landsAnyColorN || lands >= o.fx.landsAnyColorN));
    const boosts = p.battlefield.filter(o => o.fx.landBoost).map(o => o.fx.landBoost);
    // High Tide: islands make an extra {U} this turn
    if (p.tempBoost?.turn === this.turn) boosts.push(p.tempBoost);
    // Urborg, Yavimaya: every land also taps for another color
    const addCols = [...new Set(this.alive().flatMap(q => q.battlefield.map(o => o.fx.allLandsAdd).filter(Boolean)))];
    for (const s of this.sources(p, exclude)) {
      // Lion's Eye Diamond discards the hand: only worth it once the hand is (nearly) empty
      if (s.fx.mana.discardHand && p.hand.filter(c => c !== p.casting).length > 1) continue;
      const n = this.manaAmount(p, s) + (boost && !s.fx.type.land ? 1 : 0);
      // Blood Moon: nonbasic lands only make {R}
      const moon = s.fx.type.land && !s.fx.type.basic && this.alive().some(q => q.battlefield.some(o => o.fx.bloodMoon));
      const colors = moon ? ['R'] : anyColor && s.fx.type.land ? COLORS : s.fx.type.land && addCols.length ? [...new Set([...s.fx.mana.colors, ...addCols])] : s.fx.mana.colors;
      for (let i = 0; i < n; i++) u.push({ src: s, colors, land: s.fx.type.land, only: s.fx.mana.only });
      // Utopia Sprawl, Wild Growth on this land
      if (s.fx.type.land) for (const a of this.attachments(s)) if (a.fx.auraMana) u.push({ src: s, colors: a.fx.auraMana === '*' ? COLORS : [a.fx.auraMana], land: true });
      // Abundant Growth: the enchanted land taps for any color
      if (s.fx.type.land && this.attachments(s).some(a => a.fx.auraFix)) for (const x of u) if (x.src === s) x.colors = COLORS;
      for (const b of boosts) if ((!b.monarch || this.monarch === p.idx) &&this.isA(s, b.what === 'nonland permanent' ? 'nonland' : b.what) && (!b.onlyC || s.fx.mana.colors.includes('C'))) u.push({ src: s, colors: b.sym ? [b.sym] : colors, land: s.fx.type.land });
    }
    // Cryptolith Rite, Enduring Vitality: every creature taps for any color
    if (p.battlefield.some(o => o.fx.manaAnthem || o.fx.attachMana)) {
      // (Incubation Druid-style: only creatures with a counter on them)
      const kinds = new Set(p.battlefield.map(o => o.fx.manaAnthem).filter(Boolean));
      // (Gemhide Sliver, Esika: only creatures of a kind)
      const tribal = [...kinds].filter(k => typeof k === 'object');
      for (const c of p.battlefield) {
        if (c === exclude || !c.fx.type.creature || c.fx.mana || c.tapped || !this.canTapNow(p, c)) continue;
        // (Incubation Druid: creatures with counters; Jaheira: tokens; Ashaya: nontoken creatures are Forests)
        const any = kinds.has(true) || (kinds.has('counters') && c.counters > 0) || (kinds.has('tokensAny') && c.token) || this.attachments(c).some(a => a.fx.attachMana)
          || tribal.some(k => this.isA(c, k.tribe) && (!k.other || !c.fx.manaAnthem));
        const ok = any || (kinds.has('tokens') && c.token) || (kinds.has('G') && !c.token);
        if (ok) u.push({ src: c, colors: any ? COLORS : ['G'], land: false });
      }
    }
    // Spirit Guides: exile from hand for one mana (used last)
    for (const c of p.hand) if (c.fx.handMana) for (const col of c.fx.handMana) u.push({ guide: c, colors: [col] });
    // Chromatic Orrery: mana can be spent as though it were any color
    if (p.battlefield.some(o => o.fx.anyColorSpend)) for (const x of u) x.colors = [...COLORS, 'C'];
    return u;
  }
  // The mana one permanent would make if tapped now (restricted mana included; it keeps its restriction in the pool)
  manaUnitsOf(p, o) {
    const prev = this.payingFor;
    this.payingFor = { all: true };
    try { return this.units(p).filter(u => u.src === o && !u.convoke); } finally { this.payingFor = prev; }
  }
  // Tapping a permanent for mana by hand: the mana goes into the pool, which empties at the end of the step
  tapForMana(p, o) {
    const us = this.manaUnitsOf(p, o);
    if (!us.length) return false;
    const before = p.pool.length;
    const trig = this.queue.length;
    this.commitPayment(p, { units: us, used: new Set(), srcs: [o] });
    // Remember what it added, so the tap can be taken back while that mana is unspent (not a source that
    // left the battlefield or discarded a hand, nor one whose tapping set off a trigger)
    o.manualTap = o.zone === 'battlefield' && !o.fx.mana?.discardHand && this.queue.length === trig ? { turn: this.turn, phase: this.phase, units: p.pool.slice(before) } : null;
    const txt = us.map(u => (u.colors.length > 1 ? '{any}' : `{${u.colors[0]}}`)).join('');
    this.log(`${this.pn(p)} taps ${this.cn(o)} for ${txt}${us.some(u => u.only) ? ` (only for creature ${us[0].only === 'creatureSpell' ? 'spells' : 'abilities'})` : ''}`, { kind: 'minor' });
    this.emit('update');
    return true;
  }
  // Taking a tap back: a source you tapped by hand this step, whose mana is all still in your pool,
  // that didn't sacrifice itself or set off a "becomes tapped" trigger
  canUntapForMana(p, o) {
    const t = o.manualTap;
    return !!t && o.tapped && o.zone === 'battlefield' && o.controller === p.idx && t.turn === this.turn && t.phase === this.phase && t.units.every(u => p.pool.includes(u));
  }
  untapForMana(p, o) {
    if (!this.canUntapForMana(p, o)) return false;
    const t = o.manualTap;
    p.pool = p.pool.filter(u => !t.units.includes(u));
    o.tapped = false;
    o.manualTap = null;
    this.log(`${this.pn(p)} untaps ${this.cn(o)} and takes its mana back`, { kind: 'minor' });
    this.emit('update');
    return true;
  }
  poolText(p) { return (p.pool || []).map(x => (x.colors.length > 1 ? '{any}' : `{${x.colors[0]}}`)).join(''); }
  // A mana combo gives its controller unbounded mana for the rest of the turn
  infinite(p) { return p.infiniteMana === this.turn && this.active === p.idx; }
  availableMana(p) { return this.infinite(p) ? 99 : this.units(p).length; }
  // avoid: colors needed by spells still to be cast this turn, kept back when paying generic costs
  // help: extra one-shot payers for this spell (convoke creatures, delve graveyard cards)
  /**
   * @param {any} p @param {any} cost @param {number} [extra] @param {any} [exclude] @param {Set<string> | null} [avoid] @param {any[]} [help]
   */
  planPayment(p, cost, extra = 0, exclude = null, avoid = null, help = []) {
    if (this.infinite(p)) return { free: true };
    const units = this.units(p, exclude).concat(help);
    const used = new Set();
    const srcs = new Set();
    const pick = (ok, generic = false) => {
      let best = -1, bs = -1e9;
      units.forEach((u, i) => {
        if (used.has(i) || !ok(u)) return;
        let s = 0;
        if (u.pool) s += 100;
        if (u.src && srcs.has(u.src)) s += 50;
        s -= u.colors.length * 2;
        if (u.land) s += 1;
        if (u.src?.fx.mana?.sac) s -= 20;
        if (u.src?.fx.type.creature) s -= 1;
        if (u.convoke || u.delve) s -= 15;
        if (u.guide) s -= 25;
        if (generic && avoid?.size && u.colors.some(c => avoid.has(c))) s -= 30;
        if (s > bs) { bs = s; best = i; }
      });
      if (best < 0) return false;
      used.add(best);
      if (units[best].src) srcs.add(units[best].src);
      return true;
    };
    for (const pip of [...cost.pips].sort((a, b) => a.length - b.length)) if (!pick(u => pip.some(c => u.colors.includes(c)))) return null;
    for (let i = 0; i < cost.generic + extra; i++) if (!pick(() => true, true)) return null;
    return { units, used, srcs: [...srcs] };
  }
  commitPayment(p, plan) {
    if (plan.free) return;
    const usedPool = new Set();
    plan.units.forEach((u, i) => { if (u.pool && plan.used.has(i)) usedPool.add(u.ref); });
    p.pool = p.pool.filter(x => !usedPool.has(x));
    for (const s of plan.srcs) {
      s.tapped = true;
      if (s.fx.watch?.length || p.battlefield.some(x => x.fx.watch?.some(w => w.ev === 'tapped'))) this.fire('tapped', { o: s, p: p.idx });
      plan.units.forEach((u, i) => { if (u.src === s && !plan.used.has(i) && !u.convoke) p.pool.push({ colors: u.colors, only: u.only }); });
      if (s.fx.mana?.sac) { this.move(s, 'graveyard'); this.fire('sac', { o: s, p: p.idx }); }
      if (s.fx.mana?.discardHand) {
        const hand = p.hand.filter(c => c !== p.casting);
        this.discard(p, hand, null);
        this.log(`${this.pn(p)} discards their hand${hand.length ? ` (${hand.length} card${hand.length === 1 ? '' : 's'})` : ''} for ${this.cn(s)}'s mana`, { kind: 'minor' });
      }
    }
    const guides = [...new Set(plan.units.filter((u, i) => u.guide && plan.used.has(i)).map(u => u.guide))];
    for (const o of guides) { this.move(o, 'exile'); this.log(`${this.pn(p)} exiles ${this.cn(o)} from their hand for mana`, { kind: 'minor' }); }
    const delved = plan.units.filter((u, i) => u.delve && plan.used.has(i)).map(u => u.delve);
    for (const o of delved) this.move(o, 'exile');
    if (delved.length) this.log(`${this.pn(p)} exiles ${delved.length} card${delved.length === 1 ? '' : 's'} from their graveyard (delve)`, { kind: 'minor', rule: '702.66a' });
    this.payingFor = null;
  }
  // Convoke creatures and delve cards that can help pay for this spell
  helpUnits(p, o) {
    const out = [];
    // (Dazzling Theater, Hoarding Broodlord: some spells you cast have convoke)
    const convoke = o.fx.convoke || p.battlefield.some(s => s.fx.convokeGrant === 'creature' ? o.fx.type.creature : s.fx.convokeGrant === 'exile' && o.zone === 'exile');
    if (convoke) for (const c of p.battlefield) if (c.fx.type.creature && !c.tapped && !c.fx.mana) out.push({ src: c, colors: [...(c.card.colors || []), 'C'], convoke: true });
    if (o.fx.delve) for (const c of p.graveyard) if (c !== o) out.push({ delve: c, colors: [] });
    // Improvise: tap artifacts that aren't mana sources for generic mana
    if (o.fx.kw.has('improvise') || (!o.fx.type.artifact && p.battlefield.some(s => s.fx.improviseAll))) for (const c of p.battlefield) if (c.fx.type.artifact && !c.tapped && !c.fx.mana) out.push({ src: c, colors: [], convoke: true });
    return out;
  }
  // A spell description from card text: "black", "green permanent", "aura, equipment, or vehicle", "zombie"
  spellIs(o, what) {
    if (!what || what === 'any') return true;
    const COLOR = { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' };
    return what.split(/,? or |, /).some(alt => alt.trim().split(/\s+/).every(w => {
      if (COLOR[w]) return (o.card.colors || []).includes(COLOR[w]);
      if (w === 'permanent') return o.fx.type.permanent;
      if (w === 'multicolored') return (o.card.colors || []).length > 1;
      if (w === 'colorless') return !(o.card.colors || []).length;
      if (w === 'historic') return o.fx.type.artifact || o.fx.type.legendary || o.fx.subtypes.includes('saga');
      if (w === 'vehicle' || w === 'aura' || w === 'equipment') return o.fx.subtypes.includes(w) || !!o.fx.type[w];
      return this.isA(o, w);
    }));
  }
  // How many permanents p controls of a type or subtype ("creature", "elf", "artifact creature")
  countControlled(p, what) { return p.battlefield.filter(o => this.isA(o, what)).length; }
  isA(o, what) {
    if (!what || what === 'permanent' || what === 'any') return true;
    return what.split(/\s+/).every(w => {
      if (w === 'nontoken') return !o.token;
      if (w === 'token') return o.token;
      if (w === 'nonland') return !o.fx.type.land;
      if (w === 'noncreature') return !o.fx.type.creature;
      if (w in o.fx.type) return o.fx.type[w];
      return o.fx.subtypes.includes(w) || o.fx.subtypes.includes(w.replace(/s$/, '')) || (o.fx.type.creature && (o.fx.kw.has('changeling') || o.fx.allTypes || !!this.players[o.controller]?.battlefield.some(s => s.fx.allTypesTeam)));
    });
  }
  // A permanent letting p cast o from their graveyard once this turn (Kess, Serra Paragon, Muldrotha)
  gyOnceSource(p, o) {
    if (this.active !== p.idx || o.owner !== p.idx || o.zone !== 'graveyard' || o.fx.type.land) return null;
    return p.battlefield.find(s => s.fx.gyCastOnce && s.gyOnceTurn !== this.turn && s.fx.gyCastOnce.types.some(t => o.fx.type[t]) && (s.fx.gyCastOnce.maxMv == null || (o.card.cmc || 0) <= s.fx.gyCastOnce.maxMv)) || null;
  }
  handOnlyAgainst(p) { return this.opponents(p).some(q => q.battlefield.some(o => o.fx.handOnly)); }
  // n other cards of a color in hand to exile for an alternative cost (cheapest first), or null
  pitchCards(p, o, color, n) {
    const pool = p.hand.filter(c => c !== o && !c.fx.type.land && (c.card.colors || []).includes(color)).sort((a, b) => (a.card.cmc || 0) - (b.card.cmc || 0));
    return pool.length >= n ? pool.slice(0, n) : null;
  }
  // The creature a Flare would sacrifice: the least valuable one that fits (never a commander)
  altSacFodder(p, o) {
    return p.battlefield.filter(x => x.fx.type.creature && !x.isCommander && this.spellIs(x, o.fx.altSac)).sort((a, b) => p.agent.value(this, a) - p.agent.value(this, b))[0] || null;
  }
  // A card in hand that shares a color with o, to exile for a Force of Will style pitch cost
  pitchCard(p, o) {
    const colors = o.card.colors || [];
    return p.hand.find(c => c !== o && !c.fx.type.land && (c.card.colors || []).some(x => colors.includes(x)));
  }
  dynValue(p, d, ctx = {}) {
    if (d.dyn === 'devotion') return p.battlefield.reduce((s, o) => s + parseCost(o.card.manaCost).pips.filter(pip => pip.includes(d.color)).length, 0);
    if (d.dyn === 'count') return p.battlefield.filter(o => o.fx.type[d.what]).length;
    if (d.dyn === 'hand') return p.hand.length;
    if (d.dyn === 'gy') return p.graveyard.length;
    if (d.dyn === 'maxPower') return Math.max(0, ...p.battlefield.filter(o => o.fx.type.creature).map(o => this.power(o)));
    if (d.dyn === 'maxToughness') return Math.max(0, ...p.battlefield.filter(o => o.fx.type.creature).map(o => this.toughness(o)));
    if (d.dyn === 'sacPower') return p.lastSacPower || 0;
    if (d.dyn === 'sacMv') return p.lastSacMv || 0;
    if (d.dyn === 'opps') return this.opponents(p).length;
    if (d.dyn === 'oppMaxHand') return Math.max(0, ...this.opponents(p).map(q => q.hand.length));
    if (d.dyn === 'tappedCreatures') return p.battlefield.filter(o => o.fx.type.creature && o.tapped).length;
    if (d.dyn === 'maxMv') return Math.max(0, ...p.battlefield.filter(o => this.isA(o, d.what)).map(o => o.card.cmc || 0));
    if (d.dyn === 'toSeven') return Math.max(0, 7 - p.hand.length);
    if (d.dyn === 'selfPower') return ctx.src ? Math.max(0, ctx.src.zone === 'battlefield' ? this.power(ctx.src) : this.basePower(ctx.src.card) + (ctx.src.lastCounters || 0)) : 0;
    if (d.dyn === 'oppMax') return Math.max(0, ...this.opponents(p).map(q => this.countControlled(q, d.what)));
    if (d.dyn === 'devotionMax') return Math.max(...'WUBRG'.split('').map(c => this.dynValue(p, { dyn: 'devotion', color: c })));
    if (d.dyn === 'totalPower') return p.battlefield.filter(o => o.fx.type.creature).reduce((s, o) => s + Math.max(0, this.power(o)), 0);
    if (d.dyn === 'halfX') return Math.floor((ctx.x || ctx.trig?.x || 0) / 2);
    if (d.dyn === 'defCount') { const q = this.players[ctx.src?.attacking ?? -1]; return q ? q.battlefield.filter(o => this.isA(o, d.what)).length : 0; }
    if (d.dyn === 'halfXup') return Math.ceil((ctx.x || ctx.trig?.x || 0) / 2);
    if (d.dyn === 'attachedPower') return ctx.src?.attachedTo?.zone === 'battlefield' ? Math.max(0, this.power(ctx.src.attachedTo)) : 0;
    // Earthquake Dragon, Excalibur: the total mana value of what you control
    if (d.dyn === 'sumMv') return p.battlefield.filter(o => this.isA(o, d.what === 'historic permanent' ? 'permanent' : d.what) && (d.what !== 'historic permanent' || o.fx.type.artifact || o.fx.type.legendary || o.fx.subtypes.includes('saga'))).reduce((s, o) => s + (o.card.cmc || 0), 0);
    if (d.dyn === 'countWhere') return (d.where === 'gy' ? p.graveyard : d.where === 'all' ? this.alive().flatMap(q => q.battlefield) : p.battlefield).filter(o => this.isA(o, d.what)).length;
    // "That many", "its power": from the event that set off the trigger
    const t = ctx.trig || {};
    if (d.dyn === 'trigN') return t.n ?? 1;
    if (d.dyn === 'trigP') return t.o ? Math.max(0, this.power(t.o)) : 0;
    if (d.dyn === 'trigT') return t.o ? Math.max(0, this.toughness(t.o)) : 0;
    if (d.dyn === 'trigMV') return t.o?.card.cmc || 0;
    return 0;
  }
  // How p could pay for o right now: its normal cost (with convoke/delve help) or an alternative
  // (what's being paid for decides which restricted mana can help: see spendOk)
  castMode(p, o) {
    const prev = this.payingFor;
    this.payingFor = { o, ability: false };
    try { return this.castModeRaw(p, o); } finally { this.payingFor = prev; }
  }
  castModeRaw(p, o) {
    // Morph, megamorph, disguise (702.37, 702.168): cast face down as a 2/2 for {3} at sorcery speed
    const faceDownOk = this.canCastFaceDown(p, o);
    if (o.fx.type.land && faceDownOk) return { alt: 'morph' };
    if (o.fx.type.land || (!o.card.manaCost && !o.fx.altFree && !o.fx.suspend)) return null;
    // A signature spell needs its oathbreaker on the battlefield
    if (o.signature && o.zone === 'command' && !p.battlefield.some(x => x.oathbreaker)) return null;
    // Savage Beating, Take the Bait, Berserk: only at certain points of combat
    const cw = o.fx.castWhen;
    if (cw && !(cw === 'myCombat' ? this.phase === 'combat' && this.active === p.idx : cw === 'oppCombat' ? this.phase === 'combat' && this.active !== p.idx : ['upkeep', 'draw', 'main1', 'combat'].includes(this.phase))) return null;
    // Silence, Orim's Chant
    if (this.silenced[p.idx] === this.turn) return null;
    // Grand Abolisher, Dragonlord Dromoka: opponents can't cast spells during its controller's turn
    if (this.active !== p.idx && this.players[this.active]?.battlefield.some(x => x.fx.noCastMyTurn && (x.fx.noCastMyTurn !== 'attached' || x.attachedTo))) return null;
    if (o.zone !== 'hand' && o.zone !== 'stack' && this.handOnlyAgainst(p)) return null;
    if (this.spellCapped(p, o)) return null;
    if (o.zone === 'graveyard') {
      if (o.fx.flashback && this.planPayment(p, parseCost(o.fx.flashback), 0) && this.canPayCosts(p, o, o.fx.flashbackCosts, o)) return { alt: 'flashback' };
      // Past in Flames, Snapcaster Mage: flashback for its mana cost this turn
      if (o.tempFlashback === this.turn && o.card.manaCost && this.planPayment(p, parseCost(o.card.manaCost), 0)) return { alt: 'flashback', granted: true };
      // Lier, Disciple of the Drowned: instants and sorceries in your graveyard have flashback
      if ((o.fx.type.instant || o.fx.type.sorcery) && o.owner === p.idx && o.card.manaCost && p.battlefield.some(x => x.fx.gyFlashbackAll) && this.planPayment(p, parseCost(o.card.manaCost), 0)) { o.tempFlashback = this.turn; return { alt: 'flashback', granted: true }; }
      // Underworld Breach: escape for the mana cost plus exiling three other cards from the graveyard
      if (!o.fx.type.land && o.card.manaCost && p.battlefield.some(x => x.fx.breach) && p.graveyard.length >= 4 && this.planPayment(p, parseCost(o.card.manaCost), 0)) return { alt: 'escape' };
      // The card's own escape cost (702.138), and jump-start (mana cost plus a discard, 702.133)
      if (o.fx.escape && p.graveyard.length > o.fx.escape.n && this.planPayment(p, parseCost(o.fx.escape.cost), 0)) return { alt: 'escapeOwn' };
      if (o.fx.jumpstart && p.hand.length && this.planPayment(p, parseCost(o.card.manaCost), 0)) return { alt: 'jumpstart' };
      // Gravecrawler, Squee: castable from the graveyard (sometimes only while a condition holds)
      if (o.fx.gyCastSelf && o.owner === p.idx && (!o.fx.gyCastSelf.cond || this.evalCond(p, o, o.fx.gyCastSelf.cond, {})) && this.planPayment(p, this.costOf(p, o).c, 0)) return { alt: null };
      // Yawgmoth's Will, Chainer: cast (some) spells from your graveyard this turn
      const gc = p.gyCast;
      if (gc?.turn === this.turn && o.owner === p.idx && !o.fx.type.land && (!gc.types.length || gc.types.some(t => o.fx.type[t])) && this.planPayment(p, this.costOf(p, o).c, 0)) return { alt: null };
      // Kess, Serra Paragon, Muldrotha: one such spell each of your turns
      const once = this.gyOnceSource(p, o);
      if (once && this.planPayment(p, this.costOf(p, o).c, 0)) return { alt: null, gyOnce: once.iid };
      return null;
    }
    // Cards that may be played from exile (impulse draw) or from the top of the library
    // Foretold and plotted cards: cast on a later turn for the foretell cost, or free at sorcery speed (plot)
    if (o.zone === 'exile' && o.foretold != null && o.owner === p.idx) {
      if (o.foretold >= this.turn) return null;
      if (o.fx.foretell) return this.planPayment(p, parseCost(o.fx.foretell), 0) ? { alt: 'foretold' } : null;
      return this.active === p.idx && (this.phase === 'main1' || this.phase === 'main2') && !this.stack.length ? { alt: 'free' } : null;
    }
    if (o.zone === 'exile' && !(o.mayPlay && o.mayPlay.p === p.idx && o.mayPlay.until >= this.turn) && !(o.fx.gyCastSelf?.exile && o.owner === p.idx)) return null;
    // Urza, Lord High Artificer: the exiled card may be played without paying its mana cost
    if (o.zone === 'exile' && o.mayPlay?.free && o.mayPlay.p === p.idx) return { alt: 'free' };
    // Lavinia: opponents can't cast noncreature spells costing more than their land count
    if (!o.fx.type.creature && (o.card.cmc || 0) > p.battlefield.filter(x => x.fx.type.land).length && this.opponents(p).some(q => q.battlefield.some(s => s.fx.landCap))) return null;
    // Rakdos, Lord of Riots: castable only when its condition holds
    if (o.fx.castCond && !this.evalCond(p, o, o.fx.castCond, {})) return null;
    if (o.zone === 'library' && !this.topPlayable(p, o)) return null;
    if (o.fx.lifeCost && p.life <= o.fx.lifeCost) return null;
    if (o.fx.addCost && !this.canPayCosts(p, o, o.fx.addCost, o)) return null;
    // An AI pilot only casts a pact it can pay for next turn (on top of pacts already owed)
    const pact = o.fx.spell.find(e => e.k === 'pact');
    if (pact && !p.agent.human) {
      const owed = (p.pacts || []).reduce((s, x) => s + parseCost(x.cost).generic + parseCost(x.cost).pips.length, 0);
      const need = parseCost(pact.cost).generic + parseCost(pact.cost).pips.length;
      if (this.sources(p).reduce((a, s) => a + (s.fx.mana?.amount || 1), 0) + p.battlefield.filter(x => x.tapped && x.fx.mana).reduce((a, s) => a + s.fx.mana.amount, 0) < owed + need) return null;
    }
    const { c, extra } = this.costOf(p, o);
    // Overload (702.96): when affordable, the "each" version is cast instead
    if (o.fx.overload && this.planPayment(p, parseCost(o.fx.overload), extra)) return { alt: 'overload' };
    // Miracle: its first draw this turn can be cast for the miracle cost
    if (o.fx.miracle && o.zone === 'hand' && o.miracleTurn === this.turn && this.planPayment(p, parseCost(o.fx.miracle), 0)) return { alt: 'miracle' };
    if (o.card.manaCost && this.planPayment(p, c, extra, null, null, this.helpUnits(p, o))) return { alt: null };
    if (faceDownOk) return { alt: 'morph' };
    // Suspend (702.62): exiled with time counters for its suspend cost, cast free later (only on its owner's own turn, at sorcery timing)
    if (o.fx.suspend && o.zone === 'hand' && this.active === p.idx && (this.phase === 'main1' || this.phase === 'main2') && !this.stack.length && this.planPayment(p, parseCost(o.fx.suspend.cost), 0)) return { alt: 'suspend' };
    // Cheaper ways in when the full cost is out of reach: dash and blitz (haste, back at end of turn), spectacle
    if (o.fx.dash && this.planPayment(p, parseCost(o.fx.dash), 0)) return { alt: 'dash' };
    if (o.fx.blitz && this.planPayment(p, parseCost(o.fx.blitz), 0)) return { alt: 'blitz' };
    if (o.fx.spectacle && this.opponents(p).some(q => q.lostLifeTurn === this.turn) && this.planPayment(p, parseCost(o.fx.spectacle), 0)) return { alt: 'spectacle' };
    if (o.fx.altFree === 'commander' && p.battlefield.some(x => x.isCommander)) return { alt: 'free' };
    // Rooftop Storm: zombie creature spells are free; Invigorate: free with a Forest (an opponent gains 3 life)
    if (o.fx.type.creature && p.battlefield.some(s => s.fx.freeTribe && this.isA(o, s.fx.freeTribe))) return { alt: 'free' };
    if (o.fx.altFree === 'forestGift' && p.battlefield.some(x => x.fx.subtypes.includes('forest'))) return { alt: 'forestGift' };
    // Foretell and plot from the hand (on your own turn, at sorcery speed) when it can't be cast now
    const sorc = o.zone === 'hand' && this.active === p.idx && (this.phase === 'main1' || this.phase === 'main2') && !this.stack.length;
    if (sorc && o.fx.foretell && this.planPayment(p, { generic: 2, pips: [], x: 0 }, 0)) return { alt: 'foretell' };
    if (sorc && o.fx.plot && this.planPayment(p, parseCost(o.fx.plot), 0)) return { alt: 'plot' };
    // Impending (the Overlords): cheaper, and not a creature for a few turns
    if (o.zone === 'hand' && o.fx.impending && this.planPayment(p, parseCost(o.fx.impending.cost), 0)) return { alt: 'impending' };
    if (o.fx.altFree === 'pitch' && this.pitchCard(p, o)) return { alt: 'pitch' };
    // Mindbreak Trap: free once an opponent has cast three spells this turn
    if (o.fx.altFree === 'storm3' && this.opponents(p).some(q => q.turnSpells?.turn === this.turn && q.turnSpells.n >= 3)) return { alt: 'free' };
    if (o.fx.evoke && this.planPayment(p, parseCost(o.fx.evoke), 0)) return { alt: 'evoke' };
    // (1.7.0) Solitude, Fury, Endurance: evoke by exiling a card of its color; Flares, Commandeer, Daze
    if (o.zone === 'hand' && o.fx.evokePitch && this.pitchCards(p, o, o.fx.evokePitch, 1)) return { alt: 'evokePitch' };
    if (o.zone === 'hand' && o.fx.altPitch && this.pitchCards(p, o, o.fx.altPitch.color, o.fx.altPitch.n)) return { alt: 'altPitch' };
    if (o.fx.altSac && this.altSacFodder(p, o)) return { alt: 'altSac' };
    if (o.fx.altBounce && p.battlefield.some(x => x.fx.type.land && (o.fx.altBounce === 'land' || x.fx.subtypes.includes(o.fx.altBounce)))) return { alt: 'altBounce' };
    // Baleful Mastery: a cheaper alternative mana cost
    if (o.fx.altMana && (!o.fx.altManaCond || this.evalCond(p, o, o.fx.altManaCond, {})) && this.planPayment(p, parseCost(o.fx.altMana), 0)) return { alt: 'altMana' };
    // Snuff Out, Dismember-style: pay life instead of the mana cost
    const al = o.fx.altLife;
    if (al && p.life > al.n + 6 && (!al.cond || this.evalCond(p, o, al.cond, {}))) return { alt: 'life' };
    return null;
  }
  costOf(p, o) {
    const c = parseCost(o.card.manaCost);
    // Cost reducers (Goblin Electromancer, Foundry Inspector…) only lower the generic part
    // (The Ur-Dragon's eminence also works from the command zone)
    for (const s of [...p.battlefield, ...(p.command || []).filter(x => x.fx.costReduce?.cmdZone)]) {
      const r = s.fx.costReduce;
      if (!r || s === o || !(r.what === 'chosen' ? !!s.chosenType && o.fx.type.creature && o.fx.subtypes.includes(s.chosenType) : this.reduces(r.what, o))) continue;
      if (r.minPower && !(this.basePower(o.card) >= r.minPower)) continue;
      if (r.minMv && !((o.card.cmc || 0) >= r.minMv)) continue;
      if (r.from && !r.from.includes(o.zone)) continue;
      // "The first creature spell you cast each turn"
      if (r.first && this.castThisTurn(p).some(x => this.reduces(r.what, x))) continue;
      // Alisaie: only the second spell each turn
      if (r.second && this.castThisTurn(p).length !== 1) continue;
      c.generic = Math.max(0, c.generic - r.n);
    }
    // Thalia, Sphere of Resistance: spells cost more
    for (const q of this.alive()) for (const s of q.battlefield) {
      const tx = s.fx.costTax;
      if (tx && (!tx.oppOnly || q !== p) && this.reduces(tx.what, o) && (!tx.offTurn || this.active !== p.idx) && (!tx.fromGyExile || o.zone === 'graveyard' || o.zone === 'exile')) c.generic += tx.n;
      // Helm of Awakening: every spell costs less
      if (s.fx.costReduceAll) c.generic = Math.max(0, c.generic - s.fx.costReduceAll);
    }
    // Affinity for artifacts (702.41)
    if (o.fx.affinity) c.generic = Math.max(0, c.generic - p.battlefield.filter(x => x.fx.type.artifact).length);
    // "~ costs {1} less to cast for each creature on the battlefield", "… if you control …"
    const sr = o.fx.selfReduce;
    if (sr) {
      let k = 0;
      if (sr.cond) k = this.evalCond(p, o, sr.cond, {}) ? 1 : 0;
      else if (sr.dyn) k = this.dynValue(p, sr.dyn);
      else {
        const pool = sr.where === 'gy' ? p.graveyard : sr.where === 'all' ? this.alive().flatMap(q => q.battlefield) : sr.where === 'opp' ? this.opponents(p).flatMap(q => q.battlefield) : p.battlefield;
        k = pool.filter(x => this.isA(x, sr.each.replace(/ cards?$/, ''))).length;
      }
      c.generic = Math.max(0, c.generic - sr.n * k);
    }
    return { c, extra: o.zone === 'command' ? 2 * (p.castCount[o.iid] || 0) : 0 };
  }
  // The top card of p's library, when a permanent lets them play it (Courser of Kruphix, Future Sight)
  topPlayable(p, o) {
    if (p.library[p.library.length - 1] !== o) return false;
    return p.battlefield.some(s => {
      const k = s.fx.playTop;
      if (!k) return false;
      // The Reality Chip: only while attached; Augur of Autumn: only with coven
      if (s.fx.playTopAttached && !s.attachedTo) return false;
      if (s.fx.playTopCond && !this.evalCond(p, s, s.fx.playTopCond, {})) return false;
      if (k === 'historic') return o.fx.type.artifact || o.fx.type.legendary || o.fx.subtypes.includes('saga');
      if (k === 'all') return true;
      if (k === 'land') return o.fx.type.land;
      if (o.fx.type.land) return false;
      return k === 'spell' || this.isA(o, k);
    });
  }
  // The cost of an alternative way to cast (or extra costs added on top)
  altCost(o, alt) {
    const k = { morph: '{3}', bestow: o.fx.bestow, mutate: o.fx.mutate, madness: o.fx.madness, cleave: o.fx.cleave, aftermath: o.card.manaCost, fuse: o.card.altFace ? `${o.card.manaCost}${o.card.altFace.manaCost}` : null, foretold: o.fx.foretell, foretell: '{2}', plot: o.fx.plot, impending: o.fx.impending?.cost, flashback: o.tempFlashback === this.turn && !o.fx.flashback ? o.card.manaCost : o.fx.flashback, evoke: o.fx.evoke, miracle: o.fx.miracle, suspend: o.fx.suspend?.cost, overload: o.fx.overload, altMana: o.fx.altMana, escape: o.card.manaCost, escapeOwn: o.fx.escape?.cost, jumpstart: o.card.manaCost, dash: o.fx.dash, blitz: o.fx.blitz, spectacle: o.fx.spectacle }[alt];
    return k != null ? parseCost(k) : { generic: 0, pips: [], x: 0 };
  }
  addCost(a, b) { return { generic: a.generic + b.generic, pips: [...a.pips, ...b.pips], x: a.x + b.x }; }
  reduces(what, o) {
    const t = o.fx.type;
    return { any: true, creature: t.creature, noncreature: !t.creature, artifact: t.artifact, enchantment: t.enchantment, 'instant and sorcery': t.instant || t.sorcery, instant: t.instant, sorcery: t.sorcery, legendary: t.legendary }[what]
      // "blue spells", "red or green", "colorless", "artifact or enchantment"
      ?? this.spellIs(o, what);
  }
  canCast(p, o) { return !!this.castMode(p, o); }
  // The spells p has cast this turn (Rule of Law, Conduit of Ruin)
  castThisTurn(p) { return p.castList?.turn === this.turn ? p.castList.list : []; }
  // Rule of Law, Deafening Silence, Ethersworn Canonist: one spell (of a kind) per player each turn
  spellCapped(p, o) {
    for (const q of this.alive()) for (const s of q.battlefield) {
      const cap = s.fx.spellCap;
      if (!cap) continue;
      const kind = cap === 'any' ? () => true : cap === 'noncreature' ? x => !x.fx.type.creature : x => !x.fx.type.artifact;
      if (kind(o) && this.castThisTurn(p).some(kind)) return true;
    }
    return false;
  }
  // Ward on a permanent, its own or granted (Bronze Guardian, Innkeeper's Talent): { n: mana, life }
  wardOf(o) {
    let n = o.fx.ward || 0, life = o.fx.wardLife || 0;
    for (const s of this.players[o.controller].battlefield) {
      const w = s.fx.wardGrant;
      if (!w || (w.other && s === o)) continue;
      if (w.counters ? !(o.counters > 0 || (o.named && Object.values(o.named).some(v => v > 0))) : !(w.what === 'commander' ? o.isCommander : this.spellIs(o, w.what))) continue;
      n = Math.max(n, w.n); life = Math.max(life, w.life);
    }
    return { n, life };
  }
  // "Damage can't be prevented" (Questing Beast, Sunspine Lynx)
  noPrevent() { return this.alive().some(q => q.battlefield.some(s => s.fx.noPrevent)); }

  // ---------- zones
  move(o, to, opts = {}) {
    const p = this.players[o.owner];
    const from = o.zone;
    // Grafdigger's Cage, Soulless Jailer: cards in graveyards (and libraries) can't enter the battlefield
    if (to === 'battlefield' && (from === 'graveyard' || from === 'library') && this.alive().some(q => q.battlefield.some(s => s.fx.gyLock && (from === 'graveyard' || s.fx.gyLock.lib) && (s.fx.gyLock.what === 'permanent' || o.fx.type.creature)))) {
      this.log(`${this.cn(o)} can't enter the battlefield from the ${from}`, { kind: 'minor' });
      return o;
    }
    // Exile-instead replacements decide whether it "dies" at all: Rest in Peace, Yawgmoth's Will (this turn, your
    // cards), and Liesa, Gisa, The Darkness Crystal (opponents' creatures)
    let dieExiler = null;
    if (to === 'graveyard' && !o.fx.shuffleOnGy) {
      if (this.alive().some(q => q.battlefield.some(s => s.fx.rip)) || (!o.token && p.gyExileTurn === this.turn)) to = 'exile';
      else if (from === 'battlefield' && o.fx.type.creature) {
        dieExiler = this.alive().find(q => q.idx !== o.controller && q.battlefield.some(s => s.fx.oppDieExile && (!s.fx.oppDieExile.nontoken || !o.token))) || null;
        if (dieExiler) to = 'exile';
      }
    }
    // God-Eternals: third from the top of the library instead of the graveyard or exile
    if (from === 'battlefield' && (to === 'graveyard' || to === 'exile') && o.fx.godEternal && !o.token && !o.isCommander) { to = 'library'; opts = { ...opts, third: true }; this.log(`${this.cn(o)} is put into its owner's library third from the top`, { kind: 'minor' }); }
    const died = from === 'battlefield' && to === 'graveyard' && o.fx.type.creature;
    // (the table animates draws, discards, deaths and exiles; it reads the card's spot before it moves)
    this.emit('move', { iid: o.iid, owner: o.owner, from, to, died, token: !!o.token });
    // A permanent sits on its controller's battlefield, which isn't always its owner's
    const fromArr = from === 'battlefield' ? this.players[o.controller].battlefield : p[from];
    if (Array.isArray(fromArr)) { const i = fromArr.indexOf(o); if (i >= 0) fromArr.splice(i, 1); }
    let snap = null;
    if (from === 'battlefield') {
      // What the permanent was like as it left (undying, persist, modular and "when it leaves" look back at it)
      const ctl = this.players[o.controller];
      snap = { counters: o.counters, minus: !!o.hadMinus, controller: o.controller, blitzed: !!o.blitzed };
      ctl.leftTurn = this.turn;
      for (const w of o.fx.watch || []) if (w.ev === 'ltb' || (w.ev === 'selfGy' && to === 'graveyard')) this.queue.push({ o, effects: w.effects, label: w.ev === 'ltb' ? 'leaves the battlefield' : 'put into a graveyard', p: ctl });
      if (died) for (const a of this.attachments(o)) for (const w of a.fx.watch || []) if (w.ev === 'attachedDies') this.queue.push({ o: a, effects: w.effects, label: `${o.card.name} died`, p: this.players[a.controller], trig: { o, p: o.controller } });
      this.fire('leaveBf', { o, p: o.controller, ctl: o.controller, to });
      o.lastCounters = o.counters;
      this.leaveBattlefield(o);
      o.controller = o.owner;
      // Unearth: a card returned with unearth is exiled instead of going anywhere else (702.84a)
      if (o.unearthed) { o.unearthed = false; if (to !== 'exile') { to = 'exile'; this.log(`${this.cn(o)} is exiled (unearth)`, { kind: 'minor', rule: '702.84a' }); } }
      o.escaped = false;
      if (o.impending) { o.impending = 0; o.fx = o.card.fx; }
    }
    if (died) { this.diedTurn = this.turn; this.noteDeath(o, snap); }
    if (dieExiler) {
      const gain = Math.max(0, ...dieExiler.battlefield.map(s => s.fx.oppDieExile?.gain || 0));
      if (gain) { const n = this.lifeGain(dieExiler, gain); dieExiler.life += n; this.emit('life', { p: dieExiler.idx, d: n }); }
      this.log(`${this.cn(o)} is exiled instead of dying`, { kind: 'minor' });
    }
    // Blightsteel Colossus: shuffled into the library instead; Dauthi Voidwalker: opponents' cards are exiled instead
    if (to === 'graveyard' && !o.token) {
      if (o.fx.shuffleOnGy) { to = 'library'; opts = { ...opts, shuffle: true }; this.log(`${this.cn(o)} is shuffled into its owner's library instead`, { kind: 'minor' }); }
      else if (this.players.some(q => q.idx !== o.owner && !q.lost && q.battlefield.some(s => s.fx.oppGyExile))) to = 'exile';
      // "When ~ is put into a graveyard from anywhere" (Kozilek, Emrakul)
      else if (from !== 'battlefield') for (const w of o.fx.watch || []) if (w.ev === 'selfGy') this.queue.push({ o, effects: w.effects, label: 'put into a graveyard', p });
    }
    // Graveyard watchers: cards leaving your graveyard (Insidious Roots), cards arriving (The Gitrog Monster)
    if (from === 'graveyard' && to !== 'graveyard') this.fire('gyLeave', { o, p: o.owner });
    if (to === 'graveyard' && !o.token && from !== 'graveyard') this.fire('toGy', { o, p: o.owner, from });
    // A face-down permanent or spell is turned face up as it goes anywhere else (708.9)
    if (o.faceDown && to !== 'battlefield' && (from === 'battlefield' || from === 'stack')) {
      const hidden = o.card.name;
      this.restoreFace(o);
      this.log(`${esc(hidden)} is revealed: ${this.cn(o)}`, { kind: 'minor', rule: '708.9' });
    }
    // (a bestowed card is a creature card again off the battlefield; a merged permanent's other cards follow it)
    if (o.bestowed && to !== 'battlefield') { o.bestowed = false; o.fx = o.card.fx; }
    if (o.reconfigured) { o.reconfigured = false; o.fx = o.card.fx; }
    if (o.roomUnlocked && from === 'battlefield') { o.roomUnlocked = false; o.fx = o.card.fx; }
    if (o.mutBase && from === 'battlefield') this.unmerge(o, to);
    // (an adventure or the back of a modal double-faced card is the whole card again anywhere but the stack and battlefield)
    if (o.altFaceOn && to !== 'battlefield' && to !== 'stack') { this.mainFace(o); if (to !== 'exile') o.onAdventure = false; }
    if (o.token && to !== 'battlefield') { o.zone = 'gone'; return o; }
    o.mayPlay = null;
    o.cmdStay = false;
    if (o.isCommander && !opts.stay && ['graveyard', 'exile', 'hand', 'library'].includes(to) && !p.lost) {
      // Rules 5: the owner may choose (903.9). To a graveyard or exile it goes there and the choice is made as a
      // state-based action (Game.commanderChoices); to a hand or library it's a replacement, decided now.
      if (this.rules >= 5 && (to === 'graveyard' || to === 'exile')) o.cmdChoicePending = true;
      else if (this.rules >= 5 && p.agent.commanderToCommandZone && !p.agent.commanderToCommandZone(this, p, o, to)) {
        o.cmdStay = true;
        this.log(`${this.pn(p)} lets ${this.cn(o)} go to their ${to} instead of the command zone`, { kind: 'minor', rule: '903.9b' });
      } else {
        this.log(`${this.cn(o)} returns to ${this.pn(p)}'s command zone`, { rule: to === 'graveyard' || to === 'exile' ? '903.9a' : '903.9b' });
        to = 'command';
      }
    }
    o.zone = to;
    if (to === 'battlefield') {
      o.controller = opts.under ?? o.owner; this.players[o.controller].battlefield.push(o);
      o.ts = ++this.tsN;
      // A battle enters with defense counters, and its controller chooses an opponent to protect it (310.4, 310.5)
      if (o.fx.type.battle && this.rules >= 5) this.battleEnters(o);
      // (a daybound or nightbound permanent makes it day if it's neither; at night a daybound one enters transformed)
      if (this.rules >= 5 && (o.fx.daybound || o.fx.nightbound)) {
        if (!this.dayNight) { this.dayNight = 'day'; this.log('It becomes day', { kind: 'minor', rule: '726.2' }); }
        else if (this.dayNight === 'night' && o.fx.daybound && o.card.backCard) this.flipFace(o);
      }
      // Authority of the Consuls, Blind Obedience: opponents' creatures (and more) enter tapped
      const kinds = { creatures: x => x.fx.type.creature, 'creatures and nonbasic lands': x => x.fx.type.creature || (x.fx.type.land && !x.fx.type.basic), 'artifacts and creatures': x => x.fx.type.creature || x.fx.type.artifact, permanents: () => true, 'nonbasic lands': x => x.fx.type.land && !x.fx.type.basic, artifacts: x => x.fx.type.artifact };
      if (this.opponents(this.players[o.controller]).some(q => q.battlefield.some(s => s.fx.oppEnterTapped && kinds[s.fx.oppEnterTapped]?.(o)))) opts = { ...opts, tapped: true };
    }
    else if (to === 'library' && opts.bottom) p.library.unshift(o);
    else if (to === 'library' && opts.third) p.library.splice(Math.max(0, p.library.length - 2), 0, o);
    else p[to].push(o);
    if (to === 'library' && opts.shuffle) shuffle(p.library, this.rand);
    if (to === 'battlefield' && o.fx.type.land) {
      const q = this.players[o.controller];
      for (const s of q.battlefield) {
        const effects = s.fx.landfallModes ? q.agent.chooseModes(this, q, s, s.fx.landfallModes) : s.fx.landfall;
        if (effects?.length) this.queue.push({ o: s, effects, label: `landfall (${o.card.name})`, p: q });
      }
      // Bloodghast-style landfall that brings the card back from the graveyard
      for (const s of q.graveyard) if (s.fx.landfall.some(e => e.fromGy)) this.queue.push({ o: s, effects: s.fx.landfall, label: `landfall (${o.card.name})`, p: q });
    }
    if (to === 'battlefield') {
      o.lore = 0;
      o.tapped = !!opts.tapped; o.sick = true; o.damage = 0; o.usedPW = false;
      o.counters = typeof o.fx.entersCounters === 'number' ? this.moreCounters(o, o.fx.entersCounters) : 0;
      o.enteredTurn = this.turn;
      const ctl = this.players[o.controller];
      // Amulet of Vigor-style "lands you control enter untapped"
      if (o.fx.type.land && o.tapped && ctl.battlefield.some(s => s.fx.landsUntapped && (typeof s.fx.landsUntapped !== 'object' || this.isA(o, s.fx.landsUntapped.what)))) o.tapped = false;
      // Woe Strider: escapes with counters; the Overlords cast for their impending cost aren't creatures yet
      if (o.escaped && o.fx.escapeCounters) o.counters += this.moreCounters(o, o.fx.escapeCounters);
      if (o.impendingCast && o.fx.impending) {
        o.impendingCast = false;
        o.impending = o.fx.impending.n;
        o.fx = { ...o.card.fx, type: { ...o.card.fx.type, creature: false } };
        this.log(`${this.cn(o)} enters with ${o.impending} time counters (impending): it isn't a creature yet`, { kind: 'minor', rule: '702.176a' });
      }
      // Riot for the team, and "each other creature you control enters with an additional +1/+1 counter"
      if (o.fx.type.creature) for (const s of ctl.battlefield) {
        if (s === o) continue;
        if (s.fx.teamRiot && !o.token) o.counters += 1;
        const tc = s.fx.teamCounter;
        // (Arwen, Master Biomancer: as many as its toughness or power; Giada: one for each Angel already there)
        if (tc?.dynSelf || tc?.perTribe) { if (!tc.tribe || this.isA(o, tc.tribe)) { const k = tc.dynSelf === 'power' ? this.power(s) : tc.dynSelf === 'toughness' ? this.toughness(s) : ctl.battlefield.filter(x => x !== o && x.fx.type.creature && this.isA(x, tc.tribe)).length; if (k > 0) o.counters += this.moreCounters(o, k); } }
        else if (tc && (tc === 'any' || (tc.tribe ? this.isA(o, tc.tribe) : s.chosenType && this.isA(o, s.chosenType)))) o.counters += this.moreCounters(o, 1);
      }
      if (o.fx.type.planeswalker) o.loyalty = parseInt(o.card.loyalty, 10) || 3;
      this.entered(o);
    }
    return o;
  }
  // "Choose a creature type" on resolution: the commonest type among these cards (p's creatures by default)
  bestType(p, cards = p.battlefield.filter(o => o.fx.type.creature)) {
    const n = {};
    for (const c of cards) for (const s of c.fx.subtypes) n[s] = (n[s] || 0) + 1;
    return Object.entries(n).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  }
  // A permanent arrived (cast, put there, or created as a token): "whenever a creature enters" watchers,
  // evolve, bloodthirst, and the upkeep keywords that start counting now
  entered(o) {
    const p = this.players[o.controller];
    o.monstrous = false;
    // "Choose a creature type": the commonest type among the controller's creatures (Kindred Discovery, Vanquisher's Banner)
    if (o.fx.chooseType && !o.chosenType) {
      const n = {};
      for (const c of [...p.battlefield, ...p.hand, ...p.library, ...p.command]) if (c.fx.type.creature) for (const s of c.fx.subtypes) n[s] = (n[s] || 0) + 1;
      o.chosenType = Object.entries(n).sort((a, b) => b[1] - a[1])[0]?.[0] || 'human';
      this.log(`${this.cn(o)}: ${this.pn(p)} chooses ${esc(o.chosenType)}`, { kind: 'minor' });
    }
    // "As ~ enters, choose a color": the commonest color among the controller's cards (Caged Sun, Heraldic Banner)
    if (o.fx.chooses === 'a color' && !o.chosenColor) {
      const n = {};
      for (const c of [...p.battlefield, ...p.hand, ...p.library, ...p.command]) for (const col of c.card.colors || []) n[col] = (n[col] || 0) + 1;
      o.chosenColor = Object.entries(n).sort((a, b) => b[1] - a[1])[0]?.[0] || 'W';
    }
    if (o.fx.kwN?.bloodthirst && this.opponents(p).some(q => q.damagedTurn === this.turn)) o.counters += o.fx.kwN.bloodthirst;
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
      if (this.basePower(o.card) > this.power(e) || this.baseToughness(o.card) > this.toughness(e)) { e.counters++; this.log(`${this.cn(e)} evolves`, { kind: 'minor', rule: '702.100a' }); }
    }
    this.fire('enter', { o, p: p.idx });
    if (o.token) this.fire('tokenMade', { o, p: p.idx });
  }
  leaveBattlefield(o) {
    // A clone stops being a copy when it leaves (and a crewed vehicle stops being a creature)
    if (o.baseCard) { o.card = o.baseCard; o.fx = o.baseCard.fx; o.baseCard = null; }
    if (o.crewed) { o.fx = o.card.fx; o.crewed = false; }
    Object.assign(o, { tapped: false, damage: 0, deathtouched: false, counters: 0, tempP: 0, tempT: 0, tempKw: null, attachedTo: null, attacking: null, blocking: null, blockedBy: [], blocked: false, stolenBy: null, stolenFrom: null, hadMinus: false, regen: 0, suspected: false, chosenType: null, permKw: null, animPT: null, goaded: null, dashed: false, blitzed: false, echoDue: false, kicked: false, chosenColor: null, level: null, exerted: false });
    // Whatever this permanent was holding on to goes back to the player it was taken from (or its owner)
    for (const q of this.players) for (const s of [...q.battlefield]) {
      if (s.stolenBy !== o.iid) continue;
      const back = this.players[s.stolenFrom]?.lost ? this.players[s.owner] : this.players[s.stolenFrom];
      s.stolenBy = s.stolenFrom = null;
      if (!back || back.lost || back === q) continue;
      q.battlefield.splice(q.battlefield.indexOf(s), 1);
      s.controller = back.idx;
      Object.assign(s, { attacking: null, blocking: null, blockedBy: [], blocked: false });
      back.battlefield.push(s);
      this.log(`${this.cn(s)} returns to ${this.pn(back)} now that ${this.cn(o)} is gone`, { kind: 'minor', rule: '611.2a' });
    }
    for (const q of this.players) for (const a of [...q.battlefield]) if (a.attachedTo === o) {
      a.attachedTo = null;
      // (a bestowed Aura becomes a creature again; a reconfigured equipment creature too)
      if (a.bestowed) { this.unbestow(a); continue; }
      if (a.reconfigured) { a.reconfigured = false; a.fx = a.card.fx; continue; }
      if (a.fx.type.aura) { this.move(a, 'graveyard'); this.log(`${this.cn(a)} is put into the graveyard (not attached)`, { rule: '704.5m', kind: 'minor' }); }
    }
  }
  draw(p, n = 1, quiet = false) {
    let drawn = 0;
    // Alhammarret's Archive, Teferi's Ageless Insight: every draw but the first in your draw step is doubled
    const firstInStep = this.phase === 'draw' && this.active === p.idx && !(p.drawsThisTurn?.turn === this.turn && p.drawsThisTurn.n);
    if (n > 0 && p.battlefield.some(s => s.fx.drawDouble)) n = firstInStep ? 1 + (n - 1) * 2 : n * 2;
    // Dredge (702.52): an AI pilot with a big library swaps a draw for milling and taking the dredge card back
    if (n === 1 && !p.agent.human && this.turn) {
      const d = p.graveyard.filter(c => c.fx.dredge && p.library.length > c.fx.dredge + 8).sort((a, b) => p.agent.value(this, b) - p.agent.value(this, a))[0];
      if (d && p.agent.value(this, d) >= 2.5) {
        for (let k = 0; k < d.fx.dredge; k++) this.move(p.library[p.library.length - 1], 'graveyard');
        this.move(d, 'hand');
        this.log(`${this.pn(p)} dredges ${this.cn(d)} instead of drawing (mills ${d.fx.dredge})`, { kind: 'minor', rule: '702.52a' });
        return;
      }
    }
    // Underrealm Lich: each draw looks at three, keeps one and puts the rest into the graveyard
    const lich = p.battlefield.some(s => s.fx.lichDraw);
    // Narset, Parter of Veils: an opponent's draws stop after the first each turn
    const capped = this.opponents(p).some(q => q.battlefield.some(s => s.fx.drawCap));
    // Notion Thief: an opponent's extra draws are made by the thief's controller instead
    const thief = !this.inThief && this.opponents(p).find(q => q.battlefield.some(s => s.fx.notionThief));
    for (let i = 0; i < n; i++) {
      if (thief && !(firstInStep && i === 0)) { this.inThief = true; try { this.draw(thief, 1, true); } finally { this.inThief = false; } this.log(`${this.pn(thief)} draws instead of ${this.pn(p)} (Notion Thief)`, { kind: 'minor' }); continue; }
      if (capped && p.drawsThisTurn?.turn === this.turn && p.drawsThisTurn.n >= 1) { this.log(`${this.pn(p)} can't draw more than one card this turn (Narset)`, { kind: 'minor' }); break; }
      if (lich && p.library.length > 3) for (let k = 0; k < 2; k++) this.move(p.library[p.library.length - 2], 'graveyard');
      const o = p.library.pop();
      if (!o) { p.drewFromEmpty = true; this.log(`${this.pn(p)} tries to draw from an empty library`, { rule: '704.5b' }); break; }
      o.zone = 'hand'; p.hand.push(o); drawn++; p.stats.draws = (p.stats.draws || 0) + 1;
      // Faerie Mastermind: an opponent's second draw each turn
      if (p.drawsThisTurn?.turn !== this.turn) p.drawsThisTurn = { turn: this.turn, n: 0 };
      ++p.drawsThisTurn.n;
      // Miracle (702.94): the first card drawn this turn may be cast for its miracle cost
      if (o.fx.miracle && p.drawsThisTurn.n === 1) { o.miracleTurn = this.turn; this.log(`${this.pn(p)} reveals a miracle: ${this.cn(o)}`, { kind: 'minor', rule: '702.94a' }); }
      if (this.turn) this.fire('draw', { p: p.idx, nth: p.drawsThisTurn.n });
      if (p.drawsThisTurn.n === 2) for (const q of this.opponents(p)) for (const s of q.battlefield) if (s.fx.onOppSecondDraw) this.queue.push({ o: s, effects: s.fx.onOppSecondDraw, label: `${p.name} drew their second card this turn`, p: q });
      if (i < 3) this.emit('move', { iid: o.iid, owner: p.idx, from: 'library', to: 'hand' });
      // Smothering Tithe: pay up or the watcher gets the effect
      for (const q of this.opponents(p)) for (const s of q.battlefield) {
        const od = s.fx.onOppDraw;
        if (!od) continue;
        this.queue.push({ o: s, effects: [{ k: 'tax', tax: od.tax, payer: p.idx, effects: od.effects }], label: `${p.name} drew a card`, p: q });
      }
    }
    if (!quiet && drawn) this.log(`${this.pn(p)} draws ${drawn === 1 ? 'a card' : drawn + ' cards'}`, { kind: 'minor' });
  }
  destroy(o) {
    if (this.has(o, 'indestructible')) return false;
    if (this.regenerate(o)) return false;
    // Umbra armor (702.89): the aura is destroyed instead, and the damage is removed
    const umbra = this.attachments(o).find(a => a.fx.umbra);
    if (umbra) { o.damage = 0; o.deathtouched = false; this.move(umbra, 'graveyard'); this.log(`${this.cn(umbra)} is destroyed instead of ${this.cn(o)} (umbra armor)`, { kind: 'minor', rule: '702.89a' }); return false; }
    this.move(o, 'graveyard');
    return true;
  }
  // A regeneration shield (701.15): instead of being destroyed, tap it, remove its damage and take it out of combat
  regenerate(o) {
    if (!(o.regen > 0)) return false;
    o.regen--;
    Object.assign(o, { tapped: true, damage: 0, deathtouched: false, attacking: null, blocking: null, blockedBy: [], blocked: false });
    this.log(`${this.cn(o)} regenerates`, { kind: 'minor', rule: '701.15a' });
    return true;
  }
  // A creature died (700.4): its own "when ~ dies" and every "whenever a creature dies" watcher trigger
  /** @param {any} o @param {any} [snap] */
  noteDeath(o, snap = {}) {
    this.trigger(o, 'dies');
    const p = this.players[o.owner];
    // Undying and persist bring it back with a counter, if it didn't already have one (702.93, 702.79)
    if (!o.token && o.fx.kw.has('undying') && !(snap.counters > 0)) this.queue.push({ o, effects: [{ k: 'returnSelf', counters: 1 }], label: 'undying', p });
    else if (!o.token && o.fx.kw.has('persist') && !snap.minus) this.queue.push({ o, effects: [{ k: 'returnSelf', counters: -1 }], label: 'persist', p });
    if (o.fx.kwN?.modular && snap.counters > 0) o.lastCounters = snap.counters;
    if (snap.blitzed) this.queue.push({ o, effects: [{ k: 'draw', n: 1 }], label: 'blitz', p });
    for (const q of this.alive()) for (const w of q.battlefield) {
      const d = w.fx.onDeath;
      if (!d || (d.other && w === o)) continue;
      if (d.who === 'yours' && o.controller !== q.idx) continue;
      if (d.who === 'opponents' && o.controller === q.idx) continue;
      if (d.nontoken && o.token) continue;
      if (d.what && !this.isA(o, d.what)) continue;
      if (d.without && o.fx.kw.has(d.without)) continue;
      this.queue.push({ o: w, effects: d.effects, label: `${o.card.name} died`, p: q, trig: { o, p: o.controller } });
      // Teysa Karlov: death triggers happen an additional time
      if (q.battlefield.some(x => x.fx.deathTwice)) this.queue.push({ o: w, effects: d.effects, label: `${o.card.name} died (again)`, p: q, trig: { o, p: o.controller } });
    }
  }
  sacrifice(p, o, why = '') {
    // (Fling and friends use the sacrificed creature's power)
    if (o.fx.type.creature) { p.lastSacPower = Math.max(0, this.power(o)); p.lastSacMv = o.card.cmc || 0; }
    this.log(`${this.pn(p)} sacrifices ${this.cn(o)}${why}`, { kind: 'removal' });
    this.move(o, 'graveyard');
    this.fire('sac', { o, p: p.idx });
  }
  // Discarding (701.8): "whenever you discard" watchers and madness-style payoffs see it
  /** @param {any} p @param {any[]} cards @param {string | null} [why] */
  discard(p, cards, why = '') {
    for (const c of cards) {
      // Madness (702.35): a discarded madness card is exiled instead, and its owner may cast it for the madness cost
      if (c.fx.madness && this.rules >= 5 && c.zone === 'hand') {
        this.move(c, 'exile');
        c.madnessPending = true;
        this.queue.push({ o: c, effects: [{ k: 'madnessCast' }], label: 'madness', p: this.players[c.owner] });
      } else this.move(c, 'graveyard');
      this.fire('discard', { o: c, p: p.idx });
    }
    if (cards.length && why !== null) this.log(`${this.pn(p)} discards ${cards.map(c => this.cn(c)).join(', ')}${why}`, { kind: 'removal' });
  }
  // Exile and return (blink): a new object with fresh ETB triggers, no counters, auras fall off
  blink(o) {
    const owner = this.players[o.owner];
    if (o.token) { this.move(o, 'exile'); return null; }
    this.move(o, 'exile', { stay: true });
    o.controller = owner.idx;
    this.move(o, 'battlefield');
    this.trigger(o, 'etb');
    return o;
  }
  createToken(p, e, src) {
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
    const o = this.mk(card, p, { token: true });
    o.zone = 'battlefield'; o.sick = true;
    p.battlefield.push(o);
    this.entered(o);
    return o;
  }
  createTreasure(p, src) { return this.createArtifactToken(p, 'treasure', src); }
  // Treasure, Clue, Food, Blood, Map and Powerstone tokens, with their own abilities written out as text
  createArtifactToken(p, kind, src) {
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
    const o = this.mk(card, p, { token: true });
    o.zone = 'battlefield';
    p.battlefield.push(o);
    this.entered(o);
    return o;
  }
  // Land searches (fetch lands, Cultivate, landcycling): you pick in your seat; the AI takes the colors it's short of
  async fetchLands(p, e, src) {
    const n = e.n === 'X' ? 1 : e.n;
    this.fire('search', { p: p.idx });
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
      const picked = await p.agent.chooseCardsAsync(this, p, cands, n, `<b>${src ? this.cn(src) : 'Search'}</b>: search your library for ${n > 1 ? `up to ${n} ${what} cards` : `a ${what} card`}${where}`);
      if (picked) got = picked;
    }
    got.forEach((o, i) => {
      const toBf = e.bf && !(e.split && i > 0);
      this.move(o, toBf ? 'battlefield' : 'hand', { tapped: e.tapped });
    });
    shuffle(p.library, this.rand);
    if (got.length) this.log(`${this.pn(p)} searches for ${got.map(o => this.cn(o)).join(', ')}${e.bf ? '' : ' (to hand)'}`, { kind: 'minor' });
  }

  // ---------- triggers & state-based actions
  trigger(o, kind) {
    // (a card stopped on its way in, by Grafdigger's Cage, never entered)
    if (kind === 'etb' && (o.zone !== 'battlefield' || this.etbSuppressed(this.players[o.controller]))) return;
    if (o.fx[kind]?.length || (kind === 'etb' && o.fx.etbModes)) this.queue.push({ o, kind, p: this.players[o.controller] });
  }
  // Elesh Norn, Mother of Machines (and Torpor Orb-style effects): entering doesn't trigger this player's abilities
  etbSuppressed(q) { return !!q && this.opponents(q).some(x => x.battlefield.some(s => s.fx.noEtbOpp)); }
  async flushTriggers() {
    while (this.queue.length && !this.over) {
      // Triggers that have just triggered go on the stack in APNAP order (603.3b): the active player's first, then
      // each other player's in turn order, so the last player's resolve first. They sit above any triggers still
      // waiting from before, so they resolve before those. (Rules 4 and earlier: first triggered, first resolved.)
      if (this.rules >= 5) {
        const fresh = this.queue.filter(x => !x.queued);
        if (fresh.length) {
          const n = this.players.length, a = this.active;
          const d = x => (x.p.idx - a + n) % n;
          fresh.sort((x, y) => d(y) - d(x));
          for (const x of fresh) x.queued = true;
          this.queue.splice(0, this.queue.length, ...fresh, ...this.queue.filter(x => !fresh.includes(x)));
        }
      }
      // Several of a person's triggers waiting at once: they choose the order (603.3b)
      const head = this.queue[0];
      if (!head.ordered && head.p.agent.orderTriggersAsync && !head.p.lost) {
        let n = 0;
        while (n < this.queue.length && this.queue[n].p === head.p) n++;
        const group = this.queue.slice(0, n);
        group.forEach(x => { x.ordered = true; });
        if (n > 1 && n <= 8) {
          const order = await head.p.agent.orderTriggersAsync(this, head.p, group);
          if (order?.length === n) this.queue.splice(0, n, ...order);
        }
      }
      const t = this.queue.shift();
      const { o, kind, p } = t;
      if (p.lost) continue;
      // A loop the pilots can't stop on their own (two blinkers, a trigger feeding itself) ends here
      if (this.trigCount.turn !== this.turn) this.trigCount = { turn: this.turn, n: 0 };
      // (the last triggers' sources, to tell an endless loop from a long but finite chain)
      (this.trigSig ||= []).push(`${o?.iid}:${t.label || kind}`);
      if (this.trigSig.length > 60) this.trigSig.shift();
      if (++this.trigCount.n > 600) {
        // The same few triggers repeating with nothing else happening: a loop of mandatory actions
        // nobody can stop is a draw (104.4b). Otherwise (a huge chain of different triggers) the
        // rest of the waiting triggers are skipped, as before
        if (this.trigCount.n === 601 && this.periodicTriggers()) {
          this.log('The same triggers keep repeating and no player can stop them: the game is a draw', { kind: 'loss', rule: '104.4b' });
          this.queue.length = 0;
          this.finish(null, 'a loop nobody could stop (a draw)');
          return;
        }
        if (this.trigCount.n === 601) this.log('Trigger limit for this turn reached: the rest of the waiting triggers are skipped (a loop would never end)', { kind: 'minor' });
        this.queue.length = 0;
        return;
      }
      const label = t.label || { etb: 'enters', attack: 'attack trigger', upkeep: 'upkeep trigger', endstep: 'end step trigger', dies: 'dies trigger', cast: 'cast trigger', saga: 'chapter' }[kind];
      let effects = t.effects || o.fx[kind];
      // Modal enters-the-battlefield abilities ("When ~ enters, choose one —")
      if (kind === 'etb' && o.fx.etbModes) effects = p.agent.chooseModes(this, p, o, o.fx.etbModes);
      await this.stackAbility(p, o, effects, label, 'trigger', t.trig);
      // Panharmonicon, Yarok, Roaming Throne: the ability triggers an additional time
      for (let k = this.extraTriggers(t); k > 0 && !this.over && !p.lost; k--) await this.stackAbility(p, o, kind === 'etb' && o.fx.etbModes ? p.agent.chooseModes(this, p, o, o.fx.etbModes) : effects, `${label} (again)`, 'trigger', t.trig);
      if (t.saga) o.chapterPending = false;
    }
  }

  // The last 60 triggers are one short pattern (period 1 to 6) repeated over and over
  periodicTriggers() {
    const s = this.trigSig || [];
    if (s.length < 60) return false;
    for (let k = 1; k <= 6; k++) if (s.every((x, i) => i < k || x === s[i - k])) return true;
    return false;
  }
  // Priority stops (people only): the steps where a seat played here asked to stop, or every step
  // with Full control. The AI pilots have no stopAt, so this changes nothing for them.
  async stopFor(step, active) {
    for (const q of this.order(active.idx)) {
      if (this.over || active.lost) return;
      if (!q.lost && q.agent.stopAt) await q.agent.stopAt(this, q, step, active);
    }
  }

  // How many extra times a queued trigger happens because of trigger doublers its controller has
  extraTriggers(t) {
    const { o, p } = t;
    if (!o || !p || t.saga) return 0;
    let n = 0;
    for (const s of p.battlefield) {
      const d = s.fx.trigTwice;
      if (!d) continue;
      if (d.kind === 'enter') {
        const entered = t.kind === 'etb' ? o : t.ev === 'enter' ? t.trig?.o : null;
        if (entered && entered.controller === p.idx && this.spellIs(entered, d.what || 'permanent')) n++;
      } else if (d.kind === 'attack') { if (t.kind === 'attack' || t.ev === 'allyAttacks' || t.ev === 'youAttack') n++; }
      else if (d.kind === 'any') { if (o.zone === 'battlefield' && (!d.other || o !== s) && (!d.what || this.fits(o, d.what, d.with))) n++; }
      else if (d.kind === 'chosen') { if (s.chosenType && o.zone === 'battlefield' && o !== s && this.isA(o, s.chosenType)) n++; }
      else if (d.kind === 'equipped') { if (s.attachedTo && o === s.attachedTo) n++; }
      else if (d.kind === 'self') { if ((o === s || o.attachedTo === s) && this.attachments(s).some(a => a.fx.type.equipment)) n++; }
    }
    return Math.min(n, 3);
  }
  // Generic triggers (effects.js WATCHERS): every permanent watching for this event queues its ability.
  // info: { p: the player it happened to, o: the object involved, n: amount }
  fire(ev, info = {}) {
    if (this.over) return;
    if (this.trigCount.turn !== this.turn) this.trigCount = { turn: this.turn, n: 0 };
    for (const q of this.alive()) for (const s of q.battlefield) {
      const ws = s.fx.watch;
      if (!ws?.length) continue;
      if (ev === 'enter' && this.etbSuppressed(q)) continue;
      for (const w of ws) {
        if (w.ev !== ev || (w.gate && !this.gateOk(s, w.gate))) continue;
        const r = this.watchMatches(w, s, q, info);
        if (!r) continue;
        // "Whenever one or more …" triggers once for a batch of events still waiting to resolve
        if (w.once && this.queue.some(it => it.w === w && it.o === s)) continue;
        if (++this.trigCount.n > 300) {
          if (this.trigCount.n === 301) this.log('Trigger limit for this turn reached: further triggers are skipped (a loop would never end)', { kind: 'minor' });
          return;
        }
        this.queue.push({ o: s, effects: w.effects, label: this.watchLabel(ev, info), p: q, trig: r === true ? info : r, w, ev });
      }
    }
  }
  // Abilities past a threshold: station charge counters, class level, max speed
  gateOk(s, g) {
    if (g.kind === 'charge') return (s.named?.charge || 0) >= g.n;
    if (g.kind === 'level') return (s.level || 1) >= g.n;
    if (g.kind === 'speed') return (this.players[s.controller]?.speed || 0) >= g.n;
    return true;
  }
  // A creature matching a description from card text: "artifact", "non-human", "ninja or rogue", "modified", plus "with power 4 or greater"…
  fits(o, what, w) {
    if (what && what !== 'creature' && !what.split(' or ').some(alt => alt.split(/\s+/).every(x => (x === 'modified' ? o.counters > 0 || !!o.named && Object.values(o.named).some(v => v > 0) || this.attachments(o).length > 0
      : x === 'attacking' ? o.attacking != null : x === 'commander' ? !!o.isCommander : x.startsWith('non-') ? !this.isA(o, x.slice(4))
      : ['white', 'blue', 'black', 'red', 'green', 'colorless', 'multicolored'].includes(x) ? this.spellIs(o, x) : this.isA(o, x))))) return false;
    if (!w) return true;
    let m;
    if (/counters? on (?:it|them)/.test(w)) return o.counters > 0;
    if (/greater than its base power/.test(w)) return this.power(o) > this.basePower(o.card);
    if ((m = w.match(/power (\d+) or greater/))) return this.power(o) >= +m[1];
    if ((m = w.match(/power (\d+) or less/))) return this.power(o) <= +m[1];
    if ((m = w.match(/toughness greater than its power/))) return this.toughness(o) > this.power(o);
    if ((m = w.match(/^without (\w+(?: \w+)?)/))) return !this.has(o, m[1]);
    if ((m = w.match(/with (flying|trample|deathtouch|lifelink|menace|haste|vigilance|reach|first strike|double strike)/))) return this.has(o, m[1]);
    if (/enchanted or equipped/.test(w)) return this.attachments(o).length > 0;
    if ((m = w.match(/that are (\w+) and\/or tokens/))) return !!o.token || this.isA(o, m[1].replace(/s$/, ''));
    return true;
  }
  whoOk(w, q, i) { return w.who === 'you' ? i === q.idx : w.who === 'opp' ? i !== q.idx : true; }
  watchLabel(ev, info) {
    const who = info.p != null ? this.players[info.p]?.name : '';
    const what = info.o ? info.o.card.name : '';
    return {
      gainLife: `${who} gained life`, loseLife: `${who} lost life`, draw: `${who} drew a card`, sac: `${who} sacrificed ${what}`, discard: `${who} discarded ${what}`,
      enter: `${what} entered`, tokenMade: `${who} created a token`, upkeep: 'upkeep trigger', endStep: 'end step trigger', begCombat: 'beginning of combat',
      main1: 'main phase trigger', drawStep: 'draw step trigger', youAttack: 'attack trigger', allyAttacks: `${what} attacks`, allyCombat: `${what} dealt combat damage`,
      attachedAttacks: `${what} attacks`, attachedDamage: `${what} dealt combat damage`, block: 'block trigger', blocked: 'blocked trigger', damaged: 'was dealt damage',
      selfCombat: 'combat damage trigger', targeted: 'became a target', heroic: 'heroic', anyCast: `${who} cast ${what}`,
    }[ev] || ev;
  }
  watchMatches(w, s, q, info) {
    const mine = info.p === q.idx;
    if (w.self && info.o !== s) return false;
    // A background's granted trigger needs a commander on the battlefield
    if (w.cmdr && !q.battlefield.some(o => o.isCommander)) return false;
    switch (w.ev) {
      case 'draw':
        if (w.nth && info.nth !== w.nth) return false;
        if (w.ownTurn && this.active !== info.p) return false;
        return this.whoOk(w, q, info.p);
      case 'gainLife': case 'loseLife': case 'discard': case 'tokenMade':
        if (w.ev === 'discard' && w.what && !(w.what === 'spell' ? info.o && !info.o.fx.type.creature && !info.o.fx.type.land : w.what === 'permanentCard' ? info.o?.fx.type.permanent : info.o?.fx.type[w.what])) return false;

        return w.who === 'you' ? mine : w.who === 'opp' ? !mine : true;
      // ---- 1.6.0 events
      case 'landPlay': return this.whoOk(w, q, info.p) && (!w.other || info.o !== s);
      case 'search': case 'crime': case 'ring': case 'proliferate': return this.whoOk(w, q, info.p);
      case 'counterPut':
        if (w.self) return true;
        return w.ctl === 'opp' ? info.by === q.idx && info.o.controller !== q.idx : info.o.controller === q.idx;
      case 'gyLeave': return info.p === q.idx && (!w.what || !!info.o.fx.type[w.what]);
      case 'toGy': return this.whoOk(w, q, info.p) && (!w.what || !!info.o.fx.type[w.what]) && (!w.fromBf || info.from === 'battlefield');
      case 'selfGy': case 'cycled': case 'untapped': case 'level': return !w.n || info.n === w.n;
      case 'tapped': return w.self || (info.o.controller === q.idx && this.isA(info.o, w.what));
      case 'noncombat': return info.p === q.idx && info.target !== q.idx;
      case 'main2': return mine;
      case 'damaged':
        if (w.attached) return s.attachedTo === info.o;
        if (w.what) return info.o.controller === q.idx && this.isA(info.o, w.what);
        return true;
      case 'targeted':
        if (w.what) return info.o.controller === q.idx && this.isA(info.o, w.what) && (!w.byOpp || info.p !== q.idx);
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
        return this.fits(o, w.what);
      }
      case 'sac': return (w.who === 'you' ? mine : w.who === 'opp' ? !mine : true) && this.isA(info.o, w.what === 'token' ? 'token' : w.what);
      case 'enter': {
        const o = info.o;
        if (w.other && o === s) return false;
        if (w.commander && !o.isCommander) return false;
        if (w.nontoken && o.token) return false;
        if (w.ctl === 'you' && o.controller !== q.idx) return false;
        if (w.ctl === 'opp' && o.controller === q.idx) return false;
        return this.isA(o, w.what);
      }
      case 'upkeep': case 'endStep': case 'begCombat':
        return w.whose === 'you' ? mine : w.whose === 'opp' ? !mine : true;
      case 'main1': case 'drawStep': return mine;
      case 'youAttack': {
        if (!this.whoOk({ who: w.who || 'you' }, q, info.p)) return false;
        if (w.min && info.n < w.min) return false;
        if (w.selfAttacking && s.attacking == null) return false;
        if (w.atMe && !(info.os || []).some(o => o.attacking === q.idx)) return false;
        if (!w.what && !w.with) return true;
        const n = (info.os || []).filter(o => this.fits(o, w.what, w.with)).length;
        return n ? { ...info, n } : false;
      }
      case 'allyAttacks':
        if (w.who === 'opp') return info.o.controller !== q.idx && (!w.atMe || info.o.attacking === q.idx);
        return info.o.controller === q.idx && (!w.other || info.o !== s) && (!w.commander || info.o.isCommander) && this.fits(info.o, w.what, w.with);
      case 'countered': return info.p === q.idx;
      case 'allyCombat': return info.o.controller === q.idx && (!w.other || info.o !== s) && (!w.commander || info.o.isCommander) && this.fits(info.o, w.what, w.with);
      case 'attachedAttacks': case 'attachedDamage': return s.attachedTo === info.o;
      case 'anyCast':
        if (w.who && !this.whoOk(w, q, info.p)) return false;
        if (w.nth && info.nth !== w.nth) return false;
        if (w.ownTurn && this.active !== info.p) return false;
        if (w.notHand && info.from === 'hand') return false;
        return w.what === 'any' || this.spellIs(info.o, w.what);
      default: return true;
    }
  }
  // Conditions of "if" effects, intervening-if triggers and "as long as" bonuses (effects.js parseCond)
  evalCond(p, src, c, ctx = {}) {
    const bf = p.battlefield;
    switch (c.c) {
      case 'kicked': return !!(src?.kicked || ctx.kicked);
      case 'gy': return p.graveyard.length >= c.n;
      case 'gyTypes': return new Set(p.graveyard.flatMap(o => ['creature', 'artifact', 'enchantment', 'instant', 'sorcery', 'planeswalker', 'land', 'battle'].filter(t => o.fx.type[t]))).size >= c.n;
      case 'gyType': return p.graveyard.filter(o => c.types.some(t => o.fx.type[t])).length >= c.n;
      case 'died': return this.diedTurn === this.turn;
      case 'attacked': return p.attackedTurn === this.turn;
      case 'handEmpty': return p.hand.length === 0;
      case 'power': return bf.some(o => o.fx.type.creature && this.power(o) >= c.n);
      case 'revolt': return p.leftTurn === this.turn;
      case 'coven': return new Set(bf.filter(o => o.fx.type.creature).map(o => this.power(o))).size >= 3;
      case 'totalPower': return bf.filter(o => o.fx.type.creature).reduce((s, o) => s + this.power(o), 0) >= c.n;
      case 'poison': return this.opponents(p).some(q => q.poison >= c.n);
      case 'lifeLE': return p.life <= c.n;
      case 'lifeGE': return p.life >= c.n;
      case 'commander': return bf.some(o => o.isCommander);
      case 'blessing': return bf.length >= 10 && bf.some(o => o.fx.ascend);
      case 'named': return (c.kind === '+1/+1' ? src?.counters || 0 : src?.named?.[c.kind] || 0) >= c.n;
      case 'selfAttacking': return src?.attacking != null;
      case 'selfUntapped': return !!src && !src.tapped !== !!c.neg;
      case 'controlAny': return bf.some(o => c.what.some(w => this.isA(o, w)));
      case 'oracle': return this.dynValue(p, { dyn: 'devotion', color: 'U' }) >= p.library.length;
      case 'oppMore': return this.opponents(p).some(q => this.countControlled(q, c.what) > this.countControlled(p, c.what));
      case 'myTurn': return (this.active === p.idx) !== !!c.neg;
      case 'gainedLife': return p.gainedTurn === this.turn;
      case 'castOther': return (p.turnSpells?.turn === this.turn ? p.turnSpells.n : 0) >= 2;
      case 'x': return (ctx.x || 0) >= c.n;
      case 'oppLostLife': return this.opponents(p).some(q => q.lostLifeTurn === this.turn);
      case 'bfCreatures': return this.alive().reduce((s, q) => s + q.battlefield.filter(o => o.fx.type.creature).length, 0) >= c.n;
      case 'castFromHand': return src?.castFrom === 'hand';
      case 'monarch': return this.monarch === p.idx;
      case 'gift': return false;
      case 'control': return bf.filter(o => (!c.other || o !== src) && this.isA(o, c.what)).length >= (c.n === 'X' ? 1 : c.n);
      // A condition the simulator can't read (it depends on a revealed card, say) counts as met
      default: return true;
    }
  }

  // Triggered and activated abilities use the stack too: targets are chosen as the ability is put
  // on the stack, every player gets priority, and an ability whose targets are all gone does nothing
  async stackAbility(p, src, effects, label, kind = 'ability', trig = null, x = 0) {
    if (!effects?.length) return;
    // (a human player is asked; the AI answers straight away)
    const targets = [];
    // (the X already paid, for players choosing targets for "X damage")
    this.xNow = x || null;
    try {
      for (const e of effects) targets.push(needsTarget(e) ? await (p.agent.chooseTargetAsync?.(this, p, e, src) ?? p.agent.chooseTarget(this, p, e, src)) : null);
    } finally { this.xNow = null; }
    if (!this.payWard(p, targets, src)) return;
    for (const t of targets) if (t?.obj) this.fire('targeted', { o: t.obj, p: p.idx });
    this.noteCrime(p, targets);
    const item = { o: src, p, x, targets, effects, ability: true, label, countered: false, kind, trig };

    this.stack.push(item);
    const tgtText = targets.filter(Boolean).map(t => this.tname(t)).join(', ');
    this.log(`${this.cn(src)} — ${esc(label)}${tgtText ? ` targeting ${tgtText}` : ''}`, { kind: kind === 'trigger' ? 'trigger' : 'minor', rule: kind === 'trigger' ? '603.3' : null });
    await this.beat(0.5);
    await this.priority(item);
    this.stack.splice(this.stack.indexOf(item), 1);
    if (item.countered) return;
    const chosen = targets.filter(Boolean);
    if (chosen.length && chosen.every(t => !this.validTarget(t, p))) {
      this.log(`${this.cn(src)}'s ability does nothing: its target is no longer legal`, { rule: '608.2b', kind: 'minor' });
      return;
    }
    await this.runEffects(p, src, effects, { targets, strict: true, trig, x });
  }
  sbaPass() {
    let any = false;
    for (let again = true; again;) {
      again = false;
      for (const q of this.alive()) {
        // Platinum Angel, Angel's Grace: this player can't lose right now
        if (this.cantLose(q)) continue;
        if (q.life <= 0) { this.lose(q, 'life total reached 0', '704.5a'); again = true; continue; }
        if (q.drewFromEmpty && q.battlefield.some(o => o.fx.labMan)) {
          // Laboratory Maniac, Jace: drawing from an empty library wins instead
          q.drewFromEmpty = false;
          this.winNote = 'drew from an empty library with Laboratory Maniac';
          for (const r of this.opponents(q)) this.lose(r, `${q.name} drew from an empty library and won`, '104.2b');
          continue;
        }
        if (q.drewFromEmpty) { this.lose(q, 'drew from an empty library', '704.5b'); again = true; continue; }
        if (q.poison >= (this.format.poison || 10)) { this.lose(q, `${this.format.poison || 'ten'} poison counters`, '704.5c'); again = true; continue; }
        if (this.format.cmdDamage) for (const [iid, n] of Object.entries(q.cmdDamage)) if (n >= this.format.cmdDamage) {
          const src = this.objects.get(+iid);
          this.lose(q, `${this.format.cmdDamage} combat damage from ${src.card.name}`, '903.10a'); again = true; break;
        }
      }
      for (const q of this.alive()) {
        for (const o of [...q.battlefield]) {
          if (o.fx.type.creature) {
            const t = this.toughness(o);
            if (t <= 0) { this.move(o, 'graveyard'); this.log(`${this.cn(o)} dies (0 toughness)`, { rule: '704.5f', kind: 'death' }); again = true; }
            else if ((o.damage >= t || (o.deathtouched && o.damage > 0)) && !this.has(o, 'indestructible')) {
              const dt = o.deathtouched && o.damage < t;
              if (this.regenerate(o)) continue;
              this.move(o, 'graveyard');
              this.log(`${this.cn(o)} dies`, { rule: dt ? '704.5h' : '704.5g', kind: 'death' }); again = true;
            }
          } else if (o.fx.type.planeswalker && o.loyalty <= 0) {
            this.move(o, 'graveyard'); this.log(`${this.cn(o)} has no loyalty left`, { rule: '704.5i', kind: 'death' }); again = true;
          }
          if (o.fx.saga && o.zone === 'battlefield' && !o.chapterPending && o.lore >= o.fx.saga.length) {
            this.move(o, 'graveyard'); this.log(`${this.cn(o)} is sacrificed after its final chapter`, { rule: '714.4', kind: 'minor' }); again = true;
          }
          if (o.fx.type.battle && !o.fx.type.creature && this.rules >= 5 && o.zone === 'battlefield' && (o.defense || 0) <= 0) {
            const siege = /\bsiege\b/i.test(o.card.typeLine) && !!o.card.backCard;
            this.log(`${this.cn(o)} has no defense counters left`, { rule: '704.5v', kind: 'combat' });
            this.move(o, 'graveyard'); again = true;
            if (siege) this.queue.push({ o, effects: [{ k: 'siegeCast' }], label: 'defeated', p: this.players[o.owner] });
          }
          if (o.fx.type.aura && o.zone === 'battlefield' && (!o.attachedTo || o.attachedTo.zone !== 'battlefield')) {
            if (o.bestowed) this.unbestow(o); else this.move(o, 'graveyard');
            again = true;
          }
          // Equipment on something that is no longer a creature (a Vehicle after the turn it was crewed, an animated
          // land or artifact) becomes unattached and stays on the battlefield (704.5n; found by the fuzz games)
          if (this.rules >= 5 && o.fx.type.equipment && o.zone === 'battlefield' && o.attachedTo?.zone === 'battlefield' && !o.attachedTo.fx.type.creature) {
            this.log(`${this.cn(o)} becomes unattached from ${this.cn(o.attachedTo)}, which isn't a creature`, { rule: '704.5n', kind: 'minor' });
            o.attachedTo = null;
            again = true;
          }
        }
        const legends = {};
        // (Sakashima, Mirror Gallery: the legend rule doesn't apply)
        if (!q.battlefield.some(s => s.fx.noLegendRule)) for (const o of q.battlefield) if (o.fx.type.legendary) (legends[o.card.name] ||= []).push(o);
        for (const group of Object.values(legends)) if (group.length > 1) {
          for (const o of group.slice(0, -1)) { this.move(o, 'graveyard'); this.log(`${this.cn(o)} is put into the graveyard (legend rule)`, { rule: '704.5j' }); }
          again = true;
        }
      }
      if (again) any = true;
    }
    return any;
  }
  async sba() {
    // Teferi, Time Raveler: this player's opponents can only cast spells at sorcery speed (read by the seats' instant-speed check)
    for (const q of this.players) q.sorceryLocked = this.opponents(q).some(x => x.battlefield.some(s => s.fx.oppSorcery));
    if (this.kingdoms) K.tick(this);
    for (let guard = 0; guard < 25 && !this.over; guard++) {
      let changed = this.sbaPass();
      if (await this.commanderChoices()) changed = true;
      if (this.queue.length) { await this.flushTriggers(); changed = true; }
      if (!changed) break;
    }
  }
  // 903.9a: a commander put into a graveyard or exile since the last check may go to the command zone (its owner's
  // choice; the AI keeps it there only to reanimate or recast it from there, people are asked)
  async commanderChoices() {
    let any = false;
    for (const p of this.players) for (const o of [...p.graveyard, ...p.exile]) {
      if (!o.cmdChoicePending) continue;
      o.cmdChoicePending = false;
      if (p.lost) continue;
      const back = await (p.agent.commanderToCommandZoneAsync ? p.agent.commanderToCommandZoneAsync(this, p, o, o.zone) : p.agent.commanderToCommandZone ? p.agent.commanderToCommandZone(this, p, o, o.zone) : true);
      if (back) {
        this.log(`${this.cn(o)} returns to ${this.pn(p)}'s command zone`, { rule: '903.9a' });
        this.move(o, 'command', { stay: true });
        any = true;
      } else { o.cmdStay = true; this.log(`${this.pn(p)} leaves ${this.cn(o)} in their ${o.zone}`, { kind: 'minor', rule: '903.9a' }); }
    }
    return any;
  }
  cantLose(q) { return q.cantLoseTurn === this.turn || q.battlefield.some(s => s.fx.cantLose); }
  lose(q, reason, rule) {
    if (q.lost || this.cantLose(q)) return;
    if (this.kingdoms && K.preventLoss(this, q)) return;
    q.lost = true;
    q.lossReason = reason;
    q.place = this.alive().length + 1;
    this.log(`${this.pn(q)} is eliminated — ${esc(reason)}`, { rule, kind: 'loss' });
    this.log(`All of ${this.pn(q)}'s permanents leave the game`, { rule: '800.4a', kind: 'minor' });
    // (all of them leave at once: an aura of theirs on a creature of theirs leaves the game with it,
    // rather than being put into a graveyard as "no longer attached")
    // Cards they controlled but someone else owns go back to their owners (800.4a: control effects end)
    const borrowed = q.battlefield.filter(o => o.owner !== q.idx && !this.players[o.owner]?.lost);
    const leaving = q.battlefield.filter(o => !borrowed.includes(o));
    for (const o of leaving) o.zone = 'gone';
    q.battlefield = [];
    for (const o of borrowed) {
      const back = this.players[o.owner];
      o.controller = back.idx;
      Object.assign(o, { attacking: null, blocking: null, blockedBy: [], blocked: false, stolenBy: null, stolenFrom: null });
      back.battlefield.push(o);
      this.log(`${this.cn(o)} returns to its owner, ${this.pn(back)}`, { kind: 'minor', rule: '800.4a' });
    }
    for (const o of leaving) this.leaveBattlefield(o);
    // Their cards that someone else controls leave too
    for (const r of this.players) for (const o of [...r.battlefield]) if (o.owner === q.idx) { r.battlefield.splice(r.battlefield.indexOf(o), 1); this.leaveBattlefield(o); o.zone = 'gone'; }
    this.emit('loss', q);
    // A monarch who leaves the game passes the title to the active player (or the next one) (724.4)
    if (this.monarch === q.idx) { const n = this.players[this.active].lost ? this.players[this.nextAlive(this.active)] : this.players[this.active]; this.monarch = null; if (!n.lost) this.setMonarch(n, `${q.name} left the game`); }
    if (this.kingdoms) { K.onEliminated(this, q); return; }
    // Two-Headed Giant: a team loses together (810.8a), and the team left standing wins together
    if (this.teams) {
      const mate = this.format.teams ? this.teammate(q) : null;
      if (mate) this.lose(mate, reason, '810.8a');
      const left = this.alive();
      if (left.length && !this.over && left.every(r => r.team === left[0].team)) {
        this.log(`🏆 ${left.map(r => this.pn(r)).join(' and ')} win as a team`, { kind: 'win' });
        this.finish(left[0], 'the other team is out', left);
      }
      return;
    }
    if (this.alive().length <= 1) this.finish(this.alive()[0], this.winNote || 'last player standing');
  }
  /** @param {any} winner @param {string} why @param {any[] | null} [team] */
  finish(winner, why, team = null) {
    if (this.over) return;
    this.over = true;
    this.winner = winner || null;
    // (Kingdoms: a whole team can win together)
    this.winners = team?.length ? team : winner ? [winner] : [];
    this.winReason = winner ? why : 'draw';
    for (const w of this.winners) w.place = 1;
    if (team) { this.emit('over', winner); this.emit('update'); return; }
    this.log(winner ? `🏆 ${this.pn(winner)} wins — ${esc(why)}` : 'The game is a draw', { kind: 'win' });
    this.emit('over', winner);
    this.emit('update');
  }

  // ---------- effects
  validTarget(t, p) {
    if (!t) return false;
    if (t.spell) return this.stack.includes(t.spell) && !t.spell.countered;
    if (t.obj) return this.canTarget(p, t.obj);
    return t.player != null && !this.players[t.player].lost;
  }
  // (who controls the effect resolving now: life they make others lose counts as eliminating them, for Kingdoms)
  async runEffects(p, src, effects, ctx = {}) {
    const prev = this.effectP;
    this.effectP = p?.idx ?? null;
    try { return await this.runEffects0(p, src, effects, ctx); } finally { this.effectP = prev; }
  }
  async runEffects0(p, src, effects, ctx = {}) {
    for (let i = 0; i < effects.length; i++) {
      if (this.over || p.lost) return;
      await this.doEffect(p, src, effects[i], ctx, i);
      this.sbaPass();
    }
  }
  async doEffect(p, src, e, ctx, i) {
    // X from the mana paid, or a counted amount (devotion, creatures you control) checked on resolution
    const X = v => (v === 'X' ? ctx.x || 0 : v && typeof v === 'object' ? this.dynValue(p, v, { ...ctx, src }) : v);
    const S = this.cn(src);
    let tgt = ctx.targets?.[i];
    if (needsTarget(e) && !this.validTarget(tgt, p)) {
      // A spell's chosen target that became illegal is skipped, never swapped for a new one (608.2b)
      if (ctx.strict && tgt) { this.log(`${S}: ${this.tname(tgt)} is no longer a legal target`, { kind: 'minor', rule: '608.2b' }); return; }
      tgt = p.agent.chooseTarget(this, p, e, src);
    }
    const tName = t => this.tname(t);
    // Shalai, Leyline of Sanctity-style: an opponent with hexproof can't be targeted
    if (tgt?.player != null && tgt.player !== p.idx && this.players[tgt.player]?.battlefield.some(s => s.fx.hexPlayer)) { this.log(`${S}: ${this.pn(this.players[tgt.player])} has hexproof`, { kind: 'minor' }); return; }
    switch (e.k) {
      // Rhystic Study, Smothering Tithe, Esper Sentinel: the other player pays, or the watcher gets the effect
      case 'tax': {
        const payer = this.players[e.payer];
        const plan = payer && !payer.lost && this.planPayment(payer, { generic: e.tax, pips: [], x: 0 });
        const pays = plan && (await (payer.agent.payTaxAsync ? payer.agent.payTaxAsync(this, payer, src, e) : payer.agent.payTax(this, payer, src, e)));
        if (pays) {
          this.commitPayment(payer, this.planPayment(payer, { generic: e.tax, pips: [], x: 0 }) || plan);
          this.log(`${this.pn(payer)} pays {${e.tax}} for ${S}`, { kind: 'minor' });
        } else {
          if (payer && !payer.lost) this.log(`${this.pn(payer)} doesn't pay {${e.tax}} for ${S}`, { kind: 'minor' });
          await this.runEffects(p, src, e.effects, {});
        }
        break;
      }
      case 'mill': {
        const who = e.who === 'you' ? [p] : e.who === 'that player' ? [this.thatPlayer(p, ctx)].filter(Boolean) : e.who === 'defending player' ? [this.players[src.attacking ?? -1]].filter(q => q && !q.lost) : e.who.startsWith('target') ? (tgt?.player != null ? [this.players[tgt.player]] : []) : e.who === 'each player' ? this.alive() : this.opponents(p);
        const n = (e.n?.dyn === 'theirHand' || e.n?.dyn === 'theirGy' ? 0 : X(e.n)) * (ctx.copies || 1);
        for (const q of who) {
          // Bruvac, The Water Crystal: opponents of their controller mill more
          // (Folio of Fancies: as many as the cards in their hand)
          let n2 = e.n?.dyn === 'theirHand' ? q.hand.length * (ctx.copies || 1) : e.n?.dyn === 'theirGy' ? q.graveyard.length : n;
          for (const r of this.opponents(q)) for (const s of r.battlefield) if (s.fx.millMore) n2 = s.fx.millMore.double ? n2 * 2 : n2 + s.fx.millMore.plus;
          const k = Math.min(n2, q.library.length);
          for (let j = 0; j < k; j++) this.move(q.library[q.library.length - 1], e.exile ? 'exile' : 'graveyard');
          this.log(`${this.pn(q)} mills ${k} card${k === 1 ? '' : 's'}${q.library.length ? '' : ', emptying their library'} (${S})`, { kind: k >= 20 ? 'removal' : 'minor', rule: '701.13a' });
        }
        break;
      }
      // Dramatic Reversal and friends: untapped mana sources can be tapped again right away
      case 'untapAll': {
        const kinds = { 'nonland permanents': o => !o.fx.type.land, artifacts: o => o.fx.type.artifact, creatures: o => o.fx.type.creature, lands: o => o.fx.type.land, permanents: () => true, 'nonland permanents s': o => !o.fx.type.land };
        const ok = kinds[e.what] || (() => true);
        // "untap target …": the most useful ones (mana sources first)
        let list = p.battlefield.filter(o => o.tapped && ok(o));
        // (you choose which ones in your seat; the AI takes the best mana sources)
        if (e.n && list.length > e.n) list = p.agent.chooseCostAsync ? await p.agent.chooseCostAsync(this, p, list, e.n, `${S}: choose ${e.n === 1 ? 'a permanent' : `up to ${e.n} permanents`} to untap`)
          : list.sort((a, b) => (b.fx.mana?.amount || 0) - (a.fx.mana?.amount || 0)).slice(0, e.n);
        for (const o of list) o.tapped = false;
        if (list.length) this.log(`${S} untaps ${list.length === 1 ? this.cn(list[0]) : `${list.length} of ${this.pn(p)}'s permanents`}`, { kind: 'minor' });
        break;
      }
      // Redirect Lightning: the targeted spell or ability gets a new single target of our choosing
      case 'redirect': {
        const it = tgt?.spell;
        if (!it) break;
        const idx = (it.targets || []).findIndex(Boolean);
        const pick = idx >= 0 && p.agent.redirectTarget?.(this, p, it, idx);
        if (pick) {
          const was = this.tname(it.targets[idx]);
          it.targets[idx] = pick;
          this.log(`${S} changes ${this.cn(it.o)}'s target from ${was} to ${this.tname(pick)}`, { kind: 'removal', rule: '115.7' });
        }
        break;
      }
      case 'silence': {
        const who = e.who.startsWith('target') ? (tgt?.player != null ? [this.players[tgt.player]] : []) : this.opponents(p);
        for (const q of who) this.silenced[q.idx] = this.turn;
        if (who.length) this.log(`${who.map(q => this.pn(q)).join(', ')} can't cast spells this turn (${S})`, { kind: 'removal' });
        break;
      }
      case 'adNauseam': {
        // Keep revealing while it's safe: stop around 10 life, at 12 cards, or before the library runs out
        let n = 0, lost = 0;
        while (p.library.length > 1 && n < 12) {
          const top = p.library[p.library.length - 1];
          if (p.life - (top.card.cmc || 0) < 10) break;
          this.draw(p, 1, true);
          p.life -= top.card.cmc || 0; lost += top.card.cmc || 0; n++;
        }
        if (lost) this.emit('life', { p: p.idx, d: -lost });
        this.log(`${this.pn(p)} reveals ${n} cards into their hand and loses ${lost} life (${S})`);
        break;
      }
      case 'counter': case 'counterAbility':
        if (tgt?.spell && !tgt.spell.ability && (tgt.spell.o.fx.uncounterable || tgt.spell.uncounterable || (this.rules >= 5 && tgt.spell.p?.shieldTurn === this.turn) || this.alive().some(q => q.battlefield.some(o => o.fx.noCounterAll)) || this.players[tgt.spell.o.owner]?.battlefield.some(o => o.fx.protectsSpells && (!o.fx.costReduce?.minMv || (tgt.spell.o.card.cmc || 0) >= o.fx.costReduce.minMv)))) {
          this.log(`${this.cn(tgt.spell.o)} can't be countered`, { kind: 'minor' });
          break;
        }
        if (tgt?.spell) {
          tgt.spell.countered = true;
          // (Baral: "whenever a spell or ability you control counters a spell")
          if (!tgt.spell.ability) this.fire('countered', { p: p.idx, o: tgt.spell.o });
          // Reprieve, Remand-style: the spell goes back to its owner's hand
          if (e.toHand) tgt.spell.toHand = true;
          this.log(`${this.cn(tgt.spell.o)}${tgt.spell.ability ? "'s ability" : ''} is countered`, { kind: 'removal', rule: '701.6a' });
          this.emit('update');
        }
        break;
      case 'copySpell': {
        if (!tgt?.spell) break;
        const orig = tgt.spell;
        this.log(`${this.pn(p)} copies ${this.cn(orig.o)}`, { kind: 'cast', p: p.idx, rule: '707.10' });
        await this.beat(0.8);
        const copyEffects = orig.o.fx.spell.filter(x => x.k !== 'copySpell');
        await this.runEffects(p, orig.o, copyEffects, { x: orig.x });
        break;
      }
      case 'steal': {
        const o = tgt?.obj;
        if (!o || o.controller === p.idx) break;
        const from = this.players[o.controller];
        from.battlefield.splice(from.battlefield.indexOf(o), 1);
        o.controller = p.idx;
        p.battlefield.push(o);
        from.grudge[p.idx] += 5;
        if (e.temp) {
          // Threaten effects untap it and give it haste for the turn
          Object.assign(o, { tapped: false, sick: false, tempKw: new Set([...(o.tempKw || []), 'haste']) });
          this.tempSteals.push({ o, back: from.idx });
        } else {
          o.sick = true;
          // Control Magic, Sower of Temptation: control lasts only while the source stays on the battlefield
          if (src && src !== o && (src.fx.controlAura || e.whileSrc)) Object.assign(o, { stolenBy: src.iid, stolenFrom: from.idx });
        }
        this.log(`${this.pn(p)} gains control of ${this.cn(o)}${e.temp ? ' until end of turn' : ''}`, { kind: 'removal' });
        break;
      }
      case 'discard': {
        const n = X(e.n);
        const victims = e.who === 'that player' ? [this.thatPlayer(p, ctx)].filter(Boolean) : e.who.startsWith('target') ? (tgt?.player != null ? [this.players[tgt.player]] : [])
          : e.who === 'each player' ? this.alive() : this.opponents(p);
        for (const q of victims) {
          // Thoughtseize, Cabal Therapy: the caster sees the hand and picks (a name, or a card of the given type)
          if (e.named || e.chosen) {
            const pool = q.hand.filter(o => (e.chosen?.length ? e.chosen.some(t => o.fx.type[t]) : !o.fx.type.land));
            const [pick] = await this.pickCards(p, pool, 1, `${S}: choose a card from ${this.pn(q)}'s hand`);
            const cards = pick ? q.hand.filter(o => o.card.name === pick.card.name) : [];
            this.log(`${this.pn(q)} reveals their hand (${S})`, { kind: 'minor' });
            this.discard(q, e.named ? cards : cards.slice(0, 1));
            continue;
          }
          const cards = (await q.agent.chooseDiscard(this, q, Math.min(n, q.hand.length))) || [];
          this.discard(q, cards);
        }
        break;
      }
      case 'copyToken':
        // "A token that's a copy of equipped creature / it" has no target
        if (e.of) tgt = { obj: e.of === '~' ? src : e.of === 'equipped creature' || e.of === 'enchanted creature' ? src.attachedTo : ctx.trig?.o || src };
        // (Skyclave Relic: two tapped copies of itself)
        for (let k = 1; k < (e.n || 1) && tgt?.obj?.zone === 'battlefield'; k++) { const c2 = this.createCopy(p, tgt.obj, false); if (e.tapped) c2.tapped = true; this.trigger(c2, 'etb'); }
        if (tgt?.obj && tgt.obj.zone === 'battlefield') {
          const copy = this.createCopy(p, tgt.obj, false);
          if (e.tapped) copy.tapped = true;
          // Offspring: the copy is a 1/1
          if (e.small) copy.card = { ...copy.card, power: '1', toughness: '1' };
          this.log(`${this.pn(p)} creates a ${e.small ? '1/1 ' : ''}token copy of ${this.cn(tgt.obj)}`, { kind: 'minor', rule: '707.2' });
          this.trigger(copy, 'etb');
        }
        break;
      case 'addMana':
        // ("RG": one mana of either color, Orcish Lumberjack)
        for (const c of e.syms) p.pool.push({ colors: c === '*' ? [...COLORS] : c.split('') });
        this.log(`${this.pn(p)} adds ${e.syms.map(c => (c === '*' ? '{any}' : `{${c}}`)).join('')}`, { kind: 'minor' });
        break;
      case 'sacSelf':
        if (src.zone === 'battlefield') this.sacrifice(p, src);
        break;
      case 'extraTurn':
        p.extraTurns = (p.extraTurns || 0) + (e.n || 1);
        this.log(`${this.pn(p)} will take ${e.n === 2 ? 'two extra turns' : 'an extra turn'} after this one`, { kind: 'turn', rule: '500.7' });
        break;
      case 'extraCombat':
        p.extraCombats = (p.extraCombats || 0) + (e.n || 1);
        if (e.untap) for (const o of p.battlefield) if (o.fx.type.creature) o.tapped = false;
        this.log(`${this.pn(p)} gets an additional combat phase${e.untap ? ' and untaps their creatures' : ''}`, { kind: 'turn', rule: '500.8' });
        break;
      case 'flickerDelay':
        if (tgt?.obj) {
          const o = tgt.obj;
          this.log(`${S} exiles ${tName(tgt)} until the next end step`, { kind: 'removal' });
          this.move(o, 'exile', { stay: true });
          if (!o.token) this.delayed.push(o);
        }
        break;
      case 'blink':
        if (tgt?.obj) {
          this.log(`${S} exiles ${tName(tgt)} and returns it to the battlefield`, { kind: 'minor' });
          this.blink(tgt.obj);
          await this.beat(0.5);
        }
        break;
      case 'protect': {
        const objs = e.scope === 'one' ? (tgt?.obj ? [tgt.obj] : []) : e.scope === 'self' ? [src] : e.scope === 'tokens' ? p.battlefield.filter(o => o.token && o.fx.type.creature) : p.battlefield.filter(o => !o.fx.type.land);
        for (const o of objs) o.tempKw = new Set([...(o.tempKw || []), ...e.kw]);
        if (objs.length) this.log(`${objs.length === 1 ? this.cn(objs[0]) : `${this.pn(p)}'s permanents`} gain${objs.length === 1 ? 's' : ''} ${e.kw.join(' and ')} until end of turn`, { kind: 'minor' });
        break;
      }
      // An X draw never decks its own caster (matters with infinite mana)
      case 'draw': this.draw(p, e.n === 'X' ? Math.min(X(e.n), Math.max(0, p.library.length - 1)) : X(e.n)); break;
      case 'gain': { const n = this.lifeGain(p, X(e.n)); p.life += n; this.emit('life', { p: p.idx, d: n }); this.log(`${this.pn(p)} gains ${n} life (${S})`, { kind: 'minor' }); break; }
      case 'drain': {
        const n = X(e.n) * (e.times || 1);
        for (const q of this.opponents(p)) { q.life -= n; q.grudge[p.idx] += n; this.emit('life', { p: q.idx, d: -n }); }
        // (Debt to the Deathless: you gain what they lost)
        if (e.gain) { const g = this.lifeGain(p, n * this.opponents(p).length); p.life += g; this.emit('life', { p: p.idx, d: g }); }
        this.log(`${S}: each opponent loses ${n} life`); break;
      }
      case 'loseLife': if (tgt?.player != null) { const q = this.players[tgt.player]; const n = X(e.n); q.life -= n; this.emit('life', { p: q.idx, d: -n }); this.log(`${S}: ${this.pn(q)} loses ${n} life`); } break;
      case 'damage': {
        const n = X(e.n);
        if (e.to === 'defender') {
          // "the player it's attacking": the attacker that set off the trigger, or this creature
          const att = ctx.trig?.o?.attacking ?? src.attacking;
          const q = att != null ? this.players[att] : p.agent.weakestOpponent(this, p);
          if (q && !q.lost) { this.damagePlayer(q, n, src, false); this.log(`${S} deals ${n} damage to ${this.pn(q)}`); }
        } else if (e.mult && tgt) {
          // Crackle with Power: five times X to a target
          const m = n * e.mult;
          if (tgt.obj) this.damageObj(tgt.obj, m, src); else if (tgt.player != null) this.damagePlayer(this.players[tgt.player], m, src, false);
          this.log(`${S} deals ${m} damage to ${tName(tgt)}`);
        } else if (e.to === 'that player') {
          const q = this.thatPlayer(p, ctx);
          if (q) { this.damagePlayer(q, n, src, false); this.log(`${S} deals ${n} damage to ${this.pn(q)}`); }
        } else if (e.to === 'each opponent' || e.to === 'each player') {
          for (const q of e.to === 'each player' ? this.alive() : this.opponents(p)) this.damagePlayer(q, n, src, false);
          this.log(`${S} deals ${n} damage to ${e.to}`);
        } else if (e.divided > 1 && n > 1 && this.rules >= 5) {
          // "Divided as you choose among any number of targets" (601.2d): the caster splits it (the AI kills what it
          // can and sends the rest to the chosen target; people are asked). Chosen as it resolves here.
          const legal = x => (x.obj ? x.obj.zone === 'battlefield' && x.obj.fx.type.creature && this.canTarget(p, x.obj) : e.to === 'any target' && x.player != null && !this.players[x.player]?.lost);
          let plan = await (p.agent.divideDamageAsync ? p.agent.divideDamageAsync(this, p, src, e, n, tgt) : p.agent.divideDamage(this, p, src, e, n, tgt));
          if (!Array.isArray(plan) || plan.length > e.divided || plan.some(x => !(x.n > 0) || !legal(x)) || plan.reduce((a, x) => a + x.n, 0) !== n) plan = tgt && (tgt.obj || tgt.player != null) ? [{ ...tgt, n }] : [];
          for (const x of plan) {
            if (x.obj) this.damageObj(x.obj, x.n, src); else this.damagePlayer(this.players[x.player], x.n, src, false);
          }
          if (plan.length) this.log(`${S} deals ${plan.map(x => `${x.n} to ${x.obj ? this.cn(x.obj) : this.pn(this.players[x.player])}`).join(', ')}`, { rule: '601.2d' });
        } else if (tgt?.obj) { this.damageObj(tgt.obj, n, src); this.log(`${S} deals ${n} damage to ${tName(tgt)}`); }
        else if (tgt?.player != null) { this.damagePlayer(this.players[tgt.player], n, src, false); this.log(`${S} deals ${n} damage to ${tName(tgt)}`); }
        break;
      }
      case 'remove':
        if (!tgt?.obj) { this.log(`${S} has no legal target`, { kind: 'minor' }); break; }
        if (e.mode === 'exile') { this.log(`${S} exiles ${tName(tgt)}`, { kind: 'removal' }); this.move(tgt.obj, 'exile'); }
        else if (this.destroy(tgt.obj)) this.log(`${S} destroys ${tName(tgt)}`, { kind: 'removal' });
        else this.log(`${tName(tgt)} is indestructible`, { rule: '702.12' });
        break;
      case 'bounce':
        if (tgt?.obj) {
          this.log(`${S} returns ${tName(tgt)} to its owner's hand`, { kind: 'removal' }); this.move(tgt.obj, 'hand');
          // "Return two target creatures": the second one too
          if (e.n === 2) { const t2 = p.agent.chooseTarget(this, p, { ...e, n: 1 }, src); if (t2?.obj && t2.obj.zone === 'battlefield') { this.log(`${S} returns ${tName(t2)} to its owner's hand`, { kind: 'removal' }); this.move(t2.obj, 'hand'); } }
        }
        break;
      case 'wipe': {
        let n = 0;
        for (const q of this.alive()) for (const o of [...q.battlefield]) {
          const t = o.fx.type;
          const theirs = q.idx !== p.idx;
          // (Wakening Sun's Avatar: all non-Dinosaur creatures)
          if (e.notTribe && this.isA(o, e.notTribe)) continue;
          const hit = { creatures: t.creature, 'other creatures': t.creature && o !== src, 'nonland permanents': !t.land, artifacts: t.artifact, enchantments: t.enchantment, 'artifacts and enchantments': t.artifact || t.enchantment,
            'nontoken creatures': t.creature && !o.token, 'nonartifact creatures': t.creature && !t.artifact, "creatures you don't control": t.creature && theirs, 'creatures your opponents control': t.creature && theirs,
            "nonland permanents you don't control": !t.land && theirs, planeswalkers: t.planeswalker, lands: t.land }[e.what];
          if (!hit) continue;
          if (e.mode === 'exile') { this.move(o, 'exile'); n++; } else if (this.destroy(o)) n++;
        }
        this.log(`${S} ${e.mode === 'exile' ? 'exiles' : 'destroys'} all ${e.what} — ${n} permanent${n === 1 ? '' : 's'} gone`, { kind: 'removal' });
        await this.beat(0.8);
        break;
      }
      case 'sweep': {
        const n = X(e.n);
        for (const q of this.alive()) for (const o of q.battlefield) if (o.fx.type.creature) this.damageObj(o, n, src);
        this.log(`${S} deals ${n} damage to each creature`, { kind: 'removal' });
        break;
      }
      case 'token': {
        const n = Math.min(this.tokenCount(p, X(e.n)), 40);
        let made;
        for (let k = 0; k < n; k++) {
          made = this.createToken(p, { ...e, p: X(e.p), t: X(e.t) }, src);
          // Mobilize: tapped and attacking alongside the creature, sacrificed at the end step
          if (e.attacking && src.attacking != null) Object.assign(made, { tapped: true, attacking: src.attacking, blockedBy: [], blocked: false });
          if (e.temp) (this.endSac ||= []).push(made);
        }
        if (made) this.log(`${this.pn(p)} creates ${n} ${X(e.p)}/${X(e.t)} ${esc(made.card.name)} token${n === 1 ? '' : 's'}`, { kind: 'minor' });
        if (made) this.extraTokens(p, 'creature', src);
        break;
      }
      case 'treasure': { const n = this.tokenCount(p, X(e.n)); for (let k = 0; k < n; k++) this.createTreasure(p, src); this.log(`${this.pn(p)} creates ${n} Treasure`, { kind: 'minor' }); if (n > 0) this.extraTokens(p, 'treasure', src); break; }
      case 'rampLand': await this.fetchLands(p, e, src); break;
      case 'tutor': {
        this.fire('search', { p: p.idx });
        // Transmute: a card with the same mana value
        let c = e.sameMv ? (await this.pickCards(p, p.library.filter(x => (x.card.cmc || 0) === (src.card.cmc || 0)), 1, `${S}: choose a card with mana value ${src.card.cmc || 0}`))[0]
          : p.agent.pickTutorAsync ? await p.agent.pickTutorAsync(this, p, e) : p.agent.pickTutor(this, p, e);
        // Aven Mindcensor: only the top four cards can be found
        if (c && this.opponents(p).some(q => q.battlefield.some(s => s.fx.searchTop4)) && !p.library.slice(-4).includes(c)) {
          c = p.agent.pickBest(this, p.library.slice(-4).filter(x => !e.types?.length || e.types.some(t => x.fx.type[t])));
          this.log(`${S}: Aven Mindcensor-style limit — only the top four cards can be searched`, { kind: 'minor' });
        }
        if (!c) { this.log(`${S}: ${this.pn(p)} finds nothing worth fetching`, { kind: 'minor' }); break; }
        // Opposition Agent: an opponent controls the search, and the card is exiled instead
        const agent = this.opponents(p).find(q => q.battlefield.some(o => o.fx.searchHate));
        if (agent) {
          shuffle(p.library, this.rand);
          this.move(c, 'exile');
          this.log(`${this.pn(agent)}'s Opposition Agent controls the search: ${this.cn(c)} is exiled instead`, { kind: 'removal' });
          break;
        }
        shuffle(p.library, this.rand);
        if (e.gy) { this.move(c, 'graveyard'); this.log(`${this.pn(p)} searches for ${this.cn(c)} and puts it into their graveyard`, { kind: 'minor' }); }
        else if (e.bf && c.fx.type.permanent) { this.move(c, 'battlefield'); this.log(`${this.pn(p)} searches out ${this.cn(c)} onto the battlefield`); this.trigger(c, 'etb'); }
        else if (e.top) { this.move(c, 'library'); this.log(`${this.pn(p)} searches for a card and puts it on top of their library`, { kind: 'minor' }); }
        else { this.move(c, 'hand'); this.log(`${this.pn(p)} searches their library for a card`, { kind: 'minor' }); }
        break;
      }
      case 'teamPump':
        for (const o of p.battlefield) if (o.fx.type.creature && (!e.minPower || this.power(o) >= e.minPower) && (!e.what || this.spellIs(o, e.what))) { o.tempP += X(e.p); o.tempT += X(e.t); if (e.kw.length) o.tempKw = new Set([...(o.tempKw || []), ...e.kw]); }
        this.log(`${S}: creatures ${this.pn(p)} controls get +${X(e.p)}/+${X(e.t)}${e.kw.length ? ' and ' + e.kw.join(', ') : ''}`);
        break;
      case 'pump': if (tgt?.obj) { tgt.obj.tempP += X(e.p); tgt.obj.tempT += X(e.t); if (e.kw.length) tgt.obj.tempKw = new Set([...(tgt.obj.tempKw || []), ...e.kw]); this.log(`${tName(tgt)} gets +${X(e.p)}/+${X(e.t)}`, { kind: 'minor' }); } break;
      case 'counters': {
        const n = X(e.n);
        let objs = [];
        if (e.on === 'up to') objs = p.battlefield.filter(o => o.fx.type.creature).sort((a, b) => p.agent.value(this, b) - p.agent.value(this, a)).slice(0, e.count || 1);
        else if (e.on.startsWith('target')) objs = tgt?.obj ? [tgt.obj] : [];
        else if (e.on === '~') objs = src.zone === 'battlefield' ? [src] : [];
        else if (e.on === 'attached') objs = src.attachedTo?.zone === 'battlefield' ? [src.attachedTo] : [];
        // "each green creature that entered this turn", "each artifact creature and/or vehicle you control"
        else if (e.on === 'each') objs = p.battlefield.filter(o => (o.fx.type.creature || /vehicle|artifact/.test(e.what)) && (!e.other || o !== src) && (!e.recent || o.enteredTurn === this.turn) && this.spellIs(o, e.what || 'creature'));
        else objs = p.battlefield.filter(o => o.fx.type.creature && (e.on.includes('other') ? o !== src : true));
        for (const o of objs) { const k = this.moreCounters(o, n); o.counters += k; this.fire('counterPut', { o, p: o.controller, by: p.idx, n: k }); }
        if (objs.length) this.log(`${S} puts ${n} +1/+1 counter${n === 1 ? '' : 's'} on ${objs.length === 1 ? this.cn(objs[0]) : objs.length + ' creatures'}`, { kind: 'minor' });
        break;
      }
      case 'reanimate': {
        // "from a graveyard" can take another player's card; the types it names (creature by default)
        const types = e.types?.length ? e.types : ['creature'];
        // (Sepulchral Primordial: one from each opponent's graveyard; Ink-Eyes: from that player's graveyard)
        const that = e.fromThat ? this.thatPlayer(p, ctx) : null;
        const yards = e.eachOpp ? this.opponents(p).map(q => [q]) : [that ? [that] : e.any ? this.alive() : [p]];
        for (const ys of yards) {
        // (Carmen, Alesha: mana value up to its power)
        const maxMv = e.maxMvPower ? Math.max(0, src.zone === 'battlefield' ? this.power(src) : 0) : e.maxMv;
        const pool = ys.flatMap(q => q.graveyard).filter(o => types.some(t => o.fx.type[t]) && o !== src && (maxMv == null || (o.card.cmc || 0) <= maxMv));
        const [c] = await this.pickCards(p, pool, 1, `${S}: choose a card to put onto the battlefield`);
        if (c) {
          const theirs = c.owner !== p.idx;
          this.move(c, 'battlefield', { under: p.idx });
          this.log(`${S} puts ${this.cn(c)} onto the battlefield from ${theirs ? `${this.pn(this.players[c.owner])}'s` : 'the'} graveyard`);
          this.trigger(c, 'etb');
        }
        }
        break;
      }
      case 'regrow': {
        const pool = p.graveyard.filter(o => o !== src && (e.types?.length ? e.types.some(t => o.fx.type[t]) : !o.fx.type.land) && (e.maxMv == null || (o.card.cmc || 0) <= e.maxMv));
        // ("at random": Exalted Flamer of Tzeentch)
        const got = e.random ? (pool.length ? [pool[Math.floor(this.rand() * pool.length)]] : []) : await this.pickCards(p, pool, e.n || 1, `${S}: choose ${e.n > 1 ? `up to ${e.n} cards` : 'a card'} to return to your hand`);
        for (const c of got) this.move(c, e.top ? 'library' : 'hand');
        if (got.length) this.log(`${S} returns ${got.map(c => this.cn(c)).join(', ')} to ${this.pn(p)}'s hand`, { kind: 'minor' });
        break;
      }
      case 'edict': {
        const victims = e.that ? [this.thatPlayer(p, ctx)].filter(Boolean) : e.all ? this.alive() : this.opponents(p);
        const what = e.what || 'creature';
        for (const q of victims) for (let k = 0; k < (e.n || 1); k++) {
          const c = what === 'creature' && !e.nontoken ? q.agent.pickSacrifice(this, q)
            : q.battlefield.filter(o => this.isA(o, what.replace('nonland permanent', 'nonland')) && (!e.nontoken || !o.token)).sort((a, b) => q.agent.value(this, a) - q.agent.value(this, b))[0];
          if (c) this.sacrifice(q, c);
        }
        break;
      }
      default: await this.doEffectMore(p, src, e, ctx, tgt, X); break;
    }
  }
  // Xorn, Academy Manufactor, Peregrin Took: making tokens makes an extra artifact token too
  extraTokens(p, kind, src) {
    for (const s of p.battlefield) {
      const k = s.fx.extraToken;
      if (!k || !(s.fx.extraTokenOn === 'any' || s.fx.extraTokenOn === kind || (s.fx.extraTokenOn === 'artifact' && kind !== 'creature') || (/clue, food, or treasure/.test(s.fx.extraTokenOn) && ['clue', 'food', 'treasure'].includes(kind)))) continue;
      if (k === 'treasure') this.createTreasure(p, s); else if (['food', 'clue', 'map', 'blood', 'powerstone'].includes(k)) this.createArtifactToken(p, k, s);
      // Stridehangar Automaton: an extra 1/1 Thopter (only for tokens that aren't its own Thopters)
      else if (s.fx.extraTokenStats && kind !== 'creature') this.createToken(p, { ...s.fx.extraTokenStats, desc: `colorless ${k} artifact` }, s);
      // Chatterfang: a 1/1 Squirrel for each creature token (only for tokens that aren't squirrels, so it doesn't feed itself)
      else if (k === 'squirrel' && kind !== 'squirrel') this.createToken(p, { p: 1, t: 1, desc: 'green squirrel', kw: [] }, s);
      else continue;
      this.log(`${this.cn(s)}: ${this.pn(p)} also creates a ${k[0].toUpperCase() + k.slice(1)} token`, { kind: 'minor' });
    }
  }
  // Doubling Season, Anointed Procession (twice as many tokens), and one-more effects
  tokenCount(p, n) {
    if (!(n > 0)) return n;
    // Primal Vigor: every player's tokens are doubled
    for (const q of this.alive()) for (const s of q.battlefield) if (s.fx.tokenBonusAll) n *= 2;
    for (const s of p.battlefield) { if (s.fx.tokenBonus === 'double') n *= 2; else if (s.fx.tokenBonus === 'triple') n *= 3; else if (s.fx.tokenBonus === 'plus') n += 1; }
    return n;
  }
  // Land drops this turn: one, plus Exploration-style permanents and "play an additional land this turn"
  landDrops(p) {
    return 1 + p.battlefield.reduce((s, o) => s + (o.fx.extraLands || 0), 0) + (p.extraLand?.turn === this.turn ? p.extraLand.n : 0)
      + this.alive().reduce((s, q) => s + q.battlefield.filter(o => o.fx.extraLandsAll).length, 0);
  }
  // Hardened Scales (one more) and Doubling Season-style (twice as many) +1/+1 counter replacements
  moreCounters(o, n) {
    if (n <= 0 || (!o.fx.type.creature && !this.players[o.controller]?.battlefield.some(s => s.fx.counterAny))) return n;
    const ops = [];
    if (o.fx.type.creature) for (const q of this.alive()) for (const s of q.battlefield) if (s.fx.counterBonusAll) ops.push({ mul: 2 });
    // Vorinclex, Monstrous Raider: opponents put half as many
    const putter = this.effectP ?? o.controller;
    if (this.alive().some(q => q.idx !== putter && q.battlefield.some(s => s.fx.counterHalfOpp) && this.opponents(q).some(x => x.idx === putter))) ops.push({ half: true });
    for (const s of this.players[o.controller].battlefield) {
      if (s.fx.counterBonus === 'plus') ops.push({ plus: 1 });
      else if (s.fx.counterBonus === 'double') ops.push({ mul: 2 });
    }
    // (Hardened Scales and Doubling Season: the permanent's controller orders them, for the most counters)
    return this.replaceInOrder(n, ops, 'max');
  }
  // Several replacement effects on one event (616.1): the affected player chooses the order they apply in. Every
  // choice here is about an amount, so the order that's best for that player is used (most counters or life
  // gained, least damage taken). Rules 4 and earlier applied them in battlefield order.
  applyOps(n, ops) {
    for (const op of ops) n = op.plus != null ? n + op.plus : op.mul != null ? n * op.mul : Math.floor(n / 2);
    return n;
  }
  replaceInOrder(n, ops, want) {
    if (ops.length < 2 || this.rules < 5) return this.applyOps(n, ops);
    // (all orders for up to 6 effects; beyond that, additions first for "max" and last for "min")
    if (ops.length > 6) {
      const plus = ops.filter(op => op.plus != null), rest = ops.filter(op => op.plus == null);
      return this.applyOps(n, want === 'max' ? [...plus, ...rest] : [...rest, ...plus]);
    }
    let best = null;
    const perm = (left, done) => {
      if (!left.length) { const v = this.applyOps(n, done); if (best == null || (want === 'max' ? v > best : v < best)) best = v; return; }
      const tried = new Set();
      left.forEach((op, i) => { const k = JSON.stringify(op); if (tried.has(k)) return; tried.add(k); perm([...left.slice(0, i), ...left.slice(i + 1)], [...done, op]); });
    };
    perm(ops, []);
    return best;
  }
  // Choosing cards from a zone: a human seat picks, the AI takes the most valuable
  async pickCards(p, cards, n, text) {
    if (!cards.length || n <= 0) return [];
    if (p.agent.chooseCardsAsync) { const r = await p.agent.chooseCardsAsync(this, p, cards, n, text); if (r) return r; }
    return [...cards].sort((a, b) => p.agent.value(this, b) + (b.card.cmc || 0) * 0.3 - p.agent.value(this, a) - (a.card.cmc || 0) * 0.3).slice(0, n);
  }
  // A creature p would like to grow, pump or protect (their best one)
  bestOwnCreature(p, filter = (/** @type {any} */ _o) => true) { return p.agent.bestOwn(this, p, o => o.fx.type.creature && filter(o)); }

  // The newer effects: library manipulation, keyword actions, conditions, graveyard work
  async doEffectMore(p, src, e, ctx, tgt, X) {
    const S = this.cn(src);
    switch (e.k) {
      case 'if': {
        let ok = this.evalCond(p, src, e.cond, ctx);
        // An unreadable condition on an "instead" upgrade keeps the plain version, and never wins the game
        if (e.cond.c === '?' && (e.else || e.effects.some(x => x.k === 'win'))) ok = false;
        const branch = ok ? e.effects : e.else || [];
        if (e.cond.c !== '?' && branch.length) this.log(`${S}: ${ok ? '' : 'not '}${esc(condText(e.cond))}`, { kind: 'minor' });
        await this.runEffects(p, src, branch, { ...ctx, targets: undefined, strict: false });
        break;
      }
      case 'scry': case 'surveil': {
        const n = Math.min(X(e.n), p.library.length);
        if (!n) break;
        const top = p.library.slice(-n).reverse();
        let { keep, away } = await (p.agent.chooseScryAsync ? p.agent.chooseScryAsync(this, p, top, e.k) : p.agent.chooseScry(this, p, top, e.k));
        // "Put them back in any order": nothing leaves the top, only the order changes
        if (e.keepAll) { keep = [...keep, ...away]; away = []; }
        p.library.splice(p.library.length - n, n);
        for (const o of away) {
          if (e.k === 'scry') p.library.unshift(o);
          else { o.zone = 'library'; p.library.push(o); this.move(o, 'graveyard'); }
        }
        for (const o of [...keep].reverse()) p.library.push(o);
        this.log(`${this.pn(p)} ${e.k === 'scry' ? 'scries' : 'surveils'} ${n}: ${keep.length} on top, ${away.length} ${e.k === 'scry' ? 'on the bottom' : 'into the graveyard'}`, { kind: 'minor', rule: e.k === 'scry' ? '701.22a' : '701.46a' });
        break;
      }
      case 'dig': {
        const n = Math.min(X(e.n), p.library.length);
        if (!n) break;
        const seen = p.library.splice(p.library.length - n, n).reverse();
        const ok = o => (!e.types.length || e.types.some(t => o.fx.type[t])) && (!e.chosen || !src.chosenType || this.isA(o, src.chosenType));
        const take = await this.pickCards(p, seen.filter(ok), e.take >= 99 ? 99 : e.take, `${S}: choose what to take from the top ${n}`);
        for (const o of seen) { o.zone = 'library'; }
        p.library.push(...take);
        for (const o of take) this.move(o, e.bf && o.fx.type.permanent ? 'battlefield' : 'hand');
        for (const o of take) if (o.zone === 'battlefield') this.trigger(o, 'etb');
        const rest = seen.filter(o => !take.includes(o));
        if (e.gy) { p.library.push(...rest); for (const o of rest) this.move(o, 'graveyard'); } else p.library.unshift(...rest);
        this.log(`${this.pn(p)} looks at the top ${n} cards and takes ${take.length ? take.map(o => this.cn(o)).join(', ') : 'nothing'} (${S})`, { kind: 'minor' });
        break;
      }
      case 'impulse': {
        const got = [];
        for (let k = 0; k < X(e.n) && p.library.length > 1; k++) {
          const o = p.library[p.library.length - 1];
          this.move(o, 'exile');
          o.mayPlay = { p: p.idx, until: this.turn + (e.next ? this.alive().length : 0), free: !!e.free };
          got.push(o);
        }
        if (got.length) this.log(`${this.pn(p)} exiles ${got.map(o => this.cn(o)).join(', ')} and may play ${got.length === 1 ? 'it' : 'them'} ${e.next ? 'until their next turn' : 'this turn'}`, { kind: 'minor' });
        break;
      }
      case 'artifactToken': { const n = this.tokenCount(p, X(e.n)); for (let k = 0; k < n; k++) this.createArtifactToken(p, e.kind, src); this.log(`${this.pn(p)} creates ${n} ${e.kind[0].toUpperCase() + e.kind.slice(1)} token${n === 1 ? '' : 's'}`, { kind: 'minor' }); if (n > 0) this.extraTokens(p, e.kind, src); break; }
      case 'fight': {
        const foe = tgt?.obj;
        const mine = src.zone === 'battlefield' && src.fx.type.creature ? src : this.bestOwnCreature(p, o => o !== foe);
        if (!foe || !mine || foe.zone !== 'battlefield') break;
        this.damageObj(foe, this.power(mine), mine);
        if (!e.bite) this.damageObj(mine, this.power(foe), foe);
        this.log(e.bite ? `${this.cn(mine)} deals ${this.power(mine)} damage to ${this.cn(foe)}` : `${this.cn(mine)} fights ${this.cn(foe)}`, { kind: 'removal', rule: e.bite ? null : '701.14a' });
        break;
      }
      case 'goad': {
        const objs = e.all ? this.opponents(p).flatMap(q => q.battlefield.filter(o => o.fx.type.creature)) : tgt?.obj ? [tgt.obj] : [];
        for (const o of objs) o.goaded = { by: p.idx, until: this.turn + this.alive().length };
        if (objs.length) this.log(`${this.pn(p)} goads ${objs.length === 1 ? this.cn(objs[0]) : `${objs.length} creatures`}: they must attack, and not ${this.pn(p)}, if able`, { kind: 'removal', rule: '701.15' });
        break;
      }
      case 'proliferate': {
        let n = 0;
        for (const o of p.battlefield) {
          if (o.counters > 0) { o.counters++; n++; }
          if (o.fx.type.planeswalker) { o.loyalty++; n++; }
          if (o.timeCounters > 0 && o.fx.kwN?.fading) { o.timeCounters++; }
        }
        for (const q of this.opponents(p)) {
          if (q.poison > 0) { q.poison++; n++; }
          for (const o of q.battlefield) if (o.counters < 0) { o.counters--; n++; }
        }
        this.log(`${this.pn(p)} proliferates (${n} counter${n === 1 ? '' : 's'} added)`, { kind: 'minor', rule: '701.27a' });
        this.fire('proliferate', { p: p.idx });
        // Tekuthal: proliferate twice
        if (!e.again && p.battlefield.some(s => s.fx.proliferateTwice)) await this.doEffectMore(p, src, { ...e, again: true }, ctx, tgt, X);
        break;
      }
      case 'populate': {
        const model = p.agent.bestOwn(this, p, o => o.token && o.fx.type.creature);
        if (model) { const c = this.createCopy(p, model, false); this.log(`${this.pn(p)} populates: a copy of ${this.cn(model)}`, { kind: 'minor', rule: '701.30a' }); this.trigger(c, 'etb'); }
        break;
      }
      case 'monstrous':
        if (src.zone === 'battlefield' && !src.monstrous) { src.monstrous = true; src.counters += X(e.n); this.fire('counterPut', { o: src, p: src.controller, by: p.idx, n: X(e.n) }); this.log(`${S} becomes monstrous (+${X(e.n)} counters)`, { kind: 'minor', rule: '701.37a' }); }
        break;
      case 'adapt':
        if (src.zone === 'battlefield' && src.counters <= 0) { src.counters += X(e.n); this.fire('counterPut', { o: src, p: src.controller, by: p.idx, n: X(e.n) }); this.log(`${S} adapts (+${X(e.n)})`, { kind: 'minor', rule: '701.46a' }); }
        break;
      case 'bolster': {
        const o = p.battlefield.filter(c => c.fx.type.creature).sort((a, b) => this.toughness(a) - this.toughness(b))[0];
        if (o) { o.counters += X(e.n); this.fire('counterPut', { o, p: o.controller, by: p.idx, n: X(e.n) }); this.log(`${this.pn(p)} bolsters ${X(e.n)}: ${this.cn(o)}`, { kind: 'minor', rule: '701.39a' }); }
        break;
      }
      case 'support': {
        const objs = p.battlefield.filter(c => c.fx.type.creature && c !== src).sort((a, b) => p.agent.value(this, b) - p.agent.value(this, a)).slice(0, e.n);
        for (const o of objs) o.counters++;
        if (objs.length) this.log(`${S} supports ${objs.length} creature${objs.length === 1 ? '' : 's'}`, { kind: 'minor' });
        break;
      }
      case 'connive': {
        this.draw(p, 1, true);
        const [d] = await p.agent.chooseDiscard(this, p, 1) || [];
        if (d) this.discard(p, [d], null);
        if (d && !d.fx.type.land && src.zone === 'battlefield' && src.fx.type.creature) src.counters++;
        this.log(`${S} connives${d ? `, discarding ${this.cn(d)}` : ''}`, { kind: 'minor', rule: '701.50a' });
        break;
      }
      case 'explore': {
        const who = src.zone === 'battlefield' && src.fx.type.creature ? src : this.bestOwnCreature(p);
        const top = p.library[p.library.length - 1];
        if (!who || !top) break;
        if (top.fx.type.land) { this.move(top, 'hand'); this.log(`${this.cn(who)} explores and reveals a land (${this.cn(top)}), which goes to hand`, { kind: 'minor', rule: '701.44a' }); }
        else {
          who.counters++;
          const lands = p.battlefield.filter(o => o.fx.type.land).length;
          const keep = (top.card.cmc || 0) <= lands + 2;
          if (!keep) this.move(top, 'graveyard');
          this.log(`${this.cn(who)} explores: +1/+1 counter, ${keep ? 'keeps the top card' : `puts ${this.cn(top)} into the graveyard`}`, { kind: 'minor', rule: '701.44a' });
        }
        break;
      }
      case 'cascade': {
        // Cascade and discover: exile until a nonland card that costs less, cast it free, the rest go to the bottom
        const limit = e.discover ? e.n : (e.n ?? 99) - 1;
        const exiled = [];
        let hit = null;
        while (p.library.length) {
          const o = p.library[p.library.length - 1];
          this.move(o, 'exile');
          exiled.push(o);
          if (!o.fx.type.land && (o.card.cmc || 0) <= limit && o.card.manaCost) { hit = o; break; }
        }
        this.log(`${S}: ${e.discover ? `discover ${e.n}` : 'cascade'} reveals ${hit ? this.cn(hit) : 'nothing castable'} (${exiled.length} card${exiled.length === 1 ? '' : 's'} exiled)`, { kind: 'minor', rule: e.discover ? '701.57a' : '702.85a' });
        for (const o of exiled) if (o !== hit) { p.exile.splice(p.exile.indexOf(o), 1); o.zone = 'library'; p.library.unshift(o); }
        if (hit) await this.cast(p, hit, { mode: { alt: 'free' } });
        break;
      }
      case 'regen': {
        if (e.all) { for (const o of p.battlefield) if (o.fx.type.creature) o.regen = (o.regen || 0) + 1; this.log(`${S}: ${this.pn(p)}'s creatures get regeneration shields`, { kind: 'minor', rule: '701.15a' }); break; }
        const o = e.self ? (src.zone === 'battlefield' ? src : null) : tgt?.obj;
        if (o) { o.regen = (o.regen || 0) + 1; this.log(`${this.cn(o)} gets a regeneration shield`, { kind: 'minor', rule: '701.15a' }); }
        break;
      }
      case 'tap': if (tgt?.obj) { tgt.obj.tapped = true; this.log(`${S} taps ${this.tname(tgt)}`, { kind: 'minor' }); } break;
      case 'tapAll': {
        let n = 0;
        for (const q of this.opponents(p)) for (const o of q.battlefield) if (this.isA(o, e.what.replace(/s$/, '').replace('nonland permanent', 'nonland'))) { o.tapped = true; n++; }
        this.log(`${S} taps ${n} of the opponents' ${e.what}`, { kind: 'removal' });
        break;
      }
      case 'drawEach': for (const q of this.alive()) this.draw(q, X(e.n)); break;
      case 'discardSelf': {
        const cards = (await p.agent.chooseDiscard(this, p, Math.min(X(e.n), p.hand.length))) || [];
        this.discard(p, cards);
        break;
      }
      case 'sacOwn': {
        const pool = p.battlefield.filter(o => o !== src && this.isA(o, e.what.replace('nonland permanent', 'nonland')));
        const cs = pool.sort((a, b) => p.agent.value(this, a) + p.agent.pieceWorth(this, p, a) - p.agent.value(this, b) - p.agent.pieceWorth(this, p, b)).slice(0, e.n || 1);
        for (const c of cs) this.sacrifice(p, c);
        break;
      }
      case 'minus': {
        const objs = e.on.startsWith('target') ? (tgt?.obj ? [tgt.obj] : [])
          : e.on.includes('opponents') || e.on.includes("don't") ? this.opponents(p).flatMap(q => q.battlefield.filter(o => o.fx.type.creature))
            : this.alive().flatMap(q => q.battlefield.filter(o => o.fx.type.creature && (e.on.includes('other') ? o !== src : true)));
        for (const o of objs) { o.counters -= X(e.n); o.hadMinus = true; }
        if (objs.length) this.log(`${S} puts ${X(e.n)} -1/-1 counter${X(e.n) === 1 ? '' : 's'} on ${objs.length === 1 ? this.cn(objs[0]) : objs.length + ' creatures'}`, { kind: 'removal', rule: '704.5q' });
        break;
      }
      case 'shrink': if (tgt?.obj) { tgt.obj.tempP -= X(e.p); tgt.obj.tempT -= X(e.t); this.log(`${this.tname(tgt)} gets -${X(e.p)}/-${X(e.t)}`, { kind: 'removal' }); } break;
      case 'shrinkAll': {
        // (Crippling Fear: the caster names the creature type it has most of, and those are spared)
        const keep = e.keepType ? this.bestType(p) : null;
        const objs = (e.opp ? this.opponents(p) : this.alive()).flatMap(q => q.battlefield.filter(o => o.fx.type.creature && (!e.other || o !== src) && !(keep && this.isA(o, keep)) && !(e.keepTribe && this.isA(o, e.keepTribe))));
        for (const o of objs) { o.tempP -= X(e.p); o.tempT -= X(e.t); }
        this.log(`${S}: ${e.opp ? "opponents' creatures" : 'all creatures'} get -${X(e.p)}/-${X(e.t)}`, { kind: 'removal' });
        break;
      }
      case 'addManaN': {
        const n = Math.min(X(e.n), 30);
        for (let k = 0; k < n; k++) p.pool.push({ colors: e.color ? [e.color] : [...COLORS] });
        if (n) this.log(`${this.pn(p)} adds ${n} mana (${S})`, { kind: 'minor' });
        break;
      }
      case 'drawThat': { const q = this.thatPlayer(p, ctx) || (ctx.trig?.p != null ? this.players[ctx.trig.p] : null); if (q && !q.lost) this.draw(q, X(e.n)); break; }
      case 'freeCast': {
        const pool = p.hand.filter(o => !o.fx.type.land && (o.card.cmc || 0) <= e.maxMv && (!e.types.length || e.types.some(t => o.fx.type[t])));
        const [c] = await this.pickCards(p, pool, 1, `${S}: choose a spell to cast for free`);
        if (c) await this.cast(p, c, { mode: { alt: 'free' } });
        break;
      }
      case 'namedCounter':
        // (a loyalty counter on a planeswalker is loyalty: Ral, Crackling Wit)
        if (src.zone === 'battlefield' && e.kind === 'loyalty' && src.fx.type.planeswalker) { src.loyalty += X(e.n ?? 1); this.log(`${S} gets a loyalty counter (${src.loyalty})`, { kind: 'minor' }); }
        else if (src.zone === 'battlefield') { const k = X(e.n ?? 1); (src.named ||= {})[e.kind] = (src.named[e.kind] || 0) + k; this.log(`${S} gets ${k === 1 ? 'a' : k} ${e.kind} counter${k === 1 ? '' : 's'} (${src.named[e.kind]})`, { kind: 'minor' }); }
        break;
      case 'grantFlashback': {
        const pool = p.graveyard.filter(o => (o.fx.type.instant || o.fx.type.sorcery) && o !== src);
        const got = e.all ? pool : [p.agent.pickBest(this, pool.filter(o => o.fx.spell.length))].filter(Boolean);
        for (const o of got) o.tempFlashback = this.turn;
        if (got.length) this.log(`${S}: ${got.length === 1 ? this.cn(got[0]) + ' gains' : got.length + ' cards in ' + this.pn(p) + "'s graveyard gain"} flashback this turn`, { kind: 'minor', rule: '702.34a' });
        break;
      }
      case 'payFor': {
        const plan = this.planPayment(p, parseCost(e.cost), 0);
        const worth = e.effects.reduce((s, x) => s + p.agent.effectValue(this, p, src, x, false), 0);
        const c = parseCost(e.cost);
        if (plan && worth > (c.generic + c.pips.length) * 0.6) {
          this.commitPayment(p, plan);
          this.log(`${this.pn(p)} pays ${esc(e.cost)} (${S})`, { kind: 'minor' });
          await this.runEffects(p, src, e.effects, { ...ctx, targets: undefined, strict: false });
        }
        break;
      }
      case 'modal': {
        const chosen = p.agent.chooseModes(this, p, src, e);
        await this.runEffects(p, src, chosen, { ...ctx, targets: undefined, strict: false });
        break;
      }
      case 'doubleCounters': {
        const objs = e.on === '~' ? [src] : e.on === 'enchanted creature' ? [src.attachedTo].filter(Boolean) : e.on.startsWith('target') ? [p.agent.bestOwn(this, p)].filter(Boolean) : p.battlefield.filter(o => o.fx.type.creature);
        for (const o of objs) if (o.zone === 'battlefield') {
          if (o.counters > 0) o.counters *= 2;
          // ("each kind of counter": Vorel, Zimone, Deepglow Skate)
          if (e.all && o.named) for (const k of Object.keys(o.named)) o.named[k] *= 2;
          if (e.all && o.fx.type.planeswalker) o.loyalty *= 2;
        }
        this.log(`${S} doubles the +1/+1 counters on ${objs.length === 1 ? this.cn(objs[0]) : 'your creatures'}`, { kind: 'minor' });
        break;
      }
      case 'returnSelfHand':
        if (src.zone === 'graveyard') { this.move(src, 'hand'); this.log(`${S} returns to ${this.pn(p)}'s hand`, { kind: 'minor' }); }
        break;
      case 'fog':
        this.fogTurn = this.turn;
        this.log(`${S}: all combat damage is prevented this turn`, { kind: 'removal', rule: '615.1' });
        break;
      // ---- 1.7.0
      case 'preventMe':
        p.preventTurn = this.turn;
        this.log(`${S}: all damage that would be dealt to ${this.pn(p)} this turn is prevented`, { kind: 'minor', rule: '615.1' });
        break;
      case 'millHalf': {
        const who = e.who === 'each opponent' ? this.opponents(p) : tgt?.player != null ? [this.players[tgt.player]] : [p.agent.weakestOpponent(this, p)].filter(Boolean);
        for (const q of who) {
          const k = e.up ? Math.ceil(q.library.length / 2) : Math.floor(q.library.length / 2);
          for (let j = 0; j < k; j++) this.move(q.library[q.library.length - 1], 'graveyard');
          this.log(`${this.pn(q)} mills ${k} cards, half their library (${S})`, { kind: 'removal', rule: '701.13a' });
        }
        break;
      }
      case 'doubleLife': {
        const q = tgt?.player != null ? this.players[tgt.player] : p;
        const n = this.lifeGain(q, Math.max(0, q.life));
        q.life += n; this.emit('life', { p: q.idx, d: n });
        this.log(`${S}: ${this.pn(q)}'s life total doubles to ${q.life}`, { kind: 'minor' });
        break;
      }
      case 'shuffleSelf':
        if (src.zone !== 'library') { this.move(src, 'library', { shuffle: true }); this.log(`${S} is shuffled into its owner's library`, { kind: 'minor' }); }
        break;
      case 'loseHalf': {
        const q = this.thatPlayer(p, ctx) || (ctx.trig?.p != null ? this.players[ctx.trig.p] : null);
        if (q && !q.lost && q.life > 0) { const n = Math.ceil(q.life / 2); q.life -= n; q.grudge[p.idx] += n; this.emit('life', { p: q.idx, d: -n }); this.log(`${S}: ${this.pn(q)} loses half their life (${n})`, { kind: 'damage' }); }
        break;
      }
      case 'bounceOpp': {
        const q = this.opponents(p).sort((a, b) => b.battlefield.filter(o => !o.fx.type.land).length - a.battlefield.filter(o => !o.fx.type.land).length)[0];
        if (!q) break;
        const objs = q.battlefield.filter(o => !o.fx.type.land);
        for (const o of objs) this.move(o, 'hand');
        this.log(`${S} returns ${objs.length} of ${this.pn(q)}'s nonland permanents to hand`, { kind: 'removal' });
        break;
      }
      case 'sacUnlessPay': case 'sacUnlessTap': {
        if (src.zone !== 'battlefield') break;
        if (e.k === 'sacUnlessPay') {
          const plan = this.planPayment(p, { generic: e.n, pips: [], x: 0 });
          if (plan) { this.commitPayment(p, plan); this.log(`${this.pn(p)} pays {${e.n}} to keep ${this.cn(src)}`, { kind: 'minor' }); break; }
        } else {
          const t = p.battlefield.find(o => o !== src && !o.tapped && !o.fx.mana) || p.battlefield.find(o => o !== src && !o.tapped);
          if (t) { t.tapped = true; this.log(`${this.pn(p)} taps ${this.cn(t)} to keep ${this.cn(src)}`, { kind: 'minor' }); break; }
        }
        this.sacrifice(p, src);
        break;
      }
      case 'noBlock':
        if (tgt?.obj) { tgt.obj.noBlockTurn = this.turn; if (e.attack) tgt.obj.noAttackTurn = this.turn; this.log(`${S}: ${this.tname(tgt)} can't ${e.attack ? 'attack or ' : ''}block this turn`, { kind: 'minor' }); }
        break;
      case 'keepOne': {
        const who = e.who === 'each' ? this.alive() : [this.thatPlayer(p, ctx) || (ctx.trig?.p != null ? this.players[ctx.trig.p] : null)].filter(q => q && !q.lost);
        for (const q of who) {
          const pool = q.battlefield.filter(o => o.fx.type.creature || (e.pw && o.fx.type.planeswalker)).sort((a, b) => q.agent.value(this, b) - q.agent.value(this, a));
          const gone = pool.slice(e.n);
          for (const o of gone) this.sacrifice(q, o);
          if (gone.length) this.log(`${this.pn(q)} keeps ${pool.slice(0, e.n).map(o => this.cn(o)).join(' and ')} and sacrifices ${gone.length} other${gone.length === 1 ? '' : 's'} (${S})`, { kind: 'removal' });
        }
        break;
      }
      case 'gyExileTurn':
        p.gyExileTurn = this.turn;
        break;
      case 'exploit': {
        if (src.zone !== 'battlefield') break;
        // A token or the least useful creature; itself only when nothing else will do and the payoff is worth it
        const fodder = p.battlefield.filter(o => o !== src && o.fx.type.creature && !o.isCommander).sort((a, b) => p.agent.value(this, a) - p.agent.value(this, b))[0] || (src.fx.exploitFx ? src : null);
        if (!fodder || (fodder !== src && p.agent.value(this, fodder) > 4 && !src.fx.exploitFx)) break;
        this.log(`${S} exploits ${fodder === src ? 'itself' : this.cn(fodder)}`, { kind: 'minor', rule: '702.110a' });
        this.sacrifice(p, fodder);
        if (src.fx.exploitFx) await this.runEffects(p, src, src.fx.exploitFx, { ...ctx, targets: undefined, strict: false });
        break;
      }
      case 'nonbasicBurn':
        for (const q of this.alive()) {
          const n = q.battlefield.filter(o => o.fx.type.land && !o.fx.type.basic).length * (e.times || 1);
          if (n) { this.damagePlayer(q, n, src, false); this.log(`${S} deals ${n} damage to ${this.pn(q)}`, { kind: 'damage' }); }
        }
        break;
      case 'win':
        if (this.kingdoms) { this.log(`${S}: "win the game" does nothing in Kingdoms`, { kind: 'minor', rule: 'Kingdoms' }); break; }
        this.winNote = `${src.card.name}`;
        this.log(`🏆 ${S}: ${this.pn(p)} wins the game`, { kind: 'win', rule: '104.2b' });
        for (const q of this.opponents(p)) this.lose(q, `${src.card.name}`, '104.3');
        break;
      case 'exileSelf':
        if (src.zone === 'battlefield') { this.move(src, 'exile'); this.log(`${S} is exiled`, { kind: 'minor' }); }
        break;
      case 'untapSelf':
        if (src.zone === 'battlefield' && src.tapped) { src.tapped = false; this.log(`${S} untaps`, { kind: 'minor' }); }
        break;
      case 'evade': {
        const o = e.self ? src : tgt?.obj;
        if (o?.zone === 'battlefield') { o.tempKw = new Set([...(o.tempKw || []), 'unblockable']); this.log(`${this.cn(o)} can't be blocked this turn`, { kind: 'minor' }); }
        break;
      }
      case 'kwCounter': {
        if (e.all) { for (const c of p.battlefield) if (c.fx.type.creature) (c.permKw ||= new Set()).add(e.kw); this.log(`${S}: ${this.pn(p)}'s creatures get ${e.kw} counters`, { kind: 'minor', rule: '122.1b' }); break; }
        const o = e.self ? src : tgt?.obj;
        if (o?.zone === 'battlefield') {
          (o.permKw ||= new Set()).add(e.kw);
          // (Gift of the Viper: a +1/+1 counter and more keyword counters too)
          for (const k of e.also || []) o.permKw.add(k);
          if (e.plus) o.counters += this.moreCounters(o, e.plus);
          this.log(`${this.cn(o)} gets ${/^[aeiou]/.test(e.kw) ? 'an' : 'a'} ${e.kw} counter${e.also?.length || e.plus ? ' and more' : ''}`, { kind: 'minor', rule: '122.1b' });
        }
        break;
      }
      case 'topLandOrHand': {
        const top = p.library[p.library.length - 1];
        if (!top) break;
        this.move(top, top.fx.type.land ? 'battlefield' : 'hand');
        this.log(`${this.pn(p)} reveals ${this.cn(top)}: ${top.fx.type.land ? 'onto the battlefield' : 'into their hand'}`, { kind: 'minor' });
        break;
      }
      case 'animate': {
        if (src.zone !== 'battlefield') break;
        src.animPT = { p: X(e.p), t: X(e.t), turn: this.turn, ts: ++this.tsN };
        if (!src.fx.type.creature) { src.crewed = true; src.fx = { ...src.card.fx, type: { ...src.card.fx.type, creature: true } }; }
        if (e.kw.length) src.tempKw = new Set([...(src.tempKw || []), ...e.kw]);
        this.log(`${S} becomes a ${e.p}/${e.t} creature until end of turn`, { kind: 'minor' });
        break;
      }
      case 'manifest': this.manifest(p, e, ctx); break;
      case 'siegeCast': {
        // A defeated Siege: exile it, then its controller may cast it transformed without paying its mana cost (310.11b)
        if (src.zone !== 'graveyard') break;
        this.move(src, 'exile');
        this.useFace(src, src.card.backCard);
        const ok = await this.cast(p, src, { mode: { alt: 'free' } });
        if (!ok && src.zone === 'exile') this.mainFace(src);
        break;
      }
      case 'tuck': {
        // (its owner chooses top or bottom: the top, to draw it again)
        const o = tgt?.obj;
        if (!o || o.zone !== 'battlefield') break;
        this.log(`${S} puts ${this.cn(o)} on top of its owner's library`, { kind: 'removal' });
        this.move(o, 'library');
        break;
      }
      case 'suspect': if (src.zone === 'battlefield') { src.suspected = true; this.log(`${S} is suspected (menace, can't block)`, { kind: 'minor', rule: '701.60a' }); } break;
      case 'scrollRack': {
        // (the weakest cards in hand, up to three, go on top; that many come off the top first)
        const worst = [...p.hand].map(o => ({ o, v: p.agent.value(this, o) + p.agent.pieceWorth(this, p, o) * 2 + (o.fx.type.land && p.battlefield.filter(x => x.fx.type.land).length < 5 ? 3 : 0) }))
          .filter(x => x.v < 3).sort((a, b) => a.v - b.v).slice(0, Math.min(3, p.library.length)).map(x => x.o);
        if (!worst.length) { this.log(`${S}: ${this.pn(p)} keeps their hand`, { kind: 'minor' }); break; }
        for (const o of worst) this.move(o, 'exile');
        const got = p.library.splice(-worst.length).reverse();
        for (const o of got) { o.zone = 'hand'; p.hand.push(o); }
        for (const o of worst) this.move(o, 'library');
        this.log(`${S}: ${this.pn(p)} swaps ${worst.length} card${worst.length === 1 ? '' : 's'} in hand for the top of their library`, { kind: 'minor' });
        break;
      }
      case 'venture': if (this.rules >= 5) await this.venture(p); break;
      case 'initiative': if (this.rules >= 5) await this.takeInitiative(p); break;
      case 'madnessCast': {
        // (cast it now for its madness cost, or it goes to the graveyard)
        const o = src;
        if (!o.madnessPending || o.zone !== 'exile') break;
        o.madnessPending = false;
        const can = !p.lost && !!this.planPayment(p, parseCost(o.fx.madness), 0);
        const want = can && (p.agent.wantsMadnessAsync ? await p.agent.wantsMadnessAsync(this, p, o) : p.agent.wantsMadness ? p.agent.wantsMadness(this, p, o) : true);
        if (!want || !(await this.cast(p, o, { mode: { alt: 'madness' } }))) {
          if (o.zone === 'exile') { this.move(o, 'graveyard'); this.log(`${this.cn(o)} goes to the graveyard (madness not used)`, { kind: 'minor' }); }
        }
        break;
      }
      case 'attachSelf': {
        const o = ctx.made?.zone === 'battlefield' ? ctx.made : p.agent.bestOwn(this, p, x => x.fx.type.creature && x !== src);
        if (o && src.zone === 'battlefield') { src.attachedTo = o; this.log(`${S} is attached to ${this.cn(o)}`, { kind: 'minor' }); }
        break;
      }
      case 'loseThat': {
        const q = this.thatPlayer(p, ctx);
        if (q) { const n = X(e.n); q.life -= n; this.emit('life', { p: q.idx, d: -n }); this.log(`${S}: ${this.pn(q)} loses ${n} life`); }
        break;
      }
      case 'poison': {
        const who = e.who === 'that player' ? [this.thatPlayer(p, ctx)].filter(Boolean) : e.who.startsWith('target') ? (tgt?.player != null ? [this.players[tgt.player]] : []) : e.who === 'each player' ? this.alive() : this.opponents(p);
        for (const q of who) q.poison += X(e.n);
        if (who.length) this.log(`${S}: ${who.map(q => `${this.pn(q)} (${q.poison}/10)`).join(', ')} get${who.length === 1 ? 's' : ''} ${X(e.n)} poison`, { kind: 'damage', rule: '122.1f' });
        break;
      }
      // Pacts: free now, paid for at the next upkeep, or the game is lost (Pact of Negation)
      case 'pact':
        (p.pacts ||= []).push({ cost: e.cost, from: this.turn, name: src.card.name });
        this.log(`${this.pn(p)} must pay ${esc(e.cost)} at their next upkeep or lose the game (${S})`, { kind: 'minor' });
        break;
      case 'bounceOwn': {
        // Karoo lands and their kin: return the least useful one (a tapped land first)
        const pool = p.battlefield.filter(o => this.isA(o, e.what.replace('nonland permanent', 'nonland')));
        const c = pool.sort((a, b) => (b.tapped ? 1 : 0) - (a.tapped ? 1 : 0) || p.agent.value(this, a) - p.agent.value(this, b))[0];
        if (c) { this.move(c, 'hand'); this.log(`${this.pn(p)} returns ${this.cn(c)} to their hand (${S})`, { kind: 'minor' }); }
        break;
      }
      case 'extraLand':
        p.extraLand = { turn: this.turn, n: (p.extraLand?.turn === this.turn ? p.extraLand.n : 0) + (e.n || 1) };
        this.log(`${this.pn(p)} may play an additional land this turn (${S})`, { kind: 'minor' });
        break;
      case 'pumpSelf':
        if (src.zone === 'battlefield') {
          src.tempP += X(e.p); src.tempT += X(e.t);
          if (e.kw.length) src.tempKw = new Set([...(src.tempKw || []), ...e.kw]);
          this.log(`${S} gets ${X(e.p) || X(e.t) ? `+${X(e.p)}/+${X(e.t)}` : ''}${e.kw.length ? ` ${e.kw.join(', ')}` : ''} until end of turn`, { kind: 'minor' });
        }
        break;
      case 'loseAll': {
        const n = X(e.n);
        for (const q of this.alive()) { q.life -= n; this.emit('life', { p: q.idx, d: -n }); }
        this.log(`${S}: each player loses ${n} life`);
        break;
      }
      case 'loseSelf': { const n = X(e.n); p.life -= n; this.emit('life', { p: p.idx, d: -n }); this.log(`${this.pn(p)} loses ${n} life (${S})`, { kind: 'minor' }); break; }
      case 'monarch': this.setMonarch(p, S); break;
      case 'fromHand': {
        const pool = p.hand.filter(o => o !== src && (e.what === 'land' ? o.fx.type.land : e.what === 'nonland permanent' ? o.fx.type.permanent && !o.fx.type.land : this.isA(o, e.what) && o.fx.type.permanent) && (!e.tribes || e.tribes.some(t => this.isA(o, t.replace(/s$/, '')))));
        // (Ghalta, Stampede Tyrant: any number of them)
        const picked = await this.pickCards(p, pool, Math.min(e.n || 1, pool.length), `${S}: choose ${e.n > 1 ? 'any number of cards' : `a ${e.what}`} to put onto the battlefield`);
        for (const c of picked) {
          this.move(c, 'battlefield');
          // Kaalia of the Vast: tapped and attacking alongside her
          if (e.attacking && src.attacking != null) Object.assign(c, { tapped: true, attacking: src.attacking, blockedBy: [], blocked: false });
          this.log(`${this.pn(p)} puts ${this.cn(c)} onto the battlefield from their hand${c.attacking != null && e.attacking ? ' tapped and attacking' : ''}`, { kind: 'minor' });
          this.trigger(c, 'etb');
        }
        break;
      }
      case 'reshuffle': {
        const n = p.graveyard.length;
        for (const o of [...p.graveyard]) { this.move(o, 'library'); }
        shuffle(p.library, this.rand);
        this.log(`${this.pn(p)} shuffles ${n} card${n === 1 ? '' : 's'} from their graveyard into their library`, { kind: 'minor' });
        break;
      }
      case 'exileGy': {
        if (e.all) {
          let n = 0;
          for (const q of this.opponents(p)) for (const o of [...q.graveyard]) { this.move(o, 'exile'); n++; }
          this.log(`${S} exiles ${n} card${n === 1 ? '' : 's'} from the opponents' graveyards`, { kind: 'removal' });
        } else {
          const c = p.agent.pickBest(this, this.opponents(p).flatMap(q => q.graveyard));
          if (c) { this.move(c, 'exile'); this.log(`${S} exiles ${this.cn(c)} from a graveyard`, { kind: 'removal' }); }
        }
        break;
      }
      case 'massReanimate': {
        // ("artifact or enchantment", "legendary permanent", "creature … with mana value 2 or less")
        // (Bloodline Bidding: only the creature type that returns the most)
        // (Patriarch's Bidding: each player picks the type that returns the most for them)
        const pool = (e.all ? this.alive() : [p]).flatMap(q => { const bt = e.bestType ? this.bestType(q, q.graveyard.filter(o => o.fx.type.creature)) : null; return q.graveyard.filter(o => this.spellIs(o, e.what) && o.fx.type.permanent && (e.maxMv == null || (o.card.cmc || 0) <= e.maxMv) && (!e.bestType || (bt && this.isA(o, bt)))); });
        for (const o of pool) { this.move(o, 'battlefield', { under: e.all && !e.mine ? o.owner : p.idx, tapped: !!e.tapped }); this.trigger(o, 'etb'); }
        this.log(`${S} returns ${pool.length} card${pool.length === 1 ? '' : 's'} to the battlefield`, { kind: 'removal' });
        break;
      }
      case 'germ': {
        if (src.zone !== 'battlefield') break;
        const t = this.createToken(p, { p: e.p, t: e.t, desc: e.desc, kw: [] }, src);
        src.attachedTo = t;
        this.log(`${S} creates a ${e.p}/${e.t} ${esc(t.card.name)} and is attached to it`, { kind: 'minor', rule: '702.92a' });
        break;
      }
      case 'modular': {
        const n = src.lastCounters || 0;
        const o = n > 0 && p.agent.bestOwn(this, p, x => x.fx.type.artifact && x.fx.type.creature && x !== src);
        if (o) { o.counters += n; this.log(`${S}'s ${n} +1/+1 counters move to ${this.cn(o)} (modular)`, { kind: 'minor', rule: '702.43a' }); }
        break;
      }
      case 'returnSelf':
        if (src.zone === 'graveyard') {
          this.move(src, 'battlefield', { under: src.owner });
          src.counters += e.counters;
          if (e.counters < 0) src.hadMinus = true;
          this.log(`${S} returns to the battlefield with a ${e.counters > 0 ? '+1/+1' : '-1/-1'} counter`, { kind: 'minor', rule: e.counters > 0 ? '702.93a' : '702.79a' });
          this.trigger(src, 'etb');
        }
        break;
      // ---- 1.6.0 second batch
      case 'wheel': {
        const sizes = this.alive().map(q => q.hand.length);
        const n = e.n === 'most' ? Math.max(0, ...sizes) : e.n;
        for (const q of this.alive()) this.discard(q, [...q.hand], null);
        for (const q of this.alive()) this.draw(q, n, true);
        this.log(`${S}: each player discards their hand and draws ${n}`, { kind: 'removal' });
        break;
      }
      case 'commanderToHand': {
        const c = p.command[0];
        if (c) { this.move(c, 'hand', { stay: true }); this.log(`${this.pn(p)} puts ${this.cn(c)} into their hand from the command zone`, { kind: 'minor' }); }
        break;
      }
      case 'stripProt':
        for (const q of this.opponents(p)) for (const o of q.battlefield) o.stripped = { turn: this.turn, kws: e.kws };
        this.log(`${S}: opponents' permanents lose ${e.kws.join(' and ')} this turn`, { kind: 'minor' });
        break;
      case 'livingDeath': {
        const back = new Map();
        for (const q of this.alive()) { const cs = q.graveyard.filter(o => o.fx.type.creature); for (const o of cs) this.move(o, 'exile'); back.set(q, cs); }
        for (const q of this.alive()) for (const o of q.battlefield.filter(x => x.fx.type.creature)) this.sacrifice(q, o);
        for (const [q, cs] of back) for (const o of cs) { if (o.zone !== 'exile') continue; this.move(o, 'battlefield', { under: q.idx }); this.trigger(o, 'etb'); }
        this.log(`${S}: every creature is swapped with the creature cards in the graveyards`, { kind: 'removal' });
        break;
      }
      case 'ignition': {
        const mine = this.bestOwnCreature(p);
        if (!mine) break;
        const n = Math.max(0, this.power(mine));
        for (const q of this.alive()) for (const o of [...q.battlefield]) if (o.fx.type.creature && o !== mine) this.damageObj(o, n, mine);
        for (const q of this.opponents(p)) this.damagePlayer(q, n, mine, false);
        this.log(`${this.cn(mine)} deals ${n} damage to each other creature and each opponent (${S})`, { kind: 'removal' });
        break;
      }
      case 'exileTrigCard': { const o = ctx.trig?.o; if (o?.zone === 'graveyard') this.move(o, 'exile'); break; }
      case 'peek': this.log(`${this.pn(p)} looks at an opponent's hand (${S})`, { kind: 'minor' }); break;
      case 'copyAllTokens': {
        const toks = p.battlefield.filter(o => o.token);
        for (const t of toks) { const c = this.createCopy(p, t, false); this.trigger(c, 'etb'); }
        this.log(`${S}: ${this.pn(p)} copies ${toks.length} token${toks.length === 1 ? '' : 's'}`, { kind: 'minor' });
        break;
      }
      case 'maze': {
        // Maze of Ith: the biggest creature attacking us is untapped and deals no combat damage; Reconnaissance saves our own
        const o = e.own ? p.battlefield.filter(x => x.attacking != null && x.damage > 0).sort((a, b) => p.agent.value(this, b) - p.agent.value(this, a))[0]
          : this.opponents(p).flatMap(q => q.battlefield.filter(x => x.attacking === p.idx)).sort((a, b) => this.power(b) - this.power(a))[0];
        if (o) { Object.assign(o, { attacking: null, blocked: false, blockedBy: [], tapped: false }); this.log(`${S} takes ${this.cn(o)} out of combat`, { kind: 'removal' }); }
        break;
      }
      case 'attachTrig': {
        const eq = ctx.trig?.o || src;
        const c = this.bestOwnCreature(p);
        if (eq?.zone === 'battlefield' && c) { eq.attachedTo = c; this.log(`${this.cn(eq)} is attached to ${this.cn(c)}`, { kind: 'minor' }); }
        break;
      }
      case 'oppToken': {
        const q = [...this.opponents(p)].sort((a, b) => p.agent.threat(this, p, a) - p.agent.threat(this, p, b))[0];
        if (q) { for (let k = 0; k < X(e.n); k++) this.createToken(q, { p: e.p, t: e.t, desc: e.desc, kw: [] }, src); this.log(`${this.pn(q)} creates ${X(e.n)} ${e.p}/${e.t} token${X(e.n) === 1 ? '' : 's'} (${S})`, { kind: 'minor' }); }
        break;
      }
      case 'tempLandBoost': p.tempBoost = { turn: this.turn, what: e.what, sym: e.sym }; this.log(`${S}: ${this.pn(p)}'s ${e.what}s make an extra {${e.sym}} this turn`, { kind: 'minor' }); break;
      case 'sacUnless': {
        const land = p.battlefield.filter(o => o !== src && this.isA(o, e.what)).sort((a, b) => p.agent.value(this, a) - p.agent.value(this, b))[0];
        if (land && p.agent.value(this, src) > p.agent.value(this, land)) this.sacrifice(p, land, ` to keep ${S}`);
        else if (src.zone === 'battlefield') this.sacrifice(p, src);
        break;
      }
      case 'untapAttached': if (src.attachedTo?.zone === 'battlefield') { src.attachedTo.tapped = false; this.log(`${S} untaps ${this.cn(src.attachedTo)}`, { kind: 'minor' }); } break;
      case 'insurrection': {
        const objs = this.opponents(p).flatMap(q => q.battlefield.filter(o => o.fx.type.creature).map(o => ({ o, q })));
        for (const { o, q } of objs) {
          q.battlefield.splice(q.battlefield.indexOf(o), 1); o.controller = p.idx; p.battlefield.push(o);
          Object.assign(o, { tapped: false, sick: false, tempKw: new Set([...(o.tempKw || []), 'haste']) });
          this.tempSteals.push({ o, back: q.idx });
        }
        for (const o of p.battlefield) if (o.fx.type.creature) o.tapped = false;
        this.log(`${S}: ${this.pn(p)} untaps every creature and takes ${objs.length} until end of turn`, { kind: 'removal' });
        break;
      }
      case 'cantLoseTurn': p.cantLoseTurn = this.turn; this.log(`${this.pn(p)} can't lose the game this turn (${S})`, { kind: 'minor' }); break;
      case 'sweepThat': {
        const q = this.thatPlayer(p, ctx);
        const n = X(e.n);
        if (q) { for (const o of [...q.battlefield]) if (o.fx.type.creature) this.damageObj(o, n, src); this.log(`${S} deals ${n} damage to each creature ${this.pn(q)} controls`, { kind: 'removal' }); }
        break;
      }
      case 'allIsDust':
        for (const q of this.alive()) for (const o of [...q.battlefield]) if ((o.card.colors || []).length) this.sacrifice(q, o);
        this.log(`${S}: every colored permanent is sacrificed`, { kind: 'removal' });
        break;
      // ---- 1.6.0 effects
      case 'wipeOpp': {
        const objs = this.opponents(p).flatMap(q => q.battlefield.filter(o => this.isA(o, (e.what || 'creature').replace(/ or .*/, ''))));
        for (const o of objs) {
          if (e.mode === 'bounce') this.move(o, 'hand');
          else if (e.mode === 'damage') this.damageObj(o, X(e.n), src);
          else if (e.mode === 'exile') this.move(o, 'exile');
          else this.destroy(o);
        }
        this.log(`${S} (overloaded) hits ${objs.length} of the opponents' ${e.what || 'creature'}s`, { kind: 'removal', rule: '702.96a' });
        break;
      }
      case 'doublePT': {
        // (Thrakkus: each Dragon's power; Two-Handed Axe: the attacking creature; Tifa: itself)
        const objs = e.all ? p.battlefield.filter(o => o.fx.type.creature && (!e.what || this.isA(o, e.what))) : e.trig ? [ctx.trig?.o].filter(o => o?.zone === 'battlefield') : e.self ? [src].filter(o => o.zone === 'battlefield') : tgt?.obj ? [tgt.obj] : [];
        for (const o of objs) { const pw = Math.max(0, this.power(o)), tg = Math.max(0, this.toughness(o)); o.tempP += pw; if (e.all && !e.powerOnly) o.tempT += tg; if (e.haste) o.tempKw = new Set([...(o.tempKw || []), 'haste']); }
        if (objs.length) this.log(`${S} doubles the power${e.all ? ' and toughness' : ''} of ${objs.length === 1 ? this.cn(objs[0]) : `${objs.length} creatures`}`, { kind: 'minor' });
        break;
      }
      case 'pumpTrig': case 'pumpAttached': {
        const o = e.k === 'pumpAttached' ? src.attachedTo : ctx.trig?.o;
        if (!o || o.zone !== 'battlefield') break;
        o.tempP += X(e.p); o.tempT += X(e.t);
        if (e.kw.length) o.tempKw = new Set([...(o.tempKw || []), ...e.kw]);
        this.log(`${this.cn(o)} gets ${X(e.p) || X(e.t) ? `+${X(e.p)}/+${X(e.t)}` : ''}${e.kw.length ? ` ${e.kw.join(', ')}` : ''} until end of turn (${S})`, { kind: 'minor' });
        break;
      }
      case 'copyTrig': {
        const o = ctx.trig?.o;
        if (!o) break;
        this.log(`${this.pn(p)} copies ${this.cn(o)} (${S})`, { kind: 'cast', p: p.idx, rule: '707.10' });
        if (o.fx.type.permanent) { const c = this.createCopy(p, o, false); this.trigger(c, 'etb'); }
        else await this.runEffects(p, o, o.fx.spell.filter(x => x.k !== 'copySpell' && x.k !== 'counter'), { x: 0 });
        break;
      }
      case 'shieldSelf':
        p.shield = this.turn + this.alive().length - 1;
        this.log(`${this.pn(p)} gains protection from everything until their next turn (${S})`, { kind: 'removal' });
        break;
      case 'ring': {
        p.ring = Math.min(4, (p.ring || 0) + 1);
        const bearer = this.bestOwnCreature(p);
        if (bearer) { p.ringBearer = bearer.iid; bearer.permKw = new Set([...(bearer.permKw || []), ...(p.ring >= 1 ? ['unblockable-bigger'] : [])]); }
        this.log(`The Ring tempts ${this.pn(p)}${bearer ? `: ${this.cn(bearer)} is the Ring-bearer` : ''} (${p.ring}/4)`, { kind: 'minor', rule: '701.54a' });
        this.fire('ring', { p: p.idx });
        break;
      }
      case 'playerCounter': {
        const n = X(e.n) + (p.battlefield.some(s => s.fx.playerCounterPlus) ? 1 : 0);
        p[e.kind] = (p[e.kind] || 0) + n;
        this.log(`${this.pn(p)} gets ${n} ${e.kind} counter${n === 1 ? '' : 's'} (${p[e.kind]})`, { kind: 'minor' });
        break;
      }
      case 'shieldSpells': if (this.rules >= 5) { p.shieldTurn = this.turn; this.log(`${this.pn(p)}'s spells can't be countered this turn`, { kind: 'minor' }); } break;
      case 'uncounterNext': p.uncounterTurn = this.turn; this.log(`${this.pn(p)}'s next spell this turn can't be countered`, { kind: 'minor' }); break;
      case 'bottomSelf':
        if (src.zone === 'graveyard' || src.zone === 'battlefield') { this.move(src, 'library', { bottom: true }); this.log(`${S} goes to the bottom of its owner's library`, { kind: 'minor' }); }
        break;
      case 'returnTrig': {
        const o = ctx.trig?.o;
        if (o && o.zone === 'graveyard') {
          this.move(o, 'battlefield', { under: e.kw ? o.owner : p.idx });
          // Luminous Broodmoth: it comes back with a flying counter
          if (e.kw) o.permKw = new Set([...(o.permKw || []), e.kw]);
          this.log(`${S} returns ${this.cn(o)} to the battlefield${e.kw ? ` with a ${e.kw} counter` : ''}`, { kind: 'minor' });
          this.trigger(o, 'etb');
        }
        break;
      }
      case 'transform': {
        const b = src.card.backCard;
        if (src.zone !== 'battlefield' || !b) { this.log(`${S} would transform (it has no other face here)`, { kind: 'minor' }); break; }
        src.frontCard ||= src.card;
        src.card = src.card === src.frontCard ? b : src.frontCard;
        src.fx = src.card.fx;
        this.log(`${this.cn(src)} transforms`, { kind: 'minor', rule: '701.28a' });
        break;
      }
      case 'bounceAll': {
        const keep = e.keepType ? this.bestType(p) : null;
        // (Wave Goodbye: only creatures without +1/+1 counters)
        const hit = o => o.fx.type.creature && (e.what === 'attacking' ? o.attacking != null : e.what !== 'other creatures' || o !== src) && !(keep && this.isA(o, keep)) && !(e.noCounters && o.counters > 0);
        const objs = this.alive().flatMap(q => q.battlefield.filter(hit));
        // (Aetherspouts: to the bottom of their owners' libraries instead)
        for (const o of objs) this.move(o, e.toLibrary ? 'library' : 'hand', e.toLibrary ? { bottom: true } : {});
        this.log(`${S} returns ${objs.length} creature${objs.length === 1 ? '' : 's'} to their owners' hands`, { kind: 'removal' });
        break;
      }
      case 'roll': {
        const r = 1 + Math.floor(this.rand() * e.d);
        const row = (e.table || []).find(x => r >= x.lo && r <= x.hi);
        this.log(`${this.pn(p)} rolls a d${e.d}: ${r} (${S})`, { kind: 'minor', rule: '706.2' });
        if (row) await this.runEffects(p, src, row.effects, { ...ctx, targets: undefined, strict: false, x: r });
        break;
      }
      case 'flashTurn': p.flashNow = true; this.log(`${this.pn(p)} may cast spells as though they had flash this turn`, { kind: 'minor' }); break;
      // ---- 1.17.0
      case 'becomeCopy': {
        // Mirage Mirror, Thespian's Stage, Shifting Woodland, Cursed Mirror, Gogo, Sarkhan
        if (src.zone !== 'battlefield') break;
        const words = e.what.split(' or ').map(w => w.trim());
        const fits = x => x !== src && words.some(w => (w === 'permanent' ? x.fx.type.permanent : this.isA(x, w.replace('nontoken ', ''))));
        const pool = e.trig ? [ctx.trig?.o].filter(Boolean) : e.gy ? p.graveyard.filter(fits) : (e.own ? p.battlefield : this.alive().flatMap(q => q.battlefield)).filter(x => fits(x) && !x.token);
        const model = p.agent.pickBest(this, pool);
        if (!model) break;
        if (!src.baseCard) src.baseCard = src.card;
        // ("except it has this ability": Thespian's Stage keeps its copy ability)
        const keep = e.keep ? src.baseCard.fx.abilities.filter(a => a.effects.some(x => x.k === 'becomeCopy')) : [];
        src.card = model.card;
        src.fx = keep.length ? { ...model.card.fx, abilities: [...model.card.fx.abilities, ...keep] } : model.card.fx;
        src.copyUntil = e.eot ? this.turn : null;
        if (e.haste) src.tempKw = new Set([...(src.tempKw || []), 'haste']);
        this.log(`${S} becomes a copy of ${esc(model.card.name)}${e.eot ? ' until end of turn' : ''}`, { kind: 'minor', rule: '707.2' });
        break;
      }
      case 'grantRebound': if (ctx.trig?.o?.zone === 'stack') ctx.trig.o.reboundGrant = true; break;
      case 'returnTrigHand': {
        const c = ctx.trig?.o;
        if (!c || c.zone !== 'graveyard') break;
        if (e.unlessLife) {
          // Athreos: the opponent pays life to keep it in the graveyard (if they can spare it)
          const q = p.agent.weakestOpponent(this, p);
          if (q && q.life > e.unlessLife * 4) { q.life -= e.unlessLife; this.emit('life', { p: q.idx, d: -e.unlessLife }); this.log(`${this.pn(q)} pays ${e.unlessLife} life so ${this.cn(c)} stays in the graveyard`, { kind: 'minor' }); break; }
        }
        if (e.later) { (p.handLater ||= []).push(c); this.log(`${this.cn(c)} will return to ${this.pn(p)}'s hand at the end step`, { kind: 'minor' }); break; }
        this.move(c, 'hand'); this.log(`${S} returns ${this.cn(c)} to ${this.pn(p)}'s hand`, { kind: 'minor' });
        break;
      }
      case 'teamBase': {
        const P = X(e.p), T = X(e.t);
        const objs = p.battlefield.filter(o => o.fx.type.creature && (!e.what || this.isA(o, e.what)));
        for (const o of objs) o.animPT = { p: P, t: T, turn: this.turn, ts: ++this.tsN };
        if (objs.length) this.log(`${S}: ${objs.length} creature${objs.length === 1 ? '' : 's'} have base power and toughness ${P}/${T} until end of turn`, { kind: 'minor' });
        break;
      }
      case 'animateAll': {
        const objs = p.battlefield.filter(o => o.fx.type.artifact && !o.fx.type.creature);
        for (const o of objs) { o.animPT = { p: e.p, t: e.t, turn: this.turn, ts: ++this.tsN }; o.crewed = true; o.fx = { ...o.card.fx, type: { ...o.card.fx.type, creature: true } }; }
        if (objs.length) this.log(`${S}: ${objs.length} artifact${objs.length === 1 ? ' becomes a' : 's become'} ${e.p}/${e.t} creature${objs.length === 1 ? '' : 's'} until end of turn`, { kind: 'minor' });
        break;
      }
      case 'devour': {
        // Devour: eat our own creature tokens as it enters, for +1/+1 counters
        const food = p.battlefield.filter(o => o !== src && o.fx.type.creature && o.token);
        for (const o of food) this.sacrifice(p, o, ' (devoured)');
        if (food.length && src.zone === 'battlefield') { src.counters += this.moreCounters(src, e.n * food.length); this.log(`${S} devours ${food.length} creature${food.length === 1 ? '' : 's'}`, { kind: 'minor', rule: '702.82a' }); }
        break;
      }
      case 'copyAbility': {
        // Strionic Resonator, Lithoform Engine: the topmost ability of yours on the stack happens again
        const it = [...this.stack].reverse().find(x => x.ability && x.p === p && x.o !== src && !x.countered);
        if (!it) { this.log(`${S} has no ability to copy`, { kind: 'minor' }); break; }
        this.log(`${S} copies ${this.cn(it.o)}'s ability`, { kind: 'trigger', rule: '707.10' });
        await this.runEffects(p, it.o, it.effects, { targets: it.targets, trig: it.trig });
        break;
      }
      case 'grasp': {
        // Praetor's Grasp: the best card in the richest opponent's library, exiled face down; we may play it
        const c = p.agent.pickBest(this, this.opponents(p).flatMap(q => q.library));
        if (c) { this.move(c, 'exile'); c.mayPlay = { p: p.idx, until: Infinity }; shuffle(this.players[c.owner].library, this.rand); this.log(`${S}: ${this.pn(p)} exiles a card from ${this.pn(this.players[c.owner])}'s library face down and may play it`, { kind: 'removal' }); }
        break;
      }
      case 'sacUnlessEscaped':
        if (!src.escaped && src.zone === 'battlefield') this.sacrifice(p, src, " (it didn't escape)");
        break;
      case 'gyFreeCast': {
        const pool = p.graveyard.filter(o => o !== src && e.types.some(t => o.fx.type[t]) && o.fx.spell.length);
        const c = p.agent.pickBest(this, pool);
        if (c) { c.gyOnceExile = true; await this.cast(p, c, { mode: { alt: 'free' } }); }
        break;
      }
      case 'castCommanderFree': {
        const c = p.command.find(o => !o.fx.type.land);
        if (c) await this.cast(p, c, { mode: { alt: 'free' } });
        break;
      }
      case 'reanimateTrig': {
        // It That Betrays, Tergrid: the card an opponent sacrificed or discarded comes over to us
        const c = ctx.trig?.o;
        if (c && c.zone === 'graveyard' && c.owner !== p.idx && c.fx.type.permanent && !c.token) {
          this.move(c, 'battlefield', { under: p.idx });
          this.log(`${S} puts ${this.cn(c)} onto the battlefield under ${this.pn(p)}'s control`, { kind: 'removal' });
          this.trigger(c, 'etb');
        }
        break;
      }
      case 'deadbridge': {

        if (!p.graveyard.length) break;
        const c = p.graveyard[Math.floor(this.rand() * p.graveyard.length)];
        if (c.fx.type.creature) { this.move(c, 'battlefield'); this.log(`${S} returns ${this.cn(c)} from the graveyard to the battlefield`); this.trigger(c, 'etb'); }
        else { this.move(c, 'hand'); this.log(`${S} returns ${this.cn(c)} to ${this.pn(p)}'s hand`, { kind: 'minor' }); }
        break;
      }
      case 'hermit': {
        // Hermit Druid: mill until a basic land, which goes to hand (the whole library without one)
        let k = 0, land = null;
        while (p.library.length) {
          const top = p.library[p.library.length - 1];
          if (top.fx.type.basic && top.fx.type.land) { land = top; this.move(top, 'hand'); break; }
          this.move(top, 'graveyard'); k++;
        }
        this.log(`${S}: ${this.pn(p)} reveals ${k + (land ? 1 : 0)} cards, ${land ? `takes ${this.cn(land)}` : 'finds no basic land'} and puts ${k} into the graveyard`, { kind: k >= 20 ? 'removal' : 'minor' });
        break;
      }
      case 'bribery': {
        // From the opponent with the best creature left in their library
        const opts = this.opponents(p).flatMap(q => q.library.filter(o => o.fx.type.creature));
        const c = p.agent.pickBest(this, opts);
        if (c) {
          const q = this.players[c.owner];
          this.move(c, 'battlefield', { under: p.idx });
          shuffle(q.library, this.rand);

          this.log(`${S}: ${this.pn(p)} puts ${this.cn(c)} from ${this.pn(q)}'s library onto the battlefield`, { kind: 'removal' });
          this.trigger(c, 'etb');
        }
        break;
      }
      case 'peer': {
        const q = tgt?.player != null ? this.players[tgt.player] : p;
        const n = Math.ceil(q.library.length / 2), l = Math.ceil(q.life / 2);
        this.draw(q, n);
        q.life -= l; this.emit('life', { p: q.idx, d: -l });
        this.log(`${S}: ${this.pn(q)} draws ${n} cards and loses ${l} life`, { kind: 'removal' });
        break;
      }
      case 'moveEquip': {
        // An equipment (an unattached one first) onto the best creature that doesn't have it
        const eqs = p.battlefield.filter(o => (o.fx.type.equipment || (o.fx.type.aura && o.attachedTo?.controller === p.idx)) && o !== src).sort((a, b) => (a.attachedTo ? 1 : 0) - (b.attachedTo ? 1 : 0));
        const eq = eqs[0];
        const c = eq && this.bestOwnCreature(p, x => x !== eq.attachedTo);
        if (eq && c) { eq.attachedTo = c; this.log(`${S} attaches ${this.cn(eq)} to ${this.cn(c)}`, { kind: 'minor' }); }
        break;
      }
      case 'tapAttached': if (src.attachedTo?.zone === 'battlefield') { src.attachedTo.tapped = true; this.log(`${S} taps ${this.cn(src.attachedTo)}`, { kind: 'minor' }); } break;
      case 'doublePool': {
        const add = p.pool.map(u => ({ ...u }));
        p.pool.push(...add);
        if (add.length) this.log(`${S} doubles ${this.pn(p)}'s unspent mana (${p.pool.length})`, { kind: 'minor' });
        break;
      }
      case 'halfLifeDamage':
        for (const q of this.alive()) { const n = Math.floor(Math.max(0, q.life) / 2); if (n) this.damagePlayer(q, n, src, false); }
        this.log(`${S} deals damage to each player equal to half their life`, { kind: 'removal' });
        break;
      case 'lostAgain':
        for (const q of this.opponents(p)) {
          const n = q.lostLifeTurn === this.turn ? q.lostAmt || 0 : 0;
          if (n > 0) { q.life -= n; q.grudge[p.idx] += n; this.emit('life', { p: q.idx, d: -n }); this.log(`${S}: ${this.pn(q)} loses ${n} more life`); }
        }
        break;
      case 'gyCastTurn': p.gyCast =
 { turn: this.turn, types: e.types }; this.log(`${this.pn(p)} may cast ${e.types.join('/') || ''} spells from their graveyard this turn`.replace('cast  spells', 'cast spells'), { kind: 'minor' }); break;
      case 'stealAll': {
        const q = this.thatPlayer(p, ctx);
        if (!q) break;
        const objs = q.battlefield.filter(o => this.isA(o, e.what));
        for (const o of objs) { q.battlefield.splice(q.battlefield.indexOf(o), 1); o.controller = p.idx; p.battlefield.push(o); }
        if (objs.length) this.log(`${this.pn(p)} gains control of ${objs.length} ${e.what}${objs.length === 1 ? '' : 's'} from ${this.pn(q)}`, { kind: 'removal' });
        break;
      }
      case 'level':
        if (src.zone === 'battlefield' && (src.level || 1) === e.n - 1) {
          src.level = e.n;
          this.log(`${S} becomes level ${e.n}`, { kind: 'minor', rule: '716.2a' });
          for (const w of src.fx.watch || []) if (w.ev === 'level' && w.n === e.n) this.queue.push({ o: src, effects: w.effects, label: `level ${e.n}`, p });
        }
        break;
      case 'station': {
        const n = Math.max(0, p.lastTapPower || 0);
        (src.named ||= {}).charge = (src.named.charge || 0) + n;
        this.log(`${S} gets ${n} charge counter${n === 1 ? '' : 's'} (${src.named.charge})`, { kind: 'minor', rule: '702.184a' });
        break;
      }
      default: break;
    }
  }
  // "That player": whoever the trigger was about (the player dealt combat damage, whose creature died, whose upkeep it is)
  thatPlayer(p, ctx) {
    const t = ctx.trig;
    const i = t?.target ?? (t?.p != null && t.p !== p.idx ? t.p : null);
    const q = i != null ? this.players[i] : null;
    return q && !q.lost ? q : null;
  }
  setMonarch(p, why = '') {
    if (this.monarch === p.idx) return;
    this.monarch = p.idx;
    this.log(`👑 ${this.pn(p)} becomes the monarch${why ? ` (${why})` : ''}`, { kind: 'politics', rule: '724.1' });
  }
  // Boon Reflection, Rhox Faithmender: life gained is doubled
  lifeGain(p, n) {
    // Erebos, Sulfuric Vortex, Rampaging Ferocidon: no life is gained
    if (this.alive().some(q => q.battlefield.some(s => s.fx.noGain === 'all' || (s.fx.noGain === 'opp' && q !== p)))) return 0;
    if (n <= 0) return n;
    const ops = [];
    for (const s of p.battlefield) { if (s.fx.lifePlus) ops.push({ plus: s.fx.lifePlus }); if (s.fx.lifeDouble) ops.push({ mul: 2 }); }
    return this.replaceInOrder(n, ops, 'max');
  }
  // Committing a crime (700.13): targeting an opponent, or something an opponent controls
  noteCrime(p, targets) {
    if ((targets || []).some(t => (t?.player != null && t.player !== p.idx) || (t?.obj && t.obj.controller !== p.idx))) this.fire('crime', { p: p.idx });
  }
  // Fiery Emancipation, Torbran-style: damage from your sources to opponents and their permanents is doubled
  moreDamage(src, victimIdx, n) {
    if (!src || src.controller == null) return n;
    const ops = [];
    // Torbran: +2 from (red) sources to opponents
    if (n > 0 && victimIdx !== src.controller) for (const s of this.players[src.controller].battlefield) if (s.fx.damagePlus && (!s.fx.damagePlus.color || this.colorsOf(src).includes(s.fx.damagePlus.color))) ops.push({ plus: s.fx.damagePlus.n });
    for (const s of this.players[src.controller].battlefield) if (s.fx.damageDouble && (s.fx.damageAny || victimIdx !== src.controller) && (!s.fx.creatureDamageOnly || src.fx.type.creature) && (!s.fx.damageChosen || (s.chosenType && this.isA(src, s.chosenType))) && (!s.fx.damageCounters || src.counters > 0)) ops.push({ mul: s.fx.damageDouble === true ? 2 : s.fx.damageDouble });
    // Dictate of the Twin Gods: every source's damage is doubled
    for (const q of this.alive()) for (const s of q.battlefield) if (s.fx.damageDoubleAll) ops.push({ mul: 2 });
    // Gisela: damage to her controller and their permanents is halved (rounded down)
    if (n > 0 && this.players[victimIdx]?.battlefield.some(s => s.fx.halveDamage)) ops.push({ half: true });
    // (the player or the permanent's controller being dealt the damage orders them: the least damage)
    return this.replaceInOrder(n, ops, 'min');
  }
  damagePlayer(q, n, src, combat) {
    n = this.moreDamage(src, q.idx, n);
    const sc = src?.controller;
    if (sc != null && sc !== q.idx && n > 0) q.lastHitBy = sc;
    // Sulfuric Vortex-style "+1 noncombat damage", Bloodletter-style double loss on its controller's turn
    if (!combat && sc != null && sc !== q.idx) for (const s of this.players[sc].battlefield) if (s.fx.burnPlus) n += s.fx.burnPlus;
    // Solphim: noncombat damage to opponents is doubled
    if (!combat && sc != null && sc !== q.idx) for (const s of this.players[sc].battlefield) if (s.fx.burnDouble) n *= 2;
    if (sc != null && sc !== q.idx && this.active === sc && this.players[sc].battlefield.some(s => s.fx.lossDouble)) n *= 2;
    // Protection from everything until your next turn (Teferi's Protection); Glacial Chasm, Selfless Squire
    if ((q.shield >= this.turn || q.preventTurn === this.turn || q.battlefield.some(s => s.fx.preventMe)) && !this.noPrevent()) n = 0;
    if (this.kingdoms && !this.has(src, 'infect') && !this.noPrevent()) n = K.damageHook(this, q, n, src, combat);
    if (n <= 0 || q.lost) return;
    if (!combat && sc != null && sc !== q.idx) this.fire('noncombat', { o: src, p: sc, n, target: q.idx });
    // Infect deals damage to players as poison counters (702.90b); toxic adds poison on top (702.164)
    if (this.has(src, 'infect')) { q.poison += n; this.log(`${this.pn(q)} gets ${n} poison counter${n === 1 ? '' : 's'} (${q.poison}/10)`, { kind: 'damage', rule: '702.90b' }); }
    else { q.life -= n; this.emit('life', { p: q.idx, d: -n }); }
    if (combat && src.fx.kwN?.toxic) { q.poison += src.fx.kwN.toxic; this.log(`${this.pn(q)} gets ${src.fx.kwN.toxic} poison (toxic, ${q.poison}/10)`, { kind: 'damage', rule: '702.164b' }); }
    q.damagedTurn = this.turn;
    const sp = this.players[src.controller];
    sp.stats.damage += n;
    q.stats.taken = (q.stats.taken || 0) + n;
    // (the biggest single hits, for the post-game report)
    if (n >= 3) (this.bigHits ||= []).push({ turn: this.turn, n, by: sp.idx, to: q.idx, src: src.card.name, combat: !!combat });
    q.grudge[src.controller] += n;
    if (combat && src.isCommander) q.cmdDamage[src.iid] = (q.cmdDamage[src.iid] || 0) + n;
    if (this.has(src, 'lifelink')) { const g = this.lifeGain(sp, n); sp.life += g; this.emit('life', { p: sp.idx, d: g }); }
    // Combat damage to the monarch makes the attacker's controller the monarch (724.2)
    if (combat && this.monarch === q.idx && sp !== q) this.setMonarch(sp, `dealt combat damage to ${q.name}`);
  }
  damageObj(o, n, src) {
    n = this.moreDamage(src, o.controller, n);
    // Prevent all damage to your attacking creatures; Teferi's Protection covers your permanents
    if (!this.noPrevent()) {
      if (o.attacking != null && this.players[o.controller].battlefield.some(s => s.fx.protectAttackers && (s.fx.protectAttackers !== 'artifact' || (o.fx.type.artifact && src?.fx.type.creature)))) n = 0;
      if (this.players[o.controller].shield >= this.turn) n = 0;
    }
    if (n <= 0 || o.zone !== 'battlefield') return;
    // Protection from a color prevents damage from sources of that color (702.16e)
    if (src && o.fx.prot?.some(c => this.colorsOf(src).includes(c))) { this.log(`${this.cn(o)}'s protection prevents the damage`, { kind: 'minor', rule: '702.16e' }); return; }
    if (o.fx.type.planeswalker && !o.fx.type.creature) o.loyalty -= n;
    else if (o.fx.type.battle && !o.fx.type.creature) o.defense = Math.max(0, (o.defense || 0) - n);
    // Wither and infect deal damage to creatures as -1/-1 counters
    else if (src && (this.has(src, 'wither') || this.has(src, 'infect'))) { o.counters -= n; o.hadMinus = true; }
    else { o.damage += n; if (src && this.has(src, 'deathtouch')) o.deathtouched = true; }
    this.emit('hit', { iid: o.iid, n });
    this.fire('damaged', { o, n });
    if (src && this.has(src, 'lifelink')) { const sp = this.players[src.controller]; const g = this.lifeGain(sp, n); sp.life += g; this.emit('life', { p: sp.idx, d: g }); }
  }

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
    const opps = this.opponents(p);
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
  async combat(p) {
    this.setPhase('combat');
    this.fire('begCombat', { p: p.idx });
    if (this.queue.length) { await this.sba(); if (this.over || p.lost) return; }
    await this.stopFor('combat', p);
    if (this.over || p.lost) return;
    // Kingdoms: the Knight in Shining Armor made this player skip their next combat
    if (p.skipCombat) { p.skipCombat = false; this.log(`${this.pn(p)} skips this combat`, { kind: 'minor', rule: 'Kingdoms' }); return; }
    let decl = (await p.agent.declareAttackers(this, p)).filter(d => this.canAttack(d.o) && d.target !== p.idx && !this.players[d.target].lost && (!this.kingdoms || !K.teammates(p, this.players[d.target])) && !(this.teams && this.players[d.target].team === p.team));
    // (an attack on a battle or planeswalker is an attack on its protector or controller: d.obj is the permanent)
    for (const d of decl) if (d.obj && !this.attackable(p, d.obj)) d.obj = null;
    if (this.rules >= 5 && p.agent.battleAttacks) p.agent.battleAttacks(this, p, decl);
    // Goad (701.15): a goaded creature attacks each combat if able, and attacks someone other than the goader
    for (const o of p.battlefield) {
      if (!o.goaded || o.goaded.until < this.turn || !this.canAttack(o)) continue;
      const d = decl.find(x => x.o === o);
      const others = this.opponents(p).filter(q => q.idx !== o.goaded.by);
      if (d && d.target === o.goaded.by && others.length) d.target = others.sort((a, b) => a.life - b.life)[0].idx;
      if (!d) decl.push({ o, target: (others.length ? others : this.opponents(p)).sort((a, b) => a.life - b.life)[0].idx });
    }
    // "Attacks each combat if able" (Toski, Juggernaut)
    for (const o of p.battlefield) if ((o.fx.mustAttack || (o.fx.condBuff?.mustAttack && this.condBuff(o))) && this.canAttack(o) && !decl.some(x => x.o === o) && this.opponents(p).length) {
      decl.push({ o, target: p.agent.weakestOpponent(this, p).idx });
    }
    // Kingdoms, the Straw Man: every creature able to attack them does (until their next turn)
    const straw = this.strawMan && this.players[this.strawMan.idx];
    if (straw && !straw.lost && straw.idx !== p.idx) {
      for (const o of p.battlefield) if (o.fx.type.creature && this.canAttack(o)) {
        const d = decl.find(x => x.o === o);
        if (d) { d.target = straw.idx; d.obj = null; } else decl.push({ o, target: straw.idx });
      }
    }
    // Propaganda-style taxes: each attacker costs mana, and any that can't be paid for stay home
    for (const t of new Set(decl.map(d => d.target))) {
      const tax = this.players[t].battlefield.reduce((s, o) => s + (o.fx.attackTax || 0) + (o.fx.attackTaxDyn ? this.countControlled(this.players[t], o.fx.attackTaxDyn) : 0), 0);
      if (!tax) continue;
      const mine = decl.filter(d => d.target === t).sort((a, b) => this.power(b.o) - this.power(a.o));
      let paid = 0;
      for (; paid < mine.length; paid++) {
        const plan = this.planPayment(p, { generic: tax, pips: [], x: 0 });
        if (!plan) break;
        this.commitPayment(p, plan);
      }
      if (paid < mine.length) decl = decl.filter(d => !mine.slice(paid).includes(d));
      this.log(`${this.pn(p)} pays {${tax * paid}} to attack ${this.pn(this.players[t])}${paid < mine.length ? ` and holds ${mine.length - paid} back` : ''}`, { kind: 'minor' });
    }
    // Silent Arbiter: no more than one creature can attack each combat (Mirri: you); the strongest go
    // Sandwurm Convergence: flyers can't attack its controller
    decl = decl.filter(d => !(this.has(d.o, 'flying') && this.players[d.target]?.battlefield.some(s => s.fx.noFlyAttack)));
    if (this.alive().some(q => q.battlefield.some(o => o.fx.attackCap))) decl = decl.sort((a, b) => this.power(b.o) - this.power(a.o)).slice(0, 1);
    for (const q of this.alive()) {
      const cap = q.battlefield.filter(o => o.fx.attackMeCap && (!o.fx.attackMeCap.tapped || o.tapped)).map(o => o.fx.attackMeCap.n);
      if (!cap.length) continue;
      const at = decl.filter(d => d.target === q.idx).sort((a, b) => this.power(b.o) - this.power(a.o)).slice(0, Math.min(...cap));
      decl = decl.filter(d => d.target !== q.idx || at.includes(d));
    }
    if (!decl.length) { await this.beat(0.3); return; }
    for (const d of decl) {
      Object.assign(d.o, { attacking: d.target, attackingObj: d.obj || null, blockedBy: [], blocked: false });
      if (!this.has(d.o, 'vigilance')) { d.o.tapped = true; this.fire('tapped', { o: d.o, p: p.idx }); }
    }
    const byTarget = new Map();
    for (const d of decl) byTarget.set(d.target, [...(byTarget.get(d.target) || []), d.o]);
    for (const [t, os] of byTarget) this.log(`${this.pn(p)} attacks ${this.pn(this.players[t])} with ${os.map(o => this.cn(o)).join(', ')}`, { kind: 'combat', rule: '508.1' });
    for (const t of byTarget.keys()) if (this.dealBetween(p.idx, t)) this.breakDeal(p, this.players[t]);
    for (const d of decl) if (d.obj) this.log(`${this.cn(d.o)} attacks ${this.cn(d.obj)}`, { kind: 'combat', rule: '506.3' });
    await this.beat(1.4);
    p.attackedTurn = this.turn;
    this.attackKeywords(p, decl);
    if (this.rules >= 5) await this.enlist(p, decl);
    for (const d of decl) {
      this.trigger(d.o, 'attack');
      this.fire('allyAttacks', { o: d.o, p: p.idx });
      this.fire('attachedAttacks', { o: d.o, p: p.idx });
    }
    this.fire('youAttack', { p: p.idx, n: decl.length, os: decl.map(d => d.o) });
    await this.sba();
    if (this.over) return;
    const attackers = () => p.battlefield.filter(o => o.attacking != null);

    for (const q of this.order(p.idx)) {
      if (q === p || q.lost) continue;
      let mine = attackers().filter(a => a.attacking === q.idx);
      if (!mine.length) continue;
      const r = await q.agent.combatResponse(this, q, mine);
      if (r) { await this.cast(q, r.card, { targets: r.targets }); if (this.over) return; mine = attackers().filter(a => a.attacking === q.idx); }
      const used = new Set();
      // Silent Arbiter: no more than one creature can block each combat
      const cap = this.alive().some(x => x.battlefield.some(o => o.fx.blockCap)) ? 1 : Infinity;
      for (const { b, a } of await q.agent.declareBlockers(this, q, mine)) {
        if (used.has(b) || !mine.includes(a) || !this.canBlock(b, a)) continue;
        if (this.alive().reduce((s, x) => s + x.battlefield.filter(o => o.blocking != null).length, 0) >= cap) break;
        used.add(b); b.blocking = a.iid; a.blockedBy.push(b);
        // (item 109: a chump block — the blocker dies and the attacker lives)
        if (q.tells && !this.sim) { q.tells.blocks++; if (this.toughness(b) - b.damage <= this.power(a) && this.power(b) < this.toughness(a) - a.damage) q.tells.chumps++; }
      }
      // Two-Headed Giant: the defender's teammate blocks too, among the attackers still unblocked (810.7)
      const mate = this.teammate(q);
      const free = mate ? mine.filter(a => !a.blockedBy.length) : [];
      if (mate && free.length && mate.battlefield.some(o => o.fx.type.creature && !o.tapped)) {
        for (const { b, a } of await mate.agent.declareBlockers(this, mate, free)) {
          if (used.has(b) || b.controller !== mate.idx || !free.includes(a) || !this.canBlock(b, a)) continue;
          if (this.alive().reduce((s, x) => s + x.battlefield.filter(o => o.blocking != null).length, 0) >= cap) break;
          used.add(b); b.blocking = a.iid; a.blockedBy.push(b);
        }
      }
      if (q.tells && !this.sim && q.battlefield.some(o => o.fx.type.creature && !o.tapped)) q.tells.faced++;
      for (const a of mine) {
        if (this.has(a, 'menace') && a.blockedBy.length === 1) { a.blockedBy[0].blocking = null; a.blockedBy = []; }
        a.blocked = a.blockedBy.length > 0;
      }
      const lines = mine.filter(a => a.blocked).map(a => `${a.blockedBy.map(b => this.cn(b)).join(' + ')} blocks ${this.cn(a)}`);
      this.log(lines.length ? `${this.pn(q)}: ${lines.join('; ')}` : `${this.pn(q)} declares no blockers`, { kind: 'combat', rule: '509.1' });
      this.blockKeywords(q, mine);
    }
    await this.sba();
    if (this.over) return;
    // Ninjutsu (702.49): swap an unblocked attacker for a ninja from hand
    if (!p.agent.human) {
      const swap = p.agent.ninjutsu?.(this, p, attackers().filter(a => !a.blocked));
      if (swap) await this.ninjutsu(p, swap.ninja, swap.out);
    }
    // The table shows a battle preview of every attacker, its blockers and the expected result
    this.emit('battle', { p, attackers: attackers() });
    await this.beat(1.6);
    // Priority after blockers: attacker first, then each defender, may cast a combat trick
    for (const q of this.order(p.idx)) {
      if (q.lost || this.over) continue;
      const r = await q.agent.combatTrick(this, q, p);
      if (r) await this.cast(q, r.card, { targets: r.targets });
    }
    if (this.over) return;
    const participants = () => [...attackers(), ...this.players.flatMap(q => q.battlefield.filter(o => o.blocking != null))];
    const fsStep = participants().some(o => this.has(o, 'first strike') || this.has(o, 'double strike'));
    if (fsStep) { await this.combatDamage(p, true, true); await this.sba(); if (this.over) return; }
    await this.combatDamage(p, false, fsStep);
    await this.sba();
    // Decayed (702.147): sacrificed at end of combat after it attacked
    for (const o of attackers()) if (this.has(o, 'decayed')) this.sacrifice(p, o, ' (decayed)');
    for (const q of this.players) for (const o of q.battlefield) Object.assign(o, { attacking: null, blocking: null, blockedBy: [], blocked: false });
    await this.sba();
  }
  // Attack keywords: exalted, battle cry, annihilator, melee, dethrone, training, mentor
  attackKeywords(p, decl) {
    const atk = decl.map(d => d.o);
    if (atk.length === 1) {
      const ex = p.battlefield.filter(o => o.fx.kw.has('exalted')).length;
      if (ex) { atk[0].tempP += ex; atk[0].tempT += ex; this.log(`${this.cn(atk[0])} attacks alone: +${ex}/+${ex} (exalted)`, { kind: 'minor', rule: '702.83a' }); }
    }
    const targets = new Set(decl.map(d => d.target));
    for (const d of decl) {
      const o = d.o, q = this.players[d.target];
      if (this.has(o, 'battle cry')) { for (const x of atk) if (x !== o) x.tempP++; this.log(`${this.cn(o)}: battle cry (+1/+0 to the other attackers)`, { kind: 'minor', rule: '702.91a' }); }
      const ann = o.fx.kwN?.annihilator;
      if (ann) {
        const perms = q.battlefield.map(x => ({ x, v: x.fx.type.land ? 0.8 : q.agent.value(this, x) + q.agent.pieceWorth(this, q, x) })).sort((a, b) => a.v - b.v).slice(0, ann).map(y => y.x);
        for (const x of perms) this.sacrifice(q, x, ` (annihilator ${ann})`);
      }
      if (this.has(o, 'melee') && targets.size) { o.tempP += targets.size; o.tempT += targets.size; }
      if (this.has(o, 'dethrone') && this.alive().every(r => r.life <= q.life)) { o.counters++; this.log(`${this.cn(o)} attacks the player with the most life: +1/+1 counter (dethrone)`, { kind: 'minor', rule: '702.105a' }); }
      if (this.has(o, 'training') && atk.some(x => x !== o && this.power(x) > this.power(o))) { o.counters++; this.log(`${this.cn(o)} trains: +1/+1 counter`, { kind: 'minor', rule: '702.149a' }); }
      if (this.has(o, 'mentor')) {
        const pupil = atk.filter(x => x !== o && this.power(x) < this.power(o)).sort((a, b) => this.power(b) - this.power(a))[0];
        if (pupil) { pupil.counters++; this.log(`${this.cn(o)} mentors ${this.cn(pupil)}: +1/+1 counter`, { kind: 'minor', rule: '702.134a' }); }
      }
    }
  }
  // Block keywords: bushido, rampage, flanking, afflict, and block/blocked watchers
  blockKeywords(q, attackers) {
    for (const a of attackers) {
      if (!a.blocked) continue;
      const bu = a.fx.kwN?.bushido;
      if (bu) { a.tempP += bu; a.tempT += bu; }
      const ra = a.fx.kwN?.rampage;
      if (ra && a.blockedBy.length > 1) { a.tempP += ra * (a.blockedBy.length - 1); a.tempT += ra * (a.blockedBy.length - 1); }
      if (this.has(a, 'flanking')) for (const b of a.blockedBy) if (!this.has(b, 'flanking')) { b.tempP--; b.tempT--; }
      const af = a.fx.kwN?.afflict;
      if (af) { q.life -= af; this.emit('life', { p: q.idx, d: -af }); this.log(`${this.pn(q)} loses ${af} life (afflict)`, { kind: 'damage', rule: '702.130a' }); }
      this.fire('blocked', { o: a, p: a.controller });
      for (const b of a.blockedBy) {
        const bb = b.fx.kwN?.bushido;
        if (bb) { b.tempP += bb; b.tempT += bb; }
        this.fire('block', { o: b, p: q.idx });
      }
    }
  }
  async ninjutsu(p, ninja, out) {
    const plan = this.planPayment(p, parseCost(ninja.fx.ninjutsu), 0);
    if (!plan || ninja.zone !== 'hand' || out.zone !== 'battlefield' || out.blocked) return false;
    this.commitPayment(p, plan);
    const target = out.attacking;
    this.move(out, 'hand');
    this.move(ninja, 'battlefield', { tapped: true });
    Object.assign(ninja, { attacking: target, blockedBy: [], blocked: false });
    this.log(`${this.pn(p)} returns ${this.cn(out)} to hand and ninjutsus in ${this.cn(ninja)}, attacking ${this.pn(this.players[target])}`, { kind: 'combat', rule: '702.49a' });
    this.trigger(ninja, 'etb');
    await this.sba();
    return true;
  }

  // A division of an attacker's combat damage: [{ obj, n } for blockers, { player: true, n } for trample-over].
  // Returns it if it adds up and gives the player nothing before every blocker has lethal damage, else null.
  lethalFor(b, dt) { return dt ? 1 : Math.max(0, this.toughness(b) - b.damage); }
  validDamagePlan(plan, blockers, dmg, tr, dt) {
    if (!Array.isArray(plan) || plan.some(x => !(x.n >= 0) || (x.obj && !blockers.includes(x.obj)))) return null;
    if (plan.reduce((s, x) => s + x.n, 0) !== dmg) return null;
    const toPlayer = plan.filter(x => !x.obj).reduce((s, x) => s + x.n, 0);
    if (toPlayer && (!tr || blockers.some(b => plan.filter(x => x.obj === b).reduce((s, x) => s + x.n, 0) < this.lethalFor(b, dt)))) return null;
    return plan;
  }
  async combatDamage(p, first, hadFirst) {
    // Fog effects
    if (this.fogTurn === this.turn && !this.noPrevent()) { if (!first) this.log('All combat damage is prevented this turn', { kind: 'combat', rule: '615.1' }); return; }
    const fs = o => this.has(o, 'first strike'), ds = o => this.has(o, 'double strike');
    const deals = o => (first ? fs(o) || ds(o) : !hadFirst || !fs(o) || ds(o));
    /** @type {any[]} */
    const evs = [];
    for (const a of p.battlefield.filter(o => o.attacking != null)) {
      const blockers = a.blockedBy.filter(b => b.zone === 'battlefield');
      if (deals(a)) {
        let dmg = this.power(a);
        const tr = this.has(a, 'trample'), dt = this.has(a, 'deathtouch');
        if (dmg > 0) {
          const def = n => (a.attackingObj?.zone === 'battlefield' ? { src: a, obj: a.attackingObj, n, attacked: true } : { src: a, player: a.attacking, n });
          if (!a.blocked) evs.push(def(dmg));
          else if (!blockers.length) { if (tr) evs.push(def(dmg)); }
          else {
            // The attacking player divides the damage among the blockers as they choose (510.1c); with trample, the
            // rest goes to the player once every blocker has been assigned lethal damage (702.19c). Rules 4: in order.
            const plan = this.rules >= 5 && (blockers.length > 1 || tr) && p.agent.assignCombatDamage
              ? this.validDamagePlan(await p.agent.assignCombatDamage(this, p, a, blockers, dmg, tr, dt), blockers, dmg, tr, dt) : null;
            if (plan) { for (const x of plan) if (x.n > 0) evs.push(x.obj ? { src: a, obj: x.obj, n: x.n } : def(x.n)); }
            else {
              blockers.forEach((b, k) => {
                if (dmg <= 0) return;
                const lethal = dt ? 1 : Math.max(0, this.toughness(b) - b.damage);
                const amt = k === blockers.length - 1 && !tr ? dmg : Math.min(dmg, lethal);
                evs.push({ src: a, obj: b, n: amt });
                dmg -= amt;
              });
              if (dmg > 0 && tr) evs.push(def(dmg));
            }
          }
        }
      }
      for (const b of blockers) if (deals(b) && this.power(b) > 0) evs.push({ src: b, obj: a, n: this.power(b) });
    }
    if (!evs.length) return;
    const toPlayer = new Map();
    let initiativeTo = null;
    // Fog Bank: no combat damage to or from it
    for (let k = evs.length - 1; k >= 0; k--) if (evs[k].src?.fx.fogBank || evs[k].obj?.fx.fogBank) evs.splice(k, 1);
    for (const ev of evs) {
      if (ev.player != null) {
        const q = this.players[ev.player];
        if (q.lost) continue;
        this.damagePlayer(q, ev.n, ev.src, true);
        // (combat damage to the player with the initiative takes it from them: 725.2)
        if (this.rules >= 5 && this.initiative === ev.player && ev.src.controller !== ev.player && initiativeTo == null) initiativeTo = ev.src.controller;
        // Ragavan and other "deals combat damage to a player" triggers
        if (ev.src.fx.combatDamage?.length) this.queue.push({ o: ev.src, effects: ev.src.fx.combatDamage, label: 'combat damage', p: this.players[ev.src.controller], trig: { o: ev.src, target: ev.player, n: ev.n } });
        const info = { o: ev.src, p: ev.src.controller, target: ev.player, n: ev.n };
        this.fire('allyCombat', info); this.fire('attachedDamage', info); this.fire('selfCombat', info);
        toPlayer.set(q, [...(toPlayer.get(q) || []), ev]);
      } else { this.damageObj(ev.obj, ev.n, ev.src); this.fire('selfCombat', { o: ev.src, p: ev.src.controller }); }
    }
    for (const [q, list] of toPlayer) {
      const total = list.reduce((s, e) => s + e.n, 0);
      const cmd = list.filter(e => e.src.isCommander).map(e => `${this.cn(e.src)} commander damage ${q.cmdDamage[e.src.iid]}/${this.format.cmdDamage || 21}`);
      this.log(`${list.map(e => this.cn(e.src)).join(', ')} deal${list.length === 1 ? 's' : ''} ${total} combat damage to ${this.pn(q)}${cmd.length ? ` (${cmd.join(', ')})` : ''}`, { kind: 'damage', rule: first ? '510.4' : '510.2' });
    }
    if (initiativeTo != null) await this.takeInitiative(this.players[initiativeTo]);
    await this.beat(1.2);
  }

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
