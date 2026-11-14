import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { detectCapabilities } from '../src/antigravity/capabilities.js';
import { resolveExecutable } from '../src/antigravity/executable.js';
import { verifiedPolicy } from '../src/antigravity/policy.js';
import { createAgyDriver } from '../src/antigravity/driver.js';
import { createDelegator } from '../src/delegation/engine.js';
import { defaultConfig } from '../src/config.js';
import { polishWorkflow } from '../src/workflows/polish.js';
import { generalWorkflow } from '../src/workflows/general.js';
import type { InitialRequest } from '../src/contracts.js';
const executable = await resolveExecutable();
if (!executable) throw Error('AGY unavailable');
const capabilities = await detectCapabilities(executable, new AbortController().signal);
if (!verifiedPolicy(capabilities).supported) {
  console.log(
    JSON.stringify({
      status: 'blocked',
      reason: 'ISOLATION_UNVERIFIED',
      message: '全局和插件启动隔离未验证；不调用模型。',
    }),
  );
  process.exit(2);
}
const engine = createDelegator({
  driver: createAgyDriver({ executable, capabilities, policy: verifiedPolicy(capabilities) }),
  config: defaultConfig,
  workflows: { 'zh-polish': polishWorkflow, general: generalWorkflow },
  clock: { now: Date.now },
});
const samples = JSON.parse(await readFile('tests/fixtures/documents/samples.json', 'utf8')) as {
  id: string;
  text: string;
  goal: string;
}[];
const results: unknown[] = [];
try {
  for (let i = 0; i < samples.length; i += 2) {
    await Promise.all(
      samples.slice(i, i + 2).map(async (sample) => {
        const r: InitialRequest = {
          kind: 'initial',
          requestId: sample.id,
          scope: { host: 'codex', workspaceRoot: '/synthetic-evaluation', hostTaskId: sample.id },
          profile: 'zh-polish',
          invocation: 'automatic',
          operation: 'transform',
          documentKind: 'document',
          text: sample.text,
          goal: sample.goal,
          context: [],
          constraints: [],
          protectedText: [],
          externalProcessingAllowed: true,
          providerRequirement: 'preferred',
        };
        const result = await engine.delegate(r, new AbortController().signal);
        const row = { id: sample.id, original: sample.text, ...result };
        results.push(row);
        console.log(JSON.stringify(row));
      }),
    );
  }
} finally {
  await engine.close();
}
await mkdir('.local', { recursive: true });
await writeFile('.local/evaluation.json', JSON.stringify(results, null, 2) + '\n');
