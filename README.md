# agy-connector-plugin

在 Codex 和 Cursor 中调用本地 Antigravity CLI，提供中文润色、网页搜索和通用任务委托。Antigravity CLI、Antigravity、agy 指同一个工具。

| 功能 | 使用方式 | 工作范围 |
| --- | --- | --- |
| 中文润色 | `agy-polish`，或由宿主在撰写中文文档时选择 | 只处理传入的原稿和上下文，由宿主审阅后采用 |
| 网页搜索 | 明确指定 `agy-websearch` | 独立空间，仅使用 agy 的网页搜索 |
| 通用委托 | 明确指定 `agy` | 共享项目目录，使用 agy 自有工具，在约定位置生成制品 |

普通问答不自动润色。agy 不可用、报错或超时会返回原因，由宿主按原授权继续；不自动重试。通用委托失败后先检查已有变更，用户拒绝或取消的操作不由宿主绕过执行。

## 环境与安装

需要 Node.js ≥22.12 和已安装、登录的 Antigravity CLI。目前只对 **macOS arm64 + agy 1.5.8** 启用真实调用；其他组合降级。宿主验收范围见 [兼容性](docs/compatibility.md)。

从源码构建：

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm package
```

Codex 使用生成的本地 marketplace：

```sh
codex plugin marketplace add /absolute/path/to/release/local-marketplace
codex plugin add agy-connector-plugin@agy-local
```

Cursor CLI 可临时加载，无需全局安装：

```sh
cursor-agent --plugin-dir /absolute/path/to/release/cursor
```

构建不会安装插件或修改全局配置。安装后重开会话；若本机访问 agy 依赖代理，需要在宿主 MCP 环境中显式传入代理配置，详见 [使用说明](docs/usage.md)。

## 使用

- Cursor：`/agy-polish`、`/agy-websearch`、`/agy`；以宿主显示的菜单名称为准。
- Codex：`$agy-polish`、`$agy-websearch`、`$agy`，或用 `/skills` 选择带 `agy-connector-plugin:` 前缀的完整名称。
- 两者均可用自然语言，例如“请用 agy 润色这份通知”“请用 agy-websearch 查找官方说明”“请让 agy 在当前项目生成报告”。

这些入口用于 Agent 输入框，不是 Shell 命令。自动润色依赖宿主选择 Skill，并非强制拦截所有输出。

通用委托会使用 agy 的独立配置、MCP、Skills 和 hooks。需要临时授权时，插件把具体操作转交 Codex/Cursor 会话确认，只接受本次允许；宿主不支持确认、拒绝或超时则停止。当前已验证协议和 Codex 会话转接，GUI 实际授权窗口仍待验收。

## 开发

源码在 `src/`，回归测试在 `tests/`，宿主模板在 `integrations/`，技能在 `skills/`。使用 pnpm 10.33.0 和锁定依赖。

`docs/` 后续作为本地文档目录，新增文件默认由 Git 忽略。已有文档仍受跟踪，供当前换机接续和发行构建使用。停止跟踪整个目录前，须先迁移 Skills 和打包脚本依赖的文档、更新引用，再移除 Git 跟踪并保留本地文件；不能只添加忽略规则或直接删除目录。

```sh
pnpm typecheck
pnpm test
pnpm format:check
pnpm build
pnpm package
pnpm check:package
```

发行包位于 `release/`，运行依赖已打包。真实模型验证需单独执行，可能消耗额度；命令和证据见 [验证记录](docs/verification.md)。接口细节见 [工具契约](docs/tool-contract.md)。采用 [MIT 协议](LICENSE)，第三方依赖声明随包提供。
