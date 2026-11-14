import type { InitialRequest, RunTurnResult } from '../src/contracts.js';
export function request(overrides: Partial<InitialRequest> = {}): InitialRequest {
  return {
    kind: 'initial',
    requestId: 'r1',
    scope: { host: 'codex', workspaceRoot: '/project', hostTaskId: 't1' },
    profile: 'zh-polish',
    invocation: 'automatic',
    goal: '润色通知',
    text: '预计暂停服务30分钟。',
    operation: 'transform',
    documentKind: 'document',
    context: [],
    constraints: [],
    protectedText: [],
    externalProcessingAllowed: true,
    providerRequirement: 'preferred',
    ...overrides,
  };
}
export const success: RunTurnResult = {
  ok: true,
  output: { kind: 'candidate', text: '预计暂停服务30分钟。', notes: [] },
  conversationId: 'conversation-1',
  warnings: [],
};
