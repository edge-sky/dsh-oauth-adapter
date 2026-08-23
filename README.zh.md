# dsh-oauth-adapter

[English](README.md) | 中文

为 DSH Web profile 提供独立的 OAuth 账户页面。当前支持：

- [x] OpenAI Codex
- [x] GitHub Copilot

当前仅对 DSH`0.1.1-rc.2`进行了测试，不保证未来版本的兼容性

## 安装

```sh
dsh plugin --profile web add @edge-sky/dsh-oauth-adapter
```

或

```sh
npx @deepseek-ai/dsh plugin --profile web add @edge-sky/dsh-oauth-adapter
```

启动 DSH：

```sh
npx @deepseek-ai/dsh web
```

## 工作原理

DSH 通过 `@deepseek-ai/dsh-llm-pi-ai` 适配器接入 pi-ai，但并没有提供 OAuth 的入口。`@edge-sky/dsh-oauth-adapter` 将 pi-ai 已有的 Codex 与 Copilot 登录流程注册到 DSH Authorization Service。

由于 DSH 目前并没有挂载`ctx.authorization`服务，因此该插件同时手动对其进行了挂载

插件本身并不承担 OAuth 凭证管理与维持登录态的职责，或许将来 DSH 会官方支持这一登录方式，但至少现在你可以通过这个插件体验它
