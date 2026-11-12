// Archenemy and Planechase (Round 5, item 160), with Scryfall's scheme and plane cards.
//  • Archenemy: seat 1 is the archenemy (40 life, goes first) against a team of the others (who share nothing but the
//    goal; they never attack or target each other). At the start of each of the archenemy's first main phases, the top
//    scheme is set in motion: its "When you set this scheme in motion" ability goes on the stack, and the scheme goes
//    to the bottom. Ongoing schemes are left out of the deck. The team wins when the archenemy is out; the archenemy
//    wins when the whole team is.
//  • Planechase (on a Commander table): one plane is face up. At the start of each player's first main phase they roll
//    the planar die once: planeswalk (1 in 6: the plane goes to the bottom, the next one turns face up and its "when you
//    planeswalk to" ability triggers), chaos (1 in 6: the plane's chaos ability, controlled by the roller), or nothing.
//    A plane's other abilities (statics, upkeep triggers) aren't played; each plane says what was read.
// The cards are picked when the table starts and saved in the game's setup, and the decks are shuffled with the game's
// seed, so replays stay exact.
import { sf, normalize } from './scryfall.js';
import { analyzeCard, parseEffects, cleanText } from './effects.js';
import { shuffle, esc, store } from './util.js';

const SIZE = { archenemy: 20, planechase: 10 };
const QUERY = { archenemy: 't:scheme -t:ongoing', planechase: 't:plane' };

// ---------- picking the cards (setup screen; Scryfall once, then kept in this browser profile)
/** @param {string} kind @param {(msg: string) => void} [onStatus] */
export async function planarCards(kind, onStatus = () => {}) {
  const key = `ct.planar.${kind}`;
  let all = store(key);
  if (!Array.isArray(all) || all.length < SIZE[kind]) {
    onStatus(kind === 'archenemy' ? 'Fetching scheme cards from Scryfall…' : 'Fetching plane cards from Scryfall…');
    const j = await sf(`/cards/search?unique=cards&q=${encodeURIComponent(`${QUERY[kind]} game:paper`)}`);
    all = (j.data || []).map(normalize).map(c => ({ id: c.id, name: c.name, typeLine: c.typeLine, text: c.text, imgSmall: c.imgSmall, imgNormal: c.imgNormal, set: c.set, cn: c.cn }));
    if (all.length) store(key, all);
  }
  // (Math.random is fine here: the pick is saved in the game's setup)
  const pool = [...all];
  for (let i = pool.length - 1; i > 0; i--) { const k = Math.floor(Math.random() * (i + 1)); [pool[i], pool[k]] = [pool[k], pool[i]]; }
  return { kind, cards: pool.slice(0, SIZE[kind]) };
}

// ---------- reading a scheme or plane
const textOf = card => cleanText(card.text || '', card.name);
function partsOf(card) {
  const out = { motion: [], arrive: [], chaos: [], upkeep: [], read: [], unread: [] };
  for (const line of textOf(card).split('\n').map(s => s.trim()).filter(Boolean)) {
    let m;
    if ((m = line.match(/^when you set this scheme in motion,? (.*)/))) {
      // (a few readings would be wrong: cards the opponents draw are not ours; one token per opponent)
      const e = /each opponent draws|opponents? (?:chooses|reveals)/.test(m[1]) ? [] : parseEffects(m[1]).map(x => (x.k === 'token' && /^for each opponent, create a/.test(m[1]) ? { ...x, n: 3 } : x)); out.motion.push(...e); (e.length ? out.read : out.unread).push(line); continue; }
    // ("when you planeswalk to ~", newer cards "to this plane" or "here"; some also on chaos)
    if ((m = line.match(/^when(?:ever)? you planeswalk (?:to ~|to this plane|here)( and whenever chaos ensues| (?:or|and) at the beginning of your upkeep)?,? (.*)/))) {
      const e = parseEffects(m[2]);
      out.arrive.push(...e);
      if (/chaos/.test(m[1] || '')) out.chaos.push(...e);
      if (/upkeep/.test(m[1] || '')) out.upkeep.push(...e);
      (e.length ? out.read : out.unread).push(line);
      continue;
    }
    if ((m = line.match(/^whenever (?:(?:you|a player) rolls? \{chaos\}|chaos ensues),? (.*)/))) { const e = parseEffects(m[1]); out.chaos.push(...e); (e.length ? out.read : out.unread).push(line); continue; }
    // ("at the beginning of your upkeep" on a plane: played at the start of the player's first main phase instead)
    if ((m = line.match(/^at the beginning of your upkeep,? (.*)/))) { const e = parseEffects(m[1]); out.upkeep.push(...e); (e.length ? out.read : out.unread).push(line); continue; }
    out.unread.push(line);
  }
  return out;
}

// ---------- in the game (engine.js calls these)
export function setupPlanar(g, planar) {
  if (!planar?.cards?.length) return;
  const owner = g.players[0];
  const deck = planar.cards.map(c => {
    const card = { ...c, fx: null };
    card.fx = analyzeCard(card);
    const o = g.mk(card, owner);
    o.zone = 'planar';
    o.planar = partsOf(card);
    return o;
  });
  shuffle(deck, g.rand);
  g.planar = { kind: planar.kind, deck, plane: null };
  if (planar.kind === 'archenemy') {
    // The archenemy against a team (the team's members never fight each other: engine.js opponents)
    g.teams = [[0], g.players.slice(1).map(p => p.idx)];
    owner.team = g.teams[0];
    for (const p of g.players.slice(1)) p.team = g.teams[1];
    owner.life += 20;
    g.firstPlayer = 0;
  } else {
    g.planar.plane = deck.shift() || null;
  }
}
export function planarStartLog(g) {
  if (!g.planar) return;
  if (g.planar.kind === 'archenemy') g.log(`Archenemy: ${g.pn(g.players[0])} is the archenemy (40 life, ${g.planar.deck.length} schemes) against ${g.players.slice(1).map(p => g.pn(p)).join(', ')}`, { rule: '904.1', kind: 'turn' });
  else if (g.planar.plane) g.log(`Planechase: the game starts on ${g.cn(g.planar.plane)}${note(g.planar.plane)}`, { rule: '901.1', kind: 'turn' });
}
const note = o => (o.planar.unread.length ? ` (not played by the simulator: ${esc(o.planar.unread.join(' / ').slice(0, 160))})` : '');

// At the start of p's first main phase
export async function planarMain(g, p) {
  const P = g.planar;
  if (!P || g.over || p.lost) return;
  if (P.kind === 'archenemy') {
    if (p.idx !== 0 || !P.deck.length) return;
    const s = P.deck.shift();
    P.deck.push(s);
    g.log(`${g.pn(p)} sets ${g.cn(s)} in motion${s.planar.motion.length ? '' : note(s)}`, { rule: '904.9', kind: 'combo', p: p.idx });
    await g.beat(0.8);
    if (s.planar.motion.length) await g.stackAbility(p, s, s.planar.motion, 'set in motion', 'trigger');
    return;
  }
  // Planechase: the plane's upkeep ability, then one free roll of the planar die
  if (P.plane?.planar.upkeep.length) await g.stackAbility(p, P.plane, P.plane.planar.upkeep, `${P.plane.card.name} (upkeep)`, 'trigger');
  if (g.over || p.lost) return;
  const roll = Math.floor(g.rand() * 6);
  if (roll === 0) {
    const old = P.plane;
    if (old) P.deck.push(old);
    P.plane = P.deck.shift() || old;
    g.log(`${g.pn(p)} rolls the planar die: planeswalk! ${old ? `${g.cn(old)} goes to the bottom; ` : ''}the game moves to ${g.cn(P.plane)}${note(P.plane)}`, { rule: '901.9', kind: 'combo', p: p.idx });
    await g.beat(0.8);
    if (P.plane?.planar.arrive.length) await g.stackAbility(p, P.plane, P.plane.planar.arrive, `planeswalking to ${P.plane.card.name}`, 'trigger');
  } else if (roll === 1 && P.plane) {
    g.log(`${g.pn(p)} rolls the planar die: chaos on ${g.cn(P.plane)}${P.plane.planar.chaos.length ? '' : ' (its chaos ability isn\'t played by the simulator)'}`, { rule: '901.9', kind: 'combo', p: p.idx });
    await g.beat(0.6);
    if (P.plane.planar.chaos.length) await g.stackAbility(p, P.plane, P.plane.planar.chaos, `chaos (${P.plane.card.name})`, 'trigger');
  } else g.log(`${g.pn(p)} rolls the planar die: a blank`, { kind: 'minor', p: p.idx });
}
