# Phase 2L report: interface and gameplay presentation (ROADMAP item 383, version 1.55.0)

The interface was not a prototype when this phase started: the "Grimoire" redesign (item 219, 1.32.0) and 73 design
roadmap items (1.33.0 to 1.52.0) had already given it a token-based design system, a dashboard start menu, a rebuilt
deck builder with charts, a stack panel, combat arrows, a foldable log and keyboard-friendly windows. This phase
audited all of that against the brief and against the engine, fixed what was actually wrong, and added the first test
that drives the real page. No engine or rules code changed (golden games: 96 played, 0 differ). Statuses below:
**Fully implemented**, **Partially implemented**, **Not implemented**, **Not tested**, **Blocked by the engine**.

## 1. UI architecture (audit)

| Question | Answer from the code |
|---|---|
| Structure | One page (`index.html`) with about 30 windows as `.modal` elements; `main.js` drives setup, windows and the game; `dialogs.js` watches every window (focus, Escape, tabs, tooltips, notices). Plain ES modules, no build step. |
| Battlefield rendering | `TableView` (ui.js) builds one board per player once, then `render()` (scheduled on the next frame after each engine `update` event) syncs each zone. `sync()` reuses one element per object (`cards` map) and moves only what changed, so nothing is rebuilt per step. |
| Card display | `cardEl`: the Scryfall small picture (normal on high-density screens), badges for P/T, damage, counters, loyalty, states; tapped, attacking, blocking, summoning-sick classes; a screen-reader label per card. |
| Card images | `scryfall.js` `build()` keeps small, normal, large and art crop; pictures go through the local server's image cache (`/api/img`) for offline play. |
| Actions to engine | `HumanAgent` (human.js) asks through `HumanUI.ask` with the engine's own options: cards (`objs`), players and buttons. A click answers only if the element is one of the offered objects; the engine then acts. The table only redraws from engine state. |
| Targeting | `HumanAgent.candidates` = `resolve.js` `legalTargets` + `targetFits` (protection, hexproof, shroud, the card's words). Offered cards get `.pickable`. |
| Stack | `renderStackPanel`: newest on top, kind, controller, targets, "resolves next", the priority holder and passes (rules 15), waiting triggers. Dotted arrows to targets. |
| Combat | Attack arrows to the defender, dashed lines from blockers, the battle preview panel (the combat simulation's expected result, labelled as expected), marks on attacking and blocking cards. |
| Log and notices | `addLog`: one line per engine log entry with category, seat color, rule links, card names that point at the card, folding per turn, a live region for screen readers; `notice()` toasts. |
| Screen sizes | Breakpoints at 1280, 1150, 900, 600; phones get one column, a log drawer and sideways-scrolling control rows. |
| Animations | Card glides (Web Animations), move copies to the piles, damage and life floats, particle bursts (fx.js), turn banner; calm mode (`body.calm`) and `prefers-reduced-motion` for CSS. |
| Assets | OFL fonts (Cinzel, Inter, JetBrains Mono, licenses beside them), an inline SVG icon sprite, Kingdoms role pictures, Scryfall card images. |

Problems found (each reproduced):

| Problem | Effect |
|---|---|
| A card picture that failed to load showed the browser's broken-image icon (table, stack, preview, battle panel); the manual tabletop's inline `onerror=` handlers were blocked by the page's own security policy | Unreadable cards offline or when Scryfall is busy |
| A transformed double-faced card kept its front's small picture and art | The table showed the wrong face on ordinary screens; the preview showed the back twice |
| The preview needed a mouse | No way to read a card on a touch screen |
| While choosing a target, cards that couldn't be chosen looked like the rest | Choices stood out only by a glow and a small dot |
| Calm mode and reduced motion didn't stop script animations (card glides, move copies, turn banner, smooth scrolling) | Motion kept on for people who asked for less |
| Move copies were removed only when their animation finished, and a hidden window pauses animations | Copies could pile up over the table while the window was hidden |
| At 375 px, Resume and Step sat off-screen in a 1,051 px scrolling row; the stack panel covered the first board | Game controls hard to reach on a phone |
| No test of the interface at all | Every suite tested the engine only |
| Some cards' default printing is a Universes Beyond one with a different printed name (Loran of the Third Path showed as a Star Trek card) | Misleading picture (not fixed: see 19) |

## 2. Files inspected

public/js: ui.js, main.js, human.js, remote.js, net.js, engine.js (flipFace, beat), combat.js, zones.js, resolve.js
(legalTargets, targetFits), triggers.js, ai.js (STYLES), fx.js, dialogs.js, builder.js, scryfall.js, util.js, manual.js,
puzzles.js, selftest.js, windows.js. public: index.html, play.html, selftest.html, css/style.css, fonts, roles.
Servers: server.py, server.ps1, launcher/CommanderTable.cs. tests: scenario.mjs, servers.mjs, selftest_ci.py, ids.mjs,
csslint.mjs. DESIGN-ROADMAP.md.

## 3. Files modified

public/js: ui.js, human.js, main.js, util.js, builder.js, remote.js, manual.js, fx.js, scryfall.js (pictures of a
back face only). public/css/style.css (Grimoire layer 21). New: public/uitest.html, public/js/uitest.js. Servers:
server.py, server.ps1, launcher/CommanderTable.cs (one header value) and the rebuilt Commander Table.exe. tests:
servers.mjs, selftest_ci.py, phase-2l-report.md. Also .github/workflows/selftest.yml, README.md, ROADMAP.md,
DESIGN-ROADMAP.md, CLAUDE.md, the test-commander-table skill, VERSION.

## 4–13. Changes, by area

| Area | Before | After | Status |
|---|---|---|---|
| Design system | Tokens, components, 20 stylesheet layers | Layer 21 adds the fallback face, touch preview, choosing state and phone rules, using only existing tokens (no new color, no new `!important`, no bare z-index) | Fully implemented (already existed) |
| Main menu | Dashboard with 20 working tiles (item 219) | Unchanged; the interface test opens Help and Display from it and closes them with Escape, and fails on a disabled tile with no reason | Fully implemented (already existed) |
| Battlefield | Boards per player, rows by type, piles, command zone, chips | Unchanged layout; the phone stack panel moved to the bottom | Fully implemented (already existed) + phone fix |
| Card pictures | Broken-image icon on failure | The card in words (name, cost, type, P/T) from the card's own data, by one page-wide listener and one per table card; decorative pictures dropped | Fully implemented |
| Double-faced cards | Transformed cards showed the front on the table | The back face's own picture and art; the preview labels "Other face"; adventure, split and modal cards keep their existing pictures | Fully implemented for transform cards; modal and split unchanged |
| Preview | Mouse only | Touch: tap previews (docked), long press previews a pickable card, tap closes | Fully implemented; not tried on a real phone |
| Targeting | Legal targets ringed and glowing | Also: everything not offered is faded and greyed (`body.choosing`, only for questions that ask for particular cards or players, not the turn's open prompt); clicks on anything else were already ignored | Fully implemented; "why a target is not legal" is not explained (see 19) |
| Stack and priority | Panel, arrows, priority chip, "your move" | Unchanged; now tested against the engine | Fully implemented (already existed) |
| Combat | Arrows, marks, battle preview | Unchanged; tested against the engine's attackers and blockers | Fully implemented (already existed) |
| Animations | CSS animations obey calm and reduced motion; script ones didn't | `motionOff()` (fx.js) gates card glides, move copies, bursts, the turn banner and smooth scrolling; move copies go after 1.5 s even when hidden | Fully implemented |
| Log | Engine entries, categories, folding, search | Unchanged; tested that every engine entry appears, in order | Fully implemented (already existed) |
| Deck builder | Search, filters, inspector, stats, checks, draft restore | Unchanged; tested search and draft restore | Fully implemented (already existed) |
| Settings | Display window (theme, card size, preview, calm, less motion, contrast, text size, reader, AI strength on setup) | Unchanged; the test flips Fewer animations through its real switch | Fully implemented (already existed) |
| Accessibility | Dialog roles, focus, tabs, tooltips, labels, marks on cards | Choosing state not by color alone; fallback faces carry an `aria-label` | Partially implemented (open design items 246, 251, 252, 254) |

## 14. Responsive design results

The interface test sizes the frame to 1920×1080, 1600×900, 1366×768, 1280×720, 768×1024 and 375×812 on a puzzle game
with your question open, and checks: no sideways scrolling of the page, Resume and Step fully on screen, every action
bar button on screen, your hand row and life total on screen. All six pass. The four-player check also confirms the
boards don't overlap at 1366×768. Not measured: every window at every size, and text zoomed to 200%.

## 15. Performance

No new per-step work: the fallback costs one listener for the page and one per card element, both idle unless a
picture fails; the choosing state is one body class; motion checks are a class and a media query lookup. `sync()`
already reuses elements. The table's rendering budget for nine players (design item 368) was not profiled. Browser
self-test: 50 games in 7.7 s, 7.1 games a second, look-ahead 1.11 s a game (same range as 1.54.0).

## 16. New assets and licenses

None. No pictures, icons or fonts were added; everything new is CSS and the card's own text.

## 17. Automated tests added

`public/uitest.html` (run it with `?run`; CI runs it on Linux, macOS and Windows against all three servers through
`tests/selftest_ci.py --page uitest.html`). It opens the real game page in a frame (`?uitest`: `main.js` hands over
the live game and view, nothing is recorded, the tour is skipped) and answers only with clicks. The brief's 25
checks map to 18 rows:

| Row | Brief's checks | What it does |
|---|---|---|
| 1 | 1 | Start menu: 20 tiles, Help and Display open from their tiles and close on Escape |
| 3–4 | 3, 4 | Builder: an exact name search shows only cards named Lightning Bolt (a modal card with that face included); add it, close, reopen, "Restore it" brings it back |
| 2 | 2 | Four pasted lists load ("Kenrith · 23 cards") and the game starts with those commanders |
| 7 | 7 | A land in hand moves to the lands row only after the engine has played it |
| 8 | 8 | Tap a Mountain for mana: drawn tapped and turned; click again to take the mana back: drawn untapped |
| 5 | 5 | Preview: title, type line and P/T of the card under the pointer, on screen |
| 6 | 6 | Delver of Secrets: the preview's "Other face" is the back; after Game.flipFace the table shows the back's picture, not the front's |
| 9–10 | 9, 10 | Doom Blade: the offered targets equal `legalTargets` + `targetFits`; Vampire Nighthawk (black) and Gladecover Scout (hexproof) are faded, not offered, and clicking them answers nothing; Cancel clears the state |
| 11–12, 14–15 | 11, 12, 14, 15 | Lightning Bolt held on the stack: panel rows equal the engine's stack (top first, "resolves next", target named), one target arrow, the priority mark matches the engine, "your move" only while asked; after resolution life shows 17 and every engine log line appears in order |
| 20 | 20 | A table card's picture made to fail is replaced by "Grizzly Bears · Creature — Bear · 2/2" |
| 19, 22 | 19, 22 | Fewer animations through its real switch: saved, on the page, no animation runs on a card that moves, the next question is there at once |
| 21 | 21 | Display opened and closed three times: one click changes the setting once; one stack panel, one arrow layer, one preview |
| 13, 16, 23 | 13, 16, 23 | Pyroclasm kills three creatures at once (both sides): the table matches, no copies left; Hill Giant attacks: chosen mark, attacking mark, arrow; the AI's Wall of Omens block shows as blocking; marks go after combat |
| 17 | 17 | Four players: four boards, yours marked, life totals 40/31/32/33, no overlap |
| 18 | 18 | Six screen sizes (section 14) |
| 24 | 24 | Not run: needs a friend's page in a room (tests/net.mjs and tests/multiplayer.mjs cover the views and answers) |
| Results | — | The puzzle's end shows the results window with every seat and the engine's result |
| 23, 25 | 23, 25 | An ordinary four-AI game runs to turn 5; held still, every board, hand, pile, life total and combat mark matches the engine; no simulator errors |

`tests/servers.mjs` also checks the new framing rule.

## 18. Existing tests

All pass: type check (0 findings), card readings (0 changed), element ids, stylesheet lint (no count above the
baseline), golden games (96, 0 differ), interactions 218, stack 22, abilities 47, replacements 15, loops 18, combos 21,
mana 21, multiplayer 36, AI decisions 30, hidden information (5,653 decisions, 0 changed), online seats 7, replays 10,
fuzz 12 games (0 errors). Browser self-test: all 19 checks, 50 games with 0 simulator errors, rules check clean,
determinism 6/6, Kingdoms 10/10. Servers: the .exe and server.ps1 pass all 10 server checks and the interface test
(17 passed, 1 not run on each). server.py was not run here (no Python on this PC); CI runs it.

## 19. Known limitations

- The table's layout, the start menu and the deck builder were not redrawn: they were redesigned in items 219 to 300
  and the audit found them working; this phase changed only what was wrong.
- Targets: the table doesn't say *why* a card can't be chosen (protection, hexproof, color). The engine decides legality
  in one function and returns only the legal list; a reason per card would need a second check beside it, which this
  phase didn't add.
- No targeting lines while choosing (design item 296), no drag-to-block (297), no new results screen (298), no
  printing picker (305): a Universes Beyond printing with a different printed name can still be a card's default
  picture.
- Touch preview was checked with simulated touch events at 375 px, not on a real phone or tablet.
- The engine's results heading says "Draw" when a puzzle ends without a winner; that is the engine's result, shown as is.
- `frame-ancestors` is now `'self'` (was `'none'`) on all three servers so the test page can frame the game; other
  sites still can't.

## 20. Partially implemented

- Accessibility: open design items 246 (a whole turn by keyboard), 251 and 252 (contrast checks and high contrast from
  tokens), 254 (text size without `zoom`).
- Double-faced cards: transform cards fixed; the table has no flip button (304), and modal/split cards show the face
  being cast as before.
- Online seats: not covered by the interface test.

## 21. Dependencies on engine features

None blocked this phase. The stack panel, priority marks and combat marks show what the engine has (rules 15 stack
and priority, Phase 2G; combat, Phase 2E). Priority is only marked while a seat is actually being asked (`g.prio`);
an exchange of AI passes inside one engine step is never drawn, because the engine never pauses in it.
