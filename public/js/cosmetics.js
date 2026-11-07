// Avatars and card backs: drawn here (SVG and CSS), all original, unlocked by playing. Nothing is sold;
// unlocks come from badges (progress.js), games played and deck mastery.
import { esc } from './util.js';

const svg = body => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${body}</svg>`)}`;
const grad = (id, a, b) => `<defs><radialGradient id="${id}" cx="35%" cy="30%" r="80%"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></radialGradient></defs><rect width="64" height="64" fill="url(#${id})"/>`;

// unlock: null (from the start), { badge }, { games }, { mastery }
export const AVATARS = [
  { id: 'none', name: 'Commander art', unlock: null, url: null },
  { id: 'sun', name: 'Dawn Sigil', unlock: null, url: svg(`${grad('g', '#ffe9a8', '#c98a1b')}<circle cx="32" cy="32" r="11" fill="#fff6d8"/>${Array.from({ length: 12 }, (_, i) => `<rect x="31" y="6" width="2" height="10" fill="#fff6d8" transform="rotate(${i * 30} 32 32)"/>`).join('')}`) },
  { id: 'wave', name: 'Tidecaller', unlock: null, url: svg(`${grad('g', '#9fd8ff', '#1b4f8a')}<path d="M4 38c8-8 14-8 22 0s14 8 22 0 12-6 12-6v32H4z" fill="#dff3ff" opacity=".85"/><path d="M4 48c8-6 14-6 22 0s14 6 22 0 12-4 12-4v20H4z" fill="#fff" opacity=".6"/>`) },
  { id: 'skull', name: 'Night Mask', unlock: null, url: svg(`${grad('g', '#7d6a8f', '#1a1222')}<path d="M32 12c-11 0-18 8-18 18 0 6 3 10 6 12v7h24v-7c3-2 6-6 6-12 0-10-7-18-18-18z" fill="#e8e1ee"/><circle cx="25" cy="31" r="5" fill="#1a1222"/><circle cx="39" cy="31" r="5" fill="#1a1222"/><path d="M29 41h6l-3-5z" fill="#1a1222"/>`) },
  { id: 'flame', name: 'Ember Heart', unlock: null, url: svg(`${grad('g', '#ffb08a', '#8a1b12')}<path d="M32 8c4 10 14 14 14 28a14 14 0 0 1-28 0c0-8 5-11 6-18 3 4 3 8 6 9 0-7-1-13 2-19z" fill="#ffd36b"/><path d="M32 30c2 5 7 7 7 13a7 7 0 0 1-14 0c0-5 4-7 7-13z" fill="#fff3c4"/>`) },
  { id: 'leaf', name: 'Wildgrowth', unlock: null, url: svg(`${grad('g', '#b8f0a0', '#1f5a24')}<path d="M14 50C14 24 32 12 52 12c0 22-14 38-38 38z" fill="#e4ffd6"/><path d="M14 50L44 20" stroke="#1f5a24" stroke-width="2.5"/>`) },
  { id: 'eye', name: 'Seer', unlock: { badge: 'first-challenge' }, url: svg(`${grad('g', '#c9b8ff', '#3a2470')}<path d="M6 32c8-12 18-18 26-18s18 6 26 18c-8 12-18 18-26 18S14 44 6 32z" fill="#f1ecff"/><circle cx="32" cy="32" r="9" fill="#3a2470"/><circle cx="35" cy="29" r="3" fill="#f1ecff"/>`) },
  { id: 'crown', name: 'Sovereign', unlock: { badge: 'rank-gold' }, url: svg(`${grad('g', '#fff0b3', '#9a6a10')}<path d="M12 44l-2-22 12 10 10-16 10 16 12-10-2 22z" fill="#fff8dc" stroke="#9a6a10" stroke-width="1.5"/><rect x="12" y="44" width="40" height="6" fill="#fff8dc"/>`) },
  { id: 'gem', name: 'Prism', unlock: { badge: 'rank-diamond' }, url: svg(`${grad('g', '#bdf6ff', '#1a5f7a')}<path d="M20 14h24l10 14-22 24L10 28z" fill="#e9fdff"/><path d="M10 28h44M20 14l12 38M44 14L32 52M26 14l6 14 6-14" stroke="#1a5f7a" stroke-width="1.4" fill="none"/>`) },
  { id: 'phoenix', name: 'Phoenix', unlock: { badge: 'rank-mythic' }, url: svg(`${grad('g', '#ffcf7a', '#a12b0d')}<path d="M32 54c-4-8-4-14 0-20 4 6 4 12 0 20zM32 34C22 30 12 22 8 10c10 6 18 8 24 18 6-10 14-12 24-18-4 12-14 20-24 24z" fill="#fff0c9"/>`) },
  { id: 'tower', name: 'Stronghold', unlock: { games: 25 }, url: svg(`${grad('g', '#d4d0c8', '#4a463e')}<path d="M18 54V22h6v-6h4v6h8v-6h4v6h6v32z" fill="#f4f1ea"/><rect x="29" y="40" width="6" height="14" fill="#4a463e"/>`) },
  { id: 'moon', name: 'Moonwatch', unlock: { badge: 'streak-3' }, url: svg(`${grad('g', '#9fb4ff', '#141c44')}<path d="M40 12a20 20 0 1 0 12 30A16 16 0 1 1 40 12z" fill="#eef1ff"/><circle cx="16" cy="16" r="1.5" fill="#fff"/><circle cx="50" cy="52" r="1.2" fill="#fff"/>`) },
  { id: 'dragon', name: 'Wyrm', unlock: { mastery: 10 }, url: svg(`${grad('g', '#ff9a9a', '#5a0f1e')}<path d="M10 44c10-2 14-12 22-16 6-3 12-2 16 2l6-4-2 8c2 4 0 10-6 12-6 2-10-2-16 2-6 4-12 6-20-4z" fill="#ffe3e3"/><circle cx="46" cy="34" r="1.8" fill="#5a0f1e"/>`) },
];

// Card backs: CSS backgrounds for every face-down card (hands you can't see, library piles)
export const BACKS = [
  { id: 'classic', name: 'Leather and brass', unlock: null, css: 'radial-gradient(ellipse at center, #a86a2c 0 22%, #5a3517 23% 40%, #3b2410 41%), #3b2410' },
  { id: 'arcane', name: 'Arcane weave', unlock: null, css: 'repeating-linear-gradient(45deg, #3b2a6b 0 4px, #2b1f52 4px 8px)' },
  { id: 'sea', name: 'Deep sea', unlock: null, css: 'radial-gradient(circle at 50% 120%, #57c7ff 0 20%, transparent 21%), repeating-radial-gradient(circle at 50% 120%, #0e3a5c 0 4px, #0a2a44 4px 8px)' },
  { id: 'forest', name: 'Forest floor', unlock: { badge: 'first-challenge' }, css: 'repeating-linear-gradient(90deg, #1d3d1f 0 3px, #2b5a2e 3px 6px), #1d3d1f' },
  { id: 'ember', name: 'Embers', unlock: { badge: 'streak-3' }, css: 'radial-gradient(circle at 30% 30%, #ffb347 0 12%, transparent 13%), radial-gradient(circle at 70% 70%, #ff6a3d 0 14%, transparent 15%), #3a120a' },
  { id: 'gold', name: 'Gilded', unlock: { badge: 'rank-gold' }, css: 'repeating-linear-gradient(135deg, #b8862b 0 3px, #e3c36b 3px 5px, #8a5f12 5px 8px)' },
  { id: 'starfield', name: 'Starfield', unlock: { games: 50 }, css: 'radial-gradient(circle at 20% 30%, #fff 0 1px, transparent 2px), radial-gradient(circle at 70% 60%, #fff 0 1px, transparent 2px), radial-gradient(circle at 40% 80%, #cfd8ff 0 1px, transparent 2px), linear-gradient(#0b1030, #1c2460)' },
  { id: 'prism', name: 'Prism', unlock: { badge: 'rank-diamond' }, css: 'conic-gradient(from 45deg, #7aa7ff, #b07cff, #ff7ac8, #ffd36b, #7aff9e, #7aa7ff)' },
  { id: 'mythic', name: 'Mythic flame', unlock: { badge: 'rank-mythic' }, css: 'radial-gradient(ellipse at 50% 100%, #ffd36b 0 25%, #ff7a45 26% 45%, #a12b0d 46% 70%, #2a0a05 71%)' },
];

// ctx: { badges: {id: date}, games: number of finished games you played, maxMastery: best deck level }
export function unlocked(item, ctx) {
  const u = item.unlock;
  if (!u) return true;
  if (u.badge) return !!ctx.badges[u.badge];
  if (u.games) return (ctx.games || 0) >= u.games;
  if (u.mastery) return (ctx.maxMastery || 0) >= u.mastery;
  return false;
}
export function unlockText(item, badgeList) {
  const u = item.unlock;
  if (!u) return 'Available from the start';
  if (u.badge) return `Earn the "${badgeList.find(b => b.id === u.badge)?.name || u.badge}" badge`;
  if (u.games) return `Play ${u.games} games yourself`;
  if (u.mastery) return `Get a deck to mastery level ${u.mastery}`;
  return '';
}
export const avatarById = id => AVATARS.find(a => a.id === id) || AVATARS[0];
export const backById = id => BACKS.find(b => b.id === id) || BACKS[0];

// The pickers in the Display window
export function pickerHtml(kind, current, ctx, badgeList) {
  const list = kind === 'avatar' ? AVATARS : BACKS;
  return list.map(x => {
    const ok = unlocked(x, ctx);
    const look = kind === 'avatar' ? (x.url ? `background-image:url("${x.url}")` : 'background: repeating-linear-gradient(45deg, #444 0 4px, #333 4px 8px)') : `background:${x.css}`;
    return `<button class="cosm cosm-${kind} ${x.id === current ? 'on' : ''} ${ok ? '' : 'locked'}" data-kind="${kind}" data-id="${x.id}" ${ok ? '' : 'disabled'} title="${esc(x.name)}${ok ? '' : ` · locked: ${esc(unlockText(x, badgeList))}`}">
      <span class="cosm-look" style='${look}'></span><small>${esc(x.name)}${ok ? '' : ' 🔒'}</small></button>`;
  }).join('');
}
