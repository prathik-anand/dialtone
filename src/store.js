// Appointment store — real, file-backed (better-sqlite3).
//
// The realness anchor (spec.md R4): a row written here is queryable
// independently before / during / after the outage and survives the whole
// transition. Idempotent: a retry with the same (session, slot) does not
// duplicate. This is what proves "the booking still got made while the model
// was down" is not display state — it is a row on disk.

import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

let db;

export function openStore(file = "data/appointments.db") {
  mkdirSync(dirname(file), { recursive: true });
  db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS appointments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session TEXT NOT NULL,
      kind TEXT NOT NULL,
      slot TEXT NOT NULL,            -- "Tuesday 3:15 PM" or medication name
      detail TEXT NOT NULL,          -- json of the captured record
      served_by TEXT NOT NULL,       -- LLM_GEMINI | DETERMINISTIC_PLAYBOOK
      provider_state TEXT NOT NULL,  -- UP | DEGRADED | DOWN at write time (proof)
      created_at TEXT NOT NULL,
      UNIQUE(session, slot)
    );
  `);
  return db;
}

// Idempotent write. Returns { record, duplicated:boolean }.
export function writeAppointment({ session, kind, record, servedBy, providerState }) {
  const slot = record.med ? `RX:${record.med}` : `${record.date} ${record.time}`;
  const row = {
    session,
    kind,
    slot,
    detail: JSON.stringify(record),
    served_by: servedBy,
    provider_state: providerState,
    created_at: new Date().toISOString(),
  };
  try {
    const info = db
      .prepare(
        `INSERT INTO appointments (session,kind,slot,detail,served_by,provider_state,created_at)
         VALUES (@session,@kind,@slot,@detail,@served_by,@provider_state,@created_at)`
      )
      .run(row);
    return { record: getById(info.lastInsertRowid), duplicated: false };
  } catch (e) {
    if (String(e).includes("UNIQUE")) {
      const existing = db
        .prepare(`SELECT * FROM appointments WHERE session=? AND slot=?`)
        .get(session, slot);
      return { record: hydrate(existing), duplicated: true };
    }
    throw e;
  }
}

function getById(id) {
  return hydrate(db.prepare(`SELECT * FROM appointments WHERE id=?`).get(id));
}

function hydrate(r) {
  if (!r) return null;
  return { ...r, detail: JSON.parse(r.detail) };
}

// Independent read path (used by Phase 7 conformance + the live UI + tests):
// proves the record exists outside of any in-memory call state.
export function latestForSession(session) {
  const r = db
    .prepare(`SELECT * FROM appointments WHERE session=? ORDER BY id DESC LIMIT 1`)
    .get(session);
  return hydrate(r);
}

export function allAppointments() {
  return db.prepare(`SELECT * FROM appointments ORDER BY id DESC`).all().map(hydrate);
}

export function _resetForTest() {
  if (db) db.exec("DELETE FROM appointments");
}
