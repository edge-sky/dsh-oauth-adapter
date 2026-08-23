# dsh-oauth-adapter

English | [中文](README.zh.md)

A Cordis plugin that adds model-provider OAuth login entry points to DSH (DeepSeek Harness). It currently supports:

- [x] OpenAI Codex

- [x] GitHub Copilot

## Getting Started

Install the npm package into DSH's `web` profile:

```sh
dsh plugin --profile web add @edge-sky/dsh-oauth-adapter
```

or

```sh
npx @deepseek-ai/dsh plugin --profile web add @edge-sky/dsh-oauth-adapter
```

After installation, DSH automatically adds the bundle to the profile. Start DSH:

```sh
dsh web --no-open
```

The plugin uses the runtime dependencies provided by the current DSH installation. At startup, it reports an incompatible version directly if the OAuth bridge or the Codex/Copilot providers are missing.

Once DSH starts, connect Codex or GitHub Copilot under **Settings → Models**.

## How It Works

DSH integrates pi-ai through the `@deepseek-ai/dsh-llm-pi-ai` adapter, but does not provide an OAuth entry point. `@edge-sky/dsh-oauth-adapter` registers pi-ai's existing Codex and Copilot login flows with the DSH Authorization Service.

The plugin itself does not manage OAuth credentials or maintain login state. Maybe DSH will support these login methods in the future, but for now this plugin provides a way to use them.
