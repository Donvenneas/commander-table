# Card data diagnostics

Written by `node tests/carddata.mjs --report tests/card-data.md` from `tests/cards-snapshot.json` (the 3,500 most-played Commander cards). This measures the card *data*; how well the engine *plays* each card is a separate measurement (`tests/card-coverage.md`). A card whose text was read is not called implemented here.

| Measure | Cards | Share |
|---|---:|---:|
| Cards checked | 3500 |  |
| Valid records (carddata.js check) | 3500 | 100.0% |
| Damaged records | 0 | 0.0% |
| Duplicate Scryfall ids | 0 |  |
| Duplicate oracle ids | 0 |  |
| Valid identifiers (Scryfall id and oracle id) | 3500 | 100.0% |
| Complete source data | 3500 | 100.0% |
| More than one face | 113 | 3.2% |
| With rules text | 3497 | 99.9% |
| Without rules text (vanilla, basic lands) | 3 | 0.1% |
| Rules text read without an error | 3497 | 99.9% |
| Reading errors | 0 |  |
| Every ability recognised | 2804 | 80.1% |
| Some abilities recognised, some text unread | 665 | 19.0% |
| Rules text (almost) entirely unread | 28 | 0.8% |

Missing data: none. Problems found: none.

## Layouts

| Layout | Cards | Faces | Faces handled by the engine |
|---|---:|---:|---|
| normal | 3361 | 1 | full |
| modal_dfc | 51 | 2 | full |
| transform | 31 | 2 | full |
| adventure | 17 | 2 | full |
| saga | 12 | 1 | full |
| split | 10 | 2 | full |
| class | 8 | 1 | full |
| prepare | 4 | 2 | partial |
| meld | 4 | 1 | none |
| case | 2 | 1 | partial |

Faces handled: full = every face is played as printed (whether each card's abilities are read is the coverage report's measure); partial = the first face is played, the others are kept as data or played in part; none = kept as data only. Every layout: `public/js/carddata.js` LAYOUT_SUPPORT.

Checking and reading took 6421 ms.
