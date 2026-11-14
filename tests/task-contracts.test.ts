import { it, expect } from 'vitest';
import { mkdtemp, mkdir, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  searchRequestSchema,
  taskRequestSchema,
  toolResultSchema,
} from '../src/tasks/contracts.js';
import { resolveWorkspace } from '../src/tasks/workspace.js';
const common = {
  kind: 'initial',
  requestId: 'r',
  scope: { host: 'codex', workspaceRoot: '/project', hostTaskId: 't' },
  invocation: 'explicit',
  externalProcessingAllowed: true,
  providerRequirement: 'preferred',
  context: [],
};
it('rejects contradictory tool result states', () => {
  const base = {
    requestId: 'r',
    mode: 'websearch',
    status: 'completed',
    fallback: 'host_decides',
    sideEffects: 'none',
    warnings: [],
    elapsedMs: 0,
  };
  expect(toolResultSchema.safeParse(base).success).toBe(false);
  expect(
    toolResultSchema.safeParse({
      ...base,
      status: 'cancelled',
      reason: { code: 'CANCELLED', message: 'cancel' },
    }).success,
  ).toBe(false);
  expect(toolResultSchema.safeParse({ ...base, status: 'failed' }).success).toBe(false);
});
it('requires explicit searches and rejects oversize input and authority in feedback', () => {
  expect(
    searchRequestSchema.safeParse({ ...common, query: 'node release', domains: [], language: 'zh' })
      .success,
  ).toBe(true);
  expect(
    searchRequestSchema.safeParse({
      ...common,
      invocation: 'automatic',
      query: 'x',
      domains: [],
      language: 'zh',
    }).success,
  ).toBe(false);
  expect(
    searchRequestSchema.safeParse({
      ...common,
      query: 'x'.repeat(256 * 1024),
      domains: [],
      language: 'zh',
    }).success,
  ).toBe(false);
  expect(
    taskRequestSchema.safeParse({
      kind: 'followup',
      requestId: 'r2',
      scope: common.scope,
      sessionToken: 's',
      feedback: '继续',
      context: [],
      workspace: { cwd: '/other' },
    }).success,
  ).toBe(false);
});
it('requires explicit native configuration consent and a workspace', () => {
  expect(taskRequestSchema.safeParse({ ...common, task: '生成制品' }).success).toBe(false);
});
it('canonicalizes shared roots and rejects symlinked artifact escape', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agy-paths-'));
  const project = join(root, 'project'),
    outside = join(root, 'outside');
  await mkdir(project);
  await mkdir(outside);
  try {
    const w = {
      cwd: project,
      readRoots: [project],
      writeRoots: [project],
      artifactDir: join(project, 'new', 'artifacts'),
    };
    expect((await resolveWorkspace(w)).artifactDir).toMatch(/new\/artifacts$/);
    await symlink(outside, join(project, 'escape'), 'dir');
    await expect(
      resolveWorkspace({ ...w, artifactDir: join(project, 'escape', 'out') }),
    ).rejects.toThrow('ARTIFACT_OUTSIDE_WRITE_ROOTS');
    await expect(resolveWorkspace({ ...w, cwd: outside })).rejects.toThrow(
      'CWD_OUTSIDE_READ_ROOTS',
    );
    await expect(resolveWorkspace({ ...w, writeRoots: [outside] })).rejects.toThrow(
      'WRITE_OUTSIDE_READ_ROOTS',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
