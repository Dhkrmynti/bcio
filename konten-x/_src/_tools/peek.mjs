// node _tools/peek.mjs <scene> <t...>: still dari scene pada detik tertentu ke folder PEEK_OUT, untuk dicek
import { chromium } from "/Users/sergiodyegogmail.com/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs";
import path from "node:path"; import { serve } from "./serve.mjs"; import { loadData } from "./data.mjs";
const [scene, ...ts] = process.argv.slice(2), root = path.join(path.dirname(new URL(import.meta.url).pathname), ".."), out = process.env.PEEK_OUT;
const DATA = await loadData(); const port = 3300 + Math.floor(Math.random() * 300); const srv = await serve(root, port); const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
await p.addInitScript((d) => { window.DATA = d; }, DATA); await p.goto(`http://127.0.0.1:${port}/_v.html?s=${scene}`); await p.waitForFunction(() => window.READY === true, { timeout: 120000 });
for (const t of ts) { await p.evaluate((x) => window.seek(x), +t); await p.waitForTimeout(150); await p.screenshot({ path: `${out}/pk-${scene}-${t}.jpg`, type: "jpeg", quality: 60 }); }
await b.close(); srv.close();
