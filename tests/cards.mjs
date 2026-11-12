// Golden card readings (item 172): the effects parser over a saved snapshot of the 3,500 most-played Commander cards.
// Each card's reading (what the simulator understands, the lines it doesn't read, its type) is compared with
// tests/card-readings.json, so a change to effects.js that changes how a card plays is seen, and is only accepted
// on purpose.
//   node tests/cards.mjs            compare (exit 1 when a reading changed)
//   node tests/cards.mjs --update   accept the current readings
//   node tests/cards.mjs --fetch    download a fresh snapshot from Scryfall (then run --update)
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { normalize } from '../public/js/scryfall.js';
import { describeFx, droppedSentences } from '../public/js/effects.js';

const SNAP = new URL('./cards-snapshot.json', import.meta.url), GOLD = new URL('./card-readings.json', import.meta.url);
const args = new Set(process.argv.slice(2));

// Only what normalize() reads
const keep = c => {
  const pick = (o, ks) => Object.fromEntries(ks.filter(k => o[k] !== undefined).map(k => [k, o[k]]));
  const base = pick(c, ['id', 'oracle_id', 'name', 'layout', 'mana_cost', 'cmc', 'type_line', 'oracle_text', 'power', 'toughness', 'loyalty', 'defense', 'colors', 'color_identity', 'keywords', 'produced_mana', 'game_changer', 'legalities', 'rarity']);
  if (c.card_faces) base.card_faces = c.card_faces.map(f => pick(f, ['name', 'mana_cost', 'type_line', 'oracle_text', 'colors', 'power', 'toughness', 'loyalty', 'defense']));
  return base;
};

if (args.has('--fetch')) {
  const out = [];
  let url = 'https://api.scryfall.com/cards/search?order=edhrec&q=' + encodeURIComponent('legal:commander game:paper');
  for (let page = 1; url && page <= 20; page++) {
    const r = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'CommanderTable-tests/1.0' } });
    if (!r.ok) throw new Error(`Scryfall answered ${r.status}`);
    const j = await r.json();
    out.push(...j.data.map(keep));
    url = j.has_more ? j.next_page : null;
    await new Promise(res => setTimeout(res, 150));
  }
  writeFileSync(SNAP, JSON.stringify(out) + '\n');
  console.log(`Snapshot: ${out.length} cards. Run node tests/cards.mjs --update to accept their readings.`);
  process.exit(0);
}

const cards = JSON.parse(readFileSync(SNAP, 'utf8'));
const reading = raw => {
  const c = normalize({ ...raw, legalities: raw.legalities || {}, image_uris: {} });
  const fx = c.fx || {};
  const types = Object.entries(fx.type || {}).filter(([, v]) => v).map(([k]) => k).join(' ');
  return [`type: ${types}`, ...describeFx(fx), ...(fx.unread || []).map(l => `not read: ${l}`),
    // (item 188: sentences skipped inside a line that was read)
    ...droppedSentences(c).map(l => `not read: ${l}`)].join('\n');
};
const now = Object.fromEntries(cards.map(c => [c.name, reading(c)]));

if (args.has('--update') || !existsSync(GOLD)) {
  writeFileSync(GOLD, JSON.stringify(now, null, 0).replace(/","/g, '",\n"') + '\n');
  console.log(`Card readings saved for ${cards.length} cards.`);
  process.exit(0);
}
const gold = JSON.parse(readFileSync(GOLD, 'utf8'));
const changed = Object.keys(now).filter(n => gold[n] !== undefined && gold[n] !== now[n]);
const added = Object.keys(now).filter(n => gold[n] === undefined);
const full = Object.values(now).filter(r => !/\nnot read: /.test(r)).length;
console.log(`Card readings: ${cards.length} cards, ${full} fully read (${((full / cards.length) * 100).toFixed(1)}%), ${changed.length} changed, ${added.length} new.`);
for (const n of changed.slice(0, 25)) {
  const a = new Set(gold[n].split('\n')), b = new Set(now[n].split('\n'));
  console.log(`\n${n}\n${[...a].filter(x => !b.has(x)).map(x => `  - ${x}`).join('\n')}\n${[...b].filter(x => !a.has(x)).map(x => `  + ${x}`).join('\n')}`);
}
if (changed.length > 25) console.log(`\n…and ${changed.length - 25} more.`);
if (changed.length || added.length) { console.log('\nIf these changes are intended, run: node tests/cards.mjs --update'); process.exit(1); }
