// ======================================================
// GESTOR DE CONSUMO — BACKEND PRO 4.4
// Reset Seguro + Histórico (backup) + Restore + Filtros
// Mantém: Login, Medidores, Goals, Imóveis, Funcionários, Vales
// ======================================================

require('dotenv').config();
const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'SEGREDO_LOCAL_123';
const LOG_FILE = path.join(__dirname, 'server.log');

// ---------------------------------------------
// Log helper
// ---------------------------------------------
function logEvent(message) {
  const timestamp = new Date().toLocaleString('pt-BR');
  const line = `[${timestamp}] ${message}\n`;
  fs.appendFileSync(LOG_FILE, line);
  console.log(message);
}

// ---------------------------------------------
// Helpers
// ---------------------------------------------
function generateToken() {
  return 'METER-' + crypto.randomBytes(4).toString('hex').toUpperCase();
}
function safeNumber(n) {
  if (n === undefined || n === null || n === '') return null;
  const v = Number(n);
  return Number.isFinite(v) ? v : null;
}
function parseDateOnly(d) {
  if (!d) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
}
function columnExists(db, table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === column);
}

// ---------------------------------------------
// DB init + migrate
// ---------------------------------------------
function initDatabase() {
  logEvent('🛠️ Inicializando banco consumo.db ...');
  const db = new Database('consumo.db');

  // Usuários
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

  // Medidores
  db.prepare(`
    CREATE TABLE IF NOT EXISTS meters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT NOT NULL,      -- 'agua' | 'energia'
      token TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `).run();

  // Leituras ativas
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

  // Histórico/Backup de leituras (após reset)
  db.prepare(`
    CREATE TABLE IF NOT EXISTS readings_backup (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cycle_tag TEXT,                 -- etiqueta do ciclo
      meter_id INTEGER,
      meter_name TEXT,
      type TEXT,
      value REAL,
      consumo_litros REAL,
      vazao_lh REAL,
      created_at DATETIME,            -- data original da leitura
      backup_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (meter_id) REFERENCES meters(id)
    )
  `).run();

  // Metas
  db.prepare(`
    CREATE TABLE IF NOT EXISTS goals (
      meter_id TEXT PRIMARY KEY,
      meter_name TEXT NOT NULL,
      goal_daily REAL NOT NULL,
      warn_percent INTEGER NOT NULL
    )
  `).run();

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

  // Vales
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

  // Admin padrão
  const admin = db.prepare('SELECT * FROM users WHERE email = ?').get('thiago@teste.com');
  if (!admin) {
    const hash = bcrypt.hashSync('123456', 10);
    db.prepare('INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)').run(
      'Thiago Tank', 'thiago@teste.com', hash, 'admin'
    );
    logEvent('✅ Admin padrão criado: thiago@teste.com / 123456');
  }

  // Migrações leves
  verifyDatabaseStructure(db);

  return db;
}

function verifyDatabaseStructure(db) {
  logEvent('🔍 Verificando estrutura/migrações...');

  // Garantir token em meters
  if (!columnExists(db, 'meters', 'token')) {
    logEvent("🧭 Adicionando coluna 'token' em meters...");
    db.prepare('ALTER TABLE meters ADD COLUMN token TEXT').run();
  }
  const needToken = db.prepare("SELECT id,name FROM meters WHERE token IS NULL OR token = ''").all();
  needToken.forEach(m => {
    const t = generateToken();
    db.prepare('UPDATE meters SET token = ? WHERE id = ?').run(t, m.id);
    logEvent(`🔑 Token gerado para medidor ${m.name}: ${t}`);
  });

  // Garantir 'value' em readings (caso instalações antigas)
  if (!columnExists(db, 'readings', 'value')) {
    logEvent("🧩 Adicionando coluna 'value' à readings...");
    db.prepare('ALTER TABLE readings ADD COLUMN value REAL').run();
  }

  logEvent('🎯 Estrutura OK');
}

const db = initDatabase();

// ---------------------------------------------
// Middlewares
// ---------------------------------------------
app.use(cors());
app.use(express.json({ limit: '2mb' }));

// ---------------------------------------------
// Health
// ---------------------------------------------
app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Servidor ativo!', engine: 'sqlite' });
});

// ---------------------------------------------
// Auth (simples)
// ---------------------------------------------
app.post('/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user) return res.status(401).json({ error: 'Usuário não encontrado' });
  const valid = bcrypt.compareSync(password, user.password);
  if (!valid) return res.status(401).json({ error: 'Senha incorreta' });

  const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '12h' });
  res.json({ token, user: { id: user.id, name: user.name, role: user.role } });
});

// ---------------------------------------------
// MEDIDORES — CRUD + Token + Reset
// ---------------------------------------------
app.get('/api/meters', (req, res) => {
  const rows = db.prepare('SELECT * FROM meters ORDER BY id DESC').all();
  res.json(rows);
});

app.post('/api/meters', (req, res) => {
  const { name, type } = req.body || {};
  if (!name || !type) return res.status(400).json({ error: 'Informe name e type' });
  const token = generateToken();
  db.prepare('INSERT INTO meters (name, type, token) VALUES (?, ?, ?)').run(name, type, token);
  res.json({ message: 'Medidor criado!', token });
});

app.post('/api/meters/:id/token/regenerate', (req, res) => {
  const { id } = req.params;
  const newToken = generateToken();
  db.prepare('UPDATE meters SET token = ? WHERE id = ?').run(newToken, id);
  res.json({ message: 'Novo token gerado!', newToken });
});

app.delete('/api/meters/:id', (req, res) => {
  const { id } = req.params;
  db.prepare('DELETE FROM readings WHERE meter_id = ?').run(id);
  db.prepare('DELETE FROM meters WHERE id = ?').run(id);
  res.json({ message: 'Medidor excluído com sucesso!' });
});

// Reset seguro → copia leituras ativas para backup e limpa as ativas
app.post('/api/meters/:id/reset', (req, res) => {
  const { id } = req.params;
  const { cycle_tag } = req.body || {};

  const copy = db.prepare(`
    INSERT INTO readings_backup (cycle_tag, meter_id, meter_name, type, value, consumo_litros, vazao_lh, created_at)
    SELECT ?, meter_id, meter_name, type, value, consumo_litros, vazao_lh, created_at
    FROM readings WHERE meter_id = ?
  `).run(cycle_tag || 'Reset Manual', id);

  db.prepare('DELETE FROM readings WHERE meter_id = ?').run(id);

  logEvent(`♻️ Reset aplicado no medidor ID ${id} — backup ${copy.changes} leituras — tag: ${cycle_tag || 'Reset Manual'}`);
  res.json({ message: 'Medidor resetado e histórico salvo com sucesso!', backup_rows: copy.changes });
});

// ---------------------------------------------
// Leituras — POST (token) e GET (dois modos)
// ---------------------------------------------

// POST /api/readings  (JSON body; token em query ?token=... ou header x-meter-token)
app.post('/api/readings', (req, res) => {
  const token = req.query.token || req.headers['x-meter-token'];
  if (!token) return res.status(400).json({ error: 'Token não fornecido' });

  const meter = db.prepare('SELECT * FROM meters WHERE token = ?').get(token);
  if (!meter) return res.status(404).json({ error: 'Medidor não encontrado' });

  const { value, consumo_litros, vazao_lh } = req.body || {};
  db.prepare(`
    INSERT INTO readings (meter_id, meter_name, type, value, consumo_litros, vazao_lh)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(meter.id, meter.name, meter.type, safeNumber(value), safeNumber(consumo_litros), safeNumber(vazao_lh));

  logEvent(`📥 (POST) Leitura recebida: ${meter.name} (${meter.type})`);
  res.json({ message: 'Leitura registrada com sucesso!', meter: meter.name });
});

// GET /api/readings
// - Se vier token + (value|consumo_litros|vazao_lh) → registra leitura (compatibilidade GET de equipamento)
// - Caso contrário → lista leituras com filtros (?tipo, ?from, ?to, ?limit)
app.get('/api/readings', (req, res) => {
  const q = req.query || {};

  const maybeToken = q.token || req.headers['x-meter-token'];
  const hasWriteParams = (q.value !== undefined) || (q.consumo_litros !== undefined) || (q.vazao_lh !== undefined);

  if (maybeToken && hasWriteParams) {
    const meter = db.prepare('SELECT * FROM meters WHERE token = ?').get(maybeToken);
    if (!meter) return res.status(404).json({ error: 'Medidor não encontrado (token inválido)' });

    db.prepare(`
      INSERT INTO readings (meter_id, meter_name, type, value, consumo_litros, vazao_lh)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      meter.id, meter.name, meter.type,
      safeNumber(q.value), safeNumber(q.consumo_litros), safeNumber(q.vazao_lh)
    );

    logEvent(`📥 (GET) Leitura recebida: ${meter.name} (${meter.type})`);
    return res.json({ message: 'Leitura registrada com sucesso (via GET)!', meter: meter.name });
  }

  // listagem
  const clauses = [];
  const params = [];

  if (q.tipo === 'agua' || q.tipo === 'energia') {
    clauses.push('type = ?');
    params.push(q.tipo);
  }
  const from = parseDateOnly(q.from);
  const to = parseDateOnly(q.to);
  if (from) { clauses.push('date(created_at) >= date(?)'); params.push(from); }
  if (to)   { clauses.push('date(created_at) <= date(?)'); params.push(to); }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const limit = Math.max(1, Math.min(Number(q.limit) || 50, 2000));

  const rows = db.prepare(`SELECT * FROM readings ${where} ORDER BY id DESC LIMIT ${limit}`).all(...params);
  res.json(rows);
});

// ---------------------------------------------
// BACKUPS — listar e restaurar
// ---------------------------------------------

// GET /api/backups?meter_id=&cycle=&from=&to=&limit=
app.get('/api/backups', (req, res) => {
  const q = req.query || {};
  const clauses = [];
  const params = [];

  if (q.meter_id) { clauses.push('meter_id = ?'); params.push(Number(q.meter_id)); }
  if (q.cycle)    { clauses.push('cycle_tag LIKE ?'); params.push(`%${q.cycle}%`); }

  const from = parseDateOnly(q.from);
  const to = parseDateOnly(q.to);
  if (from) { clauses.push('date(backup_at) >= date(?)'); params.push(from); }
  if (to)   { clauses.push('date(backup_at) <= date(?)'); params.push(to); }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const limit = Math.max(1, Math.min(Number(q.limit) || 200, 5000));

  const rows = db.prepare(`SELECT * FROM readings_backup ${where} ORDER BY backup_at DESC, id DESC LIMIT ${limit}`).all(...params);
  res.json(rows);
});

// POST /api/backups/restore
// Body aceito:
//   - { backup_ids: [1,2,3], purge: true|false }
//   - { meter_id: 5, cycle_tag: "Kitnet 01 — João, nov/2025", purge: true|false }
app.post('/api/backups/restore', (req, res) => {
  const { backup_ids, meter_id, cycle_tag, purge } = req.body || {};

  // seleciona o conjunto que será restaurado
  let rows = [];
  if (Array.isArray(backup_ids) && backup_ids.length) {
    const placeholders = backup_ids.map(() => '?').join(',');
    rows = db.prepare(`SELECT * FROM readings_backup WHERE id IN (${placeholders})`).all(...backup_ids);
  } else if (meter_id && cycle_tag) {
    rows = db.prepare(`SELECT * FROM readings_backup WHERE meter_id = ? AND cycle_tag = ? ORDER BY id ASC`)
      .all(Number(meter_id), String(cycle_tag));
  } else {
    return res.status(400).json({ error: 'Informe backup_ids ou (meter_id + cycle_tag)' });
  }

  if (!rows.length) return res.status(404).json({ error: 'Nenhum backup encontrado para restaurar' });

  const insert = db.prepare(`
    INSERT INTO readings (meter_id, meter_name, type, value, consumo_litros, vazao_lh, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const delByIds = db.prepare(`DELETE FROM readings_backup WHERE id = ?`);

  let restored = 0;
  let removed = 0;
  const trx = db.transaction(() => {
    rows.forEach(r => {
      insert.run(r.meter_id, r.meter_name, r.type, r.value, r.consumo_litros, r.vazao_lh, r.created_at);
      restored++;
      if (purge) {
        delByIds.run(r.id);
        removed++;
      }
    });
  });

  trx();

  logEvent(`🔁 Restore concluído: ${restored} leituras restauradas, purge=${!!purge} (removidas do backup=${removed})`);
  res.json({ message: 'Restore concluído', restored, removed, purge: !!purge });
});

// ---------------------------------------------
// GOALS — simples
// ---------------------------------------------
app.get('/api/goals', (req, res) => {
  const rows = db.prepare('SELECT * FROM goals').all();
  res.json(rows);
});

app.post('/api/goals', (req, res) => {
  const { meter_id, meter_name, goal_daily, warn_percent } = req.body || {};
  if (!meter_name || goal_daily === undefined || warn_percent === undefined) {
    return res.status(400).json({ error: 'Preencha meter_name, goal_daily, warn_percent' });
  }
  db.prepare(`
    INSERT INTO goals (meter_id, meter_name, goal_daily, warn_percent)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(meter_id) DO UPDATE SET
      meter_name=excluded.meter_name,
      goal_daily=excluded.goal_daily,
      warn_percent=excluded.warn_percent
  `).run(meter_id || null, meter_name, safeNumber(goal_daily) || 0, Number(warn_percent) || 90);

  res.json({ message: 'Meta salva!' });
});

// ---------------------------------------------
// IMÓVEIS / FUNCIONÁRIOS / VALES
// ---------------------------------------------
app.get('/api/imoveis', (req, res) => {
  const rows = db.prepare('SELECT * FROM imoveis ORDER BY id DESC').all();
  res.json(rows);
});

app.post('/api/imoveis', (req, res) => {
  const { nome, endereco, responsavel } = req.body || {};
  if (!nome) return res.status(400).json({ error: 'Informe o nome do imóvel' });
  db.prepare('INSERT INTO imoveis (nome, endereco, responsavel) VALUES (?, ?, ?)').run(
    nome, endereco || null, responsavel || null
  );
  res.json({ message: 'Imóvel cadastrado com sucesso!' });
});

app.get('/api/funcionarios', (req, res) => {
  const rows = db.prepare('SELECT * FROM funcionarios ORDER BY id DESC').all();
  res.json(rows);
});

app.post('/api/funcionarios', (req, res) => {
  const { nome, cargo, salario_base } = req.body || {};
  if (!nome) return res.status(400).json({ error: 'Informe o nome do funcionário' });
  db.prepare('INSERT INTO funcionarios (nome, cargo, salario_base) VALUES (?, ?, ?)').run(
    nome, cargo || null, safeNumber(salario_base)
  );
  res.json({ message: 'Funcionário adicionado!' });
});

app.get('/api/vales/:funcionario_id', (req, res) => {
  const rows = db.prepare('SELECT * FROM vales WHERE funcionario_id = ? ORDER BY data DESC').all(
    req.params.funcionario_id
  );
  res.json(rows);
});

app.post('/api/vales', (req, res) => {
  const { funcionario_id, data, valor, descricao } = req.body || {};
  if (!funcionario_id || !data || !valor) return res.status(400).json({ error: 'Preencha funcionario_id, data, valor' });
  db.prepare('INSERT INTO vales (funcionario_id, data, valor, descricao) VALUES (?, ?, ?, ?)').run(
    funcionario_id, data, safeNumber(valor), descricao || null
  );
  res.json({ message: 'Vale registrado com sucesso!' });
});

// ---------------------------------------------
// Start
// ---------------------------------------------
app.listen(PORT, () => {
  logEvent(`🚀 Servidor rodando na porta ${PORT} [local:sqlite]`);
});
