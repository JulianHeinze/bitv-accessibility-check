/* =========================================================================
   Accessibility-Crawler – Express-Backend
   =========================================================================
   • /api/scan     – scannt eine einzelne URL oder eine komplette Sitemap
   • /api/progress – Server-Sent Events für Fortschrittsanzeige
   • Statische Ordner: GUI, Reports, Rohdaten
   ------------------------------------------------------------------------- */

const express          = require("express");
const path             = require("path");
const fs               = require("fs-extra");
const { EventEmitter } = require("events");

const { runAxeScan }     = require("./scanner/axeScan");
const { runIbmScan }     = require("./scanner/ibmcheck");
const { generateReport } = require("./report/reportGenerator");
const { loadSitemap }    = require("./crawler/sitemapLoader");

/* ── Helper ────────────────────────────────────────────────────────────── */

/** sprechbarer Dateiname aus URL */
const slug = (url) =>
  url
    .replace(/^https?:\/\//i, "")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);

/** Progress-Emitter, garantiert ganzzahlig & monoton */
const progressEmitter = new EventEmitter();
let lastPct = 0;
function emit(pct, msg) {
  const p = Math.min(100, Math.max(lastPct + 1, Math.round(pct)));
  lastPct = p;
  progressEmitter.emit("progress", { percent: p, message: msg });
}

/** versucht, eine Sitemap zu laden, gibt sonst null zurück */
async function tryLoadSm(url) {
  try {
    return await loadSitemap(url);
  } catch {
    return null;
  }
}

/** Sitemap aus robots.txt lesen */
async function robotsSm(url) {
  const host = url.replace(/(^https?:\/\/[^\/]+).*/, "$1");
  const robotsUrl = host + "/robots.txt";
  try {
    const { default: fetch } = await import("node-fetch");
    const txt = await (await fetch(robotsUrl)).text();
    const line = txt
      .split(/\r?\n/)
      .find((l) => l.toLowerCase().startsWith("sitemap:"));
    return line ? line.replace(/sitemap:\s*/i, "").trim() : null;
  } catch {
    return null;
  }
}

/* ── Express-Setup ─────────────────────────────────────────────────────── */

const app = express();
app.use(express.json());

app.use(express.static(path.join(__dirname, "../gui/public")));
app.use("/reports", express.static(path.join(__dirname, "../reports")));
app.use("/data", express.static(path.join(__dirname, "../data")));

/* ── SSE: /api/progress ────────────────────────────────────────────────── */
app.get("/api/progress", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const send = (p) => res.write(`data:${JSON.stringify(p)}\n\n`);
  progressEmitter.on("progress", send);
  req.on("close", () => progressEmitter.off("progress", send));
});

/* ── POST /api/scan ────────────────────────────────────────────────────── */
app.post("/api/scan", async (req, res) => {
  const { url, sitemap: useSitemap } = req.body;
  if (!url) return res.status(400).json({ error: "Keine URL angegeben." });

  lastPct = 0; // Reset für neuen Lauf
  try {
    /* ---------- 1) URL-Liste bestimmen ---------- */
    const start = url.trim();
    const looksXml = start.toLowerCase().endsWith(".xml");
    let urls = [];

    if (useSitemap || looksXml) {
      urls = (await tryLoadSm(start)) || [];
      if (!urls.length) {
        const guess = start.replace(/\/$/, "") + "/sitemap.xml";
        urls = (await tryLoadSm(guess)) || [];
      }
      if (!urls.length) {
        const robots = await robotsSm(start);
        if (robots) urls = (await tryLoadSm(robots)) || [];
      }
    }

    if (!urls.length) urls = [start];
    emit(1, `${urls.length} Seite(n) werden gescannt …`);

    /* ---------- 2) Seiten durchlaufen ---------- */
    const indexArr = [];
    for (let i = 0; i < urls.length; i++) {
      const curr = urls[i];
      const base = (i / urls.length) * 100;

      emit(base + 1, `Scanne ${curr}`);
      const axe = await runAxeScan(curr);
      emit(base + 20, "axe-Scan fertig");

      const ibm = await runIbmScan(curr);
      emit(base + 40, "IBM-Scan fertig");

      const payload = [
        {
          url: curr,
          results: {
            axe: { ok: true, data: axe },
            ibm: { ok: true, data: ibm },
          },
        },
      ];

      const file = `/reports/output/${slug(curr)}.html`;
      await generateReport(payload, {
        templatePath: path.join(
          __dirname,
          "../reports/templates/bitv-report-template.html"
        ),
        outputPath: path.resolve(__dirname, `..${file}`),
        mappingPath: path.join(__dirname, "./mapping/rule_to_wcag.json"),
        criteriaPath: path.join(__dirname, "./mapping/mapping.json"),
      });

      indexArr.push({ url: curr, file });
      emit(base + 60, "Report erstellt");
    }

    /* ---------- 3) Indexseite ---------- */
    const idxFile = "/reports/output/index.html";
    const rows = indexArr
      .map(
        (e) =>
          `<li><a href="${e.file}" target="_blank" rel="noopener">${e.url}</a></li>`
      )
      .join("");
    await fs.outputFile(
      path.resolve(__dirname, `..${idxFile}`),
      `<!DOCTYPE html><meta charset="utf-8"><h1>Accessibility-Reports</h1><ul>${rows}</ul>`
    );

    emit(100, "Fertig 🎉");
    res.json({ success: true, index: idxFile });
  } catch (err) {
    emit(100, "❌ Fehler: " + err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/* Direktlink – zeigt Indexseite */
app.get("/report", (req, res) =>
  res.sendFile(path.resolve(__dirname, "../reports/output/index.html"))
);

/* ── Serverstart ───────────────────────────────────────────────────────── */
app.listen(3000, () =>
  console.log("GUI-Server läuft unter  http://localhost:3000")
);
