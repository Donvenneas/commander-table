# Phase 2D — Changelog

Version 1.61.0 → 1.62.0, rules 24 → 25. Every code change carries a `(Phase 2D-n …)` comment naming its increment. Search for `Phase 2D-` to find all of them.

## Game code (`public/js/`)

| File | Increments | Changes |
|---|---|---|
| `engine.js` | 1, 2, 3, 5, 6, 7, 8 | `RULES = 25` and its comment. New fields `endReturn25` and `trail`. `cast`: cost trail (`costMoves`), `castAlt`, `castPhase`, `castActive`, `castX`, `castCounts`, `convergeN`; escalate; casting from the owner's zone (bug fix); Mox Diamond's discard skipped at cast time. Permanent resolution: Mox Diamond enter replacement, `entersX25`. Seventh-from-top placement. `sacTo` cost trail. `setPhase` keeps `keepTurn` mana. `gyLandOk` and `playLand` (graveyard lands, `castOnly`). End-step return list. `loyaltyLocked` and `activatePW`. |
| `effects.js` | 1–8 | `cond25` (way, lki, cost, altPaid, castMain, castAgain, enteredTurn, attackedN, oppDealtN, libEmpty, named counters "on it"); `parseCond` returns `r25`. "Then if" reading. Counterspell `targetsMine` and `mv25`. `tr25` target words (the `TR25` kinds). Persist `minus25`. "An opponent draws" → `drawLose`. Mana lines: `spend`, `cond25` → `fx.mana.spend25` and `cond25`; `spendWords`. `keep25`. The play-from-top fix (`notTop25`, `gyLands`, `flash25`, `free25`). `gyWords25`. `whereX25` and `whereXold`. `entersX25`. `mayCost` (with the `MODAL_STASH` hand-back). Tokens for that/each player, quoted abilities, `temp25`. `grantWatch`. `frozen25`. Permissions (`exileOne25`, `play25`, `castFrom25`, `returnEnd25`, `forever25`). `prot25`, `unblock25`, `noRegen25`. Statics `attackOnce25`, `noLoyalty25`, `counterBonus25`, `moxDiamond25`. Hideaway and `playHidden`. `escalateCost25`. Descriptions for the new fields. |
| `resolve.js` | 1–8 | `runEffects` trail. `if` handler (r25, "this way" object). `targetFits` split into `wordsFit` with counted bounds. `counterFits(…, p)`. Reanimate and regrow filtered by `tr25`, with the -1/-1 counter. `attachSelf` restricted. `libraryPos`. `drawLose` "an opponent". `addMana`/`addManaN` `keepTurn`. `gyCastTurn` (one card, count, subtypes). `roll` → `ctx.roll`. Converge for copies. `mayCost`. Token makers for that/each player. `grantWatch`. Tap `frozen25`. Dig `exileOne25`, mill `play25`, `exileTrigCard`, `exileGy` permissions, impulse `forever25`. `protect` `prot25`. Counters `unblock25`. `moreCounters` `counterBonus25`. `noRegen25`. Copy Plus. `hideaway`, `playHidden`. Damage-per-turn counter. |
| `triggers.js` | 1, 2, 3, 4, 8 | `evalCond`: `'?'` never met at rules 25, `r25`, and the new cases. `lkiIs`, `wayMatch`. Intervening-if at trigger time (`interveningFails`). Batch combat damage adds up. `tempWatch` in `fire`. |
| `mana.js` | 1, 2, 3, 5, 6, 8 | `manaColors25`, `spendFits`, `spellFits`. `units` and pool restrictions. `sources` filter. `castTimingOk` `flash25`. `castModeRaw`: `free25`, graveyard `mayPlay`, gyCast limits, Mox Diamond. `topPlayable` `notTop25`. `dynValue` `r25` values. `convergeOf`. `trigT` from last-known information. |
| `zones.js` | 1, 4, 8 | `move`: last-known information and trail; `fromTop` placement. `createToken` `name25`. Abundance in `draw`. |
| `replacements.js` | 8 | `drawDefs` Abundance. |
| `combat.js` | 7, 8 | Attack-once-per-player filter; attacker count per turn. |
| `ai.js` | 1, 2, 3, 5, 7, 8 | `counterFits` with p; `tr25` in target fits; `costWorth`; `effectValue` for `mayCost`, `hideaway`, `playHidden`; `chooseLand` graveyard lands; candidate list with graveyard and opponents' exile permissions; loyalty lock. |
| `human.js` | 2 | Graveyard lands offered in the main phase. |

## Tests and data

| File | Change |
|---|---|
| `tests/mechanics.mjs` (new) | 75 tests across the eight increments, each with old-rules (24) checks where a reading changed. |
| `.github/workflows/selftest.yml` | Runs `tests/mechanics.mjs`. |
| `tests/coverage.mjs` | Three MISREAD checks accept the new readings (Giver of Runes `prot25`, `entersX25`, the permission readings). |
| `tests/card-readings.json` | Accepted reading changes (`--update`), reviewed card by card at each increment. |
| `tests/golden-games.json` | Adds the 6 rules-25 golden games. The rules 4–24 entries are unchanged. |
| `tests/card-coverage.md`, `public/data/coverage.json` | Regenerated. |
| `audit/phase-2d/` | This report set, plus `tools/impact.mjs` and `tools/coverage-1.61.0.json` (the scan before Phase 2D). |
| `audit/phase-2c/cards197.json` | The 197 card names from the Phase 2C audit, for the impact script. |
| `ROADMAP.md`, `README.md`, `VERSION`, `CLAUDE.md` | Item 390, the user note, 1.62.0, the new test line. |
