# Commander Table

A Magic: The Gathering table where AI pilots play Commander (and other formats) against each other or against people.
Plain JavaScript ES modules in the browser, no build step and no npm packages. User docs: `README.md`. Work list and
history of every feature: `ROADMAP.md` (read its "Rules for every session" and the round you are working on).

## Layout

- `public/` — the game. Key modules in `public/js/`:
  - `engine.js` (`Game`: turns, stack, zones, combat, formats), `effects.js` (card text → effects), `rules.js`, `invariants.js` (rules checker used by the self-test)
  - `ai.js` (`Agent`, play styles), `combatai.js`, `combos.js` (Commander Spellbook), `learn.js` (per-deck learning)
  - `main.js` (setup screen and table UI), `ui.js`, `human.js` (human seat prompts), `remote.js` / `net.js` (online seats)
  - `decks.js`, `scryfall.js`, `formats.js`, `limited.js`, `builder.js`, `presets.js` (built-in cEDH decks)
  - `selftest.js` + `selftest.html` — endpoint checks, 50 fast games, a 20-game rules check, 10 Kingdoms games
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

## After each finished change

1. Tick the item in `ROADMAP.md` with a one-line "Done:" note; update `README.md` where users need to know.
2. Bump `VERSION` for user-visible releases.
3. Rebuild the .exe if `launcher/` changed.
4. Run `powershell -ExecutionPolicy Bypass -File make-shareable-zip.ps1` (it refuses to build if personal details are found).
