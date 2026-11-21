# Phase 2K report: AI decisions (ROADMAP item 382, rules 19, version 1.54.0)

The AI was already a large, rules-aware system when this phase started (ai.js 2,250 lines, combatai.js, lookahead.js).
This phase audited it, probed about 40 small boards to find where its choices were wrong, fixed what the probes found
(behind rules 19, so games and replays at rules 4 to 18 play exactly as before: golden games 96 played, 0 differ), and
added 30 tests that check the decision itself. Every decision test is listed with its board, legal plays, expected and
actual play in [ai-decisions.md](ai-decisions.md). Passing tests are not a claim of full rules compliance or of
"competitive" play in general: they cover the boards listed there.

## 1. Files inspected

public/js: ai.js, combatai.js, lookahead.js, engine.js, human.js, remote.js, net.js, mana.js, resolve.js, triggers.js,
combat.js, zones.js, invariants.js, effects.js (readings only), ui.js, main.js (AI strength setting), brackets.js,
stack.js. tests: scenario.mjs, hidden.mjs, stack.mjs, golden.mjs.

## 2. Files modified

public/js: ai.js, resolve.js, engine.js (RULES 19 only). tests: ai.mjs (new), ai-decisions.md (new),
phase-2k-report.md, golden.mjs (rules 18 kept in the list), golden-games.json (rules 19 added). Also README.md,
ROADMAP.md, CLAUDE.md, VERSION, .github/workflows/selftest.yml. No interface file changed.

## 3. How the AI worked (audit) and what was wrong

| Question | Answer from the code |
|---|---|
| How plays are chosen | `Agent.bestPlay` lists every legal play (cards in hand, command zone, graveyard and exile it may cast; abilities, equip, crew, cycling, planeswalkers), scores each (`scoreCast`, `effectValue`), and picks the best set that fits the turn's mana (up to 3 spells). Ready combos come first. |
| Board evaluation | `value` (stats, keywords, engines), `comboDanger`, `threat` per opponent (with learned threat tables and grudges), `keyValue` in combat. |
| Targets | `chooseTarget` per effect kind; since rules 17 limited to what the card's words allow (`targetFits`). |
| Activated abilities | `usableAbilities`, scored like spells; instant-speed ones wait for an opponent's end step unless clearly good. |
| Attacks and blocks | `combatai.js`: every candidate exchange is simulated (first and double strike, deathtouch, trample, lifelink, menace, commander damage); blocks are checked with `Game.canBlock`. |
| Responses | `respond`: counterspells (`wantCountered`), protection, redirection, Stifle on abilities, sacrifice in response, punishing pump spells, copying spells; it works on real stack objects through the rules 15 priority loop. |
| Look-ahead | `lookahead.js`: the best 3 plays are tried on a deep copy of the game with hidden cards re-dealt from a forked seed, with a step budget; also for responses, attacks and end-of-turn plays. |
| Randomness | Only the game's seeded generator (`g.rand`); nothing uses Math.random. Replays are exact. |
| Illegal actions | Every action goes through the engine (`Game.cast`, `activate`, the combat code), which refuses illegal ones. |

What the probes found wrong (each reproduced before the fix, and now a test):

| Fault | Effect | Test |
|---|---|---|
| Counterspells were cast at spells that can't be countered (Cavern of Souls, "next spell can't be countered") | A card wasted | 8, 18 |
| Generic costs were paid with any land: a Forest for Sol Ring, so Llanowar Elves couldn't follow | One spell instead of two | 4 |
| One refused play (a cost or target that turned out impossible) ended the whole main phase | The rest of the turn wasted | 27, 29 |
| Removal ranked targets by value and by which opponent leads, not by what kills the AI next turn | A big creature killed while a smaller flyer delivers the lethal attack | 5, 23 |
| Removal could go to a permanent already being removed by another spell on the stack | Two answers for one threat | 19 |
| Removal in response checked only the broad kind ("creature"), not the card's words; Doom Blade on a black creature was attempted and refused by the engine | A wasted decision and log noise | 19 |
| In main 1 the AI spent the mana held for a counterspell on instant removal for a minor creature | Counterspell offline when a real threat came | 3 |
| Explain mode printed "ðŸ§ " instead of 🧠 (the file had a garbled character) | Cosmetic | — |

## 4–9. What changed, and status

| Area | Change | Status |
|---|---|---|
| Decision system | No new system: the existing Agent gained `lethalKey`, `nextAttackOn`, `threatKind`, `doomed` and the refused-play memory; every action still goes through the engine | Fully implemented for the cases above |
| Mana | Each spell's payment keeps back the colors the other spells the AI wants to cast need (Game.cast's existing `avoid`) | Fully implemented for generic costs; colored pips already went to the narrowest sources |
| Mana | Instant-speed spells keep the counterspell mana in main 1 as they already did in main 2 | Fully implemented |
| Mana | Hybrid, Phyrexian and two-brid payment | Already implemented (Phase 2D); not changed |
| Threats | +25 for a creature whose removal turns its controller's next attack from lethal to not lethal (life, or the format's commander damage), worked out per opponent from public information | Fully implemented; a rough bound (one blocker per attacker, biggest first; no tricks, no pump, no first strike in the estimate) |
| Threats | `threatKind`: lethal, combo, engine, untouchable, minor | Implemented and tested; used by Explain and tests, not yet by every decision |
| Interaction | Counterspells and counter wars use the same "can't be countered" test the counter meets as it resolves (`cantBeCountered`) | Fully implemented |
| Interaction | Removal in response checks the card's own target words and skips doomed permanents | Fully implemented |
| Combat | No change: the simulation already handled the keywords in the brief; now tested on real combats | Already implemented; tests 9–14, 24 |
| Combos | No change: combos are played with the real cards (Phase 2C); a combo without its mana isn't started | Already implemented; tests 20–22 |
| Resource management | Covered only by the changes above; no new card-advantage model | Partially implemented (existing heuristics) |
| Multiplayer | Each opponent's next attack is worked out separately; elimination target choice per opponent was already there | Implemented for removal; tests 23, 24 |
| Politics | Existing deals and grudges; not changed | Not changed |

## 10. Difficulty

The game already has AI strength on the setup screen: Beginner (deliberate mistakes on 35% noise and every decision
from a random decent option), Casual, Strong, Expert (Strong plus look-ahead). They map onto the brief's Easy,
Normal, Hard and Expert. None gives extra mana, cards, life or hidden information; only how the pilot chooses
changes. Test 30 decides the same lethal board 12 times per strength: Strong finds the win every time, Beginner
less often, and both only make plays the engine accepts. No setting was added or changed.

## 11. Look-ahead and cost

Unchanged in design: 3 candidates, 400 simulated steps each, 3 look-aheads a turn, hidden cards re-dealt with a forked
seed, a yield to the page every 25 steps. The new threat check costs one pass over each opponent's creatures and the
AI's blockers per removal choice (cached per choice). Measured on a four-player board of 240 permanents: attack
choice, main-phase play, removal target and blocks together finished well inside the test's 4-second limit (the attack choice, the slowest, took about
0.15 s on this PC in the probes). Browser self-test: 1.07 s per look-ahead game, 7.6 games a second without it.

## 12–13. Tests

New: `tests/ai.mjs`, 30 tests (the brief's 30, numbered the same), 33 recorded decisions, all passing. Where behaviour
changed, the test also checks that rules 18 still plays the old way (tests 4, 5, 18, 29).

Existing, all passing: golden 96 games (0 differ, rules 4–18 unchanged), multiplayer 36, interactions 218, stack 22,
abilities 47, replacements 15, loops 18, combos 21, mana 21, hidden information (8 games, 5,653 decisions asked again
with hidden cards scrambled, 0 changed), online seats 7, replays 10, card readings (0 changed), element ids,
stylesheet lint, type check (0 findings), fuzz 12 + 40 games (0 errors, 0 broken rules). Browser self-test: 19 of
19, 50 games with 0 simulator errors, determinism 6/6.

## 14–15. Known limitations and partial features

- No measured strength gain: no head-to-head games compare rules 19 pilots with rules 18 pilots (a game has one rules
  version for every seat). The fixes are checked case by case only.
- The lethal estimate ignores tricks in hand, pump abilities, first strike, lifelink and the AI's own removal; it
  can over- or under-rate a board.
- `avoid` keeps back colors for every other spell the AI considered this turn, even ones it won't cast; it is a
  preference, never a block, so a payment is never refused because of it.
- The interface is unchanged: the AI's turn shows through the log, the ◆ Priority chip (Phase 2J), the stack panel's
  "passed" count and the "AI strength" line at the start; there is no separate "thinking" indicator for AI seats.
- Card-advantage, sacrifice and recursion choices are the existing heuristics, not re-tuned.
- Removal in response still happens only in the situations the AI already looked for (a loop starting, a pumped or
  enchanted creature, the end of an opponent's turn); it doesn't answer every new threat at instant speed.

## 16. Dependencies on earlier phases

All present: the stack and priority (2G) for responses, replacement effects (2F), Phyrexian and hybrid mana (2D),
combos played with real cards (2C), multiplayer and commander rules (2J). None is a blocker for what was done here.
Continuous effects are applied as the engine has them (no layer system, ROADMAP item 90); AI evaluations read the
same values.

## 17. Recommended next phase

Measure strength: a head-to-head harness where seats can use different AI rule sets (or switches like the existing
`noLaRespond`) in the same game, so changes like these can be shown to win more, not only to look right on chosen
boards. Then use `threatKind` in the remaining decisions (counterspells, attack targets, tutors).
