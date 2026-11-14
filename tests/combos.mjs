// Combos played out with the real cards (Phase 2C, rules 11): public/js/comboplay.js and the combo statuses and
// Commander Spellbook catalog in combos.js. Each test checks the game systems the combo went through (life events and
// their triggers, the damage system, combat, Game.move), not just the outcome the combo is known for.
//   node tests/combos.mjs            run them all (exit 1 on any failure)
//   node tests/combos.mjs Fog        only the tests whose name contains "Fog"
import { scenario, find, P, logText, errors, settle, hasCard } from './scenario.mjs';
import { RULES } from '../public/js/engine.js';
import { COMBOS, comboPlay, playable, makeComboBook, readSpellbook } from '../public/js/combos.js';

const only = process.argv[2];
const results = [];
const test = async (name, fn) => {
  if (only && !name.toLowerCase().includes(only.toLowerCase())) return;
  try { await fn(); results.push([name, null]); } catch (e) { results.push([name, e]); }
};
const eq = (got, want, what) => { if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`${what}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); };
const ok = (cond, what) => { if (!cond) throw new Error(what); };
const noErrors = g => eq(errors(g).length, 0, 'simulator errors');
const combo = label => { const c = COMBOS.find(x => x.label === label); if (!c) throw new Error(`no combo ${label}`); return c; };
const lines = g => logText(g).replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').split('\n');
// (the old shortcut's tell-tale lines: none may appear at rules 11)
const noShortcut = g => ok(!lines(g).some(l => /^Combo!|The loop begins|^Loop \d+:|deals damage to each opponent until they're dead|makes an endless stream/.test(l)), 'the old combo shortcut ran');
// Every life change the game made, as the 'life' events its triggers listen to
const lifeEvents = g => { const ev = []; g.on('life', d => ev.push(d)); return ev; };
const board = (g, i) => P(g, i).battlefield.map(o => o.card.name);
ok(RULES >= 11, `these tests are for rules 11 and later (RULES is ${RULES})`);

// ---------- 1. Life drain through life events and the cards' triggers
await test('1. Drain: Exquisite Blood + Sanguine Bond drain one point at a time through life events and triggers', async () => {
  // (Exquisite Blood's combo needs a way to start it: a creature that can attack, or a life-gain effect)
  const g = await scenario([{ hand: ['Exquisite Blood', 'Sanguine Bond'], battlefield: [...Array(12).fill('Swamp'), 'Grizzly Bears'] }, { life: 20 }]);
  for (const o of P(g, 0).battlefield) o.sick = false;
  g.active = 0;
  await g.goOff(P(g, 0), combo('Exquisite Blood + Sanguine Bond')); await settle(g);
  ok(board(g, 0).includes('Exquisite Blood') && board(g, 0).includes('Sanguine Bond'), 'both cast for real');
  eq(P(g, 1).life, 20, "no life changed by the combo itself (it waits for a life gain)");
  const ev = lifeEvents(g);
  await g.runEffects(P(g, 0), find(g, 0, 'Sanguine Bond'), [{ k: 'gain', n: 1 }], { targets: [], strict: true }); await settle(g);
  ok(P(g, 1).lost, 'the opponent lost');
  ok(/life total reached 0/.test(P(g, 1).lossReason || ''), `lost by life total (${P(g, 1).lossReason})`);
  const losses = ev.filter(d => d.p === 1 && d.d < 0);
  eq(losses.length, 20, 'one life-loss event per point (each a separate trigger)');
  ok(losses.every(d => d.d === -1), 'each loss is one point');
  ok(lines(g).filter(l => l.startsWith('Exquisite Blood —')).length >= 19 && lines(g).filter(l => l.startsWith('Sanguine Bond —')).length >= 19, 'both cards triggered each time');
  noShortcut(g); noErrors(g);
});

// ---------- 2, 3. Damage through the damage system: prevention and lifelink
await test('2. Damage: Heliod + Walking Ballista against an opponent whose damage is prevented does nothing', async () => {
  const g = await scenario([{ battlefield: ['Heliod, Sun-Crowned', ...Array(8).fill('Plains')], hand: ['Walking Ballista'] }, {}]);
  g.active = 0;
  await g.runEffects(P(g, 1), P(g, 1).battlefield[0] || find(g, 0, 'Heliod, Sun-Crowned'), [{ k: 'preventMe' }], { targets: [], strict: true });
  await g.goOff(P(g, 0), combo('Heliod, Sun-Crowned + Walking Ballista')); await settle(g);
  eq(P(g, 1).life, 40, "the opponent's life");
  ok(!g.over, 'the game goes on');
  const last = g.comboLog[g.comboLog.length - 1];
  ok(last && !last.landed && /prevented/.test(last.why), `combo log: ${JSON.stringify(last)}`);
  noShortcut(g); noErrors(g);
});
await test('3. Lifelink: Heliod gives Ballista lifelink; each ping gains life, and Heliod\'s trigger puts the counter back', async () => {
  const g = await scenario([{ battlefield: ['Heliod, Sun-Crowned', ...Array(8).fill('Plains')], hand: ['Walking Ballista'] }, { life: 15 }]);
  g.active = 0;
  const ev = lifeEvents(g);
  await g.goOff(P(g, 0), combo('Heliod, Sun-Crowned + Walking Ballista')); await settle(g);
  ok(P(g, 1).lost, 'the opponent lost');
  eq(ev.filter(d => d.p === 0 && d.d > 0).length, 15, 'one life gain (lifelink) per ping');
  eq(P(g, 0).life, 55, 'P1 gained 15 through lifelink');
  ok(lines(g).filter(l => /^Heliod, Sun-Crowned — P1 gained life/.test(l)).length >= 14, "Heliod's trigger each time");
  ok(lines(g).filter(l => /removes 1 counter from Walking Ballista to ping P2/.test(l)).length === 15, 'fifteen separate pings');
  noShortcut(g); noErrors(g);
});

// ---------- 4, 5. Copies fight in real combat: blockers and Fog stop them
const copiesThenCombat = async (oppBattlefield, before) => {
  // (Zealous Conscripts: no flying, so ground blockers can stop the copies)
  const g = await scenario([{ battlefield: ['Kiki-Jiki, Mirror Breaker', 'Zealous Conscripts', ...Array(4).fill('Mountain')] }, { battlefield: oppBattlefield, life: 10 }]);
  g.active = 0; g.phase = 'main1';
  for (const o of P(g, 0).battlefield) o.sick = false;
  await g.goOff(P(g, 0), combo('Kiki-Jiki, Mirror Breaker + Zealous Conscripts')); await settle(g);
  const copies = P(g, 0).battlefield.filter(o => o.token && o.card.name === 'Zealous Conscripts').length;
  if (before) await before(g);
  await g.combat(P(g, 0)); await settle(g);
  return { g, copies };
};
await test('4a. Combat: Kiki-Jiki\'s hasty copies attack in the combat step and win there', async () => {
  const { g, copies } = await copiesThenCombat([]);
  ok(copies >= 4, `copies made for real: ${copies} (10 life over 3 power, plus one per possible blocker)`);
  ok(lines(g).some(l => /^P1 attacks P2 with/.test(l)), 'attackers were declared in combat');
  ok(lines(g).some(l => /deal \d+ combat damage to P2/.test(l)), 'combat damage was dealt');
  ok(P(g, 1).lost, `the opponent lost in combat (life ${P(g, 1).life})`);
  noShortcut(g); noErrors(g);
});
await test('4b. Combat: the same copies against enough blockers do not win', async () => {
  // (the defender blocks every attacker with a Wall, as a person would: the AI's own block planner doesn't block
  // when the attack is lethal by a wide margin, a separate problem found here and left for its own fix)
  // (45 Walls: the play-out makes at most 40 copies, so with Kiki-Jiki and the original every attacker can be blocked)
  const { g, copies } = await copiesThenCombat(Array(45).fill('Wall of Omens'), async g => {
    const walls = [...P(g, 1).battlefield];
    P(g, 1).agent.declareBlockers = (gg, q, attackers) => attackers.map((a, i) => ({ b: walls[i], a })).filter(x => x.b);
  });
  ok(copies >= 4, `copies made: ${copies}`);
  const attacked = lines(g).find(l => /^P1 attacks P2 with/.test(l)) || '';
  ok((attacked.match(/Zealous Conscripts/g) || []).length >= copies, `every copy attacked: ${attacked.slice(0, 80)}`);
  ok(lines(g).some(l => /blocks/.test(l)), 'blocks were declared');
  eq(P(g, 1).life, 10, "the opponent's life (every attacker blocked)");
  ok(!g.over, 'the game goes on');
  noShortcut(g); noErrors(g);
});
await test('5. Fog: with Fog resolved before combat, the copies deal no damage', async () => {
  const { g, copies } = await copiesThenCombat([], async g => { await g.runEffects(P(g, 1), find(g, 0, 'Kiki-Jiki, Mirror Breaker'), [{ k: 'fog' }], { targets: [], strict: true }); });
  ok(copies >= 4, `copies made: ${copies}`);
  eq(P(g, 1).life, 10, "the opponent's life");
  ok(lines(g).some(l => /combat damage is prevented/.test(l)), 'the prevention is logged');
  noShortcut(g); noErrors(g);
});

// ---------- 6, 7, 8. Mill through Game.move: replacements and shuffle-back apply
const grind = async (opp, extra = []) => {
  const g = await scenario([{ battlefield: ["Painter's Servant", 'Grindstone', ...Array(4).fill('Island'), ...extra] }, opp]);
  g.active = 0;
  const moves = [];
  g.on('move', d => { if (d.owner === 1 && d.from === 'library') moves.push(d.to); });
  await g.goOff(P(g, 0), combo("Painter's Servant + Grindstone")); await settle(g);
  return { g, moves };
};
await test('6. Mill: Painter\'s Servant + Grindstone mills card by card through Game.move', async () => {
  const { g, moves } = await grind({ filler: 30 });
  eq(P(g, 1).library.length, 0, "the opponent's library");
  eq(moves.length, 30, 'zone changes from the library (one Game.move per card)');
  ok(moves.every(t => t === 'graveyard'), 'each to the graveyard');
  eq(P(g, 1).graveyard.length, 30, "the opponent's graveyard");
  noShortcut(g); noErrors(g);
});
await test('7. Mill with Rest in Peace: every milled card is exiled instead (the replacement in Game.move)', async () => {
  const { g, moves } = await grind({ filler: 20 }, ['Rest in Peace']);
  eq(P(g, 1).library.length, 0, "the opponent's library");
  ok(moves.length === 20 && moves.every(t => t === 'exile'), `zone changes: ${moves.join(',')}`);
  eq([P(g, 1).graveyard.length, P(g, 1).exile.length], [0, 20], "the opponent's graveyard and exile");
  noErrors(g);
});
await test('8. Mill with Blightsteel Colossus in the library: it shuffles itself back instead of staying in the graveyard', async () => {
  const { g } = await grind({ filler: 20, library: ['Blightsteel Colossus'] });
  ok(P(g, 1).library.some(o => o.card.name === 'Blightsteel Colossus'), 'Blightsteel is back in the library');
  ok(!P(g, 1).graveyard.some(o => o.card.name === 'Blightsteel Colossus'), 'not in the graveyard');
  ok(lines(g).some(l => /Blightsteel Colossus is shuffled into its owner's library instead/.test(l)), 'the shuffle is logged');
  noErrors(g);
});

// ---------- 9–12. Spellbook combos: every one gets a status, and only playable ones are pursued
const NAMES = ['Kiki-Jiki, Mirror Breaker', 'Pestermite', 'Gravecrawler', 'Phyrexian Altar', 'Food Chain', 'Squee, the Immortal', 'Ashnod\'s Altar', 'Nim Deathmantle', 'Peregrine Drake', 'Sol Ring'];
const variant = (id, cards, extra = {}) => ({ id, uses: cards.map(([name, zones = ['B']]) => ({ card: { name }, zoneLocations: zones })), requires: [], produces: [{ feature: { name: 'Infinite damage' } }], easyPrerequisites: '', notablePrerequisites: '', manaNeeded: '', ...extra });
const answer = { results: { included: [
  variant('g1', [['Gravecrawler', ['G']], ['Phyrexian Altar']]),
  variant('e1', [['Squee, the Immortal', ['E']], ['Sol Ring']], { produces: [{ feature: { name: 'Infinite colored mana' } }] }),
  // (Food Chain + Squee from exile: the same cards as a built-in, so it takes the built-in's status)
  variant('e2', [['Squee, the Immortal', ['E']], ['Food Chain']], { produces: [{ feature: { name: 'Infinite colored mana' } }] }),
  variant('p1', [['Sol Ring'], ['Pestermite']], { easyPrerequisites: 'An opponent controls a creature with flying.' }),
  variant('p2', [['Kiki-Jiki, Mirror Breaker'], ['Pestermite']], { easyPrerequisites: 'An opponent controls a creature with flying.' }),
  variant('ok1', [["Ashnod's Altar"], ['Nim Deathmantle'], ['Peregrine Drake']], { produces: [{ feature: { name: 'Infinite colored mana' } }] }),
  variant('k1', [['Kiki-Jiki, Mirror Breaker'], ['Pestermite']], { produces: [{ feature: { name: 'Infinite combat' } }] }),
  variant('t1', [['Kiki-Jiki, Mirror Breaker'], ['Sol Ring']], { requires: [{ template: { name: 'Creature with an untap ETB' } }] }),
  variant('r1', [['Sol Ring'], ['Pestermite']], { produces: [{ feature: { name: 'Infinite storm count' } }] }),
  { id: 'bad1', uses: null }, null, { id: 'bad2', uses: [{ card: {} }, { card: { name: 'Sol Ring' } }] },
] } };
const read = readSpellbook(answer, NAMES);
const entry = id => { const e = read.catalog.find(x => x.id === id); if (!e) throw new Error(`no catalog entry ${id}`); return e; };
await test('9. Spellbook: a combo that needs a card in the graveyard is listed as unsupported, with the reason', async () => {
  const e = entry('g1');
  eq([e.status, e.zones.includes('graveyard')], ['unsupported', true], 'status, zones');
  ok(/needs a card in the graveyard/.test(e.reason), `reason: ${e.reason}`);
  ok(!read.out.some(d => d.pieces.includes('Gravecrawler')), 'not handed to the game');
  // (and the built-in combo that needs a graveyard: Underworld Breach is listed, and the engine won't fake it)
  const breach = comboPlay(combo("Underworld Breach + Lion's Eye Diamond + Brain Freeze"));
  eq(breach.status, 'unsupported', 'Underworld Breach status');
  const g = await scenario([{ battlefield: ['Underworld Breach', "Lion's Eye Diamond", ...Array(6).fill('Island')], hand: ['Brain Freeze'], graveyard: Array(6).fill('Wastes') }, {}]);
  g.active = 0;
  await g.goOff(P(g, 0), combo("Underworld Breach + Lion's Eye Diamond + Brain Freeze")); await settle(g);
  ok(!g.over && P(g, 1).library.length > 0, 'no result was granted');
  ok(lines(g).some(l => /can't be played out with the real cards/.test(l)), 'the log says why');
  noShortcut(g); noErrors(g);
});
await test('10. Spellbook: a combo that needs a card in exile is unsupported; Food Chain + Squee (exile casting works by hand) is only partial', async () => {
  const e = entry('e1');
  eq(e.status, 'unsupported', 'status'); ok(/needs a card in the exile/.test(e.reason), `reason: ${e.reason}`);
  eq(entry('e2').status, 'partial', "Spellbook's Food Chain + Squee (a built-in's cards)");
  const fc = comboPlay(combo('Food Chain + Squee, the Immortal'));
  eq(fc.status, 'partial', 'Food Chain + Squee status'); ok(/creature spells only/.test(fc.reason), `reason: ${fc.reason}`);
  const g = await scenario([{ battlefield: ['Food Chain', 'Squee, the Immortal'] }, {}]);
  ok(!g.players[0].combos.some(c => c.label === 'Food Chain + Squee, the Immortal'), 'not among the combos the AI goes for at rules 11');
  const old = await scenario([{ battlefield: ['Food Chain', 'Squee, the Immortal'] }, {}], { rules: 10 });
  ok(old.players[0].combos.some(c => c.label === 'Food Chain + Squee, the Immortal'), 'still there for rules 10 replays');
});
await test('11. Spellbook: a prerequisite the engine can\'t check makes the combo unsupported, quoting it', async () => {
  const e = entry('p1');
  eq(e.status, 'unsupported', 'status');
  ok(/prerequisite isn't understood: "An opponent controls a creature with flying"/.test(e.reason), `reason: ${e.reason}`);
  const t = entry('t1');
  eq(t.status, 'unsupported', 'template combo'); ok(/described only by type/.test(t.reason), `reason: ${t.reason}`);
  const r = entry('r1');
  ok(/isn't a result the engine can check/.test(r.reason), `unknown result: ${r.reason}`);
});
await test('12. Spellbook: a well-formed combo the engine has no way to play is partial and not pursued; one that is a built-in is supported', async () => {
  const e = entry('ok1');
  eq(e.status, 'partial', 'status'); ok(/no step-by-step way to play it/.test(e.reason), `reason: ${e.reason}`);
  const k = entry('k1');
  eq(k.status, 'supported', 'the Kiki-Jiki + Pestermite entry'); ok(/same cards as the built-in combo Kiki-Jiki, Mirror Breaker \+ Pestermite/.test(k.reason), `reason: ${k.reason}`);
  // (a built-in's cards keep the built-in's status however Spellbook words the setup; its caveat is kept in the reason)
  const p2 = entry('p2');
  eq(p2.status, 'supported', 'Kiki-Jiki + Pestermite with an unread prerequisite'); ok(/Spellbook's listing alone: a prerequisite isn't understood/.test(p2.reason), `reason: ${p2.reason}`);
  const book11 = makeComboBook(read.out, 11), book10 = makeComboBook(read.out, 10);
  const has = (b, n) => b.list.some(c => c.pieces.includes(n));
  ok(!has(book11, 'Nim Deathmantle') && has(book10, 'Nim Deathmantle'), 'pursued at rules 10 (replays), not at rules 11');
  ok(book11.list.every(c => playable(c)), 'every combo the rules 11 AI pursues can be played out');
  // (malformed answers are listed as invalid, and nothing throws)
  eq(['bad1', 'bad2'].map(id => entry(id).status), ['invalid', 'invalid'], 'malformed entries');
  eq(read.catalog.length, answer.results.included.length, 'every entry in the answer is listed');
  eq(readSpellbook(null, NAMES).catalog.length, 0, 'no answer at all');
});

// ---------- 13. Supported built-ins still work, through the real cards
await test("13a. Thassa's Oracle + Demonic Consultation: Consultation exiles the library, Oracle's trigger wins", async () => {
  const g = await scenario([{ hand: ["Thassa's Oracle", 'Demonic Consultation'], battlefield: [...Array(4).fill('Island'), ...Array(2).fill('Swamp')] }, {}]);
  g.active = 0;
  await g.goOff(P(g, 0), combo("Thassa's Oracle + Demonic Consultation")); await settle(g);
  ok(g.over && g.winner === P(g, 0), 'P1 won');
  eq(P(g, 0).library.length, 0, 'library exiled by Consultation');
  ok(P(g, 0).exile.length >= 10, `cards in exile: ${P(g, 0).exile.length}`);
  ok(lines(g).some(l => /^Thassa's Oracle — enters/.test(l)), "Oracle's enter trigger resolved");
  noShortcut(g); noErrors(g);
});
await test('13b. Basalt Monolith + Power Artifact: three real repetitions, each netting mana, then the 727.1c shortcut', async () => {
  const g = await scenario([{ battlefield: ['Basalt Monolith', ...Array(3).fill('Island')], hand: ['Power Artifact'] }, {}]);
  g.active = 0;
  await g.goOff(P(g, 0), combo('Basalt Monolith + Power Artifact')); await settle(g);
  eq(lines(g).filter(l => /activates Basalt Monolith: untap ~/.test(l)).length, 3, 'untap activations');
  eq(P(g, 0).infiniteMana, g.turn, 'unbounded mana this turn');
  ok(lines(g).some(l => /repeated Basalt Monolith \+ Power Artifact three times, making 2 more mana each time/.test(l)), 'the measured gain is logged');
  noShortcut(g); noErrors(g);
});
await test('13d. Unbounded mana into Walking Ballista: cast for real with a big X, then pings through the damage system', async () => {
  const g = await scenario([{ battlefield: ['Basalt Monolith', ...Array(3).fill('Island')], hand: ['Power Artifact', 'Walking Ballista'] }, { life: 12 }]);
  g.active = 0;
  await g.goOff(P(g, 0), combo('Basalt Monolith + Power Artifact')); await settle(g);
  ok(lines(g).some(l => /^P1 casts Walking Ballista \(X=12\)/.test(l)), `Ballista cast with X = 12: ${lines(g).find(l => /Walking Ballista/.test(l))}`);
  ok(P(g, 1).lost, 'the opponent lost');
  ok(lines(g).some(l => /removes 12 counters from Walking Ballista to ping P2/.test(l)), 'twelve pings');
  noShortcut(g); noErrors(g);
});
await test('13e. Mikaeus + Triskelion: Triskelion pings, dies to its own pings, and undying brings it back', async () => {
  const g = await scenario([{ battlefield: ['Mikaeus, the Unhallowed', ...Array(6).fill('Island')], hand: ['Triskelion'] }, { life: 8 }]);
  g.active = 0;
  await g.goOff(P(g, 0), combo('Mikaeus, the Unhallowed + Triskelion')); await settle(g);
  ok(P(g, 1).lost, 'the opponent lost');
  ok(lines(g).filter(l => /Triskelion dies/.test(l)).length >= 2, 'Triskelion died more than once');
  ok(lines(g).some(l => /undying/i.test(l)), 'undying brought it back');
  noShortcut(g); noErrors(g);
});
await test('13c. Every supported built-in combo runs at rules 11 without errors or the old shortcut', async () => {
  const bad = [];
  for (const c of COMBOS.filter(c => playable(c) && c.pieces.every(hasCard))) {
    const spellLike = n => /Consultation|Tainted Pact|Dramatic Reversal|Chain of Smog|Splinter Twin|Power Artifact|Curiosity|Ophidian Eye|Walking Ballista|Triskelion/.test(n);
    const bf = c.pieces.filter(n => !spellLike(n) && n !== c.last && !(c.imprint && n === c.imprint.host));
    const g = await scenario([{ battlefield: [...bf, ...Array(10).fill('Island'), ...Array(4).fill('Plains'), ...Array(4).fill('Swamp'), 'Grizzly Bears', ...(c.imprint ? ['Sol Ring', 'Arcane Signet', 'Mind Stone'] : [])],
      hand: c.pieces.filter(n => !bf.includes(n)), filler: /Tainted Pact/.test(c.label) ? 0 : 20, library: /Tainted Pact/.test(c.label) ? ['Forest', 'Mountain', 'Plains'] : [] }, { filler: 40 }]);
    g.active = 0;
    for (const o of P(g, 0).battlefield) o.sick = false;
    try { await g.goOff(P(g, 0), c); await settle(g); } catch (e) { bad.push(`${c.label}: ${e.message}`); continue; }
    if (errors(g).length) bad.push(`${c.label}: ${errors(g)[0]}`);
    if (lines(g).some(l => /^Combo!|The loop begins/.test(l))) bad.push(`${c.label}: old shortcut`);
    if (!g.comboLog.length) bad.push(`${c.label}: no combo log entry`);
  }
  eq(bad, [], 'problems');
});

// ---------- 14. Missing resources: nothing is granted
await test('14. Kiki-Jiki already tapped: no copy can be made, and no result is granted', async () => {
  const g = await scenario([{ battlefield: [{ name: 'Kiki-Jiki, Mirror Breaker', tapped: true }, 'Pestermite'] }, { life: 10 }]);
  g.active = 0;
  await g.goOff(P(g, 0), combo('Kiki-Jiki, Mirror Breaker + Pestermite')); await settle(g);
  eq(P(g, 0).battlefield.filter(o => o.token).length, 0, 'copies');
  eq(P(g, 1).life, 10, "the opponent's life");
  const last = g.comboLog[g.comboLog.length - 1];
  ok(last && !last.landed && /no copy/.test(last.why), `combo log: ${JSON.stringify(last)}`);
  noShortcut(g); noErrors(g);
});
await test('14b. Basalt Monolith + Power Artifact with no mana for the aura: the combo fizzles before anything happens', async () => {
  const g = await scenario([{ battlefield: [{ name: 'Basalt Monolith', tapped: true }], hand: ['Power Artifact'] }, {}]);
  g.active = 0;
  await g.goOff(P(g, 0), combo('Basalt Monolith + Power Artifact')); await settle(g);
  ok(P(g, 0).infiniteMana !== g.turn, 'no unbounded mana');
  ok(lines(g).some(l => /fizzles: P1 can't pay for Power Artifact/.test(l)), 'the reason is logged');
  noErrors(g);
});

// ---------- the old shortcut stays for replays at rules 10 and earlier
await test('Rules 10 (old replays): the combo shortcut still applies its result as before', async () => {
  const g = await scenario([{ battlefield: ['Kiki-Jiki, Mirror Breaker', 'Pestermite'] }, {}], { rules: 10 });
  g.active = 0;
  await g.goOff(P(g, 0), combo('Kiki-Jiki, Mirror Breaker + Pestermite')); await settle(g);
  ok(P(g, 1).lost, 'the opponent lost through the shortcut, as old replays expect');
  ok(lines(g).some(l => /^Combo!/.test(l)), 'the old shortcut ran');
});

let failed = 0;
for (const [name, e] of results) { if (e) { failed++; console.log(`FAIL  ${name}\n      ${e.message}`); } else console.log(`ok    ${name}`); }
console.log(`Combos: ${results.length} tests, ${results.length - failed} passed, ${failed} failed.`);
if (failed) process.exit(1);
