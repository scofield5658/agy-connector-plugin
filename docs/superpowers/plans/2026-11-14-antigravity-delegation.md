# Antigravity 委托插件首版实施计划

> 历史基线：本文件记录最初的纯文本范围。当前功能与状态以 README、工具契约及 2026-11-14-native-agy-delegation 设计为准；后续实施已加入搜索、原生委托和私有配置隔离。
> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. 2026-11-14 已获实施授权，使用 executing-plans。下方保留原始检查清单作为验收依据；实际完成与未完成项见文末和验证记录，不能因代码存在就认定全部通过。

**Goal:** 在 Codex / Cursor 的桌面或编辑器及 CLI 中提供中文文档润色和用户显式 Antigravity 委托，失败时让宿主继续原任务。

**Architecture:** 两个 Skill 共享本地 stdio MCP 和通用委托核心。核心拥有会话、预算与错误状态，Antigravity 适配器负责短进程及结构化协议；宿主保有资料读取、结果审查和最终写入权。

**Tech Stack:** Node.js 22+、TypeScript、pnpm 10.33.0、MCP SDK、Zod、标准 Markdown AST 解析、esbuild、Vitest。依赖版本在实施时核对官方兼容要求并写入锁文件，不在文档阶段安装。

**Spec:** [首版设计](../specs/2026-11-14-antigravity-delegation-design.md)。先读设计再执行计划；需求边界由设计维护，下面的接口是该边界的具体实现约定。

## 全局约束

- Antigravity CLI、Antigravity、agy 均指同一工具；说明文使用 Antigravity CLI，可执行文件默认按 `agy` 查找。
- 自动润色覆盖生成或修改的中文文档，以及明确要求撰写的中文长文；普通问答不触发。
- 通用委托须有用户明确调用该工具的意图，包括命令入口和自然语言指令。
- 润色是可选增强；失败须反馈原因、保留原稿并允许宿主继续，不以重试成功为交付条件。
- 首版只处理宿主传入材料，不允许 agy 自主读写仓库、运行命令、访问 Web/MCP 或执行外部操作。
- Node.js 22+；`packageManager` 固定 `pnpm@10.33.0`；保留 `pnpm-lock.yaml`。
- 中文润色总预算默认 30 秒，通用委托 60 秒；配置范围 5–60 秒；清理预留最多 2 秒，计入总预算。
- 总轮数默认 2，可配置为 1 或 2；失败自动重试 0 次；每个 MCP 实例同时最多 2 个 agy 进程。
- 输入合计最多 256 KiB UTF-8；每轮 stdout 最多 1 MiB、stderr 最多 64 KiB；超限不静默截断。
- 内存会话与去重记录空闲 15 分钟过期，最多 100 条；满额返回 BUSY，不淘汰运行任务。
- Cursor 的目标入口为 `/agy`、`/agy-polish`；Codex CLI 使用 `$agy`、`$agy-polish` 或 `/skills`，完整菜单名按实际命名空间验收。
- 不写全局配置，不自动安装/升级外部 CLI，不使用 `--dangerously-skip-permissions`，不自动创建 commit、push 或发布。
- 当前仓库无初始 commit。不要为创建 worktree 而先提交；文档阶段使用当前仓库，未来隔离方式由实际执行环境决定。

## Review Focus

1. 中文 UTF-8 字节被进程输出分块切断，或正文同时包含代码、链接、占位符：协议解码与不可改内容分别由任务 3、4 验证。
2. 原生 CLI 已回复但退出/子进程回收异常，或用户同时取消：截止时间内返回，不采用晚到内容；任务 2、3 验证。
3. 进程退出 0、模型报告成功，但权限被拒绝或结果结构损坏：不能报告候选可用；任务 3 验证。
4. 同内容重复调用、同请求标识换参数、跨工作区续接：不得重复消耗或串用结果；任务 2 验证。
5. GUI 与 Shell 的 PATH、插件路径变量、命名空间及 CLI 版本不同：不能以一个宿主成功推断其他宿主；任务 6、7 验证。

## 文件与职责映射

以下是计划文件，不表示当前已创建。实现时按任务产生文件，不预建空壳。

| 路径 | 职责 | 创建任务 |
| --- | --- | --- |
| `package.json`, `pnpm-lock.yaml`, `tsconfig.json`, `vitest.config.ts`, `.gitignore` | 固定运行时、依赖、普通测试与产物边界 | 1 |
| `src/antigravity/capabilities.ts` | 无模型调用的可执行文件及能力探测 | 1 |
| `scripts/probe-agy.ts`, `docs/compatibility.md` | 独立真实探测、已测能力和已知缺口 | 1 |
| `src/contracts.ts`, `src/config.ts` | 请求/结果 schema、限额与配置 | 2 |
| `src/delegation/engine.ts`, `src/delegation/sessions.ts` | 编排、限额、去重、会话 | 2 |
| `src/antigravity/driver.ts`, `protocol.ts`, `policy.ts` | 进程、NDJSON、权限隔离 | 3 |
| `src/workflows/general.ts`, `polish.ts`, `protected-content.ts` | 通用任务提示、中文判定、保护及验证 | 4 |
| `src/mcp/server.ts` | MCP 工具入口及取消映射 | 5 |
| `skills/agy/SKILL.md`, `skills/agy-polish/SKILL.md` | 用户显式委托及文档润色 | 5 |
| `integrations/plugin-metadata.json`, `integrations/codex/`, `integrations/cursor/` | 公共插件元数据和宿主清单模板 | 6 |
| `scripts/build.mjs`, `package.mjs`, `check-package.mjs` | 构建、宿主包生成与验证 | 6 |
| `.github/workflows/test.yml`, `docs/usage.md`, `docs/verification.md` | CI、使用与人工验收证据 | 7 |
| `tests/` | 各任务创建对应测试；真实探测不进入默认测试 | 1–7 |

运行依赖使用 MCP SDK、Zod，以及 `unified` / `remark-parse` / `remark-frontmatter` 解析 Markdown 结构；frontmatter 作为原样保护内容，不执行或展开其中值。开发依赖包含 TypeScript、esbuild、Vitest 和用于独立探测的 tsx。实现前核对兼容版本；不引入 Python、数据库或 GUI 框架。

## 共同接口约定

这些类型定义于任务 2 的 `src/contracts.ts`，所有任务复用，不自行定义同义字段。所有输入由运行时 schema 验证，不只依赖 TypeScript。

```ts
type Profile = 'zh-polish' | 'general';
type Scope = { host: 'codex' | 'cursor'; workspaceRoot: string; hostTaskId: string };
type ContextItem = { label: string; content: string };
type InitialRequest = {
  kind: 'initial'; requestId: string; scope: Scope; profile: Profile;
  invocation: 'automatic' | 'explicit'; goal: string; text: string;
  operation: 'analyze' | 'transform' | 'generate' | 'execute';
  documentKind: 'document' | 'longform' | 'other';
  context: ContextItem[]; constraints: string[]; protectedText: string[];
  outputLanguage?: string; externalProcessingAllowed: boolean;
  providerRequirement: 'preferred' | 'required';
};
type FollowupRequest = {
  kind: 'followup'; requestId: string; scope: Scope; sessionToken: string;
  feedback: string; context: ContextItem[];
};
type DelegateRequest = InitialRequest | FollowupRequest;
type NativeOutput =
  | { kind: 'candidate'; text: string; notes: string[] }
  | { kind: 'needs_context'; questions: string[] };
type DelegateResult = {
  requestId: string;
  status: 'candidate' | 'needs_context' | 'skipped' | 'failed' | 'cancelled';
  candidate?: string; questions?: string[]; sessionToken?: string;
  sourceDigest?: string;
  reason?: { code: string; message: string };
  fallback: 'original' | 'host_decides' | 'report_unfulfilled' | 'none';
  source: 'antigravity' | 'none'; warnings: string[]; elapsedMs: number;
};
```

`scope` 由 Skill 为本次宿主任务提供并保持一致；`workspaceRoot` 仅用于逻辑隔离，不授予目录访问权。`invocation` 是宿主意图声明，不是安全权限凭据；实际工具能力始终受 text-only 策略限制。Skill 将用户所需操作映射到 `operation`，其中 execute 在首版返回 SCOPE_UNSUPPORTED；返回建议代码属于 generate，不代表执行。

`general + automatic` 属非法调用；用户禁止外部处理时不启动进程。`candidate` / `needs_context` 才可携带 session token。取消及失败结果不携带可续接 token；错误消息不包含原稿、凭据、完整命令或原始 stderr。

预算只由本插件配置和剩余会话时间决定，不从文稿接受 CLI 参数。`sourceDigest` 是初始 `text` 的 UTF-8 SHA-256，candidate 结果必须包含，反馈轮继续引用同一原稿。候选不等于完成交付；宿主采纳和文件写入不属于 MCP 工具职责。

内部接口：

```ts
interface AgyDriver {
  runTurn(input: RunTurnInput, signal: AbortSignal): Promise<RunTurnResult>;
}
type RunTurnInput = {
  prompt: string; conversationId?: string; workspaceDir: string;
  deadlineAt: number; model?: string;
};
type RunTurnResult =
  | { ok: true; output: NativeOutput; conversationId: string; warnings: string[] }
  | { ok: false; code: string; message: string; cleanupWarning?: string };
interface Workflow {
  prepare(request: InitialRequest): PrepareResult;
  validate(original: InitialRequest, candidate: string): ValidationResult;
}
type PrepareResult =
  | { applicable: true; prompt: string }
  | { applicable: false; code: string; message: string };
type ValidationResult = { accepted: boolean; warnings: string[]; reason?: string };
type Clock = { now(): number };
type PluginConfig = {
  polishBudgetMs: number; generalBudgetMs: number; maxTurns: 1 | 2;
  chineseRatioThreshold: number;
};
interface Delegator {
  delegate(request: DelegateRequest, signal: AbortSignal): Promise<DelegateResult>;
  close(): Promise<void>;
}
```

`RunTurnInput.workspaceDir` 是核心创建的会话临时目录，绝不取 `Scope.workspaceRoot`。`conversationId` 只能来自会话记录；schema、权限参数及可执行路径由适配器配置固定，宿主无法直接注入。候选 `validate` 属于任务配置，不把中文限制应用到 general。

## 任务 1：验证 CLI 能力与 text-only 隔离，建立可重复基线

**Files:** 创建文件映射中的任务 1 文件，以及 `tests/capabilities.test.ts`、`tests/fixtures/agy/`；更新设计基线和 README 的运行时说明。

**Interfaces:** 产出 `detectCapabilities(executable: string, signal: AbortSignal): Promise<CapabilityReport>`；`CapabilityReport` 定义在 `capabilities.ts`，包含 `available`、`version`、`requiredFlags`、`supported`、`reason`。探测只运行版本/help，登录状态明确标为未知。

- [ ] 固定 Node.js、pnpm、TypeScript 和默认 `vitest run` 脚本；默认测试不匹配 live 探测。添加只忽略本地产物/敏感配置的 `.gitignore`，保留锁文件、例子和夹具。
- [ ] 写失败测试：找不到命令返回 unavailable；版本命令超时有界结束；缺少 `--settings` / `--conversation` / JSON schema / 流式输入输出能力返回 unsupported；help 读取不触发模型调用。
- [ ] 固定测试 `missing_binary_is_unavailable` 的关键断言：`expect(report).toMatchObject({ available: false, supported: false })`；`missing_required_flag_is_unsupported` 断言 `expect(report.supported).toBe(false)`，同时校验具体缺失项。
- [ ] 运行 `pnpm exec vitest run tests/capabilities.test.ts`，确认失败源自缺少行为，再实现 `detectCapabilities`；测试不得自动尝试其他同名二进制。
- [ ] 写独立 `scripts/probe-agy.ts`：使用虚构文稿，验证单轮 stdin + EOF + structured_output、下一短进程的指定会话续接、超时、取消、文件/命令/MCP/Web 拒绝和退出回收。对拒绝测试只使用临时诱饵文件，不触碰业务资料。
- [ ] 核对当前版本支持的自定义规则、插件和 hooks 隔离方式；不猜测未记录的 settings 键，不修改真实全局配置。无受支持且可验证的隔离方式时记录不支持，并让后续适配器拒绝该组合，不能用提示词冒充隔离。
- [ ] 仅在实际获准开展实现探测后运行 `pnpm exec tsx scripts/probe-agy.ts`，记录版本、参数形态、脱敏事件、权限效果和退出行为到 `docs/compatibility.md`；调查前次回收权限错误属于脚本、运行环境还是 CLI。
- [ ] 运行 `pnpm exec vitest run tests/capabilities.test.ts` 和 `pnpm typecheck`，应通过；检查生成夹具没有真实文稿、凭据及个人绝对路径。保留未提交改动。

**交付门槛：** 支持的调用组合和不支持情况都有证据。隔离不能确认时，不能把真实运行路径标记 ready；仍可继续实现模拟协议及安全降级。

## 任务 2：建立请求协议、会话与非阻塞降级核心

**Files:** 创建 `src/contracts.ts`、`src/config.ts`、`src/delegation/engine.ts`、`src/delegation/sessions.ts`、`tests/contracts.test.ts`、`tests/delegation.test.ts`。

**Interfaces:** 消费 `AgyDriver` 与 `Workflow` 接口；产出 `createDelegator(deps: { driver: AgyDriver; workflows: Record<Profile, Workflow>; config: PluginConfig; clock: Clock }): Delegator`，其 `delegate(request: DelegateRequest, signal: AbortSignal): Promise<DelegateResult>` 为唯一任务入口，`close(): Promise<void>` 清理本实例任务。`Clock` 暴露 `now(): number`；计时/取消机制支持测试注入。

- [ ] 写请求/结果 schema 失败测试：非法字段组合、空任务、`general + automatic`、超过输入 UTF-8 字节上限以及违反结果状态约束时均被拒绝。
- [ ] 用 fake driver 写核心行为测试：禁止外部处理不启动进程；同标识同参数只调用一次并共享结果；同标识换参数冲突；不同 scope 或未知 token 不续接；第 3 轮被拒绝；30/60 秒预算不因续接重置。
- [ ] 增加容量与生命周期测试：第 3 个并发进程立即 BUSY；100 条记录满额不淘汰运行任务；15 分钟空闲过期；取消和成功同时发生时取消优先；失败后迟到结果不改变终态。
- [ ] 固定关键断言：`same_request_reuses_run` 中 `expect(driver.runTurn).toHaveBeenCalledTimes(1)`；`polish_failure_preserves_original` 中 `expect(result).toMatchObject({ status: 'failed', fallback: 'original' })`；`required_provider_failure_is_not_substituted` 中 `expect(result.fallback).toBe('report_unfulfilled')`；`late_result_after_cancel_is_ignored` 中 `expect(result.status).toBe('cancelled')`。
- [ ] 运行 `pnpm exec vitest run tests/contracts.test.ts tests/delegation.test.ts`，观察预期失败后实现 schema、配置校验、会话记录和编排。请求指纹涵盖全部影响结果的输入，原稿摘要另行保存用于宿主核对。
- [ ] 实现错误到 fallback 的映射：中文失败 original，general preferred 失败 host_decides，general required 失败 report_unfulfilled；cancelled 的 fallback 为 none，不自动开始新任务。
- [ ] 明确自动调用去重与显式重试：同任务同输入的自动重复返回已尝试状态；显式新请求允许再次委托，不把新的工作静默复用成旧业务成功。成功/失败缓存只在本实例内存保留，关闭后失效。
- [ ] 复跑上述测试及 `pnpm typecheck`；断言失败和过期均无可续接 token，输出含可识别原因且不泄漏输入。检查 diff，保留未提交。

## 任务 3：实现受限 agy 适配器与有界进程生命周期

**Files:** 创建 `src/antigravity/driver.ts`、`src/antigravity/protocol.ts`、`src/antigravity/policy.ts`、`tests/agy-driver.test.ts`、`tests/agy-protocol.test.ts`、`tests/fixtures/fake-agy.mjs`。

**Interfaces:** 消费任务 1 的 `CapabilityReport` 和任务 2 的 `AgyDriver` / `RunTurnInput` / `RunTurnResult`；产出 `createAgyDriver(config: AgyRuntimeConfig): AgyDriver`。`AgyRuntimeConfig` 在 `driver.ts` 定义，含可执行绝对路径、能力报告和 `policy.ts` 产生的已验证 text-only 启动配置；不接受任意宿主传入的参数列表。协议层 `parseResultEvent(event: unknown): RunTurnResult` 仅接受最终 result 的有效 structured_output；驱动层另外核对退出和权限诊断，只有全部通过才返回 ok。

- [ ] 用本地 fake-agy 进程写失败测试：成功结果、非零退出、缺失 result、畸形 JSON、含多个文本片段的 response、结构化输出缺字段、stdout/stderr 超限、拒绝工具但退出 0。
- [ ] 增加分块测试：中文字符跨 Buffer 边界、NDJSON 行跨块、最后一行无换行、未识别非终态事件、多个 result 的处理。每次短进程只接受本轮唯一最终结果，不把进度文本当候选。
- [ ] 固定 `response_text_is_not_structured_output` 的断言 `expect(result).toMatchObject({ ok: false, code: 'INVALID_OUTPUT' })`；`permission_denial_with_exit_zero_fails` 断言 `expect(result).toMatchObject({ ok: false, code: 'PERMISSION_DENIED' })`；有效中文分块结果必须逐字等于夹具原文。
- [ ] 增加生命周期测试：启动失败、stdin 写失败、关闭 stdin 后挂起、只返回部分内容、SIGTERM 不响应、进程清理错误、AbortSignal 中断。限额和清理的总耗时均不超过已分配 deadline，不对无关进程发信号。
- [ ] 运行 `pnpm exec vitest run tests/agy-driver.test.ts tests/agy-protocol.test.ts`，确认失败后，以 `spawn` 参数数组和 `shell: false` 实现短进程调用、stdin 写入及输出解析；非秘密固定 schema 可作为参数，文稿只走 stdin。
- [ ] 实现任务 1 已验证的临时 settings 与自定义项隔离，不传全局 `--continue`、权限跳过参数或业务目录；未知版本/能力不能套用未经验证的安全配置。
- [ ] 按系统区分受控进程终止方式，只有确认为本次创建的 PID/进程组才清理；清理失败返回脱敏告警并禁止该实例继续创建新的 agy 进程，避免泄漏累积。不要用全局按名称 kill。
- [ ] 处理退出码、result 状态、权限诊断及输出校验：能识别才分类 AUTH_REQUIRED/RATE_LIMITED 等，无法识别返回 CLI_ERROR；`structured_output` 不合格直接失败，不通过正则猜出“像 JSON 的部分”。
- [ ] 复跑任务 1–3 测试与 `pnpm typecheck`，核查 MCP 将来使用时不会混入 agy stdout。真实回归通过独立探测脚本执行，不加入普通 CI。

## 任务 4：实现中文润色和通用委托任务配置

**Files:** 创建 `src/workflows/general.ts`、`src/workflows/polish.ts`、`src/workflows/protected-content.ts`、`tests/workflows.test.ts`、`tests/content-protection.test.ts`、`tests/fixtures/documents/`。

**Interfaces:** 产出 `generalWorkflow: Workflow`、`polishWorkflow: Workflow`；正文分析 `analyzeDocument(text: string, protectedText: string[]): DocumentAnalysis` 由 `protected-content.ts` 定义，包含 `prose`、`hanRatio` 和受保护片段及位置。所有最终候选仍交宿主语义核验。

- [ ] 写触发失败测试：普通问答不处理，document/longform 的汉字比例 50% 边界，纯代码和空正文跳过，短中文通知不因字数被排除；显式中文润色可覆盖比例判断，禁止外部处理始终优先。
- [ ] 写通用任务失败测试：显式翻译成英文保持英文要求、审阅代码只返回意见，`operation=execute` 返回 SCOPE_UNSUPPORTED；仅提到工具的自然语言负例在任务 5、7 检查，不伪装成核心能够独立识别所有用户意图。
- [ ] 写内容保护测试：代码块、行内代码、链接目标、占位符、frontmatter 和指定原样片段改变时拒绝；数字变化发出核验提示；原文事实和确定程度由 Skill 的语义步骤核对，不宣称字符串检测足以证明。
- [ ] 固定 `ordinary_qa_is_skipped` 的断言 `expect(prepared.applicable).toBe(false)`；`modified_protected_span_is_rejected` 断言 `expect(validation.accepted).toBe(false)`；`general_english_request_has_no_chinese_filter` 断言 `expect(prepared.applicable).toBe(true)` 并检查提示保留英文输出要求。
- [ ] 运行 `pnpm exec vitest run tests/workflows.test.ts tests/content-protection.test.ts`，确认失败后实现 Markdown AST 分析、profile prompt 和验证。上下文序列化成明确的数据区域，不执行其中的命令或把内容当 CLI 参数。
- [ ] 固定 `needs_context` 的非空问题列表：自动润色宿主无答案时保留原稿；一般委托由宿主决定提问，继续总轮数与期限不重置。
- [ ] 复跑任务 1–4 测试；验证两个 profile 共用同一引擎，general 不继承中文比例和文体规则。保留未提交改动。

## 任务 5：接入 MCP 与两个 Skill，形成可调用闭环

**Files:** 创建 `src/mcp/server.ts`、`skills/agy/SKILL.md`、`skills/agy-polish/SKILL.md`、`tests/mcp.test.ts`、`tests/skill-contracts.test.ts`、`tests/fixtures/skill-scenarios.json`。

**Interfaces:** 注册 `agy_delegate`，输入 `DelegateRequest`，输出 `DelegateResult`；注册 `agy_health`，无任务参数，只检查可执行文件、版本、能力和配置，不发模型请求。MCP transport 取消和进程关闭映射到同一 delegator 生命周期。

- [ ] 写 MCP 客户端失败测试：两个工具可发现，schema 可用；正常候选、needs_context、skipped、failed、cancelled 均可结构化读取；业务失败使用正常工具响应中的明确状态，协议级错误才使用 MCP 错误，Skill 对两种失败都降级。
- [ ] 写连接断开/取消测试：断开中止对应请求且结果不会发送给新连接；stdout 只有 MCP 帧，所有诊断去 stderr 且脱敏。宿主拿不到工具或 MCP 未启动的场景进入 Skill 级兜底。
- [ ] 固定 `business_failure_is_a_readable_tool_result` 的断言 `expect(reply.structuredContent).toMatchObject({ status: 'failed', fallback: 'original' })`，并验证协议级调用完成；`health_does_not_invoke_model` 断言 fake driver 的 `runTurn` 调用次数为 0。
- [ ] 运行 `pnpm exec vitest run tests/mcp.test.ts` 后实现工具层。工具不得接受任意原生命令、底层 conversation ID 或自由 permissions 参数。
- [ ] 创建项目内两个 Skill 前读取适用的 skill-creator 与 skill-creator-extra-rules 规范；仅创建本仓库 Skill，不安装/修改全局 Skill。描述同时覆盖 Antigravity CLI、Antigravity、agy 三个指代。
- [ ] 编写 `agy`：用户明确委托才调用，处理 `/agy` 或 `$agy` 等宿主入口及自然语言明确请求；材料、交付语言、边界、结果来源与必要澄清均有步骤，不自动接管普通任务。
- [ ] 编写 `agy-polish`：先判断任务与主要语言，传底稿和必要上下文；候选先做事实/语义审查，具体反馈最多一次；失败保留原稿、说明原因并停止调用；采用前核对原稿未变化。
- [ ] 添加 Skill 场景清单及可机械检查项：三种别名、普通问答负例、显式禁止外部处理、英文通用任务、用户要求必须 agy、同稿失败不循环、工具不可用、用户中途改稿。文本契约测试只证明规则存在，实际选择与遵循在任务 7 人工验收。
- [ ] 运行 `pnpm exec vitest run tests/mcp.test.ts tests/skill-contracts.test.ts` 与全量 `pnpm test`、`pnpm typecheck`；不把自动触发描述成确定性的系统拦截。

## 任务 6：生成 Codex / Cursor 发行包及便捷入口

**Files:** 创建任务映射中的 integrations 与 scripts，增加 `tests/package.test.ts`、`tests/manifest.test.ts`；更新 README 的安装说明。`package.json` 是版本唯一来源。

**Interfaces:** `pnpm build` 生成 `dist/server.cjs`；`pnpm package` 生成 `release/codex/`、`release/cursor/` 及各自版本归档；`pnpm check:package` 校验两个包。生成清单不在源码中维护重复版本。

- [ ] 写清单/包结构失败测试：技能名 `agy` / `agy-polish`、入口存在、版本一致、插件根相对路径有效、Cursor 变量正确、无生产凭据和真实原稿、无开发机绝对路径、无意外符号链接逃逸。
- [ ] 运行 `pnpm exec vitest run tests/package.test.ts tests/manifest.test.ts`，再实现 esbuild 打包及白名单发行。Codex 和 Cursor 根清单使用各自已核实格式；源码中的共享 Skill 只维护一份。
- [ ] 生成本地 marketplace 或文档化受支持的本地加载方式；实际安装是后续用户操作，不由构建/打包脚本修改全局注册表。Cursor CLI 可验证本机 help 中的 `--plugin-dir`，其他路径以当前客户端为准。
- [ ] 在说明中给出 Cursor `/agy`、`/agy-polish`，Codex `$agy`、`$agy-polish`、`/skills` 用法；插件命名空间产生的实际全名在任务 7 填入兼容表。不要承诺 Codex 原生 `/agy` 或占用系统 `agy` 命令。
- [ ] 运行 `pnpm build`、`pnpm package`、`pnpm check:package`；从带空格及中文的临时目录解压，通过 MCP 客户端连接启动，验证 Node/PATH 和插件根定位，不依赖开发目录。
- [ ] 检查 `git status --short`：dist/release/cache 被忽略，源码、锁文件、模板和说明可见；保留未提交状态。

## 任务 7：完成跨宿主验收、质量评价与使用文档

**Files:** 创建 `.github/workflows/test.yml`、`docs/usage.md`、`docs/verification.md`，更新 `docs/compatibility.md`、README 和必要测试夹具。

**Interfaces:** 不新增产品能力；产出可复现的验证记录及已支持矩阵，所有记录区分模拟、真实 CLI 与宿主端到端。

- [ ] CI 使用 macOS / Linux / Windows、Node.js 22、pnpm 10.33.0；依次执行锁文件安装、typecheck、普通测试、build、package、check:package。不得依赖登录态或真实模型。
- [ ] 将任务 1 的真实探测在目标环境重跑，记录 agy 版本、选用模型（可确认时）、配置、输入规模、耗时和失败行为。没有目标系统证据的组合标记“未验证”，不宣称全平台可用。
- [ ] 分别在 Codex 桌面、Codex CLI、Cursor 编辑器、Cursor CLI 检查插件加载、工具发现、显式入口名称及一次虚构文稿调用；先核对用户对本地安装/加载的授权，必要时只准备可审查的发行包，不自动改全局配置。
- [ ] 每个宿主检查普通问答不触发、三种自然语言别名触发通用任务、中文文档触发润色、英文任务保持英文；检验当前会话和新会话的加载差异。
- [ ] 通过替换为测试夹具的配置验证 CLI 缺失、超时、坏结果和 MCP 未启动的宿主降级；原稿仍可交付，错误可见且没有续跑循环。不要破坏真实 agy 安装来模拟故障。
- [ ] 使用至少 12 个固定样本比较原稿与候选，记录自然度、简洁度、作者语气、事实和确定程度；包含调研中“预计暂停 30 分钟”反例。新增事实、承诺升级或代码/链接损坏必须被拒绝或修正。
- [ ] 补齐安装、卸载、故障、数据流与 CLI 会话留存说明；明确没有全局原生 `/agy` 保证、没有自主文件写入、没有静默替代 agy 来源。
- [ ] 运行最终 `pnpm typecheck`、`pnpm test`、`pnpm build`、`pnpm package`、`pnpm check:package` 与 `git diff --check`。记录未能执行的宿主/平台验证，关闭已完成任务；不 commit、push、发布或自动安装。

## 需求覆盖与当前状态

| 设计验收项 | 实施任务 | 当前证据 |
| --- | --- | --- |
| A1–A3：触发、别名与任务范围 | 4、5、7 | 已实现触发与边界单测、Skill行为推演；真实宿主选择待验 |
| A4：反馈、会话与去重 | 2、3、7 | 真实指定conversation续接通过；核心去重/会话测试通过 |
| A5–A7：降级、权限、取消与迟到 | 1、2、3、5、7 | 回收/取消/降级已测；全局启动隔离门槛未过，gate关闭 |
| A8：内容保护与质量 | 4、5、7 | 12个真实样本：9候选、3超时保留原稿；保护测试通过 |
| A9：四个宿主与快捷入口 | 5、6、7 | Codex原生解析成功；独立MCP包通过；四宿主完整验收待完成 |
| A10：工程与发行规范 | 1、6、7 | 源码/锁文件/CI/双宿主包及白名单检查已完成 |

用户已在设计审阅后明确授权实施，仍禁止 commit。任务2–6已实现并经测试；任务1的全局/插件启动隔离门槛、任务7的四宿主全面验收未闭环，真实调用保持禁用。MCP 实际参数使用 `{request: DelegateRequest}` 对象包装，Node 最低版本22.12.0。详情见 [验证记录](../../verification.md)。后续扩大权限、写入、默认触发或失败策略仍须按用户 AGENTS.md 确认。
