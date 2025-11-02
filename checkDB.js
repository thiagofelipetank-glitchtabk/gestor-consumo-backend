
// ======================================================
// GESTOR DE CONSUMO — CHECK DB STRUCTURE (SAFE MODE)
// ======================================================
// Corrige o banco sem erro de UNIQUE, adicionando coluna 'token' corretamente.

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'consumo.db');
if (!fs.existsSync(DB_PATH)) {
  console.log("❌ Banco consumo.db não encontrado!");
  process.exit(1);
}

const db = new Database(DB_PATH);
console.log("🔍 Verificando estrutura do banco...");

// ------------------------------------------
// Função para checar se coluna existe
// ------------------------------------------
function columnExists(table, column) {
  const cols = db.prepare(`PRAGMA table_info(${table});`).all();
  return cols.some(c => c.name === column);
}

// ------------------------------------------
// 1. Corrigir tabela meters (sem UNIQUE)
// ------------------------------------------
if (!columnExists('meters', 'token')) {
  console.log("🧭 Adicionando coluna 'token' na tabela meters...");
  db.prepare("ALTER TABLE meters ADD COLUMN token TEXT").run();

  const meters = db.prepare('SELECT * FROM meters WHERE token IS NULL OR token = ""').all();
  meters.forEach(m => {
    const newToken = 'METER-' + Math.random().toString(36).substring(2, 10).toUpperCase();
    db.prepare('UPDATE meters SET token = ? WHERE id = ?').run(newToken, m.id);
    console.log(`✅ Token criado para medidor: ${m.name} (${newToken})`);
  });
} else {
  console.log("✅ Tabela meters já possui coluna 'token'.");
}

// ------------------------------------------
// 2. Corrigir tabela readings (value)
// ------------------------------------------
if (!columnExists('readings', 'value')) {
  console.log("🧩 Adicionando coluna 'value' na tabela readings...");
  db.prepare("ALTER TABLE readings ADD COLUMN value REAL").run();
  console.log("✅ Coluna 'value' adicionada em readings.");
} else {
  console.log("✅ Tabela readings OK.");
}

console.log("🎯 Estrutura do banco verificada e corrigida com sucesso!");
db.close();
>>>>>>> ed9836e (Atualização completa do server.js com suporte GET e POST /api/readings)
