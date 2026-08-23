# dsh-oauth-adapter

[English](README.md) | 中文

为 DSH（DeepSeek Harness）提供模型 OAuth 登录入口的 Cordis 插件。当前支持：

- [x] OpenAI Codex

- [x] GitHub Copilot

## 开始使用

将 npm 包安装到 DSH 的 `web` profile：

```sh
dsh plugin --profile web add @edge-sky/dsh-oauth-adapter
```

或

```sh
npx @deepseek-ai/dsh plugin --profile web add @edge-sky/dsh-oauth-adapter
```

安装后，DSH 会自动将 Bundle 加入该 profile。启动 DSH：

```sh
dsh web --no-open
```

插件使用当前 DSH 安装提供的运行时依赖；启动时若缺少 OAuth bridge 或 Codex/Copilot Provider，会直接报告版本不兼容。

启动后，在**设置 → 模型**中连接 Codex 或 GitHub Copilot。

## 工作原理

DSH 通过 `@deepseek-ai/dsh-llm-pi-ai` 适配器接入 pi-ai，但并没有提供 OAuth 的入口。`@edge-sky/dsh-oauth-adapter` 将 pi-ai 已有的 Codex 与 Copilot 登录流程注册到 DSH Authorization Service。

插件本身并不承担 OAuth 凭证管理与维持登录态的职责，或许将来 DSH 会官方支持这一登录方式，但至少现在你可以通过这个插件体验它
