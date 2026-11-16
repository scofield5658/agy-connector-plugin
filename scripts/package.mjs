import { mkdir, readFile, writeFile, cp, rm, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { c } from 'tar';
import { parseArgs } from 'node:util';
const { values } = parseArgs({ options: { 'mcp-env-file': { type: 'string' } } });
let localEnv;
if (values['mcp-env-file'] !== undefined) {
  localEnv = JSON.parse(await readFile(values['mcp-env-file'], 'utf8'));
  if (!localEnv || typeof localEnv !== 'object' || Array.isArray(localEnv))
    throw Error('MCP env file must contain a JSON object of string values.');
  for (const [key, value] of Object.entries(localEnv)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || typeof value !== 'string' || value.includes('\0'))
      throw Error('MCP env file contains an invalid environment name or value.');
  }
}
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const metadata = JSON.parse(await readFile('integrations/plugin-metadata.json', 'utf8'));
// Closed file allowlist; local environment values enter only through the explicit option above.
const files = [
  'dist/server.cjs',
  'dist/THIRD_PARTY_NOTICES.md',
  'skills/agy/SKILL.md',
  'skills/agy-polish/SKILL.md',
  'skills/agy-websearch/SKILL.md',
  'README.md',
  'LICENSE',
  'mcp-env.example.json',
  'docs/usage.md',
  'docs/tool-contract.md',
  'docs/compatibility.md',
  'docs/verification.md',
];
await mkdir('release', { recursive: true });
for (const host of ['codex', 'cursor']) {
  const root = join('release', host);
  await rm(root, { recursive: true, force: true });
  await mkdir(root, { recursive: true });
  for (const file of files) {
    // Refuse source symlinks rather than following them into user configuration.
    const segments = file.split('/');
    let current = '';
    for (const segment of segments) {
      current = join(current, segment);
      if ((await lstat(current)).isSymbolicLink()) throw Error(`Symlink not permitted: ${file}`);
    }
    await cp(file, join(root, file), { recursive: false });
  }
  await writeFile(
    join(root, 'plugin.json'),
    JSON.stringify({ ...metadata, version: pkg.version }, null, 2) + '\n',
  );
  const mcp = JSON.parse(await readFile(`integrations/${host}/mcp.json`, 'utf8'));
  if (localEnv) mcp.mcpServers.agy.env = { ...mcp.mcpServers.agy.env, ...localEnv };
  await writeFile(join(root, 'mcp.json'), JSON.stringify(mcp, null, 2) + '\n');
  await c(
    {
      file: `release/${pkg.name}-${host}-${pkg.version}.tgz`,
      gzip: true,
      cwd: 'release',
      portable: true,
      noMtime: true,
    },
    [host],
  );
}
console.log('Generated Codex and Cursor packages; no installation performed.');
if (localEnv)
  console.log(
    'Local MCP environment included in release/. Use plain pnpm package for public distribution.',
  );
const market = join('release', 'local-marketplace');
await rm(market, { recursive: true, force: true });
await mkdir(join(market, '.agents', 'plugins'), { recursive: true });
await cp('release/codex', join(market, 'plugins', pkg.name), { recursive: true });
await writeFile(
  join(market, '.agents', 'plugins', 'marketplace.json'),
  JSON.stringify(
    {
      name: 'agy-local',
      interface: { displayName: '本地 Antigravity 委托' },
      plugins: [
        {
          name: pkg.name,
          source: { source: 'local', path: `./plugins/${pkg.name}` },
          policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' },
          category: 'Developer Tools',
        },
      ],
    },
    null,
    2,
  ) + '\n',
);
