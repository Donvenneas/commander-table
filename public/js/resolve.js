// Effects resolving (rule 608): targets, the effect kinds card text is read into, damage, life, tokens and the rest.
// Split out of engine.js (Round 5, item 176): each function is one of Game's methods, with the game as `g`; Game keeps
// a one-line method that calls it, so nothing else changes.
import { parseCost, COLORS } from './engine.js';
import { needsTarget, needsTargetIn, condText } from './effects.js';
import { shuffle, esc } from './util.js';
import * as K from './kingdomsPlay.js';

/** @param {import('./engine.js').Game} g */
export function validTarget(g, t, p) {
  if (!t) return false;
  if (t.spell) return g.stack.includes(t.spell) && !t.spell.countered;
  if (t.obj) return g.canTarget(p, t.obj);
  // (rules 13) A player with protection from everything (Teferi's Protection) can't be targeted by others (702.16j)
  if (t.player != null && g.rules >= 13 && t.player !== p?.idx && g.players[t.player]?.shield >= g.turn) return false;
  return t.player != null && !g.players[t.player].lost;
}
// (rules 13) Chaos Warp: the owner of the permanent shuffles it into their library (a token ceases to exist), then
// reveals the top card; a permanent card is put onto the battlefield under its owner's control (with its enter
// triggers), anything else stays on top of the library
/** @param {import('./engine.js').Game} g */
async function chaosWarp(g, p, src, o, S) {
  const q = g.players[o.owner];
  g.log(`${S}: ${g.pn(q)} shuffles ${g.cn(o)} into their library`, { kind: 'removal' });
  g.move(o, 'library');
  shuffle(q.library, g.rand);
  const top = q.library[q.library.length - 1];
  if (!top) { g.log(`${g.pn(q)}'s library is empty: nothing is revealed`, { kind: 'minor' }); return; }
  g.log(`${g.pn(q)} reveals ${g.cn(top)} from the top of their library`, { kind: 'minor', rule: '701.20' });
  if (!top.fx.type.permanent) return;
  g.move(top, 'battlefield', { under: q.idx });
  g.log(`${S} puts ${g.cn(top)} onto the battlefield under ${g.pn(q)}'s control`, { kind: 'minor' });
  g.trigger(top, 'etb');
}
// (who controls the effect resolving now: life they make others lose counts as eliminating them, for Kingdoms)
/** @param {import('./engine.js').Game} g */
export async function runEffects(g, p, src, effects, ctx = {}) {
  const prev = g.effectP;
  g.effectP = p?.idx ?? null;
  try { return await g.runEffects0(p, src, effects, ctx); } finally { g.effectP = prev; }
}
/** @param {import('./engine.js').Game} g */
export async function runEffects0(g, p, src, effects, ctx = {}) {
  for (let i = 0; i < effects.length; i++) {
    if (g.over || p.lost) return;
    await g.doEffect(p, src, effects[i], ctx, i);
    g.sbaPass();
  }
}
/** @param {import('./engine.js').Game} g */
export async function doEffect(g, p, src, e, ctx, i) {
  // X from the mana paid, or a counted amount (devotion, creatures you control) checked on resolution
  const X = v => (v === 'X' ? ctx.x || 0 : v && typeof v === 'object' ? g.dynValue(p, v, { ...ctx, src }) : v);
  const S = g.cn(src);
  // (rules 6: a second reading of the same words does nothing; see readRiders in effects.js)
  if (e.dup && g.rules >= 6) return;
  let tgt = ctx.targets?.[i];
  if (needsTargetIn(e, g.rules) && !g.validTarget(tgt, p)) {
    // A spell's chosen target that became illegal is skipped, never swapped for a new one (608.2b)
    if (ctx.strict && tgt) { g.log(`${S}: ${g.tname(tgt)} is no longer a legal target`, { kind: 'minor', rule: '608.2b' }); return; }
    tgt = p.agent.chooseTarget(g, p, e, src);
  }
  const tName = t => g.tname(t);
  // Shalai, Leyline of Sanctity-style: an opponent with hexproof can't be targeted
  if (tgt?.player != null && tgt.player !== p.idx && g.players[tgt.player]?.battlefield.some(s => s.fx.hexPlayer)) { g.log(`${S}: ${g.pn(g.players[tgt.player])} has hexproof`, { kind: 'minor' }); return; }
  switch (e.k) {
    // Rhystic Study, Smothering Tithe, Esper Sentinel: the other player pays, or the watcher gets the effect
    case 'tax': {
      const payer = g.players[e.payer];
      const plan = payer && !payer.lost && g.planPayment(payer, { generic: e.tax, pips: [], x: 0 });
      const pays = plan && (await (payer.agent.payTaxAsync ? payer.agent.payTaxAsync(g, payer, src, e) : payer.agent.payTax(g, payer, src, e)));
      if (pays) {
        g.commitPayment(payer, g.planPayment(payer, { generic: e.tax, pips: [], x: 0 }) || plan);
        g.log(`${g.pn(payer)} pays {${e.tax}} for ${S}`, { kind: 'minor' });
      } else {
        if (payer && !payer.lost) g.log(`${g.pn(payer)} doesn't pay {${e.tax}} for ${S}`, { kind: 'minor' });
        await g.runEffects(p, src, e.effects, {});
      }
      break;
    }
    case 'mill': {
      const who = e.who === 'you' ? [p] : e.who === 'that player' ? [g.thatPlayer(p, ctx)].filter(Boolean) : e.who === 'defending player' ? [g.players[src.attacking ?? -1]].filter(q => q && !q.lost) : e.who.startsWith('target') ? (tgt?.player != null ? [g.players[tgt.player]] : []) : e.who === 'each player' ? g.alive() : g.opponents(p);
      const n = (e.n?.dyn === 'theirHand' || e.n?.dyn === 'theirGy' ? 0 : X(e.n)) * (ctx.copies || 1);
      for (const q of who) {
        // Bruvac, The Water Crystal: opponents of their controller mill more
        // (Folio of Fancies: as many as the cards in their hand)
        let n2 = e.n?.dyn === 'theirHand' ? q.hand.length * (ctx.copies || 1) : e.n?.dyn === 'theirGy' ? q.graveyard.length : n;
        for (const r of g.opponents(q)) for (const s of r.battlefield) if (s.fx.millMore) n2 = s.fx.millMore.double ? n2 * 2 : n2 + s.fx.millMore.plus;
        let k = Math.min(n2, q.library.length);
        // (rules 7) Grindstone: repeat while the two cards milled share a color (Painter's Servant makes them all share one)
        if (g.rules >= 7 && e.repeatShared) {
          k = 0;
          for (let more = true; more && q.library.length;) {
            const two = q.library.slice(-2).reverse();
            for (const c of two) g.move(c, 'graveyard');
            k += two.length;
            const [a, b] = two.map(c => g.colorsOf(c));
            more = two.length === 2 && a.some(c => b.includes(c));
          }
          g.log(`${g.pn(q)} mills ${k} card${k === 1 ? '' : 's'}${q.library.length ? '' : ', emptying their library'} (${S}, repeating while the pair shares a color)`, { kind: k >= 20 ? 'removal' : 'minor', rule: '701.13a' });
          continue;
        }
        for (let j = 0; j < k; j++) g.move(q.library[q.library.length - 1], e.exile ? 'exile' : 'graveyard');
        g.log(`${g.pn(q)} mills ${k} card${k === 1 ? '' : 's'}${q.library.length ? '' : ', emptying their library'} (${S})`, { kind: k >= 20 ? 'removal' : 'minor', rule: '701.13a' });
      }
      break;
    }
    // Dramatic Reversal and friends: untapped mana sources can be tapped again right away
    case 'untapAll': {
      const kinds = { 'nonland permanents': o => !o.fx.type.land, artifacts: o => o.fx.type.artifact, creatures: o => o.fx.type.creature, lands: o => o.fx.type.land, permanents: () => true, 'nonland permanents s': o => !o.fx.type.land };
      const ok = kinds[e.what] || (() => true);
      // "untap target …": the most useful ones (mana sources first)
      let list = p.battlefield.filter(o => o.tapped && ok(o));
      // (rules 7) the AI untaps the combo loop's engine first (Kiki-Jiki with a Deceiver Exarch copy)
      const eng = g.rules >= 7 && !p.agent.chooseCostAsync && p.agent.loopEngine?.(g, p, src);
      if (eng && list.includes(eng)) list = [eng, ...list.filter(o => o !== eng)];
      // (you choose which ones in your seat; the AI takes the best mana sources)
      if (e.n && list.length > e.n) list = p.agent.chooseCostAsync ? await p.agent.chooseCostAsync(g, p, list, e.n, `${S}: choose ${e.n === 1 ? 'a permanent' : `up to ${e.n} permanents`} to untap`)
        : eng && list[0] === eng ? list.slice(0, e.n) : list.sort((a, b) => (b.fx.mana?.amount || 0) - (a.fx.mana?.amount || 0)).slice(0, e.n);
      for (const o of list) o.tapped = false;
      if (list.length) g.log(`${S} untaps ${list.length === 1 ? g.cn(list[0]) : `${list.length} of ${g.pn(p)}'s permanents`}`, { kind: 'minor' });
      break;
    }
    // Redirect Lightning: the targeted spell or ability gets a new single target of our choosing
    case 'redirect': {
      const it = tgt?.spell;
      if (!it) break;
      const idx = (it.targets || []).findIndex(Boolean);
      const pick = idx >= 0 && p.agent.redirectTarget?.(g, p, it, idx);
      if (pick) {
        const was = g.tname(it.targets[idx]);
        it.targets[idx] = pick;
        g.log(`${S} changes ${g.cn(it.o)}'s target from ${was} to ${g.tname(pick)}`, { kind: 'removal', rule: '115.7' });
      }
      break;
    }
    case 'silence': {
      const who = e.who.startsWith('target') ? (tgt?.player != null ? [g.players[tgt.player]] : []) : g.opponents(p);
      for (const q of who) g.silenced[q.idx] = g.turn;
      if (who.length) g.log(`${who.map(q => g.pn(q)).join(', ')} can't cast spells this turn (${S})`, { kind: 'removal' });
      break;
    }
    case 'adNauseam': {
      // Keep revealing while it's safe: stop around 10 life, at 12 cards, or before the library runs out
      let n = 0, lost = 0;
      while (p.library.length > 1 && n < 12) {
        const top = p.library[p.library.length - 1];
        if (p.life - (top.card.cmc || 0) < 10) break;
        g.draw(p, 1, true);
        p.life -= top.card.cmc || 0; lost += top.card.cmc || 0; n++;
      }
      if (lost) g.emit('life', { p: p.idx, d: -lost });
      g.log(`${g.pn(p)} reveals ${n} cards into their hand and loses ${lost} life (${S})`);
      break;
    }
    case 'counter': case 'counterAbility':
      // (rules 13) What a counterspell sets up for later, whether or not the spell can be countered (608.2c: the rest
      // of the spell still happens). Mana Drain: {C} equal to the spell's mana value (X included, 202.3e) at the
      // beginning of its caster's next main phase. Arcane Denial: the spell's controller may draw up to two cards at
      // the beginning of the next turn's upkeep.
      if (g.rules >= 13 && tgt?.spell && !tgt.spell.ability) {
        const sp = tgt.spell, mv = (sp.o.card.cmc || 0) + (sp.x || 0) * (parseCost(sp.o.card.manaCost).x || 0);
        if (e.laterMana) g.addLater(p, src, 'main', mv ? [{ k: 'addManaN', n: mv, color: 'C' }] : [], `add {C} equal to ${sp.o.card.name}'s mana value (${mv})`);
        if (e.laterDraw && sp.p && !sp.p.lost) g.addLater(p, src, 'upkeep', [{ k: 'drawUpTo', n: e.laterDraw, who: sp.p.idx }], `${sp.p.name} may draw up to ${e.laterDraw} cards`);
      }
      if (tgt?.spell && !tgt.spell.ability && (tgt.spell.o.fx.uncounterable || tgt.spell.uncounterable || (g.rules >= 5 && tgt.spell.p?.shieldTurn === g.turn) || g.alive().some(q => q.battlefield.some(o => o.fx.noCounterAll)) || g.players[tgt.spell.o.owner]?.battlefield.some(o => o.fx.protectsSpells && (!o.fx.costReduce?.minMv || (tgt.spell.o.card.cmc || 0) >= o.fx.costReduce.minMv)))) {
        g.log(`${g.cn(tgt.spell.o)} can't be countered`, { kind: 'minor' });
        break;
      }
      if (tgt?.spell) {
        tgt.spell.countered = true;
        // (Baral: "whenever a spell or ability you control counters a spell")
        if (!tgt.spell.ability) g.fire('countered', { p: p.idx, o: tgt.spell.o });
        // Reprieve, Remand-style: the spell goes back to its owner's hand
        if (e.toHand) tgt.spell.toHand = true;
        g.log(`${g.cn(tgt.spell.o)}${tgt.spell.ability ? "'s ability" : ''} is countered`, { kind: 'removal', rule: '701.6a' });
        // (rules 6) Swan Song's Bird, An Offer You Can't Refuse's Treasures: for the countered spell's controller
        if (e.comp && g.rules >= 6 && tgt.spell.p && !tgt.spell.p.lost) await compensate(g, tgt.spell.p, src, e.comp, 0);
        g.emit('update');
      }
      break;
    case 'copySpell': {
      if (!tgt?.spell) break;
      const orig = tgt.spell;
      g.log(`${g.pn(p)} copies ${g.cn(orig.o)}`, { kind: 'cast', p: p.idx, rule: '707.10' });
      await g.beat(0.8);
      const copyEffects = orig.o.fx.spell.filter(x => x.k !== 'copySpell');
      await g.runEffects(p, orig.o, copyEffects, { x: orig.x });
      break;
    }
    case 'steal': {
      const o = tgt?.obj;
      // (rules 7) Zealous Conscripts on your own permanent: you already control it, but it still untaps and gains haste
      if (o && o.controller === p.idx && e.temp && g.rules >= 7 && o.zone === 'battlefield') { Object.assign(o, { tapped: false, tempKw: new Set([...(o.tempKw || []), 'haste']) }); g.log(`${S} untaps ${g.cn(o)}`, { kind: 'minor' }); break; }
      if (!o || o.controller === p.idx) break;
      const from = g.players[o.controller];
      from.battlefield.splice(from.battlefield.indexOf(o), 1);
      o.controller = p.idx;
      p.battlefield.push(o);
      from.grudge[p.idx] += 5;
      if (e.temp) {
        // Threaten effects untap it and give it haste for the turn
        Object.assign(o, { tapped: false, sick: false, tempKw: new Set([...(o.tempKw || []), 'haste']) });
        g.tempSteals.push({ o, back: from.idx });
      } else {
        o.sick = true;
        // Control Magic, Sower of Temptation: control lasts only while the source stays on the battlefield
        if (src && src !== o && (src.fx.controlAura || e.whileSrc)) Object.assign(o, { stolenBy: src.iid, stolenFrom: from.idx });
      }
      g.log(`${g.pn(p)} gains control of ${g.cn(o)}${e.temp ? ' until end of turn' : ''}`, { kind: 'removal' });
      break;
    }
    case 'discard': {
      const n = X(e.n);
      const victims = e.who === 'that player' ? [g.thatPlayer(p, ctx)].filter(Boolean) : e.who.startsWith('target') ? (tgt?.player != null ? [g.players[tgt.player]] : [])
        : e.who === 'each player' ? g.alive() : g.opponents(p);
      for (const q of victims) {
        // Thoughtseize, Cabal Therapy: the caster sees the hand and picks (a name, or a card of the given type)
        if (e.named || e.chosen) {
          const pool = q.hand.filter(o => (e.chosen?.length ? e.chosen.some(t => o.fx.type[t]) : !o.fx.type.land));
          const [pick] = await g.pickCards(p, pool, 1, `${S}: choose a card from ${g.pn(q)}'s hand`);
          const cards = pick ? q.hand.filter(o => o.card.name === pick.card.name) : [];
          g.log(`${g.pn(q)} reveals their hand (${S})`, { kind: 'minor' });
          g.discard(q, e.named ? cards : cards.slice(0, 1));
          continue;
        }
        const cards = (await q.agent.chooseDiscard(g, q, Math.min(n, q.hand.length))) || [];
        g.discard(q, cards);
      }
      // (rules 7) Chain of Smog: the player who discarded may copy it, and each copy triggers magecraft
      if (g.rules >= 7 && e.chainCopy && victims.length === 1) await chainCopies(g, victims[0], src, e);
      break;
    }
    case 'copyToken':
      // "A token that's a copy of equipped creature / it" has no target
      if (e.of) tgt = { obj: e.of === '~' ? src : e.of === 'equipped creature' || e.of === 'enchanted creature' ? src.attachedTo : ctx.trig?.o || src };
      // (Skyclave Relic: two tapped copies of itself)
      for (let k = 1; k < (e.n || 1) && tgt?.obj?.zone === 'battlefield'; k++) { const c2 = g.createCopy(p, tgt.obj, false); if (e.tapped) c2.tapped = true; if (g.rules >= 6) tokenCopyRiders(g, c2, e); g.trigger(c2, 'etb'); }
      if (tgt?.obj && tgt.obj.zone === 'battlefield') {
        const copy = g.createCopy(p, tgt.obj, false);
        if (e.tapped) copy.tapped = true;
        if (g.rules >= 6) tokenCopyRiders(g, copy, e);
        // Offspring: the copy is a 1/1
        if (e.small) copy.card = { ...copy.card, power: '1', toughness: '1' };
        g.log(`${g.pn(p)} creates a ${e.small ? '1/1 ' : ''}token copy of ${g.cn(tgt.obj)}`, { kind: 'minor', rule: '707.2' });
        g.trigger(copy, 'etb');
      }
      break;
    case 'addMana':
      // ("RG": one mana of either color, Orcish Lumberjack)
      for (const c of e.syms) p.pool.push({ colors: c === '*' ? [...COLORS] : c.split(''), ...(g.rules >= 7 && e.only ? { only: e.only } : {}) });
      g.log(`${g.pn(p)} adds ${e.syms.map(c => (c === '*' ? '{any}' : `{${c}}`)).join('')}`, { kind: 'minor' });
      break;
    case 'sacSelf':
      if (src.zone === 'battlefield') g.sacrifice(p, src);
      break;
    case 'extraTurn':
      p.extraTurns = (p.extraTurns || 0) + (e.n || 1);
      g.log(`${g.pn(p)} will take ${e.n === 2 ? 'two extra turns' : 'an extra turn'} after this one`, { kind: 'turn', rule: '500.7' });
      break;
    case 'extraCombat':
      p.extraCombats = (p.extraCombats || 0) + (e.n || 1);
      if (e.untap) for (const o of p.battlefield) if (o.fx.type.creature) o.tapped = false;
      g.log(`${g.pn(p)} gets an additional combat phase${e.untap ? ' and untaps their creatures' : ''}`, { kind: 'turn', rule: '500.8' });
      break;
    case 'flickerDelay':
      if (tgt?.obj) {
        const o = tgt.obj;
        g.log(`${S} exiles ${tName(tgt)} until the next end step`, { kind: 'removal' });
        g.move(o, 'exile', { stay: true });
        if (!o.token) g.delayed.push(o);
      }
      break;
    case 'blink':
      if (tgt?.obj) {
        g.log(`${S} exiles ${tName(tgt)} and returns it to the battlefield`, { kind: 'minor' });
        g.blink(tgt.obj);
        await g.beat(0.5);
      }
      break;
    case 'protect': {
      const objs = e.scope === 'one' ? (tgt?.obj ? [tgt.obj] : []) : e.scope === 'self' ? [src] : e.scope === 'tokens' ? p.battlefield.filter(o => o.token && o.fx.type.creature) : p.battlefield.filter(o => !o.fx.type.land);
      for (const o of objs) o.tempKw = new Set([...(o.tempKw || []), ...e.kw]);
      if (objs.length) g.log(`${objs.length === 1 ? g.cn(objs[0]) : `${g.pn(p)}'s permanents`} gain${objs.length === 1 ? 's' : ''} ${e.kw.join(' and ')} until end of turn`, { kind: 'minor' });
      break;
    }
    // An X draw never decks its own caster (matters with infinite mana)
    // (rules 7) "you may draw a card" (Curiosity): nobody draws from an empty library on purpose without Laboratory Maniac
    case 'draw': if (g.rules >= 7 && e.may && !p.library.length && !p.battlefield.some(o => o.fx.labMan)) break; g.draw(p, e.n === 'X' ? Math.min(X(e.n), Math.max(0, p.library.length - 1)) : X(e.n)); break;
    case 'gain': { const n = g.lifeGain(p, X(e.n)); p.life += n; g.emit('life', { p: p.idx, d: n }); g.log(`${g.pn(p)} gains ${n} life (${S})`, { kind: 'minor' }); break; }
    case 'drain': {
      const n = X(e.n) * (e.times || 1);
      for (const q of g.opponents(p)) { q.life -= n; q.grudge[p.idx] += n; g.emit('life', { p: q.idx, d: -n }); }
      // (Debt to the Deathless: you gain what they lost)
      // (and Gray Merchant, Exsanguinate from rules 6: "you gain life equal to the life lost this way")
      if (e.gain || (e.gainLost && g.rules >= 6)) { const gained = g.lifeGain(p, n * g.opponents(p).length); p.life += gained; g.emit('life', { p: p.idx, d: gained }); }
      g.log(`${S}: each opponent loses ${n} life`); break;
    }
    case 'loseLife': if (tgt?.player != null) { const q = g.players[tgt.player]; const n = X(e.n); q.life -= n; g.emit('life', { p: q.idx, d: -n }); g.log(`${S}: ${g.pn(q)} loses ${n} life`); } break;
    case 'damage': {
      const n = X(e.n);
      if (e.to === 'defender') {
        // "the player it's attacking": the attacker that set off the trigger, or this creature
        const att = ctx.trig?.o?.attacking ?? src.attacking;
        const q = att != null ? g.players[att] : p.agent.weakestOpponent(g, p);
        if (q && !q.lost) { g.damagePlayer(q, n, src, false); g.log(`${S} deals ${n} damage to ${g.pn(q)}`); }
      } else if (e.mult && tgt) {
        // Crackle with Power: five times X to a target
        const m = n * e.mult;
        if (tgt.obj) g.damageObj(tgt.obj, m, src); else if (tgt.player != null) g.damagePlayer(g.players[tgt.player], m, src, false);
        g.log(`${S} deals ${m} damage to ${tName(tgt)}`);
      } else if (e.to === 'that player') {
        const q = g.thatPlayer(p, ctx);
        if (q) { g.damagePlayer(q, n, src, false); g.log(`${S} deals ${n} damage to ${g.pn(q)}`); }
      } else if (e.to === 'each opponent' || e.to === 'each player') {
        for (const q of e.to === 'each player' ? g.alive() : g.opponents(p)) g.damagePlayer(q, n, src, false);
        g.log(`${S} deals ${n} damage to ${e.to}`);
      } else if (e.divided > 1 && n > 1 && g.rules >= 5) {
        // "Divided as you choose among any number of targets" (601.2d): the caster splits it (the AI kills what it
        // can and sends the rest to the chosen target; people are asked). Chosen as it resolves here.
        const legal = x => (x.obj ? x.obj.zone === 'battlefield' && x.obj.fx.type.creature && g.canTarget(p, x.obj) : e.to === 'any target' && x.player != null && !g.players[x.player]?.lost);
        let plan = await (p.agent.divideDamageAsync ? p.agent.divideDamageAsync(g, p, src, e, n, tgt) : p.agent.divideDamage(g, p, src, e, n, tgt));
        if (!Array.isArray(plan) || plan.length > e.divided || plan.some(x => !(x.n > 0) || !legal(x)) || plan.reduce((a, x) => a + x.n, 0) !== n) plan = tgt && (tgt.obj || tgt.player != null) ? [{ ...tgt, n }] : [];
        for (const x of plan) {
          if (x.obj) g.damageObj(x.obj, x.n, src); else g.damagePlayer(g.players[x.player], x.n, src, false);
        }
        if (plan.length) g.log(`${S} deals ${plan.map(x => `${x.n} to ${x.obj ? g.cn(x.obj) : g.pn(g.players[x.player])}`).join(', ')}`, { rule: '601.2d' });
      } else if (tgt?.obj) { g.damageObj(tgt.obj, n, src); g.log(`${S} deals ${n} damage to ${tName(tgt)}`); }
      else if (tgt?.player != null) { g.damagePlayer(g.players[tgt.player], n, src, false); g.log(`${S} deals ${n} damage to ${tName(tgt)}`); }
      break;
    }
    case 'remove': {
      // (rules 6) Deathrite Shaman: "exile target land card from a graveyard" is a card, not a land on the battlefield
      if (e.gyCard && g.rules >= 6) { exileFromGraveyard(g, p, src, ['land']); break; }
      if (!tgt?.obj) { g.log(`${S} has no legal target`, { kind: 'minor' }); break; }
      // (rules 13) Chaos Warp: the owner shuffles it into their library, reveals the top card, and puts it onto the
      // battlefield if it's a permanent card (zone changes through Game.move, so its own triggers happen as usual)
      if (e.warp && g.rules >= 13) { await chaosWarp(g, p, src, tgt.obj, S); break; }
      // (what the target was as it last existed on the battlefield: its power and controller, 608.2h)
      const v = tgt.obj, q = g.players[v.controller], pow = g.power(v), mv = v.card.cmc || 0;
      if (e.mode === 'exile') { g.log(`${S} exiles ${tName(tgt)}`, { kind: 'removal' }); g.move(v, 'exile'); }
      else if (g.destroy(v, g.rules >= 9 && !!e.noRegen9)) g.log(`${S} destroys ${tName(tgt)}`, { kind: 'removal' });
      else g.log(`${tName(tgt)} is indestructible`, { rule: '702.12' });
      if (g.rules >= 6) {
        if (e.comp) await compensate(g, q, src, e.comp, pow);
        // Feed the Swarm: you lose life equal to its mana value
        if (e.loseMv && mv > 0) { p.life -= mv; g.emit('life', { p: p.idx, d: -mv }); g.log(`${g.pn(p)} loses ${mv} life (${S})`, { kind: 'minor' }); }
      }
      break;
    }
    case 'gyExile':
      // (rules 6) Deathrite Shaman's other abilities: they need a card of that type in a graveyard
      if (g.rules >= 6) exileFromGraveyard(g, p, src, e.types);
      break;
    case 'bounce':
      if (tgt?.obj) {
        g.log(`${S} returns ${tName(tgt)} to its owner's hand`, { kind: 'removal' }); g.move(tgt.obj, 'hand');
        // "Return two target creatures": the second one too
        if (e.n === 2) { const t2 = p.agent.chooseTarget(g, p, { ...e, n: 1 }, src); if (t2?.obj && t2.obj.zone === 'battlefield') { g.log(`${S} returns ${tName(t2)} to its owner's hand`, { kind: 'removal' }); g.move(t2.obj, 'hand'); } }
      }
      break;
    case 'wipe': {
      let n = 0;
      for (const q of g.alive()) for (const o of [...q.battlefield]) {
        const t = o.fx.type;
        const theirs = q.idx !== p.idx;
        // (Wakening Sun's Avatar: all non-Dinosaur creatures)
        if (e.notTribe && g.isA(o, e.notTribe)) continue;
        const hit = { creatures: t.creature, 'other creatures': t.creature && o !== src, 'nonland permanents': !t.land, artifacts: t.artifact, enchantments: t.enchantment, 'artifacts and enchantments': t.artifact || t.enchantment,
          'nontoken creatures': t.creature && !o.token, 'nonartifact creatures': t.creature && !t.artifact, "creatures you don't control": t.creature && theirs, 'creatures your opponents control': t.creature && theirs,
          "nonland permanents you don't control": !t.land && theirs, planeswalkers: t.planeswalker, lands: t.land }[e.what];
        if (!hit) continue;
        if (e.mode === 'exile') { g.move(o, 'exile'); n++; } else if (g.destroy(o, g.rules >= 9 && !!e.noRegen9)) n++;
      }
      g.log(`${S} ${e.mode === 'exile' ? 'exiles' : 'destroys'} all ${e.what} — ${n} permanent${n === 1 ? '' : 's'} gone`, { kind: 'removal' });
      await g.beat(0.8);
      break;
    }
    case 'sweep': {
      const n = X(e.n);
      for (const q of g.alive()) for (const o of q.battlefield) if (o.fx.type.creature) g.damageObj(o, n, src);
      g.log(`${S} deals ${n} damage to each creature`, { kind: 'removal' });
      break;
    }
    case 'token': {
      const n = Math.min(g.tokenCount(p, X(e.n)), 40);
      let made;
      for (let k = 0; k < n; k++) {
        made = g.createToken(p, { ...e, p: X(e.p), t: X(e.t) }, src);
        // Mobilize: tapped and attacking alongside the creature, sacrificed at the end step
        if (e.attacking && src.attacking != null) Object.assign(made, { tapped: true, attacking: src.attacking, blockedBy: [], blocked: false });
        if (e.temp) (g.endSac ||= []).push(made);
      }
      if (made) g.log(`${g.pn(p)} creates ${n} ${X(e.p)}/${X(e.t)} ${esc(made.card.name)} token${n === 1 ? '' : 's'}`, { kind: 'minor' });
      if (made) g.extraTokens(p, 'creature', src);
      break;
    }
    case 'treasure': { const n = g.tokenCount(p, X(e.n)); for (let k = 0; k < n; k++) g.createTreasure(p, src); g.log(`${g.pn(p)} creates ${n} Treasure`, { kind: 'minor' }); if (n > 0) g.extraTokens(p, 'treasure', src); break; }
    case 'rampLand': await g.fetchLands(p, e, src); break;
    case 'tutor': {
      // (rules 7) Demonic Consultation and Tainted Pact exile from the top instead of searching (combo audit)
      if (g.rules >= 7 && (e.consult || e.pact)) { await exileUntil(g, p, src, e); break; }
      g.fire('search', { p: p.idx });
      // Transmute: a card with the same mana value
      let c = e.sameMv ? (await g.pickCards(p, p.library.filter(x => (x.card.cmc || 0) === (src.card.cmc || 0)), 1, `${S}: choose a card with mana value ${src.card.cmc || 0}`))[0]
        : p.agent.pickTutorAsync ? await p.agent.pickTutorAsync(g, p, e) : p.agent.pickTutor(g, p, e);
      // Aven Mindcensor: only the top four cards can be found
      if (c && g.opponents(p).some(q => q.battlefield.some(s => s.fx.searchTop4)) && !p.library.slice(-4).includes(c)) {
        c = p.agent.pickBest(g, p.library.slice(-4).filter(x => !e.types?.length || e.types.some(t => x.fx.type[t])));
        g.log(`${S}: Aven Mindcensor-style limit — only the top four cards can be searched`, { kind: 'minor' });
      }
      if (!c) { g.log(`${S}: ${g.pn(p)} finds nothing worth fetching`, { kind: 'minor' }); break; }
      // Opposition Agent: an opponent controls the search, and the card is exiled instead
      const agent = g.opponents(p).find(q => q.battlefield.some(o => o.fx.searchHate));
      if (agent) {
        shuffle(p.library, g.rand);
        g.move(c, 'exile');
        g.log(`${g.pn(agent)}'s Opposition Agent controls the search: ${g.cn(c)} is exiled instead`, { kind: 'removal' });
        break;
      }
      shuffle(p.library, g.rand);
      if (e.gy) { g.move(c, 'graveyard'); g.log(`${g.pn(p)} searches for ${g.cn(c)} and puts it into their graveyard`, { kind: 'minor' }); }
      else if (e.bf && c.fx.type.permanent) { g.move(c, 'battlefield'); g.log(`${g.pn(p)} searches out ${g.cn(c)} onto the battlefield`); g.trigger(c, 'etb'); }
      else if (e.top) { g.move(c, 'library'); g.log(`${g.pn(p)} searches for a card and puts it on top of their library`, { kind: 'minor' }); }
      else { g.move(c, 'hand'); g.log(`${g.pn(p)} searches their library for a card`, { kind: 'minor' }); }
      break;
    }
    case 'teamPump':
      for (const o of p.battlefield) if (o.fx.type.creature && (!e.minPower || g.power(o) >= e.minPower) && (!e.what || g.spellIs(o, e.what))) { o.tempP += X(e.p); o.tempT += X(e.t); if (e.kw.length) o.tempKw = new Set([...(o.tempKw || []), ...e.kw]); }
      g.log(`${S}: creatures ${g.pn(p)} controls get +${X(e.p)}/+${X(e.t)}${e.kw.length ? ' and ' + e.kw.join(', ') : ''}`);
      break;
    case 'pump': if (tgt?.obj) { tgt.obj.tempP += X(e.p); tgt.obj.tempT += X(e.t); if (e.kw.length) tgt.obj.tempKw = new Set([...(tgt.obj.tempKw || []), ...e.kw]); g.log(`${tName(tgt)} gets +${X(e.p)}/+${X(e.t)}`, { kind: 'minor' }); } break;
    case 'counters': {
      const n = X(e.n);
      let objs = [];
      if (e.on === 'up to') objs = p.battlefield.filter(o => o.fx.type.creature).sort((a, b) => p.agent.value(g, b) - p.agent.value(g, a)).slice(0, e.count || 1);
      else if (e.on.startsWith('target')) objs = tgt?.obj ? [tgt.obj] : [];
      else if (e.on === '~') objs = src.zone === 'battlefield' ? [src] : [];
      else if (e.on === 'attached') objs = src.attachedTo?.zone === 'battlefield' ? [src.attachedTo] : [];
      // "each green creature that entered this turn", "each artifact creature and/or vehicle you control"
      else if (e.on === 'each') objs = p.battlefield.filter(o => (o.fx.type.creature || /vehicle|artifact/.test(e.what)) && (!e.other || o !== src) && (!e.recent || o.enteredTurn === g.turn) && g.spellIs(o, e.what || 'creature'));
      else objs = p.battlefield.filter(o => o.fx.type.creature && (e.on.includes('other') ? o !== src : true));
      for (const o of objs) { const k = g.moreCounters(o, n); o.counters += k; g.fire('counterPut', { o, p: o.controller, by: p.idx, n: k }); }
      if (objs.length) g.log(`${S} puts ${n} +1/+1 counter${n === 1 ? '' : 's'} on ${objs.length === 1 ? g.cn(objs[0]) : objs.length + ' creatures'}`, { kind: 'minor' });
      break;
    }
    case 'reanimate': {
      // "from a graveyard" can take another player's card; the types it names (creature by default)
      const types = e.types?.length ? e.types : ['creature'];
      // (Sepulchral Primordial: one from each opponent's graveyard; Ink-Eyes: from that player's graveyard)
      const that = e.fromThat ? g.thatPlayer(p, ctx) : null;
      const yards = e.eachOpp ? g.opponents(p).map(q => [q]) : [that ? [that] : e.any ? g.alive() : [p]];
      for (const ys of yards) {
      // (Carmen, Alesha: mana value up to its power)
      const maxMv = e.maxMvPower ? Math.max(0, src.zone === 'battlefield' ? g.power(src) : 0) : e.maxMv;
      const pool = ys.flatMap(q => q.graveyard).filter(o => types.some(t => o.fx.type[t]) && o !== src && (maxMv == null || (o.card.cmc || 0) <= maxMv));
      const [c] = await g.pickCards(p, pool, 1, `${S}: choose a card to put onto the battlefield`);
      if (c) {
        const theirs = c.owner !== p.idx;
        g.move(c, 'battlefield', { under: p.idx });
        g.log(`${S} puts ${g.cn(c)} onto the battlefield from ${theirs ? `${g.pn(g.players[c.owner])}'s` : 'the'} graveyard`);
        g.trigger(c, 'etb');
        // (rules 6) Reanimate: you lose life equal to its mana value
        if (e.loseMv && g.rules >= 6 && c.card.cmc) { p.life -= c.card.cmc; g.emit('life', { p: p.idx, d: -c.card.cmc }); g.log(`${g.pn(p)} loses ${c.card.cmc} life (${S})`, { kind: 'minor' }); }
      }
      }
      break;
    }
    case 'regrow': {
      const pool = p.graveyard.filter(o => o !== src && (e.types?.length ? e.types.some(t => o.fx.type[t]) : !o.fx.type.land) && (e.maxMv == null || (o.card.cmc || 0) <= e.maxMv));
      // ("at random": Exalted Flamer of Tzeentch)
      const got = e.random ? (pool.length ? [pool[Math.floor(g.rand() * pool.length)]] : []) : await g.pickCards(p, pool, e.n || 1, `${S}: choose ${e.n > 1 ? `up to ${e.n} cards` : 'a card'} to return to your hand`);
      for (const c of got) g.move(c, e.top ? 'library' : 'hand');
      if (got.length) g.log(`${S} returns ${got.map(c => g.cn(c)).join(', ')} to ${g.pn(p)}'s hand`, { kind: 'minor' });
      break;
    }
    case 'edict': {
      const victims = e.that ? [g.thatPlayer(p, ctx)].filter(Boolean) : e.all ? g.alive() : g.opponents(p);
      const what = e.what || 'creature';
      for (const q of victims) for (let k = 0; k < (e.n || 1); k++) {
        const c = what === 'creature' && !e.nontoken ? q.agent.pickSacrifice(g, q)
          : q.battlefield.filter(o => g.isA(o, what.replace('nonland permanent', 'nonland')) && (!e.nontoken || !o.token)).sort((a, b) => q.agent.value(g, a) - q.agent.value(g, b))[0];
        if (c) g.sacrifice(q, c);
      }
      break;
    }
    default: await g.doEffectMore(p, src, e, ctx, tgt, X); break;
  }
}
// Xorn, Academy Manufactor, Peregrin Took: making tokens makes an extra artifact token too
/** @param {import('./engine.js').Game} g */
// (rules 6) What a removal spell's or counterspell's target controller gets: Swords to Plowshares' life (its power as
// it last existed), Path to Exile's basic land, Beast Within's token, An Offer You Can't Refuse's Treasures
/** @param {import('./engine.js').Game} g @param {any} q @param {any} src @param {any} comp @param {number} pow */
async function compensate(g, q, src, comp, pow) {
  if (!q || q.lost) return;
  const S = g.cn(src);
  if (comp.gain) {
    const gained = g.lifeGain(q, comp.gain === 'power' ? Math.max(0, pow) : comp.gain);
    if (gained > 0) { q.life += gained; g.emit('life', { p: q.idx, d: gained }); g.log(`${g.pn(q)} gains ${gained} life (${S})`, { kind: 'minor' }); }
  }
  if (comp.land) await g.fetchLands(q, { n: 1, basic: true, bf: true, tapped: comp.land.tapped }, src);
  if (comp.token) {
    const n = Math.min(g.tokenCount(q, comp.token.n), 40);
    for (let k = 0; k < n; k++) g.createToken(q, { k: 'token', ...comp.token }, src);
    if (n) g.log(`${g.pn(q)} creates ${n} ${comp.token.p}/${comp.token.t} ${comp.token.desc} token${n === 1 ? '' : 's'} (${S})`, { kind: 'minor' });
  }
  for (let k = 0; k < (comp.treasure || 0); k++) g.createTreasure(q, src);
  if (comp.treasure) g.log(`${g.pn(q)} creates ${comp.treasure} Treasure${comp.treasure === 1 ? '' : 's'} (${S})`, { kind: 'minor' });
}
// (rules 6) A token copy "except it has haste" (part of the copy, 707.9b), "isn't legendary" (Helm of the Host),
// sacrificed or exiled at the beginning of the next end step (Kiki-Jiki, Twinflame, Heat Shimmer)
/** @param {import('./engine.js').Game} g @param {any} copy @param {any} e */
function tokenCopyRiders(g, copy, e) {
  if (e.haste) copy.permKw = new Set([...(copy.permKw || []), 'haste']);
  if (e.notLegend) { copy.card = { ...copy.card, typeLine: (copy.card.typeLine || '').replace(/\bLegendary /, '') }; copy.fx = { ...copy.fx, type: { ...copy.fx.type, legendary: false } }; }
  if (e.temp) { if (e.temp === 'exile') copy.endExile = true; (g.endSac ||= []).push(copy); }
}
// (rules 6) "Exile target <type> card from a graveyard": an opponent's card first (Deathrite Shaman)
/** @param {import('./engine.js').Game} g @param {any} p @param {any} src @param {string[]} types */
function exileFromGraveyard(g, p, src, types) {
  for (const q of [...g.opponents(p), p]) {
    const c = q.graveyard.find((/** @type {any} */ o) => types.some(t => o.fx.type[t]));
    if (c) { g.move(c, 'exile'); g.log(`${g.cn(src)} exiles ${g.cn(c)} from ${g.pn(q)}'s graveyard`, { kind: 'minor' }); return true; }
  }
  g.log(`${g.cn(src)}: no ${types.join(' or ')} card in a graveyard`, { kind: 'minor' });
  return false;
}
// (rules 7) Demonic Consultation (e.consult: the number exiled first) and Tainted Pact (e.pact): cards come off the top
// one at a time, so naming a card that isn't there (or taking none) exiles the whole library, for Thassa's Oracle,
// Laboratory Maniac and Jace. The AI only asks what it already knows: its own library's contents, never their order.
/** @param {import('./engine.js').Game} g @param {any} p @param {any} src @param {any} e */
async function exileUntil(g, p, src, e) {
  const S = g.cn(src);
  const wantEmpty = !!p.agent.wantsEmptyLibrary?.(g, p, src);
  const top = () => p.library[p.library.length - 1];
  if (e.consult) {
    // (null: a name that isn't in the library)
    const name = p.agent.chooseConsultNameAsync ? await p.agent.chooseConsultNameAsync(g, p, src, wantEmpty)
      : wantEmpty ? null : p.agent.pickTutor(g, p, { types: [] })?.card.name || null;
    g.log(`${S}: ${g.pn(p)} names ${name ? esc(name) : "a card that isn't in their library"}`, { kind: 'minor' });
    let n = 0, found = null;
    for (let k = 0; k < e.consult && p.library.length; k++) { g.move(top(), 'exile'); n++; }
    while (p.library.length) {
      if (name && top().card.name === name) { found = top(); break; }
      g.move(top(), 'exile'); n++;
    }
    if (found) g.move(found, 'hand');
    g.log(`${S} exiles ${n} card${n === 1 ? '' : 's'}${found ? ` and puts ${g.cn(found)} into ${g.pn(p)}'s hand` : ` — ${g.pn(p)}'s library is now empty`}`, { kind: found ? 'minor' : 'removal' });
    return;
  }
  const seen = new Set();
  let n = 0;
  while (p.library.length && !g.over) {
    const c = top();
    g.move(c, 'exile');
    n++;
    if (seen.has(c.card.name)) { g.log(`${S} exiles a second ${g.cn(c)} and stops (${n} cards exiled)`, { kind: 'minor' }); return; }
    seen.add(c.card.name);
    const take = p.agent.takePactCardAsync ? await p.agent.takePactCardAsync(g, p, c, wantEmpty) : !!p.agent.takePactCard?.(g, p, c, wantEmpty);
    if (take) { g.move(c, 'hand'); g.log(`${S}: ${g.pn(p)} puts ${g.cn(c)} into their hand (${n} card${n === 1 ? '' : 's'} exiled)`, { kind: 'minor' }); return; }
  }
  g.log(`${S} exiles ${n} card${n === 1 ? '' : 's'} — ${g.pn(p)}'s library is now empty`, { kind: 'removal' });
}
// (rules 7) Chain of Smog: the player who discarded may copy it (choosing a new target), again and again. Copying an
// instant or sorcery triggers magecraft (Professor Onyx, Witherbloom Apprentice), which is the combo. The player decides
// each time; the AI stops when a copy no longer changes anyone's life total.
/** @param {import('./engine.js').Game} g @param {any} q @param {any} src @param {any} e */
async function chainCopies(g, q, src, e) {
  while (!g.over && !q.lost) {
    const t = q.agent.chainCopyTarget ? await q.agent.chainCopyTarget(g, q, src, e) : null;
    if (t == null || g.players[t]?.lost) return;
    const before = g.players.map(x => x.life).join();
    g.log(`${g.pn(q)} copies ${g.cn(src)}, targeting ${g.pn(g.players[t])}`, { kind: 'cast', p: q.idx, rule: '707.10' });
    for (const s of q.battlefield) if (s.fx.onCast && ['instant or sorcery', 'any', src.fx.type.instant ? 'instant' : 'sorcery'].includes(s.fx.onCast.what) && /cast or copy/.test(s.card.text || '') && (!s.fx.onCast.turnOnce9 || g.onceOk(s, 'cast'))) g.queue.push({ o: s, effects: s.fx.onCast.effects, label: `${src.card.name} was copied`, p: q, trig: { o: src, p: q.idx } });
    await g.flushTriggers();
    await g.sba();
    const v = g.players[t];
    if (g.over || v.lost) return;
    g.discard(v, (await v.agent.chooseDiscard(g, v, Math.min(e.n, v.hand.length))) || []);
    q.chainNoProgress = g.players.map(x => x.life).join() === before;
    q = v;
  }
}
export function extraTokens(g, p, kind, src) {
  for (const s of p.battlefield) {
    const k = s.fx.extraToken;
    if (!k || !(s.fx.extraTokenOn === 'any' || s.fx.extraTokenOn === kind || (s.fx.extraTokenOn === 'artifact' && kind !== 'creature') || (/clue, food, or treasure/.test(s.fx.extraTokenOn) && ['clue', 'food', 'treasure'].includes(kind)))) continue;
    if (k === 'treasure') g.createTreasure(p, s); else if (['food', 'clue', 'map', 'blood', 'powerstone'].includes(k)) g.createArtifactToken(p, k, s);
    // Stridehangar Automaton: an extra 1/1 Thopter (only for tokens that aren't its own Thopters)
    else if (s.fx.extraTokenStats && kind !== 'creature') g.createToken(p, { ...s.fx.extraTokenStats, desc: `colorless ${k} artifact` }, s);
    // Chatterfang: a 1/1 Squirrel for each creature token (only for tokens that aren't squirrels, so it doesn't feed itself)
    else if (k === 'squirrel' && kind !== 'squirrel') g.createToken(p, { p: 1, t: 1, desc: 'green squirrel', kw: [] }, s);
    else continue;
    g.log(`${g.cn(s)}: ${g.pn(p)} also creates a ${k[0].toUpperCase() + k.slice(1)} token`, { kind: 'minor' });
  }
}
// Doubling Season, Anointed Procession (twice as many tokens), and one-more effects
/** @param {import('./engine.js').Game} g */
export function tokenCount(g, p, n) {
  if (!(n > 0)) return n;
  // Primal Vigor: every player's tokens are doubled
  for (const q of g.alive()) for (const s of q.battlefield) if (s.fx.tokenBonusAll) n *= 2;
  for (const s of p.battlefield) { if (s.fx.tokenBonus === 'double') n *= 2; else if (s.fx.tokenBonus === 'triple') n *= 3; else if (s.fx.tokenBonus === 'plus') n += 1; }
  return n;
}
// Land drops this turn: one, plus Exploration-style permanents and "play an additional land this turn"
/** @param {import('./engine.js').Game} g */
export function landDrops(g, p) {
  return 1 + p.battlefield.reduce((s, o) => s + (o.fx.extraLands || 0), 0) + (p.extraLand?.turn === g.turn ? p.extraLand.n : 0)
    + g.alive().reduce((s, q) => s + q.battlefield.filter(o => o.fx.extraLandsAll).length, 0);
}
// Hardened Scales (one more) and Doubling Season-style (twice as many) +1/+1 counter replacements
/** @param {import('./engine.js').Game} g */
export function moreCounters(g, o, n) {
  if (n <= 0 || (!o.fx.type.creature && !g.players[o.controller]?.battlefield.some(s => s.fx.counterAny))) return n;
  const ops = [];
  if (o.fx.type.creature) for (const q of g.alive()) for (const s of q.battlefield) if (s.fx.counterBonusAll) ops.push({ mul: 2 });
  // Vorinclex, Monstrous Raider: opponents put half as many
  const putter = g.effectP ?? o.controller;
  if (g.alive().some(q => q.idx !== putter && q.battlefield.some(s => s.fx.counterHalfOpp) && g.opponents(q).some(x => x.idx === putter))) ops.push({ half: true });
  for (const s of g.players[o.controller].battlefield) {
    if (s.fx.counterBonus === 'plus') ops.push({ plus: 1 });
    else if (s.fx.counterBonus === 'double') ops.push({ mul: 2 });
  }
  // (Hardened Scales and Doubling Season: the permanent's controller orders them, for the most counters)
  return g.replaceInOrder(n, ops, 'max');
}
// Several replacement effects on one event (616.1): the affected player chooses the order they apply in. Every
// choice here is about an amount, so the order that's best for that player is used (most counters or life
// gained, least damage taken). Rules 4 and earlier applied them in battlefield order.
/** @param {import('./engine.js').Game} g */
export function applyOps(g, n, ops) {
  for (const op of ops) n = op.plus != null ? n + op.plus : op.mul != null ? n * op.mul : Math.floor(n / 2);
  return n;
}
/** @param {import('./engine.js').Game} g */
export function replaceInOrder(g, n, ops, want) {
  if (ops.length < 2 || g.rules < 5) return g.applyOps(n, ops);
  // (all orders for up to 6 effects; beyond that, additions first for "max" and last for "min")
  if (ops.length > 6) {
    const plus = ops.filter(op => op.plus != null), rest = ops.filter(op => op.plus == null);
    return g.applyOps(n, want === 'max' ? [...plus, ...rest] : [...rest, ...plus]);
  }
  let best = null;
  const perm = (left, done) => {
    if (!left.length) { const v = g.applyOps(n, done); if (best == null || (want === 'max' ? v > best : v < best)) best = v; return; }
    const tried = new Set();
    left.forEach((op, i) => { const k = JSON.stringify(op); if (tried.has(k)) return; tried.add(k); perm([...left.slice(0, i), ...left.slice(i + 1)], [...done, op]); });
  };
  perm(ops, []);
  return best;
}
// Choosing cards from a zone: a human seat picks, the AI takes the most valuable
/** @param {import('./engine.js').Game} g */
export async function pickCards(g, p, cards, n, text) {
  if (!cards.length || n <= 0) return [];
  if (p.agent.chooseCardsAsync) { const r = await p.agent.chooseCardsAsync(g, p, cards, n, text); if (r) return r; }
  return [...cards].sort((a, b) => p.agent.value(g, b) + (b.card.cmc || 0) * 0.3 - p.agent.value(g, a) - (a.card.cmc || 0) * 0.3).slice(0, n);
}
// A creature p would like to grow, pump or protect (their best one)
/** @param {import('./engine.js').Game} g */
export function bestOwnCreature(g, p, filter = (/** @type {any} */ _o) => true) { return p.agent.bestOwn(g, p, o => o.fx.type.creature && filter(o)); }

// The newer effects: library manipulation, keyword actions, conditions, graveyard work
/** @param {import('./engine.js').Game} g */
export async function doEffectMore(g, p, src, e, ctx, tgt, X) {
  const S = g.cn(src);
  switch (e.k) {
    case 'if': {
      let ok = g.evalCond(p, src, e.cond, ctx);
      // An unreadable condition on an "instead" upgrade keeps the plain version, and never wins the game
      if (e.cond.c === '?' && (e.else || e.effects.some(x => x.k === 'win'))) ok = false;
      const branch = ok ? e.effects : e.else || [];
      if (e.cond.c !== '?' && branch.length) g.log(`${S}: ${ok ? '' : 'not '}${esc(condText(e.cond))}`, { kind: 'minor' });
      await g.runEffects(p, src, branch, { ...ctx, targets: undefined, strict: false });
      break;
    }
    case 'scry': case 'surveil': {
      const n = Math.min(X(e.n), p.library.length);
      if (!n) break;
      const top = p.library.slice(-n).reverse();
      let { keep, away } = await (p.agent.chooseScryAsync ? p.agent.chooseScryAsync(g, p, top, e.k) : p.agent.chooseScry(g, p, top, e.k));
      // "Put them back in any order": nothing leaves the top, only the order changes
      if (e.keepAll) { keep = [...keep, ...away]; away = []; }
      p.library.splice(p.library.length - n, n);
      for (const o of away) {
        if (e.k === 'scry') p.library.unshift(o);
        else { o.zone = 'library'; p.library.push(o); g.move(o, 'graveyard'); }
      }
      for (const o of [...keep].reverse()) p.library.push(o);
      g.log(`${g.pn(p)} ${e.k === 'scry' ? 'scries' : 'surveils'} ${n}: ${keep.length} on top, ${away.length} ${e.k === 'scry' ? 'on the bottom' : 'into the graveyard'}`, { kind: 'minor', rule: e.k === 'scry' ? '701.22a' : '701.46a' });
      break;
    }
    case 'dig': {
      const n = Math.min(X(e.n), p.library.length);
      if (!n) break;
      const seen = p.library.splice(p.library.length - n, n).reverse();
      const ok = o => (!e.types.length || e.types.some(t => o.fx.type[t])) && (!e.chosen || !src.chosenType || g.isA(o, src.chosenType));
      const take = await g.pickCards(p, seen.filter(ok), e.take >= 99 ? 99 : e.take, `${S}: choose what to take from the top ${n}`);
      for (const o of seen) { o.zone = 'library'; }
      p.library.push(...take);
      for (const o of take) g.move(o, e.bf && o.fx.type.permanent ? 'battlefield' : 'hand');
      for (const o of take) if (o.zone === 'battlefield') g.trigger(o, 'etb');
      const rest = seen.filter(o => !take.includes(o));
      if (e.gy) { p.library.push(...rest); for (const o of rest) g.move(o, 'graveyard'); } else p.library.unshift(...rest);
      g.log(`${g.pn(p)} looks at the top ${n} cards and takes ${take.length ? take.map(o => g.cn(o)).join(', ') : 'nothing'} (${S})`, { kind: 'minor' });
      break;
    }
    case 'impulse': {
      const got = [];
      for (let k = 0; k < X(e.n) && p.library.length > 1; k++) {
        const o = p.library[p.library.length - 1];
        g.move(o, 'exile');
        o.mayPlay = { p: p.idx, until: g.turn + (e.next ? g.alive().length : 0), free: !!e.free };
        got.push(o);
      }
      if (got.length) g.log(`${g.pn(p)} exiles ${got.map(o => g.cn(o)).join(', ')} and may play ${got.length === 1 ? 'it' : 'them'} ${e.next ? 'until their next turn' : 'this turn'}`, { kind: 'minor' });
      break;
    }
    case 'artifactToken': { const n = g.tokenCount(p, X(e.n)); for (let k = 0; k < n; k++) g.createArtifactToken(p, e.kind, src); g.log(`${g.pn(p)} creates ${n} ${e.kind[0].toUpperCase() + e.kind.slice(1)} token${n === 1 ? '' : 's'}`, { kind: 'minor' }); if (n > 0) g.extraTokens(p, e.kind, src); break; }
    case 'fight': {
      const foe = tgt?.obj;
      const mine = src.zone === 'battlefield' && src.fx.type.creature ? src : g.bestOwnCreature(p, o => o !== foe);
      if (!foe || !mine || foe.zone !== 'battlefield') break;
      g.damageObj(foe, g.power(mine), mine);
      if (!e.bite) g.damageObj(mine, g.power(foe), foe);
      g.log(e.bite ? `${g.cn(mine)} deals ${g.power(mine)} damage to ${g.cn(foe)}` : `${g.cn(mine)} fights ${g.cn(foe)}`, { kind: 'removal', rule: e.bite ? null : '701.14a' });
      break;
    }
    case 'goad': {
      const objs = e.all ? g.opponents(p).flatMap(q => q.battlefield.filter(o => o.fx.type.creature)) : tgt?.obj ? [tgt.obj] : [];
      for (const o of objs) o.goaded = { by: p.idx, until: g.turn + g.alive().length };
      if (objs.length) g.log(`${g.pn(p)} goads ${objs.length === 1 ? g.cn(objs[0]) : `${objs.length} creatures`}: they must attack, and not ${g.pn(p)}, if able`, { kind: 'removal', rule: '701.15' });
      break;
    }
    case 'proliferate': {
      let n = 0;
      for (const o of p.battlefield) {
        if (o.counters > 0) { o.counters++; n++; }
        if (o.fx.type.planeswalker) { o.loyalty++; n++; }
        if (o.timeCounters > 0 && o.fx.kwN?.fading) { o.timeCounters++; }
      }
      for (const q of g.opponents(p)) {
        if (q.poison > 0) { q.poison++; n++; }
        for (const o of q.battlefield) if (o.counters < 0) { o.counters--; n++; }
      }
      g.log(`${g.pn(p)} proliferates (${n} counter${n === 1 ? '' : 's'} added)`, { kind: 'minor', rule: '701.27a' });
      g.fire('proliferate', { p: p.idx });
      // Tekuthal: proliferate twice
      if (!e.again && p.battlefield.some(s => s.fx.proliferateTwice)) await g.doEffectMore(p, src, { ...e, again: true }, ctx, tgt, X);
      break;
    }
    case 'populate': {
      const model = p.agent.bestOwn(g, p, o => o.token && o.fx.type.creature);
      if (model) { const c = g.createCopy(p, model, false); g.log(`${g.pn(p)} populates: a copy of ${g.cn(model)}`, { kind: 'minor', rule: '701.30a' }); g.trigger(c, 'etb'); }
      break;
    }
    case 'monstrous':
      if (src.zone === 'battlefield' && !src.monstrous) { src.monstrous = true; src.counters += X(e.n); g.fire('counterPut', { o: src, p: src.controller, by: p.idx, n: X(e.n) }); g.log(`${S} becomes monstrous (+${X(e.n)} counters)`, { kind: 'minor', rule: '701.37a' }); }
      break;
    case 'adapt':
      if (src.zone === 'battlefield' && src.counters <= 0) { src.counters += X(e.n); g.fire('counterPut', { o: src, p: src.controller, by: p.idx, n: X(e.n) }); g.log(`${S} adapts (+${X(e.n)})`, { kind: 'minor', rule: '701.46a' }); }
      break;
    case 'bolster': {
      const o = p.battlefield.filter(c => c.fx.type.creature).sort((a, b) => g.toughness(a) - g.toughness(b))[0];
      if (o) { o.counters += X(e.n); g.fire('counterPut', { o, p: o.controller, by: p.idx, n: X(e.n) }); g.log(`${g.pn(p)} bolsters ${X(e.n)}: ${g.cn(o)}`, { kind: 'minor', rule: '701.39a' }); }
      break;
    }
    case 'support': {
      const objs = p.battlefield.filter(c => c.fx.type.creature && c !== src).sort((a, b) => p.agent.value(g, b) - p.agent.value(g, a)).slice(0, e.n);
      for (const o of objs) o.counters++;
      if (objs.length) g.log(`${S} supports ${objs.length} creature${objs.length === 1 ? '' : 's'}`, { kind: 'minor' });
      break;
    }
    case 'connive': {
      g.draw(p, 1, true);
      const [d] = await p.agent.chooseDiscard(g, p, 1) || [];
      if (d) g.discard(p, [d], null);
      if (d && !d.fx.type.land && src.zone === 'battlefield' && src.fx.type.creature) src.counters++;
      g.log(`${S} connives${d ? `, discarding ${g.cn(d)}` : ''}`, { kind: 'minor', rule: '701.50a' });
      break;
    }
    case 'explore': {
      const who = src.zone === 'battlefield' && src.fx.type.creature ? src : g.bestOwnCreature(p);
      const top = p.library[p.library.length - 1];
      if (!who || !top) break;
      if (top.fx.type.land) { g.move(top, 'hand'); g.log(`${g.cn(who)} explores and reveals a land (${g.cn(top)}), which goes to hand`, { kind: 'minor', rule: '701.44a' }); }
      else {
        who.counters++;
        const lands = p.battlefield.filter(o => o.fx.type.land).length;
        const keep = (top.card.cmc || 0) <= lands + 2;
        if (!keep) g.move(top, 'graveyard');
        g.log(`${g.cn(who)} explores: +1/+1 counter, ${keep ? 'keeps the top card' : `puts ${g.cn(top)} into the graveyard`}`, { kind: 'minor', rule: '701.44a' });
      }
      break;
    }
    case 'cascade': {
      // Cascade and discover: exile until a nonland card that costs less, cast it free, the rest go to the bottom
      const limit = e.discover ? e.n : (e.n ?? 99) - 1;
      const exiled = [];
      let hit = null;
      while (p.library.length) {
        const o = p.library[p.library.length - 1];
        g.move(o, 'exile');
        exiled.push(o);
        if (!o.fx.type.land && (o.card.cmc || 0) <= limit && o.card.manaCost) { hit = o; break; }
      }
      g.log(`${S}: ${e.discover ? `discover ${e.n}` : 'cascade'} reveals ${hit ? g.cn(hit) : 'nothing castable'} (${exiled.length} card${exiled.length === 1 ? '' : 's'} exiled)`, { kind: 'minor', rule: e.discover ? '701.57a' : '702.85a' });
      for (const o of exiled) if (o !== hit) { p.exile.splice(p.exile.indexOf(o), 1); o.zone = 'library'; p.library.unshift(o); }
      if (hit) await g.cast(p, hit, { mode: { alt: 'free' } });
      break;
    }
    case 'regen': {
      if (e.all) { for (const o of p.battlefield) if (o.fx.type.creature) o.regen = (o.regen || 0) + 1; g.log(`${S}: ${g.pn(p)}'s creatures get regeneration shields`, { kind: 'minor', rule: '701.15a' }); break; }
      const o = e.self ? (src.zone === 'battlefield' ? src : null) : tgt?.obj;
      if (o) { o.regen = (o.regen || 0) + 1; g.log(`${g.cn(o)} gets a regeneration shield`, { kind: 'minor', rule: '701.15a' }); }
      break;
    }
    case 'tap': if (tgt?.obj) { tgt.obj.tapped = true; g.log(`${S} taps ${g.tname(tgt)}`, { kind: 'minor' }); } break;
    case 'tapAll': {
      let n = 0;
      for (const q of g.opponents(p)) for (const o of q.battlefield) if (g.isA(o, e.what.replace(/s$/, '').replace('nonland permanent', 'nonland'))) { o.tapped = true; n++; }
      g.log(`${S} taps ${n} of the opponents' ${e.what}`, { kind: 'removal' });
      break;
    }
    case 'drawEach': for (const q of g.alive()) g.draw(q, X(e.n)); break;
    case 'discardSelf': {
      const cards = (await p.agent.chooseDiscard(g, p, Math.min(X(e.n), p.hand.length))) || [];
      g.discard(p, cards);
      break;
    }
    case 'sacOwn': {
      const pool = p.battlefield.filter(o => o !== src && g.isA(o, e.what.replace('nonland permanent', 'nonland')));
      const cs = pool.sort((a, b) => p.agent.value(g, a) + p.agent.pieceWorth(g, p, a) - p.agent.value(g, b) - p.agent.pieceWorth(g, p, b)).slice(0, e.n || 1);
      for (const c of cs) g.sacrifice(p, c);
      break;
    }
    case 'minus': {
      const objs = e.on.startsWith('target') ? (tgt?.obj ? [tgt.obj] : [])
        : e.on.includes('opponents') || e.on.includes("don't") ? g.opponents(p).flatMap(q => q.battlefield.filter(o => o.fx.type.creature))
          : g.alive().flatMap(q => q.battlefield.filter(o => o.fx.type.creature && (e.on.includes('other') ? o !== src : true)));
      for (const o of objs) { o.counters -= X(e.n); o.hadMinus = true; }
      if (objs.length) g.log(`${S} puts ${X(e.n)} -1/-1 counter${X(e.n) === 1 ? '' : 's'} on ${objs.length === 1 ? g.cn(objs[0]) : objs.length + ' creatures'}`, { kind: 'removal', rule: '704.5q' });
      break;
    }
    case 'shrink': if (tgt?.obj) { tgt.obj.tempP -= X(e.p); tgt.obj.tempT -= X(e.t); g.log(`${g.tname(tgt)} gets -${X(e.p)}/-${X(e.t)}`, { kind: 'removal' }); } break;
    case 'shrinkAll': {
      // (Crippling Fear: the caster names the creature type it has most of, and those are spared)
      const keep = e.keepType ? g.bestType(p) : null;
      const objs = (e.opp ? g.opponents(p) : g.alive()).flatMap(q => q.battlefield.filter(o => o.fx.type.creature && (!e.other || o !== src) && !(keep && g.isA(o, keep)) && !(e.keepTribe && g.isA(o, e.keepTribe))));
      for (const o of objs) { o.tempP -= X(e.p); o.tempT -= X(e.t); }
      g.log(`${S}: ${e.opp ? "opponents' creatures" : 'all creatures'} get -${X(e.p)}/-${X(e.t)}`, { kind: 'removal' });
      break;
    }
    case 'addManaN': {
      // (rules 7) Food Chain: X counts the exiled creature's mana value (the "1 plus" is the {any} after it),
      // and the mana is for creature spells only
      const r7 = g.rules >= 7 && e.exiledMv;
      const n = r7 ? p.lastExiledMv || 0 : Math.min(X(e.n), 30);
      for (let k = 0; k < n; k++) p.pool.push({ colors: e.color ? [e.color] : [...COLORS], ...(r7 && e.only ? { only: e.only } : {}) });
      if (n) g.log(`${g.pn(p)} adds ${n} mana (${S})`, { kind: 'minor' });
      break;
    }
    case 'drawThat': { const q = g.thatPlayer(p, ctx) || (ctx.trig?.p != null ? g.players[ctx.trig.p] : null); if (q && !q.lost) g.draw(q, X(e.n)); break; }
    case 'freeCast': {
      const pool = p.hand.filter(o => !o.fx.type.land && (o.card.cmc || 0) <= e.maxMv && (!e.types.length || e.types.some(t => o.fx.type[t])));
      const [c] = await g.pickCards(p, pool, 1, `${S}: choose a spell to cast for free`);
      if (c) await g.cast(p, c, { mode: { alt: 'free' } });
      break;
    }
    case 'namedCounter':
      // (a loyalty counter on a planeswalker is loyalty: Ral, Crackling Wit)
      if (src.zone === 'battlefield' && e.kind === 'loyalty' && src.fx.type.planeswalker) { src.loyalty += X(e.n ?? 1); g.log(`${S} gets a loyalty counter (${src.loyalty})`, { kind: 'minor' }); }
      else if (src.zone === 'battlefield') { const k = X(e.n ?? 1); (src.named ||= {})[e.kind] = (src.named[e.kind] || 0) + k; g.log(`${S} gets ${k === 1 ? 'a' : k} ${e.kind} counter${k === 1 ? '' : 's'} (${src.named[e.kind]})`, { kind: 'minor' }); }
      break;
    case 'grantFlashback': {
      const pool = p.graveyard.filter(o => (o.fx.type.instant || o.fx.type.sorcery) && o !== src);
      const got = e.all ? pool : [p.agent.pickBest(g, pool.filter(o => o.fx.spell.length))].filter(Boolean);
      for (const o of got) o.tempFlashback = g.turn;
      if (got.length) g.log(`${S}: ${got.length === 1 ? g.cn(got[0]) + ' gains' : got.length + ' cards in ' + g.pn(p) + "'s graveyard gain"} flashback this turn`, { kind: 'minor', rule: '702.34a' });
      break;
    }
    case 'payFor': {
      // (rules 7) Nim Deathmantle: pay to return the creature that died to the battlefield, then attach to it
      if (g.rules >= 7 && e.returnTrig) {
        const card = ctx.trig?.o;
        const plan = card?.zone === 'graveyard' && g.planPayment(p, parseCost(e.cost), 0);
        if (!plan) break;
        const c = parseCost(e.cost);
        const worth = p.agent.value(g, card) + card.fx.etb.reduce((s, x) => s + p.agent.effectValue(g, p, card, x, false), 0) + (card.fx.etb.some(x => x.k === 'untapAll' && x.what === 'lands') ? 4 : 0);
        const yes = p.agent.confirmPayAsync ? await p.agent.confirmPayAsync(g, p, src, e.cost, `return ${card.card.name} to the battlefield`) : worth > (c.generic + c.pips.length) * 0.6;
        if (!yes) break;
        g.commitPayment(p, plan);
        g.log(`${g.pn(p)} pays ${esc(e.cost)} (${S})`, { kind: 'minor' });
        g.move(card, 'battlefield', { under: p.idx });
        g.log(`${S} returns ${g.cn(card)} to the battlefield`, { kind: 'minor' });
        if (src.zone === 'battlefield') { src.attachedTo = card; g.log(`${S} is attached to ${g.cn(card)}`, { kind: 'minor' }); }
        g.trigger(card, 'etb');
        break;
      }
      const plan = g.planPayment(p, parseCost(e.cost), 0);
      const worth = e.effects.reduce((s, x) => s + p.agent.effectValue(g, p, src, x, false), 0);
      const c = parseCost(e.cost);
      if (plan && worth > (c.generic + c.pips.length) * 0.6) {
        g.commitPayment(p, plan);
        g.log(`${g.pn(p)} pays ${esc(e.cost)} (${S})`, { kind: 'minor' });
        await g.runEffects(p, src, e.effects, { ...ctx, targets: undefined, strict: false });
      }
      break;
    }
    case 'modal': {
      const chosen = p.agent.chooseModes(g, p, src, e);
      await g.runEffects(p, src, chosen, { ...ctx, targets: undefined, strict: false });
      break;
    }
    case 'doubleCounters': {
      const objs = e.on === '~' ? [src] : e.on === 'enchanted creature' ? [src.attachedTo].filter(Boolean) : e.on.startsWith('target') ? [p.agent.bestOwn(g, p)].filter(Boolean) : p.battlefield.filter(o => o.fx.type.creature);
      for (const o of objs) if (o.zone === 'battlefield') {
        if (o.counters > 0) o.counters *= 2;
        // ("each kind of counter": Vorel, Zimone, Deepglow Skate)
        if (e.all && o.named) for (const k of Object.keys(o.named)) o.named[k] *= 2;
        if (e.all && o.fx.type.planeswalker) o.loyalty *= 2;
      }
      g.log(`${S} doubles the +1/+1 counters on ${objs.length === 1 ? g.cn(objs[0]) : 'your creatures'}`, { kind: 'minor' });
      break;
    }
    case 'returnSelfHand':
      if (src.zone === 'graveyard') { g.move(src, 'hand'); g.log(`${S} returns to ${g.pn(p)}'s hand`, { kind: 'minor' }); }
      break;
    case 'fog':
      g.fogTurn = g.turn;
      g.log(`${S}: all combat damage is prevented this turn`, { kind: 'removal', rule: '615.1' });
      break;
    // ---- 1.7.0
    case 'preventMe':
      p.preventTurn = g.turn;
      g.log(`${S}: all damage that would be dealt to ${g.pn(p)} this turn is prevented`, { kind: 'minor', rule: '615.1' });
      break;
    case 'millHalf': {
      const who = e.who === 'each opponent' ? g.opponents(p) : tgt?.player != null ? [g.players[tgt.player]] : [p.agent.weakestOpponent(g, p)].filter(Boolean);
      for (const q of who) {
        const k = e.up ? Math.ceil(q.library.length / 2) : Math.floor(q.library.length / 2);
        for (let j = 0; j < k; j++) g.move(q.library[q.library.length - 1], 'graveyard');
        g.log(`${g.pn(q)} mills ${k} cards, half their library (${S})`, { kind: 'removal', rule: '701.13a' });
      }
      break;
    }
    case 'doubleLife': {
      const q = tgt?.player != null ? g.players[tgt.player] : p;
      const n = g.lifeGain(q, Math.max(0, q.life));
      q.life += n; g.emit('life', { p: q.idx, d: n });
      g.log(`${S}: ${g.pn(q)}'s life total doubles to ${q.life}`, { kind: 'minor' });
      break;
    }
    case 'shuffleSelf':
      if (src.zone !== 'library') { g.move(src, 'library', { shuffle: true }); g.log(`${S} is shuffled into its owner's library`, { kind: 'minor' }); }
      break;
    case 'loseHalf': {
      const q = g.thatPlayer(p, ctx) || (ctx.trig?.p != null ? g.players[ctx.trig.p] : null);
      if (q && !q.lost && q.life > 0) { const n = Math.ceil(q.life / 2); q.life -= n; q.grudge[p.idx] += n; g.emit('life', { p: q.idx, d: -n }); g.log(`${S}: ${g.pn(q)} loses half their life (${n})`, { kind: 'damage' }); }
      break;
    }
    case 'bounceOpp': {
      const q = g.opponents(p).sort((a, b) => b.battlefield.filter(o => !o.fx.type.land).length - a.battlefield.filter(o => !o.fx.type.land).length)[0];
      if (!q) break;
      const objs = q.battlefield.filter(o => !o.fx.type.land);
      for (const o of objs) g.move(o, 'hand');
      g.log(`${S} returns ${objs.length} of ${g.pn(q)}'s nonland permanents to hand`, { kind: 'removal' });
      break;
    }
    case 'sacUnlessPay': case 'sacUnlessTap': {
      if (src.zone !== 'battlefield') break;
      if (e.k === 'sacUnlessPay') {
        const plan = g.planPayment(p, { generic: e.n, pips: [], x: 0 });
        if (plan) { g.commitPayment(p, plan); g.log(`${g.pn(p)} pays {${e.n}} to keep ${g.cn(src)}`, { kind: 'minor' }); break; }
      } else {
        const t = p.battlefield.find(o => o !== src && !o.tapped && !o.fx.mana) || p.battlefield.find(o => o !== src && !o.tapped);
        if (t) { t.tapped = true; g.log(`${g.pn(p)} taps ${g.cn(t)} to keep ${g.cn(src)}`, { kind: 'minor' }); break; }
      }
      g.sacrifice(p, src);
      break;
    }
    case 'noBlock':
      if (tgt?.obj) { tgt.obj.noBlockTurn = g.turn; if (e.attack) tgt.obj.noAttackTurn = g.turn; g.log(`${S}: ${g.tname(tgt)} can't ${e.attack ? 'attack or ' : ''}block this turn`, { kind: 'minor' }); }
      break;
    case 'keepOne': {
      const who = e.who === 'each' ? g.alive() : [g.thatPlayer(p, ctx) || (ctx.trig?.p != null ? g.players[ctx.trig.p] : null)].filter(q => q && !q.lost);
      for (const q of who) {
        const pool = q.battlefield.filter(o => o.fx.type.creature || (e.pw && o.fx.type.planeswalker)).sort((a, b) => q.agent.value(g, b) - q.agent.value(g, a));
        const gone = pool.slice(e.n);
        for (const o of gone) g.sacrifice(q, o);
        if (gone.length) g.log(`${g.pn(q)} keeps ${pool.slice(0, e.n).map(o => g.cn(o)).join(' and ')} and sacrifices ${gone.length} other${gone.length === 1 ? '' : 's'} (${S})`, { kind: 'removal' });
      }
      break;
    }
    case 'gyExileTurn':
      p.gyExileTurn = g.turn;
      break;
    case 'exploit': {
      if (src.zone !== 'battlefield') break;
      // A token or the least useful creature; itself only when nothing else will do and the payoff is worth it
      const fodder = p.battlefield.filter(o => o !== src && o.fx.type.creature && !o.isCommander).sort((a, b) => p.agent.value(g, a) - p.agent.value(g, b))[0] || (src.fx.exploitFx ? src : null);
      if (!fodder || (fodder !== src && p.agent.value(g, fodder) > 4 && !src.fx.exploitFx)) break;
      g.log(`${S} exploits ${fodder === src ? 'itself' : g.cn(fodder)}`, { kind: 'minor', rule: '702.110a' });
      g.sacrifice(p, fodder);
      if (src.fx.exploitFx) await g.runEffects(p, src, src.fx.exploitFx, { ...ctx, targets: undefined, strict: false });
      break;
    }
    case 'nonbasicBurn':
      for (const q of g.alive()) {
        const n = q.battlefield.filter(o => o.fx.type.land && !o.fx.type.basic).length * (e.times || 1);
        if (n) { g.damagePlayer(q, n, src, false); g.log(`${S} deals ${n} damage to ${g.pn(q)}`, { kind: 'damage' }); }
      }
      break;
    case 'win':
      if (g.kingdoms) { g.log(`${S}: "win the game" does nothing in Kingdoms`, { kind: 'minor', rule: 'Kingdoms' }); break; }
      g.winNote = `${src.card.name}`;
      g.log(`🏆 ${S}: ${g.pn(p)} wins the game`, { kind: 'win', rule: '104.2b' });
      for (const q of g.opponents(p)) g.lose(q, `${src.card.name}`, '104.3');
      break;
    case 'exileSelf':
      if (src.zone === 'battlefield') { g.move(src, 'exile'); g.log(`${S} is exiled`, { kind: 'minor' }); }
      break;
    case 'untapSelf':
      if (src.zone === 'battlefield' && src.tapped) { src.tapped = false; g.log(`${S} untaps`, { kind: 'minor' }); }
      // (rules 7) Basalt Monolith + Rings of Brighthearth: with the copy resolved first, the untapped Monolith can
      // be tapped for mana again (a mana ability, while the original still waits on the stack)
      if (g.rules >= 7 && e.retap && !src.tapped && src.fx.mana && p.agent.retapForMana?.(g, p, src) !== false) g.tapForMana(p, src);
      break;
    // ---- rules 7 (combo audit)
    case 'castImprint': {
      // Isochron Scepter: copy the imprinted card and cast the copy without paying its mana cost
      if (g.rules < 7) break;
      const card = src.imprintedObj?.card;
      if (!card) { g.log(`${S} has nothing imprinted`, { kind: 'minor' }); break; }
      const copy = g.mk(card, p, { token: true });
      copy.zone = 'copy';
      copy.spellCopy = true;
      g.log(`${g.pn(p)} copies ${g.cn(copy)} (${S})`, { kind: 'minor', rule: '707.12' });
      await g.cast(p, copy, { mode: { alt: 'free' } });
      break;
    }
    case 'bounceOther': {
      // Temur Sabertooth: return another creature you control to its owner's hand
      if (g.rules < 7) break;
      const pool = p.battlefield.filter(o => o !== src && g.isA(o, e.what || 'creature'));
      const pick = p.agent.chooseCardsAsync ? (await g.pickCards(p, pool, 1, `${S}: return another creature you control to its owner's hand`))[0]
        : [...pool].sort((a, b) => (b.fx.etb.length ? 1 : 0) - (a.fx.etb.length ? 1 : 0) || (a.token ? 1 : 0) - (b.token ? 1 : 0) || (a.card.cmc || 0) - (b.card.cmc || 0))[0];
      if (pick) { g.move(pick, 'hand'); g.log(`${S} returns ${g.cn(pick)} to ${pick.token ? 'nowhere (a token)' : 'its owner\'s hand'}`, { kind: 'minor' }); }
      break;
    }
    case 'returnLowPower': {
      // Reveillark: up to two creature cards with power 2 or less from your graveyard to the battlefield
      const pool = p.graveyard.filter(o => o.fx.type.creature && o !== src && g.basePower(o.card) <= e.maxPower);
      const picks = await g.pickCards(p, pool, e.n, `${S}: return up to ${e.n} creature cards with power ${e.maxPower} or less`);
      for (const o of picks) { g.move(o, 'battlefield'); g.log(`${S} returns ${g.cn(o)} to the battlefield`, { kind: 'minor' }); g.trigger(o, 'etb'); }
      break;
    }
    case 'makeColor': {
      // Grand Architect: target artifact creature becomes blue until end of turn
      const pool = p.battlefield.filter(o => g.isA(o, e.what) && !g.colorsOf(o).includes(e.color));
      const o = tgt?.obj && pool.includes(tgt.obj) ? tgt.obj : [...pool].sort((a, b) => g.abilitiesOf(b).length - g.abilitiesOf(a).length)[0];
      if (o) { o.tempColor = { turn: g.turn, color: e.color }; g.log(`${g.cn(o)} becomes ${{ W: 'white', U: 'blue', B: 'black', R: 'red', G: 'green' }[e.color]} until end of turn (${S})`, { kind: 'minor' }); }
      break;
    }
    case 'evade': {
      const o = e.self ? src : tgt?.obj;
      if (o?.zone === 'battlefield') { o.tempKw = new Set([...(o.tempKw || []), 'unblockable']); g.log(`${g.cn(o)} can't be blocked this turn`, { kind: 'minor' }); }
      break;
    }
    case 'kwCounter': {
      if (e.all) { for (const c of p.battlefield) if (c.fx.type.creature) (c.permKw ||= new Set()).add(e.kw); g.log(`${S}: ${g.pn(p)}'s creatures get ${e.kw} counters`, { kind: 'minor', rule: '122.1b' }); break; }
      const o = e.self ? src : tgt?.obj;
      if (o?.zone === 'battlefield') {
        (o.permKw ||= new Set()).add(e.kw);
        // (Gift of the Viper: a +1/+1 counter and more keyword counters too)
        for (const k of e.also || []) o.permKw.add(k);
        if (e.plus) o.counters += g.moreCounters(o, e.plus);
        g.log(`${g.cn(o)} gets ${/^[aeiou]/.test(e.kw) ? 'an' : 'a'} ${e.kw} counter${e.also?.length || e.plus ? ' and more' : ''}`, { kind: 'minor', rule: '122.1b' });
      }
      break;
    }
    case 'topLandOrHand': {
      const top = p.library[p.library.length - 1];
      if (!top) break;
      g.move(top, top.fx.type.land ? 'battlefield' : 'hand');
      g.log(`${g.pn(p)} reveals ${g.cn(top)}: ${top.fx.type.land ? 'onto the battlefield' : 'into their hand'}`, { kind: 'minor' });
      break;
    }
    case 'animate': {
      if (src.zone !== 'battlefield') break;
      src.animPT = { p: X(e.p), t: X(e.t), turn: g.turn, ts: ++g.tsN };
      if (!src.fx.type.creature) { src.crewed = true; src.fx = { ...src.card.fx, type: { ...src.card.fx.type, creature: true } }; }
      if (e.kw.length) src.tempKw = new Set([...(src.tempKw || []), ...e.kw]);
      g.log(`${S} becomes a ${e.p}/${e.t} creature until end of turn`, { kind: 'minor' });
      break;
    }
    case 'manifest': g.manifest(p, e, ctx); break;
    case 'siegeCast': {
      // A defeated Siege: exile it, then its controller may cast it transformed without paying its mana cost (310.11b)
      if (src.zone !== 'graveyard') break;
      g.move(src, 'exile');
      g.useFace(src, src.card.backCard);
      const ok = await g.cast(p, src, { mode: { alt: 'free' } });
      if (!ok && src.zone === 'exile') g.mainFace(src);
      break;
    }
    case 'tuck': {
      // (its owner chooses top or bottom: the top, to draw it again)
      const o = tgt?.obj;
      if (!o || o.zone !== 'battlefield') break;
      g.log(`${S} puts ${g.cn(o)} on top of its owner's library`, { kind: 'removal' });
      g.move(o, 'library');
      break;
    }
    case 'suspect': if (src.zone === 'battlefield') { src.suspected = true; g.log(`${S} is suspected (menace, can't block)`, { kind: 'minor', rule: '701.60a' }); } break;
    case 'scrollRack': {
      // (the weakest cards in hand, up to three, go on top; that many come off the top first)
      const worst = [...p.hand].map(o => ({ o, v: p.agent.value(g, o) + p.agent.pieceWorth(g, p, o) * 2 + (o.fx.type.land && p.battlefield.filter(x => x.fx.type.land).length < 5 ? 3 : 0) }))
        .filter(x => x.v < 3).sort((a, b) => a.v - b.v).slice(0, Math.min(3, p.library.length)).map(x => x.o);
      if (!worst.length) { g.log(`${S}: ${g.pn(p)} keeps their hand`, { kind: 'minor' }); break; }
      for (const o of worst) g.move(o, 'exile');
      const got = p.library.splice(-worst.length).reverse();
      for (const o of got) { o.zone = 'hand'; p.hand.push(o); }
      for (const o of worst) g.move(o, 'library');
      g.log(`${S}: ${g.pn(p)} swaps ${worst.length} card${worst.length === 1 ? '' : 's'} in hand for the top of their library`, { kind: 'minor' });
      break;
    }
    case 'venture': if (g.rules >= 5) await g.venture(p); break;
    case 'initiative': if (g.rules >= 5) await g.takeInitiative(p); break;
    case 'madnessCast': {
      // (cast it now for its madness cost, or it goes to the graveyard)
      const o = src;
      if (!o.madnessPending || o.zone !== 'exile') break;
      o.madnessPending = false;
      const can = !p.lost && !!g.planPayment(p, parseCost(o.fx.madness), 0);
      const want = can && (p.agent.wantsMadnessAsync ? await p.agent.wantsMadnessAsync(g, p, o) : p.agent.wantsMadness ? p.agent.wantsMadness(g, p, o) : true);
      if (!want || !(await g.cast(p, o, { mode: { alt: 'madness' } }))) {
        if (o.zone === 'exile') { g.move(o, 'graveyard'); g.log(`${g.cn(o)} goes to the graveyard (madness not used)`, { kind: 'minor' }); }
      }
      break;
    }
    case 'attachSelf': {
      const o = ctx.made?.zone === 'battlefield' ? ctx.made : p.agent.bestOwn(g, p, x => x.fx.type.creature && x !== src);
      if (o && src.zone === 'battlefield') { src.attachedTo = o; g.log(`${S} is attached to ${g.cn(o)}`, { kind: 'minor' }); }
      break;
    }
    case 'loseThat': {
      const q = g.thatPlayer(p, ctx);
      if (q) { const n = X(e.n); q.life -= n; g.emit('life', { p: q.idx, d: -n }); g.log(`${S}: ${g.pn(q)} loses ${n} life`); }
      break;
    }
    case 'poison': {
      const who = e.who === 'that player' ? [g.thatPlayer(p, ctx)].filter(Boolean) : e.who.startsWith('target') ? (tgt?.player != null ? [g.players[tgt.player]] : []) : e.who === 'each player' ? g.alive() : g.opponents(p);
      for (const q of who) q.poison += X(e.n);
      if (who.length) g.log(`${S}: ${who.map(q => `${g.pn(q)} (${q.poison}/10)`).join(', ')} get${who.length === 1 ? 's' : ''} ${X(e.n)} poison`, { kind: 'damage', rule: '122.1f' });
      break;
    }
    // Pacts: free now, paid for at the next upkeep, or the game is lost (Pact of Negation)
    case 'pact':
      (p.pacts ||= []).push({ cost: e.cost, from: g.turn, name: src.card.name });
      g.log(`${g.pn(p)} must pay ${esc(e.cost)} at their next upkeep or lose the game (${S})`, { kind: 'minor' });
      break;
    case 'bounceOwn': {
      // Karoo lands and their kin: return the least useful one (a tapped land first)
      const pool = p.battlefield.filter(o => g.isA(o, e.what.replace('nonland permanent', 'nonland')));
      const c = pool.sort((a, b) => (b.tapped ? 1 : 0) - (a.tapped ? 1 : 0) || p.agent.value(g, a) - p.agent.value(g, b))[0];
      if (c) { g.move(c, 'hand'); g.log(`${g.pn(p)} returns ${g.cn(c)} to their hand (${S})`, { kind: 'minor' }); }
      break;
    }
    case 'extraLand':
      p.extraLand = { turn: g.turn, n: (p.extraLand?.turn === g.turn ? p.extraLand.n : 0) + (e.n || 1) };
      g.log(`${g.pn(p)} may play an additional land this turn (${S})`, { kind: 'minor' });
      break;
    case 'pumpSelf':
      if (src.zone === 'battlefield') {
        src.tempP += X(e.p); src.tempT += X(e.t);
        if (e.kw.length) src.tempKw = new Set([...(src.tempKw || []), ...e.kw]);
        g.log(`${S} gets ${X(e.p) || X(e.t) ? `+${X(e.p)}/+${X(e.t)}` : ''}${e.kw.length ? ` ${e.kw.join(', ')}` : ''} until end of turn`, { kind: 'minor' });
      }
      break;
    case 'loseAll': {
      const n = X(e.n);
      for (const q of g.alive()) { q.life -= n; g.emit('life', { p: q.idx, d: -n }); }
      g.log(`${S}: each player loses ${n} life`);
      break;
    }
    case 'loseSelf': { const n = X(e.n); p.life -= n; g.emit('life', { p: p.idx, d: -n }); g.log(`${g.pn(p)} loses ${n} life (${S})`, { kind: 'minor' }); break; }
    case 'monarch': g.setMonarch(p, S); break;
    case 'fromHand': {
      const pool = p.hand.filter(o => o !== src && (e.what === 'land' ? o.fx.type.land : e.what === 'nonland permanent' ? o.fx.type.permanent && !o.fx.type.land : g.isA(o, e.what) && o.fx.type.permanent) && (!e.tribes || e.tribes.some(t => g.isA(o, t.replace(/s$/, '')))));
      // (Ghalta, Stampede Tyrant: any number of them)
      const picked = await g.pickCards(p, pool, Math.min(e.n || 1, pool.length), `${S}: choose ${e.n > 1 ? 'any number of cards' : `a ${e.what}`} to put onto the battlefield`);
      for (const c of picked) {
        g.move(c, 'battlefield');
        // Kaalia of the Vast: tapped and attacking alongside her
        if (e.attacking && src.attacking != null) Object.assign(c, { tapped: true, attacking: src.attacking, blockedBy: [], blocked: false });
        g.log(`${g.pn(p)} puts ${g.cn(c)} onto the battlefield from their hand${c.attacking != null && e.attacking ? ' tapped and attacking' : ''}`, { kind: 'minor' });
        g.trigger(c, 'etb');
      }
      break;
    }
    case 'reshuffle': {
      const n = p.graveyard.length;
      for (const o of [...p.graveyard]) { g.move(o, 'library'); }
      shuffle(p.library, g.rand);
      g.log(`${g.pn(p)} shuffles ${n} card${n === 1 ? '' : 's'} from their graveyard into their library`, { kind: 'minor' });
      break;
    }
    case 'exileGy': {
      if (e.all) {
        let n = 0;
        for (const q of g.opponents(p)) for (const o of [...q.graveyard]) { g.move(o, 'exile'); n++; }
        g.log(`${S} exiles ${n} card${n === 1 ? '' : 's'} from the opponents' graveyards`, { kind: 'removal' });
      } else {
        const c = p.agent.pickBest(g, g.opponents(p).flatMap(q => q.graveyard));
        if (c) { g.move(c, 'exile'); g.log(`${S} exiles ${g.cn(c)} from a graveyard`, { kind: 'removal' }); }
      }
      break;
    }
    case 'massReanimate': {
      // ("artifact or enchantment", "legendary permanent", "creature … with mana value 2 or less")
      // (Bloodline Bidding: only the creature type that returns the most)
      // (Patriarch's Bidding: each player picks the type that returns the most for them)
      const pool = (e.all ? g.alive() : [p]).flatMap(q => { const bt = e.bestType ? g.bestType(q, q.graveyard.filter(o => o.fx.type.creature)) : null; return q.graveyard.filter(o => g.spellIs(o, e.what) && o.fx.type.permanent && (e.maxMv == null || (o.card.cmc || 0) <= e.maxMv) && (!e.bestType || (bt && g.isA(o, bt)))); });
      for (const o of pool) { g.move(o, 'battlefield', { under: e.all && !e.mine ? o.owner : p.idx, tapped: !!e.tapped }); g.trigger(o, 'etb'); }
      g.log(`${S} returns ${pool.length} card${pool.length === 1 ? '' : 's'} to the battlefield`, { kind: 'removal' });
      break;
    }
    case 'germ': {
      if (src.zone !== 'battlefield') break;
      const t = g.createToken(p, { p: e.p, t: e.t, desc: e.desc, kw: [] }, src);
      src.attachedTo = t;
      g.log(`${S} creates a ${e.p}/${e.t} ${esc(t.card.name)} and is attached to it`, { kind: 'minor', rule: '702.92a' });
      break;
    }
    case 'modular': {
      const n = src.lastCounters || 0;
      const o = n > 0 && p.agent.bestOwn(g, p, x => x.fx.type.artifact && x.fx.type.creature && x !== src);
      if (o) { o.counters += n; g.log(`${S}'s ${n} +1/+1 counters move to ${g.cn(o)} (modular)`, { kind: 'minor', rule: '702.43a' }); }
      break;
    }
    case 'returnSelf':
      if (src.zone === 'graveyard') {
        g.move(src, 'battlefield', { under: src.owner });
        src.counters += e.counters;
        if (e.counters < 0) src.hadMinus = true;
        g.log(`${S} returns to the battlefield with a ${e.counters > 0 ? '+1/+1' : '-1/-1'} counter`, { kind: 'minor', rule: e.counters > 0 ? '702.93a' : '702.79a' });
        g.trigger(src, 'etb');
      }
      break;
    // ---- 1.6.0 second batch
    case 'wheel': {
      const sizes = g.alive().map(q => q.hand.length);
      const n = e.n === 'most' ? Math.max(0, ...sizes) : e.n;
      for (const q of g.alive()) g.discard(q, [...q.hand], null);
      for (const q of g.alive()) g.draw(q, n, true);
      g.log(`${S}: each player discards their hand and draws ${n}`, { kind: 'removal' });
      break;
    }
    case 'commanderToHand': {
      const c = p.command[0];
      if (c) { g.move(c, 'hand', { stay: true }); g.log(`${g.pn(p)} puts ${g.cn(c)} into their hand from the command zone`, { kind: 'minor' }); }
      break;
    }
    case 'stripProt':
      for (const q of g.opponents(p)) for (const o of q.battlefield) o.stripped = { turn: g.turn, kws: e.kws };
      g.log(`${S}: opponents' permanents lose ${e.kws.join(' and ')} this turn`, { kind: 'minor' });
      break;
    case 'livingDeath': {
      const back = new Map();
      for (const q of g.alive()) { const cs = q.graveyard.filter(o => o.fx.type.creature); for (const o of cs) g.move(o, 'exile'); back.set(q, cs); }
      for (const q of g.alive()) for (const o of q.battlefield.filter(x => x.fx.type.creature)) g.sacrifice(q, o);
      for (const [q, cs] of back) for (const o of cs) { if (o.zone !== 'exile') continue; g.move(o, 'battlefield', { under: q.idx }); g.trigger(o, 'etb'); }
      g.log(`${S}: every creature is swapped with the creature cards in the graveyards`, { kind: 'removal' });
      break;
    }
    case 'ignition': {
      const mine = g.bestOwnCreature(p);
      if (!mine) break;
      const n = Math.max(0, g.power(mine));
      for (const q of g.alive()) for (const o of [...q.battlefield]) if (o.fx.type.creature && o !== mine) g.damageObj(o, n, mine);
      for (const q of g.opponents(p)) g.damagePlayer(q, n, mine, false);
      g.log(`${g.cn(mine)} deals ${n} damage to each other creature and each opponent (${S})`, { kind: 'removal' });
      break;
    }
    case 'exileTrigCard': { const o = ctx.trig?.o; if (o?.zone === 'graveyard') g.move(o, 'exile'); break; }
    case 'peek': g.log(`${g.pn(p)} looks at an opponent's hand (${S})`, { kind: 'minor' }); break;
    case 'copyAllTokens': {
      const toks = p.battlefield.filter(o => o.token);
      for (const t of toks) { const c = g.createCopy(p, t, false); g.trigger(c, 'etb'); }
      g.log(`${S}: ${g.pn(p)} copies ${toks.length} token${toks.length === 1 ? '' : 's'}`, { kind: 'minor' });
      break;
    }
    case 'maze': {
      // Maze of Ith: the biggest creature attacking us is untapped and deals no combat damage; Reconnaissance saves our own
      const o = e.own ? p.battlefield.filter(x => x.attacking != null && x.damage > 0).sort((a, b) => p.agent.value(g, b) - p.agent.value(g, a))[0]
        : g.opponents(p).flatMap(q => q.battlefield.filter(x => x.attacking === p.idx)).sort((a, b) => g.power(b) - g.power(a))[0];
      if (o) { Object.assign(o, { attacking: null, blocked: false, blockedBy: [], tapped: false }); g.log(`${S} takes ${g.cn(o)} out of combat`, { kind: 'removal' }); }
      break;
    }
    case 'attachTrig': {
      const eq = ctx.trig?.o || src;
      const c = g.bestOwnCreature(p);
      if (eq?.zone === 'battlefield' && c) { eq.attachedTo = c; g.log(`${g.cn(eq)} is attached to ${g.cn(c)}`, { kind: 'minor' }); }
      break;
    }
    case 'oppToken': {
      const q = [...g.opponents(p)].sort((a, b) => p.agent.threat(g, p, a) - p.agent.threat(g, p, b))[0];
      if (q) { for (let k = 0; k < X(e.n); k++) g.createToken(q, { p: e.p, t: e.t, desc: e.desc, kw: [] }, src); g.log(`${g.pn(q)} creates ${X(e.n)} ${e.p}/${e.t} token${X(e.n) === 1 ? '' : 's'} (${S})`, { kind: 'minor' }); }
      break;
    }
    case 'tempLandBoost': p.tempBoost = { turn: g.turn, what: e.what, sym: e.sym }; g.log(`${S}: ${g.pn(p)}'s ${e.what}s make an extra {${e.sym}} this turn`, { kind: 'minor' }); break;
    case 'sacUnless': {
      const land = p.battlefield.filter(o => o !== src && g.isA(o, e.what)).sort((a, b) => p.agent.value(g, a) - p.agent.value(g, b))[0];
      if (land && p.agent.value(g, src) > p.agent.value(g, land)) g.sacrifice(p, land, ` to keep ${S}`);
      else if (src.zone === 'battlefield') g.sacrifice(p, src);
      break;
    }
    case 'untapAttached': if (src.attachedTo?.zone === 'battlefield') { src.attachedTo.tapped = false; g.log(`${S} untaps ${g.cn(src.attachedTo)}`, { kind: 'minor' }); } break;
    case 'insurrection': {
      const objs = g.opponents(p).flatMap(q => q.battlefield.filter(o => o.fx.type.creature).map(o => ({ o, q })));
      for (const { o, q } of objs) {
        q.battlefield.splice(q.battlefield.indexOf(o), 1); o.controller = p.idx; p.battlefield.push(o);
        Object.assign(o, { tapped: false, sick: false, tempKw: new Set([...(o.tempKw || []), 'haste']) });
        g.tempSteals.push({ o, back: q.idx });
      }
      for (const o of p.battlefield) if (o.fx.type.creature) o.tapped = false;
      g.log(`${S}: ${g.pn(p)} untaps every creature and takes ${objs.length} until end of turn`, { kind: 'removal' });
      break;
    }
    case 'cantLoseTurn': p.cantLoseTurn = g.turn; g.log(`${g.pn(p)} can't lose the game this turn (${S})`, { kind: 'minor' }); break;
    case 'sweepThat': {
      const q = g.thatPlayer(p, ctx);
      const n = X(e.n);
      if (q) { for (const o of [...q.battlefield]) if (o.fx.type.creature) g.damageObj(o, n, src); g.log(`${S} deals ${n} damage to each creature ${g.pn(q)} controls`, { kind: 'removal' }); }
      break;
    }
    case 'allIsDust':
      for (const q of g.alive()) for (const o of [...q.battlefield]) if ((o.card.colors || []).length) g.sacrifice(q, o);
      g.log(`${S}: every colored permanent is sacrificed`, { kind: 'removal' });
      break;
    // ---- 1.6.0 effects
    case 'wipeOpp': {
      const objs = g.opponents(p).flatMap(q => q.battlefield.filter(o => g.isA(o, (e.what || 'creature').replace(/ or .*/, ''))));
      for (const o of objs) {
        if (e.mode === 'bounce') g.move(o, 'hand');
        else if (e.mode === 'damage') g.damageObj(o, X(e.n), src);
        else if (e.mode === 'exile') g.move(o, 'exile');
        else g.destroy(o, g.rules >= 9 && !!e.noRegen9);
      }
      g.log(`${S} (overloaded) hits ${objs.length} of the opponents' ${e.what || 'creature'}s`, { kind: 'removal', rule: '702.96a' });
      break;
    }
    case 'doublePT': {
      // (Thrakkus: each Dragon's power; Two-Handed Axe: the attacking creature; Tifa: itself)
      const objs = e.all ? p.battlefield.filter(o => o.fx.type.creature && (!e.what || g.isA(o, e.what))) : e.trig ? [ctx.trig?.o].filter(o => o?.zone === 'battlefield') : e.self ? [src].filter(o => o.zone === 'battlefield') : tgt?.obj ? [tgt.obj] : [];
      for (const o of objs) { const pw = Math.max(0, g.power(o)), tg = Math.max(0, g.toughness(o)); o.tempP += pw; if (e.all && !e.powerOnly) o.tempT += tg; if (e.haste) o.tempKw = new Set([...(o.tempKw || []), 'haste']); }
      if (objs.length) g.log(`${S} doubles the power${e.all ? ' and toughness' : ''} of ${objs.length === 1 ? g.cn(objs[0]) : `${objs.length} creatures`}`, { kind: 'minor' });
      break;
    }
    case 'pumpTrig': case 'pumpAttached': {
      const o = e.k === 'pumpAttached' ? src.attachedTo : ctx.trig?.o;
      if (!o || o.zone !== 'battlefield') break;
      o.tempP += X(e.p); o.tempT += X(e.t);
      if (e.kw.length) o.tempKw = new Set([...(o.tempKw || []), ...e.kw]);
      g.log(`${g.cn(o)} gets ${X(e.p) || X(e.t) ? `+${X(e.p)}/+${X(e.t)}` : ''}${e.kw.length ? ` ${e.kw.join(', ')}` : ''} until end of turn (${S})`, { kind: 'minor' });
      break;
    }
    case 'copyTrig': {
      const o = ctx.trig?.o;
      if (!o) break;
      g.log(`${g.pn(p)} copies ${g.cn(o)} (${S})`, { kind: 'cast', p: p.idx, rule: '707.10' });
      if (o.fx.type.permanent) { const c = g.createCopy(p, o, false); g.trigger(c, 'etb'); }
      else await g.runEffects(p, o, o.fx.spell.filter(x => x.k !== 'copySpell' && x.k !== 'counter'), { x: 0 });
      break;
    }
    // ---- (rules 13, Phase 2E) Teferi's Protection, Arcane Denial
    case 'lifeLock':
      if (g.rules < 13) break;
      p.lifeLock = true;
      g.log(`${g.pn(p)}'s life total can't change until their next turn (${S})`, { kind: 'minor', rule: '119.7' });
      break;
    case 'phaseOut':
      if (g.rules < 13) break;
      g.phaseOut(p, [...p.battlefield]);
      break;
    case 'laterDraw':
      if (g.rules < 13) break;
      g.addLater(p, src, 'upkeep', [{ k: 'draw', n: e.n }], `${p.name} draws ${e.n === 1 ? 'a card' : `${e.n} cards`}`);
      break;
    case 'drawUpTo': {
      // "may draw up to N cards": the drawing player chooses how many
      const q = g.players[e.who ?? p.idx];
      if (!q || q.lost) break;
      const max = Math.max(0, e.n);
      const want = q.agent.drawUpToAsync ? await q.agent.drawUpToAsync(g, q, src, max) : q.agent.drawUpTo ? q.agent.drawUpTo(g, q, src, max) : max;
      const n = Math.max(0, Math.min(max, Math.floor(+want || 0)));
      g.log(`${g.pn(q)} draws ${n} of up to ${max} card${max === 1 ? '' : 's'} (${S})`, { kind: 'minor' });
      if (n) g.draw(q, n);
      break;
    }
    case 'shieldSelf':
      p.shield = g.turn + g.alive().length - 1;
      g.log(`${g.pn(p)} gains protection from everything until their next turn (${S})`, { kind: 'removal' });
      break;
    case 'ring': {
      p.ring = Math.min(4, (p.ring || 0) + 1);
      const bearer = g.bestOwnCreature(p);
      if (bearer) { p.ringBearer = bearer.iid; bearer.permKw = new Set([...(bearer.permKw || []), ...(p.ring >= 1 ? ['unblockable-bigger'] : [])]); }
      g.log(`The Ring tempts ${g.pn(p)}${bearer ? `: ${g.cn(bearer)} is the Ring-bearer` : ''} (${p.ring}/4)`, { kind: 'minor', rule: '701.54a' });
      g.fire('ring', { p: p.idx });
      break;
    }
    case 'playerCounter': {
      const n = X(e.n) + (p.battlefield.some(s => s.fx.playerCounterPlus) ? 1 : 0);
      p[e.kind] = (p[e.kind] || 0) + n;
      g.log(`${g.pn(p)} gets ${n} ${e.kind} counter${n === 1 ? '' : 's'} (${p[e.kind]})`, { kind: 'minor' });
      break;
    }
    case 'shieldSpells': if (g.rules >= 5) { p.shieldTurn = g.turn; g.log(`${g.pn(p)}'s spells can't be countered this turn`, { kind: 'minor' }); } break;
    case 'uncounterNext': p.uncounterTurn = g.turn; g.log(`${g.pn(p)}'s next spell this turn can't be countered`, { kind: 'minor' }); break;
    case 'bottomSelf':
      if (src.zone === 'graveyard' || src.zone === 'battlefield') { g.move(src, 'library', { bottom: true }); g.log(`${S} goes to the bottom of its owner's library`, { kind: 'minor' }); }
      break;
    case 'returnTrig': {
      const o = ctx.trig?.o;
      if (o && o.zone === 'graveyard') {
        g.move(o, 'battlefield', { under: e.kw ? o.owner : p.idx });
        // Luminous Broodmoth: it comes back with a flying counter
        if (e.kw) o.permKw = new Set([...(o.permKw || []), e.kw]);
        g.log(`${S} returns ${g.cn(o)} to the battlefield${e.kw ? ` with a ${e.kw} counter` : ''}`, { kind: 'minor' });
        g.trigger(o, 'etb');
      }
      break;
    }
    case 'transform': {
      const b = src.card.backCard;
      if (src.zone !== 'battlefield' || !b) { g.log(`${S} would transform (it has no other face here)`, { kind: 'minor' }); break; }
      src.frontCard ||= src.card;
      src.card = src.card === src.frontCard ? b : src.frontCard;
      src.fx = src.card.fx;
      g.log(`${g.cn(src)} transforms`, { kind: 'minor', rule: '701.28a' });
      break;
    }
    case 'bounceAll': {
      const keep = e.keepType ? g.bestType(p) : null;
      // (Wave Goodbye: only creatures without +1/+1 counters)
      const hit = o => o.fx.type.creature && (e.what === 'attacking' ? o.attacking != null : e.what !== 'other creatures' || o !== src) && !(keep && g.isA(o, keep)) && !(e.noCounters && o.counters > 0);
      const objs = g.alive().flatMap(q => q.battlefield.filter(hit));
      // (Aetherspouts: to the bottom of their owners' libraries instead)
      for (const o of objs) g.move(o, e.toLibrary ? 'library' : 'hand', e.toLibrary ? { bottom: true } : {});
      g.log(`${S} returns ${objs.length} creature${objs.length === 1 ? '' : 's'} to their owners' hands`, { kind: 'removal' });
      break;
    }
    case 'roll': {
      const r = 1 + Math.floor(g.rand() * e.d);
      const row = (e.table || []).find(x => r >= x.lo && r <= x.hi);
      g.log(`${g.pn(p)} rolls a d${e.d}: ${r} (${S})`, { kind: 'minor', rule: '706.2' });
      if (row) await g.runEffects(p, src, row.effects, { ...ctx, targets: undefined, strict: false, x: r });
      break;
    }
    case 'flashTurn': p.flashNow = true; g.log(`${g.pn(p)} may cast spells as though they had flash this turn`, { kind: 'minor' }); break;
    // ---- 1.17.0
    case 'becomeCopy': {
      // Mirage Mirror, Thespian's Stage, Shifting Woodland, Cursed Mirror, Gogo, Sarkhan
      if (src.zone !== 'battlefield') break;
      const words = e.what.split(' or ').map(w => w.trim());
      const fits = x => x !== src && words.some(w => (w === 'permanent' ? x.fx.type.permanent : g.isA(x, w.replace('nontoken ', ''))));
      const pool = e.trig ? [ctx.trig?.o].filter(Boolean) : e.gy ? p.graveyard.filter(fits) : (e.own ? p.battlefield : g.alive().flatMap(q => q.battlefield)).filter(x => fits(x) && !x.token);
      const model = p.agent.pickBest(g, pool);
      if (!model) break;
      if (!src.baseCard) src.baseCard = src.card;
      // ("except it has this ability": Thespian's Stage keeps its copy ability)
      const keep = e.keep ? src.baseCard.fx.abilities.filter(a => a.effects.some(x => x.k === 'becomeCopy')) : [];
      src.card = model.card;
      src.fx = keep.length ? { ...model.card.fx, abilities: [...model.card.fx.abilities, ...keep] } : model.card.fx;
      src.copyUntil = e.eot ? g.turn : null;
      if (e.haste) src.tempKw = new Set([...(src.tempKw || []), 'haste']);
      g.log(`${S} becomes a copy of ${esc(model.card.name)}${e.eot ? ' until end of turn' : ''}`, { kind: 'minor', rule: '707.2' });
      break;
    }
    case 'grantRebound': if (ctx.trig?.o?.zone === 'stack') ctx.trig.o.reboundGrant = true; break;
    case 'returnTrigHand': {
      const c = ctx.trig?.o;
      if (!c || c.zone !== 'graveyard') break;
      if (e.unlessLife) {
        // Athreos: the opponent pays life to keep it in the graveyard (if they can spare it)
        const q = p.agent.weakestOpponent(g, p);
        if (q && q.life > e.unlessLife * 4) { q.life -= e.unlessLife; g.emit('life', { p: q.idx, d: -e.unlessLife }); g.log(`${g.pn(q)} pays ${e.unlessLife} life so ${g.cn(c)} stays in the graveyard`, { kind: 'minor' }); break; }
      }
      if (e.later) { (p.handLater ||= []).push(c); g.log(`${g.cn(c)} will return to ${g.pn(p)}'s hand at the end step`, { kind: 'minor' }); break; }
      g.move(c, 'hand'); g.log(`${S} returns ${g.cn(c)} to ${g.pn(p)}'s hand`, { kind: 'minor' });
      break;
    }
    case 'teamBase': {
      const P = X(e.p), T = X(e.t);
      const objs = p.battlefield.filter(o => o.fx.type.creature && (!e.what || g.isA(o, e.what)));
      for (const o of objs) o.animPT = { p: P, t: T, turn: g.turn, ts: ++g.tsN };
      if (objs.length) g.log(`${S}: ${objs.length} creature${objs.length === 1 ? '' : 's'} have base power and toughness ${P}/${T} until end of turn`, { kind: 'minor' });
      break;
    }
    case 'animateAll': {
      const objs = p.battlefield.filter(o => o.fx.type.artifact && !o.fx.type.creature);
      for (const o of objs) { o.animPT = { p: e.p, t: e.t, turn: g.turn, ts: ++g.tsN }; o.crewed = true; o.fx = { ...o.card.fx, type: { ...o.card.fx.type, creature: true } }; }
      if (objs.length) g.log(`${S}: ${objs.length} artifact${objs.length === 1 ? ' becomes a' : 's become'} ${e.p}/${e.t} creature${objs.length === 1 ? '' : 's'} until end of turn`, { kind: 'minor' });
      break;
    }
    case 'devour': {
      // Devour: eat our own creature tokens as it enters, for +1/+1 counters
      const food = p.battlefield.filter(o => o !== src && o.fx.type.creature && o.token);
      for (const o of food) g.sacrifice(p, o, ' (devoured)');
      if (food.length && src.zone === 'battlefield') { src.counters += g.moreCounters(src, e.n * food.length); g.log(`${S} devours ${food.length} creature${food.length === 1 ? '' : 's'}`, { kind: 'minor', rule: '702.82a' }); }
      break;
    }
    case 'copyAbility': {
      // Strionic Resonator, Lithoform Engine: the topmost ability of yours on the stack happens again
      const it = [...g.stack].reverse().find(x => x.ability && x.p === p && x.o !== src && !x.countered);
      if (!it) { g.log(`${S} has no ability to copy`, { kind: 'minor' }); break; }
      g.log(`${S} copies ${g.cn(it.o)}'s ability`, { kind: 'trigger', rule: '707.10' });
      await g.runEffects(p, it.o, it.effects, { targets: it.targets, trig: it.trig });
      break;
    }
    case 'grasp': {
      // Praetor's Grasp: the best card in the richest opponent's library, exiled face down; we may play it
      const c = p.agent.pickBest(g, g.opponents(p).flatMap(q => q.library));
      if (c) { g.move(c, 'exile'); c.mayPlay = { p: p.idx, until: Infinity }; shuffle(g.players[c.owner].library, g.rand); g.log(`${S}: ${g.pn(p)} exiles a card from ${g.pn(g.players[c.owner])}'s library face down and may play it`, { kind: 'removal' }); }
      break;
    }
    case 'sacUnlessEscaped':
      if (!src.escaped && src.zone === 'battlefield') g.sacrifice(p, src, " (it didn't escape)");
      break;
    case 'gyFreeCast': {
      const pool = p.graveyard.filter(o => o !== src && e.types.some(t => o.fx.type[t]) && o.fx.spell.length);
      const c = p.agent.pickBest(g, pool);
      if (c) { c.gyOnceExile = true; await g.cast(p, c, { mode: { alt: 'free' } }); }
      break;
    }
    case 'castCommanderFree': {
      const c = p.command.find(o => !o.fx.type.land);
      if (c) await g.cast(p, c, { mode: { alt: 'free' } });
      break;
    }
    case 'reanimateTrig': {
      // It That Betrays, Tergrid: the card an opponent sacrificed or discarded comes over to us
      const c = ctx.trig?.o;
      if (c && c.zone === 'graveyard' && c.owner !== p.idx && c.fx.type.permanent && !c.token) {
        g.move(c, 'battlefield', { under: p.idx });
        g.log(`${S} puts ${g.cn(c)} onto the battlefield under ${g.pn(p)}'s control`, { kind: 'removal' });
        g.trigger(c, 'etb');
      }
      break;
    }
    case 'deadbridge': {

      if (!p.graveyard.length) break;
      const c = p.graveyard[Math.floor(g.rand() * p.graveyard.length)];
      if (c.fx.type.creature) { g.move(c, 'battlefield'); g.log(`${S} returns ${g.cn(c)} from the graveyard to the battlefield`); g.trigger(c, 'etb'); }
      else { g.move(c, 'hand'); g.log(`${S} returns ${g.cn(c)} to ${g.pn(p)}'s hand`, { kind: 'minor' }); }
      break;
    }
    case 'hermit': {
      // Hermit Druid: mill until a basic land, which goes to hand (the whole library without one)
      let k = 0, land = null;
      while (p.library.length) {
        const top = p.library[p.library.length - 1];
        if (top.fx.type.basic && top.fx.type.land) { land = top; g.move(top, 'hand'); break; }
        g.move(top, 'graveyard'); k++;
      }
      g.log(`${S}: ${g.pn(p)} reveals ${k + (land ? 1 : 0)} cards, ${land ? `takes ${g.cn(land)}` : 'finds no basic land'} and puts ${k} into the graveyard`, { kind: k >= 20 ? 'removal' : 'minor' });
      break;
    }
    case 'bribery': {
      // From the opponent with the best creature left in their library
      const opts = g.opponents(p).flatMap(q => q.library.filter(o => o.fx.type.creature));
      const c = p.agent.pickBest(g, opts);
      if (c) {
        const q = g.players[c.owner];
        g.move(c, 'battlefield', { under: p.idx });
        shuffle(q.library, g.rand);

        g.log(`${S}: ${g.pn(p)} puts ${g.cn(c)} from ${g.pn(q)}'s library onto the battlefield`, { kind: 'removal' });
        g.trigger(c, 'etb');
      }
      break;
    }
    case 'peer': {
      const q = tgt?.player != null ? g.players[tgt.player] : p;
      const n = Math.ceil(q.library.length / 2), l = Math.ceil(q.life / 2);
      g.draw(q, n);
      q.life -= l; g.emit('life', { p: q.idx, d: -l });
      g.log(`${S}: ${g.pn(q)} draws ${n} cards and loses ${l} life`, { kind: 'removal' });
      break;
    }
    case 'moveEquip': {
      // An equipment (an unattached one first) onto the best creature that doesn't have it
      const eqs = p.battlefield.filter(o => (o.fx.type.equipment || (o.fx.type.aura && o.attachedTo?.controller === p.idx)) && o !== src).sort((a, b) => (a.attachedTo ? 1 : 0) - (b.attachedTo ? 1 : 0));
      const eq = eqs[0];
      const c = eq && g.bestOwnCreature(p, x => x !== eq.attachedTo);
      if (eq && c) { eq.attachedTo = c; g.log(`${S} attaches ${g.cn(eq)} to ${g.cn(c)}`, { kind: 'minor' }); }
      break;
    }
    case 'tapAttached': if (src.attachedTo?.zone === 'battlefield') { src.attachedTo.tapped = true; g.log(`${S} taps ${g.cn(src.attachedTo)}`, { kind: 'minor' }); } break;
    case 'doublePool': {
      const add = p.pool.map(u => ({ ...u }));
      p.pool.push(...add);
      if (add.length) g.log(`${S} doubles ${g.pn(p)}'s unspent mana (${p.pool.length})`, { kind: 'minor' });
      break;
    }
    case 'halfLifeDamage':
      for (const q of g.alive()) { const n = Math.floor(Math.max(0, q.life) / 2); if (n) g.damagePlayer(q, n, src, false); }
      g.log(`${S} deals damage to each player equal to half their life`, { kind: 'removal' });
      break;
    case 'lostAgain':
      for (const q of g.opponents(p)) {
        const n = q.lostLifeTurn === g.turn ? q.lostAmt || 0 : 0;
        if (n > 0) { q.life -= n; q.grudge[p.idx] += n; g.emit('life', { p: q.idx, d: -n }); g.log(`${S}: ${g.pn(q)} loses ${n} more life`); }
      }
      break;
    case 'gyCastTurn': p.gyCast =
 { turn: g.turn, types: e.types }; g.log(`${g.pn(p)} may cast ${e.types.join('/') || ''} spells from their graveyard this turn`.replace('cast  spells', 'cast spells'), { kind: 'minor' }); break;
    case 'stealAll': {
      const q = g.thatPlayer(p, ctx);
      if (!q) break;
      const objs = q.battlefield.filter(o => g.isA(o, e.what));
      for (const o of objs) { q.battlefield.splice(q.battlefield.indexOf(o), 1); o.controller = p.idx; p.battlefield.push(o); }
      if (objs.length) g.log(`${g.pn(p)} gains control of ${objs.length} ${e.what}${objs.length === 1 ? '' : 's'} from ${g.pn(q)}`, { kind: 'removal' });
      break;
    }
    case 'level':
      if (src.zone === 'battlefield' && (src.level || 1) === e.n - 1) {
        src.level = e.n;
        g.log(`${S} becomes level ${e.n}`, { kind: 'minor', rule: '716.2a' });
        for (const w of src.fx.watch || []) if (w.ev === 'level' && w.n === e.n) g.queue.push({ o: src, effects: w.effects, label: `level ${e.n}`, p });
      }
      break;
    case 'station': {
      const n = Math.max(0, p.lastTapPower || 0);
      (src.named ||= {}).charge = (src.named.charge || 0) + n;
      g.log(`${S} gets ${n} charge counter${n === 1 ? '' : 's'} (${src.named.charge})`, { kind: 'minor', rule: '702.184a' });
      break;
    }
    default: break;
  }
}
// "That player": whoever the trigger was about (the player dealt combat damage, whose creature died, whose upkeep it is)
/** @param {import('./engine.js').Game} g */
export function thatPlayer(g, p, ctx) {
  const t = ctx.trig;
  const i = t?.target ?? (t?.p != null && t.p !== p.idx ? t.p : null);
  const q = i != null ? g.players[i] : null;
  return q && !q.lost ? q : null;
}
/** @param {import('./engine.js').Game} g */
export function setMonarch(g, p, why = '') {
  if (g.monarch === p.idx) return;
  g.monarch = p.idx;
  g.log(`👑 ${g.pn(p)} becomes the monarch${why ? ` (${why})` : ''}`, { kind: 'politics', rule: '724.1' });
}
// Boon Reflection, Rhox Faithmender: life gained is doubled
/** @param {import('./engine.js').Game} g */
export function lifeGain(g, p, n) {
  // Erebos, Sulfuric Vortex, Rampaging Ferocidon: no life is gained
  if (g.alive().some(q => q.battlefield.some(s => s.fx.noGain === 'all' || (s.fx.noGain === 'opp' && q !== p)))) return 0;
  if (n <= 0) return n;
  const ops = [];
  for (const s of p.battlefield) { if (s.fx.lifePlus) ops.push({ plus: s.fx.lifePlus }); if (s.fx.lifeDouble) ops.push({ mul: 2 }); }
  return g.replaceInOrder(n, ops, 'max');
}
// Committing a crime (700.13): targeting an opponent, or something an opponent controls
/** @param {import('./engine.js').Game} g */
export function noteCrime(g, p, targets) {
  if ((targets || []).some(t => (t?.player != null && t.player !== p.idx) || (t?.obj && t.obj.controller !== p.idx))) g.fire('crime', { p: p.idx });
}
// Fiery Emancipation, Torbran-style: damage from your sources to opponents and their permanents is doubled
/** @param {import('./engine.js').Game} g */
export function moreDamage(g, src, victimIdx, n) {
  if (!src || src.controller == null) return n;
  const ops = [];
  // Torbran: +2 from (red) sources to opponents
  if (n > 0 && victimIdx !== src.controller) for (const s of g.players[src.controller].battlefield) if (s.fx.damagePlus && (!s.fx.damagePlus.color || g.colorsOf(src).includes(s.fx.damagePlus.color))) ops.push({ plus: s.fx.damagePlus.n });
  for (const s of g.players[src.controller].battlefield) if (s.fx.damageDouble && (s.fx.damageAny || victimIdx !== src.controller) && (!s.fx.creatureDamageOnly || src.fx.type.creature) && (!s.fx.damageChosen || (s.chosenType && g.isA(src, s.chosenType))) && (!s.fx.damageCounters || src.counters > 0)) ops.push({ mul: s.fx.damageDouble === true ? 2 : s.fx.damageDouble });
  // Dictate of the Twin Gods: every source's damage is doubled
  for (const q of g.alive()) for (const s of q.battlefield) if (s.fx.damageDoubleAll) ops.push({ mul: 2 });
  // Gisela: damage to her controller and their permanents is halved (rounded down)
  if (n > 0 && g.players[victimIdx]?.battlefield.some(s => s.fx.halveDamage)) ops.push({ half: true });
  // (the player or the permanent's controller being dealt the damage orders them: the least damage)
  return g.replaceInOrder(n, ops, 'min');
}
/** @param {import('./engine.js').Game} g */
export function damagePlayer(g, q, n, src, combat) {
  n = g.moreDamage(src, q.idx, n);
  const sc = src?.controller;
  if (sc != null && sc !== q.idx && n > 0) q.lastHitBy = sc;
  // Sulfuric Vortex-style "+1 noncombat damage", Bloodletter-style double loss on its controller's turn
  if (!combat && sc != null && sc !== q.idx) for (const s of g.players[sc].battlefield) if (s.fx.burnPlus) n += s.fx.burnPlus;
  // Solphim: noncombat damage to opponents is doubled
  if (!combat && sc != null && sc !== q.idx) for (const s of g.players[sc].battlefield) if (s.fx.burnDouble) n *= 2;
  if (sc != null && sc !== q.idx && g.active === sc && g.players[sc].battlefield.some(s => s.fx.lossDouble)) n *= 2;
  // Protection from everything until your next turn (Teferi's Protection); Glacial Chasm, Selfless Squire
  if ((q.shield >= g.turn || q.preventTurn === g.turn || q.battlefield.some(s => s.fx.preventMe)) && !g.noPrevent()) n = 0;
  if (g.kingdoms && !g.has(src, 'infect') && !g.noPrevent()) n = K.damageHook(g, q, n, src, combat);
  if (n <= 0 || q.lost) return;
  if (!combat && sc != null && sc !== q.idx) g.fire('noncombat', { o: src, p: sc, n, target: q.idx });
  // (rules 7) Curiosity on Niv-Mizzet: noncombat damage to an opponent by the enchanted creature
  if (!combat && g.rules >= 7 && sc != null && sc !== q.idx && src?.zone === 'battlefield') g.fire('attachedDamage', { o: src, p: sc, n, target: q.idx, noncombat: true });
  // Infect deals damage to players as poison counters (702.90b); toxic adds poison on top (702.164)
  if (g.has(src, 'infect')) { q.poison += n; g.log(`${g.pn(q)} gets ${n} poison counter${n === 1 ? '' : 's'} (${q.poison}/10)`, { kind: 'damage', rule: '702.90b' }); }
  else { q.life -= n; g.emit('life', { p: q.idx, d: -n }); }
  if (combat && src.fx.kwN?.toxic) { q.poison += src.fx.kwN.toxic; g.log(`${g.pn(q)} gets ${src.fx.kwN.toxic} poison (toxic, ${q.poison}/10)`, { kind: 'damage', rule: '702.164b' }); }
  q.damagedTurn = g.turn;
  const sp = g.players[src.controller];
  sp.stats.damage += n;
  q.stats.taken = (q.stats.taken || 0) + n;
  // (the biggest single hits, for the post-game report)
  if (n >= 3) (g.bigHits ||= []).push({ turn: g.turn, n, by: sp.idx, to: q.idx, src: src.card.name, combat: !!combat });
  q.grudge[src.controller] += n;
  if (combat && src.isCommander) q.cmdDamage[src.iid] = (q.cmdDamage[src.iid] || 0) + n;
  if (g.has(src, 'lifelink')) { const gained = g.lifeGain(sp, n); sp.life += gained; g.emit('life', { p: sp.idx, d: gained }); }
  // Combat damage to the monarch makes the attacker's controller the monarch (724.2)
  if (combat && g.monarch === q.idx && sp !== q) g.setMonarch(sp, `dealt combat damage to ${q.name}`);
}
/** @param {import('./engine.js').Game} g */
export function damageObj(g, o, n, src) {
  n = g.moreDamage(src, o.controller, n);
  // Prevent all damage to your attacking creatures; Teferi's Protection covers your permanents
  if (!g.noPrevent()) {
    if (o.attacking != null && g.players[o.controller].battlefield.some(s => s.fx.protectAttackers && (s.fx.protectAttackers !== 'artifact' || (o.fx.type.artifact && src?.fx.type.creature)))) n = 0;
    if (g.players[o.controller].shield >= g.turn) n = 0;
  }
  if (n <= 0 || o.zone !== 'battlefield') return;
  // Protection from a color prevents damage from sources of that color (702.16e)
  if (src && o.fx.prot?.some(c => g.colorsOf(src).includes(c))) { g.log(`${g.cn(o)}'s protection prevents the damage`, { kind: 'minor', rule: '702.16e' }); return; }
  if (o.fx.type.planeswalker && !o.fx.type.creature) o.loyalty -= n;
  else if (o.fx.type.battle && !o.fx.type.creature) o.defense = Math.max(0, (o.defense || 0) - n);
  // Wither and infect deal damage to creatures as -1/-1 counters
  else if (src && (g.has(src, 'wither') || g.has(src, 'infect'))) { o.counters -= n; o.hadMinus = true; }
  else { o.damage += n; if (src && g.has(src, 'deathtouch')) o.deathtouched = true; }
  g.emit('hit', { iid: o.iid, n });
  g.fire('damaged', { o, n });
  if (src && g.has(src, 'lifelink')) { const sp = g.players[src.controller]; const gained = g.lifeGain(sp, n); sp.life += gained; g.emit('life', { p: sp.idx, d: gained }); }
}
