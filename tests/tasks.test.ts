import { it, expect } from 'vitest';
import { createTaskService } from '../src/tasks/service.js';
import { createProcessLimiter, limitDriver } from '../src/antigravity/limiter.js';
import type { AgyDriver } from '../src/contracts.js';
import type { SearchInitial, TaskInitial } from '../src/tasks/contracts.js';
const base = {
  kind: 'initial' as const,
  requestId: 'r',
  scope: { host: 'codex' as const, workspaceRoot: '/project', hostTaskId: 't' },
  invocation: 'explicit' as const,
  externalProcessingAllowed: true,
  providerRequirement: 'preferred' as const,
  context: [],
};
const search: SearchInitial = { ...base, query: '公开搜索', domains: [], language: 'zh' };
const native: TaskInitial = {
  ...base,
  task: '创建制品',
  workspace: {
    cwd: '/project',
    readRoots: ['/project'],
    writeRoots: ['/project'],
    artifactDir: '/project/out',
  },
  authorization: {
    useAgyConfiguration: true,
    summary: 'user requested',
    allowedActions: ['write'],
    prohibitedActions: [],
  },
};
const fake: AgyDriver = {
  async runTurn(input) {
    const mode = JSON.parse(input.request!.text).mode;
    return {
      ok: true,
      conversationId: 's',
      output: {
        kind: 'candidate',
        text: JSON.stringify(
          mode === 'native'
            ? { summary: '完成', actions: [], artifacts: [], verification: [], unfinished: [] }
            : {
                answer: '答复',
                queries: ['查询'],
                sources: [{ title: '来源', url: 'https://example.com' }],
              },
        ),
        notes: [],
      },
      warnings: [],
    };
  },
};
it('retains separate mode scopes and fails on cross-mode token reuse', async () => {
  const s = createTaskService({ driver: fake });
  try {
    const r = await s.websearch(search, new AbortController().signal);
    expect(r.status).toBe('completed');
    const n = await s.runTask({ ...native, requestId: 'n' }, new AbortController().signal);
    expect(n.status).toBe('completed');
    expect(
      await s.runTask(
        {
          kind: 'followup',
          requestId: 'f',
          scope: base.scope,
          sessionToken: r.sessionToken!,
          feedback: '继续',
          context: [],
        },
        new AbortController().signal,
      ),
    ).toMatchObject({ status: 'failed', reason: { code: 'SESSION_INVALID' } });
  } finally {
    await s.close();
  }
});
it('reports unknown native side effects and never retries a failed request', async () => {
  let calls = 0;
  const s = createTaskService({
    driver: {
      async runTurn() {
        calls++;
        return { ok: false, code: 'DEADLINE_EXCEEDED', message: 'timeout' };
      },
    },
  });
  try {
    const r = await s.runTask(native, new AbortController().signal);
    expect(r).toMatchObject({
      status: 'failed',
      sideEffects: 'unknown',
      fallback: 'inspect_then_continue',
    });
    await s.runTask(native, new AbortController().signal);
    expect(calls).toBe(1);
  } finally {
    await s.close();
  }
});
it('does not reassign a denied native action to the host', async () => {
  const s = createTaskService({
    driver: {
      async runTurn() {
        return { ok: false, code: 'PERMISSION_DENIED', message: 'denied' };
      },
    },
  });
  try {
    expect(await s.runTask(native, new AbortController().signal)).toMatchObject({
      fallback: 'none',
      sideEffects: 'unknown',
    });
  } finally {
    await s.close();
  }
});
it('changed authorization with the same id conflicts instead of executing', async () => {
  let calls = 0;
  const s = createTaskService({
    driver: {
      async runTurn(i, s) {
        calls++;
        return fake.runTurn(i, s);
      },
    },
  });
  try {
    await s.runTask(native, new AbortController().signal);
    expect(
      await s.runTask(
        { ...native, workspace: { ...native.workspace, writeRoots: ['/other'] } },
        new AbortController().signal,
      ),
    ).toMatchObject({ reason: { code: 'REQUEST_CONFLICT' } });
    expect(calls).toBe(1);
  } finally {
    await s.close();
  }
});
it('uses one total budget across feedback and honors the shared turn setting', async () => {
  const deadlines: number[] = [];
  const s = createTaskService({
    driver: {
      async runTurn(i, s) {
        deadlines.push(i.deadlineAt);
        return fake.runTurn(i, s);
      },
    },
    config: { searchBudgetMs: 5000, nativeBudgetMs: 10000 },
  });
  const one = createTaskService({ driver: fake, maxTurns: 1 });
  try {
    const r = await s.websearch(search, new AbortController().signal);
    await s.websearch(
      {
        kind: 'followup',
        requestId: 'feedback',
        scope: base.scope,
        sessionToken: r.sessionToken!,
        feedback: '核对来源',
        context: [],
      },
      new AbortController().signal,
    );
    expect(deadlines).toHaveLength(2);
    expect(deadlines[0]).toBe(deadlines[1]);
    expect((await one.runTask(native, new AbortController().signal)).sessionToken).toBeUndefined();
  } finally {
    await s.close();
    await one.close();
  }
});

it('never hands off when the outer watchdog cannot confirm driver cleanup', async () => {
  const limiter = createProcessLimiter();
  const s = createTaskService({
    limiter,
    driver: { runTurn: async () => new Promise(() => {}) },
    config: { searchBudgetMs: 5000, nativeBudgetMs: 5000 },
  });
  try {
    expect.soft(await s.runTask(native, new AbortController().signal)).toMatchObject({
      status: 'failed',
      fallback: 'none',
      sideEffects: 'unknown',
      warnings: expect.arrayContaining(['PROCESS_CLEANUP_UNCONFIRMED']),
    });
    const other = limitDriver(
      { runTurn: async () => ({ ok: false, code: 'TEST', message: 'test' }) },
      limiter,
    );
    expect(
      await other.runTurn(
        { prompt: 'x', workspaceDir: '/tmp', deadlineAt: Date.now() + 1000 },
        new AbortController().signal,
      ),
    ).toMatchObject({ code: 'INSTANCE_DISABLED' });
  } finally {
    await s.close();
  }
}, 10000);
