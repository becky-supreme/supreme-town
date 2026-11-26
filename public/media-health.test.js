import test from 'node:test';
import assert from 'node:assert/strict';
import { deviceStillPresent, deviceWarning, iceAction, lossFromTrack } from './media-health.js';

test('a dead track is a lost mic or camera, and a mute is not', () => {
  assert.equal(lossFromTrack({ kind: 'audio', readyState: 'ended' }), 'mic');
  assert.equal(lossFromTrack({ kind: 'video', readyState: 'ended' }), 'camera');
  assert.equal(lossFromTrack({ kind: 'audio', readyState: 'live' }), null);
  assert.equal(lossFromTrack(null), null);
});

test('a device is gone only when the browser listed devices and left it out', () => {
  const devices = [{ kind: 'audioinput', deviceId: 'mic-a' }, { kind: 'audioinput', deviceId: 'mic-b' }];
  assert.equal(deviceStillPresent('mic-a', devices), true);
  assert.equal(deviceStillPresent('mic-gone', devices), false);
  assert.equal(deviceStillPresent('', devices), true);
  assert.equal(deviceStillPresent('mic-a', []), true);
});

test('the warning says what disconnected and that a click reconnects it', () => {
  assert.equal(deviceWarning({ micDown: true }), 'Your microphone disconnected, click to reconnect.');
  assert.equal(deviceWarning({ camDown: true }), 'Your camera disconnected, click to reconnect.');
  assert.equal(deviceWarning({ micDown: true, camDown: true }), 'Your microphone and camera disconnected, click to reconnect.');
  assert.equal(deviceWarning({ micDown: true, cause: 'unavailable' }), 'Your microphone is unavailable, click to reconnect.');
  assert.equal(deviceWarning({}), '');
});

test('a failed call restarts twice, then gives up', () => {
  assert.equal(iceAction('disconnected', 0, 0), 'wait');
  assert.equal(iceAction('disconnected', 3999, 0), 'wait');
  assert.equal(iceAction('disconnected', 4000, 0), 'restart');
  assert.equal(iceAction('failed', 0, 0), 'restart');
  assert.equal(iceAction('failed', 0, 1), 'restart');
  assert.equal(iceAction('failed', 0, 2), 'drop');
  assert.equal(iceAction('connected', 0, 2), 'none');
});
