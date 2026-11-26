// Throwing confetti: who it hits, how often, and where the pieces fly.
// Drawing happens in the town; this file only decides, so it can be tested.

export const CONFETTI_COOLDOWN_MS = 2000;

const FACING = { 'x+': [1, 0], 'x-': [-1, 0], 'y+': [0, 1], 'y-': [0, -1] };
const COLORS = ['#ff4d6d', '#ffd166', '#06d6a0', '#4cc9f0', '#f72585', '#ffe66d', '#c77dff', '#ffffff', '#ff9f1c'];

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Someone in front of you (the closer one, if several), otherwise the nearest
// person `isNear` allows, otherwise null so the burst stays around you.
// `isNear(me, them)` decides who counts as nearby. Without one, six squares does.
export function pickConfettiTarget(me, others, isNear) {
  if (!me) return null;
  const near = typeof isNear === 'function'
    ? isNear
    : (a, b) => Math.hypot(a.x - b.x, a.y - b.y) <= 6;
  const [fx, fy] = FACING[me.f] || [0, 1];
  let facing = null, facingD = Infinity, nearest = null, nearestD = Infinity;
  for (const p of others || []) {
    if (!p || p.id === me.id || !near(me, p)) continue;
    const dx = p.x - me.x, dy = p.y - me.y;
    const d = Math.hypot(dx, dy);
    if (!(d > 0.05)) continue;
    if (d < nearestD) { nearest = p; nearestD = d; }
    const dot = (dx / d) * fx + (dy / d) * fy;
    if (dot >= 0.5 && d < facingD) { facing = p; facingD = d; }
  }
  const chosen = facing || nearest;
  if (!chosen) return null;
  return { id: chosen.id, name: chosen.name || '', facing: !!facing };
}

export function allowThrow(lastAt, now, cooldown = CONFETTI_COOLDOWN_MS) {
  return !(Number.isFinite(lastAt) && Number.isFinite(now) && now - lastAt < cooldown);
}

// The message everyone nearby should see. A target who isn't nearby is dropped,
// and the throw still happens around the thrower. A throw inside the cooldown
// is refused and does not move the clock.
export function confettiBroadcast({ from, toId, people, isNear, now, lastAt }) {
  if (!from || !allowThrow(lastAt, now)) return { ok: false, lastAt: lastAt || 0 };
  const list = people || [];
  const target = toId ? list.find((p) => p && p.id === toId && p.id !== from.id && isNear(from, p)) : null;
  return {
    ok: true,
    lastAt: now,
    event: {
      t: 'confetti',
      from: from.id,
      name: from.name || 'Someone',
      to: target ? target.id : null,
      toName: target?.name || null,
      at: now,
    },
  };
}

export function confettiCaption(fromName, toName) {
  const from = fromName || 'Someone';
  return toName ? `${from} threw confetti at ${toName}` : `${from} threw confetti`;
}

// Pieces of confetti. `aimed` flies toward someone; otherwise they pop around
// the thrower. `seed` keeps a test (and a replay) repeatable.
export function createBurst({ seed = 1, aimed = false, count = 40 } = {}) {
  const rand = mulberry32(seed);
  const bits = [];
  for (let i = 0; i < count; i++) {
    bits.push({
      along0: rand() * 0.18,
      side0: (rand() - 0.5) * (aimed ? 18 : 10),
      up0: rand() * 8,
      spin0: rand() * Math.PI * 2,
      speed: 0.65 + rand() * 0.7,
      drift: (rand() - 0.5) * (aimed ? 40 : 80),
      pop: (aimed ? 28 : 70) + rand() * 100,
      w: 4 + Math.floor(rand() * 5),
      h: 3 + Math.floor(rand() * 3),
      color: COLORS[Math.floor(rand() * COLORS.length)],
      life: 1.15 + rand() * 0.6,
    });
  }
  return { aimed: !!aimed, bits };
}

// Where each piece is, `elapsedSec` after the throw. `along` is 0 at the
// thrower and 1 at the target. `side` and `up` are pixels of scatter.
export function placeBurst(burst, elapsedSec) {
  const t = Number(elapsedSec) || 0;
  const out = [];
  for (const b of burst?.bits || []) {
    if (t < 0 || t > b.life) continue;
    out.push({
      along: burst.aimed ? Math.min(1, b.along0 + b.speed * t) : 0,
      side: b.side0 + b.drift * t,
      up: b.up0 + b.pop * t - 120 * t * t,
      spin: b.spin0 + t * 7,
      w: b.w,
      h: b.h,
      color: b.color,
      alpha: Math.max(0, 1 - t / b.life),
    });
  }
  return out;
}

export function burstDone(burst, elapsedSec) {
  const t = Number(elapsedSec) || 0;
  const bits = burst?.bits || [];
  return bits.length > 0 && bits.every((b) => t > b.life);
}
