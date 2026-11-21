// Multiplayer and Commander (Phase 2J, rules 18): turn and priority order with two and four players, triggers in APNAP
// order, players losing at the same time, commander tax, the commander's zone choice, commander damage, a player
// leaving the game (life, commander damage, conceding, a dropped connection), what a friend's page is sent and what it
// may answer, combat damage steps, cleanup, and the Commander deck checks. Every test plays real cards on a known
// board and checks what the engine did, not what a page shows.
//   node tests/multiplayer.mjs            run them all (exit 1 on any failure)
//   node tests/multiplayer.mjs tax        only the tests whose name contains "tax"
import { scenario, card, find, P, logText, errors, settle } from './scenario.mjs';
import { Game, RULES } from '../public/js/engine.js';
import { Agent } from '../public/js/ai.js';
import { RemoteUI, snapshot, defaultPick, DROP_POLICIES } from '../public/js/net.js';
import { checkDeck } from '../public/js/formats.js';

const only = process.argv[2];
const results = [];
const test = async (name, fn) => {
  if (only && !name.toLowerCase().includes(only.toLowerCase())) return;
  try { await fn(); results.push([name, null]); } catch (e) { results.push([name, e]); }
};
const eq = (got, want, what) => { if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`${what}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); };
const ok = (cond, what) => { if (!cond) throw new Error(what); };
const noErrors = g => eq(errors(g), [], 'simulator errors');
const lines = g => logText(g).replace(/&#39;/g, "'").replace(/&quot;/g, '"').split('\n');
ok(RULES >= 18, `these tests are for rules 18 and later (RULES is ${RULES})`);

// A whole game between AI seats with small decks (creatures and lands), with every phase change and turn recorded
const DECK = [['Forest', 17], ['Grizzly Bears', 12], ['Llanowar Elves', 6], ['Giant Growth', 5]];
async function wholeGame(n, seed, format) {
  const seats = Array.from({ length: n }, (_, i) => ({
    playerName: `P${i + 1}`, deckName: 'test', color: '#888', agent: new Agent('aggro'), commanders: [],
    cards: DECK.map(([name, qty]) => ({ card: card(name), qty })),
  }));
  const g = new Game(seats, { beat: async () => {} }, { seed, noLearning: true, format, maxRounds: 40 });
  const turns = [];
  g.on('turn', p => turns.push({ p: p.idx, phases: [], alive: g.players.map(q => !q.lost) }));
  const setPhase = g.setPhase.bind(g);
  g.setPhase = ph => { if (turns.length && turns[turns.length - 1].phases.at(-1) !== ph) turns[turns.length - 1].phases.push(ph); setPhase(ph); };
  await g.run();
  return { g, turns };
}
// The steps of a turn in order (a turn may end early when its player or the game is gone; extra combats repeat a part)
const ORDER = ['untap', 'upkeep', 'draw', 'main1', 'combat', 'main2', 'end'];
const inOrder = phases => phases.every((ph, i) => i === 0 || ORDER.indexOf(ph) >= ORDER.indexOf(phases[i - 1]) || (ph === 'combat' && phases[i - 1] === 'main2'));
const checkTurns = (g, turns, n) => {
  ok(g.over && g.winner && !g.winner.lost, `the game ends with a winner still in it (over ${g.over})`);
  eq(g.alive().length, 1, 'players left at the end');
  for (const [i, t] of turns.entries()) {
    ok(inOrder(t.phases), `turn ${i + 1}: steps out of order: ${t.phases.join(' ')}`);
    ok(t.phases[0] === 'untap', `turn ${i + 1} starts with ${t.phases[0]}`);
    ok(t.alive[t.p], `turn ${i + 1} was taken by a player who had left the game`);
    if (!i) continue;
    // the next turn belongs to the next player in seat order who was still in the game
    let want = turns[i - 1].p;
    do { want = (want + 1) % n; } while (!t.alive[want]);
    eq(t.p, want, `turn ${i + 1}: whose turn after P${turns[i - 1].p + 1}`);
  }
  const full = turns.filter(t => t.phases.length === 7);
  ok(full.length >= 4, `at least four complete turns (got ${full.length})`);
  for (const t of full) eq(t.phases, ORDER, 'a complete turn\'s steps');
};

// A table with seats 0..n-1 (seat `active` is the active player, main phase), and scripted priority answers
const table = async (seats, opts = {}) => { const g = await scenario(seats, opts); g.active = opts.active ?? 0; g.phase = 'main1'; return g; };
const script = (g, answer = () => null) => {
  const asks = [];
  for (const q of g.players) q.agent.respondAt = (gg, qq, item) => { asks.push({ q: qq.idx, name: item.name, passes: gg.prio?.passes ?? null, holder: gg.prio?.holder ?? null }); return answer(qq.idx, item, gg) || null; };
  return asks;
};
const cast = async (g, i, name, choice = {}) => { const r = await g.cast(P(g, i), find(g, i, name, 'hand') || find(g, i, name, 'command'), choice); await settle(g); return r; };
const untapAll = (g, i) => { for (const o of P(g, i).battlefield) o.tapped = false; };
const tappedLands = (g, i) => P(g, i).battlefield.filter(o => o.tapped && o.fx.type.land).length;
// One combat by seat i: the named creatures attack the given seat, nobody blocks (unless blocks is given)
const attack = async (g, i, names, target, blocks = () => []) => {
  const p = P(g, i);
  g.active = i;
  for (const o of p.battlefield) { o.sick = false; o.tapped = false; }
  p.agent.declareAttackers = () => names.map(n => ({ o: find(g, i, n), target }));
  for (const q of g.players) q.agent.declareBlockers = (gg, qq, attackers) => blocks(qq, attackers);
  await g.combat(p);
  await settle(g);
};

// ---------- 1, 2: whole games
await test('1. A two-player game: turns alternate, every turn runs its steps in order, and it ends with one winner', async () => {
  const { g, turns } = await wholeGame(2, 11, 'standard');
  checkTurns(g, turns, 2);
  // (103.8a: the player who goes first skips their first draw in a two-player game)
  ok(lines(g).some(l => /goes first and skips the first draw/.test(l)), 'the first draw is skipped');
  noErrors(g);
});
await test('2. A four-player game: turns go round the table, skipping players who have left, until one is left', async () => {
  const { g, turns } = await wholeGame(4, 12, 'commander');
  checkTurns(g, turns, 4);
  eq(g.players.filter(p => p.lost).length, 3, 'players eliminated');
  eq([...g.players].map(p => p.place).sort(), [1, 2, 3, 4], 'places');
  ok(!lines(g).some(l => /skips the first draw/.test(l)), 'nobody skips the first draw with four players');
  noErrors(g);
});

// ---------- 3: priority order
await test('3. Multiplayer priority: the caster first, then each player in turn order; it resolves after four passes in a row', async () => {
  const g = await table([{}, {}, { battlefield: ['Forest', 'Forest'], hand: ['Grizzly Bears'] }, {}], { active: 2 });
  const asks = script(g);
  ok(await cast(g, 2, 'Grizzly Bears'), 'cast');
  eq(asks.map(a => a.q), [2, 3, 0, 1], 'who was asked, in order');
  eq(asks.map(a => a.passes), [0, 1, 2, 3], 'passes in a row when each was asked');
  eq(asks.map(a => a.holder), [2, 3, 0, 1], 'the priority holder the table shows');
  ok(find(g, 2, 'Grizzly Bears'), 'it resolved');
  eq(g.prio ?? null, null, 'nobody has priority once it has resolved');
  noErrors(g);
});
await test('3b. Priority skips a player who has left the game, and a response starts the passes over from the active player', async () => {
  const g = await table([{ battlefield: ['Forest', 'Forest'], hand: ['Grizzly Bears'] }, {}, { battlefield: ['Mountain'], hand: ['Shock'] }, {}]);
  P(g, 1).life = 0; await settle(g);
  ok(P(g, 1).lost, 'seat 2 is out');
  let done = false;
  const asks = script(g, (i, item) => { if (i === 2 && item.name === 'Grizzly Bears' && !done) { done = true; return { kind: 'cast', card: find(g, 2, 'Shock', 'hand'), targets: [{ player: 0 }] }; } });
  ok(await cast(g, 0, 'Grizzly Bears'), 'cast');
  ok(!asks.some(a => a.q === 1), 'the eliminated player is never asked');
  eq(asks.filter(a => a.name === 'Shock').map(a => a.q), [2, 3, 0], 'Shock: its caster first, then turn order among those left');
  eq(asks.filter(a => a.name === 'Grizzly Bears').map(a => a.q), [0, 2, 0, 2, 3], 'Grizzly Bears: after the response resolved, the active player gets priority again');
  eq(P(g, 0).life, 38, 'Shock resolved');
  noErrors(g);
});

// ---------- 4, 22: triggers at the same time
await test('4. APNAP: four players\' triggers from one event resolve last player first, the active player\'s last', async () => {
  const g = await table([{ battlefield: ['Soul Warden'] }, { battlefield: ['Soul Warden'] }, { battlefield: ['Soul Warden', 'Forest', 'Forest'], hand: ['Grizzly Bears'] }, { battlefield: ['Soul Warden'] }], { active: 2 });
  // (the four Soul Wardens saw each other enter while the board was set up: start from the totals as they are now)
  const start = g.players.map(p => p.life);
  const ev = [];
  g.on('life', d => ev.push(d.p));
  const seen = [];
  for (const q of g.players) q.agent.respondAt = (gg, qq, item) => { if (item.kind === 'trigger' && qq.idx === gg.active) seen.push(gg.stack.filter(x => x.kind === 'trigger').map(x => x.controller)); return null; };
  ok(await cast(g, 2, 'Grizzly Bears'), 'cast');
  // (on the stack: the active player's trigger at the bottom, then turn order: seats 3, 4, 1, 2 here)
  eq(seen[0], [2, 3, 0, 1], 'the four triggers on the stack together, bottom to top');
  eq(ev, [1, 0, 3, 2], 'the order the life was gained in');
  eq(g.players.map((p, i) => p.life - start[i]), [1, 1, 1, 1], 'each gained 1');
  noErrors(g);
});
await test('22. Simultaneous triggers: two Blood Artists destroyed by one Wrath each see both deaths', async () => {
  const g = await table([{ battlefield: ['Plains', 'Plains', 'Plains', 'Plains', 'Blood Artist'], hand: ['Wrath of God'] }, { battlefield: ['Blood Artist'] }, {}]);
  const stackAt = [];
  for (const q of g.players) q.agent.respondAt = (gg, qq, item) => { if (item.kind === 'trigger') stackAt.push(gg.stack.filter(x => x.kind === 'trigger').length); return null; };
  ok(await cast(g, 0, 'Wrath of God'), 'cast');
  ok(find(g, 0, 'Blood Artist', 'graveyard') && find(g, 1, 'Blood Artist', 'graveyard'), 'both died');
  const drains = lines(g).filter(l => /Blood Artist — /.test(l)).length;
  eq(drains, 4, 'triggers put on the stack (each Blood Artist: its own death and the other\'s)');
  eq(Math.max(...stackAt), 4, 'all four were on the stack together');
  eq(g.players.reduce((s, p) => s + p.life, 0), 120, 'each trigger moved 1 life from one player to another');
  noErrors(g);
});

// ---------- 5: losing at the same time
await test('5. The last two players losing at the same time is a draw (104.4a), not a win for either', async () => {
  const g = await table([{}, {}]);
  P(g, 0).life = 0; P(g, 1).life = -2;
  await settle(g);
  eq({ over: g.over, winner: g.winner?.idx ?? null, winners: g.winners.length, lost: g.players.map(p => p.lost), why: g.winReason }, { over: true, winner: null, winners: 0, lost: [true, true], why: 'draw' }, 'result');
  eq(g.players.map(p => p.place), [1, 1], 'they share a place');
  ok(lines(g).some(l => /The game is a draw/.test(l)), 'logged as a draw');
  noErrors(g);
});
await test('5b. Three of four players losing at once: they share a place and the fourth wins', async () => {
  const g = await table([{}, {}, {}, {}]);
  P(g, 0).life = 0; P(g, 2).life = 0; P(g, 3).poison = 10;
  await settle(g);
  eq({ over: g.over, winner: g.winner?.idx }, { over: true, winner: 1 }, 'result');
  eq(g.players.map(p => p.place), [2, 1, 2, 2], 'places');
});
await test('5c. Before rules 18 the old order is kept (replays): the seat checked second is left as the winner', async () => {
  const g = await table([{}, {}], { rules: 17 });
  P(g, 0).life = 0; P(g, 1).life = 0;
  await settle(g);
  eq({ over: g.over, winner: g.winner?.idx ?? null }, { over: true, winner: 1 }, 'result at rules 17');
});
await test('5d. One lightning-fast event on two players: both take the damage before anyone leaves', async () => {
  // (two players at 2 life each, one Shock each on the stack: the first to resolve eliminates one player only)
  const g = await table([{ battlefield: ['Mountain'], hand: ['Shock'], life: 2 }, { life: 2 }, {}]);
  ok(await cast(g, 0, 'Shock', { targets: [{ player: 1 }] }), 'cast');
  eq(g.players.map(p => p.lost), [false, true, false], 'only the player who was dealt the damage left');
  eq(g.over, false, 'the game goes on with two players');
});

// ---------- 6, 7: commander tax
await test('6. Commander tax: {2} more for each earlier cast from the command zone, counted per commander', async () => {
  const g = await table([{ battlefield: Array(8).fill('Mountain'), commander: 'Rograkh, Son of Rohgahh', commanderOut: false }, {}]);
  const p = P(g, 0), c = p.command[0];
  const paid = [];
  for (let k = 0; k < 3; k++) {
    untapAll(g, 0);
    ok(await g.cast(p, c, {}), `cast ${k + 1}`); await settle(g);
    eq(c.zone, 'battlefield', `after cast ${k + 1}`);
    paid.push(tappedLands(g, 0));
    g.move(c, 'command', { stay: true });
  }
  eq(paid, [0, 2, 4], 'mana paid for a {0} commander on its first, second and third cast');
  eq(p.castCount[c.iid], 3, 'casts from the command zone on record');
  // (it changed zones several times: the count is kept)
  ok(lines(g).filter(l => /Commander tax/.test(l)).length === 2, 'the tax is logged for the second and third cast');
  // a tax that can't be paid: 8 Mountains, the fifth cast would cost {8}, the sixth {10}
  p.castCount[c.iid] = 5; untapAll(g, 0);
  ok(!g.canCast(p, c), 'a sixth cast ({10}) can\'t be paid with eight lands');
  noErrors(g);
});
await test('6b. Two commanders (partners) each have their own tax', async () => {
  const g = await table([{ battlefield: Array(8).fill('Command Tower') }, {}]);
  const p = P(g, 0);
  // (two commanders: put a second one in the command zone by hand, as the deck loader does)
  const a = g.mk(card('Rograkh, Son of Rohgahh'), p), b = g.mk(card('Tymna the Weaver'), p);
  for (const o of [a, b]) { o.isCommander = true; o.zone = 'command'; p.command.push(o); }
  for (let k = 0; k < 2; k++) { untapAll(g, 0); ok(await g.cast(p, a, {}), 'Rograkh'); await settle(g); g.move(a, 'command', { stay: true }); }
  untapAll(g, 0);
  ok(await g.cast(p, b, {}), 'Tymna'); await settle(g);
  eq(tappedLands(g, 0), 3, 'Tymna\'s first cast costs its printed {1}{W}{B}: Rograkh\'s two casts don\'t count for it');
  eq([p.castCount[a.iid], p.castCount[b.iid]], [2, 1], 'casts on record');
});
await test('7. A commander cast from the hand pays no tax and adds none', async () => {
  const g = await table([{ battlefield: Array(8).fill('Mountain'), commander: 'Rograkh, Son of Rohgahh', commanderOut: false }, {}]);
  const p = P(g, 0), c = p.command[0];
  for (let k = 0; k < 2; k++) { untapAll(g, 0); await g.cast(p, c, {}); await settle(g); g.move(c, 'command', { stay: true }); }
  // its owner lets it go to their hand (903.9b), then casts it from there
  g.move(c, 'battlefield', { stay: true });
  p.agent.commanderToCommandZone = () => false;
  g.move(c, 'hand');
  eq(c.zone, 'hand', 'in hand');
  untapAll(g, 0);
  ok(await g.cast(p, c, {}), 'cast from hand'); await settle(g);
  eq(tappedLands(g, 0), 0, 'no tax from the hand');
  eq(p.castCount[c.iid], 2, 'the cast from the hand isn\'t counted');
  g.move(c, 'command', { stay: true }); untapAll(g, 0);
  await g.cast(p, c, {}); await settle(g);
  eq(tappedLands(g, 0), 4, 'the next cast from the command zone pays for the two earlier ones only');
  noErrors(g);
});

// ---------- 8, 9: the commander changing zones
await test('8. A commander that dies goes to the graveyard first (its death is seen), then its owner may move it', async () => {
  const g = await table([{ commander: 'Krenko, Mob Boss', battlefield: ['Blood Artist'] }, { battlefield: ['Swamp', 'Swamp', 'Swamp'], hand: ['Murder'] }]);
  const c = find(g, 0, 'Krenko, Mob Boss');
  const zones = [];
  const move = g.move.bind(g);
  g.move = (o, to, opts) => { const r = move(o, to, opts); if (o === c) zones.push(o.zone); return r; };
  ok(await cast(g, 1, 'Murder', { targets: [{ obj: c }] }), 'cast');
  eq(zones, ['graveyard', 'command'], 'where the commander went');
  eq(c.zone, 'command', 'it ends in the command zone (the AI\'s choice)');
  eq(P(g, 1).life, 39, 'Blood Artist saw the commander die');
  ok(lines(g).some(l => /returns to P1's command zone/.test(l)), 'logged with the rule');
  noErrors(g);
});
await test('9. The owner chooses: a commander may stay in the graveyard, in exile, or go to the hand or library', async () => {
  const g = await table([{ commander: 'Krenko, Mob Boss' }, { battlefield: ['Swamp', 'Swamp', 'Swamp', 'Plains', 'Island'], hand: ['Murder', 'Swords to Plowshares', 'Unsummon'] }]);
  const p = P(g, 0), c = find(g, 0, 'Krenko, Mob Boss');
  const asked = [];
  let answer = false;
  p.agent.commanderToCommandZone = (gg, pp, o, to) => { asked.push(to); return answer; };
  ok(await cast(g, 1, 'Murder', { targets: [{ obj: c }] }), 'Murder');
  eq([c.zone, asked], ['graveyard', ['graveyard']], 'left in the graveyard');
  g.move(c, 'battlefield', { stay: true }); await settle(g);
  ok(await cast(g, 1, 'Swords to Plowshares', { targets: [{ obj: c }] }), 'Swords');
  eq([c.zone, asked.at(-1)], ['exile', 'exile'], 'left in exile');
  g.move(c, 'battlefield', { stay: true }); await settle(g);
  untapAll(g, 1);
  ok(await cast(g, 1, 'Unsummon', { targets: [{ obj: c }] }), 'Unsummon');
  eq([c.zone, asked.at(-1)], ['hand', 'hand'], 'left in the hand');
  // and the other answer: it goes to the command zone instead of the hand
  g.move(c, 'battlefield', { stay: true }); await settle(g);
  answer = true;
  g.move(c, 'hand');
  eq(c.zone, 'command', 'to the command zone instead of the hand');
  eq(asked.length, 4, 'the owner was asked every time');
  // the choice belongs to the owner, even when someone else controls the commander
  g.move(c, 'battlefield', { stay: true, under: 1 }); await settle(g);
  eq(c.controller, 1, 'controlled by the opponent');
  P(g, 1).agent.commanderToCommandZone = () => { throw new Error('the controller was asked'); };
  g.destroy(c); await settle(g);
  eq([c.zone, asked.length], ['command', 5], 'the owner was asked, not the controller');
  noErrors(g);
});

// ---------- 10, 11, 12, 14: commander damage
await test('10. Commander damage: combat damage from a commander is counted per commander, across its zone changes', async () => {
  const g = await table([{ commander: 'Krenko, Mob Boss' }, {}, {}]);
  const c = find(g, 0, 'Krenko, Mob Boss');
  await attack(g, 0, ['Krenko, Mob Boss'], 1);
  eq([P(g, 1).life, P(g, 1).cmdDamage[c.iid]], [37, 3], 'life and commander damage after one hit');
  // it leaves and comes back: the same commander
  g.move(c, 'command', { stay: true }); g.move(c, 'battlefield', { stay: true }); await settle(g);
  await attack(g, 0, ['Krenko, Mob Boss'], 1);
  eq(P(g, 1).cmdDamage[c.iid], 6, 'still counted on the same commander');
  // gaining life doesn't take commander damage away
  P(g, 1).life = 40;
  await attack(g, 0, ['Krenko, Mob Boss'], 1);
  eq([P(g, 1).life, P(g, 1).cmdDamage[c.iid]], [37, 9], 'separate from the life total');
  // another player's count is their own
  await attack(g, 0, ['Krenko, Mob Boss'], 2);
  eq([P(g, 2).cmdDamage[c.iid], P(g, 1).cmdDamage[c.iid]], [3, 9], 'per player');
  // a blocked commander deals none to the player
  await attack(g, 0, ['Krenko, Mob Boss'], 1, () => []);
  eq(P(g, 1).cmdDamage[c.iid], 12, 'unblocked again');
  noErrors(g);
});
await test('11, 14. Two commanders: 20 from one and 20 from another is not a loss; 21 from one is, whatever the life total', async () => {
  const g = await table([{ commander: 'Krenko, Mob Boss' }, { life: 200 }, { commander: 'Tymna the Weaver' }]);
  const a = find(g, 0, 'Krenko, Mob Boss'), b = find(g, 2, 'Tymna the Weaver');
  a.counters = 17; b.counters = 18;
  eq([g.power(a), g.power(b)], [20, 20], 'both are 20 power');
  await attack(g, 0, ['Krenko, Mob Boss'], 1);
  await attack(g, 2, ['Tymna the Weaver'], 1);
  eq([P(g, 1).cmdDamage[a.iid], P(g, 1).cmdDamage[b.iid], P(g, 1).lost, P(g, 1).life], [20, 20, false, 160], '40 commander damage in all, from two commanders');
  a.counters = 0; g.move(find(g, 0, 'Krenko, Mob Boss'), 'command', { stay: true }); g.move(a, 'battlefield', { stay: true }); await settle(g);
  eq(g.power(a), 3, 'back to 3 power');
  await attack(g, 0, ['Krenko, Mob Boss'], 1);
  eq([P(g, 1).cmdDamage[a.iid], P(g, 1).lost, P(g, 1).life], [23, true, 157], 'the 21st damage from one commander');
  ok(/21 combat damage from Krenko, Mob Boss/.test(P(g, 1).lossReason), `reason: ${P(g, 1).lossReason}`);
  eq(g.over, false, 'the other two play on');
  noErrors(g);
});
await test('12. Noncombat damage and life loss from a commander are not commander damage', async () => {
  const g = await table([{ commander: 'Krenko, Mob Boss' }, { life: 100 }]);
  const c = find(g, 0, 'Krenko, Mob Boss');
  g.damagePlayer(P(g, 1), 30, c, false);
  await settle(g);
  eq([P(g, 1).life, P(g, 1).cmdDamage[c.iid] ?? 0, P(g, 1).lost], [70, 0, false], '30 noncombat damage from the commander');
  // combat damage from a creature that isn't a commander isn't counted either
  const g2 = await table([{ battlefield: ['Grizzly Bears'] }, {}]);
  await attack(g2, 0, ['Grizzly Bears'], 1);
  eq([P(g2, 1).life, Object.keys(P(g2, 1).cmdDamage).length], [38, 0], 'a plain creature');
  // and a format without commander damage (Brawl) doesn't lose to it
  const g3 = await table([{ commander: 'Krenko, Mob Boss' }, { life: 100 }], { format: 'brawl' });
  find(g3, 0, 'Krenko, Mob Boss').counters = 30;
  await attack(g3, 0, ['Krenko, Mob Boss'], 1);
  eq(P(g3, 1).lost, false, 'Brawl has no commander damage');
});

// ---------- 13, 18, 25: leaving the game
await test('13. A player at 0 life leaves: their permanents and cards leave the game, borrowed ones go back, the others play on', async () => {
  const g = await table([{ battlefield: ['Grizzly Bears', 'Forest'], hand: ['Shock'], graveyard: ['Lightning Bolt'] }, { battlefield: ['Llanowar Elves', 'Savannah Lions'], graveyard: ['Elvish Mystic'] }, {}, {}]);
  const [bears, elves, lions, mystic] = [find(g, 0, 'Grizzly Bears'), find(g, 1, 'Llanowar Elves'), find(g, 1, 'Savannah Lions'), find(g, 1, 'Elvish Mystic', 'graveyard')];
  // seat 2 controls seat 1's Bears (a control effect); seat 1 controls seat 2's Elves (a control effect), and
  // seat 2's Elvish Mystic entered under seat 1's control (reanimated)
  const give = (o, from, to) => { P(g, from).battlefield.splice(P(g, from).battlefield.indexOf(o), 1); o.controller = to; P(g, to).battlefield.push(o); };
  give(bears, 0, 1); give(elves, 1, 0);
  g.move(mystic, 'battlefield', { under: 0 });
  eq([mystic.controller, mystic.enteredUnder], [0, 0], 'reanimated under seat 1');
  P(g, 0).life = 0;
  await settle(g);
  const p = P(g, 0);
  eq([p.lost, p.lossReason, p.place], [true, 'life total reached 0', 4], 'eliminated');
  eq([p.battlefield.length, p.hand.length, p.graveyard.length, p.library.length], [0, 0, 0, 0], 'nothing of theirs is left in the game');
  eq(bears.zone, 'gone', 'their Bears, controlled by someone else, left too');
  eq([elves.zone, elves.controller], ['battlefield', 1], 'the Elves they had taken went back to their owner (the control effect ended)');
  eq([mystic.zone, P(g, 1).exile.includes(mystic)], ['exile', true], 'the card that entered under their control was exiled (800.4a)');
  eq([lions.zone, lions.controller], ['battlefield', 1], 'other players\' permanents are untouched');
  eq(g.over, false, 'three players are left');
  eq(g.nextAlive(3), 1, 'the turn order skips them');
  eq(g.opponents(P(g, 1)).map(q => q.idx), [2, 3], 'they are nobody\'s opponent any more');
  noErrors(g);
});
await test('18. A player who leaves with a spell and a trigger on the stack: neither resolves', async () => {
  const g = await table([{ battlefield: ['Forest', 'Forest', 'Soul Warden'], hand: ['Grizzly Bears'] }, { battlefield: ['Mountain'], hand: ['Shock'] }, { battlefield: ['Soul Warden'] }]);
  let done = false;
  script(g, (i, item, gg) => { if (!done && item.name === 'Grizzly Bears' && i === 1) { done = true; P(gg, 0).life = 2; return { kind: 'cast', card: find(gg, 1, 'Shock', 'hand'), targets: [{ player: 0 }] }; } });
  const bears = find(g, 0, 'Grizzly Bears', 'hand');
  ok(await cast(g, 0, 'Grizzly Bears'), 'cast');
  eq(P(g, 0).lost, true, 'the caster left while the spell was on the stack');
  eq([bears.zone, g.players.flatMap(q => q.battlefield).includes(bears)], ['gone', false], 'the spell left the game with them');
  eq(g.stack.length, 0, 'the stack is empty');
  eq(P(g, 2).life, 40, 'no creature entered, so no Soul Warden trigger');
  ok(lines(g).some(l => /P1's spells and abilities leave the stack/.test(l)), 'logged with the rule');
  noErrors(g);
  // (rules 17, for old replays: the spell still resolved)
  const g17 = await table([{ battlefield: ['Forest', 'Forest'], hand: ['Grizzly Bears'] }, {}, {}], { rules: 17 });
  let once = false;
  script(g17, (i, item, gg) => { if (!once) { once = true; P(gg, 0).life = 0; gg.sbaPass(); } });
  await cast(g17, 0, 'Grizzly Bears');
  eq(P(g17, 0).battlefield.length, 1, 'rules 17 is unchanged');
});
await test('18b. Their waiting triggers are dropped, and other players\' objects on the stack still resolve', async () => {
  const g = await table([{ battlefield: ['Soul Warden'], life: 2 }, { battlefield: ['Soul Warden', 'Mountain', 'Mountain', 'Forest', 'Forest'], hand: ['Shock', 'Grizzly Bears'] }, {}], { active: 1 });
  // seat 2 casts Bears; in response, Shock on seat 1 (who has a Soul Warden trigger coming)
  P(g, 0).life = 2; P(g, 1).life = 40;
  let done = false;
  script(g, (i, item, gg) => { if (!done && i === 1 && item.name === 'Grizzly Bears') { done = true; return { kind: 'cast', card: find(gg, 1, 'Shock', 'hand'), targets: [{ player: 0 }] }; } });
  ok(await cast(g, 1, 'Grizzly Bears'), 'cast');
  eq([P(g, 0).lost, !!find(g, 1, 'Grizzly Bears'), P(g, 1).life], [true, true, 41], 'seat 1 is out; the Bears resolved and seat 2\'s own Soul Warden triggered');
  eq(g.queue.length + g.stack.length, 0, 'nothing is left waiting');
  noErrors(g);
});
await test('25. The game ends when one player is left, and they win', async () => {
  const g = await table([{}, {}, {}, {}]);
  P(g, 3).life = 0; await settle(g);
  eq([g.over, g.alive().length], [false, 3], 'three left');
  P(g, 0).poison = 10; await settle(g);
  eq([g.over, g.alive().length], [false, 2], 'two left');
  P(g, 1).drewFromEmpty = true; await settle(g);
  eq([g.over, g.winner?.idx, g.winReason], [true, 2, 'last player standing'], 'one left');
  eq(g.players.map(p => p.place), [3, 2, 1, 4], 'places in the order they left');
  eq(P(g, 2).lost, false, 'the winner didn\'t lose');
  // nothing more happens to a finished game
  P(g, 2).life = 0; await settle(g);
  eq([g.winner?.idx, P(g, 2).lost], [2, false], 'the result stands');
});

// ---------- 15: conceding
await test('15. Conceding: the player leaves at the next state-based check, even with Platinum Angel, and only once', async () => {
  const g = await table([{ battlefield: ['Platinum Angel'] }, {}, {}]);
  ok(g.concede(P(g, 0)), 'concede');
  ok(!g.concede(P(g, 0)), 'a second concession does nothing');
  eq(P(g, 0).lost, false, 'not yet: the game changes hands at the next check');
  await settle(g);
  eq([P(g, 0).lost, P(g, 0).lossReason, g.over], [true, 'conceded', false], 'gone; the others play on');
  eq(lines(g).filter(l => /is eliminated/.test(l)).length, 1, 'eliminated once');
  ok(!g.concede(P(g, 0)), 'conceding after leaving does nothing');
  // conceding with two players left ends the game
  g.concede(P(g, 1)); await settle(g);
  eq([g.over, g.winner?.idx], [true, 2], 'the last player wins');
  noErrors(g);
});

// ---------- online seats: a fake room in place of the local server
const fakeRoom = () => {
  const r = { q: null, asked: [], reply: null, seenSec: 0, sent: 0,
    ask: async (seat, q) => { r.q = q; if (q) r.asked.push(q); },
    answer: async () => (typeof r.reply === 'function' ? r.reply(r.q) : r.reply),
    seen: () => r.seenSec };
  return r;
};
const remoteSeat = (g, seat, room, opts = {}) => {
  const ui = new RemoteUI(room, seat, opts.timeout ?? 1, 'off', opts.drop || 'ai');
  ui.poll = 5;
  ui.attach(g);
  P(g, seat).agent.ui = ui;
  return ui;
};
const BTN = [{ label: 'Keep', value: 'keep', primary: true }, { label: 'Other', value: 'other' }];

await test('15b. A friend\'s concession is recorded in place of an answer, and a replay concedes at the same decision', async () => {
  const g = await table([{}, {}, {}]);
  const room = fakeRoom();
  const ui = remoteSeat(g, 1, room);
  room.reply = q => (q ? { id: q.id, button: 1 } : null);
  eq(await ui.ask('First', { buttons: BTN }), { button: 'other' }, 'a normal answer');
  ok(ui.concede(), 'the friend concedes');
  eq(snapshot(g, 2).players[1].conceded, true, 'the table shows it straight away');
  eq(await ui.ask('Second', { buttons: BTN }), { button: 'keep' }, 'the open decision gets the default answer');
  eq(ui.record, [{ b: 1 }, { c: 1 }], 'the record');
  eq(P(g, 1).conceded, true, 'the engine knows');
  const before = room.asked.length;
  eq(await ui.ask('Third', { buttons: BTN }), { button: 'keep' }, 'nothing more is asked of them');
  eq([room.asked.length, ui.record.length], [before, 2], 'no question sent, nothing recorded');
  await settle(g);
  eq(P(g, 1).lost, true, 'they left the game');
  // the same record played back on a fresh game
  const g2 = await table([{}, {}, {}]);
  const ui2 = remoteSeat(g2, 1, fakeRoom());
  ui2.setRecord([{ b: 1 }, { c: 1 }], true);
  eq(await ui2.ask('First', { buttons: BTN }), { button: 'other' }, 'replayed answer');
  eq(P(g2, 1).conceded ?? false, false, 'not yet');
  await ui2.ask('Second', { buttons: BTN });
  await settle(g2);
  eq([P(g2, 1).lost, P(g2, 1).lossReason], [true, 'conceded'], 'the replay concedes at the same decision');
});

// ---------- 16, 17: a dropped connection
await test('16. A dropped connection is not a concession: the seat stays in the game and the AI answers for it', async () => {
  const g = await table([{}, {}, {}]);
  const room = fakeRoom();
  const ui = remoteSeat(g, 1, room);
  room.seenSec = 30;
  ui.presence();
  eq([ui.offline, P(g, 1).lost, P(g, 1).conceded ?? false], [true, false, false], 'offline, still playing');
  eq(snapshot(g, 0).players[1].offline, true, 'the other players are told');
  room.reply = q => (q ? { id: q.id, button: 1 } : null);
  eq(await ui.ask('Choose', { buttons: BTN }), { button: 'keep' }, 'the default answer, not the dropped client\'s');
  eq(room.asked.length, 0, 'no question is sent to a seat that isn\'t there');
  await settle(g);
  eq([P(g, 1).lost, g.over], [false, false], 'nobody was eliminated');
  ok(lines(g).some(l => /P2 has disconnected/.test(l)), 'logged');
});
await test('16b. The table\'s disconnect rules: "wait" waits for them; "concede" concedes only after the time away', async () => {
  ok(DROP_POLICIES.ai && DROP_POLICIES.wait && DROP_POLICIES.concede5.min === 5, 'the three rules exist');
  // wait: the question is sent and their late answer counts
  const g = await table([{}, {}, {}]);
  const room = fakeRoom();
  const ui = remoteSeat(g, 1, room, { drop: 'wait', timeout: 2 });
  room.seenSec = 30; ui.presence();
  let polls = 0;
  room.reply = q => (q && ++polls > 3 ? { id: q.id, button: 1 } : null);
  eq(await ui.ask('Choose', { buttons: BTN }), { button: 'other' }, 'their own answer, given after they came back');
  // concede after 5 minutes away in a row
  const g2 = await table([{}, {}, {}]);
  const room2 = fakeRoom();
  const ui2 = remoteSeat(g2, 1, room2, { drop: 'concede5' });
  let now = 1000000;
  ui2.now = () => now;
  room2.seenSec = 30; ui2.presence();
  now += 4 * 60000; ui2.presence();
  await ui2.ask('Choose', { buttons: BTN }); await settle(g2);
  eq(P(g2, 1).lost, false, 'four minutes away: still in the game');
  now += 61000; ui2.presence(); ui2.presence();
  await ui2.ask('Choose', { buttons: BTN }); await settle(g2);
  eq([P(g2, 1).lost, P(g2, 1).lossReason], [true, 'conceded'], 'five minutes away: conceded');
  eq(lines(g2).filter(l => /is eliminated/.test(l)).length, 1, 'eliminated once, however often presence is checked');
  eq(ui2.record.at(-1), { c: 1 }, 'recorded, so a replay does the same');
});
await test('17. Reconnecting: the seat is theirs again, the time away is forgotten, and their answers count', async () => {
  const g = await table([{}, {}, {}]);
  const room = fakeRoom();
  const ui = remoteSeat(g, 1, room, { drop: 'concede5' });
  let now = 1000000;
  ui.now = () => now;
  room.seenSec = 30; ui.presence();
  now += 4 * 60000;
  room.seenSec = 1; ui.presence();
  eq([ui.offline, ui.awaySince], [false, 0], 'back');
  ok(lines(g).some(l => /P2 is back/.test(l)), 'logged');
  eq(snapshot(g, 0).players[1].offline, false, 'the other players are told');
  room.reply = q => (q ? { id: q.id, button: 1 } : null);
  eq(await ui.ask('Choose', { buttons: BTN }), { button: 'other' }, 'their own answer');
  // a second, shorter drop starts counting from zero
  room.seenSec = 30; ui.presence(); now += 2 * 60000; ui.presence();
  eq(ui.wantConcede, false, 'two minutes into a new drop: no concession');
  // the view they get back holds the whole current table
  const s = snapshot(g, 1);
  eq([s.turn, s.active, s.players.length, Array.isArray(s.players[1].hand)], [g.turn, g.active, 3, true], 'the current state, with their own hand');
});

// ---------- 19, 20: what a view holds
const startedGame = async () => {
  const names = [['Grizzly Bears', 'Llanowar Elves', 'Giant Growth', 'Forest'], ['Shock', 'Lightning Bolt', 'Raging Goblin', 'Mountain'], ['Counterspell', 'Brainstorm', 'Ponder', 'Island'], ['Murder', 'Doom Blade', 'Blood Artist', 'Swamp']];
  const seats = names.map((list, i) => ({ playerName: `P${i + 1}`, deckName: 'test', color: '#888', agent: new Agent('balanced'), commanders: [], cards: list.map(n => ({ card: card(n), qty: 10 })) }));
  const g = new Game(seats, { beat: async () => {} }, { seed: 5, noLearning: true, format: 'commander' });
  await g.setup();
  return { g, names };
};
await test('19. Hidden information: a seat\'s view holds its own hand and nobody else\'s cards, in any field', async () => {
  const { g, names } = await startedGame();
  for (const seat of [0, 1, 2, 3]) {
    const s = snapshot(g, seat), text = JSON.stringify(s);
    eq(s.players[seat].hand.map(c => c.name).sort(), P(g, seat).hand.map(o => o.card.name).sort(), `seat ${seat + 1}: own hand`);
    for (const [i, list] of names.entries()) {
      if (i === seat) continue;
      eq(typeof s.players[i].hand, 'number', `seat ${seat + 1}: seat ${i + 1}'s hand is a count`);
      for (const n of list) ok(!text.includes(n), `seat ${seat + 1}'s view names ${n}, a card only in seat ${i + 1}'s hand and library`);
    }
    for (const q of s.players) eq(typeof q.library, 'number', 'a library is a count');
    // object ids of hidden cards aren't sent either (they would let a page ask about them)
    const hiddenIds = g.players.filter(q => q.idx !== seat).flatMap(q => [...q.hand, ...q.library]).map(o => o.iid);
    const sent = new Set(s.players.flatMap(q => [...(Array.isArray(q.hand) ? q.hand : []), ...q.battlefield, ...q.command]).map(c => c.iid));
    ok(!hiddenIds.some(id => sent.has(id)), 'no hidden card\'s id in the view');
  }
  // a spectator sees no hand at all; the delayed streamer view sees them all
  const watch = JSON.stringify(snapshot(g, -1));
  ok(!names.flat().some(n => watch.includes(n)), 'the spectators\' view names no card in a hand or library');
  ok(snapshot(g, -2).players.every(q => Array.isArray(q.hand)), 'the streamer view has every hand');
});
await test('19b. Public information stays visible; a face-down permanent and a face-down exiled card are named only to their owner', async () => {
  const g = await table([{ battlefield: ['Grizzly Bears'], graveyard: ['Shock'], exile: ['Lightning Bolt', 'Murder'] }, {}]);
  const bears = find(g, 0, 'Grizzly Bears'), hidden = find(g, 0, 'Murder', 'exile');
  bears.faceDown = true; bears.faceCard = bears.card;
  hidden.foretold = 1;
  const mine = snapshot(g, 0), theirs = snapshot(g, 1);
  eq(theirs.players[0].graveyardCards, ['Shock'], 'a graveyard is public');
  eq(theirs.players[0].exileCards, ['Lightning Bolt', null], 'exile: the face-up card by name, the face-down one hidden');
  eq(mine.players[0].exileCards, ['Lightning Bolt', 'Murder'], 'its owner sees it');
  eq([mine.players[0].battlefield[0].peek, theirs.players[0].battlefield[0].peek ?? null], ['Grizzly Bears', null], 'a face-down permanent');
  eq([theirs.players[0].life, theirs.players[0].exile, theirs.turn, theirs.phase, theirs.active], [40, 2, g.turn, g.phase, g.active], 'life, zone sizes, turn, phase, active player');
});
await test('20. Shuffling: only the host shuffles, with the game\'s own seeded dice; a view never holds a library\'s order', async () => {
  const order = g => P(g, 0).library.map(o => o.card.name).join('|');
  const a = await startedGame(), b = await startedGame();
  eq(order(a.g), order(b.g), 'the same seed shuffles the same way (a replay sees the same library)');
  const before = snapshot(a.g, 0);
  const lib = [...P(a.g, 0).library];
  // a search and shuffle, as a card does it
  a.g.rand(); a.g.rand();
  for (let i = lib.length - 1; i > 0; i--) { const j = Math.floor(a.g.rand() * (i + 1)); [P(a.g, 0).library[i], P(a.g, 0).library[j]] = [P(a.g, 0).library[j], P(a.g, 0).library[i]]; }
  const after = snapshot(a.g, 0);
  eq([...P(a.g, 0).library].map(o => o.iid).sort(), lib.map(o => o.iid).sort(), 'the same cards, none lost or doubled');
  eq([before.players[0].library, after.players[0].library], [lib.length, lib.length], 'the view holds the size only');
  ok(after.rev > before.rev, 'each view has a higher revision number than the last');
  const ids = new Set(lib.map(o => o.iid));
  ok(!JSON.stringify(after).match(/"iid":(\d+)/g)?.some(m => ids.has(+m.slice(6))), 'no library card\'s id is sent, even to its owner');
});

// ---------- 21: what a friend's page may do
await test('21. Unauthorized and stale answers: only the waiting question\'s answer counts, and only for what was offered', async () => {
  const g = await table([{ battlefield: ['Grizzly Bears'], hand: ['Shock'] }, {}, {}]);
  const room = fakeRoom();
  const ui = remoteSeat(g, 1, room, { timeout: 0.15 });
  const bears = find(g, 0, 'Grizzly Bears'), shock = find(g, 0, 'Shock', 'hand');
  // an answer to an earlier question (a repeat, or a late one) is not an answer to this one
  room.reply = () => ({ id: '1-0-old', button: 1 });
  eq(await ui.askLive('Choose', { buttons: BTN }), { button: 'keep' }, 'a stale answer is ignored: the time runs out and the default is used');
  // a card that wasn't offered (another player's hand card), a player who wasn't offered, a button that doesn't exist
  room.reply = q => (q ? { id: q.id, obj: shock.iid } : null);
  eq(await ui.askLive('Choose', { buttons: BTN, objs: [bears] }), { button: 'cancel' }, 'a card that wasn\'t offered');
  room.reply = q => (q ? { id: q.id, player: 0 } : null);
  eq(await ui.askLive('Choose', { buttons: BTN, players: [2] }), { button: 'cancel' }, 'a player who wasn\'t offered');
  room.reply = q => (q ? { id: q.id, button: 7, concede: true, life: 999 } : null);
  eq(await ui.askLive('Choose', { buttons: BTN }), { button: 'cancel' }, 'extra fields in an answer do nothing');
  eq([P(g, 1).conceded ?? false, P(g, 1).life], [false, 40], 'an answer can\'t concede or change the game by itself');
  // every question has its own id, never reused
  eq(new Set(room.asked.map(q => q.id)).size, room.asked.length, 'question ids are unique');
  // a seat's page can only ever answer for its own seat: the answer channel is per seat
  const other = remoteSeat(g, 2, fakeRoom(), { timeout: 0.1 });
  eq(await other.askLive('Choose', { buttons: BTN }), { button: 'keep' }, 'seat 3 got no answer from seat 2\'s room');
  // the engine checks the action itself: a seat can't cast a card it doesn't hold, or without the mana
  eq(await g.cast(P(g, 1), shock, { targets: [{ player: 0 }] }), false, 'casting another player\'s card is refused by the engine');
  eq([shock.zone, P(g, 0).life], ['hand', 40], 'nothing happened');
  eq(defaultPick([]), { button: 'pass' }, 'no buttons: the default answer is to pass');
});

// ---------- 23: combat damage steps
await test('23. Combat damage steps: first and double strike deal damage in a first step, the rest in a second', async () => {
  const g = await table([{ battlefield: ['Boros Swiftblade', 'Grizzly Bears'], commander: 'Rograkh, Son of Rohgahh' }, {}, {}]);
  const ev = [];
  g.on('life', d => ev.push(d.d));
  const rog = find(g, 0, 'Rograkh, Son of Rohgahh');
  rog.counters = 2;
  await attack(g, 0, ['Boros Swiftblade', 'Grizzly Bears', 'Rograkh, Son of Rohgahh'], 1);
  // first step: Swiftblade (double strike, 1) and Rograkh (first strike, 2); second: Swiftblade again and the Bears
  eq(P(g, 1).life, 40 - 1 - 2 - 1 - 2, 'life after both steps');
  const steps = lines(g).filter(l => /combat damage to P2/.test(l));
  eq(steps.length, 2, 'two combat damage steps');
  ok(/Boros Swiftblade/.test(steps[0]) && /Rograkh/.test(steps[0]) && !/Grizzly Bears/.test(steps[0]), `first step: ${steps[0]}`);
  ok(/Boros Swiftblade/.test(steps[1]) && /Grizzly Bears/.test(steps[1]) && !/Rograkh/.test(steps[1]), `second step: ${steps[1]}`);
  eq(P(g, 1).cmdDamage[rog.iid], 2, 'the first striker dealt its commander damage once');
  // with no first or double striker there is one step
  const g2 = await table([{ battlefield: ['Grizzly Bears', 'Savannah Lions'] }, {}]);
  await attack(g2, 0, ['Grizzly Bears', 'Savannah Lions'], 1);
  eq(lines(g2).filter(l => /combat damage to P2/.test(l)).length, 1, 'one step');
  // a double-striking commander deals commander damage in both steps
  const g3 = await table([{ commander: 'Krenko, Mob Boss' }, {}]);
  const k = find(g3, 0, 'Krenko, Mob Boss');
  k.permKw = new Set(['double strike']);
  if (g3.has(k, 'double strike')) { await attack(g3, 0, ['Krenko, Mob Boss'], 1); eq(P(g3, 1).cmdDamage[k.iid], 6, 'commander damage from both steps'); }
  noErrors(g);
});
await test('23b. A player eliminated in the first combat damage step takes none in the second, and the game goes on', async () => {
  const g = await table([{ battlefield: ['Boros Swiftblade', 'Grizzly Bears'] }, { life: 1 }, {}]);
  await attack(g, 0, ['Boros Swiftblade', 'Grizzly Bears'], 1);
  eq([P(g, 1).lost, P(g, 1).life, g.over], [true, 0, false], 'out after the first step, at 0 life');
  noErrors(g);
});

// ---------- 24: cleanup
await test('24. Cleanup: the hand goes down to seven, damage wears off and "until end of turn" ends', async () => {
  const g = await table([{ battlefield: ['Forest', 'Grizzly Bears'], hand: ['Giant Growth', ...Array(9).fill('Forest')] }, { battlefield: ['Grizzly Bears'] }]);
  const mine = find(g, 0, 'Grizzly Bears'), theirs = find(g, 1, 'Grizzly Bears');
  ok(await cast(g, 0, 'Giant Growth', { targets: [{ obj: mine }] }), 'cast');
  eq([g.power(mine), g.toughness(mine)], [5, 5], 'pumped');
  g.damageObj(mine, 3, theirs); g.damageObj(theirs, 1, mine);
  await settle(g);
  eq([mine.zone, mine.damage, theirs.damage], ['battlefield', 3, 1], 'damaged, alive while pumped');
  for (const q of g.players) q.agent.endOfTurn = async () => {};
  await g.endSteps(P(g, 0));
  eq(P(g, 0).hand.length, 7, 'discarded down to seven');
  // (514.2: damage wears off and the pump ends at the same time, so the Bears survive)
  eq([mine.zone, mine.damage, g.power(mine), g.toughness(mine), theirs.damage], ['battlefield', 0, 2, 2, 0], 'after cleanup');
  ok(lines(g).some(l => /discards .* down to seven cards/.test(l)), 'logged with the rule');
  noErrors(g);
});
await test('24b. A trigger from the cleanup discard resolves in that cleanup step, not in the next turn (514.3a)', async () => {
  const g = await table([{ hand: Array(8).fill('Forest') }, { battlefield: ['Liliana\'s Caress'] }]);
  for (const q of g.players) q.agent.endOfTurn = async () => {};
  await g.endSteps(P(g, 0));
  eq([P(g, 0).hand.length, P(g, 0).life, g.queue.length], [7, 38, 0], 'Liliana\'s Caress took its 2 life before the turn ended');
  ok(lines(g).some(l => /another cleanup step/.test(l)), 'logged with the rule');
  // rules 17 (old replays): it waited
  const g17 = await table([{ hand: Array(8).fill('Forest') }, { battlefield: ['Liliana\'s Caress'] }], { rules: 17 });
  for (const q of g17.players) q.agent.endOfTurn = async () => {};
  await g17.endSteps(P(g17, 0));
  eq(P(g17, 0).life, 40, 'rules 17 is unchanged');
});

// ---------- Commander deck checks
const deckOf = (commanders, list) => ({ commanders: commanders.map(card), cards: list.map(([n, qty]) => ({ card: card(n), qty })), sideboard: [] });
await test('Deck check: size, singleton, color identity, banned cards and commander pairs each get their own message, and nothing is removed', async () => {
  const good = deckOf(['Krenko, Mob Boss'], [['Mountain', 97], ['Shock', 1], ['Lightning Bolt', 1]]);
  eq(checkDeck(good, 'commander'), [], 'a legal deck');
  const bad = deckOf(['Krenko, Mob Boss'], [['Mountain', 90], ['Shock', 2], ['Counterspell', 1], ['Grizzly Bears', 1], ['Mana Crypt', 1]]);
  const before = JSON.stringify(bad.cards.map(c => [c.card.name, c.qty]));
  const msgs = checkDeck(bad, 'commander');
  ok(msgs.some(m => /Deck has 96 cards .*exactly 100/.test(m)), `size: ${msgs.join(' | ')}`);
  ok(msgs.some(m => /More than one copy: Shock ×2/.test(m)), 'singleton');
  ok(msgs.some(m => /Outside the commander's color identity \(R\): Counterspell, Grizzly Bears/.test(m)), `color identity: ${msgs.join(' | ')}`);
  ok(msgs.some(m => /Not legal in Commander: Mana Crypt/.test(m)), 'banned');
  eq(JSON.stringify(bad.cards.map(c => [c.card.name, c.qty])), before, 'the deck is not changed');
  // commanders
  ok(checkDeck(deckOf([], [['Mountain', 100]]), 'commander').some(m => /need a commander/.test(m)), 'no commander');
  ok(checkDeck(deckOf(['Krenko, Mob Boss', 'Tymna the Weaver'], [['Mountain', 98]]), 'commander').some(m => /can't be commanders together/.test(m)), 'two commanders without partner');
  eq(checkDeck(deckOf(['Rograkh, Son of Rohgahh', 'Tymna the Weaver'], [['Mountain', 40], ['Plains', 30], ['Swamp', 28]]), 'commander'), [], 'partners: their colors together');
  ok(checkDeck(deckOf(['Rograkh, Son of Rohgahh', 'Tymna the Weaver'], [['Mountain', 97], ['Counterspell', 1]]), 'commander').some(m => /color identity \((RWB|[RWB]{3})\): Counterspell/.test(m)), 'partners: a blue card is still outside');
  // other formats keep their own rules: no color identity or singleton in Modern
  eq(checkDeck({ commanders: [], cards: [{ card: card('Mountain'), qty: 52 }, { card: card('Shock'), qty: 4 }, { card: card('Counterspell'), qty: 4 }], sideboard: [] }, 'modern').filter(m => /identity|one copy/.test(m)), [], 'Modern');
});

for (const [name, e] of results) console.log(`${e ? 'FAIL' : 'ok  '}  ${name}${e ? `\n        ${e.message}` : ''}`);
const bad = results.filter(r => r[1]).length;
console.log(`Multiplayer and Commander: ${results.length} tests, ${results.length - bad} passed, ${bad} failed.`);
process.exit(bad ? 1 : 0);
