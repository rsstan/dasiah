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

  it.each([
    ['memory', { memory: 19_455, passes: 2, parallelism: 1 }, true],
    ['passes', { memory: 19_456, passes: 1, parallelism: 1 }, true],
    ['nothing', { memory: 19_456, passes: 2, parallelism: 1 }, false],
    ['nothing, stronger', { memory: 20_000, passes: 3, parallelism: 1 }, false],
  ])('asks for a new hash when %s is below the default', async (_, p, expected) => {
    expect(needsRehash(`$argon2id$v=19$m=${p.memory},t=${p.passes},p=${p.parallelism}$c2FsdA$aGFzaA`)).toBe(expected);
  });

  it('asks for a new hash when the parallelism is below the wanted one or the format is unknown', () => {
    const wanted = { memory: 8, passes: 1, parallelism: 4 };
    expect(needsRehash('$argon2id$v=19$m=8,t=1,p=3$c2FsdA$aGFzaA', wanted)).toBe(true);
    expect(needsRehash('$argon2id$v=19$m=8,t=1,p=4$c2FsdA$aGFzaA', wanted)).toBe(false);
    expect(needsRehash('$2b$10$abc')).toBe(true);
  });

  it('reads parameters of several digits and nothing before or after the hash', async () => {
    const strong = await hashPassword('pw', { memory: 128, passes: 10, parallelism: 12 });
    await expect(verifyPassword('pw', strong)).resolves.toBe(true);
    const hash = await hashPassword('pw');
    await expect(verifyPassword('pw', ` ${hash}`)).resolves.toBe(false);
    await expect(verifyPassword('pw', `${hash}\n`)).resolves.toBe(false);
  });

  it('flags weaker parameters for rehash', async () => {
    const weak = await hashPassword('pw', { memory: 8_192, passes: 1, parallelism: 1 });
    expect(needsRehash(weak)).toBe(true);
    await expect(verifyPassword('pw', weak)).resolves.toBe(true);
    expect(needsRehash(await hashPassword('pw'))).toBe(false);
  });
});
