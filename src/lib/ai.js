// src/lib/ai.js — configurable AI provider for natural-language catalog search.
// Choose the provider with AI_MODE = openai | claude | gemini and supply the
// matching key. The model turns a plain-English query into a small JSON filter
// (and a one-line answer); the search route runs it as parameterized SQL.
//
//   AI_MODE=openai   AI_OPENAI_KEY=...   AI_OPENAI_MODEL=gpt-4o
//   AI_MODE=claude   AI_CLAUDE_KEY=...   AI_CLAUDE_MODEL=claude-3-5-sonnet-latest
//   AI_MODE=gemini   AI_GEMINI_KEY=...   AI_GEMINI_MODEL=gemini-1.5-flash
//
// On any provider failure we return the EXACT error (status + message) so the UI
// can show whether it was a bad key, expired token, network error, etc.

const MODE = (process.env.AI_MODE || "openai").toLowerCase();
const KEYS = {
  openai: process.env.AI_OPENAI_KEY || process.env.OPENAI_API_KEY || "",
  claude: process.env.AI_CLAUDE_KEY || process.env.ANTHROPIC_API_KEY || "",
  gemini: process.env.AI_GEMINI_KEY || process.env.GEMINI_API_KEY || "",
};
const MODELS = {
  openai: process.env.AI_OPENAI_MODEL || "gpt-4o",
  claude: process.env.AI_CLAUDE_MODEL || "claude-3-5-sonnet-latest",
  gemini: process.env.AI_GEMINI_MODEL || "gemini-1.5-flash",
};

export function aiConfig() {
  const mode = ["openai", "claude", "gemini"].includes(MODE) ? MODE : "openai";
  return { mode, enabled: !!KEYS[mode], model: MODELS[mode] };
}
export const aiEnabled = () => aiConfig().enabled;

const SYSTEM = `You translate a manufacturing engineer's search over a PLM catalog into JSON. Output ONLY a JSON object, no prose.
Schema: {"entity":"items"|"vendors","text":string,"uom":string|null,"status":"working"|"in_review"|"released"|"obsolete"|null,"answer":string}
- "text": the key words to match on number/name/description (strip filler words).
- "status": only if the user clearly asks (e.g. "released parts").
- "entity": "vendors" only if they are clearly searching suppliers, else "items".
- "answer": one short sentence describing what you searched for.
Return the JSON object only.`;

const TIMEOUT = Number(process.env.AI_TIMEOUT_MS || 12000);
async function fetchT(url, opts) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT);
  try { return await fetch(url, { ...opts, signal: ctrl.signal }); }
  finally { clearTimeout(t); }
}

async function readErr(resp) {
  let body = "";
  try { body = await resp.text(); } catch { /* ignore */ }
  try { const j = JSON.parse(body); body = j?.error?.message || j?.error || j?.message || body; } catch { /* keep text */ }
  return `${resp.status} ${resp.statusText}${body ? " — " + String(body).slice(0, 300) : ""}`;
}

// each provider returns the model's raw text (expected to be JSON)
async function callOpenAI(key, model, q) {
  const r = await fetchT("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
    body: JSON.stringify({ model, temperature: 0, response_format: { type: "json_object" },
      messages: [{ role: "system", content: SYSTEM }, { role: "user", content: q }] }),
  });
  if (!r.ok) throw new Error("OpenAI " + (await readErr(r)));
  const d = await r.json();
  return d.choices?.[0]?.message?.content || "";
}
async function callClaude(key, model, q) {
  const r = await fetchT("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model, max_tokens: 400, system: SYSTEM, messages: [{ role: "user", content: q }] }),
  });
  if (!r.ok) throw new Error("Claude " + (await readErr(r)));
  const d = await r.json();
  return (d.content || []).filter((b) => b.type === "text").map((b) => b.text).join("") || "";
}
async function callGemini(key, model, q) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;
  const r = await fetchT(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents: [{ role: "user", parts: [{ text: q }] }],
      generationConfig: { temperature: 0, responseMimeType: "application/json" },
    }),
  });
  if (!r.ok) throw new Error("Gemini " + (await readErr(r)));
  const d = await r.json();
  return d.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") || "";
}

function normalize(text, q) {
  let f;
  try { f = JSON.parse(text); } catch { throw new Error("Model returned non-JSON output."); }
  return {
    entity: f.entity === "vendors" ? "vendors" : "items",
    text: typeof f.text === "string" && f.text.trim() ? f.text : q,
    uom: typeof f.uom === "string" ? f.uom : null,
    status: ["working", "in_review", "released", "obsolete"].includes(f.status) ? f.status : null,
    answer: typeof f.answer === "string" ? f.answer : "",
  };
}

// returns { mode, enabled, filter? , error? }  — error is the exact failure string
export async function nlToFilter(q) {
  const cfg = aiConfig();
  if (!cfg.enabled) {
    return { mode: cfg.mode, enabled: false, filter: { entity: "items", text: q, uom: null, status: null, answer: "" } };
  }
  try {
    let text;
    if (cfg.mode === "claude") text = await callClaude(KEYS.claude, cfg.model, q);
    else if (cfg.mode === "gemini") text = await callGemini(KEYS.gemini, cfg.model, q);
    else text = await callOpenAI(KEYS.openai, cfg.model, q);
    return { mode: cfg.mode, enabled: true, filter: normalize(text, q) };
  } catch (e) {
    // surface the exact provider/network error
    let msg;
    if (e && e.name === "AbortError") msg = `Network timeout after ${TIMEOUT}ms — no response from ${cfg.mode}.`;
    else if (e && e.cause && e.cause.code) msg = `${e.message} (${e.cause.code})`;
    else msg = e?.message || String(e);
    return { mode: cfg.mode, enabled: true, error: msg };
  }
}
