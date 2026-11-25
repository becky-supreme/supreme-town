// Isometric drawing: projection, shaded boxes and depth sorting.
export const HW = 32; // half tile width on screen
export const HH = 16; // half tile height on screen
export const ZH = 36; // pixels per unit of height

export const project = (x, y, z = 0) => [(x - y) * HW, (x + y) * HH - z * ZH];
export const unproject = (u, v) => [(u / HW + v / HH) / 2, (v / HH - u / HW) / 2];

const shadeCache = new Map();
function shade(hex, f) {
  const key = hex + f;
  let c = shadeCache.get(key);
  if (!c) {
    const n = parseInt(hex.slice(1), 16);
    const ch = (s) => Math.max(0, Math.min(255, Math.round(((n >> s) & 255) * f)));
    c = `rgb(${ch(16)},${ch(8)},${ch(0)})`;
    shadeCache.set(key, c);
  }
  return c;
}

function face(ctx, pts, fill) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.stroke();
}

export function drawBox(ctx, b, ox = 0, oy = 0, oz = 0) {
  const x = b.x + ox, y = b.y + oy, z = b.z + oz;
  const { w, d, h, color } = b;
  const p = project;
  ctx.save();
  if (b.alpha !== undefined && b.alpha < 1) ctx.globalAlpha *= b.alpha;
  if (b.glow) { ctx.shadowColor = color; ctx.shadowBlur = 12; }
  ctx.lineWidth = 0.6;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = shade(color, 0.5);
  const g = b.glow ? 0.12 : 0;
  face(ctx, [p(x, y + d, z), p(x + w, y + d, z), p(x + w, y + d, z + h), p(x, y + d, z + h)], shade(color, 0.8 + g));
  face(ctx, [p(x + w, y, z), p(x + w, y + d, z), p(x + w, y + d, z + h), p(x + w, y, z + h)], shade(color, 0.62 + g));
  face(ctx, [p(x, y, z + h), p(x + w, y, z + h), p(x + w, y + d, z + h), p(x, y + d, z + h)], shade(color, 1));
  ctx.restore();
}

// Which of two boxes must be painted first? -1: a, 1: b, 0: no opinion.
function order(a, b, useZ) {
  const e = 1e-6;
  const aBack = (a.x + a.w <= b.x + e ? 1 : 0) + (a.y + a.d <= b.y + e ? 1 : 0);
  const bBack = (b.x + b.w <= a.x + e ? 1 : 0) + (b.y + b.d <= a.y + e ? 1 : 0);
  if (aBack && !bBack) return -1;
  if (bBack && !aBack) return 1;
  if (useZ) {
    if (a.z + a.h <= b.z + e) return -1;
    if (b.z + b.h <= a.z + e) return 1;
  }
  if (!aBack && !bBack) return 0;
  return depthKey(a) < depthKey(b) ? -1 : 1;
}
const depthKey = (a) => a.x + a.w / 2 + a.y + a.d / 2 + (a.z || 0) * 0.01;

// Painter's order for boxes that do not intersect: back to front.
export function depthSort(items, useZ = false) {
  const n = items.length;
  const indeg = new Array(n).fill(0);
  const adj = items.map(() => []);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const r = order(items[i], items[j], useZ);
      if (r < 0) { adj[i].push(j); indeg[j]++; } else if (r > 0) { adj[j].push(i); indeg[i]++; }
    }
  }
  const keys = items.map(depthKey);
  const done = new Array(n).fill(false);
  const out = [];
  for (let k = 0; k < n; k++) {
    let pick = -1, fallback = -1;
    for (let i = 0; i < n; i++) {
      if (done[i]) continue;
      if (fallback < 0 || keys[i] < keys[fallback]) fallback = i;
      if (indeg[i] === 0 && (pick < 0 || keys[i] < keys[pick])) pick = i;
    }
    if (pick < 0) pick = fallback; // a cycle: take the furthest back
    done[pick] = true;
    out.push(items[pick]);
    for (const j of adj[pick]) indeg[j]--;
  }
  return out;
}

export function diamond(ctx, i, j) {
  const a = project(i, j), b = project(i + 1, j), c = project(i + 1, j + 1), d = project(i, j + 1);
  ctx.beginPath();
  ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.lineTo(c[0], c[1]); ctx.lineTo(d[0], d[1]);
  ctx.closePath();
}
