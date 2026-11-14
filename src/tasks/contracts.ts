import { z } from 'zod';
const text = z.string().trim().min(1);
const scope = z.strictObject({
  host: z.enum(['codex', 'cursor']),
  workspaceRoot: text,
  hostTaskId: text,
});
const context = z.array(z.strictObject({ label: text, content: z.string() }));
const common = {
  kind: z.literal('initial'),
  requestId: text,
  scope,
  invocation: z.literal('explicit'),
  externalProcessingAllowed: z.boolean(),
  providerRequirement: z.enum(['preferred', 'required']),
  context,
};
const followup = z.strictObject({
  kind: z.literal('followup'),
  requestId: text,
  scope,
  sessionToken: text,
  feedback: text,
  context,
});
export const workspaceSchema = z.strictObject({
  cwd: text,
  readRoots: z.array(text).min(1).max(20),
  writeRoots: z.array(text).max(20),
  artifactDir: text.optional(),
});
export const searchInitialSchema = z.strictObject({
  ...common,
  query: text,
  domains: z.array(text).max(10),
  language: text,
});
export const taskInitialSchema = z.strictObject({
  ...common,
  task: text,
  workspace: workspaceSchema,
  authorization: z.strictObject({
    useAgyConfiguration: z.literal(true),
    summary: text,
    allowedActions: z
      .array(z.enum(['read', 'write', 'command', 'network', 'external-write']))
      .min(1),
    prohibitedActions: z.array(z.string()),
  }),
});
const bounded = (r: unknown, ctx: z.RefinementCtx) => {
  if (Buffer.byteLength(JSON.stringify(r), 'utf8') > 256 * 1024)
    ctx.addIssue({ code: 'custom', message: 'INPUT_TOO_LARGE' });
};
export const searchRequestSchema = z
  .discriminatedUnion('kind', [searchInitialSchema, followup])
  .superRefine(bounded);
export const taskRequestSchema = z
  .discriminatedUnion('kind', [taskInitialSchema, followup])
  .superRefine(bounded);
const publicUrl = text.refine((value) => {
  try {
    const u = new URL(value);
    return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password;
  } catch {
    return false;
  }
}, 'INVALID_SOURCE_URL');
export const searchOutputSchema = z.strictObject({
  answer: text,
  queries: z.array(text).min(1).max(5),
  sources: z
    .array(
      z.strictObject({
        title: text,
        url: publicUrl,
        publishedAt: z.string().nullable().optional(),
      }),
    )
    .min(1)
    .max(20),
});
export const taskOutputSchema = z.strictObject({
  summary: text,
  actions: z.array(text).max(50),
  artifacts: z.array(text).max(50),
  verification: z.array(text).max(50),
  unfinished: z.array(text).max(20),
});
export const toolResultSchema = z
  .strictObject({
    requestId: z.string(),
    mode: z.enum(['websearch', 'native']),
    status: z.enum([
      'completed',
      'partial',
      'needs_context',
      'needs_authorization',
      'failed',
      'cancelled',
    ]),
    search: searchOutputSchema.optional(),
    task: taskOutputSchema.optional(),
    questions: z.array(text).optional(),
    sessionToken: text.optional(),
    reason: z.strictObject({ code: text, message: text }).optional(),
    fallback: z.enum(['host_decides', 'inspect_then_continue', 'report_unfulfilled', 'none']),
    sideEffects: z.enum(['none', 'reported', 'unknown']),
    warnings: z.array(z.string()),
    elapsedMs: z.number().nonnegative(),
    retrievedAt: z.string().optional(),
  })
  .superRefine((r, ctx) => {
    const success = r.status === 'completed' || r.status === 'partial';
    const context = r.status === 'needs_context';
    const output = r.mode === 'websearch' ? r.search : r.task;
    if (
      success !== !!output ||
      (r.mode === 'websearch' ? !!r.task : !!r.search) ||
      context !== !!r.questions ||
      (!success && !context && (!r.reason || r.sessionToken)) ||
      (r.status === 'cancelled' && r.fallback !== 'none') ||
      (r.mode === 'websearch' && r.sideEffects !== 'none')
    )
      ctx.addIssue({ code: 'custom', message: 'INVALID_RESULT_STATE' });
  });
export type Workspace = z.infer<typeof workspaceSchema>;
export type SearchRequest = z.infer<typeof searchRequestSchema>;
export type TaskRequest = z.infer<typeof taskRequestSchema>;
export type SearchInitial = z.infer<typeof searchInitialSchema>;
export type TaskInitial = z.infer<typeof taskInitialSchema>;
export type ToolResult = z.infer<typeof toolResultSchema>;
export type TaskMode = 'websearch' | 'native';
export type PermissionPrompt = {
  deadlineAt: number;
  sessionId: string;
  toolCallId: string;
  title: string;
  details: string;
};
export type PermissionHandler = (
  prompt: PermissionPrompt,
  signal: AbortSignal,
) => Promise<'allow_once' | 'deny_once' | 'cancel'>;
export interface ToolTaskService {
  websearch(request: SearchRequest, signal: AbortSignal): Promise<ToolResult>;
  runTask(
    request: TaskRequest,
    signal: AbortSignal,
    permission?: PermissionHandler,
  ): Promise<ToolResult>;
  close(): Promise<void>;
}
