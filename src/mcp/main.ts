import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMcpServer } from './server.js';
import { createDelegator } from '../delegation/engine.js';
import { defaultConfig, readConfig } from '../config.js';
import { resolveExecutable } from '../antigravity/executable.js';
import { detectCapabilities, type CapabilityReport } from '../antigravity/capabilities.js';
import { verifiedPolicy } from '../antigravity/policy.js';
import { createAgyDriver } from '../antigravity/driver.js';
import { createPolishWorkflow } from '../workflows/polish.js';
import { generalWorkflow } from '../workflows/general.js';
import { createProcessLimiter, limitDriver } from '../antigravity/limiter.js';
import { createTaskService, readTaskConfig } from '../tasks/service.js';
async function main() {
  let config = defaultConfig,
    configValid = true;
  try {
    config = readConfig();
  } catch {
    configValid = false;
  }
  const executable = await resolveExecutable();
  const caps: CapabilityReport = executable
    ? await detectCapabilities(executable, new AbortController().signal)
    : {
        available: false,
        supported: false,
        requiredFlags: [],
        reason: 'CLI_UNAVAILABLE',
        auth: 'unknown',
      };
  const policy = verifiedPolicy(caps);
  const limiter = createProcessLimiter();
  let taskConfig,
    taskConfigValid = true;
  try {
    taskConfig = readTaskConfig();
  } catch {
    taskConfigValid = false;
  }
  const driver = configValid
    ? createAgyDriver({ executable: executable ?? '', capabilities: caps, policy })
    : {
        runTurn: async () => ({
          ok: false as const,
          code: 'CONFIG_INVALID',
          message: '插件配置无效。',
        }),
      };
  const delegator = createDelegator({
    driver: limitDriver(driver, limiter),
    workflows: {
      'zh-polish': createPolishWorkflow(config.chineseRatioThreshold),
      general: generalWorkflow,
    },
    config,
    clock: { now: Date.now },
    onCleanupUnconfirmed: limiter.disable,
  });
  const tasks = createTaskService({
    runtime: { executable: executable ?? '', capabilities: caps, policy },
    limiter,
    config: taskConfig,
    maxTurns: config.maxTurns,
    idleTimeoutMs: config.idleTimeoutMs,
    ...(!configValid || !taskConfigValid
      ? {
          driver: {
            runTurn: async () => ({
              ok: false as const,
              code: 'CONFIG_INVALID',
              message: '插件配置无效。',
            }),
          },
        }
      : {}),
  });
  const server = createMcpServer({
    delegator,
    tasks,
    health: async () => ({
      ...caps,
      policy,
      configValid,
      ready: configValid && caps.supported && policy.supported && !limiter.disabled,
      modes: {
        polish: configValid && policy.supported && !limiter.disabled,
        websearch: configValid && taskConfigValid && policy.supported && !limiter.disabled,
        native: configValid && taskConfigValid && policy.supported && !limiter.disabled,
      },
      taskConfigValid,
      permissionTransport: 'mcp-elicitation-form',
      auth: 'unknown',
      runtime: 'node',
      platform: process.platform,
    }),
  });
  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    await Promise.all([delegator.close(), tasks.close()]);
    await server.close();
  };
  process.once('SIGINT', () => {
    void shutdown();
  });
  process.once('SIGTERM', () => {
    void shutdown();
  });
  await server.connect(new StdioServerTransport());
}
main().catch(() => {
  process.stderr.write('agy-connector-plugin: MCP 启动失败，请检查本地运行时。\n');
  process.exitCode = 1;
});
