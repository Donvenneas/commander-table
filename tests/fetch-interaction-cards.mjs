// Downloads card data for the interaction tests' cards that the snapshots don't have (tests/interaction-cards.json).
//   node tests/fetch-interaction-cards.mjs "Card A" "Card B" ...   (adds to the file)
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
const FILE = new URL('./interaction-cards.json', import.meta.url);
const out = existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : {};
const names = process.argv.slice(2).filter(n => !out[n.toLowerCase()]);
const keep = ['id', 'oracle_id', 'name', 'layout', 'mana_cost', 'cmc', 'type_line', 'oracle_text', 'power', 'toughness', 'loyalty', 'defense', 'colors', 'color_identity', 'keywords', 'produced_mana', 'game_changer', 'legalities', 'rarity'];
const pick = (o, ks) => Object.fromEntries(ks.filter(k => o[k] !== undefined).map(k => [k, o[k]]));
for (let i = 0; i < names.length; i += 75) {
  const r = await fetch('https://api.scryfall.com/cards/collection', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': 'CommanderTable-tests/1.0' },
    body: JSON.stringify({ identifiers: names.slice(i, i + 75).map(name => ({ name })) }),
  });
  if (!r.ok) throw new Error(`Scryfall answered ${r.status}`);
  const j = await r.json();
  for (const c of j.data || []) {
    const base = pick(c, keep);
    base.legalities = { commander: c.legalities?.commander };
    if (c.card_faces) base.card_faces = c.card_faces.map(f => pick(f, ['name', 'mana_cost', 'type_line', 'oracle_text', 'colors', 'power', 'toughness', 'loyalty', 'defense']));
    out[c.name.toLowerCase()] = base;
  }
  for (const nf of j.not_found || []) console.warn(`not found: ${nf.name}`);
  await new Promise(res => setTimeout(res, 120));
}
writeFileSync(FILE, JSON.stringify(out, null, 0).replace(/\},"/g, '},\n"') + '\n');
console.log(`Interaction cards: ${Object.keys(out).length} saved.`);
