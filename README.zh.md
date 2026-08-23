# dsh-oauth

[English](README.md) | 中文

DSH LLM 提供方的 OAuth 授权 flow 贡献插件。插件通过 `ctx.authorization` 注册 Codex 与 GitHub Copilot；`dsh-llm-pi-ai` 适配器继续拥有凭据记录、刷新、模型选择与请求协议、消息转换、工具与流式响应。因此 Copilot Auto 的套餐过滤与 model-session 路由位于该适配器，而不在本授权插件中。

```yaml
- id: dsh-oauth
  name: 'dsh-oauth'
  config:
    debug: false
```

本插件要求 `@deepseek-ai/dsh-authorization` 与 `@deepseek-ai/dsh-llm-pi-ai` 的版本不低于 0.1.1-rc.3。这两个包分别向授权条目公开提供方 subject，并提供本插件使用的 pi-ai 提供方自有 OAuth 桥接。

Codex 与 Copilot 运行所安装 pi-ai 提供的完整 OAuth 实现。插件只负责向 DSH 注册这些 flow，并把它们的 prompt、notice、凭据写入和取消操作接入 `ctx.authorization`。Copilot 首先询问可选的 GitHub Enterprise 域名；空答案表示选择 `github.com`。设备授权完成后，pi-ai 会交换并刷新 Copilot 凭据，尝试为账户启用它所知的模型，并记录账户可用的模型。

临时设置 `debug: true` 可把 OAuth 生命周期诊断写入 stderr。插件会记录 flow 启动、notice 与 prompt 类型、prompt 结算、凭据存储、取消状态和分类后的失败，但绝不记录授权 URL、state、verifier、设备码或授权码、prompt 文本或答案、token、提供方响应正文及原始异常消息。收集 trace 后应关闭该开关。

例如，Codex 浏览器回调赢得手工授权码竞速、随后在 token 交换阶段失败时，会产生类似以下序列：

```text
[D] dsh-oauth provider=openai-codex stage=flow-started
[D] dsh-oauth provider=openai-codex stage=notice kind=auth-url
[D] dsh-oauth provider=openai-codex stage=prompt-opened kind=manual-code
[D] dsh-oauth provider=openai-codex stage=prompt-settled kind=manual-code outcome=withdrawn
[D] dsh-oauth provider=openai-codex stage=login-failed kind=generic-error attemptCancelled=false
```

Copilot 使用同一组通用阶段。提供方内部请求与轮询留在 pi-ai 内部：

```text
[D] dsh-oauth provider=github-copilot stage=flow-started
[D] dsh-oauth provider=github-copilot stage=prompt-opened kind=text
[D] dsh-oauth provider=github-copilot stage=prompt-settled kind=text outcome=answered
[D] dsh-oauth provider=github-copilot stage=notice kind=device-code
[D] dsh-oauth provider=github-copilot stage=notice kind=progress
[D] dsh-oauth provider=github-copilot stage=login-completed credential=stored
```

## Model Experience

无直接影响，因为授权只在配置提供方时运行，不向模型请求添加内容。

#### KV Cache effect

不会失效；授权 notice、prompt 与凭据均不进入模型上下文。

## Known Limitations and Deferred Work

- **提供方区域策略在 token 交换时生效** —— 浏览器回调成功并不代表登录完成；提供方在交换授权码时判断 DSH Host 的出口网络。已知的区域不受支持错误会说明应改用受支持网络，其他 OAuth 响应正文仍会被脱敏。
- **Copilot 登录会改变模型策略** —— pi-ai 会在读取账户可用目录前尝试启用它所知的全部 Copilot 模型。
- **提供方 OAuth 行为跟随 pi-ai** —— 支持的 GitHub Enterprise 域名、应用身份、prompt 与账户操作只随所安装的 pi-ai 实现变化。
- **退出登录只影响本地** —— 忘记 grant 会删除 DSH 凭据记录，不会在签发方吊销授权。
- **授权尝试只存在于进程内** —— 刷新发起授权的页面会取消尝试，用户需要重新开始。
