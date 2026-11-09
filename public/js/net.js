import { roleChip } from './kingdomsPlay.js';
// Online seats: friends on your network play a seat from their own browser.
// The game itself runs here, in the host's window. For each friend's seat this module posts their view
// of the table and any question waiting for them to the local server, and polls for their answer.
import { unproxy } from './util.js';

const post = (url, body) => fetch(url, { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) });
const plain = html => { const d = document.createElement('div'); d.innerHTML = html; return d.textContent; };

export class Room {
  constructor() { this.code = null; this.keys = {}; this.port = 0; this.ips = []; this.seats = []; }
  // A seat's join code: its own secret key, then the seat number (spectators: 0), like "K7Q2XF9ABM-2".
  // Each seat has its own key, so changing the seat number in a link doesn't open another player's hand.
  joinCode(seat) { return `${this.keys[seat] || ''}-${seat + 1}`; }
  // Opens the room for the given seat numbers; returns false if this isn't running in Commander Table.exe
  async open(seats) {
    this.seats = seats;
    try {
      const r = await post('/api/room/open', seats.join(','));
      if (!r.ok) throw new Error((await r.json()).error || r.status);
      Object.assign(this, await r.json());
      return true;
    } catch (e) {
      this.error = e.message;
      return false;
    }
  }
  close() { this.code = null; return post('/api/room/close', '').catch(() => {}); }
  // Join links: one per network address, plus the internet address once the tunnel is up
  // (seat -1 is the spectators' link)
  links() {
    return this.seats.map(s => ({
      seat: s,
      urls: this.ips.map(ip => `http://${ip}:${this.port}/play.html?code=${this.keys[s]}&seat=${s}`),
      internet: this.tunnelUrl ? `${this.tunnelUrl}/play.html?code=${this.keys[s]}&seat=${s}` : null,
    }));
  }
  // Friends' chat messages newer than the last one fetched
  async chat() {
    try {
      const list = await (await fetch(`/api/room/chat?seat=${this.chatSeen || 0}`)).json();
      if (list.length) this.chatSeen = list[list.length - 1].id;
      return list;
    } catch { return []; }
  }
  // Starts the free Cloudflare tunnel and waits for its public address (status: downloading → starting → on)
  async tunnel(onStatus) {
    let t = await (await post('/api/room/tunnel', '')).json();
    for (let i = 0; i < 400 && t.status !== 'on' && t.status !== 'error'; i++) {
      onStatus?.(t.status);
      await new Promise(r => setTimeout(r, 1000));
      t = await (await fetch('/api/room/tunnel')).json();
    }
    if (t.status !== 'on') throw new Error(t.error || 'The tunnel did not start');
    this.tunnelUrl = t.url;
    return t.url;
  }
  async status() { try { return await (await fetch('/api/room/status')).json(); } catch { return {}; } }
  // Answer a friend's request to take back their last decision
  undoAck(seat, allowed) { return post(`/api/room/undoack?seat=${seat}`, allowed ? 'yes' : 'no').catch(() => {}); }
  // Seconds since a friend's page last checked in (-1: never joined)
  seen(seat) { return this.presence?.[seat]?.seen ?? -1; }
  state(seat, snap) { return post(`/api/room/state?seat=${seat}`, snap).catch(() => {}); }
  ask(seat, q) { return post(`/api/room/ask?seat=${seat}`, q).catch(() => {}); }
  async answer(seat) { try { return await (await fetch(`/api/room/answer?seat=${seat}`)).json(); } catch { return null; } }
}

// Stands in for the action bar (HumanUI) for a seat played by a friend. If they don't answer in time,
// or have disconnected, the AI's pick is used ("Let the AI…" when offered, otherwise the main button).
// Every answer is recorded (like HumanUI's) so the game can be rewound, and saved replays play it back.
// The turn clock: a time bank per friend's seat instead of a fixed time per decision. Each of their
// turns adds `add` seconds, up to `cap`; when it runs dry the AI decides for them until their next turn.
export const TURN_CLOCKS = {
  off: { label: 'Off (a fixed time for each decision)' },
  relaxed: { label: 'Relaxed (3 minutes a turn, up to 15)', add: 180, cap: 900 },
  tournament: { label: 'Tournament (2 minutes a turn, up to 10)', add: 120, cap: 600 },
};
export class RemoteUI {
  constructor(room, seat, timeoutSec = 120, clockMode = 'off') {
    this.room = room; this.seat = seat; this.timeout = timeoutSec; this.n = 0; this.view = null; this.waiting = false; this.offline = false; this.record = []; this.pos = 0;
    this.clockMode = TURN_CLOCKS[clockMode]?.add ? clockMode : 'off';
    // (the bank starts with one turn's worth)
    this.bank = this.clockMode === 'off' ? null : TURN_CLOCKS[this.clockMode].add;
    this.nudges = 0;
  }
  // A new turn of theirs: top the bank up
  refill() {
    const c = TURN_CLOCKS[this.clockMode];
    if (!c?.add) return;
    this.bank = Math.min(c.cap, this.bank + c.add);
    this.outOfTime = false;
  }
  // Seconds left right now (counting down while they decide)
  bankLeft() { return this.bank == null ? null : Math.max(0, this.bank - (this.askedAt ? (Date.now() - this.askedAt) / 1000 : 0)); }
  // The host reminds them: their page flashes and beeps
  nudge() { this.nudges++; this.game?.emit('update'); }
  // replayOnly: a loaded replay with no friend connected; once the recorded answers run out, the AI plays the seat
  setRecord(record, replayOnly = false) { this.record = record; this.pos = 0; if (replayOnly) { this.offline = this.replayOnly = true; } }
  get replaying() { return this.pos < this.record.length; }
  // Called by the host every couple of seconds: a friend whose page stopped checking in has left;
  // the AI answers for them until they open the same link again
  presence() {
    if (this.replayOnly) return;
    const s = this.room.seen(this.seat);
    const off = s < 0 ? this.offline : s > 12;
    if (off === this.offline) return;
    this.offline = off;
    const name = this.game?.players[this.seat]?.name || `Seat ${this.seat + 1}`;
    this.game?.log(off ? `${name} has disconnected; the AI plays for them until they rejoin with the same link` : `${name} is back`, { kind: 'minor' });
    this.game?.emit('update');
  }
  attach(game) { this.game = game; this.cancelled = false; }
  cancel() { this.cancelled = true; }
  key() { return false; }
  async ask(text, { buttons = [], objs = [], players = [] } = {}) {
    const objMap = new Map(objs.map(o => [o.iid, o]));
    if (this.replaying) {
      const a = this.record[this.pos++];
      return a.o != null ? { obj: objMap.get(a.o) || this.game.objects.get(a.o) } : a.pl != null ? { player: a.pl } : { button: buttons[a.b]?.value ?? 'cancel' };
    }
    this.record.length = this.pos;
    const v = await this.askLive(text, { buttons, objs, players });
    if (this.cancelled) return v;
    this.record.push(v.obj ? { o: v.obj.iid } : v.player != null ? { pl: v.player } : { b: buttons.findIndex(b => b.value === v.button) });
    this.pos++;
    this.onRecord?.(this.seat, this.record.length - 1);
    return v;
  }
  async askLive(text, { buttons = [], objs = [], players = [] } = {}) {
    // After an undo the rebuilt game runs fast up to the first live question, then plays normally
    const clock = this.game?.clock;
    if (clock?.untilLive) { clock.untilLive = false; clock.setPaused?.(false); }
    if (this.offline) return this.aiPick(buttons);
    // Turn clock: the decision may take whatever is left in the bank; an empty bank means the AI decides
    const banked = this.bank != null;
    if (banked && this.bank <= 0) {
      if (!this.outOfTime) { this.outOfTime = true; this.game?.log(`${this.game.players[this.seat].name} is out of time: the AI decides for them until their next turn`, { kind: 'minor' }); }
      return this.aiPick(buttons);
    }
    const limit = banked ? this.bank : this.timeout;
    const id = `${this.seat}-${++this.n}-${Date.now()}`;
    const q = { id, text, buttons: buttons.map(b => ({ label: b.label, primary: !!b.primary })), objs: objs.map(o => o.iid), players, timeout: Math.ceil(limit), bank: banked };
    this.waiting = true;
    this.askedAt = Date.now();
    this.game?.emit('update');
    await this.room.ask(this.seat, q);
    const t0 = Date.now();
    let ans = null;
    while (!this.cancelled && !this.offline && Date.now() - t0 < limit * 1000) {
      await new Promise(r => setTimeout(r, 350));
      const a = await this.room.answer(this.seat);
      if (a && a.id === id) { ans = a; break; }
    }
    if (banked) this.bank = Math.max(0, this.bank - (Date.now() - t0) / 1000);
    this.askedAt = 0;
    this.waiting = false;
    // The game was replaced (rewind, undo): leave the seat's question alone, the new game owns it now
    if (this.cancelled) return new Promise(() => {});
    await this.room.ask(this.seat, null);
    if (!ans) {
      // Timed out or disconnected: let the AI decide
      if (!this.offline) this.game?.log(banked ? `${this.game.players[this.seat].name}'s time bank ran out: the AI decides for them until their next turn` : `${this.game.players[this.seat].name} took too long, so the AI decides for them`, { kind: 'minor' });
      if (banked) this.outOfTime = true;
      return this.aiPick(buttons);
    }
    if (ans.obj != null) {
      const o = objs.find(x => x.iid === ans.obj) || this.game.objects.get(ans.obj);
      return o ? { obj: o } : { button: 'cancel' };
    }
    if (ans.player != null) return { player: ans.player };
    return { button: buttons[ans.button]?.value ?? 'cancel' };
  }
  // Best of three (item 135): the friend sideboards between games. Sends their deck and sideboard, waits for the lists
  // back (the same cards in total, at least the minimum deck size), and returns them; null keeps the deck as it was.
  async askSideboard(deck, minMain) {
    if (this.offline || this.cancelled) return null;
    const list = cards => cards.map(c => [c.card.name, c.qty]);
    const id = `${this.seat}-sb-${++this.n}-${Date.now()}`;
    const q = { id, text: '<b>Sideboard</b> for the next game: click a card to move one copy across.', buttons: [{ label: 'Play these', primary: true }, { label: 'Keep my deck', primary: false }], objs: [], players: [], timeout: 180, sideboard: { main: list(deck.cards), side: list(deck.sideboard || []), min: minMain } };
    await this.room.ask(this.seat, q);
    const t0 = Date.now();
    let ans = null;
    while (!this.cancelled && !this.offline && Date.now() - t0 < 180000) {
      await new Promise(r => setTimeout(r, 400));
      const a = await this.room.answer(this.seat);
      if (a && a.id === id) { ans = a; break; }
    }
    await this.room.ask(this.seat, null);
    if (!ans || ans.button !== 0 || !ans.sideboard) return null;
    // (only the same cards, moved between the two lists)
    const pool = new Map();
    for (const c of [...deck.cards, ...(deck.sideboard || [])]) { const p = pool.get(c.card.name) || { card: c.card, n: 0 }; p.n += c.qty; pool.set(c.card.name, p); }
    const take = (rows) => { const out = []; for (const [name, qty] of Array.isArray(rows) ? rows : []) { const p = pool.get(name); const k = Math.min(+qty || 0, p ? p.n : 0); if (!p || k <= 0) continue; p.n -= k; out.push({ card: p.card, qty: k }); } return out; };
    const main = take(ans.sideboard.main), side = take(ans.sideboard.side);
    if ([...pool.values()].some(p => p.n !== 0) || main.reduce((a, c) => a + c.qty, 0) < minMain) return null;
    return { ...deck, cards: main, sideboard: side };
  }
  aiPick(buttons) {
    const ai = buttons.findIndex(b => /AI/.test(b.label));
    const main = buttons.findIndex(b => b.primary);
    const pick = buttons[ai >= 0 ? ai : main >= 0 ? main : 0];
    return { button: pick ? pick.value : 'pass' };
  }
}

// One seat's view of the table: everything public, plus that player's own hand
export function snapshot(g, seat) {
  // (friends load images from Scryfall themselves: the host's image cache isn't reachable from their side)
  const card = (o, extra = {}) => ({
    iid: o.iid, name: o.card.name, img: unproxy(o.card.imgNormal || o.card.imgSmall || ''), art: unproxy(o.card.art || ''), text: o.card.fullText || o.card.text || '',
    type: o.card.typeLine, cost: o.card.manaCost || '', ...extra,
  });
  const perm = o => card(o, {
    tapped: o.tapped, attacking: o.attacking != null, blocking: o.blocking != null, sick: o.sick && o.fx.type.creature, token: o.token,
    commander: o.isCommander, counters: o.counters, loyalty: o.fx.type.planeswalker ? o.loyalty : null,
    pt: o.fx.type.creature ? `${g.power(o)}/${g.toughness(o)}` : null, damage: o.damage,
    zone: o.fx.type.creature ? 'creatures' : o.fx.type.land ? 'lands' : 'others',
    // (a face-down permanent's controller knows what it is; nobody else does)
    ...(o.faceDown ? { faceDown: true, ...(o.controller === seat ? { peek: o.faceCard.name } : {}) } : {}),
  });
  return {
    seat, turn: g.turn, round: g.round, phase: g.phase, active: g.active, over: g.over, winner: g.winner?.idx ?? null, winners: (g.winners || []).map(w => w.idx), archenemy: g.archenemy,
    players: g.players.map(p => ({
      idx: p.idx, name: p.name, color: p.color, deckName: p.deckName, life: p.life, lost: p.lost, lossReason: p.lossReason,
      art: unproxy(p.command[0]?.card.art || p.art || ''),
      hand: p.idx === seat ? p.hand.map(o => card(o)) : p.hand.length,
      library: p.library.length, graveyard: p.graveyard.length, exile: p.exile.length,
      command: p.command.map(o => card(o, { tax: 2 * (p.castCount[o.iid] || 0) })),
      battlefield: p.battlefield.map(perm),
      mana: g.availableMana(p),
      cmdDamage: Object.entries(p.cmdDamage).map(([iid, n]) => ({ name: g.objects.get(+iid)?.card.name || '', n })),
      waiting: !!p.agent.ui?.waiting,
      // Kingdoms: the role chip as this seat may see it (face-up roles, their own, Bandits see Bandits)
      roleChip: g.kingdoms ? roleChip(g, p, seat, false) : '',
      // Turn clock: seconds left in this seat's bank (null when the clock is off or it isn't a friend's seat)
      bank: p.agent.ui?.bankLeft ? (p.agent.ui.bankLeft() == null ? null : Math.round(p.agent.ui.bankLeft())) : null,
    })),
    // How many times the host has nudged this seat (the friend page beeps when it goes up)
    nudges: g.players[seat]?.agent.ui?.nudges || 0,
    cmdLimit: g.format?.cmdDamage || 21,
    stack: g.stack.map(it => ({ name: it.o.card.name, img: unproxy(it.o.card.imgNormal || ''), who: it.p.name, color: it.p.color, ability: !!it.ability, label: it.label || '' })),
    log: g.logEntries.filter(e => e.kind !== 'why').slice(-60).map(e => ({ text: plain(e.html), kind: e.kind, color: e.p != null ? g.players[e.p].color : null })),
    chat: (g.chat || []).slice(-8),
  };
}
