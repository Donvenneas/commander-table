// Replay exactness (Phase 2A): a game saved as a replay and loaded again plays the same, whatever Scryfall and
// Commander Spellbook say by then, and whatever other games ran before it. Uses the four built-in cEDH decks with
// the card data in tests/golden-cards.json, the real deck loader (decks.js loadDeck) and the same restore steps as
// main.js loadReplayData. The browser's card database is a small in-memory stand-in, holding "today's" card data.
//   node tests/replay.mjs
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

// ---------- "today's" saved card data (cardcache.js reads it through IndexedDB): key → raw Scryfall card
const TODAY = new Map();
globalThis.indexedDB = {
  open() {
    const req = /** @type {any} */ ({});
    setTimeout(() => {
      req.result = {
        transaction() {
          const tx = /** @type {any} */ ({ objectStore: () => ({
            get(k) { const r = /** @type {any} */ ({}); setTimeout(() => { r.result = TODAY.has(k) ? { raw: TODAY.get(k) } : undefined; r.onsuccess?.(); }); return r; },
            put() {},
          }) });
          setTimeout(() => tx.oncomplete?.(), 5);
          return tx;
        },
      };
      req.onsuccess?.();
    });
    return req;
  },
};

const { Game, RULES } = await import('../public/js/engine.js');
const { Agent } = await import('../public/js/ai.js');
const { normalize, pinCards, pinReport, cardDataHash } = await import('../public/js/scryfall.js');
const { parseText, loadDeck } = await import('../public/js/decks.js');
const { CEDH_PRESETS } = await import('../public/js/presets.js');
const { deckText } = await import('../public/js/cores.js');
const { COMBOS, combosIn, combosFor } = await import('../public/js/combos.js');
const { REPLAY_FORMAT, snapshotDecks, tableSpellbook, checkReplay, readingChanges, deckCards } = await import('../public/js/replaydata.js');
const { stableJson } = await import('../public/js/util.js');

const RAW = JSON.parse(readFileSync(new URL('./golden-cards.json', import.meta.url), 'utf8'));
const find = n => { const k = n.toLowerCase(); return RAW[k] || Object.values(RAW).find(c => c.name.toLowerCase().split(' // ')[0] === k.split(' // ')[0]); };
const clone = x => JSON.parse(JSON.stringify(x));

// The four decks as a fresh page loads them from Scryfall (normalize), each with its Spellbook combos
function freshDecks(rawFor = find) {
  return CEDH_PRESETS.map(p => {
    const commanders = [], cards = [];
    for (const e of parseText(p.list).entries) {
      const raw = rawFor(e.name);
      if (e.commander) commanders.push(normalize(raw)); else cards.push({ card: normalize(raw), qty: e.qty });
    }
    return { deckName: commanders.map(c => c.name).join(' & '), commanders, cards, spellbook: [] };
  });
}
// Fill "today's" card database with the decks' card data, as a browser that loaded them once would have it
function remember(decks, change = {}) {
  for (const d of decks) for (const e of parseText(deckText(d)).entries) {
    const card = deckCards(d).find(c => c.name === e.name);
    if (card) TODAY.set(JSON.stringify(e.ident), change[card.name] ? change[card.name](clone(card.src)) : clone(card.src));
  }
}

// A Spellbook-style combo of two cheap cards from a deck, read as "wins the game", so whether a game has it changes
// how the game goes (the AI assembles and wins with it)
function testCombo(deck) {
  const inBuiltin = new Set(COMBOS.flatMap(c => c.keys));
  const cheap = deck.cards.map(c => c.card).filter(c => !c.fx.type.land && (c.cmc || 0) <= 2 && !inBuiltin.has(c.name.toLowerCase())).slice(0, 2);
  return { pieces: cheap.map(c => c.name), result: 'win', untapped: [], unsick: [], minLands: 0, minCreatures: 0, mana: 0, note: 'Commander Spellbook: test combo', source: 'spellbook' };
}

// One AI game at full speed: its result and a hash of the whole log
async function play(decks, seed, rules = RULES) {
  const styles = ['cedh', 'combo', 'balanced', 'aggressive'];
  const g = new Game(decks.map((d, k) => ({ playerName: `P${k + 1}`, deckName: d.deckName, color: '#888', agent: new Agent(styles[k]), commanders: d.commanders, cards: d.cards })),
    { beat: async () => {} }, { seed, noLearning: true, rules, spellbook: tableSpellbook(decks) });
  await g.run();
  const log = g.logEntries.map(e => e.html).join('\n');
  return { game: g, winner: g.winner?.name ?? null, round: g.round, steps: g.steps, errors: g.logEntries.filter(e => /Simulator error/.test(e.html)).length,
    log: createHash('sha1').update(log).digest('hex').slice(0, 16) };
}
const same = (a, b) => a.winner === b.winner && a.round === b.round && a.steps === b.steps && a.log === b.log;

// Saving: what main.js replayData() writes (as a file: through JSON)
const save = (decks, seed) => clone({ app: 'commander-table', version: REPLAY_FORMAT, seed, rules: RULES, seats: decks.map(d => ({ deck: deckText(d), deckName: d.deckName })), ...snapshotDecks(decks) });
// Loading: the steps of main.js loadReplayData (check, decks built from the replay's own cards, its own combos)
async function restore(data) {
  const check = checkReplay(data);
  if (check.problems.length) throw new Error(check.problems.join('; '));
  const own = !!data.cards;
  if (own) pinCards(Object.values(data.cards));
  const decks = [];
  try {
    for (const [i, s] of data.seats.entries()) {
      const d = await loadDeck(s.deck, () => {}, { format: 'commander' });
      d.spellbook = own ? clone(data.spellbook[i] || []) : [];
      decks.push(d);
    }
  } finally { if (own) pinCards(null); }
  return { decks, check, report: own ? clone(pinReport()) : null, changed: readingChanges(data, decks) };
}

// ---------- the tests
let pass = 0, fail = 0;
const results = [];
async function test(name, f) {
  try { await f(); pass++; results.push(`  ok    ${name}`); }
  catch (e) { fail++; results.push(`  FAIL  ${name}: ${e.message}`); }
}
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const SEED = 50001;

const decks0 = freshDecks();
decks0[0].spellbook = [testCombo(decks0[0])];
remember(decks0);
const original = await play(decks0, SEED);
const replay = save(decks0, SEED);

await test('a saved game reloads with the same decks, combos and rules, and plays the same', async () => {
  const r = await restore(replay);
  assert(r.check.exact, `restore notes: ${r.check.notes.join(' ')}`);
  assert(r.report.notSaved.length === 0, `cards not in the replay: ${r.report.notSaved.join(', ')}`);
  assert(r.report.used > 0, 'no card came from the replay');
  assert(stableJson(snapshotDecks(r.decks)) === stableJson(snapshotDecks(decks0)), 'the restored decks differ from the saved ones');
  const again = await play(r.decks, SEED);
  assert(same(again, original), `game differs: ${JSON.stringify({ ...original, game: 0 })} vs ${JSON.stringify({ ...again, game: 0 })}`);
  assert(!original.errors && !again.errors, 'simulator errors');
});

await test('the replay keeps every card, its hash, its reading, the Spellbook combos and the rules versions', async () => {
  const all = new Set(decks0.flatMap(d => deckCards(d).map(c => c.id)));
  assert([...all].every(id => replay.cards[id] && replay.hashes[id] && replay.readings[id]), 'a card is missing from the replay');
  assert(Object.entries(replay.cards).every(([id, raw]) => cardDataHash(raw) === replay.hashes[id]), 'a saved hash does not match its card');
  assert(replay.cards[decks0[0].commanders[0].id].oracle_text === decks0[0].commanders[0].src.oracle_text, 'the Oracle text is not saved');
  assert(replay.spellbook.length === 4 && replay.spellbook[0][0].pieces.length === 2 && 'minLands' in replay.spellbook[0][0], 'the Spellbook combos or their prerequisites are not saved');
  assert(replay.builtinCombos && replay.engineRules === RULES && replay.rules === RULES && replay.seed === SEED && replay.version === REPLAY_FORMAT, 'versions, seed or combo fingerprint missing');
});

await test('Scryfall card data changed since: the replay uses the saved cards, and says which changed', async () => {
  const cmd = decks0[1].commanders[0];
  const changed = raw => ({ ...raw, oracle_text: '', mana_cost: '{15}', cmc: 15 });
  // (today's data: the commander costs 15 and does nothing; a game built from it plays differently)
  remember(decks0, { [cmd.name]: changed });
  const todayDecks = freshDecks(n => (n.toLowerCase() === cmd.name.toLowerCase() ? changed(find(n)) : find(n)));
  todayDecks[0].spellbook = decks0[0].spellbook;
  const withToday = await play(todayDecks, SEED);
  assert(!same(withToday, original), 'the changed card data did not change the game, so this test proves nothing');
  const r = await restore(replay);
  assert(r.report.differs.includes(cmd.name), `the change was not noted (differs: ${r.report.differs.join(', ')})`);
  const restoredCmd = r.decks[1].commanders[0];
  assert(restoredCmd.text === cmd.text && restoredCmd.manaCost === cmd.manaCost, 'the restored commander has today\'s data, not the saved data');
  assert(same(await play(r.decks, SEED), original), 'the replay played differently with changed Scryfall data');
  remember(decks0);
});

await test('Commander Spellbook answers differently now: the replay uses its saved combos', async () => {
  // (today's answer: no combos for the deck; a game with that answer plays differently)
  const todayDecks = freshDecks();
  const withToday = await play(todayDecks, SEED);
  assert(!same(withToday, original), 'the Spellbook combo did not change the game, so this test proves nothing');
  const r = await restore(replay);
  assert(stableJson(r.decks[0].spellbook) === stableJson(decks0[0].spellbook), 'the restored deck does not have the saved combos');
  assert(same(await play(r.decks, SEED), original), 'the replay played differently');
});

await test('another deck played (with its own Spellbook combos) before loading: the replay plays the same', async () => {
  const other = freshDecks();
  other[2].spellbook = [testCombo(other[2])];
  other[3].spellbook = [{ ...testCombo(other[3]), result: 'damage' }];
  const g = await play(other, SEED + 7);
  assert(g.game.comboBook.list.length > COMBOS.length, 'the other game did not get its combos');
  const r = await restore(replay);
  const again = await play(r.decks, SEED);
  assert(same(again, original), 'the replay played differently after another game');
  const extra = again.game.comboBook.list.slice(COMBOS.length).map(c => c.label);
  assert(extra.length === 1 && extra[0] === decks0[0].spellbook[0].pieces.join(' + '), `the replay's game has other combos: ${extra.join(', ')}`);
});

await test("one game's combos can't reach another game or the built-in list", async () => {
  const a = freshDecks(), b = freshDecks();
  a[0].spellbook = [testCombo(a[0])];
  const builtin = COMBOS.length;
  const ga = new Game(a.map((d, k) => ({ playerName: `A${k}`, deckName: d.deckName, color: '#888', agent: new Agent('balanced'), commanders: d.commanders, cards: d.cards })), { beat: async () => {} }, { seed: 1, noLearning: true, spellbook: tableSpellbook(a) });
  const gb = new Game(b.map((d, k) => ({ playerName: `B${k}`, deckName: d.deckName, color: '#888', agent: new Agent('balanced'), commanders: d.commanders, cards: d.cards })), { beat: async () => {} }, { seed: 1, noLearning: true, spellbook: tableSpellbook(b) });
  const label = a[0].spellbook[0].pieces.join(' + ');
  assert(ga.players[0].combos.some(c => c.label === label), 'the game with the combo does not have it');
  assert(!gb.players.some(p => p.combos.some(c => c.label === label)), 'the combo leaked into another game');
  assert(gb.comboBook.list.length === builtin && COMBOS.length === builtin, 'the built-in list grew');
  const piece = a[0].cards.find(c => c.card.name === a[0].spellbook[0].pieces[0]).card;
  assert(!combosFor(piece).some(c => c.label === label) && !combosIn(deckCards(a[0])).some(c => c.label === label), 'the combo leaked into the built-in lookups');
  assert(combosIn(deckCards(a[0]), a[0].spellbook).some(c => c.label === label), "a deck's own combos are found when given");
  let frozen = false;
  try { /** @type {any} */ (COMBOS).push({}); } catch { frozen = true; }
  assert(frozen && COMBOS.length === builtin, 'the built-in combo list can be changed');
});

await test('hashes catch changed card data, readings and combo lists', async () => {
  const bad = clone(replay);
  const id = decks0[2].commanders[0].id;
  bad.cards[id].oracle_text += ' Flying.';
  const c1 = checkReplay(bad);
  assert(c1.problems.length === 1 && c1.problems[0].includes(decks0[2].commanders[0].name), `edited card not caught: ${c1.problems.join('; ')}`);
  let refused = false;
  try { await restore(bad); } catch { refused = true; }
  assert(refused, 'a damaged replay was loaded anyway');
  const r = await restore({ ...clone(replay), readings: { ...replay.readings, [id]: 'not the same' } });
  assert(r.changed.length === 1 && r.changed[0] === decks0[2].commanders[0].name, `a changed reading was not noted: ${r.changed.join(', ')}`);
  const c2 = checkReplay({ ...clone(replay), builtinCombos: 'older list' });
  assert(!c2.problems.length && !c2.exact && /built-in combo list has changed/.test(c2.notes.join(' ')), 'a changed built-in combo list was not noted');
  const c3 = checkReplay({ ...clone(replay), spellbook: undefined });
  assert(c3.problems.length === 1, 'missing Spellbook combos not caught');
});

await test('replays from before format 7 still load (with today\'s data) and say they may differ', async () => {
  // (what replayData() wrote before this change: version 2 and no card data or combos)
  const old = { app: 'commander-table', version: 2, seed: SEED, rules: RULES, seats: replay.seats };
  const r = await restore(old);
  assert(!r.check.exact && r.check.notes.length === 1 && /saved before replays kept their own card data/.test(r.check.notes[0]), 'no note about the old format');
  // (with unchanged card data and no Spellbook combos it plays as the same game did)
  const plain = freshDecks();
  assert(same(await play(r.decks, SEED), await play(plain, SEED)), 'an old replay played differently from the same game today');
  // (a replay from a newer app is refused with the reason)
  const newer = checkReplay({ ...clone(replay), rules: RULES + 1 });
  assert(newer.problems.length === 1 && /newer than this app/.test(newer.problems[0]), 'a replay from a newer rules version was not refused');
  // (replays saved by rules 4 games still carry their rules version and play under it)
  const r4 = await restore({ ...clone(replay), rules: 4 });
  assert(same(await play(r4.decks, SEED, 4), await play(decks0, SEED, 4)), 'a rules 4 replay played differently');
});

await test('restoring is deterministic: the same replay loaded twice plays the same both times', async () => {
  const a = await restore(replay), b = await restore(replay);
  const ga = new Game(a.decks.map((d, k) => ({ playerName: `P${k + 1}`, deckName: d.deckName, color: '#888', agent: new Agent('balanced'), commanders: d.commanders, cards: d.cards })), { beat: async () => {} }, { seed: SEED, noLearning: true, spellbook: tableSpellbook(a.decks) });
  const gb = new Game(b.decks.map((d, k) => ({ playerName: `P${k + 1}`, deckName: d.deckName, color: '#888', agent: new Agent('balanced'), commanders: d.commanders, cards: d.cards })), { beat: async () => {} }, { seed: SEED, noLearning: true, spellbook: tableSpellbook(b.decks) });
  const start = g => g.players.map(p => [...p.command, ...p.library].map(o => `${o.iid}:${o.card.name}`).join(','));
  assert(stableJson(start(ga)) === stableJson(start(gb)), 'the starting games differ');
  assert(same(await play(a.decks, SEED), await play(b.decks, SEED)), 'two loads of the same replay played differently');
});

console.log(`The saved game: ${original.winner ?? 'no winner'} in round ${original.round}, ${original.steps} steps, combos tried: ${original.game.comboLog.map(c => `${c.label}${c.landed ? ' (landed)' : ''}`).join('; ') || 'none'}.`);
console.log(results.join('\n'));
console.log(`Replays: ${pass + fail} tests, ${pass} passed, ${fail} failed.`);
if (fail) process.exit(1);
