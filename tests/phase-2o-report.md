# Phase 2O report: quality, rules validation, security and release readiness (ROADMAP item 385, version 1.57.0)

Rules version 20. Built on the baseline audit in `tests/phase-2o-audit.md` (approved before any change). Every number
below comes from a run in this session on this PC (Windows 10, AMD Ryzen 7 3700X, 16 threads, Node 26.13.0) unless it
says otherwise. Statuses: **Verified** (inspected and covered by meaningful passing tests), **Partial**, **Broken**,
**Untested**, **Unsupported**.

## A. Initial audit (summary)

The full table is in `tests/phase-2o-audit.md`. In short: 19 test suites already existed and passed, with a rules
watcher (`invariants.js`) running under fuzz, self-test and batch games; the six named cards already had passing
behaviour tests; commander damage already counted combat damage per commander only. Found: the engine accepted a
sorcery at the wrong time (AUDIT item 200, Broken as defence in depth), Humility was unread (item 212, Broken),
attacking planeswalkers, extra combats, control change, Leyline of the Void, corrupted or full storage, large boards,
AI decision time, memory and other browsers had no evidence (Untested). Security: no unescaped external text found in
221 HTML insertions, no external scripts, no keys, per-seat secret codes and host-side answer checks for online play.

## B. Changes implemented

| File | Why |
|---|---|
| `public/js/mana.js` | `castTimingOk` / `timingRefuses`: casting timing (307.1, 117.1a) kept by the engine at rules 20; `canCast` means "can it be cast now" |
| `public/js/engine.js` | `Game.cast` refuses a mistimed cast unless an effect casts it; `humility` / `humilitySource` (cached per battlefield change) and `abilitiesOff`; Humility in `setLayer` (7b by timestamp), `hasNow`, `abilitiesOf`, `bonus`; RULES 20 |
| `public/js/triggers.js` | a creature with no abilities (Humility) has no triggered abilities: own triggers (`trigger`) and watched ones (`fire`) |
| `public/js/effects.js` | reads "all creatures lose all abilities and have base power and toughness N/N" (`fx.allLoseAbilities`) and Leyline of the Void's replacement in today's wording (`fx.oppGyExile20`) |
| `public/js/replacements.js` | Leyline's replacement used at rules 20 |
| `public/js/ai.js`, `public/js/lookahead.js` | the AI plans with `castMode` (timing-free, as `canCast` was) so its decisions are exactly as at rules 19 |
| `public/js/util.js` | `store()` reports damaged reads and failed writes (`ct-store` event, `storeProblems`), returns true/false on writes, keeps the last saved value; IndexedDB write errors are now heard |
| `public/js/prefs.js` | saved settings that aren't an object are ignored |
| `public/js/replaydata.js`, `public/js/main.js` | `replayShapeProblem` checks a replay file's shape before anything changes; main.js shows one notice per storage problem kind |
| `server.py`, `server.ps1`, `launcher/CommanderTable.cs` (+ rebuilt `Commander Table.exe`) | the deck library writes `<name>.txt.tmp` and swaps it in, so a failed save keeps the last one |
| `tests/scenario.mjs` | event recorder `record(g)`, `inOrder`, `evText` |
| `tests/rules.mjs` (new) | 27 rules tests asserting event sequences, with id, rules, files, severity, expected/actual; `--report tests/rules-report.md` |
| `tests/storage.mjs` (new) | 8 saved-data tests |
| `tests/fuzz.mjs` | a failing game is saved with seed, versions, decks, seats, answers, last log lines; `--replay <file>`; every run replays its first game and compares the log; `--save-all` |
| `tests/servers.mjs` | deck library save/overwrite/delete check |
| `tests/browsers.mjs` (new) | self-test and interface test headless in an installed Chrome or Firefox, Node only |
| `tests/perf.mjs` (new) | large board, AI decision times, 50-game memory |
| `tests/audit-probes.mjs` | the two fixed probes removed (now R03, R22); a Blood Moon + Urborg probe for what remains of item 212 |
| `tests/golden.mjs`, `tests/golden-games.json` | rules 19 kept in the list; 6 rules 20 games added (identical logs to rules 19) |
| `tests/interaction-cards.json` | card data for Leyline of the Void, Act of Treason, Threaten, Kraum, Ambush Viper, Fireball, Relentless Assault |
| `.github/workflows/selftest.yml` | CI runs rules.mjs and storage.mjs |
| `CLAUDE.md`, `README.md`, `ROADMAP.md`, `AUDIT-ROADMAP.md`, the test skill, `VERSION`, `.gitignore` | documentation, item 385, item 200 done, item 212 progress, 1.57.0, fuzz-failures ignored |

## C. Test results

Final run, after the last change (command: each `node tests/<suite>.mjs`, last line shown):

| Suite | Result |
|---|---|
| typecheck | 0 findings (strict null checks: 0) |
| cards | 3,500 cards, 2,807 fully read, 0 changed |
| golden | 102 played, 0 differ, 0 simulator errors |
| fuzz | 12 games, 12 finished, 597 random answers, 0 errors, 0 broken rules; first game replayed: identical |
| hidden | 5,653 decisions, 0 changed |
| interactions | 218/218 |
| replay | 10/10 |
| loops | 18/18 |
| combos 21/21 · mana 21/21 · replacements 15/15 · stack 22/22 · abilities 47/47 · ai 30/30 · net 7/7 · multiplayer 36/36 | all passed |
| ids, csslint | clean |
| carddata | 30/30 |
| **rules (new)** | 27: 26 passed, 1 known deviation, 0 failed |
| **storage (new)** | 8/8 |
| servers.mjs (not CI) | 11/11 on Commander Table.exe, server.py and server.ps1 |
| audit-probes (not CI) | 1 run, 1 failing as expected (Blood Moon + Urborg, item 212) |
| selftest.html | built-in pane (Chrome 156), on the final code: all 19 checks passed (50 games 0 simulator errors, rules check clean, determinism 6/6, Kingdoms 10/10); Chrome 157 and Firefox 160: all 19 passed on the code before the last change (the Humility lookup cache, an engine-only speed fix) |
| uitest.html | Chrome 157 and Firefox 160: 17 passed, 0 failed, 1 not run (online seats, by design), on the code before the last change |

Corrected along the way: one test of mine compared a value with itself (replaced before it ran); one loops test
failed after my Humility change (it rescanned the battlefield per trigger, quadratic in a 6,000-trigger chain; fixed
with a lookup cached per battlefield change, test passes). New tests added: 27 + 8 + 1 (servers) + the fuzz
reproducibility check.

## D. Rules validation

| Area | Status | Evidence |
|---|---|---|
| Casting and costs | Verified (one known deviation) | R01, R02 (no partial payment), R03 (timing, rules 20), R04 (additional costs: paid before the card is on the stack, 601.2a/h order: **known, Low**); mana.mjs (hybrid, Phyrexian, two-brid, X); stack.mjs (targets checked) |
| Stack and priority | Verified | R05 (every object left from the top), R06, R07; stack.mjs 22 (priority order and passes, APNAP, sources leaving) |
| Combat | Verified for the keywords tested | R08 first strike, R09 double strike, R10 trample + deathtouch + lifelink, R11 flying/reach/menace, R12 attacking a planeswalker, R13 extra combat; abilities.mjs |
| State-based actions | Verified | R14 (one pass, nothing on the stack), R15 legend rule, R16 0 life, R24 tokens; invariants after every pass in fuzz and self-test |
| Replacement and prevention | Verified for the cards tested | R17 Rest in Peace (never in the graveyard), R18 Leyline of the Void (new reading), R19 Doubling Season + Anointed Procession; replacements.mjs 15 |
| Continuous effects and layers | **Partial** | R20 expiry at cleanup, R21 control change, R22 Humility (7b by timestamp, ability removal). Not done: timestamp/dependency order for layers 1–7a, Blood Moon + Urborg (probe fails), other static abilities of creatures under Humility, text-changing effects |
| Zones and identity | Verified | R23 (state reset after a zone change; the Aura goes as part of the move, same result as 704.5m), R24; invariants (one zone, owner, control) |
| Turn structure | Verified for the steps tested | R13, R20, R21 run the real combat, main 2 and end steps; multiplayer.mjs (cleanup 514.3a, damage steps) |
| Commander | Verified | R25 tax, R26 damage per commander, noncombat not counted, 21 from one commander; multiplayer.mjs (zone choice, deck checks) |
| Card support | Measured | card-coverage.md (2,807 of 3,500 fully read); R27 unread text reported (Fireball's divided damage) |
| Untested | — | partner/background pairs in play (deck checks only), phasing beyond Teferi's Protection, day/night edge cases |

## E. Security findings

| Finding | Severity | Fix | Remaining risk |
|---|---|---|---|
| Engine accepted a mistimed sorcery (not reachable through the prompts) | Medium | rules 20 timing in `Game.cast` / `canCast` | none known |
| Deck library save truncated before writing: an interrupted save lost the deck | Medium | temp file + replace in all three servers | none known |
| Full or blocked browser storage failed silently | Low | reported once, last value kept | the change that failed is lost (the person is told) |
| Wrong-typed settings used as the settings object | Low | ignored | — |
| Replay file shape checked only partly | Low | `replayShapeProblem` | — |
| External card text in HTML | none found | (221 insertions scanned; card text never run; carddata.mjs 32) | a future `innerHTML` without `esc` would not be caught automatically except by review |
| Online play | none found | (secret per-seat codes, unoffered/stale/repeated answers ignored, views without hidden cards: net.mjs, multiplayer.mjs, hidden.mjs) | the host's own browser is the authority: a host can change its own game (by design, no server-side rules) |
| Dependencies, scripts, keys | none found | no packages, no external scripts, CSP on all servers, no credentials in the code | — |

## F. Performance findings

Conditions as at the top; built-in pane is Chrome 156. `node --expose-gc tests/perf.mjs`:

| Measure | Result |
|---|---|
| Large board, 200 creatures + 2 anthems: one state-based-actions pass | 0.5 ms |
| power, toughness and 2 keywords for all 200 | 1.7 ms |
| AI attack decision on that board | 88.6 ms |
| AI blocks against 40 attackers on that board | **1,018.8 ms** (the slowest thing measured; Low: only on very large boards) |
| Browser: redraw of that board (211 cards, 2,248 DOM nodes) | median 1.7 ms, slowest 7.3 ms; 50 cards tapped and redrawn 1.9 ms |
| AI decisions in 8 four-player cEDH games (3,509 steps, 9.3 s): whole main phase | median 0.3 ms, 95% 8.7 ms, slowest 126 ms |
| attack decisions / blocks / responses | slowest 141 ms / 3.9 ms / 64.5 ms |
| 50 games in a row | 58.9 s; heap 33.4 → 31.2 → 30.7 → 30.8 → 31.4 → 31.4 MB (no growth) |
| 40 fuzz games (seed 7000), before changes | 31 s, 0 errors |
| 6,000-trigger chain (loops.mjs 10) | 2.4 s, the page kept getting ticks (worst gap under 400 ms) |

Optimised only what was shown to be a problem: the Humility lookup I added (cached). The slow block decision on
huge boards was not changed (it would change AI behaviour pinned by the golden games).

## G. Compatibility

| Environment | Result |
|---|---|
| Chrome 157.0.8103.79, headless, Windows 10 (`tests/browsers.mjs`) | self-test 19/19; interface test 17 passed, 0 failed (six screen sizes from 375×812 to 1920×1080 inside the test) |
| Firefox 160.0, headless, Windows 10 | self-test 19/19; interface test 17 passed, 0 failed |
| Built-in browser pane (Chrome 156) | self-test; the large-board render measurement |
| Microsoft Edge | **Not tested**: the project's rules forbid launching it |
| Safari | **Not tested**: not available on Windows |
| Real phones and touch | **Not tested** on a device (only the 375×812 size in the interface test) |
| server.py on Windows (Python 3.13) | servers.mjs 11/11; CI covers Linux and macOS |

## H. Remaining defects

- Critical: none known.
- High: none known.
- Medium: layers below 7b have no timestamp or dependency order (Blood Moon + Urborg gives an Island black mana; item 212). Static abilities of creatures (other than anthems) still apply under Humility.
- Low: additional costs paid before the card is on the stack (R04); the AI's block decision takes about 1 s against 40 attackers on a 200-creature board; a permanent that becomes a copy of Humility without entering isn't noticed until the battlefield next changes; 693 of 3,500 cards have unread text (reported to the player).

## I. Release recommendation

**Ready for public beta.**

Evidence: every automated suite passes (21 Node suites, 102 golden games, 0 simulator errors, 0 broken rules in
fuzz games with every random answer, 0 changed decisions in the hidden-information check), the self-test and the
interface test pass in Chrome 157 and Firefox 160, the rules areas players meet most (casting, stack, combat, state-
based actions, replacement effects, Commander) are verified with event-sequence tests, saved data survives damage and
full storage without losing the last good copy, no security issue above Medium was found and both were fixed, and
memory stays flat over 50 games. The limitations are documented and reported in the game itself (unread card text,
the layer gaps, untested Edge, Safari and phones), which is why this is a beta and not a full release.

## Release checklist

| Item | State |
|---|---|
| Game starts; decks load; games complete; AI games complete | ✔ self-test (50 games), fuzz, golden |
| Legal actions enforced; stack, combat, SBA validated | ✔ rules.mjs, stack.mjs, abilities.mjs, invariants |
| Supported mechanics have regression tests | ✔ interactions, abilities, rules, mana, replacements |
| Multiplayer tested | ✔ net.mjs, multiplayer.mjs (fake room); a live friend's page not driven (uitest "not run") |
| Card database, cache updates, offline | ✔ carddata.mjs, README "Offline play" |
| Deck saves restorable; replays restore; corrupt data doesn't destroy saves | ✔ servers.mjs, replay.mjs, storage.mjs |
| External text safe; data validated; no credentials; hidden info protected | ✔ section E |
| No game-freezing defect known; large board, AI and long play measured; memory inspected | ✔ section F |
| Errors understandable | ✔ storage, replay, Scryfall and deck messages; developer detail stays in the log and tests |
| Desktop layout; mobile size; reduced motion | ✔ interface test sizes and calm mode (Phase 2L); real phone ✘ |
| Docs: limits, setup, tests, release steps, licenses | ✔ README, CLAUDE.md, the test skill, make-shareable-zip.ps1; font licenses beside the fonts |
| Edge, Safari | ✘ not tested (see G) |
