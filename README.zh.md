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

dsh-oauth-adapter`>= v0.1.3-rc.0` 已适配 DSH`v0.1.2-rc.1`，早期版本请使用 dsh-oauth-adapter`v0.1.2-rc.0`

## 安装

对于 DSH`~v0.1.2-rc.1`

```sh
dsh plugin --profile web add @edge-sky/dsh-oauth-adapter
```

或

```sh
npx @deepseek-ai/dsh plugin --profile web add @edge-sky/dsh-oauth-adapter
```

----

对于 DSH`0.1.1-rc.2`

```sh
dsh plugin --profile web add @edge-sky/dsh-oauth-adapter@v0.1.2-rc.0
```

或

```sh
npx @deepseek-ai/dsh plugin --profile web add @edge-sky/dsh-oauth-adapter@v0.1.2-rc.0
```


启动 DSH：

```sh
npx @deepseek-ai/dsh web
```

<img width="2940" height="1766" alt="image" src="https://github.com/user-attachments/assets/7f1dc846-9cea-468c-8a1e-27f4fa34a4fe" />


<img width="2270" height="1524" alt="image" src="https://github.com/user-attachments/assets/8007002a-a036-4cf4-b015-d4e50eff25d9" />


对于内置 pi-ai 未写明支持的模型，支持手动添加（可用性需自行验证）

<img width="778" height="723" alt="PixPin_2026-09-10_11-02-42" src="https://github.com/user-attachments/assets/e6b10f86-591d-4801-a758-c8b56c83a18d" />



## 工作原理

DSH 通过 `@deepseek-ai/dsh-llm-pi-ai` 适配器接入 pi-ai，但并没有提供 OAuth 的入口。`@edge-sky/dsh-oauth-adapter` 通过 DSH Authorization Service 暴露 pi-ai 已有的 provider 登录流程。浏览器链接、设备码、文本与密码输入、登录方式选择、取消和撤回提示均通过同一套 provider-neutral 传输完成。

由于 DSH 目前并没有挂载`ctx.authorization`服务，因此该插件同时手动对其进行了挂载

插件本身并不承担 OAuth 凭证管理与维持登录态的职责，或许将来 DSH 会官方支持这一登录方式，但至少现在你可以通过这个插件体验它

如果这个插件帮到了你，还请留下你的小星星，如果有任何建议，欢迎 issues~
