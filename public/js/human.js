// A seat played by you. The engine asks this agent for the same decisions it asks the AI pilots;
// the important ones (main phase plays, attacks, blocks, responses, mulligans, truces) wait for
// your clicks, and routine choices (what to discard, trigger targets, tutors) use the AI's pick.
import { Agent } from './ai.js';
import { DUNGEONS } from './dungeons.js';
import { parseCost } from './engine.js';
import { needsTarget, costText } from './effects.js';
import { esc } from './util.js';
import { canAnnounce, announceLabel, announceHuman } from './kingdomsPlay.js';

const instantSpeed = o => !o.ownerP?.sorceryLocked && (o.fx.type.instant || o.fx.kw.has('flash')
  || (!o.fx.type.land && (!!o.ownerP?.flashNow || !!o.ownerP?.battlefield.some(x => x.fx.flashGrant === 'any' || (x.fx.flashGrant === 'noncreature' && !o.fx.type.creature)))));

// The action bar plus "click a card / click a player" picking
export class HumanUI {
  constructor() {
    this.bar = document.getElementById('actionBar');
    this.text = document.getElementById('abText');
    this.buttons = document.getElementById('abButtons');
    this.pending = null;
    document.addEventListener('click', e => {
      if (!this.pending) return;
      const card = e.target.closest('[data-iid]');
      if (card && this.pending.objs.has(+card.dataset.iid)) { e.preventDefault(); e.stopPropagation(); return this.finish({ obj: this.pending.objs.get(+card.dataset.iid) }); }
      const board = e.target.closest('.board[data-player]');
      if (board && this.pending.players.has(+board.dataset.player) && !card) return this.finish({ player: +board.dataset.player });
    }, true);
    // Drag to attack (item 117): drop one of the highlighted creatures on an opponent's board while declaring
    // attackers. It's answered as the same two clicks (the creature, then "Attack <player>"), so replays don't change.
    let drag = null;
    document.addEventListener('pointerdown', e => {
      const card = e.target.closest?.('[data-iid]');
      drag = this.pending && card && this.pending.objs.has(+card.dataset.iid) && /Declare attackers/.test(this.text.textContent) ? { iid: +card.dataset.iid, x: e.clientX, y: e.clientY } : null;
    }, true);
    document.addEventListener('pointerup', e => {
      const d = drag; drag = null;
      if (!d || !this.pending || Math.hypot(e.clientX - d.x, e.clientY - d.y) < 30) return;
      const board = document.elementFromPoint(e.clientX, e.clientY)?.closest('.board[data-player]');
      if (!board) return;
      const target = +board.dataset.player;
      this.autoNext = { button: target };
      // (if the creature was already selected, the click would unselect it: answer the attack straight away instead)
      const hasAttack = this.pending.buttons.some(b => b.value === target);
      if (hasAttack && this.view?.cards.get(d.iid)?.classList.contains('chosen')) { this.autoNext = null; this.finish({ button: target }); }
      else this.finish({ obj: this.pending.objs.get(d.iid) });
    }, true);
  }
  // record: every answer given in this game, in order. When a game is rebuilt (replay, rewind, undo)
  // the recorded answers are replayed until they run out, then you're asked live again.
  attach(game, view, record = []) { this.cancel(); this.game = game; this.view = view; this.record = record; this.pos = 0; }
  get replaying() { return this.pos < this.record.length; }
  // Show a question; resolves with {button}, {obj} or {player}
  ask(text, { buttons = [], objs = [], players = [] } = {}) {
    this.cancel();
    const objMap = new Map(objs.map(o => [o.iid, o]));
    if (this.replaying) {
      const a = this.record[this.pos++];
      const v = a.o != null ? { obj: objMap.get(a.o) || this.game.objects.get(a.o) } : a.pl != null ? { player: a.pl } : { button: buttons[a.b]?.value ?? 'cancel' };
      return Promise.resolve(v);
    }
    // Live from here on: anything recorded after this point no longer applies
    this.record.length = this.pos;
    if (this.game?.clock.untilLive) { this.game.clock.untilLive = false; this.game.clock.setPaused?.(false); }
    return new Promise(resolve => {
      const rec = v => {
        this.record.push(v.obj ? { o: v.obj.iid } : v.player != null ? { pl: v.player } : { b: buttons.findIndex(b => b.value === v.button) });
        this.pos++;
        this.onRecord?.('h', this.record.length - 1);
        resolve(v);
      };
      this.pending = { resolve: rec, buttons, objs: objMap, players: new Set(players) };
      this.waiting = true;
      // (the second half of a drag-to-attack: answer at once if this question offers that attack)
      const auto = this.autoNext;
      this.autoNext = null;
      if (auto && buttons.some(b => b.value === auto.button)) { setTimeout(() => this.finish(auto), 0); }
      this.text.innerHTML = text;
      this.buttons.innerHTML = '';
      // A long list (searching a library) gets a filter box and scrolls
      this.buttons.classList.toggle('many', buttons.length > 12);
      if (buttons.length > 12) {
        const f = document.createElement('input');
        f.className = 'input ab-filter';
        f.placeholder = 'Filter…';
        f.addEventListener('input', () => { const q = f.value.toLowerCase(); for (const el of this.buttons.querySelectorAll('button')) el.hidden = !!q && !el.textContent.toLowerCase().includes(q) && !el.classList.contains('keep'); });
        f.addEventListener('keydown', e => e.stopPropagation());
        this.buttons.append(f);
        setTimeout(() => f.focus(), 0);
      }
      for (const b of buttons) {
        const el = document.createElement('button');
        el.className = `btn ${b.primary ? 'primary' : ''} ${b.keep ? 'keep' : ''}`;
        el.textContent = b.label;
        // (keyboard shortcuts read these, so they still work when the labels are translated)
        if (/AI/.test(b.label)) el.dataset.ai = '1';
        if (/^(Cancel|Pass|No )/.test(b.label)) el.dataset.esc = '1';
        if (b.iid) el.dataset.iid = b.iid;
        el.addEventListener('click', () => this.finish({ button: b.value }));
        this.buttons.append(el);
      }
      this.bar.hidden = false;
      this.highlight(true);
    });
  }
  highlight(on) {
    if (!this.pending || !this.view) return;
    this.view.render();
    for (const iid of this.pending.objs.keys()) this.view.cards.get(iid)?.classList.toggle('pickable', on);
    for (const b of this.view.boards) b.el.classList.toggle('pickable', on && this.pending.players.has(b.p.idx));
  }
  finish(value) {
    const p = this.pending;
    if (!p) return;
    this.highlight(false);
    this.pending = null;
    this.waiting = false;
    this.bar.hidden = true;
    p.resolve?.(value);
  }
  // A cancelled question (the game was rebuilt) isn't recorded
  cancel() {
    const p = this.pending;
    if (!p) return;
    this.highlight(false);
    this.pending = null;
    this.waiting = false;
    this.bar.hidden = true;
    p.resolve = null;
  }
  // Keyboard: Space/Enter = main button, Esc = cancel, 1–9 = nth button, A = let the AI decide
  key(e) {
    if (!this.pending) return false;
    const btns = [...this.buttons.children];
    let b = null;
    if (e.key === ' ' || e.key === 'Enter') b = btns.find(x => x.classList.contains('primary')) || btns[0];
    else if (e.key === 'Escape') b = btns.find(x => x.dataset.esc);
    else if (/^[1-9]$/.test(e.key)) b = btns[+e.key - 1];
    else if (e.key.toLowerCase() === 'a') b = btns.find(x => x.dataset.ai);
    if (!b) return false;
    e.preventDefault();
    b.click();
    return true;
  }
}

// Hotseat: several people share this PC, each playing a seat through the same action bar. Before a
// different seat's decision, the table hides every hand and asks to pass the device; then only that
// seat's hand is shown. (Replays and rewinds skip the cover, because recorded answers need no one.)
export class SeatUI {
  constructor(ui, seat, names) { this.ui = ui; this.seat = seat; this.names = names; }
  get waiting() { return this.ui.waiting && this.ui.seat === this.seat; }
  get replaying() { return this.ui.replaying; }
  get view() { return this.ui.view; }
  get game() { return this.ui.game; }
  key(e) { return this.ui.key(e); }
  async ask(text, opts) {
    const ui = this.ui;
    if (!ui.replaying && ui.seat !== this.seat) {
      if (ui.view) { ui.view.humanIdx = -1; ui.view.render(); }
      await passDevice(this.names[this.seat]);
    }
    ui.seat = this.seat;
    if (ui.view && ui.view.humanIdx !== this.seat) { ui.view.humanIdx = this.seat; ui.view.render(); }
    return ui.ask(`<b>${esc(this.names[this.seat])}:</b> ${text}`, opts);
  }
}
function passDevice(name) {
  const m = document.getElementById('passModal');
  if (!m) return Promise.resolve();
  document.getElementById('passName').textContent = name;
  m.hidden = false;
  return new Promise(res => {
    const btn = document.getElementById('btnPassReady');
    const go = () => { btn.removeEventListener('click', go); m.hidden = true; res(); };
    btn.addEventListener('click', go);
    btn.focus();
  });
}

export class HumanAgent extends Agent {
  // opts.stops: steps to stop at ({ myUpkeep, myDraw, myCombat, myEnd, oppUpkeep, oppDraw, oppCombat, oppEnd });
  // opts.full: Full control (stop at every priority point, even with nothing to play);
  // opts.orderTriggers: ask the order of several of your triggers at once (default on)
  constructor(style, ui, opts = {}) {
    super(style); this.human = true; this.ui = ui;
    this.stops = opts.stops || {}; this.full = !!opts.full; this.orderTriggersOn = opts.orderTriggers !== false;
    // Main-phase actions, for spotting a loop you've played twice (the loop shortcut)
    this.acts = [];
  }

  // Walking Ballista and friends: remove +1/+1 counters to deal 1 damage each (any target, one at a time)
  pingers(g, p) { return p.battlefield.filter(o => o.fx.pingCounters && o.counters > 0); }
  async usePing(g, p, o) {
    for (let k = 0; k < 99 && o.counters > 0 && o.zone === 'battlefield' && !g.over; k++) {
      const t = await this.pickTarget(g, p, { k: 'damage', n: 1, to: 'any target' }, o);
      if (!t || t === 'cancel') return;
      await g.ping(p, o, [t]);
      await g.sba();
      if (!(o.counters > 0) || o.zone !== 'battlefield') return;
      const again = await this.ui.ask(`<b>${esc(o.card.name)}</b> has ${o.counters} counter${o.counters === 1 ? '' : 's'} left. Ping again?`, { buttons: [{ label: 'Ping again', value: true, primary: true }, { label: 'Done', value: false }] });
      if (again.button !== true) return;
    }
  }
  // (an object with both: its ability, or a ping?)
  async pingOrAbility(g, p, o) {
    const r = await this.ui.ask(`<b>${esc(o.card.name)}</b>: remove a counter to deal 1 damage, or use its other ability?`, { buttons: [{ label: 'Remove a counter: 1 damage', value: 'ping', primary: true }, { label: 'Other ability', value: 'ab' }, { label: 'Cancel', value: 'cancel' }] });
    return r.button;
  }

  // Rings of Brighthearth: copy this ability for {2}?
  async wantsAbilityCopy(g, p, o, ab) {
    const r = await this.ui.ask(`<b>Rings of Brighthearth:</b> pay {2} to copy ${esc(o.card.name)}'s ability (${esc((ab.text || '').slice(0, 60))})?`, { buttons: [{ label: 'Copy it ({2})', value: true, primary: true }, { label: 'No', value: false }] });
    return r.button === true;
  }

  // Your attacker is blocked by several creatures (or has trample): divide its damage
  async assignCombatDamage(g, p, a, blockers, dmg, tr, dt) {
    const plan = new Map(blockers.map(b => [b, 0]));
    let left = dmg;
    while (left > 0) {
      const allLethal = blockers.every(b => plan.get(b) >= g.lethalFor(b, dt));
      const r = await this.ui.ask(`<b>${esc(a.card.name)}</b> has <b>${left}</b> of ${dmg} damage left to assign. Click a blocker${tr ? (allLethal ? ', or send the rest to the player (trample)' : ' (trample: every blocker needs lethal damage before the player gets any)') : ''}. ${blockers.map(b => `${esc(b.card.name)}: ${plan.get(b)} (lethal ${g.lethalFor(b, dt)})`).join(' · ')}`, {
        objs: blockers,
        buttons: [...(tr && allLethal ? [{ label: `Rest to the player (${left})`, value: 'player', primary: true }] : []), { label: 'Assign it for me', value: 'ai' }],
      });
      if (r.button === 'player') return [...blockers.map(b => ({ obj: b, n: plan.get(b) })), { player: true, n: left }];
      if (r.button === 'ai' || !r.obj) return super.assignCombatDamage(g, p, a, blockers, dmg, tr, dt);
      const b = r.obj, need = Math.max(0, g.lethalFor(b, dt) - plan.get(b));
      const amts = [...new Set([need, 1, 2, 3, left].filter(n => n >= 1 && n <= left))].sort((x, y) => x - y);
      const c = await this.ui.ask(`How much damage to <b>${esc(b.card.name)}</b>?`, { buttons: [...amts.map(n => ({ label: n === need ? `${n} (lethal)` : n === left ? `${n} (all)` : `${n}`, value: n, primary: n === need })), { label: 'Back', value: 0 }] });
      if (typeof c.button === 'number' && c.button > 0) { plan.set(b, plan.get(b) + c.button); left -= c.button; }
    }
    return blockers.map(b => ({ obj: b, n: plan.get(b) }));
  }
  // "Damage divided as you choose among …": pick targets and amounts
  async divideDamageAsync(g, p, src, e, n, tgt) {
    const plan = [];
    let left = n;
    const creatures = () => g.players.flatMap(q => q.battlefield.filter(o => o.fx.type.creature && g.canTarget(p, o)));
    const key = x => (x.obj ? `o${x.obj.iid}` : `p${x.player}`);
    while (left > 0) {
      const r = await this.ui.ask(`<b>${esc(src.card.name)}</b>: ${left} of ${n} damage left to divide${plan.length ? ` (so far: ${plan.map(x => `${x.n} to ${esc(x.obj ? x.obj.card.name : g.players[x.player].name)}`).join(', ')})` : ''}. Click a creature${e.to === 'any target' ? ' or choose a player' : ''}.`, {
        objs: creatures(),
        buttons: [...(e.to === 'any target' ? g.alive().map(q => ({ label: q.name, value: { player: q.idx } })) : []), { label: 'Divide it for me', value: 'ai' }],
      });
      if (r.button === 'ai') return super.divideDamage(g, p, src, e, n, tgt);
      const pick = r.obj ? { obj: r.obj } : r.button?.player != null ? { player: r.button.player } : null;
      if (!pick) continue;
      const have = plan.find(x => key(x) === key(pick));
      if (!have && plan.length >= e.divided) continue;
      const need = pick.obj ? Math.max(1, g.toughness(pick.obj) - pick.obj.damage) : left;
      const amts = [...new Set([1, 2, 3, need, left].filter(k => k >= 1 && k <= left))].sort((a, b) => a - b);
      const c = await this.ui.ask(`How much to <b>${esc(pick.obj ? pick.obj.card.name : g.players[pick.player].name)}</b>?`, { buttons: [...amts.map(k => ({ label: `${k}${pick.obj && k === need ? ' (lethal)' : k === left ? ' (all)' : ''}`, value: k, primary: k === need })), { label: 'Back', value: 0 }] });
      if (typeof c.button !== 'number' || c.button <= 0) continue;
      if (have) have.n += c.button; else plan.push({ ...pick, n: c.button });
      left -= c.button;
    }
    return plan;
  }
  // Venture into the dungeon: which dungeon, then which room below
  async chooseDungeonAsync(g, p, names) {
    const r = await this.ui.ask('<b>Venture into the dungeon:</b> choose a dungeon', { buttons: names.map((n, i) => ({ label: n, value: n, primary: i === 0 })) });
    return names.includes(r.button) ? r.button : names[0];
  }
  async chooseRoomAsync(g, p, d, rooms) {
    const r = await this.ui.ask(`<b>${esc(d)}:</b> venture into which room?`, { buttons: rooms.map((n, i) => ({ label: `${n}: ${DUNGEONS[d].rooms[n].text}`, value: n, primary: i === 0 })) });
    return rooms.includes(r.button) ? r.button : rooms[0];
  }
  // Your commander went to your graveyard or exile: move it to the command zone? (903.9a)
  async commanderToCommandZoneAsync(g, p, o, zone) {
    const r = await this.ui.ask(`<b>${esc(o.card.name)}</b> went to your ${zone}. Move it to the command zone?`, { buttons: [{ label: 'Command zone', value: true, primary: true }, { label: `Leave it in the ${zone}`, value: false }] });
    return r.button !== false;
  }
  // Madness: cast the card you just discarded for its madness cost?
  async wantsMadnessAsync(g, p, o) {
    const r = await this.ui.ask(`<b>${esc(o.card.name)}</b> was discarded: cast it for its madness cost ${esc(o.fx.madness)}?`, { buttons: [{ label: `Cast it (${o.fx.madness})`, value: true, primary: true }, { label: 'No', value: false }] });
    return r.button === true;
  }
  // X for a spell you cast: up to what the mana allows
  async chooseSpellXAsync(g, p, o, max) {
    const vals = max <= 12 ? Array.from({ length: max }, (_, i) => i + 1) : [...new Set([1, 2, 3, 4, 5, 6, 8, 10, Math.floor(max / 2), max - 1, max])].filter(v => v >= 1 && v <= max).sort((a, b) => a - b);
    const ai = super.chooseSpellX(g, p, o, max);
    const r = await this.ui.ask(`<b>${esc(o.card.name)}</b>: choose X (you can pay up to ${max})`, { buttons: [...vals.map(v => ({ label: `X = ${v}`, value: v, primary: v === ai })), { label: 'X = 0', value: 0 }] });
    return typeof r.button === 'number' ? r.button : ai;
  }
  // {X} in an ability's cost: how much X to pay (up to what the mana allows)
  async chooseAbilityXAsync(g, p, o, ab, max) {
    if (max <= 0) return 0;
    const vals = max <= 12 ? Array.from({ length: max }, (_, i) => i + 1) : [...new Set([1, 2, 3, 4, 5, 6, 8, 10, Math.floor(max / 2), max - 1, max])].filter(v => v >= 1 && v <= max).sort((a, b) => a - b);
    const ai = super.chooseAbilityX(g, p, o, ab, max);
    const r = await this.ui.ask(`<b>${esc(o.card.name)}</b>: choose X for ${esc((ab.text || 'its ability').slice(0, 70))} (you can pay up to ${max})`, {
      buttons: [...vals.map(v => ({ label: `X = ${v}`, value: v, primary: v === ai })), { label: 'X = 0', value: 0 }],
    });
    return typeof r.button === 'number' ? r.button : ai;
  }

  // ---------- priority stops (engine.stopFor) and trigger order
  async stopAt(g, q, step, active) {
    const mine = q === active;
    // (opponents' end steps already have their window: endOfTurn)
    if (step === 'end' && !mine) return;
    const key = `${mine ? 'my' : 'opp'}${step[0].toUpperCase()}${step.slice(1)}`;
    if (!this.full && !this.stops[key]) return;
    const where = { upkeep: 'upkeep', draw: 'draw step', combat: 'beginning of combat', end: 'end step' }[step];
    for (let i = 0; i < 4 && !g.over; i++) {
      const r = await this.instantWindow(g, q, `<b>${mine ? 'Your' : `${esc(active.name)}'s`} ${where}.</b> You stopped here: cast an instant or use an ability, or pass.`, true, true);
      if (!r) return;
      await this.castWithChoices(g, q, r.card);
    }
  }
  async orderTriggersAsync(g, p, group) {
    if (!this.orderTriggersOn) return null;
    const left = [...group], out = [];
    const label = t => `${t.o?.card.name || 'Trigger'}: ${t.label || { etb: 'enters', attack: 'attack trigger', upkeep: 'upkeep trigger', endstep: 'end step trigger', dies: 'dies trigger', cast: 'cast trigger', saga: 'chapter' }[t.kind] || t.kind || 'ability'}`;
    while (left.length > 1) {
      const r = await this.ui.ask(`<b>${left.length} of your triggers are waiting.</b> Choose which resolves ${out.length ? 'next' : 'first'}.`, {
        buttons: [...left.map((t, i) => ({ label: label(t), value: i, primary: i === 0 })), { label: 'Order them for me', value: 'auto' }],
      });
      if (r.button === 'auto' || typeof r.button !== 'number') break;
      out.push(left.splice(r.button, 1)[0]);
    }
    return [...out, ...left];
  }

  // ---------- helpers
  // Sources you tapped by hand this step whose mana is still unspent: click one to take the tap back
  takeBacks(g, p) { return p.battlefield.filter(o => g.canUntapForMana(p, o)); }
  // Permanents you could tap for mana right now (lands, mana creatures and rocks, Cryptolith Rite creatures)
  manaSources(g, p) { return p.battlefield.filter(o => !o.tapped && g.manaUnitsOf(p, o).length); }
  poolNote(g, p) { const t = g.poolText(p); return t ? ` <b>Mana pool: ${esc(t)}</b> (spent first; it empties at the end of this step${this.takeBacks(g, p).length ? '; click a source you tapped to take its mana back' : ''}).` : ''; }
  candidates(g, p, e, src) {
    const all = g.players.flatMap(q => q.battlefield);
    switch (e.k) {
      case 'remove': return { objs: all.filter(o => this.matches(o, e.what) && g.canTarget(p, o)) };
      case 'bounce': case 'flickerDelay': return { objs: all.filter(o => this.matches(o, e.what) && !o.fx.type.land && g.canTarget(p, o)) };
      case 'steal': return { objs: all.filter(o => o.controller !== p.idx && this.matches(o, e.what) && g.canTarget(p, o)) };
      case 'pump': case 'protect': case 'counters': return { objs: all.filter(o => o.fx.type.creature && g.canTarget(p, o)) };
      case 'blink': return { objs: p.battlefield.filter(o => this.matches(o, e.what === 'creature' ? 'creature' : 'nonland permanent') && o !== src) };
      case 'loseLife': return { players: g.opponents(p).map(q => q.idx).concat(p.idx) };
      case 'fight': case 'shrink': case 'minus': case 'goad': return { objs: all.filter(o => o.fx.type.creature && o.controller !== p.idx && g.canTarget(p, o)) };
      case 'tap': return { objs: all.filter(o => this.matches(o, e.what) && g.canTarget(p, o)) };
      case 'regen': return { objs: p.battlefield.filter(o => o.fx.type.creature) };
      case 'damage': {
        const objs = /any|creature/.test(e.to) ? all.filter(o => (o.fx.type.creature || (/any/.test(e.to) && o.fx.type.planeswalker)) && g.canTarget(p, o)) : [];
        const players = /any|player|opponent/.test(e.to) ? g.alive().filter(q => !/opponent/.test(e.to) || q !== p).map(q => q.idx) : [];
        return { objs, players };
      }
      default: return {};
    }
  }
  async pickTarget(g, p, e, src) {
    const { objs = [], players = [] } = this.candidates(g, p, e, src);
    if (!objs.length && !players.length) return null;
    const r = await this.ui.ask(`<b>${esc(src.card.name)}</b>: choose a target (${esc(e.k === 'damage' ? `${e.n} damage` : e.k)})`, {
      objs, players, buttons: [{ label: 'Let the AI pick', value: 'ai' }, { label: 'Cancel', value: 'cancel' }],
    });
    if (r.button === 'cancel') return 'cancel';
    if (r.button === 'ai') return super.chooseTarget(g, p, e, src);
    return r.obj ? { obj: r.obj } : { player: r.player };
  }
  async pickModes(g, p, o) {
    const m = o.fx.modes;
    const chosen = [];
    const n = m.up && g.evalCond(p, o, m.up.cond, { kicked: o.kicked }) ? m.up.n : m.n;
    for (let k = 0; k < Math.min(n, m.modes.length); k++) {
      const left = m.modes.filter(x => !chosen.includes(x));
      const r = await this.ui.ask(`<b>${esc(o.card.name)}</b>: choose a mode${k ? ' (or stop here)' : ''}`, {
        buttons: [...left.map(x => ({ label: x.map(e => e.k).join(' + '), value: x })), ...(k ? [{ label: 'Done', value: 'done' }] : []), { label: 'Cancel', value: 'cancel' }],
      });
      if (r.button === 'cancel') return null;
      if (r.button === 'done') break;
      chosen.push(r.button);
    }
    return chosen.flat();
  }
  // Choose targets (and modes) for a card, then cast it. Returns false if you cancelled
  async castWithChoices(g, p, o, extra = {}) {
    let effects = o.fx.type.permanent ? [] : o.fx.spell;
    if (!o.fx.type.permanent && o.fx.modes) { effects = await this.pickModes(g, p, o); if (!effects) return false; }
    const targets = [];
    for (const e of effects) {
      if (e.k === 'counter' || e.k === 'counterAbility' || e.k === 'copySpell') { targets.push(extra.spellTarget ? { spell: extra.spellTarget } : null); continue; }
      if (!needsTarget(e)) { targets.push(null); continue; }
      const t = await this.pickTarget(g, p, e, o);
      if (t === 'cancel') return false;
      targets.push(t);
    }
    let auraTarget;
    if (o.fx.type.aura) {
      // (what it can enchant: "Enchant artifact" for Power Artifact, lands, any permanent, else creatures)
      const what = (o.card.text.match(/^enchant (\w+)/im) || [])[1]?.toLowerCase() || 'creature';
      const ok = x => (what === 'permanent' ? true : what === 'artifact' ? x.fx.type.artifact : what === 'land' ? x.fx.type.land : what === 'planeswalker' ? x.fx.type.planeswalker : x.fx.type.creature);
      const objs = g.players.flatMap(q => q.battlefield).filter(x => ok(x) && g.canTarget(p, x));
      const r = await this.ui.ask(`<b>${esc(o.card.name)}</b>: choose ${/^[aeiou]/.test(what) ? 'an' : 'a'} ${esc(what)} to enchant`, { objs, buttons: [{ label: 'Cancel', value: 'cancel' }] });
      if (!r.obj) return false;
      auraTarget = r.obj;
    }
    // Optional extra costs: kicker and buyback
    const opt = {};
    for (const [k, flag] of [['kicker', 'kick'], ['buyback', 'buyback']]) {
      if (!o.fx[k]) continue;
      const r = await this.ui.ask(`<b>${esc(o.card.name)}</b>: pay ${k} ${esc(o.fx[k])} as well (if you have the mana)?`, { buttons: [{ label: `Pay ${k}`, value: true, primary: true }, { label: 'No', value: false }] });
      opt[flag] = r.button === true;
    }
    // (spree modes are picked by what the mana pays for)
    const spree = !!o.fx.spree?.length;
    return g.cast(p, o, { targets: spree ? undefined : targets, effects: spree ? undefined : effects, auraTarget, response: extra.response, ...opt, mode: extra.mode });
  }

  // ---------- your turn
  // A loop you've just played twice in a row: the last k actions (abilities and mana taps) repeat the k before
  loopBlock() {
    const a = this.acts;
    const same = (x, y) => x.k === y.k && x.iid === y.iid && x.i === y.i;
    for (let k = 1; k <= 6 && a.length >= 2 * k; k++) {
      const last = a.slice(-k), prev = a.slice(-2 * k, -k);
      // (at least one ability: tapping lands alone isn't a loop)
      if (last.every((x, i) => same(x, prev[i])) && last.some(x => x.k === 'ab')) return last;
    }
    return null;
  }
  // The loop shortcut: play the block again up to n times, checking every step; it stops at the first
  // action that can't be done the same way
  async repeatLoop(g, p, block, n) {
    let done = 0, why = '';
    for (; done < n && !g.over && !p.lost; done++) {
      for (const x of block) {
        const o = g.objects.get(x.iid);
        if (!o || o.zone !== 'battlefield' || o.controller !== p.idx) { why = `${o?.card.name || 'a card'} isn't on your battlefield any more`; break; }
        if (x.k === 'mana') { if (o.tapped || !g.tapForMana(p, o)) { why = `${o.card.name} can't be tapped for mana`; break; } continue; }
        const ab = g.abilitiesOf(o)[x.i];
        if (!ab || !g.canActivate(p, o, ab)) { why = `${o.card.name}'s ability can't be paid for or used`; break; }
        await g.activate(p, o, ab);
      }
      if (why) break;
    }
    g.log(`${g.pn(p)} repeated the loop ${done} of ${n} times${why ? ` (stopped: ${esc(why)})` : ''}`, { kind: 'combo' });
    this.acts = [];
  }

  async mainPhase(g, p, phase) {
    this.acts = [];
    for (let guard = 0; guard < 200 && !g.over && !p.lost; guard++) {
      // (also the top of your library with Courser of Kruphix and friends, and cards exiled "you may play")
      const top = p.library[p.library.length - 1];
      const elsewhere = [...p.exile.filter(o => o.mayPlay?.p === p.idx && o.mayPlay.until >= g.turn), ...(top && g.topPlayable(p, top) ? [top] : [])];
      const lands = p.landsPlayed < g.landDrops(p) ?[...p.hand, ...elsewhere].filter(o => o.fx.type.land) : [];
      // Counterspells and copy effects need something on the stack, so they're offered in response windows instead
      const reactiveOnly = o => o.fx.spell.length && o.fx.spell.every(e => ['counter', 'counterAbility', 'copySpell'].includes(e.k));
      const spells = [...p.hand, ...p.command, ...elsewhere, ...p.graveyard].filter(o => !o.fx.type.land && g.canCast(p, o) && !reactiveOnly(o));
      const pws = p.battlefield.filter(o => o.fx.type.planeswalker && !o.usedPW && o.fx.pw.some(ab => o.loyalty + ab.cost >= 0));
      const equips = p.battlefield.filter(o => o.fx.equip && g.planPayment(p, g.equipCost(p, o), 0));
      const usable = (o, ab) => g.canActivate(p, o, ab);
      // (you may use an ability as often as you can pay for it; {T} abilities stop once it's tapped)
      const abilities = p.battlefield.filter(o => g.abilitiesOf(o).some(ab => usable(o, ab)));
      const outlets = p.battlefield.filter(o => o.fx.sacOutlet && !(o.fx.sacOutlet.tap && o.tapped));
      const cyclers = p.hand.filter(o => g.canCycle(p, o));
      const graveAbs = p.graveyard.filter(o => g.graveAbility(p, o) && !spells.includes(o));
      const vehicles = p.battlefield.filter(o => o.fx.crew && !o.crewed && p.battlefield.some(c => c !== o && c.fx.type.creature && !c.tapped));
      // Spirit Guides: exile from hand for mana (it stays in your pool until the phase ends)
      const guides = p.hand.filter(o => o.fx.handMana);
      const combos = this.readyCombos(g, p, phase).filter(r => r.payable);
      // Untapped mana sources: click one to tap it for mana yourself (it waits in your mana pool)
      const manaSrcs = this.manaSources(g, p);
      // (and sources you tapped by hand whose mana is unspent: click to take the tap back)
      const backs = this.takeBacks(g, p);
      const pingers = this.pingers(g, p);
      // Morph and disguise cards that can be cast face down, and face-down permanents that can be turned up
      const faceDowns = [...p.hand.filter(o => g.canCastFaceDown(p, o)), ...p.battlefield.filter(o => g.canTurnFaceUp(p, o))];
      const rooms = p.battlefield.filter(o => g.canUnlock(p, o));
      // Adventures and modal double-faced cards: the other face can be cast, or a land back played
      // (and bestow or mutate, other ways to cast a creature)
      const otherFaces = [...p.hand.filter(o => g.faceCastMode(p, o) || g.canPlayBackLand(p, o) || g.canBestow(p, o) || g.canMutate(p, o) || g.canCleave(p, o) || g.canFuse(p, o)), ...p.graveyard.filter(o => g.faceCastMode(p, o))];
      const objs = [...new Set([...lands, ...spells, ...pws, ...equips, ...abilities, ...outlets, ...cyclers, ...graveAbs, ...vehicles, ...guides, ...manaSrcs, ...backs, ...pingers, ...faceDowns, ...otherFaces, ...rooms])];
      const loop = this.loopBlock();
      const fromGy = spells.some(o => o.zone === 'graveyard') || graveAbs.length;
      // (how many plays are still open, so a pass is never by accident)
      const drops = g.landDrops(p) - p.landsPlayed;
      const playable = objs.filter(o => !manaSrcs.includes(o) || abilities.includes(o) || vehicles.includes(o)).length;
      const r = await this.ui.ask(`<b>Your ${phase === 'main1' ? 'first' : 'second'} main phase.</b> Click a highlighted card to play or use it, or a land or mana source to tap it for mana.${this.poolNote(g, p)}${drops > 1 && lands.length ? ` You have ${drops} land drops left.` : ''}${fromGy ? ' (Open your graveyard, or press G, to use the cards there.)' : ''}${top && g.topPlayable(p, top) ? ` Top of your library: ${g.cn(top)}.` : ''}`, {
        objs,
        buttons: [
          ...combos.map(c => ({ label: `Combo: ${c.combo.label}`, value: { combo: c.combo }, primary: true })),
          ...(canAnnounce(g, p) ? [{ label: announceLabel(p), value: 'announce' }] : []),
          ...(g.canCompanion(p) ? [{ label: `Companion: ${p.companion.card.name} to hand ({3})`, value: 'companion' }] : []),
          ...(loop ? [{ label: `Repeat this loop ×10`, value: { repeat: 10 } }, { label: `Repeat ×99`, value: { repeat: 99 } }] : []),
          { label: `${phase === 'main1' ? 'Go to combat' : 'End turn'}${playable ? ` (${playable} playable)` : ''}`, value: 'pass', primary: !combos.length },
          { label: 'Let the AI play this phase', value: 'ai' },
        ],
      });
      if (r.button === 'pass' || r.button === 'cancel') return;
      if (r.button === 'ai') return super.mainPhase(g, p, phase);
      if (r.button === 'announce') { await announceHuman(g, p, this.ui); continue; }
      if (r.button === 'companion') { g.useCompanion(p); continue; }
      if (r.button?.combo) { await g.goOff(p, r.button.combo); continue; }
      // (only the shortcut's own buttons: a text value has a .repeat function of its own)
      if (typeof r.button === 'object' && r.button?.repeat && loop) { await this.repeatLoop(g, p, loop, r.button.repeat); continue; }
      const o = r.obj;
      if (!o) continue;
      document.getElementById('zoneModal')?.setAttribute('hidden', '');
      // A source you tapped by hand: take its mana back, unless you meant its ability (Basalt Monolith's untap)
      if (backs.includes(o)) {
        const both = abilities.includes(o);
        const c = both ? (await this.ui.ask(`<b>${esc(o.card.name)}</b>: use its ability, or untap it and take its mana back?`, { buttons: [{ label: 'Use its ability', value: 'ab', primary: true }, { label: 'Take the mana back', value: 'back' }, { label: 'Cancel', value: 'cancel' }] })).button : 'back';
        if (c === 'back') { g.untapForMana(p, o); this.acts = []; continue; }
        if (c !== 'ab') continue;
      }
      // Walking Ballista: ping (or, with its {4} counter ability usable too, ask which)
      if (pingers.includes(o) && (!abilities.includes(o) || (await this.pingOrAbility(g, p, o)) === 'ping')) { await this.usePing(g, p, o); this.acts = []; continue; }
      if (manaSrcs.includes(o)) {
        // A mana creature or land with other abilities: ask which
        const other = abilities.includes(o) || vehicles.includes(o) || equips.includes(o) || outlets.includes(o);
        const c = other ? (await this.ui.ask(`<b>${esc(o.card.name)}</b>: tap it for mana, or use another ability?`, { buttons: [{ label: 'Tap for mana', value: 'mana', primary: true }, { label: 'Other ability', value: 'other' }, { label: 'Cancel', value: 'cancel' }] })).button : 'mana';
        if (c === 'mana') { if (g.tapForMana(p, o)) this.acts.push({ k: 'mana', iid: o.iid }); continue; }
        if (c !== 'other') continue;
      }
      if (guides.includes(o)) {
        const add = o.fx.handMana.map(c => `{${c}}`).join('');
        const c = spells.includes(o)
          ? (await this.ui.ask(`<b>${esc(o.card.name)}</b>: cast it, or exile it from your hand for ${add}?`, { buttons: [{ label: `Exile for ${add}`, value: 'exile', primary: true }, { label: 'Cast it', value: 'cast' }, { label: 'Cancel', value: 'cancel' }] })).button
          : 'exile';
        if (c === 'exile') g.exileForMana(p, o);
        else if (c === 'cast') await this.castWithChoices(g, p, o);
        continue;
      }
      if (rooms.includes(o) && !abilities.includes(o)) { await g.unlockRoom(p, o); this.acts = []; continue; }
      if (otherFaces.includes(o)) {
        const f = o.card.altFace;
        const opts = [
          ...(spells.includes(o) ? [{ label: `Cast ${o.card.name}`, value: 'front', primary: true }] : []),
          ...(f && g.faceCastMode(p, o) ? [{ label: `Cast ${f.name}${o.card.layout === 'adventure' ? ' (adventure)' : ''}`, value: 'face' }] : []),
          ...(f && g.canPlayBackLand(p, o) ? [{ label: `Play ${f.name} (land)`, value: 'land' }] : []),
          ...(g.canBestow(p, o) ? [{ label: `Bestow (${o.fx.bestow})`, value: 'bestow' }] : []),
          ...(g.canMutate(p, o) ? [{ label: `Mutate (${o.fx.mutate})`, value: 'mutate' }] : []),
          ...(faceDowns.includes(o) ? [{ label: 'Face down ({3})', value: 'down' }] : []),
          ...(g.canCleave(p, o) ? [{ label: 'Cleave (' + o.fx.cleave + ')', value: 'cleave' }] : []),
          ...(g.canFuse(p, o) ? [{ label: 'Fuse: cast both halves', value: 'fuse' }] : []),
        ];
        const c = opts.length === 1 ? opts[0].value : (await this.ui.ask(`<b>${esc(o.card.name)}${f ? ` // ${esc(f.name)}` : ''}</b>: how do you want to play it?`, { buttons: [...opts, { label: 'Cancel', value: 'cancel' }] })).button;
        if (c === 'cleave' || c === 'fuse') { await g.cast(p, o, { mode: { alt: c } }); this.acts = []; continue; }
        if (c === 'bestow') { await g.cast(p, o, { mode: { alt: 'bestow' } }); this.acts = []; continue; }
        if (c === 'mutate') {
          const t = await this.ui.ask(`<b>${esc(o.card.name)}</b>: mutate onto which creature? (on top: it takes this card's name and power/toughness)`, { objs: g.mutateTargets(p, o), buttons: [{ label: 'Cancel', value: 'cancel' }] });
          if (t.obj) await g.cast(p, o, { mode: { alt: 'mutate' }, mutateOnto: t.obj });
          this.acts = []; continue;
        }
        if (c === 'face') { await g.castFace(p, o); this.acts = []; continue; }
        if (c === 'land') { await g.playLand(p, o); continue; }
        if (c === 'down') { await g.cast(p, o, { mode: { alt: 'morph' } }); this.acts = []; continue; }
        if (c !== 'front') continue;
        await this.castWithChoices(g, p, o);
        continue;
      }
      if (faceDowns.includes(o)) {
        if (o.zone === 'battlefield') { await g.turnFaceUp(p, o); this.acts = []; continue; }
        const normal = (spells.includes(o) && g.castMode(p, o)?.alt !== 'morph') || lands.includes(o);
        const c = normal ? (await this.ui.ask(`<b>${esc(o.card.name)}</b>: ${lands.includes(o) ? 'play it' : 'cast it'}, or cast it face down as a 2/2 for {3}?`, { buttons: [{ label: lands.includes(o) ? 'Play it' : 'Cast it', value: 'normal', primary: true }, { label: 'Face down ({3})', value: 'down' }, { label: 'Cancel', value: 'cancel' }] })).button : 'down';
        if (c === 'down') { await g.cast(p, o, { mode: { alt: 'morph' } }); this.acts = []; continue; }
        if (c !== 'normal') continue;
      }
      if (lands.includes(o)) await g.playLand(p, o);
      else if (cyclers.includes(o) && (!spells.includes(o) || (await this.ui.ask(`<b>${esc(o.card.name)}</b>: cast it, or ${o.fx.cycling ? 'cycle' : 'channel'} it?`, { buttons: [{ label: 'Cast', value: 'cast', primary: true }, { label: o.fx.cycling ? `Cycle (${o.fx.cycling.cost})` : `Channel (${o.fx.channel.cost})`, value: 'cycle' }] })).button === 'cycle')) await g.cycle(p, o);
      else if (spells.includes(o)) await this.castWithChoices(g, p, o);
      else if (graveAbs.includes(o)) await g.useGraveAbility(p, o, g.graveAbility(p, o));
      else if (vehicles.includes(o) && !abilities.includes(o)) {
        const crew = [];
        for (;;) {
          const power = crew.reduce((s, c) => s + g.power(c), 0);
          if (power >= o.fx.crew) break;
          const c = await this.ui.ask(`<b>Crew ${esc(o.card.name)}</b> (crew ${o.fx.crew}): tap creatures with total power ${o.fx.crew} or more (${power} so far)`, { objs: p.battlefield.filter(x => x !== o && x.fx.type.creature && !x.tapped && !crew.includes(x)), buttons: [{ label: 'Cancel', value: 'cancel' }] });
          if (!c.obj) break;
          crew.push(c.obj);
        }
        if (crew.reduce((s, c) => s + g.power(c), 0) >= o.fx.crew) await g.crew(p, o, crew);
      } else if (o.fx.type.planeswalker) {
        const opts = o.fx.pw.filter(ab => o.loyalty + ab.cost >= 0);
        const c = await this.ui.ask(`<b>${esc(o.card.name)}</b>: choose a loyalty ability`, { buttons: [...opts.map(ab => ({ label: `${ab.cost > 0 ? '+' : ''}${ab.cost}: ${ab.text.slice(0, 50)}`, value: ab })), { label: 'Cancel', value: 'cancel' }] });
        if (c.button && c.button !== 'cancel') await g.activatePW(p, o, c.button);
      } else if (o.fx.equip && equips.includes(o)) {
        const c = await this.ui.ask(`<b>${esc(o.card.name)}</b>: equip which creature?`, { objs: p.battlefield.filter(x => x.fx.type.creature), buttons: [{ label: 'Cancel', value: 'cancel' }] });
        if (c.obj) await g.equip(p, o, c.obj);
      } else if (o.fx.sacOutlet && outlets.includes(o)) {
        const c = await this.ui.ask(`<b>${esc(o.card.name)}</b>: sacrifice which creature?`, { objs: p.battlefield.filter(x => x.fx.type.creature && (x !== o || !o.fx.sacOutlet.other)), buttons: [{ label: 'Cancel', value: 'cancel' }] });
        if (c.obj) await g.sacTo(p, o, c.obj);
      } else if (abilities.includes(o)) {
        const abs = g.abilitiesOf(o).filter(ab => usable(o, ab));
        let ab = abs[0];
        if (abs.length > 1 || o.fx.crew) {
          const c = await this.ui.ask(`<b>${esc(o.card.name)}</b>: which ability?`, { buttons: [...abs.map(a => ({ label: `${a.costs ? costText(a.costs) : `${a.cost}${a.tap ? '{T}' : ''}`}: ${a.text.slice(0, 50)}`, value: a })), ...(o.fx.crew ? [{ label: `Crew ${o.fx.crew}`, value: 'crew' }] : []), { label: 'Cancel', value: 'cancel' }] });
          ab = c.button === 'cancel' ? null : c.button;
          if (ab === 'crew') {
            const crew = [];
            while (crew.reduce((s, x) => s + g.power(x), 0) < o.fx.crew) {
              const x = await this.ui.ask(`<b>Crew ${esc(o.card.name)}</b>: choose creatures to tap`, { objs: p.battlefield.filter(y => y !== o && y.fx.type.creature && !y.tapped && !crew.includes(y)), buttons: [{ label: 'Cancel', value: 'cancel' }] });
              if (!x.obj) break;
              crew.push(x.obj);
            }
            await g.crew(p, o, crew);
            ab = null;
          }
        }
        if (ab) {
          await g.activate(p, o, ab);
          this.acts.push({ k: 'ab', iid: o.iid, i: g.abilitiesOf(o).indexOf(ab) });
          if (this.acts.length > 24) this.acts.shift();
          continue;
        }
      }
      // (anything else breaks a loop in progress)
      this.acts = [];
    }
  }

  async declareAttackers(g, p) {
    const ready = p.battlefield.filter(o => g.canAttack(o) && g.power(o) > 0);
    if (!ready.length) return [];
    const chosen = new Set();
    for (;;) {
      const opps = g.opponents(p);
      // (and the battles and planeswalkers they can attack)
      const perms = g.alive().flatMap(q => q.battlefield.filter(o => g.attackable(p, o)));
      const r = await this.ui.ask(`<b>Declare attackers.</b> Click creatures to add or remove them (${chosen.size} selected), then choose who to attack.`, {
        objs: ready,
        buttons: [...(chosen.size ? opps.map(q => ({ label: `Attack ${q.name}${g.dealBetween(p.idx, q.idx) ? ' (breaks truce)' : ''}`, value: q.idx, primary: true })) : []),
          ...(chosen.size ? perms.map(o => ({ label: `Attack ${o.card.name} (${o.fx.type.battle ? `${o.defense} defense` : `${o.loyalty} loyalty`})`, value: { attackObj: o.iid } })) : []),
          { label: 'Select all', value: 'all' }, { label: 'No attack', value: 'none' }],
      });
      for (const o of ready) this.ui.view?.cards.get(o.iid)?.classList.remove('chosen');
      if (r.obj) { chosen.has(r.obj) ? chosen.delete(r.obj) : chosen.add(r.obj); }
      else if (r.button === 'all') ready.forEach(o => chosen.add(o));
      else if (r.button === 'none' || r.button === 'cancel') return [];
      else if (typeof r.button === 'number') return [...chosen].map(o => ({ o, target: r.button }));
      else if (r.button?.attackObj) {
        const t = g.objects.get(r.button.attackObj);
        if (t) return [...chosen].map(o => ({ o, target: t.fx.type.battle ? t.protector : t.controller, obj: t }));
      }
      for (const o of chosen) this.ui.view?.cards.get(o.iid)?.classList.add('chosen');
    }
  }

  async declareBlockers(g, q, attackers) {
    const blocks = [];
    for (;;) {
      const free = q.battlefield.filter(o => o.fx.type.creature && !o.tapped && !blocks.some(b => b.b === o) && attackers.some(a => g.canBlock(o, a)));
      const incoming = attackers.reduce((s, a) => s + g.power(a), 0);
      const r = await this.ui.ask(`<b>You're being attacked</b> by ${attackers.map(a => esc(a.card.name)).join(', ')} (${incoming} power). Click one of your creatures to block with it.`, {
        objs: free, buttons: [{ label: blocks.length ? 'Done blocking' : 'No blocks', value: 'done', primary: true }, { label: 'Let the AI block', value: 'ai' }],
      });
      if (r.button === 'ai') return super.declareBlockers(g, q, attackers);
      if (!r.obj) return blocks;
      const b = r.obj;
      const which = await this.ui.ask(`Block which attacker with <b>${esc(b.card.name)}</b>?`, { objs: attackers.filter(a => g.canBlock(b, a)), buttons: [{ label: 'Cancel', value: 'cancel' }] });
      if (which.obj) blocks.push({ b, a: which.obj });
    }
  }

  // ---------- instant-speed windows: only ask when you actually have something to cast
  instants(g, p, filter = () => true) {
    return p.hand.filter(o => !o.fx.type.land && instantSpeed(o) && g.canCast(p, o) && filter(o));
  }
  async respond(g, q, item) {
    if (item.p === q) return null;
    const fits = o => !o.fx.spell.some(e => e.k === 'counter') || (!item.ability && this.fits(o, item.o));
    const what = item.ability ? `${esc(item.o.card.name)}'s ability` : esc(item.o.card.name);
    for (let k = 0; k < 30; k++) {
      const options = this.instants(g, q, o => fits(o) && (!o.fx.spell.some(e => e.k === 'counterAbility') || item.ability));
      // (Full control: asked even with nothing to cast)
      // (Walking Ballista: ping in response, before removal lands on it)
      const pingers = this.pingers(g, q);
      const wizard = g.kingdoms && q.role?.id === 'wizard' && !q.role.up && !item.ability && k === 0;
      if (!options.length && !pingers.length && !wizard && !(this.full && k === 0)) return null;
      // (lands and mana sources can be tapped first, to choose what pays; a tap can be taken back)
      const mana = this.manaSources(g, q);
      const backs = this.takeBacks(g, q);
      const r = await this.ui.ask(`<b>${esc(item.p.name)}</b> ${item.ability ? 'uses' : 'casts'} <b>${what}</b>. ${options.length ? 'Respond?' : pingers.length ? `Ping with ${esc(pingers[0].card.name)} in response?` : 'You have nothing to respond with.'}${this.poolNote(g, q)}`, {
        objs: [...options, ...pingers, ...mana, ...backs], buttons: [{ label: 'Pass', value: 'pass', primary: true }, ...(g.kingdoms && q.role?.id === 'wizard' && !q.role.up && !item.ability ? [{ label: 'Announce: The Wizard (exile this spell)', value: 'wizard' }] : [])],
      });
      if (r.button === 'wizard') return { announce: true };
      if (!r.obj) return null;
      if (backs.includes(r.obj)) { g.untapForMana(q, r.obj); continue; }
      if (pingers.includes(r.obj) && !options.includes(r.obj)) { await this.usePing(g, q, r.obj); continue; }
      if (!options.includes(r.obj)) { g.tapForMana(q, r.obj); continue; }
      return { kind: 'human', card: r.obj, item };
    }
    return null;
  }
  async combatResponse(g, q, attackers) { return this.instantWindow(g, q, `<b>Attackers declared</b> against you: ${attackers.map(a => esc(a.card.name)).join(', ')}. Cast an instant?`, true, this.full); }
  async combatTrick(g, q) { return this.instantWindow(g, q, '<b>Blockers are declared.</b> Cast a combat trick?', false, this.full); }
  async respondToLoop(g, q, p) { return this.instantWindow(g, q, `<b>${esc(p.name)}</b> is looping a combo. Respond?`, false, this.full); }
  async endOfTurn(g, q, active) {
    for (let i = 0; i < 4; i++) {
      const r = await this.instantWindow(g, q, `<b>End of ${esc(active.name)}'s turn.</b> Use your open mana?`, true, i === 0 && (this.full || !!this.stops.oppEnd));
      if (!r) return;
      await this.castWithChoices(g, q, r.card);
    }
  }
  // Activated abilities you could use at instant speed right now (Grim Monolith's untap, a Clue, a pinger)
  instantAbilities(g, q) { return q.battlefield.filter(o => g.abilitiesOf(o).some(ab => !ab.sorcery && g.canActivate(q, o, ab))); }
  async useAbility(g, q, o) {
    const abs = g.abilitiesOf(o).filter(ab => !ab.sorcery && g.canActivate(q, o, ab));
    let ab = abs[0];
    if (abs.length > 1) {
      const c = await this.ui.ask(`<b>${esc(o.card.name)}</b>: which ability?`, { buttons: [...abs.map(a => ({ label: `${a.costs ? costText(a.costs) : `${a.cost}${a.tap ? '{T}' : ''}`}: ${a.text.slice(0, 50)}`, value: a })), { label: 'Cancel', value: 'cancel' }] });
      ab = c.button === 'cancel' ? null : c.button;
    }
    if (ab) await g.activate(q, o, ab);
  }
  // always: ask even with nothing to cast (a stop you set, or Full control), for the first question
  async instantWindow(g, q, text, withAbilities = false, always = false) {
    let r = null;
    for (let k = 0; k < 30 && !g.over; k++) {
      const options = this.instants(g, q, o => !o.fx.spell.some(e => e.k === 'counter' || e.k === 'counterAbility' || e.k === 'copySpell'));
      const abil = withAbilities ? this.instantAbilities(g, q).filter(o => !options.includes(o)) : [];
      // (Walking Ballista can ping at instant speed in every window)
      const pingers = this.pingers(g, q).filter(o => !options.includes(o));
      // (turning a face-down permanent up is a special action: any time you have priority)
      const faceUps = q.battlefield.filter(o => g.canTurnFaceUp(q, o));
      if (!options.length && !abil.length && !pingers.length && !faceUps.length && !(always && k === 0)) return null;
      const mana = this.manaSources(g, q).filter(o => !abil.includes(o));
      const backs = this.takeBacks(g, q);
      r = await this.ui.ask(`${text}${abil.length ? ' (or use an ability)' : ''}${faceUps.length ? ' (or turn a face-down creature face up)' : ''}${pingers.length ? ` (or remove a counter from ${esc(pingers[0].card.name)} to ping)` : ''}${!options.length && !abil.length && !pingers.length && !faceUps.length ? ' (You have nothing to play right now.)' : ''}${this.poolNote(g, q)}`, { objs: [...options, ...abil, ...pingers, ...faceUps, ...mana, ...backs], buttons: [{ label: 'Pass', value: 'pass', primary: true }] });
      if (!r.obj) return null;
      if (faceUps.includes(r.obj)) { await g.turnFaceUp(q, r.obj); r = null; continue; }
      if (backs.includes(r.obj)) {
        const both = abil.includes(r.obj);
        const c = both ? (await this.ui.ask(`<b>${esc(r.obj.card.name)}</b>: use its ability, or untap it and take its mana back?`, { buttons: [{ label: 'Use its ability', value: 'ab', primary: true }, { label: 'Take the mana back', value: 'back' }] })).button : 'back';
        if (c === 'back') { g.untapForMana(q, r.obj); r = null; continue; }
      }
      if (pingers.includes(r.obj) && (!abil.includes(r.obj) || (await this.pingOrAbility(g, q, r.obj)) === 'ping')) { await this.usePing(g, q, r.obj); r = null; continue; }
      if (options.includes(r.obj)) break;
      if (abil.includes(r.obj)) {
        // (a mana rock with another ability: ask which)
        const both = g.manaUnitsOf(q, r.obj).length && !r.obj.tapped;
        const c = both ? (await this.ui.ask(`<b>${esc(r.obj.card.name)}</b>: tap it for mana, or use its ability?`, { buttons: [{ label: 'Use ability', value: 'ab', primary: true }, { label: 'Tap for mana', value: 'mana' }, { label: 'Cancel', value: 'cancel' }] })).button : 'ab';
        if (c === 'ab') await this.useAbility(g, q, r.obj);
        else if (c === 'mana') g.tapForMana(q, r.obj);
      } else g.tapForMana(q, r.obj);
      r = null;
    }
    if (!r?.obj) return null;
    // Targets are chosen here so the engine can cast it straight away
    const effects = r.obj.fx.spell;
    const targets = [];
    for (const e of effects) { const t = needsTarget(e) ? await this.pickTarget(g, q, e, r.obj) : null; if (t === 'cancel') return null; targets.push(t); }
    return { card: r.obj, targets, human: true };
  }

  // ---------- targets for abilities (planeswalkers, triggers), discards, mulligan bottoms
  async chooseTargetAsync(g, p, e, src) {
    const t = await this.pickTarget(g, p, e, src);
    return t === 'cancel' || !t ? super.chooseTarget(g, p, e, src) : t;
  }
  async pickFromHand(g, p, n, text) {
    const chosen = [];
    while (chosen.length < n) {
      const r = await this.ui.ask(`${text} (${chosen.length} of ${n} chosen)`, {
        objs: p.hand.filter(o => !chosen.includes(o)), buttons: [{ label: 'Let the AI choose', value: 'ai' }],
      });
      if (!r.obj) return null;
      chosen.push(r.obj);
    }
    return chosen;
  }
  async chooseDiscard(g, p, n) {
    if (n <= 0) return [];
    return (await this.pickFromHand(g, p, n, `<b>Discard ${n} card${n === 1 ? '' : 's'}.</b> Click cards in your hand`)) || super.chooseDiscard(g, p, n);
  }
  async bottomCards(g, p, n) {
    if (n <= 0) return [];
    return (await this.pickFromHand(g, p, n, `<b>Mulligan:</b> choose ${n} card${n === 1 ? '' : 's'} to put on the bottom of your library`)) || super.bottomCards(g, p, n);
  }

  // ---------- other decisions
  async keepHand(g, p) {
    const r = await this.ui.ask(`<b>Opening hand</b> (${p.hand.length} cards, ${p.hand.filter(o => o.fx.type.land).length} lands${p.mulligans ? `, mulligan ${p.mulligans}` : ''}). Keep it?`, {
      buttons: [{ label: 'Keep', value: true, primary: true }, { label: 'Mulligan', value: false }],
    });
    return r.button !== false;
  }
  // Scry / surveil: decide each card, top card first
  async chooseScryAsync(g, p, cards, kind) {
    const keep = [], away = [];
    for (let i = 0; i < cards.length; i++) {
      const o = cards[i];
      const r = await this.ui.ask(`<b>${kind === 'scry' ? 'Scry' : 'Surveil'} ${cards.length}</b> (card ${i + 1}): ${g.cn(o)}${o.card.manaCost ? ` ${esc(o.card.manaCost)}` : ''} · ${esc(o.card.typeLine || '')}`, {
        buttons: [{ label: 'Keep on top', value: 'keep', primary: true }, { label: kind === 'scry' ? 'Bottom' : 'Graveyard', value: 'away' }, { label: 'Let the AI decide', value: 'ai' }],
      });
      if (r.button === 'ai') { const rest = super.chooseScry(g, p, cards.slice(i), kind); return { keep: [...keep, ...rest.keep], away: [...away, ...rest.away] }; }
      (r.button === 'away' ? away : keep).push(o);
    }
    return { keep, away };
  }
  // Picking cards from a library, graveyard or the top cards (dig, regrow, reanimate)
  async chooseCardsAsync(g, p, cards, n, text) {
    const chosen = [];
    while (chosen.length < Math.min(n, cards.length)) {
      const left = cards.filter(o => !chosen.includes(o)).sort((a, b) => a.card.name.localeCompare(b.card.name));
      // Identical cards (25 Forests) share one button with a count
      const label = o => `${o.card.name}${o.zone === 'graveyard' && o.owner !== p.idx ? ` (${g.players[o.owner].name})` : ''}`;
      const groups = new Map();
      for (const o of left) { const k = label(o); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(o); }
      const r = await this.ui.ask(`${text}${n > 1 && n < 99 ? ` (${chosen.length} of up to ${n})` : ''}`, {
        buttons: [...[...groups].map(([k, os]) => ({ label: os.length > 1 ? `${k} ×${os.length}` : k, value: os[0], iid: os[0].iid })),
          ...(chosen.length ? [{ label: 'Done', value: 'done', primary: true, keep: true }] : []), { label: 'Let the AI choose', value: 'ai', keep: true }],
      });
      if (r.button === 'ai') return chosen.length ? chosen : null;
      if (r.button === 'done' || r.button === 'cancel') break;
      chosen.push(r.button);
    }
    return chosen;
  }
  // Paying a cost: you choose what to sacrifice, tap or discard (a cost has to be paid in full)
  async chooseCostAsync(g, p, cards, n, text) {
    if (cards.length <= n) return cards;
    const chosen = [];
    while (chosen.length < n) {
      const left = cards.filter(o => !chosen.includes(o));
      const onBf = left.every(o => o.zone === 'battlefield');
      const r = await this.ui.ask(`<b>${text}</b>${n > 1 ? ` (${chosen.length} of ${n})` : ''}${onBf ? ': click a highlighted card' : ''}`, onBf
        ? { objs: left, buttons: [{ label: 'Let the AI choose', value: 'ai' }] }
        : { buttons: [...left.map(o => ({ label: o.card.name, value: o, iid: o.iid })), { label: 'Let the AI choose', value: 'ai', keep: true }] });
      const pick = r.obj || (r.button && r.button !== 'ai' ? r.button : null);
      if (!pick) break;
      chosen.push(pick);
    }
    if (chosen.length < n) chosen.push(...[...cards].filter(o => !chosen.includes(o)).sort((a, b) => this.value(g, a) - this.value(g, b)).slice(0, n - chosen.length));
    return chosen;
  }
  // Library searches (tutors): you choose from every card the search can find
  async pickTutorAsync(g, p, e) {
    const okType = o => !e.types?.length || e.types.some(t => o.fx.type[t]);
    const lib = p.library.filter(okType);
    if (!lib.length) return null;
    const r = await this.chooseCardsAsync(g, p, lib, 1, `<b>Search your library</b>${e.types?.length ? ` for a ${e.types.join(' or ')} card` : ''}${e.gy ? ' (it goes to your graveyard)' : e.bf ? ' (onto the battlefield)' : e.top ? ' (it goes on top)' : ''}`);
    return r?.[0] || super.pickTutor(g, p, e);
  }
  async considerDeal(g, q, from, kind = 'truce', rounds = 2) {
    const tmp = document.createElement('div');
    tmp.innerHTML = g.dealText(kind, from, q, kind === 'gangUp' ? g.players[g.archenemy] : null, rounds);
    const r = await this.ui.ask(`<b>${esc(from.name)}</b> offers you a deal: ${esc(tmp.textContent)}.`, {
      buttons: [{ label: 'Accept', value: true, primary: true }, { label: 'Decline', value: false }],
    });
    return r.button === true;
  }
  proposeDeal() { return null; }
  // Rhystic Study and friends: you choose whether to pay
  async payTaxAsync(g, p, src, t) {
    const owner = g.players[src.controller];
    const what = (t.effects || []).map(e => (e.k === 'draw' ? 'draws a card' : e.k === 'treasure' ? 'makes a Treasure' : 'gets its effect')).join(', ') || 'gets its effect';
    const r = await this.ui.ask(`<b>${esc(src.card.name)}</b> (${esc(owner?.name || '')}): pay {${t.tax}}, or ${esc(owner?.name || 'its controller')} ${what}?`, {
      buttons: [{ label: `Pay {${t.tax}}`, value: 'pay', primary: true }, { label: "Don't pay", value: 'no' }, { label: 'Let the AI decide', value: 'ai' }],
    });
    return r.button === 'ai' ? super.payTax(g, p, src, t) : r.button === 'pay';
  }
}
