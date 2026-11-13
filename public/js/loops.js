// Loops of triggered abilities (Phase 2B, rules 10 and later). flushTriggers (triggers.js) shows every trigger to
// loopWatch before it goes on the stack. The watcher:
//   1. keeps the last WINDOW triggers as "card | event | controller" and looks for a short repeating pattern (1–6
//      triggers long). It goes by card name, not object, so a token that makes a copy of itself is seen too;
//   2. while a pattern holds, notes the numbers that matter for each player after every trigger (life, poison,
//      library, hand, graveyard, exile, mana, permanents, tokens, counters, damage: loopState) and compares the
//      change over PERIODS repetitions in a row;
//   3. classifies the loop:
//        repeating  nothing changes and the exact board comes back (the same state again and again)
//        ends       it changes the same way each time and something runs down toward a limit (a life total, a
//                   library, permanents, a hand, mana), or poison or damage builds up: it stops by itself
//        endless    it changes the same way each time, but only things that can grow for ever (tokens,
//                   counters, life gained): it never stops by itself
//        irregular  the triggers repeat but their effect doesn't: keep watching
//   4. decides:
//        ends, irregular      it keeps going, without the clock's waits (Game.loopFast)
//        repeating, endless   if a trigger in the loop says "you may", its controller decides how many more times to
//                             repeat it (AI: Agent.loopReps; people: HumanAgent.loopRepsAsync) and declining stops
//                             the loop; with only mandatory triggers the game is a draw (104.4b)
// Every loop leaves one log line and one entry in Game.loopLog (sources, triggers, repetitions, the change per
// repetition, the class, the decision and why). LOOP_BACKSTOP in triggers.js stays as the last resort for a chain
// the watcher can't classify (backstop below).
import { cleanText } from './effects.js';
import { esc } from './util.js';

export const WINDOW = 60;
export const PERIODS = 4;
// (the AI repeats an optional loop that helps it at most this many times)
export const AI_LOOP_REPS = 100;

const FEAT = ['life', 'poison', 'library', 'hand', 'graveyard', 'exile', 'mana', 'permanents', 'tokens', 'counters', 'damage', 'waiting triggers'];
const WAITING = 11;
// (what running down or building up ends: a loop changing one of these the same way each time stops by itself)
const DOWN_ENDS = new Set(['library', 'hand', 'graveyard', 'exile', 'mana', 'permanents', 'tokens', 'counters', 'waiting triggers']);
const UP_ENDS = new Set(['poison', 'damage']);

/** A trigger as the watcher sees it: its card, its event and its controller */
export const trigKey = t => `${t.o?.card?.name ?? '?'}|${t.ev ? `w:${t.ev}` : t.label || t.kind}|${t.p?.idx}`;

/** The numbers per player the watcher compares between repetitions (FEAT order) @param {import('./engine.js').Game} g */
export function loopState(g) {
  return g.players.map(q => {
    let tokens = 0, counters = 0, damage = 0;
    for (const o of q.battlefield) {
      if (o.token) tokens++;
      counters += (o.counters || 0) + (o.loyalty || 0);
      if (o.named) for (const v of Object.values(o.named)) counters += +v || 0;
      damage += o.damage || 0;
    }
    return [q.lost ? 0 : q.life, q.poison || 0, q.library.length, q.hand.length, q.graveyard.length, q.exile.length, (q.pool || []).length, q.battlefield.length, tokens, counters, damage, g.queue.filter(x => x.p === q).length];
  });
}
const minus = (a, b) => a.map((r, i) => r.map((v, j) => v - b[i][j]));
const same = (a, b) => a.every((r, i) => r.every((v, j) => v === b[i][j]));
const zero = d => d.every(r => r.every(v => v === 0));

// Does a loop that changes the board by d each time stop by itself? (the first reason it does, or null)
/** @param {import('./engine.js').Game} g */
export function endsBy(g, d) {
  for (const [i, r] of d.entries()) {
    const q = g.players[i];
    // (a player the loop has just eliminated counts too: their life ran out, so the loop ends things; it goes on to
    // the next player, if any, and is watched again from there)
    for (const [j, v] of r.entries()) {
      const f = FEAT[j];
      if (f === 'life' && v < 0 && !g.cantLose(q)) return `${q.name}'s life total runs out`;
      if (DOWN_ENDS.has(f) && v < 0) return `${q.name}'s ${f} run${/s$/.test(f) ? '' : 's'} out`;
      if (UP_ENDS.has(f) && v > 0) return f === 'poison' ? `${q.name} reaches the poison limit` : `damage builds up on ${q.name}'s creatures`;
    }
  }
  return null;
}
/** The change per repetition in words ("P1: +1 tokens, +1 permanents; P2: -1 life") */
export function describeChange(g, d) {
  const parts = d.map((r, i) => {
    const xs = r.map((v, j) => (v ? `${v > 0 ? '+' : ''}${v} ${FEAT[j]}` : '')).filter(Boolean);
    return xs.length ? `${g.players[i].name}: ${xs.join(', ')}` : '';
  }).filter(Boolean);
  return parts.join('; ') || 'nothing';
}
/** How good one repetition is for player p (its own gains minus the average opponent's), for the AI's choice */
export function loopValue(g, p, d) {
  const w = [1, -4, -0.1, 1, 0, 0, 0.5, 1, 1, 0.5, -0.5, 0];
  const score = i => d[i].reduce((s, v, j) => s + v * w[j], 0);
  const opps = g.opponents(p);
  return score(p.idx) - (opps.length ? opps.reduce((s, q) => s + score(q.idx), 0) / opps.length : 0);
}

// ---------- optional ("you may") triggers, read from the card's text (the engine resolves "may" effects as written)
// Which words of a trigger line go with a trigger kind or a watched event
const KIND_WORDS = {
  etb: /\benters?\b/, dies: /\bdies\b|\binto a graveyard\b/, attack: /\battacks?\b/, upkeep: /\bupkeep\b/, endstep: /\bend step\b/,
  cast: /\bcasts?\b/, landfall: /\blands?\b[^,]*\benters?\b/, combatDamage: /\bcombat damage\b/,
  'w:enter': /\benters?\b/, 'w:gainLife': /\bgains? life\b/, 'w:loseLife': /\blos(?:es|e) life\b/, 'w:draw': /\bdraws?\b/,
  'w:sac': /\bsacrifices?\b/, 'w:discard': /\bdiscards?\b/, 'w:tokenMade': /\bcreates? (?:a|one or more) token/, 'w:upkeep': /\bupkeep\b/,
  'w:endStep': /\bend step\b/, 'w:anyCast': /\bcasts?\b/, 'w:counterPut': /\bcounters? (?:is|are) put\b/, 'w:dies': /\bdies\b/,
  'w:damaged': /\bdealt damage\b/, 'w:targeted': /\bbecomes? the target\b/, 'w:youAttack': /\battack\b/, 'w:allyAttacks': /\battacks\b/,
};
const triggerLines = card => cleanText(card.text || '', card.frontName || card.name).split('\n').map(s => s.trim()).filter(l => /^(when|whenever|at)\b/.test(l));
const mayIn = line => { const c = line.indexOf(','); return c >= 0 && /\bmay\b/.test(line.slice(c)); };
// true: the controller may decline it; false: mandatory; null: can't tell (treated as mandatory)
export function optionalTrigger(t) {
  const card = t.o?.card;
  if (!card) return false;
  const lines = triggerLines(card);
  if (!lines.length) return false;
  const kinds = new Set(lines.map(mayIn));
  if (kinds.size === 1) return lines.length ? mayIn(lines[0]) : false;
  const key = t.ev ? `w:${t.ev}` : t.kind;
  const re = KIND_WORDS[key];
  const fits = re ? lines.filter(l => re.test(l.split(',')[0])) : [];
  const ans = new Set(fits.map(mayIn));
  return ans.size === 1 ? [...ans][0] : null;
}

// ---------- the watcher
function fresh(g) {
  return { turn: g.turn, keys: [], trigs: [], k: 0, n: 0, vecs: [], cls: null, entry: null, goEntry: null, allowUntil: 0, declined: new Set(), logged: new Set(), order: new Set() };
}
// The shortest pattern (1–6 triggers) the last WINDOW triggers repeat, or 0
function period(keys) {
  if (keys.length < WINDOW) return 0;
  for (let k = 1; k <= 6; k++) if (keys.every((x, i) => i < k || x === keys[i - k])) return k;
  return 0;
}
/** @param {import('./engine.js').Game} g */
function record(g, L, cls, d, extra) {
  const cyc = L.trigs.slice(-L.k);
  const entry = {
    turn: g.turn, cls, period: L.k, reps: Math.floor(L.n / L.k),
    sources: [...new Set(cyc.map(t => t.o?.card?.name || '?'))], triggers: cyc.map(t => trigKey(t)),
    controllers: [...new Set(cyc.map(t => t.p?.name))], change: d ? describeChange(g, d) : 'irregular', decision: '', reason: '', ...extra,
  };
  g.loopLog.push(entry);
  L.entry = entry;
  return entry;
}
const CLS_TEXT = { repeating: 'repeats the same board each time', ends: 'changes the board the same way each time and will stop by itself', endless: 'changes the board the same way each time and never stops by itself', irregular: 'repeats the same triggers with changing results' };
/** @param {import('./engine.js').Game} g */
function say(g, e) {
  g.log(`Loop: ${esc(e.sources.join(' + '))} (${e.period} trigger${e.period === 1 ? '' : 's'} a repetition, ${e.reps} repetitions so far) ${CLS_TEXT[e.cls]}; each repetition: ${esc(e.change)}. ${esc(e.decision)}${e.reason ? ` (${esc(e.reason)})` : ''}`, { kind: 'combo', rule: e.cls === 'ends' || e.cls === 'irregular' ? '727.1' : '104.4b' });
  if (typeof window !== 'undefined' && !g.sim) console.info('[loop]', e);
}
/** The chain of triggers ended or its pattern broke: the loop's entry is closed @param {import('./engine.js').Game} g */
export function loopEnded(g, why) {
  const L = g.loop10;
  if (L?.entry && !L.entry.ended) { L.entry.ended = why; L.entry.totalReps = Math.floor(L.n / Math.max(1, L.k)); }
  g.loop10 = undefined;
  g.loopFast = false;
}

// An optional trigger its controller declines (a loop they stopped): logged once, not resolved
function declined(g, L, t, key) {
  if (!L.logged.has(key)) { L.logged.add(key); g.log(`${g.pn(t.p)} declines ${g.cn(t.o)}'s optional trigger: the loop stops`, { kind: 'combo', rule: '603.5' }); }
  const e = g.loopLog[g.loopLog.length - 1];
  if (e) e.declined = (e.declined || 0) + 1;
  return 'skip';
}
/** The trigger kinds a player now puts first among their simultaneous triggers (flushTriggers, 603.3b) @param {import('./engine.js').Game} g */
export const preferredFirst = (g, t) => !!g.loop10?.order?.has(trigKey(t));

// Called for each trigger before it resolves. 'go': resolve it; 'skip': its controller declined it (an optional
// trigger of a loop they stopped); 'stop': the game ended (a draw)
/** @param {import('./engine.js').Game} g */
export async function loopWatch(g, t) {
  let L = g.loop10;
  if (!L || L.turn !== g.turn) L = g.loop10 = fresh(g);
  const key = trigKey(t);
  if (L.declined.has(key)) return declined(g, L, t, key);
  L.keys.push(key); L.trigs.push(t);
  if (L.keys.length > WINDOW) { L.keys.shift(); L.trigs.shift(); }
  const k = period(L.keys);
  if (!k) {
    // (the pattern broke: that loop is over; a trigger order chosen for it and declined triggers stay for this chain)
    if (L.entry && !L.entry.ended) { L.entry.ended = 'the pattern of triggers changed'; L.entry.totalReps = Math.floor(L.n / Math.max(1, L.k)); }
    L.entry = null; L.vecs = []; L.k = 0; L.n = 0; L.cls = null; L.allowUntil = 0;
    g.loopFast = false;
    return 'go';
  }
  if (k !== L.k) { L.k = k; L.vecs = []; L.n = WINDOW; L.cls = null; }
  L.n++;
  L.vecs.push(loopState(g));
  const need = PERIODS * k + 1;
  if (L.vecs.length > need) L.vecs.shift();
  if (L.vecs.length < need) return 'go';
  const v = L.vecs;
  const ds = Array.from({ length: PERIODS }, (_, i) => minus(v[v.length - 1 - i * k], v[v.length - 1 - (i + 1) * k]));
  const d = ds[0];
  const steady = ds.every(x => same(x, d));
  // (repeating also needs the exact board to come back: numbers alone can hide a change of which cards; until it
  // does, keep watching)
  if (steady && zero(d) && !g.loopRepeats()) return 'go';
  const cls = !steady ? 'irregular' : zero(d) ? 'repeating' : endsBy(g, d) ? 'ends' : 'endless';
  if (cls === L.cls && L.n < L.allowUntil) return 'go';
  if (cls === L.cls && (cls === 'ends' || cls === 'irregular')) return 'go';
  L.cls = cls;
  g.loopFast = true;
  if (cls === 'ends' || cls === 'irregular') {
    // (one line per chain: when the same chain is seen again later, as a drain moves from one opponent to the next,
    // the entry already logged notes it instead of a new line)
    if (L.goEntry) { (L.goEntry.seenAgain ||= []).push(`${cls} after ${Math.floor(L.n / k)} repetitions of ${k}`); L.entry = L.goEntry; return 'go'; }
    const e = record(g, L, cls, steady ? d : null, { decision: 'It keeps going.', reason: cls === 'ends' ? endsBy(g, d) : 'it may still end by itself; it is watched as it goes' });
    L.goEntry = e;
    say(g, e);
    return 'go';
  }
  // Repeating or endless. First: are a player's triggers piling up under the loop, never resolving? They triggered
  // together with the loop's own, and that player chose (or the engine chose for them) to put the loop's first. Their
  // controller orders their own simultaneous triggers (603.3b), so the loop isn't a mandatory one: the AI (or a seat
  // whose triggers are ordered automatically) puts the waiting kind first from now on; a person who orders their
  // triggers is told which order would end it, and their choices decide.
  const cyc = L.trigs.slice(-k);
  const cycKeys = new Set(cyc.map(trigKey));
  const piling = d.findIndex(r => r[WAITING] > 0);
  if (piling >= 0) {
    const q = g.players[piling];
    const starved = [...new Set(g.queue.filter(x => x.p === q && !cycKeys.has(trigKey(x))).map(trigKey))];
    if (starved.length) {
      const names = [...new Set(g.queue.filter(x => starved.includes(trigKey(x))).map(x => x.o?.card?.name || '?'))].join(', ');
      if (q.agent.orderTriggersAsync && q.agent.orderTriggersOn) {
        L.allowUntil = Infinity;
        const e = record(g, L, cls, d, { decision: `It goes on while ${q.name} orders their triggers this way.`, reason: `${q.name}'s triggers from ${names} are piling up under it; putting one of them first when the triggers are ordered lets the loop end` });
        say(g, e);
        return 'go';
      }
      for (const s of starved) L.order.add(s);
      const e = record(g, L, cls, d, { decision: `${q.name} puts the trigger of ${names} first from now on.`, reason: `those triggers were piling up under the loop; ${q.name} orders their own simultaneous triggers (603.3b), so the loop can end` });
      say(g, e);
      L.vecs = []; L.cls = null; L.entry = null;
      return 'go';
    }
  }
  // A "you may" trigger in the loop lets its controller stop it; otherwise it's a draw
  const opt = cyc.find(x => optionalTrigger(x) === true && !x.p.lost);
  const unsure = cyc.some(x => optionalTrigger(x) === null);
  if (opt) {
    const p = opt.p;
    const reps = Math.floor(L.n / k);
    const info = { cls, reps, change: describeChange(g, d), value: loopValue(g, p, d), source: opt.o.card.name, sources: [...new Set(cyc.map(x => x.o?.card?.name))] };
    const more = Math.max(0, Math.floor(+(p.agent.loopRepsAsync ? await p.agent.loopRepsAsync(g, p, info) : p.agent.loopReps ? p.agent.loopReps(g, p, info) : 0) || 0));
    const e = L.entry && L.entry.cls === cls && !L.entry.ended ? L.entry : record(g, L, cls, d, {});
    e.reps = reps;
    (e.askedAt ||= []).push(reps);
    e.optional = opt.o.card.name;
    if (more > 0) {
      L.allowUntil = L.n + more * k;
      e.decision = `${p.name} repeats it ${more} more time${more === 1 ? '' : 's'}.`;
      e.reason = `${opt.o.card.name}'s trigger is optional ("you may"), so ${p.name} chooses how many times`;
      say(g, e);
      return 'go';
    }
    L.declined.add(trigKey(opt));
    e.decision = `${p.name} stops it.`;
    e.reason = `${opt.o.card.name}'s trigger is optional ("you may"); ${p.name} declines it from now on in this chain`;
    say(g, e);
    if (trigKey(opt) === key) return declined(g, L, t, key);
    return 'go';
  }
  const e = record(g, L, cls, d, {
    decision: 'The game is a draw.',
    reason: `every trigger in it is mandatory${unsure ? ' (one could not be read as optional or mandatory and was taken as mandatory)' : ''}, the players had priority at each repetition and nobody stopped it, so it can never end (104.4b)`,
  });
  say(g, e);
  g.queue.length = 0;
  g.finish(null, 'a loop nobody could stop (a draw)');
  return 'stop';
}

// ---------- last resort: a chain the watcher couldn't classify reached LOOP_BACKSTOP triggers this turn
// A person at the table chooses to go on or end the game as a draw; in a game of AI players only, it's a draw. Either
// way the log says why. (Before rules 10 the rest of the triggers were skipped without a word.)
/** @param {import('./engine.js').Game} g @param {number} backstop */
export async function backstop(g, backstop) {
  const L = (g.loop10 ||= fresh(g));
  const recent = (L.trigs.length ? L.trigs : []).slice(-6);
  const e = { turn: g.turn, cls: 'backstop', period: L.k || 0, reps: g.trigCount.n, sources: [...new Set(recent.map(t => t.o?.card?.name || '?'))], triggers: recent.map(trigKey), controllers: [], change: 'unknown', decision: '', reason: '' };
  g.loopLog.push(e);
  const person = g.alive().find(q => q.agent.loopBackstopAsync);
  if (person) {
    const go = await person.agent.loopBackstopAsync(g, person, { n: g.trigCount.n, sources: e.sources });
    if (go) {
      g.trigCount.limit = (g.trigCount.limit || backstop) + backstop;
      e.decision = 'Play goes on.'; e.reason = `${person.name} chose to keep resolving triggers`;
      g.log(`${esc(g.trigCount.n.toLocaleString('en'))} triggers this turn (${esc(e.sources.join(', '))}): ${esc(person.name)} chose to keep going`, { kind: 'combo' });
      return 'go';
    }
    e.decision = 'The game is a draw.'; e.reason = `${person.name} ended a chain of triggers that didn't stop`;
  } else {
    e.decision = 'The game is a draw.';
    e.reason = `the safety limit of ${backstop.toLocaleString('en')} triggers in one turn was reached by a chain the loop watcher couldn't classify (no player is at the table to choose)`;
  }
  g.log(`${esc(g.trigCount.n.toLocaleString('en'))} triggers this turn (${esc(e.sources.join(', '))}) without the chain ending: ${esc(e.reason)}. The game is a draw.`, { kind: 'loss', rule: '104.4b' });
  if (typeof window !== 'undefined' && !g.sim) console.info('[loop]', e);
  g.queue.length = 0;
  g.finish(null, 'a chain of triggers that never ended (a draw)');
  return 'stop';
}
