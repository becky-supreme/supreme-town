// Slack for Supreme Town.
//
// Two separate features, each a no-op when its settings are missing:
//   - Connect Slack (Sign in with Slack). Each person authorizes once. Their
//     user token is encrypted and saved in the data directory, which on Railway
//     is the volume, so it survives restarts and redeploys. While they are in
//     the town their status says "In Supreme Town". It is put back when they
//     leave, and only if it is still the status we set.
//   - A plain message in the account managers' channel when someone joins or
//     leaves. A refresh, a second tab, or a dropped connection inside the grace
//     period does not post again.
//
// Tokens and the client secret are never written to the log.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const STATUS_TEXT = 'In Supreme Town';
export const STATUS_EMOJI = ':office:';
export const USER_SCOPES = 'users.profile:read,users.profile:write';
export const DEVICE_MAX_AGE = 400 * 24 * 60 * 60;
const STATUS_TTL_MS = 30 * 60 * 1000;
const REFRESH_MS = 10 * 60 * 1000;
const CHECK_MS = 10 * 60 * 1000;
const DEAD_TOKEN = new Set(['invalid_auth', 'account_inactive', 'token_revoked', 'token_expired', 'not_authed', 'invalid_token', 'missing_scope']);

const trim = (v) => String(v ?? '').trim();

export function plainName(name) {
  const s = String(name ?? '')
    .replace(/[\u0000-\u001f<>@]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 24);
  return s || 'Someone';
}
export function joinedText(name) {
  return `${plainName(name)} has joined Supreme Town`;
}
export function leftText(name) {
  return `${plainName(name)} has left Supreme Town`;
}

export function identityFor({ email, deviceId } = {}) {
  if (typeof email === 'string' && /^[^\s@]+@[^\s@]+$/.test(email)) return `email:${email.toLowerCase()}`;
  if (typeof deviceId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(deviceId)) return `device:${deviceId.toLowerCase()}`;
  return null;
}

function validIdentity(id) {
  if (typeof id !== 'string') return false;
  if (id.startsWith('email:')) return identityFor({ email: id.slice('email:'.length) }) === id;
  if (id.startsWith('device:')) return identityFor({ deviceId: id.slice('device:'.length) }) === id;
  return /^name:.{1,24}$/.test(id);
}

export function presenceKey(identity, name) {
  if (identity && validIdentity(identity)) return identity;
  return `name:${plainName(name).toLowerCase()}`;
}

export function deviceSetCookie(did, seal, secure) {
  const value = seal({ purpose: 'device', did });
  return `hq_device=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${DEVICE_MAX_AGE}${secure ? '; Secure' : ''}`;
}

export function readDeviceId(cookieHeader, unseal) {
  const m = /(?:^|;\s*)hq_device=([^;]+)/.exec(cookieHeader || '');
  if (!m) return null;
  let raw = m[1];
  try { raw = decodeURIComponent(raw); } catch { return null; }
  const obj = typeof unseal === 'function' ? unseal(raw) : null;
  if (!obj || obj.purpose !== 'device') return null;
  return identityFor({ deviceId: obj.did }) ? obj.did.toLowerCase() : null;
}

function validUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

function validChannel(value) {
  return /^[CGD][A-Z0-9]{8,}$/.test(value);
}

function defaultTimer(fn, ms) {
  const id = setTimeout(fn, ms);
  if (typeof id.unref === 'function') id.unref();
  return id;
}
function defaultInterval(fn, ms) {
  const id = setInterval(fn, ms);
  if (typeof id.unref === 'function') id.unref();
  return id;
}

export function createSlack({
  env = process.env,
  dataDir,
  fetch = globalThis.fetch,
  now = () => Date.now(),
  setTimer = defaultTimer,
  clearTimer = clearTimeout,
  setInterval: setInt = defaultInterval,
  clearInterval: clearInt = clearInterval,
  log = console.warn,
  secret = '',
  seal = (obj) => JSON.stringify(obj),
  unseal = () => null,
  graceMs,
} = {}) {
  const clientId = trim(env.SLACK_CLIENT_ID);
  const clientSecret = trim(env.SLACK_CLIENT_SECRET);
  const redirectUrl = trim(env.SLACK_REDIRECT_URL);
  const botToken = trim(env.SLACK_BOT_TOKEN);
  const channelId = trim(env.SLACK_AM_CHANNEL_ID);
  const grace = Number.isFinite(graceMs) && graceMs >= 0
    ? graceMs
    : (Number(env.SLACK_LEAVE_GRACE_MS) >= 5000 && Number(env.SLACK_LEAVE_GRACE_MS) <= 600_000
      ? Number(env.SLACK_LEAVE_GRACE_MS)
      : 90_000);

  const oauthReady = !!(clientId && clientSecret && redirectUrl && validUrl(redirectUrl));
  const postsReady = !!(botToken && channelId && validChannel(channelId));
  const key = crypto.createHash('sha256').update(`supreme-town-slack:${secret || 'missing'}`).digest();
  const connFile = dataDir ? path.join(dataDir, 'slack-connections.json') : null;
  const hereFile = dataDir ? path.join(dataDir, 'slack-presence.json') : null;

  const connections = new Map(); // identity -> { token, slackUserId, scopes, connectedAt, previousStatus }
  const visits = new Map(); // identity -> { key, count, name, announced, holding, yielded, leaveTimer, onDead }
  const checked = new Map(); // identity -> timestamp of a good auth.test
  let interval = null;

  function note(message) {
    log(String(message));
  }
  function slackError(prefix, error) {
    const code = typeof error === 'string' && /^[a-z0-9_]{1,64}$/i.test(error) ? error : 'unknown';
    note(`${prefix} (${code})`);
  }
  function isDead(data) {
    return !!data && data.ok === false && DEAD_TOKEN.has(data.error);
  }

  function encrypt(plain) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const data = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, data]).toString('base64url');
  }
  function decrypt(payload) {
    const buf = Buffer.from(String(payload), 'base64url');
    if (buf.length < 29) throw new Error('short');
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const data = buf.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  }

  function writeJson(file, obj) {
    if (!file) return;
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(obj), { mode: 0o600 });
      fs.renameSync(tmp, file);
      try { fs.chmodSync(file, 0o600); } catch { /* some volumes ignore this */ }
    } catch (err) {
      note(`Could not save Slack data (${err && err.code ? err.code : 'error'}).`);
    }
  }
  function readJson(file) {
    if (!file) return {};
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; }
  }

  function cleanStatus(s) {
    if (!s || typeof s !== 'object') return null;
    const text = String(s.status_text ?? '').replace(/[\u0000-\u001f]/g, '').slice(0, 100);
    const emoji = typeof s.status_emoji === 'string' ? s.status_emoji.replace(/[\u0000-\u001f<>]/g, '').slice(0, 100) : '';
    const expiration = Number.isFinite(+s.status_expiration) ? Math.max(0, Math.floor(+s.status_expiration)) : 0;
    return { status_text: text, status_emoji: emoji, status_expiration: expiration };
  }
  function isOurs(s) {
    return !!s && s.status_text === STATUS_TEXT && s.status_emoji === STATUS_EMOJI;
  }
  function ours() {
    return { status_text: STATUS_TEXT, status_emoji: STATUS_EMOJI, status_expiration: Math.floor(now() / 1000) + Math.floor(STATUS_TTL_MS / 1000) };
  }

  function saveConnections() {
    const out = {};
    for (const [id, row] of connections) {
      out[id] = {
        token: encrypt(row.token),
        slackUserId: row.slackUserId,
        scopes: row.scopes,
        connectedAt: row.connectedAt,
        previousStatus: row.previousStatus,
      };
    }
    writeJson(connFile, out);
  }
  function savePresence() {
    const out = {};
    for (const rec of visits.values()) {
      if (!rec.announced && rec.count < 1 && !rec.leaveTimer) continue;
      out[rec.key] = { name: rec.name, inTown: true, announced: !!rec.announced, lastSeen: now() };
    }
    writeJson(hereFile, out);
  }

  function load() {
    const saved = readJson(connFile);
    for (const [id, row] of Object.entries(saved && typeof saved === 'object' ? saved : {})) {
      if (!validIdentity(id) || !row || typeof row.token !== 'string') continue;
      try {
        const token = decrypt(row.token);
        if (!token) continue;
        connections.set(id, {
          token,
          slackUserId: typeof row.slackUserId === 'string' ? row.slackUserId : '',
          scopes: typeof row.scopes === 'string' ? row.scopes : '',
          connectedAt: Number(row.connectedAt) || 0,
          previousStatus: cleanStatus(row.previousStatus),
        });
      } catch {
        note('A saved Slack connection could not be read and will need connecting again.');
      }
    }
    const here = readJson(hereFile);
    for (const [id, row] of Object.entries(here && typeof here === 'object' ? here : {})) {
      if (!row || row.inTown !== true || !validIdentity(id)) continue;
      const rec = visit(id, row.name);
      // A redeploy kills the process before the grace timer can say they left.
      // Keep the saved "in town" flag and start the wait again, so people
      // reconnecting after a new version do not post a second "joined".
      rec.announced = !!row.announced;
      rec.holding = !!row.announced;
      rec.statusTouchedAt = now();
      rec.leaveTimer = setTimer(() => confirmLeave(id).catch(() => note('Slack leave failed (unknown)')), grace);
    }
  }

  function visit(key, name) {
    let rec = visits.get(key);
    if (!rec) {
      rec = { key, count: 0, name: plainName(name), announced: false, holding: false, yielded: false, leaveTimer: null, onDead: null, epoch: 0, statusTouchedAt: 0, closing: false, posting: false };
      visits.set(key, rec);
    }
    return rec;
  }

  function forget(identity) {
    if (!identity) return;
    connections.delete(identity);
    checked.delete(identity);
    saveConnections();
  }

  async function slackApi(token, method, { http = 'POST', json, form } = {}) {
    const headers = {};
    if (token) headers.authorization = `Bearer ${token}`;
    let body;
    if (json !== undefined) {
      headers['content-type'] = 'application/json; charset=utf-8';
      body = JSON.stringify(json);
    } else if (form) {
      headers['content-type'] = 'application/x-www-form-urlencoded';
      body = new URLSearchParams(form);
    }
    let res;
    try {
      res = await fetch(`https://slack.com/api/${method}`, { method: http, headers, body });
    } catch {
      return { ok: false, error: 'network' };
    }
    if (res && res.status === 429) return { ok: false, error: 'ratelimited' };
    let data;
    try { data = await res.json(); } catch { return { ok: false, error: 'bad_response' }; }
    if (!data || typeof data !== 'object') return { ok: false, error: 'bad_response' };
    if (data.ok === false && typeof data.error !== 'string') return { ok: false, error: 'slack_error' };
    return data;
  }

  async function exchange(code) {
    let res;
    try {
      res = await fetch('https://slack.com/api/oauth.v2.access', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, code, redirect_uri: redirectUrl }),
      });
    } catch {
      return { ok: false, error: 'network' };
    }
    let data;
    try { data = await res.json(); } catch { return { ok: false, error: 'bad_response' }; }
    if (!data || typeof data !== 'object') return { ok: false, error: 'bad_response' };
    if (data.ok === false && typeof data.error !== 'string') return { ok: false, error: 'slack_error' };
    return data;
  }

  function warning() {
    const lines = [];
    if (!oauthReady) {
      const missing = ['SLACK_CLIENT_ID', 'SLACK_CLIENT_SECRET', 'SLACK_REDIRECT_URL'].filter((k) => !trim(env[k]));
      lines.push(missing.length
        ? `Connect Slack is off because ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} not set. People can enter the town without Slack, and statuses are not changed.`
        : 'Connect Slack is off because SLACK_REDIRECT_URL is not a valid http(s) URL. People can enter the town without Slack, and statuses are not changed.');
    }
    if (!postsReady) {
      const missing = ['SLACK_BOT_TOKEN', 'SLACK_AM_CHANNEL_ID'].filter((k) => !trim(env[k]));
      lines.push(missing.length
        ? `Join and leave posts are off because ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} not set.`
        : 'Join and leave posts are off because SLACK_AM_CHANNEL_ID does not look like a Slack channel id.');
    }
    return lines.join(' ');
  }

  function gateRequired() { return oauthReady; }
  function announceConfigured() { return postsReady; }

  function authorizeUrl(identity) {
    if (!oauthReady || !identity || !validIdentity(identity)) return null;
    const state = seal({ purpose: 'slack-oauth', identity, exp: now() + 10 * 60 * 1000 });
    const u = new URL('https://slack.com/oauth/v2/authorize');
    u.searchParams.set('client_id', clientId);
    u.searchParams.set('user_scope', USER_SCOPES);
    u.searchParams.set('redirect_uri', redirectUrl);
    u.searchParams.set('state', state);
    return u.toString();
  }

  function scopesOf(scope) {
    return new Set(String(scope || '').split(/[\s,]+/).filter(Boolean));
  }

  async function finishConnect({ code, state, identity }) {
    if (!oauthReady) return { ok: false, reason: 'unconfigured' };
    const parsed = unseal(state);
    if (!parsed || parsed.purpose !== 'slack-oauth' || parsed.identity !== identity || !validIdentity(identity)) {
      return { ok: false, reason: 'state' };
    }
    if (typeof code !== 'string' || !code || code.length > 200) return { ok: false, reason: 'code' };
    const data = await exchange(code);
    if (!data.ok) {
      slackError('Slack connection failed', data.error);
      return { ok: false, reason: 'oauth' };
    }
    const user = data.authed_user || {};
    const token = user.access_token;
    const slackUserId = user.id;
    const scopes = scopesOf(user.scope);
    if (typeof token !== 'string' || !token.startsWith('xoxp-') || typeof slackUserId !== 'string' || !slackUserId) {
      note('Slack connection failed (no user token)');
      return { ok: false, reason: 'oauth' };
    }
    if (!scopes.has('users.profile:write') || !scopes.has('users.profile:read')) {
      note('Slack connection failed (missing profile scope)');
      return { ok: false, reason: 'scope' };
    }
    connections.set(identity, {
      token,
      slackUserId,
      scopes: [...scopes].sort().join(','),
      connectedAt: now(),
      previousStatus: connections.get(identity)?.previousStatus || null,
    });
    checked.set(identity, now());
    saveConnections();
    return { ok: true };
  }

  async function admit(identity) {
    if (!oauthReady) return { ok: true, skipped: true };
    if (!identity || !validIdentity(identity) || identity.startsWith('name:')) return { ok: false, reason: 'connect' };
    const conn = connections.get(identity);
    if (!conn?.token) return { ok: false, reason: 'connect' };
    const seen = checked.get(identity);
    if (seen && now() - seen < CHECK_MS) return { ok: true };
    const data = await slackApi(conn.token, 'auth.test', { json: {} });
    if (data.ok) {
      checked.set(identity, now());
      return { ok: true };
    }
    if (isDead(data)) {
      forget(identity);
      return { ok: false, reason: 'revoked' };
    }
    slackError('Slack token check failed', data.error);
    return { ok: true, unverified: true };
  }

  async function doorState(identity) {
    if (!oauthReady) return { required: false, connected: false };
    const result = await admit(identity);
    return { required: true, connected: !!(result.ok && !result.skipped && connections.get(identity)?.token) };
  }

  async function post(text) {
    if (!postsReady) return true;
    const data = await slackApi(botToken, 'chat.postMessage', {
      json: { channel: channelId, text, link_names: false, unfurl_links: false, unfurl_media: false },
    });
    if (!data.ok) {
      slackError('Slack room post failed', data.error);
      return false;
    }
    return true;
  }

  async function writeStatus(identity, status, onDead) {
    const conn = connections.get(identity);
    if (!conn?.token) return false;
    const data = await slackApi(conn.token, 'users.profile.set', { json: { profile: status } });
    if (isDead(data)) {
      forget(identity);
      if (onDead) onDead();
      return false;
    }
    if (!data.ok) {
      slackError('Slack status update failed', data.error);
      return false;
    }
    return true;
  }

  async function readStatus(identity, onDead) {
    const conn = connections.get(identity);
    if (!conn?.token) return null;
    const data = await slackApi(conn.token, 'users.profile.get', { http: 'GET' });
    if (isDead(data)) {
      forget(identity);
      if (onDead) onDead();
      return { dead: true };
    }
    if (!data.ok) {
      slackError('Slack status read failed', data.error);
      return null;
    }
    return cleanStatus(data.profile) || { status_text: '', status_emoji: '', status_expiration: 0 };
  }

  // Read the current status before writing. A status we did not set is never overwritten
  // on the way out, and on the way in we keep a copy so it can be put back.
  async function ensureStatus(rec, takeOver) {
    if (!oauthReady || rec.key.startsWith('name:')) return;
    const current = await readStatus(rec.key, rec.onDead);
    if (!current || current.dead) return;
    if (isOurs(current)) {
      const ok = await writeStatus(rec.key, ours(), rec.onDead);
      if (ok) { rec.holding = true; rec.statusTouchedAt = now(); }
      return;
    }
    if (!takeOver || rec.yielded) {
      rec.yielded = true;
      rec.holding = false;
      return;
    }
    const conn = connections.get(rec.key);
    if (!conn) return;
    conn.previousStatus = current;
    saveConnections();
    const ok = await writeStatus(rec.key, ours(), rec.onDead);
    if (ok) { rec.holding = true; rec.statusTouchedAt = now(); }
  }

  async function clearStatus(rec) {
    if (!oauthReady || rec.key.startsWith('name:')) return;
    const current = await readStatus(rec.key, null);
    if (!current || current.dead) return;
    const conn = connections.get(rec.key);
    if (!isOurs(current)) {
      if (conn) { conn.previousStatus = null; saveConnections(); }
      return;
    }
    const prev = conn?.previousStatus && !isOurs(conn.previousStatus) ? conn.previousStatus : null;
    if (conn) { conn.previousStatus = null; saveConnections(); }
    await writeStatus(rec.key, prev || { status_text: '', status_emoji: '', status_expiration: 0 }, null);
  }

  async function confirmLeave(key) {
    const rec = visits.get(key);
    if (!rec || rec.count > 0 || rec.closing) return;
    const epoch = rec.epoch;
    rec.closing = true;
    rec.leaveTimer = null;
    let sentLeave = false;
    if (rec.announced && postsReady) sentLeave = await post(leftText(rec.name));
    const cameBack = () => visits.get(key) !== rec || rec.epoch !== epoch || rec.count > 0;
    if (cameBack()) {
      rec.closing = false;
      // The leave message already went out and they are here again, so correct it.
      if (sentLeave && rec.count > 0 && postsReady) await post(joinedText(rec.name));
      return;
    }
    rec.announced = false;
    rec.holding = false;
    await clearStatus(rec);
    if (cameBack()) {
      rec.closing = false;
      if (rec.count > 0) await ensureStatus(rec, true);
      return;
    }
    rec.closing = false;
    visits.delete(key);
    savePresence();
  }

  async function arrived({ identity, name, onDead }) {
    const key = presenceKey(identity, name);
    const rec = visit(key, name);
    rec.name = plainName(name);
    rec.onDead = onDead || rec.onDead;
    rec.epoch += 1;
    if (rec.leaveTimer) {
      clearTimer(rec.leaveTimer);
      rec.leaveTimer = null;
    }
    rec.closing = false;
    rec.count += 1;
    if (rec.count > 1) { savePresence(); return; }
    if (!rec.announced && !rec.posting) {
      rec.posting = true;
      const posted = postsReady ? await post(joinedText(rec.name)) : true;
      rec.posting = false;
      if (posted) rec.announced = true;
      savePresence();
      // They dropped while the post was in flight. The grace timer owns the leave.
      if (rec.count < 1) return;
      await ensureStatus(rec, true);
      return;
    }
    savePresence();
    if (rec.count < 1) return;
    // Back from a refresh or a restart. Don't post again. Touch the status
    // only when the last update is old, so a flap does not call Slack.
    if (now() - (rec.statusTouchedAt || 0) >= REFRESH_MS) await ensureStatus(rec, false);
  }

  function left({ identity, name }) {
    const key = presenceKey(identity, name);
    const rec = visits.get(key);
    if (!rec) return;
    rec.count = Math.max(0, rec.count - 1);
    rec.name = plainName(name || rec.name);
    if (rec.count > 0 || rec.closing) return;
    if (rec.leaveTimer) return;
    rec.leaveTimer = setTimer(() => confirmLeave(key).catch(() => note('Slack leave failed (unknown)')), grace);
    savePresence();
  }

  async function refresh() {
    for (const rec of [...visits.values()]) {
      if (rec.count < 1 || rec.leaveTimer) continue;
      if (!rec.announced && postsReady) {
        const posted = await post(joinedText(rec.name));
        if (posted) { rec.announced = true; savePresence(); }
      }
      if (!rec.yielded) await ensureStatus(rec, !rec.holding);
    }
  }

  load();
  interval = setInt(() => { refresh().catch(() => note('Slack status refresh failed (unknown)')); }, REFRESH_MS);

  function pauseForRestart() {
    if (interval) clearInt(interval);
    interval = null;
    for (const rec of visits.values()) {
      if (rec.leaveTimer) clearTimer(rec.leaveTimer);
      rec.leaveTimer = null;
    }
    savePresence();
  }

  return {
    grace,
    warning,
    gateRequired,
    announceConfigured,
    authorizeUrl,
    finishConnect,
    admit,
    doorState,
    arrived,
    left,
    refresh,
    pauseForRestart,
    hasConnection: (identity) => !!connections.get(identity)?.token,
  };
}
