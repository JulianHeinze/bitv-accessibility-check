// src/report/reportGenerator.js – WCAG-HTML-Report (axe + IBM)
// -----------------------------------------------------------------------------

const fs = require("fs-extra");
const path = require("path");
const Handlebars = require("handlebars");

/*──────────────────────── Handlebars-Helper ───────────────────────*/
Handlebars.registerHelper("statusClass", (s) =>
  s.startsWith("✓") ? "pass" : s.startsWith("✗") ? "fail" : "manual"
);
Handlebars.registerHelper("add", (...args) => {
  const opts = args.pop();                     // letzter Eintrag = Optionen
  return args.reduce((sum, v) => sum + (v == null ? 0 : +v), 0);
});

/*──────────────────────── Parser axe / IBM ───────────────────────*/
const outcomeFromValue = (a) => {
  if (!Array.isArray(a)) return "unknown";
  if (a.includes("VIOLATION") || a.includes("FAIL")) return "fail";
  if (a.includes("PASS")) return "pass";
  if (a.includes("POTENTIAL")) return "potential";
  return "unknown";
};

function parseAxe(item) {
  if (!item.results?.axe?.ok) return [];
  const axe = item.results.axe.data;
  const groups = {
    violations: "fail",
    passes: "pass",
    incomplete: "potential",
    inapplicable: "inapplicable",
  };
  const out = [];
  for (const [key, outcome] of Object.entries(groups)) {
    for (const rule of axe[key] || []) {
      for (const node of rule.nodes || []) {
        out.push({
          src:       "axe",
          ruleId:    rule.id,
          outcome,
          impact:    rule.impact || "minor",
          selector:  (node.target || []).join(", "),
          message:   node.failureSummary || rule.description || "",
        });
      }
    }
  }
  return out;
}

function parseIbm(item) {
  if (!item.results?.ibm?.ok) return [];
  return (item.results.ibm.data || []).map((r) => ({
    src:       "ibm",
    ruleId:    r.ruleId,
    outcome:   outcomeFromValue(r.value),
    impact:    r.level || "potentialviolation",
    selector:  r.path?.dom || "",
    message:   r.message || "",
  }));
}

const extractRecords = (item) => [...parseAxe(item), ...parseIbm(item)];

/*──────────────────────── Mapping-Utilities ──────────────────────*/
const asScObj = (raw) => {
  if (!raw) return null;
  if (typeof raw === "string") return { id: raw, name: raw };
  return {
    id:   String(raw.wcag_id || raw.id || ""),
    name: String(raw.name_de || raw.name || raw.wcag_id || raw.id || ""),
  };
};

function normalizeRuleMap(raw) {
  if (!Array.isArray(raw)) return raw;          // bereits rule-zentriert
  const m = {};
  raw.forEach((sc) => {
    const obj = asScObj(sc);
    if (!obj?.id) return;
    (sc.rules || []).forEach((r) => {
      if (!r) return;
      (m[r] = m[r] || []).push(sc);
    });
  });
  return m;
}

function buildReverseMap(ruleMap) {
  const rev = {};
  for (const [ruleId, entry] of Object.entries(ruleMap)) {
    (Array.isArray(entry) ? entry : [entry]).forEach((raw) => {
      const sc = asScObj(raw);
      if (!sc?.id) return;
      (rev[sc.id] = rev[sc.id] || { sc, rules: [] }).rules.push(ruleId);
    });
  }
  return rev;
}

/*──────────────────────── WCAG-Checkliste ───────────────────────*/
function buildWcagChecklist(records, ruleMap, scMeta) {
  const rev    = buildReverseMap(ruleMap);
  const status = {};                 // { scId: "pass"|"fail" }
  const viol   = {};                 // { scId: { axe:[], ibm:[] } }

  records.forEach((rec) => {
    const entry = ruleMap[rec.ruleId];
    if (!entry) return;
    (Array.isArray(entry) ? entry : [entry]).forEach((raw) => {
      const sc = asScObj(raw);
      if (!sc?.id) return;
      status[sc.id] ??= "pass";
      if (rec.outcome === "fail") {
        status[sc.id] = "fail";
        const bucket = (viol[sc.id] = viol[sc.id] || { axe: [], ibm: [] });
        bucket[rec.src].push(rec);
      }
    });
  });

  // Quelle der Kriterien: Metadaten-Datei oder nur gefundene
  const srcList = Object.keys(scMeta).length
    ? Object.values(scMeta)                       // alle Kriterien
    : Object.values(rev).map((o) => ({            // nur gemappte
        wcag_id: o.sc.id,
        name_de: o.sc.name,
      }));

  return srcList
    .sort((a, b) =>
      a.wcag_id.localeCompare(b.wcag_id, "de", { numeric: true })
    )
    .map((meta) => ({
      id:          meta.wcag_id,
      name:        meta.name_de || meta.name,
      principle:   meta.principle,
      level:       meta.level,
      description: meta.description_de || meta.description,
      rules:       rev[meta.wcag_id]?.rules || [],
      status:      status[meta.wcag_id]
                    ? status[meta.wcag_id] === "fail"
                      ? "✗ nicht erfüllt"
                      : "✓ erfüllt"
                    : "⚠️ manuell prüfen",
      violations:  viol[meta.wcag_id] || { axe: [], ibm: [] },
    }));
}

/*──────────────────────── Page-Summary ──────────────────────────*/
function buildSummary(records) {
  const levels = [
    "critical", "serious", "moderate", "minor",
    "violation", "potentialviolation",
  ];
  const out = Object.fromEntries(levels.map((l) => [l, 0]));
  records.forEach((r) => {
    if (r.outcome === "fail" && out[r.impact] !== undefined) out[r.impact]++;
  });
  return out;
}

function buildPage(item, ruleMap, scMeta) {
  const recs = extractRecords(item);
  return {
    url:     item.url,
    summary: buildSummary(recs),
    wcag:    buildWcagChecklist(recs, ruleMap, scMeta),
  };
}

/*──────────────────────── Main-Generator ───────────────────────*/
async function generateReport(
  results,
  { templatePath, outputPath, mappingPath, criteriaPath }
) {
  /* 1 | Kriterien-Datei ermitteln */
  if (!criteriaPath) {
    criteriaPath = path.join(
      path.dirname(mappingPath || templatePath),   // → …/src/mapping
      "mapping.json"                               // ← dein Metadaten-File
    );
  }

  /* 2 | Template + Regel-Mapping lesen */
  const [tplSrc, mappingRaw] = await Promise.all([
    fs.readFile(templatePath, "utf8"),
    fs.readJson(mappingPath),
  ]);

  /* 3 | WCAG-Metadaten laden */
  let scMeta = {};
  try {
    const criteriaRaw = await fs.readJson(criteriaPath);
    console.log("✅  WCAG-Kriterien geladen:", criteriaRaw.length);
    scMeta = Object.fromEntries(
      criteriaRaw.map((c) => [String(c.wcag_id), c])
    );
  } catch (e) {
    console.warn("⚠️  Konnte WCAG-Kriterien nicht laden:", e.message);
  }

  /* 4 | Datenstruktur für Template erzeugen */
  const ruleMap = normalizeRuleMap(mappingRaw);
  const tpl     = Handlebars.compile(tplSrc);

  const pages = results.map((item) => {
    const ok = item.results?.axe?.ok || item.results?.ibm?.ok;
    if (!ok) {
      const err = item.results?.axe?.error
               || item.results?.ibm?.error
               || "Scan-Error";
      return { url: item.url, error: err };
    }
    return buildPage(item, ruleMap, scMeta);
  });

  /* 5 | HTML ausgeben */
  await fs.outputFile(
    outputPath,
    tpl({ pages, generated: new Date().toLocaleString("de-DE") }),
    "utf8"
  );
}

module.exports = { generateReport };
