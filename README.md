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

从源码构建（需要 pnpm 10.33.0）：

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

构建不会安装插件或修改全局配置。安装后重开会话。若本机访问 agy 需要代理，复制 `mcp-env.example.json` 为 `mcp-env.local.json`，填写本机地址，再运行 `pnpm package --mcp-env-file mcp-env.local.json`。该配置同时用于 Codex 和 Cursor，只通过 MCP 传入，无需修改 Shell 配置。本地文件已被 Git 忽略，普通 `pnpm package` 不读取它。完整步骤见 [使用说明](docs/usage.md)。

## 使用

- Cursor：`/agy-polish`、`/agy-websearch`、`/agy`；以宿主显示的菜单名称为准。
- Codex：`$agy-polish`、`$agy-websearch`、`$agy`，或用 `/skills` 选择带 `agy-connector-plugin:` 前缀的完整名称。
- 两者均可用自然语言，例如“请用 agy 润色这份通知”“请用 agy-websearch 查找官方说明”“请让 agy 在当前项目生成报告”。

这些入口用于 Agent 输入框，不是 Shell 命令。自动润色依赖宿主选择 Skill，并非强制拦截所有输出。

通用委托会使用 agy 的独立配置、MCP、Skills 和 hooks。需要临时授权时，插件把具体操作转交 Codex/Cursor 会话确认，只接受本次允许；宿主不支持确认、拒绝或超时则停止。图形界面中的技能菜单和授权操作尚未完成验证，具体支持情况见 [兼容性](docs/compatibility.md)。

## 构建与校验

从源码构建需要 pnpm 10.33.0，依赖版本由锁文件固定。可执行以下命令检查并生成发行包：

```sh
pnpm typecheck
pnpm test
pnpm format:check
pnpm build
pnpm package
pnpm check:package
```

发行包位于 `release/`，运行依赖已打包，使用发行包无需 pnpm。支持情况及限制见 [验证范围](docs/verification.md)，高级调用参数见 [工具契约](docs/tool-contract.md)。采用 [MIT 协议](LICENSE)，第三方依赖声明随包提供。
