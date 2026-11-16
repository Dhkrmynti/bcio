// node _tools/posts.mjs [ids...]: render _p.html → ../pre (p..) dan ../post (a..), 1600x900 @2x.
// a11 mengambil screenshot terminal bcio.trade dengan satu jawaban agent; a13 memakai output asli `npx bcio-agent`.
import { chromium } from "/Users/sergiodyegogmail.com/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs";
import { execFileSync } from "node:child_process"; import fs from "node:fs"; import path from "node:path";
import { serve } from "./serve.mjs"; import { loadData } from "./data.mjs";
const root = path.join(path.dirname(new URL(import.meta.url).pathname), "..");
const DATA = await loadData();
const cliFile = path.join(root, "_assets/cli.txt");
if (!fs.existsSync(cliFile)) fs.writeFileSync(cliFile, execFileSync("node", [path.join(root, "../../../bcio-agent/bin/bcio.mjs")], { env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" } }).toString());
DATA.cli = fs.readFileSync(cliFile, "utf8").replace(/\x1b\[[0-9;]*m/g, "");
const PRE = ["wall-street-closes", "two-markets-one-read", "does-btc-follow-nvda", "one-basket-one-signature", "bcio-soon"];
const POST = ["bcio-is-live", "the-board", "btc-vs-nvda-lag", "tsla-and-sol", "correlation-matrix", "wall-street-closed", "weekend-shield", "baskets", "rebalancer", "your-limits-on-chain", "the-terminal", "bcio-in-claude", "cli", "ai-coins-vs-nvda", "two-markets", "data-not-advice", "the-desk-on-chain", "how-it-reads", "built-for-the-weekend", "links", "buyback-and-burn"];
const NAMES = {}; PRE.forEach((n, i) => (NAMES["p" + String(i + 1).padStart(2, "0")] = String(i + 1).padStart(2, "0") + "-" + n)); POST.forEach((n, i) => (NAMES["a" + String(i + 1).padStart(2, "0")] = String(i + 1).padStart(2, "0") + "-" + n));
const ids = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(NAMES);
const b = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
if (ids.includes("a11") && !fs.existsSync(path.join(root, "_assets/terminal.png"))) {
  const p = await b.newPage({ viewport: { width: 1456, height: 860 }, deviceScaleFactor: 2 });
  await p.goto(`https://${DATA.site}/terminal`, { waitUntil: "networkidle" }); await p.waitForTimeout(2500);
  await p.fill("#q", "Wall Street is closed. What is moving and which stock tokens are exposed?"); await p.keyboard.press("Enter");
  await p.waitForTimeout(1500); await p.waitForFunction(() => !document.querySelector(".send").disabled, null, { timeout: 180000 });
  await p.waitForTimeout(6000); await p.screenshot({ path: path.join(root, "_assets/terminal.png") }); await p.close();
}
const srv = await serve(root, 3222);
for (const id of ids) {
  const p = await b.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 }); await p.addInitScript((d) => { window.DATA = d; }, DATA);
  await p.goto(`http://127.0.0.1:3222/_p.html?p=${id}`); await p.waitForFunction(() => window.READY === true, { timeout: 60000 }); await p.waitForTimeout(300);
  const dir = path.join(root, "..", id.startsWith("p") ? "pre" : "post"); fs.mkdirSync(dir, { recursive: true });
  await p.screenshot({ path: path.join(dir, `${NAMES[id]}.png`) }); await p.close(); console.log(id, NAMES[id]);
}
await b.close(); srv.close();
