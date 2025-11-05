// ======================================================
// GESTOR DE CONSUMO — BACKEND PRO (FASE 4: USUÁRIOS + PERMISSÕES POR MEDIDOR)
// Mantém: Leituras GET/POST, Tokens, Reset com Histórico, Metas, Imóveis
// Remove: Funcionários/Vales (conforme solicitado)
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

// =============================================
// Log helper
// =============================================
function logEvent(message) {
  const timestamp = new Date().toLocaleString('pt-BR');
  const line = `[${timestamp}] ${message}\n`;
  fs.appendFileSync(LOG_FILE, line);
  console.log(message);
}

// =============================================
// Helpers
// =============================================
function generateToken() {
  return 'METER-' + crypto.randomBytes(4).toString('hex').toUpperCase();
}
function safeNumber(n) {
  if (n === undefined || n === null) return null;
  const v = Number(n);
  return Number.isFinite(v) ? v : null;
}
function parseDateOnly(d) {
  if (!d) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  return null;
}

// =============================================
// DB init + migrate
// =============================================
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

  // Permissões de usuário por medidor (N:N)
  db.prepare(`
    CREATE TABLE IF NOT EXISTS user_meters (
      user_id INTEGER NOT NULL,
      meter_id INTEGER NOT NULL,
      PRIMARY KEY (user_id, meter_id),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (meter_id) REFERENCES meters(id)
    )
  `).run();

  // Medidores
  db.prepare(`
    CREATE TABLE IF NOT EXISTS meters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT NOT NULL,         -- 'agua' | 'energia'
      token TEXT,                 -- token de envio do equipamento
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `).run();

  // Leituras (ativas)
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

  // Histórico de leituras (backup em reset)
  db.prepare(`
    CREATE TABLE IF NOT EXISTS readings_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      meter_id INTEGER,
      meter_name TEXT,
      type TEXT,
      value REAL,
      consumo_litros REAL,
      vazao_lh REAL,
      created_at DATETIME,
      backup_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      cycle_tag TEXT,
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

  // Imóveis (mantidos)
  db.prepare(`
    CREATE TABLE IF NOT EXISTS imoveis (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL,
      endereco TEXT,
      responsavel TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `).run();

  // Admin padrão
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
  }

  // Migrações leves
  verifyDatabaseStructure(db);

  return db;
}

function verifyDatabaseStructure(db) {
  logEvent('🔍 Verificando estrutura/migrações...');

  const colExists = (table, name) =>
    db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === name);

  // Garantir coluna token em meters
  if (!colExists('meters', 'token')) {
    logEvent("🧭 Adicionando coluna 'token' em meters...");
    db.prepare('ALTER TABLE meters ADD COLUMN token TEXT').run();
  }

  // Popular token se vazio
  const metersNoToken = db.prepare("SELECT id,name FROM meters WHERE token IS NULL OR token = ''").all();
  metersNoToken.forEach(m => {
    const t = generateToken();
    db.prepare('UPDATE meters SET token = ? WHERE id = ?').run(t, m.id);
    logEvent(`🔑 Token gerado para medidor ${m.name}: ${t}`);
  });

  // Garantir coluna value em readings
  if (!colExists('readings', 'value')) {
    logEvent("🧩 Adicionando coluna 'value' à readings...");
    db.prepare('ALTER TABLE readings ADD COLUMN value REAL').run();
  }

  logEvent('🎯 Estrutura OK');
}

const db = initDatabase();

// =============================================
// Middlewares
// =============================================
app.use(cors());
app.use(express.json({ limit: '2mb' }));

function authRequired(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

function adminOnly(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin only' });
  }
  next();
}

// =============================================
// Health
// =============================================
app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Servidor ativo!', engine: 'sqlite' });
});

// =============================================
// Auth
// =============================================
app.post('/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user) return res.status(401).json({ error: 'Usuário não encontrado' });
  const valid = bcrypt.compareSync(password, user.password);
  if (!valid) return res.status(401).json({ error: 'Senha incorreta' });

  // Carregar permissões (lista de meter_ids)
  const perms = db.prepare('SELECT meter_id FROM user_meters WHERE user_id = ?').all(user.id).map(r => r.meter_id);

  const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '12h' });
  res.json({
    token,
    user: {
      id: user.id,
      name: user.name,
      role: user.role,
      meter_ids_permitidos: perms
    }
  });
});
// =============================================
// USERS — CRUD + Permissões (ADMIN)
// =============================================

// Listar usuários (admin)
app.get('/api/users', authRequired, adminOnly, (req, res) => {
  const users = db.prepare(`SELECT id, name, email, role, created_at FROM users ORDER BY id DESC`).all();
  const result = users.map(u => {
    const meters = db.prepare('SELECT meter_id FROM user_meters WHERE user_id = ?').all(u.id).map(m => m.meter_id);
    return { ...u, meter_ids_permitidos: meters };
  });
  res.json(result);
});

// Criar usuário (admin)
app.post('/api/users', authRequired, adminOnly, (req, res) => {
  const { name, email, password, role, meter_ids_permitidos } = req.body || {};
  if (!name || !email || !password) return res.status(400).json({ error: 'Preencha name, email, password' });
  const hash = bcrypt.hashSync(password, 10);
  try {
    const info = db.prepare('INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)').run(
      name, email, hash, role === 'user' ? 'user' : 'admin'
    );
    const userId = info.lastInsertRowid;

    // Permissões
    db.prepare('DELETE FROM user_meters WHERE user_id = ?').run(userId);
    if (Array.isArray(meter_ids_permitidos)) {
      const stmt = db.prepare('INSERT OR IGNORE INTO user_meters (user_id, meter_id) VALUES (?, ?)');
      meter_ids_permitidos.forEach(mid => stmt.run(userId, Number(mid)));
    }

    res.json({ message: 'Usuário criado!', id: userId });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return res.status(409).json({ error: 'E-mail já cadastrado' });
    return res.status(500).json({ error: 'Erro ao criar usuário' });
  }
});

// Atualizar usuário (admin)
app.patch('/api/users/:id', authRequired, adminOnly, (req, res) => {
  const { id } = req.params;
  const { name, email, password, role, meter_ids_permitidos } = req.body || {};

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) return res.status(404).json({ error: 'Usuário não encontrado' });

  const newName = name ?? user.name;
  const newEmail = email ?? user.email;
  const newRole = role === 'user' ? 'user' : (role === 'admin' ? 'admin' : user.role);
  const newPassHash = password ? bcrypt.hashSync(password, 10) : user.password;

  try {
    db.prepare('UPDATE users SET name=?, email=?, password=?, role=? WHERE id=?')
      .run(newName, newEmail, newPassHash, newRole, id);

    if (meter_ids_permitidos) {
      db.prepare('DELETE FROM user_meters WHERE user_id = ?').run(id);
      if (Array.isArray(meter_ids_permitidos)) {
        const stmt = db.prepare('INSERT OR IGNORE INTO user_meters (user_id, meter_id) VALUES (?, ?)');
        meter_ids_permitidos.forEach(mid => stmt.run(id, Number(mid)));
      }
    }

    res.json({ message: 'Usuário atualizado!' });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return res.status(409).json({ error: 'E-mail já cadastrado' });
    return res.status(500).json({ error: 'Erro ao atualizar usuário' });
  }
});

// Excluir usuário (admin)
app.delete('/api/users/:id', authRequired, adminOnly, (req, res) => {
  const { id } = req.params;
  db.prepare('DELETE FROM user_meters WHERE user_id = ?').run(id);
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  res.json({ message: 'Usuário removido!' });
});

// =============================================
// MEDIDORES — CRUD + Token (com filtro por permissão na listagem)
// =============================================
app.get('/api/meters', authRequired, (req, res) => {
  let rows = db.prepare('SELECT * FROM meters ORDER BY id DESC').all();

  if (req.user.role !== 'admin') {
    const allowed = db.prepare('SELECT meter_id FROM user_meters WHERE user_id = ?').all(req.user.id).map(r => r.meter_id);
    rows = rows.filter(m => allowed.includes(m.id));
  }
  res.json(rows);
});

app.post('/api/meters', authRequired, adminOnly, (req, res) => {
  const { name, type } = req.body || {};
  if (!name || !type) return res.status(400).json({ error: 'Informe name e type' });
  const token = generateToken();
  db.prepare('INSERT INTO meters (name, type, token) VALUES (?, ?, ?)').run(name, type, token);
  res.json({ message: 'Medidor criado!', token });
});

app.post('/api/meters/:id/token/regenerate', authRequired, adminOnly, (req, res) => {
  const { id } = req.params;
  const newToken = generateToken();
  db.prepare('UPDATE meters SET token = ? WHERE id = ?').run(newToken, id);
  res.json({ message: 'Novo token gerado!', newToken });
});

app.delete('/api/meters/:id', authRequired, adminOnly, (req, res) => {
  const { id } = req.params;
  db.prepare('DELETE FROM readings WHERE meter_id = ?').run(id);
  db.prepare('DELETE FROM meters WHERE id = ?').run(id);
  db.prepare('DELETE FROM user_meters WHERE meter_id = ?').run(id);
  res.json({ message: 'Medidor excluído com sucesso!' });
});

// =============================================
// RESET SEGURO — Backup + Zerar leituras ativas (admin)
// =============================================
app.post('/api/meters/:id/reset', authRequired, adminOnly, (req, res) => {
  const { id } = req.params;
  const { cycle_tag } = req.body || {};

  const copy = db.prepare(`
    INSERT INTO readings_history (meter_id, meter_name, type, value, consumo_litros, vazao_lh, created_at, cycle_tag)
    SELECT meter_id, meter_name, type, value, consumo_litros, vazao_lh, created_at, ?
    FROM readings WHERE meter_id = ?
  `).run(cycle_tag || 'Reset Manual', id);

  db.prepare('DELETE FROM readings WHERE meter_id = ?').run(id);

  logEvent(`♻️ Reset aplicado no medidor ID ${id} — backup ${copy.changes} linhas — tag: ${cycle_tag || 'Reset Manual'}`);
  res.json({ message: 'Medidor resetado e histórico salvo com sucesso!', backup_rows: copy.changes });
});

// =============================================
// LEITURAS — Receber (POST/GET) e Listar (com permissão)
// =============================================

// Receber via POST (equipamento) — autenticado por token do medidor
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

// GET dual: se vier token+dado → grava; senão → lista com filtros e permissão
app.get('/api/readings', authRequired, (req, res) => {
  const q = req.query || {};

  // Modo "recebimento via GET" (equipamento enviando por query) — NÃO exige auth
  const maybeToken = q.token || req.headers['x-meter-token'];
  const hasWriteParams = (q.value !== undefined) || (q.consumo_litros !== undefined) || (q.vazao_lh !== undefined);

  if (maybeToken && hasWriteParams) {
    // Libera gravação mesmo sem bearer: chamaremos esta rota sem middleware em uma sub-pilha
    return res.status(400).json({ error: 'Para envio via GET, utilize /api/readings/raw?token=... (rota sem auth).' });
  }

  // Listagem com filtros + permissão
  const clauses = [];
  const params = [];

  if (q.tipo === 'agua' || q.tipo === 'energia') {
    clauses.push('type = ?');
    params.push(q.tipo);
  }

  const from = parseDateOnly(q.from);
  const to = parseDateOnly(q.to);
  if (from) { clauses.push("date(created_at) >= date(?)"); params.push(from); }
  if (to)   { clauses.push("date(created_at) <= date(?)"); params.push(to); }

  // Filtrar por permissão do usuário
  let allowedMeterIds = null;
  if (req.user.role !== 'admin') {
    allowedMeterIds = db.prepare('SELECT meter_id FROM user_meters WHERE user_id = ?').all(req.user.id).map(r => r.meter_id);
    if (allowedMeterIds.length === 0) return res.json([]); // nenhum permitido
    clauses.push(`meter_id IN (${allowedMeterIds.map(() => '?').join(',')})`);
    params.push(...allowedMeterIds);
  }

  const where = clauses.length ? ('WHERE ' + clauses.join(' AND ')) : '';
  const limit = Math.max(1, Math.min(Number(q.limit) || 200, 2000));

  const rows = db.prepare(`SELECT * FROM readings ${where} ORDER BY id DESC LIMIT ${limit}`).all(...params);
  res.json(rows);
});

// Rota SEM AUTH para equipamento enviar via GET
app.get('/api/readings/raw', (req, res) => {
  const q = req.query || {};
  const token = q.token || req.headers['x-meter-token'];
  const hasWrite = (q.value !== undefined) || (q.consumo_litros !== undefined) || (q.vazao_lh !== undefined);
  if (!token || !hasWrite) return res.status(400).json({ error: 'Forneça token e ao menos um valor (value/consumo_litros/vazao_lh)' });

  const meter = db.prepare('SELECT * FROM meters WHERE token = ?').get(token);
  if (!meter) return res.status(404).json({ error: 'Medidor não encontrado (token inválido)' });

  db.prepare(`
    INSERT INTO readings (meter_id, meter_name, type, value, consumo_litros, vazao_lh)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    meter.id,
    meter.name,
    meter.type,
    safeNumber(q.value),
    safeNumber(q.consumo_litros),
    safeNumber(q.vazao_lh)
  );

  logEvent(`📥 (GET RAW) Leitura recebida: ${meter.name} (${meter.type})`);
  res.json({ message: 'Leitura registrada com sucesso (via GET)!', meter: meter.name });
});

// =============================================
// GOALS — (simples)
// =============================================
app.get('/api/goals', authRequired, (req, res) => {
  const rows = db.prepare('SELECT * FROM goals').all();
  res.json(rows);
});

app.post('/api/goals', authRequired, adminOnly, (req, res) => {
  const { meter_id, meter_name, goal_daily, warn_percent } = req.body || {};
  if (!meter_name || !goal_daily || !warn_percent) {
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

// =============================================
// IMÓVEIS — (mantidos)
// =============================================
app.get('/api/imoveis', authRequired, (req, res) => {
  const rows = db.prepare('SELECT * FROM imoveis ORDER BY id DESC').all();
  res.json(rows);
});

app.post('/api/imoveis', authRequired, adminOnly, (req, res) => {
  const { nome, endereco, responsavel } = req.body || {};
  if (!nome) return res.status(400).json({ error: 'Informe o nome do imóvel' });
  db.prepare('INSERT INTO imoveis (nome, endereco, responsavel) VALUES (?, ?, ?)').run(
    nome, endereco || null, responsavel || null
  );
  res.json({ message: 'Imóvel cadastrado com sucesso!' });
});

// =============================================
// Start
// =============================================
app.listen(PORT, () => {
  logEvent(`🚀 Servidor rodando na porta ${PORT} [local:sqlite]`);
});
