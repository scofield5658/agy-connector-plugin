import { it, expect } from 'vitest';
import { request } from './helpers.js';
import { polishWorkflow } from '../src/workflows/polish.js';
import { analyzeDocument } from '../src/workflows/protected-content.js';
it('link title delimiters cannot hide a changed destination', () => {
  const text = '中文[说明](https://example.com "title ](abc")';
  expect(
    polishWorkflow.validate(
      request({ text }),
      text.replace('https://example.com', 'https://attacker.example'),
    ).accepted,
  ).toBe(false);
});
it('shortcut references cannot silently become plain text', () => {
  const text = '中文[说明]。\n\n[说明]: https://example.com';
  expect(
    polishWorkflow.validate(request({ text }), text.replace('中文[说明]', '中文[详情]')).accepted,
  ).toBe(false);
});
it.each([
  '```js\nconst n = 30;\n```',
  '`limit=30`',
  '[详情](https://example.com/a?q=1)',
  '{{name}}',
  '${value}',
  '---\nstatus: draft\n---',
  '指定术语',
])('modified_protected_span_is_rejected: %s', (part) => {
  const original = request({
    text: `${part}\n预计明天暂停服务30分钟。`,
    protectedText: ['指定术语'],
  });
  // The optional protected term only constrains occurrences actually in this draft.
  expect(
    polishWorkflow.validate(original, original.text.replace(part, part.replace(/./u, 'X')))
      .accepted,
  ).toBe(false);
});
it('ordinary rewrite preserves code, link destination and placeholders', () => {
  const text = '请使用 `x=1`，访问[链接](https://example.com)，欢迎{{name}}。';
  expect(
    polishWorkflow.validate(
      request({ text }),
      text.replace('请使用', '使用').replace('[链接]', '[详情]'),
    ).accepted,
  ).toBe(true);
});
it('numbers produce review warnings and do not pretend to prove semantics', () => {
  const result = polishWorkflow.validate(request(), '暂停服务60分钟。');
  expect(result.warnings).toContain('NUMBERS_CHANGED');
});
it('link destinations and code do not skew Chinese detection', () => {
  expect(
    analyzeDocument('中文[说明](https://example.com/very/long/english/path) `abcdefgh`', [])
      .hanRatio,
  ).toBe(1);
});
