// Deterministic Clinical FSM — TIER 2, the resilient survival tier.
//
// Pure code. ZERO model calls. This is what keeps the clinic phone line alive
// when the LLM provider is down. Every reply here is produced by this state
// machine, never by an LLM, never golden-cached. It is intentionally narrow
// and clinically safe: it books / reschedules / takes refill requests / states
// hours, and refuses anything else with a bounded, safe line. It NEVER gives
// medical advice.
//
//   STATE DIAGRAM (per call session)
//
//   GREETING
//      │  (first turn)
//      ▼
//   INTENT ──"book"──────────▶ BOOK_DATE ─▶ BOOK_TIME ─▶ BOOK_CONFIRM ─┐
//      │                                                                │
//      ├──"reschedule"──▶ RESCHED_NEW (date) ─▶ RESCHED_TIME ─▶ BOOK_CONFIRM
//      │                                                                │
//      ├──"refill"──────▶ REFILL_MED ─▶ REFILL_CONFIRM ─────────────────┤
//      │                                                                │
//      ├──"hours"───────▶ (answer, stay in INTENT)                       │
//      │                                                                ▼
//      └──(unrecognized, low conf) ─▶ SAFE_FALLBACK ─▶ INTENT       DONE (write)
//
// Confirm-back is mandatory before any write (no silent bookings). Low-confidence
// or off-script input routes to SAFE_FALLBACK, which re-offers the four things
// it can do — it never invents and never advises.

export const CLINIC = {
  name: "Cedar Family Clinic",
  hours: "We're open Monday through Friday, 8 AM to 5 PM, and Saturday 9 to 1.",
};

const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

function findDay(t) {
  const s = t.toLowerCase();
  if (/\btomorrow\b/.test(s)) return "tomorrow";
  if (/\btoday\b/.test(s)) return "today";
  for (const d of DAYS) if (s.includes(d)) return d[0].toUpperCase() + d.slice(1);
  return null;
}

// Parse "3:15", "3 15", "3 pm", "10am", "noon", "half past 2" (bounded set)
function findTime(t) {
  const s = t.toLowerCase();
  if (/\bnoon\b/.test(s)) return "12:00 PM";
  let m = s.match(/\b(\d{1,2})[:\s](\d{2})\s*(am|pm)?\b/);
  if (m) {
    let h = +m[1], min = m[2];
    let ap = m[3] ? m[3].toUpperCase() : h < 8 ? "PM" : h <= 12 ? (h === 12 ? "PM" : "AM") : "PM";
    return `${h}:${min} ${ap}`;
  }
  m = s.match(/\b(\d{1,2})\s*(am|pm)\b/);
  if (m) return `${+m[1]}:00 ${m[2].toUpperCase()}`;
  return null;
}

// Pull the medication name out of a natural utterance, stripping carrier
// phrases ("it's for my ...", "I need ...", "the medication is ...").
function extractMed(t) {
  const STOP = new Set(("it its that this for my the a an please refill prescription " +
    "medication meds of on to i need want is was am called named s hi hello yes um " +
    "uh and also some get got would like can could you have having take taking").split(" "));
  const toks = (t || "").toLowerCase()
    .replace(/[^a-z0-9 \-]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !STOP.has(w));
  if (!toks.length) return null;
  // drug names are short noun phrases — keep the first 1-2 content tokens
  return toks.slice(0, 2).join(" ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function detectIntent(t) {
  const s = t.toLowerCase();
  if (/\b(resched|move|change).*(appoint|booking)|reschedule\b/.test(s)) return "reschedule";
  if (/\b(refill|prescription|renew|medication|meds)\b/.test(s)) return "refill";
  if (/\b(hours|open|close|timing|when are you)\b/.test(s)) return "hours";
  if (/\b(book|appointment|see the doctor|schedule|come in|visit|slot)\b/.test(s)) return "book";
  if (/\b(yes|yeah|yep|correct|that'?s right|confirm|sure)\b/.test(s)) return "affirm";
  if (/\b(no|nope|wrong|not right|change that)\b/.test(s)) return "deny";
  return null;
}

const LOW_CONF_LINE =
  "Sorry, I didn't quite catch that. I can book an appointment, reschedule one, " +
  "take a refill request, or give you our hours. Which would you like?";

// Advance the FSM one turn. `mem` is the per-session object (mutated).
// Returns { reply, mem, action } where action (optional) = { type:'book', record }.
export function fsmTurn(text, mem) {
  mem = mem || { state: "GREETING", slots: {} };
  const t = (text || "").trim();
  const intent = detectIntent(t);
  let action = null;
  let reply;

  // Intent barge-in: a caller can change their mind ("actually, I also need a
  // refill") from any non-confirmation state. Without this the FSM can get
  // wedged mid-slot-fill across a tier switch and repeat a reprompt forever.
  if (
    ["book", "reschedule", "refill", "hours"].includes(intent) &&
    !["BOOK_CONFIRM", "RESCHED_CONFIRM", "REFILL_CONFIRM"].includes(mem.state) &&
    mem.state !== "INTENT" && mem.state !== "GREETING"
  ) {
    mem.state = "INTENT";
    mem.slots = {};
  }

  const repromptDate = "What day works for you?";
  const repromptTime = "And what time on that day?";

  switch (mem.state) {
    case "GREETING":
      mem.state = "INTENT";
      // fallthrough into INTENT using the same text
    case "INTENT": {
      if (intent === "hours") { reply = CLINIC.hours + " Anything else — book, reschedule, or a refill?"; break; }
      if (intent === "book") { mem.state = "BOOK_DATE"; mem.slots = {};
        const d = findDay(t), tm = findTime(t);
        if (d) mem.slots.date = d;
        if (d && tm) { mem.slots.time = tm; mem.state = "BOOK_CONFIRM";
          reply = `So that's ${d} at ${tm}. Shall I confirm it?`; break; }
        if (d) { mem.state = "BOOK_TIME";
          reply = `Sure, I can book you for ${d}. ${repromptTime}`; break; }
        reply = "I can book that for you. " + repromptDate; break; }
      if (intent === "reschedule") { mem.state = "RESCHED_NEW"; mem.slots = { reschedule: true };
        reply = "I can move your appointment. What new day would you like?"; break; }
      if (intent === "refill") { mem.state = "REFILL_MED"; mem.slots = { refill: true };
        reply = "I can take a refill request. Which medication is it?"; break; }
      reply = LOW_CONF_LINE; mem.state = "INTENT"; break;
    }
    case "BOOK_DATE":
    case "RESCHED_NEW": {
      const d = findDay(t), tm = findTime(t);
      if (!d) { reply = "I didn't catch the day. " + repromptDate; break; }
      mem.slots.date = d;
      if (tm) { mem.slots.time = tm; mem.state = "BOOK_CONFIRM";
        reply = `So that's ${d} at ${tm}${mem.slots.reschedule ? ", rescheduled" : ""}. Shall I confirm it?`; break; }
      mem.state = mem.slots.reschedule ? "RESCHED_TIME" : "BOOK_TIME";
      reply = `Got it, ${d}. ${repromptTime}`; break;
    }
    case "BOOK_TIME":
    case "RESCHED_TIME": {
      const tm = findTime(t);
      if (!tm) { reply = "I didn't catch the time. " + repromptTime; break; }
      mem.slots.time = tm;
      mem.state = "BOOK_CONFIRM";
      reply = `So that's ${mem.slots.date} at ${mem.slots.time}${mem.slots.reschedule ? ", rescheduled" : ""}. Shall I confirm it?`;
      break;
    }
    case "BOOK_CONFIRM": {
      if (intent === "affirm") {
        const kind = mem.slots.reschedule ? "reschedule" : "book";
        action = { type: kind, record: { date: mem.slots.date, time: mem.slots.time, kind } };
        mem.state = "DONE";
        reply = `You're booked for ${mem.slots.date} at ${mem.slots.time}. Is there anything else?`;
        break;
      }
      if (intent === "deny") { mem.state = "BOOK_DATE"; mem.slots = {}; reply = "No problem, let's try again. " + repromptDate; break; }
      reply = `Just to confirm — ${mem.slots.date} at ${mem.slots.time}. Yes or no?`; break;
    }
    case "REFILL_MED": {
      const med = extractMed(t);
      if (!med) { reply = "Which medication should I put the refill request in for?"; break; }
      mem.slots.med = med;
      mem.state = "REFILL_CONFIRM";
      reply = `A refill request for ${mem.slots.med}. Shall I send that to the pharmacy?`;
      break;
    }
    case "REFILL_CONFIRM": {
      if (intent === "affirm") {
        action = { type: "refill", record: { med: mem.slots.med, kind: "refill" } };
        mem.state = "DONE";
        reply = `Done — a refill request for ${mem.slots.med} is logged. Anything else?`;
        break;
      }
      if (intent === "deny") { mem.state = "REFILL_MED"; reply = "Okay — which medication, then?"; break; }
      reply = `To confirm: a refill for ${mem.slots.med}. Yes or no?`; break;
    }
    case "DONE": {
      if (intent === "book" || intent === "reschedule" || intent === "refill" || intent === "hours") {
        mem.state = "INTENT"; return fsmTurn(t, mem);
      }
      reply = "You're all set. Thanks for calling " + CLINIC.name + ". Goodbye.";
      break;
    }
    default:
      mem.state = "INTENT"; reply = LOW_CONF_LINE;
  }

  return { reply, mem, action, servedBy: "DETERMINISTIC_PLAYBOOK" };
}
