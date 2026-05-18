# Architecture — Dialtone

A clinic phone line that keeps booking patients through a live LLM-provider
outage. One external dependency: `ELEVENLABS_API_KEY`. No separate LLM key —
which is *why* the deterministic survival tier has to be real.

```
 BROWSER (operator console, the screen-recorded demo surface)
 ┌───────────────────────────────┬────────────────────────────────┐
 │ LEFT — the call               │ RIGHT — the resilience hero      │
 │ ConvAI-style voice loop       │ provider pill UP/DEGRADED/DOWN   │
 │ live transcript               │ served-by: LLM | DETERMINISTIC   │
 │ scripted-caller dock          │ appointment card · Induce/Restore│
 └───────────────┬───────────────┴────────────────┬───────────────┘
                  │ /api/turn (audio|text)         │ SSE /api/events
                  ▼                                 ▲ (single source of truth)
 ┌──────────────────────────────────────────────────────────────────┐
 │ BACKEND (Node 20 + Express, ESM)                                   │
 │  gateway.js  health flag → real HTTP 503 on the LLM route          │
 │              UP → TIER 1 · DEGRADED → try T1 then fall · DOWN → T2  │
 │  TIER 1  ElevenLabs ConvAI WebSocket, hosted gemini-2.0-flash      │
 │          (real per-call memory; reconnect-retry on a dropped WS)   │
 │  TIER 2  fsm.js — deterministic clinical FSM, ZERO model calls     │
 │          ElevenLabs Scribe STT → pure-code FSM → ElevenLabs TTS    │
 │  store.js  better-sqlite3, idempotent, UNIQUE(session,slot)        │
 └──────────────────────────────────────────────────────────────────┘
```

## The resilience contract

1. **Normal:** caller turn → Scribe STT → ConvAI hosted LLM (Tier 1) → TTS;
   booking persisted to SQLite.
2. **Induced outage:** operator flips the gateway health flag. The LLM-tier
   route returns a **real HTTP 503** (`/api/tool/book`). The model is genuinely
   not invoked.
3. **Survival:** the live call is served by the deterministic clinical FSM —
   Scribe STT → pure code (intents: book / reschedule / refill / hours;
   slot-filling; confirm-back; intent barge-in; clinically-safe bounded
   fallback; **never** medical advice) → TTS. The booking still completes and
   is written to SQLite with `provider_state = DOWN`.
4. **Recovery:** clearing the flag routes the next real turn back to the live
   ConvAI session; FSM-collected slots are replayed as a contextual update so
   the model resumes mid-call.

Organic failures (a real ConvAI error / timeout) trip the *same* gateway — the
Induce button only forces what a real provider brownout does on its own.
Degradation-aware, not just hard-down (the TrueFailover distinction).

## FSM state machine (src/fsm.js)

`GREETING → INTENT → (BOOK_DATE→BOOK_TIME→BOOK_CONFIRM | RESCHED… | REFILL_MED→
REFILL_CONFIRM | HOURS) → DONE`, with intent barge-in from any non-confirm
state and same-utterance date+time capture. 100% credential-free unit-tested.

## Why this shape

The night had only an ElevenLabs key. Custom-LLM ConvAI would reintroduce a
paid-LLM dependency, so Tier 1 uses the *hosted* model. That constraint is the
thesis: if the model can vanish, a real deterministic tier must carry the call.
