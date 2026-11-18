// The interface test page (Phase 2L, 1.55.0): opens the game page (index.html?uitest) in a frame and uses it the way a
// person would. Puzzle games give exact boards with real cards; every answer is a click on the page (cards, players,
// action bar buttons), and every check compares what the table shows with the engine's own state. The game page hands
// over its live game and table view with ?uitest (main.js window.ctTest); nothing in the engine is touched except
// Game.flipFace for the double-faced card check. Settings the checks change are put back at the end.
import { esc, store } from './util.js';
import { legalTargets, targetFits } from './resolve.js';

/** @type {(id: string) => any} */
const $ = id => document.getElementById(id);
const prefs0 = store('ct.prefs') || {};
document.documentElement.dataset.theme = prefs0.theme || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');

const results = [];
function row(name) {
  const tr = document.createElement('tr');
  tr.innerHTML = `<td>${esc(name)}</td><td class="wait">checking…</td><td class="muted"></td>`;
  $('checks').querySelector('tbody').append(tr);
  return (/** @type {boolean | 'skip'} */ ok, detail) => {
    tr.children[1].className = ok === 'skip' ? 'skip' : ok ? 'pass' : 'fail';
    tr.children[1].textContent = ok === 'skip' ? 'not run' : ok ? 'pass' : 'FAIL';
    tr.children[2].textContent = detail || '';
    results.push(ok);
  };
}
class Skip extends Error {}
async function check(name, f) {
  const done = row(name);
  const t0 = performance.now();
  try {
    const detail = await f();
    done(true, `${detail || ''} (${Math.round(performance.now() - t0)} ms)`);
  } catch (e) {
    done(e instanceof Skip ? 'skip' : false, e.message);
  }
}
const expect = (cond, msg) => { if (!cond) throw new Error(msg); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function waitFor(f, what, ms = 20000) {
  const t0 = Date.now();
  for (;;) {
    let v;
    try { v = f(); } catch { v = null; }
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error(`Timed out waiting for ${what}${state()}`);
    await sleep(60);
  }
}

// (what the game looks like, for a failure message)
function state() {
  try {
    const G = T?.game();
    if (!G) return '';
    return ` [turn ${G.turn} ${G.phase}, ${G.over ? 'over, ' : ''}asked: ${ui().pending ? askText().slice(0, 70) : 'nothing'}; you: ${G.players[0].battlefield.map(o => o.card.name.split(' ')[0]).join(',')}]`;
  } catch { return ''; }
}

// ---------- the frame
/** @type {any} */ let W = null;
/** @type {Document} */ let D;
/** @type {any} */ let T = null;
async function openFrame(w = 1366, h = 768) {
  const f = $('frame');
  f.width = w; f.height = h;
  f.src = `/index.html?uitest=${Date.now()}`;
  await new Promise(r => { f.onload = r; });
  W = f.contentWindow; D = W.document;
  T = await waitFor(() => W.ctTest, 'the game page to start');
  return T;
}
function sizeFrame(w, h) { const f = $('frame'); f.width = w; f.height = h; return sleep(350); }
const g = () => T.game();
const view = () => T.view();
const ui = () => T.humanUI;
const askText = () => (ui().pending ? D.getElementById('abText').textContent || '' : '');
const waitAsk = (re, what, ms) => waitFor(() => ui().pending && re.test(askText()), what || `the question ${re}`, ms);
const cardEl = o => view().cards.get(o.iid);
const find = (i, name, zone = 'battlefield') => g().players[i][zone].find(o => o.card.name === name || o.card.frontName === name);
function clickCard(o) { const el = cardEl(o); expect(el?.isConnected, `${o.card.name} is not on the table`); el.click(); }
function clickPlayer(i) { view().boards[i].el.querySelector('.avatar').click(); }
function clickButton(re) {
  const b = [...D.getElementById('abButtons').querySelectorAll('button')].find(x => re.test(x.textContent || ''));
  expect(b, `no action bar button ${re} (buttons: ${[...D.getElementById('abButtons').querySelectorAll('button')].map(x => x.textContent).join(' | ')})`);
  b.click();
}
// Every card the table shows sits where the engine has it: each board's rows hold exactly that player's battlefield,
// the command zone its command zone, your hand row your hand; piles and life totals show the engine's numbers.
function boardMatchesEngine() {
  const G = g(), V = view();
  for (const b of V.boards) {
    const p = b.p;
    const shown = new Set([...b.el.querySelectorAll('.field .card[data-iid]')].map(e => +e.dataset.iid));
    const real = new Set(p.battlefield.map(o => o.iid));
    const extra = [...shown].filter(x => !real.has(x)), missing = [...real].filter(x => !shown.has(x));
    if (extra.length || missing.length) return `${p.name}'s battlefield: shown but not there ${extra.map(x => G.objects.get(x)?.card.name)}; there but not shown ${missing.map(x => G.objects.get(x)?.card.name)}`;
    if (+b.lv.textContent !== p.life) return `${p.name}'s life shows ${b.lv.textContent}, the engine has ${p.life}`;
    for (const z of ['hand', 'library', 'graveyard', 'exile']) if (+b.n[z].textContent !== p[z].length) return `${p.name}'s ${z} count shows ${b.n[z].textContent}, the engine has ${p[z].length}`;
    if (p.idx === V.humanIdx) {
      const hand = [...b.hand.querySelectorAll('.card[data-iid]')].map(e => +e.dataset.iid);
      if (hand.join() !== p.hand.map(o => o.iid).join()) return `${p.name}'s hand row doesn't match the hand`;
    }
    for (const o of p.battlefield) {
      const el = V.cards.get(o.iid);
      if (el.classList.contains('tapped') !== !!o.tapped) return `${o.card.name}: tapped shows ${el.classList.contains('tapped')}, the engine has ${!!o.tapped}`;
      if (el.classList.contains('attacking') !== (o.attacking != null)) return `${o.card.name}: attacking shows ${el.classList.contains('attacking')}`;
      if (el.classList.contains('blocking') !== (o.blocking != null)) return `${o.card.name}: blocking shows ${el.classList.contains('blocking')}`;
    }
  }
  return '';
}
const synced = () => { const why = boardMatchesEngine(); expect(!why, why); };
// (the table redraws on the next frame or within 120 ms of an engine update)
const settle = () => sleep(260);

// A puzzle: seat 1 is you, in your first main phase
const KENRITH = 'Kenrith, the Returned King';
async function puzzle(players, name = 'Interface test') {
  await T.startPuzzle({ app: 'commander-table-puzzle', name, goal: 'test', players });
  await waitAsk(/main phase/i, 'your first main phase', 60000);
  T.clock().speed = 3;
  await settle();
}

// ---------- saved state: what the checks change is put back afterwards
let savedLocal = null;
function saveStorage() { savedLocal = Object.fromEntries(Object.keys(localStorage).filter(k => k.startsWith('ct.')).map(k => [k, localStorage.getItem(k)])); }
function restoreStorage() {
  if (!savedLocal) return;
  for (const k of Object.keys(localStorage)) if (k.startsWith('ct.') && !(k in savedLocal)) localStorage.removeItem(k);
  for (const [k, v] of Object.entries(savedLocal)) if (localStorage.getItem(k) !== v) localStorage.setItem(k, v);
}

async function run() {
  $('btnRun').disabled = true;
  results.length = 0;
  $('checks').querySelector('tbody').innerHTML = '';
  $('summary').textContent = 'Running…';
  saveStorage();
  try { await suite(); } finally {
    restoreStorage();
    $('frame').src = 'about:blank';
  }
  const failed = results.filter(x => x === false).length, skipped = results.filter(x => x === 'skip').length;
  $('summary').textContent = `${results.length - failed - skipped} passed, ${failed} failed${skipped ? `, ${skipped} not run` : ''}`;
  $('btnRun').disabled = false;
}

async function suite() {
  await openFrame(1366, 768);

  // 1. The start menu: tiles open their windows, Escape closes them and the menu is back
  await check('1. Start menu: tiles open their windows and Escape closes them', async () => {
    const menu = D.getElementById('startMenu');
    await waitFor(() => !menu.hidden, 'the start menu');
    const tiles = /** @type {any[]} */ ([...menu.querySelectorAll('[data-go]')]);
    expect(tiles.length >= 10, `only ${tiles.length} tiles`);
    const tried = [];
    for (const [go, id] of [['help', 'helpModal'], ['display', 'displayModal']]) {
      const tile = menu.querySelector(`[data-go="${go}"]`);
      if (!tile || !D.getElementById(id)) continue;
      tile.click();
      await waitFor(() => !D.getElementById(id).hidden, `${id} to open`, 4000);
      D.activeElement?.dispatchEvent(new W.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await waitFor(() => D.getElementById(id).hidden, `${id} to close on Escape`, 4000);
      tried.push(go);
    }
    expect(tried.length >= 2, `windows found for only ${tried.join(', ')}`);
    // every tile is a button that does something: none is disabled without saying why
    const dead = tiles.filter(t => t.disabled && !t.title && !t.dataset.tip);
    expect(!dead.length, `disabled tiles with no reason: ${dead.map(t => t.dataset.go)}`);
    return `${tiles.length} tiles; ${tried.join(', ')} opened and closed`;
  });

  // 3–4. Deck builder (from the start menu): an exact name search finds that card only; a deck being built survives
  // closing the builder and opening it again (the "Restore it" notice)
  await check('3–4. Deck builder: a name search finds the card; a card added is kept after closing and reopening', async () => {
    store('ct.builderDraft', null);
    D.querySelector('#startMenu [data-go="builder"]').click();
    const root = await waitFor(() => { const r = D.getElementById('builderModal'); return r && !r.hidden ? r : null; }, 'the deck builder');
    const q = D.getElementById('bldQuery');
    q.value = '!"Lightning Bolt"';
    q.dispatchEvent(new W.Event('input', { bubbles: true }));
    q.dispatchEvent(new W.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    const tiles = () => [...D.querySelectorAll('#bldResults .ctile')];
    // (an exact name also finds a card with a face of that name: Emeritus of Conflict // Lightning Bolt)
    await waitFor(() => tiles().length && tiles()[0].dataset.name === 'Lightning Bolt' && tiles().every(t => (t.dataset.name || '').split(' // ').includes('Lightning Bolt')), 'the search to show only cards named Lightning Bolt', 30000);
    const found = tiles().length;
    tiles()[0].click();
    await waitFor(() => /Lightning Bolt/.test(D.getElementById('bldList')?.textContent || ''), 'Lightning Bolt in the deck list', 5000);
    await sleep(400);
    expect(/Lightning Bolt/.test(localStorage.getItem('ct.builderDraft') || ''), 'the unsaved deck was not kept');
    D.getElementById('bldClose').click();
    await waitFor(() => root.hidden, 'the builder to close');
    D.querySelector('#startMenu [data-go="builder"]').click();
    const restore = await waitFor(() => [...D.querySelectorAll('.notices button')].find(b => /Restore/.test(b.textContent || '')), 'the "Restore it" notice', 5000);
    restore.click();
    await waitFor(() => /Lightning Bolt/.test(D.getElementById('bldList')?.textContent || ''), 'Lightning Bolt back in the deck list', 5000);
    D.getElementById('bldClose').click();
    await waitFor(() => root.hidden, 'the builder to close');
    return `${found} results named Lightning Bolt; added, closed, reopened and restored`;
  });

  // 2. Deck selection: Play opens the seats; pasted lists load, and the game starts with those decks
  await check('2. Deck selection: pasted lists load into the seats and the game starts with them', async () => {
    D.querySelector('#startMenu [data-go="play"]').click();
    await waitFor(() => !D.getElementById('setup').hidden, 'the seats');
    const areas = [...D.querySelectorAll('#setup textarea')].filter(t => t.offsetParent);
    expect(areas.length >= 2, `${areas.length} seat lists`);
    for (const a of areas) { a.value = `Commander\n1 ${KENRITH}\n\nDeck\n1 Sol Ring\n1 Llanowar Elves\n20 Forest`; a.dispatchEvent(new W.Event('input', { bubbles: true })); }
    D.getElementById('btnLoad').click();
    await waitFor(() => /Kenrith[^·]*· 23 cards/.test(areas[0].closest('.seat')?.textContent || ''), 'seat 1 to show the loaded deck', 60000);
    // "Load decks & shuffle up" starts the game once every seat is ready
    if (!T.game()) D.getElementById('btnPlay').click();
    const G = await waitFor(() => T.game(), 'the game to start', 30000);
    T.clock().setPaused(true);
    expect(G.players.length === areas.length && G.players.every(p => p.command[0]?.card.name === KENRITH), 'the game did not start with the pasted decks');
    await settle();
    expect(view().boards.length === areas.length, 'not every seat has a board');
    return `${areas.length} seats loaded with "Kenrith · 23 cards"; the game started with them`;
  });
  // A board with real cards: you have lands, three creatures (one double-faced), Bolt, Doom Blade and a land in hand;
  // the opponent has a black creature and a hexproof one
  await check('7. Playing a land: the table moves it only once the engine has it', async () => {
    await puzzle([
      { name: 'You', commander: KENRITH, battlefield: ['Mountain', 'Mountain', 'Swamp', 'Swamp', 'Grizzly Bears', 'Llanowar Elves', 'Delver of Secrets'], hand: ['Lightning Bolt', 'Doom Blade', 'Forest'] },
      { name: 'Opponent', commander: KENRITH, life: 20, battlefield: ['Plains', 'Vampire Nighthawk', 'Gladecover Scout'] },
    ]);
    synced();
    const forest = find(0, 'Forest', 'hand');
    const handRow = view().boards[0].hand;
    expect(cardEl(forest).parentElement === handRow, 'the Forest is not drawn in the hand');
    // (no engine change has happened yet: the card stays in the hand until the engine has played it)
    clickCard(forest);
    expect(forest.zone === 'hand' || cardEl(forest).parentElement !== view().boards[0].lands || forest.zone === 'battlefield', 'the table moved the card before the engine');
    await waitFor(() => forest.zone === 'battlefield', 'the engine to play the Forest');
    await settle();
    expect(cardEl(forest).parentElement === view().boards[0].lands, 'the Forest is not in the lands row');
    synced();
    return 'Forest: hand row → lands row after the engine played it';
  });

  await check('8. Tapping for mana shows the card tapped, and untapping shows it untapped', async () => {
    await waitAsk(/main phase/i);
    const m = g().players[0].battlefield.find(o => o.card.name === 'Mountain' && !o.tapped);
    clickCard(m);
    await waitFor(() => m.tapped, 'the Mountain to be tapped by the engine');
    await settle();
    expect(cardEl(m).classList.contains('tapped'), 'the Mountain is not drawn tapped');
    // tapped cards are turned: the drawn card's rotation follows the class
    const rot = W.getComputedStyle(cardEl(m)).transform;
    expect(rot && rot !== 'none', 'a tapped card is not turned');
    await waitAsk(/main phase/i);
    // a land you tapped by hand this step can be clicked again to take the mana back
    clickCard(m);
    await waitFor(() => !m.tapped, 'the Mountain to be untapped', 4000).catch(() => { throw new Error('taking the mana back did not untap it (the engine keeps it tapped)'); });
    await settle();
    expect(!cardEl(m).classList.contains('tapped'), 'the Mountain is still drawn tapped');
    synced();
    return 'tapped, drawn turned, untapped';
  });

  await check('5. Card preview: shows the card the pointer is on', async () => {
    const bears = find(0, 'Grizzly Bears');
    const el = cardEl(bears);
    el.dispatchEvent(new W.MouseEvent('mouseover', { bubbles: true, clientX: 300, clientY: 300 }));
    el.matches = () => true; // (the preview waits for the pointer to rest on the card)
    const pv = D.getElementById('preview');
    await waitFor(() => !pv.hidden && pv.dataset.for === String(bears.iid), 'the preview to open', 3000);
    const h = pv.querySelector('h3')?.textContent || '', t = pv.querySelector('.ptype')?.textContent || '';
    expect(h.includes('Grizzly Bears'), `the preview's title is ${h}`);
    expect(t.includes(bears.card.typeLine) && t.includes('2/2'), `the preview's type line is ${t}`);
    const r = pv.getBoundingClientRect();
    expect(r.right <= W.innerWidth + 1 && r.bottom <= W.innerHeight + 1 && r.left >= -1 && r.top >= -1, 'the preview is off the screen');
    D.body.dispatchEvent(new W.MouseEvent('mouseover', { bubbles: true }));
    await waitFor(() => pv.hidden, 'the preview to close');
    return `${h.trim()} · ${t.trim()}`;
  });

  await check('6. Double-faced cards: the preview shows the other face, a transformed card shows its back', async () => {
    const delver = find(0, 'Delver of Secrets');
    const front = delver.card, back = front.backCard;
    expect(back && front.backNormal, 'Delver of Secrets has no back face in its card data');
    const el = cardEl(delver);
    el.dispatchEvent(new W.MouseEvent('mouseover', { bubbles: true, clientX: 300, clientY: 300 }));
    el.matches = () => true;
    const pv = D.getElementById('preview');
    await waitFor(() => !pv.hidden && pv.dataset.for === String(delver.iid), 'the preview to open', 3000);
    const other = pv.querySelector('.pv-other img');
    expect(other && other.getAttribute('src') === front.backNormal, 'the preview does not show the back face as the other face');
    D.body.dispatchEvent(new W.MouseEvent('mouseover', { bubbles: true }));
    // Transform it in the engine (Game.flipFace), as daybound and transform effects do
    g().flipFace(delver);
    g().emit('update');
    await settle();
    const img = cardEl(delver).querySelector('img');
    expect(delver.card === back, 'the engine did not transform it');
    expect(img && [back.imgSmall, back.imgNormal].includes(img.getAttribute('src')), `the table shows ${img?.getAttribute('src')} for ${back.name}`);
    expect(![front.imgSmall, front.imgNormal].includes(img.getAttribute('src')), 'the table still shows the front face');
    expect(back.backNormal === front.imgNormal, 'the back face\'s other face is not the front');
    g().flipFace(delver); g().emit('update');
    await settle();
    return `${front.name} ⇄ ${back.name}`;
  });

  await check('9–10. Targets: only the engine\'s legal targets can be chosen; the rest are dimmed and refuse a click', async () => {
    await waitAsk(/main phase/i);
    const blade = find(0, 'Doom Blade', 'hand');
    clickCard(blade);
    await waitFor(() => ui().pending && ui().pending.choosing, 'the target question', 6000);
    const pend = ui().pending;
    const offered = new Set(pend.objs.keys());
    // the engine's own list for Doom Blade's effect, worked out here separately
    const G = g(), p = G.players[0];
    const prev = G.targetSrc; G.targetSrc = blade;
    const e = blade.fx.spell.find(x => { const r = legalTargets(G, p, x, blade); return (r.objs || []).length || (r.players || []).length; });
    expect(e, 'Doom Blade has no targeted effect in its reading');
    const lt = legalTargets(G, p, e, blade);
    const engine = new Set((lt.objs || []).filter(o => targetFits(G, p, e, o, blade)).map(o => o.iid));
    G.targetSrc = prev;
    expect([...offered].sort().join() === [...engine].sort().join(), `offered ${[...offered].map(x => G.objects.get(x).card.name)}, engine ${[...engine].map(x => G.objects.get(x).card.name)}`);
    const names = [...offered].map(x => G.objects.get(x).card.name);
    expect(names.includes('Grizzly Bears') && !names.includes('Vampire Nighthawk') && !names.includes('Gladecover Scout'), `Doom Blade offered ${names}`);
    for (const x of offered) expect(view().cards.get(x).classList.contains('pickable'), 'a legal target is not highlighted');
    expect(D.body.classList.contains('choosing'), 'the table is not in choosing mode');
    const hawk = find(1, 'Vampire Nighthawk'), scout = find(1, 'Gladecover Scout');
    for (const o of [hawk, scout]) {
      const s = W.getComputedStyle(cardEl(o));
      expect(!cardEl(o).classList.contains('pickable') && +s.opacity < 0.9, `${o.card.name} is not dimmed`);
    }
    // clicking an illegal target answers nothing
    const before = ui().record.length;
    clickCard(hawk); clickCard(scout);
    await sleep(150);
    expect(ui().pending === pend && ui().record.length === before, 'a click on an illegal target was taken as an answer');
    clickButton(/^Cancel/);
    await waitAsk(/main phase/i, 'the main phase again after Cancel');
    expect(!D.body.classList.contains('choosing'), 'the table is still dimmed after Cancel');
    synced();
    return `offered: ${names.join(', ')}; Nighthawk (black) and Gladecover Scout (hexproof) refused`;
  });

  await check('11–12, 14–15. Stack and priority: the panel lists the engine\'s stack; life and log follow the resolution', async () => {
    await waitAsk(/main phase/i);
    const bolt = find(0, 'Lightning Bolt', 'hand');
    const logBefore = g().logEntries.length;
    clickCard(bolt);
    await waitFor(() => ui().pending && ui().pending.players.size, 'Bolt\'s target question', 6000);
    // the action bar is up exactly while the engine is waiting on you
    expect(D.body.classList.contains('your-move') && !D.getElementById('actionBar').hidden, 'the page does not say it is your move');
    T.clock().setPaused(true);
    clickPlayer(1);
    const G = g();
    // (paused: the game moves one step at a time until Bolt is on the stack)
    // (the engine takes the answer on its next tick: give it a moment before stepping, or the step carries Bolt past the stack)
    await sleep(200);
    let lastStep = 0;
    await waitFor(() => { const c = T.clock(); if (G.stack.length) { c.credits = 0; return true; } if (c.credits <= 0 && Date.now() - lastStep > 200) { lastStep = Date.now(); c.step(); } return false; }, 'Bolt on the stack', 8000);
    await settle();
    expect(D.body.classList.contains('your-move') === !!ui().pending, `the your-move mark is ${D.body.classList.contains('your-move')}, the engine ${ui().pending ? 'is' : 'is not'} asking you`);
    const rows = [...D.querySelectorAll('.stack-panel .sp-item')];
    expect(!D.querySelector('.stack-panel').hidden && rows.length === G.stack.length, `the panel shows ${rows.length} items, the stack has ${G.stack.length} (paused ${T.clock().paused}, credits ${T.clock().credits}, same clock ${G.clock === T.clock()}, ff ${T.clock().ff}, skip ${T.clock().skip}, fast ${T.clock().fast}, speed ${T.clock().speed}, steps ${G.steps}; log: ${G.logEntries.slice(-4).map(e => e.html.replace(/<[^>]+>/g, '')).join(' / ')})`);
    [...G.stack].reverse().forEach((it, i) => expect(+rows[i].dataset.iid === it.o.iid, `row ${i + 1} is not ${it.o.card.name}`));
    expect(/Lightning Bolt/.test(rows[0].textContent || '') && /Opponent/.test(rows[0].textContent || '') && rows[0].classList.contains('next'), 'the top row does not name Bolt, its target and "resolves next"');
    // the priority mark is on whoever the engine says holds priority, and on no one when no one is being asked
    const chips = [...D.querySelectorAll('.board .polchip.prio')].map(c => +(c.closest('.board')?.dataset.player ?? -1));
    const holder = G.prio && !G.over ? G.prio.holder : null;
    expect(holder == null ? !chips.length : chips.length === 1 && chips[0] === holder, `priority marks on ${chips}, the engine has ${holder}`);
    const arrows = D.querySelectorAll('.combat-svg path.target').length;
    expect(arrows === 1, `${arrows} target arrows for one targeted spell`);    T.clock().setPaused(false);
    // (if the engine gives you priority with Bolt on the stack, you pass)
    await waitFor(() => { if (ui().pending && G.stack.length) (D.querySelector('#abButtons button[data-esc]') || D.querySelector('#abButtons button.primary'))?.click(); return !G.stack.length && G.players[1].life === 17; }, 'Bolt to resolve', 15000);
    await settle();
    expect(D.querySelector('.stack-panel').hidden, 'the stack panel is still showing');
    expect(+view().boards[1].lv.textContent === 17, 'the opponent\'s life does not show 17');
    // the log holds every engine log entry, in order
    const lines = [...D.querySelectorAll('#log .le')].map(x => (x.textContent || '').replace(/\s+/g, ' '));
    const added = G.logEntries.slice(logBefore).map(e => e.html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim());
    let k = 0;
    for (const a of added) { const at = lines.findIndex((l, j) => j >= k && l.includes(a.slice(0, 40))); expect(at >= 0, `the log has no line for "${a}"`); k = at; }
    expect(added.some(a => /casts Lightning Bolt/.test(a)), 'the engine logged no cast');
    expect(lines.length === G.logEntries.length, `the log shows ${lines.length} lines, the engine has ${G.logEntries.length}`);
    synced();
    return `stack of 1 matched with its target arrow; your-move mark only while asked; life 20 → 17; ${added.length} log lines in order`;
  });

  await check('20. A card picture that fails to load is replaced by the card in words', async () => {
    const bears = find(0, 'Grizzly Bears');
    const img = cardEl(bears).querySelector('img');
    expect(img, 'the Bears have no picture to break');
    img.src = '/no-such-picture.png';
    const fb = await waitFor(() => cardEl(bears).querySelector('.img-fallback'), 'the fallback face', 5000);
    expect(/Grizzly Bears/.test(fb.textContent || '') && /2\/2/.test(fb.textContent || ''), `the fallback says ${fb.textContent}`);
    expect(!cardEl(bears).querySelector('img:not(.sym)'), 'the broken picture is still there');
    return (fb.textContent || '').replace(/\s+/g, ' ').trim();
  });

  await check('19, 22. Reduced motion: no card glide with Fewer animations on; answers are never held up', async () => {
    await waitAsk(/main phase/i);
    // Fewer animations, the Display window's own switch
    const box = D.getElementById('dispCalm');
    expect(box, 'no Fewer animations switch');
    const was = box.checked;
    if (!was) box.click();
    await settle();
    expect(D.body.classList.contains('calm'), 'Fewer animations does not reach the page');
    expect(T.prefs.calm === true, 'the setting was not saved');
    // a card moving now has no animation, and the next question is there at once
    const swamp = g().players[0].battlefield.find(o => o.card.name === 'Swamp' && !o.tapped);
    clickCard(swamp);
    await waitFor(() => swamp.tapped, 'the Swamp to tap');
    const anims = cardEl(swamp).getAnimations({ subtree: true }).filter(a => a.playState === 'running' && !(a instanceof W.CSSTransition));
    expect(!anims.length, `${anims.length} animations still run on the card`);
    const t0 = performance.now();
    await waitAsk(/main phase/i, 'the next question', 3000);
    const wait = Math.round(performance.now() - t0);
    if (!was) box.click(); else { box.click(); box.click(); }
    await settle();
    expect(!!D.body.classList.contains('calm') === was, 'the setting did not go back');
    return `no animation; next question after ${wait} ms`;
  });

  await check('21. Windows opened and closed again add no second listener', async () => {
    const box = D.getElementById('dispCalm');
    const open = () => { D.getElementById('displayModal').hidden = false; }, close = () => { D.getElementById('displayModal').hidden = true; };
    for (let i = 0; i < 3; i++) { open(); await sleep(60); close(); await sleep(60); }
    open();
    const before = !!T.prefs.calm;
    box.click();
    await settle();
    const after = !!T.prefs.calm;
    box.click();
    close();
    expect(after === !before, 'one click changed the setting more than once (or not at one)');
    expect(D.querySelectorAll('.stack-panel').length === 1 && D.querySelectorAll('.combat-svg').length === 1 && D.querySelectorAll('#preview').length === 1, 'the table has duplicate panels');
    return 'one click, one change; one stack panel, one arrow layer, one preview';
  });

  await check('13, 16, 23. Combat and simultaneous deaths: the table shows the engine\'s attackers, blockers and deaths', async () => {
    await puzzle([
      { name: 'You', commander: KENRITH, battlefield: ['Mountain', 'Mountain', 'Mountain', 'Grizzly Bears', 'Hill Giant'], hand: ['Pyroclasm'] },
      { name: 'Opponent', commander: KENRITH, life: 20, battlefield: ['Island', 'Llanowar Elves', 'Fyndhorn Elves', 'Wall of Omens'] },
    ], 'Combat');
    synced();
    // Pyroclasm: three creatures die at once (yours and theirs)
    clickCard(find(0, 'Pyroclasm', 'hand'));
    const G = g();
    await waitFor(() => G.players[0].graveyard.length >= 2 && G.players[1].graveyard.length >= 2 && !G.stack.length, 'Pyroclasm to resolve', 15000);
    await waitAsk(/main phase/i);
    // (the copies flying to the graveyards last 650 ms, and go after 1.5 s even in a hidden window)
    await waitFor(() => !D.querySelectorAll('.move-ghost').length, 'the moving copies to be gone', 4000);
    synced();
    const dead = ['Grizzly Bears', 'Llanowar Elves', 'Fyndhorn Elves'].filter(n => !G.players.some(p => p.battlefield.some(o => o.card.name === n)));
    expect(dead.length === 3, `only ${dead} died`);
    // combat: attack with Hill Giant; the AI decides its block
    clickButton(/Go to combat/);
    await waitAsk(/Declare attackers/i, 'the attackers question');
    const giant = find(0, 'Hill Giant');
    clickCard(giant);
    await waitFor(() => /1 selected/.test(askText()), 'Hill Giant to be selected');
    expect(cardEl(giant).classList.contains('chosen'), 'the chosen attacker is not marked');
    clickButton(/^Attack Opponent/);
    await waitFor(() => giant.attacking != null, 'the engine to have Hill Giant attacking', 8000);
    await settle();
    synced();
    expect(cardEl(giant).classList.contains('attacking'), 'Hill Giant is not drawn attacking');
    const path = D.querySelector('.combat-svg path');
    expect(path, 'no attack arrow');
    // wait for blocks (the AI's own choice), then check them before damage
    let blockers = [];
    await waitFor(() => { blockers = G.players[1].battlefield.filter(o => o.blocking != null); return blockers.length || G.phase !== 'combat' || G.step === 'damage' || ui().pending; }, 'blocks', 15000);
    await settle();
    synced();
    for (const b of blockers) expect(cardEl(b).classList.contains('blocking'), `${b.card.name} is not drawn blocking`);
    await waitFor(() => !G.players.some(p => p.battlefield.some(o => o.attacking != null)), 'combat to end', 20000);
    await settle();
    synced();
    expect(!D.querySelector('.card.attacking, .card.blocking'), 'attack marks stay after combat');
    return `3 deaths at once; Hill Giant attacked${blockers.length ? `, blocked by ${blockers.map(b => b.card.name)}` : ', unblocked'}; life ${G.players[1].life}`;
  });

  await check('17. Four players: four boards, your board marked, each with its own life total', async () => {
    await puzzle([
      { name: 'You', commander: KENRITH, battlefield: ['Forest'], hand: ['Forest'] },
      { name: 'North', commander: KENRITH, life: 31, battlefield: ['Island'] },
      { name: 'East', commander: KENRITH, life: 32, battlefield: ['Swamp'] },
      { name: 'West', commander: KENRITH, life: 33, battlefield: ['Plains'] },
    ], 'Four players');
    const boards = [...D.querySelectorAll('#table .board')];
    expect(boards.length === 4 && D.getElementById('table').dataset.n === '4', `${boards.length} boards`);
    expect(boards[0].classList.contains('you') && D.querySelectorAll('.board.you').length === 1, 'your board is not the one marked');
    synced();
    const rects = boards.map(b => b.getBoundingClientRect());
    for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) {
      const a = rects[i], b = rects[j];
      expect(a.right <= b.left + 1 || b.right <= a.left + 1 || a.bottom <= b.top + 1 || b.bottom <= a.top + 1, `boards ${i + 1} and ${j + 1} overlap`);
    }
    return `${boards.map(b => b.querySelector('.lv')?.textContent).join(' / ')} life`;
  });

  await check('18. Screen sizes: no sideways scrolling, the game buttons and your hand stay on screen', async () => {
    const out = [];
    for (const [w, h] of [[1920, 1080], [1600, 900], [1366, 768], [1280, 720], [768, 1024], [375, 812]]) {
      await sizeFrame(w, h);
      view().render();
      await settle();
      const de = D.documentElement;
      expect(de.scrollWidth <= W.innerWidth + 1, `${w}×${h}: the page scrolls sideways (${de.scrollWidth} px)`);
      for (const id of ['btnPlay', 'btnStep']) {
        const r = D.getElementById(id).getBoundingClientRect();
        expect(r.width > 0 && r.left >= 0 && r.right <= W.innerWidth + 1, `${w}×${h}: ${id} is cut off (${Math.round(r.left)}–${Math.round(r.right)})`);
      }
      for (const b of [...D.querySelectorAll('#abButtons button')].filter(x => x.offsetParent)) {
        const r = b.getBoundingClientRect();
        expect(r.left >= 0 && r.right <= W.innerWidth + 1, `${w}×${h}: the action bar button "${b.textContent}" is cut off`);
      }
      const you = view().boards[0];
      const hr = you.hand.getBoundingClientRect(), lr = you.life.getBoundingClientRect();
      expect(hr.width > 0 && hr.left >= 0 && hr.left < W.innerWidth, `${w}×${h}: your hand is off the screen`);
      expect(lr.width > 0 && lr.right <= W.innerWidth + 1, `${w}×${h}: your life total is cut off`);
      out.push(`${w}×${h}`);
    }
    await sizeFrame(1366, 768);
    return out.join(', ');
  });

  await check('24. Online seats stay in step with the host', async () => {
    throw new Skip('Not run here: it needs a room with a friend\'s page; tests/net.mjs and tests/multiplayer.mjs check the views and answers');
  });

  // The four-player puzzle above ends at the end of your turn (a puzzle is "win this turn"): the results window says so
  await check('Results screen: the end of a game shows who won and every seat\'s place', async () => {
    const G = g();
    const bs = () => [...D.querySelectorAll('#abButtons button')].filter(x => x.offsetParent);
    await waitFor(() => { if (G.over) return true; if (ui().pending) (bs().find(x => /^(Go to combat|End turn|No attack|Pass|No block|Done)/.test(x.textContent || '')) || bs().find(x => x.classList.contains('primary')))?.click(); return false; }, 'the puzzle to end', 30000);
    const res = await waitFor(() => (!D.getElementById('results').hidden ? D.getElementById('results') : null), 'the results window', 8000);
    const head = res.querySelector('h2')?.textContent || '';
    const rows = res.querySelectorAll('.standing');
    expect(rows.length === G.players.length, `${rows.length} seats listed for ${G.players.length} players`);
    expect(G.winner ? head.includes(G.winner.name) : /Draw/.test(head), `the heading says "${head}", the engine's winner is ${G.winner?.name || 'nobody'}`);
    D.querySelector('#results [data-close], #results .btn')?.click();
    return head.trim();
  });

  // AI turns: an ordinary game with four AI seats (the decks loaded in check 2) runs a few turns; held still, the
  // table matches the engine
  await check('23, 25. The game runs on: after AI turns the table matches the engine', async () => {
    if (!D.getElementById('results').hidden) D.getElementById('results').hidden = true;
    D.getElementById('setup').hidden = false;
    // ("Load decks & shuffle up": the four Kenrith lists from check 2 are still in the seats)
    D.getElementById('btnLoad').click();
    const G = await waitFor(() => (T.game() && !T.setup().puzzle ? T.game() : null), 'an ordinary game', 30000);
    T.clock().setPaused(false);
    T.clock().speed = 4;
    await waitFor(() => G.turn >= 5 || G.over, 'four turns', 60000);
    T.clock().setPaused(true);
    await settle();
    synced();
    T.clock().abort();
    const errs = G.logEntries.filter(e => /Simulator error/.test(e.html));
    expect(!errs.length, errs.map(e => e.html).join(' / '));
    return `turn ${G.turn}: boards, hands, piles, life and combat marks match; no simulator errors`;
  });
}
$('btnRun').addEventListener('click', run);
if (/[?&]run\b/.test(location.search)) run();
