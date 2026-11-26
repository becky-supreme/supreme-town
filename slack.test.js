import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createSlack, deviceSetCookie, identityFor, joinedText, leftText, plainName, readDeviceId, USER_SCOPES } from './slack.js';

const TOKEN = 'xoxp-user-token-do-not-log';
const SECRET = 'client-secret-do-not-log';
const BOT = 'xoxb-bot-token-do-not-log';
const REST = 'test-session-secret-test-session-secret';
const FULL = {
  SLACK_CLIENT_ID: '111.222',
  SLACK_CLIENT_SECRET: SECRET,
  SLACK_REDIRECT_URL: 'https://supreme-town-production.up.railway.app/api/slack/callback',
  SLACK_BOT_TOKEN: BOT,
  SLACK_AM_CHANNEL_ID: 'C0123456789',
};

function sealer(clock) {
  const sign = (s) => crypto.createHmac('sha256', REST).update(s).digest('base64url');
  return {
    seal(obj) {
      const body = Buffer.from(JSON.stringify(obj)).toString('base64url');
      return `${body}.${sign(body)}`;
    },
    unseal(token) {
      if (typeof token !== 'string') return null;
      const dot = token.lastIndexOf('.');
      if (dot <= 0) return null;
      const body = token.slice(0, dot);
      const mac = token.slice(dot + 1);
      const good = sign(body);
      if (mac.length !== good.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(good))) return null;
      const obj = JSON.parse(Buffer.from(body, 'base64url').toString());
      if (obj.exp != null && Number(obj.exp) < clock()) return null;
      return obj;
    },
  };
}

function harness(env = FULL) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slack-town-'));
  const logs = [];
  const calls = [];
  const timers = [];
  let clock = Date.now();
  let profile = { status_text: 'Lunch', status_emoji: ':sandwich:', status_expiration: 0 };
  let auth = { ok: true, user_id: 'U123' };
  let oauth = { ok: true, authed_user: { id: 'U123', access_token: TOKEN, scope: 'users.profile:read,users.profile:write', token_type: 'user' } };
  // null: channel setup fails closed, and posts stay on the account managers' channel.
  // An object turns on the private #supreme-town channel for these tests.
  let town = null;
  const keys = sealer(() => clock);
  async function fetchImpl(url, opts = {}) {
    let body = {};
    if (typeof opts.body === 'string') {
      try { body = JSON.parse(opts.body); } catch { body = Object.fromEntries(new URLSearchParams(opts.body)); }
    } else if (opts.body && typeof opts.body.entries === 'function') body = Object.fromEntries(opts.body.entries());
    const token = opts.headers?.authorization || '';
    calls.push({ href: String(url), token, body });
    const send = (data, status = 200) => ({ status, json: async () => data });
    const href = String(url);
    if (href.endsWith('/oauth.v2.access')) return send(oauth);
    if (href.endsWith('/auth.test')) return send(auth);
    if (href.endsWith('/users.profile.get')) return send({ ok: true, profile: { ...profile } });
    if (href.endsWith('/users.profile.set')) {
      profile = { ...profile, ...body.profile };
      return send({ ok: true, profile: { ...profile } });
    }
    if (href.endsWith('/chat.postMessage')) return send({ ok: true, ts: '1' });
    if (href.endsWith('/conversations.create')) {
      if (!town) return send({ ok: false, error: 'unknown_method' });
      if (town.fail === 'missing_scope') return send({ ok: false, error: 'missing_scope' });
      if (town.fail === 'name_taken' || town.created) return send({ ok: false, error: 'name_taken' });
      town.created = true;
      return send({ ok: true, channel: { id: town.id, name: 'supreme-town', is_private: true } });
    }
    if (href.endsWith('/conversations.list')) {
      if (!town?.listed) return send({ ok: false, error: 'missing_scope' });
      return send({ ok: true, channels: [{ id: town.id, name: 'supreme-town', is_private: true, is_archived: false }] });
    }
    if (href.endsWith('/conversations.info')) {
      if (!town || town.missing) return send({ ok: false, error: town?.missing ? 'channel_not_found' : 'unknown_method' });
      return send({ ok: true, channel: { id: town.id, name: 'supreme-town', is_private: true, is_archived: !!town.archived } });
    }
    if (href.endsWith('/conversations.invite')) {
      if (!town) return send({ ok: false, error: 'unknown_method' });
      if (town.inviteError) return send({ ok: false, error: town.inviteError });
      const user = String(body.users || '');
      if (town.members.has(user)) return send({ ok: false, error: 'already_in_channel' });
      town.members.add(user);
      return send({ ok: true, channel: { id: town.id } });
    }
    return send({ ok: false, error: 'unknown_method' });
  }
  function make(over = {}) {
    return createSlack({
      env: { ...env, ...over },
      dataDir: dir,
      fetch: fetchImpl,
      now: () => clock,
      setTimer(fn, ms) { const item = { fn, ms, cleared: false }; timers.push(item); return item; },
      clearTimer(item) { if (item) item.cleared = true; },
      setInterval: () => 0,
      clearInterval: () => {},
      log: (m) => logs.push(String(m)),
      secret: REST,
      seal: keys.seal,
      unseal: keys.unseal,
      graceMs: 90_000,
    });
  }
  return {
    dir, logs, calls, timers, keys, make,
    useTown(over = {}) {
      town = { id: 'G0TOWNCHAN1', members: new Set(), created: false, listed: false, fail: null, inviteError: null, ...over };
      return town;
    },
    now: () => clock,
    advance: (ms) => { clock += ms; },
    get profile() { return profile; },
    set profile(p) { profile = p; },
    set auth(a) { auth = a; },
    set oauth(o) { oauth = o; },
    posts: () => calls.filter((c) => c.href.endsWith('/chat.postMessage')).map((c) => c.body),
    invites: () => calls.filter((c) => c.href.endsWith('/conversations.invite')).map((c) => c.body),
    creates: () => calls.filter((c) => c.href.endsWith('/conversations.create')).map((c) => c.body),
    sets: () => calls.filter((c) => c.href.endsWith('/users.profile.set')).map((c) => c.body.profile),
    async fire() {
      const item = timers.find((t) => !t.cleared && !t.ran);
      if (!item) return false;
      item.ran = true;
      await item.fn();
      return true;
    },
  };
}

function clean(logs) {
  const text = logs.join('\n');
  assert.equal(text.includes(TOKEN), false);
  assert.equal(text.includes(SECRET), false);
  assert.equal(text.includes(BOT), false);
}

const jake = identityFor({ email: 'Jake@supremeopti.com' });

test('names stay plain text', () => {
  assert.equal(plainName('<!channel> @here'), '!channel here');
  assert.equal(joinedText('<!channel> @here'), '!channel here has joined Supreme Town');
  assert.equal(leftText('Jake'), 'Jake has left Supreme Town');
  assert.equal(joinedText(''), 'Someone has joined Supreme Town');
});

test('missing Slack settings skip the gate and do not call Slack', async () => {
  const h = harness({});
  const slack = h.make();
  assert.match(slack.warning(), /Connect Slack is off/);
  assert.match(slack.warning(), /Join and leave posts are off/);
  assert.equal(slack.gateRequired(), false);
  const door = await slack.doorState(jake);
  assert.deepEqual(door, { required: false, connected: false });
  assert.equal((await slack.admit(null)).ok, true);
  await slack.arrived({ identity: jake, name: 'Jake' });
  await slack.left({ identity: jake, name: 'Jake' });
  assert.equal(await h.fire(), true);
  assert.equal(h.calls.length, 0);
  clean(h.logs);
});

test('connect once, remember it, and do not log the token', async () => {
  const h = harness();
  const slack = h.make();
  const url = new URL(slack.authorizeUrl(jake));
  assert.equal(`${url.origin}${url.pathname}`, 'https://slack.com/oauth/v2/authorize');
  assert.equal(url.searchParams.get('user_scope'), USER_SCOPES);
  assert.equal(url.searchParams.get('scope'), null);
  assert.equal(url.searchParams.get('redirect_uri'), FULL.SLACK_REDIRECT_URL);
  assert.equal(url.searchParams.has('client_secret'), false);
  const state = url.searchParams.get('state');
  const wrong = await slack.finishConnect({ code: 'abc', state, identity: identityFor({ email: 'other@supremeopti.com' }) });
  assert.equal(wrong.ok, false);
  assert.equal(h.calls.some((c) => c.href.endsWith('/oauth.v2.access')), false);
  const good = await slack.finishConnect({ code: 'abc', state, identity: jake });
  assert.equal(good.ok, true);
  const raw = fs.readFileSync(path.join(h.dir, 'slack-connections.json'), 'utf8');
  assert.equal(raw.includes(TOKEN), false);
  assert.equal(raw.includes(SECRET), false);
  assert.equal((await slack.doorState(jake)).connected, true);
  const again = h.make();
  assert.equal((await again.doorState(jake)).connected, true);
  assert.equal(h.calls.some((c) => c.href.endsWith('/auth.test') && c.token === `Bearer ${TOKEN}`), true);
  clean(h.logs);
});

test('a revoked token is forgotten and blocks entry', async () => {
  const h = harness();
  const slack = h.make();
  const state = new URL(slack.authorizeUrl(jake)).searchParams.get('state');
  await slack.finishConnect({ code: 'abc', state, identity: jake });
  h.auth = { ok: false, error: 'token_revoked' };
  const again = h.make();
  const door = await again.doorState(jake);
  assert.equal(door.required, true);
  assert.equal(door.connected, false);
  assert.equal((await again.admit(jake)).ok, false);
  const raw = fs.readFileSync(path.join(h.dir, 'slack-connections.json'), 'utf8');
  assert.equal(raw.includes(TOKEN), false);
  assert.deepEqual(JSON.parse(raw), {});
  clean(h.logs);
});

test('join and leave posts are debounced, and the previous status is restored', async () => {
  const h = harness();
  const slack = h.make();
  const state = new URL(slack.authorizeUrl(jake)).searchParams.get('state');
  await slack.finishConnect({ code: 'abc', state, identity: jake });
  await slack.arrived({ identity: jake, name: 'Jake' });
  await slack.arrived({ identity: jake, name: 'Jake' }); // second tab
  assert.deepEqual(h.posts().map((p) => p.text), ['Jake has joined Supreme Town']);
  assert.equal(h.posts()[0].link_names, false);
  assert.equal(h.posts()[0].channel, 'C0123456789');
  assert.equal(h.posts()[0].token, undefined);
  assert.equal(h.calls.find((c) => c.href.endsWith('/chat.postMessage')).token, `Bearer ${BOT}`);
  assert.equal(h.sets()[0].status_text, 'In Supreme Town');
  assert.equal(h.sets()[0].status_emoji, ':office:');
  assert.equal(h.calls.find((c) => c.href.endsWith('/users.profile.set')).token, `Bearer ${TOKEN}`);
  slack.left({ identity: jake, name: 'Jake' });
  assert.equal(h.posts().length, 1); // one tab still inside
  slack.left({ identity: jake, name: 'Jake' });
  assert.equal(h.posts().length, 1);
  await slack.arrived({ identity: jake, name: 'Jake' }); // back before the grace period
  assert.deepEqual(h.posts().map((p) => p.text), ['Jake has joined Supreme Town']);
  slack.left({ identity: jake, name: 'Jake' });
  assert.equal(await h.fire(), true);
  assert.deepEqual(h.posts().map((p) => p.text), ['Jake has joined Supreme Town', 'Jake has left Supreme Town']);
  assert.equal(h.profile.status_text, 'Lunch');
  assert.equal(h.profile.status_emoji, ':sandwich:');
  clean(h.logs);
});

test('a status they set themselves is not cleared', async () => {
  const h = harness();
  const slack = h.make();
  const state = new URL(slack.authorizeUrl(jake)).searchParams.get('state');
  await slack.finishConnect({ code: 'abc', state, identity: jake });
  await slack.arrived({ identity: jake, name: '<!here> Jake' });
  assert.equal(h.posts()[0].text, '!here Jake has joined Supreme Town');
  h.profile = { status_text: 'Focusing', status_emoji: ':headphones:', status_expiration: 0 };
  slack.left({ identity: jake, name: 'Jake' });
  assert.equal(await h.fire(), true);
  assert.equal(h.profile.status_text, 'Focusing');
  assert.equal(h.sets().at(-1).status_text, 'In Supreme Town');
  clean(h.logs);
});

test('a restart does not post joined again', async () => {
  const h = harness();
  const first = h.make();
  const state = new URL(first.authorizeUrl(jake)).searchParams.get('state');
  await first.finishConnect({ code: 'abc', state, identity: jake });
  await first.arrived({ identity: jake, name: 'Jake' });
  first.pauseForRestart();
  const second = h.make();
  await second.arrived({ identity: jake, name: 'Jake' });
  assert.deepEqual(h.posts().map((p) => p.text), ['Jake has joined Supreme Town']);
  second.left({ identity: jake, name: 'Jake' });
  assert.equal(await h.fire(), true);
  assert.deepEqual(h.posts().map((p) => p.text), ['Jake has joined Supreme Town', 'Jake has left Supreme Town']);
  clean(h.logs);
});

test('oauth failure is logged as a code, not a token', async () => {
  const h = harness();
  h.oauth = { ok: false, error: 'invalid_client', access_token: TOKEN };
  const slack = h.make();
  const state = new URL(slack.authorizeUrl(jake)).searchParams.get('state');
  const result = await slack.finishConnect({ code: 'abc', state, identity: jake });
  assert.equal(result.ok, false);
  assert.ok(h.logs.includes('Slack connection failed (invalid_client)'));
  clean(h.logs);
});

test('device cookie is the identity when there is no account', () => {
  const keys = sealer(() => Date.now());
  const did = crypto.randomUUID();
  const cookie = deviceSetCookie(did, keys.seal, true);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Max-Age=34560000/);
  assert.match(cookie, /Secure/);
  assert.equal(readDeviceId(cookie, keys.unseal), did);
  assert.equal(identityFor({ deviceId: did }), `device:${did}`);
  assert.equal(readDeviceId('hq_device=tampered', keys.unseal), null);
});

test('a private supreme-town channel gets the posts, and creating it twice reuses the saved id', async () => {
  const h = harness();
  const town = h.useTown();
  const first = h.make();
  const state = new URL(first.authorizeUrl(jake)).searchParams.get('state');
  await first.finishConnect({ code: 'abc', state, identity: jake });
  assert.equal(h.creates().length, 1);
  assert.equal(h.creates()[0].name, 'supreme-town');
  assert.equal(h.creates()[0].is_private, true);
  assert.deepEqual(h.invites(), [{ channel: town.id, users: 'U123' }]);
  await first.arrived({ identity: jake, name: 'Jake' });
  await first.arrived({ identity: jake, name: 'Jake' });
  assert.equal(h.invites().length, 1); // already invited in this run
  assert.deepEqual(h.posts().map((p) => p.channel), [town.id]);
  const saved = JSON.parse(fs.readFileSync(path.join(h.dir, 'slack-town-channel.json'), 'utf8'));
  assert.equal(saved.id, town.id);
  assert.equal(JSON.stringify(saved).includes(BOT), false);
  first.pauseForRestart();
  const second = h.make();
  await second.arrived({ identity: jake, name: 'Jake' });
  assert.equal(h.creates().length, 1); // saved id, no second create
  assert.equal(h.invites().length, 2);
  assert.equal(h.invites()[1].users, 'U123');
  assert.equal(town.members.size, 1);
  assert.deepEqual(h.posts().map((p) => p.text), ['Jake has joined Supreme Town']);
  clean(h.logs);
});

test('an existing private channel is found, and already_in_channel is not an error', async () => {
  const h = harness();
  const town = h.useTown({ fail: 'name_taken', listed: true });
  town.members.add('U123');
  const slack = h.make();
  const state = new URL(slack.authorizeUrl(jake)).searchParams.get('state');
  await slack.finishConnect({ code: 'abc', state, identity: jake });
  assert.equal(h.creates()[0].is_private, true);
  assert.equal(h.calls.some((c) => c.href.endsWith('/conversations.list')), true);
  assert.equal(h.creates().length, 1);
  const saved = JSON.parse(fs.readFileSync(path.join(h.dir, 'slack-town-channel.json'), 'utf8'));
  assert.equal(saved.id, town.id);
  assert.equal(h.invites().length, 1);
  assert.equal(town.members.size, 1);
  await slack.arrived({ identity: jake, name: 'Jake' });
  assert.equal(h.posts()[0].channel, town.id);
  assert.equal(h.logs.some((l) => /token|xox[bp]-/.test(l)), false);
  clean(h.logs);
});

test('startup invites everyone already connected, and a missing scope is retried next start', async () => {
  const h = harness();
  const town = h.useTown();
  const first = h.make();
  const state = new URL(first.authorizeUrl(jake)).searchParams.get('state');
  await first.finishConnect({ code: 'abc', state, identity: jake });
  first.pauseForRestart();
  town.members.clear(); // the saved connection is what the next start knows, not Slack's memory
  const second = h.make();
  await second.arrived({ identity: jake, name: 'Bea' });
  const backfill = h.invites().filter((c) => c.users === 'U123');
  assert.ok(backfill.length >= 2); // connect, then backfill on the next start
  assert.equal(h.posts().at(-1).channel, town.id);

  const blocked = harness();
  blocked.useTown({ fail: 'missing_scope' });
  const slack = blocked.make();
  const again = new URL(slack.authorizeUrl(jake)).searchParams.get('state');
  await slack.finishConnect({ code: 'abc', state: again, identity: jake });
  await slack.arrived({ identity: jake, name: 'Jake' });
  assert.ok(blocked.logs.some((l) => l.includes('missing_scope') && l.includes('groups:write')));
  assert.equal(blocked.posts()[0].channel, 'C0123456789');
  assert.equal(blocked.invites().length, 0);
  assert.equal(fs.existsSync(path.join(blocked.dir, 'slack-town-channel.json')), false);
  const retry = blocked.make();
  await retry.arrived({ identity: jake, name: 'Jake' });
  assert.equal(blocked.creates().length, 2); // next start tries again
  clean(h.logs);
  clean(blocked.logs);
});

test('SLACK_TOWN_CHANNEL_ID is used as given and is not created again', async () => {
  const h = harness({ ...FULL, SLACK_TOWN_CHANNEL_ID: 'C0TOWNCHAN1' });
  h.useTown();
  const slack = h.make();
  const state = new URL(slack.authorizeUrl(jake)).searchParams.get('state');
  await slack.finishConnect({ code: 'abc', state, identity: jake });
  await slack.arrived({ identity: jake, name: 'Jake' });
  assert.equal(h.creates().length, 0);
  assert.equal(h.invites()[0].channel, 'C0TOWNCHAN1');
  assert.equal(h.posts()[0].channel, 'C0TOWNCHAN1');
  clean(h.logs);
});

test('the door tells people to connect Slack before they can enter', () => {
  const html = fs.readFileSync(new URL('./public/index.html', import.meta.url), 'utf8');
  const js = fs.readFileSync(new URL('./public/main.js', import.meta.url), 'utf8');
  assert.match(html, /id="joinGo"[^>]*disabled/);
  assert.match(html, /Connect Slack to enter/);
  assert.match(js, /code === 4403/);
  assert.match(js, /go\.disabled = true/);
});
