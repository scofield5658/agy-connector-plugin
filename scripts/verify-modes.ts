// Explicit live acceptance: public search and synthetic writes in an owned temporary profile.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, realpath } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ElicitRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { resolveExecutable } from '../src/antigravity/executable.js';
import { detectCapabilities } from '../src/antigravity/capabilities.js';
import { verifiedPolicy } from '../src/antigravity/policy.js';
import { createTaskService } from '../src/tasks/service.js';
import { toolResultSchema } from '../src/tasks/contracts.js';
import { createMcpServer } from '../src/mcp/server.js';
const executable = await resolveExecutable();
assert(executable, 'agy unavailable');
const capabilities = await detectCapabilities(executable, new AbortController().signal);
const policy = verifiedPolicy(capabilities);
assert(policy.supported, 'This platform/version has not passed isolation verification');
const paths = [
  '.gemini/config/hooks.json',
  '.gemini/config/mcp.json',
  '.gemini/antigravity-cli/settings.json',
  '.codex/config.toml',
  '.cursor/cli-config.json',
];
async function snapshot() {
  return Promise.all(
    paths.map(async (p) => {
      try {
        return createHash('sha256')
          .update(await readFile(join(homedir(), p)))
          .digest('hex');
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw e;
      }
    }),
  );
}
const before = await snapshot();
const root = await realpath(await mkdtemp(join(tmpdir(), 'agy-modes-')));
const workspace = join(root, 'project'),
  profile = join(root, 'profile');
await mkdir(workspace);
await mkdir(join(profile, 'antigravity-cli'), { recursive: true });
await writeFile(
  join(profile, 'antigravity-cli/settings.json'),
  JSON.stringify({
    toolPermission: 'request-review',
    permissions: { allow: [], ask: ['write_file(*)', 'command(*)'], deny: [] },
  }),
  { mode: 0o600 },
);
const quote = (s: string) => "'" + s.replaceAll("'", "'\\''") + "'";
const wrapper = join(root, 'agy-test');
await writeFile(
  wrapper,
  `#!/bin/sh\nif [ "$1" = acp ]; then\nexec ${quote(executable)} "$@" --gemini_dir ${quote(profile)}\nelse\nexec ${quote(executable)} "$@"\nfi\n`,
  { mode: 0o700 },
);
const tasks = createTaskService({ runtime: { executable: wrapper, capabilities, policy } });
const server = createMcpServer({
  tasks,
  health: async () => ({ ready: true }),
  delegator: {
    close: async () => {},
    delegate: async () => {
      throw Error('not used');
    },
  },
});
const client = new Client(
  { name: 'agy-live-acceptance', version: '1' },
  { capabilities: { elicitation: { form: {} } } },
);
let decision: 'allow' | 'deny' = 'allow',
  asks = 0,
  expectedPath = '';
client.setRequestHandler(ElicitRequestSchema, async (request) => {
  asks++;
  const message = request.params.message;
  const tool = JSON.parse(message.slice(message.indexOf('{')));
  const raw = tool.rawInput ?? tool.args;
  // Simulated consent is limited to the previously authorized synthetic fixture.
  const exact =
    tool.kind === 'edit' &&
    raw?.Path === expectedPath &&
    raw?.Content === 'SYNTHETIC-AGY-ACCEPTANCE';
  return {
    action: 'accept',
    content: { decision: decision === 'allow' && exact ? 'allow_once' : 'deny_once' },
  };
});
const [a, b] = InMemoryTransport.createLinkedPair();
await server.connect(a);
await client.connect(b);
const common = {
  kind: 'initial',
  scope: { host: 'codex', workspaceRoot: workspace, hostTaskId: 'isolated-acceptance' },
  invocation: 'explicit',
  externalProcessingAllowed: true,
  providerRequirement: 'preferred',
  context: [],
};
const results: unknown[] = [];
let cleanupConfirmed = true;
try {
  const search = toolResultSchema.parse(
    (
      await client.callTool(
        {
          name: 'agy_websearch',
          arguments: {
            request: {
              ...common,
              requestId: 'search',
              query: 'site:nodejs.org Node.js v22.12.0 正式发布日期',
              domains: ['nodejs.org'],
              language: '中文',
            },
          },
        },
        undefined,
        { timeout: 65000 },
      )
    ).structuredContent,
  );
  results.push(search);
  cleanupConfirmed &&= !search.warnings.includes('PROCESS_CLEANUP_UNCONFIRMED');
  console.log(
    JSON.stringify({
      case: 'websearch',
      status: search.status,
      reason: search.reason,
      search: search.search,
    }),
  );
  assert.equal(search.status, 'completed');
  assert(search.search?.queries.length);
  assert(
    search.search?.sources.some((s) =>
      ['nodejs.org', 'vertexaisearch.cloud.google.com'].includes(new URL(s.url).hostname),
    ),
  );
  assert(search.search?.answer.includes('2024'));
  for (const choice of ['allow', 'deny'] as const) {
    decision = choice;
    expectedPath = join(workspace, choice + '.txt');
    const startAsks = asks;
    const request = {
      ...common,
      requestId: choice,
      task: `这是合成验收。使用 write_file 工具在 ${expectedPath} 写入且仅写入 SYNTHETIC-AGY-ACCEPTANCE，不附加换行。不读其他文件、不运行命令、不联网。完成后简短报告。`,
      workspace: {
        cwd: workspace,
        readRoots: [workspace],
        writeRoots: [workspace],
        artifactDir: workspace,
      },
      authorization: {
        useAgyConfiguration: true,
        summary: '只允许本次合成测试文件，审批由测试客户端模拟',
        allowedActions: ['write'],
        prohibitedActions: ['命令', '联网', '其他文件'],
      },
    };
    const result = toolResultSchema.parse(
      (
        await client.callTool({ name: 'agy_run_task', arguments: { request } }, undefined, {
          timeout: 125000,
        })
      ).structuredContent,
    );
    results.push(result);
    console.log(
      JSON.stringify({
        case: choice,
        status: result.status,
        reason: result.reason,
        asks: asks - startAsks,
        task: result.task,
      }),
    );
    cleanupConfirmed &&= !result.warnings.includes('PROCESS_CLEANUP_UNCONFIRMED');
    assert.equal(asks - startAsks, 1);
    if (choice === 'allow') {
      assert.equal(result.status, 'completed');
      assert.equal(await readFile(expectedPath, 'utf8'), 'SYNTHETIC-AGY-ACCEPTANCE');
      assert(result.task?.artifacts.includes(expectedPath));
    } else {
      assert.equal(result.reason?.code, 'PERMISSION_DENIED');
      await assert.rejects(readFile(expectedPath), { code: 'ENOENT' });
      assert.equal(result.fallback, 'none');
    }
  }
  assert.deepEqual(await snapshot(), before);
  console.log(
    'Verified search, shared artifact, one-time consent, denial and unchanged global configuration.',
  );
} finally {
  await client.close();
  await tasks.close();
  await server.close();
  await mkdir('.local', { recursive: true });
  await writeFile('.local/modes-report.json', JSON.stringify(results, null, 2), { mode: 0o600 });
  if (cleanupConfirmed) await rm(root, { recursive: true, force: true });
  else console.error('Retained fixture after uncertain cleanup: ' + root);
}
