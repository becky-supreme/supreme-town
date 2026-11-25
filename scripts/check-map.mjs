// Checks the map before you push it live: nothing on top of anything else,
// nothing off the edge, and every seat, bot and ride can be walked to.
// Run with: npm run check
import fs from 'node:fs';
import { staticObjects, CHAIRS, DESKS, SPAWNS, W, H } from '../public/world.js';

const bots = JSON.parse(fs.readFileSync(new URL('../config/bots.json', import.meta.url), 'utf8'));
const owner = new Map();
const problems = [];
const claim = (name, x, y, w, d) => {
  for (let i = 0; i < w; i++) for (let j = 0; j < d; j++) {
    const k = `${x + i},${y + j}`;
    if (x + i < 0 || y + j < 0 || x + i >= W || y + j >= H) problems.push(`${name} is off the edge of the map at square ${k}`);
    else if (owner.has(k)) problems.push(`${name} is on top of ${owner.get(k)} at square ${k}`);
    owner.set(k, name);
  }
};
for (const o of staticObjects()) claim(o.id, o.x, o.y, o.w, o.d);
for (const d of DESKS) claim(`desk ${d.id}`, d.x, d.y, d.w, d.d);
for (const b of bots) claim(`receptionist ${b.name}`, b.x, b.y, 1, 1);
const seats = new Set();
for (const c of CHAIRS) {
  const k = `${c.x},${c.y}`;
  if (owner.has(k)) problems.push(`a seat is on top of ${owner.get(k)} at square ${k}`);
  if (seats.has(k)) problems.push(`two seats share square ${k}`);
  seats.add(k);
}
for (const [x, y] of SPAWNS) if (owner.has(`${x},${y}`)) problems.push(`the arrival point at square ${x},${y} is blocked by ${owner.get(`${x},${y}`)}`);

const free = (x, y) => x >= 0 && y >= 0 && x < W && y < H && !owner.has(`${x},${y}`);
const reach = new Set([SPAWNS[0].join(',')]);
const queue = [SPAWNS[0]];
for (let n = 0; n < queue.length; n++) {
  const [x, y] = queue[n];
  for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
    const k = `${x + dx},${y + dy}`;
    if (free(x + dx, y + dy) && !reach.has(k)) { reach.add(k); queue.push([x + dx, y + dy]); }
  }
}
for (const c of CHAIRS) if (!reach.has(`${c.x},${c.y}`)) problems.push(`nobody can walk to the seat at square ${c.x},${c.y}`);
const usable = [...staticObjects().filter((o) => o.kind), ...DESKS.map((d) => ({ ...d, id: `desk ${d.id}` })), ...bots.map((b) => ({ id: `receptionist ${b.name}`, x: b.x, y: b.y, w: 1, d: 1 }))];
for (const o of usable) {
  let ok = false;
  for (let i = -1; i <= o.w; i++) for (let j = -1; j <= o.d; j++) if (reach.has(`${o.x + i},${o.y + j}`)) ok = true;
  if (!ok) problems.push(`nobody can walk up to ${o.id}`);
}

if (problems.length) { console.log(`Found ${problems.length} problem(s) with the map:\n- ${problems.join('\n- ')}`); process.exit(1); }
console.log(`The map is fine: ${staticObjects().length} things, ${CHAIRS.length} seats, ${DESKS.length} desks, ${bots.length} receptionists, no clashes.`);
