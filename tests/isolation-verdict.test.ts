import { it, expect } from 'vitest';
import {
  controlsPass,
  isolationScopes,
  type ControlResult,
} from '../scripts/lib/isolation-verdict.js';
const control = (events: string[]): ControlResult => ({
  completed: true,
  cleanupConfirmed: true,
  markers: Object.fromEntries(
    isolationScopes.map((s) => [s, [...events]]),
  ) as ControlResult['markers'],
});
it('requires successful positive and negative runs at every source', () => {
  const positive = control(['session', 'invocation', 'mcp']);
  const negative = control([]);
  expect(controlsPass(positive, negative)).toBe(true);
  for (const s of isolationScopes) {
    const missing = structuredClone(positive);
    missing.markers[s] = [];
    expect(controlsPass(missing, negative)).toBe(false);
    const leak = structuredClone(negative);
    leak.markers[s] = ['mcp'];
    expect(controlsPass(positive, leak)).toBe(false);
  }
  expect(controlsPass(positive, { ...negative, completed: false })).toBe(false);
  expect(controlsPass(positive, { ...negative, cleanupConfirmed: false })).toBe(false);
});
