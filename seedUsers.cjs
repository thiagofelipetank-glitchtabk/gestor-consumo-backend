// Cria usuários adicionais de teste (além do admin padrão do initDB)
const Database = require("better-sqlite3");
const bcrypt = require("bcrypt");

const db = new Database("consumo.db");
db.pragma("journal_mode = wal");

const users = [
  { name: "Operador 1", email: "op1@teste.com", password: "123456", role: "user" },
  { name: "Operador 2", email: "op2@teste.com", password: "123456", role: "user" }
];

for (const u of users) {
  const exists = db.prepare("SELECT 1 FROM users WHERE email=?").get(u.email);
  if (!exists) {
    const hash = bcrypt.hashSync(u.password, 10);
    db.prepare("INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)")
      .run(u.name, u.email, hash, u.role);
    console.log(`[seedUsers] ✅ Criado: ${u.email} / ${u.role}`);
  } else {
    console.log(`[seedUsers] ↪️ Já existe: ${u.email}`);
  }
}

db.close();
console.log("[seedUsers] ✅ Finalizado");
