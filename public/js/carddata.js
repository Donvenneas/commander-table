// Card data checks (Phase 2N, item 384): Scryfall's answers are treated as untrusted input. Every card that comes from
// Scryfall (an API answer, the bulk card file, the browser's card database) is checked here before the game keeps or
// uses it. A record that fails is reported and left out, never "repaired" into a card that only looks valid.
//
// Five things are kept apart (see tests/phase-2n-report.md):
//   oracle identity   oracle_id: the card as a rule object, the same for every printing
//   printing          id (Scryfall id), set + collector number: one printed version, with its own pictures
//   card definition   scryfall.js normalize(): what the game reads from one printing (name, cost, text, faces, fx)
//   card face         card_faces[i]; normalize() builds backCard / altFace / frontHalf from them
//   game instance     Game.mk(): an object with its own iid; two copies of one definition are two instances
// This module only reads data: it never changes a card and holds no state.

/** Version of the card record layout the game keeps (cardcache.js records, bulk.js meta). Raise it when the fields
 * kept change; records from an older layout are still read (they are raw Scryfall data) and refreshed when online. */
export const CARD_SCHEMA = 2;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COLORS = new Set(['W', 'U', 'B', 'R', 'G']);
const MANA = new Set(['W', 'U', 'B', 'R', 'G', 'C']);
const MULTI = new Set(['split', 'flip', 'transform', 'modal_dfc', 'adventure', 'double_faced_token', 'reversible_card', 'art_series', 'prepare']);
// (meld cards have no card_faces: the melded card is a separate card in all_parts)

// How far the game supports each layout. "data" means the faces are kept; "play" what the engine does with them.
export const LAYOUT_SUPPORT = {
  normal: { faces: 1, play: 'full' },
  saga: { faces: 1, play: 'full' }, class: { faces: 1, play: 'full' }, case: { faces: 1, play: 'partial' },
  leveler: { faces: 1, play: 'partial' }, mutate: { faces: 1, play: 'partial' }, prototype: { faces: 1, play: 'partial' },
  host: { faces: 1, play: 'none' }, augment: { faces: 1, play: 'none' },
  transform: { faces: 2, play: 'full' }, modal_dfc: { faces: 2, play: 'full' }, split: { faces: 2, play: 'full' },
  adventure: { faces: 2, play: 'full' }, flip: { faces: 2, play: 'partial' },
  // (the faces are read, but nothing in the engine casts the second half or melds: Game.flipFace looks for backCard only)
  prepare: { faces: 2, play: 'partial' }, meld: { faces: 1, play: 'none' },
  // (two unrelated cards on one piece of cardboard: kept as data, played as its first face only, and its mana value
  // is missing at the top level on Scryfall, which check() reports)
  reversible_card: { faces: 2, play: 'none' },
  token: { faces: 1, play: 'full' }, double_faced_token: { faces: 2, play: 'partial' }, emblem: { faces: 1, play: 'partial' },
  planar: { faces: 1, play: 'partial' }, scheme: { faces: 1, play: 'partial' }, vanguard: { faces: 1, play: 'none' },
  art_series: { faces: 2, play: 'none' },
};
export const layoutSupport = layout => LAYOUT_SUPPORT[layout] || { faces: 1, play: 'unknown' };

// A picture address the game will load: https on Scryfall's own picture hosts only (or the local server's picture
// cache in front of them). Anything else (javascript:, data:, other sites) is dropped and the card is shown in words.
export function safeImageUrl(u) {
  if (typeof u !== 'string' || u.length > 600) return undefined;
  if (/^\/api\/img\?u=/.test(u)) return safeImageUrl(decodeURIComponent(u.slice(11))) ? u : undefined;
  return /^https:\/\/(cards|svgs|c1|c2)\.scryfall\.io\/[\w\-./%?=&]+$/.test(u) ? u : undefined;
}

const isStr = v => typeof v === 'string';
const optStr = v => v === undefined || v === null || isStr(v);
const strList = (v, allowed) => Array.isArray(v) && v.every(x => isStr(x) && (!allowed || allowed.has(x)));

/**
 * Checks one raw Scryfall card. Returns the problems found (empty when the card can be used).
 * Problems are short English phrases; `fatal` ones mean the card must not be used or saved.
 * @returns {{ ok: boolean, fatal: string[], warn: string[] }}
 */
export function check(raw) {
  const fatal = [], warn = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, fatal: ['not a card object'], warn };
  if (raw.object !== undefined && raw.object !== 'card') fatal.push(`object is "${String(raw.object).slice(0, 20)}", not a card`);
  if (!isStr(raw.id) || !UUID.test(raw.id)) fatal.push('missing or invalid Scryfall id');
  if (raw.oracle_id !== undefined && !(isStr(raw.oracle_id) && UUID.test(raw.oracle_id))) warn.push('invalid oracle id');
  if (raw.oracle_id === undefined && raw.layout !== 'reversible_card') warn.push('no oracle id');
  if (!isStr(raw.name) || !raw.name.trim() || raw.name.length > 200) fatal.push('missing or invalid name');
  if (!optStr(raw.layout)) fatal.push('invalid layout');
  for (const k of ['mana_cost', 'type_line', 'oracle_text', 'power', 'toughness', 'loyalty', 'defense', 'set', 'collector_number', 'rarity'])
    if (!optStr(raw[k])) fatal.push(`${k} is not text`);
  if (isStr(raw.oracle_text) && raw.oracle_text.length > 5000) fatal.push('oracle text is too long');
  if (raw.cmc === undefined) { if (raw.layout !== 'reversible_card') warn.push('no mana value'); else warn.push('no mana value at the top level (reversible card)'); }
  else if (typeof raw.cmc !== 'number' || !Number.isFinite(raw.cmc) || raw.cmc < 0 || raw.cmc > 1000001) fatal.push('invalid mana value');
  if (raw.colors !== undefined && !strList(raw.colors, COLORS)) fatal.push('invalid colors');
  if (raw.color_identity !== undefined && !strList(raw.color_identity, COLORS)) fatal.push('invalid color identity');
  if (raw.color_identity === undefined) warn.push('no color identity');
  if (raw.keywords !== undefined && !strList(raw.keywords)) fatal.push('invalid keywords');
  if (raw.produced_mana !== undefined && !strList(raw.produced_mana, MANA)) warn.push('unusual produced mana');
  if (raw.legalities !== undefined && (typeof raw.legalities !== 'object' || raw.legalities === null || Object.values(raw.legalities).some(v => !isStr(v)))) fatal.push('invalid legalities');
  const imgs = [raw.image_uris, ...(Array.isArray(raw.card_faces) ? raw.card_faces.map(f => f?.image_uris) : [])].filter(Boolean);
  for (const u of imgs) for (const [k, v] of Object.entries(u)) if (v != null && !safeImageUrl(v)) { warn.push(`picture ${k} is not a Scryfall picture address`); break; }
  // Faces
  if (raw.card_faces !== undefined) {
    if (!Array.isArray(raw.card_faces) || !raw.card_faces.length) fatal.push('card_faces is not a list of faces');
    else raw.card_faces.forEach((f, i) => {
      if (!f || typeof f !== 'object') { fatal.push(`face ${i + 1} is not an object`); return; }
      if (!isStr(f.name) || !f.name.trim()) fatal.push(`face ${i + 1} has no name`);
      for (const k of ['mana_cost', 'type_line', 'oracle_text', 'power', 'toughness', 'loyalty', 'defense'])
        if (!optStr(f[k])) fatal.push(`face ${i + 1} ${k} is not text`);
      if (f.colors !== undefined && !strList(f.colors, COLORS)) fatal.push(`face ${i + 1} has invalid colors`);
    });
  }
  const support = LAYOUT_SUPPORT[raw.layout];
  if (raw.layout && !support) warn.push(`layout "${raw.layout}" is not known to the game`);
  if (MULTI.has(raw.layout) && !(Array.isArray(raw.card_faces) && raw.card_faces.length >= 2)) fatal.push(`a ${raw.layout} card without its faces`);
  if (Array.isArray(raw.card_faces) && raw.card_faces.length >= 2 && raw.layout && !MULTI.has(raw.layout)) warn.push(`faces on a "${raw.layout}" card`);
  if (Array.isArray(raw.card_faces) && raw.card_faces.length >= 2 && isStr(raw.name) && raw.layout !== 'reversible_card' && raw.name.split(' // ').length !== raw.card_faces.length) warn.push('the name does not list every face');
  if (raw.layout !== 'reversible_card' && raw.type_line === undefined && !(raw.card_faces || []).some(f => f?.type_line)) fatal.push('no type line');
  return { ok: !fatal.length, fatal, warn };
}

/** True when a raw card may be used and saved */
export const usable = raw => check(raw).ok;

/**
 * Checks a whole list of raw cards (an API page, the bulk file, a database). Returns counts and the problems found.
 * @param {any[]} list
 * @param {{ uniqueOracle?: boolean }} [opts] uniqueOracle: the list should have one card per oracle id (Oracle Cards file)
 */
export function checkList(list, { uniqueOracle = false } = {}) {
  const out = { total: 0, valid: 0, invalid: 0, warned: 0, duplicateIds: 0, duplicateOracle: 0, multiFaced: 0, layouts: /** @type {Record<string, number>} */ ({}),
    problems: /** @type {Record<string, number>} */ ({}), examples: /** @type {string[]} */ ([]) };
  if (!Array.isArray(list)) { out.problems['not a list'] = 1; return out; }
  const ids = new Set(), oracles = new Set();
  for (const raw of list) {
    out.total++;
    const r = check(raw);
    if (r.ok) out.valid++; else { out.invalid++; if (out.examples.length < 10) out.examples.push(`${String(raw?.name ?? '?').slice(0, 60)}: ${r.fatal.join(', ')}`); }
    if (r.warn.length) out.warned++;
    for (const p of [...r.fatal, ...r.warn]) out.problems[p] = (out.problems[p] || 0) + 1;
    if (!raw || typeof raw !== 'object') continue;
    if (raw.id) { if (ids.has(raw.id)) out.duplicateIds++; ids.add(raw.id); }
    if (uniqueOracle && raw.oracle_id) { if (oracles.has(raw.oracle_id)) out.duplicateOracle++; oracles.add(raw.oracle_id); }
    const lay = String(raw.layout || 'normal');
    out.layouts[lay] = (out.layouts[lay] || 0) + 1;
    if (Array.isArray(raw.card_faces) && raw.card_faces.length > 1) out.multiFaced++;
  }
  return out;
}

/**
 * Whether a downloaded card list is good enough to replace the one in use (bulk.js). The old list stays when it isn't.
 * @returns {{ ok: boolean, reason?: string }}
 */
export function acceptList(report, { min = 10000, previous = 0 } = {}) {
  if (report.total < min) return { ok: false, reason: `the card file looks incomplete (${report.total} cards)` };
  if (report.invalid > report.total * 0.01) return { ok: false, reason: `${report.invalid} of ${report.total} cards in the file are damaged` };
  if (report.duplicateIds) return { ok: false, reason: `${report.duplicateIds} cards appear twice in the file` };
  if (report.duplicateOracle) return { ok: false, reason: `${report.duplicateOracle} cards appear twice under one oracle id` };
  // (a new file far smaller than the one in use is more likely a broken download than Scryfall dropping cards)
  if (previous && report.valid < previous * 0.9) return { ok: false, reason: `the new file has ${report.valid} cards, far fewer than the ${previous} in use` };
  return { ok: true };
}

/** The identity of a raw card: printing, oracle identity, face names (for indexes and saved decks) */
export function identity(raw) {
  return {
    id: raw.id, oracleId: raw.oracle_id || null, name: raw.name,
    faces: Array.isArray(raw.card_faces) ? raw.card_faces.map(f => f.name) : [raw.name],
    set: raw.set || null, cn: raw.collector_number || null, layout: raw.layout || 'normal',
  };
}

/** The lookup keys a raw card can be found by in the browser's card database, besides the one it was asked by */
export function aliasKeys(raw) {
  const keys = [JSON.stringify({ id: raw.id }), JSON.stringify({ name: raw.name })];
  const front = String(raw.name).split(' // ')[0];
  if (front !== raw.name) keys.push(JSON.stringify({ name: front }));
  if (raw.oracle_id) keys.push(JSON.stringify({ oracle_id: raw.oracle_id }));
  if (raw.set && raw.collector_number) keys.push(JSON.stringify({ set: raw.set, collector_number: raw.collector_number }));
  return keys;
}

/**
 * How complete a card's source data is, apart from how well the game plays it (coverage.mjs measures that).
 * @returns {{ ids: boolean, complete: boolean, faces: number, text: boolean, missing: string[] }}
 */
export function completeness(raw) {
  const missing = [];
  if (!raw.id) missing.push('id');
  if (!raw.oracle_id && raw.layout !== 'reversible_card') missing.push('oracle id');
  const faces = Array.isArray(raw.card_faces) ? raw.card_faces : [];
  const text = raw.oracle_text ?? faces.map(f => f.oracle_text).filter(v => v !== undefined).join('\n');
  if (raw.oracle_text === undefined && !faces.some(f => f.oracle_text !== undefined)) missing.push('oracle text');
  if (raw.type_line === undefined && !faces.some(f => f.type_line)) missing.push('type line');
  if (raw.cmc === undefined) missing.push('mana value');
  if (raw.color_identity === undefined) missing.push('color identity');
  if (raw.legalities === undefined) missing.push('legalities');
  return { ids: !!raw.id && (!!raw.oracle_id || raw.layout === 'reversible_card'), complete: !missing.length, faces: Math.max(1, faces.length), text: !!String(text).trim(), missing };
}
