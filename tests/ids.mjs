// Element id guard (design roadmap item 378).
//
// The pages find their elements by id: $('btnPlay'), document.getElementById('log'), querySelector('#setup …').
// A renamed or removed id fails silently until someone clicks the thing. This script reads the pages and the
// scripts as text and fails when:
//   1. an id is used twice in one page,
//   2. a script asks for an id that no page has and no script creates.
//
// Ids a script creates count as present: id="…" inside a template or string, and `.id = '…'`.
// Run: node tests/ids.mjs
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const read = p => readFileSync(p, 'utf8');
const pages = readdirSync(root).filter(f => f.endsWith('.html'));
const scripts = readdirSync(join(root, 'js')).filter(f => f.endsWith('.js'));

let failed = 0;
const fail = msg => { failed++; console.log(`  FAIL ${msg}`); };

// 1. ids in the pages
const known = new Set();
for (const page of pages) {
  const seen = new Map();
  for (const m of read(join(root, page)).matchAll(/\sid="([^"${}]+)"/g)) seen.set(m[1], (seen.get(m[1]) || 0) + 1);
  for (const [id, n] of seen) { known.add(id); if (n > 1) fail(`${page}: id "${id}" is used ${n} times`); }
}

// ids the scripts create (a name ending in a template part, like id="seat${i}", is kept as a prefix)
const made = new Set(), prefixes = new Set();
const sources = scripts.map(f => [f, read(join(root, 'js', f))]);
for (const [, src] of sources) {
  for (const m of src.matchAll(/\bid=\\?["']?([\w-]+)(\$\{)?/g)) (m[2] ? prefixes : made).add(m[1]);
  for (const m of src.matchAll(/\.id\s*=\s*(['"`])([\w-]+)(\$\{)?/g)) (m[3] ? prefixes : made).add(m[2]);
  for (const m of src.matchAll(/setAttribute\(\s*['"]id['"]\s*,\s*['"]([\w-]+)['"]/g)) made.add(m[1]);
}
const exists = id => known.has(id) || made.has(id) || [...prefixes].some(p => id.startsWith(p));

// 2. ids the scripts ask for
let asked = 0;
for (const [file, src] of sources) {
  const want = new Map();
  const note = (id, at) => { if (!want.has(id)) want.set(id, src.slice(0, at).split('\n').length); };
  for (const m of src.matchAll(/(?<![\w.])\$\(\s*(['"])([\w-]+)\1\s*\)/g)) note(m[2], m.index);
  for (const m of src.matchAll(/getElementById\(\s*(['"])([\w-]+)\1\s*\)/g)) note(m[2], m.index);
  for (const m of src.matchAll(/querySelector(?:All)?\(\s*(['"])#([A-Za-z][\w-]*)/g)) note(m[2], m.index);
  for (const [id, line] of want) { asked++; if (!exists(id)) fail(`${file}:${line}: asks for id "${id}", which no page has and no script creates`); }
}

console.log(`${known.size} ids in ${pages.length} pages, ${made.size} made by scripts, ${asked} lookups checked.`);
if (failed) { console.log(`${failed} problem${failed === 1 ? '' : 's'}.`); process.exit(1); }
console.log('Element ids: all present, none repeated.');
