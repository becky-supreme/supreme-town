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
});
