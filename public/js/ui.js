// Playtester-style table view: four boards, a stack spotlight, a game log and card previews.
import { PHASES } from './engine.js';
import { describeFx, droppedSentences } from './effects.js';
import { STYLES } from './ai.js';
import { combosFor, RESULT_TEXT } from './combos.js';
import { esc, symbolize, cardFace } from './util.js';
import { Rules } from './rules.js';
import { preview as battlePreview } from './combatai.js';
import { Fx, motionOff } from './fx.js';
import { Music } from './music.js';
import { currentLang, cardInLanguage } from './i18n.js';
import { roleChip } from './kingdomsPlay.js';

const HIDPI = window.devicePixelRatio > 1.4;
const ICON = {
  hand: '<svg viewBox="0 0 16 16"><rect x="2" y="3" width="7" height="10" rx="1" fill="none" stroke="currentColor"/><rect x="7" y="2" width="7" height="10" rx="1" fill="currentColor" opacity=".5"/></svg>',
  library: '<svg viewBox="0 0 16 16"><rect x="3" y="2" width="10" height="12" rx="1.5" fill="none" stroke="currentColor"/><path d="M5 5h6M5 8h6" stroke="currentColor"/></svg>',
  graveyard: '<svg viewBox="0 0 16 16"><path d="M4 14V7a4 4 0 0 1 8 0v7z" fill="none" stroke="currentColor"/><path d="M8 7v4M6.5 8.5h3" stroke="currentColor"/></svg>',
  exile: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor"/><path d="M4.2 11.8 11.8 4.2" stroke="currentColor"/></svg>',
};

export class TableView {
  constructor(game, els) {
    this.g = game;
    this.els = els;
    this.cards = new Map();
    this.boards = [];
    this.revealHands = false;
    /** @type {number} the seat played on this PC (set by main.js), -1 for none */
    this.humanIdx = -1;
    this.zoneShown = '';
    this.pending = false;
    this.lastTurnLogged = null;
    els.table.innerHTML = '';
    els.log.innerHTML = '';
    /** @type {{ el: HTMLElement, n: Record<string, number> } | null} the turn the log is in (item 288) */
    this.logTurn = null;
    if (!els.log.dataset.folds) {
      // (once per page: a click, Enter or Space on a turn's heading folds or opens that turn)
      els.log.dataset.folds = '1';
      const head = ev => { const t = ev.target instanceof Element && !ev.target.closest('a, .cn, .glossary') ? /** @type {HTMLElement | null} */ (ev.target.closest('.le.turn')) : null; return t; };
      els.log.addEventListener('click', ev => { const t = head(ev); if (t) foldTurn(t, !t.classList.contains('folded')); });
      els.log.addEventListener('keydown', ev => { const t = head(ev); if (t && ev.target === t && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); ev.stopPropagation(); foldTurn(t, !t.classList.contains('folded')); } });
    }
    // (5 to 9 boards: a wider grid; see .table[data-n] in the stylesheet)
    els.table.dataset.n = game.players.length;
    for (const p of game.players) this.boards.push(this.buildBoard(p));
    // While fast-forwarding a replay, skip animations and sounds
    const live = () => !game.clock.ff;
    game.on('update', () => this.schedule());
    game.on('log', e => { this.addLog(e); if (live()) Sound.forLog(e.kind); });
    game.on('life', d => { if (live()) this.floatLife(d); });
    game.on('hit', d => {
      const el = this.cards.get(d.iid);
      if (!el || !live()) return;
      el.classList.remove('hit'); void el.offsetWidth; el.classList.add('hit');
      this.floatOn(el, `-${d.n}`, 'dmg');
      Fx.burst(el, '#ff5d6c', 'hit');
    });
    // Spell casts flare from the caster's portrait; life gained glows green; combos light up the table
    game.on('cast', ({ p }) => { if (live() && game.clock.speed !== 4) { const av = this.boards[p.idx]?.el.querySelector('.avatar'); if (av) Fx.burst(av, p.color, 'cast'); } });
    game.on('life', d => { if (live() && d.d > 0) Fx.burst(this.boards[d.p]?.life, '#3ecf8e', 'heal'); });
    game.on('combo', d => { if (live() && d.stage === 'resolve') Fx.burst(els.table, d.p.color, 'combo'); });
    Fx.ambient(els.table.parentElement, true);
    game.on('move', d => { if (live() && this.g.clock.speed !== 4 && !motionOff()) this.animateMove(d); });
    game.on('battle', d => { if (live()) { this.battle(d); Sound.combat(); } });
    game.on('combo', d => { if (live()) this.comboBanner(d); });
    game.on('turn', p => { if (live() && this.g.clock.speed !== undefined && this.g.clock.speed < 4 && !motionOff()) this.turnBanner(p); });
    game.on('turn', p => { if (live() && document.body.classList.contains('follow')) this.boards[p.idx]?.el.scrollIntoView({ block: 'nearest', behavior: motionOff() ? 'auto' : 'smooth' }); if (live() && p.idx === this.humanIdx) Sound.play('yourTurn'); });
    document.querySelectorAll('.combo-banner, .combat-svg, .turn-banner').forEach(e => e.remove());
    this.banner = document.createElement('div');
    this.banner.className = 'combo-banner';
    this.banner.hidden = true;
    els.table.after(this.banner);
    // The stack: everything waiting to resolve, newest (resolves first) on top
    document.querySelectorAll('.stack-panel').forEach(e => e.remove());
    this.stackPanel = document.createElement('div');
    this.stackPanel.className = 'stack-panel';
    this.stackPanel.hidden = true;
    els.table.after(this.stackPanel);
    const aimAt = (/** @type {Event} */ ev, on) => {
      const row = ev.target instanceof Element ? /** @type {HTMLElement | null} */ (ev.target.closest('.sp-item')) : null;
      document.querySelectorAll('.aimed').forEach(x => x.classList.remove('aimed'));
      if (!row || !on) return;
      for (const t of (row.dataset.aim || '').split(' ').filter(Boolean)) {
        const el = t[0] === 'o' ? this.cards.get(+t.slice(1)) : this.boards[+t.slice(1)]?.el.querySelector('.avatar');
        el?.classList.add('aimed');
      }
    };
    this.stackPanel.addEventListener('mouseover', ev => aimAt(ev, true));
    this.stackPanel.addEventListener('mouseleave', ev => aimAt(ev, false));
    this.render();
  }

  // Battle preview: every attacker with its blockers and what the combat simulation expects to happen.
  // It stays up until combat damage is dealt (click to close it sooner).
  battle({ p, attackers }) {
    document.querySelectorAll('.battle-panel').forEach(e => e.remove());
    if (!attackers.length) return;
    const g = this.g;
    const rows = battlePreview(g, attackers);
    const img = (o, cls = '') => `<div class="bp-card ${cls}" style="--pc:${g.players[o.controller].color}" data-iid="${o.iid}">
        ${o.card.imgNormal ? `<img decoding="async" src="${esc(o.card.imgNormal)}" alt="${esc(o.card.name)}">` : `<div class="tkn" style="background-image:url('${esc(o.card.art || '')}')"><b>${esc(o.card.name)}</b></div>`}
        <span class="bp-pt">${g.power(o)}/${g.toughness(o) - o.damage}</span></div>`;
    const panel = document.createElement('div');
    panel.className = 'battle-panel';
    panel.style.setProperty('--pc', p.color);
    const shown = rows.slice(0, 6);
    panel.innerHTML = `<div class="bp-head"><span class="bp-swords">⚔</span> <b>${esc(p.name)}</b> attacks with ${rows.length} creature${rows.length === 1 ? '' : 's'}</div>
      <div class="bp-rows">${shown.map(r => {
        const def = g.players[r.target];
        return `<div class="bp-row">
          <div class="bp-side">${img(r.a, r.dies ? 'dies' : 'lives')}</div>
          <div class="bp-vs">${r.blockers.length ? '<span class="bp-clash">VS</span>' : '<span class="bp-arrow">➜</span>'}</div>
          <div class="bp-side bp-def">${r.blockers.length ? r.blockers.map((b, k) => img(b, r.blockersDie[k] ? 'dies' : 'lives')).join('') : `<div class="bp-player" style="--pc:${def.color}"><b>${esc(def.name)}</b><span>${def.life} life</span></div>`}</div>
          <div class="bp-out">${r.damage ? `<span class="bp-dmg" style="--pc:${def.color}">−${r.damage} ${esc(def.name)}</span>` : ''}${r.dies ? '<span class="bp-ko">attacker falls</span>' : ''}${r.blockersDie.filter(Boolean).length ? `<span class="bp-ko">${r.blockersDie.filter(Boolean).length === 1 ? 'blocker falls' : `${r.blockersDie.filter(Boolean).length} blockers fall`}</span>` : ''}${!r.damage && !r.dies && !r.blockersDie.some(Boolean) ? '<span class="bp-held">held off</span>' : ''}</div>
        </div>`;
      }).join('')}${rows.length > shown.length ? `<div class="bp-more">and ${rows.length - shown.length} more</div>` : ''}</div>
      <div class="bp-foot">Expected result · click to close</div>`;
    panel.addEventListener('click', () => panel.remove());
    document.body.append(panel);
    // Clash effects on each pairing
    if (!motionOff()) requestAnimationFrame(() => {
      for (const r of shown) {
        const el = this.cards.get(r.a.iid);
        if (el) Fx.burst(el, g.players[r.a.controller].color, r.blockers.length ? 'clash' : 'charge');
      }
    });
    // Closes once combat is over (see render), or on a click
    this.battlePanel = panel;
  }

  // A number floating up from a card (damage)
  floatOn(el, text, cls) {
    const r = el.getBoundingClientRect();
    if (!r.width) return;
    const f = document.createElement('span');
    f.className = `card-float ${cls}`;
    f.textContent = text;
    Object.assign(f.style, { left: `${r.left + r.width / 2}px`, top: `${r.top + r.height * 0.35}px` });
    document.body.append(f);
    setTimeout(() => f.remove(), 1100);
  }

  // Draws slide a card back from the library count into the hand; deaths, exiles and discards leave a
  // fading copy where the card was, heading for its owner's graveyard or exile count
  animateMove({ iid, owner, from, to, died }) {
    const b = this.boards[owner];
    if (!b) return;
    const ghost = (fromRect, toRect, cls, html) => {
      if (!fromRect?.width || !toRect?.width) return;
      const gEl = document.createElement('div');
      gEl.className = `move-ghost ${cls}`;
      gEl.innerHTML = html;
      Object.assign(gEl.style, { left: `${fromRect.left}px`, top: `${fromRect.top}px`, width: `${fromRect.width}px`, height: `${fromRect.height}px` });
      document.body.append(gEl);
      const dx = toRect.left + toRect.width / 2 - (fromRect.left + fromRect.width / 2), dy = toRect.top + toRect.height / 2 - (fromRect.top + fromRect.height / 2);
      gEl.animate([{ transform: 'translate(0,0) scale(1)', opacity: 1 }, { transform: `translate(${dx}px,${dy}px) scale(.35)`, opacity: 0.15 }],
        { duration: 650, easing: 'cubic-bezier(.4,.1,.3,1)' }).onfinish = () => gEl.remove();
      // (1.55.0) a hidden window pauses animations: the copy goes anyway, so none pile up over the table
      setTimeout(() => gEl.remove(), 1500);
    };
    const counter = z => b.n[z]?.parentElement?.getBoundingClientRect();
    if (from === 'library' && to === 'hand') {
      const lib = counter('library');
      const hand = b.hand.getBoundingClientRect();
      ghost(lib && { left: lib.left, top: lib.top, width: 26, height: 36 }, { left: hand.left + hand.width / 2, top: hand.top, width: 26, height: 36 }, 'draw', '<span class="back"></span>');
      return;
    }
    const el = this.cards.get(iid);
    if (!el?.isConnected || !['graveyard', 'exile'].includes(to)) return;
    if (died) Fx.burst(el, '#ff8a5c', 'death');
    const img = el.querySelector('img');
    const html = img ? `<img decoding="async" src="${img.getAttribute('src')}" alt="">` : el.innerHTML;
    ghost(el.getBoundingClientRect(), counter(to === 'exile' ? 'exile' : 'graveyard'), died ? 'dies' : to === 'exile' ? 'exiled' : 'discard', html);
  }

  comboBanner({ p, combo, stage }) {
    const b = this.banner;
    const title = { start: 'Going for a combo', loop: 'The loop begins (opponents can still respond)', resolve: `Combo: ${RESULT_TEXT[combo.result]}`, fizzle: 'Combo stopped' }[stage];
    b.className = `combo-banner ${stage}`;
    b.style.setProperty('--pc', p.color);
    b.innerHTML = `<small>${esc(p.name)} · ${esc(title)}</small><b>${esc(combo.label)}</b>`;
    b.hidden = false;
    clearTimeout(this.bannerTimer);
    this.bannerTimer = setTimeout(() => { b.hidden = true; }, stage === 'start' || stage === 'loop' ? 6000 : 3500);
  }

  buildBoard(p) {
    const el = document.createElement('div');
    el.className = 'board';
    el.dataset.player = p.idx;
    el.style.setProperty('--pc', p.color);
    const cmd = p.command[0]?.card;
    if (cmd?.art) el.style.setProperty('--art', `url("${cmd.art}")`);
    el.innerHTML = `
      <div class="bhead">
        <div class="avatar" data-n="${p.idx + 1}" style="background-image:url(&quot;${p.avatar || cmd?.art || p.art || ''}&quot;)"></div>
        <div class="who" title="${esc(p.deckName)}">
          <div class="pname">${esc(p.name)} <span class="style-badge">${STYLES[p.style] || p.style}</span></div>
        </div>
        <div class="mana"></div>
        <div class="life"><small>LIFE</small><span class="lv">40</span></div>
      </div>
      <div class="cmdchips"></div>
      <div class="bbody">
        <div class="cmdzone"><div class="zlabel">Command</div><div class="zone-command"></div><div class="tax"></div></div>
        <div class="field">
          <div class="row creatures" data-label="Creatures"></div>
          <div class="row others" data-label="Artifacts · Enchantments · Planeswalkers"></div>
          <div class="row lands" data-label="Lands"></div>
        </div>
      </div>
      <div class="handbar">
        <div class="handrow"></div>
        <div class="piles">
          <button class="pile lib" data-zone="library" title="Library: click to see how many cards are left (and the top card, when you may look at it)"><span class="pimg"></span><b class="n-library">0</b><small>Library</small></button>
          <button class="pile gy" data-zone="graveyard" title="Graveyard: click to look through it"><span class="pimg"></span><b class="n-graveyard">0</b><small>Graveyard</small></button>
          <button class="pile ex" data-zone="exile" title="Exile: click to look through it"><span class="pimg"></span><b class="n-exile">0</b><small>Exile</small></button>
          <b class="n-hand" hidden>0</b>
        </div>
      </div>`;
    el.querySelectorAll('[data-zone]').forEach(b => b.addEventListener('click', () => this.openZone(p, b.dataset.zone)));
    this.els.table.append(el);
    const q = s => el.querySelector(s);
    return {
      el, p, life: q('.life'), lv: q('.lv'), mana: q('.mana'), chips: q('.cmdchips'), command: q('.zone-command'), tax: q('.tax'),
      creatures: q('.creatures'), others: q('.others'), lands: q('.lands'), hand: q('.handrow'),
      n: { hand: q('.n-hand'), library: q('.n-library'), graveyard: q('.n-graveyard'), exile: q('.n-exile') },
      pile: { graveyard: q('.pile.gy .pimg'), exile: q('.pile.ex .pimg') },
      elim: null,
    };
  }

  schedule() {
    if (this.pending) return;
    this.pending = true;
    const run = () => { if (!this.pending) return; this.pending = false; this.render(); };
    requestAnimationFrame(run);
    setTimeout(run, 120); // rAF is paused in background tabs
  }

  cardEl(o, small = false) {
    let el = this.cards.get(o.iid);
    // (a card turned face down or face up is drawn again)
    if (el && el.dataset.cname !== o.card.name) { el.remove(); el = null; }
    if (!el) {
      el = document.createElement('div');
      el.className = 'card enter';
      el.dataset.iid = o.iid;
      el.dataset.cname = o.card.name;
      const src = HIDPI ? o.card.imgNormal : o.card.imgSmall;
      if (o.faceDown) {
        // Face down: a card back; its controller (or "Reveal hands") sees what it is
        const peek = this.humanIdx === o.controller || this.revealHands;
        el.classList.add('noimg', 'facedown');
        el.innerHTML = `<div class="tkn fd"><b>Face down${peek ? `<br><small>${esc(o.faceCard.name)}</small>` : ''}</b></div>`;
        if (peek) el.title = `${o.faceCard.name} (face down: ${o.faceDown})`;
      } else if (src) {
        const img = new Image();
        img.src = src; img.alt = o.card.name; img.draggable = false; img.decoding = 'async';
        // (1.55.0) a picture that fails, even before the card is on screen, gives way to the card's face in words
        // (the page-wide fallback in util.js handles it first when the card is already on screen)
        img.addEventListener('error', () => { if (!img.parentElement) return; const d = document.createElement('div'); d.className = 'img-fallback'; d.innerHTML = cardFace(o.card); img.replaceWith(d); el.classList.add('noimg-failed'); });
        el.append(img);
      } else {
        el.classList.add('noimg');
        el.innerHTML = `<div class="tkn" style="background-image:url('${o.card.art || ''}')"><b>${esc(o.card.name)}</b></div>`;
      }
      const b = document.createElement('div');
      b.className = 'badges';
      el.append(b);
      setTimeout(() => el.classList.remove('enter'), 500);
      this.cards.set(o.iid, el);
    }
    const g = this.g;
    const onBf = o.zone === 'battlefield';
    el.classList.toggle('tapped', onBf && o.tapped);
    el.classList.toggle('attacking', onBf && o.attacking != null);
    el.classList.toggle('blocking', onBf && o.blocking != null);
    el.classList.toggle('sick', onBf && o.sick && o.fx.type.creature);
    el.classList.toggle('commander', o.isCommander);
    let badges = '';
    if (onBf && o.fx.type.creature) {
      const p = g.power(o), t = g.toughness(o);
      const bp = g.basePower(o.card), bt = g.baseToughness(o.card);
      const cls = p + t > bp + bt ? 'up' : p + t < bp + bt ? 'down' : '';
      if (o.damage) badges += `<span class="bdg dmg">-${o.damage}</span>`;
      badges += `<span class="bdg pt ${cls}">${p}/${t}</span>`;
    }
    if (onBf && o.counters) badges += o.counters > 0 ? `<span class="bdg ctr" title="+1/+1 counters">+${o.counters}</span>` : `<span class="bdg ctr neg" title="-1/-1 counters">${o.counters}</span>`;
    if (onBf && o.fx.type.planeswalker) badges += `<span class="bdg loy">${o.loyalty}</span>`;
    if (onBf && o.fx.type.battle && o.defense != null) badges += `<span class="bdg loy" title="Defense counters${o.protector != null ? ` (protected by ${esc(g.players[o.protector]?.name || '')})` : ''}">⛨${o.defense}</span>`;
    if (onBf && o.attachedTo) badges += `<span class="bdg att" title="Attached to ${esc(o.attachedTo.card.name)}">⛓</span>`;
    if (onBf) {
      // States from keywords: shields, goad, time/age counters, crewed vehicles, end-of-turn returns
      if (o.regen > 0) badges += `<span class="bdg st" title="Regeneration shield${o.regen > 1 ? ` ×${o.regen}` : ''}">🛡</span>`;
      if (o.goaded && o.goaded.until >= g.turn) badges += `<span class="bdg st" title="Goaded by ${esc(g.players[o.goaded.by]?.name || '')}: must attack someone else">🎯</span>`;
      if (o.timeCounters > 0) badges += `<span class="bdg st" title="${o.fx.kwN?.fading ? 'Fade' : 'Time'} counters">⏳${o.timeCounters}</span>`;
      if (o.age > 0) badges += `<span class="bdg st" title="Age counters (cumulative upkeep)">⌛${o.age}</span>`;
      if (o.crewed) badges += '<span class="bdg st" title="Crewed: a creature until end of turn">⚙</span>';
      if (o.dashed || o.blitzed || o.unearthed) badges += `<span class="bdg st" title="${o.dashed ? 'Dashed: returns to hand' : o.blitzed ? 'Blitzed: sacrificed' : 'Unearthed: exiled'} at end of turn">⌛</span>`;
      if (o.monstrous) badges += '<span class="bdg st" title="Monstrous">👹</span>';
      if (o.chosenType) badges += `<span class="bdg st" title="Chosen creature type">${esc(o.chosenType)}</span>`;
      if (o.permKw?.size) badges += `<span class="bdg st" title="Keyword counters: ${esc([...o.permKw].join(', '))}">✦${o.permKw.size}</span>`;
      if (g.dormant?.(o)) badges += '<span class="bdg st" title="Not a creature until devotion is high enough">💤</span>';
      if (o.animPT?.turn === g.turn && !o.card.power) badges += '<span class="bdg st" title="Animated until end of turn">⚡</span>';
    }
    const bEl = el.lastChild;
    if (bEl.dataset.v !== badges) { bEl.innerHTML = badges; bEl.dataset.v = badges; }
    // For screen readers: the card's name and what can be seen of its state. A face-down card keeps its secret
    // unless this screen may look at it. (A card the person can choose is a button with its own label: human.js)
    if (el.getAttribute('role') !== 'button') {
      const peek = this.humanIdx === o.controller || this.revealHands;
      const bits = [o.faceDown ? (peek ? `${o.faceCard.name}, face down` : 'Face-down card') : o.card.name];
      if (onBf) {
        if (o.isCommander) bits.push('commander');
        if (o.fx.type.creature && !g.dormant?.(o)) bits.push(`${g.power(o)}/${g.toughness(o)}`);
        if (o.fx.type.planeswalker) bits.push(`loyalty ${o.loyalty}`);
        if (o.tapped) bits.push('tapped');
        if (o.attacking != null) bits.push('attacking');
        if (o.blocking != null) bits.push('blocking');
        if (o.sick && o.fx.type.creature) bits.push('summoning sick');
        if (o.damage) bits.push(`${o.damage} damage`);
        if (o.counters) bits.push(`${o.counters > 0 ? '+' : ''}${o.counters} counters`);
        if (o.attachedTo) bits.push(`attached to ${o.attachedTo.card.name}`);
      }
      const say = bits.join(', ');
      if (el.getAttribute('aria-label') !== say) { el.setAttribute('role', 'img'); el.setAttribute('aria-label', say); }
    }
    return el;
  }

  sync(container, objs, opts = {}) {
    let i = 0;
    let prevName = null, runStart = null, runLen = 0, prevKey = null;
    const endRun = () => { if (runStart) { if (runLen > 1) runStart.dataset.count = `×${runLen}`; else delete runStart.dataset.count; } };
    for (const o of objs) {
      const el = this.cardEl(o);
      const key = opts.stackBy ? opts.stackBy(o) : null;
      const same = opts.stack ? prevName === o.card.name : !!key && key === prevKey;
      el.classList.toggle('stacked', same);
      if (opts.stackBy) { if (same) runLen++; else { endRun(); runStart = el; runLen = 1; } if (!same) delete el.dataset.count; }
      prevName = o.card.name;
      prevKey = key;
      if (container.children[i] !== el) {
        // A card moving between zones (hand → battlefield, creature row → another player) glides there
        const from = el.isConnected && el.parentElement !== container && !this.g.clock.ff && !motionOff() ? el.getBoundingClientRect() : null;
        container.insertBefore(el, container.children[i] || null);
        if (from && from.width) {
          const to = el.getBoundingClientRect();
          const dx = from.left - to.left, dy = from.top - to.top;
          if (Math.abs(dx) + Math.abs(dy) > 4) el.animate([{ translate: `${dx}px ${dy}px` }, { translate: '0 0' }], { duration: 380, easing: 'cubic-bezier(.2,.7,.2,1)' });
        }
      }
      i++;
    }
    if (opts.stackBy) endRun();
    while (container.children.length > i) container.lastChild.remove();
  }

  render() {
    const g = this.g;
    const ap = g.players[g.active];
    this.els.turnLabel.textContent = g.turn ? `Turn ${g.turn} · Round ${g.round} · ${ap.name}` : g.phase === 'setup' ? 'Shuffling up…' : 'Ready';
    // (item 287) built once, then updated in place so a step keeps the keyboard focus; steps you can set a stop at
    // are buttons, and the stops chosen for the next game show as dots (main.js keeps them in data-stops)
    const track = this.els.phaseTrack;
    track.style.setProperty('--pc', ap?.color);
    if (track.children.length !== PHASES.length + 1) {
      track.innerHTML = PHASES.map(([k, l]) => STOP_AT[k]
        ? `<button type="button" class="ph" data-phase="${k}" data-stop-key="${STOP_AT[k]}">${l}<i class="ph-dots" aria-hidden="true"><i></i><i></i></i></button>`
        : `<span class="ph" data-phase="${k}">${l}</span>`).join('') + '<span class="ph-who"></span>';
    }
    const stopSet = new Set((track.dataset.stops || '').split(' '));
    PHASES.forEach(([k, l], i) => {
      const el = /** @type {HTMLElement} */ (track.children[i]), on = !!g.turn && g.phase === k, key = STOP_AT[k];
      el.classList.toggle('on', on);
      if (on) el.setAttribute('aria-current', 'step'); else el.removeAttribute('aria-current');
      if (!key) return;
      const my = stopSet.has('my' + key), opp = stopSet.has('opp' + key);
      el.classList.toggle('stop-my', my); el.classList.toggle('stop-opp', opp);
      const say = my && opp ? 'stops on every turn' : my ? 'stops on your turns' : opp ? "stops on opponents' turns" : 'no stop';
      if (el.dataset.say !== say) { el.dataset.say = say; el.dataset.tip = `${l}: ${say}. Click to change (from the next game).`; el.setAttribute('aria-label', `${l}: ${say}`); }
    });
    const who = /** @type {HTMLElement} */ (track.lastElementChild);
    const decider = g.over || !g.turn ? null : g.players.find(p => !p.lost && (p.agent?.waiting ?? p.agent?.ui?.waiting) && !p.agent?.ui?.offline);
    const whoSay = decider ? `${decider.name} to decide` : '';
    if (who.textContent !== whoSay) { who.textContent = whoSay; who.style.setProperty('--dc', decider?.color || ''); }

    for (const b of this.boards) {
      const p = b.p;
      b.el.classList.toggle('active', g.active === p.idx && !g.over && g.turn > 0);
      b.lv.textContent = p.life;
      b.life.classList.toggle('low', p.life <= 10);
      b.lifeLog ||= [{ turn: 0, life: g.startLife ?? p.life }];
      if (b.lifeLog[b.lifeLog.length - 1].life !== p.life) {
        const lastLog = b.lifeLog[b.lifeLog.length - 1];
        // (several changes in one turn are one line: where the turn began and where it stands)
        if (lastLog.turn === g.turn && b.lifeLog.length > 1) lastLog.life = p.life; else b.lifeLog.push({ turn: g.turn, life: p.life });
        if (b.lifeLog.length > 1 && b.lifeLog[b.lifeLog.length - 1].life === b.lifeLog[b.lifeLog.length - 2].life) b.lifeLog.pop();
      }
      if (!b.life.hasAttribute('tabindex')) { b.life.tabIndex = 0; b.life.setAttribute('role', 'button'); b.life.dataset.tip = 'Click for the changes to this life total, turn by turn'; }
      b.life.setAttribute('aria-label', `${p.name}: ${p.life} life. Show the changes.`);
      for (const z of ['hand', 'library', 'graveyard', 'exile']) b.n[z].textContent = p[z].length;
      // The graveyard and exile piles show their top card
      for (const z of ['graveyard', 'exile']) {
        const top = p[z][p[z].length - 1];
        const key = top ? top.iid : '';
        if (b.pile[z].dataset.v === String(key)) continue;
        const grew = b.pile[z].dataset.v !== undefined && !!top;
        b.pile[z].dataset.v = key;
        b.pile[z].style.backgroundImage = top ? `url("${top.card.imgSmall || top.card.art || ''}")` : '';
        const btn = b.pile[z].parentElement;
        btn.classList.toggle('empty', !top);
        btn.title = `${z === 'graveyard' ? 'Graveyard' : 'Exile'}: ${p[z].length} card${p[z].length === 1 ? '' : 's'}${top ? ` · top: ${top.card.name}` : ''} (click to look through it${p === this.g.players[this.humanIdx] ? `, or press ${z === 'graveyard' ? 'G' : 'X'}` : ''})`;
        // A short flash when a card lands on the pile
        if (grew) { btn.classList.remove('flash'); void btn.offsetWidth; btn.classList.add('flash'); }
      }
      b.n.library.parentElement.classList.toggle('empty', !p.library.length);

      const counts = {};
      // (Spirit Guides in hand aren't shown as open mana: they're a card, not a mana source on the table)
      for (const u of g.units(p)) { if (u.guide || !u.colors.length) continue; const k = u.colors.length > 1 ? 'any' : u.colors[0]; counts[k] = (counts[k] || 0) + 1; }
      const manaHtml = Object.entries(counts).map(([k, n]) => `<span class="pip">${k === 'any' ? '<i class="anypip" title="Any color"></i>' : symbolize(`{${k}}`)}${n}</span>`).join('');
      if (b.mana.dataset.v !== manaHtml) { b.mana.innerHTML = manaHtml; b.mana.dataset.v = manaHtml; b.mana.title = 'Untapped mana available'; }

      const politics = roleChip(g, p, this.humanIdx, this.revealHands)
        + (g.archenemy === p.idx && !p.lost ? '<span class="polchip arch" title="The other players are focusing this player">🎯 Archenemy</span>' : '')
        + (g.deals || []).filter(d => !d.broken && d.until >= g.round && (d.a === p.idx || d.b === p.idx)).map(d => {
          const other = g.players[d.a === p.idx ? d.b : d.a];
          const left = d.until - g.round;
          return `<span class="polchip" style="--cc:${other.color}" title="Neither attacks the other until the end of round ${d.until}">🤝 ${{ gangUp: 'Allied', noCounter: 'Pact', tribute: 'Tribute' }[d.kind] || 'Truce'} with ${esc(other.name)} · ${left <= 0 ? 'ends this round' : `${left} more round${left === 1 ? '' : 's'}`}</span>`;
        }).join('')
        + (g.monarch === p.idx && !p.lost ? '<span class="polchip monarch" title="The monarch draws a card at their end step. Deal combat damage to them to take the crown.">👑 Monarch</span>' : '')
        + (p.poison > 0 ? `<span class="polchip poison" title="Ten poison counters and this player loses">☠ Poison ${p.poison}/10</span>` : '')
        + (p.pacts || []).map(x => `<span class="polchip pact" title="${esc(x.name)}: pay ${esc(x.cost)} at the next upkeep or lose the game">⚖ Owes ${esc(x.cost)}</span>`).join('')
        + (p.battlefield.length >= 10 && p.battlefield.some(o => o.fx.ascend) ? '<span class="polchip" title="Ten or more permanents with ascend: the city\'s blessing">🏙 Blessing</span>' : '')
        + (p.battlefield.some(o => o.fx.noCastMyTurn) && g.active === p.idx ? '<span class="polchip" title="Opponents can\'t cast spells during this player\'s turn">🔇 No spells</span>' : '')
        + (this.humanIdx === p.idx && p.battlefield.some(o => o.fx.seeTop) && p.library.length ? `<span class="polchip" data-iid="${p.library[p.library.length - 1].iid}" title="The top card of your library">👁 Top: ${esc(p.library[p.library.length - 1].card.name)}</span>` : '')
        + (p.dungeon ? `<span class="polchip" title="Dungeon: ${esc(p.dungeon.name)}${p.dungeonsDone ? ` (${p.dungeonsDone} completed)` : ''}">🏰 ${esc(p.dungeon.room)}</span>` : '')
        + (p.companion?.zone === 'outside' ? `<span class="polchip" data-iid="${p.companion.iid}" title="Companion: {3} puts it into hand once, at sorcery speed">🐾 ${esc(p.companion.card.name)}</span>` : '')
        + (g.initiative === p.idx ? '<span class="polchip" title="Has the initiative: ventures into Undercity each upkeep; combat damage to this player takes it">⚑ Initiative</span>' : '')
        + (g.dayNight && p.idx === g.active ? `<span class="polchip" title="Day or night (daybound and nightbound cards)">${g.dayNight === 'day' ? '☀ Day' : '☾ Night'}</span>` : '');
      // (Phase 2J) who has priority right now, a seat that has conceded and is about to leave, a friend who dropped
      const state = (g.prio && !g.over && g.prio.holder === p.idx && !p.lost ? '<span class="polchip prio" title="This player has priority: they may respond, or pass">◆ Priority</span>' : '')
        + (p.conceded && !p.lost ? '<span class="polchip" title="This player has conceded and leaves the game now">🏳 Conceding</span>' : '')
        + (p.agent.ui?.offline && !p.agent.ui?.replayOnly && !p.lost ? '<span class="polchip" title="This friend\'s page has stopped checking in. Reopening their link rejoins the seat.">⚠ Disconnected</span>' : '');
      const chips = state + politics + Object.entries(p.cmdDamage).map(([iid, n]) => {
        const src = g.objects.get(+iid);
        const owner = g.players[src.owner];
        return `<span class="cmdchip ${n >= (g.format?.cmdDamage || 21) - 6 ? 'hot' : ''}" style="--cc:${owner.color}" data-iid="${iid}" title="Commander damage from ${esc(src.card.name)}">⚔ ${esc(src.card.name.split(',')[0])} ${n}/${g.format?.cmdDamage || 21}</span>`;
      }).join('');
      if (b.chips.dataset.v !== chips) { b.chips.innerHTML = chips; b.chips.dataset.v = chips; }

      this.sync(b.command, p.command);
      const taxes = p.command.map(o => p.castCount[o.iid] ? `Tax +${2 * p.castCount[o.iid]}` : '').filter(Boolean).join(' · ');
      b.tax.textContent = taxes;

      const bf = p.battlefield;
      // (identical tokens sit together, so they can be drawn as one overlapped pile with a count: item 121)
      const tokenKey = o => (o.token && !o.counters && !o.attachedTo && o.attacking == null && o.blocking == null && !o.damage ? `${o.card.name}|${o.tapped ? 1 : 0}|${g.power(o)}/${g.toughness(o)}` : null);
      const creatures = bf.filter(o => o.fx.type.creature).map((o, i) => ({ o, i, k: tokenKey(o) }))
        .sort((a, c) => (a.k && c.k ? a.k.localeCompare(c.k) : 0) || (a.k ? 1 : 0) - (c.k ? 1 : 0) || a.i - c.i).map(x => x.o);
      const lands = bf.filter(o => o.fx.type.land && !o.fx.type.creature).sort((a, c) => a.card.name.localeCompare(c.card.name) || a.tapped - c.tapped);
      const others = bf.filter(o => !o.fx.type.creature && !(o.fx.type.land && !o.fx.type.creature));
      const n = creatures.length + others.length;
      // (larger in the Display window's "Larger text and cards" mode)
      const cw = n > 50 ? 34 : n > 34 ? 38 : n > 22 ? 44 : n > 16 ? 50 : n > 10 ? 58 : 66;
      b.el.style.setProperty('--cw', `${Math.round(cw * (document.body.classList.contains('big') ? 1.2 : 1) * (g.players.length === 2 ? 1.25 : 1) * (+document.body.dataset.cardScale || 1))}px`);
      this.sync(b.creatures, creatures, { stackBy: tokenKey });
      this.sync(b.others, others);
      this.sync(b.lands, lands, { stack: true });

      // Your own hand is always face up
      const reveal = this.revealHands || p.idx === this.humanIdx;
      b.el.classList.toggle('you', p.idx === this.humanIdx);
      // A person (you or a friend online) is deciding something for this seat
      b.el.classList.toggle('thinking', !!p.agent.ui?.waiting && !p.agent.ui?.offline);
      b.el.classList.toggle('offline', !!p.agent.ui?.offline);
      // An online friend's time bank (turn clock) and, while they're deciding, a Nudge button
      const ui = p.agent.ui;
      if (ui?.clockMode && ui.clockMode !== 'off') {
        let c = b.el.querySelector('.tclock');
        if (!c) { c = document.createElement('span'); c.className = 'tclock'; b.el.querySelector('.who').append(c); }
        const s = Math.max(0, Math.round(ui.bankLeft?.() ?? ui.bank ?? 0));
        c.innerHTML = `⏱ ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}${ui.waiting && !ui.offline ? ' <button class="btn small nudge" title="Remind them it\'s their decision">Nudge</button>' : ''}`;
        c.classList.toggle('low', s < 30);
        const mark = s <= 10 ? '10' : s <= 30 ? '30' : '';
        if (mark && c.dataset.said !== mark && ui.waiting) { const sr = document.getElementById('srLog'); if (sr) sr.textContent = `${p.name} has ${mark} seconds left on the clock.`; }
        c.dataset.said = mark;
        const nb = c.querySelector('.nudge');
        if (nb) nb.onclick = e => { e.stopPropagation(); ui.nudge?.(); nb.disabled = true; nb.textContent = 'Nudged'; };
      }
      if (reveal) {
        if (!b.hand.querySelector('.zlabel')) b.hand.innerHTML = '<span class="zlabel">Hand</span>';
        const label = b.hand.firstChild;
        let i = 1;
        for (const o of p.hand) {
          const el = this.cardEl(o);
          if (b.hand.children[i] !== el) b.hand.insertBefore(el, b.hand.children[i] || null);
          i++;
        }
        while (b.hand.children.length > i) b.hand.lastChild.remove();
        label.textContent = p.idx === this.humanIdx ? 'Your hand' : 'Hand';
      } else {
        const key = `backs${p.hand.length}`;
        if (b.hand.dataset.v !== key) {
          b.hand.innerHTML = `<span class="zlabel">Hand · ${p.hand.length}</span>` + '<span class="back"></span>'.repeat(Math.min(p.hand.length, 15));
          b.hand.dataset.v = key;
        }
      }
      if (reveal) b.hand.dataset.v = '';

      const showElim = p.lost || (g.over && g.winner === p);
      if (showElim && !b.elim) {
        b.elim = document.createElement('div');
        b.el.append(b.elim);
      }
      if (b.elim) {
        b.elim.className = `elim ${g.winner === p ? 'winner' : ''}`;
        b.elim.innerHTML = g.winner === p ? `🏆 Winner<small>${esc(p.name)} · ${p.life} life</small>` : `Eliminated · ${ordinal(p.place)}<small>${esc(p.lossReason)}</small>`;
        b.elim.hidden = !showElim;
      }
    }
    this.renderSpotlight();
    this.drawCombat();
    // The battle preview fades out when combat damage has been dealt
    if (this.battlePanel?.isConnected && !g.players.some(p => p.battlefield.some(o => o.attacking != null))) {
      const bp = this.battlePanel;
      this.battlePanel = null;
      bp.classList.add('closing');
      setTimeout(() => bp.remove(), 350);
    }
  }

  // Arrows from each attacker to the player (or planeswalker or battle) it's attacking, dashed lines from blockers,
  // and dotted arrows from each spell or ability on the stack to its targets
  drawCombat() {
    const wrap = this.els.table.parentElement;
    if (!this.svg) {
      this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      this.svg.setAttribute('class', 'combat-svg');
      wrap.append(this.svg);
    }
    const g = this.g;
    const attackers = g.players.flatMap(p => p.battlefield.filter(o => o.attacking != null));
    const targeting = g.stack.filter(it => (it.targets || []).some(Boolean));
    if ((!attackers.length && !targeting.length) || g.clock.ff) { if (this.svg.innerHTML) this.svg.innerHTML = ''; return; }
    const base = wrap.getBoundingClientRect();
    const center = el => { const r = el.getBoundingClientRect(); return [r.left + r.width / 2 - base.left, r.top + r.height / 2 - base.top]; };
    let html = '';
    for (const o of attackers) {
      const el = this.cards.get(o.iid), board = this.boards[o.attacking];
      if (!el?.isConnected || !board) continue;
      // Aim at the defender's portrait, which is always visible (the life box can be squeezed on small boards)
      const aimed = o.attackingObj?.zone === 'battlefield' ? this.cards.get(o.attackingObj.iid) : null;
      const [x1, y1] = center(el), [x2, y2] = center(aimed?.isConnected ? aimed : board.el.querySelector('.avatar'));
      const mx = (x1 + x2) / 2 + (y2 - y1) * 0.15, my = (y1 + y2) / 2 - (x2 - x1) * 0.15;
      const color = g.players[o.controller].color;
      html += `<path d="M${x1},${y1} Q${mx},${my} ${x2},${y2}" stroke="${color}" marker-end="url(#ah-${o.controller})"/>`;
      for (const b of o.blockedBy) {
        const be = this.cards.get(b.iid);
        if (!be?.isConnected) continue;
        const [bx, by] = center(be);
        html += `<path class="block" d="M${bx},${by} L${x1},${y1}"/>`;
      }
    }
    // (stack targets: from the item's row in the stack panel, or its card, to each target)
    const rows = this.stackPanel?.querySelectorAll('.sp-item') || [];
    [...g.stack].reverse().forEach((it, i) => {
      const from = rows[i] || this.cards.get(it.o.iid);
      if (!from?.isConnected) return;
      for (const t of (it.targets || []).filter(Boolean)) {
        const to = t.obj ? this.cards.get(t.obj.iid) : t.player != null ? this.boards[t.player]?.el.querySelector('.avatar') : null;
        if (!to?.isConnected) continue;
        const [x1, y1] = center(from), [x2, y2] = center(to);
        html += `<path class="target" d="M${x1},${y1} L${x2},${y2}" stroke="${it.p.color}" marker-end="url(#ah-${it.p.idx})"/>`;
      }
    });
    const defs = g.players.map(p => `<marker id="ah-${p.idx}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${p.color}" stroke="none"/></marker>`).join('');
    html = `<defs>${defs}</defs>${html}`;
    if (this.svg.innerHTML !== html) this.svg.innerHTML = html;
  }

  turnBanner(p) {
    const wrap = this.els.table.parentElement;
    wrap.querySelector('.turn-banner')?.remove();
    const b = document.createElement('div');
    b.className = 'turn-banner';
    b.style.setProperty('--pc', p.color);
    b.innerHTML = `<small>Turn ${this.g.turn}</small>${esc(p.name)}`;
    wrap.append(b);
    setTimeout(() => b.remove(), 1700);
  }

  renderSpotlight() {
    const items = this.g.stack;
    const html = items.map(it => `<div class="spot ${it.countered ? 'countered' : ''}" style="--pc:${it.p.color}" data-iid="${it.o.iid}">
      <img decoding="async" src="${it.o.card.imgNormal || ''}" alt="${esc(it.o.card.name)}">
      <div class="cap">${it.ability ? `${esc(it.o.card.name)}: ${esc(String(it.label).slice(0, 48))}` : `${esc(it.p.name)} casts ${esc(it.o.card.name)}`}</div></div>`).join('');
    if (this.els.spotlight.dataset.v !== html) { this.els.spotlight.innerHTML = html; this.els.spotlight.dataset.v = html; }
    this.renderStackPanel();
    if (this.g.stack.length) this.drawCombat();
  }

  renderStackPanel() {
    const g = this.g;
    const items = [...g.stack].reverse();
    const waiting = g.queue?.length || 0;
    // (Phase 2G) each object says whether it's a spell, an activated ability or a triggered ability; the top one is
    // marked as resolving next; the footer says who has priority and how many have passed in a row (rules 15)
    const KIND = { spell: 'Spell', ability: 'Ability', trigger: 'Trigger' };
    const pr = g.prio && g.players[g.prio.holder];
    const prioLine = pr && items.length ? `<div class="sp-prio">Priority: <b style="color:${pr.color}">${esc(pr.name)}</b>${g.prio.passes ? ` · ${g.prio.passes} passed` : ''}</div>` : '';
    const html = !items.length && !waiting ? '' : `<div class="sp-head">Stack · ${items.length}<span>resolves top first</span></div>
      ${items.map((it, i) => {
        const tg = (it.targets || []).filter(Boolean).map(t => g.tname(t)).filter(Boolean);
        const kind = KIND[it.kind] || (it.ability ? 'Ability' : 'Spell');
        const aim = (it.targets || []).filter(Boolean);
        const art = it.o.card.art || it.o.card.imgSmall;
        return `<div class="sp-item ${it.countered ? 'countered' : ''} ${i === 0 && !it.countered ? 'next' : ''}" style="--pc:${it.p.color}" data-iid="${it.o.iid}" data-aim="${aim.map(t => t.obj ? `o${t.obj.iid}` : t.player != null ? `p${t.player}` : '').join(' ')}">
          <span class="sp-n">${i + 1}</span><span class="sp-art">${art ? `<img decoding="async" src="${esc(art)}" alt="">` : ''}${i === 0 && !it.countered ? '<em>Next</em>' : ''}</span><span class="sp-text"><b>${esc(it.o.card.name)}</b>${it.ability ? ` <i>${esc(String(it.label || 'ability').slice(0, 40))}</i>` : ''}
          <small><span class="sp-kind">${kind}</span> · ${esc(it.p.name)}${tg.length ? ` → ${tg.map(t => { const d = document.createElement('div'); d.innerHTML = t; return esc(d.textContent); }).join(', ')}` : ''}${it.countered ? ' · countered' : i === 0 ? ' · resolves next' : ''}</small></span></div>`;
      }).join('')}${prioLine}${waiting ? `<div class="sp-wait">${waiting} trigger${waiting === 1 ? '' : 's'} waiting to go on the stack</div>` : ''}`;
    if (this.stackPanel.dataset.v === html) return;
    this.stackPanel.dataset.v = html;
    this.stackPanel.innerHTML = html;
    this.stackPanel.hidden = !html;
  }

  addLog(e) {
    const log = this.els.log;
    // (screen readers hear what other players do: casts, combat, removal, eliminations, the win; Display chooses
    // how much: item 248. One sentence an event, with mana symbols said by name rather than skipped.)
    const how = document.body.dataset.reader || '';
    const read = how === 'all' ? e.kind !== 'why' && e.kind !== 'minor'
      : how === 'combat' ? ['combat', 'damage', 'loss', 'win'].includes(e.kind)
      : ['cast', 'combat', 'damage', 'removal', 'loss', 'combo', 'win'].includes(e.kind) && (how !== 'mine' || e.kind === 'win' || e.kind === 'loss' || this.g.active === this.humanIdx);
    if (read) {
      const sr = document.getElementById('srLog');
      if (sr && !this.g.clock.ff) sr.textContent = plainText(e.html);
    }
    const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 60;
    const div = document.createElement('div');
    div.className = `le ${e.kind}`;
    if (e.p != null) div.style.setProperty('--pc', this.g.players[e.p].color);
    // Every seat the line is about (for the log's seat filter)
    const who = new Set([...e.html.matchAll(/data-p="(\d)"/g)].map(m => m[1]));
    if (e.p != null) who.add(String(e.p));
    div.dataset.seats = [...who].join(' ');
    let thumb = '';
    if (e.kind === 'cast' || e.kind === 'death' || e.kind === 'removal') {
      const m = /data-iid="(\d+)"/.exec(e.html), o = m ? this.g.objects.get(+m[1]) : null;
      const art = o?.card.art || o?.card.imgSmall;
      if (art) thumb = `<img decoding="async" class="le-thumb" src="${esc(art)}" alt="" loading="lazy" data-iid="${o.iid}">`;
    }
    if (thumb) div.classList.add('has-thumb');
    div.innerHTML = thumb + Rules.glossify(e.html) + (e.rule ? `<a class="rule" data-rule="${e.rule}" title="Comprehensive Rules ${e.rule}">${e.rule}</a>` : '');
    // (item 288) a turn's heading folds its lines away; when the next turn starts, the one before gets a one-line
    // summary, and is folded if "Fold turns" is on. The lines stay in the log, so the filters and search still work.
    if (e.kind === 'turn') {
      this.endLogTurn();
      div.tabIndex = 0;
      div.setAttribute('role', 'button');
      div.setAttribute('aria-expanded', 'true');
      div.insertAdjacentHTML('beforeend', '<span class="le-sum"></span>');
      this.logTurn = { el: div, n: {} };
    } else if (this.logTurn) this.logTurn.n[e.kind] = (this.logTurn.n[e.kind] || 0) + 1;
    log.append(div);
    while (log.children.length > 2500) log.firstChild.remove();
    if (atBottom) log.scrollTop = log.scrollHeight;
  }

  // The turn that just ended gets its summary (casts, combat, deaths, eliminations)
  endLogTurn() {
    const t = this.logTurn;
    this.logTurn = null;
    if (!t || !t.el.isConnected) return;
    const n = t.n, parts = [], add = (k, one, many) => { if (n[k]) parts.push(`${n[k]} ${n[k] === 1 ? one : many}`); };
    add('land', 'land', 'lands'); add('cast', 'spell', 'spells');
    if (n.combat) parts.push('combat');
    add('death', 'died', 'died'); add('removal', 'removed', 'removed'); add('combo', 'combo', 'combos'); add('loss', 'player out', 'players out');
    const sum = t.el.querySelector('.le-sum');
    if (sum) sum.textContent = parts.join(' · ');
    if (document.body.classList.contains('log-fold')) foldTurn(t.el, true);
  }

  floatLife({ p, d }) {
    const b = this.boards[p];
    const f = document.createElement('span');
    f.className = `float ${d < 0 ? 'neg' : 'pos'}`;
    f.textContent = d > 0 ? `+${d}` : d;
    b.life.append(f);
    setTimeout(() => f.remove(), 1300);
  }

  openZone(p, zone) {
    const names = { hand: 'Hand', graveyard: 'Graveyard', exile: 'Exile', library: 'Library' };
    this.els.zoneTitle.textContent = `${p.name} — ${names[zone]} (${p[zone].length})`;
    const grid = this.els.zoneCards;
    grid.innerHTML = '';
    // A library stays hidden; only its top card shows, when its owner may look at it (Courser of Kruphix…)
    let list = [...p[zone]].reverse();
    if (zone === 'library') {
      const top = p.library[p.library.length - 1];
      const mayLook = top && (p.battlefield.some(o => o.fx.seeTop) && (this.humanIdx === p.idx || this.revealHands));
      list = mayLook ? [top] : [];
      grid.innerHTML = `<p class="muted">${p.library.length} card${p.library.length === 1 ? '' : 's'} left, face down.${mayLook ? ' The top card:' : ''}</p>`;
      if (!mayLook) { this.els.zoneModal.hidden = false; return; }
    }
    // (item 291) Filter by name or type, and order: as the zone lies (newest on top), by name, by type or by mana value
    const filter = /** @type {HTMLInputElement | null} */ (document.getElementById('zoneFilter')), sort = /** @type {HTMLSelectElement | null} */ (document.getElementById('zoneSort'));
    const tools = document.getElementById('zoneTools');
    if (tools) tools.hidden = zone === 'library' || list.length < 2;
    const draw = () => {
      const q = (filter?.value || '').trim().toLowerCase();
      const by = sort?.value || '';
      let shown = list.filter(o => !q || o.card.name.toLowerCase().includes(q) || (o.card.typeLine || '').toLowerCase().includes(q));
      if (by === 'name') shown = [...shown].sort((x, y) => x.card.name.localeCompare(y.card.name));
      else if (by === 'type') shown = [...shown].sort((x, y) => (x.card.typeLine || '').localeCompare(y.card.typeLine || '') || x.card.name.localeCompare(y.card.name));
      else if (by === 'mv') shown = [...shown].sort((x, y) => (x.card.cmc || 0) - (y.card.cmc || 0) || x.card.name.localeCompare(y.card.name));
      grid.innerHTML = '';
      for (const o of shown) {
        const el = document.createElement('div');
        el.className = 'card';
        el.dataset.iid = o.iid;
        el.setAttribute('role', 'img');
        el.setAttribute('aria-label', o.card.name);
        el.innerHTML = o.card.imgNormal ? `<img src="${o.card.imgNormal}" alt="" loading="lazy" decoding="async">` : `<div class="tkn"><b>${esc(o.card.name)}</b></div>`;
        grid.append(el);
      }
      if (!list.length) grid.innerHTML = '<div class="empty-state"><b>Empty</b><span>No cards in this zone.</span></div>';
      else if (!shown.length) grid.innerHTML = '<div class="empty-state"><b>No card matches</b><span>Clear the filter to see all of them.</span></div>';
    };
    if (filter) { if (zone !== this.zoneShown) filter.value = ''; filter.oninput = draw; filter.onkeydown = e => e.stopPropagation(); }
    if (sort) sort.onchange = draw;
    this.zoneShown = zone;
    if (zone === 'library') {
      for (const o of list) {
        const el = document.createElement('div');
        el.className = 'card';
        el.dataset.iid = o.iid;
        el.innerHTML = o.card.imgNormal ? `<img decoding="async" src="${o.card.imgNormal}" alt="${esc(o.card.name)}">` : `<div class="tkn"><b>${esc(o.card.name)}</b></div>`;
        grid.append(el);
      }
    } else draw();
    this.els.zoneModal.hidden = false;
  }
}

// ---------- sound effects, synthesized with Web Audio (no files to download)
export const Sound = {
  enabled: false,
  // Effects volume 0–1 (Display window; item 127), apart from the music's
  volume: 1,
  ctx: null,
  last: 0,
  // The Sound switch turns the background music on and off with the effects
  setEnabled(on) { this.enabled = on; if (on) Music.start(); else Music.stop(); },
  combat() { if (this.enabled) Music.battle(); },
  tones: {
    cast: [[520, 0.06], [780, 0.08]], land: [[180, 0.07]], combat: [[140, 0.12], [110, 0.12]], damage: [[90, 0.15]],
    removal: [[400, 0.05], [260, 0.1]], death: [[220, 0.08], [150, 0.14]], combo: [[523, 0.08], [659, 0.08], [784, 0.08], [1047, 0.2]],
    win: [[523, 0.12], [659, 0.12], [784, 0.12], [1047, 0.35]], loss: [[300, 0.15], [200, 0.25]], politics: [[660, 0.06], [660, 0.06]],
    yourTurn: [[440, 0.09], [660, 0.16]],
  },
  forLog(kind) { if (this.tones[kind]) this.play(kind); },
  play(kind) {
    if (!this.enabled) return;
    const now = performance.now();
    // Never more than a few sounds a second, even at top speed
    if (now - this.last < 120 && kind !== 'win' && kind !== 'combo') return;
    this.last = now;
    try {
      this.ctx ||= new AudioContext();
      let t = this.ctx.currentTime;
      for (const [freq, dur] of this.tones[kind] || []) {
        const osc = this.ctx.createOscillator(), gain = this.ctx.createGain();
        osc.type = kind === 'damage' || kind === 'combat' ? 'triangle' : 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, 0.12 * this.volume), t + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        osc.connect(gain).connect(this.ctx.destination);
        osc.start(t);
        osc.stop(t + dur + 0.02);
        t += dur * 0.9;
      }
    } catch { /* audio unavailable */ }
  },
};

function ordinal(n) { return n ? `${n}${['th', 'st', 'nd', 'rd'][n % 10 > 3 || Math.floor(n / 10) === 1 ? 0 : n % 10]} place` : ''; }

// ---------- hover preview (works for board cards, log names, zone viewers)
// Card details (items 122 and 123): right-click any card (on the table, in a pile, in the stack panel, or its name in
// the log) for its Oracle text, how the simulator reads each line, and Scryfall's rulings (fetched once, kept for
// offline). Clicking a card name in the log points the card out on the table.
const RULINGS_KEY = 'ct.rulings';
export async function rulingsFor(card) {
  if (!card.id) return [];
  let all = {};
  try { all = JSON.parse(localStorage.getItem(RULINGS_KEY) || '{}'); } catch { all = {}; }
  if (all[card.id]) return all[card.id];
  const { sf } = await import('./scryfall.js');
  const j = await sf(`/cards/${card.id}/rulings`);
  const list = (j.data || []).map(r => ({ d: r.published_at, t: r.comment }));
  all[card.id] = list;
  const ids = Object.keys(all);
  for (const id of ids.slice(0, Math.max(0, ids.length - 300))) delete all[id];
  try { localStorage.setItem(RULINGS_KEY, JSON.stringify(all)); } catch { /* full: shown, not kept */ }
  return list;
}
export function installDetails(getObject, getView) {
  let box = document.getElementById('cardDetails');
  if (!box) {
    box = document.createElement('div');
    box.id = 'cardDetails';
    box.className = 'card-details';
    box.hidden = true;
    document.body.append(box);
    box.addEventListener('click', e => { if (e.target === box || /** @type {any} */ (e.target).closest?.('.cd-close')) box.hidden = true; });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') box.hidden = true; });
  }
  const open = o => {
    const c = o.card;
    // (lines not read at all, then sentences skipped inside lines that were read)
    const unread = new Set([...(o.fx.unread || []), ...droppedSentences(c)]);
    const lines = String(c.fullText || c.text || '').split('\n').filter(Boolean);
    const reads = describeFx(o.fx);
    box.innerHTML = `<div class="cd-panel"><button class="btn small cd-close" aria-label="Close">✕</button>
      <div class="cd-cols">${c.imgNormal ? `<img decoding="async" src="${esc(c.imgNormal)}" alt="${esc(c.name)}">` : ''}
      <div class="cd-text"><h3>${esc(c.name)}</h3><div class="muted">${esc(c.typeLine || '')} ${c.manaCost ? symbolize(c.manaCost) : ''}</div>
      <h4>Oracle text</h4>${lines.map(l => `<p>${Rules.glossify(symbolize(esc(l)))}</p>`).join('') || '<p class="muted">(no text)</p>'}
      <h4>How the simulator reads it</h4>${reads.length ? `<ul>${reads.map(r => `<li>${esc(r)}</li>`).join('')}</ul>` : '<p class="muted">Nothing beyond its type, power and toughness.</p>'}
      ${unread.size ? `<p class="cd-unread">⚠ Not simulated: ${[...unread].map(esc).join(' / ')}</p>` : ''}
      <h4>Rulings</h4><div class="cd-rulings muted">Loading…</div></div></div></div>`;
    box.hidden = false;
    rulingsFor(c).then(list => {
      const el = box.querySelector('.cd-rulings');
      if (!el) return;
      el.classList.remove('muted');
      el.innerHTML = list.length ? list.map(r => `<p><small class="muted">${esc(r.d)}</small> ${esc(r.t)}</p>`).join('') : '<p class="muted">Scryfall has no rulings for this card.</p>';
    }).catch(() => { const el = box.querySelector('.cd-rulings'); if (el) el.textContent = "Couldn't reach Scryfall for the rulings."; });
  };
  document.addEventListener('contextmenu', ev => {
    const t = /** @type {HTMLElement | null} */ (/** @type {any} */ (ev.target).closest?.('[data-iid]'));
    const o = t && getObject(+t.dataset.iid);
    if (!o) return;
    ev.preventDefault();
    open(o);
  });
  document.addEventListener('click', ev => {
    const t = /** @type {HTMLElement | null} */ (/** @type {any} */ (ev.target).closest?.('.le .cn[data-iid]'));
    if (!t) return;
    const el = getView()?.cards.get(+t.dataset.iid);
    if (!el?.isConnected) return;
    el.scrollIntoView({ block: 'nearest', behavior: motionOff() ? 'auto' : 'smooth' });
    el.classList.remove('pointed'); void el.offsetWidth; el.classList.add('pointed');
    setTimeout(() => el.classList.remove('pointed'), 1600);
  });
  return open;
}

// Life history (item 290): click a life total for its changes turn by turn, and commander damage taken
export function installLifeHistory(getView) {
  const pop = document.createElement('div');
  pop.className = 'kw-tooltip life-pop';
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-label', 'Life total history');
  pop.hidden = true;
  document.body.append(pop);
  const show = el => {
    const view = getView(), board = el.closest('.board');
    const b = view?.boards.find(x => x.el === board), p = view?.g.players[+board?.dataset.player];
    if (!b || !p) return;
    const log = b.lifeLog || [];
    const rows = log.slice(1).map((x, i) => { const d = x.life - log[i].life; return `<tr><td>Turn ${x.turn}</td><td class="num">${log[i].life} → ${x.life}</td><td class="num ${d < 0 ? 'bad' : 'good'}">${d > 0 ? '+' : ''}${d}</td></tr>`; }).reverse();
    const cmd = Object.entries(p.cmdDamage || {}).map(([iid, n]) => { const src = view.g.objects.get(+iid); return src ? `<li>${esc(src.card.name)}: ${n} of ${view.g.format?.cmdDamage || 21}</li>` : ''; }).join('');
    pop.innerHTML = `<b>${esc(p.name)}: ${p.life} life</b> <span class="muted">started at ${log[0]?.life ?? ''}</span>
      ${rows.length ? `<table><tbody>${rows.slice(0, 14).join('')}</tbody></table>${rows.length > 14 ? `<div class="muted">and ${rows.length - 14} earlier changes</div>` : ''}` : '<div class="muted">No change yet.</div>'}
      ${cmd ? `<div><b>Commander damage taken</b><ul>${cmd}</ul></div>` : ''}`;
    pop.hidden = false;
    const r = el.getBoundingClientRect();
    pop.style.left = `${Math.max(8, Math.min(innerWidth - pop.offsetWidth - 8, r.right - pop.offsetWidth))}px`;
    pop.style.top = `${r.bottom + 6 + pop.offsetHeight > innerHeight ? Math.max(8, r.top - pop.offsetHeight - 6) : r.bottom + 6}px`;
  };
  document.addEventListener('click', ev => {
    const el = ev.target instanceof Element ? ev.target.closest('.life') : null;
    // (a board being chosen as a target takes the click)
    if (!el || el.closest('.board.pickable')) { pop.hidden = true; return; }
    if (!pop.hidden && pop.dataset.for === el.closest('.board')?.dataset.player) { pop.hidden = true; return; }
    pop.dataset.for = el.closest('.board')?.dataset.player || '';
    show(el);
  });
  document.addEventListener('keydown', ev => {
    if (ev.key === 'Escape' && !pop.hidden) { pop.hidden = true; return; }
    const el = ev.target instanceof Element && ev.target.classList.contains('life') ? ev.target : null;
    if (el && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); ev.stopPropagation(); if (pop.hidden) show(el); else pop.hidden = true; }
  }, true);
}

// A log line as one plain sentence: tags dropped, pictures (mana symbols) replaced by their names
function plainText(html) {
  const d = document.createElement('div');
  d.innerHTML = html;
  d.querySelectorAll('img').forEach(i => i.replaceWith(i.alt ? ` ${i.alt} ` : ''));
  return (d.textContent || '').replace(/\s+/g, ' ').trim();
}
// Fold or open one turn of the log (item 288): its lines up to the next turn heading
export function foldTurn(head, on) {
  head.classList.toggle('folded', on);
  head.setAttribute('aria-expanded', String(!on));
  for (let el = head.nextElementSibling; el && !el.classList.contains('turn'); el = el.nextElementSibling) el.classList.toggle('fold-hide', on);
}

// Steps a seat can ask to stop at (human.js opts.stops: my… on your own turns, opp… on the others')
const STOP_AT = { upkeep: 'Upkeep', draw: 'Draw', combat: 'Combat', end: 'End' };

export function installPreview(getObject) {
  const pv = document.getElementById('preview');
  let current = null, wait = 0, last = null;
  const mode = () => document.body.dataset.preview || 'pointer';
  document.addEventListener('mousemove', ev => { last = ev; }, { passive: true });
  document.addEventListener('mouseover', ev => {
    // (a touch screen's emulated mouse events don't move the docked touch preview)
    if (Date.now() - touchAt < 800) return;
    const t = ev.target.closest('[data-iid]');
    if (!t) { clearTimeout(wait); if (current) { pv.hidden = true; current = null; } return; }
    const o = getObject(+t.dataset.iid);
    if (!o || o === current || mode() === 'off') return;
    // (a short rest first, so sweeping the pointer across the table doesn't flash card after card; none when
    // one preview is already up and the pointer moves to the next card)
    clearTimeout(wait);
    if (pv.hidden) { wait = window.setTimeout(() => { if (t.isConnected && t.matches(':hover')) open(o, last || ev); }, 140); return; }
    open(o, ev);
  });
  // (1.55.0, item 293) Touch: a tap on a card shows its preview docked at the bottom of the screen (a card you can pick
  // is picked by the tap as before; a long press shows its preview instead). A tap on the preview or anywhere else
  // closes it. Nothing here answers a question: picking still goes through the action bar's own click handler.
  let touchAt = 0, pressTimer = 0, pressed = false;
  const touchCard = ev => /** @type {HTMLElement | null} */ (ev.target instanceof Element ? ev.target.closest('[data-iid]') : null);
  document.addEventListener('pointerdown', ev => {
    if (ev.pointerType !== 'touch') return;
    touchAt = Date.now();
    pressed = false;
    clearTimeout(pressTimer);
    const t = touchCard(ev);
    if (!t || t.closest('#preview')) return;
    pressTimer = window.setTimeout(() => { const o = getObject(+t.dataset.iid); if (o && mode() !== 'off') { pressed = true; openTouch(o); } }, 500);
  }, { passive: true });
  for (const e of ['pointerup', 'pointercancel', 'pointermove']) document.addEventListener(e, ev => { const m = /** @type {PointerEvent} */ (ev); if (m.type !== 'pointermove' || Math.abs(m.movementX) + Math.abs(m.movementY) > 6) clearTimeout(pressTimer); }, { passive: true });
  document.addEventListener('click', ev => {
    if (Date.now() - touchAt > 800) return;
    if (pressed) { pressed = false; ev.preventDefault(); ev.stopPropagation(); return; }
    const t = touchCard(ev);
    if (!t || t.closest('#preview')) { if (!pv.hidden) { pv.hidden = true; current = null; pv.classList.remove('touch'); } return; }
    if (t.classList.contains('pickable') || t.closest('.action-bar, button, a')) return;
    const o = getObject(+t.dataset.iid);
    if (o && mode() !== 'off') openTouch(o);
  }, true);
  function openTouch(o) {
    pv.classList.add('touch');
    open(o, null);
  }
  function open(o, ev) {
    current = o;
    pv.innerHTML = previewHtml(o);
    pv.dataset.for = String(o.iid);
    pv.hidden = false;
    if (ev) { pv.classList.remove('touch'); place(ev); } else { pv.style.left = ''; pv.style.top = ''; }
    // In another language: the card's printed name and image in it, when Scryfall has them
    if (currentLang() !== 'en') {
      const shown = o;
      cardInLanguage(o.card).then(x => {
        if (!x || pv.hidden || current !== shown) return;
        const h = pv.querySelector('.ptext h3 span');
        if (x.name && h) h.innerHTML = `${esc(x.name)} <small class="muted">(${esc(shown.card.name)})</small>`;
        const img = pv.querySelector('img.big');
        if (x.img && img) img.src = x.img;
      });
    }
  }
  document.addEventListener('mousemove', ev => { if (!pv.hidden && !pv.classList.contains('touch')) place(ev); });
  function place(ev) {
    // (docked: the stylesheet keeps it in the bottom right corner)
    if (mode() === 'dock') { pv.style.left = ''; pv.style.top = ''; return; }
    const r = pv.getBoundingClientRect();
    let x = ev.clientX + 18, y = ev.clientY - r.height / 2;
    if (x + r.width > innerWidth - 8) x = ev.clientX - r.width - 18;
    y = Math.max(8, Math.min(y, innerHeight - r.height - 8));
    pv.style.left = `${Math.max(8, x)}px`;
    pv.style.top = `${y}px`;
  }
}

function previewHtml(o) {
  const c = o.card;
  const kws = [...o.fx.kw].filter(k => !['unblockable', 'cantblock'].includes(k));
  const kwRules = Rules.loaded ? kws.map(k => Rules.keyword(k)).filter(Boolean) : [];
  const fx = describeFx(o.fx);
  const combos = o.game?.combosFor ? o.game.combosFor(c) : combosFor(c);
  const pt = c.power != null ? `${c.power}/${c.toughness}` : c.loyalty ? `Loyalty ${c.loyalty}` : '';
  return `
    <div class="imgs">
      ${c.imgNormal ? `<img decoding="async" class="big" src="${c.imgNormal}" alt="">` : `<div class="tkn big" style="width:250px;height:349px;background-image:url('${c.art || ''}')"><b>${esc(c.name)}</b></div>`}
      ${c.backNormal ? `<figure class="pv-other"><img decoding="async" class="big" src="${c.backNormal}" alt="The card's other face"><figcaption>Other face</figcaption></figure>` : ''}
    </div>
    <div class="ptext">
      <h3><span>${esc(c.name)}</span><span>${symbolize(c.manaCost || '')}</span></h3>
      <div class="ptype">${esc(c.typeLine)}${pt ? ` · ${esc(pt)}` : ''}</div>
      <div class="oracle">${Rules.glossify(symbolize(c.fullText || c.text || ''))}</div>
      ${fx.length ? `<div class="sec"><h4>Simulator understands</h4><div class="fxl">${fx.map(esc).join('<br>')}</div></div>` : ''}
      ${(() => { const miss = [...(o.fx.unread || []), ...droppedSentences(c)]; return miss.length ? `<div class="sec warn"><h4>⚠ Not simulated</h4><div class="fxl">${miss.map(esc).join('<br>')}</div></div>` : ''; })()}
      ${o.chosenType ? `<div class="sec"><h4>Chosen type</h4><div class="fxl">${esc(o.chosenType)}</div></div>` : ''}
      ${combos.length ? `<div class="sec"><h4>Known combos</h4><div class="fxl">${combos.map(k => `<b>${esc(k.label)}</b>: ${esc(RESULT_TEXT[k.result])}`).join('<br>')}</div></div>` : ''}
      ${kwRules.length ? `<div class="sec"><h4>Rules</h4>${kwRules.map(r => `<div class="kwr"><b>${r.id}</b> ${esc(r.text)}</div>`).join('')}</div>` : ''}
      ${c.set ? `<div class="credit2">${esc(c.setName || c.set.toUpperCase())} #${esc(c.cn)} · Illustrated by ${esc(c.artist || 'unknown')}</div>` : ''}
    </div>`;
}
