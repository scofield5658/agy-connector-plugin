import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
export type DialogueChannel = { send(message: unknown): boolean; end(): void };
type ProcessOptions = {
  executable: string;
  args: string[];
  cwd: string;
  input: string;
  env?: NodeJS.ProcessEnv;
  deadlineAt: number;
  signal: AbortSignal;
  onMessage?: (message: Record<string, unknown>, channel: DialogueChannel) => Promise<void>;
  /** Stops without output for this long; 0 or unset disables it. Paused while onMessage runs. */
  idleMs?: number;
  /** Returns a failure code when a stdout event already decides the outcome. */
  inspect?: (event: Record<string, unknown>) => string | undefined;
  /** Returns a failure code once stderr output already decides the outcome. */
  inspectStderr?: (stderr: string) => string | undefined;
};
const STDERR_SETTLE_MS = 500;
export type ProcessResult =
  | {
      ok: true;
      stdout: string;
      stderr: string;
      exitCode: number | null;
      cleanupWarning?: undefined;
    }
  | { ok: false; code: string; cleanupWarning?: string };
export function runProcess(options: ProcessOptions): Promise<ProcessResult> {
  return new Promise((resolve) => {
    if (options.signal.aborted) {
      resolve({ ok: false, code: 'CANCELLED' });
      return;
    }
    const remaining = options.deadlineAt - Date.now();
    if (remaining <= 0) {
      resolve({ ok: false, code: 'DEADLINE_EXCEEDED' });
      return;
    }
    const child = spawn(options.executable, options.args, {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      detached: process.platform !== 'win32',
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const buffers: Buffer[][] = [[], []],
      sizes = [0, 0];
    let reason: string | undefined,
      settled = false,
      exited = false,
      closed = false,
      exitCode: number | null = null;
    let escalation: ReturnType<typeof setTimeout> | undefined;
    let treeKiller: ReturnType<typeof spawn> | undefined;
    const decoder = new StringDecoder('utf8');
    let pendingLine = '',
      exchange = Promise.resolve(),
      lastActivity = Date.now(),
      handling = 0,
      stderrTimer: ReturnType<typeof setTimeout> | undefined;
    const channel: DialogueChannel = {
      send(message) {
        if (settled || reason || closed || options.signal.aborted || child.stdin.writableEnded)
          return false;
        const data = JSON.stringify(message) + '\n';
        if (Buffer.byteLength(data) > 256 * 1024) {
          stop('INPUT_TOO_LARGE');
          return false;
        }
        child.stdin.write(data);
        return true;
      },
      end() {
        if (!child.stdin.writableEnded) child.stdin.end();
      },
    };
    const reserve = Math.min(2000, Math.max(100, remaining / 3));
    const timers: ReturnType<typeof setTimeout>[] = [];
    function alive() {
      if (!child.pid) return false;
      if (process.platform === 'win32')
        return !exited || (treeKiller !== undefined && treeKiller.exitCode === null);
      try {
        process.kill(-child.pid, 0);
        return true;
      } catch (error) {
        return (error as NodeJS.ErrnoException).code !== 'ESRCH';
      }
    }
    function finish(force = false) {
      if (settled || (!force && (!closed || alive()))) return;
      settled = true;
      timers.forEach(clearTimeout);
      if (escalation) clearTimeout(escalation);
      options.signal.removeEventListener('abort', abort);
      child.stdin.destroy();
      child.stdout.destroy();
      child.stderr.destroy();
      const uncertain = alive();
      if (uncertain) {
        child.unref();
        treeKiller?.unref();
      }
      if (reason || uncertain)
        resolve({
          ok: false,
          code: options.signal.aborted ? 'CANCELLED' : (reason ?? 'CLEANUP_FAILED'),
          ...(uncertain ? { cleanupWarning: '无法确认本次子进程已回收；禁止继续启动。' } : {}),
        });
      else
        resolve({
          ok: true,
          stdout: Buffer.concat(buffers[0]!).toString('utf8'),
          stderr: Buffer.concat(buffers[1]!).toString('utf8'),
          exitCode,
        });
    }
    function kill(sig: NodeJS.Signals) {
      if (!child.pid) return;
      if (process.platform === 'win32') {
        if (!treeKiller) {
          treeKiller = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
            stdio: 'ignore',
            windowsHide: true,
            shell: false,
          });
          treeKiller.on('error', () => {});
          treeKiller.on('close', () => finish());
        }
      } else {
        try {
          process.kill(-child.pid, sig);
        } catch {
          /* Exit races are resolved by close and group liveness. */
        }
      }
    }
    function stop(code: string) {
      if (settled) return;
      reason ??= code;
      kill('SIGTERM');
      escalation ??= setTimeout(
        () => {
          kill('SIGKILL');
        },
        Math.min(400, reserve / 2),
      );
    }
    function abort() {
      stop('CANCELLED');
    }
    options.signal.addEventListener('abort', abort, { once: true });
    timers.push(setTimeout(() => stop('DEADLINE_EXCEEDED'), Math.max(0, remaining - reserve)));
    timers.push(
      setTimeout(() => {
        kill('SIGKILL');
        finish(true);
      }, remaining),
    );
    const poll = setInterval(() => {
      if (closed) finish();
      else if (
        !reason &&
        options.idleMs &&
        handling === 0 &&
        Date.now() - lastActivity >= options.idleMs
      )
        stop('IDLE_TIMEOUT');
    }, 20);
    // clearInterval accepts the same timer handle type as clearTimeout.
    timers.push(poll);
    [child.stdout, child.stderr].forEach((stream, i) =>
      stream.on('data', (chunk: Buffer) => {
        if (settled) return;
        sizes[i] = (sizes[i] ?? 0) + chunk.length;
        if (sizes[i]! > (i === 0 ? 1024 * 1024 : 64 * 1024)) {
          stop('OUTPUT_TOO_LARGE');
          return;
        }
        buffers[i]!.push(chunk);
        lastActivity = Date.now();
        if (i === 1 && options.inspectStderr && !stderrTimer) {
          stderrTimer = setTimeout(() => {
            const code = options.inspectStderr!(Buffer.concat(buffers[1]!).toString('utf8'));
            if (code) stop(code);
          }, STDERR_SETTLE_MS);
          timers.push(stderrTimer);
        }
        if (i === 0 && (options.onMessage || options.inspect)) {
          pendingLine += decoder.write(chunk);
          let newline: number;
          while ((newline = pendingLine.indexOf('\n')) >= 0) {
            const line = pendingLine.slice(0, newline);
            pendingLine = pendingLine.slice(newline + 1);
            if (!line.trim()) continue;
            if (options.inspect) {
              let event: unknown;
              try {
                event = JSON.parse(line);
              } catch {
                /* The final decoder reports malformed output. */
              }
              const code =
                event && typeof event === 'object' && !Array.isArray(event)
                  ? options.inspect(event as Record<string, unknown>)
                  : undefined;
              if (code) {
                stop(code);
                return;
              }
            }
            if (!options.onMessage) continue;
            handling++;
            exchange = exchange
              .then(async () => {
                if (settled || reason || options.signal.aborted) return;
                const message: unknown = JSON.parse(line);
                if (!message || typeof message !== 'object' || Array.isArray(message))
                  throw Error('Invalid message');
                await options.onMessage!(message as Record<string, unknown>, channel);
              })
              .catch(() => stop('INVALID_OUTPUT'))
              .finally(() => {
                handling--;
                lastActivity = Date.now();
              });
          }
        }
      }),
    );
    child.on('error', () => {
      reason ??= 'CLI_UNAVAILABLE';
    });
    child.on('exit', (code) => {
      exited = true;
      exitCode = code;
    });
    child.on('close', (code) => {
      closed = true;
      exited = true;
      exitCode = code;
      finish();
    });
    child.stdin.on('error', () => stop('STDIN_ERROR'));
    if (options.onMessage) child.stdin.write(options.input);
    else child.stdin.end(options.input);
    if (options.signal.aborted) abort();
  });
}
