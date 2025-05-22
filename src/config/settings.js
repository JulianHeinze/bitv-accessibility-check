// config/settings.js

module.exports = {
    // Standard-Anzahl paralleler Puppeteer-Instanzen
    concurrency: 3,
  
    // Schweregrade und Maximalwerte für Fail-on-Violations
    thresholds: {
      critical: 0,   // soforter Fehler, wenn ≥1
      serious: 5,    // Fehler, wenn ≥5
      moderate: 10,  // Warnung, wenn ≥10
    }
  };
  