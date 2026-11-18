# Rules validation results

`node tests/rules.mjs --report tests/rules-report.md` · rules version 20 · 26 of 27 pass

| ID | Feature | Rules | Expected | Result | Files | Severity if it fails |
|---|---|---|---|---|---|---|
| R01 | Casting a spell | 601.2, 608.2 | cast, put on the stack, resolved from the top, two cards drawn, the card to the graveyard | pass | engine.js cast, stack.js | High |
| R02 | Casting failure without partial payment | 601.2h, 601.5 | a spell that can't be paid for is not cast: nothing tapped, nothing paid, the card stays in hand | pass | engine.js cast, mana.js | Critical |
| R03 | Timing restrictions (engine-enforced) | 307.1, 117.1a, 702.8 | rules 20: a sorcery is refused on an opponent's turn and with a spell on the stack; an instant and a flash creature are not; rules 19 replays keep the old answer | pass | mana.js timingRefuses, engine.js cast | High |
| R04 | Additional costs paid while casting | 601.2a, 601.2h, 608.2h | Fling: the card goes on the stack (601.2a), then the creature is sacrificed as a cost (601.2h); the damage uses its last known power | known deviation: the engine pays additional costs (sacrifice, discard) before putting the card on the stack. The result is the same unless something triggers on the cost and looks at the stack; the damage and last known power are right. | engine.js cast, resolve.js damage | Low |
| R05 | Responses to responses, last in first out | 117.3c, 405.5, 608.1 | Grizzly Bears, then Lightning Bolt in response, then Shock: they leave the stack top first: Shock, Bolt, Bears | pass | stack.js priority15, engine.js | Critical |
| R06 | Countering a spell | 701.5, 608.2b | Counterspell resolves first and the countered spell goes to the graveyard without resolving (no cards drawn) | pass | resolve.js counter, stack.js | High |
| R07 | Mana abilities don't use the stack | 605.3a, 605.3b | tapping Sol Ring adds {C}{C} at once with nothing put on the stack | pass | engine.js tapForMana | Medium |
| R08 | First strike | 510.4, 702.7b | Lyra (5/5 first strike, lifelink) kills a blocking Serra Angel in the first-strike step; Serra never deals damage; Lyra's controller gains 5 | pass | combat.js, engine.js combatDamage | High |
| R09 | Double strike | 702.4b, 510.4 | an unblocked Boros Swiftblade deals combat damage twice, once in each step | pass | combat.js | High |
| R10 | Trample with deathtouch, and lifelink | 702.19c, 702.2c, 702.15b, 510.1c | a 2/2 deathtouch trample lifelink attacker blocked by a 3/3 assigns 1 (lethal with deathtouch) to it and 1 to the player; both die; its controller gains 2 | pass | combat.js, combatai.js | High |
| R11 | Flying, reach and menace in block legality | 702.9b, 702.17b, 702.110b, 509.1b | a non-flyer can't block a flyer, reach can; a menace attacker blocked by one creature is unblocked | pass | combat.js, engine.js canBlock | High |
| R12 | Attacking a planeswalker | 506.3, 510.1, 120.3c, 704.5i | damage to an attacked planeswalker removes loyalty, not life; at 0 loyalty it goes to the graveyard | pass | combat.js, resolve.js damageObj | High |
| R13 | Additional combat phase | 500.8, 506.1 | Relentless Assault: the creatures untap and attack again in a second combat phase; two rounds of combat damage | pass | resolve.js extraCombat, engine.js restOfTurn | Medium |
| R14 | Simultaneous state-based actions | 704.3, 704.5f, 704.5g | a creature with lethal damage and one with 0 toughness die in the same pass, as state-based actions (not triggers: nothing goes on the stack) | pass | engine.js sba, triggers.js | Critical |
| R15 | Legend rule | 704.5j | with two copies of a legendary permanent, its controller keeps one | pass | engine.js sba | High |
| R16 | A player at 0 life loses | 704.5a, 120.3a | Lightning Bolt to a player at 3 life: damage, life to 0, the player loses at the next state-based check | pass | engine.js sba | Critical |
| R17 | Replacement effect on dying: Rest in Peace | 614.1a, 614.6 | a creature that would die is exiled instead and is never in the graveyard | pass | replacements.js, zones.js move | Critical |
| R18 | Replacement effect: Leyline of the Void | 614.1a | an opponent's creature that dies is exiled instead; its controller's own isn't | pass | replacements.js, zones.js move | High |
| R19 | Token doubling: Doubling Season and Anointed Procession | 614.1a, 616.1, 111.1 | Raise the Alarm makes 2 soldiers; with Doubling Season 4; with Anointed Procession too 8 | pass | replacements.js | High |
| R20 | Until-end-of-turn effects expire at cleanup | 514.2, 611.2a | Giant Growth makes Grizzly Bears 5/5 until the cleanup step, then 2/2 again; damage is removed then too | pass | engine.js endSteps | High |
| R21 | Control change until end of turn | 108.4, 613.1b, 514.2 | Act of Treason: P1 controls P2's Hill Giant, untapped and with haste, this turn; it returns at cleanup; ownership never changes | pass | resolve.js steal, engine.js endSteps | High |
| R22 | Ability removal and base P/T in layers: Humility | 613.1f, 613.4b, 613.4c | rules 20: with Humility and Glorious Anthem a creature is 2/2 (1/1 set in 7b, +1/+1 in 7c) with no keywords; Craterhoof's enters trigger doesn't trigger; rules 19 keeps the old reading | pass | effects.js, engine.js humility/setLayer, triggers.js | High |
| R23 | A permanent that changes zones is a new object | 400.7, 303.4d, 704.5m | bounced Grizzly Bears with counters, damage and an Aura comes back clean: no counters or damage, untapped; the Aura goes to the graveyard | pass | zones.js move, engine.js sba | High |
| R24 | Tokens cease to exist outside the battlefield | 111.7, 704.5d | a dying token is gone, not in a graveyard | pass | zones.js move | High |
| R25 | Commander tax | 903.8 | a commander cast a second time from the command zone costs {2} more | pass | mana.js costOf, engine.js cast | High |
| R26 | Commander damage | 903.10a, 704.6c, 510.2 | combat damage from each commander is counted apart; noncombat damage from a commander doesn't count; 21 from one commander loses even at high life | pass | resolve.js damagePlayer, combat.js | Critical |
| R27 | Unread card text is reported, not approximated | — (coverage) | Fireball's divided damage isn't read, and the game says so | pass | effects.js ignoredText | Medium |
