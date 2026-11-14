import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm, copyFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runProcess } from '../src/antigravity/process.js';
import { decodeTranscript } from '../src/antigravity/protocol.js';
import { createAgyDriver } from '../src/antigravity/driver.js';
const dirs: string[] = [];
async function run(scenario: string, signal = new AbortController().signal, budget = 2000) {
  const dir = await mkdtemp(join(tmpdir(), 'agy-test-'));
  dirs.push(dir);
  return runProcess({
    executable: process.execPath,
    args: [resolve('tests/fixtures/fake-agy.mjs')],
    cwd: dir,
    input:
      JSON.stringify({ event: 'user', message: { content: '中文 $(touch BAD) `echo bad`' } }) +
      '\n',
    env: { ...process.env, FAKE_AGY_SCENARIO: scenario },
    deadlineAt: Date.now() + budget,
    signal,
  });
}
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});
describe('owned subprocess lifecycle and output', () => {
  it.skipIf(process.platform === 'win32')(
    'native driver supplies object-root schema accepted by agy',
    async () => {
      const dir = await mkdtemp(join(tmpdir(), 'agy-native-'));
      dirs.push(dir);
      const file = join(dir, 'agy');
      await copyFile(resolve('tests/fixtures/fake-agy.mjs'), file);
      await chmod(file, 0o700);
      const driver = createAgyDriver({
        executable: file,
        capabilities: {
          available: true,
          supported: true,
          version: '1.5.8',
          requiredFlags: [],
          auth: 'unknown',
        },
        policy: { supported: true },
      });
      expect(
        await driver.runTurn(
          { prompt: '稿', workspaceDir: dir, deadlineAt: Date.now() + 2000 },
          new AbortController().signal,
        ),
      ).toMatchObject({ ok: true });
    },
  );
  it('EOF, split UTF8, no final newline decode exactly', async () => {
    const r = await run('success');
    expect(r.ok).toBe(true);
    if (r.ok)
      expect(decodeTranscript(r.stdout, r.stderr, r.exitCode)).toMatchObject({
        ok: true,
        output: { text: '预计暂停服务30分钟。' },
      });
  });
  it.each(['hang', 'tree'])('kills %s within deadline including cleanup', async (scenario) => {
    const start = Date.now();
    const r = await run(scenario, new AbortController().signal, 1800);
    expect(r).toMatchObject({ ok: false, code: 'DEADLINE_EXCEEDED' });
    expect(r.cleanupWarning).toBeUndefined();
    expect(Date.now() - start).toBeLessThan(2400);
  });
  it('cancellation wins and terminates its child', async () => {
    const c = new AbortController();
    const p = run('hang', c.signal, 2500);
    setTimeout(() => c.abort(), 200);
    expect(await p).toMatchObject({ ok: false, code: 'CANCELLED' });
  });
  it.each(['huge', 'stderr'])('does not truncate %s', async (s) => {
    expect(await run(s)).toMatchObject({ ok: false, code: 'OUTPUT_TOO_LARGE' });
  });
  it('source content stays stdin data', async () => {
    const r = await run('echo');
    if (!r.ok) throw Error(r.code);
    expect(decodeTranscript(r.stdout, r.stderr, r.exitCode)).toMatchObject({
      ok: true,
      output: { text: '中文 $(touch BAD) `echo bad`' },
    });
  });
  it.each([
    ['bad', 'INVALID_OUTPUT'],
    ['empty', 'INVALID_OUTPUT'],
    ['response', 'INVALID_OUTPUT'],
    ['duplicate', 'INVALID_OUTPUT'],
    ['denied', 'PERMISSION_DENIED'],
    ['exit', 'CLI_ERROR'],
  ])('rejects %s even with apparent success', async (s, code) => {
    const r = await run(s!);
    if (!r.ok) throw Error(r.code);
    expect(decodeTranscript(r.stdout, r.stderr, r.exitCode)).toMatchObject({ ok: false, code });
  });
});
