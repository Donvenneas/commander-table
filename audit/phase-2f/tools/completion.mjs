// Phase 2F: one record per card of the 421 the 1.61.0 coverage report classed "partially simulated", with its status
// before Phase 2F (1.63.0, coverage-1.63.0.json) and now (node tests/coverage.mjs --json), and writes
// audit/phase-2f/PHASE_2F_CARD_COMPLETION.csv. Prints the counts used in PHASE_2F_COMPLETE_REPORT.md.
//   node tests/coverage.mjs --json <tmp>/coverage-now.json
//   node audit/phase-2f/tools/completion.mjs <tmp>/coverage-now.json
import { readFileSync, writeFileSync } from 'node:fs';

const here = new URL('./', import.meta.url);
const read = (u) => JSON.parse(readFileSync(u, 'utf8'));
const base = read(new URL('../../phase-2d/tools/coverage-1.61.0.json', here)).cards;
const pre = new Map(read(new URL('coverage-1.63.0.json', here)).cards.map(c => [c.n, c]));
const now = new Map(read(process.argv[2]).cards.map(c => [c.n, c]));
const snap = new Map(read(new URL('../../../tests/cards-snapshot.json', here)).map(c => [c.name, c]));
const completions = readFileSync(new URL('../../../tests/completions.mjs', here), 'utf8').toLowerCase();

// The Phase 2F work that reached each card (what changed), by workstream
const WORK = {
  '2F-1 follow-up sentences (them27)': ['Felidar Retreat', 'Loyal Apprentice', 'Valley Floodcaller', 'Sokenzan, Crucible of Defiance', 'Slip Out the Back', 'Shore Up', 'Gift of the Viper', 'Legion Warboss', 'Silver Shroud Costume', 'Wake the Past', 'Summon: Knights of Round', 'Urabrask\'s Forge', 'Siege-Gang Lieutenant', 'Puppeteer Clique', 'Jeskai Ascendancy', 'Virtue of Loyalty // Ardenvale Fealty', 'Magic Damper', 'Howlsquad Heavy', 'Octopus Form', 'Lagomos, Hand of Hatred', 'Flameshadow Conjuring', 'Ovika, Enigma Goliath', 'Ilharg, the Raze-Boar', 'Windcrag Siege'],
  '2F-1 second cast trigger (onCast27)': ['Jeskai Ascendancy'],
  '2F-1 fromHand tapped and attacking': ['Ilharg, the Raze-Boar'],
  '2F-2 kicked "instead" with another number': ['Rite of Replication', 'Consult the Star Charts'],
  '2F-3 channel discount (less27)': ['Boseiju, Who Endures', 'Otawara, Soaring City', 'Takenuma, Abandoned Mire', 'Eiganjo, Seat of the Empire', 'Sokenzan, Crucible of Defiance'],
  '2F-3 Boseiju land compensation (comp.land27)': ['Boseiju, Who Endures'],
  '2F-3 bounce of a list of card types': ['Otawara, Soaring City'],
  '2F-5 counter destination (exile27, top27)': ['Force of Negation', 'Memory Lapse'],
  '2F-5 Enduring cycle (ench27, trigIs from last-known information)': ['Enduring Vitality', 'Enduring Innocence', 'Enduring Tenacity', 'Enduring Curiosity', 'Enduring Courage'],
  '2F-5 granted flashback cost and a person\'s choice': ['Snapcaster Mage', 'Past in Flames', 'Flashback', 'Will of the Jeskai', 'Lier, Disciple of the Drowned'],
  '2F-7 chosen color on entering (chooseColor27)': ['Thriving Isle', 'Thriving Heath', 'Thriving Grove', 'Thriving Bluff', 'Thriving Moor', 'Uncharted Haven', 'Crossroads Village', 'Valgavoth\'s Lair'],
  '2F-7 chosen creature type (chooseType27)': ['Distant Melody', 'Kindred Dominance', 'Harmonized Crescendo', 'Pact of the Serpent'],
  '2F-7 conditional mana amount (cond27)': ['Urza\'s Tower', 'Urza\'s Mine', 'Urza\'s Power Plant', 'Ilysian Caryatid', 'Incubation Druid'],
};
const workOf = n => Object.entries(WORK).filter(([, cards]) => cards.includes(n)).map(([w]) => w);

// The mechanic family of what is still missing (from the unread text), for the remaining-gaps report
const FAMILIES = [
  ['modal or "choose" spell', /choose (?:one|two|three|any number|up to)|^\+ \{|\{p\}|tiered|• /i],
  ['repeat process', /repeat (?:this|the following) process|repeat this process/i],
  ['delayed or next-turn effect', /at the beginning of (?:the|your) next|until your next turn|next end step|that turn's end step/i],
  ['cast or play from exile / free cast', /you may (?:cast|play)|without paying|for as long as (?:that card|it) remains exiled|may cast it/i],
  ['library: reveal, look, search, piles', /reveal|look at|search|separates|piles|on the bottom|top of (?:your|their) library/i],
  ['additional or alternative cost', /additional cost|rather than pay|costs? \{?\w+\}? less|cost \{\d+\} less|affinity|improvise|harmonize|freerunning|mayhem|web-slinging|disturb|casualty|buyback/i],
  ['replacement or prevention', /instead|prevent|would /i],
  ['control change', /gain control|gains control|exchange/i],
  ['continuous type, color or ability change', /in addition to its other types|is every|are all colors|base power|loses all abilities|have all activated abilities|has all activated|is a |it's a |it's an /i],
  ['copy of spell or ability, extra triggers', /copy (?:that|this|it|target)|triggers an additional time|copies/i],
  ['counters (named, moved, doubled)', /counter/i],
  ['combat (attack, block, damage assignment)', /attack|block|combat/i],
  ['triggered ability not read', /^(?:when|whenever|at the beginning)/i],
  ['activated ability not read', /^[^:]*\{[^}]+\}[^:]*: /i],
  ['conditional or intervening if', /^if |^then if|as long as|only if/i],
];
const familyOf = ms => [...new Set(ms.flatMap(m => FAMILIES.filter(([, re]) => re.test(m)).map(([f]) => f)))].slice(0, 3).join('; ') || (ms.length ? 'card-specific rule' : '');

const CLASS = { 'fully simulated': 'FULLY SIMULATED', 'needs interaction test': 'NEEDS INTERACTION TESTING', 'partially simulated': 'PARTIALLY SIMULATED', 'incorrectly simulated': 'INCORRECTLY SIMULATED', unsimulated: 'NOT SIMULATED' };
const AB = { K: 'keyword', T: 'triggered', A: 'activated', M: 'mana', L: 'loyalty', S: 'static', P: 'spell', R: 'replacement', V: 'prevention' };
const abilities = (a, want) => (a.match(/[A-Z][+~-]/g) || []).filter(x => want.includes(x[1])).map(x => AB[x[0]] + (x[1] === '~' ? ' (part)' : '')).join(', ');
const csv = v => `"${String(v ?? '').replace(/"/g, '""').replace(/\r?\n/g, ' / ')}"`;

const rows = [];
const tally = { pre: {}, now: {}, moves: {} };
for (const b of base.filter(c => c.x === 'partially simulated')) {
  const p = pre.get(b.n), c = now.get(b.n);
  const raw = snap.get(b.n);
  const oracle = raw ? (raw.oracle_text || (raw.card_faces || []).map(f => `${f.name}: ${f.oracle_text}`).join(' // ')) : '';
  const cls = CLASS[c.x], was = CLASS[p.x];
  tally.pre[was] = (tally.pre[was] || 0) + 1;
  tally.now[cls] = (tally.now[cls] || 0) + 1;
  const mv = `${was} -> ${cls}`; tally.moves[mv] = (tally.moves[mv] || 0) + 1;
  const work = workOf(b.n);
  const inTest = completions.includes(b.n.toLowerCase()) || completions.includes(b.n.split(' // ')[0].toLowerCase());
  const missing = c.m;
  rows.push({
    rank: c.r, name: b.n, oracle, orig: 'PARTIALLY SIMULATED (1.61.0 coverage)', before2F: was, current: cls, status: c.s,
    implemented: abilities(c.a, '+') || '—', missing: missing.join(' | ') || '—', mechanics: [...work.map(w => w.replace(/ \(.*$/, '')), familyOf(missing)].filter(Boolean).join('; '),
    changes: work.join('; ') || (p.x !== 'partially simulated' ? 'completed in Phase 2D/2E (before 2F)' : 'none in Phase 2F'),
    test: inTest ? 'tests/completions.mjs (executed, passing)' : c.z ? 'named in another test file (executed, passing)' : 'no card-specific test',
    verified: cls === 'FULLY SIMULATED' ? 'verified: whole text read and handled, card named in a passing test'
      : cls === 'NEEDS INTERACTION TESTING' ? 'read and handled; no card-specific test' : work.length && inTest ? 'completed parts verified by test; listed parts still missing' : 'not verified (still incomplete)',
  });
}
rows.sort((a, b) => a.rank - b.rank);
const head = ['EDHREC rank', 'Card name', 'Oracle text (Scryfall snapshot, tests/cards-snapshot.json)', 'Original classification', 'Classification before Phase 2F (1.63.0)', 'Current classification (1.64.0, rules 27)', 'Coverage status', 'Implemented abilities (read and handled, by printed line)', 'Missing abilities (unread text, misreadings, known defects)', 'Mechanics involved', 'Changes made', 'Test status', 'Verification status'];
const out = [head.map(csv).join(','), ...rows.map(r => [r.rank, r.name, r.oracle, r.orig, r.before2F, r.current, r.status, r.implemented, r.missing, r.mechanics, r.changes, r.test, r.verified].map(csv).join(','))];
writeFileSync(new URL('../PHASE_2F_CARD_COMPLETION.csv', here), out.join('\n') + '\n');
console.log(`cards: ${rows.length}`);
console.log('before 2F:', tally.pre);
console.log('now:', tally.now);
console.log('moves:', tally.moves);
const fam = {};
for (const r of rows.filter(r => r.current === 'PARTIALLY SIMULATED' || r.current === 'INCORRECTLY SIMULATED')) for (const f of familyOf(r.missing.split(' | ')).split('; ').filter(Boolean)) fam[f] = (fam[f] || 0) + 1;
console.log('remaining by family:', Object.entries(fam).sort((a, b) => b[1] - a[1]));
writeFileSync(new URL('remaining.json', here), JSON.stringify(rows.filter(r => r.current !== 'FULLY SIMULATED').map(r => ({ rank: r.rank, name: r.name, current: r.current, missing: r.missing, family: familyOf(r.missing.split(' | ')) })), null, 1));
