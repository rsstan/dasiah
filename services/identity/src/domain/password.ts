// Password hashing with Argon2id (node:crypto, RFC 9106), stored as a PHC string:
//   $argon2id$v=19$m=19456,t=2,p=1$<salt base64>$<hash base64>
// Parameters follow the OWASP recommendation for Argon2id (19 MiB, 2 passes, 1 lane).
import { argon2, randomBytes, timingSafeEqual } from 'node:crypto';

export interface Argon2Params {
  /** Memory in KiB. */
  readonly memory: number;
  readonly passes: number;
  readonly parallelism: number;
}

export const DEFAULT_ARGON2_PARAMS: Argon2Params = { memory: 19_456, passes: 2, parallelism: 1 };

const SALT_BYTES = 16;
const TAG_BYTES = 32;
const PHC_PATTERN = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/;

function derive(password: string, salt: Buffer, params: Argon2Params, tagLength: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    argon2(
      'argon2id',
      {
        message: password,
        nonce: salt,
        memory: params.memory,
        passes: params.passes,
        parallelism: params.parallelism,
        tagLength,
      },
      (error, derived) => (error ? reject(error) : resolve(derived)),
    );
  });
}

const b64 = (buf: Buffer): string => buf.toString('base64').replace(/=+$/, '');

/** Hashes a password with a fresh random salt. */
export async function hashPassword(password: string, params: Argon2Params = DEFAULT_ARGON2_PARAMS): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const tag = await derive(password, salt, params, TAG_BYTES);
  return `$argon2id$v=19$m=${params.memory},t=${params.passes},p=${params.parallelism}$${b64(salt)}$${b64(tag)}`;
}

/** Constant-time check of a password against a PHC string. Unknown formats never verify. */
export async function verifyPassword(password: string, phc: string): Promise<boolean> {
  const match = PHC_PATTERN.exec(phc);
  if (match === null) {
    return false;
  }
  const [, m, t, p, saltB64, tagB64] = match as unknown as [string, string, string, string, string, string];
  const expected = Buffer.from(tagB64, 'base64');
  const params: Argon2Params = { memory: Number(m), passes: Number(t), parallelism: Number(p) };
  const actual = await derive(password, Buffer.from(saltB64, 'base64'), params, expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** true when a stored hash uses weaker parameters than the current default (rehash on next login). */
export function needsRehash(phc: string, params: Argon2Params = DEFAULT_ARGON2_PARAMS): boolean {
  const match = PHC_PATTERN.exec(phc);
  if (match === null) {
    return true;
  }
  return Number(match[1]) < params.memory || Number(match[2]) < params.passes || Number(match[3]) < params.parallelism;
}
