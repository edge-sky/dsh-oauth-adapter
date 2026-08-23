# dsh-oauth

English | [中文](README.zh.md)

OAuth authorization-flow contributions for DSH LLM providers. The plugin registers Codex and GitHub Copilot with `ctx.authorization`; the `dsh-llm-pi-ai` adapter continues to own credential records, refresh, model selection and request protocols, message conversion, tools, and streaming. Copilot Auto plan filtering and model-session routing therefore live in that adapter rather than this authorization plugin.

```yaml
- id: dsh-oauth
  name: 'dsh-oauth'
  config:
    debug: false
```

The plugin requires `@deepseek-ai/dsh-authorization` and `@deepseek-ai/dsh-llm-pi-ai` 0.1.1-rc.3 or later. Those packages expose provider subjects on authorization entries and the provider-owned pi-ai OAuth bridge used here.

Codex and Copilot run the complete OAuth implementations installed with pi-ai. The plugin only registers those flows with DSH and connects their prompts, notices, credential writes, and cancellation to `ctx.authorization`. Copilot first asks for an optional GitHub Enterprise domain; an empty answer selects `github.com`. After device authorization, pi-ai exchanges and refreshes the Copilot credential, attempts to enable its known models for the account, and records the models the account can use.

Set `debug: true` temporarily to write OAuth lifecycle diagnostics to stderr. The plugin emits debug records for flow start, notice and prompt kinds, prompt settlement, credential storage, cancellation state, and categorical failure. It never writes an authorization URL, state, verifier, device or authorization code, prompt text or answer, token, provider response body, or raw exception message. Disable the switch after collecting the trace.

For example, a Codex browser callback that wins the manual-code race and then fails during token exchange produces a sequence like this:

```text
[D] dsh-oauth provider=openai-codex stage=flow-started
[D] dsh-oauth provider=openai-codex stage=notice kind=auth-url
[D] dsh-oauth provider=openai-codex stage=prompt-opened kind=manual-code
[D] dsh-oauth provider=openai-codex stage=prompt-settled kind=manual-code outcome=withdrawn
[D] dsh-oauth provider=openai-codex stage=login-failed kind=generic-error attemptCancelled=false
```

Copilot uses the same generic stages. Provider-internal requests and polling remain inside pi-ai:

```text
[D] dsh-oauth provider=github-copilot stage=flow-started
[D] dsh-oauth provider=github-copilot stage=prompt-opened kind=text
[D] dsh-oauth provider=github-copilot stage=prompt-settled kind=text outcome=answered
[D] dsh-oauth provider=github-copilot stage=notice kind=device-code
[D] dsh-oauth provider=github-copilot stage=notice kind=progress
[D] dsh-oauth provider=github-copilot stage=login-completed credential=stored
```

## Model Experience

None, as authorization runs only while configuring a provider and contributes no model request content.

#### KV Cache effect

No invalidation; authorization notices, prompts, and credentials never enter model context.

## Known Limitations and Deferred Work

- **Provider region policy applies during token exchange** — a successful browser callback does not finish login; the provider evaluates the DSH Host's outbound network when it exchanges the authorization code. A known unsupported-region refusal names the supported-network correction, while other OAuth response bodies remain redacted.
- **Copilot login changes model policy** — pi-ai attempts to enable every Copilot model it knows before reading the account's available catalog.
- **Provider OAuth behavior follows pi-ai** — supported GitHub Enterprise domains, application identity, prompts, and account operations change only when the installed pi-ai implementation changes.
- **Sign-out is local** — forgetting a grant removes the DSH credential record without revoking it at the issuer.
- **Authorization attempts are process-local** — reloading the initiating page cancels the attempt and requires starting again.
