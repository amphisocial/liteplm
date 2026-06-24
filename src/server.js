// src/server.js — Lite-PLM entry point.
import express from "express";
import cookieParser from "cookie-parser";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { initSchema } from "./db.js";
import { resolveCtx } from "./auth.js";
import account from "./routes/account.js";
import catalog from "./routes/catalog.js";
import eco from "./routes/eco.js";
import { aiEnabled } from "./lib/ai.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
app.set("trust proxy", true);
app.use(express.json({ limit: "2mb" }));
app.use(cookieParser());
app.use(resolveCtx);

app.get("/healthz", (_req, res) => res.json({ ok: true, service: "lite-plm", ai: aiEnabled() }));
app.get("/api/meta", (_req, res) => res.json({ aiEnabled: aiEnabled() }));

app.use("/api", account);
app.use("/api", catalog);
app.use("/api", eco);

// global error handler so a thrown query never crashes the process
app.use((err, _req, res, _next) => {
  console.error("[error]", err.message);
  res.status(500).json({ error: "Something went wrong on our end." });
});

app.use(express.static(join(__dirname, "..", "public")));
app.get("*", (_req, res) => res.sendFile(join(__dirname, "..", "public", "index.html")));

const PORT = process.env.PORT || 8080;
initSchema()
  .then(() => app.listen(PORT, () => console.log(`Lite-PLM on :${PORT} — ai=${aiEnabled()}`)))
  .catch((e) => { console.error("Schema init failed:", e.message); process.exit(1); });
