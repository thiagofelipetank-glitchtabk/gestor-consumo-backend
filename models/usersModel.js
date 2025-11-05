// ================================================
// GESTOR DE CONSUMO - Módulo de Usuários (Model)
// ================================================
const db = require('../initDB');
const bcrypt = require('bcrypt');

// Cria tabela se não existir
function createTable() {
  db.prepare(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT DEFAULT 'viewer',
      allowed_meters TEXT DEFAULT '[]'
    )
  `).run();
}

// Lista todos os usuários (sem senha)
function getAll() {
  return db.prepare('SELECT id, name, email, role, allowed_meters FROM users').all();
}

// Busca por e-mail
function getByEmail(email) {
  return db.prepare('SELECT * FROM users WHERE email = ?').get(email);
}

// Busca por ID
function getById(id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

// Cria usuário com hash da senha
async function create(user) {
  const hash = await bcrypt.hash(user.password, 10);
  db.prepare('INSERT INTO users (name, email, password_hash, role, allowed_meters) VALUES (?, ?, ?, ?, ?)')
    .run(user.name, user.email, hash, user.role || 'viewer', JSON.stringify(user.allowed_meters || []));
}

// Atualiza usuário (opcional senha e medidores)
async function update(id, data) {
  const existing = getById(id);
  if (!existing) throw new Error('Usuário não encontrado');
  const name = data.name || existing.name;
  const email = data.email || existing.email;
  const role = data.role || existing.role;
  const allowed_meters = data.allowed_meters ? JSON.stringify(data.allowed_meters) : existing.allowed_meters;
  let password_hash = existing.password_hash;
  if (data.password) password_hash = await bcrypt.hash(data.password, 10);
  db.prepare(`UPDATE users SET name=?, email=?, password_hash=?, role=?, allowed_meters=? WHERE id=?`)
    .run(name, email, password_hash, role, allowed_meters, id);
}

// Remove usuário
function remove(id) {
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
}

module.exports = {
  createTable,
  getAll,
  getByEmail,
  getById,
  create,
  update,
  remove
};
