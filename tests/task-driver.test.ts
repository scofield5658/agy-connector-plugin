import { it, expect } from 'vitest';
import { decodeSearchTranscript } from '../src/tasks/protocol.js';
import { createProcessLimiter, limitDriver } from '../src/antigravity/limiter.js';
import type { AgyDriver, RunTurnResult } from '../src/contracts.js';
const final = {
  event: 'result',
  result: {
    conversation_id: 's',
    status: 'SUCCESS',
    structured_output: {
      answer: '发布日期',
      queries: ['original'],
      sources: [{ title: '官方', url: 'https://nodejs.org/en/blog/release/v22.12.0' }],
    },
  },
};
const search = {
  event: 'step_update',
  step_update: {
    step_index: 2,
    step_type: 'tool',
    state: 'DONE',
    tool_name: 'search_web',
    tool_info: { parameters: { query: 'site:nodejs.org v22.12.0' } },
  },
};
const transcript = (events: unknown[]) => events.map((e) => JSON.stringify(e)).join('\n');
it('requires actual search and returns observed query with source review warning', () => {
  expect(decodeSearchTranscript(transcript([final]), '', 0)).toMatchObject({
    ok: false,
    code: 'SEARCH_NOT_EXECUTED',
  });
  const r = decodeSearchTranscript(transcript([search, final]), '', 0);
  expect(r.ok).toBe(true);
  if (r.ok && r.output.kind === 'candidate') {
    expect(JSON.parse(r.output.text).queries).toEqual(['site:nodejs.org v22.12.0']);
    expect(r.warnings).toContain('HOST_SOURCE_REVIEW_REQUIRED');
  }
});
it('rejects forbidden tools, failed searches and unsafe source URLs', () => {
  expect(
    decodeSearchTranscript(
      transcript([
        { ...search, step_update: { ...search.step_update, tool_name: 'run_command' } },
        final,
      ]),
      '',
      0,
    ),
  ).toMatchObject({ ok: false, code: 'PERMISSION_DENIED' });
  expect(
    decodeSearchTranscript(
      transcript([{ ...search, step_update: { ...search.step_update, state: 'ERROR' } }, final]),
      '',
      0,
    ).ok,
  ).toBe(false);
  const bad = structuredClone(final);
  bad.result.structured_output.sources[0]!.url = 'javascript:alert(1)';
  expect(decodeSearchTranscript(transcript([search, bad]), '', 0).ok).toBe(false);
});
it('shares two process slots across drivers and releases on completion', async () => {
  const queue: ((r: RunTurnResult) => void)[] = [];
  const raw: AgyDriver = { runTurn: () => new Promise((r) => queue.push(r)) };
  const limiter = createProcessLimiter(2);
  const a = limitDriver(raw, limiter),
    b = limitDriver(raw, limiter);
  const input = { prompt: 'x', workspaceDir: '/tmp', deadlineAt: Date.now() + 1000 };
  const signal = new AbortController().signal;
  const p = a.runTurn(input, signal),
    q = b.runTurn(input, signal);
  expect(await a.runTurn(input, signal)).toMatchObject({ ok: false, code: 'BUSY' });
  queue.splice(0).forEach((r) => r({ ok: false, code: 'TEST', message: 'test' }));
  await Promise.all([p, q]);
  const next = a.runTurn(input, signal);
  queue[0]!({ ok: false, code: 'TEST', message: 'test' });
  expect(await next).toMatchObject({ code: 'TEST' });
});
it('disables every mode when process cleanup is uncertain', async () => {
  const limiter = createProcessLimiter();
  const broken = limitDriver(
    {
      async runTurn() {
        return { ok: false, code: 'CLEANUP_FAILED', message: 'unknown', cleanupWarning: 'alive' };
      },
    },
    limiter,
  );
  const other = limitDriver(
    {
      async runTurn() {
        throw Error('must not start');
      },
    },
    limiter,
  );
  const input = { prompt: 'x', workspaceDir: '/tmp', deadlineAt: Date.now() + 1000 };
  await broken.runTurn(input, new AbortController().signal);
  expect(await other.runTurn(input, new AbortController().signal)).toMatchObject({
    ok: false,
    code: 'INSTANCE_DISABLED',
  });
});
