// Kingdoms in the rules engine: secret roles, teams, role Victory and Defeat conditions, and the
// role abilities (Announce) for AI pilots and people. The manual tabletop (manual.js) plays Kingdoms
// with no automation; this file is used when the table has AI seats (or you pick the automated table).
// Role text: kingdoms.js. What's automated and what isn't is listed in KINGDOMS_AUTO below.
import { roleById, ROLE_TYPES } from './kingdoms.js';
import { shuffle, esc } from './util.js';

export const KINGDOMS_AUTO = [
  'Automated: dealing roles, the King\'s +10 life and first turn, teams, every Victory and Defeat condition, and who eliminated whom (damage and life loss from their spells and abilities).',
  'Announce with the Announce button (your main phase; the Wizard in response to a spell). The Marksman, Priestess, Bear Trainer, Thief, Giant, Necromancer, Stalker, Wizard (exile a spell) and Zealot abilities resolve automatically.',
  'These Announce on their own when their moment comes: the Queen (saves the King from lethal damage), the Knight in Shining Armor (lethal combat damage to the King goes back to the attacker), the Rightful Heir, the Kingslayer, the Cultist (converts the player it would eliminate), the Mimic (at 20 life or less; its upkeep drain and equal-life eliminations) and the Champion (chooses the Challenger).',
  'Not automated (Announce only reveals the role): the Schemer, Sellsword and Field Marshal abilities, the Wizard\'s retarget mode and the War Bears\' +1/+1 counter. The War Bears\' {Q} damage, the Champion\'s scry and the Straw Man (forced attacks and both Victory conditions) are played.',
  '"Win the game" cards and combos do nothing in Kingdoms (a role wins only by its Victory condition).',
];

const ROLE_ABILITY = new Set(['marksman', 'priestess', 'beartrainer', 'thief', 'giant', 'necromancer', 'stalker', 'zealot', 'strawman']);
const REVEAL_ONLY = new Set(['schemer', 'sellsword', 'marshal']);

export const roleOf = p => (p?.role ? roleById(p.role.id) : null);
export const isKing = p => p?.role?.type === 'king';
export const roleName = p => (p?.role ? `${roleOf(p)?.name || ''}${p.role.id !== 'king' && p.role.type === 'king' ? ' (King)' : ''}` : '');
const alive = g => g.players.filter(p => !p.lost);

export function setupRoles(g, roles) {
  g.kingdoms = true;
  g.kd = { out: [], challenger: null, banditDown: false, kingslayerUsed: false };
  g.players.forEach((p, i) => {
    const r = roles[i] || { id: 'mimic' };
    p.role = { id: r.id, type: roleById(r.id)?.type || 'renegade', up: r.id === 'king' };
    p.defeated = false;
    if (p.role.id === 'king') p.life += 10;
  });
}

// What a player can see of another's role: face-up roles, their own, eliminated players', and Bandits see each other
export function knownType(g, me, q) {
  if (!q.role) return null;
  if (q.role.up || q === me || q.lost) return q.role.type;
  if (me?.role?.type === 'bandit' && q.role.type === 'bandit') return 'bandit';
  return null;
}
export function sees(g, viewerIdx, q) {
  if (viewerIdx == null || viewerIdx < 0) return !!(q.role?.up || q.lost);
  return knownType(g, g.players[viewerIdx], q) != null;
}

// Face-up roles of the same type are teammates; so are a face-up Knight and the King
export function teammates(p, q) {
  if (!p?.role || !q?.role || p === q || !p.role.up || !q.role.up) return false;
  const a = p.role.type, b = q.role.type;
  return a === b || (a === 'king' && b === 'knight') || (a === 'knight' && b === 'king');
}

// The chip shown on each board
export function roleChip(g, p, viewerIdx, all) {
  if (!g.kingdoms || !p.role) return '';
  const known = all || sees(g, viewerIdx, p);
  const r = roleOf(p);
  if (!known) return '<span class="polchip role-chip t-hidden" title="A face-down role">🂠 Role hidden</span>';
  const own = viewerIdx === p.idx;
  const state = p.role.up ? '' : own ? ' (face down: only you know)' : p.lost ? '' : ' (face down: Bandits know each other)';
  return `<span class="polchip role-chip t-${p.role.type}" title="${esc(`${roleName(p)} — ${ROLE_TYPES[p.role.type]}${state}\nVictory: ${r?.victory || ''}${r?.defeat ? `\nDefeat: ${r.defeat}` : ''}\n${r?.text || ''}`)}">${{ king: '👑', knight: '🛡', assassin: '🗡', bandit: '💰', renegade: '🎭' }[p.role.type]} ${esc(roleName(p))}${p.role.up ? '' : ' 🔒'}${p.defeated ? ' · defeated' : ''}</span>`;
}

function reveal(g, p, why = '') {
  if (p.role.up) return false;
  p.role.up = true;
  g.log(`📣 ${g.pn(p)} Announces: ${esc(roleName(p))} (${ROLE_TYPES[p.role.type]})${why ? ` — ${esc(why)}` : ''}`, { kind: 'combo', rule: 'Kingdoms' });
  g.emit('role', p);
  g.emit('update');
  return true;
}

// A stand-in source for damage dealt by a role ability (no keywords, colorless)
function roleSrc(p) {
  return { iid: 0, card: { name: roleName(p), art: '', colors: [], colorIdentity: [] }, fx: { kw: new Set(), kwN: {}, type: {}, subtypes: [] }, controller: p.idx, owner: p.idx, zone: 'command', counters: 0, tempKw: null };
}
const val = (g, me, o) => me.agent.value ? me.agent.value(g, o) : (o.card.cmc || 0);
const highestMv = p => Math.max(0, ...p.battlefield.map(o => o.card.cmc || 0));

// ---------- damage hooks: the Queen and the Knight in Shining Armor protect the King from lethal damage
export function damageHook(g, q, n, src, combat) {
  if (!isKing(q) || n <= 0 || n < q.life) return n;
  const sc = src?.controller;
  if (sc == null || sc === q.idx) return n;
  const shining = q.shiningTurn === g.turn ? g.players[q.shiningBy] : alive(g).find(k => k.role.id === 'shining' && !k.role.up && k.idx !== sc);
  if (combat && shining && !shining.lost) {
    if (q.shiningTurn !== g.turn) { reveal(g, shining, 'the damage to the King is dealt to the attacker instead'); q.shiningTurn = g.turn; q.shiningBy = shining.idx; }
    const back = g.players[sc];
    back.skipCombat = true;
    g.log(`🛡 ${n} damage meant for ${g.pn(q)} is dealt to ${g.pn(back)} instead; they skip their next combat`, { kind: 'damage', rule: 'Kingdoms' });
    back.life -= n; back.lastHitBy = shining.idx;
    g.emit('life', { p: back.idx, d: -n });
    return 0;
  }
  const queen = alive(g).find(k => k.role.id === 'queen' && !k.role.up && k.idx !== sc);
  if (queen) {
    reveal(g, queen, 'the lethal damage to the King is prevented');
    g.log(`👸 The damage is prevented and ${g.pn(q)} gains ${n} life`, { kind: 'damage', rule: 'Kingdoms' });
    q.life += n;
    g.emit('life', { p: q.idx, d: n });
    return 0;
  }
  return n;
}

// ---------- the Cultist: "whenever you would eliminate an opponent, Announce instead"
export function preventLoss(g, q) {
  const by = q.lastHitBy != null ? g.players[q.lastHitBy] : null;
  if (!by || by === q || by.lost || by.role?.id !== 'cultist' || q.role?.id === 'cultist') return false;
  reveal(g, by, `${q.name} would be eliminated`);
  const wasKing = isKing(q);
  q.role = { id: 'cultist', type: wasKing ? 'king' : 'renegade', up: true };
  q.cmdDamage = {}; q.poison = 0; q.life = 10; q.drewFromEmpty = false; q.lastHitBy = null;
  // (kept alive with an empty library: they shuffle their graveyard into it)
  if (!q.library.length) { for (const o of q.graveyard.splice(0)) { o.zone = 'library'; q.library.push(o); } shuffle(q.library, g.rand); }
  g.log(`🕯 ${g.pn(q)} becomes a Cultist${wasKing ? ' (still the King)' : ''}: life 10, commander damage and poison removed`, { kind: 'combo', rule: 'Kingdoms' });
  g.emit('update');
  checkVictory(g);
  return true;
}

// ---------- after a player is eliminated
export function onEliminated(g, q) {
  const k = g.kd;
  const by = q.lastHitBy != null && q.lastHitBy !== q.idx ? g.players[q.lastHitBy] : null;
  if (!q.role.up) { q.role.up = true; g.log(`${g.pn(q)}'s role is revealed: ${esc(roleName(q))} (${ROLE_TYPES[q.role.type]})`, { kind: 'loss', rule: 'Kingdoms' }); }
  k.out.push({ idx: q.idx, by: by?.idx ?? null });
  if (q.role.type === 'bandit') { k.banditDown = true; for (const b of g.players) if (b.role.type === 'bandit') b.defeated = true; }
  if (k.out.length === 1 && q.role.id === 'strawman' && by) return win(g, [q], 'the Straw Man was the first player eliminated, by another player');
  // (after Announcing, from their next upkeep: the Straw Man wins by eliminating themself)
  if (q.role.id === 'strawman' && q.role.selfWin && !by) return win(g, [q], 'the Straw Man eliminated themself');
  if (by && !by.lost) {
    if (by.role.id === 'heir') reveal(g, by, `eliminated ${q.name}`);
    // The King eliminated a Knight: discard, sacrifice half, lose half
    if (isKing(by) && q.role.type === 'knight') {
      g.log(`👑 ${g.pn(by)} eliminated a Knight: they discard their hand, sacrifice half their permanents and lose half their life`, { kind: 'removal', rule: 'Kingdoms' });
      g.discard(by, [...by.hand], null);
      const perms = [...by.battlefield].sort((a, b) => val(g, by, a) - val(g, by, b));
      for (const o of perms.slice(0, Math.ceil(perms.length / 2))) g.sacrifice(by, o);
      const loss = Math.ceil(by.life / 2); by.life -= loss; g.emit('life', { p: by.idx, d: -loss });
    }
  }
  if (isKing(q)) {
    // Knights' Defeat: the King is eliminated (the Heir only if face down; the Kingslayer only by another player)
    for (const r of g.players) {
      if (r.role.type !== 'knight') continue;
      if (r.role.id === 'heir' && r.role.up) continue;
      if (r.role.id === 'kingslayer' && by === r && !k.kingslayerUsed) continue;
      r.defeated = true;
    }
    const heir = alive(g).find(r => r.role.id === 'heir' && r.role.up);
    if (heir) {
      heir.role = { id: 'king', type: 'king', up: true }; heir.defeated = false;
      heir.life += 10; g.emit('life', { p: heir.idx, d: 10 });
      g.log(`👑 The Rightful Heir, ${g.pn(heir)}, takes the King role card and gains 10 life`, { kind: 'combo', rule: 'Kingdoms' });
    } else if (by && by.role.id === 'kingslayer' && !by.lost && !k.kingslayerUsed) {
      reveal(g, by, 'eliminated the King');
      k.kingslayerUsed = true;
      // The fallen King chooses another player (not the Kingslayer): a face-up Knight if there is one, else the healthiest
      const pool = alive(g).filter(r => r !== by);
      const pick = pool.find(r => r.role.up && r.role.type === 'knight') || pool.sort((a, b) => b.life - a.life)[0];
      if (pick) {
        pick.role = { id: 'king', type: 'king', up: true }; pick.defeated = false;
        g.log(`👑 ${g.pn(q)} hands the King role card to ${g.pn(pick)}`, { kind: 'combo', rule: 'Kingdoms' });
      }
    }
  }
  if (k.challenger === q.idx) {
    const champ = g.players.find(r => r.role.id === 'champion');
    if (champ) return win(g, [champ], 'the Challenger was eliminated');
  }
  checkVictory(g);
}

function win(g, winners, why) {
  if (g.over) return;
  const list = winners.filter(Boolean);
  g.winners = list;
  const names = list.map(p => g.pn(p)).join(', ');
  g.log(`🏆 ${names} win${list.length === 1 ? 's' : ''} (Kingdoms): ${esc(why)}`, { kind: 'win', rule: 'Kingdoms' });
  for (const p of g.players) if (!p.role.up) { p.role.up = true; }
  g.finish(list[0] || null, `${list.map(p => `${p.name} (${roleName(p)})`).join(', ')} — ${why}`, list);
}

export function checkVictory(g) {
  if (g.over) return;
  const A = alive(g);
  if (!A.length) { g.finish(null, 'everyone was eliminated'); return; }
  const hasKing = A.some(isKing);
  const W = new Set(), why = [];
  if (hasKing && A.every(p => p.role.type === 'king' || p.role.type === 'knight')) {
    for (const p of g.players) if ((p.role.type === 'king' || p.role.type === 'knight') && !p.defeated && (!p.lost || p.role.type === 'knight' || isKing(p))) W.add(p);
    why.push('all Assassins, Bandits and Renegades are eliminated');
  }
  if (!hasKing) { for (const p of g.players) if (p.role.type === 'assassin') W.add(p); why.push('the King is eliminated'); }
  if (!g.kd.banditDown && A.every(p => p.role.type === 'bandit')) { for (const p of g.players) if (p.role.type === 'bandit') W.add(p); why.push('all non-Bandits are eliminated'); }
  if (A.length === 1 && ['mimic', 'sellsword'].includes(A[0].role.id)) { W.add(A[0]); why.push('everyone else is eliminated'); }
  const cult = A.filter(p => p.role.id === 'cultist');
  if (cult.length && cult.length * 2 > A.length && A.length > 1) { cult.forEach(p => W.add(p)); why.push('more than half the players are Cultists'); }
  if (W.size) return win(g, [...W], why.join('; '));
  if (A.length === 1) { if (!A[0].defeated) win(g, [A[0]], 'last player standing'); else g.finish(null, 'the last player standing was already defeated'); }
}

// ---------- every state-based check: the Mimic and the Champion watch life totals
export function tick(g) {
  if (g.over) return;
  for (const p of alive(g)) {
    if (p.role.id === 'mimic' && !p.role.up && p.life <= 20) { reveal(g, p, 'at 20 life or less'); g.draw(p, 1); }
    if (p.role.id === 'champion' && !p.role.up && alive(g).some(q => q.life <= 25)) {
      const pool = g.opponents(p).filter(q => !isKing(q));
      const top = Math.max(...pool.map(q => q.life));
      const best = pool.filter(q => q.life === top);
      const c = best[Math.floor(g.rand() * best.length)];
      if (c) { reveal(g, p, 'a player has 25 life or less'); g.kd.challenger = c.idx; g.log(`⚔ ${g.pn(c)} is the Champion's Challenger`, { kind: 'combo', rule: 'Kingdoms' }); }
    }
  }
  // The Mimic: an opponent with the same life total is eliminated
  const mimic = alive(g).find(p => p.role.id === 'mimic' && p.role.up);
  if (mimic) for (const q of g.opponents(mimic)) if (q.life === mimic.life && !q.lost && !g.over) { q.lastHitBy = mimic.idx; g.lose(q, `the same life total as the Mimic (${q.life})`, 'Kingdoms'); }
}

// The Mimic's upkeep: one player loses 1 life, another gains 1 (aiming to match a life total)
export function upkeep(g, p) {
  // The Straw Man: their next upkeep ends the forced attacks and changes their Victory condition
  if (g.strawMan?.idx === p.idx && g.turn > g.strawMan.turn) { g.strawMan = null; p.role.selfWin = true; g.log(`${g.pn(p)}'s Victory condition becomes: eliminate themself (The Straw Man)`, { kind: 'minor', rule: 'Kingdoms' }); }
  // The Champion: scry 1 at the beginning of their upkeep (a land is kept while short of lands, a strong card always)
  if (p.role?.id === 'champion' && !p.lost && p.library.length) {
    const top = p.library[p.library.length - 1];
    const lands = p.battlefield.filter(o => o.fx.type.land).length;
    const keep = top.fx.type.land ? lands < 6 : p.agent.value(g, top) >= 2;
    if (!keep) { p.library.pop(); p.library.unshift(top); }
    g.log(`🏆 The Champion scries 1: ${keep ? 'keeps the card on top' : 'puts the card on the bottom'}`, { kind: 'minor', rule: 'Kingdoms' });
  }
  if (p.role?.id !== 'mimic' || !p.role.up || p.lost) return;
  const opps = g.opponents(p);
  if (!opps.length) return;
  let loser = opps.find(q => q.life === p.life + 1), gainer = null;
  if (!loser) { gainer = opps.find(q => q.life === p.life - 1); }
  if (!loser && !gainer) loser = opps.sort((a, b) => b.life - a.life)[0];
  if (!gainer) gainer = p;
  if (!loser) loser = opps.find(q => q !== gainer) || null;
  if (loser && loser !== gainer) { loser.life -= 1; loser.lastHitBy = p.idx; g.emit('life', { p: loser.idx, d: -1 }); }
  gainer.life += 1; g.emit('life', { p: gainer.idx, d: 1 });
  g.log(`🎭 The Mimic: ${loser ? `${g.pn(loser)} loses 1 life and ` : ''}${g.pn(gainer)} gains 1 life`, { kind: 'minor', rule: 'Kingdoms' });
}

// ---------- Announce
// Can this player Announce from their main phase right now? (role abilities with a timing of their own aren't offered)
export function canAnnounce(g, p) {
  if (!g.kingdoms || !p.role || p.role.up || p.lost) return false;
  const id = p.role.id;
  if (id === 'beartrainer') return g.opponents(p).some(q => q.life <= 30);
  if (id === 'necromancer') return alive(g).some(q => q.graveyard.some(o => o.fx.type.creature));
  return ROLE_ABILITY.has(id) || REVEAL_ONLY.has(id);
}
export const announceLabel = p => `Announce: ${roleName(p)}`;

// A plan: what the ability will do. AI pilots build it here; people choose it in announceHuman.
export function aiPlan(g, p) {
  if (!canAnnounce(g, p) || !ROLE_ABILITY.has(p.role.id)) return null;
  const enemies = g.opponents(p).filter(q => p.agent.politicalWeight(g, p, q) >= 0.5);
  const king = alive(g).find(isKing);
  const kingFoe = p.role.type === 'assassin' || p.role.type === 'bandit';
  const foesFirst = [...enemies].sort((a, b) => g.threatOf(p, b) - g.threatOf(p, a));
  const enemyCreatures = foesFirst.flatMap(q => q.battlefield.filter(o => o.fx.type.creature));
  switch (p.role.id) {
    case 'marksman': {
      const n = highestMv(p);
      if (n < 3) return null;
      const targets = [];
      if (king && kingFoe && king !== p) targets.push({ player: king.idx });
      for (const o of enemyCreatures.filter(o => g.toughness(o) - o.damage <= n && !g.has(o, 'indestructible')).sort((a, b) => val(g, p, b) - val(g, p, a))) { if (targets.length >= 3) break; targets.push({ obj: o }); }
      if (!targets.length) return null;
      const lethal = king && targets.some(t => t.player === king.idx) && king.life <= n;
      const worth = targets.filter(t => t.obj).reduce((s, t) => s + val(g, p, t.obj), 0);
      return lethal || worth >= 8 || n >= 6 ? { targets, n } : null;
    }
    case 'priestess': {
      if (g.active !== p.idx) return null;
      const t = king && kingFoe && king !== p ? king : foesFirst[0];
      if (!t) return null;
      const mine = p.life - p.poison * 4, theirs = t.life - t.poison * 4;
      return theirs - mine >= 15 || (t === king && p.life <= 8 && t.life > p.life) ? { player: t.idx } : null;
    }
    case 'beartrainer': return g.active === p.idx ? {} : null;
    // (the Straw Man wants to be the first player eliminated, by someone else: Announce once low enough to die soon)
    case 'strawman': return g.active === p.idx && p.life <= 20 && !(g.kd?.out || []).length ? {} : null;
    case 'thief': {
      if (g.active !== p.idx) return null;
      const best = enemyCreatures.filter(o => g.canTarget(p, o) || true).sort((a, b) => g.power(b) - g.power(a))[0];
      return best && g.power(best) >= 5 ? { obj: best } : null;
    }
    case 'giant': {
      if (g.active !== p.idx) return null;
      const all = alive(g).flatMap(q => q.battlefield.filter(o => o.fx.type.creature));
      if (all.length < 4) return null;
      const keep = [...all].sort((a, b) => (g.power(b) + g.toughness(b)) - (g.power(a) + g.toughness(a)))[0];
      if (keep.controller !== p.idx) return null;
      const mine = all.filter(o => o.controller === p.idx && o !== keep).reduce((s, o) => s + val(g, p, o), 0);
      const theirs = all.filter(o => o.controller !== p.idx).reduce((s, o) => s + val(g, p, o), 0);
      return theirs >= mine + 6 ? {} : null;
    }
    case 'necromancer': {
      const q = alive(g).map(r => ({ r, n: r.graveyard.filter(o => o.fx.type.creature).length })).sort((a, b) => b.n - a.n)[0];
      return q && q.n >= 3 && g.active === p.idx ? { player: q.r.idx } : null;
    }
    case 'stalker': {
      if (g.active !== p.idx) return null;
      const best = foesFirst.flatMap(q => q.battlefield.filter(o => !o.fx.type.land)).sort((a, b) => (val(g, p, b) + (p.agent.comboDanger?.(g, b) || 0)) - (val(g, p, a) + (p.agent.comboDanger?.(g, a) || 0)))[0];
      return best && val(g, p, best) + (p.agent.comboDanger?.(g, best) || 0) >= 7 ? { obj: best } : null;
    }
    case 'zealot': {
      if (g.active !== p.idx) return null;
      const n = alive(g).filter(q => q !== p && q.role.up && q.library.some(o => o.fx.type.creature)).length;
      return n >= 2 ? {} : null;
    }
    default: return null;
  }
}

export async function announce(g, p, plan = {}) {
  if (!p.role || p.role.up) return false;
  const id = p.role.id;
  reveal(g, p);
  const src = roleSrc(p);
  const S = `<b>${esc(roleName(p))}</b>`;
  switch (id) {
    case 'marksman': {
      const n = plan.n ?? highestMv(p);
      g.log(`${S}: creatures lose hexproof and shroud this turn; ${n} damage to up to three targets`, { kind: 'damage', rule: 'Kingdoms' });
      for (const t of plan.targets || []) {
        if (t.player != null && !g.players[t.player].lost) { g.damagePlayer(g.players[t.player], n, src, false); g.log(`${S} deals ${n} damage to ${g.pn(g.players[t.player])}`, { kind: 'damage' }); }
        else if (t.obj && t.obj.zone === 'battlefield') { g.damageObj(t.obj, n, src); g.log(`${S} deals ${n} damage to ${g.cn(t.obj)}`, { kind: 'damage' }); }
      }
      break;
    }
    case 'priestess': {
      const t = g.players[plan.player];
      if (!t || t.lost) break;
      [p.life, t.life] = [t.life, p.life];
      [p.poison, t.poison] = [t.poison, p.poison];
      [p.cmdDamage, t.cmdDamage] = [t.cmdDamage, p.cmdDamage];
      t.lastHitBy = p.idx;
      g.log(`${S}: ${g.pn(p)} and ${g.pn(t)} exchange life totals (${p.life} and ${t.life}), commander damage and poison`, { kind: 'damage', rule: 'Kingdoms' });
      g.emit('life', { p: t.idx, d: 0 });
      break;
    }
    case 'beartrainer':
      for (let k = 0; k < 3; k++) {
        const bear = g.createToken(p, { p: 2, t: 2, desc: 'green war bear', kw: ['haste'] }, src);
        // "{Q}: this deals damage equal to its power to target creature" (untap it as the cost; it must be tapped)
        if (bear?.fx) bear.fx = { ...bear.fx, abilities: [...(bear.fx.abilities || []), { cost: '', tap: false, effects: [{ k: 'damage', n: { dyn: 'selfPower' }, to: 'target creature' }], text: 'deals damage equal to its power to target creature', sorcery: false, costs: { mana: '', tap: false, untapSelf: true, life: 0, discard: null, sacSelf: false, sac: null, exileSelf: false, exileGy: 0, tapOthers: null, removeCounters: 0, bounce: null } }] };
      }
      g.log(`${S} creates three 2/2 War Bears with haste`, { kind: 'combo' });
      break;
    case 'thief': {
      const o = plan.obj;
      if (!o || o.zone !== 'battlefield' || o.controller === p.idx) break;
      const from = g.players[o.controller];
      from.battlefield.splice(from.battlefield.indexOf(o), 1);
      o.controller = p.idx; p.battlefield.push(o);
      Object.assign(o, { tapped: false, sick: false, attacking: null, blocking: null, blockedBy: [], tempKw: new Set([...(o.tempKw || []), 'haste']) });
      g.tempSteals.push({ o, back: from.idx });
      g.log(`${S} untaps ${g.cn(o)} and takes it until end of turn (it has haste)`, { kind: 'removal' });
      break;
    }
    case 'giant': {
      const all = alive(g).flatMap(q => q.battlefield.filter(o => o.fx.type.creature));
      const keep = [...all].sort((a, b) => (g.power(b) + g.toughness(b)) - (g.power(a) + g.toughness(a)))[0];
      g.log(`${S}: every creature but ${keep ? g.cn(keep) : 'none'} is destroyed`, { kind: 'removal', rule: 'Kingdoms' });
      for (const o of all) if (o !== keep && o.zone === 'battlefield') g.destroy(o);
      break;
    }
    case 'necromancer': {
      const t = g.players[plan.player];
      if (!t) break;
      const cards = t.graveyard.filter(o => o.fx.type.creature).sort((a, b) => (b.card.cmc || 0) - (a.card.cmc || 0));
      // (the piles are split evenly by mana value; the Necromancer takes the stronger one)
      const A = [], B = [];
      cards.forEach((o, i) => ((i % 4 === 0 || i % 4 === 3) ? A : B).push(o));
      const sum = x => x.reduce((s, o) => s + (o.card.cmc || 0), 0);
      const [take, rest] = sum(A) >= sum(B) ? [A, B] : [B, A];
      for (const o of rest) g.move(o, 'exile');
      for (const o of take) { g.move(o, 'battlefield', { under: p.idx }); g.trigger(o, 'etb'); }
      g.log(`${S}: from ${g.pn(t)}'s graveyard, ${take.map(o => g.cn(o)).join(', ') || 'nothing'} come${take.length === 1 ? 's' : ''} back under ${g.pn(p)}'s control; ${rest.length} exiled`, { kind: 'combo', rule: 'Kingdoms' });
      break;
    }
    case 'stalker':
      if (plan.obj?.zone === 'battlefield') { g.log(`${S} exiles ${g.cn(plan.obj)}`, { kind: 'removal' }); g.move(plan.obj, 'exile'); }
      break;
    case 'zealot': {
      for (const q of alive(g).filter(r => r.role.up)) {
        const i = q.library.map(o => !!o.fx.type.creature).lastIndexOf(true);
        if (i < 0) continue;
        const o = q.library[i];
        g.move(o, 'battlefield', { under: p.idx });
        Object.assign(o, { tempKw: new Set([...(o.tempKw || []), 'haste', 'vigilance', 'double strike']) });
        g.trigger(o, 'etb');
        shuffle(q.library, g.rand);
        g.log(`${S}: ${g.cn(o)} from ${g.pn(q)}'s library joins ${g.pn(p)} (haste, vigilance and double strike this turn)`, { kind: 'combo' });
      }
      break;
    }
    case 'wizard': {
      const item = plan.item;
      if (item && g.stack.includes(item) && !item.countered) { item.countered = true; item.toExile = true; g.log(`${S} exiles ${g.cn(item.o)} from the stack`, { kind: 'removal', rule: 'Kingdoms' }); }
      break;
    }
    case 'strawman':
      // Until the Straw Man's next turn every opponent's creature attacks them if able (engine.js combat reads it)
      g.strawMan = { idx: p.idx, turn: g.turn };
      g.log(`${S}: until ${g.pn(p)}'s next turn, all their opponents' creatures attack them if able`, { kind: 'combat', rule: 'Kingdoms' });
      break;
    default:
      if (REVEAL_ONLY.has(id)) g.log(`${S}: this role's ability isn't automated (see the role text)`, { kind: 'minor' });
  }
  await g.sba();
  return true;
}

// The AI's turn to Announce (start of its first main phase)
export async function aiAnnounce(g, p) {
  if (!g.kingdoms || p.agent.human || p.role?.up) return;
  const plan = aiPlan(g, p);
  if (plan) await announce(g, p, plan);
}

// The Wizard (AI): exile a dangerous enemy spell
export function aiWizard(g, q, item) {
  if (!g.kingdoms || q.agent.human || q.role?.id !== 'wizard' || q.role.up || item.ability || item.p === q) return null;
  if (q.agent.politicalWeight(g, q, item.p) < 0.5) return null;
  const danger = (q.agent.comboDanger?.(g, item.o) || 0) + (item.o.card.cmc || 0);
  return danger >= 9 || item.loopStart ? { item } : null;
}

// You Announce from the action bar: choose what the ability does
export async function announceHuman(g, p, ui) {
  const id = p.role.id;
  const r = roleOf(p);
  const cancel = { label: 'Cancel', value: 'cancel' };
  const ok = async text => (await ui.ask(text, { buttons: [{ label: 'Announce', value: 'go', primary: true }, cancel] })).button === 'go';
  let plan = {};
  if (id === 'marksman') {
    const n = highestMv(p);
    const targets = [];
    while (targets.length < 3) {
      const objs = alive(g).flatMap(q => q.battlefield.filter(o => (o.fx.type.creature || o.fx.type.planeswalker) && !targets.some(t => t.obj === o)));
      const players = alive(g).map(q => q.idx).filter(i => !targets.some(t => t.player === i));
      const a = await ui.ask(`<b>The Marksman</b>: ${n} damage to up to three targets. Click target ${targets.length + 1} (a creature, planeswalker or player's board).`, { objs, players, buttons: [{ label: targets.length ? 'Done' : 'Fire at nothing', value: 'done', primary: true }, cancel] });
      if (a.button === 'cancel') return false;
      if (a.obj) targets.push({ obj: a.obj }); else if (a.player != null) targets.push({ player: a.player }); else break;
    }
    plan = { targets, n };
  } else if (id === 'priestess' || id === 'necromancer') {
    const pool = alive(g).filter(q => q !== p && (id === 'priestess' || q.graveyard.some(o => o.fx.type.creature)));
    if (id === 'necromancer' && p.graveyard.some(o => o.fx.type.creature)) pool.push(p);
    const a = await ui.ask(`<b>${esc(r.name)}</b>: choose a player.`, { players: pool.map(q => q.idx), buttons: [...pool.map(q => ({ label: `${q.name}${id === 'priestess' ? ` (${q.life} life)` : ` (${q.graveyard.filter(o => o.fx.type.creature).length} creatures)`}`, value: q.idx })), cancel] });
    const t = a.player ?? (typeof a.button === 'number' ? a.button : null);
    if (t == null) return false;
    plan = { player: t };
  } else if (id === 'thief' || id === 'stalker') {
    const objs = alive(g).filter(q => q !== p).flatMap(q => q.battlefield.filter(o => id === 'stalker' || true));
    const a = await ui.ask(`<b>${esc(r.name)}</b>: ${id === 'thief' ? 'click a permanent to untap and take until end of turn' : 'click a permanent to exile'}.`, { objs, buttons: [cancel] });
    if (!a.obj) return false;
    plan = { obj: a.obj };
  } else if (!(await ok(`<b>${esc(r.name)}</b>: ${esc(r.text)}${REVEAL_ONLY.has(id) ? ' <i>(Not automated: Announcing reveals your role; play it out with the table.)</i>' : ''} Announce now?`))) return false;
  if ((id === 'giant' || id === 'priestess') && g.active !== p.idx) return false;
  return announce(g, p, plan);
}
