//Import von externen Modulen
const fs = require('fs-extra');
const path = require('path');
const Handlebars = require('handlebars');

// Importiert Funktionen zur Ergebnisverarbeitung und Mapping aus mappingEngine
const {
  normalizeRuleMap,
  extractRecords,
  buildWcagChecklist,
} = require('../mapping/mappingEngine'); // Pfad ggf. anpassen

Handlebars.registerHelper('statusClass', (s) =>
  s.startsWith('✓') ? 'pass' : s.startsWith('✗') ? 'fail' : 'manual'
);

Handlebars.registerHelper('or', function () {
  return Array.prototype.slice.call(arguments, 0, -1).some(Boolean);
});

Handlebars.registerHelper('group-by', function (field, list) {
  const groups = new Map();
  (list || []).forEach((item) => {
    const k = item[field] || '';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(item);
  });
  return Array.from(groups.values());
});

Handlebars.registerHelper('add', (...args) => {
  const opts = args.pop();
  return args.reduce((sum, v) => sum + (v == null ? 0 : +v), 0);
});

function buildPage(item, ruleMap, scMeta, orderSource) {
  const recs = extractRecords(item);
  return {
    url: item.url,
    wcag: buildWcagChecklist(recs, ruleMap, scMeta, orderSource, {
      preserveOrder: true,
    }),
  };
}

async function generateReport(
  results,
  { templatePath, outputPath, mappingPath, criteriaPath }
) {
  if (!criteriaPath) {
    criteriaPath = path.join(
      path.dirname(mappingPath || templatePath),
      'mapping.json'
    );
  }

  // Lade das Template für den Bericht und die Mapping Datei
  const [tplSrc, mappingRaw] = await Promise.all([
    fs.readFile(templatePath, 'utf8'),
    fs.readJson(mappingPath),
  ]);

  // Mapping json Datei laden
  let scMeta = {};
  try {
    const criteriaRaw = await fs.readJson(criteriaPath);
    criteriaRaw.forEach((c) => {
      const k1 = c.wcag_id ? String(c.wcag_id) : null;
      const k2 = c.en_id ? String(c.en_id) : null;
      if (k1) scMeta[k1] = c;
      if (k2) scMeta[k2] = c;
    });
  } catch (e) {
    console.warn('Konnte Kriterien nicht laden:', e.message);
  }

  const ruleMap = normalizeRuleMap(mappingRaw);
  const tpl = Handlebars.compile(tplSrc);

  //Aufbereitung der Ergebnisse pro Seite
  const pages = results.map((item) => {
    const ok = item.results?.axe?.ok || item.results?.ibm?.ok;
    if (!ok) {
      const err =
        item.results?.axe?.error || item.results?.ibm?.error || 'Fehler';
      return { url: item.url, error: err };
    }
    return buildPage(item, ruleMap, scMeta, mappingRaw);
  });

  // Schreibe den generierten HTML-Bericht
  await fs.outputFile(
    outputPath,
    tpl({ pages, generated: new Date().toLocaleString('de-DE') }),
    'utf8'
  );
}

module.exports = { generateReport };
