// Gated real-ElevenLabs smoke (spec.md R1). Skipped without the key so the
// suite stays credential-free; RUN it before shipping to prove the real surface.
import { test } from "node:test";
import assert from "node:assert/strict";

const KEY = process.env.ELEVENLABS_API_KEY;

test("ElevenLabs surfaces are real on the key (agent create + STT model + TTS)", { skip: !KEY }, async () => {
  const { ensureAgent, tts } = await import("../src/elevenlabs.js");
  const agentId = await ensureAgent();
  assert.match(agentId, /^agent_/);                    // real ConvAI agent id
  const audio = await tts("Cedar Family Clinic, this is a smoke test.");
  assert.ok(audio.length > 1000);                      // real mp3 bytes
});
