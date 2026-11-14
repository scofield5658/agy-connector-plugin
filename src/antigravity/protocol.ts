import { z } from 'zod';
import { nativeOutputSchema, type RunTurnResult } from '../contracts.js';
const invalid = (): RunTurnResult => ({
  ok: false,
  code: 'INVALID_OUTPUT',
  message: '没有可验证的结构化结果。',
});
const envelope = z.object({
  event: z.literal('result'),
  result: z.object({
    conversation_id: z.string().min(1),
    status: z.literal('SUCCESS'),
    structured_output: nativeOutputSchema,
  }),
});
export function parseResultEvent(event: unknown): RunTurnResult {
  const parsed = envelope.safeParse(event);
  return parsed.success
    ? {
        ok: true,
        output: parsed.data.result.structured_output,
        conversationId: parsed.data.result.conversation_id,
        warnings: [],
      }
    : invalid();
}
export function decodeTranscript(
  stdout: string,
  stderr: string,
  exitCode: number | null,
): RunTurnResult {
  if (/permission.{0,30}(denied|blocked)|not permitted|tool.{0,30}denied/i.test(stderr))
    return { ok: false, code: 'PERMISSION_DENIED', message: '受限工具请求被拒绝。' };
  if (exitCode !== 0 || stderr.trim())
    return {
      ok: false,
      code: /rate.?limit|quota exceeded|429/i.test(stderr)
        ? 'RATE_LIMITED'
        : /unauthenticated|not logged in|login required/i.test(stderr)
          ? 'AUTH_REQUIRED'
          : 'CLI_ERROR',
      message: 'CLI 未正常完成。',
    };
  try {
    const events = stdout
      .split(/\r?\n/)
      .filter((x) => x.trim())
      .map((x) => JSON.parse(x) as Record<string, unknown>);
    if (events.some((e) => !e || typeof e !== 'object' || typeof e.event !== 'string'))
      return invalid();
    const final = events.filter((e) => e.event === 'result');
    if (final.length !== 1) return invalid();
    let finishFailed = false;
    for (const e of events) {
      if (e.event === 'error') return { ok: false, code: 'CLI_ERROR', message: 'CLI 报告错误。' };
      if (e.event === 'step_update') {
        const step = e.step_update as { state?: string; step_type?: string } | undefined;
        if (step?.step_type === 'finish') {
          if (step.state === 'ERROR' || step.state === 'FAILED') finishFailed = true;
          if (step.state === 'DONE') finishFailed = false;
          continue;
        }
        if (step?.state === 'ERROR' || step?.state === 'FAILED')
          return { ok: false, code: 'CLI_ERROR', message: 'CLI 步骤失败。' };
        // The verified agent permits only finish. Never accept an external tool run as text processing.
        if (
          step?.step_type &&
          !['user_input', 'agent_response', 'system_message', 'finish'].includes(step.step_type)
        )
          return { ok: false, code: 'PERMISSION_DENIED', message: '出现超出文本处理范围的步骤。' };
      }
    }
    if (finishFailed)
      return { ok: false, code: 'INVALID_OUTPUT', message: '结构化输出未完成校验。' };
    return parseResultEvent(final[0]);
  } catch {
    return invalid();
  }
}
