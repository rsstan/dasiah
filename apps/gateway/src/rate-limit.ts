// Fixed-window rate limits in Redis, one counter per route and caller (user id when signed in,
// otherwise client IP). The window starts with the first request. If Redis is unavailable the
// request is let through and a warning is logged: limits protect capacity, they must not take
// the API down.
import type { Logger } from '@heatmap/common';

/** The part of the Redis client the limiter needs. */
export interface ScriptRunner {
  eval(script: string, options: { keys: string[]; arguments: string[] }): Promise<unknown>;
}

// INCR, set the expiry on the first hit, return the count and the time left in the window.
const SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then redis.call('PEXPIRE', KEYS[1], ARGV[1]); ttl = tonumber(ARGV[1]) end
return {count, ttl}`;

export interface RateDecision {
  readonly allowed: boolean;
  readonly limit: number;
  readonly remaining: number;
  /** Seconds until the window resets. */
  readonly resetS: number;
}

export class RateLimiter {
  private readonly redis: ScriptRunner;
  private readonly windowMs: number;
  private readonly logger: Logger;

  constructor(redis: ScriptRunner, windowS: number, logger: Logger) {
    this.redis = redis;
    this.windowMs = windowS * 1_000;
    this.logger = logger;
  }

  async hit(group: string, subject: string, limit: number): Promise<RateDecision> {
    const key = `rl:${group}:${subject}`;
    try {
      const reply = (await this.redis.eval(SCRIPT, { keys: [key], arguments: [String(this.windowMs)] })) as [
        number,
        number,
      ];
      const [count, ttlMs] = reply;
      return {
        allowed: count <= limit,
        limit,
        remaining: Math.max(0, limit - count),
        resetS: Math.max(1, Math.ceil(ttlMs / 1_000)),
      };
    } catch (error) {
      this.logger.warn({ err: error, group }, 'rate limit store unavailable, request let through');
      return { allowed: true, limit, remaining: limit, resetS: Math.ceil(this.windowMs / 1_000) };
    }
  }
}
