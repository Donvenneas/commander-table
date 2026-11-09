// The page a friend opens to play one seat of a game hosted on someone else's PC.
// It polls the host for this seat's view of the table and any question waiting for this player,
// draws the table with the same look as the host, and sends answers back.
import { esc, symbolize, store } from './util.js';
import { startI18n } from './i18n.js';
import { renderTabletop } from './manual.js';

/** @type {(id: string) => any} */
const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
// A link carries ?code=…&seat=…; a join code ("K7Q2XF9ABM-2": the seat's own key, then the seat number,
// 0 for spectators) can be typed instead
let code = params.get('code'), seat = +params.get('seat');
if (!code && params.get('j')) [code, seat] = parseJoin(params.get('j'));
function parseJoin(s) {
  const m = String(s).toUpperCase().replace(/[\s-]/g, '').match(/^([A-Z0-9]{10})(\d)$/);
  return m ? [m[1], +m[2] - 1] : [null, NaN];
}
const api = (action, opts) => fetch(`/api/room/${action}?code=${encodeURIComponent(code || '')}&seat=${seat}`, opts);

let snap = null, question = null, answered = null, seenAt = 0, lastLog = '';
const boardHtml = new Map();
const cardData = new Map();

// ---------- theme
const prefs = store('ct.prefs') || {};
function applyTheme(t) { document.documentElement.dataset.theme = t; $('btnTheme').textContent = t === 'dark' ? '☀' : '☾'; }
applyTheme(prefs.theme || 'dark');
// The friend page follows a language chosen on this device, else the browser's own language
startI18n(prefs.lang || (navigator.language || 'en').slice(0, 2));
$('btnTheme').addEventListener('click', () => { prefs.theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; store('ct.prefs', prefs); applyTheme(prefs.theme); });

// ---------- joining
$('joinName').value = store('ct.name') || '';
// Seat -1 is a spectator: the whole table, no hands, no decisions
const watching = seat === -1;
if (watching) {
  document.querySelector('.topbar .tag').textContent = 'spectator';
  $('joinModal').querySelector('h2').textContent = 'Watch the game';
  $('joinText').textContent = 'You\'re watching someone\'s Commander Table. You\'ll see every board, but nobody\'s hand. You can still chat.';
  $('btnJoin').textContent = 'Watch';
}
if (!code || Number.isNaN(seat)) {
  $('joinText').textContent = 'Type the join code the host gave you (or open the link or QR code they shared).';
  $('joinCode').hidden = false;
}
$('btnJoin').addEventListener('click', async () => {
  if (!$('joinCode').hidden) {
    const [c, s] = parseJoin($('joinCode').value);
    if (!c) { $('joinText').textContent = 'That code doesn\'t look right: it\'s ten letters or numbers, a dash, and your seat number (like K7Q2XF9ABM-2).'; return; }
    // Reload with the full link so a refresh or a dropped connection rejoins the same seat
    store('ct.name', $('joinName').value.trim() || 'Friend');
    store('ct.joined', `${c}/${s}`);
    location.replace(`play.html?code=${c}&seat=${s}`);
    return;
  }
  const name = $('joinName').value.trim() || 'Friend';
  store('ct.name', name);
  store('ct.joined', `${code}/${seat}`);
  await api('hello', { method: 'POST', body: name }).catch(() => {});
  $('joinModal').hidden = true;
});
// Reopening the same link (after a dropped connection or a closed tab) rejoins straight away
if (code && store('ct.joined') === `${code}/${seat}`) $('btnJoin').click();
$('joinName').addEventListener('keydown', e => { if (e.key === 'Enter') $('btnJoin').click(); });

// ---------- drawing the table
const PHASES = { untap: 'Untap', upkeep: 'Upkeep', draw: 'Draw', main1: 'Main 1', combat: 'Combat', main2: 'Main 2', end: 'End' };
function cardHtml(c, extra = '') {
  cardData.set(c.iid, c);
  const cls = ['card', c.tapped && 'tapped', c.attacking && 'attacking', c.blocking && 'blocking', c.sick && 'sick', c.commander && 'commander', extra].filter(Boolean).join(' ');
  let badges = '';
  if (c.damage) badges += `<span class="bdg dmg">-${c.damage}</span>`;
  if (c.pt) badges += `<span class="bdg pt">${c.pt}</span>`;
  if (c.counters) badges += `<span class="bdg ctr">+${c.counters}</span>`;
  if (c.loyalty != null) badges += `<span class="bdg loy">${c.loyalty}</span>`;
  const face = c.faceDown ? `<div class="tkn fd"><b>Face down${c.peek ? `<br><small>${esc(c.peek)}</small>` : ''}</b></div>` : c.img ? `<img src="${esc(c.img)}" alt="${esc(c.name)}" draggable="false">` : `<div class="tkn" style="background-image:url('${esc(c.art)}')"><b>${esc(c.name)}</b></div>`;
  return `<div class="${cls}${c.img ? '' : ' noimg'}" data-iid="${c.iid}">${face}<div class="badges">${badges}</div></div>`;
}
function rowHtml(cards, stack) {
  let prev = null;
  return cards.map(c => { const h = cardHtml(c, stack && prev === c.name ? 'stacked' : ''); prev = c.name; return h; }).join('');
}

// The lobby before the game: choose your deck (paste a list, or one from the host's library)
function renderLobby() {
  const l = snap;
  $('turnLabel').textContent = 'Lobby: waiting for the host to start';
  if ($('table').dataset.lobby === '1') { $('lobbyChosen').textContent = l.chosen ? `The host has your deck: ${l.chosen}.` : ''; return; }
  $('table').dataset.lobby = '1';
  $('table').innerHTML = `<div class="lobby">
    <h2>Choose your deck</h2>
    <p class="muted">You're in seat ${l.seat + 1} (${esc(l.name)}). Paste a decklist (any common export: Moxfield, Archidekt, MTG Arena, MTGO…) or pick one of the host's saved decks. You can change it until the game starts.</p>
    ${l.library?.length ? `<label>From the host's library <select id="lobbyLib" class="input"><option value="">—</option>${l.library.map(n => `<option>${esc(n)}</option>`).join('')}</select></label>` : ''}
    <textarea id="lobbyText" class="input" spellcheck="false" placeholder="1 Atraxa, Praetors' Voice *CMDR*&#10;1 Sol Ring&#10;…"></textarea>
    <p><button class="btn primary" id="btnLobbySend">Use this deck</button> <span id="lobbyChosen" class="muted">${l.chosen ? `The host has your deck: ${esc(l.chosen)}.` : ''}</span></p>
  </div>`;
  $('btnLobbySend').addEventListener('click', async () => {
    const lib = $('lobbyLib')?.value;
    const body = lib ? `library:${lib}` : $('lobbyText').value.trim();
    if (!body) return;
    await api('deck', { method: 'POST', body }).catch(() => {});
    $('lobbyChosen').textContent = 'Sent. The host loads it when the game starts.';
  });
}

// ---------- the Tabletop (manual.js): you move your own cards; each move goes to the host, and the
// next one waits until the host's state says the last was applied
let mSeq = 0, mSending = false;
const mQueue = [];
let lastManual = '';
function renderManual() {
  // (only when something changed: an open card menu stays open between polls)
  const key = JSON.stringify(snap);
  if (key === lastManual) return;
  lastManual = key;
  $('turnLabel').textContent = `Tabletop · turn ${snap.turn} · ${snap.players[snap.active]?.name || ''}`;
  $('table').dataset.lobby = '';
  boardHtml.clear();
  $('actionBar').hidden = true;
  renderTabletop($('table'), snap, { canAct: i => !watching && i === seat, act: a => { mQueue.push(a); pumpManual(); } });
}
async function pumpManual() {
  const acked = snap?.acks?.[seat] || 0;
  // (after a reload, carry on from what the host already applied)
  if (acked > mSeq) mSeq = acked;
  if (mSending || !mQueue.length || acked < mSeq) return;
  mSending = true;
  const act = mQueue.shift();
  mSeq++;
  await api('answer', { method: 'POST', body: JSON.stringify({ manual: true, seq: mSeq, act }) }).catch(() => {});
  mSending = false;
}

function render() {
  if (!snap) return;
  if (snap.lobby) return renderLobby();
  // (deals belong to rules-engine games; the tabletop has none)
  $('btnDealOpen').hidden = watching || !!snap.manual;
  if (snap.manual) { renderManual(); pumpManual(); return; }
  if ($('table').dataset.lobby === '1') { $('table').dataset.lobby = ''; $('table').innerHTML = ''; boardHtml.clear(); }
  const me = snap.players[seat];
  $('turnLabel').textContent = snap.over ? (snap.winners?.length > 1 ? `${snap.winners.map(i => snap.players[i].name).join(', ')} win` : snap.winner != null ? `${snap.players[snap.winner].name} wins` : 'Game over')
    : snap.turn ? `Turn ${snap.turn} · Round ${snap.round} · ${snap.players[snap.active].name} · ${PHASES[snap.phase] || ''}` : 'Shuffling up…';
  const table = $('table');
  if (table.children.length !== snap.players.length) {
    // Seen from your own seat: you at the bottom left, the next players clockwise from there
    const n = snap.players.length;
    table.dataset.n = n;
    const pos = i => (watching ? i : n > 4 ? (i - seat + n) % n : [2, 0, 1, 3][(i - seat + n) % n] ?? i);
    table.innerHTML = snap.players.map(p => `<div class="board-slot ${p.idx === seat ? 'me' : ''}" data-slot="${p.idx}" style="order:${pos(p.idx)}"></div>`).join('');
    boardHtml.clear();
  }
  for (const p of snap.players) {
    const bf = p.battlefield;
    const n = bf.filter(c => c.zone !== 'lands').length;
    const cw = n > 22 ? '44px' : n > 16 ? '50px' : n > 10 ? '58px' : '66px';
    const hand = Array.isArray(p.hand)
      ? `<span class="zlabel">Your hand</span>${rowHtml(p.hand)}`
      : `<span class="zlabel">Hand · ${p.hand}</span>${'<span class="back"></span>'.repeat(Math.min(p.hand, 15))}`;
    const chips = (p.roleChip || '') + (snap.archenemy === p.idx && !p.lost ? '<span class="polchip arch">🎯 Archenemy</span>' : '')
      + p.cmdDamage.map(c => `<span class="cmdchip ${c.n >= (snap.cmdLimit || 21) - 6 ? 'hot' : ''}" style="--cc:var(--bad)">⚔ ${esc(c.name.split(',')[0])} ${c.n}/${snap.cmdLimit || 21}</span>`).join('');
    const html = `<div class="board ${snap.active === p.idx && !snap.over ? 'active' : ''} ${p.idx === seat ? 'you' : ''} ${p.waiting ? 'thinking' : ''}" data-player="${p.idx}" style="--pc:${p.color};--cw:${cw};--art:url('${esc(p.art)}')">
      <div class="bhead">
        <div class="avatar" style="background-image:url('${esc(p.art)}')"></div>
        <div class="who" title="${esc(p.deckName)}"><div class="pname">${esc(p.name)}</div>${p.bank != null ? `<span class="tclock ${p.bank < 30 ? 'low' : ''}" title="Time bank (turn clock)">⏱ ${Math.floor(p.bank / 60)}:${String(p.bank % 60).padStart(2, '0')}</span>` : ''}</div>
        <div class="mana" title="Untapped mana available">${p.mana ? `<span class="pip">⚡${p.mana}</span>` : ''}</div>
        <div class="stats"><span class="zbtn" title="Library">📚 Library <b>${p.library}</b></span><span class="zbtn" title="Graveyard">🪦 Graveyard <b>${p.graveyard}</b></span><span class="zbtn" title="Exile">⊘ Exile <b>${p.exile}</b></span></div>
        <div class="life ${p.life <= 10 ? 'low' : ''}"><small>LIFE</small><span class="lv">${p.life}</span></div>
      </div>
      <div class="cmdchips">${chips}</div>
      <div class="bbody">
        <div class="cmdzone"><div class="zlabel">Command</div><div class="zone-command">${rowHtml(p.command)}</div><div class="tax">${p.command.map(c => (c.tax ? `Tax +${c.tax}` : '')).filter(Boolean).join(' · ')}</div></div>
        <div class="field">
          <div class="row creatures" data-label="Creatures">${rowHtml(bf.filter(c => c.zone === 'creatures'))}</div>
          <div class="row others" data-label="Other permanents">${rowHtml(bf.filter(c => c.zone === 'others'))}</div>
          <div class="row lands" data-label="Lands">${rowHtml([...bf.filter(c => c.zone === 'lands')].sort((a, b) => a.name.localeCompare(b.name)), true)}</div>
        </div>
      </div>
      <div class="handrow">${hand}</div>
      ${p.lost ? `<div class="elim">Eliminated<small>${esc(p.lossReason)}</small></div>` : snap.over && (snap.winners || [snap.winner]).includes(p.idx) ? `<div class="elim winner">🏆 Winner<small>${esc(p.name)}</small></div>` : ''}
    </div>`;
    if (boardHtml.get(p.idx) !== html) { table.querySelector(`[data-slot="${p.idx}"]`).innerHTML = html; boardHtml.set(p.idx, html); }
  }
  // The stack, shown in the middle of the table
  const spot = snap.stack.map(s => `<div class="spot" style="--pc:${s.color}"><img src="${esc(s.img)}" alt="${esc(s.name)}"><div class="cap">${s.ability ? `${esc(s.name)}: ${esc(s.label.slice(0, 48))}` : `${esc(s.who)} casts ${esc(s.name)}`}</div></div>`).join('');
  if ($('spotlight').dataset.v !== spot) { $('spotlight').innerHTML = spot; $('spotlight').dataset.v = spot; }
  // Log
  const logKey = snap.log.map(e => e.text).join('\n');
  if (logKey !== lastLog) {
    lastLog = logKey;
    $('log').innerHTML = snap.log.map(e => `<div class="le ${e.kind}" ${e.color ? `style="--pc:${e.color}"` : ''}>${esc(e.text)}</div>`).join('');
    $('log').scrollTop = $('log').scrollHeight;
  }
  renderQuestion();
  // The host nudged you: a flash and a short beep
  if (lastNudges != null && (snap.nudges || 0) > lastNudges) nudged();
  lastNudges = snap.nudges || 0;
  // Speech bubbles for new chat messages
  const chat = snap.chat || [];
  const newest = chat.length ? chat[chat.length - 1].id : 0;
  if (lastBubble == null) lastBubble = newest;
  for (const m of chat) if (m.id > lastBubble && m.seat >= 0) bubble(document.querySelector(`.board[data-player="${m.seat}"]`), m.text);
  lastBubble = Math.max(lastBubble, newest);
}
let lastBubble = null;
let lastNudges = null;
let nudgeNote = false;
function nudged() {
  // (the note stays in the action bar until you answer)
  nudgeNote = true;
  renderQuestion();
  document.body.classList.add('nudged');
  setTimeout(() => document.body.classList.remove('nudged'), 1600);
  bubble(document.querySelector(`.board[data-player="${seat}"]`), '⏰ The host nudged you: it\'s your decision');
  try {
    const ac = new (window.AudioContext || window.webkitAudioContext)();
    const o = ac.createOscillator(), gn = ac.createGain();
    o.frequency.value = 880; gn.gain.value = 0.08;
    o.connect(gn).connect(ac.destination);
    o.start(); o.stop(ac.currentTime + 0.25);
  } catch { /* no sound available */ }
}
function bubble(board, text) {
  if (!board) return;
  const r = board.getBoundingClientRect();
  const b = document.createElement('div');
  b.className = 'say-bubble';
  b.textContent = text;
  Object.assign(b.style, { left: `${r.left + r.width / 2}px`, top: `${r.top + 8}px` });
  document.body.append(b);
  setTimeout(() => b.remove(), 3700);
}

// ---------- asking the host to undo your last decision
if (watching) $('btnAskUndo').hidden = true;
$('btnAskUndo').addEventListener('click', async () => {
  await api('undo', { method: 'POST', body: '' }).catch(() => {});
  $('btnAskUndo').textContent = 'Asked the host…';
  $('btnAskUndo').disabled = true;
});
function undoReply(r) {
  if (!r) return;
  $('btnAskUndo').disabled = false;
  $('btnAskUndo').textContent = r === 'allowed' ? 'Undone ✓ (ask again?)' : 'The host said no';
  setTimeout(() => { $('btnAskUndo').textContent = 'Undo my last decision'; }, 4000);
}

// ---------- chat
async function sendChat(text) {
  text = text.trim().slice(0, 200);
  if (!text) return;
  await api('chat', { method: 'POST', body: `${store('ct.name') || (watching ? 'Spectator' : 'Friend')}\n${text}` }).catch(() => {});
}
$('chatInput').addEventListener('keydown', e => { if (e.key === 'Enter') { sendChat(e.target.value); e.target.value = ''; } });
$('chatBox').addEventListener('click', e => { const b = e.target.closest('[data-say]'); if (b) sendChat(b.dataset.say); });
// Table talk: offer another player a deal (the host puts it to them at the start of the next turn)
if (watching) $('btnDealOpen').hidden = true;
$('btnDealOpen').addEventListener('click', () => {
  if (!snap?.players) return;
  $('dealTo').innerHTML = snap.players.filter(p => p.idx !== seat && !p.lost).map(p => `<option value="${p.idx}">${esc(p.name)}</option>`).join('');
  $('dealForm').hidden = !$('dealForm').hidden;
});
$('btnDealSend').addEventListener('click', () => {
  sendChat(`/deal ${$('dealTo').value} ${$('dealKind').value} ${$('dealRounds')?.value ?? 2}`);
  $('dealForm').hidden = true;
});

// ---------- your decisions
// Sideboarding between best-of-three games (item 135): two lists, click a card to move one copy across
let sbDraft = null;
function renderSideboard() {
  const sb = question.sideboard;
  if (!sbDraft || sbDraft.id !== question.id) sbDraft = { id: question.id, main: sb.main.map(x => [...x]), side: sb.side.map(x => [...x]) };
  const count = rows => rows.reduce((a, [, n]) => a + n, 0);
  const col = (rows, from) => rows.filter(([, n]) => n > 0).map(([name, n]) => `<button class="btn small sb-card" data-from="${from}" data-name="${esc(name)}">${n} ${esc(name)}</button>`).join('');
  const short = count(sbDraft.main) < sb.min;
  $('abText').innerHTML = `<b>Sideboard</b> for the next game: click a card to move one copy across. Deck ${count(sbDraft.main)}${short ? ` (at least ${sb.min})` : ''} · sideboard ${count(sbDraft.side)}
    <div class="sb-cols"><div><b>Deck</b><div>${col(sbDraft.main, 'main')}</div></div><div><b>Sideboard</b><div>${col(sbDraft.side, 'side')}</div></div></div>`;
  const btns = `<button class="btn primary" data-sb="play" ${short ? 'disabled' : ''}>Play these</button><button class="btn" data-sb="keep">Keep my deck</button>`;
  $('abButtons').innerHTML = btns; $('abButtons').dataset.v = '';
  $('actionBar').hidden = false;
}
document.addEventListener('click', e => {
  const tg = /** @type {any} */ (e.target);
  const c = tg.closest?.('.sb-card');
  if (c && sbDraft) {
    const from = c.dataset.from === 'main' ? sbDraft.main : sbDraft.side, to = c.dataset.from === 'main' ? sbDraft.side : sbDraft.main;
    const row = from.find(([n]) => n === c.dataset.name);
    if (row && row[1] > 0) { row[1]--; const t = to.find(([n]) => n === c.dataset.name); if (t) t[1]++; else to.push([c.dataset.name, 1]); }
    renderSideboard();
    return;
  }
  const b = tg.closest?.('[data-sb]');
  if (b && sbDraft && question?.sideboard) answer(b.dataset.sb === 'play' ? { button: 0, sideboard: { main: sbDraft.main.filter(([, n]) => n > 0), side: sbDraft.side.filter(([, n]) => n > 0) } } : { button: 1 });
});
function renderQuestion() {
  document.querySelectorAll('.pickable').forEach(e => e.classList.remove('pickable'));
  if (!question || question.id === answered) { $('actionBar').hidden = true; return; }
  if (question.sideboard) { if (sbDraft?.id !== question.id) renderSideboard(); return; }
  if (seenAt === 0) seenAt = Date.now();
  // The host sends bold text only; anything else is stripped
  const text = question.text.replace(/<(?!\/?b>)[^>]*>/g, '');
  const left = Math.max(0, Math.round(question.timeout - (Date.now() - seenAt) / 1000));
  $('abText').innerHTML = `${nudgeNote ? '<b class="nudge-note">⏰ The host nudged you.</b> ' : ''}${text} <span class="muted">(${question.bank ? `time bank ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` : `${left}s`})</span>`;
  const btns = question.buttons.map((b, i) => `<button class="btn ${b.primary ? 'primary' : ''}" data-b="${i}">${esc(b.label)}</button>`).join('');
  if ($('abButtons').dataset.v !== btns) { $('abButtons').innerHTML = btns; $('abButtons').dataset.v = btns; }
  for (const iid of question.objs) document.querySelectorAll(`.card[data-iid="${iid}"]`).forEach(e => e.classList.add('pickable'));
  for (const pl of question.players) document.querySelector(`.board[data-player="${pl}"]`)?.classList.add('pickable');
  $('actionBar').hidden = false;
}
async function answer(a) {
  if (!question) return;
  const id = question.id;
  answered = id;
  seenAt = 0;
  nudgeNote = false;
  $('actionBar').hidden = true;
  document.querySelectorAll('.pickable').forEach(e => e.classList.remove('pickable'));
  await api('answer', { method: 'POST', body: JSON.stringify({ id, ...a }) }).catch(() => { answered = null; });
}
$('abButtons').addEventListener('click', e => { const b = e.target.closest('[data-b]'); if (b) answer({ button: +b.dataset.b }); });
document.addEventListener('click', e => {
  if (!question || question.id === answered) return;
  const card = e.target.closest('.card.pickable[data-iid]');
  if (card) return answer({ obj: +card.dataset.iid });
  const board = e.target.closest('.board.pickable[data-player]');
  if (board && !e.target.closest('.card')) answer({ player: +board.dataset.player });
});
document.addEventListener('keydown', e => {
  if ($('actionBar').hidden || e.target.matches?.('input')) return;
  const btns = [...$('abButtons').children];
  let b = null;
  if (e.key === ' ' || e.key === 'Enter') b = btns.find(x => x.classList.contains('primary')) || btns[0];
  else if (/^[1-9]$/.test(e.key)) b = btns[+e.key - 1];
  if (b) { e.preventDefault(); b.click(); }
});

// ---------- card preview on hover
const pv = $('preview');
document.addEventListener('mouseover', e => {
  const t = e.target.closest('[data-iid]');
  const c = t && cardData.get(+t.dataset.iid);
  if (!c) { pv.hidden = true; return; }
  pv.innerHTML = `<div class="imgs">${c.img ? `<img class="big" src="${esc(c.img)}" alt="">` : ''}</div>
    <div class="ptext"><h3><span>${esc(c.name)}</span><span>${symbolize(c.cost || '')}</span></h3><div class="ptype">${esc(c.type || '')}${c.pt ? ` · ${esc(c.pt)}` : ''}</div><div class="oracle">${symbolize(c.text || '')}</div></div>`;
  pv.hidden = false;
  const r = pv.getBoundingClientRect();
  let x = e.clientX + 18;
  if (x + r.width > innerWidth - 8) x = e.clientX - r.width - 18;
  pv.style.left = `${Math.max(8, x)}px`;
  pv.style.top = `${Math.max(8, Math.min(e.clientY - r.height / 2, innerHeight - r.height - 8))}px`;
});

// ---------- polling the host
async function poll() {
  try {
    const r = await api('view');
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || r.status);
    $('connLabel').textContent = '● connected';
    $('connLabel').style.color = 'var(--good)';
    if (data.state) snap = data.state;
    undoReply(data.undoReply);
    if (!data.question || data.question.id !== question?.id) seenAt = 0;
    question = data.question;
    render();
  } catch (e) {
    $('connLabel').textContent = `● ${e.message || 'connection lost'}, retrying…`;
    $('connLabel').style.color = 'var(--bad)';
  }
  setTimeout(poll, 600);
}
poll();
setInterval(() => { if (question && question.id !== answered) renderQuestion(); }, 1000);
