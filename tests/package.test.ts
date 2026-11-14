import { it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { x } from 'tar';
it('both packaged hosts run independently from a path containing spaces and Chinese', async () => {
  execFileSync(process.execPath, ['scripts/build.mjs'], { stdio: 'pipe' });
  execFileSync(process.execPath, ['scripts/package.mjs'], { stdio: 'pipe' });
  execFileSync(process.execPath, ['scripts/check-package.mjs'], { stdio: 'pipe' });
  const dir = await mkdtemp(join(tmpdir(), 'agy 中文 包 '));
  try {
    for (const host of ['codex', 'cursor']) {
      const pkg = JSON.parse(await readFile('package.json', 'utf8'));
      const archive = resolve(`release/agy-connector-plugin-${host}-${pkg.version}.tgz`);
      await x({ file: archive, cwd: dir });
      const root = join(dir, host);
      const mcp = JSON.parse(await readFile(join(root, 'mcp.json'), 'utf8')).mcpServers.agy;
      const args = mcp.args.map((s: string) =>
        s.replace(host === 'cursor' ? '${CURSOR_PLUGIN_ROOT}' : '${PLUGIN_ROOT}', root),
      );
      const transport = new StdioClientTransport({
        command: process.execPath,
        args,
        cwd: dir,
        env: { PATH: process.env.PATH ?? '', AGY_EXECUTABLE: join(dir, 'missing-agy') },
        stderr: 'pipe',
      });
      const client = new Client({ name: 'package-test', version: '1' });
      try {
        await client.connect(transport);
        expect((await client.listTools()).tools.map((t) => t.name).sort()).toEqual([
          'agy_delegate',
          'agy_health',
          'agy_run_task',
          'agy_websearch',
        ]);
        expect(
          (await client.callTool({ name: 'agy_health', arguments: {} })).structuredContent,
        ).toMatchObject({ ready: false, available: false });
      } finally {
        await client.close();
      }
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 20000);
