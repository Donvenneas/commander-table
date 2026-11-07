// Deck library: decklists saved as text files in the game folder's data\decks (through the local server),
// so they travel with the folder to another PC.
const H = { 'X-Commander-Table': 'library' };

export async function listDecks() {
  const r = await fetch('/api/library');
  if (!r.ok) throw new Error(r.status === 404 ? 'Restart Commander Table to use the deck library' : `The library answered ${r.status}`);
  return (await r.json()).sort((a, b) => a.name.localeCompare(b.name));
}

export async function saveDeck(name, text) {
  const r = await fetch(`/api/library?name=${encodeURIComponent(name)}`, { method: 'POST', headers: H, body: text });
  if (!r.ok) throw new Error(await r.text());
  return (await r.json()).name;
}

export async function deleteDeck(name) {
  const r = await fetch(`/api/library?name=${encodeURIComponent(name)}`, { method: 'DELETE', headers: H });
  if (!r.ok) throw new Error(await r.text());
}
