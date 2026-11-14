import { createHash } from 'node:crypto';
import type { InitialRequest } from '../contracts.js';
export const digest = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
// Stable object ordering makes identity independent of JSON serialization order.
export function fingerprint(value: unknown): string {
  function stable(v: unknown): unknown {
    if (Array.isArray(v)) return v.map(stable);
    if (v && typeof v === 'object')
      return Object.fromEntries(
        Object.entries(v)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, x]) => [k, stable(x)]),
      );
    return v;
  }
  return digest(JSON.stringify(stable(value)));
}
export type Session = {
  original: InitialRequest;
  token: string;
  deadlineAt: number;
  turns: number;
  conversationId?: string;
  dir: string;
  busy: boolean;
  valid: boolean;
};
