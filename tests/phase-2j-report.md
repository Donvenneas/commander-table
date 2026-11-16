# Phase 2J report: multiplayer and Commander (ROADMAP item 381, rules 18, version 1.53.0)

Every "tested" below names a test in `tests/multiplayer.mjs` (36 tests, real cards on known boards, a fake room for
online seats). Nothing here claims full multiplayer or Commander rules compliance: the classification says what was
checked and what was not. New engine behaviour is behind rules 18; games and replays at rules 4 to 17 play as before
(golden games: 90 played, 0 differ).

## 1. Files inspected

public/js: engine.js, remote.js, net.js, human.js, ai.js, combatai.js, triggers.js, combat.js, zones.js, mana.js,
resolve.js, stack.js, invariants.js, ui.js, main.js, decks.js, formats.js, presets.js (decks only). Also play.html,
index.html, server.py (room calls), tests/net.mjs, tests/servers.mjs, tests/stack.mjs, tests/scenario.mjs.

## 2. Files modified

public/js: engine.js, triggers.js, zones.js, net.js, human.js, remote.js, main.js, ui.js, formats.js.
public: index.html, play.html, css/style.css. tests: multiplayer.mjs (new), golden.mjs (rules 17 kept in the list),
golden-games.json (rules 18 added), phase-2j-report.md. Also README.md, ROADMAP.md, CLAUDE.md, VERSION,
.github/workflows/selftest.yml. No server changed: no endpoint was added or changed.

## 3. How it worked before (audit)

- **Shape:** one `Game` runs in the host's window and owns all state. A friend's page (`remote.js`) is a thin client: it
  polls the local server for its seat's view (`net.js` `snapshot`) and for the question waiting for it, and posts an
  answer. Seats are player indexes; each online seat has its own secret key, checked by the server.
- **Priority:** `stack.js` `priority15` (rules 15): the object's controller first, then turn order, skipping players
  who have left; all must pass in a row. Triggers go on the stack together in APNAP order (`triggers.js`).
- **Already in place:** commander tax per commander and only from the command zone, the owner's zone-change choice
  (903.9a as a state-based action, 903.9b as a replacement), commander damage per commander and only from combat,
  reconnecting with the same link, answers checked against what was offered, per-seat views without other hands.

Limits found (each confirmed with a probe game before any change):

| Limit | Rule |
|---|---|
| Two players losing in one check: the seat checked second was left as the winner | 104.4a |
| An eliminated player's spell on the stack still resolved; their waiting triggers, hand and graveyard stayed in the game | 800.4a |
| A card that entered under the leaving player's control went back to its owner's battlefield instead of exile | 800.4a |
| No way to concede | 104.3a |
| A trigger from the cleanup discard waited until the next turn | 514.3a |
| Views had no revision number, no priority holder, no disconnect status; graveyards and exile were counts only | — |
| One disconnect behaviour, not configurable | table rule |
| `checkDeck` did not check color identity (only the deck builder did) | 903.4 |
| A tooltip and the board chips said "of 21" in formats with another limit (Pauper Commander: 16) | 903.10a |

## 4–19. What was done, by part

| # | Feature | Status | Evidence |
|---|---|---|---|
| 4 | Views carry a revision number that only goes up (across games and rewinds); a friend's page drops an older view; one seat's views are sent one after another | Fully implemented; the page-side drop and the send order are not covered by a test (they need a browser and a server) | test 20 (revision rises) |
| 4 | Priority holder, stack ids and controllers, life, poison, zones, turn, phase, active player in every view | Fully implemented | tests 3, 17, 19b |
| 4 | Legality is decided by the host's engine; an answer can only pick among what was offered; an old or repeated answer is ignored; extra fields do nothing | Fully implemented | test 21, tests/net.mjs |
| 4 | A seat can't act for another seat | Fully implemented in the servers (per-seat key); tested by tests/servers.mjs, which needs a running server and was not run this session | — |
| 5 | Players losing in the same check leave together; nobody left is a draw; shared places | Fully implemented (Kingdoms and team games keep the old order) | tests 5, 5b, 5c, 5d |
| 5 | APNAP order with four players; simultaneous deaths each seen by the other | Already implemented; now tested with four players | tests 4, 22 |
| 5 | Several replacement effects on one event; several players choosing in one event | Already implemented (rules 14, 15); not re-tested here | tests/replacements.mjs, tests/stack.mjs |
| 6 | Untap, upkeep, draw, main, combat, main, end in order, for the right player | Already implemented | tests 1, 2 |
| 6 | Beginning of combat, declare attackers, declare blockers, combat damage | Already implemented | tests 10, 23 |
| 6 | One or two combat damage steps (510.4); a player eliminated in the first takes none in the second | Already implemented | tests 23, 23b |
| 6 | End of combat step | Partially implemented: "at end of combat" effects happen, but there is no separate step with priority | — |
| 6 | Cleanup: discard to hand size, damage wears off with "until end of turn" effects | Already implemented | test 24 |
| 6 | Cleanup repeats when something happens in it (514.3a) | Fully implemented | test 24b |
| 6 | Extra combat phases (beyond damage steps) | Already implemented (up to three); not tested here | — |
| 7 | Commander designation, starting in the command zone, casting from it | Already implemented | tests 6, 8 |
| 7 | Color identity in deck checks | Fully implemented | deck check test |
| 8 | Commander tax: {2} per earlier cast from the command zone, per commander, kept across zone changes, not for casts from the hand | Already implemented | tests 6, 6b, 7 |
| 7 | Owner's choice when the commander would go to a graveyard, exile, hand or library; the owner is asked, not the controller | Already implemented | tests 8, 9 |
| 9 | Commander damage: combat only, per commander, per player, kept across zone changes, separate from life | Already implemented; the display now uses the format's limit | tests 10, 11, 12 |
| 10 | Elimination by life, poison, empty library, commander damage | Already implemented | tests 11, 13, 25 |
| 10 | Everything the player owns leaves; control effects end; cards that entered under their control are exiled; their stack objects and waiting triggers don't resolve | Fully implemented | tests 13, 18, 18b |
| 10 | Turn order and priority skip them; the game ends with one player left | Already implemented | tests 2, 3b, 13, 25 |
| 11 | Concede: host seat and friend seat, through "can't lose", once only, replay-exact | Fully implemented; the two buttons themselves were checked to exist and load, not clicked in a live room | tests 15, 15b |
| 11 | A dropped connection is not a concession; a dropped client's answers aren't used; three table rules (AI plays, wait, concede after 5 or 15 minutes) | Fully implemented | tests 16, 16b |
| 11 | Reconnecting restores the seat and its full view | Already implemented; tested at the host side | test 17 |
| 12 | A view holds no other player's hand, no library card or order, no hidden card's id; spectators see no hand | Already implemented; now tested field by field | tests 19, 20 |
| 12 | Face-down permanents and face-down exiled cards named only to their owner; graveyards and face-up exile listed | Fully implemented (new lists) | test 19b |
| 12 | Shuffles use the game's seeded dice on the host only | Already implemented | test 20 |
| 12 | The AI never reads hidden cards | Already implemented | tests/hidden.mjs (4,779 decisions, 0 changed) |
| 13 | Deck size, singleton, commander legality, pairs (partner, partner with, friends forever, background, Doctor's companion), ban list, other formats' own rules; warnings, nothing removed | Already implemented; color identity added | deck check test |
| 14 | Priority chip, conceding chip, disconnected chip on every player's screen; Concede buttons; the disconnect setting; graveyard and exile tooltips for friends; "draw" on a friend's page | Fully implemented; looked at only as far as the pages loading without errors | — |

**Ban list source:** Scryfall's legality field for the chosen format, saved with each card. A card saved before a ban
changed keeps its old legality until its data is fetched again.

**Table rules that are not Magic rules:** what happens when a friend's page stops checking in (the three rules above,
and the 12 seconds before a seat counts as disconnected); the time for each decision and the turn clock; the AI
answering for a seat that is away. Magic's rules only know concession.

## 15–16. Tests

New: `tests/multiplayer.mjs`, 36 tests covering the 25 cases of the brief (numbered the same), plus the deck checks.

Run after the change, all passing: multiplayer 36/36, golden 90 games (0 differ), interactions 218/218, stack 22/22,
abilities 47/47, replacements 15/15, loops 18/18, combos 21/21, mana 21/21, hidden 8 games (0 changed), net 7/7,
replays 10/10, card readings 3,500 (0 changed), element ids, stylesheet lint, type check (0 findings), fuzz 12 games
(0 errors, 0 broken rules). Browser self-test on Commander Table.exe: all 19 checks passed, 50 games with 0 simulator
errors, rules check clean, determinism 6/6, Kingdoms 10/10.

Not run: `tests/servers.mjs` (no endpoint changed), and a live online game with a second device.

## 17. Known limitations

- A concession takes effect at the conceding seat's next decision, then at the next state-based check, not at the
  instant the button is pressed. A seat that is never asked anything again would not leave until it is.
- Kingdoms and team games (Two-Headed Giant, Archenemy) keep the one-at-a-time order for simultaneous losses.
- An eliminated player's command zone is kept so the table can still show who they were.
- A card that entered under one player's control, was then taken by a second with a control effect, and whose second
  controller leaves, goes back to its owner rather than to the first controller.
- No separate end-of-combat step with priority.
- A friend's page drops stale views, but the server keeps whatever arrived last; sends are ordered per seat on the
  host to prevent that, which is not covered by a test.
- The friend's Concede button uses the chat channel, which the server limits to one message a second per seat: a
  concession sent within a second of a chat message is dropped (the button comes back).
- The host's own window shows what it showed before; hidden-information checks cover views sent to other devices and
  the AI, not the host's screen.

## 18. Dependencies on earlier phases

All present in the code: replay exactness (2A, the recorded-answer format now also holds `{ c: seat }`), loops (2B),
replacement effects (2F, used by the commander's hand and library choice), the stack and priority (2G, `g.prio` is
what views now carry), abilities (2I). There is no Phase 2H in the repository's history; nothing here needed one.

## 19. Remaining rules issues in this area

800.4a's "effects that give control end, in timestamp order" is applied as "back to the owner"; 104.3a is not
instant (above); 511 has no priority window; 810.8 team losses are not simultaneous; 903.9a's choice is asked per
commander in seat order rather than as one simultaneous state-based action.
