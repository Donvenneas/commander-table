# Phase 2E — Rollback Notes

## Without touching the code: rules 25

Every Phase 2E behaviour change is gated: `g.rules >= 26`, effects marked `since: 26`, old readings kept with `until: 26`, and the second card reading `card.v26` is used only from rules 26 (`engine.js mk`).

Setting `export const RULES = 25;` in `public/js/engine.js` makes new games play as 1.62.0 did. Saved replays carry their own rules version and need nothing. `node tests/golden.mjs` shows rules 4–25 unchanged.

## Finding a repair

```powershell
git grep -n "Phase 2E-3" -- public/js
```

| Increment | Reading fields and kinds (effects.js, scryfall.js) | Engine places |
|---|---|---|
| 2E-1 | `offer`, `exchange`, `sacUnlessExchanged`; Tataru Taru's `drawLose`; ignition in `needsTargetIn` | `resolve.js` handlers and `legalTargets`; `ai.js` `chooseOffer` and targets; `human.js chooseOfferAsync`; `mana.js wayMv` |
| 2E-2 | `subs26`; `anyMana26`; `cleanText noShort`, `shortNameMisread`, `card.v26` | `engine.js canActivateRaw`/`activate` (once each turn), `mk`; `resolve.js tutorFits`, `exileGy`; `mana.js costOf`; `ai.js`/`human.js` tutor pickers |
| 2E-3 | `suspend26`, `silenceCtl26`, `resolvesAnyway26`, choose-target `copyToken`, `bulletEffects`, `text26`, "target player creates" | `resolve.js counter`; `triggers.js resolveAbility`; `zones.js createToken` |
| 2E-4 | roll rows (`copyRow`, `rollAgain26`), `grantDies26` | `resolve.js roll`, `copyToken`, `rollAgain26`, `grantDies26`, `returnSelf`; `combat.js` end of combat; `zones.js move` |
| 2E-5 | Terastodon line (`tokenPerWay26`) | `resolve.js tokenPerWay26` |
| 2E-7 | `attackSelfCap26`, `noAttackNamed26` | `combat.js` |

## Reverting one repair

1. Delete its engine branch: each is behind a rules-26 check.
2. Delete its reading fields. Where an old reading was marked `until: 26`, remove the new effect and the `until: 26` mark together; otherwise the card loses its effect at every rules version.
3. Run `node tests/cards.mjs`. The diff should list only that repair's cards; accept with `--update`.
4. Remove that repair's tests from `tests/repairs.mjs` (sections are headed `// ==== 2E-n`), and its entry in `tests/known-defects.json` if any.
5. Run `node tests/golden.mjs` (rules 4–25 must not differ), the full suite list in `PHASE_2E_TEST_RESULTS.md`, and the browser self-test.

## Dependencies

- Gilded Drake's sacrifice relies on two pieces together: `sacUnlessExchanged` and the "still resolves" exception in `triggers.js`. Revert them together.
- Punishers use the Phase 2D trail (`ctx.trail`) for `wayMv`, and Terastodon uses it for `tokenPerWay26`.
- The coverage changes (`current()`, `card.v26`, `known-defects.json`) only change the report, not games.
- The second card reading (`card.v26`) lives on the card object, the way `card.v8` does for rules 8.

## Whole phase

Phases 2D and 2E are uncommitted on branch `replay-exactness` (HEAD `b45b0e4`). After committing, revert the Phase 2E commit with `git revert <commit>`. Before that, `git stash push -- public/js tests .github ROADMAP.md README.md CLAUDE.md VERSION` removes both phases' changes together.
