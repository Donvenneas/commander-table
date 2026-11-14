# Commander Table design roadmap (items 220 to 380)

Work list for the look, the interface, interface features and accessibility, written on 2026-11-14 after the
"Grimoire" redesign (item 219, version 1.32.0). It is self-contained: a session, or another model, can take any item
without the conversation that produced it. Rules fixes are in `AUDIT-ROADMAP.md`; the history is in `ROADMAP.md`.

## Rules for every session

- Read `CLAUDE.md` first. Its hard rules apply to every item here: no Microsoft Edge, free only, no trackers, no
  personal details in files, no shop or currency, nothing copied from MTG Arena, Moxgate or Forge (names, art, code),
  replays stay exact.
- **Nothing here changes a game outcome.** If an item seems to need an engine change, it is the wrong fix: stop and
  write it up instead. Interface state that a replay must reproduce (stops, auto-answers) already lives in the game
  setup; do not add more without saving it there.
- **Keep every element id.** `main.js`, `remote.js`, `tour.js` and the tests find elements by id. Before and after an
  HTML change, compare: `git show HEAD:public/index.html | grep -o ' id="[^"]*"' | sort` against the new file.
- **Use the tokens.** Colors, fonts, spacing, radius, shadow and timing come from the `:root` block at the top of
  `public/css/style.css`. A new component should need no new color. Delete the rule you replace; do not stack an
  override on it.
- **No inline event handlers and no new hosts.** The security policy is `script-src 'self'`, and images may only
  come from this server or `*.scryfall.io`. Anything else means changing all three servers, which no item here needs.
- **Assets:** only files you can ship under a license that allows it (OFL fonts, your own SVG). Put the license
  beside the file. No stock photos, no icon packs that need attribution on screen.
- **New text** is written in English in the code; add it to `i18n.js` / `i18n_more.js` for the six other languages
  in the same change, or list it under item 372.
- **Test every item:** `node tests/typecheck.mjs`; then the `test-commander-table` skill (self-test page: all checks
  pass, 0 simulator errors). Look at the changed screen in the browser pane at 1440, 1280 and 375 wide, in dark and
  light, and read the console for errors. The pane pauses animations while hidden: a screenshot taken right after a
  window opens can catch it half faded in; wait a second and take another.
- **After each item:** tick it here with a one-line "Done:" note, add it to `ROADMAP.md` under a "## Round 8" section (start it with the first finished item, never empty: the
  What's new window reads the newest "## Round" section), update `README.md` where a player needs to know, bump `VERSION` for a release, run
  `make-shareable-zip.ps1`. Commit only when the owner asks.
- Sizes: **S** under an hour, **M** a session, **L** more than one session. "Needs" names an item to do first.

## Where things are

- `public/css/style.css`: tokens, then the older screen rules, then the Grimoire layers 1 to 7 (components, shell,
  dashboard, card tiles, deck builder, charts, motion and small screens).
- `public/index.html`: every window is a `<div class="modal" hidden>` in the page (about 30). The start menu is
  `#startMenu`. Icons are `<symbol>`s in the `.sprite` SVG at the top of `<body>`, used as `<svg class="ico"><use href="#i-name"/></svg>`.
- `public/js/main.js`: setup screen, every window's logic, `renderMenu` (dashboard), `showDeck` (deck viewer).
- `public/js/builder.js`: deck builder. `public/js/deckcharts.js`: stat tiles, mana curve, color pips, card types.
- `public/js/ui.js`: the table (`TableView`), hover preview (`installPreview`), right-click details (`installDetails`).
- `public/js/human.js`: prompts for a person's seat (the action bar). `public/js/remote.js` + `public/play.html`: a friend's page.
- `public/js/windows.js`: Help, What's new, Storage, images. `public/js/prefs.js`: saved preferences (`ct.prefs`).

## What the 2026-11-14 check found (the reasons behind the items)

- No window has `role="dialog"`, a focus trap or focus return; `main.js` never calls `focus()`. Escape closes only some.
- 13 `confirm()`, 6 `alert()` and 4 `prompt()` browser boxes are still used; there is no toast or notice component.
- `style.css` still holds about 310 literal hex colors and 160 `rgba()` values below the tokens, 31 `!important`,
  and 25 different `z-index` numbers (up to 9999).
- 79 `title=` tooltips in the page against 14 `aria-label`s; many icon-only buttons (⏮ ◀ ▶ ⏭ ☀ ✕) have no name a
  screen reader can say; no `<label for>` anywhere (labels wrap their fields, which is fine, but some fields have neither).
- The progress tabs and the cEDH meta tabs are plain buttons with no tab roles or arrow keys.
- No print styles, no `forced-colors` or `prefers-contrast` rules; high contrast is a body class with a few overrides.
- New dashboard and deck builder text (item 219) is English only.
- The deck viewer shows 56 lands for the built-in Kinnan deck: check the count before trusting the Lands tile (item 329).

## Suggested order

1. Foundations that later items lean on: 220, 221, 222, then the shared pieces 232 (notices), 233 (confirm window), 234 (modal controller), 236 (tabs), 237 (menus), 238 (tooltips).
2. Accessibility basics: 245 to 262 (245, 249, 250, 251, 256 and 257 are short and worth doing first).
3. The screens people use most: setup (273 to 280), the table (281 to 301), the deck builder (310 to 328).
4. Everything else by taste. Each section is ordered with the most valuable item first.

---

## A. Foundations: tokens and stylesheet

- [ ] **220. Move the remaining literal colors onto tokens.** (L) The table view, log, badges, battle preview and
  chips still use about 310 hex and 160 rgba values. Add the missing semantic tokens first (`--log-combat`,
  `--log-trigger`, `--badge-bg`, `--scrim`, `--on-art` for text over card art), then replace by section. Done when
  `grep -cE "#[0-9a-fA-F]{3,8}\b" public/css/style.css` outside the `:root` blocks is under 30 and the light theme
  needs no per-rule overrides for the log.
- [ ] **221. A z-index scale.** (S) Replace the 25 numbers with tokens: `--z-board`, `--z-float`, `--z-bar`,
  `--z-preview`, `--z-menu`, `--z-modal`, `--z-over-modal`, `--z-tour`, `--z-tip`. Done when no rule has a bare number above 5.
- [ ] **222. Remove the `!important`s.** (M) 31 remain, mostly zone backgrounds and the contrast mode. Raise
  specificity honestly or reorder. Keep only `[hidden]` and the reduced-motion rule.
- [ ] **223. Split the stylesheet by screen without a build step.** (M, needs 220) `style.css` is 1,600 lines.
  Use `@import` in one entry file or several `<link>`s (`tokens.css`, `components.css`, `table.css`, `windows.css`,
  `builder.css`). Update `index.html`, `play.html`, `selftest.html` and check `replayexport.js`, which carries its own styles.
- [ ] **224. A spacing pass on the tokens.** (M) `--s1` to `--s6` exist but most rules still use raw pixels. Apply
  them to padding and gaps in windows and panels so density is even.
- [ ] **225. Type scale tokens.** (S) Add `--t-xs` to `--t-xl` (10.5, 12, 13, 15, 21, 32) and use them; today there
  are over 20 different font sizes.
- [ ] **226. One elevation model.** (S) Three shadows exist (`--shadow-1/2/3`); replace the remaining one-off
  `box-shadow`s on panels and menus with them.
- [ ] **227. Component reference page.** (M) `public/styleguide.html` (developer page, left out of nothing: it is
  harmless) showing every token and component in both themes. It doubles as a visual regression target for item 337.
- [ ] **228. Board backgrounds on the tokens.** (S) Felt, wood and stone (Display) use fixed colors; give each a
  dark and a parchment version from tokens, and add two more drawn in CSS: slate and night sky.
- [ ] **229. Seat colors as a set of tokens.** (S) `SEAT_COLORS` in `cores.js` and the color-blind set are literals
  in JS. Mirror them as `--seat-1..9` so CSS and charts can use them, and check each against both themes for 3:1 contrast.
- [ ] **230. A third theme: "Vellum night" (dim, low blue light).** (M, needs 220) Only worth doing once colors are
  tokens. Add to the ☀ button as a three-way choice, saved in `prefs.theme`.
- [ ] **231. Follow the system theme on first run.** (S) `prefers-color-scheme` picks dark or light until the
  player chooses; add "Match system" to Display.

## B. Shared components

- [ ] **232. A notice (toast) component.** (M) `notice(text, { tone, action })` in a small `notices.js`: stacked at
  the bottom left, `role="status"`, gone after 5 s, pausable on hover, with an optional button (Undo). Then replace
  the 6 `alert()` calls and status lines nobody sees (for example "Saved to the deck library" written into `#setupStatus` while the builder covers it).
- [ ] **233. A confirm window in place of `confirm()` and `prompt()`.** (M) One promise-returning `ask({ title,
  text, confirm, danger, input })` drawn with the modal styles; replace the 13 `confirm()` and 4 `prompt()` calls.
  Focus goes to the safe button; Enter and Escape work.
- [ ] **234. One modal controller.** (M) `openModal(id)` / `closeModal(id)`: sets `role="dialog"`, `aria-modal`,
  `aria-labelledby` (the window's `h2`), remembers and restores focus, traps Tab, closes on Escape and on a click on
  the backdrop, and keeps a stack so a window opened from a window returns to it. Move every `hidden = false/true` onto it.
- [ ] **235. A close button in the same place in every window.** (S, needs 234) Top right, an × with `aria-label="Close"`;
  some windows have Close in the footer, some in the head, some "Done".
- [ ] **236. Real tabs.** (S) Progress, cEDH meta, the sidebar (Game log / Rules) and the builder's phone tabs get
  `role="tablist"`, `role="tab"`, `aria-selected`, `aria-controls`, and Left/Right arrow keys, from one helper.
- [ ] **237. A menu button component.** (M) For "more actions" lists (items 273 and 301 need it): button with
  `aria-haspopup="menu"`, arrow keys, Escape, click outside.
- [ ] **238. Tooltips that work without a mouse.** (M) The 79 `title=` hints do not show on touch or keyboard focus.
  One delegated tooltip (the `.kw-tooltip` box exists) reading `data-tip`, shown on hover, focus and long press,
  with `aria-describedby`. Keep `title` off elements that get it.
- [ ] **239. Skeletons for lists that load.** (S) Library, cEDH meta, precons, history: grey rows while waiting,
  instead of an empty window or the word "Loading…". Reuse `.rune` for single-line waits.
- [ ] **240. Empty states everywhere.** (S) `.empty-state` exists; use it in History, Progress tabs, Puzzles, the
  log before a game, the collection and the meta browser, each with one next step.
- [ ] **241. Error states with a retry.** (S) A shared `errorBox(message, retry)` for failed fetches (Scryfall,
  EDHTop16, Spellbook, Archidekt), saying whether the game works offline without it.
- [ ] **242. Switches for on/off settings.** (S) Reveal hands, Explain, Follow, Sound, Ranked, Coach: styled
  checkbox switches with a visible state beyond the tick, `role="switch"`.
- [ ] **243. Segmented control.** (S) For two-to-four-way choices now drawn as radio rows (Sealed/Draft, set/cube,
  one on one/pod) and the theme choice.
- [ ] **244. Number and range fields.** (S) The speed, volume and timeline sliders get a styled track in the
  tokens' colors, a visible value, and `aria-valuetext` ("Fast", "Turn 12").

## C. Accessibility

- [ ] **245. Names for icon-only buttons.** (S) ⏮ ◀ ▶ ⏭ ↶ ☀ ✕ ⠿ and the emote buttons need `aria-label`; decorative
  glyphs inside labelled buttons need `aria-hidden`. Done when the accessibility tree has no unnamed button.
- [ ] **246. Keyboard play of a whole turn.** (L) Cards that can be chosen are focusable, but there is no order or
  shortcut map. Add: Tab order hand → battlefield → opponents; arrow keys within a zone; Enter to choose; number
  keys for action-bar buttons; Space to pass; `?` opens a shortcut sheet. Lives in `human.js` and `ui.js`.
- [ ] **247. Shortcut sheet.** (S, needs 246) A window listing every key, opened with `?` and from Help.
- [ ] **248. Screen reader game log.** (M) `#srLog` is an `aria-live` region; make sure it gets one sentence per
  event with card names in plain text (no symbols as images without alt), and add a setting for how much to read
  (everything, my turn only, combat and wins).
- [ ] **249. Mana symbols with spoken names.** (S) `symbolize` gives `alt="{W}"`. Make it "white mana", "two generic",
  "tap", and so on from a table; a row of symbols gets one `aria-label` for the whole cost.
- [ ] **250. Card images with alt text.** (S) Board cards and tiles use `alt=""` in 9 places. Board cards should
  say name, tapped, power/toughness and counters through `aria-label` on the card element, updated in `TableView.sync`.
- [ ] **251. Contrast check of both themes.** (M) Measure every text token pair and the mana and type colors
  against their backgrounds (4.5:1 for text, 3:1 for graphics). Known doubts: `--muted` on `--panel-2` in light,
  gold text on parchment, `.stat-l` at 10px. Fix the tokens, not the rules. Add the script to `tests/` (see 377).
- [ ] **252. High contrast from tokens.** (M, needs 220) `body.contrast` is a handful of overrides. Make it a token
  set, and add `@media (prefers-contrast: more)` and `@media (forced-colors: active)` rules so Windows High
  Contrast keeps focus rings, card selection and the active board visible.
- [ ] **253. Never color alone.** (M) Attacking, blocking, pickable and chosen cards differ only by glow color.
  Add a shape or badge for each (⚔, 🛡, a tick, a number in pick order); extend the color-blind setting's seat
  numbers to log entries and combat arrows.
- [ ] **254. Text size without `zoom`.** (M) `body.big` uses `zoom`, which breaks positions of the preview and
  arrows. Drive sizes from `rem` and `--text-scale`, and check 200% browser zoom has no clipped windows.
- [ ] **255. Touch target sizes.** (S) 44 px minimum on phones for `.btn.small`, `.zbtn`, `.pile`, seat picks,
  `.libseat`, emotes and the builder's ± buttons.
- [ ] **256. Focus that is always visible.** (S) Some rules still set `outline: none` (start buttons, inputs with
  only a border change). Every focusable thing shows the `--focus` ring, including cards on art.
- [ ] **257. Headings and landmarks.** (S) One `h1` per view, windows start at `h2`, the table is `<main>`, the
  sidebar `<aside>` with a label, the timeline a `toolbar`. Add a "Skip to the table" link.
- [ ] **258. Motion levels.** (S) Display's "Fewer animations" is on or off. Make it three levels: full, reduced
  (no ambient motion: nebula, sigil ring, floating card), none. Particle effects in `fx.js` follow it.
- [ ] **259. Sound cues with a visual twin, and the reverse.** (S) Your turn, a prompt waiting, a friend's nudge:
  each has a sound, a visible notice and a title-bar change. List them in Display with a test button each.
- [ ] **260. Dyslexia-friendly text option.** (S) A Display switch: wider letter and line spacing, no all-caps
  Cinzel in headers (use Inter), left-aligned everywhere. No new font needed.
- [ ] **261. Announce timers.** (S) The turn clock (`.tclock`) should announce at 30 and 10 seconds through the
  live region, and never be the only sign that time is short.
- [ ] **262. Language of mixed content.** (S) The log and rules text stay English when the interface is not;
  mark those regions `lang="en"` so screen readers switch voice.

## D. Dashboard (start menu)

- [ ] **263. Commander art on recent decks.** (M) Each recent deck shows its commander's art crop as a banner.
  Look the name up in the card cache first (`cardcache.js`, the bulk file), ask Scryfall only on a miss, and keep
  the result so it works offline. Fallback: today's color spine.
- [ ] **264. Recent decks do something useful in one click.** (S) Buttons on each: Play (seat 1 and open setup),
  Edit (builder), View (deck viewer). Today a click only opens the library search.
- [ ] **265. "Continue" row.** (S) One line under Play for what is in progress besides the autosave: an Expedition
  run, the next unread story chapter, the next lesson, today's puzzle, a best-of-three in progress.
- [ ] **266. Today panel.** (M) Daily puzzle, the daily and weekly challenges with progress bars, and the streak
  on the dashboard itself, not only in Progress.
- [ ] **267. Record with a picture.** (M) Replace two of the stat tiles with a small chart: your last 20 results
  as a row of marks, and wins by deck (top five). Data: `ct.history`. Draw with `deckcharts.js` helpers.
- [ ] **268. Fit one screen at 1366×768 and 1440×900.** (S) The fourth group (Codex) falls below the fold. Tighten
  the hero, or make the right column two columns of compact rows above 1200 px.
- [ ] **269. Search the whole game from the dashboard.** (M) One field (`/` or Ctrl+K) that finds modes, windows,
  settings, saved decks and Help sections, and opens the choice. Needs a small index of actions with keywords.
- [ ] **270. Rank and mastery at a glance.** (S) The ladder rank chip per format and the highest deck mastery,
  each linking to Progress.
- [ ] **271. A background drawn for the game.** (M) An SVG scene in the tokens' colors behind the hero (a table
  seen from above, five lights for the five colors), static, under 20 KB, with a plain fallback.
- [ ] **272. News as cards.** (S) New sets and "what's new in this version" as two dismissible cards instead of
  centered lines of text; remember what was dismissed in `prefs`.

## E. Setup screen

- [ ] **273. Sort the 25 action buttons.** (M, needs 237) Keep four primary actions visible (Fill with random
  decks, Deck library, Deck builder, Open lobby) and move the rest into labelled menus: Decks, Modes, Tools. Every
  id stays (the tour points at `#btnCedh`, `#btnLobby`, `#btnPuzzles`, `#tableBracket`, `#btnBatch`).
- [ ] **274. Seat cards that show the deck.** (M) Once a deck is loaded, the seat shows commander art, name, color
  identity, bracket chip, card count and combos as a compact card; the paste box folds away behind "Change deck".
- [ ] **275. Paste or drop anywhere.** (S) Dropping a text file or pasting a list or link on a seat loads it;
  dropping on the window fills the first empty seat. Show the drop target.
- [ ] **276. Format picker with explanations.** (M) The format `<select>` becomes a list with each format's life,
  deck size, seats and one sentence (from `FORMATS[].about`), grouped: Commander family, 60-card, Limited, Special.
- [ ] **277. Plain-language options.** (S) Ranked, AI look-ahead, AI strength and Coach have long `title`s only.
  Give each a short visible line and move the detail to the tooltip component (238).
- [ ] **278. Loading progress per seat.** (S) While decks load, each seat shows what it is doing (finding cards
  12/100, reading combos) with a bar, instead of one status line for all.
- [ ] **279. Deck problems in place.** (S) Illegal cards, wrong size and missing commander appear on the seat with
  a "Fix in builder" button, before Load is clicked.
- [ ] **280. Remember and name table setups.** (M) Save the current seats, format and options as a named table;
  list them on the setup screen and the dashboard. Stored in `prefs`, shareable as the existing challenge code.

## F. The game table

- [ ] **281. A layout for one-on-one.** (M) Two-player formats still draw a four-quadrant grid. Give two seats a
  top/bottom layout with larger cards and the stack between them.
- [ ] **282. Your seat at the bottom.** (S) When one person plays, their board is always bottom (or bottom left)
  whatever the seat number; today only narrow screens reorder.
- [ ] **283. Card size control.** (S) A slider in Display for `--cw`, and automatic shrink when a battlefield row
  would scroll.
- [ ] **284. Hand as a fan for your seat.** (M) Your own hand at readable size along the bottom edge, cards
  overlapping and lifting on hover or focus, castable ones marked (the engine already knows through the action bar).
- [ ] **285. Group permanents sensibly.** (M) Lands stacked by name with a count, mana rocks beside lands, tokens
  already pile; Auras and Equipment tucked under what they are attached to.
- [ ] **286. The stack as cards.** (M) The stack panel is text. Show each item as a small card with its
  controller's color, target arrows on hover, and "resolves next" on the top one.
- [ ] **287. Phase track you can read at a glance.** (S) Larger current step, whose priority it is, and the stops
  you set shown as dots on the track (clicking a step toggles your stop for the next game).
- [ ] **288. Log grouping.** (M) Fold each turn into a block with a one-line summary (casts, combat result, life
  changes); the current turn stays open. Keep the filters and search working.
- [ ] **289. Log entries with card thumbnails.** (S) An optional compact art thumb beside cast and death lines.
- [ ] **290. Life total history.** (S) Click a life total for that player's changes this game with their sources
  (data is in the log), and commander damage taken per opponent.
- [ ] **291. Zone viewers as galleries.** (S) Graveyard, exile and library windows use the `.ctile` tile with
  search, sort (order, name, type, mana value) and type filters.
- [ ] **292. Hover preview that stays out of the way.** (S) Options: beside the pointer (today), docked in the
  sidebar, or only on a key held down. Delay of 150 ms before showing so sweeping the mouse does not flash cards.
- [ ] **293. Touch preview.** (S) On touch, a tap shows the preview docked at the bottom; a second tap acts. Long
  press keeps opening the details window.
- [ ] **294. Action bar that does not cover the board.** (M) It is fixed at the bottom center and hides hand
  cards. Dock it under your board, let it be dragged, and remember where.
- [ ] **295. Clear "your move".** (S) When the game waits for a person: the action bar pulses once, the page
  title changes, the board edge lights, and the waiting reason is stated in one sentence.
- [ ] **296. Targeting with lines.** (M) While you choose targets, draw the arrow from the spell to the card under
  the pointer, and dim what cannot be chosen (the shared target test from item 209 already decides legality).
- [ ] **297. Combat assignment by drag.** (L) Drag attackers to a player, drag blockers onto attackers, with the
  click path kept for keyboard and touch.
- [ ] **298. Results screen worth reading.** (M) Winner banner with commander art, standings, the life graph
  larger with turn markers, three "moments" picked from the log (biggest swing, the winning play, first
  elimination), and the report tables behind a fold.
- [ ] **299. Timeline with landmarks.** (S) Marks on the scrubber for each turn start, eliminations and combos;
  hover shows the turn and active player.
- [ ] **300. Full-screen and streamer layouts.** (S) A button for browser full screen; a "clean" layout hiding
  the top bar and timeline until the pointer nears the edge.
- [ ] **301. Top bar on a diet.** (M, needs 237) Batch, Tournament, Friend tournament and History move into a
  "Tools" menu during a game; the bar keeps Menu, Decks, play controls and view switches.

## G. Cards everywhere

- [ ] **302. One card tile for every gallery.** (M) Draft and sealed picks (`.lim-card`), the goldfish hand
  (`.gf-card`), the puzzle editor and zone viewers use `.ctile` from the builder: same hover, fallback face,
  focus ring and quantity badge. Export a `cardTile(card, opts)` from a small `cardtile.js`.
- [ ] **303. One card inspector for every screen.** (M, needs 302) The builder's inspector, the hover preview and
  the right-click details show the same card three ways. Share one renderer with three layouts (docked, floating, window).
- [ ] **304. Both faces.** (S) Double-faced cards: a flip button on tiles and in the inspector, with the flip animated.
- [ ] **305. Printing picker.** (M) In the builder and deck viewer, choose which printing's art to show for a card
  (Scryfall `prints_search_uri`, or the printings file when downloaded). Saved with the deck's About section as
  `Print <name> <set> <number>`; the loader must keep ignoring lines it does not know.
- [ ] **306. Image quality setting.** (S) Small, normal or large images on the table and in galleries, with the
  cache size it implies shown beside it.
- [ ] **307. Card frame for cards without a picture.** (S) The words-only face (`.cface`) gets a color bar from
  the card's colors and a type icon, so tokens and offline cards still read as cards.
- [ ] **308. Legality and warnings on the card.** (S) Banned, not legal in the table's format, Game Changer and
  Reserved List as small corner marks with a tooltip, in the builder and deck viewer.
- [ ] **309. Rulings and keyword help in the inspector.** (S) The right-click window has rulings and glossary
  tooltips; the builder's inspector should too (reuse `rulingsFor`, `Rules.glossify`).

## H. Deck builder

- [ ] **310. Autosave and restore the draft.** (S) Closing the builder or the game loses unsaved work. Keep the
  draft in `localStorage` per format and offer "Restore your unsaved deck" on open.
- [ ] **311. Undo and redo.** (M) Ctrl+Z / Ctrl+Y for adds, cuts, commander changes and sideboard moves; a notice
  with Undo after "Take one out".
- [ ] **312. Views of the deck.** (M) List (today), image grid, and stacks by mana value. Group by type (today),
  mana value, color or tag.
- [ ] **313. Sort and search within the deck.** (S) A filter box over the list, and sort by name, mana value or color.
- [ ] **314. Add many cards at once.** (S) A paste box: a list of names or a decklist goes into the deck, with a
  report of names not found (use `fetchCollection`).
- [ ] **315. Basic lands helper.** (S) "Fill lands" suggests a basic split from the deck's color pips and the
  format's usual land count (`FORMATS[].lands`), shown before it is applied.
- [ ] **316. Category targets.** (M) The deck health check (lands, ramp, card draw, removal, wipes: `dechealth.js`)
  as live meters in the builder with the template's targets, not only a button in the viewer.
- [ ] **317. Suggestions.** (M) "Cards often played with this commander" from data already used: EDHREC-ordered
  Scryfall search within the color identity, minus cards in the deck, and the EDHTop16 comparison for cEDH.
  Label where each list comes from. No invented numbers.
- [ ] **318. Combos panel.** (M) The deck's complete combos (from `combosIn`) and those one card away, with the
  pieces highlighted in the list and whether the game plays each one out (`comboPlay` status).
- [ ] **319. Tags on cards.** (M) Your own tags ("ramp", "wincon") per card in a deck, saved in the list's About
  section; group and chart by tag.
- [ ] **320. Compare two decks.** (M) Side by side or as a difference (`diffLists` exists): cards only in one,
  curve and color charts overlaid.
- [ ] **321. Test hand in the builder.** (S) "Draw seven" with mulligan, using `sampleHands` from `goldfish.js`,
  without leaving the builder.
- [ ] **322. Filters people ask for.** (M) Rarity, set, power and toughness ranges, keyword, color identity
  "exactly / at most / including", and price-free budget tiers already defined for random decks (no prices).
  Show active filters as removable chips and a "Clear all".
- [ ] **323. Search history and saved searches.** (S) The last ten queries under the field; star one to keep it.
- [ ] **324. Keyboard in the gallery.** (S) Arrow keys move between tiles, Enter adds, Shift+Enter adds to the
  sideboard, `c` makes the commander, `i` opens the inspector.
- [ ] **325. Drag and drop on touch.** (M) HTML drag events do not fire on touch. Add pointer-event dragging, or
  make sure every drag has a tap path (it does today) and say so in the empty state.
- [ ] **326. Infinite scroll.** (S) Load the next page when the gallery nears its end, keeping the More button
  as the fallback and for screen readers.
- [ ] **327. Resizable panels.** (S) Drag the borders between gallery, inspector and deck; remember the widths.
- [ ] **328. Export choices in the builder.** (S) The viewer's exports (MTGO .dek, Arena text, checklist) and a
  print sheet, from a Share menu beside "Copy as text".

## I. Deck analysis

- [ ] **329. Check the land count.** (S) The viewer shows 56 lands for the built-in Kinnan deck. Find out whether
  `fx.type.land` counts mana rocks or modal cards, or the preset is padded; fix the count or the label. Add an
  interaction test.
- [ ] **330. Curve stacked by color or by type.** (M) A switch on the mana curve: plain, by color (mana tokens),
  by card type (type tokens), with a legend. Multicolor and colorless get their own bands.
- [ ] **331. Color sources against color needs.** (M) Beside color pips: how many lands and rocks make each color
  (`card.produced`), as paired bars, with a note when a color is short.
- [ ] **332. Chart tooltips.** (S, needs 238) Hover or focus a bar to see the cards in it; click to filter the
  list to them.
- [ ] **333. Curve with the average marked.** (S) A marker line at the average mana value and the median.
- [ ] **334. Draw odds as a chart.** (S) The odds table drawn as a line by turn, table kept beneath for exact numbers.
- [ ] **335. Goldfish results as charts.** (S) Turn-by-turn mana and damage from `goldfishRuns` as small line
  charts with the sample size stated.
- [ ] **336. Batch results as a report.** (M) Win rate bars with the uncertainty for the number of games, average
  game length, win conditions as a breakdown, and card lift as a sortable table. Say plainly when the sample is
  too small to read.
- [ ] **337. Bracket explainer.** (S) The estimated bracket as a five-step scale with the reasons under the step,
  and the Commander Spellbook estimate marked on the same scale.
- [ ] **338. Matchup grid heat map.** (S) The library's matchup grid colored by win rate with numbers kept in
  every cell, and a legend.
- [ ] **339. Print and save as PDF.** (S) Print styles for the deck viewer and the checklist: black on white, no
  backgrounds, charts kept.

## J. Library, collection, history, progress

- [ ] **340. Library as cards or a table.** (M) A grid view with commander art (needs 263), color identity, bracket
  and tags; the table stays as the dense view. Sortable columns, multi-select for delete, move to folder and matchup grid.
- [ ] **341. Collection overview.** (M) Totals, colors, types and rarity as charts; a searchable gallery of what
  you own; "decks I can build" from the library with the missing counts.
- [ ] **342. History you can filter.** (S) By format, deck, result and date; a win-rate line over time; a row
  opens that game's report and replay if saved.
- [ ] **343. Progress with more shape.** (M) Ladder as a rank track with the next rank's threshold, challenges
  with progress bars, badges with art drawn in SVG and the date earned, unlocks shown as a path.

## K. Solo modes and other tables

- [ ] **344. Expedition map as a map.** (M) Nodes joined by paths in SVG, the current node marked, past choices
  dimmed, node icons drawn for the game instead of emoji.
- [ ] **345. Story chapter pages.** (S) Each chapter as a page of the book: an initial capital, the opponent's
  commander art, the goal and the result once played.
- [ ] **346. Lessons with a progress rail.** (S) Seven steps across the top, the coach panel restyled as a
  margin note, a clear "next lesson" at the end.
- [ ] **347. Puzzle browser.** (S) Puzzles as tiles with difficulty, solved state and best solution length;
  the daily puzzle featured.
- [ ] **348. Draft pick screen.** (M, needs 302) Pack as a gallery with the pick timer, your picks so far as a
  mana curve at the side, card ratings (17Lands data already shipped) as an optional overlay with its source named.
- [ ] **349. Manual tabletop restyle.** (M) `manual.js` boards use the older look: bring zones, life controls and
  the card menu onto the components, with touch-sized controls.
- [ ] **350. Kingdoms role reveal.** (S) Role dealing as a card-turn moment with the role's goal in one line;
  role chips consistent between the engine table and the manual table.
- [ ] **351. Friend tournament bracket.** (M) Standings and pods drawn as a bracket or Swiss table with the
  current match highlighted.

## L. Friends online

- [ ] **352. The friend's page on a phone.** (M) `play.html` in portrait: your hand and action bar pinned at the
  bottom, opponents as collapsible strips, the log as a pull-up sheet.
- [ ] **353. Join screen.** (S) Name, seat color and a "connected, waiting for the host" state with the sigil
  and the room code, instead of a bare prompt.
- [ ] **354. Invite window.** (S) One seat per card with QR, code and link, a copy button that confirms, a
  "who has joined" list that updates, and the connection check up front.
- [ ] **355. Connection status people understand.** (S) A small indicator on both pages: connected, slow,
  reconnecting, with what happens next (the AI takes the seat after two minutes).
- [ ] **356. Chat panel.** (S) Messages grouped by speaker with seat colors, unread count on the tab, emotes as
  a picker, deal offers as cards with Accept and Decline.

## M. Help, onboarding, settings

- [ ] **357. Settings as one window with sections.** (M) Display, Sound, Stops, Language, Storage and Updates
  are separate windows. One Settings window with a section list, search, and "Reset this section".
- [ ] **358. Tour for the new screens.** (S) The first-run tour predates the dashboard and the new builder; add
  steps for both and a "What changed" mini tour after an update.
- [ ] **359. Help with pictures.** (M) Small diagrams drawn in SVG for the table zones, the stack and combat,
  placed in the Help window's sections (`tools/help.mjs` builds it from README.md; add a way to attach a figure).
- [ ] **360. Contextual help.** (S) A "?" in each window's head opening Help at that window's section.
- [ ] **361. Glossary on demand.** (S) Keyword tooltips exist in card text; add a glossary window listing every
  keyword the rules file defines, searchable.
- [ ] **362. First-run choices.** (S) On the very first start: language, theme, text size and "new to Magic?"
  on one screen, before the dashboard.

## N. Responsive and performance

- [ ] **363. Tablet layout.** (M) 768 to 1150 wide falls back to one column of boards. Give it two columns with
  the sidebar as a drawer.
- [ ] **364. Sidebar as a drawer on small screens.** (S) Log and rules slide over the table from a button with an
  unread dot, instead of sitting under four boards.
- [ ] **365. Windows as sheets on phones.** (S) Modals fill the screen with a sticky head and foot under 600 px,
  so the action buttons are always reachable.
- [ ] **366. Safe areas and the on-screen keyboard.** (S) `env(safe-area-inset-*)` on fixed bars; inputs scroll
  into view above the keyboard in the builder and chat.
- [ ] **367. Draw only what is on screen.** (M) Long lists (library, meta, history, the log after 100 turns) get
  `content-visibility: auto` or windowing; measure before and after.
- [ ] **368. Table rendering budget.** (M) Profile a nine-player Kingdoms game: `TableView.sync` work per step,
  `backdrop-filter` and animated shadows on boards. Remove what costs frames on a laptop; keep it behind "Fewer
  animations" otherwise.
- [ ] **369. Font loading.** (S) Preload the three fonts in `index.html`, and subset Cinzel to the glyphs
  headings use if that saves much.
- [ ] **370. Image decoding and sizes.** (S) `decoding="async"`, width and height on every card image in `ui.js`,
  and `fetchpriority="low"` for galleries.
- [ ] **371. Installable.** (M) A web manifest and icons drawn for the game so the local page can be installed
  as an app window in Chrome. No service worker caching of game code (the updater replaces files).

## O. Languages

- [ ] **372. Translate item 219's text.** (S) Dashboard panel titles and stats, builder inspector, checks, sort
  options, empty states: add to `i18n.js` / `i18n_more.js` for es, fr, de, pt, it, ja.
- [ ] **373. Layout under translation.** (S) German and Japanese: check the dashboard buttons, stat labels, tab
  labels and the top bar for clipping; let labels wrap rather than truncate.
- [ ] **374. Dates and numbers by language.** (S) `toLocaleDateString()` follows the browser, not the chosen
  language; pass `prefs.lang`. Same for percentages and thousands.
- [ ] **375. A fallback face for Japanese headings.** (S) Cinzel has no kana or kanji; set a serif system stack
  for `:lang(ja)` headings so they do not fall to a mismatched sans.

## P. Tests and tooling for the interface

- [ ] **376. Screenshots in CI.** (M) The CI self-test already runs Playwright against `server.py`. Add
  screenshots of the dashboard, setup, a table at a fixed seed, the builder and the deck viewer in both themes at
  three widths, compared with stored images at a tolerance. Needs 227 for a stable component page.
- [ ] **377. Accessibility checks in CI.** (M) A script in `tests/` that loads each window and fails on: a button
  without a name, an image without alt, a dialog without a label, a contrast pair under the limit (251). Write
  the checks by hand; do not add packages.
- [ ] **378. Element id guard.** (S) `tests/ids.mjs`: every `$('…')` and `#id` selector in the JS exists in
  `index.html` or `play.html`, and no id is duplicated. Run in CI.
- [ ] **379. CSS lint by script.** (S) Fail on a literal color outside `:root`, a bare z-index, a new
  `!important`, and a class in the stylesheet that no HTML or JS mentions (after 220 to 222 make it pass).
- [ ] **380. Interface smoke test.** (M) Playwright: open each window from the dashboard and close it with
  Escape; build a ten-card deck in the builder and put it in a seat; start a game and take one turn as a person;
  no console errors.

---

## Not on this list, on purpose

- Card rules and AI behaviour: `AUDIT-ROADMAP.md`.
- A shop, currencies, paid cosmetics or accounts: ruled out by the project.
- Art, sounds, names or layouts taken from MTG Arena or other clients: ruled out by the project. "Arena-like" is
  not a goal; this game's own look is.
- A framework or build step: the project is plain ES modules and stays that way.
