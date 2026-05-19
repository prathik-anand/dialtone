// DEGRADED / brownout routing — the real tight-deadline TIER 1 → TIER 2 path
// (spec.md R6). Credential-free: fake callTier1/callTier2, no ElevenLabs.
//
// The deadline is a real 1200ms const in gateway.js. "Miss" tests use a
// never-resolving / late TIER 1 so only the deadline can win; they wait the
// real ~1.2s — that is the genuine degradation executing, not a stub.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  gw, routeTurn, induceDegraded, induceOutage, restore, tierOneBlocked,
} from "../src/gateway.js";

const T1_OK = async () => "LLM says hello";
const T1_THROW = async () => { throw new Error("convai ws error"); };
const T1_NEVER = () => new Promise(() => {});                 // only the deadline can win
const T1_LATE_REJECT = () => new Promise((_, rej) =>
  setTimeout(() => rej(new Error("late convai error")), 1400)); // rejects AFTER the 1200 deadline
const T2 = () => ({ reply: "deterministic playbook reply", servedBy: "DETERMINISTIC_PLAYBOOK" });

// 1
test("induceDegraded() → DEGRADED, induced, reason set", () => {
  restore();
  induceDegraded();
  assert.equal(gw.state, "DEGRADED");
  assert.equal(gw.induced, true);
  assert.equal(gw.lastReason, "operator induced brownout");
  restore();
});

// 2
test("DEGRADED + TIER 1 within deadline → served by LLM, providerState DEGRADED, TIER 2 not called", async () => {
  restore(); induceDegraded();
  let t2Called = false;
  const r = await routeTurn({ callTier1: T1_OK, callTier2: () => { t2Called = true; return T2(); } });
  assert.equal(r.servedBy, "LLM_GEMINI");
  assert.equal(r.providerState, "DEGRADED");
  assert.equal(t2Called, false);
  restore();
});

// 3
test("DEGRADED + TIER 1 misses the deadline → falls to deterministic TIER 2, DEGRADED, no throw", async () => {
  restore(); induceDegraded();
  const r = await routeTurn({ callTier1: T1_NEVER, callTier2: T2 });
  assert.equal(r.servedBy, "DETERMINISTIC_PLAYBOOK");
  assert.equal(r.providerState, "DEGRADED");
  assert.equal(r.reply, "deterministic playbook reply");
  restore();
});

// 4
test("DEGRADED + TIER 1 throws before deadline → TIER 2, state stays DEGRADED (NOT hard DOWN)", async () => {
  restore(); induceDegraded();
  const r = await routeTurn({ callTier1: T1_THROW, callTier2: T2 });
  assert.equal(r.servedBy, "DETERMINISTIC_PLAYBOOK");
  assert.equal(r.providerState, "DEGRADED");
  assert.equal(gw.state, "DEGRADED"); // induced override: organic trip cannot hard-DOWN it
  restore();
});

// 5
test("losing TIER 1 promise rejecting AFTER the deadline does not crash the process", async () => {
  restore(); induceDegraded();
  const r = await routeTurn({ callTier1: T1_LATE_REJECT, callTier2: T2 });
  assert.equal(r.servedBy, "DETERMINISTIC_PLAYBOOK"); // deadline won
  await new Promise((res) => setTimeout(res, 500));   // let the ~1400ms rejection fire
  assert.ok(true); // reached here → no unhandledRejection took down the process
  restore();
});

// 6
test("TIER 1 win clears the deadline timer (no hang, returns promptly)", async () => {
  restore(); induceDegraded();
  const started = Date.now();
  const r = await routeTurn({ callTier1: T1_OK, callTier2: T2 });
  assert.equal(r.servedBy, "LLM_GEMINI");
  assert.ok(Date.now() - started < 1000, "must return well before the 1200ms deadline");
  restore();
});

// 7
test("restore() from DEGRADED → UP, induced cleared", () => {
  restore(); induceDegraded();
  restore();
  assert.equal(gw.state, "UP");
  assert.equal(gw.induced, false);
});

// 8 — REGRESSION
test("REGRESSION: UP still routes to TIER 1 unchanged", async () => {
  restore();
  const r = await routeTurn({ callTier1: T1_OK, callTier2: T2 });
  assert.equal(r.servedBy, "LLM_GEMINI");
  assert.equal(r.providerState, "UP");
});

// 9 — REGRESSION
test("REGRESSION: DOWN still routes to TIER 2 only, providerState DOWN", async () => {
  restore(); induceOutage();
  const r = await routeTurn({ callTier1: T1_OK, callTier2: T2 });
  assert.equal(r.servedBy, "DETERMINISTIC_PLAYBOOK");
  assert.equal(r.providerState, "DOWN");
  restore();
});

// 10 — REGRESSION
test("REGRESSION: tierOneBlocked() true ONLY for DOWN (false for UP and DEGRADED)", () => {
  restore();              assert.equal(tierOneBlocked(), false); // UP
  induceDegraded();       assert.equal(tierOneBlocked(), false); // DEGRADED must NOT 503
  induceOutage();         assert.equal(tierOneBlocked(), true);  // DOWN
  restore();
});

// 11 — REGRESSION
test("REGRESSION: induceOutage() still hard DOWN even from DEGRADED", () => {
  restore(); induceDegraded();
  induceOutage();
  assert.equal(gw.state, "DOWN");
  assert.equal(tierOneBlocked(), true);
  restore();
});

// 12 — REGRESSION
test("REGRESSION: organic TIER 1 error under induced DEGRADED does not hard-DOWN (induced wins)", async () => {
  restore(); induceDegraded();
  await routeTurn({ callTier1: T1_THROW, callTier2: T2 });
  assert.equal(gw.state, "DEGRADED"); // induced precedence held; line stayed on the brownout tier
  restore();
});
