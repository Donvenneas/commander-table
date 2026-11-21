// Prints a card's reading at the current rules (card.v26 where there is one): its non-empty fields, unread lines and
// dropped sentences.   node audit/phase-2f/tools/fx.mjs [--rules N] "Card Name" ["Another Card"]
import { card } from '../../../tests/scenario.mjs';
import { droppedSentences } from '../../../public/js/effects.js';
const J = v => JSON.stringify(v, (k, x) => (x instanceof Set ? [...x] : x));
for (const n of process.argv.slice(2)) {
  const c0 = card(n), c = c0.v26 || c0;
  console.log(`== ${c.name}\n${c.text}`);
  for (const [k, v] of Object.entries(c.fx)) {
    if (k === 'type' || v == null || v === false || v === 0 || (Array.isArray(v) && !v.length) || (v instanceof Set && !v.size) || (typeof v === 'object' && !Array.isArray(v) && !(v instanceof Set) && !Object.keys(v).length)) continue;
    console.log(`  ${k}: ${J(v)}`);
  }
  console.log('  -- dropped:', J(droppedSentences(c)));
}
