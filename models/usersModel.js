// ============================================================
// models/usersModel.js
// Modelo de Usuários — CRUD e autenticação
// ============================================================

import bcrypt from "bcrypt";
import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const db = new Database(path.join(__dirname, "../consumo.db"));

export const UsersModel = {
  getAll() {
    const rows = db.prepare("SELECT id,name,email,role,allowed_meters FROM users").all();
    return rows.map((u) => ({
      ...u,
      allowed_meters: JSON.parse(u.allowed_meters || "[]"),
    }));
  },

  getByEmail(email) {
    return db.prepare("SELECT * FROM users WHERE email=?").get(email);
  },

  create({ name, email, password, role = "user", allowed_meters = [] }) {
    const hash = bcrypt.hashSync(password, 10);
    db.prepare(
      "INSERT INTO users (name,email,password,role,allowed_meters) VALUES (?,?,?,?,?)"
    ).run(name, email, hash, role, JSON.stringify(allowed_meters));
  },

  updateAllowedMeters(userId, allowed_meters) {
    db.prepare("UPDATE users SET allowed_meters=? WHERE id=?").run(
      JSON.stringify(allowed_meters),
      userId
    );
  },

  ensureAdmin() {
    const admin = db.prepare("SELECT * FROM users WHERE role='admin'").get();
    if (!admin) {
      const hash = bcrypt.hashSync("123456", 10);
      db.prepare("INSERT INTO users (name,email,password,role) VALUES (?,?,?,?)")
        .run("Thiago Tank", "thiago@teste.com", hash, "admin");
      console.log("👤 Admin padrão criado: thiago@teste.com / 123456");
    }
  },
};

UsersModel.ensureAdmin();
