import { it, expect } from 'vitest';
import { mkdtemp, copyFile, chmod, readFile, rm, writeFile, symlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { runAcp } from '../src/tasks/acp.js';
import type { PermissionHandler, TaskInitial } from '../src/tasks/contracts.js';
import type { RunTurnInput } from '../src/contracts.js';
import { createTaskService } from '../src/tasks/service.js';
async function fixture(handler?: PermissionHandler, scenario: Record<string, unknown> = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'agy-acp-test-'));
  const executable = join(dir, 'fake-acp');
  await copyFile(resolve('tests/fixtures/fake-acp.mjs'), executable);
  await chmod(executable, 0o700);
  await writeFile(join(dir, 'scenario.json'), JSON.stringify(scenario));
  const request: TaskInitial = {
    kind: 'initial',
    requestId: 'x',
    scope: { host: 'codex', workspaceRoot: dir, hostTaskId: 't' },
    invocation: 'explicit',
    externalProcessingAllowed: true,
    providerRequirement: 'preferred',
    context: [],
    task: '写制品',
    workspace: { cwd: dir, readRoots: [dir], writeRoots: [dir], artifactDir: dir },
    authorization: {
      useAgyConfiguration: true,
      summary: 'synthetic fixture',
      allowedActions: ['write'],
      prohibitedActions: [],
    },
  };
  return {
    dir,
    request,
    run: (input?: RunTurnInput, signal?: AbortSignal) =>
      runAcp({
        executable,
        request,
        input: input ?? { prompt: '写制品', workspaceDir: dir, deadlineAt: Date.now() + 2000 },
        signal: signal ?? new AbortController().signal,
        permission: handler,
      }),
  };
}
it.skipIf(process.platform === 'win32')(
  'writes shared artifact only after one-time host permission',
  async () => {
    let asks = 0;
    const f = await fixture(async (p) => {
      asks++;
      expect(p.details).toContain('SYNTHETIC');
      expect(p.deadlineAt).toBeGreaterThan(Date.now());
      return 'allow_once';
    });
    try {
      const r = await f.run();
      expect(r.ok).toBe(true);
      expect(asks).toBe(1);
      expect(await readFile(join(f.dir, 'artifact.txt'), 'utf8')).toBe('SYNTHETIC');
      if (r.ok && r.output.kind === 'candidate')
        expect(JSON.parse(r.output.text).artifacts).toHaveLength(1);
    } finally {
      await rm(f.dir, { recursive: true, force: true });
    }
  },
);
it
  .skipIf(process.platform === 'win32')
  .each([{ sessionId: 'wrong' }, { onlyAlways: true }, { path: '/outside/artifact.txt' }])(
  'rejects mismatched and unsupported permissions before host confirmation: %j',
  async (scenario) => {
    let asks = 0;
    const f = await fixture(async () => {
      asks++;
      return 'allow_once';
    }, scenario);
    try {
      expect((await f.run()).ok).toBe(false);
      expect(asks).toBe(0);
      await expect(readFile(join(f.dir, 'artifact.txt'))).rejects.toThrow();
    } finally {
      await rm(f.dir, { recursive: true, force: true });
    }
  },
);
it.skipIf(process.platform === 'win32')(
  'rejects symlinked reads outside authorized roots',
  async () => {
    let asks = 0;
    const f = await fixture(
      async () => {
        asks++;
        return 'allow_once';
      },
      { kind: 'read', path: 'symlink' },
    );
    const outside = await mkdtemp(join(tmpdir(), 'agy-outside-'));
    f.request.authorization.allowedActions.push('read');
    try {
      await symlink(outside, join(f.dir, 'symlink'));
      expect((await f.run()).ok).toBe(false);
      expect(asks).toBe(0);
    } finally {
      await rm(f.dir, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  },
);
it.skipIf(process.platform === 'win32')(
  'expires waiting consent and ignores late approval',
  async () => {
    let late: (() => void) | undefined;
    let aborted = false;
    const f = await fixture(async (_p, signal) => {
      signal.addEventListener('abort', () => {
        aborted = true;
      });

      await new Promise<void>((resolve) => {
        late = resolve;
      });
      return 'allow_once';
    });
    try {
      expect(await f.run()).toMatchObject({ ok: false, code: 'AUTHORIZATION_EXPIRED' });
      expect(aborted).toBe(true);
      late?.();
      await new Promise((r) => setTimeout(r, 50));
      await expect(readFile(join(f.dir, 'artifact.txt'))).rejects.toThrow();
    } finally {
      await rm(f.dir, { recursive: true, force: true });
    }
  },
);
it
  .skipIf(process.platform === 'win32')
  .each([undefined, async () => 'deny_once' as const, async () => 'cancel' as const])(
  'never approves without supported affirmative user consent',
  async (handler) => {
    const f = await fixture(handler);
    try {
      expect(await f.run()).toMatchObject({ ok: false });
      await expect(readFile(join(f.dir, 'artifact.txt'))).rejects.toThrow();
    } finally {
      await rm(f.dir, { recursive: true, force: true });
    }
  },
);

it.skipIf(process.platform === 'win32')(
  'does not offer a read approval when reading is outside the task authorization',
  async () => {
    let asks = 0;
    const f = await fixture(
      async () => {
        asks++;
        return 'allow_once';
      },
      { kind: 'read' },
    );
    try {
      await writeFile(join(f.dir, 'artifact.txt'), 'existing');
      expect((await f.run()).ok).toBe(false);
      expect(asks).toBe(0);
      expect(await readFile(join(f.dir, 'artifact.txt'), 'utf8')).toBe('existing');
    } finally {
      await rm(f.dir, { recursive: true, force: true });
    }
  },
);

it.skipIf(process.platform === 'win32')(
  'merges incremental permission and completion details',
  async () => {
    let details = '';
    const f = await fixture(
      async (p) => {
        details = p.details;
        return 'allow_once';
      },
      { incremental: true },
    );
    try {
      const r = await f.run();
      expect(r.ok).toBe(true);
      expect(details).toContain('SYNTHETIC');
      expect(details).toContain('artifact.txt');
      if (r.ok && r.output.kind === 'candidate') {
        const task = JSON.parse(r.output.text);
        expect(task.artifacts).toHaveLength(1);
        expect(task.actions[0]).toContain('write_file');
      }
    } finally {
      await rm(f.dir, { recursive: true, force: true });
    }
  },
);
it
  .skipIf(process.platform === 'win32')
  .each([{ incremental: true, kind: 'read', path: '/outside/config' }, { missingDetails: true }])(
  'never offers an incomplete or unauthorized approval: %j',
  async (scenario) => {
    let asks = 0;
    const f = await fixture(async () => {
      asks++;
      return 'allow_once';
    }, scenario);
    try {
      expect((await f.run()).ok).toBe(false);
      expect(asks).toBe(0);
      await expect(readFile(join(f.dir, 'artifact.txt'))).rejects.toThrow();
    } finally {
      await rm(f.dir, { recursive: true, force: true });
    }
  },
);
it.skipIf(process.platform === 'win32')(
  'retains denial when the process ignores cancellation',
  async () => {
    const f = await fixture(async () => 'deny_once', { linger: true });
    try {
      expect(await f.run()).toMatchObject({ ok: false, code: 'PERMISSION_DENIED' });
      await expect(readFile(join(f.dir, 'artifact.txt'))).rejects.toThrow();
    } finally {
      await rm(f.dir, { recursive: true, force: true });
    }
  },
);
it.skipIf(process.platform === 'win32')(
  'keeps ordinary timeout semantics after an approved write',
  async () => {
    const f = await fixture(async () => 'allow_once', { linger: true });
    try {
      expect(await f.run()).toMatchObject({ ok: false, code: 'DEADLINE_EXCEEDED' });
      expect(await readFile(join(f.dir, 'artifact.txt'), 'utf8')).toBe('SYNTHETIC');
    } finally {
      await rm(f.dir, { recursive: true, force: true });
    }
  },
);
it.skipIf(process.platform === 'win32')(
  'never hands a pending authorization to the host after budget expiry',
  async () => {
    const f = await fixture(async () => new Promise(() => {}));
    const service = createTaskService({
      driver: { runTurn: (i, s) => f.run(i, s) },
      config: { searchBudgetMs: 5000, nativeBudgetMs: 5000 },
    });
    try {
      expect(await service.runTask(f.request, new AbortController().signal)).toMatchObject({
        status: 'needs_authorization',
        reason: { code: 'AUTHORIZATION_EXPIRED' },
        fallback: 'none',
        sideEffects: 'unknown',
      });
      await expect(readFile(join(f.dir, 'artifact.txt'))).rejects.toThrow();
    } finally {
      await service.close();
      await rm(f.dir, { recursive: true, force: true });
    }
  },
  10000,
);
