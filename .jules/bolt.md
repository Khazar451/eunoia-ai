## 2024-05-18 - [Optimize Supabase API Latency]
**Learning:** Sequential awaits on database calls (like reading user state, patterns, sessions, and messages) create massive artificial latency when the database layer uses HTTP (Supabase). This architecture's overhead per request requires batching network calls wherever possible.
**Action:** When working with the Supabase client in this repo, default to grouping independent reads/writes into a Promise.all() block. Avoid sequential awaits unless data dependencies explicitly require it.
