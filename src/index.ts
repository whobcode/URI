import { Hono } from "hono";

type Bindings = { ASSETS: Fetcher };
const app = new Hono<{ Bindings: Bindings }>();

interface ParsedReq { name: string; norm: string; specifier: string; extras: string; marker: string; raw: string; source: string; }

// Normalize per PEP 503: lowercase, runs of -_. become a single -.
const normalize = (n: string) => n.toLowerCase().replace(/[-_.]+/g, "-");

const REQ_RE = /^\s*([A-Za-z0-9._-]+)\s*(\[[^\]]*\])?\s*([<>=!~][^;#]*)?(?:;\s*(.*?))?\s*(?:#.*)?$/;

function parse(content: string, source: string): { reqs: ParsedReq[]; notes: string[] } {
  const reqs: ParsedReq[] = [];
  const notes: string[] = [];
  for (const lineRaw of content.split(/\r?\n/)) {
    const line = lineRaw.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("-r") || line.startsWith("--requirement")) { notes.push(`${source}: nested include skipped → "${line}"`); continue; }
    if (line.startsWith("-")) { notes.push(`${source}: option line kept as-is → "${line}"`); continue; }
    if (/^(https?:|git\+|\.|\/)/.test(line) || line.includes("@")) { notes.push(`${source}: URL/VCS/local req kept as-is → "${line}"`); continue; }
    const m = line.match(REQ_RE);
    if (!m) { notes.push(`${source}: could not parse → "${line}"`); continue; }
    const [, name, extras = "", specifier = "", marker = ""] = m;
    reqs.push({ name, norm: normalize(name), specifier: specifier.replace(/\s+/g, ""), extras, marker: marker.trim(), raw: line, source });
  }
  return { reqs, notes };
}

function pinnedVersion(spec: string): string | null {
  const m = spec.match(/==\s*([^\s,]+)/);
  return m ? m[1] : null;
}

// POST /api/merge { files: [{name, content}] }
app.post("/api/merge", async (c) => {
  const body = (await c.req.json().catch(() => null)) as { files?: { name: string; content: string }[] } | null;
  if (!body?.files?.length) return c.json({ error: "files: [{name, content}] required" }, 400);

  const allNotes: string[] = [];
  const byPkg = new Map<string, ParsedReq[]>();
  for (const f of body.files) {
    const { reqs, notes } = parse(f.content, f.name || "file");
    allNotes.push(...notes);
    for (const r of reqs) {
      const arr = byPkg.get(r.norm) ?? [];
      arr.push(r);
      byPkg.set(r.norm, arr);
    }
  }

  const merged: { name: string; specifier: string; extras: string; markers: string[]; sources: string[] }[] = [];
  const conflicts: { package: string; specifiers: { value: string; source: string }[] }[] = [];

  for (const [norm, reqs] of [...byPkg.entries()].sort()) {
    const pins = new Set(reqs.map((r) => pinnedVersion(r.specifier)).filter(Boolean) as string[]);
    const extras = [...new Set(reqs.map((r) => r.extras).filter(Boolean))].join("");
    const markers = [...new Set(reqs.map((r) => r.marker).filter(Boolean))];
    const sources = [...new Set(reqs.map((r) => r.source))];
    const displayName = reqs[0].name;

    if (pins.size > 1) {
      conflicts.push({ package: displayName, specifiers: reqs.filter((r) => pinnedVersion(r.specifier)).map((r) => ({ value: r.specifier, source: r.source })) });
      // keep the highest pinned version as a best-effort resolution
      const chosen = [...pins].sort().reverse()[0];
      merged.push({ name: displayName, specifier: `==${chosen}`, extras, markers, sources });
    } else {
      // combine all distinct specifiers (e.g. >=1.0 and <2.0) with commas
      const specs = [...new Set(reqs.map((r) => r.specifier).filter(Boolean))];
      merged.push({ name: displayName, specifier: specs.join(","), extras, markers, sources });
    }
  }

  const lines = merged.map((m) => `${m.name}${m.extras}${m.specifier}${m.markers.length ? " ; " + m.markers.join(" and ") : ""}`);
  const requirementsTxt = lines.join("\n") + "\n";

  return c.json({
    packageCount: merged.length,
    conflictCount: conflicts.length,
    conflicts,
    notes: allNotes,
    requirementsTxt,
    installCommand: `pip install -r requirements.txt   # ${merged.length} packages`,
  });
});

export default app;
