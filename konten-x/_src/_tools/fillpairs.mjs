// isi ulang pasangan korelasi yang gagal karena batas CoinGecko (jeda di antara panggilan)
import fs from "node:fs"; import path from "node:path";
const root = path.join(path.dirname(new URL(import.meta.url).pathname), ".."), SNAP = path.join(root, "_tools/.snapshot.json");
const { runTool } = await import(path.join(root, "../../engine/src/tools.js"));
const d = JSON.parse(fs.readFileSync(SNAP, "utf8"));
for (const k of Object.keys(d.pairs)) {
  for (let i = 0; i < 5 && !d.pairs[k].ok; i++) { await new Promise((r) => setTimeout(r, 30000)); const [a, b] = k.split("-"); d.pairs[k] = await runTool("correlate", { a, b, days: 14 }); }
  console.log(k, d.pairs[k].ok ? d.pairs[k].result.corr_lag0 : d.pairs[k].error);
}
fs.writeFileSync(SNAP, JSON.stringify(d));
