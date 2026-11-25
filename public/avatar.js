// Characters: a bank of outfits and hairstyles, built from boxes around the
// person's centre point. To add an outfit, add it to OUTFITS and to the switch below.
import { depthSort } from './iso.js';

export const OUTFITS = [
  { id: 'casual', name: 'Casual' },
  { id: 'smart', name: 'Smart' },
  { id: 'hoodie', name: 'Hoodie' },
  { id: 'dress', name: 'Dress' },
  { id: 'sporty', name: 'Sporty' },
  { id: 'dino', name: 'Dinosaur' },
  { id: 'astronaut', name: 'Astronaut' },
  { id: 'wizard', name: 'Wizard' },
  { id: 'pirate', name: 'Pirate' },
  { id: 'duck', name: 'Duck' },
  { id: 'scientist', name: 'Mad scientist' },
];
export const HAIRSTYLES = [
  { id: 'short', name: 'Short' },
  { id: 'long', name: 'Long' },
  { id: 'bob', name: 'Bob' },
  { id: 'bun', name: 'Bun' },
  { id: 'topknot', name: 'Top knot' },
  { id: 'ponytail', name: 'Ponytail' },
  { id: 'pigtails', name: 'Pigtails' },
  { id: 'curly', name: 'Curly' },
  { id: 'afro', name: 'Afro' },
  { id: 'quiff', name: 'Quiff' },
  { id: 'spiky', name: 'Spiky' },
  { id: 'mohawk', name: 'Mohawk' },
  { id: 'bald', name: 'Bald' },
];
const HEAD_COVERED = new Set(['dino', 'astronaut', 'duck', 'scientist']); // the costume hides the hair
const HAS_HAT = new Set(['wizard', 'pirate']);

function darker(hex, f = 0.75) {
  const n = parseInt(hex.slice(1), 16);
  const ch = (s) => Math.round(((n >> s) & 255) * f).toString(16).padStart(2, '0');
  return `#${ch(16)}${ch(8)}${ch(0)}`;
}

const HALF = { body: [0.19, 0.11], head: [0.17, 0.16] }; // half-width and half-depth of each part

// sit: the height of the seat when sitting, or null when standing.
// all: draw features on every side (for 3D, where the camera can see them all).
export function avatarBoxes(look, facing = 'y+', step = 0, item = null, sit = null, all = false) {
  if (look?.custom?.boxes?.length) return customBoxes(look.custom, item, sit);
  const { shirt = '#4f8cff', hair = '#3b2a20', skin = '#f2c9a0' } = look || {};
  const outfit = OUTFITS.some((o) => o.id === look?.outfit) ? look.outfit : 'casual';
  const style = HAIRSTYLES.some((h) => h.id === look?.hairStyle) ? look.hairStyle : 'short';
  const out = [];
  const B = (x, y, z, w, d, h, color, glow = false) => out.push({ x, y, z, w, d, h, color, glow });
  const axis = facing[0], sign = facing[1] === '+' ? 1 : -1;
  const towardsCamera = all || sign > 0;
  const standing = sit === null;

  // Put a box on the front (side = 1) or back (side = -1) of the body or head,
  // whichever way the person is facing. lat and wl run across the person.
  function place(part, side, lat, z, wl, depth, h, color, glow) {
    const [hx, hy] = HALF[part];
    const plus = side * sign > 0;
    if (axis === 'y') B(lat, plus ? hy : -hy - depth, z, wl, depth, h, color, glow);
    else { const k = hy / hx; B(plus ? hx : -hx - depth, lat * k, z, depth, wl * k, h, color, glow); }
  }
  const front = (part, ...a) => { if (towardsCamera) place(part, 1, ...a); };
  const back = (part, ...a) => place(part, -1, ...a);
  // Hair or straps down both sides of the head.
  function sides(z, h, color, thick = 0.03) {
    if (axis === 'y') { B(0.17, -0.16, z, thick, 0.32, h, color); B(-0.17 - thick, -0.16, z, thick, 0.32, h, color); }
    else { B(-0.17, 0.16, z, 0.34, thick, h, color); B(-0.17, -0.16 - thick, z, 0.34, thick, h, color); }
  }

  const swing = Math.sin(step) * 0.06;
  const legs = (color, h = 0.45) => {
    if (standing) { B(-0.15, -0.07 + swing, 0, 0.13, 0.14, h, color); B(0.02, -0.07 - swing, 0, 0.13, 0.14, h, color); return; }
    // sitting: thighs stick out in front, resting on the seat
    place('body', 1, -0.15, 0.45, 0.13, 0.2, 0.1, color); place('body', 1, 0.02, 0.45, 0.13, 0.2, 0.1, color);
  };
  const body = (color) => B(-0.19, -0.11, 0.45, 0.38, 0.22, 0.48, color);
  const cap = (color) => B(-0.19, -0.18, 1.25, 0.38, 0.36, 0.09, color);
  let eyes = 'both';

  B(-0.17, -0.16, 0.93, 0.34, 0.32, 0.32, skin); // head

  switch (outfit) {
    case 'smart':
      legs('#3a3f55'); body('#262d47');
      front('body', -0.06, 0.6, 0.12, 0.008, 0.33, shirt);
      break;
    case 'hoodie':
      legs('#555b70'); body(shirt);
      back('head', -0.19, 0.93, 0.38, 0.05, 0.3, shirt);
      front('body', -0.1, 0.5, 0.2, 0.01, 0.1, darker(shirt));
      break;
    case 'dress':
      legs(skin, 0.28);
      if (standing) B(-0.23, -0.15, 0.28, 0.46, 0.3, 0.17, shirt);
      body(shirt);
      break;
    case 'sporty':
      legs(skin, 0.3);
      if (standing) B(-0.19, -0.11, 0.3, 0.38, 0.22, 0.15, '#22252f');
      body(shirt);
      front('body', -0.19, 0.74, 0.38, 0.008, 0.06, '#ffffff');
      break;
    case 'dino': {
      const g = '#4caf50';
      legs(g); body(g); cap(g);
      front('body', -0.1, 0.5, 0.2, 0.008, 0.36, '#c8e6a0');
      for (let i = 0; i < 3; i++) B(-0.03, -0.14 + i * 0.11, 1.34, 0.06, 0.07, 0.07, '#2e7d32');
      if (standing) back('body', -0.06, 0.45, 0.12, 0.2, 0.12, g);
      break;
    }
    case 'astronaut': {
      const w = '#f4f6f9';
      legs(w); body(w);
      B(-0.2, -0.19, 1.25, 0.4, 0.38, 0.1, w);
      front('body', -0.08, 0.68, 0.16, 0.01, 0.12, '#4f8cff', true);
      front('head', -0.15, 0.98, 0.3, 0.012, 0.22, '#1b2a4a');
      if (standing) back('body', -0.14, 0.5, 0.28, 0.1, 0.36, '#b9c4d3');
      eyes = 'none';
      break;
    }
    case 'wizard': {
      const p = '#5b3fa8';
      if (standing) B(-0.21, -0.13, 0, 0.42, 0.26, 0.45, p); else legs(p); // a long robe instead of legs
      body(p);
      front('body', -0.19, 0.5, 0.38, 0.008, 0.05, '#ffd24a');
      front('head', -0.1, 0.93, 0.2, 0.03, 0.1, '#ececec'); // beard
      B(-0.26, -0.25, 1.34, 0.52, 0.5, 0.04, p);
      B(-0.15, -0.14, 1.38, 0.3, 0.28, 0.14, p);
      B(-0.1, -0.09, 1.52, 0.2, 0.18, 0.14, p);
      B(-0.05, -0.04, 1.66, 0.1, 0.08, 0.14, '#ffd24a', true);
      break;
    }
    case 'pirate':
      legs('#2b2f3a'); body('#c0392b');
      front('body', -0.19, 0.62, 0.38, 0.008, 0.08, '#ffffff');
      B(-0.24, -0.22, 1.34, 0.48, 0.44, 0.05, '#1b1b25');
      B(-0.15, -0.14, 1.39, 0.3, 0.28, 0.12, '#1b1b25');
      front('head', 0.03, 1.04, 0.09, 0.012, 0.09, '#1b1b25'); // eye patch
      eyes = 'left';
      break;
    case 'duck': {
      const y = '#ffd21f';
      legs('#ff9a1f'); body(y); cap(y);
      front('body', -0.1, 0.5, 0.2, 0.008, 0.34, '#fff3b0');
      front('head', -0.07, 0.96, 0.14, 0.08, 0.06, '#ff9a1f'); // beak
      B(-0.03, -0.03, 1.34, 0.06, 0.06, 0.06, y);
      break;
    }
    case 'scientist': {
      const coat = '#f4f6f9';
      legs('#3a3f55', 0.3);
      if (standing) B(-0.21, -0.13, 0.3, 0.42, 0.26, 0.15, coat); // lab coat tails
      body(coat);
      front('body', -0.05, 0.6, 0.1, 0.008, 0.33, shirt);
      // wild white hair, sticking up in tufts
      B(-0.24, -0.23, 1.25, 0.48, 0.46, 0.16, '#e8e8e8');
      B(-0.2, -0.16, 1.41, 0.1, 0.1, 0.12, '#e8e8e8'); B(0.08, -0.04, 1.41, 0.1, 0.1, 0.15, '#e8e8e8'); B(-0.05, 0.08, 1.41, 0.1, 0.1, 0.09, '#e8e8e8');
      back('head', -0.19, 1.0, 0.38, 0.04, 0.25, '#e8e8e8');
      // glowing goggles
      front('head', -0.13, 1.04, 0.1, 0.014, 0.09, '#39ff9c', true);
      front('head', 0.03, 1.04, 0.1, 0.014, 0.09, '#39ff9c', true);
      eyes = 'none';
      break;
    }
    default:
      legs('#2f3550'); body(shirt);
  }

  if (!HEAD_COVERED.has(outfit) && style !== 'bald') {
    const hat = HAS_HAT.has(outfit); // tall styles are flattened under a hat
    const nape = () => back('head', -0.19, 1.05, 0.38, 0.03, 0.2, hair);
    switch (style) {
      case 'long': cap(hair); back('head', -0.19, 0.7, 0.38, 0.04, 0.55, hair); sides(0.8, 0.45, hair); break;
      case 'bob': cap(hair); back('head', -0.19, 0.9, 0.38, 0.04, 0.35, hair); sides(0.95, 0.3, hair, 0.04); break;
      case 'bun': cap(hair); nape(); if (!hat) B(-0.08, -0.14, 1.34, 0.16, 0.16, 0.12, hair); break;
      case 'topknot': cap(hair); nape(); if (!hat) { B(-0.04, -0.04, 1.34, 0.08, 0.08, 0.06, hair); B(-0.07, -0.07, 1.4, 0.14, 0.14, 0.12, hair); } break;
      case 'ponytail': cap(hair); back('head', -0.19, 1.1, 0.38, 0.03, 0.15, hair); back('head', -0.05, 0.75, 0.1, 0.03, 0.35, hair); break;
      case 'pigtails': cap(hair); nape(); sides(0.72, 0.4, hair, 0.07); break;
      case 'curly': if (hat) cap(hair); else B(-0.22, -0.21, 1.25, 0.44, 0.42, 0.16, hair); nape(); sides(1.05, 0.2, hair, 0.04); break;
      case 'afro': if (hat) cap(hair); else B(-0.27, -0.26, 1.25, 0.54, 0.52, 0.26, hair); back('head', -0.19, 1.0, 0.38, 0.06, 0.25, hair); sides(1.0, 0.25, hair, 0.07); break;
      case 'quiff': cap(hair); nape(); if (!hat) place('head', 1, -0.19, 1.34, 0.38, -0.2, 0.1, hair); break;
      case 'spiky':
        cap(hair); nape();
        if (!hat) for (const [x, y, h] of [[-0.15, -0.13, 0.1], [0.05, -0.12, 0.13], [-0.05, 0.0, 0.15], [-0.16, 0.06, 0.09], [0.07, 0.07, 0.11]]) B(x, y, 1.34, 0.09, 0.09, h, hair);
        break;
      case 'mohawk':
        if (hat) cap(hair);
        else if (axis === 'y') B(-0.04, -0.18, 1.25, 0.08, 0.36, 0.22, hair); else B(-0.18, -0.04, 1.25, 0.36, 0.08, 0.22, hair);
        break;
      default: cap(hair); nape();
    }
  }

  if (eyes !== 'none') front('head', -0.1, 1.05, 0.05, 0.008, 0.07, '#1b1b25');
  if (eyes === 'both') front('head', 0.05, 1.05, 0.05, 0.008, 0.07, '#1b1b25');

  // things in hand
  if (item === 'coffee') { B(0.24, -0.02, 0.62, 0.1, 0.1, 0.13, '#ffffff'); B(0.24, -0.02, 0.75, 0.1, 0.1, 0.02, '#7a4b2a'); }
  if (item === 'lunch') { B(0.24, -0.1, 0.62, 0.22, 0.22, 0.03, '#ffffff'); B(0.29, -0.05, 0.65, 0.12, 0.12, 0.07, '#e0a458'); }
  if (item === 'beer') { B(0.24, -0.02, 0.62, 0.1, 0.1, 0.15, '#ffb020', true); B(0.24, -0.02, 0.77, 0.1, 0.1, 0.04, '#ffffff'); }
  if (item === 'cocktail') { B(0.27, 0.01, 0.62, 0.04, 0.04, 0.09, '#e8eef5'); B(0.23, -0.03, 0.71, 0.12, 0.12, 0.08, '#ff3df2', true); }
  if (item === 'soda') { B(0.25, -0.01, 0.62, 0.08, 0.08, 0.14, '#27e0ff', true); }

  // The quiff is placed with a negative depth so it sits on top of the head, at the front.
  for (const b of out) { if (b.d < 0) { b.y += b.d; b.d = -b.d; } if (b.w < 0) { b.x += b.w; b.w = -b.w; } }
  if (!standing) { const dz = sit - 0.45; for (const b of out) b.z += dz; }
  return depthSort(out, true);
}

// A character the AI designed from a description: used as it is, facing the front.
// (In the 3D town the whole figure turns to face the way it walks.)
function customBoxes(custom, item, sit) {
  let out = custom.boxes.map((b) => ({ ...b }));
  if (item === 'coffee') out.push({ x: 0.3, y: -0.02, z: 0.62, w: 0.1, d: 0.1, h: 0.14, color: '#ffffff' });
  if (item === 'lunch') out.push({ x: 0.3, y: -0.1, z: 0.62, w: 0.22, d: 0.22, h: 0.05, color: '#ffffff' });
  if (item === 'beer') out.push({ x: 0.3, y: -0.02, z: 0.62, w: 0.1, d: 0.1, h: 0.17, color: '#ffb020', glow: true });
  if (item === 'cocktail') out.push({ x: 0.3, y: -0.02, z: 0.62, w: 0.12, d: 0.12, h: 0.14, color: '#ff3df2', glow: true });
  if (item === 'soda') out.push({ x: 0.3, y: -0.01, z: 0.62, w: 0.08, d: 0.08, h: 0.14, color: '#27e0ff', glow: true });
  if (sit !== null) {
    // sitting: lose whatever is below the waist and lower the rest onto the seat
    out = out.filter((b) => b.z + b.h > 0.5).map((b) => ({ ...b, z: Math.max(sit, b.z + sit - 0.45) }));
  }
  return depthSort(out, true);
}
// Keeps an AI-designed character inside the space one person takes up.
export function sanitiseCharacter(raw) {
  const num = (v, lo, hi) => Math.min(hi, Math.max(lo, Number.isFinite(+v) ? +v : lo));
  const boxes = [];
  for (const b of Array.isArray(raw?.boxes) ? raw.boxes.slice(0, 60) : []) {
    const w = num(b.w, 0.008, 0.9), d = num(b.d, 0.008, 0.7), h = num(b.h, 0.008, 2);
    boxes.push({
      x: num(b.x, -0.45, 0.45 - w), y: num(b.y, -0.35, 0.35 - d), z: num(b.z, 0, 2 - h), w, d, h,
      color: /^#[0-9a-fA-F]{6}$/.test(b.color) ? b.color : '#888888', glow: !!b.glow,
    });
  }
  return { name: String(raw?.name || 'Custom').slice(0, 30), boxes };
}

// Keeps a saved character within the options that exist.
export function cleanLook(l) {
  const hex = (s, fallback) => (/^#[0-9a-fA-F]{6}$/.test(s) ? s : fallback);
  return {
    shirt: hex(l?.shirt, '#4f8cff'), hair: hex(l?.hair, '#3b2a20'), skin: hex(l?.skin, '#f2c9a0'),
    outfit: OUTFITS.some((o) => o.id === l?.outfit) ? l.outfit : 'casual',
    hairStyle: HAIRSTYLES.some((h) => h.id === l?.hairStyle) ? l.hairStyle : 'short',
    custom: l?.custom?.boxes?.length ? sanitiseCharacter(l.custom) : null,
  };
}
