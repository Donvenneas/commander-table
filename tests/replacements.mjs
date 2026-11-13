// Replacement effects (Phase 2F, rules 14: public/js/replacements.js). Each test checks the event that actually
// happened (where a card went, how many cards were drawn, the damage dealt, the tokens made) and what noticed it
// (triggers, logs, Game.replaceLog), with real cards from tests/scenario.mjs.
//   node tests/replacements.mjs            run them all (exit 1 on any failure)
//   node tests/replacements.mjs Archive    only the tests whose name contains "Archive"
import { scenario, find, P, logText, errors, settle } from './scenario.mjs';
import { RULES } from '../public/js/engine.js';
import { HumanAgent } from '../public/js/human.js';

const only = process.argv[2];
const results = [];
const test = async (name, fn) => {
  if (only && !name.toLowerCase().includes(only.toLowerCase())) return;
  try { await fn(); results.push([name, null]); } catch (e) { results.push([name, e]); }
};
const eq = (got, want, what) => { if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`${what}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); };
const ok = (cond, what) => { if (!cond) throw new Error(what); };
const noErrors = g => eq(errors(g).length, 0, 'simulator errors');
const lines = g => logText(g).replace(/&#39;/g, "'").replace(/&quot;/g, '"').split('\n');
const applied = g => (g.replaceLog || []).map(x => `${x.type}: ${x.applied.join(' + ')}`);
ok(RULES >= 14, `these tests are for rules 14 and later (RULES is ${RULES})`);
const table = async (p0, p1 = {}, opts = {}) => { const g = await scenario([p0, p1], opts); g.active = 0; g.phase = 'main1'; return g; };
const moves = g => { const m = []; g.on('move', d => m.push(d)); return m; };

// ---------- zone changes
await test('1, 11. Rest in Peace: a creature that would die is exiled instead; it never died, so no "dies" trigger', async () => {
  const g = await table({ battlefield: ['Grizzly Bears', 'Rest in Peace'] }, { battlefield: ['Blood Artist'] });
  const m = moves(g);
  const bears = find(g, 0, 'Grizzly Bears');
  g.destroy(bears); await settle(g);
  eq(bears.zone, 'exile', 'zone');
  const ev = m.find(d => d.iid === bears.iid);
  eq([ev.to, ev.died], ['exile', false], 'the move event: to exile, not a death');
  ok(!lines(g).some(l => /^Blood Artist —/.test(l)), "Blood Artist didn't trigger");
  eq(applied(g), ['move: Rest in Peace'], 'replacement applied');
  noErrors(g);
});
await test('12. Without Rest in Peace the creature dies, and the "dies" trigger happens', async () => {
  const g = await table({ battlefield: ['Grizzly Bears'] }, { battlefield: ['Blood Artist'] });
  g.destroy(find(g, 0, 'Grizzly Bears')); await settle(g);
  ok(P(g, 0).graveyard.some(o => o.card.name === 'Grizzly Bears'), 'in the graveyard');
  ok(lines(g).some(l => /^Blood Artist —/.test(l)), 'Blood Artist triggered');
  eq(applied(g), [], 'no replacement');
});
await test('8. Two replacements apply (Rest in Peace and Dauthi Voidwalker): one is applied, and the card is exiled once', async () => {
  const g = await table({ battlefield: ['Grizzly Bears'] }, { battlefield: ['Rest in Peace', 'Dauthi Voidwalker'] });
  g.destroy(find(g, 0, 'Grizzly Bears')); await settle(g);
  eq(P(g, 0).exile.map(o => o.card.name), ['Grizzly Bears'], 'exiled');
  eq(applied(g).length, 1, 'one replacement event');
  eq(g.replaceLog[0].applied.length, 1, 'only one of the two applied (the other no longer applied: the card was no longer going to a graveyard)');
});
await test('9. Blightsteel Colossus with Rest in Peace: its own replacement goes first, and then Rest in Peace no longer applies', async () => {
  const g = await table({ battlefield: ['Blightsteel Colossus', 'Rest in Peace'] });
  const bc = find(g, 0, 'Blightsteel Colossus');
  g.move(bc, 'graveyard'); await settle(g);
  eq(bc.zone, 'library', 'shuffled into the library, not exiled');
  eq(applied(g), ["move: Blightsteel Colossus (shuffled into its owner's library)"], 'only its own replacement applied');
  // (and Rest in Peace alone still exiles another card)
  g.move(find(g, 0, 'Rest in Peace'), 'graveyard');
  eq(P(g, 0).exile.map(o => o.card.name), ['Rest in Peace'], 'Rest in Peace exiles itself on the way');
});

// ---------- entering
await test('2. Authority of the Consuls: a creature an opponent casts enters tapped instead of untapped', async () => {
  const g = await table({ battlefield: ['Forest', 'Forest'], hand: ['Grizzly Bears'] }, { battlefield: ['Authority of the Consuls'] });
  await g.cast(P(g, 0), find(g, 0, 'Grizzly Bears', 'hand')); await settle(g);
  eq(find(g, 0, 'Grizzly Bears').tapped, true, 'tapped');
  eq(applied(g), ['enter: Authority of the Consuls'], 'replacement applied');
  const g2 = await table({ battlefield: ['Forest', 'Forest'], hand: ['Grizzly Bears'] }, { battlefield: ['Authority of the Consuls'] }, { rules: 13 });
  await g2.cast(P(g2, 0), find(g2, 0, 'Grizzly Bears', 'hand')); await settle(g2);
  eq(find(g2, 0, 'Grizzly Bears').tapped, true, 'rules 13 (old replays): the same result, through the old code');
});
await test('3. Hardened Scales: Walking Ballista for X = 2 enters with one more counter', async () => {
  const g = await table({ battlefield: ['Hardened Scales', ...Array(4).fill('Wastes')], hand: ['Walking Ballista'] });
  await g.cast(P(g, 0), find(g, 0, 'Walking Ballista', 'hand'), { x: 2 }); await settle(g);
  eq(find(g, 0, 'Walking Ballista').counters, 3, 'counters');
});

// ---------- draws
await test('4, 10. Alhammarret\'s Archive: a draw becomes two; with Teferi\'s Ageless Insight as well, four, not more (each applies once)', async () => {
  const g = await table({ battlefield: ["Alhammarret's Archive"] });
  const h = P(g, 0).hand.length;
  g.draw(P(g, 0), 1);
  eq(P(g, 0).hand.length, h + 2, 'one Archive: two cards');
  // (two of these, not two Archives: the Archive is legendary)
  const g2 = await table({ battlefield: ["Alhammarret's Archive", "Teferi's Ageless Insight"] });
  const h2 = P(g2, 0).hand.length;
  g2.draw(P(g2, 0), 1);
  eq(P(g2, 0).hand.length, h2 + 4, 'two doublers: four cards (each doubles once per draw it replaces)');
  // (the first card drawn in your draw step isn't doubled)
  const g3 = await table({ battlefield: ["Alhammarret's Archive"] });
  g3.phase = 'draw';
  const h3 = P(g3, 0).hand.length;
  g3.draw(P(g3, 0), 1);
  eq(P(g3, 0).hand.length, h3 + 1, 'first draw of the draw step: one card');
});
await test('5. Notion Thief: an opponent\'s draw is replaced by its controller drawing instead', async () => {
  const g = await table({}, { battlefield: ['Notion Thief'] });
  const [a, b] = [P(g, 0).hand.length, P(g, 1).hand.length];
  g.draw(P(g, 0), 2);
  eq([P(g, 0).hand.length, P(g, 1).hand.length], [a, b + 2], 'P1 drew nothing, P2 drew two');
  eq(lines(g).filter(l => /draws instead of P1 \(Notion Thief\)/.test(l)).length, 2, 'each draw replaced');
});
await test('5b. Underrealm Lich: each draw looks at three, one to hand, two to the graveyard', async () => {
  const g = await table({ battlefield: ['Underrealm Lich'] });
  const [h, gy] = [P(g, 0).hand.length, P(g, 0).graveyard.length];
  g.draw(P(g, 0), 1);
  eq([P(g, 0).hand.length - h, P(g, 0).graveyard.length - gy], [1, 2], 'hand +1, graveyard +2');
});
await test('14. Notion Thief on both sides: no endless replacement (a draw made instead is not replaced again)', async () => {
  const g = await table({ battlefield: ['Notion Thief'] }, { battlefield: ['Notion Thief'] });
  const [a, b] = [P(g, 0).hand.length, P(g, 1).hand.length];
  g.draw(P(g, 0), 1);
  eq([P(g, 0).hand.length, P(g, 1).hand.length], [a, b + 1], 'P2 drew one instead, and that draw was not replaced back');
  noErrors(g);
});

// ---------- damage
await test('6. Glacial Chasm: damage to its controller is prevented, so no damage is dealt and nothing that notices damage happens', async () => {
  const g = await table({ battlefield: ['Glacial Chasm'] }, { battlefield: ['Grizzly Bears'] });
  g.damagePlayer(P(g, 0), 3, find(g, 1, 'Grizzly Bears'), false);
  eq(P(g, 0).life, 40, 'life');
  eq(P(g, 0).damagedTurn, undefined, 'not dealt damage');
  ok(lines(g).some(l => /3 damage to P1 is prevented/.test(l)), 'the prevention is logged');
  eq(applied(g), ['damage: Glacial Chasm'], 'replacement applied');
});
await test('7. Damage changed: Torbran adds 2 to a red source\'s damage; Pariah\'s redirection is reported as unsupported, not approximated', async () => {
  const g = await table({ battlefield: ['Torbran, Thane of Red Fell'] }, {});
  g.damagePlayer(P(g, 1), 1, find(g, 0, 'Torbran, Thane of Red Fell'), false);
  eq(P(g, 1).life, 37, '1 + 2 damage');
  const g2 = await table({ hand: ['Pariah'] }, { battlefield: ['Grizzly Bears'] });
  const pariah = find(g2, 0, 'Pariah', 'hand');
  g2.move(pariah, 'battlefield'); await settle(g2);
  ok(g2.replaceGaps?.some(x => x.card === 'Pariah' && /redirection is not modelled/.test(x.why)), `reported: ${JSON.stringify(g2.replaceGaps)}`);
  ok(lines(g2).some(l => /^Pariah: ".*" does nothing here: damage redirection is not modelled/.test(l)), 'said in the log');
  g2.damagePlayer(P(g2, 0), 2, find(g2, 1, 'Grizzly Bears'), false);
  eq(P(g2, 0).life, 38, 'the damage is dealt to the player as normal (nothing approximated)');
  g2.move(pariah, 'hand'); g2.move(pariah, 'battlefield'); await settle(g2);
  eq(g2.replaceGaps.filter(x => x.card === 'Pariah').length, 1, 'said once a game');
});

// ---------- tokens
await test('13. Anointed Procession: a token effect makes twice as many', async () => {
  const g = await table({ battlefield: ['Anointed Procession'] });
  await g.runEffects(P(g, 0), find(g, 0, 'Anointed Procession'), [{ k: 'token', n: 2, p: 1, t: 1, desc: 'white soldier', kw: [] }], { targets: [], strict: true }); await settle(g);
  eq(P(g, 0).battlefield.filter(o => o.token).length, 4, 'tokens');
  eq(applied(g), ['tokens: Anointed Procession'], 'replacement applied');
});
await test('15. Xorn and Anointed Procession on one Treasure: the order matters, and a person chooses it', async () => {
  const run = async (person, pick) => {
    const g = await table({ battlefield: ['Xorn', 'Anointed Procession'] });
    let asked = null;
    if (person) Object.assign(P(g, 0).agent, { ui: { ask: async (text, o) => { asked = { text, labels: o.buttons.map(b => b.label) }; return { button: o.buttons.findIndex(b => b.label.startsWith(pick)) }; } }, chooseReplacementAsync: HumanAgent.prototype.chooseReplacementAsync });
    await g.runEffects(P(g, 0), find(g, 0, 'Xorn'), [{ k: 'treasure', n: 1 }], { targets: [], strict: true }); await settle(g);
    return { asked, treasures: P(g, 0).battlefield.filter(o => o.card.name === 'Treasure').length, log: lines(g) };
  };
  const xornFirst = await run(true, 'Xorn'), doubleFirst = await run(true, 'Anointed Procession'), ai = await run(false);
  ok(xornFirst.asked && /Several replacement effects apply/.test(xornFirst.asked.text), 'the person was asked');
  eq(xornFirst.asked.labels.sort(), ['Anointed Procession → 3 treasure', 'Xorn → 4 treasure'], 'each choice shows where it leads');
  eq([xornFirst.treasures, doubleFirst.treasures], [4, 3], 'Xorn first: (1 + 1) × 2; Anointed first: 1 × 2 + 1');
  ok(doubleFirst.log.some(l => /P1 applies Anointed Procession first/.test(l)), "the person's choice is logged");
  eq(ai.treasures, 4, 'the AI takes the order best for it');
});
await test('Old replays (rules 13): the extra Treasure is added after the doubling, as before', async () => {
  const g = await table({ battlefield: ['Xorn', 'Anointed Procession'] }, {}, { rules: 13 });
  await g.runEffects(P(g, 0), find(g, 0, 'Xorn'), [{ k: 'treasure', n: 1 }], { targets: [], strict: true }); await settle(g);
  eq(P(g, 0).battlefield.filter(o => o.card.name === 'Treasure').length, 3, 'treasures');
});

let failed = 0;
for (const [name, e] of results) { if (e) { failed++; console.log(`FAIL  ${name}\n      ${e.message}`); } else console.log(`ok    ${name}`); }
console.log(`Replacements: ${results.length} tests, ${results.length - failed} passed, ${failed} failed.`);
if (failed) process.exit(1);
