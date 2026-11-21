// Phase 2E card verification: one row per card of the Phase 2C list (197) and every other card a Phase 2E repair reached,
// with its classification at 1.61.0 (before Phase 2D), at 1.62.0 (after Phase 2D), the Phase 2C defect, the repair, the
// tests that name it, its classification now, and a verification status.
//   node audit/phase-2e/tools/verify.mjs <coverage now.json> <out.csv>
import { readFileSync, writeFileSync } from 'node:fs';
const [nowAt, out] = process.argv.slice(2);
const here = p => new URL(p, import.meta.url);
const { CARDS } = await import(here('../../phase-2c/probes/cards.mjs'));
const before = new Map(JSON.parse(readFileSync(here('../../phase-2d/tools/coverage-1.61.0.json'), 'utf8')).cards.map(c => [c.n, c]));
const now = new Map(JSON.parse(readFileSync(nowAt, 'utf8')).cards.map(c => [c.n, c]));
// (the classification after Phase 2D, from its impact table)
const d2 = new Map(readFileSync(here('../../phase-2d/PHASE_2D_CARD_IMPACT.csv'), 'utf8').replace(/^﻿/, '').trim().split(/\r\n/).slice(1)
  .map(l => l.slice(1, -1).split('","')).map(r => [r[1], { cls: r[6], mech: r[7] }]));
const known = JSON.parse(readFileSync(here('../../../tests/known-defects.json'), 'utf8'));
const src = f => readFileSync(here(`../../../tests/${f}`), 'utf8');
const T = { repairs: src('repairs.mjs'), mechanics: src('mechanics.mjs'), interactions: src('interactions.mjs') };
const named = (n, s) => s.includes(`'${n}'`) || s.includes(`"${n}"`) || s.includes(`'${n.split(' // ')[0]}'`) || s.includes(n.replace(/'/g, "\\'"));
// Phase 2E repairs: card → [increment and mechanic, repair]
const E = {
  'Quirion Ranger': ['2E-2 activation limits', '"Activate only once each turn" enforced (602.5b)'],
  'Beledros Witherbloom': ['2E-2 activation limits', '"Activate only once each turn" enforced'],
  'Wirewood Symbiote': ['2E-2 activation limits', '"Activate only once each turn" enforced'],
  'Ramos, Dragon Engine': ['2E-2 activation limits', '"Activate only once each turn" enforced'],
  'Chainer, Nightmare Adept': ['2E-2 activation limits', '"Activate only once each turn" enforced (with the 2D graveyard limit)'],
  'Steel Hellkite': ['2E-2 activation limits', 'limit enforced, but its {X} ability is still unread'],
  'Gilded Drake': ['2E-1 exchange of control; 2E-3 "still resolves"', 'exchange (701.12); sacrifice only without an exchange; resolves with an illegal target'],
  'Volatile Stormdrake': ['2E-1 exchange of control', 'exchange read (the energy part is not)'],
  'Combustible Gearhulk': ['2E-1 punisher choice', 'the target opponent chooses draw or mill-and-damage'],
  'Palantír of Orthanc': ['2E-1 punisher choice', 'the target opponent chooses draw or mill-X-and-life-loss'],
  'Tataru Taru': ['2E-1 optional opponent draw', 'the target opponent draws (not you twice)'],
  "Chandra's Ignition": ['2E-1 targets', 'the creature is a target the caster chooses'],
  'Natural Order': ['2E-2 search words', 'finds only a green creature'],
  "Green Sun's Zenith": ['2E-2 search words', 'finds only a green creature'],
  "Summoner's Pact": ['2E-2 search words', 'finds only a green creature'],
  'Merchant Scroll': ['2E-2 search words', 'finds only a blue instant'],
  'Maelstrom of the Spirit Dragon': ['2E-2 search words', 'finds only a Dragon'],
  'Goblin Matron': ['2E-2 search words', 'finds only a Goblin'],
  'Stoneforge Mystic': ['2E-2 search words', 'finds only an Equipment'],
  'Open the Armory': ['2E-2 search words', 'finds only an Aura or Equipment'],
  'Unmarked Grave': ['2E-2 search words', 'finds only a nonlegendary card'],
  'Mnemonic Betrayal': ['2E-2 mana of any type', 'opponents\' spells cast with any mana'],
  'Artifact Mutation': ['2E-2 non-legendary names', 'destroys the artifact (second reading)'],
  'Spell Swindle': ['2E-2 non-legendary names', 'counters the spell (second reading)'],
  "Urza's Tower": ['2E-2 non-legendary names', 'own name no longer replaced; Tron bonus still unread'],
  "Urza's Mine": ['2E-2 non-legendary names', 'own name no longer replaced; Tron bonus still unread'],
  'Eldrazi Temple': ['2E-2 non-legendary names', 'own name no longer replaced; the {C}{C} line still unread'],
  'Delay': ['2E-3 counterspell riders', 'countered spell exiled with time counters and suspended'],
  'Render Silent': ['2E-3 counterspell riders', "the countered spell's controller can't cast spells this turn"],
  'Court of Vantress': ['2E-3 copy of a chosen target', 'copies the chosen enchantment or artifact'],
  'Yenna, Redtooth Regent': ['2E-3 copy of a chosen target', 'copies an enchantment you control'],
  'Charming Scoundrel': ['2E-3 mode text', 'the first mode discards then draws'],
  "Kozilek's Command": ['2E-3 token abilities in quotes', 'mode 1 makes X Eldrazi Spawn with their mana ability'],
  'Awakening Zone': ['2E-3 token abilities in quotes', 'the Spawn has the mana ability; the source adds none'],
  'Pawn of Ulamog': ['2E-3 token abilities in quotes', 'the Spawn has the mana ability; the source adds none'],
  'Delina, Wild Mage': ['2E-4 end of combat; roll again', 'tapped attacking non-legendary copies exiled at end of combat; reroll on 15-20'],
  'Not Dead After All': ['2E-4 granted dies trigger', 'returns tapped when it dies this turn'],
  'Undying Malice': ['2E-4 granted dies trigger', 'returns tapped with a +1/+1 counter'],
  'Feign Death': ['2E-4 granted dies trigger', 'returns tapped with a +1/+1 counter'],
  'Terastodon': ['2E-5 "for each … this way" tokens', 'destroys up to three noncreature permanents; Elephants for their controllers'],
  'The Eternal Wanderer': ['2E-7 attack limits', 'only one creature can attack it each combat'],
  'Rite of the Raging Storm': ['2E-7 attack limits', 'Lightning Ragers can\'t attack you (with the 2D token fix)'],
};
const defect = new Map(CARDS.map(c => [c[0], { st: c[1], sev: c[4], act: c[7], rc: c[5] }]));
const names = [...new Set([...CARDS.map(c => c[0]), ...Object.keys(E)])].filter(n => before.has(n) || now.has(n));
const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
const rows = [['Rank', 'Card', 'In Phase 2C list', 'Phase 2C finding', 'Severity', 'Defect (Phase 2C)', 'Class at 1.61.0', 'Class at 1.62.0 (after 2D)', 'Repair (2D / 2E)', 'Relevant mechanic', 'Tests naming it', 'Class now (1.63.0)', 'Coverage reason now', 'Verification status'].map(q).join(',')];
const counts = {};
for (const n of names.sort((a, b) => (before.get(a)?.r ?? 9999) - (before.get(b)?.r ?? 9999))) {
  const b = before.get(n), c = now.get(n), d = defect.get(n), p = d2.get(n), e = E[n];
  const tests = Object.entries(T).filter(([, s]) => named(n, s)).map(([k]) => `tests/${k}.mjs`);
  const repair = [p?.mech ? `2D: ${p.mech}` : '', e ? `2E: ${e[1]}` : ''].filter(Boolean).join(' | ');
  const mech = e ? e[0] : p?.mech ? p.mech.split(';')[0] : (d ? `Phase 2C ${d.rc}` : '');
  const flagged = c && (c.s === 'incorrect' || c.s === 'restriction');
  let status;
  if (d?.st === 'FP') status = 'Not a defect (Phase 2C false positive)';
  else if (known[n]) status = 'Unresolved: known defect remains';
  else if ((e || p?.mech) && tests.some(t => /repairs|mechanics/.test(t)) && !flagged) status = c?.s === 'full' ? 'Repaired and verified by test' : 'Repaired and verified by test; other text still unread (partial)';
  else if ((e || p?.mech) && tests.some(t => /repairs|mechanics/.test(t))) status = 'Repaired part verified by test; card still flagged for another defect';
  else if (e || p?.mech) status = flagged ? 'Shared mechanic applied, not individually tested; still flagged' : 'Shared mechanic applied, not individually tested';
  else status = flagged ? 'Unresolved: not addressed' : c?.s === 'partial' ? 'Unresolved: text not read (partial)' : 'Unresolved: not addressed';
  counts[status] = (counts[status] || 0) + 1;
  rows.push([b?.r ?? '', n, d ? 'yes' : 'no', d ? { C: 'Confirmed defect', I: 'Incomplete', S: 'Suspected', FP: 'False positive' }[d.st] : '', d?.sev || '', d?.act || '', b?.x || '', p?.cls || b?.x || '', repair, mech, tests.join(' '), c?.x || '', (c?.m || []).join(' / '), status].map(q).join(','));
}
writeFileSync(out, '﻿' + rows.join('\r\n') + '\r\n');
console.log(`${rows.length - 1} cards`);
console.log(JSON.stringify(counts, null, 1));
const in197 = names.filter(n => defect.has(n));
const cls = {}; for (const n of in197) { const x = now.get(n)?.x; cls[x] = (cls[x] || 0) + 1; }
console.log('197 by class now:', JSON.stringify(cls));
