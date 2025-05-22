// reports/reportGenerator.js

const fs = require("fs-extra");
const Handlebars = require("handlebars");
// Lade eigenes Mapping mit wcag_id und name_de
const wcagMapping = require("../mapping/mapping.json");

// Helper für Vergleiche in Templates
Handlebars.registerHelper('eq', (a, b) => a === b);

/**
 * Extrahiert WCAG-Codes aus Axe-Ergebnissen
 * @param {Array} results – Axe-Result-Items (passes, violations, incomplete)
 * @returns {string[]} Array von SC-IDs (z.B. "1.4.3")
 */
function extractTags(results = []) {
  return results
    .flatMap(item => item.tags || [])
    .filter(tag => /^wcag2[01][a-z]*-[0-9]+(\.[0-9]+)?$/.test(tag))
    .map(tag => {
      const match = tag.match(/wcag2[01][a-z]*-([0-9]+\.[0-9]+(\.[0-9]+)?)/);
      return match ? match[1] : null;
    })
    .filter(Boolean);
}

/**
 * Generiert aus den Scan-Ergebnissen einen HTML-Report mit WCAG-Status
 * @param {Array} results  – Array von { url, result, error }
 * @param {Object} options – { templatePath, outputPath, thresholds }
 */
async function generateReport(results, { templatePath, outputPath, thresholds }) {
  const templateSrc = await fs.readFile(templatePath, "utf8");
  const template = Handlebars.compile(templateSrc);

  const data = results.map(({ url, result, error }) => {
    const passes = result?.passes || [];
    const violations = result?.violations || [];
    const incomplete = result?.incomplete || [];

    const passedSC = new Set(extractTags(passes));
    const violationSC = new Set(extractTags(violations));
    const incompleteSC = new Set(extractTags(incomplete));

    // WCAG-Liste mit Status
    const wcag = wcagMapping.map(sc => {
      const id = sc.wcag_id;           // nutze wcag_id aus mapping.json
      const name = sc.name_de;         // nutze deutsche Bezeichnung
      let status;
      if (violationSC.has(id)) status = '✗ nicht erfüllt';
      else if (passedSC.has(id)) status = '✓ erfüllt';
      else if (incompleteSC.has(id)) status = '🔶 manuelle Prüfung (teilweise getestet)';
      else status = '🔶 manuelle Prüfung erforderlich';
      return { id, name, status };
    });

    return {
      url,
      error,
      violations: result?.violations || [],
      summary: result
        ? {
            critical: violations.filter(v => v.impact === "critical").length,
            serious: violations.filter(v => v.impact === "serious").length,
            moderate: violations.filter(v => v.impact === "moderate").length,
          }
        : null,
      wcag
    };
  });

  const html = template({ pages: data, thresholds });
  await fs.outputFile(outputPath, html);
}

module.exports = { generateReport };
