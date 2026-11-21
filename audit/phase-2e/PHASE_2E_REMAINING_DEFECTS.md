# Phase 2E — Remaining Defects

Every defect still open after Phase 2E (1.63.0, rules 26). Card status comes from `PHASE_2E_CARD_VERIFICATION.csv`; the coverage reason is the text after "—".

## Summary

| Status | Cards |
|---|---:|
| Repaired and verified by test (full) | 46 |
| Repaired and verified by test, other text still unread (partial) | 4 |
| Repaired part verified by test, but the card is still flagged for another defect | 11 |
| Shared mechanic applied, not individually tested | 47 |
| Shared mechanic applied, not individually tested, still flagged | 13 |
| **Known defect remains** (`tests/known-defects.json`) | **12** |
| **Not addressed** | **78** |
| Not a defect (Phase 2C false positive) | 6 |

These rows cover the 197 Phase 2C cards plus 20 cards the Phase 2E shared repairs reached (217 rows).

## Most severe open defects

- **Not of This World** (Critical): its counter restriction is fixed (2D). Its cost reduction ("if it targets a spell or ability that targets a creature you control with power 7 or greater") is still unread, so the card now always costs {7}. It plays weaker, not stronger.
- **The Indomitable** (High): its graveyard condition is unread, so it can't be cast from the graveyard.
- **The Chain Veil** (High): its activation (extra loyalty activations) is not read, and its end-step life loss condition is unread.
- **Karn, the Great Creator**, **Toxrill**, **Dauthi Voidwalker's activation** (High): abilities not read.
- **Delina, Wild Mage** (High, now known defect): the creature is chosen when the copy is made, not before the roll, and "you may roll again" always rolls.
- **Thieving Skydiver** (High): its X bound works, but "If that artifact is an Equipment, attach it" is not read.
- **Liberator, Urza's Battlethopter** (High): flash for colorless and artifact spells works (2D). Its counter trigger's condition (mana spent) is unread.

## Mechanics still missing

1. **Several or divided targets chosen at once**: Shatterskull Smashing, Court of Garenbrig's split, March of Swirling Mist, Dance of the Manse, Ardyn, Endurance. This needs a target list on the effect and new `human.js`/`net.js` answer formats.
2. **Per-ability mana model**: a second mana ability with its own amount (Fanatic of Rhonas, Eldrazi Temple, Shrine, Great Hall, Urza's Workshop, Sceptre, Glistening Sphere, the Urza's Tower bonus); Throne of Eldraine's monocolored restriction; Plaza of Heroes' third ability; Klauth's restriction on its kept mana.
3. **Moving counters** (Nesting Grounds, Resourceful Defense, Diamond City, Aetheric Amplifier, Benevolent Hydra's {T}, Toxrill's slime).
4. **Unread conditions** in about 15 cards: Guardian Project (same name), Arena of Glory and Alchemist's Talent and Inga and Esika (mana spent from a source), Padeem (greatest mana value), Phelia, Brass's descend, Lost Monarch, Roiling Vortex (no mana spent), Tataru Taru's off-turn draw, Yenna's Aura check, Valakut's "exiled with ~", Springheart's attachment.
5. **Static rule changes**: Nowhere to Run (ignore hexproof and ward), Soulless Jailer (cast lock), Stormtide Leviathan (type change), Mirri's block cap, Vorinclex's untap lock, Koma's ability lock, Orim's Chant kicked, Single Combat, Taunt from the Rampart's can't block, Sundering Eruption.
6. **Incubate** (Sunfall: makes a creature at once, skipping the {2} transform; it plays stronger). **Wicked Role** tokens (Not Dead After All, Charming Scoundrel's third mode). Kozilek's Command modes 2 and 4.
7. **People's choices not yet asked**: Abundance (land or nonland), Delina's "you may roll again", Baleful Mastery's choice of opponent, Kozilek's Command's target player for Spawn.
8. **Phase 2D gaps carried over** (`audit/phase-2d/PHASE_2D_REMAINING_GAPS.md`): strive, non-mana escalate, Copy Plus for storm/cascade copies, Cemetery Tampering, damage redirection.

## Full list

### Unresolved: known defect remains (12)
- Fanatic of Rhonas (Medium) — known defect: the {G}{G}{G}{G} ability (ferocious) is not read: one mana per card / Ferocious — {T}: Add {G}{G
- Springheart Nantuko (Medium) — an "if" the reader can't read (rules 17: that part does nothing and is reported; before: treated as true) / 
- Throne of Eldraine (Medium) — known defect: makes one mana of any color instead of four of the chosen color for monocolored spells of that c
- Shatterskull Smashing // Shatterskull, the Hammer Pass (Medium) — "up to two or more targets": only one target is used / known defect: damage divided among up to two targets 
- Delina, Wild Mage (High) — known defect: the creature is chosen when the copy is made, not before the roll; "you may roll again" always
- Great Hall of the Citadel (Medium) — known defect: {1},{T}: two mana for legendary spells is not read; {T} makes restricted any-color mana instead
- Inti, Seneschal of the Sun (Medium) — "target attacking/blocking creature" is not read / known defect: the +1/+1 counter on the attacking creature
- Kozilek's Command (Medium) — known defect: mode 2 draws for you instead of the target player and skips scry X; mode 4 (exile up to X cards 
- Court of Garenbrig (Medium) — "up to two or more targets": only one target is used / known defect: the two counters can't be divided betwe
- Marauding Raptor (Medium) — an "if" the reader can't read (rules 17: that part does nothing and is reported; before: treated as true) / 
- Abdel Adrian, Gorion's Ward (Medium) — "until ~ leaves the battlefield" is not read (exiled for good) / known defect: nothing is exiled; one Soldie
- Sunfall (Medium) — known defect: incubate makes a Phyrexian X/X creature at once instead of an Incubator artifact that transforms
### Shared mechanic applied, not individually tested; still flagged (13)
- Plaza of Heroes (Medium) — Spend this mana only to cast a legendary spell.
- Conduit of Worlds (Medium) — {t}: choose target nonland permanent card in your graveyard. if you haven't cast a spell this turn, you may ca
- Steel Hellkite (Medium) — {x}: destroy each nonland permanent with mana value x whose controller was dealt combat damage by ~ this turn.
- Shrine of the Forsaken Gods (Low) — Spend this mana only to cast colorless spells. / Activate only if you control seven or more lands.
- Liberator, Urza's Battlethopter (High) — an "if" the reader can't read (rules 17: that part does nothing and is reported; before: treated as true)
- Carpet of Flowers (Medium) — an "if" the reader can't read (rules 17: that part does nothing and is reported; before: treated as true)
- Eldrazi Temple (Low) — Spend this mana only to cast colorless Eldrazi spells or activate abilities of colorless Eldrazi.
- Nimbus Maze (Low) — Activate only if you control an Island.
- Klauth, Unrivaled Ancient (Medium) — Spend this mana only to cast spells.
- Thieving Skydiver (High) — kicker {x}. x can't be 0. / If that artifact is an Equipment, attach it to this creature.
- Karn, Legacy Reforged (Medium) — This mana can't be spent to cast nonartifact spells.
- Boseiju, Who Shelters All (Medium) — If that mana is spent on an instant or sorcery spell, that spell can't be countered.
- The Mightstone and Weakstone (Low) — This mana can't be spent to cast nonartifact spells.
### Repaired part verified by test; card still flagged for another defect (11)
- Mox Diamond (Medium) — If you don't, put it into its owner's graveyard.
- Tataru Taru (Low) — an "if" the reader can't read (rules 17: that part does nothing and is reported; before: treated as true)
- Hunter's Insight (Medium) — "target … you control" is not read (a person could aim it at an opponent's permanent) / Choose target creatu
- Valakut Exploration (Medium) — an "if" the reader can't read (rules 17: that part does nothing and is reported; before: treated as true)
- Delay (Medium) — If it doesn't have suspend, it gains suspend.
- Not of This World (Critical) — an "if" the reader can't read (rules 17: that part does nothing and is reported; before: treated as true)
- The Indomitable (High) — an "if" the reader can't read (rules 17: that part does nothing and is reported; before: treated as true)
- Benevolent Hydra (Low) — "target … you control" is not read (a person could aim it at an opponent's permanent) / {t}, remove a +1/+1 
- Yenna, Redtooth Regent (Medium) — an "if" the reader can't read (rules 17: that part does nothing and is reported; before: treated as true)
- Tablet of Discovery (Low) — Spend this mana only to cast instant and sorcery spells.
- Charming Scoundrel (Low) — "target … you control" is not read (a person could aim it at an opponent's permanent)
### Unresolved: not addressed (78)
- Guardian Project (Medium) — an "if" the reader can't read (rules 17: that part does nothing and is reported; before: treated as true)
- Arena of Glory (Low) — an "if" the reader can't read (rules 17: that part does nothing and is reported; before: treated as true)
- Dauthi Voidwalker (High) — "you may play/cast … this turn" is not read / {t}, sacrifice ~: choose an exiled card an opponent owns with 
- Nesting Grounds (Low) — "target … you control" is not read (a person could aim it at an opponent's permanent) / {1}, {t}: move a cou
- Plaguecrafter (Low) — Each player who can't discards a card.
- Sundering Eruption // Volcanic Fissure (Low) — Creatures without flying can't block this turn.
- Padeem, Consul of Innovation (Low) — an "if" the reader can't read (rules 17: that part does nothing and is reported; before: treated as true)
- Destiny Spinner (Low) — "target … you control" is not read (a person could aim it at an opponent's permanent) / {3}{g}: target land 
- Skrelv, Defector Mite (Medium) — "target … you control" is not read (a person could aim it at an opponent's permanent) / {w/p}, {t}: choose a
- Mount Doom (Low) — {5}{b}{r}, {t}, sacrifice ~ and a legendary artifact: choose up to two creatures, then destroy the rest. activ
- Endurance (Medium) — "up to N target" is not read / when ~ enters, up to one target player puts all the cards from their graveyar
- Guide of Souls (Medium) — "target attacking/blocking creature" is not read / whenever you attack, you may pay {e}{e}{e}. when you do, 
- Koma, Cosmos Serpent (Medium) — Its activated abilities can't be activated this turn.
- Avatar's Wrath (Medium) — "up to N target" is not read / choose up to one target creature, then airbend all other creatures. / until y
- Planar Genesis (Low) — If you don't, put a card from among them into your hand.
- Resourceful Defense (Low) — "target … you control" is not read (a person could aim it at an opponent's permanent) / whenever a permanent
- Kozilek, the Great Distortion (Medium) — a counterspell's mana value limit is not read / discard a card with mana value x: counter target spell with ma
- Phelia, Exuberant Shepherd (Low) — an "if" the reader can't read (rules 17: that part does nothing and is reported; before: treated as true)
- Fire Nation Palace (Low) — "target … you control" is not read (a person could aim it at an opponent's permanent) / {1}{r}, {t}: target 
- Brass's Tunnel-Grinder // Tecutlan, the Searing Rift (Low) — an "if" the reader can't read (rules 17: that part does nothing and is reported; before: treated as true) / 
- March of Swirling Mist (Medium) — "up to N target" is not read / as an additional cost to cast ~, you may exile any number of blue cards from 
- Druid Class (Low) — "target … you control" is not read (a person could aim it at an opponent's permanent) / when ~ becomes level
- Orim's Chant (Medium) — If this spell was kicked, creatures can't attack this turn.
- Vorinclex, Voice of Hunger (Medium) — whenever an opponent taps a land for mana, that land doesn't untap during its controller's next untap step.
- Shigeki, Jukai Visionary (Low) — "target (non)legendary" is not read
- The Aetherspark (Medium) — as long as ~ is attached to a creature, ~ can't be attacked and has "whenever equipped creature deals combat 
- Taunt from the Rampart (Low) — Until your next turn, those creatures can't block.
- Alchemist's Talent (Low) — an "if" the reader can't read (rules 17: that part does nothing and is reported; before: treated as true)
- Eladamri, Korvecdal (Low) — {g}, {t}, tap two untapped creatures you control: reveal a card from your hand or the top card of your library
- Party Thrasher (Low) — "you may play/cast … this turn" is not read / noncreature spells you cast from exile have convoke. / at the 
- Single Combat (Low) — Players can't cast creature or planeswalker spells until the end of your next turn.
- Likeness Looter (Low) — {x}: ~ becomes a copy of target creature card in your graveyard with mana value x, except it has flying and th
- Karn, the Great Creator (High) — "up to N target" is not read
- Risen Reef (Medium) — If you don't put the card onto the battlefield, put it into your hand.
- Aetheric Amplifier (Low) — {4}, {t}: choose one. activate only as a sorcery.
- Bloodthirsty Blade (Medium) — {1}: attach ~ to target creature an opponent controls. activate only as a sorcery.
- Urza's Workshop (Low) — Metalcraft — {T}: Add {C} for each Urza's land you control. / Activate only if you control three or more artif
- Toxrill, the Corrosive (High) — at the beginning of each end step, put a slime counter on each creature you don't control. / creatures you don
- Invert Polarity (Low) — a coin flip is not read / choose target spell, then flip a coin. if you win the flip, gain control of that spe
- Orthion, Hero of Lavabrink (Low) — {6}{r}{r}{r}, {t}: create five tokens that are copies of another target creature you control. they gain haste.
- Chthonian Nightmare (Low) — pay x {e}, sacrifice a creature, return ~ to its owner's hand: return target creature card with mana value x f
- Sceptre of Eternal Glory (Low) — Activate only if you control three or more lands with the same name.
- Halvar, God of Battle // Sword of the Realms (Low) — "target … you control" is not read (a person could aim it at an opponent's permanent) / at the beginning of 
- Resonating Lute (Medium) — lands you control have "{t}: add two mana of any one color. spend this mana only to cast instant and sorcery 
- The Chain Veil (High) — an "if" the reader can't read (rules 17: that part does nothing and is reported; before: treated as true) / 
- Inga and Esika (Low) — an "if" the reader can't read (rules 17: that part does nothing and is reported; before: treated as true)
- Tinybones, Bauble Burglar (Low) — whenever an opponent discards a card, exile it from their graveyard with a stash counter on it. / during your 
- Shadrix Silverquill (Medium) — "target player / each player draws … and loses N life": the life loss (and the target) is not read / at the 
- Roiling Vortex (Medium) — an "if" the reader can't read (rules 17: that part does nothing and is reported; before: treated as true) / 
- Mirri, Weatherlight Duelist (Low) — whenever ~ attacks, each opponent can't block with more than one creature this combat.
- Thousand-Faced Shadow (Medium) — "target attacking/blocking creature" is not read / when ~ enters from your hand, if it's attacking, create a
- Rionya, Fire Dancer (Medium) — "target … you control" is not read (a person could aim it at an opponent's permanent) / at the beginning of 
- Mistveil Plains (Low) — {w}, {t}: put target card from your graveyard on the bottom of your library. activate only if you control two 
- Repulsive Mutation (Low) — Then counter up to one target spell unless its controller pays mana equal to the greatest power among creature
- Celestine, the Living Saint (Low) — "target … with mana value N or less/greater" is not read / healing tears — at the beginning of your end step
- Nowhere to Run (Medium) — creatures your opponents control can be the targets of spells and abilities as though they didn't have hexproo
- Dance of the Manse (Medium) — "up to N target" is not read / return up to x target artifact and/or non-aura enchantment cards each with ma
- Metamorphosis Fanatic (Low) — "up to N target" is not read
- Glistening Sphere (Low) — Corrupted — {T}: Add three mana of any one color. / Activate only if an opponent has three or more poison coun
- Stormtide Leviathan (Low) — all lands are islands in addition to their other types. / creatures without flying or islandwalk can't attack.
- Gathering Stone (Low) — when ~ enters and at the beginning of your upkeep, look at the top card of your library. if it's a card of the
- Lost Monarch of Ifnir (Low) — an "if" the reader can't read (rules 17: that part does nothing and is reported; before: treated as true) / 
- Biomancer's Familiar (Low) — {t}: the next time target creature adapts this turn, it adapts as though it had no +1/+1 counters on it. / Thi
- Hollowmurk Siege (Low) — "target attacking/blocking creature" is not read / • Sultai — Whenever a counter is put on a creature you co
- The Mind Stone (Low) — "up to N target" is not read / "target … you control" is not read (a person could aim it at an opponent's 
- Misleading Signpost (Low) — "target attacking/blocking creature" is not read / when ~ enters during the declare attackers step, you may 
- Fandaniel, Telophoroi Ascian (Medium) — at the beginning of your end step, each opponent may sacrifice a nontoken creature of their choice. each oppon
- Diamond City (Low) — {t}: move a shield counter from ~ onto target creature. activate only if two or more creatures entered the bat
- Ardyn, the Usurper (Medium) — "up to N target" is not read / starscourge — at the beginning of combat on your turn, exile up to one target
- Strength of Will (Low) — "target … you control" is not read (a person could aim it at an opponent's permanent) / until end of turn, t
- Meathook Massacre II (Medium) — whenever a creature you control dies, you may pay 3 life. if you do, return that card under your control with 
- Ghost Vacuum (Low) — {6}, {t}, sacrifice ~: put each creature card exiled with ~ onto the battlefield under your control with a fly
- Eiganjo Castle (Low) — "target (non)legendary" is not read / {w}, {t}: prevent the next 2 damage that would be dealt to target lege
- Spirit Water Revival (Low) — an "if" the reader can't read (rules 17: that part does nothing and is reported; before: treated as true) / 
- Soulless Jailer (Medium) — players can't cast noncreature spells from graveyards or exile.
- Soul's Majesty (Low) — "target … you control" is not read (a person could aim it at an opponent's permanent)
- Dire Fleet Daredevil (Medium) — "you may play/cast … this turn" is not read / when ~ enters, exile target instant or sorcery card from an op
- Out of the Tombs (Low) — if you would draw a card while your library has no cards in it, instead return a creature card from your grave


## Classification notes

- Several cards stay "incorrect" because coverage still sees an unread restriction sentence, even though the mechanic was repaired and tested. These are Mox Diamond's "If you don't, put it into its owner's graveyard" and Delay's "If it doesn't have suspend, it gains suspend". Their tests in `tests/mechanics.mjs` and `tests/repairs.mjs` show the behaviour, but they are kept as flagged rather than adding coverage exceptions without a check that reads the sentence.
- `tests/known-defects.json` keeps 12 cards "incorrect" even when a test names them, so a test of the repaired part can't make a still-defective card "fully simulated".
