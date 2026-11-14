import { it, expect } from 'vitest';
import { request } from './helpers.js';
import { polishWorkflow } from '../src/workflows/polish.js';
import { generalWorkflow } from '../src/workflows/general.js';
it('ordinary_qa_is_skipped', () => {
  expect(polishWorkflow.prepare(request({ documentKind: 'other' })).applicable).toBe(false);
});
it.each([
  ['通知。', true],
  ['中文ab', true],
  ['中文abc', false],
  ['```js\nconst 中文 = 1\n```', false],
  ['', false],
])('automatic language threshold %s', (text, want) => {
  expect(polishWorkflow.prepare(request({ text: text as string })).applicable).toBe(want);
});
it('explicit bypasses language ratio but cannot override external prohibition', () => {
  expect(
    polishWorkflow.prepare(request({ text: 'Hello', invocation: 'explicit' })).applicable,
  ).toBe(true);
  expect(
    polishWorkflow.prepare(request({ externalProcessingAllowed: false, invocation: 'explicit' }))
      .applicable,
  ).toBe(false);
});
it('general_english_request_has_no_chinese_filter', () => {
  const p = generalWorkflow.prepare(
    request({
      profile: 'general',
      invocation: 'explicit',
      outputLanguage: 'English',
      goal: 'Translate this notice',
    }),
  );
  expect(p.applicable).toBe(true);
  if (p.applicable) expect(p.prompt).toContain('English');
});
it('general cannot execute or infer explicit intent from a name alone', () => {
  expect(generalWorkflow.prepare(request({ profile: 'general' })).applicable).toBe(false);
  expect(
    generalWorkflow.prepare(
      request({ profile: 'general', invocation: 'explicit', operation: 'execute' }),
    ).applicable,
  ).toBe(false);
});
