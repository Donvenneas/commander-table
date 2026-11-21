// (item 389) The card coverage page (coverage.html): every card the audit read (tests/coverage.mjs --json), with its
// simulation class, what it's missing, and filters by class, type, color, keyword, ability type and rarity.
import { esc } from './util.js';
import { prefs } from './prefs.js';

const $ = (/** @type {string} */ id) => /** @type {any} */ (document.getElementById(id));
const CLASS_KEY = { 'fully simulated': 'k-full', 'needs interaction test': 'k-test', 'partially simulated': 'k-part', 'incorrectly simulated': 'k-bad', unsimulated: 'k-none' };
const CLASS_HELP = {
  'fully simulated': 'every line read and handled, and checked by a test',
  'needs interaction test': 'every line read and handled; no test names it yet',
  'partially simulated': 'some of its text does nothing',
  'incorrectly simulated': 'read as something else, or plays stronger than printed',
  unsimulated: 'none of its abilities is read',
};
const TYPES = ['Creature', 'Instant', 'Sorcery', 'Artifact', 'Enchantment', 'Planeswalker', 'Land', 'Battle', 'Legendary'];
const RARITY = { c: 'Common', u: 'Uncommon', r: 'Rare', m: 'Mythic', s: 'Special', b: 'Bonus' };
const PAGE = 100;

/** @type {any} */ let data = null;
let page = 0, pickedClass = '';

const opt = (/** @type {string} */ v, /** @type {string} */ label) => `<option value="${esc(v)}">${esc(label)}</option>`;

function setup() {
  const cards = data.cards, n = cards.length;
  const counts = Object.fromEntries(data.classes.map((/** @type {string} */ c) => [c, cards.filter((/** @type {any} */ x) => x.x === c).length]));
  const ab = Object.values(data.abilityTypes).reduce((/** @type {any} */ s, /** @type {any} */ t) => ({ lines: s.lines + t.lines, read: s.read + t.read }), { lines: 0, read: 0 });
  const tile = (/** @type {string} */ key, /** @type {string} */ big, /** @type {string} */ label, /** @type {string} */ cls = '') => `<button class="tile" data-class="${esc(key)}" aria-pressed="false">${cls ? `<i class="dot ${cls}"></i>` : ''}<b>${big}</b><span>${label}</span></button>`;
  $('cvTiles').innerHTML = [
    tile('', String(n), 'cards audited'),
    ...data.classes.map((/** @type {string} */ c) => tile(c, String(counts[c]), `${(100 * counts[c] / n).toFixed(1)}% ${c}: ${CLASS_HELP[c]}`, CLASS_KEY[c])),
    `<div class="tile"><b>${(100 * (counts['fully simulated'] + counts['needs interaction test']) / n).toFixed(1)}%</b><span>whole text read and handled (fully simulated + needs a test)</span></div>`,
    `<div class="tile"><b>${(100 * ab.read / ab.lines).toFixed(1)}%</b><span>of ${ab.lines} printed ability lines read</span></div>`,
    `<div class="tile"><b>${data.mechanics.length}</b><span>effect kinds the engine plays on these cards</span></div>`,
  ].join('');
  $('cvBar').innerHTML = data.classes.map((/** @type {string} */ c) => `<i class="${CLASS_KEY[c]}" style="flex:${counts[c]}" title="${esc(c)}: ${counts[c]}"></i>`).join('');
  $('cvClass').innerHTML = opt('', 'Every class') + data.classes.map((/** @type {string} */ c) => opt(c, `${c} (${counts[c]})`)).join('');
  $('cvType').innerHTML = opt('', 'Every type') + TYPES.map(t => opt(t, t)).join('');
  const kws = new Map();
  for (const c of cards) for (const k of c.k) kws.set(k, (kws.get(k) || 0) + 1);
  $('cvKeyword').innerHTML = opt('', 'Any') + [...kws].filter(([, v]) => v >= 2).sort((a, b) => b[1] - a[1]).map(([k, v]) => opt(k, `${k} (${v})`)).join('')
    + data.mechanics.map((/** @type {string} */ m) => opt(`fx:${m}`, `effect: ${m}`)).join('');
  $('cvAbility').innerHTML = opt('', 'Any') + Object.entries(data.abilityTypes).map(([k, t]) => opt(k, `${/** @type {any} */ (t).name}`)).join('');
  $('cvRarity').innerHTML = opt('', 'Any') + Object.entries(RARITY).map(([k, v]) => opt(k, v)).join('');
  $('cvColors').innerHTML = [...'WUBRG', 'C'].map(c => `<label><input type="checkbox" value="${c}"> ${c}</label>`).join('');
  for (const id of ['cvSearch', 'cvClass', 'cvType', 'cvKeyword', 'cvAbility', 'cvRarity', 'cvSort']) $(id).addEventListener('input', () => { page = 0; render(); });
  $('cvColors').addEventListener('change', () => { page = 0; render(); });
  $('cvTiles').addEventListener('click', (/** @type {any} */ ev) => {
    const t = ev.target.closest('button.tile');
    if (!t) return;
    pickedClass = t.dataset.class;
    $('cvClass').value = pickedClass;
    page = 0; render();
  });
  $('cvPrev').addEventListener('click', () => { page = Math.max(0, page - 1); render(); });
  $('cvNext').addEventListener('click', () => { page++; render(); });
}

function filtered() {
  const q = $('cvSearch').value.trim().toLowerCase(), cls = $('cvClass').value, type = $('cvType').value, kw = $('cvKeyword').value;
  const abil = $('cvAbility').value, rar = $('cvRarity').value;
  const cols = [...$('cvColors').querySelectorAll('input:checked')].map(i => i.value);
  const out = data.cards.filter((/** @type {any} */ c) => (!cls || c.x === cls) && (!type || c.t.includes(type)) && (!rar || c.y === rar)
    && (!kw || (kw.startsWith('fx:') ? c.e.includes(kw.slice(3)) : c.k.includes(kw)))
    && (!abil || c.a.includes(abil + '-') || c.a.includes(abil + '~'))
    && (!cols.length || cols.every(x => (x === 'C' ? !c.c : c.c.includes(x))))
    && (!q || c.n.toLowerCase().includes(q) || c.m.some((/** @type {string} */ m) => m.toLowerCase().includes(q))));
  const sort = $('cvSort').value;
  if (sort === 'name') out.sort((/** @type {any} */ a, /** @type {any} */ b) => a.n.localeCompare(b.n));
  else if (sort === 'cmc') out.sort((/** @type {any} */ a, /** @type {any} */ b) => a.v - b.v || a.r - b.r);
  return out;
}

function render() {
  const rows = filtered(), pages = Math.max(1, Math.ceil(rows.length / PAGE));
  page = Math.min(page, pages - 1);
  for (const t of document.querySelectorAll('#cvTiles button.tile')) t.setAttribute('aria-pressed', String(/** @type {any} */ (t).dataset.class === $('cvClass').value && !!$('cvClass').value));
  $('cvCount').textContent = `${rows.length} of ${data.cards.length} cards`;
  const abHtml = (/** @type {string} */ a) => (a.match(/../g) || []).map(p => `<span class="${p[1] === '+' ? 'ok' : p[1] === '~' ? 'half' : 'no'}">${p[0]}${p[1] === '-' ? '−' : p[1]}</span>`).join(' ');
  $('cvRows').innerHTML = rows.slice(page * PAGE, (page + 1) * PAGE).map((/** @type {any} */ c) => `<tr>
    <td class="num">${c.r}</td>
    <td>${esc(c.n)}${c.z ? ' <span class="muted" title="named in a test">✓ test</span>' : ''}</td>
    <td class="hide-sm">${esc(c.t)}</td>
    <td><i class="dot ${CLASS_KEY[c.x]}"></i>${esc(c.x)}</td>
    <td class="ab hide-sm">${abHtml(c.a)}</td>
    <td class="miss">${c.m.length ? c.m.map((/** @type {string} */ m) => esc(m)).join('<br>') : '—'}</td></tr>`).join('');
  $('cvPage').textContent = `Page ${page + 1} of ${pages}`;
  $('cvPrev').disabled = page === 0;
  $('cvNext').disabled = page >= pages - 1;
}

// (the game's own light or dark theme)
if (prefs.theme === 'light' || prefs.theme === 'dark') document.documentElement.dataset.theme = prefs.theme;
fetch('data/coverage.json', { cache: 'no-store' }).then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))).then(j => { data = j; setup(); render(); })
  .catch(e => { $('cvCount').textContent = `The coverage data could not be loaded (${e.message}). Run node tests/coverage.mjs --json public/data/coverage.json.`; });
