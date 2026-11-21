# Phase 2D — Implementation Report

Reusable mechanics implemented from the Phase 2B gap analysis and the Phase 2C audit (`audit/phase-2c`). Baseline 1.61.0 (rules 24, commit `b45b0e4`); result 1.62.0, **rules 25**.

Companion files: `PHASE_2D_TEST_RESULTS.md`, `PHASE_2D_CARD_IMPACT.csv`, `PHASE_2D_REMAINING_GAPS.md`, `PHASE_2D_CHANGELOG.md`, `PHASE_2D_ROLLBACK_NOTES.md`.

## How every change is kept safe

- **One new rules version (25).** Every behaviour change is checked with `g.rules >= 25`, or is an effect marked `since: 25`. Where a card was read wrongly before, the old reading stays on the card marked `until: 25`, so a game at rules 4–24 (every saved replay) plays exactly as before. The golden games prove it: the 120 recorded games at rules 4–24 are unchanged; only the 6 new rules-25 games were added.
- **The existing mechanism is extended rather than replaced.** Conditions go through `parseCond` and `evalCond`. Targets go through `targetFits` and `legalTargets`. Mana goes through `units`, `spendOk` and `planPayment`. Permissions go through `castModeRaw`, `mayPlay` and `gyCast`. Replacements go through `replacements.js`. No module was rewritten.
- **No randomness was added.** The one new shuffle (hideaway's random bottom order) uses the game's seeded `g.rand`. The determinism check (3 seeds replayed in the opposite order) and the fuzz replays are identical.
- **No card-name branches.** Every mechanic is read from card text, and each one reaches every card whose words match. The card-impact CSV lists the cards each mechanic reached.

## 2D-1 — Conditional effects and target legality (Critical)

| Mechanic | Rules | Source | What it does | Limitations |
|---|---|---|---|---|
| An unread condition is never met | 608.2c, 601.2f | `triggers.js evalCond` case `'?'` | From rules 25 an unread condition is false in every context. Before, it counted as met outside resolution, so a cost reduction or graveyard permission applied for free. | A card whose condition is still unread now does less than printed, and this is reported. |
| "This way" conditions | 608.2c | `zones.js move` records each zone change in `g.trail`; `resolve.js runEffects` keeps a trail per resolving ability; `triggers.js evalCond` `'way'` and `wayMatch`; `effects.js cond25` | "If a creature is destroyed this way" (destroyed then exiled by Rest in Peace still counts), "if you exiled a land card this way", "an Insect card was milled this way", "a Desert was returned this way", "you put a Cave onto the battlefield this way", and "if you can't" after a sacrifice. When the condition names an object, the branch's "it" is that object (Noxious Gearhulk gains the destroyed creature's toughness). | Only zone changes are recorded. "Dealt damage this way" (Marauding Raptor) is not, because that card's damage is still unread. |
| Last-known information | 608.2h, 603.10a | `zones.js move` stores `o.lki` (counters, named counters, power, toughness, types, some keywords) as a permanent leaves; `evalCond` `'lki'`; `mana.js dynValue` `trigT` | "It had no counters on it", "it had a revival / -1/-1 counter", "its toughness was less than 1", "it didn't have decayed". | Keywords kept: decayed, flying, deathtouch, lifelink, trample, haste. |
| Costs paid | 601.2h | `engine.js cast` and `sacTo` keep the zone changes made while paying (`o.costMoves`); `evalCond` `'cost'` | "The sacrificed creature's toughness was 4 or greater", "the sacrificed creature was legendary", "the discarded card wasn't a land card". | Only the first matching paid object is checked. |
| Cast history | 601.2 | `engine.js cast` stores `castAlt`, `castPhase`, `castActive`, `castX`, and `p.castCounts` (casts by name this game) | "If the {1}{B} cost was paid", "if you cast this during your main phase", Approach of the Second Sun ("cast from your hand and you've cast another spell named ~"). Also adds an effect that puts a card into its owner's library seventh from the top (`libraryPos`, `zones.js move` `fromTop`). | — |
| "Then if …" | 608.2c | `effects.js parseEffects` | The condition used to be dropped and the effect done always. That affected Court of Garenbrig, Jace, Wielder of Mysteries (which won unconditionally), Mechanized Production, Ocelot Pride, Replicating Ring, Treasure Map and Hour of Promise. Now the effect is an `if` (since 25), and the old reading is kept until 25. | — |
| Intervening if | 603.4 | `triggers.js flushTriggers15`, `interveningFails` | An ability that is a single "if" with no "otherwise" is checked when it triggers (false: it doesn't go on the stack, and this is logged), and again when it resolves. | Not checked at trigger time: "this way" conditions, costs, coin flips, X and cast history, which are all about the resolution itself. |
| "An opponent draws" | — | `effects.js readRiders` → `drawLose` with `who: 'an opponent'` | Baleful Mastery's drawback was read as you drawing. Now the opponent its controller chooses draws (the one with the fewest cards in hand, then the next in turn order). | A person is not asked which opponent. |
| Target words beyond the battlefield | 115.1, 608.2b | `effects.js` (`tr25` and the `TR25` kinds), `resolve.js targetFits` → `wordsFit` and `boundOf` | Words on graveyard targets (Persist's "nonlegendary creature card", plus its -1/-1 counter) and on the creature an Equipment attaches to (Mithril Coat's "legendary creature you control"). Mana value limits that are counted: "≤ cards in its controller's graveyard" (Drown in the Loch) and "X or less" (Thieving Skydiver, Kozilek's Command). The AI, a person's menu and resolution all use the same test. | `attachSelf` still has the engine pick among the allowed creatures; it is not a targeted choice. |
| Counterspell limits | 115.1, 608.2b | `resolve.js counterFits(g, e, item, p)` | "That targets a permanent / creature you control" (Not of This World), and a mana value limit counted from the graveyard. | Checked on resolution and by the AI. Checked for spells only, not for abilities on the stack. |

## 2D-2 — Mana restrictions and other-zone permissions (Critical)

| Mechanic | Rules | Source | What it does | Limitations |
|---|---|---|---|---|
| Spend restrictions per mana line | 106.6 | `effects.js` (`manaLines.spend` → `fx.mana.spend25`, `spendWords`); `mana.js manaColors25`, `spendFits`, `units` | A color that only a restricted line adds may pay only for spells (or abilities of sources) that fit the words: legendary, creature of the chosen type, artifact, Dragon, instant or sorcery, colorless Eldrazi. Mana tapped by hand carries the restriction into the pool. "That spell can't be countered" travels with the mana (Delighted Halfling), reusing Cavern of Souls' flag. | A restriction the words don't cover ("monocolored spells of that color", Throne of Eldraine) is marked unread, and that mana is never spent. Plaza of Heroes' third ability (colors among your legends) is still unread. A second line's larger amount is still lost (Fanatic of Rhonas, Eldrazi Temple, Shrine). |
| Activation conditions on mana lines | 605.1a | `manaLines.cond25` → `fx.mana.cond25`, read by `parseCond` | "Activate only if you control a Dragon" (Mox Jasper), "a Plains or an Island" (Verges, Nimbus Maze), "this land entered this turn" (Mirrex, new `enteredTurn` condition). | — |
| Mana kept all turn | 106.4 | `effects.js` `keep25` on `addMana`/`addManaN`; pool units get `keepTurn`; `engine.js setPhase` | Birgi, Savage Ventmaw, Klauth, Karn, Legacy Reforged, Rousing Refrain. | Klauth's "spend only on spells" is not applied to that mana. |
| "Play from the top of your library" misreading fixed | 305.1, 601.2 | `effects.js` (`notTop25`, `gyLands`, `flash25`, `free25`); `mana.js topPlayable`, `castTimingOk`, `castModeRaw`; `engine.js gyLandOk`, `playLand`; `ai.js chooseLand`; `human.js mainPhase` | Lines without "top of your library" no longer allow playing from the library. "You may play lands from your graveyard" (Crucible of Worlds, Ramunap, Conduit) now uses the land drop. "Cast X spells as though they had flash" (Yeva, Liberator, Sigarda's Aid, Gandalf the White) and "cast spells from your hand without paying their mana costs" (Omniscience, Dracogenesis) now work as written. | Omniscience makes X spells cost X=0, so they are not offered free. |
| Graveyard casting limits | 601.2 | `effects.js gyWords25`; `resolve.js gyCastTurn`; `mana.js castModeRaw`; `engine.js cast` | "A creature spell" means one creature spell (Chainer); "target Zombie creature card" means that card (Zul Ashur); Emry's choice is one card. | Chainer's "activate only once each turn" is not enforced on the ability itself. |
| Cards cast from another player's zone | 601.2a | `engine.js cast` | Fixes an existing bug: casting a card from another player's exile searched the caster's own zone and removed the caster's last exiled card. | — |

## 2D-3 — Additional costs and dynamic X (High)

| Mechanic | Rules | Source | What it does | Limitations |
|---|---|---|---|---|
| Converge | 702.? / 601.2h | `mana.js convergeOf` (from the payment plan), `engine.js cast` (`convergeN`), dynamic value `converge` | Counts the most different colors the spent mana can count as. A copy counts 0 (707.10). | — |
| More "X, where X is" values | 107.3 | `effects.js whereX25` (wrapped `r25`), `mana.js dynValue` | Creatures exiled / destroyed / milled "this way" (from the trail), a die roll's result (`ctx.roll`), greatest power among other creatures, creatures of the chosen type a target player controls, a type an opponent controls, the trigger's amount, and the first part of a clause followed by ", and …" (Palantír). | Pact of the Serpent's chosen type depends on the spell having one (not tested). |
| "Enters with X counters, where X is …" | 614.1c | `fx.entersX25`, `engine.js` permanent resolution | Prime Speaker Zegana. | — |
| Batch amounts | 603.2c | `triggers.js fire` | "One or more creatures … deal combat damage" now adds up that batch's damage to that player (Quartzwood Crasher). | — |
| Optional non-mana costs | 118.3, 603.12 | `effects.js parseEffects` (`mayCost`); `resolve.js` `mayCost`; `ai.js costWorth` and `effectValue` | "You may discard a card / sacrifice a creature / pay {E}{E}{E} / pay N life / exile a card from your graveyard. When/If you do, …". The cost is paid only if it can be paid in full. The AI weighs gain against cost; a person is asked. This reached 17 cards: Grist's -2 now needs a sacrifice, Springbloom Druid needs a land, and Wilhelt's end-step draw needs a Zombie. | A reflexive "when you do" trigger resolves at once, with no chance to respond in between. Inti's inner counter is still unread. |

## 2D-4 — Counters, tokens and delayed effects (High)

| Mechanic | Rules | Source | What it does | Limitations |
|---|---|---|---|---|
| Tokens for "that player" / "each player", with their own riders | 111.2, 603.7 | `effects.js` pattern and `readRiders` (`forWho25`, `name25`, `temp25`; abilities in quotes no longer bind to the source); `resolve.js token`; `zones.js createToken` (name) | Rite of the Raging Storm gives the upkeep player a 5/1 trample, haste Lightning Rager that is sacrificed at the end step. Before, the Rite sacrificed itself. | "Creatures named Lightning Rager can't attack you" is still unread. |
| Triggers granted until end of turn | 611.2 | `resolve.js grantWatch`, `o.tempWatch`; `triggers.js fire` | Hunter's Insight: "whenever that creature deals combat damage to a player this turn, draw that many". | Only the combat-damage-to-a-player shape is read. |
| "Doesn't untap during its controller's next untap step" | 502.3 | `effects.js` `frozen25`; `resolve.js tap` (reuses `exerted`) | Junk Winder, and any "tap target … it doesn't untap" text. | — |
| Counter replacements | 616.1 | see 2D-6 | — | Moving counters between permanents is **not implemented** (see remaining gaps). |

## 2D-5 — Graveyard, exile and library (High)

| Mechanic | Rules | Source | What it does |
|---|---|---|---|
| Permissions from dig, mill, discard and graveyard exile | 601.2, 305.1 | `effects.js` (`exileOne25`, `play25`, `castFrom25`, `returnEnd25`, `forever25`); `resolve.js` dig, mill, exileTrigCard, exileGy, impulse; `mana.js castModeRaw` (a card in a graveyard with `mayPlay`); `engine.js gyLandOk`, `playLand` (`castOnly`), end-step return; `ai.js` candidate list | Expressive Iteration exiles one card that is playable this turn. Containment Construct and Tablet of Discovery let you play the moved card this turn. Mnemonic Betrayal lets you cast opponents' cards (lands excluded) and returns the rest at the end step. Valakut Exploration's permission lasts while the card is exiled. The AI now considers casting cards with a graveyard permission and cards in other players' exile. |

Limitation: Mnemonic Betrayal's "mana of any type can be spent" is not applied.

## 2D-6 — Replacement effects (High)

| Mechanic | Rules | Source | What it does |
|---|---|---|---|
| +1/+1 counter replacement on other creatures | 616.1 | `fx.counterBonus25`, `resolve.js moreCounters` | Benevolent Hydra, ordered with Hardened Scales-style effects for the most counters. |
| Enter replacement in place of a cost | 614.1c, 614.12 | `fx.moxDiamond25`; `engine.js cast` (no discard on casting), permanent resolution (discard as it enters, or it goes to the graveyard); `mana.js castModeRaw` (the AI casts it only with a land in hand) | Mox Diamond. |

Damage redirection, target redirection and prevention shields were not changed (see remaining gaps).

## 2D-7 — Continuous effects and riders (High)

| Mechanic | Rules | Source | What it does |
|---|---|---|---|
| Protection in place of hexproof | 702.16 | `protect` with `prot25`, `o.tempProt` | Giver of Runes: protection from the color the AI picks (`protColorChoice`), or from colorless. |
| "Can't be regenerated" with Damn's wording | 701.15 | `noRegen25` | — |
| "It can't be blocked this turn" after a counter | 509.1 | `counters` with `unblock25` | Kappa Cannoneer. |
| No loyalty abilities | 606.3 | `fx.noLoyalty25`, `engine.js loyaltyLocked` and `activatePW`, `ai.js` | The Immortal Sun. |
| "Can't attack a player it already attacked this turn" | 508.1c | `fx.attackOnce25`, `combat.js` | Port Razer, Bloodthirster. |

Type, color and P/T layer changes were not changed (see remaining gaps).

## 2D-8 — Keyword mechanics (Medium)

| Keyword | Rules | Source | What it does | Limitations |
|---|---|---|---|---|
| Hideaway | 702.75 | `hideaway` and `playHidden` effects; `o.hiddenExile` hides the card from other seats; conditions `attackedN` (per-turn attacker count) and `oppDealtN` (damage dealt per turn) | The card is exiled face down and the rest go to the bottom in a random order (seeded). It is played later for free when the condition holds; a land uses a land play. Cards: Mosswort Bridge, Windbrisk Heights, Spinerock Knoll. | Cemetery Tampering's mill-three structure is still unread. |
| Escalate | 702.120 | `fx.escalateCost25`, `engine.js cast` | The most useful mode, then more modes while their escalate cost can be paid (Collective Resistance). | Non-mana escalate costs (Collective Effort: tap a creature) are not implemented. A person still picks one mode. |
| Copy Plus (Twinning Staff) | 707.10 | `resolve.js copySpell` | One more copy for each such permanent. | Only copies made by `copySpell`. Storm, cascade and other copy sources are not covered. |
| Abundance | 614.6 | `replacements.js drawDefs`, `zones.js draw` | Reveal until a land or nonland card; that card goes to hand without counting as a draw; the rest go to the bottom. | Always applied, never optional. A person gets nonland. |
| Strive | 702.? | — | **Not implemented**: multiple targets with a per-target cost (see remaining gaps). | — |

## Coverage after Phase 2D

`node tests/coverage.mjs`: full 2,743 → **2,809**; incorrect + restriction 197 → **125**; unhandled 10 → 4; fully simulated (full and named in a test) 212 → **258**.

Three coverage checks were adjusted, each only where a test proves the behaviour: Giver of Runes' protection (`prot25`), "enters with X where X is" (`entersX25`), and play permissions that are now read (`one25`, `n25`, `exileOne25`, `castFrom25`, `flash25`, `flashTurn`; the last was a Phase 2C false positive).

Three cards moved full → incorrect partway through, because a "then if" condition they had silently skipped became visible. All three were then read (Jace, Replicating Ring, Treasure Map) and tested.
