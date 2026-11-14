import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { requestSchema, resultSchema, type Delegator } from '../contracts.js';
import packageInfo from '../../package.json' with { type: 'json' };
import {
  searchRequestSchema,
  taskRequestSchema,
  toolResultSchema,
  type ToolTaskService,
  type PermissionHandler,
} from '../tasks/contracts.js';
export function createMcpServer(deps: {
  delegator: Delegator;
  health: () => Promise<Record<string, unknown>>;
  tasks?: ToolTaskService;
}) {
  const server = new McpServer({ name: 'agy-connector-plugin', version: packageInfo.version });
  server.registerTool(
    'agy_delegate',
    {
      description:
        '将宿主提供的文稿和必要上下文交给 Antigravity CLI。中文文档可自动润色；general 仅用于用户明确委托。失败返回 fallback，由宿主继续。不会写目标文件。',
      inputSchema: z.strictObject({ request: requestSchema }),
      outputSchema: resultSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ request }, extra) => {
      const result = resultSchema.parse(await deps.delegator.delegate(request, extra.signal));
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        structuredContent: result,
      };
    },
  );
  server.registerTool(
    'agy_health',
    {
      description:
        '检查本地 Antigravity CLI 版本、能力和隔离适配状态。不调用模型；登录态为 unknown。',
      inputSchema: z.strictObject({}),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      const result = await deps.health();
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        structuredContent: result,
      };
    },
  );
  server.server.onclose = () => {
    void deps.delegator.close();
    void deps.tasks?.close();
  };
  if (deps.tasks) {
    server.registerTool(
      'agy_websearch',
      {
        description:
          '仅在用户明确指定时使用 Antigravity 的 Google 网页搜索。独立临时空间，不开放本地文件、Shell 或 MCP。返回实际查询、答案和待核验来源；失败不重试。',
        inputSchema: z.strictObject({ request: searchRequestSchema }),
        outputSchema: toolResultSchema,
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: true,
        },
      },
      async ({ request }, extra) => {
        const r = toolResultSchema.parse(await deps.tasks!.websearch(request, extra.signal));
        return { content: [{ type: 'text', text: JSON.stringify(r) }], structuredContent: r };
      },
    );
    server.registerTool(
      'agy_run_task',
      {
        description:
          '用户明确委托 agy 在共享项目目录处理任务。使用 agy 自有配置和工具，可产生文件及外部副作用；授权通过宿主确认，不自动放宽。失败后先核对状态再接手。',
        inputSchema: z.strictObject({ request: taskRequestSchema }),
        outputSchema: toolResultSchema,
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: false,
          openWorldHint: true,
        },
      },
      async ({ request }, extra) => {
        const capability = server.server.getClientCapabilities()?.elicitation;
        const permission: PermissionHandler | undefined =
          capability && ('form' in capability || !('url' in capability))
            ? async (prompt, signal) => {
                if (signal.aborted || Date.now() >= prompt.deadlineAt) return 'cancel';
                const result = await server.server.elicitInput(
                  {
                    mode: 'form',
                    message: `agy 请求本次操作授权：${prompt.title}\n该决定仅用于当前任务的这一次操作；任务预算到期后失效。\n${prompt.details}`,
                    requestedSchema: {
                      type: 'object',
                      properties: {
                        decision: {
                          type: 'string',
                          title: '是否允许本次操作？',
                          enum: ['allow_once', 'deny_once'],
                          enumNames: ['仅本次允许', '拒绝'],
                          default: 'deny_once',
                        },
                      },
                      required: ['decision'],
                    },
                  },
                  { signal, timeout: Math.max(1, prompt.deadlineAt - Date.now()) },
                );
                if (signal.aborted || result.action === 'cancel') return 'cancel';
                return result.action === 'accept' && result.content?.decision === 'allow_once'
                  ? 'allow_once'
                  : 'deny_once';
              }
            : undefined;
        const r = toolResultSchema.parse(
          await deps.tasks!.runTask(request, extra.signal, permission),
        );
        return { content: [{ type: 'text', text: JSON.stringify(r) }], structuredContent: r };
      },
    );
  }
  return server;
}
