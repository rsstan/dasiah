import { describe, expect, it } from 'vitest';
import { ApiError } from './client.ts';
import { shouldRetry } from './queryClient.ts';

describe('query retries', () => {
  it('retries network failures and 5xx twice, never 4xx', () => {
    expect(shouldRetry(0, new ApiError(0, {}, 'c'))).toBe(true);
    expect(shouldRetry(1, new ApiError(503, {}, 'c'))).toBe(true);
    expect(shouldRetry(2, new ApiError(503, {}, 'c'))).toBe(false);
    for (const status of [400, 401, 403, 404, 409, 422, 429]) {
      expect(shouldRetry(0, new ApiError(status, {}, 'c'))).toBe(false);
    }
  });
});
