/**
 * Trauma-Informed Clinical Engine (TICE) v2
 *
 * The engine reads what the user actually says and replies to it directly.
 * Psychotherapeutic frameworks (Polyvagal Theory, DSM-5-TR, Socratic CBT)
 * operate as an invisible clinical lens — not as a rigid script.
 *
 * Architecture:
 *   1. Safety layer  — crisis / red-line detection (always first)
 *   2. Arousal layer — Window of Tolerance check; grounding if needed
 *   3. Content layer — understand what the user said, reply to it naturally
 *   4. Clinical layer — weave in therapeutic framing where genuinely relevant
 */

"use strict";

// ─────────────────────────────────────────────
//  CONSTANTS & LEXICONS
// ─────────────────────────────────────────────

const HYPERAROUSAL_MARKERS = [
  "can't breathe", "cannot breathe", "heart racing", "terrified",
  "shaking", "trembling", "out of control", "spiraling", "losing it",
  "freaking out", "heart pounding", "hyperventilating", "hyperventilat",
  "going crazy", "can't stop crying", "everything is falling apart",
  "suffocating", "help me", "please help", "i need help now"
];

const HYPOAROUSAL_MARKERS = [
  "feel nothing", "disconnected", "not real",
  "can't feel", "shutdown", "detached", "zoned out",
  "dissociating", "dissociated", "dissociat", "floating", "dead inside",
  "don't care anymore", "what's the point", "disappear",
  "checked out", "spacing out"
];

const CRISIS_MARKERS = [
  "kill myself", "end my life", "want to die", "suicidal", "suicide",
  "hurt myself", "self-harm", "self harm", "cutting myself", "overdose",
  "don't want to live", "rather be dead", "not worth living",
  "goodbye forever", "no reason to live", "ending it all",
  "harm myself", "harming myself", "can't go on", "won't survive this",
  "nobody would miss me", "better off without me", "take my own life"
];

const ANHEDONIA_MARKERS = [
  "nothing brings me joy", "lost interest", "used to enjoy", "don't enjoy",
  "can't enjoy", "nothing matters", "stopped caring", "no pleasure",
  "flat", "grey", "colorless", "pointless", "why bother", "meaningless",
  "going through the motions", "just existing", "not living"
];

const COGNITIVE_DISTORTIONS = {
  catastrophizing: [
    "always", "never", "everything", "nothing", "worst", "disaster",
    "ruined", "completely", "totally", "absolutely", "forever", "hopeless"
  ],
  selfBlame: [
    "my fault", "i'm to blame", "i caused", "i deserved", "it's because of me",
    "i should have", "if only i", "i ruined", "i failed", "i'm broken",
    "i'm worthless", "i'm damaged", "i'm bad", "i'm the problem"
  ],
  mindReading: [
    "they think", "everyone thinks", "they must", "they probably",
    "they hate", "nobody likes", "they all", "he thinks i'm", "she thinks i'm"
  ],
  fortuneTelling: [
    "will never", "it's never going to", "nothing will change", "i'll always",
    "it's pointless", "won't get better", "can't be fixed"
  ]
};

const TRAUMA_SYMPTOM_CLUSTERS = {
  intrusion: [
    "flashback", "nightmare", "intrusive", "can't stop thinking", "keeps coming back",
    "images", "memories", "reliving", "triggered", "haunted"
  ],
  avoidance: [
    "avoid", "can't go back", "stay away", "don't want to think", "trying not to",
    "block it out", "push it down", "suppress", "pretend", "ignore"
  ],
  negativeCognitions: [
    "trust no one", "world is dangerous", "not safe", "it's all my fault",
    "permanently changed", "can't feel", "ruined", "tainted"
  ],
  hyperarousal: [
    "on edge", "jumpy", "startle", "vigilant", "scan", "can't sleep",
    "irritable", "angry outburst", "reckless", "concentration"
  ]
};

const AFFILIATIVE_PHRASES = [
  "I hear you.",
  "Thank you for trusting me with that.",
  "That took courage to share.",
  "You're not alone in this.",
  "What you're describing makes complete sense given what you've been through.",
  "That is a completely understandable response.",
  "Many people who have experienced similar things feel exactly that way.",
  "I want you to know this is a safe space."
];

const SOCRATIC_QUESTIONS = {
  selfBlame: [
    "If a close friend described exactly this same situation to you, would you hold them responsible in the same way?",
    "What were all the factors at play in that moment — things beyond your control?",
    "What evidence supports that belief, and what evidence might challenge it?",
    "When you hold yourself responsible, whose voice does that sound like to you?"
  ],
  catastrophizing: [
    "What would 'just okay' look like — not perfect, just manageable?",
    "Have you navigated something that felt this impossible before? What did that look like?",
    "On a scale of 0–10, where is the evidence for that outcome sitting right now?",
    "What is the most realistic, middle-ground outcome you can imagine?"
  ],
  fortuneTelling: [
    "How much of the future can any of us actually know?",
    "What small thing, even tiny, has shifted in the past that surprised you?",
    "What would need to be true for just a small amount of change to be possible?"
  ],
  mindReading: [
    "What direct information do you have about what they're thinking?",
    "Could there be other explanations for what you observed?",
    "What would you need to do to test that assumption?"
  ]
};

// ─────────────────────────────────────────────
//  SESSION STATE MACHINE
// ─────────────────────────────────────────────

const SESSION_PHASES = {
  CHECK_IN: "check_in",
  BRIDGE: "bridge",
  WORK: "work",
  COOL_DOWN: "cool_down",
  CLOSED: "closed"
};

const AROUSAL_STATES = {
  HYPOAROUSAL: "hypoarousal",       // Dorsal Vagal — shutdown/numbing
  WINDOW: "window_of_tolerance",   // Ventral Vagal — optimal
  HYPERAROUSAL: "hyperarousal"      // Sympathetic — fight/flight
};

// ─────────────────────────────────────────────
//  MAIN ENGINE CLASS
// ─────────────────────────────────────────────

class TraumaInformedClinicalEngine {
  constructor() {
    this.sessionPhase = SESSION_PHASES.CHECK_IN;
    this.arousalState = AROUSAL_STATES.WINDOW;
    this.sessionHistory = [];          // full message log
    this.affectLog = [];               // arousal state per turn
    this.detectedDistortions = [];
    this.detectedSymptoms = [];
    this.turnCount = 0;
    this.sessionStartTime = Date.now();
    this.groundingInProgress = false;
    this.groundingStep = 0;
    this.coolDownInitiated = false;
    this.previousSessionSummary = null; // for Bridge phase
    this.anhedoniaFlagged = false;
    this.crisisDetected = false;
  }

  // ── Entry point ─────────────────────────────
  /**
   * Process a user message and return the therapist response object.
   * @param {string} userInput
   * @returns {{ response: string, arousalState: string, phase: string, flags: object }}
   */
  process(userInput) {
    this.turnCount++;
    const normalized = userInput.toLowerCase();

    // 1. Crisis check — always first
    if (this._detectCrisis(normalized)) {
      this.crisisDetected = true;
      this.sessionPhase = SESSION_PHASES.CLOSED;
      return this._buildResult(this._crisisResponse(), { crisis: true });
    }

    // 2. Arousal state detection
    this.arousalState = this._detectArousalState(normalized);
    this.affectLog.push({ turn: this.turnCount, state: this.arousalState });

    // 3. Log to session history
    this.sessionHistory.push({ role: "user", content: userInput, arousal: this.arousalState });

    // 4. If hyperarousal or hypoarousal detected — pivot to stabilization
    if (
      (this.arousalState === AROUSAL_STATES.HYPERAROUSAL || this.arousalState === AROUSAL_STATES.HYPOAROUSAL)
      && !this.groundingInProgress
    ) {
      this.groundingInProgress = true;
      this.groundingStep = 0;
      const groundingResponse = this._initiateGrounding();
      this.sessionHistory.push({ role: "assistant", content: groundingResponse });
      return this._buildResult(groundingResponse, { groundingActivated: true, arousalState: this.arousalState });
    }

    // 5. If grounding is in progress, continue grounding sequence
    if (this.groundingInProgress) {
      const groundingResponse = this._continueGrounding(normalized);
      if (groundingResponse !== null) {
        this.sessionHistory.push({ role: "assistant", content: groundingResponse });
        return this._buildResult(groundingResponse, { groundingInProgress: true });
      } else {
        // Grounding complete — return to normal flow
        this.groundingInProgress = false;
        this.groundingStep = 0;
      }
    }

    // 6. Detect cognitive distortions
    const distortions = this._detectDistortions(normalized);
    if (distortions.length) {
      this.detectedDistortions.push(...distortions);
    }

    // 7. Detect trauma symptom clusters
    const symptoms = this._detectSymptomClusters(normalized);
    if (symptoms.length) {
      this.detectedSymptoms.push(...symptoms);
    }

    // 8. Anhedonia detection
    const anhedonia = this._detectAnhedonia(normalized);
    if (anhedonia && !this.anhedoniaFlagged) {
      this.anhedoniaFlagged = true;
    }

    // 9. Advance session phase
    this._advancePhase();

    // 10. Generate therapeutic response
    const response = this._generateResponse(userInput, normalized, distortions, symptoms, anhedonia);
    this.sessionHistory.push({ role: "assistant", content: response });

    return this._buildResult(response, {
      distortions,
      symptoms,
      anhedonia,
      arousalState: this.arousalState,
      phase: this.sessionPhase
    });
  }

  // ── Crisis detection ────────────────────────
  _detectCrisis(text) {
    return CRISIS_MARKERS.some(m => text.includes(m));
  }

  _crisisResponse() {
    return `I need to pause for a moment, because what you've just shared is very important to me.

What you're feeling right now is a signal that you need more support than I can provide alone. **You don't have to carry this alone.**

**Please reach out to one of these resources right now:**

🆘 **International Association for Suicide Prevention:** https://www.iasp.info/resources/Crisis_Centres/
📞 **Crisis Text Line (US):** Text HOME to 741741
📞 **Samaritans (UK/IE):** 116 123 (free, 24/7)
📞 **Lifeline (AU):** 13 11 14
🌐 **Findahelpline.com** — global crisis directory

Please tell someone you trust what you're going through, or go to your nearest emergency room. Your life has value. This moment is survivable.

When you are safe and with proper support, I will be here.`;
  }

  // ── Arousal state detection ─────────────────
  _detectArousalState(text) {
    const hyperScore = HYPERAROUSAL_MARKERS.filter(m => text.includes(m)).length;
    const hypoScore = HYPOAROUSAL_MARKERS.filter(m => text.includes(m)).length;

    if (hyperScore >= 2) return AROUSAL_STATES.HYPERAROUSAL;
    if (hypoScore >= 2) return AROUSAL_STATES.HYPOAROUSAL;
    if (hyperScore === 1) return AROUSAL_STATES.HYPERAROUSAL;
    if (hypoScore === 1) return AROUSAL_STATES.HYPOAROUSAL;
    return AROUSAL_STATES.WINDOW;
  }

  // ── Grounding techniques ────────────────────
  _initiateGrounding() {
    if (this.arousalState === AROUSAL_STATES.HYPERAROUSAL) {
      return `I can hear that things feel very intense right now. That's your nervous system responding — it's doing exactly what it was designed to do to protect you. You are safe in this moment.

Before we go any further, I'd like to try something together. It will only take a minute and many people find it brings them back to the present.

**Let's try the 5-4-3-2-1 Grounding Technique:**

Right now, without moving, look around you. Can you **name 5 things you can see**? Just list whatever you notice — a chair, a light, your hands, anything. Take your time.`;
    } else {
      // Hypoarousal / dissociation
      return `I notice you might be feeling very far away or disconnected right now. That's your nervous system's way of protecting you — it's called a "shutdown" response, and it makes sense given what you've been carrying.

Let's do something gentle together to help bring you back to the present moment.

**Bilateral Grounding — feel your feet on the floor right now.** Press down, feel the texture, the temperature. Then gently pat your thighs — left, right, left, right — as if you're slowly walking in place. This bilateral stimulation often helps re-engage the brain.

When you're ready, can you tell me: **what is one thing you can feel in your body right now?** Even subtle sensations count.`;
    }
  }

  _continueGrounding(text) {
    this.groundingStep++;
    const steps5431 = [
      // Step 1: 4 things you can hear
      `That's wonderful. You're doing really well.\n\nNow: **4 things you can hear** — inside the room or outside. Even background noise, your own breathing. Take a moment.`,
      // Step 2: 3 things you can touch
      `Perfect. Keep breathing.\n\n**3 things you can touch or feel physically** — the texture of your clothes, the weight of your body in the chair, the temperature of the air. What do you notice?`,
      // Step 3: 2 things you can smell
      `You're doing great. Almost there.\n\n**2 things you can smell** — if nothing's obvious, try to remember a smell you like. Really bring it in.\n\nWhat comes to mind?`,
      // Step 4: 1 thing you can taste
      `And finally: **1 thing you can taste** — even the faint taste in your mouth right now.\n\n...Take a slow breath in through your nose for 4 counts... hold for 2... and out through your mouth for 6.\n\nHow are you feeling right now? What do you notice has shifted, even slightly?`
    ];

    if (this.groundingStep < steps5431.length) {
      return steps5431[this.groundingStep - 1];
    }

    // Grounding complete — transition back
    return null;
  }

  // ── Cognitive distortion detection ──────────
  _detectDistortions(text) {
    const found = [];
    for (const [type, markers] of Object.entries(COGNITIVE_DISTORTIONS)) {
      if (markers.some(m => text.includes(m))) {
        found.push(type);
      }
    }
    return [...new Set(found)];
  }

  // ── Symptom cluster detection ────────────────
  _detectSymptomClusters(text) {
    const found = [];
    for (const [cluster, markers] of Object.entries(TRAUMA_SYMPTOM_CLUSTERS)) {
      if (markers.some(m => text.includes(m))) {
        found.push(cluster);
      }
    }
    return [...new Set(found)];
  }

  // ── Anhedonia detection ──────────────────────
  _detectAnhedonia(text) {
    return ANHEDONIA_MARKERS.some(m => text.includes(m));
  }

  // ── Advance session phase ────────────────────
  _advancePhase() {
    if (this.sessionPhase === SESSION_PHASES.CHECK_IN && this.turnCount >= 2) {
      this.sessionPhase = this.previousSessionSummary
        ? SESSION_PHASES.BRIDGE
        : SESSION_PHASES.WORK;
    } else if (this.sessionPhase === SESSION_PHASES.BRIDGE && this.turnCount >= 4) {
      this.sessionPhase = SESSION_PHASES.WORK;
    } else if (this.sessionPhase === SESSION_PHASES.WORK && this.turnCount >= 12) {
      this.sessionPhase = SESSION_PHASES.COOL_DOWN;
    }
  }

  // ─────────────────────────────────────────────
  //  RESPONSE GENERATION — CONVERSATIONAL CORE
  //
  //  Principle: read what the person actually said, respond to THAT.
  //  Clinical frameworks are applied as a lens, not as a script.
  // ─────────────────────────────────────────────

  _generateResponse(rawInput, normalized, distortions, symptoms, anhedonia) {

    // ── 1. Is this a greeting / social opener? ──────────────────────
    if (this._isGreeting(normalized)) {
      return this._greetingResponse(normalized);
    }

    // ── 2. Is the person asking us a question? ──────────────────────
    if (this._isDirectQuestion(normalized)) {
      return this._answerQuestion(rawInput, normalized, distortions, symptoms);
    }

    // ── 3. Is the person expressing a specific emotion? ─────────────
    const emotion = this._extractEmotion(normalized);
    if (emotion) {
      return this._emotionResponse(rawInput, normalized, emotion, distortions, symptoms, anhedonia);
    }

    // ── 4. Is there a cognitive distortion present? ─────────────────
    if (distortions.length > 0) {
      return this._socraticlyChallengeDistortion(rawInput, normalized, distortions);
    }

    // ── 5. Trauma symptom cluster recognized? ──────────────────────
    if (symptoms.length > 0) {
      return this._respondToSymptom(rawInput, normalized, symptoms);
    }

    // ── 6. Anhedonia / emotional numbing? ──────────────────────────
    if (anhedonia) {
      return this._anhedoniaResponse(rawInput, normalized);
    }

    // ── 7. Cool-down phase ─────────────────────────────────────────
    if (this.sessionPhase === SESSION_PHASES.COOL_DOWN) {
      return this._coolDownResponse(rawInput);
    }

    // ── 8. Default: reflect what they said, invite more ────────────
    return this._reflectAndInvite(rawInput, normalized);
  }

  // ── Greeting detector ──────────────────────────────────────────────
  _isGreeting(text) {
    const greetings = ["hello", "hi ", "hey", "good morning", "good afternoon",
      "good evening", "howdy", "greetings", "what's up", "whats up", "sup"];
    return greetings.some(g => text.startsWith(g) || text === g.trim()) && text.length < 60;
  }

  _greetingResponse(normalized) {
    const hour = new Date().getHours();
    const timeGreet = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

    if (this.turnCount <= 1) {
      return `${timeGreet}. I'm really glad you're here today.\n\nThis is a space where you can say whatever's on your mind — no agenda, no judgment. We can talk about anything, or we can just start with how you're doing right now.\n\nSo, honestly — how are you today?`;
    }

    return `Hey. Good to hear from you. How are you doing right now, in this moment?`;
  }

  // ── Direct question detector ────────────────────────────────────────
  _isDirectQuestion(text) {
    const questionWords = ["what is", "what are", "what do", "what does", "what should",
      "how do", "how can", "how does", "why do", "why am", "why does",
      "can you", "could you", "do you", "is it", "am i", "are these",
      "what causes", "what helps", "is this normal", "is there"];
    return (text.includes("?") || questionWords.some(q => text.includes(q))) && text.length < 200;
  }

  _answerQuestion(rawInput, normalized, distortions, symptoms) {
    // What is PTSD / trauma / anxiety / depression
    if (normalized.includes("ptsd") || normalized.includes("post-traumatic") || normalized.includes("post traumatic")) {
      return `PTSD — Post-Traumatic Stress Disorder — is what happens when the brain gets stuck trying to process a threatening or overwhelming experience. Normally, memories get filed away and lose their emotional charge over time. With PTSD, that filing process breaks down. The memory stays "live" — your nervous system keeps responding to it as if it's happening right now.\n\nThat's why people experience flashbacks, nightmares, or suddenly feel intense fear or panic from what seems like a small trigger. The brain isn't broken — it's been working overtime to keep you safe.\n\nIs PTSD something you're trying to understand about yourself, or about someone else?`;
    }

    if (normalized.includes("anxiety") && (normalized.includes("what is") || normalized.includes("what causes") || normalized.includes("why"))) {
      return `Anxiety is essentially your brain's threat-alarm system firing. It evolved to keep us alive — that rush of stress hormones sharpens your senses and prepares your body to fight or flee from danger.\n\nThe problem is that the brain doesn't always distinguish well between a real physical threat and a social, emotional, or imagined one. So it can fire the same alarm for a difficult conversation as it would for a predator.\n\nWhen anxiety is persistent — always buzzing in the background, or hitting hard even in "safe" situations — it usually means the alarm system has been calibrated by past experiences to stay on high alert.\n\nWhat does your anxiety tend to feel like? Does it come in waves, or is it more constant?`;
    }

    if (normalized.includes("depression") && (normalized.includes("what is") || normalized.includes("why do") || normalized.includes("what causes"))) {
      return `Depression is more than just feeling sad. It's often described as a kind of grey weight — a flatness where pleasure, motivation, and connection become hard to access. Things that used to feel meaningful start to feel hollow.\n\nFrom a neurological standpoint, depression involves changes in brain chemistry — particularly in the circuits that regulate mood, reward, and energy. It's not a choice, and it's not weakness.\n\nIt can also be the nervous system's response to prolonged stress or loss — a kind of "shutdown" mode. The body and mind slow down to conserve resources.\n\nAre you asking because this sounds familiar to what you're experiencing?`;
    }

    if (normalized.includes("normal") || normalized.includes("is it okay") || normalized.includes("should i feel")) {
      return `That's a really important question to ask — and the very fact that you're asking it tells me something. Often when we ask "is this normal?" we're really asking "is there something wrong with me?"\n\nThe answer is almost always: no. What you're feeling is almost certainly a completely understandable response to something that happened — even if it doesn't feel that way from the inside.\n\nCan you tell me more about what's been happening? I'd like to understand the specific thing you're asking about.`;
    }

    if (normalized.includes("help") && (normalized.includes("how can you") || normalized.includes("what can you") || normalized.includes("what do you"))) {
      return `I'm here to think through things with you — whatever's on your mind. I can help you make sense of how you're feeling, understand patterns in your thoughts and reactions, and sit with difficult experiences without rushing past them.\n\nI work best when we talk openly. I'll ask questions, reflect things back, and sometimes offer a different perspective — but I won't tell you what to do or push you anywhere you're not ready to go.\n\nWhat's most on your mind right now?`;
    }

    if (normalized.includes("what is therapy") || normalized.includes("how does therapy work")) {
      return `Therapy at its heart is a structured conversation — a space where you can say things out loud that are hard to say anywhere else, with someone who is genuinely listening and trained to understand.\n\nMost therapeutic approaches work because of three things: the relationship (feeling genuinely heard and safe), the exploration (looking at thoughts, feelings, and patterns with some distance), and the tools (specific techniques for managing distress or shifting unhelpful patterns).\n\nWhat drew you to asking about that?`;
    }

    // Generic question handling
    return `That's a genuine question and it deserves a real answer.\n\nTo give you the most useful response — can you tell me a bit more about what's behind the question? Are you trying to understand something specific that you're going through right now?`;
  }

  // ── Emotion detection and response ─────────────────────────────────
  _extractEmotion(text) {
    const emotionMap = {
      sad: ["sad", "cry", "crying", "tears", "heartbroken", "grief", "grieving", "lost", "miss", "missing"],
      angry: ["angry", "anger", "furious", "rage", "frustrated", "frustration", "annoyed", "resentment", "hate"],
      scared: ["scared", "afraid", "fear", "terrified", "nervous", "worried", "anxious", "anxiety", "dread"],
      ashamed: ["ashamed", "shame", "embarrassed", "humiliated", "guilty", "guilt", "worthless", "stupid", "pathetic"],
      lonely: ["lonely", "alone", "isolated", "no one", "nobody", "nobody cares", "disconnected", "abandoned"],
      confused: ["confused", "don't understand", "lost", "don't know what", "can't figure", "overwhelming"],
      hopeless: ["hopeless", "no hope", "give up", "pointless", "nothing will", "won't get better"],
      overwhelmed: ["overwhelmed", "too much", "can't cope", "can't handle", "breaking down", "falling apart"]
    };

    for (const [emotion, markers] of Object.entries(emotionMap)) {
      if (markers.some(m => text.includes(m))) return emotion;
    }
    return null;
  }

  _emotionResponse(rawInput, normalized, emotion, distortions, symptoms) {
    const emotionResponses = {
      sad: (input) => {
        const personalDetail = this._getSpecificDetail(input);
        return `I can hear the sadness in what you're sharing${personalDetail ? ` — especially around "${personalDetail}"` : ""}.\n\nSadness usually means something mattered. It's not something to push away or fix quickly.\n\nCan you tell me more about what's underneath it? Is this something specific that happened, or more of a feeling that's been sitting with you for a while?`;
      },
      angry: (input) => {
        return `Anger makes total sense — it's usually a signal that something important was violated. A boundary, an expectation, a sense of fairness.\n\nI'm not going to tell you the anger is wrong. I'm curious though: underneath the anger, what's the feeling that's underneath it? Anger is often protecting something — what do you think it might be protecting right now?`;
      },
      scared: (input) => {
        return `Fear is real, and I'm not going to minimize it. Your nervous system is sounding an alarm — and that alarm usually has a reason, even if it's not always easy to see what it is.\n\nWhat specifically feels threatening or scary right now? Let's not rush past it — I'd like to understand what this really looks like for you.`;
      },
      ashamed: (input) => {
        const hasSelfBlame = distortions.includes("selfBlame");
        return `What you're describing — that feeling of shame or guilt — is one of the most painful things a person can carry. And it's also one of the most common responses to experiences we had little or no control over.\n\nShame tells us something is fundamentally wrong with us — but shame is almost always lying. It's a feeling, not a fact.\n\n${hasSelfBlame ? "I noticed you seem to be holding yourself responsible for something. I'd like to explore that gently with you — " : ""}Can you tell me what specifically you feel ashamed about? You don't have to, but naming it can sometimes reduce its power.`;
      },
      lonely: (input) => {
        return `Loneliness is one of the deepest pains there is. The need to feel seen and connected isn't a weakness — it's fundamental to being human.\n\nI want to make sure I understand yours. Is this a loneliness of being physically alone, or more the kind where you're around people but still feel like nobody really knows you?`;
      },
      confused: (input) => {
        return `That confusion makes sense — sometimes when we're in the middle of something difficult, everything becomes tangled and hard to see clearly.\n\nLet's slow down and untangle it together. What's the part that feels most confusing or overwhelming right now? We don't have to figure it all out at once.`;
      },
      hopeless: (input) => {
        return `When things have been hard for long enough, hopelessness can start to feel like the only realistic view. Like hope itself is naive.\n\nI want to sit with that rather than argue with it. Can you tell me more — how long have you been feeling this way? And is there anything, even small, that has felt even slightly different at any point?`;
      },
      overwhelmed: (input) => {
        return `When everything stacks up, the system — your mind and body — can hit a kind of overload. That's not failure, that's the normal human response to too much for too long.\n\nLet's not try to solve everything right now. Just this moment: what's the single heaviest thing sitting on top of the pile? Let's start there.`;
      }
    };

    const responseFn = emotionResponses[emotion];
    return responseFn ? responseFn(rawInput) : this._reflectAndInvite(rawInput, normalized);
  }

  // ── Socratic distortion work ────────────────────────────────────────
  _socraticlyChallengeDistortion(rawInput, normalized, distortions) {
    const distortion = distortions[0];
    const questions = SOCRATIC_QUESTIONS[distortion] || SOCRATIC_QUESTIONS.selfBlame;
    const question = questions[this.turnCount % questions.length];
    const specificDetail = this._getSpecificDetail(rawInput);

    const intros = {
      selfBlame: `It sounds like you're carrying a lot of responsibility for this${specificDetail ? ` — particularly around "${specificDetail}"` : ""}. That kind of self-blame is very common, and it often makes sense in the context of what happened — but I want to explore it with you rather than just accept it at face value.\n\n`,
      catastrophizing: `I notice things feel very all-or-nothing right now${specificDetail ? ` — like "${specificDetail}" means everything` : ""}. When we're under stress, our minds often can only see the worst-case endpoint. Let's look at the full picture together.\n\n`,
      mindReading: `I hear you saying you know what they think or how they feel — but I want to gently pause on that. We actually can't fully access another person's inner experience.\n\n`,
      fortuneTelling: `That certainty about the future — "${specificDetail || "nothing will change"}" — I understand why it feels true. But let's look at what we actually know versus what we're predicting.\n\n`
    };

    const intro = intros[distortion] || `There's something in what you've shared that I'd like to explore with you.\n\n`;
    return `${intro}**${question}**\n\nThere's no right answer. Just take your time and tell me what comes up.`;
  }

  // ── Symptom response ────────────────────────────────────────────────
  _respondToSymptom(rawInput, normalized, symptoms) {
    const symptom = symptoms[0];
    const detail = this._getSpecificDetail(rawInput);

    const replies = {
      intrusion: `Those memories or images that keep coming back${detail ? ` — like "${detail}"` : ""} — that's something a lot of people find confusing and distressing. The brain keeps replaying it not because it wants to torture you, but because it's trying to process and file away something it hasn't fully made sense of yet.\n\nIt's like your mind is saying, "we're not done with this yet." That's a normal — if painful — part of how we process overwhelming experiences.\n\nHow long has this been happening? And when it comes up, what does it feel like in your body?`,
      avoidance: `Avoiding it — whether that's certain places, people, memories, or thoughts — makes complete sense. At some level, avoidance works. It keeps the pain at a manageable distance.\n\nThe only cost is that the longer we avoid something, the more power it tends to hold. That's not a judgment, just something to know.\n\nWhat specifically are you finding hardest to face right now?`,
      negativeCognitions: `Those thoughts about yourself or the world${detail ? ` — like "${detail}"` : ""} — they feel very real and very true right now. And I understand why they do.\n\nBut beliefs that form during or after trauma aren't neutral observations — they're shaped by pain. That doesn't make them facts.\n\nWhat would you need to see or experience to even slightly question that belief?`,
      hyperarousal: `Being constantly on edge — that hypervigilance — is exhausting. Your nervous system has learned that danger can come at any time, so it stays as alert as possible to catch it early.\n\nThe hard part is that this level of alertness isn't sustainable, and it often creates suffering even when there's no actual threat present.\n\nWhat does that feel like for you day-to-day? Where in your body do you notice it most?`
    };

    return replies[symptom] || this._reflectAndInvite(rawInput, normalized);
  }

  // ── Anhedonia response ──────────────────────────────────────────────
  _anhedoniaResponse(rawInput, normalized) {
    return `That flatness you're describing — where things that used to matter just... don't — is one of the more quietly painful experiences there is. Not dramatic, just grey.\n\nFrom a psychological standpoint, this is often the nervous system doing something protective — dimming the emotional volume to manage something that's been too heavy for too long. It's not a character flaw. It's not permanent.\n\nBut it's worth understanding. **Was there a specific point when this started, or did it creep in gradually?** And is there anything — even small — that still occasionally reaches you?`;
  }

  // ── Cool-down phase ─────────────────────────────────────────────────
  _coolDownResponse(rawInput) {
    if (!this.coolDownInitiated) {
      this.coolDownInitiated = true;
      return `We've covered a lot today, and I want to make sure we close gently — not cut off.\n\nBefore we wrap up, let's just take a breath. Literally — a slow inhale through the nose for 4 counts... hold 2... exhale through the mouth for 6. That activates the parasympathetic system and helps your body settle.\n\nHow are you feeling right now compared to when we started?`;
    }

    return `Before you go — I want to acknowledge what you brought today. It takes something to look at this stuff, and you did.\n\nOne thing to carry with you: whatever insight or feeling came up today is yours. It doesn't go away when we close.\n\nIs there anything you want to name or leave here before you go?`;
  }

  // ── Fallback: reflect and invite ────────────────────────────────────
  _reflectAndInvite(rawInput, normalized) {
    // Try to echo something specific they said
    const detail = this._getSpecificDetail(rawInput);
    const sentences = rawInput.split(/[.!?]+/).map(s => s.trim()).filter(s => s.length > 10);
    const mostMeaningful = sentences.sort((a, b) => b.length - a.length)[0] || rawInput;

    const starters = [
      `"${mostMeaningful.slice(0, 80)}${mostMeaningful.length > 80 ? "..." : ""}" — I want to stay with that for a moment. What's underneath that for you?`,
      `When you say that, what does it feel like — is it more of a thought, or does it land somewhere in your body too?`,
      `I'm sitting with what you just shared. What feels most important to you about it right now?`,
      `That matters. Can you say more about${detail ? ` the "${detail}" part` : " what you mean by that"}? I want to make sure I really understand.`,
      `I hear you. What's the part of this that weighs on you most?`
    ];

    return starters[this.turnCount % starters.length];
  }

  // ── Utility ─────────────────────────────────────────────────────────
  _getSpecificDetail(text) {
    // Extract the most emotionally weighted noun phrase from the input
    const words = text.replace(/[^a-zA-Z\s']/g, "").split(/\s+/);
    const stopwords = new Set(["i", "me", "my", "the", "a", "an", "and", "or", "but", "is", "was",
      "are", "were", "it", "to", "of", "in", "that", "this", "with", "for", "on", "at", "by",
      "from", "do", "did", "have", "has", "had", "be", "been", "not", "so", "just", "really",
      "very", "he", "she", "they", "we", "you", "what", "when", "how", "why", "which"]);
    const meaningful = words.filter(w => w.length > 4 && !stopwords.has(w.toLowerCase()));
    return meaningful.slice(0, 3).join(" ") || null;
  }

  _buildResult(response, flags = {}) {
    return {
      response,
      arousalState: this.arousalState,
      phase: this.sessionPhase,
      turnCount: this.turnCount,
      flags
    };
  }

  // ── Session management ───────────────────────────────────────────────
  setPreviousSessionSummary(summary) {
    this.previousSessionSummary = summary;
    this.sessionPhase = SESSION_PHASES.CHECK_IN;
  }

  getSessionSummary() {
    const distortionList = [...new Set(this.detectedDistortions)].join(", ") || "none identified";
    const symptomList = [...new Set(this.detectedSymptoms)].join(", ") || "none identified";
    return {
      turns: this.turnCount,
      distortionsWorked: distortionList,
      symptomsAddressed: symptomList,
      finalArousalState: this.arousalState,
      phase: this.sessionPhase,
      anhedoniaPresent: this.anhedoniaFlagged,
      crisisOccurred: this.crisisDetected,
      durationMinutes: Math.round((Date.now() - this.sessionStartTime) / 60000)
    };
  }

  reset() {
    const summary = this.getSessionSummary();
    this.sessionPhase = SESSION_PHASES.CHECK_IN;
    this.arousalState = AROUSAL_STATES.WINDOW;
    this.sessionHistory = [];
    this.affectLog = [];
    this.detectedDistortions = [];
    this.detectedSymptoms = [];
    this.turnCount = 0;
    this.sessionStartTime = Date.now();
    this.groundingInProgress = false;
    this.groundingStep = 0;
    this.coolDownInitiated = false;
    this.anhedoniaFlagged = false;
    this.crisisDetected = false;
    return summary;
  }
}

// Export for use
window.TraumaInformedClinicalEngine = TraumaInformedClinicalEngine;
window.SESSION_PHASES = SESSION_PHASES;
window.AROUSAL_STATES = AROUSAL_STATES;

