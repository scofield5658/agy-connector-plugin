import { z } from 'zod';
const nonempty = z.string().trim().min(1);
const scopeSchema = z.strictObject({
  host: z.enum(['codex', 'cursor']),
  workspaceRoot: nonempty,
  hostTaskId: nonempty,
});
const contextSchema = z.array(z.strictObject({ label: nonempty, content: z.string() }));
export const initialSchema = z.strictObject({
  kind: z.literal('initial'),
  requestId: nonempty,
  scope: scopeSchema,
  profile: z.enum(['zh-polish', 'general']),
  invocation: z.enum(['automatic', 'explicit']),
  goal: nonempty,
  text: z.string(),
  operation: z.enum(['analyze', 'transform', 'generate', 'execute']),
  documentKind: z.enum(['document', 'longform', 'other']),
  context: contextSchema,
  constraints: z.array(z.string()),
  protectedText: z.array(nonempty),
  outputLanguage: nonempty.optional(),
  externalProcessingAllowed: z.boolean(),
  providerRequirement: z.enum(['preferred', 'required']),
});
export const followupSchema = z.strictObject({
  kind: z.literal('followup'),
  requestId: nonempty,
  scope: scopeSchema,
  sessionToken: nonempty,
  feedback: nonempty,
  context: contextSchema,
});
export const requestSchema = z
  .discriminatedUnion('kind', [initialSchema, followupSchema])
  .superRefine((r, ctx) => {
    if (Buffer.byteLength(JSON.stringify(r), 'utf8') > 256 * 1024)
      ctx.addIssue({ code: 'custom', message: 'INPUT_TOO_LARGE' });
    if (r.kind === 'initial' && r.profile === 'general' && r.invocation !== 'explicit')
      ctx.addIssue({ code: 'custom', message: 'EXPLICIT_INTENT_REQUIRED' });
  });
export const nativeOutputSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('candidate'),
    text: nonempty,
    notes: z.array(z.string()).max(20),
  }),
  z.strictObject({ kind: z.literal('needs_context'), questions: z.array(nonempty).min(1).max(5) }),
]);
export const resultSchema = z
  .strictObject({
    requestId: z.string(),
    status: z.enum(['candidate', 'needs_context', 'skipped', 'failed', 'cancelled']),
    candidate: nonempty.optional(),
    questions: z.array(nonempty).min(1).optional(),
    sessionToken: nonempty.optional(),
    sourceDigest: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .optional(),
    reason: z.strictObject({ code: nonempty, message: nonempty }).optional(),
    fallback: z.enum(['original', 'host_decides', 'report_unfulfilled', 'none']),
    source: z.enum(['antigravity', 'none']),
    warnings: z.array(z.string()),
    elapsedMs: z.number().nonnegative(),
  })
  .superRefine((r, ctx) => {
    const candidate = r.status === 'candidate',
      context = r.status === 'needs_context';
    if (
      (candidate && (!r.candidate || !r.sourceDigest)) ||
      (!candidate && (r.candidate !== undefined || r.sourceDigest !== undefined)) ||
      context !== (r.questions !== undefined) ||
      (!candidate && !context && (r.sessionToken || !r.reason)) ||
      (candidate || context) !== (r.source === 'antigravity') ||
      (r.status === 'cancelled' && r.fallback !== 'none')
    ) {
      ctx.addIssue({ code: 'custom', message: 'INVALID_RESULT_STATE' });
    }
  });
export type InitialRequest = z.infer<typeof initialSchema>;
export type FollowupRequest = z.infer<typeof followupSchema>;
export type DelegateRequest = z.infer<typeof requestSchema>;
export type DelegateResult = z.infer<typeof resultSchema>;
export type NativeOutput = z.infer<typeof nativeOutputSchema>;
export type Profile = InitialRequest['profile'];
export type Scope = InitialRequest['scope'];
export type ContextItem = InitialRequest['context'][number];
export type RunTurnInput = {
  request?: InitialRequest;
  prompt: string;
  conversationId?: string;
  workspaceDir: string;
  deadlineAt: number;
  idleTimeoutMs?: number;
  model?: string;
};
export type RunTurnResult =
  | { ok: true; output: NativeOutput; conversationId: string; warnings: string[] }
  | { ok: false; code: string; message: string; cleanupWarning?: string };
export interface AgyDriver {
  runTurn(input: RunTurnInput, signal: AbortSignal): Promise<RunTurnResult>;
}
export type PrepareResult =
  { applicable: true; prompt: string } | { applicable: false; code: string; message: string };
export type ValidationResult = { accepted: boolean; warnings: string[]; reason?: string };
export interface Workflow {
  prepare(request: InitialRequest): PrepareResult;
  validate(original: InitialRequest, candidate: string): ValidationResult;
}
export type Clock = { now(): number };
export type PluginConfig = {
  polishBudgetMs: number;
  generalBudgetMs: number;
  idleTimeoutMs: number;
  maxTurns: 1 | 2;
  chineseRatioThreshold: number;
};
export interface Delegator {
  delegate(request: DelegateRequest, signal: AbortSignal): Promise<DelegateResult>;
  close(): Promise<void>;
}
