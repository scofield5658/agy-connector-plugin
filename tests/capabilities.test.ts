import { describe, it, expect } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectCapabilities, REQUIRED_FLAGS } from '../src/antigravity/capabilities.js';

describe('capability detection', () => {
  it('missing_binary_is_unavailable', async () => {
    expect(
      await detectCapabilities('/nonexistent/agy', new AbortController().signal),
    ).toMatchObject({ available: false, supported: false, auth: 'unknown' });
  });
  it.skipIf(process.platform === 'win32')('missing_required_flag_is_unsupported', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'agy-cap-'));
    const file = join(dir, 'fake.mjs');
    await writeFile(
      file,
      '#!/usr/bin/env node\nconsole.log(process.argv.includes("--version") ? "1.5.8" : "--settings --input-format --output-format --json-schema");',
      { mode: 0o700 },
    );
    try {
      const report = await detectCapabilities(file, new AbortController().signal);
      expect(report.supported).toBe(false);
      expect(report.requiredFlags).toContain('--conversation');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
  it('cancelled_detection_is_bounded', async () => {
    const report = await detectCapabilities(process.execPath, AbortSignal.abort());
    expect(report.supported).toBe(false);
  });
  it.skipIf(process.platform === 'win32')(
    'accepts help emitted on stderr like agy 1.5.8',
    async () => {
      const dir = await mkdtemp(join(tmpdir(), 'agy-cap-'));
      const file = join(dir, 'fake.mjs');
      await writeFile(
        file,
        '#!/usr/bin/env node\nconsole.error(process.argv.includes("--version") ? "1.5.8" : ' +
          JSON.stringify(REQUIRED_FLAGS.join(' ')) +
          ');',
        { mode: 0o700 },
      );
      try {
        expect((await detectCapabilities(file, new AbortController().signal)).supported).toBe(true);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  );
});
