// FSM unit tests — pure, credential-free. The deterministic survival tier is
// the TrueFoundry-winning piece; it must be airtight with no LLM in the loop.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fsmTurn, CLINIC } from "../src/fsm.js";

function run(lines) {
  let mem; const out = [];
  for (const l of lines) { const r = fsmTurn(l, mem); mem = r.mem; out.push(r); }
  return out;
}

test("books an appointment end to end with confirm-back", () => {
  const o = run(["I want to book an appointment", "Tuesday", "3:15 pm", "yes"]);
  assert.equal(o.at(-1).action.type, "book");
  assert.equal(o.at(-1).action.record.date, "Tuesday");
  assert.equal(o.at(-1).action.record.time, "3:15 PM");
  assert.ok(o.every((t) => t.servedBy === "DETERMINISTIC_PLAYBOOK"));
});

test("captures day+time given in one utterance", () => {
  const o = run(["Can I come in on Tuesday at 3:15 pm?", "yes"]);
  assert.equal(o.at(-1).action.type, "book");
  assert.equal(o.at(-1).action.record.time, "3:15 PM");
});

test("never books without an explicit yes (confirm-back enforced)", () => {
  const o = run(["book appointment", "Friday", "10 am"]);
  assert.equal(o.at(-1).action, null);
  assert.match(o.at(-1).reply, /confirm/i);
});

test("deny at confirm restarts the slot collection", () => {
  const o = run(["book", "Friday", "10am", "no"]);
  assert.equal(o.at(-1).action, null);
  assert.match(o.at(-1).reply, /again/i);
});

test("refill request books a refill record", () => {
  const o = run(["I need a refill", "Metformin", "yes please"]);
  assert.equal(o.at(-1).action.type, "refill");
  assert.equal(o.at(-1).action.record.med, "Metformin");
});

test("refill extracts a clean medication name from a natural sentence", () => {
  const o = run(["I need a refill", "It's for my Metformin", "yes"]);
  assert.equal(o.at(-1).action.type, "refill");
  assert.equal(o.at(-1).action.record.med, "Metformin");
});

test("hours intent answers without leaving INTENT and without an action", () => {
  const o = run(["what are your hours?"]);
  assert.equal(o[0].action, null);
  assert.ok(o[0].reply.includes(CLINIC.hours));
});

test("low-confidence / off-script input → bounded safe fallback, no invention", () => {
  const o = run(["do I have cancer?"]);
  assert.equal(o[0].action, null);
  assert.match(o[0].reply, /book an appointment, reschedule|refill|hours/i);
  assert.doesNotMatch(o[0].reply, /cancer|diagnos|medical advice/i);
});

test("reschedule path collects new day+time and confirms", () => {
  const o = run(["I need to reschedule my appointment", "Wednesday", "9 am", "yes"]);
  assert.equal(o.at(-1).action.type, "reschedule");
});

test("intent barge-in: a new intent mid-slot-fill re-routes (no wedged reprompt)", () => {
  // book flow gets half-filled, then caller pivots to a refill across a tier switch
  const o = run([
    "I'd like to book an appointment to see the doctor", // -> BOOK_DATE
    "Sorry, are you still there? I also need a medication refill", // barge-in -> refill
    "It's for my Metformin",
    "yes",
  ]);
  assert.equal(o.at(-1).action.type, "refill");
  assert.equal(o.at(-1).action.record.med, "Metformin");
  // never the wedged "I didn't catch the time" loop
  assert.ok(!o.some((r) => /didn't catch the time/i.test(r.reply) && r === o.at(-1)));
});

test("BOOK_DATE captures a time given in the same utterance (no stuck BOOK_TIME)", () => {
  const o = run(["I want to book", "Can I come Tuesday at 3:15 pm?", "yes"]);
  assert.equal(o.at(-1).action.type, "book");
  assert.equal(o.at(-1).action.record.time, "3:15 PM");
});

test("FSM never returns undefined reply for any state", () => {
  for (const seq of [["x"], ["book"], ["book", "Monday"], ["refill"], ["hi"]]) {
    for (const r of run(seq)) assert.equal(typeof r.reply, "string");
  }
});
