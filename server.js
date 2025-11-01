// ===============================
// 🌐 Gestor de Consumo — Backend Pro
// ===============================

const express = require("express");
const cors = require("cors");
const bcrypt = require("bcrypt");
const Database = require("better-sqlite3");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json());

// -------------------------------
// 📦 Banco de Dados
// -------------------------------
const dbPath = path.join(__dirname, "consumo.db");
const db = new Database(dbPath);

db.prepare(`CREATE TABLE IF NOT EXISTS readings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id TEXT,
  tipo TEXT,
  data TEXT,
  hora TEXT,
  pa REAL, pb REAL, pc REAL, pt REAL,
  epa_c REAL, epb_c REAL, epc_c REAL, ept_c REAL,
  epa_g REAL, epb_g REAL, epc_g REAL, ept_g REAL,
  iarms REAL, ibrms REAL, icrms REAL,
  uarms REAL, ubrms REAL, ucrms REAL,
  consumo_litros REAL, vazao_lh REAL,
  valor REAL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)`).run();

db.prepare(`CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT, email TEXT UNIQUE, password TEXT, role TEXT DEFAULT 'user',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)`).run();

// -------------------------------
// 🩺 Rota de Teste
// -------------------------------
app.get("/health", (req, res) => {
  res.json({ status: "ok", message: "Servidor ativo!" });
});

// -------------------------------
// 👤 Autenticação
// -------------------------------
app.post("/auth/first-admin", (req, res) => {
  const { name, email, password } = req.body;
  const existing = db.prepare("SELECT * FROM users").get();
  if (existing)
    return res
      .status(400)
      .json({ error: "Já existe usuário. Use /auth/login." });

  const hash = bcrypt.hashSync(password, 10);
  db.prepare(
    "INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, 'admin')"
  ).run(name, email, hash);

  res.json({ success: true, message: "Admin criado!" });
});

app.post("/auth/login", (req, res) => {
  const { email, password } = req.body;
  const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
  if (!user) return res.status(401).json({ error: "Usuário não encontrado" });
  const ok = bcrypt.compareSync(password, user.password);
  if (!ok) return res.status(401).json({ error: "Senha incorreta" });
  res.json({
    success: true,
    user: { id: user.id, name: user.name, role: user.role, email: user.email },
  });
});

// -------------------------------
// ⚡ API para Leitura (energia e água)
// -------------------------------
app.post("/api/readings", (req, res) => {
  const d = req.body;

  // energia
  if (d.tipo === "energia") {
    db.prepare(
      `INSERT INTO readings (device_id, tipo, data, hora, pa, pb, pc, pt,
        epa_c, epb_c, epc_c, ept_c, epa_g, epb_g, epc_g, ept_g,
        iarms, ibrms, icrms, uarms, ubrms, ucrms, valor)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      d.id,
      d.tipo,
      d.data,
      d.hora,
      d.pa,
      d.pb,
      d.pc,
      d.pt,
      d.epa_c,
      d.epb_c,
      d.epc_c,
      d.ept_c,
      d.epa_g || 0,
      d.epb_g || 0,
      d.epc_g || 0,
      d.ept_g || 0,
      d.iarms,
      d.ibrms,
      d.icrms,
      d.uarms,
      d.ubrms,
      d.ucrms,
      d.valor || 0
    );
  }

  // água
  if (d.tipo === "agua") {
    db.prepare(
      `INSERT INTO readings (device_id, tipo, data, hora, consumo_litros, vazao_lh, valor)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(d.id, d.tipo, d.data, d.hora, d.consumo_litros, d.vazao_lh, d.valor || 0);
  }

  res.json({ success: true, message: "Leitura registrada com sucesso!" });
});

// -------------------------------
// 📖 GET — Listar leituras
// -------------------------------
app.get("/api/readings", (req, res) => {
  const tipo = req.query.tipo;
  let query = "SELECT * FROM readings";
  if (tipo === "energia") query += " WHERE tipo = 'energia'";
  else if (tipo === "agua") query += " WHERE tipo = 'agua'";
  query += " ORDER BY id DESC LIMIT 100";

  const rows = db.prepare(query).all();
  res.json(rows);
});

// -------------------------------
// 💾 Versão alternativa /api/insert.php (para compatibilidade com medidores)
// -------------------------------
app.post("/api/insert.php", (req, res) => {
  const d = req.body;
  db.prepare(
    `INSERT INTO readings (device_id, tipo, data, hora, pa, pb, pc, pt, epa_c, epb_c, epc_c, ept_c, consumo_litros, vazao_lh)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    d.id || "SEM_ID",
    d.tipo || "desconhecido",
    d.data || new Date().toLocaleDateString("pt-BR"),
    d.hora || new Date().toLocaleTimeString("pt-BR"),
    d.pa || 0,
    d.pb || 0,
    d.pc || 0,
    d.pt || 0,
    d.epa_c || 0,
    d.epb_c || 0,
    d.epc_c || 0,
    d.ept_c || 0,
    d.consumo_litros || 0,
    d.vazao_lh || 0
  );
  res.json({ success: true, message: "Dados recebidos via /api/insert.php" });
});

// -------------------------------
// ⚙️ Inicialização do Servidor
// -------------------------------
const PORT = 3000;
app.listen(PORT, () => console.log(`✅ Servidor rodando em http://localhost:${PORT}`));
