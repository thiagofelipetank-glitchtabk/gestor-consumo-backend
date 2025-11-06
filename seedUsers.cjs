// ======================================================
// seedUsers.cjs — Criação de usuários padrão + vínculos
// ======================================================

const Database = require("better-sqlite3");
const bcrypt = require("bcrypt");

function log(msg) {
  console.log(`[seedUsers] ${msg}`);
}

function seed() {
  const db = new Database("consumo.db");
  db.pragma("journal_mode = wal");

  // ----------------------------------------
  // 1️⃣ Usuários de teste
  // ----------------------------------------
  const users = [
    { name: "Casa 1", email: "casa1@teste.com", password: "123456", role: "user" },
    { name: "Casa 2", email: "casa2@teste.com", password: "123456", role: "user" },
    { name: "Casa 3", email: "casa3@teste.com", password: "123456", role: "user" }
  ];

  const insertUser = db.prepare(
    "INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)"
  );

  for (const u of users) {
    const exists = db.prepare("SELECT * FROM users WHERE email=?").get(u.email);
    if (!exists) {
      const hash = bcrypt.hashSync(u.password, 10);
      insertUser.run(u.name, u.email, hash, u.role);
      log(`✅ Usuário criado: ${u.email}`);
    } else {
      log(`⏩ Já existe: ${u.email}`);
    }
  }

  // ----------------------------------------
  // 2️⃣ Vínculo usuário ↔ medidor (user_meters)
  // ----------------------------------------
  const allMeters = db.prepare("SELECT id, name FROM meters").all();
  const allUsers = db.prepare("SELECT id, email FROM users WHERE role='user'").all();

  if (!allMeters.length) {
    log("⚠️ Nenhum medidor encontrado. Execute antes o seedMeters.cjs");
    db.close();
    return;
  }

  const linkStmt = db.prepare(
    "INSERT OR IGNORE INTO user_meters (user_id, meter_id) VALUES (?, ?)"
  );

  for (let i = 0; i < allUsers.length; i++) {
    const user = allUsers[i];
    const meter = allMeters[i % allMeters.length]; // vincula ciclicamente
    if (meter) {
      linkStmt.run(user.id, meter.id);
      log(`🔗 ${user.email} vinculado a ${meter.name}`);
    }
  }

  log("🎯 Usuários e vínculos criados com sucesso!");
  db.close();
}

seed();
