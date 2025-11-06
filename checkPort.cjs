// ======================================================
// checkPort.cjs — Libera a porta 3000 automaticamente
// ======================================================
const { exec } = require("child_process");

const PORT = 3000;

console.log(`🔍 Verificando se a porta ${PORT} está ocupada...`);

exec(`netstat -ano | findstr :${PORT}`, (err, stdout) => {
  if (err || !stdout) {
    console.log(`✅ Porta ${PORT} está livre.`);
    return;
  }

  // Captura o PID
  const lines = stdout.trim().split("\n");
  const pids = new Set();

  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    const pid = parts[parts.length - 1];
    if (pid && pid !== "0") pids.add(pid);
  }

  if (pids.size === 0) {
    console.log(`✅ Nenhum processo ativo na porta ${PORT}.`);
    return;
  }

  console.log(`⚠️ Porta ${PORT} em uso por PID(s): ${[...pids].join(", ")}`);
  console.log(`🧹 Encerrando processo(s)...`);

  for (const pid of pids) {
    exec(`taskkill /PID ${pid} /F`, (killErr) => {
      if (killErr) {
        console.error(`❌ Falha ao encerrar PID ${pid}: ${killErr.message}`);
      } else {
        console.log(`✅ Processo ${pid} encerrado com sucesso.`);
      }
    });
  }
});
