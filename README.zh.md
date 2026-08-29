# dsh-oauth-adapter

[English](README.md) | 中文

为 DSH Web profile 提供独立的 OAuth 账户页面。当前支持：

| 提供商 | pi-ai 登录路径 |
| --- | --- |
| OpenAI Codex | 浏览器回调或设备码 |
| GitHub Copilot | GitHub 或 GitHub Enterprise 设备码 |
| Anthropic | 浏览器回调，并支持手工粘贴授权码/重定向地址 |
| Kimi For Coding | 设备码 |
| OpenRouter | 浏览器 PKCE 回调 |
| xAI | 设备码 |

只有当当前安装的 `@deepseek-ai/dsh-llm-pi-ai` 确实注册了对应 OAuth 流程时，账户才会显示为可用。这样旧版或采用不同 pi-ai bundle 的 DSH 会安全地禁用登录按钮，而不会暴露无法完成的流程。

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

<img width="2940" height="1766" alt="image" src="https://github.com/user-attachments/assets/7f1dc846-9cea-468c-8a1e-27f4fa34a4fe" />


<img width="2270" height="1524" alt="image" src="https://github.com/user-attachments/assets/8007002a-a036-4cf4-b015-d4e50eff25d9" />


## 工作原理

DSH 通过 `@deepseek-ai/dsh-llm-pi-ai` 适配器接入 pi-ai，但并没有提供 OAuth 的入口。`@edge-sky/dsh-oauth-adapter` 通过 DSH Authorization Service 暴露 pi-ai 已有的 provider 登录流程。浏览器链接、设备码、文本与密码输入、登录方式选择、取消和撤回提示均通过同一套 provider-neutral 传输完成。

由于 DSH 目前并没有挂载`ctx.authorization`服务，因此该插件同时手动对其进行了挂载

插件本身并不承担 OAuth 凭证管理与维持登录态的职责，或许将来 DSH 会官方支持这一登录方式，但至少现在你可以通过这个插件体验它
