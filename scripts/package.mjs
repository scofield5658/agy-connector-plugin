import { mkdir, readFile, writeFile, cp, rm, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { c } from 'tar';
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const metadata = JSON.parse(await readFile('integrations/plugin-metadata.json', 'utf8'));
// Closed allowlist: never package the working tree, credentials, tests or local probe logs.
const files = [
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
  await cp(`integrations/${host}/mcp.json`, join(root, 'mcp.json'));
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
