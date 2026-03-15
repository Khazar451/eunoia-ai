# Eunoia AI (Clinical / Trauma‑Informed Chat)

Eunoia is a trauma‑informed, psychotherapy‑style conversational AI with a **real LLM “brain”** (Groq or local Ollama) and a **guaranteed fallback built‑in engine**, plus a **persistent user + session database**.

It’s built as a simple web app:
- **Frontend:** `index.html`, `app.js`, `styles.css` (served as static files)
- **Backend:** `server.js` (Express)
- **Persistence:** SQLite via `better-sqlite3` (`database.js`)

## Key Features

- **LLM routing with fallback**
  - **Groq** (if `GROQ_API_KEY` is set)
  - **Ollama** (if running locally)
  - **Built‑in engine** (always works, even with zero API keys)
- **Trauma‑informed “clinical lens”**
  - Window of Tolerance / arousal state detection (hyper/hypo/window)
  - Cognitive distortion pattern logging
  - Trauma symptom cluster detection
  - Crisis/self‑harm detection with immediate crisis resources
- **Persistent sessions**
  - Users can “log in” with a username + PIN
  - Sessions and messages are stored to SQLite
  - Recent history is used to build context for the LLM

## Project Structure

- `server.js` — Express API + LLM routing + static hosting
- `database.js` — SQLite persistence layer (users, sessions, messages, patterns)
- `engine.js` — built‑in Trauma‑Informed Clinical Engine (runs client-side)
- `index.html` — main chat UI
- `admin.html` — basic admin UI (browse users/sessions/messages)
- `app.js` — frontend logic (calls the REST API)
- `styles.css` — UI styling
- `groq_models.json` — model list / metadata
- `.env.example` — environment variable template

## Requirements

- Node.js (recommended: 18+)
- npm

Optional (only if you want those providers):
- A **Groq API key** (cloud LLM)
- **Ollama** running locally (local LLM)

## Setup

1) Install dependencies:
```bash
npm install
```

2) Create your environment file:
```bash
cp .env.example .env
```

3) Configure `.env` (optional but recommended):
- If you want Groq:
  - `GROQ_API_KEY=...`
  - `GROQ_MODEL=llama-3.3-70b-versatile` (default)
- If you want Ollama:
  - `OLLAMA_URL=http://localhost:11434`
  - `OLLAMA_MODEL=llama3.1:8b`
- Provider selection:
  - `LLM_PROVIDER=auto` (default)
  - You can set to `groq` or `ollama` to force one.

4) Start the server:
```bash
npm start
```

Then open:
- App: `http://localhost:3000`
- Admin: `http://localhost:3000/admin.html`

## How LLM Provider Selection Works

By design, Eunoia tries to be “always on”:

- If `GROQ_API_KEY` is configured, Groq can be used.
- If Ollama is reachable, Ollama can be used.
- If neither is available (or they fail), Eunoia falls back to the **built‑in engine** so the app still works.

The `/api/chat` endpoint returns which provider answered:
```json
{ "response": "...", "provider": "groq" }
```
(or `ollama` / `built-in`)

## REST API (Backend)

The backend is an Express app that serves the UI and exposes JSON endpoints.

### Auth / Users
- `POST /api/users/login`
  - Body: `{ "username": "name", "pin": "1234" }`
  - Creates user if new, otherwise validates PIN

- `GET /api/users/:id/profile`
  - Returns user, sessions, and detected patterns

### Sessions
- `POST /api/sessions`
  - Body: `{ "userId": "..." }`
  - Creates a new session

- `GET /api/sessions/:id/messages`
  - Returns all messages for a session

- `PATCH /api/sessions/:id`
  - Updates phase/summary/distortions/symptoms (and closes session data)

### Chat
- `POST /api/chat`
  - Body:
    ```json
    {
      "userId": "...",
      "sessionId": "...",
      "message": "Hello",
      "clinicalContext": {
        "phase": "work",
        "turnCount": 3,
        "arousalState": "window_of_tolerance",
        "distortions": [],
        "symptoms": []
      }
    }
    ```
  - Persists user message, routes to provider, persists AI response, updates session state

### Admin
- `GET /api/admin/users`
- `GET /api/admin/users/:id/sessions`
- `GET /api/admin/sessions/:id/messages`
- `POST /api/admin/sessions/:id/kick` (forcibly terminates a session)

## Safety Notes / Disclaimer

This project includes crisis/self‑harm detection and offers crisis resources, but it is **not a replacement for professional care**. If you or someone else is in immediate danger, contact local emergency services.

## Development

Run in “dev” mode (same as start currently):
```bash
npm run dev
```
