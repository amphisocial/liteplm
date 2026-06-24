// src/db.js — Postgres pool, schema init, tiny query helpers.
import pg from "pg";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const { Pool } = pg;

const ssl = String(process.env.PGSSL || "").toLowerCase() === "true" ? { rejectUnauthorized: false } : false;
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl,
  max: 10,
});

export async function query(text, params) {
  const r = await pool.query(text, params);
  return r.rows;
}
export async function one(text, params) {
  const r = await pool.query(text, params);
  return r.rows[0] || null;
}

export async function initSchema() {
  const sql = readFileSync(join(__dirname, "..", "db", "schema.sql"), "utf8");
  await pool.query(sql);
}
