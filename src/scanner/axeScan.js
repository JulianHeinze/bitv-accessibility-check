// src/scanner/axeScan.js
const puppeteer = require("puppeteer");

// ❶  axe.min.js als String einlesen (außerhalb der Funktion nur 1-mal)
const fs        = require("fs-extra");
const axeSource = fs.readFileSync(
  require.resolve("axe-core/axe.min.js"),
  "utf8"
);

async function runAxeScan(url) {
  console.log("▶  Starte axe-Scan:", url);

  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox"]          // Windows-/CI-freundlich
  });
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: "networkidle0" });

  // ❷  axe-Source im Browser ausführen → window.axe vorhanden
  await page.evaluate(axeSource);

  // ❸  axe.run() starten
const results = await page.evaluate(async () =>
  await window.axe.run({
    runOnly: {
      type: "tag",
      values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]
    }
  })
);
  await browser.close();

  // Ergebnisse nur zurückgeben, CLI speichert sie
  return results;
}

module.exports = { runAxeScan };
