# Commander Table

Watch four AI pilots play a game of Magic: The Gathering Commander in real time, or take a seat and play against them.

## Run it

Double-click **`Commander Table.exe`**. It opens the game in its own window, with no browser tabs or command window. You can pin it to the taskbar or Start menu.

- The first time you open it, Windows may show "Windows protected your PC", because the program isn't digitally signed. Click **More info**, then **Run anyway**. You only need to do this once.
- **Which browser it uses:** Commander Table never uses Microsoft Edge.
  - It opens in your default browser, or, if that's Edge, in another installed browser.
  - Chrome, Brave, Vivaldi and Chromium open a tab-free app window. Firefox opens its own window.
  - Either way it uses a private profile in the `data` folder, so it never touches your everyday browsing, history or logins.
  - To choose a browser yourself, start the program with `--browser="C:\path\to\firefox.exe"`. You can add that to a shortcut's Target.
  - If Edge is the only browser on the PC, Commander Table puts the game's address on your clipboard to open in any other browser.
- To quit, close the window or click **Exit** in the top bar. A tray icon by the clock also has **Open** and **Exit**.
- Opening the program again while it's running just opens another window on the same game.
- Keep the .exe in this folder, next to `public` and `cache`.

To run just the server and tray icon, and use your own browser, start the program with `--no-window`. You can add that to a shortcut's Target.

`start.bat` still works the old way (a PowerShell window plus your browser at http://localhost:8777). To close it, click **Exit**, or close the PowerShell window.

To rebuild the .exe after changing the launcher code in `launcher/`, run:

    powershell -ExecutionPolicy Bypass -File launcher\build.ps1

It uses the C# compiler that comes with Windows, so nothing needs installing.

**Start menu:** the game opens on a start menu: **Play** (the setup screen), Learn to play, Story, Expedition (showing a run in progress), Draft / Sealed, Puzzles, Tabletop, Deck builder, Deck library, Progress (open challenges and your streak), Settings (Display) and Updates, plus Tour, Self-test and Exit. It also shows new and upcoming card sets. **Menu** in the top bar and on the setup screen brings it back (a game in progress pauses). A challenge link skips the menu and opens the setup screen.

**New here?** The first time you open the setup screen, a short **Tour** points out the main controls; the Tour button shows it again. **Self-test** on the setup screen checks the local server, the online services the game uses, and plays 50 fast games, with a pass/fail list. It also runs a **rules check**: 20 more games watched step by step for broken card interactions (a card in two zones, a creature or player that should have died, an aura attached to nothing, a commander stuck in a graveyard, two copies of a legend).

## Moving it to another PC

The whole game lives in this one folder, so you can move or copy it anywhere: another folder, a USB stick, a cloud drive, or another computer. Nothing is installed, and nothing outside the folder is needed.

- **What the other PC needs:** Windows 10 or 11 (which includes .NET Framework 4, the only other thing the program needs), a web browser other than Microsoft Edge (such as Chrome, Firefox or Brave), and an internet connection for card images and deck imports.
- **To move it:** copy the whole `MTG AI Arena` folder, or use the ready-made zip, `Commander Table (portable).zip`, next to it in Downloads. Extract the zip first (right-click it, then **Extract All…**), then open `Commander Table.exe` inside the extracted folder. Running the .exe from inside the zip doesn't work.
- **Keep the folder together.** `Commander Table.exe` needs `public` and `cache` beside it. To start it from the desktop, make a shortcut instead of moving the .exe.
- **Your settings travel with it.** The app keeps its window settings (seats, decks, theme) and the internet-play tool in a `data` folder inside this one. Copy the folder with `data` to bring them along. Leave `data` out, as the zip does, to start fresh or to share the game with a friend.
- **On a new PC,** Windows shows "Windows protected your PC" once: click **More info**, then **Run anyway**. If the folder came from a download, you can also right-click the zip, choose **Properties** and tick **Unblock** before extracting.
- **Read-only places** (a write-protected USB stick or a network share without write access) still work. Settings are then kept in that PC's AppData instead, and the bundled copy of the rules is used.
- **Mac and Linux** can host too, with `server.py` (see below). **Phones and tablets** can join a game: send them an online seat's link, join code or QR code.

## Mac and Linux

`server.py` is the same local server written in Python, using only its standard library (Python 3.8 or newer, which macOS and most Linux systems already have). It has everything the .exe has: deck imports, rules, the card image cache, the deck library, updates, online seats and internet play.

- **Linux:** in a terminal, in this folder, run `sh start.sh`.
- **macOS:** double-click **Start Commander Table.command**. If macOS won't open it, run `chmod +x "Start Commander Table.command"` once in Terminal, or use `sh start.sh`.
- Either way the game opens in Chrome, Firefox, Brave, Vivaldi, Chromium or Safari (never Microsoft Edge). Close the terminal window, or click **Exit**, to stop it.
- `python3 server.py --no-browser --port 8777` runs just the server.
- `sh start.sh --check` (or `python3 server.py --check`) checks the computer first: Python version, the game files, write access to the `data` folder, free ports, a browser, and the internet connection, each with what to do if it's missing. (Tested on Windows; the Mac and Linux browser detection hasn't been tried on those systems yet.)
- For internet play it downloads Cloudflare's `cloudflared` for your system from Cloudflare's GitHub releases the first time (or uses one you already installed).
- It also runs on Windows (`py server.py`), as a third way to start the game.

## Offline play

After a deck has been loaded once, it loads without an internet connection:
- card data is kept in the game window's browser profile (refreshed after 30 days when online)
- card images and mana symbols are kept in `data\images` by the local server (up to 400 MB; the oldest are dropped first)
- EDHTop16 and cEDH Decklist Database results are kept too, so the meta browser and meta decks still work; the status line says when it shows a saved copy

## Updates

**Updates…** on the setup screen installs a newer version from an address you choose, such as a GitHub release's download link for a zip of this folder. Nothing is checked or installed by itself.
1. Paste the https address and click **Download and check**. It shows the version in the zip (from its `VERSION` file) and how many files it has.
2. **Install** copies the files over this folder. The `data` folder is never touched, and every file it replaces is backed up to `data\update\backup-<date>` first.
3. Restart Commander Table to finish.

Only use an address you trust: an update replaces the game's code.

For the official versions, use the project's GitHub releases address, which always points at the newest one: `https://github.com/<owner>/commander-table/releases/latest/download/commander-table.zip`.

**Safety:** only the game's own page on this PC can use the local server's controls (deck library, updates, opening online seats, exit). Requests from other websites you have open are refused.

**New card sets:** the game asks Scryfall for its list of Magic sets once a day when it starts (untick **Check once a day at startup** in Updates to stop it), and whenever you click **Check for new sets** in Updates.
- New releases since the last check, and sets coming soon, show on the start menu and in Updates.
- When a new set is out, saved card data from before it is fetched again the next time a deck needs it (legalities and Standard rotation change with new sets). Offline, the saved copies are still used.
- The newest draftable sets are added to Draft / Sealed and the Expedition.

**Card file (optional):** **Download the card file** in Updates saves Scryfall's free bulk card file (every card, about 25 MB to download) in the game's browser data.
- Random decks of every kind, the deck builder's searches and decks loaded by card name then come from this PC: a random Commander deck takes about a tenth of a second instead of two, and works offline.
- While it's on, a newer file is fetched at most once a day when the game starts (only if Scryfall has published one).
- Searches it can't answer still go to Scryfall: a set's cards for Draft / Sealed, specific printings, and search terms it doesn't know.
- It has one printing per card, so searches that depend on rarity or paper availability can find slightly fewer cards than Scryfall would.
- **Turn off and remove** in Updates deletes it.

## Privacy and sharing

The game folder contains no personal information: no names, accounts, email addresses, computer names or file paths from the PC it was made on. It has no tracking or analytics, and it never sends anything about you anywhere.

**What stays on your PC:**
- The `data` folder, created when you first run the program, holds the game window's private browser profile (your seat setup, theme, game history, what each deck's AI has learned, and saved card data), your deck library (`data\decks`), cached card images (`data\images`), update backups, the internet-play tool, and the address of the running game.
- Nothing in `data` is needed to play. Leave it out when you share the game.
- **`make-shareable-zip.ps1`** builds `Commander Table (portable).zip` without `data`, and refuses to build if any file mentions your Windows user name, computer name or home folder:

      powershell -ExecutionPolicy Bypass -File make-shareable-zip.ps1

**Who the game talks to,** and only to load game data:

| Service | What for |
|---|---|
| Scryfall | card data, images and mana symbols (and the card file, only if you download it) |
| Archidekt, MTGGoldfish, TappedOut, Moxfield | the decks you link |
| EDHTop16, cEDH Decklist Database | cEDH meta data |
| Commander Spellbook | combos and its bracket estimate |
| CubeCobra | only the cube lists you add |
| MTGJSON | booster contents for Draft / Sealed |
| Wizards of the Coast | the Comprehensive Rules |
| Cloudflare | only when you click **Play over the internet** |
| The update address you enter | only when you click **Download and check** |

Like any website you visit, these services see your internet address, but no account or personal details. The game doesn't load web fonts or anything else from Google.

**Online play:**
- Friends see only the game: seat names you typed, decks and the board.
- Home-network links include your PC's local network address (for example 192.168.x.x), which only works inside your network.
- Internet links use a random Cloudflare address, so friends never see your home internet address.
- Each link needs the room code. Nobody can reach your files, the rest of the app, or anything else on your PC.
- Chat messages go to everyone at the table, spectators included.
- **Explain** lines (which can reveal hands) are never sent to friends or spectators.

**Replays and logs** you save contain the seat names you typed. Use nicknames if you plan to share them.

## Formats

**Format** on the setup screen sets the rules for the table. Commander is the default; the others are one-on-one, with two seats.

| Format | Players | Deck | Life | Notes |
|---|---|---|---|---|
| Commander | 4 | exactly 100, one of each, a commander | 40 | 21 commander damage, first mulligan free |
| Standard, Pioneer, Modern, Legacy, Premodern | 2 | at least 60, up to 4 of each | 20 | 15-card sideboard |
| Pauper | 2 | at least 60, commons only | 20 | 15-card sideboard |
| Brawl | 4 | exactly 60, one of each, Brawl-legal; a legendary creature or planeswalker as commander | 25 | no commander damage |
| Pauper Commander | 4 | exactly 100, one of each, commons; an uncommon creature as commander | 30 | 16 commander damage |
| Oathbreaker | 4 | exactly 60, one of each; a planeswalker (the oathbreaker) and an instant or sorcery (its signature spell) | 20 | no commander damage |
| Limited (draft or sealed) | 2 | at least 40, from a draft or sealed pool | 20 | the rest of the pool is the sideboard |

- **Oathbreaker:** put the planeswalker and the signature spell under the `Commander` heading. The signature spell can only be cast while its oathbreaker is on the battlefield. Like the oathbreaker, it goes back to the command zone, and each costs {2} more for every earlier cast from there.
- **Pauper Commander:** the commander is checked by its own rule (an uncommon creature), since Scryfall lists uncommons as not legal in the format.
- Brawl, Pauper Commander and Oathbreaker have no brackets or EDHTop16 decks. An empty seat gets a random deck for the variant, built from Scryfall's most-played cards that are legal in it.
- **Limited:** an empty seat gets a random sealed deck: six packs of a recent set, built into 40 cards.

- Each format keeps its own deck links and lists, so switching back and forth doesn't lose them.
- Decks are checked against the format: size, copies, sideboard size and legality (from Scryfall). An illegal deck still plays; the seat shows a warning.
- In one-on-one games the player who goes first skips their first draw (rule 103.8a), and every mulligan puts a card on the bottom (no free mulligan).
- An empty seat (or `random`) gets a random 60-card deck for the format: one or two colors, nine of the format's most-played cards in those colors as 4-ofs along a mana curve, 24 lands, and a 15-card sideboard of interaction.
- Brackets, the cEDH buttons, the meta browser and Puzzles are Commander-only and are hidden in the other formats. **Draft / Sealed** is always there; it switches the table to Commander or Limited. Batch runs, the matchup grid and tournaments (in pods of two) use the table's format.

### Best of three

In a one-on-one format, set **Match** to **Best of three**. The first player to win two games takes the match.
- After each game the results show the match score. **Next game** goes on to the next one; **New match** starts over with the decks as they were before sideboarding.
- The loser of the last game chooses who goes first. When you play a seat and lose, the sideboard window asks whether you go first or draw first. AI players always choose to go first.
- **Sideboarding:** when you play a seat, a window lists your deck and sideboard. Click a card to move one copy across. **AI sideboard** suggests swaps, **Undo changes** resets, and **Play** starts the next game (the deck can't drop below 60 cards).
- AI players sideboard against what their opponent showed in the match's earlier games (cards played or revealed, never the decklist): artifact and enchantment removal against those card types, sweepers and lifegain against fast creature decks, counterspells and discard against slow decks, graveyard hate against graveyard decks, and so on. The results list every swap.
- Online friends keep their deck as it is between games.
- Saved replays keep the format and who went first, and include the deck as it was sideboarded for that game.

## More ways to play

- **Learn to play:** seven short lessons for people new to Magic, one turn each: lands and mana, attacking, blockers, removal, combat tricks, your commander, and a final exam. A coach panel beside the table explains each step (× hides it). Finished lessons get a ✔, and the results offer the next lesson.
- **Story:** *The Lantern Road*, an original story in four chapters. Each chapter is a line of story, then a whole one-on-one game from a special starting board (your opponent may already have creatures out, or creatures in the graveyard). Win a chapter to open the next.
- **Expedition:** a solo roguelike. Pick a set and a difficulty, and you set out with 16 of that set's commons and uncommons in two colors (lands are added for every fight).
  - Each of three acts is four steps and a boss. At every step you choose one of two roads: a **duel** (a rival with a deck from three packs), an **elite rival** (six packs, a rare as the reward), an **event** (a smith's rare, a shrine to leave cards behind, a healer, a stranger's trade) or a **rest stop** (+3 life next fight, or thin your deck).
  - Every fight is a real one-on-one game. Win and you choose one of three cards for your deck; lose and the expedition is over.
  - **Easy:** +5 life in every fight, looser rivals, and one lost fight per act forgiven. **Normal:** even fights. **Hard:** rivals start with 4 extra life and play at full strength.
  - The run is saved as you go, so you can close the game and continue. There's no shop: rewards are cards for that run only.
- **Manual tabletop** (a format of its own: **Manual tabletop (2–9 players)**, or **Manual tabletop** on the start menu): a fully manual game with no automation, for house rules, cards the engine can't read, or playing Magic as you would at a real table.
  - Choose **Players** (2 to 9) and **Starting life**. Any deck loads: a Commander list puts its commander in the command zone, and a 60-card list plays as it is.
  - The only thing done for you is shuffling each library at the start. No hands are dealt, nothing untaps or draws by itself, and no one wins or loses by themselves.
  - **Your own cards:** click a card for its moves: to the battlefield (face up or face down), hand, graveyard, exile, top or bottom of the library, or the command zone. On the battlefield: tap/untap, ±1 counters, turn face down or up, and **give control** to another player. In hand: **Reveal it**.
  - **Each board:** Draw, Draw 7, Draw X, Mulligan, Untap all, Shuffle, **Look at the top N** (only you see them; move any of them, then Done or Done and shuffle), **Search** (your whole library, same way), Mill, Token (a War Bear token gets its picture), Reveal hand, commander damage from each opponent, life ±1/±5, poison, and Eliminated.
  - **The table:** phase buttons, Pass the turn (skips eliminated players), d6, d20 and a coin. Everything goes in the log.
  - **Seats:** a seat is "Played on this PC" or "A friend plays this seat (online)"; there are no AI players at a manual table. When several seats share this PC, **Viewing as** picks whose hand (and Kingdoms role) the screen shows, or Nobody while you pass the device.
  - **Online:** friends join with **Invite**. They move their own cards from their page (moves are sent one at a time and confirmed), and see every public zone plus their own hand and role.
  - The **Tabletop** button on the setup screen opens a manual table with the current format's decks.
- **Kingdoms** (format **Kingdoms (5–9 players, secret roles)**, or **Kingdoms** on the start menu): Advanced Kingdoms v1.56, a fan-made Commander variant with secret roles. It plays two ways: pick it with **Table** on the setup screen.
  - **Rules engine: you, friends and AI bots** (the default). Each seat is you, a friend online, or an AI bot (any AI style, or Auto). The engine deals the roles from the game's seed (replays deal the same), and it tracks:
    - teams (face-up roles of the same type, and a face-up Knight with the King);
    - who eliminated whom (damage, and life loss from their spells and abilities);
    - every Victory and Defeat condition. A whole team can win together, and "win the game" cards and combos do nothing.
  - **Role chips:** every board shows its role chip: your own role (🔒 while face down), face-up roles, eliminated players' roles, and Bandits see Bandits. Hover a chip for its Victory, Defeat and ability.
  - **Announce:** the **Announce** button in your main phase uses your role. The Wizard's button appears when someone casts a spell.
  - **Automated:** these abilities resolve on their own: the Marksman, Priestess, Bear Trainer (three hasty 2/2 War Bears), Thief, Giant, Necromancer, Stalker, Wizard (exile a spell) and Zealot.
  - **Announce at their moment:** these turn face up by themselves when their moment comes:
    - the Queen saves the King from lethal damage;
    - the Knight in Shining Armor sends lethal combat damage back to the attacker, who skips their next combat;
    - the Rightful Heir and the Kingslayer;
    - the Cultist converts the player it would eliminate;
    - the Mimic, at 20 life or less (it also runs the upkeep drain and the equal-life eliminations);
    - the Champion picks the Challenger.
  - **Not automated:** the Schemer, Sellsword, Field Marshal and Straw Man abilities, the War Bears' {Q} ability, the Wizard's retarget mode and the Champion's scry. Announcing these only reveals the role. The Straw Man's own Victory condition is checked.
  - **AI bots play their role:**
    - Assassins hunt the King. Knights never attack him and go after whoever is hurting him. Bandits and Renegades keep the King alive while Assassins remain, because his fall would end the game against them.
    - Nobody finishes off an ally, and a bot doesn't fire an "each opponent" combo that would take one down.
    - Bots Announce when it pays off, for example the Marksman at a lethal moment or the Priestess when the King has far more life.
  - **Table size:** 5 and 6 seats sit three across; 7 to 9 sit in a 3×3 grid. Friends online see their own role and every face-up one.
  - **Manual tabletop: people only, no automation:** the same roles on the manual tabletop described below.
  - Choose 5 to 9 players and seat Commander decks. Roles are dealt by the format's table: 5 players get 1 King, 1 Knight, 2 Assassins and 1 Renegade; 6 get 1 King, 1 Knight, 2 Bandits and 2 Assassins; 7 add a Renegade; 8 have 3 Assassins; 9 get 1 King, 2 Knights, 3 Bandits and 3 Assassins. Each player gets a random character of the type.
  - The King is face up, starts with 10 extra life and takes the first turn. Bandits see each other's roles.
  - **Your role** shows above the table: its picture (when the role card images are in `public\roles`), Victory and Defeat, its ability in our own wording, and its tips card.
  - **Announce** turns your role face up for everyone and logs its ability. **Change role card** handles the abilities that hand out roles (the Rightful Heir or the Kingslayer's new King gaining the King role, the Cultist's conversions). **Declare victory** marks a winner. **Eliminated** reveals a face-down role.
  - All 26 roles are in: the King; Knights (Queen, Rightful Heir, Knight in Shining Armor, Field Marshal, Kingslayer); Assassins (Marksman, Priestess, Bear Trainer, Schemer, Thief); Bandits (Giant, Necromancer, Stalker, Wizard, Zealot); Renegades (Mimic, Sellsword, Cultist, Straw Man, Champion). The **Kingdoms rules** summary sits at the top of the table.
  - At the manual table nothing about the roles is automated beyond dealing them: players resolve abilities and check Victory and Defeat themselves, as with the printed cards.
  - **Role card art:** the role cards' pictures are official Magic card art (Wizards of the Coast and the artists named on each card), taken from your own copy of the role card PDF. They live in `public\roles` on this PC only: `make-shareable-zip.ps1` leaves them out, so a shared copy shows the roles as text.
- **Challenge links:** **Challenge link…** packs this table's setup (format, match length, each seat's name, style, bracket and deck) into a link and a code. Nothing is stored online: everything is in the link. It opens on any PC running Commander Table (`http://localhost:8777/#challenge=…`), or paste the code into the same window and click **Open**.
- **Deck builder:** **Deck builder** on the setup screen (or **Builder** on a loaded seat) opens a full-screen builder.
  - Search every card on Scryfall with its own syntax (`t:goblin pow>=3`, `o:"draw a card"`), filtered by colors, type, mana value and the table format's legality. Commander formats list the most-played cards first.
  - Click a card or drag it into the deck; drag a deck card back to the results (or use −) to take it out.
  - The card count, mana curve and type counts update as you go, and over-the-limit copies are marked. Commander formats get a ★ to choose the commander, one-on-one formats a sideboard (**SB**).
  - **Put in seat**, **Save to library** or **Copy as text**.

## Progress

**Progress** in the top bar has four tabs. Everything is kept in the game folder's browser profile, with nothing to buy: badges are only for show.

- **Ladder:** tick **Ranked** on the setup screen and play one seat yourself (no friends online). Each format has its own rating (Elo, starting at 1500).
  - Your opponents are the AI pilots. In Commander a pilot is rated by its seat's bracket (bracket 1 = 1200 up to 5 = 1800); in other formats every pilot is 1500. In a four-player game you're scored against each opponent by who placed higher.
  - The first 5 games are placement games. After that your rank is Bronze, Silver, Gold, Platinum or Diamond (each with divisions III, II, I), or Mythic at 1900 and up.
  - In a ranked game, undo, rewinding, Reveal hands and Explain are off until it ends. The results show your rating change.
  - **Start a new season** moves every rating halfway back to 1500 and restarts placement; old seasons stay listed. History shows the ladder too.
- **Challenges:** three daily challenges (new each day) and two weekly ones (new each Monday), such as "Win a game with a red deck", "Cast 15 spells in one game" or "Win a best-of-three match". They count games where you play one seat yourself (not puzzles, loaded replays or online games). Completing at least one daily challenge a day builds a streak.
- **Rivals:** the built-in cEDH decks, your deck library, the current EDHTop16 meta, and decks you've faced. Each has a strength tier (S, A, B or C: its win rate against an even share at its table size, once it has played 5 games) and your record against it. **Play** puts the rival in an AI seat and switches the format if needed.
- **Badges:** earned for challenges, streaks, ladder ranks (Gold, Diamond, Mythic) and deck mastery levels.

**Avatars and card backs:** in **Display**, choose your avatar (shown on the seats you play, instead of the commander's art) and the card back for every face-down card on the table. All are drawn by the game itself. Five avatars and three backs are there from the start; the rest unlock with badges, games played and deck mastery (the locked ones say how).

**Language:** **Display → Language** switches the interface to Spanish, French, German or Portuguese: buttons, labels, headings, tooltips and the most common prompts. Longer explanations, the game log and card rules text stay in English. Card previews show the card's name and picture in your language when Scryfall has a printing in it (looked up the first time you hover a card, then remembered). A friend's page follows the browser's language.

**Deck mastery:** every deck levels up as it plays: 10 points a game and 15 more for a win, up to level 20. The level shows on the seat's picture. The deck viewer shows its progress and its best cards (the ones it cast most in its wins). Decks without a commander are now remembered too (by format, name and card list), so they also learn from their games.

## Decks

Each seat accepts any of these:

- **Archidekt** link: imported directly, with the exact printings from the deck.
- **MTGGoldfish** link: imported directly.
- **Moxfield**: Moxfield blocks downloads from other programs, so use the bookmarklet instead.
  1. On the setup screen, open "Moxfield links don't import?".
  2. Drag the **Copy Moxfield deck** button to your bookmarks bar.
  3. Open a Moxfield deck, click the bookmark, and paste into a seat.
- **TappedOut** link: TappedOut also blocks downloads. Use its export and paste the list.
- **Deckstats** and **Aetherhub** links: both block programs with a bot check, so use their export (Deckstats: Export → Text; Aetherhub: Export → MTGA or MTGO) and paste it.
- **Sideboards** (one-on-one formats): a `Sideboard` heading, MTGO's `SB:` lines, MTGO's trailing block after a blank line, and Archidekt's and Moxfield's sideboards are all kept. Commander decks ignore sideboards.
- **Pasted decklist**: exports from Moxfield, Archidekt, MTGO, MTG Arena (including its About/Name header), Deckstats (`# !Commander`), Aetherhub, and **ManaBox** (text, or its CSV export) all work. Mark the commander with a `Commander` heading, `*CMDR*`, or `[Commander]`. If a set code and collector number point at a different card, the card is found by name instead.
- **Empty seat / `random`**: picks a random commander and builds a deck from Scryfall's EDHREC rankings. If the seat has a bracket, the deck is built for that bracket. **Random decks** on the setup screen can also keep them budget-friendly without looking at prices: no Reserved List cards, or commons and uncommons only (with an uncommon commander, Pauper Commander style).
- **cEDH tournament decks** (from EDHTop16):
  - `edhtop16` or `cedh` loads a random top-meta deck.
  - `edhtop16:Kinnan, Bonder Prodigy` loads the newest top-16 list for that commander. Write partners as `edhtop16:Kraum, Ludevic's Opus / Tymna the Weaver`.
  - You can also paste an EDHTop16 decklist link, an EDHTop16 commander link, or a TopDeck.gg deck link.

When a deck loads, the app asks [Commander Spellbook](https://commanderspellbook.com) for every known combo in it. If Spellbook can't be reached, the built-in list of 45 combos is used.

To swap two seats, drag one seat's ⠿ grip onto another seat.

### Deck viewer

**View deck** on a loaded seat shows:
- the mana curve, color pips and card types
- the deck's combos
- **what the simulator understands**: the share of non-basic cards it reads at least part of, and a list of cards whose abilities it ignores. Ignored cards are still cast, but their real strength isn't reflected in results.
- after a batch run with the deck seated: its key cards, and cards that may be worth cutting
- **Compare with recent EDHTop16 lists for this commander**: the cards at least half of the recent top-16 lists play that yours doesn't, and your cards none of them play
- **what its AI has learned**: after every finished game (batch runs especially), each deck remembers which of its cards it cast and whether it won. After 5 games, cards that show up in its wins get a small bonus when its AI chooses what to cast, and cards seen mostly in losses a small penalty. **Forget what it learned** resets it. Replays keep the values from when the game was played, so they replay exactly.

### Deck editor and library

- **Edit** on a loaded seat opens its list. Delete a line to remove a card, or type a name (Scryfall suggests names as you type) and click **Add**. **Apply to seat** reloads the deck; **Apply and test 10 games** also runs a 10-game batch.
- **Save to library** keeps the list in the game folder (`data\decks`), so it travels with the folder.
- **Deck library…** on the setup screen lists your saved decks: filter them, load one into a seat, or delete it.

## Playing a seat yourself

In a seat's style menu, choose **You play this seat**. Your hand is shown face up, and an action bar at the bottom asks for each decision:

- whether to keep your opening hand, and which cards to put back after a mulligan
- in your main phases, what to play: click a highlighted card to play a land, cast a spell (including from your graveyard with flashback), activate a planeswalker or ability, equip, or sacrifice
- which permanents pay: click an untapped land, mana creature or mana rock (in your main phase, or when you're asked to respond) to tap it for mana yourself. The mana waits in your pool, shown in the action bar, and is spent first; anything still owed is tapped for you. The pool empties at the end of the step
- what every search of your library finds: tutors, fetch lands (only the land types printed on them, such as an Island or Swamp for Polluted Delta), land-search spells like Cultivate, Nature's Lore and Rampant Growth, and landcycling. Identical cards share one button with a count (Forest ×20); for Cultivate-style spells the first land you pick goes onto the battlefield
- which permanents to untap, when an effect untaps some of them (Frantic Search, Snap, Peregrine Drake) or Winter Orb lets only one land untap
- targets for your spells and for your planeswalker and triggered abilities: click a card or a player's board, or let the AI pick
- attackers, who to attack, and blockers
- responses to opponents' spells and abilities, combat tricks, and end-of-turn plays (you're only asked when you have something you can cast). At the end of each opponent's turn and when you're attacked you can also use activated abilities that aren't sorcery-speed, such as untapping Grim Monolith or cracking a Clue
- which cards to discard
- deal offers, and whether to pay Rhystic Study-style taxes ("Pay {1}, or they draw a card?")

**Undo** (or the U key) takes back your last decision: the game is rebuilt from its seed with your earlier answers replayed.

**Stops** (⏸ Stops in the top bar) sets where the game stops for the seats you play:
- **Full control:** stop at every priority point, even when you have nothing to play.
- **Steps to stop at:** upkeep, draw step, beginning of combat and end step, on your turn and on opponents' turns. Each stop shows a Pass button, plus any instants and abilities you could use.
- **Trigger order:** when several of your triggers happen at once, you choose which resolves first (or **Order them for me**). Untick it to let them resolve in the order they happened.
- Changes apply from the next game; a game keeps the stops it started with, and saved replays remember them.

**Taking back a tap:** click a land or mana source you tapped by hand again to untap it and take its mana back out of your pool. This works while that mana is unspent and the step hasn't changed, but not for a source that sacrificed itself, discarded your hand, or set off a "becomes tapped" trigger.

**Loop shortcut:** play the same abilities twice in a row in your main phase (for example tapping Basalt Monolith for mana, then paying to untap it) and the action bar offers **Repeat this loop ×10** or **×99**. Every pass is checked, and it stops at the first step that can't be done the same way; the log says how many times it ran and why it stopped.

**Loops nobody can stop:** when the same few triggers keep repeating 600 times in a turn with nothing else happening, the game ends in a draw (rule 104.4b). A long chain of different triggers still just stops there, as before.

**Deals:** when you play a seat, **🤝 Deal** under the game log offers another player a truce, a gang-up on the archenemy, a no-counterspell pact, or tribute. It's put to them at the start of the next turn.

**Hotseat:** choose **You play this seat** for two or more seats to share one PC. Before each person's decision, every hand is hidden behind a "Pass to …" screen; after **I'm ready**, only that person's hand shows.

Keyboard shortcuts:
- Space or Enter: the highlighted button
- Esc: cancel or pass
- 1–9: the nth button
- A: let the AI decide
- U or Ctrl+Z: undo
- Space when it isn't your decision: pause or resume
- N or →: step

## Brackets

Every seat has a **bracket** menu, using Wizards' Commander Brackets. **Bracket for every seat** on the setup screen sets all four at once.

| Bracket | What it means | A generated deck for it… | The AI plays… |
|---|---|---|---|
| 1 Exhibition | ultra-casual, themed | has no Game Changers, tutors, extra turns, mass land destruction or two-card combos, and skips the most-played staples | loosely, with casual choices |
| 2 Core | precon level | has no Game Changers, extra turns, mass land destruction or two-card combos | a little loosely |
| 3 Upgraded | stronger | has up to three Game Changers, and no two-card combos or mass land destruction | sharply |
| 4 Optimized | high power | has anything legal | at full strength |
| 5 cEDH | competitive | is a real tournament list from EDHTop16 | in the cEDH style |

The bracket shapes the deck when a seat is empty or set to `random`. Game Changers come from Scryfall's copy of Wizards' official list.

Every loaded deck shows its **estimated bracket** next to its name. Hover it to see why: which Game Changers, two-card combos, extra turns or mass land destruction it contains. If a deck plays above the seat's bracket, you get a warning. Bracket 1 is about a casual theme, which can't be read from a list, so estimates start at 2.

Next to it, a dashed chip shows **Commander Spellbook's own estimate** (Exhibition, Core, Oddball, Powerful, Spicy or Ruthless; hover for its count of Game Changers and two-card combos). If Spellbook finds a card that's banned in Commander, the seat says which.

**Deal a matched table** replaces all four decks with random decks of the table's bracket (bracket 3 if none is chosen) and loads them.

## cEDH meta data

**Browse the cEDH meta…** on the setup screen has two tabs:

- **EDHTop16: top commanders**: the most-played commanders in tournaments, with meta share, win rate, top-cut rate and number of entries. Filter by time period (last month to all time, or since the last ban), minimum event size (16 to 128 players) and exact color identity. **Seat the top 4 meta decks** fills the table using the same filters.
- **cEDH Decklist Database**: the community's curated archetypes, grouped as Competitive, Brew and Outdated, with descriptions, Moxfield lists and Discord links.

The seat buttons (1–4) on any row load the newest top-16 tournament decklist for that commander from EDHTop16, and set the seat to bracket 5.

The Decklist Database's own lists are on Moxfield, which blocks downloads from programs, so the cards come from EDHTop16's results for the same commanders. To use a database list exactly, open it on Moxfield and use the bookmarklet.

## Playing with friends online

Friends can each take a seat from their own computer, tablet or phone, with nothing to install, either on your home network or **over the internet from anywhere**. The AI pilots play the other seats.

1. Open Commander Table with **Commander Table.exe**, `start.bat`, or `server.py` on a Mac or Linux.
2. In a seat's style menu, choose **A friend plays this seat (online)**. You can do this for as many seats as you like, and still play a seat yourself.
3. To let friends bring their own decks, click **Open lobby…** first: friends who join see a lobby where they paste a decklist or pick one of the decks in your library, and you see what each one chose. Then load the decks. The **Invite** panel shows, for each friend's seat, a link, a **QR code** to scan with a phone, and a **join code** like `K7Q2XF9ABM-2`. Friends open the link, scan the code, or open the address shown and type the join code; then they enter a name and play. Every seat (and the spectators' link) has its own secret code, so nobody can look at another player's hand by editing their link, and the game stops answering after 30 wrong codes in a minute.
4. Their decisions show in an action bar on their page, just like yours (pinned to the bottom with big buttons on a phone). Their own board sits at the bottom left, with the others clockwise. **Time for each decision** in the Invite panel sets how long they get (30 seconds to 10 minutes); after that the AI decides for them. **Invite** on the timeline reopens the panel; it shows who has joined.

- **Spectators:** every game with online seats also has a spectator link, QR code and watch code (ending in `-0`). Spectators see every board but no hands. In a game without friends' seats, **Spectators** on the timeline opens a room just for watching.
- **Chat:** a chat box and quick emotes (👍 😮 😂 🤔 Nice! GG) sit under the game log for you, friends and spectators. Messages show in the log and as a speech bubble over the speaker's board.
- **Dropped connections:** if a friend's page stops checking in for 12 seconds, their board shows "disconnected · AI playing" and the AI plays their seat. They rejoin by opening the same link again (no name prompt), and the log says they're back.
- **Rewinding and replays** work with online players: friends' answers are recorded. Rewinding plays their earlier answers back, then asks them live again. A saved replay plays them back, and the AI takes over when they run out.
- **Turn clock:** in the Invite panel, **Turn clock** gives each friend a time bank instead of a fixed time per decision: **Relaxed** adds 3 minutes at the start of each of their turns (up to 15), **Tournament** 2 minutes (up to 10). It counts down while they decide and shows on their board for everyone. When it runs dry the AI decides for them until their next turn. While a friend is deciding, their board shows a **Nudge** button: their page beeps, flashes and shows "The host nudged you" until they answer.
- **Undo for friends:** a friend can click **Undo my last decision**. You get **Allow** / **No** on the timeline; allowing it rebuilds the game without that answer (and anything anyone decided after it), and they're asked again.
- **Deals:** friends have the same **🤝 Deal** button in their chat box.

Good to know:
- The first time you host, Windows may ask whether to allow Commander Table through the firewall. Allow it on **private networks**, or friends' links won't load.
- Each link carries a room code. The network server only serves the game page and that room. It can't use the deck downloader or shut the app down, and it stops when you quit.
- **Over the internet**: click **Play over the internet** in the Invite panel.
  - It starts a free Cloudflare "quick tunnel", with no account and no payment, and adds an **Internet** link for each seat (`https://some-words.trycloudflare.com/...`). It works through home routers and mobile networks, with no port forwarding.
  - The first time, Commander Table downloads Cloudflare's official `cloudflared.exe` (about 53 MB) from Cloudflare's GitHub releases. It checks the file is signed by Cloudflare, Inc., keeps it in the `data` folder (so it moves with the game), and after that starts the tunnel in a few seconds. (`start.bat` does the same; `server.py` downloads the Mac or Linux version.)
  - The address changes each time Commander Table starts.
  - The tunnel only reaches the friend page and its room. Your own page, the deck downloader and Exit are all refused from the internet.
  - The tunnel stops whenever Commander Table does, even if it crashes.

## cEDH

**Seat a cEDH table** on the setup screen fills all four seats with competitive-style decks:
- Kinnan, Bonder Prodigy
- Kess, Dissident Mage
- Thrasios + Tymna
- Heliod, Sun-Crowned

Each is built around fast mana, tutors, free counterspells and compact combos, and is piloted in the **cEDH** style. All four are legal under the current Commander ban list (Mana Crypt, Dockside Extortionist and Karakas were swapped out). The style is also picked automatically for any deck with a win combo, four or more tutors and six or more pieces of cheap fast mana.

cEDH pilots:
- mulligan hard for hands that can do something fast
- cast rituals (Dark Ritual and friends) when the extra mana enables a combo or a key spell
- tutor for missing combo pieces, and counter opponents' tutors and draw engines
- use free counterspells (Force of Will, Fierce Guardianship, Pact of Negation) only on threats worth a card
- try to win as soon as a combo is ready

Unbounded-mana combos win only when the deck has a way to spend the mana, and the finish is played out on the stack, so it can still be answered:
- **Walking Ballista:** cast from your hand for a huge X, or pumped with its counter ability if it's already out, then it pings every opponent.
- **A tutor first:** a tutor in hand, or Survival of the Fittest on the battlefield, can find Ballista. Tutors that put it straight onto the battlefield don't count, since Ballista would arrive with no counters and die.
- **Thrasios:** draws the whole library, then Thassa's Oracle is cast.
- **Otherwise:** AI pilots hold the combo until they have an outlet (or a hand of big spells to spend the mana on).

Kinnan can't dig Ballista out: it puts the creature onto the battlefield with no counters.

## Replays

Every game is generated from a random seed, and any decisions you made are recorded. The timeline under the top bar lets you:
- jump back to the start, step back or forward a turn, or drag the slider to any point
- skip to the end
- **Save replay**: download the game as a small file
- **Export log**: download the game log as text

**Watch replay** on the results screen restarts the game from the beginning. **Load replay…** on the setup screen opens a saved file. It reloads the decks and plays the identical game, including your decisions if you played a seat. When a loaded replay runs out of recorded decisions, you continue playing live.

**Share as web page** saves the whole game as one .html file that anyone can open in a browser and play back (play, pause, step, slider, speed, and the log), with nothing to install. Card images load from Scryfall when they're online. Deals offered from the chat aren't part of replays.

## Puzzles

**Puzzles…** on the setup screen: you get one turn, starting in your first main phase, to win. Three puzzles come built in. **Save board as puzzle** on the timeline turns any game's current board into a puzzle file (seat 1 to move) that you can share; **Load a puzzle file…** plays one.

## Draft and sealed

**Draft / Sealed…** opens packs from a real set (any set code; the Commander Legends sets work best for pods) or from a cube. Set packs match the real boosters, using MTGJSON's booster contents: the set's play or draft booster slots (commons, uncommons, rare or mythic, wildcard, foil and so on) and how often each card turns up. For example, Commander Legends packs have 20 cards with two legends.
- Foils are normal copies of their card. Basic lands, and guest cards from other sets, are left out.
- In a Commander pod, a pack without a legendary creature gets one in place of a common, so every pool has commanders.
- A set's booster contents are saved after the first load, so drafts work offline. They're refreshed after 30 days.
- Sets MTGJSON has no booster contents for use a fixed pack: a rare or mythic, a legendary card, three uncommons and nine commons.
- **AI drafters** in Bloomburrow, Duskmourn, Foundations, Murders at Karlov Manor, Wilds of Eldraine, Dominaria United and March of the Machine also weigh each card's real win rate (when drawn, from 150,000 Arena games). They only trust it for cards the simulator fully understands, so they don't take a card the AI can't actually play. In tests, decks drafted this way beat the old drafters' decks 59–37.
  - The ratings come from **17Lands Public Data** (https://www.17lands.com/public_datasets), licensed under CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/). Commander Table computes its own per-card summary from the first 150,000 games of each set's game data and ships it in `public/data/ratings`. They're built once by the developer tool `tools/ratings_17lands.py`; nothing is fetched from 17Lands while you play.
- **Sealed:** six packs each for you and three AI players.
- **Draft:** four players, three packs passed left, right, left; click the card you want, and the AI drafters take the rest, staying in their colors.
- **Play** the decks one of two ways:
  - **One on one, best of three** (the default): build a 40-card deck from any cards in your pool. Choose your colors (they steer **Auto-build** and the basic lands), click cards in or out, and basics fill the rest. The rest of your pool is your sideboard. **Seat these decks** switches the table to the Limited format and best of three, with your deck in seat 1 and the strongest AI drafter's deck in seat 2.
  - **Commander pod** (four players): pick your commander from the legendary creatures you opened. Cards outside its colors can't be chosen. **Seat these decks** puts yours in seat 1 and the AI players' decks in the others.

### Cubes

Choose **A cube** in Draft / Sealed to draft or open a cube instead of a set.
- **Add a cube:** paste a CubeCobra link or cube ID (Commander Table reads CubeCobra's public card list), or paste a list with one card per line. Give it a name and click **Save cube**. You can keep as many cubes as you like; **Delete** removes one. Cubes are kept in the game folder's browser profile.
- Packs are 15 cards dealt from the shuffled cube, so each card turns up at most once per draft. A draft needs 180 cards and sealed 360; a smaller cube makes the last packs short.
- Card names Scryfall doesn't know are left out, and the status line says how many.
- A cube without legendary creatures can only be played one on one.

## Batch testing and tournaments

**Batch** plays 10 to 250 games at full speed with the seated decks.
- **Run** reports each deck's wins, win rate, average place, combo wins and damage per game; game speed (average and median winning round, share of wins by round 4) and interaction spells per game; each combo's attempts, how often it landed and how often it won; how games were won and how players were eliminated; and per-card performance.
- **Tune styles** has every seat try all four play styles and suggests the best one for each deck. Decks also learn their best style on their own: once one style clearly wins more (12+ games), **Auto** plays it.

**Matchup grid** in the deck library plays the decks shown (up to 8) head to head, 2, 4 or 10 games per pairing, and shows a win-rate table.

**Tournament** pits five or more decks against each other. Put each link or `random` on its own line, and separate pasted decklists with a `---` line.
- Every round, the decks are shuffled into pods of four, and byes rotate fairly.
- Each pod plays one to five games.
- Standings rank decks by points per game: 3 for first, 2 for second, 1 for third.

## What's in it

- **Card art and data** come from Scryfall, matching the printing listed in each deck. Images load on demand and are kept for offline play.
- **Rules**: the local server downloads the current Comprehensive Rules from magic.wizards.com, caches them in `cache/` and refreshes them weekly. The Rules tab searches them. Each rule number in the game log links to its rule, and card previews show the keyword rules.
- **Engine**: 40 life, command zone, commander tax, 21 commander damage, free first mulligan, the full turn structure, the stack and priority for spells and abilities, first strike and double strike, trample, deathtouch, lifelink, flying and reach, menace, vigilance, haste, hexproof, indestructible, prowess, state-based actions, the legend rule, extra turns and extra combats.
- **Mana**: lands, mana rocks including Signets, rituals and Treasures, plus these ways to pay:
  - flashback, evoke, convoke and delve
  - free spells (Force of Will's pitch cost, Fierce Guardianship with a commander out)
  - cost reducers
  - attack taxes (Propaganda)
  - Rhystic Study-style taxes
- **Card text** is turned into effects by pattern matching. Supported effects:
  - removal, board wipes, burn, discard and edicts
  - card draw, ramp and tutors
  - tokens, token copies, +1/+1 counters, anthems, equipment and auras
  - planeswalkers, counterspells and Stifle-style ability counters
  - ETB, attack, upkeep, end-step, dies, landfall and "whenever you cast" triggers
  - modal spells and sagas
  - amounts that count, such as devotion (Gray Merchant) or creatures you control
  - sacrifice outlets and death triggers
  - blink and temporary exile
  - stealing and reanimating from any graveyard
  - copying spells and protection spells
  - "can't" effects such as Drannith Magistrate
  - storm, mill, escape from the graveyard (Underworld Breach), Lion's Eye Diamond, untap effects (Dramatic Reversal), flash for noncreature spells, redirecting spells, and control that ends when its source leaves (Control Magic, Sower of Temptation)
  - a turn stops resolving waiting triggers after 600, so a loop nobody can stop (two blinkers feeding each other) ends instead of freezing the game
  - **library**: scry, surveil, milling yourself, "look at the top N, take one" (Impulse, Dig Through Time, Satyr Wayfinder), impulse draw (exile the top card and play it this turn), playing from the top of the library (Courser of Kruphix, Oracle of Mul Daya), tutors to hand, top, battlefield or graveyard (Entomb). When you play a seat you make these choices yourself: keep or bottom each scried card, and pick from a searchable list when you tutor or dig
  - **graveyard**: returning cards to hand by type and number (Eternal Witness, Archaeomancer), reanimating any permanent type from any graveyard, mass reanimation, exiling graveyards, shuffling a graveyard back, and the graveyard keywords flashback, escape, jump-start, unearth, embalm and eternalize
  - **conditions**: "if" and "instead" text (kicker bonuses, Cabal Ritual's threshold), intervening-if triggers, and "as long as" bonuses. Ability words are read from the condition they name: threshold, metalcraft, delirium, morbid, raid, hellbent, ferocious, revolt, spell mastery, coven, formidable, corrupted, fateful hour, lieutenant and battalion
  - **triggers**: whenever you (or a player, or an opponent) gain life, lose life, draw, sacrifice or discard; whenever a creature (or an elf, an artifact…) enters; whenever you attack or a creature you control attacks or deals combat damage; whenever equipped (or enchanted) creature attacks, deals combat damage or dies (Swords, Skullclamp); blocks, becomes blocked, is dealt damage, leaves the battlefield, becomes a target, heroic; each upkeep, each end step, beginning of combat and draw step. A turn stops queueing triggers after 300, so a loop can't run forever
  - **abilities**: tap, sacrifice, pay-life and discard costs ("Sacrifice ~: …", Griselbrand, Clues, Food, Blood, Maps), Gaea's Cradle-style mana, utility lands, vehicles and crew, equipment with living weapon or For Mirrodin!, cards that return themselves from the graveyard (Reassembling Skeleton), Hardened Scales-style extra counters, and "damage to the player it's attacking" (Hellrider)
  - **costs** are paid in full or the ability can't be used: {T}, mana, life, discarding (any card, or a creature card for Survival of the Fittest), sacrificing the permanent or others, exiling cards from your graveyard, tapping other untapped creatures or artifacts, removing counters and returning a permanent to hand. Spells with an additional cost (Fling, Thoughtcast, Village Rites) need it paid before they're cast. When you play a seat you choose what to discard, sacrifice or tap, and you can use an ability as often as you can pay for it. Abilities with {X} in their cost (Crypt Rats, Cinder Elemental, Kessig Wolf Run) are paid with a real X: the AI picks the X worth paying, and you choose X from buttons
  - borrowed abilities (Marvin, Murderous Mimic; Necrotic Ooze), "choose a creature type" cards and chosen-type anthems, keyword anthems ("creatures you control have trample"), token doublers (Doubling Season, Anointed Procession), extra land drops (Exploration, Azusa), no maximum hand size, power and toughness that count something (Multani), Eldrazi cast triggers, tribal and color "whenever you cast" and death triggers, multi-creature and nontoken edicts, "that player" effects aimed at whoever set off the trigger, poison counters, and pacts (pay at your next upkeep or lose; AI pilots only cast one they can pay for)
  - fogs (the AI holds one for a lethal or heavy attack), alternate wins (Laboratory Maniac, Thassa's Oracle's devotion check, "you win the game" conditions), Chromatic Lantern, mana doublers (Crypt Ghast), damage doublers and triplers (Fiery Emancipation), life doublers, Grand Abolisher, "enter tapped" for opponents (Authority of the Consuls), Theros gods that aren't creatures until their devotion is met, manlands (Mutavault), modal triggers and abilities (Hullbreaker Horror), "you may pay {X}. If you do…" (Mana Vault), "that many" and "its power" amounts, cost reductions on the card itself, "+1/+0 for each artifact", keyword counters, ascend, "attacks each combat if able", and more
  - flashback with any cost (Deep Analysis's life, Dread Return's and Cabal Therapy's sacrifices), flashback granted by Past in Flames and Snapcaster Mage, Spirit Guides you exile yourself (click one in your main phase; the mana stays in your pool until the phase ends), Thoughtseize and Cabal Therapy picking from a revealed hand, rebound, Leylines starting on the battlefield, Thalia-style taxes, Elesh Norn-style penalties, Teysa's double death triggers, Utopia Sprawl, Anger/Wonder from the graveyard, Bloodghast's return, spree, "you may cast a spell free", Howling Mine, Stranglehold and short card names in rules text ("When Loran enters")
  - **more triggers** (1.6.0): a dinosaur, a ninja, an artifact creature, a token or a modified creature of yours dealing combat damage or attacking; an opponent attacking you; a player's second draw or second spell each turn; spells cast from anywhere but the hand; counters put on something; cards leaving or entering a graveyard; something leaving the battlefield; becoming tapped or untapped; searching a library; playing a land; committing a crime; the Ring tempting you; proliferating; the postcombat main phase; class levels; cycling a card. "Whenever one or more …" triggers once for a batch. Trigger doublers work (Panharmonicon, Yarok, Roaming Throne, Isshin, Harmonic Prodigy)
  - **more rules** (1.6.0): replacement effects (life gain +1, doubled or plus-one counters, extra Treasures, Clues and Squirrels, doubled draws, Notion Thief, Narset, Dauthi Voidwalker, Blightsteel Colossus), Urborg and Yavimaya, Blood Moon, Nykthos, Bloom Tender, Goldspan Dragon, Nyxbloom Ancient, Chromatic Orrery, cost reductions by color and type (and Helm of Awakening, Defense Grid), cheaper or locked activated abilities (Training Grounds, Linvala, Collector Ouphe), anthems with filters (legendary, non-Human, with flying, of the chosen color), conditional equipment (Champion's Helm), auras that shrink a creature (Kenrith's Transformation), evasion statics (Tetsuko, Herald of Secret Streams), attack limits (Silent Arbiter, Crawlspace), Teferi, Time Raveler, Elesh Norn, Mother of Machines, Platinum Angel, Divine Visitation, Torbran, Gisela, Shalai, Amulet of Vigor, Concordant Crossroads, Mana Vault and the Monoliths staying tapped
  - **more keywords and effects** (1.6.0): station (spacecraft become creatures once charged), dredge, hideaway (the hidden card goes to your hand), overload, transmute, offspring, warp, umbra armor, mobilize, start your engines (speed), gift (never promised), Windfall and Timetwister, Living Death, Chaos Warp, Maze of Ith, Insurrection, Teferi's Protection, Shadowspear, d20 tables, transforming cards, Yawgmoth's Will, "copy that spell", and new ability costs: mill, exert, untap creatures, a -1/-1 counter, exile a creature, remove counters from among your permanents, forage and energy
  - **more rules and keywords** (1.7.0): tribal lords that hand out keywords (Goblin King's mountainwalk, Zombie Master's swampwalk, Marrow-Gnawer's fear, Goblin Warchief's haste), granted ward (Bronze Guardian, Hexing Squelcher, Innkeeper's Talent), no life gain (Erebos, Sulfuric Vortex, Rampaging Ferocidon), one spell per turn (Rule of Law, Archon of Emeria, Deafening Silence, Ethersworn Canonist), spells or damage that can't be countered or prevented, Glacial Chasm, untap locks (Winter Orb, Winter Moon, Meekstone, Intruder Alarm), hand size (Jin-Gitaxias), red mana that stays (Leyline Tyrant), Flares, Commandeer, Daze, Solitude/Fury/Endurance evoked by exiling a card, cost reductions by mana value, first spell and graveyard (Conduit of Ruin, Emet-Selch, The Ur-Dragon from the command zone), Grafdigger's Cage, Rest in Peace, Yawgmoth's Will's exile, Liesa and Gisa, God-Eternals, the Archetypes, Dictate of the Twin Gods, Bruvac, Boromir and Lavinia, Savage Beating and Berserk timing, suspend, miracle (castable on the turn it's your first draw), entwine (Tooth and Nail), exploit, Duress, Traumatize, Beacon of Immortality, Time Stretch, Price of Progress, Archfiend of Depravity and Single Combat
  - **Round 5 rules** (1.18.0): abilities with {X} in their cost are paid with a real X (you choose it from buttons). Face-down cards: morph, megamorph and disguise cards can be cast face down as a 2/2 for {3} (click the card, then **Face down**) and turned face up later for their cost by clicking them (any time you could respond); manifest, manifest dread and cloak put the top card of a library onto the battlefield face down. Opponents see a card back; you see what your own face-down cards are. Adventures (cast the adventure, then the creature from exile) and modal double-faced cards (cast either face, or play a land back as your land) work too: click the card and pick a face. Bestow (cast it as an Aura; it becomes a creature again when the creature it enchants leaves), mutate (merge onto a non-Human creature you own) and reconfigure (an equipment creature that stops being a creature while attached) are in the same list of ways to play a card. Madness (cast a card for its madness cost when you discard it), cleave (cast without the bracketed words), split cards (either half, both with fuse, aftermath halves from the graveyard) work as well
  - **more cards read** (1.17.0): foretell, plot, impending (the Overlords aren't creatures until their time counters are gone), encore, devour, typecycling (wizardcycling), "becomes a copy" effects (Mirage Mirror, Thespian's Stage, Shifting Woodland, Cursed Mirror), copying triggered abilities (Strionic Resonator), granted cascade (Imoti, Zhulodok, Wild-Magic Sorcerer) and convoke (Dazzling Theater), once-a-turn casting from the graveyard (Kess, Lurrus, Serra Paragon, Muldrotha), Lier's flashback, backgrounds' granted abilities (they need your commander out), Bribery, Praetor's Grasp, Hermit Druid, Doubling Cube, Peer into the Abyss, Wound Reflection, Heartless Hidetsugu, Kaalia of the Vast, Ghalta, It That Betrays and Tergrid, Liesa, Uro, Torrential Gearhulk, Geode Golem, Lavinia, Silent Arbiter, Sandwurm Convergence, Fog Bank, Aven Mindcensor, Vorinclex's halved counters, Solphim, Collective Inferno, Virtue of Strength, Door of Destinies-style counter anthems, Arwen/Master Biomancer/Giada entering counters, and about 200 more one-of-a-kind lines
  - **fixes** (1.7.1): Shang-Chi, Master of Kung Fu (and Thousand-Year Elixir-style cards) now let summoning-sick creatures tap for mana, not only use other {T} abilities; mana abilities that make two or more mana of one color are read correctly, and mana that may only be spent on creature abilities (Shang-Chi) or creature spells is kept for that
  - **fixes** (1.7.3): Jeska's Will adds {R} for each card in the hand of the opponent with the most cards (it used to add one {R}); your seat can use instant-speed activated abilities, like Grim Monolith's untap, at the end of opponents' turns and when attacked
  - **what isn't read**: every line of a card's text is checked as the deck loads. The deck viewer and coverage figure list each card with a line the simulator can't read, and show that line. Of the 3,500 most-played Commander cards, about 88% are read completely; the rest are mostly one-of-a-kind effects. Hovering a card shows any line that isn't simulated under "⚠ Not simulated"
  - cards show what they're doing: -1/-1 counters, regeneration shields 🛡, goad 🎯, time and age counters ⏳, crewed vehicles ⚙, dashed, blitzed or unearthed creatures, monstrous 👹; players show the monarch 👑, poison counters ☠ and, with Courser of Kruphix and friends, the top card of your library 👁
  - **keyword actions**: investigate, fight and "bite" removal, goad, proliferate, populate, monstrosity, adapt, bolster, support, connive, explore, discover, cascade, regenerate, tap effects, -1/-1 counters and shrink effects, each-player draws, looting, and the monarch
  - **keyword abilities**: fear, intimidate, shadow, horsemanship, skulk, landwalk, protection from colors, ward, infect, wither, toxic, exalted, battle cry, bushido, flanking, rampage, annihilator, afflict, melee, dethrone, training, mentor, evolve, riot, modular, fabricate, backup, bloodthirst, undying, persist, afterlife, decayed, changeling, kicker, buyback, cycling and landcycling, channel, dash, blitz, spectacle, affinity for artifacts, improvise, echo, vanishing, fading, cumulative upkeep, split second, extort and ninjutsu
- **AI pilots** play in one of four styles: Aggressive, Balanced, Defensive or Combo (Auto picks one from the deck). They:
  - weigh each opponent's threat and remember grudges
  - plan attacks and blocks, and keep enough home to survive the backswing
  - pick the set of spells that uses the turn's mana best
  - hold board wipes until they're worth it, and break stalls in long games
  - respond to spells and abilities: counter, protect, sacrifice in response (including to a board wipe), punish auras and pump spells, copy spells
  - use activated abilities whenever they're useful: in either main phase and at every opponent's end step, keeping counterspell mana open; Walking Ballista pings to kill creatures or finish a player, and fires everything when it's about to be removed
  - read opponents from what's public (blue mana open, cards in hand, counterspells already shown) to guess the chance of a counterspell, and hold big spells or clear the way with Silence-style spells
  - plan a turn ahead: tutor for the combo that next turn's mana can pay for, and save rituals for it
  - plan combat by simulation (public/js/combatai.js): every possible exchange is played out in advance, with first and double strike, deathtouch, trample, lifelink, indestructible, menace and commander damage. Blocks come from a search over all assignments, weighing life at risk (heavily when it's lethal, or leaves them dead to the next player's board) against what dies on each side. Attacks are chosen one step deeper: each candidate is scored against the defender's best blocks and the risk of the backswing. Key cards (the commander, combo pieces, engines) count for much more, so they stay out of trades and chump blocks unless the alternative is losing. In head-to-head runs these pilots beat the earlier rule-of-thumb ones 57% (balanced), 69% (aggressive) and 52% (defensive) of the time.
  - look ahead in their main phases (**AI look-ahead** on the setup screen, on by default): before a play, the AI tries its best three options, and "stop here and cast the rest after combat", on a copy of the game. Each copy plays out the rest of the turn and every opponent's next attack, and the option that leaves the AI best off is chosen (Explain says when this changed its pick). The AI doesn't peek: in the copy, libraries are shuffled and opponents' hands are guessed from their unseen cards. Each look is capped (at most three per turn, a fixed number of simulated steps each), and it's deterministic, so replays stay exact; replays saved before 1.17.0 play without it. Casual pilots (brackets 1 and 2) don't look ahead. Batch, Tune styles, the matchup grid and tournaments play without it, to stay fast.
    The approach follows two open-source rules engines' AIs: [Forge](https://github.com/Card-Forge/forge)'s ordered block passes and attack-aggression checks, and [XMage](https://github.com/magefree/mage)'s simulate-and-search players. The ideas were used; none of their code was copied.
  - don't overextend: with a board already well ahead, extra plain creatures are held back from a likely board wipe
  - keep mana up for a protection spell when the commander or a combo piece is on the battlefield
  - block with two creatures to kill a big attacker, and chump-block only against lethal damage or a commander about to reach 21
  - mulligan toward the deck's plan (combo pieces, tutors, card engines, an early commander), not just lands and colors
  - save the last counterspell or removal for whoever is visibly closest to a combo
  - weigh Rhystic Study-style taxes against what the mana would do, and turn removal and burn around with Redirect Lightning or Deflecting Swat
  - keep hands with the right colors and early plays
- **Walking Ballista, Zirda and the Monoliths (1.13.1):**
  - **Zirda, the Dawnwaker** makes every non-mana ability you activate, equip included, cost {2} less, never below one mana. Basalt Monolith's untap costs {1} and Grim Monolith's {2}, so tapping and untapping nets mana, and Ballista's counters cost {2}.
  - **Power Artifact** enchants an artifact (the AI puts it on a Monolith) and does the same for that artifact.
  - **Rings of Brighthearth** copies non-mana abilities for {2}; you're asked each time.
  - **Pili-Pala**'s {2}, {Q} ability works ({Q}: untap it as a cost).
  - **Vizier of Remedies** stops Devoted Druid's -1/-1 counter.
  - When you play a seat, **Walking Ballista** can be clicked to remove counters and ping (any target, one counter at a time, with "Ping again"): in your main phase, at instant speed, and in response to spells.
  - Clicking a Monolith you tapped by hand asks whether you mean its untap ability or taking the mana back.
  - New combos: Zirda + Basalt Monolith and Zirda + Grim Monolith.
- **Combo rules:** a combo only starts with its pieces where they have to be. Pieces from your hand are cast first (they go on the stack and can be countered), permanents have to land and stay on the battlefield, and a piece that taps must already be on the battlefield, untapped and free of summoning sickness (or have haste). Commander Spellbook's prerequisites are read: "X does not have summoning sickness", "X is untapped", lands and creatures you control. A Spellbook combo with a condition the engine can't check is left out instead of being run. Built-in combos check their own conditions too:
  - Tainted Pact needs a library with no two cards of the same name.
  - Walking Ballista with Heliod needs two counters.
  - Exquisite Blood loops need a way to start them.
  - Underworld Breach needs a stocked graveyard.
  - If a combo can't start yet, the log says why.
- **Combos**: built-in plus Commander Spellbook. Pilots hold pieces until they can fire, tutor for missing pieces and bait out counterspells. The ability that starts a loop goes on the stack, so Stifle-style cards (or removal on a piece) can stop it before it begins, and the combo player can fight back. Loops then play out step by step, so opponents can break them in between.
- **Politics**: the table focuses the archenemy, and players offer deals: truces, gang-ups on the archenemy, tribute (the losing player gives a card for peace), and no-counterspell pacts for combo decks. A deal lasts from the rest of the current round up to five more rounds: you choose the length when you offer one, AI pilots pick a length that suits the deal, and long deals are harder to get accepted. Each player's board shows their deals and how many rounds are left. Breaking a deal earns a lasting grudge.
- **Explain**: the switch in the top bar makes the log say why each AI made its plays (🧠 lines: its best option and the runners-up, combos, counters, tutors, attacks and deals). It can reveal cards in hands.
- **The board**: each player's board shows their commander's art faintly behind it. Beside each hand sit the library, graveyard and exile piles with their counts; the graveyard and exile show their top card and flash when a card lands, and clicking a pile opens it (a library stays face down, apart from a top card you're allowed to see). Keys G, X and L open your own graveyard, exile and library; Esc closes them. In your main phase the pass button says how many plays you still have. Every zone has its own labelled surface:
  - command zone: gold
  - creatures: green felt
  - artifacts, enchantments and planeswalkers: cool blue
  - lands: an earth band
  - hand: leather

  During combat, arrows run from attackers to the players they attack, with dashed lines from blockers. Summoning-sick creatures show a ☾, tapped cards dim slightly, and a banner announces each turn. Online seats use the same look.
- **Viewing**:
  - dark or light theme (☀ / ☾)
  - **Display**: board background (faint or bold commander art, felt, wood, stone or plain), colors for color blindness (Okabe–Ito seat colors plus seat-number badges), larger text and cards, and fewer animations
  - a **battle preview** after blockers are declared: every attacker against its blockers (or the player it's hitting), with the expected result (who falls, how much damage gets through). It stays until combat damage is dealt; click it to close it sooner
  - **effects**: spells flare from the caster's portrait, clashes spark when combat starts, hits throw sparks, dying creatures leave embers, life gained glows green, combos light up the whole table, and slow motes drift over an arcane, slowly moving backdrop. Boards have glowing edges in each player's color (the active player's breathes), life totals are lit gems that pulse when low, and cards lift and glow on hover. "Fewer animations" in Display turns all of this down.
  - **music**: the Sound switch also plays background music, composed live in the browser (no audio files): a slow, magical theme that swells into war drums and driving strings during combat, then settles back
  - a **stack panel** on the table while anything is waiting to resolve (newest first, with targets and countered spells)
  - damage numbers float off creatures; draws, discards, deaths and exiles animate to their zones
  - **log filters**: spells, combat, removal, combos, politics and chat, or AI explanations, and one player at a time
  - **History**: every finished game you played or watched, your win rate, and which decks win most
  - **Follow** mode
  - sound effects
  - cards glide between zones
  - layouts for phones, narrow windows and short laptop screens

## Limits

Unusual card effects are cast and put onto the battlefield, but their abilities don't do anything. The deck viewer lists which cards those are.

Some simplifications:
- Whatever you haven't tapped yourself is tapped automatically when you pay.
- Combos from Commander Spellbook are only used when the engine can run their result. A loop that only produces something like "infinite ETB triggers" counts when the deck also has a finisher for it (Blood Artist, Impact Tremors, Thassa's Oracle, Brain Freeze and others); otherwise it's skipped.
