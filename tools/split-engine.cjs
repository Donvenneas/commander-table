// Move a section of Game's methods into its own module: each method's body becomes an exported function taking the
// game as `g`, and the class keeps a one-line method that calls it (ROADMAP item 176). Usage: node tools/split-engine.cjs <startMarker> <endMarker> <module> <title>
const fs = require('fs');
const [,, startMark, endMark, mod, title] = process.argv;
const dir = require('path').join(__dirname, '..', 'public', 'js') + '/';
let src = fs.readFileSync(dir + 'engine.js', 'utf8');
const lines = src.split('\n');
const a = lines.findIndex(l => l === startMark);
const b = lines.findIndex((l, i) => i > a && l === endMark);
if (a < 0 || b < 0) throw new Error('markers');
const sec = lines.slice(a + 1, b);
// method starts: two-space indent, optional async, name(…) {  (also one-line methods)
const head = /^  (?:\/\*\*[^\n]*?\*\/ )?(async )?([A-Za-z_$][\w$]*)\((.*?)\) \{(.*)$/;
const out = [], stubs = [], names = [];
let i = 0;
const pending = [];
while (i < sec.length) {
  const l = sec[i];
  const m = l.match(head);
  if (!m) { pending.push(l); i++; continue; }
  // find the end: the next line that is exactly "  }" (or a one-line method ending in "}")
  let j = i, body;
  if (/\}\s*$/.test(m[4]) && balance(m[4]) < 0) { body = [l]; j = i; }
  else { j = i + 1; while (j < sec.length && sec[j] !== '  }') j++; body = sec.slice(i, j + 1); }
  const [, isAsync, name, params] = m;
  const jsdoc = (l.match(/^  (\/\*\*[^\n]*?\*\/) /) || [])[1];
  names.push(name);
  const comments = pending.splice(0);
  // the function in the new module
  const fnHead = `export ${isAsync ? 'async ' : ''}function ${name}(g${params ? ', ' + params : ''}) {`;
  let text = [fnHead + m[4], ...body.slice(1)].join('\n');
  // (only `this` in code: before a dot or as an argument, never in log text)
  text = text.replace(/\bthis\./g, 'g.').replace(/([(\[,]\s*)this(?=\s*[,)\]])/g, '$1g');
  // dedent by 2
  text = text.split('\n').map(x => x.replace(/^  /, '')).join('\n');
  // (a JSDoc block just above the method gets the game's @param added; otherwise a new one)
  const cm = comments.map(x => x.replace(/^  /, ''));
  const jsStart = cm.length && /\*\/\s*$/.test(cm[cm.length - 1]) ? cm.map(x => /^\/\*\*/.test(x)).lastIndexOf(true) : -1;
  if (jsStart >= 0 && !jsdoc) {
    const blk = cm.slice(jsStart).join('\n').replace(/^\/\*\*/, `/** @param {import('./engine.js').Game} g`);
    out.push(...cm.slice(0, jsStart), blk, text);
  } else out.push(...cm, `/** @param {import('./engine.js').Game} g${paramDocs(jsdoc)} */`, text);
  const args = params.split(',').map(x => x.trim().split('=')[0].trim().replace(/^\.\.\./, '...')).filter(Boolean);
  stubs.push(...comments, `  ${jsdoc ? jsdoc + ' ' : ''}${isAsync ? 'async ' : ''}${name}(${params}) { return ${mod.replace(/\W/g, '')}.${name}(this${args.length ? ', ' + args.join(', ') : ''}); }`);
  i = (body.length === 1 ? i : j) + 1;
}
if (pending.length) stubs.push(...pending);
function balance(s) { let n = 0; for (const c of s) { if (c === '{') n++; if (c === '}') n--; } return n; }
function paramDocs(jsdoc) { if (!jsdoc) return ''; const inner = jsdoc.replace(/^\/\*\*\s*|\s*\*\/$/g, ''); return inner ? ' ' + inner : ''; }
lines.splice(a + 1, b - a - 1, ...stubs);
src = lines.join('\n');
fs.writeFileSync(dir + 'engine.js', src);
fs.writeFileSync(dir + mod + '.js', `// ${title}\n// Split out of engine.js (Round 5, item 176): each function is one of Game's methods, with the game as \`g\`; Game keeps\n// a one-line method that calls it, so nothing else changes.\n` + out.join('\n') + '\n');
console.log('moved', names.length, 'methods:', names.join(', '));
