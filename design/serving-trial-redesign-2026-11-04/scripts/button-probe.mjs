import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("<home>/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
for (const file of ["trial-workbench.html", "conversation-lab.html", "runtime-cockpit.html"]) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:4322/${file}?scenario=ready`, { waitUntil: "networkidle" });
  await page.locator("[data-open-queue]:visible").screenshot({ path: `<project-root>/design/serving-trial-redesign-2026-11-04/review/states/_button-${file.replace(".html", "")}.png` });
  await context.close();
}
await browser.close();
