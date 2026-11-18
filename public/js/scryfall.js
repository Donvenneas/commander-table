// Scryfall: card data + official card images for every printing.
import { sleep, imgUrl, hashText, stableJson } from './util.js';
import { analyzeCard } from './effects.js';
import { getCards, putCards } from './cardcache.js';
import { check, safeImageUrl } from './carddata.js';
import { bulkAnswer, bulkCard } from './bulk.js';

const API = 'https://api.scryfall.com';
let nextSlot = 0;
// (normalized cards by Scryfall id and data hash: a card whose Scryfall data changed is a new card)
const byId = new Map();

// The parts of Scryfall's card data the game reads (build below). Replays keep this much of every card they use
// (replaydata.js), and its hash tells when Scryfall's data for a card has changed.
const CARD_KEYS = ['id', 'oracle_id', 'name', 'layout', 'oracle_text', 'mana_cost', 'cmc', 'type_line', 'power', 'toughness', 'loyalty', 'defense',
  'colors', 'color_identity', 'keywords', 'produced_mana', 'set', 'set_name', 'collector_number', 'artist', 'rarity', 'scryfall_uri',
  'legalities', 'game_changer'];
const FACE_KEYS = ['name', 'oracle_text', 'mana_cost', 'type_line', 'power', 'toughness', 'loyalty', 'defense', 'colors'];
const IMG_KEYS = ['small', 'normal', 'large', 'art_crop'];
const pick = (o, keys) => Object.fromEntries(keys.filter(k => o[k] !== undefined).map(k => [k, o[k]]));
export function slimCard(raw) {
  const out = pick(raw, CARD_KEYS);
  if (raw.image_uris) out.image_uris = pick(raw.image_uris, IMG_KEYS);
  if (raw.card_faces) out.card_faces = raw.card_faces.map(f => ({ ...pick(f, FACE_KEYS), ...(f.image_uris ? { image_uris: pick(f.image_uris, IMG_KEYS) } : {}) }));
  return out;
}
export const cardDataHash = raw => hashText(stableJson(slimCard(raw)));
// (only what can change a game: Scryfall updating a card's legalities, images or artist isn't reported as a change)
const NOT_PLAY = ['oracle_id', 'legalities', 'image_uris', 'artist', 'set_name', 'scryfall_uri', 'rarity'];
const playHash = raw => { const s = slimCard(raw); for (const k of NOT_PLAY) delete s[k]; for (const f of s.card_faces || []) delete f.image_uris; return hashText(stableJson(s)); };

// A loaded replay's own card data (replaydata.js): while it's set, decks are built from it before anything else, so
// the replay plays with the cards as they were. Cards whose saved copy in this browser differs are noted.
/** @type {any[] | null} */
let pinned = null;
let pinNotes = { used: 0, differs: /** @type {string[]} */ ([]), notSaved: /** @type {string[]} */ ([]) };
// (pinCards(null) when the replay's decks are built; the notes stay readable until the next replay)
export function pinCards(raws) { pinned = raws ? [...raws] : null; if (raws) pinNotes = { used: 0, differs: [], notSaved: [] }; }
export const pinReport = () => pinNotes;

// ---------- talking to Scryfall (1.56.0, Phase 2N)
// Scryfall's guidance: about 10 requests a second at most (50–100 ms apart), back off on HTTP 429, and keep what was
// fetched (cards change rarely). The game waits 110 ms between requests and, to stay well inside the limits on the
// heavier card endpoints, 500 ms between searches, random cards, named cards and collections; it honours Retry-After,
// tries three times at most, and never waits more than 15 s for an answer. Identical GET requests in flight share one
// answer. After a network failure the game counts as offline for 30 s (60 s, then 120 s if it keeps failing): requests
// in that time fail at once with an "offline" error instead of each waiting for the network, and saved data is used.
// The browser's online event, or any request that works, ends it. netStatus() and onNetStatus() feed the offline chip.
const HEAVY = /^\/cards\/(search|random|named|collection)\b/;
const timing = { timeout: 15000, backoff: 1500, gap: 110, heavyGap: 500 };
let heavySlot = 0;
/** @type {Map<string, Promise<any>>} */
const inflight = new Map();
const net = { online: true, since: 0, until: 0, failures: 0, lastError: '', requests: 0, shared: 0 };
/** @type {Set<Function>} */
const netWatchers = new Set();
const tellNet = () => { for (const f of netWatchers) try { f(netStatus()); } catch { /* a watcher's problem */ } };
/** Whether Scryfall is reachable, as far as the game knows (requests: sent to Scryfall, shared: answered by another one) */
export const netStatus = () => ({ online: net.online, since: net.since, lastError: net.lastError, requests: net.requests, shared: net.shared });
/** @param {(s: ReturnType<typeof netStatus>) => void} f */
export function onNetStatus(f) { netWatchers.add(f); return () => netWatchers.delete(f); }
function wentOffline(msg) {
  net.failures++;
  net.until = Date.now() + Math.min(120000, 30000 * 2 ** Math.min(2, net.failures - 1));
  net.lastError = msg;
  if (net.online) { net.online = false; net.since = Date.now(); tellNet(); }
}
function backOnline() {
  net.failures = 0; net.until = 0;
  if (!net.online) { net.online = true; net.since = Date.now(); tellNet(); }
}
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => { net.until = 0; backOnline(); });
  window.addEventListener('offline', () => wentOffline('the browser reports no connection'));
}
/** For tests: forget the offline state and the counts, and set the waits (ms) */
export function resetNet(t = {}) { Object.assign(net, { online: true, since: 0, until: 0, failures: 0, lastError: '', requests: 0, shared: 0 }); nextSlot = 0; heavySlot = 0; inflight.clear(); Object.assign(timing, t); }

/** An error from talking to Scryfall: status (HTTP status, 0 when there was no answer), offline (no network) */
export class ScryfallError extends Error {
  constructor(msg, { status = 0, offline = false } = {}) { super(msg); this.status = status; this.offline = offline; }
}

async function throttle(path) {
  const now = Date.now();
  const heavy = HEAVY.test(path);
  const at = Math.max(now, nextSlot, heavy ? heavySlot : 0);
  nextSlot = at + timing.gap;
  if (heavy) heavySlot = at + timing.heavyGap;
  if (at > now) await sleep(at - now);
}

// (fetch with a time limit: a request that hangs is cut off, so a loading deck never waits forever)
async function fetchWithin(url, init) {
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  let timer;
  const limit = new Promise((_, rej) => { timer = setTimeout(() => { ctl?.abort(); rej(new ScryfallError(`Scryfall did not answer within ${timing.timeout / 1000} s`, { offline: true })); }, timing.timeout); });
  try { return await Promise.race([fetch(url, { ...init, ...(ctl ? { signal: ctl.signal } : {}) }), limit]); } finally { clearTimeout(timer); }
}
const retryAfter = r => { const v = +(r.headers?.get?.('Retry-After') || 0); return Number.isFinite(v) && v > 0 ? Math.min(v, 30) * 1000 : 0; };

export async function sf(path, init = {}) {
  const get = !init.method || init.method === 'GET';
  // Searches the saved card file can answer don't go to Scryfall at all (bulk.js; off unless turned on)
  if (get) { const local = await bulkAnswer(path); if (local) return local; }
  if (!get) return request(path, init);
  // (one request for identical GETs asked at the same time)
  const shared = inflight.get(path);
  if (shared) { net.shared++; return shared; }
  const p = request(path, init).finally(() => inflight.delete(path));
  inflight.set(path, p);
  return p;
}

async function request(path, init) {
  if (!net.online && Date.now() < net.until) throw new ScryfallError(`Offline: Scryfall can't be reached (${net.lastError || 'no connection'}). Saved cards still work.`, { offline: true });
  const go = async () => {
    await throttle(path);
    net.requests++;
    return fetchWithin(API + path, { ...init, headers: { Accept: 'application/json', ...(init.body ? { 'Content-Type': 'application/json' } : {}) } });
  };
  // When Scryfall is busy it answers 429 (sometimes without CORS headers, which the browser reports only as a network
  // error) or 5xx: back off and try again twice before giving up
  let r;
  for (let attempt = 0; ; attempt++) {
    try { r = await go(); } catch (e) {
      if (attempt >= 2) {
        wentOffline(e?.message || 'network error');
        throw e instanceof ScryfallError ? e : new ScryfallError(`Can't reach Scryfall (${e?.message || 'network error'})`, { offline: true });
      }
      await sleep(timing.backoff * (attempt + 1) ** 2); nextSlot = Date.now() + timing.heavyGap; continue;
    }
    if ((r.status === 429 || r.status >= 500) && attempt < 2) { await sleep(retryAfter(r) || timing.backoff * (attempt + 1) ** 2); continue; }
    break;
  }
  backOnline();
  let j;
  try { j = await r.json(); } catch { j = null; }
  if (!r.ok) {
    if (r.status === 429) throw new ScryfallError('Scryfall is busy (too many requests). Wait a minute and try again.', { status: 429 });
    throw new ScryfallError(j && typeof j.details === 'string' ? j.details.slice(0, 300) : `Scryfall error ${r.status}`, { status: r.status });
  }
  // (a successful answer that isn't Scryfall data: a cut-off reply, or a page from a captive portal or proxy)
  if (!j || typeof j !== 'object' || Array.isArray(j) || (j.object === 'list' && !Array.isArray(j.data))) throw new ScryfallError("Scryfall's answer wasn't card data (cut off, or from another site)", { status: r.status });
  return j;
}

// A mana cost's mana value (202.3): {2/W} counts 2, X counts 0, every other symbol 1
export function costMv(cost) {
  return [...String(cost || '').matchAll(/\{([^}]+)\}/g)].reduce((s, [, x]) => s + (/^\d+$/.test(x) ? +x : /^[XYZ]$/.test(x) ? 0 : /^\d+\//.test(x) ? parseInt(x, 10) : 1), 0);
}
// The keywords one face has: Scryfall lists one set for the whole card, so a face keeps only those it has as an
// ability of its own (a keyword line such as "Flying, haste" or "Ward {2}"), not ones its other face has
export function faceKeywords(keywords, text) {
  const parts = String(text || '').replace(/\([^)]*\)/g, '').toLowerCase().split('\n').flatMap(l => l.split(/[,;]/).map(s => s.trim()));
  return (keywords || []).filter(k => { const kl = k.toLowerCase(); return parts.some(s => s === kl || (s.startsWith(kl) && /^[\s{—\-.:\d]/.test(s.slice(kl.length)))); });
}

export function normalize(raw) {
  const src = slimCard(raw);
  const hash = hashText(stableJson(src));
  const id = `${raw.id}|${hash}`;
  if (byId.has(id)) return byId.get(id);
  const card = build(raw, false);
  // (the Scryfall data it was built from, and its hash: what a replay saves)
  Object.defineProperty(card, 'src', { value: src, enumerable: false });
  Object.defineProperty(card, 'srcHash', { value: hash, enumerable: false });
  // (rules 8) The corrected reading of a card with more than one face, used by games at rules 8 and later (Game.mk):
  // each face has only its own keywords, a split card's half is cast with its own mana value (709.3b), and the
  // other half's mana value counts hybrid {2/W} as 2. Older games keep the reading above, so replays stay exact.
  if ((raw.card_faces || []).length > 1) Object.defineProperty(card, 'v8', { value: build(raw, true), enumerable: false });
  byId.set(id, card);
  return card;
}

// (a picture address only when it is one of Scryfall's own: carddata.js safeImageUrl; otherwise the card is shown in words)
const pic = u => imgUrl(safeImageUrl(u));

/** @returns {any} */
function build(raw, r8) {
  const faces = raw.card_faces || [];
  const front = faces.length && !raw.oracle_text && faces[0].oracle_text !== undefined ? faces[0] : raw;
  const img = raw.image_uris || faces[0]?.image_uris || {};
  const back = faces[1]?.image_uris;
  const backImg = back; // (the inner block below has its own 'back')
  const card = {
    id: raw.id,
    // (the card as a rule object, the same for every printing; null for cards Scryfall gives none)
    oracleId: raw.oracle_id || null,
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
    imgSmall: pic(img.small), imgNormal: pic(img.normal), imgLarge: pic(img.large), art: pic(img.art_crop),
    backNormal: pic(back?.normal),
    set: raw.set, setName: raw.set_name, cn: raw.collector_number,
    artist: raw.artist, rarity: raw.rarity, uri: raw.scryfall_uri,
    legal: raw.legalities?.commander,
    // Every format's legality (formats.js checks decks against the table's format)
    legalities: raw.legalities || null,
    // On Wizards' official Game Changers list (it decides Commander brackets 3 and up)
    gameChanger: !!raw.game_changer,
    canBeCommander: /can be your commander/i.test(raw.oracle_text || faces.map(f => f.oracle_text).join(' ')),
  };
  const multi = r8 && front !== raw;
  if (multi) card.keywords = faceKeywords(raw.keywords, front.oracle_text);
  card.fx = analyzeCard(card);
  // The back face of a transforming card, for "transform ~"
  if (faces.length > 1 && /transform|flip|meld/.test(raw.layout || '') && faces[1].oracle_text !== undefined) {
    const b = faces[1];
    /** @type {any} */
    const back = { ...card, name: b.name, frontName: b.name, typeLine: b.type_line || '', manaCost: '', text: b.oracle_text || '', power: b.power, toughness: b.toughness, loyalty: b.loyalty, colors: b.colors ?? card.colors, imgNormal: card.backNormal || card.imgNormal, canBeCommander: false };
    // (1.55.0) the back face's own small picture and art (the table showed the front's after a transform), and the
    // front as the "other face" for the preview. Pictures only: nothing a game reads.
    if (backImg) Object.assign(back, { imgSmall: pic(backImg.small) || card.imgSmall, imgLarge: pic(backImg.large) || card.imgLarge, art: pic(backImg.art_crop) || card.art, backNormal: card.imgNormal });
    if (multi) back.keywords = faceKeywords(raw.keywords, b.oracle_text);
    back.fx = analyzeCard(back);
    Object.defineProperty(card, 'backCard', { value: back, enumerable: false });
  }
  // The other half of an adventure card or a modal double-faced card (castable or playable instead of the front)
  card.layout = raw.layout || 'normal';
  if (faces.length > 1 && /^(adventure|modal_dfc|split)$/.test(raw.layout || '') && faces[1].oracle_text !== undefined) {
    const b = faces[1];
    const cost = b.mana_cost || '';
    const mv = r8 ? costMv(cost) : [...cost.matchAll(/\{([^}]+)\}/g)].reduce((s, [, x]) => s + (/^\d+$/.test(x) ? +x : x === 'X' ? 0 : 1), 0);
    const dfc = raw.layout === 'modal_dfc';
    /** @type {any} */
    const alt = { ...card, name: b.name, frontName: b.name, typeLine: b.type_line || '', manaCost: cost, cmc: mv, text: b.oracle_text || '', power: b.power, toughness: b.toughness, loyalty: b.loyalty, colors: b.colors ?? card.colors, keywords: multi ? faceKeywords(raw.keywords, b.oracle_text) : [], produced: dfc ? card.produced : [], imgNormal: dfc ? card.backNormal || card.imgNormal : card.imgNormal, imgSmall: dfc ? card.backNormal || card.imgSmall : card.imgSmall, canBeCommander: false, isAltFace: raw.layout };
    alt.fx = analyzeCard(alt);
    // (1.56.0) a modal card's back face shows its own small and large picture and art, not the front's (pictures only)
    if (dfc && backImg) Object.assign(alt, { imgSmall: pic(backImg.small) || alt.imgSmall, imgLarge: pic(backImg.large) || alt.imgLarge, art: pic(backImg.art_crop) || alt.art });
    Object.defineProperty(card, 'altFace', { value: alt, enumerable: false });
  }
  // (rules 8) A split card's first half as a spell: only its own mana value exists on the stack (709.3b), and a Room
  // on the battlefield with only that door unlocked has only that door's mana cost (709.5); everywhere else the
  // card's mana value is both halves' (709.4b)
  if (r8 && raw.layout === 'split' && faces.length > 1) {
    /** @type {any} */
    const half = { ...card, cmc: costMv(card.manaCost) };
    Object.defineProperty(half, 'altFace', { value: card.altFace, enumerable: false });
    Object.defineProperty(half, 'wholeCard', { value: card, enumerable: false });
    Object.defineProperty(card, 'frontHalf', { value: half, enumerable: false });
  }
  return card;
}

function matches(ident, c) {
  if (ident.id) return c.id === ident.id;
  if (ident.oracle_id) return c.oracle_id === ident.oracle_id;
  if (ident.set) return c.set === String(ident.set).toLowerCase() && c.collector_number === String(ident.collector_number);
  if (typeof ident.name !== 'string') return false;
  const n = ident.name.toLowerCase();
  return c.name.toLowerCase() === n || (c.card_faces || []).some(f => String(f?.name).toLowerCase() === n) || c.name.toLowerCase().split(' // ')[0] === n;
}

// identifiers: [{id} | {oracle_id} | {set, collector_number} | {name}] -> Map(key -> normalized card)
// Cards saved from earlier loads come from the browser's database (cardcache.js, which also finds a card saved under
// another of its identifiers); only new ones are asked for. Saved card text is refreshed from Scryfall when it's more
// than 30 days old and online; offline, older saved copies are used.
// (1.56.0, Phase 2N) Every card Scryfall sends is checked (carddata.js check) before it's used or saved: a damaged one
// counts as missing, with the reason in `rejected`. Cards fetched before a failure are still saved. A card another
// load is already fetching is waited for, not asked for twice.
const FRESH = 30 * 24 * 3600 * 1000;
/** @type {Map<string, Promise<any>>} key → the raw card another fetchCollection is fetching (null if it failed) */
const fetching = new Map();
export async function fetchCollection(identifiers, onProgress) {
  const key = i => JSON.stringify(i);
  const uniq = [...new Map(identifiers.map(i => [key(i), i])).values()];
  const out = new Map();
  const missing = [];
  /** @type {string[]} */
  const rejected = [];
  // A loaded replay's cards come first (pinCards)
  if (pinned) for (const i of uniq) { const raw = pinned.find(c => matches(i, c)); if (raw) { out.set(key(i), normalize(raw)); pinNotes.used++; } }
  const saved = await getCards(uniq.map(key));
  if (pinned) {
    for (const i of uniq) {
      const mine = out.get(key(i)), here = saved.get(key(i));
      if (mine && here && playHash(here) !== playHash(mine.src)) pinNotes.differs.push(mine.name);
      if (!mine) pinNotes.notSaved.push(i.name || `${i.set || ''} ${i.collector_number || i.id || i.oracle_id || ''}`.trim());
    }
    for (const k of [...saved.keys()]) if (out.has(k)) saved.delete(k);
  }
  // (cards saved before the last new set came out are fetched again: legalities and rotations change; sets.js)
  let staleBefore = 0;
  try { staleBefore = +JSON.parse(localStorage.getItem('ct.cardsStaleBefore') || '0') || 0; } catch { /* no storage */ }
  for (const [k, raw] of saved) if (!raw._at || (Date.now() - raw._at < FRESH && raw._at >= staleBefore)) out.set(k, normalize(raw));
  // Cards asked for by name (or by the id of the printing it has) come from the saved card file, when it's on
  for (const i of uniq) {
    if (out.has(key(i)) || i.set) continue;
    const raw = await bulkCard(i);
    if (raw && check(raw).ok) out.set(key(i), normalize(raw));
  }
  const need = uniq.filter(i => !out.has(key(i)));
  // (cards another load is fetching right now: wait for its answer instead of asking again)
  const theirs = need.filter(i => fetching.has(key(i))).map(i => /** @type {[any, Promise<any>]} */ ([i, /** @type {Promise<any>} */ (fetching.get(key(i)))]));
  const mine = need.filter(i => !fetching.has(key(i)));
  /** @type {Map<string, (raw: any) => void>} */
  const done = new Map();
  for (const i of mine) fetching.set(key(i), new Promise(res => done.set(key(i), res)));
  const fresh = [];
  let failure = null;
  try {
    for (let i = 0; i < mine.length; i += 75) {
      const chunk = mine.slice(i, i + 75);
      const j = await sf('/cards/collection', { method: 'POST', body: JSON.stringify({ identifiers: chunk }) });
      if (!Array.isArray(j.data)) throw new ScryfallError("Scryfall's answer wasn't a list of cards");
      for (const ident of chunk) {
        const hit = j.data.find(c => c && typeof c.name === 'string' && matches(ident, c));
        const verdict = hit ? check(hit) : null;
        if (hit && verdict?.ok) { out.set(key(ident), normalize(hit)); const rec = { ...hit, _at: Date.now() }; fresh.push([key(ident), rec]); done.get(key(ident))?.(rec); }
        else { if (hit) rejected.push(`${String(hit.name).slice(0, 80)}: ${verdict?.fatal.join(', ')}`); missing.push(ident); }
      }
      onProgress?.(Math.min(mine.length, i + 75), mine.length);
    }
  } catch (e) { failure = e; } finally {
    for (const i of mine) { done.get(key(i))?.(null); fetching.delete(key(i)); }
    // (cards fetched before a failure are kept too; only checked cards are ever saved)
    putCards(fresh);
  }
  for (const [ident, p] of theirs) {
    const raw = await p;
    if (raw) out.set(key(ident), normalize(raw));
    else if (!failure) {
      // (the other load failed or didn't find it: ask once more, alone)
      const again = await fetchCollection([ident]).catch(e => { failure = e; return null; });
      const c = again?.cards.get(key(ident));
      if (c) out.set(key(ident), c); else if (again) missing.push(ident);
    }
  }
  // Offline, Scryfall failing, or a refreshed card that came back damaged or not at all: an older saved copy is still
  // good enough (a failed refresh never loses a card that loaded before)
  for (const ident of need) {
    const raw = saved.get(key(ident));
    if (raw && !out.has(key(ident))) { out.set(key(ident), normalize(raw)); const at = missing.indexOf(ident); if (at >= 0) missing.splice(at, 1); }
  }
  if (failure) {
    const left = need.filter(i => !out.has(key(i)) && !missing.includes(i));
    if (left.length) {
      const e = /** @type {any} */ (failure);
      const why = e.offline ? "Cards not loaded before can't be fetched without an internet connection." : `${left.length} card${left.length === 1 ? '' : 's'} could not be fetched; try again later.`;
      const err = new ScryfallError(`${e.message}. ${why}`, { status: e.status || 0, offline: !!e.offline });
      throw err;
    }
  }
  return { cards: out, missing, key, rejected };
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
