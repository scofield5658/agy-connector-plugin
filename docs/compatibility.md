# 兼容性

版本 0.1.0 的真实 agy 调用仅支持已验证的 **macOS arm64 + Antigravity CLI 1.5.8**。其他平台或 agy 版本返回 `ISOLATION_UNVERIFIED`，由宿主按失败规则处理。Node.js 最低版本为 22.12，验证使用 Node.js 22.23.3。

| 宿主 | 已验证的能力 | 当前限制 |
| --- | --- | --- |
| Codex CLI 0.169.0 | 插件解析、MCP 加载、润色、搜索、失败返回及会话授权转接协议 | 安装后的技能菜单和人工授权操作尚未验证 |
| Cursor CLI 2026.11.11-043ef28 | `--plugin-dir` 加载、润色、搜索、超时降级；非交互模式下拒绝待授权写入 | 交互式授权和取消尚未验证 |
| Codex 桌面、Cursor 编辑器3.30.8 | 提供对应发行包 | 图形界面中的加载、菜单和授权操作尚未验证 |

Codex 解析的完整技能名称为 `agy-connector-plugin:agy`、`agy-connector-plugin:agy-polish`、`agy-connector-plugin:agy-websearch`。短名称和斜杠菜单以宿主实际显示为准。插件解析成功不代表所有图形界面交互都已得到支持。

若终端中的 agy 可用，而宿主中持续超时，请检查 MCP 是否取得了所需代理变量。默认 30 秒润色预算也可能不足，可按 [使用说明](usage.md) 调整；失败不会自动重试。

CLI 升级后需要重新验证隔离适配，不能仅修改版本判断开启调用。权限边界及结果可靠性见 [验证范围与使用限制](verification.md)。
