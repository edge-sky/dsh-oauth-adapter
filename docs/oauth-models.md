# OAuth model migration and operation

[中文](oauth-models.zh.md)

## Discovery endpoints

| Provider | Account discovery | Pagination and filtering |
| --- | --- | --- |
| Copilot | OAuth-resolved API host + `/models` | Complete list; enabled model-picker entries, excluding disabled policies and explicit non-tool models |
| Codex | `https://chatgpt.com/backend-api/codex/models?client_version=…` | Complete `models` array; `visibility: list`; `ChatGPT-Account-Id` from the stored grant |
| Anthropic | `https://api.anthropic.com/v1/models` | `has_more` / `last_id` / `after_id`; OAuth bearer and Anthropic version/beta headers |
| Kimi Coding | `https://api.kimi.com/coding/v1/models` | Complete `data` array with bearer authorization |
| OpenRouter | `https://openrouter.ai/api/v1/models/user` | `limit` / `offset` / `total_count`; account privacy, provider and guardrail filtering |
| xAI | `https://api.x.ai/v1/models` | Complete `data` array with bearer authorization |

These endpoints are attempted with the current credential; availability remains subject to the provider's OAuth scopes and account policy. HTTP 401/403 means authorization was denied. HTTP 404/405 means this discovery endpoint is unavailable. Neither condition falls back to a public catalog or clears saved results. Other HTTP failures, malformed responses, incomplete pagination, oversized responses and timeouts also preserve the prior result. Discovery makes no inference request and does not enable disabled Copilot model policies.

Endpoint references: [OpenRouter account-filtered models](https://openrouter.ai/docs/api/api-reference/models/list-models-filtered-by-user-provider-preferences-privacy-settings-and-guardrails), [Kimi CLI discovery implementation](https://github.com/MoonshotAI/kimi-cli/blob/main/src/kimi_cli/auth/platforms.py), [Anthropic model API](https://platform.claude.com/docs/en/api/models/list), [xAI REST API](https://docs.x.ai/developers/rest-api-reference/inference), and the installed pi-ai `0.84.4` Copilot/Codex OAuth implementations. Undocumented alias substitutions are not enabled.

## Migration and recovery

1. Validate the proposed model descriptions and persist the legacy profile under `oauth-models.providers.<id>` with phase `pending`. Custom model lists become manual entries so future discovery does not discard them; capacity, reasoning, input and compatibility overrides remain in the legacy profile.
2. Remove only that provider's user-layer `llm-pi-ai.providers.<id>` field using its namespace revision. Wait for the actual LLM route to disappear.
3. Register the plugin's immutable model snapshot using the same provider ID through `ctx.llm.registerAdapter`, then persist phase `managed`.

On failure, release the plugin route and restore the saved source if it remains absent. Never overwrite a concurrent user-layer edit. An interrupted `pending` record is retried at the next plugin start. A failed retry keeps its backup for recovery. A composition/base-layer profile, API-key reference or conflicting adapter prevents takeover and is reported in Models. Resolve that conflict in the owning configuration before retrying. Custom profiles display the fields and model count for review before migration.

The namespace contains version `1`, provider phase, legacy profile, manual entries, optional successful discovery/time and a hash of an available stable account ID. It never contains credentials. Do not downgrade the plugin while leaving migrated providers exclusively in this namespace. To return to an older plugin, stop DSH, back up settings, restore each desired `legacy` profile to the user `llm-pi-ai.providers` map, remove the corresponding `oauth-models` entries, then start the older plugin. Do not restore over an existing provider profile.

A successful discovery with no models is authoritative. It can leave a provider with an empty selector; manually configured models remain available. A dependency update rematerializes the saved remote IDs at startup and does not require token refresh or another discovery request.

## Concurrency and transport

Model operations use a per-provider queue. Repeated synchronization shares one discovery task. Sign-out invalidates that task before deleting the credential and releasing its route. Plugin disposal cancels discovery, stops accepting work and waits for owned tasks. Published snapshots remain immutable, and a prepared or running request retains its captured model description.

WebSocket commands `models-list`, `models-sync`, `models-migrate`, `models-save` and `models-delete` use the existing authenticated loopback transport. Every write carries the `oauth-models` namespace revision. Conflicts refresh the browser's list and preserve the editor for deliberate retry. `models-page` returns at most ten rows, aggregate matched/pending/manual counts, connection/source status and the last successful timestamp. Account status frames do not carry model directories or tokens.

## Validation scope

The rc integration tests mount real settings, credentials, pi-ai and LLM services in isolated temporary homes. Browser tests load the published rc bundles with the public module-loader format. Remote responses and OAuth grants are synthetic. No live account discovery or model inference is claimed for Copilot, Codex, Anthropic, Kimi Coding, OpenRouter or xAI. Run live validation separately with the intended account and record provider, model ID, protocol and result without recording credentials.
