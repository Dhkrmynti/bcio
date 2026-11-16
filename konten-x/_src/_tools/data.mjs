// Data asli untuk post dan video: dibaca live dari bcio.trade (harga, matriks, status pasar) dan dari mesin korelasi
// engine BCIO (pasangan lag, weekend shield). Tidak ada angka contoh. Hasil disimpan ke _tools/.snapshot.json
// supaya semua render memakai angka dari momen yang sama (pakai FRESH=1 untuk mengambil ulang).
import fs from "node:fs"; import path from "node:path";
const root = path.join(path.dirname(new URL(import.meta.url).pathname), "..");
const SITE = process.env.BCIO || "https://bcio.trade", SNAP = path.join(root, "_tools/.snapshot.json");
const j = async (p) => { for (let i = 0; ; i++) { try { const r = await fetch(SITE + p, { headers: { "user-agent": "bcio-kit" }, signal: AbortSignal.timeout(30000) }); return await r.json(); } catch (e) { if (i >= 4) throw e; await new Promise((w) => setTimeout(w, 3000 * (i + 1))); } } };
export async function loadData() {
  const token = JSON.parse(fs.readFileSync(path.join(root, "token.json"), "utf8"));
  const hf = fs.existsSync(path.join(root, "_hf")) ? fs.readdirSync(path.join(root, "_hf")) : [];
  const coin = fs.existsSync(path.join(root, "_assets/spin")) ? fs.readdirSync(path.join(root, "_assets/spin")).filter((f) => f.endsWith(".webp")).length : 0;
  const burns = await j("/api/token").catch(() => null);   // buyback & burn dari /studio, selalu live
  if (!process.env.FRESH && fs.existsSync(SNAP)) return { ...JSON.parse(fs.readFileSync(SNAP, "utf8")), token, hf, coin, burns };
  const watch = await j("/api/watchlist"), matrix = await j("/api/matrix"), chain = await j("/api/chain");
  const { runTool } = await import(path.join(root, "../../engine/src/tools.js"));
  const pairs = {};
  for (const [a, b] of [["NVDA", "BTC"], ["TSLA", "SOL"], ["NVDA", "RENDER"], ["NVDA", "TAO"], ["QQQ", "ETH"], ["BTC", "ETH"]]) pairs[`${a}-${b}`] = await runTool("correlate", { a, b, days: 14 });
  const D = { site: SITE.replace(/^https?:\/\//, ""), watch, matrix, chain, pairs, when: new Date().toUTCString().slice(5, 22) + " UTC" };
  fs.writeFileSync(SNAP, JSON.stringify(D));
  return { ...D, token, hf, coin, burns };
}
if (process.argv[1] && process.argv[1].endsWith("data.mjs")) { const d = await loadData(); console.log(Object.keys(d), d.when); console.log(JSON.stringify(d.pairs["NVDA-BTC"]).slice(0, 600));  }
