const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const config = require('./config');

let db;

function getDb() {
  if (!db) {
    const dbPath = config.db.path;
    const dbDir = path.dirname(dbPath);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
  }
  return db;
}

function runMigrations(database) {
  const migrationPath = path.join(__dirname, '..', 'migrations', '001_initial.sql');
  const sql = fs.readFileSync(migrationPath, 'utf8');
  database.exec(sql);
}

// User operations
function createUser(userPhone) {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO users (user_phone, personal_ai_domain)
    VALUES (?, ?)
  `);
  stmt.run(userPhone, userPhone.replace('+', ''));
  return getUserByPhone(userPhone);
}

function getUserByPhone(phone) {
  const db = getDb();
  return db.prepare('SELECT * FROM users WHERE user_phone = ?').get(phone);
}

function getUserByTelnyxNumber(telnyxNumber) {
  const db = getDb();
  return db.prepare('SELECT * FROM users WHERE telnyx_number = ?').get(telnyxNumber);
}

function updateUser(phone, updates) {
  const db = getDb();
  const keys = Object.keys(updates);
  const setClause = keys.map(k => `${k} = ?`).join(', ');
  const values = keys.map(k => updates[k]);
  values.push(phone);
  db.prepare(`UPDATE users SET ${setClause} WHERE user_phone = ?`).run(...values);
  return getUserByPhone(phone);
}

function getAllUsers() {
  const db = getDb();
  return db.prepare('SELECT * FROM users ORDER BY created_at DESC').all();
}

function deleteUser(phone) {
  const db = getDb();
  db.prepare('DELETE FROM messages WHERE user_phone = ?').run(phone);
  db.prepare('DELETE FROM memories WHERE user_phone = ?').run(phone);
  db.prepare('DELETE FROM onboarding_state WHERE user_phone = ?').run(phone);
  db.prepare('DELETE FROM users WHERE user_phone = ?').run(phone);
}

// Onboarding state operations
function getOnboardingState(userPhone) {
  const db = getDb();
  return db.prepare('SELECT * FROM onboarding_state WHERE user_phone = ?').get(userPhone);
}

function createOnboardingState(userPhone) {
  const db = getDb();
  db.prepare(`
    INSERT OR IGNORE INTO onboarding_state (user_phone, step, choices)
    VALUES (?, 'welcome', '{}')
  `).run(userPhone);
  return getOnboardingState(userPhone);
}

function updateOnboardingState(userPhone, step, choices) {
  const db = getDb();
  db.prepare(`
    UPDATE onboarding_state
    SET step = ?, choices = ?, updated_at = datetime('now')
    WHERE user_phone = ?
  `).run(step, JSON.stringify(choices), userPhone);
}

// Message operations
function saveMessage(data) {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO messages (user_phone, channel, direction, content, ai_response, tokens_used)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  stmt.run(data.userPhone, data.channel, data.direction, data.content, data.aiResponse || null, data.tokensUsed || 0);
}

function getMessages(userPhone, limit = 50) {
  const db = getDb();
  return db.prepare('SELECT * FROM messages WHERE user_phone = ? ORDER BY created_at DESC LIMIT ?').all(userPhone, limit);
}

function getAllMessages(limit = 50) {
  const db = getDb();
  return db.prepare('SELECT * FROM messages ORDER BY created_at DESC LIMIT ?').all(limit);
}

function getMessageStats() {
  const db = getDb();
  const totalMessages = db.prepare('SELECT COUNT(*) as count FROM messages').get().count;
  const totalTokens = db.prepare('SELECT COALESCE(SUM(tokens_used), 0) as total FROM messages').get().total;
  const channelStats = db.prepare(`
    SELECT channel, COUNT(*) as count FROM messages GROUP BY channel
  `).all();
  return { totalMessages, totalTokens, channelStats };
}

// Memory operations
function saveMemory(data) {
  const db = getDb();
  db.prepare(`
    INSERT INTO memories (user_phone, category, label, source, confidence)
    VALUES (?, ?, ?, ?, ?)
  `).run(data.userPhone, data.category || null, data.label, data.source || null, data.confidence || 1.0);
}

function getMemories(userPhone) {
  const db = getDb();
  return db.prepare('SELECT * FROM memories WHERE user_phone = ? ORDER BY created_at DESC').all(userPhone);
}

module.exports = {
  getDb,
  createUser,
  getUserByPhone,
  getUserByTelnyxNumber,
  updateUser,
  getAllUsers,
  deleteUser,
  getOnboardingState,
  createOnboardingState,
  updateOnboardingState,
  saveMessage,
  getMessages,
  getAllMessages,
  getMessageStats,
  saveMemory,
  getMemories,
};
