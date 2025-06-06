// crawler/sitemapLoader.js
const xml2js = require("xml2js");

/**
 * Liest eine Sitemap oder Sitemap-Index, holt ggf. alle verlinkten
 * Untersitemaps und gibt eine eindeutige URL-Liste zurück.
 *
 * @param {string} sitemapUrl  URL der (Haupt-)Sitemap
 * @param {number} [depth=0]   Rekursionstiefe (intern)
 * @returns {Promise<string[]>}
 */
async function loadSitemap(sitemapUrl, depth = 0) {
  console.log("🕸  Lese Sitemap:", sitemapUrl);

  if (depth > 2) {                         // Sicherheits-Limiter
    console.warn("⚠️  Sitemap-Tiefe >2 abgebrochen:", sitemapUrl);
    return [];
  }

  const { default: fetch } = await import("node-fetch");
  const res = await fetch(sitemapUrl);
  if (!res.ok) throw new Error(`Fehler ${res.status} beim Laden der Sitemap`);

  const xml = await res.text();
  const parsed = await new xml2js.Parser().parseStringPromise(xml);

  /* 1) Normale <urlset> */
  if (parsed.urlset && Array.isArray(parsed.urlset.url)) {
    const urls = parsed.urlset.url
      .map((u) => u.loc?.[0])
      .filter((u) => typeof u === "string");
    console.log(`✅  ${urls.length} URLs extrahiert.`);
    return urls;
  }

  /* 2) <sitemapindex> – Unter-Sitemaps rekursiv einlesen */
  if (parsed.sitemapindex && Array.isArray(parsed.sitemapindex.sitemap)) {
    const childSitemaps = parsed.sitemapindex.sitemap
      .map((s) => s.loc?.[0])
      .filter((u) => typeof u === "string");

    let all = [];
    for (const sm of childSitemaps) {
      try {
        const urls = await loadSitemap(sm, depth + 1);
        all = all.concat(urls);
      } catch (e) {
        console.warn("⚠️  Unter-Sitemap übersprungen:", sm, e.message);
      }
    }
    console.log(`✅  Insgesamt ${all.length} URLs aus Index extrahiert.`);
    /* doppelte raus */
    return Array.from(new Set(all));
  }

  throw new Error("Unbekanntes XML-Format der Sitemap");
}

module.exports = { loadSitemap };
