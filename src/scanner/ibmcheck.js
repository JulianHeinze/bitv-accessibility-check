// src/scanner/ibmcheck.js

// Statt Checker/Reporter importieren wir das gesamte Modul
const aChecker = require("accessibility-checker");

async function runIbmScan(url) {
  // scannt die URL und liefert ein Objekt { report, puppeteer, webdriver }
  const result = await aChecker.getCompliance(url, url);
  
  // schließe Puppeteer-/Engine-Ressourcen
  await aChecker.close();

  // im report-Objekt stehen die Details unter report.results
  // Du kannst hier filtern oder direkt das Array zurückgeben:
  return result.report.results;
}

module.exports = { runIbmScan };
