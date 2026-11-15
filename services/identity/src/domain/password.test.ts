import { describe, expect, it } from 'vitest';
import { hashPassword, needsRehash, verifyPassword } from './password.ts';

describe('password hashing', () => {
  it('produces an Argon2id PHC string accepted by the users_password_algo check', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$[A-Za-z0-9+/]{22}\$[A-Za-z0-9+/]{43}$/);
  });

  it('uses a fresh salt every time', async () => {
    const [a, b] = await Promise.all([hashPassword('same'), hashPassword('same')]);
    expect(a).not.toBe(b);
  });

  it('verifies the right password and rejects a wrong one', async () => {
    const hash = await hashPassword('s3cret-Pass');
    await expect(verifyPassword('s3cret-Pass', hash)).resolves.toBe(true);
    await expect(verifyPassword('s3cret-pass', hash)).resolves.toBe(false);
  });

  it('never verifies a malformed or disabled hash', async () => {
    await expect(verifyPassword('x', '$argon2id$disabled')).resolves.toBe(false);
    await expect(verifyPassword('x', '')).resolves.toBe(false);
  });

  it('flags weaker parameters for rehash', async () => {
    const weak = await hashPassword('pw', { memory: 8_192, passes: 1, parallelism: 1 });
    expect(needsRehash(weak)).toBe(true);
    await expect(verifyPassword('pw', weak)).resolves.toBe(true);
    expect(needsRehash(await hashPassword('pw'))).toBe(false);
  });
});
