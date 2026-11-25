// Sign in with Google, limited to one email domain, plus saved characters.
// With no GOOGLE_CLIENT_ID set, the office runs without logins (for use on
// your own computer) and people just type a name.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { OAuth2Client } from 'google-auth-library';

export const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
export const DOMAIN = (process.env.ALLOWED_EMAIL_DOMAIN || 'supremeopti.com').toLowerCase();
export const authRequired = () => !!CLIENT_ID;

// The key that signs login cookies. Set SESSION_SECRET to choose it; otherwise one is
// made the first time the server starts and kept in the data folder, so people stay
// signed in across restarts and redeploys (on Railway, the data folder is the volume).
function sessionSecret() {
  if (process.env.SESSION_SECRET) return { value: process.env.SESSION_SECRET, temporary: false };
  const dir = process.env.DATA_DIR || path.join(path.dirname(new URL(import.meta.url).pathname), 'data');
  const file = path.join(dir, 'session-secret');
  try {
    const saved = fs.readFileSync(file, 'utf8').trim();
    if (saved.length >= 32) return { value: saved, temporary: false };
  } catch { /* first start */ }
  const made = crypto.randomBytes(32).toString('hex');
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, made, { mode: 0o600 });
    return { value: made, temporary: false };
  } catch {
    return { value: made, temporary: true }; // couldn't save it: logins last until the next restart
  }
}
const { value: SECRET, temporary } = sessionSecret();
export const secretIsTemporary = temporary;
const DAYS = 30;
const google = CLIENT_ID ? new OAuth2Client(CLIENT_ID) : null;

const sign = (s) => crypto.createHmac('sha256', SECRET).update(s).digest('base64url');

// Checks the token Google hands the browser and returns the person's email and name.
export async function verifyGoogle(credential) {
  const ticket = await google.verifyIdToken({ idToken: String(credential || ''), audience: CLIENT_ID });
  const p = ticket.getPayload();
  const email = String(p?.email || '').toLowerCase();
  if (!p?.email_verified || !email.endsWith(`@${DOMAIN}`)) {
    const err = new Error(`Only @${DOMAIN} accounts can come in.`);
    err.friendly = true;
    throw err;
  }
  return { email, googleName: p.given_name || p.name || email.split('@')[0] };
}

export function sessionCookie(email, secure) {
  const body = `${Buffer.from(email).toString('base64url')}.${Date.now() + DAYS * 86400_000}`;
  return `hq=${body}.${sign(body)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${DAYS * 86400}${secure ? '; Secure' : ''}`;
}
export const clearCookie = 'hq=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0';

// Returns the signed-in email for a request, or null.
export function emailFromRequest(req) {
  const m = /(?:^|;\s*)hq=([^;]+)/.exec(req.headers.cookie || '');
  if (!m) return null;
  const parts = m[1].split('.');
  if (parts.length !== 3) return null;
  const body = `${parts[0]}.${parts[1]}`;
  const good = sign(body);
  if (parts[2].length !== good.length || !crypto.timingSafeEqual(Buffer.from(parts[2]), Buffer.from(good))) return null;
  if (Number(parts[1]) < Date.now()) return null;
  return Buffer.from(parts[0], 'base64url').toString();
}

// Saved characters: email -> { name, look }
export function createUserStore(dataDir) {
  const file = path.join(dataDir, 'users.json');
  let users = {};
  try { users = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* first run */ }
  return {
    get: (email) => users[email] || null,
    save(email, profile) {
      users[email] = profile;
      fs.mkdirSync(dataDir, { recursive: true });
      fs.writeFileSync(file, JSON.stringify(users));
    },
  };
}
