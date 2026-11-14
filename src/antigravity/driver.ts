import { isAbsolute } from 'node:path';
import { z } from 'zod';
import { type AgyDriver } from '../contracts.js';
import type { CapabilityReport } from './capabilities.js';
import { AGENT_NAME, SETTINGS, prepareWorkspace, type TextOnlyPolicy } from './policy.js';
import { runProcess } from './process.js';
import { decodeTranscript } from './protocol.js';
export type AgyRuntimeConfig = {
  executable: string;
  capabilities: CapabilityReport;
  policy: TextOnlyPolicy;
};
// agy exposes top-level properties to finish; a union-only root loses field guidance.
const finishSchema = z.strictObject({
  kind: z.enum(['candidate', 'needs_context']),
  text: z.string().optional(),
  notes: z.array(z.string()).optional(),
  questions: z.array(z.string()).optional(),
});
export function createAgyDriver(config: AgyRuntimeConfig): AgyDriver {
  let disabled = false;
  return {
    async runTurn(input, signal) {
      if (disabled)
        return { ok: false, code: 'INSTANCE_DISABLED', message: '上次进程回收未确认。' };
      if (!isAbsolute(config.executable) || !config.capabilities.supported)
        return { ok: false, code: 'CLI_UNAVAILABLE', message: 'CLI 不可用或缺少所需能力。' };
      if (!config.policy.supported)
        return {
          ok: false,
          code: 'ISOLATION_UNVERIFIED',
          message: '当前平台或 CLI 版本的权限隔离尚未验证。',
        };
      const profile = await prepareWorkspace(input.workspaceDir);
      const args = [
        '--gemini_dir',
        profile,
        '--agent',
        AGENT_NAME,
        '--input-format',
        'stream-json',
        '--output-format',
        'stream-json',
        '--json-schema',
        JSON.stringify(z.toJSONSchema(finishSchema)),
        '--disable-slash-commands',
        '--settings',
        JSON.stringify(SETTINGS),
        '--print-timeout',
        `${Math.max(1, Math.floor((input.deadlineAt - Date.now() - 2000) / 1000))}s`,
      ];
      if (input.conversationId) args.push('--conversation', input.conversationId);
      if (input.model) args.push('--model', input.model);
      const proc = await runProcess({
        executable: config.executable,
        args,
        cwd: input.workspaceDir,
        input: JSON.stringify({ event: 'user', message: { content: input.prompt } }) + '\n',
        signal,
        deadlineAt: input.deadlineAt,
        env: { ...process.env, AGY_CLI_DISABLE_AUTO_UPDATE: 'true' },
      });
      if (!proc.ok) {
        if (proc.cleanupWarning) disabled = true;
        return { ...proc, message: `CLI 调用未完成（${proc.code}）。` };
      }
      const result = decodeTranscript(proc.stdout, proc.stderr, proc.exitCode);
      if (result.ok && input.conversationId && result.conversationId !== input.conversationId)
        return { ok: false, code: 'SESSION_MISMATCH', message: 'CLI 未续接指定会话。' };
      return result;
    },
  };
}
