// Playtester-style table view: four boards, a stack spotlight, a game log and card previews.
import { PHASES } from './engine.js';
import { describeFx } from './effects.js';
import { STYLES } from './ai.js';
import { combosFor, RESULT_TEXT } from './combos.js';
import { esc, symbolize } from './util.js';
import { Rules } from './rules.js';
import { preview as battlePreview } from './combatai.js';
import { Fx } from './fx.js';
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
    this.pending = false;
    this.lastTurnLogged = null;
    els.table.innerHTML = '';
    els.log.innerHTML = '';
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
    game.on('move', d => { if (live() && this.g.clock.speed !== 4 && !document.body.classList.contains('calm')) this.animateMove(d); });
    game.on('battle', d => { if (live()) { this.battle(d); Sound.combat(); } });
    game.on('combo', d => { if (live()) this.comboBanner(d); });
    game.on('turn', p => { if (live() && this.g.clock.speed !== undefined && this.g.clock.speed < 4) this.turnBanner(p); });
    game.on('turn', p => { if (live() && document.body.classList.contains('follow')) this.boards[p.idx]?.el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); });
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
        ${o.card.imgNormal ? `<img src="${esc(o.card.imgNormal)}" alt="${esc(o.card.name)}">` : `<div class="tkn" style="background-image:url('${esc(o.card.art || '')}')"><b>${esc(o.card.name)}</b></div>`}
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
    if (!document.body.classList.contains('calm')) requestAnimationFrame(() => {
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
    const html = img ? `<img src="${img.getAttribute('src')}" alt="">` : el.innerHTML;
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
    return el;
  }

  sync(container, objs, opts = {}) {
    let i = 0;
    let prevName = null;
    for (const o of objs) {
      const el = this.cardEl(o);
      el.classList.toggle('stacked', !!opts.stack && prevName === o.card.name);
      prevName = o.card.name;
      if (container.children[i] !== el) {
        // A card moving between zones (hand → battlefield, creature row → another player) glides there
        const from = el.isConnected && el.parentElement !== container && !this.g.clock.ff ? el.getBoundingClientRect() : null;
        container.insertBefore(el, container.children[i] || null);
        if (from && from.width) {
          const to = el.getBoundingClientRect();
          const dx = from.left - to.left, dy = from.top - to.top;
          if (Math.abs(dx) + Math.abs(dy) > 4) el.animate([{ translate: `${dx}px ${dy}px` }, { translate: '0 0' }], { duration: 380, easing: 'cubic-bezier(.2,.7,.2,1)' });
        }
      }
      i++;
    }
    while (container.children.length > i) container.lastChild.remove();
  }

  render() {
    const g = this.g;
    const ap = g.players[g.active];
    this.els.turnLabel.textContent = g.turn ? `Turn ${g.turn} · Round ${g.round} · ${ap.name}` : g.phase === 'setup' ? 'Shuffling up…' : 'Ready';
    this.els.phaseTrack.style.setProperty('--pc', ap?.color);
    this.els.phaseTrack.innerHTML = PHASES.map(([k, l]) => `<span class="${g.turn && g.phase === k ? 'on' : ''}">${l}</span>`).join('');

    for (const b of this.boards) {
      const p = b.p;
      b.el.classList.toggle('active', g.active === p.idx && !g.over && g.turn > 0);
      b.lv.textContent = p.life;
      b.life.classList.toggle('low', p.life <= 10);
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
      const chips = politics + Object.entries(p.cmdDamage).map(([iid, n]) => {
        const src = g.objects.get(+iid);
        const owner = g.players[src.owner];
        return `<span class="cmdchip ${n >= 15 ? 'hot' : ''}" style="--cc:${owner.color}" data-iid="${iid}" title="Commander damage from ${esc(src.card.name)}">⚔ ${esc(src.card.name.split(',')[0])} ${n}/21</span>`;
      }).join('');
      if (b.chips.dataset.v !== chips) { b.chips.innerHTML = chips; b.chips.dataset.v = chips; }

      this.sync(b.command, p.command);
      const taxes = p.command.map(o => p.castCount[o.iid] ? `Tax +${2 * p.castCount[o.iid]}` : '').filter(Boolean).join(' · ');
      b.tax.textContent = taxes;

      const bf = p.battlefield;
      const creatures = bf.filter(o => o.fx.type.creature);
      const lands = bf.filter(o => o.fx.type.land && !o.fx.type.creature).sort((a, c) => a.card.name.localeCompare(c.card.name) || a.tapped - c.tapped);
      const others = bf.filter(o => !o.fx.type.creature && !(o.fx.type.land && !o.fx.type.creature));
      const n = creatures.length + others.length;
      // (larger in the Display window's "Larger text and cards" mode)
      const cw = n > 22 ? 44 : n > 16 ? 50 : n > 10 ? 58 : 66;
      b.el.style.setProperty('--cw', `${document.body.classList.contains('big') ? Math.round(cw * 1.2) : cw}px`);
      this.sync(b.creatures, creatures);
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

  // Arrows from each attacker to the player it's attacking, and dashed lines from blockers
  drawCombat() {
    const wrap = this.els.table.parentElement;
    if (!this.svg) {
      this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      this.svg.setAttribute('class', 'combat-svg');
      wrap.append(this.svg);
    }
    const g = this.g;
    const attackers = g.players.flatMap(p => p.battlefield.filter(o => o.attacking != null));
    if (!attackers.length || g.clock.ff) { if (this.svg.innerHTML) this.svg.innerHTML = ''; return; }
    const base = wrap.getBoundingClientRect();
    const center = el => { const r = el.getBoundingClientRect(); return [r.left + r.width / 2 - base.left, r.top + r.height / 2 - base.top]; };
    let html = '';
    for (const o of attackers) {
      const el = this.cards.get(o.iid), board = this.boards[o.attacking];
      if (!el?.isConnected || !board) continue;
      // Aim at the defender's portrait, which is always visible (the life box can be squeezed on small boards)
      const [x1, y1] = center(el), [x2, y2] = center(board.el.querySelector('.avatar'));
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
    const html = items.map(it => `<div class="spot ${it.countered ? 'countered' : ''}" style="--pc:${it.p.color}">
      <img src="${it.o.card.imgNormal || ''}" alt="${esc(it.o.card.name)}">
      <div class="cap">${it.ability ? `${esc(it.o.card.name)}: ${esc(String(it.label).slice(0, 48))}` : `${esc(it.p.name)} casts ${esc(it.o.card.name)}`}</div></div>`).join('');
    if (this.els.spotlight.dataset.v !== html) { this.els.spotlight.innerHTML = html; this.els.spotlight.dataset.v = html; }
    this.renderStackPanel();
  }

  renderStackPanel() {
    const g = this.g;
    const items = [...g.stack].reverse();
    const waiting = g.queue?.length || 0;
    const html = !items.length && !waiting ? '' : `<div class="sp-head">Stack · ${items.length}<span>resolves top first</span></div>
      ${items.map((it, i) => {
        const tg = (it.targets || []).filter(Boolean).map(t => g.tname(t)).filter(Boolean);
        return `<div class="sp-item ${it.countered ? 'countered' : ''}" style="--pc:${it.p.color}" data-iid="${it.o.iid}">
          <span class="sp-n">${i + 1}</span><span class="sp-text"><b>${esc(it.o.card.name)}</b>${it.ability ? ` <i>${esc(String(it.label || 'ability').slice(0, 40))}</i>` : ''}
          <small>${esc(it.p.name)}${tg.length ? ` → ${tg.map(t => { const d = document.createElement('div'); d.innerHTML = t; return esc(d.textContent); }).join(', ')}` : ''}${it.countered ? ' · countered' : ''}</small></span></div>`;
      }).join('')}${waiting ? `<div class="sp-wait">${waiting} trigger${waiting === 1 ? '' : 's'} waiting to go on the stack</div>` : ''}`;
    if (this.stackPanel.dataset.v === html) return;
    this.stackPanel.dataset.v = html;
    this.stackPanel.innerHTML = html;
    this.stackPanel.hidden = !html;
  }

  addLog(e) {
    const log = this.els.log;
    const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 60;
    const div = document.createElement('div');
    div.className = `le ${e.kind}`;
    if (e.p != null) div.style.setProperty('--pc', this.g.players[e.p].color);
    // Every seat the line is about (for the log's seat filter)
    const who = new Set([...e.html.matchAll(/data-p="(\d)"/g)].map(m => m[1]));
    if (e.p != null) who.add(String(e.p));
    div.dataset.seats = [...who].join(' ');
    div.innerHTML = e.html + (e.rule ? `<a class="rule" data-rule="${e.rule}" title="Comprehensive Rules ${e.rule}">${e.rule}</a>` : '');
    log.append(div);
    while (log.children.length > 2500) log.firstChild.remove();
    if (atBottom) log.scrollTop = log.scrollHeight;
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
      const mayLook = top && (p.battlefield.some(o => o.fx.seeTop) && (this.humanIdx === p.idx || this.revealAll));
      list = mayLook ? [top] : [];
      grid.innerHTML = `<p class="muted">${p.library.length} card${p.library.length === 1 ? '' : 's'} left, face down.${mayLook ? ' The top card:' : ''}</p>`;
      if (!mayLook) { this.els.zoneModal.hidden = false; return; }
    }
    for (const o of list) {
      const el = document.createElement('div');
      el.className = 'card';
      el.dataset.iid = o.iid;
      el.innerHTML = o.card.imgNormal ? `<img src="${o.card.imgNormal}" alt="${esc(o.card.name)}">` : `<div class="tkn"><b>${esc(o.card.name)}</b></div>`;
      grid.append(el);
    }
    if (!list.length) grid.innerHTML = '<p class="muted">Empty.</p>';
    this.els.zoneModal.hidden = false;
  }
}

// ---------- sound effects, synthesized with Web Audio (no files to download)
export const Sound = {
  enabled: false,
  ctx: null,
  last: 0,
  // The Sound switch turns the background music on and off with the effects
  setEnabled(on) { this.enabled = on; if (on) Music.start(); else Music.stop(); },
  combat() { if (this.enabled) Music.battle(); },
  tones: {
    cast: [[520, 0.06], [780, 0.08]], land: [[180, 0.07]], combat: [[140, 0.12], [110, 0.12]], damage: [[90, 0.15]],
    removal: [[400, 0.05], [260, 0.1]], death: [[220, 0.08], [150, 0.14]], combo: [[523, 0.08], [659, 0.08], [784, 0.08], [1047, 0.2]],
    win: [[523, 0.12], [659, 0.12], [784, 0.12], [1047, 0.35]], loss: [[300, 0.15], [200, 0.25]], politics: [[660, 0.06], [660, 0.06]],
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
        gain.gain.exponentialRampToValueAtTime(0.12, t + 0.01);
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
export function installPreview(getObject) {
  const pv = document.getElementById('preview');
  let current = null;
  document.addEventListener('mouseover', ev => {
    const t = ev.target.closest('[data-iid]');
    if (!t) { if (current) { pv.hidden = true; current = null; } return; }
    const o = getObject(+t.dataset.iid);
    if (!o || o === current) return;
    current = o;
    pv.innerHTML = previewHtml(o);
    pv.hidden = false;
    place(ev);
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
  });
  document.addEventListener('mousemove', ev => { if (!pv.hidden) place(ev); });
  function place(ev) {
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
  const combos = combosFor(c);
  const pt = c.power != null ? `${c.power}/${c.toughness}` : c.loyalty ? `Loyalty ${c.loyalty}` : '';
  return `
    <div class="imgs">
      ${c.imgNormal ? `<img class="big" src="${c.imgNormal}" alt="">` : `<div class="tkn big" style="width:250px;height:349px;background-image:url('${c.art || ''}')"><b>${esc(c.name)}</b></div>`}
      ${c.backNormal ? `<img class="big" src="${c.backNormal}" alt="" style="width:120px">` : ''}
    </div>
    <div class="ptext">
      <h3><span>${esc(c.name)}</span><span>${symbolize(c.manaCost || '')}</span></h3>
      <div class="ptype">${esc(c.typeLine)}${pt ? ` · ${esc(pt)}` : ''}</div>
      <div class="oracle">${symbolize(c.fullText || c.text || '')}</div>
      ${fx.length ? `<div class="sec"><h4>Simulator understands</h4><div class="fxl">${fx.map(esc).join('<br>')}</div></div>` : ''}
      ${o.fx.unread?.length ? `<div class="sec warn"><h4>⚠ Not simulated</h4><div class="fxl">${o.fx.unread.map(esc).join('<br>')}</div></div>` : ''}
      ${o.chosenType ? `<div class="sec"><h4>Chosen type</h4><div class="fxl">${esc(o.chosenType)}</div></div>` : ''}
      ${combos.length ? `<div class="sec"><h4>Known combos</h4><div class="fxl">${combos.map(k => `<b>${esc(k.label)}</b>: ${esc(RESULT_TEXT[k.result])}`).join('<br>')}</div></div>` : ''}
      ${kwRules.length ? `<div class="sec"><h4>Rules</h4>${kwRules.map(r => `<div class="kwr"><b>${r.id}</b> ${esc(r.text)}</div>`).join('')}</div>` : ''}
      ${c.set ? `<div class="credit2">${esc(c.setName || c.set.toUpperCase())} #${esc(c.cn)} · Illustrated by ${esc(c.artist || 'unknown')}</div>` : ''}
    </div>`;
}
