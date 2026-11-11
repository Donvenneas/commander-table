// Help, What's new, Storage and card images windows (split out of main.js, Round 5 item 176)
import { esc, store } from './util.js';
import { prefs } from './prefs.js';
import { loadDeck } from './decks.js';
import { listDecks, commandersOf } from './library.js';
import { bulkInfo, printsInfo } from './bulk.js';

const $ = id => /** @type {HTMLElement} */ (document.getElementById(id));

// ---------- Help window (item 184): data/help.json (tools/help.mjs builds it from README.md), searchable
let help = null;
// (README's own Markdown: bold, code, links, lists and tables, enough for the manual)
function mdToHtml(md) {
  const inline = s => esc(s).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  const out = [];
  let list = null, table = null;
  const flush = () => { if (list) { out.push(`<ul>${list.join('')}</ul>`); list = null; } if (table) { out.push(`<table class="help-table">${table.join('')}</table>`); table = null; } };
  for (const raw of md.split('\n')) {
    const line = raw.replace(/\s+$/, '');
    const li = line.match(/^(\s*)[-*] (.+)$/);
    if (/^\|/.test(line)) { if (list) flush(); if (/^\|[\s|:-]+\|$/.test(line)) continue; (table ||= []).push(`<tr>${line.split('|').slice(1, -1).map(c => `<td>${inline(c.trim())}</td>`).join('')}</tr>`); continue; }
    if (li) { if (table) flush(); (list ||= []).push(`<li${li[1].length ? ' class="sub"' : ''}>${inline(li[2])}</li>`); continue; }
    flush();
    if (/^```/.test(line)) continue;
    if (line.trim()) out.push(`<p>${inline(line)}</p>`);
  }
  flush();
  return out.join('');
}
function renderHelp(focus = null) {
  const q = $('helpSearch').value.trim().toLowerCase();
  const words = q.split(/\s+/).filter(Boolean);
  const hits = help.sections.map((s, i) => ({ s, i, score: words.length ? words.reduce((a, w) => a + (s.title.toLowerCase().includes(w) ? 5 : 0) + (s.text.toLowerCase().split(w).length - 1), 0) : 1 }))
    .filter(x => !words.length || words.every(w => `${x.s.title} ${x.s.text}`.toLowerCase().includes(w)));
  if (words.length) hits.sort((a, b) => b.score - a.score);
  $('helpToc').innerHTML = hits.map(x => `<button class="help-link ${x.s.parent ? 'sub' : ''}" data-h="${x.i}">${esc(x.s.title)}</button>`).join('') || '<p class="muted">Nothing found.</p>';
  const show = focus ?? hits[0]?.i;
  if (show == null) { $('helpBody').innerHTML = ''; return; }
  const s = help.sections[show];
  let html = mdToHtml(s.text);
  // (search words are highlighted in the text, not inside tags)
  if (words.length) html = html.split(/(<[^>]*>)/).map(p => (p.startsWith('<') ? p : words.reduce((t, w) => t.replace(new RegExp(`(${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'), '<mark>$1</mark>'), p))).join('');
  $('helpBody').innerHTML = `<h3>${s.parent ? `<span class="muted">${esc(s.parent)} › </span>` : ''}${esc(s.title)}</h3>${html}`;
  $('helpToc').querySelectorAll('.help-link').forEach(b => b.classList.toggle('active', +(/** @type {HTMLElement} */ (b)).dataset.h === show));
  $('helpBody').scrollTop = 0;
}
export async function openHelp() {
  try { help ||= await (await fetch('data/help.json', { cache: 'no-store' })).json(); } catch { return; }
  $('helpModal').hidden = false;
  renderHelp();
  setTimeout(() => $('helpSearch').focus(), 0);
}
$('btnHelpClose').addEventListener('click', () => { $('helpModal').hidden = true; });
$('helpSearch').addEventListener('input', () => renderHelp());
$('helpToc').addEventListener('click', e => { const b = e.target.closest('[data-h]'); if (b) renderHelp(+b.dataset.h); });
// ---------- What's new (item 182): data/whatsnew.json (tools/whatsnew.mjs builds it from ROADMAP.md at release), shown
// once after an update; Updates has a button for it too
let whatsNew = null;
function renderWhatsNew() {
  const q = $('whatsNewSearch').value.trim().toLowerCase();
  const items = whatsNew.items.filter(i => !q || `${i.title} ${i.done} ${i.section}`.toLowerCase().includes(q));
  const sections = [...new Set(items.map(i => i.section))];
  $('whatsNewBody').innerHTML = sections.map(s => `<h3>${esc(s || 'Other')}</h3><ul class="whatsnew">${items.filter(i => i.section === s).map(i => `<li><b>${esc(i.title)}</b>${i.done ? `<details><summary class="muted">How it works</summary><p class="muted">${esc(i.done)}</p></details>` : ''}</li>`).join('')}</ul>`).join('') || '<p class="muted">Nothing matches.</p>';
}
async function showWhatsNew(auto = false) {
  try { whatsNew ||= await (await fetch('data/whatsnew.json', { cache: 'no-store' })).json(); } catch { return; }
  if (!whatsNew?.items?.length) return;
  if (auto) {
    // (the first start only remembers the version; an update since the last start shows the window)
    const seen = prefs.seenVersion;
    prefs.seenVersion = whatsNew.version; store('ct.prefs', prefs);
    if (!seen || seen === whatsNew.version) return;
  }
  $('whatsNewTitle').textContent = `What's new in ${whatsNew.version}`;
  $('whatsNewIntro').textContent = `${whatsNew.round}: ${whatsNew.items.length} improvements. The full list with every detail is in ROADMAP.md in the game folder.`;
  renderWhatsNew();
  $('whatsNewModal').hidden = false;
}
$('btnWhatsNew').addEventListener('click', () => showWhatsNew());
$('btnWhatsNewClose').addEventListener('click', () => { $('whatsNewModal').hidden = true; });
$('whatsNewSearch').addEventListener('input', renderWhatsNew);
setTimeout(() => showWhatsNew(true), 1500);
// ---------- Storage (item 179): how much each feature keeps in the browser profile, with clean-up buttons
const STORAGE_GROUPS = [
  { label: 'Card data caches (fetched again when needed)', keys: ['ct.otags2', 'ct.precons', 'ct.preconList', 'ct.rulings', 'ct.cedh', 'ct.sets', 'ct.i18nCards2', 'ct.cardsStaleBefore', 'ct.metaTrend'], cache: true },
  { label: 'Unfinished game (Resume)', keys: ['ct.autosave'], cache: true },
  { label: 'Deck library versions', keys: ['ct.libVersions'] },
  { label: 'Deck learning and mastery', keys: ['ct.learn'] },
  { label: 'Learned threat (who is about to win)', keys: ['ct.threat'] },
  { label: 'How the people you play with play', keys: ['ct.people'] },
  { label: 'Progress (ladder, challenges, badges, rivals, gauntlet, puzzle of the day)', keys: ['ct.ladder', 'ct.challenges', 'ct.badges', 'ct.rivals', 'ct.gauntlet', 'ct.daily'] },
  { label: 'Game history', keys: ['ct.history'] },
  { label: 'Modes in progress (expedition, story, lessons, tournaments)', keys: ['ct.expedition', 'ct.expeditionStats', 'ct.story', 'ct.tutorial', 'ct.cup', 'ct.cupDraft', 'ct.tourney', 'ct.cubes'] },
  { label: 'Your collection', keys: ['ct.collection'] },
];
const DBS = [{ label: 'Card file (Updates › Card file)', name: 'ct-bulk' }, { label: 'Printings file', name: 'ct-prints' }];
const kb = n => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
export async function showStorage() {
  const size = k => { try { const v = localStorage.getItem(k); return v ? (v.length + k.length) * 2 : 0; } catch { return 0; } };
  let total = 0;
  try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k?.startsWith('ct.')) total += size(k); } } catch { /* blocked */ }
  const rows = STORAGE_GROUPS.map((g, i) => ({ g, i, n: g.keys.reduce((a, k) => a + size(k), 0) })).filter(r => r.n > 0);
  const est = await navigator.storage?.estimate?.().catch(() => null);
  $('storageBody').innerHTML = `<table class="storage"><tbody>${rows.map(r => `<tr><td>${esc(r.g.label)}</td><td class="num">${kb(r.n)}</td><td><button class="btn small ghost" data-clear="${r.i}">Clear</button></td></tr>`).join('')}
    ${DBS.map(d => `<tr><td>${esc(d.label)}</td><td class="num">${esc((d.name === 'ct-bulk' ? bulkInfo() : printsInfo())?.count ? 'saved' : '–')}</td><td></td></tr>`).join('')}</tbody></table>
    <p class="muted">Small saved data: ${kb(total)} of the browser's roughly 5 MB for it.${est ? ` Everything this game's pages keep (with the card files and images the browser holds): ${kb(est.usage || 0)}.` : ''}</p>`;
}
$('storageBody').addEventListener('click', e => {
  const b = e.target.closest('[data-clear]');
  if (!b) return;
  const g = STORAGE_GROUPS[+b.dataset.clear];
  if (!g.cache && !confirm(`Clear "${g.label}"? This can't be undone.`)) return;
  for (const k of g.keys) store(k, null);
  try { for (const k of g.keys) localStorage.removeItem(k); } catch { /* blocked */ }
  showStorage();
});
// ---------- card images (item 158): the image folder's size and cap, and downloading every image a library deck uses
export async function showImages(msg = '') {
  try {
    const r = await (await fetch('/api/imgcache')).json();
    $('imgBody').textContent = `${r.files.toLocaleString()} images, ${(r.bytes / 1048576).toFixed(0)} MB of ${r.capMB >= 1000 ? `${(r.capMB / 1000).toFixed(1)} GB` : `${r.capMB} MB`}.${msg ? ` ${msg}` : ''}`;
    $('imgCap').value = String(r.capMB);
    if (!$('imgCap').value) $('imgCap').insertAdjacentHTML('beforeend', `<option value="${r.capMB}" selected>${r.capMB} MB</option>`);
  } catch { $('imgBody').textContent = 'Restart Commander Table to see the image folder here.'; }
}
$('imgCap').addEventListener('change', async e => {
  await fetch('/api/imgcache', { method: 'POST', headers: { 'X-Commander-Table': 'images' }, body: /** @type {HTMLSelectElement} */ (e.target).value }).catch(() => {});
  showImages('Cap changed.');
});
let imgStop = false;
$('btnImgStop').addEventListener('click', () => { imgStop = true; });
$('btnImgLibrary').addEventListener('click', async () => {
  const btn = $('btnImgLibrary');
  btn.disabled = true; $('btnImgStop').hidden = false; imgStop = false;
  const say = t => { $('imgBody').textContent = t; };
  try {
    const decks = await listDecks();
    const urls = new Set();
    for (const [i, d] of decks.entries()) {
      if (imgStop) break;
      say(`Reading deck ${i + 1} of ${decks.length}: ${d.name}…`);
      try {
        const deck = await loadDeck(d.text, () => {}, { format: commandersOf(d.text).length ? 'commander' : prefs.format || 'commander' });
        for (const c of [...deck.commanders, ...deck.cards.map(x => x.card), ...(deck.sideboard || []).map(x => x.card)]) for (const u of [c.imgSmall, c.imgNormal, c.art, c.backNormal]) if (u && u.startsWith('/api/img?')) urls.add(u);
      } catch { /* a deck that doesn't load is skipped */ }
    }
    const list = [...urls];
    let done = 0, failed = 0;
    const worker = async () => {
      while (list.length && !imgStop) {
        const u = list.shift();
        try { const r = await fetch(u); if (!r.ok) failed++; await r.arrayBuffer(); } catch { failed++; }
        done++;
        if (done % 10 === 0) say(`Downloading images… ${done} of ${urls.size}`);
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    showImages(imgStop ? `Stopped after ${done} of ${urls.size}.` : `Done: ${done} images for ${decks.length} deck${decks.length === 1 ? '' : 's'}${failed ? ` (${failed} failed)` : ''}.`);
  } catch (err) { say(`Couldn't download: ${err.message}`); }
  btn.disabled = false; $('btnImgStop').hidden = true;
});

