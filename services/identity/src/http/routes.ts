// HTTP routes of identity; schemas come from contracts/openapi/identity.yaml.
import cookie from '@fastify/cookie';
import {
  currentContext,
  routeSchema,
  UnauthorizedError,
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from '@heatmap/common';
import { openApiDocuments } from '@heatmap/contracts';
import type { AppContext, ClientInfo } from '../context.ts';
import { changePassword, changeProfile, deleteAccount, getProfile } from '../usecases/account.ts';
import { login, logout, refresh, register } from '../usecases/auth.ts';
import type { IssuedTokens } from '../usecases/sessions.ts';

const REFRESH_COOKIE = 'refresh_token';
const COOKIE_PATH = '/api/v1/auth';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const contract = (method: string, path: string) => routeSchema(openApiDocuments.identity, method, path);

function client(req: FastifyRequest): ClientInfo {
  const userAgent = req.headers['user-agent'];
  return { userAgent: typeof userAgent === 'string' ? userAgent.slice(0, 300) : null, ip: req.ip ?? null };
}

/** The signed-in user, from X-User-Id set by the gateway after verifying the access token. */
function caller(): string {
  const userId = currentContext()?.userId;
  if (userId === undefined || !UUID.test(userId)) {
    throw new UnauthorizedError('Sign in first.');
  }
  return userId;
}

export async function registerRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  await app.register(cookie);
  const cookieOptions = {
    httpOnly: true,
    secure: ctx.config.COOKIE_SECURE,
    sameSite: 'strict' as const,
    path: COOKIE_PATH,
  };
  const sendTokens = (reply: FastifyReply, tokens: IssuedTokens) => {
    reply.setCookie(REFRESH_COOKIE, tokens.refreshToken, { ...cookieOptions, maxAge: ctx.config.REFRESH_TTL_S });
    return { accessToken: tokens.accessToken, tokenType: 'Bearer' as const, expiresIn: tokens.expiresIn };
  };
  const clearSession = (reply: FastifyReply) => reply.clearCookie(REFRESH_COOKIE, cookieOptions);

  app.post('/auth/register', { schema: contract('post', '/auth/register') }, async (req, reply) => {
    const body = req.body as { email: string; password: string; displayName?: string; locale?: string };
    const profile = await register(ctx, body);
    return reply.status(201).header('location', '/api/v1/users/me').send(profile);
  });

  app.post('/auth/login', { schema: contract('post', '/auth/login') }, async (req, reply) => {
    const body = req.body as { email: string; password: string };
    return sendTokens(reply, await login(ctx, body, client(req)));
  });

  app.post('/auth/refresh', { schema: contract('post', '/auth/refresh') }, async (req, reply) => {
    try {
      return sendTokens(reply, await refresh(ctx, req.cookies[REFRESH_COOKIE], client(req)));
    } catch (error) {
      clearSession(reply);
      throw error;
    }
  });

  app.post('/auth/logout', { schema: contract('post', '/auth/logout') }, async (req, reply) => {
    await logout(ctx, caller(), req.cookies[REFRESH_COOKIE]);
    return clearSession(reply).status(204).send();
  });

  app.get('/users/me', { schema: contract('get', '/users/me') }, async () => getProfile(ctx, caller()));

  app.patch('/users/me', { schema: contract('patch', '/users/me') }, async (req) => {
    const body = req.body as { displayName?: string | null; locale?: string };
    return changeProfile(ctx, caller(), body);
  });

  app.delete('/users/me', { schema: contract('delete', '/users/me') }, async (_req, reply) => {
    await deleteAccount(ctx, caller());
    return clearSession(reply).status(204).send();
  });

  app.post('/users/me/password', { schema: contract('post', '/users/me/password') }, async (req, reply) => {
    const body = req.body as { currentPassword: string; newPassword: string };
    return sendTokens(reply, await changePassword(ctx, caller(), body, client(req)));
  });

  app.get('/.well-known/jwks.json', { schema: contract('get', '/.well-known/jwks.json') }, async (_req, reply) => {
    reply.header('cache-control', 'public, max-age=300');
    return ctx.tokens.jwks();
  });
}
