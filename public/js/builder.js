// Deck builder: a full-screen workspace to build a deck from every card on Scryfall. Three panels:
// the search with its card gallery, an inspector that shows the card under the pointer (or the keyboard
// focus) at reading size, and the deck with its commander, charts, checks and list by card type.
// Search with Scryfall's own syntax plus filters (colors, type, mana value, the table format's legality);
// click or drag a card into the deck, and drag it back (or use −) to take it out. Commander formats get
// a ★ to choose the commander; one-on-one formats get a sideboard. On a narrow screen the search and the
// deck are two tabs, and the inspector opens over the page from the magnifier on a card.
import { sf, normalize } from './scryfall.js';
import { formatOf } from './formats.js';
import { esc, symbolize } from './util.js';
import { owned, hasCollection } from './collection.js';
import { almostCombos } from './combos.js';
import { ignoredText } from './effects.js';
import { statTiles, curveChart, pipChart, typeChart, TYPE_NAMES, typeColor, MANA_NAMES } from './deckcharts.js';

const TYPES = ['creature', 'instant', 'sorcery', 'artifact', 'enchantment', 'planeswalker', 'land', 'battle'];
const typeOf = c => TYPES.find(t => new RegExp(`\\b${t}\\b`, 'i').test(c.typeLine)) || 'other';
const isLand = c => /\bland\b/i.test(c.typeLine);
const isBasic = c => /\bbasic\b/i.test(c.typeLine) && isLand(c);
const ptOf = c => (c.power != null ? `${c.power}/${c.toughness}` : c.loyalty ? `Loyalty ${c.loyalty}` : c.defense ? `Defense ${c.defense}` : '');
const cost = c => (c.manaCost ? `<span class="cost">${symbolize(c.manaCost)}</span>` : '');
// A card's face in words: under the picture while it loads, and instead of it when there is none
const face = c => `<div class="cface"><b>${esc(c.name)}</b><small>${esc(c.typeLine)}</small>${cost(c)}${ptOf(c) ? `<span class="pt">${esc(ptOf(c))}</span>` : ''}</div>`;

let el = null;
/** @type {Set<string>} */
let folded = new Set();
function ensure() {
  if (el) return el;
  el = document.createElement('div');
  el.id = 'builderModal';
  el.className = 'modal builder-modal';
  el.hidden = true;
  el.innerHTML = `<div class="modal-card builder-card" role="dialog" aria-modal="true" aria-labelledby="bldTitle">
    <div class="modal-head"><div><h2 id="bldTitle">Deck builder</h2><p class="muted" id="bldIntro"></p></div>
      <div class="bld-actions"><input id="bldName" class="input" maxlength="60" placeholder="Deck name" aria-label="Deck name"><select id="bldSeat" class="input" aria-label="Seat"></select>
        <button class="btn primary" id="bldUse">Put in seat</button><button class="btn" id="bldSave">Save to library</button><button class="btn ghost" id="bldCopy">Copy as text</button><button class="btn ghost" id="bldClose">Close</button></div></div>
    <nav class="tabs bld-tabs" id="bldTabs"><button data-pane="search" class="active">Search</button><button data-pane="deck">Deck <span id="bldTabCount"></span></button></nav>
    <div class="bld-body" id="bldBody" data-pane="search">
      <div class="bld-search">
        <div class="bld-filters" role="search">
          <input id="bldQuery" class="input" placeholder='Search, e.g. "draw a card" or t:goblin pow>=3' spellcheck="false" aria-label="Search cards">
          <span class="bld-colors" role="group" aria-label="Colors">${['W', 'U', 'B', 'R', 'G', 'C'].map(c => `<label title="${MANA_NAMES[c]}" style="--mc:var(--mana-${c.toLowerCase()})"><input type="checkbox" data-color="${c}" aria-label="${MANA_NAMES[c]}">${symbolize(`{${c}}`)}</label>`).join('')}</span>
          <select id="bldType" class="input" aria-label="Card type"><option value="">Any type</option>${TYPES.map(t => `<option value="${t}">${t[0].toUpperCase() + t.slice(1)}</option>`).join('')}</select>
          <select id="bldMv" class="input" aria-label="Mana value"><option value="">Any mana value</option>${[0, 1, 2, 3, 4, 5, 6].map(n => `<option value="${n}">MV ${n}${n === 6 ? '+' : ''}</option>`).join('')}</select>
          <select id="bldSort" class="input" aria-label="Sort"><option value="">Sort: best match</option><option value="name">Sort: name</option><option value="cmc">Sort: mana value</option><option value="released">Sort: newest</option><option value="power">Sort: power</option></select>
          <label class="muted"><input type="checkbox" id="bldLegal" checked> <span id="bldLegalName">Legal only</span></label>
          <label class="muted" title="Only cards whose every line the simulator plays, so the AI plays the deck at full strength"><input type="checkbox" id="bldSim"> Fully simulated only</label>
          <label class="muted" id="bldOwnedWrap" title="Only cards in your collection (Collection… on the setup screen)"><input type="checkbox" id="bldOwned"> Only cards I own</label>
          <button class="btn small primary" id="bldGo">Search</button>
        </div>
        <div id="bldStatus" class="muted" role="status" aria-live="polite"></div>
        <div id="bldResults" class="bld-results" title="Drop a card here to take one copy out of the deck"></div>
        <button class="btn small" id="bldMore" hidden>More results</button>
      </div>
      <aside class="bld-inspect" id="bldInspect" aria-label="Card inspector"></aside>
      <div class="bld-deck" id="bldDeckDrop" title="Drop cards here to add them">
        <div id="bldCmd"></div>
        <div class="bld-stats" id="bldStats"></div>
        <div class="bld-almost"><button class="btn small" id="bldAlmost" title="Commander Spellbook: combos in your colors that need one more card">Combos one card away</button><div id="bldAlmostOut"></div></div>
        <div id="bldList"></div>
      </div>
    </div></div>`;
  document.body.append(el);
  // A picture that fails to load is taken away, and the card's face in words shows instead
  el.addEventListener('error', e => { const t = /** @type {HTMLElement} */ (e.target); if (t instanceof HTMLImageElement && t.closest('.ctile-img, .insp-img')) t.remove(); }, true);
  // A folded section of the deck list stays folded when the list is drawn again ("toggle" doesn't bubble: caught on the way down)
  el.addEventListener('toggle', e => { const d = /** @type {HTMLDetailsElement} */ (e.target); const k = d.dataset?.cat; if (k) { if (d.open) folded.delete(k); else folded.add(k); } }, true);
  return el;
}

// opts: { format, deck (a loaded deck, optional), seats: [names], seatIndex, onUse(text, name, seat), onSave(text, name) }
export function openBuilder(opts) {
  const root = ensure();
  const $ = id => root.querySelector(`#${id}`);
  const f = formatOf(opts.format);
  // name → { card, main, side, cmd }
  const deck = new Map();
  const add = (c, zone = 'main', n = 1) => { const e = deck.get(c.name) || { card: c, main: 0, side: 0, cmd: 0 }; e[zone] += n; deck.set(c.name, e); };
  if (opts.deck) {
    for (const c of opts.deck.commanders || []) add(c, 'cmd');
    for (const { card, qty } of opts.deck.cards) add(card, 'main', qty);
    for (const { card, qty } of opts.deck.sideboard || []) add(card, 'side', qty);
  }
  $('bldName').value = opts.deck?.deckName || '';
  $('bldSeat').innerHTML = opts.seats.map((n, i) => `<option value="${i}" ${i === (opts.seatIndex ?? 0) ? 'selected' : ''}>Seat ${i + 1}: ${esc(n)}</option>`).join('');
  $('bldIntro').textContent = `${f.name}: ${f.exact ? 'exactly' : 'at least'} ${f.deck} cards${f.copies === 1 ? ', one of each' : f.copies < 99 ? `, up to ${f.copies} of each` : ''}${f.commander ? ', with a commander (★)' : ''}${f.sideboard && f.sideboard < 99 ? `, and a ${f.sideboard}-card sideboard` : ''}. Click or drag a card from the results into the deck.`;
  $('bldLegalName').textContent = f.legal ? `Legal in ${f.name} only` : 'Legal only (any format)';

  const total = z => [...deck.values()].reduce((a, e) => a + e[z], 0);
  // (your collection, item 147: owned cards are marked, and the search can show only those)
  const coll = hasCollection();
  $('bldOwnedWrap').hidden = !coll;
  if (!coll) $('bldOwned').checked = false;
  // Which type sections of the list are folded shut (kept while the builder is open)
  folded = new Set();
  let flash = '';

  // ---------- the inspector: the card under the pointer or the keyboard focus, at reading size
  let shown = null;
  function inspect(c, open = false) {
    const box = $('bldInspect');
    if (open) box.classList.add('open');
    if (!c) {
      shown = null;
      box.innerHTML = '<div class="empty-state"><b>Card inspector</b><span>Point at a card in the results or in your deck to read it here.</span></div>';
      return;
    }
    if (c === shown && !open) return;
    shown = c;
    const part = ignoredText(c), e = deck.get(c.name), n = e ? e.main + e.side + e.cmd : 0;
    box.innerHTML = `<button class="btn small ghost insp-close" data-insp="close">Close</button>
      <div class="insp-img">${face(c)}${c.imgNormal ? `<img src="${esc(c.imgNormal)}" alt="${esc(c.name)}" width="488" height="680" decoding="async" style="position:absolute;inset:0">` : ''}</div>
      <div class="insp-name"><span>${esc(c.name)}</span>${cost(c)}</div>
      <div class="insp-type"><span>${esc(c.typeLine)}</span>${ptOf(c) ? `<b>${esc(ptOf(c))}</b>` : ''}</div>
      <div class="insp-text">${symbolize(c.fullText || c.text || '') || '<span class="muted">(no rules text)</span>'}</div>
      ${part ? `<div class="insp-warn">⚠ Partly simulated: ${esc(part)}</div>` : ''}
      ${coll ? `<div class="muted">You own ${owned(c.name)}.</div>` : ''}
      <div class="insp-acts"><button class="btn small primary" data-insp="add">Add to deck</button>${n ? `<button class="btn small" data-insp="cut">Take one out</button><span class="muted">${n} in the deck</span>` : ''}</div>`;
    root.querySelectorAll('.ctile.sel, .bld-row.sel').forEach(x => x.classList.remove('sel'));
    root.querySelectorAll(`.ctile[data-name="${CSS.escape(c.name)}"], .bld-row[data-name="${CSS.escape(c.name)}"]`).forEach(x => x.classList.add('sel'));
  }
  $('bldInspect').onclick = e => {
    const b = /** @type {HTMLElement} */ (e.target).closest('[data-insp]');
    if (!b || !(b instanceof HTMLElement)) return;
    const c = shown;
    if (b.dataset.insp === 'close' || !c) { $('bldInspect').classList.remove('open'); return; }
    if (b.dataset.insp === 'add') { add(c, 'main'); flash = c.name; }
    if (b.dataset.insp === 'cut') { const en = deck.get(c.name); if (en) { const z = en.main ? 'main' : en.side ? 'side' : 'cmd'; en[z]--; if (!en.main && !en.side && !en.cmd) deck.delete(c.name); } }
    renderDeck();
    shown = null; inspect(c);
  };
  // (the inspector over the page closes on a click anywhere else, and on Escape)
  root.onclick = e => { const box = $('bldInspect'); if (box.classList.contains('open') && !/** @type {HTMLElement} */ (e.target).closest('#bldInspect, .ctile-look')) box.classList.remove('open'); };
  root.onkeydown = e => { if (e.key === 'Escape' && $('bldInspect').classList.contains('open')) { $('bldInspect').classList.remove('open'); e.stopPropagation(); } };
  $('bldTabs').onclick = e => {
    const b = /** @type {HTMLElement} */ (e.target).closest('[data-pane]');
    if (!b || !(b instanceof HTMLElement)) return;
    $('bldBody').dataset.pane = b.dataset.pane;
    $('bldTabs').querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b));
  };

  function renderDeck() {
    const all = [...deck.values()];
    const main = all.filter(e => e.main || e.cmd);
    const cmds = all.filter(e => e.cmd);
    const side = all.filter(e => e.side);
    // Mana curve of the nonland main-deck cards, and the type counts
    const curve = Array(8).fill(0);
    let mvSum = 0, mvCards = 0, lands = 0;
    const pips = { W: 0, U: 0, B: 0, R: 0, G: 0 };
    for (const e of main) {
      if (isLand(e.card)) { lands += e.main + e.cmd; continue; }
      if (e.main) { curve[Math.min(7, Math.round(e.card.cmc || 0))] += e.main; mvSum += (e.card.cmc || 0) * e.main; mvCards += e.main; }
      for (const [, c] of (e.card.manaCost || '').matchAll(/\{([WUBRG])(?:\/[WUBRGP])?\}/g)) pips[c] += e.main + e.cmd;
    }
    /** @type {Record<string, number>} */
    const types = {};
    for (const e of main) types[typeOf(e.card)] = (types[typeOf(e.card)] || 0) + e.main + e.cmd;
    const n = total('main') + total('cmd');
    const off = f.exact ? n !== f.deck : n < f.deck;

    // The commander: its art across the top of the deck
    const identity = new Set(cmds.flatMap(e => e.card.colorIdentity || []));
    if (!f.commander) $('bldCmd').innerHTML = '';
    else if (!cmds.length) $('bldCmd').innerHTML = '<div class="bld-cmd none">No commander yet: add a legendary creature, then click its ★ in the list.</div>';
    else {
      const art = cmds[0].card.art;
      $('bldCmd').innerHTML = `<div class="bld-cmd"${art ? ` style="background-image:url('${esc(art)}')"` : ''}><div><span><small>Commander</small><b>${cmds.map(e => esc(e.card.name)).join(' + ')}</b></span><span class="ci" title="Color identity">${symbolize(['W', 'U', 'B', 'R', 'G'].filter(c => identity.has(c)).map(c => `{${c}}`).join('') || '{C}')}</span></div></div>`;
    }

    // Checks against the format: only what the card data says
    const checks = [];
    if (f.deck) checks.push({ ok: !off, text: off ? `${n} of ${f.exact ? 'exactly' : 'at least'} ${f.deck} cards` : `${n} cards: the right size for ${f.name}` });
    if (f.commander && !f.anyDeck) checks.push({ ok: !!cmds.length, text: cmds.length ? 'Has a commander' : 'Needs a commander' });
    const over = all.filter(e => !isBasic(e.card) && e.main + e.side + e.cmd > f.copies && f.copies < 99);
    if (f.copies < 99) checks.push({ ok: !over.length, text: over.length ? `Over ${f.copies} cop${f.copies === 1 ? 'y' : 'ies'}: ${over.map(e => e.card.name).join(', ')}` : f.copies === 1 ? 'One of each card' : `No more than ${f.copies} of a card` });
    if (f.commander && !f.anyDeck && cmds.length) {
      const out = main.filter(e => (e.card.colorIdentity || []).some(c => !identity.has(c)));
      checks.push({ ok: !out.length, text: out.length ? `Outside the commander's colors: ${out.map(e => e.card.name).join(', ')}` : "Every card is in the commander's colors" });
    }
    if (f.sideboard && f.sideboard < 99) checks.push({ ok: total('side') <= f.sideboard, text: `Sideboard ${total('side')} of ${f.sideboard}` });

    const fill = f.deck ? Math.min(100, Math.round((n / f.deck) * 100)) : 0;
    $('bldStats').innerHTML = `<div class="bld-count ${off ? 'warn' : ''}"><b>${n}</b> / ${f.deck}${f.exact ? '' : '+'} cards${f.sideboard ? ` · sideboard ${total('side')}` : ''}</div>
      ${f.deck ? `<div class="bld-meter ${!off ? 'ok' : f.exact && n > f.deck ? 'over' : ''}"><span style="--w:${fill}%"></span></div>` : ''}
      ${statTiles([
    { label: 'Lands', value: lands, title: 'Land cards in the main deck' },
    { label: 'Spells', value: n - lands, title: 'Nonland cards in the main deck, with the commander' },
    { label: 'Avg cost', value: mvCards ? (mvSum / mvCards).toFixed(2) : '–', title: 'Average mana value of the nonland cards in the main deck' },
  ])}
      <h3 class="bld-h">Mana curve</h3>${curveChart(curve)}
      <h3 class="bld-h">Color pips</h3>${pipChart(pips)}
      <h3 class="bld-h">Card types</h3>${typeChart(types)}
      ${checks.length ? `<h3 class="bld-h">Checks</h3><ul class="bld-checks">${checks.map(c => `<li class="${c.ok ? '' : 'no'}">${esc(c.text)}</li>`).join('')}</ul>` : ''}`;

    const row = (e, z) => {
      const tooMany = !isBasic(e.card) && e.main + e.side > f.copies && f.copies < 99;
      return `<div class="bld-row ${tooMany ? 'warn' : ''} ${flash === e.card.name ? 'flash' : ''}" draggable="true" data-name="${esc(e.card.name)}" data-zone="${z}">
        <b>${e[z]}</b> <span class="bld-cn" title="${esc(e.card.typeLine)}">${esc(e.card.name)}</span>${coll && !isBasic(e.card) ? (owned(e.card.name) >= e.main + e.side + e.cmd ? ' <span class="own-mark" title="In your collection">✓</span>' : ` <span class="own-miss" title="Your collection has ${owned(e.card.name)}">need ${e.main + e.side + e.cmd - owned(e.card.name)}</span>`) : ''} ${cost(e.card)}
        <span class="bld-btns">${f.commander && z === 'main' && e[z] === 1 ? `<button class="btn small" data-do="cmd" title="Make it the commander" aria-label="Make ${esc(e.card.name)} the commander">★</button>` : ''}${f.sideboard && z === 'main' ? '<button class="btn small" data-do="toSide" title="Move a copy to the sideboard">SB</button>' : ''}${z === 'side' ? '<button class="btn small" data-do="toMain" title="Move a copy to the deck">Deck</button>' : ''}
        <button class="btn small" data-do="minus" title="One fewer" aria-label="One fewer ${esc(e.card.name)}">−</button><button class="btn small" data-do="plus" title="One more" aria-label="One more ${esc(e.card.name)}">+</button></span></div>`;
    };
    const section = (key, title, count, color, rows) => `<details class="bld-cat" data-cat="${key}" ${folded.has(key) ? '' : 'open'}><summary><i style="--c:${color}"></i>${title}<span>${count}</span></summary>${rows}</details>`;
    const groups = {};
    for (const e of all) if (e.main) (groups[typeOf(e.card)] ||= []).push(e);
    $('bldList').innerHTML = (cmds.length ? section('cmd', 'Commander', cmds.length, 'var(--accent)', cmds.map(e => row(e, 'cmd')).join('')) : '')
      + [...TYPES, 'other'].filter(t => groups[t]).map(t => section(t, TYPE_NAMES[t], groups[t].reduce((a, e) => a + e.main, 0), typeColor(t), groups[t].sort((a, b) => (a.card.cmc || 0) - (b.card.cmc || 0) || a.card.name.localeCompare(b.card.name)).map(e => row(e, 'main')).join(''))).join('')
      + (side.length ? section('side', 'Sideboard', total('side'), 'var(--muted)', side.map(e => row(e, 'side')).join('')) : '')
      + (!deck.size ? '<div class="empty-state"><b>An empty deck</b><span>Search on the left, then click or drag cards here.</span></div>' : '');
    flash = '';
    // (the charts grow in once, when the builder opens; after that they only change size)
    requestAnimationFrame(() => $('bldStats').classList.add('settled'));
    $('bldTabCount').textContent = `(${n})`;
    syncQty();
  }
  // How many copies of each result are in the deck, on its tile
  function syncQty() {
    for (const t of root.querySelectorAll('.ctile')) {
      const e = deck.get(/** @type {HTMLElement} */ (t).dataset.name || ''), n = e ? e.main + e.side + e.cmd : 0;
      let q = t.querySelector('.ctile-qty');
      if (!n) { q?.remove(); continue; }
      if (!q) { q = document.createElement('span'); q.className = 'ctile-qty'; t.append(q); }
      if (q.textContent !== `×${n}`) { q.textContent = `×${n}`; q.setAttribute('title', `${n} in the deck`); }
    }
  }
  // Moves within the deck list
  $('bldList').onclick = e => {
    const b = e.target.closest('[data-do]'), r = e.target.closest('.bld-row');
    if (!b || !r) return;
    const en = deck.get(r.dataset.name), z = r.dataset.zone;
    if (!en) return;
    if (b.dataset.do === 'plus') en[z]++;
    if (b.dataset.do === 'minus') en[z]--;
    if (b.dataset.do === 'toSide') { en.main--; en.side++; }
    if (b.dataset.do === 'toMain') { en.side--; en.main++; }
    if (b.dataset.do === 'cmd') { for (const x of deck.values()) if (x.cmd) { x.main += x.cmd; x.cmd = 0; } en.main--; en.cmd = 1; }
    if (!en.main && !en.side && !en.cmd) deck.delete(r.dataset.name);
    renderDeck();
  };
  $('bldList').onmouseover = e => { const r = e.target.closest('.bld-row'); const en = r && deck.get(r.dataset.name); if (en) inspect(en.card); };
  // Dragging: results → deck adds one; deck row → results takes one out
  $('bldList').ondragstart = e => { const r = e.target.closest('.bld-row'); if (r) e.dataTransfer.setData('text/bld-out', JSON.stringify({ name: r.dataset.name, zone: r.dataset.zone })); };
  $('bldResults').ondragover = e => { if (e.dataTransfer.types.includes('text/bld-out')) e.preventDefault(); };
  $('bldResults').ondrop = e => {
    const d = e.dataTransfer.getData('text/bld-out');
    if (!d) return;
    e.preventDefault();
    const { name, zone } = JSON.parse(d);
    const en = deck.get(name);
    if (en) { en[zone] = Math.max(0, en[zone] - 1); if (!en.main && !en.side && !en.cmd) deck.delete(name); renderDeck(); }
  };
  $('bldDeckDrop').ondragover = e => { if (e.dataTransfer.types.includes('text/bld-in')) { e.preventDefault(); $('bldDeckDrop').classList.add('drop'); } };
  $('bldDeckDrop').ondragleave = e => { if (!$('bldDeckDrop').contains(/** @type {Node} */ (e.relatedTarget))) $('bldDeckDrop').classList.remove('drop'); };
  $('bldDeckDrop').ondrop = e => { $('bldDeckDrop').classList.remove('drop'); const id = e.dataTransfer.getData('text/bld-in'); if (!id) return; e.preventDefault(); const c = found.get(id); if (c) { add(c, f.commander && !total('cmd') && /legendary/i.test(c.typeLine) && /creature|planeswalker/i.test(c.typeLine) && !deck.size ? 'cmd' : 'main'); flash = c.name; renderDeck(); } };

  // Searching Scryfall
  const found = new Map();
  let next = null;
  const query = () => {
    const parts = [$('bldQuery').value.trim()];
    const cols = [...root.querySelectorAll('[data-color]:checked')].map(x => x.dataset.color);
    if (cols.includes('C')) parts.push('c:c');
    else if (cols.length) parts.push(`c<=${cols.join('').toLowerCase()}`, `(${cols.map(c => `c:${c.toLowerCase()}`).join(' or ')})`);
    if ($('bldType').value) parts.push(`t:${$('bldType').value}`);
    if ($('bldMv').value !== '') parts.push(+$('bldMv').value === 6 ? 'mv>=6' : `mv=${$('bldMv').value}`);
    if ($('bldLegal').checked && f.legal) parts.push(`legal:${f.legal}`);
    if (f.rarity) parts.push(`(${f.rarity.map(r => `r:${r}`).join(' or ')})`);
    return parts.filter(Boolean).join(' ') + ' game:paper';
  };
  // (the order Scryfall returns: the format's usual one unless another is chosen)
  const order = () => $('bldSort').value || (f.commander ? 'edhrec' : 'name');
  const tile = c => {
    found.set(c.id, c);
    const n = coll ? owned(c.name) : 0, part = ignoredText(c);
    // (the small picture on ordinary screens, the sharper one where the screen has the pixels for it)
    const img = c.imgSmall ? `<img src="${esc(c.imgSmall)}"${c.imgNormal ? ` srcset="${esc(c.imgSmall)} 146w, ${esc(c.imgNormal)} 488w" sizes="150px"` : ''} alt="" width="146" height="204" loading="lazy" decoding="async">` : '';
    return `<div class="bld-res ctile" draggable="true" tabindex="0" role="button" data-id="${c.id}" data-name="${esc(c.name)}" aria-label="Add ${esc(c.name)}, ${esc(c.typeLine)}" title="${esc(c.name)} · ${esc(c.typeLine)}${n ? ` · you own ${n}` : ''}${part ? ` · ⚠ ${esc(part)}` : ''}">
      <div class="ctile-img">${face(c)}${img}</div>
      <div class="ctile-cap"><span>${esc(c.name)}</span>${cost(c)}</div>
      <button class="ctile-look" data-look="1" tabindex="-1" title="Look at this card" aria-label="Look at ${esc(c.name)}"><svg class="ico" aria-hidden="true"><use href="#i-look"/></svg></button>
      ${part ? '<span class="sim-badge" title="Partly simulated">⚠</span>' : ''}${n ? `<span class="own-badge">✓${n > 1 ? n : ''}</span>` : ''}</div>`;
  };
  const show = (cards, append) => {
    const html = cards.map(tile).join('');
    if (append) $('bldResults').insertAdjacentHTML('beforeend', html); else $('bldResults').innerHTML = html || '<div class="empty-state"><b>No cards found</b><span>Try fewer filters, or another spelling.</span></div>';
    syncQty();
  };
  const busy = t => { $('bldStatus').innerHTML = `<span class="rune" aria-hidden="true"></span>${esc(t)}`; };
  async function search(more = false) {
    try {
      busy('Searching Scryfall…');
      let j = more && next ? await sf(next.replace('https://api.scryfall.com', '')) : await sf(`/cards/search?order=${order()}&q=${encodeURIComponent(query())}`);
      next = j.has_more ? j.next_page : null;
      let cards = j.data.map(normalize);
      // (only owned cards, item 147, and only fully simulated cards, item 154: Scryfall knows neither, so pages are
      // filtered here, reading on for a few pages until there are enough)
      const keep = c => (!$('bldOwned').checked || owned(c.name)) && (!$('bldSim').checked || !ignoredText(c));
      if ($('bldOwned').checked || $('bldSim').checked) {
        cards = cards.filter(keep);
        for (let k = 0; k < 6 && cards.length < 30 && next; k++) {
          busy('Looking for more cards that match…');
          j = await sf(next.replace('https://api.scryfall.com', ''));
          next = j.has_more ? j.next_page : null;
          cards.push(...j.data.map(normalize).filter(keep));
        }
      }
      show(cards, more);
      $('bldStatus').textContent = $('bldOwned').checked || $('bldSim').checked ? `${cards.length} matching cards shown${next ? ' (More results reads on)' : ''}. Click a card to add a copy.` : `${j.total_cards} card${j.total_cards === 1 ? '' : 's'}${order() === 'edhrec' ? ', most played first' : ''}. Click a card to add a copy.`;
      $('bldMore').hidden = !next;
    } catch (e) {
      const none = /no cards/i.test(e.message);
      $('bldStatus').textContent = none ? 'No cards match.' : `Search failed: ${e.message}`;
      if (!more) $('bldResults').innerHTML = `<div class="empty-state"><b>${none ? 'No cards match' : "Couldn't search"}</b><span>${none ? 'Try fewer filters, or another spelling.' : `${esc(e.message)}. Check the connection and search again.`}</span></div>`;
      $('bldMore').hidden = true;
    }
  }
  $('bldGo').onclick = () => search();
  $('bldAlmost').hidden = !f.commander;
  $('bldAlmostOut').innerHTML = '';
  $('bldAlmost').onclick = async () => {
    const out = $('bldAlmostOut');
    const cmd = [...deck.values()].filter(e => e.cmd).map(e => e.card.name), main = [...deck.values()].filter(e => e.main).map(e => e.card.name);
    if (!cmd.length) { out.innerHTML = '<p class="muted">Choose a commander (★) first: the combos are found in its colors.</p>'; return; }
    out.innerHTML = '<p class="muted"><span class="rune" aria-hidden="true"></span>Asking Commander Spellbook…</p>';
    try {
      const list = await almostCombos(cmd, main);
      out.innerHTML = list.length ? `<ul>${list.slice(0, 12).map(c => `<li><button class="btn small" data-almost="${esc(c.missing[0])}" title="Search for it">${esc(c.missing[0])}</button> + ${c.have.map(esc).join(' + ')}: ${esc(c.produces[0] || 'a combo')}</li>`).join('')}</ul>` : '<p class="muted">None one card away.</p>';
    } catch (err) { out.innerHTML = `<p class="muted">Couldn't reach Commander Spellbook: ${esc(err.message)}</p>`; }
  };
  $('bldAlmostOut').onclick = e => { const b = e.target.closest('[data-almost]'); if (b) { $('bldQuery').value = `!"${b.dataset.almost}"`; $('bldBody').dataset.pane = 'search'; $('bldTabs').querySelectorAll('button').forEach(x => x.classList.toggle('active', x.dataset.pane === 'search')); search(); } };
  $('bldOwned').onchange = () => search();
  $('bldSim').onchange = () => search();
  $('bldSort').onchange = () => search();
  $('bldType').onchange = () => search();
  $('bldMv').onchange = () => search();
  $('bldLegal').onchange = () => search();
  root.querySelectorAll('[data-color]').forEach(x => { /** @type {HTMLInputElement} */ (x).onchange = () => search(); });
  $('bldMore').onclick = () => search(true);
  $('bldQuery').onkeydown = e => { e.stopPropagation(); if (e.key === 'Enter') search(); };
  const addFrom = r => { const c = found.get(r.dataset.id); if (c) { add(c, 'main'); flash = c.name; renderDeck(); if (shown === c) { shown = null; inspect(c); } } };
  $('bldResults').onclick = e => {
    const r = e.target.closest('.bld-res');
    if (!r) return;
    if (e.target.closest('[data-look]')) { e.stopPropagation(); const c = found.get(r.dataset.id); shown = null; inspect(c, true); return; }
    addFrom(r);
  };
  $('bldResults').onkeydown = e => { const r = e.target.closest?.('.bld-res'); if (r && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); addFrom(r); } };
  $('bldResults').onmouseover = e => { const r = e.target.closest('.bld-res'); const c = r && found.get(r.dataset.id); if (c) inspect(c); };
  $('bldResults').onfocusin = e => { const r = e.target.closest('.bld-res'); const c = r && found.get(r.dataset.id); if (c) inspect(c); };
  $('bldResults').ondragstart = e => { const r = e.target.closest('.bld-res'); if (r) e.dataTransfer.setData('text/bld-in', r.dataset.id); };

  // The deck as a decklist the loader reads
  const text = () => {
    const line = (e, n) => `${n} ${e.card.name}`;
    const v = [...deck.values()];
    const cmd = v.filter(e => e.cmd).map(e => line(e, e.cmd));
    const main = v.filter(e => e.main).map(e => line(e, e.main));
    const side = v.filter(e => e.side).map(e => line(e, e.side));
    const name = $('bldName').value.trim();
    return [...(name ? ['About', `Name ${name}`, ''] : []), ...(cmd.length ? ['Commander', ...cmd, ''] : []), 'Deck', ...main, ...(side.length ? ['', 'Sideboard', ...side] : [])].join('\n');
  };
  $('bldUse').onclick = () => { opts.onUse?.(text(), $('bldName').value.trim(), +$('bldSeat').value); root.hidden = true; };
  $('bldSave').onclick = () => opts.onSave?.(text(), $('bldName').value.trim() || 'My deck');
  $('bldCopy').onclick = async () => { try { await navigator.clipboard.writeText(text()); $('bldStatus').textContent = 'The list is on your clipboard.'; } catch { $('bldStatus').textContent = 'Couldn\'t reach the clipboard.'; } };
  $('bldClose').onclick = () => { root.hidden = true; };
  $('bldInspect').classList.remove('open');
  $('bldStats').classList.remove('settled');
  inspect(null);
  renderDeck();
  root.hidden = false;
  // (results from an earlier opening belong to another search: start fresh)
  $('bldResults').innerHTML = '';
  search();
  setTimeout(() => $('bldQuery').focus(), 0);
  return { text };
}
