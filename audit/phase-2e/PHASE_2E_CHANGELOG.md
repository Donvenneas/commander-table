# Phase 2E — Changelog

Version 1.62.0 → **1.63.0**, rules 25 → **26**. Every code change carries a `(Phase 2E-n …)` comment naming its increment; search for `Phase 2E-` to find all of them. (Older comments reading "rules 13, Phase 2E" belong to a different Round 5 phase that used the same label.)

## Game code (`public/js/`)

| File | Increments | Changes |
|---|---|---|
| `engine.js` | 2E-1, 2, 4 | `RULES = 26` and its comment. `mk`: `card.v26` from rules 26. `canActivateRaw` and `activate`: "activate only once each turn" (`o.onceUsed26`). New field `endCombat26`. |
| `effects.js` | 2E-1 to 2E-7 | Punisher `offer` and `punisherRest`. Tataru Taru's opponent draw. `exchange`, `sacUnlessExchanged`, `resolvesAnyway26`. Chandra's Ignition target (`needsTargetIn`). `TARGETED` additions. Search words (`subs26`). Counterspell riders (`suspend26`, `silenceCtl26`). `anyMana26`. `cleanText(…, noShort)` and `shortNameMisread`. Choose-target copies. `bulletEffects`. Token abilities in quotes (`text26`). "Target player creates" tokens. Delina's roll rows. `grantDies26`. Terastodon's line. `attackSelfCap26`, `noAttackNamed26`. Descriptions. |
| `resolve.js` | 2E-1 to 2E-5 | `legalTargets` for ignition, exchange and offer. `exchange`, `sacUnlessExchanged`, `offer` handlers. Ignition uses its target. `tutorFits` (one search test). Counter riders. `exileGy` any mana. `roll` reroll loop and `ctx.share26`. `rollAgain26`, `grantDies26`, `tokenPerWay26`. `copyToken` for attacking, end-of-combat and same-creature copies. `returnSelf` tapped. `counterFits` doc comment. |
| `triggers.js` | 2E-3 | `resolveAbility` lets "still resolves" abilities resolve with illegal targets. |
| `mana.js` | 2E-1, 2 | `dynValue` `wayMv`. `costOf` mana of any type. |
| `zones.js` | 2E-3, 4 | `createToken` text (`text26`). `move` queues a granted dies trigger. |
| `combat.js` | 2E-4, 7 | End-of-combat exile (`endCombat26`). Attack-cap and named-attacker filters. |
| `scryfall.js` | 2E-2 | `normalize` builds `card.v26` for non-legendary cards whose own first word was replaced. |
| `ai.js` | 2E-1, 2 | Target choices for exchange, ignition and offer. Values for exchange and offer. `chooseOffer`. `pickTutor` uses `tutorFits`. |
| `human.js` | 2E-1, 2 | `chooseOfferAsync` (a person is asked about a punisher). `pickTutorAsync` uses `tutorFits`. |

## Tests and data

| File | Change |
|---|---|
| `tests/repairs.mjs` (new) | 37 tests across the Phase 2E increments, each with a rules-25 check where a reading changed. |
| `tests/known-defects.json` (new) | 12 verified defects that coverage can't see. |
| `tests/coverage.mjs` | Scores `card.v26` and only the effects that play at the current rules; reads `known-defects.json`. |
| `tests/mechanics.mjs` | One test (Palantír's mill) pinned to rules 25, the version its mechanic belongs to. At rules 26 Palantír's mill sits inside the punisher, tested in `repairs.mjs`. |
| `tests/golden.mjs` | Plays rules 25 as well; `tests/golden-games.json` adds the rules-26 games. |
| `tests/card-readings.json` | Accepted reading changes, each diff reviewed card by card before `--update`. |
| `tests/card-coverage.md`, `public/data/coverage.json` | Regenerated. |
| `.github/workflows/selftest.yml` | Runs `tests/repairs.mjs`. |
| `ROADMAP.md`, `README.md`, `CLAUDE.md`, `VERSION` | Item 391, the user note, the new test line, 1.63.0. |
| `audit/phase-2e/` | This report set and `tools/verify.mjs`. |
