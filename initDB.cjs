// ======================================================
// initDB.cjs — Setup / Migrações do banco (SQLite)
// - Users / Auth
// - Meters / Readings (água, energia)
// - Tariffs (água/energia) com histórico
// - User_Meters (permissões por usuário)
// - Buffer trifásico (energy 3ph)
// - Garante admin padrão thiago@teste.com / 123456
// ======================================================

const Database = require("better-sqlite3");
const bcrypt = require("bcrypt");

function log(msg) {
  console.log(`[initDB] ${msg}`);
}

function run() {
  const db = new Database("consumo.db");
  db.pragma("journal_mode = wal");

  // -------------------------
  // USERS
  // -------------------------
  db.prepare(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT DEFAULT 'admin',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `).run();

  // Cria admin padrão, se não existir
  const adminEmail = "thiago@teste.com";
  const existingAdmin = db.prepare("SELECT * FROM users WHERE email = ?").get(adminEmail);
  if (!existingAdmin) {
    const hash = bcrypt.hashSync("123456", 10);
    db.prepare("INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)")
      .run("Thiago Tank", adminEmail, hash, "admin");
    log("✅ Admin criado: thiago@teste.com / 123456");
  } else {
    log("✅ Admin já existe");
  }

  // -------------------------
  // METERS
  // -------------------------
  db.prepare(`
    CREATE TABLE IF NOT EXISTS meters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT NOT NULL,          -- 'agua' | 'energia' | 'energia-3f'
      token TEXT,                  -- token de autenticação de cada equipamento
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `).run();

  // -------------------------
  // READINGS (leituras)
  // -------------------------
  db.prepare(`
    CREATE TABLE IF NOT EXISTS readings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      meter_id INTEGER,
      meter_name TEXT,
      type TEXT,                    -- 'agua' | 'energia'
      value REAL,                   -- valor principal (litros ou kWh)
      consumo_litros REAL,
      vazao_lh REAL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (meter_id) REFERENCES meters(id)
    );
  `).run();

  // -------------------------
  // GOALS (metas de consumo)
  // -------------------------
  db.prepare(`
    CREATE TABLE IF NOT EXISTS goals (
      meter_id TEXT PRIMARY KEY,
      meter_name TEXT NOT NULL,
      goal_daily REAL NOT NULL,
      warn_percent INTEGER NOT NULL
    );
  `).run();

  // -------------------------
  // TARIFFS (tarifas com histórico)
  // -------------------------
  db.prepare(`
    CREATE TABLE IF NOT EXISTS tariffs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,           -- 'agua' | 'energia'
      price_per_unit REAL NOT NULL, -- R$/m³ ou R$/kWh
      started_at TEXT NOT NULL,     -- 'YYYY-MM-DD'
      ended_at TEXT                 -- null = vigente
    );
  `).run();

  const tariffCount = db.prepare("SELECT COUNT(*) as c FROM tariffs").get().c;
  if (!tariffCount) {
    const today = new Date().toISOString().slice(0, 10);
    const ins = db.prepare(
      "INSERT INTO tariffs (type, price_per_unit, started_at, ended_at) VALUES (?, ?, ?, ?)"
    );
    ins.run("agua", 10.0, today, null);
    ins.run("energia", 0.85, today, null);
    log("💵 Tarifas padrão criadas (água=10.00, energia=0.85)");
  }

  // -------------------------
  // USER_METERS (vínculo usuário ↔ medidor)
  // -------------------------
  db.prepare(`
    CREATE TABLE IF NOT EXISTS user_meters (
      user_id INTEGER NOT NULL,
      meter_id INTEGER NOT NULL,
      PRIMARY KEY (user_id, meter_id),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (meter_id) REFERENCES meters(id)
    );
  `).run();

  // -------------------------
  // ENERGY 3PH BUFFER (armazenamento trifásico bruto)
  // -------------------------
  db.prepare(`
    CREATE TABLE IF NOT EXISTS energy3ph_buffer (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      meter_parent_id INTEGER,
      raw_json TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (meter_parent_id) REFERENCES meters(id)
    );
  `).run();

  log("🎯 Banco de dados inicializado com sucesso!");
  db.close();
}

run();
