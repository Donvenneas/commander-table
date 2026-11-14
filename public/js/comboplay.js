// Combos played out with the real cards (Phase 2C, rules 11 and later). Game.goOff still casts the pieces for real;
// then, instead of the old shortcut (a few made-up repetitions and an abstract result: life set directly, lethal
// "combat" damage with no combat, a library moved straight into the graveyard), playOut drives the cards' own
// abilities through the engine: activations with their costs, the stack and priority, triggers, the damage system
// (prevention, lifelink), combat in the combat step, and zone changes through Game.move.
//
// Each supported combo has a way to be played (combos.js comboPlay → PLAYERS here). Nothing is declared: when a step
// fails (a cost can't be paid, an opponent answers, damage is prevented), the combo stops there and the log says why.
// The one shortcut kept is the one the rules allow (727.1c): a mana loop that has been played for real and has made
// more mana each time may be repeated "as many times as needed" (Player.infiniteMana), and what that mana is spent
// on is again played with the real cards.
import { comboPlay } from './combos.js';
import { esc } from './util.js';

// (safety: no play-out repeats a step more than this, whatever happens)
const MAX_STEPS = 400;
const opps = (g, p) => g.opponents(p);
const named = (p, name, zones = ['battlefield']) => zones.flatMap(z => p[z]).find(o => o.card.name === name || o.card.frontName === name);
const abWith = (g, o, k) => g.abilitiesOf(o).find(a => (a.effects || []).some(e => e.k === k));
const life = g => g.players.map(q => (q.lost ? 'x' : q.life)).join(',');

// The seat's own target choices, with some decided by the play-out (copy *this* creature, ping *that* opponent);
// the rest stay the seat's. Restored afterwards.
async function steer(p, pick, fn) {
  const a = p.agent;
  const had = { s: Object.prototype.hasOwnProperty.call(a, 'chooseTarget'), a: Object.prototype.hasOwnProperty.call(a, 'chooseTargetAsync') };
  const sync = a.chooseTarget, asy = a.chooseTargetAsync;
  a.chooseTarget = (g, q, e, src) => pick(e, src) ?? sync.call(a, g, q, e, src);
  if (asy) a.chooseTargetAsync = async (g, q, e, src) => pick(e, src) ?? asy.call(a, g, q, e, src);
  try { return await fn(); } finally {
    if (had.s) a.chooseTarget = sync; else delete a.chooseTarget;
    if (asy) { if (had.a) a.chooseTargetAsync = asy; else delete a.chooseTargetAsync; }
  }
}
// The opponent the combo goes after first: the lowest life total still in the game
const victim = (g, p) => [...opps(g, p)].sort((a, b) => a.life - b.life || a.idx - b.idx)[0];

/** @type {Record<string, (g: any, p: any, combo: any, st: any) => Promise<string>>} */
const PLAYERS = {
  // Thassa's Oracle, Chain of Smog: the spells cast by goOff did everything there is to do
  async spells(g) { return g.over ? 'the spells did it' : 'the spells resolved'; },

  // Laboratory Maniac, Jace: the library is gone; the next card drawn wins. Jace draws one at once.
  async emptyDraw(g, p) {
    if (p.library.length) return `${p.library.length} card${p.library.length === 1 ? ' is' : 's are'} left in the library`;
    const jace = named(p, 'Jace, Wielder of Mysteries');
    const plus = jace?.fx.pw?.find(a => (a.effects || []).some(e => e.k === 'draw'));
    if (jace && plus && !jace.usedPW && jace.loyalty + plus.cost >= 0) { await g.activatePW(p, jace, plus); await g.sba(); return g.over ? 'Jace drew from an empty library' : "Jace's draw didn't win"; }
    return 'the library is empty: the next card drawn wins the game';
  },

  // Exquisite Blood with Sanguine Bond (or Vito, Blight-Priest): their own triggers loop once life is gained or lost
  async lifeTriggers() { return 'assembled: the next time life is gained, the triggers loop on their own'; },

  // Niv-Mizzet with Curiosity (or Ophidian Eye): each draw deals damage and each hit draws. The Firemind draws now.
  async drawTriggers(g, p) {
    const niv = named(p, 'Niv-Mizzet, the Firemind');
    const draw = niv && abWith(g, niv, 'draw');
    if (draw && g.canActivate(p, niv, draw)) { await g.activate(p, niv, draw); await g.sba(); return 'started with a card drawn'; }
    return 'assembled: the next card drawn starts it';
  },

  // Heliod gives Ballista lifelink; each ping gains life, and Heliod's trigger puts the counter back
  async heliod(g, p) {
    const wb = named(p, 'Walking Ballista'), he = named(p, 'Heliod, Sun-Crowned');
    if (!wb || !he) return 'a piece is missing';
    const grant = abWith(g, he, 'pump');
    const pick = (e, src) => ((src === he && (e.k === 'pump' || e.k === 'counters')) ? { obj: wb } : undefined);
    return steer(p, pick, async () => {
      if (!g.has(wb, 'lifelink')) {
        if (!grant || !(await g.activate(p, he, grant))) return "Heliod's lifelink ability couldn't be paid for";
        if (!g.has(wb, 'lifelink')) return "Walking Ballista didn't get lifelink";
      }

      for (let i = 0; i < MAX_STEPS && !g.over && wb.zone === 'battlefield' && wb.counters > 0 && opps(g, p).length; i++) {
        const before = life(g), c0 = wb.counters;
        await g.ping(p, wb, [{ player: victim(g, p).idx }]);
        await g.sba();
        if (g.over || !opps(g, p).length) break;
        // (no damage, no lifelink, no counter back: the loop can't go on)
        if (life(g) === before) return 'the damage is being prevented';
        if (wb.zone === 'battlefield' && wb.counters < c0) return "Heliod's trigger didn't put the counter back";
      }
      return g.over || !opps(g, p).length ? 'every ping went through the damage system' : wb.zone !== 'battlefield' ? 'Walking Ballista left the battlefield' : 'it went as far as it could';
    });
  },

  // Triskelion pings with its counters, then at itself; undying (from Mikaeus) brings it back with a fresh one
  async triskelion(g, p) {
    let stuck = 0;
    for (let loop = 0; loop < MAX_STEPS / 4 && !g.over && opps(g, p).length; loop++) {
      const t = named(p, 'Triskelion');
      if (!t || !t.counters) return loop ? 'Triskelion stayed dead' : 'Triskelion has no counters';
      const before = life(g);
      while (t.counters > 2 && !g.over && opps(g, p).length) { await g.ping(p, t, [{ player: victim(g, p).idx }]); await g.sba(); }
      if (g.over) break;
      if (life(g) === before && ++stuck >= 2) return 'the damage is being prevented';
      for (let k = 0; k < 2 && t.zone === 'battlefield' && t.counters; k++) { await g.ping(p, t, [{ obj: t }]); await g.sba(); }
    }
    return 'it went as far as it could';
  },

  // Kiki-Jiki, Splinter Twin, Saheeli: hasty copies, each one untapping (or blinking) the copier. They fight in combat.
  async copies(g, p, combo) {
    const partnerName = combo.pieces.find(n => !/Kiki-Jiki|Splinter Twin|Saheeli Rai/.test(n));
    const partner = named(p, partnerName);
    if (!partner) return `${partnerName} isn't on the battlefield`;
    const kiki = named(p, 'Kiki-Jiki, Mirror Breaker');
    const twin = combo.pieces.includes('Splinter Twin');
    const sah = () => named(p, 'Saheeli Rai');
    // (enough to get through: the opponents' life over the copy's power, plus one for each creature that can block)
    const pow = Math.max(1, g.power(partner));
    const need = Math.min(40, opps(g, p).reduce((s, q) => s + Math.ceil(Math.max(1, q.life) / pow) + q.battlefield.filter(o => o.fx.type.creature && !o.tapped).length, 0));
    const copier = () => (kiki ? named(p, 'Kiki-Jiki, Mirror Breaker') : twin ? partner : sah());
    const isCopy = src => src && src !== partner && src.card.name === partner.card.name;
    const pick = (e, src) => (e.k === 'copyToken' ? { obj: partner } : isCopy(src) && copier() ? { obj: copier() } : undefined);
    let made = 0;
    await steer(p, pick, async () => {
      for (let i = 0; i < need && !g.over; i++) {
        const c = copier();
        if (!c) break;
        const before = p.battlefield.filter(o => o.token).length;
        if (sah()) {
          const ab = c.fx.pw?.find(a => (a.effects || []).some(e => e.k === 'copyToken'));
          // (once a turn, and only with the loyalty to pay: a blinked Saheeli is a new object with fresh loyalty)
          if (!ab || c.usedPW || c.loyalty + ab.cost < 0) break;
          await g.activatePW(p, c, ab);
        } else {
          const ab = abWith(g, c, 'copyToken');
          if (!ab || !(await g.activate(p, c, ab))) break;
        }
        await g.sba();
        if (p.battlefield.filter(o => o.token).length <= before) break;
        made++;
      }
    });
    // (the AI then attacks with everything that can: ai.js comboAlphaStrike)
    if (made) p.comboAttack = g.turn;
    return made ? `${made} hasty cop${made === 1 ? 'y' : 'ies'} of ${partnerName}; they attack in combat (blockers, Fog and protection apply)` : 'no copy was made';
  },

  // Grindstone with Painter's Servant: every pair shares the chosen color, so it keeps milling (each card through
  // Game.move: Rest in Peace exiles them, Eldrazi titans shuffle the graveyard back)
  async grindstone(g, p) {
    const gs = named(p, 'Grindstone');
    const ab = gs && abWith(g, gs, 'mill');
    if (!ab) return 'Grindstone is missing';
    const q = [...opps(g, p)].sort((a, b) => g.threatOf(p, b) - g.threatOf(p, a))[0];
    const ok = await steer(p, e => (e.k === 'mill' ? { player: q.idx } : undefined), () => g.activate(p, gs, ab));
    return ok ? `${q.name}'s library: ${q.library.length} cards left` : "Grindstone's ability couldn't be paid for";
  },

  // Mana loops: three repetitions with the real cards, each making more mana than the last; then the loop is
  // repeated as often as needed (727.1c) and the mana goes into a finisher, cast or activated for real
  async mana(g, p, combo) {
    const step = await manaStep(g, p, combo);
    if (typeof step === 'string') return step;
    const pool = [];
    for (let i = 0; i < 3 && !g.over; i++) {
      const why = await step();
      if (why) return `the loop stopped after ${i} repetition${i === 1 ? '' : 's'}: ${why}`;
      await g.sba();
      pool.push(p.pool.length);
    }
    if (!(pool[1] > pool[0] && pool[2] > pool[1])) return `the loop doesn't make more mana each time (${pool.join(', ')})`;
    p.infiniteMana = g.turn;
    g.log(`${g.pn(p)} has repeated ${esc(combo.label)} three times, making ${pool[1] - pool[0]} more mana each time, and repeats it as often as needed`, { kind: 'combo', rule: '727.1c' });
    const won = await g.manaFinish(p, combo);
    return won ? `the mana went into ${won}` : 'unbounded mana for the rest of the turn, with nothing to finish with yet';
  },
};

// One repetition of a mana loop, as the hand-played tests do it (tests/interactions.mjs); returns why it couldn't
async function manaStep(g, p, combo) {
  const has = n => combo.pieces.includes(n);
  if (has('Isochron Scepter')) {
    const sc = named(p, 'Isochron Scepter');
    const ab = sc && abWith(g, sc, 'castImprint');
    if (!ab || sc.imprinted !== 'dramatic reversal') return 'Isochron Scepter has no Dramatic Reversal on it';
    return async () => {
      for (const o of p.battlefield) if (o.fx.mana && !o.fx.type.land && !o.tapped) g.tapForMana(p, o);
      return (await g.activate(p, sc, ab)) ? null : "Isochron Scepter's ability couldn't be paid for";
    };
  }
  if (has('Pili-Pala')) {
    const pp = named(p, 'Pili-Pala'), ga = named(p, 'Grand Architect');
    if (!pp || !ga) return 'a piece is missing';
    if (!g.isA(pp, 'blue creature')) {
      const blue = abWith(g, ga, 'makeColor');
      const ok = blue && (await steer(p, e => (e.k === 'makeColor' ? { obj: pp } : undefined), () => g.activate(p, ga, blue)));
      if (!ok || !g.isA(pp, 'blue creature')) return "Grand Architect couldn't make Pili-Pala blue";
    }
    const tapBlue = ga.fx.abilities.find(a => a.costs?.tapOthers);
    return async () => {
      if (!tapBlue || !(await g.activate(p, ga, tapBlue))) return "Grand Architect couldn't tap Pili-Pala for mana";
      return (await g.activate(p, pp, pp.fx.abilities[0])) ? null : "Pili-Pala's untap ability couldn't be paid for";
    };
  }
  // (this combo's own mana piece: a deck can hold several, such as Kinnan's with a Monolith and Devoted Druid)
  const pieceName = combo.pieces.find(n => /^(Basalt Monolith|Grim Monolith|Devoted Druid)$/.test(n));
  const m = pieceName && named(p, pieceName);
  if (!m) return 'the mana piece is missing';
  return async () => {
    if (!m.tapped) g.tapForMana(p, m);
    const a = abWith(g, m, 'untapSelf');
    if (!a || m.zone !== 'battlefield') return `${m.card.name} is gone`;
    return (await g.activate(p, m, a)) ? (m.zone === 'battlefield' ? null : `${m.card.name} died`) : `${m.card.name}'s untap ability couldn't be paid for`;
  };
}

// Game.goOff at rules 11, once the pieces are cast: play the combo out and report what happened (Game.comboLog)
/** @param {import('./engine.js').Game} g */
export async function playOut(g, p, combo, st) {
  const play = comboPlay(combo);
  const fn = play.how && PLAYERS[play.how];
  if (!fn) {
    g.log(`${esc(combo.label)} can't be played out with the real cards: ${esc(play.reason)}`, { kind: 'combo', p: p.idx });
    g.comboLog.push({ p: p.idx, label: combo.label, landed: false, why: play.reason });
    return true;
  }
  const lost0 = opps(g, p).length;
  const lib0 = g.players.map(q => q.library.length), tok0 = p.battlefield.filter(o => o.token).length, inf0 = p.infiniteMana === g.turn;
  let why;
  try { why = await fn(g, p, combo, st); } catch (e) {
    if (e?.name === 'Abort' || e?.name === 'OverBudget') throw e;
    why = `it stopped on an error (${e?.message || e})`;
    g.log(`Simulator error while playing out ${esc(combo.label)}: ${esc(why)}`, { kind: 'minor' });
  }
  await g.sba();
  const won = g.over && g.winner === p;
  const killed = lost0 - opps(g, p).length;
  // (it "landed" when, on the board, it won, eliminated someone, emptied an opponent's library, made copies to attack
  // with, or made unbounded mana: read from the game, not from the combo's description)
  const emptied = opps(g, p).some(q => lib0[q.idx] > 0 && !q.library.length);
  const copies = p.battlefield.filter(o => o.token).length > tok0;
  const landed = won || killed > 0 || emptied || copies || (!inf0 && p.infiniteMana === g.turn);
  g.comboLog.push({ p: p.idx, label: combo.label, landed, why });
  if (landed) p.stats.combos++;
  g.log(`${esc(combo.label)}: ${esc(why || 'done')}`, { kind: 'combo', p: p.idx });
  g.emit('combo', { p, combo, stage: landed ? 'resolve' : 'fizzle' });
  return true;
}
