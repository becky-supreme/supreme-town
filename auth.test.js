import test from 'node:test';
import assert from 'node:assert/strict';

test('signed blobs round trip and expire', async () => {
  process.env.SESSION_SECRET = 's'.repeat(48);
  const auth = await import('./auth.js');
  const token = auth.seal({ purpose: 'device', did: '11111111-1111-1111-1111-111111111111' });
  assert.equal(auth.unseal(token).purpose, 'device');
  assert.equal(auth.unseal(`${token}x`), null);
  const expired = auth.seal({ purpose: 'slack-oauth', exp: Date.now() - 1000 });
  assert.equal(auth.unseal(expired), null);
  assert.equal(typeof auth.atRestSecret(), 'string');
  assert.ok(auth.atRestSecret().length >= 32);

  const work = auth.identityFromGooglePayload({ email: 'Ada@SupremeOpti.com', email_verified: true, given_name: 'Ada' });
  assert.deepEqual(work, { email: 'ada@supremeopti.com', googleName: 'Ada' });
  const guest = auth.identityFromGooglePayload({ email: 'guest@gmail.com', email_verified: true, name: 'Guest' });
  assert.equal(guest.email, 'guest@gmail.com');
  assert.equal(auth.DOMAIN.includes('@'), false);
  for (const bad of [
    { email: 'guest@gmail.com', email_verified: false },
    { email: 'not-an-email', email_verified: true },
    { email_verified: true },
    null,
  ]) {
    assert.throws(() => auth.identityFromGooglePayload(bad), (err) => err.friendly === true);
  }

  // The cookie is the email itself, so a non-Supreme address stays signed in
  // and still matches the Slack connection saved for that same email.
  const header = auth.sessionCookie('guest@gmail.com', false);
  assert.equal(auth.emailFromRequest({ headers: { cookie: header.split(';')[0] } }), 'guest@gmail.com');
  const secure = auth.sessionCookie('ada@supremeopti.com', true);
  assert.match(secure, /Secure/);
  assert.equal(auth.emailFromRequest({ headers: { cookie: secure.split(';')[0] } }), 'ada@supremeopti.com');
});
