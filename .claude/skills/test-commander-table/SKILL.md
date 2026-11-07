---
name: test-commander-table
description: Test a change to Commander Table end to end - start the local server, run the self-test page (endpoint checks, 50 fast games, rules check, Kingdoms games) in the browser pane, run extra targeted games, and clean up processes. Use after any change to public/, the servers or the launcher, and before ticking a ROADMAP item.
---

# Testing Commander Table

## 1. Start the server

From the game folder, in the background:

```powershell
Start-Process -FilePath ".\Commander Table.exe" -ArgumentList "--no-window"
```

It serves http://localhost:8777. If the port is busy, an earlier copy is still running: reuse it, or stop it first (step 5).
If `launcher/` changed, rebuild first: `powershell -ExecutionPolicy Bypass -File launcher\build.ps1`.
To test the other servers instead: `py server.py --no-browser --port 8777`, or `start.bat` (server.ps1).
If you changed an endpoint, test it on all three servers.

Never open the game in Microsoft Edge. Use the built-in browser pane.

## 2. Run the self-test

Open http://localhost:8777/selftest.html?run in the browser pane (`?run` starts it automatically). Wait until the
`#summary` element no longer says "Running…" (about 10-30 s), then read the page text.

Pass means:
- the summary says "All N checks passed", and
- "50 games at full speed" reports **0 simulator errors**, and
- "Rules check" says "no rule broken", and
- "Kingdoms" has 8+ of 10 games ending on a role win with 0 errors.

Outside services (Scryfall, EDHTop16, Commander Spellbook, Archidekt) can be down for a while; a failure in only those rows
is not caused by your change. Say so in your report rather than calling it a pass.

## 3. Targeted games for the change

The self-test uses the four built-in cEDH decks. When the change touches specific cards, formats or AI behavior, run
games that exercise it from the browser pane's JavaScript console on http://localhost:8777/ :

```js
const { Game } = await import('/js/engine.js');
const { Agent } = await import('/js/ai.js');
const { loadDeck } = await import('/js/decks.js');
const deck = await loadDeck(`Commander\n1 Kinnan, Bonder Prodigy\nDeck\n...`, () => {});
const g = new Game([0, 1, 2, 3].map(k => ({ playerName: `P${k + 1}`, deckName: deck.deckName, color: '#888',
  agent: new Agent('balanced'), commanders: deck.commanders, cards: deck.cards })),
  { beat: async () => {} },            // full speed
  { seed: 12345, noLearning: true });  // add format: 'standard' etc. for other formats (2 seats)
await g.run();
({ winner: g.winner?.name, round: g.round,
   errors: g.logEntries.filter(e => /Simulator error/.test(e.html)).map(e => e.html) });
```

Use `watchGame(g)` from `/js/invariants.js` before `g.run()` to collect broken-rule findings. Run enough seeds (20+) that
the new card or rule actually fires, and check the log shows it firing. Any "Simulator error" line is a failure.

For UI changes, also click through the affected screen in the browser pane and check `read_console_messages` for errors.

## 4. Report

State what passed, what failed (with the error text), and what you could not test (for example Mac/Linux, the Cloudflare
tunnel, or a server you did not start).

## 5. Clean up

Stop everything you started:

```powershell
Get-Process "Commander Table", cloudflared -ErrorAction SilentlyContinue | Stop-Process -Force
```

Also stop any `py server.py` / PowerShell server you started.
