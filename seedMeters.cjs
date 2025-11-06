// ======================================================
// seedMeters.cjs — Criação de medidores padrão
// ======================================================

const Database = require("better-sqlite3");

function log(msg) {
  console.log(`[seedMeters] ${msg}`);
}

function seed() {
  const db = new Database("consumo.db");
  db.pragma("journal_mode = wal");

  const meters = [
    { name: "Água Principal", type: "agua" },
    { name: "Energia Fase A", type: "energia" },
    { name: "Energia Fase B", type: "energia" },
    { name: "Energia Fase C", type: "energia" },
    { name: "Energia Total (Trifásico)", type: "energia-3f" }
  ];

  const stmt = db.prepare("INSERT INTO meters (name, type, token) VALUES (?, ?, ?)");
  let inserted = 0;

  for (const m of meters) {
    const exists = db.prepare("SELECT * FROM meters WHERE name=?").get(m.name);
    if (!exists) {
      const token = Math.random().toString(36).substring(2, 10);
      stmt.run(m.name, m.type, token);
      log(`✅ Criado: ${m.name} (${m.type})`);
      inserted++;
    } else {
      log(`⏩ Já existe: ${m.name}`);
    }
  }

  if (!inserted) {
    log("⚠️ Nenhum novo medidor criado (todos já existem)");
  } else {
    log(`🎯 ${inserted} medidor(es) criado(s) com sucesso!`);
  }

  db.close();
}

seed();
