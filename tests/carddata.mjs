// Card data reliability (Phase 2N, item 384): card identity, Scryfall requests, the browser's card database, Scryfall's
// bulk card file, multi-faced cards, pictures, search, offline play and untrusted data. Uses real Scryfall card data
// (tests/carddata-cards.json: transform, modal, split, adventure, flip, meld, land, token and double-faced token cards,
// two printings of Sol Ring; tests/golden-cards.json; tests/cards-snapshot.json) with a scripted fetch that answers
// with real HTTP responses: successes, damaged answers, 429 with Retry-After, 5xx, timeouts, no network, cut-off and
// broken downloads. The browser's database is an in-memory IndexedDB stand-in whose write transactions are
// all-or-nothing like the real one (and can be made to fail).
//   node tests/carddata.mjs [name filter]
//   node tests/carddata.mjs --report tests/card-data.md   (also writes the card data diagnostics of the snapshot)
import { readFileSync, writeFileSync } from 'node:fs';

// ---------- browser stand-ins: localStorage and IndexedDB
const LS = new Map();
globalThis.localStorage = /** @type {any} */ ({ getItem: k => (LS.has(k) ? LS.get(k) : null), setItem: (k, v) => LS.set(k, String(v)), removeItem: k => LS.delete(k) });
/** @type {Map<string, Map<string, Map<any, any>>>} database name → store name → records */
const DBS = new Map();
let failNextWrite = false;
function fakeDb(name) {
  const stores = /** @type {Map<string, Map<any, any>>} */ (DBS.get(name));
  return {
    createObjectStore(s) { stores.set(s, new Map()); },
    close() {},
    transaction(storeName, mode = 'readonly') {
      const live = /** @type {Map<any, any>} */ (stores.get(storeName));
      const work = new Map(live);
      let aborted = false;
      const tx = /** @type {any} */ ({});
      const request = fn => {
        const r = /** @type {any} */ ({});
        setTimeout(() => {
          try { r.result = fn(); r.onsuccess?.(); } catch (e) {
            r.error = e;
            const ev = { prevented: false, preventDefault() { this.prevented = true; }, stopPropagation() {} };
            r.onerror?.(ev);
            if (!ev.prevented) aborted = true;
          }
        });
        return r;
      };
      tx.objectStore = () => ({
        get: k => request(() => (work.has(k) ? structuredClone(work.get(k)) : undefined)),
        put: (v, k) => request(() => { work.set(k, structuredClone(v)); }),
        add: (v, k) => request(() => { if (work.has(k)) throw new Error('ConstraintError'); work.set(k, structuredClone(v)); }),
        clear: () => request(() => work.clear()),
        getAll: () => request(() => [...work.values()].map(v => structuredClone(v))),
        count: () => request(() => work.size),
      });
      setTimeout(() => setTimeout(() => {
        const fail = aborted || (mode === 'readwrite' && failNextWrite);
        if (mode === 'readwrite' && failNextWrite) failNextWrite = false;
        if (fail) { tx.error = new Error('transaction aborted'); tx.onerror?.(); tx.onabort?.(); return; }
        if (mode === 'readwrite') { live.clear(); for (const [k, v] of work) live.set(k, v); }
        tx.oncomplete?.();
      }));
      return tx;
    },
  };
}
globalThis.indexedDB = /** @type {any} */ ({
  open(name) {
    const req = /** @type {any} */ ({});
    setTimeout(() => {
      const fresh = !DBS.has(name);
      if (fresh) DBS.set(name, new Map());
      req.result = fakeDb(name);
      if (fresh) req.onupgradeneeded?.();
      req.onsuccess?.();
    });
    return req;
  },
});

// ---------- scripted fetch: each test sets `answer`, which gets (url, init) and returns a Response (or throws)
/** @type {(url: string, init?: any) => any} */
let answer = () => { throw new TypeError('fetch failed (no answer scripted)'); };
let fetches = 0;
/** @type {string[]} */
let fetchLog = [];
globalThis.fetch = /** @type {any} */ (async (url, init) => { fetches++; fetchLog.push(String(url)); return answer(String(url), init); });
const json = (body, status = 200, headers = {}) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
const list = data => json({ object: 'list', not_found: [], data });

const S = await import('../public/js/scryfall.js');
const { normalize, fetchCollection, sf, netStatus, onNetStatus, resetNet, pinCards, pinReport, ScryfallError } = S;
const C = await import('../public/js/carddata.js');
const { getCards, putCards, cacheInfo } = await import('../public/js/cardcache.js');
const B = await import('../public/js/bulk.js');
const { ignoredText } = await import('../public/js/effects.js');
const { cardFace } = await import('../public/js/util.js');
const { Game, RULES } = await import('../public/js/engine.js');
const { Agent } = await import('../public/js/ai.js');
const { loadDeck } = await import('../public/js/decks.js');
const { CEDH_PRESETS } = await import('../public/js/presets.js');
const { readingHash, readingChanges } = await import('../public/js/replaydata.js');

const FIX = JSON.parse(readFileSync(new URL('./carddata-cards.json', import.meta.url), 'utf8'));
const GOLD = JSON.parse(readFileSync(new URL('./golden-cards.json', import.meta.url), 'utf8'));
const SNAP = JSON.parse(readFileSync(new URL('./cards-snapshot.json', import.meta.url), 'utf8'));
const fx = name => { const c = FIX.find(x => x.name === name || x.name.split(' // ')[0] === name); if (!c) throw new Error(`no fixture ${name}`); return structuredClone(c); };
const [solTrc, solCmm] = FIX.filter(c => c.name === 'Sol Ring');
const key = i => JSON.stringify(i);
const quick = () => resetNet({ backoff: 5, gap: 0, heavyGap: 0, timeout: 200 });

// ---------- runner
const reportAt = process.argv.indexOf('--report');
const filter = reportAt < 0 ? process.argv[2]?.toLowerCase() : undefined;
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
function ok(cond, msg) { if (!cond) throw new Error(msg); }
function eq(a, b, msg) { if (a !== b) throw new Error(`${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }
async function rejects(p, re, msg) { try { await p; } catch (e) { if (re && !re.test(e.message)) throw new Error(`${msg}: wrong error "${e.message}"`); return e; } throw new Error(`${msg}: no error`); }

// ================= card identity and data
test('1 a card is fetched by its Scryfall id, then read from the browser\'s database without a request', async () => {
  quick(); fetches = 0;
  answer = (url, init) => { const ids = JSON.parse(init.body).identifiers; return list(ids.map(i => FIX.find(c => c.id === i.id)).filter(Boolean)); };
  const a = await fetchCollection([{ id: solTrc.id }]);
  eq(a.cards.get(key({ id: solTrc.id }))?.id, solTrc.id, 'card by id');
  eq(fetches, 1, 'one request');
  await new Promise(r => setTimeout(r, 20));
  const b = await fetchCollection([{ id: solTrc.id }]);
  eq(b.cards.get(key({ id: solTrc.id }))?.name, 'Sol Ring', 'from the database');
  eq(fetches, 1, 'no second request (cached first)');
});
test('2 a card is found by its oracle id (Scryfall\'s answer and the saved alias), and by name after an id fetch', async () => {
  quick(); fetches = 0;
  answer = () => { throw new TypeError('offline'); };
  const a = await fetchCollection([{ oracle_id: solTrc.oracle_id }, { name: 'Sol Ring' }, { set: solTrc.set, collector_number: solTrc.collector_number }]);
  eq(a.cards.get(key({ oracle_id: solTrc.oracle_id }))?.oracleId, solTrc.oracle_id, 'by oracle id from the alias');
  eq(a.cards.get(key({ name: 'Sol Ring' }))?.id, solTrc.id, 'by name from the alias');
  eq(fetches, 0, 'no request');
  quick();
  const delver = fx('Delver of Secrets');
  answer = (url, init) => list(JSON.parse(init.body).identifiers.map(i => (i.oracle_id === delver.oracle_id ? delver : null)).filter(Boolean));
  const b = await fetchCollection([{ oracle_id: delver.oracle_id }]);
  eq(b.cards.get(key({ oracle_id: delver.oracle_id }))?.name, delver.name, 'by oracle id from Scryfall');
});
test('3 two printings are two definitions with one oracle identity; one printing read twice is one definition', async () => {
  const a = normalize(solTrc), b = normalize(solCmm), a2 = normalize(structuredClone(solTrc));
  ok(a !== b && a.id !== b.id, 'printings differ');
  eq(a.oracleId, b.oracleId, 'same oracle id');
  ok(a.set !== b.set, 'different sets');
  eq(a2, a, 'the same printing gives the same definition object');
  eq(readingHash(a), readingHash(b), 'both printings read the same');
});
test('4 two copies of one card in a game are two instances with their own ids', async () => {
  const card = normalize(solTrc);
  const g = /** @type {any} */ ({ rules: RULES, nextId: 1, objects: new Map() });
  const p = { idx: 0 };
  const x = Game.prototype.mk.call(g, card, p), y = Game.prototype.mk.call(g, card, p);
  ok(x.iid !== y.iid, 'separate iids');
  eq(x.card, y.card, 'one definition');
  x.tapped = true; x.counters = 2;
  ok(!y.tapped && !y.counters, 'state belongs to the instance');
});
test('5 missing optional fields do not break a card', async () => {
  const raw = { id: '00000000-0000-4000-8000-000000000005', name: 'Plain Bear', layout: 'normal', cmc: 2, type_line: 'Creature — Bear', mana_cost: '{1}{G}', color_identity: ['G'] };
  const v = C.check(raw);
  ok(v.ok, `usable: ${v.fatal}`);
  ok(v.warn.includes('no oracle id'), 'missing oracle id is noted');
  const c = normalize(raw);
  eq(c.text, '', 'no text');
  eq(c.imgSmall, undefined, 'no picture');
  ok(Array.isArray(c.keywords) && Array.isArray(c.colors), 'lists default to empty');
  ok(c.fx && c.fx.type.creature, 'read as a creature');
  ok(cardFace(c).includes('Plain Bear'), 'shown in words');
});
test('6 malformed required fields are refused and reported, never cached', async () => {
  const good = fx('Sol Ring');
  const bad = [
    [{ ...good, id: 'not-a-uuid' }, /Scryfall id/],
    [{ ...good, name: 42 }, /name/],
    [{ ...good, cmc: '1' }, /mana value/],
    [{ ...good, cmc: -1 }, /mana value/],
    [{ ...good, colors: ['X'] }, /colors/],
    [{ ...good, color_identity: 'C' }, /color identity/],
    [{ ...good, oracle_text: { evil: true } }, /oracle_text/],
    [{ ...good, legalities: { commander: 1 } }, /legalities/],
    [{ ...fx('Delver of Secrets'), card_faces: undefined }, /without its faces/],
    [{ ...fx('Delver of Secrets'), card_faces: [{ name: '' }, { name: 'x' }] }, /face 1 has no name/],
    [{ ...good, object: 'error' }, /not a card/],
    [null, /not a card/],
  ];
  for (const [raw, re] of bad) { const v = C.check(raw); ok(!v.ok && v.fatal.some(f => re.test(f)), `refused ${re}: ${JSON.stringify(v.fatal)}`); }
  quick();
  const damaged = { ...good, id: '11111111-1111-4111-8111-111111111111', name: 'Broken Ring', cmc: 'lots' };
  answer = () => list([damaged]);
  const r = await fetchCollection([{ name: 'Broken Ring' }]);
  ok(!r.cards.size && r.missing.length === 1, 'counted as missing');
  ok(r.rejected[0]?.startsWith('Broken Ring: invalid mana value'), `reported: ${r.rejected}`);
  await new Promise(res => setTimeout(res, 20));
  eq((await getCards([key({ name: 'Broken Ring' }), key({ id: damaged.id })])).size, 0, 'not saved');
});

// ================= Scryfall requests
test('7+8 a failed refresh keeps the saved card, and a damaged or failed answer never replaces it', async () => {
  const oracle = fx("Thassa's Oracle");
  await putCards([[key({ name: "Thassa's Oracle" }), { ...oracle, _at: 1 }]]); // (saved long ago: due for a refresh)
  quick(); fetches = 0;
  answer = () => json({ object: 'error', details: 'Internal error' }, 500);
  const a = await fetchCollection([{ name: "Thassa's Oracle" }]);
  eq(a.cards.get(key({ name: "Thassa's Oracle" }))?.name, "Thassa's Oracle", 'saved copy used');
  eq(fetches, 3, 'three tries on 5xx');
  quick();
  answer = () => list([{ ...oracle, type_line: undefined, card_faces: undefined, oracle_text: undefined, cmc: 'x' }]);
  const b = await fetchCollection([{ name: "Thassa's Oracle" }]);
  eq(b.cards.get(key({ name: "Thassa's Oracle" }))?.text, normalize(oracle).text, 'damaged refresh: saved copy used');
  eq(b.missing.length, 0, 'not reported missing when a saved copy exists');
  await new Promise(r => setTimeout(r, 20));
  const saved = await getCards([key({ name: "Thassa's Oracle" })]);
  eq(saved.get(key({ name: "Thassa's Oracle" }))?.oracle_text, oracle.oracle_text, 'database still holds the good card');
});
test('9 HTTP 429: Retry-After is honoured, and three 429s give a clear "busy" error, not an offline one', async () => {
  quick(); fetches = 0;
  let n = 0;
  answer = () => (n++ === 0 ? json({ object: 'error', status: 429 }, 429, { 'Retry-After': '1' }) : json(fx('Sol Ring')));
  const t0 = Date.now();
  const j = await sf('/cards/named?exact=Sol%20Ring');
  eq(j.name, 'Sol Ring', 'answer after the wait');
  ok(Date.now() - t0 >= 950, `waited Retry-After (${Date.now() - t0} ms)`);
  eq(fetches, 2, 'two requests');
  quick(); fetches = 0;
  answer = () => json({ object: 'error' }, 429);
  const e = await rejects(sf('/cards/named?exact=Sol%20Ring&x=2'), /busy/, '429');
  ok(e instanceof ScryfallError && e.status === 429 && !e.offline, 'status 429, not offline');
  eq(fetches, 3, 'gives up after three tries');
  ok(netStatus().online, 'still online');
});
test('10 no network: offline after three tries, later requests fail at once, saved cards still load, back online on success', async () => {
  quick(); fetches = 0;
  /** @type {any[]} */ const heard = [];
  const stop = onNetStatus(s => heard.push(s.online));
  answer = () => { throw new TypeError('fetch failed'); };
  const e = await rejects(sf('/cards/search?q=t%3Agoblin'), /Can't reach Scryfall/, 'network error');
  ok(e.offline, 'marked offline');
  eq(netStatus().online, false, 'offline state');
  eq(fetches, 3, 'three tries');
  await rejects(sf('/cards/search?q=t%3Aelf'), /^Offline/, 'later request');
  eq(fetches, 3, 'no request while offline');
  const r = await fetchCollection([{ name: 'Sol Ring' }]);
  eq(r.cards.get(key({ name: 'Sol Ring' }))?.name, 'Sol Ring', 'saved card loads offline');
  const miss = await rejects(fetchCollection([{ name: 'Never Saved Card' }]), /without an internet connection/, 'unsaved card offline');
  ok(miss.offline, 'offline error');
  quick(); // (the 30 s wait is over)
  answer = () => json(fx('Sol Ring'));
  await sf('/cards/named?exact=Sol%20Ring&x=3');
  heard.push(netStatus().online);
  stop();
  ok(heard[0] === false && heard.at(-1) === true, `told offline then online: ${heard}`);
});
test('10b a request that hangs is cut off by the time limit', async () => {
  quick();
  answer = (url, init) => new Promise((_, rej) => init?.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError'))));
  const t0 = Date.now();
  const e = await rejects(sf('/cards/named?exact=Hang'), /did not answer within/, 'timeout');
  ok(e.offline && Date.now() - t0 < 3000, 'gave up quickly');
  quick();
});
test('11 identical requests at the same time are sent once (searches and card loads)', async () => {
  quick(); fetches = 0;
  answer = async () => { await new Promise(r => setTimeout(r, 30)); return list([fx('Sol Ring')]); };
  const [a, b] = await Promise.all([sf('/cards/search?q=sol'), sf('/cards/search?q=sol')]);
  eq(a, b, 'one shared answer');
  eq(fetches, 1, 'one request');
  eq(netStatus().shared, 1, 'counted as shared');
  quick(); fetches = 0;
  const bone = fx('Bonecrusher Giant');
  answer = async (url, init) => { await new Promise(r => setTimeout(r, 30)); return list(JSON.parse(init.body).identifiers.map(i => (i.name === 'Bonecrusher Giant' ? bone : null)).filter(Boolean)); };
  const [x, y] = await Promise.all([fetchCollection([{ name: 'Bonecrusher Giant' }]), fetchCollection([{ name: 'Bonecrusher Giant' }])]);
  eq(fetches, 1, 'one collection request for two loads');
  eq(x.cards.get(key({ name: 'Bonecrusher Giant' })), y.cards.get(key({ name: 'Bonecrusher Giant' })), 'same card');
});
test('12 answers that are not card data are refused', async () => {
  for (const [body, status, re] of [['<html>Sign in to the Wi-Fi</html>', 200, /wasn't card data/], ['[1,2,3]', 200, /wasn't card data/], ['{"object":"list","data":"nope"}', 200, /wasn't card data/], ['{"object":"error","details":"No card found"}', 404, /No card found/], ['oops', 502, /Scryfall error 502/]]) {
    quick();
    answer = () => new Response(body, { status, headers: { 'Content-Type': 'text/html' } });
    const e = await rejects(sf(`/cards/named?exact=x${status}${body.length}`), re, `answer ${status} ${body.slice(0, 20)}`);
    ok(e instanceof ScryfallError, 'a ScryfallError');
  }
  quick();
  answer = () => json({ object: 'list', data: 'nope' });
  await rejects(fetchCollection([{ name: 'Something New' }]), /card data|could not be fetched/, 'collection with a broken list');
});

// ================= multi-faced cards
test('13 transform: both faces kept, each with its own text, stats and picture', async () => {
  const raw = fx('Delver of Secrets'), c = normalize(raw);
  eq(c.frontName, 'Delver of Secrets', 'front name');
  eq(c.power, '1', 'front power');
  ok(c.backCard, 'back face built');
  eq(c.backCard.name, 'Insectile Aberration', 'back name');
  eq(c.backCard.power, '3', 'back power');
  ok(/flying/i.test(c.backCard.text) && !/flying/i.test(c.text.replace(/\([^)]*\)/g, '')), 'flying is the back face\'s');
  eq(c.v8.backCard.keywords.includes('Flying'), true, 'rules 8 reading: back face has Flying');
  eq(c.v8.keywords.includes('Flying'), false, 'rules 8 reading: front face does not');
  eq(c.imgSmall, raw.card_faces[0].image_uris.small, 'front picture');
  eq(c.backCard.imgSmall, raw.card_faces[1].image_uris.small, 'back picture');
  eq(c.backCard.art, raw.card_faces[1].image_uris.art_crop, 'back art');
});
test('14 modal double-faced: each face has its own cost, type, text and picture', async () => {
  const raw = fx('Shatterskull Smashing'), c = normalize(raw);
  eq(c.manaCost, '{X}{R}{R}', 'front cost');
  ok(c.fx.type.sorcery, 'front is a sorcery');
  ok(c.altFace && c.altFace.fx.type.land, 'back is a land');
  eq(c.altFace.manaCost, '', 'back has no cost');
  eq(c.altFace.isAltFace, 'modal_dfc', 'marked as a modal face');
  eq(c.altFace.imgSmall, raw.card_faces[1].image_uris.small, 'back small picture is the back\'s');
  eq(c.altFace.art, raw.card_faces[1].image_uris.art_crop, 'back art is the back\'s');
  ok(c.imgSmall !== c.altFace.imgSmall, 'faces differ');
});
test('15 split: both halves kept with their own costs; the card\'s mana value is both halves\'', async () => {
  const c = normalize(fx('Fire // Ice'));
  eq(c.frontName, 'Fire', 'first half');
  eq(c.manaCost, '{1}{R}', 'first half cost');
  eq(c.altFace?.name, 'Ice', 'second half');
  eq(c.altFace.manaCost, '{1}{U}', 'second half cost');
  eq(c.cmc, 4, 'whole card mana value');
  eq(c.v8.frontHalf.cmc, 2, 'rules 8: a half on the stack has its own mana value');
  eq(c.altFace.imgSmall, c.imgSmall, 'one picture for both halves');
});
test('16 adventure: the creature and its adventure are kept apart', async () => {
  const c = normalize(fx('Bonecrusher Giant'));
  ok(c.fx.type.creature && c.power === '4', 'creature face');
  eq(c.altFace?.name, 'Stomp', 'adventure face');
  ok(c.altFace.fx.type.instant, 'adventure is an instant');
  eq(c.altFace.cmc, 2, 'adventure mana value');
  eq(c.cmc, 3, 'card mana value is the creature\'s');
});
test('17 pictures: each face shows its own picture; tokens and single-picture cards keep theirs', async () => {
  const flip = fx('Akki Lavarunner'), cf = normalize(flip);
  ok(cf.backCard, 'flip card has its flipped face');
  eq(cf.backCard.imgNormal, cf.imgNormal, 'a flip card is one picture (turned)');
  const tok = normalize(fx('Treasure'));
  ok(tok.imgSmall && tok.imgSmall === fx('Treasure').image_uris.small, 'token picture');
  const dft = fx('Dinosaur // Treasure');
  ok(C.check(dft).ok, 'double-faced token is valid data');
  eq(normalize(dft).imgSmall, dft.card_faces[0].image_uris.small, 'double-faced token front picture');
});
test('18 faces the engine does not play are not reported as playable', async () => {
  eq(C.layoutSupport('meld').play, 'none', 'meld');
  eq(C.layoutSupport('reversible_card').play, 'none', 'reversible');
  eq(C.layoutSupport('prepare').play, 'partial', 'prepare');
  eq(C.layoutSupport('something_new').play, 'unknown', 'unknown layouts');
  const bruna = normalize(fx('Bruna, the Fading Light'));
  ok(!bruna.backCard && !bruna.altFace, 'meld card has no made-up back face');
  ok(C.check({ ...fx('Sol Ring'), layout: 'something_new' }).warn.some(w => /not known/.test(w)), 'unknown layout reported');
  for (const lay of new Set(SNAP.map(c => c.layout))) ok(C.LAYOUT_SUPPORT[lay], `layout ${lay} has a support entry`);
});

// ================= database and versions
test('23 changed card text or a changed reader gives a new reading; old records without a schema still load', async () => {
  const raw = fx('Sol Ring'), a = normalize(raw);
  const b = normalize({ ...raw, oracle_text: '{T}: Add {C}.' });
  ok(a !== b, 'changed data is a new definition');
  ok(readingHash(a) !== readingHash(b), 'and a new reading');
  // (a replay that saved a reading hash notices a reader that reads the card differently today)
  const changed = readingChanges({ readings: { [a.id]: 'reading-of-an-older-reader' } }, [{ commanders: [], cards: [{ card: a, qty: 1 }] }]);
  eq(changed[0], 'Sol Ring', 'reader change reported');
  // (an old record: no schema field) and a damaged one
  const db = /** @type {Map<any, any>} */ (DBS.get('ct-cards')?.get('cards'));
  db.set(key({ name: 'Old Record' }), { raw: { ...fx('Command Tower') }, at: 1 });
  db.set(key({ name: 'Damaged Record' }), { raw: { name: 'Damaged Record' }, at: 1 });
  const got = await getCards([key({ name: 'Old Record' }), key({ name: 'Damaged Record' })]);
  ok(got.has(key({ name: 'Old Record' })), 'old record read');
  ok(!got.has(key({ name: 'Damaged Record' })), 'damaged record skipped');
  const info = await cacheInfo();
  ok(info.damagedSkipped >= 1 && info.schema === C.CARD_SCHEMA && info.lastOk, `cache info ${JSON.stringify(info)}`);
});
test('24 duplicate records are detected', async () => {
  const r = C.checkList([fx('Sol Ring'), fx('Sol Ring'), solCmm], { uniqueOracle: true });
  eq(r.duplicateIds, 1, 'duplicate id');
  eq(r.duplicateOracle, 2, 'duplicate oracle ids');
  ok(!C.acceptList({ ...r, total: 20000, valid: 20000 }, { min: 1 }).ok, 'refused');
  const snap = C.checkList(SNAP, { uniqueOracle: true });
  eq(snap.duplicateIds + snap.duplicateOracle + snap.invalid, 0, 'the snapshot is clean');
});

// ================= decks, offline play, replays
test('25+26 a saved deck loads with no connection from saved cards, and a game is played with it', async () => {
  const find = n => { const k = n.toLowerCase(); return GOLD[k] || Object.values(GOLD).find(c => c.name.toLowerCase().split(' // ')[0] === k.split(' // ')[0]); };
  const names = new Set(CEDH_PRESETS.slice(0, 2).flatMap(p => p.list.split('\n').map(l => l.replace(/^\s*\d+x?\s+/, '').trim()).filter(n => n && find(n))));
  // (as a browser that imported these decks by Scryfall id once: saved under ids, found by name through the aliases)
  await putCards([...names].map(n => [key({ id: find(n).id }), find(n)]));
  quick(); fetches = 0; fetchLog = [];
  answer = (url, init) => { fetchLog.push(init?.body || url); throw new TypeError('no network'); };
  const decks = [];
  for (const p of CEDH_PRESETS.slice(0, 2)) decks.push(await loadDeck(p.list, null, { format: 'commander' }));
  // (only a card saved long ago, by test 7, is tried for a refresh; it then loads from its saved copy)
  ok(fetchLog.filter(b => b.startsWith("{")).every(b => /Thassa/.test(b) && !/"name":"(?!Thassa)/.test(b)), `no request but the overdue refresh (${fetchLog.join(', ')})`);
  for (const d of decks) ok(d.commanders.length && d.cards.length > 50, `${d.deckName} loaded (${d.cards.length} entries; ${d.warnings.slice(0, 2).join('; ')})`);
  const g = new Game(decks.map((d, k) => ({ playerName: `P${k + 1}`, deckName: d.deckName, color: '#888', agent: new Agent('balanced'), commanders: d.commanders, cards: d.cards })), { beat: async () => {} }, { seed: 4242, noLearning: true, rules: RULES });
  await g.run();
  ok(g.over, 'game finished');
  eq(g.logEntries.filter(e => /Simulator error/.test(e.html)).length, 0, 'no simulator errors');
});
test('27 a replay is rebuilt from the card data it saved, not today\'s', async () => {
  const today = fx('Command Tower');
  await putCards([[key({ name: 'Command Tower' }), today]]);
  const then = { ...today, oracle_text: 'Command Tower of an older printing: {T}: Add {C}.' };
  pinCards([then]);
  const r = await fetchCollection([{ name: 'Command Tower' }]);
  pinCards(null);
  eq(r.cards.get(key({ name: 'Command Tower' }))?.text, then.oracle_text, 'saved (historical) text used');
  ok(pinReport().differs.includes('Command Tower'), 'the difference from today\'s data is noted');
});
test('29 unread card text is reported, not hidden', async () => {
  const raw = { ...fx('Sol Ring'), id: '22222222-2222-4222-8222-222222222222', name: 'Moon Singer', type_line: 'Artifact', oracle_text: 'Whenever the moon is full, you may sing a song of your choice.' };
  ok(ignoredText(normalize(raw)), 'unread text reported');
  ok(!ignoredText(normalize(fx('Sol Ring'))), 'Sol Ring fully read');
});

// ================= search, pictures, untrusted data
test('30 local search over 35,000 cards is correct and quick (faces included)', async () => {
  const big = [];
  for (let r = 0; r < 10; r++) for (const c of SNAP) big.push({ ...c, id: `${c.id.slice(0, -2)}${String(r).padStart(2, '0')}`, name: r ? `${c.name} ${r}` : c.name, games: ['paper'] });
  big.push(fx('Delver of Secrets'), fx('Shatterskull Smashing'));
  const t0 = performance.now();
  const flyers = B.searchCards(big, 'o:flying t:creature c:u', 'name');
  const ms = performance.now() - t0;
  const brute = big.filter(c => { const t = [c.oracle_text, ...(c.card_faces || []).map(f => f.oracle_text)].join('\n').toLowerCase(); const ty = (c.type_line || '').toLowerCase(); const col = c.colors || [...new Set((c.card_faces || []).flatMap(f => f.colors || []))]; return t.includes('flying') && ty.includes('creature') && col.includes('U'); });
  eq(flyers.length, brute.length, 'same as a plain filter');
  ok(flyers.some(c => c.name.startsWith('Delver')), 'Delver found by its back face\'s flying');
  ok(B.searchCards(big, 'insectile', 'name').some(c => c.name.startsWith('Delver')), 'found by its back face\'s name');
  ok(B.searchCards(big, 't:land o:"hammer pass"', 'name').length === 0, 'type of the back face alone is not the card\'s type line');
  eq(B.searchCards(big, 'zzzz-no-such-card', 'name').length, 0, 'no results');
  eq(B.searchCards(big, '', 'name').length, big.filter(c => !['planar', 'scheme', 'vanguard'].includes(c.layout)).length, 'empty search');
  ok(ms < 500, `quick (${ms.toFixed(0)} ms)`);
});
test('31 picture addresses: only Scryfall\'s own; anything else is dropped so the card is shown in words', async () => {
  for (const u of ['javascript:alert(1)', 'data:image/png;base64,AAAA', 'http://cards.scryfall.io/x.jpg', 'https://evil.example/x.jpg', 'https://cards.scryfall.io.evil.example/x.jpg', 'https://cards.scryfall.io/x.jpg"onerror="alert(1)', 42, null])
    eq(C.safeImageUrl(u), undefined, `refused ${u}`);
  ok(C.safeImageUrl('https://cards.scryfall.io/small/front/6/9/6904ea20.jpg?1562921188'), 'Scryfall picture accepted');
  const raw = { ...fx('Sol Ring'), id: '33333333-3333-4333-8333-333333333333', image_uris: { small: 'javascript:alert(1)', normal: 'https://evil.example/n.jpg' } };
  ok(C.check(raw).warn.some(w => /picture/.test(w)), 'reported');
  const c = normalize(raw);
  ok(c.imgSmall === undefined && c.imgNormal === undefined, 'no picture used');
  ok(cardFace(c).includes('Sol Ring'), 'the card is shown in words');
});
test('32 card data cannot run code or inject markup', async () => {
  const raw = { ...fx('Sol Ring'), id: '44444444-4444-4444-8444-444444444444', name: '<img src=x onerror=alert(1)>', type_line: 'Artifact <script>alert(1)</script>', oracle_text: '${globalThis.HACKED = 1} {T}: Add {C}{C}.' };
  ok(C.check(raw).ok, 'odd text is still a card');
  const c = normalize(raw);
  const html = cardFace(c);
  ok(!html.includes('<img src=x') && html.includes('&lt;img'), 'name escaped');
  ok(!html.includes('<script>'), 'type escaped');
  eq(/** @type {any} */ (globalThis).HACKED, undefined, 'text never run');
  ok(!C.check({ ...raw, colors: ['W;background:url(x)'] }).ok, 'colors that could reach a style attribute are refused');
  ok(Array.isArray(B.searchCards([raw], 'o:"(.*)+$"', 'name')), 'regex characters in a search are plain text');
});

// ================= Scryfall's bulk card file (last: once it is on, searches answer from it)
const bulkCard = n => ({ ...SNAP[n % SNAP.length], id: `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`, oracle_id: `10000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`, name: `${SNAP[n % SNAP.length].name} #${n}` });
const bulkLines = (n, damaged = 0) => Array.from({ length: n }, (_, i) => JSON.stringify(i < damaged ? { ...bulkCard(i), cmc: 'bad' } : bulkCard(i)));
const metaOf = (updated, url = 'https://data.scryfall.io/oracle-cards/oracle-cards.json') => json({ object: 'bulk_data', type: 'oracle_cards', updated_at: updated, download_uri: url });
const fileAnswer = (updated, body) => url => (url.includes('/bulk-data/') ? metaOf(updated) : new Response(body, { status: 200 }));
const savedBulk = () => [...(DBS.get('ct-bulk')?.get('chunks')?.values() || [])].flat();

test('22 a good file is checked, saved in one step and used; its details are recorded', async () => {
  answer = fileAnswer('2026-11-01T00:00:00Z', '[\n' + bulkLines(12000).join(',\n') + '\n]\n');
  const t0 = performance.now();
  const n = await B.downloadBulk(null);
  const ms = performance.now() - t0;
  eq(n, 12000, 'cards saved');
  const m = B.bulkInfo();
  ok(m.on && m.count === 12000 && m.updated === '2026-11-01T00:00:00Z' && m.schema === C.CARD_SCHEMA && /oracle-cards/.test(m.source) && m.invalid === 0, `meta ${JSON.stringify(m)}`);
  eq(savedBulk().length, 12000, 'database holds the file');
  eq((await B.bulkCard({ name: `${SNAP[5].name} #5` }))?.id, bulkCard(5).id, 'a card is found in it');
  console.log(`      (import of 12,000 cards: ${ms.toFixed(0)} ms)`);
});
test('19 an unchanged file is not downloaded again', async () => {
  LS.set('ct.bulk', JSON.stringify({ ...B.bulkInfo(), checked: 1 })); // (last checked long ago)
  fetchLog = [];
  answer = fileAnswer('2026-11-01T00:00:00Z', 'never read');
  eq(await B.dailyBulk(null), null, 'nothing downloaded');
  eq(fetchLog.length, 1, `only the file details were asked for: ${fetchLog}`);
  eq(B.bulkInfo().count, 12000, 'file kept');
});
test('20 an interrupted download or a failed save leaves the file in use whole', async () => {
  const before = JSON.stringify(savedBulk().slice(0, 3));
  const broken = new ReadableStream({ start(ctl) { ctl.enqueue(new TextEncoder().encode('[\n' + bulkLines(5000).join(',\n'))); ctl.error(new TypeError('connection reset')); } });
  answer = fileAnswer('2026-11-02T00:00:00Z', broken);
  await rejects(B.downloadBulk(null), /connection reset/, 'interrupted download');
  answer = fileAnswer('2026-11-02T00:00:00Z', '[\n' + bulkLines(12000).join(',\n').slice(0, -40));
  await rejects(B.downloadBulk(null), /cut off/, 'cut-off file');
  failNextWrite = true;
  answer = fileAnswer('2026-11-02T00:00:00Z', bulkLines(13000).map(l => l.replace('#', '##')).join('\n') + '\n');
  await rejects(B.downloadBulk(null), /aborted|failed/i, 'failed save');
  const m = B.bulkInfo();
  ok(m.count === 12000 && m.updated === '2026-11-01T00:00:00Z' && m.lastError, `meta kept, error noted: ${JSON.stringify(m)}`);
  eq(savedBulk().length, 12000, 'saved file whole');
  eq(JSON.stringify(savedBulk().slice(0, 3)), before, 'saved file unchanged');
  ok(await B.bulkCard({ name: `${SNAP[5].name} #5` }), 'still answers');
});
test('21 a file with damaged cards, duplicates, too few cards, or from another host is refused', async () => {
  answer = fileAnswer('2026-11-03T00:00:00Z', bulkLines(12000, 600).join('\n'));
  await rejects(B.downloadBulk(null), /600 of 12000 cards in the file are damaged/, 'damaged cards');
  answer = fileAnswer('2026-11-03T00:00:00Z', [...bulkLines(11000), ...bulkLines(50)].join('\n'));
  await rejects(B.downloadBulk(null), /appear twice/, 'duplicates');
  answer = fileAnswer('2026-11-03T00:00:00Z', bulkLines(4000).join('\n'));
  await rejects(B.downloadBulk(null), /incomplete/, 'too few');
  answer = url => (url.includes('/bulk-data/') ? metaOf('2026-11-03T00:00:00Z', 'https://evil.example/cards.json') : new Response('x'));
  await rejects(B.downloadBulk(null), /wasn't usable/, 'download address on another host');
  eq(fetchLog.filter(u => u.includes('evil')).length, 0, 'never fetched');
  // (a few damaged cards are left out and counted; the rest is used)
  answer = fileAnswer('2026-11-04T00:00:00Z', bulkLines(12000, 30).join('\n'));
  eq(await B.downloadBulk(null), 11970, 'used without the damaged ones');
  eq(B.bulkInfo().invalid, 30, 'damaged ones counted');
  ok(!C.acceptList({ total: 11000, valid: 11000, invalid: 0, duplicateIds: 0, duplicateOracle: 0 }, { previous: 30000 }).ok, 'a file far smaller than the one in use is refused');
  await B.removeBulk();
});

// ---------- diagnostics (--report): how complete the card data is, kept apart from how well the engine plays the cards
// (coverage.mjs measures that): a card whose text was read is not called "implemented" here
function diagnostics(raws) {
  const t0 = performance.now();
  const lst = C.checkList(raws, { uniqueOracle: true });
  const d = { total: raws.length, validIds: 0, complete: 0, multi: lst.multiFaced, withText: 0, read: 0, readFully: 0, partly: 0, unread: 0, noText: 0, parseErrors: 0, missing: /** @type {Record<string, number>} */ ({}) };
  for (const raw of raws) {
    const k = C.completeness(raw);
    if (k.ids) d.validIds++;
    if (k.complete) d.complete++;
    for (const m of k.missing) d.missing[m] = (d.missing[m] || 0) + 1;
    if (!k.text) { d.noText++; continue; }
    d.withText++;
    let card;
    try { card = normalize(raw); } catch { d.parseErrors++; continue; }
    d.read++;
    const left = String(ignoredText(card) || '');
    const whole = String(card.fullText || card.text || '').replace(/\([^)]*\)/g, '').trim();
    if (!left) d.readFully++; else if (left.length >= whole.length * 0.9) d.unread++; else d.partly++;
  }
  return { d, lst, ms: performance.now() - t0 };
}
function writeReport(file) {
  const { d, lst, ms } = diagnostics(SNAP);
  const pct = n => `${((100 * n) / d.total).toFixed(1)}%`;
  const rows = [
    ['Cards checked', d.total, ''], ['Valid records (carddata.js check)', lst.valid, pct(lst.valid)], ['Damaged records', lst.invalid, pct(lst.invalid)],
    ['Duplicate Scryfall ids', lst.duplicateIds, ''], ['Duplicate oracle ids', lst.duplicateOracle, ''],
    ['Valid identifiers (Scryfall id and oracle id)', d.validIds, pct(d.validIds)], ['Complete source data', d.complete, pct(d.complete)],
    ['More than one face', d.multi, pct(d.multi)], ['With rules text', d.withText, pct(d.withText)], ['Without rules text (vanilla, basic lands)', d.noText, pct(d.noText)],
    ['Rules text read without an error', d.read, pct(d.read)], ['Reading errors', d.parseErrors, ''],
    ['Every ability recognised', d.readFully, pct(d.readFully)], ['Some abilities recognised, some text unread', d.partly, pct(d.partly)], ['Rules text (almost) entirely unread', d.unread, pct(d.unread)],
  ];
  const lay = Object.entries(lst.layouts).sort((a, b) => b[1] - a[1]).map(([l, n]) => `| ${l} | ${n} | ${C.layoutSupport(l).faces} | ${C.layoutSupport(l).play} |`);
  const listOf = o => (Object.keys(o).length ? Object.entries(o).map(([k, n]) => `${k} ${n}`).join(', ') : 'none');
  const md = [
    '# Card data diagnostics', '',
    'Written by `node tests/carddata.mjs --report tests/card-data.md` from `tests/cards-snapshot.json` (the 3,500 most-played Commander cards). This measures the card *data*; how well the engine *plays* each card is a separate measurement (`tests/card-coverage.md`). A card whose text was read is not called implemented here.', '',
    '| Measure | Cards | Share |', '|---|---:|---:|', ...rows.map(r => `| ${r[0]} | ${r[1]} | ${r[2]} |`), '',
    `Missing data: ${listOf(d.missing)}. Problems found: ${listOf(lst.problems)}.`, '',
    '## Layouts', '', '| Layout | Cards | Faces | Faces handled by the engine |', '|---|---:|---:|---|', ...lay, '',
    "Faces handled: full = every face is played as printed (whether each card's abilities are read is the coverage report's measure); partial = the first face is played, the others are kept as data or played in part; none = kept as data only. Every layout: `public/js/carddata.js` LAYOUT_SUPPORT.", '',
    `Checking and reading took ${ms.toFixed(0)} ms.`, '',
  ].join('\n');
  writeFileSync(file, md);
  console.log(`Card data diagnostics written to ${file}: ${d.total} cards, ${lst.valid} valid, ${d.readFully} fully read.`);
}
if (reportAt >= 0) writeReport(process.argv[reportAt + 1] || 'tests/card-data.md');

// ---------- run
let pass = 0, fail = 0;
for (const t of tests) {
  if (filter && !t.name.toLowerCase().includes(filter)) continue;
  try { await t.fn(); pass++; console.log(`  ok    ${t.name}`); } catch (e) { fail++; console.log(`  FAIL  ${t.name}\n        ${e.message}`); }
}
console.log(`Card data: ${pass + fail} tests, ${pass} passed, ${fail} failed.`);
process.exit(fail ? 1 : 0);
