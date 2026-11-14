import { it, expect } from 'vitest';
import { requestSchema, resultSchema } from '../src/contracts.js';
import { request } from './helpers.js';
it('rejects automatic general, empty goals, injected cli args and oversized UTF8', () => {
  for (const input of [
    request({ profile: 'general' }),
    request({ goal: '  ' }),
    { ...request(), permissions: 'allow-all' },
    request({ text: '中'.repeat(90000) }),
  ]) {
    expect(requestSchema.safeParse(input).success).toBe(false);
  }
});
it('candidate requires its original digest and failure cannot carry session token', () => {
  const base = {
    requestId: 'r',
    source: 'antigravity',
    warnings: [],
    elapsedMs: 1,
    fallback: 'original',
  };
  expect(resultSchema.safeParse({ ...base, status: 'candidate', candidate: '稿' }).success).toBe(
    false,
  );
  expect(resultSchema.safeParse({ ...base, status: 'failed', sessionToken: 'x' }).success).toBe(
    false,
  );
});
