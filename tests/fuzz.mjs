// Fuzz games (item 174): random Commander decks from the saved card snapshot, with one seat played by a "player"
// who answers every human prompt at random (any button, card or player offered), under the rules watcher
// (invariants.js). Any simulator error or broken rule fails. Seeds are fixed, so a failure can be replayed.
//   node tests/fuzz.mjs              the fixed seed list (CI)
//   node tests/fuzz.mjs --games 50 --seed 7000   more games from another seed
//   node tests/fuzz.mjs --replay tests/fuzz-failures/seed-7012.json   play a saved failure again and compare
//   node tests/fuzz.mjs --games 2 --save-all   save every game's record, failing or not (to try the replay)
// (Phase 2O) A game that crashes, logs a simulator error or breaks a rule is saved to tests/fuzz-failures/ with what
// it takes to reproduce it: the seed, the rules and app versions, the deck lists, the seats, every random answer, the
// last log lines and the problems. Every run also plays its first game a second time and checks the log is identical
// (the reproducibility a saved failure depends on).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { RULES } from '../public/js/engine.js';
import { Game, Abort } from '../public/js/engine.js';
import { Agent } from '../public/js/ai.js';
import { HumanAgent } from '../public/js/human.js';
import { normalize } from '../public/js/scryfall.js';
import { ignoredText } from '../public/js/effects.js';
import { watchGame } from '../public/js/invariants.js';
import { makeRng } from '../public/js/util.js';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? +argv[i + 1] : d; };
const GAMES = opt('games', 12), SEED = opt('seed', 61000);
const replayAt = argv.indexOf('--replay');
const VERSION = (() => { try { return readFileSync(new URL('../VERSION', import.meta.url), 'utf8').trim(); } catch { return '?'; } })();

const raw = JSON.parse(readFileSync(new URL('./cards-snapshot.json', import.meta.url), 'utf8'));
const golden = JSON.parse(readFileSync(new URL('./golden-cards.json', import.meta.url), 'utf8'));
const cards = raw.map(c => normalize({ ...c, legalities: c.legalities || {}, image_uris: {} }));
const basicsByColor = { W: 'plains', U: 'island', B: 'swamp', R: 'mountain', G: 'forest' };
const basic = n => cards.find(c => c.name.toLowerCase() === n) || normalize({ ...golden[n], legalities: {}, image_uris: {} });
const commanders = cards.filter(c => /legendary/i.test(c.typeLine) && /creature/i.test(c.typeLine) && !ignoredText(c) && (c.colorIdentity || []).length);

// A random 100-card deck: a commander, 62 spells in its colors (fully read ones mostly, a few partly read), 37 lands
function randomDeck(rng) {
  const cmd = commanders[Math.floor(rng() * commanders.length)];
  const id = new Set(cmd.colorIdentity || []);
  const pool = cards.filter(c => c.name !== cmd.name && !c.fx.type.land && (c.colorIdentity || []).every(x => id.has(x)) && !/\bbasic\b/i.test(c.typeLine));
  const picks = new Set();
  while (picks.size < 62 && picks.size < pool.length) picks.add(pool[Math.floor(rng() * pool.length)]);
  const lands = [...id].length ? [...id] : ['C'];
  const deckCards = [...picks].map(card => ({ card, qty: 1 }));
  const per = Math.floor(37 / lands.length);
  lands.forEach((x, i) => { const b = basic(basicsByColor[x] || 'wastes'); if (b) deckCards.push({ card: b, qty: i === 0 ? 37 - per * (lands.length - 1) : per }); });
  return { deckName: cmd.name, commanders: [cmd], cards: deckCards };
}

// The random player: any of the offered answers (the first button a bit more often, so games move on)
class FuzzUI {
  constructor(rng) { this.rng = rng; this.seat = null; this.view = null; this.game = null; this.waiting = false; this.asked = 0; this.answers = []; }
  get replaying() { return false; }
  key() { return null; }
  async ask(text, { buttons = [], objs = [], players = [] } = {}) {
    const a = this.pick(buttons, objs, players);
    // (what was asked and answered, in words, for a saved failure)
    this.answers.push(`T${this.game?.turn ?? '?'} ${String(text).replace(/<[^>]+>/g, '').slice(0, 80)} → ${a.button !== undefined ? `button ${a.button}` : a.obj ? `card ${a.obj.card?.name}` : `player ${a.player}`}`);
    return a;
  }
  pick(buttons, objs, players) {
    this.asked++;
    const options = [...buttons.map(b => ({ button: b.value })), ...objs.map(o => ({ obj: o })), ...players.map(p => ({ player: p }))];
    if (!options.length) return { button: 'cancel' };
    if (buttons.length && this.rng() < 0.35) return { button: (buttons.find(b => b.primary) || buttons[0]).value };
    return options[Math.floor(this.rng() * options.length)];
  }
}

const styles = ['balanced', 'aggressive', 'combo', 'defensive', 'cedh'];
// One fuzz game from a seed: the four random decks, seat 1 answered at random, the rest AI, under the rules watcher
async function playOne(i, seed) {
  const rng = makeRng(seed);
  const decks = [0, 1, 2, 3].map(() => randomDeck(rng));
  const ui = new FuzzUI(makeRng(seed ^ 0x5eed));
  let beats = 0;
  const seats = decks.map((d, k) => ({ playerName: `P${k + 1}`, deckName: d.deckName, color: '#888', agent: k === 0 ? new HumanAgent('balanced', ui) : new Agent(styles[(i + k) % 5]), commanders: d.commanders, cards: d.cards }));
  const g = new Game(seats, { beat: async () => { if (++beats > 60000) throw new Abort(); } }, { seed, noLearning: true, maxRounds: 25 });
  ui.game = g;
  const found = watchGame(g);
  const problems = [];
  let crashed = 0;
  try { await g.run(); } catch (e) { if (!(e instanceof Abort)) { crashed++; problems.push(`crashed: ${e.message}`); } }
  const errs = g.logEntries.filter(e => /Simulator error/.test(e.html));
  for (const e of errs.slice(0, 2)) problems.push(e.html.replace(/<[^>]+>/g, '').slice(0, 200));
  for (const [, v] of found) problems.push(`rule broken: ${v.text} (turn ${v.turn})`);
  const lines = g.logEntries.map(e => e.html.replace(/<[^>]+>/g, ''));
  const log = createHash('sha1').update(lines.join('\n')).digest('hex').slice(0, 16);
  return { g, ui, found, problems, errs: errs.length + crashed, log, lines, decks, seats };
}
// What a failure needs to be reproduced and understood
function saveFailure(i, seed, r) {
  const dir = new URL('./fuzz-failures/', import.meta.url);
  mkdirSync(dir, { recursive: true });
  const file = new URL(`seed-${seed}.json`, dir);
  writeFileSync(file, JSON.stringify({
    seed, index: i, rules: r.g.rules, engineRules: RULES, version: VERSION, maxRounds: 25,
    seats: r.seats.map((s, k) => ({ name: s.playerName, controller: k === 0 ? 'random answers (HumanAgent + FuzzUI)' : `AI ${styles[(i + k) % 5]}` })),
    decks: r.decks.map(d => ({ commander: d.commanders.map(c => c.name), cards: d.cards.map(c => `${c.qty} ${c.card.name}`) })),
    answers: r.ui.answers, problems: r.problems, logHash: r.log, lastLog: r.lines.slice(-40),
  }, null, 1));
  return file.pathname.replace(/^\/([A-Z]:)/, '$1');
}

if (replayAt >= 0) {
  const saved = JSON.parse(readFileSync(argv[replayAt + 1], 'utf8'));
  const r = await playOne(saved.index ?? 0, saved.seed);
  const same = r.log === saved.logHash;
  console.log(`Replayed seed ${saved.seed} (saved by ${saved.version}, rules ${saved.rules}; now ${VERSION}, rules ${RULES}): log ${same ? 'identical' : 'DIFFERENT'}, ${r.problems.length} problem(s)`);
  for (const p of r.problems) console.log(`  ${p}`);
  process.exit(r.problems.length ? 1 : 0);
}

let errors = 0, broken = 0, finished = 0, asked = 0, unattached = 0;
const problems = [];
// (item 209) targets an agent chose that the effect's words don't allow: the AI and the target lists should never offer one
const illegal = new Map();
let firstLog = '';
for (let i = 0; i < GAMES; i++) {
  const seed = SEED + i;
  const r = await playOne(i, seed);
  const { g } = r;
  if (i === 0) firstLog = r.log;
  errors += r.errs;
  broken += r.found.size;
  for (const p of r.problems) problems.push(`seed ${seed}: ${p}`);
  if (argv.includes('--save-all') && !r.problems.length) saveFailure(i, seed, r);
  if (r.problems.length) problems.push(`seed ${seed}: saved to ${saveFailure(i, seed, r)} (replay: node tests/fuzz.mjs --replay <file>)`);
  if (g.over) finished++;
  asked += r.ui.asked;
  for (const e of g.logEntries) { const t = e.html.replace(/<[^>]+>/g, ''); if (t.includes(' is not a legal target')) illegal.set(t.split(':')[0], (illegal.get(t.split(':')[0]) || 0) + 1); }
  unattached += g.logEntries.filter(e => /becomes unattached/.test(e.html)).length;
}
// Reproducibility: the first game again, with the same seed, must play exactly the same
const again = GAMES ? await playOne(0, SEED) : null;
const repro = !again || again.log === firstLog;
if (!repro) problems.push(`seed ${SEED}: played twice, the logs differ (${firstLog} / ${again?.log}): a saved failure couldn't be replayed`);
if (illegal.size) console.log(`Targets chosen that were not legal (by source): ${[...illegal].map(([k, v]) => `${k} ${v}`).join(', ')}`);
console.log(`Fuzz: ${GAMES} games from seed ${SEED}, ${finished} finished, ${asked} random answers, ${errors} simulator errors, ${broken} broken rules (equipment unattached by 704.5n: ${unattached}); first game replayed: ${repro ? 'identical' : 'DIFFERENT'}.`);
for (const p of problems.slice(0, 20)) console.log(`  ${p}`);
if (errors || broken || !repro) process.exit(1);
