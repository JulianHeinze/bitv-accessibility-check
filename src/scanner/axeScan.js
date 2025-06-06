// src/scanner/axeScan.js

const puppeteer = require("puppeteer");
const fs = require("fs-extra");

// ❶ axe-core ein einziges Mal laden
const axeSource = fs.readFileSync(
  require.resolve("axe-core/axe.min.js"),
  "utf8"
);

/**
 * Führt einen Accessibility-Scan mit axe-core für die gegebene URL durch.
 * @param {string} url - Die zu testende Seite.
 * @returns {Promise<object>} - Das Ergebnis des axe-Scans.
 */
async function runAxeScan(url) {
  console.log(`▶ Starte axe-Scan: ${url}`);

  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox"]
  });

  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "networkidle0" });

    // ❷ axe-Core in die Seite einfügen
    await page.evaluate(axeSource);

    // ❸ axe.run() ausführen
    const results = await page.evaluate(async () =>
      await window.axe.run({
        runOnly: {
          type: "tag",
          values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]
        }
      })
    );

    return results;
  } catch (error) {
    console.error(`❌ Fehler beim axe-Scan (${url}):`, error);
    return { ok: false, error: error.message };
  } finally {
    await browser.close();
  }
}

module.exports = { runAxeScan };
