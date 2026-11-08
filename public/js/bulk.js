// Scryfall's bulk card file ("Oracle Cards": one entry per card, about 25 MB to download), kept in the
// browser's database when the player turns it on (Updates window). With it, random decks, the deck
// builder and other searches are answered on this PC instead of with several Scryfall searches each,
// and they work offline. It's refreshed at most once a day, at startup, and only when Scryfall has a
// newer file. Searches it can't answer (sets, printings, syntax it doesn't know) still go to Scryfall.
//
// Only what the game uses is kept from each card (no prices, shop links or extra image sizes).

const DB = 'ct-bulk', STORE = 'chunks', META = 'ct.bulk', CHUNK = 2000, PAGE = 175;
const DAY = 20 * 3600 * 1000;
// Never search results by default on Scryfall either: tokens, emblems, art cards
const SKIP_LAYOUTS = new Set(['token', 'double_faced_token', 'emblem', 'art_series']);
// Shown only when the search asks for their type (Scryfall leaves these "extras" out too)
const EXTRA_LAYOUTS = new Set(['planar', 'scheme', 'vanguard']);

let cards = null, loading = null, byName = null, byId = null;

const readMeta = () => { try { return JSON.parse(localStorage.getItem(META) || 'null'); } catch { return null; } };
const writeMeta = m => { try { localStorage.setItem(META, JSON.stringify(m)); } catch { /* no storage */ } };
export const bulkInfo = () => readMeta();
export const bulkEnabled = () => !!readMeta()?.on;

function openDb() {
  if (!('indexedDB' in globalThis)) return Promise.resolve(null);
  return new Promise(res => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => res(req.result);
      req.onerror = () => res(null);
    } catch { res(null); }
  });
}

function slimImages(u) {
  return u ? { small: u.small, normal: u.normal, large: u.large, art_crop: u.art_crop } : undefined;
}
// The fields normalize() and the searches below read
function slim(c) {
  const out = {
    id: c.id, oracle_id: c.oracle_id, name: c.name, layout: c.layout, mana_cost: c.mana_cost, cmc: c.cmc,
    type_line: c.type_line, oracle_text: c.oracle_text, power: c.power, toughness: c.toughness, loyalty: c.loyalty,
    colors: c.colors, color_identity: c.color_identity, keywords: c.keywords, produced_mana: c.produced_mana,
    image_uris: slimImages(c.image_uris), set: c.set, set_name: c.set_name, collector_number: c.collector_number,
    artist: c.artist, rarity: c.rarity, scryfall_uri: c.scryfall_uri, legalities: c.legalities,
    game_changer: c.game_changer, reserved: c.reserved, edhrec_rank: c.edhrec_rank, games: c.games, digital: c.digital,
  };
  if (c.card_faces) out.card_faces = c.card_faces.map(f => ({
    name: f.name, mana_cost: f.mana_cost, type_line: f.type_line, oracle_text: f.oracle_text, colors: f.colors,
    power: f.power, toughness: f.toughness, loyalty: f.loyalty, image_uris: slimImages(f.image_uris),
  }));
  return out;
}

// ---------- download and storage

// Downloads the file and saves it. onStatus gets short progress messages. Returns the card count.
export async function downloadBulk(onStatus) {
  onStatus?.('Asking Scryfall for its card file…');
  const metaR = await fetch('https://api.scryfall.com/bulk-data/oracle-cards', { headers: { Accept: 'application/json' } });
  if (!metaR.ok) throw new Error(`Scryfall answered HTTP ${metaR.status}`);
  const info = await metaR.json();
  const url = info.jsonl_download_uri || info.download_uri;
  const r = await fetch(url);
  if (!r.ok || !r.body) throw new Error(`The card file download failed (HTTP ${r.status})`);
  const total = +(r.headers.get('Content-Length') || info.compressed_size || 0);
  // Read the (compressed) file with a progress message, then unpack it as a stream
  const reader = r.body.getReader();
  const parts = [];
  let got = 0, shown = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value); got += value.length;
    if (got - shown > 1 << 20) { shown = got; onStatus?.(`Downloading Scryfall's card file… ${(got / 1048576).toFixed(0)}${total ? ` of ${(total / 1048576).toFixed(0)}` : ''} MB`); }
  }
  const blob = new Blob(parts);
  const head = new Uint8Array(await blob.slice(0, 2).arrayBuffer());
  let stream = blob.stream();
  if (head[0] === 0x1f && head[1] === 0x8b) stream = stream.pipeThrough(new DecompressionStream('gzip'));
  const text = stream.pipeThrough(new TextDecoderStream()).getReader();
  const list = [];
  let buf = '';
  const line = l => {
    // (one card per line: JSON Lines, or Scryfall's JSON array with one card per line)
    l = l.trim().replace(/^\[/, '').replace(/,?\]?$/, '');
    if (!l.startsWith('{')) return;
    const c = JSON.parse(l);
    if (!SKIP_LAYOUTS.has(c.layout)) list.push(slim(c));
  };
  for (;;) {
    const { done, value } = await text.read();
    if (done) break;
    buf += value;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) { line(buf.slice(0, i)); buf = buf.slice(i + 1); }
    if (list.length % 5000 < 50) onStatus?.(`Reading cards… ${list.length}`);
  }
  line(buf);
  if (list.length < 10000) throw new Error(`The card file looks incomplete (${list.length} cards)`);
  onStatus?.(`Saving ${list.length} cards…`);
  const db = await openDb();
  if (!db) throw new Error('This browser can\'t save the card file (no IndexedDB)');
  await new Promise((res, rej) => {
    const tx = db.transaction(STORE, 'readwrite');
    const st = tx.objectStore(STORE);
    st.clear();
    for (let i = 0; i * CHUNK < list.length; i++) st.put(list.slice(i * CHUNK, (i + 1) * CHUNK), i);
    tx.oncomplete = () => res();
    tx.onerror = tx.onabort = () => rej(tx.error || new Error('Saving the card file failed'));
  });
  db.close();
  writeMeta({ on: true, at: Date.now(), updated: info.updated_at, count: list.length });
  use(list);
  return list.length;
}

function use(list) {
  cards = list; byName = new Map(); byId = new Map();
  // Full names first, then front faces, then other faces ("Fire" is Fire // Ice, not Start // Fire)
  const add = (n, c) => { if (!byName.has(n)) byName.set(n, c); };
  for (const c of list) { byId.set(c.id, c); add(c.name.toLowerCase(), c); }
  for (const c of list) add(c.name.toLowerCase().split(' // ')[0], c);
  for (const c of list) for (const f of c.card_faces || []) if (f.name) add(f.name.toLowerCase(), c);
}

// The saved cards (loaded once), or null when the file is off or not downloaded
export function loadBulk() {
  if (cards) return Promise.resolve(cards);
  if (!bulkEnabled() || !readMeta()?.count) return Promise.resolve(null);
  loading ||= (async () => {
    const db = await openDb();
    if (!db) return null;
    const chunks = await new Promise(res => {
      try {
        const r = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
        r.onsuccess = () => res(r.result || []);
        r.onerror = () => res([]);
      } catch { res([]); }
    });
    db.close();
    const list = chunks.flat();
    if (!list.length) return null;
    use(list);
    return cards;
  })();
  return loading;
}

// Turns the file off and frees the space
export async function removeBulk() {
  writeMeta({ on: false });
  cards = null; loading = null; byName = null; byId = null;
  const db = await openDb();
  if (!db) return;
  await new Promise(res => { try { const tx = db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).clear(); tx.oncomplete = tx.onerror = tx.onabort = () => res(); } catch { res(); } });
  db.close();
}

// At startup: when the file is on and the last check is a day old, fetch a newer file if Scryfall has one
export async function dailyBulk(onStatus) {
  const m = readMeta();
  if (!m?.on || Date.now() - (m.checked || m.at || 0) < DAY) return null;
  try {
    const r = await fetch('https://api.scryfall.com/bulk-data/oracle-cards', { headers: { Accept: 'application/json' } });
    const info = await r.json();
    writeMeta({ ...m, checked: Date.now() });
    if (info.updated_at && info.updated_at === m.updated && m.count) return null;
    return await downloadBulk(onStatus);
  } catch { return null; }
}

// A card by exact name (either face) or Scryfall id, from the file; null when it isn't there
export async function bulkCard(ident) {
  if (!(await loadBulk())) return null;
  if (ident.id) return byId.get(ident.id) || null;
  if (ident.name) return byName.get(ident.name.toLowerCase()) || null;
  return null;
}

// ---------- searches: the part of Scryfall's search syntax the game uses

class Unsupported extends Error {}
const no = what => { throw new Unsupported(what); };

// Tokens: "(", "-(", ")", key:value terms (value may be quoted), quoted or bare words, each maybe with "-"
function tokenize(q) {
  q = q.trim();
  const out = [];
  const re = /\s*(-?\(|\)|-?[a-z]+(?:<=|>=|!=|:|=|<|>)(?:"[^"]*"|[^\s()]+)|-?"[^"]*"|-?[^\s()"]+)/giy;
  let m;
  while (re.lastIndex < q.length && (m = re.exec(q))) out.push(m[1]);
  if (q.slice(re.lastIndex).trim()) no('syntax');
  return out;
}

// Parses into a predicate (card → boolean). Terms side by side must all match; "or" between them, either.
function parse(q) {
  const toks = tokenize(q);
  let i = 0;
  const isOr = t => t?.toLowerCase() === 'or';
  const orExpr = () => {
    const ors = [andExpr()];
    while (isOr(toks[i])) { i++; ors.push(andExpr()); }
    return ors.length === 1 ? ors[0] : c => ors.some(f => f(c));
  };
  const andExpr = () => {
    const ands = [];
    while (i < toks.length && toks[i] !== ')' && !isOr(toks[i])) ands.push(term());
    if (!ands.length) no('syntax');
    return c => ands.every(f => f(c));
  };
  const term = () => {
    const t = toks[i++];
    if (t === '(' || t === '-(') {
      const f = orExpr();
      if (toks[i++] !== ')') no('parentheses');
      return t === '(' ? f : c => !f(c);
    }
    if (t.startsWith('-') && t.length > 1) { const f = atom(t.slice(1)); return c => !f(c); }
    return atom(t);
  };
  if (!toks.length) return () => true;
  const top = orExpr();
  if (i < toks.length) no('syntax');
  return top;
}

const RAR = { common: 0, c: 0, uncommon: 1, u: 1, rare: 2, r: 2, special: 2.5, s: 2.5, mythic: 3, m: 3, bonus: 2.5, b: 2.5 };
const COLOR_WORDS = { white: 'w', blue: 'u', black: 'b', red: 'r', green: 'g', colorless: 'c' };
const text = c => [c.oracle_text, ...(c.card_faces || []).map(f => f.oracle_text)].filter(Boolean).join('\n').toLowerCase();
const types = c => (c.type_line || (c.card_faces || []).map(f => f.type_line).join(' // ')).toLowerCase();
const colorsOf = c => c.colors || [...new Set((c.card_faces || []).flatMap(f => f.colors || []))];
const cmp = (op, a, b) => op === ':' || op === '=' ? a === b : op === '!=' ? a !== b : op === '<' ? a < b : op === '<=' ? a <= b : op === '>' ? a > b : a >= b;
function colorSet(v) {
  v = COLOR_WORDS[v] || v;
  if (!/^[wubrgc]+$/.test(v)) no('colors');
  return v === 'c' ? new Set() : new Set(v.toUpperCase().split(''));
}
// Scryfall's set comparisons: ":" for identity means "within", for colors "includes"
function setCmp(op, have, want) {
  const sub = [...have].every(x => want.has(x)), sup = [...want].every(x => have.has(x));
  if (op === '<=') return sub;
  if (op === '>=' || op === ':') return sup;
  if (op === '=') return sub && sup;
  if (op === '<') return sub && have.size < want.size;
  if (op === '>') return sup && have.size > want.size;
  return !(sub && sup);
}
const canBeCommander = c => (/legendary/.test(types(c)) && /creature/.test(types(c).split(' // ')[0])) || /can be your commander/.test(text(c));

function atom(t) {
  const m = t.match(/^([a-z]+)(<=|>=|!=|:|=|<|>)(.+)$/i);
  if (!m) {
    if (/^!/.test(t)) no('exact name');
    const word = t.replace(/^"|"$/g, '').toLowerCase();
    return c => c.name.toLowerCase().includes(word);
  }
  const key = m[1].toLowerCase(), op = m[2];
  const val = m[3].replace(/^"|"$/g, '').toLowerCase();
  switch (key) {
    case 'legal': case 'f': case 'format':
      if (op !== ':' && op !== '=') no(key);
      return c => c.legalities?.[val] === 'legal';
    case 'game':
      return c => (c.games || []).includes(val);
    case 'is':
      if (val === 'commander') return canBeCommander;
      if (val === 'digital') return c => !!c.digital;
      if (val === 'gamechanger') return c => !!c.game_changer;
      if (val === 'reserved') return c => !!c.reserved;
      return no(`is:${val}`);
    case 't': case 'type':
      return c => types(c).includes(val);
    case 'o': case 'oracle':
      return c => text(c).includes(val);
    case 'id': case 'identity': case 'ci': {
      const want = colorSet(val);
      return c => setCmp(op === ':' ? '<=' : op, new Set(c.color_identity || []), want);
    }
    case 'c': case 'color': {
      const want = colorSet(val);
      return c => setCmp(op, new Set(colorsOf(c)), want);
    }
    case 'r': case 'rarity': {
      if (!(val in RAR)) no('rarity');
      return c => cmp(op, RAR[c.rarity] ?? 2.5, RAR[val]);
    }
    case 'cmc': case 'mv': case 'manavalue': {
      if (!/^\d+(\.\d+)?$/.test(val)) no('mana value');
      return c => cmp(op, c.cmc ?? 0, +val);
    }
    case 'produces': {
      const want = colorSet(val);
      const need = want.size ? [...want] : ['C'];
      return c => need.every(x => (c.produced_mana || []).includes(x));
    }
    default: return no(key);
  }
}

const ORDERS = {
  name: (a, b) => a.name.localeCompare(b.name),
  edhrec: (a, b) => (a.edhrec_rank ?? 1e9) - (b.edhrec_rank ?? 1e9) || a.name.localeCompare(b.name),
  cmc: (a, b) => (a.cmc ?? 0) - (b.cmc ?? 0) || a.name.localeCompare(b.name),
};

// Matching cards for a query over a card list (exported for the self-test)
export function searchCards(list, q, order = 'name') {
  const f = parse(q);
  const extras = /\bt(?:ype)?[:=]"?(plane|phenomenon|scheme|vanguard)/i.test(q);
  const sort = ORDERS[order] || no(`order ${order}`);
  return list.filter(c => (extras || !EXTRA_LAYOUTS.has(c.layout)) && f(c)).sort(sort);
}

// Answers a Scryfall API path from the file, like api.scryfall.com would; null to ask Scryfall instead
export async function bulkAnswer(path, rand = Math.random) {
  if (!/^\/cards\/(search|random)\?/.test(path) || !(await loadBulk())) return null;
  const url = new URL(path, 'https://api.scryfall.com');
  const p = url.searchParams;
  for (const k of p.keys()) if (!['q', 'order', 'page', 'unique', 'format'].includes(k)) return null;
  if (p.get('unique') && p.get('unique') !== 'cards') return null;
  const q = p.get('q') || '';
  let found;
  try { found = searchCards(cards, q, url.pathname === '/cards/random' ? 'name' : p.get('order') || 'name'); } catch (e) { if (e instanceof Unsupported) return null; throw e; }
  if (!found.length) throw new Error('No cards match that search (from the saved Scryfall card file).');
  if (url.pathname === '/cards/random') return found[Math.floor(rand() * found.length)];
  const page = Math.max(1, +(p.get('page') || 1));
  const data = found.slice((page - 1) * PAGE, page * PAGE);
  const more = page * PAGE < found.length;
  let next = null;
  if (more) { p.set('page', String(page + 1)); next = `https://api.scryfall.com${url.pathname}?${p}`; }
  return { object: 'list', total_cards: found.length, has_more: more, next_page: next, data, local: true };
}
