// ======================================================
// GESTOR DE CONSUMO — BACKEND PRO (FASE 2 COMPLETA)
// ======================================================

require('dotenv').config();
const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'SEGREDO_LOCAL_123';
const LOG_FILE = path.join(__dirname, 'server.log');

// =============================================
// Função de log
// =============================================
function logEvent(message) {
  const timestamp = new Date().toLocaleString('pt-BR');
  const line = `[${timestamp}] ${message}\n`;
  fs.appendFileSync(LOG_FILE, line);
  console.log(message);
}

// =============================================
// Inicializa banco e tabelas
// =============================================
function initDatabase() {
  logEvent('🛠️ Verificando estrutura do banco...');
  const db = new Database('consumo.db');

  // ------------------- Usuários -------------------
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

  // ------------------- Medidores -------------------
  db.prepare(`
    CREATE TABLE IF NOT EXISTS meters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `).run();

  // ------------------- Leituras -------------------
  db.prepare(`
    CREATE TABLE IF NOT EXISTS readings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      meter_id TEXT,
      meter_name TEXT,
      type TEXT,
      value REAL,
      pa REAL, pb REAL, pc REAL, pt REAL,
      epa_c REAL, epb_c REAL, epc_c REAL, ept_c REAL,
      iarms REAL, ibrms REAL, icrms REAL,
      uarms REAL, ubrms REAL, ucrms REAL,
      consumo_litros REAL, vazao_lh REAL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `).run();

  // ------------------- Metas -------------------
  db.prepare(`
    CREATE TABLE IF NOT EXISTS goals (
      meter_id TEXT PRIMARY KEY,
      meter_name TEXT NOT NULL,
      goal_daily REAL NOT NULL,
      warn_percent INTEGER NOT NULL
    )
  `).run();

  // ------------------- NOVAS TABELAS — FASE 2 -------------------
  // Imóveis
  db.prepare(`
    CREATE TABLE IF NOT EXISTS imoveis (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL,
      endereco TEXT,
      responsavel TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `).run();

  // Leituras detalhadas (vinculadas a imóvel e medidor)
  db.prepare(`
    CREATE TABLE IF NOT EXISTS leituras (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      medidor_id INTEGER,
      imovel_id INTEGER,
      data_leitura TEXT NOT NULL,
      valor REAL NOT NULL,
      FOREIGN KEY (medidor_id) REFERENCES meters(id),
      FOREIGN KEY (imovel_id) REFERENCES imoveis(id)
    )
  `).run();

  // Funcionários
  db.prepare(`
    CREATE TABLE IF NOT EXISTS funcionarios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL,
      cargo TEXT,
      salario_base REAL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `).run();

  // Vales (adiantamentos)
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

  // ------------------- Admin automático -------------------
  const admin = db.prepare('SELECT * FROM users WHERE email = ?').get('thiago@teste.com');
  if (!admin) {
    const hash = bcrypt.hashSync('123456', 10);
    db.prepare('INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)').run(
      'Thiago Tank',
      'thiago@teste.com',
      hash,
      'admin'
    );
    logEvent('✅ Admin padrão criado: thiago@teste.com / 123456');
  } else {
    logEvent('👤 Admin já existe — sem recriação.');
  }

  return db;
}

const db = initDatabase();

// =============================================
// Configurações do servidor
// =============================================
app.use(cors());
app.use(express.json({ limit: '2mb' }));

// =============================================
// Rota de status
// =============================================
app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Servidor ativo!', engine: 'sqlite' });
});

// =============================================
// Login
// =============================================
app.post('/auth/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!user) {
      logEvent(`❌ Tentativa de login: usuário não encontrado (${email})`);
      return res.status(401).json({ error: 'Usuário não encontrado' });
    }
    const valid = bcrypt.compareSync(password, user.password);
    if (!valid) {
      logEvent(`⚠️ Senha incorreta para: ${email}`);
      return res.status(401).json({ error: 'Senha incorreta' });
    }

    const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '12h' });
    logEvent(`✅ Login bem-sucedido: ${email}`);
    res.json({ token, user: { id: user.id, name: user.name, role: user.role } });
  } catch (err) {
    logEvent(`❌ ERRO login: ${err.message}`);
    res.status(500).json({ error: 'Erro interno no login' });
  }
});

// =============================================
// Leituras rápidas (dashboard)
// =============================================
app.get('/api/readings', (req, res) => {
  const rows = db.prepare('SELECT * FROM readings ORDER BY id DESC LIMIT 50').all();
  res.json(rows);
});

// =============================================
// CRUD — IMÓVEIS
// =============================================
app.get('/api/imoveis', (req, res) => {
  const imoveis = db.prepare('SELECT * FROM imoveis ORDER BY id DESC').all();
  res.json(imoveis);
});

app.post('/api/imoveis', (req, res) => {
  const { nome, endereco, responsavel } = req.body;
  db.prepare('INSERT INTO imoveis (nome, endereco, responsavel) VALUES (?, ?, ?)').run(nome, endereco, responsavel);
  res.json({ message: 'Imóvel cadastrado com sucesso!' });
});

// =============================================
// LEITURAS POR IMÓVEL
// =============================================
app.get('/api/leituras/:imovel_id', (req, res) => {
  const { imovel_id } = req.params;
  const rows = db.prepare(`
    SELECT l.*, m.name AS medidor_nome 
    FROM leituras l 
    LEFT JOIN meters m ON l.medidor_id = m.id 
    WHERE imovel_id = ?
    ORDER BY data_leitura DESC
  `).all(imovel_id);
  res.json(rows);
});

app.post('/api/leituras', (req, res) => {
  const { medidor_id, imovel_id, data_leitura, valor } = req.body;
  db.prepare('INSERT INTO leituras (medidor_id, imovel_id, data_leitura, valor) VALUES (?, ?, ?, ?)')
    .run(medidor_id, imovel_id, data_leitura, valor);
  res.json({ message: 'Leitura registrada com sucesso!' });
});

// =============================================
// FUNCIONÁRIOS E VALES
// =============================================
app.get('/api/funcionarios', (req, res) => {
  res.json(db.prepare('SELECT * FROM funcionarios ORDER BY id DESC').all());
});

app.post('/api/funcionarios', (req, res) => {
  const { nome, cargo, salario_base } = req.body;
  db.prepare('INSERT INTO funcionarios (nome, cargo, salario_base) VALUES (?, ?, ?)').run(nome, cargo, salario_base);
  res.json({ message: 'Funcionário adicionado!' });
});

app.get('/api/vales/:funcionario_id', (req, res) => {
  const vales = db.prepare('SELECT * FROM vales WHERE funcionario_id = ? ORDER BY data DESC').all(req.params.funcionario_id);
  res.json(vales);
});

app.post('/api/vales', (req, res) => {
  const { funcionario_id, data, valor, descricao } = req.body;
  db.prepare('INSERT INTO vales (funcionario_id, data, valor, descricao) VALUES (?, ?, ?, ?)')
    .run(funcionario_id, data, valor, descricao);
  res.json({ message: 'Vale registrado com sucesso!' });
});

// =============================================
// Inicialização do Servidor
// =============================================
app.listen(PORT, () => {
  logEvent(`🚀 Servidor rodando na porta ${PORT} [local:sqlite]`);
});
