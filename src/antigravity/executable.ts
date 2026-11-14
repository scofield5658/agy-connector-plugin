import { access, constants } from 'node:fs/promises';
import { delimiter, isAbsolute, join } from 'node:path';
import { homedir } from 'node:os';
export async function resolveExecutable(
  env: NodeJS.ProcessEnv = process.env,
): Promise<string | undefined> {
  if (env.AGY_EXECUTABLE) {
    if (!isAbsolute(env.AGY_EXECUTABLE)) return undefined;
    try {
      await access(env.AGY_EXECUTABLE, constants.X_OK);
      return env.AGY_EXECUTABLE;
    } catch {
      return undefined;
    }
  }
  const names = process.platform === 'win32' ? ['agy.exe'] : ['agy'];
  const dirs = [
    ...(env.PATH ?? '').split(delimiter),
    join(homedir(), '.local', 'bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
  ];
  for (const dir of dirs.filter((d) => isAbsolute(d)))
    for (const name of names) {
      const file = join(dir, name);
      try {
        await access(file, constants.X_OK);
        return file;
      } catch {
        /* Next search directory. */
      }
    }
  return undefined;
}
