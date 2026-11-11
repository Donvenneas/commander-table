// Scryfall: card data + official card images for every printing.
import { sleep, imgUrl } from './util.js';
import { analyzeCard } from './effects.js';
import { getCards, putCards } from './cardcache.js';
import { bulkAnswer, bulkCard } from './bulk.js';

const API = 'https://api.scryfall.com';
let nextSlot = 0;
const byId = new Map();

async function throttle() {
  // Scryfall asks for no more than ~10 requests per second.
  const now = Date.now();
  const wait = Math.max(0, nextSlot - now);
  nextSlot = Math.max(now, nextSlot) + 110;
  if (wait) await sleep(wait);
}

export async function sf(path, init = {}) {
  // Searches the saved card file can answer don't go to Scryfall at all (bulk.js; off unless turned on)
  if (!init.method || init.method === 'GET') { const local = await bulkAnswer(path); if (local) return local; }
  await throttle();
  const go = () => fetch(API + path, {
    ...init,
    headers: { Accept: 'application/json', ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
  });
  // When Scryfall is busy it answers 429 without CORS headers, which the browser reports only as a
  // network error: back off and try again a couple of times before giving up
  let r;
  for (let attempt = 0; ; attempt++) {
    try { r = await go(); } catch (e) { if (attempt >= 2) throw e; await sleep(1500 * (attempt + 1) ** 2); nextSlot = Date.now() + 500; continue; }
    if (r.status === 429 && attempt < 2) { await sleep(1500 * (attempt + 1) ** 2); continue; }
    break;
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.details || `Scryfall error ${r.status}`);
  return j;
}

export function normalize(raw) {
  if (byId.has(raw.id)) return byId.get(raw.id);
  const faces = raw.card_faces || [];
  const front = faces.length && !raw.oracle_text && faces[0].oracle_text !== undefined ? faces[0] : raw;
  const img = raw.image_uris || faces[0]?.image_uris || {};
  const back = faces[1]?.image_uris;
  const card = {
    id: raw.id,
    name: raw.name,
    frontName: front.name || raw.name,
    typeLine: front.type_line || raw.type_line || '',
    manaCost: front.mana_cost ?? raw.mana_cost ?? '',
    cmc: raw.cmc ?? 0,
    text: front.oracle_text ?? raw.oracle_text ?? '',
    fullText: raw.oracle_text ?? faces.map(f => `${f.name}\n${f.oracle_text || ''}`).join('\n—\n'),
    power: front.power ?? raw.power,
    toughness: front.toughness ?? raw.toughness,
    loyalty: front.loyalty ?? raw.loyalty,
    defense: front.defense ?? raw.defense,
    colors: front.colors ?? raw.colors ?? [],
    colorIdentity: raw.color_identity || [],
    keywords: raw.keywords || [],
    produced: raw.produced_mana || [],
    imgSmall: imgUrl(img.small), imgNormal: imgUrl(img.normal), imgLarge: imgUrl(img.large), art: imgUrl(img.art_crop),
    backNormal: imgUrl(back?.normal),
    set: raw.set, setName: raw.set_name, cn: raw.collector_number,
    artist: raw.artist, rarity: raw.rarity, uri: raw.scryfall_uri,
    legal: raw.legalities?.commander,
    // Every format's legality (formats.js checks decks against the table's format)
    legalities: raw.legalities || null,
    // On Wizards' official Game Changers list (it decides Commander brackets 3 and up)
    gameChanger: !!raw.game_changer,
    canBeCommander: /can be your commander/i.test(raw.oracle_text || faces.map(f => f.oracle_text).join(' ')),
  };
  card.fx = analyzeCard(card);
  // The back face of a transforming card, for "transform ~"
  if (faces.length > 1 && /transform|flip|meld/.test(raw.layout || '') && faces[1].oracle_text !== undefined) {
    const b = faces[1];
    /** @type {any} */
    const back = { ...card, name: b.name, frontName: b.name, typeLine: b.type_line || '', manaCost: '', text: b.oracle_text || '', power: b.power, toughness: b.toughness, loyalty: b.loyalty, colors: b.colors ?? card.colors, imgNormal: card.backNormal || card.imgNormal, canBeCommander: false };
    back.fx = analyzeCard(back);
    Object.defineProperty(card, 'backCard', { value: back, enumerable: false });
  }
  // The other half of an adventure card or a modal double-faced card (castable or playable instead of the front)
  card.layout = raw.layout || 'normal';
  if (faces.length > 1 && /^(adventure|modal_dfc|split)$/.test(raw.layout || '') && faces[1].oracle_text !== undefined) {
    const b = faces[1];
    const cost = b.mana_cost || '';
    const mv = [...cost.matchAll(/\{([^}]+)\}/g)].reduce((s, [, x]) => s + (/^\d+$/.test(x) ? +x : x === 'X' ? 0 : 1), 0);
    const dfc = raw.layout === 'modal_dfc';
    /** @type {any} */
    const alt = { ...card, name: b.name, frontName: b.name, typeLine: b.type_line || '', manaCost: cost, cmc: mv, text: b.oracle_text || '', power: b.power, toughness: b.toughness, loyalty: b.loyalty, colors: b.colors ?? card.colors, keywords: [], produced: dfc ? card.produced : [], imgNormal: dfc ? card.backNormal || card.imgNormal : card.imgNormal, imgSmall: dfc ? card.backNormal || card.imgSmall : card.imgSmall, canBeCommander: false, isAltFace: raw.layout };
    alt.fx = analyzeCard(alt);
    Object.defineProperty(card, 'altFace', { value: alt, enumerable: false });
  }
  byId.set(raw.id, card);
  return card;
}

function matches(ident, c) {
  if (ident.id) return c.id === ident.id;
  if (ident.set) return c.set === ident.set.toLowerCase() && c.collector_number === String(ident.collector_number);
  const n = ident.name.toLowerCase();
  return c.name.toLowerCase() === n || (c.card_faces || []).some(f => f.name.toLowerCase() === n) || c.name.toLowerCase().split(' // ')[0] === n;
}

// identifiers: [{id} | {set, collector_number} | {name}] -> Map(key -> normalized card)
// Cards saved from earlier loads come from the browser's database (cardcache.js); only new ones are
// asked for. Saved card text is refreshed from Scryfall when it's more than 30 days old and online.
const FRESH = 30 * 24 * 3600 * 1000;
export async function fetchCollection(identifiers, onProgress) {
  const key = i => JSON.stringify(i);
  const uniq = [...new Map(identifiers.map(i => [key(i), i])).values()];
  const out = new Map();
  const missing = [];
  const saved = await getCards(uniq.map(key));
  // (cards saved before the last new set came out are fetched again: legalities and rotations change; sets.js)
  let staleBefore = 0;
  try { staleBefore = +JSON.parse(localStorage.getItem('ct.cardsStaleBefore') || '0') || 0; } catch { /* no storage */ }
  for (const [k, raw] of saved) if (!raw._at || (Date.now() - raw._at < FRESH && raw._at >= staleBefore)) out.set(k, normalize(raw));
  // Cards asked for by name (or by the id of the printing it has) come from the saved card file, when it's on
  for (const i of uniq) {
    if (out.has(key(i)) || i.set) continue;
    const raw = await bulkCard(i);
    if (raw) out.set(key(i), normalize(raw));
  }
  const need = uniq.filter(i => !out.has(key(i)));
  const fresh = [];
  try {
    for (let i = 0; i < need.length; i += 75) {
      const chunk = need.slice(i, i + 75);
      const j = await sf('/cards/collection', { method: 'POST', body: JSON.stringify({ identifiers: chunk }) });
      for (const ident of chunk) {
        const hit = j.data.find(c => matches(ident, c));
        if (hit) { out.set(key(ident), normalize(hit)); fresh.push([key(ident), { ...hit, _at: Date.now() }]); } else missing.push(ident);
      }
      onProgress?.(Math.min(need.length, i + 75), need.length);
    }
  } catch (e) {
    // Offline: older saved copies are still good enough
    for (const ident of need) { const raw = saved.get(key(ident)); if (raw) out.set(key(ident), normalize(raw)); }
    if (need.some(i => !out.has(key(i)))) throw new Error(`${e.message}. Cards not loaded before can't be fetched without an internet connection.`);
  }
  putCards(fresh);
  return { cards: out, missing, key };
}

// What each Commander bracket leaves out of a generated deck (Scryfall search syntax)
const BRACKET_FILTER = {
  1: '-is:gamechanger -o:"extra turn" -o:"destroy all lands" -o:"sacrifices all lands" -(o:"search your library for a" -o:land)',
  2: '-is:gamechanger -o:"extra turn" -o:"destroy all lands" -o:"sacrifices all lands"',
  3: '-o:"destroy all lands" -o:"sacrifices all lands"',
  4: '',
};

// A random commander plus the most-played cards in its colors (Scryfall's EDHREC ordering).
// With a bracket (1–4) the deck stays inside that bracket: no Game Changers in 1–2 and at most three
// in 3, no mass land destruction, no extra turns below 3, no two-card combos below 4, and bracket 1
// also skips tutors and the most-played staples.
// Budget-style card pools, from Scryfall search terms only (no prices): no Reserved List cards, or
// commons and uncommons only (Pauper Commander style, with an uncommon commander)
export const BUDGET = {
  any: { label: 'Any cards', cmd: '', cards: '' },
  noRL: { label: 'No Reserved List', cmd: '-is:reserved', cards: '-is:reserved' },
  pauper: { label: 'Commons and uncommons (Pauper Commander style)', cmd: 'r:uncommon', cards: 'r<=uncommon' },
};
/**
 * @param {any} onStatus
 * @param {number | null} [bracket]
 * @param {{ combosIn?: Function, budget?: string }} [opts]
 */
export async function randomDeck(onStatus, bracket = null, { combosIn, budget = 'any' } = {}) {
  const b = BUDGET[budget] || BUDGET.any;
  onStatus?.('Picking a random commander…');
  // (Pauper-style commanders are uncommon creatures, which don't need to be legendary)
  const cmdQuery = budget === 'pauper' ? `t:creature legal:commander game:paper -is:digital ${b.cmd} (t:legendary or is:commander or r:uncommon)` : `is:commander legal:commander game:paper t:creature -is:digital ${b.cmd}`;
  const cmd = await sf('/cards/random?q=' + encodeURIComponent(`${cmdQuery}${bracket && bracket <= 2 ? ' -is:gamechanger' : ''}`));
  const ci = cmd.color_identity.join('').toLowerCase() || 'c';
  onStatus?.(`Building around ${cmd.name}${bracket ? ` for bracket ${bracket}` : ''}${budget !== 'any' ? ` (${b.label.toLowerCase()})` : ''}…`);
  const spells = await sf('/cards/search?order=edhrec&q=' + encodeURIComponent(`legal:commander game:paper id<=${ci} -t:land -is:digital ${BRACKET_FILTER[bracket] || ''} ${b.cards}`));
  const pool = spells.data.filter(c => c.name !== cmd.name).slice(bracket === 1 ? 25 : 0);
  const picks = [];
  let changers = 0;
  for (const c of pool) {
    if (picks.length >= 62) break;
    if (bracket === 3 && c.game_changer && changers >= 3) continue;
    // Below bracket 4, don't hand the deck a two-card combo
    if (bracket && bracket <= 3 && combosIn) {
      const names = [cmd, ...picks, c].map(x => ({ name: x.name }));
      if (combosIn(names).some(k => k.pieces.length === 2)) continue;
    }
    if (c.game_changer) changers++;
    picks.push(c);
  }
  let nonbasic = [];
  if (cmd.color_identity.length >= 2) {
    const lands = await sf('/cards/search?order=edhrec&q=' + encodeURIComponent(`legal:commander game:paper id<=${ci} t:land -t:basic -is:digital ${b.cards}`)).catch(() => ({ data: [] }));
    nonbasic = lands.data.slice(0, 10);
  } else {
    const lands = await sf('/cards/search?order=edhrec&q=' + encodeURIComponent(`legal:commander game:paper id<=${ci} t:land -t:basic -is:digital produces:${cmd.color_identity[0] || 'c'} ${b.cards}`)).catch(() => ({ data: [] }));
    nonbasic = lands.data.slice(0, 4);
  }
  const basicNames = { W: 'Plains', U: 'Island', B: 'Swamp', R: 'Mountain', G: 'Forest' };
  const colors = cmd.color_identity.length ? cmd.color_identity : ['C'];
  const basicCount = 37 - nonbasic.length;
  const names = colors.map(c => basicNames[c] || 'Wastes');
  const { cards, key } = await fetchCollection(names.map(name => ({ name })));
  const deckCards = [...picks, ...nonbasic].map(c => ({ card: normalize(c), qty: 1 }));
  names.forEach((name, i) => {
    const qty = Math.floor(basicCount / names.length) + (i < basicCount % names.length ? 1 : 0);
    deckCards.push({ card: cards.get(key({ name })), qty });
  });
  return { deckName: `${cmd.name} (random${bracket ? `, bracket ${bracket}` : ''}${budget !== 'any' ? `, ${budget === 'pauper' ? 'pauper' : 'no Reserved List'}` : ''})`, commanders: [normalize(cmd)], cards: deckCards, warnings: [] };
}

// A random deck for a Commander variant: Brawl (a legendary creature or planeswalker, 60 cards),
// Pauper Commander (an uncommon creature and commons, 100 cards) or Oathbreaker (a planeswalker plus
// an instant or sorcery as its signature spell, 60 cards). The most-played legal cards in its colors.
/**
 * @param {any} onStatus
 * @param {string} key
 * @param {{ combosIn?: Function }} [opts]
 */
export async function randomVariant(onStatus, key, { combosIn } = {}) {
  const f = { brawl: { legal: 'brawl', deck: 60, lands: 24 }, paupercommander: { legal: 'paupercommander', deck: 100, lands: 37 }, oathbreaker: { legal: 'oathbreaker', deck: 60, lands: 20 }, duel: { legal: 'duel', deck: 100, lands: 37 } }[key];
  const label = { brawl: 'Brawl', paupercommander: 'Pauper Commander', oathbreaker: 'Oathbreaker', duel: 'Duel Commander' }[key];
  onStatus?.(`Picking a random ${key === 'oathbreaker' ? 'oathbreaker' : 'commander'}…`);
  const cmdQuery = {
    brawl: 'legal:brawl game:paper -is:digital t:legendary (t:creature or t:planeswalker)',
    // (Scryfall lists uncommon commanders as not legal in Pauper Commander, so no legality term here)
    paupercommander: 't:creature r:uncommon game:paper -is:digital -t:token',
    oathbreaker: 'legal:oathbreaker game:paper -is:digital t:planeswalker',
    duel: 'legal:duel game:paper -is:digital t:legendary t:creature',
  }[key];
  const cmd = await sf('/cards/random?q=' + encodeURIComponent(cmdQuery));
  const ci = cmd.color_identity.join('').toLowerCase() || 'c';
  onStatus?.(`Building a ${label} deck around ${cmd.name}…`);
  const commanders = [normalize(cmd)];
  const used = new Set([cmd.name]);
  if (key === 'oathbreaker') {
    const sig = await sf('/cards/search?order=edhrec&q=' + encodeURIComponent(`legal:oathbreaker game:paper -is:digital id<=${ci} (t:instant or t:sorcery)`)).then(j => j.data).catch(() => []);
    const pick = sig.find(c => !used.has(c.name));
    if (pick) { commanders.push(normalize(pick)); used.add(pick.name); }
  }
  const spellN = f.deck - f.lands - commanders.length;
  const spells = (await sf('/cards/search?order=edhrec&q=' + encodeURIComponent(`legal:${f.legal} game:paper -is:digital id<=${ci} -t:land`)).then(j => j.data).catch(() => []))
    .filter(c => !used.has(c.name));
  const picks = [];
  for (const c of spells) {
    if (picks.length >= spellN) break;
    // Random variant decks stay casual: no two-card combos
    if (combosIn && combosIn([...commanders, ...picks, c].map(x => ({ name: x.name }))).some(k => k.pieces.length === 2)) continue;
    picks.push(c); used.add(c.name);
  }
  const nonbasic = cmd.color_identity.length >= 2
    ? (await sf('/cards/search?order=edhrec&q=' + encodeURIComponent(`legal:${f.legal} game:paper -is:digital id<=${ci} t:land -t:basic`)).then(j => j.data).catch(() => [])).slice(0, Math.round(f.lands / 4))
    : [];
  const basicNames = { W: 'Plains', U: 'Island', B: 'Swamp', R: 'Mountain', G: 'Forest' };
  const colors = cmd.color_identity.length ? cmd.color_identity : ['C'];
  const names = colors.map(c => basicNames[c] || 'Wastes');
  const { cards, key: k } = await fetchCollection(names.map(name => ({ name })));
  const deckCards = [...picks, ...nonbasic].map(c => ({ card: normalize(c), qty: 1 }));
  // Basics fill the deck to its exact size (short searches leave more room for lands)
  const basicCount = f.deck - commanders.length - deckCards.length;
  names.forEach((name, i) => {
    const qty = Math.floor(basicCount / names.length) + (i < basicCount % names.length ? 1 : 0);
    if (qty > 0) deckCards.push({ card: cards.get(k({ name })), qty });
  });
  return { deckName: `${commanders.map(c => c.name).join(' + ')} (random ${label})`, commanders, cards: deckCards, sideboard: [], warnings: [] };
}

// A random 60-card deck for a duel format (Standard, Modern, Pauper…): one or two random colors, the
// most-played legal cards in them (Scryfall's EDHREC ordering is the only popularity order it has),
// nine spells as 4-ofs along a mana curve, 24 lands with up to eight dual lands, and a 15-card
// sideboard of interaction for best-of-three
const COLOR_NAMES = { W: 'white', U: 'blue', B: 'black', R: 'red', G: 'green' };
export async function randomConstructed(onStatus, f, rand = Math.random) {
  const pick = [...'WUBRG'].sort(() => rand() - 0.5).slice(0, rand() < 0.35 ? 1 : 2);
  const ci = pick.join('').toLowerCase();
  const rar = f.rarity ? ` (${f.rarity.map(r => `r:${r}`).join(' or ')})` : '';
  const base = `legal:${f.legal} game:paper -is:digital id<=${ci} ${rar}`;
  onStatus?.(`Building a random ${pick.map(c => COLOR_NAMES[c]).join('-')} ${f.name} deck…`);
  const search = q => sf('/cards/search?order=edhrec&q=' + encodeURIComponent(q)).then(j => j.data).catch(() => []);
  // Every spell uses the deck's colors (colorless cards rank high everywhere and would fill every deck)
  const inColors = c => (c.colors || c.card_faces?.[0]?.colors || []).some(x => pick.includes(x));
  const creatures = (await search(`${base} t:creature -t:land cmc>=1 cmc<=5`)).filter(inColors);
  const others = (await search(`${base} -t:creature -t:land cmc<=5`)).filter(inColors);
  if (creatures.length < 5 || others.length < 4) throw new Error(`Scryfall didn't find enough ${f.name} cards in those colors. Try again.`);
  // A curve: two 1–2 drops, two 3-drops, one 4–5 drop among the creatures; cheap interaction first among the rest
  const take = (list, n, used, ok = (/** @type {any} */ _c) => true) => { const out = []; for (const c of list) { if (out.length >= n) break; if (!used.has(c.name) && ok(c)) { out.push(c); used.add(c.name); } } return out; };
  const used = new Set();
  const spells = [
    ...take(creatures, 2, used, c => c.cmc <= 2), ...take(creatures, 2, used, c => c.cmc === 3), ...take(creatures, 1, used, c => c.cmc >= 4),
    ...take(others, 2, used, c => c.cmc <= 2), ...take(others, 2, used),
  ];
  while (spells.length < 9) { const more = take([...creatures, ...others], 1, used); if (!more.length) break; spells.push(...more); }
  // Sideboard: the next most-played cheap interaction (removal, counters, discard, artifact and enchantment hate)
  const sideboardPool = others.filter(c => !used.has(c.name) && /destroy|exile|counter target|discard|damage|return target/i.test(c.oracle_text || c.card_faces?.[0]?.oracle_text || ''));
  const side = take(sideboardPool, 5, used);
  let duals = [];
  if (pick.length === 2) {
    duals = (await search(`legal:${f.legal} game:paper -is:digital t:land -t:basic produces:${pick[0].toLowerCase()} produces:${pick[1].toLowerCase()} id<=${ci} ${rar}`)).slice(0, 2);
  }
  const basicNames = { W: 'Plains', U: 'Island', B: 'Swamp', R: 'Mountain', G: 'Forest' };
  const basics = pick.map(c => basicNames[c]);
  const { cards, key } = await fetchCollection(basics.map(name => ({ name })));
  const deckCards = spells.map(c => ({ card: normalize(c), qty: 4 }));
  duals.forEach(c => deckCards.push({ card: normalize(c), qty: 4 }));
  const basicCount = 24 - duals.length * 4;
  // Basics split by the colored pips in the spells
  const pips = pick.map(c => spells.reduce((a, s) => a + ((s.mana_cost || s.card_faces?.[0]?.mana_cost || '').match(new RegExp(`\\{${c}`, 'g')) || []).length, 0) + 1);
  const total = pips.reduce((a, b) => a + b, 0);
  let left = basicCount;
  basics.forEach((name, i) => {
    const qty = i === basics.length - 1 ? left : Math.round((basicCount * pips[i]) / total);
    left -= qty;
    if (qty > 0) deckCards.push({ card: cards.get(key({ name })), qty });
  });
  return {
    deckName: `Random ${pick.map(c => COLOR_NAMES[c]).join('-')} ${f.name}`,
    commanders: [], cards: deckCards,
    sideboard: f.sideboard ? side.map(c => ({ card: normalize(c), qty: 3 })) : [],
    warnings: [],
  };
}
