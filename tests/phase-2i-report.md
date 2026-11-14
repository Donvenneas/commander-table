# Phase 2I report: card abilities (ROADMAP item 196, rules 16, version 1.31.0)

Measured on tests/cards-snapshot.json: the 3,500 most-played Commander cards, in EDHREC order, as saved when the
snapshot was taken. Every number below comes from `node tests/coverage.mjs --report tests/card-coverage.md`. That full
report has the per-card table (top 100, ability by ability), the keyword table, the misread cards and the ranked next
batch. None of these numbers claims rules compliance: "full" means every printed line is read and every effect it
produces has a handler, not that each handler has been verified.

## 1–6. Cards and abilities audited

| | Before (1.30.0) | After (1.31.0) | Share after (of 3,500) |
|---|---|---|---|
| Cards audited | 3,500 | 3,500 | |
| Full | 2,787 | 2,796 | 79.9% (2796/3500) |
| Partial | 446 | 444 | 12.7% (444/3500) |
| Restriction (plays stronger than printed) | 106 | 92 | 2.6% (92/3500) |
| Incorrect (misread, found by the MISREAD checks) | not measured | 8 | 0.2% (8/3500) |
| Unhandled (read, no engine handler) | 10 | 10 | 0.3% (10/3500) |
| Unsupported (nothing read) | 151 | 150 | 4.3% (150/3500) |

- Of the 2,796 full cards, 152 are named in at least one test. The other 2,644 are read but not individually
  verified ("unable to determine" correctness).
- Before 1.31.0, Phyrexian Arena, Night's Whisper, Plumb the Forbidden, Vraska's 0 and Cryptbreaker counted as full,
  but they were misread: the life loss was missing. The "incorrect" category didn't exist then, so the old full count
  includes these cards.
- Abilities audited: 7,102 printed lines (reminder text removed), each sorted into one ability type. Read means the
  reader produced something for the line.

## 7–10. Coverage by ability type

| Type | Lines | Read | Partly read | Not read |
|---|---|---|---|---|
| Keyword | 1,108 | 99.4% (1101/1108) | 0 | 7 |
| Triggered | 1,658 | 83.8% (1389/1658) | 94 | 175 |
| Activated | 722 | 89.3% (645/722) | 6 | 71 |
| Mana | 727 | 92.4% (672/727) | 54 | 1 |
| Loyalty | 117 | 100.0% (117/117) | 0 | 0 |
| Static | 1,141 | 86.7% (989/1141) | 25 | 127 |
| Spell | 1,084 | 84.9% (920/1084) | 97 | 67 |
| Replacement | 518 | 91.9% (476/518) | 27 | 15 |
| Prevention | 27 | 55.6% (15/27) | 4 | 8 |
| **All** | **7,102** | **89.0% (6324/7102)** | | |

Keywords: card-coverage.md lists all 245 Scryfall keywords on 3 or more cards, with the share of those cards that are
full. For example: Flying 75.6% (201/266), Trample 74.5% (70/94), Cycling 100% (54/54), Deathtouch 80.6% (29/36),
Prowess 87.5% (7/8), Kicker 40.0% (4/10). These are card shares, not verdicts on the keyword itself.

Keyword mechanics checked with games in tests/abilities.mjs: flying, reach, vigilance, trample, deathtouch, lifelink,
first strike, double strike, menace (existing), defender, haste, hexproof, shroud, ward (paid and unpaid),
indestructible, protection, prowess, fear, intimidate, skulk, shadow, horsemanship, flash (timing helper), delve,
affinity, convoke, kicker, cycling, landcycling, unearth, escape, flashback, suspend, adventure, regeneration and equip.
Mutate couldn't be tested: no card in the test data has it.

## What was wrong, and what was fixed (rules 16; replays at rules 4–15 unchanged)

| Problem found | Fix | Engine system used |
|---|---|---|
| Protection only stopped damage and blocking, never targeting, and only from colors | Game.protectedFrom: targeting, blocking, damage, Auras and Equipment fall off; also everything, each color, card types, multicolored | canTarget/validTarget (with the source), canBlock, damageObj, state-based actions 704.5m/n |
| Granted protection (Mother of Runes, Gods Willing) was played as hexproof | Real protection from the chosen color | 'protect' effect, tempProt until end of turn |
| Prowess pumped at once, and only printed prowess counted | A trigger on the stack; granted prowess counts | castTriggers queue, has() |
| Second combat damage step read the keywords as they are now | 510.4: creatures without first or double strike as the first step began, plus double strikers | combatDamage |
| Deathtouch did nothing through infect or wither damage | Destroys the creature (704.5h) | damageObj, state-based actions |
| Equip, cycling, landcycling and unearth resolved at once | Use the stack; unearth, embalm and eternalize only as a sorcery | putAbility/stackAbility, effects 'equipAttach', 'unearthReturn' |
| "You draw a card and lose 1 life" lost the life loss | Read, with since: 16 | effects.js pattern, doEffect gate |
| "Activate only if you control …" on mana abilities was ignored | Conditional colors (fx.mana.cond16) | mana.js sources/units |
| Cavern of Souls tapped by hand made only {C} (open since Phase 2E) | Restricted any-color mana in the pool, uncounterable spell | pool units, spendOk |
| Every token re-read its text | Shared readings per token kind (as copies of a card already share theirs) | zones.js tokenFx |

The six Phase 2E cards: Teferi's Protection, Mana Drain, Chaos Warp, Arcane Denial and Temple of the False God pass
their 16 existing interaction tests at rules 16. Cavern of Souls' remaining gap (tapped by hand) is fixed and tested.
They still depend on one thing not done: Arcane Denial's "up to" draws are asked of people, while the AI always takes
all of them.

## 11. Files modified

public/js: engine.js, effects.js, resolve.js, combat.js, mana.js, zones.js, triggers.js, stack.js, ai.js, human.js.
tests: abilities.mjs (new), coverage.mjs, interactions.mjs (two tests updated for intended changes, with rules 15
checks), golden.mjs (rules 15 kept in the list), card-readings.json, golden-games.json, card-coverage.md,
phase-2i-report.md. Also README.md, ROADMAP.md, CLAUDE.md, VERSION, .github/workflows/selftest.yml, and
public/data/whatsnew.json and help.json (both generated).

## 12. Tests added

tests/abilities.mjs: 47 tests, including all 20 from the brief's Part 9 (numbered 1–20 in their names), each checking
timing (who got priority with what on the stack), costs paid, targets, event order and the resulting zones and life.
Every behaviour change also has a rules 15 check that the old behaviour is kept for replays.

## 13. Existing tests run

typecheck (0 findings, strict null 0), cards (0 changed after accepting the intended readings), interactions 171/171,
golden 78/78 (rules 4–15 unchanged; 6 new rules 16 games recorded), stack 22/22, replacements 15/15, mana 21/21,
loops 18/18, combos 21/21, replay 10/10, hidden information (0 changed decisions), fuzz 12 games and 60 games at
rules 16 (0 simulator errors, 0 broken rules), and the browser self-test.

## 14. Known limitations

- Game.cast doesn't check spell timing (sorcery speed or flash); the AI and the human prompts do. Changing that
  would also affect free casts during resolution, so it is left as is.
- A person isn't asked which color to take protection from; the AI's choice is used.
- Giver of Runes ("colorless or the color of your choice") is still played as hexproof.
- "Target player draws … and loses N life" (Sign in Blood, Damnable Pact, Stormfist Crusader and 5 more) reads as
  you drawing, with no life loss: the 8 misread cards.
- Fanatic of Rhonas's second mana ability ({G}{G}{G}{G} with a condition) isn't read.
- Embalm and eternalize still resolve at once (their exile is part of the cost, which the stack version would need to
  model first).
- Tribal cycling (Wizardcycling) and channel keep their old path.
- "Incorrect" only counts misreadings the MISREAD checks know about. Other misreadings may sit among the 2,644 full
  but untested cards.
- The per-type audit sorts lines with patterns, so a few lines may be counted under the wrong type.

## 15. Top 20 for the next batch

Taken from the ranked list in card-coverage.md (misread first, then the brief's category order, most played first):

1. Sign in Blood (229): target player, and the life loss
2. Giver of Runes (1366): protection from colorless or a chosen color
3. Stormfist Crusader (2012): each player loses 1 life
4. Damnable Pact / Insatiable Avarice / Pact of the Serpent (same reading fix as 1)
5. Path of Ancestry (9): scry when its mana casts a creature sharing a type with your commander
6. Boseiju, Who Endures (73): the opponent's search; the channel cost reduction
7. Otawara, Soaring City (85): channel cost reduction
8. Victimize (125): two target creature cards
9. Delighted Halfling (141): legendary-only mana that makes the spell uncounterable
10. Gemstone Caverns (174): luck counter, opening-hand exile
11. Mosswort Bridge (194): hideaway
12. Secluded Courtyard (216): chosen-type mana restriction
13. Animate Dead (217): sacrifice when the Aura leaves
14. The Great Henge (225): the 2 life on tapping
15. Takenuma, Abandoned Mire (241): channel cost reduction
16. Mox Diamond (242): discard a land or it goes to the graveyard
17. Unclaimed Territory (245): chosen-type mana restriction
18. Sylvan Library (256): pay 4 life or put cards back
19. Force of Negation (269): exile the countered spell
20. Bolas's Citadel (274): pay life for spells from the top of the library
