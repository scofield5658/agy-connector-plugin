import { it, expect } from 'vitest';
import { parseResultEvent, decodeTranscript } from '../src/antigravity/protocol.js';
it('response_text_is_not_structured_output', () => {
  expect(
    parseResultEvent({
      event: 'result',
      result: {
        status: 'SUCCESS',
        conversation_id: 'x',
        response: '{"kind":"candidate","text":"正文"}',
      },
    }),
  ).toMatchObject({ ok: false, code: 'INVALID_OUTPUT' });
});
it('needs_context requires nonempty questions', () => {
  expect(
    parseResultEvent({
      event: 'result',
      result: {
        status: 'SUCCESS',
        conversation_id: 'x',
        structured_output: { kind: 'needs_context', questions: [] },
      },
    }),
  ).toMatchObject({ ok: false, code: 'INVALID_OUTPUT' });
});
it('accepts native system_message emitted when resuming a conversation', () => {
  const lines = [
    { event: 'step_update', step_update: { state: 'DONE', step_type: 'system_message' } },
    {
      event: 'result',
      result: {
        status: 'SUCCESS',
        conversation_id: 'x',
        structured_output: { kind: 'candidate', text: '预计暂停30分钟。', notes: [] },
      },
    },
  ];
  expect(decodeTranscript(lines.map((x) => JSON.stringify(x)).join('\n'), '', 0)).toMatchObject({
    ok: true,
  });
});
it('accepts a native finish schema correction, but never a failed external tool', () => {
  const result = {
    event: 'result',
    result: {
      status: 'SUCCESS',
      conversation_id: 'x',
      structured_output: { kind: 'candidate', text: '原稿。', notes: [] },
    },
  };
  const encode = (type: string) =>
    [
      { event: 'step_update', step_update: { state: 'ERROR', step_type: type } },
      { event: 'step_update', step_update: { state: 'DONE', step_type: 'finish' } },
      result,
    ]
      .map((x) => JSON.stringify(x))
      .join('\n');
  expect(decodeTranscript(encode('finish'), '', 0)).toMatchObject({ ok: true });
  expect(decodeTranscript(encode('run_command'), '', 0)).toMatchObject({ ok: false });
});
