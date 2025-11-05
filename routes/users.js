// ================================================
// GESTOR DE CONSUMO - Rotas de Usuários (Login + CRUD)
// ================================================
const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const users = require('../models/usersModel');

const router = express.Router();
const SECRET = process.env.JWT_SECRET || 'gestorconsumo2025';

// Garante que a tabela exista ao iniciar
users.createTable();

// =====================================================
// LOGIN / AUTENTICAÇÃO
// =====================================================
router.post('/auth/login', async (req, res) => {
  const { email, password } = req.body;
  const u = users.getByEmail(email);
  if (!u) return res.status(401).json({ error: 'Usuário não encontrado' });

  const ok = await bcrypt.compare(password, u.password_hash);
  if (!ok) return res.status(401).json({ error: 'Senha incorreta' });

  const token = jwt.sign({ id: u.id, role: u.role }, SECRET, { expiresIn: '7d' });
  res.json({
    token,
    user: {
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      allowed_meters: JSON.parse(u.allowed_meters || '[]')
    }
  });
});

// =====================================================
// MIDDLEWARES DE SEGURANÇA
// =====================================================
function auth(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: 'Token ausente' });
  const token = header.split(' ')[1];
  try {
    const decoded = jwt.verify(token, SECRET);
    req.user = decoded;
    next();
  } catch {
    res.status(401).json({ error: 'Token inválido' });
  }
}

function adminOnly(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Acesso restrito' });
  next();
}

// =====================================================
// CRUD DE USUÁRIOS
// =====================================================

// Listar todos (somente admin)
router.get('/api/users', auth, adminOnly, (req, res) => {
  const data = users.getAll();
  res.json(data);
});

// Criar novo usuário
router.post('/api/users', auth, adminOnly, async (req, res) => {
  try {
    await users.create(req.body);
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Atualizar usuário existente
router.put('/api/users/:id', auth, adminOnly, async (req, res) => {
  try {
    await users.update(req.params.id, req.body);
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Deletar usuário
router.delete('/api/users/:id', auth, adminOnly, (req, res) => {
  try {
    users.remove(req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// =====================================================
// EXPORTAÇÃO
// =====================================================
module.exports = router;
