// ============================================================
// GESTOR DE CONSUMO — BACKEND PRO 4.1
// ============================================================

import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

// ------------------------------------------------------------
// CONFIGURAÇÕES INICIAIS
// ------------------------------------------------------------
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());

// ------------------------------------------------------------
// CORS (origens permitidas)
// ------------------------------------------------------------
const allowedOrigins = (process.env.CORS_ORIGIN || "").split(",");
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Origem não permitida pelo CORS"));
      }
    },
  })
);

// ------------------------------------------------------------
// BANCO DE DADOS
// ------------------------------------------------------------
const dbPath = process.env.DB_FILE || "./consumo.db";
if (!fs.existsSync(dbPath)) {
  console.log("📦 Criando banco de dados inicial...");
  fs.writeFileSync(dbPath, "");
}
const db = new Database(dbPath);

// ------------------------------------------------------------
// VARIÁVEIS DE AMBIENTE
// ------------------------------------------------------------
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "fallback_secret";

// ------------------------------------------------------------
// TESTE DE CONEXÃO
// ------------------------------------------------------------
app.get("/", (req, res) => {
  res.send("🚀 API do Gestor de Consumo ativa e funcional!");
});
// ------------------------------------------------------------
// CRIAÇÃO DE TABELAS
// ------------------------------------------------------------
db.prepare(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    email TEXT UNIQUE,
    password TEXT,
    role TEXT DEFAULT 'user',
    allowed_meters TEXT DEFAULT '[]'
  )
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS meters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    type TEXT CHECK(type IN ('agua','energia')),
    location TEXT
  )
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS readings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    meter_id INTEGER,
    type TEXT,
    value REAL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS tariffs (
    id INTEGER PRIMARY KEY CHECK (id=1),
    kwh_price REAL DEFAULT 0,
    m3_price REAL DEFAULT 0
  )
`).run();

if (!db.prepare("SELECT * FROM tariffs WHERE id=1").get()) {
  db.prepare("INSERT INTO tariffs (id, kwh_price, m3_price) VALUES (1, 0.95, 3.5)").run();
}
// ------------------------------------------------------------
// FUNÇÕES AUXILIARES
// ------------------------------------------------------------
function createToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    JWT_SECRET,
    { expiresIn: "12h" }
  );
}

function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: "Token ausente" });

  const token = header.split(" ")[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch {
    return res.status(403).json({ error: "Token inválido" });
  }
}
// ------------------------------------------------------------
// ROTAS DE AUTENTICAÇÃO
// ------------------------------------------------------------
app.post("/auth/register", async (req, res) => {
  try {
    const { name, email, password, role } = req.body;
    if (!email || !password) return res.status(400).json({ error: "Campos obrigatórios ausentes" });

    const hashed = await bcrypt.hash(password, 10);
    const stmt = db.prepare("INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)");
    stmt.run(name, email, hashed, role || "user");
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = db.prepare("SELECT * FROM users WHERE email=?").get(email);
    if (!user) return res.status(400).json({ error: "Usuário não encontrado" });

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ error: "Senha incorreta" });

    const token = createToken(user);
    res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        allowed_meters: JSON.parse(user.allowed_meters || "[]"),
      },
    });
  } catch (e) {
    res.status(500).json({ error: "Erro interno ao fazer login" });
  }
});
// ------------------------------------------------------------
// ROTAS DE MEDIDORES
// ------------------------------------------------------------
app.get("/api/meters", (req, res) => {
  const rows = db.prepare("SELECT * FROM meters ORDER BY id DESC").all();
  res.json(rows);
});

app.post("/api/meters", authMiddleware, (req, res) => {
  if (req.user.role !== "admin") return res.status(403).json({ error: "Acesso negado" });
  const { name, type, location } = req.body;
  db.prepare("INSERT INTO meters (name, type, location) VALUES (?, ?, ?)").run(name, type, location);
  res.json({ success: true });
});

// ------------------------------------------------------------
// ROTAS DE LEITURAS
// ------------------------------------------------------------
app.get("/api/readings", (req, res) => {
  const { tipo, limit = 100 } = req.query;
  const sql = tipo
    ? "SELECT * FROM readings WHERE type=? ORDER BY id DESC LIMIT ?"
    : "SELECT * FROM readings ORDER BY id DESC LIMIT ?";
  const rows = tipo ? db.prepare(sql).all(tipo, limit) : db.prepare(sql).all(limit);
  res.json(rows);
});

app.post("/api/readings", (req, res) => {
  const { meter_id, type, value } = req.body;
  db.prepare("INSERT INTO readings (meter_id, type, value) VALUES (?, ?, ?)").run(meter_id, type, value);
  res.json({ success: true });
});

// ------------------------------------------------------------
// TARIFAS
// ------------------------------------------------------------
app.get("/api/tariffs", (req, res) => {
  const row = db.prepare("SELECT * FROM tariffs WHERE id=1").get();
  res.json(row || { kwh_price: 0, m3_price: 0 });
});

app.post("/api/tariffs", authMiddleware, (req, res) => {
  if (req.user.role !== "admin") return res.status(403).json({ error: "Acesso negado" });
  const { kwh_price, m3_price } = req.body;
  db.prepare("UPDATE tariffs SET kwh_price=?, m3_price=? WHERE id=1").run(kwh_price, m3_price);
  res.json({ success: true });
});
// ------------------------------------------------------------
// INICIAR SERVIDOR
// ------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`✅ Servidor ativo na porta ${PORT}`);
});
