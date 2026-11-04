import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("<home>/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const base = "http://127.0.0.1:4322";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const showcase = path.join(root, "review/showcase");
const states = path.join(root, "review/states");
await mkdir(showcase, { recursive: true });
await mkdir(states, { recursive: true });

const browser = await chromium.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
  args: ["--disable-gpu", "--no-first-run", "--no-default-browser-check", "--disable-extensions"],
});
const errors = [];

async function contextAt(width, height) {
  return browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 1,
    locale: "zh-CN",
    colorScheme: "light",
    reducedMotion: "reduce",
  });
}

async function prepare(page, file, scenario) {
  await page.goto(`${base}/${file}?scenario=${scenario}`, { waitUntil: "networkidle" });
  await page.evaluate(() => {
    const dock = document.querySelector(".state-dock");
    if (dock) dock.style.display = "none";
  });
  await page.waitForTimeout(scenario === "streaming" ? 480 : 140);
}

async function shot(page, directory, name, fullPage = false) {
  await page.screenshot({ path: path.join(directory, name), animations: "disabled", fullPage });
}

{
  const context = await contextAt(1440, 1000);
  const page = await context.newPage();
  page.on("console", (message) => {
    if (message.type() === "error") errors.push({ url: page.url(), console: message.text() });
  });
  page.on("pageerror", (error) => errors.push({ url: page.url(), pageerror: error.message }));
  for (const scenario of ["empty", "loading", "waiting", "preparing", "ready", "streaming", "blocked", "stopping", "stopped"]) {
    await prepare(page, "trial-workbench.html", scenario);
    await shot(page, states, `f1-${scenario}-1440.png`);
  }
  await prepare(page, "trial-workbench.html", "ready");
  await shot(page, showcase, "f1-workbench-ready-1440.png");
  await prepare(page, "trial-workbench.html", "streaming");
  await shot(page, showcase, "f1-workbench-streaming-1440.png");
  await prepare(page, "trial-workbench.html", "create");
  await page.locator('input[name="adapter-choice"][value="best-a7"]').check();
  await shot(page, showcase, "f1-workbench-create-1440.png");
  await prepare(page, "trial-workbench.html", "waiting");
  await shot(page, showcase, "f1-workbench-waiting-1440.png");
  await prepare(page, "trial-workbench.html", "blocked");
  await shot(page, showcase, "f1-workbench-blocked-1440.png");
  await context.close();
}

{
  const context = await contextAt(390, 844);
  const page = await context.newPage();
  await prepare(page, "trial-workbench.html", "ready");
  await shot(page, showcase, "f1-workbench-mobile-ready-390.png");
  await prepare(page, "trial-workbench.html", "waiting");
  await shot(page, showcase, "f1-workbench-mobile-waiting-390.png", true);
  await prepare(page, "trial-workbench.html", "blocked");
  await shot(page, showcase, "f1-workbench-mobile-blocked-390.png", true);
  await context.close();
}

{
  const context = await contextAt(1440, 1000);
  const page = await context.newPage();
  for (const scenario of ["empty", "loading", "waiting", "preparing", "ready", "streaming", "blocked", "stopping", "stopped"]) {
    await prepare(page, "conversation-lab.html", scenario);
    await shot(page, states, `f2-${scenario}-1440.png`);
  }
  await prepare(page, "conversation-lab.html", "ready");
  await shot(page, showcase, "f2-lab-ready-1440.png");
  await prepare(page, "conversation-lab.html", "streaming");
  await shot(page, showcase, "f2-lab-streaming-1440.png");
  await prepare(page, "conversation-lab.html", "create");
  await page.locator('input[name="adapter-choice"][value="best-a7"]').check();
  await shot(page, showcase, "f2-lab-create-1440.png");
  await prepare(page, "conversation-lab.html", "waiting");
  await shot(page, showcase, "f2-lab-waiting-1440.png");
  await prepare(page, "conversation-lab.html", "blocked");
  await shot(page, showcase, "f2-lab-blocked-1440.png");
  await context.close();
}

{
  const context = await contextAt(390, 844);
  const page = await context.newPage();
  await prepare(page, "conversation-lab.html", "ready");
  await shot(page, showcase, "f2-lab-mobile-ready-390.png");
  await prepare(page, "conversation-lab.html", "streaming");
  await shot(page, showcase, "f2-lab-mobile-streaming-390.png");
  await prepare(page, "conversation-lab.html", "blocked");
  await shot(page, showcase, "f2-lab-mobile-blocked-390.png", true);
  await context.close();
}

{
  const context = await contextAt(1440, 1000);
  const page = await context.newPage();
  for (const scenario of ["empty", "loading", "waiting", "preparing", "ready", "streaming", "blocked", "stopping", "stopped"]) {
    await prepare(page, "runtime-cockpit.html", scenario);
    await shot(page, states, `f3-${scenario}-1440.png`);
  }
  await prepare(page, "runtime-cockpit.html", "ready");
  await shot(page, showcase, "f3-cockpit-ready-1440.png");
  await prepare(page, "runtime-cockpit.html", "streaming");
  await shot(page, showcase, "f3-cockpit-streaming-1440.png");
  await prepare(page, "runtime-cockpit.html", "create");
  await page.locator('input[name="adapter-choice"][value="best-a7"]').check();
  await shot(page, showcase, "f3-cockpit-create-1440.png");
  await prepare(page, "runtime-cockpit.html", "waiting");
  await shot(page, showcase, "f3-cockpit-waiting-1440.png");
  await prepare(page, "runtime-cockpit.html", "blocked");
  await shot(page, showcase, "f3-cockpit-blocked-1440.png");
  await context.close();
}

{
  const context = await contextAt(390, 844);
  const page = await context.newPage();
  await prepare(page, "runtime-cockpit.html", "ready");
  await shot(page, showcase, "f3-cockpit-mobile-ready-390.png");
  await prepare(page, "runtime-cockpit.html", "streaming");
  await shot(page, showcase, "f3-cockpit-mobile-streaming-390.png");
  await prepare(page, "runtime-cockpit.html", "blocked");
  await shot(page, showcase, "f3-cockpit-mobile-blocked-390.png", true);
  await context.close();
}

for (const [width, height, suffix] of [[1440, 1000, "1440"], [390, 844, "390"]]) {
  const context = await contextAt(width, height);
  const page = await context.newPage();
  page.on("console", (message) => {
    if (message.type() === "error") errors.push({ url: page.url(), console: message.text() });
  });
  page.on("pageerror", (error) => errors.push({ url: page.url(), pageerror: error.message }));
  await page.goto(`${base}/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(180);
  await shot(page, showcase, `00-review-index-${suffix}.png`);
  await shot(page, showcase, `00-review-index-${suffix}-full.png`, true);
  await context.close();
}

await browser.close();
console.log(JSON.stringify({ showcase, states, errors }, null, 2));
if (errors.length) process.exitCode = 1;
