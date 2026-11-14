import { realpath, stat } from 'node:fs/promises';
import { isAbsolute, resolve, relative, dirname, basename, join } from 'node:path';
import type { Workspace } from './contracts.js';
export const within = (path: string, root: string) => {
  const r = relative(root, path);
  return (
    r === '' ||
    (!r.startsWith('..' + (process.platform === 'win32' ? '\\' : '/')) &&
      r !== '..' &&
      !isAbsolute(r))
  );
};
async function canonical(path: string, missing = false): Promise<string> {
  if (!isAbsolute(path)) throw Error('ABSOLUTE_PATH_REQUIRED');
  try {
    return await realpath(path);
  } catch (e) {
    if (!missing || (e as NodeJS.ErrnoException).code !== 'ENOENT' || dirname(path) === path)
      throw e;
    return join(await canonical(dirname(path), true), basename(path));
  }
}
export async function resolveWorkspace(input: Workspace): Promise<Workspace> {
  const cwd = await canonical(input.cwd),
    readRoots = await Promise.all(input.readRoots.map((p) => canonical(p))),
    writeRoots = await Promise.all(input.writeRoots.map((p) => canonical(p)));
  for (const p of [cwd, ...readRoots, ...writeRoots])
    if (!(await stat(p)).isDirectory()) throw Error('DIRECTORY_REQUIRED');
  if (!readRoots.some((root) => within(cwd, root))) throw Error('CWD_OUTSIDE_READ_ROOTS');
  if (writeRoots.some((p) => !readRoots.some((root) => within(p, root))))
    throw Error('WRITE_OUTSIDE_READ_ROOTS');
  const artifactDir = input.artifactDir
    ? await canonical(resolve(input.artifactDir), true)
    : undefined;
  if (input.artifactDir && !isAbsolute(input.artifactDir)) throw Error('ABSOLUTE_PATH_REQUIRED');
  if (artifactDir && !writeRoots.some((root) => within(artifactDir, root)))
    throw Error('ARTIFACT_OUTSIDE_WRITE_ROOTS');
  return { cwd, readRoots, writeRoots, ...(artifactDir ? { artifactDir } : {}) };
}
export async function validateArtifact(path: string, workspace: Workspace) {
  const actual = await canonical(path, true);
  if (!workspace.writeRoots.some((root) => within(actual, root)))
    throw Error('ARTIFACT_OUTSIDE_WRITE_ROOTS');
  return actual;
}
export async function validateRead(path: string, workspace: Workspace) {
  const actual = await canonical(path);
  if (!workspace.readRoots.some((root) => within(actual, root))) throw Error('READ_OUTSIDE_ROOTS');
  return actual;
}
