// crawler/sitemapLoader.js
const xml2js = require("xml2js");

/**
 * Lädt eine sitemap.xml und extrahiert alle <loc>-URLs.
 * @param {string} sitemapUrl
 * @returns {Promise<string[]>}
 */
async function loadSitemap(sitemapUrl) {
  console.log("🕸  Lese Sitemap von:", sitemapUrl);

  // Dynamischer Import, weil node-fetch als ESM vorliegt
  const { default: fetch } = await import("node-fetch");

  // fetch-Request
  const response = await fetch(sitemapUrl);
  if (!response.ok) {
    throw new Error(
      `Fehler beim Laden der Sitemap: ${response.status} ${response.statusText}`
    );
  }
  const xml = await response.text();

  // XML parsen
  const parser = new xml2js.Parser();
  const parsed = await parser.parseStringPromise(xml);

  // URLs extrahieren
  const urls =
    parsed.urlset?.url
      .map((entry) => entry.loc?.[0])
      .filter((u) => typeof u === "string") || [];

  console.log(`✅  ${urls.length} URLs extrahiert.`);
  return urls;
}

module.exports = { loadSitemap };
