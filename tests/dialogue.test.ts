import { it, expect } from 'vitest';
import { runProcess } from '../src/antigravity/process.js';
import { resolve } from 'node:path';
it('keeps stdin open for structured interaction and closes on completion', async () => {
  const values: unknown[] = [];
  const r = await runProcess({
    executable: process.execPath,
    args: [resolve('tests/fixtures/fake-dialogue.mjs')],
    cwd: process.cwd(),
    input: '{"id":1}\n',
    deadlineAt: Date.now() + 2000,
    signal: new AbortController().signal,
    onMessage: async (e, channel) => {
      values.push(e.result);
      if (e.id === 1) channel.send({ id: 2 });
      else channel.end();
    },
  });
  expect(r.ok).toBe(true);
  expect(values).toEqual(['中文', 'confirmed']);
});
it('does not transmit delayed consent after cancellation', async () => {
  const ctrl = new AbortController();
  let sent = false;
  const r = await runProcess({
    executable: process.execPath,
    args: [resolve('tests/fixtures/fake-dialogue.mjs')],
    cwd: process.cwd(),
    input: '{"id":1}\n',
    deadlineAt: Date.now() + 1800,
    signal: ctrl.signal,
    onMessage: async (_e, channel) => {
      ctrl.abort();
      await new Promise((r) => setTimeout(r, 50));
      sent = channel.send({ id: 2 });
    },
  });
  expect(r).toMatchObject({ ok: false, code: 'CANCELLED' });
  expect(sent).toBe(false);
});
