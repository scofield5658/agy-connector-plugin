import { execFile } from 'node:child_process';

export const REQUIRED_FLAGS = [
  '--settings',
  '--agent',
  '--conversation',
  '--input-format',
  '--output-format',
  '--json-schema',
  '--disable-slash-commands',
  '--print-timeout',
] as const;
export type CapabilityReport = {
  available: boolean;
  version?: string;
  requiredFlags: string[];
  supported: boolean;
  reason?: string;
  auth: 'unknown';
};
function inspect(executable: string, arg: string, signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      executable,
      [arg],
      { signal, timeout: 3000, killSignal: 'SIGKILL', maxBuffer: 65536, windowsHide: true },
      (error, stdout, stderr) => (error ? reject(error) : resolve(stdout + '\n' + stderr)),
    );
  });
}
export async function detectCapabilities(
  executable: string,
  signal: AbortSignal,
): Promise<CapabilityReport> {
  let version: string | undefined;
  try {
    version = (await inspect(executable, '--version', signal))
      .trim()
      .match(/\b\d+\.\d+\.\d+\b/)?.[0];
    const help = await inspect(executable, '--help', signal);
    const missing = REQUIRED_FLAGS.filter((flag) => !help.includes(flag));
    return {
      available: true,
      version,
      requiredFlags: [...missing],
      supported: !!version && !missing.length,
      reason: missing.length ? 'REQUIRED_FLAGS_MISSING' : !version ? 'VERSION_UNKNOWN' : undefined,
      auth: 'unknown',
    };
  } catch {
    return {
      available: !!version,
      version,
      requiredFlags: [...REQUIRED_FLAGS],
      supported: false,
      reason: signal.aborted ? 'CANCELLED' : 'CLI_UNAVAILABLE',
      auth: 'unknown',
    };
  }
}
