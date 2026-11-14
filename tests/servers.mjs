// The same answers from every server (items 201 and 202): run against a server that is already started.
//   py server.py --no-browser --port 8795          then   node tests/servers.mjs http://localhost:8795
//   powershell -File server.ps1 -Port 8796 -NoBrowser     node tests/servers.mjs http://localhost:8796
//   "Commander Table.exe" --no-window                     node tests/servers.mjs http://localhost:8777
// It opens a room with one online seat (and closes it again), so don't run it against a game in progress.
const base = (process.argv[2] || 'http://localhost:8777').replace(/\/$/, '');
const results = [];
const test = async (name, fn) => { try { const note = await fn(); results.push([name, null, note]); } catch (e) { results.push([name, e]); } };
const eq = (got, want, what) => { if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`${what}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); };
const ok = (c, what) => { if (!c) throw new Error(what); };

await test('The page comes with a content security policy and nosniff', async () => {
  const r = await fetch(base + '/');
  const csp = r.headers.get('content-security-policy') || '';
  ok(/default-src 'self'/.test(csp) && /script-src 'self'/.test(csp) && !/script-src[^;]*unsafe/.test(csp), `policy: ${csp || 'none'}`);
  eq(r.headers.get('x-content-type-options'), 'nosniff', 'X-Content-Type-Options');
});
await test('The deck-site proxy refuses a site that is not on the list', async () => {
  eq((await fetch(base + '/api/fetch?url=' + encodeURIComponent('https://example.com/'))).status, 400, 'status');
});
await test('Host-only calls from another website are refused', async () => {
  eq((await fetch(base + '/api/room/status', { headers: { Origin: 'https://example.com' } })).status, 403, 'status');
});

const open = await (await fetch(base + '/api/room/open', { method: 'POST', body: '1' })).json();
const lan = `http://localhost:${open.port}`, key = open.keys?.['1'];
try {
  await test('The friends\' server opens', async () => { ok(open.port && key, `open answered ${JSON.stringify(open).slice(0, 80)}`); });
  await test('Friends get the join page with the policy, never the host\'s page', async () => {
    const r = await fetch(lan + '/');
    ok(/default-src 'self'/.test(r.headers.get('content-security-policy') || ''), 'policy on the join page');
    for (const p of ['/index.html', '/INDEX.HTML', '/./index.html', '/js/../index.html', '/api/library', '/api/update'])
      eq((await fetch(lan + p)).status, 404, p);
  });
  await test('A friend cannot use host-only room calls', async () => {
    eq((await fetch(`${lan}/api/room/close`, { method: 'POST' })).status, 403, 'close');
    eq((await fetch(`${lan}/api/room/state?seat=1`, { method: 'POST', body: '{}' })).status, 403, 'state');
  });
  await test('A wrong seat key is refused', async () => {
    eq((await fetch(`${lan}/api/room/view?seat=1&code=AAAAAAAAAA`)).status, 403, 'status');
  });
  await test('A 150,000-character decklist from a friend arrives whole', async () => {
    const deck = '1 Island\n'.repeat(16667).slice(0, 150000);
    eq((await fetch(`${lan}/api/room/deck?seat=1&code=${key}`, { method: 'POST', body: deck })).status, 200, 'post');
    const back = await (await fetch(`${base}/api/room/deck?seat=1`)).text();
    eq(back.length, deck.length, 'length the host reads back');
  });
  await test('More than 262,144 bytes from a friend is refused with 413, not cut short', async () => {
    let status;
    try { status = (await fetch(`${lan}/api/room/deck?seat=1&code=${key}`, { method: 'POST', body: 'x'.repeat(300000) })).status; } catch { status = 'connection closed'; }
    ok(status === 413 || status === 'connection closed', `status ${status}`);
    eq((await (await fetch(`${base}/api/room/deck?seat=1`)).text()).length, 0, 'nothing stored');
  });
  await test('A name with a tab and a quote keeps the status answer valid JSON', async () => {
    await fetch(`${lan}/api/room/hello?seat=1&code=${key}`, { method: 'POST', body: 'Tab\there "quoted" \ back' });
    const st = await (await fetch(`${base}/api/room/status`)).json();
    ok(typeof st['1']?.name === 'string' && st['1'].name.includes('quoted'), `name: ${JSON.stringify(st['1'])}`);
  });
} finally {
  await fetch(base + '/api/room/close', { method: 'POST' }).catch(() => {});
}

for (const [name, e] of results) console.log(`${e ? 'FAIL' : 'ok  '}  ${name}${e ? `\n        ${e.message}` : ''}`);
const bad = results.filter(r => r[1]).length;
console.log(`Servers (${base}): ${results.length} tests, ${results.length - bad} passed, ${bad} failed.`);
process.exit(bad ? 1 : 0);
