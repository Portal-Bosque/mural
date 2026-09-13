# Mural web

Browser port of the Mural iPhone app. Same BYOK model: the page talks directly to OpenAI with your own API key, no Mural server involved.

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
