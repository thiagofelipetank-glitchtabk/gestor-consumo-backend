const Database = require("better-sqlite3");
const db = new Database("consumo.db");

// Tabela de usuários (já existente)
db.prepare(`
CREATE TABLE IF NOT EXISTS usuarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  usuario TEXT UNIQUE NOT NULL,
  senha TEXT NOT NULL,
  tipo TEXT DEFAULT 'comum'
)
`).run();

// Tabela de medidores (água/energia)
db.prepare(`
CREATE TABLE IF NOT EXISTS medidores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  tipo TEXT CHECK(tipo IN ('agua', 'energia')) NOT NULL,
  localizacao TEXT
)
`).run();

// ✅ NOVO: Tabela de imóveis
db.prepare(`
CREATE TABLE IF NOT EXISTS imoveis (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  endereco TEXT,
  responsavel TEXT
)
`).run();

// ✅ NOVO: Tabela de leituras de consumo
db.prepare(`
CREATE TABLE IF NOT EXISTS leituras (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  medidor_id INTEGER,
  imovel_id INTEGER,
  data_leitura TEXT NOT NULL,
  valor REAL NOT NULL,
  FOREIGN KEY (medidor_id) REFERENCES medidores(id),
  FOREIGN KEY (imovel_id) REFERENCES imoveis(id)
)
`).run();

// ✅ NOVO: Tabelas de funcionários e vales
db.prepare(`
CREATE TABLE IF NOT EXISTS funcionarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  cargo TEXT,
  salario_base REAL
)
`).run();

db.prepare(`
CREATE TABLE IF NOT EXISTS vales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  funcionario_id INTEGER,
  data TEXT NOT NULL,
  valor REAL NOT NULL,
  descricao TEXT,
  FOREIGN KEY (funcionario_id) REFERENCES funcionarios(id)
)
`).run();

console.log("📦 Banco de dados atualizado com sucesso (Fase 2)");
