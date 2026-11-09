import { Game, Abort, RULES } from './engine.js';
import { deckHealth, healthSuggestions, HEALTH_TEMPLATE } from './dechealth.js';
import { preconList } from './precons.js';
import { sampleHands, goldfishRuns, atLeast } from './goldfish.js';
import { dekXml, arenaText, checklistText } from './deckexport.js';
import { importCollection, clearCollection, summary as collectionSummary, missingCards, hasCollection } from './collection.js';
import { newCup, pairRound, recordPod, roundDone, standings, standingsText } from './friendcup.js';
import { Agent, STYLES, guessStyle, wantsLookahead } from './ai.js';
import { loadDeck, parseText, archidektFolder, archidektDeckText } from './decks.js';
import { sf, fetchCollection } from './scryfall.js';
import { listDecks, saveDeck, deleteDeck, deckMeta, withMeta, commandersOf, versions, diffLists } from './library.js';
import { BUILT_IN, puzzleDeckText, validPuzzle, boardToPuzzle } from './puzzles.js';
import { startTour } from './tour.js';
import { buildReplayHtml } from './replayexport.js';
import { setPool, sealedPools, runDraft, buildDeck, deckText as limitedDeckText, DECK_SIZE, SUGGESTED_SETS, makePack, buildLimited, limitedText, cubePacker, cubeNames, loadRatings } from './limited.js';
import { boosterData, boosterPacker } from './boosters.js';
import { combosIn, fetchSpellbook, fetchSpellbookBracket, almostCombos } from './combos.js';
import { coverage } from './effects.js';
import { TableView, installPreview, installDetails, Sound } from './ui.js';
import { Music } from './music.js';
import { HumanAgent, HumanUI, SeatUI } from './human.js';
import { Room, RemoteUI, snapshot, TURN_CLOCKS } from './net.js';
// (a friend's time bank counts down on their board while they decide)
setInterval(() => { if (view && game && !game.over && [...remoteUIs.values()].some(u => u.waiting && u.clockMode !== 'off')) view.render(); }, 1000);
import { qrSvg } from './qr.js';
import { recordGame, learnedSummary, learnedStyle, forgetDeck, learnAs, mastery, deckKey } from './learn.js';
import { ladder, recordRanked, newSeason, rankOf, aiRating, PLACEMENT, challenges, recordChallenges, checkBadges, badges, BADGE_LIST } from './progress.js';
import { CEDH_PRESETS } from './presets.js';
import { BRACKETS, BRACKET_NOISE, estimateBracket, bracketDifferences } from './brackets.js';
// One choice for how well the AI seats play (setup screen): mistakes on purpose (noise) and look-ahead together.
// 'auto' keeps the bracket's noise and the look-ahead switch. Ladder ratings go by strength when one is chosen.
const STRENGTH = {
  // (handicap: the share of decisions a pilot makes without its best search; measured with tools/tune.mjs in 2-against-2
  // pods of fair decks, against Strong: Beginner 38%, Casual 44%, Expert 49–51%: look-ahead adds little there)
  beginner: { noise: 0.35, handicap: 1, lookahead: false, label: 'Beginner', rating: 1100 },
  casual: { noise: 0.15, handicap: 0.75, lookahead: false, label: 'Casual', rating: 1300 },
  strong: { noise: 0, lookahead: false, label: 'Strong', rating: 1550 },
  expert: { noise: 0, lookahead: true, label: 'Expert', rating: 1750 },
};
import { topCommanders, ddbDecks, edhtop16Name, offlineSince, compareWithMeta, trendHistory } from './cedhdata.js';
import { Rules } from './rules.js';
import { esc, sleep, store, symbolize, makeRng } from './util.js';
import { FORMATS, formatOf, checkDeck } from './formats.js';
import { AVATARS, BACKS, avatarById, backById, unlocked, pickerHtml } from './cosmetics.js';
import { LANGS, startI18n } from './i18n.js';
import { LESSONS, lessonsDone, markLesson, lessonPuzzle, coachHtml } from './tutorial.js';
import { CHAPTERS, storyDone, markChapter, chapterOpen, chapterPuzzle } from './story.js';
import { DIFFICULTY, NODE, runState, stats, startRun, abandonRun, yourDeck, rivalDeck, fightLife, currentChoices, rewardChoices, fightOver, takeReward, eventFor, resolveEvent, actName } from './campaign.js';
import { encodeChallenge, decodeChallenge, challengeLink } from './challenge.js';
import { openBuilder } from './builder.js';
import { Tabletop, renderTabletop } from './manual.js';
import { tableText, dealRoles } from './kingdoms.js';
import { setsState, checkSets, dailySetCheck, draftableSets } from './sets.js';
import { bulkInfo, downloadBulk, removeBulk, dailyBulk, printsInfo, downloadPrints, removePrints } from './bulk.js';
import { revealedCards, aiSideboard, swapText } from './match.js';

/** @type {(id: string) => any} */
const $ = id => document.getElementById(id);
// (nine seats: the AI formats use up to four, the manual tabletop and Kingdoms up to nine)
const SEAT_COLORS = ['#f2a93b', '#3bb6f2', '#b07cff', '#4cd18a', '#ef6b6b', '#e8d44d', '#5fd3c6', '#ff8fd8', '#9aa7ff'];
const SPEEDS = [1900, 1050, 560, 260, 70];

const humanUI = new HumanUI();
const els = {
  table: $('table'), log: $('log'), spotlight: $('spotlight'), turnLabel: $('turnLabel'), phaseTrack: $('phaseTrack'),
  zoneModal: $('zoneModal'), zoneTitle: $('zoneTitle'), zoneCards: $('zoneCards'),
};

// ---------- real-time clock: speed, pause, single-step and fast-forward (for replays and skipping)
class Clock {
  constructor() {
    this.speed = +$('speed').value; this.paused = false; this.credits = 0; this.aborted = false; this.waiters = [];
    this.skip = 0; this.untilTurn = false; this.untilEnd = false; this.fast = 0;
  }
  get ff() { return this.skip > 0 || this.untilTurn || this.untilEnd || this.untilLive; }
  async beat(w = 1) {
    if (this.aborted) throw new Abort();
    while (this.paused && this.credits <= 0 && !this.ff) {
      await new Promise(r => this.waiters.push(r));
      if (this.aborted) throw new Abort();
    }
    if (this.ff) {
      if (this.skip > 0) this.skip--;
      // Yield now and then so the page stays responsive while fast-forwarding
      if (++this.fast % 150 === 0) await sleep(0);
      if (this.aborted) throw new Abort();
      return;
    }
    const stepping = this.paused;
    if (stepping) this.credits--;
    await sleep(stepping ? 120 : SPEEDS[this.speed] * w);
    if (this.aborted) throw new Abort();
  }
  wake() { const w = this.waiters; this.waiters = []; w.forEach(f => f()); }
  setPaused(v) { this.paused = v; this.wake(); }
  step() { this.credits++; this.wake(); }
  abort() { this.aborted = true; this.wake(); }
}

// ---------- seats
const saved = store('ct.seats') || [];
// Each format keeps its own deck sources (a Standard list and a Commander list don't mix)
const savedSources = store('ct.sources') || {};
const allSeats = SEAT_COLORS.map((color, i) => ({
  color,
  name: saved[i]?.name || ['Amber', 'Azure', 'Violet', 'Jade', 'Crimson', 'Gold', 'Teal', 'Rose', 'Lilac'][i],
  source: saved[i]?.source || '',
  style: saved[i]?.style || 'auto',
  bracket: saved[i]?.bracket ?? null,
  deck: null,
}));
// The table's format (formats.js): seats in play are the first `seats` of the four
let formatKey = FORMATS[(store('ct.prefs') || {}).format] ? (store('ct.prefs') || {}).format : 'commander';
const fmt = () => formatOf(formatKey);
// How many seats the table has: the format's, or for the manual formats the number chosen (2–9, Kingdoms 5–9)
function seatCount() {
  const f = fmt();
  if (!f.manual) return f.seats;
  const n = +(store('ct.prefs') || {}).tablePlayers || f.seats;
  return Math.max(f.minSeats || 2, Math.min(f.maxSeats || 9, n));
}
let seats = allSeats.slice(0, seatCount());
// The manual tabletop (no rules engine): the tabletop format, or Kingdoms with its Table set to manual
function tableManual() { const f = fmt(); return !!f.manual && !(f.roles && (prefs.kingdomsMode || 'engine') === 'engine'); }

function setFormat(key, { quiet = false } = {}) {
  if (!FORMATS[key] || key === formatKey) { syncFormatUI(); return; }
  // Keep this format's deck sources, bring back the new format's
  savedSources[formatKey] = allSeats.map(s => s.source);
  formatKey = key;
  const back = savedSources[key] || [];
  allSeats.forEach((s, i) => { s.source = back[i] || ''; s.deck = null; });
  store('ct.sources', savedSources);
  seats = allSeats.slice(0, seatCount());
  prefs.format = key;
  store('ct.prefs', prefs);
  match = null;
  persist();
  syncFormatUI();
  renderSeats();
  if (!quiet) $('setupStatus').textContent = `${fmt().name}: ${fmt().about}.`;
}
// Show the controls that fit the format (brackets, cEDH and Commander-only modes for Commander)
function syncFormatUI() {
  const f = fmt();
  $('formatSel').value = formatKey;
  $('bestOfWrap').hidden = !f.bo3;
  // Manual tables (the tabletop and Kingdoms): how many players, and the starting life
  $('tablePlayersWrap').hidden = !f.manual;
  $('tableLifeWrap').hidden = !f.manual || !!f.roles;
  $('kingdomsModeWrap').hidden = !f.roles;
  $('kingdomsMode').value = prefs.kingdomsMode || 'engine';
  $('rankedWrap').hidden = !!f.manual;
  if (f.manual) {
    const lo = f.minSeats || 2, hi = f.maxSeats || 9;
    $('tablePlayers').innerHTML = Array.from({ length: hi - lo + 1 }, (_, k) => lo + k).map(n => `<option value="${n}" ${n === seatCount() ? 'selected' : ''}>${n}${f.roles ? ` (${tableText(n)})` : ''}</option>`).join('');
    $('tableLife').value = String(prefs.tableLife || 40);
  }
  $('bestOfSel').value = String(prefs.bestOf || 1);
  $('formatAbout').textContent = f.about;
  $('setupTitle').textContent = f.manual ? `${f.roles ? 'Kingdoms' : 'Manual tabletop'}: seat ${seatCount()} decks` : f.seats === 2 ? `Seat two ${f.name} decks` : 'Seat four decks';
  $('setupIntro').textContent = f.commander
    ? "Paste a deck link from Archidekt, Moxfield, MTGGoldfish or TappedOut. You can also paste a plain decklist, or leave a seat empty to get a random deck built from Scryfall's EDHREC rankings."
    : `Paste a deck link from Archidekt, Moxfield, MTGGoldfish or TappedOut, or a decklist (MTG Arena and MTGO exports keep their sideboard). Leave a seat empty for a random ${f.name} deck.`;
  // Brackets, cEDH data, budget random decks and puzzles are Commander's own; Draft / Sealed works from
  // any format (it switches the table to Commander or Limited)
  const edh = formatKey === 'commander';
  for (const id of ['btnCedh', 'btnMeta', 'btnBracketTable', 'btnPuzzles']) if ($(id)) $(id).hidden = !edh;
  for (const id of ['tableBracket', 'budgetMode']) if ($(id)) $(id).closest('label').hidden = !edh;
}

function renderSeats() {
  $('seats').innerHTML = seats.map((s, i) => `
    <div class="seat" style="--pc:${s.color}" data-i="${i}">
      <div class="seat-top">
        <span class="grip" draggable="true" title="Drag onto another seat to swap them">⠿</span>
        <span class="dot"></span>
        <input class="input sname" value="${esc(s.name)}" maxlength="24" aria-label="Player name">
        <select class="sstyle" aria-label="AI play style" title="${tableManual() ? 'Who plays this seat (no AI at a manual table)' : 'Who plays this seat: an AI style, you, or a friend online'}">
          ${tableManual() ? '' : `<option value="auto">Auto style</option>
          ${Object.entries(STYLES).map(([k, v]) => `<option value="${k}" ${s.style === k ? 'selected' : ''}>${v}</option>`).join('')}`}
          <option value="human" ${s.style === 'human' || (tableManual() && s.style !== 'remote') ? 'selected' : ''}>${tableManual() ? 'Played on this PC' : 'You play this seat'}</option>
          <option value="remote" ${s.style === 'remote' ? 'selected' : ''}>A friend plays this seat (online)</option>
        </select>
        ${(formatKey === 'commander') ? `<select class="sbracket" aria-label="Commander bracket" title="Commander bracket: shapes random decks and how sharply the AI plays">${bracketOptions(s.bracket)}</select>` : ''}
        <button class="btn small srandom" title="${(formatKey === 'commander') ? 'Random deck (within the bracket, if one is chosen)' : `Random ${esc(fmt().name)} deck`}">Random</button>
      </div>
      <textarea class="input ssource" spellcheck="false" placeholder="${fmt().commander ? `https://archidekt.com/decks/…   ·   https://moxfield.com/decks/…   ·   or paste a list:
1 Atraxa, Praetors' Voice *CMDR*
1 Sol Ring
…` : `https://archidekt.com/decks/…   ·   https://www.mtggoldfish.com/deck/…   ·   or paste a list:
Deck
4 Lightning Bolt
…
Sideboard
2 Pyroblast`}">${esc(s.source)}</textarea>
      <div class="seat-status">${s.deck ? deckSummary(s.deck, i) : '<span>Empty seat — a random deck will be generated.</span>'}</div>
    </div>`).join('');
  $('seats').querySelectorAll('.seat').forEach(el => {
    const s = seats[+el.dataset.i];
    // Drag a seat's grip onto another seat to swap the two (colors stay with the position)
    el.querySelector('.grip').addEventListener('dragstart', e => { e.dataTransfer.setData('text/seat', el.dataset.i); e.dataTransfer.effectAllowed = 'move'; });
    el.addEventListener('dragover', e => { if (e.dataTransfer.types.includes('text/seat')) { e.preventDefault(); el.classList.add('dragover'); } });
    el.addEventListener('dragleave', () => el.classList.remove('dragover'));
    el.addEventListener('drop', e => {
      el.classList.remove('dragover');
      const from = +e.dataTransfer.getData('text/seat'), to = +el.dataset.i;
      if (Number.isNaN(from) || from === to) return;
      e.preventDefault();
      const keys = ['name', 'source', 'style', 'deck', 'bracket'];
      const a = Object.fromEntries(keys.map(k => [k, seats[from][k]]));
      keys.forEach(k => { seats[from][k] = seats[to][k]; seats[to][k] = a[k]; });
      persist();
      renderSeats();
    });
    el.querySelector('.sname').addEventListener('input', e => { s.name = e.target.value; persist(); });
    el.querySelector('.sstyle').addEventListener('change', e => {
      // Several seats played here make a hotseat game (the device is passed between decisions)
      s.style = e.target.value;
      persist();
      const humans = seats.filter(o => o.style === 'human').length;
      $('setupStatus').textContent = humans > 1 ? `Hotseat: ${humans} people share this PC. Before each person's decision, the hands are hidden until they click "I'm ready".` : '';
    });
    el.querySelector('.ssource').addEventListener('input', e => { s.source = e.target.value; s.deck = null; persist(); });
    el.querySelector('.sbracket')?.addEventListener('change', e => { s.bracket = e.target.value ? +e.target.value : null; if (/^(random)?$/i.test(s.source.trim())) s.deck = null; persist(); renderSeats(); });
    el.querySelector('.srandom').addEventListener('click', () => { s.source = 'random'; s.deck = null; el.querySelector('.ssource').value = 'random'; persist(); });
  });
}

function deckSummary(d, i) {
  const n = d.commanders.length + d.cards.reduce((a, c) => a + c.qty, 0);
  const combos = combosIn([...d.commanders, ...d.cards.map(c => c.card)]);
  const cov = coverage(d);
  const cmdFormat = (formatKey === 'commander');
  const est = estimateBracket(d);
  const want = cmdFormat ? seats[i]?.bracket : null;
  const over = want && est.bracket > want;
  const side = (d.sideboard || []).reduce((a, c) => a + c.qty, 0);
  const m = mastery(learnAs(d));
  const lv = `<span class="mastery-chip" title="Deck mastery: ${m.games} games, ${m.wins} wins${m.next ? ` · ${m.span - m.into} points to level ${m.level + 1}` : ' · top level'}">Lv ${m.level}</span>`;
  return `<span class="thumb" style="background-image:url('${deckArt(d)}')">${lv}</span>
    <span><b>${esc(d.deckName)}</b> · ${n} cards${side ? ` + ${side} sideboard` : ''} · plays ${esc(STYLES[guessStyle(d)])} · <span class="${cov.pct < 70 ? 'warn' : ''}" title="Share of non-basic cards the simulator understands at least part of">${cov.pct}% understood</span>
    ${cmdFormat ? `· <span class="bracket-chip b${est.bracket}" title="${esc(est.reasons.join(' · ') || 'No Game Changers, two-card combos, extra turns or mass land destruction')}">Bracket ${est.bracket}: ${BRACKETS[est.bracket].name}</span>` : ''}${cmdFormat && d.sbBracket ? `
    <span class="bracket-chip sb ${d.sbBracket.about ? `b${d.sbBracket.about}` : 'b5'}" title="Commander Spellbook's estimate: ${esc(d.sbBracket.name)}${d.sbBracket.about ? `, roughly bracket ${d.sbBracket.about}` : ''} (${d.sbBracket.gameChangers} Game Changers, ${d.sbBracket.twoCard} two-card combos by its count)${esc(bracketDifferences(est, d.sbBracket).map(s => `\n• ${s}`).join(''))}">Spellbook: ${esc(d.sbBracket.name)}</span>${d.sbBracket.banned?.length ? ` <span class="warn">Banned in Commander: ${d.sbBracket.banned.map(esc).join(', ')}</span>` : ''}` : ''}
    <button class="btn small sview" data-i="${i}">View deck</button> <button class="btn small sedit" data-i="${i}">Edit</button> <button class="btn small sbuild" data-i="${i}" title="Open this deck in the full-screen deck builder">Builder</button>${over ? `<br><span class="warn">This deck plays at bracket ${est.bracket}, above the seat's bracket ${want}: ${esc(est.reasons[0] || '')}</span>` : ''}${combos.length ? `<br><span class="combos">${combos.length} combo${combos.length === 1 ? '' : 's'}: ${combos.slice(0, 5).map(c => esc(c.label)).join(', ')}${combos.length > 5 ? `, and ${combos.length - 5} more` : ''}</span>` : ''}${d.warnings.length ? `<br><span class="warn">${d.warnings.slice(0, 3).map(esc).join('<br>')}</span>` : ''}</span>`;
}

// A deck's picture: its commander, else its most-played nonland card
function deckArt(d) {
  if (d.commanders[0]) return d.commanders[0].art;
  const pick = [...d.cards].filter(c => !/\bland\b/i.test(c.card.typeLine)).sort((a, b) => b.qty - a.qty || (b.card.cmc || 0) - (a.card.cmc || 0))[0] || d.cards[0];
  return pick?.card.art || '';
}

function persist() { store('ct.seats', allSeats.map(({ name, source, style, bracket }) => ({ name, source, style, bracket }))); }
function bracketOptions(sel) {
  return '<option value="">Any bracket</option>' + Object.entries(BRACKETS).map(([n, b]) => `<option value="${n}" ${+sel === +n ? 'selected' : ''}>Bracket ${n}: ${b.name}</option>`).join('');
}

function seatStatus(i, html, cls = '') {
  const el = $('seats').querySelector(`.seat[data-i="${i}"] .seat-status`);
  if (el) { el.className = `seat-status ${cls}`; el.innerHTML = html; }
}

// Load a seat's deck, then ask Commander Spellbook for every combo in it
async function loadSeatDeck(s, status) {
  s.deck = await loadDeck(s.source, status, { bracket: s.bracket, budget: prefs.budget || 'any', format: formatKey });
  s.deck.format = formatKey;
  status('Checking Commander Spellbook for combos…');
  try { s.deck.spellbook = await fetchSpellbook(s.deck); } catch (e) {
    s.deck.warnings.push(`Couldn't reach Commander Spellbook (${e.message}), so only the built-in combo list is used.`);
  }
  // Its bracket estimate is shown next to ours (just for comparison; it doesn't change play)
  if ((formatKey === 'commander')) try { s.deck.sbBracket = await fetchSpellbookBracket(s.deck); } catch { s.deck.sbBracket = null; }
  return s.deck;
}

async function loadAll() {
  const btn = $('btnLoad');
  btn.disabled = true;
  $('setupStatus').textContent = 'Loading decks…';
  let failed = false;
  // Load sequentially so Scryfall's rate limit is respected
  for (let i = 0; i < seats.length; i++) {
    const s = seats[i];
    if (s.deck && (s.deck.format || 'commander') !== formatKey) s.deck = null;
    if (s.deck) { seatStatus(i, deckSummary(s.deck, i), 'ok'); continue; }
    try {
      await loadSeatDeck(s, msg => seatStatus(i, esc(msg)));
      seatStatus(i, deckSummary(s.deck, i), 'ok');
    } catch (e) {
      failed = true;
      seatStatus(i, esc(e.message), 'err');
    }
  }
  btn.disabled = false;
  if (failed) { $('setupStatus').textContent = 'Fix the highlighted seats and try again.'; return; }
  $('setupStatus').textContent = '';
  // A manual format plays at the tabletop (no rules engine, no AI)
  if (tableManual()) return startTabletop();
  if (fmt().roles && (seats.length < 5 || seats.length > 9)) { $('setupStatus').textContent = 'Kingdoms needs 5 to 9 players: choose the number of players above.'; return; }
  $('setup').hidden = true;
  // Best of three: a new match with these decks
  match = fmt().bo3 && +prefs.bestOf === 3 ? newMatch() : null;
  newGame();
}

// ---------- best-of-three matches
// decks: each seat's current deck and sideboard (sideboarding between games changes them);
// games: who won each game; the winner of the match is the first to two wins
let match = null;
function newMatch() {
  return { format: formatKey, decks: seats.map(s => s.deck), originals: seats.map(s => s.deck), games: [], wins: seats.map(() => 0), firstPlayer: null, swaps: seats.map(() => []) };
}
// (a drawn game counts for nobody; after three games the match ends either way)
const matchOver = m => m && (m.wins.some(w => w >= 2) || m.games.length >= 3);
function matchScore(m) { return m.wins.join('–'); }

// ---------- game lifecycle
let game = null, clock = null, view = null;
// What's needed to rebuild the current game exactly: its seed and seats, plus where each turn starts
/** @type {any} */
let setup = null;

function newGame(opts = {}) {
  lobbyOpen = false;
  // (a game started from anywhere, the start menu included, takes the screen)
  $('startMenu').hidden = true;
  clock?.abort();
  clock = new Clock();
  if (!opts.replay || !setup) {
    setup = {
      seed: opts.seed ?? takeNextSeed() ?? Math.floor(Math.random() * 2 ** 32),
      // A puzzle brings its own seats: you in seat 1, AI opponents in the rest
      puzzle: opts.puzzle || null,
      // Expedition fights bring their own seats ({ name, deck, style, bracket })
      seats: opts.customSeats ? opts.customSeats.map((s, i) => ({ name: s.name, color: allSeats[i].color, style: s.style, deck: s.deck, bracket: s.bracket ?? null }))
        : opts.puzzle ? opts.puzzleDecks.map((deck, i) => ({ name: opts.puzzle.players[i].name || `Player ${i + 1}`, color: allSeats[i].color, style: i === 0 ? 'human' : 'balanced', deck, bracket: null })) : seats.map((s, i) => {
        // In a match, the deck as sideboarded for this game
        const deck = match?.decks[i] || s.deck;
        // The seat's bracket (or the deck's estimated one) sets how sharply its AI plays; bracket 5 plays cEDH.
        // Outside Commander there are no brackets: the AI plays at full strength
        const bracket = (formatKey === 'commander') ? s.bracket || estimateBracket(deck).bracket : 4;
        // Auto: cEDH for bracket 5, else the style this deck has won most with (learn.js), else a guess from the list
        const style = s.style === 'auto' ? (bracket === 5 ? 'cedh' : learnedStyle(learnAs(deck)) || guessStyle(deck)) : s.style;
        return { name: s.name || 'Player', color: s.color, style, deck, bracket };
      }),
      // The format's rules, and (in a match) who goes first this game
      format: opts.format || (opts.puzzle ? 'commander' : formatKey),
      firstPlayer: opts.firstPlayer ?? null,
      // The engine's rules version (engine.js RULES); a loaded replay brings its own, older ones are version 4
      rules: opts.rules ?? RULES,
      // Kingdoms: the secret roles, dealt from the game's seed (so replays deal the same)
      roles: opts.roles || null,
      // Which game of a best-of-three match this is (1–3), if any
      matchGame: !opts.puzzle && !opts.customSeats && match && !opts.loadedReplay ? match.games.length + 1 : null,
      // Extra starting life per seat, a coach panel (lessons), and what happens after the game
      // (lessons, story and expedition: { html, buttons } for the results screen)
      lifeBonus: opts.lifeBonus || null, coach: opts.coach || null, after: opts.after || null,
      turnStarts: [], total: 0,
      // Your answers, in order, when a seat is yours (so the game can be rebuilt for replays and undo)
      decisions: opts.decisions || [],
      // Online friends' answers, by seat (a loaded replay plays them back with no friend connected)
      remoteDecisions: opts.remoteDecisions || {},
      // "What if" (item 132): seats you took over from a point of the game ({ seat, step }); kept in replays
      takeovers: opts.takeovers || [],
      // Deals offered from the chat ({ step, from, to, kind, rounds }), offered again at that step on every rebuild
      chatDeals: opts.chatDeals || [],
      replayOnly: !!opts.remoteDecisions && !opts.resumeOnline,
      // (a resumed online game reopens its room with the same seat keys, so friends' links still work: item 140)
      roomKeys: opts.roomKeys || null,
      // Each deck's learned card bonuses as they were when the game started (replays use the same)
      learned: opts.learned || null,
      noLearning: !!opts.noLearning,
      loadedReplay: !!opts.loadedReplay,
    };
    // Every seat played on this PC (more than one is hotseat: they pass the device between decisions)
    if (!setup.roles && formatOf(setup.format).roles) setup.roles = dealRoles(setup.seats.length, makeRng((setup.seed ^ 0x6b696e67) >>> 0));
    // AI look-ahead (lookahead.js), per seat and kept with the game, so replays play the same (older replays: off)
    const strength = !opts.loadedReplay && !opts.puzzle ? STRENGTH[prefs.aiStrength] || null : null;
    setup.strength = opts.loadedReplay ? opts.strength || null : strength ? prefs.aiStrength : null;
    // (each seat's noise is kept with the game too, so a replay plays the same however the bracket is read later)
    setup.seats.forEach((s, i) => {
      s.noise = opts.noise ? opts.noise[i] || 0 : strength ? strength.noise : BRACKET_NOISE[s.bracket] || 0;
      s.handicap = opts.handicap ? opts.handicap[i] || 0 : strength?.handicap || 0;
      s.lookahead = opts.lookahead ? !!opts.lookahead[i] : !opts.loadedReplay && !opts.puzzle && (strength ? strength.lookahead : prefs.lookahead !== false && wantsLookahead(s.style, s.noise));
    });
    setup.humans = setup.seats.map((s, i) => (s.style === 'human' ? i : -1)).filter(i => i >= 0);
    setup.human = setup.humans[0] ?? -1;
    setup.remote = setup.seats.map((s, i) => (s.style === 'remote' ? i : -1)).filter(i => i >= 0);
    // Ranked (progress.js ladder): exactly one seat played by you, no friends, not a puzzle or a loaded replay
    setup.ranked = !!prefs.ranked && !setup.roles && setup.humans.length === 1 && !setup.remote.length && !setup.puzzle && !setup.loadedReplay && !opts.customSeats;
    // (a seat keeps its rival tag only while it still holds that rival's deck)
    setup.rivalKeys = opts.puzzle || opts.customSeats ? [] : seats.map(s => (s.rivalKey && s.source === s.rivalSource ? s.rivalKey : null));
    // The stops a game started with (a loaded replay brings its own; older replays had none)
    setup.stopOpts = opts.stopOpts || (opts.loadedReplay ? { stops: {}, full: false, orderTriggers: false } : stopOpts());
  }
  const hotseat = setup.humans.length > 1;
  humanUI.seat = null;
  remoteUIs.forEach(u => u.cancel());
  humanUI.onRecord = noteAnswer;
  remoteUIs = new Map(setup.remote.map(i => {
    const u = new RemoteUI(room, i, prefs.decisionTime || 120, setup.replayOnly ? 'off' : prefs.turnClock || 'off');
    u.setRecord(setup.remoteDecisions[i] ||= [], setup.replayOnly);
    u.onRecord = noteAnswer;
    return [i, u];
  }));
  const gameSeats = setup.seats.map((s, i) => ({
    playerName: s.name, deckName: s.deck.deckName, color: s.color, commanders: s.deck.commanders, learnAs: learnAs(s.deck), cards: s.deck.cards, companion: s.deck.companion || null,
    agent: setup.humans.includes(i) ? withCoach(new HumanAgent(guessStyle(s.deck), hotseat ? new SeatUI(humanUI, i, setup.seats.map(x => x.name)) : humanUI, setup.stopOpts))
      : remoteUIs.has(i) ? new HumanAgent(guessStyle(s.deck), remoteUIs.get(i), { orderTriggers: setup.stopOpts.orderTriggers })
      : Object.assign(new Agent(s.style, { noise: s.noise ?? (BRACKET_NOISE[s.bracket] || 0), lookahead: s.lookahead }), s.handicap ? { handicap: s.handicap } : {}),
  }));
  game = new Game(gameSeats, clock, { seed: setup.seed, learned: setup.learned, noLearning: setup.noLearning || !!setup.puzzle, puzzle: setup.puzzle, format: setup.format, firstPlayer: setup.firstPlayer, lifeBonus: setup.lifeBonus, roles: setup.roles, rules: setup.rules });
  setup.learned ||= game.players.map(p => p.learned);
  if (STRENGTH[setup.strength]) game.log(`AI strength: ${STRENGTH[setup.strength].label}${STRENGTH[setup.strength].lookahead ? ' (looks ahead)' : ''}`, { kind: 'minor' });
  // The coach panel (lessons) shows beside the table while the game runs
  $('coach').innerHTML = setup.coach || '';
  $('coach').hidden = !setup.coach;
  game.chat = chatLog;
  game.players.forEach((p, i) => { p.art = deckArt(setup.seats[i].deck); if (setup.humans.includes(i) && avatarUrl()) p.avatar = avatarUrl(); });
  view = new TableView(game, els);
  game.on('turn', () => autosave());
  fillLogSeats();
  // Ranked: no peeking at hands, no AI explanations (they reveal hands), no undo
  const locked = setup.ranked && !setup.progressed;
  for (const id of ['revealHands', 'explainMode']) { if (locked) $(id).checked = false; $(id).disabled = !!locked; }
  view.revealHands = $('revealHands').checked;
  game.explain = $('explainMode').checked;
  view.humanIdx = setup.human;
  humanUI.attach(game, view, setup.decisions);
  remoteUIs.forEach(u => u.attach(game));
  if (opts.untilLive) clock.untilLive = true;
  $('tlUndo').hidden = !(setup.human >= 0) || !!locked;
  if (opts.skip) clock.skip = opts.skip;
  // (a seat taken over becomes yours at the step it was taken over, in this game and every rebuild of it)
  if (setup.chatDeals?.length) {
    const g = game, beat0 = g.beat.bind(g), done = new Set();
    g.beat = async w => {
      for (const d of setup.chatDeals) if (!done.has(d) && g.steps >= d.step) {
        done.add(d);
        g.pendingDeals.push({ from: d.from, to: d.to, kind: d.kind, rounds: d.rounds });
        g.log(`${g.pn(g.players[d.from])} will offer ${g.pn(g.players[d.to])} a ${d.rounds === 0 ? 'rest-of-round' : `${d.rounds}-round`} deal at the start of the next turn`, { kind: 'politics', p: d.from });
      }
      return beat0(w);
    };
  }
  if (setup.takeovers?.length) {
    const g = game, beat0 = g.beat.bind(g), done = new Set();
    g.beat = async w => {
      for (const t of setup.takeovers) if (!done.has(t) && g.steps >= t.step) {
        done.add(t);
        const s = setup.seats[t.seat];
        g.players[t.seat].agent = new HumanAgent(guessStyle(s.deck), humanUI, setup.stopOpts);
        g.players[t.seat].style = 'human';
        if (!setup.humans.includes(t.seat)) setup.humans.push(t.seat);
        setup.human = t.seat;
        if (view) view.humanIdx = t.seat;
        g.log(`You take over ${g.pn(g.players[t.seat])} from here`, { kind: 'minor' });
      }
      return beat0(w);
    };
  }
  if (opts.paused) clock.paused = true;
  game.on('turn', p => {
    // Turn clock: a friend's bank fills up at the start of each of their turns
    remoteUIs.get(p?.idx)?.refill();
    if (!setup.turnStarts.includes(game.steps)) setup.turnStarts.push(game.steps);
    setup.turnStarts.sort((a, b) => a - b);
    if (clock.untilTurn) { clock.untilTurn = false; clock.setPaused(true); syncPlay(); }
  });
  game.on('over', () => {
    setup.total = game.steps;
    // Each game teaches the decks once (not again when it's replayed or rewound)
    if (!setup.recorded && !setup.loadedReplay) { setup.recorded = true; recordGame(game); addHistory(game); }
    // A match game counts once (rewinding and replaying it doesn't add another result)
    if (setup.matchGame && match && match.games.length === setup.matchGame - 1) {
      const w = game.winner ? game.winner.idx : null;
      match.games.push({ winner: w, seed: setup.seed, firstPlayer: setup.firstPlayer, revealed: game.players.map((p, i) => revealedCards(game, i).cards) });
      if (w != null) match.wins[w]++;
    }
    // Your progress (ladder, challenges, badges, rival records): once per game, when you played a seat
    if (!setup.progressed && !setup.loadedReplay && !setup.puzzle && setup.humans.length === 1 && !setup.remote.length) {
      setup.progressed = true;
      setup.progressNote = recordProgress(game);
    }
    clock.untilEnd = false;
    setTimeout(showResults, clock.ff ? 0 : 1200);
  });
  $('btnPlay').disabled = false;
  $('btnStep').disabled = false;
  syncPlay();
  $('timeline').hidden = false;
  $('tlInvite').textContent = setup.remote.length && !setup.replayOnly ? 'Invite' : 'Spectators';
  const live = setup.remote.length && !setup.replayOnly;
  // Keep friends' and spectators' view of the table up to date while a room is open
  const g = game;
  let timer = null;
  const push = () => { timer = null; if (game === g && room.code) for (const i of room.seats) if (i !== -2) room.state(i, snapshot(g, i)); };
  g.on('update', () => { if (room.code && !timer) timer = setTimeout(push, clock.ff ? 1500 : 350); });
  pushView = push;
  if (!live) {
    // No friends' seats: keep a spectators-only room open, otherwise close it
    if (room.code && room.seats.filter(s => s >= 0).length) room.close();
    if (room.code) push();
    game.run();
    return;
  }
  // Friends' seats: open the room (once), then start
  openRoom().then(ok => {
    if (game !== g) return;
    if (!ok) { $('tlLabel').textContent = `Online seats need Commander Table.exe (${room.error})`; return; }
    push();
    g.run();
  });
}

// ---------- online seats: friends on your network join from their own browser
// Seat -1 is the spectators' view: every room has one, and a room can be opened just for spectators
const room = new Room();
let remoteUIs = new Map();
let pushView = () => {};
// Streamer view (item 142): every 2 seconds the whole table, every hand included, is kept for the delay and only then
// sent to the streamer link, so it can be shown on a stream without giving the hands away to the players
let streamQ = [];
setInterval(() => {
  if (!room.code || !room.seats.includes(-2) || !game) { streamQ = []; return; }
  const now = Date.now(), delay = (prefs.streamDelay || 60) * 1000;
  streamQ.push({ t: now, g: game, s: JSON.stringify(snapshot(game, -2)) });
  let send = null;
  while (streamQ.length && streamQ[0].t <= now - delay) send = streamQ.shift();
  // (a new game starts the delay again)
  streamQ = streamQ.filter(x => x.g === game);
  if (send && send.g === game) room.state(-2, send.s);
}, 2000);
async function openRoom(seatList = [...setup.remote, -1, -2]) {
  const want = seatList.join(',');
  if (room.code && room.seats.join(',') === want) return true;
  const ok = await room.open(seatList, setup?.roomKeys);
  if (ok) showInvite();
  return ok;
}
function showInvite() {
  const link = (u, label) => `<div class="invite-link"><span class="invite-kind">${label}</span><input class="input" readonly value="${esc(u)}"><button class="btn small" data-copy="${esc(u)}">Copy</button></div>`;
  $('inviteBody').innerHTML = `
    <div class="internet-box">
      ${room.tunnelUrl
        ? `<b>Internet play is on.</b> <span class="muted">Friends anywhere can use the internet links below. The address changes each time Commander Table starts.</span>`
        : `<button class="btn primary" id="btnInternet">Play over the internet</button>
           <span class="muted" id="internetStatus">Home-network links work on the same Wi-Fi. For friends anywhere, this starts a free Cloudflare tunnel (no account needed). The first time, Commander Table downloads Cloudflare's official tunnel tool (about 60 MB).</span>`}
    </div>
    <div class="conn-check"><button class="btn small" id="btnConnCheck">Check the connection</button> <span id="connCheck" class="muted">Tests each friend address from this PC, and the internet link through Cloudflare.</span></div>
    <label class="decision-time">Time for each decision
      <select id="decisionTime" class="input">${[30, 60, 120, 300, 600].map(s => `<option value="${s}" ${(prefs.decisionTime || 120) === s ? 'selected' : ''}>${s < 120 ? `${s} seconds` : `${s / 60} minutes`}</option>`).join('')}</select>
      <span class="muted">After this, the AI decides for them.</span></label>
    <label class="decision-time">Turn clock
      <select id="turnClock" class="input">${Object.entries(TURN_CLOCKS).map(([k, c]) => `<option value="${k}" ${(prefs.turnClock || 'off') === k ? 'selected' : ''}>${esc(c.label)}</option>`).join('')}</select>
      <span class="muted">A time bank per friend instead of a time per decision; it runs down while they decide. When it's empty the AI plays for them until their next turn. You can nudge a friend who's thinking. Applies from the next game.</span></label>` + room.links().map(({ seat, urls, internet }) => seat === -2 ? `
    <div class="invite spectators">
      <div class="invite-head"><span class="dot"></span><b>Streamer view</b> <span class="muted">Every hand, shown late so players watching the stream learn nothing. A clean layout for screen capture. Keep this link to yourself.</span></div>
      <label class="decision-time">Delay <select id="streamDelay" class="input">${[30, 60, 120, 180].map(s => `<option value="${s}" ${(prefs.streamDelay || 60) === s ? 'selected' : ''}>${s < 60 ? `${s} seconds` : `${s / 60} minute${s > 60 ? 's' : ''}`}</option>`).join('')}</select></label>
      ${urls.slice(0, 1).map(u => link(u, 'This network')).join('')}
    </div>` : seat < 0 ? `
    <div class="invite spectators">
      <div class="invite-head"><span class="dot"></span><b>Spectators</b> <span class="muted">Anyone with this link can watch. They see the table and every player's card counts, but no hands.</span></div>
      <div class="invite-quick">
        <div class="invite-qr" title="Scan with a phone camera">${qrSvg(internet || urls[0] || '', 2)}</div>
        <div><div class="muted">Watch code</div><div class="join-code">${room.joinCode(-1)}</div></div>
      </div>
      ${internet ? link(internet, 'Internet') : ''}
      ${urls.map(u => link(u, 'Home network')).join('')}
    </div>` : `
    <div class="invite" style="--pc:${(lobbyOpen || tabletopInvite ? seats : setup.seats)[seat].color}">
      <div class="invite-head"><span class="dot"></span><b>${esc((lobbyOpen || tabletopInvite ? seats : setup.seats)[seat].name)}</b> <span class="muted">${esc(lobbyOpen ? (seats[seat].lobbyChoice || 'choosing a deck…') : tabletopInvite ? seats[seat].deck?.deckName || '' : setup.seats[seat].deck.deckName)}</span>
        <span class="invite-status" data-seat="${seat}">Waiting for them to join…</span></div>
      <div class="invite-quick">
        <div class="invite-qr" title="Scan with a phone camera">${qrSvg(internet || urls[0] || '', 3)}</div>
        <div><div class="muted">Join code</div><div class="join-code">${room.joinCode(seat)}</div>
          <div class="muted small">Friends can open <b>${esc((internet || urls[0] || '').replace(/\/play\.html.*/, ''))}</b> and type this code, or scan the QR code.</div></div>
      </div>
      ${internet ? link(internet, 'Internet') : ''}
      ${urls.map(u => link(u, 'Home network')).join('') || (internet ? '' : '<p class="warn">No network address found. Is this PC connected to a network?</p>')}
      ${lobbyOpen ? '' : `<button class="btn small ghost" data-rekey="${seat}" title="Give this seat to someone else: a new link and code; the old ones stop working">New link for someone else</button>`}
    </div>`).join('');
  $('btnConnCheck')?.addEventListener('click', connectionCheck);
  $('streamDelay')?.addEventListener('change', e => { prefs.streamDelay = +(/** @type {HTMLSelectElement} */ (e.target).value) || 60; store('ct.prefs', prefs); streamQ = []; });
  $('btnInternet')?.addEventListener('click', async e => {
    e.target.disabled = true;
    const say = t => { $('internetStatus').textContent = t; };
    try {
      await room.tunnel(st => say({ downloading: 'Downloading Cloudflare\'s tunnel tool (one time only)…', starting: 'Starting the tunnel…' }[st] || 'Working…'));
      showInvite();
    } catch (err) {
      e.target.disabled = false;
      say(`Couldn't start internet play: ${err.message}`);
    }
  });
  $('inviteModal').hidden = false;
}
// Connection check (item 144): can the friends' addresses be reached, and what to fix when they can't. A check from
// this PC can't see the router or another device's firewall, so the advice says what to try for each case.
async function connectionCheck() {
  const out = $('connCheck');
  out.innerHTML = 'Checking…';
  const reach = async (url, ms = 6000) => {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), ms);
    try { await fetch(url, { mode: 'no-cors', cache: 'no-store', signal: ctl.signal }); return true; } catch { return false; } finally { clearTimeout(t); }
  };
  const rows = [];
  const add = (ok, what, fix = '') => rows.push(`<div class="cc-row ${ok ? 'ok' : 'bad'}">${ok ? '✔' : '✘'} ${what}${!ok && fix ? `<div class="muted small">${fix}</div>` : ''}</div>`);
  add(await reach('/api/room/status'), 'Commander Table is running on this PC', 'Start Commander Table again.');
  if (!room.code) add(false, 'No room is open', 'Seat a friend (A friend plays this seat) or press Spectators first.');
  else {
    if (!room.ips.length) add(false, 'No home-network address', 'This PC isn\'t on a network: connect to Wi-Fi or a cable.');
    for (const ip of room.ips) add(await reach(`http://${ip}:${room.port}/play.html`), `Friends' port answers at ${ip}:${room.port}`, 'Something on this PC blocks it: allow Commander Table (or Python / PowerShell) through Windows Firewall for private networks.');
    if (room.ips.length) rows.push('<div class="muted small">If friends on the same Wi-Fi still can\'t open the link: check the network is set to Private in Windows, that their device isn\'t on a guest network (guest Wi-Fi keeps devices apart), and try the link on your own phone.</div>');
    if (room.tunnelUrl) add(await reach(`${room.tunnelUrl}/play.html`, 12000), 'The internet link works through Cloudflare', 'The tunnel is down: close this window and press Play over the internet again (the address changes). A school or work network may block it.');
    else rows.push('<div class="muted small">Internet play is off. For friends elsewhere, press Play over the internet: no router setup needed.</div>');
    const seenRows = room.seats.filter(s => s >= 0).map(s => { const n = room.seen(s); return `${esc((setup?.seats || seats)[s]?.name || `Seat ${s + 1}`)}: ${n < 0 ? 'hasn\'t joined' : n > 12 ? `last seen ${n} s ago` : 'connected'}`; });
    if (seenRows.length) rows.push(`<div class="muted small">${seenRows.join(' · ')}</div>`);
  }
  out.innerHTML = rows.join('');
}
$('inviteBody').addEventListener('click', async e => {
  // Hand a seat to someone else (item 141): new key; the game goes on, the AI plays the seat until they join
  const rk = e.target.closest('[data-rekey]');
  if (rk) {
    const s = +rk.dataset.rekey;
    if (!confirm('Give this seat a new link? The old link and code stop working, and whoever opens the new one plays this seat.')) return;
    try {
      await room.rekey(s);
      const name = (tabletopInvite ? seats : setup?.seats)?.[s]?.name || `Seat ${s + 1}`;
      game?.log(`${name}'s seat has a new link; the AI plays it until someone joins`, { kind: 'minor' });
      autosave();
      showInvite();
    } catch (err) { alert(`Couldn't change the link: ${err.message}`); }
    return;
  }
  const b = e.target.closest('[data-copy]');
  if (!b) return;
  navigator.clipboard?.writeText(b.dataset.copy).then(() => { b.textContent = 'Copied'; setTimeout(() => { b.textContent = 'Copy'; }, 1500); }).catch(() => b.previousElementSibling.select());
});
$('inviteBody').addEventListener('change', e => {
  if (e.target.id === 'turnClock') { prefs.turnClock = e.target.value; store('ct.prefs', prefs); return; }
  if (e.target.id !== 'decisionTime') return;
  prefs.decisionTime = +e.target.value;
  store('ct.prefs', prefs);
  remoteUIs.forEach(u => { u.timeout = prefs.decisionTime; });
});
$('btnInviteClose').addEventListener('click', () => { $('inviteModal').hidden = true; });
$('tlInvite').addEventListener('click', async () => {
  if (room.code) return showInvite();
  if (!game) return;
  // A game without friends' seats: open a room just for spectators
  if (await openRoom([-1, -2])) pushView();
  else $('tlLabel').textContent = `Spectator links need Commander Table.exe (${room.error})`;
});
// ---------- chat and emotes between everyone at an online table (friends, spectators and you)
const chatLog = [];
function say(seat, name, text) {
  const id = (chatLog[chatLog.length - 1]?.id || 0) + 1;
  chatLog.push({ id, seat, name, text });
  if (chatLog.length > 30) chatLog.shift();
  if (game) {
    game.chat = chatLog;
    game.log(`💬 <b>${esc(name)}</b>: ${esc(text)}`, { kind: 'chat', p: seat >= 0 ? seat : null });
    game.emit('update');
  }
  if (seat >= 0) showBubble(document.querySelector(`#table .board[data-player="${seat}"]`), text);
}
function showBubble(board, text) {
  if (!board) return;
  const r = board.getBoundingClientRect();
  const b = document.createElement('div');
  b.className = 'say-bubble';
  b.textContent = text;
  Object.assign(b.style, { left: `${r.left + r.width / 2}px`, top: `${r.top + 8}px` });
  document.body.append(b);
  setTimeout(() => b.remove(), 3700);
}
function hostSay(text) {
  text = text.trim().slice(0, 200);
  if (!text) return;
  const me = setup?.human >= 0 ? setup.human : -1;
  say(me, me >= 0 ? setup.seats[me].name : 'Host', text);
}
$('chatInput').addEventListener('keydown', e => { if (e.key === 'Enter') { hostSay(e.target.value); e.target.value = ''; } });
// Table talk: offer a deal from the chat. It's put to the other player at the start of the next turn.
const DEAL_KINDS = ['truce', 'gangUp', 'noCounter', 'tribute'];
function queueDeal(from, to, kind, rounds = 2) {
  if (!game || !DEAL_KINDS.includes(kind) || from === to || !game.players[from] || !game.players[to]) return;
  rounds = Math.max(0, Math.min(5, Number.isFinite(+rounds) ? +rounds : 2));
  game.pendingDeals.push({ from, to, kind, rounds });
  // (kept with the game at the step it was offered, so replays and rebuilds offer it again at the same moment: item 139)
  if (!game.replayingDeals) (setup.chatDeals ||= []).push({ step: game.steps, from, to, kind, rounds });
  game.log(`${game.pn(game.players[from])} will offer ${game.pn(game.players[to])} a ${rounds === 0 ? 'rest-of-round' : `${rounds}-round`} deal at the start of the next turn`, { kind: 'politics', p: from });
}
$('btnDealOpen').addEventListener('click', () => {
  const me = setup?.human ?? -1;
  if (!game || me < 0) { hostSay('(Deals need a seat you play)'); return; }
  $('dealTo').innerHTML = game.players.filter(p => p.idx !== me && !p.lost).map(p => `<option value="${p.idx}">${esc(p.name)}</option>`).join('');
  $('dealForm').hidden = !$('dealForm').hidden;
});
$('btnDealSend').addEventListener('click', () => {
  queueDeal(setup.human, +$('dealTo').value, $('dealKind').value, +$('dealRounds').value);
  $('dealForm').hidden = true;
});
$('chatBox').addEventListener('click', e => { const b = e.target.closest('[data-say]'); if (b) hostSay(b.dataset.say); });

// ---------- lobby: friends join before the game starts and send their own decks
let lobbyOpen = false;
async function lobbyState() {
  const library = await listDecks().then(l => l.map(d => d.name)).catch(() => []);
  for (const i of room.seats) if (i >= 0) room.state(i, { lobby: true, seat: i, name: seats[i].name, color: seats[i].color, library, chosen: seats[i].lobbyChoice || null, host: setup?.seats?.find(s => s.style === 'human')?.name || '' });
}
$('btnLobby').addEventListener('click', async () => {
  const friends = seats.map((s, i) => (s.style === 'remote' ? i : -1)).filter(i => i >= 0);
  if (!friends.length) { $('setupStatus').textContent = 'Set at least one seat to "A friend plays this seat (online)" first.'; return; }
  lobbyOpen = true;
  if (!(await openRoom([...friends, -1]))) { lobbyOpen = false; $('setupStatus').textContent = `Online seats need the local server (${room.error})`; return; }
  await lobbyState();
  $('setupStatus').textContent = 'The lobby is open: friends can join now and choose their decks. Click "Load decks & shuffle up" when everyone is ready.';
});
async function lobbyDeck(seat) {
  const text = await (await fetch(`/api/room/deck?seat=${seat}`)).text();
  if (!text) return;
  let source = text, label = 'their own list';
  const m = text.match(/^library:(.+)$/);
  if (m) {
    const d = (await listDecks().catch(() => [])).find(x => x.name === m[1]);
    if (!d) return;
    source = d.text; label = `${d.name} (your library)`;
  }
  Object.assign(seats[seat], { source, deck: null, lobbyChoice: label });
  persist();
  if (!$('setup').hidden) renderSeats();
  $('setupStatus').textContent = `${seats[seat].name} chose ${label}.`;
  await lobbyState();
  if (!$('inviteModal').hidden) showInvite();
}

// Show who has joined, and who has left (the AI plays a disconnected seat until the friend reopens their link)
setInterval(async () => {
  // (also shown when you play a seat yourself, for offering deals)
  $('chatBox').hidden = !(room.code || (game && setup?.human >= 0));
  if (!room.code) return;
  for (const m of await room.chat()) {
    // A friend's deal offer arrives as "/deal <seat> <kind>"
    const deal = m.seat >= 0 && m.text.match(/^\/deal (\d) (\w+)(?: (\d))?$/);
    if (deal) { queueDeal(m.seat, +deal[1], deal[2], deal[3] ?? 2); continue; }
    say(m.seat, m.seat >= 0 ? (game?.players[m.seat]?.name || m.name) : `${m.name || 'Spectator'} (watching)`, m.text);
  }
  const st = room.presence = await room.status();
  remoteUIs.forEach(u => u.presence());
  // Lobby: a friend sent a deck
  if (lobbyOpen) for (const [seat, s] of Object.entries(st)) if (s.deck) await lobbyDeck(+seat);
  // A friend asked to undo their last decision
  for (const [seat, s] of Object.entries(st)) {
    if (!(s.undo >= 0) || $('undoAsk').dataset.seat === seat) continue;
    $('undoAsk').dataset.seat = seat;
    $('undoAskText').textContent = `${setup?.seats[seat]?.name || `Seat ${+seat + 1}`} asks to take back their last decision.`;
    $('undoAsk').hidden = false;
  }
  if ($('inviteModal').hidden) return;
  for (const [seat, s] of Object.entries(st)) {
    const el = document.querySelector(`.invite-status[data-seat="${seat}"]`);
    if (!el) continue;
    el.textContent = s.seen < 0 ? 'Waiting for them to join…' : s.seen < 10 ? `Connected${s.name ? ` as ${s.name}` : ''}` : `Left ${s.seen}s ago. They can rejoin with the same link`;
    el.classList.toggle('ok', s.seen >= 0 && s.seen < 10);
  }
}, 1500);

// Redraw when the window changes size (combat arrows follow the cards)
addEventListener('resize', () => view?.schedule());

function syncPlay() { $('btnPlay').textContent = clock?.paused ? 'Resume' : 'Pause'; }
function togglePlay() {
  if (!game) return;
  clock.setPaused(!clock.paused);
  syncPlay();
}

// ---------- timeline: replays are the same game re-simulated from its seed
// (with your answers and online friends' answers played back)
// "What if": pick an AI seat; the game is rebuilt to this step and that seat is yours from here on
$('tlTakeover').addEventListener('click', () => {
  const m = $('tlTakeoverMenu');
  if (!m.hidden) { m.hidden = true; return; }
  if (!game || !canRewind() || setup.humans.length || setup.remote.length) { m.innerHTML = '<small class="muted">Only in a game of AI seats (watch one, or load a replay).</small>'; m.hidden = false; return; }
  m.innerHTML = game.players.filter(p => !p.lost).map(p => `<button class="btn small" data-take="${p.idx}" style="border-color:${p.color}">${esc(p.name)}</button>`).join('');
  m.hidden = false;
});
$('tlTakeoverMenu').addEventListener('click', e => {
  const b = e.target.closest('[data-take]');
  if (!b || !game) return;
  $('tlTakeoverMenu').hidden = true;
  const step = game.steps;
  setup.takeovers = [{ seat: +b.dataset.take, step }];
  setup.decisions.length = 0;
  setup.ranked = false;
  newGame({ replay: true, skip: Math.max(0, step), paused: false });
});
function canRewind() {
  // A ranked game can't be rewound until it's over (then it's only watched again)
  return !!setup && !(setup.ranked && !setup.progressed && game && !game.over);
}
function jumpTo(step) {
  if (!canRewind()) return;
  $('results').hidden = true;
  // Forward in the running game: skip ahead (the beat it's waiting on counts as one), stopping where a rebuilt game would
  if (game && step > game.steps && !game.over) { clock.skip = step - game.steps + 1; clock.setPaused(true); syncPlay(); return; }
  newGame({ replay: true, skip: Math.max(0, step), paused: true });
}
$('tlStart').addEventListener('click', () => jumpTo(0));
$('tlPrev').addEventListener('click', () => {
  const prev = [...setup.turnStarts].reverse().find(s => s < game.steps - 2);
  jumpTo(prev ?? 0);
});
$('tlNext').addEventListener('click', () => {
  if (!game || game.over) return;
  const next = setup.turnStarts.find(s => s > game.steps);
  if (next != null) jumpTo(next);
  else { clock.untilTurn = true; clock.wake(); }
});
$('tlEnd').addEventListener('click', () => {
  if (!game || game.over) return;
  clock.untilEnd = true;
  clock.setPaused(false);
  syncPlay();
});
let dragging = false;
$('tlRange').addEventListener('input', () => { dragging = true; $('tlLabel').textContent = `Jump to step ${$('tlRange').value}`; });
$('tlRange').addEventListener('change', () => { dragging = false; jumpTo(+$('tlRange').value); });
setInterval(() => {
  if (!game || dragging) return;
  const r = $('tlRange');
  r.max = setup.total || Math.max(game.steps, +r.max || 0);
  r.value = game.steps;
  $('tlLabel').textContent = `Turn ${game.turn} · step ${game.steps}${setup.total ? ` of ${setup.total}` : ''}${clock.ff ? ' · fast-forwarding…' : ''}`;
}, 250);

// ---------- saving and sharing
function download(name, text, type = 'application/json') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
const stamp = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
function deckText(deck) {
  const line = c => `${c.qty ?? 1} ${c.card?.name ?? c.name}${(c.card ?? c).set ? ` (${(c.card ?? c).set.toUpperCase()}) ${(c.card ?? c).cn}` : ''}`;
  const side = deck.sideboard?.length ? ['', 'Sideboard', ...deck.sideboard.map(line)] : [];
  // (a companion that isn't also in the sideboard gets its own section, so replays and challenge links keep it)
  const comp = deck.companion && !(deck.sideboard || []).some(c => c.card === deck.companion) ? ['', 'Companion', line({ card: deck.companion })] : [];
  if (!deck.commanders.length) return ['Deck', ...deck.cards.map(line), ...side, ...comp].join('\n');
  return ['Commander', ...deck.commanders.map(c => line({ card: c })), '', 'Deck', ...deck.cards.map(line), ...side, ...comp].join('\n');
}
function replayData() {
  return {
    app: 'commander-table', version: 2, seed: setup.seed, decisions: setup.decisions,
    ...(setup.remote.length ? { remoteDecisions: setup.remoteDecisions } : {}),
    learned: setup.learned,
    // (version 3: the format, and who went first in a best-of-three game)
    format: setup.format || 'commander', ...(setup.firstPlayer != null ? { firstPlayer: setup.firstPlayer } : {}),
    ...(setup.roles ? { roles: setup.roles } : {}),
    // (version 4: the stops your seats played with, so your recorded answers line up again)
    stopOpts: setup.stopOpts,
    ...(setup.takeovers?.length ? { takeovers: setup.takeovers } : {}),
    ...(setup.chatDeals?.length ? { chatDeals: setup.chatDeals } : {}),
    // (version 6: the engine's rules version)
    rules: setup.rules,
    // (version 5: which AI seats looked ahead)
    seats: setup.seats.map(s => ({ name: s.name, color: s.color, style: s.style, deckName: s.deck.deckName, deck: deckText(s.deck), ...(s.lookahead ? { lookahead: true } : {}), ...(s.noise ? { noise: s.noise } : {}), ...(s.handicap ? { handicap: s.handicap } : {}) })),
    ...(setup.strength ? { strength: setup.strength } : {}),
  };
}
$('btnSaveReplay').addEventListener('click', () => {
  if (!setup) return;
  download(`commander-replay-${stamp()}.json`, JSON.stringify(replayData(), null, 1));
});
// Save and resume (item 133): the game in progress is kept in the browser profile (as a replay plus how far it got)
// at every turn and every answer; the start menu offers it back. Not for puzzles, lessons, campaigns or online games.
const AUTOSAVE = 'ct.autosave';
function autosave() {
  if (!setup || !game || setup.puzzle || setup.customSeats || setup.loadedReplay || setup.replayOnly) return;
  if (game.over) { store(AUTOSAVE, null); return; }
  // (online games keep the room's seat keys: resuming reopens the room and friends rejoin with the same links)
  const online = setup.remote.length && room.code ? { roomKeys: Object.fromEntries(setup.remote.map(i => [i, room.keys[i]])) } : {};
  try { store(AUTOSAVE, { ...replayData(), ...online, steps: game.steps, at: Date.now(), turn: game.turn, names: game.players.map(p => p.name) }); } catch { /* full: skip */ }
}
function showResume() {
  const a = store(AUTOSAVE);
  $('smResume').hidden = !a;
  if (a) $('smResumeWhat').textContent = `${(a.names || []).join(', ')} · turn ${a.turn} · ${new Date(a.at).toLocaleString()}`;
}
showResume();
$('btnExportLog').addEventListener('click', () => {
  if (!game) return;
  const tmp = document.createElement('div');
  const lines = game.logEntries.map(e => { tmp.innerHTML = e.html; return `${e.kind === 'turn' ? '\n' : '  '}${tmp.textContent}${e.rule ? ` [${e.rule}]` : ''}`; });
  download(`commander-log-${stamp()}.txt`, lines.join('\n').trim(), 'text/plain');
});
$('btnLoadReplay').addEventListener('click', () => $('replayFile').click());
$('replayFile').addEventListener('change', async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try { await loadReplayData(JSON.parse(await file.text())); } catch (err) { $('setupStatus').textContent = `Couldn't load the replay: ${err.message}`; }
});
async function loadReplayData(data, { resume = false } = {}) {
  {
    const rf = data.format && FORMATS[data.format] ? data.format : 'commander';
    if (data.app !== 'commander-table' || !Array.isArray(data.seats) || data.seats.length !== formatOf(rf).seats) throw new Error("That isn't a Commander Table replay file");
    // The replay's format decides the table (Commander replays from earlier versions have none)
    setFormat(rf, { quiet: true });
    match = null;
    data.seats.forEach((r, i) => Object.assign(seats[i], { name: r.name, style: r.style === 'human' && !data.decisions ? 'auto' : r.style, source: r.deck, deck: null }));
    persist();
    renderSeats();
    $('setupStatus').textContent = 'Loading the replay\'s decks…';
    for (const [i, s] of seats.entries()) await loadSeatDeck(s, msg => seatStatus(i, esc(msg)));
    $('setupStatus').textContent = '';
    $('setup').hidden = true;
    newGame({ seed: data.seed, decisions: data.decisions || [], ...(data.remoteDecisions ? { remoteDecisions: data.remoteDecisions } : {}),
      // (replays saved before decks learned have no table, and are played without it)
      ...(data.learned ? { learned: data.learned } : { noLearning: true }), loadedReplay: !resume,
      // (resuming: played back quickly to where it was, then paused; your answers run out there and you're asked again)
      ...(resume ? { skip: data.steps || 0, paused: true } : {}),
      ...(resume && data.remoteDecisions ? { resumeOnline: true, roomKeys: data.roomKeys && typeof data.roomKeys === 'object' ? data.roomKeys : null } : {}), lookahead: data.seats.map(s => !!s.lookahead), ...(data.seats.some(s => s.noise != null) || data.rules >= 5 ? { noise: data.seats.map(s => s.noise || 0) } : {}), strength: data.strength || null, handicap: data.seats.map(s => s.handicap || 0), format: rf, firstPlayer: data.firstPlayer ?? null, roles: data.roles || null, rules: data.rules ?? 4, ...(Array.isArray(data.chatDeals) ? { chatDeals: data.chatDeals.filter(d => Number.isInteger(d?.step) && Number.isInteger(d?.from) && Number.isInteger(d?.to) && DEAL_KINDS.includes(d?.kind)).map(d => ({ step: d.step, from: d.from, to: d.to, kind: d.kind, rounds: Math.max(0, Math.min(5, +d.rounds || 0)) })) } : {}), ...(Array.isArray(data.takeovers) ? { takeovers: data.takeovers.filter(t => Number.isInteger(t?.seat) && Number.isInteger(t?.step)) } : {}), ...(data.stopOpts ? { stopOpts: data.stopOpts } : {}) });
  }
}

// Post-game report (item 124): life totals turn by turn, what each player did, the turn that decided it, the biggest hits
function gameReport(g) {
  const log = [...(g.lifeLog || []), { turn: g.turn + 1, life: g.players.map(q => (q.lost ? 0 : q.life)) }];
  if (log.length < 2) return '';
  const W = 520, H = 140, top = Math.max(...log.flatMap(x => x.life), 1);
  const X = i => 30 + (i / (log.length - 1)) * (W - 40), Y = v => H - 18 - (Math.max(0, v) / top) * (H - 30);
  const lines = g.players.map(q => `<polyline fill="none" stroke="${q.color}" stroke-width="2" points="${log.map((x, i) => `${X(i).toFixed(1)},${Y(x.life[q.idx]).toFixed(1)}`).join(' ')}"><title>${esc(q.name)}</title></polyline>`).join('');
  const axis = `<line x1="30" y1="${H - 18}" x2="${W - 10}" y2="${H - 18}" stroke="currentColor" opacity=".3"/><text x="2" y="${Y(top) + 4}" font-size="10" fill="currentColor" opacity=".7">${top}</text><text x="2" y="${H - 14}" font-size="10" fill="currentColor" opacity=".7">0</text><text x="${W - 60}" y="${H - 2}" font-size="10" fill="currentColor" opacity=".7">turn ${log.at(-1).turn - 1}</text>`;
  // The deciding turn: the one where the winner's lead over the others grew the most
  let decide = null;
  const w = g.winner?.idx;
  if (w != null) {
    let best = -Infinity;
    for (let i = 1; i < log.length; i++) {
      const lead = x => x.life[w] - Math.max(...x.life.filter((_, k) => k !== w));
      const d = lead(log[i]) - lead(log[i - 1]);
      if (d > best) { best = d; decide = log[i - 1].turn; }
    }
  }
  const hits = [...(g.bigHits || [])].sort((a, b) => b.n - a.n).slice(0, 3);
  return `<div class="report"><h3>Game report</h3>
    <svg viewBox="0 0 ${W} ${H}" class="life-graph" role="img" aria-label="Life totals by turn">${axis}${lines}</svg>
    <table class="report-table"><tr><th></th><th>Spells</th><th>Cards drawn</th><th>Damage dealt</th><th>Damage taken</th></tr>
    ${g.players.map(q => `<tr><td><span class="dot" style="background:${q.color}"></span>${esc(q.name)}</td><td>${q.stats.spells}</td><td>${q.stats.draws || 0}</td><td>${q.stats.damage}</td><td>${q.stats.taken || 0}</td></tr>`).join('')}</table>
    ${decide != null ? `<p class="muted">The turn that decided it: turn ${decide} (${esc(g.winner.name)}'s lead grew the most).</p>` : ''}
    ${hits.length ? `<p class="muted">Biggest hits: ${hits.map(h => `${esc(h.src)} for ${h.n} to ${esc(g.players[h.to].name)} (turn ${h.turn})`).join('; ')}.</p>` : ''}</div>`;
}
function showResults() {
  autosave();   // (a finished game is no longer offered to resume)
  const ranked = [...game.players].sort((a, b) => (a.place || 9) - (b.place || 9));
  $('resultsBody').innerHTML = `<h2>${game.winners?.length > 1 ? `🏆 ${esc(game.winners.map(w => w.name).join(', '))} win!` : game.winner ? `${esc(game.winner.name)} wins!` : 'Draw'}</h2>` + ranked.map(p => `
    <div class="standing" style="--pc:${p.color}">
      <div class="place">${p.place || '–'}</div>
      <div class="avatar" style="background-image:url('${p.art || ''}')"></div>
      <div class="meta"><b>${esc(p.name)}</b> — ${esc(p.deckName)}<br>
        ${p.lost ? esc(p.lossReason) : `${p.life} life remaining`} · ${p.stats.spells} spells cast · ${p.stats.damage} damage dealt${p.stats.combos ? ` · ${p.stats.combos} combo${p.stats.combos === 1 ? '' : 's'}` : ''}</div>
    </div>`).join('') + `<p class="muted">${game.turn} turns over ${game.round} rounds.</p>` + gameReport(game) + matchSummary()
    + (setup.progressNote?.lines.length ? `<div class="match-box">${setup.progressNote.lines.join('<br>')}</div>` : '');
  // In an unfinished match the next step is the next game, not a rematch
  const more = setup.matchGame && match && !matchOver(match) && match.games.length === setup.matchGame;
  $('btnNextGame').hidden = !more;
  $('btnRematch').hidden = !!more;
  $('btnRotateDecks').hidden = $('btnSameSeed').hidden = !!setup.puzzle || !!setup.customSeats || !!more;
  $('btnRematch').textContent = setup.matchGame && match ? 'New match' : setup.puzzle ? 'Try again' : 'Rematch';
  // Lessons, story chapters and expedition fights add their own next step
  $('resultsAfter').innerHTML = '';
  if (setup.after && !setup.afterDone) {
    setup.afterDone = true;
    setup.afterResult = setup.after(game);
  }
  const ar = setup.afterResult;
  if (ar) {
    $('resultsAfter').innerHTML = `${ar.html ? `<div class="match-box">${ar.html}</div>` : ''}<div class="after-btns">${(ar.buttons || []).map((b, i) => `<button class="btn ${b.primary ? 'primary' : ''}" data-after="${i}">${esc(b.label)}</button>`).join('')}</div>`;
    $('resultsAfter').querySelectorAll('[data-after]').forEach(b => b.addEventListener('click', () => { $('results').hidden = true; ar.buttons[+b.dataset.after].fn(); }));
    // (an expedition fight can't be replayed for another result)
    if (ar.noRematch) $('btnRematch').hidden = true;
  }
  $('results').hidden = false;
}
// Between games of a match: the loser of the last game chooses who goes first (a drawn game: the same
// player chooses again), then every seat may sideboard. AI seats sideboard against what their opponent
// showed; seats played here get the sideboard window; online friends keep their deck as it is.
async function nextMatchGame() {
  $('results').hidden = true;
  const last = match.games.at(-1);
  const n = setup.seats.length;
  const chooser = last.winner != null ? (last.winner + 1) % n : match.chooser ?? (last.firstPlayer ?? 0);
  match.chooser = chooser;
  let firstPlayer = chooser;
  const shown = i => {
    const seen = new Map();
    for (const gm of match.games) for (let j = 0; j < n; j++) if (j !== i) for (const c of gm.revealed[j] || []) seen.set(c.name, c);
    return [...seen.values()];
  };
  match.swaps = setup.seats.map(() => []);
  for (let i = 0; i < n; i++) {
    const deck = match.decks[i];
    if (setup.humans.includes(i)) {
      const r = await sideboardScreen(i, deck, i === chooser);
      match.decks[i] = r.deck;
      match.swaps[i] = r.swaps;
      if (i === chooser) firstPlayer = r.goFirst ? i : (i + 1) % n;
    } else if (setup.remote.includes(i) && deck.sideboard?.length && remoteUIs.get(i)) {
      // (an online friend sideboards on their own page; no answer or a bad list keeps the deck)
      const r = await remoteUIs.get(i).askSideboard(deck, formatOf(match.format).deck);
      if (r) match.decks[i] = r;
    } else if (!setup.remote.includes(i) && deck.sideboard?.length) {
      const r = aiSideboard(deck, shown(i));
      match.decks[i] = { ...deck, cards: r.cards, sideboard: r.sideboard };
      match.swaps[i] = r.swaps;
    }
  }
  newGame({ firstPlayer, format: match.format });
}

// The sideboard window for a seat played on this PC: click a card to move one copy across
function sideboardScreen(i, deck, choose) {
  const f = formatOf(match.format);
  const name = setup.seats[i].name;
  const start = { cards: deck.cards.map(x => ({ ...x })), sideboard: (deck.sideboard || []).map(x => ({ ...x })) };
  let cur = { cards: start.cards.map(x => ({ ...x })), sideboard: start.sideboard.map(x => ({ ...x })) };
  let goFirst = true;
  const count = list => list.reduce((a, x) => a + x.qty, 0);
  // Moves relative to the start of this window, one copy per entry
  const diff = () => {
    const before = new Map(start.cards.map(x => [x.card.name, x.qty]));
    const after = new Map(cur.cards.map(x => [x.card.name, x.qty]));
    const swaps = [];
    const ins = [], outs = [];
    for (const [nm, q] of after) for (let k = (before.get(nm) || 0); k < q; k++) ins.push(nm);
    for (const [nm, q] of before) for (let k = (after.get(nm) || 0); k < q; k++) outs.push(nm);
    for (let k = 0; k < Math.max(ins.length, outs.length); k++) swaps.push({ in: ins[k] || '—', out: outs[k] || '—' });
    return swaps;
  };
  const move = (from, to, nm) => {
    const a = cur[from].find(x => x.card.name === nm);
    if (!a || a.qty <= 0) return;
    a.qty--;
    const b = cur[to].find(x => x.card.name === nm);
    if (b) b.qty++; else cur[to].push({ card: a.card, qty: 1 });
    cur[from] = cur[from].filter(x => x.qty > 0);
  };
  const sortKey = (a, b) => (/\bland\b/i.test(a.card.typeLine) - /\bland\b/i.test(b.card.typeLine)) || (a.card.cmc || 0) - (b.card.cmc || 0) || a.card.name.localeCompare(b.card.name);
  const col = (key, title) => `<div class="side-col"><h3>${title} <span class="muted">(${count(cur[key])})</span></h3>
    ${[...cur[key]].sort(sortKey).map(x => `<button class="side-card" data-from="${key}" data-name="${esc(x.card.name)}" title="${esc(x.card.typeLine)}"><span class="side-qty">${x.qty}</span> ${esc(x.card.name)} <span class="muted">${symbolize(esc(x.card.manaCost || ''))}</span></button>`).join('') || '<p class="muted">Empty</p>'}</div>`;
  return new Promise(resolve => {
    const render = () => {
      const opp = match.games.at(-1);
      $('sideTitle').textContent = `${name}: sideboard for game ${match.games.length + 1}`;
      $('sideIntro').innerHTML = `${opp.winner === i ? 'You won the last game.' : opp.winner == null ? 'The last game was a draw.' : 'You lost the last game.'} Click a card to move one copy between your deck and sideboard.`
        + (choose ? `<br><label class="side-choice"><input type="radio" name="sideFirst" value="1" ${goFirst ? 'checked' : ''}> Go first</label> <label class="side-choice"><input type="radio" name="sideFirst" value="0" ${goFirst ? '' : 'checked'}> Draw first (the other player goes first)</label>` : '');
      $('sideBody').innerHTML = col('cards', 'Deck') + col('sideboard', 'Sideboard');
      const main = count(cur.cards);
      const short = main < f.deck;
      $('sideCount').innerHTML = short ? `<span class="warn">Your deck needs at least ${f.deck} cards (it has ${main}).</span>` : `${main} cards in the deck, ${count(cur.sideboard)} in the sideboard${diff().length ? ` · ${esc(swapText(diff()))}` : ''}`;
      $('btnSideDone').disabled = short;
    };
    const onClick = e => {
      const b = e.target.closest('.side-card');
      if (!b) return;
      move(b.dataset.from, b.dataset.from === 'cards' ? 'sideboard' : 'cards', b.dataset.name);
      render();
    };
    const onFirst = e => { if (e.target.name === 'sideFirst') goFirst = e.target.value === '1'; };
    const close = () => {
      $('sideBody').removeEventListener('click', onClick);
      $('sideIntro').removeEventListener('change', onFirst);
      $('btnSideReset').onclick = $('btnSideAi').onclick = $('btnSideDone').onclick = null;
      $('sideModal').hidden = true;
      resolve({ deck: { ...deck, cards: cur.cards, sideboard: cur.sideboard }, swaps: diff(), goFirst });
    };
    $('sideBody').addEventListener('click', onClick);
    $('sideIntro').addEventListener('change', onFirst);
    $('btnSideReset').onclick = () => { cur = { cards: start.cards.map(x => ({ ...x })), sideboard: start.sideboard.map(x => ({ ...x })) }; render(); };
    $('btnSideAi').onclick = () => {
      const seen = new Map();
      for (const gm of match.games) gm.revealed.forEach((list, j) => { if (j !== i) for (const c of list) seen.set(c.name, c); });
      const r = aiSideboard({ cards: start.cards, sideboard: start.sideboard }, [...seen.values()]);
      cur = { cards: r.cards, sideboard: r.sideboard };
      render();
    };
    $('btnSideDone').onclick = close;
    render();
    $('sideModal').hidden = false;
  });
}

function matchSummary() {
  if (!setup.matchGame || !match) return '';
  const names = setup.seats.map(s => s.name);
  const done = matchOver(match);
  const lead = match.wins.indexOf(Math.max(...match.wins));
  const head = done
    ? (match.wins[0] === match.wins[1] ? `<b>Match drawn ${matchScore(match)}</b>` : `<b>${esc(names[lead])} wins the match ${Math.max(...match.wins)}–${Math.min(...match.wins)}</b>`)
    : `<b>Game ${match.games.length} of best of three</b> · match score ${names.map((n, i) => `${esc(n)} ${match.wins[i]}`).join(', ')}`;
  const games = match.games.map((gm, k) => `Game ${k + 1}: ${gm.winner != null ? esc(names[gm.winner]) : 'draw'}${gm.firstPlayer != null ? ` (${esc(names[gm.firstPlayer])} went first)` : ''}`).join(' · ');
  const swaps = match.swaps.map((list, i) => (list.length ? `${esc(names[i])} sideboarded ${esc(swapText(list))}` : '')).filter(Boolean).join('<br>');
  return `<div class="match-box">${head}<br><span class="muted">${games}</span>${swaps ? `<br><span class="muted">${swaps}</span>` : ''}</div>`;
}

// ---------- wiring
$('btnPlay').addEventListener('click', togglePlay);
$('btnStep').addEventListener('click', () => {
  if (!game) return;
  if (!clock.paused) togglePlay();
  clock.step();
});
$('speed').addEventListener('input', e => { if (clock) clock.speed = +e.target.value; });
const prefs = store('ct.prefs') || {};

// ---------- Display: board background, color-blind-friendly seat colors, larger text, fewer animations
// (Okabe–Ito colors: they stay distinct with the common kinds of color blindness)
const CB_COLORS = ['#E69F00', '#56B4E9', '#F0E442', '#CC79A7', '#009E73', '#D55E00', '#0072B2', '#999999', '#FFFFFF'];
// (the system's "reduce motion" setting turns on Fewer animations until the player chooses otherwise)
if (prefs.calm === undefined && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) prefs.calm = true;
function applyDisplay(initial = false) {
  document.body.dataset.bg = prefs.bg || 'art';
  document.body.classList.toggle('cb', !!prefs.cb);
  document.body.classList.toggle('big', !!prefs.big);
  document.body.classList.toggle('calm', !!prefs.calm);
  // High contrast and text size (item 128)
  document.body.classList.toggle('contrast', !!prefs.contrast);
  document.documentElement.style.setProperty('--text-scale', prefs.textScale || '1');
  document.body.classList.toggle('text-scaled', !!prefs.textScale);
  const colors = prefs.cb ? CB_COLORS : SEAT_COLORS;
  allSeats.forEach((s, i) => { s.color = colors[i]; });
  // A game in progress switches colors too (boards, log and arrows read the player's color)
  if (game) {
    game.players.forEach((p, i) => { p.color = colors[i]; view?.boards[i]?.el.style.setProperty('--pc', colors[i]); });
    if (setup) setup.seats.forEach((s, i) => { s.color = colors[i]; });
    view?.render();
  }
  // Card back for every face-down card (cosmetics.js); a locked choice falls back to the first one
  const ctx = cosmeticCtx();
  const back = backById(prefs.back);
  document.body.style.setProperty('--card-back', unlocked(back, ctx) ? back.css : BACKS[0].css);
  if (!initial && !$('setup').hidden) renderSeats();
}
// What has been unlocked: badges, games you played, your best deck mastery level
function cosmeticCtx() {
  const lv = Object.keys(store('ct.learn') || {}).reduce((m, k) => Math.max(m, mastery(k.split(' + ').map(name => ({ name }))).level), 1);
  // ('ct.history' spelled out: this runs at startup, before HISTORY is declared)
  return { badges: badges(), games: (store('ct.history') || []).filter(h => h.seats.some(s => s.you)).length, maxMastery: lv };
}
// Your avatar, on every seat you play (otherwise its commander's art)
function avatarUrl() {
  const a = avatarById(prefs.avatar);
  return a.url && unlocked(a, cosmeticCtx()) ? a.url : null;
}
function renderCosmetics() {
  const ctx = cosmeticCtx();
  $('dispAvatars').innerHTML = pickerHtml('avatar', prefs.avatar || 'none', ctx, BADGE_LIST);
  $('dispBacks').innerHTML = pickerHtml('back', prefs.back || 'classic', ctx, BADGE_LIST);
}
$('displayModal').addEventListener('click', e => {
  const b = e.target.closest('.cosm');
  if (!b || b.disabled) return;
  prefs[b.dataset.kind] = b.dataset.id;
  store('ct.prefs', prefs);
  renderCosmetics();
  applyDisplay();
  // (a game in progress shows the new avatar on your boards)
  if (game && view && setup) for (const i of setup.humans) { const av = view.boards[i]?.el.querySelector('.avatar'); if (av) av.style.backgroundImage = `url("${avatarUrl() || deckArt(setup.seats[i].deck)}")`; }
});
$('btnDisplay').addEventListener('click', () => {
  $('dispBg').value = prefs.bg || 'art';
  $('dispCb').checked = !!prefs.cb;
  $('dispBig').checked = !!prefs.big;
  $('dispCalm').checked = !!prefs.calm;
  $('dispContrast').checked = !!prefs.contrast;
  $('dispText').value = prefs.textScale || '';
  renderCosmetics();
  $('displayModal').hidden = false;
});
$('displayModal').addEventListener('change', () => {
  Object.assign(prefs, { bg: $('dispBg').value, cb: $('dispCb').checked, big: $('dispBig').checked, calm: $('dispCalm').checked, contrast: $('dispContrast').checked, textScale: $('dispText').value });
  store('ct.prefs', prefs);
  applyDisplay();
});
$('btnDisplayClose').addEventListener('click', () => { $('displayModal').hidden = true; });
// Language (i18n.js): the page reloads in the new language (a game in progress is lost, so it asks)
$('dispLang').innerHTML = Object.entries(LANGS).map(([k, n]) => `<option value="${k}" ${(prefs.lang || 'en') === k ? 'selected' : ''}>${n}</option>`).join('');
$('dispLang').addEventListener('change', e => {
  if (game && !game.over && !confirm('Changing the language reloads the page and ends the game in progress. Continue?')) { e.target.value = prefs.lang || 'en'; return; }
  prefs.lang = e.target.value;
  store('ct.prefs', prefs);
  location.reload();
});
startI18n(prefs.lang || 'en');
applyDisplay(true);
// Budget style for random decks (empty seats and "random")
$('budgetMode').value = prefs.budget || 'any';
$('budgetMode').addEventListener('change', e => {
  prefs.budget = e.target.value;
  store('ct.prefs', prefs);
  seats.forEach(s => { if (/^(random)?$/i.test(s.source.trim())) s.deck = null; });
  if (!$('setup').hidden) renderSeats();
});

// ---------- updates: only when you ask, from an address you choose (see /api/update)
const UPD = { 'X-Commander-Table': 'update' };
$('btnUpdates').addEventListener('click', async () => {
  $('updateModal').hidden = false;
  $('btnUpdApply').hidden = true;
  $('updStatus').textContent = '';
  try {
    const r = await fetch('/api/update');
    if (!r.ok) throw new Error(r.status === 404 ? 'Restart Commander Table to use updates.' : `HTTP ${r.status}`);
    const j = await r.json();
    $('updVersion').textContent = j.version;
    if (j.url && !$('updUrl').value) $('updUrl').value = j.url;
  } catch (err) { $('updStatus').textContent = err.message; }
});
$('btnUpdClose').addEventListener('click', () => { $('updateModal').hidden = true; });
$('btnUpdCheck').addEventListener('click', async () => {
  const url = $('updUrl').value.trim();
  if (!/^https:\/\//i.test(url)) { $('updStatus').textContent = 'The address must start with https://'; return; }
  $('btnUpdCheck').disabled = true;
  $('btnUpdApply').hidden = true;
  $('updStatus').textContent = 'Downloading…';
  try {
    const r = await fetch('/api/update?step=check', { method: 'POST', headers: UPD, body: url });
    if (!r.ok) throw new Error(await r.text());
    const j = await r.json();
    const same = j.version === j.current;
    $('updStatus').textContent = `Found version ${j.version} (${j.files} files, ${(j.size / 1048576).toFixed(1)} MB). You have ${j.current}.${same ? ' It is the same version; installing only replaces files that differ.' : ''}`;
    $('btnUpdApply').hidden = false;
  } catch (err) { $('updStatus').textContent = `Couldn't use that address: ${err.message}`; }
  $('btnUpdCheck').disabled = false;
});
$('btnUpdApply').addEventListener('click', async () => {
  if (!confirm('Replace the game files with the downloaded version? Your data folder stays as it is.')) return;
  $('btnUpdApply').hidden = true;
  $('updStatus').textContent = 'Installing…';
  try {
    const r = await fetch('/api/update?step=apply', { method: 'POST', headers: UPD, body: '' });
    if (!r.ok) throw new Error(await r.text());
    const j = await r.json();
    $('updVersion').textContent = j.version;
    $('updStatus').textContent = j.changed
      ? `Installed: ${j.changed} file${j.changed === 1 ? '' : 's'} updated (the old ones are in ${j.backup}). Close Commander Table and start it again to finish.`
      : 'Every file was already up to date.';
  } catch (err) { $('updStatus').textContent = `The update didn't install: ${err.message}`; }
});

// ---------- Stops (human.js): steps to stop at, Full control, trigger order, for seats played on this PC
function stopOpts() { return { stops: { ...(prefs.stops || {}) }, full: !!prefs.stopFull, orderTriggers: prefs.stopOrder !== false }; }
$('btnStops').addEventListener('click', () => {
  $('stopFull').checked = !!prefs.stopFull;
  $('stopOrder').checked = prefs.stopOrder !== false;
  document.querySelectorAll('[data-stop]').forEach(c => { c.checked = !!prefs.stops?.[c.dataset.stop]; });
  $('stopsModal').hidden = false;
});
$('stopsModal').addEventListener('change', () => {
  prefs.stopFull = $('stopFull').checked;
  prefs.stopOrder = $('stopOrder').checked;
  prefs.stops = Object.fromEntries([...document.querySelectorAll('[data-stop]')].map(c => [c.dataset.stop, c.checked]));
  store('ct.prefs', prefs);
  // (from the next game: a game keeps the stops it started with, so undo, rewinds and replays stay exact)
});
$('btnStopsClose').addEventListener('click', () => { $('stopsModal').hidden = true; });

// ---------- progress (progress.js): the ladder, challenges, badges and your record against each rival
const RIVALS = 'ct.rivals';
const rivalKeyOf = (i, s) => setup.rivalKeys?.[i] || deckKey(learnAs(s.deck));
const deckColors = d => [...new Set(d.commanders.length ? d.commanders.flatMap(c => c.colorIdentity || []) : d.cards.filter(c => !/\bland\b/i.test(c.card.typeLine)).flatMap(c => c.card.colors || []))];
function recordProgress(g) {
  const h = setup.humans[0];
  const me = g.players[h];
  const n = g.players.length;
  const places = g.players.map(p => (g.winner === p ? 1 : p.place || n));
  const won = g.winner === me || !!g.winners?.includes(me);
  const note = { lines: [] };
  // Ranked: your rating on this format's ladder
  if (setup.ranked) {
    const r = recordRanked({ format: setup.format, you: h, places, oppRatings: setup.seats.map(s => (STRENGTH[setup.strength] ? STRENGTH[setup.strength].rating : setup.format === 'commander' ? aiRating(s.bracket) : 1500)) });
    note.lines.push(`<b>Ranked ${esc(formatOf(setup.format).name)}:</b> ${r.delta >= 0 ? '+' : ''}${r.delta} → ${r.rating} · ${esc(r.after.label)}${r.after.label !== r.before.rank.label && r.games > PLACEMENT ? ` (was ${esc(r.before.rank.label)})` : r.games === PLACEMENT ? ' (placement done)' : ''}`);
  }
  // Challenges
  const matchWon = !!(setup.matchGame && match && matchOver(match) && match.wins[h] >= 2);
  const c = recordChallenges({
    won, format: setup.format, seats: n, rounds: g.round, spells: me.stats.spells, damage: me.stats.damage,
    colors: deckColors(setup.seats[h].deck), matchWon, oneVsOne: n === 2,
  });
  for (const t of c.done) note.lines.push(`✔ Challenge complete: ${esc(t)}`);
  // Badges, including deck mastery (the deck you played)
  const fresh = [...c.badges, ...checkBadges(undefined, mastery(learnAs(setup.seats[h].deck)).level)];
  for (const b of fresh) note.lines.push(`🏅 New badge: <b>${esc(b)}</b>`);
  // Your record against each opponent's deck (the Rivals tab)
  const rec = store(RIVALS) || {};
  setup.seats.forEach((s, i) => {
    if (i === h) return;
    const k = rivalKeyOf(i, s);
    const r = rec[k] ||= { name: s.deck.deckName, w: 0, l: 0 };
    if (places[h] < places[i]) r.w++; else r.l++;
    r.at = Date.now();
  });
  store(RIVALS, rec);
  return note;
}

// ---------- history: every finished game (not batch runs), newest first, kept in the browser profile
const HISTORY = 'ct.history';
function addHistory(g) {
  const list = store(HISTORY) || [];
  list.unshift({
    at: Date.now(), rounds: g.round, reason: g.winReason || '', winner: g.winner?.idx ?? null,
    online: setup.remote.length > 0,
    seats: g.players.map((p, i) => ({ name: p.name, deck: p.deckName, style: setup.seats[i].style, place: p.place || (g.winner === p ? 1 : null), you: setup.humans.includes(i), friend: setup.remote.includes(i), bracket: setup.seats[i].bracket, spells: p.stats.spells, dealt: p.stats.damage, taken: p.stats.taken || 0 })),
  });
  store(HISTORY, list.slice(0, 500));
}
function renderHistory() {
  const list = store(HISTORY) || [];
  if (!list.length) { $('historyBody').innerHTML = '<p class="muted">No finished games yet.</p>'; return; }
  const mine = list.filter(h => h.seats.some(s => s.you));
  const myWins = mine.filter(h => h.seats[h.winner]?.you).length;
  // Wins by deck across every game
  const decks = new Map();
  for (const h of list) for (const [i, s] of h.seats.entries()) {
    const d = decks.get(s.deck) || { games: 0, wins: 0 };
    d.games++;
    if (h.winner === i) d.wins++;
    decks.set(s.deck, d);
  }
  const top = [...decks.entries()].filter(([, d]) => d.games >= 2).sort((a, b) => b[1].wins / b[1].games - a[1].wins / a[1].games).slice(0, 8);
  const avg = list.reduce((a, h) => a + h.rounds, 0) / list.length;
  $('historyBody').innerHTML = (Object.keys(ladder().formats).length ? `<h3>Ranked ladder</h3>${ladderHtml(false).replace(/^<h3>/, '<p>').replace('</h3>', '</p>')}` : '') + `
    <ul><li><b>${list.length}</b> games, average ${avg.toFixed(1)} rounds</li>
      ${mine.length ? `<li>You played <b>${mine.length}</b> and won <b>${myWins}</b> (${Math.round((myWins / mine.length) * 100)}%)</li>` : '<li class="muted">You haven\'t played a seat yourself yet.</li>'}
      ${list.some(h => h.online) ? `<li>${list.filter(h => h.online).length} with friends online</li>` : ''}</ul>
    ${top.length ? `<h3>Decks that win most</h3><table><thead><tr><th>Deck</th><th class="num">Games</th><th class="num">Wins</th></tr></thead><tbody>
      ${top.map(([n, d]) => `<tr><td>${esc(n)}</td><td class="num">${d.games}</td><td class="num">${d.wins} (${Math.round((d.wins / d.games) * 100)}%)</td></tr>`).join('')}</tbody></table>` : ''}
    <h3>Games</h3><table><thead><tr><th>When</th><th>Winner</th><th>Table</th><th class="num">Rounds</th></tr></thead><tbody>
      ${list.slice(0, 200).map(h => `<tr><td>${esc(new Date(h.at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }))}</td>
        <td>${h.winner != null ? `<b>${esc(h.seats[h.winner].name)}</b> <span class="muted">${esc(h.seats[h.winner].deck)}</span>${h.reason ? `<br><small class="muted">${esc(h.reason)}</small>` : ''}` : 'Draw'}</td>
        <td>${h.seats.map((s, i) => `<span class="${i === h.winner ? 'hist-win' : ''}">${esc(s.name)}${s.you ? ' (you)' : s.friend ? ' (friend)' : ''}</span>`).join(', ')}</td>
        <td class="num">${h.rounds}</td></tr>`).join('')}</tbody></table>`;
}
$('btnHistory').addEventListener('click', () => { renderHistory(); $('historyModal').hidden = false; });
$('btnHistoryClose').addEventListener('click', () => { $('historyModal').hidden = true; });
$('btnHistoryClear').addEventListener('click', () => { if (confirm('Clear the history of every game?')) { store(HISTORY, []); renderHistory(); } });

// ---------- Progress window: ladder, challenges, rivals, badges
let progressTab = 'ladder';
$('btnProgress').addEventListener('click', () => { renderProgress(); $('progressModal').hidden = false; });
$('btnProgressClose').addEventListener('click', () => { $('progressModal').hidden = true; });
document.querySelectorAll('.prog-tab').forEach(b => b.addEventListener('click', () => { progressTab = b.dataset.tab; renderProgress(); }));
function ladderHtml(withButton = true) {
  const l = ladder();
  const rows = Object.entries(l.formats).sort((a, b) => b[1].games - a[1].games);
  return `<h3>Season ${l.season} <span class="muted">since ${esc(new Date(l.startedAt).toLocaleDateString())}</span></h3>
    ${rows.length ? `<table><thead><tr><th>Format</th><th>Rank</th><th class="num">Rating</th><th class="num">Games</th><th class="num">Wins</th><th class="num">Peak</th><th>Last games</th></tr></thead><tbody>
      ${rows.map(([k, f]) => { const r = rankOf(f.rating, f.games); return `<tr><td>${esc(formatOf(k).name)}</td><td><span class="rank-chip rank-${r.tier.toLowerCase()}">${esc(r.label)}</span></td><td class="num">${f.games >= PLACEMENT ? f.rating : '–'}</td><td class="num">${f.games}</td><td class="num">${f.wins}</td><td class="num">${f.games >= PLACEMENT ? f.peak : '–'}</td>
        <td>${f.history.slice(0, 10).map(x => `<span class="${x.won ? 'good' : 'bad'}" title="${esc(new Date(x.at).toLocaleString())}">${x.delta >= 0 ? '+' : ''}${x.delta}</span>`).join(' ')}</td></tr>`; }).join('')}</tbody></table>`
      : '<p class="muted">No ranked games yet. Tick <b>Ranked</b> on the setup screen, choose "You play this seat" for one seat, and play.</p>'}
    <p class="muted">Ranked games are scored against the AI pilots (Elo, a rating per format, starting at 1500). In Commander, a pilot's rating follows its seat's bracket (bracket 1 = 1200 up to 5 = 1800); in other formats it's 1500. The first ${PLACEMENT} games place you; then Bronze, Silver, Gold, Platinum and Diamond have divisions III, II and I, and Mythic is 1900 and up. In ranked games undo, rewinding, Reveal hands and Explain are off.</p>
    ${l.past.length ? `<h3>Past seasons</h3><ul>${l.past.map(s => `<li>Season ${s.season}: ${Object.entries(s.formats).map(([k, f]) => `${esc(formatOf(k).name)} ${esc(f.rank)} (peak ${f.peak})`).join(' · ') || 'no games'}</li>`).join('')}</ul>` : ''}
    ${withButton ? '<p><button class="btn small" id="btnNewSeason" title="Ratings move halfway back to 1500 and placement starts over; this season is kept in Past seasons">Start a new season</button></p>' : ''}`;
}
function renderProgress() {
  document.querySelectorAll('.prog-tab').forEach(b => b.classList.toggle('primary', b.dataset.tab === progressTab));
  const body = $('progressBody');
  if (progressTab === 'ladder') {
    body.innerHTML = ladderHtml();
    $('btnNewSeason')?.addEventListener('click', () => { if (confirm('Start a new season? Ratings move halfway back to 1500 and placement starts over.')) { newSeason(); renderProgress(); } });
  } else if (progressTab === 'challenges') {
    const c = challenges();
    const row = x => `<li class="${x.done ? 'ch-done' : ''}">${x.done ? '✔' : '○'} ${esc(x.text)} <span class="muted">${x.done ? 'done' : `${x.n}/${x.need}`}</span></li>`;
    body.innerHTML = `<p><b>Streak:</b> ${c.streak.count} day${c.streak.count === 1 ? '' : 's'} in a row (best ${c.streak.best}) · ${c.completed} challenge${c.completed === 1 ? '' : 's'} completed in all</p>
      <h3>Today</h3><ul class="ch-list">${c.daily.map(row).join('')}</ul>
      <h3>This week <span class="muted">(from Monday ${esc(c.week)})</span></h3><ul class="ch-list">${c.weekly.map(row).join('')}</ul>
      <p class="muted">Challenges count games where you play one seat yourself (not puzzles, loaded replays or games with friends online). New daily challenges come each day and weekly ones each Monday. Doing at least one daily challenge a day keeps your streak going. They're just for fun: the only rewards are badges.</p>`;
  } else if (progressTab === 'badges') {
    const got = badges();
    body.innerHTML = `<div class="badge-grid">${BADGE_LIST.map(b => `<div class="badge ${got[b.id] ? 'got' : ''}"><div class="badge-medal">${got[b.id] ? '🏅' : '🔒'}</div><b>${esc(b.name)}</b><span class="muted">${esc(b.text)}</span>${got[b.id] ? `<small class="muted">${esc(new Date(got[b.id]).toLocaleDateString())}</small>` : ''}</div>`).join('')}</div>
      <p class="muted">${Object.keys(got).length} of ${BADGE_LIST.length} earned. Badges are only for show.</p>`;
  } else if (progressTab === 'gauntlet') renderGauntlet();
  else renderRivals();
}

// ---------- Gauntlet (item 162): beat a chain of rivals one on one with your deck; one loss ends the run.
// Rivals come from the EDHTop16 top 8 (1v1 Commander), your library, or random decks of the table's format.
const GAUNTLET = 'ct.gauntlet';
function renderGauntlet(msg = '') {
  const g = store(GAUNTLET) || { best: {}, run: null };
  const body = $('progressBody');
  const best = Object.entries(g.best || {}).map(([k, v]) => `<li>${esc(GAUNTLET_FROM[k] || k)}: ${v.wins} win${v.wins === 1 ? '' : 's'} in a row${v.cleared ? ' (cleared)' : ''} <span class="muted">${esc(new Date(v.at).toLocaleDateString())}</span></li>`).join('');
  const run = g.run;
  body.innerHTML = run ? `<h3>${esc(GAUNTLET_FROM[run.from])}: rival ${run.beaten + 1} of ${run.rivals.length}</h3>
      <p>Your deck: <b>${esc(run.mine.name)}</b> · ${esc(formatOf(run.format).name)} · ${run.beaten} beaten so far.</p>
      <ol class="gauntlet-list">${run.rivals.map((r, i) => `<li class="${i < run.beaten ? 'ch-done' : i === run.beaten ? 'gl-next' : 'muted'}">${i < run.beaten ? '✔ ' : ''}${esc(r.name)}</li>`).join('')}</ol>
      <p><button class="btn primary" data-gl="fight">Fight ${esc(run.rivals[run.beaten].name)}</button> <button class="btn ghost" data-gl="quit">Give up the run</button></p>`
    : `<p>Beat a chain of rivals one on one with the deck in seat 1; one loss ends the run. Your best run from each pool is kept.</p>
      <p><label>Rivals <select id="glFrom" class="sbracket">${Object.entries(GAUNTLET_FROM).map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join('')}</select></label>
        <button class="btn primary" data-gl="start">Start a run</button></p>`;
  body.innerHTML += `${best ? `<h3>Best runs</h3><ul>${best}</ul>` : ''}${msg ? `<p class="muted">${esc(msg)}</p>` : ''}`;
  body.querySelector('[data-gl="start"]')?.addEventListener('click', () => startGauntlet(/** @type {HTMLSelectElement} */ ($('glFrom')).value));
  body.querySelector('[data-gl="quit"]')?.addEventListener('click', () => { if (confirm('Give up this run? It counts as it stands.')) { endGauntlet(false); renderGauntlet(); } });
  body.querySelector('[data-gl="fight"]')?.addEventListener('click', fightGauntlet);
}
const GAUNTLET_FROM = { meta: 'EDHTop16 top 8 (1v1 Commander)', library: 'Your deck library', random: 'Random decks of the table\'s format' };
async function startGauntlet(from) {
  const say = t => renderGauntlet(t);
  const mine = seats[0];
  if (!mine.source.trim()) { say('Put your deck in seat 1 first (any source but an empty seat).'); return; }
  let rivals = [], format = formatKey;
  try {
    if (from === 'meta') { rivals = (await topCommanders({ count: 8 })).slice(0, 8).map(c => ({ name: c.name, source: `edhtop16:${c.name}` })); format = 'commander1v1'; }
    else if (from === 'library') {
      const own = mine.source.trim();
      rivals = (await listDecks()).filter(d => d.text.trim() !== own).sort(() => Math.random() - 0.5).slice(0, 8).map(d => ({ name: d.name, source: d.text }));
      if (rivals.length < 3) { say('The gauntlet needs at least three other decks in your library.'); return; }
    } else rivals = Array.from({ length: 6 }, (_, i) => ({ name: `Random rival ${i + 1}`, source: 'random' }));
  } catch (err) { say(`Couldn't gather rivals: ${err.message}`); return; }
  // (commander decks fight at the 1v1 Commander table; a four-player format becomes 1v1 Commander)
  if (formatOf(format).seats !== 2) format = formatOf(format).commander ? 'commander1v1' : 'standard';
  const g = store(GAUNTLET) || { best: {} };
  g.run = { from, format, rivals, beaten: 0, mine: { name: mine.deck?.deckName || mine.name, source: mine.source } };
  store(GAUNTLET, g);
  renderGauntlet();
}
function endGauntlet(cleared) {
  const g = store(GAUNTLET);
  if (!g?.run) return;
  const b = g.best[g.run.from];
  if (!b || g.run.beaten > b.wins || (cleared && !b.cleared)) g.best[g.run.from] = { wins: g.run.beaten, cleared, at: Date.now() };
  g.run = null;
  store(GAUNTLET, g);
}
async function fightGauntlet() {
  const g = store(GAUNTLET), run = g?.run;
  if (!run) return;
  const rival = run.rivals[run.beaten];
  renderGauntlet(`Loading ${rival.name}…`);
  try {
    const mine = await loadDeck(run.mine.source, () => {}, { format: run.format });
    const theirs = await loadDeck(rival.source, () => {}, { format: run.format });
    $('progressModal').hidden = true; $('setup').hidden = true; $('startMenu').hidden = true;
    match = null;
    newGame({
      customSeats: [{ name: 'You', deck: mine, style: 'human' }, { name: rival.name === `Random rival ${run.beaten + 1}` ? theirs.deckName : rival.name, deck: theirs, style: guessStyle(theirs) }],
      format: run.format,
      after: game => {
        const won = game.winner === game.players[0];
        const cur = store(GAUNTLET);
        // (counted once: a rewound or replayed game doesn't count again)
        if (cur?.run && cur.run.beaten === run.beaten && cur.run.from === run.from) {
          if (won) { cur.run.beaten++; store(GAUNTLET, cur); if (cur.run.beaten >= cur.run.rivals.length) endGauntlet(true); }
          else endGauntlet(false);
        }
        const after = store(GAUNTLET);
        const open = () => { progressTab = 'gauntlet'; renderProgress(); $('progressModal').hidden = false; };
        return {
          html: won ? (after?.run ? `✔ <b>${esc(rival.name)} beaten.</b> ${after.run.beaten} in a row; next: ${esc(after.run.rivals[after.run.beaten].name)}.` : '🏆 <b>Gauntlet cleared!</b> Every rival beaten.') : `<b>The run ends</b> after ${run.beaten} win${run.beaten === 1 ? '' : 's'}.`,
          buttons: [{ label: 'Back to the gauntlet', primary: true, fn: open }], noRematch: true,
        };
      },
    });
  } catch (err) { renderGauntlet(`Couldn't start the fight: ${err.message}`); }
}

// Rivals: named AI decks to play against, each with a strength tier and your record against it
async function rivalList() {
  const out = CEDH_PRESETS.map(p => ({ name: p.name, source: p.list, format: 'commander', kind: 'cEDH preset', key: deckKey(parseText(p.list).entries.filter(e => e.commander).map(e => ({ name: e.name }))) }));
  try {
    for (const d of await listDecks()) {
      const cmd = parseText(d.text).entries.filter(e => e.commander);
      out.push({ name: d.name, source: d.text, format: cmd.length ? 'commander' : null, kind: 'Your library', key: cmd.length ? deckKey(cmd.map(e => ({ name: e.name }))) : `library: ${d.name}` });
    }
  } catch { /* the library needs the local server */ }
  try {
    for (const c of (await topCommanders({ count: 8 })).slice(0, 8)) out.push({ name: c.name, source: `edhtop16:${c.name}`, format: 'commander', kind: 'Tournament meta', key: deckKey(c.name.split(' / ').map(name => ({ name }))), art: c.art });
  } catch { /* offline with nothing saved */ }
  return out;
}
// Strength from how the deck has done in every game it played (deck mastery records), relative to
// an even share of wins at its table size
function rivalTier(key, format) {
  // (the key is learn.js's deckKey: commander names joined by " + ")
  const m = mastery(key.split(' + ').map(name => ({ name })));
  if (m.games < 5) return { tier: '?', text: `Not rated yet (${m.games} of 5 games)` };
  // (decks without a commander are remembered as "format: name #id", which names their format)
  const named = key.match(/^(\w+): /)?.[1];
  const seatsN = formatOf(format || (FORMATS[named] ? named : 'commander')).seats;
  const r = (m.wins / m.games) * seatsN;
  const tier = r >= 1.6 ? 'S' : r >= 1.2 ? 'A' : r >= 0.8 ? 'B' : 'C';
  return { tier, text: `Tier ${tier}: wins ${Math.round((m.wins / m.games) * 100)}% of ${m.games} games` };
}
async function renderRivals() {
  const body = $('progressBody');
  body.innerHTML = '<p class="muted">Gathering rivals…</p>';
  const list = await rivalList();
  if (progressTab !== 'rivals') return;
  const rec = store(RIVALS) || {};
  body.innerHTML = `<p class="muted">AI decks to take on: the built-in cEDH decks, your deck library and the current tournament meta. <b>Play</b> puts one in an AI seat (switching the format if it needs to). The tier comes from how the deck has done in all its games; your record counts the games you played against it.</p>
    <table><thead><tr><th>Rival</th><th>From</th><th>Tier</th><th class="num">You vs it</th><th></th></tr></thead><tbody>
    ${list.map((r, i) => { const t = rivalTier(r.key, r.format); const y = rec[r.key]; return `<tr><td><b>${esc(r.name)}</b>${r.format ? ` <span class="muted">${esc(formatOf(r.format).name)}</span>` : ''}</td><td class="muted">${esc(r.kind)}</td>
      <td><span class="tier-chip tier-${t.tier === '?' ? 'x' : t.tier.toLowerCase()}" title="${esc(t.text)}">${t.tier === '?' ? '–' : t.tier}</span></td>
      <td class="num">${y ? `${y.w}–${y.l}` : '–'}</td><td><button class="btn small rival-play" data-i="${i}">Play</button></td></tr>`; }).join('')}
    ${Object.entries(rec).filter(([k]) => !list.some(r => r.key === k)).sort((a, b) => (b[1].at || 0) - (a[1].at || 0)).slice(0, 30).map(([k, y]) => { const t = rivalTier(k, null); return `<tr><td><b>${esc(y.name)}</b></td><td class="muted">Faced before</td>
      <td><span class="tier-chip tier-${t.tier === '?' ? 'x' : t.tier.toLowerCase()}" title="${esc(t.text)}">${t.tier === '?' ? '–' : t.tier}</span></td><td class="num">${y.w}–${y.l}</td><td></td></tr>`; }).join('')}</tbody></table>`;
  body.querySelectorAll('.rival-play').forEach(b => b.addEventListener('click', () => {
    const r = list[+b.dataset.i];
    // Commander decks need the Commander table; a library deck without a commander keeps a duel format
    if (r.format && formatKey !== r.format) setFormat(r.format, { quiet: true });
    else if (!r.format && formatOf(formatKey).commander) setFormat('standard', { quiet: true });
    const i = seats.findIndex((s, k) => k > 0 && !['human', 'remote'].includes(s.style));
    const at = i >= 0 ? i : seats.length - 1;
    Object.assign(seats[at], { source: r.source, deck: null, rivalKey: r.key, rivalSource: r.source, ...(r.kind === 'cEDH preset' ? { style: 'cedh' } : {}) });
    persist();
    renderSeats();
    $('progressModal').hidden = true;
    $('setup').hidden = false;
    $('setupStatus').textContent = `${r.name} is in ${seats[at].name}'s seat. Choose "You play this seat" for your own seat, then click "Load decks & shuffle up".`;
  }));
}

// The Ranked switch on the setup screen
$('rankedSel').checked = !!prefs.ranked;
// AI look-ahead (lookahead.js): on unless switched off; saved with each game so replays stay exact
$('lookaheadSel').checked = prefs.lookahead !== false;
$('aiStrength').value = STRENGTH[prefs.aiStrength] ? prefs.aiStrength : 'auto';
// Coach (item 168): off in Ranked and puzzles; only for seats played on this PC
$('coachOn').checked = !!prefs.coach;
$('coachOn').addEventListener('change', e => { prefs.coach = /** @type {HTMLInputElement} */ (e.target).checked; store('ct.prefs', prefs); if (game) for (const p of game.players) if (p.agent.human && p.agent.ui === humanUI || p.agent.ui instanceof SeatUI) p.agent.coach = prefs.coach && !setup.ranked && !setup.puzzle; });
function withCoach(a) { a.coach = !!prefs.coach && !setup.ranked && !setup.puzzle; return a; }
$('aiStrength').addEventListener('change', e => { prefs.aiStrength = e.target.value; store('ct.prefs', prefs); $('lookaheadSel').disabled = e.target.value !== 'auto'; });
$('lookaheadSel').disabled = $('aiStrength').value !== 'auto';
$('lookaheadSel').addEventListener('change', e => { prefs.lookahead = e.target.checked; store('ct.prefs', prefs); });
$('rankedSel').addEventListener('change', e => {
  prefs.ranked = e.target.checked; store('ct.prefs', prefs);
  const humans = seats.filter(s => s.style === 'human').length;
  $('setupStatus').textContent = prefs.ranked ? (humans === 1 ? `Ranked ${fmt().name}: this game counts on your ladder.` : 'Ranked counts games where exactly one seat is "You play this seat".') : '';
});

// ---------- log filters: one kind of event, or one player
$('logFilter').addEventListener('change', e => { $('log').dataset.f = e.target.value; $('log').scrollTop = $('log').scrollHeight; });
$('logSeat').addEventListener('change', e => { $('log').dataset.seat = e.target.value; $('log').scrollTop = $('log').scrollHeight; });
// Log search (item 123): only lines containing the text (turn headers stay)
$('logSearch').addEventListener('input', e => {
  const q = e.target.value.trim().toLowerCase();
  for (const el of $('log').children) if (!el.classList.contains('turn')) el.classList.toggle('search-hide', !!q && !el.textContent.toLowerCase().includes(q));
});
$('logSearch').addEventListener('keydown', e => e.stopPropagation());
function fillLogSeats() {
  const opts = '<option value="">All players</option>' + (game?.players || []).map(p => `<option value="${p.idx}">${esc(p.name)}</option>`).join('');
  if ($('logSeat').dataset.v !== opts) { $('logSeat').innerHTML = opts; $('logSeat').dataset.v = opts; $('log').dataset.seat = ''; }
}
// Light or dark theme (dark by default, or whatever the system prefers on first visit)
function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  $('btnTheme').textContent = t === 'dark' ? '☀' : '☾';
  $('btnTheme').title = t === 'dark' ? 'Switch to the light theme' : 'Switch to the dark theme';
}
applyTheme(prefs.theme || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'));
$('btnTheme').addEventListener('click', () => { prefs.theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; store('ct.prefs', prefs); applyTheme(prefs.theme); });
$('followMode').checked = !!prefs.follow;
$('soundOn').checked = !!prefs.sound;
Sound.enabled = !!prefs.sound;
// Separate volumes for the music and the effects (Display window)
Sound.volume = (prefs.volFx ?? 100) / 100;
Music.setVolume((prefs.volMusic ?? 100) / 100);
$('volMusic').value = String(prefs.volMusic ?? 100);
$('volFx').value = String(prefs.volFx ?? 100);
$('volMusic').addEventListener('input', e => { prefs.volMusic = +e.target.value; store('ct.prefs', prefs); Music.setVolume(prefs.volMusic / 100); });
$('volFx').addEventListener('input', e => { prefs.volFx = +e.target.value; store('ct.prefs', prefs); Sound.volume = prefs.volFx / 100; });
$('volFx').addEventListener('change', () => Sound.play('cast'));
// Browsers only start audio after a click or key press, so the music starts on the first one
if (prefs.sound) document.addEventListener('pointerdown', () => Sound.setEnabled(prefs.sound), { once: true });
document.body.classList.toggle('follow', !!prefs.follow);
$('followMode').addEventListener('change', e => { prefs.follow = e.target.checked; store('ct.prefs', prefs); document.body.classList.toggle('follow', prefs.follow); view?.render(); });
$('soundOn').addEventListener('change', e => { prefs.sound = e.target.checked; store('ct.prefs', prefs); Sound.setEnabled(prefs.sound); if (prefs.sound) Sound.play('land'); });

// Moxfield bookmarklet: runs on moxfield.com in your own browser and copies the decklist
const moxScript = `(async()=>{try{const id=location.pathname.split('/').filter(Boolean)[1];if(!/moxfield\\.com$/.test(location.hostname)||!id){alert('Open a Moxfield deck page first, then click this bookmark.');return}
const d=await(await fetch('https://api2.moxfield.com/v3/decks/all/'+id)).json();const b=d.boards||{};
const rows=s=>Object.values((b[s]||{}).cards||{}).map(c=>c.quantity+' '+c.card.name);
const t=['Commander',...rows('commanders'),'','Deck',...rows('mainboard')].join('\\n');
try{await navigator.clipboard.writeText(t);alert('Copied '+(d.name||'the deck')+'. Paste it into a Commander Table seat.')}
catch(e){const a=document.createElement('textarea');a.value=t;a.style.cssText='position:fixed;inset:10%;z-index:99999;width:80%;height:80%';document.body.append(a);a.select();alert('Press Ctrl+C to copy the selected decklist.')}}
catch(e){alert('Could not read this deck: '+e.message)}})()`;
$('moxBookmarklet').href = `javascript:${encodeURIComponent(moxScript.replace(/\n/g, ''))}`;
$('moxBookmarklet').addEventListener('click', e => { e.preventDefault(); $('setupStatus').textContent = "Drag this button to your bookmarks bar, then click it on a Moxfield deck page. Clicking it here does nothing."; });
$('revealHands').addEventListener('change', e => { if (view) { view.revealHands = e.target.checked; view.render(); } });
$('explainMode').addEventListener('change', e => { if (game) game.explain = e.target.checked; });
$('btnDecks').addEventListener('click', () => {
  if (game && !clock.paused) togglePlay();
  renderSeats();
  $('btnCloseSetup').hidden = !game;
  $('setup').hidden = false;
});
$('btnCloseSetup').addEventListener('click', () => { $('setup').hidden = true; });
$('btnLoad').addEventListener('click', loadAll);
// ---------- brackets for the whole table
$('tableBracket').innerHTML = bracketOptions(null).replace('Any bracket', 'Choose…');
$('tableBracket').addEventListener('change', e => {
  const b = e.target.value ? +e.target.value : null;
  seats.forEach(s => { s.bracket = b; if (/^(random)?$/i.test(s.source.trim())) s.deck = null; });
  persist();
  renderSeats();
  $('setupStatus').textContent = b ? `Every seat set to bracket ${b} (${BRACKETS[b].name}). Empty seats get a deck built for it${b === 5 ? ' from EDHTop16 tournament results' : ''}.` : '';
});

// ---------- cEDH meta browser (EDHTop16 + cEDH Decklist Database)
let metaTab = 'top';
const seatButtons = src => seats.map((s, i) => `<button class="btn small seatpick" style="--pc:${s.color}" data-src="${esc(src)}" data-seat="${i}" title="Load into ${esc(s.name)}'s seat">${i + 1}</button>`).join('');
async function renderMeta() {
  const q = $('metaSearch').value.trim().toLowerCase();
  const body = $('metaBody');
  $('btnMetaTop4').hidden = metaTab !== 'top';
  $('metaPeriod').disabled = metaTab === 'trend';
  $('metaStatus').textContent = 'Loading…';
  try {
    if (metaTab === 'top') {
      const f = metaFilter();
      const top = await topCommanders({ count: 60, ...f });
      const rows = top.filter(c => !q || c.name.toLowerCase().includes(q) || c.colorId.toLowerCase().includes(q));
      body.innerHTML = `<table><thead><tr><th class="num">#</th><th>Commander</th><th>Colors</th><th class="num">Meta share</th><th class="num">Win rate</th><th class="num">Top-cut rate</th><th class="num">Entries</th><th>Load into seat</th></tr></thead><tbody>
        ${rows.map(c => `<tr><td class="num">${top.indexOf(c) + 1}</td><td>${esc(c.name)}</td><td>${symbolize([...c.colorId].map(x => `{${x}}`).join('') || '{C}')}</td>
          <td class="num">${(c.metaShare * 100).toFixed(1)}%</td><td class="num">${(c.winRate * 100).toFixed(1)}%</td><td class="num">${(c.conversionRate * 100).toFixed(1)}%</td><td class="num">${c.count}</td>
          <td class="seatpicks">${seatButtons(`edhtop16:${c.name}`)}</td></tr>`).join('')}</tbody></table>`;
      $('metaStatus').textContent = `${top.length} commanders from EDHTop16, ${$('metaPeriod').selectedOptions[0].text.toLowerCase()}, events of ${f.minSize}+ players${f.colorId ? `, color identity ${f.colorId}` : ''}${offlineNote(`top:60:${f.timePeriod}:${f.minSize}:${f.colorId}`)}`;
    } else if (metaTab === 'ddb') {
      const decks = await ddbDecks();
      const rows = decks.filter(d => !q || `${d.title} ${d.commanders.join(' ')} ${d.section} ${d.colors.join('')}`.toLowerCase().includes(q));
      const sections = [...new Set(rows.map(d => d.section))];
      body.innerHTML = sections.map(sec => `<h3>${esc(sec || 'Other')}</h3>` + rows.filter(d => d.section === sec).map(d => `
        <div class="ddb-row">
          <div class="ddb-main"><b>${esc(d.title)}</b> <span class="muted">${esc(d.commanders.join(' + '))}</span> ${symbolize(d.colors.map(x => `{${x}}`).join(''))}
            <details><summary class="muted">About this deck · updated ${esc(d.updated)}</summary><p>${esc(d.description)}</p>
              <p>${d.lists.map(l => `<a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.name)}</a>`).join(' · ')}${d.discord ? ` · <a href="${esc(d.discord)}" target="_blank" rel="noopener">Discord</a>` : ''}</p>
              <p class="muted">The Moxfield lists can be imported with the Moxfield bookmarklet on the setup screen. The seat buttons load the newest EDHTop16 tournament list for these commanders.</p></details></div>
          <div class="seatpicks">${seatButtons(`edhtop16:${edhtop16Name(d.commanders)}`)}</div>
        </div>`).join('')).join('') || '<p class="muted">No decks match.</p>';
      $('metaStatus').textContent = `${decks.length} archetypes from the cEDH Decklist Database${offlineNote('ddb')}`;
    } else {
      // Trends (item 155): each commander's share and win rate in the last year, 6 months, 3 months and month (the
      // windows overlap, so a share higher in the month than the year means rising), and between saved visits
      const f = metaFilter();
      const W = [['ONE_YEAR', 'Year'], ['SIX_MONTHS', '6 mo'], ['THREE_MONTHS', '3 mo'], ['ONE_MONTH', 'Month']];
      const lists = [];
      for (const [p] of W) lists.push(await topCommanders({ count: 60, timePeriod: p, minSize: f.minSize, colorId: f.colorId }));
      const names = lists[3].slice(0, 25).map(c => c.name).filter(n => !q || n.toLowerCase().includes(q));
      const stat = (i, n) => lists[i].find(c => c.name === n);
      const hist = trendHistory('ONE_MONTH', f.minSize);
      // (a single-series sparkline: share in each window, oldest left; hover a point for its value)
      const spark = vals => {
        const pts = vals.map((v, i) => [6 + i * 26, v]).filter(p => p[1] != null);
        if (pts.length < 2) return '';
        const top = Math.max(...pts.map(p => p[1]), 0.001);
        const y = v => 26 - (v / top) * 20;
        return `<svg class="spark" width="96" height="30" viewBox="0 0 96 30" role="img" aria-label="Share by window"><polyline fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" points="${pts.map(([x, v]) => `${x},${y(v).toFixed(1)}`).join(' ')}"/>${pts.map(([x, v], i) => `<circle cx="${x}" cy="${y(v).toFixed(1)}" r="4" fill="currentColor"><title>${W[i]?.[1] || ''} ${(v * 100).toFixed(1)}%</title></circle>`).join('')}</svg>`;
      };
      const pc = v => (v == null ? '–' : `${(v * 100).toFixed(1)}%`);
      body.innerHTML = `<table class="trend"><thead><tr><th>Commander</th>${W.map(([, l]) => `<th class="num">${l}</th>`).join('')}<th>Share</th><th>Trend</th><th class="num">Win rate (month)</th><th class="num">Win rate (year)</th>${hist.length >= 2 ? '<th>Your visits</th>' : ''}<th>Load into seat</th></tr></thead><tbody>
        ${names.map(n => {
          const sh = W.map((_, i) => stat(i, n)?.metaShare ?? null);
          const ratio = sh[0] ? sh[3] / sh[0] : null;
          const trend = ratio == null ? '<span class="muted">new</span>' : ratio > 1.2 ? '▲ rising' : ratio < 0.8 ? '▼ falling' : '– steady';
          const visits = hist.map(s => s.top.find(t => t[0] === n)?.[1] ?? null);
          return `<tr><td>${esc(n)}</td>${sh.map(v => `<td class="num">${pc(v)}</td>`).join('')}<td>${spark(sh)}</td><td>${trend}</td>
            <td class="num">${pc(stat(3, n)?.winRate)}</td><td class="num">${pc(stat(0, n)?.winRate)}</td>${hist.length >= 2 ? `<td>${spark(visits)}</td>` : ''}<td class="seatpicks">${seatButtons(`edhtop16:${n}`)}</td></tr>`;
        }).join('')}</tbody></table>
        <p class="muted">Meta share in tournaments of ${f.minSize}+ players over the last year, 6 months, 3 months and month. The windows overlap, so a commander whose share in the month is well above its share over the year is rising.${hist.length >= 2 ? ` "Your visits" shows its monthly share on each day you opened this (${hist.length} days since ${esc(hist[0].day)}).` : ' Each day you open the meta browser a snapshot is kept, and a "Your visits" column appears from the second day.'}</p>`;
      $('metaStatus').textContent = `Top ${names.length} commanders of the last month${offlineNote(`top:60:ONE_MONTH:${f.minSize}:${f.colorId}`)}`;
    }
  } catch (e) {
    $('metaStatus').textContent = `Couldn't load: ${e.message}`;
  }
}
// The meta browser's EDHTop16 filters (time period, event size, exact color identity)
function metaFilter() {
  const colors = [...document.querySelectorAll('#metaFilters .color-pick input:checked')].map(x => x.value).join('');
  return { timePeriod: $('metaPeriod').value, minSize: +$('metaSize').value, colorId: colors };
}
const offlineNote = key => (offlineSince.has(key) ? ` · offline: saved copy from ${new Date(offlineSince.get(key)).toLocaleDateString()}` : '');
$('metaFilters').addEventListener('change', () => renderMeta());
function seatMeta(i, src) {
  Object.assign(seats[i], { source: src, deck: null, bracket: 5, style: ['human', 'remote'].includes(seats[i].style) ? seats[i].style : 'auto' });
  persist();
  renderSeats();
  $('metaStatus').textContent = `${src.replace(/^edhtop16:/, '')} goes into ${seats[i].name}'s seat. Close this and click "Load decks".`;
}
$('btnMeta').addEventListener('click', () => { $('metaModal').hidden = false; renderMeta(); });
// ---------- Collection (collection.js, item 147)
function showCollection(msg = '') {
  const s = collectionSummary();
  $('collectionSummary').innerHTML = (s ? `<b>${s.total}</b> cards (${s.unique} different), imported ${new Date(s.at).toLocaleDateString()}.` : 'No collection yet.') + (msg ? ` <span class="muted">${esc(msg)}</span>` : '');
  $('btnCollectionClear').hidden = !s;
}
$('btnCollection').addEventListener('click', () => { showCollection(); $('collectionModal').hidden = false; });
$('btnCollectionClose').addEventListener('click', () => { $('collectionModal').hidden = true; });
$('collectionFile').addEventListener('change', async e => { const f = /** @type {HTMLInputElement} */ (e.target).files?.[0]; if (f) $('collectionText').value = await f.text(); });
$('btnCollectionImport').addEventListener('click', () => {
  try {
    const s = importCollection($('collectionText').value, { replace: !$('collectionAdd').checked });
    $('collectionText').value = '';
    showCollection(`Imported: ${s.total} cards.`);
  } catch (err) { showCollection(err.message); }
});
$('btnCollectionClear').addEventListener('click', () => { if (confirm('Forget your collection?')) { clearCollection(); showCollection(); } });

// ---------- Commander precons (precons.js, item 146): by set, newest first
async function renderPrecons() {
  const q = $('preconSearch').value.trim().toLowerCase();
  $('preconStatus').textContent = 'Loading…';
  try {
    const list = await preconList();
    const rows = list.filter(d => !q || `${d.name} ${d.code} ${d.released}`.toLowerCase().includes(q));
    const sets = [...new Set(rows.map(d => d.code))];
    $('preconBody').innerHTML = sets.map(code => {
      const ds = rows.filter(d => d.code === code);
      return `<h3>${esc(code)} <span class="muted">${esc(ds[0].released.slice(0, 7))}</span></h3>${ds.map(d => `<div class="ddb-row"><div class="ddb-main"><b>${esc(d.name)}</b></div><div class="seatpicks">${seats.map((s, i) => `<button class="btn small preconseat" style="--pc:${s.color}" data-src="precon:${esc(d.file)}" data-name="${esc(d.name)}" data-seat="${i}" title="Put it in ${esc(s.name)}'s seat">${i + 1}</button>`).join('')}</div></div>`).join('')}`;
    }).join('') || '<p class="muted">No decks match.</p>';
    $('preconStatus').textContent = `${list.length} Commander precons${q ? `, ${rows.length} shown` : ''}`;
  } catch (e) { $('preconStatus').textContent = `Couldn't load the list from MTGJSON: ${e.message}`; }
}
$('btnPrecons').addEventListener('click', () => {
  // (precons are Commander decks: the table switches to Commander, as the cEDH meta browser does)
  if (formatKey !== 'commander') setFormat('commander');
  $('preconModal').hidden = false;
  renderPrecons();
});
$('btnPreconClose').addEventListener('click', () => { $('preconModal').hidden = true; });
$('preconSearch').addEventListener('input', () => renderPrecons());
$('preconBody').addEventListener('click', e => {
  const b = e.target.closest('.preconseat');
  if (!b) return;
  const i = +b.dataset.seat;
  Object.assign(seats[i], { source: b.dataset.src, deck: null, bracket: null });
  persist();
  renderSeats();
  $('preconStatus').textContent = `${b.dataset.name} goes into ${seats[i].name}'s seat. Close this and click "Load decks".`;
});
$('btnMetaClose').addEventListener('click', () => { $('metaModal').hidden = true; });
document.querySelectorAll('.meta-tabs button').forEach(b => b.addEventListener('click', () => {
  metaTab = b.dataset.mt;
  document.querySelectorAll('.meta-tabs button').forEach(x => x.classList.toggle('active', x === b));
  renderMeta();
}));
let metaTimer;
$('metaSearch').addEventListener('input', () => { clearTimeout(metaTimer); metaTimer = setTimeout(renderMeta, 200); });
$('metaBody').addEventListener('click', e => { const b = e.target.closest('.seatpick'); if (b) seatMeta(+b.dataset.seat, b.dataset.src); });
$('btnMetaTop4').addEventListener('click', async () => {
  const top = await topCommanders({ count: 60, ...metaFilter() });
  top.slice(0, 4).forEach((c, i) => Object.assign(seats[i], { source: `edhtop16:${c.name}`, deck: null, bracket: 5, style: ['human', 'remote'].includes(seats[i].style) ? seats[i].style : 'auto' }));
  persist();
  renderSeats();
  $('metaStatus').textContent = 'The four most-played cEDH commanders are seated. Close this and click "Load decks".';
});

// Four competitive (cEDH-style) decks; their pilots play the cEDH style automatically
$('btnCedh').addEventListener('click', () => {
  CEDH_PRESETS.forEach((d, i) => Object.assign(seats[i], { source: d.list, deck: null, style: seats[i].style === 'human' || seats[i].style === 'remote' ? seats[i].style : 'cedh' }));
  persist();
  renderSeats();
  $('setupStatus').textContent = 'cEDH decks seated with cEDH-style pilots. Click "Load decks & shuffle up".';
});
// One click: four random decks of the same bracket, then load them all
$('btnBracketTable').addEventListener('click', () => {
  const b = +$('tableBracket').value || 3;
  $('tableBracket').value = String(b);
  seats.forEach(s => Object.assign(s, { source: 'random', deck: null, bracket: b }));
  persist();
  renderSeats();
  $('setupStatus').textContent = `Dealing four bracket ${b} decks (${BRACKETS[b].name})…`;
  $('btnLoad').click();
});
$('btnAllRandom').addEventListener('click', () => {
  seats.forEach(s => { if (!s.source.trim()) { s.source = 'random'; s.deck = null; } });
  persist();
  renderSeats();
});
$('btnCloseZone').addEventListener('click', () => { els.zoneModal.hidden = true; });
els.zoneModal.addEventListener('click', e => { if (e.target === els.zoneModal) els.zoneModal.hidden = true; });
// (after a match: a new match with the decks as they were before sideboarding)
$('btnRematch').addEventListener('click', () => {
  $('results').hidden = true;
  // A puzzle, lesson or story chapter: the same board again (a new shuffle)
  if (setup?.puzzle) { newGame({ puzzle: setup.puzzle, puzzleDecks: setup.seats.map(s => s.deck), noLearning: true, format: setup.format, coach: setup.coach, after: setup.after }); return; }
  if (match) match = newMatch();
  newGame();
});
$('btnNextGame').addEventListener('click', () => { if (match && !matchOver(match)) nextMatchGame(); });
// Rematch with changes (item 131): the same seed with the decks rotated one seat along, or with any setup change
let nextSeed = null;
function takeNextSeed() { const s = nextSeed; nextSeed = null; return s; }
$('btnRotateDecks').addEventListener('click', () => {
  if (!setup || setup.puzzle || seats.some(s => !s.deck)) return;
  $('results').hidden = true;
  const decks = seats.map(s => { const a = /** @type {any} */ (s); return { deck: a.deck, source: a.source, rivalKey: a.rivalKey, rivalSource: a.rivalSource }; });
  seats.forEach((s, i) => Object.assign(s, decks[(i + decks.length - 1) % decks.length]));
  persist();
  renderSeats();
  if (match) match = newMatch();
  newGame({ seed: setup.seed });
});
$('btnSameSeed').addEventListener('click', () => {
  if (!setup) return;
  nextSeed = setup.seed;
  $('results').hidden = true;
  $('setup').hidden = false;
  $('setupStatus').textContent = `The next game uses the same seed (${setup.seed}): change seats, decks or pilots, then start.`;
});
// Format and match length on the setup screen
$('formatSel').innerHTML = Object.entries(FORMATS).map(([k, f]) => `<option value="${k}">${esc(f.name)}${f.seats === 2 ? ' (1 v 1)' : ''}</option>`).join('');
$('formatSel').addEventListener('change', e => setFormat(e.target.value));
$('tablePlayers').addEventListener('change', e => {
  prefs.tablePlayers = +e.target.value; store('ct.prefs', prefs);
  seats = allSeats.slice(0, seatCount());
  persist(); syncFormatUI(); renderSeats();
});
$('kingdomsMode').addEventListener('change', e => { prefs.kingdomsMode = e.target.value; store('ct.prefs', prefs); syncFormatUI(); renderSeats(); });
$('tableLife').addEventListener('change', e => { prefs.tableLife = +e.target.value; store('ct.prefs', prefs); });
$('bestOfSel').addEventListener('change', e => { prefs.bestOf = +e.target.value; store('ct.prefs', prefs); match = null; });
syncFormatUI();
renderSeats();
$('btnWatchReplay').addEventListener('click', () => { $('results').hidden = true; jumpTo(0); if (canRewind()) togglePlay(); });
$('btnChangeDecks').addEventListener('click', () => { $('results').hidden = true; $('btnDecks').click(); });

// ---------- batch mode: many games at full speed, then a win-rate report per deck
let batchStop = false;
$('btnBatch').addEventListener('click', () => {
  if (game && !clock.paused) togglePlay();
  $('batchModal').hidden = false;
});
$('btnBatchClose').addEventListener('click', () => { batchStop = true; $('batchModal').hidden = true; });
$('btnBatchStop').addEventListener('click', () => { batchStop = true; });
$('btnBatchRun').addEventListener('click', () => runBatch(false));
$('btnBatchTune').addEventListener('click', () => runBatch(true));

const seatStyle = s => (['auto', 'human', 'remote'].includes(s.style) ? learnedStyle(learnAs(s.deck)) || guessStyle(s.deck) : s.style);

// One game at full speed (AI pilots in every seat); null if the run was stopped
async function quickGame(styles) {
  const fast = { beat: async () => { if (batchStop) throw new Abort(); } };
  const g = new Game(seats.map((s, i) => ({ playerName: s.name || 'Player', deckName: s.deck.deckName, color: s.color, agent: new Agent(styles[i]), commanders: s.deck.commanders, learnAs: learnAs(s.deck), cards: s.deck.cards })), fast, { format: formatKey });
  await g.run();
  if (g.over) recordGame(g);
  return g.over ? g : null;
}

async function runBatch(tune) {
  const n = +$('batchCount').value;
  const status = t => { $('batchStatus').textContent = t; };
  $('btnBatchRun').disabled = $('btnBatchTune').disabled = true;
  $('btnBatchStop').hidden = false;
  $('batchBar').style.width = '0';
  batchStop = false;
  try {
    // Decks that haven't been loaded yet are fetched first (empty seats get random decks)
    for (const [i, s] of seats.entries()) {
      if (s.deck) continue;
      status(`Loading deck ${i + 1}…`);
      await loadSeatDeck(s, msg => status(`Seat ${i + 1}: ${msg}`));
    }
    if (tune) await tuneStyles(n, status);
    else await plainBatch(n, status);
  } catch (e) {
    status(`Batch failed: ${e.message}`);
  } finally {
    $('btnBatchRun').disabled = $('btnBatchTune').disabled = false;
    $('btnBatchStop').hidden = true;
  }
}

// Every seat tries every play style while the others keep theirs; the best one is suggested
async function tuneStyles(n, status) {
  const per = Math.max(5, Math.round(n / 4));
  const styles = Object.keys(STYLES);
  const wins = seats.map(() => Object.fromEntries(styles.map(s => [s, 0])));
  const total = seats.length * styles.length * per;
  let done = 0;
  for (const [i] of seats.entries()) {
    for (const st of styles) {
      for (let k = 0; k < per; k++) {
        const g = await quickGame(seats.map((s, j) => (j === i ? st : seatStyle(s))));
        if (!g) { status(`Stopped after ${done} games`); return renderTune(wins, per, styles, done < total); }
        if (g.winner?.idx === i) wins[i][st]++;
        done++;
        $('batchBar').style.width = `${(done / total) * 100}%`;
        status(`Tuning ${seats[i].name}: ${STYLES[st]} (${done} / ${total} games)`);
        if (done % 4 === 0) { renderTune(wins, per, styles, true); await sleep(0); }
      }
    }
  }
  renderTune(wins, per, styles, false);
  status(`Done: ${total} games`);
}

function renderTune(wins, per, styles, partial) {
  // No recommendation when every style did equally well (or equally badly)
  const best = wins.map(w => (new Set(styles.map(s => w[s])).size === 1 ? null : styles.reduce((a, b) => (w[b] > w[a] ? b : a), styles[0])));
  const rows = seats.map((s, i) => `<tr style="--pc:${s.color}"><td><span class="dot"></span>${esc(s.name)}</td>
    ${styles.map(st => `<td class="num ${best[i] === st ? 'best' : ''}">${Math.round((wins[i][st] / per) * 100)}%</td>`).join('')}
    <td>${best[i] ? esc(STYLES[best[i]]) : 'No difference'}</td></tr>`).join('');
  $('batchResults').innerHTML = `
    <p class="muted">Each seat played ${per} games with each style while the other seats kept theirs. Win rate per style:</p>
    <table><thead><tr><th>Seat</th>${styles.map(st => `<th class="num">${esc(STYLES[st])}</th>`).join('')}<th>Best</th></tr></thead><tbody>${rows}</tbody></table>
    ${partial ? '' : '<p><button class="btn primary" id="btnApplyStyles">Use the best styles</button> <span class="muted">Small samples are noisy; run more games for a firmer answer.</span></p>'}`;
  $('btnApplyStyles')?.addEventListener('click', () => {
    seats.forEach((s, i) => { if (best[i]) s.style = best[i]; });
    persist();
    renderSeats();
    $('batchStatus').textContent = 'Styles saved. They apply from the next new game.';
  });
}

async function plainBatch(n, status) {
  const stats = seats.map(s => ({ seat: s, wins: 0, place: 0, comboWins: 0, combos: 0, damage: 0, styles: {}, cards: new Map() }));
  const reasons = {}, losses = {};
  // cEDH-style statistics: when games end, how much interaction gets cast, which combos land
  const meta = { winRounds: [], interaction: 0, combos: {} };
  let rounds = 0, played = 0, errors = 0;
  for (let k = 0; k < n && !batchStop; k++) {
    const g = await quickGame(seats.map(seatStyle));
    if (!g) break;
    played++;
    rounds += g.round;
    if (g.logEntries.some(e => e.html.startsWith('Simulator error'))) errors++;
    const why = g.winReason || 'draw';
    reasons[why] = (reasons[why] || 0) + 1;
    if (g.winner) meta.winRounds.push(g.round);
    for (const c of g.comboLog) {
      const m = meta.combos[c.label] ||= { tried: 0, landed: 0, won: 0 };
      m.tried++;
      if (c.landed) { m.landed++; if (g.winner?.idx === c.p) m.won++; }
    }
    g.players.forEach((p, i) => {
      const st = stats[i];
      meta.interaction += p.stats.interaction || 0;
      st.interaction = (st.interaction || 0) + (p.stats.interaction || 0);
      st.place += p.place || 4;
      st.combos += p.stats.combos;
      st.damage += p.stats.damage;
      st.styles[p.style] = 1;
      if (g.winner === p) { st.wins++; if (p.stats.combos) st.comboWins++; }
      // Which cards show up in this deck's wins
      for (const name of p.castNames) {
        const c = st.cards.get(name) || { games: 0, wins: 0 };
        c.games++;
        if (g.winner === p) c.wins++;
        st.cards.set(name, c);
      }
      if (p.lost) {
        // Group "21 combat damage from Atraxa" and "X won with A + B" into general reasons
        const r = p.lossReason.replace(/ from .*$/, '').replace(/^.* won with .*$/, "an opponent's combo");
        losses[r] = (losses[r] || 0) + 1;
      }
    });
    $('batchBar').style.width = `${(played / n) * 100}%`;
    status(`${played} / ${n} games`);
    if (played % 2 === 0 || played === n) renderBatch(stats, reasons, losses, played, rounds, errors, meta);
    await sleep(0);
  }
  renderBatch(stats, reasons, losses, played, rounds, errors, meta);
  status(batchStop ? `Stopped after ${played} games` : `Done: ${played} games`);
  if (played) for (const st of stats) lastCardStats.set(st.seat.deck.deckName, { base: st.wins / played, played, cards: st.cards });
}

// Cards whose games this deck wins much more (or less) often than its overall win rate
function cardReport(st, played) {
  const base = st.wins / played;
  const min = Math.max(3, Math.round(played * 0.1));
  const rows = [...st.cards.entries()].filter(([, c]) => c.games >= min)
    .map(([name, c]) => ({ name, games: c.games, rate: c.wins / c.games, lift: c.wins / c.games - base }));
  if (rows.length < 4) return '<p class="muted">Not enough games yet to rank cards.</p>';
  const li = r => `<li><span class="cn">${esc(r.name)}</span>: won ${Math.round(r.rate * 100)}% of ${r.games} games where it was cast (${r.lift >= 0 ? '+' : ''}${Math.round(r.lift * 100)} points)</li>`;
  const sorted = rows.sort((a, b) => b.lift - a.lift);
  return `<div class="cardrep"><div><h4>Shows up in wins</h4><ul>${sorted.slice(0, 5).map(li).join('')}</ul></div>
    <div><h4>Wins least often</h4><ul>${sorted.slice(-5).reverse().map(li).join('')}</ul></div></div>`;
}

function metaStats(meta, played) {
  if (!meta) return '';
  const w = [...meta.winRounds].sort((a, b) => a - b);
  const avg = w.length ? w.reduce((a, b) => a + b, 0) / w.length : 0;
  const median = w.length ? w[Math.floor(w.length / 2)] : 0;
  const fast = w.filter(r => r <= 4).length;
  const combos = Object.entries(meta.combos).sort((a, b) => b[1].tried - a[1].tried).slice(0, 10);
  return `<h3>Game speed and interaction</h3>
    <ul><li>Average win on round <b>${avg.toFixed(1)}</b> (median ${median})${w.length ? `; ${Math.round((fast / w.length) * 100)}% of wins by round 4` : ''}</li>
      <li><b>${(meta.interaction / played).toFixed(1)}</b> interaction spells per game (counters, removal, bounce, wipes, Silence effects): ${(meta.interaction / played / 4).toFixed(1)} per player</li>
      <li>${w.length < played ? `${played - w.length} game${played - w.length === 1 ? '' : 's'} ended without a winner` : 'Every game had a winner'}</li></ul>
    ${combos.length ? `<h3>Combos</h3><table><thead><tr><th>Combo</th><th class="num">Attempts</th><th class="num">Landed</th><th class="num">Won the game</th></tr></thead><tbody>
      ${combos.map(([label, m]) => `<tr><td>${esc(label)}</td><td class="num">${m.tried}</td><td class="num">${m.landed} (${Math.round((m.landed / m.tried) * 100)}%)</td><td class="num">${m.won}</td></tr>`).join('')}</tbody></table>
      <p class="muted">An attempt that didn't land was countered, had a piece removed, or ran out of mana.</p>` : ''}`;
}

function renderBatch(stats, reasons, losses, played, rounds, errors, meta) {
  if (!played) { $('batchResults').innerHTML = ''; return; }
  const rows = [...stats].sort((a, b) => b.wins - a.wins).map(st => {
    const pct = (st.wins / played) * 100;
    return `<tr style="--pc:${st.seat.color}">
      <td><span class="dot"></span>${esc(st.seat.name)}</td>
      <td title="${esc(st.seat.deck.deckName)}">${esc(st.seat.deck.deckName.slice(0, 34))}</td>
      <td>${Object.keys(st.styles).map(k => STYLES[k] || k).join(', ')}</td>
      <td class="num">${st.wins}</td>
      <td><span class="bar" style="width:${Math.max(2, pct * 1.2)}px"></span>${pct.toFixed(0)}%</td>
      <td class="num">${(st.place / played).toFixed(2)}</td>
      <td class="num">${st.comboWins}</td>
      <td class="num">${Math.round(st.damage / played)}</td>
    </tr>`;
  }).join('');
  const list = obj => Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `<li>${esc(k)}: <b>${v}</b></li>`).join('');
  $('batchResults').innerHTML = `
    <table>
      <thead><tr><th>Seat</th><th>Deck</th><th>Style</th><th class="num">Wins</th><th>Win rate</th><th class="num">Avg place</th><th class="num">Combo wins</th><th class="num">Dmg / game</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p class="muted">${played} games · average length ${(rounds / played).toFixed(1)} rounds${errors ? ` · ${errors} hit a simulator error` : ''}</p>
    ${metaStats(meta, played)}
    <h3>How games were won</h3><ul>${list(reasons)}</ul>
    <h3>How players were eliminated</h3><ul>${list(losses)}</ul>
    <h3>Card performance</h3>
    <p class="muted">Compared with each deck's overall win rate. Cards cast in fewer than ${Math.max(3, Math.round(played * 0.1))} games aren't ranked. This shows correlation, not cause.</p>
    ${stats.map(st => `<details style="--pc:${st.seat.color}"><summary><span class="dot"></span>${esc(st.seat.name)}: ${esc(st.seat.deck.deckName)}</summary>${cardReport(st, played)}</details>`).join('')}`;
}

// ---------- deck viewer: curve, colors, types, what the simulator understands, batch suggestions
const lastCardStats = new Map(); // deck name → { base, played, cards } from the latest batch run
$('seats').addEventListener('click', e => {
  const b = e.target.closest('.sview, .sedit');
  if (b) (b.classList.contains('sedit') ? openEditor : i => showDeck(seats[i]))(+b.dataset.i);
});
$('btnDeckClose').addEventListener('click', () => { $('deckModal').hidden = true; });

// ---------- deck editor: change a seat's list and re-test straight away
let editSeat = null;
function openEditor(i) {
  const s = seats[i];
  editSeat = i;
  $('editTitle').textContent = `Edit deck: ${s.deck?.deckName || s.name}`;
  $('editText').value = s.deck ? deckText(s.deck) : s.source;
  $('editName').value = s.deck?.deckName || '';
  $('editStatus').textContent = '';
  editCount();
  $('editModal').hidden = false;
}
function editCount() {
  const n = parseText($('editText').value, { commander: fmt().commander }).entries.filter(e => !e.side).reduce((a, e) => a + e.qty, 0);
  const f = fmt();
  const off = f.exact ? n !== f.deck : n < f.deck;
  $('editCount').textContent = `${n} cards${off ? ` (${f.name} decks have ${f.exact ? 'exactly' : 'at least'} ${f.deck})` : ''}${f.sideboard ? '. Put sideboard cards under a "Sideboard" heading' : ''}.`;
}
$('editText').addEventListener('input', editCount);
$('btnEditClose').addEventListener('click', () => { $('editModal').hidden = true; });
// Card names as you type, from Scryfall's free autocomplete
let suggestTimer;
$('editSearch').addEventListener('input', e => {
  clearTimeout(suggestTimer);
  const q = e.target.value.trim();
  if (q.length < 3) return;
  suggestTimer = setTimeout(async () => {
    try { $('editSuggest').innerHTML = (await sf(`/cards/autocomplete?q=${encodeURIComponent(q)}`)).data.slice(0, 15).map(n => `<option value="${esc(n)}">`).join(''); } catch { /* offline: type the full name */ }
  }, 250);
});
function addCard() {
  const name = $('editSearch').value.trim();
  if (!name) return;
  const lines = $('editText').value.split('\n');
  // Add under the "Deck" heading if there is one, otherwise at the end
  const at = lines.findIndex(l => /^\s*(deck|main ?deck|mainboard)\s*$/i.test(l));
  if (at >= 0) lines.splice(at + 1, 0, `1 ${name}`); else lines.push(`1 ${name}`);
  $('editText').value = lines.join('\n');
  $('editSearch').value = '';
  editCount();
  $('editStatus').textContent = `Added ${name}.`;
}
$('btnEditAdd').addEventListener('click', addCard);
$('editSearch').addEventListener('keydown', e => { if (e.key === 'Enter') addCard(); });
async function applyEdit() {
  if (editSeat == null) return false;
  const s = seats[editSeat];
  s.source = $('editText').value;
  s.deck = null;
  persist();
  try {
    await loadSeatDeck(s, msg => { $('editStatus').textContent = msg; });
    $('editStatus').textContent = `Applied: ${s.deck.deckName}${s.deck.warnings.length ? ` (${s.deck.warnings[0]})` : ''}`;
    renderSeats();
    return true;
  } catch (err) {
    $('editStatus').textContent = `Couldn't load the list: ${err.message}`;
    return false;
  }
}
$('btnEditApply').addEventListener('click', applyEdit);
$('btnEditTest').addEventListener('click', async () => {
  if (!(await applyEdit())) return;
  $('editModal').hidden = true;
  // Every seat needs a deck before a batch can run
  if (game && !clock.paused) togglePlay();
  $('batchCount').value = '10';
  $('batchModal').hidden = false;
  runBatch(false);
});
$('btnEditSave').addEventListener('click', async () => {
  const name = $('editName').value.trim() || seats[editSeat]?.deck?.deckName || 'My deck';
  try { $('editStatus').textContent = `Saved to your library as "${await saveDeck(name, $('editText').value)}".`; } catch (err) { $('editStatus').textContent = `Couldn't save: ${err.message}`; }
});

// ---------- puzzles: a set board and one turn to win
function renderPuzzles() {
  $('puzzleList').innerHTML = BUILT_IN.map((pz, i) => `<div class="standing" style="--pc:${SEAT_COLORS[i % 4]}"><div class="meta"><b>${esc(pz.name)}</b><br>${esc(pz.hint || pz.goal)}</div><button class="btn small primary" data-pz="${i}">Play</button></div>`).join('');
}
// extra: newGame options (a lesson's coach and after step, a chapter's); say: where to show progress
async function startPuzzle(pz, extra = {}, say = t => { $('puzzleStatus').textContent = t; }) {
  if (!validPuzzle(pz)) throw new Error("That isn't a Commander Table puzzle");
  const format = FORMATS[pz.format] ? pz.format : 'commander';
  const decks = [];
  for (const [i, spec] of pz.players.entries()) {
    say(`Loading ${spec.name || `player ${i + 1}`}'s cards…`);
    decks.push(await loadDeck(puzzleDeckText(spec), () => {}, { format }));
  }
  say('');
  for (const id of ['puzzleModal', 'setup', 'learnModal', 'storyModal']) if ($(id)) $(id).hidden = true;
  match = null;
  newGame({ puzzle: pz, puzzleDecks: decks, noLearning: true, format, ...extra });
}
$('btnPuzzles').addEventListener('click', () => { renderPuzzles(); $('puzzleModal').hidden = false; });
$('btnPuzzleClose').addEventListener('click', () => { $('puzzleModal').hidden = true; });
$('puzzleList').addEventListener('click', e => {
  const b = e.target.closest('[data-pz]');
  if (b) startPuzzle(BUILT_IN[+b.dataset.pz]).catch(err => { $('puzzleStatus').textContent = `Couldn't start it: ${err.message}`; });
});
$('btnPuzzleLoad').addEventListener('click', () => $('puzzleFile').click());
// ---------- Puzzle editor (item 130): build a board as text, test it, save it as a file or a challenge link
const PE_ZONES = [['battlefield', 'Battlefield'], ['hand', 'Hand'], ['graveyard', 'Graveyard'], ['libraryTop', 'Top of library (first line on top)']];
function peLine(e) { return typeof e === 'string' ? e : `${e.name}${e.tapped ? ' *tapped*' : ''}${e.counters ? ` (+${e.counters})` : ''}`; }
function peRender(pz) {
  $('peName').value = pz.name || 'My puzzle';
  $('peGoal').value = pz.goal || 'win this turn';
  $('peHint').value = pz.hint || '';
  $('pePlayers').value = String(pz.players.length);
  $('pePlayersBox').innerHTML = pz.players.map((p, i) => `<div class="pe-player" data-i="${i}">
    <div class="pe-row"><input class="input pe-pname" value="${esc(p.name || (i ? `Opponent ${i}` : 'You'))}" title="Player name"><input class="input pe-cmd" value="${esc(p.commander || '')}" placeholder="Commander" title="Commander"><input class="input pe-life" type="number" value="${p.life ?? ''}" placeholder="Life" title="Life (empty: the format's starting life)"><label class="pe-cob"><input type="checkbox" class="pe-cob-in" ${p.commanderOnBattlefield ? 'checked' : ''}> commander out</label></div>
    ${PE_ZONES.map(([z, label]) => `<label class="pe-zone">${label}<textarea class="input pe-z" data-z="${z}" rows="3">${esc((p[z] || []).map(peLine).join('\n'))}</textarea></label>`).join('')}</div>`).join('');
}
function peRead() {
  const parse = line => {
    const m = line.trim().match(/^(.+?)(\s*\*tapped\*)?(?:\s*\(\+(\d+)\))?$/);
    if (!m || !m[1].trim()) return null;
    return m[2] || m[3] ? { name: m[1].trim(), ...(m[2] ? { tapped: true } : {}), ...(m[3] ? { counters: +m[3] } : {}) } : m[1].trim();
  };
  const players = [...$('pePlayersBox').querySelectorAll('.pe-player')].map(el => {
    const p = { name: el.querySelector('.pe-pname').value.trim() || 'Player', commander: el.querySelector('.pe-cmd').value.trim() };
    const life = el.querySelector('.pe-life').value;
    if (life !== '') p.life = +life;
    if (el.querySelector('.pe-cob-in').checked) p.commanderOnBattlefield = true;
    for (const ta of el.querySelectorAll('.pe-z')) {
      const list = ta.value.split('\n').map(parse).filter(Boolean);
      if (list.length) p[ta.dataset.z] = ta.dataset.z === 'battlefield' ? list : list.map(x => (typeof x === 'string' ? x : x.name));
    }
    return p;
  });
  return { app: 'commander-table-puzzle', name: $('peName').value.trim() || 'Puzzle', goal: $('peGoal').value.trim() || 'win this turn', ...($('peHint').value.trim() ? { hint: $('peHint').value.trim() } : {}), players };
}
const PE_START = { name: 'My puzzle', goal: 'win this turn', players: [{ name: 'You', commander: 'Krenko, Tin Street Kingpin', battlefield: ['Mountain', 'Mountain', 'Mountain'], hand: ['Lightning Bolt'] }, { name: 'Opponent', commander: 'Kenrith, the Returned King', life: 3, battlefield: ['Plains'] }] };
$('btnPuzzleEdit').addEventListener('click', () => { peRender(store('ct.puzzleDraft') || PE_START); $('peStatus').textContent = ''; $('puzzleEditModal').hidden = false; });
$('btnPeClose').addEventListener('click', () => { store('ct.puzzleDraft', peRead()); $('puzzleEditModal').hidden = true; });
$('pePlayers').addEventListener('change', () => {
  const pz = peRead(), n = +$('pePlayers').value;
  while (pz.players.length < n) pz.players.push({ name: `Opponent ${pz.players.length}`, commander: 'Kenrith, the Returned King', battlefield: [] });
  pz.players.length = n;
  peRender(pz);
});
$('btnPeFromBoard').addEventListener('click', () => {
  if (!game) { $('peStatus').textContent = 'No game on the table to copy.'; return; }
  peRender({ ...boardToPuzzle(game, $('peName').value || 'Board'), name: $('peName').value || 'Board' });
});
$('btnPeTest').addEventListener('click', async () => {
  const pz = peRead();
  store('ct.puzzleDraft', pz);
  if (!validPuzzle(pz)) { $('peStatus').textContent = 'Every player needs a commander (and 2 to 4 players).'; return; }
  try { await startPuzzle(pz, {}, t => { $('peStatus').textContent = t; }); $('puzzleEditModal').hidden = true; } catch (err) { $('peStatus').textContent = `Couldn't start it: ${err.message}`; }
});
$('btnPeSave').addEventListener('click', () => { const pz = peRead(); store('ct.puzzleDraft', pz); download(`${pz.name.replace(/[^\w -]+/g, '').trim() || 'puzzle'}.json`, JSON.stringify(pz, null, 1)); });
$('btnPeLink').addEventListener('click', async () => {
  const pz = peRead();
  const link = challengeLink(await encodeChallenge({ puzzle: pz }));
  try { await navigator.clipboard.writeText(link); $('peStatus').textContent = 'Challenge link copied: it opens this puzzle on any PC running Commander Table.'; } catch { $('peStatus').textContent = link; }
});
$('puzzleFile').addEventListener('change', async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try { await startPuzzle(JSON.parse(await file.text())); } catch (err) { $('puzzleStatus').textContent = `Couldn't load it: ${err.message}`; }
});
// The whole game as one web page that plays it back anywhere (re-simulated from its seed and answers)
$('btnShareReplay').addEventListener('click', async () => {
  if (!setup) return;
  const b = $('btnShareReplay');
  b.disabled = true;
  try {
    const html = await buildReplayHtml(setup, t => { $('tlLabel').textContent = t; });
    download(`commander-replay-${stamp()}.html`, html, 'text/html');
    $('tlLabel').textContent = 'Replay page saved: open it in any browser, or send it to someone';
  } catch (err) {
    $('tlLabel').textContent = `Couldn't build the replay page: ${err.message}`;
  }
  b.disabled = false;
});
$('btnSavePuzzle').addEventListener('click', () => {
  if (!game) return;
  const name = prompt('Name this puzzle', `Board from turn ${game.turn}`);
  if (name == null) return;
  download(`commander-puzzle-${stamp()}.json`, JSON.stringify(boardToPuzzle(game, name), null, 1));
});

// ---------- draft and sealed pods
// duel: one on one, best of three (Limited format: 40 cards, 20 life, the rest of the pool as sideboard);
// otherwise a four-player Commander pod. Packs come from a set (Scryfall) or from a saved cube.
const LIM = { pool: [], pools: [], chosen: new Set(), commander: null, colors: null, set: '', label: '', duel: true };
$('limSet').innerHTML = SUGGESTED_SETS.map(([c, n]) => `<option value="${c}">${esc(n)} (${c.toUpperCase()})</option>`).join('');
$('btnLimited').addEventListener('click', () => { renderCubes(); $('limitedModal').hidden = false; });
$('btnLimitedClose').addEventListener('click', () => { $('limitedModal').hidden = true; });
const limCard = (c, cls = '') => `<div class="lim-card ${cls}" data-name="${esc(c.name)}" title="${esc(c.name)}">${c.imgNormal || c.imgSmall ? `<img src="${esc(c.imgNormal || c.imgSmall)}" alt="${esc(c.name)}" loading="lazy">` : ''}<span class="lim-name">${esc(c.name)}</span></div>`;

// Saved cubes (kept in the game folder's browser profile): { name, cards: [names], source }
const cubes = () => store('ct.cubes') || [];
function renderCubes(sel) {
  const list = cubes();
  $('limCube').innerHTML = list.map((c, i) => `<option value="${i}" ${c.name === sel ? 'selected' : ''}>${esc(c.name)} (${c.cards.length} cards)</option>`).join('') || '<option value="">(no saved cubes yet)</option>';
}
document.querySelectorAll('input[name="limSource"]').forEach(r => r.addEventListener('change', () => {
  const cube = document.querySelector('input[name="limSource"]:checked').value === 'cube';
  $('limSetWrap').hidden = cube; $('limCubeWrap').hidden = !cube; $('limCubeAdd').hidden = !cube;
  renderCubes();
}));
$('btnCubeSave').addEventListener('click', async () => {
  const say = t => { $('limStatus').textContent = t; };
  const link = $('cubeLink').value.trim();
  let text = $('cubeText').value;
  let name = $('cubeName').value.trim();
  try {
    if (link) {
      // CubeCobra's public plain-text list, through the local server (CubeCobra doesn't allow browser requests)
      const id = (link.match(/cubecobra\.com\/cube\/(?:list|overview|playtest|about|api\/cubelist)\/([^/?#\s]+)/i) || [, link.match(/^[\w-]+$/) ? link : null])[1];
      if (!id) throw new Error('That isn\'t a CubeCobra link or cube ID.');
      say(`Downloading cube ${id} from CubeCobra…`);
      const r = await fetch('/api/fetch?url=' + encodeURIComponent(`https://cubecobra.com/cube/api/cubelist/${encodeURIComponent(id)}`));
      if (!r.ok) throw new Error(r.status === 404 ? 'CubeCobra doesn\'t know that cube.' : `CubeCobra answered ${r.status}.`);
      text = await r.text();
      if (/<html/i.test(text)) throw new Error('CubeCobra sent a web page instead of a card list.');
      name ||= id;
    }
    const names = [...new Set(cubeNames(text))];
    if (names.length < 45) throw new Error(`A cube needs at least 45 different cards (this one has ${names.length}).`);
    name ||= `Cube of ${names.length}`;
    const list = cubes().filter(c => c.name !== name);
    list.push({ name, cards: names, source: link || 'pasted' });
    store('ct.cubes', list);
    renderCubes(name);
    $('cubeLink').value = ''; $('cubeText').value = ''; $('cubeName').value = '';
    say(`Saved "${name}" (${names.length} cards).`);
  } catch (err) { say(`Couldn't save the cube: ${err.message}`); }
});
$('btnCubeDelete').addEventListener('click', () => {
  const list = cubes();
  const i = +$('limCube').value;
  if (!list[i]) return;
  const [gone] = list.splice(i, 1);
  store('ct.cubes', list);
  renderCubes();
  $('limStatus').textContent = `Removed "${gone.name}".`;
});
// A cube's cards from Scryfall (by name; cards it doesn't know are skipped and reported)
async function cubePool(cube, say) {
  say(`Loading ${cube.cards.length} cube cards from Scryfall…`);
  const { cards, key } = await fetchCollection(cube.cards.map(name => ({ name })), (a, b) => say(`Loading cube cards ${a}/${b}…`));
  const pool = cube.cards.map(name => cards.get(key({ name }))).filter(Boolean);
  const missing = cube.cards.length - pool.length;
  return { pool, note: missing ? ` (${missing} card name${missing === 1 ? '' : 's'} Scryfall didn't know were left out)` : '' };
}

$('btnLimitedGo').addEventListener('click', async () => {
  const mode = document.querySelector('input[name="limMode"]:checked').value;
  const fromCube = document.querySelector('input[name="limSource"]:checked').value === 'cube';
  LIM.duel = document.querySelector('input[name="limPlay"]:checked').value === 'duel';
  const say = t => { $('limStatus').textContent = t; };
  $('btnLimitedGo').disabled = true;
  $('limitedFoot').hidden = true;
  $('limitedBody').innerHTML = '';
  try {
    let pool, packFn, note = '';
    if (fromCube) {
      const cube = cubes()[+$('limCube').value];
      if (!cube) throw new Error('Save a cube first (a CubeCobra link or a pasted list).');
      ({ pool, note } = await cubePool(cube, say));
      // Every card at most once per draft: packs are dealt from the shuffled cube
      let deal = null;
      packFn = (p, rand) => (deal ||= cubePacker(p, rand))();
      await loadRatings('cube');   // (no ratings for cubes: clears the last set's)
      const need = 4 * (mode === 'sealed' ? 6 : 3) * 15;
      if (pool.length < need) note += ` · the cube has ${pool.length} cards, fewer than the ${need} this needs, so the last packs are short`;
      LIM.set = 'cube'; LIM.label = cube.name;
    } else {
      const code = ($('limCode').value.trim() || $('limSet').value).toLowerCase();
      pool = await setPool(code, say);
      // Real pack contents from MTGJSON's booster sheets when it has them (Commander pods still get a
      // legendary creature in every pack); otherwise the fixed layout
      const sheets = await boosterData(code, say);
      packFn = sheets ? await boosterPacker(sheets, pool, { legend: !LIM.duel }) : makePack;
      const ratings = await loadRatings(code);
      note = (sheets ? ` (packs as in real ${sheets.name.replace(/\s*boosters?\b.*$/i, '').replace(/ (Play|Draft|Set)$/, m => m.toLowerCase())} boosters, from MTGJSON)` : ' (MTGJSON has no booster contents for this set, so packs are 1 rare, 1 legend, 3 uncommons and 9 commons)')
        + (ratings ? ` · AI picks use card win rates from 17Lands public data (${ratings.games.toLocaleString()} games, CC BY 4.0)` : '');
      LIM.set = code; LIM.label = code.toUpperCase();
    }
    const seed = Math.floor(Math.random() * 2 ** 32);
    if (mode === 'sealed') {
      LIM.pools = sealedPools(pool, 4, seed, packFn);
    } else {
      // You pick by clicking a card in each pack; the AI drafters pick for the other three seats
      LIM.pools = await runDraft(pool, 4, seed, 0, (seat, pack, picks) => new Promise(res => {
        say(`Pick a card (${picks.length} picked so far)`);
        $('limitedBody').innerHTML = `<p class="muted">Click the card you want. The rest of the pack goes to the next player.</p><div class="lim-grid">${pack.map(c => limCard(c)).join('')}</div>
          ${picks.length ? `<p class="muted">Your picks: ${picks.map(c => esc(c.name)).join(', ')}</p>` : ''}`;
        $('limitedBody').onclick = e => { const el = e.target.closest('.lim-card'); if (!el) return; $('limitedBody').onclick = null; res(pack.find(c => c.name === el.dataset.name)); };
      }), say, packFn);
    }
    LIM.pool = LIM.pools[0];
    if (LIM.duel) {
      const auto = buildLimited(LIM.pool);
      LIM.colors = auto.colors;
      LIM.commander = null;
      LIM.chosen = new Set(auto.cards.map(c => c.name));
      say(`Your pool: ${LIM.pool.length} cards${note}. Click cards to add or remove them, choose your colors, or use Auto-build. The rest of the pool is your sideboard.`);
    } else {
      const auto = buildDeck(LIM.pool);
      LIM.commander = auto?.commander || null;
      LIM.chosen = new Set(auto ? auto.cards.map(c => c.name) : []);
      say(`Your pool: ${LIM.pool.length} cards${note}. Click cards to add or remove them, pick your commander, or use Auto-build.${LIM.commander ? '' : ' Your pool has no legendary creature, so it can only be played one on one.'}`);
    }
    renderLimited();
  } catch (err) {
    say(`Couldn't open packs: ${err.message}`);
  }
  $('btnLimitedGo').disabled = false;
});
// Color choices for one-on-one decks: the five colors and the ten pairs
const COLOR_CHOICES = (() => {
  const C = ['W', 'U', 'B', 'R', 'G'];
  const out = C.map(c => [c]);
  for (let i = 0; i < 5; i++) for (let j = i + 1; j < 5; j++) out.push([C[i], C[j]]);
  return out;
})();
function renderLimited() {
  $('limCommanderWrap').hidden = LIM.duel;
  $('limColorsWrap').hidden = !LIM.duel;
  let legal;
  if (LIM.duel) {
    $('limColors').innerHTML = COLOR_CHOICES.map(cs => `<option value="${cs.join('')}" ${cs.join('') === (LIM.colors || []).join('') ? 'selected' : ''}>${cs.map(c => ({ W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green' })[c]).join('-')}</option>`).join('');
    // Any card can go in (splashes are your call); the colors only steer Auto-build and the basic lands
    legal = () => true;
  } else {
    const legends = LIM.pool.filter(c => /legendary/i.test(c.typeLine) && /creature/i.test(c.typeLine));
    $('limCommander').innerHTML = legends.map(c => `<option ${c === LIM.commander ? 'selected' : ''}>${esc(c.name)}</option>`).join('') || '<option>(no legendary creature)</option>';
    const ci = LIM.commander?.colorIdentity || [];
    legal = c => (c.colorIdentity || []).every(col => ci.includes(col));
  }
  const sorted = [...LIM.pool].sort((a, b) => Number(LIM.chosen.has(b.name)) - Number(LIM.chosen.has(a.name)) || (a.cmc || 0) - (b.cmc || 0));
  $('limitedBody').innerHTML = `<div class="lim-grid">${sorted.map(c => limCard(c, c === LIM.commander ? 'cmdr' : LIM.chosen.has(c.name) ? 'on' : legal(c) ? '' : 'off')).join('')}</div>`;
  $('limitedBody').onclick = e => {
    const el = e.target.closest('.lim-card');
    if (!el) return;
    const c = LIM.pool.find(x => x.name === el.dataset.name);
    if (!c || c === LIM.commander || !legal(c)) return;
    if (LIM.chosen.has(c.name)) LIM.chosen.delete(c.name); else LIM.chosen.add(c.name);
    renderLimited();
  };
  $('limCount').textContent = LIM.duel
    ? `${LIM.chosen.size} cards chosen; ${Math.max(0, DECK_SIZE - LIM.chosen.size)} basic lands will be added; ${LIM.pool.length - LIM.chosen.size} in the sideboard`
    : `${LIM.chosen.size} cards chosen + commander; ${Math.max(0, DECK_SIZE - 1 - LIM.chosen.size)} basic lands will be added`;
  $('btnLimSeat').disabled = !LIM.duel && !LIM.commander;
  $('limitedFoot').hidden = false;
}
$('limCommander').addEventListener('change', e => {
  LIM.commander = LIM.pool.find(c => c.name === e.target.value) || LIM.commander;
  const ci = LIM.commander.colorIdentity || [];
  for (const n of [...LIM.chosen]) { const c = LIM.pool.find(x => x.name === n); if (!c || c === LIM.commander || !(c.colorIdentity || []).every(col => ci.includes(col))) LIM.chosen.delete(n); }
  renderLimited();
});
$('limColors').addEventListener('change', e => {
  LIM.colors = [...e.target.value];
  LIM.chosen = new Set(buildLimited(LIM.pool, LIM.colors).cards.map(c => c.name));
  renderLimited();
});
$('btnLimAuto').addEventListener('click', () => {
  if (LIM.duel) LIM.chosen = new Set(buildLimited(LIM.pool, LIM.colors).cards.map(c => c.name));
  else { const d = buildDeck(LIM.pool, LIM.commander); if (d) LIM.chosen = new Set(d.cards.map(c => c.name)); }
  renderLimited();
});
$('btnLimSeat').addEventListener('click', () => {
  const label = LIM.label;
  if (LIM.duel) {
    // One on one in the Limited format: your deck in seat 1, the strongest AI drafter's deck in seat 2
    const cards = LIM.pool.filter(c => LIM.chosen.has(c.name));
    const colors = LIM.colors?.length ? LIM.colors : buildLimited(LIM.pool).colors;
    setFormat('limited', { quiet: true });
    prefs.bestOf = 3; store('ct.prefs', prefs); syncFormatUI();
    seats[0].source = limitedText({ cards, colors }, LIM.pool, `${label} ${colors.join('')}`);
    seats[0].deck = null;
    const rivals = LIM.pools.slice(1).map(p => ({ p, d: buildLimited(p) })).map(x => ({ ...x, v: x.d.cards.reduce((a, c) => a + (c.fx.type.land ? 0 : 1), 0) }));
    const rival = rivals.sort((a, b) => b.v - a.v)[0];
    Object.assign(seats[1], { source: limitedText(rival.d, rival.p, `${label} ${rival.d.colors.join('')} (AI)`), deck: null, style: ['human', 'remote'].includes(seats[1].style) ? seats[1].style : 'auto' });
    persist();
    renderSeats();
    $('limitedModal').hidden = true;
    $('setupStatus').textContent = `Your ${label} deck is in seat 1 and an AI drafter's deck from the same packs in seat 2, best of three with your pools as sideboards. Set seat 1 to "You play this seat" to play it, then click "Load decks & shuffle up".`;
    return;
  }
  if (!LIM.commander) return;
  const mine = { commander: LIM.commander, cards: LIM.pool.filter(c => LIM.chosen.has(c.name) && c !== LIM.commander).slice(0, DECK_SIZE - 1) };
  setFormat('commander', { quiet: true });
  seats[0].source = limitedDeckText(mine, `${label} pod: ${LIM.commander.name}`);
  seats[0].deck = null;
  for (let i = 1; i < 4; i++) {
    const d = buildDeck(LIM.pools[i]);
    if (!d) continue;
    Object.assign(seats[i], { source: limitedDeckText(d, `${label} pod: ${d.commander.name}`), deck: null, style: ['human', 'remote'].includes(seats[i].style) ? seats[i].style : 'auto' });
  }
  persist();
  renderSeats();
  $('limitedModal').hidden = true;
  $('setupStatus').textContent = `Your ${label} deck is in seat 1 and three AI decks from the same packs in the others. Set seat 1 to "You play this seat" if you want to play it, then click "Load decks & shuffle up".`;
});

// ---------- deck library (data\decks)
let libraryDecks = [];
async function renderLibrary() {
  const body = $('libraryBody');
  try { libraryDecks = await listDecks(); } catch (err) { $('libraryStatus').textContent = err.message; return; }
  // Folders, tags, notes, colors and bracket (item 148) come from each list's About section
  for (const d of libraryDecks) { d.meta = deckMeta(d.text); d.cmdrs = commandersOf(d.text); }
  const folders = [...new Set(libraryDecks.map(d => d.meta.folder).filter(Boolean))].sort();
  const fsel = $('libFolder'), keep = fsel.value;
  fsel.innerHTML = `<option value="">All folders</option>${folders.map(f => `<option value="${esc(f)}" ${f === keep ? 'selected' : ''}>${esc(f)}</option>`).join('')}<option value="-" ${keep === '-' ? 'selected' : ''}>No folder</option>`;
  const q = $('librarySearch').value.trim().toLowerCase();
  // (search: name, commander, tags, notes, folder, colors like "wub", "bracket 3" or "b3", or any card)
  const hay = d => `${d.name} ${d.cmdrs.join(' ')} ${d.meta.tags.join(' ')} ${d.meta.notes} ${d.meta.folder} ${d.meta.colors.toLowerCase()} ${d.meta.bracket ? `bracket ${d.meta.bracket} b${d.meta.bracket}` : ''} ${d.text}`.toLowerCase();
  const rows = libraryDecks.filter(d => (!fsel.value || (fsel.value === '-' ? !d.meta.folder : d.meta.folder === fsel.value)) && (!q || q.split(/\s+/).every(w => hay(d).includes(w) || sameColors(w, d.meta.colors))));
  $('libraryStatus').textContent = `${libraryDecks.length} saved deck${libraryDecks.length === 1 ? '' : 's'}`;
  body.innerHTML = rows.length ? `<table class="libtable"><thead><tr><th>Deck</th><th>Folder</th><th>Commander</th><th>Colors</th><th class="num">Bracket</th><th class="num">Cards</th><th>Saved</th><th>Load into seat</th><th></th></tr></thead><tbody>
    ${rows.map(d => `<tr data-name="${esc(d.name)}"><td><b>${esc(d.name)}</b>${d.meta.tags.map(t => ` <span class="libtag">${esc(t)}</span>`).join('')}${d.meta.notes ? `<div class="muted small">${esc(d.meta.notes)}</div>` : ''}</td>
      <td>${esc(d.meta.folder)}</td><td>${esc(d.cmdrs.join(' + '))}</td><td>${d.meta.colors ? symbolize([...d.meta.colors].map(x => `{${x}}`).join('')) : ''}</td><td class="num">${d.meta.bracket || ''}</td>
      <td class="num">${parseText(d.text).entries.filter(e => !e.side).reduce((a, e) => a + e.qty, 0)}</td><td>${esc(new Date(d.modified).toLocaleDateString())}</td>
      <td class="seatpicks">${seats.map((s, i) => `<button class="btn small libseat" data-name="${esc(d.name)}" data-seat="${i}" style="--pc:${s.color}">${i + 1}</button>`).join('')}</td>
      <td class="libacts"><button class="btn small libinfo" data-name="${esc(d.name)}">Info</button><button class="btn small libhist" data-name="${esc(d.name)}" title="Earlier versions saved on this PC">History (${versions(d.name).length})</button><button class="btn small ghost libdel" data-name="${esc(d.name)}">Delete</button></td></tr>`).join('')}</tbody></table>`
    : `<p class="muted">${libraryDecks.length ? 'No decks match.' : 'No saved decks yet. Use "Edit" on a loaded seat, then "Save to library".'}</p>`;
}
// (colors in any order: "gw" finds a WG deck)
const sameColors = (w, colors) => /^[wubrgc]{1,5}$/.test(w) && !!colors && [...w].sort().join('') === [...colors.toLowerCase()].sort().join('');
// The Info panel under a library row: folder, tags, bracket, notes, and colors and bracket worked out from the cards
function libPanel(tr, html) {
  tr.parentElement.querySelectorAll('.libpanel').forEach(x => x.remove());
  tr.insertAdjacentHTML('afterend', `<tr class="libpanel"><td colspan="9">${html}</td></tr>`);
  return tr.nextElementSibling;
}
function libInfo(tr, d) {
  const m = d.meta;
  const p = libPanel(tr, `<div class="libinfo-form">
    <label>Folder <input class="input" data-m="folder" value="${esc(m.folder)}" list="libFolders" maxlength="40"></label>
    <label>Tags <input class="input" data-m="tags" value="${esc(m.tags.join(', '))}" placeholder="tokens, budget" maxlength="120"></label>
    <label>Colors <input class="input" data-m="colors" value="${esc(m.colors)}" placeholder="WUBRG" maxlength="5"></label>
    <label>Bracket <select class="input" data-m="bracket"><option value="">–</option>${[1, 2, 3, 4, 5].map(b => `<option ${m.bracket === b ? 'selected' : ''}>${b}</option>`).join('')}</select></label>
    <label class="wide">Notes <input class="input" data-m="notes" value="${esc(m.notes)}" maxlength="300"></label>
    <div><button class="btn small" data-li="auto">Work out colors and bracket</button> <button class="btn small primary" data-li="save">Save</button> <span class="muted" data-li="msg"></span></div>
    <datalist id="libFolders">${[...new Set(libraryDecks.map(x => x.meta.folder).filter(Boolean))].map(f => `<option value="${esc(f)}">`).join('')}</datalist></div>`);
  const val = k => /** @type {HTMLInputElement} */ (p.querySelector(`[data-m="${k}"]`)).value;
  const say = t => { p.querySelector('[data-li="msg"]').textContent = t; };
  p.querySelector('[data-li="auto"]').addEventListener('click', async () => {
    try {
      say('Loading the deck…');
      const deck = await loadDeck(d.text, t => say(t), { format: d.cmdrs.length ? 'commander' : formatKey });
      const ids = new Set([...deck.commanders, ...deck.cards.map(c => c.card)].flatMap(c => c.colorIdentity || []));
      /** @type {HTMLInputElement} */ (p.querySelector('[data-m="colors"]')).value = 'WUBRG'.split('').filter(c => ids.has(c)).join('');
      if (deck.commanders.length) /** @type {HTMLSelectElement} */ (p.querySelector('[data-m="bracket"]')).value = String(estimateBracket(deck).bracket);
      say('Filled in: check and Save.');
    } catch (err) { say(`Couldn't load it: ${err.message}`); }
  });
  p.querySelector('[data-li="save"]').addEventListener('click', async () => {
    const meta = { folder: val('folder').trim(), tags: val('tags').split(',').map(t => t.trim()).filter(Boolean), colors: val('colors').toUpperCase().replace(/[^WUBRGC]/g, ''), bracket: +val('bracket') || null, notes: val('notes').trim() };
    try { await saveDeck(d.name, withMeta(d.text, meta), { previous: d.text }); renderLibrary(); } catch (err) { say(`Couldn't save: ${err.message}`); }
  });
}
function libHistory(tr, d) {
  const vs = versions(d.name);
  const summary = text => { const ch = diffLists(text, d.text); const add = ch.reduce((a, x) => a + Math.max(0, x.to - x.from), 0), cut = ch.reduce((a, x) => a + Math.max(0, x.from - x.to), 0); return `+${add} −${cut}`; };
  const p = libPanel(tr, vs.length ? `<p class="muted">Earlier versions of this deck saved on this PC (newest first), compared with the current list.</p>${vs.map((v, i) => `<div class="libver"><span>${esc(new Date(v.at).toLocaleString())}</span> <span class="muted">${summary(v.text)} since then</span>
      <button class="btn small" data-v="${i}" data-vact="diff">Show changes</button><button class="btn small ghost" data-v="${i}" data-vact="restore">Restore</button><div class="libdiff" hidden></div></div>`).join('')}`
    : '<p class="muted">No earlier versions yet: each save from now on keeps the list it replaces (the last 10, on this PC).</p>');
  p.addEventListener('click', async e => {
    const b = e.target.closest('[data-vact]');
    if (!b) return;
    const v = vs[+b.dataset.v];
    if (b.dataset.vact === 'diff') {
      const box = b.parentElement.querySelector('.libdiff');
      const ch = diffLists(v.text, d.text);
      box.innerHTML = ch.length ? ch.map(x => `<div class="${x.to > x.from ? 'add' : 'cut'}">${x.to > x.from ? '+' : '−'}${Math.abs(x.to - x.from)} ${esc(x.name)}</div>`).join('') : '<span class="muted">Same cards (only the name or info changed).</span>';
      box.hidden = !box.hidden;
    } else if (confirm(`Restore the version from ${new Date(v.at).toLocaleString()}? The current list is kept as a version.`)) {
      try { await saveDeck(d.name, v.text, { previous: d.text }); renderLibrary(); } catch (err) { $('libraryStatus').textContent = err.message; }
    }
  });
}
// Matchup grid: the decks shown play each other head to head at full speed; each cell is the row deck's win rate
let gridStop = false;
$('btnGrid').addEventListener('click', async () => {
  if ($('btnGrid').dataset.running) { gridStop = true; return; }
  const q = $('librarySearch').value.trim().toLowerCase();
  const chosen = libraryDecks.filter(d => !q || `${d.name} ${d.text}`.toLowerCase().includes(q)).slice(0, 8);
  if (chosen.length < 2) { $('libraryStatus').textContent = 'The grid needs at least two decks (filter the list to choose which).'; return; }
  const per = +$('gridGames').value;
  gridStop = false;
  $('btnGrid').dataset.running = '1';
  $('btnGrid').textContent = 'Stop';
  try {
    const decks = [];
    for (const d of chosen) { $('libraryStatus').textContent = `Loading ${d.name}…`; decks.push(await loadDeck(d.text, () => {}, { format: formatKey })); }
    const n = decks.length;
    const wins = Array.from({ length: n }, () => Array(n).fill(0)), games = Array.from({ length: n }, () => Array(n).fill(0));
    const total = (n * (n - 1)) / 2 * per;
    let done = 0;
    const draw = () => {
      $('libraryBody').innerHTML = `<table class="grid"><thead><tr><th>Row deck wins vs…</th>${chosen.map((d, j) => `<th title="${esc(d.name)}">${j + 1}</th>`).join('')}<th class="num">Overall</th></tr></thead><tbody>
        ${chosen.map((d, i) => {
          const w = wins[i].reduce((a, b) => a + b, 0), g = games[i].reduce((a, b) => a + b, 0);
          return `<tr><td>${i + 1}. ${esc(d.name)}</td>${chosen.map((_, j) => (i === j ? '<td class="num muted">–</td>' : games[i][j]
            ? `<td class="num" style="background:color-mix(in srgb, ${wins[i][j] / games[i][j] >= 0.5 ? 'var(--good)' : 'var(--bad)'} ${Math.round(Math.abs(wins[i][j] / games[i][j] - 0.5) * 80)}%, transparent)">${Math.round((wins[i][j] / games[i][j]) * 100)}%</td>` : '<td></td>')).join('')}
            <td class="num"><b>${g ? Math.round((w / g) * 100) : 0}%</b></td></tr>`;
        }).join('')}</tbody></table>
        <p class="muted">${done} of ${total} games. Head-to-head ${esc(fmt().name)} games (two players, ${fmt().life} life each), AI pilots in their Auto style. Small samples are noisy.</p>`;
    };
    for (let i = 0; i < n && !gridStop; i++) for (let j = i + 1; j < n && !gridStop; j++) {
      for (let k = 0; k < per && !gridStop; k++) {
        // Alternate who sits first
        const [a, b] = k % 2 ? [j, i] : [i, j];
        const g = new Game([a, b].map((x, s) => ({ playerName: `${x + 1}`, deckName: decks[x].deckName, color: SEAT_COLORS[s], agent: new Agent(learnedStyle(learnAs(decks[x])) || guessStyle(decks[x])), commanders: decks[x].commanders, learnAs: learnAs(decks[x]), cards: decks[x].cards })), { beat: async () => {} }, { format: formatKey });
        await g.run();
        if (g.over) recordGame(g);
        games[i][j]++; games[j][i]++;
        if (g.winner) { const w = g.winner.idx === 0 ? a : b, l = w === a ? b : a; wins[w][l]++; }
        done++;
        $('libraryStatus').textContent = `Playing… ${done} / ${total}`;
        if (done % 2 === 0) { draw(); await sleep(0); }
      }
    }
    draw();
    $('libraryStatus').textContent = gridStop ? `Stopped after ${done} games` : `Done: ${done} games`;
  } catch (err) {
    $('libraryStatus').textContent = `The grid stopped: ${err.message}`;
  }
  delete $('btnGrid').dataset.running;
  $('btnGrid').textContent = 'Matchup grid';
});
$('btnLibrary').addEventListener('click', () => { $('libraryModal').hidden = false; renderLibrary(); });
$('btnLibraryClose').addEventListener('click', () => { $('libraryModal').hidden = true; });
$('librarySearch').addEventListener('input', renderLibrary);
$('libFolder').addEventListener('change', renderLibrary);
// Import an Archidekt folder (item 156): pick decks from a public folder; each is saved to the library in a folder
// of the same name
$('btnArchFolder').addEventListener('click', async () => {
  const link = prompt('Paste a public Archidekt folder link (like https://archidekt.com/folders/12345):');
  const id = link?.match(/archidekt\.com\/folders\/(\d+)/i)?.[1] || link?.match(/^\s*(\d+)\s*$/)?.[1];
  if (!link) return;
  if (!id) { $('libraryStatus').textContent = 'That isn\'t an Archidekt folder link.'; return; }
  $('libraryStatus').textContent = 'Reading the folder…';
  try { showArchFolder(await archidektFolder(id)); } catch (err) { $('libraryStatus').textContent = `Couldn't read the folder: ${err.message}`; }
});
function showArchFolder(f) {
  $('libraryStatus').textContent = '';
  $('libraryBody').innerHTML = `<h3>${esc(f.name)}${f.owner ? ` <span class="muted">by ${esc(f.owner)}</span>` : ''}</h3>
    ${f.decks.length ? `<p><label><input type="checkbox" id="archAll" checked> All</label></p>${f.decks.map(d => `<div><label><input type="checkbox" class="archpick" value="${d.id}" checked> ${esc(d.name)} <span class="muted">${d.size} cards</span></label></div>`).join('')}
      <p><button class="btn primary" id="btnArchSave">Save the chosen decks to the library</button> <span class="muted">They go in a folder named "${esc(f.name)}".</span></p>` : '<p class="muted">No public decks in this folder.</p>'}
    ${f.subfolders.length ? `<p class="muted">Subfolders: ${f.subfolders.map(s => `<button class="btn small" data-archsub="${s.id}">${esc(s.name)}</button>`).join(' ')}</p>` : ''}
    <p><button class="btn ghost small" id="btnArchBack">Back to the library</button></p>`;
  $('archAll')?.addEventListener('change', e => document.querySelectorAll('.archpick').forEach(x => { /** @type {HTMLInputElement} */ (x).checked = /** @type {HTMLInputElement} */ (e.target).checked; }));
  $('btnArchBack').addEventListener('click', renderLibrary);
  $('libraryBody').querySelectorAll('[data-archsub]').forEach(b => b.addEventListener('click', async () => { try { showArchFolder(await archidektFolder(/** @type {HTMLElement} */ (b).dataset.archsub)); } catch (err) { $('libraryStatus').textContent = err.message; } }));
  $('btnArchSave')?.addEventListener('click', async () => {
    const ids = [...document.querySelectorAll('.archpick:checked')].map(x => /** @type {HTMLInputElement} */ (x).value);
    let n = 0;
    for (const id of ids) {
      try {
        $('libraryStatus').textContent = `Saving ${n + 1} of ${ids.length}…`;
        const d = await archidektDeckText(id);
        await saveDeck(d.name, withMeta(d.text, { folder: f.name, tags: ['archidekt'], colors: '', bracket: null, notes: `From https://archidekt.com/decks/${id}` }));
        n++;
      } catch (err) { $('libraryStatus').textContent = `Couldn't save deck ${id}: ${err.message}`; }
    }
    await renderLibrary();
    $('libraryStatus').textContent = `Saved ${n} of ${ids.length} decks in the folder "${f.name}".`;
  });
}
$('libraryBody').addEventListener('click', async e => {
  const seat = e.target.closest('.libseat'), del = e.target.closest('.libdel');
  const info = e.target.closest('.libinfo, .libhist');
  if (info) {
    const d = libraryDecks.find(x => x.name === info.dataset.name), tr = info.closest('tr');
    if (d) (info.classList.contains('libinfo') ? libInfo : libHistory)(tr, d);
    return;
  }
  if (seat) {
    const d = libraryDecks.find(x => x.name === seat.dataset.name);
    Object.assign(seats[+seat.dataset.seat], { source: d.text, deck: null });
    persist();
    renderSeats();
    $('libraryStatus').textContent = `${d.name} goes into seat ${+seat.dataset.seat + 1}. Close this and click "Load decks".`;
  } else if (del && confirm(`Delete "${del.dataset.name}" from your library?`)) {
    await deleteDeck(del.dataset.name).catch(err => { $('libraryStatus').textContent = err.message; });
    renderLibrary();
  }
});

function showDeck(s) {
  const d = s.deck;
  if (!d) return;
  const all = [...d.commanders.map(c => ({ card: c, qty: 1 })), ...d.cards];
  const spells = all.filter(x => !x.card.fx.type.land);
  const curve = Array(8).fill(0);
  for (const { card, qty } of spells) curve[Math.min(7, Math.floor(card.cmc || 0))] += qty;
  const top = Math.max(1, ...curve);
  const pips = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  for (const { card, qty } of spells) for (const [, c] of (card.manaCost || '').matchAll(/\{([WUBRG])(?:\/[WUBRGP])?\}/g)) pips[c] += qty;
  const types = {};
  for (const { card, qty } of all) {
    const t = card.fx.type;
    const k = t.land ? 'Lands' : t.creature ? 'Creatures' : t.planeswalker ? 'Planeswalkers' : t.instant ? 'Instants' : t.sorcery ? 'Sorceries' : t.artifact ? 'Artifacts' : t.enchantment ? 'Enchantments' : 'Other';
    types[k] = (types[k] || 0) + qty;
  }
  const cov = coverage(d);
  const avg = spells.reduce((a, x) => a + (x.card.cmc || 0) * x.qty, 0) / Math.max(1, spells.reduce((a, x) => a + x.qty, 0));
  const combos = combosIn(all.map(x => x.card));
  // Suggestions from the latest batch run, if this deck was in it
  const st = lastCardStats.get(d.deckName);
  let tips = '';
  if (st) {
    const min = Math.max(3, Math.round(st.played * 0.1));
    const rows = [...st.cards.entries()].filter(([, c]) => c.games >= min).map(([name, c]) => ({ name, games: c.games, lift: c.wins / c.games - st.base }));
    const cut = rows.filter(r => r.lift <= -0.1).sort((a, b) => a.lift - b.lift).slice(0, 6);
    const keep = rows.filter(r => r.lift >= 0.15).sort((a, b) => b.lift - a.lift).slice(0, 6);
    tips = `<h3>From your last batch run (${st.played} games)</h3>
      ${keep.length ? `<p><b>Key cards:</b> ${keep.map(r => `${esc(r.name)} (+${Math.round(r.lift * 100)})`).join(', ')}</p>` : ''}
      ${cut.length ? `<p><b>Worth a look to cut:</b> ${cut.map(r => `${esc(r.name)} (${Math.round(r.lift * 100)})`).join(', ')}</p>` : '<p class="muted">No card stands out as a clear underperformer.</p>'}
      <p class="muted">Numbers are win-rate points compared with the deck's average when the card was cast. Small samples are noisy.</p>`;
  }
  $('deckTitle').textContent = d.deckName;
  $('deckBody').innerHTML = `
    <div class="deck-stats">
      <div><h3>Mana curve</h3><div class="curve">${curve.map((n, i) => `<div class="col"><span class="n">${n || ''}</span><div class="bar" style="height:${(n / top) * 90}px"></div><span class="l">${i === 7 ? '7+' : i}</span></div>`).join('')}</div>
        <p class="muted">Average mana value ${avg.toFixed(2)}</p></div>
      <div><h3>Color pips</h3>${Object.entries(pips).filter(([, n]) => n).map(([c, n]) => `<div class="pipbar"><span>${symbolize(`{${c}}`)}</span><div style="width:${Math.min(100, n * 2)}%"></div><b>${n}</b></div>`).join('') || '<p class="muted">Colorless</p>'}</div>
      <div><h3>Card types</h3><ul class="typelist">${Object.entries(types).sort((a, b) => b[1] - a[1]).map(([k, n]) => `<li><span>${k}</span><b>${n}</b></li>`).join('')}</ul></div>
    </div>
    ${d.commanders.length ? '<h3>Deck health</h3><div id="deckHealth"><p><button class="btn small" id="btnDeckHealth">Check lands, ramp, card draw, removal and wipes</button> <span class="muted">Uses Scryfall card tags; each card is asked about once.</span></p></div>' : ''}
    <p class="deck-exports"><span class="muted">Export:</span> <button class="btn small" data-exp="dek" title="An MTGO deck file (cards matched by name)">MTGO .dek</button><button class="btn small" data-exp="arena" title="Copy the list in MTG Arena's import format">Arena text</button><button class="btn small" data-exp="check" title="A checklist by card type with set and number, to print or tick off">Checklist</button></p>
    <h3>Draw odds</h3><div id="drawOdds"><p><select id="oddsWhat" class="input"></select> <label class="muted">at least <select id="oddsK" class="sbracket"><option>1</option><option>2</option><option>3</option><option>4</option><option>5</option></select></label></p><div id="oddsOut"></div></div>
    <h3>Goldfish</h3><div id="goldfish"><p><button class="btn small" id="btnSampleHand">Sample hand</button>
      <label class="muted">Solo runs <select id="gfRuns" class="sbracket"><option>100</option><option>250</option><option>1000</option></select></label> <button class="btn small" id="btnGoldfish">Run the AI pilot alone</button></p>
      <div id="gfHand"></div><div id="gfRunsOut"></div></div>
    <h3>What the simulator understands: ${cov.pct}%</h3>
    ${cov.ignored.length ? `<p class="muted">These cards are cast and put on the battlefield, but their special abilities do nothing in the simulator, so their real strength isn't reflected in results:</p><p class="ignored">${cov.ignored.map(esc).join(' · ')}</p>` : '<p class="muted">Every non-basic card is at least partly understood.</p>'}
    ${d.commanders.length ? (() => { const est = estimateBracket(d), diff = bracketDifferences(est, d.sbBracket); return `<h3>Bracket ${est.bracket}: ${BRACKETS[est.bracket].name}</h3><ul>${est.reasons.map(r => `<li>${esc(r)}</li>`).join('') || '<li>No Game Changers, two-card combos, extra turns or mass land destruction.</li>'}</ul>${d.sbBracket ? `<p>Commander Spellbook: <b>${esc(d.sbBracket.name)}</b>${d.sbBracket.about ? ` (about bracket ${d.sbBracket.about})` : ''}.${diff.length ? '' : ' The two agree.'}</p>${diff.length ? `<ul class="muted">${diff.slice(1).map(s => `<li>${esc(s)}</li>`).join('')}</ul>` : ''}` : ''}`; })() : ''}
    ${d.commanders.length ? '<h3>Combos one card away</h3><div id="almostCombos"><p><button class="btn small" id="btnAlmost">Ask Commander Spellbook</button> <span class="muted">Combos in your colors that need just one more card.</span></p></div>' : ''}
    ${combos.length ? `<h3>Combos (${combos.length})</h3><ul>${combos.map(c => `<li>${esc(c.label)}: ${esc(c.note)}</li>`).join('')}</ul>` : ''}
    ${tips || '<p class="muted">Run a batch with this deck seated to get card suggestions.</p>'}
    ${hasCollection() ? (() => { const miss = missingCards(d); return `<h3>Collection</h3>${miss.length ? `<p>Missing ${miss.reduce((a, m) => a + m.need - m.have, 0)} cards (${miss.length} different): <button class="btn small" id="btnCopyMissing">Copy the list</button></p><p class="ignored">${miss.map(m => `${m.need - m.have} ${esc(m.name)}`).join(' · ')}</p>` : '<p>✔ You own every card in this deck.</p>'}`; })() : ''}
    ${masteryHtml(d)}
    ${learnedHtml(d)}
    <h3>Compared with tournament lists</h3>
    <div id="metaCompare"><p><button class="btn small" id="btnCompareMeta">Compare with recent EDHTop16 lists for this commander</button></p></div>`;
  $('btnCompareMeta')?.addEventListener('click', async () => {
    const box = $('metaCompare');
    box.innerHTML = '<p class="muted">Loading…</p>';
    try {
      const r = await compareWithMeta(d, t => { box.innerHTML = `<p class="muted">${esc(t)}</p>`; });
      box.innerHTML = `<p class="muted">${r.lists} recent top-16 lists for ${esc(r.commander)}.</p>
        ${r.missing.length ? `<p><b>Most of them play, and you don't:</b> ${r.missing.slice(0, 25).map(m => `${esc(m.name)} (${Math.round(m.share * 100)}%)`).join(', ')}</p>` : '<p>You play everything that at least half of them play.</p>'}
        ${r.unique.length ? `<p><b>Yours alone</b> (none of them play): ${r.unique.slice(0, 30).map(esc).join(', ')}</p>` : '<p>Every card you play shows up in at least one of their lists.</p>'}`;
    } catch (err) { box.innerHTML = `<p class="muted">Couldn't compare: ${esc(err.message)}</p>`; }
  });
  $('btnCopyMissing')?.addEventListener('click', e => { navigator.clipboard?.writeText(missingCards(d).map(m => `${m.need - m.have} ${m.name}`).join('\n')).then(() => { /** @type {HTMLElement} */ (e.target).textContent = 'Copied'; }).catch(() => {}); });
  // More exports (item 153)
  $('deckBody').querySelector('.deck-exports')?.addEventListener('click', async e => {
    const b = e.target.closest('[data-exp]');
    if (!b) return;
    const file = (d.deckName || 'deck').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'deck';
    if (b.dataset.exp === 'dek') download(`${file}.dek`, dekXml(d), 'application/xml');
    else if (b.dataset.exp === 'check') download(`${file}-checklist.txt`, checklistText(d), 'text/plain');
    else { try { await navigator.clipboard.writeText(arenaText(d)); b.textContent = 'Copied'; } catch { download(`${file}-arena.txt`, arenaText(d), 'text/plain'); } }
  });
  // Draw odds (item 150): by turn N you have seen 7 + N cards (one fewer on the play in a duel, where the first
  // player skips the first draw). Categories: lands, each card type, the deck health roles once checked, combo pieces.
  const lib = d.cards.reduce((a, x) => a + x.qty, 0);
  const oddsSets = () => {
    const sets = [{ id: 'lands', label: 'Lands', n: d.cards.filter(x => x.card.fx.type.land).reduce((a, x) => a + x.qty, 0) }];
    for (const t of ['creature', 'instant', 'sorcery', 'artifact', 'enchantment', 'planeswalker']) {
      const n = d.cards.filter(x => !x.card.fx.type.land && x.card.fx.type[t]).reduce((a, x) => a + x.qty, 0);
      if (n) sets.push({ id: t, label: t === 'sorcery' ? 'Sorceries' : `${t[0].toUpperCase() + t.slice(1)}s`, n });
    }
    // (the deck health roles, once Check has been run for this deck: they are kept per card)
    const tags = store('ct.otags2') || {};
    for (const [k, label] of [['ramp', 'Ramp'], ['draw', 'Card draw'], ['removal', 'Targeted removal'], ['wipe', 'Board wipes']]) {
      const n = d.cards.filter(x => tags[x.card.name]?.tags.includes(k)).reduce((a, x) => a + x.qty, 0);
      if (n) sets.push({ id: k, label: `${label} (from Deck health)`, n });
    }
    combos.forEach((c, i) => {
      const n = d.cards.filter(x => c.pieces.some(p => p.toLowerCase() === x.card.name.toLowerCase())).reduce((a, x) => a + x.qty, 0);
      if (n) sets.push({ id: `combo${i}`, label: `A piece of ${c.label}`, n });
    });
    return sets;
  };
  const sets = oddsSets();
  if ($('oddsWhat')) {
    $('oddsWhat').innerHTML = `<optgroup label="Groups">${sets.map((s, i) => `<option value="s${i}">${esc(s.label)} (${s.n})</option>`).join('')}</optgroup>
      <optgroup label="One card">${[...d.cards].filter(x => !x.card.fx.type.land || !/\bbasic\b/i.test(x.card.typeLine || '')).sort((a, b) => a.card.name.localeCompare(b.card.name)).map(x => `<option value="c${esc(x.card.name)}">${esc(x.card.name)}${x.qty > 1 ? ` (${x.qty})` : ''}</option>`).join('')}</optgroup>`;
    const drawOdds = () => {
      const v = $('oddsWhat').value, k = +$('oddsK').value;
      const K = v.startsWith('s') ? sets[+v.slice(1)].n : d.cards.find(x => x.card.name === v.slice(1))?.qty || 0;
      const turns = [1, 2, 3, 4, 5, 6, 8, 10];
      const pc = p => `${Math.round(p * 100)}%`;
      $('oddsOut').innerHTML = `<table class="odds"><thead><tr><th>By turn</th>${turns.map(t => `<th class="num">${t}</th>`).join('')}</tr></thead><tbody>
        <tr><td>On the draw</td>${turns.map(t => `<td class="num">${pc(atLeast(lib, K, 7 + t, k))}</td>`).join('')}</tr>
        <tr><td class="muted">On the play (duel)</td>${turns.map(t => `<td class="num muted">${pc(atLeast(lib, K, 6 + t, k))}</td>`).join('')}</tr>
        <tr><td class="muted">Opening hand</td><td class="num muted" colspan="${turns.length}" style="text-align:left">${pc(atLeast(lib, K, 7, k))} in the first 7 cards</td></tr></tbody></table>
        <p class="muted">The chance of at least ${k} of these ${K} cards among the cards seen from the ${lib}-card library, without mulligans or extra draws.</p>`;
    };
    $('oddsWhat').addEventListener('change', drawOdds);
    $('oddsK').addEventListener('change', drawOdds);
    drawOdds();
  }
  // Goldfish (item 149): sample hands, and the AI pilot playing the deck alone
  let sampler = null;
  const drawHand = () => {
    const card = c => `<img class="gf-card" src="${esc(c.imgSmall || c.imgNormal || '')}" alt="${esc(c.name)}" title="${esc(c.name)}" loading="lazy">`;
    const lands = sampler.hand.filter(c => c.fx?.type.land).length;
    $('gfHand').innerHTML = `<div class="gf-row">${sampler.hand.map(card).join('')}</div>
      <p class="muted">${sampler.mulligans ? `Mulligan ${sampler.mulligans}: put ${sampler.mulligans} card${sampler.mulligans === 1 ? '' : 's'} on the bottom. ` : ''}${lands} land${lands === 1 ? '' : 's'} in the hand.</p>
      ${sampler.drawn.length ? `<p class="muted">Draws, turn by turn:</p><div class="gf-row">${sampler.drawn.map(card).join('')}</div>` : ''}
      <p><button class="btn small" data-gf="mull">Mulligan</button><button class="btn small" data-gf="draw">Draw</button><button class="btn small" data-gf="new">New hand</button></p>`;
  };
  $('btnSampleHand')?.addEventListener('click', () => { sampler = sampleHands(d); drawHand(); });
  $('gfHand')?.addEventListener('click', e => {
    const b = e.target.closest('[data-gf]');
    if (!b || !sampler) return;
    if (b.dataset.gf === 'mull') sampler.mulligan(); else if (b.dataset.gf === 'draw') sampler.draw(); else sampler.newHand();
    drawHand();
  });
  let gfStop = false;
  $('btnGoldfish')?.addEventListener('click', async () => {
    const btn = $('btnGoldfish');
    if (btn.dataset.running) { gfStop = true; return; }
    gfStop = false;
    btn.dataset.running = '1';
    btn.textContent = 'Stop';
    const out = $('gfRunsOut');
    try {
      const r = await goldfishRuns(d, { runs: +$('gfRuns').value, format: d.format || formatKey, stop: () => gfStop || $('deckModal').hidden, onProgress: (k, n) => { out.innerHTML = `<p class="muted">Playing ${k} of ${n}…</p>`; } });
      const t = v => (v == null ? '–' : `turn ${v.toFixed(1)}`);
      const pct = (a, n) => `${Math.round((a / Math.max(1, n)) * 100)}%`;
      out.innerHTML = `<ul>
        ${d.commanders.length ? `<li>Commander cast: <b>${t(r.avgCmd)}</b> on average (${pct(r.cmd.length, r.runs)} of games by turn 10)</li>` : ''}
        <li>A combo started: <b>${r.combo.length ? t(r.avgCombo) : 'never'}</b>${r.combo.length ? ` (${pct(r.combo.length, r.runs)} of games)` : ''}</li>
        <li>Won alone (a 40-life opponent who only plays lands): <b>${r.win.length ? t(r.avgWin) : 'not by turn 10'}</b>${r.win.length ? ` (${pct(r.win.length, r.runs)} of games)` : ''}</li>
        <li>Lands on the battlefield after three turns: ${r.avgLandsT3 == null ? '–' : r.avgLandsT3.toFixed(2)} · mulligans per game: ${r.avgMulls.toFixed(2)}</li></ul>
        <p class="muted">${r.runs} games, one seed each (the same seeds every time, so changes to the deck compare fairly), the AI pilot going first, up to its tenth turn.</p>`;
    } catch (err) { out.innerHTML = `<p class="muted">Couldn't run: ${esc(err.message)}</p>`; }
    delete btn.dataset.running;
    btn.textContent = 'Run the AI pilot alone';
  });
  $('btnAlmost')?.addEventListener('click', async () => {
    const box = $('almostCombos');
    box.innerHTML = '<p class="muted">Asking Commander Spellbook…</p>';
    try {
      const list = await almostCombos(d.commanders.map(c => c.name), d.cards.map(c => c.card.name));
      box.innerHTML = list.length ? `<ul>${list.slice(0, 15).map(c => `<li>Add <b>${esc(c.missing[0])}</b> to ${c.have.map(esc).join(' + ')}: ${esc(c.produces.slice(0, 3).join(', ') || 'a combo')} <a href="https://commanderspellbook.com/combo/${encodeURIComponent(c.id)}/" target="_blank" rel="noopener" class="muted">details</a></li>`).join('')}</ul>
        <p class="muted">${list.length} combo${list.length === 1 ? '' : 's'} one card away, most popular first${list.length > 15 ? ' (the first 15 shown)' : ''}. The simulator plays combos that end in a win, infinite damage or infinite mana; others are listed for interest.</p>` : '<p>No combo in your colors is one card away.</p>';
    } catch (err) { box.innerHTML = `<p class="muted">Couldn't reach Commander Spellbook: ${esc(err.message)}</p>`; }
  });
  $('btnDeckHealth')?.addEventListener('click', async () => {
    const box = $('deckHealth');
    box.innerHTML = '<p class="muted">Checking…</p>';
    try {
      const h = await deckHealth(d, t => { box.innerHTML = `<p class="muted">${esc(t)}</p>`; });
      const row = (k, t) => { const n = h.counts[k], ok = n >= t.min && n <= t.max; return `<tr class="${ok ? 'ok' : 'warn'}"><td>${t.label}</td><td class="num"><b>${n}</b></td><td class="muted">${t.min}–${t.max}</td><td>${ok ? '✔' : n < t.min ? 'low' : 'high'}</td><td class="muted small">${(h.tagged[k] || []).map(esc).join(', ')}</td></tr>`; };
      box.innerHTML = `<table class="health"><tbody>${Object.entries(HEALTH_TEMPLATE).map(([k, t]) => row(k, t)).join('')}</tbody></table>
        ${h.notes.length ? `<ul>${h.notes.map(n => `<li>${esc(n.text)}${HEALTH_TEMPLATE[n.k]?.tag && h.counts[n.k] < HEALTH_TEMPLATE[n.k].min ? ` <span class="health-sugg" data-k="${n.k}"></span>` : ''}</li>`).join('')}</ul>` : '<p>✔ Everything is inside the usual ranges.</p>'}
        <p class="muted">Ranges are a common rule of thumb for 100-card Commander decks, not rules: fast combo decks run less of everything. Card roles come from Scryfall's community tags and can miss a card.</p>`;
      for (const el of box.querySelectorAll('.health-sugg')) {
        const list = await healthSuggestions(d, el.dataset.k);
        if (list.length) el.innerHTML = `Popular in your colors: ${list.map(esc).join(', ')}.`;
      }
    } catch (err) { box.innerHTML = `<p class="muted">Couldn't check: ${esc(err.message)}</p>`; }
  });
  $('btnForgetDeck')?.addEventListener('click', () => { forgetDeck(learnAs(d)); showDeck(s); });
  $('deckModal').hidden = false;
}
function masteryHtml(d) {
  const m = mastery(learnAs(d));
  const pct = Math.round((m.into / m.span) * 100);
  return `<h3>Deck mastery: level ${m.level}</h3>
    <div class="mastery-bar" title="${m.xp} points"><span style="width:${m.next ? pct : 100}%"></span></div>
    <p class="muted">${m.games} games, ${m.wins} wins${m.games ? ` (${Math.round((m.wins / m.games) * 100)}%)` : ''} · ${m.next ? `${m.span - m.into} points to level ${m.level + 1} (10 a game, 15 more for a win)` : 'top level (20)'}</p>
    ${m.top.length ? `<p><b>Best cards</b> (cast most in its wins): ${m.top.map(c => `${esc(c.name)} <span class="muted">${c.wins}/${c.casts}</span>`).join(', ')}</p>` : ''}`;
}
function learnedHtml(d) {
  const L = learnedSummary(learnAs(d));
  if (!L) return '<h3>What its AI has learned</h3><p class="muted">Nothing yet. Every finished game (batch runs especially) teaches this deck\'s AI which of its cards show up in wins.</p>';
  const list = rows => rows.map(([n, b]) => `${esc(n)} (${b > 0 ? '+' : ''}${b.toFixed(1)})`).join(', ');
  return `<h3>What its AI has learned (${L.games} games, ${L.wins} wins)</h3>
    ${L.best.length || L.worst.length ? `${L.best.length ? `<p><b>Plays more eagerly:</b> ${list(L.best)}</p>` : ''}${L.worst.length ? `<p><b>Plays less eagerly:</b> ${list(L.worst)}</p>` : ''}`
      : `<p class="muted">${L.games < 5 ? 'It needs at least 5 games before it changes how it plays.' : 'No card stands out yet.'}</p>`}
    ${L.styles.length ? `<p><b>By play style:</b> ${L.styles.map(s => `${esc(STYLES[s.style] || s.style)} ${s.wins}/${s.games}`).join(', ')}${L.style ? `. <b>Auto now plays it ${esc(STYLES[L.style] || L.style)}.</b>` : '. Auto picks a style from the list until one clearly wins more (12+ games).'}</p>` : ''}
    <p><button class="btn small" id="btnForgetDeck">Forget what it learned</button></p>`;
}

// ---------- tournament: more than four decks, shuffled into pods every round
let tourneyStop = false;
$('btnTourney').addEventListener('click', () => { if (game && !clock.paused) togglePlay(); $('tourneyModal').hidden = false; });
$('btnTourneyClose').addEventListener('click', () => { tourneyStop = true; $('tourneyModal').hidden = true; });
$('btnTourneyStop').addEventListener('click', () => { tourneyStop = true; });
$('tourneyDecks').value = store('ct.tourney') || '';
$('tourneyDecks').addEventListener('input', e => store('ct.tourney', e.target.value));
$('btnTourneyRun').addEventListener('click', runTourney);

function tourneyEntries(text) {
  // Pasted lists are separated by "---"; otherwise every non-empty line is its own deck (link or "random")
  if (/^\s*---\s*$/m.test(text)) return text.split(/^\s*---\s*$/m).map(s => s.trim()).filter(Boolean);
  return text.split('\n').map(s => s.trim()).filter(Boolean);
}

async function runTourney() {
  const status = t => { $('tourneyStatus').textContent = t; };
  const entries = tourneyEntries($('tourneyDecks').value);
  // Pods are a table's worth of players: four in Commander, two in duel formats
  const P = fmt().seats;
  if (entries.length < P + 1) { status(`Enter at least ${P + 1} decks (${P} fit in a normal game).`); return; }
  const rounds = +$('tourneyRounds').value, perPod = +$('tourneyGames').value;
  $('btnTourneyRun').disabled = true;
  $('btnTourneyStop').hidden = false;
  $('tourneyBar').style.width = '0';
  tourneyStop = false;
  try {
    const decks = [];
    for (const [i, src] of entries.entries()) {
      status(`Loading deck ${i + 1} of ${entries.length}…`);
      const d = await loadDeck(src, msg => status(`Deck ${i + 1}: ${msg}`), { format: formatKey });
      try { await fetchSpellbook(d); } catch { /* the built-in combo list still applies */ }
      decks.push({ deck: d, games: 0, wins: 0, points: 0, place: 0, byes: 0 });
    }
    const podsPerRound = Math.floor(decks.length / P);
    const total = rounds * podsPerRound * perPod;
    let played = 0;
    const fast = { beat: async () => { if (tourneyStop) throw new Abort(); } };
    for (let r = 0; r < rounds && !tourneyStop; r++) {
      // Byes go to the decks that have sat out least so far; everyone else is shuffled into pods
      const shuffled = [...decks].sort(() => Math.random() - 0.5).sort((a, b) => a.byes - b.byes);
      const sit = shuffled.slice(0, decks.length - podsPerRound * P);
      sit.forEach(x => x.byes++);
      const order = shuffled.filter(x => !sit.includes(x));
      for (let k = 0; k < podsPerRound && !tourneyStop; k++) {
        const pod = order.slice(k * P, k * P + P);
        for (let gi = 0; gi < perPod && !tourneyStop; gi++) {
          const g = new Game(pod.map((x, i) => ({ playerName: x.deck.commanders[0]?.name.split(',')[0] || x.deck.deckName || `Deck ${i + 1}`, deckName: x.deck.deckName, color: SEAT_COLORS[i], agent: new Agent(guessStyle(x.deck)), commanders: x.deck.commanders, learnAs: learnAs(x.deck), cards: x.deck.cards })), fast, { format: formatKey });
          await g.run();
          if (!g.over) break;
          recordGame(g);
          g.players.forEach((p, i) => {
            const x = pod[i];
            x.games++;
            x.place += p.place || 4;
            x.points += Math.max(0, 4 - (p.place || 4));
            if (g.winner === p) x.wins++;
          });
          played++;
          $('tourneyBar').style.width = `${(played / total) * 100}%`;
          status(`Round ${r + 1} of ${rounds} · ${played} of ${total} games`);
          renderTourney(decks);
          await sleep(0);
        }
      }
    }
    renderTourney(decks);
    status(tourneyStop ? `Stopped after ${played} games` : `Done: ${played} games`);
  } catch (e) {
    status(`Tournament failed: ${e.message}`);
  } finally {
    $('btnTourneyRun').disabled = false;
    $('btnTourneyStop').hidden = true;
  }
}

// ---------- Friend tournaments (item 143; friendcup.js keeps the pairings and results)
const CUP = 'ct.cup';
let cupDraft = store('ct.cupDraft') || [{ name: 'You', kind: 'you', source: '' }, { name: 'Friend 1', kind: 'friend', source: 'random' }, { name: 'AI 1', kind: 'ai', source: 'random' }, { name: 'AI 2', kind: 'ai', source: 'random' }];
const CUP_KINDS = { you: 'You (this PC)', friend: 'A friend online', ai: 'AI' };
function openCup() { if (game && !clock.paused) togglePlay(); $('cupModal').hidden = false; renderCup(); }
$('btnCup').addEventListener('click', openCup);
$('btnCupClose').addEventListener('click', () => { $('cupModal').hidden = true; });
function renderCup(msg = '') {
  const cup = store(CUP);
  if (!cup) {
    const f = fmt();
    $('cupBody').innerHTML = `<table class="cup-entrants"><thead><tr><th>Player</th><th>Who plays</th><th>Deck (link, list name or <code>random</code>)</th><th></th></tr></thead><tbody>
      ${cupDraft.map((e, i) => `<tr data-i="${i}"><td><input class="input" data-f="name" maxlength="24" value="${esc(e.name)}"></td>
        <td><select class="input" data-f="kind">${Object.entries(CUP_KINDS).map(([k, l]) => `<option value="${k}" ${e.kind === k ? 'selected' : ''}>${l}</option>`).join('')}</select></td>
        <td><input class="input" data-f="source" value="${esc(e.source)}" placeholder="random"></td><td><button class="btn small ghost" data-cup="del" data-i="${i}">✕</button></td></tr>`).join('')}
      </tbody></table>
      <div class="batch-controls"><button class="btn small" data-cup="add" ${cupDraft.length >= 16 ? 'disabled' : ''}>Add player</button>
        <label>Kind <select id="cupMode" class="input"><option value="swiss">Swiss</option><option value="elim">Single elimination</option></select></label>
        <label>Rounds (Swiss) <select id="cupRounds" class="input"><option>3</option><option>4</option><option>5</option></select></label>
        <button class="btn primary" data-cup="start" ${f.manual ? 'disabled' : ''}>Start</button></div>
      <p class="muted">${f.manual ? 'Choose a rules-engine format on the setup screen first (not the manual tabletop).' : `Format: ${esc(f.name)}, pods of ${f.seats}.`} ${esc(msg)}</p>`;
    return;
  }
  const name = ei => (ei < 0 ? '<i>AI fill-in</i>' : esc(cup.entrants[ei].name));
  const people = p => p.seats.some(ei => ei >= 0 && cup.entrants[ei].kind !== 'ai');
  const pods = cup.pods.map((p, k) => `<div class="cup-pod">${p.seats.map((ei, i) => `<span>${p.places ? `<b>${p.places[i]}.</b> ` : ''}${name(ei)}</span>`).join(' · ')}
    ${p.places ? '<span class="muted">done</span>' : `<button class="btn small ${people(p) ? 'primary' : ''}" data-cup="play" data-k="${k}">${people(p) ? 'Play at the table' : 'Play at full speed'}</button>`}</div>`).join('');
  const rows = standings(cup).map((e, i) => `<tr class="${e.out ? 'muted' : ''}"><td class="num">${i + 1}</td><td>${esc(e.name)}</td><td>${CUP_KINDS[e.kind]}</td><td class="num">${e.points}</td><td class="num">${e.wins}</td><td class="num">${e.games}</td><td>${e.out ? 'out' : ''}</td></tr>`).join('');
  $('cupBody').innerHTML = `${cup.done ? `<p class="cup-champion">🏆 <b>${esc(cup.entrants[cup.champion]?.name || '')}</b> wins the tournament.</p>` : `<h3>Round ${cup.round}${cup.mode === 'swiss' ? ` of ${cup.rounds}` : ''}</h3>${pods}`}
    <div class="batch-controls">${!cup.done && cup.pods.some(p => !p.places && !people(p)) ? '<button class="btn small" data-cup="sim">Play all AI pods</button>' : ''}
      ${!cup.done && roundDone(cup) ? '<button class="btn primary" data-cup="next">Next round</button>' : ''}
      <button class="btn small" data-cup="copy">Copy standings</button><button class="btn small ghost" data-cup="end">${cup.done ? 'New tournament' : 'End the tournament'}</button></div>
    <table class="cup-standings"><thead><tr><th class="num">#</th><th>Player</th><th>Plays</th><th class="num">Points</th><th class="num">Wins</th><th class="num">Games</th><th></th></tr></thead><tbody>${rows}</tbody></table>
    <p class="muted">${esc(msg)} Points: 3 for first, then ${fmt().seats > 2 ? '2, 1, 0' : '0'} by place.</p>`;
}
$('cupBody').addEventListener('input', e => {
  const tr = e.target.closest('tr[data-i]'), f = e.target.dataset?.f;
  if (!tr || !f) return;
  cupDraft[+tr.dataset.i][f] = /** @type {HTMLInputElement} */ (e.target).value;
  store('ct.cupDraft', cupDraft);
});
$('cupBody').addEventListener('click', async e => {
  const b = e.target.closest('[data-cup]');
  if (!b) return;
  const act = b.dataset.cup;
  if (act === 'add') { cupDraft.push({ name: `AI ${cupDraft.length}`, kind: 'ai', source: 'random' }); store('ct.cupDraft', cupDraft); renderCup(); return; }
  if (act === 'del') { cupDraft.splice(+b.dataset.i, 1); store('ct.cupDraft', cupDraft); renderCup(); return; }
  if (act === 'start') {
    const entrants = cupDraft.map(x => ({ name: x.name.trim() || 'Player', kind: CUP_KINDS[x.kind] ? x.kind : 'ai', source: x.source.trim() || 'random' }));
    if (entrants.length < 4 || entrants.length > 16) { renderCup('A tournament needs 4 to 16 players.'); return; }
    const cup = newCup({ entrants, mode: $('cupMode').value, rounds: +$('cupRounds').value, pod: fmt().seats, format: formatKey });
    store(CUP, pairRound(cup));
    renderCup();
    return;
  }
  const cup = store(CUP);
  if (!cup) return;
  if (act === 'end') { if (cup.done || confirm('End this tournament? Its results are dropped.')) { store(CUP, null); renderCup(); } return; }
  if (act === 'copy') { navigator.clipboard?.writeText(standingsText(cup)).then(() => { b.textContent = 'Copied'; }).catch(() => {}); return; }
  if (act === 'next') { store(CUP, pairRound(cup)); renderCup(); return; }
  if (act === 'sim' || act === 'play') {
    $('cupBody').querySelectorAll('button').forEach(x => { x.disabled = true; });
    try {
      const people = p => p.seats.some(ei => ei >= 0 && cup.entrants[ei].kind !== 'ai');
      const ks = act === 'play' ? [+b.dataset.k] : cup.pods.map((p, k) => k).filter(k => !cup.pods[k].places && !people(cup.pods[k]));
      for (const k of ks) await playCupPod(k);
    } catch (err) { renderCup(`Couldn't play the pod: ${err.message}`); return; }
    renderCup();
  }
});
async function cupDecks(cup, pod, say) {
  const decks = [];
  for (const [i, ei] of pod.seats.entries()) {
    const src = ei < 0 ? 'random' : cup.entrants[ei].source;
    say(`Loading deck ${i + 1} of ${pod.seats.length}…`);
    decks.push(await loadDeck(src, m => say(`Deck ${i + 1}: ${m}`), { format: cup.format }));
  }
  return decks;
}
async function playCupPod(k) {
  const cup = store(CUP), pod = cup.pods[k];
  const say = t => { const m = $('cupBody').querySelector('.muted:last-child'); if (m) m.textContent = t; };
  if (cup.format !== formatKey) setFormat(cup.format, { quiet: true });
  const decks = await cupDecks(cup, pod, say);
  const seatName = (ei, i) => (ei < 0 ? `AI fill-in ${i + 1}` : cup.entrants[ei].name);
  const record = g => {
    const c = store(CUP);
    if (!c || c.round !== cup.round) return;
    recordPod(c, k, g.players.map(p => (g.winner === p ? 1 : p.place || 2)), g.players.map(p => p.life));
    store(CUP, c);
  };
  const people = pod.seats.some(ei => ei >= 0 && cup.entrants[ei].kind !== 'ai');
  if (!people) {
    // (AI players only: at full speed, off screen)
    const g = new Game(decks.map((d, i) => ({ playerName: seatName(pod.seats[i], i), deckName: d.deckName, color: SEAT_COLORS[i], agent: new Agent(guessStyle(d)), commanders: d.commanders, learnAs: learnAs(d), cards: d.cards })), { beat: async () => {} }, { format: cup.format });
    await g.run();
    record(g);
    return;
  }
  $('cupModal').hidden = true;
  $('setup').hidden = true;
  $('startMenu').hidden = true;
  match = null;
  newGame({
    customSeats: pod.seats.map((ei, i) => ({ name: seatName(ei, i), deck: decks[i], style: ei >= 0 && cup.entrants[ei].kind === 'you' ? 'human' : ei >= 0 && cup.entrants[ei].kind === 'friend' ? 'remote' : guessStyle(decks[i]) })),
    format: cup.format,
    after: g => {
      record(g);
      const c = store(CUP);
      return { html: `Tournament, round ${cup.round}: <b>${esc(g.winner?.name || 'nobody')}</b> wins the pod.${c?.done ? ` 🏆 ${esc(c.entrants[c.champion]?.name || '')} wins the tournament.` : ''}`, buttons: [{ label: 'Back to the tournament', primary: true, fn: openCup }], noRematch: true };
    },
  });
}

function renderTourney(decks) {
  const rows = [...decks].filter(x => x.games).sort((a, b) => b.points / b.games - a.points / a.games || b.wins - a.wins);
  $('tourneyResults').innerHTML = `<table>
    <thead><tr><th class="num">#</th><th>Deck</th><th class="num">Games</th><th class="num">Wins</th><th>Win rate</th><th class="num">Avg place</th><th class="num">Points / game</th><th class="num">Byes</th></tr></thead>
    <tbody>${rows.map((x, i) => {
      const pct = (x.wins / x.games) * 100;
      return `<tr style="--pc:${SEAT_COLORS[i % 4]}"><td class="num">${i + 1}</td><td title="${esc(x.deck.deckName)}">${esc(x.deck.deckName.slice(0, 40))}</td><td class="num">${x.games}</td><td class="num">${x.wins}</td>
        <td><span class="bar" style="width:${Math.max(2, pct * 1.2)}px"></span>${pct.toFixed(0)}%</td><td class="num">${(x.place / x.games).toFixed(2)}</td><td class="num">${(x.points / x.games).toFixed(2)}</td><td class="num">${x.byes}</td></tr>`;
    }).join('')}</tbody></table>
    <p class="muted">Ranked by points per game. In a four-player game a random deck averages 1.5 points and wins 25% of the time.</p>`;
}

// Exit: stop the game and shut down the local PowerShell server
$('btnExit').addEventListener('click', () => {
  if (game && !clock.paused) togglePlay();
  $('exitModal').hidden = false;
});
$('btnExitCancel').addEventListener('click', () => { $('exitModal').hidden = true; });
$('btnExitConfirm').addEventListener('click', async () => {
  clock?.abort();
  $('exitModal').hidden = true;
  let ok = false;
  try { ok = (await fetch('/api/exit', { method: 'POST', headers: { 'X-Commander-Table': 'exit' } })).ok; } catch { /* server already gone */ }
  if (!ok) $('goodbyeMsg').textContent = "Commander Table didn't answer, so it may already be stopped. If its window is still open, close it.";
  $('goodbye').hidden = false;
});

// Undo your last decision: the game is rebuilt from its seed with every earlier answer replayed
function undo() {
  if (!(setup?.human >= 0) || !setup.decisions.length) return;
  // (no take-backs in a ranked game)
  if (setup.ranked && !setup.progressed) return;
  undoFrom('h', setup.decisions.length - 1);
}
// Every live answer in order ({ who: 'h' or a friend's seat, i: index in that record }), so undoing one
// answer also drops everything anyone answered after it (those questions may not come up again)
function noteAnswer(who, i) { (setup.order ||= []).push({ who, i }); autosave(); }
function recordOf(who) { return who === 'h' ? setup.decisions : setup.remoteDecisions[who]; }
function undoFrom(who, i) {
  const order = setup.order || [];
  const at = order.findIndex(x => x.who === who && x.i === i);
  for (const x of at >= 0 ? order.slice(at) : [{ who, i }]) {
    const rec = recordOf(x.who);
    if (rec && rec.length > x.i) rec.length = x.i;
  }
  if (at >= 0) order.length = at;
  $('results').hidden = true;
  newGame({ replay: true, untilLive: true });
}
function answerUndo(allow) {
  const seat = $('undoAsk').dataset.seat;
  $('undoAsk').hidden = true;
  $('undoAsk').dataset.seat = '';
  room.undoAck(seat, allow);
  if (allow) friendUndo(+seat);
}
$('btnUndoAllow').addEventListener('click', () => answerUndo(true));
$('btnUndoDeny').addEventListener('click', () => answerUndo(false));
// A friend asked to take back their last decision: the host allows it (or not)
function friendUndo(seat) {
  const rec = setup?.remoteDecisions?.[seat];
  if (!rec?.length) return;
  undoFrom(seat, rec.length - 1);
  game?.log(`${esc(setup.seats[seat].name)}'s last decision is taken back`, { kind: 'minor' });
}
$('tlUndo').addEventListener('click', undo);

document.addEventListener('keydown', e => {
  if (e.target.matches?.('input, textarea, select')) return;
  // When it's your decision, the keys answer the action bar first
  if (humanUI.key(e)) return;
  if (e.key === 'u' || ((e.ctrlKey || e.metaKey) && e.key === 'z')) { e.preventDefault(); undo(); return; }
  if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
  if (e.key === 'n' || e.key === 'ArrowRight') $('btnStep').click();
  // Your own zones: G graveyard, X exile, L library, Esc closes
  const me = game?.players[setup?.human ?? -1];
  const zone = { g: 'graveyard', x: 'exile', l: 'library' }[e.key.toLowerCase()];
  if (zone && me && view && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); view.openZone(me, zone); }
  if (e.key === 'Escape' && !$('zoneModal').hidden) $('zoneModal').hidden = true;
});

// Tabs + rules panel
document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));
function showTab(name) {
  document.querySelectorAll('.tabs button').forEach(x => x.classList.toggle('active', x.dataset.tab === name));
  document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x.id === `tab-${name}`));
}
document.addEventListener('click', e => {
  const r = e.target.closest('[data-rule]');
  if (!r) return;
  showTab('rules');
  $('rulesSearch').value = r.dataset.rule;
  searchRules();
});

let rulesTimer;
$('rulesSearch').addEventListener('input', () => { clearTimeout(rulesTimer); rulesTimer = setTimeout(searchRules, 150); });
function highlight(text, q) {
  let h = esc(text);
  if (/^\d/.test(q)) return h;
  for (const w of q.toLowerCase().split(/\s+/).filter(x => x.length > 1)) h = h.replace(new RegExp(`(${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'), '<mark>$1</mark>');
  return h;
}
function searchRules() {
  const q = $('rulesSearch').value;
  const out = $('rulesResults');
  if (!Rules.loaded) { out.innerHTML = ''; return; }
  const { rules, glossary } = Rules.search(q);
  out.innerHTML = glossary.map(g => `<div class="gl"><b>${esc(g.term)}</b>${highlight(g.def, q)}</div>`).join('')
    + rules.map(r => `<div class="ri ${/^\d{3}(\.\d+)?$/.test(r.id) ? 'head' : ''}"><span class="rid" data-rule="${r.id}">${r.id}</span>${highlight(r.text, q)}</div>`).join('')
    + (q && !rules.length && !glossary.length ? '<p class="muted">No matches.</p>' : '');
}

// Rules glossary (item 181): hover a keyword in the log or a card's text for its Comprehensive Rules entry
{
  const tip = document.createElement('div');
  tip.className = 'kw-tooltip';
  tip.hidden = true;
  document.body.append(tip);
  document.addEventListener('mouseover', e => {
    const k = /** @type {HTMLElement | null} */ (/** @type {any} */ (e.target).closest?.('.kw-tip'));
    if (!k) { tip.hidden = true; return; }
    const r = Rules.get(k.dataset.kw), a = Rules.get(`${k.dataset.kw}a`);
    if (!r) return;
    tip.innerHTML = `<b>${esc(r.text)}</b> <span class="muted">${esc(k.dataset.kw)}</span><div>${esc((a?.text || '').slice(0, 420))}${(a?.text || '').length > 420 ? '…' : ''}</div>`;
    const b = k.getBoundingClientRect();
    tip.hidden = false;
    tip.style.left = `${Math.max(8, Math.min(innerWidth - tip.offsetWidth - 8, b.left))}px`;
    tip.style.top = `${b.bottom + 6 + tip.offsetHeight > innerHeight ? b.top - tip.offsetHeight - 6 : b.bottom + 6}px`;
  });
}
Rules.load().then(() => {
  if (Rules.loaded) {
    $('rulesMeta').innerHTML = `${Rules.entries.length.toLocaleString()} rules and ${Rules.glossary.length} glossary terms${Rules.effective ? `, effective ${esc(Rules.effective)}` : ''}. ${Rules.source ? `<a href="${esc(Rules.source)}" target="_blank" rel="noopener">Source</a>` : ''}`;
    if (!$('rulesSearch').value) { $('rulesSearch').value = '903'; }
    searchRules();
  } else {
    $('rulesMeta').textContent = `Couldn't load the Comprehensive Rules: ${Rules.error}. Open the game with Commander Table.exe (or start.bat) so it can download them.`;
  }
});

installPreview(iid => game?.objects.get(iid));
installDetails(iid => game?.objects.get(iid), () => view);
renderSeats();
if (location.protocol === 'file:') $('setupStatus').textContent = 'Open this game with Commander Table.exe or start.bat. Deck import needs its local server.';
// First visit: a short tour of the setup screen (remembered; the Tour button shows it again)
// ---------- Learn to play (tutorial.js): lessons with a coach beside the table
document.addEventListener('click', e => { if (e.target.id === 'btnCoachHide') $('coach').hidden = true; });
function renderLearn() {
  const done = lessonsDone();
  $('learnList').innerHTML = LESSONS.map((l, i) => {
    const next = !done[l.id] && LESSONS.slice(0, i).every(x => done[x.id]);
    return `<div class="standing"><div class="place">${done[l.id] ? '✔' : i + 1}</div><div class="meta"><b>${esc(l.name)}</b><br><span class="muted">Goal: ${esc(l.goal)}</span></div><button class="btn small ${next ? 'primary' : ''}" data-lesson="${i}">${done[l.id] ? 'Again' : 'Start'}</button></div>`;
  }).join('');
}
function startLesson(i) {
  const l = LESSONS[i];
  startPuzzle(lessonPuzzle(l), {
    coach: coachHtml(l, i),
    after: g => {
      const ok = g.winner === g.players[0];
      if (ok) markLesson(l.id);
      const next = LESSONS[i + 1];
      return {
        html: ok ? `✔ <b>Lesson complete.</b> ${next ? `Next up: ${esc(next.name)}.` : 'That was the last lesson: you know enough to play a real game. Try "Seat a cEDH table", a random deck, or the Story.'}` : 'Not quite this time. The coach’s steps are still beside the table; try again.',
        buttons: [...(ok && next ? [{ label: `Next lesson: ${next.name}`, primary: true, fn: () => startLesson(i + 1) }] : []), { label: 'Try again', primary: !ok, fn: () => startLesson(i) }, { label: 'All lessons', fn: () => { renderLearn(); $('learnModal').hidden = false; } }],
      };
    },
  }, t => { $('learnStatus').textContent = t; }).catch(err => { $('learnStatus').textContent = `Couldn't start the lesson: ${err.message}`; });
}
$('btnLearn').addEventListener('click', () => { renderLearn(); $('learnModal').hidden = false; });
$('btnLearnClose').addEventListener('click', () => { $('learnModal').hidden = true; });
$('learnList').addEventListener('click', e => { const b = e.target.closest('[data-lesson]'); if (b) startLesson(+b.dataset.lesson); });

// ---------- Story (story.js): chapters of The Lantern Road
function renderStory() {
  const done = storyDone();
  $('storyList').innerHTML = CHAPTERS.map((c, i) => {
    const open = chapterOpen(i, done);
    return `<div class="story-ch ${open ? '' : 'locked'}"><h3>${esc(c.name)} ${done[c.id] ? '<span class="good">✔</span>' : ''}</h3>
      ${open ? c.story.map(p => `<p>${esc(p)}</p>`).join('') : '<p class="muted">Win the chapter before to read on.</p>'}
      ${open ? `<button class="btn small ${done[c.id] ? '' : 'primary'}" data-ch="${i}">${done[c.id] ? 'Play again' : 'Play this chapter'}</button> <span class="muted">Goal: ${esc(c.goal)}</span>` : ''}</div>`;
  }).join('');
}
function startChapter(i) {
  const c = CHAPTERS[i];
  startPuzzle(chapterPuzzle(c), {
    after: g => {
      const ok = g.winner === g.players[0];
      if (ok) markChapter(c.id);
      const next = CHAPTERS[i + 1];
      return {
        html: ok ? `✔ <b>${esc(c.name)}: won.</b> ${next ? `The road goes on: ${esc(next.name)}.` : 'The last lantern is lit again. The end, for now.'}` : 'The road is not done with you yet. Try again.',
        buttons: [...(ok && next ? [{ label: `Next: ${next.name}`, primary: true, fn: () => { renderStory(); $('storyModal').hidden = false; } }] : []), { label: 'Try again', primary: !ok, fn: () => startChapter(i) }, { label: 'All chapters', fn: () => { renderStory(); $('storyModal').hidden = false; } }],
      };
    },
  }, t => { $('storyStatus').textContent = t; }).catch(err => { $('storyStatus').textContent = `Couldn't start the chapter: ${err.message}`; });
}
$('btnStory').addEventListener('click', () => { renderStory(); $('storyModal').hidden = false; });
$('btnStoryClose').addEventListener('click', () => { $('storyModal').hidden = true; });
$('storyList').addEventListener('click', e => { const b = e.target.closest('[data-ch]'); if (b) startChapter(+b.dataset.ch); });

// ---------- Expedition (campaign.js): the roguelike
const exSay = t => { $('expeditionStatus').textContent = t; };
function openExpedition() { renderExpedition(); $('expeditionModal').hidden = false; }
$('btnExpedition').addEventListener('click', openExpedition);
$('btnExpeditionClose').addEventListener('click', () => { $('expeditionModal').hidden = true; });
async function renderExpedition() {
  const r = runState();
  const body = $('expeditionBody');
  const st = stats();
  if (!r || r.over) {
    body.innerHTML = `${r?.over ? `<div class="match-box"><b>${r.result === 'won' ? '♛ The expedition reached the summit!' : r.result === 'lost' ? 'The expedition is over.' : 'The expedition was abandoned.'}</b><br><span class="muted">${r.wins} of ${r.fights} fights won · ${esc(r.log.slice(-3).join(' '))}</span></div>` : ''}
      <p class="muted">${st.runs} expedition${st.runs === 1 ? '' : 's'} so far, ${st.won} reached the summit.</p>
      <div class="limited-start"><label>Set <select id="exSet" class="input">${SUGGESTED_SETS.map(([c, n]) => `<option value="${c}">${esc(n)}</option>`).join('')}</select></label>
      ${Object.entries(DIFFICULTY).map(([k, d]) => `<label title="${esc(d.about)}"><input type="radio" name="exDiff" value="${k}" ${k === 'normal' ? 'checked' : ''}> ${d.name}</label>`).join('')}
      <button class="btn primary" id="btnExStart">Set out</button></div>
      <p class="muted">${Object.values(DIFFICULTY).map(d => `<b>${d.name}:</b> ${esc(d.about)}.`).join(' ')}</p>`;
    $('btnExStart').onclick = async () => {
      try {
        const set = $('exSet').value;
        await startRun({ set, setName: SUGGESTED_SETS.find(x => x[0] === set)?.[1] || set, difficulty: document.querySelector('input[name="exDiff"]:checked').value, onStatus: exSay });
        exSay('');
        renderExpedition();
      } catch (err) { exSay(`Couldn't set out: ${err.message}`); }
    };
    return;
  }
  const D = DIFFICULTY[r.difficulty];
  const head = `<div class="ex-head"><b>Act ${r.act + 1}: ${esc(actName(r.act))}</b> · step ${r.step + 1} of ${r.map[r.act].length} · ${esc(r.setName)} · ${D.name}
    · deck: ${r.deck.length} cards + lands · ${r.wins} win${r.wins === 1 ? '' : 's'}${r.lifeNext ? ` · +${r.lifeNext} life next fight` : ''}${D.forgive ? ` · ${r.forgiven[r.act] ? 'this act’s forgiven loss is used' : 'one loss forgiven this act'}` : ''}</div>
    <div class="ex-map">${r.map.map((act, a) => `<div class="ex-act ${a === r.act ? 'now' : a < r.act ? 'past' : ''}"><small>Act ${a + 1}</small>${act.map((step, s) => `<span class="ex-step ${a === r.act && s === r.step ? 'now' : a < r.act || (a === r.act && s < r.step) ? 'past' : ''}">${step.map(k => NODE[k].icon).join(' / ')}</span>`).join('→')}</div>`).join('')}</div>`;
  // A reward waiting: one of three cards
  if (r.pending?.reward) {
    body.innerHTML = `${head}<h3>Choose a card for your deck</h3><div class="lim-grid" id="exReward"><p class="muted">Loading…</p></div><button class="btn small ghost" id="btnExSkip">Skip the reward</button>`;
    const choices = await rewardChoices(r, r.pending.reward);
    $('exReward').innerHTML = choices.map(c => `<div class="lim-card" data-name="${esc(c.name)}" title="${esc(c.name)}">${c.imgNormal ? `<img src="${esc(c.imgNormal)}" alt="${esc(c.name)}">` : ''}<span class="lim-name">${esc(c.name)}</span></div>`).join('');
    $('exReward').onclick = e => { const el = e.target.closest('.lim-card'); if (el) { takeReward(r, el.dataset.name); renderExpedition(); } };
    $('btnExSkip').onclick = () => { takeReward(r, null); renderExpedition(); };
    return;
  }
  const choices = currentChoices(r);
  body.innerHTML = `${head}<h3>Choose your road</h3><div class="ex-choices">${choices.map((k, i) => `<button class="ex-node" data-node="${i}"><span class="ex-icon">${NODE[k].icon}</span><b>${NODE[k].name}</b><small>${esc(NODE[k].text)}</small></button>`).join('')}</div>
    <details><summary>Your deck (${r.deck.length} cards, lands are added for each fight)</summary><p class="muted">${r.deck.map(esc).join(', ')}</p></details>
    <details><summary>The road so far</summary><p class="muted">${r.log.slice(-12).map(esc).join('<br>')}</p></details>
    <p><button class="btn small ghost" id="btnExAbandon">Abandon the expedition</button></p>`;
  $('btnExAbandon').onclick = () => { if (confirm('Abandon this expedition?')) { abandonRun(); renderExpedition(); } };
  body.querySelectorAll('[data-node]').forEach(b => b.addEventListener('click', () => goNode(r, choices[+b.dataset.node])));
}
async function goNode(r, kind) {
  const body = $('expeditionBody');
  try {
    if (kind === 'event' || kind === 'rest') return nodeChoice(r, kind);
    exSay('Building the decks…');
    const mine = await yourDeck(r, exSay);
    const rival = await rivalDeck(r, kind, exSay);
    exSay('');
    $('expeditionModal').hidden = true;
    $('setup').hidden = true;
    match = null;
    newGame({
      customSeats: [{ name: 'You', deck: mine, style: 'human' }, { name: rival.name, deck: rival.deck, style: guessStyle(rival.deck), bracket: DIFFICULTY[r.difficulty].bracket }],
      format: 'limited', lifeBonus: fightLife(r, kind),
      after: g => {
        const won = g.winner === g.players[0];
        const cur = runState();
        if (cur && cur.seed === r.seed) fightOver(cur, kind, won);
        const after = runState();
        return {
          html: won ? `✔ <b>You won the ${NODE[kind].name.toLowerCase()}.</b>${after?.over && after.result === 'won' ? ' ♛ The expedition reached the summit!' : ' Choose a card for your deck.'}` : after?.over ? '<b>The expedition is over.</b>' : 'Lost, but Easy forgives one loss this act. The road goes on.',
          buttons: [{ label: 'Back to the expedition', primary: true, fn: openExpedition }], noRematch: true,
        };
      },
    });
  } catch (err) { exSay(`Couldn't start the fight: ${err.message}`); body.querySelectorAll('button').forEach(b => { b.disabled = false; }); }
}
// Events and rest stops: choices without a fight
async function nodeChoice(r, kind) {
  const body = $('expeditionBody');
  const deckList = (n, label) => `<p class="muted">${label}</p><div class="ex-pick">${r.deck.map((c, i) => `<label><input type="checkbox" data-i="${i}"> ${esc(c)}</label>`).join('')}</div><button class="btn primary" id="btnExRemove" data-n="${n}">Leave them behind</button>`;
  const removePicked = () => [...body.querySelectorAll('.ex-pick input:checked')].map(x => r.deck[+x.dataset.i]);
  if (kind === 'rest') {
    body.innerHTML = `<h3>☕ A rest stop</h3><p>A fire, a roof, and a quiet hour. Rest, or sort through your pack.</p>
      <button class="btn primary" id="btnExRest">Rest: +3 life in the next fight</button>
      ${deckList(1, 'Or leave one card behind:')}`;
    $('btnExRest').onclick = () => { resolveEvent(r, 'life', 3); renderExpedition(); };
  } else {
    const ev = eventFor(r);
    body.innerHTML = `<h3>✦ ${esc(ev.text)}</h3><div id="exEvent"></div>`;
    const box = $('exEvent');
    if (ev.choice === 'life4') { box.innerHTML = '<button class="btn primary" id="btnExOk">Thank the healer</button>'; $('btnExOk').onclick = () => { resolveEvent(r, 'life', 4); renderExpedition(); }; return; }
    if (ev.choice === 'remove2') { box.innerHTML = deckList(2, 'Choose up to two cards:'); }
    if (ev.choice === 'rare' || ev.choice === 'swap') {
      const choices = await rewardChoices(r, ev.choice === 'rare' ? 'elite' : 'duel');
      box.innerHTML = `${ev.choice === 'swap' ? `<p class="muted">First choose the card you give him:</p><select id="exGive" class="input">${r.deck.map((c, i) => `<option value="${i}">${esc(c)}</option>`).join('')}</select>` : ''}
        <div class="lim-grid" id="exGain">${choices.map(c => `<div class="lim-card" data-name="${esc(c.name)}" title="${esc(c.name)}">${c.imgNormal ? `<img src="${esc(c.imgNormal)}" alt="">` : ''}<span class="lim-name">${esc(c.name)}</span></div>`).join('')}</div>
        <button class="btn small ghost" id="btnExPass">Walk on</button>`;
      $('exGain').onclick = e => {
        const el = e.target.closest('.lim-card');
        if (!el) return;
        if (ev.choice === 'swap') r.deck.splice(+$('exGive').value, 1);
        resolveEvent(r, 'add', el.dataset.name);
        renderExpedition();
      };
      $('btnExPass').onclick = () => { resolveEvent(r, 'life', 0); renderExpedition(); };
      return;
    }
  }
  const btn = $('btnExRemove');
  if (btn) btn.onclick = () => {
    const pick = removePicked();
    if (pick.length > +btn.dataset.n) { exSay(`Choose at most ${btn.dataset.n}.`); return; }
    if (r.deck.length - pick.length < 8) { exSay('Keep at least 8 cards besides your lands.'); return; }
    resolveEvent(r, 'remove', pick);
    renderExpedition();
  };
}

// ---------- Challenge links (challenge.js)
$('btnChallenge').addEventListener('click', () => { $('challengeStatus').textContent = ''; $('challengeModal').hidden = false; });
$('btnChallengeClose').addEventListener('click', () => { $('challengeModal').hidden = true; });
$('btnChallengeMake').addEventListener('click', async () => {
  const table = { format: formatKey, bestOf: +(prefs.bestOf || 1), seats: seats.map(s => ({ name: s.name, style: s.style === 'remote' ? 'auto' : s.style, bracket: s.bracket, source: s.deck && !/^https?:\/\//.test(s.source.trim()) && s.source.trim() ? deckText(s.deck) : s.source })) };
  const code = await encodeChallenge(table);
  $('challengeCode').value = code;
  $('challengeLink').value = challengeLink(code);
  $('challengeStatus').textContent = `${code.length.toLocaleString()} characters. The link opens on any PC running Commander Table.`;
});
$('btnChallengeCopy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('challengeLink').value || ''); $('challengeStatus').textContent = 'Link copied.'; } catch { $('challengeStatus').textContent = 'Couldn\'t reach the clipboard; select the link and copy it.'; }
});
$('btnChallengeOpen').addEventListener('click', () => openChallenge($('challengeCode').value).catch(err => { $('challengeStatus').textContent = `Couldn't open it: ${err.message}`; }));
const STYLE_OK = new Set(['auto', 'human', ...Object.keys(STYLES)]);
async function openChallenge(code) {
  const data = await decodeChallenge(code);
  if (data.puzzle) { $('challengeModal').hidden = true; return startPuzzle(data.puzzle); }
  const f = FORMATS[data.format] ? data.format : 'commander';
  setFormat(f, { quiet: true });
  if (data.bestOf) { prefs.bestOf = data.bestOf === 3 ? 3 : 1; store('ct.prefs', prefs); syncFormatUI(); }
  (data.seats || []).slice(0, seats.length).forEach((s, i) => Object.assign(seats[i], {
    name: String(s.name || seats[i].name).slice(0, 24), style: STYLE_OK.has(s.style) ? s.style : 'auto',
    bracket: [1, 2, 3, 4, 5].includes(s.bracket) ? s.bracket : null, source: String(s.source || '').slice(0, 200000), deck: null,
  }));
  persist();
  renderSeats();
  $('challengeModal').hidden = true;
  $('setup').hidden = false;
  $('setupStatus').textContent = `Challenge loaded: ${formatOf(f).name}, ${seats.map(s => s.name).join(', ')}. Click "Load decks & shuffle up" to play it.`;
}
// A challenge link opened in the address bar (it skips the start menu)
const openedChallenge = /^#challenge=/.test(location.hash);
if (openedChallenge) {
  const code = location.hash.slice(1);
  history.replaceState(null, '', location.pathname);
  openChallenge(code).catch(err => { $('setupStatus').textContent = `Couldn't open the challenge link: ${err.message}`; });
}

// ---------- Deck builder (builder.js)
function builder(i = 0) {
  openBuilder({
    format: formatKey, deck: seats[i]?.deck || null, seats: seats.map(s => s.name), seatIndex: i,
    onUse: (text, name, seat) => { Object.assign(seats[seat], { source: text, deck: null }); persist(); renderSeats(); $('setupStatus').textContent = `${name || 'The deck'} is in ${seats[seat].name}'s seat.`; },
    onSave: async (text, name) => { try { const n = await saveDeck(name, text); $('setupStatus').textContent = `Saved "${n}" to the deck library.`; } catch (err) { $('setupStatus').textContent = `Couldn't save: ${err.message}`; } },
  });
}
$('btnBuilder').addEventListener('click', () => builder(0));
$('seats').addEventListener('click', e => { const b = e.target.closest('.sbuild'); if (b) builder(+b.dataset.i); });

// ---------- Tabletop (manual.js): fully manual, 2–9 players (Kingdoms 5–9 with secret roles).
// Friends online send their moves one at a time; seats played on this PC share it, and "Viewing as" picks
// whose hand and role this screen shows (nobody's, to pass the device).
let tabletop = null, ttTimer = null, tabletopInvite = false, ttViewer = -1;
const localSeats = () => seats.map((s, i) => (s.style === 'remote' ? -1 : i)).filter(i => i >= 0);
function drawTabletop() {
  if (!tabletop) return;
  const local = localSeats();
  if (!local.includes(ttViewer)) ttViewer = local.length === 1 ? local[0] : -1;
  const v = tabletop.view(ttViewer);
  // This page moves the seats played here (a friend's cards are theirs to move)
  const mineHere = a => {
    if (a.id) { const f = tabletop.find(a.id); return !!f && local.includes(f.p.idx); }
    if (a.k === 'pass' || a.k === 'phase') return local.includes(tabletop.active);
    return local.includes(a.p);
  };
  const viewers = local.length > 1 ? [{ seat: -1, name: 'Nobody (pass the device)' }, ...local.map(i => ({ seat: i, name: seats[i].name }))] : null;
  renderTabletop($('tabletopBody'), v, {
    canAct: i => local.includes(i), viewers, onView: s => { ttViewer = s; drawTabletop(); },
    act: a => { if (mineHere(a) && tabletop.apply(null, a)) { pushTabletop(); drawTabletop(); } },
  });
}
function pushTabletop() { if (!tabletop || !room.code) return; for (const i of room.seats) room.state(i, tabletop.view(i)); }
async function startTabletop(loaded = null) {
  try {
    // (the last game stops, and stops sending its table to friends: the room is the tabletop's now)
    clock?.abort();
    game = null;
    $('results').hidden = true;
    $('startMenu').hidden = true;
    const f = fmt();
    if (f.roles && (seats.length < 5 || seats.length > 9)) { $('setupStatus').textContent = 'Kingdoms needs 5 to 9 players: choose the number of players above.'; $('setup').hidden = false; return; }
    $('setupStatus').textContent = 'Loading decks for the tabletop…';
    if (loaded) tabletop = loaded;
    else for (const [i, s] of seats.entries()) if (!s.deck || (s.deck.format || 'commander') !== formatKey) await loadSeatDeck(s, msg => seatStatus(i, esc(msg)));
    if (!loaded) tabletop = new Tabletop(seats.map(s => ({ name: s.name, color: s.color, deck: s.deck, remote: s.style === 'remote' })), { life: f.manual ? +(prefs.tableLife || f.life) : f.life, kingdoms: !!f.roles });
    ttViewer = -1;
    $('setupStatus').textContent = '';
    $('setup').hidden = true;
    $('tabletop').hidden = false;
    drawTabletop();
    const friends = seats.map((s, i) => (s.style === 'remote' ? i : -1)).filter(i => i >= 0);
    $('btnTabletopInvite').hidden = !friends.length;
    if (friends.length) {
      tabletopInvite = true;
      if (!(await openRoom([...friends, -1]))) { $('tabletopNet').textContent = `Online seats need the local server (${room.error})`; return; }
      pushTabletop();
      // Friends' moves: each one numbered; the state tells them which was applied, then they send the next
      ttTimer = setInterval(async () => {
        if (!tabletop) return;
        let changed = false;
        for (const i of friends) {
          const a = await room.answer(i);
          // (a refused move is still acknowledged, so the friend's page sends the next one)
          if (a?.manual && a.seq > (tabletop.acks[i] || 0)) { tabletop.acks[i] = a.seq; tabletop.apply(i, a.act); changed = true; }
        }
        if (changed) { drawTabletop(); pushTabletop(); }
        $('tabletopNet').textContent = friends.map(i => `${seats[i].name}: ${room.seen(i) < 0 ? 'not joined' : room.seen(i) > 12 ? 'disconnected' : 'here'}`).join(' · ');
      }, 400);
    }
  } catch (err) { $('setupStatus').textContent = `Couldn't open the tabletop: ${err.message}`; $('setup').hidden = false; }
}
$('btnTabletop').addEventListener('click', () => startTabletop());
// Save and load a tabletop (item 138). The seats are set from the save: names, colors, and which are friends online
$('btnTabletopSave').addEventListener('click', () => {
  if (!tabletop) return;
  download(`tabletop-${stamp()}.json`, JSON.stringify({ tabletop: tabletop.save() }));
});
$('btnTabletopLoad').addEventListener('click', () => $('tabletopFile').click());
$('tabletopFile').addEventListener('change', async e => {
  const file = /** @type {HTMLInputElement} */ (e.target).files?.[0];
  /** @type {HTMLInputElement} */ (e.target).value = '';
  if (!file) return;
  try {
    const t = Tabletop.load(JSON.parse(await file.text()).tabletop);
    const n = t.players.length;
    if (n > allSeats.length) throw new Error(`too many players (${n})`);
    if (t.kingdoms) prefs.kingdomsMode = 'manual';
    prefs.tablePlayers = n;
    store('ct.prefs', prefs);
    setFormat(t.kingdoms ? 'kingdoms' : 'manual', { quiet: true });
    seats = allSeats.slice(0, seatCount());
    t.players.forEach((p, i) => { const s = allSeats[i]; s.name = p.name; s.color = p.color; if (p.remote) s.style = 'remote'; else if (s.style === 'remote') s.style = 'human'; });
    persist();
    renderSeats();
    await startTabletop(t);
  } catch (err) { $('setupStatus').textContent = `Couldn't load the table: ${err.message}`; }
});
$('btnTabletopInvite').addEventListener('click', () => showInvite());
$('btnTabletopClose').addEventListener('click', () => {
  if (!confirm('Leave the tabletop? Use Save table first to carry on later.')) return;
  clearInterval(ttTimer); ttTimer = null; tabletop = null; tabletopInvite = false;
  if (room.code) room.close();
  $('tabletop').hidden = true;
  $('setup').hidden = false;
});
const toured = () => { prefs.toured = true; store('ct.prefs', prefs); };
$('btnTour').addEventListener('click', () => startTour(toured));

// ---------- New card sets (sets.js): checked once a day at startup, and from Updates
function setsHtml(r) {
  const st = setsState();
  const when = st.checkedAt ? new Date(st.checkedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'never';
  const line = s => `<b>${esc(s.name)}</b> (${esc(s.code.toUpperCase())}, ${esc(s.released)}, ${s.count} cards)`;
  if (!r) return `Last checked: ${when}.${st.list.length ? ` Newest: ${line(st.list.find(s => s.released <= new Date().toISOString().slice(0, 10)) || st.list[0])}.` : ''}`;
  return `${r.first ? 'First check: from now on, new sets are reported here.' : r.added.length ? `<b>New since the last check:</b> ${r.added.map(line).join(', ')}. Saved card data will be refreshed as decks need it.` : 'No new sets since the last check.'}
    ${r.upcoming.length ? `<br>Coming soon: ${r.upcoming.slice(0, 4).map(line).join(', ')}.` : ''}<br><span class="muted">Checked ${when}.</span>`;
}
$('setsAuto').checked = prefs.autoSets !== false;
$('setsAuto').addEventListener('change', e => { prefs.autoSets = e.target.checked; store('ct.prefs', prefs); });
$('btnSetsCheck').addEventListener('click', async () => {
  $('setsBody').textContent = 'Asking Scryfall…';
  try { const r = await checkSets(); $('setsBody').innerHTML = setsHtml(r); refreshSetLists(); renderMenu(r); } catch (err) { $('setsBody').textContent = `Couldn't reach Scryfall: ${err.message}`; }
});
$('btnUpdates').addEventListener('click', () => { $('setsBody').innerHTML = setsHtml(null); showBulk(); showPrints(); showImages(); });
// ---------- Help window (item 184): data/help.json (tools/help.mjs builds it from README.md), searchable
let help = null;
// (README's own Markdown: bold, code, links, lists and tables, enough for the manual)
function mdToHtml(md) {
  const inline = s => esc(s).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  const out = [];
  let list = null, table = null;
  const flush = () => { if (list) { out.push(`<ul>${list.join('')}</ul>`); list = null; } if (table) { out.push(`<table class="help-table">${table.join('')}</table>`); table = null; } };
  for (const raw of md.split('\n')) {
    const line = raw.replace(/\s+$/, '');
    const li = line.match(/^(\s*)[-*] (.+)$/);
    if (/^\|/.test(line)) { if (list) flush(); if (/^\|[\s|:-]+\|$/.test(line)) continue; (table ||= []).push(`<tr>${line.split('|').slice(1, -1).map(c => `<td>${inline(c.trim())}</td>`).join('')}</tr>`); continue; }
    if (li) { if (table) flush(); (list ||= []).push(`<li${li[1].length ? ' class="sub"' : ''}>${inline(li[2])}</li>`); continue; }
    flush();
    if (/^```/.test(line)) continue;
    if (line.trim()) out.push(`<p>${inline(line)}</p>`);
  }
  flush();
  return out.join('');
}
function renderHelp(focus = null) {
  const q = $('helpSearch').value.trim().toLowerCase();
  const words = q.split(/\s+/).filter(Boolean);
  const hits = help.sections.map((s, i) => ({ s, i, score: words.length ? words.reduce((a, w) => a + (s.title.toLowerCase().includes(w) ? 5 : 0) + (s.text.toLowerCase().split(w).length - 1), 0) : 1 }))
    .filter(x => !words.length || words.every(w => `${x.s.title} ${x.s.text}`.toLowerCase().includes(w)));
  if (words.length) hits.sort((a, b) => b.score - a.score);
  $('helpToc').innerHTML = hits.map(x => `<button class="help-link ${x.s.parent ? 'sub' : ''}" data-h="${x.i}">${esc(x.s.title)}</button>`).join('') || '<p class="muted">Nothing found.</p>';
  const show = focus ?? hits[0]?.i;
  if (show == null) { $('helpBody').innerHTML = ''; return; }
  const s = help.sections[show];
  let html = mdToHtml(s.text);
  // (search words are highlighted in the text, not inside tags)
  if (words.length) html = html.split(/(<[^>]*>)/).map(p => (p.startsWith('<') ? p : words.reduce((t, w) => t.replace(new RegExp(`(${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'), '<mark>$1</mark>'), p))).join('');
  $('helpBody').innerHTML = `<h3>${s.parent ? `<span class="muted">${esc(s.parent)} › </span>` : ''}${esc(s.title)}</h3>${html}`;
  $('helpToc').querySelectorAll('.help-link').forEach(b => b.classList.toggle('active', +(/** @type {HTMLElement} */ (b)).dataset.h === show));
  $('helpBody').scrollTop = 0;
}
async function openHelp() {
  try { help ||= await (await fetch('data/help.json', { cache: 'no-store' })).json(); } catch { return; }
  $('helpModal').hidden = false;
  renderHelp();
  setTimeout(() => $('helpSearch').focus(), 0);
}
$('btnHelpClose').addEventListener('click', () => { $('helpModal').hidden = true; });
$('helpSearch').addEventListener('input', () => renderHelp());
$('helpToc').addEventListener('click', e => { const b = e.target.closest('[data-h]'); if (b) renderHelp(+b.dataset.h); });
// ---------- What's new (item 182): data/whatsnew.json (tools/whatsnew.mjs builds it from ROADMAP.md at release), shown
// once after an update; Updates has a button for it too
let whatsNew = null;
function renderWhatsNew() {
  const q = $('whatsNewSearch').value.trim().toLowerCase();
  const items = whatsNew.items.filter(i => !q || `${i.title} ${i.done} ${i.section}`.toLowerCase().includes(q));
  const sections = [...new Set(items.map(i => i.section))];
  $('whatsNewBody').innerHTML = sections.map(s => `<h3>${esc(s || 'Other')}</h3><ul class="whatsnew">${items.filter(i => i.section === s).map(i => `<li><b>${esc(i.title)}</b>${i.done ? `<details><summary class="muted">How it works</summary><p class="muted">${esc(i.done)}</p></details>` : ''}</li>`).join('')}</ul>`).join('') || '<p class="muted">Nothing matches.</p>';
}
async function showWhatsNew(auto = false) {
  try { whatsNew ||= await (await fetch('data/whatsnew.json', { cache: 'no-store' })).json(); } catch { return; }
  if (!whatsNew?.items?.length) return;
  if (auto) {
    // (the first start only remembers the version; an update since the last start shows the window)
    const seen = prefs.seenVersion;
    prefs.seenVersion = whatsNew.version; store('ct.prefs', prefs);
    if (!seen || seen === whatsNew.version) return;
  }
  $('whatsNewTitle').textContent = `What's new in ${whatsNew.version}`;
  $('whatsNewIntro').textContent = `${whatsNew.round}: ${whatsNew.items.length} improvements. The full list with every detail is in ROADMAP.md in the game folder.`;
  renderWhatsNew();
  $('whatsNewModal').hidden = false;
}
$('btnWhatsNew').addEventListener('click', () => showWhatsNew());
$('btnWhatsNewClose').addEventListener('click', () => { $('whatsNewModal').hidden = true; });
$('whatsNewSearch').addEventListener('input', renderWhatsNew);
setTimeout(() => showWhatsNew(true), 1500);
// ---------- card images (item 158): the image folder's size and cap, and downloading every image a library deck uses
async function showImages(msg = '') {
  try {
    const r = await (await fetch('/api/imgcache')).json();
    $('imgBody').textContent = `${r.files.toLocaleString()} images, ${(r.bytes / 1048576).toFixed(0)} MB of ${r.capMB >= 1000 ? `${(r.capMB / 1000).toFixed(1)} GB` : `${r.capMB} MB`}.${msg ? ` ${msg}` : ''}`;
    $('imgCap').value = String(r.capMB);
    if (!$('imgCap').value) $('imgCap').insertAdjacentHTML('beforeend', `<option value="${r.capMB}" selected>${r.capMB} MB</option>`);
  } catch { $('imgBody').textContent = 'Restart Commander Table to see the image folder here.'; }
}
$('imgCap').addEventListener('change', async e => {
  await fetch('/api/imgcache', { method: 'POST', headers: { 'X-Commander-Table': 'images' }, body: /** @type {HTMLSelectElement} */ (e.target).value }).catch(() => {});
  showImages('Cap changed.');
});
let imgStop = false;
$('btnImgStop').addEventListener('click', () => { imgStop = true; });
$('btnImgLibrary').addEventListener('click', async () => {
  const btn = $('btnImgLibrary');
  btn.disabled = true; $('btnImgStop').hidden = false; imgStop = false;
  const say = t => { $('imgBody').textContent = t; };
  try {
    const decks = await listDecks();
    const urls = new Set();
    for (const [i, d] of decks.entries()) {
      if (imgStop) break;
      say(`Reading deck ${i + 1} of ${decks.length}: ${d.name}…`);
      try {
        const deck = await loadDeck(d.text, () => {}, { format: commandersOf(d.text).length ? 'commander' : formatKey });
        for (const c of [...deck.commanders, ...deck.cards.map(x => x.card), ...(deck.sideboard || []).map(x => x.card)]) for (const u of [c.imgSmall, c.imgNormal, c.art, c.backNormal]) if (u && u.startsWith('/api/img?')) urls.add(u);
      } catch { /* a deck that doesn't load is skipped */ }
    }
    const list = [...urls];
    let done = 0, failed = 0;
    const worker = async () => {
      while (list.length && !imgStop) {
        const u = list.shift();
        try { const r = await fetch(u); if (!r.ok) failed++; await r.arrayBuffer(); } catch { failed++; }
        done++;
        if (done % 10 === 0) say(`Downloading images… ${done} of ${urls.size}`);
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    showImages(imgStop ? `Stopped after ${done} of ${urls.size}.` : `Done: ${done} images for ${decks.length} deck${decks.length === 1 ? '' : 's'}${failed ? ` (${failed} failed)` : ''}.`);
  } catch (err) { say(`Couldn't download: ${err.message}`); }
  btn.disabled = false; $('btnImgStop').hidden = true;
});

// ---------- Scryfall's card file (bulk.js): off until downloaded here; then refreshed once a day at startup
function showBulk(msg) {
  const m = bulkInfo();
  const on = !!(m?.on && m.count);
  $('bulkBody').textContent = msg || (on ? `Saved: ${m.count.toLocaleString()} cards, from ${new Date(m.at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}.` : 'Not downloaded: searches go to Scryfall.');
  $('btnBulk').textContent = on ? 'Download again now' : 'Download the card file';
  $('btnBulkOff').hidden = !on;
}
$('btnBulk').addEventListener('click', async e => {
  e.target.disabled = true;
  try { await downloadBulk(showBulk); showBulk(); }
  catch (err) { showBulk(`Couldn't get the card file: ${err.message}`); }
  e.target.disabled = false;
});
$('btnBulkOff').addEventListener('click', async () => { await removeBulk(); showBulk(); });
// The printings file (item 157)
function showPrints(msg) {
  const m = printsInfo();
  const on = !!(m?.on && m.count);
  $('printsBody').textContent = msg || (on ? `Saved: ${m.count.toLocaleString()} printings, from ${new Date(m.at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}.` : 'Not downloaded: set searches go to Scryfall.');
  $('btnPrints').textContent = on ? 'Download again now' : 'Download the printings file';
  $('btnPrintsOff').hidden = !on;
}
$('btnPrints').addEventListener('click', async e => {
  e.target.disabled = true;
  try { await downloadPrints(showPrints); showPrints(); }
  catch (err) { showPrints(`Couldn't get the printings file: ${err.message}`); }
  e.target.disabled = false;
});
$('btnPrintsOff').addEventListener('click', async () => { await removePrints(); showPrints(); });
// Draft / Sealed and the Expedition offer the newest draftable sets too
function refreshSetLists() {
  const extra = draftableSets(10).filter(([c]) => !SUGGESTED_SETS.some(x => x[0] === c));
  if (!extra.length) return;
  const opts = list => list.map(([c, n]) => `<option value="${c}">${esc(n)} (${c.toUpperCase()})</option>`).join('');
  $('limSet').innerHTML = `<optgroup label="Newest sets">${opts(extra)}</optgroup><optgroup label="Commander pods">${opts(SUGGESTED_SETS)}</optgroup>`;
  for (const s of extra) if (!SUGGESTED_SETS.some(x => x[0] === s[0])) SUGGESTED_SETS.push(s);
}
refreshSetLists();

// ---------- Start menu: what you see when the game opens
function showMenu() {
  for (const id of ['setup', 'results', 'learnModal', 'storyModal', 'expeditionModal', 'puzzleModal', 'limitedModal']) if ($(id)) $(id).hidden = true;
  if (game && !game.over && !clock.paused) togglePlay();
  renderMenu();
  $('startMenu').hidden = false;
}
let menuNews = null;
function renderMenu(news = menuNews) {
  menuNews = news;
  const r = runState();
  $('smExpedition').textContent = r && !r.over ? `Continue: act ${r.act + 1}, ${r.wins} win${r.wins === 1 ? '' : 's'}` : 'A solo roguelike';
  const ch = challenges();
  const open = [...ch.daily, ...ch.weekly].filter(c => !c.done).length;
  $('smProgress').textContent = `${open} challenge${open === 1 ? '' : 's'} open${ch.streak.count ? ` · ${ch.streak.count}-day streak` : ''}`;
  const items = [];
  if (news?.added?.length) items.push(`🆕 New card set${news.added.length > 1 ? 's' : ''}: ${news.added.map(s => `<b>${esc(s.name)}</b>`).join(', ')}`);
  if (news?.upcoming?.length) items.push(`Coming soon: ${news.upcoming.slice(0, 2).map(s => `${esc(s.name)} (${esc(s.released)})`).join(', ')}`);
  const done = lessonsDone();
  if (!Object.keys(done).length) items.push('New to Magic? Start with <b>Learn to play</b>.');
  $('smNews').innerHTML = items.map(x => `<div>${x}</div>`).join('');
  $('smUpdates').textContent = news?.added?.length ? `${news.added.length} new set${news.added.length > 1 ? 's' : ''}!` : 'New card sets, game updates';
}
$('startMenu').addEventListener('click', e => {
  const b = e.target.closest('[data-go]');
  if (!b) return;
  const go = b.dataset.go;
  const hide = () => { $('startMenu').hidden = true; };
  const toSetup = () => { hide(); $('setup').hidden = false; };
  switch (go) {
    case 'play': toSetup(); if (!prefs.toured) setTimeout(() => startTour(toured), 400); break;
    case 'resume': {
      const a = store(AUTOSAVE);
      if (!a) { showResume(); break; }
      hide();
      loadReplayData(a, { resume: true }).catch(err => { $('setup').hidden = false; $('setupStatus').textContent = `Couldn't resume: ${err.message}`; });
      break;
    }
    case 'learn': $('btnLearn').click(); break;
    case 'story': $('btnStory').click(); break;
    case 'expedition': $('btnExpedition').click(); break;
    case 'draft': $('btnLimited').click(); break;
    case 'puzzles': renderPuzzles(); $('puzzleModal').hidden = false; break;
    case 'tabletop': toSetup(); setFormat('manual', { quiet: true }); $('setupStatus').textContent = 'Manual tabletop: choose how many players, seat the decks (any seat can be a friend online), then click "Load decks & shuffle up".'; break;
    case 'kingdoms': toSetup(); setFormat('kingdoms', { quiet: true }); $('setupStatus').textContent = `Kingdoms: choose 5 to 9 players, then set each seat to you, a friend online or an AI bot (an AI style), seat Commander decks and click "Load decks & shuffle up". Roles are dealt at the table. (Table: Manual tabletop plays with no automation, people only.)`; break;
    case 'builder': builder(0); break;
    case 'library': $('btnLibrary').click(); break;
    case 'progress': $('btnProgress').click(); break;
    case 'help': openHelp(); break;
    case 'display': $('btnDisplay').click(); break;
    case 'updates': $('btnUpdates').click(); break;
    case 'tour': toSetup(); startTour(toured); break;
    case 'selftest': window.open('selftest.html', '_blank'); break;
    case 'exit': $('btnExit').click(); break;
  }
});
$('btnMenu').addEventListener('click', showMenu);
$('btnSetupMenu').addEventListener('click', showMenu);
fetch('/api/update').then(r => r.json()).then(j => { $('smVersion').textContent = `Version ${j.version}`; }).catch(() => {});
// A challenge link goes straight to the setup screen; otherwise the menu greets you
if (!$('setup').hidden || openedChallenge) $('startMenu').hidden = true;
renderMenu();
if (prefs.autoSets !== false) dailySetCheck().then(r => { if (r) { renderMenu(r); refreshSetLists(); } });
dailyBulk();
