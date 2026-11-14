# 原生委托与独立搜索实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. 用户已确认三模式设计及继续实施；当前会话内执行；用户后续授权交付到 `feat/initial-connector`，不推 main。

**Goal:** 增加 agy-websearch 专用搜索和共享工作目录的 agy 通用委托，保留已验证的中文润色路径。

**Architecture:** 继续使用 stdio MCP、短进程和明确会话续接。新增工具通过适配层复用已有去重、会话、取消与预算引擎，以经过独立 schema 校验的 JSON 请求/结果作为内部文本载荷；外部接口保持各自强类型。通过共享并发门限制所有模式合计最多两个 CLI 进程。

**Tech Stack:** Node.js22.12+ / TypeScript / Zod / MCP SDK / Vitest，沿用现有依赖。

**Spec:** [已确认设计](../specs/2026-11-14-native-agy-delegation-design.md)

## Global Constraints

- 仅按用户最新授权提交并推送到 `feat/initial-connector`；不推 main，不修改现有全局配置或安装状态。
- 文本／搜索使用请求私有配置；原生委托用 agy 自有配置和共享项目路径，不提权、不绕过原生审批。
- 显式触发搜索和原生委托；自动润色不能升级模式；普通问答不触发。
- 所有模式全局并发2；每个委托引擎记录上限100、空闲15分钟；两轮总预算，零自动重试。
- 搜索默认60秒、可配置5–60秒；原生默认120秒、可配置5–300秒。文本既有30/60秒配置不变。
- 未确认回收时禁用对应执行器；原生失败副作用未知，接手前检查；取消不自动接手。
- 仅已实测 macOS arm64 agy1.5.8 可开启；其他平台/版本按模式明确降级。
- 指令名 agy / agy-polish / agy-websearch；搜索 MCP 工具名 agy_websearch，原生 agy_run_task。

## Review Focus

- search_web 有名字但未实际执行、链接来自模型编造：必须有成功工具事件，来源格式校验且保留宿主复核提示。
- 原生任务产生部分写入后超时：返回副作用未知，不自动重试或宣称回滚。
- 不同模式用相同token、反馈偷偷扩大目录：scope绑定模式，反馈无目录/授权可变字段。
- 路径含符号链接或目标尚未存在：规范化已有父目录，检查制品目录位于声明的writeRoots内；不宣称这能限制任意外部MCP。
- 新工具与中文润色同时调用：共享并发门；单个等待者取消不能取消其他任务或收到迟到成功。

### Task 1: 新接口及路径契约

**Files:** src/tasks/contracts.ts、src/tasks/workspace.ts、tests/task-contracts.test.ts。
**Interfaces:** searchRequestSchema / taskRequestSchema；SearchRequest / TaskRequest / ToolResult；resolveWorkspace(workspace) 返回规范化 cwd/readRoots/writeRoots/artifactDir。

- [x] RED：自动触发拒绝、超256KiB拒绝、followup不能含授权字段；query必填；task要求既有配置授权及实际cwd；制品越过writeRoots/符号链接越界拒绝。
- [x] 实现严格 schema、http(s)来源且无凭据URL、授权范围及结果状态验证；允许既有父目录下尚未创建的制品目录，不主动创建业务目录。
- [x] GREEN：pnpm test tests/task-contracts.test.ts。

### Task 2: 搜索/原生 CLI 适配与共享限流

**Files:** src/tasks/driver.ts、src/tasks/protocol.ts、src/tasks/acp.ts、src/antigravity/limiter.ts、tests/task-driver.test.ts。
**Interfaces:** createTaskDriver(config):AgyDriver；原始请求通过 RunTurnInput.request 传递；decodeToolTranscript(mode,stdout,stderr,exitCode)；limitDriver(driver,sharedLimiter)。

- [x] RED：搜索只开放 search_web/finish；无search事件、非HTTP来源、外部工具事件拒绝；原生允许工具事件但失败不能伪装成功。
- [x] 实现搜索私有agent/profile、原生ACP共享cwd且不传私有agent/放宽审批参数，代理结构化权限请求；搜索使用原生扁平JSON schema；原生ACP结果使用独立响应与工具证据协议校验，转换为经过校验的内部JSON候选。
- [x] RED→GREEN：共享并发2、BUSY不排队；取消/错误释放配额，指定conversation不匹配拒绝，原生结果保留副作用警告。
- [x] GREEN：pnpm test tests/task-driver.test.ts；pnpm typecheck。

### Task 3: 复用生命周期并接入 MCP

**Files:** src/tasks/service.ts、src/delegation/engine.ts、src/contracts.ts、src/config.ts、src/mcp/main.ts、src/mcp/server.ts、tests/tasks.test.ts、tests/mcp.test.ts。
**Interfaces:** ToolTaskService.websearch(request,signal) / runTask(request,signal) / close()；MCP保持 {request:...} 根对象。

- [x] RED：模式串用token拒绝、改范围重用ID冲突、两轮共用预算、执行失败副作用未知、取消不接手、required失败报告未完成。
- [x] 新适配层保留真实任务及operation，不借既有 generalWorkflow 绕过 execute拒绝；复用底层engine但使用独立workflow校验新载荷。引擎仅增加内部原始请求传递和受限预算选择器，既有公共接口不扩大权限。
- [x] 注册 agy_websearch / agy_run_task，分模式health；MCP关闭同时清理两个引擎；业务失败正常结果、协议错误isError；权限经MCP elicitation交由宿主用户明确批准，仅allow_once，拒绝/取消/超时/不支持一律不批准。
- [x] GREEN：pnpm test tests/tasks.test.ts tests/mcp.test.ts tests/delegation.test.ts。

### Task 4: Skills、发行包与真实验证

**Files:** skills/agy/SKILL.md、skills/agy-websearch/SKILL.md、integrations、scripts/verify-isolation.ts、scripts/verify-modes.ts、docs/usage.md、docs/tool-contract.md、docs/verification.md、docs/compatibility.md、README.md、tests/package.test.ts。

- [x] 更新三入口，MCP调用格式和失败接手条件；保留普通问答、引用指令、不允许外发、强制供应方的行为。
- [x] 独立环境验证真实搜索和共享制品、允许/拒绝；ACP 夹具覆盖读取范围、部分写入后超时与授权过期，不把模型自述当权限证据。
- [ ] Codex/Cursor CLI与GUI分别验证加载/菜单/调用/失败/取消；记录实际限制，不把包smoke等同宿主验收。
- [x] pnpm test、typecheck、build、package、check:package、format:check；检查文档链接、未提交状态与进程回收。
- [x] 独立整体审查，修复重要问题并复测；保留ledger和未提交工作区。

Task2/3补充验收：ACP request_permission内容完整展示、授权匹配session/toolCallId、模型或工具参数不能伪造批准、迟到响应不执行、只支持allow_once、MCP连接关闭取消待批。真实原生协议先在独立profile与虚构文件验证，再核对宿主表单。

当前交付状态：实现、CLI/协议验证和文档精简完成；GUI 及 Cursor 交互式授权验收未闭环，详见 [验证记录](../../verification.md)。用户已授权采用 MIT，并在 GUI 无法推进后授权提交及推送开发分支 `feat/initial-connector`；不推 main。
