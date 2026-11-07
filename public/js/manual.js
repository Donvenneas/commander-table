// Tabletop: a fully manual game for 2–9 players. Nothing is automated: no opening hands are dealt, nothing
// untaps or draws by itself, no one wins or loses by themselves. Every move is a click: draw, mulligan,
// play, tap, counters, life, poison, commander damage, control changes, face-down cards, looking at or
// searching your library, dice, coins, phases and passing the turn. The only thing done for you is
// the shuffle every game starts with (and, in Kingdoms, dealing the secret roles).
// The host's page keeps the table; friends online send their moves one at a time (numbered and
// acknowledged in the state) and see everything public plus their own hand and role.
import { esc } from './util.js';
import { dealRoles, roleById, ROLES, ROLE_TYPES, roleArt, roleTips, KINGDOMS_RULES, tableText } from './kingdoms.js';

const ZONES = ['hand', 'battlefield', 'graveyard', 'exile', 'library', 'command'];
const ZONE_NAME = { hand: 'hand', battlefield: 'battlefield', graveyard: 'graveyard', exile: 'exile', library: 'library', command: 'command zone' };
export const PHASES = ['Untap', 'Upkeep', 'Draw', 'Main 1', 'Combat', 'Main 2', 'End'];

let nextId = 1;
const cardOf = (c, owner) => ({ id: nextId++, name: c.name, img: c.imgSmall || c.imgNormal || '', big: c.imgNormal || '', type: c.typeLine || '', owner, tapped: false, counters: 0, faceDown: false, token: false });
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

export class Tabletop {
  // seats: [{ name, color, deck, remote }]; opts: { life, kingdoms }
  constructor(seats, { life = 40, kingdoms = false } = {}) {
    this.turn = 1; this.active = 0; this.phase = 'Main 1'; this.log = []; this.acks = {}; this.peek = {}; this.kingdoms = !!kingdoms; this.winners = [];
    this.players = seats.map((s, i) => {
      const p = { idx: i, name: s.name, color: s.color, remote: !!s.remote, life, poison: 0, cmd: {}, eliminated: false, handPublic: false, role: null, zones: Object.fromEntries(ZONES.map(z => [z, []])) };
      for (const c of s.deck.commanders || []) p.zones.command.push(cardOf(c, i));
      for (const { card, qty } of s.deck.cards) for (let k = 0; k < qty; k++) p.zones.library.push(cardOf(card, i));
      shuffle(p.zones.library);
      return p;
    });
    this.say(`Tabletop: ${this.players.length} players at ${life} life. Libraries are shuffled; nothing else happens by itself. Draw your opening hands with "Draw 7".`);
    if (this.kingdoms) {
      const roles = dealRoles(this.players.length);
      if (roles) {
        this.players.forEach((p, i) => { p.role = roles[i]; });
        const king = this.players.find(p => p.role.id === 'king');
        // (the King reveals, starts with 10 more life and takes the first turn)
        king.life += 10;
        this.active = king.idx;
        this.say(`Kingdoms: roles dealt (${tableText(this.players.length)}). ${king.name} is the King: face up, ${king.life} life, and takes the first turn.${this.players.some(p => p.role.id && roleById(p.role.id)?.type === 'bandit') ? ' The Bandits know each other.' : ''}`);
      } else this.say('Kingdoms needs 5 to 9 players; no roles were dealt.');
    }
  }
  say(t) { this.log.push(t); if (this.log.length > 300) this.log.shift(); }
  find(id) { for (const p of this.players) for (const z of ZONES) { const i = p.zones[z].findIndex(c => c.id === id); if (i >= 0) return { p, z, i, c: p.zones[z][i] }; } return null; }
  roleOf(p) { return p.role ? roleById(p.role.id) : null; }

  // A move by seat `who` (null: the host, who may move any seat played on its own PC; the page checks).
  // Returns false if refused.
  apply(who, a) {
    const P = this.players;
    const mine = p => !!p && (who == null || p.idx === who);
    const named = (c, z) => (c.faceDown && z === 'battlefield' ? 'a face-down card' : c.name);
    switch (a.k) {
      case 'move': {
        const f = this.find(a.id);
        if (!f || !mine(f.p) || !ZONES.includes(a.to)) return false;
        if (f.z === a.to && a.to !== 'library') return false;
        f.p.zones[f.z].splice(f.i, 1);
        const c = f.c;
        // (off the battlefield a card goes to its owner's zones; onto it, under the mover's control)
        const dest = a.to === 'battlefield' ? f.p : P[c.owner];
        const shown = named(c, f.z);
        if (a.to !== 'battlefield') { c.tapped = false; c.counters = 0; c.faceDown = false; }
        if (c.token && a.to !== 'battlefield') { this.say(`${f.p.name}'s ${c.name} token leaves the battlefield`); return true; }
        if (a.to === 'battlefield' && a.faceDown) c.faceDown = true;
        if (a.to === 'library' && a.bottom) dest.zones.library.unshift(c); else dest.zones[a.to].push(c);
        const hidden = (f.z === 'hand' || f.z === 'library') && (a.to === 'hand' || a.to === 'library');
        this.say(`${f.p.name} moves ${hidden ? 'a card' : c.faceDown ? 'a card face down' : shown} from their ${ZONE_NAME[f.z]} to ${a.to === 'library' ? `the ${a.bottom ? 'bottom' : 'top'} of ${dest === f.p ? 'their' : `${dest.name}'s`} library` : `${dest === f.p ? 'their' : `${dest.name}'s`} ${ZONE_NAME[a.to]}`}`);
        return true;
      }
      case 'give': {
        const f = this.find(a.id), to = P[a.to];
        if (!f || !mine(f.p) || f.z !== 'battlefield' || !to || to === f.p) return false;
        f.p.zones.battlefield.splice(f.i, 1);
        to.zones.battlefield.push(f.c);
        this.say(`${f.p.name} gives control of ${named(f.c, 'battlefield')} to ${to.name}`);
        return true;
      }
      case 'tap': case 'flip': case 'counter': {
        const f = this.find(a.id);
        if (!f || !mine(f.p) || f.z !== 'battlefield') return false;
        if (a.k === 'tap') { f.c.tapped = !f.c.tapped; this.say(`${f.p.name} ${f.c.tapped ? 'taps' : 'untaps'} ${named(f.c, 'battlefield')}`); }
        if (a.k === 'flip') { f.c.faceDown = !f.c.faceDown; this.say(`${f.p.name} turns ${f.c.faceDown ? `${f.c.name} face down` : `a face-down card face up: ${f.c.name}`}`); }
        if (a.k === 'counter') { f.c.counters += a.d > 0 ? 1 : -1; this.say(`${f.p.name} ${a.d > 0 ? 'puts a counter on' : 'removes a counter from'} ${named(f.c, 'battlefield')} (${f.c.counters})`); }
        return true;
      }
      case 'life': case 'poison': {
        const p = P[a.p];
        if (!mine(p)) return false;
        p[a.k] += a.d;
        this.say(`${p.name}: ${a.k} ${a.d > 0 ? '+' : ''}${a.d} → ${p[a.k]}`);
        return true;
      }
      case 'cmd': {
        const p = P[a.p], from = P[a.from];
        if (!mine(p) || !from) return false;
        p.cmd[a.from] = Math.max(0, (p.cmd[a.from] || 0) + a.d);
        this.say(`${p.name}: commander damage from ${from.name} → ${p.cmd[a.from]}`);
        return true;
      }
      case 'draw': case 'mill': {
        const p = P[a.p];
        if (!mine(p)) return false;
        const n = Math.max(1, Math.min(99, +a.n || 1));
        let k = 0;
        for (; k < n; k++) { const c = p.zones.library.pop(); if (!c) break; p.zones[a.k === 'draw' ? 'hand' : 'graveyard'].push(c); }
        this.say(k ? `${p.name} ${a.k === 'draw' ? `draws ${k} card${k === 1 ? '' : 's'}` : `mills ${k} card${k === 1 ? '' : 's'}`}${k < n ? ' (the library ran out)' : ''}` : `${p.name} has no cards left in their library`);
        return true;
      }
      case 'shuffle': { const p = P[a.p]; if (!mine(p)) return false; shuffle(p.zones.library); this.say(`${p.name} shuffles their library`); return true; }
      case 'untapAll': { const p = P[a.p]; if (!mine(p)) return false; p.zones.battlefield.forEach(c => { c.tapped = false; }); this.say(`${p.name} untaps everything`); return true; }
      case 'mulligan': {
        const p = P[a.p];
        if (!mine(p)) return false;
        p.zones.library.push(...p.zones.hand.splice(0));
        shuffle(p.zones.library);
        for (let k = 0; k < 7; k++) { const c = p.zones.library.pop(); if (c) p.zones.hand.push(c); }
        this.say(`${p.name} mulligans: shuffles their hand away and draws 7 (put cards on the bottom yourself)`);
        return true;
      }
      // Looking at cards only you can see: the top N, or the whole library (search)
      case 'look': case 'search': {
        const p = P[a.p];
        if (!mine(p)) return false;
        const lib = p.zones.library;
        const n = a.k === 'search' ? lib.length : Math.max(1, Math.min(lib.length, +a.n || 1));
        this.peek[p.idx] = { kind: a.k, ids: lib.slice(lib.length - n).reverse().map(c => c.id) };
        this.say(a.k === 'search' ? `${p.name} searches their library` : `${p.name} looks at the top ${n} card${n === 1 ? '' : 's'} of their library`);
        return true;
      }
      case 'peekDone': {
        const p = P[a.p];
        if (!mine(p)) return false;
        const was = this.peek[p.idx];
        delete this.peek[p.idx];
        if (a.shuffle) { shuffle(p.zones.library); this.say(`${p.name} shuffles their library`); }
        else if (was) this.say(`${p.name} is done looking at their library`);
        return true;
      }
      case 'reveal': {
        const f = this.find(a.id);
        if (!f || !mine(f.p)) return false;
        this.say(`${f.p.name} reveals ${f.c.name} from their ${ZONE_NAME[f.z]}`);
        return true;
      }
      case 'handPublic': { const p = P[a.p]; if (!mine(p)) return false; p.handPublic = !p.handPublic; this.say(`${p.name} ${p.handPublic ? 'reveals their hand to everyone' : 'hides their hand again'}`); return true; }
      case 'token': {
        const p = P[a.p];
        if (!mine(p)) return false;
        const name = String(a.name || 'Token').slice(0, 40);
        p.zones.battlefield.push({ id: nextId++, name, img: a.img || '', big: '', type: 'Token', owner: p.idx, tapped: false, counters: 0, faceDown: false, token: true });
        this.say(`${p.name} creates a ${name} token`);
        return true;
      }
      case 'dice': { const p = P[a.p]; if (!mine(p)) return false; const s = [2, 4, 6, 8, 10, 12, 20, 100].includes(+a.sides) ? +a.sides : 6; this.say(s === 2 ? `${p.name} flips a coin: ${Math.random() < 0.5 ? 'heads' : 'tails'}` : `${p.name} rolls a d${s}: ${1 + Math.floor(Math.random() * s)}`); return true; }
      case 'phase': {
        if (who != null && who !== this.active) return false;
        if (!PHASES.includes(a.name)) return false;
        this.phase = a.name;
        this.say(`${P[this.active].name}'s turn: ${a.name}`);
        return true;
      }
      case 'pass': {
        if (who != null && who !== this.active) return false;
        let next = this.active;
        for (let k = 0; k < P.length; k++) { next = (next + 1) % P.length; if (!P[next].eliminated) break; }
        if (next <= this.active) this.turn++;
        this.active = next;
        this.phase = 'Untap';
        this.say(`Turn ${this.turn}: ${P[next].name}`);
        return true;
      }
      case 'eliminate': {
        const p = P[a.p];
        if (!mine(p)) return false;
        p.eliminated = !p.eliminated;
        // (Kingdoms: an eliminated player's role is revealed)
        if (p.eliminated && p.role && !p.role.up) { p.role.up = true; this.say(`${p.name}'s role is revealed: ${this.roleOf(p).name} (${ROLE_TYPES[this.roleOf(p).type]})`); }
        this.say(p.eliminated ? `${p.name} is eliminated` : `${p.name} is back in the game`);
        return true;
      }
      case 'announce': {
        const p = P[a.p];
        if (!mine(p) || !p.role || p.role.up) return false;
        p.role.up = true;
        const r = this.roleOf(p);
        this.say(`${p.name} Announces: ${r.name} (${ROLE_TYPES[r.type]}). ${r.text}`);
        return true;
      }
      case 'role': {
        // A role card changes (the Rightful Heir or a new King gains the King role, the Cultist converts…)
        const p = P[a.p], r = roleById(a.role);
        if (!mine(p) || !p.role || !r) return false;
        p.role = { id: r.id, up: p.role.up || r.type === 'king' };
        this.say(`${p.name}'s role card becomes ${p.role.up ? `${r.name} (${ROLE_TYPES[r.type]})` : 'another role'}`);
        return true;
      }
      case 'win': {
        const p = P[a.p];
        if (!mine(p)) return false;
        if (!this.winners.includes(p.idx)) this.winners.push(p.idx);
        this.say(`🏆 ${p.name} declares victory${p.role ? ` (${this.roleOf(p).name}: ${this.roleOf(p).victory})` : ''}`);
        return true;
      }
      default: return false;
    }
  }

  // What one seat sees: everything public, their own hand, peek and role (seat -1: nobody's hidden cards)
  view(seat) {
    const me = this.players[seat];
    const myRole = me ? this.roleOf(me) : null;
    const seeRole = p => !!p.role && (p.role.up || p.idx === seat || (myRole?.type === 'bandit' && this.roleOf(p)?.type === 'bandit'));
    const peek = me && this.peek[seat] ? { kind: this.peek[seat].kind, cards: this.peek[seat].ids.map(id => this.find(id)?.c).filter(c => c && this.find(c.id).z === 'library') } : null;
    const hideFace = c => (c.faceDown && !(seat >= 0 && this.find(c.id)?.p.idx === seat) ? { ...c, name: 'Face-down card', img: '', big: '' } : c);
    return {
      manual: true, seat, turn: this.turn, active: this.active, phase: this.phase, log: this.log.slice(-60), acks: this.acks, kingdoms: this.kingdoms, winners: this.winners,
      peek,
      players: this.players.map(p => ({
        idx: p.idx, name: p.name, color: p.color, life: p.life, poison: p.poison, cmd: p.cmd, remote: p.remote, eliminated: p.eliminated, handPublic: p.handPublic,
        role: p.role ? (seeRole(p) ? { id: p.role.id, up: p.role.up } : { hidden: true }) : null,
        hand: seat === p.idx || p.handPublic ? p.zones.hand : p.zones.hand.length,
        library: p.zones.library.length,
        battlefield: p.zones.battlefield.map(hideFace), graveyard: p.zones.graveyard, exile: p.zones.exile, command: p.zones.command,
      })),
    };
  }
}

// ---------- drawing the table (host page and friend page)
// opts: { canAct(playerIdx), act(move), viewers: [{ seat, name }] (host: who's looking), onView(seat) }
export function renderTabletop(root, v, { canAct, act, viewers = null, onView = null }) {
  const me = v.players[v.seat];
  const roleBadge = p => {
    if (!p.role) return '';
    if (p.role.hidden) return '<span class="mt-role hidden" title="A secret role">🂠 Hidden role</span>';
    const r = roleById(p.role.id);
    return `<span class="mt-role t-${r.type}" title="${esc(`${r.name}: ${r.text}`)}">${p.role.up ? '' : '🔒 '}${esc(r.name)} · ${ROLE_TYPES[r.type]}</span>`;
  };
  const cardHtml = (c, owner, zone) => `<div class="mt-card ${c.tapped ? 'tapped' : ''} ${c.token ? 'token' : ''} ${c.faceDown ? 'facedown' : ''}" data-id="${c.id}" data-owner="${owner}" data-zone="${zone}" title="${esc(c.name)}${c.type ? ` · ${esc(c.type)}` : ''}">
    ${c.faceDown && !c.img ? '<span class="back mt-back"></span>' : c.img ? `<img src="${esc(c.img)}" alt="${esc(c.name)}" loading="lazy">` : `<span class="mt-name">${esc(c.name)}</span>`}${c.counters ? `<b class="mt-ctr">${c.counters > 0 ? '+' : ''}${c.counters}</b>` : ''}${c.faceDown && c.img ? '<b class="mt-fd">face down</b>' : ''}</div>`;
  const pile = (list, owner, zone) => (Array.isArray(list) ? list.map(c => cardHtml(c, owner, zone)).join('') : '<span class="back"></span>'.repeat(Math.min(list, 10)) + (list > 10 ? ` <small>${list}</small>` : ''));
  const can = i => canAct(i);
  const btn = (act, p, label, extra = '') => `<button class="btn small" data-act="${act}" data-p="${p}" ${extra}>${label}</button>`;
  const others = p => v.players.filter(q => q.idx !== p.idx);
  // The viewer's own role card, with Announce and the tips
  const myRoleHtml = () => {
    if (!me?.role || me.role.hidden) return '';
    const r = roleById(me.role.id);
    return `<div class="mt-myrole t-${r.type}">
      <img class="mt-roleart" src="${roleArt(r.id)}" alt="" onerror="this.remove()">
      <div><b>Your role: ${esc(r.name)}</b> <span class="muted">${ROLE_TYPES[r.type]} · ${me.role.up ? 'face up' : 'face down (secret)'}</span>
        <div><b>Victory</b>: ${esc(r.victory)}</div>${r.defeat ? `<div><b>Defeat</b>: ${esc(r.defeat)}</div>` : '<div class="muted">Defeat: you are eliminated.</div>'}
        <div class="mt-roletext">${esc(r.text)}</div>
        <div class="mt-tools">${!me.role.up && can(me.idx) ? btn('announce', me.idx, 'Announce (turn your role face up)', 'data-primary="1"') : ''}
          ${can(me.idx) ? `<select class="input mt-rolechange" data-p="${me.idx}" title="When a role ability gives you another role card (the King role, a Cultist copy…)"><option value="">Change role card…</option>${ROLES.map(x => `<option value="${x.id}">${esc(x.name)} (${ROLE_TYPES[x.type]})</option>`).join('')}</select>` : ''}
          ${can(me.idx) ? btn('win', me.idx, '🏆 Declare victory') : ''}
          <details class="mt-tips"><summary>Role tips</summary><img src="${roleTips(r.id)}" alt="" onerror="this.parentElement.remove()"></details></div></div></div>`;
  };
  root.innerHTML = `<div class="mt-top">
      <b>${v.kingdoms ? 'Kingdoms · ' : ''}Turn ${v.turn} · ${esc(v.players[v.active]?.name || '')}</b>
      <span class="mt-phases">${PHASES.map(ph => `<button class="btn small ${ph === v.phase ? 'primary' : ''}" data-act="phase" data-name="${ph}" ${can(v.active) ? '' : 'disabled'}>${ph}</button>`).join('')}</span>
      ${can(v.active) ? '<button class="btn small primary" data-act="pass">Pass the turn</button>' : ''}
      ${v.seat >= 0 && can(v.seat) ? `<span class="mt-tools">${btn('dice', v.seat, 'd6', 'data-sides="6"')}${btn('dice', v.seat, 'd20', 'data-sides="20"')}${btn('dice', v.seat, 'Coin', 'data-sides="2"')}</span>` : ''}
      ${viewers ? `<label class="muted">Viewing as <select class="input mt-viewer">${viewers.map(x => `<option value="${x.seat}" ${x.seat === v.seat ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>` : ''}
      ${v.kingdoms ? `<details class="mt-rules"><summary>Kingdoms rules</summary><ol>${KINGDOMS_RULES.map(r => `<li>${esc(r)}</li>`).join('')}</ol></details>` : ''}
      ${v.winners?.length ? `<b class="mt-win">🏆 ${v.winners.map(i => esc(v.players[i].name)).join(', ')}</b>` : ''}
    </div>
    ${myRoleHtml()}
    ${v.peek ? `<div class="mt-peek"><b>${v.peek.kind === 'search' ? 'Searching your library' : `Top ${v.peek.cards.length} of your library`}</b> <span class="muted">(only you see these; click a card to move it)</span>
      <div class="mt-zone">${v.peek.cards.map(c => cardHtml(c, v.seat, 'library')).join('') || '<span class="muted">No cards</span>'}</div>
      ${btn('peekDone', v.seat, 'Done')}${btn('peekDone', v.seat, 'Done and shuffle', 'data-shuffle="1"')}</div>` : ''}
    <div class="mt-boards">${v.players.map(p => `<div class="mt-board ${p.idx === v.active ? 'active' : ''} ${p.eliminated ? 'out' : ''}" style="--pc:${p.color}">
      <div class="mt-head"><b>${esc(p.name)}</b>${p.remote ? ' <small class="muted">online</small>' : ''} ${roleBadge(p)}${p.eliminated ? ' <b class="bad">eliminated</b>' : ''}
        <span class="mt-life">${can(p.idx) ? btn('life', p.idx, '−5', 'data-d="-5"') + btn('life', p.idx, '−', 'data-d="-1"') : ''} ❤ ${p.life} ${can(p.idx) ? btn('life', p.idx, '+', 'data-d="1"') + btn('life', p.idx, '+5', 'data-d="5"') : ''}</span>
        <span class="mt-life">${can(p.idx) ? btn('poison', p.idx, '−', 'data-d="-1"') : ''} ☠ ${p.poison} ${can(p.idx) ? btn('poison', p.idx, '+', 'data-d="1"') : ''}</span>
        ${Object.entries(p.cmd || {}).filter(([, n]) => n).map(([f, n]) => `<span class="mt-cmd" title="Commander damage from ${esc(v.players[f]?.name || '')}">⚔ ${esc(v.players[f]?.name || '')} ${n}</span>`).join('')}
      </div>
      ${can(p.idx) ? `<div class="mt-tools">${btn('draw', p.idx, 'Draw')}${btn('draw', p.idx, 'Draw 7', 'data-n="7"')}${btn('drawN', p.idx, 'Draw X…')}${btn('mulligan', p.idx, 'Mulligan')}${btn('untapAll', p.idx, 'Untap all')}${btn('shuffle', p.idx, 'Shuffle')}${btn('lookN', p.idx, 'Look at top…')}${btn('search', p.idx, 'Search')}${btn('millN', p.idx, 'Mill…')}${btn('token', p.idx, 'Token…')}${btn('handPublic', p.idx, p.handPublic ? 'Hide hand' : 'Reveal hand')}
        <select class="input mt-cmdsel" data-p="${p.idx}" title="Commander damage you took"><option value="">Commander damage…</option>${others(p).map(q => `<option value="${q.idx}">from ${esc(q.name)} +1</option><option value="${q.idx}:-1">from ${esc(q.name)} −1</option>`).join('')}</select>
        ${btn('eliminate', p.idx, p.eliminated ? 'Back in the game' : 'Eliminated')}</div>` : ''}
      ${p.command.length ? `<div class="mt-zone"><span class="zlabel">Command</span>${pile(p.command, p.idx, 'command')}</div>` : ''}
      <div class="mt-zone mt-bf"><span class="zlabel">Battlefield</span>${pile(p.battlefield, p.idx, 'battlefield')}</div>
      <div class="mt-row">
        <div class="mt-zone"><span class="zlabel">Hand · ${Array.isArray(p.hand) ? p.hand.length : p.hand}${p.handPublic ? ' (revealed)' : ''}</span>${pile(p.hand, p.idx, 'hand')}</div>
        <div class="mt-zone mt-small"><span class="zlabel">Library · ${p.library}</span></div>
        <div class="mt-zone mt-small"><span class="zlabel">Graveyard · ${p.graveyard.length}</span>${pile(p.graveyard.slice(-8), p.idx, 'graveyard')}</div>
        <div class="mt-zone mt-small"><span class="zlabel">Exile · ${p.exile.length}</span>${pile(p.exile.slice(-8), p.idx, 'exile')}</div>
      </div></div>`).join('')}</div>
    <div class="mt-log">${v.log.slice(-14).reverse().map(l => `<div>${esc(l)}</div>`).join('')}</div>
    <div class="mt-menu" hidden></div>`;
  const menu = root.querySelector('.mt-menu');
  const ask = (q, d) => { const x = prompt(q, d); return x == null ? null : x; };
  root.onchange = e => {
    if (e.target.matches('.mt-viewer')) onView?.(+e.target.value);
    if (e.target.matches('.mt-cmdsel') && e.target.value) { const [from, d] = e.target.value.split(':'); act({ k: 'cmd', p: +e.target.dataset.p, from: +from, d: d ? +d : 1 }); }
    if (e.target.matches('.mt-rolechange') && e.target.value) act({ k: 'role', p: +e.target.dataset.p, role: e.target.value });
  };
  root.onclick = e => {
    const b = e.target.closest('[data-act]');
    if (b) {
      e.stopPropagation();
      const p = +b.dataset.p, k = b.dataset.act;
      if (k === 'token') { const name = ask('Token name (for example "1/1 Soldier" or "War Bear")', 'Token'); if (name) act({ k: 'token', p, name, img: /^war bear$/i.test(name.trim()) ? roleArt('warbear') : '' }); return; }
      if (k === 'drawN' || k === 'millN' || k === 'lookN') { const n = +ask(k === 'lookN' ? 'Look at how many cards from the top?' : `${k === 'drawN' ? 'Draw' : 'Mill'} how many cards?`, k === 'lookN' ? '3' : '1'); if (n > 0) act({ k: k === 'lookN' ? 'look' : k.slice(0, -1), p, n }); return; }
      if (k === 'mv') { act({ k: 'move', id: +b.dataset.id, to: b.dataset.to, bottom: b.dataset.bottom === '1', faceDown: b.dataset.fd === '1' }); menu.hidden = true; return; }
      if (k === 'give') { act({ k: 'give', id: +b.dataset.id, to: +b.dataset.to }); menu.hidden = true; return; }
      if (['tap', 'counter', 'flip', 'reveal'].includes(k)) { act({ k, id: +b.dataset.id, d: +b.dataset.d || 0 }); menu.hidden = true; return; }
      if (k === 'phase') { act({ k, name: b.dataset.name }); return; }
      if (k === 'dice') { act({ k, p, sides: +b.dataset.sides }); return; }
      if (k === 'peekDone') { act({ k, p, shuffle: b.dataset.shuffle === '1' }); return; }
      act({ k, p, d: +b.dataset.d || 0, n: +b.dataset.n || 1 });
      return;
    }
    const c = e.target.closest('.mt-card');
    if (!c || !canAct(+c.dataset.owner)) { menu.hidden = true; return; }
    const id = +c.dataset.id, z = c.dataset.zone, owner = +c.dataset.owner;
    const mv = (to, label, opt = {}) => (to === z && !opt.bottom && to !== 'library' ? '' : `<button class="btn small" data-act="mv" data-id="${id}" data-to="${to}" data-bottom="${opt.bottom ? 1 : 0}" data-fd="${opt.fd ? 1 : 0}">${label}</button>`);
    menu.innerHTML = `<b>${esc(c.title.split(' · ')[0])}</b>
      ${z === 'battlefield' ? `<button class="btn small primary" data-act="tap" data-id="${id}">Tap / untap</button><button class="btn small" data-act="counter" data-id="${id}" data-d="1">+1 counter</button><button class="btn small" data-act="counter" data-id="${id}" data-d="-1">−1 counter</button><button class="btn small" data-act="flip" data-id="${id}">Turn face down / up</button>` : ''}
      ${z === 'hand' ? `<button class="btn small" data-act="reveal" data-id="${id}">Reveal it</button>` : ''}
      ${mv('battlefield', 'To battlefield')}${z !== 'battlefield' ? mv('battlefield', 'To battlefield face down', { fd: true }) : ''}${mv('hand', 'To hand')}${mv('graveyard', 'To graveyard')}${mv('exile', 'To exile')}${mv('library', 'Library top')}${mv('library', 'Library bottom', { bottom: true })}${mv('command', 'To command zone')}
      ${z === 'battlefield' ? `<span class="muted">Give control to:</span>${v.players.filter(q => q.idx !== owner && !q.eliminated).map(q => `<button class="btn small" data-act="give" data-id="${id}" data-to="${q.idx}">${esc(q.name)}</button>`).join('')}` : ''}`;
    const r = c.getBoundingClientRect(), R = root.getBoundingClientRect();
    Object.assign(menu.style, { left: `${Math.max(0, Math.min(r.left - R.left, R.width - 230))}px`, top: `${r.bottom - R.top + 4}px` });
    menu.hidden = false;
  };
}
