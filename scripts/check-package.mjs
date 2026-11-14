import { readFile, readdir, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { t } from 'tar';
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const expected = [
  'dist/server.cjs',
  'dist/THIRD_PARTY_NOTICES.md',
  'skills/agy/SKILL.md',
  'skills/agy-polish/SKILL.md',
  'skills/agy-websearch/SKILL.md',
  'README.md',
  'LICENSE',
  'docs/usage.md',
  'docs/tool-contract.md',
  'docs/compatibility.md',
  'docs/verification.md',
  'plugin.json',
  'mcp.json',
].sort();
async function walk(root, prefix = '') {
  const out = [];
  for (const name of await readdir(join(root, prefix))) {
    const path = join(prefix, name),
      stat = await lstat(join(root, path));
    assert(!stat.isSymbolicLink(), 'Package symlink');
    if (stat.isDirectory()) out.push(...(await walk(root, path)));
    else out.push(path.replaceAll('\\', '/'));
  }
  return out;
}
for (const host of ['codex', 'cursor']) {
  const root = join('release', host);
  assert.deepEqual((await walk(root)).sort(), expected);
  const manifest = JSON.parse(await readFile(join(root, 'plugin.json'), 'utf8'));
  assert.equal(manifest.name, pkg.name);
  assert.equal(manifest.version, pkg.version);
  assert.equal(manifest.$schema, 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json');
  const mcp = JSON.parse(await readFile(join(root, 'mcp.json'), 'utf8')).mcpServers.agy;
  assert.equal(mcp.command, 'node');
  assert.deepEqual(mcp.args, [
    host === 'cursor' ? '${CURSOR_PLUGIN_ROOT}/dist/server.cjs' : '${PLUGIN_ROOT}/dist/server.cjs',
  ]);
  for (const file of expected.filter((f) => f.endsWith('.md') || f.endsWith('.json'))) {
    const body = await readFile(join(root, file), 'utf8');
    assert(
      !/\/Users\/|C:\\\\Users\\\\|sk-[A-Za-z0-9]{24,}/.test(body),
      `Private path or secret in ${file}`,
    );
  }
  const archived = [];
  await t({
    file: `release/${pkg.name}-${host}-${pkg.version}.tgz`,
    onReadEntry: (e) => {
      assert(!e.path.includes('..') && !e.path.startsWith('/'), 'Archive path escape');
      assert(['Directory', 'File'].includes(e.type), 'Unexpected archive entry');
      if (e.type === 'File') archived.push(e.path.replace(`${host}/`, ''));
    },
  });
  assert.deepEqual(archived.sort(), expected);
}
console.log('Both package layouts, manifests, archives and source allowlists verified.');
