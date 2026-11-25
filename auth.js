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

const SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
export const secretIsTemporary = !process.env.SESSION_SECRET;
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
