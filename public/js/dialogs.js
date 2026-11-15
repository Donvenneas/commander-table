// Windows, questions and notices (design roadmap items 232, 233, 234).
//
// Windows: every `.modal` in the page is shown and hidden by its `hidden` attribute, from many places. Rather than
// change each of them, this module watches that attribute. When a window opens it is marked as a dialog (role,
// aria-modal, its heading as its name), focus moves into it and Tab stays inside; when it closes, focus goes back to
// where it was. Escape (and a click on the dark backdrop, for windows with nothing typed into them) presses the
// window's own Close or Cancel button, so each window still closes its own way. Windows without such a button
// (pass the device, the results, sideboarding) stay open, as before.
//
// askUser(): the game's own question window in place of the browser's confirm() and prompt().
// notice(): a short message at the bottom left that goes away by itself, in place of alert().
import { esc } from './util.js';

// ---------- windows
/** @type {{ el: HTMLElement, back: Element | null }[]} */
const open = [];
let seq = 0;
const visible = el => !!el && !el.hidden && el.getClientRects().length > 0;
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';
const focusables = el => /** @type {HTMLElement[]} */ ([...el.querySelectorAll(FOCUSABLE)]).filter(visible);
const top = () => open[open.length - 1]?.el || null;
/** Is any window open? (the table's keyboard shortcuts wait while one is) */
export const modalOpen = () => open.length > 0;

function opened(el) {
  if (open.some(x => x.el === el)) return;
  const card = /** @type {HTMLElement} */ (el.querySelector('.modal-card') || el);
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'true');
  const h = card.querySelector('h2');
  if (h) { if (!h.id) h.id = `dlg-title-${++seq}`; card.setAttribute('aria-labelledby', h.id); }
  if (!card.hasAttribute('tabindex')) card.tabIndex = -1;
  open.push({ el, back: document.activeElement });
  syncTabs(el);
  syncSegments(el);
  setTimeout(() => closeMark(el, card), 0);
  // (after the code that opened it has had its say: the deck builder, for one, puts the cursor in its search box)
  setTimeout(() => {
    if (el.hidden || top() !== el || el.contains(document.activeElement)) return;
    const first = /** @type {HTMLElement | null} */ (el.querySelector('[autofocus]'));
    (first && visible(first) ? first : card).focus({ preventScroll: true });
  }, 0);
}
function closed(el) {
  const i = open.findIndex(x => x.el === el);
  if (i < 0) return;
  const [{ back }] = open.splice(i, 1);
  // (focus goes back only when it was left inside the window that closed, or nowhere)
  if (el.contains(document.activeElement) || document.activeElement === document.body || !document.activeElement) {
    const to = /** @type {HTMLElement | null} */ (back);
    if (to?.isConnected && visible(to)) to.focus({ preventScroll: true });
  }
}
// The window's own way out: a button marked data-close, or one whose id says Close or Cancel
// (a head button that only says "Close" is put away once the × stands in for it: .was-close; it still does the closing)
function closer(el) {
  return /** @type {HTMLElement | undefined} */ ([...el.querySelectorAll('[data-close], button[id*="Close"], button[id*="Cancel"]')].find(b => (visible(/** @type {HTMLElement} */ (b)) || b.classList.contains('was-close')) && !(/** @type {HTMLButtonElement} */ (b)).disabled));
}
// The × in the top right corner (item 235): the same place in every window. It presses the window's own Close or
// Cancel, so each window still closes its own way; windows with no way out (pass the device, results) get none.
function closeMark(el, card) {
  if (el.hidden || card.classList.contains('ask-card')) return;
  const own = closer(el);
  let row = card.querySelector(':scope > .modal-x-row');
  if (!own) { row?.remove(); card.classList.remove('has-x'); return; }
  if (!row) {
    row = document.createElement('div');
    row.className = 'modal-x-row';
    row.innerHTML = '<button type="button" class="modal-x" aria-label="Close" data-tip="Close (Esc)"><span aria-hidden="true">×</span></button>';
    /** @type {HTMLElement} */ (row.firstElementChild).onclick = () => closer(el)?.click();
    card.prepend(row);
    card.classList.add('has-x');
  }
  if (own.closest('.modal-head') && /^close$/i.test(own.textContent.trim())) own.classList.add('was-close');
}

let started = false;
export function startModals() {
  if (started || typeof document === 'undefined') return;
  started = true;
  const sync = el => { if (el.hidden) closed(el); else opened(el); };
  document.querySelectorAll('.modal').forEach(sync);
  startTabs();
  syncSegments();
  startTips();
  startMenus();
  new MutationObserver(list => {
    for (const m of list) {
      if (m.type === 'attributes') { const t = /** @type {HTMLElement} */ (m.target); if (t.classList?.contains('modal')) sync(t); }
      else {
        for (const n of m.addedNodes) if (n instanceof HTMLElement && n.classList.contains('modal')) sync(n);
        for (const n of m.removedNodes) if (n instanceof HTMLElement && n.classList.contains('modal')) closed(n);
      }
    }
  }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['hidden'] });

  // Tab stays inside the window on top
  document.addEventListener('keydown', e => {
    const el = top();
    if (!el || e.key !== 'Tab') return;
    const list = focusables(el);
    if (!list.length) { e.preventDefault(); return; }
    const first = list[0], last = list[list.length - 1], at = document.activeElement;
    if (!el.contains(at)) { e.preventDefault(); first.focus(); }
    else if (e.shiftKey && (at === first || at === el.querySelector('.modal-card'))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && at === last) { e.preventDefault(); first.focus(); }
  }, true);
  // Escape presses the top window's Close or Cancel (something inside the window may use Escape first and stop it)
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    const el = top();
    const b = el && closer(el);
    if (b) { e.preventDefault(); b.click(); }
  });
  // On a touch screen the keyboard covers the lower half: bring the field being typed in back into view (item 366)
  document.addEventListener('focusin', e => {
    const t = e.target;
    if (!(t instanceof HTMLElement) || !t.matches('input:not([type=checkbox]):not([type=radio]):not([type=range]), textarea') || !matchMedia('(pointer: coarse)').matches) return;
    setTimeout(() => { if (document.activeElement === t) t.scrollIntoView({ block: 'center', behavior: 'smooth' }); }, 350);
  });
  // A click on the dark backdrop does the same, unless the window holds something typed
  let downOn = null;
  document.addEventListener('mousedown', e => { downOn = e.target; });
  document.addEventListener('click', e => {
    const el = top();
    if (!el || e.target !== el || downOn !== el) return;
    if (el.id === 'builderModal' || el.id === 'setup' || el.querySelector('textarea')) return;
    closer(el)?.click();
  });
}

// ---------- segmented controls (item 243)
// A <select data-seg> with two to four choices is shown as a row of segments instead. The select stays in the page
// (hidden) and keeps its value and its change event, so the code that reads it is untouched.
function syncSegments(root = document.body) {
  for (const sel of /** @type {HTMLSelectElement[]} */ ([...root.querySelectorAll('select[data-seg]')])) {
    let seg = /** @type {HTMLElement | null} */ (sel.nextElementSibling?.classList.contains('seg') ? sel.nextElementSibling : null);
    if (!seg) {
      seg = document.createElement('span');
      seg.className = 'seg';
      seg.setAttribute('role', 'radiogroup');
      seg.setAttribute('aria-label', sel.dataset.seg || sel.getAttribute('aria-label') || '');
      seg.innerHTML = [...sel.options].map(o => `<button type="button" class="seg-b" role="radio" data-v="${esc(o.value)}">${esc(o.textContent || '')}</button>`).join('');
      sel.after(seg);
      sel.classList.add('seg-src');
      sel.tabIndex = -1;
      sel.setAttribute('aria-hidden', 'true');
      const pick = (/** @type {HTMLElement} */ b, focus = false) => { sel.value = b.dataset.v || ''; sel.dispatchEvent(new Event('change', { bubbles: true })); syncSegments(/** @type {HTMLElement} */ (seg.parentElement)); if (focus) b.focus(); };
      seg.addEventListener('click', e => { const b = e.target instanceof Element ? /** @type {HTMLElement | null} */ (e.target.closest('.seg-b')) : null; if (b) { e.preventDefault(); pick(b); } });
      seg.addEventListener('keydown', e => {
        const all = /** @type {HTMLElement[]} */ ([...seg.querySelectorAll('.seg-b')]), i = all.indexOf(/** @type {HTMLElement} */ (document.activeElement));
        const to = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? i + 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? all.length - 1 : null;
        if (to == null || i < 0) return;
        e.preventDefault(); e.stopPropagation();
        pick(all[(to + all.length) % all.length], true);
      });
    }
    for (const b of /** @type {HTMLElement[]} */ ([...seg.querySelectorAll('.seg-b')])) {
      const on = b.dataset.v === sel.value;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    }
  }
}

// ---------- tabs (item 236)
// Rows of tab buttons (.tabs, .prog-tabs) are drawn and switched by their own code, which marks the chosen one with
// a class. This gives them the tab roles, says which is selected, keeps one of them in the Tab order and moves
// between them with the arrow keys, Home and End.
const TABLISTS = '.tabs, .prog-tabs';
const chosen = b => b.classList.contains('active') || b.classList.contains('primary');
function syncTabs(root = document.body) {
  const lists = root.matches?.(TABLISTS) ? [root] : [...root.querySelectorAll(TABLISTS)];
  for (const list of lists) {
    list.setAttribute('role', 'tablist');
    const tabs = /** @type {HTMLElement[]} */ ([...list.querySelectorAll('button')]);
    const on = tabs.find(chosen) || tabs[0];
    for (const b of tabs) {
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(b === on));
      b.tabIndex = b === on ? 0 : -1;
      // (the sidebar's tabs each have their own panel)
      const panel = b.dataset.tab && document.getElementById(`tab-${b.dataset.tab}`);
      if (panel) { if (!b.id) b.id = `tabbtn-${b.dataset.tab}`; b.setAttribute('aria-controls', panel.id); panel.setAttribute('role', 'tabpanel'); panel.setAttribute('aria-labelledby', b.id); }
    }
  }
}
function startTabs() {
  syncTabs();
  const listOf = t => /** @type {HTMLElement | null} */ (t instanceof Element ? t.closest(TABLISTS) : null);
  // (after the tab's own click handler has marked the new one)
  document.addEventListener('click', e => { const list = listOf(e.target); if (list) setTimeout(() => syncTabs(list), 0); });
  document.addEventListener('focusin', e => { const list = listOf(e.target); if (list && list.getAttribute('role') !== 'tablist') syncTabs(list); });
  document.addEventListener('keydown', e => {
    const list = listOf(e.target);
    if (!list || !(e.target instanceof HTMLElement) || e.target.getAttribute('role') !== 'tab') return;
    const tabs = /** @type {HTMLElement[]} */ ([...list.querySelectorAll('[role=tab]')]).filter(visible);
    const i = tabs.indexOf(e.target);
    const to = e.key === 'ArrowRight' ? tabs[(i + 1) % tabs.length] : e.key === 'ArrowLeft' ? tabs[(i - 1 + tabs.length) % tabs.length] : e.key === 'Home' ? tabs[0] : e.key === 'End' ? tabs[tabs.length - 1] : null;
    if (!to) return;
    e.preventDefault(); e.stopPropagation();
    to.focus(); to.click();
  }, true);
}

// ---------- menus (item 237)
// <span class="menu"><button class="menu-btn" aria-haspopup="menu">…</button><div class="menu-list" role="menu" hidden>
// …buttons or links…</div></span>. The entries are ordinary buttons with their own ids and click handlers; this only
// opens and closes the list, places it under its button (fixed, so nothing clips it), and gives it the keys a menu
// has: Down/Up/Home/End move, Escape closes and returns to the button, a click on an entry or anywhere else closes.
function startMenus() {
  let openList = null;
  const btnOf = list => /** @type {HTMLElement} */ (list.parentElement.querySelector('.menu-btn'));
  const items = list => /** @type {HTMLElement[]} */ ([...list.children]).filter(x => !x.hidden && !(/** @type {any} */ (x)).disabled);
  const close = (refocus = false) => {
    if (!openList) return;
    const list = openList; openList = null;
    list.hidden = true;
    btnOf(list).setAttribute('aria-expanded', 'false');
    if (refocus) btnOf(list).focus();
  };
  const openMenu = (list, focusFirst) => {
    close();
    for (const x of list.children) { x.setAttribute('role', 'menuitem'); (/** @type {HTMLElement} */ (x)).tabIndex = -1; }
    list.hidden = false;
    const b = btnOf(list).getBoundingClientRect();
    list.style.left = `${Math.max(8, Math.min(innerWidth - list.offsetWidth - 8, b.left))}px`;
    list.style.top = `${b.bottom + 4 + list.offsetHeight > innerHeight ? Math.max(8, b.top - list.offsetHeight - 4) : b.bottom + 4}px`;
    btnOf(list).setAttribute('aria-expanded', 'true');
    openList = list;
    if (focusFirst) items(list)[0]?.focus();
  };
  document.addEventListener('click', e => {
    const t = e.target instanceof Element ? e.target : null;
    const b = t?.closest('.menu-btn');
    if (b) {
      const list = /** @type {HTMLElement} */ (b.parentElement.querySelector('.menu-list'));
      // (a click made with the keyboard has no pointer detail: put focus on the first entry)
      if (openList === list) close(); else openMenu(list, e.detail === 0);
      return;
    }
    // (an entry does its own work first; the list closes after)
    if (openList) setTimeout(() => close(), 0);
  });
  document.addEventListener('keydown', e => {
    const t = e.target instanceof HTMLElement ? e.target : null;
    if (!openList) {
      if (t?.classList.contains('menu-btn') && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); e.stopPropagation(); openMenu(/** @type {HTMLElement} */ (t.parentElement.querySelector('.menu-list')), true); }
      return;
    }
    const list = items(openList), i = list.indexOf(/** @type {HTMLElement} */ (document.activeElement));
    const to = e.key === 'ArrowDown' ? list[(i + 1) % list.length] : e.key === 'ArrowUp' ? list[(i - 1 + list.length) % list.length] : e.key === 'Home' ? list[0] : e.key === 'End' ? list[list.length - 1] : null;
    if (to) { e.preventDefault(); e.stopPropagation(); to.focus(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); }
    else if (e.key === 'Tab') close();
  }, true);
  window.addEventListener('resize', () => close());
  document.addEventListener('scroll', e => { if (openList && !(e.target instanceof Node && openList.contains(e.target))) close(); }, { capture: true, passive: true });
}

// ---------- tooltips (item 238)
// The page's hints are `title` attributes, which only a resting mouse ever sees. This shows them in the game's own
// tooltip instead: after a short rest of the mouse, at once when the keyboard lands on something, and on a long
// press on a touch screen. The title is moved to data-tip the first time it is needed (so the browser's own
// tooltip doesn't show as well); a field or a symbol-only button whose title was its only name keeps it as its label.
function startTips() {
  const tip = document.createElement('div');
  tip.className = 'kw-tooltip hint-tip';
  tip.id = 'hintTip';
  tip.setAttribute('role', 'tooltip');
  tip.hidden = true;
  document.body.append(tip);
  let timer = 0, shownFor = null;
  const host = t => /** @type {HTMLElement | null} */ (t instanceof Element ? t.closest('[title], [data-tip]') : null);
  const textOf = el => {
    const t = el.getAttribute('title');
    if (t) {
      el.dataset.tip = t;
      el.removeAttribute('title');
      const named = el.hasAttribute('aria-label') || el.hasAttribute('aria-labelledby') || (!el.matches('input, select, textarea') && /[\p{L}\p{N}]/u.test(el.textContent || '')) || !!el.closest('label');
      if (!named) el.setAttribute('aria-label', t);
    }
    return el.dataset.tip || '';
  };
  const hide = () => {
    clearTimeout(timer);
    if (shownFor) { if (shownFor.getAttribute('aria-describedby') === tip.id) shownFor.removeAttribute('aria-describedby'); shownFor = null; }
    tip.hidden = true;
  };
  const show = el => {
    const text = textOf(el);
    if (!text || !el.isConnected || !visible(el)) return;
    tip.textContent = text;
    tip.hidden = false;
    const b = el.getBoundingClientRect();
    tip.style.left = `${Math.max(8, Math.min(innerWidth - tip.offsetWidth - 8, b.left + b.width / 2 - tip.offsetWidth / 2))}px`;
    tip.style.top = `${b.bottom + 8 + tip.offsetHeight > innerHeight ? Math.max(8, b.top - tip.offsetHeight - 8) : b.bottom + 8}px`;
    shownFor = el;
    if (!el.hasAttribute('aria-describedby')) el.setAttribute('aria-describedby', tip.id);
  };
  const later = (el, ms) => { clearTimeout(timer); timer = window.setTimeout(() => show(el), ms); };
  document.addEventListener('mouseover', e => {
    const el = host(e.target);
    if (el === shownFor) return;
    hide();
    if (el && textOf(el)) later(el, 450);
  });
  document.addEventListener('mouseout', e => { if (!e.relatedTarget) hide(); });
  document.addEventListener('focusin', e => {
    const el = host(e.target);
    hide();
    // (only for the keyboard: a click also focuses, and the mouse has its own delay)
    if (el && e.target instanceof Element && e.target.matches(':focus-visible') && textOf(el)) later(el, 120);
  });
  document.addEventListener('focusout', hide);
  for (const ev of ['mousedown', 'keydown', 'wheel']) document.addEventListener(ev, hide, { capture: true, passive: true });
  document.addEventListener('scroll', hide, { capture: true, passive: true });
  // Touch: a long press shows the hint for a few seconds
  document.addEventListener('touchstart', e => {
    const el = host(e.target);
    hide();
    if (el && textOf(el)) timer = window.setTimeout(() => { show(el); timer = window.setTimeout(hide, 3500); }, 550);
  }, { passive: true });
  for (const ev of ['touchmove', 'touchcancel']) document.addEventListener(ev, () => { if (tip.hidden) clearTimeout(timer); }, { passive: true });
  document.addEventListener('touchend', () => { if (tip.hidden) clearTimeout(timer); }, { passive: true });
}

// ---------- lists that load, come back empty, or fail (items 239, 240, 241)
/** Grey rows to show while a list is on its way. */
export const loadingRows = (n = 6) => `<div class="skel" role="status" aria-label="Loading">${'<div class="skel-row"><i></i><i></i><i></i></div>'.repeat(n)}</div>`;
/** A list with nothing in it: what that means, and the next step. */
export const emptyState = (title, hint = '') => `<div class="empty-state"><b>${esc(title)}</b>${hint ? `<span>${esc(hint)}</span>` : ''}</div>`;
/** Something could not be fetched. The caller wires the "Try again" button (`[data-retry]`) to its own loader. */
export const errorBox = (title, detail = '') => `<div class="empty-state error" role="alert"><b>${esc(title)}</b>${detail ? `<span>${esc(detail)}</span>` : ''}<button class="btn small" data-retry>Try again</button></div>`;

// ---------- questions
let askEl = null;
/**
 * Ask the person a yes/no question, or (with opts.input) for a line of text.
 * @param {string} text the question
 * @param {{ title?: string, confirm?: string, cancel?: string, danger?: boolean, input?: string | true, placeholder?: string }} [opts]
 * @returns {Promise<any>} yes/no questions: true or false. With opts.input: the text, or null when cancelled.
 */
export function askUser(text, opts = {}) {
  startModals();
  if (!askEl) {
    askEl = document.createElement('div');
    askEl.className = 'modal ask-modal';
    askEl.hidden = true;
    document.body.append(askEl);
  }
  const el = askEl;
  const wantsText = opts.input !== undefined;
  return new Promise(resolve => {
    el.innerHTML = `<div class="modal-card results-card ask-card">
      <h2>${esc(opts.title || (wantsText ? 'One thing first' : 'Are you sure?'))}</h2>
      <p id="askText">${esc(text)}</p>
      ${wantsText ? `<input class="input" id="askInput" aria-labelledby="askText" maxlength="300" autocomplete="off" placeholder="${esc(opts.placeholder || '')}" autofocus>` : ''}
      <div class="modal-foot"><button class="btn ghost" data-close data-ask="no" ${wantsText ? '' : 'autofocus'}>${esc(opts.cancel || 'Cancel')}</button><button class="btn primary ${opts.danger ? 'danger' : ''}" data-ask="yes">${esc(opts.confirm || 'OK')}</button></div></div>`;
    const input = /** @type {HTMLInputElement | null} */ (el.querySelector('#askInput'));
    if (input && typeof opts.input === 'string') { input.value = opts.input; setTimeout(() => input.select(), 0); }
    const done = yes => {
      el.onclick = null; el.onkeydown = null;
      const answer = wantsText ? (yes ? (input ? input.value : '') : null) : yes;
      el.hidden = true;
      resolve(answer);
    };
    el.onclick = e => { const b = /** @type {HTMLElement} */ (e.target).closest?.('[data-ask]'); if (b instanceof HTMLElement) done(b.dataset.ask === 'yes'); };
    el.onkeydown = e => { e.stopPropagation(); if (e.key === 'Enter' && (e.target === input)) { e.preventDefault(); done(true); } else if (e.key === 'Escape') { e.preventDefault(); done(false); } };
    el.hidden = false;
  });
}

// ---------- notices
let tray = null;
/**
 * Show a short message that goes away by itself.
 * @param {string} text
 * @param {{ tone?: '' | 'good' | 'bad' | 'warn', ms?: number, action?: { label: string, run: () => void } }} [opts]
 */
export function notice(text, opts = {}) {
  if (typeof document === 'undefined') return;
  if (!tray) {
    tray = document.createElement('div');
    tray.className = 'notices';
    tray.setAttribute('role', 'status');
    tray.setAttribute('aria-live', 'polite');
    document.body.append(tray);
  }
  const n = document.createElement('div');
  n.className = `notice ${opts.tone || ''}`;
  n.innerHTML = `<span>${esc(text)}</span>${opts.action ? `<button class="btn small" data-n="act">${esc(opts.action.label)}</button>` : ''}<button class="notice-x" data-n="x" aria-label="Dismiss">×</button>`;
  let timer = 0;
  const gone = () => { clearTimeout(timer); n.classList.add('out'); setTimeout(() => n.remove(), 250); };
  // (longer messages stay longer; the clock stops while the pointer or the keyboard is on it)
  const ms = opts.ms || Math.min(12000, 4000 + text.length * 45);
  const arm = () => { clearTimeout(timer); timer = window.setTimeout(gone, ms); };
  for (const ev of ['mouseenter', 'focusin']) n.addEventListener(ev, () => clearTimeout(timer));
  for (const ev of ['mouseleave', 'focusout']) n.addEventListener(ev, arm);
  n.onclick = e => { const b = /** @type {HTMLElement} */ (e.target).closest?.('[data-n]'); if (!(b instanceof HTMLElement)) return; if (b.dataset.n === 'act') opts.action?.run(); gone(); };
  tray.append(n);
  while (tray.children.length > 4) tray.firstElementChild?.remove();
  arm();
}
