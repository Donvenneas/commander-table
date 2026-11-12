// Builds public/data/help.json for the in-app Help window (item 184): README.md split into its ## and ### sections,
// each kept as simple Markdown text (the page turns bold, code, links and lists into HTML).
// Run from the game folder: node tools/help.mjs (make-shareable-zip.ps1 runs it when Node.js is there).
import { readFileSync, writeFileSync } from 'node:fs';

const lines = readFileSync('README.md', 'utf8').split(/\r?\n/);
const sections = [];
let cur = null, parent = '';
for (const line of lines) {
  const h = line.match(/^(##|###) (.+)$/);
  if (h) {
    if (h[1] === '##') parent = h[2].trim();
    cur = { title: h[2].trim(), parent: h[1] === '###' ? parent : '', body: [] };
    sections.push(cur);
    continue;
  }
  if (cur) cur.body.push(line);
}
const out = sections.map(s => ({ title: s.title, parent: s.parent, text: s.body.join('\n').trim() })).filter(s => s.text);
writeFileSync('public/data/help.json', JSON.stringify({ sections: out }) + '\n');
console.log(`help.json: ${out.length} sections`);
