/**
 * app.js v2 — Eunoia Frontend Controller
 *
 * Architecture:
 *   - User login/registration via /api/users/login
 *   - Messages sent to /api/chat (real LLM — Ollama or Groq)
 *   - engine.js still runs locally for: crisis detection, arousal state,
 *     grounding sequences, and cognitive distortion detection
 *   - All results are injected as clinical context into the LLM API call
 *   - Falls back to engine.js responses if backend is unreachable
 */

"use strict";

const API_BASE = window.location.origin; // same origin as server

// ── DOM refs ─────────────────────────────────────────────────────────────
const loginModal = document.getElementById("login-modal");
const loginUsernameEl = document.getElementById("login-username");
const loginPinEl = document.getElementById("login-pin");
const loginBtn = document.getElementById("login-btn");
const loginError = document.getElementById("login-error");
const loginServerWarn = document.getElementById("login-server-warn");
const disclaimerModal = document.getElementById("disclaimer-modal");
const disclaimerTitle = document.getElementById("disclaimer-title");
const disclaimerIcon = document.getElementById("disclaimer-icon");
const acceptDisclaimerBtn = document.getElementById("accept-disclaimer-btn");
const sessionSummaryModal = document.getElementById("session-summary-modal");
const summaryContent = document.getElementById("summary-content");
const closeSummaryBtn = document.getElementById("close-summary-btn");
const newSessionFromSummaryBtn = document.getElementById("new-session-from-summary-btn");
const chatMessages = document.getElementById("chat-messages");
const userInput = document.getElementById("user-input");
const sendBtn = document.getElementById("send-btn");
const phaseIndicator = document.getElementById("phase-indicator");
const arousalIndicator = document.getElementById("arousal-indicator");
const sessionTimer = document.getElementById("session-timer");
const newSessionBtn = document.getElementById("new-session-btn");
const switchUserBtn = document.getElementById("switch-user-btn");
const typingIndicator = document.getElementById("typing-indicator");
const inputArea = document.getElementById("input-area");
const sidebarToggle = document.getElementById("sidebar-toggle");
const sidebar = document.getElementById("sidebar");
const userPanel = document.getElementById("user-panel");
const sidebarUsername = document.getElementById("sidebar-username");
const sessionCountEl = document.getElementById("session-count-display");
const lastVisitEl = document.getElementById("last-visit-display");

// ── State ─────────────────────────────────────────────────────────────────
let currentUser = null;
let currentSession = null;
let sessionTimerInterval = null;
let sessionSeconds = 0;
let isTyping = false;
let backendOnline = false;
let engine = null; // local engine instance

// ── Phase / Arousal labels ────────────────────────────────────────────────
const PHASE_LABELS = {
  check_in: { label: "Check-In", icon: "🌱", color: "#6ee7b7" },
  bridge: { label: "Bridge", icon: "🌉", color: "#93c5fd" },
  work: { label: "Work Phase", icon: "🔍", color: "#c4b5fd" },
  cool_down: { label: "Cool-Down", icon: "🌊", color: "#6ee7b7" },
  closed: { label: "Closed", icon: "🔒", color: "#f87171" }
};
const AROUSAL_LABELS = {
  window_of_tolerance: { label: "Within Window", color: "#6ee7b7", icon: "✅" },
  hyperarousal: { label: "Hyperarousal", color: "#fbbf24", icon: "⚡" },
  hypoarousal: { label: "Hypoarousal", color: "#93c5fd", icon: "❄️" }
};

// ── Init ──────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async () => {
  // Check if backend is running
  backendOnline = await checkBackend();
  if (!backendOnline) loginServerWarn.style.display = "block";

  // Initialize local safety engine
  engine = new TraumaInformedClinicalEngine();

  // Login flow
  loginBtn.addEventListener("click", handleLogin);
  loginPinEl.addEventListener("keydown", e => { if (e.key === "Enter") handleLogin(); });
  loginUsernameEl.addEventListener("keydown", e => { if (e.key === "Enter") loginPinEl.focus(); });

  // After disclaimer
  acceptDisclaimerBtn.addEventListener("click", () => {
    disclaimerModal.classList.add("hidden");
    startSession();
  });

  sendBtn.addEventListener("click", handleSend);
  userInput.addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  });
  userInput.addEventListener("input", () => {
    userInput.style.height = "auto";
    userInput.style.height = Math.min(userInput.scrollHeight, 160) + "px";
  });

  newSessionBtn.addEventListener("click", endSession);
  switchUserBtn.addEventListener("click", switchUser);
  closeSummaryBtn.addEventListener("click", () => sessionSummaryModal.classList.add("hidden"));
  newSessionFromSummaryBtn.addEventListener("click", () => {
    sessionSummaryModal.classList.add("hidden");
    clearChatAndRestart();
  });
  sidebarToggle.addEventListener("click", () => sidebar.classList.toggle("open"));

  updatePhaseUI("check_in");
  updateArousalUI("window_of_tolerance");
});

// ── Backend health check ──────────────────────────────────────────────────
async function checkBackend() {
  try {
    const res = await fetch(`${API_BASE}/api/users/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "__healthcheck__", pin: "0000" }),
      signal: AbortSignal.timeout(2000)
    });
    return res.status !== 0; // Any real response = server online
  } catch { return false; }
}

// ── Login ─────────────────────────────────────────────────────────────────
async function handleLogin() {
  const username = loginUsernameEl.value.trim();
  const pin = loginPinEl.value.trim();

  loginError.classList.add("hidden");

  if (!username) return showLoginError("Please enter your name.");
  if (!pin || pin.length !== 4 || !/^\d+$/.test(pin)) {
    return showLoginError("PIN must be exactly 4 digits.");
  }

  loginBtn.disabled = true;
  loginBtn.textContent = "Connecting…";

  if (backendOnline) {
    try {
      const res = await fetch(`${API_BASE}/api/users/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, pin })
      });
      const data = await res.json();
      if (!res.ok) return showLoginError(data.error || "Login failed.");

      currentUser = data.user;
      loginModal.classList.add("hidden");
      showDisclaimer(data.returning, data.user);
    } catch (err) {
      showLoginError("Server error. " + err.message);
    }
  } else {
    // Offline mode — use localStorage
    const stored = localStorage.getItem(`eunoia_user_${username}`);
    if (stored) {
      const saved = JSON.parse(stored);
      if (saved.pin !== pin) return showLoginError("Incorrect PIN.");
      currentUser = saved;
    } else {
      currentUser = {
        id: `local_${Date.now()}`,
        username,
        pin,
        created_at: Date.now(),
        session_count: 0
      };
      localStorage.setItem(`eunoia_user_${username}`, JSON.stringify(currentUser));
    }
    loginModal.classList.add("hidden");
    showDisclaimer(!!stored, currentUser);
  }

  loginBtn.disabled = false;
  loginBtn.textContent = "Continue →";
}

function showLoginError(msg) {
  loginError.textContent = msg;
  loginError.classList.remove("hidden");
  loginBtn.disabled = false;
  loginBtn.textContent = "Continue →";
}

function showDisclaimer(returning, user) {
  if (returning) {
    disclaimerIcon.textContent = "👋";
    disclaimerTitle.textContent = `Welcome back, ${user.username}`;
    disclaimerIcon.nextElementSibling.textContent = `Welcome back, ${user.username}`;
    disclaimerTitle.textContent = `Welcome back, ${user.username}`;
  } else {
    disclaimerIcon.textContent = "🌱";
    disclaimerTitle.textContent = `Nice to meet you, ${user.username}`;
  }

  // Update sidebar
  sidebarUsername.textContent = `${user.username} · Eunoia v2`;
  if (user.session_count !== undefined) {
    userPanel.style.display = "block";
    sessionCountEl.textContent = user.session_count || 0;
    lastVisitEl.textContent = user.last_seen
      ? new Date(user.last_seen).toLocaleDateString()
      : "Today (first visit)";
  }

  disclaimerModal.classList.remove("hidden");
}

// ── Session start ─────────────────────────────────────────────────────────
async function startSession() {
  startTimer();
  engine = new TraumaInformedClinicalEngine();

  if (backendOnline && currentUser) {
    try {
      const res = await fetch(`${API_BASE}/api/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: currentUser.id })
      });
      const data = await res.json();
      currentSession = data.session;
    } catch (err) {
      console.warn("Could not create session:", err);
    }
  }

  // Get opening greeting from LLM (or local engine)
  setTyping(true);
  await sleep(800);
  const greeting = await sendToLLM("Hello, I'm here and ready to talk.", {
    arousalState: "window_of_tolerance",
    phase: "check_in",
    distortions: [],
    symptoms: [],
    turnCount: 0
  });
  setTyping(false);
  appendMessage("assistant", greeting);
}

// ── Message send ──────────────────────────────────────────────────────────
async function handleSend() {
  const text = userInput.value.trim();
  if (!text || isTyping) return;

  userInput.value = "";
  userInput.style.height = "auto";
  appendMessage("user", text);
  setTyping(true);

  // Run local engine for safety/clinical detection
  const engineResult = engine.process(text);
  const { arousalState, phase, flags } = engineResult;

  updatePhaseUI(phase);
  updateArousalUI(arousalState);

  // Crisis → use engine's crisis response (hardcoded safety, no LLM)
  if (flags.crisis) {
    setTyping(false);
    appendMessage("assistant", engineResult.response, { crisis: true });
    lockInputAfterCrisis();
    return;
  }

  // Grounding → engine handles this locally (no LLM)
  if (flags.groundingActivated || flags.groundingInProgress) {
    setTyping(false);
    appendMessage("assistant", engineResult.response, { grounding: true });
    showGroundingBanner(arousalState);
    return;
  }

  hideGroundingBanner();

  // Send to LLM
  const clinicalContext = {
    arousalState,
    phase,
    distortions: flags.distortions || [],
    symptoms: flags.symptoms || [],
    turnCount: engine.turnCount
  };

  const response = await sendToLLM(text, clinicalContext);
  setTyping(false);
  appendMessage("assistant", response);
}

// ── LLM API call ──────────────────────────────────────────────────────────
async function sendToLLM(message, clinicalContext) {
  if (backendOnline && currentUser && currentSession) {
    try {
      const res = await fetch(`${API_BASE}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: currentUser.id,
          sessionId: currentSession.id,
          message,
          clinicalContext
        })
      });

      if (res.ok) {
        const data = await res.json();
        return data.response;
      } else {
        const err = await res.json();
        if (err.fallback) return err.fallback;
      }
    } catch (err) {
      console.warn("Backend chat failed, using local engine:", err.message);
    }
  }

  // Fallback: local engine response
  return engine.process(message).response;
}

// ── Message rendering ─────────────────────────────────────────────────────
function appendMessage(role, content, flags = {}) {
  // Remove typing indicator from DOM before adding message
  const typing = document.getElementById("typing-indicator");
  chatMessages.removeChild(typing);

  const wrapper = document.createElement("div");
  wrapper.classList.add("message", role === "user" ? "user-message" : "assistant-message");
  if (flags.crisis) wrapper.classList.add("crisis-message");
  if (flags.grounding) wrapper.classList.add("grounding-message");

  const bubble = document.createElement("div");
  bubble.classList.add("bubble");
  bubble.innerHTML = renderMarkdown(content);

  const timestamp = document.createElement("span");
  timestamp.classList.add("msg-time");
  timestamp.textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  wrapper.appendChild(bubble);
  wrapper.appendChild(timestamp);
  chatMessages.appendChild(wrapper);
  chatMessages.appendChild(typing); // put typing indicator back at end

  requestAnimationFrame(() => wrapper.classList.add("visible"));
  scrollToBottom();
}

function renderMarkdown(text) {
  text = text.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
  text = text.replace(/\*(.*?)\*/g, "<em>$1</em>");
  text = text.replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
  text = text.replace(/^(🆘|📞|🌐)/gm, "<span class='resource-icon'>$1</span>");
  text = text.replace(/\n\n/g, "</p><p>");
  text = text.replace(/\n/g, "<br>");
  return `<p>${text}</p>`;
}

// ── Typing indicator ──────────────────────────────────────────────────────
function setTyping(active) {
  isTyping = active;
  typingIndicator.classList.toggle("hidden", !active);
  sendBtn.disabled = active;
  userInput.disabled = active;
  if (active) scrollToBottom();
}

// ── UI Updates ────────────────────────────────────────────────────────────
function updatePhaseUI(phase) {
  const info = PHASE_LABELS[phase] || PHASE_LABELS.check_in;
  const label = `${info.icon} ${info.label}`;
  phaseIndicator.textContent = label;
  phaseIndicator.style.color = info.color;
  const h = document.getElementById("header-phase-indicator");
  if (h) { h.textContent = label; h.style.color = info.color; }
}

function updateArousalUI(state) {
  const info = AROUSAL_LABELS[state] || AROUSAL_LABELS.window_of_tolerance;
  const label = `${info.icon} ${info.label}`;
  arousalIndicator.textContent = label;
  arousalIndicator.style.color = info.color;
  const h = document.getElementById("header-arousal-indicator");
  if (h) { h.textContent = label; h.style.color = info.color; }

  document.querySelectorAll(".pv-row").forEach(r => r.classList.remove("active"));
  if (state === "hyperarousal") document.getElementById("pv-hyperarousal")?.classList.add("active");
  else if (state === "hypoarousal") document.getElementById("pv-hypoarousal")?.classList.add("active");
  else document.getElementById("pv-window")?.classList.add("active");

  const bar = document.getElementById("arousal-bar-fill");
  if (bar) {
    if (state === "hyperarousal") {
      bar.style.width = "90%"; bar.style.background = "linear-gradient(90deg,#fbbf24,#f87171)";
    } else if (state === "hypoarousal") {
      bar.style.width = "15%"; bar.style.background = "linear-gradient(90deg,#93c5fd,#6ee7b7)";
    } else {
      bar.style.width = "50%"; bar.style.background = "linear-gradient(90deg,#6ee7b7,#a78bfa)";
    }
  }
}

function showGroundingBanner(type) {
  const b = document.getElementById("grounding-banner");
  if (b) {
    b.classList.remove("hidden");
    // Only update text if it's explicitly hyper or hypo. Otherwise keep the existing text.
    if (type === "hyperarousal") {
      b.textContent = "⚡ High arousal detected — Grounding protocol activated";
    } else if (type === "hypoarousal") {
      b.textContent = "❄️ Shutdown response detected — Bilateral grounding initiated";
    }
  }
}

function hideGroundingBanner() {
  document.getElementById("grounding-banner")?.classList.add("hidden");
}

function lockInputAfterCrisis() {
  userInput.disabled = true;
  sendBtn.disabled = true;
  inputArea.classList.add("locked");
  const msg = document.createElement("p");
  msg.classList.add("crisis-lock-msg");
  msg.innerHTML = "💛 This session has been paused to prioritize your safety. Please reach out to a crisis line above.";
  inputArea.appendChild(msg);
}

// ── Session management ────────────────────────────────────────────────────
async function endSession() {
  const summary = engine.getSessionSummary();
  clearInterval(sessionTimerInterval);

  if (backendOnline && currentSession) {
    try {
      await fetch(`${API_BASE}/api/sessions/${currentSession.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phase: summary.phase,
          summary: `${summary.turns} turns. Distortions: ${summary.distortionsWorked}. Symptoms: ${summary.symptomsAddressed}.`,
          distortions: summary.distortionsWorked,
          symptoms: summary.symptomsAddressed,
          turnCount: summary.turns
        })
      });
    } catch (err) { console.warn("Could not save session:", err); }
  }

  showSessionSummary(summary);
}

function showSessionSummary(summary) {
  const phaseInfo = PHASE_LABELS[summary.phase] || PHASE_LABELS.check_in;
  summaryContent.innerHTML = `
    <div class="summary-grid">
      <div class="summary-item"><span class="summary-label">Duration</span><span class="summary-value">${summary.durationMinutes} min</span></div>
      <div class="summary-item"><span class="summary-label">Exchanges</span><span class="summary-value">${summary.turns}</span></div>
      <div class="summary-item"><span class="summary-label">Final Phase</span><span class="summary-value">${phaseInfo.icon} ${phaseInfo.label}</span></div>
      <div class="summary-item"><span class="summary-label">Arousal State</span><span class="summary-value">${AROUSAL_LABELS[summary.finalArousalState]?.label || "—"}</span></div>
      <div class="summary-item wide"><span class="summary-label">Cognitive Patterns Explored</span><span class="summary-value capitalize">${summary.distortionsWorked}</span></div>
      <div class="summary-item wide"><span class="summary-label">Symptom Clusters Addressed</span><span class="summary-value capitalize">${summary.symptomsAddressed}</span></div>
      ${summary.anhedoniaPresent ? `<div class="summary-item wide anhedonia-flag"><span class="summary-label">⚠️ Note</span><span class="summary-value">Anhedonia indicators were present. Consider monitoring in future sessions.</span></div>` : ""}
    </div>
  `;
  sessionSummaryModal.classList.remove("hidden");
}

function clearChatAndRestart() {
  chatMessages.innerHTML = `
    <div id="typing-indicator" class="hidden">
      <div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div>
    </div>`;
  sessionSeconds = 0;
  startSession();
}

function switchUser() {
  clearInterval(sessionTimerInterval);
  currentUser = null;
  currentSession = null;
  chatMessages.innerHTML = `
    <div id="typing-indicator" class="hidden">
      <div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div>
    </div>`;
  loginUsernameEl.value = "";
  loginPinEl.value = "";
  loginError.classList.add("hidden");
  loginModal.classList.remove("hidden");
}

// ── Timer ─────────────────────────────────────────────────────────────────
function startTimer() {
  sessionSeconds = 0;
  clearInterval(sessionTimerInterval);
  sessionTimerInterval = setInterval(() => {
    sessionSeconds++;
    const m = String(Math.floor(sessionSeconds / 60)).padStart(2, "0");
    const s = String(sessionSeconds % 60).padStart(2, "0");
    sessionTimer.textContent = `${m}:${s}`;
  }, 1000);
}

// ── Utilities ─────────────────────────────────────────────────────────────
function scrollToBottom() {
  chatMessages.scrollTo({ top: chatMessages.scrollHeight, behavior: "smooth" });
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
