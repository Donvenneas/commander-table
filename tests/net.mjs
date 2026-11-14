// Online seats, host side (item 199): a friend's answer counts only when it is one of the choices that were offered.
// A fake room hands RemoteUI.askLive whatever a hand-written request could send.
//   node tests/net.mjs
import { RemoteUI } from '../public/js/net.js';

const results = [];
const test = async (name, fn) => { try { await fn(); results.push([name, null]); } catch (e) { results.push([name, e]); } };
const eq = (got, want, what) => { if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`${what}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); };

// The friend answers the question that is waiting with `reply` (the id is filled in, as their page would)
const ask = async (reply, opts) => {
  let q = null;
  const room = { ask: async (seat, question) => { q = question; }, answer: async () => (q ? { id: q.id, ...reply } : null), seen: () => 0 };
  const ui = new RemoteUI(room, 1, 5);
  const hidden = { iid: 99, card: { name: 'A card in another library' } };
  ui.attach({ objects: new Map([[99, hidden], [7, opts.objs?.[0]]]), players: [{ name: 'P1' }, { name: 'P2' }], log() {}, emit() {} });
  const v = await ui.askLive('Choose', opts);
  return v.obj ? { obj: v.obj.iid } : v;
};
const sol = { iid: 7, card: { name: 'Sol Ring' } };
const buttons = [{ label: 'Attack P1', value: 0, primary: true }, { label: 'Pass', value: 'pass' }];

await test('An offered card is accepted', async () => eq(await ask({ obj: 7 }, { objs: [sol], buttons }), { obj: 7 }, 'answer'));
await test('A card that was not offered (any other object in the game) is refused', async () => eq(await ask({ obj: 99 }, { objs: [sol], buttons }), { button: 'cancel' }, 'answer'));
await test('An offered player is accepted', async () => eq(await ask({ player: 1 }, { players: [0, 1], buttons }), { player: 1 }, 'answer'));
await test('A player that was not offered is refused', async () => eq(await ask({ player: 3 }, { players: [0, 1], buttons }), { button: 'cancel' }, 'answer'));
await test('A player that is not a number is refused', async () => eq(await ask({ player: '__proto__' }, { players: [0, 1], buttons }), { button: 'cancel' }, 'answer'));
await test('A button is its index: the value 0 comes through as 0', async () => eq(await ask({ button: 0 }, { buttons }), { button: 0 }, 'answer'));
await test('A button index out of range, or not a whole number, is "cancel"', async () => {
  eq(await ask({ button: 5 }, { buttons }), { button: 'cancel' }, 'index 5');
  eq(await ask({ button: 'constructor' }, { buttons }), { button: 'cancel' }, 'a word');
});

for (const [name, e] of results) console.log(`${e ? 'FAIL' : 'ok  '}  ${name}${e ? `\n        ${e.message}` : ''}`);
const bad = results.filter(r => r[1]).length;
console.log(`Online seats: ${results.length} tests, ${results.length - bad} passed, ${bad} failed.`);
process.exit(bad ? 1 : 0);
