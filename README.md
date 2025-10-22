# ChatKit Starter Template

[![MIT License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
![NextJS](https://img.shields.io/badge/Built_with-NextJS-blue)
![OpenAI API](https://img.shields.io/badge/Powered_by-OpenAI_API-orange)

This repository is the simplest way to bootstrap a [ChatKit](http://openai.github.io/chatkit-js/) application. It ships with a minimal Next.js UI, the ChatKit web component, and a ready-to-use session endpoint so you can experiment with OpenAI-hosted workflows built using [Agent Builder](https://platform.openai.com/agent-builder).

## What You Get

- Next.js app with `<openai-chatkit>` web component and theming controls
- API endpoint for creating a session at [`app/api/create-session/route.ts`](app/api/create-session/route.ts)
- Config file for starter prompts, theme, placeholder text, and greeting message

## Getting Started

### 1. Install dependencies

```bash
pnpm install
```

### 2. Create your environment file

Copy the example file and fill in the required values:

```bash
cp .env.example .env.local
```

You can get your workflow id from the [Agent Builder](https://platform.openai.com/agent-builder) interface, after clicking "Publish":

<img src="./public/docs/workflow.jpg" width=500 />

You can get your OpenAI API key from the [OpenAI API Keys](https://platform.openai.com/api-keys) page.

### 3. Configure ChatKit credentials

Update `.env.local` with the variables that match your setup.

- `OPENAI_API_KEY` — This must be an API key created **within the same org & project as your Agent Builder**. If you already have a different `OPENAI_API_KEY` env variable set in your terminal session, that one will take precedence over the key in `.env.local` one (this is how a Next.js app works). So, **please run `unset OPENAI_API_KEY` (`set OPENAI_API_KEY=` for Windows OS) beforehand**.
- `NEXT_PUBLIC_CHATKIT_WORKFLOW_ID` — This is the ID of the workflow you created in [Agent Builder](https://platform.openai.com/agent-builder), which starts with `wf_...`
- (optional) `CHATKIT_API_BASE` - This is a customizable base URL for the ChatKit API endpoint

#### Optional: connection tuning and retries

If you see occasional "Connect Timeout Error" or transient network errors when restarting the chat, you can tune the built-in fetch timeouts and retry policy via environment variables. Defaults are conservative and work for most networks, but stricter firewalls or Cloudflare edge routing can occasionally be slow to complete TLS handshakes right after a reset.

You can add any of the following to your `.env.local` to increase resilience:

- `CHATKIT_CONNECT_TIMEOUT_MS` (default 15000)
- `CHATKIT_HEADERS_TIMEOUT_MS` (default 45000)
- `CHATKIT_BODY_TIMEOUT_MS` (default 120000)
- `CHATKIT_RETRY_ATTEMPTS` (default 5)
- `CHATKIT_RETRY_BASE_DELAY_MS` (default 800)

Example values for slower networks:

```
CHATKIT_CONNECT_TIMEOUT_MS=20000
CHATKIT_HEADERS_TIMEOUT_MS=60000
CHATKIT_BODY_TIMEOUT_MS=180000
CHATKIT_RETRY_ATTEMPTS=6
CHATKIT_RETRY_BASE_DELAY_MS=1000
```

> Note: if your workflow is using a model requiring organization verification, such as GPT-5, make sure you verify your organization first. Visit your [organization settings](https://platform.openai.com/settings/organization/general) and click on "Verify Organization".

### 4. Run the app

```bash
pnpm dev
```

The unified server starts both the Next.js app and the Scramjet proxy assets on `http://localhost:3000`. The Scramjet demo now loads inside the main page (and registers its service worker) while the ChatKit assistant stays available as a floating panel. Use the prompts on the start screen to verify your workflow connection, then customize the UI or prompt list in [`lib/config.ts`](lib/config.ts) and [`components/ChatKitPanel.tsx`](components/ChatKitPanel.tsx).

### 5. Deploy your app

```bash
pnpm build
```

Then serve the production build with the combined server:

```bash
pnpm start
```

Before deploying your app, you need to verify the domain by adding it to the [Domain allowlist](https://platform.openai.com/settings/organization/security/domain-allowlist) on your dashboard.

## Customization Tips

- Adjust starter prompts, greeting text, [chatkit theme](https://chatkit.studio/playground), and placeholder copy in [`lib/config.ts`](lib/config.ts).
- Update the event handlers inside [`components/.tsx`](components/ChatKitPanel.tsx) to integrate with your product analytics or storage.

## References

- [ChatKit JavaScript Library](http://openai.github.io/chatkit-js/)
- [Advanced Self-Hosting Examples](https://github.com/openai/openai-chatkit-advanced-samples)
