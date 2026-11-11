# Commander Table roadmap

Work list for the overnight build. Each work session takes the next unchecked items in order, builds and tests
them, then ticks them off here with a one-line note. Only free options: no paid services, accounts or certificates.

## Lock

<!-- A session working on the roadmap writes its start time here and clears it when done.
     Another session that finds a lock younger than 3 hours stops without changing anything. -->
LOCK: none

## Rules for every session

- Game folder: the folder this file is in. All code is under `public/` (the game), `launcher/` (the .exe, built by `launcher\build.ps1`) and `server.ps1` (the start.bat server). Keep both servers in step when an endpoint changes.
- Never use Microsoft Edge. Never add paid services, sign-ups, analytics or trackers. Never get around a website's bot protection (Moxfield blocks downloads; use EDHTop16 or the bookmarklet instead).
- Keep the folder free of personal information: no usernames, emails, computer names, home paths or IP addresses in any file. `data/` holds private browser profiles and is never shared.
- Test every change: run `Commander Table.exe --no-window`, open http://localhost:8777 in the browser pane, run games at full speed (create a `Game` with a clock of `{ beat: async () => {} }`) and check for "Simulator error" log lines. Stop every `Commander Table` and `cloudflared` process you started before finishing.
- After each finished item: tick it here with a short note, update README.md where users need to know, rebuild the .exe if `launcher/` changed, and finally run `make-shareable-zip.ps1`.

## Items

### Biggest gaps
- [x] 1. Card coverage for cEDH lists: model Ad Nauseam, Necropotence, Mystic Remora, Opposition Agent, Orcish Bowmasters and the other most-ignored cards in real EDHTop16 lists (use the deck viewer's ignored list on the top meta decks to pick them).
  - Done: Silence effects, Ad Nauseam, Necropotence, Spirit Guides, Smothering Tithe, Esper Sentinel (first spell only), Mindbreak Trap, Swan Song-style counters, clones, Cryptolith Rite, Kinnan, Seedborn, Opposition Agent, uncounterable spells, Walking Ballista. Top-16 meta decks went from 68% to 80% understood. Still ignored: Faerie Mastermind, Underworld Breach, LED, Valley Floodcaller, Redirect Lightning, Brain Freeze.
- [x] 2. Activated abilities at any time: Walking Ballista pings, sacrifice outlets and mana sinks used whenever useful, including in response.
  - Done: abilities in either main phase and at every opponent's end step (keeping counterspell mana), "activate only as a sorcery" respected, Ballista pings (to kill, finish a player, or all at once when it is about to die), sacrifice to a free outlet in response to a board wipe.
- [x] 3. Respond to the trigger that starts a combo loop (Stifle-style answers before the loop begins).
  - Done: the ability that starts a loop goes on the stack; AI casts Stifle-style cards or kills a piece in response, the combo player can fight back with a counterspell, and a human gets the normal response prompt.
- [x] 4. Reconnect for online friends: rejoin a dropped seat with the same link, and show the host when a friend has left.
  - Done: the host polls presence all game; after 12 s without contact the board shows "disconnected · AI playing" and the AI plays the seat; reopening the link rejoins straight away (no name prompt) and the log says they are back.

### Online play
- [x] 5. Join with a short code or a QR code instead of a long link.
  - Done: each seat shows a join code (ROOMCODE-seat) and a QR code; friends open the host address and type the code. The QR generator is built in (public/js/qr.js, no library), checked with an independent decoder for versions 1–10.
- [x] 6. Spectator links: watch without a seat.
  - Done: every room has a spectator link and watch code (-0); a spectators-only room can be opened from the timeline's Spectators button in any game. Spectators see every board but no hands.
- [x] 7. Chat and quick emotes between players.
  - Done: chat box and emote buttons for the host, friends and spectators; messages go in the game log and as speech bubbles on the speaker's board. The server keeps the last 50, at most one a second per seat.
- [x] 8. Record friends' answers so online games can be rewound and saved as replays.
  - Done: friends' answers are recorded like yours. Online games can be rewound (answers are played back, then the friend is asked live again), and saved replays include them; a loaded replay plays those seats back and the AI takes over when the answers run out.
- [x] 9. Friends see the table from their own seat (their board at the bottom), action bar sized for phones.
  - Done: the friend's board sits bottom left with the others clockwise (first on narrow screens); on phones the action bar is pinned to the bottom with large buttons.
- [x] 10. Host setting for decision time (now fixed at 2 minutes).
  - Done: "Time for each decision" (30 s to 10 min) in the invite window, saved with your preferences.

### AI
- [x] 11. Read opponents: estimate likely counterspells from open mana and cards held.
  - Done: counterOdds per opponent from public info only (blue identity, hand size, open mana, counters already shown, cEDH free counters); drives combo baiting/Silence and makes big spells less attractive into likely counters.
- [x] 12. Plan two turns ahead for combos (tutor now, win next turn).
  - Done: tutors prefer the combo next turn's mana can pay for; rituals are held while a ready combo is short on mana.
- [x] 13. Per-deck memory that learns from batch results which plays win.
  - Done: public/js/learn.js records every finished game (normal, batch, tournament) per commander pair; after 5 games, cards seen in wins get a casting bonus of up to ±2. The table is frozen into each game's setup and saved replays, so replays stay exact. Deck viewer shows what it learned, with a Forget button.
- [x] 14. Explain-the-play mode: the log says why each AI decision was made.
  - Done: "Explain" switch in the top bar; 🧠 lines for casts (with the runner-up options), combos, counters, tutors, attacks and deals. Kept out of friends' and spectators' views because it can reveal hands.
- [x] 15. Smarter politics: deals that trade resources, not just truces.
  - Done: gang-up deals against the archenemy (partners focus attacks on them), tribute (the losing player gives a card for peace), and no-counter pacts for combo decks; breaking a term breaks the deal with the usual grudge. Human players see the terms when asked.

### Brackets and cEDH data
- [x] 16. Show Commander Spellbook's bracket estimate next to ours.
  - Done: free estimate-bracket API; a dashed chip (Exhibition/Core/Oddball/Powerful/Spicy/Ruthless) next to our bracket, plus a warning naming any card banned in Commander. This found Mana Crypt, Dockside Extortionist and Karakas in the built-in cEDH presets; they were swapped for legal cards.
- [x] 17. Bracket-matched table: one click seats four random decks in the same bracket.
  - Done: "Deal a matched table" uses the table bracket (3 if none is chosen), replaces all four decks and loads them.
- [x] 18. EDHTop16 filters in the meta browser: time period, minimum event size, color identity.
  - Done: period (month to all time, or since the last ban), 16+ to 128+ players, exact color identity checkboxes; "Seat the top 4" uses the same filters.
- [x] 19. Cache EDHTop16 and Decklist Database data so the meta browser works offline after one load.
  - Done: answers (commander lists, decklists, Decklist Database) are saved in the browser profile (150 newest) and used when the site can't be reached; the status line says when a saved copy is shown. Card data for those decks is item 23.
- [x] 20. cEDH statistics from batch runs: average win turn, interaction rate, how often each combo landed.
  - Done: batch report gets "Game speed and interaction" (average and median win round, share of wins by round 4, interaction spells per game) and a combo table (attempts, landed, won the game).

### Decks
- [x] 21. Deck editor: add or remove cards and re-test straight away.
  - Done: "Edit" on each loaded seat opens the list with a live card count and Scryfall name autocomplete; "Apply to seat" reloads it, "Apply and test 10 games" also runs a batch, "Save to library" stores it.
- [x] 22. More imports: Deckstats, ManaBox, Aetherhub and MTG Arena exports.
  - Done: pasted MTG Arena exports (About/Name, sections, set codes), Deckstats text ("# !Commander"), ManaBox CSV and Aetherhub's Arena/MTGO exports. Deckstats and Aetherhub links can't be read (both sit behind a Cloudflare bot check, which we don't get around), so their links explain how to export and paste. Set + collector numbers that point at a different card now fall back to the card name.
- [x] 23. Offline mode: keep card data and images after the first load.
  - Done: card data in the browser's IndexedDB (refreshed after 30 days when online); images through the local server's /api/img, saved in data\images (400 MB cap). A service worker was tried first, but the browser pane refuses them, so the server does it (works in every browser, and in both servers). Friends' pages still load images from Scryfall.
- [x] 24. Local deck library saved inside the game folder (data/), so it travels with the folder.
  - Done: /api/library in both servers (data\decks\*.txt, write calls need a custom header so other websites can't change it); "Deck library…" on the setup screen lists, filters, seats and deletes saved decks.

### Visuals and usability
- [x] 25. Stack panel listing everything waiting to resolve.
  - Done: top-right panel on the table while anything is on the stack: newest first, controller color, targets, countered marks, and how many triggers are waiting.
- [x] 26. Animated damage numbers on creatures; draw, discard and dies animations.
  - Done: red damage numbers float off creatures; draws slide from the library count to the hand; dying, exiled and discarded cards fly to the graveyard or exile count (skipped at top speed, while fast-forwarding, and in "Fewer animations").
- [x] 27. Choose the board background: felt, wood, stone, or commander art.
  - Done: Display window: faint or bold commander art, felt, wood, stone, plain (CSS only, light and dark versions).
- [x] 28. Color-blind-friendly player colors and an accessibility mode with bigger text.
  - Done: Display window: Okabe–Ito seat colors plus seat-number badges, larger text and cards, fewer animations. Applies to a game in progress.
- [x] 29. Log filters: combat only, spells only, or one seat.
  - Done: filter by spells, combat, removal, combos, politics/chat or AI explanations, and by player (any line naming that player); turn headers always stay.
- [x] 30. Personal history page with results from every game played.
  - Done: "History" button: every finished game (not batch runs or loaded replays), your win rate when you played a seat, which decks win most, and the last 200 games. Kept in the browser profile (500 games), with a Clear button.

### Packaging
- [x] 31. Update button that pulls a new version of the game files without touching data/ (free source only, for example a GitHub release URL the user sets; never automatic).
  - Done: "Updates…" on the setup screen: paste an https .zip address (a GitHub release download, for example), "Download and check" shows its VERSION and file count, "Install" asks first, copies everything except data\, backs up each replaced file to data\update\backup-<time>, and renames the running .exe to .old (deleted on the next start). In the .exe, server.ps1 and server.py. New VERSION file (1.1.0).
- [x] 32. Mac and Linux host version: a small cross-platform server with the same endpoints (Python standard library only), plus start scripts.
  - Done: server.py (Python 3.8+, standard library only) with every endpoint, including online seats on 8800–8820 and the Cloudflare tunnel (downloads the right cloudflared for Mac/Linux on first use); opens Chrome, Firefox, Brave, Vivaldi, Chromium or Safari, never Edge. start.sh and "Start Commander Table.command" (macOS). Tested here on Windows with Python 3.13: all endpoints, a full game, and the update installer.

## Round 2 (asked for 2026-10-29: "yes 1-23", free options only)

### Rules accuracy
- [x] 33. Model the cards real cEDH lists still lose to being ignored: Underworld Breach, Lion's Eye Diamond, Brain Freeze, Faerie Mastermind, Valley Floodcaller, Redirect Lightning, and the Breach + LED + Brain Freeze win.
  - Done: escape from the graveyard while Breach is out (mana cost + exile 3, Breach sacrificed at end step), LED (3 mana of one color, discards the hand, only used with ≤1 other card in hand), mill effects and storm copies, Faerie Mastermind's second-draw trigger, flash grants, Redirect Lightning / Deflecting Swat (AI turns removal and burn around), additional life costs. 40-game stress test with extra copies: every card fired, no errors.
- [x] 34. Mana abilities at instant speed: pay for responses and run Dramatic Reversal-style loops with mana from untapped rocks and creatures.
  - Done: responses already paid from untapped sources; added untap effects (Dramatic Reversal, Snap, Frantic Search, Voltaic Key, "untap target …"), valued by the mana they give back when there's something left to cast. 30 games: 74 untaps, no errors.
- [x] 35. Control Magic effects end properly: a stolen permanent goes back when the aura or effect leaves.
  - Done: control from an aura or "for as long as" effect (Sower of Temptation) ends when the source leaves; the permanent returns to whoever it was taken from (or its owner). Tested with Control Magic and Sower.
- [x] 36. Rhystic Study-style taxes are a choice: the AI decides by what's at stake, and a human seat is asked.
  - Done: taxes are now decided when the trigger resolves (as in the rules). AI weighs the gift (cards, Treasures, archenemy) against what the mana would do (combo cost, best castable spell, counterspell mana on others' turns); human seats get Pay / Don't pay / Let the AI decide. 30 games: about half paid.
- [x] 37. Run more Commander Spellbook results: infinite ETB, storm, untap, landfall and similar loops become wins when the deck has a payoff.
  - Done: wider mana matching ("near-infinite", "mana permanents you control can produce"), and a payoff table: ETB/LTB/death loops + Blood Artist or Impact Tremors, storm + Brain Freeze/Grapeshot/Tendrils/Aetherflux, self-mill/draw + Thassa's Oracle/Lab Man/Jace, magecraft, lifegain and landfall payoffs. Checked with a stubbed Spellbook answer and real decks.

### AI
- [x] 38. Smarter blocking: chump only against lethal or commander-damage threats; double blocks to kill big attackers.
  - Done: double blocks when two creatures together kill an attacker worth more than what it can take down (not against first strike, double strike or indestructible); chumps only when the damage is lethal or leaves us dead to the next player's board, or a commander nears 21 (18 for defensive pilots). 40 casual games: 39 double blocks, no errors.
- [x] 39. Mulligan toward the deck's plan: keep hands with combo or engine pieces, not just lands and colors.
  - Done: planScore (combo pieces, near-complete combos with the command zone, tutors, card engines, an early castable plan commander) keeps one-landers with fast mana and a strong plan, keeps plan-heavy 2–4 landers, and sends combo decks' no-plan hands back; mulligan bottoms keep pieces, tutors and fast mana.
- [x] 40. Each deck learns its best play style from batch results and uses it automatically (Auto style).
  - Done: learn.js records wins per style; after 12 games, a style with 4+ games and a win rate 8 points over the deck's average becomes Auto's choice (games and batches). Deck viewer shows the per-style record. 50-game test picked styles for 3 of 4 presets.
- [x] 41. Hold interaction for the opponent whose combo is closest to going off.
  - Done: comboCloseness from public cards only (battlefield, command zone, graveyard); the last counterspell is held for a closer opponent, and the last instant removal isn't spent at end of turn on non-combo targets while someone is halfway there. 50 games: 18 holds, no errors.

### Playing
- [x] 42. Hotseat mode: two or more people on one PC, with hands hidden between their decisions.
  - Done: any number of seats can be "You play this seat"; before a different seat's decision every hand is hidden behind a "Pass to <name>" screen, then only that seat's hand shows. Shares the action bar, undo and replays. Tested with two seats.
- [x] 43. Draft or sealed pods: packs from a real set (Scryfall), build a deck, play it against AI decks from the same pool.
  - Done: public/js/limited.js and "Draft / Sealed…": any set code (Commander Legends sets suggested); packs of 1 rare/mythic, 1 legendary, 3 uncommons, 9 commons; sealed (6 packs each) or a 4-player, 3-pack draft with AI drafters that stay in colors; 40-card decks (commander + chosen cards + basics by pips), auto-build, and the 3 AI decks seated. Tested sealed (CMR, loaded and played) and a full 42-pick draft (CLB).
- [x] 44. Puzzle and challenge mode: set up a board, "win this turn" puzzles, save and share boards as files.
  - Done: public/js/puzzles.js; the engine can start from a given board and play one turn from main phase 1 (win or "Puzzle failed"); three built-in puzzles (burn math, getting through a wall, Heliod + Ballista); "Save board as puzzle" on the timeline and "Load a puzzle file…". Solved the burn puzzle by clicking as a person; the AI solved the other two. Found and fixed: every non-Control-Magic aura logged "has no legal target"; two round-1 log lines had lost their names and numbers.
- [x] 45. Undo for online seats: the host can take back a friend's last decision when they ask.
  - Done: "Undo my last decision" on the friend page; the host gets Allow / No on the timeline; allowing rebuilds the game without that answer (and anything anyone answered after it, tracked in answer order) and the friend is asked again. In the .exe, server.py and server.ps1. Fixed a race where a replaced game cleared the friend's new question.

### Online
- [x] 46. Online seats and internet play from start.bat (server.ps1), like the .exe and server.py.
  - Done: rooms, chat, spectators, undo requests and the Cloudflare tunnel in server.ps1; friends connect to a TCP listener on 8800–8820 (no admin rights needed), polled inside the server's loop. Tested a friend seat end to end (questions, chat) through server.ps1. The tunnel code mirrors the .exe (signed cloudflared, killed with the server) but wasn't started in this test.
- [x] 47. Lobby before the game: friends join first and choose their own deck (paste a list or pick from the host's library).
  - Done: "Open lobby…" opens the room before loading; friends see a lobby page (paste a list, or pick a deck from the host's library) and can change it until the host starts; the host's seat shows what they chose. New "deck" room call in all three servers. Tested: friend pasted a list, the host loaded it and the game started with it.
- [x] 48. Table talk: propose deals to AI players and friends from the chat.
  - Done: "🤝 Deal" in the chat box (host playing a seat, friends): pick a player and a deal kind; it's put to them at the start of the next turn (never in the middle of someone's decision). AI players judge it as usual, people get the normal accept/decline question. Tested from the host and a friend (one accepted, one declined). Deals offered from the chat aren't part of replays.

### Decks and data
- [x] 49. Compare a deck with the EDHTop16 lists for the same commander: cards most lists play that yours doesn't, and cards nobody else plays.
  - Done: "Compare with recent EDHTop16 lists" in the deck viewer reads up to 10 recent top-16 lists (cached for offline) and shows cards at least half of them play that you don't (with the share), and your cards none of them play. Tested on the Kinnan preset: 10 lists, 58 suggestions, 10 unique cards.
- [x] 50. Budget-style random decks: options like "no Reserved List", "commons and uncommons only" (Scryfall search, no prices).
  - Done: "Random decks" on the setup screen: any cards, no Reserved List (-is:reserved), or commons and uncommons with an uncommon creature commander (Pauper Commander style). Applies to empty seats and "random". Tested both.
- [x] 51. Matchup grid: every deck in the library against the others, with a win-rate table.
  - Done: "Matchup grid" in the deck library: up to 8 decks (the filtered list), 2/4/10 head-to-head games per pairing with seats alternating, a colored win-rate table and overall column; stoppable; results also teach the decks (learn.js). Tested with three temporary library decks (removed afterwards).

### Polish and packaging
- [x] 52. Mac and Linux check: a self-check in server.py and start.sh (Python version, ports, write access) with clear messages; real Mac/Linux testing isn't possible on this PC, so note what is untested.
  - Done: `python3 server.py --check` (or `sh start.sh --check`) reports Python version, game files, data folder write access, free game and friend ports, a non-Edge browser (Mac app folders, Linux commands, Windows paths), cloudflared, and internet, each with a fix; start.sh refuses to run outside the game folder. Ran on Windows with Python 3.13 (all ok). Still untested on a real Mac or Linux machine: the browser detection there and the .command double-click.
- [x] 53. Self-test page: one click runs 50 fast games and checks every server endpoint, with a pass/fail report.
  - Done: public/selftest.html ("Self-test" on the setup screen): game files, rules, deck proxy (refusal and a real site), EDHTop16, image cache, library (including refused unauthorised writes), updates, room service, Scryfall, Commander Spellbook, the four presets, and 50 games. Read-only. All 13 checks passed here (50 games in 2.1 s, no errors).
- [x] 54. First-run tour: a short guided overlay of seats, brackets, batch and online play, shown once and reopenable.
  - Done: public/js/tour.js: 8 steps spotlighting the controls (seats, brackets, quick tables, start, batch, friends, more ways to play, display); shown on the first visit, remembered when finished or skipped, "Tour" reopens it; boxes stay on screen; only one tour at a time. The setup buttons now wrap in rows instead of one long column.
- [x] 55. Shareable replay viewer: export a single HTML file that plays a saved game back with no install.
  - Done: "Share as web page" on the timeline re-simulates the game from its seed and recorded answers (yours, hotseat and friends'), records a compact frame per step, and saves one standalone .html with its own player (play/pause, step, slider, speed, keyboard, log). Tested: 191 log lines identical to the live game, 390 frames, 357 KB.

## Round 3 (asked for 2026-11-04: features MTG Arena and Moxgate have that we don't; no shop)

Picked from MTG Arena's and Moxgate's public pages (Moxgate's home page and FAQ; Arena's known feature set), compared
against this README and the code (engine.js starts every player at 40 life, decks.js drops sideboards, there is no
trigger ordering). Rules for this round, on top of the ones above:
- Build our own versions. Never copy code, art, sounds, names or layouts from MTG Arena (its files are compiled and
  its terms forbid taking them apart) or from Moxgate (its rules engine is Forge, GPL; ideas only, as in item 38).
- **No shop**: no store, currency, packs for sale, wildcards, paywalls or anything bought. Unlocks are earned by playing.
- Everything stays offline-capable, account-free and inside the game folder.

### Formats beyond Commander
- [x] 56. Format setting on the setup screen, with rules per format: starting life, deck size, singleton or 4 copies, commander yes or no, commander damage threshold, seat count. Move the hard-coded 40 life (engine.js) and Commander rules into a format table. Keep Commander the default and replays exact (format saved in the replay).
  - Done: public/js/formats.js (FORMATS table + checkDeck for size, copies, sideboard, Scryfall legality). Game takes opts.format/firstPlayer; life, commander damage and the free mulligan come from it; two-player games skip the first draw (103.8a). Setup: Format select, seats follow the format (2 or 4), each format keeps its own deck sources (ct.sources), Commander-only buttons hidden. Replays (version 3) save format and firstPlayer; old replays load as Commander, and the random first-player draw stays after mulligans so they still play out the same. Self-test 13/13, 20 more Commander games, no errors.
- [x] 57. 1v1 constructed: Standard, Pioneer, Modern, Legacy, Pauper and Premodern. 60 cards, 20 life, 2 seats, legality from Scryfall's `legalities`, a warning (not a block) for illegal cards. AI pilots tuned for 20 life and two players (no politics, no archenemy).
  - Done: scryfall.js randomConstructed (1–2 colors, 9 cards ×4 along a curve, 24 lands with duals, 15-card sideboard); decks.js loadConstructed for the same sites and pastes; AI life thresholds scale with g.startLife (unchanged at 40, so Commander play is identical); politics already switch off below three players. Batch, matchup grid and tournaments (pods of 2) use the format. 20 Standard + 20 Pauper + 6 each Pioneer/Modern/Legacy/Premodern games, no errors. Not done: per-deck learning for decks without a commander (learn.js is keyed by commander).
- [x] 58. Best of three with sideboarding: keep the sideboard when a list is imported (decks.js currently skips it), play-or-draw choice for the loser, a sideboard screen between games for the human seat, and simple AI sideboarding (bring in answers to what it lost to).
  - Done: sideboards kept from "Sideboard" headings, SB: lines, MTGO trailing blocks, Archidekt and Moxfield. public/js/match.js: revealedCards, profile and aiSideboard (swaps against what the opponent showed, never the list). main.js: Match select, match score on the results, Next game / New match, the loser chooses (AI goes first, a human gets Go first / Draw first), sideboard window (click to move a copy, AI sideboard, Undo changes, 60-card minimum). A game counts once (rewinds and Watch replay don't add results). Tested: AI vs AI 2–0 with AI swaps, and a human seat through the sideboard window into game 2. Online friends keep their deck between games (no sideboard window on the friend page yet).
- [x] 59. More multiplayer formats: Brawl (60 cards, 25 life), Pauper Commander (common deck, uncommon commander, 30 life, 16 commander damage), and Oathbreaker (planeswalker + Signature Spell in the command zone, 20 life).
  - Done: formats.js entries with cmdRule and commanderOk (Brawl: legendary creature or planeswalker; PDH: uncommon creature, judged by rule since Scryfall lists uncommons as not legal; Oathbreaker: planeswalker + instant/sorcery). Engine marks o.oathbreaker / o.signature; castModeRaw refuses a signature spell from the command zone without its oathbreaker, and it returns to the command zone like a commander (tax included). scryfall.js randomVariant builds random decks (no two-card combos). Brackets, cEDH and EDHTop16 stay Commander-only. 6 four-player games each, no errors; signature spell checked before and after its oathbreaker lands.
- [x] 60. Limited in 1v1: after a draft or sealed pod, play best-of-three 40-card matches with 20 life, not only the Commander-style pod.
  - Done: Limited format (40 cards, 20 life, the pool as sideboard, Bo3). limited.js buildLimited (best two colors, 23 spells, on-color nonbasics) and limitedText (Deck + basics + Sideboard). Draft / Sealed has "One on one, best of three" (default) or "Commander pod"; one on one picks colors instead of a commander, and seats the strongest AI drafter's deck. Empty Limited seats get randomSealed (six packs of a recent set). Tested: a cube draft seated and played 2–1 with AI sideboarding from the pool.
- [x] 61. Cube draft: import a cube from CubeCobra's public list export or a pasted list, save several cubes in `data\`, and draft them like a set.
  - Done: cubecobra.com added to the deck proxy allowlist in all three servers (the .exe rebuilt); /cube/api/cubelist/<id> is read through /api/fetch. Cubes saved in the browser profile (ct.cubes, inside data\ when run from the .exe), with Delete. cubePacker deals 15-card packs from the shuffled cube without repeats; runDraft and sealedPools take a pack function. Tested: LSVCube (516 cards) saved, 45-pick draft, match played. server.py tested for the CubeCobra fetch; server.ps1 has the same allowlist line but wasn't run.

### Ladder and progression (no shop)
- [x] 62. Ranked ladder against the AI: an offline rating per format (Elo or Glicko), tiers with divisions, placement games, and a season reset you start yourself. Kept in the browser profile, shown in History.
  - Done: public/js/progress.js (ct.ladder): Elo per format, AI pilots rated by bracket in Commander (1200–1800) and 1500 elsewhere, multiplayer scored pairwise by place (shared), 5 placement games at K 64 then 32, Bronze–Diamond with III/II/I and Mythic at 1900, new season = halfway back to 1500. "Ranked" switch on the setup screen; setup.ranked needs one human seat and no friends; undo, rewinding, Reveal hands and Explain are locked until the game is recorded (setup.progressed). Results show the change; Progress → Ladder and History show the table. Tested: 5 ranked Standard games (placement into Gold II), new season.
- [x] 63. Rivals gallery: named AI decks with a strength tier badge and a live record of how often you've beaten each one, built from the presets, EDHTop16 lists and library decks.
  - Done: Progress → Rivals: cEDH presets, library decks, EDHTop16 top 8 (cached offline) and "Faced before" decks (ct.rivals, your record by deck key). Tier S/A/B/C from mastery (win rate × table size, after 5 games). Play seats the rival in the first AI seat and switches format; a seat keeps the rival tag only while its source is unchanged. Tested: record 3–2 against a faced deck, Play switched Standard → Commander and seated Kinnan.
- [x] 64. Daily and weekly challenges that are only for fun ("win with a green deck", "cast 20 spells"), with a streak counter. Rewards are cosmetic unlocks only (item 66), never currency.
  - Done: 15 daily templates (3 a day) and 6 weekly (2 a week), picked from the date; counted, distinct and summed kinds; streak = days in a row with a daily done. Rewards are badges only (12 badges: challenges, streaks, ladder ranks, mastery), shown in Progress → Badges; item 66 can hang avatars and card backs on the same unlocks. Tested: two dailies completed, streak 1, "First Steps".
- [x] 65. Deck mastery: each deck levels up as it plays, showing games, wins, its best cards and its level on the seat. Uses learn.js data where it can.
  - Done: learn.js mastery() (10 points a game, 15 a win, level n at 25·(n−1)², max 20; best cards by casts in wins), "Lv" chip on the seat picture, a bar and best cards in the deck viewer. learn.js learnAs gives decks without a commander a key (format: name #fingerprint), so 1v1 and Limited decks now learn too (engine p.learnAs). MAX_DECKS 60 → 200. Commander games unchanged: self-test 50 games identical to before (10.3 rounds, 51 combos).

### Look and feel
- [x] 66. Our own avatars and card backs: a set of generated (SVG/CSS) avatars and card-back patterns per seat, unlocked by playing (item 64), picked in Display. All original art, nothing from Arena.
  - Done: public/js/cosmetics.js: 12 SVG avatars and 9 CSS card backs, unlocked by badges, games played (25/50) or mastery 10; pickers in Display (locked ones say how). The avatar shows on seats you play (p.avatar, ui.js buildBoard); the back is --card-back on every .back and the library pile.
- [x] 67. Priority stops: per-step stop toggles for the human seat (a stop rail beside the phase readout) and a "Full control" switch that stops at every priority point, alongside today's "only ask when I can cast something".
  - Done: ⏸ Stops window (upkeep, draw, beginning of combat, end step × your turn / opponents', Full control). engine.stopFor(step) at those points calls agent.stopAt (people only); Full control also opens respond/combat/end windows with nothing to play. Stops are fixed per game (setup.stopOpts) and saved in replays (version 4) so answers line up. Built as a window rather than a rail beside the phase readout.
- [x] 68. Choose the order of your own triggers when several go on the stack at once, with an "Auto order" button.
  - Done: flushTriggers asks the controller (orderTriggersAsync) for a group of 2–8 of their triggers waiting together; "Order them for me" keeps the order. On by default, off in Stops; replays from before this version play without it.
- [x] 69. Take back mana taps: click a tapped source again to untap it and remove its mana from the pool, as long as the mana hasn't been spent and the step hasn't moved on.
  - Done: tapForMana records o.manualTap (turn, step, the pool entries); canUntapForMana/untapForMana; not for sources that left the battlefield, discarded a hand or set off a tapped trigger. Offered in the main phase and every response window.
- [x] 70. Loop shortcut for human seats: after you play the same sequence twice, offer "repeat N times" (up to 99), checking every pass and stopping as soon as a pass would play out differently. Mandatory loops nobody can stop end in a draw (rule 104.4b) instead of hitting the 600-trigger cap.
  - Done: HumanAgent records main-phase abilities and mana taps; a block of 1–6 actions repeated twice offers ×10 / ×99; repeatLoop checks each action and logs "repeated the loop k of n times (stopped: …)". Covers abilities and mana taps, not spells. Engine keeps the last 60 trigger signatures; at the 600 cap a period-1–6 pattern is a draw (104.4b), otherwise the old skip. Self-test games unchanged.
- [x] 71. Turn clock for online tables: Off, Relaxed or Tournament time banks per seat, shown on each board, with a "Nudge" button for the host. Builds on item 10's decision timer.
  - Done: net.js TURN_CLOCKS and RemoteUI bank/refill/bankLeft/nudge; banks refill at the start of the friend's turn; an empty bank hands the seat to the AI until their next turn. Host boards show ⏱ and Nudge (1 s refresh); the friend page shows banks on boards, "time bank m:ss" in the action bar, and a beep, flash and note on a nudge. No strike or seat removal. Tested with a friend tab: bank counting down on both pages, nudge received.
- [x] 72. Translations: the interface in a few languages (start with Spanish, French, German, Portuguese), and card names and images in that language where Scryfall has them.
  - Done: public/js/i18n.js: about 190 interface strings and 9 patterns in es/fr/de/pt, applied to text, titles, placeholders and data-labels as they appear (MutationObserver; the log, card text and card names in pickers are skipped). Display → Language reloads the page; the friend page follows the browser. Card previews fetch the printed name and image in the language from Scryfall (the name most regular printings use), cached in ct.i18nCards2. Keyboard shortcuts now use data markers, not English labels. Not translated: longer help paragraphs, the game log, the self-test page.

### Learning and solo modes
- [x] 73. Learn to play: a guided first game for people new to Magic. Scripted boards that teach lands and mana, casting, combat, the stack and the command zone one step at a time, with hints in the action bar. Builds on the puzzle engine (item 44).
  - Done: public/js/tutorial.js: 7 one-turn lessons (mana, attacking, blockers, removal, combat tricks, the command zone, a final exam) with a coach panel (#coach) instead of action-bar hints. Puzzles gained a format (Limited for most lessons, no commander needed) and a check function for goals other than winning (tested when the turn ends). Results offer Next / Try again; "Try again" replays the same board (also fixes Rematch after any puzzle, which started a normal game). Tested: the AI clears lessons 1–6; lesson 1 played by clicking like a person.
- [x] 74. Roguelike campaign: an original solo run of map nodes (duels, elite rivals, events, rest stops, a final boss) where you add cards to a starting deck between fights. A loss ends the run, with Easy/Normal/Hard. Rewards are cards for that run only; no shop node. Our own theme, names and rules, not Moxgate's Conquest.
  - Done: public/js/campaign.js "Expedition": 3 acts × (4 two-road steps + boss), duel/elite/event/rest/boss nodes, starting deck of 16 commons and uncommons from 4 packs of a chosen set, rival decks from 3/6/8 packs (+1 per act), pick-one-of-three rewards (rares from elites and bosses), four events, rest stops; Easy (+5 life, loose rivals, one forgiven loss per act) / Normal / Hard (rivals +4 life, full strength). Saved in ct.expedition. Engine opts.lifeBonus; newGame opts.customSeats and opts.after (results buttons, no rematch). Tested: 6 simulated fights through act 2 with rewards and a forgiven loss, plus a rest stop, a fight and a reward through the window.
- [x] 75. Story mode: short chapters of themed AI fights with a line of story text between them and special starting boards (built on puzzles and item 74's node system).
  - Done: public/js/story.js "The Lantern Road": 4 original chapters, each a full game (puzzle fullGame: no mulligans, opening hands dealt) from a special board. Balanced by AI-vs-AI runs from your seat to 50–80% wins (Road 9/12, Bell 6/12, Ossuary 13/16, Crown 7/12). Chapters unlock in order. Built on puzzles, not on item 74's nodes.
- [x] 76. Manual tabletop mode: a "Casual" table where nothing is automated. Players move cards, tap, add counters and change life by hand (house rules, cards the engine can't read yet). Works with online seats.
  - Done: public/js/manual.js (Tabletop state, apply, view, renderTabletop, shared by host and friend pages). Friends' moves go through the room's answer channel as numbered moves, applied once and acknowledged in the state (acks), so no server changes. Host can't move friends' cards; friends see their own hand only. Fixed on the way: an earlier, stopped game kept pushing its snapshots to the room. Tested: host moves, a friend tab's three quick moves. No AI at the tabletop; the table isn't saved.

### Sharing
- [x] 77. Challenge links: a link or code that sets up a table (format, decks, seats, brackets) in one click, for sharing a matchup with a friend or posting a puzzle. Nothing stored online; everything is in the link.
  - Done: public/js/challenge.js: JSON, deflate-raw (CompressionStream) and URL-safe base64; #challenge= on load, or paste the code in the window. Loaded seats are checked (known styles, brackets 1–5, names cut to 24). Decks that were pasted travel as their list, links as links. A challenge can carry a puzzle ({ puzzle }), but there's no button to make one from a board yet. Tested: a round trip with a pasted list, opened from the address bar.
- [x] 78. Full-screen deck builder: search all cards (Scryfall syntax), filter by color, type, mana value and format legality, drag cards in and out, and see the mana curve update live. Replaces the line-by-line editor for new decks; the old editor stays for quick edits.
  - Done: public/js/builder.js: Scryfall search plus filters (colors, type, mana value, format legality and Pauper rarity), More results, click or drag to add, drag back or − to remove, ★ commander, SB sideboard, live count, curve and type counts, copy limits marked; Put in seat / Save to library / Copy as text. "Deck builder" on the setup screen and "Builder" on each loaded seat. Tested: a Standard search, adding cards, Put in seat.

## Round 4 (asked for 2026-11-07: open data and ideas from open-source MTG projects)

Rules for this round, on top of the ones above:
- Data sources must be free and need no account: MTGJSON (free, open license), Scryfall bulk data, 17Lands public
  datasets (only if their usage guidelines allow it; credit them in README). Download only when the user asks or at the
  same daily check as new sets, cache in `data\`, and keep everything working offline from the cache.
- Forge and XMage are GPL: read for ideas only, never copy scripts or code (as in items 38 and 56).
- Every item keeps replays exact: data that changes picks or play is frozen into the game or draft setup.
- Since 2026-11-07 the project is in git (GitHub) with a self-test on every push (.github/workflows/selftest.yml):
  commit each finished item separately; a release is a VERSION bump plus a `v<version>` tag (.github/workflows/release.yml).

### Limited
- [x] 79. Real booster contents from MTGJSON: read the set's booster sheets (`booster` in MTGJSON's set file) so packs
  match the set (slots, rarity rates, foils as normal cards, special guests and bonus sheets), instead of the fixed
  1 rare/mythic + 1 legendary + 3 uncommons + 9 commons. Keep the fixed layout as the fallback for sets without
  sheets and for cubes. Cache set files in `data\mtgjson\`.
  - Done: public/js/boosters.js. MTGJSON allows browser requests (CORS), so the page fetches the set file itself
    (no server change) and keeps only names, weights and colors in the browser profile (ct.boosters.<SET>, 30 days,
    used offline), not the raw file in data\mtgjson. Play booster, then draft, then default (never collector);
    weighted layouts and sheets, no repeats within a sheet, color balance for balanceColors sheets; foils as normal
    cards; basics and other sets' cards (Special Guests) left out; CON_ handled. Sheet names Scryfall's booster list
    lacks are fetched by name. Commander pods swap a common for a legend when a pack has none. Used by Draft / Sealed
    and random Limited seats (the Expedition keeps its own packs). Tested: 200 packs each of BLB (13 cards),
    CMR (20, two legends) and CON (14); a 4-seat BLB draft into two 40-card decks, 6 games, 0 errors; a CMR pod
    sealed in the window (120 cards, 12 commanders); random sealed; self-test 15/15.
- [x] 80. Smarter AI drafters from 17Lands ratings: per-set card ratings (GIH WR / ALSA) where 17Lands has the set,
  blended with today's heuristics (color commitment, curve); fall back to today's picks elsewhere. Show "AI pick
  ratings: 17Lands" in the draft window. Check and respect 17Lands' data usage guidelines first; skip the item if
  they don't allow it.
  - Done: 17Lands' terms of service forbid reusing site/API content (their card_ratings pages), but the public
    datasets are CC BY 4.0. tools/ratings_17lands.py streams a set's public game data (PremierDraft, first 150,000
    games, stops downloading there) and writes public/data/ratings/<SET>.json (GIH WR and games per card, average,
    source and license). Built for BLB, DSK, FDN, MKM, WOE, DMU, MOM (~14 KB each). limited.js loadRatings and
    pickScore: s = 0.6 × heuristics + 0.4 × (2.5 + (GIH WR − set average) × 50), only for cards with no unread text
    (RATING_OPTS). Tuning, rated vs plain seat-0 decks over 96 BLB+FDN games: every rated card at weight 0.7
    lost 12–36 (people win with cards the engine doesn't read yet); readOnly 0.7 56–40; readOnly 0.4 59–37.
    No ALSA (would need the 200–350 MB draft files). Credit in README and in the draft window.

### Card coverage
- [x] 81. Scryfall bulk data ("Oracle Cards" file, once a day when asked) for random decks, the builder and the card
  scan, instead of many search calls; falls back to the API when there's no bulk file.
  - Done (1.17.0): public/js/bulk.js. Off until "Download the card file" in Updates; data.scryfall.io allows browser
    requests, so the page fetches the JSON Lines .gz itself (25 MB, unpacked with DecompressionStream; no server
    change), keeps only the fields normalize() and searches read, and saves 35,769 cards in IndexedDB "ct-bulk"
    (2,000 per record; meta in localStorage ct.bulk). Download + save 14 s; load 0.4 s. dailyBulk at startup refetches
    only when Scryfall's updated_at changed, at most once a day. sf() answers /cards/search and /cards/random locally
    with a small parser for the syntax the game uses (legal, game, is:commander/digital/gamechanger/reserved, t, o,
    id, c, r, cmc/mv, produces, bare names, "or", parentheses, "-"; order name/edhrec/cmc; 175-card pages with
    next_page); anything else (e:, is:booster, unique=prints…) still goes to Scryfall. fetchCollection takes {name}
    identifiers from the file (full name, then front face, then other faces). Checked against Scryfall: edhrec order
    identical in the top 30 for six of the game's queries; totals 1–8% lower (one printing per card, so rarity and
    game:paper see only that printing). Random Commander deck 2 s → 0.1 s with 0 Scryfall calls (brackets 1–4, Brawl,
    Pauper Commander, Oathbreaker, pauper budget, Modern). Self-test row "Local card search" (7 searches on made-up
    cards). The card scan in item 82 used the API; it can now use the same sf() call.
- [x] 82. Coverage pass using Forge's and XMage's card lists as a checklist (ideas only): rerun the scan of the 3,500
  most-played Commander cards, take the most common unread lines, and model them. Target: 81% → 88% fully read.
  - Done (1.17.0): scan rerun (Scryfall `legal:commander game:paper`, EDHREC order, first 3,500): fully read 80.8%
    (2,829) → 88.0% (3,080); 251 cards newly read, none lost. The unread lines turned out to be almost all one-of-a-kind
    (598 of the 671 unread cards missed by a single line), so the work was ~150 small families rather than a few big
    ones; the scan itself was the checklist (no Forge/XMage lists needed). Parser bugs fixed along the way: unread
    "whenever…" lines no longer stop later rules from reading the line, ability words with digits/punctuation, "if …
    would … instead" replacements, 3-letter names (Zur, Ral, Uro). Tested: self-test 15/15 (0 simulator errors, no rule
    broken), 44 games with decks of the 251 new cards (0 errors; 207 appeared, 189 logged an effect), 12 games focused on
    the new mechanics (foretell, plot, impending, encore, copies, Kaalia, devour… all fired), 12 rules-watched games.

### AI
- [x] 83. Look-ahead for main-phase decisions: for the top 3 candidate plays, simulate the rest of the turn and the
  opponents' next combat on a cloned game (like combatai.js does for combat) and pick by the result. Time-boxed per
  decision so fast games stay fast; tuned head to head against today's pilots with the matchup grid.
  - Done (1.17.0): public/js/lookahead.js. cloneGame deep-copies the game (card definitions shared; agents become plain
    AI pilots without look-ahead; log and handlers dropped) and hides what the pilot can't know: every library is
    shuffled and opponents' hands are redealt from their unseen cards, with a random stream forked from the game seed
    (no Math.random). Candidates: the usual pick, the next two by score, and "stop here" (cast the rest after combat /
    hold it). Each copy plays the candidate, the rest of the main phase, the rest of the turn (Game.endSteps split out of
    restOfTurn) and each opponent's next combat; positionScore = own life (log), board (keyValue), lands and cards minus
    the opponents' (0.6 average + 0.4 strongest). An alternative replaces the usual pick only if it scores 1.5 better
    and doesn't just reorder the same plays. Budget: 3 decisions per turn, 400 engine beats per copy (steps, not ms,
    so it's deterministic). Pilot option `new Agent(style, { lookahead })`; setup checkbox "AI look-ahead" (on),
    saved per seat in the setup and replay files (older replays: off); casual pilots (noise > 0.05) and Kingdoms,
    puzzles never look ahead; batch, grid and tournaments don't use it. Head to head, seats alternating, same seeds
    (look-ahead wins–usual wins): 1v1 Standard, 6 random decks, Auto: with "stop here" 425–375, 424–376 (+ opponents'
    whole turns), 426–374 (2 samples), 422–378 (margin 4), together 53%; without "stop here" 509–491, 408–392 (no
    better than chance). Commander, 6 random bracket-3 decks, Auto (2 of 4 seats): 113–87 (56.5%). Four cEDH presets,
    cEDH style: 60–60. Speed: Standard 60 → 211 ms a game, cEDH presets 0.42 → 1.46 s, random Commander 0.24 → 1.5 s
    with every seat looking ahead (about 20–30 ms per decision). Self-test: new "AI look-ahead" row (6 games replayed
    exactly, 2 untouched when nothing changes, rules watched).

### Developer tooling
- [x] 84. Type-check the big modules with `// @ts-check` and JSDoc (engine.js, effects.js, ai.js first) using the
  TypeScript compiler in CI only (no build step for players); fix what it finds.
  - Done, as a ratchet instead of per-file `// @ts-check`: jsconfig.json checks all of public/js (checkJs, not
    strict); tests/typecheck.mjs runs TypeScript 5.6.3 through npx and fails only on findings missing from
    tests/typecheck-baseline.txt (file + code + message, no line numbers; a multiset, so a second copy of a known
    error still fails). CI job "typecheck" in selftest.yml. First run: 320 findings; typing the `$` id helpers as
    `any` removed 187; one real slip fixed (effects.js described `attackMeCap` twice in one object, the first entry
    was dead). The other 132 are kept as the baseline: nearly all are properties added to objects and classes after
    they're made (setup.humans, Game.trigSig, HumanUI.onRecord…) and HumanAgent's async overrides of Agent's
    methods; none looked like a bug. Checked: a planted typo (`(1).lenght`) fails the check. Shrink the baseline
    as code is touched (declare the properties in constructors, JSDoc the overrides).

## Round 5 (asked for 2026-11-08: "find the next 100 improvements")

Picked from the gaps the session notes above leave open (X in activated costs, unread card families, Kingdoms roles not
done, the friend page without a sideboard window, untested Mac/Linux and tabletop paths, 124 type-check findings), a
grep of the engine for missing mechanics (no morph, adventure, MDFC lands, initiative, dungeons, day/night, mutate,
Web Workers or APNAP trigger order), and the size of main.js (2,700 lines) and engine.js (4,600). Rules for this round,
on top of the ones above:
- Items within a section can be taken in any order; sections don't depend on each other unless an item says so.
- Anything that changes game outcomes bumps the replay version and keeps older replays playing as before.
- Free, open data only; read each site's terms before adding it (as in items 22 and 80). Card text and images come
  from Scryfall like every other card; all art, names and wording for modes are our own.

### Rules engine and card coverage
- [x] 85. X in activated ability costs ("{X}, {T}: …"): read X in parseCostText, the AI picks X by value, a human seat
  gets a number prompt. The biggest missing engine piece in item 82's notes.
  - Done: the cost and effects were already read, but every X was played as 0. Game.maxAbilityX and activate(p, o, ab,
    { x }) pay X, the stack item and its effects carry it (g.xNow while targets are chosen); AI bestAbilityX values
    X = 1…20 (effects with that X, less 0.15 a mana) and keeps counterspell mana; human seats pick X from buttons.
    New engine RULES = 5 (Game opts.rules, saved in setup and replays; replays without it play as rules 4 with X = 0).
    Tested: 30 games with Crypt Rats, Cinder Elemental and Kessig Wolf Run (116 activations with X, 0 errors, no rule
    broken); self-test. Not done: "spend only black mana on X".
- [x] 86. Face-down cards: morph, megamorph, disguise, manifest, manifest dread and cloak as 2/2 face-down permanents,
  turning face up as a special action; hidden from opponents on the table, in friends' snapshots and in replays shared
  as web pages.
  - Done: effects.js reads "morph/megamorph/disguise {cost}" (fx.morph), "when ~ is turned face up" (fx.turnedUp) and
    manifest / manifest dread / cloak effects. engine.js: makeFaceDown swaps the object's card and fx for a nameless
    colorless 2/2 (ward {2} for disguise and cloak) and keeps the real ones in o.faceCard/o.faceFx; cast face down
    for {3} at sorcery speed (castMode alt 'morph', also for disguise lands); turnFaceUp as a special action
    (morph cost, or a manifested/cloaked creature's mana cost; megamorph counter; turned-face-up trigger); revealed
    when it leaves the battlefield or the stack (708.9); Cryptic Coat attaches to the card it cloaked. AI casts face
    down when the real cost is out of reach and turns cards up by value; human seats get "Face down ({3})" and can
    turn cards up in main phases and every response window. The table and the friend page show a card back (its
    controller sees the name). Shared web-page replays only carry names, so they show "Face-down creature".
    Tested: 12 + 8 games with a morph/manifest deck (17 face-down casts, 23 turned up, megamorph, triggers, cloak,
    manifest dread, 0 errors, no rule broken) and 3 games with a scripted human seat (5 cast face down, 3 turned up).
- [x] 87. Adventures and modal double-faced cards: cast the adventure, then the creature from exile; play an MDFC's back
  face as a land (the AI counts those as lands for mulligans and land drops).
  - Done: scryfall.js normalize keeps the second face of adventure, modal_dfc and split cards (card.altFace, with
    its own fx) and card.layout. engine.js useFace/mainFace swap the card's face on the stack and battlefield
    (restored as it leaves, via baseCard); faceCastMode/castFace cast the other face from hand; an adventure
    resolves into exile and the creature may be cast from there (715.4); playLand plays an MDFC's land back.
    AI: scores the other face against the front (adventures get 60% of the creature's value on top), plays a land
    back only with no other land in hand (and under 6 lands or the front uncastable), counts land backs in
    mulligans. Human seats choose the face when they click such a card. Tested: 18 games with 20 adventure/MDFC
    cards (30 adventures, creatures cast from exile, 7 land backs played, 0 errors, no rule broken) and 3 games with
    a scripted human seat. Card names still show as "Front // Back" (Scryfall's name).
- [x] 88. Finish "aura or creature" cards: bestow end to end, mutate (merged stack with every ability), reconfigure.
  - Done: bestow wasn't read at all. effects.js reads bestow/mutate costs, "whenever this creature mutates" and
    reconfigure (as an equip cost). Bestow: cast as an Aura for its bestow cost (castMode alt 'bestow'), becomes an
    enchantment creature again when the creature leaves or the target is gone (702.103e). Mutate: targets a non-Human
    creature you own; on resolution the card merges on top (the permanent takes its name and P/T and every card's
    abilities; mutate triggers fire); when the merged permanent leaves, every card goes to the same zone (a commander
    still goes to the command zone); an illegal target makes it a plain creature. Reconfigure: equipping stops it being a
    creature (equipment on it falls off) until it's unattached. Cast log says "bestowed on X", "to mutate onto X",
    "face down". AI scores bestow and mutate against a plain cast; human seats pick from the card's play options.
    Not done: "unattach" with reconfigure, choosing to put a mutating card underneath. Tested: 30 games with a
    bestow/mutate/reconfigure deck (10 bestowed, 46 mutates, reconfigures, 0 errors, no rule broken after the fixes).
- [x] 89. Madness (finish), cleave, meld, split cards with fuse, and aftermath.
  - Done: madness and cleave are read as costs. Madness: a discarded madness card is exiled and a "madness" trigger
    lets its owner cast it for the madness cost (AI if it scores, human seats are asked), else it goes to the
    graveyard. Cleave: analyzeCard reads the card twice (with and without the [bracketed] words; fx.cleaveSpell), cast
    with alt 'cleave'. Split cards (via item 87's altFace): either half from hand; fuse casts both halves for both
    costs (canFuse); aftermath halves only from the graveyard, exiled afterwards. Cast log names the mode. AI weighs
    cleave and fuse against the plain half; human seats see them in the card's play options. Not done: meld (needs
    both cards together; left for the coverage pass). Tested: 16 + 12 games with a madness/cleave/split deck (175
    casts in the new modes, 0 errors, no rule broken), and set boards for madness, cleave, fuse and a split half.
- [ ] 90. Layers (rule 613) with timestamps for copy, control, text, type, color, ability and P/T effects instead of
  today's fixed order; an invariants check that the result doesn't depend on the order effects were added.
  - Done, partly (the part that changed results): layer 7b now goes by timestamp. Every permanent gets o.ts as it
    enters the battlefield and every animation (animPT) gets one too; Game.setLayer picks the latest of the animation
    and auras that set P/T (Kenrith's Transformation, Lignify), where before an animation always won (rules 4 keeps
    that). Layers 1–6 stay as they were: the engine works out copy, control, type and abilities on the spot rather than
    as a list of effects, so there was no order to get wrong. New rules check (invariants.js layerOrderIssues, after
    every state-based-actions pass): each creature's power, toughness and 11 keywords must come out the same with
    every battlefield reversed. Tested: 16 games with an anthem/P-T-setting/keyword-granting deck (no order-dependent
    result found), a set board (aura, then animation, then a later aura), self-test rules check.
- [x] 91. Several replacement or prevention effects on one event: the affected player chooses the order (616.1); human
  seats are asked.
  - Done: counter, damage and life-gain modifiers were applied in battlefield order (Hardened Scales + Doubling
    Season gave 3 or 4 counters depending on which came first). Game.replaceInOrder tries every order (up to 6
    effects) and uses the best one for the affected player: most counters on their permanent, most life gained, least
    damage taken (Torbran, damage doublers, Dictate of the Twin Gods, Gisela's halving). Human seats aren't asked:
    every choice here is about an amount, so their best order is used. Rules 4 replays keep battlefield order.
    Zone-change replacements (Rest in Peace, God-Eternals, commanders) are item 96. Tested: set boards both ways
    round (4 counters either way; 3 damage through Torbran + Dictate into Gisela → 4), 8 games, 0 errors.
- [x] 92. Triggers from several players at once go on the stack in APNAP order (603.3b), each player ordering their own
  (extends item 68).
  - Done: flushTriggers (rules 5) sorts triggers that have just triggered so the active player's go on the stack
    first and the last player's in turn order resolve first, and puts them above triggers still waiting from before
    (so a trigger's own triggers resolve before older ones, as on a real stack). Each player still orders their own
    (item 68). Self-test: 17/17, 0 errors, rules check clean (57 combos landed instead of 50: trigger order changes
    some games, as expected).
- [x] 93. Combat choices for human seats: damage assignment among several blockers, trample with deathtouch, and
  dividing damage from "divided as you choose" spells.
  - Done: an attacker blocked by several creatures, or with trample, has its damage divided by its controller
    (agent.assignCombatDamage, checked by Game.validDamagePlan: it must add up, and trample damage reaches the player
    only once every blocker has lethal, 1 with deathtouch). The AI kills the most valuable blockers it can and pushes
    lethal through with trample; human seats click blockers and amounts, or "Assign it for me". "Divided as you
    choose" spells and abilities (Arc Lightning, Forked Bolt, Inferno Titan…) now split their damage (fx.divided =
    most targets): the AI kills what it can and sends the rest to a player; people pick targets and amounts. The split
    is chosen as it resolves, not when cast. Tested: 16 games (31 divided splits, 0 errors, no rule broken) and a set
    board (6/6 trampler into three blockers; an illegal split refused).
- [x] 94. Initiative and dungeons (venture into the dungeon, Undercity), and day/night (daybound/nightbound).
  - Done: public/js/dungeons.js has the four dungeons as room maps; each room's ability is read by parseEffects
    (Twisted Caverns' "can't attack" isn't read and does nothing). Game.venture (choose a dungeon, then a room below;
    the room's ability triggers; a finished dungeon is completed on the next venture), Game.takeInitiative (ventures
    into Undercity, again at each of the holder's upkeeps; combat damage to the holder takes it; a holder who left
    passes it to the active player). Day/night: daybound/nightbound read as keywords; the first such permanent makes
    it day, and at each turn's start it turns night if the last active player cast no spells, day if they cast two
    or more, transforming the werewolves; at night they enter transformed. AI picks rooms by value, Lost Mine of
    Phandelver first (the Mad Mage late); human seats choose. Board chips: 🏰 room, ⚑ Initiative, ☀/☾.
    Not done: "if you've completed a dungeon" conditions. Tested: 12 games with a venture/initiative/werewolf deck
    (539 ventures, 85 dungeons completed, 84 initiative changes, 12 nights and days, 0 errors) + 8 rules-watched.
- [x] 95. Companions: the companion line is read but the card is never used. Put it into hand for {3} as a special
  action and check the deck-building condition when the deck loads (a warning in formats.js).
  - Done: decks.js keeps the companion (a "Companion" heading in pasted lists, Moxfield's companions board,
    Archidekt's Companion category, or a companion in a 60-card sideboard) as deck.companion, outside the deck; saved
    deck text (replays, challenge links) writes a Companion section. The game keeps it outside (zone 'outside') and
    Game.useCompanion puts it into hand for {3} at sorcery speed, once (702.139c). formats.js companionCheck warns
    when the condition isn't met (Lurrus, Obosh, Gyruda, Keruga, Kaheera, Jegantha, Umori, Lutri, Yorion) and when
    it's outside the commander's colors. AI pays when the card scores (more with a small hand); human seats get a
    "Companion: … to hand ({3})" button; boards show 🐾 and the companion's name. Tested: a Commander and a Modern
    list with Lurrus (both warnings right; 30 + 20 games with the companion put into hand, 0 errors).
- [x] 96. Commander zone choice: when a commander would go to the graveyard, exile, hand or library the owner chooses
  (903.9; the AI usually moves it, a human seat is asked). Check partner, Friends forever, Choose a Background and
  Doctor's companion pairings at load.
  - Done: (rules 5) a commander put into a graveyard or exile now really goes there (so "dies" and "put into a
    graveyard" triggers see it) and its owner chooses at the next state-based check (Game.commanderChoices, 903.9a);
    to a hand or library it's a replacement decided at once (903.9b). The AI leaves it in the graveyard only when it can
    recast or reanimate it this turn (Kess, Muldrotha-style permission, a reanimation spell in hand); human seats are
    asked for graveyard and exile. The rules check accepts a commander its owner chose to leave. formats.js checks two
    commanders are a legal pair (partner, partner with each other, friends forever, background, Doctor's companion)
    and at most two. Tested: 12 cEDH-preset games (commanders returning, 0 errors, no rule broken); a Kinnan +
    Thrasios list is flagged, the four presets aren't.
- [ ] 97. Coverage pass 2: rerun the 3,500-card scan and model the most common families still unread (Sundial, Scroll
  Rack, Chain Veil, "becomes a copy … with mana value X", Planar Bridge and the like). Target 88% → 93%.
  - Progress (not ticked: the target isn't met): rescan 2026-11-08 after items 85–96: 88.2% (3,086 of 3,500).
    The 414 unread cards have almost no families left (the biggest: paradigm ×3, soulbond ×2, "prepared" ×2);
    each needs its own rule. Done here: Scroll Rack (swaps up to three weak cards for the top of the library),
    "remove N <kind> counters" costs now use the engine's named counters (Khalni Heart Expedition works end to end),
    "and sacrifice it" costs, manlands with X or hyphenated types (Lair of the Hydra, Mishra's Factory's first line),
    Hooded Hydra. Now 88.3% (3,090), none lost. Next candidates: Sundial of the Infinite (end the turn), paradigm,
    disturb, casualty, graveyard returns with non-mana costs (Metalwork Colossus, Jarad), counter abilities on
    permanents (Glen Elendra, Siren Stormtamer).
- [ ] 98. Coverage for 60-card and Limited play: scan the cards the random constructed and Limited generators pick
  most, and the seven rated 17Lands sets. Target 90% fully read, so item 80's rated drafters can trust more cards.
  - Progress (not ticked: the target isn't met): scan of every booster card in BLB, DSK, FDN, MKM, WOE, DMU and
    MOM (1,840 cards): 74.6% fully read (FDN 90%, MKM and DSK about 67%). Added the families that cover several
    cards: enlist (11 cards), read ahead (10), "kicker A and/or B", "if ~ was kicked, it enters with N counters",
    freezing auras, +N/−N on itself, two keywords for a target creature, "owner puts it on top or bottom of their
    library", suspect. Now 76.4% (1,405), none lost. Biggest families left: collect evidence (6), Season "pawprint"
    modes (5), expend, royal role tokens, "when ~ dies, put its counters on…". Tested: 16 + 16 Limited games (tuck,
    enlist, suspect fire; 0 errors, no rule broken).
- [x] 99. Sagas, Classes, Battles (Sieges, with the protector chosen by the caster) and Rooms checked end to end with
  a puzzle each; fix what they show.
  - Done: Sagas and Classes already worked (39 chapters, 103 level-ups in the test). Battles were missing: cards keep
    Scryfall's defense; a battle enters with defense counters and its controller picks a protector (the AI: the
    opponent with the least to block with); combat can now attack a permanent (decl.obj, o.attackingObj: blockers are
    the protector's, unblocked and trample damage removes defense counters); with no counters left it goes to the
    graveyard (704.5v) and a Siege is exiled and cast transformed for free. The AI sends attackers already going at
    the protector at its own Siege when they can finish it. Rooms: either door can be cast (item 87), the other is
    unlocked for its cost at sorcery speed (Game.unlockRoom; both doors' abilities then apply, "when you unlock this
    door" triggers), relocked when it leaves; AI and human seats unlock. Board badge ⛨ shows defense. Tested with set
    games instead of shipped puzzles: 24 games with Rooms, Sieges, Sagas and Classes (18 unlocks, 8 Sieges flipped,
    0 errors, no rule broken). Human seats can attack battles from the attack prompt (added with item 105).
- [ ] 100. Rules check timing: invariants.js also checks sorcery-speed casts (own main phase, empty stack), land drops
  per turn, mana spent against cost, and that an AI decision never reads hidden information (cards it can't see).
  - Done, partly: watchGame now wraps Game.cast and Game.playLand: a player's own cast of a spell without flash
    (or flash granted, or a combat-only timing) must happen in their main phase with an empty stack, a land play too,
    and no player plays more lands than their land drops ("timing" and "land" findings; casts that effects make with
    a given mode — cascade, rebound, madness, Sieges — are left out). Tested: a planted off-turn sorcery and land are
    both caught; 16 cEDH-preset, 16 mixed and 10 extra-land-drop games found nothing; self-test rules check clean.
    Not done: mana spent against cost (payments go through one planner already), and an automatic
    hidden-information check (a read of ai.js found its hand reads are of the deciding player's own hand; the
    look-ahead copy already redeals opponents' hands; a checker that proves it in every decision isn't built).

### AI
- [ ] 101. Look-ahead for instant-speed decisions: counter or not, removal in response, end-of-turn plays, on the same
  copied game and step budget as item 83.
  - Done, partly (counter or not; rules 5): lookahead.js lookAheadRespond. When a look-ahead pilot could counter a
    spell, both answers are played on a copy of the game (the counterspell with everyone's chance to fight back, or
    the spell resolving: cast again for free on the copy while that pilot lets it through), then the rest of the
    active player's turn and each opponent's next combat; the other answer wins only by item 83's margin. Combo
    pieces are always countered; counter wars and abilities keep the usual answer. It shares the decisions-a-turn
    budget. Head to head with the cEDH decks, look-ahead pilots with it against look-ahead pilots without: 23–17 over
    40 games (about 6 counter-or-not decisions a game, a quarter of them changed; 0 errors, no rule broken). Rules-5
    golden games re-recorded (2 of 6 changed), rules 4 identical. tools/tune.mjs now prints look-ahead counts. Not
    done: removal in response and end-of-turn plays.
- [x] 102. Look-ahead for multiplayer attacks and blocks: whole-turn rollouts merged with combatai.js's simulation;
  tuned with the matchup grid in Commander pods.
  - Done for attacks (rules 5): lookahead.js lookAheadAttacks. A look-ahead pilot's attack from the combat planner is
    checked against no attack and an all-in attack on the opponent with the least life: each is played on a copy of
    the game (that combat, the second main phase, the end step), then every opponent plays a whole turn; the
    planner's attack stays unless another wins by item 83's margin. Blocks keep the block search (item 105 already
    added walker-aware blocks; a block look-ahead would need the attacker's turn to be resumable mid-combat). Head to
    head in four-player creature pods (tools/tune.mjs, four 60-card decks), look-ahead pilots with it against
    look-ahead pilots without: 22–18 over 40 games; with the cEDH decks 5–5 over 10. 0 errors, no rule broken.
- [x] 103. Adaptive look-ahead budget: more steps in 1v1 and late game, fewer in four-player cEDH. Still counted in
  steps, not ms, so replays stay exact.
  - Done, as a finding: lookahead.js budgetFor (per decision; agent.budget overrides it). Tried 600 steps and 5–6
    decisions a turn in duels and late game, 300/2 at cEDH tables: 80-game Standard duels came out identical for
    every variant (39–41 against 400/3, the same as 400/3 against itself) and 16 cEDH games differed in one game,
    4% faster. Budget size makes no measurable difference, so the defaults stay. (An earlier 41–79 reading came from
    the test seating better decks with one side, not from the budget; tools/tune.mjs rotates decks to avoid that.)
- [x] 104. X spells: pick X from what it achieves (lethal Fireball, Exsanguinate kills, enough Hydroid Krasis cards)
  rather than the most mana available.
  - Done: (rules 5) Game.cast asks the caster for X. AI chooseSpellX: permanents (Hydras, counters) take all the
    mana; other spells try X = 1…30 valued with that X less 0.15 a mana, so burn stops at the X that kills its
    target and the rest of the mana stays free. An AI pilot no longer casts an X spell with X = 0 (one cast Banefire
    for 0 before). Human seats pick X from buttons. Head to head with the same deck, seats alternating, against
    pilots that always use all the mana: 26–14 over 40 games, no X = 0 casts.
- [x] 105. Planeswalkers: choose + or − by the board, protect own walkers in blocks, attack opponents' walkers when
  that's worth more than face damage.
  - Done, partly: creatures can now attack planeswalkers (item 99's attack-a-permanent: decl.obj, combat damage
    removes loyalty). The AI sends the smallest set of attackers already going at a walker's controller that kills
    it, when the walker is worth more than the damage those attackers would have dealt (and the player isn't about to
    die anyway). Choosing + or − was already done (pickPW). Human seats get "Attack <walker or battle>" buttons once
    creatures are selected (tested: 44 attacks by a scripted human seat). Not done: blocks that protect our own
    walkers (blocks treat an attack on a walker like one on us). Head to head in a
    walker-heavy pod, seats alternating, against the same pilots without it: 23–17 over 40 games, no rule broken.
  - Done (rules 5): the block search now counts damage aimed at our planeswalkers as loyalty lost (the walker's full
    worth when it would hit 0) instead of life, so blocks protect walkers worth keeping. Golden games identical, fuzz
    games clean; not measured head to head.
- [x] 106. Counter wars: respond to responses (counter the counterspell), cast Silence-style protection before a
  combo, hold Veil of Summer/Flusterstorm-style protection for the key turn.
  - Done, partly: the caster already fought back over its own spells, and Silence-before-combo was already there
    (shieldsUp). New (rules 5): a third player joins a counter war when a counterspell is aimed at a counterspell that
    was stopping something it wants stopped (Agent.wantCountered, shared with ordinary counters). 80 cEDH games: 7
    such joins (P3 Dispels the Flusterstorm protecting Exquisite Blood), 0 errors; golden games identical.
  - Done (rules 5): "spells you control can't be countered this turn" is now read (Veil of Summer, Autumn's Veil;
    before, Veil was only "draw a card" and Autumn's Veil a static that did nothing on an instant). The AI holds these
    (never cast for their small extras) and casts one in response to a counterspell aimed at a spell of its that
    matters (a combo piece, its commander, 4+ mana, a wipe, removal or counter), or before a combo when someone could
    counter it and the mana is there for both. Head to head with Veil of Summer and Autumn's Veil in the two green
    cEDH decks, pilots that hold them against pilots that cast them as soon as they score: 43–37 over 80 games
    (22 counterspells blanked, 6 combos shielded first; 0 errors, no rule broken). tools/tune.mjs --count counts log
    lines, to check a change fires.
- [x] 107. Graveyard plans beyond the Breach combo: reanimation targets, flashback and escape value, self-mill payoffs;
  the AI values its own graveyard as a resource and graveyard hate by what it stops.
  - Done (rules 5): Agent.graveyardPlan values a card in its own graveyard (flashback, escape, unearth, embalm,
    eternalize, jump-start; big creatures when a reanimation spell is in hand or out; anything with Underworld Breach).
    Discards keep those for the graveyard, milling yourself is worth what the milled cards are worth there (never close
    to decking), and graveyard hate is scored by what each opponent's plan loses. Head to head with the built-in cEDH
    decks against the same pilots without it (noGyPlan): 20–20 over 40 games, as expected for decks that rarely
    discard or self-mill; golden games identical, 52 fuzz games clean.
- [x] 108. Threat assessment learned from batch games: which public board states lead to a win next round, used to
  pick the archenemy instead of fixed weights (frozen into the setup like learn.js data).
  - Done (rules 5): threat.js. At the start of each round of a 3+ player game the engine notes each player's public
    board as seven coarse features (creature power, life share, other permanents, lands, hand size, combo pieces out,
    commander out); recordGame marks each note by whether that player won within two rounds and keeps counts in
    ct.threat (worker games send their notes too). After 30 games each feature value gets a log ratio of its win-soon
    rate against the average; the table travels in every seat's learned table ('#threat'), so replays stay exact.
    Agent.threat (threat ranks: removal, Silence and attack targets) and the engine's archenemy pick are scaled by
    it (×0.4–2.5). tools/threatlearn.mjs learns a table in Node and plays pilots with it against pilots without:
    the learned tables read as expected (big power, many lands and permanents and a small hand mean a win is near),
    and they reorder about 15% of threat rankings, but the results were even (40–40 over 80 games in creature pods
    and with the cEDH decks): no measurable gain yet. Storage in Updates lists and clears it.
- [x] 109. Reading human players: per-person tendencies (how often they hold counters, bluff open mana, chump block)
  kept in learn.js and frozen into each game's setup.
  - Done (rules 5): the engine notes for each person seat (HumanAgent, by seat name) the turns they end with 2+ mana
    open and cards in hand, whether that mana is used before their next turn and whether on a counterspell, the
    combats they could block in, their blocks and chump blocks; learn.js keeps these per person in ct.people (last 50
    people, this browser profile only). From 3 games on, the rates travel in that seat's learned table ('#person'),
    so replays stay exact, and the game log says what the AI remembers. The AI's counter odds for that person (which
    drive baiting, Silence and Veil before a combo, and holding back combo pieces) come from how often their open
    mana was a counterspell instead of a guess from colors and hand size. Tested in Node with an AI seat flagged as a
    person on the Kess deck: 20 games gave holds 65% of turns, uses 17%, counters 14%, 73% of blocks chump blocks;
    19 of 20 later games played differently with the reading. Not used yet: the chump-block rate (recorded and shown).
- [x] 110. Learned mulligans: learn.js records keeps and mulligans per deck with simple hand features (lands, plan
  pieces, fast mana) and how those games went, and nudges planScore.
  - Done (by land count, the feature with the most signal): the engine notes each kept seven's lands; learn.js keeps
    results per land count and adds them to the learned table (under "#hands", so it's saved with each game and
    replays stay exact). Under rules 5, a seven whose land count has 6+ games and won 8+ points less than average is
    sent back, and one that won 8+ points more is kept. Tested in Node: an all-losing table mulliganed all 40 sevens,
    an all-winning one kept all 40, rules 4 unchanged (38 of 40); golden games identical.
- [x] 111. One "AI strength" choice per seat (Beginner, Casual, Strong, Expert) that sets style noise, look-ahead and
  learning together; shown on the seat; the ladder rates each strength separately.
  - Done: setup screen "AI strength" (by bracket / Beginner / Casual / Strong / Expert), saved in prefs; each seat's
    noise, handicap and look-ahead are kept in the setup and replays; the log names the strength at the start; the
    ranked ladder rates opponents by strength (1100/1300/1550/1750) when one is chosen. Measuring it showed noise
    barely weakens a pilot (0.35 noise: 47–53), so a handicap was added (ai.js: that share of main-phase decisions
    picks any decent play or stops, attacks and blocks use the old rule-of-thumb versions). tools/tune.mjs, 2-against-2
    pods of fair decks, against Strong: Beginner (handicap 1 + noise) 38%, Casual (0.75) 44%, Expert (look-ahead)
    49–51%: look-ahead adds little in those pods. tune.mjs itself was fixed on the way: its first seat/deck rotation
    gave one side the same decks every game (a B-vs-B control came out 16–84); games now come in pairs with the sides
    swapped and each side holding a copy of each deck (control 50–50). Results from the tool before that fix (item
    103's notes are from the browser, not the tool) were not used. Not done: a strength label on each seat.
- [x] 112. Bluffing: casual pilots sometimes keep mana open for nothing; strong pilots hold up mana when an opponent is
  likely to attack into them.
  - Done, off by default: combatai.js trickFear (a blocked attacker that only just survives counts as at risk when
    the defender has 2+ open mana and cards in hand) and ai.js bluff (reserveFor keeps 2 mana up now and then with a
    full hand and opposing attackers). tools/tune.mjs, fair 2-against-2 pods, 160 games each: trick fear 77–83 (48%),
    bluffing on top of it 78–82 (49%). Neither helps with these decks (few tricks), so both stay as Agent flags
    (agent.trickFear, agent.bluff) for decks where they might, rather than on for everyone.
- [x] 113. Tuning tool: tools/tune.mjs (Node, no npm packages) runs seeded head-to-head grids over AI weights and
  writes a report, so tuning stops being done by hand in the browser pane.
  - Done: tools/tune.mjs. Runs the game modules in Node (no browser, no npm packages): two pilots as JSON (--a, --b:
    style plus any Agent field), games in pairs with the same decks and seed and the sides swapped (each side holds a
    copy of each deck), fixed seeds, --control for B vs B, the rules watcher on every game. Decks: the cEDH presets or deck-list files; card data from Scryfall
    /cards/collection once, cached in data/tune-cache.json. Tested: control runs come out 50–50 (after the seating fix in item 111), 0 errors, 0 rule problems. Its point is running long tuning grids from a terminal, where the hidden browser pane slows them.
- [x] 114. Kingdoms roles still missing: Schemer, Sellsword, Field Marshal, Straw Man abilities, War Bear {Q}, Wizard
  retarget, Champion scry (listed in README and KINGDOMS_AUTO).
  - Done, partly: War Bears get "{Q}: deals damage equal to its power to target creature" (the +1/+1 counter part
    isn't played); the Champion scries 1 each upkeep; the Straw Man's Announce forces every opponent's creature to
    attack them until their next turn, and from that upkeep they win by eliminating themself (the AI Straw Man Announces
    on its turn at 20 life or less while nobody is out). Fixed on the way: the AI valued "damage equal to its power"
    and other counted amounts as 0 when choosing targets and abilities (ai.js now passes the source). Still not
    automated (Announce reveals the role): the Schemer, Sellsword and Field Marshal, and the Wizard's retarget.
    Tested: 24 + 24 Kingdoms games with those roles dealt (War Bears used {Q} 34 times, a Straw Man Announced and won,
    Champion scried 31 times; 0 errors, no rule broken).
- [ ] 115. Kingdoms balance with fast decks: Assassins win 9 of 10 with the cEDH presets. Tune the King's guard and the
  Knights' protection until each team wins 30–60%.
  - Done, partly (rules 5): tools/kingdoms-balance.mjs measures it in Node. Found: a combo that hits every opponent was
    held back whenever any opponent had a weight under 0.5, so Bandits and Renegades (who spare the King) never fired
    theirs; now only a true ally holds it back (under 0.12). The guard reacts after 4 damage to the King instead of 10,
    the King hits back at whoever hurt him, and Assassins weigh the known King 0.8 instead of 1.8. On 100 fresh seeds:
    Assassins 75% → 67%, the King's side 21% → 25%, Renegades 4% → 8%. Not yet in the 30–60% band.
- [x] 116. Drafters for more sets: run tools/ratings_17lands.py for every set in 17Lands' public datasets (CC BY 4.0)
  and ship the small JSON files; improve the plain heuristic (removal, curve, two-color commitment) for unrated sets.

### Playing and the table
  - Done: tools/ratings_17lands.py run for 17 more sets: OTJ, MH3, LCI, ONE, BRO, SNC, NEO, VOW, MID, AFR, STX,
    KHM, DFT, TDM, FIN, EOE built (150,000 games each, 254–347 cards rated, 392 KB for all 23 sets); ZNR's public
    file answers 403. Unrated sets: limited.js pickScore v2 (HEURISTIC.v2) counts more kinds of removal (and
    removal on enter), creature size for its cost, two-drops when short of them, fewer 6+ drops, and cards with
    unread text for less. Test: 16 simulated M21 drafts, two drafters on each version, the 40-card decks played
    each other (both seat orders): v2 72–56.
- [x] 117. Drag to attack, block and target: drag a card onto a player, walker or creature; arrows on the table show
  what each stack item targets.
  - Done, partly: drag one of your highlighted creatures onto an opponent's board while declaring attackers to
    attack them (with it and any already selected); it's answered as the same clicks, so replays and undo are
    unchanged. Arrows: dotted arrows from each spell or ability in the stack panel to its targets, and attack arrows
    now point at an attacked planeswalker or battle. Not done: dragging to block or to choose a spell's target.
    Tested by hand in the Attacking lesson (dragged Hill Giant onto the dummy: it attacked and won).
- [x] 118. Auto-answers: "always yes / always pay / never pay" for a trigger or card this game (Rhystic Study taxes,
  "you may" triggers), listed so they can be undone; saved with the answers so replays stay exact.
  - Done: yes/no-style questions (2–6 buttons, no cards to click; not main-phase, attack, block, response or X
    questions) get an "Always" checkbox in the action bar; ticked, that answer is given automatically to the same
    question (numbers ignored, so "pay {1} or P3 draws" counts as the same) for the rest of the game. An "Auto answers:
    N ✕" button lists them (hover) and clears them. Each automatic answer is recorded like a click, so replays and undo
    are unchanged. Tested on the action bar: one ticked "Don't pay" answered the next two questions.
- [x] 119. Smart pass: "pass until something targets me or mine", "pass to my turn", "pass to end of turn", working
  with the stops from item 67.
  - Done: response windows and stops get "Pass to end of turn", "Pass to my turn" (on others' turns) and "Pass unless
    targeted" (asked again only for spells and abilities that target you or your permanents, until your next turn).
    While one is on, those windows pass without asking; blocks and your own main phases are still asked. The choice is a
    recorded answer, so replays set the same mode. Tested with a scripted Full-control seat in 4 cEDH games each:
    1,202 response prompts with plain Pass, 189 / 293 / 110 with the three modes, 0 errors, no rule broken.
- [x] 120. Payment preview: before a cast is confirmed, highlight the sources that will tap and let the player swap one.
  - Done, partly: hovering a card you can cast now outlines (yellow dashes) the lands and mana sources the automatic
    payment would tap. Swapping a source is done the way it already worked: tap the sources you want by hand first
    (mana in your pool is spent first); there is no separate confirm step, which would add a click to every cast.
    Tested in the first lesson: hovering Grizzly Bears outlined both Forests.
- [x] 121. Big boards: identical tokens stack with a ×N count; rows shrink instead of overflowing at 50+ permanents.
  - Done: identical creature tokens (same name, power/toughness and tapped state, no counters, damage, attachments
    or combat) are drawn together as an overlapped pile with a ×N count on the first card; each token is still its own
    card for clicks and targets. Cards shrink further past 34 and 50 permanents (38 and 34 px). Tested: a goblin token
    game drawn on the table (piles of ×7 and ×2).
- [x] 122. Card details panel: Oracle text, Scryfall rulings (cached for offline), and how the engine reads each line,
  from any card on the table, in a pile or in the log.
  - Done: right-click any card (table, piles, stack panel, or its name in the log) for a details panel: image, Oracle
    text, how the simulator reads it (describeFx) and any unread lines, and Scryfall's rulings (fetched once per card,
    the last 300 kept in the browser profile for offline). Tested: Hill Giant (no rulings), Rhystic Study (2 rulings,
    cached).
- [x] 123. Clickable log: card names highlight the card on the table and open its details; a search box over the log.
  - Done: clicking a card name in the log points the card out on the table (scrolls to it, a gold pulse); right-click
    opens its details (item 122); a "Search the log…" box shows only lines with that text (turn headers stay).
    Tested: searching "giant" in a lesson left the matching lines.
- [x] 124. Post-game report: life-total graph, damage dealt by and to each player, cards drawn and cast, the turn that
  decided the game and the biggest plays; kept in History.
  - Done: the results screen has a Game report: a life-total graph by turn (one line per player), spells cast, cards
    drawn, damage dealt and taken per player, the turn that decided it (where the winner's lead grew most) and the
    three biggest hits. The engine only records these (lifeLog, bigHits, stats.draws/taken); nothing reads them
    during play, so results and replays don't change. History entries keep each seat's spells and damage dealt and
    taken (not yet shown on the History page). Tested on a finished lesson game.
- [x] 125. The host's own table on phones and tablets (375 px wide, touch zoom on cards), not only the friend page.
  - Done: under 600 px the top toolbar and the timeline are single rows that scroll sideways (156 px tall
    together instead of 332 at 375 px wide), the page never scrolls sideways, the lesson coach panel moves to the top
    and stays short. Card zoom on touch relies on the right-click details panel (item 122): phone browsers send a long
    press as a context menu, but that wasn't tested here. Checked at 375×812 in a lesson; not on a real phone.
- [x] 126. Keyboard-only play and screen readers: every prompt reachable by keys, labels on cards, zones and prompts,
  announcements of other players' actions.
  - Done: the cards you can pick are focusable buttons named for screen readers ("Forest, in your hand"); Tab moves
    between them and Enter or Space picks the focused one (buttons already had Space/Enter, 1–9, Esc, A). The action
    bar's question is a polite live region, and casts, combat, damage, removal, combos and eliminations are announced
    through a hidden live region. Tested: the first lesson played with Enter only. Not tested with a real screen reader.
- [x] 127. Sound effects made with WebAudio (our own, like music.js) for casts, combat, life loss and "your turn", with
  separate volumes for music and effects.
  - Done: synthesized effects already played for casts, lands, combat, damage, removal, deaths, combos, wins and
    losses; added a two-note "your turn" sound and separate Music volume and Effects volume sliders in the Display
    window (saved in prefs). Tested: sliders change both levels and are saved.
- [x] 128. High-contrast theme, card text size setting, and the OS "reduce motion" setting turning on "Fewer animations".
  - Done: Display window: High contrast (black panels, white borders and text, yellow main buttons and pickable
    cards), Text size (Normal / Large / Larger), and Fewer animations starts on when the system asks for reduced
    motion (until the player changes it). Tested: both settings switch on and off in the Display window.
- [x] 129. Finish translations: help paragraphs, the game log, the self-test page and the windows from rounds 3–4
  (Expedition, builder, Draft, Updates) in es/fr/de/pt; add Italian and Japanese interfaces.
  - Done, partly: Italian and Japanese interfaces (public/js/i18n_more.js: all 165 existing strings and the 9
    patterns, card names and images from Scryfall in those languages), the Round 5 labels in all six languages, and the
    Round 3 setup buttons that had stayed English (Learn to play, Story, Expedition, Tabletop, Deck builder, Players…).
    Not done: the game log, longer help paragraphs, the self-test page, and the inside of the Round 3–4 windows
    (Expedition, builder, Draft, Updates). Tested: the setup screen in Japanese and Italian.
- [x] 130. Puzzle editor: build a board by clicking (search cards, place them in any zone for any player, set life and
  counters), test it, save it as a file or a challenge link (item 77 has no button to make one from a board).
  - Done, as a text editor rather than click-to-place: Puzzles → Make a puzzle… has a name, goal, hint, 2–4
    players (name, commander, life, commander out) and their battlefield, hand, graveyard and top of library, one card
    per line ("*tapped*" and "(+2)" for tapped cards and counters). Test it (plays it at once), Save as file, Copy a
    challenge link (opens the puzzle on any PC: item 77 had no button for this), or start From the current board. The
    draft is kept between visits. Tested: a board with a tapped Hill Giant and countered Grizzly Bears loaded and played.
- [x] 131. Rematch with changes: swap decks between seats, rotate seats or change one pilot, on the same seed.
  - Done: the results screen has "Rotate decks, same seed" (each deck moves one seat along, players and pilots stay)
    and "Same seed, change setup…" (back to the setup screen; the next game started uses this seed). Hidden for
    puzzles, custom seats and unfinished matches. Tested: a Standard game, rotated (the 60-card deck moved seats with
    the same seed), played out and rotated back. Fixed on the way: the opening-hand question no longer offers
    item 118's "Always" box.
- [x] 132. "What if" from the timeline: take over any seat from any point of a replay and play on; the branch is saved
  as its own replay.
  - Done: timeline "Take over…" (games of AI seats, or loaded replays): pick a seat; the game is rebuilt to this
    step and that seat is yours from there (setup.takeovers = [{ seat, step }], applied at that step in every rebuild
    and saved in replay files, so the branch replays exactly). The branch replaces the game on the table: Save replay
    first to keep the original. Tested: an AI Standard game stepped back to turn 10, Amber taken over, the main-phase
    question came up for her.
- [x] 133. Save and resume: the game in progress is autosaved (setup + answers) so closing the app or a crash loses
  nothing; Resume on the start menu.
  - Done: the game in progress is saved in the browser profile (ct.autosave: the replay file plus how many steps
    it got to) at every turn start and every answer; a finished game clears it. The start menu shows Resume with the
    players, turn and time; it plays the game back quickly to that step and pauses, and your recorded answers carry it
    there. Not for puzzles, lessons, campaigns, online or loaded-replay games. Like loading a replay file, resuming
    puts the saved decks into that format's seats. Tested: a Commander game reloaded at turn 22 and resumed to turn 22.
- [x] 134. Readable big tables: layouts and card sizes for 5–9 seat Kingdoms tables on a 1080p screen.

### Online
  - Done, partly: 5–6 and 7–9 seat tables had fixed card sizes (44 and 36 px) whatever the screen; they now follow
    the screen (clamp by width and height: 44–60 and 36–50 px). At 1920×1080 with 9 players: cards 44 px instead of
    36, boards with an inner scroll bar 5 of 9 instead of 7. Token piles (item 121) also save room. A first try that
    shrank cards by seat count made it worse and was dropped. Not done: a different layout for very full boards.
- [x] 135. Sideboard window on the friend page between best-of-three games (friends keep their deck today).
  - Done: between best-of-three games the host sends an online friend their deck and sideboard (RemoteUI.askSideboard);
    the friend page shows both lists, a click moves one copy across, "Play these" or "Keep my deck". The host only
    accepts the same cards in total and at least the format's deck size; no answer in 3 minutes keeps the deck.
    Tested with server.py and a friend tab: Standard Bo3, the friend moved cards and game 2 started.
- [ ] 136. Draft and sealed with friends: friends draft in the same pod as AI drafters (picks over the room channel),
  then play the pod or one-on-one matches.
- [x] 137. Friends at 1v1 and Limited tables: test the friend page with two seats and fix what breaks (untested in 56–60).
  - Done (tested, nothing needed fixing in the page): a Standard table with a friend seat played through server.py
    with a friend tab: two boards, the friend's questions, the game to the end, and a best-of-three into game 2.
    Limited uses the same two-seat path (not played separately). Found while testing: the Commander Table.exe in the
    folder was older than the per-seat join keys (friend links read code=undefined); rebuilt. An old server.ps1 left
    running by an earlier session (Nov 4) still holds port 8777 and answers with the old API; it was left alone.
- [x] 138. Tabletop with 3–4 friends tested and fixed (untested in item 76); save and load a tabletop.
  - Done: tested a 4-seat tabletop with three friend tabs (draws, life, dice, playing cards, all seen by the host).
    Save table writes the table to a file and Load table… carries on from it (Tabletop.save/load; friends rejoin with
    new links and their moves are accepted). Fixed: the friend page showed a Deal button at the tabletop.
- [x] 139. Deals proposed from the chat are recorded with the answers, so rewinds and saved replays include them. Done: `setup.chatDeals` keeps each offer with the step it was made; rebuilds and loaded replays offer it again at that step.
- [x] 140. Resume a room after the host's app closes: reopen from the autosave (item 133) and friends rejoin with the
  same seat keys.
  - Done: online games are autosaved too, with each friend seat's key; Resume reopens the room with those keys
    (room/open now takes "seat=KEY" in all three servers). Tested with server.py restarted mid-game: the friend's same
    link rejoined and play went on. server.ps1's open was checked with curl; the .exe was rebuilt but not run (port 8777 busy).
- [x] 141. Hand a seat to someone else mid-game: give a dropped friend's seat to another person with a new key.
  - Done: "New link for someone else" in Invite (room/rekey in all three servers). Tested with server.py: the old link
    was refused, the new one joined the seat mid-game; server.ps1's rekey checked with curl; the .exe rebuilt, not run.
- [x] 142. Streamer view: a spectator link with a delay (30 s–3 min) that shows every hand after the delay, in a clean
  layout for screen capture.
  - Done: seat -2 in every room; the host samples the whole table every 2 s and sends it only after the delay. Tested
    with server.py: both hands shown, chat and buttons hidden, a chat line appeared 31 s later at the 30 s setting.
- [x] 143. Friend tournaments: Swiss or single elimination for 4–16 people across rooms, AI fill-ins, a standings page.
  - Done: Friend tournament (friendcup.js + a window on the table): entrants played by you, friends or the AI; Swiss or
    single elimination; AI fill-ins for short pods; pods with people played at the table (friends get links per match),
    AI pods at full speed; standings with Copy. Tested: the pairing logic on 4 shapes in Node, and a 5-player Swiss
    Standard event in the browser (AI pods, my pod at the table, round 2 paired by points). A friend seat in a cup game
    uses the normal online seat path but wasn't played separately.
- [x] 144. Connection check for friends: a page on the host that tests the port and the tunnel from outside the PC and
  says what to fix (firewall, router, tunnel down).
  - Done: "Check the connection" in Invite: the server, each LAN address and port, the tunnel URL through Cloudflare,
    who has joined, with a fix for each failure. A true outside-the-PC port test would need an outside service, so the
    advice covers what this PC can't see. LAN rows tested with server.py; the tunnel row not run.

### Decks and data
- [x] 145. Deck health: lands, curve and counts of ramp, card draw, removal and wipes against a Commander template
  (Scryfall's `otag:` tags, fetched once and cached), with suggestions.
  - Done: dechealth.js and a Deck health button in the deck viewer. Tags are asked only for the deck's own cards (20
    names a search) and kept per card (ct.otags2). Ramp uses mana-rock/mana-dork/land-ramp/ritual: the broad ramp tag
    counted Path to Exile and Sun Titan. Tested on random Commander decks in the browser (about 3 s the first time).
- [x] 146. Commander precons from MTGJSON's deck files (free, open license): browse by set and seat one in a click;
  cached for offline.
  - Done: precons.js + "Commander precons…" on the setup screen (208 decks, by set, filter); a seat's source
    "precon:<file>" loads one. The list is kept a week, each deck once. Tested: Virtue and Valor seated and loaded
    (99 + commander, no warnings), and two full-speed games with four precons, 0 simulator errors.
- [x] 147. Collection: import what you own (ManaBox, Deckbox or any CSV), mark owned cards in the builder, an "only
  cards I own" filter and a missing-cards list per deck. No prices.
  - Done: collection.js + Collection… on the setup screen (replace or add); builder ✓ badges, "need N" rows and an
    Only cards I own filter (Scryfall pages filtered here, reading up to 6 more pages); the deck viewer's missing list
    with Copy. Tested with ManaBox and Deckbox style CSVs and a precon in the browser.
- [x] 148. Library folders and tags, search by commander, colors and bracket, notes per deck, and version history with
  a diff between versions.
  - Done: folder, tags, colors, bracket and notes in each list's About section (loaders skip it; no server change);
    folder filter and multi-word search; Info panel with "Work out colors and bracket"; every save keeps the replaced
    list (last 10, in the browser profile) with Show changes and Restore. Tested with a throwaway deck, then deleted.
- [x] 149. Goldfish: sample hands with mulligans, and solo runs of the AI pilot over 1,000 seeds giving the average turn
  the commander comes down and the combo is assembled.
  - Done: goldfish.js + a Goldfish section in the deck viewer: sample hands (London mulligan, draws) and 100/250/1,000
    solo runs against a lands-only opponent (commander turn, first combo attempt, win turn, lands after three turns,
    mulligans). Fixed seeds, so results compare before and after an edit. Tested on a precon: 100 runs in about 2 s.
- [x] 150. Draw odds: chance of having a card or a category (ramp, a combo piece) by turn N, in the deck viewer.
  - Done: hypergeometric odds (goldfish.js atLeast) for a group or one card, at least 1–5, turns 1–10 on the draw and on
    the play. Groups: lands, card types, Deck health roles once checked, combo pieces. Checked: 1 card in 7 of 99 is
    7.07%, and the at-exactly-k odds sum to 1.
- [x] 151. Combos one card away: Commander Spellbook's "almost included" results in the deck viewer and the builder.
  - Done: combos.js almostCombos (find-my-combos' almostIncluded, one missing card, by popularity) in the deck viewer
    (with Spellbook links) and the builder (click the missing card to search it). Tested on a precon in both.
- [x] 152. Bracket estimate refresh: follow the current official bracket rules (tutors, extra turns, Game Changers from
  Scryfall) and explain each difference from Spellbook's estimate.
  - Done: late-game two-card combos (pieces over 6 mana together) are bracket 3, early ones 4; extra-turn chaining
    (2+ cards) and tutors (counted, no limit) are listed; bracketDifferences explains a gap with Spellbook on the chip
    and in a new Bracket section of the deck viewer. Changes the default AI noise for some unbracketed seats; noise
    is saved in setups, so replays stay exact. Tested on a precon and two random decks.
- [x] 153. More exports: MTGO .dek, Arena text and a printable text checklist.
  - Done: deckexport.js + Export buttons in the deck viewer. Checked on a precon: the .dek parses as XML with the
    commander in the sideboard, the Arena text reads back as 100 cards with the commander, the checklist groups by type.
- [x] 154. "Fully simulated only" filter in the builder, so people can build decks the AI plays at full strength.
  - Done: a builder checkbox (effects.js ignoredText per result, reading on like the owned filter) and a ⚠ badge on
    partly simulated results. Tested: o:"exchange life totals" showed 7 cards with 5 ⚠, and 2 with the filter on.
- [x] 155. EDHTop16 trends: commander share and win rate over time from the cached answers, charted in the meta browser.
  - Done: a Trends tab: share across the year/6-month/3-month/month windows with a sparkline and rising/falling, win
    rates, and a daily snapshot history (ct.metaTrend, a year) shown as "Your visits" from the second day. Tested in
    the browser (25 commanders); the visits column needs a second day, not seen yet.
- [x] 156. More deck sites, where their terms and robots allow it and no bot check is in the way (TappedOut, MTGGoldfish,
  Archidekt folders).
  - Done: Archidekt folders (robots.txt allows them; the folder API goes through the existing proxy, no server change):
    Import an Archidekt folder… in the library, with subfolders, saving each chosen deck into a library folder.
    TappedOut and MTGGoldfish deck links already loaded (earlier rounds). Tested with a public folder (saved, then deleted).
- [x] 157. Printings offline: the optional "Default Cards" bulk file so set searches for Draft / Sealed and printings
  work without Scryfall (item 81 still sends e: and is:booster there).
  - Done: bulk.js downloadPrints/loadPrints/removePrints (paper printings, kept in a separate IndexedDB) and set,
    cn and is:booster terms plus order=set and unique=cards/prints in the local search. Tested: a 104,682-printing
    download in 55 s; e:fdn is:booster answered locally with the same 271 cards in the same order as Scryfall.
- [x] 158. "Download images for my library": fetch every image for library decks into data\images with progress, and
  let the 400 MB cap be changed.
  - Done: /api/imgcache (folder size and cap, kept in data\image-cache-mb.txt) in all three servers; server.ps1 now trims
    the folder too. Updates has a Cap select and the download button (4 at a time, Stop). Tested on server.py (cap
    set and read back, bad input refused, a temporary library deck's 21 images fetched) and server.ps1 with curl;
    the .exe rebuilt but not run (port 8777 busy).

### Modes and progression
- [x] 159. Two-Headed Giant: shared 30 life, shared turns and team combat, with AI teammates that plan together.
  - Done: format twohg (formats.js; random decks from Standard's pool). Seats 1–2 and 3–4 are teams (Game.linkTeams:
    each member's life and poison read and write the team's, so lifelink, "each opponent" damage and life costs all
    hit the shared total; look-ahead copies link again). 15 poison loses; a player losing takes the teammate out too
    (810.8a) and the team left wins together (g.winners). Teammates are never opponents (no attacks, targets, deals or
    threat on each other), the team that goes first skips its first draw, and the defender's teammate blocks too,
    among the attackers still unblocked (810.7). Turns: teammates take theirs back to back as the team's turn
    rather than one merged turn (a merged untap, draw and combat would need the turn structure rebuilt). Tested: 20
    games with four creature decks through tools/tune.mjs (team against team, 10–10, 0 errors, no rule broken) and a
    logged game (shared life to 0 eliminated both, the other team won together, teammates blocked for each other).
- [x] 160. Archenemy (the format) and Planechase with Scryfall's scheme and plane cards: a scheme set in motion each
  turn, the planar die, AI that plays both sides.
  - Done: planar.js and two formats. Archenemy: seat 1 has 40 life and a deck of 20 schemes (Scryfall t:scheme, no
    ongoing ones); at the start of its first main phase each turn the top scheme's "set in motion" ability goes on the
    stack (targets chosen by its pilot, AI or person) and the scheme goes to the bottom. The others are a team
    (Game.teams, as in item 159: never opponents of each other, block for each other, win together when the archenemy
    is out; but each loses on their own). Planechase (Commander): 10 planes, one face up; each player rolls the planar
    die once at the start of their first main phase (planeswalk 1 in 6, chaos 1 in 6); "when you planeswalk to",
    chaos (both wordings) and upkeep abilities are played, the rest of a plane is named in the log as not played.
    The pick is saved in the setup and in replays (planar), and the decks are shuffled with the game's seed. Tested in
    Node with fetched cards: 12 Archenemy games with four creature decks rotated (archenemy won 2; 110 schemes set in
    motion, 60 of them read; 0 errors, no rule broken) and 12 Planechase games with the cEDH decks (66 planeswalks, 71
    chaos rolls, 21 chaos abilities played; 0 errors, no rule broken). Not done: ongoing schemes, plane statics, more
    paid rolls of the die, batch runs (they play these formats without the scheme or plane deck).
- [x] 161. Duel Commander (1v1, 20 life, `legal:duel`) and 1v1 Commander at 40 life.
  - Done: two formats (formats.js), random Duel Commander decks from legal:duel (randomVariant), and 1v1 Commander
    taking any Commander deck. Tested: random decks of 100 with no warnings, three games each at full speed (0 errors),
    and a 1v1 Commander game started from the setup screen.
- [x] 162. Gauntlet: beat a chain of rivals in a row (EDHTop16 top 8, a cube's AI decks or the library); one loss ends
  it; best run shown in Progress.
  - Done: a Gauntlet tab in Progress: pools EDHTop16 top 8 (1v1 Commander), your library, or random decks of the
    format (cube decks left out: the cube's AI decks are built per draft); one-on-one fights with your seat-1 deck,
    a result counted once, best run per pool. Tested a random-pool run in Standard to a loss (run ended, best kept).
- [x] 163. Expedition: more events, run modifiers of our own, a fourth act, Hard runs tested to the end, and seeded runs
  shareable as a code.
  - Done: four more events (8), three run modifiers of our own (Glass cannon, Laden pack, Forced march), a fourth act
    (The Starlit Peak, the Star Herald) for new runs, and run codes (set, difficulty, modifier, seed) that replay the
    same road. tools/expeditionsim.mjs plays whole runs with an AI in your seat. Found: the starting deck was 16
    spells padded with 24 lands, so the first rivals won almost every fight; it is now 23 spells and 17 lands. An AI
    pilot wins about two thirds of its fights, so Normal now forgives one loss per run (none still clear all four acts
    with an AI pilot: 5 of 12 reached act 2). Hard runs walked to the end with --win-all (all fights played, counted as
    won): 2 of 2 cleared all four acts with every reward, event and boss, no errors.
- [x] 164. Story: four more chapters of The Lantern Road, balanced like the first four.
  - Done: chapters V–VIII (The Glass Desert, Under the Wolf Moon, The Clockwork Tide, The Last Lantern), original
    text and boards. tools/storybalance.mjs plays each chapter with an AI in your seat: chapters I–IV win 37–80%, the new
    ones 43–53% after tuning (30 games each, 0 errors). Tested: chapter V opens after IV and starts with every card.
- [x] 165. Puzzle of the day, found in batch replays (a position where the active player had lethal), checked by the
  engine to have a solution and picked by date.
  - Done: tools/dailypuzzles.mjs saves the board at the winner's last first main phase in AI games (the cEDH decks,
    fixed seeds) and keeps it only when an AI pilot wins from it on three shuffles: 91 of 120 games (71 combo wins,
    20 damage). The Puzzles window shows the day's puzzle with a streak. Tested: today's opened with all 4 boards
    and no missing cards.
- [x] 166. Limited ladder: Elo from draft and sealed results, and a league record per draft (best of seven wins).
  No entry fees.
  - Done: seating a one-on-one Limited deck starts a league for that pool (the other three drafters' decks in turn,
    until 7 match wins or 3 losses); each decided match counts once for a Limited Elo rating; the results screen shows
    the record and "Next league opponent"; Progress › Ladder lists the rating and past leagues. Tested with a sealed
    FDN pool: a loss counted (0–1, 1480), the next opponent was seated and its match started.
- [x] 167. More badges, avatars and card backs (original SVG/CSS) for the new modes, and a page showing progress
  toward each unlock.
  - Done: six badges (puzzle of the day x2, Gauntlet x2, Limited league, friend tournament), two original SVG avatars
    and two CSS card backs, and an Unlocks tab in Progress with a progress bar per locked item (badges report their
    own progress). Badges are checked right after those modes record a result. Tested in the browser.
- [x] 168. Coach: for a human seat, show what the AI would play and why (the Explain text) before you decide; off in
  Ranked.
  - Done: a Coach checkbox; HumanAgent.coachNote asks a fresh Agent of the deck's style for its best play on a separate
    random stream and adds its reason to the main-phase prompt. Off in Ranked and puzzles. Tested: shown in a
    Standard game; in Node a game with the coach asked at many points came out identical to one without.

### Speed, testing and tooling
- [ ] 169. Run games in a Web Worker so the table stays smooth during long AI turns and look-ahead.
- [x] 170. Batch, matchup grid and tournaments on every CPU core with several workers; results identical to one worker
  for the same seeds.
  - Done: batch runs, the matchup grid and the AI tournament play on every core (batchworker.js, a module worker per core; each loads the decks from
    their card lists and plays a list of fixed seeds with the learned tables taken at the start). Batch has Cores and
    Seed controls. Tested: 25 cEDH games with seed 12345 gave identical results on 1 core (6.9 s) and on 15 workers
    (0.76 s). The grid (3 decks, 12 games) and a 5-deck tournament (3 rounds) were played on workers too; each keeps
    its old in-page loop as the fallback.
- [x] 171. Profile the engine: a speed row in the self-test (games per second on fixed seeds) and speed-ups of the
  hottest paths (abilitiesOf, statics, cloneGame).
  - Done: profiled in Node: the combat planner spent most of its time in attachments(), has(), power() and toughness().
    Game.withEvalCache gives the planner a read-only memo of those (the board doesn't change while it plans).
    Self-test: 50 games 13.9 s → 6.5 s and look-ahead 0.69 → 0.34 s a game, with the same results (13.0 rounds, 53
    combos; golden games identical). abilitiesOf and cloneGame were under 3% each and left as they are. New
    self-test row: Speed (10 fixed seeds, games and steps a second).
- [x] 172. Golden card readings: tests/cards.mjs runs the effects parser over a saved snapshot of the 3,500 cards and
  fails when a card's reading changes without the snapshot being updated on purpose.
  - Done: tests/cards-snapshot.json (3,500 cards, Scryfall fields normalize() reads; --fetch refreshes it) and
    tests/card-readings.json (type, what is understood, lines not read; --update accepts). CI runs it after the type
    check. Now 88.3% fully read. Checked that a changed reading fails with a +/- diff.
- [x] 173. Golden replays: saved replays from each version in tests/ that CI replays and checks for the same result,
  so outcome-changing edits are caught and replay versions are bumped on purpose.
  - Done as golden games: tests/golden.mjs plays 12 AI games (the four built-in decks, fixed seeds) under rules 4 and
    rules 5 and compares winner, rounds, steps and a log hash with tests/golden-games.json; card data is saved in
    tests/golden-cards.json so it runs offline in CI. Replays saved from the app with your own answers need the browser
    (HumanUI), so they aren't part of it. Recorded and re-run: 12/12 identical.
- [x] 174. Fuzz games: random decks plus random answers to every human prompt, under the invariants watcher, in CI
  with a fixed seed list.
  - Done: tests/fuzz.mjs (random Commander decks from the card snapshot; seat 1 is a HumanAgent whose UI answers at
    random; 12 fixed seeds in CI, more with --games/--seed). HumanAgent no longer needs a page (two DOM uses guarded).
    Found and fixed: equipment stayed on a Vehicle after it stopped being a creature; now 704.5n unattaches it
    (rules 5), and the watcher checks that after state-based actions. 132 more games: 0 errors, 0 broken rules.
- [x] 175. Type-check baseline from 124 findings to 0, then strict null checks for engine.js and effects.js.
  - Done: 105 → 0 findings. types/dom.d.ts tells the checker the pages' DOM lookups are HTML elements (42 findings);
    fields set after construction are declared (Game, Clock, Room, HumanUI, RemoteUI, Agent, seats); HumanAgent's async
    overrides have an any return on the Agent side; the rest got JSDoc types. engine.js and effects.js now also pass
    --strictNullChecks (172 findings fixed, mostly by typing the card reading and object records), checked by a second
    pass in tests/typecheck.mjs. Found on the way: a typo (revealAll for revealHands) kept the top of a library hidden
    for "look at the top card" permanents when Reveal hands was on. Golden games, card readings and fuzz unchanged.
- [ ] 176. Split main.js and engine.js into smaller modules (setup screen, windows, results; combat, stack, zones, mana)
  with no change in behaviour, checked by the golden replays (item 173).
- [ ] 177. CI on more systems: build the .exe and test it and server.ps1 on a Windows runner; run server.py's --check
  and the self-test on macOS and Ubuntu runners (closes item 52's "untested on a real Mac or Linux").
  - Done, not yet run: selftest.yml now runs server.py's --check and the self-test on Ubuntu and macOS (a matrix), and
    a Windows job builds Commander Table.exe and runs the self-test against it and against server.ps1. Written and
    checked by eye only: the branch isn't pushed, so GitHub hasn't run the new jobs. (server.py --check passes here.)
- [x] 178. Local bug reports: "Report a problem" saves the replay, log, version and console errors into
  data\bugs\<time>.zip with personal details stripped, for the user to share by hand. Nothing is uploaded.
  - Done as one JSON file saved to Downloads (no server change; a browser can't write a zip into data\): the replay
    with seat numbers for names, the last 400 log lines, version, browser, screen, the last 40 errors and warnings
    (kept from page load) and a note. Paths, emails and IP addresses are masked. Tested: a test error's path, email and
    IP came out masked.
- [ ] 179. Storage: move the large ct.* keys from localStorage to IndexedDB, show how much each feature uses in
  Updates, with clean-up buttons.
  - Done, partly: Updates has a Storage panel (each feature's size in the browser profile, the card files, the total
    the browser reports) with Clear buttons (caches at once, your own records after a question). Tested: the card
    caches (238 KB) cleared. Not done: moving the large keys to IndexedDB, which would make every `store()` reader
    async; none is near the limit yet (256 KB of about 5 MB in the test profile).
- [x] 180. Determinism check in the self-test: the same seeds played twice, with and without look-ahead and in a
  different order, give identical logs (catches stray Math.random or Date).
  - Done: a self-test row: 3 seeds with and without look-ahead seats, then again in the opposite order; logs compared.
    Self-test: all 18 checks passed, 6/6 identical in 5.4 s.

### Help and packaging
- [x] 181. Rules glossary: hovering a keyword in card text or the log shows its Comprehensive Rules entry from cache/.
  - Done: Rules.keywordIndex/glossify (702 keyword abilities and the rarer 701 actions, 242 names) mark keywords in
    log lines, card previews and card details; one page tooltip shows the rule and its first subrule. Tested in the
    browser (Flying, trample, scry, Deathtouch marked; Exile left plain; the tooltip shows 702.9).
- [x] 182. "What's new" window after an update, built from this file's Done notes for the new VERSION.
  - Done: tools/whatsnew.mjs writes public/data/whatsnew.json (newest round's finished items, first sentence of each
    Done note, VERSION); the page shows it once when the version changed since the last start, and from Updates.
    make-shareable-zip.ps1 refreshes it when Node.js is there. Tested by setting an older seen version.
- [x] 183. Update checksums: release.yml publishes a SHA-256 next to each release zip; the installer shows and checks
  it and refuses a mismatch.
  - Done: release.yml attaches commander-table.zip.sha256; the update check in all three servers hashes the download,
    fetches <address>.sha256 and refuses a mismatch (nothing saved); Updates shows the hash and whether it matched.
    Tested server.py's check with a stubbed download (match, mismatch refused, none published); server.ps1 parses and
    the .exe builds, but neither was run against a real address.
- [x] 184. Help window inside the app: README's sections with a search box, translated where item 129 covers them.
  - Done: tools/help.mjs builds public/data/help.json from README's sections (make-shareable-zip.ps1 refreshes it);
    Help on the start menu shows a contents list, the section (bold, code, links, lists, tables) and a search that
    ranks sections and highlights the words. The manual itself stays in English: item 129 translated the interface,
    not README. Tested: 25 sections, a search for "gauntlet" found Progress, the formats table renders.

## Notes from sessions

- 2026-11-07 (side session, version 1.17.0, item 82): card scan 80.8% → 88.0% fully read (3,080 of 3,500). How the
  scan was run: in the browser pane on the local server, `sf()` from scryfall.js pages `/cards/search?order=edhrec&q=legal:commander game:paper`
  (20 pages), the raw cards kept in localStorage, `normalize()` + `ignoredText()` per card; regressions checked against
  `git show HEAD:public/js/effects.js` loaded as a second module. New engine pieces: Game.becomeCopy-style effect with
  end-of-turn revert (o.copyUntil), Game.gyOnceSource (Kess/Lurrus), foretell/plot (o.foretold, cast later from exile),
  impending (o.impending time counters, not a creature until 0), encore in graveAbility, devour, typecycling,
  bestType() for "choose a creature type" spells, q.lostAmt (life lost this turn), stack items keep kind/trig
  (copyAbility), watch w.cmdr for backgrounds. ai.js only got effectValue cases for the new effect kinds.
  Left unread (420 cards): mostly unique rules (Sundial, Scroll Rack, Chain Veil, X-cost activated abilities, bestow,
  morph, madness, cleave, "becomes a copy … with mana value X", meld) — X in activated ability costs is the biggest
  missing engine feature.
- 2026-11-07 (side session, item 83, version 1.17.0): main-phase look-ahead. The plain top-3 rollout was a coin flip
  (about 0.6 changed decisions a game, mostly reorderings); the gain came from adding "stop here" as a candidate.
  More samples, whole opponent turns and other margins changed nothing measurable, so the cheap settings were kept.
  Testing tip: in a hidden browser pane, setTimeout is throttled; yield between batch games with a MessageChannel.
  Python on Windows writes CRLF in text mode: write files in binary to keep the repo's LF endings.
- 2026-11-07 (interactive session): project put in git and on GitHub; CLAUDE.md and the `test-commander-table` project
  skill added; CI self-test (Playwright, server.py) and tag-based release workflow added. Security review of the three
  servers: server.py had no Host-header check, so a DNS-rebinding website could reach /api/update and replace the
  game's code; and all three servers let any website trigger host-only room actions (open the network port, start the
  tunnel, close the room, push questions to friends) with simple cross-site requests. Fixed: every /api/ call to the
  local server must come from the game's own page (Origin and Sec-Fetch-Site checked; server.py also checks Host).
  Tested with forged requests against the .exe, server.py and server.ps1 (all refused) and the self-test 15/15.
  Not fixed (low risk, noted): a friend with the room code can view another seat's hand by changing ?seat= in the
  link; room codes are 6 hex characters with no rate limit.
  - Fixed 2026-11-08 (1.17.0): every seat and the spectators' view get their own secret key (10 characters from 32
    letters and digits, cryptographic random, about 50 bits); a friend call must carry its seat's key, so editing
    ?seat= gets 403. More than 30 wrong codes a minute get 429 (right codes still work). Join codes are now
    KEY-seat (like K7Q2XF9ABM-2). Same in the .exe, server.ps1 and server.py; tested by probe script against
    server.py and server.ps1 (own key 200, another seat's key 403, 429 after 30 wrong codes); the .exe compiled.

- 2026-11-04 (interactive session, version 1.15.0, asked: "add the AI bots to fill the kingdom game should have host friends and ai bots as an option"):
  - New: kingdomsPlay.js handles roles in the rules engine.
    - setupRoles: the King gets +10 life and the first turn.
    - knownType and sees: hidden information. teammates: face-up same type, or Knight with King.
    - damageHook: the Queen and the Knight in Shining Armor. preventLoss: the Cultist.
    - onEliminated: the Heir, the Kingslayer, the King-eliminates-Knight penalty, the Straw Man, the Challenger and Defeat flags.
    - checkVictory: team wins. tick and upkeep: the Mimic and the Champion.
    - canAnnounce, aiPlan, announce and announceHuman: the role abilities. aiWizard: the AI Wizard exiling a spell.
  - Engine hooks:
    - Game opts.roles; grudge arrays sized to the table; opponents() leaves out teammates.
    - lose() and finish() take a team; "win" effects and win combos are off in Kingdoms.
    - lastHitBy is set from damage and from runEffects' controller (effectP); item.toExile; skipCombat.
    - The AI Announce window runs at the start of main 1.
  - AI:
    - kingdomsWeight in politicalWeight; the "guard" factor raises weight on whoever damages the King.
    - Bandits and Renegades spare the King while Assassins remain.
    - combatai's elimination bonus becomes −60 against allies; the comboAssembled gate stops each-opponent combos that would kill an ally.
  - Setup:
    - A "Table" choice (prefs.kingdomsMode: engine, the default, or manual). tableManual() replaces fmt().manual for the seat-style list and Load decks.
    - Roles are dealt from the seed (seed ^ 0x6b696e67) and saved in replays.
    - Ranked is off for Kingdoms. Results and progress count team winners.
  - UI: role chips on boards and in friends' snapshots (net.js roleChip, winners); remote.js handles 5–9 boards; the CSS grid uses .table[data-n] for 5–9.
  - Balance (AI-only, random EDHREC decks, 24 games): Assassins 14, King and Knights 7, Renegades 2, Bandits 1. Before the guard and elimination fixes it was Assassins 26 of 30.
    - With the fast cEDH presets Assassins still win most games (9 of 10 in the self-test).
    - Not done: Schemer, Sellsword, Field Marshal, Straw Man abilities, War Bear {Q}, Wizard retarget, Champion scry. These are listed in README and KINGDOMS_AUTO.
  - Tests:
    - 30 + 20 + 12 AI Kingdoms games at 5–9 players with the invariants watcher: 0 errors, 0 rule problems.
    - A 6-seat UI game: you plus 5 bots, role chips, Announce as the Priestess swapping life with the King.
    - Self-test 15/15 (new check 15: 10 Kingdoms games); the other numbers are unchanged (13.7 rounds, 54 combos).
- 2026-11-04 (interactive session, version 1.14.0, asked: "a fully manual game mode with no automation; the Kingdoms format, 5–9 players"):
  - New: manual.js rewritten; kingdoms.js has the 26 roles in our own wording, ROLE_TABLE, dealRoles and the rules summary. formats.js adds `manual` (anyDeck, 2–9) and `kingdoms` (roles, 5–9). In main.js: seatCount(), a Players and Starting life row, "Load decks" opening the tabletop for manual formats, seat styles limited to "Played on this PC" / friend, and the Viewing as selector.
  - Nine seats: SEAT_COLORS and CB_COLORS extended.
  - Role card images: extracted from the user's PDF (img01–48 → public/roles/<id>.png, tips as -tips). The zip script excludes public\roles, since the art belongs to Wizards of the Coast and its artists.
  - Tests:
    - Role dealing for 5–9 players.
    - King setup (50 life, first turn, face up).
    - Hidden information: Bandits see each other and the King; others see only themselves and the King.
    - Move permissions, search and move, give control, commander damage, Announce and dice.
    - A 7-player Kingdoms table on one PC, and a friend tab as a Bandit drawing and Announcing.
    - Self-test 14/14, unchanged.
  - The server stopped once during testing and didn't do it again with the room open for 20 s; cause not found.

- 2026-11-04 (interactive session, version 1.13.1, asked about Zirda, Walking Ballista, Grim and Basalt Monolith and the combos in decks):
  - Card reading:
    - Zirda (abilityReduce what 'any', nonMana) applies in abilityCost and reducedEquip.
    - Power Artifact (attachReduce), plus "Enchant artifact" targeting for the AI (chooseAuraTarget) and for people.
    - Rings of Brighthearth (copyAbility in activate, with wantsAbilityCopy for both agents).
    - {Q} costs (untapSelf: must be tapped, untaps as the cost; Pili-Pala).
    - Vizier of Remedies (minusLess).
    - The companion line counts as read.
  - People can ping with Walking Ballista (human.js pingers/usePing in main phase, instant windows and responses). Before this only the AI could.
  - Take-back vs. ability: clicking a tapped Monolith asks which you mean. Before, it always took the mana back, which broke hand-played Monolith loops.
  - Loop shortcut fix: text button values counted as repeat requests (String.prototype.repeat).
  - Combos:
    - Zirda + Basalt and Zirda + Grim added.
    - Every built-in combo was checked one by one with its pieces placed or cast; all land.
    - Infinite mana now finishes through engine.manaFinish: Ballista cast or pumped then pinging, a tutor or Survival fetching it, or Thrasios then casting Oracle. The old instant "kill everyone" and the rules-wrong Kinnan-digs-Ballista line are gone.
    - The AI holds a mana combo until manaOutlet says it can use it.
  - Self-test 14/14: 13.7 rounds and 54 combos (down from 224 "landed" infinite-mana loops with no outlet once the shortcut was removed).

- 2026-11-04 (interactive session, version 1.13.0, asked: "an update feature to check for new card sets; many cards don't work properly or interact right; combos should only work on the battlefield or the stack; a start-up menu"):
  - public/js/sets.js: Scryfall /sets, compared with ct.sets; new releases set ct.cardsStaleBefore, which scryfall.js fetchCollection treats as stale; daily check at startup (prefs.autoSets), Updates → Card sets, newest draftable sets added to Draft / Sealed and the Expedition.
  - Combos: combos.js comboBlocked (untapped/unsick pieces, minLands, minCreatures, check) used by ai.js comboAssembled and engine goOff (which logs why it can't start); readPrerequisites reads Spellbook's prerequisite sentences and skips combos it can't check. Built-in fixes: Tainted Pact (unique library), Heliod + Ballista (X=2, two counters), Exquisite Blood (a way to start), Breach + LED + Brain Freeze (graveyard ≥ 6).
  - public/js/invariants.js: rules checks (zones, duplicates, tokens, ownership, control, lethal damage, toughness 0, life ≤ 0, poison, auras/equipment, loyalty, commanders, legend rule); watchGame runs the strict ones after full SBA passes. Self-test step 14. Bugs it found and fixed: when a player left the game, their aura on their own creature went to the graveyard while also leaving the game; cards they had stolen left the game instead of returning to their owners (800.4a).
  - Start menu (#startMenu): shown at startup instead of the setup screen; Menu buttons in the top bar and on the setup screen.
  - Tests: self-test 14/14 (combo results changed as expected: 11.4 rounds, 64 combos); 100+ more games with random Commander and 60-card decks under the rules check with no problems; Devoted Druid + Vizier refused while summoning sick; new-set detection by forgetting two set codes. "Many cards" in general: coverage is still about 81% of the top 3,500 Commander cards fully read (deck viewer lists the rest); the rules check now catches interaction breakage as it appears.

- 2026-11-04 (interactive session, version 1.12.0): Round 3 items 73–78; Round 3 is complete. New modules tutorial.js, story.js, campaign.js, manual.js, challenge.js, builder.js. Puzzles: format, fullGame and check; engine opts.lifeBonus. newGame: customSeats, after, coach. Tests: self-test 13/13 with the same results as before, every lesson and chapter loaded (no missing cards), chapter balance runs, an expedition through act 2, a lesson clicked through, a challenge link opened from the address bar, the builder, and the tabletop with a friend tab. Not tested: the Expedition on Hard to the end, the tabletop with three or four friends, French/German/Portuguese labels on the new windows (they're English-only for now).

- 2026-11-04 (interactive session, version 1.11.0): Round 3 items 66–72. New modules cosmetics.js and i18n.js. HumanAgent takes opts { stops, full, orderTriggers }; setup.stopOpts fixes them per game. human.js had three double-encoded characters (Filter…, 1–9, ·), fixed. Tests: self-test 13/13 with results identical to before; scripted checks of loop detection, take-backs, trigger order and stops; Basalt Monolith loop ×10; a Full control game; Spanish interface and card names; a friend tab with the Relaxed clock and a nudge. Not tested: the Tournament clock running dry in a real game, French/German/Portuguese on screen (same code path as Spanish).

- 2026-11-04 (interactive session, version 1.10.0): Round 3 items 62–65. New public/js/progress.js; main.js recordProgress runs once per game (setup.progressed) after recordGame, for games with exactly one human seat, no friends, no puzzle or loaded replay. Storage keys: ct.ladder, ct.challenges, ct.badges, ct.rivals. Tests: self-test 13/13, 5 ranked Standard games with a scripted human seat, challenge and badge unlocks, Rivals Play, new season. Not tested: a ranked Commander pod (same code path, pairwise scoring), streaks across real days.

- 2026-11-04 (interactive session, version 1.9.0): Round 3 items 59–61. In main.js, `formatKey === 'commander'` (not fmt().commander) gates brackets, cEDH data, budget and puzzles, since Brawl, PDH and Oathbreaker also have commanders. loadDeck passes `format` into every resolve call; the commander guess uses commanderOk. Draft / Sealed calls setFormat('limited' or 'commander') when it seats decks. Tests: self-test 13/13, 6 games each of Brawl/PDH/Oathbreaker, a cube draft into a 2–1 Limited match, random Limited (sealed) and a CMR commander pod deck, no simulator errors.

- 2026-11-04 (interactive session, version 1.8.0): Round 3 items 56–58. main.js now has `allSeats` (four) and `let seats = allSeats.slice(0, fmt().seats)`; code that loops over seats sees only the table's seats. `match` holds decks as sideboarded, wins and each game's revealed cards; setup.matchGame ties a game to its place in the match so rewinds don't count twice. Deck objects carry `format` and `sideboard`. Tests: self-test 13/13 (50 cEDH games), 20 Commander, 20 Standard, 20 Pauper and 24 other 1v1 games with no simulator errors, AI best of three 2–0, and a human seat through the sideboard window. Not tested: the friend page in a 1v1 table, server.py/server.ps1 (no endpoint changed).

- 2026-11-01 (version 1.7.3): HumanAgent.instantWindow takes withAbilities (end of opponents' turns, combatResponse) and offers non-sorcery activated abilities (instantAbilities/useAbility); previously the human seat could only activate abilities in its own main phase, so Grim Monolith's {4}: untap was out of reach at instant speed. Jeska's Will: addManaN with dyn 'oppMaxHand' (target opponent with the most cards); the plain 'add {R}' pattern skips 'for each card in'. AI values addManaN with a dyn amount. Tests: cEDH 50/50, 6 games with a scripted human seat (14 abilities used off-turn), no errors.
- 2026-10-31 (version 1.7.2): land searches ask the human seat (Game.fetchLands is async and uses chooseCardsAsync; callers in rampLand, playLand fetches and landcycling await it). Fetch lands read their land types from the card text (e.subs), and searchEffect sets subs for 'a Forest card'-style spells. HumanAgent.chooseCardsAsync groups identical cards into one button with a count. Tests: cEDH 50/50, 10 games with a scripted human seat and a land-search deck, no errors.
- 2026-10-31 (version 1.7.1): manual mana for the human seat (Game.tapForMana, Game.manaUnitsOf; clicking an untapped mana source in HumanAgent.mainPhase/respond/instantWindow taps it into p.pool, which planPayment spends first); untap choices for the human seat (untapAll with n and Winter Orb use chooseCostAsync). Shang-Chi: Game.canTapNow (hasteAbilities covers mana sources and combo checks), 'add two mana of any one color' amount, fx.mana.only ('creatureAbility'/'creatureSpell') with Game.payingFor set in castMode/cast/canActivate/activate and cleared in commitPayment; restricted pool mana keeps its 'only'. Tests: cEDH 50/50, 24 games with a Shang-Chi mana-creature deck, 8 games with a scripted human seat (113 manual taps, 28 untap choices), no errors.
- 2026-10-31 (interactive session, version 1.7.0): card scan fully read 77% → 81% (2,832 of 3,500). Statics: tribal keyword lords (singular() for subtypes, kwList2 adds fear/landwalk/riot), granted ward (Game.wardOf; ward can cost mana and life), noGain, spellCap (Game.castThisTurn), noCounterAll, noPrevent, preventMe, untapLock, hand size, keepRed (setPhase keeps red mana), oppEnterTapped for artifacts and nonbasic lands, costReduce minMv/first/from/cmdZone, tDyn and more P/T counts. Alt costs: altSac (Flares), altPitch (Commandeer), altBounce (Daze), evokePitch (Solitude). Replacements in Game.move before 'died' is decided: Rest in Peace, Yawgmoth's Will exile, oppDieExile (Liesa, Gisa, Darkness Crystal), God-Eternals third from the top; gyLock (Grafdigger's Cage) stops the move and trigger() ignores etb off the battlefield. Keywords: suspend (p.suspended, cast free at upkeep with haste), miracle (o.miracleTurn, castable that turn), entwine, exploit (fx.exploitFx). freeCounter (Boromir, Lavinia) counters spells with no mana spent; castWhen for combat-only spells. cleanText no longer reads rules words (Mana Flare, Sacrifice, Flashback) as the card's own name. Tests: cEDH 50/50, 40 mixed decks with the new cards plus 12 more checked for log markers, no errors.
- 2026-10-31 (interactive session, version 1.6.0): card scan of the 3,500 most-played Commander cards, fully read 62% → 77% (2,706 cards). Triggers: creatures of a kind dealing damage or attacking, attacks on you, second draw/spell each turn, spells cast from outside the hand, counters put on things, cards leaving/entering graveyards, leaving the battlefield, becoming tapped/untapped, searching, land plays, crimes, the Ring, proliferate, postcombat main, class levels, cycling; "one or more" triggers batch once (Game.fire `once`); trigger doublers (Panharmonicon, Yarok, Roaming Throne, Isshin) in Game.extraTriggers; thresholds (station charge counters, class level, max speed) via `gate` and Game.gateOk. Costs: mill, untap creatures, exert, -1/-1 counter on self, exile a creature, remove counters from among, forage, energy, station taps. Keywords: dredge, hideaway (hidden card goes to hand), overload, transmute, offspring, warp (as dash), umbra armor, station, gift (never promised), mobilize, start your engines, escalate (one mode), bargain (never bargained). Statics: replacement effects (life +1, counters double/plus one, extra artifact tokens, Chatterfang, draw doubling, proliferate twice, Underrealm Lich, Notion Thief, Narset, Dauthi Voidwalker, Blightsteel), colored/typed cost reductions and taxes (Helm of Awakening, Defense Grid, Aven Interrupter), activated-ability reductions and locks (Linvala, Collector Ouphe), Urborg/Yavimaya, Blood Moon, Nykthos, Bloom Tender, Gaea's-Cradle-style counts, Goldspan, Nyxbloom, Chromatic Orrery, filtered anthems, conditional equipment, Kenrith's Transformation-style auras, evasion statics, attack caps, Teferi (sorcery-speed opponents), Elesh Norn MoM, Platinum Angel, Divine Visitation, Torbran, Gisela, Shalai, legend rule off. Effects: Windfall/Timetwister, Living Death, Chaos Warp, Maze of Ith, Insurrection, Teferi's Protection, Shadowspear, Ring tempts, transform (back face kept from Scryfall), d20 tables, Yawgmoth's Will (cast cards are exiled), copy that spell, double power, one-sided wipes. Bug found while testing: a "return that card" reading made Restoration Angel blink itself forever; fixed (blink pattern wins, AI never blinks its own blinker) and a 600-per-turn cap was added to Game.flushTriggers. Also: Mana Vault/Grim and Basalt Monolith no longer untap for free. Tests: self-test 50 games (no errors), 40 games with random decks from the scan, 40 with decks of new-rule cards, 48 mixed; no crashes or simulator errors.

- 2026-10-28/29 (interactive session, across one usage-limit reset): items 1–32 done and tested. Final check: 40 fast games across 14 real EDHTop16 lists and the 4 presets, no simulator errors; online seats, spectators, chat, reconnect and rewind tested with two browser tabs; server.py tested with Python 3.13 (every endpoint, a full game, the update installer); the .exe update installer tested in a throwaway copy. Scryfall rate-limited this PC (HTTP 429) after heavy testing, so the client now backs off and retries. Version 1.1.0.
- 2026-10-29 (interactive session): round 2, items 33–55, done and tested; version 1.2.0. Final self-test: all 13 checks, 50 games with no simulator errors. Bugs found and fixed along the way: non-control auras logged "has no legal target", two log lines had lost their names and numbers, a replaced game could clear an online friend's new question, and server.ps1 returned truncated room answers. Not tested here: server.py on a real Mac or Linux machine, and starting the Cloudflare tunnel from start.bat.
- 2026-10-30 (interactive session, version 1.5.1): flashback fixed (non-mana flashback costs via parseCostText, Past in Flames/Snapcaster grants, one log line per cast); Spirit Guides exiled by choice (Game.exileForMana, human main phase) and no longer shown as open mana. Card scan 58% → 62% fully read: short-name aliases in cleanText, "until end of turn, X" reordering, may-gain/that-much life, mana value limits, and/or removal, Thoughtseize/Cabal Therapy hand picks, rebound, leylines, deck-building lines as read, token/conditional/opponent anthems, Thalia taxes, Teysa, Utopia Sprawl, graveyard anthems, Bloodghast, spree, free casts, Howling Mine, Stranglehold. Remaining 1,328 cards with an unread line are mostly single-card effects. Self-test 13/13.
- 2026-10-30 (interactive session, version 1.5.0): 50 improvements. Card text (scan of 3,500 cards, fully read 53% → 58%): counters on any target/each, double counters, team keyword pumps, copy-of-it tokens, arrange the top cards, return-self to battlefield/hand, "that many"/"its power"/"greatest power" amounts, fog, win effects (Lab Man, Oracle's devotion check), exile/untap self, can't be blocked, keyword counters, manlands, attach self, modal triggers and abilities, "you may pay X. If you do", choose color/player, Chromatic Lantern, opponents enter tapped, self cost reduction, per-X buffs, mana doublers, damage double/triple, life doubling, Grand Abolisher, ascend, gods' devotion, must attack, chosen-type cost reduction. AI: fogs lethal attacks, no free Monolith untaps. UI: "Not simulated" in previews, pile flash and tooltips, G/X/L keys, playable count on the pass button, chosen type/keyword counter/dormant/animated badges, pact and blessing chips. Fixed along the way: Thassa's Oracle winning on an unread condition, Mana Vault untapping for free. Self-test 13/13.
- 2026-10-30 (interactive session, version 1.4.2): per-line read tracking (fx.unread; ignoredText reports partly read cards). Scanned the 3,500 most-played Commander cards (Scryfall, EDHREC order): fully read 44% → 53%. Added borrowed abilities (Game.abilitiesOf: Marvin, Necrotic Ooze), chosen creature type, keyword anthems, token doublers, extra land drops, no max hand size, counted P/T, cast triggers, general onCast/onDeath filters (colors, tribes), edict counts, "that player" via trigger info, poison, pacts with an AI affordability check. Self-test 13/13. Next: the remaining unread families ("at the beginning of" variants, "whenever one or more", d20/energy/initiative, level up, gods' devotion).
- 2026-10-30 (interactive session, version 1.4.1): library/graveyard/exile shown as labelled piles beside each hand (top card shown, click to open); deck name removed from the in-game header. One cost reader (effects.js parseCostText) for activated abilities and spells' additional costs: tap, mana, life, discard (typed), sacrifice self/others, exile from graveyard, tap other permanents, remove counters, return to hand; Game.canActivate/payCosts enforce and pay them, the AI prices them (never its commander), human seats choose and may reuse abilities. Survival of the Fittest no longer tutors for free. Self-test 13/13.
- 2026-10-29 (interactive session, version 1.4.0): mechanics pass from the Comprehensive Rules lists (701 keyword actions, 702 keyword abilities): a generic trigger system (effects.js WATCHERS, Game.fire) with a 300-per-turn cap; "if"/"instead"/"as long as" conditions and ability words; scry, surveil, dig, impulse draw, play from the top of the library; typed regrow and reanimation, mass reanimation, graveyard hate; tap/sacrifice/life/discard ability costs, Clue/Food/Blood/Map tokens, Cradle mana, crew, living weapon; about 60 keyword abilities and 20 keyword actions; the monarch; human prompts for scry, tutors and digs (searchable list), kicker, buyback, cycling, crew and graveyard abilities; deals of 0–5 rounds. Self-test 13/13; 40 games with mechanic-heavy decks, 0 errors.
- 2026-10-29 (interactive session, version 1.3.0): combat AI by simulation (combatai.js; ideas from Forge's AiBlockController/AiAttackController and XMage's simulation players, no code copied), tuned head to head against the old pilots (+7 to +19 points of win rate depending on style); overextension and protection-mana habits; battle preview; particle effects (fx.js); generated background music (music.js) on the Sound switch; Arena-style visual pass. Self-test: 13/13.
