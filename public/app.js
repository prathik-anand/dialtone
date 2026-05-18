// Still On The Line — frontend. The SSE stream is the single source of truth
// for the resilience pane (the gateway decides; the UI only reflects).

const $ = (id) => document.getElementById(id);
const player = $("player");
let sessionId = null;
let busy = false;

// ---- the scripted caller: a reproducible demo path for clean capture ----
// (a real /api/turn each time; text override skips live-mic ASR variance)
const SCRIPT = [
  "Hi, I'd like to book an appointment to see the doctor.",
  "Can I come in on Tuesday at 3:15 PM?",
  "— operator: induce the outage now —",
  "Sorry, are you still there? I also need a medication refill.",
  "It's for my Metformin.",
  "Yes, please send that.",
  "— operator: restore —",
  "Great. And is my Tuesday appointment still confirmed?",
];

function buildScript() {
  const box = $("callerScript");
  box.hidden = false;
  box.innerHTML = "";
  SCRIPT.forEach((line, i) => {
    const b = document.createElement("button");
    b.textContent = (line.startsWith("—") ? line : `Caller: “${line}”`);
    b.disabled = line.startsWith("—");
    b.dataset.i = i;
    b.onclick = () => sendCallerLine(line, b);
    box.appendChild(b);
  });
}

function addTurn(role, text) {
  const t = $("transcript");
  if (t.querySelector(".empty")) t.innerHTML = "";
  t.querySelectorAll(".turn.newest").forEach((e) => e.classList.remove("newest"));
  const d = document.createElement("div");
  d.className = `turn ${role} newest`;
  d.textContent = (role === "caller" ? "Caller: " : "Agent: ") + text;
  t.appendChild(d);
  // keep last 6
  while (t.querySelectorAll(".turn").length > 6) t.querySelector(".turn").remove();
  t.scrollTop = t.scrollHeight;
}

async function sendCallerLine(text, btn) {
  if (busy || !sessionId) return;
  busy = true;
  $("waveform").classList.add("live");
  addTurn("caller", text);
  try {
    const r = await fetch("/api/turn", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, text }),
    });
    const j = await r.json();
    if (j.reply) addTurn("agent", j.reply);
    if (j.audioBase64) {
      player.src = "data:audio/mpeg;base64," + j.audioBase64;
      player.play().catch(() => {});
    }
    if (j.appointment) renderAppt(j.appointment, j.servedBy);
    if (btn) btn.classList.add("done");
  } catch (e) {
    addTurn("agent", "[client error: " + e + "]");
  } finally {
    busy = false;
    $("waveform").classList.remove("live");
  }
}

function renderAppt(a, servedBy) {
  if (!a) return;
  const card = $("apptCard");
  const d = a.detail || {};
  const slot = d.med ? `Refill: ${d.med}` : `${d.date} at ${d.time}`;
  $("apptBody").textContent = `${slot} — CONFIRMED`;
  $("apptMeta").textContent =
    `written by ${a.served_by} · provider was ${a.provider_state} · ${new Date(a.created_at).toLocaleTimeString()}`;
  card.classList.remove("empty");
  card.classList.add("confirmed", "flash");
  setTimeout(() => card.classList.remove("flash"), 950);
}

// ---- resilience pane: driven only by SSE ----
function applyState(s) {
  const pill = $("pill");
  const word = pill.querySelector(".word");
  const glyph = pill.querySelector(".glyph");
  const sub = $("pillSub");
  pill.className = "pill " + (s.state || "up").toLowerCase();
  word.textContent = s.state;
  glyph.textContent = s.state === "UP" ? "●" : s.state === "DEGRADED" ? "◐" : "■";
  $("reason").textContent = s.reason || "";
  if (s.state === "DOWN") {
    sub.textContent = "gateway: LLM route blocked · HTTP 503";
    sub.classList.add("blocked");
  } else if (s.state === "DEGRADED") {
    sub.textContent = "brain slow / erroring · routing around it";
    sub.classList.remove("blocked");
  } else {
    sub.textContent = "brain healthy · serving every turn";
    sub.classList.remove("blocked");
  }
  // served-by badge follows the last turn event
  if (s.servedBy) {
    const b = $("servedBy");
    if (s.servedBy === "DETERMINISTIC_PLAYBOOK") {
      b.className = "served-badge det";
      b.textContent = "DETERMINISTIC CLINICAL PLAYBOOK";
    } else {
      b.className = "served-badge llm";
      b.textContent = "LLM · gemini-2.0-flash";
    }
  }
  // operator buttons reflect state
  const down = s.state === "DOWN";
  $("induceBtn").hidden = down;
  $("induceBtn").disabled = down || !sessionId;
  $("restoreBtn").hidden = !down;
  $("restoreBtn").disabled = !down;
}

const es = new EventSource("/api/events");
es.onmessage = (e) => { try { applyState(JSON.parse(e.data)); } catch {} };

// ---- controls ----
$("startBtn").onclick = async () => {
  $("startBtn").disabled = true;
  $("startBtn").textContent = "Connecting…";
  try {
    const r = await fetch("/api/session", { method: "POST" });
    const j = await r.json();
    if (!j.sessionId) throw new Error(j.error || "no session");
    sessionId = j.sessionId;
    addTurn("agent", j.greeting);
    buildScript();
    $("startBtn").textContent = "Call live";
    $("micBtn").disabled = false;
    $("induceBtn").disabled = false;
  } catch (e) {
    $("startBtn").textContent = "Start call";
    $("startBtn").disabled = false;
    addTurn("agent", "[could not start: " + e + "]");
  }
};

$("induceBtn").onclick = () => fetch("/api/outage/induce", { method: "POST" });
$("restoreBtn").onclick = () => fetch("/api/outage/restore", { method: "POST" });

// Hold-to-talk live mic (real Scribe STT path; secondary to scripted caller)
let rec, chunks = [];
$("micBtn").onmousedown = async () => {
  if (busy || !sessionId) return;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    rec = new MediaRecorder(stream, { mimeType: "audio/webm" });
    chunks = [];
    rec.ondataavailable = (e) => chunks.push(e.data);
    rec.onstop = async () => {
      const blob = new Blob(chunks, { type: "audio/webm" });
      const b64 = await blobToB64(blob);
      busy = true; $("waveform").classList.add("live");
      addTurn("caller", "(spoken)");
      try {
        const r = await fetch("/api/turn", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId, audioBase64: b64, mime: "audio/webm" }),
        });
        const j = await r.json();
        if (j.transcript) t_lastCaller(j.transcript);
        if (j.reply) addTurn("agent", j.reply);
        if (j.audioBase64) { player.src = "data:audio/mpeg;base64," + j.audioBase64; player.play().catch(()=>{}); }
        if (j.appointment) renderAppt(j.appointment, j.servedBy);
      } finally { busy = false; $("waveform").classList.remove("live"); }
      stream.getTracks().forEach((t) => t.stop());
    };
    rec.start();
    $("micBtn").textContent = "Listening… release";
  } catch { addTurn("agent", "[mic blocked — use the scripted caller lines]"); }
};
$("micBtn").onmouseup = () => { if (rec && rec.state === "recording") { rec.stop(); $("micBtn").textContent = "Hold to talk"; } };

function t_lastCaller(txt) {
  const list = document.querySelectorAll("#transcript .turn.caller");
  const last = list[list.length - 1];
  if (last) last.textContent = "Caller: " + txt;
}
function blobToB64(b) {
  return new Promise((res) => { const r = new FileReader(); r.onloadend = () => res(r.result.split(",")[1]); r.readAsDataURL(b); });
}
