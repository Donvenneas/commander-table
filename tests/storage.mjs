// Saved data (Phase 2O): settings, the autosave and every other key go through util.js store(); replay files through
// replaydata.js; decklists through decks.js. Damaged, missing, wrong-typed, old and oversized data must never crash
// the game, never be "repaired" into something else, and never cost the last value that was saved. Browser storage is
// a localStorage stand-in that can be made full (QuotaExceededError) or blocked. (The browser card database: see
// tests/carddata.mjs; the deck library's atomic file writes on the three servers: tests/servers.mjs.)
//   node tests/storage.mjs
const LS = new Map();
let full = false, blocked = false;
const quota = () => Object.assign(new Error("Failed to execute 'setItem' on 'Storage': exceeded the quota."), { name: 'QuotaExceededError' });
globalThis.localStorage = /** @type {any} */ ({
  getItem: k => { if (blocked) throw new Error('SecurityError: access denied'); return LS.has(k) ? LS.get(k) : null; },
  setItem: (k, v) => { if (blocked) throw new Error('SecurityError: access denied'); if (full) throw quota(); LS.set(k, String(v)); },
  removeItem: k => LS.delete(k),
});
/** @type {any[]} */
const events = [];
// (a page's window: events util.js sends with dispatchEvent)
const page = new EventTarget();
globalThis.addEventListener = page.addEventListener.bind(page);
globalThis.dispatchEvent = page.dispatchEvent.bind(page);
addEventListener('ct-store', e => events.push(/** @type {any} */ (e).detail));

const results = [];
const test = async (name, fn) => { try { await fn(); results.push([name, null]); } catch (e) { results.push([name, e]); } };
const eq = (got, want, what) => { if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`${what}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); };
const ok = (c, what) => { if (!c) throw new Error(what); };

const { store, storeProblems } = await import('../public/js/util.js');

await test('Damaged saved data reads as nothing (defaults), is reported, and is left as it was', async () => {
  LS.set('ct.history', '{"games": [1, 2,');
  eq(store('ct.history'), null, 'read');
  eq(LS.get('ct.history'), '{"games": [1, 2,', 'the saved text is untouched');
  ok(storeProblems().damaged.includes('ct.history'), 'reported');
  ok(events.some(e => e.kind === 'damaged' && e.key === 'ct.history'), 'the page heard about it');
});
await test('Storage full: the write fails without an error thrown, the last saved value stays, and it is reported as full', async () => {
  ok(store('ct.autosave', { seed: 1, turn: 3 }) === true, 'first save');
  full = true;
  try { eq(store('ct.autosave', { seed: 1, turn: 9 }), false, 'second save refused'); } finally { full = false; }
  eq(store('ct.autosave'), { seed: 1, turn: 3 }, 'the last good save is kept');
  ok(storeProblems().quota && events.some(e => e.kind === 'failed' && e.quota), 'reported as full');
});
await test('Blocked storage (private window, site data off): reads give nothing and writes fail quietly', async () => {
  blocked = true;
  try { eq(store('ct.prefs'), null, 'read'); eq(store('ct.prefs', { a: 1 }), false, 'write'); } finally { blocked = false; }
});
await test('Settings saved as something other than an object are ignored, not used', async () => {
  LS.set('ct.prefs', '[1,2,3]');
  const { prefs } = await import(`../public/js/prefs.js?${Date.now()}`);
  ok(prefs && typeof prefs === 'object' && !Array.isArray(prefs) && !Object.keys(prefs).length, `prefs: ${JSON.stringify(prefs)}`);
  eq(LS.get('ct.prefs'), '[1,2,3]', 'nothing overwritten just by reading');
});

const { replayShapeProblem, checkReplay, REPLAY_FORMAT } = await import('../public/js/replaydata.js');
const { RULES } = await import('../public/js/engine.js');
const good = () => ({ app: 'commander-table', version: REPLAY_FORMAT, seed: 42, rules: RULES, decisions: [], seats: [1, 2, 3, 4].map(i => ({ name: `P${i}`, style: 'balanced', deck: '1 Island' })), cards: {}, hashes: {}, spellbook: [] });
await test('Replay files: damaged, foreign and missing-field files are refused with a reason, a good one passes', async () => {
  eq(replayShapeProblem(good(), 4), '', 'a good file');
  const cases = [
    [null, /isn't a Commander Table replay/], ['text', /isn't a Commander Table replay/], [[], /isn't a Commander Table replay/],
    [{ ...good(), app: 'other' }, /isn't a Commander Table replay/], [{ ...good(), seats: good().seats.slice(0, 3) }, /isn't a Commander Table replay/],
    [{ ...good(), seats: [null, ...good().seats.slice(1)] }, /a seat has no deck/], [{ ...good(), seed: '42' }, /no game seed/],
    [{ ...good(), decisions: 'x' }, /answers are not a list/], [{ ...good(), cards: [] }, /card data is not readable/],
  ];
  for (const [data, re] of cases) ok(re.test(replayShapeProblem(data, 4)), `${JSON.stringify(data)?.slice(0, 60)} → "${replayShapeProblem(data, 4)}"`);
});
await test('Replay files: a newer rules version, a card that doesn\'t match its hash or missing combos stop the restore; an old format is restored with a note', async () => {
  ok(checkReplay({ ...good(), rules: RULES + 1 }).problems.some(p => /newer than this app/.test(p)), 'newer rules');
  ok(checkReplay({ ...good(), cards: { a: { id: 'a', name: 'X' } }, hashes: { a: 'not-the-hash' } }).problems.some(p => /doesn't match its hash/.test(p)), 'edited card');
  ok(checkReplay({ ...good(), spellbook: undefined }).problems.some(p => /Spellbook combos are missing/.test(p)), 'missing combos');
  const old = checkReplay({ ...good(), version: 3, cards: undefined, hashes: undefined });
  ok(!old.problems.length && old.notes.some(n => /before replays kept their own card data/.test(n)), 'old format: restored with a note');
});

// Decklists: nonsense and empty lists are refused with a message; unknown cards become warnings, not a crash
globalThis.fetch = /** @type {any} */ (async () => new Response(JSON.stringify({ object: 'list', not_found: [], data: [] }), { status: 200 }));
const { loadDeck, parseText } = await import('../public/js/decks.js');
await test('Decklists: an empty or nonsense list is refused with a plain message', async () => {
  for (const text of ['', '\u0000\u0001\u0002', '<script>alert(1)</script>', '%%%%\n####']) {
    let msg = '';
    try { await loadDeck(text || ' ', null, { format: 'standard' }); } catch (e) { msg = e.message; }
    ok(msg && !/undefined|TypeError|Cannot read/.test(msg), `"${text.slice(0, 20)}" → "${msg}"`);
  }
  const read = parseText('1 Island\n\u0000garbage\n2 Forest').entries.filter(e => e.name).map(e => [e.qty, e.name]);
  ok(JSON.stringify(read).includes('[1,"Island"]') && JSON.stringify(read).includes('[2,"Forest"]'), `readable lines still read: ${JSON.stringify(read)}`);
});
await test('Decklists: cards that can\'t be found become warnings naming them', async () => {
  let deck = null, msg = '';
  try { deck = await loadDeck('4 Totally Fake Card Name\n4 Another Fake', null, { format: 'standard' }); } catch (e) { msg = e.message; }
  ok(deck ? deck.warnings.some(w => /Totally Fake Card Name/.test(w)) : /fake|found|card/i.test(msg), `warnings: ${deck?.warnings.join('; ') || msg}`);
});

for (const [name, e] of results) console.log(`${e ? 'FAIL' : 'ok  '}  ${name}${e ? `\n        ${e.message}` : ''}`);
const bad = results.filter(r => r[1]).length;
console.log(`Saved data: ${results.length} tests, ${results.length - bad} passed, ${bad} failed.`);
process.exit(bad ? 1 : 0);
