//Import von externen Modulen
const fs = require('fs-extra');
const { Cluster } = require('puppeteer-cluster');
const aChecker = require('accessibility-checker');
const axeSource = fs.readFileSync(
  require.resolve('axe-core/axe.min.js'),
  'utf8'
);

class scanner {
  constructor(maxConcurrency = 5) {
    this.maxConcurrency = maxConcurrency;
    this.cluster = null;
    this.results = []; //Zwischenspeicher für Ergebnisse
    this.totalUrls = 0; //Zahl der zu prüfenden URLs
    this.progressCallback = null;
  }

  async init() {
    this.cluster = await Cluster.launch({
      concurrency: Cluster.CONCURRENCY_PAGE,
      maxConcurrency: this.maxConcurrency,
      puppeteerOptions: {
        headless: true, //Kein sichtbares Browserfenster
        args: ['--no-sandbox'],
      },
      timeout: 60000,
    });

    await this.cluster.task(async ({ page, data: url }) => {
      if (typeof this.progressCallback === 'function' && this.totalUrls > 0) {
        //Fortschrittsanzeige
        this.progressCallback(null, `Scanne ${url} …`);
      }

      try {
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 15000 }); //Aufruf der Website bis diese vollständig geladen wurden

        await page.evaluate(axeSource);
        const axe = await page.evaluate(
          //Ausführen von Axe Core
          async () =>
            await window.axe.run({
              runOnly: {
                type: 'tag',
                values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'], //Festlegung der WCAG Krtiterien auf die Axe Core prüfen soll, 2.1 entspricht den Anforderungen der EN 301 549
              },
            })
        );

        const ibm = await aChecker.getCompliance(url, url); //Ausführen von IBM Checker

        //Speichern der Ergebnisse
        this.results.push({
          url,
          results: {
            axe: { ok: true, data: axe },
            ibm: { ok: true, data: ibm.report.results },
          },
        });
      } catch (err) {
        this.results.push({
          url,
          results: {
            axe: { ok: false, error: err.message },
            ibm: { ok: false, error: err.message },
          },
        });
      }

      //Fortschrittsanzeige
      if (typeof this.progressCallback === 'function' && this.totalUrls > 0) {
        const pct = Math.round((this.results.length / this.totalUrls) * 100);
        this.progressCallback(
          pct,
          `${url} fertig (${this.results.length}/${this.totalUrls})`
        );
      }
    });
  }

  async scanAll(urls = []) {
    this.totalUrls = urls.length;
    urls.forEach((url) => this.cluster.queue(url)); //Setzt URLs in Warteschlange
    await this.cluster.idle(); //wartet bis alle Seiten fertig sind
    return this.results;
  }

  //Beenden der Prozesse
  async shutdown() {
    await this.cluster.close();
    await aChecker.close();
  }
}

module.exports = scanner;
