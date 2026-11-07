// First-run tour: a few steps that point at the main controls. Shown once (remembered in the browser
// profile) and reopened with the Tour button. Steps whose control isn't on screen are skipped.
const STEPS = [
  { sel: '#seats', title: 'Four seats', text: 'Each seat takes a deck: paste a list, a link (Archidekt, Moxfield bookmarklet, MTGGoldfish, EDHTop16…), "random", or leave it empty for a random deck. The menu next to the name picks who plays it: an AI style, you, or a friend online.' },
  { sel: '#tableBracket', title: 'Brackets', text: "Commander Brackets 1–5 shape random decks and how sharply the AI plays. Every loaded deck also shows its estimated bracket, and Commander Spellbook's." },
  { sel: '#btnCedh', title: 'Quick tables', text: 'Seat four competitive decks, browse the real tournament meta from EDHTop16, or deal a table of random decks from one bracket.' },
  { sel: '#btnLoad', title: 'Start a game', text: 'Loads the four decks (card data and art from Scryfall, kept for offline play) and shuffles up. Use the timeline to pause, step, rewind or save the game as a replay.' },
  { sel: '#btnBatch', title: 'Batch and tournaments', text: 'Play many games at full speed to compare decks: win rates, game speed, which combos land, and which cards show up in wins. Every deck also learns from its games.' },
  { sel: '#btnLobby', title: 'Play with friends', text: 'Set a seat to "A friend plays this seat", open the lobby, and send the link, QR code or join code. It works on your home network, or over the internet through a free Cloudflare tunnel.' },
  { sel: '#btnPuzzles', title: 'More ways to play', text: 'Win-this-turn puzzles, draft and sealed pods from real sets, a deck library in the game folder, and hotseat games for several people on one PC.' },
  { sel: '#btnDisplay', title: 'Make it yours', text: 'Board backgrounds, colors for color blindness, larger text, and fewer animations. Explain makes the log say why the AI made each play.' },
];

let running = false;
export function startTour(onDone) {
  const steps = STEPS.filter(s => { const el = document.querySelector(s.sel); return el && el.offsetParent; });
  if (!steps.length || running) return;
  running = true;
  let i = 0;
  const shade = document.createElement('div');
  shade.className = 'tour-shade';
  const ring = document.createElement('div');
  ring.className = 'tour-ring';
  const box = document.createElement('div');
  box.className = 'tour-box';
  document.body.append(shade, ring, box);
  const end = () => { running = false; shade.remove(); ring.remove(); box.remove(); window.removeEventListener('resize', show); onDone?.(); };
  function show() {
    const s = steps[i];
    const el = document.querySelector(s.sel);
    el.scrollIntoView({ block: 'nearest' });
    const r = el.getBoundingClientRect();
    Object.assign(ring.style, { left: `${r.left - 6}px`, top: `${r.top - 6}px`, width: `${r.width + 12}px`, height: `${Math.min(r.height, innerHeight * 0.6) + 12}px` });
    box.innerHTML = `<small>${i + 1} of ${steps.length}</small><b>${s.title}</b><p>${s.text}</p>
      <div class="tour-btns"><button class="btn ghost small" data-t="skip">Skip the tour</button>${i ? '<button class="btn small" data-t="back">Back</button>' : ''}<button class="btn primary small" data-t="next">${i === steps.length - 1 ? 'Done' : 'Next'}</button></div>`;
    // Below the control or above it, whichever has room; over its top edge when it fills the screen
    const h = box.offsetHeight || 190;
    const left = Math.max(12, Math.min(r.left, innerWidth - box.offsetWidth - 12));
    let top;
    if (innerHeight - r.bottom >= h + 24) top = r.bottom + 14;
    else if (r.top >= h + 24) top = r.top - h - 14;
    else top = Math.max(12, Math.min(r.top + 12, innerHeight - h - 12));
    Object.assign(box.style, { left: `${left}px`, top: `${top}px`, bottom: 'auto' });
    box.querySelector('[data-t="next"]').focus();
  }
  box.addEventListener('click', e => {
    const t = e.target.closest('[data-t]')?.dataset.t;
    if (t === 'skip') end();
    else if (t === 'back') { i--; show(); }
    else if (t === 'next') { if (++i >= steps.length) end(); else show(); }
  });
  box.addEventListener('keydown', e => { if (e.key === 'Escape') end(); });
  window.addEventListener('resize', show);
  show();
}
