# Commander Table

A Magic: The Gathering table where AI pilots play Commander (and other formats) against each other or against people.
Plain JavaScript ES modules in the browser, no build step and no npm packages. User docs: `README.md`. Work list and
history of every feature: `ROADMAP.md` (read its "Rules for every session" and the round you are working on).
Open fix list from the 1.31.0 audit: `AUDIT-ROADMAP.md` (items 197 to 218; `node tests/audit-probes.mjs` reproduces them).

## Layout

- `public/` — the game. Key modules in `public/js/`:
  - `engine.js` (`Game`: turns, stack, casting, formats) with its sections in `combat.js`, `mana.js`, `resolve.js`, `zones.js`, `triggers.js` (functions taking the game as `g`; Game keeps one-line methods), `loops.js` (loops of triggers, rules 10), `comboplay.js` (combos played out with the real cards, rules 11), `replacements.js` (replacement and prevention effects, rules 14), `stack.js` (stack objects and the priority loop, rules 15), `effects.js` (card text → effects), `rules.js`, `invariants.js` (rules checker used by the self-test)
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

Card coverage: `node tests/coverage.mjs --report tests/card-coverage.md` sorts the 3,500 snapshot cards into full, partial, restriction (an unread restriction makes the card stronger than printed), unhandled (the reader produces an effect or field no engine module uses) and unsupported, and writes the report, most-played first. Pick the next card fixes from it.

Golden games: `node tests/golden.mjs` (CI runs it too) plays 18 AI games under rules 4, 5 and 6 and compares results and log hashes with `tests/golden-games.json`. A rules 4 or 5 difference breaks old replays (1.19.0 and earlier): gate new behaviour behind `this.rules >= 6` (or a new RULES version). Accept a deliberate change with `--update`.

Card and interaction tests: `node tests/interactions.mjs [name filter]` (CI runs it too) builds small boards from card names (`tests/scenario.mjs`) and checks one card or interaction each. Every card fix gets a test here. Card data the snapshots lack goes in `tests/interaction-cards.json` via `node tests/fetch-interaction-cards.mjs "Card Name"`.

Fuzz games: `node tests/fuzz.mjs` (CI runs it too; `--games 60 --seed 7000` for more) plays random decks with one seat answering every prompt at random, under the rules watcher.

Replays: `node tests/replay.mjs` (CI runs it too) saves a game as a replay and loads it again after Scryfall data, Commander Spellbook answers and other games have changed, checks the card hashes, and loads a pre-1.24 replay. Replays (format 7, `replaydata.js`) keep their own card data and Spellbook combos; each Game has its own combo book (`opts.spellbook`), never a shared list.

Loops: `node tests/loops.mjs` (CI runs it too) checks the loop watcher (`loops.js`, rules 10): endless mandatory loops are a draw, loops that end by themselves run to the end, "you may" loops are their controller's choice, priority and APNAP order are kept, and a long chain doesn't block the page.

Combos: `node tests/combos.mjs` (CI runs it too) checks that combos are played out with the real cards at rules 11 (life events and triggers, the damage system with prevention and lifelink, real combat with blockers and Fog, mills through `Game.move`), that every built-in and Commander Spellbook combo has a status and a reason (`combos.js` `comboPlay`, `readSpellbook`), and that rules 10 keeps the old combo shortcut for replays. A combo the engine can't play out is marked partial or unsupported, never granted its result.

Mana: `node tests/mana.mjs` (CI runs it too) checks Phyrexian ({B/P}: color or 2 life), hybrid and two-brid ({2/W}: color or {2}) payments at rules 12 with real cards (Dismember, Gitaxian Probe, Phyrexian Metamorph, Kitchen Finks, Spectral Procession, Reaper King): `parseCost` tags the symbols, `mana.js` `planTagged` tries every way of paying before anything is paid, and `Game.withPhyrexianChoice` asks the AI or the person how many symbols to pay with life.

Replacements: `node tests/replacements.mjs` (CI runs it too) checks replacement effects at rules 14 (`replacements.js`): zone changes (Rest in Peace, Dauthi Voidwalker, Blightsteel), draws (Alhammarret's Archive, Notion Thief, Underrealm Lich), prevention (Glacial Chasm), entering tapped (Authority of the Consuls) and tokens (Anointed Procession, Xorn). Self-replacements go first, then the affected player orders the rest (a person is asked where the event is async), each applies once per event, replaced events don't trigger, and unread replacement text is reported once a game, never approximated.

Stack: `node tests/stack.mjs` (CI runs it too) checks the stack and priority at rules 15 (`stack.js`) with scripted priority answers on real cards: who is asked, in what order and with how many passes, what is on the stack at that moment, last in first out, more than eight responses, counterspells (and uncounterable spells, Stifle on abilities and triggers), abilities outliving their source, triggers put on the stack together in APNAP order, targets checked while casting and on resolution, mana abilities off the stack, and state-based actions and triggers before priority after each resolution.

Abilities: `node tests/abilities.mjs` (CI runs it too) checks card abilities at rules 16 with real cards: combat keywords (flying/reach, deathtouch with trample, first and double strike, evasion), protection (Game.protectedFrom: targeting, blocking, damage, Auras and Equipment), hexproof, shroud and ward, prowess on the stack, enters/dies/leaves/upkeep triggers, sacrifice, mana and equip abilities, cost reduction and anthems, replacement effects, mana conditions, Cavern by hand, and the cost keywords (delve, affinity, convoke, kicker, cycling, unearth, escape, flashback, suspend, adventure, regeneration), with rules 15 checks where behaviour changed. Card coverage also lists ability types, keywords and misread cards (MISREAD in coverage.mjs).

Hidden information: `node tests/hidden.mjs` (CI runs it too) asks every AI decision again with the opponents' hands and libraries scrambled and fails if one changes (an AI must never read hidden cards).

Online seats: `node tests/net.mjs` (CI runs it too) drives `RemoteUI.askLive` in `net.js` with a fake room: an answer naming an object, player or button that was not offered is treated as "cancel". Servers: `node tests/servers.mjs http://localhost:8777` (not in CI: it needs a running server) asks one server for its limits and refusals (body limit and 413, path checks, security policy header); run it against each of the three servers after an endpoint change.

Type check: `node tests/typecheck.mjs` (needs Node.js; CI runs it on every push). The baseline is empty now, and engine.js, effects.js and the engine's section modules must also pass `--strictNullChecks`. It fails on any type error not in
`tests/typecheck-baseline.txt`. Fix new errors rather than adding them to the baseline; after fixing old ones, shrink
the baseline with `node tests/typecheck.mjs --update`.

## After each finished change

1. Tick the item in `ROADMAP.md` with a one-line "Done:" note; update `README.md` where users need to know.
2. Bump `VERSION` for user-visible releases.
3. Rebuild the .exe if `launcher/` changed.
4. Run `powershell -ExecutionPolicy Bypass -File make-shareable-zip.ps1` (it refuses to build if personal details are found).
