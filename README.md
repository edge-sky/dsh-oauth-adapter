# dsh-oauth-adapter

English | [中文](README.zh.md)

An OAuth account page for the DSH Web profile. It supports:

| Provider | pi-ai sign-in path |
| --- | --- |
| OpenAI Codex | Browser callback or device code |
| GitHub Copilot | GitHub or GitHub Enterprise device code |
| Anthropic | Browser callback with manual code/redirect fallback |
| Kimi For Coding | Device code |
| OpenRouter | Browser PKCE callback |
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

<img width="2940" height="1766" alt="image" src="https://github.com/user-attachments/assets/cbd98703-ee7a-491b-aa2f-02e42b99f6b9" />



<img width="2270" height="1524" alt="image" src="https://github.com/user-attachments/assets/e0cc6591-73a4-4e87-9ef6-68950126b290" />


## How it works

DSH integrates pi-ai through the `@deepseek-ai/dsh-llm-pi-ai` adapter, but does not provide an OAuth entry point. `@edge-sky/dsh-oauth-adapter` exposes pi-ai's existing provider login flows through the DSH Authorization Service. Browser links, device codes, text and secret input, method selection, cancellation, and withdrawn prompts all use the same provider-neutral transport.

Because DSH does not currently mount the `ctx.authorization` service, this plugin also mounts it manually.

The plugin itself does not manage OAuth credentials or maintain login state. Maybe DSH support this sign-in method in the future; but for now, this plugin lets you enjoy it.
