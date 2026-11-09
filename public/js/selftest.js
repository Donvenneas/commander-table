// The self-test page: every server endpoint and outside service the game relies on, then 50 games
// at full speed with the built-in cEDH decks. Read-only: nothing is saved, installed or changed.
import { Game } from './engine.js';
import { Agent } from './ai.js';
import { loadDeck } from './decks.js';
import { CEDH_PRESETS } from './presets.js';
import { watchGame } from './invariants.js';
import { esc, store, makeRng } from './util.js';
import { dealRoles } from './kingdoms.js';
import { LOOKAHEAD, laStats } from './lookahead.js';
import { searchCards } from './bulk.js';

/** @type {(id: string) => any} */
const $ = id => document.getElementById(id);
const prefs = store('ct.prefs') || {};
document.documentElement.dataset.theme = prefs.theme || 'dark';

const results = [];
function row(table, name) {
  const tr = document.createElement('tr');
  tr.innerHTML = `<td>${esc(name)}</td><td class="wait">checking…</td><td class="muted"></td>`;
  $(table).querySelector('tbody').append(tr);
  return (ok, detail) => {
    tr.children[1].className = ok ? 'pass' : 'fail';
    tr.children[1].textContent = ok ? 'pass' : 'FAIL';
    tr.children[2].textContent = detail || '';
    results.push(ok);
  };
}
async function check(name, f) {
  const done = row('checks', name);
  const t0 = performance.now();
  try {
    const detail = await f();
    done(true, `${detail || ''} (${Math.round(performance.now() - t0)} ms)`);
  } catch (e) {
    done(false, e.message);
  }
}
const expect = (cond, msg) => { if (!cond) throw new Error(msg); };
async function get(url, init) {
  const r = await fetch(url, init);
  return { r, text: await r.text() };
}

async function run() {
  $('btnRun').disabled = true;
  results.length = 0;
  $('checks').querySelector('tbody').innerHTML = '';
  $('games').querySelector('tbody').innerHTML = '';
  $('summary').textContent = 'Running…';

  await check('The game files load', async () => {
    const { r, text } = await get('/index.html');
    expect(r.ok && text.includes('Commander Table'), `HTTP ${r.status}`);
    return 'index.html';
  });
  await check('Comprehensive Rules (/api/rules)', async () => {
    const { r, text } = await get('/api/rules');
    expect(r.ok && text.length > 100000, `HTTP ${r.status}, ${text.length} bytes`);
    return `${Math.round(text.length / 1024)} KB, from ${r.headers.get('X-Rules-Source') || 'the cached copy'}`;
  });
  await check('Deck-site proxy refuses other sites (/api/fetch)', async () => {
    const { r } = await get('/api/fetch?url=' + encodeURIComponent('https://example.com/'));
    expect(r.status === 400, `expected 400, got ${r.status}`);
    return 'example.com refused';
  });
  await check('Deck-site proxy reaches Archidekt (/api/fetch)', async () => {
    const { r } = await get('/api/fetch?url=' + encodeURIComponent('https://archidekt.com/api/decks/1/'));
    expect(r.status < 500, `HTTP ${r.status}`);
    return `HTTP ${r.status}`;
  });
  await check('EDHTop16 tournament data (/api/edhtop16)', async () => {
    const body = JSON.stringify({ query: null, variables: { timePeriod: 'ONE_MONTH', sortBy: 'POPULARITY', minEntries: 0, minSize: 32, colorId: '', count: 1 }, extensions: { 'pastoria-id': 'adb86c7711e577a33ffd053410380b2b' } });
    const { r, text } = await get('/api/edhtop16', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    const j = JSON.parse(text);
    expect(r.ok && j.data?.commanders, `HTTP ${r.status}`);
    return `top commander: ${j.data.commanders.edges[0]?.node.name || '(none)'}`;
  });
  await check('Card image cache (/api/img)', async () => {
    const { r } = await get('/api/img?u=' + encodeURIComponent('https://svgs.scryfall.io/card-symbols/W.svg'));
    expect(r.ok && /image/.test(r.headers.get('Content-Type') || ''), `HTTP ${r.status}`);
    return 'mana symbol served';
  });
  await check('Deck library (/api/library)', async () => {
    const { r, text } = await get('/api/library');
    expect(r.ok && Array.isArray(JSON.parse(text)), `HTTP ${r.status}`);
    const { r: w } = await get('/api/library?name=selftest', { method: 'POST', body: 'x' });
    expect(w.status === 400, 'a save without the app header should be refused');
    return `${JSON.parse(text).length} saved decks; unauthorised writes refused`;
  });
  await check('Updates (/api/update)', async () => {
    const { r, text } = await get('/api/update');
    expect(r.ok, `HTTP ${r.status}`);
    return `version ${JSON.parse(text).version}`;
  });
  await check('Online seats (/api/room/status)', async () => {
    const { r, text } = await get('/api/room/status');
    expect(r.ok, `HTTP ${r.status}`);
    JSON.parse(text);
    return 'room service answers';
  });
  await check('Scryfall (card data)', async () => {
    const r = await fetch('https://api.scryfall.com/cards/named?exact=Sol%20Ring');
    expect(r.ok, `HTTP ${r.status}`);
    return 'reachable';
  });
  await check('Commander Spellbook (combos)', async () => {
    const r = await fetch('https://backend.commanderspellbook.com/find-my-combos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ commanders: [], main: [{ card: 'Sol Ring' }] }) });
    expect(r.ok, `HTTP ${r.status}`);
    return 'reachable';
  });
  await check('Local card search (Scryfall card file syntax)', async () => {
    const L = { commander: 'legal', standard: 'not_legal' };
    const cards = [
      { name: 'Alpha Lord', type_line: 'Legendary Creature — Elf', color_identity: ['G'], colors: ['G'], rarity: 'mythic', cmc: 3, legalities: L, games: ['paper'], edhrec_rank: 5, oracle_text: 'Search your library for a land card.', produced_mana: [] },
      { name: 'Bolt', type_line: 'Instant', color_identity: ['R'], colors: ['R'], rarity: 'common', cmc: 1, legalities: L, games: ['paper', 'mtgo'], edhrec_rank: 2, oracle_text: 'Deal 3 damage.' },
      { name: 'Grove', type_line: 'Land', color_identity: ['G', 'R'], colors: [], rarity: 'rare', cmc: 0, legalities: L, games: ['paper'], edhrec_rank: 9, produced_mana: ['G', 'R'] },
      { name: 'Online Thing', type_line: 'Sorcery', color_identity: [], colors: [], rarity: 'uncommon', cmc: 2, legalities: {}, games: ['arena'], digital: true, game_changer: true },
    ];
    const names = (q, o) => searchCards(cards, q, o).map(c => c.name).join(',');
    const cases = [
      ['legal:commander game:paper id<=gr -t:land', 'edhrec', 'Bolt,Alpha Lord'],
      ['t:land -t:basic produces:g produces:r', 'name', 'Grove'],
      ['is:commander t:creature', 'name', 'Alpha Lord'],
      ['(t:instant or t:sorcery) -is:gamechanger', 'name', 'Bolt'],
      ['-(o:"search your library for a" -o:land) r<=uncommon', 'name', 'Bolt,Online Thing'],
      ['c<=r (c:r) mv=1', 'name', 'Bolt'],
      ['lord', 'name', 'Alpha Lord'],
    ];
    for (const [q, o, want] of cases) expect(names(q, o) === want, `"${q}" gave ${names(q, o) || 'nothing'}, expected ${want}`);
    let unsupported = false;
    try { searchCards(cards, 'e:blb is:booster'); } catch { unsupported = true; }
    expect(unsupported, 'set searches should go to Scryfall');
    return `${cases.length} searches; set searches left to Scryfall`;
  });

  // Games
  const load = row('games', 'Load the four built-in cEDH decks');
  let decks;
  try {
    decks = [];
    for (const p of CEDH_PRESETS) decks.push(await loadDeck(p.list, () => {}));
    load(decks.every(d => d.commanders.length + d.cards.reduce((a, c) => a + c.qty, 0) === 100), decks.map(d => d.deckName).join(', '));
  } catch (e) { load(false, e.message); }
  if (decks) {
    const play = row('games', '50 games at full speed');
    const t0 = performance.now();
    let errors = 0, winners = 0, rounds = 0, combos = 0;
    const styles = ['cedh', 'combo', 'balanced', 'aggressive', 'defensive'];
    for (let i = 0; i < 50; i++) {
      const g = new Game([0, 1, 2, 3].map(k => { const d = decks[(i + k) % 4]; return { playerName: `P${k + 1}`, deckName: d.deckName, color: '#888', agent: new Agent(styles[(i + k) % 5]), commanders: d.commanders, cards: d.cards }; }), { beat: async () => {} }, { seed: 900000 + i, noLearning: true });
      await g.run();
      errors += g.logEntries.filter(e => /Simulator error/.test(e.html)).length;
      if (g.winner) winners++;
      rounds += g.round;
      combos += g.comboLog.filter(c => c.landed).length;
      play.lastI = i;
      if (i % 10 === 9) await new Promise(r => setTimeout(r, 0));
    }
    play(errors === 0, `${errors} simulator errors, ${winners}/50 with a winner, ${(rounds / 50).toFixed(1)} rounds on average, ${combos} combos landed, ${((performance.now() - t0) / 1000).toFixed(1)} s`);

    // Rules check (invariants.js): 20 more games watched step by step for broken card interactions
    // (a card in two zones, a creature that should have died, an aura attached to nothing…)
    const rules = row('games', 'Rules check (20 games watched step by step)');
    const found = new Map();
    for (let i = 0; i < 20; i++) {
      const g = new Game([0, 1, 2, 3].map(k => { const d = decks[(i + k) % 4]; return { playerName: `P${k + 1}`, deckName: d.deckName, color: '#888', agent: new Agent(styles[(i + k * 2) % 5]), commanders: d.commanders, cards: d.cards }; }), { beat: async () => {} }, { seed: 910000 + i, noLearning: true });
      for (const [k, v] of watchGame(g)) found.set(k, v);
      await g.run();
      if (i % 5 === 4) await new Promise(r => setTimeout(r, 0));
    }
    const list = [...found.values()];
    rules(!list.length, list.length ? list.slice(0, 3).map(x => `${x.text} (turn ${x.turn})`).join(' · ') + (list.length > 3 ? ` · and ${list.length - 3} more` : '') : 'no rule broken');

    // AI look-ahead (lookahead.js): games with look-ahead seats must have no errors, replay exactly from the same
    // seed, and leave the real game untouched (with alternatives never chosen, the game is the same as without)
    const la = row('games', 'AI look-ahead: 6 games, replayed and checked');
    try {
      const sig = g => g.logEntries.map(e => e.html).join('|');
      const mk = (i, on) => new Game([0, 1, 2, 3].map(k => { const d = decks[(i + k) % 4]; return { playerName: `P${k + 1}`, deckName: d.deckName, color: '#888', agent: new Agent(styles[(i + k) % 5], { lookahead: on(k) }), commanders: d.commanders, cards: d.cards }; }), { beat: async () => {} }, { seed: 930000 + i, noLearning: true });
      const s0 = { ...laStats };
      const t1 = performance.now();
      let errs = 0, same = 0, untouched = 0;
      const seen = new Map();
      for (let i = 0; i < 6; i++) {
        const a = mk(i, k => k % 2 === i % 2);
        for (const [k, v] of watchGame(a)) seen.set(k, v);
        await a.run();
        const b = mk(i, k => k % 2 === i % 2);
        await b.run();
        errs += [a, b].reduce((n, g) => n + g.logEntries.filter(e => /Simulator error/.test(e.html)).length, 0);
        if (sig(a) === sig(b)) same++;
        await new Promise(r => setTimeout(r, 0));
      }
      const ms = performance.now() - t1;
      const margin = LOOKAHEAD.margin;
      LOOKAHEAD.margin = Infinity;
      try {
        for (let i = 0; i < 2; i++) { const a = mk(i, () => true), b = mk(i, () => false); await a.run(); await b.run(); if (sig(a) === sig(b)) untouched++; }
      } finally { LOOKAHEAD.margin = margin; }
      const bad = [...seen.values()];
      const d = laStats.decisions - s0.decisions, c = laStats.changed - s0.changed, e = laStats.errors - s0.errors;
      la(!errs && !e && same === 6 && untouched === 2 && !bad.length && d > 0,
        `${d} decisions looked ahead, ${c} changed; ${same}/6 replayed exactly, ${untouched}/2 untouched when nothing changes; ${errs} simulator errors, ${e} look-ahead errors${e ? ` (${laStats.lastError})` : ''}${bad.length ? `, rules: ${bad[0].text}` : ''}; ${(ms / 12000).toFixed(2)} s per game`);
    } catch (e) { la(false, e.message); }

    // Speed (item 171): 10 games on fixed seeds, as games and engine steps per second (a slowdown shows up here)
    const sp = row('games', 'Speed: 10 games on fixed seeds');
    try {
      const t3 = performance.now();
      let steps = 0;
      for (let i = 0; i < 10; i++) {
        const g = new Game([0, 1, 2, 3].map(k => { const d = decks[(i + k) % 4]; return { playerName: `P${k + 1}`, deckName: d.deckName, color: '#888', agent: new Agent(styles[(i + k) % 5]), commanders: d.commanders, cards: d.cards }; }), { beat: async () => {} }, { seed: 950000 + i, noLearning: true });
        await g.run();
        steps += g.steps;
      }
      const s = (performance.now() - t3) / 1000;
      sp(true, `${(10 / s).toFixed(1)} games a second, ${Math.round(steps / s).toLocaleString()} steps a second (${s.toFixed(1)} s)`);
    } catch (e) { sp(false, e.message); }

    // Determinism (item 180): the same seeds played twice, in the opposite order and with or without look-ahead seats,
    // must give identical logs; a stray Math.random, Date or leftover state between games shows up here
    const det = row('games', 'Determinism: 3 seeds played twice in the opposite order, with and without look-ahead');
    try {
      const sig = g => g.logEntries.map(e => e.html).join('|');
      const mk = (i, la) => new Game([0, 1, 2, 3].map(k => { const d = decks[(i + k) % 4]; return { playerName: `P${k + 1}`, deckName: d.deckName, color: '#888', agent: new Agent(styles[(i + 2 * k) % 5], { lookahead: la && k % 2 === 0 }), commanders: d.commanders, cards: d.cards }; }), { beat: async () => {} }, { seed: 940000 + i, noLearning: true });
      const first = new Map();
      const t2 = performance.now();
      for (let i = 0; i < 3; i++) for (const la of [false, true]) { const g = mk(i, la); await g.run(); first.set(`${i}:${la}`, sig(g)); await new Promise(r => setTimeout(r, 0)); }
      let same = 0;
      const diff = [];
      for (let i = 2; i >= 0; i--) for (const la of [true, false]) {
        const g = mk(i, la);
        await g.run();
        if (sig(g) === first.get(`${i}:${la}`)) same++; else diff.push(`seed ${940000 + i}${la ? ' with look-ahead' : ''}`);
        await new Promise(r => setTimeout(r, 0));
      }
      det(same === 6, `${same}/6 identical${diff.length ? `; differs: ${diff.join(', ')}` : ''}; ${((performance.now() - t2) / 1000).toFixed(1)} s`);
    } catch (e) { det(false, e.message); }

    // Kingdoms (kingdomsPlay.js): AI bots at 5 to 9 seats, secret roles; every game must end on a role's Victory condition
    const kd = row('games', 'Kingdoms: 10 AI games, 5 to 9 players');
    try {
      const seen = new Map(), wins = {};
      let errs = 0, ended = 0;
      for (let i = 0; i < 10; i++) {
        const n = 5 + (i % 5), seed = 920000 + i;
        const g = new Game(Array.from({ length: n }, (_, k) => { const d = decks[(i + k) % 4]; return { playerName: `P${k + 1}`, deckName: d.deckName, color: '#888', agent: new Agent(styles[(i + k) % 5]), commanders: d.commanders, cards: d.cards }; }),
          { beat: async () => {} }, { seed, noLearning: true, format: 'kingdoms', roles: dealRoles(n, makeRng(seed)) });
        for (const [k, v] of watchGame(g)) seen.set(k, v);
        await g.run();
        errs += g.logEntries.filter(e => /Simulator error/.test(e.html)).length;
        if (g.winners?.length) { ended++; const t = g.winners[0].role.type; wins[t] = (wins[t] || 0) + 1; }
        await new Promise(r => setTimeout(r, 0));
      }
      const bad = [...seen.values()];
      kd(!errs && !bad.length && ended >= 8, `${ended}/10 ended on a role win (${Object.entries(wins).map(([t, k]) => `${t} ${k}`).join(', ')}), ${errs} simulator errors${bad.length ? `, rules: ${bad[0].text}` : ''}`);
    } catch (e) { kd(false, e.message); }
  }

  const failed = results.filter(x => !x).length;
  $('summary').innerHTML = failed ? `<span class="fail">${failed} of ${results.length} checks failed</span> <span class="muted">(outside services can be down for a while; try again later)</span>` : `<span class="pass">All ${results.length} checks passed</span>`;
  $('btnRun').disabled = false;
}
$('btnRun').addEventListener('click', run);
if (new URLSearchParams(location.search).has('run')) run();
