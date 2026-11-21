// Deck charts: the mana curve, color pips, card types and stat tiles drawn the same way in the deck builder
// and the deck viewer. Each function takes numbers the caller counted from real cards and returns HTML;
// nothing here estimates or rounds beyond what is printed, and every value is also written as text
// (a label, a tooltip and an aria-label), so a chart never depends on color alone.
import { esc, symbolize } from './util.js';

export const TYPE_ORDER = ['creature', 'instant', 'sorcery', 'artifact', 'enchantment', 'planeswalker', 'land', 'battle', 'other'];
export const TYPE_NAMES = { creature: 'Creatures', instant: 'Instants', sorcery: 'Sorceries', artifact: 'Artifacts', enchantment: 'Enchantments', planeswalker: 'Planeswalkers', land: 'Lands', battle: 'Battles', other: 'Other' };
// (a battle shares the "other" swatch: there are too few of them to need a color of their own)
export const typeColor = t => `var(--type-${t === 'battle' ? 'other' : t})`;
export const MANA_NAMES = { W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green', C: 'Colorless' };

const pct = (n, of) => (of ? Math.round((n / of) * 100) : 0);

/** Stat tiles. @param {{ label: string, value: string | number, tone?: string, title?: string }[]} tiles */
export function statTiles(tiles) {
  return `<div class="stat-row">${tiles.map(t => `<div class="stat ${t.tone || ''}"${t.title ? ` title="${esc(t.title)}"` : ''}><b class="stat-v">${esc(t.value)}</b><span class="stat-l">${esc(t.label)}</span></div>`).join('')}</div>`;
}

/**
 * The mana curve: one bar per mana value, the last one "7+". With opts.avg a marker stands at the average mana value,
 * and the line under the chart gives the average and the median.
 * @param {number[]} curve cards at each mana value
 * @param {{ avg?: number | null }} [opts]
 */
export function curveChart(curve, opts = {}) {
  const peak = Math.max(1, ...curve);
  const cards = curve.reduce((a, n) => a + n, 0);
  // (the median card's bar: the first one where the running count reaches half the cards)
  let run = 0, median = -1;
  for (let i = 0; i < curve.length && median < 0; i++) { run += curve[i]; if (cards && run >= cards / 2) median = i; }
  const avg = cards && opts.avg != null && Number.isFinite(opts.avg) ? opts.avg : null;
  // (each bar is one mana value wide and centered on it; the last bar stands for 7 and more)
  const x = avg == null ? 0 : ((Math.min(avg, curve.length - 1) + 0.5) / curve.length) * 100;
  const name = i => `${i}${i === curve.length - 1 ? '+' : ''}`;
  const said = curve.map((n, i) => `${n} at ${name(i)}`).join(', ');
  return `<div class="chart-curve" role="img" aria-label="Mana curve: ${said}${avg == null ? '' : `. Average ${avg.toFixed(2)}`}">${curve.map((n, i) =>
    `<div class="cc-col ${n ? '' : 'zero'}" title="Mana value ${name(i)}: ${n} card${n === 1 ? '' : 's'}"><span class="cc-n">${n || ''}</span><span class="cc-bar" style="--h:${Math.round((n / peak) * 100)}%;animation-delay:${i * 35}ms"></span><span class="cc-l">${name(i)}</span></div>`).join('')}${avg == null ? '' : `<span class="cc-avg" style="--x:${x.toFixed(1)}%" title="Average mana value ${avg.toFixed(2)}"></span>`}</div>${cards ? `<p class="chart-note">${avg == null ? '' : `<i class="cc-key"></i>Average ${avg.toFixed(2)} · `}Median ${name(median)}</p>` : ''}`;
}

/**
 * Colored mana symbols in the costs, one row per color that appears. With `sources` (how many cards in the deck can
 * make each color, counted from the cards' own "produces" data) each color gets a second, thinner bar for them; a
 * color the costs ask for that nothing makes is pointed out. No judgement beyond that: how many sources are enough
 * depends on the deck.
 * @param {Record<string, number>} pips
 * @param {Record<string, number> | null} [sources]
 */
export function pipChart(pips, sources = null) {
  const rows = Object.entries(pips).filter(([, n]) => n);
  const total = rows.reduce((a, [, n]) => a + n, 0);
  if (!rows.length) return '<p class="muted">No colored mana symbols.</p>';
  const peak = Math.max(...rows.map(([, n]) => n));
  const srcPeak = sources ? Math.max(1, ...rows.map(([c]) => sources[c] || 0)) : 1;
  const none = sources ? rows.filter(([c]) => !sources[c]).map(([c]) => MANA_NAMES[c]) : [];
  return `<div class="chart-pips">${rows.map(([c, n]) =>
    `<div class="cp-row" title="${MANA_NAMES[c] || c}: ${n} of ${total} colored symbols (${pct(n, total)}%)"><span>${symbolize(`{${c}}`)}</span><span class="cp-track"><span class="cp-fill" style="--w:${Math.round((n / peak) * 100)}%;--c:var(--mana-${c.toLowerCase()})"></span></span><b>${n}</b><small>${pct(n, total)}%</small></div>${sources ? `<div class="cp-row src" title="${sources[c] || 0} card${(sources[c] || 0) === 1 ? '' : 's'} in the deck can make ${(MANA_NAMES[c] || c).toLowerCase()} mana"><span></span><span class="cp-track"><span class="cp-fill" style="--w:${Math.round(((sources[c] || 0) / srcPeak) * 100)}%;--c:var(--mana-${c.toLowerCase()})"></span></span><b>${sources[c] || 0}</b><small>make it</small></div>` : ''}`).join('')}</div>${sources ? `<p class="chart-note">Thick bar: symbols in costs. Thin bar: cards that can make that color.${none.length ? ` <b class="warn">Nothing in the deck makes ${none.join(' or ').toLowerCase()} mana.</b>` : ''}</p>` : ''}`;
}

/** Card types as one segmented bar with a legend. @param {Record<string, number>} types counts keyed by TYPE_ORDER names */
export function typeChart(types) {
  const rows = TYPE_ORDER.filter(t => types[t]).map(t => /** @type {[string, number]} */ ([t, types[t]]));
  const total = rows.reduce((a, [, n]) => a + n, 0);
  if (!total) return '<p class="muted">Empty deck</p>';
  return `<div class="chart-types"><div class="ct-bar" role="img" aria-label="Card types: ${rows.map(([t, n]) => `${n} ${TYPE_NAMES[t]}`).join(', ')}">${rows.map(([t, n]) =>
    `<span style="--w:${(n / total) * 100}%;--c:${typeColor(t)}" title="${TYPE_NAMES[t]}: ${n} (${pct(n, total)}%)"></span>`).join('')}</div>
    <ul class="ct-legend">${rows.map(([t, n]) => `<li><i style="--c:${typeColor(t)}"></i><span>${TYPE_NAMES[t]}</span><b>${n}</b></li>`).join('')}</ul></div>`;
}

/**
 * The five Commander brackets as a scale, with the estimate marked and (when it is known) Commander Spellbook's.
 * @param {Record<number, { name: string }>} brackets the bracket names
 * @param {number} est the estimated bracket
 * @param {number | null} [other] Commander Spellbook's estimate
 */
export function bracketScale(brackets, est, other = null) {
  return `<div class="bracket-scale" role="img" aria-label="Bracket ${est} of 5: ${esc(brackets[est]?.name || '')}${other ? `. Commander Spellbook says about ${other}` : ''}">${[1, 2, 3, 4, 5].map(n =>
    `<span class="bs-step ${n === est ? 'on' : ''} ${n < est ? 'below' : ''}"><b>${n}</b><small>${esc(brackets[n]?.name || '')}</small>${n === other ? '<i title="Commander Spellbook\'s estimate">Spellbook</i>' : ''}</span>`).join('')}</div>`;
}

/** How many cards can make each color, from each card's "produces" data. @param {{ card: any, qty: number }[]} entries */
export function countSources(entries) {
  const src = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  for (const { card, qty } of entries) for (const c of new Set(card.produced || [])) if (c in src) src[c] += qty;
  return src;
}

/**
 * A small line chart of shares (0 to 1) by turn: draw odds, goldfish results. Every point carries its value as a
 * tooltip, the chart's label reads the numbers out, and each line has its own dash pattern as well as its color.
 * @param {{ name: string, points: number[] }[]} series one value per x
 * @param {{ xs: number[], label: string, xName?: string }} opts
 */
export function lineChart(series, opts) {
  const W = 340, H = 150, L = 34, Rm = 10, T = 8, B = 22;
  const xs = opts.xs, n = Math.max(1, xs.length - 1);
  const px = i => L + (i / n) * (W - L - Rm), py = v => T + (1 - Math.max(0, Math.min(1, v))) * (H - T - B);
  const pcs = v => `${Math.round(v * 100)}%`;
  const grid = [0, 0.25, 0.5, 0.75, 1].map(v => `<line class="lc-grid" x1="${L}" x2="${W - Rm}" y1="${py(v).toFixed(1)}" y2="${py(v).toFixed(1)}"/><text class="lc-t" x="${L - 5}" y="${(py(v) + 3).toFixed(1)}" text-anchor="end">${pcs(v)}</text>`).join('');
  const ticks = xs.map((x, i) => `<text class="lc-t" x="${px(i).toFixed(1)}" y="${H - 6}" text-anchor="middle">${x}</text>`).join('');
  const lines = series.map((s, k) => `<polyline class="lc-line lc-${k}" points="${s.points.map((v, i) => `${px(i).toFixed(1)},${py(v).toFixed(1)}`).join(' ')}"/>${s.points.map((v, i) => `<circle class="lc-dot lc-${k}" cx="${px(i).toFixed(1)}" cy="${py(v).toFixed(1)}" r="2.6"><title>${esc(s.name)}, ${esc(opts.xName || 'turn')} ${xs[i]}: ${pcs(v)}</title></circle>`).join('')}`).join('');
  const said = series.map(s => `${s.name}: ${s.points.map((v, i) => `${xs[i]} ${pcs(v)}`).join(', ')}`).join('. ');
  return `<div class="chart-line"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opts.label)}. ${esc(said)}">${grid}${ticks}${lines}</svg>
    <p class="chart-note">${series.map((s, k) => `<span class="lc-key"><svg viewBox="0 0 22 6" aria-hidden="true"><line class="lc-line lc-${k}" x1="0" x2="22" y1="3" y2="3"/></svg>${esc(s.name)}</span>`).join('')}</p></div>`;
}
