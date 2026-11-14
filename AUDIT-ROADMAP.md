# Commander Table: audit and fix roadmap (Round 6)

Audit of version 1.31.0 (branch `replay-exactness`, commit `d9c00d9`), done 2026-11-13.
This file is self-contained: a new chat or another model can pick up any item from it without the audit conversation.
`ROADMAP.md` stays the project's history; items here continue its numbering (197 onward) and are ticked the same way.

## How to use this file

1. Read `CLAUDE.md` (hard rules, test commands) first. They apply to every item.
2. Take items in the order under "Suggested order". Items in different phases don't depend on each other unless one says so.
3. Each item has: **Problem**, **Evidence** (how to see it), **Where** (files), **Fix**, **Done when**, and a size (S: under an hour, M: a session, L: several sessions).
4. Reproductions: `node tests/audit-probes.mjs` (16 small boards, all failing today, each tagged with its item number) and `node tests/audit-probes.mjs --scan` (card lists per item). When an item is fixed, move its probes into `tests/interactions.mjs` and delete them from the probes file.
5. After each item: tick it here with a one-line "Done:" note, then follow "After each finished change" in `CLAUDE.md`.

Rules that matter for almost every engine item:

- **Old replays must not change.** Anything that changes a game's outcome goes behind a new rules version (the next one is 17: `this.rules >= 17`), with a twin test showing rules 16 still plays the old way. Reader changes count: see how items 185 to 196 did it (`card.v8`, fields such as `noRegen9` and `turnOnce9`).
- A reader change that is meant to change readings: `node tests/cards.mjs --update`, then regenerate `tests/card-coverage.md`.
- `node tests/golden.mjs` must show 0 differences for rules 4, 5 and 6 unless the item says otherwise.

## What was checked, and the state today

| Check | Result |
|---|---|
| 13 Node suites (cards, golden, interactions, fuzz, replay, loops, combos, mana, replacements, stack, abilities, hidden, typecheck) | all pass |
| Browser self-test against `Commander Table.exe` | 19 of 19 checks pass, 0 simulator errors, 6/6 deterministic |
| About 50 rules probes written for this audit | 16 fail (kept in `tests/audit-probes.mjs`); the ones that passed were dropped |
| Reader scan of the 3,500-card snapshot | about 280 cards counted as fully read have text that is silently not used |
| `server.py` read in full; `server.ps1` and the launcher compared on their safeguards | findings 199 to 204 |
| `net.js` (online seats, host side) read | findings 199 and 201 |

The short version: the program is stable and its tests are green. The errors are in what the tests don't measure:
cards that are counted as "read" but play wrong, events that should happen at the same time, and trust in answers
from online seats.

**Not audited** (say so if asked; these need their own pass): the table and setup UI beyond loading the start menu,
translations, accessibility, AI playing strength, speed, Mac and Linux, a real internet game through the Cloudflare
tunnel, `main.js` (270 KB) line by line.

## Suggested order

197 → 198 → 199 → 201 → 213 → 207 → 206 → 208 → 209 → 205 → 210 → 211 → 200 → 202 → 203 → 215 → 216, then the rest.
Reason: first make the work safe (off this PC, in CI), then close the two holes that reach other people, then make the
coverage report honest (213) so the card fixes after it can be counted, then the card families by how many cards each
one repairs.

---

## Phase A: process and repository

- [ ] **197. Push the work and let CI run on it.** (S, needs the owner)
  - Partly done (2026-11-14): `replay-exactness` is pushed and CI runs on it; the pull request to `main` is not opened (no `gh` tool on this PC; the owner opens it). Not ticked until `origin/main` holds the work.
  - Problem: versions 1.21.0 to 1.31.0 (11 commits, items 186 to 196) exist only on this PC. `replay-exactness` has no upstream branch; local `main` is 129 commits behind `origin/main`. CI (`selftest.yml`) only runs on pushes to `main` and on pull requests, so it has never run on rules 7 to 16. Item 177's Windows, macOS and Ubuntu jobs are "written, not yet run".
  - Evidence: `git branch -vv`, `git rev-list --count origin/main..HEAD` (11).
  - Fix: push `replay-exactness`, open a pull request to `main`, read the first CI run (expect surprises in the macOS and Windows jobs), merge. Fast-forward local `main`.
  - Done when: `origin/main` holds 1.31.0 and one CI run is green on all jobs (this also closes old item 177).

- [x] **198. Repository clean-up.** (S)
  - Done: the three tracked files are removed, `__pycache__/` is ignored, the stale zip is deleted; worktrees and branches are left for the owner.
  - Problem: files in git that shouldn't be: two empty files named `${x.a.iid}` and `${x.target}` in the root (a shell redirect accident in commit `89f198c`), and `__pycache__/server.cpython-313.pyc`. Not in git but stale: `Commander Table (portable).zip` in the game folder dated 11-07 (the script now writes the zip next to the folder), two old worktrees under `.claude/worktrees/`, branches `round5`, `claude/eager-roentgen-28567b`, `claude/trusting-hertz-0ba9c0`.
  - Fix: `git rm` the three tracked files, add `__pycache__/` to `.gitignore`, delete the stale zip. Ask the owner before removing worktrees and branches.
  - Done when: `git ls-files` shows none of them and `make-shareable-zip.ps1` still builds.

## Phase B: online seats and the local servers

- [x] **199. A friend's answer is not checked against what was asked.** (S, high priority)
  - Done: `askLive` accepts only an offered object, a whole-number player from the list and a button index in range; anything else is "cancel" (`tests/net.mjs`, 7 tests with a fake room).
  - Problem: `RemoteUI.askLive` in `public/js/net.js` accepts `ans.obj` as any object id in the whole game (`objs.find(...) || this.game.objects.get(ans.obj)`) and `ans.player` as any value at all, not only the choices that were offered. A friend with a seat link and a hand-written request can pick a card in another player's library or hand as a "target", or send a player value that throws inside the engine.
  - Where: `public/js/net.js` `askLive` (the `if (ans.obj != null)` and `if (ans.player != null)` lines). The replay path in `ask` may keep its fallback (recorded answers are the host's own).
  - Fix: accept `ans.obj` only if it is in `objs`; accept `ans.player` only if it is an integer in `players`; `ans.button` only if it is an integer index into `buttons`. Anything else is treated as no answer (`{ button: 'cancel' }` or keep waiting). Check `askSideboard` and the draft pick the same way (they already compare against their own lists).
  - Done when: a new test in `tests/` (Node, with a fake `room`) shows an unoffered object id, an out-of-range player and a string player are all refused, and offered ones still work.

- [ ] **200. The engine trusts its callers on targets and timing.** (M, do after 209)
  - Problem: `Game.cast` resolves a spell at whatever target it is handed, and `Game.canCast` doesn't look at timing. Legality lives in the AI and in `human.js`, which only offer legal choices. With 199 open this is how a friend could destroy an artifact with Doom Blade; with 199 closed it is defence in depth and it makes scenario tests honest.
  - Evidence: probes `[200]`: Doom Blade cast at Sol Ring destroys it; `canCast` is true for a sorcery on an opponent's turn. `validTarget` in `resolve.js` checks only hexproof, shroud and protection (`g.canTarget`), never the effect's `what`.
  - Where: `public/js/resolve.js` `validTarget` and its callers, `public/js/engine.js` `cast`, `public/js/mana.js` `canCast` / `castMode`.
  - Fix: one function that says whether an object fits an effect's target description (the same test the AI and `human.js` use to build their lists; find it and share it, don't write a third copy), called when a spell or ability is put on the stack and again on resolution. Add a timing argument to `canCast` (or a `canCastNow`) used by both agents. Rules 17.
  - Done when: both `[200]` probes pass and the stack tests still pass.

- [x] **201. Unescaped names in the log, and no content security policy.** (S)
  - Done: the three log lines escape names; all three servers send a `Content-Security-Policy` on HTML answers.
  - Problem: three log lines in `public/js/net.js` (`presence`, and two in `askLive`) put a player's name into log HTML without `esc()`. Names are typed by the host, but they are also loaded from tabletop and replay files (`main.js`, `s.name = p.name`), so opening a file someone made could run script on the host page, and that page may call `/api/update`. None of the three servers sends a `Content-Security-Policy` header.
  - Fix: use `this.game.pn(p)` or `esc()` in those three lines. Add `Content-Security-Policy` to every HTML answer in all three servers (start from `default-src 'self'`, then allow only the image and data hosts the game really calls: list them by reading `scryfall.js`, `combos.js`, `sets.js` and `bulk.js`; inline styles need `style-src 'self' 'unsafe-inline'`). Then load a replay file whose player name and card name contain `<img src=x onerror=alert(1)>` and check nothing runs: `main.js` has 99 `innerHTML` uses and `ui.js` 33, and card data inside a replay file is as untrusted as the names.
  - Done when: the crafted replay shows the text literally, the self-test passes on all three servers, and the browser console shows no CSP violations in a normal game.

- [x] **202. The three servers disagree on limits.** (S)
  - Done: one body limit (262,144 bytes) and a 413 answer in all three servers, resolved-path compare, redirects kept on the allowed hosts, control characters escaped in `Js()` (`tests/servers.mjs` asks a running server).
  - Problem: the friends' server reads at most 65,536 bytes of a request body in `Commander Table.exe` (`LanClient`) and `server.ps1`, but 2 MB in `server.py`, while the deck endpoint accepts 200,000 characters. On Windows a friend's deck or sideboard answer over 64 KB is cut off silently. Smaller things: `server.py`'s friend server refuses `/index.html` by exact text, so `/INDEX.HTML` or `/./index.html` gets through (harmless today because every host-only call is refused, but not what the comment says); `/api/fetch` follows redirects off the allowed-host list; the launcher's `Js()` doesn't escape control characters other than newline.
  - Fix: one limit (200,000 bytes plus headroom, for example 262,144) in all three; answer 413 instead of truncating; compare the resolved path, not the text; refuse redirects that leave `ALLOWED_HOSTS`; escape `\u0000` to `\u001f` in `Js()`. Rebuild the .exe.
  - Done when: a 150 KB deck posted to each friends' server arrives whole, and a probe script shows the same answers from all three for the cases above.

- [ ] **203. Updates and the tunnel tool are not verified.** (M)
  - Problem: `/api/update` checks a SHA-256 only if a `.sha256` file sits next to the zip on the same address, so it protects against a broken download, not against a replaced one. The update can overwrite `server.py` and the .exe. `cloudflared` is downloaded from GitHub's "latest" with no checksum.
  - Fix (free options only): show the SHA-256 and the address's host in the Updates window and ask the person to compare it with the one on the release page before "Install"; have `release.yml` publish the checksum in the release notes; for `cloudflared`, check the download against the digest GitHub publishes for the release asset (look it up through the releases API; if none is listed, show the file's SHA-256 and ask before running it), and say so in README.
  - Done when: an update whose bytes differ from the published checksum is refused on all three servers, and the tunnel refuses a `cloudflared` whose digest doesn't match.

- [x] **204. Decision for the owner: the Moxfield path.** (S)
  - Done (honest client name only): every proxied request says `CommanderTable/<version>`. The Moxfield attempt is kept; removing it is still the owner's choice.
  - Problem: the hard rule says never get around a site's bot protection and names Moxfield ("use EDHTop16 or the bookmarklet instead"). `decks.js` still tries `api2.moxfield.com` through `/api/fetch`, the proxy sends a desktop-browser `User-Agent`, and Moxfield's hosts are on all three allow lists.
  - Fix: decide. Either remove the Moxfield hosts and the two `proxied(...)` attempts and go straight to the bookmarklet message, or keep the attempt but send an honest `User-Agent` (`CommanderTable/<version>`) to every site. The honest `User-Agent` is worth doing either way.
  - Done when: the choice is written in README's deck-loading section and the three servers match.

## Phase C: rules engine and card reading

- [x] **213. Make the coverage report honest first.** (M, do before the other items in this phase)
  - Done: the scan's checks are `MISREAD` families in `tests/coverage.mjs`; those cards are listed as incorrect in `tests/card-coverage.md` until fixed.
  - Problem: "full" means no line was left unread; it does not mean the line's conditions were kept. About 280 of the 3,094 cards with no unread line lose part of their text silently (lists: `node tests/audit-probes.mjs --scan`). The numbers also disagree between documents: `cards.mjs` prints 2,806 fully read (80.2%), `card-coverage.md` says 2,796 full, ROADMAP item 97 says 88.2%.
  - Where: `tests/coverage.mjs` (the `MISREAD` checks), `tests/audit-probes.mjs` (`CHECKS`).
  - Fix: move the scan's checks into `coverage.mjs` as `MISREAD` families so those cards are listed as "incorrect" until fixed; have the reader mark what it dropped (preferred over word matching: when a pattern matches "target nonblack creature" and can't keep "nonblack", push the sentence to `fx.unread`, as item 188 did for skipped sentences). State one definition of "fully read" in README and ROADMAP and use one number.
  - Done when: the report's "incorrect" count includes these families and goes down as items 206 to 211 land.

- [x] **207. "X, where X is ..." plays as 0.** (M, 55 cards)
  - Done (rules 17): "where X is ..." is read into the dyn form; a clause that can't be read marks the line unread.
  - Problem: an amount written as X with its meaning in a "where X is" clause is read as `n: "X"`, and `X()` in `resolve.js` turns that into the X paid on casting, which is 0. Krenko, Mob Boss makes no Goblins; Chain Reaction deals 0; Dockside Extortionist makes no Treasures; also Chasm Skulker, Elenda the Dusk Rose, Scourge of Valkas, Disciple of Bolas and about 48 more.
  - Evidence: probes `[207]`; `--scan` lists the cards.
  - Where: `public/js/effects.js` (where amounts are read; there is already a "dyn" object form handled by `g.dynValue`), `public/js/resolve.js` line 71 (`const X = ...`).
  - Fix: read the "where X is <count>" clause into the existing dyn form (number of creatures you control, of a type, cards in hand, its power, artifacts and enchantments opponents control, and so on; reuse the counts `dynValue` already knows). When the clause can't be read, mark the line unread instead of producing `"X"`. Rules 17.
  - Done when: the three probes pass and the scan's list is empty or every card left on it is marked unread.

- [x] **206. An "if" the reader can't read counts as true.** (M, 93 cards)
  - Done (rules 17): coin flips use the game's seeded stream; common conditions are read; an unreadable condition does nothing when the effect resolves and is logged once a game ("Not simulated").
  - Problem: `evalCond` in `triggers.js` ends with `default: return true`, and an unreadable condition is stored as `{ c: '?' }`. Only "instead" upgrades and win effects are protected. So Mana Crypt deals its 3 damage every upkeep (no coin flip), The One Ring's protection doesn't care whether it was cast, Guardian Project draws for every creature, and 90 more cards get their bonus unconditionally.
  - Evidence: probe `[206]`; `--scan` lists the cards.
  - Fix: (a) a seeded coin flip (`g.rand`, never `Math.random`) as a real condition, for Mana Crypt and the other "flip a coin" cards; (b) read the most common conditions on the list ("if you cast it", "if it doesn't have the same name as", "if you control a ...", "if you attacked this turn"); (c) for what is still unreadable, mark the line unread so the card shows as partial. Whether an unreadable condition should then count as true or false is a judgement: false makes the card weaker than printed, true stronger; the project's own rule ("never approximated", items 191 and 194) points to doing nothing and reporting it once a game. Rules 17.
  - Done when: the probe passes and no card with a `'?'` condition is counted as full.

- [x] **208. Counterspells lose their conditions.** (M)
  - Done (rules 17): `unless` (the spell's controller is asked; the AI pays when the spell is worth it, a person gets a prompt), `mv`, `color` and `ifColor` on the counter effect; `counterFits` in `resolve.js` is the one test used on resolution and by the AI, which also keeps a soft counter when the caster can visibly pay. Modal counters (Pyroblast, Red Elemental Blast) are still not cast by the AI as counterspells.
  - Problem: the `counter` effect has no "unless its controller pays" and no mana value limit. Mana Leak, Spell Pierce, Daze, Flusterstorm and Miscast are hard counters; Mental Misstep counters anything; Disdainful Stroke counters anything; Pyroblast and Red Elemental Blast destroy any permanent. These are cEDH staples, so this changes who wins.
  - Evidence: probes `[208]`. In `resolve.js` `case 'counter'` there is no payment step.
  - Where: `public/js/effects.js` (the counter patterns), `public/js/resolve.js` `case 'counter'`, `public/js/ai.js` (when to cast them, and the choice to pay), `public/js/human.js` (the pay prompt).
  - Fix: fields on the effect: `unless: '{3}'` (the spell's controller is asked, AI pays when it can and the spell is worth it, a person gets a prompt; Rhystic Study's tax prompt is a model), `mv: { max: 1 }` or `{ min: 4 }`, and a color restriction for the Blasts (Pyroblast may target anything but only works on blue; Red Elemental Blast needs a blue target). The AI should value a soft counter lower late in the game. Rules 17.
  - Done when: the three probes pass, plus new tests for Spell Pierce on a creature spell (not a legal target), Daze paid by a player with one spare land, and Disdainful Stroke against mana value 3.

- [x] **209. Target restrictions are dropped.** (L, about 115 cards; the common ones first)
  - Done (rules 17), except "up to N targets": the first "target ..." phrase of each targeted effect is read into `tr` (not, colors, mv, power, tough, state, tapped, legendary, token, other, kw, ctl, and `kinds` for "creature or enchantment" lists); `targetFits` / `targetLegal` in `resolve.js` is the one test for the engine (cast and resolution), the AI and a person's list (`legalTargets`, moved from `human.js`). Still open: "up to N targets" (the engine has one target per effect; 27 cards stay listed as misread), "mana value X or less", and effects outside the targeted kinds (35 "you control" cards).
  - Problem: "target nonblack creature" is read as "creature". Same for nonartifact (Go for the Throat, Shriekmaw), mana value limits (Abrupt Decay, Despark), power and toughness limits (Valorous Stance), attacking or blocking, legendary, "up to N targets" (22 cards), and "you control" on 69 cards (the AI aims those at its own things anyway, but a person can blink an opponent's creature with Ephemerate).
  - Evidence: probe `[209]`; `--scan` lists each family.
  - Where: `public/js/effects.js` (the `what` of `remove`, `bounce`, `blink`, `protect` and friends), the function from item 200 that tests an object against a target description, `ai.js` and `human.js` target lists.
  - Fix: extend the target description (`what` plus `not`, `mv`, `power`, `state`, `ctl`) once, in one place, and use it for every targeted effect. Do the families in the order the scan counts them by how often the cards are played (the # in the scan is EDHREC rank). Rules 17.
  - Done when: the probe passes, each family has one test, and the scan lists only cards marked unread.

- [x] **205. Things that happen at the same time are handled one after another.** (L)
  - Done (rules 17): `Game.together` (`zones.js`) remembers the battlefield before the first permanent of an event leaves; "whenever a creature dies" and "leaves the battlefield" watchers are taken from it, and permanents entering together are told to the "enters" watchers once all are there. Used by board wipes, each pass of state-based actions (which also reads toughness and indestructible before anything leaves, 704.3; this covers lethal and combat damage), Living Death and mass reanimation. Not batched yet: "each player sacrifices" effects and sweeps that bounce or exile by other effect kinds.
  - Problem: a board wipe, lethal damage found by state-based actions, and combat damage move creatures to the graveyard one by one, and `noteDeath` in `zones.js` looks for "whenever a creature dies" watchers on the battlefield at that moment. A watcher that leaves earlier in the same event misses the later deaths (603.10a says leaves-the-battlefield abilities look back in time). Blood Artist with three other creatures under Wrath of God drains 1 instead of 4, and the result depends on the order permanents happen to be stored in.
  - Evidence: probes `[205]` (Wrath of God, Blasphemous Act, and the order test).
  - Where: `public/js/zones.js` `move` and `noteDeath`, `public/js/resolve.js` `case 'wipe'` and the sweep and damage effects, `public/js/triggers.js` `sbaPass`, `public/js/combat.js` `combatDamage`.
  - Fix: a batch around simultaneous zone changes: `g.together(() => { ... })` records the set of watchers present before the batch, moves everything, then calls `noteDeath` for each object with that recorded set (and the same for "leaves the battlefield" and "enters" watchers, so creatures entering together see each other: Living Death). One state-based-action pass is one batch (704.3). Replacement effects still apply per object. Rules 17; expect golden differences only under rules 17.
  - Done when: the three probes pass, a combat test where two creatures with death triggers kill each other passes, and item 215's order check finds nothing.

- [ ] **210. "Until this leaves the battlefield" is forgotten.** (M)
  - Problem: Banishing Light, Grasp of Fate, Hostage Taker, Touch the Spirit Realm and similar exile for good. (Oblivion Ring isn't in the test snapshots; check it too, it uses two triggers.)
  - Evidence: probe `[210]`.
  - Where: `public/js/effects.js` (the exile patterns), `public/js/zones.js` (leaving the battlefield).
  - Fix: the exiling permanent remembers what it exiled (`o.holds = [iid]`); when it leaves the battlefield those cards return under their owners' control (new objects, enter triggers fire, tokens are gone, a commander that went to the command zone stays there). If the source left before its trigger resolved, nothing is exiled (610.3). Hostage Taker also lets its controller cast the card. Rules 17.
  - Done when: the probe passes plus tests for the blink trick (source leaves in response: nothing exiled) and a token.

- [ ] **211. Imprint, and The One Ring.** (S)
  - Problem: Chrome Mox taps for any color with nothing imprinted (`o.imprinted` is stored in `engine.js` `cast` but `mana.js` never reads it). The One Ring's reading is "lose 1 life each upkeep" and "draw 1" where the card says one per burden counter (seen in the reading; confirm in a game before fixing, its test in `abilities.mjs` may cover part of it).
  - Evidence: probe `[211]`; `node -e` dump of the reading in the audit notes.
  - Fix: Chrome Mox makes mana only of the imprinted card's colors, none when nothing is imprinted; amounts on The One Ring become a dyn count of its burden counters. Rules 17.
  - Done when: the probe passes and The One Ring draws 1, 2, 3 on three turns and costs 3 life on the upkeep after.

- [ ] **212. Layers, and Humility.** (L, continues old item 90)
  - Problem: Humility is not read at all (reported, so not hidden), and item 90 (layers by timestamp, rule 613) is only done for layer 7b. Opalescence, Blood Moon with Urborg, Darksteel Mutation style Auras and "loses all abilities" depend on it.
  - Evidence: probe `[212]`.
  - Fix: finish item 90 first (copy, control, text, type, color, ability, then power and toughness sublayers, each by timestamp, with dependency for the type-changing pairs), then "loses all abilities" as a layer 6 effect that `g.has`, `abilitiesOf`, triggers and statics all respect.
  - Done when: the probe passes, plus Humility with a creature's enter trigger (doesn't trigger) and Blood Moon with Urborg (Urborg is a Mountain with no ability).

- [ ] **214. Known approximations to replace or report.** (M, pick by how often the card is played)
  - Necropotence: modelled as "at your end step pay up to 6 life, keep 15, draw that many" (`engine.js` `endSteps`). The card skips the draw step, exiles face down per life paid and discards exile. A person at the table can't choose how much to pay.
  - Sylvan Library: read as scry 2 (already listed as partial).
  - Extra turns: taken only by the active player right after their own turn, capped at 8 in a row; a player given an extra turn during someone else's turn waits. The cap ends real infinite-turn wins early; route them through the loop watcher (`loops.js`) instead.
  - Round limit: "highest life wins" is a simulator rule; make sure the results screen and replays say "round limit" and never count it as a normal win in learning (`learn.js`).
  - "You may play or cast it this turn" windows on 13 cards (scan `[214]`).
  - Each of these should either be modelled or appear in the "Not simulated" note the previews already have.

- [ ] **Old open items that still stand**: 97 and 98 (coverage targets; redo their numbers after 213), 115 (Kingdoms balance: the self-test run in this audit had Assassins winning 6 of 10), plus the coverage report's own lists: 8 misread, 10 read-but-unhandled (hideaway, escalate, strive, Abundance, Twinning Staff), 92 unread restrictions, 150 unsupported.

## Phase D: tests and tooling

- [ ] **215. Tests that would have caught this.** (M)
  - An order check in `invariants.js` or the fuzz test: before a board wipe or a state-based-action pass, copy the game, reverse each battlefield array in the copy, run both, compare life totals and zones (item 90 already asks for this for layers). Catches all of 205.
  - `node tests/audit-probes.mjs --scan` in CI as a ratchet, like the type check: a count per family that may only go down (after 213 this is `coverage.mjs`).
  - A Node test for `net.js` with a fake room (item 199), and one request script run against all three servers for limits and refusals (item 202) so "change all three servers" is checked, not remembered.
  - Scenario tests go through `g.cast` with real target checks once item 200 lands, so a test can't pass by handing the engine an illegal target.

- [x] **216. CI on every branch.** (S)
  - Done: the Node job runs on every push to any branch (Node 22 and 24); the three-system self-test stays for pull requests and `main`.
  - `selftest.yml` runs on pushes to `main` and on pull requests only. Add `push: branches: ['**']` for the Node job (it takes about two minutes; the golden games are 76 s of that) and keep the three-system self-test for pull requests. Pin Node to the version used locally or test two versions (CI uses 22, this PC runs 26).

- [ ] **217. Smaller modules (old item 176).** (L)
  - `main.js` is 270 KB and 3,900 lines, `effects.js` 269 KB, `ai.js` 148 KB. Splitting `main.js` (setup screen, results, online lobby, windows) is still the open half of item 176. For `effects.js`, group the pattern table by ability type so a family fix (207 to 210) touches one section. No behaviour change; golden games and card readings must be identical.

- [ ] **218. Documents agree with each other.** (S)
  - One coverage number and definition everywhere (see 213). `ROADMAP.md`'s "Rules for every session" says "keep both servers in step" (there are three) and describes the old test routine; point it at `CLAUDE.md`. `ROADMAP.md` is 180 KB: move rounds 1 to 4 to `docs/roadmap-archive.md` so a session can read the live part cheaply (ask the owner first; `tools/whatsnew.mjs` reads this file).

---

## Appendix: how the evidence was produced

- Suites: every command under "Testing" in `CLAUDE.md`, run once on 2026-11-13 with Node 26.
- Self-test: `Commander Table.exe --no-window`, then `http://localhost:8777/selftest.html?run` in the built-in browser pane.
- Probes: boards built with `tests/scenario.mjs`; a probe passes only when the board ends the way the Comprehensive Rules say. The ones that passed were dropped (commander tax and damage, infect, legend rule, Blood Moon, Null Rod, Cursed Totem, Rule of Law, Drannith Magistrate, Thalia, Panharmonicon, Grafdigger's Cage, cleanup, summoning sickness, storm, tokens leaving play, protection and Auras, Elesh Norn, vehicles, fetch lands and others).
- Reader scan: for each snapshot card with no unread line, a phrase in the card text is compared with what the reader produced. It is word matching: each hit needs a look before it is called a bug. The "you control" family in particular is mostly harmless for AI seats.
- Servers: `server.py` read top to bottom; for `server.ps1` and `launcher/CommanderTable.cs` only the matching safeguards were compared (origin checks, custom headers, key checks, rate limit, body limits, path checks). A full read of the launcher (1,067 lines) is still worth doing under item 202.
