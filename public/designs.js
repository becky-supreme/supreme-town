// The design sheet: every room, desk design and character on one page, drawn
// with the same code as the office so it always matches what people see.
import { DESKS, floorColor, staticObjects, robot, FLOOR_LABELS, WALL_SIGNS, RIDES, vehicleBoxes, chairBoxes, SIT } from './world.js';
import { PRESETS, BANK } from './presets.js';
import { project, drawBox, depthSort, diamond } from './iso.js';
import { avatarBoxes, OUTFITS, HAIRSTYLES } from './avatar.js';

const WALL = 2.6;
const STATUS = { available: ['Available', '#1f9d63'], meeting: ['In a meeting', '#ef4d5a'], busy: ['Busy, do not disturb', '#d97706'] };
const fixed = staticObjects();
const bots = await fetch('/api/config').then((r) => r.json()).then((c) => c.bots).catch(() => []);

function makeCanvas(parent, title, note, w, h, scale) {
  const fig = document.createElement('figure');
  const c = document.createElement('canvas');
  const dpr = devicePixelRatio || 1;
  c.width = w * scale * dpr; c.height = h * scale * dpr;
  c.style.width = `${w * scale}px`;
  const cap = document.createElement('figcaption');
  cap.innerHTML = `<b></b><span></span>`;
  cap.firstChild.textContent = title;
  cap.lastChild.textContent = note || '';
  fig.append(c, cap);
  parent.append(fig);
  const ctx = c.getContext('2d');
  ctx.scale(scale * dpr, scale * dpr);
  return ctx;
}
function pill(ctx, text, x, y, bg, fg = '#fff', font = '600 11px system-ui, sans-serif') {
  ctx.font = font;
  const w = ctx.measureText(text).width + 12;
  ctx.fillStyle = bg;
  ctx.beginPath(); ctx.roundRect(x - w / 2, y - 8, w, 16, 8); ctx.fill();
  ctx.fillStyle = fg; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y + 0.5);
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
}
function quad(ctx, pts, fill) {
  ctx.beginPath();
  pts.forEach((p, n) => (n ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
  ctx.closePath(); ctx.fillStyle = fill; ctx.fill();
}
function person(ctx, p) {
  const [sx, sy] = project(p.x, p.y);
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.beginPath(); ctx.ellipse(sx, sy, p.ride ? 22 : 15, p.ride ? 11 : 7.5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.save();
  if (p.status && p.status !== 'available') ctx.globalAlpha = 0.6;
  if (p.ride) {
    const body = avatarBoxes(p.look, p.f, 0, p.item).map((b) => ({ ...b, z: b.z + RIDES[p.ride].lift }));
    for (const b of depthSort([...vehicleBoxes(p.ride, p.f[0]), ...body], true)) drawBox(ctx, b, p.x, p.y);
  } else {
    for (const b of avatarBoxes(p.look, p.f || 'y+', 0, p.item)) drawBox(ctx, b, p.x, p.y);
  }
  ctx.restore();
}

// Draws one rectangle of the office, tiles x0..x1 by y0..y1, with optional example people.
function scene(parent, title, note, r, scale, people = []) {
  const corners = [project(r.x0, r.y0), project(r.x1, r.y0), project(r.x1, r.y1), project(r.x0, r.y1)];
  const us = corners.map((c) => c[0]), vs = corners.map((c) => c[1]);
  const top = WALL * 36 + 10, pad = 14;
  const minU = Math.min(...us) - pad, minV = Math.min(...vs) - top;
  const w = Math.max(...us) + pad - minU, h = Math.max(...vs) + 24 - minV;
  const ctx = makeCanvas(parent, title, note, w, h, scale);
  ctx.translate(-minU, -minV);
  const inR = (x, y) => x >= r.x0 && x < r.x1 && y >= r.y0 && y < r.y1;

  if (r.y0 === 0) {
    quad(ctx, [project(r.x0, 0, 0), project(r.x1, 0, 0), project(r.x1, 0, WALL), project(r.x0, 0, WALL)], '#efe6d6');
    for (let x = 2; x < 38; x += 4.3) if (x >= r.x0 && x + 2.2 <= r.x1) quad(ctx, [project(x, 0, 0.75), project(x + 2.2, 0, 0.75), project(x + 2.2, 0, 1.75), project(x, 0, 1.75)], '#bfe6ff');
    if (r.x1 > 44) quad(ctx, [project(41, 0, 0.7), project(44.5, 0, 0.7), project(44.5, 0, 1.85), project(41, 0, 1.85)], '#ffffff');
    for (const s of WALL_SIGNS) {
      if (s.x < r.x0 || s.x >= r.x1) continue;
      const [sx, sy] = project(s.x, 0, 2.02);
      ctx.save(); ctx.transform(1, 0.5, 0, 1, sx, sy);
      ctx.font = '800 15px system-ui, sans-serif'; ctx.fillStyle = s.color; ctx.fillText(s.text, 0, 0);
      ctx.restore();
    }
  }
  if (r.x0 === 0) {
    quad(ctx, [project(0, r.y0, 0), project(0, r.y1, 0), project(0, r.y1, WALL), project(0, r.y0, WALL)], '#d9cfbd');
    for (const y of [1.5, 4.5, 17, 20, 23]) if (y >= r.y0 && y + 2 <= r.y1) quad(ctx, [project(0, y, 0.9), project(0, y + 2, 0.9), project(0, y + 2, 2.1), project(0, y, 2.1)], '#a9d2ee');
    if (r.y0 <= 9 && r.y1 >= 14) {
      const [sx, sy] = project(0, 14.6, 1.2);
      ctx.save(); ctx.transform(1, -0.5, 0, 1, sx, sy);
      ctx.font = '800 30px system-ui, sans-serif'; ctx.fillStyle = '#8b5cf6'; ctx.fillText('SUPREME HQ', 0, 0);
      ctx.restore();
    }
  }
  for (let i = r.x0; i < r.x1; i++) for (let j = r.y0; j < r.y1; j++) { diamond(ctx, i, j); ctx.fillStyle = floorColor(i, j); ctx.fill(); }
  ctx.textBaseline = 'top';
  for (const l of FLOOR_LABELS) {
    if (!inR(l.x, l.y)) continue;
    const [sx, sy] = project(l.x, l.y);
    ctx.save(); ctx.transform(1, 0.5, -1, 0.5, sx, sy);
    ctx.globalAlpha = 0.6; ctx.font = `800 ${l.size}px system-ui, sans-serif`; ctx.fillStyle = l.color; ctx.fillText(l.text, 0, 0);
    ctx.restore();
  }
  ctx.textBaseline = 'alphabetic';

  const items = [];
  for (const o of fixed) if (inR(o.x, o.y)) items.push({ ...o, boxes: depthSort(o.boxes, true) });
  for (const d of DESKS) if (inR(d.x, d.y)) items.push({ ...d, kind: 'desk', boxes: depthSort(PRESETS[d.show || 'starter'].boxes, true) });
  for (const b of bots) if (inR(b.x, b.y)) items.push({ x: b.x, y: b.y, w: 1, d: 1, kind: 'bot', bot: b, boxes: depthSort(robot(b.color), true) });
  for (const p of people) items.push({ x: p.x - 0.2, y: p.y - 0.2, w: 0.4, d: 0.4, p });
  for (const it of depthSort(items)) {
    if (it.p) person(ctx, it.p);
    else for (const b of it.boxes) drawBox(ctx, b, it.x, it.y);
  }
  if (scale < 0.8) return; // labels are unreadable on the overview
  for (const it of items) {
    if (it.kind === 'bot') {
      const [x, y] = project(it.x + 0.5, it.y + 0.5, 1.75);
      pill(ctx, it.bot.name, x, y - 9, it.bot.color);
      pill(ctx, it.bot.title, x, y + 8, 'rgba(15,12,30,.8)', '#d9d4f5', '10px system-ui, sans-serif');
      if (it.bot.needsContext) { pill(ctx, 'Needs context', x, y - 30, '#ffffff', '#1b1b25', '12px system-ui, sans-serif'); }
    } else if (it.kind === 'pickup' || it.kind === 'vehicle') {
      const top2 = Math.max(...it.boxes.map((b) => b.z + b.h));
      const [x, y] = project(it.x + 0.5, it.y + 0.5, top2 + 0.35);
      pill(ctx, it.label, x, y, 'rgba(15,12,30,.8)', '#fff', '10px system-ui, sans-serif');
    }
  }
  for (const p of people) {
    const [x, y] = project(p.x, p.y, 1.62 + (p.ride ? RIDES[p.ride].lift : 0));
    pill(ctx, p.name, x, y, 'rgba(15,12,30,.82)');
    if (p.desk) {
      const [dx, dy] = project(p.desk.x + 1, p.desk.y + 0.5, 1.95);
      pill(ctx, `${p.name} · ${STATUS[p.status][0]}`, dx, dy, STATUS[p.status][1], '#fff', '700 11px system-ui, sans-serif');
    } else if (p.status && p.status !== 'available') pill(ctx, STATUS[p.status][0], x, y - 19, STATUS[p.status][1]);
  }
}

// A single thing on a small plinth of floor, for the desk and character sheets.
function specimen(parent, title, note, wTiles, dTiles, scale, drawFn) {
  const corners = [project(0, 0), project(wTiles, 0), project(wTiles, dTiles), project(0, dTiles)];
  const us = corners.map((c) => c[0]), vs = corners.map((c) => c[1]);
  const minU = Math.min(...us) - 8, minV = Math.min(...vs) - 86;
  const ctx = makeCanvas(parent, title, note, Math.max(...us) + 8 - minU, Math.max(...vs) + 10 - minV, scale);
  ctx.translate(-minU, -minV);
  for (let i = 0; i < wTiles; i++) for (let j = 0; j < dTiles; j++) { diamond(ctx, i, j); ctx.fillStyle = (i + j) % 2 ? '#dcc79e' : '#e3cfa8'; ctx.fill(); }
  drawFn(ctx);
}

const $ = (id) => document.getElementById(id);
const looks = [
  { shirt: '#8b5cf6', hair: '#3b2a20', skin: '#f2c9a0' }, { shirt: '#3ecf8e', hair: '#14121a', skin: '#8a5a3a' },
  { shirt: '#ff7a59', hair: '#d9a441', skin: '#fbe0c8' }, { shirt: '#4f8cff', hair: '#c0392b', skin: '#dca876' },
  { shirt: '#ff6fb5', hair: '#b9bcc4', skin: '#5c3a26' }, { shirt: '#ffb020', hair: '#ff6fb5', skin: '#b97f52' },
];
const names = ['Sam', 'Priya', 'Alex', 'Jo', 'Maya', 'Tom'];

// 3. the desk bank
for (const key of BANK) {
  specimen($('desks'), PRESETS[key].name, '', 2, 2, 2.4, (ctx) => {
    for (const b of depthSort(PRESETS[key].boxes, true)) drawBox(ctx, b, 0, 0);

  });
}

// 4. characters
const one = (title, note, p) => specimen($('people'), title, note, 1, 1, 3, (ctx) => person(ctx, { x: 0.5, y: 0.5, f: 'y+', ...p }));
for (const o of OUTFITS) specimen($('outfits'), o.name, '', 1, 1, 3, (ctx) => person(ctx, { x: 0.5, y: 0.5, f: 'y+', look: { ...looks[OUTFITS.indexOf(o) % 6], outfit: o.id } }));
for (const o of OUTFITS) specimen($('outfitsSide'), o.name, 'Side', 1, 1, 2, (ctx) => person(ctx, { x: 0.5, y: 0.5, f: 'x+', look: { ...looks[OUTFITS.indexOf(o) % 6], outfit: o.id } }));
for (const o of OUTFITS) specimen($('outfitsSide'), o.name, 'Back', 1, 1, 2, (ctx) => person(ctx, { x: 0.5, y: 0.5, f: 'y-', look: { ...looks[OUTFITS.indexOf(o) % 6], outfit: o.id } }));
for (const h of HAIRSTYLES) specimen($('hair'), h.name, '', 1, 1, 3, (ctx) => person(ctx, { x: 0.5, y: 0.5, f: 'y+', look: { ...looks[HAIRSTYLES.indexOf(h) % 6], hairStyle: h.id } }));
for (const h of HAIRSTYLES) specimen($('hair'), h.name, 'Back', 1, 1, 3, (ctx) => person(ctx, { x: 0.5, y: 0.5, f: 'y-', look: { ...looks[HAIRSTYLES.indexOf(h) % 6], hairStyle: h.id } }));
one('With a coffee', '', { look: looks[1], item: 'coffee' });
one('With a beer', '', { look: looks[0], item: 'beer' });
one('With a cocktail', '', { look: looks[4], item: 'cocktail' });
one('With a soft drink', '', { look: looks[5], item: 'soda' });
one('With lunch', '', { look: looks[2], item: 'lunch' });
one('In a meeting / Busy', 'Faded while unavailable', { look: looks[3], status: 'meeting' });
one('On a bike', '', { look: looks[4], ride: 'bike', f: 'x+' });
one('In a go-kart', '', { look: looks[5], ride: 'kart', f: 'x+' });
one('On a scooter', '', { look: looks[0], ride: 'scooter', f: 'x+' });
one('On a hoverboard', '', { look: looks[1], ride: 'hoverboard', f: 'x+' });
for (const [type, name] of [['office', 'Desk chair'], ['dining', 'Lunch chair'], ['armchair', 'Armchair'], ['bean', 'Bean bag'], ['stool', 'Bar stool']]) {
  specimen($('people'), `Sitting: ${name}`, '', 1, 1, 3, (ctx) => { for (const b of depthSort([...chairBoxes(type, 'y+', '#6d5bd0'), ...avatarBoxes(looks[2], 'y+', 0, null, SIT[type])], true)) drawBox(ctx, b, 0.5, 0.5); });
}
for (const b of bots) {
  specimen($('robots'), b.name, b.title, 1, 1, 3, (ctx) => { for (const box of depthSort(robot(b.color), true)) drawBox(ctx, box, 0, 0); });
}
const sw = (id, colours) => { for (const c of colours) { const s = document.createElement('span'); s.style.background = c; $(id).append(s); } };
sw('pShirt', ['#8b5cf6', '#4f8cff', '#3ecf8e', '#ffb020', '#ff7a59', '#ef4d5a', '#ff6fb5', '#f4f4f1', '#22252f']);
sw('pHair', ['#3b2a20', '#14121a', '#8a5a2b', '#d9a441', '#c0392b', '#b9bcc4', '#ff6fb5', '#4f8cff']);
sw('pSkin', ['#fbe0c8', '#f2c9a0', '#dca876', '#b97f52', '#8a5a3a', '#5c3a26']);
