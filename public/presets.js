// Everything in the office is built from coloured boxes.
// A box is { x, y, z, w, d, h, color, glow?, alpha? } in tile units:
//   x runs down-right on screen, y runs down-left, z is up.
// A desk design lives in a 2 x 1 plot: x 0..2, y 0..1, z 0..2.2.
// The owner stands on the +y side, so screens face +y.

export const B = (x, y, z, w, d, h, color, glow = false, alpha = 1) =>
  ({ x, y, z, w, d, h, color, glow, alpha });

const TOP = 0.78; // height of the desk surface

function desk(top, leg) {
  return [
    B(0.1, 0.15, 0, 0.1, 0.1, 0.7, leg),
    B(1.8, 0.15, 0, 0.1, 0.1, 0.7, leg),
    B(0.1, 0.75, 0, 0.1, 0.1, 0.7, leg),
    B(1.8, 0.75, 0, 0.1, 0.1, 0.7, leg),
    B(0.05, 0.1, 0.7, 1.9, 0.8, 0.08, top),
  ];
}
function monitor(x, y, frame, screen) {
  return [
    B(x + 0.17, y + 0.02, TOP, 0.16, 0.1, 0.03, frame),
    B(x + 0.22, y + 0.04, TOP + 0.03, 0.06, 0.04, 0.1, frame),
    B(x, y, TOP + 0.13, 0.5, 0.05, 0.32, frame),
    B(x + 0.03, y + 0.05, TOP + 0.16, 0.44, 0.012, 0.26, screen, true),
  ];
}
function laptop(x, y, body, screen) {
  return [
    B(x, y + 0.06, TOP, 0.36, 0.24, 0.02, body),
    B(x, y, TOP, 0.36, 0.03, 0.24, body),
    B(x + 0.03, y + 0.03, TOP + 0.03, 0.3, 0.01, 0.18, screen, true),
  ];
}
function plant(x, y, pot, leaf, size = 1) {
  const s = size;
  return [
    B(x, y, TOP, 0.16, 0.16, 0.12, pot),
    B(x - 0.03 * s, y - 0.03 * s, TOP + 0.12, 0.22 * s, 0.22 * s, 0.14 * s, leaf),
    B(x + 0.02, y + 0.02, TOP + 0.12 + 0.14 * s, 0.12 * s, 0.12 * s, 0.14 * s, leaf),
  ];
}
function candle(x, y, h, wax = '#f1ead8') {
  return [
    B(x, y, TOP, 0.06, 0.06, h, wax),
    B(x + 0.015, y + 0.015, TOP + h, 0.03, 0.03, 0.05, '#ffb347', true),
  ];
}
function books(x, y, colors) {
  return colors.map((c, i) => B(x + (i % 2) * 0.02, y, TOP + i * 0.05, 0.26, 0.18, 0.05, c));
}
const mug = (x, y, c) => [B(x, y, TOP, 0.08, 0.08, 0.09, c)];
function lamp(x, y, stem, shade) {
  return [
    B(x, y, TOP, 0.14, 0.14, 0.03, stem),
    B(x + 0.055, y + 0.055, TOP + 0.03, 0.03, 0.03, 0.3, stem),
    B(x - 0.02, y - 0.02, TOP + 0.33, 0.18, 0.18, 0.14, shade, true),
  ];
}

export const PRESETS = {
  empty: {
    name: 'Free desk',
    boxes: [...desk('#d9d4cc', '#a7a29b')],
  },
  starter: {
    name: 'Starter desk',
    boxes: [
      ...desk('#c99a6b', '#6b4f3a'),
      ...monitor(0.75, 0.16, '#2b2f3a', '#7fd4ff'),
      ...mug(1.45, 0.6, '#ffffff'),
      ...plant(0.2, 0.2, '#c96f4a', '#4caf6a'),
    ],
  },
  gothic: {
    name: 'Gothic desk',
    boxes: [
      ...desk('#1d1a22', '#0f0d13'),
      B(0.6, 0.1, TOP, 0.8, 0.8, 0.012, '#4a1d5c'),
      ...monitor(0.75, 0.16, '#111016', '#b3122b'),
      ...candle(0.18, 0.2, 0.3),
      ...candle(0.3, 0.3, 0.2),
      ...candle(0.2, 0.42, 0.12),
      ...candle(1.72, 0.22, 0.34),
      ...candle(1.62, 0.34, 0.18),
      // skull
      B(1.42, 0.58, TOP, 0.16, 0.16, 0.13, '#e8e2d0'),
      B(1.45, 0.74, TOP + 0.05, 0.04, 0.01, 0.04, '#141218'),
      B(1.51, 0.74, TOP + 0.05, 0.04, 0.01, 0.04, '#141218'),
      ...books(0.3, 0.6, ['#5a0f1e', '#231a2e', '#3d0a14']),
      // raven perched on the monitor
      B(0.9, 0.16, TOP + 0.45, 0.14, 0.08, 0.1, '#0b0a0e'),
      B(0.98, 0.17, TOP + 0.55, 0.07, 0.07, 0.07, '#0b0a0e'),
    ],
  },
  jungle: {
    name: 'Jungle desk',
    boxes: [
      ...desk('#b98552', '#5c4026'),
      ...laptop(0.85, 0.4, '#c9ccd3', '#bff3c8'),
      ...plant(0.15, 0.18, '#d98b5f', '#2f9e58', 1.6),
      ...plant(0.45, 0.2, '#e8e0cf', '#57c27a', 1.1),
      ...plant(1.7, 0.18, '#d98b5f', '#1f8048', 1.8),
      ...plant(1.42, 0.2, '#7a5a43', '#7bd389', 1.2),
      ...plant(0.2, 0.66, '#e8e0cf', '#3fae66', 0.9),
      ...plant(1.68, 0.66, '#c96f4a', '#64c987', 1.0),
      ...mug(1.35, 0.66, '#f3d27a'),
    ],
  },
  gamer: {
    name: 'Gamer desk',
    boxes: [
      ...desk('#16181f', '#0c0d12'),
      B(0.05, 0.1, 0.66, 1.9, 0.03, 0.04, '#ff3df2', true),
      B(0.05, 0.87, 0.66, 1.9, 0.03, 0.04, '#27e0ff', true),
      ...monitor(0.42, 0.16, '#0c0d12', '#7b5cff'),
      ...monitor(0.98, 0.16, '#0c0d12', '#27e0ff'),
      // tower
      B(1.6, 0.18, TOP, 0.24, 0.42, 0.5, '#0c0d12'),
      B(1.63, 0.6, TOP + 0.05, 0.18, 0.012, 0.4, '#ff3df2', true),
      // keyboard and mouse
      B(0.7, 0.56, TOP, 0.5, 0.16, 0.02, '#22252f'),
      B(0.72, 0.58, TOP + 0.02, 0.46, 0.12, 0.008, '#39ff9c', true),
      B(1.3, 0.58, TOP, 0.07, 0.1, 0.03, '#22252f'),
      // energy can
      B(0.25, 0.55, TOP, 0.07, 0.07, 0.14, '#b6ff2e'),
    ],
  },
  cosy: {
    name: 'Cosy desk',
    boxes: [
      ...desk('#a8703f', '#5a3a22'),
      B(0.5, 0.2, TOP, 1.0, 0.6, 0.012, '#e7d7b8'),
      ...laptop(0.82, 0.38, '#e9dfd0', '#ffe9c2'),
      ...lamp(0.2, 0.2, '#6b4a2f', '#ffd27a'),
      ...books(1.5, 0.2, ['#b5523b', '#3c6e71', '#e0a458', '#7a4b6a']),
      ...mug(1.35, 0.62, '#b5523b'),
      ...plant(1.72, 0.66, '#e8e0cf', '#5fae6a', 0.9),
      // biscuit plate
      B(0.3, 0.62, TOP, 0.18, 0.18, 0.015, '#ffffff'),
      B(0.35, 0.67, TOP + 0.015, 0.08, 0.08, 0.02, '#c68a4a'),
    ],
  },
  minimal: {
    name: 'Minimal desk',
    boxes: [
      ...desk('#f4f4f1', '#c9c9c4'),
      ...laptop(0.82, 0.36, '#d6d8dc', '#ffffff'),
      ...plant(1.66, 0.22, '#f4f4f1', '#8fbf9a', 0.8),
    ],
  },
};

// The six designs anyone can pick at any desk.
export const BANK = ['starter', 'gothic', 'jungle', 'gamer', 'cosy', 'minimal'];

// Used when there is no AI key: pick the closest preset from the words typed.
const KEYWORDS = {
  gothic: ['goth', 'dark', 'vampire', 'skull', 'candle', 'witch', 'spooky', 'halloween', 'black'],
  jungle: ['plant', 'jungle', 'green', 'garden', 'nature', 'botan', 'forest', 'leaf'],
  gamer: ['gam', 'rgb', 'neon', 'cyber', 'stream', 'setup', 'pc'],
  cosy: ['cosy', 'cozy', 'warm', 'book', 'tea', 'autumn', 'hygge', 'coffee', 'cottage'],
  minimal: ['minimal', 'clean', 'white', 'simple', 'tidy', 'apple', 'zen'],
};
export function presetFromPrompt(prompt) {
  const p = String(prompt || '').toLowerCase();
  for (const [key, words] of Object.entries(KEYWORDS)) {
    if (words.some((w) => p.includes(w))) return key;
  }
  return null;
}

// Keep a design inside its plot and within sane limits, whatever produced it.
export function sanitiseDesign(design) {
  const num = (v, lo, hi) => Math.min(hi, Math.max(lo, Number.isFinite(+v) ? +v : lo));
  const boxes = [];
  for (const b of Array.isArray(design?.boxes) ? design.boxes.slice(0, 64) : []) {
    const w = num(b.w, 0.008, 2), d = num(b.d, 0.008, 1), h = num(b.h, 0.008, 2.2);
    boxes.push({
      x: num(b.x, 0, 2 - w), y: num(b.y, 0, 1 - d), z: num(b.z, 0, 2.2 - h),
      w, d, h,
      color: /^#[0-9a-fA-F]{6}$/.test(b.color) ? b.color : '#888888',
      glow: !!b.glow,
      alpha: 1,
    });
  }
  return { name: String(design?.name || 'Custom desk').slice(0, 40), boxes };
}
