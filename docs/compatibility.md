# 兼容性

验证日期：2026-11-14。运行环境为 macOS arm64、Node.js 22.23.3、Antigravity CLI 1.5.8。仅该平台和 agy 版本通过当前隔离门槛；其他组合返回 `ISOLATION_UNVERIFIED`，不提供绕过开关。Windows/Linux 的测试配置不代表真实 CLI 已验收。

| 宿主 | 已验证 | 尚待验证 |
| --- | --- | --- |
| Codex CLI 0.169.0 | 原生插件解析三份 Skill；临时 MCP 配置下润色、搜索及失败返回；app-server 会话接收原生操作授权，模拟仅本次批准后生成制品 | 实际安装后的菜单、人工点击授权窗口 |
| Cursor CLI 2026.11.11-043ef28 | `--plugin-dir` 加载发行包；润色、搜索、超时降级；headless 原生授权拒绝且未写文件 | 交互式会话的人工批准与取消 |
| Codex 桌面、Cursor 编辑器3.30.8 | 已准备宿主发行包 | GUI 加载、菜单、授权及取消；自动化界面连接重试仍超时，本次未验收 |

Codex 原生解析的名称为 `agy-connector-plugin:agy`、`agy-connector-plugin:agy-polish`、`agy-connector-plugin:agy-websearch`。短名称和斜杠菜单以宿主实际显示为准，不能把解析成功等同于 GUI 安装验收。

本轮没有安装到全局环境或改动现有全局配置。CLI 测试发现宿主未继承终端代理变量；显式配置代理后，润色和搜索成功。默认 30 秒润色也出现过超时，可按 [使用说明](usage.md) 配置预算，失败仍不重试。

润色和搜索使用请求私有的 `--gemini_dir`；全局及插件来源的 MCP/hook 启动隔离已有正、负对照。原生委托按设计使用 agy 自有配置，不具备同样的工具隔离，也不宣称复制了宿主的 OS 沙箱。细节和待补验范围见 [验证记录](verification.md)。
