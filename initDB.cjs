// ============================================================
// initDB.cjs — Setup / Migrações do banco (Render Cloud Edition)
// - Cria e inicializa consumo.db se não existir
// - Compatível com Render (filesystem volátil)
// ============================================================

const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");
const bcrypt = require("bcrypt");

// Caminho do banco (Render cria o arquivo no diretório atual)
const dbFile = path.join(process.cwd(), "consumo.db");

function log(msg) {
  console.log(`[initDB] ${msg}`);
}

function run() {
  const isNew = !fs.existsSync(dbFile);
  const db = new Database(dbFile);
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
    )
  `).run();

  // Cria usuário admin se não existir
  const adminEmail = "thiago@teste.com";
  const existing = db.prepare("SELECT * FROM users WHERE email=?").get(adminEmail);
  if (!existing) {
    const hash = bcrypt.hashSync("123456", 10);
    db.prepare("INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)")
      .run("Thiago Tank", adminEmail, hash, "admin");
    log("✅ Usuário admin criado: thiago@teste.com / 123456");
  } else {
    log("✅ Usuário admin já existe");
  }

  // -------------------------
  // METERS
  // -------------------------
  db.prepare(`
    CREATE TABLE IF NOT EXISTS meters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT NOT NULL,          -- 'agua' | 'energia' | 'energia-3f'
      token TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `).run();

  // -------------------------
  // READINGS
  // -------------------------
  db.prepare(`
    CREATE TABLE IF NOT EXISTS readings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      meter_id INTEGER,
      meter_name TEXT,
      type TEXT,
      value REAL,
      consumo_litros REAL,
      vazao_lh REAL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (meter_id) REFERENCES meters(id)
    )
  `).run();

  // -------------------------
  // GOALS
  // -------------------------
  db.prepare(`
    CREATE TABLE IF NOT EXISTS goals (
      meter_id TEXT PRIMARY KEY,
      meter_name TEXT NOT NULL,
      goal_daily REAL NOT NULL,
      warn_percent INTEGER NOT NULL
    )
  `).run();

  // -------------------------
  // TARIFFS
  // -------------------------
  db.prepare(`
    CREATE TABLE IF NOT EXISTS tariffs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      price_per_unit REAL NOT NULL,
      started_at TEXT NOT NULL,
      ended_at TEXT
    )
  `).run();

  const tCount = db.prepare("SELECT COUNT(*) AS c FROM tariffs").get().c;
  if (!tCount) {
    const today = new Date().toISOString().slice(0, 10);
    db.prepare("INSERT INTO tariffs (type, price_per_unit, started_at, ended_at) VALUES (?, ?, ?, NULL)").run("agua", 10.0, today);
    db.prepare("INSERT INTO tariffs (type, price_per_unit, started_at, ended_at) VALUES (?, ?, ?, NULL)").run("energia", 0.85, today);
    log("💵 Tarifas padrão criadas (água=10.00, energia=0.85)");
  }

  // -------------------------
  // USER_METERS
  // -------------------------
  db.prepare(`
    CREATE TABLE IF NOT EXISTS user_meters (
      user_id INTEGER NOT NULL,
      meter_id INTEGER NOT NULL,
      PRIMARY KEY (user_id, meter_id),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (meter_id) REFERENCES meters(id)
    )
  `).run();

  // -------------------------
  // ENERGY 3PH BUFFER
  // -------------------------
  db.prepare(`
    CREATE TABLE IF NOT EXISTS energy3ph_buffer (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      meter_parent_id INTEGER,
      raw_json TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (meter_parent_id) REFERENCES meters(id)
    )
  `).run();

  log(isNew ? "🎯 Banco de dados criado e inicializado!" : "🎯 Banco de dados verificado com sucesso!");
  db.close();
}

run();
