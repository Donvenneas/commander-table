# Phase 2F — Changelog

Version 1.63.0 → **1.64.0**, rules 26 → **27**. Every code change carries a `(Phase 2F-n …)` comment naming its increment; search for `Phase 2F-` to find all of them.

## Game code (`public/js/`)

| File | Increments | Changes |
|---|---|---|
| `engine.js` | 2F-1, 3, 4, 5 | `RULES = 27` and its comment. Fields `touched27`, `lastTgt27`, `endLater27`. The cast-trigger loop goes through `onCast27` too. `cycleCost` (channel discount) used by `canCycle` and `cycle`. `endSteps` runs the delayed end-step actions. A countered spell with `toTop27` goes on top of its owner's library. |
| `effects.js` | 2F-1 to 2F-8 | `them27` with `THEM_RES`, `THEM_KINDS`, `lastKind` (follow-up sentences); `parseEffects(t, noMay, prevHint)`; `onCast27`; `fromHand.attacking27`; kicked "instead" with another number; `channel.less27`; `comp.land27`; bounce of a type list; counter `exile27`/`top27`; Enduring `ench27`; `chooseType27` pre-pass; `chooseColor27`; `mana.cond27`; descriptions (`them27`, `chooseType27`, channel discount, counter destination, chosen color, `onCast27`); `droppedSentences` and `fxPrint` (coverage blind spots); HARMLESS additions. |
| `resolve.js` | 2F-1, 3, 5, 7 | `runEffects0` records what each effect touched; `touch27`; `lastTgt27`; `them27` and `chooseType27` handlers; `teamPump`/`counters` record their permanents; `fromHand` tapped and attacking; `compensate` `land27`; counter destinations; `returnSelf` `ench27` (and its log line at rules 27); `grantFlashback` lets a person choose; `wipe.notChosen27`. |
| `zones.js` | 2F-1, 5, 7 | `entered` records what entered and narrows a chosen-color land's mana; `move` restores an Enduring card's types as it leaves; `leaveBattlefield` restores a chosen-color land. |
| `triggers.js` | 2F-5 | `evalCond('trigIs')` uses the source's last-known types. |
| `mana.js` | 2F-7 | `manaAmount` applies `cond27`; `chosenCount` with `who: 'you'` and `perm`. |
| `combat.js` | 2F-1 | A permanent that must attack this combat (`mustAttack27`) is added to the attackers. |
| `ai.js` | 2F-1, 7 | `effectValue` for `them27` and `chooseType27`. |
| `human.js` | 2F-7 | `chooseTypeAsync` (a person picks the creature type). |

## Tests and data

| File | Change |
|---|---|
| `tests/completions.mjs` (new) | 58 tests across the Phase 2F increments, with rules-26 checks where a reading changed. |
| `tests/known-defects.json` | 6 entries added: Incubation Druid, Inspiring Call, Summon: Knights of Round, Dalkovan Encampment, Whip of Erebos, Will of the Jeskai. |
| `tests/card-readings.json` | 146 reading changes accepted after review (`audit/phase-2f/tools/readings-diff.txt`). |
| `tests/golden-games.json` | The 6 rules-27 games added; rules 4–26 unchanged. |
| `tests/card-coverage.md`, `public/data/coverage.json` | Regenerated. |
| `.github/workflows/selftest.yml` | Runs `tests/completions.mjs`. |
| `ROADMAP.md`, `README.md`, `CLAUDE.md`, `VERSION` | Item 392 (left open: partly done), the user note, the new test line, 1.64.0. |
| `audit/phase-2f/` | This report set, `tools/fx.mjs`, `tools/completion.mjs`, `tools/coverage-1.63.0.json`, `tools/remaining.json`, `tools/readings-diff.txt`. |
