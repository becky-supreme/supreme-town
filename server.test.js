// The running server, with Slack either unconfigured or configured and no tokens.
// Proves the gate is real: missing settings still let someone in, and a configured
// app refuses the websocket until that person has connected.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';

function start(port, extra) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'town-server-'));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.dirname(new URL(import.meta.url).pathname),
    env: { PATH: process.env.PATH || '', HOME: process.env.HOME || '', PORT: String(port), DATA_DIR: dir, ...extra },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`server did not start\n${out}`)), 20000);
    const on = (buf) => {
      out += buf.toString();
      if (out.includes('Supreme Town is open') && (out.includes('Connect Slack is off') || out.includes('Slack is on') || out.includes('Join and leave posts are off'))) {
      clearTimeout(timer);
      resolve(out);
    }
    };
    child.stdout.on('data', on);
    child.stderr.on('data', on);
    child.on('exit', (code) => reject(new Error(`server exited ${code}\n${out}`)));
  });
  return {
    child, dir, ready,
    output: () => out,
    stop() {
      return new Promise((resolve) => {
        if (child.exitCode != null || child.signalCode) return resolve();
        child.once('exit', () => resolve());
        child.kill('SIGTERM');
      });
    },
  };
}

function join(port, name = 'Jake') {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    let settled = false;
    const done = (result) => {
      if (settled) return;
      settled = true;
      try { ws.close(); } catch { /* already closing */ }
      resolve(result);
    };
    const timer = setTimeout(() => done({ type: 'timeout' }), 5000);
    ws.on('open', () => ws.send(JSON.stringify({ t: 'join', name, look: {} })));
    ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.t === 'init') { clearTimeout(timer); done({ type: 'init', name: m.you.name }); }
    });
    ws.on('close', (code) => { clearTimeout(timer); done({ type: 'close', code }); });
    ws.on('error', () => { clearTimeout(timer); done({ type: 'error' }); });
  });
}

test('entry gate follows the Slack settings', async () => {
  const plain = start(38921, {});
  try {
    const log = await plain.ready;
    assert.match(log, /Connect Slack is off/);
    const door = await fetch('http://127.0.0.1:38921/api/slack').then((r) => r.json());
    assert.deepEqual(door, { required: false, connected: false });
    const home = await fetch('http://127.0.0.1:38921/api/slack/connect', { redirect: 'manual' });
    assert.equal(home.status, 302);
    assert.equal(home.headers.get('location'), '/');
    const entered = await join(38921);
    assert.deepEqual(entered, { type: 'init', name: 'Jake' });
  } finally {
    await plain.stop();
  }

  const gated = start(38922, {
    SLACK_CLIENT_ID: '111.222',
    SLACK_CLIENT_SECRET: 'test-secret',
    SLACK_REDIRECT_URL: 'https://supreme-town-production.up.railway.app/api/slack/callback',
    SLACK_BOT_TOKEN: 'xoxb-test',
    SLACK_AM_CHANNEL_ID: 'C0123456789',
  });
  try {
    const log = await gated.ready;
    assert.match(log, /Slack is on/);
    assert.equal(log.includes('xoxb-test'), false);
    assert.equal(log.includes('test-secret'), false);
    const door = await fetch('http://127.0.0.1:38922/api/slack').then((r) => r.json());
    assert.deepEqual(door, { required: true, connected: false });
    const connect = await fetch('http://127.0.0.1:38922/api/slack/connect', { redirect: 'manual' });
    assert.equal(connect.status, 302);
    const loc = new URL(connect.headers.get('location'));
    assert.equal(`${loc.origin}${loc.pathname}`, 'https://slack.com/oauth/v2/authorize');
    assert.equal(loc.searchParams.get('user_scope'), 'users.profile:read,users.profile:write');
    assert.equal(loc.searchParams.get('scope'), null);
    assert.equal(loc.searchParams.has('client_secret'), false);
    assert.match(connect.headers.get('set-cookie') || '', /hq_device=/);
    const denied = await fetch('http://127.0.0.1:38922/api/slack/callback?error=access_denied', { redirect: 'manual' });
    assert.equal(denied.status, 302);
    assert.equal(denied.headers.get('location'), '/?slack=denied');
    const blocked = await join(38922);
    assert.deepEqual(blocked, { type: 'close', code: 4403 });
  } finally {
    await gated.stop();
  }
});

test('confetti is shown to someone nearby and then waits', async () => {
  const srv = start(38923, {});
  const sockets = [];
  try {
    await srv.ready;
    const enter = (name) => new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:38923`);
      sockets.push(ws);
      const inbox = [];
      const timer = setTimeout(() => reject(new Error('no init')), 5000);
      ws.on('message', (raw) => {
        const m = JSON.parse(raw.toString());
        inbox.push(m);
        if (m.t === 'init') { clearTimeout(timer); resolve({ ws, inbox, id: m.you.id }); }
      });
      ws.on('error', reject);
      ws.on('open', () => ws.send(JSON.stringify({ t: 'join', name, look: {} })));
    });
    const ada = await enter('Ada');
    const bea = await enter('Bea');
    const waitFor = (box, pred, ms = 2000) => new Promise((resolve) => {
      const start = box.inbox.length;
      let done = false;
      const finish = (value) => { if (done) return; done = true; clearTimeout(timer); resolve(value); };
      const timer = setTimeout(() => finish(null), ms);
      const tick = () => {
        if (done) return;
        const hit = box.inbox.slice(start).find(pred);
        if (hit) { finish(hit); return; }
        setTimeout(tick, 20);
      };
      tick();
    });
    ada.ws.send(JSON.stringify({ t: 'confetti', to: bea.id }));
    const first = await waitFor(bea, (m) => m.t === 'confetti');
    assert.equal(first.from, ada.id);
    assert.equal(first.to, bea.id);
    assert.equal(first.name, 'Ada');
    assert.equal(first.toName, 'Bea');
    ada.ws.send(JSON.stringify({ t: 'confetti', to: bea.id }));
    const extra = await waitFor(bea, (m) => m.t === 'confetti' && m.at !== first.at, 400);
    assert.equal(extra, null);
    assert.equal(ada.inbox.some((m) => m.t === 'confetti'), false);
  } finally {
    for (const ws of sockets) { try { ws.close(); } catch { /* already closing */ } }
    await srv.stop();
  }
});
