// Deck builder: a full-screen workspace to build a deck from every card on Scryfall. Three panels:
// the search with its card gallery, an inspector that shows the card under the pointer (or the keyboard
// focus) at reading size, and the deck with its commander, charts, checks and list by card type.
// Search with Scryfall's own syntax plus filters (colors, type, mana value, the table format's legality);
// click or drag a card into the deck, and drag it back (or use −) to take it out. Commander formats get
// a ★ to choose the commander; one-on-one formats get a sideboard. On a narrow screen the search and the
// deck are two tabs, and the inspector opens over the page from the magnifier on a card.
import { sf, normalize, fetchCollection } from './scryfall.js';
import { dekXml, arenaText, checklistText } from './deckexport.js';
import { sampleHands } from './goldfish.js';
import { formatOf } from './formats.js';
import { Rules } from './rules.js';
import { rulingsFor } from './ui.js';
import { esc, symbolize, store, whenText, dayText, numText, cardFace, ptOf } from './util.js';
import { notice } from './dialogs.js';
import { owned, hasCollection } from './collection.js';
import { almostCombos } from './combos.js';
import { ignoredText } from './effects.js';
import { statTiles, curveChart, pipChart, typeChart, countSources, TYPE_NAMES, typeColor, MANA_NAMES } from './deckcharts.js';

const TYPES = ['creature', 'instant', 'sorcery', 'artifact', 'enchantment', 'planeswalker', 'land', 'battle'];
const typeOf = c => TYPES.find(t => new RegExp(`\\b${t}\\b`, 'i').test(c.typeLine)) || 'other';
const isLand = c => /\bland\b/i.test(c.typeLine);
const isBasic = c => /\bbasic\b/i.test(c.typeLine) && isLand(c);
const cost = c => (c.manaCost ? `<span class="cost">${symbolize(c.manaCost)}</span>` : '');
// A card's face in words: under the picture while it loads, and instead of it when there is none (util.js)
const face = cardFace;

// The deck being built is kept here after every change, so closing the builder (or the game) doesn't lose it
const DRAFT = 'ct.builderDraft';
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
        <button class="btn primary" id="bldUse">Put in seat</button><button class="btn" id="bldSave">Save to library</button><button class="btn ghost" id="bldCopy">Copy as text</button><span class="menu"><button class="btn ghost menu-btn" id="bldShare" aria-haspopup="menu" aria-expanded="false" title="Save the deck as a file for another program">Export</button><div class="menu-list" role="menu" aria-labelledby="bldShare" hidden><button class="btn ghost" data-bld-exp="dek" title="An MTGO deck file (cards matched by name)">MTGO .dek file</button><button class="btn ghost" data-bld-exp="arena" title="Copy the list in MTG Arena's import format">Arena text (copy)</button><button class="btn ghost" data-bld-exp="check" title="A checklist by card type with set and number, to print or tick off">Checklist file</button><button class="btn ghost" data-bld-exp="txt" title="The decklist as a text file">Decklist file</button></div></span><button class="btn ghost" id="bldClose">Close</button></div></div>
    <nav class="tabs bld-tabs" id="bldTabs"><button data-pane="search" class="active">Search</button><button data-pane="deck">Deck <span id="bldTabCount"></span></button></nav>
    <div class="bld-body" id="bldBody" data-pane="search">
      <div class="bld-search">
        <div class="bld-filters" role="search">
          <input id="bldQuery" class="input" placeholder='Search, e.g. "draw a card" or t:goblin pow>=3' spellcheck="false" aria-label="Search cards" list="bldHistory" autocomplete="off"><datalist id="bldHistory"></datalist><button type="button" class="btn small ghost bld-keep" id="bldKeep" aria-pressed="false" title="Keep this search in the list under the field" aria-label="Keep this search">☆</button>
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
        <div class="bld-tools"><button class="btn small" id="bldUndo" title="Undo the last change to the deck (Ctrl+Z)" disabled>Undo</button><button class="btn small" id="bldRedo" title="Redo (Ctrl+Y)" disabled>Redo</button>
          <input id="bldDeckFilter" class="input" placeholder="Filter the deck…" aria-label="Filter the deck by name or type" autocomplete="off" spellcheck="false">
          <select id="bldDeckSort" class="input" aria-label="Order of the deck list"><option value="mv">By mana value</option><option value="name">By name</option></select></div>
        <details class="bld-paste" id="bldLandsBox"><summary>Fill in basic lands</summary>
          <div class="bld-tools"><button class="btn small" id="bldLandsPlan">Suggest</button><button class="btn small primary" id="bldLandsGo" hidden>Add them</button><span id="bldLandsSay" class="muted" role="status"></span></div></details>
        <details class="bld-paste" id="bldPasteBox"><summary>Add a list of cards</summary>
          <textarea id="bldPaste" class="input" rows="5" spellcheck="false" aria-label="Card names to add, one per line" placeholder="One card per line, with or without a number:&#10;1 Sol Ring&#10;Counterspell&#10;3x Island"></textarea>
          <div class="bld-tools"><button class="btn small primary" id="bldPasteGo">Add them</button><span id="bldPasteStatus" class="muted" role="status"></span></div></details>
        <details class="bld-paste" id="bldHandBox"><summary>Draw a test hand</summary>
          <div class="bld-tools"><button class="btn small primary" id="bldHandNew">Draw seven</button><button class="btn small" id="bldHandMull" disabled>Mulligan</button><button class="btn small" id="bldHandDraw" disabled>Draw a card</button><span id="bldHandSay" class="muted" role="status"></span></div>
          <div id="bldHand" class="gf-row"></div></details>
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
  const known = new Map();
  const add = (c, zone = 'main', n = 1) => { known.set(c.name, c); const e = deck.get(c.name) || { card: c, main: 0, side: 0, cmd: 0 }; e[zone] += n; deck.set(c.name, e); };
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
  // Undo and redo: the deck as a list of counts after each change (the cards themselves are in `known`)
  const snap = () => JSON.stringify([...deck.values()].map(e => [e.card.name, e.main, e.side, e.cmd]));
  const undo = [], redo = [];
  let cur = snap(), travelling = false;
  const goTo = state => {
    deck.clear();
    for (const [name, main, side, cmd] of JSON.parse(state)) { const card = known.get(name); if (card) deck.set(name, { card, main, side, cmd }); }
    cur = state;
    travelling = true; renderDeck(); travelling = false;
    if (shown) { const c = shown; shown = null; inspect(c); }
  };
  const stepBack = () => { if (!undo.length) return; redo.push(cur); goTo(undo.pop()); };
  const stepOn = () => { if (!redo.length) return; undo.push(cur); goTo(redo.pop()); };

  // Corner marks (item 308): not legal or banned in this format, restricted, on the Game Changers list
  const marksOf = c => {
    const l = f.legal ? (c.legalities ? c.legalities[f.legal] : f.legal === 'commander' ? c.legal : undefined) : undefined;
    const out = [];
    if (l === 'banned') out.push(['ban', `Banned in ${f.name}`, '⊘']);
    else if (l === 'restricted') out.push(['gc', `Restricted in ${f.name}: one copy`, '1']);
    else if (l && l !== 'legal') out.push(['ban', `Not legal in ${f.name}`, '⊘']);
    if (c.gameChanger && f.commander) out.push(['gc', "Game Changer: counts toward the deck's bracket", 'GC']);
    return out;
  };
  const marks = c => { const m = marksOf(c); return m.length ? `<span class="cmarks">${m.map(([k, t, g]) => `<span class="cmark ${k}" title="${esc(t)}" aria-label="${esc(t)}">${g}</span>`).join('')}</span>` : ''; };

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
      ${marksOf(c).map(([k, t]) => `<div class="insp-mark ${k}">${esc(t)}</div>`).join('')}
      <div class="insp-text">${Rules.glossify(symbolize(c.fullText || c.text || '')) || '<span class="muted">(no rules text)</span>'}</div>
      ${part ? `<div class="insp-warn">⚠ Partly simulated: ${esc(part)}</div>` : ''}
      ${coll ? `<div class="muted">You own ${owned(c.name)}.</div>` : ''}
      <div class="insp-acts"><button class="btn small primary" data-insp="add">Add to deck</button>${c.backNormal ? '<button class="btn small" data-insp="flip" title="Show the other face">Flip</button>' : ''}${c.id ? '<button class="btn small ghost" data-insp="rulings" title="Scryfall\'s rulings for this card">Rulings</button>' : ''}${n ? `<button class="btn small" data-insp="cut">Take one out</button><span class="muted">${n} in the deck</span>` : ''}</div>
      <div class="insp-rulings" hidden></div>`;
    root.querySelectorAll('.ctile.sel, .bld-row.sel').forEach(x => x.classList.remove('sel'));
    root.querySelectorAll(`.ctile[data-name="${CSS.escape(c.name)}"], .bld-row[data-name="${CSS.escape(c.name)}"]`).forEach(x => x.classList.add('sel'));
  }
  $('bldInspect').onclick = e => {
    const b = /** @type {HTMLElement} */ (e.target).closest('[data-insp]');
    if (!b || !(b instanceof HTMLElement)) return;
    const c = shown;
    if (b.dataset.insp === 'close' || !c) { $('bldInspect').classList.remove('open'); return; }
    // (item 304) the other face of a double-faced card
    if (b.dataset.insp === 'flip') {
      const im = /** @type {HTMLImageElement | null} */ ($('bldInspect').querySelector('.insp-img > img'));
      if (im) { const back = im.dataset.back !== '1'; im.dataset.back = back ? '1' : ''; im.classList.add('flipping'); setTimeout(() => { im.src = back ? c.backNormal : c.imgNormal; im.classList.remove('flipping'); }, 160); }
      return;
    }
    // (item 309) rulings, fetched once a card and kept (the same store as the right-click window on the table)
    if (b.dataset.insp === 'rulings') {
      const box = /** @type {HTMLElement | null} */ ($('bldInspect').querySelector('.insp-rulings'));
      if (!box) return;
      if (!box.hidden) { box.hidden = true; return; }
      box.hidden = false;
      box.innerHTML = '<span class="muted"><span class="rune" aria-hidden="true"></span>Loading…</span>';
      rulingsFor(c).then(list => { if (shown === c) box.innerHTML = list.length ? list.map(r => `<p><small class="muted">${esc(r.d)}</small> ${esc(r.t)}</p>`).join('') : '<p class="muted">Scryfall has no rulings for this card.</p>'; })
        .catch(() => { if (shown === c) box.innerHTML = '<p class="muted">Couldn\'t reach Scryfall for the rulings.</p>'; });
      return;
    }
    if (b.dataset.insp === 'add') { add(c, 'main'); flash = c.name; }
    if (b.dataset.insp === 'cut') { const en = deck.get(c.name); if (en) { const z = en.main ? 'main' : en.side ? 'side' : 'cmd'; en[z]--; if (!en.main && !en.side && !en.cmd) deck.delete(c.name); } }
    renderDeck();
    shown = null; inspect(c);
  };
  // (the inspector over the page closes on a click anywhere else, and on Escape)
  root.onclick = e => { const box = $('bldInspect'); if (box.classList.contains('open') && !/** @type {HTMLElement} */ (e.target).closest('#bldInspect, .ctile-look')) box.classList.remove('open'); };
  root.onkeydown = e => {
    if (e.key === 'Escape' && $('bldInspect').classList.contains('open')) { $('bldInspect').classList.remove('open'); e.stopPropagation(); return; }
    // (in a field, Ctrl+Z belongs to the typing)
    if (/** @type {HTMLElement} */ (e.target).matches?.('input, textarea, select') || !(e.ctrlKey || e.metaKey)) return;
    const k = e.key.toLowerCase();
    if (k === 'z' && !e.shiftKey) { e.preventDefault(); stepBack(); } else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); stepOn(); }
  };
  $('bldUndo').onclick = stepBack;
  $('bldRedo').onclick = stepOn;
  $('bldDeckFilter').value = '';
  $('bldDeckFilter').oninput = () => renderDeck();
  $('bldDeckFilter').onkeydown = e => e.stopPropagation();
  $('bldDeckSort').onchange = () => renderDeck();
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
      <h3 class="bld-h">Mana curve</h3>${curveChart(curve, { avg: mvCards ? mvSum / mvCards : null })}
      <h3 class="bld-h">Color pips</h3>${pipChart(pips, countSources(main.map(e => ({ card: e.card, qty: e.main + e.cmd }))))}
      <h3 class="bld-h">Card types</h3>${typeChart(types)}
      ${checks.length ? `<h3 class="bld-h">Checks</h3><ul class="bld-checks">${checks.map(c => `<li class="${c.ok ? '' : 'no'}">${esc(c.text)}</li>`).join('')}</ul>` : ''}`;

    const row = (e, z) => {
      const tooMany = !isBasic(e.card) && e.main + e.side > f.copies && f.copies < 99;
      return `<div class="bld-row ${tooMany ? 'warn' : ''} ${flash === e.card.name ? 'flash' : ''}" draggable="true" data-name="${esc(e.card.name)}" data-zone="${z}">
        <b>${e[z]}</b> <span class="bld-cn" title="${esc(e.card.typeLine)}">${esc(e.card.name)}</span>${coll && !isBasic(e.card) ? (owned(e.card.name) >= e.main + e.side + e.cmd ? ' <span class="own-mark" title="In your collection">✓</span>' : ` <span class="own-miss" title="Your collection has ${owned(e.card.name)}">need ${e.main + e.side + e.cmd - owned(e.card.name)}</span>`) : ''} ${cost(e.card)}
        <span class="bld-btns">${f.commander && z === 'main' && e[z] === 1 ? `<button class="btn small" data-do="cmd" title="Make it the commander" aria-label="Make ${esc(e.card.name)} the commander">★</button>` : ''}${f.sideboard && z === 'main' ? '<button class="btn small" data-do="toSide" title="Move a copy to the sideboard">SB</button>' : ''}${z === 'side' ? '<button class="btn small" data-do="toMain" title="Move a copy to the deck">Deck</button>' : ''}
        <button class="btn small" data-do="minus" title="One fewer" aria-label="One fewer ${esc(e.card.name)}">−</button><button class="btn small" data-do="plus" title="One more" aria-label="One more ${esc(e.card.name)}">+</button></span></div>`;
    };
    const q = $('bldDeckFilter').value.trim().toLowerCase();
    const hit = e => !q || e.card.name.toLowerCase().includes(q) || e.card.typeLine.toLowerCase().includes(q);
    const byName = (a, b) => a.card.name.localeCompare(b.card.name);
    const order = $('bldDeckSort').value === 'name' ? byName : (a, b) => (a.card.cmc || 0) - (b.card.cmc || 0) || byName(a, b);
    const section = (key, title, count, color, rows) => !rows ? '' : `<details class="bld-cat" data-cat="${key}" ${folded.has(key) ? '' : 'open'}><summary><i style="--c:${color}"></i>${title}<span>${count}</span></summary>${rows}</details>`;
    const groups = {};
    for (const e of all) if (e.main) (groups[typeOf(e.card)] ||= []).push(e);
    const listHtml = (cmds.length ? section('cmd', 'Commander', cmds.length, 'var(--accent)', cmds.filter(hit).map(e => row(e, 'cmd')).join('')) : '')
      + [...TYPES, 'other'].filter(t => groups[t]).map(t => section(t, TYPE_NAMES[t], groups[t].reduce((a, e) => a + e.main, 0), typeColor(t), groups[t].filter(hit).sort(order).map(e => row(e, 'main')).join(''))).join('')
      + (side.length ? section('side', 'Sideboard', total('side'), 'var(--muted)', side.filter(hit).sort(order).map(e => row(e, 'side')).join('')) : '');
    $('bldList').innerHTML = listHtml
      + (!deck.size ? '<div class="empty-state"><b>An empty deck</b><span>Search on the left, then click or drag cards here.</span></div>' : !listHtml ? '<div class="empty-state"><b>Nothing in the deck matches</b><span>Clear the filter to see every card.</span></div>' : '');
    // Undo history, and the draft kept for next time
    const now = snap();
    if (now !== cur) {
      if (!travelling) { undo.push(cur); if (undo.length > 200) undo.shift(); redo.length = 0; }
      cur = now;
      // (only a change to the deck touches the draft: opening the builder empty must not wipe the one on offer)
      // (kept with the card data it was built from, so it comes back without the network and whatever the format's deck rules say)
      if (ready) store(DRAFT, deck.size ? { format: opts.format, at: Date.now(), name: $('bldName').value.trim(), list: JSON.parse(now), cards: Object.fromEntries([...deck.values()].filter(e => e.card.src).map(e => [e.card.name, e.card.src])) } : null);
    }
    $('bldUndo').disabled = !undo.length;
    $('bldRedo').disabled = !redo.length;
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
      <div class="ctile-img">${face(c)}${img}</div>${marks(c)}
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
  let loading = false;
  async function search(more = false) {
    if (loading && more) return;
    loading = true;
    if (!more) recall($('bldQuery').value);
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
    loading = false;
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
  // Keys on a card in the gallery: arrows move, Enter adds (Shift+Enter to the sideboard), C makes it the commander, I opens the inspector
  $('bldResults').onkeydown = e => {
    const r = e.target.closest?.('.bld-res');
    if (!r || e.ctrlKey || e.metaKey || e.altKey) return;
    const c = found.get(r.dataset.id), k = e.key.toLowerCase();
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (e.shiftKey && f.sideboard && c) { add(c, 'side'); flash = c.name; renderDeck(); } else addFrom(r);
    } else if (k === 'c' && f.commander && c) {
      e.preventDefault();
      if (!c.canBeCommander && !(/legendary/i.test(c.typeLine) && /creature|planeswalker/i.test(c.typeLine))) { notice(`${c.name} can't be a commander: it isn't a legendary creature.`, { tone: 'warn' }); return; }
      for (const x of deck.values()) if (x.cmd) { x.main += x.cmd; x.cmd = 0; }
      add(c, 'cmd'); flash = c.name; renderDeck();
    } else if (k === 'i' && c) { e.preventDefault(); shown = null; inspect(c, true); }
    else if (e.key.startsWith('Arrow')) {
      const tiles = /** @type {HTMLElement[]} */ ([...$('bldResults').querySelectorAll('.bld-res')]);
      const i = tiles.indexOf(r), cols = Math.max(1, tiles.findIndex(t => t.offsetTop !== tiles[0].offsetTop) < 0 ? tiles.length : tiles.findIndex(t => t.offsetTop !== tiles[0].offsetTop));
      const to = tiles[i + ({ ArrowLeft: -1, ArrowRight: 1, ArrowUp: -cols, ArrowDown: cols }[e.key] || 0)];
      if (to) { e.preventDefault(); to.focus(); to.scrollIntoView({ block: 'nearest' }); }
    }
  };
  // More results arrive as the gallery nears its end (the More button stays, for when the page scrolls instead)
  $('bldResults').onscroll = () => { const g = $('bldResults'); if (next && !loading && g.scrollTop + g.clientHeight > g.scrollHeight - 400) search(true); };
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
  $('bldUse').onclick = () => { opts.onUse?.(text(), $('bldName').value.trim(), +$('bldSeat').value); store(DRAFT, null); root.hidden = true; };
  $('bldSave').onclick = () => { opts.onSave?.(text(), $('bldName').value.trim() || 'My deck'); store(DRAFT, null); };
  // Export (item 328): the same files the deck viewer makes, from the deck as it stands
  const asDeck = () => { const v = [...deck.values()]; return { deckName: $('bldName').value.trim() || 'Deck', commanders: v.filter(e => e.cmd).map(e => e.card), cards: v.filter(e => e.main).map(e => ({ card: e.card, qty: e.main })), sideboard: v.filter(e => e.side).map(e => ({ card: e.card, qty: e.side })) }; };
  const saveFile = (name, body, type = 'text/plain') => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([body], { type })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); };
  root.querySelectorAll('[data-bld-exp]').forEach(b => { /** @type {HTMLElement} */ (b).onclick = async () => {
    if (!deck.size) { notice('The deck is empty: there is nothing to export yet.', { tone: 'warn' }); return; }
    const d = asDeck(), file = d.deckName.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'deck', kind = /** @type {HTMLElement} */ (b).dataset.bldExp;
    if (kind === 'dek') saveFile(`${file}.dek`, dekXml(d), 'application/xml');
    else if (kind === 'check') saveFile(`${file}-checklist.txt`, checklistText(d));
    else if (kind === 'txt') saveFile(`${file}.txt`, text());
    else { try { await navigator.clipboard.writeText(arenaText(d)); notice('The Arena list is on your clipboard.', { tone: 'good' }); } catch { saveFile(`${file}-arena.txt`, arenaText(d)); } }
  }; });

  // Searches (item 323): the last ten typed, and the ones kept with the star, offered under the field
  const SEARCHES = 'ct.builderSearches';
  const searches = () => { const v = store(SEARCHES) || {}; return { recent: Array.isArray(v.recent) ? v.recent : [], kept: Array.isArray(v.kept) ? v.kept : [] }; };
  const showSearches = () => {
    const v = searches(), q = $('bldQuery').value.trim();
    $('bldHistory').innerHTML = [...v.kept.map(x => [x, 'kept']), ...v.recent.filter(x => !v.kept.includes(x)).map(x => [x, 'recent'])].map(([x, k]) => `<option value="${esc(x)}" label="${k === 'kept' ? '★ ' : ''}${esc(x)}"></option>`).join('');
    const on = !!q && v.kept.includes(q);
    $('bldKeep').textContent = on ? '★' : '☆';
    $('bldKeep').setAttribute('aria-pressed', String(on));
    $('bldKeep').disabled = !q;
  };
  function recall(text) {
    const q = String(text || '').trim();
    if (!q) return;
    const v = searches();
    v.recent = [q, ...v.recent.filter(x => x !== q)].slice(0, 10);
    store(SEARCHES, v);
    showSearches();
  }
  $('bldKeep').onclick = () => {
    const q = $('bldQuery').value.trim();
    if (!q) return;
    const v = searches();
    v.kept = v.kept.includes(q) ? v.kept.filter(x => x !== q) : [q, ...v.kept].slice(0, 20);
    store(SEARCHES, v);
    showSearches();
  };
  $('bldQuery').addEventListener('input', showSearches);
  showSearches();

  // Basic lands (item 315): a split by the deck's colored mana symbols, shown before anything is added
  const BASICS = { W: 'Plains', U: 'Island', B: 'Swamp', R: 'Mountain', G: 'Forest' };
  let landPlan = null;
  $('bldLandsBox').open = false; $('bldLandsSay').textContent = ''; $('bldLandsGo').hidden = true;
  $('bldLandsPlan').onclick = () => {
    landPlan = null; $('bldLandsGo').hidden = true;
    const all = [...deck.values()].filter(e => e.main + e.cmd > 0);
    const size = all.reduce((a, e) => a + e.main + e.cmd, 0), have = all.filter(e => isLand(e.card)).reduce((a, e) => a + e.main, 0);
    const usual = f.lands || Math.round((f.deck || 60) * 0.37);
    const room = f.deck && f.exact ? f.deck - size : Infinity;
    const want = Math.max(0, Math.min(usual - have, room));
    if (!size) { $('bldLandsSay').textContent = 'Add some spells first: the split follows their mana symbols.'; return; }
    if (!want) { $('bldLandsSay').textContent = usual - have <= 0 ? `The deck has ${have} lands; ${usual} is usual for ${f.name}. Nothing to add.` : `The deck is full (${size} cards) with ${have} lands; ${usual} is usual for ${f.name}.`; return; }
    const pips = { W: 0, U: 0, B: 0, R: 0, G: 0 };
    for (const e of all) if (!isLand(e.card)) for (const [, c] of (e.card.manaCost || '').matchAll(/\{([WUBRG])(?:\/[WUBRGP])?\}/g)) pips[c] += e.main + e.cmd;
    let total = Object.values(pips).reduce((a, b) => a + b, 0);
    // (no colored symbols yet: the commander's colors, evenly; none at all: Wastes)
    if (!total) { for (const e of all.filter(x => x.cmd)) for (const c of e.card.colorIdentity || []) if (c in pips) pips[c] = 1; total = Object.values(pips).reduce((a, b) => a + b, 0); }
    const plan = [];
    if (!total) plan.push(['Wastes', want]);
    else {
      const parts = Object.entries(pips).filter(([, n]) => n).map(([c, n]) => ({ c, exact: (n / total) * want, n: Math.floor((n / total) * want) }));
      let left = want - parts.reduce((a, x) => a + x.n, 0);
      for (const x of [...parts].sort((a, b) => (b.exact - b.n) - (a.exact - a.n))) { if (left-- <= 0) break; x.n++; }
      for (const x of parts) if (x.n) plan.push([BASICS[x.c], x.n]);
    }
    landPlan = plan;
    $('bldLandsSay').textContent = `${have} land${have === 1 ? '' : 's'} now; ${usual} is usual for ${f.name}. Add ${want}: ${plan.map(([name, n]) => `${n} ${name}`).join(', ')}.`;
    $('bldLandsGo').hidden = false;
  };
  $('bldLandsGo').onclick = async () => {
    const plan = landPlan;
    if (!plan) return;
    $('bldLandsGo').hidden = true;
    $('bldLandsSay').innerHTML = '<span class="rune" aria-hidden="true"></span>Looking the lands up…';
    try {
      const { cards, key } = await fetchCollection(plan.map(([name]) => ({ name })));
      let added = 0;
      for (const [name, n] of plan) { const c = cards.get(key({ name })); if (c) { add(c, 'main', n); added += n; } }
      renderDeck();
      landPlan = null;
      $('bldLandsSay').textContent = `Added ${added} basic land${added === 1 ? '' : 's'}. Undo takes them out again.`;
    } catch (err) { $('bldLandsSay').textContent = `Couldn't look them up: ${err.message}`; $('bldLandsGo').hidden = false; }
  };

  // Add a list (item 314): names looked up together; what isn't found is reported, nothing is guessed
  $('bldPasteBox').open = false; $('bldPaste').value = ''; $('bldPasteStatus').textContent = '';
  $('bldPaste').onkeydown = e => e.stopPropagation();
  $('bldPasteGo').onclick = async () => {
    const want = new Map();
    for (const raw of $('bldPaste').value.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || /^(about|commander|deck|main|mainboard|sideboard|companion|name |folder |tags |colors |bracket |notes |\/\/|#)/i.test(line)) continue;
      const m = line.match(/^(\d+)\s*x?\s+(.+)$/i);
      const name = (m ? m[2] : line).replace(/\s+\([A-Za-z0-9]{2,6}\)(\s+\S+)?$/, '').trim();
      if (name) want.set(name.toLowerCase(), { name, qty: (want.get(name.toLowerCase())?.qty || 0) + (m ? Math.max(1, Math.min(99, +m[1])) : 1) });
    }
    if (!want.size) { $('bldPasteStatus').textContent = 'No card names found in that.'; return; }
    $('bldPasteStatus').innerHTML = '<span class="rune" aria-hidden="true"></span>Looking the cards up…';
    try {
      const list = [...want.values()];
      const { cards, key } = await fetchCollection(list.map(x => ({ name: x.name })));
      const lost = [];
      let added = 0;
      for (const x of list) { const c = cards.get(key({ name: x.name })); if (c) { add(c, 'main', x.qty); added += x.qty; } else lost.push(x.name); }
      renderDeck();
      $('bldPasteStatus').textContent = `Added ${added} card${added === 1 ? '' : 's'}.${lost.length ? ` Not found: ${lost.join(', ')}.` : ''}`;
      if (!lost.length) $('bldPaste').value = ''; else $('bldPaste').value = lost.join('\n');
    } catch (err) { $('bldPasteStatus').textContent = `Couldn't look them up: ${err.message}`; }
  };

  // Test hand (item 321): seven random cards from the main deck, with mulligans and draws
  let sample = null;
  $('bldHandBox').open = false; $('bldHand').innerHTML = ''; $('bldHandSay').textContent = '';
  $('bldHandMull').disabled = $('bldHandDraw').disabled = true;
  const showHand = () => {
    if (!sample) return;
    const pic = (c, drawn) => `<span class="hand-card ${drawn ? 'drawn' : ''}" title="${esc(c.name)} · ${esc(c.typeLine)}">${c.imgSmall ? `<img class="gf-card" src="${esc(c.imgSmall)}" alt="${esc(c.name)}" loading="lazy">` : `<span class="gf-card hand-name">${esc(c.name)}</span>`}</span>`;
    $('bldHand').innerHTML = sample.hand.map(c => pic(c, false)).join('') + sample.drawn.map(c => pic(c, true)).join('');
    const lands = sample.hand.filter(isLand).length;
    $('bldHandSay').textContent = `${lands} land${lands === 1 ? '' : 's'} in seven${sample.mulligans ? ` · mulligan ${sample.mulligans}: put ${sample.mulligans} on the bottom` : ''}${sample.drawn.length ? ` · ${sample.drawn.length} drawn` : ''}`;
    $('bldHandMull').disabled = false; $('bldHandDraw').disabled = false;
  };
  $('bldHandNew').onclick = () => {
    const cards = [...deck.values()].filter(e => e.main).map(e => ({ card: e.card, qty: e.main }));
    if (cards.reduce((a, x) => a + x.qty, 0) < 7) { $('bldHandSay').textContent = 'The deck needs at least seven cards.'; return; }
    sample = sampleHands({ cards });
    showHand();
  };
  $('bldHandMull').onclick = () => { sample?.mulligan(); showHand(); };
  $('bldHandDraw').onclick = () => { sample?.draw(); showHand(); };

  $('bldCopy').onclick = async () => { try { await navigator.clipboard.writeText(text()); $('bldStatus').textContent = 'The list is on your clipboard.'; } catch { $('bldStatus').textContent = 'Couldn\'t reach the clipboard.'; } };
  $('bldClose').onclick = () => { root.hidden = true; };
  $('bldInspect').classList.remove('open');
  $('bldStats').classList.remove('settled');
  inspect(null);
  const draft = store(DRAFT);
  let ready = false;
  renderDeck();
  ready = true;
  if (!opts.deck && draft?.list?.length && draft.format === opts.format) {
    notice(`You have an unsaved deck from ${whenText(draft.at)}.`, {
      ms: 20000,
      action: { label: 'Restore it', run: () => {
        let lost = 0;
        for (const [name, main, side, cmd] of draft.list) {
          const src = draft.cards?.[name];
          if (!src) { lost++; continue; }
          const card = normalize(src);
          if (main) add(card, 'main', main);
          if (side) add(card, 'side', side);
          if (cmd) add(card, 'cmd', cmd);
        }
        if (draft.name && !$('bldName').value) $('bldName').value = draft.name;
        renderDeck();
        $('bldStatus').textContent = lost ? `Your unsaved deck is back, except ${lost} card${lost === 1 ? '' : 's'} whose data was not kept.` : 'Your unsaved deck is back.';
      } },
    });
  }
  root.hidden = false;
  // (results from an earlier opening belong to another search: start fresh)
  $('bldResults').innerHTML = '';
  search();
  setTimeout(() => $('bldQuery').focus(), 0);
  return { text };
}
