// ============================================================
// GESTOR DE CONSUMO — BACKEND PRO 4.6 (Render Cloud)
// ============================================================

import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import Database from "better-sqlite3";

// ------------------------------------------------------------
// CONFIGURAÇÕES INICIAIS
// ------------------------------------------------------------
dotenv.config();
const app = express();

// Aceita JSON (IE pode enviar urlencoded → habilitamos também)
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

// ------------------------------------------------------------
// CORS (origens permitidas) - use CORS_ORIGIN no .env (separadas por vírgula)
// Ex.: CORS_ORIGIN=https://gestor-consumo-frontend.vercel.app,https://meu-site.com
// ------------------------------------------------------------
const allowedOrigins = (process.env.CORS_ORIGIN || "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      // Permite requisições sem origin (ex.: Postman, curl)
      if (!origin) return callback(null, true);
      if (allowedOrigins.length === 0) return callback(null, true); // se não configurado, libera geral
      if (allowedOrigins.includes(origin)) return callback(null, true);
      console.error(`❌ CORS BLOCKED: ${origin}`);
      return callback(new Error("Origem não permitida pelo CORS"));
    },
    methods: "GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS",
    credentials: true,
  })
);

// ------------------------------------------------------------
// BANCO DE DADOS (better-sqlite3)
// O arquivo é criado pelo initDB.cjs (executado no postinstall no Render)
// ------------------------------------------------------------
const dbPath = process.env.DB_FILE || "./consumo.db";
const db = new Database(dbPath);
db.pragma("journal_mode = wal");

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

    const existingUser = db.prepare("SELECT * FROM users WHERE email=?").get(email);
    if (existingUser) {
      return res.status(400).json({ error: "E-mail já cadastrado." });
    }

    const hashed = await bcrypt.hash(password, 10);
    db.prepare("INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)")
      .run(name || email.split("@")[0], email, hashed, role || "user");
    res.json({ success: true });
  } catch (e) {
    console.error("ERRO AO REGISTRAR:", e);
    res.status(500).json({ error: "Erro interno ao registrar usuário" });
  }
});

app.post("/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body || {};
    const user = db.prepare("SELECT * FROM users WHERE email=?").get(email);
    if (!user) return res.status(400).json({ error: "Usuário não encontrado" });

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ error: "Senha incorreta" });

    const token = createToken(user);
    const allowed_meters = db
      .prepare("SELECT meter_id FROM user_meters WHERE user_id=?")
      .all(user.id)
      .map(r => r.meter_id);

    res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        allowed_meters
      }
    });
  } catch (e) {
    console.error("ERRO AO FAZER LOGIN:", e);
    res.status(500).json({ error: "Erro interno ao fazer login" });
  }
});

// ------------------------------------------------------------
// ROTAS DE MEDIDORES
// ------------------------------------------------------------
app.get("/api/meters", (req, res) => {
  try {
    const rows = db.prepare(
      "SELECT id, name, type, token, created_at FROM meters ORDER BY id DESC"
    ).all();
    res.json(rows);
  } catch (e) {
    console.error("ERRO ao buscar medidores:", e);
    res.status(500).json({ error: "Erro interno ao buscar medidores" });
  }
});

app.post("/api/meters", authMiddleware, (req, res) => {
  try {
    if (req.user.role !== "admin") return res.status(403).json({ error: "Acesso negado" });
    const { name, type } = req.body;
    if (!name || !type) return res.status(400).json({ error: "name e type são obrigatórios" });

    // Gera token simples p/ equipamentos que suportam
    const token = 'METER-' + Math.random().toString(36).substring(2, 10).toUpperCase();
    db.prepare("INSERT INTO meters (name, type, token) VALUES (?, ?, ?)").run(name, type, token);
    const meter = db.prepare("SELECT * FROM meters WHERE id = last_insert_rowid()").get();
    res.json({ success: true, meter });
  } catch (e) {
    console.error("ERRO ao criar medidor:", e);
    res.status(500).json({ error: "Erro interno ao criar medidor" });
  }
});

// ------------------------------------------------------------
// ROTAS DE LEITURAS
// ------------------------------------------------------------
app.get("/api/readings", (req, res) => {
  try {
    const { tipo, limit = 100 } = req.query;
    let sql = "SELECT * FROM readings WHERE 1=1";
    const params = [];
    if (tipo) {
      sql += " AND type=?";
      params.push(tipo);
    }
    sql += " ORDER BY id DESC LIMIT ?";
    params.push(Number(limit));
    const rows = db.prepare(sql).all(...params);
    res.json(rows);
  } catch (e) {
    console.error("ERRO ao buscar leituras:", e);
    res.status(500).json({ error: "Erro interno ao buscar leituras" });
  }
});

// Leituras por medidor
app.get("/api/readings/:meterId", (req, res) => {
  try {
    const { meterId } = req.params;
    const rows = db.prepare(
      "SELECT * FROM readings WHERE meter_id=? ORDER BY id DESC LIMIT 1000"
    ).all(meterId);
    res.json(rows);
  } catch (e) {
    console.error("ERRO ao buscar leituras por medidor:", e);
    res.status(500).json({ error: "Erro interno ao buscar leituras por medidor" });
  }
});

// Última leitura por medidor (helper para dashboard)
app.get("/api/readings/last/:meterId", (req, res) => {
  try {
    const { meterId } = req.params;
    const row = db.prepare(
      "SELECT * FROM readings WHERE meter_id=? ORDER BY id DESC LIMIT 1"
    ).get(meterId);
    res.json(row || null);
  } catch (e) {
    console.error("ERRO ao buscar última leitura:", e);
    res.status(500).json({ error: "Erro interno ao buscar última leitura" });
  }
});

// Inserção manual simples
app.post("/api/readings", (req, res) => {
  try {
    const { meter_id, type, value } = req.body;
    if (!meter_id || !type) return res.status(400).json({ error: "meter_id e type são obrigatórios" });
    const meter = db.prepare("SELECT name, type FROM meters WHERE id=?").get(meter_id);
    if (!meter) return res.status(404).json({ error: "Medidor não encontrado" });

    db.prepare(
      "INSERT INTO readings (meter_id, meter_name, type, value) VALUES (?, ?, ?, ?)"
    ).run(meter_id, meter.name, type, Number(value || 0));
    res.json({ success: true });
  } catch (e) {
    console.error("ERRO ao registrar leitura:", e);
    res.status(500).json({ error: "Erro interno ao registrar leitura" });
  }
});

// ------------------------------------------------------------
// TARIFAS (histórico)
// ------------------------------------------------------------
app.get("/api/tariffs", (req, res) => {
  try {
    const kwh = db.prepare("SELECT price_per_unit FROM tariffs WHERE type='energia' AND ended_at IS NULL").get();
    const m3 = db.prepare("SELECT price_per_unit FROM tariffs WHERE type='agua' AND ended_at IS NULL").get();
    res.json({
      kwh_price: kwh ? kwh.price_per_unit : 0,
      m3_price: m3 ? m3.price_per_unit : 0
    });
  } catch (e) {
    console.error("ERRO ao buscar tarifas:", e);
    res.status(500).json({ error: "Erro interno ao buscar tarifas" });
  }
});

app.post("/api/tariffs", authMiddleware, (req, res) => {
  if (req.user.role !== "admin") return res.status(403).json({ error: "Acesso negado" });
  try {
    const { kwh_price, m3_price } = req.body;
    const today = new Date().toISOString().slice(0, 10);

    db.prepare("UPDATE tariffs SET ended_at=? WHERE type='energia' AND ended_at IS NULL").run(today);
    db.prepare("INSERT INTO tariffs (type, price_per_unit, started_at, ended_at) VALUES ('energia', ?, ?, NULL)")
      .run(Number(kwh_price), today);

    db.prepare("UPDATE tariffs SET ended_at=? WHERE type='agua' AND ended_at IS NULL").run(today);
    db.prepare("INSERT INTO tariffs (type, price_per_unit, started_at, ended_at) VALUES ('agua', ?, ?, NULL)")
      .run(Number(m3_price), today);

    res.json({ success: true });
  } catch (e) {
    console.error("ERRO ao salvar tarifas:", e);
    res.status(500).json({ error: "Erro interno ao salvar tarifas" });
  }
});

// ------------------------------------------------------------
// SUMÁRIO DO MÊS (helper para dashboard)
// ------------------------------------------------------------
app.get("/api/summary/month", (req, res) => {
  try {
    const start = new Date();
    start.setDate(1);
    start.setHours(0,0,0,0);
    const startISO = start.toISOString();

    const rows = db.prepare(
      "SELECT meter_id, meter_name, type, SUM(value) AS total FROM readings WHERE datetime(created_at) >= datetime(?) GROUP BY meter_id, meter_name, type"
    ).all(startISO);

    const out = rows.map(r => ({
      meter_id: r.meter_id,
      meter_name: r.meter_name,
      type: r.type,
      total: Number(r.total || 0)
    }));

    res.json(out);
  } catch (e) {
    console.error("ERRO summary month:", e);
    res.status(500).json({ error: "Erro interno ao gerar resumo" });
  }
});

// ------------------------------------------------------------
// ROTA /api/insert.php — Recebe dados POST do medidor IE trifásico
// Aceita application/json e application/x-www-form-urlencoded
// ------------------------------------------------------------
app.post("/api/insert.php", (req, res) => {
  try {
    const data = req.body || {};
    console.log("📥 IE payload:", data);

    const token = data.token || data.Token || data.TOKEN;
    if (!token) return res.status(400).json({ error: "Token ausente na requisição" });

    const meter = db.prepare("SELECT * FROM meters WHERE token = ?").get(token);
    if (!meter) return res.status(404).json({ error: "Medidor não encontrado para o token informado" });

    if (meter.type === "energia-3f") {
      // Guarda payload bruto
      db.prepare("INSERT INTO energy3ph_buffer (meter_parent_id, raw_json) VALUES (?, ?)")
        .run(meter.id, JSON.stringify(data));

      // Extrai energia ativa acumulada por fase (kWh)
      const a = parseFloat(data.epa_g ?? data.epa_c ?? 0);
      const b = parseFloat(data.epb_g ?? data.epb_c ?? 0);
      const c = parseFloat(data.epc_g ?? data.epc_c ?? 0);

      const fases = [
        { nome: "Fase A", val: isFinite(a) ? a : 0 },
        { nome: "Fase B", val: isFinite(b) ? b : 0 },
        { nome: "Fase C", val: isFinite(c) ? c : 0 },
      ];

      for (const f of fases) {
        db.prepare(
          "INSERT INTO readings (meter_id, meter_name, type, value, created_at) VALUES (?, ?, ?, ?, datetime('now'))"
        ).run(meter.id, `${meter.name} - ${f.nome}`, "energia", f.val);
      }

      console.log(`✅ IE trifásico salvo: ${meter.name} (A/B/C)`);
      return res.json({ success: true, message: "Leituras trifásicas salvas!" });
    }

    // Medidor simples (agua/energia monofásica)
    const valor = parseFloat(data.value ?? data.consumo ?? 0);
    db.prepare(
      "INSERT INTO readings (meter_id, meter_name, type, value, created_at) VALUES (?, ?, ?, ?, datetime('now'))"
    ).run(meter.id, meter.name, meter.type, isFinite(valor) ? valor : 0);

    console.log(`✅ IE monofásico salvo: ${meter.name}`);
    return res.json({ success: true, message: "Leitura salva com sucesso!" });

  } catch (e) {
    console.error("❌ Erro em /api/insert.php:", e);
    res.status(500).json({ error: "Erro interno ao processar dados" });
  }
});

// ------------------------------------------------------------
// INICIAR SERVIDOR
// ------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`✅ Servidor ativo na porta ${PORT}`);
});
