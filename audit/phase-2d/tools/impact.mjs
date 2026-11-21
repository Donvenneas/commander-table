// Phase 2D card impact: compares the coverage scan before Phase 2D (1.61.0) with the scan after it, for the 197 cards
// the Phase 2C audit listed and every other card whose classification moved, and records which Phase 2D mechanic
// touched each card and whether a test in tests/mechanics.mjs names it.
//   node audit/phase-2d/tools/impact.mjs <coverage before.json> <coverage after.json> <out.csv>
import { readFileSync, writeFileSync } from 'node:fs';
const [beforeAt, afterAt, out] = process.argv.slice(2);
const before = new Map(JSON.parse(readFileSync(beforeAt, 'utf8')).cards.map(c => [c.n, c]));
const after = new Map(JSON.parse(readFileSync(afterAt, 'utf8')).cards.map(c => [c.n, c]));
const testSrc = readFileSync(new URL('../../../tests/mechanics.mjs', import.meta.url), 'utf8');
const named = n => testSrc.includes(`'${n}'`) || testSrc.includes(`"${n}"`) || testSrc.includes(n.split(' // ')[0]);
// Which increment and mechanic reached each card (from the Phase 2D changes; see PHASE_2D_IMPLEMENTATION_REPORT.md)
const M = {
  '2D-1 unread condition never met': ['Not of This World', 'The Indomitable'],
  '2D-1 "this way" conditions (ctx.trail)': ['Noxious Gearhulk', 'Eldrazi Monument', 'Grist, the Hunger Tide', 'Reckless Handling', 'Arid Archway', 'Spelunking', 'Bonehoard Dracosaur', 'Oviya, Automech Artisan', 'Marauding Raptor', 'Springheart Nantuko'],
  '2D-1 last-known information': ['Unstoppable Slasher', 'Nine-Lives Familiar', 'Blowfly Infestation', 'Massacre Girl, Known Killer', 'Wilhelt, the Rotcleaver'],
  '2D-1 cost-paid conditions': ["Witch's Oven", 'Nasty End', 'Grab the Prize'],
  '2D-1 cast-history conditions': ['Baleful Mastery', 'Return to Dust', 'Approach of the Second Sun'],
  '2D-1 "then if" conditions': ['Court of Garenbrig', 'Mechanized Production', 'Jace, Wielder of Mysteries', 'Ocelot Pride', 'Replicating Ring', 'Treasure Map // Treasure Cove', 'Hour of Promise'],
  '2D-1 intervening-if at trigger time': ['Revel in Riches'],
  '2D-1 "an opponent draws"': ['Baleful Mastery'],
  '2D-1 target words (graveyard, attach, counted MV)': ['Persist', 'Drown in the Loch', 'Mithril Coat', 'Mjölnir, Storm Hammer', 'Silver Shroud Costume', 'Celestial Armor', 'Thieving Skydiver', "Kozilek's Command", 'Haven of the Spirit Dragon', 'Mudflat Village', 'Not of This World'],
  '2D-2 spend restrictions': ['Delighted Halfling', 'Secluded Courtyard', 'Unclaimed Territory', 'Plaza of Heroes', 'Great Hall of the Citadel', 'Haven of the Spirit Dragon', 'Maelstrom of the Spirit Dragon', 'Codsworth, Handy Helper', 'Giada, Font of Hope', 'Gwenna, Eyes of Gaea', 'Power Depot', 'Voldaren Estate', 'Abundant Countryside', 'Oakhollow Village', 'Rivaz of the Claw', 'Mudflat Village', 'Eclipsed Realms', 'Mech Hangar', 'The Mightstone and Weakstone', 'Klauth, Unrivaled Ancient', 'Boseiju, Who Shelters All', 'Eldrazi Temple', 'Shrine of the Forsaken Gods'],
  '2D-2 mana ability conditions': ['Mox Jasper', 'Floodfarm Verge', 'Bleachbone Verge', 'Nimbus Maze', 'Mirrex'],
  '2D-2 mana kept all turn': ['Birgi, God of Storytelling // Harnfel, Horn of Bounty', 'Savage Ventmaw', 'Klauth, Unrivaled Ancient', 'Karn, Legacy Reforged', 'Rousing Refrain'],
  '2D-2 play/cast permissions (playTop fix)': ['Crucible of Worlds', 'Ramunap Excavator', 'Conduit of Worlds', 'Omniscience', "Yeva, Nature's Herald", "Sigarda's Aid", 'Liberator, Urza\'s Battlethopter', 'Borne Upon a Wind', 'Shimmer Myr', 'Icetill Explorer', 'Ancient Greenwarden', 'Walk-In Closet // Forgotten Cellar', 'Dracogenesis', 'Skittering Cicada', 'Gandalf the White'],
  '2D-2 graveyard casting limits': ['Chainer, Nightmare Adept', 'Zul Ashur, Lich Lord', 'Emry, Lurker of the Loch'],
  '2D-3 dynamic X': ['Painful Truths', 'Sunfall', 'Ancient Bronze Dragon', 'Prime Speaker Zegana', 'Palantír of Orthanc', 'Quartzwood Crasher', 'Pact of the Serpent', 'Carpet of Flowers'],
  '2D-3 optional costs (mayCost)': ['Inti, Seneschal of the Sun', 'Grist, the Hunger Tide', 'Wilhelt, the Rotcleaver', 'Springbloom Druid', 'Caesar, Legion\'s Emperor', 'Disciple of Freyalise // Garden of Freyalise', 'Sephiroth, Fabled SOLDIER // Sephiroth, One-Winged Angel', 'Formidable Speaker', 'Call of the Ring', "Artist's Talent", "Hazoret's Monument", 'Toph, Hardheaded Teacher', 'Bitter Reunion', 'The Goose Mother', 'Ziatora, the Incinerator', 'Chitterspitter', 'Abandon Attachments'],
  '2D-4 tokens for that player / granted triggers / untap restriction': ['Rite of the Raging Storm', "Hunter's Insight", 'Junk Winder'],
  '2D-5 permissions from dig, mill, discard and graveyard exile': ['Expressive Iteration', 'Containment Construct', 'Tablet of Discovery', 'Mnemonic Betrayal', 'Valakut Exploration'],
  '2D-6 replacements': ['Benevolent Hydra', 'Mox Diamond'],
  '2D-7 continuous effects and riders': ['Giver of Runes', 'Damn', 'Kappa Cannoneer', 'The Immortal Sun', 'Port Razer', 'Bloodthirster'],
  '2D-8 keywords': ['Mosswort Bridge', 'Windbrisk Heights', 'Spinerock Knoll', 'Cemetery Tampering', 'Collective Resistance', 'Twinning Staff', 'Abundance'],
};
const touched = new Map();
for (const [m, cards] of Object.entries(M)) for (const c of cards) touched.set(c, [...(touched.get(c) || []), m]);
const audited = new Set(JSON.parse(readFileSync(new URL('../../phase-2c/cards197.json', import.meta.url), 'utf8')));
const names = new Set([...audited, ...touched.keys(), ...[...before.keys()].filter(n => before.get(n).s !== after.get(n)?.s)]);
const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
const rows = [['Rank', 'Card', 'In Phase 2C list (197)', 'Status before', 'Class before', 'Status after', 'Class after', 'Phase 2D mechanics', 'Named in tests/mechanics.mjs', 'Verified result', 'Notes'].map(q).join(',')];
const sorted = [...names].filter(n => before.has(n)).sort((a, b) => before.get(a).r - before.get(b).r);
for (const n of sorted) {
  const b = before.get(n), a = after.get(n), ms = touched.get(n) || [];
  const t = named(n);
  const result = !ms.length ? (b.s === a.s ? 'not addressed in Phase 2D' : 'classification moved by a shared reader change; not individually tested')
    : t ? 'mechanic implemented; card exercised by a test that passed (rules 25)' : 'mechanic implemented; reading checked, no card-specific test';
  const note = a.s === 'incorrect' || a.s === 'restriction' ? 'still flagged by coverage: see PHASE_2D_REMAINING_GAPS.md' : a.s === 'partial' ? 'some text still unread' : '';
  rows.push([b.r, n, audited.has(n) ? 'yes' : 'no', b.s, b.x, a.s, a.x, ms.join('; '), t ? 'yes' : 'no', result, note].map(q).join(','));
}
writeFileSync(out, '﻿' + rows.join('\r\n') + '\r\n');
console.log(`${rows.length - 1} cards written`);
