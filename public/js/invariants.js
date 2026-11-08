// Rules checks: things that must always be true between steps of a game. Card interactions that go
// wrong usually break one of these (a card in two zones, a creature that should have died, an aura
// attached to nothing). The self-test and the batch "Rules check" call this during games and report
// each kind of problem once, with the cards involved.
const ZONES = ['library', 'hand', 'battlefield', 'graveyard', 'exile', 'command'];

// afterSba: also the checks that only hold once state-based actions have been applied (704): dead
// creatures and players, the legend rule, planeswalkers with no loyalty
export function checkInvariants(g, afterSba = false) {
  const out = [];
  const bad = (kind, text) => out.push({ kind, text });
  const seen = new Map();
  for (const p of g.players) {
    for (const z of ZONES) for (const o of p[z]) {
      if (o.zone !== z) bad('zone', `${o.card.name} is in ${p.name}'s ${z} but marked as ${o.zone}`);
      if (seen.has(o.iid)) bad('twice', `${o.card.name} is in two places (${seen.get(o.iid)} and ${p.name}'s ${z})`);
      seen.set(o.iid, `${p.name}'s ${z}`);
      if (o.token && z !== 'battlefield') bad('token', `a ${o.card.name} token is in ${p.name}'s ${z}`);
      if (z !== 'battlefield' && o.owner !== p.idx) bad('owner', `${o.card.name} (${g.players[o.owner]?.name}'s) is in ${p.name}'s ${z}`);
    }
    for (const o of p.battlefield) {
      if (o.controller !== p.idx) bad('control', `${o.card.name} is on ${p.name}'s battlefield but controlled by ${g.players[o.controller]?.name}`);
      if (afterSba && o.fx.type.creature && !p.lost) {
        const t = g.toughness(o);
        if (t <= 0 && !o.animPT) bad('toughness', `${o.card.name} has toughness ${t} and is still on the battlefield`);
        else if (o.damage >= t && t > 0 && !g.has(o, 'indestructible')) bad('damage', `${o.card.name} has ${o.damage} damage on toughness ${t} and survived`);
      }
      if (o.attachedTo) {
        const host = o.attachedTo;
        if (host.zone !== 'battlefield') bad('attach', `${o.card.name} is attached to ${host.card.name}, which isn't on the battlefield`);
        else if (o.fx.type.equipment && !host.fx.type.creature) bad('attach', `${o.card.name} (equipment) is attached to ${host.card.name}, which isn't a creature`);
      }
      if (afterSba && o.fx.type.planeswalker && o.loyalty <= 0) bad('loyalty', `${o.card.name} has ${o.loyalty} loyalty and is still on the battlefield`);
      if ((o.counters | 0) !== o.counters) bad('counters', `${o.card.name} has ${o.counters} +1/+1 counters`);
    }
    if (afterSba && !p.lost && p.life <= 0 && !g.cantLose?.(p)) bad('life', `${p.name} is at ${p.life} life and hasn't lost`);
    if (afterSba && !p.lost && p.poison >= 10) bad('poison', `${p.name} has ${p.poison} poison counters and hasn't lost`);
    // (a commander exiled for a while, by Flickerwisp and friends, may stay there until it returns)
    for (const o of [...p.graveyard, ...p.exile, ...p.hand, ...p.library]) if (o.isCommander && !p.lost && !(g.delayed || []).includes(o) && !o.mayPlay && !o.cmdChoicePending && !o.cmdStay && !o.cmdLeft) bad('commander', `${p.name}'s commander ${o.card.name} is in their ${o.zone}`);
    if (!Number.isFinite(p.life)) bad('life', `${p.name}'s life is ${p.life}`);
  }
  // Layers (613): continuous effects mustn't depend on the order permanents happen to sit on the battlefield.
  // Each creature's power, toughness and keywords are worked out again with every battlefield reversed.
  if (afterSba) for (const x of layerOrderIssues(g)) bad('layers', x);
  // Legend rule: two legendary permanents with the same name under one player
  if (afterSba) for (const p of g.players) {
    const names = new Map();
    for (const o of p.battlefield) if (o.fx.type.legendary && !o.token) names.set(o.card.name, (names.get(o.card.name) || 0) + 1);
    for (const [n, k] of names) if (k > 1 && !p.battlefield.some(o => o.fx.legendOff)) bad('legend', `${p.name} controls ${k} copies of the legendary ${n}`);
  }
  return out;
}

const LAYER_KWS = ['flying', 'trample', 'haste', 'hexproof', 'indestructible', 'deathtouch', 'lifelink', 'vigilance', 'menace', 'first strike', 'double strike'];
export function layerOrderIssues(g) {
  const creatures = g.players.flatMap(p => p.battlefield.filter(o => o.fx.type.creature));
  if (!creatures.length) return [];
  const sig = o => [g.power(o), g.toughness(o), ...LAYER_KWS.map(k => (g.has(o, k) ? 1 : 0))].join(',');
  const before = creatures.map(sig);
  for (const p of g.players) p.battlefield.reverse();
  let after;
  try { after = creatures.map(sig); } finally { for (const p of g.players) p.battlefield.reverse(); }
  const out = [];
  creatures.forEach((o, i) => { if (before[i] !== after[i]) out.push(`${o.card.name} reads ${before[i]} or ${after[i]} depending on the order of the battlefield (power, toughness, ${LAYER_KWS.join('/')})`); });
  return out;
}

// Wraps a game so it's checked as it runs: the basic checks at every step, the stricter ones after
// each full state-based-actions pass. Returns a map of the problems found (each kind once per card).
export function watchGame(g) {
  const found = new Map();
  const note = after => {
    for (const x of checkInvariants(g, after)) {
      const key = `${x.kind}:${x.text.replace(/\d+/g, '#')}`;
      if (!found.has(key)) found.set(key, { ...x, turn: g.turn, phase: g.phase, recent: g.logEntries.slice(-4).map(e => e.html.replace(/<[^>]+>/g, '')) });
    }
  };
  const bad = (kind, text) => { const key = `${kind}:${text.replace(/\d+/g, '#')}`; if (!found.has(key)) found.set(key, { kind, text, turn: g.turn, phase: g.phase, recent: g.logEntries.slice(-4).map(e => e.html.replace(/<[^>]+>/g, '')) }); };
  // Timing (307.1, 305.2): spells without flash and lands only in their player's own main phase with an empty
  // stack, and no more lands than the player's land drops. (Casts with a given mode come from effects — cascade,
  // rebound, madness, a defeated Siege — which may happen at any time, so only the players' own casts are checked.)
  const instantish = (p, o) => o.fx.type.instant || o.fx.kw.has('flash') || g.has(o, 'flash') || !!o.fx.castWhen || !!p.flashNow
    || p.battlefield.some(x => x.fx.flashGrant === 'any' || (x.fx.flashGrant === 'noncreature' && !o.fx.type.creature));
  const sorceryTime = p => g.active === p.idx && (g.phase === 'main1' || g.phase === 'main2') && !g.stack.length;
  const cast = g.cast.bind(g), playLand = g.playLand.bind(g);
  g.cast = async (p, o, choice = {}) => {
    const check = !choice.mode && !choice.response && !choice.combo && !instantish(p, o) && !sorceryTime(p);
    const name = o.card.name;
    const r = await cast(p, o, choice);
    if (r && check) bad('timing', `${p.name} cast ${name} (no flash) outside their main phase or with a spell on the stack`);
    return r;
  };
  g.playLand = async (p, o) => {
    const early = !sorceryTime(p), name = o.card.name;
    const r = await playLand(p, o);
    if (r !== false && early) bad('timing', `${p.name} played ${name} (a land) outside their main phase or with a spell on the stack`);
    if (r !== false && p.landsPlayed > g.landDrops(p)) bad('land', `${p.name} played ${p.landsPlayed} lands this turn with ${g.landDrops(p)} land drops`);
    return r;
  };
  const beat = g.beat.bind(g), sba = g.sba.bind(g);
  g.beat = async w => { note(false); return beat(w); };
  g.sba = async (...a) => { const r = await sba(...a); if (!g.queue.length && !g.over) note(true); return r; };
  return found;
}
