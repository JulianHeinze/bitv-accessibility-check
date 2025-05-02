// check-url.js
const { runAxeScan } = require("./scanner/axeScan");

const url = process.argv[2];

if (!url) {
  console.error("❌  Bitte gib eine URL an, z. B.:  node check-url.js https://www.musterstadt.de");
  process.exit(1);
}

runAxeScan(url)
  .then(() => {
    console.log("🏁  Scan abgeschlossen.");
  })
  .catch(err => {
    console.error("🚨  Fehler beim Scan:", err);
    process.exit(1);
  });
