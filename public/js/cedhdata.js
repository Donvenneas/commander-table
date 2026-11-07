// cEDH data from two community sites:
//  • EDHTop16 (edhtop16.com): tournament results. Which commanders are winning, and the actual
//    100-card decklists of top finishers (from TopDeck.gg). Read through its public GraphQL API,
//    which only accepts the site's own registered queries, so we use those by ID.
//  • cEDH Decklist Database (cedh-decklist-database.com): the community's curated list of
//    competitive archetypes, with sections, descriptions and Moxfield lists. Moxfield blocks
//    downloads from programs, so the actual cards for a database archetype come from EDHTop16's
//    most recent top finish with the same commander(s).

const QUERY = {
  commanders: 'adb86c7711e577a33ffd053410380b2b',   // page_CommandersQuery
  entries: '124b6abe467f15a68b2a706f3e192fd5',      // entries_CommanderEntriesQuery
  decklist: '9e246f3401cf45ec6c7ee849dff18c16',     // page_DecklistQuery (by entry number)
  tournamentDecklist: '174a9e55f722e323da90aa47ff02954e', // page_TournamentDecklistQuery (by tournament + player)
};

async function gql(id, variables) {
  const r = await fetch('/api/edhtop16', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: null, variables, extensions: { 'pastoria-id': id } }) });
  if (!r.ok) throw new Error(r.status === 404 ? 'Restart Commander Table to load EDHTop16 data' : `EDHTop16 answered ${r.status}`);
  const j = await r.json();
  if (j.errors?.length) throw new Error(`EDHTop16: ${j.errors[0].message || j.errors[0]}`);
  return j.data;
}

// Answers are kept in memory for this session and saved in the browser profile (which lives in the
// game folder's data/), so the meta browser and meta decks still work offline after one load.
// Saved answers are used when the site can't be reached, and refreshed whenever it can.
const cache = new Map();
const SAVED = 'ct.cedh';
const savedAll = () => { try { return JSON.parse(localStorage.getItem(SAVED) || '{}'); } catch { return {}; } };
function save(key, value) {
  try {
    const all = savedAll();
    all[key] = { at: Date.now(), value };
    // Keep the 150 newest answers
    const keys = Object.keys(all).sort((a, b) => all[b].at - all[a].at);
    for (const k of keys.slice(150)) delete all[k];
    localStorage.setItem(SAVED, JSON.stringify(all));
  } catch { /* storage full or blocked: memory cache still works */ }
}
// When the last answer for `key` came from the saved copy, the date it was saved
export const offlineSince = new Map();
const cached = (key, f) => {
  if (!cache.has(key)) cache.set(key, f().then(v => { save(key, v); offlineSince.delete(key); return v; }).catch(e => {
    const s = savedAll()[key];
    if (s) { offlineSince.set(key, s.at); return s.value; }
    cache.delete(key);
    throw e;
  }));
  return cache.get(key);
};
export const savedCount = () => Object.keys(savedAll()).length;

// The most-played commanders in recent tournaments, with meta share and win rates.
// colorId: exact color identity like "UB" ("" for any; "C" for colorless)
export function topCommanders({ count = 40, timePeriod = 'THREE_MONTHS', minSize = 32, colorId = '' } = {}) {
  return cached(`top:${count}:${timePeriod}:${minSize}:${colorId}`, async () => {
    const d = await gql(QUERY.commanders, { timePeriod, sortBy: 'POPULARITY', minEntries: 0, minSize, colorId, count });
    return d.commanders.edges.map(e => ({ name: e.node.name, colorId: e.node.colorId, art: e.node.cards?.[0]?.imageUrls?.[0] || '', ...e.node.stats }));
  });
}

// Recent top finishes for one commander (names as EDHTop16 writes them, partners joined with " / ")
export function commanderEntries(commander, { count = 12, maxStanding = 16, minEventSize = 32, timePeriod = 'SIX_MONTHS' } = {}) {
  return cached(`entries:${commander}:${count}:${maxStanding}`, async () => {
    const d = await gql(QUERY.entries, { commander, maxStanding, minEventSize, sortBy: 'NEW', timePeriod, count });
    return (d.commander?.entries?.edges || []).map(e => ({
      entry: Number(atob(e.node.id).split(':')[1]), standing: e.node.standing, wins: e.node.wins, losses: e.node.losses, draws: e.node.draws,
      player: e.node.player?.name || '', tournament: e.node.tournament?.name || '', size: e.node.tournament?.size || 0,
      date: (e.node.tournament?.tournamentDate || '').slice(0, 10), url: `https://edhtop16.com${e.node.decklistUrl}`,
    }));
  });
}

// A full decklist as plain text the deck loader understands
function toText(entry) {
  const cmds = entry.commander?.cards?.map(c => c.name) || [];
  const lines = (entry.decklistItems || []).filter(i => !cmds.includes(i.card.name)).map(i => `${i.count} ${i.card.name}`);
  return ['Commander', ...cmds.map(c => `1 ${c}`), '', 'Deck', ...lines].join('\n');
}
function describe(entry) {
  const t = entry.tournament || {};
  return `${entry.commander?.name || 'cEDH'}: #${entry.standing} at ${t.name || 'a tournament'} (${t.size || '?'} players, ${(t.tournamentDate || '').slice(0, 10)}) by ${entry.player?.name || 'unknown'}`;
}
export function decklistByEntry(n) {
  return cached(`list:${Number(n)}`, async () => {
    const d = await gql(QUERY.decklist, { entry: Number(n) });
    if (!d.entry?.decklistItems?.length) throw new Error("That EDHTop16 entry doesn't have a decklist");
    return { text: toText(d.entry), name: describe(d.entry) };
  });
}
export async function decklistByLink(tid, profile) {
  const d = await gql(QUERY.tournamentDecklist, { tid, profile });
  if (!d.tournamentEntry?.decklistItems?.length) throw new Error("That EDHTop16 entry doesn't have a decklist");
  return { text: toText(d.tournamentEntry), name: describe(d.tournamentEntry) };
}

// The newest top-16 decklist for a commander, or for a random top-meta commander
export async function metaDeck(commander, onStatus) {
  if (!commander) {
    onStatus?.('Picking a commander from the EDHTop16 meta…');
    const top = await topCommanders({ count: 30 });
    commander = top[Math.floor(Math.random() * top.length)].name;
  }
  onStatus?.(`Finding a recent top finish for ${commander}…`);
  let entries = await commanderEntries(commander);
  // Partner names may be listed in the other order
  if (!entries.length && commander.includes(' / ')) entries = await commanderEntries(commander.split(' / ').reverse().join(' / '));
  // Skip placeholder events dated in the future; prefer the best finishes among the newest events
  const today = new Date().toISOString().slice(0, 10);
  entries = entries.filter(e => !e.date || e.date <= today).slice(0, 12).sort((a, b) => a.standing - b.standing);
  if (!entries.length) throw new Error(`No recent EDHTop16 top-16 decklist for ${commander}`);
  for (const e of entries) {
    try { return await decklistByEntry(e.entry); } catch { /* some entries have no list; try the next */ }
  }
  throw new Error(`No decklist available for ${commander} on EDHTop16`);
}

// A deck against recent top-16 tournament lists for the same commander(s): the cards most of those
// lists play that this one doesn't, and this deck's cards none of them play
export async function compareWithMeta(deck, onStatus, max = 10) {
  const name = edhtop16Name(deck.commanders.map(c => c.name));
  onStatus?.(`Finding tournament lists for ${name}…`);
  let entries = await commanderEntries(name);
  if (!entries.length && deck.commanders.length === 2) entries = await commanderEntries(deck.commanders.map(c => c.name).reverse().join(' / '));
  const today = new Date().toISOString().slice(0, 10);
  entries = entries.filter(e => !e.date || e.date <= today).slice(0, max);
  if (!entries.length) throw new Error(`EDHTop16 has no recent top-16 lists for ${name}`);
  const lists = [];
  for (const [i, e] of entries.entries()) {
    onStatus?.(`Reading tournament list ${i + 1} of ${entries.length}…`);
    try {
      const { text } = await decklistByEntry(e.entry);
      const names = new Set(text.split('\n').map(l => l.match(/^\d+\s+(.+)$/)?.[1]).filter(Boolean).map(n => n.split(' // ')[0].toLowerCase()));
      lists.push(names);
    } catch { /* an entry without a list */ }
  }
  if (!lists.length) throw new Error('None of the recent lists could be read');
  const count = new Map();
  for (const l of lists) for (const n of l) count.set(n, (count.get(n) || 0) + 1);
  const basic = /^(plains|island|swamp|mountain|forest|wastes|snow-covered .*)$/;
  const mine = new Set([...deck.commanders.map(c => c.name), ...deck.cards.map(c => c.card.name)].map(n => n.split(' // ')[0].toLowerCase()));
  const cmdrs = new Set(deck.commanders.map(c => c.name.split(' // ')[0].toLowerCase()));
  const pretty = n => n.replace(/\b\w/g, c => c.toUpperCase());
  const missing = [...count].filter(([n, k]) => !mine.has(n) && !basic.test(n) && !cmdrs.has(n) && k / lists.length >= 0.5)
    .sort((a, b) => b[1] - a[1]).map(([n, k]) => ({ name: pretty(n), share: k / lists.length }));
  const realName = new Map([...deck.cards.map(c => c.card.name)].map(n => [n.split(' // ')[0].toLowerCase(), n]));
  const unique = [...mine].filter(n => !count.has(n) && !basic.test(n) && !cmdrs.has(n)).map(n => realName.get(n) || pretty(n));
  return { lists: lists.length, commander: name, missing, unique };
}

// ---------- cEDH Decklist Database
export function ddbDecks() {
  return cached('ddb', async () => {
    const r = await fetch('/api/fetch?url=' + encodeURIComponent('https://cedh-decklist-database.com/'));
    if (!r.ok) throw new Error(`cEDH Decklist Database answered ${r.status}`);
    const doc = new DOMParser().parseFromString(await r.text(), 'text/html');
    return [...doc.querySelectorAll('li[data-title]')].map(li => ({
      id: li.id,
      title: li.dataset.title,
      colors: (li.dataset.colors || '').toUpperCase().split(/\s+/).filter(Boolean),
      updated: (li.dataset.updated || '').slice(0, 10),
      section: li.querySelector('.ddb-section')?.textContent.trim() || '',
      commanders: [...li.querySelectorAll('.ddb-commanders li')].map(x => x.textContent.trim()),
      description: li.querySelector('.ddb-description')?.textContent.trim() || '',
      lists: [...li.querySelectorAll('.ddb-decklists a')].map(a => ({ name: a.textContent.trim(), url: a.href })),
      discord: li.querySelector('.ddb-discord')?.href || '',
    })).filter(d => d.commanders.length);
  });
}

// EDHTop16 writes partner pairs alphabetically and joined with " / "
export function edhtop16Name(commanders) { return [...commanders].sort().join(' / '); }
