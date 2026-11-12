// Builds public/data/whatsnew.json for the "What's new" window (item 182): the newest round in ROADMAP.md, each
// finished item with its title and the first sentence of its "Done:" note, and the VERSION it ships in.
// Run from the game folder: node tools/whatsnew.mjs (make-shareable-zip.ps1 runs it when Node.js is there).
import { readFileSync, writeFileSync } from 'node:fs';

const roadmap = readFileSync('ROADMAP.md', 'utf8').split(/\r?\n/);
const version = readFileSync('VERSION', 'utf8').trim();
const starts = roadmap.map((l, i) => (/^## Round \d+/.test(l) ? i : -1)).filter(i => i >= 0);
const from = starts.at(-1);
const to = roadmap.findIndex((l, i) => i > from && /^## /.test(l));
const block = roadmap.slice(from, to < 0 ? undefined : to);
const round = block[0].replace(/^## /, '').replace(/\s*\(.*$/, '');
const items = [];
let cur = null, section = '';
for (const line of block.slice(1)) {
  const h = line.match(/^### (.+)/);
  if (h) { section = h[1].trim(); continue; }
  const m = line.match(/^- \[(x| )\] (\d+)\. (.*)$/);
  if (m) {
    // (a short item keeps its "Done:" note on the same line)
    const [title, done = ''] = m[3].split(/\s+Done(?: \([^)]*\))?:\s+/);
    cur = m[1] === 'x' ? { n: +m[2], section, title: title.trim(), done, inDone: !!done } : null;
    if (cur) items.push(cur);
    continue;
  }
  if (!cur) continue;
  const t = line.trim();
  if (/^- Done/.test(t)) { cur.done = t.replace(/^- Done[^:]*:\s*/, ''); cur.inDone = true; }
  else if (cur.inDone && t && !t.startsWith('- ')) cur.done += ` ${t}`;
  else if (!cur.inDone && t && !t.startsWith('- ')) cur.title += ` ${t}`;
  else cur.inDone = false;
}
const first = s => (s.match(/^.*?[.!?](?=\s|$)/)?.[0] || s).slice(0, 240);
const out = { version, round, items: items.map(({ n, section, title, done }) => ({ n, section, title: title.replace(/\s+/g, ' '), done: first(done.replace(/\s+/g, ' ')) })) };
writeFileSync('public/data/whatsnew.json', JSON.stringify(out, null, 1) + '\n');
console.log(`whatsnew.json: version ${version}, ${round}, ${out.items.length} items`);
