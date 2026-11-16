// node _tools/demo.mjs → ../video/bcio-ca.mp4: kartu intro + rekaman layar asli bcio.trade + kartu penutup (CA).
// Direkam: landing (hero, lalu tiap bagian), lalu terminal: satu pertanyaan ke agent dan jawabannya yang di-stream.
// Butuh _parts/caintro.mp4 dan _parts/caoutro.mp4 (node _tools/render.mjs caintro _parts/caintro.mp4, sama untuk caoutro).
import { chromium } from "/Users/sergiodyegogmail.com/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs";
import { execFileSync } from "node:child_process"; import fs from "node:fs"; import path from "node:path";
const root = path.join(path.dirname(new URL(import.meta.url).pathname), ".."), TMP = path.join(root, "_tools/.demo"), SITE = "https://bcio.trade";
const Q = process.env.Q || "Does BTC follow NVDA? Find the lag.";
fs.rmSync(TMP, { recursive: true, force: true });
const b = await chromium.launch({ args: ["--enable-gpu", "--ignore-gpu-blocklist", "--use-angle=metal"] });
const ctx = await b.newContext({ viewport: { width: 1600, height: 900 }, recordVideo: { dir: TMP, size: { width: 1600, height: 900 } } });
const p = await ctx.newPage(); const W = (ms) => p.waitForTimeout(ms);
const glide = async (to, ms = 2600) => { await p.evaluate(([y, d]) => new Promise((r) => { document.documentElement.style.scrollBehavior = "auto"; const y0 = scrollY, t0 = performance.now(); const f = (n) => { const k = Math.min(1, (n - t0) / d), e = k < .5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; scrollTo(0, y0 + (y - y0) * e); k < 1 ? requestAnimationFrame(f) : r(); }; requestAnimationFrame(f); }), [to, ms]); };
const yOf = (sel) => p.evaluate((s) => document.querySelector(s).getBoundingClientRect().top + scrollY, sel);
await p.goto(SITE + "/", { waitUntil: "load" }); await W(5000);            // tunggu koin 3D dimuat (bagian ini dipotong)
const READY = Date.now(); await W(4000);
for (const s of ["#show", "#sync", "#always", "#agent", "#grow"]) { await glide(await yOf(s), 2000); await W(2600); }
await p.goto(SITE + "/terminal", { waitUntil: "networkidle" }); await W(2500);
await p.click("#q"); await p.keyboard.type(Q, { delay: 55 }); await W(500); await p.keyboard.press("Enter");
await W(1500); await p.waitForFunction(() => !document.querySelector(".send").disabled, null, { timeout: 180000 }); await W(3500);
const SPAN = (Date.now() - READY) / 1000; await p.close(); await ctx.close(); await b.close();
const raw = path.join(TMP, fs.readdirSync(TMP).find((f) => f.endsWith(".webm"))), rec = path.join(TMP, "cut.mp4");
const dur = (f) => Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]).toString());
const CUT = Math.max(0, dur(raw) - SPAN - 0.2);
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-ss", String(CUT), "-i", raw, "-c:v", "libx264", "-preset", "fast", "-crf", "16", rec]);
const parts = path.join(root, "_parts"), out = path.join(root, "..", "video/bcio-ca.mp4");
const total = dur(path.join(parts, "caintro.mp4")) + dur(rec) + dur(path.join(parts, "caoutro.mp4"));
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", path.join(parts, "caintro.mp4"), "-i", rec, "-i", path.join(parts, "caoutro.mp4"),
  "-f", "lavfi", "-i", `anoisesrc=color=brown:amplitude=0.05:d=${total}`,
  "-filter_complex", `[0:v]fps=30,scale=1920:1080,setsar=1[a];[1:v]fps=30,scale=1920:1080:flags=lanczos,setsar=1,fade=t=in:d=0.4[b];[2:v]fps=30,scale=1920:1080,setsar=1[c];[a][b][c]concat=n=3:v=1:a=0,format=yuv420p[v];[3]lowpass=f=380,volume=0.9,afade=t=in:d=1.2,afade=t=out:st=${total - 1.5}:d=1.5[au]`,
  "-map", "[v]", "-map", "[au]", "-c:v", "libx264", "-preset", "slow", "-crf", "19", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", "-shortest", out]);
fs.rmSync(TMP, { recursive: true, force: true });
console.log(path.relative(root, out), (fs.statSync(out).size / 1e6).toFixed(1) + " MB", total.toFixed(1) + "s");
