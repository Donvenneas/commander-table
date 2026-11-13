// Mana (rules 106, 601.2g–h, 605): sources, costs, cost changes, payment plans and paying.
// Split out of engine.js (Round 5, item 176): each function is one of Game's methods, with the game as `g`; Game keeps
// a one-line method that calls it, so nothing else changes.
import { parseCost, COLORS } from './engine.js';

/** @param {import('./engine.js').Game} g */
export function sources(g, p, exclude) {
  return p.battlefield.filter(o => o !== exclude && !o.tapped && o.fx.mana && g.canTapNow(p, o)
    && (!o.fx.mana.gate || g.gateOk(o, o.fx.mana.gate)) && (o.fx.type.land || !g.abilityLocked(p, o))
    && g.spendOk(o.fx.mana.only) && landsOk(g, p, o));
}
// (rules 13) Temple of the False God: "Activate only if you control five or more lands" (the Temple counts: it is a
// land you control)
const landsOk = (g, p, o) => !(g.rules >= 13 && o.fx.mana.landsAtLeast) || p.battlefield.filter(x => x.fx.type.land).length >= o.fx.mana.landsAtLeast;
// (rules 13) Cavern of Souls: its "one mana of any color" can only pay for a creature spell of the chosen type, and
// that spell then can't be countered (Game.cast: unit.cavern). For anything else it taps for {C}.
const cavernSpell = (g, s) => {
  const f = g.payingFor;
  const o = f && !f.ability && !f.all ? f.o : null;
  return !!o && o.fx.type.creature && !!s.chosenType && (o.fx.subtypes.includes(s.chosenType) || o.fx.kw.has('changeling'));
};
// A creature can use {T} abilities (mana included) once it's been under your control since your turn began,
// or with haste, or with Shang-Chi / Thousand-Year Elixir-style "as though it had haste"
/** @param {import('./engine.js').Game} g */
export function canTapNow(g, p, o) { return !o.fx.type.creature || !o.sick || g.has(o, 'haste') || p.battlefield.some(s => s.fx.hasteAbilities); }
// Mana with a spending restriction (Shang-Chi: only creature abilities) is only offered for what it may pay for
/** @param {import('./engine.js').Game} g */
export function spendOk(g, only) {
  if (!only) return true;
  const f = g.payingFor;
  if (f?.all) return true;
  if (only === 'creatureAbility') return !!f?.ability && !!f.o?.fx.type.creature;
  if (only === 'creatureSpell') return !!f && !f.ability && !!f.o?.fx.type.creature;
  return true;
}
// Mana abilities that count something: Gaea's Cradle (creatures), Bloom Tender (colors), Nykthos (devotion)
/** @param {import('./engine.js').Game} g */
export function manaAmount(g, p, s) {
  const m = s.fx.mana;
  let n;
  if (m.dyn === 'colors') n = Math.max(1, new Set(p.battlefield.flatMap(o => o.card.colors || [])).size);
  else if (m.dyn === 'devotionMax') n = Math.max(m.floor || 0, Math.max(...'WUBRG'.split('').map(c => g.dynValue(p, { dyn: 'devotion', color: c }))) - (m.less || 0));
  else if (m.dyn === 'tribeMax') {
    const k = {};
    for (const o of p.battlefield) if (o.fx.type.creature) for (const t of o.fx.subtypes) k[t] = (k[t] || 0) + 1;
    n = Math.max(m.floor || 0, Math.max(0, ...Object.values(k)) - (m.less || 0));
  } else if (m.dyn === 'charge') n = s.named?.charge || 0;
  else n = m.dyn ? g.countControlled(p, m.dyn) : m.amount;
  // Goldspan Dragon: Treasures make two; Nyxbloom Ancient: everything makes three times as much
  if (s.card.name === 'Treasure' && p.battlefield.some(o => o.fx.treasureTwo)) n *= 2;
  for (const o of p.battlefield) if (o.fx.manaMult && (!o.fx.manaMultBasic || (s.fx.type.basic && s.fx.type.land))) n *= o.fx.manaMult;
  return n;
}
/** @param {import('./engine.js').Game} g */
export function units(g, p, exclude) {
  const u = p.pool.filter(x => g.spendOk(x.only)).map(x => ({ ref: x, colors: x.colors, pool: true }));
  // Kinnan: nonland mana sources make one extra
  const boost = p.battlefield.some(o => o.fx.manaBoost);
  // Chromatic Lantern: lands tap for any color; Crypt Ghast, Mirari's Wake: extra mana from some sources
  const lands = p.battlefield.filter(o => o.fx.type.land).length;
  const anyColor = p.battlefield.some(o => o.fx.landsAnyColor && (!o.fx.landsAnyColorN || lands >= o.fx.landsAnyColorN));
  const boosts = p.battlefield.filter(o => o.fx.landBoost).map(o => o.fx.landBoost);
  // High Tide: islands make an extra {U} this turn
  if (p.tempBoost?.turn === g.turn) boosts.push(p.tempBoost);
  // Urborg, Yavimaya: every land also taps for another color
  const addCols = [...new Set(g.alive().flatMap(q => q.battlefield.map(o => o.fx.allLandsAdd).filter(Boolean)))];
  for (const s of g.sources(p, exclude)) {
    // Lion's Eye Diamond discards the hand: only worth it once the hand is (nearly) empty
    if (s.fx.mana.discardHand && p.hand.filter(c => c !== p.casting).length > 1) continue;
    const n = g.manaAmount(p, s) + (boost && !s.fx.type.land ? 1 : 0);
    // Blood Moon: nonbasic lands only make {R}
    const moon = s.fx.type.land && !s.fx.type.basic && g.alive().some(q => q.battlefield.some(o => o.fx.bloodMoon));
    const colors = moon ? ['R'] : anyColor && s.fx.type.land ? COLORS : s.fx.type.land && addCols.length ? [...new Set([...s.fx.mana.colors, ...addCols])] : s.fx.mana.colors;
    // (rules 13) Cavern of Souls: any color (and can't-be-countered) for a creature spell of the chosen type, else {C}
    // (under Blood Moon it is a Mountain, which makes {R})
    const cav = g.rules >= 13 && s.fx.mana.cavern && !moon, cavOk = cav && cavernSpell(g, s);
    for (let i = 0; i < n; i++) u.push({ src: s, colors: cav ? (cavOk ? [...COLORS, 'C'] : ['C']) : colors, land: s.fx.type.land, only: s.fx.mana.only, ...(cavOk ? { cavern: true } : {}) });
    // Utopia Sprawl, Wild Growth on this land
    if (s.fx.type.land) for (const a of g.attachments(s)) if (a.fx.auraMana) u.push({ src: s, colors: a.fx.auraMana === '*' ? COLORS : [a.fx.auraMana], land: true });
    // Abundant Growth: the enchanted land taps for any color
    if (s.fx.type.land && g.attachments(s).some(a => a.fx.auraFix)) for (const x of u) if (x.src === s) x.colors = COLORS;
    for (const b of boosts) if ((!b.monarch || g.monarch === p.idx) &&g.isA(s, b.what === 'nonland permanent' ? 'nonland' : b.what) && (!b.onlyC || s.fx.mana.colors.includes('C'))) u.push({ src: s, colors: b.sym ? [b.sym] : colors, land: s.fx.type.land });
  }
  // Cryptolith Rite, Enduring Vitality: every creature taps for any color
  if (p.battlefield.some(o => o.fx.manaAnthem || o.fx.attachMana)) {
    // (Incubation Druid-style: only creatures with a counter on them)
    const kinds = new Set(p.battlefield.map(o => o.fx.manaAnthem).filter(Boolean));
    // (Gemhide Sliver, Esika: only creatures of a kind)
    const tribal = [...kinds].filter(k => typeof k === 'object');
    for (const c of p.battlefield) {
      if (c === exclude || !c.fx.type.creature || c.fx.mana || c.tapped || !g.canTapNow(p, c)) continue;
      // (Incubation Druid: creatures with counters; Jaheira: tokens; Ashaya: nontoken creatures are Forests)
      const any = kinds.has(true) || (kinds.has('counters') && c.counters > 0) || (kinds.has('tokensAny') && c.token) || g.attachments(c).some(a => a.fx.attachMana)
        || tribal.some(k => g.isA(c, k.tribe) && (!k.other || !c.fx.manaAnthem));
      const ok = any || (kinds.has('tokens') && c.token) || (kinds.has('G') && !c.token);
      if (ok) u.push({ src: c, colors: any ? COLORS : ['G'], land: false });
    }
  }
  // Spirit Guides: exile from hand for one mana (used last)
  for (const c of p.hand) if (c.fx.handMana) for (const col of c.fx.handMana) u.push({ guide: c, colors: [col] });
  // Chromatic Orrery: mana can be spent as though it were any color
  if (p.battlefield.some(o => o.fx.anyColorSpend)) for (const x of u) x.colors = [...COLORS, 'C'];
  return u;
}
// The mana one permanent would make if tapped now (restricted mana included; it keeps its restriction in the pool)
/** @param {import('./engine.js').Game} g */
export function manaUnitsOf(g, p, o) {
  const prev = g.payingFor;
  g.payingFor = { all: true };
  try { return g.units(p).filter(u => u.src === o && !u.convoke); } finally { g.payingFor = prev; }
}
// Tapping a permanent for mana by hand: the mana goes into the pool, which empties at the end of the step
/** @param {import('./engine.js').Game} g */
export function tapForMana(g, p, o) {
  const us = g.manaUnitsOf(p, o);
  if (!us.length) return false;
  const before = p.pool.length;
  const trig = g.queue.length;
  g.commitPayment(p, { units: us, used: new Set(), srcs: [o] });
  // Remember what it added, so the tap can be taken back while that mana is unspent (not a source that
  // left the battlefield or discarded a hand, nor one whose tapping set off a trigger)
  o.manualTap = o.zone === 'battlefield' && !o.fx.mana?.discardHand && g.queue.length === trig ? { turn: g.turn, phase: g.phase, units: p.pool.slice(before) } : null;
  const txt = us.map(u => (u.colors.length > 1 ? '{any}' : `{${u.colors[0]}}`)).join('');
  g.log(`${g.pn(p)} taps ${g.cn(o)} for ${txt}${us.some(u => u.only) ? ` (only for creature ${us[0].only === 'creatureSpell' ? 'spells' : 'abilities'})` : ''}`, { kind: 'minor' });
  g.emit('update');
  return true;
}
// Taking a tap back: a source you tapped by hand this step, whose mana is all still in your pool,
// that didn't sacrifice itself or set off a "becomes tapped" trigger
/** @param {import('./engine.js').Game} g */
export function canUntapForMana(g, p, o) {
  const t = o.manualTap;
  return !!t && o.tapped && o.zone === 'battlefield' && o.controller === p.idx && t.turn === g.turn && t.phase === g.phase && t.units.every(u => p.pool.includes(u));
}
/** @param {import('./engine.js').Game} g */
export function untapForMana(g, p, o) {
  if (!g.canUntapForMana(p, o)) return false;
  const t = o.manualTap;
  p.pool = p.pool.filter(u => !t.units.includes(u));
  o.tapped = false;
  o.manualTap = null;
  g.log(`${g.pn(p)} untaps ${g.cn(o)} and takes its mana back`, { kind: 'minor' });
  g.emit('update');
  return true;
}
/** @param {import('./engine.js').Game} g */
export function poolText(g, p) { return (p.pool || []).map(x => (x.colors.length > 1 ? '{any}' : `{${x.colors[0]}}`)).join(''); }
// A mana combo gives its controller unbounded mana for the rest of the turn
/** @param {import('./engine.js').Game} g */
export function infinite(g, p) { return p.infiniteMana === g.turn && g.active === p.idx; }
/** @param {import('./engine.js').Game} g */
export function availableMana(g, p) { return g.infinite(p) ? 99 : g.units(p).length; }
// avoid: colors needed by spells still to be cast this turn, kept back when paying generic costs
// help: extra one-shot payers for this spell (convoke creatures, delve graveyard cards)
/** @param {import('./engine.js').Game} g
 * @param {any} p @param {any} cost @param {number} [extra] @param {any} [exclude] @param {Set<string> | null} [avoid] @param {any[]} [help]
 */
export function planPayment(g, p, cost, extra = 0, exclude = null, avoid = null, help = []) {
  if (g.infinite(p)) return { free: true };
  const units = g.units(p, exclude).concat(help);
  // (rules 12) Phyrexian and two-brid symbols have two ways to be paid: planTagged tries them
  if (g.rules >= 12 && cost.pips.some((/** @type {any} */ x) => x.phy || x.two)) return planTagged(g, p, units, cost, extra, avoid);
  return greedyPlan(units, cost.pips, cost.generic + extra, avoid);
}
// How many Phyrexian symbols p can pay with life: 2 life each, never going below 1 life (Phase 2D's rule; the
// Comprehensive Rules (119.4) would let a player pay down to 0)
// (rules 13: none while the player's life total can't change, 119.8; lifeLock is only ever set from rules 13)
export const lifeSymbolsMax = p => (p.lifeLock ? 0 : Math.max(0, Math.floor(((p.life || 0) - 1) / 2)));
// (rules 12) A cost with Phyrexian ({B/P}: its color or 2 life) or two-brid ({2/W}: its color or {2}) symbols. Every way
// of paying is checked before anything is paid; the plan says how much life (plan.life) goes with the mana.
//   g.payLife: how many Phyrexian symbols the payer chose to pay with life (Game.choosePhyrexian); unset, as few as
//   possible (mana first). Two-brid symbols: the plan that taps the fewest new sources (mana already floating first),
//   then the one using the fewest mana units, so {2/W} takes a {W} when there is one and {2} otherwise.
/** @param {import('./engine.js').Game} g */
function planTagged(g, p, units, cost, extra, avoid) {
  const phy = cost.pips.filter((/** @type {any} */ x) => x.phy);
  const two = cost.pips.filter((/** @type {any} */ x) => x.two && !x.phy);
  const plain = cost.pips.filter((/** @type {any} */ x) => !x.phy && !x.two);
  const most = Math.min(phy.length, lifeSymbolsMax(p));
  const ks = g.payLife != null ? [g.payLife] : Array.from({ length: most + 1 }, (_, k) => k);
  // (which symbols, not just how many: Reaper King with a Plains and an Island pays {2/W} and {2/U} with them and the
  // other three with {2}; every subset is tried, and costs have few such symbols)
  const subsets = n => Array.from({ length: 2 ** n }, (_, m) => m);
  const bits = m => { let c = 0; for (; m; m &= m - 1) c++; return c; };
  for (const k of ks) {
    if (k < 0 || k > most) continue;
    let best = null;
    for (const lm of subsets(phy.length)) {
      if (bits(lm) !== k) continue;
      const phyMana = phy.filter((_, i) => !(lm & (1 << i)));
      for (const tm of subsets(two.length)) {
        const generic = cost.generic + extra + two.filter((_, i) => tm & (1 << i)).reduce((/** @type {number} */ s, /** @type {any} */ x) => s + x.two, 0);
        const plan = greedyPlan(units, [...plain, ...two.filter((_, i) => !(tm & (1 << i))), ...phyMana], generic, avoid);
        if (!plan) continue;
        const fresh = [...plan.used].filter(i => !units[i].pool).length;
        if (!best || fresh < best.fresh || (fresh === best.fresh && plan.used.size < best.plan.used.size)) best = { plan, fresh };
      }
    }
    if (best) return { ...best.plan, life: 2 * k, lifeSymbols: k };
  }
  return null;
}
// (rules 12) The numbers of Phyrexian symbols that could be paid with life for this cost, each a complete payment
/** @param {import('./engine.js').Game} g */
export function phyrexianOptions(g, p, cost, extra = 0, exclude = null, help = []) {
  if (g.infinite(p)) return [0];
  const out = [];
  const prev = g.payLife;
  try {
    for (let k = 0; k <= Math.min(cost.pips.filter((/** @type {any} */ x) => x.phy).length, lifeSymbolsMax(p)); k++) { g.payLife = k; if (g.planPayment(p, cost, extra, exclude, null, help)) out.push(k); }
  } finally { g.payLife = prev; }
  return out;
}
// The greedy plan: colored pips first (the narrowest first), then generic, preferring floating mana, the same
// source again, and sources that make one color
function greedyPlan(units, pips, generic, avoid) {
  const used = new Set();
  const srcs = new Set();
  // (the units that paid a colored pip: a painland tapped for colored mana hurts, for {C} it doesn't)
  const colored = new Set();
  const pick = (ok, generic = false) => {
    let best = -1, bs = -1e9;
    units.forEach((u, i) => {
      if (used.has(i) || !ok(u)) return;
      let s = 0;
      if (u.pool) s += 100;
      if (u.src && srcs.has(u.src)) s += 50;
      s -= u.colors.length * 2;
      if (u.land) s += 1;
      if (u.src?.fx.mana?.sac) s -= 20;
      if (u.src?.fx.type.creature) s -= 1;
      if (u.convoke || u.delve) s -= 15;
      if (u.guide) s -= 25;
      if (generic && avoid?.size && u.colors.some(c => avoid.has(c))) s -= 30;
      if (s > bs) { bs = s; best = i; }
    });
    if (best < 0) return false;
    used.add(best);
    if (!generic) colored.add(best);
    if (units[best].src) srcs.add(units[best].src);
    return true;
  };
  for (const pip of [...pips].sort((a, b) => a.length - b.length)) if (!pick(u => pip.some(c => u.colors.includes(c)))) return null;
  for (let i = 0; i < generic; i++) if (!pick(() => true, true)) return null;
  return { units, used, srcs: [...srcs], colored };
}
/** @param {import('./engine.js').Game} g */
export function commitPayment(g, p, plan) {
  if (plan.free) return;
  // (rules 12) Phyrexian symbols paid with life: paid, not dealt as damage; it is life lost (119.4, 119.3) and
  // triggers "whenever you lose life". The plan was checked whole before anything is paid.
  if (plan.life) {
    p.life -= plan.life;
    g.emit('life', { p: p.idx, d: -plan.life });
    g.log(`${g.pn(p)} pays ${plan.life} life for ${plan.lifeSymbols === 1 ? 'a Phyrexian mana symbol' : `${plan.lifeSymbols} Phyrexian mana symbols`}`, { kind: 'minor', rule: '107.4f' });
  }
  const usedPool = new Set();
  plan.units.forEach((u, i) => { if (u.pool && plan.used.has(i)) usedPool.add(u.ref); });
  p.pool = p.pool.filter(x => !usedPool.has(x));
  for (const s of plan.srcs) {
    s.tapped = true;
    if (s.fx.watch?.length || p.battlefield.some(x => x.fx.watch?.some(w => w.ev === 'tapped'))) g.fire('tapped', { o: s, p: p.idx });
    plan.units.forEach((u, i) => { if (u.src === s && !plan.used.has(i) && !u.convoke) p.pool.push({ colors: u.colors, only: u.only }); });
    // (rules 6) Painlands, Talismans: colored mana deals damage to you; Ancient Tomb, Mana Confluence: any mana
    const pain = s.fx.mana?.pain;
    if (pain && g.rules >= 6 && plan.units.some((u, i) => u.src === s && !u.convoke && (!pain.colored || !plan.used.has(i) || (plan.colored?.has(i) && u.colors.some(c => c !== 'C'))))) {
      if (pain.life) { p.life -= pain.n; g.emit('life', { p: p.idx, d: -pain.n }); g.log(`${g.pn(p)} pays ${pain.n} life for ${g.cn(s)}'s mana`, { kind: 'minor' }); }
      else { g.damagePlayer(p, pain.n, s, false); g.log(`${g.cn(s)} deals ${pain.n} damage to ${g.pn(p)}`, { kind: 'minor' }); }
    }
    if (s.fx.mana?.sac) { g.move(s, 'graveyard'); g.fire('sac', { o: s, p: p.idx }); }
    if (s.fx.mana?.discardHand) {
      const hand = p.hand.filter(c => c !== p.casting);
      g.discard(p, hand, null);
      g.log(`${g.pn(p)} discards their hand${hand.length ? ` (${hand.length} card${hand.length === 1 ? '' : 's'})` : ''} for ${g.cn(s)}'s mana`, { kind: 'minor' });
    }
  }
  const guides = [...new Set(plan.units.filter((u, i) => u.guide && plan.used.has(i)).map(u => u.guide))];
  for (const o of guides) { g.move(o, 'exile'); g.log(`${g.pn(p)} exiles ${g.cn(o)} from their hand for mana`, { kind: 'minor' }); }
  const delved = plan.units.filter((u, i) => u.delve && plan.used.has(i)).map(u => u.delve);
  for (const o of delved) g.move(o, 'exile');
  if (delved.length) g.log(`${g.pn(p)} exiles ${delved.length} card${delved.length === 1 ? '' : 's'} from their graveyard (delve)`, { kind: 'minor', rule: '702.66a' });
  g.payingFor = null;
}
// Convoke creatures and delve cards that can help pay for this spell
/** @param {import('./engine.js').Game} g */
export function helpUnits(g, p, o) {
  const out = [];
  // (Dazzling Theater, Hoarding Broodlord: some spells you cast have convoke)
  const convoke = o.fx.convoke || p.battlefield.some(s => s.fx.convokeGrant === 'creature' ? o.fx.type.creature : s.fx.convokeGrant === 'exile' && o.zone === 'exile');
  if (convoke) for (const c of p.battlefield) if (c.fx.type.creature && !c.tapped && !c.fx.mana) out.push({ src: c, colors: [...(c.card.colors || []), 'C'], convoke: true });
  if (o.fx.delve) for (const c of p.graveyard) if (c !== o) out.push({ delve: c, colors: [] });
  // Improvise: tap artifacts that aren't mana sources for generic mana
  if (o.fx.kw.has('improvise') || (!o.fx.type.artifact && p.battlefield.some(s => s.fx.improviseAll))) for (const c of p.battlefield) if (c.fx.type.artifact && !c.tapped && !c.fx.mana) out.push({ src: c, colors: [], convoke: true });
  return out;
}
// A spell description from card text: "black", "green permanent", "aura, equipment, or vehicle", "zombie"
/** @param {import('./engine.js').Game} g */
export function spellIs(g, o, what) {
  if (!what || what === 'any') return true;
  const COLOR = { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' };
  return what.split(/,? or |, /).some(alt => alt.trim().split(/\s+/).every(w => {
    if (COLOR[w]) return (o.card.colors || []).includes(COLOR[w]);
    if (w === 'permanent') return o.fx.type.permanent;
    if (w === 'multicolored') return (o.card.colors || []).length > 1;
    if (w === 'colorless') return !(o.card.colors || []).length;
    if (w === 'historic') return o.fx.type.artifact || o.fx.type.legendary || o.fx.subtypes.includes('saga');
    if (w === 'vehicle' || w === 'aura' || w === 'equipment') return o.fx.subtypes.includes(w) || !!o.fx.type[w];
    return g.isA(o, w);
  }));
}
// How many permanents p controls of a type or subtype ("creature", "elf", "artifact creature")
/** @param {import('./engine.js').Game} g */
export function countControlled(g, p, what) { return p.battlefield.filter(o => g.isA(o, what)).length; }
const COLOR_WORDS = { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' };
/** @param {import('./engine.js').Game} g */
export function isA(g, o, what) {
  if (!what || what === 'permanent' || what === 'any') return true;
  return what.split(/\s+/).every(w => {
    if (w === 'nontoken') return !o.token;
    if (w === 'token') return o.token;
    if (w === 'nonland') return !o.fx.type.land;
    if (w === 'noncreature') return !o.fx.type.creature;
    if (w in o.fx.type) return o.fx.type[w];
    // (rules 7) colors: "blue creature" (Grand Architect), "white permanent"…
    if (g.rules >= 7 && w in COLOR_WORDS) return g.colorsOf(o).includes(COLOR_WORDS[w]);
    return o.fx.subtypes.includes(w) || o.fx.subtypes.includes(w.replace(/s$/, '')) || (o.fx.type.creature && (o.fx.kw.has('changeling') || o.fx.allTypes || !!g.players[o.controller]?.battlefield.some(s => s.fx.allTypesTeam)));
  });
}
// A permanent letting p cast o from their graveyard once this turn (Kess, Serra Paragon, Muldrotha)
/** @param {import('./engine.js').Game} g */
export function gyOnceSource(g, p, o) {
  if (g.active !== p.idx || o.owner !== p.idx || o.zone !== 'graveyard' || o.fx.type.land) return null;
  return p.battlefield.find(s => s.fx.gyCastOnce && s.gyOnceTurn !== g.turn && s.fx.gyCastOnce.types.some(t => o.fx.type[t]) && (s.fx.gyCastOnce.maxMv == null || (o.card.cmc || 0) <= s.fx.gyCastOnce.maxMv)) || null;
}
/** @param {import('./engine.js').Game} g */
export function handOnlyAgainst(g, p) { return g.opponents(p).some(q => q.battlefield.some(o => o.fx.handOnly)); }
// n other cards of a color in hand to exile for an alternative cost (cheapest first), or null
/** @param {import('./engine.js').Game} g */
export function pitchCards(g, p, o, color, n) {
  const pool = p.hand.filter(c => c !== o && !c.fx.type.land && (c.card.colors || []).includes(color)).sort((a, b) => (a.card.cmc || 0) - (b.card.cmc || 0));
  return pool.length >= n ? pool.slice(0, n) : null;
}
// The creature a Flare would sacrifice: the least valuable one that fits (never a commander)
/** @param {import('./engine.js').Game} g */
export function altSacFodder(g, p, o) {
  return p.battlefield.filter(x => x.fx.type.creature && !x.isCommander && g.spellIs(x, o.fx.altSac)).sort((a, b) => p.agent.value(g, a) - p.agent.value(g, b))[0] || null;
}
// A card in hand that shares a color with o, to exile for a Force of Will style pitch cost
/** @param {import('./engine.js').Game} g */
export function pitchCard(g, p, o) {
  const colors = o.card.colors || [];
  return p.hand.find(c => c !== o && !c.fx.type.land && (c.card.colors || []).some(x => colors.includes(x)));
}
/** @param {import('./engine.js').Game} g */
export function dynValue(g, p, d, ctx = {}) {
  if (d.dyn === 'devotion') return p.battlefield.reduce((s, o) => s + parseCost(o.card.manaCost).pips.filter(pip => pip.includes(d.color)).length, 0);
  if (d.dyn === 'count') return p.battlefield.filter(o => o.fx.type[d.what]).length;
  if (d.dyn === 'hand') return p.hand.length;
  if (d.dyn === 'gy') return p.graveyard.length;
  if (d.dyn === 'maxPower') return Math.max(0, ...p.battlefield.filter(o => o.fx.type.creature).map(o => g.power(o)));
  if (d.dyn === 'maxToughness') return Math.max(0, ...p.battlefield.filter(o => o.fx.type.creature).map(o => g.toughness(o)));
  if (d.dyn === 'sacPower') return p.lastSacPower || 0;
  if (d.dyn === 'sacMv') return p.lastSacMv || 0;
  if (d.dyn === 'opps') return g.opponents(p).length;
  if (d.dyn === 'oppMaxHand') return Math.max(0, ...g.opponents(p).map(q => q.hand.length));
  if (d.dyn === 'tappedCreatures') return p.battlefield.filter(o => o.fx.type.creature && o.tapped).length;
  if (d.dyn === 'maxMv') return Math.max(0, ...p.battlefield.filter(o => g.isA(o, d.what)).map(o => o.card.cmc || 0));
  if (d.dyn === 'toSeven') return Math.max(0, 7 - p.hand.length);
  if (d.dyn === 'selfPower') return ctx.src ? Math.max(0, ctx.src.zone === 'battlefield' ? g.power(ctx.src) : g.basePower(ctx.src.card) + (ctx.src.lastCounters || 0)) : 0;
  if (d.dyn === 'oppMax') return Math.max(0, ...g.opponents(p).map(q => g.countControlled(q, d.what)));
  if (d.dyn === 'devotionMax') return Math.max(...'WUBRG'.split('').map(c => g.dynValue(p, { dyn: 'devotion', color: c })));
  if (d.dyn === 'totalPower') return p.battlefield.filter(o => o.fx.type.creature).reduce((s, o) => s + Math.max(0, g.power(o)), 0);
  if (d.dyn === 'halfX') return Math.floor((ctx.x || ctx.trig?.x || 0) / 2);
  if (d.dyn === 'defCount') { const q = g.players[ctx.src?.attacking ?? -1]; return q ? q.battlefield.filter(o => g.isA(o, d.what)).length : 0; }
  if (d.dyn === 'halfXup') return Math.ceil((ctx.x || ctx.trig?.x || 0) / 2);
  if (d.dyn === 'attachedPower') return ctx.src?.attachedTo?.zone === 'battlefield' ? Math.max(0, g.power(ctx.src.attachedTo)) : 0;
  // Earthquake Dragon, Excalibur: the total mana value of what you control
  if (d.dyn === 'sumMv') return p.battlefield.filter(o => g.isA(o, d.what === 'historic permanent' ? 'permanent' : d.what) && (d.what !== 'historic permanent' || o.fx.type.artifact || o.fx.type.legendary || o.fx.subtypes.includes('saga'))).reduce((s, o) => s + (o.card.cmc || 0), 0);
  if (d.dyn === 'countWhere') return (d.where === 'gy' ? p.graveyard : d.where === 'all' ? g.alive().flatMap(q => q.battlefield) : p.battlefield).filter(o => g.isA(o, d.what)).length;
  // "That many", "its power": from the event that set off the trigger
  const t = ctx.trig || {};
  if (d.dyn === 'trigN') return t.n ?? 1;
  if (d.dyn === 'trigP') return t.o ? Math.max(0, g.power(t.o)) : 0;
  if (d.dyn === 'trigT') return t.o ? Math.max(0, g.toughness(t.o)) : 0;
  if (d.dyn === 'trigMV') return t.o?.card.cmc || 0;
  return 0;
}
// How p could pay for o right now: its normal cost (with convoke/delve help) or an alternative
// (what's being paid for decides which restricted mana can help: see spendOk)
/** @param {import('./engine.js').Game} g */
export function castMode(g, p, o) {
  const prev = g.payingFor;
  g.payingFor = { o, ability: false };
  try { return g.castModeRaw(p, o); } finally { g.payingFor = prev; }
}
/** @param {import('./engine.js').Game} g */
export function castModeRaw(g, p, o) {
  // Morph, megamorph, disguise (702.37, 702.168): cast face down as a 2/2 for {3} at sorcery speed
  const faceDownOk = g.canCastFaceDown(p, o);
  if (o.fx.type.land && faceDownOk) return { alt: 'morph' };
  if (o.fx.type.land || (!o.card.manaCost && !o.fx.altFree && !o.fx.suspend)) return null;
  // A signature spell needs its oathbreaker on the battlefield
  if (o.signature && o.zone === 'command' && !p.battlefield.some(x => x.oathbreaker)) return null;
  // Savage Beating, Take the Bait, Berserk: only at certain points of combat
  const cw = o.fx.castWhen;
  if (cw && !(cw === 'myCombat' ? g.phase === 'combat' && g.active === p.idx : cw === 'oppCombat' ? g.phase === 'combat' && g.active !== p.idx : ['upkeep', 'draw', 'main1', 'combat'].includes(g.phase))) return null;
  // Silence, Orim's Chant
  if (g.silenced[p.idx] === g.turn) return null;
  // Grand Abolisher, Dragonlord Dromoka: opponents can't cast spells during its controller's turn
  if (g.active !== p.idx && g.players[g.active]?.battlefield.some(x => x.fx.noCastMyTurn && (x.fx.noCastMyTurn !== 'attached' || x.attachedTo))) return null;
  if (o.zone !== 'hand' && o.zone !== 'stack' && g.handOnlyAgainst(p)) return null;
  if (g.spellCapped(p, o)) return null;
  if (o.zone === 'graveyard') {
    if (o.fx.flashback && g.planPayment(p, parseCost(o.fx.flashback), 0) && g.canPayCosts(p, o, o.fx.flashbackCosts, o)) return { alt: 'flashback' };
    // Past in Flames, Snapcaster Mage: flashback for its mana cost this turn
    if (o.tempFlashback === g.turn && o.card.manaCost && g.planPayment(p, parseCost(o.card.manaCost), 0)) return { alt: 'flashback', granted: true };
    // Lier, Disciple of the Drowned: instants and sorceries in your graveyard have flashback
    if ((o.fx.type.instant || o.fx.type.sorcery) && o.owner === p.idx && o.card.manaCost && p.battlefield.some(x => x.fx.gyFlashbackAll) && g.planPayment(p, parseCost(o.card.manaCost), 0)) { o.tempFlashback = g.turn; return { alt: 'flashback', granted: true }; }
    // Underworld Breach: escape for the mana cost plus exiling three other cards from the graveyard
    if (!o.fx.type.land && o.card.manaCost && p.battlefield.some(x => x.fx.breach) && p.graveyard.length >= 4 && g.planPayment(p, parseCost(o.card.manaCost), 0)) return { alt: 'escape' };
    // The card's own escape cost (702.138), and jump-start (mana cost plus a discard, 702.133)
    if (o.fx.escape && p.graveyard.length > o.fx.escape.n && g.planPayment(p, parseCost(o.fx.escape.cost), 0)) return { alt: 'escapeOwn' };
    if (o.fx.jumpstart && p.hand.length && g.planPayment(p, parseCost(o.card.manaCost), 0)) return { alt: 'jumpstart' };
    // Gravecrawler, Squee: castable from the graveyard (sometimes only while a condition holds)
    if (o.fx.gyCastSelf && o.owner === p.idx && (!o.fx.gyCastSelf.cond || g.evalCond(p, o, o.fx.gyCastSelf.cond, {})) && g.planPayment(p, g.costOf(p, o).c, 0)) return { alt: null };
    // Yawgmoth's Will, Chainer: cast (some) spells from your graveyard this turn
    const gc = p.gyCast;
    if (gc?.turn === g.turn && o.owner === p.idx && !o.fx.type.land && (!gc.types.length || gc.types.some(t => o.fx.type[t])) && g.planPayment(p, g.costOf(p, o).c, 0)) return { alt: null };
    // Kess, Serra Paragon, Muldrotha: one such spell each of your turns
    const once = g.gyOnceSource(p, o);
    if (once && g.planPayment(p, g.costOf(p, o).c, 0)) return { alt: null, gyOnce: once.iid };
    return null;
  }
  // Cards that may be played from exile (impulse draw) or from the top of the library
  // Foretold and plotted cards: cast on a later turn for the foretell cost, or free at sorcery speed (plot)
  if (o.zone === 'exile' && o.foretold != null && o.owner === p.idx) {
    if (o.foretold >= g.turn) return null;
    if (o.fx.foretell) return g.planPayment(p, parseCost(o.fx.foretell), 0) ? { alt: 'foretold' } : null;
    return g.active === p.idx && (g.phase === 'main1' || g.phase === 'main2') && !g.stack.length ? { alt: 'free' } : null;
  }
  if (o.zone === 'exile' && !(o.mayPlay && o.mayPlay.p === p.idx && o.mayPlay.until >= g.turn) && !(o.fx.gyCastSelf?.exile && o.owner === p.idx) && !(g.rules >= 7 && o.fx.exileCast && o.owner === p.idx)) return null;
  // Urza, Lord High Artificer: the exiled card may be played without paying its mana cost
  if (o.zone === 'exile' && o.mayPlay?.free && o.mayPlay.p === p.idx) return { alt: 'free' };
  // Lavinia: opponents can't cast noncreature spells costing more than their land count
  if (!o.fx.type.creature && (o.card.cmc || 0) > p.battlefield.filter(x => x.fx.type.land).length && g.opponents(p).some(q => q.battlefield.some(s => s.fx.landCap))) return null;
  // Rakdos, Lord of Riots: castable only when its condition holds
  if (o.fx.castCond && !g.evalCond(p, o, o.fx.castCond, {})) return null;
  if (o.zone === 'library' && !g.topPlayable(p, o)) return null;
  if (o.fx.lifeCost && p.life <= o.fx.lifeCost) return null;
  if (o.fx.addCost && !g.canPayCosts(p, o, o.fx.addCost, o)) return null;
  // An AI pilot only casts a pact it can pay for next turn (on top of pacts already owed)
  const pact = o.fx.spell.find(e => e.k === 'pact');
  if (pact && !p.agent.human) {
    const owed = (p.pacts || []).reduce((s, x) => s + parseCost(x.cost).generic + parseCost(x.cost).pips.length, 0);
    const need = parseCost(pact.cost).generic + parseCost(pact.cost).pips.length;
    if (g.sources(p).reduce((a, s) => a + (s.fx.mana?.amount || 1), 0) + p.battlefield.filter(x => x.tapped && x.fx.mana).reduce((a, s) => a + s.fx.mana.amount, 0) < owed + need) return null;
  }
  const { c, extra } = g.costOf(p, o);
  // Overload (702.96): when affordable, the "each" version is cast instead
  if (o.fx.overload && g.planPayment(p, parseCost(o.fx.overload), extra)) return { alt: 'overload' };
  // Miracle: its first draw this turn can be cast for the miracle cost
  if (o.fx.miracle && o.zone === 'hand' && o.miracleTurn === g.turn && g.planPayment(p, parseCost(o.fx.miracle), 0)) return { alt: 'miracle' };
  if (o.card.manaCost && g.planPayment(p, c, extra, null, null, g.helpUnits(p, o))) return { alt: null };
  if (faceDownOk) return { alt: 'morph' };
  // Suspend (702.62): exiled with time counters for its suspend cost, cast free later (only on its owner's own turn, at sorcery timing)
  if (o.fx.suspend && o.zone === 'hand' && g.active === p.idx && (g.phase === 'main1' || g.phase === 'main2') && !g.stack.length && g.planPayment(p, parseCost(o.fx.suspend.cost), 0)) return { alt: 'suspend' };
  // Cheaper ways in when the full cost is out of reach: dash and blitz (haste, back at end of turn), spectacle
  if (o.fx.dash && g.planPayment(p, parseCost(o.fx.dash), 0)) return { alt: 'dash' };
  if (o.fx.blitz && g.planPayment(p, parseCost(o.fx.blitz), 0)) return { alt: 'blitz' };
  if (o.fx.spectacle && g.opponents(p).some(q => q.lostLifeTurn === g.turn) && g.planPayment(p, parseCost(o.fx.spectacle), 0)) return { alt: 'spectacle' };
  if (o.fx.altFree === 'commander' && p.battlefield.some(x => x.isCommander)) return { alt: 'free' };
  // Rooftop Storm: zombie creature spells are free; Invigorate: free with a Forest (an opponent gains 3 life)
  if (o.fx.type.creature && p.battlefield.some(s => s.fx.freeTribe && g.isA(o, s.fx.freeTribe))) return { alt: 'free' };
  if (o.fx.altFree === 'forestGift' && p.battlefield.some(x => x.fx.subtypes.includes('forest'))) return { alt: 'forestGift' };
  // Foretell and plot from the hand (on your own turn, at sorcery speed) when it can't be cast now
  const sorc = o.zone === 'hand' && g.active === p.idx && (g.phase === 'main1' || g.phase === 'main2') && !g.stack.length;
  if (sorc && o.fx.foretell && g.planPayment(p, { generic: 2, pips: [], x: 0 }, 0)) return { alt: 'foretell' };
  if (sorc && o.fx.plot && g.planPayment(p, parseCost(o.fx.plot), 0)) return { alt: 'plot' };
  // Impending (the Overlords): cheaper, and not a creature for a few turns
  if (o.zone === 'hand' && o.fx.impending && g.planPayment(p, parseCost(o.fx.impending.cost), 0)) return { alt: 'impending' };
  if (o.fx.altFree === 'pitch' && g.pitchCard(p, o)) return { alt: 'pitch' };
  // Mindbreak Trap: free once an opponent has cast three spells this turn
  if (o.fx.altFree === 'storm3' && g.opponents(p).some(q => q.turnSpells?.turn === g.turn && q.turnSpells.n >= 3)) return { alt: 'free' };
  if (o.fx.evoke && g.planPayment(p, parseCost(o.fx.evoke), 0)) return { alt: 'evoke' };
  // (1.7.0) Solitude, Fury, Endurance: evoke by exiling a card of its color; Flares, Commandeer, Daze
  if (o.zone === 'hand' && o.fx.evokePitch && g.pitchCards(p, o, o.fx.evokePitch, 1)) return { alt: 'evokePitch' };
  if (o.zone === 'hand' && o.fx.altPitch && g.pitchCards(p, o, o.fx.altPitch.color, o.fx.altPitch.n)) return { alt: 'altPitch' };
  if (o.fx.altSac && g.altSacFodder(p, o)) return { alt: 'altSac' };
  if (o.fx.altBounce && p.battlefield.some(x => x.fx.type.land && (o.fx.altBounce === 'land' || x.fx.subtypes.includes(o.fx.altBounce)))) return { alt: 'altBounce' };
  // Baleful Mastery: a cheaper alternative mana cost
  if (o.fx.altMana && (!o.fx.altManaCond || g.evalCond(p, o, o.fx.altManaCond, {})) && g.planPayment(p, parseCost(o.fx.altMana), 0)) return { alt: 'altMana' };
  // Snuff Out, Dismember-style: pay life instead of the mana cost
  const al = o.fx.altLife;
  if (al && p.life > al.n + 6 && (!al.cond || g.evalCond(p, o, al.cond, {}))) return { alt: 'life' };
  return null;
}
/** @param {import('./engine.js').Game} g */
export function costOf(g, p, o) {
  const c = parseCost(o.card.manaCost);
  // Cost reducers (Goblin Electromancer, Foundry Inspector…) only lower the generic part
  // (The Ur-Dragon's eminence also works from the command zone)
  for (const s of [...p.battlefield, ...(p.command || []).filter(x => x.fx.costReduce?.cmdZone)]) {
    const r = s.fx.costReduce;
    if (!r || s === o || !(r.what === 'chosen' ? !!s.chosenType && o.fx.type.creature && o.fx.subtypes.includes(s.chosenType) : g.reduces(r.what, o))) continue;
    if (r.minPower && !(g.basePower(o.card) >= r.minPower)) continue;
    if (r.minMv && !((o.card.cmc || 0) >= r.minMv)) continue;
    if (r.from && !r.from.includes(o.zone)) continue;
    // "The first creature spell you cast each turn"
    if (r.first && g.castThisTurn(p).some(x => g.reduces(r.what, x))) continue;
    // Alisaie: only the second spell each turn
    if (r.second && g.castThisTurn(p).length !== 1) continue;
    c.generic = Math.max(0, c.generic - r.n);
  }
  // Thalia, Sphere of Resistance: spells cost more
  for (const q of g.alive()) for (const s of q.battlefield) {
    const tx = s.fx.costTax;
    if (tx && (!tx.oppOnly || q !== p) && g.reduces(tx.what, o) && (!tx.offTurn || g.active !== p.idx) && (!tx.fromGyExile || o.zone === 'graveyard' || o.zone === 'exile')) c.generic += tx.n;
    // Helm of Awakening: every spell costs less
    if (s.fx.costReduceAll) c.generic = Math.max(0, c.generic - s.fx.costReduceAll);
  }
  // Affinity for artifacts (702.41)
  if (o.fx.affinity) c.generic = Math.max(0, c.generic - p.battlefield.filter(x => x.fx.type.artifact).length);
  // "~ costs {1} less to cast for each creature on the battlefield", "… if you control …"
  const sr = o.fx.selfReduce;
  if (sr) {
    let k = 0;
    if (sr.cond) k = g.evalCond(p, o, sr.cond, {}) ? 1 : 0;
    else if (sr.dyn) k = g.dynValue(p, sr.dyn);
    else {
      const pool = sr.where === 'gy' ? p.graveyard : sr.where === 'all' ? g.alive().flatMap(q => q.battlefield) : sr.where === 'opp' ? g.opponents(p).flatMap(q => q.battlefield) : p.battlefield;
      k = pool.filter(x => g.isA(x, sr.each.replace(/ cards?$/, ''))).length;
    }
    c.generic = Math.max(0, c.generic - sr.n * k);
  }
  return { c, extra: o.zone === 'command' ? 2 * (p.castCount[o.iid] || 0) : 0 };
}
// The top card of p's library, when a permanent lets them play it (Courser of Kruphix, Future Sight)
/** @param {import('./engine.js').Game} g */
export function topPlayable(g, p, o) {
  if (p.library[p.library.length - 1] !== o) return false;
  return p.battlefield.some(s => {
    const k = s.fx.playTop;
    if (!k) return false;
    // The Reality Chip: only while attached; Augur of Autumn: only with coven
    if (s.fx.playTopAttached && !s.attachedTo) return false;
    if (s.fx.playTopCond && !g.evalCond(p, s, s.fx.playTopCond, {})) return false;
    if (k === 'historic') return o.fx.type.artifact || o.fx.type.legendary || o.fx.subtypes.includes('saga');
    if (k === 'all') return true;
    if (k === 'land') return o.fx.type.land;
    if (o.fx.type.land) return false;
    return k === 'spell' || g.isA(o, k);
  });
}
// The cost of an alternative way to cast (or extra costs added on top)
/** @param {import('./engine.js').Game} g */
export function altCost(g, o, alt) {
  const k = { morph: '{3}', bestow: o.fx.bestow, mutate: o.fx.mutate, madness: o.fx.madness, cleave: o.fx.cleave, aftermath: o.card.manaCost, fuse: o.card.altFace ? `${o.card.manaCost}${o.card.altFace.manaCost}` : null, foretold: o.fx.foretell, foretell: '{2}', plot: o.fx.plot, impending: o.fx.impending?.cost, flashback: o.tempFlashback === g.turn && !o.fx.flashback ? o.card.manaCost : o.fx.flashback, evoke: o.fx.evoke, miracle: o.fx.miracle, suspend: o.fx.suspend?.cost, overload: o.fx.overload, altMana: o.fx.altMana, escape: o.card.manaCost, escapeOwn: o.fx.escape?.cost, jumpstart: o.card.manaCost, dash: o.fx.dash, blitz: o.fx.blitz, spectacle: o.fx.spectacle }[alt];
  return k != null ? parseCost(k) : { generic: 0, pips: [], x: 0 };
}
/** @param {import('./engine.js').Game} g */
export function addCost(g, a, b) { return { generic: a.generic + b.generic, pips: [...a.pips, ...b.pips], x: a.x + b.x }; }
/** @param {import('./engine.js').Game} g */
export function reduces(g, what, o) {
  const t = o.fx.type;
  return { any: true, creature: t.creature, noncreature: !t.creature, artifact: t.artifact, enchantment: t.enchantment, 'instant and sorcery': t.instant || t.sorcery, instant: t.instant, sorcery: t.sorcery, legendary: t.legendary }[what]
    // "blue spells", "red or green", "colorless", "artifact or enchantment"
    ?? g.spellIs(o, what);
}
/** @param {import('./engine.js').Game} g */
export function canCast(g, p, o) { return !!g.castMode(p, o); }
// The spells p has cast this turn (Rule of Law, Conduit of Ruin)
/** @param {import('./engine.js').Game} g */
export function castThisTurn(g, p) { return p.castList?.turn === g.turn ? p.castList.list : []; }
// Rule of Law, Deafening Silence, Ethersworn Canonist: one spell (of a kind) per player each turn
/** @param {import('./engine.js').Game} g */
export function spellCapped(g, p, o) {
  for (const q of g.alive()) for (const s of q.battlefield) {
    const cap = s.fx.spellCap;
    if (!cap) continue;
    const kind = cap === 'any' ? () => true : cap === 'noncreature' ? x => !x.fx.type.creature : x => !x.fx.type.artifact;
    if (kind(o) && g.castThisTurn(p).some(kind)) return true;
  }
  return false;
}
// Ward on a permanent, its own or granted (Bronze Guardian, Innkeeper's Talent): { n: mana, life }
/** @param {import('./engine.js').Game} g */
export function wardOf(g, o) {
  let n = o.fx.ward || 0, life = o.fx.wardLife || 0;
  for (const s of g.players[o.controller].battlefield) {
    const w = s.fx.wardGrant;
    if (!w || (w.other && s === o)) continue;
    if (w.counters ? !(o.counters > 0 || (o.named && Object.values(o.named).some(v => v > 0))) : !(w.what === 'commander' ? o.isCommander : g.spellIs(o, w.what))) continue;
    n = Math.max(n, w.n); life = Math.max(life, w.life);
  }
  return { n, life };
}
// "Damage can't be prevented" (Questing Beast, Sunspine Lynx)
/** @param {import('./engine.js').Game} g */
export function noPrevent(g) { return g.alive().some(q => q.battlefield.some(s => s.fx.noPrevent)); }
