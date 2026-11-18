# Phase 2O baseline audit and plan (Stage 1–2, before any change)

Version 1.56.0, commit d34b05c, branch replay-exactness. Nothing was changed for this audit (a scratch probe was run and
deleted). Evidence is the test runs listed under each area, all from this session on this PC (Windows 10, Node 26.13.0).

## Baseline

| Area | Status | Evidence | Gaps found |
|---|---|---|---|
| Rules engine (turns, phases, priority) | Verified, with one gap | stack.mjs 22/22 (priority order and passes asserted step by step), multiplayer.mjs 36/36 (turn order, cleanup 514.3a, combat damage steps), golden 96 games unchanged | **Broken (defence in depth):** `Game.cast` / `canCast` accept a sorcery on an opponent's turn and with a spell on the stack (audit probe 200 and a new probe). Not reachable through the person's prompts (main-phase prompt only opens in an empty-stack main phase; response windows filter to instant speed) and the rules watcher saw no AI timing break in 40+12 fuzz games and 50 self-test games, but the engine API itself doesn't refuse it. |
| Card abilities | Partial (measured) | card-coverage.md: 2,804 of 3,500 most-played cards fully read (80.1%), 665 partly, 28 almost unread; interactions.mjs 218/218, abilities.mjs 47/47 | Partly read cards are played without the unread text (reported in the builder and log, never approximated). |
| Stack and priority | Verified | stack.mjs: LIFO, >8 responses, counters, Stifle, sources leaving, mana abilities off the stack, APNAP, SBA before priority | — |
| Combat | Verified for keywords tested | abilities.mjs (flying/reach, first/double strike, deathtouch+trample, evasion, protection), interactions (simultaneous deaths), multiplayer (damage steps), uitest (combat via clicks) | **Untested:** attacking planeswalkers, additional combat phases (only mentioned in multiplayer.mjs), creatures removed from combat. |
| Mana | Verified | mana.mjs 21/21 (Phyrexian, hybrid, two-brid, X), failed payment leaves lands untapped and the card in hand (probe), invariants check the mana paid per cast | — |
| Triggers | Verified | stack.mjs APNAP, loops.mjs 18/18, abilities.mjs enters/dies/leaves/upkeep | Delayed triggers covered only through specific cards (Mana Drain, Arcane Denial). |
| Replacement effects | Verified for tested cards | replacements.mjs 15/15 (Rest in Peace, Dauthi, draws, prevention, enters tapped, tokens; player orders them; replaced events don't trigger) | Leyline of the Void has no card data in the test snapshots (untested). Old combo shortcut (rules ≤10, replays only) moves cards directly, by design. |
| State-based actions | Verified | `Game.sba` is its own pass (not triggers); probe: 0-toughness and lethal damage die in one pass, legend rule; invariants after every SBA pass (life, poison, loyalty, toughness, legend, 704.5n) | — |
| Continuous effects and layers | **Broken (one case) / Partial** | invariants reorder the battlefield to catch order-dependent results | **Broken:** Humility + Glorious Anthem gives Craterhoof 6/6 with haste (want 2/2, no abilities): audit probe 212, AUDIT-ROADMAP item 212. **Untested:** control-changing effects (no test mentions them), text-changing, dependency order. |
| Zones and object identity | Verified | `zones.js move` used by rules 11+ paths; invariants (one zone each, owner, control, tokens leave); carddata test 4 (separate instances) | Direct zone writes remain in the rules ≤10 combo shortcut, setup, mulligans and the companion special action (by design; listed). |
| Commander rules | Verified | multiplayer.mjs (tax, owner's zone choice, commander damage per commander, deck checks); combat-only commander damage (`resolve.js:1975`, `combat && src.isCommander`) | Partner/Background pairs only in deck checks. |
| AI | Verified for legality, partial for strength | ai.mjs 30/30, hidden.mjs (5,653 decisions, 0 changed when hidden cards are scrambled), fuzz/self-test 0 rule breaks | No measured strength gain (Phase 2K). |
| Multiplayer | Verified for authorisation in the host-authoritative design | net.mjs 7/7 (unoffered answers = cancel), multiplayer.mjs (stale answers, revisions, views without hidden cards, concede, drops), per-seat secret join codes (server.py `secrets`) | The host's browser is the authority: a host can edit its own game (accepted design; no server-side rules). Online seats not run in uitest (by design). |
| Card database | Verified | carddata.mjs 30/30 (Phase 2N) | — |
| Replay | Verified | replay.mjs 10/10, self-test determinism 6/6, golden logs | — |
| UI | Verified for the paths tested | uitest.html 17/0 (six screen sizes) | Tested in the built-in browser pane (Chromium) only. |
| Security | No high-severity finding | 221 HTML insertions scanned for unescaped external strings: 0 flagged; card text never run (carddata.mjs 32); CSP header and frame-ancestors 'self' on all three servers; no external scripts in the pages; no keys or credentials in the code; Scryfall data checked (2N) | **Untested:** corrupted saves, storage quota errors and interrupted writes for settings, autosave and the deck library. |
| Performance | Measured, no bottleneck found yet | 6.9 games/s and 3,331 steps/s (self-test), look-ahead 1.14 s per game, fuzz 40 games in 31 s, local search 12–40 ms over 35,000 cards | **Unmeasured:** a large board (e.g. 200 permanents), AI decision time per decision, memory over a long session, DOM work per render. |
| Browser compatibility | Untested outside the pane | Built-in pane (Chromium) | Chrome 157 and Firefox 160 are installed here and can be tested. **Edge: not tested — the project's hard rules forbid launching it.** Safari: not available on Windows. |

Test infrastructure today: 19 Node suites (CI), audit probes (2 open), coverage and diagnostics reports, the self-test
and interface pages, a rules watcher (`invariants.js watchGame`) used by fuzz, self-test and batch games, fixed seeds
everywhere. Missing: a shared report format (test id, feature, rule, expected, actual, files, severity), a recorder of
the event sequence for tests (most tests assert final state plus the log), and saving a failing fuzz game for replay.

## Proposed plan (for approval)

Stage 3 — critical reliability fixes
1. Engine timing (item 200): `canCast`/`cast` refuse sorcery-speed spells outside their controller's main phase with an
   empty stack (flash, "as though it had flash", cast-from-effect modes kept). Behind **rules 20** so older replays play
   as before; golden games unchanged for rules 4–19.
2. Humility + Anthem layers (item 212): the smallest change in the layer order that gets 613 right for ability removal
   and P/T setting before modifications, behind rules 20, with the probe moved into interactions.mjs.

Stage 4 — rules regression tests (new `tests/rules.mjs`, CI)
3. A shared event recorder in scenario.mjs (zone changes, damage, life, stack pushes/resolutions, priority passes, SBA
   passes, triggers) so tests assert the sequence, not just the end state, and a report line per test with id, feature,
   rule number, expected/actual, source files and severity.
4. New tests for the untested areas above: attacking planeswalkers, extra combat, removal from combat, control change
   (Threaten-style, ownership vs control on leaving), continuous-effect expiry at cleanup, delayed triggers, Leyline of
   the Void (fetch its card data), Doubling Season tokens and counters, commander damage noncombat exclusion and per-
   commander tracking, zone change = new object, a failed cast leaving nothing paid, duplicate online answers.
   Any defect found gets the smallest engine fix and a regression test; no card-specific exceptions.
5. Fuzz: on a failure, write the seed, decks, seat setup, answer history, last events and rules version to a file that
   `node tests/fuzz.mjs --replay <file>` replays.
6. Storage: tests for corrupted, missing-field, old-version and quota-failing data in `util.js store`, the autosave, the
   deck library and replay loading; a failed write must keep the last good value.

Stage 5 — performance and compatibility
7. Measure a large board, AI time per decision, a 100-turn game and memory over 50 games; optimise only a measured
   problem without changing outcomes.
8. Run selftest.html and uitest.html in Chrome 157 and Firefox 160 (headless or windowed), and the six viewport sizes.

Stage 6 — documentation
9. `tests/phase-2o-report.md` with the 13 sections asked for, a release checklist, every changed file, all test output,
   the remaining defects by severity, and one release recommendation.

Not planned: rewriting the engine, server-side rules for online play, Edge testing (forbidden by the project rules),
new features.
