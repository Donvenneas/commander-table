// Audit probes (2026-11-13, version 1.31.0): one small board per finding in AUDIT-ROADMAP.md. Every probe FAILS today
// and names the roadmap item that fixes it. Not part of CI: when an item is fixed, move its probes into
// tests/interactions.mjs (with the "old replays" twin where behaviour is gated behind a rules version) and delete
// them here. The file is done when it is empty.
//   node tests/audit-probes.mjs            every probe (exit 1 while any still fails)
//   node tests/audit-probes.mjs Blood      only the probes whose name contains "Blood"
//   node tests/audit-probes.mjs --scan     the reader scans: cards counted as fully read whose text is not all used
import { readFileSync } from 'node:fs';
import { scenario, find, P, tgtObj, resolveEffects, settle, hasCard, card } from './scenario.mjs';

const arg = process.argv[2];
const out = [];
let failed = 0;
const test = async (item, name, cards, fn) => {
  if (arg && arg !== '--scan' && !name.toLowerCase().includes(arg.toLowerCase())) return;
  const miss = cards.filter(c => !hasCard(c));
  if (miss.length) { out.push(`SKIP  [${item}] ${name}  (no card data: ${miss.join(', ')})`); return; }
  try { await fn(); out.push(`FIXED [${item}] ${name}  (move it to interactions.mjs)`); } catch (e) { failed++; out.push(`FAIL  [${item}] ${name}\n        ${String(e.message).split('\n')[0]}`); }
};
const eq = (got, want, what) => { if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`${what}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); };
const ok = (c, what) => { if (!c) throw new Error(what); };
const mana = (g, i) => { g.active = i; P(g, i).infiniteMana = g.turn; };
const cast = async (g, i, name, choice = {}) => { const o = find(g, i, name, 'hand'); ok(o, `${name} in hand`); const r = await g.cast(P(g, i), o, choice); await settle(g); return r; };
const spell = async (g, i, name, targets = []) => { const o = find(g, i, name, 'hand'); ok(o, `${name} in hand`); await resolveEffects(g, i, o, o.fx.spell, targets); return o; };
// A spell waiting on the stack, for counterspell probes
const onStack = (g, i, name) => { const o = find(g, i, name, 'hand'); const item = { o, p: P(g, i), effects: [], targets: [] }; g.stack.push(item); return item; };

if (arg !== '--scan') {
  // ---------- 205: things that happen at the same time (603.10a: leaves-the-battlefield triggers look back)
  await test(205, 'Wrath of God + Blood Artist: it sees every creature die with it (4 drains)', ['Wrath of God', 'Blood Artist', 'Grizzly Bears'], async () => {
    const g = await scenario([{ hand: ['Wrath of God'], battlefield: ['Blood Artist', 'Grizzly Bears'] }, { battlefield: ['Grizzly Bears', 'Grizzly Bears'] }]);
    await spell(g, 0, 'Wrath of God'); eq([P(g, 0).life, P(g, 1).life], [44, 36], 'life totals');
  });
  await test(205, 'Wrath of God + Blood Artist: the result does not depend on battlefield order', ['Wrath of God', 'Blood Artist', 'Grizzly Bears'], async () => {
    const run = async bf => { const g = await scenario([{ hand: ['Wrath of God'], battlefield: bf }, { battlefield: ['Grizzly Bears', 'Grizzly Bears'] }]); await spell(g, 0, 'Wrath of God'); return P(g, 1).life; };
    eq(await run(['Blood Artist', 'Grizzly Bears']), await run(['Grizzly Bears', 'Blood Artist']), 'opponent life with Blood Artist first / last');
  });
  await test(205, 'Blasphemous Act + Blood Artist: lethal damage kills everything at once (4 drains)', ['Blasphemous Act', 'Blood Artist', 'Grizzly Bears'], async () => {
    const g = await scenario([{ hand: ['Blasphemous Act'], battlefield: ['Blood Artist', 'Grizzly Bears'] }, { battlefield: ['Grizzly Bears', 'Grizzly Bears'] }]);
    await spell(g, 0, 'Blasphemous Act'); eq([P(g, 0).life, P(g, 1).life], [44, 36], 'life totals');
  });

  // ---------- 206: an "if" the reader can't read counts as true
  await test(206, 'Mana Crypt: the upkeep damage is a coin flip (about 12 in 8 upkeeps, not 24)', ['Mana Crypt'], async () => {
    const g = await scenario([{ battlefield: ['Mana Crypt'] }, {}]);
    const c = find(g, 0, 'Mana Crypt');
    for (let k = 0; k < 8; k++) { g.turn++; g.trigger(c, 'upkeep'); await settle(g); }
    const lost = 40 - P(g, 0).life; ok(lost > 0 && lost < 24, `lost ${lost} life in 8 upkeeps (24 = every time, 0 = never)`);
  });

  // ---------- 207: "X, where X is …" plays as 0
  await test(207, 'Krenko, Mob Boss with three Goblins makes three tokens', ['Krenko, Mob Boss', 'Goblin Matron'], async () => {
    const g = await scenario([{ battlefield: ['Krenko, Mob Boss', 'Goblin Matron', 'Goblin Matron'] }, {}]);
    g.active = 0; await g.activate(P(g, 0), find(g, 0, 'Krenko, Mob Boss'), 0, {}); await settle(g);
    eq(P(g, 0).battlefield.filter(o => o.token).length, 3, 'Goblin tokens');
  });
  await test(207, 'Chain Reaction with three creatures out deals 3 to each', ['Chain Reaction', 'Grizzly Bears'], async () => {
    const g = await scenario([{ hand: ['Chain Reaction'] }, { battlefield: ['Grizzly Bears', 'Grizzly Bears', 'Grizzly Bears'] }]);
    await spell(g, 0, 'Chain Reaction'); eq(P(g, 1).battlefield.length, 0, 'Grizzly Bears left');
  });
  await test(207, 'Dockside Extortionist counts the opponents\' artifacts and enchantments', ['Dockside Extortionist', 'Sol Ring', 'Rhystic Study'], async () => {
    const g = await scenario([{ hand: ['Dockside Extortionist'] }, { battlefield: ['Sol Ring', 'Rhystic Study', 'Sol Ring'] }]);
    mana(g, 0); await cast(g, 0, 'Dockside Extortionist'); eq(P(g, 0).battlefield.filter(o => o.token).length, 3, 'Treasures');
  });

  // ---------- 208: counterspells with a condition are plain Counterspells
  await test(208, 'Mana Leak: a player with six untapped lands pays {3} and keeps the spell', ['Mana Leak', 'Grizzly Bears', 'Forest'], async () => {
    const g = await scenario([{ hand: ['Grizzly Bears'], battlefield: Array(6).fill('Forest') }, { hand: ['Mana Leak'] }]);
    const item = onStack(g, 0, 'Grizzly Bears'); const ml = find(g, 1, 'Mana Leak', 'hand');
    await g.runEffects(P(g, 1), ml, ml.fx.spell, { targets: [{ spell: item }], strict: true }); eq(!!item.countered, false, 'countered');
  });
  await test(208, 'Mental Misstep cannot counter a spell with mana value 2', ['Mental Misstep', 'Grizzly Bears'], async () => {
    const g = await scenario([{ hand: ['Grizzly Bears'] }, { hand: ['Mental Misstep'] }]);
    const item = onStack(g, 0, 'Grizzly Bears'); const mm = find(g, 1, 'Mental Misstep', 'hand');
    await g.runEffects(P(g, 1), mm, mm.fx.spell, { targets: [{ spell: item }], strict: true }); eq(!!item.countered, false, 'countered');
  });
  await test(208, 'Pyroblast does nothing to a green permanent', ['Pyroblast', 'Grizzly Bears'], async () => {
    const g = await scenario([{ hand: ['Pyroblast'] }, { battlefield: ['Grizzly Bears'] }]);
    const b = find(g, 1, 'Grizzly Bears'); const py = find(g, 0, 'Pyroblast', 'hand');
    await resolveEffects(g, 0, py, py.fx.modes.modes[1], [tgtObj(b)]); eq(b.zone, 'battlefield', 'Grizzly Bears zone');
  });

  // ---------- 209 and 200: what a spell may target
  await test(209, 'Doom Blade cannot destroy a black creature', ['Doom Blade', 'Vampire Nighthawk'], async () => {
    const g = await scenario([{ hand: ['Doom Blade'] }, { battlefield: ['Vampire Nighthawk'] }]);
    const v = find(g, 1, 'Vampire Nighthawk'); mana(g, 0); await cast(g, 0, 'Doom Blade', { targets: [tgtObj(v)] });
    eq(v.zone, 'battlefield', 'Vampire Nighthawk zone');
  });
  await test(200, 'Game.cast refuses a target of the wrong kind (Doom Blade at Sol Ring)', ['Doom Blade', 'Sol Ring'], async () => {
    const g = await scenario([{ hand: ['Doom Blade'] }, { battlefield: ['Sol Ring'] }]);
    const s = find(g, 1, 'Sol Ring'); mana(g, 0); await cast(g, 0, 'Doom Blade', { targets: [tgtObj(s)] });
    eq(s.zone, 'battlefield', 'Sol Ring zone');
  });
  await test(200, 'Game.canCast says no to a sorcery on an opponent\'s turn', ['Divination', 'Island'], async () => {
    const g = await scenario([{ battlefield: ['Island', 'Island', 'Island'], hand: ['Divination'] }, {}]);
    g.active = 1; eq(!!g.canCast(P(g, 0), find(g, 0, 'Divination', 'hand')), false, 'castable');
  });

  // ---------- 210: "until this leaves the battlefield"
  await test(210, 'Banishing Light: the exiled permanent comes back when Banishing Light leaves', ['Banishing Light', 'Sol Ring'], async () => {
    const g = await scenario([{ hand: ['Banishing Light'] }, { battlefield: ['Sol Ring'] }]);
    mana(g, 0); const s = find(g, 1, 'Sol Ring'); await cast(g, 0, 'Banishing Light', { targets: [tgtObj(s)] });
    const during = s.zone; g.destroy(find(g, 0, 'Banishing Light')); await settle(g);
    eq([during, s.zone], ['exile', 'battlefield'], 'Sol Ring while exiled / after');
  });

  // ---------- 211: imprint
  await test(211, 'Chrome Mox with nothing imprinted makes no mana', ['Chrome Mox'], async () => {
    const g = await scenario([{ battlefield: ['Chrome Mox'] }, {}]); eq(g.availableMana(P(g, 0)), 0, 'available mana');
  });

  // ---------- 212: layers
  await test(212, 'Humility + Glorious Anthem: Craterhoof Behemoth is a 2/2 with no abilities', ['Humility', 'Glorious Anthem', 'Craterhoof Behemoth'], async () => {
    const g = await scenario([{ battlefield: ['Humility', 'Glorious Anthem', 'Craterhoof Behemoth'] }, {}]);
    const c = find(g, 0, 'Craterhoof Behemoth'); eq([g.power(c), g.toughness(c), g.has(c, 'trample'), g.has(c, 'haste')], [2, 2, false, false], 'power / toughness / trample / haste');
  });
  console.log(out.join('\n'));
  console.log(`\nAudit probes: ${out.length} run, ${failed} still failing.`);
  process.exit(failed ? 1 : 0);
}

// ---------- item 213: cards the reader counts as fully read (no fx.unread line) although part of the text is not
// in what it produced. Word matching only: every hit needs a look, and a few are fine (the notes say which).
const raw = JSON.parse(readFileSync(new URL('./cards-snapshot.json', import.meta.url), 'utf8'));
const CHECKS = [
  [206, 'an "if" the reader could not read (treated as true)', () => true, /"c":"\?"/, true],
  [207, '"X, where X is …" left as the cast X (plays as 0)', (t, r) => /where X is/i.test(t) && !/\{X\}/.test(r.mana_cost || '') && !/\{X\}/.test(t), /:"X"/, true],
  [208, 'a counterspell\'s "unless … pays" not read', t => /counter target [^.]*unless/i.test(t), /unless|tax|pay/i],
  [208, 'a counterspell\'s mana value limit not read', t => /counter target [^.]*with mana value/i.test(t), /mv|manaValue|cmc/i],
  [209, 'target non-<color> not read', t => /target non(black|white|blue|red|green)/i.test(t), /non(black|white|blue|red|green)|notColor/i],
  [209, 'target nonartifact not read', t => /target nonartifact/i.test(t), /nonartifact/i],
  [209, 'target … with mana value N or less/greater not read', t => /target [a-z ,]*with mana value (\d+|x) or (less|greater)/i.test(t), /mv|manaValue|cmc/i],
  [209, 'target creature with power/toughness N or … not read', t => /target creature with (power|toughness) (\d+) or (greater|less)/i.test(t), /power|tough|minP|maxP/i],
  [209, 'target attacking/blocking creature not read', t => /target (attacking|blocking|attacking or blocking) creature/i.test(t), /attacking|blocking/i],
  [209, 'target (non)legendary not read', t => /target (non)?legendary/i.test(t), /legend/i],
  [209, '"up to N target" not read', t => /up to (one|two|three|x) (other )?target/i.test(t), /upTo|"n":/i],
  [209, 'target … you control not read (a person could aim it at an opponent\'s permanent)', t => /target (creature|permanent|artifact|nonland permanent|land) you control/i.test(t), /you|own|mine|yours/i],
  [210, '"until … leaves the battlefield" not read', t => /until (this [a-z]+|[A-Z][a-zA-Z', ]+) leaves the battlefield/.test(t), /until|leaves|linked/i],
  [206, 'a coin flip not read', t => /flip a coin/i.test(t), /coin|flip/i],
  [214, '"you may play/cast … this turn" window not read', t => /you may (cast|play) [^.]* (this turn|until end of turn|until the end of your next turn)/i.test(t), /mayPlay|impulse|until|play/i],
];
const hits = CHECKS.map(() => []);
let full = 0;
raw.forEach((r, i) => {
  let c; try { c = card(r.name); } catch { return; }
  if ((c.fx.unread || []).length) return;
  full++;
  const text = (r.oracle_text || (r.card_faces || []).map(f => f.oracle_text).join('\n') || '').replace(/\([^)]*\)/g, '');
  const { unread, type, ...rest } = c.fx;
  const js = JSON.stringify(rest);
  CHECKS.forEach(([, , inText, inFx, wantPresent], k) => { if (inText(text, r) && (wantPresent ? inFx.test(js) : !inFx.test(js))) hits[k].push(`${r.name} (#${i + 1})`); });
});
console.log(`Reader scan: ${full} of ${raw.length} snapshot cards have no unread line. Suspect readings among them:\n`);
CHECKS.forEach(([item, label], k) => { if (hits[k].length) console.log(`[${item}] ${label}: ${hits[k].length}\n      ${hits[k].join('; ')}\n`); });
