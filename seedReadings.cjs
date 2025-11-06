// ======================================================
// seedReadings.cjs — Cria leituras simuladas (Água + Energia)
// ======================================================

const Database = require("better-sqlite3");

function log(msg) {
  console.log(`[seedReadings] ${msg}`);
}

function seed() {
  const db = new Database("consumo.db");
  db.pragma("journal_mode = wal");

  // Obtém medidores existentes
  const meters = db.prepare("SELECT * FROM meters").all();
  if (!meters.length) {
    log("⚠️ Nenhum medidor encontrado. Execute antes o seedMeters.cjs");
    db.close();
    return;
  }

  const insertReading = db.prepare(`
    INSERT INTO readings (meter_id, meter_name, type, value, consumo_litros, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const today = new Date();

  for (const m of meters) {
    log(`🔹 Criando leituras para ${m.name} (${m.type})...`);

    for (let i = 7; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(today.getDate() - i);

      // Simula valores diferentes por tipo
      let value = 0;
      if (m.type === "agua") {
        value = 0.3 + Math.random() * 0.5; // m³/dia
      } else if (m.type === "energia" || m.type === "energia-3f") {
        value = 3 + Math.random() * 5; // kWh/dia
      }

      insertReading.run(
        m.id,
        m.name,
        m.type === "energia-3f" ? "energia" : m.type,
        value,
        m.type === "agua" ? value * 1000 : null, // litros aproximados
        date.toISOString()
      );
    }
  }

  log("🎯 Leituras simuladas criadas com sucesso!");
  db.close();
}

seed();
