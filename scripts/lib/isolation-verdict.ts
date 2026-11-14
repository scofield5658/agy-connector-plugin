export const isolationScopes = [
  'workspace',
  'workspace-plugin',
  'global',
  'global-plugin',
] as const;
export type IsolationScope = (typeof isolationScopes)[number];
export type ControlResult = {
  completed: boolean;
  cleanupConfirmed: boolean;
  markers: Record<IsolationScope, string[]>;
};
export function controlsPass(positive: ControlResult, isolated: ControlResult) {
  return (
    positive.completed &&
    isolated.completed &&
    positive.cleanupConfirmed &&
    isolated.cleanupConfirmed &&
    isolationScopes.every((scope) =>
      ['session', 'invocation', 'mcp'].every((event) => positive.markers[scope].includes(event)),
    ) &&
    isolationScopes.every((scope) => isolated.markers[scope].length === 0)
  );
}
