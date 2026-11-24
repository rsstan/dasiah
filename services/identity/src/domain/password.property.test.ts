import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './password.ts';

/** Cheapest parameters Argon2 allows: the properties do not depend on the cost. */
const FAST = { memory: 8, passes: 1, parallelism: 1 };
const password = fc.string({ unit: 'grapheme', maxLength: 64 });

describe('passwords (properties)', () => {
  it('any password verifies against its own hash, and the hash does not contain it', async () => {
    await fc.assert(
      fc.asyncProperty(password, async (pw) => {
        const hash = await hashPassword(pw, FAST);
        expect(await verifyPassword(pw, hash)).toBe(true);
        expect(pw.length < 8 || !hash.includes(pw)).toBe(true);
      }),
    );
  });

  it('a different password never verifies', async () => {
    await fc.assert(
      fc.asyncProperty(password, password, async (a, b) => {
        fc.pre(a !== b);
        expect(await verifyPassword(b, await hashPassword(a, FAST))).toBe(false);
      }),
    );
  });

  it('anything that is no PHC string never verifies and never throws', async () => {
    await fc.assert(
      fc.asyncProperty(fc.string(), password, async (text, pw) => {
        expect(await verifyPassword(pw, text)).toBe(false);
      }),
    );
  });
});
