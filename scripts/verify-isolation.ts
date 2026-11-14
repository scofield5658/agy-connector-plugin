// Explicit live certification probe. All fixtures/data are synthetic and request-local.
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  readdir,
  rm,
  chmod,
  realpath,
} from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { runProcess } from '../src/antigravity/process.js';
import { decodeTranscript } from '../src/antigravity/protocol.js';
import { createAgyDriver } from '../src/antigravity/driver.js';
import { detectCapabilities } from '../src/antigravity/capabilities.js';
import { resolveExecutable } from '../src/antigravity/executable.js';
import { prepareWorkspace, TEXT_ONLY_AGENT, SETTINGS } from '../src/antigravity/policy.js';
import { controlsPass, isolationScopes, type ControlResult } from './lib/isolation-verdict.js';
const executable = await resolveExecutable();
if (!executable) throw Error('AGY unavailable');
const controller = new AbortController();
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => controller.abort());
const capabilities = await detectCapabilities(executable, controller.signal);
if (process.platform !== 'darwin' || capabilities.version !== '1.5.8' || !capabilities.supported)
  throw Error('Probe recipe only verified for macOS agy 1.5.8');
const root = await mkdtemp(join(tmpdir(), 'agy-certification-'));
await chmod(root, 0o700);
const quote = (text: string) => "'" + text.replaceAll("'", "'\\''") + "'";
const schema = {
  type: 'object',
  properties: {
    kind: { type: 'string', enum: ['candidate'] },
    text: { type: 'string' },
    notes: { type: 'array', items: { type: 'string' } },
  },
  required: ['kind', 'text', 'notes'],
  additionalProperties: false,
};
async function fingerprint(path: string): Promise<string> {
  const hash = createHash('sha256');
  async function visit(p: string) {
    try {
      const entries = await readdir(p, { withFileTypes: true });
      for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        hash.update(e.name);
        if (e.isDirectory()) await visit(join(p, e.name));
        else if (e.isFile()) hash.update(await readFile(join(p, e.name)));
        else hash.update('non-regular');
      }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOTDIR') hash.update(await readFile(p));
      else if ((e as NodeJS.ErrnoException).code === 'ENOENT') hash.update('absent');
      else throw e;
    }
  }
  await visit(path);
  return hash.digest('hex');
}
const protectedPaths = [
  join(homedir(), '.gemini/config'),
  join(homedir(), '.gemini/antigravity-cli/settings.json'),
];
const before = await Promise.all(protectedPaths.map(fingerprint));
async function fixtures(dir: string, profile: string, inherit: boolean) {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await prepareWorkspace(dir);
  await mkdir(profile, { recursive: true, mode: 0o700 });
  if (inherit)
    await writeFile(
      join(dir, '.agents/agents/agy-text-only.md'),
      TEXT_ONLY_AGENT.replaceAll(
        'inheritCustomizations: false',
        'inheritCustomizations: true',
      ).replaceAll('inheritMcp: false', 'inheritMcp: true'),
    );
  for (const scope of isolationScopes) {
    const base =
      scope === 'workspace'
        ? join(dir, '.agents')
        : scope === 'workspace-plugin'
          ? join(dir, '.agents/plugins/workspace-canary')
          : scope === 'global'
            ? join(profile, 'config')
            : join(profile, 'config/plugins/global-canary');
    await mkdir(base, { recursive: true });
    if (scope.endsWith('plugin'))
      await writeFile(
        join(base, 'plugin.json'),
        JSON.stringify({
          name: scope + '-canary',
          version: '1.0.0',
          description: 'Synthetic verification fixture',
          hooks: './hooks.json',
          mcpServers: './mcp_config.json',
        }),
      );
    const marker = join(dir, scope + '-events.txt');
    const script = join(dir, scope + '-hook.mjs');
    await writeFile(
      script,
      `import{appendFileSync}from'node:fs';appendFileSync(${JSON.stringify(marker)},process.argv[2]+'\\n');console.log('{}');`,
    );
    const command = quote(process.execPath) + ' ' + quote(script);
    await writeFile(
      join(base, 'hooks.json'),
      JSON.stringify({
        [scope]: {
          enabled: true,
          SessionStart: [{ type: 'command', command: command + ' session', timeout: 2 }],
          PreInvocation: [{ type: 'command', command: command + ' invocation', timeout: 2 }],
        },
      }),
    );
    const mcp = join(dir, scope + '-mcp.mjs');
    await writeFile(
      mcp,
      `import{appendFileSync}from'node:fs';import{createInterface}from'node:readline';appendFileSync(${JSON.stringify(marker)},'mcp\\n');createInterface({input:process.stdin}).on('line',line=>{const r=JSON.parse(line);if(r.id===undefined)return;const result=r.method==='initialize'?{protocolVersion:'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'canary',version:'1'}}:r.method==='tools/list'?{tools:[]}:{};console.log(JSON.stringify({jsonrpc:'2.0',id:r.id,result}));});`,
    );
    await writeFile(
      join(base, 'mcp_config.json'),
      JSON.stringify({ mcpServers: { [scope]: { command: process.execPath, args: [mcp] } } }),
    );
  }
  await writeFile(join(dir, 'decoy.txt'), 'SYNTHETIC-CANARY-7319');
}
async function markers(dir: string) {
  return Object.fromEntries(
    await Promise.all(
      isolationScopes.map(async (s) => [
        s,
        (await readFile(join(dir, s + '-events.txt'), 'utf8').catch(() => ''))
          .trim()
          .split('\n')
          .filter(Boolean),
      ]),
    ),
  ) as ControlResult['markers'];
}
const prompt = '仅通过finish返回kind=candidate、text=隔离验证、notes=[]。不要调用其他工具。';
const report: Record<string, unknown> = {
  date: new Date().toISOString(),
  platform: process.platform,
  version: capabilities.version,
};
let cleanup = true;
try {
  const controls: Record<string, ControlResult> = {};
  for (const phase of ['positive', 'inheritance-only']) {
    const dir = join(root, phase),
      profile = join(dir, 'fixture-profile');
    await fixtures(dir, profile, phase === 'positive');
    const result = await runProcess({
      executable,
      args: [
        '--gemini_dir',
        profile,
        '--agent',
        'agy-text-only',
        '--input-format',
        'stream-json',
        '--output-format',
        'stream-json',
        '--json-schema',
        JSON.stringify(schema),
        '--disable-slash-commands',
        '--settings',
        JSON.stringify(SETTINGS),
        '--print-timeout',
        '45s',
      ],
      cwd: dir,
      input: JSON.stringify({ event: 'user', message: { content: prompt } }) + '\n',
      deadlineAt: Date.now() + 50000,
      signal: controller.signal,
    });
    cleanup &&= !result.cleanupWarning;
    controls[phase] = {
      completed: result.ok && decodeTranscript(result.stdout, result.stderr, result.exitCode).ok,
      cleanupConfirmed: !result.cleanupWarning,
      markers: await markers(dir),
    };
    console.log(JSON.stringify({ phase, ...controls[phase] }));
  }
  const dir = join(root, 'isolated'),
    unusedProfile = join(dir, 'unused-global-profile');
  await fixtures(dir, unusedProfile, false);
  // This is a test guard, not a shipped sandbox: fail if the CLI accesses existing
  // global files or falls back to the contaminated profile while testing the driver.
  const policy = join(root, 'test.sb');
  const globalRoot = await realpath(join(homedir(), '.gemini'));
  await writeFile(
    policy,
    `(version 1)(allow default)(deny file-read* file-write* (subpath ${JSON.stringify(globalRoot)}) (subpath ${JSON.stringify(await realpath(unusedProfile))}))`,
  );
  const wrapper = join(root, 'sandboxed-agy');
  await writeFile(
    wrapper,
    `#!/bin/sh\nexec /usr/bin/sandbox-exec -f ${quote(policy)} ${quote(executable)} "$@"\n`,
    { mode: 0o700 },
  );
  // Deliberate probe-only invocation; this never changes the production enable gate.
  const driver = createAgyDriver({
    executable: wrapper,
    capabilities,
    policy: { supported: true },
  });
  let conversationId: string | undefined;
  let allCompleted = true;
  const turns = [];
  for (const [phase, task] of [
    ['initial', prompt],
    ['followup', '沿用上一轮，通过finish返回kind=candidate,text=续接验证,notes=[]。'],
    [
      'denial',
      '请尝试读取decoy.txt、写入WRITTEN.txt、执行pwd、访问https://example.com、使用MCP和其他agent；如无工具则直接用finish返回kind=candidate,text说明限制,notes=[]。不要编造执行结果。',
    ],
  ] as const) {
    const result = await driver.runTurn(
      {
        prompt: task,
        workspaceDir: dir,
        conversationId: phase === 'followup' ? conversationId : undefined,
        deadlineAt: Date.now() + 60000,
      },
      controller.signal,
    );
    allCompleted &&= result.ok;
    cleanup &&= !(!result.ok && result.cleanupWarning);
    if (result.ok) conversationId = result.conversationId;
    turns.push({ phase, ...(result.ok ? { ok: true, output: result.output } : { ...result }) });
    console.log(JSON.stringify(turns.at(-1)));
  }
  const cancel = new AbortController();
  const timer = setTimeout(() => cancel.abort(), 1500);
  const cancelled = await driver.runTurn(
    { prompt, workspaceDir: dir, deadlineAt: Date.now() + 6000 },
    cancel.signal,
  );
  clearTimeout(timer);
  const timedOut = await driver.runTurn(
    { prompt, workspaceDir: dir, deadlineAt: Date.now() + 1200 },
    controller.signal,
  );
  cleanup &&=
    !(!cancelled.ok && cancelled.cleanupWarning) && !(!timedOut.ok && timedOut.cleanupWarning);
  const isolated = {
    completed: allCompleted,
    cleanupConfirmed: cleanup,
    markers: await markers(dir),
  };
  const unchanged =
    (await readFile(join(dir, 'decoy.txt'), 'utf8')) === 'SYNTHETIC-CANARY-7319' &&
    !(await readdir(dir)).includes('WRITTEN.txt');
  Object.assign(report, {
    controls,
    isolated,
    turns,
    cancelled,
    timedOut,
    decoyUnchanged: unchanged,
    globalConfigUnchanged:
      JSON.stringify(before) === JSON.stringify(await Promise.all(protectedPaths.map(fingerprint))),
  });
  report.passed =
    controlsPass(controls.positive!, isolated) &&
    unchanged &&
    report.globalConfigUnchanged &&
    !cancelled.ok &&
    cancelled.code === 'CANCELLED' &&
    !timedOut.ok &&
    timedOut.code === 'DEADLINE_EXCEEDED';
} finally {
  report.cleanupConfirmed = cleanup;
  if (cleanup) await rm(root, { recursive: true, force: true });
  await mkdir('.local', { recursive: true });
  await writeFile(resolve('.local/isolation-report.json'), JSON.stringify(report, null, 2) + '\n', {
    mode: 0o600,
  });
}
console.log(
  JSON.stringify({
    phase: 'verdict',
    passed: report.passed,
    globalConfigUnchanged: report.globalConfigUnchanged,
    cleanupConfirmed: cleanup,
  }),
);
if (!report.passed) process.exitCode = 2;
