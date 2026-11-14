import type { RunTurnResult } from '../contracts.js';
import { searchOutputSchema } from './contracts.js';
export const failure = (
  code: string,
  message = 'Antigravity 未返回可验证的结果。',
): RunTurnResult => ({ ok: false, code, message });
export function decodeSearchTranscript(
  stdout: string,
  stderr: string,
  exitCode: number | null,
): RunTurnResult {
  if (exitCode !== 0 || stderr.trim())
    return failure(
      /unauthenticated|not logged in|login required/i.test(stderr) ? 'AUTH_REQUIRED' : 'CLI_ERROR',
    );
  try {
    const events = stdout
      .split(/\r?\n/)
      .filter((x) => x.trim())
      .map((x) => JSON.parse(x));
    const final = events.filter((e) => e.event === 'result');
    if (final.length !== 1) return failure('INVALID_OUTPUT');
    const queries: string[] = [];
    let finishFailed = false;
    for (const e of events) {
      if (!e || typeof e.event !== 'string') return failure('INVALID_OUTPUT');
      if (e.event === 'error') return failure('CLI_ERROR');
      if (e.event !== 'step_update') continue;
      const s = e.step_update;
      if (s?.step_type === 'finish') {
        if (['ERROR', 'FAILED'].includes(s.state)) finishFailed = true;
        else if (s.state === 'DONE') finishFailed = false;
        continue;
      }
      if (['ERROR', 'FAILED'].includes(s?.state)) return failure('CLI_ERROR');
      if (['user_input', 'agent_response', 'system_message'].includes(s?.step_type)) continue;
      if (s?.step_type !== 'tool' || s.tool_name !== 'search_web')
        return failure('PERMISSION_DENIED');
      if (s.state === 'DONE') {
        const q = s.tool_info?.parameters?.query;
        if (typeof q !== 'string' || !q.trim()) return failure('INVALID_OUTPUT');
        queries.push(q);
      }
    }
    if (!queries.length) return failure('SEARCH_NOT_EXECUTED');
    if (queries.length > 5 || finishFailed) return failure('INVALID_OUTPUT');
    const result = final[0].result;
    if (
      result?.status !== 'SUCCESS' ||
      typeof result.conversation_id !== 'string' ||
      !result.conversation_id
    )
      return failure('CLI_ERROR');
    const output = searchOutputSchema.safeParse({
      ...result.structured_output,
      queries: [...new Set(queries)],
    });
    if (!output.success) return failure('INVALID_OUTPUT');
    return {
      ok: true,
      conversationId: result.conversation_id,
      output: { kind: 'candidate', text: JSON.stringify(output.data), notes: [] },
      warnings: ['HOST_SOURCE_REVIEW_REQUIRED'],
    };
  } catch {
    return failure('INVALID_OUTPUT');
  }
}
