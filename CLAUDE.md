# Commander Table

A Magic: The Gathering table where AI pilots play Commander (and other formats) against each other or against people.
Plain JavaScript ES modules in the browser, no build step and no npm packages. User docs: `README.md`. Work list and
history of every feature: `ROADMAP.md` (read its "Rules for every session" and the round you are working on).

## Layout

- `public/` — the game. Key modules in `public/js/`:
  - `engine.js` (`Game`: turns, stack, casting, formats) with its sections in `combat.js`, `mana.js`, `resolve.js`, `zones.js`, `triggers.js` (functions taking the game as `g`; Game keeps one-line methods), `effects.js` (card text → effects), `rules.js`, `invariants.js` (rules checker used by the self-test)
  - `ai.js` (`Agent`, play styles), `combatai.js`, `lookahead.js` (main-phase look-ahead on a copied game), `combos.js` (Commander Spellbook), `learn.js` (per-deck learning)
  - `main.js` (setup screen and table UI), `windows.js` (Help, What's new, Storage, images), `cores.js` (games on every core), `prefs.js`, `ui.js`, `human.js` (human seat prompts), `remote.js` / `net.js` (online seats)
  - `decks.js`, `scryfall.js`, `formats.js`, `limited.js`, `builder.js`, `presets.js` (built-in cEDH decks)
  - `selftest.js` + `selftest.html` — endpoint checks, 50 fast games, a 20-game rules check, 6 look-ahead games (replayed), a determinism check (3 seeds replayed in the opposite order), 10 Kingdoms games
- `launcher/CommanderTable.cs` — the `.exe` (window, tray icon, local server). Rebuild with `powershell -ExecutionPolicy Bypass -File launcher\build.ps1`.
- `server.ps1` (start.bat) and `server.py` (Mac/Linux) — the same local server. **When an endpoint changes, change all three servers** (the .exe, server.ps1, server.py).
- `cache/` — bundled Comprehensive Rules. `data/` — private browser profile, deck library, image cache. **Never read for sharing, commit or ship `data/`.**

## Hard rules

- Never use or launch Microsoft Edge.
- Free only: no paid services, sign-ups, analytics or trackers. Never get around a site's bot protection.
- No personal information in any file: no user names, emails, computer names, home paths or IP addresses.
- No shop, currency or paywalls; unlocks are earned by playing.
- Build our own versions: never copy code, art or names from MTG Arena, Moxgate or Forge (Forge is GPL; ideas only).
- Replays must stay exact: anything that changes game outcomes is saved in the game setup/replay.

## Testing

Use the `test-commander-table` project skill (`.claude/skills/test-commander-table/SKILL.md`). In short: run
`Commander Table.exe --no-window`, open http://localhost:8777/selftest.html?run in the browser pane, make sure every check
passes with 0 simulator errors, and stop every `Commander Table` and `cloudflared` process you started.

Card readings: `node tests/cards.mjs` (CI runs it too) compares how the effects parser reads 3,500 saved cards with `tests/card-readings.json`; when a change to effects.js is meant to change readings, accept them with `node tests/cards.mjs --update` (and `--fetch` for a fresh card snapshot).

Golden games: `node tests/golden.mjs` (CI runs it too) plays 18 AI games under rules 4, 5 and 6 and compares results and log hashes with `tests/golden-games.json`. A rules 4 or 5 difference breaks old replays (1.19.0 and earlier): gate new behaviour behind `this.rules >= 6` (or a new RULES version). Accept a deliberate change with `--update`.

Card and interaction tests: `node tests/interactions.mjs [name filter]` (CI runs it too) builds small boards from card names (`tests/scenario.mjs`) and checks one card or interaction each. Every card fix gets a test here. Card data the snapshots lack goes in `tests/interaction-cards.json` via `node tests/fetch-interaction-cards.mjs "Card Name"`.

Fuzz games: `node tests/fuzz.mjs` (CI runs it too; `--games 60 --seed 7000` for more) plays random decks with one seat answering every prompt at random, under the rules watcher.

Replays: `node tests/replay.mjs` (CI runs it too) saves a game as a replay and loads it again after Scryfall data, Commander Spellbook answers and other games have changed, checks the card hashes, and loads a pre-1.24 replay. Replays (format 7, `replaydata.js`) keep their own card data and Spellbook combos; each Game has its own combo book (`opts.spellbook`), never a shared list.

Hidden information: `node tests/hidden.mjs` (CI runs it too) asks every AI decision again with the opponents' hands and libraries scrambled and fails if one changes (an AI must never read hidden cards).

Type check: `node tests/typecheck.mjs` (needs Node.js; CI runs it on every push). The baseline is empty now, and engine.js, effects.js and the engine's section modules must also pass `--strictNullChecks`. It fails on any type error not in
`tests/typecheck-baseline.txt`. Fix new errors rather than adding them to the baseline; after fixing old ones, shrink
the baseline with `node tests/typecheck.mjs --update`.

## After each finished change

1. Tick the item in `ROADMAP.md` with a one-line "Done:" note; update `README.md` where users need to know.
2. Bump `VERSION` for user-visible releases.
3. Rebuild the .exe if `launcher/` changed.
4. Run `powershell -ExecutionPolicy Bypass -File make-shareable-zip.ps1` (it refuses to build if personal details are found).
