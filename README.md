# dsh-oauth-adapter

English | [中文](README.zh.md)

An OAuth account page for the DSH Web profile. It supports:

- [x] OpenAI Codex
- [x] GitHub Copilot

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

## How it works

DSH integrates pi-ai through the `@deepseek-ai/dsh-llm-pi-ai` adapter, but does not provide an OAuth entry point. `@edge-sky/dsh-oauth-adapter` registers pi-ai's existing Codex and Copilot login flows with the DSH Authorization Service.

Because DSH does not currently mount the `ctx.authorization` service, this plugin also mounts it manually.

The plugin itself does not manage OAuth credentials or maintain login state. Maybe DSH support this sign-in method in the future; but for now, this plugin lets you enjoy it.
