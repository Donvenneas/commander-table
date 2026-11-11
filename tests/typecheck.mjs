// Type check with a ratchet: runs the TypeScript compiler over public/js (jsconfig.json, JavaScript only,
// nothing is built) and fails only on errors that aren't in tests/typecheck-baseline.txt. The baseline holds
// the known findings from before the check existed (mostly properties added to objects after they're made,
// a normal pattern in this code); it may only shrink. Line numbers are left out so edits elsewhere in a
// file don't count as new errors.
//
//   node tests/typecheck.mjs            check (CI runs this)
//   node tests/typecheck.mjs --update   rewrite the baseline after fixing errors (never to hide a new one)
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const BASELINE = new URL('./typecheck-baseline.txt', import.meta.url);
let out = '';
try {
  out = execSync('npx -y -p typescript@5.6.3 tsc -p jsconfig.json --pretty false', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], shell: true });
} catch (e) {
  out = (e.stdout || '') + (e.stderr || '');
}
const errors = out.split(/\r?\n/).map(l => l.match(/^(.+?)\(\d+,\d+\): error (TS\d+): (.*)$/)).filter(Boolean);
if (!errors.length && /error/i.test(out)) { console.error(out); process.exit(2); }
const key = m => `${m[1].replace(/\\/g, '/')} ${m[2]} ${m[3]}`;
const found = errors.map(key).sort();

if (process.argv.includes('--update')) {
  writeFileSync(BASELINE, found.join('\n') + '\n');
  console.log(`Baseline written: ${found.length} known findings.`);
  process.exit(0);
}

// Compare as multisets: each baseline line excuses one finding
const known = new Map();
for (const l of existsSync(BASELINE) ? readFileSync(BASELINE, 'utf8').split(/\r?\n/).filter(Boolean) : []) known.set(l, (known.get(l) || 0) + 1);
const fresh = [];
for (const m of errors) {
  const k = key(m);
  if (known.get(k)) known.set(k, known.get(k) - 1);
  else fresh.push(m[0]);
}
const fixed = [...known.values()].reduce((a, b) => a + b, 0);
console.log(`Type check: ${errors.length} findings, ${errors.length - fresh.length} known, ${fresh.length} new${fixed ? `, ${fixed} known ones gone (run with --update to shrink the baseline)` : ''}.`);
for (const l of fresh) console.log(`::error::${l}`);

// Strict null checks for the rules engine and the card reader (item 175): these two files must have no finding at all
// with --strictNullChecks (the other files are checked without it).
const STRICT = ['public/js/engine.js', 'public/js/effects.js'];
let strictOut = '';
try {
  strictOut = execSync('npx -y -p typescript@5.6.3 tsc -p jsconfig.json --pretty false --strictNullChecks', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], shell: true });
} catch (e) {
  strictOut = (e.stdout || '') + (e.stderr || '');
}
const strict = strictOut.split(/\r?\n/).filter(l => /error TS\d+/.test(l) && STRICT.some(f => l.replace(/\\/g, '/').startsWith(f)));
console.log(`Strict null checks (${STRICT.map(f => f.split('/').pop()).join(', ')}): ${strict.length} finding${strict.length === 1 ? '' : 's'}.`);
for (const l of strict) console.log(`::error::${l}`);
process.exit(fresh.length || strict.length ? 1 : 0);
