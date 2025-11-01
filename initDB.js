// ===============================
// initDB.js - Criação do Banco
// ===============================
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Caminho do banco — usa variável de ambiente se existir (Render)
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'consumo.db');
const db = new Database(DB_PATH);

// Função para inicializar o banco
function initDB() {
  console.log('🛠️ Iniciando banco de dados...');

  // Cria tabela de usuários (admin, operadores etc.)
  db.prepare(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'admin',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `).run();

  // Cria tabela de medidores (água, energia, gás etc.)
  db.prepare(`
    CREATE TABLE IF NOT EXISTS meters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('agua', 'energia', 'gas')),
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `).run();

  // Cria tabela de leituras associadas a cada medidor
  db.prepare(`
    CREATE TABLE IF NOT EXISTS readings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      meter_id INTEGER NOT NULL,
      value REAL NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (meter_id) REFERENCES meters (id) ON DELETE CASCADE
    )
  `).run();

  // Verifica se já há algum usuário no sistema
  const count = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
  if (count === 0) {
    console.log('⚠️ Nenhum usuário encontrado. Crie o primeiro admin via /auth/first-admin.');
  } else {
    console.log(`✅ ${count} usuário(s) encontrado(s) no banco.`);
  }

  console.log('✅ Banco de dados inicializado com sucesso!');
  db.close();
}

// Executa a inicialização
initDB();
