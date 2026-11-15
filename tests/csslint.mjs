// Stylesheet lint (design roadmap item 379). No packages: the stylesheet is read as text.
//
// It counts four things the design rules say should go away, and fails when a count is higher than the number
// saved in tests/csslint-baseline.json, so new ones can't slip in while the old ones are being removed:
//   important   `!important` (item 222)
//   zindex      a z-index that is a bare number above 9 instead of a --z-* token
//   colors      a literal color (#hex, rgb(), hsl()) outside a :root block (item 220)
//   unused      a class in the stylesheet that no page and no script mentions
//
// Run: node tests/csslint.mjs            (fails on a count above the baseline; lists what is new with --list)
//      node tests/csslint.mjs --update   (after removing some: save the lower counts)
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pub = join(here, '..', 'public');
const basePath = join(here, 'csslint-baseline.json');
const args = process.argv.slice(2);

const css = readFileSync(join(pub, 'css', 'style.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '));
const lineOf = i => css.slice(0, i).split('\n').length;

// The text of every :root { … } block is where literal colors belong (the tokens)
const tokenSpans = [];
for (const m of css.matchAll(/:root[^{]*\{/g)) {
  let depth = 1, i = m.index + m[0].length;
  while (i < css.length && depth) { if (css[i] === '{') depth++; else if (css[i] === '}') depth--; i++; }
  tokenSpans.push([m.index, i]);
}
const inTokens = i => tokenSpans.some(([a, b]) => i >= a && i < b);

const found = { important: [], zindex: [], colors: [], unused: [] };
for (const m of css.matchAll(/!important/g)) found.important.push(lineOf(m.index));
for (const m of css.matchAll(/z-index\s*:\s*(-?\d+)/g)) if (Math.abs(+m[1]) > 9) found.zindex.push(lineOf(m.index));
for (const m of css.matchAll(/#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\(/g)) if (!inTokens(m.index)) found.colors.push(lineOf(m.index));

// Classes: every .name in a selector, looked for as a whole word in the pages and scripts
const selectors = css.replace(/\{[^{}]*\}/g, '{}');
const classes = new Set([...selectors.matchAll(/\.(-?[A-Za-z_][\w-]*)/g)].map(m => m[1]));
const text = [
  ...readdirSync(pub).filter(f => f.endsWith('.html')).map(f => readFileSync(join(pub, f), 'utf8')),
  ...readdirSync(join(pub, 'js')).filter(f => f.endsWith('.js')).map(f => readFileSync(join(pub, 'js', f), 'utf8')),
].join('\n');
const words = new Set(text.match(/[A-Za-z_][\w-]*/g));
// (a class built from parts, like `tone-${x}` or 'bg-' + name, counts when its prefix is written out)
const prefixes = new Set([...text.matchAll(/([A-Za-z][\w]*-)(?:\$\{|['"`]\s*\+)/g)].map(m => m[1]));
for (const c of [...classes].sort()) if (!words.has(c) && ![...prefixes].some(p => c.startsWith(p))) found.unused.push(c);

const counts = Object.fromEntries(Object.entries(found).map(([k, v]) => [k, v.length]));
if (args.includes('--update') || !existsSync(basePath)) {
  writeFileSync(basePath, JSON.stringify(counts, null, 2) + '\n');
  console.log(`Saved the baseline: ${JSON.stringify(counts)}`);
  process.exit(0);
}
const base = JSON.parse(readFileSync(basePath, 'utf8'));
const NAMES = { important: '!important', zindex: 'bare z-index numbers', colors: 'literal colors outside :root', unused: 'classes nothing mentions' };
let failed = false;
for (const k of Object.keys(NAMES)) {
  const over = counts[k] > (base[k] ?? 0);
  if (over) failed = true;
  console.log(`  ${over ? 'FAIL' : 'ok  '} ${NAMES[k]}: ${counts[k]} (baseline ${base[k] ?? 0})${counts[k] < (base[k] ?? 0) ? '  ← lower now: run with --update' : ''}`);
  if (over || args.includes('--list')) console.log(`       ${k === 'unused' ? found[k].join(', ') : 'lines ' + found[k].join(', ')}`.slice(0, 3000));
}
if (failed) { console.log('Stylesheet lint: a count went up. Use a token, or remove the new one.'); process.exit(1); }
console.log('Stylesheet lint: nothing new.');
