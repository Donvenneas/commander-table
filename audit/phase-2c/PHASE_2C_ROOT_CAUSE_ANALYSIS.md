# Phase 2C — Root Cause Analysis

Baseline 1.61.0 (rules 24). Line numbers are from commit `b45b0e4`. Card counts are among the 197 "incorrectly simulated" cards unless stated; a card can have several root causes. Per-card detail: `PHASE_2C_COMPLETE_AUDIT.md` and `PHASE_2C_CARD_DEFECTS.csv`.

## 1. The execution path, and where it breaks

```
Oracle text ──► effects.js parseCard ──► fx (effects, conditions, target words, costs, mana)
                 │  breaks: RC01/02 parseCond "?"  RC03/04 mana lines merged  RC06 targetWords only for TARGETED kinds
                 │          RC09 xWhere "?"  RC12 droppedSentences  RC13 rider bound to src  RC15 unread  RC20 playTop regex
                 ▼
Target choice ──► resolve.js legalTargets / targetFits / targetLegal  (human.js menu, ai.js chooseTarget)
                 │  breaks: RC06 no restriction to check  RC07 kinds with no target (bestOwn)  RC10 one target only
                 ▼
Cost / permission ──► mana.js castModeRaw, costOf, planPayment, spendOk; engine.js abilityCost, land play
                 │  breaks: RC02 "?" counts as met  RC03 two restriction kinds  RC05 setPhase empties pool  RC08 gyCast/mayPlay  RC20 no graveyard land play
                 ▼
Stack ──► stack.js (rules 15)  — no defect found in the 197 that comes from the stack itself
                 ▼
Resolution ──► resolve.js runEffects switch; triggers.js evalCond; replacements.js
                 │  breaks: RC01 "if" → nothing / else; RC11 no player choice; RC13 wrong object; RC16 replacement as cost
                 ▼
Game state
```

The stack (`stack.js`), state-based actions and the replacement pipeline (`replacements.js`) behave correctly on everything these cards reach; the defects sit almost entirely in the **reader** (effects.js: what the card is understood to do) and in four **engine predicates** that have grown several parallel versions (conditions, targets, cast permissions, mana restrictions).

## 2. Root causes

| ID | Root cause | Cards | Stronger / weaker / different | Files | Phase 2B |
|---|---|---:|---|---|---|
| RC01 | Unread "if" at resolution: the part does nothing (or the else branch is forced) | 38 | 5 / 28 / 5 | effects.js parseCond l.626, cond17 l.708; triggers.js evalCond l.453; resolve.js case 'if' l.943 | P0 Conditional evaluation |
| RC02 | Unread condition outside resolution counts as **met** | 3 | 2 / 0 / 1 | triggers.js evalCond l.453 (`return !ctx.resolving`); mana.js costOf l.607-610, castModeRaw l.508 | P0 Conditional evaluation |
| RC03 | Mana spend restrictions not modelled; mana lines merged into one any-color ability | 23 | 18 / 1 / 4 | effects.js mana reader l.2060-2100; mana.js spendOk l.38 | P0 Mana restrictions |
| RC04 | Conditional / second mana abilities dropped or unconditional | 15 | 7 / 7 / 1 | effects.js MANA_COND l.48, manaLines | P0 Mana restrictions |
| RC05 | "You don't lose this mana" not modelled | 5 | 0 / 3 / 2 | engine.js setPhase l.319 | P0 Mana restrictions |
| RC06 | Target qualifiers not enforced (legendary, MV, dynamic limits, card types) | 9 | 7 / 1 / 1 | effects.js TARGETED l.1103, targetWords l.1107; resolve.js targetFits l.155 | P0 Target legality |
| RC07 | Engine picks the object instead of a printed target | 7 | 2 / 1 / 4 | resolve.js attachSelf l.1432, ignition l.1569, doubleCounters l.1205 | P0 Target legality |
| RC08 | Cast/play permissions missing or too broad | 13 | 3 / 8 / 2 | resolve.js dig l.972, exileTrigCard l.1578, exileGy l.1499, gyCastTurn l.1911; mana.js castModeRaw l.510 | P0 Cast/play permissions |
| RC09 | "X, where X is …" → 0 | 11 | 1 / 7 / 3 | effects.js xWhere l.1047-1074; resolve.js roll l.1747 | P1 Dynamic X |
| RC10 | Multiple / divided / "up to" targets | 7 | 1 / 6 / 0 | effects.js upTo l.1250-1265 | P0 Target legality (count) |
| RC11 | A player's choice is not asked (punishers, optional costs) | 7 | 2 / 3 / 2 | effects.js reader; resolve.js | P0 Conditional (prior result) |
| RC12 | Rider sentences dropped | 18 | 1 / 14 / 3 | effects.js droppedSentences l.2453 | P2 Continuous; P1 Combat |
| RC13 | Clause bound to the wrong object / read as the wrong effect | 18 | 3 / 7 / 8 | effects.js; resolve.js copyToken l.439-441, pumpTrig l.1653 | **not in 2B** |
| RC14 | Static prohibitions and rule changes not read | 13 | 3 / 9 / 1 | effects.js; engine.js; combat.js | P2 Continuous; P1 Combat |
| RC15 | Whole ability not read (incomplete) | 60 | 1 / 55 / 4 | effects.js (fx.unread); tests/coverage.mjs RESTRICTION l.52 | per mechanic |
| RC16 | Replacement effects modelled as costs or unread | 3 | 0 / 2 / 1 | effects.js; replacements.js | P1 Replacement |
| RC17 | Protection read as hexproof | 1 | 0 / 0 / 1 | effects.js protect reader; engine.js protectedFrom | P2 Continuous |
| RC18 | Random results and modal constraints | 3 | 0 / 2 / 1 | resolve.js roll; effects.js modal reader | P2 Special mechanics |
| RC19 | Counter movement / named counters | 6 | 0 / 6 / 0 | effects.js; resolve.js | P1 Counters |
| RC20 | "You may play lands / cast X spells" read as play from library top | 2 (+13 "full") | 1 / 0 / 1 | effects.js l.1605-1607; mana.js topPlayable l.622; engine.js l.886 | P0 Cast/play (not listed) |
| RC21 | Coverage false positive | 8 (6 cards fully, 2 partly) | — | tests/coverage.mjs MISREAD l.58, RESTRICTION l.52 | audit tooling |

### RC01 — Unread "if" at resolution (38 cards)

**Mechanism.** `effects.js parseCond` turns any condition it can't match into `{c:'?', text}` (with `r`/`r24` when a later reader understands it). At resolution `resolve.js case 'if'` (l.943) marks it unread; `triggers.js evalCond case '?'` returns `!ctx.resolving`, i.e. false. With an `else` the else branch is forced; without one the branch is skipped and reported once (`noteUnread`). So since rules 17 these cards are no longer *stronger* (the 1.31.0 audit's concern), but almost all of them now lose part of their text.

**The unread conditions fall into five shapes** (the fix is shared by shape, not by card):

| Shape | Examples | What is needed |
|---|---|---|
| "this way" — the result of the previous effect | Noxious Gearhulk (destroyed), Grist (Insect milled), Reckless Handling (artifact discarded), Arid Archway (Desert returned), Spelunking (Cave put), Bonehoard Dracosaur (land/nonland exiled), Oviya, Springheart, Marauding Raptor | Each effect writes what it did onto ctx (`ctx.last = {objs, kinds}`); conditions read ctx.last |
| A property of the trigger object as it last existed | Unstoppable Slasher (no counters), Nine-Lives (revival counter), Blowfly (-1/-1 counter), Massacre Girl (toughness < 1), Wilhelt (decayed), Witch's Oven (toughness ≥ 4), Nasty End (legendary) | Last-known information of the trigger/sacrificed object (counters, toughness, types) on ctx.trig |
| How the spell was cast / paid | Baleful Mastery (alt cost), Spirit Water Revival (extra cost), Return to Dust (cast in main phase), Approach (cast from hand + cast count), Alchemist's Talent (Treasure mana), Inga and Esika (creature mana), Roiling Vortex (no mana spent), Liberator (mana spent), Arena of Glory (mana spent on a creature) | Record on the stack item: alt cost used, additional costs paid, phase, castFrom, mana units spent with their sources (needs the RC03 tagged pool) |
| Turn history | Padeem, Chain Veil (loyalty ability used), Brass's Tunnel-Grinder (descended), Lost Monarch (Zombie combat damage), Tataru Taru (not that player's turn), Carpet of Flowers (this ability's mana this turn) | Per-turn counters on the player (several already exist: gainedTurn, lostLifeTurn, turnSpells) |
| Opponent's decision | Combustible Gearhulk ("if the player doesn't"), Eldrazi Monument ("if you can't") | RC11 offer effect + ctx result |

**Severity hot spots:** Approach of the Second Sun can never win (P11); Eldrazi Monument never sacrifices itself (stronger, P12); Combustible Gearhulk always draws three (stronger, P13); Baleful Mastery's alternative cost has no drawback (stronger, P14).

### RC02 — Unread condition outside resolution counts as met (3 cards)

`triggers.js evalCond case '?'`: `return !ctx.resolving`. Every caller outside `resolve.js case 'if'` passes no `resolving`, so an unread condition is **true** there. Callers: `mana.js costOf` (selfReduce cond, l.610), `castModeRaw` (gyCastSelf cond, l.508), `topPlayable` (playTopCond, l.629), `castModeRaw` altManaCond (l.574), enter conditions. Today this reaches **Not of This World** (costs {0} and counters anything: P04) and **The Indomitable** (always castable from the graveyard: P05); a scan of all 3,500 cards found no others, but any new card read with `{c:'?'}` in one of these fields would be stronger than printed. **Fix:** at a new RULES version, `?` is false everywhere (the rules 17 behaviour extended), reported once a game.

### RC03 / RC04 / RC05 — Mana abilities (36 cards together)

**Mechanism.** The mana reader (effects.js l.2060-2100) builds **one** `fx.mana` per card. The first `{T}: Add …` line sets amount and colors; the colors of later mana lines are added to `colors`; a later line's amount, restriction and condition are dropped. Restrictions survive only for "creature spells" / "abilities of creatures" (`fx.mana.only`) and Cavern of Souls (`cavern`); conditions only when the word is in `MANA_COND` (basic land types, card types, "legendary"). The pool empties at every phase (`engine.js setPhase`, with a special case `keepRed`).

**Effect on cards.**
- *Stronger* (25 across RC03 and RC04): every "any color, spend only on X" land and creature (Delighted Halfling P19, Secluded Courtyard, Unclaimed Territory, Plaza of Heroes, Great Hall of the Citadel P36, Haven/Maelstrom of the Spirit Dragon, Eclipsed Realms, Mech Hangar, Voldaren Estate, Gwenna, Rivaz, Giada, Codsworth, Abundant Countryside, Power Depot, Oakhollow/Mudflat Village, the Mightstone) and condition-free Verges/Mox Jasper/Mirrex/Nimbus Maze (P37).
- *Weaker* (11 across RC03-RC05): the second ability's bigger amount is lost (Fanatic of Rhonas, Eldrazi Temple, Shrine of the Forsaken Gods, Urza's Workshop, Sceptre, Glistening Sphere, Throne of Eldraine) and kept mana empties (Birgi P38, Savage Ventmaw, Klauth, Karn Legacy Reforged, Rousing Refrain); Boseiju's uncounterable rider is lost.

**Existing pieces to reuse:** pool units already carry `only` (resolve.js addMana with `e.only` from rules 7), `spendOk` already filters by `g.payingFor`, `planTagged` (rules 12) already tries every way to pay, and Cavern's uncounterable rider already travels with the spell. The fix is to generalise these, not add a new system.

### RC06 / RC07 / RC10 — Targets (21 cards together)

**Mechanism.** `targetWords` (effects.js l.1107) reads the restriction words of a "target …" phrase into `e.tr`, but only for the kinds in `TARGETED` (l.1103) — permanents on the battlefield. Graveyard targets (reanimate, regrow), stack targets (counter), library searches (tutor) and steal with a mana-value limit get no `tr`, and `tr` has no way to say "MV ≤ X" or "MV ≤ cards in its controller's graveyard". Some kinds take no target at all and let the engine pick (`attachSelf`, `ignition`, `doubleCounters`, draw `maxPower`). More than one target is handled only for a few kinds by copying the effect.

**Confirmed:** Drown in the Loch (P09, Critical), Thieving Skydiver (P10), Persist returns legendary creatures (P33), Kozilek's Command mode 3, Haven/Maelstrom/Mudflat Village tutor and regrow anything (P40), Mithril Coat attaches to non-legendary creatures (P18), Chandra's Ignition ignores the chosen creature (P26), Not of This World counters any spell.

**Parallel implementations (risk of drift):** `resolve.js legalTargets` (per-kind switch), `targetFits` (words), `targetLegal` (both), the `human.js` menu (`legalTargets`), and the AI's own filters in `ai.js` (l.214, 479, 714, 1779, 1841, 1933, 2204) that call `canTarget` plus sometimes `targetFits`. Phase 2B's completion test ("AI and human legal-target parity") needs these to share one predicate.

### RC08 / RC20 — Cast and play permissions (15 cards + 13 "full")

**Seven separate permission mechanisms** exist: `o.mayPlay` (impulse), `p.gyCast` (Yawgmoth's Will style), `fx.gyCastSelf`, `fx.gyCastOnce` (Muldrotha style), `fx.playTop` (top of library), `o.tempFlashback`, `fx.exileCast`, plus foretell/plot. `castModeRaw` (mana.js l.480) checks each in turn. Defects:
- *Missing:* Expressive Iteration, Containment Construct, Mnemonic Betrayal, Tablet of Discovery, Dire Fleet Daredevil, Rivaz, Dauthi Voidwalker, Valakut Exploration (permission ends this turn instead of "as long as it remains exiled").
- *Too broad:* `gyCastTurn` with no types means every nonland card, unlimited (Chainer P20, Zul Ashur); with types, every card of that type (Emry).
- *RC20:* the playTop regex (effects.js l.1605) treats "from the top of your library" as optional, so Crucible of Worlds, Ramunap Excavator, Conduit of Worlds play lands from the library top (there is no graveyard land path at all, engine.js l.886), Omniscience/Yeva/Sigarda's Aid/Borne Upon a Wind/Liberator/Shimmer Myr/Skittering Cicada/Dracogenesis/Icetill Explorer/Ancient Greenwarden/Walk-In Closet/Gandalf the White get library-top casting.

**Recommendation:** one permission record (who, which objects or filter, from which zone, until when, how many, cost changes, where the card goes afterwards) consulted by `castModeRaw` and land play. Existing mechanisms become producers of that record, so replays keep their behaviour behind the rules version.

### RC09 — Dynamic X (11 cards)

`xWhere` (effects.js l.1047-1074) knows a list of "where X is …" phrases and returns `{dyn:'?'}` for the rest; `X()` reads that as 0. Painful Truths (P06), Pact of the Serpent, Palantír (mill), Quartzwood Crasher, Sunfall (P16), Carpet of Flowers, Ancient Bronze Dragon (the d20 result is passed only to the roll's own table), Prime Speaker Zegana (P29: "enters with X counters" uses paid X), Karn Legacy Reforged, Meathook Massacre II, Kozilek's Command (spawn count). Needed values: colors spent (converge), count of a chosen creature type, named counters on ~, damage dealt (trigger amount), objects affected "this way", greatest power among others, roll result.

### RC11 — Player choices (7 cards)

Punishers and "may have you" choices are read as one fixed branch: Palantír and Combustible Gearhulk always give the card draw (stronger), Tataru Taru's opponent always draws, Wilhelt draws without sacrificing, Planar Genesis/Risen Reef never give the fallback card, Fandaniel's trigger is unread. Needs an "offer" effect asked of the named player (AI value function, `human.js` prompt, `net.js` for remote seats) with the answer kept for the next effect.

### RC12 / RC14 — Riders and static prohibitions (31 cards)

Sentences the reader drops (`droppedSentences`) or never reads: "can't be regenerated" (Damn, Artifact Mutation), "can't block" (Sundering Eruption, Taunt from the Rampart), "doesn't untap" (Junk Winder, Vorinclex), "can't cast spells" (Render Silent, Single Combat), kicker rider (Orim's Chant), suspend rider (Delay P41), Koma's ability lock, attack caps and attack restrictions (Eternal Wanderer, Mirri, Port Razer, Bloodthirster, Stormtide), The Immortal Sun's loyalty lock, Nowhere to Run, Soulless Jailer. Most need an existing engine flag (silence, noBlock, skipUntap, regen) set from a new reading; a few need a new check where the action is allowed.

### RC13 — Clauses bound to the wrong object (18 cards, not in Phase 2B)

| Pattern | Cards | Evidence |
|---|---|---|
| A token's own "exile/sacrifice this token" read as the source exiling/sacrificing itself | Delina, Rite of the Raging Storm | P01, P02 |
| "Copy of it / that creature" falls back to the source (resolve.js copyToken: `ctx.trig?.o \|\| src`) | Court of Vantress, Yenna, Springheart Nantuko | P27, P34 |
| A condition lost so a clause runs always | Court of Garenbrig ("then if you're the monarch") | P17 |
| Wrong effect for the words | Gilded Drake (sacSelf only), Kozilek's Command (mode 1 adds mana), Charming Scoundrel (draw with no discard), Hunter's Insight (immediate draw), Not Dead After All (returnSelf on a spell), Artifact Mutation (no destroy), Sunfall ("phyrexian" token), Abdel Adrian (one token), Approach (no library placement), Marauding Raptor (no damage), Inti (pumpTrig with no trigger object), Expressive Iteration | P07, P24, P08, P15, P25, P35, P16 |

These are the most dangerous defects because the coverage checks can't see them: the reading is "complete", every kind has a handler, and the card still does the wrong thing. Cross-card scan: `copyToken … of "it"` appears on 12 snapshot cards (Ocelot Pride, The Scarab God, Miirym, Renewed Solidarity, Ondu Spiritdancer, Vaultborn Tyrant, Lazotep Quarry, Season of Weaving, Abyssal Harvester, Impostor Syndrome, Yenna, Court of Vantress); most bind "it" to a real trigger object and work, but each is worth one test because the fallback is the source.

### RC15 — Abilities not read (60 cards)

Not a wrong reading but a missing one: 57 cards are counted Incomplete (and 3 more have an unread ability next to a confirmed defect). The coverage puts many of them in "restriction" or "incorrect" only because the unread text contains a restriction word or the "up to"/"you control" pattern. High-value examples: Karn, the Great Creator (both loyalty abilities), Dauthi Voidwalker (the {T} ability), Toxrill, Endurance, Terastodon, The Chain Veil's activation, Steel Hellkite, Kozilek's counter ability.

### RC16-RC19

- **RC16** Mox Diamond is an additional casting cost instead of an enter replacement (land lost if countered; can't be cast with no land); Benevolent Hydra's +1 counter replacement and Out of the Tombs's draw replacement are unread. `replacements.js` (rules 14) already supports enter and draw replacements, so these can be expressed there.
- **RC17** Giver of Runes grants hexproof (P31); `Game.protectedFrom` already implements printed protection.
- **RC18** Invert Polarity, Shadrix (each mode a different player), Delina's roll-again row.
- **RC19** Nesting Grounds, Resourceful Defense, Diamond City, Aetheric Amplifier, Toxrill's slime counters, Brass's bore counters.

## 3. Cross-reference with Phase 2B

| 2B workstream | 2C root causes | 2C cards | Status of existing code |
|---|---|---:|---|
| P0 Conditional evaluation and this-way dependencies | RC01, RC02, RC11 | 45 | **Works:** conditions that parseCond knows; rules 17 safe default at resolution. **Incorrect:** `?` counts as met outside resolution. **Missing:** "this way" results, last-known information, cast/payment history, opponent choices |
| P0 Target legality ownership and target count | RC06, RC07, RC10 | 23 | **Works:** targetFits for battlefield kinds (ctl, colors, types, power, tapped, legendary). **Incomplete:** graveyard/stack/library targets, dynamic limits, multi-target. **Incorrect:** engine-picked "targets". **Duplicate:** five target filters (legalTargets, targetFits, human menu, AI filters, bestOwn) |
| P0 Cast/play permissions and alternate zones | RC08, RC20 | 15 (+13) | **Works:** impulse mayPlay, flashback, escape, Muldrotha-style once. **Incorrect:** gyCastTurn breadth; playTop regex. **Missing:** permissions from dig/mill/discard, graveyard land play, count limits. **Duplicate:** seven permission mechanisms |
| P0 Mana restrictions costs and payment legality | RC03, RC04, RC05 | 38 | **Works:** creature-only and Cavern restrictions, Phyrexian/hybrid planning, one-mana floor on ability reductions. **Incorrect:** merged mana lines. **Missing:** general restrictions, conditional extra mana abilities, persistent mana |
| P1 Dynamic X and computed values | RC09 | 11 | **Works:** the dyn readers that exist (attackPower, targetMv, devotion…). **Missing:** 9 shapes listed above |
| P1 Counter identity movement | RC19 | 6 | **Missing:** counter movement |
| P1 Turn phase and combat sequencing | RC12, RC14 (attack rules) | ~8 | **Missing:** attack caps, once-per-player attack restriction |
| P1 Zone movement exile and graveyard | RC08, RC13 | — | covered by RC08/RC13 |
| P1 Replacement prevention and redirection | RC16 | 3 | **Works:** replacements.js pipeline. **Missing:** these three readings |
| P2 Continuous effects and characteristics | RC12, RC14, RC17 | 32 | **Missing:** prohibitions; protection grant |
| P2 Special keyword mechanics | RC15, RC18 | — | per card |
| *(none)* | **RC13 wrong-object binding** | 18 | **New workstream needed** |
| *(none)* | **RC21 coverage tooling** | 8 | **New workstream needed**: coverage classes must be trustworthy before they are used to rank fixes |

## 4. Part 5: interaction analysis

The mechanics above touch other cards through these interactions (Commander and cEDH first):

| Mechanic | Interaction to check | Cards |
|---|---|---|
| Spend-restricted mana (RC03) | Restricted mana + cost reducers + Phyrexian/hybrid planning (planTagged) must never pay an illegal spell and must still find a legal payment; "can't be countered" riders must follow the spell through copies (Cavern of Souls already does) | Delighted Halfling + any legendary commander; Plaza of Heroes; Great Hall; Boseiju + counterspell wars |
| Persistent mana (RC05) | Mana kept across phases with storm (Birgi + Grapeshot), with combat steps (Savage Ventmaw, Klauth) and with mana burn-free empties (keepRed today) | Birgi, Klauth, Ventmaw, Karn Legacy Reforged |
| Conditions on prior results (RC01) | Replacement effects changing the result ("destroyed this way" when Rest in Peace exiles instead → not destroyed; indestructible target → not destroyed) | Noxious Gearhulk + Rest in Peace / indestructible; Grist + mill replacement; Spelunking + Amulet of Vigor |
| Unread conditions outside resolution (RC02) | Cost reductions stacking with commander tax and Helm-style reducers; graveyard casting under Grafdigger's Cage / Soulless Jailer | Not of This World, The Indomitable |
| Target restrictions (RC06/07) | Hexproof/shroud/protection/ward must apply once there is a real target; fizzle when every target becomes illegal (608.2b) | Chandra's Ignition with Heroic Intervention; Mithril Coat with protection; Drown in the Loch and graveyard hate on response |
| Permissions (RC08/20) | Permission + "exile instead" (Containment Construct, Dire Fleet Daredevil); permission and Grafdigger's Cage; Crucible + Strip Mine/fetch lands loop (cEDH); Omniscience + free spells; flash grants vs. split second | Crucible of Worlds, Ramunap, Chainer, Mnemonic Betrayal (cEDH combo with Underworld Breach-style lines) |
| Dynamic X (RC09) | X counted at resolution vs. as cast; copies of the spell (a copy of Painful Truths spent no mana: X = 0) | Painful Truths + Twincast; Sunfall + creatures with "exile instead" |
| Player choice (RC11) | Several opponents: each chooses in turn order (APNAP); remote seats through net.js; hidden information (hidden.mjs must still pass) | Combustible Gearhulk, Palantír, Fandaniel |
| Copy binding (RC13) | Token copies of a trigger object that left the battlefield (use last-known information); copies of copies; Spark Double-style "except" clauses | Court of Vantress, Yenna, Springheart, the 12 copyToken "of it" cards |
| Static prohibitions (RC14) | The Immortal Sun with planeswalker commanders; Soulless Jailer vs. flashback/escape/foretell; Nowhere to Run vs. ward triggers (stack) | |
| Replacements (RC16) | Mox Diamond + Pact/countered spell; Benevolent Hydra + Hardened Scales ordering (616.1); Out of the Tombs + Laboratory Maniac-style draw replacements | |
| Multiple simultaneous triggers | Landfall triggers that now do nothing (Springheart) vs. ones that make tokens; APNAP ordering with Court upkeep triggers and Rite tokens | |

## 5. Duplicate or conflicting implementations

1. **Conditions:** `parseCond` (with `r` and `r24` alternates), `MANA_COND` word list for mana lines, `enterCond9`, `playTopCond`, `altManaCond`, `selfReduce.cond`, `gyCastSelf.cond` — evaluated in different contexts with different defaults (RC02 is the result).
2. **Targets:** `legalTargets` switch, `targetFits` words, `tr` vs `tr24` (copyToken), the AI's own filters, and `bestOwn` picks.
3. **Cast permissions:** seven mechanisms (see RC08).
4. **Mana restrictions:** `fx.mana.only` (two values), `cavern`, `keepRed`, pool-unit `only` (rules 7).
5. **"Up to N":** `upTo` on the effect plus copies with `more: true` for some kinds; `count` on counters ("on":"up to") in Ancient Bronze Dragon's reading — a third shape.
6. **Coverage checks:** MISREAD regexes test words in the reading JSON, so a reading that contains the word for another reason passes (and the reverse: flashTurn fails the "play/until" test).

Avoid new mechanics where these exist: every fix in the roadmap extends one of them and retires the others behind a rules version.
