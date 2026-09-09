# OAuth 模型迁移与运行说明

[English](oauth-models.md)

## 发现端点

| 供应商 | 账号发现 | 分页和过滤 |
| --- | --- | --- |
| Copilot | OAuth 解析的 API 主机 + `/models` | 完整列表；启用的模型选择器条目，排除禁用策略及明确不支持工具的模型 |
| Codex | `https://chatgpt.com/backend-api/codex/models?client_version=…` | 完整 `models` 数组；仅 `visibility: list`；从凭据取得 `ChatGPT-Account-Id` |
| Anthropic | `https://api.anthropic.com/v1/models` | `has_more` / `last_id` / `after_id`；OAuth bearer 和 Anthropic 版本、beta 请求头 |
| Kimi Coding | `https://api.kimi.com/coding/v1/models` | 完整 `data` 数组；bearer 认证 |
| OpenRouter | `https://openrouter.ai/api/v1/models/user` | `limit` / `offset` / `total_count`；账号隐私、供应商偏好和 guardrail 过滤 |
| xAI | `https://api.x.ai/v1/models` | 完整 `data` 数组；bearer 认证 |

使用当前凭据尝试上述端点，实际可用性取决于供应商 OAuth scope 和账号策略。HTTP 401/403 表示授权被拒绝；404/405 表示发现端点不可用。两者均不回退至公开总目录，也不清空已保存结果。其他 HTTP 错误、格式异常、不完整分页、响应超限或超时同样保留原结果。发现不会发起模型推理请求，也不会启用已禁用的 Copilot 模型策略。

端点依据：[OpenRouter 账号过滤列表](https://openrouter.ai/docs/api/api-reference/models/list-models-filtered-by-user-provider-preferences-privacy-settings-and-guardrails)、[Kimi CLI 发现实现](https://github.com/MoonshotAI/kimi-cli/blob/main/src/kimi_cli/auth/platforms.py)、[Anthropic 模型 API](https://platform.claude.com/docs/en/api/models/list)、[xAI REST API](https://docs.x.ai/developers/rest-api-reference/inference)，以及安装的 pi-ai `0.84.4` Copilot/Codex OAuth 实现。未启用未经证实的别名替换。

## 迁移与恢复

1. 验证新模型描述，并在 `oauth-models.providers.<id>` 保存旧配置，阶段为 `pending`。旧配置中的显式模型列表转换为手动项，避免后续发现将其删除；容量、思考、输入和兼容参数仍保存在旧配置中。
2. 使用 namespace revision 仅移除用户层 `llm-pi-ai.providers.<id>` 字段，等待实际 LLM 路由注销。
3. 通过 `ctx.llm.registerAdapter` 使用相同供应商 ID 注册插件的不可变模型快照，再保存 `managed` 阶段。

失败时释放插件路由，且仅当原字段仍不存在时恢复备份，绝不覆盖其他操作的新配置。进程中断留下的 `pending` 记录将在插件下次启动时重试；重试失败仍保留备份供恢复。组合基础层、API-key 引用或其他适配器冲突会阻止接管，并在模型页显示原因。请先在原配置中解决冲突，再重试。自定义配置在迁移前展示字段和模型数量供确认。

该 namespace 保存版本 `1`、供应商阶段、旧配置、手动项、可选的成功发现结果与时间，以及可用稳定账号标识的哈希，不保存凭据。迁移后的供应商如果仅存在于此 namespace，不应直接降级插件。要恢复旧版本，请先停止 DSH 并备份设置，将需要恢复的 `legacy` 配置放回用户层 `llm-pi-ai.providers`，删除对应 `oauth-models` 条目，然后启动旧版插件。不要覆盖已有供应商配置。

成功返回空列表具有权威性，可能使供应商的选择器没有自动模型；手动模型仍可用。依赖更新后在启动时重新解析已保存的远端 ID，无需刷新 token 或再次发现。

## 并发与传输

同一供应商的模型操作串行执行，重复同步共享同一发现任务。退出登录先使该任务失效，再删除凭据和撤销路由。插件卸载取消发现、停止接收新工作，并等待所属任务结束。已发布快照不可变，已经准备或执行中的请求保留捕获的模型描述。

WebSocket 命令 `models-list`、`models-sync`、`models-migrate`、`models-save`、`models-delete` 复用原有已认证的回环连接。每次写操作携带 `oauth-models` namespace revision。冲突后浏览器刷新列表并保留编辑内容，由用户确认后重试。`models-page` 每次最多返回十项，附带已匹配、待配置、手动项总数，连接和来源状态及最近成功时间。账号状态帧不携带模型目录或 token。

## 验证范围

rc 集成测试在隔离临时目录中挂载真实 settings、credentials、pi-ai 和 LLM 服务。浏览器测试按公开 module-loader 格式加载已发布 rc 产物。远端响应和 OAuth 凭据为合成数据；不宣称 Copilot、Codex、Anthropic、Kimi Coding、OpenRouter 或 xAI 的真实账号发现或推理调用已通过。真实调用应使用目标账号单独验证，记录供应商、模型 ID、协议和结果，不记录凭据。
