# Phase 2D — Test Results

Every result below was actually run on this machine at the end of Phase 2D (version 1.62.0, rules 25), unless the table says otherwise.

## Baseline before any change (1.61.0)

Every Node suite passed. Golden games: 126 played, 0 differ. Fuzz: 12 games, 0 errors. Type check: 0 findings. Rules validation: 27 tests, 26 passed and 1 known deviation, which existed before Phase 2D.

## After each increment

After every increment, `tests/mechanics.mjs` (that increment's tests), `cards.mjs` (the reading diff, reviewed card by card), interactions, rules, mana, stack, replacements, abilities, loops, combos, multiplayer, ai, replay and typecheck were all run. Golden, fuzz and hidden-information were run after 2D-1+2, after 2D-3, and at the end.

| After | mechanics.mjs | Other suites | Golden (rules 4–24) | Notes |
|---|---|---|---|---|
| 2D-1 | 23/23 | all pass | 0 differ | 4 failures were fixed on the way. Three were test expectations: Craterhoof's toughness is 5, not 9; Persist's counter check needed a creature without an enter trigger; Baleful Mastery's cast needed no forced targets. The fourth was a real finding: Baleful Mastery's "an opponent draws" was read as you drawing, and was fixed. |
| 2D-2 | 37/37 | all pass | 0 differ | Abilities test "Cavern of Souls tapped by hand" failed. The new spend restriction duplicated Cavern's own reading, so Cavern was excluded; it passes. Yeva's flash failed until color words were added to the spend matcher. |
| 2D-3 | 48/48 | all pass | 0 differ | The first `mayCost` version dropped Caesar's modes at rules 24 (a replay change). It was found in the reading diff and fixed by handing the modal list to both readings. Ancient Bronze Dragon's test expected X on one creature; the card puts X on each of two, so the test was wrong. |
| 2D-4 | 52/52 | all pass | — | — |
| 2D-5 | 57/57 | all pass | — | Found and fixed a 1.61.0 bug: casting from another player's exile removed the caster's own last exiled card. |
| 2D-6/7 | 66/66 | all pass | — | The Mox Diamond test was redone to watch the hand while the spell is on the stack. |
| 2D-8 | 73/73 | all pass | — | — |
| End | **75/75** | all pass | **0 differ** | Added Jace, Wielder of Mysteries and Treasure Map conditions after coverage showed them. |

## Final regression run

| Suite | Command | Result |
|---|---|---|
| Phase 2D mechanics | `node tests/mechanics.mjs` | **75 tests, 75 passed, 0 failed** |
| Card readings | `node tests/cards.mjs` | 3,500 cards, 0 changed after `--update` (every change reviewed per increment) |
| Interactions | `node tests/interactions.mjs` | 245 tests, 245 passed |
| Rules validation | `node tests/rules.mjs` | 27 tests, 26 passed, 1 known deviation (unchanged), 0 failed |
| Mana | `node tests/mana.mjs` | 21/21 |
| Stack and priority | `node tests/stack.mjs` | 22/22 |
| Replacements | `node tests/replacements.mjs` | 15/15 |
| Abilities | `node tests/abilities.mjs` | 47/47 |
| Loops | `node tests/loops.mjs` | 18/18 |
| Combos | `node tests/combos.mjs` | 21/21 |
| Multiplayer | `node tests/multiplayer.mjs` | 36/36 |
| AI decisions | `node tests/ai.mjs` | 35/35 |
| Hidden information | `node tests/hidden.mjs` | 8 games, 5,811 decisions re-asked with hidden cards scrambled, **0 changed** |
| Replays | `node tests/replay.mjs` | 10/10 |
| Online seats | `node tests/net.mjs` | 7/7 |
| Storage | `node tests/storage.mjs` | 8/8 |
| Card data | `node tests/carddata.mjs` | 30/30 |
| Element ids, CSS lint | `node tests/ids.mjs`, `node tests/csslint.mjs` | pass, nothing new |
| Type check | `node tests/typecheck.mjs` | 0 findings; strict null checks 0 findings |
| Golden games | `node tests/golden.mjs` | **132 played, 0 differ, 0 simulator errors**. This includes the six rules-24 games recorded by 1.61.0 (restored and re-checked: identical) and six new rules-25 games. |
| Fuzz | `node tests/fuzz.mjs --games 60 --seed 7000` and `node tests/fuzz.mjs` | 60 + 12 games finished, **0 simulator errors, 0 broken rules**, first game replayed identically |
| Browser self-test | `Commander Table.exe --no-window`, `selftest.html?run` | **All 19 checks passed**: 50 games with 0 simulator errors, rules check with no rule broken, look-ahead 6/6 replayed, determinism 6/6 identical, Kingdoms 10/10 role wins |
| Interface test | `uitest.html?run` | **17 passed, 0 failed**, 1 not run (online seats, by design) |

A note on fuzz: the "Targets chosen that were not legal (by source)" lines come from the fuzz seat's random answers being refused. The same kind of line appears in the 1.61.0 baseline. They are not engine failures.

## Coverage of the required test kinds

| Kind | Where in `tests/mechanics.mjs` |
|---|---|
| A. Normal resolution | Every mechanic has one (for example Noxious Gearhulk, Delighted Halfling, Painful Truths, Rite of the Raging Storm, Expressive Iteration, Benevolent Hydra, hideaway) |
| B. Illegal targets | Drown in the Loch (MV above the graveyard count), Not of This World (a spell aimed elsewhere), Persist (a legendary card not offered to a person), Mithril Coat (no legendary creature) |
| C. Missing or insufficient costs | Mox Diamond with no land; Grist's -2 with nothing to sacrifice; Springbloom Druid with no land; Chainer's second creature; escalate with too little mana; Crucible with no land drop left |
| D. Multiple targets | Ancient Bronze Dragon (X on each of two). Divided targets are not implemented (remaining gaps). |
| E. Simultaneous triggers | Two Unstoppable Slashers dying together; Quartzwood Crasher's batch of combat damage |
| F. Multiple opponents | Rite of the Raging Storm (three players: only the upkeep player gets a token), Port Razer (attacking P2 then P3), Baleful Mastery (choosing an opponent) |
| G. Graveyard and exile | Crucible, Chainer, Emry, Tablet of Discovery, Mnemonic Betrayal, Containment Construct, Valakut Exploration, Persist, hideaway |
| H. Replacement effects | Noxious Gearhulk under Rest in Peace; Mox Diamond; Benevolent Hydra with Hardened Scales (616.1); Abundance |
| I. Interactions with other mechanics | Hydra and Scales; Rest in Peace and "destroyed this way"; Halfling mana tapped into the pool, then a spell; Twinning Staff and Reverberate; Omniscience and the library top |
| J. Determinism | "the same game with the 2D-1 cards gives the same log twice"; golden and fuzz replays; the self-test determinism check |
| K. Regression for previously working cards | A rules 24 check for every changed reading (Not of This World, Noxious Gearhulk, Court of Garenbrig, Persist, Halfling, Birgi, Springbloom Druid, Rite, Jace, hideaway, Mox Diamond); all existing suites; golden 4–24 |
| Person and AI | People: Persist's card list, Wilhelt's optional cost prompt. AI: everything else, plus Crucible's land choice and Mox Diamond's cast guard. |

## Not run or not covered

- Other browsers (`tests/browsers.mjs chrome|firefox`): not run.
- Targeted 20-seed games per changed card in real decks: not run. The changed cards appear in golden, fuzz and self-test games only if those decks contain them.
- Remote seats answering the new prompts: not run.
- Mac/Linux servers and the Cloudflare tunnel: not run (no endpoint changed).
- Performance (`node --expose-gc tests/perf.mjs`): not run. The self-test's speed row (6.5 games a second) is in the usual range, but no before/after comparison was made.
