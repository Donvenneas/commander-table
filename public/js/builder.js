// Deck builder: a full-screen window to build a deck from every card on Scryfall. Search with
// Scryfall's own syntax plus filters (colors, type, mana value, the table format's legality); click or
// drag a card into the deck, and drag it back (or use −) to take it out. The mana curve, type counts
// and card count update as you go. Commander formats get a ★ to choose the commander; one-on-one
// formats get a sideboard.
import { sf, normalize } from './scryfall.js';
import { formatOf } from './formats.js';
import { esc, symbolize } from './util.js';
import { owned, hasCollection } from './collection.js';

const TYPES = ['creature', 'instant', 'sorcery', 'artifact', 'enchantment', 'planeswalker', 'land', 'battle'];
const typeOf = c => TYPES.find(t => new RegExp(`\\b${t}\\b`, 'i').test(c.typeLine)) || 'other';
const isLand = c => /\bland\b/i.test(c.typeLine);
const isBasic = c => /\bbasic\b/i.test(c.typeLine) && isLand(c);

let el = null;
function ensure() {
  if (el) return el;
  el = document.createElement('div');
  el.id = 'builderModal';
  el.className = 'modal builder-modal';
  el.hidden = true;
  el.innerHTML = `<div class="modal-card builder-card">
    <div class="modal-head"><div><h2>Deck builder</h2><p class="muted" id="bldIntro"></p></div>
      <div class="bld-actions"><input id="bldName" class="input" maxlength="60" placeholder="Deck name"><select id="bldSeat" class="input"></select>
        <button class="btn primary" id="bldUse">Put in seat</button><button class="btn" id="bldSave">Save to library</button><button class="btn ghost" id="bldCopy">Copy as text</button><button class="btn ghost" id="bldClose">Close</button></div></div>
    <div class="bld-body">
      <div class="bld-search">
        <div class="bld-filters">
          <input id="bldQuery" class="input" placeholder='Search, e.g. "draw a card" or t:goblin pow>=3' spellcheck="false">
          <span class="bld-colors">${['W', 'U', 'B', 'R', 'G', 'C'].map(c => `<label title="${c === 'C' ? 'Colorless' : c}"><input type="checkbox" data-color="${c}">${symbolize(`{${c}}`)}</label>`).join('')}</span>
          <select id="bldType" class="input"><option value="">Any type</option>${TYPES.map(t => `<option value="${t}">${t[0].toUpperCase() + t.slice(1)}</option>`).join('')}</select>
          <select id="bldMv" class="input"><option value="">Any mana value</option>${[0, 1, 2, 3, 4, 5, 6].map(n => `<option value="${n}">MV ${n}${n === 6 ? '+' : ''}</option>`).join('')}</select>
          <label class="muted"><input type="checkbox" id="bldLegal" checked> <span id="bldLegalName">Legal only</span></label>
          <label class="muted" id="bldOwnedWrap" title="Only cards in your collection (Collection… on the setup screen)"><input type="checkbox" id="bldOwned"> Only cards I own</label>
          <button class="btn small primary" id="bldGo">Search</button>
        </div>
        <div id="bldStatus" class="muted"></div>
        <div id="bldResults" class="bld-results" title="Drop a card here to take one copy out of the deck"></div>
        <button class="btn small" id="bldMore" hidden>More results</button>
      </div>
      <div class="bld-deck" id="bldDeckDrop" title="Drop cards here to add them">
        <div class="bld-stats" id="bldStats"></div>
        <div id="bldList"></div>
      </div>
    </div></div>`;
  document.body.append(el);
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
  function renderDeck() {
    const main = [...deck.values()].filter(e => e.main || e.cmd);
    // Mana curve of the nonland main-deck cards, and the type counts
    const curve = Array(8).fill(0);
    for (const e of main) if (!isLand(e.card) && e.main) curve[Math.min(7, Math.round(e.card.cmc || 0))] += e.main;
    const peak = Math.max(1, ...curve);
    const types = {};
    for (const e of main) types[typeOf(e.card)] = (types[typeOf(e.card)] || 0) + e.main + e.cmd;
    const n = total('main') + total('cmd');
    const off = f.exact ? n !== f.deck : n < f.deck;
    $('bldStats').innerHTML = `<div class="bld-count ${off ? 'warn' : ''}"><b>${n}</b> / ${f.deck}${f.exact ? '' : '+'} cards${f.sideboard ? ` · sideboard ${total('side')}` : ''}</div>
      <div class="bld-curve">${curve.map((k, i) => `<div class="bld-bar" title="Mana value ${i}${i === 7 ? '+' : ''}: ${k}"><span style="height:${Math.round((k / peak) * 100)}%"></span><small>${i}${i === 7 ? '+' : ''}</small><b>${k || ''}</b></div>`).join('')}</div>
      <div class="muted">${Object.entries(types).map(([t, k]) => `${k} ${t}${k === 1 ? '' : t === 'sorcery' ? '' : 's'}`).join(' · ') || 'Empty deck'}</div>`;
    const row = (e, z) => {
      const tooMany = !isBasic(e.card) && e.main + e.side > f.copies && f.copies < 99;
      return `<div class="bld-row ${tooMany ? 'warn' : ''}" draggable="true" data-name="${esc(e.card.name)}" data-zone="${z}">
        <b>${e[z]}</b> <span class="bld-cn" title="${esc(e.card.typeLine)}">${esc(e.card.name)}</span>${coll && !isBasic(e.card) ? (owned(e.card.name) >= e.main + e.side + e.cmd ? ' <span class="own-mark" title="In your collection">✓</span>' : ` <span class="own-miss" title="Your collection has ${owned(e.card.name)}">need ${e.main + e.side + e.cmd - owned(e.card.name)}</span>`) : ''} <span class="muted">${symbolize(esc(e.card.manaCost || ''))}</span>
        <span class="bld-btns">${f.commander && z === 'main' && e[z] === 1 ? `<button class="btn small" data-do="cmd" title="Make it the commander">★</button>` : ''}${f.sideboard && z === 'main' ? '<button class="btn small" data-do="toSide" title="Move a copy to the sideboard">SB</button>' : ''}${z === 'side' ? '<button class="btn small" data-do="toMain" title="Move a copy to the deck">Deck</button>' : ''}
        <button class="btn small" data-do="minus">−</button><button class="btn small" data-do="plus">+</button></span></div>`;
    };
    const groups = {};
    for (const e of deck.values()) if (e.main) (groups[typeOf(e.card)] ||= []).push(e);
    const cmds = [...deck.values()].filter(e => e.cmd);
    const side = [...deck.values()].filter(e => e.side);
    $('bldList').innerHTML = (cmds.length ? `<h4>Commander</h4>${cmds.map(e => row(e, 'cmd')).join('')}` : '')
      + [...TYPES, 'other'].filter(t => groups[t]).map(t => `<h4>${t[0].toUpperCase() + t.slice(1)} (${groups[t].reduce((a, e) => a + e.main, 0)})</h4>${groups[t].sort((a, b) => (a.card.cmc || 0) - (b.card.cmc || 0) || a.card.name.localeCompare(b.card.name)).map(e => row(e, 'main')).join('')}`).join('')
      + (side.length ? `<h4>Sideboard (${total('side')})</h4>${side.map(e => row(e, 'side')).join('')}` : '')
      + (!deck.size ? '<p class="muted">Search on the left, then click or drag cards here.</p>' : '');
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
  $('bldDeckDrop').ondragover = e => { if (e.dataTransfer.types.includes('text/bld-in')) e.preventDefault(); };
  $('bldDeckDrop').ondrop = e => { const id = e.dataTransfer.getData('text/bld-in'); if (!id) return; e.preventDefault(); const c = found.get(id); if (c) { add(c, f.commander && !total('cmd') && /legendary/i.test(c.typeLine) && /creature|planeswalker/i.test(c.typeLine) && !deck.size ? 'cmd' : 'main'); renderDeck(); } };

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
  const show = (cards, append) => {
    const html = cards.map(c => { found.set(c.id, c); const n = coll ? owned(c.name) : 0; return `<div class="bld-res" draggable="true" data-id="${c.id}" title="${esc(c.name)} · ${esc(c.typeLine)}${n ? ` · you own ${n}` : ''}">${c.imgSmall ? `<img src="${esc(c.imgSmall)}" alt="${esc(c.name)}" loading="lazy">` : `<span>${esc(c.name)}</span>`}${n ? `<span class="own-badge">✓${n > 1 ? n : ''}</span>` : ''}</div>`; }).join('');
    if (append) $('bldResults').insertAdjacentHTML('beforeend', html); else $('bldResults').innerHTML = html || '<p class="muted">No cards found.</p>';
  };
  async function search(more = false) {
    try {
      $('bldStatus').textContent = 'Searching Scryfall…';
      let j = more && next ? await sf(next.replace('https://api.scryfall.com', '')) : await sf(`/cards/search?order=${f.commander ? 'edhrec' : 'name'}&q=${encodeURIComponent(query())}`);
      next = j.has_more ? j.next_page : null;
      let cards = j.data.map(normalize);
      // (only owned cards: Scryfall doesn't know the collection, so pages are filtered here, reading on for a few
      // pages until there are enough)
      if ($('bldOwned').checked) {
        cards = cards.filter(c => owned(c.name));
        for (let k = 0; k < 6 && cards.length < 30 && next; k++) {
          $('bldStatus').textContent = 'Looking for cards you own…';
          j = await sf(next.replace('https://api.scryfall.com', ''));
          next = j.has_more ? j.next_page : null;
          cards.push(...j.data.map(normalize).filter(c => owned(c.name)));
        }
      }
      show(cards, more);
      $('bldStatus').textContent = $('bldOwned').checked ? `${cards.length} cards you own shown${next ? ' (More results reads on)' : ''}. Click a card to add a copy.` : `${j.total_cards} card${j.total_cards === 1 ? '' : 's'}${f.commander ? ', most played first' : ''}. Click a card to add a copy.`;
      $('bldMore').hidden = !next;
    } catch (e) { $('bldStatus').textContent = /no cards/i.test(e.message) ? 'No cards match.' : `Search failed: ${e.message}`; if (!more) $('bldResults').innerHTML = ''; $('bldMore').hidden = true; }
  }
  $('bldGo').onclick = () => search();
  $('bldOwned').onchange = () => search();
  $('bldMore').onclick = () => search(true);
  $('bldQuery').onkeydown = e => { e.stopPropagation(); if (e.key === 'Enter') search(); };
  $('bldResults').onclick = e => { const r = e.target.closest('.bld-res'); if (!r) return; const c = found.get(r.dataset.id); if (c) { add(c, 'main'); renderDeck(); } };
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
  renderDeck();
  root.hidden = false;
  // (results from an earlier opening belong to another search: start fresh)
  $('bldResults').innerHTML = '';
  search();
  setTimeout(() => $('bldQuery').focus(), 0);
  return { text };
}
