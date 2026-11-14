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
  await test(200, 'Game.canCast says no to a sorcery on an opponent\'s turn', ['Divination', 'Island'], async () => {
    const g = await scenario([{ battlefield: ['Island', 'Island', 'Island'], hand: ['Divination'] }, {}]);
    g.active = 1; eq(!!g.canCast(P(g, 0), find(g, 0, 'Divination', 'hand')), false, 'castable');
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
