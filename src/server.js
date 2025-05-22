const express = require("express");
const path    = require("path");
const { runAxeScan } = require("./scanner/axeScan");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.post("/api/scan", async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: "Keine URL angegeben." });
  try {
    const result = await runAxeScan(url);
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Optional: HTML-Report live ansehen
app.get("/report", (req, res) => {
  res.sendFile(path.join(__dirname, "../reports/output.html"));
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`GUI-Server läuft unter http://localhost:${PORT}`);
});
