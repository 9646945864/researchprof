export const config = { maxDuration: 30 };

const MODEL = "meta/llama-3.2-11b-vision-instruct";
const MODEL_TIMEOUT_MS = 7000;
const ABSTRACT_TIMEOUT_MS = 2000;

async function ask(prompt, key) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), MODEL_TIMEOUT_MS);
  const started = Date.now();

  try {
    const r = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.4,
        max_tokens: 350
      }),
      signal: c.signal
    });

    const raw = await r.text();
    let d = null;
    try { d = JSON.parse(raw); } catch {}

    const text = d?.choices?.[0]?.message?.content?.trim() || null;

    return {
      text,
      info: { model: MODEL, status: r.status, ms: Date.now() - started, detail: text ? "" : raw.slice(0, 200) }
    };
  } catch (err) {
    return {
      text: null,
      info: { model: MODEL, status: err.name === "AbortError" ? "timeout" : "error", ms: Date.now() - started, detail: String(err.message || err).slice(0, 100) }
    };
  } finally {
    clearTimeout(t);
  }
}

async function getAbstract(workId) {
  const id = String(workId || "").split("/").pop();
  if (!/^W\d+$/.test(id)) return "";

  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ABSTRACT_TIMEOUT_MS);

  try {
    const url = new URL(`https://api.openalex.org/works/${id}`);
    url.searchParams.set("select", "abstract_inverted_index");
    url.searchParams.set("api_key", process.env.OPENALEX_API_KEY);

    const r = await fetch(url, { signal: c.signal });
    if (!r.ok) return "";

    const idx = (await r.json()).abstract_inverted_index;
    if (!idx) return "";

    const words = [];
    for (const [w, pos] of Object.entries(idx)) for (const p of pos) words[p] = w;

    return words.filter(Boolean).join(" ").slice(0, 1000);
  } catch {
    return "";
  } finally {
    clearTimeout(t);
  }
}

const clip = (v, n) => String(v || "").slice(0, n);

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const key = (process.env.NVIDIA_API_KEY || "").trim();
  if (!key) return res.status(500).json({ error: "NVIDIA_API_KEY is missing" });

  const { profile, professor, paper } = req.body || {};

  if (!profile?.name || !profile?.project || !professor?.name || !paper?.title) {
    return res.status(400).json({ error: "Missing profile, professor, or paper." });
  }

  const abstract = await getAbstract(paper.id);

  const prompt = `Write a short, genuine cold email
