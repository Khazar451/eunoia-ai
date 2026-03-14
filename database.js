/**
 * database.js — Supabase Cloud Database integration
 * Permanent per-user storage: users, sessions, messages, profiles
 */

"use strict";
require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("CRITICAL ERROR: SUPABASE_URL or SUPABASE_ANON_KEY is missing from .env");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// ── Users ─────────────────────────────────────────────────────────────────

async function createUser(id, username, pin) {
  const now = Date.now();
  const { data, error } = await supabase
    .from("users")
    .insert([{ 
      id: id, 
      username: username.toLowerCase().trim(), 
      pin: pin, 
      created_at: now, 
      last_seen: now 
    }])
    .select()
    .single();

  if (error) throw new Error("Supabase: " + error.message);
  return data;
}

async function getUserByUsername(username) {
  const { data, error } = await supabase
    .from("users")
    .select("*")
    .eq("username", username.toLowerCase().trim())
    .single();
  
  if (error && error.code !== "PGRST116") throw new Error("Supabase: " + error.message);
  return data || null;
}

async function getUserById(id) {
  const { data, error } = await supabase
    .from("users")
    .select("*")
    .eq("id", id)
    .single();
    
  if (error && error.code !== "PGRST116") throw new Error("Supabase: " + error.message);
  return data || null;
}

async function getAllUsers() {
  const { data, error } = await supabase
    .from("users")
    .select("*")
    .order("created_at", { ascending: false });
    
  if (error) throw new Error("Supabase: " + error.message);
  return data || [];
}

async function updateUserLastSeen(userId) {
  await supabase
    .from("users")
    .update({ last_seen: Date.now() })
    .eq("id", userId);
}

async function incrementSessionCount(userId) {
  // Supabase doesn't have a simple increment like SQL UPDATE x = x + 1, so we RPC or fetch/update.
  // Easiest is to select, then update, or we can just count sessions via relation.
  const user = await getUserById(userId);
  if (user) {
    await supabase
      .from("users")
      .update({ session_count: (user.session_count || 0) + 1 })
      .eq("id", userId);
  }
}

async function updateProfileNotes(userId, notes) {
  await supabase
    .from("users")
    .update({ profile_notes: notes })
    .eq("id", userId);
}

// ── Sessions ──────────────────────────────────────────────────────────────

async function createSession(id, userId) {
  const now = Date.now();
  const { data, error } = await supabase
    .from("sessions")
    .insert([{
      id: id,
      user_id: userId,
      started_at: now,
      phase: "check_in",
      turn_count: 0
    }])
    .select()
    .single();
    
  if (error) throw new Error("Supabase: " + error.message);
  await incrementSessionCount(userId);
  return data;
}

async function getSession(id) {
  const { data, error } = await supabase
    .from("sessions")
    .select("*")
    .eq("id", id)
    .single();
    
  if (error && error.code !== "PGRST116") throw new Error("Supabase: " + error.message);
  return data || null;
}

async function getUserSessions(userId, limit = 10) {
  const { data, error } = await supabase
    .from("sessions")
    .select("*")
    .eq("user_id", userId)
    .order("started_at", { ascending: false })
    .limit(limit);
    
  if (error) throw new Error("Supabase: " + error.message);
  return data || [];
}

async function closeSession(id, phase, summary, distortions, symptoms) {
  await supabase
    .from("sessions")
    .update({
      ended_at: Date.now(),
      phase: phase,
      summary: summary,
      distortions_worked: distortions,
      symptoms_addressed: symptoms
    })
    .eq("id", id);
}

async function killSession(id) {
  await supabase
    .from("sessions")
    .update({
      ended_at: Date.now(),
      phase: "closed",
      summary: "Kicked by administrator"
    })
    .eq("id", id);
}

async function updateSessionPhase(id, phase, turnCount) {
  await supabase
    .from("sessions")
    .update({ phase: phase, turn_count: turnCount })
    .eq("id", id);
}

// ── Messages ──────────────────────────────────────────────────────────────

async function saveMessage(sessionId, userId, role, content, arousalState, distortions, symptoms) {
  const dStr = distortions && distortions.length ? distortions.join(",") : "";
  const sStr = symptoms && symptoms.length ? symptoms.join(",") : "";
  
  await supabase
    .from("messages")
    .insert([{
      session_id: sessionId,
      user_id: userId,
      role: role,
      content: content,
      timestamp: Date.now(),
      arousal_state: arousalState || "window_of_tolerance",
      distortions: dStr,
      symptoms: sStr
    }]);
}

async function getSessionMessages(sessionId) {
  const { data, error } = await supabase
    .from("messages")
    .select("*")
    .eq("session_id", sessionId)
    .order("timestamp", { ascending: true });
    
  if (error) throw new Error("Supabase: " + error.message);
  return data || [];
}

async function getRecentUserMessages(userId, limit = 40) {
  const { data, error } = await supabase
    .from("messages")
    .select("*")
    .eq("user_id", userId)
    .order("timestamp", { ascending: false })
    .limit(limit);
    
  if (error) throw new Error("Supabase: " + error.message);
  // messages need to be chronological for the LLM context, so we reverse the "recent descending" pull 
  return (data || []).reverse();
}

// ── Patterns ──────────────────────────────────────────────────────────────

async function recordPattern(userId, type, value) {
  // Check if exists
  const { data: existing } = await supabase
    .from("user_patterns")
    .select("id, frequency")
    .eq("user_id", userId)
    .eq("pattern_type", type)
    .eq("pattern_value", value)
    .single();

  if (existing) {
    await supabase
      .from("user_patterns")
      .update({ 
        last_seen: Date.now(), 
        frequency: existing.frequency + 1 
      })
      .eq("id", existing.id);
  } else {
    const now = Date.now();
    await supabase
      .from("user_patterns")
      .insert([{
        user_id: userId,
        pattern_type: type,
        pattern_value: value,
        first_seen: now,
        last_seen: now,
        frequency: 1
      }]);
  }
}

async function getUserPatterns(userId) {
  const { data, error } = await supabase
    .from("user_patterns")
    .select("*")
    .eq("user_id", userId)
    .order("frequency", { ascending: false });
    
  if (error) throw new Error("Supabase: " + error.message);
  return data || [];
}

module.exports = {
  createUser, getUserByUsername, getUserById, getAllUsers,
  updateUserLastSeen, updateProfileNotes,
  createSession, getSession, getUserSessions, closeSession, killSession, updateSessionPhase,
  saveMessage, getSessionMessages, getRecentUserMessages,
  recordPattern, getUserPatterns
};
