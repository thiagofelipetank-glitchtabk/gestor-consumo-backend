// Gera leituras recentes (últimos 10 dias) para água e energia
const Database = require("better-sqlite3");

const db = new Database("consumo.db");
db.pragma("journal_mode = wal");

// util
function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}
function isoDay(d) {
  return d.toISOString().slice(0, 10);
}

const meters = db.prepare("SELECT id, name, type FROM meters").all();
if (!meters.length) {
  console.log("[seedReadings] ⚠️ Nenhum medidor encontrado. Rode primeiro: npm run seed:meters");
  process.exit(0);
}

const today = new Date();
const start = addDays(today, -9); // 10 dias

for (const m of meters) {
  for (let i = 0; i < 10; i++) {
    const day = isoDay(addDays(start, i));
    let value = 0;

    if (m.type === "agua") {
      // Consumo diário em m³ (ex: 0.2 a 1.5)
      value = Number((0.2 + Math.random() * 1.3).toFixed(2));
      db.prepare(`
        INSERT INTO readings (meter_id, meter_name, type, value, consumo_litros, vazao_lh, created_at)
        VALUES (?, ?, 'agua', ?, ?, NULL, datetime(? || ' 12:00:00'))
      `).run(m.id, m.name, value, Math.round(value * 1000), day);
    } else if (m.type === "energia") {
      // Consumo diário em kWh (ex: 1.5 a 8.0)
      value = Number((1.5 + Math.random() * 6.5).toFixed(2));
      db.prepare(`
        INSERT INTO readings (meter_id, meter_name, type, value, consumo_litros, vazao_lh, created_at)
        VALUES (?, ?, 'energia', ?, NULL, NULL, datetime(? || ' 12:00:00'))
      `).run(m.id, m.name, value, day);
    }
  }
  console.log(`[seedReadings] ✅ Leituras geradas para: ${m.name} (${m.type})`);
}

db.close();
console.log("[seedReadings] ✅ Finalizado");
