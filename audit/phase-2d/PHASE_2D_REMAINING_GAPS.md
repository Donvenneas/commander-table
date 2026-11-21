# Phase 2D — Remaining Gaps

What Phase 2D did not implement or could not verify. Card status comes from `node tests/coverage.mjs` after Phase 2D (`public/data/coverage.json`), and the per-card list is in `PHASE_2D_CARD_IMPACT.csv`.

## Counts

- Of the 197 cards in the Phase 2C list, 62 now read as full and 10 as partial. **125 are still flagged incorrect or restriction.**
- 94 of the 197 were reached by a Phase 2D mechanic. **101 were not addressed**: most are whole abilities that are not read (Phase 2C RC15) or one-off readings. The other 2 changed classification only through a shared reader change, without a card-specific test.
- 50 of the 197 cards that a Phase 2D mechanic reached have **no card-specific test**. Their reading was checked, and they share code with tested cards. The CSV lists them as "reading checked, no card-specific test".

## Mechanics not implemented (by workstream)

| Workstream | Missing | Cards (examples) | Why it is left |
|---|---|---|---|
| B Targets | Several targets chosen at once, with the amount divided among them; "up to X targets"; targets on abilities on the stack | Shatterskull Smashing, Court of Garenbrig (split counters), March of Swirling Mist, Dance of the Manse, Terastodon | Needs a target list on the effect, plus the `human.js` and `net.js` answer formats: an interface change. |
| B Targets | Equipment ETB attach as a real target (today the engine picks among allowed creatures) | Mithril Coat, Celestial Armor, Silver Shroud Costume | The restriction is enforced but nobody chooses. Hexproof and protection are respected because of the `canTarget` check. |
| B Targets | Not of This World checked when it is cast, and on abilities | Not of This World | It is checked on resolution, which is enough for a correct outcome. A wasted cast can still happen. |
| C Permissions | Mana of any type for a permission (Mnemonic Betrayal, Dire Fleet Daredevil); "exile it instead" after casting; Dire Fleet Daredevil's ETB; Dauthi Voidwalker's activation; Rivaz's once-per-turn graveyard Dragon | Dauthi Voidwalker, Dire Fleet Daredevil, Rivaz of the Claw, Party Thrasher | Needs a payment-planner option ("any type") and an exile-on-resolve replacement for permissions. |
| C Permissions | Chainer's "activate only once each turn" on the ability | Chainer, Nightmare Adept | Activation limits on non-mana abilities were not reviewed. |
| D Mana | A second mana ability with a different amount (per-ability mana model) | Fanatic of Rhonas, Eldrazi Temple, Shrine of the Forsaken Gods, Great Hall of the Citadel ({1},{T}: two), Urza's Workshop, Sceptre, Glistening Sphere, Throne of Eldraine | `fx.mana` is one ability per card. A list of mana abilities touches `units`, the AI's mana counting and the interface. |
| D Mana | Spend restrictions that aren't kinds of spell (monocolored of a color); Plaza of Heroes' "colors among legendary permanents"; Klauth's mana restriction | Throne of Eldraine, Plaza of Heroes, Klauth | — |
| D Costs | Non-mana escalate; strive (a cost per extra target); waterbend and other optional extra costs on spells | Collective Effort, Twinflame, Call the Coppercoats, Spirit Water Revival | Strive needs multiple targets (above). |
| E X | X for the number of targets; "X can't be 0" | Thieving Skydiver's kicker X is read; Kozilek's Command mode 1 (Spawn) and mode 4 are still misread | — |
| F Counters | Moving counters between permanents; "remove a counter" costs on other permanents; counter types with rules (shield, stun as a replacement, slime) | Nesting Grounds, Resourceful Defense, Diamond City, Aetheric Amplifier, Toxrill, Benevolent Hydra's {T} ability | Needs a moveCounters effect on the named-counter store and two-object targeting. |
| G Delayed | A granted "when this dies" trigger (Not Dead After All); end-of-combat exile for token copies (Delina: still exiles itself); a delayed trigger on a chosen creature other than combat damage | Not Dead After All, Delina, Wild Mage | There is no end-of-combat hook. Delina keeps its Phase 2C defect. |
| H Library | Reveal-until "of the chosen kind" for a person (Abundance always gives a person nonland) | Abundance | Needs a prompt. |
| I Replacements | Damage and target redirection, new prevention shields, draw-from-empty replacements (Out of the Tombs), "exile instead of graveyard" for spells cast with a permission | Out of the Tombs, Dire Fleet Daredevil | Not started in this phase. The `replacements.js` pipeline is ready for them. |
| J Continuous | Type changes (Stormtide Leviathan: all lands are Islands), P/T setting layers for granted abilities (Karn's +1, Druid Class level 3), ignore hexproof and ward (Nowhere to Run), graveyard-cast locks (Soulless Jailer), attack and block caps (The Eternal Wanderer, Mirri), "creatures named X can't attack you" | Stormtide Leviathan, Nowhere to Run, Soulless Jailer, The Eternal Wanderer, Mirri | Each needs a check where the action is allowed; layer interactions need their own tests. |
| K Keywords | Strive; Cemetery Tampering's hideaway variant; non-mana escalate; Copy Plus for storm and cascade copies | Twinflame, Call the Coppercoats, Cemetery Tampering, Collective Effort | — |

## Phase 2C defects still open (most severe first)

- **Delina, Wild Mage** (High): still exiles itself on 1–14. The token copy needs an end-of-combat exile.
- **Gilded Drake** (Critical): exchanging control is **not implemented**; the Drake is still sacrificed. It needs an exchange effect (`steal` both ways). This was planned in the Phase 2C roadmap step 1.3 and **not done in Phase 2D**.
- **Palantír of Orthanc** and **Combustible Gearhulk** (High): the opponent's choice ("may have you draw") is not asked; the reading still gives the draw. Palantír's mill X is now counted. Needs the "offer" effect (Phase 2C roadmap 4.5).
- **Karn, the Great Creator** and **Toxrill** (High): their abilities are still not read.
- Abilities not read (Phase 2C RC15), 57 cards: unchanged except where a mechanic above reached them.
- **Charming Scoundrel**, **Kozilek's Command**, **Not Dead After All**, **Artifact Mutation**, **Abdel Adrian**, **Court of Vantress**, **Yenna**: wrong readings (Phase 2C RC13) not addressed in 2D. Only Rite and Hunter's Insight were fixed.

## Classification lag (implemented and tested, still flagged by coverage)

Coverage marks these from the text it can't match. The mechanic works at rules 25 and is tested:

- Mox Diamond: the "If you don't, put it into its owner's graveyard" sentence is still listed as unread.
- Rite of the Raging Storm: flagged for its unread "can't attack you" line, which really is still missing.
- Not of This World and The Indomitable: their conditions are still unread. They now play weaker (the condition is never met) instead of stronger.

## Not verified

- A person's side of the new choices was only partly tested. Tested: Persist's card list, Wilhelt's optional cost. Not tested: Mox Diamond's land choice, hideaway's choice, Expressive Iteration's exile choice, Emry's card choice. All of these use the existing `pickCards` and `confirmPayAsync` prompts, which other tests already cover.
- Online seats (`net.js`) were not exercised for the new prompts.
- Long games with the newly read cards in decks: the golden, fuzz and self-test games use their own decks and don't necessarily include them. No targeted 20-seed games were run per card.
- Mac/Linux servers and the Cloudflare tunnel were not tested. No endpoint changed.
