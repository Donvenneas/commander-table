# Phase 2C — Incorrect Card Simulation Audit

Round 2, Phase 2C. Baseline: Commander Table **1.61.0** (rules 24), branch `replay-exactness`, commit `b45b0e4`. No game code, card data or tests were changed for this audit. The probes in `probes/` only read the project.

Companion files: `PHASE_2C_CARD_DEFECTS.csv` (one row per card, sortable), `PHASE_2C_ROOT_CAUSE_ANALYSIS.md`, `PHASE_2C_IMPLEMENTATION_ROADMAP.md`, `PHASE_2C_TEST_REQUIREMENTS.md`.

## Summary

| | Cards |
|---|---:|
| Cards in the "incorrectly simulated" class (coverage 1.61.0) | **197** (110 `incorrect` + 87 `restriction`) |
| Cards audited individually | **197 (100%)** |
| **Confirmed defect** (wrong behaviour shown by a probe, or by the card reader's output and the handler it runs) | **133** |
| **Incomplete implementation** (an ability or line is not read at all; the reading proves it is missing) | **57** |
| **Suspected defect** (not proven) | **1** (Resonating Lute) |
| **Unable to verify** | **0** |
| **Not a defect in the flagged part** (coverage false positive) | **6** (Emergence Zone, Alchemist's Refuge, Sepulchral Primordial, Training Grounds, Forensic Gadgeteer, Zirda) |

Every one of the 197 cards has at least one gap: the 6 false positives are false only for the mechanic the coverage check flagged (Biomancer's Familiar is counted under Incomplete because its other ability is unread, with the floor part noted as a false positive).

How the 190 defective or incomplete cards play compared with the printed card:

| Plays | Cards | Why it matters |
|---|---:|---|
| **Stronger than printed** | 45 | The worst kind: the AI and people get a better card than exists (free counterspells, unrestricted mana, no drawbacks). |
| **Weaker than printed** | 121 | The card under-performs; 57 of these are abilities that are simply not read. |
| **Different from printed** | 25 | Neither; the card does something else (Delina exiles herself, Rite sacrifices itself, Gilded Drake never swaps). |

Severity (excluding false positives): **Critical 4**, **High 22**, **Medium 77**, **Low 88**.

Critical: Drown in the Loch (counters/destroys anything), Not of This World (costs 0 and counters anything), Gilded Drake (sacrifices itself, never exchanges), Approach of the Second Sun (can never win).

### What this audit found that the coverage classes do not show

1. **Most of the "restriction" class does not play stronger.** The class means "an unread restriction: plays stronger than printed", but `tests/coverage.mjs` (RESTRICTION, l.52) puts a card there whenever any unread text contains words like "activate only", "can't" or "don't". Of its 87 cards only **27** play stronger; **47** play weaker (whole abilities not read, such as Fanatic of Rhonas's {G}{G}{G}{G}, Steel Hellkite's {X} ability and most of Toxrill; mana that empties too early; riders that would help their controller, such as Orim's Chant's kicker), **10** play differently and **3** are false positives. In the "incorrect" class, 18 of 110 play stronger and 74 weaker.
2. **Four coverage flags are false positives** (the flagged mechanic works): flash-for-a-turn (Emergence Zone, Alchemist's Refuge; probe P28), Sepulchral Primordial (P30), and the "can't reduce to less than one mana" floor, which `engine.js abilityCost` already enforces (P39: Training Grounds, Forensic Gadgeteer, Zirda; Biomancer's Familiar partly).
3. **Chandra's Ignition's coverage reason is wrong in the other direction**: it can never be aimed at an opponent's creature; the real defect is that the caster's chosen creature is ignored (P26).
4. **A misreading outside the 197 affects 13 cards the coverage calls "full"** (RC20): the reader turns "You may play lands from your graveyard" and "You may cast … spells as though they had flash" into *play from the top of your library*. Crucible of Worlds and Ramunap Excavator play lands from the library top instead of the graveyard (the engine has no land-from-graveyard path, engine.js l.886); Omniscience lets you cast from the top of your library and does **not** make hand spells free; Yeva, Sigarda's Aid and Borne Upon a Wind give top-of-library casting instead of flash. Probe `probes/probe2.mjs`.
5. **Unread conditions are treated as met outside resolution** (RC02): at rules 24 an unread "if" does nothing when it resolves, but `triggers.js evalCond` returns true when it is checked anywhere else. Not of This World costs {0} (P04) and The Indomitable can always be cast from the graveyard (P05). A scan of all 3,500 cards found only these two cards on this path today, but the path stays open for any new card.
6. **Clauses bound to the wrong object** (RC13, a family Phase 2B does not list): a token's "exile/sacrifice this token" is read as the source exiling or sacrificing itself (Delina P01, Rite of the Raging Storm P02); "a token that's a copy of it" falls back to the source (Court of Vantress P27, Yenna); Springheart Nantuko copies itself and the land (P34); Artifact Mutation makes Saprolings without destroying anything (P35).

## Method

For each of the 197 cards:

1. **Oracle text** from `tests/cards-snapshot.json` (the coverage snapshot), shown in full in Part 1.
2. **Recognition and construction:** the card was run through the real reader (`scryfall.js normalize` → `effects.js`), and its reading (fx), its unread lines and its dropped sentences were compared with the Oracle text line by line (tools: `probes/dump.mjs`).
3. **Execution:** the effect kinds in the reading were traced to their handlers in `resolve.js`, `triggers.js`, `mana.js`, `engine.js` and `replacements.js` (targets: `resolve.js legalTargets/targetFits/targetLegal`; costs: `mana.js costOf/castModeRaw/spendOk`; conditions: `triggers.js evalCond`; stack and resolution: `resolve.js runEffects`).
4. **Runtime probes:** 41 small boards built with `tests/scenario.mjs` from real cards, running the engine's own effect resolution, casting checks and cost code at the current rules version (`probes/probe.mjs`, `probe2.mjs`, `probe3.mjs`). 42 cards were probed directly and 18 more share a probed code path with no card-specific branch.
5. **Cross-card scan:** each confirmed misreading pattern was searched for across all 3,500 snapshot cards (`probes/scan.mjs`) to find cards outside the 197 with the same problem.

Rules for the finding status: **Confirmed** only when a probe showed the wrong result, or when the reading contains a definite wrong or missing effect and the handler it reaches was read and has no branch that could correct it. **Incomplete** when the line is listed as unread by the reader itself (no handler can run). **Suspected** when the outcome depends on code that was not traced to the end. No card is called fixed.

Limits: the probes call effect resolution directly (`resolveEffects`) for triggered and activated abilities, so they test the effect, not the trigger's timing on a full turn; timing claims (H) rest on the code trace. The browser self-test, golden games and fuzz games were not run, because nothing was changed.

## Part 3: runtime probes

| Probe | Card | Expected | Actual (engine) |
|---|---|---|---|
| P01 | Delina, Wild Mage | Roll 1-14: tapped attacking token copy; Delina stays | Roll 8: Delina exiled, no token |
| P02 | Rite of the Raging Storm | Upkeep: 5/1 Lightning Rager for that player; Rite stays | Rite sacrificed, nothing created |
| P03 | Noxious Gearhulk | Destroy Craterhoof, gain 9 | Destroyed, life 40 → 40 |
| P04 | Not of This World | Costs {7} with nothing to counter | Cost {generic:0} |
| P05 | The Indomitable | Not castable from graveyard without three tapped Pirates/Vehicles | castModeRaw returns a mode (castable) |
| P06 | Painful Truths | Draw X, lose X (X = colors spent) | Draws 0, loses 0 |
| P07 | Gilded Drake | Exchange control with Craterhoof | Drake sacrificed, no exchange |
| P08 | Charming Scoundrel | Loot: hand size unchanged | Hand 2 → 3, nothing discarded |
| P09 | Drown in the Loch | Craterhoof (MV 8) illegal with an empty graveyard | Legal target |
| P10 | Thieving Skydiver | Gilded Lotus (MV 5) illegal with X = 1 | Legal target |
| P11 | Approach of the Second Sun | Can win; else seventh from top and gain 7 | Never wins; gains 7; no library placement in the reading |
| P12 | Eldrazi Monument | Sacrificed with no creatures | Stays |
| P13 | Combustible Gearhulk | Opponent chooses | Always draws 3 |
| P14 | Baleful Mastery | Alt cost: an opponent draws | Opponent draws 0 |
| P15 | Hunter's Insight | Draw later from combat damage | Immediate draw; no delayed trigger |
| P16 | Sunfall | Incubator token with X counters | No token survives |
| P17 | Court of Garenbrig | No doubling when not the monarch | Counters 2 → 4 |
| P18 | Mithril Coat | Attach only to a legendary creature | Attached to Grizzly Bears |
| P19 | Delighted Halfling | Colored mana only for legendary spells | Lightning Bolt castable |
| P20 | Chainer, Nightmare Adept | Only creature spells from graveyard | Lightning Bolt castable from graveyard |
| P21 | Unstoppable Slasher | Returns with two stun counters | Stays in graveyard |
| P22 | Inti, Seneschal of the Sun | Discard → counter on an attacker | Nothing happens |
| P23 | Witch's Oven | Two Food for toughness ≥ 4 | Always one |
| P24 | Kozilek's Command | X Spawn tokens | Adds one {C}, no tokens |
| P25 | Not Dead After All | Creature returns when it dies | Stays dead |
| P26 | Chandra's Ignition | Chosen creature (Bears, 2) deals the damage | Craterhoof used instead (P2 life 35) |
| P27 | Court of Vantress | Token copy of Sol Ring | Token copy of Court of Vantress |
| P28 | Emergence Zone | Flash this turn | Works (flashNow) — false positive |
| P29 | Prime Speaker Zegana | Enters with 5 counters (Craterhoof) | Enters with 0 |
| P30 | Sepulchral Primordial | Reanimates from each opponent | Works — false positive |
| P31 | Giver of Runes | Protection from a color/colorless | Hexproof only |
| P32 | Terastodon | ETB destroys up to three | ETB unread |
| P33 | Persist | Only nonlegendary, with a -1/-1 counter | Sheoldred returned, no counter |
| P34 | Springheart Nantuko | Unattached: one 1/1 Insect | Tokens: Springheart Nantuko and Forest copies |
| P35 | Artifact Mutation | Destroy Gilded Lotus, 5 Saprolings | Lotus stays, 5 Saprolings |
| P36 | Great Hall of the Citadel | {T}: {C} only | {T}: any color, Bolt castable |
| P37 | Mox Jasper | No mana without a Dragon | Bolt castable |
| P38 | Birgi | Mana kept until end of turn | Pool 1 → 0 at the next phase |
| P39 | Training Grounds | {2} ability costs {1} | {1} — floor works (false positive) |
| P40 | Maelstrom of the Spirit Dragon | Tutor only a Dragon | Tutored Lightning Bolt |
| P41 | Delay | Counter, exile with suspend | Reading is a plain hard counter |
| probe2 | Crucible of Worlds, Omniscience, Yeva | Graveyard lands / free hand spells / flash | Library-top play for all three (RC20) |

## Part 4 in brief (details in PHASE_2C_ROOT_CAUSE_ANALYSIS.md)

| Root cause | Cards in the 197 | Phase 2B workstream |
|---|---:|---|
| RC15 Whole ability not read | 60 | per mechanic (incomplete) |
| RC01 Unread "if" at resolution | 38 | P0 Conditional evaluation |
| RC03 Mana spend restrictions | 23 | P0 Mana restrictions |
| RC13 Clause bound to wrong object / wrong effect | 18 | **new** (not in 2B) |
| RC12 Rider sentence dropped | 18 | P2 Continuous / P1 Combat |
| RC04 Conditional / second mana abilities | 15 | P0 Mana restrictions |
| RC08 Cast/play permissions | 13 | P0 Cast/play permissions |
| RC14 Static prohibitions | 13 | P2 Continuous / P1 Combat |
| RC09 Dynamic X | 11 | P1 Dynamic X |
| RC06 Target qualifiers | 9 | P0 Target legality |
| RC21 Coverage false positive | 8 | audit tooling |
| RC07 Engine-chosen target | 7 | P0 Target legality |
| RC10 Multi/divided targets | 7 | P0 Target legality |
| RC11 Player choice not asked | 7 | P0 Conditional (result) |
| RC19 Counter movement | 6 | P1 Counters |
| RC05 Persistent mana | 5 | P0 Mana restrictions |
| RC02 Unread condition counts as met | 3 | P0 Conditional evaluation |
| RC16 Replacement as cost / unread | 3 | P1 Replacement |
| RC18 Random results / modal constraints | 3 | P2 Special mechanics |
| RC20 Play-from-top misread | 2 (+13 "full" cards) | P0 Cast/play permissions |
| RC17 Protection read as hexproof | 1 | P2 Continuous |

(A card can have several root causes.)

## Part 1 and 2: every card (197)

Sorted by popularity rank (the # in the coverage snapshot). Each entry gives the coverage flag that put the card in this group, the Oracle text, what the rules say should happen, what the engine does, the failure classes (A-R), the root causes (RC01-RC21, explained in PHASE_2C_ROOT_CAUSE_ANALYSIS.md) and the evidence. "P" numbers are runtime probes run for this audit (listed in Part 3); "R" means the card reader's output (fx JSON) was inspected and the handler that would run was traced; "T" means a code trace only.

### #141 Delighted Halfling

- **Finding:** Confirmed defect · **Severity:** High · **Plays:** stronger than printed
- **Coverage:** restriction — Spend this mana only to cast a legendary spell, and that spell can't be countered.
- **Oracle text:** {T}: Add {C}. / {T}: Add one mana of any color. Spend this mana only to cast a legendary spell, and that spell can't be countered.
- **Expected:** Colored mana only for legendary spells, which can't be countered.
- **Actual:** Any color for anything (Lightning Bolt castable); no uncounterability.
- **Failure classes:** F (Incorrect mana or additional cost payment)
- **Root cause:** RC03 Spend restrictions on mana not modelled; extra mana lines merged
- **Source:** effects.js mana-line reader (l.2060-2100) keeps only fx.mana.only creatureSpell/creatureAbility and cavern; the colors of every mana line are unioned into one fx.mana; mana.js spendOk (l.38) knows two restrictions
- **Evidence:** P19
- **Same root cause:** Secluded Courtyard; Unclaimed Territory; Plaza of Heroes; Throne of Eldraine; Haven of the Spirit Dragon; Codsworth, Handy Helper; Giada, Font of Hope; Gwenna, Eyes of Gaea; Great Hall of the Citadel; Maelstrom of the Spirit Dragon; Power Depot; Klauth, Unrivaled Ancient and 10 more

### #216 Secluded Courtyard

- **Finding:** Confirmed defect · **Severity:** High · **Plays:** stronger than printed
- **Coverage:** restriction — Spend this mana only to cast a creature spell of the chosen type or activate an ability of a creature source of the chosen type.
- **Oracle text:** As this land enters, choose a creature type. / {T}: Add {C}. / {T}: Add one mana of any color. Spend this mana only to cast a creature spell of the chosen type or activate an ability of a creature source of the chosen type.
- **Expected:** Colored mana only for chosen-type creature spells/abilities.
- **Actual:** Any color for anything.
- **Failure classes:** F (Incorrect mana or additional cost payment)
- **Root cause:** RC03 Spend restrictions on mana not modelled; extra mana lines merged
- **Source:** effects.js mana-line reader (l.2060-2100) keeps only fx.mana.only creatureSpell/creatureAbility and cavern; the colors of every mana line are unioned into one fx.mana; mana.js spendOk (l.38) knows two restrictions
- **Evidence:** P19 (same path)
- **Same root cause:** Delighted Halfling; Unclaimed Territory; Plaza of Heroes; Throne of Eldraine; Haven of the Spirit Dragon; Codsworth, Handy Helper; Giada, Font of Hope; Gwenna, Eyes of Gaea; Great Hall of the Citadel; Maelstrom of the Spirit Dragon; Power Depot; Klauth, Unrivaled Ancient and 10 more

### #232 Mithril Coat

- **Finding:** Confirmed defect · **Severity:** Medium · **Plays:** stronger than printed
- **Coverage:** incorrect — "target (non)legendary" is not read
- **Oracle text:** Flash / Indestructible / When Mithril Coat enters, attach it to target legendary creature you control. / Equipped creature has indestructible. / Equip {3}
- **Expected:** ETB: attach to target legendary creature you control; no legendary creature = stays unattached.
- **Actual:** attachSelf attaches to the AI's best own creature, legendary or not; no target is chosen, so hexproof/protection/fizzle never apply.
- **Failure classes:** E (Incorrect targeting or target legality), N (Incorrect ownership or controller handling)
- **Root cause:** RC07 Engine-chosen object replaces a printed target
- **Source:** resolve.js attachSelf (l.1432 bestOwn), ignition (l.1569 bestOwnCreature), doubleCounters (l.1205 bestOwn), draw dyn maxPower
- **Evidence:** P18
- **Same root cause:** Chandra's Ignition; Silver Shroud Costume; Celestial Armor; Mjölnir, Storm Hammer; Soul's Majesty; The Aetherspark

### #242 Mox Diamond

- **Finding:** Confirmed defect · **Severity:** Medium · **Plays:** differently from printed
- **Coverage:** restriction — If you don't, put it into its owner's graveyard.
- **Oracle text:** If this artifact would enter, you may discard a land card instead. If you do, put this artifact onto the battlefield. If you don't, put it into its owner's graveyard. / {T}: Add one mana of any color.
- **Expected:** Replacement on entering: discard a land or it goes to the graveyard.
- **Actual:** Modelled as an additional casting cost: the land is lost if Mox is countered, and Mox can't be cast with no land in hand.
- **Failure classes:** F (Incorrect mana or additional cost payment), K (Incorrect replacement or prevention), I (Incorrect zone movement)
- **Root cause:** RC16 Replacement effects modelled as costs or not read
- **Source:** Mox Diamond read as addCost discard; +1 counter replacement and draw replacement unread
- **Evidence:** R (addCost)
- **Same root cause:** Benevolent Hydra; Out of the Tombs

### #245 Unclaimed Territory

- **Finding:** Confirmed defect · **Severity:** Medium · **Plays:** stronger than printed
- **Coverage:** restriction — Spend this mana only to cast a creature spell of the chosen type.
- **Oracle text:** As this land enters, choose a creature type. / {T}: Add {C}. / {T}: Add one mana of any color. Spend this mana only to cast a creature spell of the chosen type.
- **Expected:** Colored mana only for chosen-type creature spells.
- **Actual:** Any color for anything.
- **Failure classes:** F (Incorrect mana or additional cost payment)
- **Root cause:** RC03 Spend restrictions on mana not modelled; extra mana lines merged
- **Source:** effects.js mana-line reader (l.2060-2100) keeps only fx.mana.only creatureSpell/creatureAbility and cavern; the colors of every mana line are unioned into one fx.mana; mana.js spendOk (l.38) knows two restrictions
- **Evidence:** P19 (same path)
- **Same root cause:** Delighted Halfling; Secluded Courtyard; Plaza of Heroes; Throne of Eldraine; Haven of the Spirit Dragon; Codsworth, Handy Helper; Giada, Font of Hope; Gwenna, Eyes of Gaea; Great Hall of the Citadel; Maelstrom of the Spirit Dragon; Power Depot; Klauth, Unrivaled Ancient and 10 more

### #316 Guardian Project

- **Finding:** Confirmed defect · **Severity:** Medium · **Plays:** weaker than printed
- **Coverage:** incorrect — an "if" the reader can't read (rules 17: that part does nothing and is reported; before: treated as true)
- **Oracle text:** Whenever a nontoken creature you control enters, if it doesn't have the same name as another creature you control or a creature card in your graveyard, draw a card.
- **Expected:** Draw when a uniquely named nontoken creature enters.
- **Actual:** Never draws.
- **Failure classes:** G (Incorrect conditions or restrictions)
- **Root cause:** RC01 Unread "if" condition at resolution
- **Source:** effects.js parseCond (l.626, cond17 l.708) returns {c:"?"}; triggers.js evalCond case "?" (l.453) returns !ctx.resolving; resolve.js runEffects case "if" (l.943) forces the else branch or skips
- **Evidence:** P03/P21 (same path)
- **Same root cause:** Arena of Glory; Springheart Nantuko; Spelunking; Padeem, Consul of Innovation; Approach of the Second Sun; Tataru Taru; Noxious Gearhulk; Combustible Gearhulk; Liberator, Urza's Battlethopter; Carpet of Flowers; Bonehoard Dracosaur; Baleful Mastery and 25 more

### #344 Damn

- **Finding:** Confirmed defect · **Severity:** Low · **Plays:** weaker than printed
- **Coverage:** restriction — A creature destroyed this way can't be regenerated.
- **Oracle text:** Destroy target creature. A creature destroyed this way can't be regenerated. / Overload {2}{W}{W} (You may cast this spell for its overload cost. If you do, change "target" in its text to "each.")
- **Expected:** Destroyed creatures can't be regenerated.
- **Actual:** Rider dropped: regeneration still works.
- **Failure classes:** D (Incorrect effect resolution)
- **Root cause:** RC12 Rider sentences dropped (restrictions and riders)
- **Source:** effects.js droppedSentences (l.2453): "can't be regenerated", "can't block", "doesn't untap", "can't cast spells", kicker riders, suspend riders
- **Evidence:** R
- **Same root cause:** Shatterskull Smashing // Shatterskull, the Hammer Pass; Silver Shroud Costume; Mjölnir, Storm Hammer; Plaguecrafter; Sundering Eruption // Volcanic Fissure; Kappa Cannoneer; Koma, Cosmos Serpent; Planar Genesis; Orim's Chant; Junk Winder; Taunt from the Rampart; Single Combat and 5 more

### #366 Arena of Glory

- **Finding:** Confirmed defect · **Severity:** Low · **Plays:** weaker than printed
- **Coverage:** incorrect — an "if" the reader can't read (rules 17: that part does nothing and is reported; before: treated as true)
- **Oracle text:** This land enters tapped unless you control a Mountain. / {T}: Add {R}. / {R}, {T}, Exert this land: Add {R}{R}. If any of that mana is spent on a creature spell, it gains haste until end of turn. (An exerted permanent won't untap during your next untap step.)
- **Expected:** Creature cast with its mana gains haste.
- **Actual:** Never grants haste.
- **Failure classes:** G (Incorrect conditions or restrictions)
- **Root cause:** RC01 Unread "if" condition at resolution
- **Source:** effects.js parseCond (l.626, cond17 l.708) returns {c:"?"}; triggers.js evalCond case "?" (l.453) returns !ctx.resolving; resolve.js runEffects case "if" (l.943) forces the else branch or skips
- **Evidence:** R
- **Same root cause:** Guardian Project; Springheart Nantuko; Spelunking; Padeem, Consul of Innovation; Approach of the Second Sun; Tataru Taru; Noxious Gearhulk; Combustible Gearhulk; Liberator, Urza's Battlethopter; Carpet of Flowers; Bonehoard Dracosaur; Baleful Mastery and 25 more

### #391 Dauthi Voidwalker

- **Finding:** Incomplete implementation · **Severity:** High · **Plays:** weaker than printed
- **Coverage:** incorrect — "you may play/cast … this turn" is not read / {t}, sacrifice ~: choose an exiled card an opponent owns with a void counter on it. you may play it this turn without paying its mana cost.
- **Oracle text:** Shadow (This creature can block or be blocked by only creatures with shadow.) / If a card would be put into an opponent's graveyard from anywhere, instead exile it with a void counter on it. / {T}, Sacrifice this creature: Choose an exiled card an opponent owns with a void counter on it. You may play it this turn without paying its mana cost.
- **Expected:** Void-counter exile replacement; {T}, sacrifice: play one void-counter card an opponent owns this turn, free.
- **Actual:** Replacement read (oppGyExile); the activated ability is not read at all, so the free cast never happens.
- **Failure classes:** C (Effect never executes), I (Incorrect zone movement), J (Incorrect counters or token handling)
- **Root cause:** RC15 Whole ability not read (incomplete implementation); RC08 Temporary cast/play permissions missing or too broad
- **Source:** effects.js parseCard leaves the line in fx.unread; coverage.mjs RESTRICTION (l.52) labels the card "restriction" (stronger) when the unread text merely contains "activate only"/"can't" — resolve.js dig/exileTrigCard/exileGy/mill create no mayPlay; gyCastTurn (l.1911) stores types only, so empty types = every nonland card, unlimited; mana.js castModeRaw (l.510)
- **Evidence:** R: abilities [] ; unread list holds the {T} line
- **Same root cause:** Nesting Grounds; Destiny Spinner; Skrelv, Defector Mite; Endurance; Guide of Souls; Terastodon; Avatar's Wrath; Resourceful Defense; Kozilek, the Great Distortion; Fire Nation Palace; March of Swirling Mist; Druid Class and 57 more

### #401 Fanatic of Rhonas

- **Finding:** Incomplete implementation · **Severity:** Medium · **Plays:** weaker than printed
- **Coverage:** restriction — Ferocious — {T}: Add {G}{G}{G}{G}. / Activate only if you control a creature with power 4 or greater.
- **Oracle text:** {T}: Add {G}. / Ferocious — {T}: Add {G}{G}{G}{G}. Activate only if you control a creature with power 4 or greater. / Eternalize {2}{G}{G} ({2}{G}{G}, Exile this card from your graveyard: Create a token that's a copy of it, except it's a 4/4 black Zombie Snake Druid with no mana cost. Eternalize only as a sorcery.)
- **Expected:** Ferocious: {G}{G}{G}{G}.
- **Actual:** Only {G}; the second ability is dropped (weaker, not stronger as the class implies).
- **Failure classes:** F (Incorrect mana or additional cost payment)
- **Root cause:** RC04 Conditional or second mana abilities dropped or made unconditional; RC15 Whole ability not read (incomplete implementation)
- **Source:** effects.js mana lines: manaLines need only for MANA_COND words (l.48); "a Dragon", "entered this turn", "ferocious", "corrupted", "three lands with the same name", second {C}{C} lines are dropped while the color is still added — effects.js parseCard leaves the line in fx.unread; coverage.mjs RESTRICTION (l.52) labels the card "restriction" (stronger) when the unread text merely contains "activate only"/"can't"
- **Evidence:** R
- **Same root cause:** Tablet of Discovery; Plaza of Heroes; Floodfarm Verge; Bleachbone Verge; Throne of Eldraine; Shrine of the Forsaken Gods; Eldrazi Temple; Nimbus Maze; Great Hall of the Citadel; Urza's Workshop; Sceptre of Eternal Glory; Mox Jasper and 61 more

### #460 Plaza of Heroes

- **Finding:** Confirmed defect · **Severity:** Medium · **Plays:** stronger than printed
- **Coverage:** restriction — Spend this mana only to cast a legendary spell.
- **Oracle text:** {T}: Add {C}. / {T}: Add one mana of any color. Spend this mana only to cast a legendary spell. / {T}: Add one mana of any color among legendary permanents you control. / {3}, {T}, Exile this land: Target legendary creature gains hexproof and indestructible until end of turn.
- **Expected:** Any color only for legendary spells; colors of your legends.
- **Actual:** Any color for anything.
- **Failure classes:** F (Incorrect mana or additional cost payment)
- **Root cause:** RC03 Spend restrictions on mana not modelled; extra mana lines merged; RC04 Conditional or second mana abilities dropped or made unconditional
- **Source:** effects.js mana-line reader (l.2060-2100) keeps only fx.mana.only creatureSpell/creatureAbility and cavern; the colors of every mana line are unioned into one fx.mana; mana.js spendOk (l.38) knows two restrictions — effects.js mana lines: manaLines need only for MANA_COND words (l.48); "a Dragon", "entered this turn", "ferocious", "corrupted", "three lands with the same name", second {C}{C} lines are dropped while the color is still added
- **Evidence:** P19 (same path)
- **Same root cause:** Delighted Halfling; Secluded Courtyard; Unclaimed Territory; Throne of Eldraine; Haven of the Spirit Dragon; Codsworth, Handy Helper; Giada, Font of Hope; Gwenna, Eyes of Gaea; Great Hall of the Citadel; Maelstrom of the Spirit Dragon; Power Depot; Klauth, Unrivaled Ancient and 22 more

### #465 Chandra's Ignition

- **Finding:** Confirmed defect · **Severity:** Medium · **Plays:** differently from printed
- **Coverage:** incorrect — "target … you control" is not read (a person could aim it at an opponent's permanent)
- **Oracle text:** Target creature you control deals damage equal to its power to each other creature and each opponent.
- **Expected:** Caster chooses target creature they control; it deals damage equal to its power to each other creature and each opponent.
- **Actual:** No target: resolve.js ignition uses bestOwnCreature, so the chosen creature is ignored (Craterhoof used instead of the chosen Bears). The coverage note "could aim at an opponent's permanent" is wrong: it never uses an opponent's creature.
- **Failure classes:** E (Incorrect targeting or target legality)
- **Root cause:** RC07 Engine-chosen object replaces a printed target; RC21 Coverage classification false positive
- **Source:** resolve.js attachSelf (l.1432 bestOwn), ignition (l.1569 bestOwnCreature), doubleCounters (l.1205 bestOwn), draw dyn maxPower — MISREAD regexes match words in the reading JSON (e.g. "play|until" for flash permission); RESTRICTION does not know engine.js abilityCost floors at one mana
- **Evidence:** P26
- **Same root cause:** Mithril Coat; Silver Shroud Costume; Celestial Armor; Mjölnir, Storm Hammer; Soul's Majesty; The Aetherspark; Emergence Zone; Alchemist's Refuge; Sepulchral Primordial; Training Grounds; Forensic Gadgeteer; Biomancer's Familiar and 1 more

### #498 Birgi, God of Storytelling // Harnfel, Horn of Bounty

- **Finding:** Confirmed defect · **Severity:** High · **Plays:** weaker than printed
- **Coverage:** restriction — creatures you control can boast twice during each of your turns rather than once. / Until end of turn, you don't lose this mana as steps and phases end.
- **Oracle text:** Whenever you cast a spell, add {R}. Until end of turn, you don't lose this mana as steps and phases end. / Creatures you control can boast twice during each of your turns rather than once.
- **Expected:** Mana stays until end of turn; boast twice.
- **Actual:** Mana empties at the next phase change.
- **Failure classes:** F (Incorrect mana or additional cost payment), P (Incorrect cleanup, expiration or delayed effects)
- **Root cause:** RC05 Mana that persists through steps and phases; RC15 Whole ability not read (incomplete implementation)
- **Source:** engine.js setPhase (l.319) empties every pool except keepRed — effects.js parseCard leaves the line in fx.unread; coverage.mjs RESTRICTION (l.52) labels the card "restriction" (stronger) when the unread text merely contains "activate only"/"can't"
- **Evidence:** P38
- **Same root cause:** Savage Ventmaw; Klauth, Unrivaled Ancient; Karn, Legacy Reforged; Rousing Refrain; Dauthi Voidwalker; Nesting Grounds; Destiny Spinner; Skrelv, Defector Mite; Endurance; Guide of Souls; Terastodon; Avatar's Wrath and 51 more

### #534 Emergence Zone

- **Finding:** Not a defect (classification false positive) · **Severity:** Low · **Plays:** as printed (for the flagged part)
- **Coverage:** incorrect — "you may play/cast … this turn" is not read
- **Oracle text:** {T}: Add {C}. / {1}, {T}, Sacrifice this land: You may cast spells this turn as though they had flash.
- **Expected:** Spells castable as though they had flash this turn.
- **Actual:** flashTurn sets p.flashNow; works. Flagged only because the MISREAD regex looks for "play/until/mayPlay" in the reading.
- **Failure classes:** none
- **Root cause:** RC21 Coverage classification false positive
- **Source:** MISREAD regexes match words in the reading JSON (e.g. "play|until" for flash permission); RESTRICTION does not know engine.js abilityCost floors at one mana
- **Evidence:** P28
- **Same root cause:** Chandra's Ignition; Alchemist's Refuge; Sepulchral Primordial; Training Grounds; Forensic Gadgeteer; Biomancer's Familiar; Zirda, the Dawnwaker

### #556 Nesting Grounds

- **Finding:** Incomplete implementation · **Severity:** Low · **Plays:** weaker than printed
- **Coverage:** incorrect — "target … you control" is not read (a person could aim it at an opponent's permanent) / {1}, {t}: move a counter from target permanent you control onto a second target permanent. activate only as a sorcery.
- **Oracle text:** {T}: Add {C}. / {1}, {T}: Move a counter from target permanent you control onto a second target permanent. Activate only as a sorcery.
- **Expected:** Move a counter from target permanent you control onto a second target permanent (sorcery speed).
- **Actual:** Only the {C} mana ability is read.
- **Failure classes:** C (Effect never executes), J (Incorrect counters or token handling)
- **Root cause:** RC15 Whole ability not read (incomplete implementation); RC19 Counter movement and named counters
- **Source:** effects.js parseCard leaves the line in fx.unread; coverage.mjs RESTRICTION (l.52) labels the card "restriction" (stronger) when the unread text merely contains "activate only"/"can't" — No effect kind for moving counters between permanents; named counters partly modelled
- **Evidence:** R
- **Same root cause:** Dauthi Voidwalker; Destiny Spinner; Skrelv, Defector Mite; Endurance; Guide of Souls; Terastodon; Avatar's Wrath; Resourceful Defense; Kozilek, the Great Distortion; Fire Nation Palace; March of Swirling Mist; Druid Class and 48 more

### #566 Conduit of Worlds

- **Finding:** Confirmed defect · **Severity:** Medium · **Plays:** differently from printed
- **Coverage:** restriction — {t}: choose target nonland permanent card in your graveyard. if you haven't cast a spell this turn, you may cast that card. if you do, you can't cast additional spells this turn. activate only as a sorcery.
- **Oracle text:** You may play lands from your graveyard. / {T}: Choose target nonland permanent card in your graveyard. If you haven't cast a spell this turn, you may cast that card. If you do, you can't cast additional spells this turn. Activate only as a sorcery.
- **Expected:** Play lands from your graveyard; recast a permanent card.
- **Actual:** Plays lands from the top of the library instead; ability not read.
- **Failure classes:** A (Incorrect effect recognition), I (Incorrect zone movement), P (Incorrect cleanup, expiration or delayed effects)
- **Root cause:** RC20 "You may play lands / cast X spells" read as play from the top of the library; RC15 Whole ability not read (incomplete implementation)
- **Source:** effects.js l.1605-1607: the "(?:from the top of your library)?" group is optional, so any "you may play lands …" / "you may cast … spells …" line sets seeTop + playTop; mana.js topPlayable (l.622); engine.js land play (l.886) has no graveyard path — effects.js parseCard leaves the line in fx.unread; coverage.mjs RESTRICTION (l.52) labels the card "restriction" (stronger) when the unread text merely contains "activate only"/"can't"
- **Evidence:** T: effects.js playTop + probe2 (Crucible)
- **Same root cause:** Liberator, Urza's Battlethopter; Crucible of Worlds; Ramunap Excavator; Omniscience; Yeva, Nature's Herald; Sigarda's Aid; Borne Upon a Wind; Shimmer Myr; Icetill Explorer; Ancient Greenwarden; Walk-In Closet // Forgotten Cellar; Dracogenesis and 61 more

### #599 Emry, Lurker of the Loch

- **Finding:** Confirmed defect · **Severity:** Medium · **Plays:** stronger than printed
- **Coverage:** incorrect — "you may play/cast … this turn" is not read
- **Oracle text:** Affinity for artifacts (This spell costs {1} less to cast for each artifact you control.) / When Emry enters, mill four cards. / {T}: Choose target artifact card in your graveyard. You may cast that card this turn. (You still pay its costs. Timing rules still apply.)
- **Expected:** Choose one target artifact card in your graveyard; you may cast that card this turn.
- **Actual:** gyCastTurn {types:[artifact]}: every artifact card in the graveyard is castable this turn (mana.js castModeRaw p.gyCast), not one chosen card.
- **Failure classes:** E (Incorrect targeting or target legality), P (Incorrect cleanup, expiration or delayed effects)
- **Root cause:** RC08 Temporary cast/play permissions missing or too broad
- **Source:** resolve.js dig/exileTrigCard/exileGy/mill create no mayPlay; gyCastTurn (l.1911) stores types only, so empty types = every nonland card, unlimited; mana.js castModeRaw (l.510)
- **Evidence:** T: mana.js castModeRaw gyCast branch
- **Same root cause:** Dauthi Voidwalker; Expressive Iteration; Chainer, Nightmare Adept; Containment Construct; Zul Ashur, Lich Lord; Mnemonic Betrayal; Abdel Adrian, Gorion's Ward; Tablet of Discovery; Dire Fleet Daredevil; Valakut Exploration; Tinybones, Bauble Burglar; Rivaz of the Claw

### #611 Floodfarm Verge

- **Finding:** Confirmed defect · **Severity:** Low · **Plays:** stronger than printed
- **Coverage:** restriction — Activate only if you control a Plains or an Island.
- **Oracle text:** {T}: Add {W}. / {T}: Add {U}. Activate only if you control a Plains or an Island.
- **Expected:** {U} only with a Plains or Island.
- **Actual:** {U} unconditional.
- **Failure classes:** F (Incorrect mana or additional cost payment), G (Incorrect conditions or restrictions)
- **Root cause:** RC04 Conditional or second mana abilities dropped or made unconditional
- **Source:** effects.js mana lines: manaLines need only for MANA_COND words (l.48); "a Dragon", "entered this turn", "ferocious", "corrupted", "three lands with the same name", second {C}{C} lines are dropped while the color is still added
- **Evidence:** P37 (same path)
- **Same root cause:** Tablet of Discovery; Fanatic of Rhonas; Plaza of Heroes; Bleachbone Verge; Throne of Eldraine; Shrine of the Forsaken Gods; Eldrazi Temple; Nimbus Maze; Great Hall of the Citadel; Urza's Workshop; Sceptre of Eternal Glory; Mox Jasper and 2 more

### #635 Plaguecrafter

- **Finding:** Confirmed defect · **Severity:** Low · **Plays:** differently from printed
- **Coverage:** restriction — Each player who can't discards a card.
- **Oracle text:** When this creature enters, each player sacrifices a creature or planeswalker of their choice. Each player who can't discards a card.
- **Expected:** Sacrifice a creature or planeswalker; discard if you can't.
- **Actual:** Creatures only; no discard.
- **Failure classes:** B (Recognized but incorrectly constructed), G (Incorrect conditions or restrictions)
- **Root cause:** RC12 Rider sentences dropped (restrictions and riders)
- **Source:** effects.js droppedSentences (l.2453): "can't be regenerated", "can't block", "doesn't untap", "can't cast spells", kicker riders, suspend riders
- **Evidence:** R
- **Same root cause:** Shatterskull Smashing // Shatterskull, the Hammer Pass; Silver Shroud Costume; Mjölnir, Storm Hammer; Damn; Sundering Eruption // Volcanic Fissure; Kappa Cannoneer; Koma, Cosmos Serpent; Planar Genesis; Orim's Chant; Junk Winder; Taunt from the Rampart; Single Combat and 5 more

### #690 Sundering Eruption // Volcanic Fissure

- **Finding:** Confirmed defect · **Severity:** Low · **Plays:** weaker than printed
- **Coverage:** restriction — Creatures without flying can't block this turn.
- **Oracle text:** Destroy target land. Its controller may search their library for a basic land card, put it onto the battlefield tapped, then shuffle. Creatures without flying can't block this turn.
- **Expected:** Creatures without flying can't block.
- **Actual:** Rider dropped.
- **Failure classes:** L (Incorrect continuous effects)
- **Root cause:** RC12 Rider sentences dropped (restrictions and riders)
- **Source:** effects.js droppedSentences (l.2453): "can't be regenerated", "can't block", "doesn't untap", "can't cast spells", kicker riders, suspend riders
- **Evidence:** R
- **Same root cause:** Shatterskull Smashing // Shatterskull, the Hammer Pass; Silver Shroud Costume; Mjölnir, Storm Hammer; Damn; Plaguecrafter; Kappa Cannoneer; Koma, Cosmos Serpent; Planar Genesis; Orim's Chant; Junk Winder; Taunt from the Rampart; Single Combat and 5 more

### #702 Springheart Nantuko

- **Finding:** Confirmed defect · **Severity:** Medium · **Plays:** differently from printed
- **Coverage:** incorrect — an "if" the reader can't read (rules 17: that part does nothing and is reported; before: treated as true)
- **Oracle text:** Bestow {1}{G} / Enchanted creature gets +1/+1. / Landfall — Whenever a land you control enters, you may pay {1}{G} if this permanent is attached to a creature you control. If you do, create a token that's a copy of that creature. If you didn't create a token this way, create a 1/1 green Insect creature token.
- **Expected:** Landfall: if attached, may pay {1}{G} for a token copy of the enchanted creature; otherwise a 1/1 Insect.
- **Actual:** Unattached and unpaid, makes token copies of itself and of the land; never an Insect.
- **Failure classes:** B (Recognized but incorrectly constructed), F (Incorrect mana or additional cost payment), G (Incorrect conditions or restrictions)
- **Root cause:** RC13 Clause bound to the wrong object or read as the wrong effect; RC01 Unread "if" condition at resolution
- **Source:** Token riders ("exile this token", "sacrifice this token") read as exileSelf/sacSelf of the source; copyToken "of it" falls back to src (resolve.js l.439-441); pumpTrig reads ctx.trig.o; conditions read as unconditional; modal text misread — effects.js parseCond (l.626, cond17 l.708) returns {c:"?"}; triggers.js evalCond case "?" (l.453) returns !ctx.resolving; resolve.js runEffects case "if" (l.943) forces the else branch or skips
- **Evidence:** P34
- **Same root cause:** Expressive Iteration; Hunter's Insight; Not Dead After All; Delina, Wild Mage; Inti, Seneschal of the Sun; Kozilek's Command; Court of Garenbrig; Gilded Drake; Abdel Adrian, Gorion's Ward; Sunfall; Court of Vantress; Charming Scoundrel and 39 more

### #747 Spelunking

- **Finding:** Confirmed defect · **Severity:** Low · **Plays:** weaker than printed
- **Coverage:** incorrect — an "if" the reader can't read (rules 17: that part does nothing and is reported; before: treated as true)
- **Oracle text:** When this enchantment enters, draw a card, then you may put a land card from your hand onto the battlefield. If you put a Cave onto the battlefield this way, you gain 4 life. / Lands you control enter untapped.
- **Expected:** Gain 4 if a Cave was put onto the battlefield.
- **Actual:** Never gains 4; the rest works.
- **Failure classes:** G (Incorrect conditions or restrictions)
- **Root cause:** RC01 Unread "if" condition at resolution
- **Source:** effects.js parseCond (l.626, cond17 l.708) returns {c:"?"}; triggers.js evalCond case "?" (l.453) returns !ctx.resolving; resolve.js runEffects case "if" (l.943) forces the else branch or skips
- **Evidence:** R
- **Same root cause:** Guardian Project; Arena of Glory; Springheart Nantuko; Padeem, Consul of Innovation; Approach of the Second Sun; Tataru Taru; Noxious Gearhulk; Combustible Gearhulk; Liberator, Urza's Battlethopter; Carpet of Flowers; Bonehoard Dracosaur; Baleful Mastery and 25 more

### #748 Bleachbone Verge

- **Finding:** Confirmed defect · **Severity:** Low · **Plays:** stronger than printed
- **Coverage:** restriction — Activate only if you control a Plains or a Swamp.
- **Oracle text:** {T}: Add {B}. / {T}: Add {W}. Activate only if you control a Plains or a Swamp.
- **Expected:** {W} only with a Plains or Swamp.
- **Actual:** {W} unconditional.
- **Failure classes:** F (Incorrect mana or additional cost payment), G (Incorrect conditions or restrictions)
- **Root cause:** RC04 Conditional or second mana abilities dropped or made unconditional
- **Source:** effects.js mana lines: manaLines need only for MANA_COND words (l.48); "a Dragon", "entered this turn", "ferocious", "corrupted", "three lands with the same name", second {C}{C} lines are dropped while the color is still added
- **Evidence:** P37 (same path)
- **Same root cause:** Tablet of Discovery; Fanatic of Rhonas; Plaza of Heroes; Floodfarm Verge; Throne of Eldraine; Shrine of the Forsaken Gods; Eldrazi Temple; Nimbus Maze; Great Hall of the Citadel; Urza's Workshop; Sceptre of Eternal Glory; Mox Jasper and 2 more

### #871 Expressive Iteration

- **Finding:** Confirmed defect · **Severity:** High · **Plays:** weaker than printed
- **Coverage:** incorrect — "you may play/cast … this turn" is not read / You may play the exiled card this turn.
- **Oracle text:** Look at the top three cards of your library. Put one of them into your hand, put one of them on the bottom of your library, and exile one of them. You may play the exiled card this turn.
- **Expected:** Look at 3: one to hand, one to bottom, one exiled and playable this turn.
- **Actual:** dig take 1: the other two go to the bottom; nothing is exiled and no play permission exists.
- **Failure classes:** B (Recognized but incorrectly constructed), I (Incorrect zone movement), P (Incorrect cleanup, expiration or delayed effects)
- **Root cause:** RC13 Clause bound to the wrong object or read as the wrong effect; RC08 Temporary cast/play permissions missing or too broad
- **Source:** Token riders ("exile this token", "sacrifice this token") read as exileSelf/sacSelf of the source; copyToken "of it" falls back to src (resolve.js l.439-441); pumpTrig reads ctx.trig.o; conditions read as unconditional; modal text misread — resolve.js dig/exileTrigCard/exileGy/mill create no mayPlay; gyCastTurn (l.1911) stores types only, so empty types = every nonland card, unlimited; mana.js castModeRaw (l.510)
- **Evidence:** T: resolve.js dig
- **Same root cause:** Hunter's Insight; Not Dead After All; Delina, Wild Mage; Inti, Seneschal of the Sun; Kozilek's Command; Court of Garenbrig; Gilded Drake; Abdel Adrian, Gorion's Ward; Sunfall; Court of Vantress; Charming Scoundrel; Springheart Nantuko and 16 more

### #885 Padeem, Consul of Innovation

- **Finding:** Confirmed defect · **Severity:** Low · **Plays:** weaker than printed
- **Coverage:** incorrect — an "if" the reader can't read (rules 17: that part does nothing and is reported; before: treated as true)
- **Oracle text:** Artifacts you control have hexproof. (They can't be the targets of spells or abilities your opponents control.) / At the beginning of your upkeep, if you control the artifact with the greatest mana value or tied for the greatest mana value, draw a card.
- **Expected:** Upkeep draw if you control the highest-MV artifact.
- **Actual:** Never draws.
- **Failure classes:** G (Incorrect conditions or restrictions)
- **Root cause:** RC01 Unread "if" condition at resolution
- **Source:** effects.js parseCond (l.626, cond17 l.708) returns {c:"?"}; triggers.js evalCond case "?" (l.453) returns !ctx.resolving; resolve.js runEffects case "if" (l.943) forces the else branch or skips
- **Evidence:** R
- **Same root cause:** Guardian Project; Arena of Glory; Springheart Nantuko; Spelunking; Approach of the Second Sun; Tataru Taru; Noxious Gearhulk; Combustible Gearhulk; Liberator, Urza's Battlethopter; Carpet of Flowers; Bonehoard Dracosaur; Baleful Mastery and 25 more

### #890 Kappa Cannoneer

- **Finding:** Confirmed defect · **Severity:** Medium · **Plays:** weaker than printed
- **Coverage:** restriction — It can't be blocked this turn.
- **Oracle text:** Improvise (Your artifacts can help cast this spell. Each artifact you tap after you're done activating mana abilities pays for {1}.) / Ward {4} / Whenever this creature or another artifact you control enters, put a +1/+1 counter on this creature. It can't be blocked this turn.
- **Expected:** Unblockable this turn after each trigger.
- **Actual:** Rider dropped.
- **Failure classes:** L (Incorrect continuous effects)
- **Root cause:** RC12 Rider sentences dropped (restrictions and riders)
- **Source:** effects.js droppedSentences (l.2453): "can't be regenerated", "can't block", "doesn't untap", "can't cast spells", kicker riders, suspend riders
- **Evidence:** R
- **Same root cause:** Shatterskull Smashing // Shatterskull, the Hammer Pass; Silver Shroud Costume; Mjölnir, Storm Hammer; Damn; Plaguecrafter; Sundering Eruption // Volcanic Fissure; Koma, Cosmos Serpent; Planar Genesis; Orim's Chant; Junk Winder; Taunt from the Rampart; Single Combat and 5 more

### #900 Throne of Eldraine

- **Finding:** Confirmed defect · **Severity:** Medium · **Plays:** differently from printed
- **Coverage:** restriction — Spend this mana only to cast monocolored spells of that color.
- **Oracle text:** As Throne of Eldraine enters, choose a color. / {T}: Add four mana of the chosen color. Spend this mana only to cast monocolored spells of that color. / {3}, {T}: Draw two cards. Spend only mana of the chosen color to activate this ability.
- **Expected:** Four chosen-color mana for monocolored spells of that color; draw ability needs that color.
- **Actual:** One mana of any color; no restrictions.
- **Failure classes:** F (Incorrect mana or additional cost payment)
- **Root cause:** RC03 Spend restrictions on mana not modelled; extra mana lines merged; RC04 Conditional or second mana abilities dropped or made unconditional
- **Source:** effects.js mana-line reader (l.2060-2100) keeps only fx.mana.only creatureSpell/creatureAbility and cavern; the colors of every mana line are unioned into one fx.mana; mana.js spendOk (l.38) knows two restrictions — effects.js mana lines: manaLines need only for MANA_COND words (l.48); "a Dragon", "entered this turn", "ferocious", "corrupted", "three lands with the same name", second {C}{C} lines are dropped while the color is still added
- **Evidence:** R
- **Same root cause:** Delighted Halfling; Secluded Courtyard; Unclaimed Territory; Plaza of Heroes; Haven of the Spirit Dragon; Codsworth, Handy Helper; Giada, Font of Hope; Gwenna, Eyes of Gaea; Great Hall of the Citadel; Maelstrom of the Spirit Dragon; Power Depot; Klauth, Unrivaled Ancient and 22 more

### #948 Approach of the Second Sun

- **Finding:** Confirmed defect · **Severity:** Critical · **Plays:** weaker than printed
- **Coverage:** incorrect — an "if" the reader can't read (rules 17: that part does nothing and is reported; before: treated as true)
- **Oracle text:** If this spell was cast from your hand and you've cast another spell named Approach of the Second Sun this game, you win the game. Otherwise, put Approach of the Second Sun into its owner's library seventh from the top and you gain 7 life.
- **Expected:** Second cast from hand wins; otherwise seventh from the top and gain 7.
- **Actual:** Can never win (unread condition with an else); gains 7 and goes to the graveyard instead of the library.
- **Failure classes:** G (Incorrect conditions or restrictions), I (Incorrect zone movement)
- **Root cause:** RC01 Unread "if" condition at resolution; RC13 Clause bound to the wrong object or read as the wrong effect
- **Source:** effects.js parseCond (l.626, cond17 l.708) returns {c:"?"}; triggers.js evalCond case "?" (l.453) returns !ctx.resolving; resolve.js runEffects case "if" (l.943) forces the else branch or skips — Token riders ("exile this token", "sacrifice this token") read as exileSelf/sacSelf of the source; copyToken "of it" falls back to src (resolve.js l.439-441); pumpTrig reads ctx.trig.o; conditions read as unconditional; modal text misread
- **Evidence:** P11
- **Same root cause:** Guardian Project; Arena of Glory; Springheart Nantuko; Spelunking; Padeem, Consul of Innovation; Tataru Taru; Noxious Gearhulk; Combustible Gearhulk; Liberator, Urza's Battlethopter; Carpet of Flowers; Bonehoard Dracosaur; Baleful Mastery and 39 more

### #973 Tataru Taru

- **Finding:** Confirmed defect · **Severity:** Low · **Plays:** differently from printed
- **Coverage:** incorrect — an "if" the reader can't read (rules 17: that part does nothing and is reported; before: treated as true)
- **Oracle text:** When Tataru Taru enters, you draw a card and target opponent may draw a card. / Scions' Secretary — Whenever an opponent draws a card, if it isn't that player's turn, create a tapped Treasure token. This ability triggers only once each turn.
- **Expected:** Opponent MAY draw; Treasure when an opponent draws off-turn.
- **Actual:** Opponent always draws; no Treasures.
- **Failure classes:** G (Incorrect conditions or restrictions), R (Other)
- **Root cause:** RC01 Unread "if" condition at resolution; RC11 A player's choice is not asked (punishers, "may have you", optional costs)
- **Source:** effects.js parseCond (l.626, cond17 l.708) returns {c:"?"}; triggers.js evalCond case "?" (l.453) returns !ctx.resolving; resolve.js runEffects case "if" (l.943) forces the else branch or skips — reader keeps one branch of "target opponent may have you draw…", "you may sacrifice…, if you do", "if you don't, put … into your hand"
- **Evidence:** R
- **Same root cause:** Guardian Project; Arena of Glory; Springheart Nantuko; Spelunking; Padeem, Consul of Innovation; Approach of the Second Sun; Noxious Gearhulk; Combustible Gearhulk; Liberator, Urza's Battlethopter; Carpet of Flowers; Bonehoard Dracosaur; Baleful Mastery and 29 more

### #1020 Noxious Gearhulk

- **Finding:** Confirmed defect · **Severity:** Medium · **Plays:** weaker than printed
- **Coverage:** incorrect — an "if" the reader can't read (rules 17: that part does nothing and is reported; before: treated as true)
- **Oracle text:** Menace / When this creature enters, you may destroy another target creature. If a creature is destroyed this way, you gain life equal to its toughness.
- **Expected:** Gain life equal to the destroyed creature's toughness.
- **Actual:** Destroys, gains nothing.
- **Failure classes:** G (Incorrect conditions or restrictions)
- **Root cause:** RC01 Unread "if" condition at resolution
- **Source:** effects.js parseCond (l.626, cond17 l.708) returns {c:"?"}; triggers.js evalCond case "?" (l.453) returns !ctx.resolving; resolve.js runEffects case "if" (l.943) forces the else branch or skips
- **Evidence:** P03
- **Same root cause:** Guardian Project; Arena of Glory; Springheart Nantuko; Spelunking; Padeem, Consul of Innovation; Approach of the Second Sun; Tataru Taru; Combustible Gearhulk; Liberator, Urza's Battlethopter; Carpet of Flowers; Bonehoard Dracosaur; Baleful Mastery and 25 more

### #1024 Combustible Gearhulk

- **Finding:** Confirmed defect · **Severity:** High · **Plays:** stronger than printed
- **Coverage:** incorrect — an "if" the reader can't read (rules 17: that part does nothing and is reported; before: treated as true)
- **Oracle text:** First strike / When this creature enters, target opponent may have you draw three cards. If the player doesn't, you mill three cards, then this creature deals damage to that player equal to the total mana value of those cards.
- **Expected:** Opponent chooses: you draw 3, or mill 3 and take damage = MV.
- **Actual:** Always draws 3; the opponent is never asked.
- **Failure classes:** G (Incorrect conditions or restrictions), R (Other)
- **Root cause:** RC11 A player's choice is not asked (punishers, "may have you", optional costs); RC01 Unread "if" condition at resolution
- **Source:** reader keeps one branch of "target opponent may have you draw…", "you may sacrifice…, if you do", "if you don't, put … into your hand" — effects.js parseCond (l.626, cond17 l.708) returns {c:"?"}; triggers.js evalCond case "?" (l.453) returns !ctx.resolving; resolve.js runEffects case "if" (l.943) forces the else branch or skips
- **Evidence:** P13
- **Same root cause:** Palantír of Orthanc; Tataru Taru; Wilhelt, the Rotcleaver; Planar Genesis; Risen Reef; Fandaniel, Telophoroi Ascian; Guardian Project; Arena of Glory; Springheart Nantuko; Spelunking; Padeem, Consul of Innovation; Approach of the Second Sun and 29 more

### #1028 Training Grounds

- **Finding:** Not a defect (classification false positive) · **Severity:** Low · **Plays:** as printed (for the flagged part)
- **Coverage:** restriction — This effect can't reduce the mana in that cost to less than one mana.
- **Oracle text:** Activated abilities of creatures you control cost {2} less to activate. This effect can't reduce the mana in that cost to less than one mana.
- **Expected:** Can't reduce below one mana.
- **Actual:** Enforced by engine.js abilityCost ({2} -> {1}).
- **Failure classes:** none
- **Root cause:** RC21 Coverage classification false positive
- **Source:** MISREAD regexes match words in the reading JSON (e.g. "play|until" for flash permission); RESTRICTION does not know engine.js abilityCost floors at one mana
- **Evidence:** P39
- **Same root cause:** Chandra's Ignition; Emergence Zone; Alchemist's Refuge; Sepulchral Primordial; Forensic Gadgeteer; Biomancer's Familiar; Zirda, the Dawnwaker

### #1045 Destiny Spinner

- **Finding:** Incomplete implementation · **Severity:** Low · **Plays:** weaker than printed
- **Coverage:** incorrect — "target … you control" is not read (a person could aim it at an opponent's permanent) / {3}{g}: target land you control becomes an x/x elemental creature with trample and haste until end of turn, where x is the number of enchantments you control. it's still a land.
- **Oracle text:** Creature and enchantment spells you control can't be countered. / {3}{G}: Target land you control becomes an X/X Elemental creature with trample and haste until end of turn, where X is the number of enchantments you control. It's still a land.
- **Expected:** {3}{G}: target land you control becomes an X/X Elemental with trample and haste (X = enchantments).
- **Actual:** Static uncounterability read; the animation ability is not read.
- **Failure classes:** C (Effect never executes), L (Incorrect continuous effects)
- **Root cause:** RC15 Whole ability not read (incomplete implementation)
- **Source:** effects.js parseCard leaves the line in fx.unread; coverage.mjs RESTRICTION (l.52) labels the card "restriction" (stronger) when the unread text merely contains "activate only"/"can't"
- **Evidence:** R
- **Same root cause:** Dauthi Voidwalker; Nesting Grounds; Skrelv, Defector Mite; Endurance; Guide of Souls; Terastodon; Avatar's Wrath; Resourceful Defense; Kozilek, the Great Distortion; Fire Nation Palace; March of Swirling Mist; Druid Class and 47 more

### #1067 Hunter's Insight

- **Finding:** Confirmed defect · **Severity:** Medium · **Plays:** differently from printed
- **Coverage:** incorrect — "target … you control" is not read (a person could aim it at an opponent's permanent) / Choose target creature you control.
- **Oracle text:** Choose target creature you control. Whenever that creature deals combat damage to a player or planeswalker this turn, draw that many cards.
- **Expected:** Choose target creature you control; draw cards later equal to the combat damage it deals to a player this turn.
- **Actual:** Reads as an immediate draw of trigN at resolution; no target and no delayed trigger.
- **Failure classes:** B (Recognized but incorrectly constructed), H (Incorrect trigger timing or registration)
- **Root cause:** RC13 Clause bound to the wrong object or read as the wrong effect
- **Source:** Token riders ("exile this token", "sacrifice this token") read as exileSelf/sacSelf of the source; copyToken "of it" falls back to src (resolve.js l.439-441); pumpTrig reads ctx.trig.o; conditions read as unconditional; modal text misread
- **Evidence:** P15
- **Same root cause:** Expressive Iteration; Not Dead After All; Delina, Wild Mage; Inti, Seneschal of the Sun; Kozilek's Command; Court of Garenbrig; Gilded Drake; Abdel Adrian, Gorion's Ward; Sunfall; Court of Vantress; Charming Scoundrel; Springheart Nantuko and 5 more

### #1102 Not Dead After All

- **Finding:** Confirmed defect · **Severity:** Low · **Plays:** weaker than printed
- **Coverage:** incorrect — "target … you control" is not read (a person could aim it at an opponent's permanent)
- **Oracle text:** Until end of turn, target creature you control gains "When this creature dies, return it to the battlefield tapped under its owner's control, then create a Wicked Role token attached to it." (Enchanted creature gets +1/+1. When this token is put into a graveyard, each opponent loses 1 life.)
- **Expected:** Target creature you control gains "when this dies, return it tapped with a Wicked Role" until end of turn.
- **Actual:** Read as returnSelf on the spell; it does nothing and the creature stays dead.
- **Failure classes:** B (Recognized but incorrectly constructed), C (Effect never executes)
- **Root cause:** RC13 Clause bound to the wrong object or read as the wrong effect
- **Source:** Token riders ("exile this token", "sacrifice this token") read as exileSelf/sacSelf of the source; copyToken "of it" falls back to src (resolve.js l.439-441); pumpTrig reads ctx.trig.o; conditions read as unconditional; modal text misread
- **Evidence:** P25
- **Same root cause:** Expressive Iteration; Hunter's Insight; Delina, Wild Mage; Inti, Seneschal of the Sun; Kozilek's Command; Court of Garenbrig; Gilded Drake; Abdel Adrian, Gorion's Ward; Sunfall; Court of Vantress; Charming Scoundrel; Springheart Nantuko and 5 more

### #1105 Alchemist's Refuge

- **Finding:** Not a defect (classification false positive) · **Severity:** Low · **Plays:** as printed (for the flagged part)
- **Coverage:** incorrect — "you may play/cast … this turn" is not read
- **Oracle text:** {T}: Add {C}. / {G}{U}, {T}: You may cast spells this turn as though they had flash.
- **Expected:** Spells castable as though they had flash this turn.
- **Actual:** Same flashTurn handler as Emergence Zone (works).
- **Failure classes:** none
- **Root cause:** RC21 Coverage classification false positive
- **Source:** MISREAD regexes match words in the reading JSON (e.g. "play|until" for flash permission); RESTRICTION does not know engine.js abilityCost floors at one mana
- **Evidence:** P28 (same handler)
- **Same root cause:** Chandra's Ignition; Emergence Zone; Sepulchral Primordial; Training Grounds; Forensic Gadgeteer; Biomancer's Familiar; Zirda, the Dawnwaker

### #1118 Skrelv, Defector Mite

- **Finding:** Incomplete implementation · **Severity:** Medium · **Plays:** weaker than printed
- **Coverage:** incorrect — "target … you control" is not read (a person could aim it at an opponent's permanent) / {w/p}, {t}: choose a color. another target creature you control gains toxic 1 and hexproof from that color until end of turn. it can't be blocked by creatures of that color this turn.
- **Oracle text:** Toxic 1 (Players dealt combat damage by this creature also get a poison counter.) / Skrelv can't block. / {W/P}, {T}: Choose a color. Another target creature you control gains toxic 1 and hexproof from that color until end of turn. It can't be blocked by creatures of that color this turn. ({W/P} can be paid with either {W} or 2 life.)
- **Expected:** {W/P},{T}: another target creature you control gains toxic 1, hexproof from a color and evasion.
- **Actual:** Only toxic and "can't block" read; ability not read.
- **Failure classes:** C (Effect never executes), E (Incorrect targeting or target legality)
- **Root cause:** RC15 Whole ability not read (incomplete implementation)
- **Source:** effects.js parseCard leaves the line in fx.unread; coverage.mjs RESTRICTION (l.52) labels the card "restriction" (stronger) when the unread text merely contains "activate only"/"can't"
- **Evidence:** R
- **Same root cause:** Dauthi Voidwalker; Nesting Grounds; Destiny Spinner; Endurance; Guide of Souls; Terastodon; Avatar's Wrath; Resourceful Defense; Kozilek, the Great Distortion; Fire Nation Palace; March of Swirling Mist; Druid Class and 47 more

### #1129 Haven of the Spirit Dragon

- **Finding:** Confirmed defect · **Severity:** Low · **Plays:** stronger than printed
- **Coverage:** restriction — Spend this mana only to cast a Dragon creature spell.
- **Oracle text:** {T}: Add {C}. / {T}: Add one mana of any color. Spend this mana only to cast a Dragon creature spell. / {2}, {T}, Sacrifice this land: Return target Dragon creature card or Ugin planeswalker card from your graveyard to your hand.
- **Expected:** Mana only for Dragons; regrow only Dragon/Ugin.
- **Actual:** Any color; regrows any creature or planeswalker.
- **Failure classes:** F (Incorrect mana or additional cost payment), E (Incorrect targeting or target legality)
- **Root cause:** RC03 Spend restrictions on mana not modelled; extra mana lines merged; RC06 Target qualifiers not enforced (legendary, MV, attacking, dynamic limits)
- **Source:** effects.js mana-line reader (l.2060-2100) keeps only fx.mana.only creatureSpell/creatureAbility and cavern; the colors of every mana line are unioned into one fx.mana; mana.js spendOk (l.38) knows two restrictions — effects.js targetWords (l.1107) only runs for TARGETED kinds (l.1103): reanimate, counter, steal-with-MV, tutor, regrow get no e.tr; tr has no dynamic limits (X, graveyard size); resolve.js targetFits (l.155) / legalTargets (l.111)
- **Evidence:** R
- **Same root cause:** Delighted Halfling; Secluded Courtyard; Unclaimed Territory; Plaza of Heroes; Throne of Eldraine; Codsworth, Handy Helper; Giada, Font of Hope; Gwenna, Eyes of Gaea; Great Hall of the Citadel; Maelstrom of the Spirit Dragon; Power Depot; Klauth, Unrivaled Ancient and 16 more

### #1193 Steel Hellkite

- **Finding:** Incomplete implementation · **Severity:** Medium · **Plays:** weaker than printed
- **Coverage:** restriction — {x}: destroy each nonland permanent with mana value x whose controller was dealt combat damage by ~ this turn. activate only once each turn.
- **Oracle text:** Flying / {2}: This creature gets +1/+0 until end of turn. / {X}: Destroy each nonland permanent with mana value X whose controller was dealt combat damage by this creature this turn. Activate only once each turn.
- **Expected:** {X}: destroy MV-X permanents of damaged players.
- **Actual:** Not read.
- **Failure classes:** C (Effect never executes), M (Incorrect X-value or variable calculation)
- **Root cause:** RC15 Whole ability not read (incomplete implementation)
- **Source:** effects.js parseCard leaves the line in fx.unread; coverage.mjs RESTRICTION (l.52) labels the card "restriction" (stronger) when the unread text merely contains "activate only"/"can't"
- **Evidence:** R
- **Same root cause:** Dauthi Voidwalker; Nesting Grounds; Destiny Spinner; Skrelv, Defector Mite; Endurance; Guide of Souls; Terastodon; Avatar's Wrath; Resourceful Defense; Kozilek, the Great Distortion; Fire Nation Palace; March of Swirling Mist and 47 more

### #1211 Shrine of the Forsaken Gods

- **Finding:** Incomplete implementation · **Severity:** Low · **Plays:** weaker than printed
- **Coverage:** restriction — Spend this mana only to cast colorless spells. / Activate only if you control seven or more lands.
- **Oracle text:** {T}: Add {C}. / {T}: Add {C}{C}. Spend this mana only to cast colorless spells. Activate only if you control seven or more lands.
- **Expected:** {C}{C} for colorless spells with 7 lands.
- **Actual:** Only {C}.
- **Failure classes:** F (Incorrect mana or additional cost payment)
- **Root cause:** RC04 Conditional or second mana abilities dropped or made unconditional
- **Source:** effects.js mana lines: manaLines need only for MANA_COND words (l.48); "a Dragon", "entered this turn", "ferocious", "corrupted", "three lands with the same name", second {C}{C} lines are dropped while the color is still added
- **Evidence:** R
- **Same root cause:** Tablet of Discovery; Fanatic of Rhonas; Plaza of Heroes; Floodfarm Verge; Bleachbone Verge; Throne of Eldraine; Eldrazi Temple; Nimbus Maze; Great Hall of the Citadel; Urza's Workshop; Sceptre of Eternal Glory; Mox Jasper and 2 more

### #1212 Mount Doom

- **Finding:** Incomplete implementation · **Severity:** Low · **Plays:** weaker than printed
- **Coverage:** restriction — {5}{b}{r}, {t}, sacrifice ~ and a legendary artifact: choose up to two creatures, then destroy the rest. activate only as a sorcery.
- **Oracle text:** {T}, Pay 1 life: Add {B} or {R}. / {1}{B}{R}, {T}: Mount Doom deals 1 damage to each opponent. / {5}{B}{R}, {T}, Sacrifice Mount Doom and a legendary artifact: Choose up to two creatures, then destroy the rest. Activate only as a sorcery.
- **Expected:** Wrath ability.
- **Actual:** Not read.
- **Failure classes:** C (Effect never executes)
- **Root cause:** RC15 Whole ability not read (incomplete implementation)
- **Source:** effects.js parseCard leaves the line in fx.unread; coverage.mjs RESTRICTION (l.52) labels the card "restriction" (stronger) when the unread text merely contains "activate only"/"can't"
- **Evidence:** R
- **Same root cause:** Dauthi Voidwalker; Nesting Grounds; Destiny Spinner; Skrelv, Defector Mite; Endurance; Guide of Souls; Terastodon; Avatar's Wrath; Resourceful Defense; Kozilek, the Great Distortion; Fire Nation Palace; March of Swirling Mist and 47 more

### #1252 Liberator, Urza's Battlethopter

- **Finding:** Confirmed defect · **Severity:** High · **Plays:** stronger than printed
- **Coverage:** incorrect — an "if" the reader can't read (rules 17: that part does nothing and is reported; before: treated as true)
- **Oracle text:** Flash / Flying / You may cast colorless spells and artifact spells as though they had flash. / Whenever you cast a spell, if the amount of mana spent to cast that spell is greater than Liberator's power, put a +1/+1 counter on Liberator.
- **Expected:** Flash for colorless and artifact spells; +1 counter when a big spell is cast.
- **Actual:** Read as "cast colorless spells from the top of your library" (seeTop/playTop); flash grant missing; counter trigger never.
- **Failure classes:** A (Incorrect effect recognition), G (Incorrect conditions or restrictions), P (Incorrect cleanup, expiration or delayed effects)
- **Root cause:** RC20 "You may play lands / cast X spells" read as play from the top of the library; RC01 Unread "if" condition at resolution
- **Source:** effects.js l.1605-1607: the "(?:from the top of your library)?" group is optional, so any "you may play lands …" / "you may cast … spells …" line sets seeTop + playTop; mana.js topPlayable (l.622); engine.js land play (l.886) has no graveyard path — effects.js parseCond (l.626, cond17 l.708) returns {c:"?"}; triggers.js evalCond case "?" (l.453) returns !ctx.resolving; resolve.js runEffects case "if" (l.943) forces the else branch or skips
- **Evidence:** T: effects.js playTop regex + probe2 (Yeva, same rule)
- **Same root cause:** Conduit of Worlds; Crucible of Worlds; Ramunap Excavator; Omniscience; Yeva, Nature's Herald; Sigarda's Aid; Borne Upon a Wind; Shimmer Myr; Icetill Explorer; Ancient Greenwarden; Walk-In Closet // Forgotten Cellar; Dracogenesis and 39 more

### #1332 Palantír of Orthanc

- **Finding:** Confirmed defect · **Severity:** High · **Plays:** stronger than printed
- **Coverage:** incorrect — "X, where X is …" is left as the X paid on casting (plays as 0)
- **Oracle text:** At the beginning of your end step, put an influence counter on Palantír of Orthanc and scry 2. Then target opponent may have you draw a card. If that player doesn't, you mill X cards, where X is the number of influence counters on Palantír of Orthanc, and that player loses life equal to the total mana value of those cards.
- **Expected:** Opponent chooses: you draw a card, or you mill X (influence counters) and they lose life equal to the milled mana values.
- **Actual:** Always draws a card; the mill uses dyn "?" (0) and the opponent is never asked, so the card is a free draw every end step.
- **Failure classes:** B (Recognized but incorrectly constructed), M (Incorrect X-value or variable calculation), G (Incorrect conditions or restrictions)
- **Root cause:** RC11 A player's choice is not asked (punishers, "may have you", optional costs); RC09 "X, where X is …" left as paid X (0)
- **Source:** reader keeps one branch of "target opponent may have you draw…", "you may sacrifice…, if you do", "if you don't, put … into your hand" — effects.js xWhere reader (l.1047-1074) returns {dyn:"?"}; resolve.js X() reads it as 0; roll passes x only to its table rows
- **Evidence:** R + P06 (same dyn "?" path)
- **Same root cause:** Tataru Taru; Combustible Gearhulk; Wilhelt, the Rotcleaver; Planar Genesis; Risen Reef; Fandaniel, Telophoroi Ascian; Painful Truths; Quartzwood Crasher; Kozilek's Command; Pact of the Serpent; Ancient Bronze Dragon; Prime Speaker Zegana and 6 more

### #1338 Endurance

- **Finding:** Incomplete implementation · **Severity:** Medium · **Plays:** weaker than printed
- **Coverage:** incorrect — "up to N target" is not read / when ~ enters, up to one target player puts all the cards from their graveyard on the bottom of their library in a random order.
- **Oracle text:** Flash / Reach / When this creature enters, up to one target player puts all the cards from their graveyard on the bottom of their library in a random order. / Evoke—Exile a green card from your hand.
- **Expected:** ETB: up to one target player puts their graveyard on the bottom of their library.
- **Actual:** Flash/reach/evoke read; the ETB is not read.
- **Failure classes:** C (Effect never executes), E (Incorrect targeting or target legality), I (Incorrect zone movement)
- **Root cause:** RC15 Whole ability not read (incomplete implementation); RC10 Multiple / divided / "up to" targets
- **Source:** effects.js parseCard leaves the line in fx.unread; coverage.mjs RESTRICTION (l.52) labels the card "restriction" (stronger) when the unread text merely contains "activate only"/"can't" — effects.js upTo splitter (l.1250-1265) only for MULTI kinds and not for divided/distributed amounts
- **Evidence:** R
- **Same root cause:** Dauthi Voidwalker; Nesting Grounds; Destiny Spinner; Skrelv, Defector Mite; Guide of Souls; Terastodon; Avatar's Wrath; Resourceful Defense; Kozilek, the Great Distortion; Fire Nation Palace; March of Swirling Mist; Druid Class and 50 more

### #1342 Persist

- **Finding:** Confirmed defect · **Severity:** High · **Plays:** stronger than printed
- **Coverage:** incorrect — "target (non)legendary" is not read
- **Oracle text:** Return target nonlegendary creature card from your graveyard to the battlefield with a -1/-1 counter on it.
- **Expected:** Return target NONLEGENDARY creature card with a -1/-1 counter.
- **Actual:** Returns legendary creatures (Sheoldred) and with no -1/-1 counter.
- **Failure classes:** E (Incorrect targeting or target legality), J (Incorrect counters or token handling)
- **Root cause:** RC06 Target qualifiers not enforced (legendary, MV, attacking, dynamic limits)
- **Source:** effects.js targetWords (l.1107) only runs for TARGETED kinds (l.1103): reanimate, counter, steal-with-MV, tutor, regrow get no e.tr; tr has no dynamic limits (X, graveyard size); resolve.js targetFits (l.155) / legalTargets (l.111)
- **Evidence:** P33
- **Same root cause:** Drown in the Loch; Inti, Seneschal of the Sun; Kozilek's Command; Thieving Skydiver; Not of This World; Haven of the Spirit Dragon; Maelstrom of the Spirit Dragon; Mudflat Village

### #1352 Carpet of Flowers

- **Finding:** Confirmed defect · **Severity:** Medium · **Plays:** weaker than printed
- **Coverage:** incorrect — an "if" the reader can't read (rules 17: that part does nothing and is reported; before: treated as true) / "X, where X is …" is left as the X paid on casting (plays as 0)
- **Oracle text:** At the beginning of each of your main phases, if you haven't added mana with this ability this turn, you may add X mana of any one color, where X is the number of Islands target opponent controls.
- **Expected:** Each main phase once: X mana, X = Islands target opponent controls.
- **Actual:** Never adds mana.
- **Failure classes:** G (Incorrect conditions or restrictions), M (Incorrect X-value or variable calculation), F (Incorrect mana or additional cost payment)
- **Root cause:** RC01 Unread "if" condition at resolution; RC09 "X, where X is …" left as paid X (0)
- **Source:** effects.js parseCond (l.626, cond17 l.708) returns {c:"?"}; triggers.js evalCond case "?" (l.453) returns !ctx.resolving; resolve.js runEffects case "if" (l.943) forces the else branch or skips — effects.js xWhere reader (l.1047-1074) returns {dyn:"?"}; resolve.js X() reads it as 0; roll passes x only to its table rows
- **Evidence:** R
- **Same root cause:** Guardian Project; Arena of Glory; Springheart Nantuko; Spelunking; Padeem, Consul of Innovation; Approach of the Second Sun; Tataru Taru; Noxious Gearhulk; Combustible Gearhulk; Liberator, Urza's Battlethopter; Bonehoard Dracosaur; Baleful Mastery and 37 more

### #1366 Giver of Runes

- **Finding:** Confirmed defect · **Severity:** Medium · **Plays:** differently from printed
- **Coverage:** incorrect — "protection from colorless or from the color of your choice" is played as hexproof
- **Oracle text:** {T}: Another target creature you control gains protection from colorless or from the color of your choice until end of turn.
- **Expected:** Another target creature you control gains protection from colorless or a chosen color.
- **Actual:** Read as hexproof (twice): no damage prevention, no blocking or attachment protection, no color choice.
- **Failure classes:** B (Recognized but incorrectly constructed), L (Incorrect continuous effects), R (Other)
- **Root cause:** RC17 Protection read as hexproof
- **Source:** effects.js protect reader turns "protection from colorless or the color of your choice" into kw hexproof; engine.js protectedFrom exists for printed protection
- **Evidence:** P31
- **Same root cause:** —

### #1389 Bonehoard Dracosaur

- **Finding:** Confirmed defect · **Severity:** High · **Plays:** weaker than printed
- **Coverage:** incorrect — an "if" the reader can't read (rules 17: that part does nothing and is reported; before: treated as true)
- **Oracle text:** Flying, first strike / At the beginning of your upkeep, exile the top two cards of your library. You may play them this turn. If you exiled a land card this way, create a 3/1 red Dinosaur creature token. If you exiled a nonland card this way, create a Treasure token.
- **Expected:** Impulse two; Dinosaur for a land, Treasure for a nonland.
- **Actual:** Impulse works; never a token.
- **Failure classes:** G (Incorrect conditions or restrictions)
- **Root cause:** RC01 Unread "if" condition at resolution
- **Source:** effects.js parseCond (l.626, cond17 l.708) returns {c:"?"}; triggers.js evalCond case "?" (l.453) returns !ctx.resolving; resolve.js runEffects case "if" (l.943) forces the else branch or skips
- **Evidence:** R
- **Same root cause:** Guardian Project; Arena of Glory; Springheart Nantuko; Spelunking; Padeem, Consul of Innovation; Approach of the Second Sun; Tataru Taru; Noxious Gearhulk; Combustible Gearhulk; Liberator, Urza's Battlethopter; Carpet of Flowers; Baleful Mastery and 25 more

### #1402 Forensic Gadgeteer

- **Finding:** Not a defect (classification false positive) · **Severity:** Low · **Plays:** as printed (for the flagged part)
- **Coverage:** restriction — This effect can't reduce the mana in that cost to less than one mana.
- **Oracle text:** Whenever you cast an artifact spell, investigate. (Create a Clue token. It's an artifact with "{2}, Sacrifice this token: Draw a card.") / Activated abilities of artifacts you control cost {1} less to activate. This effect can't reduce the mana in that cost to less than one mana.
- **Expected:** Can't reduce below one mana.
- **Actual:** Floor enforced by abilityCost.
- **Failure classes:** none
- **Root cause:** RC21 Coverage classification false positive
- **Source:** MISREAD regexes match words in the reading JSON (e.g. "play|until" for flash permission); RESTRICTION does not know engine.js abilityCost floors at one mana
- **Evidence:** P39 (same path)
- **Same root cause:** Chandra's Ignition; Emergence Zone; Alchemist's Refuge; Sepulchral Primordial; Training Grounds; Biomancer's Familiar; Zirda, the Dawnwaker

### #1413 Shatterskull Smashing // Shatterskull, the Hammer Pass

- **Finding:** Confirmed defect · **Severity:** Medium · **Plays:** weaker than printed
- **Coverage:** incorrect — "up to two or more targets": only one target is used / If X is 6 or more, Shatterskull Smashing deals twice X damage divided as you choose among them instead.
- **Oracle text:** Shatterskull Smashing deals X damage divided as you choose among up to two target creatures and/or planeswalkers. If X is 6 or more, Shatterskull Smashing deals twice X damage divided as you choose among them instead.
- **Expected:** X damage divided among up to two targets; twice X if X >= 6.
- **Actual:** One damage effect to one target ("upTo":2, no split); the X >= 6 doubling sentence is dropped.
- **Failure classes:** B (Recognized but incorrectly constructed), E (Incorrect targeting or target legality), M (Incorrect X-value or variable calculation)
- **Root cause:** RC10 Multiple / divided / "up to" targets; RC12 Rider sentences dropped (restrictions and riders)
- **Source:** effects.js upTo splitter (l.1250-1265) only for MULTI kinds and not for divided/distributed amounts — effects.js droppedSentences (l.2453): "can't be regenerated", "can't block", "doesn't untap", "can't cast spells", kicker riders, suspend riders
- **Evidence:** R
- **Same root cause:** Endurance; Terastodon; March of Swirling Mist; Court of Garenbrig; Ancient Bronze Dragon; Dance of the Manse; Silver Shroud Costume; Mjölnir, Storm Hammer; Damn; Plaguecrafter; Sundering Eruption // Volcanic Fissure; Kappa Cannoneer and 11 more

### #1435 Baleful Mastery

- **Finding:** Confirmed defect · **Severity:** High · **Plays:** stronger than printed
- **Coverage:** incorrect — an "if" the reader can't read (rules 17: that part does nothing and is reported; before: treated as true)
- **Oracle text:** You may pay {1}{B} rather than pay this spell's mana cost. / If the {1}{B} cost was paid, an opponent draws a card. / Exile target creature or planeswalker.
- **Expected:** Paying {1}{B}: an opponent draws a card.
- **Actual:** The alternative cost has no drawback.
- **Failure classes:** F (Incorrect mana or additional cost payment), G (Incorrect conditions or restrictions)
- **Root cause:** RC01 Unread "if" condition at resolution
- **Source:** effects.js parseCond (l.626, cond17 l.708) returns {c:"?"}; triggers.js evalCond case "?" (l.453) returns !ctx.resolving; resolve.js runEffects case "if" (l.943) forces the else branch or skips
- **Evidence:** P14
- **Same root cause:** Guardian Project; Arena of Glory; Springheart Nantuko; Spelunking; Padeem, Consul of Innovation; Approach of the Second Sun; Tataru Taru; Noxious Gearhulk; Combustible Gearhulk; Liberator, Urza's Battlethopter; Carpet of Flowers; Bonehoard Dracosaur and 25 more

### #1445 Guide of Souls

- **Finding:** Incomplete implementation · **Severity:** Medium · **Plays:** weaker than printed
- **Coverage:** incorrect — "target attacking/blocking creature" is not read / whenever you attack, you may pay {e}{e}{e}. when you do, put two +1/+1 counters and a flying counter on target attacking creature. it becomes an angel in addition to its other types.
- **Oracle text:** Whenever another creature you control enters, you gain 1 life and get {E} (an energy counter). / Whenever you attack, you may pay {E}{E}{E}. When you do, put two +1/+1 counters and a flying counter on target attacking creature. It becomes an Angel in addition to its other types.
- **Expected:** Pay {E}{E}{E} on attack: two +1/+1 counters, a flying counter, becomes an Angel.
- **Actual:** Only the enter/life/energy trigger is read (without energy gain).
- **Failure classes:** C (Effect never executes), H (Incorrect trigger timing or registration), J (Incorrect counters or token handling)
- **Root cause:** RC15 Whole ability not read (incomplete implementation)
- **Source:** effects.js parseCard leaves the line in fx.unread; coverage.mjs RESTRICTION (l.52) labels the card "restriction" (stronger) when the unread text merely contains "activate only"/"can't"
- **Evidence:** R
- **Same root cause:** Dauthi Voidwalker; Nesting Grounds; Destiny Spinner; Skrelv, Defector Mite; Endurance; Terastodon; Avatar's Wrath; Resourceful Defense; Kozilek, the Great Distortion; Fire Nation Palace; March of Swirling Mist; Druid Class and 47 more

### #1446 Terastodon

- **Finding:** Incomplete implementation · **Severity:** Medium · **Plays:** weaker than printed
- **Coverage:** incorrect — "up to N target" is not read / when ~ enters, you may destroy up to three target noncreature permanents. for each permanent put into a graveyard this way, its controller creates a 3/3 green elephant creature token.
- **Oracle text:** When this creature enters, you may destroy up to three target noncreature permanents. For each permanent put into a graveyard this way, its controller creates a 3/3 green Elephant creature token.
- **Expected:** ETB: destroy up to three target noncreature permanents; their controllers get 3/3 Elephants.
- **Actual:** ETB not read; vanilla 9/9.
- **Failure classes:** C (Effect never executes), E (Incorrect targeting or target legality), J (Incorrect counters or token handling)
- **Root cause:** RC15 Whole ability not read (incomplete implementation); RC10 Multiple / divided / "up to" targets
- **Source:** effects.js parseCard leaves the line in fx.unread; coverage.mjs RESTRICTION (l.52) labels the card "restriction" (stronger) when the unread text merely contains "activate only"/"can't" — effects.js upTo splitter (l.1250-1265) only for MULTI kinds and not for divided/distributed amounts
- **Evidence:** P32
- **Same root cause:** Dauthi Voidwalker; Nesting Grounds; Destiny Spinner; Skrelv, Defector Mite; Endurance; Guide of Souls; Avatar's Wrath; Resourceful Defense; Kozilek, the Great Distortion; Fire Nation Palace; March of Swirling Mist; Druid Class and 50 more

### #1450 Drown in the Loch

- **Finding:** Confirmed defect · **Severity:** Critical · **Plays:** stronger than printed
- **Coverage:** incorrect — a counterspell's mana value limit is not read
- **Oracle text:** Choose one — / • Counter target spell with mana value less than or equal to the number of cards in its controller's graveyard. / • Destroy target creature with mana value less than or equal to the number of cards in its controller's graveyard.
- **Expected:** Counter a spell / destroy a creature with MV <= cards in its controller's graveyard.
- **Actual:** Counters any spell and destroys any creature (MV 8 with an empty graveyard is legal).
- **Failure classes:** E (Incorrect targeting or target legality), G (Incorrect conditions or restrictions), M (Incorrect X-value or variable calculation)
- **Root cause:** RC06 Target qualifiers not enforced (legendary, MV, attacking, dynamic limits)
- **Source:** effects.js targetWords (l.1107) only runs for TARGETED kinds (l.1103): reanimate, counter, steal-with-MV, tutor, regrow get no e.tr; tr has no dynamic limits (X, graveyard size); resolve.js targetFits (l.155) / legalTargets (l.111)
- **Evidence:** P09
- **Same root cause:** Persist; Inti, Seneschal of the Sun; Kozilek's Command; Thieving Skydiver; Not of This World; Haven of the Spirit Dragon; Maelstrom of the Spirit Dragon; Mudflat Village

### #1453 Eldrazi Monument

- **Finding:** Confirmed defect · **Severity:** High · **Plays:** stronger than printed
- **Coverage:** incorrect — an "if" the reader can't read (rules 17: that part does nothing and is reported; before: treated as true)
- **Oracle text:** Creatures you control get +1/+1 and have flying and indestructible. / At the beginning of your upkeep, sacrifice a creature. If you can't, sacrifice this artifact.
- **Expected:** Sacrifice a creature each upkeep; if you can't, sacrifice the Monument.
- **Actual:** Never sacrificed.
- **Failure classes:** G (Incorrect conditions or restrictions)
- **Root cause:** RC01 Unread "if" condition at resolution
- **Source:** effects.js parseCond (l.626, cond17 l.708) returns {c:"?"}; triggers.js evalCond case "?" (l.453) returns !ctx.resolving; resolve.js runEffects case "if" (l.943) forces the else branch or skips
- **Evidence:** P12
- **Same root cause:** Guardian Project; Arena of Glory; Springheart Nantuko; Spelunking; Padeem, Consul of Innovation; Approach of the Second Sun; Tataru Taru; Noxious Gearhulk; Combustible Gearhulk; Liberator, Urza's Battlethopter; Carpet of Flowers; Bonehoard Dracosaur and 25 more

### #1460 Koma, Cosmos Serpent

- **Finding:** Confirmed defect · **Severity:** Medium · **Plays:** weaker than printed
- **Coverage:** restriction — Its activated abilities can't be activated this turn.
- **Oracle text:** This spell can't be countered. / At the beginning of each upkeep, create a 3/3 blue Serpent creature token named Koma's Coil. / Sacrifice another Serpent: Choose one — / • Tap target permanent. Its activated abilities can't be activated this turn. / • Koma gains indestructible until end of turn.
- **Expected:** Tapped permanent's activated abilities can't be activated.
- **Actual:** Tap only.
- **Failure classes:** L (Incorrect continuous effects)
- **Root cause:** RC12 Rider sentences dropped (restrictions and riders)
- **Source:** effects.js droppedSentences (l.2453): "can't be regenerated", "can't block", "doesn't untap", "can't cast spells", kicker riders, suspend riders
- **Evidence:** R
- **Same root cause:** Shatterskull Smashing // Shatterskull, the Hammer Pass; Silver Shroud Costume; Mjölnir, Storm Hammer; Damn; Plaguecrafter; Sundering Eruption // Volcanic Fissure; Kappa Cannoneer; Planar Genesis; Orim's Chant; Junk Winder; Taunt from the Rampart; Single Combat and 5 more

### #1470 Avatar's Wrath

- **Finding:** Incomplete implementation · **Severity:** Medium · **Plays:** weaker than printed
- **Coverage:** incorrect — "up to N target" is not read / choose up to one target creature, then airbend all other creatures. / until your next turn, your opponents can't cast spells from anywhere other than their hands.
- **Oracle text:** Choose up to one target creature, then airbend all other creatures. (Exile them. While each one is exiled, its owner may cast it for {2} rather than its mana cost.) / Until your next turn, your opponents can't cast spells from anywhere other than their hands. / Exile Avatar's Wrath.
- **Expected:** Airbend all other creatures (except one chosen); opponents can't cast spells from outside their hands until your next turn.
- **Actual:** Only "exile this spell" is read: it does nothing.
- **Failure classes:** C (Effect never executes), L (Incorrect continuous effects), E (Incorrect targeting or target legality)
- **Root cause:** RC15 Whole ability not read (incomplete implementation); RC14 Static prohibitions and rule-changing statics not read
- **Source:** effects.js parseCard leaves the line in fx.unread; coverage.mjs RESTRICTION (l.52) labels the card "restriction" (stronger) when the unread text merely contains "activate only"/"can't" — No reading for "players can't activate loyalty abilities", attack caps, "can't attack a player it already attacked", "ignore hexproof", graveyard-cast locks, untap locks
- **Evidence:** R
- **Same root cause:** Dauthi Voidwalker; Nesting Grounds; Destiny Spinner; Skrelv, Defector Mite; Endurance; Guide of Souls; Terastodon; Resourceful Defense; Kozilek, the Great Distortion; Fire Nation Palace; March of Swirling Mist; Druid Class and 56 more

### #1474 Grab the Prize

- **Finding:** Confirmed defect · **Severity:** Low · **Plays:** weaker than printed
- **Coverage:** incorrect — an "if" the reader can't read (rules 17: that part does nothing and is reported; before: treated as true)
- **Oracle text:** As an additional cost to cast this spell, discard a card. / Draw two cards. If the discarded card wasn't a land card, Grab the Prize deals 2 damage to each opponent.
- **Expected:** 2 damage to each opponent if a nonland was discarded.
- **Actual:** Never deals damage.
- **Failure classes:** G (Incorrect conditions or restrictions)
- **Root cause:** RC01 Unread "if" condition at resolution
- **Source:** effects.js parseCond (l.626, cond17 l.708) returns {c:"?"}; triggers.js evalCond case "?" (l.453) returns !ctx.resolving; resolve.js runEffects case "if" (l.943) forces the else branch or skips
- **Evidence:** R
- **Same root cause:** Guardian Project; Arena of Glory; Springheart Nantuko; Spelunking; Padeem, Consul of Innovation; Approach of the Second Sun; Tataru Taru; Noxious Gearhulk; Combustible Gearhulk; Liberator, Urza's Battlethopter; Carpet of Flowers; Bonehoard Dracosaur and 25 more

### #1489 Arid Archway

- **Finding:** Confirmed defect · **Severity:** Low · **Plays:** weaker than printed
- **Coverage:** incorrect — an "if" the reader can't read (rules 17: that part does nothing and is reported; before: treated as true)
- **Oracle text:** This land enters tapped. / When this land enters, return a land you control to its owner's hand. If another Desert was returned this way, surveil 1. (Look at the top card of your library. You may put it into your graveyard.) / {T}: Add {C}{C}.
- **Expected:** Surveil 1 if a Desert was returned.
- **Actual:** Never surveils.
- **Failure classes:** G (Incorrect conditions or restrictions)
- **Root cause:** RC01 Unread "if" condition at resolution
- **Source:** effects.js parseCond (l.626, cond17 l.708) returns {c:"?"}; triggers.js evalCond case "?" (l.453) returns !ctx.resolving; resolve.js runEffects case "if" (l.943) forces the else branch or skips
- **Evidence:** R
- **Same root cause:** Guardian Project; Arena of Glory; Springheart Nantuko; Spelunking; Padeem, Consul of Innovation; Approach of the Second Sun; Tataru Taru; Noxious Gearhulk; Combustible Gearhulk; Liberator, Urza's Battlethopter; Carpet of Flowers; Bonehoard Dracosaur and 25 more

### #1521 Planar Genesis

- **Finding:** Confirmed defect · **Severity:** Low · **Plays:** weaker than printed
- **Coverage:** restriction — If you don't, put a card from among them into your hand.
- **Oracle text:** Look at the top four cards of your library. You may put a land card from among them onto the battlefield tapped. If you don't, put a card from among them into your hand. Put the rest on the bottom of your library in a random order.
- **Expected:** If no land put down, take a card.
- **Actual:** Nothing taken.
- **Failure classes:** D (Incorrect effect resolution)
- **Root cause:** RC11 A player's choice is not asked (punishers, "may have you", optional costs); RC12 Rider sentences dropped (restrictions and riders)
- **Source:** reader keeps one branch of "target opponent may have you draw…", "you may sacrifice…, if you do", "if you don't, put … into your hand" — effects.js droppedSentences (l.2453): "can't be regenerated", "can't block", "doesn't untap", "can't cast spells", kicker riders, suspend riders
- **Evidence:** R
- **Same root cause:** Palantír of Orthanc; Tataru Taru; Combustible Gearhulk; Wilhelt, the Rotcleaver; Risen Reef; Fandaniel, Telophoroi Ascian; Shatterskull Smashing // Shatterskull, the Hammer Pass; Silver Shroud Costume; Mjölnir, Storm Hammer; Damn; Plaguecrafter; Sundering Eruption // Volcanic Fissure and 10 more

### #1532 Resourceful Defense

- **Finding:** Incomplete implementation · **Severity:** Low · **Plays:** weaker than printed
- **Coverage:** incorrect — "target … you control" is not read (a person could aim it at an opponent's permanent) / whenever a permanent you control leaves the battlefield, if it had counters on it, put those counters on target permanent you control. / {4}{w}: move any number of counters from target permanent you control onto a second target permanent you control.
- **Oracle text:** Whenever a permanent you control leaves the battlefield, if it had counters on it, put those counters on target permanent you control. / {4}{W}: Move any number of counters from target permanent you control onto a second target permanent you control.
- **Expected:** Move counters from leaving permanents; move counters between your permanents.
- **Actual:** Nothing read.
- **Failure classes:** C (Effect never executes), J (Incorrect counters or token handling)
- **Root cause:** RC15 Whole ability not read (incomplete implementation); RC19 Counter movement and named counters
- **Source:** effects.js parseCard leaves the line in fx.unread; coverage.mjs RESTRICTION (l.52) labels the card "restriction" (stronger) when the unread text merely contains "activate only"/"can't" — No effect kind for moving counters between permanents; named counters partly modelled
- **Evidence:** R
- **Same root cause:** Dauthi Voidwalker; Nesting Grounds; Destiny Spinner; Skrelv, Defector Mite; Endurance; Guide of Souls; Terastodon; Avatar's Wrath; Kozilek, the Great Distortion; Fire Nation Palace; March of Swirling Mist; Druid Class and 48 more

### #1545 Codsworth, Handy Helper

- **Finding:** Confirmed defect · **Severity:** Low · **Plays:** stronger than printed
- **Coverage:** restriction — Spend this mana only to cast Aura and/or Equipment spells.
- **Oracle text:** Commanders you control have ward {2}. / {T}: Add {W}{W}. Spend this mana only to cast Aura and/or Equipment spells. / {T}: Attach target Aura or Equipment you control to target creature you control. Activate only as a sorcery.
- **Expected:** {W}{W} for Auras/Equipment only.
- **Actual:** Unrestricted.
- **Failure classes:** F (Incorrect mana or additional cost payment)
- **Root cause:** RC03 Spend restrictions on mana not modelled; extra mana lines merged
- **Source:** effects.js mana-line reader (l.2060-2100) keeps only fx.mana.only creatureSpell/creatureAbility and cavern; the colors of every mana line are unioned into one fx.mana; mana.js spendOk (l.38) knows two restrictions
- **Evidence:** R
- **Same root cause:** Delighted Halfling; Secluded Courtyard; Unclaimed Territory; Plaza of Heroes; Throne of Eldraine; Haven of the Spirit Dragon; Giada, Font of Hope; Gwenna, Eyes of Gaea; Great Hall of the Citadel; Maelstrom of the Spirit Dragon; Power Depot; Klauth, Unrivaled Ancient and 10 more

### #1560 Kozilek, the Great Distortion

- **Finding:** Incomplete implementation · **Severity:** Medium · **Plays:** weaker than printed
- **Coverage:** incorrect — a counterspell's mana value limit is not read / discard a card with mana value x: counter target spell with mana value x.
- **Oracle text:** When you cast this spell, if you have fewer than seven cards in hand, draw cards equal to the difference. / Menace / Discard a card with mana value X: Counter target spell with mana value X.
- **Expected:** Discard a card with MV X: counter target spell with MV X.
- **Actual:** Cast trigger (draw to seven) read and checked; the counter ability is not read.
- **Failure classes:** C (Effect never executes), F (Incorrect mana or additional cost payment)
- **Root cause:** RC15 Whole ability not read (incomplete implementation)
- **Source:** effects.js parseCard leaves the line in fx.unread; coverage.mjs RESTRICTION (l.52) labels the card "restriction" (stronger) when the unread text merely contains "activate only"/"can't"
- **Evidence:** R
- **Same root cause:** Dauthi Voidwalker; Nesting Grounds; Destiny Spinner; Skrelv, Defector Mite; Endurance; Guide of Souls; Terastodon; Avatar's Wrath; Resourceful Defense; Fire Nation Palace; March of Swirling Mist; Druid Class and 47 more

### #1563 Unstoppable Slasher

- **Finding:** Confirmed defect · **Severity:** Medium · **Plays:** weaker than printed
- **Coverage:** incorrect — an "if" the reader can't read (rules 17: that part does nothing and is reported; before: treated as true)
- **Oracle text:** Deathtouch / Whenever this creature deals combat damage to a player, they lose half their life, rounded up. / When this creature dies, if it had no counters on it, return it to the battlefield tapped under its owner's control with two stun counters on it.
- **Expected:** Dies with no counters: return tapped with two stun counters.
- **Actual:** Never returns.
- **Failure classes:** G (Incorrect conditions or restrictions), H (Incorrect trigger timing or registration)
- **Root cause:** RC01 Unread "if" condition at resolution
- **Source:** effects.js parseCond (l.626, cond17 l.708) returns {c:"?"}; triggers.js evalCond case "?" (l.453) returns !ctx.resolving; resolve.js runEffects case "if" (l.943) forces the else branch or skips
- **Evidence:** P21
- **Same root cause:** Guardian Project; Arena of Glory; Springheart Nantuko; Spelunking; Padeem, Consul of Innovation; Approach of the Second Sun; Tataru Taru; Noxious Gearhulk; Combustible Gearhulk; Liberator, Urza's Battlethopter; Carpet of Flowers; Bonehoard Dracosaur and 25 more

### #1568 Phelia, Exuberant Shepherd

- **Finding:** Confirmed defect · **Severity:** Low · **Plays:** weaker than printed
- **Coverage:** incorrect — an "if" the reader can't read (rules 17: that part does nothing and is reported; before: treated as true)
- **Oracle text:** Flash / Whenever Phelia attacks, exile up to one other target nonland permanent. At the beginning of the next end step, return that card to the battlefield under its owner's control. If it entered under your control, put a +1/+1 counter on Phelia.
- **Expected:** +1/+1 counter if the returned card entered under your control.
- **Actual:** Never gets the counter.
- **Failure classes:** G (Incorrect conditions or restrictions)
- **Root cause:** RC01 Unread "if" condition at resolution
- **Source:** effects.js parseCond (l.626, cond17 l.708) returns {c:"?"}; triggers.js evalCond case "?" (l.453) returns !ctx.resolving; resolve.js runEffects case "if" (l.943) forces the else branch or skips
- **Evidence:** R
- **Same root cause:** Guardian Project; Arena of Glory; Springheart Nantuko; Spelunking; Padeem, Consul of Innovation; Approach of the Second Sun; Tataru Taru; Noxious Gearhulk; Combustible Gearhulk; Liberator, Urza's Battlethopter; Carpet of Flowers; Bonehoard Dracosaur and 25 more

### #1583 Valakut Exploration

- **Finding:** Confirmed defect · **Severity:** Medium · **Plays:** weaker than printed
- **Coverage:** incorrect — an "if" the reader can't read (rules 17: that part does nothing and is reported; before: treated as true)
- **Oracle text:** Landfall — Whenever a land you control enters, exile the top card of your library. You may play that card for as long as it remains exiled. / At the beginning of your end step, if there are cards exiled with this enchantment, put them into their owner's graveyard, then this enchantment deals that much damage to each opponent.
- **Expected:** Play exiled cards while exiled; end step: bin them and deal that much damage.
- **Actual:** Permission ends this turn; never deals damage.
- **Failure classes:** G (Incorrect conditions or restrictions), P (Incorrect cleanup, expiration or delayed effects)
- **Root cause:** RC01 Unread "if" condition at resolution; RC08 Temporary cast/play permissions missing or too broad
- **Source:** effects.js parseCond (l.626, cond17 l.708) returns {c:"?"}; triggers.js evalCond case "?" (l.453) returns !ctx.resolving; resolve.js runEffects case "if" (l.943) forces the else branch or skips — resolve.js dig/exileTrigCard/exileGy/mill create no mayPlay; gyCastTurn (l.1911) stores types only, so empty types = every nonland card, unlimited; mana.js castModeRaw (l.510)
- **Evidence:** R
- **Same root cause:** Guardian Project; Arena of Glory; Springheart Nantuko; Spelunking; Padeem, Consul of Innovation; Approach of the Second Sun; Tataru Taru; Noxious Gearhulk; Combustible Gearhulk; Liberator, Urza's Battlethopter; Carpet of Flowers; Bonehoard Dracosaur and 37 more

### #1590 Fire Nation Palace

- **Finding:** Incomplete implementation · **Severity:** Low · **Plays:** weaker than printed
- **Coverage:** incorrect — "target … you control" is not read (a person could aim it at an opponent's permanent) / {1}{r}, {t}: target creature you control gains firebending 4 until end of turn.
- **Oracle text:** This land enters tapped unless you control a basic land. / {T}: Add {R}. / {1}{R}, {T}: Target creature you control gains firebending 4 until end of turn. (Whenever it attacks, add {R}{R}{R}{R}. This mana lasts until end of combat.)
- **Expected:** {1}{R},{T}: target creature you control gains firebending 4.
- **Actual:** Only the land's mana and enter condition are read.
- **Failure classes:** C (Effect never executes)
- **Root cause:** RC15 Whole ability not read (incomplete implementation)
- **Source:** effects.js parseCard leaves the line in fx.unread; coverage.mjs RESTRICTION (l.52) labels the card "restriction" (stronger) when the unread text merely contains "activate only"/"can't"
- **Evidence:** R
- **Same root cause:** Dauthi Voidwalker; Nesting Grounds; Destiny Spinner; Skrelv, Defector Mite; Endurance; Guide of Souls; Terastodon; Avatar's Wrath; Resourceful Defense; Kozilek, the Great Distortion; March of Swirling Mist; Druid Class and 47 more

### #1593 Giada, Font of Hope

- **Finding:** Confirmed defect · **Severity:** Low · **Plays:** stronger than printed
- **Coverage:** restriction — Spend this mana only to cast an Angel spell.
- **Oracle text:** Flying, vigilance / Each other Angel you control enters with an additional +1/+1 counter on it for each Angel you already control. / {T}: Add {W}. Spend this mana only to cast an Angel spell.
- **Expected:** {W} for Angels only.
- **Actual:** Unrestricted.
- **Failure classes:** F (Incorrect mana or additional cost payment)
- **Root cause:** RC03 Spend restrictions on mana not modelled; extra mana lines merged
- **Source:** effects.js mana-line reader (l.2060-2100) keeps only fx.mana.only creatureSpell/creatureAbility and cavern; the colors of every mana line are unioned into one fx.mana; mana.js spendOk (l.38) knows two restrictions
- **Evidence:** R
- **Same root cause:** Delighted Halfling; Secluded Courtyard; Unclaimed Territory; Plaza of Heroes; Throne of Eldraine; Haven of the Spirit Dragon; Codsworth, Handy Helper; Gwenna, Eyes of Gaea; Great Hall of the Citadel; Maelstrom of the Spirit Dragon; Power Depot; Klauth, Unrivaled Ancient and 10 more

### #1608 Brass's Tunnel-Grinder // Tecutlan, the Searing Rift

- **Finding:** Confirmed defect · **Severity:** Low · **Plays:** weaker than printed
- **Coverage:** incorrect — an "if" the reader can't read (rules 17: that part does nothing and is reported; before: treated as true) / Then if there are three or more bore counters on it, remove those counters and transform it.
- **Oracle text:** When Brass's Tunnel-Grinder enters, discard any number of cards, then draw that many cards plus one. / At the beginning of your end step, if you descended this turn, put a bore counter on Brass's Tunnel-Grinder. Then if there are three or more bore counters on it, remove those counters and transform it. (You descended if a permanent card was put into your graveyard from anywhere.)
- **Expected:** Bore counter if you descended; transform at three.
- **Actual:** Never gets counters or transforms.
- **Failure classes:** G (Incorrect conditions or restrictions), J (Incorrect counters or token handling)
- **Root cause:** RC01 Unread "if" condition at resolution; RC19 Counter movement and named counters
- **Source:** effects.js parseCond (l.626, cond17 l.708) returns {c:"?"}; triggers.js evalCond case "?" (l.453) returns !ctx.resolving; resolve.js runEffects case "if" (l.943) forces the else branch or skips — No effect kind for moving counters between permanents; named counters partly modelled
- **Evidence:** R
- **Same root cause:** Guardian Project; Arena of Glory; Springheart Nantuko; Spelunking; Padeem, Consul of Innovation; Approach of the Second Sun; Tataru Taru; Noxious Gearhulk; Combustible Gearhulk; Liberator, Urza's Battlethopter; Carpet of Flowers; Bonehoard Dracosaur and 30 more

### #1612 March of Swirling Mist

- **Finding:** Incomplete implementation · **Severity:** Medium · **Plays:** weaker than printed
- **Coverage:** incorrect — "up to N target" is not read / as an additional cost to cast ~, you may exile any number of blue cards from your hand. ~ costs {2} less to cast for each card exiled this way. / up to x target creatures phase out.
- **Oracle text:** As an additional cost to cast this spell, you may exile any number of blue cards from your hand. This spell costs {2} less to cast for each card exiled this way. / Up to X target creatures phase out. (While they're phased out, they're treated as though they don't exist. Each one phases in before its controller untaps during their next untap step.)
- **Expected:** Exile blue cards to reduce cost; up to X target creatures phase out.
- **Actual:** Nothing read.
- **Failure classes:** C (Effect never executes), F (Incorrect mana or additional cost payment), E (Incorrect targeting or target legality)
- **Root cause:** RC15 Whole ability not read (incomplete implementation); RC10 Multiple / divided / "up to" targets
- **Source:** effects.js parseCard leaves the line in fx.unread; coverage.mjs RESTRICTION (l.52) labels the card "restriction" (stronger) when the unread text merely contains "activate only"/"can't" — effects.js upTo splitter (l.1250-1265) only for MULTI kinds and not for divided/distributed amounts
- **Evidence:** R
- **Same root cause:** Dauthi Voidwalker; Nesting Grounds; Destiny Spinner; Skrelv, Defector Mite; Endurance; Guide of Souls; Terastodon; Avatar's Wrath; Resourceful Defense; Kozilek, the Great Distortion; Fire Nation Palace; Druid Class and 50 more

### #1635 Chainer, Nightmare Adept

- **Finding:** Confirmed defect · **Severity:** High · **Plays:** stronger than printed
- **Coverage:** incorrect — "you may play/cast … this turn" is not read / whenever a nontoken creature you control enters, if you didn't cast it from your hand, it gains haste until your next turn.
- **Oracle text:** Discard a card: You may cast a creature spell from your graveyard this turn. Activate only once each turn. / Whenever a nontoken creature you control enters, if you didn't cast it from your hand, it gains haste until your next turn.
- **Expected:** Cast one creature spell from your graveyard this turn (once each turn); non-cast creatures entering gain haste.
- **Actual:** gyCastTurn with no types: any nonland card (Lightning Bolt) is castable from the graveyard, unlimited; the haste trigger is not read.
- **Failure classes:** G (Incorrect conditions or restrictions), P (Incorrect cleanup, expiration or delayed effects)
- **Root cause:** RC08 Temporary cast/play permissions missing or too broad
- **Source:** resolve.js dig/exileTrigCard/exileGy/mill create no mayPlay; gyCastTurn (l.1911) stores types only, so empty types = every nonland card, unlimited; mana.js castModeRaw (l.510)
- **Evidence:** P20
- **Same root cause:** Dauthi Voidwalker; Emry, Lurker of the Loch; Expressive Iteration; Containment Construct; Zul Ashur, Lich Lord; Mnemonic Betrayal; Abdel Adrian, Gorion's Ward; Tablet of Discovery; Dire Fleet Daredevil; Valakut Exploration; Tinybones, Bauble Burglar; Rivaz of the Claw

### #1658 Return to Dust

- **Finding:** Confirmed defect · **Severity:** Low · **Plays:** weaker than printed
- **Coverage:** incorrect — an "if" the reader can't read (rules 17: that part does nothing and is reported; before: treated as true)
- **Oracle text:** Exile target artifact or enchantment. If you cast this spell during your main phase, you may exile up to one other target artifact or enchantment.
- **Expected:** Second exile if cast in your main phase.
- **Actual:** Never exiles a second permanent.
- **Failure classes:** G (Incorrect conditions or restrictions)
- **Root cause:** RC01 Unread "if" condition at resolution
- **Source:** effects.js parseCond (l.626, cond17 l.708) returns {c:"?"}; triggers.js evalCond case "?" (l.453) returns !ctx.resolving; resolve.js runEffects case "if" (l.943) forces the else branch or skips
- **Evidence:** R
- **Same root cause:** Guardian Project; Arena of Glory; Springheart Nantuko; Spelunking; Padeem, Consul of Innovation; Approach of the Second Sun; Tataru Taru; Noxious Gearhulk; Combustible Gearhulk; Liberator, Urza's Battlethopter; Carpet of Flowers; Bonehoard Dracosaur and 25 more

### #1668 Druid Class

- **Finding:** Incomplete implementation · **Severity:** Low · **Plays:** weaker than printed
- **Coverage:** incorrect — "target … you control" is not read (a person could aim it at an opponent's permanent) / when ~ becomes level 3, target land you control becomes a creature with haste and "~'s power and toughness are each equal to the number of lands you control." it's still a land.
- **Oracle text:** (Gain the next level as a sorcery to add its ability.) / Landfall — Whenever a land you control enters, you gain 1 life. / {2}{G}: Level 2 / You may play an additional land on each of your turns. / {4}{G}: Level 3 / When this Class becomes level 3, target land you control becomes a creature with haste and "This creature's power and toughness are each equal to the number of lands you control." It's still a land.
- **Expected:** Level 3: target land you control becomes a haste creature with P/T = lands you control.
- **Actual:** Levels 1-2 read; level 3 trigger not read.
- **Failure classes:** C (Effect never executes), L (Incorrect continuous effects)
- **Root cause:** RC15 Whole ability not read (incomplete implementation)
- **Source:** effects.js parseCard leaves the line in fx.unread; coverage.mjs RESTRICTION (l.52) labels the card "restriction" (stronger) when the unread text merely contains "activate only"/"can't"
- **Evidence:** R
- **Same root cause:** Dauthi Voidwalker; Nesting Grounds; Destiny Spinner; Skrelv, Defector Mite; Endurance; Guide of Souls; Terastodon; Avatar's Wrath; Resourceful Defense; Kozilek, the Great Distortion; Fire Nation Palace; March of Swirling Mist and 47 more

### #1673 Gwenna, Eyes of Gaea

- **Finding:** Confirmed defect · **Severity:** Medium · **Plays:** stronger than printed
- **Coverage:** restriction — Spend this mana only to cast creature spells or activate abilities of creature sources.
- **Oracle text:** {T}: Add two mana in any combination of colors. Spend this mana only to cast creature spells or activate abilities of creature sources. / Whenever you cast a creature spell with power 5 or greater, put a +1/+1 counter on Gwenna and untap it.
- **Expected:** Two mana for creature spells/abilities only; untap on big creatures.
- **Actual:** Unrestricted; no untap.
- **Failure classes:** F (Incorrect mana or additional cost payment)
- **Root cause:** RC03 Spend restrictions on mana not modelled; extra mana lines merged
- **Source:** effects.js mana-line reader (l.2060-2100) keeps only fx.mana.only creatureSpell/creatureAbility and cavern; the colors of every mana line are unioned into one fx.mana; mana.js spendOk (l.38) knows two restrictions
- **Evidence:** R
- **Same root cause:** Delighted Halfling; Secluded Courtyard; Unclaimed Territory; Plaza of Heroes; Throne of Eldraine; Haven of the Spirit Dragon; Codsworth, Handy Helper; Giada, Font of Hope; Great Hall of the Citadel; Maelstrom of the Spirit Dragon; Power Depot; Klauth, Unrivaled Ancient and 10 more

### #1675 Eldrazi Temple

- **Finding:** Incomplete implementation · **Severity:** Low · **Plays:** weaker than printed
- **Coverage:** restriction — Spend this mana only to cast colorless Eldrazi spells or activate abilities of colorless Eldrazi.
- **Oracle text:** {T}: Add {C}. / {T}: Add {C}{C}. Spend this mana only to cast colorless Eldrazi spells or activate abilities of colorless Eldrazi.
- **Expected:** {C}{C} for colorless Eldrazi.
- **Actual:** Only {C}.
- **Failure classes:** F (Incorrect mana or additional cost payment)
- **Root cause:** RC04 Conditional or second mana abilities dropped or made unconditional
- **Source:** effects.js mana lines: manaLines need only for MANA_COND words (l.48); "a Dragon", "entered this turn", "ferocious", "corrupted", "three lands with the same name", second {C}{C} lines are dropped while the color is still added
- **Evidence:** R
- **Same root cause:** Tablet of Discovery; Fanatic of Rhonas; Plaza of Heroes; Floodfarm Verge; Bleachbone Verge; Throne of Eldraine; Shrine of the Forsaken Gods; Nimbus Maze; Great Hall of the Citadel; Urza's Workshop; Sceptre of Eternal Glory; Mox Jasper and 2 more

### #1685 Orim's Chant

- **Finding:** Confirmed defect · **Severity:** Medium · **Plays:** weaker than printed
- **Coverage:** restriction — If this spell was kicked, creatures can't attack this turn.
- **Oracle text:** Kicker {W} (You may pay an additional {W} as you cast this spell.) / Target player can't cast spells this turn. If this spell was kicked, creatures can't attack this turn.
- **Expected:** Kicked: creatures can't attack.
- **Actual:** Kicker rider dropped.
- **Failure classes:** G (Incorrect conditions or restrictions)
- **Root cause:** RC12 Rider sentences dropped (restrictions and riders)
- **Source:** effects.js droppedSentences (l.2453): "can't be regenerated", "can't block", "doesn't untap", "can't cast spells", kicker riders, suspend riders
- **Evidence:** R
- **Same root cause:** Shatterskull Smashing // Shatterskull, the Hammer Pass; Silver Shroud Costume; Mjölnir, Storm Hammer; Damn; Plaguecrafter; Sundering Eruption // Volcanic Fissure; Kappa Cannoneer; Koma, Cosmos Serpent; Planar Genesis; Junk Winder; Taunt from the Rampart; Single Combat and 5 more

### #1694 Savage Ventmaw

- **Finding:** Confirmed defect · **Severity:** Medium · **Plays:** weaker than printed
- **Coverage:** restriction — Until end of turn, you don't lose this mana as steps and phases end.
- **Oracle text:** Flying / Whenever this creature attacks, add {R}{R}{R}{G}{G}{G}. Until end of turn, you don't lose this mana as steps and phases end.
- **Expected:** Mana stays until end of turn.
- **Actual:** Empties at the next phase change.
- **Failure classes:** F (Incorrect mana or additional cost payment)
- **Root cause:** RC05 Mana that persists through steps and phases
- **Source:** engine.js setPhase (l.319) empties every pool except keepRed
- **Evidence:** P38 (same path)
- **Same root cause:** Birgi, God of Storytelling // Harnfel, Horn of Bounty; Klauth, Unrivaled Ancient; Karn, Legacy Reforged; Rousing Refrain

### #1695 Massacre Girl, Known Killer

- **Finding:** Confirmed defect · **Severity:** Medium · **Plays:** weaker than printed
- **Coverage:** incorrect — an "if" the reader can't read (rules 17: that part does nothing and is reported; before: treated as true)
- **Oracle text:** Menace / Creatures you control have wither. (They deal damage to creatures in the form of -1/-1 counters.) / Whenever a creature an opponent controls dies, if its toughness was less than 1, draw a card.
- **Expected:** Draw when an opponent's creature with toughness < 1 dies.
- **Actual:** Never draws.
- **Failure classes:** G (Incorrect conditions or restrictions)
- **Root cause:** RC01 Unread "if" condition at resolution
- **Source:** effects.js parseCond (l.626, cond17 l.708) returns {c:"?"}; triggers.js evalCond case "?" (l.453) returns !ctx.resolving; resolve.js runEffects case "if" (l.943) forces the else branch or skips
- **Evidence:** R
- **Same root cause:** Guardian Project; Arena of Glory; Springheart Nantuko; Spelunking; Padeem, Consul of Innovation; Approach of the Second Sun; Tataru Taru; Noxious Gearhulk; Combustible Gearhulk; Liberator, Urza's Battlethopter; Carpet of Flowers; Bonehoard Dracosaur and 25 more

### #1741 Painful Truths

- **Finding:** Confirmed defect · **Severity:** Medium · **Plays:** weaker than printed
- **Coverage:** incorrect — "X, where X is …" is left as the X paid on casting (plays as 0)
- **Oracle text:** Converge — You draw X cards and lose X life, where X is the number of colors of mana spent to cast this spell.
- **Expected:** Draw X and lose X life, X = colors of mana spent.
- **Actual:** X is dyn "?" = 0: draws nothing, loses nothing.
- **Failure classes:** M (Incorrect X-value or variable calculation)
- **Root cause:** RC09 "X, where X is …" left as paid X (0)
- **Source:** effects.js xWhere reader (l.1047-1074) returns {dyn:"?"}; resolve.js X() reads it as 0; roll passes x only to its table rows
- **Evidence:** P06
- **Same root cause:** Palantír of Orthanc; Quartzwood Crasher; Kozilek's Command; Pact of the Serpent; Ancient Bronze Dragon; Prime Speaker Zegana; Sunfall; Carpet of Flowers; Karn, Legacy Reforged; Meathook Massacre II; Well of Lost Dreams; Call the Coppercoats

### #1742 Delina, Wild Mage

- **Finding:** Confirmed defect · **Severity:** High · **Plays:** differently from printed
- **Coverage:** incorrect — "target … you control" is not read (a person could aim it at an opponent's permanent) / 15—20 | create one of those tokens. you may roll again.
- **Oracle text:** Whenever Delina attacks, choose target creature you control, then roll a d20. / 1—14 | Create a tapped and attacking token that's a copy of that creature, except it's not legendary and it has "At end of combat, exile this token." / 15—20 | Create one of those tokens. You may roll again.
- **Expected:** On 1-14 create a tapped attacking non-legendary token copy of target creature you control (exiled at end of combat); 15-20 also roll again.
- **Actual:** The token's "exile this token" rider is bound to Delina: on 1-14 Delina herself is exiled and no token is made.
- **Failure classes:** B (Recognized but incorrectly constructed), D (Incorrect effect resolution), I (Incorrect zone movement)
- **Root cause:** RC13 Clause bound to the wrong object or read as the wrong effect; RC18 Random results and modal constraints
- **Source:** Token riders ("exile this token", "sacrifice this token") read as exileSelf/sacSelf of the source; copyToken "of it" falls back to src (resolve.js l.439-441); pumpTrig reads ctx.trig.o; conditions read as unconditional; modal text misread — roll tables read partly; coin flips with outcomes; "each mode must target a different player"
- **Evidence:** P01
- **Same root cause:** Expressive Iteration; Hunter's Insight; Not Dead After All; Inti, Seneschal of the Sun; Kozilek's Command; Court of Garenbrig; Gilded Drake; Abdel Adrian, Gorion's Ward; Sunfall; Court of Vantress; Charming Scoundrel; Springheart Nantuko and 7 more

### #1761 Vorinclex, Voice of Hunger

- **Finding:** Confirmed defect · **Severity:** Medium · **Plays:** weaker than printed
- **Coverage:** restriction — whenever an opponent taps a land for mana, that land doesn't untap during its controller's next untap step.
- **Oracle text:** Trample / Whenever you tap a land for mana, add one mana of any type that land produced. / Whenever an opponent taps a land for mana, that land doesn't untap during its controller's next untap step.
- **Expected:** Opponents' tapped lands don't untap.
- **Actual:** Not read.
- **Failure classes:** L (Incorrect continuous effects)
- **Root cause:** RC14 Static prohibitions and rule-changing statics not read
- **Source:** No reading for "players can't activate loyalty abilities", attack caps, "can't attack a player it already attacked", "ignore hexproof", graveyard-cast locks, untap locks
- **Evidence:** R
- **Same root cause:** Avatar's Wrath; The Aetherspark; The Eternal Wanderer; Port Razer; Bloodthirsty Blade; The Immortal Sun; Bloodthirster; Mirri, Weatherlight Duelist; Nowhere to Run; Stormtide Leviathan; Soulless Jailer; Rite of the Raging Storm

### #1766 Shigeki, Jukai Visionary

- **Finding:** Incomplete implementation · **Severity:** Low · **Plays:** weaker than printed
- **Coverage:** incorrect — "target (non)legendary" is not read
- **Oracle text:** {1}{G}, {T}, Return Shigeki to its owner's hand: Reveal the top four cards of your library. You may put a land card from among them onto the battlefield tapped. Put the rest into your graveyard. / Channel — {X}{X}{G}{G}, Discard this card: Return X target nonlegendary cards from your graveyard to your hand.
- **Expected:** Channel: return X target nonlegendary cards from your graveyard to hand.
- **Actual:** Channel cost read with no effect.
- **Failure classes:** C (Effect never executes), E (Incorrect targeting or target legality), I (Incorrect zone movement)
- **Root cause:** RC15 Whole ability not read (incomplete implementation)
- **Source:** effects.js parseCard leaves the line in fx.unread; coverage.mjs RESTRICTION (l.52) labels the card "restriction" (stronger) when the unread text merely contains "activate only"/"can't"
- **Evidence:** R
- **Same root cause:** Dauthi Voidwalker; Nesting Grounds; Destiny Spinner; Skrelv, Defector Mite; Endurance; Guide of Souls; Terastodon; Avatar's Wrath; Resourceful Defense; Kozilek, the Great Distortion; Fire Nation Palace; March of Swirling Mist and 47 more

### #1791 The Aetherspark

- **Finding:** Confirmed defect · **Severity:** Medium · **Plays:** weaker than printed
- **Coverage:** restriction — as long as ~ is attached to a creature, ~ can't be attacked and has "whenever equipped creature deals combat damage during your turn, put that many loyalty counters on ~."
- **Oracle text:** As long as The Aetherspark is attached to a creature, The Aetherspark can't be attacked and has "Whenever equipped creature deals combat damage during your turn, put that many loyalty counters on The Aetherspark." / +1: Attach The Aetherspark to up to one target creature you control. Put a +1/+1 counter on that creature. / −5: Draw two cards. / −10: Add ten mana of any one color.
- **Expected:** Can't be attacked while attached; loyalty from damage; -10 mana.
- **Actual:** Statics and -10 unread; +1 attaches to the engine's pick.
- **Failure classes:** C (Effect never executes), E (Incorrect targeting or target legality), L (Incorrect continuous effects)
- **Root cause:** RC14 Static prohibitions and rule-changing statics not read; RC07 Engine-chosen object replaces a printed target; RC15 Whole ability not read (incomplete implementation)
- **Source:** No reading for "players can't activate loyalty abilities", attack caps, "can't attack a player it already attacked", "ignore hexproof", graveyard-cast locks, untap locks — resolve.js attachSelf (l.1432 bestOwn), ignition (l.1569 bestOwnCreature), doubleCounters (l.1205 bestOwn), draw dyn maxPower — effects.js parseCard leaves the line in fx.unread; coverage.mjs RESTRICTION (l.52) labels the card "restriction" (stronger) when the unread text merely contains "activate only"/"can't"
- **Evidence:** R
- **Same root cause:** Avatar's Wrath; Vorinclex, Voice of Hunger; The Eternal Wanderer; Port Razer; Bloodthirsty Blade; The Immortal Sun; Bloodthirster; Mirri, Weatherlight Duelist; Nowhere to Run; Stormtide Leviathan; Soulless Jailer; Rite of the Raging Storm and 62 more

### #1795 The Eternal Wanderer

- **Finding:** Confirmed defect · **Severity:** Medium · **Plays:** weaker than printed
- **Coverage:** restriction — no more than one creature can attack ~ each combat.
- **Oracle text:** No more than one creature can attack The Eternal Wanderer each combat. / +1: Exile up to one target artifact or creature. Return that card to the battlefield under its owner's control at the beginning of that player's next end step. / 0: Create a 2/2 white Samurai creature token with double strike. / −4: For each player, choose a creature that player controls. Each player sacrifices all creatures they control not chosen this way.
- **Expected:** Only one attacker each combat; -4 board wipe.
- **Actual:** Neither read.
- **Failure classes:** L (Incorrect continuous effects), C (Effect never executes)
- **Root cause:** RC14 Static prohibitions and rule-changing statics not read; RC15 Whole ability not read (incomplete implementation)
- **Source:** No reading for "players can't activate loyalty abilities", attack caps, "can't attack a player it already attacked", "ignore hexproof", graveyard-cast locks, untap locks — effects.js parseCard leaves the line in fx.unread; coverage.mjs RESTRICTION (l.52) labels the card "restriction" (stronger) when the unread text merely contains "activate only"/"can't"
- **Evidence:** R
- **Same root cause:** Avatar's Wrath; Vorinclex, Voice of Hunger; The Aetherspark; Port Razer; Bloodthirsty Blade; The Immortal Sun; Bloodthirster; Mirri, Weatherlight Duelist; Nowhere to Run; Stormtide Leviathan; Soulless Jailer; Rite of the Raging Storm and 56 more

### #1804 Nimbus Maze

- **Finding:** Confirmed defect · **Severity:** Low · **Plays:** stronger than printed
- **Coverage:** restriction — Activate only if you control an Island.
- **Oracle text:** {T}: Add {C}. / {T}: Add {W}. Activate only if you control an Island. / {T}: Add {U}. Activate only if you control a Plains.
- **Expected:** {W}/{U} only with an Island/Plains.
- **Actual:** Unconditional.
- **Failure classes:** F (Incorrect mana or additional cost payment), G (Incorrect conditions or restrictions)
- **Root cause:** RC04 Conditional or second mana abilities dropped or made unconditional
- **Source:** effects.js mana lines: manaLines need only for MANA_COND words (l.48); "a Dragon", "entered this turn", "ferocious", "corrupted", "three lands with the same name", second {C}{C} lines are dropped while the color is still added
- **Evidence:** P37 (same path)
- **Same root cause:** Tablet of Discovery; Fanatic of Rhonas; Plaza of Heroes; Floodfarm Verge; Bleachbone Verge; Throne of Eldraine; Shrine of the Forsaken Gods; Eldrazi Temple; Great Hall of the Citadel; Urza's Workshop; Sceptre of Eternal Glory; Mox Jasper and 2 more

### #1808 Great Hall of the Citadel

- **Finding:** Confirmed defect · **Severity:** Medium · **Plays:** stronger than printed
- **Coverage:** restriction — {1}, {T}: Add two mana in any combination of colors. / Spend this mana only to cast legendary spells.
- **Oracle text:** {T}: Add {C}. / {1}, {T}: Add two mana in any combination of colors. Spend this mana only to cast legendary spells.
- **Expected:** {T}: {C}; {1},{T}: two any-color mana for legendary spells.
- **Actual:** {T}: one mana of any color, unrestricted.
- **Failure classes:** F (Incorrect mana or additional cost payment)
- **Root cause:** RC03 Spend restrictions on mana not modelled; extra mana lines merged; RC04 Conditional or second mana abilities dropped or made unconditional
- **Source:** effects.js mana-line reader (l.2060-2100) keeps only fx.mana.only creatureSpell/creatureAbility and cavern; the colors of every mana line are unioned into one fx.mana; mana.js spendOk (l.38) knows two restrictions — effects.js mana lines: manaLines need only for MANA_COND words (l.48); "a Dragon", "entered this turn", "ferocious", "corrupted", "three lands with the same name", second {C}{C} lines are dropped while the color is still added
- **Evidence:** P36
- **Same root cause:** Delighted Halfling; Secluded Courtyard; Unclaimed Territory; Plaza of Heroes; Throne of Eldraine; Haven of the Spirit Dragon; Codsworth, Handy Helper; Giada, Font of Hope; Gwenna, Eyes of Gaea; Maelstrom of the Spirit Dragon; Power Depot; Klauth, Unrivaled Ancient and 22 more

### #1812 Silver Shroud Costume

- **Finding:** Confirmed defect · **Severity:** Low · **Plays:** differently from printed
- **Coverage:** incorrect — "target … you control" is not read (a person could aim it at an opponent's permanent) / That creature gains shroud until end of turn.
- **Oracle text:** Flash / When this Equipment enters, attach it to target creature you control. That creature gains shroud until end of turn. (It can't be the target of spells or abilities.) / Equipped creature can't be blocked. / Equip {3}
- **Expected:** ETB attach to target creature you control; it gains shroud until end of turn.
- **Actual:** Engine picks the creature; the shroud sentence is dropped.
- **Failure classes:** E (Incorrect targeting or target legality), L (Incorrect continuous effects)
- **Root cause:** RC07 Engine-chosen object replaces a printed target; RC12 Rider sentences dropped (restrictions and riders)
- **Source:** resolve.js attachSelf (l.1432 bestOwn), ignition (l.1569 bestOwnCreature), doubleCounters (l.1205 bestOwn), draw dyn maxPower — effects.js droppedSentences (l.2453): "can't be regenerated", "can't block", "doesn't untap", "can't cast spells", kicker riders, suspend riders
- **Evidence:** R + P18 (same attachSelf path)
- **Same root cause:** Mithril Coat; Chandra's Ignition; Celestial Armor; Mjölnir, Storm Hammer; Soul's Majesty; The Aetherspark; Shatterskull Smashing // Shatterskull, the Hammer Pass; Damn; Plaguecrafter; Sundering Eruption // Volcanic Fissure; Kappa Cannoneer; Koma, Cosmos Serpent and 10 more

### #1835 Containment Construct

- **Finding:** Confirmed defect · **Severity:** Medium · **Plays:** weaker than printed
- **Coverage:** incorrect — "you may play/cast … this turn" is not read / If you do, you may play that card this turn.
- **Oracle text:** Whenever you discard a card, you may exile that card from your graveyard. If you do, you may play that card this turn.
- **Expected:** Exile a discarded card; you may play it this turn.
- **Actual:** exileTrigCard exiles the card with no mayPlay: discarded cards are simply lost.
- **Failure classes:** I (Incorrect zone movement), P (Incorrect cleanup, expiration or delayed effects)
- **Root cause:** RC08 Temporary cast/play permissions missing or too broad
- **Source:** resolve.js dig/exileTrigCard/exileGy/mill create no mayPlay; gyCastTurn (l.1911) stores types only, so empty types = every nonland card, unlimited; mana.js castModeRaw (l.510)
- **Evidence:** T: resolve.js exileTrigCard
- **Same root cause:** Dauthi Voidwalker; Emry, Lurker of the Loch; Expressive Iteration; Chainer, Nightmare Adept; Zul Ashur, Lich Lord; Mnemonic Betrayal; Abdel Adrian, Gorion's Ward; Tablet of Discovery; Dire Fleet Daredevil; Valakut Exploration; Tinybones, Bauble Burglar; Rivaz of the Claw

### #1878 Junk Winder

- **Finding:** Confirmed defect · **Severity:** Low · **Plays:** weaker than printed
- **Coverage:** restriction — It doesn't untap during its controller's next untap step.
- **Oracle text:** Affinity for tokens (This spell costs {1} less to cast for each token you control.) / Whenever a token you control enters, tap target nonland permanent an opponent controls. It doesn't untap during its controller's next untap step.
- **Expected:** Tapped permanent doesn't untap.
- **Actual:** Rider dropped.
- **Failure classes:** L (Incorrect continuous effects)
- **Root cause:** RC12 Rider sentences dropped (restrictions and riders)
- **Source:** effects.js droppedSentences (l.2453): "can't be regenerated", "can't block", "doesn't untap", "can't cast spells", kicker riders, suspend riders
- **Evidence:** R
- **Same root cause:** Shatterskull Smashing // Shatterskull, the Hammer Pass; Silver Shroud Costume; Mjölnir, Storm Hammer; Damn; Plaguecrafter; Sundering Eruption // Volcanic Fissure; Kappa Cannoneer; Koma, Cosmos Serpent; Planar Genesis; Orim's Chant; Taunt from the Rampart; Single Combat and 5 more

### #1930 Taunt from the Rampart

- **Finding:** Confirmed defect · **Severity:** Low · **Plays:** weaker than printed
- **Coverage:** restriction — Until your next turn, those creatures can't block.
- **Oracle text:** Goad all creatures your opponents control. Until your next turn, those creatures can't block. (Until your next turn, those creatures attack each combat if able and attack a player other than you if able.)
- **Expected:** Goaded creatures can't block.
- **Actual:** Rider dropped.
- **Failure classes:** L (Incorrect continuous effects)
- **Root cause:** RC12 Rider sentences dropped (restrictions and riders)
- **Source:** effects.js droppedSentences (l.2453): "can't be regenerated", "can't block", "doesn't untap", "can't cast spells", kicker riders, suspend riders
- **Evidence:** R
- **Same root cause:** Shatterskull Smashing // Shatterskull, the Hammer Pass; Silver Shroud Costume; Mjölnir, Storm Hammer; Damn; Plaguecrafter; Sundering Eruption // Volcanic Fissure; Kappa Cannoneer; Koma, Cosmos Serpent; Planar Genesis; Orim's Chant; Junk Winder; Single Combat and 5 more

### #1938 Inti, Seneschal of the Sun

- **Finding:** Confirmed defect · **Severity:** Medium · **Plays:** weaker than printed
- **Coverage:** incorrect — "target attacking/blocking creature" is not read / When you do, put a +1/+1 counter on target attacking creature.
- **Oracle text:** Whenever you attack, you may discard a card. When you do, put a +1/+1 counter on target attacking creature. It gains trample until end of turn. / Whenever you discard one or more cards, exile the top card of your library. You may play that card until your next end step.
- **Expected:** Optional discard; when you do, +1/+1 counter and trample on target attacking creature.
- **Actual:** Attack trigger does nothing (pumpTrig reads ctx.trig.o, unset for "you attack"); no discard asked; impulse trigger works.
- **Failure classes:** B (Recognized but incorrectly constructed), E (Incorrect targeting or target legality), F (Incorrect mana or additional cost payment), H (Incorrect trigger timing or registration)
- **Root cause:** RC13 Clause bound to the wrong object or read as the wrong effect; RC06 Target qualifiers not enforced (legendary, MV, attacking, dynamic limits)
- **Source:** Token riders ("exile this token", "sacrifice this token") read as exileSelf/sacSelf of the source; copyToken "of it" falls back to src (resolve.js l.439-441); pumpTrig reads ctx.trig.o; conditions read as unconditional; modal text misread — effects.js targetWords (l.1107) only runs for TARGETED kinds (l.1103): reanimate, counter, steal-with-MV, tutor, regrow get no e.tr; tr has no dynamic limits (X, graveyard size); resolve.js targetFits (l.155) / legalTargets (l.111)
- **Evidence:** P22
- **Same root cause:** Expressive Iteration; Hunter's Insight; Not Dead After All; Delina, Wild Mage; Kozilek's Command; Court of Garenbrig; Gilded Drake; Abdel Adrian, Gorion's Ward; Sunfall; Court of Vantress; Charming Scoundrel; Springheart Nantuko and 12 more

### #1954 Maelstrom of the Spirit Dragon

- **Finding:** Confirmed defect · **Severity:** Medium · **Plays:** stronger than printed
- **Coverage:** restriction — Spend this mana only to cast a Dragon spell or an Omen spell.
- **Oracle text:** {T}: Add {C}. / {T}: Add one mana of any color. Spend this mana only to cast a Dragon spell or an Omen spell. / {4}, {T}, Sacrifice this land: Search your library for a Dragon card, reveal it, put it into your hand, then shuffle.
- **Expected:** Mana for Dragons/Omens; tutor a Dragon.
- **Actual:** Unrestricted mana; tutors any card.
- **Failure classes:** F (Incorrect mana or additional cost payment), G (Incorrect conditions or restrictions)
- **Root cause:** RC03 Spend restrictions on mana not modelled; extra mana lines merged; RC06 Target qualifiers not enforced (legendary, MV, attacking, dynamic limits)
- **Source:** effects.js mana-line reader (l.2060-2100) keeps only fx.mana.only creatureSpell/creatureAbility and cavern; the colors of every mana line are unioned into one fx.mana; mana.js spendOk (l.38) knows two restrictions — effects.js targetWords (l.1107) only runs for TARGETED kinds (l.1103): reanimate, counter, steal-with-MV, tutor, regrow get no e.tr; tr has no dynamic limits (X, graveyard size); resolve.js targetFits (l.155) / legalTargets (l.111)
- **Evidence:** P40
- **Same root cause:** Delighted Halfling; Secluded Courtyard; Unclaimed Territory; Plaza of Heroes; Throne of Eldraine; Haven of the Spirit Dragon; Codsworth, Handy Helper; Giada, Font of Hope; Gwenna, Eyes of Gaea; Great Hall of the Citadel; Power Depot; Klauth, Unrivaled Ancient and 16 more

### #1969 Port Razer

- **Finding:** Confirmed defect · **Severity:** Medium · **Plays:** stronger than printed
- **Coverage:** restriction — ~ can't attack a player it has already attacked this turn.
- **Oracle text:** Whenever this creature deals combat damage to a player, untap each creature you control. After this phase, there is an additional combat phase. / This creature can't attack a player it has already attacked this turn.
- **Expected:** Can't attack a player it already attacked; untap all your creatures.
- **Actual:** Restriction not read.
- **Failure classes:** G (Incorrect conditions or restrictions)
- **Root cause:** RC14 Static prohibitions and rule-changing statics not read
- **Source:** No reading for "players can't activate loyalty abilities", attack caps, "can't attack a player it already attacked", "ignore hexproof", graveyard-cast locks, untap locks
- **Evidence:** R
- **Same root cause:** Avatar's Wrath; Vorinclex, Voice of Hunger; The Aetherspark; The Eternal Wanderer; Bloodthirsty Blade; The Immortal Sun; Bloodthirster; Mirri, Weatherlight Duelist; Nowhere to Run; Stormtide Leviathan; Soulless Jailer; Rite of the Raging Storm

### #1974 Nasty End

- **Finding:** Confirmed defect · **Severity:** Low · **Plays:** weaker than printed
- **Coverage:** incorrect — an "if" the reader can't read (rules 17: that part does nothing and is reported; before: treated as true)
- **Oracle text:** As an additional cost to cast this spell, sacrifice a creature. / Draw two cards. If the sacrificed creature was legendary, draw three cards instead.
- **Expected:** Draw 3 if the sacrificed creature was legendary, else 2.
- **Actual:** Always 2.
- **Failure classes:** G (Incorrect conditions or restrictions)
- **Root cause:** RC01 Unread "if" condition at resolution
- **Source:** effects.js parseCond (l.626, cond17 l.708) returns {c:"?"}; triggers.js evalCond case "?" (l.453) returns !ctx.resolving; resolve.js runEffects case "if" (l.943) forces the else branch or skips
- **Evidence:** R
- **Same root cause:** Guardian Project; Arena of Glory; Springheart Nantuko; Spelunking; Padeem, Consul of Innovation; Approach of the Second Sun; Tataru Taru; Noxious Gearhulk; Combustible Gearhulk; Liberator, Urza's Battlethopter; Carpet of Flowers; Bonehoard Dracosaur and 25 more

### #1998 Power Depot

- **Finding:** Confirmed defect · **Severity:** Low · **Plays:** stronger than printed
- **Coverage:** restriction — Spend this mana only to cast artifact spells or activate abilities of artifacts.
- **Oracle text:** This land enters tapped. / {T}: Add {C}. / {T}: Add one mana of any color. Spend this mana only to cast artifact spells or activate abilities of artifacts. / Modular 1
- **Expected:** Any color for artifacts only.
- **Actual:** Unrestricted.
- **Failure classes:** F (Incorrect mana or additional cost payment)
- **Root cause:** RC03 Spend restrictions on mana not modelled; extra mana lines merged
- **Source:** effects.js mana-line reader (l.2060-2100) keeps only fx.mana.only creatureSpell/creatureAbility and cavern; the colors of every mana line are unioned into one fx.mana; mana.js spendOk (l.38) knows two restrictions
- **Evidence:** R
- **Same root cause:** Delighted Halfling; Secluded Courtyard; Unclaimed Territory; Plaza of Heroes; Throne of Eldraine; Haven of the Spirit Dragon; Codsworth, Handy Helper; Giada, Font of Hope; Gwenna, Eyes of Gaea; Great Hall of the Citadel; Maelstrom of the Spirit Dragon; Klauth, Unrivaled Ancient and 10 more

### #2004 Quartzwood Crasher

- **Finding:** Confirmed defect · **Severity:** Medium · **Plays:** weaker than printed
- **Coverage:** incorrect — "X, where X is …" is left as the X paid on casting (plays as 0)
- **Oracle text:** Trample / Whenever one or more creatures you control with trample deal combat damage to a player, create an X/X green Dinosaur Beast creature token with trample, where X is the amount of damage those creatures dealt to that player.
- **Expected:** Create an X/X Dinosaur Beast, X = damage dealt.
- **Actual:** X is dyn "?" = 0: a 0/0 that dies.
- **Failure classes:** M (Incorrect X-value or variable calculation), J (Incorrect counters or token handling)
- **Root cause:** RC09 "X, where X is …" left as paid X (0)
- **Source:** effects.js xWhere reader (l.1047-1074) returns {dyn:"?"}; resolve.js X() reads it as 0; roll passes x only to its table rows
- **Evidence:** R + P06 (same path)
- **Same root cause:** Palantír of Orthanc; Painful Truths; Kozilek's Command; Pact of the Serpent; Ancient Bronze Dragon; Prime Speaker Zegana; Sunfall; Carpet of Flowers; Karn, Legacy Reforged; Meathook Massacre II; Well of Lost Dreams; Call the Coppercoats

### #2037 Kozilek's Command

- **Finding:** Confirmed defect · **Severity:** Medium · **Plays:** differently from printed
- **Coverage:** incorrect — "target … with mana value N or less/greater" is not read
- **Oracle text:** Choose two — / • Target player creates X 0/1 colorless Eldrazi Spawn creature tokens with "Sacrifice this token: Add {C}." / • Target player scries X, then draws a card. / • Exile target creature with mana value X or less. / • Exile up to X target cards from graveyards.
- **Expected:** Two of: X Spawn tokens; scry X then draw; exile creature MV <= X; exile up to X graveyard cards.
- **Actual:** Mode 1 adds one {C}; mode 2 draws without scry; mode 3 exiles any creature; mode 4 missing.
- **Failure classes:** B (Recognized but incorrectly constructed), E (Incorrect targeting or target legality), M (Incorrect X-value or variable calculation)
- **Root cause:** RC13 Clause bound to the wrong object or read as the wrong effect; RC06 Target qualifiers not enforced (legendary, MV, attacking, dynamic limits); RC09 "X, where X is …" left as paid X (0)
- **Source:** Token riders ("exile this token", "sacrifice this token") read as exileSelf/sacSelf of the source; copyToken "of it" falls back to src (resolve.js l.439-441); pumpTrig reads ctx.trig.o; conditions read as unconditional; modal text misread — effects.js targetWords (l.1107) only runs for TARGETED kinds (l.1103): reanimate, counter, steal-with-MV, tutor, regrow get no e.tr; tr has no dynamic limits (X, graveyard size); resolve.js targetFits (l.155) / legalTargets (l.111) — effects.js xWhere reader (l.1047-1074) returns {dyn:"?"}; resolve.js X() reads it as 0; roll passes x only to its table rows
- **Evidence:** P24
- **Same root cause:** Expressive Iteration; Hunter's Insight; Not Dead After All; Delina, Wild Mage; Inti, Seneschal of the Sun; Court of Garenbrig; Gilded Drake; Abdel Adrian, Gorion's Ward; Sunfall; Court of Vantress; Charming Scoundrel; Springheart Nantuko and 23 more

### #2038 Alchemist's Talent

- **Finding:** Confirmed defect · **Severity:** Low · **Plays:** weaker than printed
- **Coverage:** incorrect — an "if" the reader can't read (rules 17: that part does nothing and is reported; before: treated as true)
- **Oracle text:** (Gain the next level as a sorcery to add its ability.) / When this Class enters, create two tapped Treasure tokens. / {1}{R}: Level 2 / Treasures you control have "{T}, Sacrifice this artifact: Add two mana of any one color." / {4}{R}: Level 3 / Whenever you cast a spell, if mana from a Treasure was spent to cast it, this Class deals damage equal to that spell's mana value to each opponent.
- **Expected:** Level 3: damage = MV when Treasure mana cast the spell.
- **Actual:** Never deals damage.
- **Failure classes:** G (Incorrect conditions or restrictions)
- **Root cause:** RC01 Unread "if" condition at resolution
- **Source:** effects.js parseCond (l.626, cond17 l.708) returns {c:"?"}; triggers.js evalCond case "?" (l.453) returns !ctx.resolving; resolve.js runEffects case "if" (l.943) forces the else branch or skips
- **Evidence:** R
- **Same root cause:** Guardian Project; Arena of Glory; Springheart Nantuko; Spelunking; Padeem, Consul of Innovation; Approach of the Second Sun; Tataru Taru; Noxious Gearhulk; Combustible Gearhulk; Liberator, Urza's Battlethopter; Carpet of Flowers; Bonehoard Dracosaur and 25 more

### #2043 Eladamri, Korvecdal

- **Finding:** Incomplete implementation · **Severity:** Low · **Plays:** weaker than printed
- **Coverage:** restriction — {g}, {t}, tap two untapped creatures you control: reveal a card from your hand or the top card of your library. if you reveal a creature card this way, put it onto the battlefield. activate only during your turn.
- **Oracle text:** You may look at the top card of your library any time. / You may cast creature spells from the top of your library. / {G}, {T}, Tap two untapped creatures you control: Reveal a card from your hand or the top card of your library. If you reveal a creature card this way, put it onto the battlefield. Activate only during your turn.
- **Expected:** Reveal and put a creature onto the battlefield.
- **Actual:** Not read.
- **Failure classes:** C (Effect never executes)
- **Root cause:** RC15 Whole ability not read (incomplete implementation)
- **Source:** effects.js parseCard leaves the line in fx.unread; coverage.mjs RESTRICTION (l.52) labels the card "restriction" (stronger) when the unread text merely contains "activate only"/"can't"
- **Evidence:** R
- **Same root cause:** Dauthi Voidwalker; Nesting Grounds; Destiny Spinner; Skrelv, Defector Mite; Endurance; Guide of Souls; Terastodon; Avatar's Wrath; Resourceful Defense; Kozilek, the Great Distortion; Fire Nation Palace; March of Swirling Mist and 47 more

### #2048 Grist, the Hunger Tide

- **Finding:** Confirmed defect · **Severity:** Medium · **Plays:** weaker than printed
- **Coverage:** incorrect — an "if" the reader can't read (rules 17: that part does nothing and is reported; before: treated as true) / as long as ~ isn't on the battlefield, it's a 1/1 insect creature in addition to its other types.
- **Oracle text:** As long as Grist isn't on the battlefield, it's a 1/1 Insect creature in addition to its other types. / +1: Create a 1/1 black and green Insect creature token, then mill a card. If an Insect card was milled this way, put a loyalty counter on Grist and repeat this process. / −2: You may sacrifice a creature. When you do, destroy target creature or planeswalker. / −5: Each opponent loses life equal to the number of creature cards in your graveyard.
- **Expected:** +1 repeats while Insects are milled.
- **Actual:** Never repeats.
- **Failure classes:** G (Incorrect conditions or restrictions)
- **Root cause:** RC01 Unread "if" condition at resolution
- **Source:** effects.js parseCond (l.626, cond17 l.708) returns {c:"?"}; triggers.js evalCond case "?" (l.453) returns !ctx.resolving; resolve.js runEffects case "if" (l.943) forces the else branch or skips
- **Evidence:** R
- **Same root cause:** Guardian Project; Arena of Glory; Springheart Nantuko; Spelunking; Padeem, Consul of Innovation; Approach of the Second Sun; Tataru Taru; Noxious Gearhulk; Combustible Gearhulk; Liberator, Urza's Battlethopter; Carpet of Flowers; Bonehoard Dracosaur and 25 more

### #2049 Party Thrasher

- **Finding:** Incomplete implementation · **Severity:** Low · **Plays:** weaker than printed
- **Coverage:** incorrect — "you may play/cast … this turn" is not read / noncreature spells you cast from exile have convoke. / at the beginning of your first main phase, you may discard a card. if you do, exile the top two cards of your library, then choose one of them. you may play that card this turn.
- **Oracle text:** Noncreature spells you cast from exile have convoke. (Each creature you tap while casting a noncreature spell from exile pays for {1} or one mana of that creature's color.) / At the beginning of your first main phase, you may discard a card. If you do, exile the top two cards of your library, then choose one of them. You may play that card this turn.
- **Expected:** Convoke from exile; main-phase discard-to-impulse.
- **Actual:** Nothing read.
- **Failure classes:** C (Effect never executes), F (Incorrect mana or additional cost payment), P (Incorrect cleanup, expiration or delayed effects)
- **Root cause:** RC15 Whole ability not read (incomplete implementation)
- **Source:** effects.js parseCard leaves the line in fx.unread; coverage.mjs RESTRICTION (l.52) labels the card "restriction" (stronger) when the unread text merely contains "activate only"/"can't"
- **Evidence:** R
- **Same root cause:** Dauthi Voidwalker; Nesting Grounds; Destiny Spinner; Skrelv, Defector Mite; Endurance; Guide of Souls; Terastodon; Avatar's Wrath; Resourceful Defense; Kozilek, the Great Distortion; Fire Nation Palace; March of Swirling Mist and 47 more

### #2077 Single Combat

- **Finding:** Confirmed defect · **Severity:** Low · **Plays:** weaker than printed
- **Coverage:** restriction — Players can't cast creature or planeswalker spells until the end of your next turn.
- **Oracle text:** Each player chooses a creature or planeswalker they control, then sacrifices the rest. Players can't cast creature or planeswalker spells until the end of your next turn.
- **Expected:** No creature/planeswalker spells until end of your next turn.
- **Actual:** Lock dropped.
- **Failure classes:** L (Incorrect continuous effects)
- **Root cause:** RC12 Rider sentences dropped (restrictions and riders)
- **Source:** effects.js droppedSentences (l.2453): "can't be regenerated", "can't block", "doesn't untap", "can't cast spells", kicker riders, suspend riders
- **Evidence:** R
- **Same root cause:** Shatterskull Smashing // Shatterskull, the Hammer Pass; Silver Shroud Costume; Mjölnir, Storm Hammer; Damn; Plaguecrafter; Sundering Eruption // Volcanic Fissure; Kappa Cannoneer; Koma, Cosmos Serpent; Planar Genesis; Orim's Chant; Junk Winder; Taunt from the Rampart and 5 more

### #2079 Likeness Looter

- **Finding:** Incomplete implementation · **Severity:** Low · **Plays:** weaker than printed
- **Coverage:** restriction — {x}: ~ becomes a copy of target creature card in your graveyard with mana value x, except it has flying and this ability. activate only as a sorcery.
- **Oracle text:** Flying / {T}: Draw a card, then discard a card. / {X}: This creature becomes a copy of target creature card in your graveyard with mana value X, except it has flying and this ability. Activate only as a sorcery.
- **Expected:** Become a copy of a graveyard creature.
- **Actual:** Not read.
- **Failure classes:** C (Effect never executes)
- **Root cause:** RC15 Whole ability not read (incomplete implementation)
- **Source:** effects.js parseCard leaves the line in fx.unread; coverage.mjs RESTRICTION (l.52) labels the card "restriction" (stronger) when the unread text merely contains "activate only"/"can't"
- **Evidence:** R
- **Same root cause:** Dauthi Voidwalker; Nesting Grounds; Destiny Spinner; Skrelv, Defector Mite; Endurance; Guide of Souls; Terastodon; Avatar's Wrath; Resourceful Defense; Kozilek, the Great Distortion; Fire Nation Palace; March of Swirling Mist and 47 more

### #2162 Karn, the Great Creator

- **Finding:** Incomplete implementation · **Severity:** High · **Plays:** weaker than printed
- **Coverage:** incorrect — "up to N target" is not read
- **Oracle text:** Activated abilities of artifacts your opponents control can't be activated. / +1: Until your next turn, up to one target noncreature artifact becomes an artifact creature with power and toughness each equal to its mana value. / −2: You may reveal an artifact card you own from outside the game or choose a face-up artifact card you own in exile. Put that card into your hand.
- **Expected:** +1 animate artifact; -2 fetch an artifact from outside the game/exile.
- **Actual:** Static lock read; both loyalty abilities have text only and do nothing.
- **Failure classes:** C (Effect never executes), L (Incorrect continuous effects)
- **Root cause:** RC15 Whole ability not read (incomplete implementation)
- **Source:** effects.js parseCard leaves the line in fx.unread; coverage.mjs RESTRICTION (l.52) labels the card "restriction" (stronger) when the unread text merely contains "activate only"/"can't"
- **Evidence:** R
- **Same root cause:** Dauthi Voidwalker; Nesting Grounds; Destiny Spinner; Skrelv, Defector Mite; Endurance; Guide of Souls; Terastodon; Avatar's Wrath; Resourceful Defense; Kozilek, the Great Distortion; Fire Nation Palace; March of Swirling Mist and 47 more

### #2170 Risen Reef

- **Finding:** Confirmed defect · **Severity:** Medium · **Plays:** weaker than printed
- **Coverage:** restriction — If you don't put the card onto the battlefield, put it into your hand.
- **Oracle text:** Whenever this creature or another Elemental you control enters, look at the top card of your library. If it's a land card, you may put it onto the battlefield tapped. If you don't put the card onto the battlefield, put it into your hand.
- **Expected:** Nonland (or declined land) goes to hand.
- **Actual:** Card goes to the bottom.
- **Failure classes:** D (Incorrect effect resolution)
- **Root cause:** RC11 A player's choice is not asked (punishers, "may have you", optional costs); RC12 Rider sentences dropped (restrictions and riders)
- **Source:** reader keeps one branch of "target opponent may have you draw…", "you may sacrifice…, if you do", "if you don't, put … into your hand" — effects.js droppedSentences (l.2453): "can't be regenerated", "can't block", "doesn't untap", "can't cast spells", kicker riders, suspend riders
- **Evidence:** T: resolve.js dig
- **Same root cause:** Palantír of Orthanc; Tataru Taru; Combustible Gearhulk; Wilhelt, the Rotcleaver; Planar Genesis; Fandaniel, Telophoroi Ascian; Shatterskull Smashing // Shatterskull, the Hammer Pass; Silver Shroud Costume; Mjölnir, Storm Hammer; Damn; Plaguecrafter; Sundering Eruption // Volcanic Fissure and 10 more

### #2171 Klauth, Unrivaled Ancient

- **Finding:** Confirmed defect · **Severity:** Medium · **Plays:** differently from printed
- **Coverage:** restriction — Spend this mana only to cast spells. / Until end of turn, you don't lose this mana as steps and phases end.
- **Oracle text:** Flying, haste / Whenever Klauth attacks, add X mana in any combination of colors, where X is the total power of attacking creatures. Spend this mana only to cast spells. Until end of turn, you don't lose this mana as steps and phases end.
- **Expected:** Mana only for spells, kept until end of turn.
- **Actual:** Unrestricted; empties next phase.
- **Failure classes:** F (Incorrect mana or additional cost payment)
- **Root cause:** RC03 Spend restrictions on mana not modelled; extra mana lines merged; RC05 Mana that persists through steps and phases
- **Source:** effects.js mana-line reader (l.2060-2100) keeps only fx.mana.only creatureSpell/creatureAbility and cavern; the colors of every mana line are unioned into one fx.mana; mana.js spendOk (l.38) knows two restrictions — engine.js setPhase (l.319) empties every pool except keepRed
- **Evidence:** P38 (same path)
- **Same root cause:** Delighted Halfling; Secluded Courtyard; Unclaimed Territory; Plaza of Heroes; Throne of Eldraine; Haven of the Spirit Dragon; Codsworth, Handy Helper; Giada, Font of Hope; Gwenna, Eyes of Gaea; Great Hall of the Citadel; Maelstrom of the Spirit Dragon; Power Depot and 13 more

### #2175 Sepulchral Primordial

- **Finding:** Not a defect (classification false positive) · **Severity:** Low · **Plays:** as printed (for the flagged part)
- **Coverage:** incorrect — "up to N target" is not read
- **Oracle text:** Intimidate (This creature can't be blocked except by artifact creatures and/or creatures that share a color with it.) / When this creature enters, for each opponent, you may put up to one target creature card from that player's graveyard onto the battlefield under your control.
- **Expected:** Up to one creature card from each opponent's graveyard onto your battlefield.
- **Actual:** Works (reanimate any, eachOpp).
- **Failure classes:** none
- **Root cause:** RC21 Coverage classification false positive
- **Source:** MISREAD regexes match words in the reading JSON (e.g. "play|until" for flash permission); RESTRICTION does not know engine.js abilityCost floors at one mana
- **Evidence:** P30
- **Same root cause:** Chandra's Ignition; Emergence Zone; Alchemist's Refuge; Training Grounds; Forensic Gadgeteer; Biomancer's Familiar; Zirda, the Dawnwaker

### #2212 Aetheric Amplifier

- **Finding:** Incomplete implementation · **Severity:** Low · **Plays:** weaker than printed
- **Coverage:** restriction — {4}, {t}: choose one. activate only as a sorcery.
- **Oracle text:** {T}: Add one mana of any color. / {4}, {T}: Choose one. Activate only as a sorcery. / • Double the number of each kind of counter on target permanent. / • Double the number of each kind of counter you have.
- **Expected:** Double counters.
- **Actual:** Not read.
- **Failure classes:** C (Effect never executes), J (Incorrect counters or token handling)
- **Root cause:** RC15 Whole ability not read (incomplete implementation); RC19 Counter movement and named counters
- **Source:** effects.js parseCard leaves the line in fx.unread; coverage.mjs RESTRICTION (l.52) labels the card "restriction" (stronger) when the unread text merely contains "activate only"/"can't" — No effect kind for moving counters between permanents; named counters partly modelled
- **Evidence:** R
- **Same root cause:** Dauthi Voidwalker; Nesting Grounds; Destiny Spinner; Skrelv, Defector Mite; Endurance; Guide of Souls; Terastodon; Avatar's Wrath; Resourceful Defense; Kozilek, the Great Distortion; Fire Nation Palace; March of Swirling Mist and 48 more

### #2234 Bloodthirsty Blade

- **Finding:** Incomplete implementation · **Severity:** Medium · **Plays:** weaker than printed
- **Coverage:** restriction — {1}: attach ~ to target creature an opponent controls. activate only as a sorcery.
- **Oracle text:** Equipped creature gets +2/+0 and is goaded. (It attacks each combat if able and attacks a player other than you if able.) / {1}: Attach this Equipment to target creature an opponent controls. Activate only as a sorcery.
- **Expected:** Goaded; attach to an opponent's creature.
- **Actual:** Only +2/+0.
- **Failure classes:** C (Effect never executes), L (Incorrect continuous effects)
- **Root cause:** RC15 Whole ability not read (incomplete implementation); RC14 Static prohibitions and rule-changing statics not read
- **Source:** effects.js parseCard leaves the line in fx.unread; coverage.mjs RESTRICTION (l.52) labels the card "restriction" (stronger) when the unread text merely contains "activate only"/"can't" — No reading for "players can't activate loyalty abilities", attack caps, "can't attack a player it already attacked", "ignore hexproof", graveyard-cast locks, untap locks
- **Evidence:** R
- **Same root cause:** Dauthi Voidwalker; Nesting Grounds; Destiny Spinner; Skrelv, Defector Mite; Endurance; Guide of Souls; Terastodon; Avatar's Wrath; Resourceful Defense; Kozilek, the Great Distortion; Fire Nation Palace; March of Swirling Mist and 56 more

### #2252 Urza's Workshop

- **Finding:** Incomplete implementation · **Severity:** Low · **Plays:** weaker than printed
- **Coverage:** restriction — Metalcraft — {T}: Add {C} for each Urza's land you control. / Activate only if you control three or more artifacts.
- **Oracle text:** {T}: Add {C}. / Metalcraft — {T}: Add {C} for each Urza's land you control. Activate only if you control three or more artifacts.
- **Expected:** Metalcraft mana.
- **Actual:** Only {C}.
- **Failure classes:** F (Incorrect mana or additional cost payment)
- **Root cause:** RC04 Conditional or second mana abilities dropped or made unconditional
- **Source:** effects.js mana lines: manaLines need only for MANA_COND words (l.48); "a Dragon", "entered this turn", "ferocious", "corrupted", "three lands with the same name", second {C}{C} lines are dropped while the color is still added
- **Evidence:** R
- **Same root cause:** Tablet of Discovery; Fanatic of Rhonas; Plaza of Heroes; Floodfarm Verge; Bleachbone Verge; Throne of Eldraine; Shrine of the Forsaken Gods; Eldrazi Temple; Nimbus Maze; Great Hall of the Citadel; Sceptre of Eternal Glory; Mox Jasper and 2 more

### #2258 Pact of the Serpent

- **Finding:** Confirmed defect · **Severity:** Low · **Plays:** weaker than printed
- **Coverage:** incorrect — "X, where X is …" is left as the X paid on casting (plays as 0) / Choose a creature type.
- **Oracle text:** Choose a creature type. Target player draws X cards and loses X life, where X is the number of creatures they control of the chosen type.
- **Expected:** Target player draws X and loses X, X = their creatures of the chosen type.
- **Actual:** X is dyn "?" = 0.
- **Failure classes:** M (Incorrect X-value or variable calculation)
- **Root cause:** RC09 "X, where X is …" left as paid X (0)
- **Source:** effects.js xWhere reader (l.1047-1074) returns {dyn:"?"}; resolve.js X() reads it as 0; roll passes x only to its table rows
- **Evidence:** R + P06
- **Same root cause:** Palantír of Orthanc; Painful Truths; Quartzwood Crasher; Kozilek's Command; Ancient Bronze Dragon; Prime Speaker Zegana; Sunfall; Carpet of Flowers; Karn, Legacy Reforged; Meathook Massacre II; Well of Lost Dreams; Call the Coppercoats

### #2265 Toxrill, the Corrosive

- **Finding:** Incomplete implementation · **Severity:** High · **Plays:** weaker than printed
- **Coverage:** restriction — at the beginning of each end step, put a slime counter on each creature you don't control. / creatures you don't control get -1/-1 for each slime counter on them. / whenever a creature you don't control with a slime counter on it dies, create a 1/1 black slug creature token.
- **Oracle text:** At the beginning of each end step, put a slime counter on each creature you don't control. / Creatures you don't control get -1/-1 for each slime counter on them. / Whenever a creature you don't control with a slime counter on it dies, create a 1/1 black Slug creature token. / {U}{B}, Sacrifice a Slug: Draw a card.
- **Expected:** Slime counters, -1/-1 per counter, Slug tokens.
- **Actual:** Only the draw ability.
- **Failure classes:** C (Effect never executes), J (Incorrect counters or token handling), L (Incorrect continuous effects)
- **Root cause:** RC15 Whole ability not read (incomplete implementation); RC19 Counter movement and named counters
- **Source:** effects.js parseCard leaves the line in fx.unread; coverage.mjs RESTRICTION (l.52) labels the card "restriction" (stronger) when the unread text merely contains "activate only"/"can't" — No effect kind for moving counters between permanents; named counters partly modelled
- **Evidence:** R
- **Same root cause:** Dauthi Voidwalker; Nesting Grounds; Destiny Spinner; Skrelv, Defector Mite; Endurance; Guide of Souls; Terastodon; Avatar's Wrath; Resourceful Defense; Kozilek, the Great Distortion; Fire Nation Palace; March of Swirling Mist and 48 more

### #2270 Invert Polarity

- **Finding:** Incomplete implementation · **Severity:** Low · **Plays:** weaker than printed
- **Coverage:** incorrect — a coin flip is not read / choose target spell, then flip a coin. if you win the flip, gain control of that spell and you may choose new targets for it. if you lose the flip, counter that spell.
- **Oracle text:** Choose target spell, then flip a coin. If you win the flip, gain control of that spell and you may choose new targets for it. If you lose the flip, counter that spell.
- **Expected:** Coin flip: steal the spell or counter it.
- **Actual:** Nothing read.
- **Failure classes:** C (Effect never executes), O (Incorrect stack behavior), R (Other)
- **Root cause:** RC15 Whole ability not read (incomplete implementation); RC18 Random results and modal constraints
- **Source:** effects.js parseCard leaves the line in fx.unread; coverage.mjs RESTRICTION (l.52) labels the card "restriction" (stronger) when the unread text merely contains "activate only"/"can't" — roll tables read partly; coin flips with outcomes; "each mode must target a different player"
- **Evidence:** R
- **Same root cause:** Dauthi Voidwalker; Nesting Grounds; Destiny Spinner; Skrelv, Defector Mite; Endurance; Guide of Souls; Terastodon; Avatar's Wrath; Resourceful Defense; Kozilek, the Great Distortion; Fire Nation Palace; March of Swirling Mist and 48 more

### #2278 Delay

- **Finding:** Confirmed defect · **Severity:** Medium · **Plays:** stronger than printed
- **Coverage:** restriction — If the spell is countered this way, exile it with three time counters on it instead of putting it into its owner's graveyard. / If it doesn't have suspend, it gains suspend.
- **Oracle text:** Counter target spell. If the spell is countered this way, exile it with three time counters on it instead of putting it into its owner's graveyard. If it doesn't have suspend, it gains suspend. (At the beginning of its owner's upkeep, they remove a time counter. When the last is removed, they may play it without paying its mana cost. If it's a creature, it has haste.)
- **Expected:** Counter; exile with three time counters and suspend.
- **Actual:** Hard counter.
- **Failure classes:** B (Recognized but incorrectly constructed), I (Incorrect zone movement)
- **Root cause:** RC12 Rider sentences dropped (restrictions and riders)
- **Source:** effects.js droppedSentences (l.2453): "can't be regenerated", "can't block", "doesn't untap", "can't cast spells", kicker riders, suspend riders
- **Evidence:** P41
- **Same root cause:** Shatterskull Smashing // Shatterskull, the Hammer Pass; Silver Shroud Costume; Mjölnir, Storm Hammer; Damn; Plaguecrafter; Sundering Eruption // Volcanic Fissure; Kappa Cannoneer; Koma, Cosmos Serpent; Planar Genesis; Orim's Chant; Junk Winder; Taunt from the Rampart and 5 more

### #2320 Nine-Lives Familiar

- **Finding:** Confirmed defect · **Severity:** Low · **Plays:** weaker than printed
- **Coverage:** incorrect — an "if" the reader can't read (rules 17: that part does nothing and is reported; before: treated as true) / ~ enters with eight revival counters on it if you cast it.
- **Oracle text:** This creature enters with eight revival counters on it if you cast it. / When this creature dies, if it had a revival counter on it, return it to the battlefield with one fewer revival counter on it at the beginning of the next end step.
- **Expected:** Returns while it has revival counters.
- **Actual:** Never returns; no revival counters.
- **Failure classes:** G (Incorrect conditions or restrictions), J (Incorrect counters or token handling)
- **Root cause:** RC01 Unread "if" condition at resolution
- **Source:** effects.js parseCond (l.626, cond17 l.708) returns {c:"?"}; triggers.js evalCond case "?" (l.453) returns !ctx.resolving; resolve.js runEffects case "if" (l.943) forces the else branch or skips
- **Evidence:** R
- **Same root cause:** Guardian Project; Arena of Glory; Springheart Nantuko; Spelunking; Padeem, Consul of Innovation; Approach of the Second Sun; Tataru Taru; Noxious Gearhulk; Combustible Gearhulk; Liberator, Urza's Battlethopter; Carpet of Flowers; Bonehoard Dracosaur and 25 more

### #2323 Orthion, Hero of Lavabrink

- **Finding:** Incomplete implementation · **Severity:** Low · **Plays:** weaker than printed
- **Coverage:** restriction — {6}{r}{r}{r}, {t}: create five tokens that are copies of another target creature you control. they gain haste. sacrifice them at the beginning of the next end step. activate only as a sorcery.
- **Oracle text:** {1}{R}, {T}: Create a token that's a copy of another target creature you control. It gains haste. Sacrifice it at the beginning of the next end step. Activate only as a sorcery. / {6}{R}{R}{R}, {T}: Create five tokens that are copies of another target creature you control. They gain haste. Sacrifice them at the beginning of the next end step. Activate only as a sorcery.
- **Expected:** Five copies ability.
- **Actual:** Not read.
- **Failure classes:** C (Effect never executes)
- **Root cause:** RC15 Whole ability not read (incomplete implementation)
- **Source:** effects.js parseCard leaves the line in fx.unread; coverage.mjs RESTRICTION (l.52) labels the card "restriction" (stronger) when the unread text merely contains "activate only"/"can't"
- **Evidence:** R
- **Same root cause:** Dauthi Voidwalker; Nesting Grounds; Destiny Spinner; Skrelv, Defector Mite; Endurance; Guide of Souls; Terastodon; Avatar's Wrath; Resourceful Defense; Kozilek, the Great Distortion; Fire Nation Palace; March of Swirling Mist and 47 more

### #2330 Court of Garenbrig

- **Finding:** Confirmed defect · **Severity:** Medium · **Plays:** stronger than printed
- **Coverage:** incorrect — "up to two or more targets": only one target is used
- **Oracle text:** When this enchantment enters, you become the monarch. / At the beginning of your upkeep, distribute two +1/+1 counters among up to two target creatures. Then if you're the monarch, double the number of +1/+1 counters on each creature you control.
- **Expected:** Distribute two counters among up to two targets; then double counters only if you are the monarch.
- **Actual:** Doubling happens without the monarchy (2 -> 4 while an opponent is monarch); both counters go to one creature.
- **Failure classes:** G (Incorrect conditions or restrictions), J (Incorrect counters or token handling), E (Incorrect targeting or target legality)
- **Root cause:** RC13 Clause bound to the wrong object or read as the wrong effect; RC10 Multiple / divided / "up to" targets
- **Source:** Token riders ("exile this token", "sacrifice this token") read as exileSelf/sacSelf of the source; copyToken "of it" falls back to src (resolve.js l.439-441); pumpTrig reads ctx.trig.o; conditions read as unconditional; modal text misread — effects.js upTo splitter (l.1250-1265) only for MULTI kinds and not for divided/distributed amounts
- **Evidence:** P17
- **Same root cause:** Expressive Iteration; Hunter's Insight; Not Dead After All; Delina, Wild Mage; Inti, Seneschal of the Sun; Kozilek's Command; Gilded Drake; Abdel Adrian, Gorion's Ward; Sunfall; Court of Vantress; Charming Scoundrel; Springheart Nantuko and 11 more

### #2357 Chthonian Nightmare

- **Finding:** Incomplete implementation · **Severity:** Low · **Plays:** weaker than printed
- **Coverage:** restriction — pay x {e}, sacrifice a creature, return ~ to its owner's hand: return target creature card with mana value x from your graveyard to the battlefield. activate only as a sorcery.
- **Oracle text:** When this enchantment enters, you get {E}{E}{E} (three energy counters). / Pay X {E}, Sacrifice a creature, Return this enchantment to its owner's hand: Return target creature card with mana value X from your graveyard to the battlefield. Activate only as a sorcery.
- **Expected:** Reanimate for energy.
- **Actual:** Not read.
- **Failure classes:** C (Effect never executes)
- **Root cause:** RC15 Whole ability not read (incomplete implementation)
- **Source:** effects.js parseCard leaves the line in fx.unread; coverage.mjs RESTRICTION (l.52) labels the card "restriction" (stronger) when the unread text merely contains "activate only"/"can't"
- **Evidence:** R
- **Same root cause:** Dauthi Voidwalker; Nesting Grounds; Destiny Spinner; Skrelv, Defector Mite; Endurance; Guide of Souls; Terastodon; Avatar's Wrath; Resourceful Defense; Kozilek, the Great Distortion; Fire Nation Palace; March of Swirling Mist and 47 more

### #2358 Not of This World

- **Finding:** Confirmed defect · **Severity:** Critical · **Plays:** stronger than printed
- **Coverage:** incorrect — an "if" the reader can't read (rules 17: that part does nothing and is reported; before: treated as true)
- **Oracle text:** Counter target spell or ability that targets a permanent you control. / This spell costs {7} less to cast if it targets a spell or ability that targets a creature you control with power 7 or greater.
- **Expected:** Costs {7}; {7} less if it targets something targeting your power-7 creature; only counters what targets your permanents.
- **Actual:** Costs 0 always and counters any spell.
- **Failure classes:** F (Incorrect mana or additional cost payment), G (Incorrect conditions or restrictions), E (Incorrect targeting or target legality)
- **Root cause:** RC02 Unread condition outside resolution counts as met; RC06 Target qualifiers not enforced (legendary, MV, attacking, dynamic limits)
- **Source:** triggers.js evalCond case "?" returns true when ctx.resolving is unset; called with {} by mana.js costOf selfReduce (l.607-610) and castModeRaw gyCastSelf (l.508) — effects.js targetWords (l.1107) only runs for TARGETED kinds (l.1103): reanimate, counter, steal-with-MV, tutor, regrow get no e.tr; tr has no dynamic limits (X, graveyard size); resolve.js targetFits (l.155) / legalTargets (l.111)
- **Evidence:** P04
- **Same root cause:** The Indomitable; Resonating Lute; Persist; Drown in the Loch; Inti, Seneschal of the Sun; Kozilek's Command; Thieving Skydiver; Haven of the Spirit Dragon; Maelstrom of the Spirit Dragon; Mudflat Village

### #2388 Zul Ashur, Lich Lord

- **Finding:** Confirmed defect · **Severity:** Medium · **Plays:** stronger than printed
- **Coverage:** incorrect — "you may play/cast … this turn" is not read
- **Oracle text:** Ward—Pay 2 life. (Whenever this creature becomes the target of a spell or ability an opponent controls, counter it unless that player pays 2 life.) / {T}: You may cast target Zombie creature card from your graveyard this turn.
- **Expected:** Cast one target Zombie creature card from your graveyard this turn.
- **Actual:** gyCastTurn with no types: every nonland card in the graveyard is castable this turn.
- **Failure classes:** E (Incorrect targeting or target legality), G (Incorrect conditions or restrictions), P (Incorrect cleanup, expiration or delayed effects)
- **Root cause:** RC08 Temporary cast/play permissions missing or too broad
- **Source:** resolve.js dig/exileTrigCard/exileGy/mill create no mayPlay; gyCastTurn (l.1911) stores types only, so empty types = every nonland card, unlimited; mana.js castModeRaw (l.510)
- **Evidence:** P20 (same path)
- **Same root cause:** Dauthi Voidwalker; Emry, Lurker of the Loch; Expressive Iteration; Chainer, Nightmare Adept; Containment Construct; Mnemonic Betrayal; Abdel Adrian, Gorion's Ward; Tablet of Discovery; Dire Fleet Daredevil; Valakut Exploration; Tinybones, Bauble Burglar; Rivaz of the Claw

### #2390 Sceptre of Eternal Glory

- **Finding:** Incomplete implementation · **Severity:** Low · **Plays:** weaker than printed
- **Coverage:** restriction — Activate only if you control three or more lands with the same name.
- **Oracle text:** {T}: Add one mana of any color. / {T}: Add three mana of any one color. Activate only if you control three or more lands with the same name.
- **Expected:** Three mana with three same-named lands.
- **Actual:** Not read.
- **Failure classes:** F (Incorrect mana or additional cost payment)
- **Root cause:** RC04 Conditional or second mana abilities dropped or made unconditional
- **Source:** effects.js mana lines: manaLines need only for MANA_COND words (l.48); "a Dragon", "entered this turn", "ferocious", "corrupted", "three lands with the same name", second {C}{C} lines are dropped while the color is still added
- **Evidence:** R
- **Same root cause:** Tablet of Discovery; Fanatic of Rhonas; Plaza of Heroes; Floodfarm Verge; Bleachbone Verge; Throne of Eldraine; Shrine of the Forsaken Gods; Eldrazi Temple; Nimbus Maze; Great Hall of the Citadel; Urza's Workshop; Mox Jasper and 2 more

### #2404 The Indomitable

- **Finding:** Confirmed defect · **Severity:** High · **Plays:** stronger than printed
- **Coverage:** incorrect — an "if" the reader can't read (rules 17: that part does nothing and is reported; before: treated as true)
- **Oracle text:** Trample / Whenever a creature you control deals combat damage to a player, draw a card. / Crew 3 / You may cast this card from your graveyard as long as you control three or more tapped Pirates and/or Vehicles.
- **Expected:** Castable from the graveyard with three tapped Pirates/Vehicles.
- **Actual:** Always castable from the graveyard.
- **Failure classes:** G (Incorrect conditions or restrictions), P (Incorrect cleanup, expiration or delayed effects)
- **Root cause:** RC02 Unread condition outside resolution counts as met
- **Source:** triggers.js evalCond case "?" returns true when ctx.resolving is unset; called with {} by mana.js costOf selfReduce (l.607-610) and castModeRaw gyCastSelf (l.508)
- **Evidence:** P05
- **Same root cause:** Not of This World; Resonating Lute

### #2412 Halvar, God of Battle // Sword of the Realms

- **Finding:** Incomplete implementation · **Severity:** Low · **Plays:** weaker than printed
- **Coverage:** incorrect — "target … you control" is not read (a person could aim it at an opponent's permanent) / at the beginning of each combat, you may attach target aura or equipment attached to a creature you control to target creature you control.
- **Oracle text:** Creatures you control that are enchanted or equipped have double strike. / At the beginning of each combat, you may attach target Aura or Equipment attached to a creature you control to target creature you control.
- **Expected:** Each combat, move an Aura/Equipment you control to target creature you control.
- **Actual:** Anthem read; the trigger is not.
- **Failure classes:** C (Effect never executes), E (Incorrect targeting or target legality)
- **Root cause:** RC15 Whole ability not read (incomplete implementation)
- **Source:** effects.js parseCard leaves the line in fx.unread; coverage.mjs RESTRICTION (l.52) labels the card "restriction" (stronger) when the unread text merely contains "activate only"/"can't"
- **Evidence:** R
- **Same root cause:** Dauthi Voidwalker; Nesting Grounds; Destiny Spinner; Skrelv, Defector Mite; Endurance; Guide of Souls; Terastodon; Avatar's Wrath; Resourceful Defense; Kozilek, the Great Distortion; Fire Nation Palace; March of Swirling Mist and 47 more

### #2424 Thieving Skydiver

- **Finding:** Confirmed defect · **Severity:** High · **Plays:** stronger than printed
- **Coverage:** incorrect — "target … with mana value N or less/greater" is not read / kicker {x}. x can't be 0. / If that artifact is an Equipment, attach it to this creature.
- **Oracle text:** Kicker {X}. X can't be 0. (You may pay an additional {X} as you cast this spell.) / Flying / When this creature enters, if it was kicked, gain control of target artifact with mana value X or less. If that artifact is an Equipment, attach it to this creature.
- **Expected:** Kicked X: gain control of target artifact with MV <= X (attach if Equipment).
- **Actual:** Any artifact is a legal target (Gilded Lotus with X=1).
- **Failure classes:** E (Incorrect targeting or target legality), M (Incorrect X-value or variable calculation)
- **Root cause:** RC06 Target qualifiers not enforced (legendary, MV, attacking, dynamic limits)
- **Source:** effects.js targetWords (l.1107) only runs for TARGETED kinds (l.1103): reanimate, counter, steal-with-MV, tutor, regrow get no e.tr; tr has no dynamic limits (X, graveyard size); resolve.js targetFits (l.155) / legalTargets (l.111)
- **Evidence:** P10
- **Same root cause:** Persist; Drown in the Loch; Inti, Seneschal of the Sun; Kozilek's Command; Not of This World; Haven of the Spirit Dragon; Maelstrom of the Spirit Dragon; Mudflat Village

### #2441 Mox Jasper

- **Finding:** Confirmed defect · **Severity:** Medium · **Plays:** stronger than printed
- **Coverage:** restriction — Activate only if you control a Dragon.
- **Oracle text:** {T}: Add one mana of any color. Activate only if you control a Dragon.
- **Expected:** Mana only if you control a Dragon.
- **Actual:** Unconditional (Bolt castable).
- **Failure classes:** F (Incorrect mana or additional cost payment), G (Incorrect conditions or restrictions)
- **Root cause:** RC04 Conditional or second mana abilities dropped or made unconditional
- **Source:** effects.js mana lines: manaLines need only for MANA_COND words (l.48); "a Dragon", "entered this turn", "ferocious", "corrupted", "three lands with the same name", second {C}{C} lines are dropped while the color is still added
- **Evidence:** P37
- **Same root cause:** Tablet of Discovery; Fanatic of Rhonas; Plaza of Heroes; Floodfarm Verge; Bleachbone Verge; Throne of Eldraine; Shrine of the Forsaken Gods; Eldrazi Temple; Nimbus Maze; Great Hall of the Citadel; Urza's Workshop; Sceptre of Eternal Glory and 2 more

### #2453 Resonating Lute

- **Finding:** Suspected defect · **Severity:** Medium · **Plays:** differently from printed
- **Coverage:** restriction — lands you control have "{t}: add two mana of any one color. spend this mana only to cast instant and sorcery spells."
- **Oracle text:** Lands you control have "{T}: Add two mana of any one color. Spend this mana only to cast instant and sorcery spells." / {T}: Draw a card. Activate only if you have seven or more cards in your hand.
- **Expected:** Lands tap for two (instants/sorceries); draw only with seven cards.
- **Actual:** Land grant unread; whether "activate only if seven cards" is enforced was not checked.
- **Failure classes:** G (Incorrect conditions or restrictions), F (Incorrect mana or additional cost payment)
- **Root cause:** RC15 Whole ability not read (incomplete implementation); RC02 Unread condition outside resolution counts as met
- **Source:** effects.js parseCard leaves the line in fx.unread; coverage.mjs RESTRICTION (l.52) labels the card "restriction" (stronger) when the unread text merely contains "activate only"/"can't" — triggers.js evalCond case "?" returns true when ctx.resolving is unset; called with {} by mana.js costOf selfReduce (l.607-610) and castModeRaw gyCastSelf (l.508)
- **Evidence:** R
- **Same root cause:** Dauthi Voidwalker; Nesting Grounds; Destiny Spinner; Skrelv, Defector Mite; Endurance; Guide of Souls; Terastodon; Avatar's Wrath; Resourceful Defense; Kozilek, the Great Distortion; Fire Nation Palace; March of Swirling Mist and 49 more

### #2506 Voldaren Estate

- **Finding:** Confirmed defect · **Severity:** Low · **Plays:** stronger than printed
- **Coverage:** restriction — Spend this mana only to cast a Vampire spell.
- **Oracle text:** {T}: Add {C}. / {T}, Pay 1 life: Add one mana of any color. Spend this mana only to cast a Vampire spell. / {5}, {T}: Create a Blood token. This ability costs {1} less to activate for each Vampire you control. (It's an artifact with "{1}, {T}, Discard a card, Sacrifice this token: Draw a card.")
- **Expected:** Mana for Vampires only.
- **Actual:** Unrestricted.
- **Failure classes:** F (Incorrect mana or additional cost payment)
- **Root cause:** RC03 Spend restrictions on mana not modelled; extra mana lines merged
- **Source:** effects.js mana-line reader (l.2060-2100) keeps only fx.mana.only creatureSpell/creatureAbility and cavern; the colors of every mana line are unioned into one fx.mana; mana.js spendOk (l.38) knows two restrictions
- **Evidence:** R
- **Same root cause:** Delighted Halfling; Secluded Courtyard; Unclaimed Territory; Plaza of Heroes; Throne of Eldraine; Haven of the Spirit Dragon; Codsworth, Handy Helper; Giada, Font of Hope; Gwenna, Eyes of Gaea; Great Hall of the Citadel; Maelstrom of the Spirit Dragon; Power Depot and 10 more

### #2516 Karn, Legacy Reforged

- **Finding:** Confirmed defect · **Severity:** Medium · **Plays:** differently from printed
- **Coverage:** restriction — This mana can't be spent to cast nonartifact spells. / Until end of turn, you don't lose this mana as steps and phases end.
- **Oracle text:** Karn's power and toughness are each equal to the greatest mana value among artifacts you control. / At the beginning of your upkeep, add {C} for each artifact you control. This mana can't be spent to cast nonartifact spells. Until end of turn, you don't lose this mana as steps and phases end.
- **Expected:** {C} per artifact, artifact spells only, kept all turn.
- **Actual:** One {C}, unrestricted, empties.
- **Failure classes:** F (Incorrect mana or additional cost payment), M (Incorrect X-value or variable calculation)
- **Root cause:** RC05 Mana that persists through steps and phases; RC09 "X, where X is …" left as paid X (0); RC03 Spend restrictions on mana not modelled; extra mana lines merged
- **Source:** engine.js setPhase (l.319) empties every pool except keepRed — effects.js xWhere reader (l.1047-1074) returns {dyn:"?"}; resolve.js X() reads it as 0; roll passes x only to its table rows — effects.js mana-line reader (l.2060-2100) keeps only fx.mana.only creatureSpell/creatureAbility and cavern; the colors of every mana line are unioned into one fx.mana; mana.js spendOk (l.38) knows two restrictions
- **Evidence:** R
- **Same root cause:** Birgi, God of Storytelling // Harnfel, Horn of Bounty; Savage Ventmaw; Klauth, Unrivaled Ancient; Rousing Refrain; Palantír of Orthanc; Painful Truths; Quartzwood Crasher; Kozilek's Command; Pact of the Serpent; Ancient Bronze Dragon; Prime Speaker Zegana; Sunfall and 25 more

### #2526 The Chain Veil

- **Finding:** Confirmed defect · **Severity:** High · **Plays:** differently from printed
- **Coverage:** incorrect — an "if" the reader can't read (rules 17: that part does nothing and is reported; before: treated as true) / {4}, {t}: for each planeswalker you control, you may activate one of its loyalty abilities once this turn as though none of its loyalty abilities have been activated this turn.
- **Oracle text:** At the beginning of your end step, if you didn't activate a loyalty ability of a planeswalker this turn, you lose 2 life. / {4}, {T}: For each planeswalker you control, you may activate one of its loyalty abilities once this turn as though none of its loyalty abilities have been activated this turn.
- **Expected:** Lose 2 if no loyalty ability was used; {4},{T}: extra loyalty activations.
- **Actual:** Never loses life; the activation ability (combo piece) is not read.
- **Failure classes:** G (Incorrect conditions or restrictions), C (Effect never executes)
- **Root cause:** RC01 Unread "if" condition at resolution; RC15 Whole ability not read (incomplete implementation)
- **Source:** effects.js parseCond (l.626, cond17 l.708) returns {c:"?"}; triggers.js evalCond case "?" (l.453) returns !ctx.resolving; resolve.js runEffects case "if" (l.943) forces the else branch or skips — effects.js parseCard leaves the line in fx.unread; coverage.mjs RESTRICTION (l.52) labels the card "restriction" (stronger) when the unread text merely contains "activate only"/"can't"
- **Evidence:** R
- **Same root cause:** Guardian Project; Arena of Glory; Springheart Nantuko; Spelunking; Padeem, Consul of Innovation; Approach of the Second Sun; Tataru Taru; Noxious Gearhulk; Combustible Gearhulk; Liberator, Urza's Battlethopter; Carpet of Flowers; Bonehoard Dracosaur and 82 more

### #2528 Inga and Esika

- **Finding:** Confirmed defect · **Severity:** Low · **Plays:** weaker than printed
- **Coverage:** incorrect — an "if" the reader can't read (rules 17: that part does nothing and is reported; before: treated as true)
- **Oracle text:** Creatures you control have vigilance and "{T}: Add one mana of any color. Spend this mana only to cast a creature spell." / Whenever you cast a creature spell, if three or more mana from creatures was spent to cast it, draw a card.
- **Expected:** Draw if three creature mana cast it.
- **Actual:** Never draws.
- **Failure classes:** G (Incorrect conditions or restrictions)
- **Root cause:** RC01 Unread "if" condition at resolution
- **Source:** effects.js parseCond (l.626, cond17 l.708) returns {c:"?"}; triggers.js evalCond case "?" (l.453) returns !ctx.resolving; resolve.js runEffects case "if" (l.943) forces the else branch or skips
- **Evidence:** R
- **Same root cause:** Guardian Project; Arena of Glory; Springheart Nantuko; Spelunking; Padeem, Consul of Innovation; Approach of the Second Sun; Tataru Taru; Noxious Gearhulk; Combustible Gearhulk; Liberator, Urza's Battlethopter; Carpet of Flowers; Bonehoard Dracosaur and 25 more

### #2547 Tinybones, Bauble Burglar

- **Finding:** Incomplete implementation · **Severity:** Low · **Plays:** weaker than printed
- **Coverage:** restriction — whenever an opponent discards a card, exile it from their graveyard with a stash counter on it. / during your turn, you may play cards you don't own with stash counters on them from exile, and mana of any type can be spent to cast those spells.
- **Oracle text:** Whenever an opponent discards a card, exile it from their graveyard with a stash counter on it. / During your turn, you may play cards you don't own with stash counters on them from exile, and mana of any type can be spent to cast those spells. / {3}{B}, {T}: Each opponent discards a card. Activate only as a sorcery.
- **Expected:** Stash counters and casting.
- **Actual:** Only the discard ability.
- **Failure classes:** C (Effect never executes), P (Incorrect cleanup, expiration or delayed effects)
- **Root cause:** RC15 Whole ability not read (incomplete implementation); RC08 Temporary cast/play permissions missing or too broad
- **Source:** effects.js parseCard leaves the line in fx.unread; coverage.mjs RESTRICTION (l.52) labels the card "restriction" (stronger) when the unread text merely contains "activate only"/"can't" — resolve.js dig/exileTrigCard/exileGy/mill create no mayPlay; gyCastTurn (l.1911) stores types only, so empty types = every nonland card, unlimited; mana.js castModeRaw (l.510)
- **Evidence:** R
- **Same root cause:** Dauthi Voidwalker; Nesting Grounds; Destiny Spinner; Skrelv, Defector Mite; Endurance; Guide of Souls; Terastodon; Avatar's Wrath; Resourceful Defense; Kozilek, the Great Distortion; Fire Nation Palace; March of Swirling Mist and 57 more

### #2558 Mnemonic Betrayal

- **Finding:** Confirmed defect · **Severity:** High · **Plays:** weaker than printed
- **Coverage:** incorrect — "you may play/cast … this turn" is not read / You may cast spells from among those cards this turn, and mana of any type can be spent to cast them. / At the beginning of the next end step, if any of those cards remain exiled, return them to their owners' graveyards.
- **Oracle text:** Exile all opponents' graveyards. You may cast spells from among those cards this turn, and mana of any type can be spent to cast them. At the beginning of the next end step, if any of those cards remain exiled, return them to their owners' graveyards. / Exile Mnemonic Betrayal.
- **Expected:** Exile opponents' graveyards; cast spells from among them this turn with any mana; return the rest at end step.
- **Actual:** Exiles the graveyards only: no cast permission, no return.
- **Failure classes:** I (Incorrect zone movement), P (Incorrect cleanup, expiration or delayed effects)
- **Root cause:** RC08 Temporary cast/play permissions missing or too broad
- **Source:** resolve.js dig/exileTrigCard/exileGy/mill create no mayPlay; gyCastTurn (l.1911) stores types only, so empty types = every nonland card, unlimited; mana.js castModeRaw (l.510)
- **Evidence:** T: resolve.js exileGy all
- **Same root cause:** Dauthi Voidwalker; Emry, Lurker of the Loch; Expressive Iteration; Chainer, Nightmare Adept; Containment Construct; Zul Ashur, Lich Lord; Abdel Adrian, Gorion's Ward; Tablet of Discovery; Dire Fleet Daredevil; Valakut Exploration; Tinybones, Bauble Burglar; Rivaz of the Claw

### #2582 Shadrix Silverquill

- **Finding:** Incomplete implementation · **Severity:** Medium · **Plays:** weaker than printed
- **Coverage:** incorrect — "target player / each player draws … and loses N life": the life loss (and the target) is not read / at the beginning of combat on your turn, you may choose two. each mode must target a different player.
- **Oracle text:** Flying, double strike / At the beginning of combat on your turn, you may choose two. Each mode must target a different player. / • Target player creates a 2/1 white and black Inkling creature token with flying. / • Target player draws a card and loses 1 life. / • Target player puts a +1/+1 counter on each creature they control.
- **Expected:** Choose two modes, each targeting a different player.
- **Actual:** Nothing read beyond keywords.
- **Failure classes:** C (Effect never executes), E (Incorrect targeting or target legality), R (Other)
- **Root cause:** RC15 Whole ability not read (incomplete implementation); RC18 Random results and modal constraints
- **Source:** effects.js parseCard leaves the line in fx.unread; coverage.mjs RESTRICTION (l.52) labels the card "restriction" (stronger) when the unread text merely contains "activate only"/"can't" — roll tables read partly; coin flips with outcomes; "each mode must target a different player"
- **Evidence:** R
- **Same root cause:** Dauthi Voidwalker; Nesting Grounds; Destiny Spinner; Skrelv, Defector Mite; Endurance; Guide of Souls; Terastodon; Avatar's Wrath; Resourceful Defense; Kozilek, the Great Distortion; Fire Nation Palace; March of Swirling Mist and 48 more

### #2595 Abundant Countryside

- **Finding:** Confirmed defect · **Severity:** Low · **Plays:** stronger than printed
- **Coverage:** restriction — Spend this mana only to cast a creature spell.
- **Oracle text:** {T}: Add {C}. / {T}: Add one mana of any color. Spend this mana only to cast a creature spell. / {6}, {T}: Create a 1/1 colorless Shapeshifter creature token with changeling. (It's every creature type.)
- **Expected:** Mana for creature spells only.
- **Actual:** Unrestricted.
- **Failure classes:** F (Incorrect mana or additional cost payment)
- **Root cause:** RC03 Spend restrictions on mana not modelled; extra mana lines merged
- **Source:** effects.js mana-line reader (l.2060-2100) keeps only fx.mana.only creatureSpell/creatureAbility and cavern; the colors of every mana line are unioned into one fx.mana; mana.js spendOk (l.38) knows two restrictions
- **Evidence:** R
- **Same root cause:** Delighted Halfling; Secluded Courtyard; Unclaimed Territory; Plaza of Heroes; Throne of Eldraine; Haven of the Spirit Dragon; Codsworth, Handy Helper; Giada, Font of Hope; Gwenna, Eyes of Gaea; Great Hall of the Citadel; Maelstrom of the Spirit Dragon; Power Depot and 10 more

### #2608 Roiling Vortex

- **Finding:** Confirmed defect · **Severity:** Medium · **Plays:** weaker than printed
- **Coverage:** incorrect — an "if" the reader can't read (rules 17: that part does nothing and is reported; before: treated as true) / {r}: your opponents can't gain life this turn.
- **Oracle text:** At the beginning of each player's upkeep, this enchantment deals 1 damage to them. / Whenever a player casts a spell, if no mana was spent to cast that spell, this enchantment deals 5 damage to that player. / {R}: Your opponents can't gain life this turn.
- **Expected:** 5 damage for free spells; {R}: opponents can't gain life.
- **Actual:** Never punishes free spells; {R} ability not read.
- **Failure classes:** G (Incorrect conditions or restrictions), C (Effect never executes)
- **Root cause:** RC01 Unread "if" condition at resolution; RC15 Whole ability not read (incomplete implementation)
- **Source:** effects.js parseCond (l.626, cond17 l.708) returns {c:"?"}; triggers.js evalCond case "?" (l.453) returns !ctx.resolving; resolve.js runEffects case "if" (l.943) forces the else branch or skips — effects.js parseCard leaves the line in fx.unread; coverage.mjs RESTRICTION (l.52) labels the card "restriction" (stronger) when the unread text merely contains "activate only"/"can't"
- **Evidence:** R
- **Same root cause:** Guardian Project; Arena of Glory; Springheart Nantuko; Spelunking; Padeem, Consul of Innovation; Approach of the Second Sun; Tataru Taru; Noxious Gearhulk; Combustible Gearhulk; Liberator, Urza's Battlethopter; Carpet of Flowers; Bonehoard Dracosaur and 82 more

### #2612 Artifact Mutation

- **Finding:** Confirmed defect · **Severity:** Medium · **Plays:** weaker than printed
- **Coverage:** restriction — Destroy target artifact. / It can't be regenerated.
- **Oracle text:** Destroy target artifact. It can't be regenerated. Create X 1/1 green Saproling creature tokens, where X is that artifact's mana value.
- **Expected:** Destroy target artifact; X Saprolings.
- **Actual:** No destroy; Saprolings only.
- **Failure classes:** B (Recognized but incorrectly constructed), C (Effect never executes)
- **Root cause:** RC13 Clause bound to the wrong object or read as the wrong effect
- **Source:** Token riders ("exile this token", "sacrifice this token") read as exileSelf/sacSelf of the source; copyToken "of it" falls back to src (resolve.js l.439-441); pumpTrig reads ctx.trig.o; conditions read as unconditional; modal text misread
- **Evidence:** P35
- **Same root cause:** Expressive Iteration; Hunter's Insight; Not Dead After All; Delina, Wild Mage; Inti, Seneschal of the Sun; Kozilek's Command; Court of Garenbrig; Gilded Drake; Abdel Adrian, Gorion's Ward; Sunfall; Court of Vantress; Charming Scoundrel and 5 more

### #2620 The Immortal Sun

- **Finding:** Confirmed defect · **Severity:** Medium · **Plays:** stronger than printed
- **Coverage:** restriction — players can't activate planeswalkers' loyalty abilities.
- **Oracle text:** Players can't activate planeswalkers' loyalty abilities. / At the beginning of your draw step, draw an additional card. / Spells you cast cost {1} less to cast. / Creatures you control get +1/+1.
- **Expected:** No loyalty abilities for anyone.
- **Actual:** Not read.
- **Failure classes:** L (Incorrect continuous effects)
- **Root cause:** RC14 Static prohibitions and rule-changing statics not read
- **Source:** No reading for "players can't activate loyalty abilities", attack caps, "can't attack a player it already attacked", "ignore hexproof", graveyard-cast locks, untap locks
- **Evidence:** R
- **Same root cause:** Avatar's Wrath; Vorinclex, Voice of Hunger; The Aetherspark; The Eternal Wanderer; Port Razer; Bloodthirsty Blade; Bloodthirster; Mirri, Weatherlight Duelist; Nowhere to Run; Stormtide Leviathan; Soulless Jailer; Rite of the Raging Storm

### #2642 Bloodthirster

- **Finding:** Confirmed defect · **Severity:** Medium · **Plays:** stronger than printed
- **Coverage:** restriction — ~ can't attack a player it has already attacked this turn.
- **Oracle text:** Flying, trample / Whenever this creature deals combat damage to a player, untap it. After this phase, there is an additional combat phase. / This creature can't attack a player it has already attacked this turn.
- **Expected:** Can't attack the same player twice.
- **Actual:** Not read.
- **Failure classes:** G (Incorrect conditions or restrictions)
- **Root cause:** RC14 Static prohibitions and rule-changing statics not read
- **Source:** No reading for "players can't activate loyalty abilities", attack caps, "can't attack a player it already attacked", "ignore hexproof", graveyard-cast locks, untap locks
- **Evidence:** R
- **Same root cause:** Avatar's Wrath; Vorinclex, Voice of Hunger; The Aetherspark; The Eternal Wanderer; Port Razer; Bloodthirsty Blade; The Immortal Sun; Mirri, Weatherlight Duelist; Nowhere to Run; Stormtide Leviathan; Soulless Jailer; Rite of the Raging Storm

### #2653 Ancient Bronze Dragon

- **Finding:** Confirmed defect · **Severity:** Medium · **Plays:** weaker than printed
- **Coverage:** incorrect — "X, where X is …" is left as the X paid on casting (plays as 0)
- **Oracle text:** Flying / Whenever this creature deals combat damage to a player, roll a d20. When you do, put X +1/+1 counters on each of up to two target creatures, where X is the result.
- **Expected:** Roll d20; X +1/+1 counters on each of up to two targets, X = result.
- **Actual:** roll passes x only to its own table rows; the counters effect uses dyn "?" = 0.
- **Failure classes:** M (Incorrect X-value or variable calculation), J (Incorrect counters or token handling)
- **Root cause:** RC09 "X, where X is …" left as paid X (0); RC10 Multiple / divided / "up to" targets
- **Source:** effects.js xWhere reader (l.1047-1074) returns {dyn:"?"}; resolve.js X() reads it as 0; roll passes x only to its table rows — effects.js upTo splitter (l.1250-1265) only for MULTI kinds and not for divided/distributed amounts
- **Evidence:** T: resolve.js roll
- **Same root cause:** Palantír of Orthanc; Painful Truths; Quartzwood Crasher; Kozilek's Command; Pact of the Serpent; Prime Speaker Zegana; Sunfall; Carpet of Flowers; Karn, Legacy Reforged; Meathook Massacre II; Well of Lost Dreams; Call the Coppercoats and 6 more

### #2682 Mirri, Weatherlight Duelist

- **Finding:** Confirmed defect · **Severity:** Low · **Plays:** weaker than printed
- **Coverage:** restriction — whenever ~ attacks, each opponent can't block with more than one creature this combat.
- **Oracle text:** First strike / Whenever Mirri attacks, each opponent can't block with more than one creature this combat. / As long as Mirri is tapped, no more than one creature can attack you each combat.
- **Expected:** Opponents block with at most one creature.
- **Actual:** Not read.
- **Failure classes:** L (Incorrect continuous effects)
- **Root cause:** RC14 Static prohibitions and rule-changing statics not read
- **Source:** No reading for "players can't activate loyalty abilities", attack caps, "can't attack a player it already attacked", "ignore hexproof", graveyard-cast locks, untap locks
- **Evidence:** R
- **Same root cause:** Avatar's Wrath; Vorinclex, Voice of Hunger; The Aetherspark; The Eternal Wanderer; Port Razer; Bloodthirsty Blade; The Immortal Sun; Bloodthirster; Nowhere to Run; Stormtide Leviathan; Soulless Jailer; Rite of the Raging Storm

### #2720 Thousand-Faced Shadow

- **Finding:** Incomplete implementation · **Severity:** Medium · **Plays:** weaker than printed
- **Coverage:** incorrect — "target attacking/blocking creature" is not read / when ~ enters from your hand, if it's attacking, create a token that's a copy of another target attacking creature. the token enters tapped and attacking.
- **Oracle text:** Ninjutsu {2}{U}{U} ({2}{U}{U}, Return an unblocked attacker you control to hand: Put this card onto the battlefield from your hand tapped and attacking.) / Flying / When this creature enters from your hand, if it's attacking, create a token that's a copy of another target attacking creature. The token enters tapped and attacking.
- **Expected:** Ninjutsu ETB: token copy of another attacking creature.
- **Actual:** Trigger not read.
- **Failure classes:** C (Effect never executes), H (Incorrect trigger timing or registration)
- **Root cause:** RC15 Whole ability not read (incomplete implementation)
- **Source:** effects.js parseCard leaves the line in fx.unread; coverage.mjs RESTRICTION (l.52) labels the card "restriction" (stronger) when the unread text merely contains "activate only"/"can't"
- **Evidence:** R
- **Same root cause:** Dauthi Voidwalker; Nesting Grounds; Destiny Spinner; Skrelv, Defector Mite; Endurance; Guide of Souls; Terastodon; Avatar's Wrath; Resourceful Defense; Kozilek, the Great Distortion; Fire Nation Palace; March of Swirling Mist and 47 more

### #2726 Reckless Handling

- **Finding:** Confirmed defect · **Severity:** Low · **Plays:** weaker than printed
- **Coverage:** incorrect — an "if" the reader can't read (rules 17: that part does nothing and is reported; before: treated as true)
- **Oracle text:** Search your library for an artifact card, reveal it, put it into your hand, shuffle, then discard a card at random. If an artifact card was discarded this way, Reckless Handling deals 2 damage to each opponent.
- **Expected:** 2 damage if an artifact was discarded.
- **Actual:** Never deals damage.
- **Failure classes:** G (Incorrect conditions or restrictions)
- **Root cause:** RC01 Unread "if" condition at resolution
- **Source:** effects.js parseCond (l.626, cond17 l.708) returns {c:"?"}; triggers.js evalCond case "?" (l.453) returns !ctx.resolving; resolve.js runEffects case "if" (l.943) forces the else branch or skips
- **Evidence:** R
- **Same root cause:** Guardian Project; Arena of Glory; Springheart Nantuko; Spelunking; Padeem, Consul of Innovation; Approach of the Second Sun; Tataru Taru; Noxious Gearhulk; Combustible Gearhulk; Liberator, Urza's Battlethopter; Carpet of Flowers; Bonehoard Dracosaur and 25 more

### #2738 Wilhelt, the Rotcleaver

- **Finding:** Confirmed defect · **Severity:** High · **Plays:** differently from printed
- **Coverage:** incorrect — an "if" the reader can't read (rules 17: that part does nothing and is reported; before: treated as true)
- **Oracle text:** Whenever another Zombie you control dies, if it didn't have decayed, create a 2/2 black Zombie creature token with decayed. (It can't block. When it attacks, sacrifice it at end of combat.) / At the beginning of your end step, you may sacrifice a Zombie. If you do, draw a card.
- **Expected:** Zombie dies without decayed: 2/2 decayed Zombie; end step: may sacrifice a Zombie to draw.
- **Actual:** No tokens ever; the end-step draw happens with no sacrifice.
- **Failure classes:** G (Incorrect conditions or restrictions), F (Incorrect mana or additional cost payment)
- **Root cause:** RC01 Unread "if" condition at resolution; RC11 A player's choice is not asked (punishers, "may have you", optional costs)
- **Source:** effects.js parseCond (l.626, cond17 l.708) returns {c:"?"}; triggers.js evalCond case "?" (l.453) returns !ctx.resolving; resolve.js runEffects case "if" (l.943) forces the else branch or skips — reader keeps one branch of "target opponent may have you draw…", "you may sacrifice…, if you do", "if you don't, put … into your hand"
- **Evidence:** R
- **Same root cause:** Guardian Project; Arena of Glory; Springheart Nantuko; Spelunking; Padeem, Consul of Innovation; Approach of the Second Sun; Tataru Taru; Noxious Gearhulk; Combustible Gearhulk; Liberator, Urza's Battlethopter; Carpet of Flowers; Bonehoard Dracosaur and 29 more

### #2741 Gilded Drake

- **Finding:** Confirmed defect · **Severity:** Critical · **Plays:** weaker than printed
- **Coverage:** incorrect — "up to N target" is not read / This ability still resolves if its target becomes illegal.
- **Oracle text:** Flying / When this creature enters, exchange control of this creature and up to one target creature an opponent controls. If you don't or can't make an exchange, sacrifice this creature. This ability still resolves if its target becomes illegal.
- **Expected:** Exchange control of Drake and up to one target opponent creature; sacrifice only if no exchange.
- **Actual:** Drake is sacrificed and nothing is exchanged.
- **Failure classes:** B (Recognized but incorrectly constructed), N (Incorrect ownership or controller handling), E (Incorrect targeting or target legality)
- **Root cause:** RC13 Clause bound to the wrong object or read as the wrong effect
- **Source:** Token riders ("exile this token", "sacrifice this token") read as exileSelf/sacSelf of the source; copyToken "of it" falls back to src (resolve.js l.439-441); pumpTrig reads ctx.trig.o; conditions read as unconditional; modal text misread
- **Evidence:** P07
- **Same root cause:** Expressive Iteration; Hunter's Insight; Not Dead After All; Delina, Wild Mage; Inti, Seneschal of the Sun; Kozilek's Command; Court of Garenbrig; Abdel Adrian, Gorion's Ward; Sunfall; Court of Vantress; Charming Scoundrel; Springheart Nantuko and 5 more

### #2755 Rionya, Fire Dancer

- **Finding:** Incomplete implementation · **Severity:** Medium · **Plays:** weaker than printed
- **Coverage:** incorrect — "target … you control" is not read (a person could aim it at an opponent's permanent) / at the beginning of combat on your turn, create x tokens that are copies of another target creature you control, where x is one plus the number of instant and sorcery spells you've cast this turn. they gain haste. exi…
- **Oracle text:** At the beginning of combat on your turn, create X tokens that are copies of another target creature you control, where X is one plus the number of instant and sorcery spells you've cast this turn. They gain haste. Exile them at the beginning of the next end step.
- **Expected:** Each combat, X hasty token copies of another creature you control, exiled at end step.
- **Actual:** Nothing read.
- **Failure classes:** C (Effect never executes), M (Incorrect X-value or variable calculation), P (Incorrect cleanup, expiration or delayed effects)
- **Root cause:** RC15 Whole ability not read (incomplete implementation)
- **Source:** effects.js parseCard leaves the line in fx.unread; coverage.mjs RESTRICTION (l.52) labels the card "restriction" (stronger) when the unread text merely contains "activate only"/"can't"
- **Evidence:** R
- **Same root cause:** Dauthi Voidwalker; Nesting Grounds; Destiny Spinner; Skrelv, Defector Mite; Endurance; Guide of Souls; Terastodon; Avatar's Wrath; Resourceful Defense; Kozilek, the Great Distortion; Fire Nation Palace; March of Swirling Mist and 47 more

### #2757 Boseiju, Who Shelters All

- **Finding:** Confirmed defect · **Severity:** Medium · **Plays:** weaker than printed
- **Coverage:** restriction — If that mana is spent on an instant or sorcery spell, that spell can't be countered.
- **Oracle text:** Boseiju enters tapped. / {T}, Pay 2 life: Add {C}. If that mana is spent on an instant or sorcery spell, that spell can't be countered.
- **Expected:** Instant/sorcery paid with it can't be countered.
- **Actual:** Rider dropped.
- **Failure classes:** F (Incorrect mana or additional cost payment)
- **Root cause:** RC03 Spend restrictions on mana not modelled; extra mana lines merged
- **Source:** effects.js mana-line reader (l.2060-2100) keeps only fx.mana.only creatureSpell/creatureAbility and cavern; the colors of every mana line are unioned into one fx.mana; mana.js spendOk (l.38) knows two restrictions
- **Evidence:** R
- **Same root cause:** Delighted Halfling; Secluded Courtyard; Unclaimed Territory; Plaza of Heroes; Throne of Eldraine; Haven of the Spirit Dragon; Codsworth, Handy Helper; Giada, Font of Hope; Gwenna, Eyes of Gaea; Great Hall of the Citadel; Maelstrom of the Spirit Dragon; Power Depot and 10 more

### #2759 Mistveil Plains

- **Finding:** Incomplete implementation · **Severity:** Low · **Plays:** weaker than printed
- **Coverage:** restriction — {w}, {t}: put target card from your graveyard on the bottom of your library. activate only if you control two or more white permanents.
- **Oracle text:** ({T}: Add {W}.) / This land enters tapped. / {W}, {T}: Put target card from your graveyard on the bottom of your library. Activate only if you control two or more white permanents.
- **Expected:** Tuck a graveyard card.
- **Actual:** Not read.
- **Failure classes:** C (Effect never executes)
- **Root cause:** RC15 Whole ability not read (incomplete implementation)
- **Source:** effects.js parseCard leaves the line in fx.unread; coverage.mjs RESTRICTION (l.52) labels the card "restriction" (stronger) when the unread text merely contains "activate only"/"can't"
- **Evidence:** R
- **Same root cause:** Dauthi Voidwalker; Nesting Grounds; Destiny Spinner; Skrelv, Defector Mite; Endurance; Guide of Souls; Terastodon; Avatar's Wrath; Resourceful Defense; Kozilek, the Great Distortion; Fire Nation Palace; March of Swirling Mist and 47 more

### #2794 Rousing Refrain

- **Finding:** Confirmed defect · **Severity:** Low · **Plays:** weaker than printed
- **Coverage:** restriction — Until end of turn, you don't lose this mana as steps and phases end. / Exile Rousing Refrain with three time counters on it.
- **Oracle text:** Add {R} for each card in target opponent's hand. Until end of turn, you don't lose this mana as steps and phases end. Exile Rousing Refrain with three time counters on it. / Suspend 3—{1}{R} (Rather than cast this card from your hand, you may pay {1}{R} and exile it with three time counters on it. At the beginning of your upkeep, remove a time counter. When the last is removed, you may cast it without paying its mana cost.)
- **Expected:** Mana kept; exile with time counters.
- **Actual:** Empties; no suspend recast.
- **Failure classes:** F (Incorrect mana or additional cost payment), P (Incorrect cleanup, expiration or delayed effects)
- **Root cause:** RC05 Mana that persists through steps and phases; RC12 Rider sentences dropped (restrictions and riders)
- **Source:** engine.js setPhase (l.319) empties every pool except keepRed — effects.js droppedSentences (l.2453): "can't be regenerated", "can't block", "doesn't untap", "can't cast spells", kicker riders, suspend riders
- **Evidence:** R
- **Same root cause:** Birgi, God of Storytelling // Harnfel, Horn of Bounty; Savage Ventmaw; Klauth, Unrivaled Ancient; Karn, Legacy Reforged; Shatterskull Smashing // Shatterskull, the Hammer Pass; Silver Shroud Costume; Mjölnir, Storm Hammer; Damn; Plaguecrafter; Sundering Eruption // Volcanic Fissure; Kappa Cannoneer; Koma, Cosmos Serpent and 9 more

### #2823 Repulsive Mutation

- **Finding:** Confirmed defect · **Severity:** Low · **Plays:** weaker than printed
- **Coverage:** restriction — Then counter up to one target spell unless its controller pays mana equal to the greatest power among creatures you control.
- **Oracle text:** Put X +1/+1 counters on target creature you control. Then counter up to one target spell unless its controller pays mana equal to the greatest power among creatures you control.
- **Expected:** Then counter up to one spell unless paid.
- **Actual:** Counter part dropped.
- **Failure classes:** E (Incorrect targeting or target legality)
- **Root cause:** RC12 Rider sentences dropped (restrictions and riders)
- **Source:** effects.js droppedSentences (l.2453): "can't be regenerated", "can't block", "doesn't untap", "can't cast spells", kicker riders, suspend riders
- **Evidence:** R
- **Same root cause:** Shatterskull Smashing // Shatterskull, the Hammer Pass; Silver Shroud Costume; Mjölnir, Storm Hammer; Damn; Plaguecrafter; Sundering Eruption // Volcanic Fissure; Kappa Cannoneer; Koma, Cosmos Serpent; Planar Genesis; Orim's Chant; Junk Winder; Taunt from the Rampart and 5 more

### #2860 Celestine, the Living Saint

- **Finding:** Incomplete implementation · **Severity:** Low · **Plays:** weaker than printed
- **Coverage:** incorrect — "target … with mana value N or less/greater" is not read / healing tears — at the beginning of your end step, return target creature card with mana value x or less from your graveyard to the battlefield, where x is the amount of life you gained this turn.
- **Oracle text:** Flying, lifelink / Healing Tears — At the beginning of your end step, return target creature card with mana value X or less from your graveyard to the battlefield, where X is the amount of life you gained this turn.
- **Expected:** End step: reanimate creature MV <= life gained this turn.
- **Actual:** Trigger not read.
- **Failure classes:** C (Effect never executes), M (Incorrect X-value or variable calculation)
- **Root cause:** RC15 Whole ability not read (incomplete implementation)
- **Source:** effects.js parseCard leaves the line in fx.unread; coverage.mjs RESTRICTION (l.52) labels the card "restriction" (stronger) when the unread text merely contains "activate only"/"can't"
- **Evidence:** R
- **Same root cause:** Dauthi Voidwalker; Nesting Grounds; Destiny Spinner; Skrelv, Defector Mite; Endurance; Guide of Souls; Terastodon; Avatar's Wrath; Resourceful Defense; Kozilek, the Great Distortion; Fire Nation Palace; March of Swirling Mist and 47 more

### #2869 Prime Speaker Zegana

- **Finding:** Confirmed defect · **Severity:** Low · **Plays:** weaker than printed
- **Coverage:** incorrect — "X, where X is …" is left as the X paid on casting (plays as 0)
- **Oracle text:** Prime Speaker Zegana enters with X +1/+1 counters on it, where X is the greatest power among other creatures you control. / When Prime Speaker Zegana enters, draw cards equal to its power.
- **Expected:** Enters with X counters, X = greatest power among your other creatures; draw that many.
- **Actual:** Enters with 0 counters (X paid = 0), draws 1.
- **Failure classes:** M (Incorrect X-value or variable calculation), J (Incorrect counters or token handling)
- **Root cause:** RC09 "X, where X is …" left as paid X (0)
- **Source:** effects.js xWhere reader (l.1047-1074) returns {dyn:"?"}; resolve.js X() reads it as 0; roll passes x only to its table rows
- **Evidence:** P29
- **Same root cause:** Palantír of Orthanc; Painful Truths; Quartzwood Crasher; Kozilek's Command; Pact of the Serpent; Ancient Bronze Dragon; Sunfall; Carpet of Flowers; Karn, Legacy Reforged; Meathook Massacre II; Well of Lost Dreams; Call the Coppercoats

### #2889 Mirrex

- **Finding:** Confirmed defect · **Severity:** Low · **Plays:** stronger than printed
- **Coverage:** restriction — Activate only if this land entered this turn.
- **Oracle text:** {T}: Add {C}. / {T}: Add one mana of any color. Activate only if this land entered this turn. / {3}, {T}: Create a 1/1 colorless Phyrexian Mite artifact creature token with toxic 1 and "This token can't block." (Players dealt combat damage by it also get a poison counter.)
- **Expected:** Any color only the turn it entered.
- **Actual:** Any color always.
- **Failure classes:** F (Incorrect mana or additional cost payment), G (Incorrect conditions or restrictions)
- **Root cause:** RC04 Conditional or second mana abilities dropped or made unconditional
- **Source:** effects.js mana lines: manaLines need only for MANA_COND words (l.48); "a Dragon", "entered this turn", "ferocious", "corrupted", "three lands with the same name", second {C}{C} lines are dropped while the color is still added
- **Evidence:** P37 (same path)
- **Same root cause:** Tablet of Discovery; Fanatic of Rhonas; Plaza of Heroes; Floodfarm Verge; Bleachbone Verge; Throne of Eldraine; Shrine of the Forsaken Gods; Eldrazi Temple; Nimbus Maze; Great Hall of the Citadel; Urza's Workshop; Sceptre of Eternal Glory and 2 more

### #2898 Nowhere to Run

- **Finding:** Confirmed defect · **Severity:** Medium · **Plays:** weaker than printed
- **Coverage:** restriction — creatures your opponents control can be the targets of spells and abilities as though they didn't have hexproof. ward abilities of those creatures don't trigger.
- **Oracle text:** Flash / When this enchantment enters, target creature an opponent controls gets -3/-3 until end of turn. / Creatures your opponents control can be the targets of spells and abilities as though they didn't have hexproof. Ward abilities of those creatures don't trigger.
- **Expected:** Ignore hexproof and ward of opponents' creatures.
- **Actual:** Not read.
- **Failure classes:** L (Incorrect continuous effects)
- **Root cause:** RC14 Static prohibitions and rule-changing statics not read
- **Source:** No reading for "players can't activate loyalty abilities", attack caps, "can't attack a player it already attacked", "ignore hexproof", graveyard-cast locks, untap locks
- **Evidence:** R
- **Same root cause:** Avatar's Wrath; Vorinclex, Voice of Hunger; The Aetherspark; The Eternal Wanderer; Port Razer; Bloodthirsty Blade; The Immortal Sun; Bloodthirster; Mirri, Weatherlight Duelist; Stormtide Leviathan; Soulless Jailer; Rite of the Raging Storm

### #2900 Dance of the Manse

- **Finding:** Incomplete implementation · **Severity:** Medium · **Plays:** weaker than printed
- **Coverage:** incorrect — "up to N target" is not read / return up to x target artifact and/or non-aura enchantment cards each with mana value x or less from your graveyard to the battlefield. if x is 6 or more, those permanents are 4/4 creatures in addition to their other …
- **Oracle text:** Return up to X target artifact and/or non-Aura enchantment cards each with mana value X or less from your graveyard to the battlefield. If X is 6 or more, those permanents are 4/4 creatures in addition to their other types.
- **Expected:** Return up to X artifact/enchantment cards MV <= X; 4/4 creatures if X >= 6.
- **Actual:** Nothing read.
- **Failure classes:** C (Effect never executes), M (Incorrect X-value or variable calculation), E (Incorrect targeting or target legality)
- **Root cause:** RC15 Whole ability not read (incomplete implementation); RC10 Multiple / divided / "up to" targets
- **Source:** effects.js parseCard leaves the line in fx.unread; coverage.mjs RESTRICTION (l.52) labels the card "restriction" (stronger) when the unread text merely contains "activate only"/"can't" — effects.js upTo splitter (l.1250-1265) only for MULTI kinds and not for divided/distributed amounts
- **Evidence:** R
- **Same root cause:** Dauthi Voidwalker; Nesting Grounds; Destiny Spinner; Skrelv, Defector Mite; Endurance; Guide of Souls; Terastodon; Avatar's Wrath; Resourceful Defense; Kozilek, the Great Distortion; Fire Nation Palace; March of Swirling Mist and 50 more

### #2908 Metamorphosis Fanatic

- **Finding:** Incomplete implementation · **Severity:** Low · **Plays:** weaker than printed
- **Coverage:** incorrect — "up to N target" is not read
- **Oracle text:** Lifelink / When this creature enters, return up to one target creature card from your graveyard to the battlefield with a lifelink counter on it. / Miracle {1}{B} (You may cast this card for its miracle cost when you draw it if it's the first card you drew this turn.)
- **Expected:** Reanimate up to one creature with a lifelink counter.
- **Actual:** Reanimation works ("up to" flag is a false positive); the lifelink counter is missing.
- **Failure classes:** J (Incorrect counters or token handling)
- **Root cause:** RC15 Whole ability not read (incomplete implementation)
- **Source:** effects.js parseCard leaves the line in fx.unread; coverage.mjs RESTRICTION (l.52) labels the card "restriction" (stronger) when the unread text merely contains "activate only"/"can't"
- **Evidence:** R
- **Same root cause:** Dauthi Voidwalker; Nesting Grounds; Destiny Spinner; Skrelv, Defector Mite; Endurance; Guide of Souls; Terastodon; Avatar's Wrath; Resourceful Defense; Kozilek, the Great Distortion; Fire Nation Palace; March of Swirling Mist and 47 more

### #2912 Benevolent Hydra

- **Finding:** Incomplete implementation · **Severity:** Low · **Plays:** weaker than printed
- **Coverage:** incorrect — "target … you control" is not read (a person could aim it at an opponent's permanent) / if one or more +1/+1 counters would be put on another creature you control, that many plus one +1/+1 counters are put on it instead. / {t}, remove a +1/+1 counter from ~: put a +1/+1 counter on another target creature you control.
- **Oracle text:** This creature enters with X +1/+1 counters on it. / If one or more +1/+1 counters would be put on another creature you control, that many plus one +1/+1 counters are put on it instead. / {T}, Remove a +1/+1 counter from this creature: Put a +1/+1 counter on another target creature you control.
- **Expected:** +1 counter replacement; move counters ability.
- **Actual:** Enters with X counters (correct); replacement and ability not read.
- **Failure classes:** K (Incorrect replacement or prevention), J (Incorrect counters or token handling)
- **Root cause:** RC15 Whole ability not read (incomplete implementation); RC16 Replacement effects modelled as costs or not read
- **Source:** effects.js parseCard leaves the line in fx.unread; coverage.mjs RESTRICTION (l.52) labels the card "restriction" (stronger) when the unread text merely contains "activate only"/"can't" — Mox Diamond read as addCost discard; +1 counter replacement and draw replacement unread
- **Evidence:** R
- **Same root cause:** Dauthi Voidwalker; Nesting Grounds; Destiny Spinner; Skrelv, Defector Mite; Endurance; Guide of Souls; Terastodon; Avatar's Wrath; Resourceful Defense; Kozilek, the Great Distortion; Fire Nation Palace; March of Swirling Mist and 48 more

### #2918 Glistening Sphere

- **Finding:** Incomplete implementation · **Severity:** Low · **Plays:** weaker than printed
- **Coverage:** restriction — Corrupted — {T}: Add three mana of any one color. / Activate only if an opponent has three or more poison counters.
- **Oracle text:** This artifact enters tapped. / When this artifact enters, proliferate. / {T}: Add one mana of any color. / Corrupted — {T}: Add three mana of any one color. Activate only if an opponent has three or more poison counters.
- **Expected:** Corrupted: three mana.
- **Actual:** Not read.
- **Failure classes:** F (Incorrect mana or additional cost payment)
- **Root cause:** RC04 Conditional or second mana abilities dropped or made unconditional
- **Source:** effects.js mana lines: manaLines need only for MANA_COND words (l.48); "a Dragon", "entered this turn", "ferocious", "corrupted", "three lands with the same name", second {C}{C} lines are dropped while the color is still added
- **Evidence:** R
- **Same root cause:** Tablet of Discovery; Fanatic of Rhonas; Plaza of Heroes; Floodfarm Verge; Bleachbone Verge; Throne of Eldraine; Shrine of the Forsaken Gods; Eldrazi Temple; Nimbus Maze; Great Hall of the Citadel; Urza's Workshop; Sceptre of Eternal Glory and 2 more

### #2921 Stormtide Leviathan

- **Finding:** Incomplete implementation · **Severity:** Low · **Plays:** weaker than printed
- **Coverage:** restriction — all lands are islands in addition to their other types. / creatures without flying or islandwalk can't attack.
- **Oracle text:** Islandwalk (This creature can't be blocked as long as defending player controls an Island.) / All lands are Islands in addition to their other types. / Creatures without flying or islandwalk can't attack.
- **Expected:** All lands Islands; attack restriction.
- **Actual:** Not read.
- **Failure classes:** L (Incorrect continuous effects)
- **Root cause:** RC14 Static prohibitions and rule-changing statics not read
- **Source:** No reading for "players can't activate loyalty abilities", attack caps, "can't attack a player it already attacked", "ignore hexproof", graveyard-cast locks, untap locks
- **Evidence:** R
- **Same root cause:** Avatar's Wrath; Vorinclex, Voice of Hunger; The Aetherspark; The Eternal Wanderer; Port Razer; Bloodthirsty Blade; The Immortal Sun; Bloodthirster; Mirri, Weatherlight Duelist; Nowhere to Run; Soulless Jailer; Rite of the Raging Storm

### #2994 Oakhollow Village

- **Finding:** Confirmed defect · **Severity:** Low · **Plays:** stronger than printed
- **Coverage:** restriction — Spend this mana only to cast a creature spell.
- **Oracle text:** {T}: Add {C}. / {T}: Add {G}. Spend this mana only to cast a creature spell. / {G}, {T}: Put a +1/+1 counter on each Frog, Rabbit, Raccoon, or Squirrel you control that entered the battlefield this turn.
- **Expected:** {G} for creature spells only.
- **Actual:** Unrestricted.
- **Failure classes:** F (Incorrect mana or additional cost payment)
- **Root cause:** RC03 Spend restrictions on mana not modelled; extra mana lines merged
- **Source:** effects.js mana-line reader (l.2060-2100) keeps only fx.mana.only creatureSpell/creatureAbility and cavern; the colors of every mana line are unioned into one fx.mana; mana.js spendOk (l.38) knows two restrictions
- **Evidence:** R
- **Same root cause:** Delighted Halfling; Secluded Courtyard; Unclaimed Territory; Plaza of Heroes; Throne of Eldraine; Haven of the Spirit Dragon; Codsworth, Handy Helper; Giada, Font of Hope; Gwenna, Eyes of Gaea; Great Hall of the Citadel; Maelstrom of the Spirit Dragon; Power Depot and 10 more

### #3014 Rivaz of the Claw

- **Finding:** Confirmed defect · **Severity:** Medium · **Plays:** differently from printed
- **Coverage:** restriction — once during each of your turns, you may cast a dragon creature spell from your graveyard. / whenever you cast a dragon creature spell from your graveyard, it gains "when ~ dies, exile it." / Spend this mana only to cast Dragon creature spells.
- **Oracle text:** Menace / {T}: Add two mana in any combination of colors. Spend this mana only to cast Dragon creature spells. / Once during each of your turns, you may cast a Dragon creature spell from your graveyard. / Whenever you cast a Dragon creature spell from your graveyard, it gains "When this creature dies, exile it."
- **Expected:** Mana for Dragon creatures only; cast one from graveyard each turn.
- **Actual:** Unrestricted mana; no graveyard casting.
- **Failure classes:** F (Incorrect mana or additional cost payment), P (Incorrect cleanup, expiration or delayed effects)
- **Root cause:** RC03 Spend restrictions on mana not modelled; extra mana lines merged; RC08 Temporary cast/play permissions missing or too broad
- **Source:** effects.js mana-line reader (l.2060-2100) keeps only fx.mana.only creatureSpell/creatureAbility and cavern; the colors of every mana line are unioned into one fx.mana; mana.js spendOk (l.38) knows two restrictions — resolve.js dig/exileTrigCard/exileGy/mill create no mayPlay; gyCastTurn (l.1911) stores types only, so empty types = every nonland card, unlimited; mana.js castModeRaw (l.510)
- **Evidence:** R
- **Same root cause:** Delighted Halfling; Secluded Courtyard; Unclaimed Territory; Plaza of Heroes; Throne of Eldraine; Haven of the Spirit Dragon; Codsworth, Handy Helper; Giada, Font of Hope; Gwenna, Eyes of Gaea; Great Hall of the Citadel; Maelstrom of the Spirit Dragon; Power Depot and 22 more

### #3015 Mudflat Village

- **Finding:** Confirmed defect · **Severity:** Low · **Plays:** stronger than printed
- **Coverage:** restriction — Spend this mana only to cast a creature spell.
- **Oracle text:** {T}: Add {C}. / {T}: Add {B}. Spend this mana only to cast a creature spell. / {1}{B}, {T}, Sacrifice this land: Return target Bat, Lizard, Rat, or Squirrel card from your graveyard to your hand.
- **Expected:** {B} for creatures; regrow Bat/Lizard/Rat/Squirrel.
- **Actual:** Unrestricted; regrows any creature.
- **Failure classes:** F (Incorrect mana or additional cost payment), E (Incorrect targeting or target legality)
- **Root cause:** RC03 Spend restrictions on mana not modelled; extra mana lines merged; RC06 Target qualifiers not enforced (legendary, MV, attacking, dynamic limits)
- **Source:** effects.js mana-line reader (l.2060-2100) keeps only fx.mana.only creatureSpell/creatureAbility and cavern; the colors of every mana line are unioned into one fx.mana; mana.js spendOk (l.38) knows two restrictions — effects.js targetWords (l.1107) only runs for TARGETED kinds (l.1103): reanimate, counter, steal-with-MV, tutor, regrow get no e.tr; tr has no dynamic limits (X, graveyard size); resolve.js targetFits (l.155) / legalTargets (l.111)
- **Evidence:** R
- **Same root cause:** Delighted Halfling; Secluded Courtyard; Unclaimed Territory; Plaza of Heroes; Throne of Eldraine; Haven of the Spirit Dragon; Codsworth, Handy Helper; Giada, Font of Hope; Gwenna, Eyes of Gaea; Great Hall of the Citadel; Maelstrom of the Spirit Dragon; Power Depot and 16 more

### #3016 Gathering Stone

- **Finding:** Incomplete implementation · **Severity:** Low · **Plays:** weaker than printed
- **Coverage:** restriction — when ~ enters and at the beginning of your upkeep, look at the top card of your library. if it's a card of the chosen type, you may reveal it and put it into your hand. if you don't put the card into your hand, you ma…
- **Oracle text:** As this artifact enters, choose a creature type. / Spells you cast of the chosen type cost {1} less to cast. / When this artifact enters and at the beginning of your upkeep, look at the top card of your library. If it's a card of the chosen type, you may reveal it and put it into your hand. If you don't put the card into your hand, you may put it into your graveyard.
- **Expected:** Look-at-top trigger.
- **Actual:** Not read.
- **Failure classes:** C (Effect never executes)
- **Root cause:** RC15 Whole ability not read (incomplete implementation)
- **Source:** effects.js parseCard leaves the line in fx.unread; coverage.mjs RESTRICTION (l.52) labels the card "restriction" (stronger) when the unread text merely contains "activate only"/"can't"
- **Evidence:** R
- **Same root cause:** Dauthi Voidwalker; Nesting Grounds; Destiny Spinner; Skrelv, Defector Mite; Endurance; Guide of Souls; Terastodon; Avatar's Wrath; Resourceful Defense; Kozilek, the Great Distortion; Fire Nation Palace; March of Swirling Mist and 47 more

### #3017 Eclipsed Realms

- **Finding:** Confirmed defect · **Severity:** Low · **Plays:** stronger than printed
- **Coverage:** restriction — Spend this mana only to cast a spell of the chosen type or activate an ability of a source of the chosen type.
- **Oracle text:** As this land enters, choose Elemental, Elf, Faerie, Giant, Goblin, Kithkin, Merfolk, or Treefolk. / {T}: Add {C}. / {T}: Add one mana of any color. Spend this mana only to cast a spell of the chosen type or activate an ability of a source of the chosen type.
- **Expected:** Chosen-type mana.
- **Actual:** Unrestricted.
- **Failure classes:** F (Incorrect mana or additional cost payment)
- **Root cause:** RC03 Spend restrictions on mana not modelled; extra mana lines merged
- **Source:** effects.js mana-line reader (l.2060-2100) keeps only fx.mana.only creatureSpell/creatureAbility and cavern; the colors of every mana line are unioned into one fx.mana; mana.js spendOk (l.38) knows two restrictions
- **Evidence:** R
- **Same root cause:** Delighted Halfling; Secluded Courtyard; Unclaimed Territory; Plaza of Heroes; Throne of Eldraine; Haven of the Spirit Dragon; Codsworth, Handy Helper; Giada, Font of Hope; Gwenna, Eyes of Gaea; Great Hall of the Citadel; Maelstrom of the Spirit Dragon; Power Depot and 10 more

### #3026 Lost Monarch of Ifnir

- **Finding:** Confirmed defect · **Severity:** Low · **Plays:** weaker than printed
- **Coverage:** incorrect — an "if" the reader can't read (rules 17: that part does nothing and is reported; before: treated as true) / other zombies you control have afflict 3.
- **Oracle text:** Afflict 3 (Whenever this creature becomes blocked, defending player loses 3 life.) / Other Zombies you control have afflict 3. / At the beginning of your second main phase, if a player was dealt combat damage by a Zombie this turn, mill three cards, then you may return a creature card from your graveyard to your hand.
- **Expected:** Mill 3 and regrow if a Zombie dealt combat damage.
- **Actual:** Never.
- **Failure classes:** G (Incorrect conditions or restrictions)
- **Root cause:** RC01 Unread "if" condition at resolution
- **Source:** effects.js parseCond (l.626, cond17 l.708) returns {c:"?"}; triggers.js evalCond case "?" (l.453) returns !ctx.resolving; resolve.js runEffects case "if" (l.943) forces the else branch or skips
- **Evidence:** R
- **Same root cause:** Guardian Project; Arena of Glory; Springheart Nantuko; Spelunking; Padeem, Consul of Innovation; Approach of the Second Sun; Tataru Taru; Noxious Gearhulk; Combustible Gearhulk; Liberator, Urza's Battlethopter; Carpet of Flowers; Bonehoard Dracosaur and 25 more

### #3031 Biomancer's Familiar

- **Finding:** Incomplete implementation · **Severity:** Low · **Plays:** weaker than printed
- **Coverage:** restriction — {t}: the next time target creature adapts this turn, it adapts as though it had no +1/+1 counters on it. / This effect can't reduce the mana in that cost to less than one mana.
- **Oracle text:** Activated abilities of creatures you control cost {2} less to activate. This effect can't reduce the mana in that cost to less than one mana. / {T}: The next time target creature adapts this turn, it adapts as though it had no +1/+1 counters on it.
- **Expected:** Reduction with one-mana floor; adapt ability.
- **Actual:** Floor works (FP); the adapt ability is not read.
- **Failure classes:** C (Effect never executes)
- **Root cause:** RC15 Whole ability not read (incomplete implementation); RC21 Coverage classification false positive
- **Source:** effects.js parseCard leaves the line in fx.unread; coverage.mjs RESTRICTION (l.52) labels the card "restriction" (stronger) when the unread text merely contains "activate only"/"can't" — MISREAD regexes match words in the reading JSON (e.g. "play|until" for flash permission); RESTRICTION does not know engine.js abilityCost floors at one mana
- **Evidence:** P39 (floor)
- **Same root cause:** Dauthi Voidwalker; Nesting Grounds; Destiny Spinner; Skrelv, Defector Mite; Endurance; Guide of Souls; Terastodon; Avatar's Wrath; Resourceful Defense; Kozilek, the Great Distortion; Fire Nation Palace; March of Swirling Mist and 54 more

### #3039 Hollowmurk Siege

- **Finding:** Incomplete implementation · **Severity:** Low · **Plays:** weaker than printed
- **Coverage:** incorrect — "target attacking/blocking creature" is not read / • Sultai — Whenever a counter is put on a creature you control, draw a card. / This ability triggers only once each turn. / • Abzan — Whenever you attack, put a +1/+1 counter on target attacking creature. / It gains menace until end of turn.
- **Oracle text:** As this enchantment enters, choose Sultai or Abzan. / • Sultai — Whenever a counter is put on a creature you control, draw a card. This ability triggers only once each turn. / • Abzan — Whenever you attack, put a +1/+1 counter on target attacking creature. It gains menace until end of turn.
- **Expected:** Sultai or Abzan mode triggers.
- **Actual:** Only the choice is read.
- **Failure classes:** C (Effect never executes), H (Incorrect trigger timing or registration)
- **Root cause:** RC15 Whole ability not read (incomplete implementation)
- **Source:** effects.js parseCard leaves the line in fx.unread; coverage.mjs RESTRICTION (l.52) labels the card "restriction" (stronger) when the unread text merely contains "activate only"/"can't"
- **Evidence:** R
- **Same root cause:** Dauthi Voidwalker; Nesting Grounds; Destiny Spinner; Skrelv, Defector Mite; Endurance; Guide of Souls; Terastodon; Avatar's Wrath; Resourceful Defense; Kozilek, the Great Distortion; Fire Nation Palace; March of Swirling Mist and 47 more

### #3041 Blowfly Infestation

- **Finding:** Confirmed defect · **Severity:** Low · **Plays:** weaker than printed
- **Coverage:** incorrect — an "if" the reader can't read (rules 17: that part does nothing and is reported; before: treated as true)
- **Oracle text:** Whenever a creature dies, if it had a -1/-1 counter on it, put a -1/-1 counter on target creature.
- **Expected:** Spread -1/-1 counters.
- **Actual:** Never.
- **Failure classes:** G (Incorrect conditions or restrictions)
- **Root cause:** RC01 Unread "if" condition at resolution
- **Source:** effects.js parseCond (l.626, cond17 l.708) returns {c:"?"}; triggers.js evalCond case "?" (l.453) returns !ctx.resolving; resolve.js runEffects case "if" (l.943) forces the else branch or skips
- **Evidence:** R
- **Same root cause:** Guardian Project; Arena of Glory; Springheart Nantuko; Spelunking; Padeem, Consul of Innovation; Approach of the Second Sun; Tataru Taru; Noxious Gearhulk; Combustible Gearhulk; Liberator, Urza's Battlethopter; Carpet of Flowers; Bonehoard Dracosaur and 25 more

### #3046 Yenna, Redtooth Regent

- **Finding:** Confirmed defect · **Severity:** Medium · **Plays:** differently from printed
- **Coverage:** incorrect — an "if" the reader can't read (rules 17: that part does nothing and is reported; before: treated as true)
- **Oracle text:** {2}, {T}: Choose target enchantment you control that doesn't have the same name as another permanent you control. Create a token that's a copy of it, except it isn't legendary. If the token is an Aura, untap Yenna, then scry 2. Activate only as a sorcery.
- **Expected:** Copy target uniquely named enchantment you control; Aura: untap and scry 2.
- **Actual:** Makes a non-legendary token copy of Yenna herself.
- **Failure classes:** B (Recognized but incorrectly constructed), E (Incorrect targeting or target legality), G (Incorrect conditions or restrictions)
- **Root cause:** RC13 Clause bound to the wrong object or read as the wrong effect; RC01 Unread "if" condition at resolution
- **Source:** Token riders ("exile this token", "sacrifice this token") read as exileSelf/sacSelf of the source; copyToken "of it" falls back to src (resolve.js l.439-441); pumpTrig reads ctx.trig.o; conditions read as unconditional; modal text misread — effects.js parseCond (l.626, cond17 l.708) returns {c:"?"}; triggers.js evalCond case "?" (l.453) returns !ctx.resolving; resolve.js runEffects case "if" (l.943) forces the else branch or skips
- **Evidence:** T: resolve.js copyToken of "it" -> src (same as P27)
- **Same root cause:** Expressive Iteration; Hunter's Insight; Not Dead After All; Delina, Wild Mage; Inti, Seneschal of the Sun; Kozilek's Command; Court of Garenbrig; Gilded Drake; Abdel Adrian, Gorion's Ward; Sunfall; Court of Vantress; Charming Scoundrel and 39 more

### #3050 The Mind Stone

- **Finding:** Incomplete implementation · **Severity:** Low · **Plays:** weaker than printed
- **Coverage:** incorrect — "up to N target" is not read / "target … you control" is not read (a person could aim it at an opponent's permanent) / {5}{w}, {t}: harness ~. / ∞ — at the beginning of your end step, exile up to one other target nonland permanent you control, then return that card to the battlefield under its owner's control.
- **Oracle text:** Indestructible / {T}: Add {W}. / {5}{W}, {T}: Harness The Mind Stone. (Once harnessed, its ∞ ability is active.) / ∞ — At the beginning of your end step, exile up to one other target nonland permanent you control, then return that card to the battlefield under its owner's control.
- **Expected:** Harness; blink at end step.
- **Actual:** Mana only.
- **Failure classes:** C (Effect never executes)
- **Root cause:** RC15 Whole ability not read (incomplete implementation)
- **Source:** effects.js parseCard leaves the line in fx.unread; coverage.mjs RESTRICTION (l.52) labels the card "restriction" (stronger) when the unread text merely contains "activate only"/"can't"
- **Evidence:** R
- **Same root cause:** Dauthi Voidwalker; Nesting Grounds; Destiny Spinner; Skrelv, Defector Mite; Endurance; Guide of Souls; Terastodon; Avatar's Wrath; Resourceful Defense; Kozilek, the Great Distortion; Fire Nation Palace; March of Swirling Mist and 47 more

### #3054 Misleading Signpost

- **Finding:** Incomplete implementation · **Severity:** Low · **Plays:** weaker than printed
- **Coverage:** incorrect — "target attacking/blocking creature" is not read / when ~ enters during the declare attackers step, you may reselect which player or permanent target attacking creature is attacking.
- **Oracle text:** Flash / When this artifact enters during the declare attackers step, you may reselect which player or permanent target attacking creature is attacking. (It can't attack its controller or their permanents.) / {T}: Add {U}.
- **Expected:** Redirect an attacker.
- **Actual:** Mana only.
- **Failure classes:** C (Effect never executes)
- **Root cause:** RC15 Whole ability not read (incomplete implementation)
- **Source:** effects.js parseCard leaves the line in fx.unread; coverage.mjs RESTRICTION (l.52) labels the card "restriction" (stronger) when the unread text merely contains "activate only"/"can't"
- **Evidence:** R
- **Same root cause:** Dauthi Voidwalker; Nesting Grounds; Destiny Spinner; Skrelv, Defector Mite; Endurance; Guide of Souls; Terastodon; Avatar's Wrath; Resourceful Defense; Kozilek, the Great Distortion; Fire Nation Palace; March of Swirling Mist and 47 more

### #3067 Marauding Raptor

- **Finding:** Confirmed defect · **Severity:** Medium · **Plays:** stronger than printed
- **Coverage:** incorrect — an "if" the reader can't read (rules 17: that part does nothing and is reported; before: treated as true)
- **Oracle text:** Creature spells you cast cost {1} less to cast. / Whenever another creature you control enters, this creature deals 2 damage to it. If a Dinosaur is dealt damage this way, this creature gets +2/+0 until end of turn.
- **Expected:** Deals 2 damage to each other creature you control that enters; +2/+0 if a Dinosaur.
- **Actual:** The damage is not in the reading: your creatures are never hurt.
- **Failure classes:** B (Recognized but incorrectly constructed), G (Incorrect conditions or restrictions)
- **Root cause:** RC13 Clause bound to the wrong object or read as the wrong effect; RC01 Unread "if" condition at resolution
- **Source:** Token riders ("exile this token", "sacrifice this token") read as exileSelf/sacSelf of the source; copyToken "of it" falls back to src (resolve.js l.439-441); pumpTrig reads ctx.trig.o; conditions read as unconditional; modal text misread — effects.js parseCond (l.626, cond17 l.708) returns {c:"?"}; triggers.js evalCond case "?" (l.453) returns !ctx.resolving; resolve.js runEffects case "if" (l.943) forces the else branch or skips
- **Evidence:** R
- **Same root cause:** Expressive Iteration; Hunter's Insight; Not Dead After All; Delina, Wild Mage; Inti, Seneschal of the Sun; Kozilek's Command; Court of Garenbrig; Gilded Drake; Abdel Adrian, Gorion's Ward; Sunfall; Court of Vantress; Charming Scoundrel and 39 more

### #3070 Abdel Adrian, Gorion's Ward

- **Finding:** Confirmed defect · **Severity:** Medium · **Plays:** differently from printed
- **Coverage:** incorrect — "until ~ leaves the battlefield" is not read (exiled for good)
- **Oracle text:** When Abdel Adrian enters, exile any number of other nonland permanents you control until Abdel Adrian leaves the battlefield. Create a 1/1 white Soldier creature token for each permanent exiled this way. / Choose a Background (You can have a Background as a second commander.)
- **Expected:** Exile any number of your nonland permanents until Abdel leaves; a Soldier per card.
- **Actual:** Always exactly one Soldier and nothing exiled.
- **Failure classes:** B (Recognized but incorrectly constructed), I (Incorrect zone movement), P (Incorrect cleanup, expiration or delayed effects)
- **Root cause:** RC13 Clause bound to the wrong object or read as the wrong effect; RC08 Temporary cast/play permissions missing or too broad
- **Source:** Token riders ("exile this token", "sacrifice this token") read as exileSelf/sacSelf of the source; copyToken "of it" falls back to src (resolve.js l.439-441); pumpTrig reads ctx.trig.o; conditions read as unconditional; modal text misread — resolve.js dig/exileTrigCard/exileGy/mill create no mayPlay; gyCastTurn (l.1911) stores types only, so empty types = every nonland card, unlimited; mana.js castModeRaw (l.510)
- **Evidence:** R
- **Same root cause:** Expressive Iteration; Hunter's Insight; Not Dead After All; Delina, Wild Mage; Inti, Seneschal of the Sun; Kozilek's Command; Court of Garenbrig; Gilded Drake; Sunfall; Court of Vantress; Charming Scoundrel; Springheart Nantuko and 16 more

### #3074 The Mightstone and Weakstone

- **Finding:** Confirmed defect · **Severity:** Low · **Plays:** stronger than printed
- **Coverage:** restriction — This mana can't be spent to cast nonartifact spells.
- **Oracle text:** When The Mightstone and Weakstone enters, choose one — / • Draw two cards. / • Target creature gets -5/-5 until end of turn. / {T}: Add {C}{C}. This mana can't be spent to cast nonartifact spells. / (Melds with Urza, Lord Protector.)
- **Expected:** {C}{C} only for artifact spells and abilities.
- **Actual:** Unrestricted.
- **Failure classes:** F (Incorrect mana or additional cost payment)
- **Root cause:** RC03 Spend restrictions on mana not modelled; extra mana lines merged
- **Source:** effects.js mana-line reader (l.2060-2100) keeps only fx.mana.only creatureSpell/creatureAbility and cavern; the colors of every mana line are unioned into one fx.mana; mana.js spendOk (l.38) knows two restrictions
- **Evidence:** R
- **Same root cause:** Delighted Halfling; Secluded Courtyard; Unclaimed Territory; Plaza of Heroes; Throne of Eldraine; Haven of the Spirit Dragon; Codsworth, Handy Helper; Giada, Font of Hope; Gwenna, Eyes of Gaea; Great Hall of the Citadel; Maelstrom of the Spirit Dragon; Power Depot and 10 more

### #3105 Oviya, Automech Artisan

- **Finding:** Confirmed defect · **Severity:** Low · **Plays:** weaker than printed
- **Coverage:** incorrect — an "if" the reader can't read (rules 17: that part does nothing and is reported; before: treated as true)
- **Oracle text:** Each creature that's attacking one of your opponents has trample. / {G}, {T}: You may put a creature or Vehicle card from your hand onto the battlefield. If you put an artifact onto the battlefield this way, put two +1/+1 counters on it.
- **Expected:** Put a creature/Vehicle from hand onto the battlefield; artifacts get two counters.
- **Actual:** The put-onto-battlefield part is missing; ability does nothing.
- **Failure classes:** B (Recognized but incorrectly constructed), G (Incorrect conditions or restrictions)
- **Root cause:** RC01 Unread "if" condition at resolution; RC15 Whole ability not read (incomplete implementation)
- **Source:** effects.js parseCond (l.626, cond17 l.708) returns {c:"?"}; triggers.js evalCond case "?" (l.453) returns !ctx.resolving; resolve.js runEffects case "if" (l.943) forces the else branch or skips — effects.js parseCard leaves the line in fx.unread; coverage.mjs RESTRICTION (l.52) labels the card "restriction" (stronger) when the unread text merely contains "activate only"/"can't"
- **Evidence:** R
- **Same root cause:** Guardian Project; Arena of Glory; Springheart Nantuko; Spelunking; Padeem, Consul of Innovation; Approach of the Second Sun; Tataru Taru; Noxious Gearhulk; Combustible Gearhulk; Liberator, Urza's Battlethopter; Carpet of Flowers; Bonehoard Dracosaur and 82 more

### #3121 Render Silent

- **Finding:** Confirmed defect · **Severity:** Low · **Plays:** weaker than printed
- **Coverage:** restriction — Its controller can't cast spells this turn.
- **Oracle text:** Counter target spell. Its controller can't cast spells this turn.
- **Expected:** Its controller can't cast spells this turn.
- **Actual:** Rider dropped.
- **Failure classes:** L (Incorrect continuous effects)
- **Root cause:** RC12 Rider sentences dropped (restrictions and riders)
- **Source:** effects.js droppedSentences (l.2453): "can't be regenerated", "can't block", "doesn't untap", "can't cast spells", kicker riders, suspend riders
- **Evidence:** R
- **Same root cause:** Shatterskull Smashing // Shatterskull, the Hammer Pass; Silver Shroud Costume; Mjölnir, Storm Hammer; Damn; Plaguecrafter; Sundering Eruption // Volcanic Fissure; Kappa Cannoneer; Koma, Cosmos Serpent; Planar Genesis; Orim's Chant; Junk Winder; Taunt from the Rampart and 5 more

### #3137 Fandaniel, Telophoroi Ascian

- **Finding:** Incomplete implementation · **Severity:** Medium · **Plays:** weaker than printed
- **Coverage:** restriction — at the beginning of your end step, each opponent may sacrifice a nontoken creature of their choice. each opponent who doesn't loses 2 life for each instant and sorcery card in your graveyard.
- **Oracle text:** Whenever you cast an instant or sorcery spell, surveil 1. / At the beginning of your end step, each opponent may sacrifice a nontoken creature of their choice. Each opponent who doesn't loses 2 life for each instant and sorcery card in your graveyard.
- **Expected:** Punisher end-step trigger.
- **Actual:** Not read.
- **Failure classes:** C (Effect never executes), R (Other)
- **Root cause:** RC15 Whole ability not read (incomplete implementation); RC11 A player's choice is not asked (punishers, "may have you", optional costs)
- **Source:** effects.js parseCard leaves the line in fx.unread; coverage.mjs RESTRICTION (l.52) labels the card "restriction" (stronger) when the unread text merely contains "activate only"/"can't" — reader keeps one branch of "target opponent may have you draw…", "you may sacrifice…, if you do", "if you don't, put … into your hand"
- **Evidence:** R
- **Same root cause:** Dauthi Voidwalker; Nesting Grounds; Destiny Spinner; Skrelv, Defector Mite; Endurance; Guide of Souls; Terastodon; Avatar's Wrath; Resourceful Defense; Kozilek, the Great Distortion; Fire Nation Palace; March of Swirling Mist and 53 more

### #3168 Witch's Oven

- **Finding:** Confirmed defect · **Severity:** Medium · **Plays:** weaker than printed
- **Coverage:** incorrect — an "if" the reader can't read (rules 17: that part does nothing and is reported; before: treated as true)
- **Oracle text:** {T}, Sacrifice a creature: Create a Food token. If the sacrificed creature's toughness was 4 or greater, create two Food tokens instead. (They're artifacts with "{2}, {T}, Sacrifice this token: You gain 3 life.")
- **Expected:** Two Food if toughness >= 4.
- **Actual:** Always one Food.
- **Failure classes:** G (Incorrect conditions or restrictions)
- **Root cause:** RC01 Unread "if" condition at resolution
- **Source:** effects.js parseCond (l.626, cond17 l.708) returns {c:"?"}; triggers.js evalCond case "?" (l.453) returns !ctx.resolving; resolve.js runEffects case "if" (l.943) forces the else branch or skips
- **Evidence:** P23
- **Same root cause:** Guardian Project; Arena of Glory; Springheart Nantuko; Spelunking; Padeem, Consul of Innovation; Approach of the Second Sun; Tataru Taru; Noxious Gearhulk; Combustible Gearhulk; Liberator, Urza's Battlethopter; Carpet of Flowers; Bonehoard Dracosaur and 25 more

### #3186 Diamond City

- **Finding:** Incomplete implementation · **Severity:** Low · **Plays:** weaker than printed
- **Coverage:** restriction — {t}: move a shield counter from ~ onto target creature. activate only if two or more creatures entered the battlefield under your control this turn.
- **Oracle text:** This land enters with a shield counter on it. (If it would be dealt damage or destroyed, remove a shield counter from it instead.) / {T}: Add {C}. / {T}: Move a shield counter from this land onto target creature. Activate only if two or more creatures entered the battlefield under your control this turn.
- **Expected:** Move a shield counter.
- **Actual:** Not read.
- **Failure classes:** C (Effect never executes), J (Incorrect counters or token handling)
- **Root cause:** RC15 Whole ability not read (incomplete implementation); RC19 Counter movement and named counters
- **Source:** effects.js parseCard leaves the line in fx.unread; coverage.mjs RESTRICTION (l.52) labels the card "restriction" (stronger) when the unread text merely contains "activate only"/"can't" — No effect kind for moving counters between permanents; named counters partly modelled
- **Evidence:** R
- **Same root cause:** Dauthi Voidwalker; Nesting Grounds; Destiny Spinner; Skrelv, Defector Mite; Endurance; Guide of Souls; Terastodon; Avatar's Wrath; Resourceful Defense; Kozilek, the Great Distortion; Fire Nation Palace; March of Swirling Mist and 48 more

### #3209 Ardyn, the Usurper

- **Finding:** Incomplete implementation · **Severity:** Medium · **Plays:** weaker than printed
- **Coverage:** incorrect — "up to N target" is not read / starscourge — at the beginning of combat on your turn, exile up to one target creature card from a graveyard. if you exiled a card this way, create a token that's a copy of that card, except it's a 5/5 black demon.
- **Oracle text:** Demons you control have menace, lifelink, and haste. / Starscourge — At the beginning of combat on your turn, exile up to one target creature card from a graveyard. If you exiled a card this way, create a token that's a copy of that card, except it's a 5/5 black Demon.
- **Expected:** Each combat: exile a creature card from a graveyard, make a 5/5 Demon copy.
- **Actual:** Anthem read; trigger not.
- **Failure classes:** C (Effect never executes), J (Incorrect counters or token handling)
- **Root cause:** RC15 Whole ability not read (incomplete implementation)
- **Source:** effects.js parseCard leaves the line in fx.unread; coverage.mjs RESTRICTION (l.52) labels the card "restriction" (stronger) when the unread text merely contains "activate only"/"can't"
- **Evidence:** R
- **Same root cause:** Dauthi Voidwalker; Nesting Grounds; Destiny Spinner; Skrelv, Defector Mite; Endurance; Guide of Souls; Terastodon; Avatar's Wrath; Resourceful Defense; Kozilek, the Great Distortion; Fire Nation Palace; March of Swirling Mist and 47 more

### #3229 Celestial Armor

- **Finding:** Confirmed defect · **Severity:** Low · **Plays:** differently from printed
- **Coverage:** incorrect — "target … you control" is not read (a person could aim it at an opponent's permanent)
- **Oracle text:** Flash (You may cast this spell any time you could cast an instant.) / When this Equipment enters, attach it to target creature you control. That creature gains hexproof and indestructible until end of turn. / Equipped creature gets +2/+0 and has flying. / Equip {3}{W} ({3}{W}: Attach to target creature you control. Equip only as a sorcery.)
- **Expected:** ETB attach to target creature you control; it gains hexproof and indestructible.
- **Actual:** Engine picks the creature; the pump reads ctx.trig.o (the Armor's own ETB object), so the keywords may land on the wrong object.
- **Failure classes:** E (Incorrect targeting or target legality)
- **Root cause:** RC07 Engine-chosen object replaces a printed target
- **Source:** resolve.js attachSelf (l.1432 bestOwn), ignition (l.1569 bestOwnCreature), doubleCounters (l.1205 bestOwn), draw dyn maxPower
- **Evidence:** R + P18; pump target S
- **Same root cause:** Mithril Coat; Chandra's Ignition; Silver Shroud Costume; Mjölnir, Storm Hammer; Soul's Majesty; The Aetherspark

### #3234 Strength of Will

- **Finding:** Incomplete implementation · **Severity:** Low · **Plays:** weaker than printed
- **Coverage:** incorrect — "target … you control" is not read (a person could aim it at an opponent's permanent) / until end of turn, target creature you control gains indestructible and "whenever ~ is dealt damage, put that many +1/+1 counters on it."
- **Oracle text:** Until end of turn, target creature you control gains indestructible and "Whenever this creature is dealt damage, put that many +1/+1 counters on it."
- **Expected:** Indestructible plus damage-to-counters.
- **Actual:** Nothing read.
- **Failure classes:** C (Effect never executes)
- **Root cause:** RC15 Whole ability not read (incomplete implementation)
- **Source:** effects.js parseCard leaves the line in fx.unread; coverage.mjs RESTRICTION (l.52) labels the card "restriction" (stronger) when the unread text merely contains "activate only"/"can't"
- **Evidence:** R
- **Same root cause:** Dauthi Voidwalker; Nesting Grounds; Destiny Spinner; Skrelv, Defector Mite; Endurance; Guide of Souls; Terastodon; Avatar's Wrath; Resourceful Defense; Kozilek, the Great Distortion; Fire Nation Palace; March of Swirling Mist and 47 more

### #3248 Meathook Massacre II

- **Finding:** Confirmed defect · **Severity:** Medium · **Plays:** differently from printed
- **Coverage:** restriction — whenever a creature you control dies, you may pay 3 life. if you do, return that card under your control with a finality counter on it. / whenever a creature an opponent controls dies, they may pay 3 life. if they don't, return that card under your control with a finality counter on it.
- **Oracle text:** When Meathook Massacre II enters, each player sacrifices X creatures of their choice. / Whenever a creature you control dies, you may pay 3 life. If you do, return that card under your control with a finality counter on it. / Whenever a creature an opponent controls dies, they may pay 3 life. If they don't, return that card under your control with a finality counter on it.
- **Expected:** Each player sacrifices X creatures; two return triggers.
- **Actual:** Each player sacrifices one; triggers unread.
- **Failure classes:** M (Incorrect X-value or variable calculation), C (Effect never executes)
- **Root cause:** RC09 "X, where X is …" left as paid X (0); RC15 Whole ability not read (incomplete implementation)
- **Source:** effects.js xWhere reader (l.1047-1074) returns {dyn:"?"}; resolve.js X() reads it as 0; roll passes x only to its table rows — effects.js parseCard leaves the line in fx.unread; coverage.mjs RESTRICTION (l.52) labels the card "restriction" (stronger) when the unread text merely contains "activate only"/"can't"
- **Evidence:** R
- **Same root cause:** Palantír of Orthanc; Painful Truths; Quartzwood Crasher; Kozilek's Command; Pact of the Serpent; Ancient Bronze Dragon; Prime Speaker Zegana; Sunfall; Carpet of Flowers; Karn, Legacy Reforged; Well of Lost Dreams; Call the Coppercoats and 59 more

### #3267 Mjölnir, Storm Hammer

- **Finding:** Confirmed defect · **Severity:** Medium · **Plays:** differently from printed
- **Coverage:** incorrect — "target (non)legendary" is not read / Then Mjölnir deals damage to each opponent equal to the number of tapped creatures that opponent controls.
- **Oracle text:** When Mjölnir enters, attach it to target legendary creature you control. / Whenever equipped creature attacks, tap target creature defending player controls and put a stun counter on it. Then Mjölnir deals damage to each opponent equal to the number of tapped creatures that opponent controls. / Equip {4}
- **Expected:** Attach to target legendary creature you control; on attack tap + stun, then damage per tapped creature.
- **Actual:** Attaches to any creature; tap only, no stun counter and no damage.
- **Failure classes:** E (Incorrect targeting or target legality), J (Incorrect counters or token handling)
- **Root cause:** RC07 Engine-chosen object replaces a printed target; RC12 Rider sentences dropped (restrictions and riders)
- **Source:** resolve.js attachSelf (l.1432 bestOwn), ignition (l.1569 bestOwnCreature), doubleCounters (l.1205 bestOwn), draw dyn maxPower — effects.js droppedSentences (l.2453): "can't be regenerated", "can't block", "doesn't untap", "can't cast spells", kicker riders, suspend riders
- **Evidence:** R + P18
- **Same root cause:** Mithril Coat; Chandra's Ignition; Silver Shroud Costume; Celestial Armor; Soul's Majesty; The Aetherspark; Shatterskull Smashing // Shatterskull, the Hammer Pass; Damn; Plaguecrafter; Sundering Eruption // Volcanic Fissure; Kappa Cannoneer; Koma, Cosmos Serpent and 10 more

### #3271 Tablet of Discovery

- **Finding:** Confirmed defect · **Severity:** Low · **Plays:** weaker than printed
- **Coverage:** incorrect — "you may play/cast … this turn" is not read / You may play that card this turn. / Spend this mana only to cast instant and sorcery spells.
- **Oracle text:** When this artifact enters, mill a card. You may play that card this turn. (To mill a card, put the top card of your library into your graveyard.) / {T}: Add {R}. / {T}: Add {R}{R}. Spend this mana only to cast instant and sorcery spells.
- **Expected:** Mill one, may play it this turn; {T}: {R}{R} for instants/sorceries.
- **Actual:** Mill without permission; only the {R} ability.
- **Failure classes:** P (Incorrect cleanup, expiration or delayed effects), F (Incorrect mana or additional cost payment)
- **Root cause:** RC08 Temporary cast/play permissions missing or too broad; RC04 Conditional or second mana abilities dropped or made unconditional
- **Source:** resolve.js dig/exileTrigCard/exileGy/mill create no mayPlay; gyCastTurn (l.1911) stores types only, so empty types = every nonland card, unlimited; mana.js castModeRaw (l.510) — effects.js mana lines: manaLines need only for MANA_COND words (l.48); "a Dragon", "entered this turn", "ferocious", "corrupted", "three lands with the same name", second {C}{C} lines are dropped while the color is still added
- **Evidence:** R
- **Same root cause:** Dauthi Voidwalker; Emry, Lurker of the Loch; Expressive Iteration; Chainer, Nightmare Adept; Containment Construct; Zul Ashur, Lich Lord; Mnemonic Betrayal; Abdel Adrian, Gorion's Ward; Dire Fleet Daredevil; Valakut Exploration; Tinybones, Bauble Burglar; Rivaz of the Claw and 14 more

### #3274 Ghost Vacuum

- **Finding:** Incomplete implementation · **Severity:** Low · **Plays:** weaker than printed
- **Coverage:** restriction — {6}, {t}, sacrifice ~: put each creature card exiled with ~ onto the battlefield under your control with a flying counter on it. each of them is a 1/1 spirit in addition to its other types. activate only as a sorcery.
- **Oracle text:** {T}: Exile target card from a graveyard. / {6}, {T}, Sacrifice this artifact: Put each creature card exiled with this artifact onto the battlefield under your control with a flying counter on it. Each of them is a 1/1 Spirit in addition to its other types. Activate only as a sorcery.
- **Expected:** Reanimate everything it exiled.
- **Actual:** Not read.
- **Failure classes:** C (Effect never executes)
- **Root cause:** RC15 Whole ability not read (incomplete implementation)
- **Source:** effects.js parseCard leaves the line in fx.unread; coverage.mjs RESTRICTION (l.52) labels the card "restriction" (stronger) when the unread text merely contains "activate only"/"can't"
- **Evidence:** R
- **Same root cause:** Dauthi Voidwalker; Nesting Grounds; Destiny Spinner; Skrelv, Defector Mite; Endurance; Guide of Souls; Terastodon; Avatar's Wrath; Resourceful Defense; Kozilek, the Great Distortion; Fire Nation Palace; March of Swirling Mist and 47 more

### #3300 Eiganjo Castle

- **Finding:** Incomplete implementation · **Severity:** Low · **Plays:** weaker than printed
- **Coverage:** incorrect — "target (non)legendary" is not read / {w}, {t}: prevent the next 2 damage that would be dealt to target legendary creature this turn.
- **Oracle text:** {T}: Add {W}. / {W}, {T}: Prevent the next 2 damage that would be dealt to target legendary creature this turn.
- **Expected:** Prevent 2 damage to target legendary creature.
- **Actual:** Mana only.
- **Failure classes:** K (Incorrect replacement or prevention)
- **Root cause:** RC15 Whole ability not read (incomplete implementation)
- **Source:** effects.js parseCard leaves the line in fx.unread; coverage.mjs RESTRICTION (l.52) labels the card "restriction" (stronger) when the unread text merely contains "activate only"/"can't"
- **Evidence:** R
- **Same root cause:** Dauthi Voidwalker; Nesting Grounds; Destiny Spinner; Skrelv, Defector Mite; Endurance; Guide of Souls; Terastodon; Avatar's Wrath; Resourceful Defense; Kozilek, the Great Distortion; Fire Nation Palace; March of Swirling Mist and 47 more

### #3314 Spirit Water Revival

- **Finding:** Confirmed defect · **Severity:** Low · **Plays:** weaker than printed
- **Coverage:** incorrect — an "if" the reader can't read (rules 17: that part does nothing and is reported; before: treated as true) / as an additional cost to cast ~, you may waterbend {6}.
- **Oracle text:** As an additional cost to cast this spell, you may waterbend {6}. (While paying a waterbend cost, you can tap your artifacts and creatures to help. Each one pays for {1}.) / Draw two cards. If this spell's additional cost was paid, instead shuffle your graveyard into your library, draw seven cards, and you have no maximum hand size for the rest of the game. / Exile Spirit Water Revival.
- **Expected:** Waterbend {6}: reshuffle and draw seven.
- **Actual:** Always draws two.
- **Failure classes:** F (Incorrect mana or additional cost payment), G (Incorrect conditions or restrictions)
- **Root cause:** RC01 Unread "if" condition at resolution
- **Source:** effects.js parseCond (l.626, cond17 l.708) returns {c:"?"}; triggers.js evalCond case "?" (l.453) returns !ctx.resolving; resolve.js runEffects case "if" (l.943) forces the else branch or skips
- **Evidence:** R
- **Same root cause:** Guardian Project; Arena of Glory; Springheart Nantuko; Spelunking; Padeem, Consul of Innovation; Approach of the Second Sun; Tataru Taru; Noxious Gearhulk; Combustible Gearhulk; Liberator, Urza's Battlethopter; Carpet of Flowers; Bonehoard Dracosaur and 25 more

### #3321 Sunfall

- **Finding:** Confirmed defect · **Severity:** Medium · **Plays:** weaker than printed
- **Coverage:** incorrect — "X, where X is …" is left as the X paid on casting (plays as 0)
- **Oracle text:** Exile all creatures. Incubate X, where X is the number of creatures exiled this way. (Create an Incubator token with X +1/+1 counters on it and "{2}: Transform this token." It transforms into a 0/0 Phyrexian artifact creature.)
- **Expected:** Exile all creatures; incubate X (Incubator with X counters).
- **Actual:** Wipe works; the token is a "phyrexian" X/X with X = 0, which dies at once.
- **Failure classes:** M (Incorrect X-value or variable calculation), J (Incorrect counters or token handling)
- **Root cause:** RC09 "X, where X is …" left as paid X (0); RC13 Clause bound to the wrong object or read as the wrong effect
- **Source:** effects.js xWhere reader (l.1047-1074) returns {dyn:"?"}; resolve.js X() reads it as 0; roll passes x only to its table rows — Token riders ("exile this token", "sacrifice this token") read as exileSelf/sacSelf of the source; copyToken "of it" falls back to src (resolve.js l.439-441); pumpTrig reads ctx.trig.o; conditions read as unconditional; modal text misread
- **Evidence:** P16
- **Same root cause:** Palantír of Orthanc; Painful Truths; Quartzwood Crasher; Kozilek's Command; Pact of the Serpent; Ancient Bronze Dragon; Prime Speaker Zegana; Carpet of Flowers; Karn, Legacy Reforged; Meathook Massacre II; Well of Lost Dreams; Call the Coppercoats and 16 more

### #3328 Soulless Jailer

- **Finding:** Incomplete implementation · **Severity:** Medium · **Plays:** weaker than printed
- **Coverage:** restriction — players can't cast noncreature spells from graveyards or exile.
- **Oracle text:** Permanent cards in graveyards can't enter the battlefield. / Players can't cast noncreature spells from graveyards or exile.
- **Expected:** No noncreature spells from graveyard/exile.
- **Actual:** Not read.
- **Failure classes:** L (Incorrect continuous effects)
- **Root cause:** RC14 Static prohibitions and rule-changing statics not read
- **Source:** No reading for "players can't activate loyalty abilities", attack caps, "can't attack a player it already attacked", "ignore hexproof", graveyard-cast locks, untap locks
- **Evidence:** R
- **Same root cause:** Avatar's Wrath; Vorinclex, Voice of Hunger; The Aetherspark; The Eternal Wanderer; Port Razer; Bloodthirsty Blade; The Immortal Sun; Bloodthirster; Mirri, Weatherlight Duelist; Nowhere to Run; Stormtide Leviathan; Rite of the Raging Storm

### #3341 Court of Vantress

- **Finding:** Confirmed defect · **Severity:** Medium · **Plays:** differently from printed
- **Coverage:** incorrect — "up to N target" is not read / If you're not the monarch, you may have this enchantment become a copy of it, except it has this ability.
- **Oracle text:** When this enchantment enters, you become the monarch. / At the beginning of your upkeep, choose up to one other target enchantment or artifact. If you're the monarch, you may create a token that's a copy of it. If you're not the monarch, you may have this enchantment become a copy of it, except it has this ability.
- **Expected:** Copy target artifact/enchantment (monarch) or become a copy of it.
- **Actual:** Makes a token copy of Court of Vantress itself.
- **Failure classes:** B (Recognized but incorrectly constructed), E (Incorrect targeting or target legality)
- **Root cause:** RC13 Clause bound to the wrong object or read as the wrong effect
- **Source:** Token riders ("exile this token", "sacrifice this token") read as exileSelf/sacSelf of the source; copyToken "of it" falls back to src (resolve.js l.439-441); pumpTrig reads ctx.trig.o; conditions read as unconditional; modal text misread
- **Evidence:** P27
- **Same root cause:** Expressive Iteration; Hunter's Insight; Not Dead After All; Delina, Wild Mage; Inti, Seneschal of the Sun; Kozilek's Command; Court of Garenbrig; Gilded Drake; Abdel Adrian, Gorion's Ward; Sunfall; Charming Scoundrel; Springheart Nantuko and 5 more

### #3370 Zirda, the Dawnwaker

- **Finding:** Not a defect (classification false positive) · **Severity:** Low · **Plays:** as printed (for the flagged part)
- **Coverage:** restriction — This effect can't reduce the mana in that cost to less than one mana.
- **Oracle text:** Companion — Each permanent card in your starting deck has an activated ability. (If this card is your chosen companion, you may put it into your hand from outside the game for {3} as a sorcery.) / Abilities you activate that aren't mana abilities cost {2} less to activate. This effect can't reduce the mana in that cost to less than one mana. / {1}, {T}: Target creature can't block this turn.
- **Expected:** Ability reduction with a one-mana floor.
- **Actual:** Floor enforced (abilityCost and reducedEquip).
- **Failure classes:** none
- **Root cause:** RC21 Coverage classification false positive
- **Source:** MISREAD regexes match words in the reading JSON (e.g. "play|until" for flash permission); RESTRICTION does not know engine.js abilityCost floors at one mana
- **Evidence:** P39 (same path)
- **Same root cause:** Chandra's Ignition; Emergence Zone; Alchemist's Refuge; Sepulchral Primordial; Training Grounds; Forensic Gadgeteer; Biomancer's Familiar

### #3384 Mech Hangar

- **Finding:** Confirmed defect · **Severity:** Low · **Plays:** stronger than printed
- **Coverage:** restriction — {3}, {t}: target vehicle becomes an artifact creature until end of turn. / Spend this mana only to cast a Pilot or Vehicle spell.
- **Oracle text:** {T}: Add {C}. / {T}: Add one mana of any color. Spend this mana only to cast a Pilot or Vehicle spell. / {3}, {T}: Target Vehicle becomes an artifact creature until end of turn.
- **Expected:** Mana for Pilots/Vehicles; animate a Vehicle.
- **Actual:** Unrestricted; ability unread.
- **Failure classes:** F (Incorrect mana or additional cost payment)
- **Root cause:** RC03 Spend restrictions on mana not modelled; extra mana lines merged; RC15 Whole ability not read (incomplete implementation)
- **Source:** effects.js mana-line reader (l.2060-2100) keeps only fx.mana.only creatureSpell/creatureAbility and cavern; the colors of every mana line are unioned into one fx.mana; mana.js spendOk (l.38) knows two restrictions — effects.js parseCard leaves the line in fx.unread; coverage.mjs RESTRICTION (l.52) labels the card "restriction" (stronger) when the unread text merely contains "activate only"/"can't"
- **Evidence:** R
- **Same root cause:** Delighted Halfling; Secluded Courtyard; Unclaimed Territory; Plaza of Heroes; Throne of Eldraine; Haven of the Spirit Dragon; Codsworth, Handy Helper; Giada, Font of Hope; Gwenna, Eyes of Gaea; Great Hall of the Citadel; Maelstrom of the Spirit Dragon; Power Depot and 69 more

### #3402 Soul's Majesty

- **Finding:** Confirmed defect · **Severity:** Low · **Plays:** stronger than printed
- **Coverage:** incorrect — "target … you control" is not read (a person could aim it at an opponent's permanent)
- **Oracle text:** Draw cards equal to the power of target creature you control.
- **Expected:** Draw cards equal to the power of target creature you control.
- **Actual:** Draws equal to your greatest power with no target (can't be fizzled).
- **Failure classes:** E (Incorrect targeting or target legality)
- **Root cause:** RC07 Engine-chosen object replaces a printed target
- **Source:** resolve.js attachSelf (l.1432 bestOwn), ignition (l.1569 bestOwnCreature), doubleCounters (l.1205 bestOwn), draw dyn maxPower
- **Evidence:** R
- **Same root cause:** Mithril Coat; Chandra's Ignition; Silver Shroud Costume; Celestial Armor; Mjölnir, Storm Hammer; The Aetherspark

### #3414 Rite of the Raging Storm

- **Finding:** Confirmed defect · **Severity:** High · **Plays:** differently from printed
- **Coverage:** restriction — creatures named lightning rager can't attack you or planeswalkers you control.
- **Oracle text:** Creatures named Lightning Rager can't attack you or planeswalkers you control. / At the beginning of each player's upkeep, that player creates a 5/1 red Elemental creature token named Lightning Rager. It has trample, haste, and "At the beginning of the end step, sacrifice this token."
- **Expected:** Each upkeep that player gets a 5/1 Lightning Rager (sacrificed at end step); Ragers can't attack you.
- **Actual:** The token's end-step sacrifice is bound to the Rite: it sacrifices itself at the first upkeep and makes nothing.
- **Failure classes:** B (Recognized but incorrectly constructed), D (Incorrect effect resolution)
- **Root cause:** RC13 Clause bound to the wrong object or read as the wrong effect; RC14 Static prohibitions and rule-changing statics not read
- **Source:** Token riders ("exile this token", "sacrifice this token") read as exileSelf/sacSelf of the source; copyToken "of it" falls back to src (resolve.js l.439-441); pumpTrig reads ctx.trig.o; conditions read as unconditional; modal text misread — No reading for "players can't activate loyalty abilities", attack caps, "can't attack a player it already attacked", "ignore hexproof", graveyard-cast locks, untap locks
- **Evidence:** P02
- **Same root cause:** Expressive Iteration; Hunter's Insight; Not Dead After All; Delina, Wild Mage; Inti, Seneschal of the Sun; Kozilek's Command; Court of Garenbrig; Gilded Drake; Abdel Adrian, Gorion's Ward; Sunfall; Court of Vantress; Charming Scoundrel and 17 more

### #3432 Dire Fleet Daredevil

- **Finding:** Incomplete implementation · **Severity:** Medium · **Plays:** weaker than printed
- **Coverage:** incorrect — "you may play/cast … this turn" is not read / when ~ enters, exile target instant or sorcery card from an opponent's graveyard. you may cast it this turn, and mana of any type can be spent to cast that spell. if that spell would be put into a graveyard, exile it …
- **Oracle text:** First strike / When this creature enters, exile target instant or sorcery card from an opponent's graveyard. You may cast it this turn, and mana of any type can be spent to cast that spell. If that spell would be put into a graveyard, exile it instead.
- **Expected:** Exile an instant/sorcery from an opponent's graveyard; cast it this turn with any mana.
- **Actual:** Trigger not read.
- **Failure classes:** C (Effect never executes), P (Incorrect cleanup, expiration or delayed effects)
- **Root cause:** RC15 Whole ability not read (incomplete implementation); RC08 Temporary cast/play permissions missing or too broad
- **Source:** effects.js parseCard leaves the line in fx.unread; coverage.mjs RESTRICTION (l.52) labels the card "restriction" (stronger) when the unread text merely contains "activate only"/"can't" — resolve.js dig/exileTrigCard/exileGy/mill create no mayPlay; gyCastTurn (l.1911) stores types only, so empty types = every nonland card, unlimited; mana.js castModeRaw (l.510)
- **Evidence:** R
- **Same root cause:** Dauthi Voidwalker; Nesting Grounds; Destiny Spinner; Skrelv, Defector Mite; Endurance; Guide of Souls; Terastodon; Avatar's Wrath; Resourceful Defense; Kozilek, the Great Distortion; Fire Nation Palace; March of Swirling Mist and 57 more

### #3438 Out of the Tombs

- **Finding:** Incomplete implementation · **Severity:** Low · **Plays:** weaker than printed
- **Coverage:** restriction — if you would draw a card while your library has no cards in it, instead return a creature card from your graveyard to the battlefield. if you can't, you lose the game.
- **Oracle text:** At the beginning of your upkeep, put two eon counters on this enchantment, then mill cards equal to the number of eon counters on it. / If you would draw a card while your library has no cards in it, instead return a creature card from your graveyard to the battlefield. If you can't, you lose the game.
- **Expected:** Mill per eon counters; draw-from-empty replacement.
- **Actual:** Only the counters.
- **Failure classes:** K (Incorrect replacement or prevention), J (Incorrect counters or token handling)
- **Root cause:** RC16 Replacement effects modelled as costs or not read; RC15 Whole ability not read (incomplete implementation)
- **Source:** Mox Diamond read as addCost discard; +1 counter replacement and draw replacement unread — effects.js parseCard leaves the line in fx.unread; coverage.mjs RESTRICTION (l.52) labels the card "restriction" (stronger) when the unread text merely contains "activate only"/"can't"
- **Evidence:** R
- **Same root cause:** Benevolent Hydra; Mox Diamond; Dauthi Voidwalker; Nesting Grounds; Destiny Spinner; Skrelv, Defector Mite; Endurance; Guide of Souls; Terastodon; Avatar's Wrath; Resourceful Defense; Kozilek, the Great Distortion and 48 more

### #3483 Charming Scoundrel

- **Finding:** Confirmed defect · **Severity:** Low · **Plays:** stronger than printed
- **Coverage:** incorrect — "target … you control" is not read (a person could aim it at an opponent's permanent)
- **Oracle text:** Haste / When this creature enters, choose one — / • Discard a card, then draw a card. / • Create a Treasure token. / • Create a Wicked Role token attached to target creature you control.
- **Expected:** Choose one: loot; Treasure; Wicked Role on target creature you control.
- **Actual:** Loot mode draws without discarding; the Role mode is missing.
- **Failure classes:** B (Recognized but incorrectly constructed)
- **Root cause:** RC13 Clause bound to the wrong object or read as the wrong effect
- **Source:** Token riders ("exile this token", "sacrifice this token") read as exileSelf/sacSelf of the source; copyToken "of it" falls back to src (resolve.js l.439-441); pumpTrig reads ctx.trig.o; conditions read as unconditional; modal text misread
- **Evidence:** P08
- **Same root cause:** Expressive Iteration; Hunter's Insight; Not Dead After All; Delina, Wild Mage; Inti, Seneschal of the Sun; Kozilek's Command; Court of Garenbrig; Gilded Drake; Abdel Adrian, Gorion's Ward; Sunfall; Court of Vantress; Springheart Nantuko and 5 more

## Completion check

- Cards in the class: 197; cards with an individual entry above: 197 (100%).
- Confirmed defects: 133. Incomplete implementations: 57. Suspected: 1. Unable to verify: 0. Not a defect in the flagged part: 6.
- Runtime-probed directly: 42 cards; sharing a probed code path: 18; reading plus handler trace: 137.
- Shared root causes: 21 (PHASE_2C_ROOT_CAUSE_ANALYSIS.md), cross-referenced with all 11 Phase 2B workstreams; two new workstreams (reader construction RC13, coverage tooling RC21).
- Duplicate implementations identified: conditions, targets, cast permissions, mana restrictions, "up to N", coverage checks.
- No game code, card data or test file was changed.
