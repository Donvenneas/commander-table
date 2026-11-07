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
- [ ] 80. Smarter AI drafters from 17Lands ratings: per-set card ratings (GIH WR / ALSA) where 17Lands has the set,
  blended with today's heuristics (color commitment, curve); fall back to today's picks elsewhere. Show "AI pick
  ratings: 17Lands" in the draft window. Check and respect 17Lands' data usage guidelines first; skip the item if
  they don't allow it.

### Card coverage
- [ ] 81. Scryfall bulk data ("Oracle Cards" file, once a day when asked) for random decks, the builder and the card
  scan, instead of many search calls; falls back to the API when there's no bulk file.
- [ ] 82. Coverage pass using Forge's and XMage's card lists as a checklist (ideas only): rerun the scan of the 3,500
  most-played Commander cards, take the most common unread lines, and model them. Target: 81% → 88% fully read.

### AI
- [ ] 83. Look-ahead for main-phase decisions: for the top 3 candidate plays, simulate the rest of the turn and the
  opponents' next combat on a cloned game (like combatai.js does for combat) and pick by the result. Time-boxed per
  decision so fast games stay fast; tuned head to head against today's pilots with the matchup grid.

### Developer tooling
- [ ] 84. Type-check the big modules with `// @ts-check` and JSDoc (engine.js, effects.js, ai.js first) using the
  TypeScript compiler in CI only (no build step for players); fix what it finds.

## Notes from sessions

- 2026-11-07 (interactive session): project put in git and on GitHub; CLAUDE.md and the `test-commander-table` project
  skill added; CI self-test (Playwright, server.py) and tag-based release workflow added. Security review of the three
  servers: server.py had no Host-header check, so a DNS-rebinding website could reach /api/update and replace the
  game's code; and all three servers let any website trigger host-only room actions (open the network port, start the
  tunnel, close the room, push questions to friends) with simple cross-site requests. Fixed: every /api/ call to the
  local server must come from the game's own page (Origin and Sec-Fetch-Site checked; server.py also checks Host).
  Tested with forged requests against the .exe, server.py and server.ps1 (all refused) and the self-test 15/15.
  Not fixed (low risk, noted): a friend with the room code can view another seat's hand by changing ?seat= in the
  link; room codes are 6 hex characters with no rate limit.

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
