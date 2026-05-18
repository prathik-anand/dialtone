# Still On The Line

### The clinic phone line that keeps booking patients while the AI behind it is down.

Every "AI receptionist" demo works — until OpenAI has a bad afternoon and the
phone line goes silent on a patient calling about a refill. **Still On The Line**
is the one entry where *you*, the judge, take the model offline mid-call and
watch the appointment still get booked.

---

## The 10-second pitch

A patient is on the phone with a clinic's AI receptionist. You click **Induce
outage**. The provider pill snaps red — a real `HTTP 503`, not a slide. The call
doesn't even stutter: it drops onto a deterministic clinical playbook, finishes
the booking, writes it to the database, and when you click **Restore** the real
model resumes the same call mid-sentence.

> An LLM outage stops being an incident and becomes a routing event. That's the
> whole product.

## Why this is different

- **You cause the outage.** Most resilience demos *assert* resilience. Here the
  judge presses the button and sees a real 503 hit a real route. Open the repo:
  `button → gateway.js (health flag) → HTTP 503 → fsm.js (deterministic, zero
  LLM) → store.js (the booking row, written while the provider reads DOWN)`.
- **The save is real, not a fallback message.** The refill is logged to a real
  SQLite row *during* the outage and is still there, unchanged, after recovery.
- **It runs on one credential.** ElevenLabs hosts the model (ConvAI,
  `gemini-2.0-flash`), the speech-to-text (Scribe), and the voice (TTS). No
  separate LLM key — which is exactly why the deterministic tier has to be real.
- **Degraded, not just down.** A slow or erroring brain trips the same gateway
  on its own — the button just forces what a real provider brownout does anyway.

## Run it (about 60 seconds, local)

```bash
export ELEVENLABS_API_KEY=sk_...      # the only credential needed
npm install
npm start                              # → http://localhost:3000
```

Or: `ELEVENLABS_API_KEY=sk_... docker compose up`.

Then: **Start call** → click the scripted caller lines → **Induce outage**
mid-call → watch it keep booking → **Restore**.

```bash
npm test                               # 19 credential-free tests
ELEVENLABS_API_KEY=sk_... node --test test/smoke.elevenlabs.test.js   # real-surface smoke
```

## The demo, in three beats

1. The patient asks to book — the **real** ElevenLabs-hosted model answers and the
   appointment card fills in.
2. You take the model offline. Pill → red `HTTP 503`. The caller keeps talking;
   the badge flips to **DETERMINISTIC CLINICAL PLAYBOOK** (green). The refill is
   booked and written to the database *while the provider is down*.
3. You restore. The pill sweeps back to teal; the real model resumes the same
   call. The record written during the outage is still there.

## Tech stack

| Layer | What | Real? |
|---|---|---|
| Brain (Tier 1) | ElevenLabs ConvAI WebSocket, hosted `gemini-2.0-flash` | yes — live, per-call memory |
| Survival (Tier 2) | Deterministic clinical FSM — pure code, **zero LLM** | yes — `src/fsm.js`, 100% unit-tested |
| Voice I/O | ElevenLabs Scribe (STT) + TTS, both tiers | yes |
| Resilience gateway | Health flag → real HTTP 503 → tier routing + recovery | yes — `src/gateway.js` |
| Persistence | better-sqlite3, idempotent, survives the outage | yes — `src/store.js` |
| Console | Two-pane operator UI, SSE-driven single source of truth | — |

## Sponsor APIs

- **ElevenLabs** — the entire real core (Agents/ConvAI hosted LLM + Scribe STT +
  TTS) on `ELEVENLABS_API_KEY` alone.
- **TrueFoundry "Resilient Agents" track** — this build is a direct answer to the
  track's question, *"how does your agent behave when the LLM server goes down?"*
  An outage becomes a routing event, not an incident — degradation-aware, not
  just hard-down. No single-provider coupling, no blind round-robin.

## Demo video

See the release assets for the demo recording.

## License

MIT.
