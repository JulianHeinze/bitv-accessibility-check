const express = require('express');
const path = require('path');
const fs = require('fs-extra');
const { EventEmitter } = require('events');

const ClusterScanEngine = require('./scanner/scanner');
const { generateReport } = require('./report/reportGenerator');
const { findSitemap } = require('./crawler/sitemapLoader');

// Hilfsfunktion zur Erzeugung lesbarer Dateinamen aus URLs
const slug = (url) =>
  url
    .replace(/^https?:\/\//i, '')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);

const progressEmitter = new EventEmitter();
let lastPct = 0;
function emit(pct, msg) {
  const p = Math.min(100, Math.max(lastPct + 1, Math.round(pct)));
  lastPct = p;
  progressEmitter.emit('progress', { percent: p, message: msg });
}

const app = express();
app.use(express.json());

app.use(express.static(path.join(__dirname, '../gui/public')));
app.use('/reports', express.static(path.join(__dirname, '../reports')));
app.use('/data', express.static(path.join(__dirname, '../data')));

app.get('/api/progress', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const send = (p) => res.write(`data:${JSON.stringify(p)}\n\n`);
  progressEmitter.on('progress', send);
  req.on('close', () => progressEmitter.off('progress', send));
});

app.post('/api/scan', async (req, res) => {
  const { url, sitemap: useSitemap } = req.body;
  if (!url) return res.status(400).json({ error: 'Keine URL angegeben.' });

  lastPct = 0;
  try {
    const start = url.trim();
    const looksXml = start.toLowerCase().endsWith('.xml');
    let urls = [];

    if (useSitemap || looksXml) {
      urls = await findSitemap(start);
    }

    if (!urls.length) urls = [start];
    emit(1, `${urls.length} Seite(n) werden gescannt …`);

    const engine = new ClusterScanEngine(5);
    await engine.init();
    engine.progressCallback = emit;

    let done = 0;
    const total = urls.length;

    engine.cluster.on('taskerror', (err, data, willRetry) => {
      emit(100, `❌ Fehler bei ${data}: ${err.message}`);
    });

    engine.cluster.on('taskfinish', () => {
      done++;
      const pct = Math.round((done / total) * 100);
      emit(pct, `${done}/${total} Seiten gescannt`);
    });

    await engine.scanAll(urls); // Scan aller URLs starten
    const results = engine.results;
    await engine.shutdown();

    const indexArr = [];

    for (const result of results) {
      // Für jede geprüfte Seite Prüfbericht erstellen
      const file = `/reports/output/${slug(result.url)}.html`;

      const rawPath = path.resolve(
        // Speicherung der Rohdaten (JSON)
        __dirname,
        `../data/raw/${slug(result.url)}.json`
      );
      await fs.outputJson(rawPath, result, { spaces: 2 });

      await generateReport([result], {
        // Generierung des Prüfbericht
        templatePath: path.join(
          __dirname,
          '../reports/templates/bitv-report-template.html'
        ),
        outputPath: path.resolve(__dirname, `..${file}`),
        mappingPath: path.join(__dirname, './mapping/rule_to_wcag.json'),
        criteriaPath: path.join(__dirname, './mapping/mapping.json'),
      });

      indexArr.push({ url: result.url, file });
    }

    // Generierung einer Index-HTML-Datei mit allen Links zu den Einzelberichten
    const idxFile = '/reports/output/index.html';
    const rows = indexArr
      .map(
        (e) =>
          `<li><a href="${e.file}" target="_blank" rel="noopener">${e.url}</a></li>`
      )
      .join('');

    await fs.outputFile(
      path.resolve(__dirname, `..${idxFile}`),
      `<!DOCTYPE html><meta charset="utf-8"><h1>Accessibility-Reports</h1><ul>${rows}</ul>`
    );

    emit(100, 'Fertig 🎉');
    res.json({ success: true, index: idxFile });
  } catch (err) {
    emit(100, '❌ Fehler: ' + err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

//Anzeige der Bericht-Startseite
app.get('/report', (req, res) =>
  res.sendFile(path.resolve(__dirname, '../reports/output/index.html'))
);

// Startet den Webserver auf Port 3000
app.listen(3000, () =>
  console.log('GUI-Server läuft unter  http://localhost:3000')
);
