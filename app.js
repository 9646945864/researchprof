const $ = (id) => document.getElementById(id);

const esc = (s) => {
  const d = document.createElement("div");
  d.textContent = String(s ?? "");
  return d.innerHTML;
};

const safe = (u) => (/^https?:\/\//i.test(u || "") ? u : "#");

function say(text, cls = "bot") {
  const el = document.createElement("div");
  el.className = "m " + cls;
  el.textContent = text;
  $("msgs").appendChild(el);
  $("msgs").scrollTop = 1e9;
  return el;
}

async function post(url, body) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  let data = null;
  try { data = await r.json(); } catch {}

  if (!r.ok) {
    const e = new Error(data?.error || "Request failed");
    e.status = r.status;
    e.data = data;
    throw e;
  }

  return data;
}

function show(list) {
  $("n").textContent = list.length ? `(${list.length})` : "";

  if (!list.length) {
    $("out").innerHTML = '<p class="sub">No matches. Try broader topics.</p>';
    return;
  }

  $("out").innerHTML = list.map((p) => {
    const papers = (p.papers || []).map((x) =>
      `<li><a href="${esc(safe(x.doi))}" target="_blank" rel="noopener">${esc(x.title || "Untitled")}</a> (${esc(x.year)})</li>`
    ).join("");

    const faculty = "https://www.google.com/search?q=" +
      encodeURIComponent(`${p.name} ${p.institution} faculty`);

    return `<article class="card">
      <h3>${esc(p.name)}</h3>
      <div class="sub">${esc(p.institution)} · ${esc(p.paperCount)} matching paper${p.paperCount === 1 ? "" : "s"}</div>
      <ul>${papers}</ul>
      <a href="${esc(safe(p.profileUrl))}" target="_blank" rel="noopener">Research profile</a>
      <a href="${esc(faculty)}" target="_blank" rel="noopener">Find faculty page</a>
    </article>`;
  }).join("");
}

$("f").addEventListener("submit", async (e) => {
  e.preventDefault();

  const text = $("q").value.trim();
  if (!text) return;

  say(text, "user");
  $("q").value = "";
  $("b").disabled = true;

  const bot = say("Reading that…");

  try {
    const query = await post("/api/parse-query", { text });

    if (!query.institutions.length || !query.topics.length) {
      bot.textContent = query.reply || "Tell me which schools and topics you want.";
      return;
    }

    bot.textContent = `Searching ${query.institutions.join(", ")} for ${query.topics.join(", ")}…`;

    const res = await post("/api/search-professors", {
      institutions: query.institutions,
      topics: query.topics
    });

    show(res.professors);

    const schools = res.institutions.map((i) => i.name).join(" and ");
    bot.textContent = res.professors.length
      ? `Found ${res.professors.length} researchers at ${schools}. Seniority is estimated from last-author position on recent papers.`
      : `No matches at ${schools}. Try broader topics.`;

    if (res.unresolved?.length) {
      bot.textContent += ` Couldn't find: ${res.unresolved.join(", ")}.`;
    }
  } catch (err) {
    console.error(err);
    bot.className = "m err";
    bot.textContent = err.status === 503
      ? "The AI is busy. Try again in a minute."
      : "Something went wrong. Try rephrasing.";
  } finally {
    $("b").disabled = false;
    $("q").focus();
  }
});

say('Hi! Try: "Find professors at UNC or NC State studying AI or environment."');
