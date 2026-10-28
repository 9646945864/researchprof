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
      <button type="button" data-d="${i}" style="padding:8px 14px;margin-right:8px">View details</button>
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

/* ---------- PROFESSOR DETAILS ---------- */

$("out").addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-d]");
  if (!btn) return;

  const prof = lastList[btn.dataset.d];
  $("pmb").innerHTML = '<p class="sub">Loading…</p>';
  $("pm").style.display = "flex";

  try {
    const d = await post("/api/professor", { authorId: prof.authorId });

    const papers = d.papers.map((p) =>
      `<div style="margin:10px 0"><b>${esc(p.title)}</b> <span class="sub">(${esc(p.year)} · ${esc(p.citations)} citations)</span>
       <div class="sub" style="margin-top:4px">${esc(p.abstract)}</div></div>`
    ).join("");

    $("pmb").innerHTML = `
      <h2 style="margin:0">${esc(d.name)}</h2>
      <div class="sub">${esc(d.institution)}${d.orcid ? " · ORCID " + esc(d.orcid.split("/").pop()) : ""}</div>
      <p class="sub">${esc(d.stats.works)} papers · ${esc(d.stats.citations)} citations · h-index ${esc(d.stats.hIndex)}</p>
      ${d.summary ? `<h4>What they study</h4><p>${esc(d.summary)}</p>` : ""}
      <h4>Main topics</h4><p>${d.topics.map((t) => esc(t)).join(" · ")}</p>
      <h4>Often publishes with</h4><p>${d.coauthors.map((c) => esc(c.name) + " (" + c.count + ")").join(", ")}</p>
      <h4>Recent papers</h4>${papers}`;
  } catch (err) {
    console.error(err);
    $("pmb").innerHTML = '<p class="m err">Couldn\'t load details. Try again.</p>';
  }
});

$("pmx").addEventListener("click", () => ($("pm").style.display = "none"));
