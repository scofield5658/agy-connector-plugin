import { describe, it, expect } from 'vitest';
import { runProcess } from '../src/antigravity/process.js';
import { MAX_BUDGET_MS, readConfig } from '../src/config.js';
import { readTaskConfig } from '../src/tasks/service.js';
import { searchEventFailure, searchStderrCode } from '../src/tasks/protocol.js';
import { textEventFailure, textStderrCode } from '../src/antigravity/protocol.js';
const HANG = 'process.on("SIGTERM",()=>process.exit(0));setInterval(()=>{},1000);';
function spawnScript(script: string, extra: Partial<Parameters<typeof runProcess>[0]> = {}) {
  return runProcess({
    executable: process.execPath,
    args: ['-e', script],
    cwd: process.cwd(),
    input: '',
    deadlineAt: Date.now() + 10000,
    signal: new AbortController().signal,
    ...extra,
  });
}
describe('process watchdog', () => {
  it('stops a silent process at the idle timeout, well before the deadline', async () => {
    const start = Date.now();
    const r = await spawnScript(HANG, { idleMs: 300 });
    expect(r).toMatchObject({ ok: false, code: 'IDLE_TIMEOUT' });
    expect(Date.now() - start).toBeLessThan(3000);
  });
  it('keeps a process that reports progress within the idle window', async () => {
    const r = await spawnScript(
      'let n=0;const t=setInterval(()=>{console.log("{}");if(++n===5){clearInterval(t);}},400);',
      { idleMs: 1500 },
    );
    expect(r.ok).toBe(true);
  });
  it('pauses the idle timer while a host interaction is pending', async () => {
    let handled = false;
    const start = Date.now();
    const r = await spawnScript('console.log(JSON.stringify({id:1}));' + HANG, {
      idleMs: 1500,
      onMessage: async () => {
        await new Promise((done) => setTimeout(done, 2000));
        handled = true;
      },
    });
    expect(handled).toBe(true);
    expect(r).toMatchObject({ ok: false, code: 'IDLE_TIMEOUT' });
    expect(Date.now() - start).toBeGreaterThanOrEqual(3400);
  });
  it('stops as soon as a stdout event decides failure', async () => {
    const start = Date.now();
    const r = await spawnScript('console.log(JSON.stringify({event:"error"}));' + HANG, {
      inspect: (e) => (e.event === 'error' ? 'CLI_ERROR' : undefined),
    });
    expect(r).toMatchObject({ ok: false, code: 'CLI_ERROR' });
    expect(Date.now() - start).toBeLessThan(3000);
  });
  it('stops shortly after stderr decides failure', async () => {
    const start = Date.now();
    const r = await spawnScript('process.stderr.write("not logged in");' + HANG, {
      inspectStderr: searchStderrCode,
    });
    expect(r).toMatchObject({ ok: false, code: 'AUTH_REQUIRED' });
    expect(Date.now() - start).toBeLessThan(3000);
  });
  it('leaves idle detection off when unset', async () => {
    const r = await spawnScript(HANG, { deadlineAt: Date.now() + 1200 });
    expect(r).toMatchObject({ ok: false, code: 'DEADLINE_EXCEEDED' });
  });
});
describe('stream failure rules', () => {
  it('flags search errors, failed steps and foreign tools only', () => {
    expect(searchEventFailure({ event: 'error' })).toBe('CLI_ERROR');
    expect(
      searchEventFailure({
        event: 'step_update',
        step_update: { step_type: 'tool', state: 'ERROR' },
      }),
    ).toBe('CLI_ERROR');
    expect(
      searchEventFailure({
        event: 'step_update',
        step_update: { step_type: 'tool', tool_name: 'run_command', state: 'RUNNING' },
      }),
    ).toBe('PERMISSION_DENIED');
    expect(
      searchEventFailure({
        event: 'step_update',
        step_update: { step_type: 'tool', tool_name: 'search_web', state: 'RUNNING' },
      }),
    ).toBeUndefined();
    expect(
      searchEventFailure({
        event: 'step_update',
        step_update: { step_type: 'finish', state: 'ERROR' },
      }),
    ).toBeUndefined();
  });
  it('flags text-mode errors and classifies stderr', () => {
    expect(textEventFailure({ event: 'error' })?.code).toBe('CLI_ERROR');
    expect(
      textEventFailure({ event: 'step_update', step_update: { step_type: 'tool', state: 'DONE' } })
        ?.code,
    ).toBe('PERMISSION_DENIED');
    expect(textEventFailure({ event: 'step_update', step_update: { step_type: 'finish' } })).toBe(
      undefined,
    );
    expect(textStderrCode('429 quota exceeded')).toBe('RATE_LIMITED');
    expect(textStderrCode('permission denied for tool')).toBe('PERMISSION_DENIED');
  });
});
describe('budget configuration', () => {
  it('keeps defaults and accepts budgets up to 30 minutes for every mode', () => {
    expect(readConfig({})).toMatchObject({
      polishBudgetMs: 30000,
      generalBudgetMs: 60000,
      idleTimeoutMs: 120000,
    });
    expect(readTaskConfig({})).toEqual({ searchBudgetMs: 60000, nativeBudgetMs: 120000 });
    const max = String(MAX_BUDGET_MS);
    expect(
      readConfig({
        AGY_POLISH_BUDGET_MS: max,
        AGY_GENERAL_BUDGET_MS: max,
        AGY_IDLE_TIMEOUT_MS: '0',
      }),
    ).toMatchObject({ polishBudgetMs: 1_800_000, generalBudgetMs: 1_800_000, idleTimeoutMs: 0 });
    expect(readTaskConfig({ AGY_SEARCH_BUDGET_MS: '300000', AGY_NATIVE_BUDGET_MS: max })).toEqual({
      searchBudgetMs: 300000,
      nativeBudgetMs: 1_800_000,
    });
  });
  it('rejects budgets above 30 minutes and idle timeouts below 10 seconds', () => {
    const over = String(MAX_BUDGET_MS + 1);
    expect(() => readConfig({ AGY_POLISH_BUDGET_MS: over })).toThrow();
    expect(() => readTaskConfig({ AGY_SEARCH_BUDGET_MS: over })).toThrow();
    expect(() => readTaskConfig({ AGY_NATIVE_BUDGET_MS: over })).toThrow();
    expect(() => readConfig({ AGY_IDLE_TIMEOUT_MS: '5000' })).toThrow();
  });
});
