# Phase 2F — Rollback Notes

## Without touching the code: rules 26

Every Phase 2F behaviour change is gated: `g.rules >= 27`, effects marked `since: 27`, and old readings kept with `until: 27`. Setting `export const RULES = 26;` in `public/js/engine.js` makes new games play as 1.63.0 did. Saved replays carry their own rules version and need nothing. `node tests/golden.mjs` shows rules 4–26 unchanged.

Two changes are not gated by rules, because they don't change play:
- the coverage checker (`effects.js droppedSentences`, `fxPrint`, HARMLESS). It changes the coverage report, the "not simulated" lists, and at most a once-a-game log note. To undo it, revert those three spots and run `node tests/cards.mjs --update`.
- `tests/known-defects.json` entries (report only).

## Git

- Backup before any change: commit `e40f2f7` (1.63.0).
- Checkpoint after 2F-1, 2F-3 and 2F-5: commit `bce403f`.
- The final Phase 2F commit follows it on branch `replay-exactness`. To undo the whole phase: `git revert <final commit> bce403f`. Before committing, `git stash push -- public/js tests .github ROADMAP.md README.md CLAUDE.md VERSION` would do the same.

## Reverting one workstream

| Workstream | Reading (effects.js) | Engine | Tests (`tests/completions.mjs`) |
|---|---|---|---|
| 2F-1 follow-ups | `them27`, `THEM_RES`, `THEM_KINDS`, `lastKind`, the call in `parseEffects`, `prevHint` in the `payFor` branch | `resolve.js runEffects0` tracking, `touch27`, `lastTgt27`, `them27` case; `zones.js entered` line; `engine.js endLater27` block; `combat.js mustAttack27`; `ai.js` value | "Them:" tests |
| 2F-1 cast triggers | `onCast27` line | `engine.js` cast-trigger loop (put back the single `s.fx.onCast` test) | Jeskai |
| 2F-1 tapped and attacking | `fromHand` pattern `attacking27` | `resolve.js fromHand` | Ilharg |
| 2F-2 kicked instead | the `more` branch in `parseEffects` | none | Rite, Consult |
| 2F-3 channel | `less27`, `comp.land27`, bounce type-list pattern | `engine.js cycleCost` (put back `parseCost(c.cost)`), `resolve.js compensate` | "Channel:" tests |
| 2F-5 counters | `exile27`, `top27` | `resolve.js` counter case, `engine.js` `toTop27` line | "Counter:" tests |
| 2F-5 Enduring | the "it's an enchantment" branch | `resolve.js returnSelf`, `zones.js move`, `triggers.js trigIs` | Enduring tests |
| 2F-5 flashback | HARMLESS words | `resolve.js grantFlashback` choice | Snapcaster, Past in Flames |
| 2F-7 colors | `chooseColor27` | `zones.js entered`, `leaveBattlefield` | Thriving, Crossroads, Valgavoth, Uncharted |
| 2F-7 types | the `ct` pre-pass | `resolve.js chooseType27`, `wipe.notChosen27`, `mana.js chosenCount`, `human.js chooseTypeAsync` | Distant Melody, Kindred Dominance, Pact, Harmonized Crescendo |
| 2F-7 mana | `mana.cond27` block | `mana.js manaAmount` | Urza, Caryatid, Druid |

For each one:
1. Delete the engine branch (each is behind a rules-27 check).
2. Delete the reading fields. Where an old reading is marked `until: 27`, remove the new effect and the mark together.
3. Run `node tests/cards.mjs`. The diff should list only that workstream's cards; accept it with `--update`.
4. Remove its tests and any known-defects entry it added.
5. Run `node tests/golden.mjs` (rules 4–26 must not differ), then the suites in `PHASE_2F_TEST_RESULTS.md`, then the browser self-test.

## Dependencies

- The delayed end-step actions, the haste on tokens and the untaps all depend on the touched-permanent tracking in `runEffects0`. Revert them together.
- The Enduring return needs both `ench27` and the `trigIs` last-known-information fix. Without the fix, the cards don't return at all (as at rules 26).
- `chooseType27` sets `src.chosenType`, which `mana.js chosenCount` reads (Pact of the Serpent).
