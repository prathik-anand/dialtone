# Setup — Dialtone

## Requirements
- Node ≥ 20
- One credential: `ELEVENLABS_API_KEY` (paid Creator tier — the demo uses
  ConvAI hosted LLM + Scribe STT + TTS). No OpenAI/Gemini/other key needed.

## Run locally (~60s)

```bash
export ELEVENLABS_API_KEY=sk_...
npm install
npm start                       # → http://localhost:3000
```

Or with Docker:

```bash
ELEVENLABS_API_KEY=sk_... docker compose up
```

## Drive the demo
1. Open http://localhost:3000.
2. **Start call** (opens a real ConvAI session).
3. Click the scripted-caller lines in order:
   - "Hi, can I book an appointment to see the doctor Tuesday at 3:15 PM?"
   - **Induce outage** (operator button) — the provider pill snaps red, real HTTP 503.
   - "Sorry, are you still there? I also need a medication refill."
   - "It's for my Metformin." → "Yes, please send that." (booked **while DOWN**)
   - **Restore** — the model returns and recalls the Tuesday booking.

## Tests

```bash
npm test                                                  # 21 credential-free tests
ELEVENLABS_API_KEY=sk_... node --test test/smoke.elevenlabs.test.js   # real-surface smoke
```

## Notes
- `data/appointments.db` is created on first run (SQLite, WAL). Safe to delete to reset.
- Mic is optional — the scripted-caller lines are the reproducible demo path.
- The induced outage is a real backend 503, not a UI toggle (trace
  `public/app.js` → `/api/outage/induce` → `src/gateway.js` → `/api/tool/book` 503).
