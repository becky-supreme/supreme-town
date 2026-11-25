// A mock-up: one part of Supreme Town shown in an 8-bit look, with example
// people standing in. It uses the real town and the real 3D renderer, so what
// you see is what the town would look like with this style switched on.
import { DESKS, staticObjects, robot, CHAIRS } from './world.js';
import { PRESETS, BANK } from './presets.js';
import { createScene } from './scene3d.js';

const scene = createScene(document.getElementById('gl'));
scene.setLook('8bit');

const fixed = staticObjects();
for (const o of fixed) if (o.decor) scene.addDecor(o);
const bots = await fetch('/api/config').then((r) => r.json()).then((c) => c.bots).catch(() => []);
scene.setStatic([...fixed, ...bots.map((b) => ({ x: b.x, y: b.y, boxes: robot(b.color) }))]);
scene.setDesks(DESKS.map((d, i) => ({ x: d.x, y: d.y, boxes: PRESETS[BANK[i % BANK.length]].boxes })));

// ---------- example people ----------
const L = (shirt, hair, skin, outfit = 'casual', hairStyle = 'short') => ({ shirt, hair, skin, outfit, hairStyle });
const person = (name, look, x, y, extra = {}) => ({ id: name, name, look, x: x + 0.5, y: y + 0.5, f: 'y+', step: 0, item: null, ride: null, ...extra });
const people = [
  // the bar
  person('Sam', L('#8b5cf6', '#3b2a20', '#f2c9a0', 'hoodie', 'quiff'), 35, 31, { item: 'beer' }),
  person('Priya', L('#ff6fb5', '#14121a', '#b97f52', 'dress', 'long'), 37, 31, { item: 'cocktail' }),
  person('Tom', L('#4f8cff', '#d9a441', '#fbe0c8', 'pirate', 'short'), 38, 31),
  person('Jo', L('#3ecf8e', '#c0392b', '#dca876', 'sporty', 'ponytail'), 36, 35, { f: 'x-' }),
  person('Maya', L('#ffb020', '#14121a', '#8a5a3a', 'casual', 'afro'), 37, 37, { f: 'x+', item: 'soda' }),
  person('Alex', L('#ef4d5a', '#b9bcc4', '#f2c9a0', 'scientist'), 32, 40, { item: 'beer' }),
  person('Dee', L('#22252f', '#ff6fb5', '#fbe0c8', 'smart', 'bob'), 34, 40),
  person('Rik', L('#ffd21f', '#3b2a20', '#f2c9a0', 'duck'), 42, 33, { ride: 'kart', f: 'y+', pace: { axis: 'y', from: 32.5, to: 41.5 } }),
  // the lounge
  person('Ana', L('#27b0e0', '#8a5a2b', '#dca876', 'casual', 'bun'), 6, 33, { item: 'coffee' }),
  person('Ben', L('#ff7a59', '#14121a', '#5c3a26', 'hoodie', 'curly'), 4, 35),
  person('Cal', L('#f4f4f1', '#3b2a20', '#f2c9a0', 'astronaut'), 3, 38),
  person('Eve', L('#8b5cf6', '#d9a441', '#fbe0c8', 'wizard', 'long'), 4, 40),
  person('Fay', L('#3ecf8e', '#c0392b', '#f2c9a0', 'dino'), 15, 33),
  person('Gus', L('#4f8cff', '#14121a', '#b97f52', 'smart', 'mohawk'), 9, 37, { pace: { axis: 'x', from: 8.5, to: 18.5 } }),
  // Main Street
  person('Hal', L('#ff6fb5', '#3b2a20', '#dca876', 'casual', 'spiky'), 19, 13, { ride: 'hoverboard', f: 'x+', pace: { axis: 'x', from: 14.5, to: 30.5 } }),
  person('Ivy', L('#ffb020', '#14121a', '#8a5a3a', 'dress', 'pigtails'), 24, 10, { item: 'coffee' }),
  person('Jax', L('#22252f', '#b9bcc4', '#fbe0c8', 'pirate'), 20, 10, { ride: 'bike', f: 'x-' }),
  // the Dev team
  person('Kit', L('#8b5cf6', '#3b2a20', '#f2c9a0', 'hoodie', 'topknot'), 1, 3),
  person('Lou', L('#3ecf8e', '#d9a441', '#fbe0c8', 'scientist'), 4, 3),
  person('Moe', L('#ef4d5a', '#14121a', '#5c3a26', 'sporty', 'short'), 7, 7),
  person('Nia', L('#4f8cff', '#8a5a2b', '#dca876', 'casual', 'bob'), 10, 4, { item: 'coffee' }),
];
const chairAt = new Map(CHAIRS.map((c) => [`${c.x},${c.y}`, c]));
const chairOf = (p) => (p.ride || p.pace ? null : chairAt.get(`${Math.floor(p.x)},${Math.floor(p.y)}`) || null);

const AREAS = {
  bar: { x: 37.5, y: 34.5, distance: 29 },
  lounge: { x: 12, y: 35.5, distance: 33 },
  street: { x: 22, y: 12, distance: 29 },
  team: { x: 6.5, y: 5.5, distance: 25 },
};
let area = AREAS.bar;
let look = '8bit';
const cam = { ...area };

for (const b of document.querySelectorAll('button')) {
  b.onclick = () => {
    if (b.dataset.look) { look = b.dataset.look; scene.setLook(look); }
    if (b.dataset.area) area = AREAS[b.dataset.area];
    const group = b.dataset.look ? 'look' : 'area';
    for (const o of document.querySelectorAll(`button[data-${group}]`)) o.classList.toggle('on', o === b);
  };
}

// ---------- name tags: sharp, square and blocky in the 8-bit look ----------
const tags = document.getElementById('tags');
const g = tags.getContext('2d');
function resize() { const dpr = devicePixelRatio || 1; tags.width = innerWidth * dpr; tags.height = innerHeight * dpr; }
addEventListener('resize', resize);
resize();
function drawTags() {
  const dpr = devicePixelRatio || 1;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, innerWidth, innerHeight);
  const retro = look === '8bit';
  g.font = retro ? 'bold 12px "Courier New", ui-monospace, monospace' : '600 11px system-ui, sans-serif';
  g.textBaseline = 'middle'; g.textAlign = 'center';
  for (const p of people) {
    const c = chairOf(p);
    const s = scene.screenOf(c ? c.x + 0.5 : p.x, c ? c.y + 0.5 : p.y, 1.8);
    if (!s.visible) continue;
    const x = Math.round(s.x), y = Math.round(s.y);
    const text = retro ? p.name.toUpperCase() : p.name;
    const w = Math.ceil(g.measureText(text).width) + 12;
    if (retro) {
      const left = Math.round(x - w / 2);
      g.fillStyle = '#1b1b25'; g.fillRect(left - 3, y - 12, w + 6, 21);
      g.fillStyle = '#ffffff'; g.fillRect(left, y - 9, w, 15);
      g.fillStyle = '#1b1b25';
    } else {
      g.fillStyle = 'rgba(15,12,30,.82)'; g.beginPath(); g.roundRect(x - w / 2, y - 8, w, 16, 8); g.fill();
      g.fillStyle = '#ffffff';
    }
    g.fillText(text, x, y - (retro ? 1 : 0));
  }
}

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000), t = now / 1000;
  last = now;
  // a few people wander or ride back and forth so the scene isn't frozen
  for (const p of people) {
    if (!p.pace) continue;
    const { axis, from, to } = p.pace;
    const speed = p.ride ? 5 : 2.2;
    p.dir ??= 1;
    p[axis] += p.dir * speed * dt;
    if (p[axis] > to) { p[axis] = to; p.dir = -1; } else if (p[axis] < from) { p[axis] = from; p.dir = 1; }
    p.f = axis + (p.dir > 0 ? '+' : '-');
    p.step += dt * 14;
  }
  const k = Math.min(1, dt * 3);
  cam.x += (area.x - cam.x) * k; cam.y += (area.y - cam.y) * k; cam.distance += (area.distance - cam.distance) * k;
  scene.syncPeople(people, chairOf, dt, t);
  // the 8-bit view holds still, like a game screen; the current look drifts a little
  const sway = look === '8bit' ? 0 : 1;
  scene.render({ x: cam.x + Math.sin(t * 0.25) * 0.8 * sway, y: cam.y + Math.cos(t * 0.2) * 0.6 * sway }, cam.distance * (innerWidth < 800 ? 1.3 : 1), t);
  drawTags();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
