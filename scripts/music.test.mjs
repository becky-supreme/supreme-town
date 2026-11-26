// Music sharing: who is allowed to play, how the audio is described, and the
// server rules (one person at a time, calls only while someone is sharing).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import { musicConflict, musicVolume, sharesMusicSpace, tuneMusicSdp, inEarshot } from '../public/music-rules.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

test('one sharer per shared room, and per patch of open floor', () => {
  const lounge = (id) => ({ id, x: 5, y: 35, music: 'm', status: 'available' });
  const otherLounge = { id: 'b', x: 20, y: 40, music: 'm', status: 'available' };
  assert.equal(sharesMusicSpace(lounge('a'), otherLounge), true);
  assert.equal(musicConflict(lounge('a'), [lounge('a'), otherLounge])?.id, 'b');
  // The same person is not a conflict with themselves.
  assert.equal(musicConflict(lounge('a'), [lounge('a')]), null);

  const bar = { id: 'c', x: 40, y: 35, music: 'm', status: 'available' };
  assert.equal(sharesMusicSpace({ x: 5, y: 35 }, bar), false);
  assert.equal(musicConflict({ id: 'a', x: 5, y: 35 }, [bar]), null);

  // Meeting room and the street outside it are separate.
  assert.equal(sharesMusicSpace({ x: 42, y: 3 }, { x: 10, y: 12 }), false);

  // Two team socials are different rooms.
  assert.equal(sharesMusicSpace({ x: 11, y: 2 }, { x: 24, y: 2 }), false);
  assert.equal(sharesMusicSpace({ x: 11, y: 2 }, { x: 11, y: 4 }), true);

  // Out in the open, far apart is fine; close enough that someone could hear both is not.
  assert.equal(sharesMusicSpace({ x: 3, y: 12 }, { x: 20, y: 12 }), false);
  assert.equal(sharesMusicSpace({ x: 3, y: 12 }, { x: 10, y: 12 }), true);
  assert.equal(musicConflict({ id: 'a', x: 3, y: 12 }, [{ id: 'b', x: 20, y: 12, music: 'm', status: 'available' }]), null);

  // Someone set to Busy is not holding the music.
  assert.equal(musicConflict({ id: 'a', x: 5, y: 35 }, [{ id: 'b', x: 6, y: 35, music: 'm', status: 'busy' }]), null);
});

test('music loudness follows the room, then the distance', () => {
  assert.equal(musicVolume({ x: 5, y: 35 }, { x: 20, y: 40 }), 1);
  assert.equal(musicVolume({ x: 5, y: 35 }, { x: 40, y: 35 }), 0);
  assert.equal(musicVolume({ x: 3, y: 12 }, { x: 3, y: 12 }), 1);
  assert.equal(musicVolume({ x: 3, y: 12 }, { x: 30, y: 12 }), 0);
  assert.equal(inEarshot({ x: 42, y: 4 }, { x: 43, y: 5 }), true);
  assert.equal(inEarshot({ x: 42, y: 4 }, { x: 10, y: 12 }), false);
});

test('music sdp asks opus for stereo and a music bitrate', () => {
  const sdp = [
    'v=0',
    'm=audio 9 UDP/TLS/RTP/SAVPF 111',
    'a=rtpmap:111 opus/48000/2',
    'a=fmtp:111 minptime=10;useinbandfec=1',
    'm=video 9 UDP/TLS/RTP/SAVPF 96',
    'a=rtpmap:96 VP8/90000',
    'a=fmtp:96 max-fr=30',
    '',
  ].join('\r\n');
  const once = tuneMusicSdp(sdp);
  const opus = once.split('\r\n').find((l) => l.startsWith('a=fmtp:111'));
  assert.match(opus, /stereo=1/);
  assert.match(opus, /sprop-stereo=1/);
  assert.match(opus, /maxaveragebitrate=510000/);
  assert.match(opus, /usedtx=0/);
  const params = opus.slice('a=fmtp:111 '.length).split(';');
  assert.equal(params.filter((p) => p === 'stereo=1').length, 1);
  assert.equal(params.filter((p) => p === 'sprop-stereo=1').length, 1);
  assert.equal(once.split('\r\n').find((l) => l.startsWith('a=fmtp:96')), 'a=fmtp:96 max-fr=30');
  assert.equal(tuneMusicSdp(once), once);
  assert.equal(tuneMusicSdp(''), '');
  assert.equal(tuneMusicSdp(null), null);

  const lf = 'a=rtpmap:111 opus/48000/2\na=fmtp:111 minptime=10';
  assert.ok(tuneMusicSdp(lf).includes('stereo=1'));
  assert.ok(!tuneMusicSdp(lf).includes('\r\n'));
});

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

function startServer(port) {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-music-'));
  const env = { ...process.env, PORT: String(port), DATA_DIR: data };
  delete env.GOOGLE_CLIENT_ID;
  delete env.ANTHROPIC_API_KEY;
  delete env.OPENROUTER_API_KEY;
  delete env.NOTION_TOKEN;
  // Music checks assume the Slack gate is off, the same as a server with no Slack app.
  for (const key of Object.keys(env)) if (key.startsWith('SLACK_')) delete env[key];
  const proc = spawn(process.execPath, ['server.js'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  proc.stdout.on('data', (c) => { log += c; });
  proc.stderr.on('data', (c) => { log += c; });
  const ready = new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`server did not start\n${log}`)), 8000);
    proc.stdout.on('data', () => {
      if (log.includes('Supreme Town is open')) { clearTimeout(t); resolve(); }
    });
    proc.once('exit', (code) => { clearTimeout(t); reject(new Error(`server exited ${code}\n${log}`)); });
  });
  return { proc, data, ready, log: () => log };
}

function connect(port, name) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  const inbox = [];
  const waiters = [];
  ws.on('message', (raw) => {
    const m = JSON.parse(raw);
    inbox.push(m);
    for (let i = waiters.length - 1; i >= 0; i--) {
      if (!waiters[i].match(m)) continue;
      const w = waiters.splice(i, 1)[0];
      clearTimeout(w.timer);
      w.resolve(m);
    }
  });
  function wait(match, ms = 2000) {
    const found = inbox.find((m) => !m._used && match(m));
    if (found) { found._used = true; return Promise.resolve(found); }
    return new Promise((resolve, reject) => {
      const w = { match, resolve: (m) => { m._used = true; resolve(m); }, timer: null };
      w.timer = setTimeout(() => {
        const i = waiters.indexOf(w);
        if (i >= 0) waiters.splice(i, 1);
        reject(new Error(`timed out waiting for a message (${name})`));
      }, ms);
      waiters.push(w);
    });
  }
  const opened = new Promise((resolve, reject) => {
    ws.once('error', reject);
    ws.once('open', () => {
      ws.send(JSON.stringify({
        t: 'join', name,
        look: { shirt: '#8b5cf6', hair: '#14121a', skin: '#f2c9a0', outfit: 'casual', hairStyle: 'short' },
      }));
      wait((m) => m.t === 'init').then((init) => resolve({ ws, inbox, wait, me: init.you, x: init.you.x, y: init.you.y })).catch(reject);
    });
  });
  return opened;
}

test('the server lets one person play, then the next after they stop or leave', async (t) => {
  const port = await freePort();
  const server = startServer(port);
  t.after(() => { server.proc.kill(); fs.rmSync(server.data, { recursive: true, force: true }); });
  await server.ready;
  const jake = await connect(port, 'Jake');
  const sam = await connect(port, 'Sam');

  const offer = { type: 'offer', sdp: 'v=0\r\n' };
  sam.ws.send(JSON.stringify({ t: 'music-signal', to: jake.me.id, data: { sdp: offer } }));
  await new Promise((r) => setTimeout(r, 250));
  assert.equal(jake.inbox.some((m) => m.t === 'music-signal'), false);

  jake.ws.send(JSON.stringify({ t: 'music', on: true, id: 'track-jake', label: 'Lo-fi radio' }));
  const started = await sam.wait((m) => m.t === 'music' && m.id === jake.me.id && m.music);
  assert.equal(started.music, 'track-jake');
  assert.equal(started.musicLabel, 'Lo-fi radio');

  sam.ws.send(JSON.stringify({ t: 'music', on: true, id: 'track-sam', label: 'Other' }));
  const denied = await sam.wait((m) => m.t === 'music' && m.denied);
  assert.equal(denied.by, 'Jake');
  assert.equal(denied.music, null);
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(jake.inbox.some((m) => m.t === 'music' && m.id === sam.me.id && m.music), false);

  sam.ws.send(JSON.stringify({ t: 'music-signal', to: jake.me.id, data: { sdp: offer } }));
  const sig = await jake.wait((m) => m.t === 'music-signal');
  assert.equal(sig.from, sam.me.id);
  assert.equal(sig.data.sdp.type, 'offer');

  jake.ws.send(JSON.stringify({ t: 'state', status: 'meeting', muted: true, camOff: true }));
  const cleared = await sam.wait((m) => m.t === 'music' && m.id === jake.me.id && !m.music);
  assert.equal(cleared.stopped, 'status');

  sam.ws.send(JSON.stringify({ t: 'music', on: true, id: 'track-sam', label: 'Desk speakers' }));
  const samOn = await jake.wait((m) => m.t === 'music' && m.id === sam.me.id && m.music);
  assert.equal(samOn.musicLabel, 'Desk speakers');

  sam.ws.close();
  const left = await jake.wait((m) => m.t === 'leave' && m.id === sam.me.id);
  assert.equal(left.id, sam.me.id);

  jake.ws.send(JSON.stringify({ t: 'state', status: 'available' }));
  jake.ws.send(JSON.stringify({ t: 'music', on: true, id: 'track-jake-2', label: 'Again' }));
  const again = await jake.wait((m) => m.t === 'music' && m.id === jake.me.id && m.music === 'track-jake-2');
  assert.equal(again.musicLabel, 'Again');
});

test('two people far apart can both play, and walking into earshot stops the one who moved', async (t) => {
  const port = await freePort();
  const server = startServer(port);
  t.after(() => { server.proc.kill(); fs.rmSync(server.data, { recursive: true, force: true }); });
  await server.ready;
  const jake = await connect(port, 'Jake');
  const sam = await connect(port, 'Sam');

  async function step(walker, x, y) {
    const fromJ = jake.inbox.length;
    const fromS = sam.inbox.length;
    const fromW = walker.inbox.length;
    walker.ws.send(JSON.stringify({ t: 'move', x, y, f: x >= walker.x ? 'x+' : 'x-' }));
    const start = Date.now();
    while (Date.now() - start < 600) {
      if (walker.inbox.slice(fromW).some((m) => m.t === 'pos')) return false;
      const moved = (walker === jake ? sam.inbox.slice(fromS) : jake.inbox.slice(fromJ))
        .find((m) => m.t === 'move' && m.id === walker.me.id && Math.abs(m.x - x) < 0.02 && Math.abs(m.y - y) < 0.02);
      if (moved) { walker.x = x; walker.y = y; return true; }
      await new Promise((r) => setTimeout(r, 20));
    }
    return false;
  }

  // Walk Sam east along the street until Jake could not hear him.
  let guard = 0;
  while (Math.hypot(sam.x - jake.x, sam.y - jake.y) < 12 && guard < 40) {
    guard++;
    const ahead = await step(sam, sam.x + 1, sam.y);
    if (ahead) { await new Promise((r) => setTimeout(r, 90)); continue; }
    const down = await step(sam, sam.x, sam.y + 1);
    if (down) { await new Promise((r) => setTimeout(r, 90)); continue; }
    const up = await step(sam, sam.x, sam.y - 1);
    if (!up) break;
    await new Promise((r) => setTimeout(r, 90));
  }
  assert.ok(Math.hypot(sam.x - jake.x, sam.y - jake.y) >= 12, `could not walk apart (sam at ${sam.x},${sam.y}, jake at ${jake.x},${jake.y})`);

  jake.ws.send(JSON.stringify({ t: 'music', on: true, id: 'near', label: 'Near' }));
  sam.ws.send(JSON.stringify({ t: 'music', on: true, id: 'far', label: 'Far' }));
  const jakeOn = await sam.wait((m) => m.t === 'music' && m.id === jake.me.id && m.music === 'near');
  const samOn = await jake.wait((m) => m.t === 'music' && m.id === sam.me.id && m.music === 'far');
  assert.equal(jakeOn.musicLabel, 'Near');
  assert.equal(samOn.musicLabel, 'Far');

  // A call between them is out of earshot, so the server drops it.
  sam.ws.send(JSON.stringify({ t: 'music-signal', to: jake.me.id, data: { sdp: { type: 'offer', sdp: 'v=0\r\n' } } }));
  await new Promise((r) => setTimeout(r, 250));
  assert.equal(jake.inbox.some((m) => m.t === 'music-signal'), false);

  // Sam walks back toward Jake until the server stops Sam's music.
  guard = 0;
  let stopped = null;
  while (!stopped && guard < 40) {
    guard++;
    const dx = jake.x - sam.x, dy = jake.y - sam.y;
    const dist = Math.hypot(dx, dy) || 1;
    const nx = sam.x + Math.max(-1, Math.min(1, dx / dist));
    const ny = sam.y + Math.max(-1, Math.min(1, dy / dist));
    const moved = await step(sam, Math.round(nx * 2) / 2, Math.round(ny * 2) / 2);
    if (!moved) {
      const nudge = await step(sam, sam.x + (dx >= 0 ? 1 : -1), sam.y);
      if (!nudge) break;
    }
    stopped = sam.inbox.find((m) => m.t === 'music' && m.id === sam.me.id && m.stopped === 'room');
    await new Promise((r) => setTimeout(r, 90));
  }
  assert.ok(stopped, `music was not stopped on the walk back (sam ${sam.x},${sam.y} jake ${jake.x},${jake.y})\n${server.log()}`);
  assert.equal(stopped.by, 'Jake');
  assert.equal(stopped.music, null);
});
