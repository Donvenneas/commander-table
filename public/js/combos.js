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
const BY_PIECE = new Map();
for (const c of COMBOS) for (const k of c.keys) BY_PIECE.set(k, [...(BY_PIECE.get(k) || []), c]);

export function combosFor(card) {
  const out = new Set();
  for (const k of allKeys(card)) for (const c of BY_PIECE.get(k) || []) out.add(c);
  return [...out];
}

// Combos whose every piece is somewhere in a list of cards (a decklist, or all of a player's objects)
export function combosIn(cards) {
  const names = new Set(cards.flatMap(allKeys));
  return COMBOS.filter(c => c.keys.every(k => names.has(k)));
}

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
export function readPrerequisites(text, pieces) {
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
      if (names.some(n => !n)) return null;
      req.unsick.push(...names);
      continue;
    }
    if ((m = s.match(/^(.+?) (?:is|are) untapped$/i))) {
      const names = m[1].split(/,\s*|\s+and\s+/).map(isPiece);
      if (names.some(n => !n)) return null;
      req.untapped.push(...names);
      continue;
    }
    if ((m = s.match(/^(.+?) is paired with (.+)$/i)) && isPiece(m[1]) && isPiece(m[2])) continue;
    if ((m = s.match(/^(.+?) (?:is|are) on the battlefield$/i)) && m[1].split(/,\s*|\s+and\s+/).every(isPiece)) continue;
    // ("up to five lands" is the most the loop uses: three are enough to start it)
    if ((m = s.match(/^you control (at least |up to )?(\w+) (?:other )?(?:untapped )?lands?\b/i))) { const k = NUM[m[2].toLowerCase()] || +m[2] || 3; req.minLands = Math.max(req.minLands, /up to/i.test(m[1] || '') ? Math.min(3, k) : Math.min(5, k)); continue; }
    if ((m = s.match(/^you control (?:at least )?(\w+) (?:other )?(?:untapped )?(?:nontoken )?creatures?\b/i))) { req.minCreatures = Math.max(req.minCreatures, NUM[m[1].toLowerCase()] || +m[1] || 1); continue; }
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
  if (combo.minLands && p.battlefield.filter(o => o.fx.type.land).length < combo.minLands) return `it needs ${combo.minLands} lands`;
  if (combo.minCreatures && p.battlefield.filter(o => o.fx.type.creature).length < combo.minCreatures) return `it needs ${combo.minCreatures} creatures`;
  if (combo.check && !combo.check(g, p)) return 'its conditions are not met';
  return null;
}

export async function fetchSpellbook(deck) {
  const names = [...deck.commanders.map(c => c.name), ...deck.cards.map(c => c.card.name)];
  const cacheKey = names.slice().sort().join('|');
  if (spellbookCache.has(cacheKey)) return spellbookCache.get(cacheKey);
  const res = await fetch('https://backend.commanderspellbook.com/find-my-combos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ commanders: deck.commanders.map(c => ({ card: c.name })), main: deck.cards.map(c => ({ card: c.card.name })) }),
  });
  if (!res.ok) throw new Error(`Commander Spellbook answered ${res.status}`);
  const data = await res.json();
  const out = [];
  for (const v of data.results?.included || []) {
    const uses = v.uses || [];
    if (uses.length < 2 || uses.length > 4 || (v.requires || []).length) continue;
    if (uses.some(u => (u.zoneLocations || []).some(z => !'BHC'.includes(z)))) continue;
    const features = (v.produces || []).map(p => p.feature?.name || '').filter(Boolean);
    let result = FEATURE_RESULT.find(([re]) => features.some(f => re.test(f)))?.[1];
    const pieces = uses.map(u => u.card.name);
    let payoff = null;
    if (!result && pieces.length <= 4) {
      // A finisher from the same deck turns the loop into a win
      for (const [re, cards, res] of PAYOFFS) {
        if (!features.some(f => re.test(f))) continue;
        payoff = cards.find(c => names.includes(c) && !pieces.includes(c) && res(c));
        if (payoff) { result = res(payoff); break; }
      }
    }
    if (!result) continue;
    // Spellbook's prerequisites, as sentences: the ones the engine can check become rules for the
    // combo; a combo with one it can't check is left out rather than run when it might not work
    const req = readPrerequisites(`${v.easyPrerequisites || ''}\n${v.notablePrerequisites || ''}`, pieces);
    if (!req) continue;
    for (const u of uses) if (/untapped/i.test(u.battlefieldCardState || '')) req.untapped.push(u.card.name);
    const mana = (v.manaNeeded || '').match(/\{[^}]+\}/g) || [];
    out.push({
      pieces: payoff ? [...pieces, payoff] : pieces,
      result,
      untapped: [...new Set(req.untapped)], unsick: [...new Set(req.unsick)], minLands: req.minLands, minCreatures: req.minCreatures,
      ...(payoff && ORACLES.includes(payoff) ? { last: payoff } : {}),
      mana: mana.reduce((s, m) => s + (/^\{\d+\}$/.test(m) ? +m.slice(1, -1) : 1), 0),
      note: `Commander Spellbook: ${features.slice(0, 3).join(', ').toLowerCase()}${payoff ? `, finished by ${payoff}` : ''}`,
      source: 'spellbook',
      url: `https://commanderspellbook.com/combo/${v.id}/`,
    });
  }
  const added = registerCombos(out);
  spellbookCache.set(cacheKey, added);
  return added;
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
export function registerCombos(list) {
  const known = new Set(COMBOS.map(c => [...c.keys].sort().join('|')));
  const added = [];
  for (const c of list) {
    c.keys = c.pieces.map(key);
    const sig = [...c.keys].sort().join('|');
    if (known.has(sig)) { added.push(COMBOS.find(x => [...x.keys].sort().join('|') === sig)); continue; }
    known.add(sig);
    c.id = COMBOS.length;
    c.label = c.pieces.join(' + ');
    COMBOS.push(c);
    for (const k of c.keys) BY_PIECE.set(k, [...(BY_PIECE.get(k) || []), c]);
    added.push(c);
  }
  return added;
}

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
