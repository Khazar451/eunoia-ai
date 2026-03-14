/**
 * server.js — Eunoia Clinical AI Backend
 *
 * LLM routing: Groq API (Llama 3.3 70B) → Ollama (local) → Built-in engine
 * Database: SQLite via better-sqlite3
 * The built-in engine guarantees the app works with zero configuration.
 */

"use strict";

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const fetch = require("node-fetch");
const db = require("./database");

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname)));

// ── Config ─────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
const GROQ_API_KEY = process.env.GROQ_API_KEY || "";
const GROQ_MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "llama3.1:8b";
const LLM_PROVIDER = process.env.LLM_PROVIDER || "auto";

const groqEnabled = GROQ_API_KEY && GROQ_API_KEY !== "your_groq_api_key_here";

// ── Trauma-Informed System Prompt ──────────────────────────────────────────

function buildSystemPrompt(user, patterns, sessions) {
  const patternStr = patterns.length
    ? patterns.slice(0, 8).map(p => `${p.pattern_type}: "${p.pattern_value}" (${p.frequency}x)`).join("; ")
    : "none recorded yet";

  const sessionStr = sessions.slice(-3).map((s, i) =>
    `Session ${i + 1}: ${s.summary || "no summary"} (${new Date(s.started_at).toLocaleDateString()})`
  ).join("\n  ") || "First session — no history yet";

  return `You are Eunoia, a deeply intelligent and empathetic conversational AI companion with profound psychotherapeutic knowledge.

CRITICAL INSTRUCTION - INTERNAL THINKING REQUIRED:
For EVERY message, you MUST first analyze the user internally using an <analysis> block. You must think about their emotional state, any underlying distress, and how best to respond tailored exactly to who they are.

FORMAT YOUR ENTIRE OUTPUT EXACTLY LIKE THIS:
<analysis>
- Analyze the user's text for underlying emotions, needs, or distress.
- Consult your psychological knowledge (Polyvagal, CBT, Trauma) if relevant.
- Plan how to respond (casual friend vs. supportive companion).
</analysis>
<response>
[Your actual response to the user goes here]
</response>

IDENTITY & TONE (FOR THE <response> BLOCK):
- Be highly conversational, casual, friendly, and human-like (like ChatGPT or Gemini).
- Use natural sentence structures, occasional exclamation marks, and a very human flow.
- DO NOT sound like a rigid therapist or a program reading a template.
- If the user is just chatting or asking casual questions, chat back casually!
- ONLY shift into a more supportive, clinical mode if you detect clear psychological distress (anxiety, depression, trauma).
- Even in clinical mode, stay incredibly warm and human. Use guided discovery (Socratic questioning) rather than giving advice or lecturing.
- Avoid hollow therapist clichés ("I hear you", "That's so valid", "I understand").

SAFETY:
- Crisis/self-harm language → immediately provide crisis resources gently.
- Dissociation/shutdown → suggest physical grounding (e.g., holding something cold).

USER PROFILE:
Name: ${user?.username || "Unknown"}
Previous sessions:
  ${sessionStr}
Recurring patterns detected previously: ${patternStr}
`;
}

// ── LLM Providers ──────────────────────────────────────────────────────────

async function checkOllama() {
  try {
    const r = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(2000) });
    return r.ok;
  } catch { return false; }
}

async function callOllama(messages, systemPrompt) {
  const r = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      messages: [{ role: "system", content: systemPrompt }, ...messages],
      stream: false,
      options: { temperature: 0.85, top_p: 0.9, num_predict: 512 }
    })
  });
  if (!r.ok) throw new Error(`Ollama ${r.status}`);
  const d = await r.json();
  return d.message?.content || d.response;
}

async function callGroq(messages, systemPrompt, retries = 2) {
  for (let i = 0; i <= retries; i++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 12000); // 12s timeout

      const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${GROQ_API_KEY}` },
        body: JSON.stringify({
          model: GROQ_MODEL,
          messages: [{ role: "system", content: systemPrompt }, ...messages],
          temperature: 0.85, max_tokens: 600, top_p: 0.9
        }),
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      const text = await r.text();
      let responseContent = null;
      try {
        const d = JSON.parse(text);
        const rawContent = d.choices?.[0]?.message?.content;
        if (rawContent) {
          // Extract everything between <response> and </response> if it exists
          const match = rawContent.match(/<response>([\s\S]*?)<\/response>/i);
          if (match && match[1]) {
            responseContent = match[1].trim();
          } else {
            // Fallback if the model forgot the tags but included analysis anyway
            const split = rawContent.split("</analysis>");
            if (split.length > 1) {
              responseContent = split[1].trim().replace(/^<response>/i, "");
            } else {
              responseContent = rawContent.trim();
            }
          }
        }
      } catch (parseErr) {
        throw new Error(`Failed to parse Groq response: ${text}`);
      }
      return responseContent;

    } catch (e) {
      if (i === retries) throw e;
      await new Promise(res => setTimeout(res, 1000)); // wait 1s on network errors
    }
  }
}

// ── Built-in Response Engine ───────────────────────────────────────────────
// Full contextual response generator — no external API needed.
// Reads the actual conversation and responds to it naturally.

function builtIn(messages, user, patterns) {
  const lastUser = [...messages].reverse().find(m => m.role === "user");
  if (!lastUser) return "I'm here. What's on your mind?";

  const raw = lastUser.content || "";
  const text = raw.toLowerCase().trim();
  const turn = messages.filter(m => m.role === "user").length;
  const name = user?.username || "there";
  const hr = new Date().getHours();
  const tg = hr < 12 ? "Good morning" : hr < 17 ? "Good afternoon" : "Good evening";
  const pat = patterns.slice(0, 3).map(p => p.pattern_value).join(", ");

  // ── Greeting ──────────────────────────────────────────────────────────────
  if (/^(hello|hi|hey|good (morning|afternoon|evening)|howdy|sup)\b/.test(text) && text.length < 50) {
    if (turn <= 1) {
      return (user?.session_count || 0) > 1
        ? `${tg}, ${name}. Good to have you back.\n\nWe covered some real ground last time${pat ? ` — around themes of ${pat}` : ""}. Things shift between sessions.\n\nHow are you doing right now, honestly?`
        : `${tg}, ${name}. Really glad you're here.\n\nNo agenda, no pressure. We can start wherever feels right.\n\nHow are you today?`;
    }
    return `Hey — how are you doing right now?`;
  }

  // ── Factual questions ───────────────────────────────────────────────────
  const isQuestion = text.includes("?") || /^(what|how|why|can you|is it|am i|are these|explain)/.test(text);

  if (isQuestion) {
    if (/anxiety/.test(text) && /(what|why|how|cause)/.test(text))
      return `Anxiety is your brain's threat-alarm firing. It evolved to help us survive — a surge of adrenaline sharpens your senses and prepares your body to fight or run.\n\nThe problem is your brain often can't tell the difference between a real physical danger and an emotional or social one. A difficult conversation can trigger the same physical response as actual danger.\n\nWhat does anxiety actually feel like for you — does it come in waves, or is it more of a constant hum?`;

    if (/(ptsd|post.traumatic|trauma)/.test(text) && /(what|how|why|cause)/.test(text))
      return `PTSD is what happens when the brain gets stuck trying to process a threatening experience. Normally memories lose their emotional charge over time — they become "past." With PTSD, that process breaks down. The memory stays "live" and the nervous system keeps responding to it as if it's happening now.\n\nThat's why triggers can feel so immediate and overwhelming — it's not weakness, it's a biology that got wired by experience.\n\nIs this something you're trying to understand about yourself, or someone else?`;

    if (/depress/.test(text) && /(what|why|how|cause)/.test(text))
      return `Depression is more than sadness — it's often a kind of greying out. Things that used to matter feel hollow. Motivation becomes hard to find. It can also be the nervous system going into "shutdown" mode after carrying too much for too long.\n\nNeurologically it involves real changes in mood, energy, and reward circuits. It's not a choice or weakness.\n\nDoes any of that match what you've been experiencing?`;

    if (/(normal|okay to feel|should i feel|is this okay)/.test(text))
      return `When we ask "is this normal?" we're usually asking "is something wrong with me?" The answer is almost always no. What you're feeling is completely understandable. Can you tell me a bit more about what you're dealing with?`;

    if (/(therapy|therapist|counseling|counselling|how does therapy)/.test(text))
      return `Therapy is just a safe space to think out loud about difficult things without judgment. It's about feeling heard and learning tools to navigate distress. What made you curious about it today?`;

    if (/(help me|what can you do|how can you help)/.test(text))
      return `I'm here to just chat, listen, and think through things with you. I won't tell you what to do, I'll just follow your lead. What's on your mind right now?`;

    return `That's a really good question, honestly. To give you the best answer, could you tell me a little bit more about what you mean?`;
  }

  // ── Crisis ───────────────────────────────────────────────────────────────
  const crisis = /(kill myself|end my life|want to die|suicidal|hurt myself|self.harm|cutting|overdose|don't want to live|better off dead|nobody would miss me|take my own life)/.test(text);
  if (crisis) {
    return `I need to pause here, because what you've shared matters deeply to me.\n\nWhat you're feeling right now is a signal that you need more support than this space alone can provide. **Please reach out to one of these right now:**\n\n🆘 Crisis Text Line (US): Text HOME to 741741\n📞 Samaritans (UK/IE): 116 123 (free, 24/7)\n📞 Lifeline (AU): 13 11 14\n🌐 findahelpline.com — global directory\n\nYou don't have to carry this alone. Your life has value. This moment is survivable.\n\nWhen you're safe and with proper support, I'll be right here.`;
  }

  // ── Emotions ─────────────────────────────────────────────────────────────
  const emap = {
    sad: ["sad", "crying", "tears", "heartbroken", "grief", "grieving", "lost", "miss", "missing", "hurt", "devastated"],
    angry: ["angry", "anger", "furious", "rage", "frustrated", "annoyed", "resentment", "hatred", "hate", "bitter"],
    scared: ["scared", "afraid", "fear", "terrified", "nervous", "worried", "anxious", "anxiety", "dread", "panicking", "panic"],
    ashamed: ["ashamed", "shame", "embarrassed", "humiliated", "guilty", "guilt", "worthless", "stupid", "pathetic", "disgusting"],
    lonely: ["lonely", "alone", "isolated", "no one", "nobody", "disconnected", "abandoned", "invisible", "unseen"],
    hopeless: ["hopeless", "no hope", "give up", "pointless", "nothing will change", "won't get better", "no point", "what's the point"],
    overwhelmed: ["overwhelmed", "too much", "can't cope", "can't handle", "breaking down", "falling apart", "drowning"],
    numb: ["numb", "empty", "nothing", "feel nothing", "hollow", "void", "flat", "grey", "checked out", "dead inside", "robot"]
  };

  for (const [emotion, markers] of Object.entries(emap)) {
    if (markers.some(m => text.includes(m))) {
      const er = {
        sad: `Sadness like that usually means something mattered deeply. I don't want to rush past it.\n\nCan you tell me more about what's underneath it? Is this something specific that happened, or more of a feeling that's been building?`,
        angry: `Anger almost always means something important was crossed — a boundary, a sense of fairness, something that mattered.\n\nI won't tell you it's wrong. I'm more curious: what do you think the anger is protecting right now? What's underneath it?`,
        scared: `Fear is real, and I won't minimize it. Your nervous system is sounding an alarm — and it usually has a reason, even when it's not immediately obvious what that reason is.\n\nWhat specifically feels threatening or scary right now?`,
        ashamed: `Shame is one of the most painful things to carry — it goes right to the core of how we see ourselves.\n\nI want you to know: shame is a feeling, not a fact. It often develops in response to things that happened to or around us, not because of who we fundamentally are.\n\nCan you tell me more about what you're feeling ashamed of? Naming it sometimes starts to loosen its grip.`,
        lonely: `Loneliness is one of the deepest pains there is. The need to feel seen and connected isn't weakness — it's one of the most fundamental human needs.\n\nI want to understand yours. Is this the loneliness of being physically alone, or more the kind where you're around people but still feel like nobody really knows you?`,
        hopeless: `When things have been hard for long enough, hopelessness can start to feel like the only realistic view — like hope itself is naive.\n\nI want to sit with that rather than argue with it. How long have you been feeling this way? And is there anything, even very small, that has felt even slightly different at any point?`,
        overwhelmed: `When everything stacks up at once, the mind and body can hit a kind of overload. That's not failure — it's a normal human response to too much for too long.\n\nLet's not try to solve it all right now. What's the single heaviest thing sitting on top of the pile?`,
        numb: `That flatness — where things that used to matter just don't reach you anymore — is its own kind of pain. Not dramatic, just grey.\n\nIt's often the nervous system doing something protective — dimming the emotional volume when it's been carrying too much for too long.\n\nWas there a specific point when this started, or did it creep in gradually?`
      };
      return er[emotion];
    }
  }

  // ── Cognitive distortions ─────────────────────────────────────────────────
  if (/(my fault|i'm to blame|i caused|i deserved|i should have|i failed|i'm broken|i'm worthless|i ruined|i'm the problem)/.test(text)) {
    return `I notice something in what you shared — there's a thread of self-blame running through it. That's incredibly common, especially after difficult experiences. Our minds try to make sense of painful things by finding a reason, and sometimes that reason lands on us.\n\nI'd like to explore that together rather than just accept it.\n\nIf a close friend described exactly this same situation — would you hold them responsible the same way you're holding yourself?`;
  }

  if (/(always|never|everything( is)?|nothing( ever)?|completely ruined|totally (?:lost|broken|ruined)|no one ever|nobody ever|forever (?:broken|lost|alone))/.test(text)) {
    return `I notice you're framing this in absolutes — "always," "never," "everything." When we're under real stress, the mind tends to narrow down to worst-case endpoints. It's a feature of how our brains work under pressure, not a reflection of reality.\n\nI'm not dismissing what you're feeling. But let me ask — what would "just okay" look like? Not perfect, just manageable. Can you picture any version of that?`;
  }

  // ── Reflect the specific content back ────────────────────────────────────
  const words = raw.replace(/[^a-zA-Z\s']/g, "").split(/\s+/);
  const stopw = new Set(["i", "me", "my", "the", "a", "an", "and", "or", "but", "is", "was", "are", "were", "it", "to", "of", "in", "that", "this", "with", "for", "on", "at", "by", "just", "so", "very", "not", "do", "did", "have", "he", "she", "they", "we", "you", "what", "when", "how", "why", "which", "from", "been", "be", "can", "will", "would", "could", "should", "really", "there", "their", "here"]);
  const kws = words.filter(w => w.length > 3 && !stopw.has(w.toLowerCase())).slice(0, 3);
  const kwStr = kws.length ? `"${kws.slice(0, 2).join(" ")}"` : "what you shared";
  const sentences = raw.split(/[.!?]+/).map(s => s.trim()).filter(s => s.length > 10);
  const longest = sentences.sort((a, b) => b.length - a.length)[0];

  const reflective = [
    longest ? `"${longest.slice(0, 90)}${longest.length > 90 ? "..." : ""}" — I want to stay with that. What's underneath that for you?` : `What you just said — can you say more about it? I want to make sure I actually understand.`,
    `When you say ${kwStr}, what does that feel like? Is it more of a thought, or does it land somewhere in your body as well?`,
    `I'm sitting with what you just shared. What feels most important about it to you right now?`,
    `That matters. Can you say more about ${kwStr}? I want to make sure I really understand what you mean.`,
    `I hear you. What's the part of this that weighs on you the most?`,
    `What's underneath that, if you go one layer deeper? What's the feeling behind what you just described?`
  ];

  return reflective[turn % reflective.length];
}

// ── LLM Routing ────────────────────────────────────────────────────────────

async function getLLMResponse(conversationHistory, systemPrompt, user, patterns) {
  // Groq (if key set)
  if (groqEnabled) {
    try { return { text: await callGroq(conversationHistory, systemPrompt), provider: "groq" }; }
    catch (e) { console.warn("Groq failed:", e.message); }
  }

  // Ollama (if running locally)
  if (LLM_PROVIDER !== "groq") {
    const ollamaOk = await checkOllama();
    if (ollamaOk) {
      try { return { text: await callOllama(conversationHistory, systemPrompt), provider: "ollama" }; }
      catch (e) { console.warn("Ollama failed:", e.message); }
    }
  }

  // Built-in engine — always works
  return { text: builtIn(conversationHistory, user, patterns), provider: "built-in" };
}

// ── REST API ───────────────────────────────────────────────────────────────

// POST /api/users/login
app.post("/api/users/login", async (req, res) => {
  const { username, pin } = req.body;
  if (!username || !pin) return res.status(400).json({ error: "username and pin required" });
  try {
    let user = await db.getUserByUsername(username);
    if (user) {
      if (user.pin !== String(pin))
        return res.status(401).json({ error: "Incorrect PIN. Please try again." });
      await db.updateUserLastSeen(user.id);
      return res.json({ user, sessions: await db.getUserSessions(user.id, 5), returning: true });
    }
    user = await db.createUser(uuidv4(), username, String(pin));
    return res.json({ user, sessions: [], returning: false });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/sessions
app.post("/api/sessions", async (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: "userId required" });
  try {
    const session = await db.createSession(uuidv4(), userId);
    res.json({ session });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/sessions/:id/messages
app.get("/api/sessions/:id/messages", async (req, res) => {
  try { res.json({ messages: await db.getSessionMessages(req.params.id) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// PATCH /api/sessions/:id
app.patch("/api/sessions/:id", async (req, res) => {
  const { phase, summary, distortions, symptoms, turnCount } = req.body;
  try {
    await db.closeSession(req.params.id, phase, summary, distortions, symptoms);
    if (turnCount != null) await db.updateSessionPhase(req.params.id, phase, turnCount);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/users/:id/profile
app.get("/api/users/:id/profile", async (req, res) => {
  try {
    const user = await db.getUserById(req.params.id);
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json({ user, sessions: await db.getUserSessions(user.id, 10), patterns: await db.getUserPatterns(user.id) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/admin/users
app.get("/api/admin/users", async (req, res) => {
  try {
    const users = await db.getAllUsers();
    res.json({ users });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/admin/users/:id/sessions
app.get("/api/admin/users/:id/sessions", async (req, res) => {
  try {
    const sessions = await db.getUserSessions(req.params.id, 500); // Up to 500 sessions
    res.json({ sessions });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/admin/sessions/:id/messages
app.get("/api/admin/sessions/:id/messages", async (req, res) => {
  try {
    const messages = await db.getSessionMessages(req.params.id);
    res.json({ messages });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/admin/sessions/:id/kick
app.post("/api/admin/sessions/:id/kick", async (req, res) => {
  try {
    await db.killSession(req.params.id);
    
    // As a bonus, we log an AI response stating the session was severed.
    const session = await db.getSession(req.params.id);
    if (session) {
      await db.saveMessage(session.id, session.user_id, "assistant", "*(System: This session was forcibly terminated by an administrator.)*", "window_of_tolerance", [], []);
    }
    
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/chat — main chat endpoint
app.post("/api/chat", async (req, res) => {
  const { userId, sessionId, message, clinicalContext = {} } = req.body;
  if (!userId || !sessionId || !message)
    return res.status(400).json({ error: "userId, sessionId, message required" });

  try {
    const user = await db.getUserById(userId);
    if (!user) return res.status(404).json({ error: "User not found" });

    const patterns = await db.getUserPatterns(userId);
    const sessions = await db.getUserSessions(userId, 5);
    const recentMsgs = await db.getRecentUserMessages(userId, 30);

    // Build system prompt + clinical context note
    let systemPrompt = buildSystemPrompt(user, patterns, sessions);
    if (clinicalContext.arousalState && clinicalContext.arousalState !== "window_of_tolerance") {
      systemPrompt += `\n[CLINICAL ALERT] Arousal: ${clinicalContext.arousalState}. `;
      systemPrompt += clinicalContext.arousalState === "hyperarousal"
        ? "Prioritize grounding before processing." : "Gentle bilateral grounding first.";
    }
    if (clinicalContext.distortions?.length)
      systemPrompt += `\n[COGNITIVE PATTERNS] Detected: ${clinicalContext.distortions.join(", ")}. Use Socratic questions.`;
    if (clinicalContext.symptoms?.length)
      systemPrompt += `\n[TRAUMA SYMPTOMS] Detected: ${clinicalContext.symptoms.join(", ")}. Normalize, don't pathologize.`;

    // Conversation history for LLM (Sanitized for Llama 3 alternating roles requirement)
    let history = [
      ...recentMsgs.slice(-20).map(m => ({ role: m.role, content: m.content })),
      { role: "user", content: message }
    ];

    // Collapse consecutive roles (e.g. user -> user stringed together)
    const sanitizedHistory = [];
    for (const msg of history) {
      if (sanitizedHistory.length > 0 && sanitizedHistory[sanitizedHistory.length - 1].role === msg.role) {
        sanitizedHistory[sanitizedHistory.length - 1].content += "\n\n" + msg.content;
      } else {
        sanitizedHistory.push(msg);
      }
    }
    history = sanitizedHistory;

    // Persist user message
    await db.saveMessage(sessionId, userId, "user", message,
      clinicalContext.arousalState, clinicalContext.distortions, clinicalContext.symptoms);

    // Record clinical patterns
    if (clinicalContext.distortions) {
      for (const d of clinicalContext.distortions) await db.recordPattern(userId, "cognitive_distortion", d);
    }
    if (clinicalContext.symptoms) {
      for (const s of clinicalContext.symptoms) await db.recordPattern(userId, "symptom_cluster", s);
    }
    if (clinicalContext.arousalState && clinicalContext.arousalState !== "window_of_tolerance") {
      await db.recordPattern(userId, "arousal_state", clinicalContext.arousalState);
    }

    // Get response
    const { text: aiResponse, provider } = await getLLMResponse(history, systemPrompt, user, patterns);

    // Persist AI response + update session
    await db.saveMessage(sessionId, userId, "assistant", aiResponse, "window_of_tolerance", [], []);
    await db.updateSessionPhase(sessionId, clinicalContext.phase || "work", clinicalContext.turnCount || 0);

    res.json({ response: aiResponse, provider });

  } catch (e) {
    console.error("Chat error:", e);
    res.status(500).json({ error: "Server error", detail: e.message });
  }
});

// ── Start ──────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`\n🧠 Eunoia Clinical AI running on http://localhost:${PORT}`);
  console.log(`📂 Database: eunoia.db`);
  console.log(groqEnabled ? `✅ Groq enabled (${GROQ_MODEL})` : `⚠️  No Groq key — using built-in engine`);
  console.log(`🔍 LLM provider: ${LLM_PROVIDER}\n`);
});
