# Phase 2E — Test Results

Every result below was actually run on this machine at the end of Phase 2E (1.63.0, rules 26), unless the table says it was not run.

## Baseline (1.62.0, before any Phase 2E change)

Every Node suite passed: mechanics 75/75, interactions 245/245, rules 27 (26 passed, 1 known deviation), mana, stack, replacements, abilities, combos, multiplayer, ai, replay; type check 0 findings.

The Phase 2C probes were re-run to see which defects were still live (see `PHASE_2E_REPAIR_REPORT.md`, Method).

## During the work

| After | Result | Failures and how they were resolved |
|---|---|---|
| 2E-1 | repairs 14/14 | Two test mistakes, not engine defects: Quirion Ranger's second turn needed a second Forest to return, and the punisher's target belongs at effect index 2 (the old effects come first in the list). |
| 2E-2/3 | repairs 26/26; all suites pass except one | Real findings fixed along the way: Delay's suspend sentence was unread (it starts with "If"), and the person's tutor list test needed the card picker hooked. `tests/mechanics.mjs` "Palantír's mill" failed at rules 26 because Palantír's mill now sits inside the punisher; it was pinned to rules 25, the version its mechanic belongs to. That is not a weakened test: rules 26 Palantír is tested in `repairs.mjs`. |
| 2E-4 | repairs 31/31 | — |
| 2E-5/7 | repairs 35/35 | — |
| Gilded Drake's "still resolves" | repairs 36/36 | Found that an ability with every target illegal was removed before its sacrifice step; fixed in `triggers.js`. |
| Undying Malice / Feign Death | repairs 37/37 | The shared granted-dies reading reached them; their +1/+1 counter was added. |

Reading diffs (`node tests/cards.mjs`) were reviewed at every step:
- The modal-bullet fix first changed Collective Resistance (it added a stray +0/+0 target) and Kogla and Yidaro (a new mode would have changed older replays' mode lists). The fix was narrowed until only Charming Scoundrel changed.
- The short-name scan found 7 non-legendary cards. They got a second reading for rules 26, not a global change.

## Final regression run

| Suite | Command | Result |
|---|---|---|
| Phase 2E repairs | `node tests/repairs.mjs` | **37 tests, 37 passed, 0 failed** |
| Phase 2D mechanics | `node tests/mechanics.mjs` | 75/75 |
| Card readings | `node tests/cards.mjs` | 3,500 cards, 0 changed after the reviewed `--update` |
| Interactions | `node tests/interactions.mjs` | 245/245 |
| Rules validation | `node tests/rules.mjs` | 27 tests, 26 passed, 1 known deviation (unchanged from before 2D), 0 failed |
| Mana / stack / replacements / abilities / loops / combos / multiplayer | `node tests/<name>.mjs` | 21/21, 22/22, 15/15, 47/47, 18/18, 21/21, 36/36 |
| AI decisions | `node tests/ai.mjs` | 35/35 |
| Replays / online seats / storage / card data | `node tests/<name>.mjs` | 10/10, 7/7, 8/8, 30/30 |
| Element ids, CSS lint | `node tests/ids.mjs`, `node tests/csslint.mjs` | pass, nothing new |
| Type check | `node tests/typecheck.mjs` | 0 findings; strict null checks 0 findings |
| Golden games | `node tests/golden.mjs` | **138 played, 0 differ, 0 simulator errors**. All 132 games recorded before Phase 2E (rules 4–25) are byte-identical; 6 rules-26 games were added. |
| Fuzz | `node tests/fuzz.mjs --games 60 --seed 7000` | 60 games finished, **0 simulator errors, 0 broken rules**, first game replayed identically |
| Fuzz (default seed) | `node tests/fuzz.mjs` | 12 games finished, 0 simulator errors, 0 broken rules, first game replayed identically |
| Hidden information | `node tests/hidden.mjs` | 8 games, 6,687 decisions re-asked with hidden cards scrambled, **0 changed** |
| Browser self-test | `Commander Table.exe --no-window`, `selftest.html?run` | **All 19 checks passed**: 50 games with 0 simulator errors, rules check with no rule broken, look-ahead 6/6 replayed, determinism 6/6 identical, Kingdoms 10/10, version 1.63.0 served |
| Interface test | `uitest.html?run` | **17 passed, 0 failed**, 1 not run (online seats, by design) |

The fuzz "Targets chosen that were not legal" lines are the random seat's answers being refused, the same as in the 1.61.0 baseline.

## Required test kinds, per repaired mechanic (`tests/repairs.mjs`)

| Mechanic | Normal | Invalid target | Illegal on resolution | Insufficient | Multiplayer | Simultaneous | Replacement / zone | Interaction | Person | Old rules |
|---|---|---|---|---|---|---|---|---|---|---|
| Once each turn | ✓ | — | — | ✓ (no Forest) | — | — | — | ✓ (next turn) | — | ✓ |
| Exchange of control | ✓ | ✓ (own creature) | ✓ (target left; on the stack) | ✓ (no target) | — | — | ✓ (sacrifice) | ✓ (AI choice) | — | ✓ |
| Punisher | ✓ | — | — | — | ✓ (4 players, only the target) | — | ✓ (mill: trail) | ✓ (life thresholds) | ✓ | ✓ |
| Ignition target | ✓ | ✓ (opponent's) | ✓ (left: no substitute) | — | — | — | — | ✓ (AI) | — | — |
| Search words | ✓ | ✓ (non-green, non-Dragon) | — | ✓ (no Dragon) | — | — | — | — | ✓ | ✓ |
| Any mana type | ✓ | — | — | ✓ (Island only) | — | — | ✓ (exile, an opponent's card) | — | — | — |
| Second reading | ✓ | — | — | — | — | — | ✓ (destroy) | — | — | ✓ |
| Delay / Render Silent | ✓ | — | — | — | — | — | ✓ (exile, suspend) | ✓ (silence) | — | — |
| Copy of a chosen target | ✓ | ✓ (opponent's enchantment) | — | — | — | — | — | — | — | — |
| Mode text / quoted tokens | ✓ | — | — | — | — | — | — | ✓ (mana ability on the token) | — | ✓ |
| Delina | ✓ | — | — | — | — | — | ✓ (exile at end of combat) | ✓ (reroll) | — | ✓ |
| Granted dies trigger | ✓ | ✓ (opponent's) | — | — | ✓ (owner's control) | — | ✓ (graveyard → battlefield) | ✓ (Undying Malice) | — | — |
| Terastodon | ✓ | ✓ (creature) | — | — | ✓ (two opponents) | — | ✓ (destroy → tokens) | — | — | ✓ |
| Attack limits | ✓ | ✓ (named attacker) | — | — | ✓ (3 players) | — | — | ✓ (combat) | — | — |

"—" means not applicable or not tested; the gaps are listed in `PHASE_2E_REMAINING_DEFECTS.md`.

## Not run

- Other browsers (`tests/browsers.mjs`).
- `tests/servers.mjs` and Mac/Linux servers: no endpoint changed.
- Performance (`tests/perf.mjs`): only the self-test's speed row (6.7 games a second).
- Targeted 20-seed games with the repaired cards in real decks.
- Online seats answering the new punisher prompt (`chooseOfferAsync` goes through the same `ui.ask` used by every other prompt; it was not run through `net.js`).
