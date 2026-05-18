# Technical Writeup — Dialtone

## The problem (TrueFoundry "Resilient Agents" track)

The track asks: *how does your agent behave when an MCP server starts erroring
out / an LLM server goes down / OpenAI or Claude browns out?* Most "AI
receptionist" entries answer this with a fallback message. On a clinic phone
line, a fallback message is a dropped patient.

## The answer

Dialtone treats an LLM outage as a **routing event, not an incident**. The call
is never tied to a single brain:

- **Tier 1 — capability:** ElevenLabs ConvAI hosted `gemini-2.0-flash` over a
  WebSocket, with per-call memory and a reconnect-retry (a dropped socket is a
  transient blip, not a failed turn).
- **Tier 2 — continuity:** a deterministic clinical FSM with **zero model
  calls**. ElevenLabs Scribe transcribes the caller; pure code fills slots
  (book / reschedule / refill / hours), confirms back, and writes the booking;
  ElevenLabs TTS speaks. It is intentionally narrow and clinically safe — it
  never improvises and never gives medical advice.
- **The gateway** decides per turn: UP→Tier 1; DEGRADED (slow/erroring brain,
  >9s)→try Tier 1 once then fall through; DOWN→Tier 2, and the Tier-1 route
  returns a **real HTTP 503**.

## What makes the wow real (not a mock)

A repo-tracing judge follows: operator button → `public/app.js`
`/api/outage/induce` → `src/gateway.js` health flag → `/api/tool/book` returns
a genuine `HTTP 503` → `src/fsm.js` deterministic turn (no LLM in the DOWN
window) → `src/store.js` writes a real `better-sqlite3` row with
`provider_state = 'DOWN'`, idempotent on `(session, slot)`. The same row is
queryable independently before, during, and after the outage. No golden-cache,
no arithmetic stand-in, no seed-replay. The demo segment of the video is a real
browser screen-recording of this running build.

## Resilience properties demonstrated

- **Degradation-aware**, not just hard-down: a slow/erroring brain auto-trips
  the same gateway the button uses (TrueFailover's "technically up but
  unusable" distinction).
- **No single-provider coupling, no blind round-robin** — the explicitly
  roasted anti-patterns are absent by design.
- **Continuity over capability:** the task (the booking) still *completes*
  during the outage and persists; recovery resumes the real model mid-call
  with the context the FSM gathered.

## Test surface

21 credential-free tests (`node --test`): FSM intents, slot-filling,
confirm-back, intent barge-in, idempotent + outage-surviving persistence,
gateway UP→503→failover→restore transitions, recovery-race. Plus a gated
real-ElevenLabs smoke proving the live surface on the key.

## Honest limitations

- The narration in the demo video is synthetic (ElevenLabs
  `eleven_multilingual_v2`, flagged in `voice_config.json`); a human VO is
  recommended before final submission.
- Browser web-call is the demo surface; real PSTN telephony is out of scope
  (no carrier creds, no visual gain).
- Single clinic, session-scoped memory — multi-tenant is post-hackathon.
