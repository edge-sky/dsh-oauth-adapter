# dsh-oauth-adapter

[English](README.md) | 中文

为 DSH `0.1.1-rc.2` 的 Web profile 提供独立的 OAuth 账户页面。当前支持：

- OpenAI Codex
- GitHub Copilot

此版本仅兼容 DSH `0.1.1-rc.2`，不支持 headless、ACP、远程 Web Host 或更高版本的 DSH。

## 安装

将指定版本的适配器安装到官方 rc2 Web profile：

```sh
npx @deepseek-ai/dsh@0.1.1-rc.2 plugin --profile web add \
  @edge-sky/dsh-oauth-adapter@0.1.1-rc.6 \
  --save-exact
```

启动 DSH：

```sh
npx @deepseek-ai/dsh@0.1.1-rc.2 web
```

打开**设置 → OAuth 账户**，即可连接或断开账户。

安装时可能出现 `dsh-authorization` 缺少 peer 的提示。rc2 profile 的这些服务由 profile 包目录之外的官方 DSH runtime 提供；适配器有意将它们保留为 peer，避免 pnpm 安装第二套 Cordis/DSH runtime。

## 工作原理

Bundle 会挂载官方 `@deepseek-ai/dsh-authorization@0.1.1-rc.2` 服务和本适配器。官方 `dsh-llm-pi-ai` 插件检测到该服务后，会注册已有的 `openai-codex` 和 `github-copilot` OAuth flow。本适配器不自行实现或重复注册 provider flow。

适配器增加独立的设置页面，以及用于交互提示的仅限 loopback、要求同源的 WebSocket。凭证继续由官方 DSH credential 服务管理，key 分别为 `llm-pi-ai/openai-codex` 和 `llm-pi-ai/github-copilot`；凭证内容不会返回浏览器。Secret prompt 的回答只在 prompt 活跃期间保留，适配器不会记录或持久化这些内容。

仅在诊断连接生命周期时将插件配置中的 `debug` 设为 `true`。调试日志不会输出凭证、prompt 回答或 provider payload。
