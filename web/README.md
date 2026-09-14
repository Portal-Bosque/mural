# Eco

Eco is Portal Bosque's browser port of the [Eco](https://github.com/Chuloo/mural) iPhone app, a language app you learn through conversation. Same BYOK model: the page talks directly to OpenAI with your own API key, no server involved. The Mural name and logo belong to the original project; this fork is called Eco.

## Run

```sh
cd web
npm install
npm run dev
```

Open http://localhost:5173, expand **Settings**, paste your OpenAI key, pick a language and a theme, and press **Start conversation**. The microphone needs a secure context (localhost or https).

## What works

- `gpt-live-1` voice session over native browser WebRTC (`RTCPeerConnection` + `oai-events` data channel), same protocol as `App/LiveTransport.swift`.
- Full `Core/` port in `src/core/`: models and archive (`models.ts`), learning engine (`engine.ts`), meaning controller (`meaning.ts`), final-assessment queue (`assessment-queue.ts`), teaching prompts (`policy.ts`), four language modules and 24 themes (`languages.ts`).
- Learning loop: every user passage is assessed by `gpt-5.6-luna` with a strict JSON schema, validated against the transcript, projected into a challenge level and recall bars, and fed back to the voice model as teaching context. An ended conversation gets a final assessment.
- Meaning subtitles for the latest assistant passage, cached per transcript revision; tap a word in the caption for a contextual explanation.
- Client delegation: lookups via `gpt-5.6-luna` with web search, returned as `session.commentary.append`.
- Persistence in IndexedDB (one JSON document, like SwiftData in the app), Words and Conversations panels, export/import. The backup format is the iOS app's (schema 2, dates as seconds since 2001), so backups move between iPhone and web.
- Mute, "simpler please", end, time limit and inactivity cut-off.
- Voice and text via the Codex subscription (`gpt-live-1-codex`, `gpt-5.6-luna`) through the local bridge in `bridge/`, no API key needed.

## Voice through the Codex subscription

Instead of an API key, voice can run on `gpt-live-1-codex` with a ChatGPT/Codex subscription. OpenAI's platform API refuses voice sessions for subscription tokens (`403 Voice session access denied`), so the browser goes through a small local bridge that drives `codex app-server` (JSON-RPC over stdio, `thread/realtime/*`, feature `realtime_conversation`):

```sh
codex login          # once, ChatGPT account
npm run bridge       # http://127.0.0.1:8790
```

Then in Settings pick **Voice provider → Codex subscription via local bridge**. The bridge only brokers signalling and events: it starts an ephemeral thread, passes the browser's SDP offer to `thread/realtime/start`, returns the answer, and relays `thread/realtime/*` notifications (transcripts, errors, close) as server-sent events. Audio still flows WebRTC between the browser and OpenAI. Teaching instructions go in as the thread's developer instructions and initial items; mid-conversation nudges use `thread/realtime/appendText`. v3 voices are `cove` (default), juniper, maple, spruce, ember, vale, breeze, arbor and sol.

Text requests (assessments, subtitles, lookups, delegated searches) also ride the subscription: the bridge's `/codex/responses` forwards them to the Codex backend with a token obtained from the app-server, which handles refresh. That backend requires streaming and rejects `max_output_tokens` and `max_tool_calls`, so the bridge streams, strips those, and rebuilds a plain Responses result from `response.output_item.done` events. `gpt-5.6-luna`, strict JSON schema and `web_search` with citations all work there. With the Codex provider selected no API key is needed at all. The bridge accepts requests from `http://localhost:5173` and the production origin (`MURAL_ORIGINS` to change), binds to loopback, and never exposes the Codex tokens.

### Self-hosting behind Cloudflare Access

The bridge can serve the page itself, so page and API share one origin behind one Cloudflare Access application (no CORS, no local-network prompts, the Access cookie rides along on every fetch and event stream):

```sh
npm run build:access        # page defaulting to the Codex provider and a same-origin bridge → dist-access/
MURAL_STATIC=$PWD/dist-access CF_ACCESS_TEAM_DOMAIN=<team>.cloudflareaccess.com npm run bridge
cloudflared tunnel create mural && cloudflared tunnel route dns mural mural.example.com   # ingress → http://127.0.0.1:8790
```

For a public deployment leave `CF_ACCESS_TEAM_DOMAIN` unset: the bridge then relies on its built-in limits (per IP: 3 conversations at a time, 30 per hour, 240 text requests per 10 minutes; globally 8 concurrent conversations; 20-minute hard cap per conversation; override with `MURAL_LIMITS` JSON). Everyone who reaches the page spends the subscription, so watch usage. With `CF_ACCESS_TEAM_DOMAIN` set, every request that arrives through Cloudflare (`cf-ray` present) must carry a valid Access JWT (RS256, verified against the team's JWKS, `iss` checked, `CF_ACCESS_AUD` optional), so the hostname is closed until the Access application exists and denies anything that bypasses it. Local requests without Cloudflare headers are unaffected. Then create a self-hosted Access application for the hostname with an Allow policy (email one-time PIN is enough). `bridge/launchd.plist.example` shows the LaunchAgent that keeps the bridge running.

Alternatively `tailscale serve --bg --https=8791 http://127.0.0.1:8790` publishes the bridge to a tailnet; the page's CSP allows `https://*.ts.net`, and `VITE_BRIDGE_URL` can default a build to it. Chrome treats Tailscale's 100.64/10 range as a local network and asks once for Local Network Access from the deployed page.

## Kids profile

Eco Kids is the default at `/` (`index.html`, `src/kids-main.ts`); the full app lives at `/app` (`app.html`, `src/main.ts`), and `/kids` redirects to `/`. It is a separate profile for children aged 6 to 10: English only with meanings in Spanish, its own learning data (`mural-kids-v1`), 14 playful topics (`src/core/kids-themes.ts`), one big Talk/Stop button, XP that grows while they talk (1 XP per 5 seconds, 5 per thing said, 10 per new validated word, 100 XP per level, kept in `localStorage`), and a summary with time talked, XP, and the new words with child-friendly meanings from `gpt-5.6-luna`. The voice prompt is `TeachingPolicy.kidsVoice`: short sentences, choices, play, gentle recasts, no private questions. Grown-up settings (provider, key, meaning language, reset XP) sit behind the gear.

## Design

The layout follows the iPhone app (Talk / Themes / Words tabs, orb, meaning subtitle, theme cards, recall bars) using the Portal Bosque design system: paper `#F0F0EA`, forest green `#34504E`, accent `#DF441B`, earth `#643C37`, the `topic_*` tints for theme cards, Inter for UI text, PP Editorial New for display titles and Montiac for the wordmark and labels. Tokens live at the top of `src/style.css` and mirror `portal-agenda/tailwind.config.js`. Icons are Lucide, mapped from the app's SF Symbols in `src/main.ts`.

The brand fonts are licensed, so `public/fonts/` is git-ignored: copy `Montiac-*.ttf` and `PPEditorialNew-*.otf` from portal-agenda before building, and deploys from this folder ship them. Without the files the page falls back to Inter and a system serif.

## Tests

`npm test` runs the ported core suites (`Tests/LearningTests.swift`, `MeaningTests.swift`, `FinalAssessmentTests.swift`) on vitest.

## Not yet ported

- Typed messages, current-topic search, onboarding and AI-consent screens, transcript correction UI.
- Language detection for the redirect nudge (no NLLanguageRecognizer in browsers).

## Security note

The API key is kept in `localStorage` for this origin only and is sent only to `api.openai.com`. The page ships a strict CSP and loads no third-party scripts. Do not deploy it with any script you have not reviewed: a script injection would expose the key.
