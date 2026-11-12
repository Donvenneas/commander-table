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
