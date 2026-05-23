CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_phone TEXT UNIQUE NOT NULL,
  telnyx_number TEXT UNIQUE,
  telnyx_number_id TEXT,
  messaging_profile_id TEXT,
  personal_ai_domain TEXT,
  setup_complete INTEGER DEFAULT 0,
  voice_mode TEXT DEFAULT 'assistant',
  lead_handling TEXT DEFAULT 'none',
  family_mode INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS onboarding_state (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_phone TEXT NOT NULL,
  step TEXT NOT NULL DEFAULT 'welcome',
  choices TEXT DEFAULT '{}',
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_phone TEXT NOT NULL,
  channel TEXT NOT NULL,
  direction TEXT NOT NULL,
  content TEXT,
  ai_response TEXT,
  tokens_used INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS memories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_phone TEXT NOT NULL,
  category TEXT,
  label TEXT NOT NULL,
  source TEXT,
  confidence REAL DEFAULT 1.0,
  created_at TEXT DEFAULT (datetime('now'))
);
