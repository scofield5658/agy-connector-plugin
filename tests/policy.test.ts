import { it, expect } from 'vitest';
import { verifiedPolicy } from '../src/antigravity/policy.js';
const caps = {
  available: true,
  supported: true,
  version: '1.5.8',
  requiredFlags: [],
  auth: 'unknown' as const,
};
it('enables only the version and architecture certified with private startup profiles', () => {
  expect(verifiedPolicy(caps, 'darwin', 'arm64')).toEqual({ supported: true });
});
it('fails closed on unknown versions, platforms, architectures or missing capabilities', () => {
  for (const [report, platform, arch] of [
    [{ ...caps, version: '1.5.9' }, 'darwin', 'arm64'],
    [caps, 'linux', 'arm64'],
    [caps, 'win32', 'x64'],
    [caps, 'darwin', 'x64'],
    [{ ...caps, supported: false }, 'darwin', 'arm64'],
    [{ ...caps, available: false }, 'darwin', 'arm64'],
  ] as const)
    expect(verifiedPolicy(report, platform, arch)).toMatchObject({
      supported: false,
      reason: 'ISOLATION_UNVERIFIED',
    });
});
