# dsh-oauth-adapter

English | [中文](README.zh.md)

An OAuth account page for the Web profile of DSH `0.1.1-rc.2`. It supports:

- OpenAI Codex
- GitHub Copilot

This release is intentionally limited to DSH `0.1.1-rc.2`. It does not support headless or ACP profiles, remote Web Hosts, or later DSH releases.

## Install

Install the exact adapter version into the official rc2 Web profile:

```sh
npx @deepseek-ai/dsh@0.1.1-rc.2 plugin --profile web add \
  @edge-sky/dsh-oauth-adapter@0.1.1-rc.6 \
  --save-exact
```

Start DSH:

```sh
npx @deepseek-ai/dsh@0.1.1-rc.2 web
```

Open **Settings → OAuth Accounts** to connect or disconnect an account.

After sign-in, the adapter activates the matching official `llm-pi-ai` route. The model selector lists it as **OpenAI Codex (OAuth)** or **GitHub Copilot (OAuth)**, in a provider group separate from API-key and custom gateway routes. Reopen the model selector to refresh its catalog after connecting an account.

The installer may report missing peers for `dsh-authorization`. In the rc2 profile layout, those services are supplied by the official DSH runtime outside the profile's package tree; the adapter intentionally leaves them as peers so pnpm does not install a second Cordis/DSH runtime.

## How it works

The bundle mounts the official `@deepseek-ai/dsh-authorization@0.1.1-rc.2` service and this adapter. The official `dsh-llm-pi-ai` plugin detects that service and registers its existing `openai-codex` and `github-copilot` OAuth flows. This adapter does not implement or register provider flows itself.

The adapter adds a separate Settings page and a loopback-only, same-origin WebSocket used for interactive notices and prompts. Credentials remain owned by the official DSH credential service under `llm-pi-ai/openai-codex` and `llm-pi-ai/github-copilot`; credential values are never returned to the browser. Secret prompt answers are held only while the prompt is active and are not logged or persisted by the adapter.

An authorized account needs both a stored credential and an enabled model route. The adapter writes only the matching OAuth provider entry under `llm-pi-ai.providers` and preserves unrelated provider configuration. Signing out removes a route created solely by the adapter; a route with additional user configuration is retained.

Set `debug: true` in the plugin configuration only when diagnosing connection lifecycle. Debug output excludes credentials, prompt answers, and provider payloads.
