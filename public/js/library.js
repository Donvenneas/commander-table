// Deck library: decklists saved as text files in the game folder's data\decks (through the local server),
// so they travel with the folder to another PC.
// Folders, tags, notes, colors and bracket (item 148) are kept in the list's own "About" section ("Folder Casual",
// "Tags tokens, budget", …), which deck loaders skip, so they travel with the file too. Every save also keeps the
// earlier list as a version in the browser profile (the last 10 per deck), to compare and restore.
import { store } from './util.js';
import { parseText } from './decks.js';

const H = { 'X-Commander-Table': 'library' };
const VERSIONS = 'ct.libVersions';

export async function listDecks() {
  const r = await fetch('/api/library');
  if (!r.ok) throw new Error(r.status === 404 ? 'Restart Commander Table to use the deck library' : `The library answered ${r.status}`);
  return (await r.json()).sort((a, b) => a.name.localeCompare(b.name));
}

export async function saveDeck(name, text, { previous = undefined } = {}) {
  // (the list it replaces becomes a version)
  if (previous === undefined) previous = (await listDecks().catch(() => [])).find(d => d.name === name)?.text ?? null;
  const r = await fetch(`/api/library?name=${encodeURIComponent(name)}`, { method: 'POST', headers: H, body: text });
  if (!r.ok) throw new Error(await r.text());
  const saved = (await r.json()).name;
  if (previous != null && previous !== text) addVersion(saved, previous);
  return saved;
}

export async function deleteDeck(name) {
  const r = await fetch(`/api/library?name=${encodeURIComponent(name)}`, { method: 'DELETE', headers: H });
  if (!r.ok) throw new Error(await r.text());
}

// ---------- the About section: Name, Folder, Tags, Colors, Bracket, Notes
const META = ['Folder', 'Tags', 'Colors', 'Bracket', 'Notes'];
export function deckMeta(text) {
  const meta = { folder: '', tags: [], colors: '', bracket: null, notes: '' };
  let about = false;
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (/^about$/i.test(line)) { about = true; continue; }
    if (!about) continue;
    if (!line || /^(deck|commander|sideboard|companion|main)/i.test(line)) break;
    const m = line.match(/^(folder|tags|colors|bracket|notes)\s+(.*)$/i);
    if (!m) continue;
    const k = m[1].toLowerCase(), v = m[2].trim();
    if (k === 'tags') meta.tags = v.split(',').map(t => t.trim()).filter(Boolean);
    else if (k === 'bracket') meta.bracket = +v >= 1 && +v <= 5 ? +v : null;
    else meta[k] = v;
  }
  return meta;
}
// The list with its About section rewritten (the deck's name kept)
export function withMeta(text, meta) {
  const lines = String(text).split(/\r?\n/);
  let name = null, start = -1, end = -1;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (start < 0 && /^about$/i.test(t)) { start = i; continue; }
    if (start >= 0 && end < 0) {
      if (!t) { end = i; continue; }
      const m = t.match(/^name\s+(.+)$/i);
      if (m) name = m[1];
      else if (!new RegExp(`^(${META.join('|')})\\s`, 'i').test(t)) { end = i; }
    }
  }
  const rest = start < 0 ? lines : [...lines.slice(0, start), ...lines.slice(end < 0 ? lines.length : end)];
  const clean = s => String(s || '').replace(/[\r\n]+/g, ' / ').trim();
  const about = ['About', ...(name ? [`Name ${name}`] : []),
    ...(meta.folder ? [`Folder ${clean(meta.folder)}`] : []), ...(meta.tags?.length ? [`Tags ${meta.tags.map(clean).join(', ')}`] : []),
    ...(meta.colors ? [`Colors ${clean(meta.colors)}`] : []), ...(meta.bracket ? [`Bracket ${meta.bracket}`] : []),
    ...(meta.notes ? [`Notes ${clean(meta.notes)}`] : [])];
  const body = rest.join('\n').replace(/^\s+/, '');
  return about.length > 1 ? `${about.join('\n')}\n\n${body}` : body;
}
// The commander names in a list (for search)
export const commandersOf = text => parseText(text).entries.filter(e => e.commander).map(e => e.name);

// ---------- versions
export function versions(name) { return (store(VERSIONS) || {})[name] || []; }
function addVersion(name, text) {
  const all = store(VERSIONS) || {};
  (all[name] ||= []).unshift({ at: Date.now(), text });
  all[name] = all[name].slice(0, 10);
  try { store(VERSIONS, all); } catch { /* full: keep going without */ }
}
// Card changes from one list to another: [{ name, from, to }] (main deck, commander and sideboard counted together)
export function diffLists(a, b) {
  const count = text => { const m = new Map(); for (const e of parseText(text).entries) m.set(e.name, (m.get(e.name) || 0) + e.qty); return m; };
  const A = count(a), B = count(b);
  return [...new Set([...A.keys(), ...B.keys()])].map(name => ({ name, from: A.get(name) || 0, to: B.get(name) || 0 }))
    .filter(x => x.from !== x.to).sort((x, y) => x.name.localeCompare(y.name));
}
