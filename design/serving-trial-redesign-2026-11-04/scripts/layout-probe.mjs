import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("<home>/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, "review/states");
await mkdir(output, { recursive: true });

const browser = await chromium.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
  args: ["--disable-gpu", "--no-first-run", "--no-default-browser-check", "--disable-extensions"],
});

const files = ["trial-workbench.html", "conversation-lab.html", "runtime-cockpit.html"];
const scenarios = ["ready", "empty", "loading", "waiting", "preparing", "blocked", "stopping", "stopped", "create", "streaming"];
const sizes = [[1440, 1000], [1024, 900], [768, 900], [390, 844]];
const errors = [];

for (const [width, height] of sizes) {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 1,
    locale: "zh-CN",
    colorScheme: width === 390 ? "light" : "light",
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  page.on("console", (message) => {
    if (message.type() === "error") errors.push({ width, url: page.url(), console: message.text() });
  });
  page.on("pageerror", (error) => errors.push({ width, url: page.url(), pageerror: error.message }));

  for (const file of files) {
    for (const scenario of scenarios) {
      const url = `http://127.0.0.1:4322/${file}?scenario=${scenario}`;
      await page.goto(url, { waitUntil: "networkidle" });
      await page.waitForTimeout(scenario === "streaming" ? 320 : 80);
      const metrics = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        h1Count: document.querySelectorAll("h1").length,
        visibleViews: [...document.querySelectorAll("[data-view]")].filter((node) => !node.hidden).map((node) => node.dataset.view),
        bodyHeight: document.body.scrollHeight,
        viewportHeight: document.documentElement.clientHeight,
      }));
      console.log(JSON.stringify({ file, scenario, width, ...metrics }));
    }
  }
  await context.close();
}

{
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 1,
    locale: "zh-CN",
    colorScheme: "light",
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  for (const file of files) {
    await page.goto(`http://127.0.0.1:4322/${file}?scenario=ready`, { waitUntil: "networkidle" });
    await page.evaluate(() => {
      const dock = document.querySelector(".state-dock");
      if (dock) dock.style.display = "none";
    });
    await page.screenshot({ path: path.join(output, `_probe-${file.replace(".html", "")}-1440.png`), animations: "disabled" });
  }
  await context.close();
}

await browser.close();
console.log(JSON.stringify({ errors }, null, 2));
if (errors.length) process.exitCode = 1;
