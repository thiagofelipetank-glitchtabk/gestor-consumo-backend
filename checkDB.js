// checkDB.js — ver estrutura do banco
const Database = require("better-sqlite3");
const db = new Database("consumo.db");

try {
  const tables = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table';"
  ).all();
  console.log("📋 Tabelas encontradas:", tables);

  if (tables.some(t => t.name === "users")) {
    const users = db.prepare("SELECT id, name, email, role FROM users;").all();
    console.log("👤 Usuários encontrados:", users);
  } else {
    console.log("⚠️ Nenhuma tabela 'users' encontrada!");
  }
} catch (err) {
  console.error("❌ Erro ao ler banco:", err.message);
}
