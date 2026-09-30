# dsh-oauth-adapter

[![npm version](https://img.shields.io/npm/v/@edge-sky/dsh-oauth-adapter)](https://www.npmjs.com/package/@edge-sky/dsh-oauth-adapter)
[![npm downloads](https://img.shields.io/npm/dm/@edge-sky/dsh-oauth-adapter)](https://www.npmjs.com/package/@edge-sky/dsh-oauth-adapter)
[![license](https://img.shields.io/npm/l/@edge-sky/dsh-oauth-adapter)](https://www.npmjs.com/package/@edge-sky/dsh-oauth-adapter)

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

This checkout targets DSH `0.2.0-rc.2`. Once an adapter release with the DSH 0.2 peer range is published, install that release. Earlier DSH releases require an earlier adapter release.

## Install

For DSH `0.2.0-rc.2`, after the compatible adapter release is published:

```sh
dsh plugin --profile web add @edge-sky/dsh-oauth-adapter
```

Or for the official desktop, use `@edge-sky/dsh-oauth-adapter`

For DSH `0.1.2-rc.1` through `0.1.5-rc.1`, use an adapter release from the `0.1.3` series. For DSH `0.1.1-rc.2`, use `@edge-sky/dsh-oauth-adapter@0.1.2-rc.0`.

Start DSH:

```sh
npx @deepseek-ai/dsh web
```

<img width="2940" height="1766" alt="image" src="https://github.com/user-attachments/assets/cbd98703-ee7a-491b-aa2f-02e42b99f6b9" />



<img width="2270" height="1524" alt="image" src="https://github.com/user-attachments/assets/e0cc6591-73a4-4e87-9ef6-68950126b290" />

For models not explicitly listed as supported by the built-in pi-ai, you can add them manually (availability needs to be verified on your own).

<img width="774" height="724" alt="PixPin_2026-09-10_11-08-26" src="https://github.com/user-attachments/assets/e3adc9fc-36e6-414f-ae5b-1748ff5e8f70" />


## How it works

DSH integrates pi-ai through the `@deepseek-ai/dsh-llm-pi-ai` adapter, but does not provide an OAuth entry point. `@edge-sky/dsh-oauth-adapter` exposes pi-ai's existing provider login flows through the DSH Authorization Service. Browser links, device codes, text and secret input, method selection, cancellation, and withdrawn prompts all use the same provider-neutral transport.

The profile patch mounts an authorization fallback when the host does not provide `ctx.authorization`.

DSH owns OAuth credentials and login state. This adapter stores model configuration in `dsh-oauth-adapter.modelStore`; see [model migration and recovery](docs/oauth-models.md).

If this plugins is has helped you, please give a star for me, or create issues if you have any suggestion~

