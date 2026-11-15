// node _tools/render.mjs <scene> [out.mp4]: render scene _v.html frame demi frame (30 fps, 1920x1080) → H.264 mp4
// untuk X dengan latar suara ambient pelan.
import { chromium } from "/Users/sergiodyegogmail.com/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs";
import { execFileSync } from "node:child_process"; import fs from "node:fs"; import path from "node:path";
import { serve } from "./serve.mjs"; import { loadData } from "./data.mjs";
const [scene, outArg] = process.argv.slice(2); const root = path.join(path.dirname(new URL(import.meta.url).pathname), "..");
const out = outArg ? path.resolve(root, outArg) : path.join(root, "..", "video", `bcio-${scene}.mp4`); fs.mkdirSync(path.dirname(out), { recursive: true });
const FPS = 30, TMP = path.join(root, "_tools", `.f-${scene}`); fs.rmSync(TMP, { recursive: true, force: true }); fs.mkdirSync(TMP);
const DATA = await loadData(); const port = 4700 + Math.floor(Math.random() * 400); const srv = await serve(root, port);
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
await p.addInitScript((d) => { window.DATA = d; }, DATA);
await p.goto(`http://127.0.0.1:${port}/_v.html?s=${scene}`); await p.waitForFunction(() => window.READY === true, { timeout: 300000 });
const dur = await p.evaluate(() => window.DUR), n = Math.round(dur * FPS);
for (let i = 0; i < n; i++) { await p.evaluate((t) => window.seek(t), i / FPS); await p.screenshot({ path: path.join(TMP, `f${String(i).padStart(5, "0")}.jpg`), type: "jpeg", quality: 92 }); }
await b.close(); srv.close();
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", String(FPS), "-i", path.join(TMP, "f%05d.jpg"),
  "-f", "lavfi", "-i", `anoisesrc=color=brown:amplitude=0.05:d=${dur}`, "-f", "lavfi", "-i", `sine=f=55:d=${dur}`,
  "-filter_complex", `[1]lowpass=f=380,volume=0.9[n];[2]volume=0.05[s];[n][s]amix=inputs=2:normalize=0,afade=t=in:d=1.2,afade=t=out:st=${dur - 1.5}:d=1.5[a];[0]format=yuv420p,fade=t=in:d=0.4,fade=t=out:st=${dur - 0.6}:d=0.6[v]`,
  "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", "-shortest", out]);
fs.rmSync(TMP, { recursive: true, force: true });
console.log(path.relative(root, out), (fs.statSync(out).size / 1e6).toFixed(1) + " MB", dur + "s");
