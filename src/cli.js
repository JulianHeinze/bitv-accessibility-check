#!/usr/bin/env node
// -----------------------------------------------------------------------------
// Kommandozeilen-Interface für den Accessibility-Crawler (mit ClusterScanEngine)
// -----------------------------------------------------------------------------

const path   = require("path");
const fs     = require("fs-extra");
const yargs  = require("yargs");
const { hideBin } = require("yargs/helpers");

const { loadSitemap }    = require("./crawler/sitemapLoader");
const scanner  = require("./scanner/clusterScanEngine");
const { generateReport } = require("./report/reportGenerator");
const { concurrency: defaultConcurrency } = require("./config/settings");

async function main() {
  const argv = yargs(hideBin(process.argv))
    .usage("Usage: $0 --url <URL> [opts]  |  $0 --sitemap <URL>")
    .option("url",        { alias: "u", type: "string", describe: "Single URL to scan" })
    .option("sitemap",    { alias: "s", type: "string", describe: "URL of sitemap.xml" })

    .option("output",     { alias: "o", type: "string",
                            default: "./data/resultsraw.json",
                            describe: "Output path for raw JSON" })
    .option("report",     { alias: "r", type: "string",
                            default: "./reports/output/output.html",
                            describe: "HTML report path" })
    .option("template",   { alias: "t", type: "string",
                            default: "./reports/templates/bitv-report-template.html",
                            describe: "Handlebars template" })

    .option("mapping",    { alias: "m", type: "string",
                            default: path.join(__dirname, "mapping", "rule_to_wcag.json"),
                            describe: "Rule→WCAG mapping JSON" })
    .option("criteria",   { alias: "k", type: "string",
                            default: path.join(__dirname, "mapping", "mapping.json"),
                            describe: "WCAG criteria metadata JSON" })

    .option("concurrency",{ alias: "c", type: "number",
                            default: defaultConcurrency,
                            describe: "Parallel browser instances" })

    .check((a) => {
      if (!a.url && !a.sitemap) throw new Error("Bitte --url oder --sitemap angeben.");
      return true;
    })
    .help("h").alias("h", "help").argv;

  /* ---------- URLs sammeln ---------- */
  const urls = argv.url ? [argv.url] : await loadSitemap(argv.sitemap);
  console.log(`🔍  Scanne ${urls.length} URLs (parallel: ${argv.concurrency})`);

  /* ---------- Scans ausführen (neu mit puppeteer-cluster) ---------- */
  const engine = new scanner(argv.concurrency);
  await engine.init();

  await engine.scanAll(urls);
  const results = engine.results;

  await engine.shutdown();

  /* ---------- Ergebnisse speichern ---------- */
  await fs.outputJson(argv.output, results, { spaces: 2 });
  console.log(`✔  Rohdaten gespeichert: ${argv.output}`);

  /* ---------- Report generieren ---------- */
  console.log("📄  Erzeuge HTML-Report …");
  await generateReport(results, {
    templatePath: path.resolve(argv.template),
    outputPath:   path.resolve(argv.report),
    mappingPath:  path.resolve(argv.mapping),
    criteriaPath: path.resolve(argv.criteria),
  });
  console.log(`✔  Report gespeichert: ${argv.report}`);
}

main().catch((err) => {
  console.error("🛑  Unerwarteter Fehler:", err);
  process.exit(1);
});
