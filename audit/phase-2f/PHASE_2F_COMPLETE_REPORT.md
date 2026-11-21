# Phase 2F — Completion of Partially Simulated Cards

Baseline: 1.63.0 (rules 26, commit `e40f2f7`, branch `replay-exactness`). Result: **1.64.0, rules 27**. Every behaviour change is gated behind `g.rules >= 27` or an effect marked `since: 27`; older readings are kept with `until: 27`. Golden games at rules 4–26 are unchanged.

Companion files: `PHASE_2F_CARD_COMPLETION.csv` (one record per card), `PHASE_2F_MECHANIC_IMPLEMENTATION.md`, `PHASE_2F_TEST_RESULTS.md`, `PHASE_2F_REMAINING_GAPS.md`, `PHASE_2F_CHANGELOG.md`, `PHASE_2F_ROLLBACK_NOTES.md`. Tools: `tools/fx.mjs` (print a card's reading), `tools/completion.mjs` (rebuild the CSV), `tools/coverage-1.63.0.json` (the pre-2F coverage data).

**Phase 2F is not complete.** 55 of the 421 cards are now fully simulated; 358 are still partially simulated. The sections below say what was done, what was found, and why the rest is left.

## The 421 cards

The 421 are the cards the 1.61.0 coverage report (`audit/phase-2d/tools/coverage-1.61.0.json`) classed "partially simulated" (411 partial + 10 with an unhandled field).

| Classification | 1.61.0 (original) | 1.63.0 (before 2F) | 1.64.0 (now) |
|---|---|---|---|
| Fully simulated | — | 3 | **55** |
| Needs interaction testing | — | 2 | 2 |
| Partially simulated | 421 | 416 | **358** |
| Incorrectly simulated | — | 0 | 6 |
| Not simulated | — | 0 | 0 |

- **Reassessed first.** 5 of the 421 had already been completed in Phases 2D/2E (3 fully simulated, 2 needing an interaction test). They were not reworked.
- **52 moved to fully simulated in Phase 2F.** Each has its whole text read and handled at rules 27 and is named in a passing test (`tests/completions.mjs`). For the families completed here, the tests run the card through the effect, the activation or the cast. "Fully simulated" here means no known gap is left; it doesn't prove every interaction (see the test limits).
- **6 are now incorrectly simulated.** That isn't a regression: it is defects found while completing them, recorded in `tests/known-defects.json` so a test naming the card can't mark it complete. They are Inspiring Call (draws for every creature), Incubation Druid (any color), Summon: Knights of Round ("other" not read), Will of the Jeskai (mode 1 misread), Lagomos (its "activate only if" restriction is now visible), and Jeweled Amulet (its mana restriction is now visible).
- **358 are still partially simulated.** Most have one-of-a-kind text (see `PHASE_2F_REMAINING_GAPS.md`).

## What was done, by increment

| Increment | Work | Cards reached |
|---|---|---|
| 2F-1 Multi-ability and incomplete effects | **Follow-up sentences** (`them27`): a sentence whose subject is what the sentence before just created, returned, targeted or changed ("Those creatures gain vigilance until end of turn", "Untap it", "That token gains haste … and attacks this combat if able", "Those permanents phase out", "Put an indestructible counter on each of them"). The engine records what each effect touched (`g.touched27`). **A card's second "whenever you cast" line** no longer replaces its first (`onCast27`). **"Tapped and attacking"** for creatures put onto the battlefield from hand (Ilharg). | Felidar Retreat, Sokenzan, Shore Up, Magic Damper, Octopus Form, Gift of the Viper, Virtue of Loyalty, Valley Floodcaller, Loyal Apprentice, Siege-Gang Lieutenant, Legion Warboss, Howlsquad Heavy, Ovika, Wake the Past, Slip Out the Back, Summon: Knights of Round, Silver Shroud Costume, Jeskai Ascendancy, Ilharg; also Sneak Attack, Whip of Erebos, Dalkovan Encampment (not in the 421) |
| 2F-2 Modal and repeating effects | **Kicked "… instead" with another number** ("create five of those tokens instead", "put two of those cards into your hand instead"). Modal and repeat-process cards were assessed; none was completed (see remaining gaps). | Rite of Replication, Consult the Star Charts |
| 2F-3 Additional costs and optional choices | **Channel cost reduction**: "This ability costs {1} less to activate for each legendary creature you control" (`less27`, `Game.cycleCost`). **Boseiju's compensation**: the controller of the destroyed permanent may search for a land with a basic land type. **Otawara's bounce** ("artifact, creature, enchantment, or planeswalker") was not read at all and now is. | Boseiju, Otawara, Takenuma, Eiganjo, Sokenzan |
| 2F-4 Temporary effects and delayed triggers | **Delayed end-step actions** on specific permanents: sacrifice, exile or return to hand "at the beginning of the next end step", or "your next end step" (`g.endLater27`, checked against the permanent's timestamp so one that left and came back is left alone). | Urabrask's Forge, Lagomos, Flameshadow Conjuring, Puppeteer Clique, Ilharg; Sneak Attack, Mimic-style follow-ups |
| 2F-5 Graveyard, exile and library | **Counterspell destinations**: exile (Force of Negation) and the top of the library (Memory Lapse); a flashback spell is still exiled (702.34a). **The Enduring cycle** returns as an enchantment, not a creature. Before, the cards never returned at all: "if it was a creature" was checked against a missing object, and is now checked against the card's last-known information. **Granted flashback**: "the flashback cost is equal to its mana cost" was already modelled (`mana.js`). It is now recognized, and a person chooses Snapcaster Mage's card. | Force of Negation, Memory Lapse, the five Enduring cards, Snapcaster Mage, Past in Flames, Flashback, Lier |
| 2F-6 Counters, tokens, dynamic characteristics | Covered through 2F-1 (indestructible counters on each of them, hasty and temporary tokens). Counter moving and doubling, and dynamic token characteristics, were not done. | Summon: Knights of Round |
| 2F-7 Continuous effects and keywords | **A color chosen as a land enters** (Thriving lands, Uncharted Haven, Crossroads Village, Valgavoth's Lair): mana only of those colors (before: any color). **"Choose a creature type"** as a spell resolves (`chooseType27`; a person is asked). Distant Melody and Harmonized Crescendo draw per permanent of that type (before: one card); Kindred Dominance spares that type (before: destroyed every creature); Pact of the Serpent counts it (before: 0). **Conditional mana amounts** (`cond27`): Urza lands, Ilysian Caryatid, Incubation Druid. | 8 lands, 4 spells, 5 mana cards |
| 2F-8 Verification | **The coverage checker had two blind spots**: (1) an activated ability's sentences always counted as read, because the ability keeps a copy of its text; (2) in a line whose first sentence starts with a cost, an unread effect was never reported. Both are fixed (`effects.js droppedSentences`). The fix shows real gaps that were hidden, among them Wishclaw Talisman's "an opponent gains control of this artifact", Urza, Lord High Artificer's free play, and 38 unread "activate only if/during" restrictions. Verification tests were added for every completed family. | All 3,500 cards re-scored |

## Defects found that were not in the original list

- **Sneak Attack** (top-1000 card): the creature never gained haste and was never sacrificed. The readings counted the sentences as read (blind spot 1). It is fixed by 2F-1 and tested, for both the AI and a person.
- **The Enduring cycle** never returned to the battlefield at rules 25–26. Fixed.
- **Distant Melody, Harmonized Crescendo, Kindred Dominance and Pact of the Serpent** played wrongly. They drew one card, destroyed every creature, or counted nothing. Fixed.
- **Wishclaw Talisman, Urza Lord High Artificer, Castle Garenbrig, Idol of Oblivion, Fabled Passage** and others: their gaps are now reported (2F-8). They are not fixed.

## Whole-pool coverage (3,500 cards)

| Status | 1.63.0 | 1.64.0 |
|---|---|---|
| full | 2,816 | 2,795 |
| partial | 423 | 406 |
| restriction | 53 | 86 |
| incorrect | 65 | 70 |
| unhandled | 4 | 4 |
| unsupported | 139 | 139 |
| **fully simulated (class)** | 273 | **328** |

"Full" went **down** even though cards were completed. This is deliberate: the checker fix moved cards whose abilities were never really read out of "full". The partial count fell by 17 and the restriction count rose by 33. Those restrictions were hidden before, so these cards play stronger than printed. That rise isn't new breakage. It is honest reporting.

## Method

1. Ran all 23 CI suites on the baseline (all passed; `PHASE_2F_TEST_RESULTS.md`).
2. Mapped the 421 to their status at 1.63.0. Grouped the unread text into mechanic families. Worked family by family, most cards and most-played first.
3. For each family, traced the reader (`effects.js`) and the engine handler, and extended an existing mechanic where one existed. The delayed end step reuses the `endSac` approach, the counter destination extends `toExile`/`toHand`, and the type choice reuses `chosenType`/`bestType`. A new mechanic was added only where nothing existed (`them27`).
4. Gated every change at rules 27, reviewed the card-readings diff card by card before accepting it, and checked that golden games at rules 4–26 are unchanged.
5. Tested each family: normal use, illegal targets, a missing resource, conditions on and off, several opponents where relevant, a person's choice, the AI, and rules 26.
6. Reclassified only after verification. Cards with a defect found by hand went to `tests/known-defects.json`.

## Not claimed

- Phase 2F's objective (every verified partial card completed) **is not met**: 358 of the 421 remain partially simulated, 6 are known-incorrect, and 2 need an interaction test.
- Cards that are now "fully simulated" are verified for the behaviour their tests exercise. Interactions with other cards (for example, them27 together with replacement effects such as Rest in Peace on a sacrificed token) were not tested exhaustively; that is Phase 2G's scope.
- The browser self-test (selftest.html) and the interface test (uitest.html) were **not run** in this session (`PHASE_2F_TEST_RESULTS.md`).
