import { build } from 'esbuild';
import { mkdir, readFile, writeFile, access, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
await mkdir('dist', { recursive: true });
const result = await build({
  entryPoints: ['src/mcp/main.ts'],
  outfile: 'dist/server.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  metafile: true,
  define: { __PLUGIN_VERSION__: JSON.stringify(pkg.version) },
  legalComments: 'eof',
});
const packages = new Map();
for (const input of Object.keys(result.metafile.inputs).filter((p) =>
  p.includes('node_modules/'),
)) {
  let dir = dirname(resolve(input));
  while (dir !== dirname(dir)) {
    try {
      const info = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'));
      if (info.name && info.version) {
        const id = `${info.name}@${info.version}`;
        if (!packages.has(id)) {
          const files = (await readdir(dir)).filter((name) =>
            /^licen[cs]e|^copying|^notice/i.test(name),
          );
          if (!files.length && id !== 'format@0.2.2') throw Error(`License text missing: ${id}`);
          const licenses = files.length
            ? await Promise.all(files.map((name) => readFile(join(dir, name), 'utf8')))
            : [await readFile('third_party/format-0.2.2-LICENSE.txt', 'utf8')];
          packages.set(
            id,
            `## ${id}\n\nLicense: ${info.license ?? 'see text'}\n\n${licenses.join('\n\n')}`,
          );
        }
        break;
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    dir = dirname(dir);
  }
}
await writeFile(
  'dist/THIRD_PARTY_NOTICES.md',
  '# Bundled dependency notices\n\n' +
    [...packages]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, v]) => v)
      .join('\n\n'),
);
await access('dist/server.cjs');
console.log(`Built server and notices for ${packages.size} bundled packages.`);
