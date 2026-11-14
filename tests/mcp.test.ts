import { it, expect, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '../src/mcp/server.js';
import { createDelegator } from '../src/delegation/engine.js';
import { defaultConfig } from '../src/config.js';
import { polishWorkflow } from '../src/workflows/polish.js';
import { generalWorkflow } from '../src/workflows/general.js';
import { request } from './helpers.js';
it('business_failure_is_a_readable_tool_result; health does not invoke model', async () => {
  const runTurn = vi.fn(async () => ({
    ok: false as const,
    code: 'CLI_UNAVAILABLE',
    message: 'not installed',
  }));
  const delegator = createDelegator({
    driver: { runTurn },
    workflows: { 'zh-polish': polishWorkflow, general: generalWorkflow },
    config: defaultConfig,
    clock: { now: Date.now },
  });
  const server = createMcpServer({
    delegator,
    health: async () => ({ available: false, ready: false, auth: 'unknown' }),
  });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '1' });
  await server.connect(a);
  await client.connect(b);
  try {
    expect(
      (await client.listTools()).tools.find((t) => t.name === 'agy_delegate')?.annotations,
    ).toMatchObject({ readOnlyHint: true, destructiveHint: false, openWorldHint: true });
    expect((await client.listTools()).tools.map((x) => x.name)).toEqual([
      'agy_delegate',
      'agy_health',
    ]);
    await client.callTool({ name: 'agy_health', arguments: {} });
    expect(runTurn).not.toHaveBeenCalled();
    const reply = await client.callTool({
      name: 'agy_delegate',
      arguments: { request: request() },
    });
    expect(reply.isError).not.toBe(true);
    expect(reply.structuredContent).toMatchObject({ status: 'failed', fallback: 'original' });
    const invalid = await client.callTool({
      name: 'agy_delegate',
      arguments: { request: { ...request(), permissions: 'unsafe' } },
    });
    expect(invalid.isError).toBe(true);
    expect(runTurn).toHaveBeenCalledTimes(1);
  } finally {
    await client.close();
    await server.close();
    await delegator.close();
  }
});
it('transport close aborts active delegation', async () => {
  let started!: () => void;
  const ready = new Promise<void>((r) => {
    started = r;
  });
  let aborted = false;
  const delegator = createDelegator({
    driver: {
      runTurn: async (_input, signal) =>
        new Promise((resolve) => {
          started();
          signal.addEventListener(
            'abort',
            () => {
              aborted = true;
              resolve({ ok: false, code: 'CANCELLED', message: 'cancelled' });
            },
            { once: true },
          );
        }),
    },
    workflows: { 'zh-polish': polishWorkflow, general: generalWorkflow },
    config: defaultConfig,
    clock: { now: Date.now },
  });
  const server = createMcpServer({ delegator, health: async () => ({ ready: true }) });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '1' });
  await server.connect(a);
  await client.connect(b);
  const pending = client
    .callTool({ name: 'agy_delegate', arguments: { request: request() } })
    .catch(() => undefined);
  await ready;
  await client.close();
  await pending;
  await delegator.close();
  expect(aborted).toBe(true);
});

it('native permissions require explicit host elicitation, never a model argument', async () => {
  const { ElicitRequestSchema } = await import('@modelcontextprotocol/sdk/types.js');
  let approved: string | undefined;
  const server = createMcpServer({
    delegator: { delegate: vi.fn(), close: async () => {} },
    health: async () => ({}),
    tasks: {
      websearch: vi.fn(),
      close: async () => {},
      runTask: async (r, s, permission) => {
        approved = await permission?.(
          {
            sessionId: 's',
            toolCallId: 'c',
            title: 'write synthetic artifact',
            details: 'Path: /test/artifact.txt',
            deadlineAt: Date.now() + 5000,
          },
          s,
        );
        return {
          requestId: r.requestId,
          mode: 'native',
          status: 'failed',
          fallback: 'none',
          sideEffects: 'unknown',
          warnings: [],
          elapsedMs: 0,
          reason: { code: 'TEST', message: 'test' },
        };
      },
    },
  });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client(
    { name: 'host-test', version: '1' },
    { capabilities: { elicitation: { form: {} } } },
  );
  client.setRequestHandler(ElicitRequestSchema, async (r) => {
    expect(r.params.message).toContain('/test/artifact.txt');
    return { action: 'accept', content: { decision: 'allow_once' } };
  });
  await server.connect(a);
  await client.connect(b);
  const r = {
    kind: 'initial',
    requestId: 'r',
    scope: { host: 'codex', workspaceRoot: '/test', hostTaskId: 't' },
    invocation: 'explicit',
    externalProcessingAllowed: true,
    providerRequirement: 'preferred',
    context: [],
    task: 'write fixture',
    workspace: { cwd: '/test', readRoots: ['/test'], writeRoots: ['/test'] },
    authorization: {
      useAgyConfiguration: true,
      summary: 'test',
      allowedActions: ['write'],
      prohibitedActions: [],
    },
  };
  try {
    expect((await client.listTools()).tools.map((t) => t.name)).toContain('agy_websearch');
    await client.callTool({ name: 'agy_run_task', arguments: { request: r } });
    expect(approved).toBe('allow_once');
    const invalid = await client.callTool({
      name: 'agy_run_task',
      arguments: { request: { ...r, approve: true } },
    });
    expect(invalid.isError).toBe(true);
  } finally {
    await client.close();
    await server.close();
  }
});
