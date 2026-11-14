// Well-known Commander combos. The engine runs each one as a single loop once every piece is in
// place, and the AI pilots tutor for missing pieces, protect them and try to stop opponents' combos.
//
// result: 'win'    – the controller wins the game (104.2a)
//         'damage' – repeatable damage to each opponent (704.5a)
//         'drain'  – each opponent loses life over and over (704.5a)
//         'attack' – an unbounded number of hasty attackers this turn (704.5a); main phase 1 only
//         'mill'   – opponents' libraries are milled, so they lose on their next draw (704.5b)
//         'mana'   – unbounded mana for the rest of the turn, spent on whatever else is in hand
// untapped: pieces that must already be on the battlefield untapped and able to tap this turn
// last:     a piece that has to resolve after the others (for example Thassa's Oracle)
// imprint:  { host, card }: the card is exiled with the host as it enters (Isochron Scepter)
// mana:     extra generic mana needed to start the loop; x: X values to cast pieces with
import { hashText, stableJson, store } from './util.js';

const kiki = partner => ({ pieces: ['Kiki-Jiki, Mirror Breaker', partner], result: 'attack', note: `Kiki-Jiki copies ${partner}, which untaps Kiki-Jiki, over and over` });
const twin = partner => ({ pieces: ['Splinter Twin', partner], result: 'attack', untapped: [partner], note: `${partner} copies itself and untaps the original, over and over` });
// Tainted Pact stops at the first name it has already exiled: every card left in the library needs its own name
const uniqueLibrary = (g, p) => new Set(p.library.map(o => o.card.name)).size === p.library.length;
// Exquisite Blood loops need something to start them: a creature that can hit an opponent, or a way to gain life
const canStartDrain = (g, p) => p.battlefield.some(o => o.fx.type.creature && g.canAttack?.(o)) || [...p.hand, ...p.battlefield].some(o => [...o.fx.spell, ...o.fx.etb].some(e => e.k === 'gain'));
const niv = (niv, enabler) => ({ pieces: [niv, enabler], result: 'damage', note: 'every card drawn deals damage, and every hit draws another card' });

export const COMBOS = [
  { pieces: ["Thassa's Oracle", 'Demonic Consultation'], result: 'win', last: "Thassa's Oracle", note: 'Consultation exiles the library, then Oracle wins the game' },
  { pieces: ["Thassa's Oracle", 'Tainted Pact'], result: 'win', last: "Thassa's Oracle", check: uniqueLibrary, note: 'Tainted Pact exiles the library, then Oracle wins the game' },
  { pieces: ['Laboratory Maniac', 'Demonic Consultation'], result: 'win', note: 'Consultation exiles the library, and the next draw wins the game' },
  { pieces: ['Jace, Wielder of Mysteries', 'Demonic Consultation'], result: 'win', note: 'Consultation exiles the library, and the next draw wins the game' },
  { pieces: ['Laboratory Maniac', 'Tainted Pact'], result: 'win', check: uniqueLibrary, note: 'Tainted Pact exiles the library, and the next draw wins the game' },
  { pieces: ['Jace, Wielder of Mysteries', 'Tainted Pact'], result: 'win', check: uniqueLibrary, note: 'Tainted Pact exiles the library, and the next draw wins the game' },

  { pieces: ['Exquisite Blood', 'Sanguine Bond'], result: 'drain', check: canStartDrain, note: 'each life gain drains, and each drain gains life' },
  { pieces: ['Exquisite Blood', 'Vito, Thorn of the Dusk Rose'], result: 'drain', check: canStartDrain, note: 'each life gain drains, and each drain gains life' },
  { pieces: ['Exquisite Blood', 'Marauding Blight-Priest'], result: 'drain', check: canStartDrain, note: 'each life gain drains, and each drain gains life' },
  { pieces: ['Heliod, Sun-Crowned', 'Walking Ballista'], result: 'damage', mana: 2, x: { 'Walking Ballista': 2 }, check: (g, p) => { const b = p.battlefield.find(o => o.card.name === 'Walking Ballista'); return !b || b.counters >= 2; }, note: 'lifelinked Ballista pings, and each life gain gives it a new counter (it needs two counters, or it dies before the first one comes back)' },
  { pieces: ['Mikaeus, the Unhallowed', 'Triskelion'], result: 'damage', note: 'Triskelion pings until it dies, then undying brings it back with fresh counters' },
  { pieces: ['Professor Onyx', 'Chain of Smog'], result: 'drain', note: 'every copy of Chain of Smog triggers magecraft' },
  { pieces: ['Witherbloom Apprentice', 'Chain of Smog'], result: 'drain', note: 'every copy of Chain of Smog triggers magecraft' },
  niv('Niv-Mizzet, Parun', 'Curiosity'), niv('Niv-Mizzet, Parun', 'Ophidian Eye'), niv('Niv-Mizzet, Parun', 'Tandem Lookout'),
  niv('Niv-Mizzet, the Firemind', 'Curiosity'), niv('Niv-Mizzet, the Firemind', 'Ophidian Eye'), niv('Niv-Mizzet, the Firemind', 'Tandem Lookout'),

  kiki('Zealous Conscripts'), kiki('Pestermite'), kiki('Deceiver Exarch'), kiki('Restoration Angel'), kiki('Felidar Guardian'),
  twin('Pestermite'), twin('Deceiver Exarch'), twin('Zealous Conscripts'),
  { pieces: ['Saheeli Rai', 'Felidar Guardian'], result: 'attack', note: 'Guardian blinks Saheeli, and Saheeli copies Guardian, over and over' },
  { pieces: ['Dualcaster Mage', 'Twinflame'], result: 'attack', last: 'Dualcaster Mage', check: (g, p) => p.battlefield.some(o => o.fx.type.creature), note: 'Twinflame and Dualcaster copy each other endlessly' },
  { pieces: ['Dualcaster Mage', 'Heat Shimmer'], result: 'attack', last: 'Dualcaster Mage', check: (g, p) => g.players.some(q => q.battlefield.some(o => o.fx.type.creature)), note: 'Heat Shimmer and Dualcaster copy each other endlessly' },

  { pieces: ['Painter\'s Servant', 'Grindstone'], result: 'mill', millOne: true, mana: 3, note: 'every milled pair shares a color, so Grindstone mills a whole library' },
  { pieces: ['Underworld Breach', "Lion's Eye Diamond", 'Brain Freeze'], result: 'mill', check: (g, p) => p.graveyard.length >= 6, note: 'Breach recasts Diamond and Brain Freeze from the graveyard until every library is gone' },

  { pieces: ['Isochron Scepter', 'Dramatic Reversal'], result: 'mana', imprint: { host: 'Isochron Scepter', card: 'Dramatic Reversal' },
    check: (g, p) => p.battlefield.filter(o => o.fx.mana && !o.fx.type.land).reduce((s, o) => s + o.fx.mana.amount, 0) >= 3,
    note: 'Reversal untaps the mana rocks that paid for it' },
  { pieces: ['Basalt Monolith', 'Rings of Brighthearth'], result: 'mana', mana: 2, note: 'Rings copies the untap ability' },
  { pieces: ['Basalt Monolith', 'Power Artifact'], result: 'mana', note: 'the untap ability costs less than the mana it makes' },
  { pieces: ['Grim Monolith', 'Power Artifact'], result: 'mana', note: 'the untap ability costs less than the mana it makes' },
  { pieces: ['Kinnan, Bonder Prodigy', 'Basalt Monolith'], result: 'mana', note: 'Monolith makes one extra mana each time' },
  // Zirda makes the untap abilities cost {2} less (never below one): tap for three, untap for one or two
  { pieces: ['Zirda, the Dawnwaker', 'Basalt Monolith'], result: 'mana', note: 'Zirda makes the untap cost {1}, so each tap and untap nets two mana' },
  { pieces: ['Zirda, the Dawnwaker', 'Grim Monolith'], result: 'mana', note: 'Zirda makes the untap cost {2}, so each tap and untap nets one mana' },
  { pieces: ['Deadeye Navigator', 'Peregrine Drake'], result: 'mana', check: (g, p) => p.battlefield.filter(o => o.fx.type.land).length >= 3, note: 'every blink of the Drake untaps five lands' },
  { pieces: ['Deadeye Navigator', 'Palinchron'], result: 'mana', check: (g, p) => p.battlefield.filter(o => o.fx.type.land).length >= 3, note: 'every blink of Palinchron untaps seven lands' },
  { pieces: ['Devoted Druid', 'Vizier of Remedies'], result: 'mana', untapped: ['Devoted Druid'], note: 'Vizier stops the -1/-1 counters, so the Druid untaps forever' },
  { pieces: ['Pili-Pala', 'Grand Architect'], result: 'mana', untapped: ['Pili-Pala'], note: 'Architect taps Pili-Pala for two, and Pili-Pala untaps for two' },
  { pieces: ['Food Chain', 'Eternal Scourge'], result: 'mana', note: 'exile and recast Eternal Scourge for ever more mana (creature spells only, simplified)' },
  { pieces: ['Food Chain', 'Misthollow Griffin'], result: 'mana', note: 'exile and recast Misthollow Griffin for ever more mana (creature spells only, simplified)' },
  { pieces: ['Food Chain', 'Squee, the Immortal'], result: 'mana', note: 'exile and recast Squee for ever more mana (creature spells only, simplified)' },
];

export const RESULT_TEXT = {
  win: 'wins the game', damage: 'infinite damage', drain: 'infinite life drain', attack: 'infinite hasty attackers',
  mill: 'mills the table', mana: 'infinite mana',
};

const key = s => s.toLowerCase();
export const cardKey = card => key(card.frontName || card.name || '');
const allKeys = card => [key(card.name || ''), cardKey(card)];

COMBOS.forEach((c, i) => { c.id = i; c.keys = c.pieces.map(key); c.label = c.pieces.join(' + '); });
// (the built-in list never changes while the page runs: each game has its own combo book, below)
Object.freeze(COMBOS);
// A fingerprint of the built-in combos (their data and their checks' code): a replay notes it, and says so when the
// list it was played with has changed since
export const BUILTIN_COMBOS_HASH = hashText(COMBOS.map(c => stableJson({ ...c, check: c.check ? String(c.check) : null })).join('\n'));
const sigOf = keys => [...keys].sort().join('|');

// ---------- Playing combos out with the real cards (Phase 2C, rules 11): comboplay.js
// How each built-in combo is played at rules 11, and whether the engine can do it with the real cards. (Kept apart
// from COMBOS so the built-in list's fingerprint, which replays check, doesn't change.)
//   supported    played step by step with the cards' own abilities, triggers, damage, combat and zone changes
//   partial      the cards work by hand, but some part can't be played out faithfully yet: the AI doesn't go for it
//   unsupported  the engine can't play the interaction yet (a card's ability isn't read, or a step isn't modelled)
// how: the play-out (comboplay.js PLAYERS)
const S = (how, reason = '') => ({ status: 'supported', how, reason });
const PARTIAL = reason => ({ status: 'partial', how: null, reason });
const NOPE = reason => ({ status: 'unsupported', how: null, reason });
const PLAY_TABLE = {
  "Thassa's Oracle + Demonic Consultation": S('spells'), "Thassa's Oracle + Tainted Pact": S('spells'),
  'Laboratory Maniac + Demonic Consultation': S('emptyDraw', 'Laboratory Maniac wins at the next card drawn'),
  'Laboratory Maniac + Tainted Pact': S('emptyDraw', 'Laboratory Maniac wins at the next card drawn'),
  'Jace, Wielder of Mysteries + Demonic Consultation': S('emptyDraw'), 'Jace, Wielder of Mysteries + Tainted Pact': S('emptyDraw'),
  'Exquisite Blood + Sanguine Bond': S('lifeTriggers', 'the loop runs on its own triggers once life is gained or lost'),
  'Exquisite Blood + Vito, Thorn of the Dusk Rose': S('lifeTriggers', 'the loop runs on its own triggers once life is gained or lost'),
  'Exquisite Blood + Marauding Blight-Priest': S('lifeTriggers', 'the loop runs on its own triggers once life is gained or lost'),
  // (cost: what playing it out pays besides casting the pieces; the AI checks it can pay before going: ai.js comboCost)
  'Heliod, Sun-Crowned + Walking Ballista': { ...S('heliod'), cost: '{1}{W}' }, 'Mikaeus, the Unhallowed + Triskelion': S('triskelion'),
  'Professor Onyx + Chain of Smog': S('spells'), 'Witherbloom Apprentice + Chain of Smog': S('spells'),
  'Niv-Mizzet, Parun + Curiosity': S('drawTriggers', 'the loop starts with the next card drawn'),
  'Niv-Mizzet, Parun + Ophidian Eye': S('drawTriggers', 'the loop starts with the next card drawn'),
  'Niv-Mizzet, the Firemind + Curiosity': S('drawTriggers'), 'Niv-Mizzet, the Firemind + Ophidian Eye': S('drawTriggers'),
  'Niv-Mizzet, Parun + Tandem Lookout': NOPE("Tandem Lookout's soulbond isn't read by the engine"),
  'Niv-Mizzet, the Firemind + Tandem Lookout': NOPE("Tandem Lookout's soulbond isn't read by the engine"),
  'Kiki-Jiki, Mirror Breaker + Zealous Conscripts': S('copies'), 'Kiki-Jiki, Mirror Breaker + Pestermite': S('copies'),
  'Kiki-Jiki, Mirror Breaker + Deceiver Exarch': S('copies'), 'Kiki-Jiki, Mirror Breaker + Restoration Angel': S('copies'),
  'Kiki-Jiki, Mirror Breaker + Felidar Guardian': S('copies'),
  'Splinter Twin + Pestermite': S('copies'), 'Splinter Twin + Deceiver Exarch': S('copies'), 'Splinter Twin + Zealous Conscripts': S('copies'),
  'Saheeli Rai + Felidar Guardian': S('copies'),
  'Dualcaster Mage + Twinflame': NOPE("Dualcaster Mage's copy of Twinflame isn't played out by the engine (it only worked through the old shortcut)"),
  'Dualcaster Mage + Heat Shimmer': NOPE("Dualcaster Mage's copy of Heat Shimmer isn't played out by the engine (it only worked through the old shortcut)"),
  "Painter's Servant + Grindstone": S('grindstone'),
  "Underworld Breach + Lion's Eye Diamond + Brain Freeze": NOPE("recasting Lion's Eye Diamond and Brain Freeze with escape, and Brain Freeze's storm copies, aren't played out by the engine yet"),
  'Isochron Scepter + Dramatic Reversal': S('mana'), 'Basalt Monolith + Rings of Brighthearth': S('mana'),
  'Basalt Monolith + Power Artifact': S('mana'), 'Grim Monolith + Power Artifact': S('mana'),
  'Kinnan, Bonder Prodigy + Basalt Monolith': S('mana'), 'Zirda, the Dawnwaker + Basalt Monolith': S('mana'),
  'Zirda, the Dawnwaker + Grim Monolith': S('mana'), 'Devoted Druid + Vizier of Remedies': S('mana'), 'Pili-Pala + Grand Architect': S('mana'),
  'Deadeye Navigator + Peregrine Drake': NOPE("Deadeye Navigator's soulbond isn't read by the engine"),
  'Deadeye Navigator + Palinchron': NOPE("Deadeye Navigator's soulbond isn't read by the engine"),
  'Food Chain + Eternal Scourge': PARTIAL('each loop works with the real cards, but Food Chain mana is for creature spells only and the unbounded-mana shortcut has no such restriction'),
  'Food Chain + Misthollow Griffin': PARTIAL('each loop works with the real cards, but Food Chain mana is for creature spells only and the unbounded-mana shortcut has no such restriction'),
  'Food Chain + Squee, the Immortal': PARTIAL('each loop works with the real cards, but Food Chain mana is for creature spells only and the unbounded-mana shortcut has no such restriction'),
};
const BUILTIN_BY_SIG = new Map(COMBOS.map(c => [sigOf(c.keys), c]));
/** How a combo is played at rules 11: { status, how, reason } (a Spellbook combo is known, not playable, unless it is a built-in one) */
export function comboPlay(combo) {
  const b = BUILTIN_BY_SIG.get(sigOf(combo.keys || combo.pieces.map(key)));
  if (b) return PLAY_TABLE[b.label] || NOPE('no way to play it out with the real cards is written for it');
  return { status: 'partial', how: null, reason: "a known Commander Spellbook combo: the engine has no step-by-step way to play it with the real cards, so the AI doesn't go for it (its cards still interact as usual when played)" };
}
export const playable = combo => comboPlay(combo).status === 'supported';

// A game's combos (replay exactness, Phase 2A): the built-in list plus the Commander Spellbook combos found for the
// decks at that table, in that order. Nothing is shared between games, so combos fetched for another deck can't
// change how a game (or a replay) plays. extra: Spellbook definitions as fetchSpellbook returns them.
// (rules 11: only the combos the engine can play out with the real cards, comboPlay; the rest are known but not
// pursued. Games at rules 10 and earlier keep every combo, so their replays play the same.)
/** @param {any[]} [extra] @param {number} [rules] */
export function makeComboBook(extra = [], rules = 0) {
  if (rules >= 11) return bookOf(COMBOS.filter(playable));
  const list = [...COMBOS];
  const known = new Set(COMBOS.map(c => sigOf(c.keys)));
  for (const d of extra) {
    const keys = d.pieces.map(key);
    if (known.has(sigOf(keys))) continue;
    known.add(sigOf(keys));
    list.push({ ...d, keys, id: list.length, label: d.pieces.join(' + ') });
  }
  return bookOf(list);
}
/** @param {any[]} list */
function bookOf(list) {
  const byPiece = new Map();
  for (const c of list) for (const k of c.keys) byPiece.set(k, [...(byPiece.get(k) || []), c]);
  return {
    list,
    /** @param {any} card */
    combosFor(card) {
      const out = new Set();
      for (const k of allKeys(card)) for (const c of byPiece.get(k) || []) out.add(c);
      return [...out];
    },
    // Combos whose every piece is somewhere in a list of cards (a decklist, or all of a player's objects)
    /** @param {any[]} cards */
    combosIn(cards) {
      const names = new Set(cards.flatMap(allKeys));
      return list.filter(c => c.keys.every(k => names.has(k)));
    },
  };
}
const BUILTIN_BOOK = makeComboBook([]);

// The built-in combos a card is part of (outside a game; a game asks its own book: Game.combosFor)
export function combosFor(card) { return BUILTIN_BOOK.combosFor(card); }

// Combos whose every piece is in a list of cards: the built-in ones, plus a deck's own Spellbook combos when given
/** @param {any[]} cards @param {any[]} [extra] */
export function combosIn(cards, extra) { return (extra?.length ? makeComboBook(extra) : BUILTIN_BOOK).combosIn(cards); }

// ---------- Commander Spellbook (commanderspellbook.com): every known combo in a decklist
// A combo is added when it uses 2–4 cards from the battlefield, hand or command zone, has no extra
// template requirements, and produces something the engine can run as one of the results above.
/** @type {[RegExp, string][]} */
const FEATURE_RESULT = [
  [/win the game/i, 'win'],
  [/infinite lifeloss|infinite life loss|infinite drain/i, 'drain'],
  [/(near-)?infinite damage/i, 'damage'],
  [/infinite (creature )?tokens with haste|infinite combat|infinite attacks/i, 'attack'],
  [/(near-)?infinite mill(?! self)|mill (all|each) opponents?/i, 'mill'],
  // "Infinite colored mana", "Near-infinite colorless mana", "Infinite mana permanents you control can produce"…
  [/(near-)?infinite (?!.*legendary spells)[\w -]*\bmana\b/i, 'mana'],
];
// Loops that only produce something like "infinite ETB" win with a payoff in the same deck:
// [feature, payoff cards, result for each payoff]. The payoff becomes one more piece of the combo.
const DRAIN_ON_DEATH = ['Blood Artist', 'Zulaport Cutthroat', 'Cruel Celebrant', 'Falkenrath Noble', 'Bastion of Remembrance', 'Vindictive Vampire', 'Elas il-Kor, Sadistic Pilgrim', 'Pitiless Plunderer'];
const DAMAGE_ON_ETB = ['Impact Tremors', 'Purphoros, God of the Forge', 'Warstorm Surge', 'Pandemonium', 'Terror of the Peaks', 'Witty Roastmaster'];
const ORACLES = ["Thassa's Oracle", 'Laboratory Maniac', 'Jace, Wielder of Mysteries'];
/** @type {[RegExp, string[], (card: string) => any][]} */
const PAYOFFS = [
  [/infinite creature etb|infinite blinking|infinite creature tokens/i, [...DAMAGE_ON_ETB, 'Blood Artist', 'Elas il-Kor, Sadistic Pilgrim'], n => (DAMAGE_ON_ETB.includes(n) ? 'damage' : 'drain')],
  [/infinite creature ltb|infinite (creature )?death|infinite sacrifice/i, DRAIN_ON_DEATH, () => 'drain'],
  [/(near-)?infinite storm count/i, ['Brain Freeze', 'Grapeshot', 'Tendrils of Agony', 'Aetherflux Reservoir'], n => ({ 'Brain Freeze': 'mill', 'Tendrils of Agony': 'drain' }[n] || 'damage')],
  [/infinite self-mill|exile your library|infinite card draw|infinite draw triggers/i, ORACLES, () => 'win'],
  [/(near-)?infinite magecraft/i, ['Professor Onyx', 'Witherbloom Apprentice', 'Archmage Emeritus'], n => (n === 'Archmage Emeritus' ? null : 'drain')],
  [/infinite lifegain/i, ['Sanguine Bond', 'Vito, Thorn of the Dusk Rose', 'Marauding Blight-Priest', 'Aetherflux Reservoir'], n => (n === 'Aetherflux Reservoir' ? 'damage' : 'drain')],
  [/infinite landfall/i, ['Ob Nixilis, the Fallen', 'Lotus Cobra', 'Tireless Provisioner', 'Nissa, Resurgent Animist'], n => (n === 'Ob Nixilis, the Fallen' ? 'drain' : 'mana')],
];
const spellbookCache = new Map();

// Spellbook prerequisites the engine can check. Returns { untapped, unsick, minLands, minCreatures }, or
// null when a sentence isn't understood (the combo is then skipped).
const NUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
// (why: when given, why.sentence is set to the first sentence that isn't understood)
export function readPrerequisites(text, pieces, why = null) {
  const req = { untapped: [], unsick: [], minLands: 0, minCreatures: 0 };
  const isPiece = n => pieces.find(x => x.toLowerCase() === n.trim().toLowerCase() || x.split(',')[0].toLowerCase() === n.trim().toLowerCase());
  for (let s of text.split(/\r?\n|(?<=\.)\s+(?=[A-Z])/)) {
    s = s.trim().replace(/\.$/, '');
    if (!s) continue;
    let m;
    // "All permanents are on the battlefield." and similar plain statements need nothing extra
    if (/^(all )?(permanents|combo pieces|cards) (are|is) on the battlefield$/i.test(s)) continue;
    if ((m = s.match(/^(.+?) (?:does not have|doesn't have|without) summoning sickness$/i)) || (m = s.match(/^(.+?) (?:has|have) haste$/i))) {
      const names = m[1].split(/,\s*|\s+and\s+/).map(isPiece);
      if (names.some(n => !n)) { if (why) why.sentence = s; return null; }
      req.unsick.push(...names);
      continue;
    }
    if ((m = s.match(/^(.+?) (?:is|are) untapped$/i))) {
      const names = m[1].split(/,\s*|\s+and\s+/).map(isPiece);
      if (names.some(n => !n)) { if (why) why.sentence = s; return null; }
      req.untapped.push(...names);
      continue;
    }
    if ((m = s.match(/^(.+?) is paired with (.+)$/i)) && isPiece(m[1]) && isPiece(m[2])) continue;
    if ((m = s.match(/^(.+?) (?:is|are) on the battlefield$/i)) && m[1].split(/,\s*|\s+and\s+/).every(isPiece)) continue;
    // ("up to five lands" is the most the loop uses: three are enough to start it)
    if ((m = s.match(/^you control (at least |up to )?(\w+) (?:other )?(?:untapped )?lands?\b/i))) { const k = NUM[m[2].toLowerCase()] || +m[2] || 3; req.minLands = Math.max(req.minLands, /up to/i.test(m[1] || '') ? Math.min(3, k) : Math.min(5, k)); continue; }
    if ((m = s.match(/^you control (?:at least )?(\w+) (?:other )?(?:untapped )?(?:nontoken )?creatures?\b/i))) { req.minCreatures = Math.max(req.minCreatures, NUM[m[1].toLowerCase()] || +m[1] || 1); continue; }
    if (why) why.sentence = s;
    return null;
  }
  return req;
}

// Whether a combo's conditions hold right now (both the built-in rules and Spellbook's):
// pieces that have to tap are on the battlefield untapped and able to tap (no summoning sickness,
// or haste), and the board has what the combo needs. Returns the reason it doesn't, or null.
export function comboBlocked(g, p, combo, st) {
  for (const f of st.found) {
    const needTap = combo.untapped?.includes(f.name);
    const needUnsick = combo.unsick?.includes(f.name);
    if (!needTap && !needUnsick) continue;
    if (f.zone !== 'battlefield') return `${f.name} has to be on the battlefield already`;
    if (needTap && f.o.tapped) return `${f.name} is tapped`;
    if (!g.canTapNow(p, f.o)) return `${f.name} has summoning sickness`;
  }
  // (rules 11) The piece cast last is there for what it does as it enters (Thassa's Oracle): already on the battlefield,
  // it can't do it again, so the combo can't be played out (the old shortcut granted the win anyway)
  if (g.rules >= 11 && combo.last) {
    const f = st.found.find(x => x.key === combo.last.toLowerCase());
    if (f && f.zone === 'battlefield') return `${f.name} is already on the battlefield, and only does its part as it enters`;
  }
  if (combo.minLands && p.battlefield.filter(o => o.fx.type.land).length < combo.minLands) return `it needs ${combo.minLands} lands`;
  if (combo.minCreatures && p.battlefield.filter(o => o.fx.type.creature).length < combo.minCreatures) return `it needs ${combo.minCreatures} creatures`;
  if (combo.check && !combo.check(g, p)) return 'its conditions are not met';
  return null;
}

// What Commander Spellbook said about a deck (its find-my-combos answer), read two ways (Phase 2C):
//   out      the combos rules 10 and earlier play through the combo shortcut (unchanged, so their replays stay exact)
//   catalog  every combo in the answer with a status and the reason: none is dropped without a word any more.
//            A Spellbook combo is a reference, never proof the engine can play it: at rules 11 only a combo that is
//            one of the built-in ones the engine plays out with the real cards is "supported" (comboPlay).
// names: the deck's card names. Malformed entries are listed as invalid; nothing here throws.
/** @param {any} data @param {string[]} names */
export function readSpellbook(data, names) {
  const out = [], catalog = [];
  /** @type {Record<string, string>} */
  const ZONE = { B: 'battlefield', H: 'hand', C: 'command zone', G: 'graveyard', E: 'exile', L: 'library' };
  for (const v of Array.isArray(data?.results?.included) ? data.results.included : []) {
    /** @type {any} */
    const entry = { id: String(v?.id ?? '?'), pieces: [], prerequisites: '', zones: [], features: [], result: null, status: 'invalid', reason: '', url: v?.id != null ? `https://commanderspellbook.com/combo/${v.id}/` : null };
    catalog.push(entry);
    try { (() => {
      const uses = Array.isArray(v.uses) ? v.uses : [];
      entry.pieces = uses.map((/** @type {any} */ u) => u?.card?.name).filter((/** @type {any} */ n) => typeof n === 'string' && n);
      entry.prerequisites = `${v.easyPrerequisites || ''}\n${v.notablePrerequisites || ''}`.trim();
      entry.zones = [...new Set(uses.flatMap((/** @type {any} */ u) => (Array.isArray(u?.zoneLocations) ? u.zoneLocations : []).map((/** @type {string} */ z) => ZONE[z] || z)))];
      entry.features = (Array.isArray(v.produces) ? v.produces : []).map((/** @type {any} */ p) => p?.feature?.name || '').filter(Boolean);
      if (entry.pieces.length !== uses.length || !uses.length) { entry.reason = 'a card in it has no name in the answer'; return; }
      // (a combo of one named card plus cards described by type is a real combo the engine can't check: unsupported)
      if ((v.requires || []).length) { entry.status = 'unsupported'; entry.reason = `it also needs cards described only by type (${(v.requires || []).map((/** @type {any} */ r) => r?.template?.name || 'a template').join(', ')})`; return; }
      if (entry.pieces.length < 2) { entry.reason = 'it lists fewer than two cards'; return; }
      entry.status = 'unsupported';
      if (uses.length > 4) { entry.reason = 'it uses more than four cards'; return; }
      const odd = uses.flatMap((/** @type {any} */ u) => (u.zoneLocations || []).filter((/** @type {string} */ z) => !'BHC'.includes(z))).map((/** @type {string} */ z) => ZONE[z] || z);
      if (odd.length) { entry.reason = `it needs a card in the ${[...new Set(odd)].join(' or ')} to start`; return; }
      let result = FEATURE_RESULT.find(([re]) => entry.features.some((/** @type {string} */ f) => re.test(f)))?.[1];
      const pieces = entry.pieces;
      let payoff = null;
      if (!result) for (const [re, cards, res] of PAYOFFS) {
        if (!entry.features.some((/** @type {string} */ f) => re.test(f))) continue;
        payoff = cards.find(c => names.includes(c) && !pieces.includes(c) && res(c));
        if (payoff) { result = res(payoff); break; }
      }
      if (!result) { entry.reason = `what it produces (${entry.features.slice(0, 3).join(', ') || 'nothing listed'}) isn't a result the engine can check`; return; }
      entry.result = result;
      // Spellbook's prerequisites, as sentences: the ones the engine can check become rules for the combo
      const why = { sentence: '' };
      const req = readPrerequisites(entry.prerequisites, pieces, why);
      if (!req) { entry.reason = `a prerequisite isn't understood: "${why.sentence}"`; return; }
      for (const u of uses) if (/untapped/i.test(u.battlefieldCardState || '')) req.untapped.push(u.card.name);
      const mana = (v.manaNeeded || '').match(/\{[^}]+\}/g) || [];
      const def = {
        pieces: payoff ? [...pieces, payoff] : pieces,
        result,
        untapped: [...new Set(req.untapped)], unsick: [...new Set(req.unsick)], minLands: req.minLands, minCreatures: req.minCreatures,
        ...(payoff && ORACLES.includes(payoff) ? { last: payoff } : {}),
        mana: mana.reduce((/** @type {number} */ s, /** @type {string} */ m) => s + (/^\{\d+\}$/.test(m) ? +m.slice(1, -1) : 1), 0),
        note: `Commander Spellbook: ${entry.features.slice(0, 3).join(', ').toLowerCase()}${payoff ? `, finished by ${payoff}` : ''}`,
        source: 'spellbook',
        url: `https://commanderspellbook.com/combo/${v.id}/`,
      };
      out.push(def);
      entry.pieces = def.pieces;
      const play = comboPlay(def);
      entry.status = play.status;
      entry.reason = play.status === 'supported' ? 'the same cards as a built-in combo the engine plays out with the real cards' : play.reason;
    })(); } catch (e) {
      entry.status = 'invalid';
      entry.reason = `the answer for this combo couldn't be read (${/** @type {any} */ (e)?.message || e})`;
    }
    // The same cards as a built-in combo: its status is the built-in's, however Spellbook words the setup (the engine
    // plays those cards out itself, checking its own conditions); Spellbook's caveat is kept in the reason
    if (entry.status !== 'invalid' && entry.pieces.length >= 2) {
      const b = BUILTIN_BY_SIG.get(sigOf(entry.pieces.map((/** @type {string} */ n) => key(n))));
      if (b) {
        const play = comboPlay(b);
        const note = entry.status === 'unsupported' ? ` (Spellbook's listing alone: ${entry.reason})` : '';
        entry.status = play.status;
        entry.reason = `the same cards as the built-in combo ${b.label}: ${play.status === 'supported' ? 'played out with the real cards' : play.reason}${note}`;
      }
    }
  }
  return { out, catalog };
}

// Spellbook answers kept in this browser profile for a week (Phase 2C): loading a deck again doesn't ask again
const SB_STORE = 'ct.spellbook', SB_DAYS = 7, SB_KEEP = 60;
/** @param {string} key */
function savedAnswer(key) {
  const all = store(SB_STORE);
  const hit = all && typeof all === 'object' ? all[key] : null;
  return hit && Date.now() - hit.at < SB_DAYS * 864e5 ? hit.data : null;
}
/** @param {string} key @param {any} data */
function saveAnswer(key, data) {
  try {
    const all = store(SB_STORE) || {};
    all[key] = { at: Date.now(), data };
    const keys = Object.keys(all).sort((a, b) => all[b].at - all[a].at);
    for (const k of keys.slice(SB_KEEP)) delete all[k];
    store(SB_STORE, all);
  } catch { /* no storage: asked again next time */ }
}

export async function fetchSpellbook(deck) {
  const names = [...deck.commanders.map(c => c.name), ...deck.cards.map(c => c.card.name)];
  const cacheKey = names.slice().sort().join('|');
  let read = spellbookCache.get(cacheKey);
  if (!read) {
    const storeKey = hashText(cacheKey);
    let data = savedAnswer(storeKey);
    if (!data) {
      const res = await fetch('https://backend.commanderspellbook.com/find-my-combos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commanders: deck.commanders.map(c => ({ card: c.name })), main: deck.cards.map(c => ({ card: c.card.name })) }),
      });
      if (!res.ok) throw new Error(`Commander Spellbook answered ${res.status}`);
      const raw = await res.json();
      // (only what readSpellbook uses is kept)
      data = { results: { included: (raw?.results?.included || []).map((/** @type {any} */ v) => ({ id: v.id, uses: v.uses, requires: v.requires, produces: v.produces, easyPrerequisites: v.easyPrerequisites, notablePrerequisites: v.notablePrerequisites, manaNeeded: v.manaNeeded })) } };
      saveAnswer(storeKey, data);
    }
    read = readSpellbook(data, names);
    spellbookCache.set(cacheKey, read);
  }
  // (plain definitions, kept with the deck and saved in replays; each game builds its own combo book from them)
  deck.spellbookCatalog = JSON.parse(JSON.stringify(read.catalog));
  deck.spellbook = JSON.parse(JSON.stringify(read.out));
  return deck.spellbook;
}

// Commander Spellbook's own bracket estimate for a deck (free public API, same service as above).
// Its tags are names, not numbers; `about` is the official bracket each one roughly matches.
const SPELLBOOK_TAGS = {
  E: { name: 'Exhibition', about: 1 }, C: { name: 'Core', about: 2 }, O: { name: 'Oddball', about: 2 },
  P: { name: 'Powerful', about: 3 }, S: { name: 'Spicy', about: 3 }, R: { name: 'Ruthless', about: 4 }, B: { name: 'Banned card', about: null },
};
const bracketCache = new Map();
// Combos one card away (item 151): Commander Spellbook's "almost included" combos for a list of names, in the deck's
// colors: [{ id, missing: [names], have: [names], produces: [features], popularity }], most popular first
const almostCache = new Map();
export async function almostCombos(commanders, main) {
  const key = [...commanders, '|', ...main].join('\n');
  if (almostCache.has(key)) return almostCache.get(key);
  const res = await fetch('https://backend.commanderspellbook.com/find-my-combos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ commanders: commanders.map(card => ({ card })), main: main.map(card => ({ card })) }),
  });
  if (!res.ok) throw new Error(`Commander Spellbook answered ${res.status}`);
  const data = await res.json();
  const have = new Set([...commanders, ...main].map(n => n.toLowerCase()));
  const out = (data.results?.almostIncluded || []).map(v => {
    const uses = (v.uses || []).map(u => u.card.name);
    return { id: v.id, missing: uses.filter(n => !have.has(n.toLowerCase())), have: uses.filter(n => have.has(n.toLowerCase())), produces: (v.produces || []).map(p => p.feature?.name).filter(Boolean), popularity: v.popularity || 0 };
  }).filter(c => c.missing.length === 1).sort((a, b) => b.popularity - a.popularity);
  almostCache.set(key, out);
  return out;
}

export async function fetchSpellbookBracket(deck) {
  const key = [...deck.commanders.map(c => c.name), ...deck.cards.map(c => `${c.qty}${c.card.name}`)].sort().join('|');
  if (bracketCache.has(key)) return bracketCache.get(key);
  const res = await fetch('https://backend.commanderspellbook.com/estimate-bracket', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ commanders: deck.commanders.map(c => ({ card: c.name })), main: deck.cards.map(c => ({ card: c.card.name, quantity: c.qty })) }),
  });
  if (!res.ok) throw new Error(`Commander Spellbook answered ${res.status}`);
  const data = await res.json();
  const tag = SPELLBOOK_TAGS[data.bracketTag];
  if (!tag) return null;
  const out = {
    tag: data.bracketTag, ...tag,
    gameChangers: (data.cards || []).filter(c => c.gameChanger).length,
    banned: (data.cards || []).filter(c => c.banned).map(c => c.card?.name).filter(Boolean),
    twoCard: (data.combos || []).filter(c => c.definitelyTwoCard).length,
  };
  bracketCache.set(key, out);
  return out;
}

// Add combos at runtime, skipping any whose set of pieces is already known
const isPiece = (o, k) => allKeys(o.card).includes(k);

// Where every piece of a combo is for player p, and whether it can be assembled this turn
export function comboState(g, p, combo) {
  const zones = ['battlefield', 'command', 'hand', 'library', 'graveyard', 'exile'];
  const found = combo.keys.map((k, i) => {
    for (const z of zones) {
      const o = p[z].find(x => isPiece(x, k));
      if (o) return { name: combo.pieces[i], key: k, o, zone: z };
    }
    return { name: combo.pieces[i], key: k, o: null, zone: 'missing' };
  });
  if (combo.imprint) {
    const host = found.find(f => f.key === key(combo.imprint.host));
    const card = found.find(f => f.key === key(combo.imprint.card));
    if (host.zone === 'battlefield') {
      // A Scepter already in play only works if it has the right card imprinted
      if (host.o.imprinted === key(combo.imprint.card)) card.zone = 'imprinted';
      else host.zone = 'spent';
    }
  }
  const usable = f => ['battlefield', 'command', 'hand', 'imprinted'].includes(f.zone);
  return {
    found,
    ready: found.every(usable),
    onBoard: found.filter(f => f.zone === 'battlefield' || f.zone === 'imprinted').length,
    missing: found.filter(f => !usable(f)),
  };
}
