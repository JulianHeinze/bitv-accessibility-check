const xml2js = require('xml2js'); //Import von externen Modul

async function loadSitemap(sitemapUrl, depth = 0) {
  console.log('🕸  Lese Sitemap:', sitemapUrl);

  const { default: fetch } = await import('node-fetch');
  const res = await fetch(sitemapUrl);
  if (!res.ok) throw new Error(`Fehler ${res.status} beim Laden der Sitemap`);

  const xml = await res.text();
  const parsed = await new xml2js.Parser().parseStringPromise(xml);

  if (parsed.urlset && Array.isArray(parsed.urlset.url)) {
    const urls = parsed.urlset.url
      .map((u) => u.loc?.[0])
      .filter((u) => typeof u === 'string');
    console.log(`${urls.length} URLs extrahiert.`);
    return urls;
  }

  if (parsed.sitemapindex && Array.isArray(parsed.sitemapindex.sitemap)) {
    const childSitemaps = parsed.sitemapindex.sitemap
      .map((s) => s.loc?.[0])
      .filter((u) => typeof u === 'string');

    let all = [];
    for (const sm of childSitemaps) {
      try {
        const urls = await loadSitemap(sm, depth + 1);
        all = all.concat(urls);
      } catch (e) {
        console.warn('⚠️  Unter-Sitemap übersprungen:', sm, e.message);
      }
    }
    console.log(`✅  Insgesamt ${all.length} URLs aus Index extrahiert.`);
    return Array.from(new Set(all));
  }

  throw new Error('Unbekanntes XML-Format der Sitemap');
}

async function robotsSm(url) {
  //Dient dazu die Sitemap aus der robots.txt zu extrahieren
  const host = url.replace(/(^https?:\/\/[^\/]+).*/, '$1');
  const robotsUrl = host + '/robots.txt';
  try {
    const { default: fetch } = await import('node-fetch');
    const txt = await (await fetch(robotsUrl)).text();
    const line = txt
      .split(/\r?\n/)
      .find((l) => l.toLowerCase().startsWith('sitemap:'));
    return line ? line.replace(/sitemap:\s*/i, '').trim() : null;
  } catch {
    return null;
  }
}

//Lädt die Sitemap
async function findSitemap(startUrl) {
  const tryLoad = async (url) => {
    try {
      return await loadSitemap(url);
    } catch {
      return null;
    }
  };

  const urlsFromDirect = await tryLoad(startUrl); //Falls URL direkt auf die Sitemap zeigt
  if (urlsFromDirect?.length) return urlsFromDirect;

  const guessed = startUrl.replace(/\/$/, '') + '/sitemap.xml'; //Fügt der URL den Anhang hinzu, um auf die Sitemap der Webseite zu kommen
  const urlsFromGuess = await tryLoad(guessed);
  if (urlsFromGuess?.length) return urlsFromGuess;

  const robotsUrl = await robotsSm(startUrl); //Durchsucht robots.txt nach der Sitemap
  if (robotsUrl) {
    const urlsFromRobots = await tryLoad(robotsUrl);
    if (urlsFromRobots?.length) return urlsFromRobots;
  }

  return [];
}

module.exports = { loadSitemap, robotsSm, findSitemap };
