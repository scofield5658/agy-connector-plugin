import type { AgyDriver } from '../contracts.js';
export function createProcessLimiter(maximum = 2) {
  let active = 0;
  let disabled = false;
  return {
    get disabled() {
      return disabled;
    },
    disable() {
      disabled = true;
    },
    acquire() {
      if (active >= maximum) return undefined;
      active++;
      let released = false;
      return () => {
        if (!released) {
          released = true;
          active--;
        }
      };
    },
  };
}
export function limitDriver(
  driver: AgyDriver,
  limiter: ReturnType<typeof createProcessLimiter>,
): AgyDriver {
  return {
    async runTurn(input, signal) {
      if (signal.aborted) return { ok: false, code: 'CANCELLED', message: '已取消。' };
      if (limiter.disabled)
        return {
          ok: false,
          code: 'INSTANCE_DISABLED',
          message: '无法确认先前进程已回收；请重启插件。',
        };
      const release = limiter.acquire();
      if (!release) return { ok: false, code: 'BUSY', message: '已有两个 agy 调用在运行。' };
      try {
        const result = await driver.runTurn(input, signal);
        if (!result.ok && result.cleanupWarning) limiter.disable();
        return result;
      } finally {
        release();
      }
    },
  };
}
