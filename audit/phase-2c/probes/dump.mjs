import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const root = process.argv[2], cov = process.argv[3], out = process.argv[4];
const { normalize } = await import(pathToFileURL(root + '/public/js/scryfall.js'));
const { droppedSentences, cleanText } = await import(pathToFileURL(root + '/public/js/effects.js'));
const snap = JSON.parse(readFileSync(root + '/tests/cards-snapshot.json', 'utf8'));
const c = JSON.parse(readFileSync(cov, 'utf8'));
const bad = c.cards.filter(x => x.s === 'incorrect' || x.s === 'restriction');
console.log('bad', bad.length, 'sample keys', JSON.stringify(c.cards[0]).slice(0, 400));
const res = [];
for (const b of bad) {
  const raw = snap.find(r => r.name === b.n);
  const card = normalize({ ...raw, legalities: raw.legalities || {}, image_uris: {} });
  const { type, ...fx } = card.fx;
  res.push({ rank: b.r, name: b.n, status: b.s, typeLine: card.typeLine, mana: raw.mana_cost || (raw.card_faces||[]).map(f=>f.mana_cost).join(' // '), oracle: card.text, cov: b, fx: JSON.stringify(fx, (k, v) => v instanceof Set ? [...v] : v), dropped: droppedSentences(card) });
}
writeFileSync(out, JSON.stringify(res, null, 1));
