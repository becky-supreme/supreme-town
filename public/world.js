// The layout of Supreme Town. Edit this file to redesign it.
// Tile (i, j) covers x i..i+1, y j..j+1. People stand at tile centres.
// x runs down-right on screen, y runs down-left. The back walls are x = 0 and y = 0.
import { B } from './presets.js';
import { EXTRAS } from './extras.js';

export const W = 59;
export const H = 44;
export const SPAWNS = [[2, 11], [2, 12], [3, 12], [3, 11]];
// ---- who can hear whom ----
// Out in the open (the streets, the kitchen): anyone within HEAR_RADIUS squares.
// At the desks: only someone right next to you, within DESK_RADIUS.
// In a shared space (lounge, bar, lunch area, a team social, the meeting room):
// everyone in that space hears each other at full volume, and nobody outside does.
export const HEAR_RADIUS = 4.5;
export const DESK_RADIUS = 1.8;
export const ROOM = { x0: 40, y0: 0, x1: 45, y1: 8 }; // the meeting room
export function zoneOf(x, y) {
  const i = Math.floor(x), j = Math.floor(y);
  if (inside(ROOM, i, j)) return 'room';
  if (inside(LOUNGE, i, j)) return 'lounge';
  if (inside(BAR, i, j)) return 'bar';
  if (inside(LUNCH, i, j)) return 'lunch';
  for (const t of TEAMS) {
    if (i < t.ox || i > t.ox + 11 || j < t.y0 || j > t.y1) continue;
    return inside(t.social, i, j) ? `social:${t.id}` : 'desks';
  }
  return 'floor';
}
export const isShared = (zone) => zone !== 'floor' && zone !== 'desks';
export const hearRadius = (zone) => (zone === 'desks' ? DESK_RADIUS : HEAR_RADIUS);

// Each team gets a 12-wide block: six open desks, a receptionist spot by the
// corridor and a small social corner. Top-row teams sit against the back wall.
export const TEAMS = [
  { id: 'dev', name: 'Dev & Supreme Intelligence', color: '#8b5cf6', ox: 1, top: true },
  { id: 'content', name: 'Content', color: '#ff7a59', ox: 14, top: true },
  { id: 'design', name: 'Design', color: '#ff6fb5', ox: 27, top: true },
  { id: 'growth', name: 'Paid & Organic', color: '#ffb020', ox: 47, top: true }, // paid ads, paid social and organic, together
  { id: 'am', name: 'AM & Ads', color: '#3ecf8e', ox: 1, top: false },
  { id: 'strategy', name: 'Digital Strategy', color: '#4f8cff', ox: 14, top: false },
];
for (const t of TEAMS) {
  t.y0 = t.top ? 1 : 14;
  t.y1 = t.top ? 9 : 25;
  t.deskRows = t.top ? [2, 6] : [17, 21];
  t.social = t.top ? { x0: t.ox + 9, y0: 1, x1: t.ox + 11, y1: 5 } : { x0: t.ox + 9, y0: 20, x1: t.ox + 11, y1: 24 };
  t.reception = t.top ? { x0: t.ox + 9, y0: 7, x1: t.ox + 11, y1: 9 } : { x0: t.ox + 9, y0: 14, x1: t.ox + 11, y1: 16 };
  t.botSpot = t.top ? [t.ox + 10, 8] : [t.ox + 10, 15]; // where this team's receptionist stands
}
export const KITCHEN = { x0: 27, y0: 14, x1: 34, y1: 25 };
export const LUNCH = { x0: 35, y0: 14, x1: 58, y1: 25 };
export const LOUNGE = { x0: 0, y0: 29, x1: 29, y1: 43 };
export const BAR = { x0: 30, y0: 29, x1: 58, y1: 43 };
const DANCE = { x0: 48, y0: 33, x1: 55, y1: 38 };
const inside = (r, i, j) => i >= r.x0 && i <= r.x1 && j >= r.y0 && j <= r.y1;

export const DESKS = [];
for (const t of TEAMS) {
  let n = 1;
  for (const y of t.deskRows) {
    for (const dx of [0, 3, 6]) DESKS.push({ id: `${t.id}-${n++}`, team: t.id, x: t.ox + dx, y, w: 2, d: 1, seat: [t.ox + dx, y + 1] });
  }
}

// A plain-English name for wherever someone is standing.
export function areaAt(x, y) {
  const i = Math.floor(x), j = Math.floor(y);
  if (zoneOf(x, y) === 'room') return 'Meeting room (private)';
  if (inside(KITCHEN, i, j)) return 'Kitchen';
  if (inside(LUNCH, i, j)) return 'Non-working social lunch';
  if (inside(LOUNGE, i, j)) return 'Co-working lounge';
  if (inside(BAR, i, j)) return 'The Afterworks bar';
  for (const t of TEAMS) {
    if (i < t.ox || i > t.ox + 11 || j < t.y0 || j > t.y1) continue;
    if (inside(t.social, i, j)) return `${t.name}: team social`;
    if (inside(t.reception, i, j)) return `${t.name}: reception`;
    return t.name;
  }
  return 'Main street';
}

export function mix(a, b, t) {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const ch = (s) => Math.round(((pa >> s) & 255) * (1 - t) + ((pb >> s) & 255) * t).toString(16).padStart(2, '0');
  return `#${ch(16)}${ch(8)}${ch(0)}`;
}

// Rugs in the lounge and bar: soft colour under each seating group.
const RUGS = [
  { x0: 2, y0: 31, x1: 7, y1: 35, color: '#6d5bd0' },
  { x0: 11, y0: 31, x1: 16, y1: 35, color: '#e07a5f' },
  { x0: 20, y0: 31, x1: 25, y1: 35, color: '#2fa67a' },
  { x0: 26, y0: 32, x1: 28, y1: 38, color: '#d9a441' },
  { x0: 32, y0: 34, x1: 42, y1: 37, color: '#3a2c5e' },
];
const colorCache = new Map();
export function floorColor(i, j) {
  const key = i * 100 + j;
  let c = colorCache.get(key);
  if (c) return c;
  const alt = (i + j) % 2 === 0;
  const pick = (a, b) => (alt ? a : b);
  const oak = pick('#e7d6b6', '#e2d0ae');
  c = pick('#cfd2da', '#c9ccd5'); // polished concrete streets
  if (zoneOf(i, j) === 'room') c = pick('#3d4a70', '#39456a');
  else if (inside(KITCHEN, i, j)) c = pick('#f4f5f7', '#e3e7ed');
  else if (inside(LUNCH, i, j)) c = pick('#ecd2b3', '#e7cbab');
  else if (inside(LOUNGE, i, j)) c = pick('#9a7556', '#947052'); // walnut
  else if (inside(BAR, i, j)) c = pick('#2b2d3d', '#262838'); // dark slate
  else if (i <= 4 && j >= 10 && j <= 13) c = pick('#b9a6f5', '#b19ef0'); // welcome mat
  else {
    for (const t of TEAMS) {
      if (i < t.ox || i > t.ox + 11 || j < t.y0 || j > t.y1) continue;
      if (inside(t.social, i, j)) c = mix(oak, t.color, 0.6);
      else if (inside(t.reception, i, j)) c = mix(oak, t.color, 0.32);
      else c = mix(oak, t.color, 0.06);
    }
  }
  for (const r of RUGS) if (inside(r, i, j)) c = mix(r.color, alt ? '#ffffff' : '#000000', 0.04);
  if (inside(DANCE, i, j)) c = mix(['#ff3df2', '#27e0ff', '#ffd24a', '#39ff9c'][(i + j * 3) % 4], '#1b1830', 0.45); // light-up dance floor
  colorCache.set(key, c);
  return c;
}

// Words painted on the floor. They read along the x direction. glow: true makes them neon.
export const FLOOR_LABELS = [
  ...TEAMS.map((t) => ({ text: t.name.toUpperCase(), x: t.ox + 0.3, y: t.top ? 4.2 : 19.2, size: 19, color: mix(t.color, '#000000', 0.25) })),
  ...TEAMS.map((t) => ({ text: 'TEAM SOCIAL', x: t.social.x0 + 0.1, y: t.social.y1 + 0.15, size: 10, color: '#ffffff' })),
  ...TEAMS.map((t) => ({ text: 'RECEPTION', x: t.reception.x0 + 0.5, y: t.top ? t.reception.y1 + 0.2 : t.reception.y0 + 0.1, size: 10, color: mix(t.color, '#000000', 0.3) })),
  { text: 'NON-WORKING SOCIAL LUNCH', x: 35.6, y: 21.6, size: 19, color: '#9a5a2e' },
  { text: 'KITCHEN', x: 28.5, y: 20.3, size: 19, color: '#6f8196' },
  { text: 'WELCOME TO SUPREME TOWN', x: 0.5, y: 12.9, size: 12, color: '#4b34a8' },
  { text: 'CO-WORKING LOUNGE', x: 1.6, y: 36.4, size: 26, color: '#f3e3cf' },
  { text: 'THE AFTERWORKS', x: 32.4, y: 32.3, size: 26, color: '#ff3df2', glow: true },
  { text: 'DRINKS SOCIAL', x: 33.2, y: 41.9, size: 15, color: '#27e0ff', glow: true },
  { text: 'DANCE FLOOR', x: 48.4, y: 39.2, size: 15, color: '#ffd24a', glow: true },
  { text: 'ARCADE', x: 45.6, y: 31.2, size: 12, color: '#39ff9c', glow: true },
];
// Signs on the back wall (the y = 0 wall), above the top-row teams.
export const WALL_SIGNS = [
  ...TEAMS.filter((t) => t.top).map((t) => ({ text: t.name.toUpperCase(), x: t.ox + 0.4, color: t.color })),
  { text: 'MEETING ROOM', x: 40.6, color: '#8fa4e8' },
];

// ---------- things to carry and ride ----------
export const ITEMS = ['coffee', 'lunch', 'beer', 'cocktail', 'soda'];
export const RIDES = {
  bike: { speed: 9, lift: 0.22, name: 'bike' },
  kart: { speed: 12.5, lift: 0.12, name: 'go-kart' },
  scooter: { speed: 8, lift: 0.1, name: 'scooter' },
  hoverboard: { speed: 10.5, lift: 0.16, name: 'hoverboard' },
};
// Drawn around a centre point, pointing along 'x' or 'y'.
export function vehicleBoxes(type, axis) {
  let boxes;
  if (type === 'kart') {
    boxes = [
      B(-0.42, -0.3, 0, 0.2, 0.12, 0.2, '#1b1b25'), B(0.22, -0.3, 0, 0.2, 0.12, 0.2, '#1b1b25'),
      B(-0.4, -0.2, 0.06, 0.8, 0.4, 0.14, '#ef4d5a'),
      B(0.26, -0.14, 0.2, 0.14, 0.28, 0.1, '#ffb020'),
      B(-0.42, 0.18, 0, 0.2, 0.12, 0.2, '#1b1b25'), B(0.22, 0.18, 0, 0.2, 0.12, 0.2, '#1b1b25'),
    ];
  } else if (type === 'scooter') {
    boxes = [
      B(-0.4, -0.04, 0, 0.14, 0.08, 0.12, '#1b1b25'), B(0.26, -0.04, 0, 0.14, 0.08, 0.12, '#1b1b25'),
      B(-0.34, -0.07, 0.04, 0.62, 0.14, 0.05, '#3ecf8e'),
      B(0.32, -0.02, 0.12, 0.04, 0.04, 0.3, '#8b93a3'),
    ];
  } else if (type === 'hoverboard') {
    boxes = [
      B(-0.36, -0.14, 0.06, 0.72, 0.28, 0.02, '#27e0ff', true),
      B(-0.34, -0.12, 0.08, 0.68, 0.24, 0.06, '#22252f'),
    ];
  } else {
    boxes = [
      B(-0.44, -0.04, 0, 0.24, 0.08, 0.24, '#1b1b25'),
      B(-0.3, -0.03, 0.2, 0.6, 0.06, 0.06, '#27b0e0'),
      B(0.2, -0.04, 0, 0.24, 0.08, 0.24, '#1b1b25'),
      B(0.26, -0.14, 0.26, 0.05, 0.28, 0.05, '#8b93a3'),
    ];
  }
  return axis === 'x' ? boxes : boxes.map((b) => ({ ...b, x: b.y, y: b.x, w: b.d, d: b.w }));
}

// ---------- chairs ----------
// Chairs don't block walking. Stand on one and you sit in it, facing `face`.
// SIT is the height of each seat.
export const SIT = { office: 0.4, dining: 0.4, stool: 0.6, armchair: 0.36, bean: 0.26 };
const CHAIR_HALF = { office: 0.28, dining: 0.28, stool: 0.2, armchair: 0.34, bean: 0.32 };
function backBox(face, half, thick, z, h, w, color) {
  if (face === 'y-') return B(-w / 2, half - thick, z, w, thick, h, color);
  if (face === 'y+') return B(-w / 2, -half, z, w, thick, h, color);
  if (face === 'x-') return B(half - thick, -w / 2, z, thick, w, h, color);
  return B(-half, -w / 2, z, thick, w, h, color);
}
export function chairBoxes(type, face, color = '#3a3f55') {
  const half = CHAIR_HALF[type], seat = SIT[type];
  if (type === 'stool') return [B(-0.14, -0.14, 0, 0.28, 0.28, 0.03, '#8b93a3'), B(-0.03, -0.03, 0.03, 0.06, 0.06, 0.49, '#8b93a3'), B(-half, -half, 0.52, half * 2, half * 2, 0.08, color)];
  if (type === 'bean') return [B(-half, -half, 0, half * 2, half * 2, seat, color), backBox(face, half, 0.16, seat, 0.22, half * 2, color)];
  if (type === 'armchair') {
    const arms = face[0] === 'y'
      ? [B(-half, -half, seat, 0.1, half * 2, 0.2, color), B(half - 0.1, -half, seat, 0.1, half * 2, 0.2, color)]
      : [B(-half, -half, seat, half * 2, 0.1, 0.2, color), B(-half, half - 0.1, seat, half * 2, 0.1, 0.2, color)];
    const back = backBox(face, half, 0.1, seat, 0.5, half * 2 - 0.2, color);
    return [B(-half, -half, 0.06, half * 2, half * 2, seat - 0.06, color), B(-half + 0.04, -half + 0.04, 0, half * 2 - 0.08, half * 2 - 0.08, 0.06, '#22252f'), ...arms, back];
  }
  const base = type === 'office'
    ? [B(-0.18, -0.18, 0, 0.36, 0.36, 0.04, '#22252f'), B(-0.04, -0.04, 0.04, 0.08, 0.08, 0.26, '#8b93a3')]
    : [B(-0.2, -0.2, 0, 0.4, 0.4, 0.3, mix(color, '#000000', 0.35))];
  return [...base, B(-half, -half, 0.3, half * 2, half * 2, 0.1, color), backBox(face, half, 0.06, seat, 0.5, half * 2, color)];
}

// ---------- furniture ----------
const GLASS = '#a9dcff';
const FRAME = '#3f4a66';
const glassAlongY = () => [B(0.4, 0, 0, 0.2, 1, 0.08, FRAME), B(0.44, 0, 0.08, 0.12, 1, 1.25, GLASS, false, 0.38)];
const glassAlongX = () => [B(0, 0.4, 0, 1, 0.2, 0.08, FRAME), B(0, 0.44, 0.08, 1, 0.12, 1.25, GLASS, false, 0.38)];
const shelfAlongY = (c) => [B(0.3, 0, 0, 0.4, 1, 0.6, '#f1ece2'), B(0.28, 0, 0.6, 0.44, 1, 0.05, c)];

// Turn furniture drawn facing +y (in a w-by-d footprint) to face another way.
function turn(boxes, face, w, d) {
  if (face === 'y+') return boxes;
  if (face === 'y-') return boxes.map((b) => ({ ...b, y: d - b.y - b.d }));
  const swapped = boxes.map((b) => ({ ...b, x: b.y, y: b.x, w: b.d, d: b.w }));
  return face === 'x+' ? swapped : swapped.map((b) => ({ ...b, x: d - b.x - b.w }));
}

function bigPlant(pot = '#f1ece2') {
  return [
    B(0.3, 0.3, 0, 0.4, 0.4, 0.4, pot),
    B(0.2, 0.2, 0.4, 0.6, 0.6, 0.35, '#2f9e58'),
    B(0.28, 0.28, 0.75, 0.44, 0.44, 0.35, '#3fae66'),
    B(0.38, 0.38, 1.1, 0.24, 0.24, 0.3, '#57c27a'),
  ];
}
function sofa(color) {
  const dark = mix(color, '#000000', 0.35);
  return [
    B(0.05, 0.1, 0, 1.9, 0.8, 0.1, '#22252f'),
    B(0.05, 0.1, 0.1, 1.9, 0.8, 0.24, dark),
    B(0.05, 0.1, 0.34, 1.9, 0.25, 0.45, color),
    B(0.05, 0.35, 0.34, 0.2, 0.55, 0.22, color),
    B(1.75, 0.35, 0.34, 0.2, 0.55, 0.22, color),
    B(0.25, 0.35, 0.34, 1.5, 0.55, 0.08, mix(color, '#ffffff', 0.12)),
    B(0.35, 0.38, 0.42, 0.3, 0.12, 0.26, mix(color, '#ffffff', 0.4)),
    B(1.35, 0.38, 0.42, 0.3, 0.12, 0.26, '#ffd24a'),
  ];
}
function meetingTable() {
  return [
    B(1.2, 1.2, 0, 0.6, 0.6, 0.62, '#22252f'),
    B(0.1, 0.15, 0.62, 2.8, 2.7, 0.08, '#f1ece2'),
    B(1.3, 1.35, 0.7, 0.4, 0.3, 0.06, '#22252f'),
    B(0.5, 0.6, 0.7, 0.3, 0.22, 0.02, '#c9ccd3'), B(2.1, 1.9, 0.7, 0.3, 0.22, 0.02, '#c9ccd3'),
  ];
}
function coffeeTable() {
  return [B(0.25, 0.25, 0, 0.5, 0.5, 0.26, '#22252f'), B(0.1, 0.1, 0.26, 0.8, 0.8, 0.05, '#f1ece2'), B(0.4, 0.4, 0.31, 0.1, 0.1, 0.1, '#ffffff'), B(0.6, 0.25, 0.31, 0.16, 0.2, 0.03, '#ef4d5a')];
}
function lunchTable() {
  return [
    B(0.85, 0.85, 0, 0.3, 0.3, 0.6, '#8f8f95'),
    B(0.15, 0.15, 0.6, 1.7, 1.7, 0.08, '#fffaf0'),
    B(0.45, 0.5, 0.68, 0.3, 0.3, 0.02, '#ffffff'), B(0.52, 0.57, 0.7, 0.16, 0.16, 0.05, '#e0a458'),
    B(1.2, 1.15, 0.68, 0.3, 0.3, 0.02, '#ffffff'), B(1.27, 1.22, 0.7, 0.16, 0.16, 0.05, '#6fbf73'),
    B(1.3, 0.4, 0.68, 0.09, 0.09, 0.12, '#ef4d5a'),
  ];
}
function sharedTable() {
  return [
    B(0.2, 0.2, 0, 0.12, 0.6, 0.7, '#22252f'), B(3.68, 0.2, 0, 0.12, 0.6, 0.7, '#22252f'),
    B(0.05, 0.1, 0.7, 3.9, 0.8, 0.08, '#efe2cd'),
    B(0.5, 0.55, 0.78, 0.36, 0.24, 0.02, '#c9ccd3'), B(0.5, 0.52, 0.78, 0.36, 0.03, 0.22, '#c9ccd3'),
    B(2.3, 0.2, 0.78, 0.36, 0.24, 0.02, '#22252f'), B(2.3, 0.44, 0.78, 0.36, 0.03, 0.22, '#22252f'),
    B(1.5, 0.4, 0.78, 0.14, 0.14, 0.1, '#c96f4a'), B(1.48, 0.38, 0.88, 0.18, 0.18, 0.16, '#3fae66'),
    B(3.2, 0.5, 0.78, 0.09, 0.09, 0.11, '#ffffff'),
  ];
}
function floorLamp() {
  return [B(0.38, 0.38, 0, 0.24, 0.24, 0.04, '#22252f'), B(0.47, 0.47, 0.04, 0.06, 0.06, 1.3, '#8b93a3'), B(0.3, 0.3, 1.34, 0.4, 0.4, 0.3, '#ffe2a8', true)];
}
function bookshelf() {
  const books = ['#c0392b', '#3c6e71', '#e0a458', '#7a4b6a', '#4f8cff', '#3ecf8e'];
  const out = [B(0.05, 0.08, 0, 0.5, 0.84, 1.75, '#4a3526')];
  for (let row = 0; row < 3; row++) for (let n = 0; n < 5; n++) out.push(B(0.55, 0.12 + n * 0.155, 0.25 + row * 0.5, 0.012, 0.13, 0.3, books[(row * 2 + n) % 6]));
  return out;
}
const counter = (extra = [], body = '#e9edf2', top = '#2b2f3a') => [B(0.02, 0.1, 0, 0.96, 0.8, 0.8, body), B(0, 0.08, 0.8, 1, 0.86, 0.06, top), ...extra];
function coffeeMachine() {
  return counter([
    B(0.25, 0.2, 0.86, 0.5, 0.4, 0.5, '#2b2f3a'),
    B(0.3, 0.6, 1.12, 0.4, 0.012, 0.14, '#ffb020', true),
    B(0.42, 0.6, 0.86, 0.16, 0.16, 0.03, '#8b93a3'),
    B(0.45, 0.63, 0.89, 0.1, 0.1, 0.11, '#ffffff'),
  ]);
}
function fridge() {
  return [B(0.1, 0.1, 0, 0.8, 0.8, 1.9, '#f4f6f9'), B(0.12, 0.9, 1.15, 0.76, 0.012, 0.02, '#aab3c0'), B(0.75, 0.9, 0.5, 0.05, 0.03, 0.5, '#aab3c0'), B(0.75, 0.9, 1.3, 0.05, 0.03, 0.4, '#aab3c0')];
}
function lunchCounter() {
  return counter([
    B(0.1, 0.25, 0.86, 0.34, 0.34, 0.03, '#ffffff'), B(0.16, 0.31, 0.89, 0.22, 0.22, 0.09, '#e0a458'),
    B(0.55, 0.25, 0.86, 0.34, 0.34, 0.03, '#ffffff'), B(0.61, 0.31, 0.89, 0.22, 0.22, 0.07, '#6fbf73'),
    B(0.35, 0.65, 0.86, 0.3, 0.2, 0.12, '#ef4d5a'),
  ]);
}
// The bar: a dark counter with a neon strip, and a lit shelf of bottles behind it.
const barCounter = (extra = []) => [B(0, 0.1, 0, 1, 0.78, 0.95, '#2a2140'), B(0, 0.05, 0.95, 1, 0.9, 0.06, '#0f1018'), B(0, 0.88, 0.1, 1, 0.012, 0.06, '#ff3df2', true), ...extra];
function bottleShelf(n) {
  const glow = ['#ff3df2', '#27e0ff', '#ffd24a', '#39ff9c', '#ff7a59'];
  const out = [B(0.02, 0.05, 0, 0.96, 0.4, 1.75, '#14151f')];
  for (let row = 0; row < 3; row++) {
    out.push(B(0.02, 0.45, 0.45 + row * 0.45, 0.96, 0.2, 0.04, '#2a2140'));
    for (let k = 0; k < 4; k++) out.push(B(0.1 + k * 0.22, 0.5, 0.49 + row * 0.45, 0.1, 0.1, 0.24, glow[(n + row + k) % 5], true));
  }
  return out;
}
function poolTable() {
  const balls = [['#ffd24a', 0.9, 0.7], ['#ef4d5a', 1.5, 1.1], ['#4f8cff', 2.0, 0.6], ['#ffffff', 0.6, 1.3], ['#1b1b25', 1.8, 1.4], ['#ff7a59', 2.3, 1.0]];
  return [
    B(0.25, 0.25, 0, 0.2, 0.2, 0.3, '#2a1a10'), B(2.55, 0.25, 0, 0.2, 0.2, 0.3, '#2a1a10'),
    B(0.25, 1.55, 0, 0.2, 0.2, 0.3, '#2a1a10'), B(2.55, 1.55, 0, 0.2, 0.2, 0.3, '#2a1a10'),
    B(0.1, 0.1, 0.3, 2.8, 1.8, 0.36, '#4a2f1c'),
    B(0.22, 0.22, 0.66, 2.56, 1.56, 0.02, '#17895a'),
    ...balls.map(([c, x, y]) => B(x, y, 0.68, 0.08, 0.08, 0.07, c)),
  ];
}
const highTable = () => [B(0.3, 0.3, 0, 0.4, 0.4, 0.04, '#0f1018'), B(0.44, 0.44, 0.04, 0.12, 0.12, 0.96, '#8b93a3'), B(0.15, 0.15, 1.0, 0.7, 0.7, 0.06, '#0f1018'), B(0.4, 0.4, 1.06, 0.1, 0.1, 0.14, '#ffb020', true)];
const jukebox = () => [B(0.15, 0.2, 0, 0.7, 0.5, 1.35, '#7b1fa2'), B(0.22, 0.7, 0.55, 0.56, 0.012, 0.6, '#ffd24a', true), B(0.2, 0.2, 1.35, 0.6, 0.5, 0.08, '#ff3df2', true)];

// A little robot on a plinth. Every bot in config/bots.json gets one.
export function robot(color) {
  return [
    B(0.15, 0.15, 0, 0.7, 0.7, 0.07, '#2b2f3a'),
    B(0.18, 0.18, 0.07, 0.64, 0.64, 0.02, color, true),
    B(0.3, 0.33, 0.09, 0.4, 0.34, 0.58, color),
    B(0.36, 0.67, 0.36, 0.28, 0.01, 0.2, '#ffffff'),
    B(0.26, 0.29, 0.72, 0.48, 0.42, 0.38, '#edf1f7'),
    B(0.3, 0.71, 0.82, 0.4, 0.012, 0.16, '#1b2233'),
    B(0.36, 0.722, 0.87, 0.08, 0.01, 0.07, color, true),
    B(0.56, 0.722, 0.87, 0.08, 0.01, 0.07, color, true),
    B(0.48, 0.48, 1.1, 0.04, 0.04, 0.2, '#8b93a3'),
    B(0.45, 0.45, 1.3, 0.1, 0.1, 0.1, color, true),
  ];
}

// Chairs: { x, y, face, type, color }. Built alongside the furniture below.
export const CHAIRS = [];
const chair = (x, y, face, type, color) => CHAIRS.push({ x, y, face, type, color });

// Fixed furniture. Each object blocks the tiles it stands on.
// Objects with kind 'pickup' or 'vehicle' can be walked up to and used.
function buildObjects() {
  const out = [];
  const add = (id, x, y, w, d, boxes, extra = {}) => out.push({ id, x, y, w, d, boxes, ...extra });
  const parked = (id, x, y, ride, label) => add(id, x, y, 1, 1, vehicleBoxes(ride, 'x').map((b) => ({ ...b, x: b.x + 0.5, y: b.y + 0.5 })), { kind: 'vehicle', ride, label });

  for (const d of DESKS) chair(d.seat[0], d.seat[1], 'y-', 'office', TEAMS.find((t) => t.id === d.team).color);

  // meeting room: glass down x = 39 with a doorway, and along y = 9
  for (let j = 0; j <= 8; j++) if (j !== 5) add(`mg${j}`, 39, j, 1, 1, glassAlongY());
  add('mgc', 39, 9, 1, 1, [...glassAlongY().map((b) => ({ ...b, d: 0.56 })), ...glassAlongX()]);
  for (let i = 40; i <= 45; i++) add(`mgx${i}`, i, 9, 1, 1, glassAlongX());
  for (let j = 0; j <= 8; j++) add(`mg2-${j}`, 46, j, 1, 1, glassAlongY()); // the wall between the meeting room and Paid & Organic
  add('mgc2', 46, 9, 1, 1, [...glassAlongY().map((b) => ({ ...b, d: 0.56 })), ...glassAlongX().map((b) => ({ ...b, w: 0.56 }))]);
  add('mtable', 41, 3, 3, 3, meetingTable());
  for (let k = 0; k < 3; k++) {
    chair(40, 3 + k, 'x+', 'office', '#8fa4e8'); chair(44, 3 + k, 'x-', 'office', '#8fa4e8');
    chair(41 + k, 2, 'y+', 'office', '#8fa4e8'); chair(41 + k, 6, 'y-', 'office', '#8fa4e8');
  }

  // low shelves between neighbouring teams, with a gap to walk through
  for (const [x, c] of [[13, '#8b5cf6'], [26, '#ff7a59']]) {
    for (let j = 1; j <= 8; j++) if (j !== 4 && j !== 5) add(`s${x}-${j}`, x, j, 1, 1, shelfAlongY(c));
    for (let j = 15; j <= 25; j++) if (j !== 19 && j !== 20) add(`s${x}-${j}`, x, j, 1, 1, shelfAlongY(x === 13 ? '#3ecf8e' : '#4f8cff'));
  }
  for (const t of TEAMS) {
    const s = t.social;
    add(`${t.id}-sofa`, s.x0, s.y0, 2, 1, sofa(t.color));
    add(`${t.id}-plant`, s.x1, s.y0, 1, 1, bigPlant());
    add(`${t.id}-ctable`, s.x0 + 1, s.y0 + 2, 1, 1, coffeeTable());
    chair(s.x0, s.y0 + 2, 'x+', 'armchair', mix(t.color, '#000000', 0.2));
    chair(s.x0 + 1, s.y0 + 3, 'y-', 'bean', mix(t.color, '#ffffff', 0.25));
  }

  // kitchen
  add('fridge', 28, 14, 1, 1, fridge());
  add('k-counter1', 29, 14, 1, 1, counter());
  add('coffee', 30, 14, 1, 1, coffeeMachine(), { kind: 'pickup', item: 'coffee', label: 'Grab a coffee' });
  add('k-counter2', 31, 14, 1, 1, counter());
  add('lunch', 32, 14, 1, 1, lunchCounter(), { kind: 'pickup', item: 'lunch', label: 'Grab some lunch' });
  add('island1', 29, 17, 1, 1, counter());
  add('island2', 30, 17, 1, 1, counter([B(0.3, 0.3, 0.86, 0.4, 0.4, 0.12, '#c96f4a'), B(0.34, 0.34, 0.98, 0.32, 0.32, 0.2, '#3fae66')]));
  add('island3', 31, 17, 1, 1, counter());
  for (let i = 29; i <= 31; i++) chair(i, 18, 'y-', 'stool', '#ff7a59');

  // lunch area: six tables, four chairs each
  let n = 0;
  for (const y of [15, 19, 23]) {
    for (const x of [36, 41, 46, 51, 56]) {
      add(`lt${n++}`, x, y, 2, 2, lunchTable());
      for (const dy of [0, 1]) { chair(x - 1, y + dy, 'x+', 'dining', '#e07a5f'); chair(x + 2, y + dy, 'x-', 'dining', '#3c6e71'); }
    }
  }
  add('lplant1', 45, 14, 1, 1, bigPlant());
  add('lplant2', 45, 25, 1, 1, bigPlant());

  // ---- the co-working lounge ----
  const groups = [[2, '#6d5bd0'], [11, '#e07a5f'], [20, '#2fa67a']];
  groups.forEach(([cx, color], g) => {
    const cy = 31;
    add(`lg${g}-sofa1`, cx + 1, cy, 2, 1, sofa(color));
    add(`lg${g}-sofa2`, cx, cy + 2, 1, 2, turn(sofa(mix(color, '#ffffff', 0.18)), 'x+', 2, 1));
    add(`lg${g}-table`, cx + 2, cy + 2, 1, 1, coffeeTable());
    add(`lg${g}-lamp`, cx, cy, 1, 1, floorLamp());
    add(`lg${g}-plant`, cx + 4, cy, 1, 1, bigPlant('#22252f'));
    chair(cx + 4, cy + 2, 'x-', 'armchair', mix(color, '#000000', 0.25));
    chair(cx + 4, cy + 3, 'x-', 'armchair', mix(color, '#000000', 0.25));
    chair(cx + 2, cy + 4, 'y-', 'armchair', '#f1ece2');
    chair(cx + 3, cy + 4, 'y-', 'bean', '#ffd24a');
  });
  // long shared tables with chairs down both sides
  [2, 8, 14, 20].forEach((x, k) => {
    add(`share${k}`, x, 39, 4, 1, sharedTable());
    for (let i = 0; i < 4; i++) { chair(x + i, 38, 'y+', 'office', '#f1ece2'); chair(x + i, 40, 'y-', 'office', '#22252f'); }
  });
  for (const y of [30, 31, 33, 34, 40, 41]) add(`books${y}`, 0, y, 1, 1, bookshelf());
  add('lo-plant1', 0, 29, 1, 1, bigPlant('#22252f'));
  add('lo-plant2', 0, 37, 1, 1, bigPlant('#22252f'));
  add('lo-plant3', 0, 43, 1, 1, bigPlant('#22252f'));
  add('lo-lamp', 28, 31, 1, 1, floorLamp());
  for (const [x, y, c] of [[26, 33, '#ff6fb5'], [27, 35, '#27b0e0'], [26, 37, '#ffd24a'], [28, 37, '#8b5cf6']]) chair(x, y, 'x-', 'bean', c);
  add('lo-ctable', 27, 33, 1, 1, coffeeTable());

  // ---- The Afterworks bar ----
  for (let i = 34; i <= 40; i++) add(`shelf${i}`, i, 29, 1, 1, bottleShelf(i));
  const glass = (c) => [B(0.4, 0.4, 1.01, 0.12, 0.12, 0.16, c, true), B(0.6, 0.3, 1.01, 0.12, 0.12, 0.16, c, true)];
  for (let i = 34; i <= 40; i++) {
    if (i === 35) add('beer', i, 30, 1, 1, barCounter(glass('#ffb020')), { kind: 'pickup', item: 'beer', label: 'Grab a beer' });
    else if (i === 37) add('cocktail', i, 30, 1, 1, barCounter(glass('#ff3df2')), { kind: 'pickup', item: 'cocktail', label: 'Grab a cocktail' });
    else if (i === 39) add('soda', i, 30, 1, 1, barCounter(glass('#27e0ff')), { kind: 'pickup', item: 'soda', label: 'Grab a soft drink' });
    else add(`bar${i}`, i, 30, 1, 1, barCounter());
    chair(i, 31, 'y-', 'stool', '#ff3df2');
  }
  add('pool1', 33, 35, 3, 2, poolTable());
  add('pool2', 39, 35, 3, 2, poolTable());
  [33, 37, 41].forEach((x, k) => {
    add(`high${k}`, x, 40, 1, 1, highTable());
    chair(x - 1, 40, 'x+', 'stool', '#27e0ff'); chair(x + 1, 40, 'x-', 'stool', '#27e0ff');
  });
  add('jukebox', 44, 29, 1, 1, jukebox());
  add('bar-sofa', 44, 33, 1, 2, turn(sofa('#7b1fa2'), 'x-', 2, 1));
  add('bar-sofa2', 44, 37, 1, 2, turn(sofa('#27839a'), 'x-', 2, 1));
  for (const y of [30, 36, 42]) add(`div${y}`, 30, y, 1, 1, bigPlant('#22252f'));
  add('bar-plant', 45, 43, 1, 1, bigPlant('#22252f'));
  // arcade cabinets: walk up and press E to play
  const cabinet = (color) => [B(0.15, 0.15, 0, 0.7, 0.6, 1.0, '#2a2140'), B(0.15, 0.15, 1.0, 0.7, 0.35, 0.75, '#2a2140'), B(0.2, 0.5, 1.05, 0.6, 0.012, 0.5, color, true), B(0.15, 0.5, 1.6, 0.7, 0.25, 0.15, '#ffd24a', true), B(0.25, 0.75, 0.9, 0.5, 0.02, 0.08, '#ff3df2', true)];
  add('arcade1', 46, 30, 1, 1, cabinet('#27e0ff'), { kind: 'arcade', label: 'Play Lead Volley (1v1)' });
  add('arcade2', 47, 30, 1, 1, cabinet('#39ff9c'), { kind: 'arcade', label: 'Play Lead Volley (1v1)' });
  // the dance floor end of the bar
  add('dj', 51, 30, 2, 1, [B(0.05, 0.15, 0, 1.9, 0.7, 0.9, '#14151f'), B(0, 0.1, 0.9, 2, 0.8, 0.06, '#2a2140'), B(0.25, 0.3, 0.96, 0.5, 0.4, 0.05, '#0f1018'), B(1.25, 0.3, 0.96, 0.5, 0.4, 0.05, '#0f1018'), B(0.05, 0.86, 0.2, 1.9, 0.012, 0.5, '#27e0ff', true)]);
  for (const x of [49, 54]) add(`speaker${x}`, x, 30, 1, 1, [B(0.2, 0.2, 0, 0.6, 0.5, 1.5, '#14151f'), B(0.3, 0.7, 0.9, 0.4, 0.012, 0.4, '#ff3df2', true), B(0.35, 0.7, 0.3, 0.3, 0.012, 0.3, '#27e0ff', true)]);
  add('dance-sofa1', 57, 33, 1, 2, turn(sofa('#ff3df2'), 'x-', 2, 1));
  add('dance-sofa2', 57, 37, 1, 2, turn(sofa('#ffb020'), 'x-', 2, 1));
  [48, 55].forEach((x, k) => { add(`high-d${k}`, x, 41, 1, 1, highTable()); chair(x - 1, 41, 'x+', 'stool', '#ffd24a'); chair(x + 1, 41, 'x-', 'stool', '#ffd24a'); });
  add('dance-plant', 58, 43, 1, 1, bigPlant('#22252f'));
  parked('karts5', 50, 26, 'kart', 'Hop in a go-kart');

  // ---- things to ride ----
  parked('bikes', 6, 13, 'bike', 'Hop on a bike');
  parked('karts', 8, 13, 'kart', 'Hop in a go-kart');
  parked('karts2', 4, 26, 'kart', 'Hop in a go-kart');
  parked('karts3', 6, 26, 'kart', 'Hop in a go-kart');
  parked('hover1', 8, 26, 'hoverboard', 'Hop on a hoverboard');
  parked('scoot1', 10, 26, 'scooter', 'Hop on a scooter');
  parked('bikes2', 12, 26, 'bike', 'Hop on a bike');
  parked('karts4', 32, 26, 'kart', 'Hop in a go-kart');
  parked('hover2', 34, 26, 'hoverboard', 'Hop on a hoverboard');
  parked('scoot2', 36, 13, 'scooter', 'Hop on a scooter');

  // ---- centrepieces (drawn in 3D by scene3d.js; they just block their tiles here) ----
  add('globe', 21, 11, 2, 2, [], { decor: 'globe' });
  add('dna1', 17, 27, 1, 1, [], { decor: 'dna', label: 'LIFE SCIENCES' });
  add('dna2', 33, 11, 1, 1, [], { decor: 'dna', label: 'BIOTECH' });
  add('rocket', 24, 27, 1, 1, [], { decor: 'rocket' });

  // ---- your own additions, from extras.js ----
  const CATALOGUE = {
    'plant': (e) => add(e.id, e.x, e.y, 1, 1, bigPlant()),
    'lamp': (e) => add(e.id, e.x, e.y, 1, 1, floorLamp()),
    'coffee table': (e) => add(e.id, e.x, e.y, 1, 1, coffeeTable()),
    'bookshelf': (e) => add(e.id, e.x, e.y, 1, 1, bookshelf()),
    'high table': (e) => add(e.id, e.x, e.y, 1, 1, highTable()),
    'pool table': (e) => add(e.id, e.x, e.y, 3, 2, poolTable()),
    'lunch table': (e) => add(e.id, e.x, e.y, 2, 2, lunchTable()),
    'shared table': (e) => add(e.id, e.x, e.y, 4, 1, sharedTable()),
    'sofa': (e) => { const f = e.face || 'y+'; const up = f[0] === 'y'; add(e.id, e.x, e.y, up ? 2 : 1, up ? 1 : 2, turn(sofa(e.color || '#6d5bd0'), f, 2, 1)); },
    'desk chair': (e) => chair(e.x, e.y, e.face || 'y+', 'office', e.color || '#3a3f55'),
    'armchair': (e) => chair(e.x, e.y, e.face || 'y+', 'armchair', e.color || '#6d5bd0'),
    'bean bag': (e) => chair(e.x, e.y, e.face || 'y+', 'bean', e.color || '#ffd24a'),
    'stool': (e) => chair(e.x, e.y, e.face || 'y+', 'stool', e.color || '#ff3df2'),
    'go-kart': (e) => parked(e.id, e.x, e.y, 'kart', 'Hop in a go-kart'),
    'bike': (e) => parked(e.id, e.x, e.y, 'bike', 'Hop on a bike'),
    'scooter': (e) => parked(e.id, e.x, e.y, 'scooter', 'Hop on a scooter'),
    'hoverboard': (e) => parked(e.id, e.x, e.y, 'hoverboard', 'Hop on a hoverboard'),
    'globe': (e) => add(e.id, e.x, e.y, 2, 2, [], { decor: 'globe' }),
    'dna': (e) => add(e.id, e.x, e.y, 1, 1, [], { decor: 'dna', label: e.label || 'LIFE SCIENCES' }),
    'rocket': (e) => add(e.id, e.x, e.y, 1, 1, [], { decor: 'rocket' }),
  };
  EXTRAS.forEach((e, n) => {
    const make = CATALOGUE[String(e.item).toLowerCase()];
    if (make) make({ ...e, id: `extra${n}` }); else console.warn(`extras.js: "${e.item}" isn't something I know how to add.`);
  });

  add('eplant1', 0, 9, 1, 1, bigPlant());
  add('eplant2', 0, 14, 1, 1, bigPlant());
  return out;
}
const OBJECTS = buildObjects();
export const staticObjects = () => OBJECTS;
