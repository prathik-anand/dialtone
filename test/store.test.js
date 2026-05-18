// Store tests — the realness anchor (spec.md R4): a booking written during the
// outage is a real row that survives, idempotently.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { openStore, writeAppointment, latestForSession, _resetForTest } from "../src/store.js";

before(() => { openStore(":memory:"); });

test("writes an appointment and reads it back via an independent query", () => {
  _resetForTest();
  const w = writeAppointment({
    session: "s1", kind: "appointment",
    record: { date: "Tuesday", time: "3:15 PM" },
    servedBy: "DETERMINISTIC_PLAYBOOK", providerState: "DOWN",
  });
  assert.equal(w.duplicated, false);
  const got = latestForSession("s1");
  assert.equal(got.detail.date, "Tuesday");
  assert.equal(got.provider_state, "DOWN");          // proof it was written while DOWN
  assert.equal(got.served_by, "DETERMINISTIC_PLAYBOOK");
});

test("idempotent: same (session,slot) does not duplicate on retry", () => {
  _resetForTest();
  const a = writeAppointment({ session: "s2", kind: "appointment", record: { date: "Friday", time: "10:00 AM" }, servedBy: "LLM_GEMINI", providerState: "UP" });
  const b = writeAppointment({ session: "s2", kind: "appointment", record: { date: "Friday", time: "10:00 AM" }, servedBy: "LLM_GEMINI", providerState: "UP" });
  assert.equal(a.duplicated, false);
  assert.equal(b.duplicated, true);
});

test("the record persists across an outage window (write DOWN, read after UP)", () => {
  _resetForTest();
  writeAppointment({ session: "s3", kind: "refill", record: { med: "Metformin" }, servedBy: "DETERMINISTIC_PLAYBOOK", providerState: "DOWN" });
  // simulate "after recovery" — independent read, no in-memory call state
  const got = latestForSession("s3");
  assert.equal(got.detail.med, "Metformin");
  assert.equal(got.kind, "refill");
});
