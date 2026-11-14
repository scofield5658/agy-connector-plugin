import { afterEach, describe, it, expect, vi } from 'vitest';
import { createDelegator } from '../src/delegation/engine.js';
import { defaultConfig } from '../src/config.js';
import type {
  Delegator,
  AgyDriver,
  RunTurnResult,
  Workflow,
  FollowupRequest,
} from '../src/contracts.js';
import { request, success } from './helpers.js';
const workflow: Workflow = {
  prepare: (r) => ({ applicable: true, prompt: r.text }),
  validate: () => ({ accepted: true, warnings: [] }),
};
const engines: Delegator[] = [];
let now = 1000;
function setup(run: AgyDriver['runTurn'] = async () => success) {
  now = 1000;
  const driver = { runTurn: vi.fn(run) };
  const engine = createDelegator({
    driver,
    workflows: { 'zh-polish': workflow, general: workflow },
    config: defaultConfig,
    clock: { now: () => now },
  });
  engines.push(engine);
  return { engine, driver };
}
const signal = () => new AbortController().signal;
afterEach(async () => {
  await Promise.all(engines.splice(0).map((e) => e.close()));
});
describe('bounded optional delegation', () => {
  it('automatic dedupe aliases also reject reused request ids with different payloads', async () => {
    const { engine, driver } = setup();
    await engine.delegate(request(), signal());
    await engine.delegate(request({ requestId: 'alias' }), signal());
    expect(
      await engine.delegate(request({ requestId: 'alias', text: '另一份底稿。' }), signal()),
    ).toMatchObject({ reason: { code: 'REQUEST_CONFLICT' } });
    expect(driver.runTurn).toHaveBeenCalledTimes(1);
  });
  it.each(['r1', 'alias'])(
    'cancelled cache subscriber %s never receives a late candidate',
    async (requestId) => {
      let finish!: (value: RunTurnResult) => void;
      const native = new Promise<RunTurnResult>((resolve) => {
        finish = resolve;
      });
      const { engine } = setup(async () => native);
      const first = engine.delegate(request(), signal());
      const ctrl = new AbortController();
      const second = engine.delegate(request({ requestId }), ctrl.signal);
      ctrl.abort();
      finish(success);
      expect(await first).toMatchObject({ status: 'candidate' });
      expect(await second).toMatchObject({ status: 'cancelled', fallback: 'none' });
    },
  );
  it('prohibited external processing never invokes provider', async () => {
    const { engine, driver } = setup();
    expect(
      await engine.delegate(request({ externalProcessingAllowed: false }), signal()),
    ).toMatchObject({ status: 'skipped', fallback: 'original' });
    expect(driver.runTurn).not.toHaveBeenCalled();
  });
  it('same_request_reuses_run and conflicting payload does not', async () => {
    const { engine, driver } = setup();
    const [a, b] = await Promise.all([
      engine.delegate(request(), signal()),
      engine.delegate(request(), signal()),
    ]);
    expect(a).toEqual(b);
    expect(driver.runTurn).toHaveBeenCalledTimes(1);
    expect(await engine.delegate(request({ text: '新稿' }), signal())).toMatchObject({
      reason: { code: 'REQUEST_CONFLICT' },
    });
  });
  it('automatic duplicates with a new id do not consume again; explicit new request may', async () => {
    const { engine, driver } = setup();
    await engine.delegate(request(), signal());
    expect(await engine.delegate(request({ requestId: 'r2' }), signal())).toMatchObject({
      requestId: 'r2',
    });
    expect(driver.runTurn).toHaveBeenCalledTimes(1);
    await engine.delegate(request({ requestId: 'r3', invocation: 'explicit' }), signal());
    expect(driver.runTurn).toHaveBeenCalledTimes(2);
  });
  it.each([
    ['zh-polish', 'preferred', 'original'],
    ['general', 'preferred', 'host_decides'],
    ['general', 'required', 'report_unfulfilled'],
  ] as const)('failure mapping %s %s', async (profile, providerRequirement, fallback) => {
    const { engine } = setup(async () => ({
      ok: false,
      code: 'CLI_UNAVAILABLE',
      message: '不可用',
    }));
    expect(
      await engine.delegate(
        request({ profile, providerRequirement, invocation: 'explicit' }),
        signal(),
      ),
    ).toMatchObject({ status: 'failed', fallback, source: 'none' });
  });
  it('rejects cross scope, third turn and preserves original digest', async () => {
    const { engine, driver } = setup();
    const first = await engine.delegate(request(), signal());
    const follow: FollowupRequest = {
      kind: 'followup',
      requestId: 'r2',
      scope: request().scope,
      sessionToken: first.sessionToken!,
      feedback: '保留语气',
      context: [],
    };
    expect(
      await engine.delegate(
        { ...follow, scope: { ...follow.scope, hostTaskId: 'another' } },
        signal(),
      ),
    ).toMatchObject({ reason: { code: 'SESSION_INVALID' } });
    const second = await engine.delegate(follow, signal());
    expect(second.sourceDigest).toBe(first.sourceDigest);
    expect(second.sessionToken).toBeUndefined();
    expect(await engine.delegate({ ...follow, requestId: 'r3' }, signal())).toMatchObject({
      reason: { code: 'TURN_LIMIT' },
    });
    expect(driver.runTurn).toHaveBeenCalledTimes(2);
  });
  it('feedback time consumes the original deadline', async () => {
    const { engine, driver } = setup();
    const first = await engine.delegate(request(), signal());
    now += 30001;
    expect(
      await engine.delegate(
        {
          kind: 'followup',
          requestId: 'r2',
          scope: request().scope,
          sessionToken: first.sessionToken!,
          feedback: '再改',
          context: [],
        },
        signal(),
      ),
    ).toMatchObject({ reason: { code: 'DEADLINE_EXCEEDED' } });
    expect(driver.runTurn).toHaveBeenCalledTimes(1);
  });
  it('third concurrent request is BUSY without queueing', async () => {
    let finish!: (r: RunTurnResult) => void;
    const pending = new Promise<RunTurnResult>((r) => {
      finish = r;
    });
    const { engine, driver } = setup(async () => pending);
    const a = engine.delegate(request({ invocation: 'explicit' }), signal());
    const b = engine.delegate(request({ requestId: 'r2', invocation: 'explicit' }), signal());
    const c = await engine.delegate(request({ requestId: 'r3', invocation: 'explicit' }), signal());
    expect(c).toMatchObject({ reason: { code: 'BUSY' } });
    finish(success);
    await Promise.all([a, b]);
    expect(driver.runTurn).toHaveBeenCalledTimes(2);
  });
  it('late_result_after_cancel_is_ignored', async () => {
    const ctrl = new AbortController();
    const { engine } = setup(async () => {
      ctrl.abort();
      return success;
    });
    expect(await engine.delegate(request(), ctrl.signal)).toMatchObject({
      status: 'cancelled',
      fallback: 'none',
    });
  });
  it('cancel bounds a driver that ignores AbortSignal', async () => {
    const ctrl = new AbortController();
    const { engine } = setup(async () => new Promise(() => {}));
    const pending = engine.delegate(request(), ctrl.signal);
    setTimeout(() => ctrl.abort(), 20);
    const start = Date.now();
    expect(await pending).toMatchObject({ status: 'cancelled', fallback: 'none' });
    expect(Date.now() - start).toBeLessThan(2600);
  });
  it('cached candidates never expose an expired continuation token', async () => {
    const { engine } = setup();
    await engine.delegate(request(), signal());
    now += 30001;
    const result = await engine.delegate(request(), signal());
    expect(result.status).toBe('candidate');
    expect(result.sessionToken).toBeUndefined();
  });
  it('cleanup uncertainty disables subsequent launches', async () => {
    const { engine, driver } = setup(async () => ({
      ok: false,
      code: 'CLI_ERROR',
      message: 'failed',
      cleanupWarning: 'cleanup unconfirmed',
    }));
    await engine.delegate(request(), signal());
    expect(
      await engine.delegate(request({ requestId: 'r2', invocation: 'explicit' }), signal()),
    ).toMatchObject({ reason: { code: 'INSTANCE_DISABLED' } });
    expect(driver.runTurn).toHaveBeenCalledTimes(1);
  });
  it('idle records expire and full storage refuses more until expiry', async () => {
    const { engine } = setup();
    for (let i = 0; i < 100; i++)
      await engine.delegate(request({ requestId: `r${i}`, invocation: 'explicit' }), signal());
    expect(
      await engine.delegate(request({ requestId: 'full', invocation: 'explicit' }), signal()),
    ).toMatchObject({ reason: { code: 'BUSY' } });
    now += 900001;
    expect(
      await engine.delegate(request({ requestId: 'new', invocation: 'explicit' }), signal()),
    ).toMatchObject({ status: 'candidate' });
  });
});
