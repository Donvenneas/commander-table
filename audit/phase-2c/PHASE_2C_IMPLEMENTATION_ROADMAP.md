# Phase 2C — Implementation Roadmap

Ordered repair phases for the 190 defective or incomplete cards found in Phase 2C (plus 13 "full" cards found by the cross-card scan). Each phase names its dependencies, the cards it should fix, the risk, and the tests that must exist before it is ticked (details in `PHASE_2C_TEST_REQUIREMENTS.md`).

Rules that apply to every phase (from `ROADMAP.md` and `CLAUDE.md`):

- Anything that changes game outcomes goes behind a new `RULES` version (25, 26, …) so replays and golden games at older rules stay exact; `node tests/golden.mjs` must show no rules 4/5/6 difference.
- Every card fix gets a test in `tests/interactions.mjs` (or the matching suite) that fails before and passes after; a fixed card leaves its MISREAD/RESTRICTION group by itself.
- `node tests/cards.mjs --update` only when a reading change is intended, and the diff is reviewed card by card.
- Extend the existing mechanism; retire the parallel ones behind the rules version (see "Duplicate implementations" in the root cause analysis). No second system next to the first.

Ranking used: cards affected × severity (stronger-than-printed counts double: it misleads both the AI and players) × Commander/cEDH play rate, then fewest dependencies, then lowest risk.

## Phase 0 — Make the measurements trustworthy (tooling only, no game change)

**Why first:** the coverage classes are used to choose work. Today 47 of the 87 "restriction" cards are weaker, not stronger, 6 flagged cards are fine, and the worst misreadings (RC13, RC20) are invisible to the checks.

| Step | Change | Files | Effect |
|---|---|---|---|
| 0.1 | RESTRICTION counts a line only when the rest of its ability is read; whole unread abilities go to "partial" | tests/coverage.mjs | ~30 cards move to partial |
| 0.2 | Fix the false positives: flashTurn satisfies the "as though they had flash" check; skip "can't reduce … to less than one mana" | tests/coverage.mjs | 6 cards leave the class |
| 0.3 | New MISREAD checks: playTop without "top of your library" (RC20); exileSelf/sacSelf when the text says "this token"; copyToken "of it" with no trigger object; `{c:"?"}` in selfReduce/gyCastSelf/playTopCond/altManaCond (RC02); a mana card whose colors come from two lines with a "spend only" line (RC03) | tests/coverage.mjs | the hidden defects become visible; 13 "full" cards move to incorrect |
| 0.4 | Commit the Phase 2C probes as `tests/audit-2c.mjs` known-deviation tests (reported, not failing, like `rules.mjs` `known`) | tests/ | each later fix flips a probe to FIXED |

Risk: none to games. Dependencies: none. Tests: coverage numbers before/after recorded in the report.

## Phase 1 — Stop cards playing stronger than printed (P0, small and safe)

Small, local fixes whose result is "the card does less, as printed". Ordered by severity.

| Step | Root cause | Change | Cards fixed | Severity removed |
|---|---|---|---|---|
| 1.1 | RC02 | `evalCond` case `?`: false in every context from the new rules version (costOf, castModeRaw, topPlayable, altManaCond, enter conditions), reported once a game | Not of This World, The Indomitable (+ any future card) | 1 Critical, 1 High |
| 1.2 | RC06 | Counter targets get the words' restrictions (`counter` "that targets a permanent you control", "with mana value ≤ …"): extend `targetWords`/`targetFits` to stack targets with a dynamic bound | Drown in the Loch, Not of This World, Kozilek's Command mode 3 | 2 Critical |
| 1.3 | RC13 | Gilded Drake: an exchange effect (reuse `steal` both ways) with "sacrifice if you don't" | Gilded Drake | 1 Critical |
| 1.4 | RC20 | playTop regex requires "from the top of your library"; read "play lands from your graveyard" (new permission, see Phase 3) and "as though they had flash" (flash permission, exists as flashTurn/flash filters) separately | Crucible of Worlds, Ramunap Excavator, Conduit, Liberator, Omniscience, Yeva, Sigarda's Aid, Borne Upon a Wind and 7 more | — (until Phase 3 adds graveyard land play, Crucible-style cards do nothing rather than the wrong thing) |
| 1.5 | RC13/RC12 | Token riders belong to the token: Delina (attacking copy, exiled at end of combat), Rite of the Raging Storm (Lightning Rager with its own end-step sacrifice; "can't attack you") | Delina, Rite | 2 High |
| 1.6 | RC11 (minimal) | Punishers: until Phase 4, read "target opponent may have you …" as the opponent choosing the branch worse for you (AI value), never the free draw | Palantír, Combustible Gearhulk | 2 High |
| 1.7 | RC01 (else-to-drawback, and the lost win) | Approach of the Second Sun (castFrom hand + a per-game count of casts by name; seventh-from-top placement); cards where the unread condition removes a drawback: Eldrazi Monument "if you can't" (count sacrificed), Baleful Mastery "if the {1}{B} cost was paid" (`item.alt === 'altMana'`), Court of Garenbrig monarch check, The Chain Veil "didn't activate a loyalty ability" (per-turn flag) | 5 cards | 1 Critical, 3 High |
| 1.8 | RC08 | gyCastTurn: Chainer creature only, once; Zul Ashur one target Zombie; Emry one target artifact (`p.gyCast` gets `types`, `objs`, `count`) | 3 cards | 1 High |
| 1.9 | RC06 | Reanimate/regrow/tutor get target words: Persist (nonlegendary, -1/-1 counter), Thieving Skydiver (MV ≤ X), Haven/Maelstrom/Mudflat Village types | 6 cards | 2 High |

Dependencies: 1.2 and 1.9 need `targetWords` to run for non-battlefield kinds (one change in effects.js, `TARGETED` → a per-zone list). Risk: low; each is gated by the rules version and changes only these cards' readings (check with `tests/cards.mjs`). Expected benefit: removes all 4 Critical findings and 12 of 22 High; about 17 of the 45 stronger-than-printed cards return to printed strength.

## Phase 2 — Mana abilities (P0 Mana restrictions)

| Step | Change | Cards |
|---|---|---|
| 2.1 | One `fx.manaAbilities[]` entry per mana line (amount, colors, cost, condition, restriction); `fx.mana` stays as the first entry for older rules | all 38 RC03/04/05 cards |
| 2.2 | Restriction predicate on pool units: `{spell, ability, types, subtypes, legendary, chosenType, color, mono, colorless}`; `spendOk` checks it against `g.payingFor`; `planTagged` already tries every payment | Delighted Halfling, Plaza, Secluded Courtyard, Unclaimed Territory, Great Hall, Eclipsed Realms, Throne of Eldraine, Gwenna, Rivaz, Power Depot, Mech Hangar, Voldaren Estate, villages… (23) |
| 2.3 | Riders on pool units: "that spell can't be countered" (generalise Cavern's flag), haste for creature spells (Arena of Glory) | Delighted Halfling, Boseiju, Arena of Glory |
| 2.4 | Activation conditions through `parseCond` (not MANA_COND); a mana ability with an unread condition is not offered | Verges, Mox Jasper, Mirrex, Nimbus Maze, Fanatic of Rhonas, Urza's Workshop, Sceptre, Glistening Sphere, Shrine, Eldrazi Temple (15) |
| 2.5 | Pool units with `keepUntil: 'turn'`; setPhase keeps them; retire `keepRed` | Birgi, Savage Ventmaw, Klauth, Karn Legacy Reforged, Rousing Refrain |

Dependencies: none on other phases (2.3's spent-mana record is reused by Phase 4). Risk: **medium** — mana payment is on every AI decision; `tests/mana.mjs`, `tests/ai.mjs` and `tests/golden.mjs` must pass, and AI decision times (`tests/perf.mjs`) must not regress. Benefit: 38 cards; 18 stronger-than-printed mana sources fixed, several of them cEDH staples.

## Phase 3 — One permission record (P0 Cast/play permissions)

| Step | Change | Cards |
|---|---|---|
| 3.1 | `permission = {p, objs or filter, zones, until, count, free, anyMana, afterwards}` on the player; `castModeRaw` and land play read it; existing `mayPlay`, `gyCast`, `gyCastOnce`, `tempFlashback`, `playTop` become producers | — |
| 3.2 | Graveyard land play (Crucible, Ramunap, Conduit) — engine.js land play gets the graveyard zone | 3 cards (+ full cards) |
| 3.3 | Permissions from dig/mill/discard/exile effects: Expressive Iteration, Tablet of Discovery, Containment Construct, Mnemonic Betrayal (any mana, return at end step), Dire Fleet Daredevil (exile instead), Valakut Exploration (as long as it remains exiled), Rivaz, Dauthi Voidwalker's activation | 9 cards |
| 3.4 | Flash permissions for kinds of spells (Yeva, Liberator, Sigarda's Aid) through the existing flash check | 3+ cards |

Dependencies: Phase 1.4 (reader) first. Risk: medium (AI considers more plays; `tests/hidden.mjs` must confirm the AI only sees cards it may see). Benefit: 15 cards in the 197 and 13 "full" cards.

## Phase 4 — Conditions on results, history and choices (P0 Conditional evaluation)

| Step | Change | Cards |
|---|---|---|
| 4.1 | Each effect records its result on ctx (`ctx.last`: objects destroyed/exiled/milled/discarded/returned/put, kinds, counts); reader turns "this way" conditions into checks on it | Noxious Gearhulk, Grist, Reckless Handling, Arid Archway, Spelunking, Bonehoard Dracosaur, Oviya, Marauding Raptor, Grab the Prize, Return to Dust (10) |
| 4.2 | Last-known information on the trigger object (counters, toughness, types, decayed) | Unstoppable Slasher, Nine-Lives, Blowfly, Massacre Girl, Wilhelt, Witch's Oven, Nasty End (7) |
| 4.3 | Cast record on the stack item: alt cost, extra costs paid, phase, castFrom, mana spent with sources (needs Phase 2.1 pool units) | Spirit Water Revival, Alchemist's Talent, Inga and Esika, Roiling Vortex, Liberator, Arena of Glory (6, plus Baleful Mastery and Approach moved onto the shared record) |
| 4.4 | Per-turn history counters (loyalty activations, descend, combat damage by a type, this ability's mana) | Padeem, Chain Veil, Brass's Tunnel-Grinder, Lost Monarch, Tataru Taru, Carpet of Flowers (6) |
| 4.5 | Offer effect: ask the named player (AI value, `human.js`, `net.js`), keep the answer for the next effect | Combustible Gearhulk, Palantír, Tataru Taru, Wilhelt, Planar Genesis, Risen Reef, Fandaniel, Eldrazi Monument (8) |

Dependencies: 4.3 needs Phase 2.1. Risk: medium-low (each condition only turns an existing "does nothing" into "does something when true"). Benefit: 45 cards.

## Phase 5 — Reader construction fixes (RC13, new workstream)

| Step | Change | Cards |
|---|---|---|
| 5.1 | "It/that creature/that card" binds to the target or trigger object; copyToken never falls back to `src` unless the text says "~" | Court of Vantress, Yenna, Springheart Nantuko (+ test the 12 "of it" cards) |
| 5.2 | Fix individual wrong readings: Kozilek's Command modes, Charming Scoundrel (loot + Role), Hunter's Insight (delayed trigger), Not Dead After All (granted dies trigger), Artifact Mutation (destroy first), Sunfall (Incubator token), Abdel Adrian (linked exile), Marauding Raptor (damage), Inti (target attacking creature, optional discard), Expressive Iteration | 11 cards |

Dependencies: Phase 3 for Expressive Iteration and Abdel's linked exile; Phase 6 for Sunfall/Kozilek X. Risk: low (card-specific readings).

## Phase 6 — Dynamic X, targets and counts (P1)

| Step | Change | Cards |
|---|---|---|
| 6.1 | New dyn readers: converge, chosen-type count, counters on ~, trigger damage amount, "this way" count (from 4.1), greatest other power, roll result | Painful Truths, Pact of the Serpent, Palantír, Quartzwood Crasher, Sunfall, Carpet of Flowers, Ancient Bronze Dragon, Prime Speaker Zegana, Karn Legacy Reforged, Meathook Massacre II, Kozilek's Command (11) |
| 6.2 | Real targets for attachSelf, ignition, doubleCounters, draw-by-power (needsTarget + legalTargets entries) | Mithril Coat, Silver Shroud Costume, Celestial Armor, Mjölnir, Chandra's Ignition, Soul's Majesty, The Aetherspark (7) |
| 6.3 | Target lists: min/max/distinct/divided chosen once; per-target resolution | Shatterskull Smashing, Court of Garenbrig, Ancient Bronze Dragon, Terastodon, March of Swirling Mist, Dance of the Manse, Endurance (7) |

Dependencies: 6.1 uses 4.1. Risk: medium for 6.3 (target choice UI in `human.js` and `net.js` answers must accept lists). 

## Phase 7 — Riders, statics, replacements, protection, counters (P1/P2)

| Step | Change | Cards |
|---|---|---|
| 7.1 | Riders into existing flags: noRegen, noBlock this turn, skipUntap, silence (Render Silent, Orim's Chant kicked), suspend from a counter (Delay), ability lock (Koma), Kappa unblockable | 18 RC12 cards |
| 7.2 | Static prohibitions: loyalty-ability lock, attack caps, "already attacked this player", ignore hexproof/ward, graveyard-cast lock, untap lock | 13 RC14 cards |
| 7.3 | Replacements in replacements.js: Mox Diamond enter replacement, Benevolent Hydra counter replacement, Out of the Tombs draw replacement | 3 cards |
| 7.4 | Temporary protection quality for Giver of Runes (Game.protectedFrom) | 1 card |
| 7.5 | moveCounters effect over named counters | 6 RC19 cards |

## Phase 8 — Unread abilities (RC15, 57 incomplete cards)

Card-by-card, most played first, after the shared mechanics they need exist. Highest value: Karn, the Great Creator (wish from outside the game is out of scope: implement the exile half and report the rest), Dauthi Voidwalker's activation (Phase 3), Toxrill (slime counters, Phase 7.5), Endurance (Phase 6.3), Terastodon, The Chain Veil's activation, Steel Hellkite, Kozilek's counter ability.

## Sequence and dependencies

```
Phase 0 (tooling) ──► Phase 1 (stronger-than-printed) ──► Phase 2 (mana) ──┐
                         │                                                  ├─► Phase 4 (conditions; 4.3 needs 2.1) ──► Phase 6.1 (X)
                         └─► Phase 3 (permissions; needs 1.4) ──────────────┘                                     │
                                                         Phase 5 (reader construction; parts need 3 and 6) ◄──────┘
                                                         Phase 7 (riders/statics/replacements) — independent after Phase 1
                                                         Phase 8 (unread abilities) — last, per card
```

## Expected benefit

| After phase | Cards fixed (cumulative, of 190) | Critical / High left |
|---|---:|---|
| 1 | ~32 | 0 / 10 |
| 2 | ~70 | 0 / 7 |
| 3 | ~85 (+13 full) | 0 / 4 |
| 4 | ~120 | 0 / 2 |
| 5-6 | ~145 | 0 / 1 |
| 7 | ~175 | 0 / 1 |
| 8 | 190 | 0 / 0 |

(Estimates from the per-card root causes; a card counts as fixed only when all of its root causes are fixed and its test passes.)
