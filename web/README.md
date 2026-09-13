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

## Tests

`npm test` runs the ported core suites (`Tests/LearningTests.swift`, `MeaningTests.swift`, `FinalAssessmentTests.swift`) on vitest.

## Not yet ported

- Typed messages, current-topic search, onboarding and AI-consent screens, transcript correction UI.
- Language detection for the redirect nudge (no NLLanguageRecognizer in browsers).

## Security note

The API key is kept in `localStorage` for this origin only and is sent only to `api.openai.com`. The page ships a strict CSP and loads no third-party scripts. Do not deploy it with any script you have not reviewed: a script injection would expose the key.
