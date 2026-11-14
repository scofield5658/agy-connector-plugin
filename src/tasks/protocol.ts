import type { RunTurnResult } from '../contracts.js';
import { searchOutputSchema } from './contracts.js';
export const failure = (
  code: string,
  message = 'Antigravity 未返回可验证的结果。',
): RunTurnResult => ({ ok: false, code, message });
export const searchStderrCode = (stderr: string) =>
  /unauthenticated|not logged in|login required/i.test(stderr) ? 'AUTH_REQUIRED' : 'CLI_ERROR';
type Step = { step_type?: string; tool_name?: string; state?: string } | undefined;
/** Failure code for one transcript event that already decides the outcome. */
export function searchEventFailure(e: { event?: unknown; step_update?: unknown } | null) {
  if (!e || typeof e.event !== 'string') return 'INVALID_OUTPUT';
  if (e.event === 'error') return 'CLI_ERROR';
  if (e.event !== 'step_update') return undefined;
  const s = e.step_update as Step;
  if (s?.step_type === 'finish') return undefined;
  if (['ERROR', 'FAILED'].includes(s?.state ?? '')) return 'CLI_ERROR';
  if (['user_input', 'agent_response', 'system_message'].includes(s?.step_type ?? ''))
    return undefined;
  if (s?.step_type !== 'tool' || s.tool_name !== 'search_web') return 'PERMISSION_DENIED';
  return undefined;
}
export const isCompletedSearch = (e: { event?: unknown; step_update?: unknown }) => {
  const s = e.step_update as Step;
  return (
    e.event === 'step_update' &&
    s?.step_type === 'tool' &&
    s.tool_name === 'search_web' &&
    s.state === 'DONE'
  );
};
export function decodeSearchTranscript(
  stdout: string,
  stderr: string,
  exitCode: number | null,
): RunTurnResult {
  if (exitCode !== 0 || stderr.trim()) return failure(searchStderrCode(stderr));
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
      const code = searchEventFailure(e);
      if (code) return failure(code);
      if (e.event !== 'step_update') continue;
      const s = e.step_update;
      if (s?.step_type === 'finish') {
        if (['ERROR', 'FAILED'].includes(s.state)) finishFailed = true;
        else if (s.state === 'DONE') finishFailed = false;
        continue;
      }
      if (isCompletedSearch(e)) {
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
