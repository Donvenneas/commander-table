# Phase 2C — Test Requirements

What must be tested before any Phase 2C defect is called fixed. The project already has the infrastructure (`tests/scenario.mjs` boards from real cards, `tests/interactions.mjs`, `rules.mjs` with its event recorder and `known` deviations, `mana.mjs`, `stack.mjs`, `replacements.mjs`, `golden.mjs`, `fuzz.mjs`, `hidden.mjs`, `replay.mjs`, `coverage.mjs`); nothing new is needed except the Phase 0 audit suite below. **No test was added or run as passing in this phase**; the probes in `probes/` show the current (defective) behaviour.

## 1. Acceptance criteria (every fix)

1. A test names the card and fails on 1.61.0 for the reason in the audit (the matching probe in `probes/` shows the old result).
2. The test passes after the fix at the new rules version, **and** a copy of it at the previous rules version shows the old behaviour (replays stay exact), as `interactions.mjs` already does for rules 5.
3. The test checks the sequence of events where timing matters (`record(g)`, `inOrder`), not only the end state.
4. Both seats are covered where choices exist: the AI choice and a scripted person's answer (HumanAgent with scripted answers), and for targets: the menu a person sees equals the targets the engine accepts at cast and at resolution.
5. `node tests/cards.mjs` changes only the intended cards' readings; `node tests/coverage.mjs` drops the card from its MISREAD/RESTRICTION group by itself.
6. Regression suites below all pass; golden games show no rules 4/5/6 difference; fuzz games have 0 simulator errors; the browser self-test passes (test-commander-table skill).

## 2. Phase 0 audit suite (`tests/audit-2c.mjs`, to add)

One `known` test per probe P01-P41 and probe2 (Crucible, Omniscience, Yeva), reporting "deviation" today and "FIXED" when the engine is right, exactly as `tests/rules.mjs` handles known deviations. Run in CI as non-failing until each is fixed; then the test moves into the matching suite as a failing-on-regression test.

## 3. Individual card tests (by root cause)

Each line: card — board — what to assert. Cards in **bold** are Critical/High.

### RC01/RC02 Conditions
- **Not of This World** — empty stack: cost is {7}; opponent's removal targets your power-7 creature: cost {0}; a spell targeting an opponent's permanent is not a legal target.
- **The Indomitable** — graveyard, no Pirates/Vehicles: not castable; three tapped Pirates: castable.
- **Approach of the Second Sun** — first cast from hand: seventh from the top, +7 life; second cast from hand: win; second cast from elsewhere (copy/graveyard): no win.
- **Eldrazi Monument** — no creatures at upkeep: Monument sacrificed; one creature: creature sacrificed, Monument stays.
- **Baleful Mastery** — alt cost: chosen opponent draws one; normal cost: nobody draws.
- **The Chain Veil** — no loyalty ability used: lose 2; one used: no loss.
- **Combustible Gearhulk** — opponent chooses draw: +3 cards; chooses mill: three milled, damage = total MV to that player.
- Noxious Gearhulk — destroy Craterhoof: +9 life; target indestructible: no life; Rest in Peace out (destroyed → exiled, still destroyed): +life.
- Unstoppable Slasher, Nine-Lives Familiar, Blowfly Infestation, Massacre Girl, Wilhelt, Witch's Oven, Nasty End — last-known counters/toughness/types of the dying or sacrificed creature decide the branch (both branches tested).
- Bonehoard Dracosaur — exile land + nonland: one Dinosaur and one Treasure; two lands: one Dinosaur only.
- Grist — mill an Insect: loyalty counter and repeat; mill a non-Insect: stop.
- Spelunking, Arid Archway, Reckless Handling, Grab the Prize, Return to Dust, Oviya, Marauding Raptor, Phelia, Valakut Exploration, Brass's Tunnel-Grinder, Padeem, Lost Monarch, Tataru Taru, Carpet of Flowers, Inga and Esika, Alchemist's Talent, Roiling Vortex, Liberator, Arena of Glory, Spirit Water Revival, Guardian Project, Springheart Nantuko, Yenna — one test each for the true branch and one for the false branch.

### RC03/RC04/RC05 Mana
- **Delighted Halfling** — colored mana pays a legendary spell (and it can't be countered: a counterspell fails), can't pay Lightning Bolt; {C} pays anything.
- **Secluded Courtyard / Unclaimed Territory / Eclipsed Realms** — chosen type creature: payable; other creature: not; ability of a chosen-type creature (Courtyard, Realms): payable.
- Plaza of Heroes, Great Hall of the Citadel (needs {1}: two mana, legendary only), Throne of Eldraine (four of the chosen color, monocolored of that color only), Gwenna, Rivaz, Power Depot, Mech Hangar, Voldaren Estate, Haven/Maelstrom of the Spirit Dragon, Codsworth, Giada, Oakhollow/Mudflat Village, Abundant Countryside, Mightstone and Weakstone, Klauth — legal spell payable; illegal spell not payable; mixed payment with unrestricted mana still found (`planTagged`).
- Floodfarm/Bleachbone Verge, Nimbus Maze, Mox Jasper, Mirrex, Glistening Sphere, Fanatic of Rhonas, Urza's Workshop, Sceptre, Shrine, Eldrazi Temple — condition false: only the unconditional mana; true: the extra mana.
- **Birgi** / Savage Ventmaw / Klauth / Karn Legacy Reforged / Rousing Refrain — mana survives phase changes until end of turn and is gone at the next turn.
- Boseiju, Who Shelters All — instant paid with its {C} can't be countered; creature spell can.

### RC06/RC07/RC10 Targets
- **Drown in the Loch** — counter mode: spell MV ≤ graveyard size legal, larger illegal; checked again on resolution after the graveyard changes (graveyard exiled in response → fizzle).
- **Persist** — legendary creature card not a legal target; nonlegendary returns with a -1/-1 counter.
- **Thieving Skydiver** — X=2: MV 2 artifact legal, MV 3 illegal; Equipment attaches.
- Kozilek's Command, Haven/Maelstrom/Mudflat Village — type/MV limits on graveyard and library choices.
- Mithril Coat (legendary only; none → unattached), Silver Shroud Costume, Celestial Armor, Mjölnir, Chandra's Ignition, Soul's Majesty, The Aetherspark — a person can pick the target; hexproof/protection respected; target gone → fizzle (608.2b).
- Shatterskull Smashing (division, X ≥ 6 doubling), Court of Garenbrig (split 1+1), Ancient Bronze Dragon (two targets), Terastodon (three, each controller gets an Elephant), March of Swirling Mist, Dance of the Manse, Endurance (up to one: zero allowed).

### RC08/RC20 Permissions
- **Crucible of Worlds / Ramunap / Conduit** — land in graveyard playable as the land drop; land on top of the library not playable.
- **Omniscience** — hand spell castable for {0}; top of library not castable.
- Yeva, Sigarda's Aid, Liberator, Borne Upon a Wind — the named spells castable at instant speed from hand; not from the library.
- **Chainer** — one creature from graveyard per turn; instants not castable. Zul Ashur — only the target Zombie. Emry — only the chosen artifact, this turn.
- **Expressive Iteration, Mnemonic Betrayal** (any mana type; leftovers return at the end step), Containment Construct, Tablet of Discovery, Dire Fleet Daredevil (exiled instead of graveyard), Valakut Exploration (permission lasts while exiled), Dauthi Voidwalker (free, this turn, void counter cards only).

### RC09 X values
- Painful Truths (2 and 3 colors spent; a copy spends no mana → 0), Pact of the Serpent, Palantír, Quartzwood Crasher (two tramplers hitting), Sunfall (Incubator with X counters), Carpet of Flowers, Ancient Bronze Dragon, Prime Speaker Zegana, Karn Legacy Reforged, Meathook Massacre II, Kozilek's Command.

### RC11-RC19
- Punishers with an AI and a scripted person choosing each branch; remote seat answer through `net.js` fake room (Combustible Gearhulk, Palantír, Tataru Taru, Fandaniel, Wilhelt, Planar Genesis, Risen Reef).
- Riders: Damn/Artifact Mutation vs a regeneration shield; Orim's Chant kicked (no attacks); Render Silent; Single Combat; Delay (exiled with three time counters, cast when the last is removed); Koma; Junk Winder and Vorinclex (skips one untap); Taunt from the Rampart; Kappa Cannoneer; Sundering Eruption.
- Statics: The Immortal Sun (no loyalty abilities for anyone), Eternal Wanderer and Mirri attack/block caps, Port Razer/Bloodthirster can't attack the same player twice, Nowhere to Run (hexproof ignored, ward doesn't trigger), Soulless Jailer (flashback and escape refused), Stormtide Leviathan.
- Construction: Delina (token tapped and attacking, exiled at end of combat; Delina stays), Rite of the Raging Storm (each player's upkeep: their Rager; Rager can't attack you; sacrificed at end step), Gilded Drake (exchange; no target → sacrifice; target hexproof → sacrifice), Court of Vantress/Yenna (copy the chosen permanent), Charming Scoundrel, Hunter's Insight, Not Dead After All, Abdel Adrian (returns when Abdel leaves), Inti, Springheart Nantuko.
- Replacements: Mox Diamond countered → land kept; no land → Mox to graveyard; Benevolent Hydra + Hardened Scales (affected player orders, 616.1); Out of the Tombs with an empty library.
- Giver of Runes: protection from red stops Lightning Bolt damage, red blockers, red Auras.
- Counter movement: Nesting Grounds, Resourceful Defense, Diamond City, Toxrill slime counters and Slugs.

## 4. Interaction tests (multi-card, Commander/cEDH first)

| Interaction | Board | Assert |
|---|---|---|
| Restricted mana + cost reduction + Phyrexian | Delighted Halfling + legendary spell with {B/P} + Sapphire Medallion-style reducer | Cheapest legal payment found; illegal spell refused |
| Cavern-style rider through copies | Delighted Halfling mana on a legendary spell, opponent counters, the spell is copied | Original can't be countered; copy can |
| Conditions vs replacement | Noxious Gearhulk + Rest in Peace; target with indestructible | Life only when the creature was destroyed |
| Permissions vs locks | Chainer / Crucible / Mnemonic Betrayal + Grafdigger's Cage / Soulless Jailer | Refused casts are refused for AI and person |
| Crucible loop | Crucible + Strip Mine + fetch land over three turns | Land drop used once a turn; graveyard land play counted |
| Persistent mana + storm | Birgi + three spells across phases | Mana carried; storm count right |
| Multiple simultaneous triggers | Two landfall triggers (Springheart + Valakut Exploration) and APNAP upkeep triggers (Court of Garenbrig + Rite of the Raging Storm in four-player) | Order chosen by controller; APNAP across players (`multiplayer.mjs`) |
| Targets in multiplayer | Shadrix (each mode a different player), Court of Garenbrig split, Drown in the Loch against each opponent's graveyard | Per-player legality |
| Copies of spells | Painful Truths copied (X = 0), Kozilek's Command copied (X kept) | 707.10 values |
| Hidden information | All new AI choices (offers, permissions) | `node tests/hidden.mjs` unchanged decisions with scrambled hands/libraries |
| Loops | Gilded Drake / Rite tokens / Delina roll-again with infinite rolls | `loops.mjs`: optional loops are the controller's choice |

## 5. Regression requirements (after every phase)

| Suite | Command | Must hold |
|---|---|---|
| Card readings | `node tests/cards.mjs` | only intended cards change |
| Coverage | `node tests/coverage.mjs --report tests/card-coverage.md` | fixed cards leave their group; no card moves to a worse status |
| Interactions | `node tests/interactions.mjs` | all pass, including the rules-5 copies |
| Rules | `node tests/rules.mjs` | no new deviation; fixed `known` tests say FIXED |
| Mana / stack / replacements / abilities / multiplayer | `node tests/mana.mjs` etc. | all pass |
| Golden games | `node tests/golden.mjs` | no rules 4/5/6 difference; rules 24+ differences accepted with `--update` only when explained |
| Replays | `node tests/replay.mjs` | old replays load and play identically |
| Fuzz | `node tests/fuzz.mjs --games 60 --seed 7000` | 0 simulator errors |
| Hidden info | `node tests/hidden.mjs` | unchanged |
| AI | `node tests/ai.mjs` | decisions still pass; mana-heavy decisions not slower (`node --expose-gc tests/perf.mjs` for numbers) |
| Types | `node tests/typecheck.mjs` | no new errors |
| Browser self-test | test-commander-table skill (`selftest.html?run`, `uitest.html?run`) | every check passes, 0 simulator errors |

## 6. Missing test infrastructure

- **Known-deviation suite for card behaviour** (Phase 0.4): `rules.mjs` has the `known` mechanism, but no suite holds per-card behaviour deviations; `tests/audit-2c.mjs` fills this.
- **Scripted person answers for offers** (punishers): HumanAgent can be scripted for targets and modes; a scripted answer for "may have you …" needs the offer prompt first (Phase 4.5).
- **Trigger timing tests on a full turn**: the probes call effects directly; Phase 4/7 tests should step real phases (`g.setPhase`, upkeep/end step flush) with `record(g)` to check timing, not only results.
- **Coverage self-test**: `coverage.mjs` has no test of its own checks; add fixture cards for each MISREAD/RESTRICTION rule (true and false cases) so a regex change can't silently reclassify cards.
