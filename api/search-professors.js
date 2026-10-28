export const config = { maxDuration: 30 };

const BASE = "https://api.openalex.org";

const ALIASES = {
  "unc": "University of North Carolina at Chapel Hill",
  "unc chapel hill": "University of North Carolina at Chapel Hill",
  "unc-chapel hill": "University of North Carolina at Chapel Hill",
  "nc state": "North Carolina State University",
  "nc state university": "North Carolina State University",
  "ncsu": "North Carolina State University",
  "mit": "Massachusetts Institute of Technology",
  "ucla": "University of California, Los Angeles",
  "uc berkeley": "University of California, Berkeley",
  "georgia tech": "Georgia Institute of Technology",
  "usc": "University of Southern California"
};

async function oa(path, params) {
  const url = new URL(BASE + path);

  Object.entries({ ...params, api_key: process.env.OPENALEX_API_KEY }).forEach(
    ([key, value]) => url.searchParams.set(key, value)
  );

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`OpenAlex request failed (${response.status})`);
  }

  return response.json();
}

const shortId = (id) => String(id || "").split("/").pop();

async function resolveInstitution(name) {
  const key = String(name).toLowerCase().trim();
  const query = ALIASES[key] || name;

  const data = await oa("/institutions", {
    search: query,
    "per-page": 1,
    select: "id,display_name"
  });

  const hit = data.results?.[0];

  return hit ? { id: shortId(hit.id), name: hit.display_name } : null;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!process.env.OPENALEX_API_KEY) {
    return res.status(500).json({ error: "OPENALEX_API_KEY is missing" });
  }

  const { institutions, topics, yearsBack = 3 } = req.body || {};

  if (
    !Array.isArray(institutions) || institutions.length === 0 ||
    !Array.isArray(topics) || topics.length === 0
  ) {
    return res.status(400).json({
      error: "Send { institutions: [...names], topics: [...keywords] }"
    });
  }

  try {
    // 1. Turn school names into OpenAlex IDs (names are ambiguous, IDs aren't)
    const resolved = await Promise.all(
      institutions.slice(0, 10).map(resolveInstitution)
    );

    const found = resolved.filter(Boolean);
    const unresolved = institutions.slice(0, 10).filter((_, i) => !resolved[i]);

    if (found.length === 0) {
      return res.status(404).json({
        error: "No matching institutions found.",
        unresolved
      });
    }

    const institutionIds = new Set(found.map((inst) => inst.id));

    // 2. Find recent papers on these topics from these schools
    const searchQuery = topics
      .slice(0, 8)
      .map((topic) => `"${String(topic).replace(/"/g, "")}"`)
      .join(" OR ");

    const fromYear = new Date().getFullYear() - Number(yearsBack);

    const works = await oa("/works", {
      search: searchQuery,
      filter: [
        `authorships.institutions.id:${[...institutionIds].join("|")}`,
        `from_publication_date:${fromYear}-01-01`
      ].join(","),
      "per-page": 100,
      select: "id,title,publication_year,doi,cited_by_count,authorships"
    });

    // 3. Group by senior (last) author at the matching school
    const byAuthor = new Map();

    for (const work of works.results || []) {
      for (const authorship of work.authorships || []) {
        if (authorship.author_position !== "last") continue;

        const school = (authorship.institutions || []).find((inst) =>
          institutionIds.has(shortId(inst.id))
        );

        if (!school || !authorship.author?.id) continue;

        const authorId = shortId(authorship.author.id);

        if (!byAuthor.has(authorId)) {
          byAuthor.set(authorId, {
            authorId,
            name: authorship.author.display_name,
            institution: school.display_name,
            papers: []
          });
        }

        byAuthor.get(authorId).papers.push({
          id: work.id,
          title: work.title,
          year: work.publication_year,
          doi: work.doi,
          citations: work.cited_by_count
        });
      }
    }

    // 4. Rank by paper count, then balance across schools
    const sorted = [...byAuthor.values()].sort(
      (a, b) => b.papers.length - a.papers.length
    );

    const perSchool = new Map();

    for (const prof of sorted) {
      const list = perSchool.get(prof.institution) || [];
      list.push(prof);
      perSchool.set(prof.institution, list);
    }

    const lists = [...perSchool.values()];
    const balanced = [];

    for (let i = 0; balanced.length < 30 && lists.some((l) => i < l.length); i++) {
      for (const list of lists) {
        if (i < list.length && balanced.length < 30) {
          balanced.push(list[i]);
        }
      }
    }

    const professors = balanced.map((prof) => ({
      ...prof,
      profileUrl: `https://openalex.org/${prof.authorId}`,
      paperCount: prof.papers.length,
      papers: prof.papers.slice(0, 3)
    }));

    return res.status(200).json({
      institutions: found,
      unresolved,
      professors,
      note: "Senior researcher is estimated from last-author position on recent papers."
    });
  } catch (error) {
    console.error("search-professors error:", error);
    return res.status(502).json({
      error: "Professor search failed. Please try again."
    });
  }
}
