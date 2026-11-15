// Access tokens (JWT, EdDSA/Ed25519) and refresh tokens (opaque random strings stored as SHA-256).
import { createHash, createPrivateKey, createPublicKey, randomBytes, randomUUID, type KeyObject } from 'node:crypto';
import { exportJWK, SignJWT } from 'jose';

export interface TokenSettings {
  readonly privateKeyPem: string;
  readonly keyId: string;
  readonly issuer: string;
  readonly audience: string;
  readonly accessTtlS: number;
}

export interface AccessClaims {
  readonly userId: string;
  readonly role: 'user' | 'admin';
}

export interface Jwk {
  kty: string;
  kid: string;
  alg: string;
  use: 'sig';
  crv?: string;
  x?: string;
}

export class TokenIssuer {
  private readonly settings: TokenSettings;
  private readonly privateKey: KeyObject;
  private readonly publicKey: KeyObject;

  constructor(settings: TokenSettings) {
    this.settings = settings;
    this.privateKey = createPrivateKey(settings.privateKeyPem);
    if (this.privateKey.asymmetricKeyType !== 'ed25519') {
      throw new Error('JWT_PRIVATE_KEY must be an Ed25519 key');
    }
    this.publicKey = createPublicKey(this.privateKey);
  }

  get accessTtlS(): number {
    return this.settings.accessTtlS;
  }

  async issueAccessToken({ userId, role }: AccessClaims): Promise<string> {
    const { keyId, issuer, audience, accessTtlS } = this.settings;
    return new SignJWT({ role })
      .setProtectedHeader({ alg: 'EdDSA', kid: keyId, typ: 'JWT' })
      .setSubject(userId)
      .setIssuer(issuer)
      .setAudience(audience)
      .setIssuedAt()
      .setExpirationTime(`${accessTtlS}s`)
      .setJti(randomUUID())
      .sign(this.privateKey);
  }

  /** Public key set for verifiers (the gateway). */
  async jwks(): Promise<{ keys: Jwk[] }> {
    const jwk = await exportJWK(this.publicKey);
    return {
      keys: [
        {
          kty: String(jwk.kty),
          crv: String(jwk.crv),
          x: String(jwk.x),
          kid: this.settings.keyId,
          alg: 'EdDSA',
          use: 'sig',
        },
      ],
    };
  }
}

/** A new opaque refresh token (256 random bits) and the hash that is stored. */
export function newRefreshToken(): { token: string; hash: Buffer } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashRefreshToken(token) };
}

export function hashRefreshToken(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest();
}
