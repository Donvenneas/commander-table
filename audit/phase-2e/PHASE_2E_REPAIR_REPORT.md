# Phase 2E — Repair Report

Repairs of the incorrect simulations verified in Phase 2C (`audit/phase-2c`) and of further defects found while repairing. Baseline: 1.62.0 (rules 25, uncommitted Phase 2D work on top of `b45b0e4`). Result: **1.63.0, rules 26**.

Companion files: `PHASE_2E_TEST_RESULTS.md`, `PHASE_2E_CARD_VERIFICATION.csv`, `PHASE_2E_REMAINING_DEFECTS.md`, `PHASE_2E_CHANGELOG.md`, `PHASE_2E_ROLLBACK_NOTES.md`.

## Method

1. **Re-check before repairing.** The Phase 2C runtime probes (`audit/phase-2c/probes`) were run again at rules 25 to see which defects were still live after Phase 2D:
   - Still live: Gilded Drake, Combustible Gearhulk, Charming Scoundrel, Kozilek's Command, Not Dead After All, Chandra's Ignition, Court of Vantress, Terastodon, Springheart Nantuko, Artifact Mutation, Maelstrom of the Spirit Dragon's tutor, Delay, Inti.
   - Probe artifacts, not defects: Painful Truths, Approach and Witch's Oven show as "DEFECT" because those probes resolve the card without casting it or paying its cost; `tests/mechanics.mjs` covers them properly.
2. **Trace to the shared cause.** Several defects turned out to be shared reader or engine bugs, and fixing them reached more cards than the ones listed. A line-by-line regex patch on one card was avoided wherever a shared mechanic was the cause.
3. **Gate behind rules 26.** Every behaviour change is checked with `g.rules >= 26`, or is an effect marked `since: 26`. The older reading is kept marked `until: 26`, or as the card's base reading when the fix needed a second reading (`card.v26`). Golden games at rules 4–25 are unchanged.
4. **Test both sides.** Every repair has a test in `tests/repairs.mjs` covering normal use, an illegal or missing target, missing resources, several opponents where relevant, a person's choice where there is one, and the rules-25 behaviour.

## Repairs by increment

### 2E-1 Targets and conditional effects

| Repair | Rules | Original problem | Root cause | Code | Verified |
|---|---|---|---|---|---|
| **Exchange of control** (Gilded Drake, Volatile Stormdrake) | 701.12 | The Drake was sacrificed and never exchanged (Critical) | The reader turned "exchange control of ~ and …" into nothing and kept only "sacrifice ~" | `effects.js` (`exchange`, `sacUnlessExchanged`; old `sacSelf` kept `until: 26`); `resolve.js` (`exchange`: both on the battlefield and under different controllers, else nothing; `sacUnlessExchanged`); `legalTargets`; `ai.js` target and value | Swap with an opponent's creature; no target or a target that left means sacrifice; own creature not a legal target; AI picks the opponent's best; rules 25 unchanged |
| **"This ability still resolves if its target becomes illegal"** | 608.2b | A triggered ability with every target illegal was removed, so Gilded Drake wasn't sacrificed | `triggers.js resolveAbility` had no exception for this wording | `effects.js` (`resolvesAnyway26`), `triggers.js resolveAbility` | The target leaves in response; the ability resolves and the Drake is sacrificed |
| **Punisher choice** (Combustible Gearhulk, Palantír of Orthanc) | 608.2d | Always drew; the opponent was never asked (High) | "Target opponent may have you draw N. If the player doesn't, …" was read as an unconditional draw | `effects.js` (`offer`, `punisherRest`; `wayMv`, the total mana value of cards this ability milled); `resolve.js offer`; `ai.js chooseOffer` (counts only, never the hidden library); `human.js chooseOfferAsync` | High life: refuse, take the mill and damage. Low life: let the draw happen. A person is asked, and only the targeted player of four takes damage. Palantír's X equals its influence counters. Rules 25 unchanged. |
| **Optional opponent draw** (Tataru Taru) | — | You drew twice | "target opponent may draw a card" was read as your draw | `effects.js` → `drawLose` for the target opponent | You draw one and the targeted opponent draws one |
| **Real target for Chandra's Ignition** | 115.1, 608.2b | The engine used your best creature, ignoring the caster's choice | `ignition` had no target | `effects.js needsTargetIn` (`ignition` from rules 26), `legalTargets`, `resolve.js ignition`, `ai.js` | The chosen creature deals the damage; an opponent's creature is not legal; if the target leaves, there is no damage (no substitute) |

### 2E-2 Costs, mana and other-zone permissions

| Repair | Rules | Original problem | Root cause | Code | Verified |
|---|---|---|---|---|---|
| **"Activate only once each turn"** (Beledros Witherbloom, Quirion Ranger, Wirewood Symbiote, Ramos, Chainer, Steel Hellkite) | 602.5b | Any number of activations a turn (cEDH combo pieces: Beledros untapping lands, Quirion and Symbiote loops) | The reader skips the sentence (`parseEffects` "limits on how often … don't change what it does") and no engine check existed | `engine.js canActivateRaw`, `activate` (`o.onceUsed26` by ability text) | The second activation is refused, allowed again next turn; rules 25 allows more |
| **Search words** (26 tutors) | 701.19 | A tutor found any card of the type: Natural Order and Green Sun's Zenith found non-green creatures; Maelstrom of the Spirit Dragon found anything | `searchEffect` kept only card types | `effects.js searchEffect` (`subs26`: colors, subtypes, legendary, non-…); `resolve.js tutorFits` (the one test used by the AI's `pickTutor`, a person's `pickTutorAsync` and resolution) | Natural Order: only green. Maelstrom: a Dragon, or nothing. A person is offered only allowed cards. Rules 25 unchanged. |
| **Mana of any type** (Mnemonic Betrayal) | 609.4b | Colored costs still needed their colors | No permission option for it | `effects.js` (`anyMana26`); `resolve.js exileGy`; `mana.js costOf` (colored symbols paid as generic) | An opponent's Lightning Bolt cast with an Island |
| **A second reading for non-legendary cards whose first word was taken for their name** | — | Artifact Mutation didn't destroy; Spell Swindle didn't counter; Urza's Tower/Mine lost "Urza's Mine"; Eldrazi Temple lost "Eldrazi"; Black Dragon Gate, Hanweir Battlements | `cleanText` treats a card's first word as its short name (meant for legends: "Loran") and replaced "artifact" in "destroy target artifact" | `effects.js cleanText(…, noShort)`, `shortNameMisread`; `scryfall.js normalize` (`card.v26`, as `v8` is for rules 8); `engine.js mk` uses `v26` from rules 26; `coverage.mjs` scores `v26` | Artifact Mutation destroys and makes 5 Saprolings; rules 25 doesn't destroy. Spell Swindle reads `counter, treasure`. |

### 2E-3 Stack, copies and modes

| Repair | Rules | Original problem | Root cause | Code | Verified |
|---|---|---|---|---|---|
| **Delay** | 702.62 | A hard counter | The suspend sentence starts with "If", so it was read as an unread condition with no effect | `effects.js` analyze pass (`suspend26`); `resolve.js counter` (exile with time counters, owner's suspended list) | Countered, exiled, 3 time counters, suspended |
| **Render Silent** | — | The rider was dropped | — | `silenceCtl26` | The controller can't cast spells this turn |
| **Copy of a chosen target** (Court of Vantress, Yenna) | 707.2 | They copied themselves | "a copy of it" fell back to the source; the "choose target …" sentence produced nothing | `effects.js parseEffects` (choose-target pre-pass); `copyToken` with `tr`/`tr24` | Court copies Sol Ring; Yenna copies an enchantment you control; an opponent's is not legal |
| **Mode text** (Charming Scoundrel) | — | Its loot mode drew without discarding | Bullet text kept a leading space, so patterns that start a sentence missed | `effects.js bulletEffects` (trimmed reading, `since: 26`; never adds a mode the old list didn't have; drops +0/+0 duplicates) | Hand size kept, one card discarded |
| **Token abilities in quotes** (Kozilek's Command, Awakening Zone, Pawn of Ulamog and 9 more Spawn/Scion makers) | 111.4 | The source added {C} itself; the token had no ability | The quoted "Sacrifice this token: Add {C}" was read as the source's effect | `effects.js` (`text26`; quoted effects `until: 26`; "target player creates …"); `zones.js createToken` (the token's text, read by `tokenFx`) | Kozilek's Command makes 3 Spawn with a sacrifice-for-{C} ability and adds no mana; rules 25 still adds mana |

### 2E-4 Triggers and delayed effects

| Repair | Rules | Original problem | Code | Verified |
|---|---|---|---|---|
| **End of combat; roll again** (Delina, Wild Mage) | 511, 706 | Delina exiled itself (fixed to "nothing" in 2D) and made no tokens | `effects.js` roll rows (copy row, `rollAgain26`); `resolve.js roll` (reroll loop, `ctx.share26`), `copyToken` (tapped, attacking, non-legendary, `endCombat26`); `combat.js` end of combat | On 1–14: one attacking copy, exiled after combat. On 15–20: a copy per roll, all of the same creature. Rules 25 unchanged. |
| **Dies trigger granted until end of turn** (Not Dead After All, Undying Malice, Feign Death) | 603.6c, 611.2 | Nothing happened | `effects.js` (`grantDies26` with tapped and counter); `resolve.js`; `zones.js move` (queues the return as it dies); `returnSelf` `tapped26` | Returns tapped this turn, not next turn; Undying Malice adds a +1/+1 counter under its owner's control; Not Dead After All can't target an opponent's creature |

### 2E-5 Zones and 2E-7 Combat

| Repair | Rules | Original problem | Code | Verified |
|---|---|---|---|---|
| **Terastodon** | 603.10a, 608.2c | ETB not read | `effects.js` line reading (`remove` ×3 with up-to targets, `tokenPerWay26`); `resolve.js tokenPerWay26` (the 2D trail gives each permanent's controller) | Three destroyed across two opponents: 2 + 1 Elephants; creatures not legal; rules 25 does nothing |
| **"No more than one creature can attack ~ each combat"** (The Eternal Wanderer) | 506.6 | Unread | `effects.js` (`attackSelfCap26`), `combat.js` (the strongest attacker stays) | Only Craterhoof attacked |
| **"Creatures named Lightning Rager can't attack you"** (Rite of the Raging Storm) | 508.1c | Unread | `noAttackNamed26`, `combat.js` | The Rager can't attack the Rite player and can attack another |

## Coverage changes

- `tests/coverage.mjs` scores the reading games use at the current rules: `card.v26` where there is one. Effects kept only for older replays (`until ≤ RULES`) are left out of the misread checks. Without this, Combustible Gearhulk stayed "incorrect" for its old reading.
- `tests/known-defects.json` lists defects found by hand that the regex checks can't see. Coverage keeps those cards "incorrect" with the reason, so naming them in a test can't make them "fully simulated". There are 12 entries: Kozilek's Command, Sunfall, Springheart Nantuko, Inti, Delina, Shatterskull Smashing, Court of Garenbrig, Abdel Adrian, Marauding Raptor, Fanatic of Rhonas, Throne of Eldraine, Great Hall of the Citadel.
- Result: full 2,809 → **2,816**, fully simulated 258 → **273**, incorrectly simulated 125 → **118**. That last number went up from 115 because of the known-defects list.
- Of the 197 Phase 2C cards: 41 fully simulated, 27 need interaction testing, 11 partially simulated, **118 incorrectly simulated**.

## False positives (reclassified)

These six Phase 2C entries are not defects in the flagged mechanic:
- Emergence Zone and Alchemist's Refuge: flash for a turn works.
- Sepulchral Primordial: works.
- Training Grounds, Forensic Gadgeteer and Zirda: the one-mana floor is enforced by `engine.js abilityCost`.

Biomancer's Familiar keeps its other, unread ability.

## Not claimed

Not all 197 cards are fixed. `PHASE_2E_CARD_VERIFICATION.csv` gives each card's status. **78 are not addressed**, mostly abilities that are not read at all. 12 have a known defect left. 60 were reached by a shared mechanic without a card-specific test.
