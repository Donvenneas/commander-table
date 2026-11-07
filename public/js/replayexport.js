// Shareable replay viewer: the current game re-simulated in the background (same seed, same recorded
// answers), with a compact frame of the board at every step, written into one standalone HTML file that
// plays it back in any browser with nothing to install. Card images come from Scryfall when online;
// offline, the cards show their names.
import { Game } from './engine.js';
import { Agent, guessStyle } from './ai.js';
import { HumanAgent } from './human.js';
import { RemoteUI } from './net.js';
import { unproxy, esc } from './util.js';
import { BRACKET_NOISE } from './brackets.js';

const plain = html => { const d = document.createElement('div'); d.innerHTML = html; return d.textContent; };

// Answers recorded for people (you, hotseat players, online friends) are played back; if they run out,
// the AI decides (the same way a loaded replay works)
function playbackUI(record) {
  const ui = new RemoteUI(null, -1);
  ui.setRecord(record || [], true);
  return ui;
}

export async function buildReplayHtml(setup, onProgress) {
  const shared = playbackUI([...(setup.decisions || [])]);
  const uis = [shared];
  const seats = setup.seats.map((s, i) => ({
    playerName: s.name, deckName: s.deck.deckName, color: s.color, commanders: s.deck.commanders, cards: s.deck.cards,
    // (with the stops and trigger ordering the game was played with, so the answers line up)
    agent: setup.humans?.includes(i) ? new HumanAgent(guessStyle(s.deck), shared, setup.stopOpts)
      : setup.remote?.includes(i) ? new HumanAgent(guessStyle(s.deck), uis[uis.push(playbackUI([...(setup.remoteDecisions?.[i] || [])])) - 1], { orderTriggers: setup.stopOpts?.orderTriggers })
      // (same bracket noise as the live game, so the AI makes the same choices)
      : new Agent(s.style, { noise: BRACKET_NOISE[s.bracket] || 0, lookahead: !!s.lookahead }),
  }));
  const cards = {};
  const frames = [];
  const log = [];
  let last = '';
  let g;
  const capture = () => {
    const pz = g.players.map(p => {
      const ids = list => list.map(o => {
        if (!cards[o.iid]) cards[o.iid] = [o.card.name, unproxy(o.card.imgSmall || o.card.imgNormal || ''), o.card.typeLine || ''];
        return o.iid;
      });
      const bf = p.battlefield.map(o => { ids([o]); return [o.iid, o.tapped ? 1 : 0, o.counters || 0, o.attacking != null ? 1 : 0, o.fx.type.creature ? 0 : o.fx.type.land ? 2 : 1]; });
      return [p.life, p.hand.length, p.library.length, p.graveyard.length, p.exile.length, ids(p.command), bf, p.lost ? 1 : 0, Object.values(p.cmdDamage).reduce((a, b) => Math.max(a, b), 0)];
    });
    const f = { t: g.turn, r: g.round, a: g.active, ph: g.phase, p: pz, st: g.stack.map(it => [it.o.card.name, it.p.idx]), l: log.length };
    const key = JSON.stringify(f);
    if (key !== last) { frames.push(f); last = key; }
  };
  const clock = { beat: async () => { capture(); if (frames.length % 50 === 0) { onProgress?.(`Recording step ${frames.length}…`); await new Promise(r => setTimeout(r, 0)); } } };
  g = new Game(seats, clock, { seed: setup.seed, learned: setup.learned, noLearning: setup.noLearning || !!setup.puzzle, puzzle: setup.puzzle, format: setup.format, firstPlayer: setup.firstPlayer });
  for (const ui of uis) ui.attach(g);
  g.on('log', e => log.push([plain(e.html), e.kind, e.p ?? -1]));
  await g.run();
  capture();
  const data = {
    title: setup.seats.map(s => s.deck.deckName).join(' vs '),
    players: setup.seats.map(s => ({ name: s.name, deck: s.deck.deckName, color: s.color })),
    winner: g.winner ? g.winner.idx : null, reason: g.winReason || '',
    cards, frames, log,
  };
  return viewerHtml(data);
}

function viewerHtml(data) {
  // Escape "</" so the data can't end the script element early
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(data.title)} · Commander Table replay</title>
<style>
:root { --bg: #0f1115; --panel: #181b22; --line: #2a2f3a; --text: #e8eaf0; --muted: #8b93a3; --good: #3ecf8e; --bad: #ff5d6c; color-scheme: dark; }
@media (prefers-color-scheme: light) { :root { --bg: #eef0f4; --panel: #fff; --line: #d6dae2; --text: #1b1f27; --muted: #5d6573; color-scheme: light; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font: 14px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; }
header { display: flex; flex-wrap: wrap; gap: 8px 14px; align-items: center; padding: 10px 16px; border-bottom: 1px solid var(--line); background: var(--panel); position: sticky; top: 0; z-index: 2; }
header h1 { font-size: 15px; margin: 0; flex: 1 1 260px; }
button { background: var(--bg); color: var(--text); border: 1px solid var(--line); border-radius: 7px; padding: 5px 10px; font: inherit; cursor: pointer; }
button:hover { border-color: var(--good); }
input[type=range] { flex: 1 1 200px; }
.info { color: var(--muted); font-size: 12.5px; min-width: 190px; }
main { display: grid; grid-template-columns: 1fr 320px; gap: 10px; padding: 10px 16px; }
@media (max-width: 900px) { main { grid-template-columns: 1fr; } }
.table { display: grid; grid-template-columns: repeat(auto-fit, minmax(330px, 1fr)); gap: 10px; }
.pl { background: var(--panel); border: 1px solid var(--line); border-top: 3px solid var(--pc); border-radius: 10px; padding: 8px; min-height: 160px; position: relative; }
.pl.active { box-shadow: 0 0 0 2px var(--pc); }
.pl.lost { opacity: .45; }
.pl h2 { margin: 0; font-size: 14px; display: flex; justify-content: space-between; gap: 8px; }
.pl h2 small { color: var(--muted); font-weight: 400; }
.life { font-size: 20px; font-weight: 800; }
.zones { color: var(--muted); font-size: 11.5px; margin: 2px 0 6px; }
.row { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 4px; }
.c { width: 54px; height: 75px; border-radius: 4px; background: #333 center/cover; position: relative; font-size: 9px; color: #fff; overflow: hidden; transition: transform .2s; }
.c span { position: absolute; inset: auto 2px 2px 2px; background: rgba(0,0,0,.7); border-radius: 3px; padding: 1px 2px; line-height: 1.15; }
.c.t { transform: rotate(14deg); opacity: .8; }
.c.atk { outline: 2px solid var(--bad); }
.c b { position: absolute; top: 2px; right: 2px; background: var(--good); color: #000; border-radius: 8px; padding: 0 4px; font-size: 10px; }
.c.cmd { outline: 2px solid #f5b74a; }
aside { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 8px; max-height: calc(100vh - 90px); overflow-y: auto; position: sticky; top: 64px; font-size: 12.5px; }
aside div { padding: 2px 0; border-bottom: 1px solid var(--line); }
aside .turn { font-weight: 800; margin-top: 6px; color: var(--pc, var(--text)); }
aside .win { font-weight: 800; color: var(--good); }
.stack { color: var(--muted); font-size: 12px; margin-top: 4px; }
footer { color: var(--muted); font-size: 11.5px; padding: 6px 16px 16px; }
</style>
</head>
<body>
<header>
  <h1>${esc(data.title)}</h1>
  <button id="start" title="Back to the start">⏮</button><button id="prev" title="Step back">◀</button><button id="play">▶ Play</button><button id="next" title="Step forward">▶</button><button id="end" title="To the end">⏭</button>
  <select id="speed" title="Speed"><option value="900">Slow</option><option value="400" selected>Normal</option><option value="120">Fast</option></select>
  <input type="range" id="pos" min="0" value="0"><span class="info" id="info"></span>
</header>
<main><section class="table" id="table"></section><aside id="log"></aside></main>
<footer>A Commander Table replay. Card images load from Scryfall when you're online. ${data.winner != null ? `Winner: ${esc(data.players[data.winner].name)} (${esc(data.reason)}).` : ''}</footer>
<script id="data" type="application/json">${json}</script>
<script>
const D = JSON.parse(document.getElementById('data').textContent);
const $ = id => document.getElementById(id);
const e = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
let i = 0, timer = null;
$('pos').max = D.frames.length - 1;
function card(id, x = {}) {
  const c = D.cards[id] || ['?', ''];
  return '<div class="c' + (x.t ? ' t' : '') + (x.atk ? ' atk' : '') + (x.cmd ? ' cmd' : '') + '" title="' + e(c[0]) + '" style="background-image:url(\\'' + e(c[1]) + '\\')">' + (x.n ? '<b>+' + x.n + '</b>' : '') + '<span>' + e(c[0]) + '</span></div>';
}
function render() {
  const f = D.frames[i];
  $('table').innerHTML = f.p.map((p, k) => {
    const pl = D.players[k];
    const bf = kind => p[6].filter(o => o[4] === kind).map(o => card(o[0], { t: o[1], n: o[2], atk: o[3] })).join('');
    return '<div class="pl' + (f.a === k ? ' active' : '') + (p[7] ? ' lost' : '') + '" style="--pc:' + pl.color + '"><h2><span>' + e(pl.name) + ' <small>' + e(pl.deck) + '</small></span><span class="life">' + p[0] + '</span></h2>'
      + '<div class="zones">Hand ' + p[1] + ' · Library ' + p[2] + ' · Graveyard ' + p[3] + ' · Exile ' + p[4] + (p[8] ? ' · most commander damage taken ' + p[8] : '') + '</div>'
      + '<div class="row">' + p[5].map(id => card(id, { cmd: 1 })).join('') + bf(0) + '</div><div class="row">' + bf(1) + '</div><div class="row">' + bf(2) + '</div></div>';
  }).join('');
  $('pos').value = i;
  $('info').textContent = 'Turn ' + f.t + ' · round ' + f.r + ' · ' + (D.players[f.a] ? D.players[f.a].name : '') + ' · ' + f.ph + ' · step ' + (i + 1) + ' of ' + D.frames.length + (f.st.length ? ' · stack: ' + f.st.map(s => s[0]).join(', ') : '');
  const lines = D.log.slice(Math.max(0, f.l - 250), f.l);
  $('log').innerHTML = lines.map(l => '<div class="' + (l[1] === 'turn' ? 'turn' : l[1] === 'win' ? 'win' : '') + '"' + (l[2] >= 0 && D.players[l[2]] ? ' style="--pc:' + D.players[l[2]].color + '"' : '') + '>' + e(l[0]) + '</div>').join('');
  $('log').scrollTop = $('log').scrollHeight;
}
function go(n) { i = Math.max(0, Math.min(D.frames.length - 1, n)); render(); if (i >= D.frames.length - 1) stop(); }
function stop() { clearInterval(timer); timer = null; $('play').textContent = '▶ Play'; }
$('play').onclick = () => { if (timer) return stop(); if (i >= D.frames.length - 1) i = 0; timer = setInterval(() => go(i + 1), +$('speed').value); $('play').textContent = '⏸ Pause'; };
$('speed').onchange = () => { if (timer) { stop(); $('play').click(); } };
$('prev').onclick = () => go(i - 1); $('next').onclick = () => go(i + 1);
$('start').onclick = () => go(0); $('end').onclick = () => go(D.frames.length - 1);
$('pos').oninput = () => go(+$('pos').value);
document.addEventListener('keydown', ev => { if (ev.key === 'ArrowRight') go(i + 1); else if (ev.key === 'ArrowLeft') go(i - 1); else if (ev.key === ' ') { ev.preventDefault(); $('play').click(); } });
render();
</script>
</body>
</html>`;
}
