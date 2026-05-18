// ElevenLabs client — the ONLY external dependency, on ELEVENLABS_API_KEY alone.
//
// Surfaces (all verified real on the paid Creator key, see realness_spike.md):
//   - ensureAgent()        : create/reuse a ConvAI agent (hosted gemini-2.0-flash)
//   - ConvaiSession (WS)   : TIER 1 brain — real hosted LLM, per-call memory
//   - sttScribe(buf)       : speech-to-text (Scribe) — used by BOTH tiers
//   - tts(text)            : text-to-speech — used by BOTH tiers
//
// No separate LLM/OpenAI/Gemini key exists or is needed. ElevenLabs hosts the
// model. This is the whole reason the wedge is real tonight.

import WebSocket from "ws";

const API = "https://api.elevenlabs.io/v1";
const KEY = () => process.env.ELEVENLABS_API_KEY;
const VOICE = process.env.ELEVENLABS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM"; // Rachel (default lib voice)

const AGENT_PROMPT =
  "You are the front desk of Cedar Family Clinic. You are warm, brief, and " +
  "efficient on a phone call. You ONLY: book appointments, reschedule them, take " +
  "medication refill requests, and state opening hours (Mon-Fri 8-5, Sat 9-1). " +
  "You never give medical advice. Keep every reply to one or two short sentences. " +
  "When the caller has given a day and a time, confirm it back and then say it is booked.";

let cachedAgentId = null;

export async function ensureAgent() {
  if (cachedAgentId) return cachedAgentId;
  const r = await fetch(`${API}/convai/agents/create`, {
    method: "POST",
    headers: { "xi-api-key": KEY(), "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "cedar-clinic-frontdesk",
      conversation_config: {
        agent: {
          prompt: { prompt: AGENT_PROMPT, llm: "gemini-2.0-flash" },
          first_message: "Thanks for calling Cedar Family Clinic. How can I help you today?",
          language: "en",
        },
      },
    }),
  });
  if (!r.ok) throw new Error(`ensureAgent ${r.status}: ${await r.text()}`);
  cachedAgentId = (await r.json()).agent_id;
  return cachedAgentId;
}

async function signedWsUrl(agentId) {
  const r = await fetch(
    `${API}/convai/conversation/get-signed-url?agent_id=${encodeURIComponent(agentId)}`,
    { headers: { "xi-api-key": KEY() } }
  );
  if (!r.ok) throw new Error(`signed-url ${r.status}: ${await r.text()}`);
  return (await r.json()).signed_url;
}

// TIER 1 brain. One WS per call session (real conversation memory). Text in,
// text out — we run our own STT/TTS so we control the capture surface and the
// tier switch. If the socket errors / stalls, that is a REAL provider failure
// the gateway treats as DOWN (TrueFailover: "the model is down is a routing
// event, not an incident").
export class ConvaiSession {
  constructor() { this.ws = null; this.ready = null; this._q = []; this._greeted = false; }

  async open() {
    const url = await signedWsUrl(await ensureAgent());
    this.ws = new WebSocket(url);
    this.ready = new Promise((resolve, reject) => {
      const to = setTimeout(() => reject(new Error("convai ws init timeout")), 8000);
      this.ws.on("message", (raw) => {
        let m; try { m = JSON.parse(raw.toString()); } catch { return; }
        if (m.type === "conversation_initiation_metadata") { clearTimeout(to); resolve(); }
        if (m.type === "agent_response") {
          const txt = m.agent_response_event?.agent_response ?? "";
          // ConvAI speaks first: the very first agent_response of the session
          // is the unsolicited greeting. Swallow exactly one, then map each
          // subsequent response to its caller turn (fixes the off-by-one that
          // made the LLM look like it ignored the caller).
          if (!this._greeted) { this._greeted = true; return; }
          const w = this._q.shift(); if (w) w.resolve(txt);
        }
        if (m.type === "ping") {
          try { this.ws.send(JSON.stringify({ type: "pong", event_id: m.ping_event?.event_id })); } catch {}
        }
      });
      this.ws.on("error", (e) => { clearTimeout(to); reject(e); });
      this.ws.on("close", () => { while (this._q.length) this._q.shift().reject(new Error("convai closed")); });
    });
    await this.ready;
  }

  // Send one caller turn, await the hosted-LLM reply text. Hard 9s deadline:
  // a slow brain is a degraded brain (gateway surfaces it).
  sendUserText(text) {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return reject(new Error("convai not open"));
      const to = setTimeout(() => reject(new Error("convai turn timeout")), 13000);
      this._q.push({ resolve: (v) => { clearTimeout(to); resolve(v); }, reject: (e) => { clearTimeout(to); reject(e); } });
      this.ws.send(JSON.stringify({ type: "user_message", text }));
    });
  }

  close() { try { this.ws?.close(); } catch {} this.ws = null; }
}

export async function sttScribe(audioBuffer, mime = "audio/webm") {
  const fd = new FormData();
  fd.append("model_id", "scribe_v1");
  fd.append("file", new Blob([audioBuffer], { type: mime }), "turn.webm");
  const r = await fetch(`${API}/speech-to-text`, {
    method: "POST",
    headers: { "xi-api-key": KEY() },
    body: fd,
  });
  if (!r.ok) throw new Error(`stt ${r.status}: ${await r.text()}`);
  return (await r.json()).text || "";
}

export async function tts(text) {
  const r = await fetch(`${API}/text-to-speech/${VOICE}?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": KEY(), "Content-Type": "application/json" },
    body: JSON.stringify({ text, model_id: "eleven_turbo_v2_5" }),
  });
  if (!r.ok) throw new Error(`tts ${r.status}: ${await r.text()}`);
  return Buffer.from(await r.arrayBuffer());
}
