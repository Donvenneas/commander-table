// Builds PHASE_2C_CARD_DEFECTS.csv and PHASE_2C_COMPLETE_AUDIT.md from the per-card findings (cards.mjs), the
// root causes below, the coverage dump (bad.json) and the runtime probe results.
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const [badPath, outDir] = process.argv.slice(2);
const { CARDS } = await import('./cards.mjs');
const bad = JSON.parse(readFileSync(badPath, 'utf8'));
const byName = new Map(bad.map(r => [r.name, r]));

export const RC = {
  RC01: { name: 'Unread "if" condition at resolution', files: 'effects.js; triggers.js; resolve.js', fn: 'effects.js parseCond (l.626, cond17 l.708) returns {c:"?"}; triggers.js evalCond case "?" (l.453) returns !ctx.resolving; resolve.js runEffects case "if" (l.943) forces the else branch or skips', ws: 'P0 Conditional evaluation and this-way dependencies', fix: 'Read the condition families into real conditions with event/result context ("this way", "the sacrificed creature", "mana spent", "it had counters"): record the previous effect\'s result on ctx (destroyed/milled/discarded/returned objects, mana-spent tags) and evaluate against it. Keep {c:"?"} only as a reported gap.' },
  RC02: { name: 'Unread condition outside resolution counts as met', files: 'triggers.js; mana.js', fn: 'triggers.js evalCond case "?" returns true when ctx.resolving is unset; called with {} by mana.js costOf selfReduce (l.607-610) and castModeRaw gyCastSelf (l.508)', ws: 'P0 Conditional evaluation', fix: 'From a new RULES version, an unread condition is false in every context (cost reductions, cast permissions, play-from-top conditions, enter conditions), and is reported once a game. Smallest fix: pass {resolving:true}-equivalent strictness from costOf/castModeRaw.' },
  RC03: { name: 'Spend restrictions on mana not modelled; extra mana lines merged', files: 'effects.js; mana.js', fn: 'effects.js mana-line reader (l.2060-2100) keeps only fx.mana.only creatureSpell/creatureAbility and cavern; the colors of every mana line are unioned into one fx.mana; mana.js spendOk (l.38) knows two restrictions', ws: 'P0 Mana restrictions costs and payment legality', fix: 'One fx.mana entry per mana ability (colors, amount, cost, condition, restriction). Generalise "only" into a predicate object {spell/ability, types, subtypes, legendary, chosenType, color, colorless} checked by spendOk against g.payingFor; carry riders (can\'t be countered) on the pool unit like Cavern.' },
  RC04: { name: 'Conditional or second mana abilities dropped or made unconditional', files: 'effects.js; mana.js', fn: 'effects.js mana lines: manaLines need only for MANA_COND words (l.48); "a Dragon", "entered this turn", "ferocious", "corrupted", "three lands with the same name", second {C}{C} lines are dropped while the color is still added', ws: 'P0 Mana restrictions', fix: 'Same per-ability mana model as RC03, with the activation condition parsed by parseCond (shared evaluator) instead of the MANA_COND word list; a mana ability whose condition can\'t be read is not offered.' },
  RC05: { name: 'Mana that persists through steps and phases', files: 'engine.js; resolve.js', fn: 'engine.js setPhase (l.319) empties every pool except keepRed', ws: 'P0 Mana restrictions', fix: 'Tag pool units with keepUntil (end of turn) when the effect says "you don\'t lose this mana"; setPhase keeps tagged units. Replaces the keepRed special case.' },
  RC06: { name: 'Target qualifiers not enforced (legendary, MV, attacking, dynamic limits)', files: 'effects.js; resolve.js; ai.js; human.js', fn: 'effects.js targetWords (l.1107) only runs for TARGETED kinds (l.1103): reanimate, counter, steal-with-MV, tutor, regrow get no e.tr; tr has no dynamic limits (X, graveyard size); resolve.js targetFits (l.155) / legalTargets (l.111)', ws: 'P0 Target legality ownership and target count', fix: 'Attach targetWords output to every targeted kind (graveyard and stack targets included); add dynamic bounds (mv:{max:{dyn}}) evaluated at cast and resolution; one predicate (targetLegal) used by the AI, the human menu and resolution.' },
  RC07: { name: 'Engine-chosen object replaces a printed target', files: 'resolve.js', fn: 'resolve.js attachSelf (l.1432 bestOwn), ignition (l.1569 bestOwnCreature), doubleCounters (l.1205 bestOwn), draw dyn maxPower', ws: 'P0 Target legality', fix: 'Give these kinds a real target (needsTarget + legalTargets entry), chosen while casting/putting the trigger on the stack and rechecked on resolution (608.2b).' },
  RC08: { name: 'Temporary cast/play permissions missing or too broad', files: 'resolve.js; mana.js; engine.js', fn: 'resolve.js dig/exileTrigCard/exileGy/mill create no mayPlay; gyCastTurn (l.1911) stores types only, so empty types = every nonland card, unlimited; mana.js castModeRaw (l.510)', ws: 'P0 Cast/play permissions and alternate zones', fix: 'One permission record {player, objects or filter, zones, until, count, free, anyMana, afterwards:"exile"} written by these effects and read by castModeRaw / land play; Chainer/Zul Ashur get types and a count; impulse-style effects reuse mayPlay.' },
  RC09: { name: '"X, where X is …" left as paid X (0)', files: 'effects.js; resolve.js', fn: 'effects.js xWhere reader (l.1047-1074) returns {dyn:"?"}; resolve.js X() reads it as 0; roll passes x only to its table rows', ws: 'P1 Dynamic X and computed values', fix: 'Add dyn readers for: colors spent (converge), creatures of the chosen type, counters on ~, damage dealt (trigger amount), creatures exiled this way, greatest power among others, die result; evaluate at resolution (or as it enters for "enters with").' },
  RC10: { name: 'Multiple / divided / "up to" targets', files: 'effects.js; resolve.js', fn: 'effects.js upTo splitter (l.1250-1265) only for MULTI kinds and not for divided/distributed amounts', ws: 'P0 Target legality (target count)', fix: 'A target list on the effect (min, max, distinct, divided amount) chosen once; resolution applies per legal target and divides amounts as chosen.' },
  RC11: { name: 'A player\'s choice is not asked (punishers, "may have you", optional costs)', files: 'effects.js; resolve.js; ai.js; human.js', fn: 'reader keeps one branch of "target opponent may have you draw…", "you may sacrifice…, if you do", "if you don\'t, put … into your hand"', ws: 'P0 Conditional evaluation (prior effect result)', fix: 'An "offer" effect: ask the named player (AI via a value function, person via human.js), record the answer on ctx, and branch on it with the RC01 result context.' },
  RC12: { name: 'Rider sentences dropped (restrictions and riders)', files: 'effects.js', fn: 'effects.js droppedSentences (l.2453): "can\'t be regenerated", "can\'t block", "doesn\'t untap", "can\'t cast spells", kicker riders, suspend riders', ws: 'P2 Continuous effects / P1 Turn and combat', fix: 'Read each rider into an existing engine flag (noRegen, noBlockTurn, skipUntap, silence, kicked branch, suspend) — most flags already exist for other cards.' },
  RC13: { name: 'Clause bound to the wrong object or read as the wrong effect', files: 'effects.js; resolve.js', fn: 'Token riders ("exile this token", "sacrifice this token") read as exileSelf/sacSelf of the source; copyToken "of it" falls back to src (resolve.js l.439-441); pumpTrig reads ctx.trig.o; conditions read as unconditional; modal text misread', ws: 'Not in Phase 2B (new: reader construction)', fix: 'Reader: rider clauses inside a quoted token ability belong to the token; "it"/"that creature" resolve to the target or trigger object, never to src by default; add MISREAD checks for each pattern so coverage finds them.' },
  RC14: { name: 'Static prohibitions and rule-changing statics not read', files: 'effects.js; engine.js; combat.js', fn: 'No reading for "players can\'t activate loyalty abilities", attack caps, "can\'t attack a player it already attacked", "ignore hexproof", graveyard-cast locks, untap locks', ws: 'P2 Continuous effects / P1 Turn and combat sequencing', fix: 'Add statics one family at a time with a check in the place the action is allowed (canActivate, attack legality, canTarget, castModeRaw, untap step).' },
  RC15: { name: 'Whole ability not read (incomplete implementation)', files: 'effects.js; tests/coverage.mjs', fn: 'effects.js parseCard leaves the line in fx.unread; coverage.mjs RESTRICTION (l.52) labels the card "restriction" (stronger) when the unread text merely contains "activate only"/"can\'t"', ws: 'P2 Special keyword mechanics (and per mechanic)', fix: 'Implement the ability, or report the card as partial. Fix the classifier: only count an unread line as a restriction when the rest of its ability IS read.' },
  RC16: { name: 'Replacement effects modelled as costs or not read', files: 'effects.js; replacements.js', fn: 'Mox Diamond read as addCost discard; +1 counter replacement and draw replacement unread', ws: 'P1 Replacement prevention and redirection', fix: 'Express them as replacements.js entries (enter replacement with a choice; counter-placing replacement; draw-from-empty replacement).' },
  RC17: { name: 'Protection read as hexproof', files: 'effects.js; engine.js', fn: 'effects.js protect reader turns "protection from colorless or the color of your choice" into kw hexproof; engine.js protectedFrom exists for printed protection', ws: 'P2 Continuous effects', fix: 'Grant a temporary protection quality (from a chosen color / colorless) read by Game.protectedFrom.' },
  RC18: { name: 'Random results and modal constraints', files: 'effects.js; resolve.js', fn: 'roll tables read partly; coin flips with outcomes; "each mode must target a different player"', ws: 'P2 Special keyword mechanics', fix: 'Roll/flip effects keep their result on ctx (x) for the whole ability; modal reader keeps per-mode target constraints.' },
  RC19: { name: 'Counter movement and named counters', files: 'effects.js; resolve.js; triggers.js', fn: 'No effect kind for moving counters between permanents; named counters partly modelled', ws: 'P1 Counter identity movement and state changes', fix: 'A moveCounters effect over the named-counter store, with the counter-placing replacement pipeline (RC16).' },
  RC20: { name: '"You may play lands / cast X spells" read as play from the top of the library', files: 'effects.js; mana.js; engine.js', fn: 'effects.js l.1605-1607: the "(?:from the top of your library)?" group is optional, so any "you may play lands …" / "you may cast … spells …" line sets seeTop + playTop; mana.js topPlayable (l.622); engine.js land play (l.886) has no graveyard path', ws: 'P0 Cast/play permissions (not listed in 2B)', fix: 'Make the library clause required; read "from your graveyard" (Crucible, Ramunap, Conduit) and "as though they had flash" (Yeva, Liberator, Sigarda\'s Aid) and "from your hand without paying" (Omniscience) separately. Affects 13 cards the coverage calls "full".' },
  RC21: { name: 'Coverage classification false positive', files: 'tests/coverage.mjs', fn: 'MISREAD regexes match words in the reading JSON (e.g. "play|until" for flash permission); RESTRICTION does not know engine.js abilityCost floors at one mana', ws: 'Audit tooling', fix: 'Adjust the checks: accept flashTurn for "as though they had flash"; skip "can\'t reduce … to less than one mana" (engine.js abilityCost already floors).' },
};
const STATUS = { C: 'Confirmed defect', I: 'Incomplete implementation', S: 'Suspected defect', U: 'Unable to verify', FP: 'Not a defect (classification false positive)' };
const CAT = { A: 'Incorrect effect recognition', B: 'Recognized but incorrectly constructed', C: 'Effect never executes', D: 'Incorrect effect resolution', E: 'Incorrect targeting or target legality', F: 'Incorrect mana or additional cost payment', G: 'Incorrect conditions or restrictions', H: 'Incorrect trigger timing or registration', I: 'Incorrect zone movement', J: 'Incorrect counters or token handling', K: 'Incorrect replacement or prevention', L: 'Incorrect continuous effects', M: 'Incorrect X-value or variable calculation', N: 'Incorrect ownership or controller handling', O: 'Incorrect stack behavior', P: 'Incorrect cleanup, expiration or delayed effects', Q: 'Incorrect interaction with another mechanic', R: 'Other' };
const SEV = { Critical: 0, High: 1, Medium: 2, Low: 3 };

// Cards sharing each root cause (for "affected cards")
const byRc = {};
for (const c of CARDS) for (const r of c[5].split(',')) (byRc[r] ||= []).push(c[0]);
const outside = { RC20: ['Crucible of Worlds', 'Ramunap Excavator', 'Omniscience', "Yeva, Nature's Herald", "Sigarda's Aid", 'Borne Upon a Wind', 'Shimmer Myr', 'Icetill Explorer', 'Ancient Greenwarden', 'Walk-In Closet // Forgotten Cellar', 'Dracogenesis', 'Skittering Cicada', 'Gandalf the White'], RC09: ['Well of Lost Dreams', 'Call the Coppercoats'] };

const rows = CARDS.map(([name, st, cats, dir, sev, rcs, exp, act, ev]) => {
  const b = byName.get(name);
  const rcl = rcs.split(',');
  const affected = [...new Set(rcl.flatMap(r => [...(byRc[r] || []), ...(outside[r] || [])]))].filter(n => n !== name);
  return { rank: b.rank, name, cls: b.status, flag: b.cov.m.join(' / '), oracle: b.oracle, st, cats, dir, sev, rcl, exp, act, ev, affected };
});
rows.sort((a, b) => a.rank - b.rank);

// ---------- CSV
const q = v => `"${String(v ?? '').replace(/"/g, '""').replace(/\r?\n/g, ' / ')}"`;
const head = ['Rank', 'Card', 'Coverage status', 'Coverage flag', 'Finding status', 'Severity', 'Direction vs printed', 'Failure categories', 'Primary mechanic', 'Root causes', 'Oracle text', 'Expected behavior', 'Actual behavior', 'Source files', 'Functions', 'Phase 2B workstream', 'Recommended fix', 'Verification', 'Other affected cards (same root cause)'];
const csv = [head.map(q).join(',')];
for (const r of rows) {
  const R = r.rcl.map(k => RC[k]);
  csv.push([r.rank, r.name, r.cls, r.flag, STATUS[r.st], r.sev, r.dir, r.cats.split(',').map(c => c === '-' ? '-' : `${c} ${CAT[c]}`).join('; '), RC[r.rcl[0]].name, r.rcl.map(k => `${k} ${RC[k].name}`).join('; '), r.oracle, r.exp, r.act, [...new Set(R.flatMap(x => x.files.split('; ')))].join('; '), R.map(x => x.fn).join(' || '), [...new Set(R.map(x => x.ws))].join('; '), R.map(x => x.fix).join(' || '), r.ev, r.affected.slice(0, 25).join('; ') + (r.affected.length > 25 ? ` (+${r.affected.length - 25} more)` : '')].map(q).join(','));
}
writeFileSync(`${outDir}/PHASE_2C_CARD_DEFECTS.csv`, '﻿' + csv.join('\r\n') + '\r\n');

// ---------- counts
const cnt = f => rows.filter(f).length;
const stats = {
  total: rows.length, C: cnt(r => r.st === 'C'), I: cnt(r => r.st === 'I'), S: cnt(r => r.st === 'S'), U: cnt(r => r.st === 'U'), FP: cnt(r => r.st === 'FP'),
  stronger: cnt(r => r.dir === 'stronger'), weaker: cnt(r => r.dir === 'weaker'), different: cnt(r => r.dir === 'different'),
  probe: cnt(r => /^P\d/.test(r.ev)), probeShared: cnt(r => /P\d\d/.test(r.ev) && !/^P\d/.test(r.ev)),
  sev: Object.fromEntries(Object.keys(SEV).map(s => [s, cnt(r => r.sev === s && r.st !== 'FP')])),
  incorrect: cnt(r => r.cls === 'incorrect'), restriction: cnt(r => r.cls === 'restriction'),
};
writeFileSync(`${outDir}/stats.json`, JSON.stringify({ stats, byRc: Object.fromEntries(Object.entries(byRc).map(([k, v]) => [k, v.length])) }, null, 1));

// ---------- complete audit (per card)
const md = [];
md.push('## Part 1 and 2: every card (197)', '',
  'Sorted by popularity rank (the # in the coverage snapshot). Each entry gives the coverage flag that put the card in this group, the Oracle text, what the rules say should happen, what the engine does, the failure classes (A-R), the root causes (RC01-RC21, explained in PHASE_2C_ROOT_CAUSE_ANALYSIS.md) and the evidence. "P" numbers are runtime probes run for this audit (listed in Part 3); "R" means the card reader\'s output (fx JSON) was inspected and the handler that would run was traced; "T" means a code trace only.', '');
for (const r of rows) {
  md.push(`### #${r.rank} ${r.name}`, '',
    `- **Finding:** ${STATUS[r.st]} · **Severity:** ${r.sev} · **Plays:** ${r.dir === 'none' ? 'as printed (for the flagged part)' : r.dir + ' than printed'.replace('different than printed', 'differently from printed')}`,
    `- **Coverage:** ${r.cls} — ${r.flag}`,
    `- **Oracle text:** ${r.oracle.replace(/\n/g, ' / ')}`,
    `- **Expected:** ${r.exp}`,
    `- **Actual:** ${r.act}`,
    `- **Failure classes:** ${r.cats === '-' ? 'none' : r.cats.split(',').map(c => `${c} (${CAT[c]})`).join(', ')}`,
    `- **Root cause:** ${r.rcl.map(k => `${k} ${RC[k].name}`).join('; ')}`,
    `- **Source:** ${r.rcl.map(k => RC[k].fn).join(' — ')}`,
    `- **Evidence:** ${r.ev}`,
    `- **Same root cause:** ${r.affected.length ? r.affected.slice(0, 12).join('; ') + (r.affected.length > 12 ? ` and ${r.affected.length - 12} more` : '') : '—'}`, '');
}
writeFileSync(`${outDir}/_cards_section.md`, md.join('\n'));
console.log(JSON.stringify(stats));
