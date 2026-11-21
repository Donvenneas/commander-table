import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const root = process.argv[2];
const { normalize } = await import(pathToFileURL(root + '/public/js/scryfall.js'));
const { cleanText } = await import(pathToFileURL(root + '/public/js/effects.js'));
const snap = JSON.parse(readFileSync(root + '/tests/cards-snapshot.json', 'utf8'));
const cov = JSON.parse(readFileSync(process.argv[3], 'utf8'));
const st = new Map(cov.cards.map(c => [c.n, c.s]));
const hits = { playTopNoLib: [], selfRemovalFromTokenText: [], condQ_nonResolving: [], xDynQ: [], keepManaUnread: [], copyOfItSelf: [] };
for (const raw of snap) {
  const c = normalize({ ...raw, legalities: raw.legalities || {}, image_uris: {} });
  const t = cleanText(c.text || '', c.frontName || c.name), fx = c.fx, j = JSON.stringify(fx, (k, v) => v instanceof Set ? [...v] : v);
  const tag = `${c.name} [${st.get(c.name)}]`;
  if (fx.playTop && !/top of your library/.test(t)) hits.playTopNoLib.push(tag);
  if ((/"k":"exileSelf"|"k":"sacSelf"/.test(j)) && /token[^.]*\. *(?:at end of combat, exile this token|sacrifice this token|at the beginning of the end step, sacrifice)|"at end of combat, exile this token|exile this token\.?"|sacrifice this token\."/.test(t) && !/sacrifice ~|exile ~/.test(t)) hits.selfRemovalFromTokenText.push(tag);
  if (/"selfReduce":\{[^}]*"cond":\{"c":"\?"(?![^}]*"r)/.test(j) || /"gyCastSelf":\{"cond":\{"c":"\?"(?![^}]*"r)/.test(j) || /"playTopCond":\{"c":"\?"/.test(j) || /"altManaCond":\{"c":"\?"/.test(j) || /"enterCond9?":\{"c":"\?"/.test(j)) hits.condQ_nonResolving.push(tag);
  if (/"xw":\{"dyn":"\?"\}/.test(j)) hits.xDynQ.push(tag);
  if (/you don't lose this mana as steps and phases end/.test(t)) hits.keepManaUnread.push(tag);
  if (/"k":"copyToken"[^}]*"of":"it"/.test(j)) hits.copyOfItSelf.push(tag);
}
for (const [k, v] of Object.entries(hits)) console.log(`\n${k} (${v.length}): ${v.join('; ')}`);
