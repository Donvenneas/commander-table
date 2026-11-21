# Phase 2D — Rollback Notes

## The quickest safe rollback: play at rules 24

Every Phase 2D behaviour is gated on rules 25: `g.rules >= 25`, `since: 25`, or an old reading kept with `until: 25`. A game created with `{ rules: 24 }` plays exactly as 1.61.0 did. Saved replays carry their own rules version, so **replays need no rollback**.

To turn Phase 2D off for new games without touching the code, set `export const RULES = 24;` in `public/js/engine.js`. Readings still contain the `*25` fields, but nothing reads them below rules 25. Golden games at rules 4–24 are unchanged (`node tests/golden.mjs`).

## Finding one increment

Every change carries a comment with its increment: `(Phase 2D-1 …)` to `(Phase 2D-8 …)`.

```powershell
git grep -n "Phase 2D-3" -- public/js
```

Each increment's fields and effect kinds:

| Increment | Reading fields / kinds (effects.js) | Engine places |
|---|---|---|
| 2D-1 | `cond.r25`, `tr25`, `minus25`, `targetsMine`, `mv25`, `libraryPos`, `drawLose who:'an opponent'`, "then if" `if` with `since: 25` | `triggers.js evalCond` (`'?'`, way, lki, cost, altPaid, castMain, castAgain, libEmpty), `interveningFails`, `zones.js move` (lki, trail), `resolve.js runEffects` (trail), `wordsFit`, `counterFits`, reanimate, regrow, attachSelf, `engine.js cast` (cast records) |
| 2D-2 | `fx.mana.spend25`, `fx.mana.cond25`, `keep25`, `notTop25`, `gyLands`, `flash25`, `free25`, `gyCastTurn one25/n25/types25/subs25` | `mana.js manaColors25`, `spendFits`, `spellFits`, `units`, `castTimingOk`, `castModeRaw`, `topPlayable`; `engine.js setPhase`, `gyLandOk`, `playLand`; owner-zone fix in `cast`; `ai.js chooseLand`; `human.js mainPhase` |
| 2D-3 | `xw {dyn:'r25'}`, `entersX25`, `mayCost` (old effects `until: 25`) | `mana.js dynValue`, `convergeOf`; `resolve.js roll`, `mayCost`, `copySpell` (copy: true); `triggers.js fire` (batch damage); `ai.js costWorth` |
| 2D-4 | token `forWho25`, `name25`, `temp25`; `sacSelf`/`exileSelf` in quotes `until: 25`; `grantWatch`; `frozen25` | `resolve.js token`, `grantWatch`, `tap`; `triggers.js fire` (`tempWatch`); `zones.js createToken` |
| 2D-5 | `exileOne25`, `play25`, `castFrom25`, `returnEnd25`, `forever25` | `resolve.js` dig, mill, exileTrigCard, exileGy, impulse; `mana.js castModeRaw` (graveyard `mayPlay`); `engine.js` end-step `endReturn25`; `ai.js` candidates |
| 2D-6 | `counterBonus25`, `moxDiamond25` | `resolve.js moreCounters`; `engine.js cast` and permanent resolution; `mana.js castModeRaw` |
| 2D-7 | `prot25`, `unblock25`, `noRegen25`, `attackOnce25`, `noLoyalty25` | `resolve.js protect`, `counters`, destroy; `combat.js`; `engine.js loyaltyLocked`, `activatePW`; `ai.js` |
| 2D-8 | `hideaway`, `playHidden` (old dig `until: 25`), `escalateCost25`, Abundance, Copy Plus | `resolve.js hideaway`, `playHidden`, `copySpell`; `engine.js cast` (escalate); `replacements.js drawDefs`; `zones.js draw`; `combat.js` attack count; `resolve.js damagePlayer` (damage per turn) |

## Reverting one increment

1. Remove that increment's engine branches: each sits behind `g.rules >= 25` or `this.rules >= 25`, so deleting the branch restores 1.61.0 behaviour for that mechanic.
2. Remove the reading fields from `effects.js`. Where an old reading was kept with `until: 25`, remove the new effect **and** the `until: 25` mark together. Otherwise the card loses its effect at every rules version.
3. Run `node tests/cards.mjs`. The diff should list only that increment's cards (see `PHASE_2D_CARD_IMPACT.csv`). Accept with `--update`.
4. Remove or skip that increment's section of `tests/mechanics.mjs` (sections are headed `// ==== 2D-n`).
5. Run `node tests/golden.mjs`. Rules 4–24 must not differ; accept rules-25 changes with `--update`.
6. Run the full regression list in `PHASE_2D_TEST_RESULTS.md` and the browser self-test.

## Dependencies between increments

- 2D-3's "this way" counts (Sunfall) use 2D-1's trail.
- 2D-3's optional costs use `ai.js costWorth`.
- 2D-5's graveyard permissions reuse 2D-2's `gyLandOk` and `castModeRaw` branches.
- 2D-8's hideaway conditions use 2D-1's `cond25`.
- 2D-6's Mox Diamond is independent.
- The owner-zone fix in `engine.js cast` (2D-5) is needed by Mnemonic Betrayal. Without it, casting an opponent's exiled card removes the caster's own last exiled card (a 1.61.0 bug that still applies at rules ≤ 24).

## Whole-phase rollback with git

All Phase 2D work is uncommitted on branch `replay-exactness`, with HEAD at `b45b0e4`:

```powershell
git stash push -- public/js tests .github ROADMAP.md README.md VERSION CLAUDE.md
```

After it is committed, revert the Phase 2D commit instead (`git revert <commit>`).
