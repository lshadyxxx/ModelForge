import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("<home>/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pages = [
  ["index.html", ""],
  ["trial-workbench.html", "?scenario=ready"],
  ["conversation-lab.html", "?scenario=ready"],
  ["runtime-cockpit.html", "?scenario=ready"],
];
const errors = [];
const results = [];

const browser = await chromium.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
  args: ["--disable-gpu", "--no-first-run", "--no-default-browser-check", "--disable-extensions"],
});

for (const [width, height] of [[1440, 1000], [390, 844]]) {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 1,
    locale: "zh-CN",
    colorScheme: "light",
    reducedMotion: "reduce",
  });
  for (const [file, query] of pages) {
    const page = await context.newPage();
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(`${width}px ${file} console: ${message.text()}`);
    });
    page.on("pageerror", (error) => errors.push(`${width}px ${file} pageerror: ${error.message}`));
    const url = `${pathToFileURL(path.join(root, file)).href}${query}`;
    await page.goto(url, { waitUntil: "load" });
    await page.waitForTimeout(180);
    const metrics = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      h1Count: document.querySelectorAll("h1").length,
    }));
    assert.equal(metrics.scrollWidth, metrics.clientWidth, `${file} @${width}px overflows horizontally`);
    assert.equal(metrics.h1Count, 1, `${file} @${width}px must contain exactly one H1`);
    results.push({ file, width, ok: true });
    await page.close();
  }
  await context.close();
}

await browser.close();
assert.deepEqual(errors, []);
console.log(JSON.stringify({ results, errors }, null, 2));
