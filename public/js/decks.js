// Deck import: Archidekt, Moxfield, MTGGoldfish, TappedOut URLs or a pasted decklist.
import { fetchCollection, randomDeck, randomConstructed, randomVariant } from './scryfall.js';
import { formatOf, checkDeck, commanderOk } from './formats.js';
import { randomSealed } from './limited.js';
import { metaDeck, decklistByLink } from './cedhdata.js';
import { combosIn } from './combos.js';

async function proxied(url, as = 'json') {
  const r = await fetch('/api/fetch?url=' + encodeURIComponent(url));
  if (!r.ok) {
    const err = new Error(`HTTP ${r.status}`);
    err.status = r.status;
    throw err;
  }
  return as === 'json' ? r.json() : r.text();
}

const BLOCKED_HELP = site =>
  `${site} blocks automated downloads. Open the deck on ${site}, use its Export / "Copy as plain text" option, and paste the list here instead.`;

function parseArchidekt(j) {
  const excluded = new Set((j.categories || []).filter(c => c.includedInDeck === false).map(c => c.name));
  const entries = [];
  for (const c of j.cards || []) {
    const cats = c.categories || [];
    const commander = cats.includes('Commander');
    const side = cats.some(x => /^sideboard$/i.test(x));
    if (cats.some(x => /^maybeboard$/i.test(x))) continue;
    if (!commander && !side && cats.some(x => excluded.has(x))) continue;
    const name = c.card?.oracleCard?.name;
    entries.push({ qty: c.quantity || 1, commander, side, name, ident: c.card?.uid ? { id: c.card.uid } : { name } });
  }
  return { deckName: j.name, entries };
}

function parseMoxfield(j) {
  const boards = j.boards || { mainboard: { cards: j.mainboard }, commanders: { cards: j.commanders } };
  const entries = [];
  const add = (board, commander, side = false) => {
    for (const x of Object.values(board?.cards || {})) {
      const c = x.card || {};
      entries.push({ qty: x.quantity || 1, commander, side, name: c.name, ident: c.scryfall_id ? { id: c.scryfall_id } : { name: c.name } });
    }
  };
  add(boards.commanders, true);
  add(boards.mainboard, false);
  add(boards.sideboard || (j.sideboard ? { cards: j.sideboard } : null), false, true);
  return { deckName: j.name, entries };
}

const SIDE_SECTIONS = /^(sideboard|side)\b/i;
const SKIP_SECTIONS = /^(maybeboard|maybe|considering|tokens?|companion)\b/i;
const CMD_SECTIONS = /^(commanders?|command zone)\b/i;
const MAIN_SECTIONS = /^(deck|main ?deck|mainboard|main|creatures?|lands?|spells?|artifacts?|enchantments?|instants?|sorcery|sorceries|planeswalkers?|other)\b/i;

// ManaBox (and other collection apps) CSV export: a header row naming the columns
function parseCsv(text) {
  const rows = text.split(/\r?\n/).filter(l => l.trim()).map(l => {
    const out = [];
    let cur = '', q = false;
    for (let i = 0; i < l.length; i++) {
      const ch = l[i];
      if (q) { if (ch === '"' && l[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
      else if (ch === '"') q = true; else if (ch === ',') { out.push(cur); cur = ''; } else cur += ch;
    }
    out.push(cur);
    return out.map(s => s.trim());
  });
  const head = rows.shift().map(h => h.toLowerCase());
  const col = (...names) => head.findIndex(h => names.includes(h));
  const iName = col('name', 'card name', 'card'), iQty = col('quantity', 'qty', 'count', 'amount');
  const iSet = col('set code', 'set', 'edition code'), iNum = col('collector number', 'collector_number', 'number', 'card number');
  const iBoard = col('board', 'section', 'category', 'binder name', 'list');
  const entries = [];
  for (const r of rows) {
    const name = r[iName];
    if (!name) continue;
    const board = (r[iBoard] || '').toLowerCase();
    if (/maybe|token/.test(board)) continue;
    const set = r[iSet], cn = r[iNum];
    entries.push({ qty: +r[iQty] || 1, commander: /commander/.test(board), side: /side/.test(board), name, ident: set && cn && /^[a-z0-9]{2,6}$/i.test(set) ? { set: set.toLowerCase(), collector_number: cn } : { name } });
  }
  return { deckName: null, entries };
}

// Pasted lists from Archidekt, Moxfield, MTGGoldfish, TappedOut, MTGO, MTG Arena, Deckstats, Aetherhub and
// ManaBox exports: "1 Name", "1x Name", "1 Name (SET) 123", section headings, "*CMDR*" or "# !Commander" marks.
// Sideboards are kept: a "Sideboard" heading, "SB: 1 Name", or (with commander: false, for 60-card
// formats) MTGO's trailing block after a blank line. commander: false also never marks a commander.
export function parseText(text, { commander: wantCommander = true } = {}) {
  const firstLine = text.trim().split(/\r?\n/)[0] || '';
  if (/(^|,)\s*"?name"?\s*(,|$)/i.test(firstLine) && /quantity|qty|count/i.test(firstLine)) {
    const csv = parseCsv(text.trim());
    if (!wantCommander) csv.entries.forEach(e => (e.commander = false));
    return csv;
  }
  const entries = [];
  let section = 'main';
  let deckName = null;
  const blocks = [[]];
  for (let raw of text.split(/\r?\n/)) {
    let line = raw.trim();
    if (!line) { if (blocks.at(-1).length) blocks.push([]); continue; }
    // MTG Arena: "About" / "Name My Deck" at the top
    if (/^about$/i.test(line)) { section = 'about'; continue; }
    if (section === 'about' && /^name\s+/i.test(line)) { deckName = line.replace(/^name\s+/i, '').trim(); continue; }
    // Deckstats marks the commander with "# !Commander" after the card
    const deckstatsCmdr = /#\s*!commander/i.test(line);
    if (deckstatsCmdr) line = line.replace(/#.*$/, '').trim();
    if (line.startsWith('//') || line.startsWith('#')) line = line.replace(/^\/\/\s*|^#\s*/, '');
    // MTGO / Cockatrice: "SB: 2 Duress"
    let sbLine = false;
    if (/^sb:\s*/i.test(line)) { sbLine = true; line = line.replace(/^sb:\s*/i, ''); }
    const header = line.replace(/[:\s(\d)]+$/, '');
    if (!/^\d/.test(line)) {
      if (CMD_SECTIONS.test(header)) section = 'commander';
      else if (SIDE_SECTIONS.test(header)) section = 'side';
      else if (SKIP_SECTIONS.test(header)) section = 'skip';
      else if (MAIN_SECTIONS.test(header)) section = 'main';
      continue;
    }
    if (section === 'skip') continue;
    const m = line.match(/^(\d+)\s*x?\s+(.+)$/i);
    if (!m) continue;
    let rest = m[2];
    let commander = section === 'commander' || deckstatsCmdr;
    if (/\*CMDR\*|\[[^\]]*commander[^\]]*\]/i.test(rest)) commander = true;
    rest = rest.replace(/\[[^\]]*\]/g, '').replace(/\^[^^]*\^/g, '').replace(/\*[A-Z]+\*/g, '').replace(/#\S+/g, '').trim();
    let ident;
    const sm = rest.match(/^(.+?)\s+\(([A-Za-z0-9]{2,6})\)\s*([\w★\-]+)?\s*$/);
    let name = sm ? sm[1] : rest;
    name = name.replace(/\s+\/\s+/, ' // ').trim();
    if (sm && sm[3]) ident = { set: sm[2].toLowerCase(), collector_number: sm[3] };
    else ident = { name };
    const side = sbLine || section === 'side';
    if (side) commander = false;
    const entry = { qty: +m[1], commander, side, name, ident };
    entries.push(entry);
    if (!side) blocks.at(-1).push(entry);
  }
  if (!wantCommander) {
    // MTGO/Goldfish 60-card lists: the sideboard is the trailing block after a blank line
    const real = blocks.filter(b => b.length);
    if (real.length >= 2 && !entries.some(e => e.side)) {
      const last = real.at(-1);
      const n = last.reduce((a, e) => a + e.qty, 0);
      const rest = real.slice(0, -1).flat().reduce((a, e) => a + e.qty, 0);
      if (n <= 15 && rest >= 40) last.forEach(e => (e.side = true));
    }
    entries.forEach(e => (e.commander = false));
  }
  // MTGO/Goldfish style: commander listed alone in a trailing (or leading) block
  else if (!entries.some(e => e.commander)) {
    const real = blocks.filter(b => b.length);
    if (real.length >= 2) {
      const last = real.at(-1), first = real[0];
      if (last.length <= 2) last.forEach(e => (e.commander = true));
      else if (first.length <= 2) first.forEach(e => (e.commander = true));
    }
  }
  return { deckName, entries };
}

async function resolve(parsed, onStatus, format = 'commander') {
  const f = formatOf(format);
  const { entries } = parsed;
  if (!entries.length) throw new Error('No cards found in that deck.');
  onStatus?.(`Fetching ${entries.length} cards from Scryfall…`);
  let { cards, missing, key } = await fetchCollection(entries.map(e => e.ident), (a, b) => onStatus?.(`Fetching card data ${a}/${b}…`));
  // Retry printings Scryfall didn't know by name only
  // (and double-faced cards written "Front // Back" by their front face, which Scryfall finds reliably)
  const retryName = e => (e.ident.name || e.name || '').split(' // ')[0];
  // (and a set + collector number that points at a different card, as old or app-specific exports can)
  const norm = n => (n || '').toLowerCase().split(' // ')[0].trim();
  const wrongPrint = e => e.ident.set && e.name && cards.has(key(e.ident)) && norm(cards.get(key(e.ident)).name) !== norm(e.name);
  const retry = entries.filter(e => (!cards.has(key(e.ident)) || wrongPrint(e)) && (e.name || e.ident.name) && (!e.ident.name || e.ident.name.includes(' // ')));
  if (retry.length) {
    const second = await fetchCollection(retry.map(e => ({ name: retryName(e) })));
    for (const e of retry) {
      const c = second.cards.get(second.key({ name: retryName(e) }));
      if (c) { e.ident = { name: retryName(e) }; cards.set(key(e.ident), c); }
    }
  }
  const warnings = [];
  let commanders = [];
  const main = [], sideboard = [];
  for (const e of entries) {
    const card = cards.get(key(e.ident));
    if (!card) { warnings.push(`Not found on Scryfall: ${e.name || JSON.stringify(e.ident)}`); continue; }
    if (e.side) { if (f.sideboard) sideboard.push({ card, qty: e.qty }); }
    else if (e.commander && f.commander) commanders.push(card);
    else main.push({ card, qty: e.qty });
  }
  if (!f.commander) {
    const deck = { deckName: parsed.deckName || `Imported ${f.name} deck`, commanders: [], cards: main, sideboard, warnings, format };
    warnings.push(...checkDeck(deck, format));
    return deck;
  }
  // No commander marked (or, in Oathbreaker, no planeswalker): guess the format's kind of commander
  if (!commanders.some(c => commanderOk(c, format))) {
    const cands = main.filter(({ card }) => commanderOk(card, format));
    cands.sort((a, b) => b.card.colorIdentity.length - a.card.colorIdentity.length);
    if (!cands.length) throw new Error(`Could not tell which card is the ${f.signature ? 'oathbreaker' : 'commander'}. Put it under a "Commander" heading.`);
    const pick = cands[0];
    commanders = [pick.card, ...commanders];
    if (--pick.qty <= 0) main.splice(main.indexOf(pick), 1);
    warnings.push(`No ${f.signature ? 'oathbreaker' : 'commander'} marked; guessed ${pick.card.name}.`);
  }
  const deck = { deckName: parsed.deckName || `${commanders.map(c => c.name).join(' & ')}`, commanders, cards: main, sideboard: [], warnings, format };
  warnings.push(...checkDeck(deck, format));
  return deck;
}

// bracket (1–5) only shapes generated decks: an empty seat or "random". Bracket 5 means a real
// tournament list from EDHTop16; 1–4 build from Scryfall's EDHREC rankings within that bracket's limits.
export async function loadDeck(source, onStatus, { bracket = null, budget = 'any', format = 'commander' } = {}) {
  const f = formatOf(format);
  const s = source.trim();
  // A manual table takes any deck: a Commander list if it has a commander, otherwise as a 60-card list
  if (f.anyDeck) {
    if (!s || /^random$/i.test(s)) return { ...(await randomDeck(onStatus, null, { combosIn })), format };
    try { return await loadDeck(s, onStatus, { bracket, budget, format: 'commander' }).then(d => ({ ...d, format, warnings: [] })); }
    catch (e) { if (!/commander/i.test(e.message)) throw e; return loadConstructed(s, onStatus, 'limited').then(d => ({ ...d, format, warnings: [] })); }
  }
  if (!f.commander) return loadConstructed(s, onStatus, format);
  // Brawl, Pauper Commander, Oathbreaker: random decks for the variant (no brackets or EDHTop16 lists).
  // (Kingdoms decks are plain Commander decks.)
  if (format !== 'commander' && !f.roles) {
    if (!s || s.toLowerCase() === 'random') return { ...(await randomVariant(onStatus, format, { combosIn })), format };
    if (/^(edhtop16|cedh)$|^edhtop16:|edhtop16\.com|topdeck\.gg/i.test(s)) throw new Error(`EDHTop16 decks are Commander decks. Switch the format to Commander to use them.`);
  }
  if (!s || s.toLowerCase() === 'random') return bracket === 5 ? fromEdhtop16(null, onStatus) : randomDeck(onStatus, bracket, { combosIn, budget });
  let m;
  // cEDH: "edhtop16" or "cedh" (a random meta deck), "edhtop16:Commander Name", or an EDHTop16 / TopDeck.gg decklist link
  if (/^(edhtop16|cedh)$/i.test(s)) return fromEdhtop16(null, onStatus);
  if ((m = s.match(/^edhtop16:\s*(.+)$/i))) return fromEdhtop16(m[1].trim(), onStatus);
  if ((m = s.match(/(?:edhtop16\.com\/tournament|topdeck\.gg\/deck)\/([\w-]+)\/(?:decklist\/)?([\w-]+)/i))) {
    onStatus?.('Downloading the tournament decklist from EDHTop16…');
    const { text, name } = await decklistByLink(m[1], m[2]);
    return { ...(await resolve(parseText(text), onStatus)), deckName: name, source: 'edhtop16' };
  }
  if ((m = s.match(/edhtop16\.com\/commander\/([^/?#]+)/i))) return fromEdhtop16(decodeURIComponent(m[1]), onStatus);
  if ((m = s.match(/archidekt\.com\/(?:api\/)?decks\/(\d+)/i))) {
    onStatus?.('Downloading from Archidekt…');
    return resolve(parseArchidekt(await proxied(`https://archidekt.com/api/decks/${m[1]}/`)), onStatus, format);
  }
  if ((m = s.match(/moxfield\.com\/decks\/([\w-]+)/i))) {
    onStatus?.('Downloading from Moxfield…');
    let j;
    try { j = await proxied(`https://api2.moxfield.com/v3/decks/all/${m[1]}`); }
    catch (e) { throw new Error(e.status === 404 ? 'Moxfield says that deck does not exist or is private.' : BLOCKED_HELP('Moxfield')); }
    return resolve(parseMoxfield(j), onStatus, format);
  }
  if ((m = s.match(/mtggoldfish\.com\/deck\/(?:visual\/|arena_download\/|download\/)?(\d+)/i))) {
    onStatus?.('Downloading from MTGGoldfish…');
    const parsed = parseText(await proxied(`https://www.mtggoldfish.com/deck/download/${m[1]}`, 'text'));
    return resolve(parsed, onStatus, format);
  }
  if ((m = s.match(/tappedout\.net\/mtg-decks\/([\w-]+)/i))) {
    onStatus?.('Downloading from TappedOut…');
    let text;
    try { text = await proxied(`https://tappedout.net/mtg-decks/${m[1]}/?fmt=txt`, 'text'); }
    catch { throw new Error(BLOCKED_HELP('TappedOut')); }
    if (/<html/i.test(text)) throw new Error(BLOCKED_HELP('TappedOut'));
    return resolve(parseText(text), onStatus, format);
  }
  // Sites that block programs with a bot check: their own export, pasted here, works instead
  if (/deckstats\.net/i.test(s)) throw new Error('Deckstats blocks automated downloads. On the deck page choose Export → "Text (.txt)" (or copy the list), and paste it here.');
  if (/aetherhub\.com/i.test(s)) throw new Error('Aetherhub blocks automated downloads. On the deck page use Export → "MTGA" or "MTGO", and paste the list here.');
  if (/manabox\.app/i.test(s)) throw new Error('ManaBox links can\'t be read directly. In the app, share the deck as text (or export a CSV), and paste it here.');
  if (/^https?:\/\//i.test(s)) throw new Error('Unsupported site. Use Archidekt, Moxfield, MTGGoldfish, TappedOut or EDHTop16, or paste a decklist.');
  return resolve(parseText(s), onStatus, format);
}

// Decks for a format without a commander (Standard, Modern, Pauper…): the same sites and pasted lists,
// sideboards kept, and random decks built for the format
async function loadConstructed(s, onStatus, format) {
  const f = formatOf(format);
  const text = parsed => resolve(parsed, onStatus, format);
  const paste = t => parseText(t, { commander: false });
  if (!s || s.toLowerCase() === 'random') {
    // Limited: a sealed pool from a recent set, built into a 40-card deck (the rest is the sideboard)
    if (!f.legal) return { ...(await randomSealed(onStatus)), format };
    return { ...(await randomConstructed(onStatus, f)), format };
  }
  if (/edhtop16|topdeck\.gg|^cedh$/i.test(s)) throw new Error(`EDHTop16 decks are Commander decks. Switch the format to Commander to use them.`);
  let m;
  if ((m = s.match(/archidekt\.com\/(?:api\/)?decks\/(\d+)/i))) {
    onStatus?.('Downloading from Archidekt…');
    const parsed = parseArchidekt(await proxied(`https://archidekt.com/api/decks/${m[1]}/`));
    parsed.entries.forEach(e => (e.commander = false));
    return text(parsed);
  }
  if ((m = s.match(/moxfield\.com\/decks\/([\w-]+)/i))) {
    onStatus?.('Downloading from Moxfield…');
    let j;
    try { j = await proxied(`https://api2.moxfield.com/v3/decks/all/${m[1]}`); }
    catch (e) { throw new Error(e.status === 404 ? 'Moxfield says that deck does not exist or is private.' : BLOCKED_HELP('Moxfield')); }
    const parsed = parseMoxfield(j);
    parsed.entries.forEach(e => (e.commander = false));
    return text(parsed);
  }
  if ((m = s.match(/mtggoldfish\.com\/deck\/(?:visual\/|arena_download\/|download\/)?(\d+)/i))) {
    onStatus?.('Downloading from MTGGoldfish…');
    return text(paste(await proxied(`https://www.mtggoldfish.com/deck/download/${m[1]}`, 'text')));
  }
  if ((m = s.match(/tappedout\.net\/mtg-decks\/([\w-]+)/i))) {
    onStatus?.('Downloading from TappedOut…');
    let t;
    try { t = await proxied(`https://tappedout.net/mtg-decks/${m[1]}/?fmt=txt`, 'text'); }
    catch { throw new Error(BLOCKED_HELP('TappedOut')); }
    if (/<html/i.test(t)) throw new Error(BLOCKED_HELP('TappedOut'));
    return text(paste(t));
  }
  if (/deckstats\.net|aetherhub\.com|manabox\.app/i.test(s)) throw new Error('That site blocks automated downloads. Use its export (text, MTGA or MTGO) and paste the list here.');
  if (/^https?:\/\//i.test(s)) throw new Error('Unsupported site. Use Archidekt, Moxfield, MTGGoldfish or TappedOut, or paste a decklist.');
  return text(paste(s));
}

// The newest top-16 tournament list for a commander (or a random top-meta commander)
async function fromEdhtop16(commander, onStatus) {
  const { text, name } = await metaDeck(commander, onStatus);
  return { ...(await resolve(parseText(text), onStatus)), deckName: name, source: 'edhtop16' };
}
