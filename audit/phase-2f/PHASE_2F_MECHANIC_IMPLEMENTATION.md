# Phase 2F — Shared Mechanics Implemented

Every mechanic is read by `public/js/effects.js` and played by the engine from **rules 27**. Search the code for `Phase 2F-` to find each piece. For each mechanic: what it does, the rules behind it, how it was built (extended or new), the cards it reaches, the AI and the person, and its tests (`tests/completions.mjs`).

## 2F-1 Follow-up sentences: `them27` (new)

**Text.** A sentence whose subject is what the sentence before it just affected: *those creatures, those permanents, those tokens, they, it, them, that token, that creature, each of them*. Each form is read as a field:

| Form | Field | Engine effect |
|---|---|---|
| "… gain(s) haste / vigilance / hexproof and indestructible … [until end of turn]" | `kw` | `tempKw` (cleared at cleanup) |
| "untap it / them / those creatures" | `untap` | untapped |
| "… get(s) +N/+N until end of turn" | `p`, `t` | `tempP`/`tempT` |
| "… attack(s) this combat if able" | `attack` | `o.mustAttack27 = turn`; `combat.js` adds it to the attackers whatever its controller declared (people too) |
| "sacrifice / exile it at the beginning of the next end step", "at the beginning of your next end step, exile it", "return that creature to your hand at the beginning of the next end step" | `end`: sac / exile / hand, `mine` | `g.endLater27`, run in `endSteps`; "your next end step" waits for its controller's; checked against the permanent's timestamp `o.ts`, so a permanent that left and came back is a new object and is left alone (400.7) |
| "… phase(s) out" | `phase` | `Game.phaseOut`, by controller |
| "put an indestructible counter on each of them" | `kwc` | keyword counter (`permKw`) |

**What "them" is.** `resolve.js runEffects0` records, for each effect, the permanents it touched (`g.touched27`): those it put onto the battlefield (`zones.js entered`), its target (`g.lastTgt27`), and those changed by group effects (`teamPump`, `counters`, through `touch27`). A follow-up applies to the last effect that touched something, if those permanents are still on the battlefield. A nested run (an "if", a "you may pay … if you do") adds to the outer list. So "If you do, create a token… That token gains haste" does nothing when the cost wasn't paid.

**Safeguards against false completion.**
- A sentence is only taken when the existing reader gets nothing from it. If adding the sentence changes `parseFlat`'s reading, it is left alone, so Kiki-Jiki's "sacrifice it at the beginning of the next end step" stays with `copyToken.temp`.
- A sentence is only taken after an effect whose permanents are recorded (`THEM_KINDS`). After an unread sentence or a non-permanent effect (a draw), the follow-up stays unread rather than act on nothing. Mimic Vat, Orthion, Hellkite Courser, Nissa Who Shakes the World and Inspiring Call therefore stay partial.
- It is not used after a threaten effect, whose own handler untaps and gives haste.

**AI.** `ai.js effectValue('them27')` values untapping, keywords, pumps and keyword counters, less a delayed sacrifice. Choices that already existed (the target, the creature put from hand) are unchanged. **Person.** Nothing new to choose. A person's choices in the effect before (the target, Sneak Attack's creature) decide "them".

**Tests.** 14 card tests: Sokenzan, Felidar Retreat, Shore Up (including an illegal target), Gift of the Viper, Virtue of Loyalty, Siege-Gang Lieutenant (condition on and off), Legion Warboss (real combat: both Goblins attack although none were declared), Urabrask's Forge, Flameshadow Conjuring (paid and unpaid), Wake the Past, Slip Out the Back, Sneak Attack (AI, person, rules 26), Puppeteer Clique (an opponent's end step versus its own), a permanent that left and came back, Ilharg, Knights of Round, Ovika, Valley Floodcaller (opponent's creature unaffected; AI value), Magic Damper, Octopus Form, Loyal Apprentice, Howlsquad Heavy, and rules 26.

## 2F-1 Several "whenever you cast" lines: `onCast27` (extension)

`fx.onCast` held one cast trigger, so a second line replaced the first (Jeskai Ascendancy lost its pump). Earlier lines now go to `fx.onCast27`. `engine.js` queues each matching one in printed order with the same filters (what spell, from hand, power, once a turn). `onCast` stays the last line, so rules-26 games read as before.

## 2F-1 "Tapped and attacking" from hand (extension of `fromHand`)

`attacking27` on the general `fromHand` pattern (Ilharg). It uses the same branch as Kaalia's `attacking`.

## 2F-2 Kicked "instead" with another number (extension of `if … instead`)

"If this spell was kicked, create five of those tokens instead" / "put two of those cards into your hand instead". This is the previous sentence's `copyToken` (with `n`) or `dig` (with `take`) under `{k:'if', cond: kicked, else: [original]}`. The plain effect is kept `until: 27`. Tested unkicked, kicked, and through a real kicked cast that pays {5} more.

## 2F-3 Channel cost reduction: `channel.less27` and `Game.cycleCost` (new, small)

`Game.cycleCost(p, o)` is now the one place channel and cycling costs are computed (`canCycle`, `cycle`, the AI through `canCycle`, and a person's hand menu). It takes `n` generic mana off for each legendary creature its controller controls, never below zero and never colored mana. Tested with 0, 2 and 3 legends, at rules 26, and through a real channel activation.

## 2F-3 Compensation "a land card with a basic land type" (extension of `comp`)

`comp.land27` sits next to the existing `comp.land` (basic lands only). `resolve.js compensate` searches with `subs: [the five basic types]`, so dual lands count. The fetch is the searching player's choice (`fetchLands` asks a person). Tested with a Tropical Island, and at rules 26.

## 2F-3 Bounce of a list of card types (new pattern)

"return target artifact, creature, enchantment, or planeswalker to its owner's hand": `bounce` with `tr.kinds` from the existing target-word reader. Tested: a land is not a legal target.

## 2F-5 Counterspell destinations: `exile27`, `top27` (extension of `toExile`/`toHand`)

The counter handler marks the stack item. `engine.js` moves it to exile or to the top of its owner's library. A flashback spell is still exiled (702.34a wins), and a copy still ceases to exist. Tested with Memory Lapse on a creature spell and on a flashback spell, Force of Negation on a noncreature spell and against a creature spell (not a legal target), and at rules 26.

## 2F-5 Returned as an enchantment: `returnSelf.ench27`, and last-known types for "if it was a creature" (extension)

- "It's an enchantment." after a `returnSelf` marks it. The card's types are changed before it enters, so "a creature enters" abilities don't see a creature, and are restored when it leaves the battlefield (`zones.js`).
- `triggers.js evalCond('trigIs')`: when no other object triggered the ability, "it" is the source as it last existed on the battlefield (`src.lki`, 608.2h). Before, this was always false, and the Enduring cards never returned.
- Tested: the cards return without being a creature and keep their other abilities; dying again as a non-creature doesn't return them; rules 26 doesn't return them.

## 2F-5 Granted flashback (verification, plus a person's choice)

"The flashback cost is equal to its mana cost" was already how `mana.js` casts a granted flashback. The sentence is now recognized (HARMLESS), and tests cast Brainstorm through Snapcaster, Past in Flames and Lier for {U}, with the card exiled afterwards. New: a person chooses Snapcaster Mage's card (`chooseCardsAsync`); before, the AI's pick was used for them too.

## 2F-7 Color chosen as a land enters: `chooseColor27` (extension of `chosenColor`)

`zones.js entered` chooses the commonest other color among its controller's cards and narrows `fx.mana.colors` to [own color, chosen] or [chosen]. The printed card is restored when it leaves. **Limitation:** a person is not asked yet; the commonest color is chosen for them too (`entered` is synchronous). This is listed in the remaining gaps.

## 2F-7 "Choose a creature type" as a spell resolves: `chooseType27` (extension of `chosenType`/`bestType`)

A reader pre-pass reads "choose a creature type. …" into the choice followed by what uses it. That can be the existing `chosenCount` amount (now `who: 'you'`, `perm`: any permanent of the type), or `wipe.notChosen27`. A person is asked (`HumanAgent.chooseTypeAsync`, the types on the battlefield, or "Let the AI choose"); the AI takes its commonest creature type. **Limitation:** the AI's choice for Kindred Dominance is its commonest type, not a full board evaluation.

## 2F-7 Conditional mana amounts: `mana.cond27` (extension of `manaAmount`)

`mana.js manaAmount` is the one place mana amounts are computed. `cond27` covers named permanents (Urza's Mine, Power Plant, Tower, whatever the hyphen), a creature with power 4 or greater, and a +1/+1 counter on the source. A color change "instead" (River of Tears) is not done.

## 2F-8 Coverage checker accuracy (`effects.js droppedSentences`)

- An activated ability's own copy of its text is left out of the comparison (`fxPrint`).
- In a line whose first sentence starts with a cost, taking that sentence out keeps the cost and drops only the effect. Mana abilities are excluded, because their colors also come from the card data.
- "It's still a land" (animate keeps the land type) and "Activate only once each turn" (enforced from rules 26) are recognized.

This doesn't change how a game plays. It changes the coverage report and the "not simulated" lists shown to players. It can also add a once-a-game log note about unread replacement text (`zones.js entered`). Golden games at rules 4–26 show no difference.
