import { it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { x } from 'tar';
beforeAll(() => {
  execFileSync(process.execPath, ['scripts/build.mjs'], { stdio: 'pipe' });
  execFileSync(process.execPath, ['scripts/package.mjs'], { stdio: 'pipe' });
  execFileSync(process.execPath, ['scripts/check-package.mjs'], { stdio: 'pipe' });
}, 20000);
it('both packaged hosts run independently from a path containing spaces and Chinese', async () => {
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

it('applies explicit local env to both hosts and leaves the next public package clean', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agy local env '));
  const file = join(dir, 'mcp-env.local.json');
  try {
    await writeFile(
      file,
      JSON.stringify({
        http_proxy: 'http://127.0.0.1:6152',
        https_proxy: 'http://127.0.0.1:6152',
        AGY_POLISH_BUDGET_MS: '120000',
      }),
    );
    execFileSync(process.execPath, ['scripts/package.mjs', '--mcp-env-file', file]);
    execFileSync(process.execPath, ['scripts/check-package.mjs']);
    for (const host of ['codex', 'cursor']) {
      const config = JSON.parse(await readFile(`release/${host}/mcp.json`, 'utf8'));
      expect(config.mcpServers.agy.env).toEqual({
        http_proxy: 'http://127.0.0.1:6152',
        https_proxy: 'http://127.0.0.1:6152',
        AGY_POLISH_BUDGET_MS: '120000',
      });
      const source = JSON.parse(await readFile(`integrations/${host}/mcp.json`, 'utf8'));
      expect(config.mcpServers.agy.args).toEqual(source.mcpServers.agy.args);
    }
    const marketplace = JSON.parse(
      await readFile('release/local-marketplace/plugins/agy-connector-plugin/mcp.json', 'utf8'),
    );
    expect(marketplace.mcpServers.agy.env.https_proxy).toBe('http://127.0.0.1:6152');
    execFileSync(process.execPath, ['scripts/package.mjs']);
    for (const host of ['codex', 'cursor']) {
      const config = JSON.parse(await readFile(`release/${host}/mcp.json`, 'utf8'));
      expect(config.mcpServers.agy.env?.https_proxy).toBeUndefined();
      expect(config.mcpServers.agy.env?.http_proxy).toBeUndefined();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it('rejects malformed local env and CLI options before replacing existing packages', async () => {
  const before = await readFile('release/codex/mcp.json', 'utf8');
  const dir = await mkdtemp(join(tmpdir(), 'agy invalid env '));
  const file = join(dir, 'env.json');
  try {
    for (const body of [
      'null',
      '[]',
      '{',
      '{"https_proxy":123}',
      '{"BAD=KEY":"value"}',
      '{"https_proxy":"a\\u0000b"}',
    ]) {
      await writeFile(file, body);
      expect(() =>
        execFileSync(process.execPath, ['scripts/package.mjs', '--mcp-env-file', file], {
          stdio: 'pipe',
        }),
      ).toThrow();
      expect(await readFile('release/codex/mcp.json', 'utf8')).toBe(before);
    }
    for (const args of [
      ['--mcp-env-file'],
      ['--unknown'],
      ['--mcp-env-file', join(dir, 'missing.json')],
    ]) {
      expect(() =>
        execFileSync(process.execPath, ['scripts/package.mjs', ...args], { stdio: 'pipe' }),
      ).toThrow();
      expect(await readFile('release/codex/mcp.json', 'utf8')).toBe(before);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
