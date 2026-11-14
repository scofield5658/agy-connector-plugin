# MCP 工具契约

| 工具 | 用途 | 权限 |
| --- | --- | --- |
| `agy_delegate` | 中文润色；兼容旧的纯文本委托 | 只处理传入材料，不写业务文件 |
| `agy_websearch` | 用户明确指定的网页搜索 | 独立空间，search_web / finish |
| `agy_run_task` | 用户明确指定的通用任务 | 共享工作目录，agy 自有配置与工具 |
| `agy_health` | 检查版本、配置和模式可用性 | 不调用模型，参数为 `{}` |

前三项接受 `{ "request": ... }`，返回 `structuredContent`，另附相同内容的 text。工具名可能带宿主服务器前缀。完整字段校验以 `src/contracts.ts`、`src/tasks/contracts.ts` 为准。

## 初次调用

以下为润色请求；路径、任务标识和正文由宿主填写：

```json
{
  "request": {
    "kind": "initial", "requestId": "notice-001",
    "scope": { "host": "codex", "workspaceRoot": "/path/to/project", "hostTaskId": "notice" },
    "invocation": "automatic", "externalProcessingAllowed": true,
    "providerRequirement": "preferred", "context": [],
    "profile": "zh-polish", "goal": "保留预计语气，精简维护通知",
    "text": "我们预计于明天上午暂停服务30分钟。",
    "operation": "transform", "documentKind": "document",
    "constraints": [], "protectedText": [], "outputLanguage": "中文"
  }
}
```

所有初次请求共有 `kind`、`requestId`、`scope`、`invocation`、`externalProcessingAllowed`、`providerRequirement`、`context`。`scope.host` 为 codex/cursor；workspaceRoot 是宿主工作区绝对路径，hostTaskId 在同一任务内保持稳定。context 项为 `{ "label": "读者", "content": "普通用户" }`。外部处理标志依据已有授权和限制填写，不授予新权限。

`providerRequirement=required` 表示用户要求必须由 agy 完成；否则为 preferred。每次新请求使用新 requestId，传输重放保留原值；失败不重放。

其他模式在共有字段上增加以下内容，**不要混入润色专属字段**：

| 工具 | 专属字段 |
| --- | --- |
| `agy_websearch` | `query`、`domains`（数组，可空）、`language`；invocation 必须 explicit |
| `agy_run_task` | `task`、`workspace`、`authorization`；invocation 必须 explicit |

原生委托字段示例：

```json
{
  "task": "在当前项目的 reports 中生成评估报告",
  "workspace": {
    "cwd": "/path/to/project", "readRoots": ["/path/to/project"],
    "writeRoots": ["/path/to/project"], "artifactDir": "/path/to/project/reports"
  },
  "authorization": {
    "useAgyConfiguration": true, "summary": "用户授权读取项目并生成报告",
    "allowedActions": ["read", "write"], "prohibitedActions": ["不得发布或修改外部系统"]
  }
}
```

cwd/readRoots/writeRoots 必须是已存在的绝对目录；artifactDir 可尚未创建，但必须位于 writeRoots 内。路径校验会解析符号链接。allowedActions 为 read/write/command/network/external-write 的子集，用于明确任务授权，并非完整的 OS 或外部 MCP 权限强制器。

兼容 `agy_delegate(profile=general)` 仍只接受 explicit 的 analyze/transform/generate；execute 被拒绝，不能用此入口绕过通用委托边界。documentKind 为 document/longform/other；outputLanguage 可省略。

## 反馈与授权

成功或需要上下文且返回 sessionToken 时，可向**原工具**反馈一次：

```json
{
  "request": {
    "kind": "followup", "requestId": "notice-002",
    "scope": { "host": "codex", "workspaceRoot": "/path/to/project", "hostTaskId": "notice" },
    "sessionToken": "<原结果中的 token>",
    "feedback": "保留预计，不增加维护原因。", "context": []
  }
}
```

反馈不能改模式、目录或授权；token 仅在原 MCP 实例和 scope 有效，不是鉴权凭据。审批由 ACP 请求绑定 session/toolCall，再经 MCP elicitation 交给宿主用户；请求参数不接受 approve、自由 CLI 参数、底层 conversationId 或权限覆盖。仅本次批准有效，迟到批准不执行。

## 返回值与接手

文本返回 candidate/needs_context/skipped/failed/cancelled。candidate 的 `sourceDigest` 是原稿 UTF-8 SHA-256，采用前核对当前稿未变，并复核事实与确定程度。

搜索和原生委托返回 completed/partial/needs_context/needs_authorization/failed/cancelled。completed 表示本次调用返回合格结构，**不证明内容正确或用户目标全部达成**：

- `search`：answer、实际工具事件中的 queries、sources（title/url/可选 publishedAt）；retrievedAt 为接收时间。来源由模型汇总，宿主仍需核验。
- `task`：summary、已完成工具事件中的 actions、存在且位于 writeRoots 内的 artifacts、verification、unfinished。文件存在不是内容正确或任意命令产物已完整收集的保证。
- `sideEffects`：none/reported/unknown；原生失败默认 unknown，不能声称已回滚。

| fallback | 宿主动作 |
| --- | --- |
| original | 保留润色原稿 |
| host_decides | 在原授权内继续 |
| inspect_then_continue | 先检查部分副作用，再决定接手 |
| report_unfulfilled | 报告指定供应方未完成 |
| none | 停止；不接手被拒绝或取消的操作 |

业务失败正常返回 reason.code/message；非法 MCP 参数为协议错误。错误不回显原始 stderr 或原稿。

每个 MCP 实例合计最多两个 agy 进程，忙时不排队；文本引擎与搜索/原生引擎各保留最多 100 条请求记录，空闲 15 分钟失效。每请求 JSON 最大 256 KiB，stdout/stderr 上限 1 MiB/64 KiB，不静默截断。默认预算与配置见 [使用说明](usage.md)。
