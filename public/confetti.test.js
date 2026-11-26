import test from 'node:test';
import assert from 'node:assert/strict';
import { allowThrow, burstDone, confettiBroadcast, confettiCaption, createBurst, pickConfettiTarget, placeBurst, CONFETTI_COOLDOWN_MS } from './confetti.js';
import { spatiallyNear } from './world.js';

const me = { id: 'me', name: 'Ada', x: 10.5, y: 12.5, f: 'x+' };

test('confetti prefers whoever is in front, then whoever is nearest, then nobody', () => {
  const ahead = { id: 'ahead', name: 'Bea', x: 13.5, y: 12.6 };
  const beside = { id: 'beside', name: 'Cam', x: 10.6, y: 14.5 };
  const far = { id: 'far', name: 'Dee', x: 40.5, y: 40.5 };
  const hit = pickConfettiTarget(me, [beside, ahead, far, me], spatiallyNear);
  assert.equal(hit.id, 'ahead');
  assert.equal(hit.facing, true);
  const nearest = pickConfettiTarget(me, [beside, far], spatiallyNear);
  assert.equal(nearest.id, 'beside');
  assert.equal(nearest.facing, false);
  assert.equal(pickConfettiTarget(me, [far], spatiallyNear), null);
  // A shared room still counts someone across the room as nearby.
  const lounge = { id: 'lou', name: 'Lou', x: 5.5, y: 35.5, f: 'x+' };
  const other = { id: 'other', name: 'Otto', x: 20.5, y: 40.5 };
  assert.equal(pickConfettiTarget(lounge, [other], spatiallyNear).id, 'other');
});

test('throws are limited, and a far target becomes a burst around you', () => {
  assert.equal(allowThrow(0, 1000), false);
  assert.equal(allowThrow(0, CONFETTI_COOLDOWN_MS), true);
  const near = { id: 'near', name: 'Bea', x: 12, y: 12.5 };
  const far = { id: 'far', name: 'Dee', x: 40, y: 40 };
  const ok = confettiBroadcast({ from: me, toId: 'near', people: [me, near, far], isNear: spatiallyNear, now: 5000, lastAt: 0 });
  assert.equal(ok.ok, true);
  assert.equal(ok.event.to, 'near');
  assert.equal(ok.event.toName, 'Bea');
  assert.equal(ok.event.name, 'Ada');
  const missed = confettiBroadcast({ from: me, toId: 'far', people: [me, far], isNear: spatiallyNear, now: 5000, lastAt: 0 });
  assert.equal(missed.event.to, null);
  assert.equal(missed.event.toName, null);
  const again = confettiBroadcast({ from: me, toId: 'near', people: [near], isNear: spatiallyNear, now: 6000, lastAt: 5000 });
  assert.equal(again.ok, false);
  assert.equal(again.lastAt, 5000);
  assert.equal(confettiCaption('Ada', 'Bea'), 'Ada threw confetti at Bea');
  assert.equal(confettiCaption('Ada', null), 'Ada threw confetti');
});

test('aimed confetti travels toward the target and then finishes', () => {
  const aimed = createBurst({ seed: 3, aimed: true, count: 8 });
  const start = placeBurst(aimed, 0);
  const later = placeBurst(aimed, 0.8);
  assert.ok(start.every((b) => b.along < 0.4));
  assert.ok(later.some((b) => b.along > start[0].along));
  assert.equal(burstDone(aimed, 0.2), false);
  assert.equal(burstDone(aimed, 10), true);
  const self = createBurst({ seed: 3, aimed: false, count: 6 });
  assert.ok(placeBurst(self, 0.4).every((b) => b.along === 0));
  assert.ok(placeBurst(self, 0.2).some((b) => b.up > 0));
});
