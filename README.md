# dsh-oauth-adapter

English | [中文](README.zh.md)

An OAuth account page for the DSH Web profile. With the pi-ai catalog bundled by DSH `0.1.1-rc.2`, it supports:

| Provider | pi-ai sign-in path |
| --- | --- |
| OpenAI Codex | Browser callback or device code |
| GitHub Copilot | GitHub or GitHub Enterprise device code |
| Anthropic | Browser callback with manual code/redirect fallback |
| Kimi For Coding | Device code |
| OpenRouter | Browser PKCE callback |
| Radius | Browser PKCE callback or device code |
| xAI | Device code |

Each account is shown only as available when the installed `@deepseek-ai/dsh-llm-pi-ai` actually registers its OAuth flow. This keeps older or differently bundled pi-ai versions fail-closed instead of exposing a login button that cannot work.

The adapter has only been tested with DSH `0.1.1-rc.2`; compatibility with future versions is not guaranteed.

## Install

```sh
dsh plugin --profile web add @edge-sky/dsh-oauth-adapter
```

or

```sh
npx @deepseek-ai/dsh plugin --profile web add @edge-sky/dsh-oauth-adapter
```

Start DSH:

```sh
npx @deepseek-ai/dsh web
```

<img width="2270" height="1524" alt="image" src="https://github.com/user-attachments/assets/78a59190-8029-4c60-bc50-b763312540f7" />

<img width="2270" height="1524" alt="image" src="https://github.com/user-attachments/assets/e0cc6591-73a4-4e87-9ef6-68950126b290" />


## How it works

DSH integrates pi-ai through the `@deepseek-ai/dsh-llm-pi-ai` adapter, but does not provide an OAuth entry point. `@edge-sky/dsh-oauth-adapter` exposes pi-ai's existing provider login flows through the DSH Authorization Service. Browser links, device codes, text and secret input, method selection, cancellation, and withdrawn prompts all use the same provider-neutral transport.

Because DSH does not currently mount the `ctx.authorization` service, this plugin also mounts it manually.

The plugin itself does not implement provider OAuth protocols, manage OAuth credentials, or maintain login state. pi-ai owns login and token refresh; the DSH Credentials Service owns persistence; this adapter owns only the local Web UI bridge and model-route activation.
