// Scenario harness for card and interaction tests (tests/interactions.mjs): a game built straight from card names
// placed in zones (the puzzle setup), with AI seats that answer every choice, and helpers to cast, activate and
// read the board. Card data comes from the saved snapshots (tests/cards-snapshot.json, golden-cards.json and
// interaction-cards.json for cards neither has).
import { readFileSync, existsSync } from 'node:fs';
import { Game } from '../public/js/engine.js';
import { Agent } from '../public/js/ai.js';
import { normalize } from '../public/js/scryfall.js';

const load = f => { const u = new URL(f, import.meta.url); return existsSync(u) ? JSON.parse(readFileSync(u, 'utf8')) : []; };
const RAW = new Map();
for (const c of [...load('./cards-snapshot.json'), ...Object.values(load('./golden-cards.json')), ...Object.values(load('./interaction-cards.json'))]) {
  RAW.set(c.name.toLowerCase(), c);
  if (c.name.includes(' // ')) RAW.set(c.name.split(' // ')[0].toLowerCase(), c);
}
const cache = new Map();
export const hasCard = n => RAW.has(n.toLowerCase());
export function card(name) {
  const k = name.toLowerCase();
  if (!cache.has(k)) {
    const raw = RAW.get(k);
    if (!raw) throw new Error(`No card data for ${name} (add it with: node tests/fetch-interaction-cards.mjs "Card Name")`);
    cache.set(k, normalize({ ...raw, legalities: raw.legalities || {}, image_uris: raw.image_uris || {} }));
  }
  return cache.get(k);
}

// players: [{ battlefield, hand, graveyard, exile, library, life, commander }] (names, or { name, tapped, counters })
export async function scenario(players, opts = {}) {
  const nameOf = e => (typeof e === 'string' ? e : e.name);
  const seats = players.map((s, i) => {
    const names = [...(s.battlefield || []), ...(s.hand || []), ...(s.graveyard || []), ...(s.exile || []), ...(s.library || [])].map(nameOf);
    // (a few basic lands keep the library from running out when something draws)
    for (let k = 0; k < (s.filler ?? 10); k++) names.push('Wastes');
    const counts = {};
    for (const n of names) counts[n] = (counts[n] || 0) + 1;
    return {
      playerName: `P${i + 1}`, deckName: 'test', color: '#888', agent: new Agent(s.style || 'balanced'),
      commanders: s.commander ? [card(s.commander)] : [],
      cards: Object.entries(counts).map(([n, qty]) => ({ card: card(n), qty })),
    };
  });
  const g = new Game(seats, { beat: async () => {} }, { seed: opts.seed ?? 1, noLearning: true, rules: opts.rules, format: opts.format || 'commander' });
  await g.setupPuzzle({ name: 'test', players: players.map(s => ({ ...s, library: undefined, commanderOnBattlefield: !!s.commander && s.commanderOut !== false })) });
  g.phase = 'main1';
  g.turn = 1;
  return g;
}

export const P = (g, i) => g.players[i];
export const find = (g, i, name, zone = 'battlefield') => g.players[i][zone].find(o => o.card.name.toLowerCase() === name.toLowerCase() || (o.card.frontName || '').toLowerCase() === name.toLowerCase());
export const all = (g, i, name, zone = 'battlefield') => g.players[i][zone].filter(o => o.card.name.toLowerCase() === name.toLowerCase());
export const tgtObj = o => ({ obj: o });
export const tgtPlayer = i => ({ player: i });
export const logText = g => g.logEntries.map(e => e.html.replace(/<[^>]+>/g, '')).join('\n');
export const errors = g => g.logEntries.filter(e => /Simulator error/.test(e.html)).map(e => e.html);

// Resolves a spell's or ability's effects straight away (targets chosen in order), then state-based actions
// and any triggers that came up, like a resolved stack item.
export async function resolveEffects(g, i, src, effects, targets = [], extra = {}) {
  await g.runEffects(g.players[i], src, effects, { targets, strict: true, ...extra });
  await settle(g);
}
// State-based actions and every waiting trigger, until nothing more happens
export async function settle(g) {
  for (let k = 0; k < 50; k++) {
    await g.sba();
    const before = g.steps;
    await g.flushTriggers();
    if (g.steps === before) break;
  }
  await g.sba();
}

// ---------- event recorder (Phase 2O): what happened, in order, so a test checks the sequence and not only the end
// state. Events: cast, push (onto the stack, with the depth it went in at), pop (off the stack; `top` says whether it
// was the top object), move (zone changes through Game.move), enter, damage (to a player: amount, source, combat or
// not), hit (damage to a permanent), life (every life change), sba (a state-based-actions pass began).
// A spell dealing damage wrongly and a separate scripted life change "fixing" the total shows up as the wrong events.
export function record(g) {
  const ev = [];
  const nm = iid => g.objects.get(iid)?.card.name;
  g.on('move', d => ev.push({ t: 'move', name: nm(d.iid), iid: d.iid, from: d.from, to: d.to }));
  g.on('life', d => ev.push({ t: 'life', p: d.p, d: d.d }));
  g.on('cast', d => ev.push({ t: 'cast', name: d.o.card.name, p: d.p.idx }));
  g.on('enter', o => ev.push({ t: 'enter', name: o.card.name }));
  g.on('hit', d => ev.push({ t: 'hit', name: nm(d.iid), n: d.n }));
  const dp = g.damagePlayer.bind(g);
  g.damagePlayer = (q, n, src, combat) => { ev.push({ t: 'damage', to: q.idx, n, src: src?.card?.name, combat: !!combat }); return dp(q, n, src, combat); };
  const sba = g.sba.bind(g);
  g.sba = (...a) => { ev.push({ t: 'sba' }); return sba(...a); };
  const st = g.stack;
  const label = it => it?.name || it?.o?.card?.name || '?';
  st.push = (...items) => { for (const it of items) ev.push({ t: 'push', name: label(it), depth: st.length }); return Array.prototype.push.apply(st, items); };
  st.splice = (i, n, ...add) => {
    const before = st.length;
    const gone = Array.prototype.splice.call(st, i, n, ...add);
    gone.forEach((it, k) => ev.push({ t: 'pop', name: label(it), top: i + k === before - 1 }));
    return gone;
  };
  return ev;
}
// The events as short lines, for failure messages
export const evText = ev => ev.filter(e => e.t !== 'sba').map(e => (e.t === 'move' ? `move ${e.name} ${e.from}→${e.to}` : e.t === 'damage' ? `damage ${e.n} to P${e.to + 1} from ${e.src}${e.combat ? ' (combat)' : ''}` : e.t === 'life' ? `life P${e.p + 1} ${e.d > 0 ? '+' : ''}${e.d}` : e.t === 'hit' ? `hit ${e.name} ${e.n}` : e.t === 'pop' ? `pop ${e.name}${e.top ? '' : ' (not top)'}` : `${e.t} ${e.name ?? ''}`)).join('; ');
// Do events matching these tests happen in this order (others may come between)? Returns the index of the first
// test not found, or -1 when they all were.
export function inOrder(ev, ...tests) {
  let k = 0;
  for (const e of ev) if (k < tests.length && tests[k](e)) k++;
  return k === tests.length ? -1 : k;
}
