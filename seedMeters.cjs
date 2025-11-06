// Cria medidores de exemplo e vincula usuários a alguns medidores
const Database = require("better-sqlite3");

const db = new Database("consumo.db");
db.pragma("journal_mode = wal");

const meters = [
  { name: "Caixa Principal", type: "agua" },
  { name: "Jardim", type: "agua" },
  { name: "Loja", type: "energia" },
  { name: "Cozinha", type: "energia" }
];

for (const m of meters) {
  const exists = db.prepare("SELECT 1 FROM meters WHERE name=?").get(m.name);
  if (!exists) {
    const token = "METER-" + Math.random().toString(36).substring(2, 10).toUpperCase();
    db.prepare("INSERT INTO meters (name, type, token) VALUES (?, ?, ?)").run(m.name, m.type, token);
    console.log(`[seedMeters] ✅ Medidor criado: ${m.name} (${m.type})`);
  } else {
    console.log(`[seedMeters] ↪️ Já existe: ${m.name}`);
  }
}

// Vincula Operador 1 aos medidores de água, Operador 2 aos de energia
const op1 = db.prepare("SELECT id FROM users WHERE email=?").get("op1@teste.com");
const op2 = db.prepare("SELECT id FROM users WHERE email=?").get("op2@teste.com");

if (op1) {
  const aguaIds = db.prepare("SELECT id FROM meters WHERE type='agua'").all().map(r => r.id);
  for (const mid of aguaIds) {
    try { db.prepare("INSERT INTO user_meters (user_id, meter_id) VALUES (?, ?)").run(op1.id, mid); } catch {}
  }
  console.log("[seedMeters] 🔗 Operador 1 vinculado aos medidores de água");
}

if (op2) {
  const energiaIds = db.prepare("SELECT id FROM meters WHERE type='energia'").all().map(r => r.id);
  for (const mid of energiaIds) {
    try { db.prepare("INSERT INTO user_meters (user_id, meter_id) VALUES (?, ?)").run(op2.id, mid); } catch {}
  }
  console.log("[seedMeters] 🔗 Operador 2 vinculado aos medidores de energia");
}

db.close();
console.log("[seedMeters] ✅ Finalizado");
