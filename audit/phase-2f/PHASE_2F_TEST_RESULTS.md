# Phase 2F — Test Results

Every result below was produced by running the command in this session on Windows with Node.js 26. Nothing is reported as passing that did not run.

## Baseline (1.63.0, rules 26, commit `e40f2f7`, before any change)

All 23 CI suites passed: typecheck (0 findings), cards (3,500, 0 changed), golden (138 played, 0 differ, 0 simulator errors), fuzz (12 games, 0 errors, 0 broken rules), hidden (8 games, 6,687 decisions), interactions 245/245, mechanics 75/75, repairs 37/37, replay 10/10, loops 18/18, combos 21/21, mana 21/21, replacements 15/15, stack 22/22, abilities 47/47, ai 35/35, net 7/7, multiplayer 36/36, carddata 30/30, rules 26 passed + 1 known deviation, storage 8/8, ids, csslint.

## After Phase 2F (1.64.0, rules 27)

| Suite | Result |
|---|---|
| `node tests/typecheck.mjs` | 0 findings; strict null checks 0 findings |
| `node tests/cards.mjs` | 3,500 cards, 0 changed (after the reviewed `--update`: 146 readings changed, listed in `tools/readings-diff.txt`, first 25 shown; each family was checked card by card) |
| `node tests/completions.mjs` (**new**) | **58 / 58 passed** |
| `node tests/golden.mjs` | 138 played, rules 4–26 **0 differ**, 0 simulator errors; the 6 new rules-27 games were recorded with `--update` and then pass |
| `node tests/fuzz.mjs` | 12 games from seed 61000, 12 finished, 0 simulator errors, 0 broken rules, first game replayed identical |
| `node tests/hidden.mjs` | 8 games, 6,687 decisions re-asked with hidden cards scrambled, none changed |
| `node tests/interactions.mjs` | 245 / 245 |
| `node tests/mechanics.mjs` | 75 / 75 |
| `node tests/repairs.mjs` | 37 / 37 |
| `node tests/replay.mjs` | 10 / 10 |
| `node tests/loops.mjs` | 18 / 18 |
| `node tests/combos.mjs` | 21 / 21 |
| `node tests/mana.mjs` | 21 / 21 |
| `node tests/replacements.mjs` | 15 / 15 |
| `node tests/stack.mjs` | 22 / 22 |
| `node tests/abilities.mjs` | 47 / 47 |
| `node tests/ai.mjs` | 35 / 35 |
| `node tests/net.mjs` | 7 / 7 |
| `node tests/multiplayer.mjs` | 36 / 36 |
| `node tests/carddata.mjs` | 30 / 30 |
| `node tests/rules.mjs` | 26 passed, 1 known deviation (unchanged), 0 failed |
| `node tests/storage.mjs` | 8 / 8 |
| `node tests/ids.mjs`, `node tests/csslint.mjs` | pass |
| `node tests/coverage.mjs` | full 2,795, partial 406, restriction 86, incorrect 70, unhandled 4, unsupported 139; fully simulated class 328 (was 273) |

## The 58 Phase 2F tests (`tests/completions.mjs`)

These cover what the brief asks for:

| Requirement | Where it is tested |
|---|---|
| Basic use | every test |
| Every relevant ability / several on one card | Jeskai Ascendancy (both cast triggers), Felidar Retreat (mode and follow-up), Enduring cards (keep their other abilities), Ilharg (attacking + return), Sneak Attack (put, haste, sacrifice) |
| Optional choices | Flameshadow Conjuring (paid / not paid), kicked / unkicked, Siege-Gang and Loyal Apprentice (condition on and off) |
| Illegal targets | Shore Up on an opponent's creature, Otawara on a land, Force of Negation against a creature spell |
| Insufficient costs | channel with too few legends or lands, Flameshadow without mana |
| Conditional resolution | Urza lands with 2 and 3 pieces, Caryatid (own versus opponent's big creature), Incubation Druid counter, Enduring "if it was a creature" |
| Multiple opponents | Puppeteer Clique (another player's end step), Kindred Dominance across three players, Felidar / Virtue (opponent's creatures untouched) |
| Zone interactions | Memory Lapse (top of library), Force of Negation (exile), flashback spell exiled, Wake the Past, Enduring return, a permanent that left and came back |
| Replacement effects | flashback's exile replacing Memory Lapse's destination; **not tested**: them27 with Rest in Peace or other replacement effects |
| Person-controlled | Sneak Attack (a person picks the creature), Snapcaster Mage (a person picks the card), Distant Melody (a person picks the type) |
| AI-controlled | Distant Melody / Kindred Dominance (AI's type), Rite of Replication cast with kicker, Valley Floodcaller (AI value), Legion Warboss in real combat |
| Regression / rules 26 | Sokenzan, Shore Up, Sneak Attack, Otawara, Boseiju, Memory Lapse, Enduring, Thriving Isle, Urza's Tower, Kindred Dominance at rules 26 |

## Browser checks (run after the commit, `Commander Table.exe --no-window`, built-in browser pane)

- `selftest.html?run`: **All 19 checks passed**. 50 games at full speed: 0 simulator errors, 50/50 with a winner. Rules check: no rule broken. AI look-ahead: 6/6 replayed exactly, 2/2 untouched, 0 errors. Determinism: 6/6 identical. Kingdoms: 10/10 ended on a role win, 0 errors. All outside services were reachable.
- `uitest.html?run`: **17 passed, 0 failed, 1 not run** (Online seats, not run by design).

## Not run, and limitations

- `tests/browsers.mjs` and `tests/servers.mjs` were not run (they need a running server; no endpoint changed).
- Fuzz and golden play AI decks. A board with these specific cards appears only in `tests/completions.mjs`.
- The person prompts are tested through `HumanAgent` with a scripted `ui.ask`, not through the real page.
