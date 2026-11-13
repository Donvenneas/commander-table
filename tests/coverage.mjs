// Card coverage audit (Phase 2E): reads the 3,500 most-played Commander cards (tests/cards-snapshot.json: Scryfall's
// search for Commander-legal paper cards ordered by EDHREC popularity, saved in that order; a card's place in the list
// is its popularity order when the snapshot was taken) with the real card reader, and sorts every card into:
//   full         every line read, and every effect it reads has an engine handler
//   partial      some lines or sentences aren't read (effects.js unread / droppedSentences), but something is
//   restriction  among the unread text is a restriction ("activate only", "spend this mana only", "can't"…): the card
//                plays stronger than printed, which is worse than doing nothing
//   unhandled    the reader produces an effect kind no engine module handles (it silently does nothing:
//                resolve.js doEffectMore's "default: break"), or a flag no module reads
//   unsupported  none of its abilities is read
// A card can be in several of these; it is counted once, in the first that applies of: unhandled, unsupported,
// restriction, partial, full.
//   node tests/coverage.mjs                  summary
//   node tests/coverage.mjs --report FILE    also write a Markdown report (top cards in each group, with reasons)
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { normalize } from '../public/js/scryfall.js';
import { ignoredText, droppedSentences, cleanText } from '../public/js/effects.js';

const args = process.argv.slice(2);
const reportAt = args.includes('--report') ? args[args.indexOf('--report') + 1] : null;
const snap = JSON.parse(readFileSync(new URL('./cards-snapshot.json', import.meta.url), 'utf8'));

// ---------- what the engine handles: every effect kind it switches on or compares, every fx field it reads
const JS = new URL('../public/js/', import.meta.url);
const engineSrc = readdirSync(JS).filter(f => f.endsWith('.js') && f !== 'effects.js').map(f => readFileSync(new URL(f, JS), 'utf8')).join('\n');
const handled = new Set([...engineSrc.matchAll(/case '([A-Za-z0-9]+)'/g), ...engineSrc.matchAll(/\bk === '([A-Za-z0-9]+)'/g), ...engineSrc.matchAll(/\.k === '([A-Za-z0-9]+)'/g), ...engineSrc.matchAll(/\['([A-Za-z0-9', ]+)'\]\.includes\(e\.k\)/g)].flatMap(m => m[1].split(/', '/)));
// (fields read as fx.name, or through a key held as a string: o.fx[k] for k of ['kicker', 'buyback'])
const readFields = new Set([...engineSrc.matchAll(/fx\??\.([A-Za-z0-9]+)/g), ...engineSrc.matchAll(/'([A-Za-z0-9]+)'/g)].map(m => m[1]));
// (fields every reading has, and plain data: not abilities in themselves)
const BASE = new Set(['type', 'subtypes', 'kw', 'spell', 'etb', 'attack', 'upkeep', 'endstep', 'dies', 'abilities', 'pw', 'unread', 'kwN', 'watch', 'landfall', 'combatDamage', 'modes', 'etbModes']);

// Every effect object in a reading (anything with a string `k`), and every field it sets
const kindsIn = (x, out = new Set(), seen = new Set()) => {
  if (!x || typeof x !== 'object' || seen.has(x)) return out;
  seen.add(x);
  if (Array.isArray(x)) { for (const y of x) kindsIn(y, out, seen); return out; }
  if (x instanceof Set) return out;
  if (typeof x.k === 'string') out.add(x.k);
  for (const v of Object.values(x)) kindsIn(v, out, seen);
  return out;
};
const fieldsSet = fx => Object.entries(fx).filter(([k, v]) => !BASE.has(k) && v !== null && v !== false && v !== 0 && !(Array.isArray(v) && !v.length) && !(typeof v === 'object' && !Array.isArray(v) && !(v instanceof Set) && !Object.keys(v).length)).map(([k]) => k);
const RESTRICTION = /\b(activate only|spend this mana only|only if|only during|only as a sorcery|can't|cannot|don't|doesn't|unless|no more than|at most)\b/i;

const rows = [];
for (const [i, raw] of snap.entries()) {
  const card = normalize({ ...raw, legalities: raw.legalities || {}, image_uris: {} });
  const fx = card.fx;
  const ign = ignoredText(card);
  const unread = fx.unread || [];
  const dropped = droppedSentences(card);
  const missingKinds = [...kindsIn(fx)].filter(k => !handled.has(k));
  const unreadFields = fieldsSet(fx).filter(f => !readFields.has(f));
  const restr = [...unread, ...dropped].filter(l => RESTRICTION.test(l));
  let status;
  if (missingKinds.length || unreadFields.length) status = 'unhandled';
  else if (ign === 'its abilities' || ign === 'land ability' || (unread.length && !kindsIn(fx).size && !fieldsSet(fx).length)) status = 'unsupported';
  else if (restr.length) status = 'restriction';
  else if (ign) status = 'partial';
  else status = 'full';
  rows.push({ rank: i + 1, name: card.name, type: card.typeLine, status, unread, dropped, restr, missingKinds, unreadFields, text: cleanText(card.text || '', card.name) });
}

const count = s => rows.filter(r => r.status === s).length;
const ORDER = ['full', 'partial', 'restriction', 'unhandled', 'unsupported'];
console.log(`Card coverage: ${rows.length} cards (Scryfall, Commander-legal paper cards in EDHREC order)`);
for (const s of ORDER) console.log(`  ${s.padEnd(12)} ${String(count(s)).padStart(5)}  ${(100 * count(s) / rows.length).toFixed(1)}%`);
const kindsMissing = new Map();
for (const r of rows) for (const k of [...r.missingKinds, ...r.unreadFields.map(f => `fx.${f}`)]) kindsMissing.set(k, [...(kindsMissing.get(k) || []), r.name]);
if (kindsMissing.size) console.log(`  read but never handled: ${[...kindsMissing].map(([k, v]) => `${k} (${v.length}: ${v.slice(0, 3).join(', ')}${v.length > 3 ? '…' : ''})`).join('; ')}`);

if (reportAt) {
  const esc = s => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' / ');
  const section = (s, title, n, why) => [`## ${title} (${count(s)})`, '', '| # | Card | What is missing |', '|---|---|---|',
    ...rows.filter(r => r.status === s).slice(0, n).map(r => `| ${r.rank} | ${esc(r.name)} | ${esc(why(r))} |`), ''];
  const md = [
    '# Card coverage audit', '',
    `Generated by \`node tests/coverage.mjs --report\` from tests/cards-snapshot.json: the ${rows.length} most-played Commander cards as Scryfall listed them by EDHREC popularity when the snapshot was taken (the # column is that order). Each card is read with the game's own card reader, and every effect it produces is checked against the engine's handlers.`, '',
    '| Status | Cards | Meaning |', '|---|---|---|',
    `| full | ${count('full')} | every line read, every effect handled |`,
    `| partial | ${count('partial')} | some lines or sentences do nothing |`,
    `| restriction | ${count('restriction')} | an unread restriction: the card plays stronger than printed |`,
    `| unhandled | ${count('unhandled')} | the reader produces something no engine module handles |`,
    `| unsupported | ${count('unsupported')} | none of its abilities is read |`, '',
    '"Full" means the text is read and every effect has a handler; it does not prove each handler is correct. Cards are checked one by one in tests/interactions.mjs.', '',
    ...section('unhandled', 'Read but never handled', 50, r => [...r.missingKinds.map(k => `effect "${k}"`), ...r.unreadFields.map(f => `fx.${f}`)].join(', ')),
    ...section('restriction', 'Restrictions not read (stronger than printed): most played first', 60, r => r.restr.join(' / ')),
    ...section('partial', 'Partly read: most played first', 80, r => [...r.unread, ...r.dropped].join(' / ')),
    ...section('unsupported', 'Not read at all: most played first', 60, r => r.unread.join(' / ') || r.type),
  ].join('\n');
  writeFileSync(reportAt, md + '\n');
  console.log(`Report written: ${reportAt}`);
}
