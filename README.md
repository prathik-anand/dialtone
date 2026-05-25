# Dialtone

### The clinic phone line that keeps booking patients while the AI behind it is slow, or down.

*A dialtone means the line is alive. This one stays alive across three states
of the brain behind it: **UP · DEGRADED · DOWN**.*

Every "AI receptionist" demo works — until OpenAI has a bad afternoon and the
phone line goes silent on a patient calling about a refill. The thing most
demos miss isn't the hard outage — it's the brownout: the model still
technically *responds*, just too slowly to use, and the conversation hangs.
**Dialtone** is the one entry where *you*, the judge, press a button to cause
**both** failure modes — a real brownout, then a real outage — mid-call, and
watch the appointment still get booked through each.

---

## The 30-second pitch — one button, three states

You start a call. A patient asks to book Tuesday at 3:15. The real
ElevenLabs-hosted model takes the turn; the appointment card fills in.

- Press **Induce brownout**. The provider pill snaps amber. On the *next*
  caller turn, the gateway genuinely races the real model against a tight
  `1200ms` deadline, the model genuinely misses it, and a deterministic
  clinical playbook quietly takes the turn. `provider_state=DEGRADED` row
  written to the DB. The caller never waited. **(This is the failure mode
  most resilience demos skip — a model that is up but unusable.)**
- Press **Induce outage**. The pill goes red on a real `HTTP 503`. The
  refill gets booked and persisted to the DB *while the provider reads
  DOWN*. `provider_state=DOWN` row written. The same deterministic
  playbook handles both states; the only thing that changes is whether
  the brain was given a chance to answer first.
- Press **Restore**. The real model resumes mid-call and still remembers
  the Tuesday appointment.

> An LLM brownout — or outage — stops being an incident and becomes a
> routing event. That's the whole product.

## Why this is different

- **Three states, not two — UP · DEGRADED · DOWN — and you cause each one.**
  Most resilience demos *assert* resilience. This one lets the judge press
  the buttons and watch (a) a real brownout (`provider_state=DEGRADED`,
  written to disk while the real model was *slow*) and (b) a real hard
  outage (`provider_state=DOWN`, written to disk while the real model
  returned `HTTP 503`) on the same patient call, served by the same
  deterministic playbook. The "DEGRADED" path is the differentiator —
  *"technically up but unusable"* is the failure mode the rest of the
  field doesn't model.
- **The deterministic tier is real and bounded.** Pure code (`src/fsm.js`),
  zero LLM, 100% unit-tested, scoped to the refill / appointment flow that
  the clinic phone line actually handles — not a general-purpose AI, by
  design. The scope is the point: you can audit it line-by-line, and the
  brain can fail however it likes without taking the booking with it.
- **You open the repo and trace it.**
  `button → gateway.js (health flag) → HTTP 503 → fsm.js (deterministic, zero
  LLM) → store.js (the booking row, written while provider reads DOWN)`. The
  brownout path is `degradeBtn → induceDegraded() → routeTurn DEGRADED →
  Promise.race([real callTier1, 1200ms deadline]) → fsm.js → store.js`. Both
  paths are reachable from the UI; both write rows to the same SQLite file.
- **The save is real, not a fallback message.** The refill is logged to a
  real SQLite row *during* the outage (and during the brownout) and is
  still there, unchanged, after recovery — the real model picks the same
  appointment up on the next turn.
- **It runs on one credential.** ElevenLabs hosts the model (ConvAI,
  `gemini-2.0-flash`), the speech-to-text (Scribe), and the voice (TTS). No
  separate LLM key — which is exactly why the deterministic tier has to be real.

## Run it (about 60 seconds, local)

```bash
export ELEVENLABS_API_KEY=sk_...      # the only credential needed
npm install
npm start                              # → http://localhost:3000
```

Or: `ELEVENLABS_API_KEY=sk_... docker compose up`.

Then: **Start call** → click the scripted caller lines → **Induce brownout**
(amber, the model goes slow → deterministic playbook takes the turn) →
**Induce outage** (red, real `HTTP 503`) → watch it keep booking → **Restore**.

```bash
npm test                               # 33 credential-free tests (incl. 5 regression)
ELEVENLABS_API_KEY=sk_... node --test test/smoke.elevenlabs.test.js   # real-surface smoke
```

## The demo, in four beats

1. **UP.** The patient asks to book — the **real** ElevenLabs-hosted model
   answers and the appointment card fills in for Tuesday 3:15.
2. **DEGRADED — the brownout.** You press **Induce brownout**. Pill snaps
   amber. On the next caller turn the gateway races the real model against a
   tight `1200ms` deadline; the real model misses; the deterministic playbook
   takes the turn. The caller never waited. Row written:
   `provider_state=DEGRADED`, `served_by=DETERMINISTIC_PLAYBOOK`.
3. **DOWN — the outage.** You press **Induce outage**. Pill → red, real
   `HTTP 503`. The refill is booked and written to the database *while the
   provider is down*. Row written: `provider_state=DOWN`, same playbook.
   The DEGRADED row from beat 2 is still on disk, unchanged — side-by-side
   proof in the SQLite file that the same code handles both.
4. **UP again.** You restore. The pill sweeps back to teal; the real model
   resumes the same call and still remembers the Tuesday appointment.

> **Inspect the proof yourself:**
> `sqlite3 data/appointments.db "select slot, served_by, provider_state from appointments order by id desc limit 4;"`
> — two rows from this demo, one DEGRADED, one DOWN, identical playbook.

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

[**`dialtone-demo.mp4` (87s, 1080p)** — published as a GitHub Release asset.](https://github.com/prathik-anand/dialtone/releases/latest)
A real browser screen-recording of the running build at `localhost:3000`,
narrated. The "UP → DEGRADED → DOWN → UP" arc is captured live, button-by-button —
the only thing not real on screen is the voice (synthetic-fallback narration; a
human VO is the final polish, see `submit.md`).

## License

MIT.
