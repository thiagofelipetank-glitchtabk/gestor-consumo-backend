// ============================================================
// GESTOR DE CONSUMO — BACKEND PRO 4.6 (Trifásico IE + Resumo Mês)
// ============================================================

import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import Database from "better-sqlite3";
import bodyParser from "body-parser";

dotenv.config();

const app = express();
app.use(express.json());
app.use(bodyParser.urlencoded({ extended: true })); // aceita form-urlencoded (POST IE)
app.use(cors({ origin: "*", methods: ["GET","POST","PUT","DELETE","OPTIONS"], allowedHeaders: ["Content-Type","Authorization"] }));

// DB
const db = new Database(process.env.DB_FILE || "./consumo.db");
db.pragma("journal_mode = wal");

// Vars
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "fallback_secret";

// Helpers
function createToken(user) {
  return jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: "12h" });
}
function auth(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: "Token ausente" });
  const token = header.split(" ")[1];
  try { req.user = jwt.verify(token, JWT_SECRET); next(); } catch { return res.status(403).json({ error: "Token inválido" }); }
}
function adminOnly(req, res, next) {
  if (!req.user || req.user.role !== "admin") return res.status(403).json({ error: "Acesso negado" });
  next();
}

// Root
app.get("/", (req, res) => res.send("🚀 API do Gestor de Consumo ativa!"));

// ---------------------------
// AUTH
// ---------------------------
app.post("/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = db.prepare("SELECT * FROM users WHERE email=?").get(email);
    if (!user) return res.status(400).json({ error: "Usuário não encontrado" });
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ error: "Senha incorreta" });
    const token = createToken(user);
    const allowed_meters = db.prepare("SELECT meter_id FROM user_meters WHERE user_id=?").all(user.id).map(r => r.meter_id);
    res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role, allowed_meters } });
  } catch (e) {
    console.error("LOGIN:", e);
    res.status(500).json({ error: "Erro interno ao fazer login" });
  }
});

// ---------------------------
// METERS
// ---------------------------
app.get("/api/meters", (req, res) => {
  try {
    const rows = db.prepare("SELECT id, name, type, token, created_at FROM meters ORDER BY id DESC").all();
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: "Erro interno ao buscar medidores" });
  }
});

app.post("/api/meters", auth, adminOnly, (req, res) => {
  const { name, type } = req.body;
  const token = type === "energia-3f" || type === "energia" ? ("METER-" + Math.random().toString(36).substring(2,10).toUpperCase()) : null;
  try {
    db.prepare("INSERT INTO meters (name, type, token) VALUES (?, ?, ?)").run(name, type, token);
    const meter = db.prepare("SELECT * FROM meters WHERE id=last_insert_rowid()").get();
    res.json({ success: true, meter });
  } catch (e) {
    res.status(500).json({ error: "Erro interno ao criar medidor" });
  }
});

app.delete("/api/meters/:id", auth, adminOnly, (req, res) => {
  const { id } = req.params;
  try {
    db.prepare("DELETE FROM user_meters WHERE meter_id=?").run(id);
    db.prepare("DELETE FROM readings WHERE meter_id=?").run(id);
    db.prepare("DELETE FROM energy3ph_phase_map WHERE parent_meter_id=? OR child_meter_id=?").run(id, id);
    db.prepare("DELETE FROM meters WHERE id=?").run(id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: "Erro ao excluir medidor" });
  }
});

// ---------------------------
/** IE TRIFÁSICO — MAPEAMENTO FASES
 *  POST /api/energy3ph/:parentId/autocreate
 *    => cria 3 medidores (A/B/C) e faz o mapa (labels padrão Apto 01..03)
 *  GET  /api/energy3ph/:parentId/map
 *  POST /api/energy3ph/:parentId/map   body: { map: [{phase:'A', child_meter_id, label}, ...] }
 */
app.post("/api/energy3ph/:parentId/autocreate", auth, adminOnly, (req, res) => {
  const { parentId } = req.params;
  try {
    const parent = db.prepare("SELECT * FROM meters WHERE id=? AND type='energia-3f'").get(parentId);
    if (!parent) return res.status(404).json({ error: "Medidor trifásico não encontrado" });

    const phases = ["A","B","C"];
    const created = [];
    for (let i=0;i<phases.length;i++){
      const ph = phases[i];
      const name = `${parent.name} — Fase ${ph}`;
      const token = "METER-" + Math.random().toString(36).substring(2,10).toUpperCase(); // não usado pelo IE (usamos o do parent), mas útil para debug
      db.prepare("INSERT INTO meters (name, type, token) VALUES (?, 'energia', ?)").run(name, token);
      const child = db.prepare("SELECT * FROM meters WHERE id=last_insert_rowid()").get();
      const label = `Apto 0${i+1}`;
      db.prepare(`
        INSERT OR REPLACE INTO energy3ph_phase_map (parent_meter_id, phase, child_meter_id, label)
        VALUES (?, ?, ?, ?)
      `).run(parent.id, ph, child.id, label);
      created.push({ phase: ph, child });
    }
    res.json({ success:true, created });
  } catch (e) {
    console.error("autocreate:", e);
    res.status(500).json({ error: "Erro ao criar fases" });
  }
});

app.get("/api/energy3ph/:parentId/map", auth, adminOnly, (req, res) => {
  const { parentId } = req.params;
  try {
    const rows = db.prepare(`
      SELECT m.phase, m.child_meter_id, m.label, c.name AS child_name
      FROM energy3ph_phase_map m
      JOIN meters c ON c.id = m.child_meter_id
      WHERE parent_meter_id=?
      ORDER BY m.phase
    `).all(parentId);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: "Erro ao buscar mapa de fases" });
  }
});

app.post("/api/energy3ph/:parentId/map", auth, adminOnly, (req, res) => {
  const { parentId } = req.params;
  const { map = [] } = req.body;
  try {
    const parent = db.prepare("SELECT * FROM meters WHERE id=? AND type='energia-3f'").get(parentId);
    if (!parent) return res.status(404).json({ error: "Medidor trifásico não encontrado" });
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO energy3ph_phase_map (parent_meter_id, phase, child_meter_id, label)
      VALUES (?, ?, ?, ?)
    `);
    for (const item of map) {
      if (!["A","B","C"].includes(item.phase)) continue;
      stmt.run(parent.id, item.phase, item.child_meter_id, item.label || null);
    }
    res.json({ success:true });
  } catch (e) {
    res.status(500).json({ error: "Erro ao salvar mapa de fases" });
  }
});

// ---------------------------
// IE TRIFÁSICO — INGEST (1 token, payload completo)
// Aceita JSON e x-www-form-urlencoded (compatível com “/api/insert.php” do manual)
app.post(["/api/ingest/ie","/api/insert.php"], (req, res) => {
  try {
    // Campos esperados: token (do medidor 3f), hora,minuto,segundo, pa,pb,pc,pt, epa_g, epb_g, epc_g, ept_g, (demais campos ignorados mas armazenados)
    const payload = req.body || {};
    const token = payload.token || payload.Token || payload.TOKEN;
    if (!token) return res.status(400).json({ error: "Token ausente" });

    const parent = db.prepare("SELECT * FROM meters WHERE token=? AND type='energia-3f'").get(token);
    if (!parent) return res.status(404).json({ error: "Medidor 3f não encontrado para este token" });

    // Guarda bruto
    db.prepare("INSERT INTO energy3ph_buffer (meter_parent_id, raw_json) VALUES (?, ?)").run(parent.id, JSON.stringify(payload));

    // Coleta cumulativos (kWh) por fase — usamos *_g (geral) se disponíveis
    const nowA = parseFloat(payload.epa_g ?? payload.epa_c ?? payload.pa ?? 0) || 0;
    const nowB = parseFloat(payload.epb_g ?? payload.epb_c ?? payload.pb ?? 0) || 0;
    const nowC = parseFloat(payload.epc_g ?? payload.epc_c ?? payload.pc ?? 0) || 0;

    // Último bruto para calcular delta
    const lastRow = db.prepare(`
      SELECT raw_json FROM energy3ph_buffer
      WHERE meter_parent_id=? ORDER BY id DESC LIMIT 2
    `).all(parent.id); // pega os 2 últimos; o último é o atual

    let prevA = 0, prevB = 0, prevC = 0;
    if (lastRow.length >= 2) {
      const prevPayload = JSON.parse(lastRow[1].raw_json || "{}");
      prevA = parseFloat(prevPayload.epa_g ?? prevPayload.epa_c ?? prevPayload.pa ?? 0) || 0;
      prevB = parseFloat(prevPayload.epb_g ?? prevPayload.epb_c ?? prevPayload.pb ?? 0) || 0;
      prevC = parseFloat(prevPayload.epc_g ?? prevPayload.epc_c ?? prevPayload.pc ?? 0) || 0;
    }

    // Delta kWh por fase (nunca negativo)
    const dA = Math.max(0, nowA - prevA);
    const dB = Math.max(0, nowB - prevB);
    const dC = Math.max(0, nowC - prevC);

    // Mapeamento de fases → medidores filhos (apartamentos)
    const maps = db.prepare(`
      SELECT phase, child_meter_id, label FROM energy3ph_phase_map WHERE parent_meter_id=?
    `).all(parent.id);

    // Para cada fase com mapeamento, grava leitura de energia (valor = delta kWh)
    const insertReading = db.prepare(`
      INSERT INTO readings (meter_id, meter_name, type, value) VALUES (?, ?, 'energia', ?)
    `);
    for (const mp of maps) {
      if (mp.phase === "A" && dA > 0) {
        const child = db.prepare("SELECT * FROM meters WHERE id=?").get(mp.child_meter_id);
        insertReading.run(child.id, child.name, dA);
      }
      if (mp.phase === "B" && dB > 0) {
        const child = db.prepare("SELECT * FROM meters WHERE id=?").get(mp.child_meter_id);
        insertReading.run(child.id, child.name, dB);
      }
      if (mp.phase === "C" && dC > 0) {
        const child = db.prepare("SELECT * FROM meters WHERE id=?").get(mp.child_meter_id);
        insertReading.run(child.id, child.name, dC);
      }
    }

    return res.json({ success: true, parent_id: parent.id, deltas: { A: dA, B: dB, C: dC } });
  } catch (e) {
    console.error("INGEST IE:", e);
    res.status(500).json({ error: "Falha ao processar payload IE" });
  }
});

// ---------------------------
// READINGS (genéricas)
// ---------------------------
app.get("/api/readings", (req, res) => {
  const { tipo, limit = 100 } = req.query;
  try {
    let sql = "SELECT * FROM readings WHERE 1=1";
    const params = [];
    if (tipo) { sql += " AND type=?"; params.push(tipo); }
    sql += " ORDER BY id DESC LIMIT ?"; params.push(limit);
    const rows = db.prepare(sql).all(...params);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: "Erro interno ao buscar leituras" });
  }
});

app.post("/api/readings", (req, res) => {
  const { meter_id, type, value } = req.body;
  try {
    const meter = db.prepare("SELECT name, type FROM meters WHERE id=?").get(meter_id);
    if (!meter) return res.status(404).json({ error: "Medidor não encontrado" });
    db.prepare("INSERT INTO readings (meter_id, meter_name, type, value) VALUES (?, ?, ?, ?)")
      .run(meter_id, meter.name, type, value);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: "Erro interno ao registrar leitura" });
  }
});

// ---------------------------
// TARIFAS
// ---------------------------
app.get("/api/tariffs", (req, res) => {
  try {
    const kwh = db.prepare("SELECT price_per_unit FROM tariffs WHERE type='energia' AND ended_at IS NULL").get();
    const m3 = db.prepare("SELECT price_per_unit FROM tariffs WHERE type='agua' AND ended_at IS NULL").get();
    res.json({ kwh_price: kwh ? kwh.price_per_unit : 0, m3_price: m3 ? m3.price_per_unit : 0 });
  } catch (e) {
    res.status(500).json({ error: "Erro interno ao buscar tarifas" });
  }
});

app.post("/api/tariffs", auth, adminOnly, (req, res) => {
  const { kwh_price, m3_price } = req.body;
  const today = new Date().toISOString().slice(0, 10);
  try {
    db.prepare("UPDATE tariffs SET ended_at=? WHERE type='energia' AND ended_at IS NULL").run(today);
    db.prepare("INSERT INTO tariffs (type, price_per_unit, started_at, ended_at) VALUES ('energia', ?, ?, NULL)").run(kwh_price, today);
    db.prepare("UPDATE tariffs SET ended_at=? WHERE type='agua' AND ended_at IS NULL").run(today);
    db.prepare("INSERT INTO tariffs (type, price_per_unit, started_at, ended_at) VALUES ('agua', ?, ?, NULL)").run(m3_price, today);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: "Erro interno ao salvar tarifas" });
  }
});

// ---------------------------
// RESUMO DO MÊS (por medidor)
// ---------------------------
app.get("/api/summary/month", (req, res) => {
  try {
    const now = new Date();
    const month = (req.query.month || now.toISOString().slice(0,7)); // YYYY-MM
    const start = `${month}-01 00:00:00`;
    const end = `${month}-31 23:59:59`;

    const meters = db.prepare("SELECT id, name, type FROM meters ORDER BY name ASC").all();
    const out = [];
    for (const m of meters) {
      // Somatório do mês (valor = delta já consolidado no insert)
      const sum = db.prepare(`
        SELECT COALESCE(SUM(value),0) AS total
        FROM readings
        WHERE meter_id=? AND created_at BETWEEN ? AND ?
      `).get(m.id, start, end).total || 0;

      out.push({ meter_id: m.id, meter_name: m.name, type: m.type, month_total: sum });
    }
    res.json(out);
  } catch (e) {
    console.error("summary:", e);
    res.status(500).json({ error: "Erro interno ao gerar resumo" });
  }
});

// ---------------------------
// USERS + PERMISSÕES
// ---------------------------
app.get("/api/users", auth, adminOnly, (req, res) => {
  try {
    const users = db.prepare("SELECT id, name, email, role, created_at FROM users ORDER BY id DESC").all();
    const mapPerms = db.prepare("SELECT user_id, meter_id FROM user_meters").all();
    const permByUser = {};
    for (const r of mapPerms) {
      if (!permByUser[r.user_id]) permByUser[r.user_id] = [];
      permByUser[r.user_id].push(r.meter_id);
    }
    const out = users.map(u => ({ ...u, allowed_meters: permByUser[u.id] || [] }));
    res.json(out);
  } catch (e) {
    res.status(500).json({ error: "Erro ao listar usuários" });
  }
});

app.post("/api/users", auth, adminOnly, async (req, res) => {
  try {
    const { name, email, password, role = "user", meter_ids = [] } = req.body;
    if (!name || !email || !password) return res.status(400).json({ error: "Campos obrigatórios ausentes" });
    const exists = db.prepare("SELECT 1 FROM users WHERE email=?").get(email);
    if (exists) return res.status(400).json({ error: "E-mail já cadastrado" });
    const hash = await bcrypt.hash(password, 10);
    db.prepare("INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)").run(name, email, hash, role);
    const created = db.prepare("SELECT * FROM users WHERE id=last_insert_rowid()").get();
    if (Array.isArray(meter_ids) && meter_ids.length) {
      const stmt = db.prepare("INSERT INTO user_meters (user_id, meter_id) VALUES (?, ?)");
      for (const mid of meter_ids) { try { stmt.run(created.id, mid); } catch {} }
    }
    res.json({ success: true, user: { id: created.id, name: created.name, email: created.email, role: created.role } });
  } catch (e) {
    res.status(500).json({ error: "Erro interno ao criar usuário" });
  }
});

app.post("/api/users/:id/permissions", auth, adminOnly, (req, res) => {
  const { id } = req.params;
  const { meter_ids = [] } = req.body;
  try {
    db.prepare("DELETE FROM user_meters WHERE user_id=?").run(id);
    const stmt = db.prepare("INSERT INTO user_meters (user_id, meter_id) VALUES (?, ?)");
    for (const mid of meter_ids) { try { stmt.run(id, mid); } catch {} }
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: "Erro interno ao definir permissões" });
  }
});

app.delete("/api/users/:id", auth, adminOnly, (req, res) => {
  const { id } = req.params;
  try {
    db.prepare("DELETE FROM user_meters WHERE user_id=?").run(id);
    db.prepare("DELETE FROM users WHERE id=?").run(id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: "Erro interno ao excluir usuário" });
  }
});

// Start
app.listen(PORT, () => console.log(`✅ Servidor ativo na porta ${PORT}`));
