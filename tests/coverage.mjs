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
import { ignoredText, droppedSentences, cleanText, KEYWORDS, MORE_KEYWORDS } from '../public/js/effects.js';
import { replacementGaps } from '../public/js/replacements.js';

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

// (Phase 2I) Misreadings found by hand: text the reader turns into something different from what is printed. A
// card here is counted as "incorrect" even when every line is read. Each entry is a check on the card's text and
// reading, so it stays true only while the misreading is there (a fixed card drops out by itself).
const lifeKinds = new Set(['loseSelf', 'loseLife', 'drain', 'loseEach']);
const MISREAD = [
  { why: '"target player / each player draws … and loses N life": the life loss (and the target) is not read', test: (t, fx) => /(?:target player|each player|target opponent) draws? [^.]* and loses? (?:\d+|x) life/.test(t) && ![...kindsIn(fx)].some(k => lifeKinds.has(k)) },
  { why: '"protection from colorless or from the color of your choice" is played as hexproof', test: (t, fx) => / or from the color of your choice/.test(t) && [...kindsIn(fx)].includes('protect') },
  // (item 213, the 1.31.0 audit) Families where a line counts as read but a condition in it is not in the reading.
  // Word matching against the reading's JSON: a family's cards leave the list when the reader keeps the condition
  // (or marks the line unread). j is the reading as JSON, without its unread list.
  { why: 'an "if" the reader can\'t read (rules 17: that part does nothing and is reported; before: treated as true)', test: (t, fx, j) => /"c":"\?","text":"[^"]*"\}/.test(j) },
  { why: '"X, where X is …" is left as the X paid on casting (plays as 0)', test: (t, fx, j, card) => /where x is/.test(t) && /:"X"/.test(j) && (!/"xw"/.test(j) || /"xw":\{"dyn":"\?"/.test(j)) &&!/\{x\}/i.test(card.manaCost || '') && !/\{x\}/.test(t) },
  { why: 'a counterspell\'s "unless … pays" is not read (a hard counter)', test: (t, fx, j) => /counter target [^.]*unless/.test(t) && !/unless|tax|pay/i.test(j) },
  { why: 'a counterspell\'s mana value limit is not read', test: (t, fx, j) => /counter target [^.]*with mana value/.test(t) && !/"mv"|manaValue|cmc/i.test(j) },
  { why: '"target non<color>" is not read', test: (t, fx, j) => /target non(black|white|blue|red|green)/.test(t) && !/non(black|white|blue|red|green)|notColor/i.test(j) },
  { why: '"target nonartifact" is not read', test: (t, fx, j) => /target nonartifact/.test(t) && !/nonartifact/i.test(j) },
  { why: '"target … with mana value N or less/greater" is not read', test: (t, fx, j) => /target [a-z ,]*with mana value (\d+|x) or (less|greater)/.test(t) && !/"mv"|manaValue|cmc/i.test(j) },
  { why: '"target creature with power/toughness N or …" is not read', test: (t, fx, j) => /target creature with (power|toughness) (\d+) or (greater|less)/.test(t) && !/power|tough|minP|maxP/i.test(j) },
  { why: '"target attacking/blocking creature" is not read', test: (t, fx, j) => /target (attacking|blocking|attacking or blocking) creature/.test(t) && !/attacking|blocking/i.test(j) },
  { why: '"target (non)legendary" is not read', test: (t, fx, j) => /target (non)?legendary/.test(t) && !/legend/i.test(j) },
  { why: '"up to N target" is not read', test: (t, fx, j) => /up to (one|two|three|x) (other )?target/.test(t) && !/upTo|"n":/i.test(j) },
  { why: '"target … you control" is not read (a person could aim it at an opponent\'s permanent)', test: (t, fx, j) => /target (creature|permanent|artifact|nonland permanent|land) you control/.test(t) && !/you|own|mine|yours/i.test(j) },
  { why: '"until ~ leaves the battlefield" is not read (exiled for good)', test: (t, fx, j) => /until (this [a-z]+|~) leaves the battlefield/.test(t) && !/until|leaves|linked|holds/i.test(j) },
  { why: 'a coin flip is not read', test: (t, fx, j) => /flip a coin/.test(t) && !/coin|flip/i.test(j) },
  { why: '"you may play/cast … this turn" is not read', test: (t, fx, j) => /you may (cast|play) [^.]* (this turn|until end of turn|until the end of your next turn)/.test(t) && !/mayPlay|impulse|until|play/i.test(j) },
];
// (Phase 2I) Cards named in a test file: their reading is checked by at least one game test. A full reading of a card
// that no test names is "read, not individually verified".
const TESTS = new URL('./', import.meta.url);
const testSrc = readdirSync(TESTS).filter(f => f.endsWith('.mjs') && f !== 'coverage.mjs').map(f => readFileSync(new URL(f, TESTS), 'utf8')).join('\n');
const tested = new Set([...testSrc.matchAll(/(['"`])((?:(?!\1)[^\n\\])+?)\1/g)].map(m => m[2].toLowerCase()));

// (Phase 2I) Ability types: each printed line of a card is sorted into one, and counted as read, partly read (a
// sentence skipped) or not read. A keyword line counts as read when every keyword on it is one the reader knows.
const KNOWN_KW = new Set([...KEYWORDS, ...MORE_KEYWORDS]);
const kwWord = w => KNOWN_KW.has(w) || [...KNOWN_KW].some(k => w.startsWith(k + ' ') || w.startsWith(k + '—') || w.startsWith(k + ' {')) || /^(enchant|equip|protection from|ward|basic landcycling|\w+cycling|kicker|multikicker|flashback|escape|suspend|unearth|mutate|delve|convoke|affinity for|landwalk|\w+walk|partner|companion|crew \d|ninjutsu|evoke|madness|dash|blitz|embalm|eternalize|cascade|storm|toxic \d|annihilator \d|bushido \d|afflict \d|modular \d|fabricate \d|backup \d|outlast|bestow|disguise|morph|foretell|plot|offspring|prototype|reconfigure|living weapon|split second|changeling|devoid|for mirrodin!)\b/.test(w);
const abilityType = (line, card) => {
  const l = line.replace(/^(?!choose )[a-z0-9',! ]{3,30} — (?=[{a-z~+])/, '');
  if (l.split(/,\s*|;\s*/).every(w => kwWord(w.trim()))) return 'keyword';
  if (card.fx.type.planeswalker && /^[+−-]?(\d+|x): /.test(l)) return 'loyalty';
  if (/^[^:"]*\{t\}[^:"]*: add /.test(l) || /^[^:"]*: add (\{|one mana|two mana|three mana|mana)/.test(l)) return 'mana';
  if (/^(when|whenever|at the beginning|at end of)\b/.test(l)) return 'triggered';
  if (/^[^"]*?(\{[^}]+\}|sacrifice|discard|pay \d+ life|exile [^:]*from your graveyard|remove [^:]*counter|tap an untapped|return [^:]* to its owner's hand)[^:"]*: /.test(l)) return 'activated';
  if (/\bprevent\b/.test(l)) return 'prevention';
  if (/\binstead\b|enters (?:the battlefield )?tapped|enters with|as ~ enters/.test(l)) return 'replacement';
  if (card.fx.type.instant || card.fx.type.sorcery) return 'spell';
  return 'static';
};
const TYPES = ['keyword', 'triggered', 'activated', 'mana', 'loyalty', 'static', 'spell', 'replacement', 'prevention'];
const byType = Object.fromEntries(TYPES.map(t => [t, { lines: 0, read: 0, partial: 0, unread: 0 }]));
const byKeyword = new Map();

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
  const clean = cleanText(card.text || '', card.frontName || card.name);
  const { unread: _u, type: _t, ...fxRest } = fx;
  const fxJson = JSON.stringify(fxRest);
  const misread = MISREAD.filter(m => m.test(clean, fx, fxJson, card)).map(m => m.why);
  // (the abilities on each printed line)
  const abilities = [];
  for (const rawLine of (card.text || '').replace(/\([^)]*\)/g, '').split('\n').map(s => s.trim()).filter(Boolean)) {
    const line = cleanText(rawLine, card.frontName || card.name).trim();
    if (!line) continue;
    const t = abilityType(line, card);
    const st = unread.includes(line) ? 'unread' : dropped.some(d => rawLine.includes(d)) ? 'partial' : 'read';
    abilities.push({ t, st, line: rawLine });
    byType[t].lines++; byType[t][st]++;
  }
  let status;
  if (missingKinds.length || unreadFields.length) status = 'unhandled';
  else if (misread.length) status = 'incorrect';
  else if (ign === 'its abilities' || ign === 'land ability' || (unread.length && !kindsIn(fx).size && !fieldsSet(fx).length)) status = 'unsupported';
  else if (restr.length) status = 'restriction';
  else if (ign) status = 'partial';
  else status = 'full';
  // (replacement effects among the unread text: replacements.js reports these in games too)
  const repl = replacementGaps(card, [...unread, ...dropped]);
  const isTested = tested.has(card.name.toLowerCase()) || (!!card.frontName && tested.has(card.frontName.toLowerCase()));
  rows.push({ rank: i + 1, name: card.name, type: card.typeLine, status, unread, dropped, restr, missingKinds, unreadFields, repl, misread, abilities, tested: isTested, text: clean });
  for (const k of raw.keywords || []) {
    const e = byKeyword.get(k) || { cards: 0, full: 0, tested: 0, statuses: {} };
    e.cards++; if (status === 'full') e.full++; if (isTested) e.tested++;
    e.statuses[status] = (e.statuses[status] || 0) + 1;
    byKeyword.set(k, e);
  }
}

const count = s => rows.filter(r => r.status === s).length;
const ORDER = ['full', 'partial', 'restriction', 'incorrect', 'unhandled', 'unsupported'];
const pct = (n, d) => `${(100 * n / d).toFixed(1)}% (${n}/${d})`;
console.log(`Card coverage: ${rows.length} cards (Scryfall, Commander-legal paper cards in EDHREC order)`);
for (const s of ORDER) console.log(`  ${s.padEnd(12)} ${String(count(s)).padStart(5)}  ${(100 * count(s) / rows.length).toFixed(1)}%`);
const kindsMissing = new Map();
for (const r of rows) for (const k of [...r.missingKinds, ...r.unreadFields.map(f => `fx.${f}`)]) kindsMissing.set(k, [...(kindsMissing.get(k) || []), r.name]);
// (Phase 2I) abilities by type, cards named in a test, and the next batch
const nAb = TYPES.reduce((s, t) => s + byType[t].lines, 0);
const fullRows = rows.filter(r => r.status === 'full');
// Part 2 ranking: every card that isn't full, in the order of the brief's categories (Commander staples = the 300
// most played, then creatures, removal, counterspells, ramp spells, mana permanents, enchantments, artifacts,
// planeswalkers, the rest), most played first within each category; misread cards first (they play wrong today)
const kindsOf = r => r.abilities.map(a => a.t);
const CATS = [
  ['Commander staple (top 300)', r => r.rank <= 300],
  ['creature', r => /Creature/.test(r.type)],
  ['removal', r => /\b(destroy|exile) target|deals? \d+ damage to (?:any|target)|destroy all|exile all/.test(r.text)],
  ['counterspell', r => /counter target/.test(r.text)],
  ['ramp spell', r => /(Instant|Sorcery)/.test(r.type) && /search your library for [^.]*land/.test(r.text)],
  ['mana permanent', r => kindsOf(r).includes('mana')],
  ['enchantment', r => /Enchantment/.test(r.type)],
  ['artifact', r => /Artifact/.test(r.type)],
  ['planeswalker', r => /Planeswalker/.test(r.type)],
  ['other', () => true],
];
const catOf = r => CATS.findIndex(([, f]) => f(r));
const nextBatch = rows.filter(r => r.status !== 'full').sort((a, b) => (a.status === 'incorrect' ? 0 : 1) - (b.status === 'incorrect' ? 0 : 1) || catOf(a) - catOf(b) || a.rank - b.rank);
const missingOf = r => [...r.misread, ...r.unread, ...r.dropped, ...r.missingKinds.map(x => `effect ${x}`), ...r.unreadFields.map(f => `fx.${f}`)];
console.log(`  abilities (printed lines): ${nAb}; read ${pct(TYPES.reduce((s, t) => s + byType[t].read, 0), nAb)}`);
for (const t of TYPES) if (byType[t].lines) console.log(`    ${t.padEnd(12)} ${String(byType[t].lines).padStart(5)} lines, read ${pct(byType[t].read, byType[t].lines)}, partly ${byType[t].partial}, not read ${byType[t].unread}`);
console.log(`  cards named in a test: ${rows.filter(r => r.tested).length}; full and named in a test ${fullRows.filter(r => r.tested).length}, full but not individually verified ${fullRows.filter(r => !r.tested).length}`);
const replRows = rows.filter(r => r.repl.length);
console.log(`  replacement text not read: ${replRows.length} cards (${[...new Set(replRows.flatMap(r => r.repl.map(x => x.why)))].join('; ')})`);
if (kindsMissing.size) console.log(`  read but never handled: ${[...kindsMissing].map(([k, v]) => `${k} (${v.length}: ${v.slice(0, 3).join(', ')}${v.length > 3 ? '…' : ''})`).join('; ')}`);

if (reportAt) {
  const esc = s => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' / ');
  const section = (s, title, n, why) => [`## ${title} (${count(s)})`, '', '| # | Card | What is missing |', '|---|---|---|',
    ...rows.filter(r => r.status === s).slice(0, n).map(r => `| ${r.rank} | ${esc(r.name)} | ${esc(why(r))} |`), ''];
  const md = [
    '# Card coverage audit', '',
    `Generated by \`node tests/coverage.mjs --report\` from tests/cards-snapshot.json: the ${rows.length} most-played Commander cards as Scryfall listed them by EDHREC popularity when the snapshot was taken (the # column is that order). Each card is read with the game's own card reader, and every effect it produces is checked against the engine's handlers.`, '',
    '| Status | Cards | Meaning |', '|---|---|---|',
    `| full | ${count('full')} | every line read, every effect handled (${fullRows.filter(r => r.tested).length} of them named in a test; the other ${fullRows.filter(r => !r.tested).length} are read but not individually verified) |`,
    `| incorrect | ${count('incorrect')} | read, but read as something else (a misreading found by the MISREAD checks in coverage.mjs) |`,
    `| partial | ${count('partial')} | some lines or sentences do nothing |`,
    `| restriction | ${count('restriction')} | an unread restriction: the card plays stronger than printed |`,
    `| unhandled | ${count('unhandled')} | the reader produces something no engine module handles |`,
    `| unsupported | ${count('unsupported')} | none of its abilities is read |`, '',
    '"Full" means the text is read and every effect has a handler; it does not prove each handler is correct. Cards are checked one by one in tests/interactions.mjs and tests/abilities.mjs. "Incorrect" only holds the misreadings the MISREAD checks know about; others may exist among the full cards.', '',
    `## Abilities by type (${nAb} printed lines)`, '', 'Each printed line of every card (reminder text removed) is sorted into one ability type and counted as read, partly read (a sentence skipped) or not read. Read means the reader produced something for it; whether that is handled correctly is the card status above.', '',
    '| Type | Lines | Read | Partly read | Not read |', '|---|---|---|---|---|',
    ...TYPES.filter(t => byType[t].lines).map(t => `| ${t} | ${byType[t].lines} | ${pct(byType[t].read, byType[t].lines)} | ${byType[t].partial} | ${byType[t].unread} |`), '',
    `## Keywords (Scryfall keyword list: ${byKeyword.size} keywords; those on 3 or more cards)`, '', 'For each keyword: the cards that have it, and how many of those cards are full. A keyword can be modelled while cards that have it are partial for another reason, so this is coverage of the cards, not a verdict on the keyword alone; the keyword tests are in tests/abilities.mjs.', '',
    '| Keyword | Cards | Full | Named in a test | Other statuses |', '|---|---|---|---|---|',
    ...[...byKeyword].filter(([, e]) => e.cards >= 3).sort((a, b) => b[1].cards - a[1].cards).map(([k, e]) => `| ${k} | ${e.cards} | ${pct(e.full, e.cards)} | ${e.tested} | ${Object.entries(e.statuses).filter(([s]) => s !== 'full').map(([s, n]) => `${s} ${n}`).join(', ')} |`), '',
    `## Misread cards (${count('incorrect')})`, '', '| # | Card | Misreading |', '|---|---|---|',
    ...rows.filter(r => r.status === 'incorrect').map(r => `| ${r.rank} | ${esc(r.name)} | ${esc(r.misread.join(' / '))} |`), '',
    '## The 100 most-played cards, ability by ability', '', 'One entry per printed line: K keyword, T triggered, A activated, M mana, L loyalty, S static, P spell, R replacement, V prevention, followed by ✓ read, ½ partly read, ✗ not read.', '',
    '| # | Card | Status | Abilities | Missing | Named in a test |', '|---|---|---|---|---|---|',
    ...rows.slice(0, 100).map(r => `| ${r.rank} | ${esc(r.name)} | ${r.status} | ${r.abilities.map(a => ({ keyword: 'K', triggered: 'T', activated: 'A', mana: 'M', loyalty: 'L', static: 'S', spell: 'P', replacement: 'R', prevention: 'V' }[a.t] + ({ read: '✓', partial: '½', unread: '✗' }[a.st]))).join(' ')} | ${esc(missingOf(r).join(' / ')) || '—'} | ${r.tested ? 'yes' : ''} |`), '',
    '## Next implementation batch (ranked)', '', 'Every card that is not full: misread cards first (they play wrong today), then by the categories of the Phase 2I brief (Commander staples = the 300 most played; creatures; removal; counterspells; ramp spells; mana permanents; enchantments; artifacts; planeswalkers; the rest), most played first within each. Popularity is the EDHREC order of the snapshot.', '',
    '| Order | # | Card | Category | Status | What is missing |', '|---|---|---|---|---|---|',
    ...nextBatch.slice(0, 40).map((r, k) => `| ${k + 1} | ${r.rank} | ${esc(r.name)} | ${CATS[catOf(r)][0]} | ${r.status} | ${esc(missingOf(r).join(' / '))} |`), '',
    `## Replacement effects not read (${replRows.length})`, '', 'The game reports these once a game when the card enters the battlefield, and never applies them approximately.', '', '| # | Card | Text | Why |', '|---|---|---|---|',
    ...replRows.slice(0, 60).flatMap(r => r.repl.map(x => `| ${r.rank} | ${esc(r.name)} | ${esc(x.line)} | ${esc(x.why)} |`)), '',
    ...section('unhandled', 'Read but never handled', 50, r => [...r.missingKinds.map(k => `effect "${k}"`), ...r.unreadFields.map(f => `fx.${f}`)].join(', ')),
    ...section('restriction', 'Restrictions not read (stronger than printed): most played first', 60, r => r.restr.join(' / ')),
    ...section('partial', 'Partly read: most played first', 80, r => [...r.unread, ...r.dropped].join(' / ')),
    ...section('unsupported', 'Not read at all: most played first', 60, r => r.unread.join(' / ') || r.type),
  ].join('\n');
  writeFileSync(reportAt, md + '\n');
  console.log(`Report written: ${reportAt}`);
}
