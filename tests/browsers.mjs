// Runs the self-test and the interface test in a browser installed on this PC, headless, with a throwaway profile
// (Phase 2O), using only Node: Chrome through the DevTools protocol, Firefox through WebDriver BiDi. No Playwright,
// no download. Needs a running server.
//   node tests/browsers.mjs chrome  "C:\Program Files\Google\Chrome\Application\chrome.exe"  [http://localhost:8777]
//   node tests/browsers.mjs firefox "C:\Program Files\Mozilla Firefox\firefox.exe"           [http://localhost:8777]
// Microsoft Edge is never launched (the project's rules).
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [kind, exe, base = 'http://localhost:8777'] = process.argv.slice(2);
if (!['chrome', 'firefox'].includes(kind) || !exe || /msedge/i.test(exe)) { console.log('usage: node tests/browsers.mjs chrome|firefox <path to the browser>'); process.exit(2); }
const sleep = t => new Promise(r => setTimeout(r, t));
const profile = mkdtempSync(join(tmpdir(), `ct-${kind}-`));
const port = kind === 'chrome' ? 9341 : 9342;
const args = kind === 'chrome'
  ? ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--window-size=1500,1000', 'about:blank']
  : ['-headless', '-no-remote', '-profile', profile, '--remote-debugging-port', String(port), '-width', '1500', '-height', '1000', 'about:blank'];
const proc = spawn(exe, args, { stdio: 'ignore' });

// A tiny JSON-over-WebSocket client: send(method, params) → result
async function connect(url) {
  const ws = new WebSocket(url);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error(`can't connect to ${url}`)); });
  let id = 0;
  const waiting = new Map();
  ws.onmessage = m => { const d = JSON.parse(String(m.data)); if (d.id && waiting.has(d.id)) { const w = waiting.get(d.id); waiting.delete(d.id); d.error ? w.rej(new Error(JSON.stringify(d.error).slice(0, 300))) : w.res(d.result); } };
  return { send: (method, params = {}, extra = {}) => new Promise((res, rej) => { const i = ++id; waiting.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params, ...extra })); }), close: () => ws.close() };
}

let version = '?';
/** @type {(url: string) => Promise<void>} */ let go;
/** @type {(expr: string) => Promise<any>} */ let evaluate;
let client;
try {
  if (kind === 'chrome') {
    let targets;
    for (let i = 0; i < 50 && !targets; i++) { await sleep(300); targets = await fetch(`http://127.0.0.1:${port}/json`).then(r => r.json()).catch(() => null); }
    version = (await fetch(`http://127.0.0.1:${port}/json/version`).then(r => r.json())).Browser;
    client = await connect(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
    go = url => client.send('Page.navigate', { url });
    evaluate = async expr => (await client.send('Runtime.evaluate', { expression: expr, returnByValue: true })).result?.value;
  } else {
    for (let i = 0; i < 60 && !client; i++) { await sleep(500); client = await connect(`ws://127.0.0.1:${port}/session`).catch(() => null); }
    if (!client) throw new Error('Firefox did not open its WebDriver BiDi port');
    const s = await client.send('session.new', { capabilities: {} });
    version = `Firefox ${s.capabilities?.browserVersion}`;
    const tree = await client.send('browsingContext.getTree', {});
    const ctx = tree.contexts[0].context;
    await client.send('browsingContext.setViewport', { context: ctx, viewport: { width: 1500, height: 1000 } }).catch(() => {});
    go = url => client.send('browsingContext.navigate', { context: ctx, url, wait: 'complete' });
    evaluate = async expr => { const r = await client.send('script.evaluate', { expression: expr, target: { context: ctx }, awaitPromise: true }); return r.result?.value; };
  }
  console.log(`${version} (headless, throwaway profile)`);
  let failed = 0;
  for (const [page, minutes] of [['selftest.html', 4], ['uitest.html', 6]]) {
    await go(`${base}/${page}?run`);
    const t0 = Date.now();
    let summary = '';
    while (Date.now() - t0 < minutes * 60000) {
      await sleep(2000);
      summary = (await evaluate("document.getElementById('summary')?.textContent || ''").catch(() => '')) || '';
      if (summary && !/Running|Starting|…/.test(summary)) break;
    }
    // Rows that didn't pass, from either page's table
    const rows = await evaluate(`JSON.stringify([...document.querySelectorAll('tr')].map(r => [...r.cells].map(c => c.textContent.trim())).filter(c => c.length >= 2 && /fail|error|not run|warn/i.test(c[1] || c[2] || '')).map(c => c.join(' | ').slice(0, 220)))`).catch(() => '[]');
    const bad = JSON.parse(rows || '[]');
    const pass = /All \d+ checks passed|\d+ passed, 0 failed/.test(summary);
    if (!pass) failed++;
    console.log(`${pass ? 'ok  ' : 'FAIL'}  ${page}: ${summary || '(no summary)'} (${Math.round((Date.now() - t0) / 1000)} s)`);
    for (const r of bad) console.log(`        ${r}`);
  }
  process.exitCode = failed ? 1 : 0;
} catch (e) {
  console.log(`FAIL  ${kind}: ${e.message}`);
  process.exitCode = 1;
} finally {
  try { client?.close(); } catch { /* closed */ }
  proc.kill();
  await sleep(1500);
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* still locked */ }
}
