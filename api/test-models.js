export const config = { maxDuration: 30 };

async function tryModel(model, key) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  const startedAt = Date.now();

  try {
    const response = await fetch(
      "https://integrate.api.nvidia.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`
        },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: "Reply with the word OK." }],
          max_tokens: 10,
          temperature: 0
        }),
        signal: controller.signal
      }
    );

    return {
      model,
      status: response.status,
      ms: Date.now() - startedAt
    };
  } catch (err) {
    return {
      model,
      status: err.name === "AbortError" ? "timeout" : "error",
      ms: Date.now() - startedAt
    };
  } finally {
    clearTimeout(timer);
  }
}

export default async function handler(req, res) {
  const key = process.env.NVIDIA_API_KEY;

  if (!key) {
    return res.status(500).json({ error: "NVIDIA_API_KEY is missing" });
  }

  const filter = String(req.query.q ?? "instruct").toLowerCase();
  const limit = Math.min(Number(req.query.limit) || 30, 40);

  const listResponse = await fetch("https://integrate.api.nvidia.com/v1/models", {
    headers: { Authorization: `Bearer ${key}` }
  });

  const list = await listResponse.json().catch(() => null);

  const candidates = (list?.data || [])
    .map((model) => model.id)
    .filter((id) => id.toLowerCase().includes(filter))
    .sort()
    .slice(0, limit);

  const results = [];

  // Test in batches of 15 so we stay inside the function time limit
  for (let i = 0; i < candidates.length; i += 15) {
    const batch = candidates.slice(i, i + 15);
    results.push(...(await Promise.all(batch.map((id) => tryModel(id, key)))));
  }

  return res.status(200).json({
    tested: results.length,
    working: results.filter((r) => r.status === 200).map((r) => `${r.model} (${r.ms}ms)`),
    all: results
  });
}
