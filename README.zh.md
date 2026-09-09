# dsh-oauth-adapter

[English](README.md) | 中文

为 DSH Web profile 提供 OAuth 登录和账号模型管理。验证基线为 DSH `0.1.2-rc.1`，插件精确依赖 pi-ai `0.84.4`。同步模型不会安装或升级依赖。

## 安装

```sh
dsh plugin --profile web add @edge-sky/dsh-oauth-adapter
dsh web
```

在 **设置 → OAuth 账户** 连接或重新连接账号。授权成功后自动同步模型。授权和同步分别报告结果：发现失败不会撤销成功的登录。

在 **设置 → 模型** 的 **OAuth 模型** 区域同步已连接账号、补充待配置模型，以及添加、编辑或删除手动模型。该区域使用公开的 `settings.models.footer` 插槽，不增加独立模型设置页面。

| 供应商 | 模型协议 |
| --- | --- |
| GitHub Copilot | 每个模型选择 Chat Completions、Responses 或 Anthropic Messages |
| OpenRouter | 每个模型选择 Chat Completions 或 Anthropic Messages |
| OpenAI Codex | Codex Responses |
| xAI | OpenAI Responses |
| Anthropic、Kimi Coding | Anthropic Messages |

模型 ID 必填，显示名称留空时使用 ID。固定协议供应商不显示协议选择器，后端也拒绝协议覆盖。未知模型采用供应商配置的默认容量、文本输入，不根据名称推断思考能力。保存后可尝试发送请求，但不代表已验证模型存在、账号可调用或全部模型能力。

## 同步行为

发现使用各供应商的认证端点，包括 Copilot 经 OAuth 解析的 API 主机、Codex 账号请求头、Anthropic 游标分页及 OpenRouter 账号过滤列表的偏移分页。不会使用 OpenRouter 公开总目录代替账号列表。端点不支持或 OAuth 权限不足时明确报错，仍可手动配置。端点和依据见[迁移与运行说明](docs/oauth-models.zh.md)。

只有同一供应商内精确匹配的 ID 才继承 pi-ai 的完整模型描述。不通过显示名称或未经证实的别名推断调用协议。未知 ID 保持为**待配置**。成功同步使用完整远端结果替换自动项，包括真正的空列表；手动项始终保留，同 ID 合并，用户明确填写的字段优先。失败保留最近成功结果。首次成功发现前，保留原配置或内置列表并标明未经验证。重新连接至不同或无法识别的账号时，先清除旧账号的自动结果，再进行发现。

插件使用 `oauth-models` 保存版本、迁移备份、远端 ID 缓存和手动项。凭据始终通过 DSH credentials 服务保存在 `llm-pi-ai/<provider>`。公开 pi-ai 认证能力负责 token 刷新，token 不进入模型设置或浏览器消息。后续升级插件依赖时，已保存的远端 ID 会与新加载的目录重新匹配。

既有供应商 ID 和会话引用保持不变。旧插件生成的简单配置自动迁移；自定义配置需要在模型页预览确认。API-key 引用、组合基础层配置和其他适配器占用的路由不会被覆盖。升级自定义安装前请阅读[迁移与恢复](docs/oauth-models.zh.md#迁移与恢复)。

## 配置

Host 插件接受以下可选配置：

| 字段 | 默认值 | 含义 |
| --- | --- | --- |
| `debug` | `false` | 连接生命周期诊断 |
| `modelSyncTimeoutMs` | `30000` | 模型发现及旧路由释放的超时 |
| `modelSyncMaxResponseBytes` | `4194304` | 每页远端响应的最大字节数 |
| `modelSyncMaxPages` | `100` | 一次同步的最大页数 |
| `codexClientVersion` | `0.149.0` | Codex 发现端点所接收的客户端版本 |

## 开发与验证

```sh
pnpm install
pnpm run typecheck
pnpm test
```

测试覆盖供应商响应、匹配、失败保留、revision 冲突、迁移恢复、取消、经过网络拦截的真实 rc 适配器请求，以及 DOM 环境中加载已发布 rc 模型页产物的可重放快照。WebSocket 测试需要绑定回环端口。测试凭据全部为合成数据，这些验证不代表任何供应商的真实账号发现或推理调用已经通过。无需修改 DSH 源码。
