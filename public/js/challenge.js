// Challenge links: a table setup (format, match length, each seat's name, style, bracket and deck
// source) or a puzzle, packed into a link or a code. Nothing is stored anywhere: everything is in the
// text, compressed (deflate) and written in URL-safe base64. Anyone running Commander Table opens it
// on their own PC (http://localhost:8777/#challenge=…), or pastes the code on the setup screen.
const b64 = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64 = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), c => c.charCodeAt(0));
async function squeeze(text) {
  if (typeof CompressionStream === 'undefined') return 'r' + b64(new TextEncoder().encode(text));
  const buf = await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer();
  // (large arrays spread into String.fromCharCode in chunks)
  const u = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < u.length; i += 8192) s += String.fromCharCode(...u.subarray(i, i + 8192));
  return 'z' + btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function unsqueeze(code) {
  const kind = code[0], body = code.slice(1);
  if (kind === 'r') return new TextDecoder().decode(unb64(body));
  if (kind !== 'z') throw new Error('That isn\'t a challenge code.');
  return new Response(new Blob([unb64(body)]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text();
}

// table: { format, bestOf, seats: [{ name, style, bracket, source }] } or { puzzle }
export async function encodeChallenge(table) {
  return squeeze(JSON.stringify({ app: 'commander-table-challenge', v: 1, ...table }));
}
export async function decodeChallenge(code) {
  // (a whole link, "challenge=…" from the address bar, or the bare code)
  code = String(code || '').trim().replace(/^.*challenge=/, '').replace(/[&#].*$/, '');
  const data = JSON.parse(await unsqueeze(code));
  if (data.app !== 'commander-table-challenge') throw new Error('That isn\'t a challenge code.');
  return data;
}
export const challengeLink = code => `${location.origin}/#challenge=${code}`;
