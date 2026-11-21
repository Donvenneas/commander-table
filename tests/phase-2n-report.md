# Phase 2N report: card database reliability, Scryfall and offline play (ROADMAP item 384, version 1.56.0)

The card data pipeline was not a bare list of names when this phase started. It already had an IndexedDB card cache
that decks load from first (`cardcache.js`), Scryfall's bulk "Oracle Cards" file with a local search engine
(`bulk.js`), replays that keep their own card data with hashes (`replaydata.js`, Phase 2A), a per-page cache of read
cards, faces for transform, modal, split, adventure and flip cards, and a picture fallback (Phase 2L). This phase
audited all of that and fixed what was actually missing. No rules or engine code changed (golden games: 96 played,
0 differ; card readings: 0 changed). Statuses below: **Fully implemented**, **Partially implemented**,
**Not implemented**, **Not tested**, **Blocked by another system**.

## 1. Files inspected

public/js: scryfall.js, bulk.js, cardcache.js, effects.js (analyzeCard, ignoredText), combos.js, engine.js (mk,
useFace, flipFace), zones.js (move), decks.js, library.js, presets.js, replaydata.js, ai.js, resolve.js, invariants.js,
ui.js (rulings), main.js (bulk window, autocomplete, startup), builder.js (search), util.js (imgUrl, cardFace,
installImageFallback, store), limited.js, boosters.js, dechealth.js, planar.js, sets.js, windows.js, selftest.js.
public/index.html, css/style.css. tests: replay.mjs, golden.mjs, scenario.mjs, fetch-interaction-cards.mjs, the
snapshots. Scryfall's API documentation page refused automated access (HTTP 403), so the rate limits below follow
Scryfall's long-standing published guidance (50–100 ms between requests, HTTP 429 when exceeded) and err on the slow side.

## 2. Files modified

New: public/js/carddata.js, tests/carddata.mjs, tests/carddata-cards.json (14 real Scryfall cards),
tests/card-data.md, this report. Changed: public/js/scryfall.js, bulk.js, cardcache.js, builder.js, decks.js,
main.js, public/index.html, public/css/style.css, .github/workflows/selftest.yml, CLAUDE.md, README.md, ROADMAP.md,
VERSION. Servers and launcher: unchanged (no endpoint changed).

## 3. Original card-data architecture (audit answers)

| Question | Answer from the code |
|---|---|
| 1. How card data is retrieved | `scryfall.js` `fetchCollection` (POST /cards/collection, 75 identifiers a request) for decks; `sf()` GET for searches, random cards, autocomplete, rulings, sets, planes. All throttled 110 ms apart. |
| 2. Bulk data | Yes, optional: "Oracle Cards" (`bulk.js` downloadBulk, refreshed at most daily at startup when Scryfall's `updated_at` changes) and "Default Cards" for printings. Off until the player downloads it. |
| 3–4. Caching and storage | Raw Scryfall cards in IndexedDB `ct-cards` keyed by the JSON of the identifier asked for; bulk files in IndexedDB `ct-bulk` / `ct-prints` in 2,000-card chunks with meta in localStorage; read cards memoised per page by Scryfall id + data hash; pictures on disk via the local server (`/api/img`, data\images). |
| 5. Card identifiers | Scryfall id (`card.id`) per printing. Oracle id was dropped (not in the slim card). |
| 6. Instance identity | `Game.mk` gives each object an `iid`; the card definition is shared by reference; state lives on the instance. |
| 7. Multi-faced cards | `build()`: front face fields on the card, `backCard` (transform, flip, meld when faces exist), `altFace` (adventure, modal, split), `frontHalf` (rules 8 split halves), `v8` (rules 8 per-face keywords). Meld and reversible cards: no second face. |
| 8–9. Oracle text → effects.js | `build()` copies the face's text to `card.text`; `analyzeCard(card)` reads each face separately into `fx`; the original text stays on the card and in `card.src`. |
| 10. Unsupported text | `ignoredText(card)` names unread text; the builder marks partly simulated cards; coverage.mjs reports. |
| 11. Saved decks and Scryfall | Decks are saved as text lists (library.js). Loading needs each card in the cache under that exact identifier, or Scryfall. A deck imported by ids then saved as names needed Scryfall again. |
| 12. Replays | Format 7 keeps the slim card data of every card with hashes and reading hashes; `pinCards` rebuilds decks from it. Already exact. |
| 13. Can API failures stop play? | Not during a game (no requests in play except rulings on demand). Loading: a hung request had no time limit, so a deck load could wait forever; offline, every request waited through three retries (1.5 s + 6 s). |
| 14. Repeated requests | Cache first for decks; but no sharing of identical requests in flight, and stale cards were refetched one load at a time. |

Problems found (each reproduced in tests/carddata.mjs before the fix):

| Problem | Effect |
|---|---|
| No time limit on requests | A hanging connection froze deck loading |
| A non-JSON or odd 200 answer became `{}` or crashed on `j.data.find` | Captive portals and cut-off replies gave confusing errors |
| Nothing checked Scryfall's card records before caching | A damaged record would be saved and used |
| No offline state | Every request waited through all retries while offline |
| Cache keyed only by how a card was asked for | Cards fetched by id weren't found by name offline |
| Cards fetched before a failure weren't saved; a refresh answered with a damaged card lost the saved copy for that load | Lost work; "not found" for cards that loaded before |
| Bulk import checked only "at least 10,000 cards"; a malformed line threw away the whole file; no schema, source or error recorded | No duplicate or damage detection; failures invisible |
| Picture addresses not checked | Any URL in card data would be loaded |
| A modal card's back face used the front's art and a normal-size picture as its small one | Wrong art for the back face |
| A slow builder search could overwrite a newer one | Stale results |
| Oracle id dropped | Different printings couldn't be matched by oracle identity |

## 4. Card data model changes — Fully implemented

Kept apart, and documented at the top of `carddata.js`: oracle identity (`card.oracleId`, new), printing (`card.id`,
`set`, `cn`, pictures), card definition (`normalize()`; one object per printing + data hash), card face (`backCard`,
`altFace`, `frontHalf`, `v8`) and game instance (`Game.mk`, `iid`). `oracle_id` joined the slim card (and the replay
copy); it is left out of the "differs from today" comparison, so old replays aren't reported as changed. Names are never
the only identifier: the cache aliases a card under its name only where nothing else is saved there.

## 5. Scryfall API improvements — Fully implemented

`sf()`: 15 s time limit (AbortController), retries on network errors, 429 and 5xx (Retry-After honoured, capped at
30 s), three tries at most, a clear "busy" error after three 429s, JSON answers that aren't Scryfall data refused
(`ScryfallError` with `status` and `offline`), identical GETs in flight share one answer, 110 ms between requests and
500 ms between heavy ones (search, random, named, collection). `fetchCollection`: oracle-id lookups, every card checked
before use or saving (damaged ones named in `rejected` and in the deck's warnings), loads already fetching a card are
waited for rather than repeated, cards fetched before a failure are saved, and a card whose refresh fails or comes back
damaged keeps its saved copy. No requests were added to gameplay.

## 6. Cache architecture and storage decisions — Fully implemented

IndexedDB stays (localStorage is far too small for card data; the app already used IndexedDB). Records are now
`{ raw, at, v }` with `v` = `CARD_SCHEMA` (2); records without `v` are still read (they are raw Scryfall data) and
refreshed when due. Records are checked when read; damaged ones are skipped, counted (`cacheInfo().damagedSkipped`)
and fetched again online. Each card is also saved under its id, name, front-face name, oracle id and set + number with
`add` (never over an existing record). Meta in `ct.cards.meta`: schema, source, last successful save. Parsed readings
are never persisted (only per page, keyed by Scryfall id + data hash), so a changed card or a new reader can't leave a
stale reading; replays keep a reading hash and say when today's reader reads a card differently (tested).

## 7. Bulk-data import improvements — Fully implemented (main thread, see 18)

Staged update: (1) `bulkMeta` fetches the file's details and checks them (download address on `data.scryfall.io`
only, an `updated_at`); (2) `dailyBulk` stops when `updated_at` matches the file in use; (3) streaming download, refused
when shorter than Content-Length; (4) `readCards` checks every card (damaged ones left out and counted, an unreadable
line counted, a cut-off last line or missing end of the list refuses the file); (5) `acceptList`: at least 10,000
cards, at most 1% damaged, no id twice, no oracle id twice, not under 90% of the file in use; (6) one IndexedDB
transaction writes all chunks or none; (7) only then is the list used and the meta written (schema, source, Scryfall
date, count, damaged, duplicates, import time). Failures keep the old file and record `lastError`, shown in Updates.
Saved chunks that aren't card lists are left out when loading.

## 8. Multi-faced card improvements

| Layout | Data | Engine | Status |
|---|---|---|---|
| transform | both faces, own text, stats, keywords (rules 8), pictures | transforms (`flipFace`) | Fully implemented (already existed; tested) |
| modal_dfc | both faces, own cost, type, text; back face's own small picture and art (new) | plays either face | Fully implemented (picture fix new) |
| split | both halves, own costs; half mana value on the stack (rules 8) | casts either half, fuse, aftermath | Fully implemented (already existed; tested) |
| adventure | creature and adventure kept apart | adventure casting | Fully implemented (already existed; tested) |
| flip | both faces, one picture | flips via backCard | Partially implemented (as before) |
| meld | the card only (Scryfall gives no faces) | no melding; no back face is invented | Not implemented (reported as "none") |
| reversible_card | faces kept; mana value missing at the top level is reported | played as its first face | Not implemented (reported as "none") |
| prepare, double_faced_token | faces kept | first face | Partially implemented |

`carddata.js` `LAYOUT_SUPPORT` and the diagnostics report say which layouts the engine plays; nothing is claimed for
meld or reversible cards.

## 9. Effect-analysis integration — Fully implemented (unchanged reader)

Retrieval (`scryfall.js`, `bulk.js`, `cardcache.js`) and checking (`carddata.js`) stay apart from reading
(`effects.js`) and rules (engine). Original Oracle text is kept on the card (`text`, `fullText`) and in `card.src`.
Faces are read separately (already so). Reading happens once per card definition per page; a changed text or Scryfall
data hash gives a new definition and a new reading (tested). `ignoredText` reports unread text (tested). The new
diagnostics (`tests/card-data.md`) measure data completeness apart from engine coverage (`tests/card-coverage.md`).

## 10. Deck and replay compatibility — Fully implemented for loading; saved decks unchanged

Saved decks stay text lists (no migration, nothing to break). They now load offline from cards first fetched under
any identifier (aliases), tested by loading two built-in decks with no network after caching their cards by id, then
playing a game with them (0 simulator errors). Replays: unchanged format 7; tested that a pinned (historical) card wins
over today's saved card and the difference is reported. Saved decks do not record printing ids: **Not implemented**.

## 11. Image-loading improvements

Picture addresses must be https on Scryfall's picture hosts (`safeImageUrl`); others are dropped and the card is shown
in words (Phase 2L fallback). Modal back faces use their own pictures. Lazy loading, sizes per context, the on-disk
cache and the fallback already existed. **Fully implemented** for checking; per-context sizes unchanged.

## 12. Search-performance improvements — Fully implemented

Local search caches each card's lowercased text and types (WeakMap). The builder numbers its searches and drops late
answers to older ones, and leaves damaged cards out of results. The builder searches on Enter or the button (no
search-as-you-type); the deck editor's autocomplete was already debounced (250 ms) and now shares identical requests.

## 13. Offline functionality

| Works offline (tested) | Needs a connection |
|---|---|
| Loading saved decks whose cards were loaded before (Node test and the browser) | Cards never loaded before |
| Games against the AI with those decks (Node test) | Scryfall searches without the card file |
| Cached searches with the card file (bulk tests) | Card rulings not read before; Commander Spellbook answers not saved before |
| Pictures already shown (local server cache, Phase 2L) | New sets, EDHTop16 and precon lists not saved before, updates |
| Settings, history, Help, replays (local data; not re-tested here) | Online seats with friends |

The Offline chip beside the title shows while Scryfall can't be reached (checked in the browser by failing Scryfall
requests in the page: chip shown, the next request failed in 0 ms, a saved deck card loaded, chip hidden when back).
The game doesn't retry while offline (30 s, then 60 s, then 2 min), and the browser's `online` event ends it at once.
Not tested: a real unplugged network or an airplane-mode machine; settings, history and Help offline (they never used
the network). Not claimed: complete offline support.

## 14. Security and validation — Fully implemented

`check()` validates types and required fields (UUID ids, name, mana value as a finite non-negative number, colors only
WUBRG, faces with names, text fields as text, legalities as text, sizes capped). Picture addresses are allow-listed.
Card text is never run: a name `<img src=x onerror=…>` and type `<script>` are escaped in the card face (tested), a
`${…}` in rules text is plain text (tested), and color values that could reach a style attribute are refused. The bulk
file's download address must be Scryfall's data host (a description pointing elsewhere is refused and never fetched).

## 15. Performance measurements (this PC, Node 26)

| Measure | Before | After |
|---|---:|---:|
| Local search, 35,000 cards, `o:"draw a card"` | 21.9 ms | 12.0 ms |
| `o:flying t:creature c:w` | 15.1 ms | 9.9 ms |
| `is:commander` | 24.0 ms | 20.3 ms |
| `legal:commander game:paper id<=wubrg -t:land` (29,000 results, mostly sorting) | 47.0 ms | 40.2 ms |
| `goblin` (name) | 3.9 ms | 4.5 ms (noise) |
| Bulk import, 12,000 cards, checked and saved (test stand-in database) | not measured | 241–272 ms |
| Checking the 3,500-card snapshot (`checkList`) | — | 15 ms |
| Same deck loaded twice in the browser (live Scryfall) | — | 383 ms, then 1 ms (0 requests) |
| Two identical searches at once (browser) | 2 requests | 1 request (`shared: 1`) |
| Requests while offline (browser) | 3 tries each, ~7.5 s | 0 (fails in 0 ms) |

Snapshot diagnostics (`tests/card-data.md`): 3,500 cards, 3,500 valid records, 0 duplicate ids, 0 duplicate oracle
ids, 0 with missing required data, 113 multi-faced, 2,804 fully read, 665 partly, 28 almost entirely unread. A real
Scryfall bulk file was not imported in this session (it is a 25 MB download the player chooses); its counts are shown
in Updates after each import. Cache hit rate: not measured over real sessions.

## 16. Tests added

tests/carddata.mjs (30 tests, CI): every point of the brief except those noted. Identity 1–6, requests 7–12 (5xx,
429 + Retry-After, no network, a hanging request, shared requests, HTML / array / broken-list answers), faces 13–18,
database 19–24 (unchanged file, interrupted and cut-off downloads, a failed save, damaged and duplicate files,
another host, a good import, schema and damaged records, duplicates), integration 25–29 (offline deck load and game,
replay pinning, reader-change detection, unread text), 30–32 (search on 35,000 cards against a plain filter, picture
addresses, markup and code in card data). 33 (existing play intact) is every other suite below.

## 17. Existing tests run

typecheck 0 findings (strict null too); cards 0 changed; golden 96 / 0 differ / 0 errors; fuzz 12 games 0 errors;
hidden 0 changed; interactions 218/218; replay 10/10; loops 18/18; combos 21/21; mana 21/21; replacements 15/15;
stack 22/22; abilities 47/47; ai 30/30; net 7/7; multiplayer 36/36; ids and csslint clean; carddata 30/30. Browser:
selftest.html all 19 checks passed (50 games 0 errors, rules check clean, determinism 6/6); uitest.html 17 passed,
0 failed (online seats not run, by design). servers.mjs not run (no endpoint changed).

## 18. Known limitations

The bulk import runs on the main thread (streamed and asynchronous, about a quarter of a second per 12,000 cards here,
but the 30,000-card parse and the save are not in a Web Worker). Rate limits follow the old published guidance; the
current documentation page couldn't be read automatically. The offline chip covers Scryfall only (EDHTop16 and
Spellbook keep their own "saved copy" notes). Collection lookups by "Front // Back" names still miss on Scryfall's
side (the deck loader retries by the front face, as before). A Universes Beyond default printing can still be picked.

## 19. Unsupported functionality

Meld, reversible cards and the second face of prepare cards are kept as data and not played. Saved decks don't keep
printing ids. No printing picker. No search by keyword field (`kw:`) in the local search (it goes to Scryfall).

## 20. Dependencies on other phases

None blocking. Builds on Phase 2A (replay card data) and Phase 2L (picture fallback).
