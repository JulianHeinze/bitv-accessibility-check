// src/report/reportGenerator.js – WCAG-/EN-HTML-Report (axe + IBM)
// -----------------------------------------------------------------------------
//
//  Änderungen gegenüber der Originalversion sind mit  [★]  markiert.
//

const fs         = require("fs-extra");
const path       = require("path");
const Handlebars = require("handlebars");

/*──────────────────────── Helpers ───────────────────────────────*/
Handlebars.registerHelper("statusClass", (s) =>
  s.startsWith("✓") ? "pass"
: s.startsWith("✗") ? "fail"
: "manual"                        // ⚠️ / – / 🚫
);

/* ★  group-by – funktioniert als Sub-Expression */
/* ★ group-by – behält jetzt die Original-Reihenfolge bei (Map statt Plain‑Object) */
Handlebars.registerHelper("group-by", function (field, list) {
  const groups = new Map();
  (list || []).forEach((item) => {
    const k = item[field] || "";
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(item);
  });
  return Array.from(groups.values());   // Reihenfolge der ersten Vorkommen
});

Handlebars.registerHelper("add", (...args) => {
  const opts = args.pop();
  return args.reduce((sum, v) => sum + (v == null ? 0 : +v), 0);
});

/*──────────────────────── Parser axe / IBM ─────────────────────*/
const outcomeFromValue = (a) => {
  if (!Array.isArray(a)) return "unknown";
  if (a.includes("VIOLATION") || a.includes("FAIL")) return "fail";
  if (a.includes("PASS"))                           return "pass";
  if (a.includes("POTENTIAL"))                      return "potential";
  return "unknown";
};

function parseAxe(item) {
  if (!item.results?.axe?.ok) return [];
  const axe = item.results.axe.data;
  const groups = {
    violations:   "fail",
    passes:       "pass",
    incomplete:   "potential",
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

/*──────────────────────── Mapping-Utilities ─────────────────────*/
const asScObj = (raw) => {
  if (!raw) return null;
  if (typeof raw === "string") return { id: raw, en: raw, wcag: raw, name: raw };

  return {
    id:   String(raw.en_id || raw.wcag_id || raw.id || ""),
    en:   String(raw.en_id   || ""),
    wcag: String(raw.wcag_id || ""),
    name: String(
      raw.name_de || raw.name ||
      raw.en_id   || raw.wcag_id || raw.id || ""
    ),

    /* ★ Kapitel-Infos direkt übernehmen */
    chapter:         String(raw.chapter         || ""),
    chapterTitle:    String(raw.chapterTitle    || ""),
  };
};

function normalizeRuleMap(raw) {
  if (!Array.isArray(raw)) return raw;
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

      const keys = new Set([sc.id, sc.wcag].filter(Boolean));
      keys.forEach((key) => {
        (rev[key] = rev[key] || { sc, rules: [] }).rules.push(ruleId);
      });
    });
  }
  return rev;
}

/*──────────────────────── WCAG-/EN-Liste ───────────────────────*/
/*
 * ★ Änderung:  buildWcagChecklist erhält ein zusätzliches Argument
 *   "orderSource" (Array). Ist preserveOrder=true (Standard) und
 *   orderSource vorhanden, wird exakt dessen Reihenfolge verwendet.
 */
function buildWcagChecklist(records, ruleMap, scMeta, orderSource = [], { preserveOrder = true } = {}) {
  const rev      = buildReverseMap(ruleMap);
  const outcomes = {};
  const viol     = {};

  records.forEach((rec) => {
    const entry = ruleMap[rec.ruleId];
    if (!entry) return;

    (Array.isArray(entry) ? entry : [entry]).forEach((raw) => {
      const sc = asScObj(raw);
      if (!sc?.id) return;

      const o = (outcomes[sc.id] = outcomes[sc.id] || {pass:false,fail:false,inapp:false});
      if      (rec.outcome === "fail")        o.fail  = true;
      else if (rec.outcome === "pass")        o.pass  = true;
      else if (rec.outcome === "inapplicable")o.inapp = true;

      if (rec.outcome === "fail") {
        const bucket = (viol[sc.id] = viol[sc.id] || { axe: [], ibm: [] });
        bucket[rec.src].push(rec);
      }
    });
  });

  let srcList;

  /* ★ 1) Wenn preserveOrder & orderSource → genau diese Reihenfolge */
  if (preserveOrder && Array.isArray(orderSource) && orderSource.length) {
    srcList = orderSource;
  } else {
    /* 2) Alternative Wege wie bisher */
    srcList = Object.keys(scMeta).length
      ? [...new Set(Object.values(scMeta))]
      : Object.values(rev).map((o) => ({
          wcag_id: o.sc.wcag,
          en_id:   o.sc.en,
          name_de: o.sc.name,
        }));

    if (!preserveOrder) {
      srcList.sort((a, b) => {
        const toNumericArray = (id) =>
          (id || "")
            .split(".")
            .map((part) => parseInt(part, 10))
            .filter((n) => !isNaN(n));

        const idA_raw = a.en_id || a.wcag_id || "";
        const idB_raw = b.en_id || b.wcag_id || "";

        const idA = toNumericArray(idA_raw);
        const idB = toNumericArray(idB_raw);

        for (let i = 0; i < Math.max(idA.length, idB.length); i++) {
          const valA = idA[i] ?? 0;
          const valB = idB[i] ?? 0;
          if (valA !== valB) return valA - valB;
        }
        return idA.length - idB.length;
      });
    }
  }

  return srcList.map((meta) => {
    const r = rev[meta.en_id] || rev[meta.wcag_id] || {};
    const o = outcomes[r.sc?.id] || {};

    let status;
    if (o.fail)               status = "✗ nicht erfüllt";
    else if (o.pass)          status = "✓ erfüllt";
    else if (o.inapp)         status = "– nicht anwendbar";
    else if (r.rules?.length) status = "⚠️ manuell prüfen";
    else                      status = "🚫 nicht automatisch prüfbar";

    const chapter      = meta.chapter      || (meta.en_id || meta.wcag_id).split(".")[0];
    const chapterTitle = meta.chapterTitle || "";

    return {
      id:   meta.wcag_id || meta.en_id,
      en:   meta.en_id   || "",
      wcag: meta.wcag_id || "",
      name:        meta.name_de || meta.name,
      level:       meta.level,
      description: meta.description_de || meta.description,
      chapter, chapterTitle,
      rules:       r.rules || [],
      status,
      violations:  viol[r.sc?.id] || { axe: [], ibm: [] },
    };
  });
}

/*──────────────────────── Page-Summary ─────────────────────────*/
function buildSummary(records) {
  const out = {critical:0, serious:0, moderate:0, minor:0, violation:0, potentialviolation:0};
  records.forEach((r) => {
    if (r.outcome === "fail" && out[r.impact] !== undefined) out[r.impact]++;
  });
  return out;
}

/* ★ buildPage erhält orderSource   */
function buildPage(item, ruleMap, scMeta, orderSource) {
  const recs = extractRecords(item);
  return {
    url:     item.url,
    summary: buildSummary(recs),
    wcag:    buildWcagChecklist(recs, ruleMap, scMeta, orderSource /* mapping order */, { preserveOrder: true }),
  };
}

/*──────────────────────── Main-Generator ───────────────────────*/
async function generateReport(
  results,
  { templatePath, outputPath, mappingPath, criteriaPath }
) {
  if (!criteriaPath) {
    criteriaPath = path.join(path.dirname(mappingPath || templatePath),
                             "mapping.json");
  }

  const [tplSrc, mappingRaw] = await Promise.all([
    fs.readFile(templatePath, "utf8"),
    fs.readJson(mappingPath),
  ]);

  /* Metadaten in scMeta */
  let scMeta = {};
  try {
    const criteriaRaw = await fs.readJson(criteriaPath);
    criteriaRaw.forEach((c) => {
      const k1 = c.wcag_id ? String(c.wcag_id) : null;
      const k2 = c.en_id   ? String(c.en_id)   : null;
      if (k1) scMeta[k1] = c;
      if (k2) scMeta[k2] = c;
    });
  } catch (e) {
    console.warn("⚠️  Konnte Kriterien nicht laden:", e.message);
  }

  const ruleMap = normalizeRuleMap(mappingRaw);
  const tpl     = Handlebars.compile(tplSrc);

  const pages = results.map((item) => {
    const ok = item.results?.axe?.ok || item.results?.ibm?.ok;
    if (!ok) {
      const err = item.results?.axe?.error
               || item.results?.ibm?.error || "Scan-Error";
      return { url: item.url, error: err };
    }
    return buildPage(item, ruleMap, scMeta, mappingRaw);
  });

  await fs.outputFile(
    outputPath,
    tpl({ pages, generated: new Date().toLocaleString("de-DE") }),
    "utf8"
  );
}

module.exports = { generateReport };