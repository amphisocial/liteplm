// src/lib/ai.js — natural-language search over parts & vendors.
// Turns a plain-English query into a safe structured filter using OpenAI, then
// the route runs it as parameterized SQL. If no API key (or the call fails), we
// fall back to a plain keyword search so the feature ALWAYS works offline.

const KEY = process.env.OPENAI_API_KEY || "";
const MODEL = process.env.OPENAI_MODEL || "gpt-4o";

// Allowed, whitelisted filter shape — the model can only ask for these.
// { entity: 'items'|'vendors', text: string, uom?: string,
//   status?: 'working'|'in_review'|'released'|'obsolete', hasVendor?: bool }
export async function nlToFilter(q) {
  const fallback = { entity: "items", text: q, _mode: "keyword" };
  if (!KEY) return fallback;
  const sys = `You translate a manufacturing engineer's search into JSON. Output ONLY JSON, no prose.
Schema: {"entity":"items"|"vendors","text":string,"uom":string|null,"status":"working"|"in_review"|"released"|"obsolete"|null,"hasVendor":boolean|null}
- "text" = the key words to match on number/name/description (strip filler).
- Use "status" only if the user clearly asks (e.g. "released parts").
- entity "vendors" only if they're clearly searching suppliers.
Return the JSON object only.`;
  try {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + KEY },
      body: JSON.stringify({
        model: MODEL, temperature: 0,
        messages: [{ role: "system", content: sys }, { role: "user", content: String(q || "") }],
        response_format: { type: "json_object" },
      }),
    });
    if (!r.ok) return fallback;
    const data = await r.json();
    const txt = data.choices?.[0]?.message?.content || "{}";
    const f = JSON.parse(txt);
    f.entity = f.entity === "vendors" ? "vendors" : "items";
    f.text = typeof f.text === "string" ? f.text : q;
    f._mode = "ai";
    return f;
  } catch (_) {
    return fallback;
  }
}

export const aiEnabled = () => !!KEY;
