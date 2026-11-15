// Access-token verification against the JWKS published by identity. The key set is cached and
// refetched when a token names an unknown `kid` (key rotation). Only EdDSA is accepted.
import { ServiceUnavailableError, UnauthorizedError } from '@heatmap/common';
import { createRemoteJWKSet, jwtVerify } from 'jose';

export interface Caller {
  readonly userId: string;
  readonly role: 'user' | 'admin';
}

export interface AuthenticatorOptions {
  readonly identityUrl: string;
  readonly issuer: string;
  readonly audience: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** jose error codes that mean "the token is not acceptable" (as opposed to "cannot check now"). */
const TOKEN_ERRORS = new Set([
  'ERR_JWT_EXPIRED',
  'ERR_JWT_CLAIM_VALIDATION_FAILED',
  'ERR_JWT_INVALID',
  'ERR_JWS_INVALID',
  'ERR_JWS_SIGNATURE_VERIFICATION_FAILED',
  'ERR_JWKS_NO_MATCHING_KEY',
  'ERR_JWKS_MULTIPLE_MATCHING_KEYS',
  'ERR_JOSE_ALG_NOT_ALLOWED',
  'ERR_JOSE_NOT_SUPPORTED',
]);

export class Authenticator {
  private readonly jwks: ReturnType<typeof createRemoteJWKSet>;
  private readonly options: AuthenticatorOptions;

  constructor(options: AuthenticatorOptions) {
    this.options = options;
    this.jwks = createRemoteJWKSet(new URL('/.well-known/jwks.json', options.identityUrl), {
      timeoutDuration: 3_000,
      cooldownDuration: 30_000,
      cacheMaxAge: 600_000,
    });
  }

  /** Reads `Authorization: Bearer <token>`; undefined when there is no such header. */
  async fromHeader(header: string | undefined): Promise<Caller | undefined> {
    if (header === undefined || header === '') {
      return undefined;
    }
    const match = /^Bearer ([A-Za-z0-9._-]+)$/.exec(header);
    if (match?.[1] === undefined) {
      throw invalidToken('The Authorization header must be "Bearer <access token>".');
    }
    return this.verify(match[1]);
  }

  async verify(token: string): Promise<Caller> {
    let payload;
    try {
      ({ payload } = await jwtVerify(token, this.jwks, {
        issuer: this.options.issuer,
        audience: this.options.audience,
        algorithms: ['EdDSA'],
      }));
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code !== undefined && TOKEN_ERRORS.has(code)) {
        throw invalidToken(
          code === 'ERR_JWT_EXPIRED' ? 'The access token has expired.' : 'The access token is not valid.',
        );
      }
      throw new ServiceUnavailableError(
        'Tokens cannot be checked right now (identity unreachable).',
        5,
        {},
        { cause: error },
      );
    }
    const role = payload['role'];
    if (typeof payload.sub !== 'string' || !UUID.test(payload.sub) || (role !== 'user' && role !== 'admin')) {
      throw invalidToken('The access token is not valid.');
    }
    return { userId: payload.sub, role };
  }
}

function invalidToken(detail: string): UnauthorizedError {
  return new UnauthorizedError(detail, { type: '/problems/invalid-token' });
}
