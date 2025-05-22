#!/usr/bin/env node

// src/cli.js

const path = require("path");
const fs = require("fs-extra");
const yargs = require("yargs");
const { hideBin } = require("yargs/helpers");

const { loadSitemap } = require("./crawler/sitemapLoader");
const { runAxeScan } = require("./scanner/axeScan");
const { generateReport } = require("./report/reportGenerator");
const { thresholds, concurrency: defaultConcurrency } = require("./config/settings");

async function main() {
  const argv = yargs(hideBin(process.argv))
    .usage("Usage: $0 scan [options]")
    .option("u", {
      alias: "url",
      type: "string",
      describe: "Single URL to scan",
    })
    .option("s", {
      alias: "sitemap",
      type: "string",
      describe: "URL of sitemap.xml to load multiple URLs",
    })
    .option("o", {
      alias: "output",
      type: "string",
      default: "./data/results.json",
      describe: "Output path for raw JSON results",
    })
    .option("r", {
      alias: "report",
      type: "string",
      default: "./reports/output/output.html",
      describe: "Path for the generated HTML report",
    })
    .option("c", {
      alias: "concurrency",
      type: "number",
      default: defaultConcurrency,
      describe: "Number of parallel Puppeteer instances",
    })
    .help()
    .alias("help", "h")
    .argv;

  // URLs sammeln
  let urls = [];
  if (argv.url) {
    urls.push(argv.url);
  } else if (argv.sitemap) {
    console.log(`🕸  Lade Sitemap: ${argv.sitemap}`);
    urls = await loadSitemap(argv.sitemap);
  } else {
    console.error("⚠️  Bitte mindestens --url oder --sitemap angeben.");
    process.exit(1);
  }

  console.log(`🔍  Scanne ${urls.length} URLs (parallel: ${argv.concurrency})`);

  // Batch-Scan mit Concurrency-Limit
  const results = [];
  const limit = argv.concurrency;
  for (let i = 0; i < urls.length; i += limit) {
    const batch = urls.slice(i, i + limit);
    const batchResults = await Promise.all(
      batch.map(async (u) => {
        try {
          const res = await runAxeScan(u);
          return { url: u, result: res };
        } catch (err) {
          console.error(`❌ Fehler beim Scannen von ${u}:`, err.message);
          return { url: u, error: err.message };
        }
      })
    );
    results.push(...batchResults);
  }

  // Rohdaten speichern
  await fs.outputJson(argv.output, results, { spaces: 2 });
  console.log(`✔  Rohdaten gespeichert: ${argv.output}`);

  // HTML-Report erzeugen
  console.log("📄  Erzeuge HTML-Report …");
  await generateReport(results, {
    templatePath: path.join(__dirname, "../reports/templates/bitv-report-template.html"),
    outputPath: argv.report,
    thresholds,
  });
  console.log(`✔  Report gespeichert: ${argv.report}`);
}

main().catch((err) => {
  console.error("🛑 Unerwarteter Fehler:", err);
  process.exit(1);
});
