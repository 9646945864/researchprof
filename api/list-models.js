export default async function handler(req, res) {
  const key = process.env.NVIDIA_API_KEY;

  if (!key) {
    return res.status(500).json({ error: "NVIDIA_API_KEY is missing" });
  }

  const filter = String(req.query.q || "").toLowerCase();

  const response = await fetch("https://integrate.api.nvidia.com/v1/models", {
    headers: { Authorization: `Bearer ${key}` }
  });

  const text = await response.text();

  let data;

  try {
    data = JSON.parse(text);
  } catch {
    return res.status(502).json({ status: response.status, body: text.slice(0, 300) });
  }

  const ids = (data.data || [])
    .map((model) => model.id)
    .filter((id) => id.toLowerCase().includes(filter))
    .sort();

  return res.status(200).json({ status: response.status, count: ids.length, ids });
}
