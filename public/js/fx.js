// Particle effects drawn on one canvas over the page: spell casts, combat clashes, hits, deaths, healing
// and combos, plus slow ambient motes over the table. The canvas only animates while something is
// moving, and everything is skipped in "Fewer animations" mode or when the page is hidden.
const TAU = Math.PI * 2;
let canvas = null, ctx = null, parts = [], running = false, ambient = null, dpr = 1;

function ensure() {
  if (canvas) return true;
  canvas = document.createElement('canvas');
  canvas.className = 'fx-canvas';
  document.body.append(canvas);
  ctx = canvas.getContext('2d');
  const size = () => { dpr = Math.min(2, window.devicePixelRatio || 1); canvas.width = innerWidth * dpr; canvas.height = innerHeight * dpr; };
  size();
  addEventListener('resize', size);
  return true;
}
const calm = () => document.body.classList.contains('calm') || document.hidden;

function hexRgb(c) {
  const m = /^#?([0-9a-f]{6})$/i.exec((c || '').trim());
  if (!m) return [140, 170, 255];
  const n = parseInt(m[1], 16);
  return [n >> 16, (n >> 8) & 255, n & 255];
}
const centerOf = t => {
  if (t && typeof t.getBoundingClientRect === 'function') { const r = t.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height }; }
  return { x: t?.x ?? innerWidth / 2, y: t?.y ?? innerHeight / 2, w: 60, h: 80 };
};

function loop() {
  if (!parts.length && !ambient) { running = false; ctx.clearRect(0, 0, canvas.width, canvas.height); return; }
  running = true;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, innerWidth, innerHeight);
  ctx.globalCompositeOperation = 'lighter';
  if (ambient) drawAmbient();
  const now = performance.now();
  parts = parts.filter(p => now - p.t0 < p.life);
  for (const p of parts) {
    const k = (now - p.t0) / p.life;
    p.vx *= p.drag; p.vy = p.vy * p.drag + p.grav;
    p.x += p.vx; p.y += p.vy;
    const a = p.fade ? (1 - k) * p.a : p.a * Math.sin(Math.PI * Math.min(1, k * 1.2));
    if (p.ring) {
      ctx.strokeStyle = `rgba(${p.rgb},${a})`;
      ctx.lineWidth = p.lw * (1 - k) + 0.5;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r0 + (p.r1 - p.r0) * k, 0, TAU); ctx.stroke();
      continue;
    }
    const r = p.r * (p.shrink ? 1 - k * 0.8 : 1);
    const grd = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 3);
    grd.addColorStop(0, `rgba(255,255,255,${a})`);
    grd.addColorStop(0.25, `rgba(${p.rgb},${a * 0.85})`);
    grd.addColorStop(1, `rgba(${p.rgb},0)`);
    ctx.fillStyle = grd;
    ctx.beginPath(); ctx.arc(p.x, p.y, r * 3, 0, TAU); ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
  requestAnimationFrame(loop);
}
function start() { if (!running) requestAnimationFrame(loop); }

function spark(x, y, rgb, o = {}) {
  parts.push({ x, y, vx: o.vx ?? 0, vy: o.vy ?? 0, r: o.r ?? 2.2, a: o.a ?? 0.9, rgb, t0: performance.now() + (o.delay || 0), life: o.life ?? 700, drag: o.drag ?? 0.94, grav: o.grav ?? 0, fade: o.fade ?? true, shrink: o.shrink ?? true });
}
function ring(x, y, rgb, r0, r1, life, lw = 3) {
  parts.push({ ring: true, x, y, vx: 0, vy: 0, r0, r1, rgb, a: 0.8, lw, t0: performance.now(), life, drag: 1, grav: 0, fade: true });
}

export const Fx = {
  // kind: cast · clash · charge · hit · death · heal · combo
  burst(target, color, kind = 'cast') {
    if (calm() || !ensure()) return;
    const { x, y, w, h } = centerOf(target);
    const rgb = hexRgb(color).join(',');
    const rnd = (a, b) => a + Math.random() * (b - a);
    if (kind === 'cast') {
      ring(x, y, rgb, 10, Math.max(w, h) * 0.9, 650, 3);
      for (let i = 0; i < 26; i++) { const ang = rnd(0, TAU), sp = rnd(1.5, 4.5); spark(x + Math.cos(ang) * w * 0.3, y + Math.sin(ang) * h * 0.3, rgb, { vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - 1.2, life: rnd(500, 900), r: rnd(1.5, 3) }); }
      for (let i = 0; i < 10; i++) spark(rnd(x - w / 2, x + w / 2), y + h / 2, '255,240,200', { vy: rnd(-3, -1.5), life: rnd(700, 1100), r: rnd(1, 2), drag: 0.985 });
    } else if (kind === 'clash' || kind === 'charge') {
      ring(x, y, rgb, 6, 46, 450, 4);
      const n = kind === 'clash' ? 22 : 12;
      for (let i = 0; i < n; i++) { const ang = rnd(0, TAU), sp = rnd(2, 7); spark(x, y, i % 3 ? rgb : '255,230,160', { vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, life: rnd(300, 600), r: rnd(1.2, 2.6), drag: 0.9 }); }
    } else if (kind === 'hit') {
      for (let i = 0; i < 14; i++) { const ang = rnd(-Math.PI, 0), sp = rnd(2, 5.5); spark(x, y, '255,120,90', { vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, grav: 0.18, life: rnd(350, 650), r: rnd(1.2, 2.4), drag: 0.95 }); }
      ring(x, y, '255,90,80', 4, 30, 320, 3);
    } else if (kind === 'death') {
      for (let i = 0; i < 18; i++) spark(rnd(x - w / 3, x + w / 3), rnd(y - h / 3, y + h / 3), i % 2 ? '120,110,140' : '255,140,60', { vy: rnd(-2.2, -0.6), vx: rnd(-0.6, 0.6), life: rnd(700, 1300), r: rnd(2, 4.5), drag: 0.98, shrink: false });
    } else if (kind === 'heal') {
      for (let i = 0; i < 14; i++) spark(rnd(x - w / 2, x + w / 2), rnd(y, y + h / 2), '120,255,170', { vy: rnd(-2.4, -1), life: rnd(700, 1100), r: rnd(1.4, 2.6), drag: 0.99 });
    } else if (kind === 'combo') {
      for (let i = 0; i < 90; i++) { const ang = (i / 90) * TAU * 3, sp = 1.5 + (i / 90) * 6; spark(x, y, i % 4 ? rgb : '255,230,140', { vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, life: rnd(900, 1500), r: rnd(1.6, 3.4), drag: 0.965, delay: i * 6 }); }
      ring(x, y, rgb, 20, Math.min(innerWidth, innerHeight) * 0.45, 1100, 5);
      ring(x, y, '255,230,140', 10, Math.min(innerWidth, innerHeight) * 0.3, 900, 3);
    }
    start();
  },
  // Slow motes drifting over the table (the "magic in the air" layer)
  ambient(el, on = true) {
    if (!on || calm()) { ambient = null; return; }
    if (!ensure()) return;
    ambient = { el, motes: Array.from({ length: 34 }, () => ({ x: Math.random(), y: Math.random(), s: 0.3 + Math.random() * 0.9, ph: Math.random() * TAU, c: Math.random() < 0.5 ? '150,180,255' : '255,210,140' })) };
    start();
  },
};

function drawAmbient() {
  const el = ambient.el;
  if (!el?.isConnected) { ambient = null; return; }
  if (calm()) return;
  const r = el.getBoundingClientRect();
  const t = performance.now() / 1000;
  for (const m of ambient.motes) {
    const x = r.left + ((m.x + Math.sin(t * 0.05 * m.s + m.ph) * 0.03 + t * 0.004 * m.s) % 1) * r.width;
    const y = r.top + ((m.y + 1 - (t * 0.012 * m.s) % 1) % 1) * r.height;
    const a = 0.12 + 0.12 * Math.sin(t * 1.3 * m.s + m.ph);
    const rad = 1.4 + m.s * 1.6;
    const grd = ctx.createRadialGradient(x, y, 0, x, y, rad * 4);
    grd.addColorStop(0, `rgba(${m.c},${a + 0.1})`);
    grd.addColorStop(1, `rgba(${m.c},0)`);
    ctx.fillStyle = grd;
    ctx.beginPath(); ctx.arc(x, y, rad * 4, 0, TAU); ctx.fill();
  }
}
