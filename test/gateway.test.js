// Gateway unit tests — the resilience transitions (spec.md R2/R3/R5).
import { test } from "node:test";
import assert from "node:assert/strict";
import { gw, routeTurn, induceOutage, restore, tierOneBlocked } from "../src/gateway.js";

const T1_OK = async () => "LLM says hello";
const T1_FAIL = async () => { throw new Error("convai ws error"); };
const T1_SLOW = () => new Promise((r) => setTimeout(() => r("slow llm"), 50));
const T2 = () => ({ reply: "deterministic playbook reply", servedBy: "DETERMINISTIC_PLAYBOOK" });

test("UP routes to TIER 1 (real brain)", async () => {
  restore();
  const r = await routeTurn({ callTier1: T1_OK, callTier2: T2 });
  assert.equal(r.servedBy, "LLM_GEMINI");
  assert.equal(r.providerState, "UP");
});

test("induced outage → DOWN, TIER 1 route blocked, served by deterministic", async () => {
  induceOutage();
  assert.equal(gw.state, "DOWN");
  assert.equal(tierOneBlocked(), true);
  const r = await routeTurn({ callTier1: T1_OK, callTier2: T2 });
  assert.equal(r.servedBy, "DETERMINISTIC_PLAYBOOK");
  assert.equal(r.providerState, "DOWN");
});

test("restore → UP, route returns to TIER 1", async () => {
  restore();
  assert.equal(gw.state, "UP");
  assert.equal(tierOneBlocked(), false);
  const r = await routeTurn({ callTier1: T1_OK, callTier2: T2 });
  assert.equal(r.servedBy, "LLM_GEMINI");
});

test("organic brain error (no induce) auto-trips to deterministic, line never dies", async () => {
  restore();
  const r = await routeTurn({ callTier1: T1_FAIL, callTier2: T2 });
  assert.equal(r.servedBy, "DETERMINISTIC_PLAYBOOK"); // failover, not an exception
  assert.equal(gw.state, "DOWN");                      // same engine the button uses
  restore();
});

test("routeTurn never throws even if BOTH tiers misbehave is impossible — T2 is pure", async () => {
  induceOutage();
  await assert.doesNotReject(() => routeTurn({ callTier1: T1_FAIL, callTier2: T2 }));
  restore();
});

test("operator induce overrides organic recovery (override wins)", async () => {
  induceOutage();
  await routeTurn({ callTier1: T1_OK, callTier2: T2 }); // would auto-recover if not induced
  assert.equal(gw.state, "DOWN");
  restore();
});
