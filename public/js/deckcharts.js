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

/** The mana curve: one bar per mana value, the last one "7+". @param {number[]} curve cards at each mana value */
export function curveChart(curve) {
  const peak = Math.max(1, ...curve);
  const name = i => `${i}${i === curve.length - 1 ? '+' : ''}`;
  const said = curve.map((n, i) => `${n} at ${name(i)}`).join(', ');
  return `<div class="chart-curve" role="img" aria-label="Mana curve: ${said}">${curve.map((n, i) =>
    `<div class="cc-col ${n ? '' : 'zero'}" title="Mana value ${name(i)}: ${n} card${n === 1 ? '' : 's'}"><span class="cc-n">${n || ''}</span><span class="cc-bar" style="--h:${Math.round((n / peak) * 100)}%;animation-delay:${i * 35}ms"></span><span class="cc-l">${name(i)}</span></div>`).join('')}</div>`;
}

/** Colored mana symbols in the costs, one row per color that appears. @param {Record<string, number>} pips */
export function pipChart(pips) {
  const rows = Object.entries(pips).filter(([, n]) => n);
  const total = rows.reduce((a, [, n]) => a + n, 0);
  if (!rows.length) return '<p class="muted">No colored mana symbols.</p>';
  const peak = Math.max(...rows.map(([, n]) => n));
  return `<div class="chart-pips">${rows.map(([c, n]) =>
    `<div class="cp-row" title="${MANA_NAMES[c] || c}: ${n} of ${total} colored symbols (${pct(n, total)}%)"><span>${symbolize(`{${c}}`)}</span><span class="cp-track"><span class="cp-fill" style="--w:${Math.round((n / peak) * 100)}%;--c:var(--mana-${c.toLowerCase()})"></span></span><b>${n}</b><small>${pct(n, total)}%</small></div>`).join('')}</div>`;
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
