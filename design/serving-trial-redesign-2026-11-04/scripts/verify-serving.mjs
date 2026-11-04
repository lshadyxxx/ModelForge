import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("<home>/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const base = "http://127.0.0.1:4322";
const files = ["trial-workbench.html", "conversation-lab.html", "runtime-cockpit.html"];
const results = [];
const consoleErrors = [];

const browser = await chromium.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
  args: ["--disable-gpu", "--no-first-run", "--no-default-browser-check", "--disable-extensions"],
});

async function pageAt(width = 1440, height = 1000) {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 1,
    locale: "zh-CN",
    colorScheme: "light",
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(`${width}px ${page.url()} console: ${message.text()}`);
  });
  page.on("pageerror", (error) => consoleErrors.push(`${width}px ${page.url()} pageerror: ${error.message}`));
  return { context, page };
}

async function open(page, file, scenario = "ready") {
  await page.goto(`${base}/${file}?scenario=${scenario}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(120);
}

async function test(name, fn) {
  const started = Date.now();
  try {
    await fn();
    results.push({ name, ok: true, ms: Date.now() - started });
  } catch (error) {
    results.push({ name, ok: false, ms: Date.now() - started, error: error.message });
  }
}

await test("layout sweep / 1440 / 1024 / 768 / 390 / no horizontal overflow / one H1", async () => {
  for (const [width, height] of [[1440, 1000], [1024, 900], [768, 900], [390, 844]]) {
    const { context, page } = await pageAt(width, height);
    for (const file of files) {
      for (const scenario of ["ready", "empty", "loading", "waiting", "preparing", "blocked", "stopping", "stopped", "create", "streaming"]) {
        await open(page, file, scenario);
        const metrics = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
          h1Count: document.querySelectorAll("h1").length,
          visibleViews: [...document.querySelectorAll("[data-view]")].filter((node) => !node.hidden).map((node) => node.dataset.view),
        }));
        assert.equal(metrics.scrollWidth, metrics.clientWidth, `${file} ${scenario} @${width}px overflows horizontally`);
        assert.equal(metrics.h1Count, 1, `${file} ${scenario} @${width}px must contain exactly one H1`);
        assert.equal(metrics.visibleViews.length, 1, `${file} ${scenario} @${width}px must show exactly one state view`);
      }
    }
    await context.close();
  }
});

for (const file of files) {
  await test(`${file} / prompt → streaming → stop → partial output`, async () => {
    const { context, page } = await pageAt();
    await open(page, file);
    await page.locator("[data-prompt]").first().click();
    await page.locator("[data-chat-input]").fill("请用三句话说明退款边界，并给客服一个下一步追问。");
    await page.locator("[data-composer-submit]").click();
    await page.locator("[data-cancel-generation]:visible").first().waitFor({ state: "visible", timeout: 3000 });
    await page.locator("[data-cancel-generation]:visible").first().click();
    await page.waitForTimeout(180);
    assert.ok((await page.locator("[data-chat-log]").innerText()).includes("已停止"), "partial output marker missing");
    await context.close();
  });

  await test(`${file} / create validation → waiting → bind → preparing → ready`, async () => {
    const { context, page } = await pageAt();
    await open(page, file, "create");
    await page.locator("#create-dialog").waitFor({ state: "visible", timeout: 3000 });
    await page.locator("[data-submit-create]").click();
    await page.locator("[data-create-error]").waitFor({ state: "visible", timeout: 2000 });
    await page.locator('input[name="adapter-choice"][value="best-a7"]').check();
    await page.locator("[data-submit-create]").click();
    await page.locator('[data-view="waiting"]').waitFor({ state: "visible", timeout: 3000 });
    await page.locator("[data-open-bind]").click();
    await page.locator("#bind-dialog").waitFor({ state: "visible", timeout: 2000 });
    await page.locator("[data-bind-input]").fill("u-4090-11-c2a1");
    await page.locator("[data-bind-ack]").check();
    await page.locator("[data-submit-bind]").click();
    await page.locator('[data-view="preparing"]').waitFor({ state: "visible", timeout: 3000 });
    await page.locator('[data-view="workspace"]').waitFor({ state: "visible", timeout: 5000 });
    await context.close();
  });

  await test(`${file} / stop confirmation → stopping → stopped receipt`, async () => {
    const { context, page } = await pageAt();
    await open(page, file);
    await page.locator("[data-request-stop]:visible").first().click();
    await page.locator("#stop-dialog").waitFor({ state: "visible", timeout: 2000 });
    await page.locator("[data-confirm-stop]").click();
    await page.locator('[data-view="stopping"]').waitFor({ state: "visible", timeout: 3000 });
    await page.locator('[data-view="stopped"]').waitFor({ state: "visible", timeout: 5000 });
    assert.match(await page.locator('[data-view="stopped"]').innerText(), /已回收|已释放|已清理|CONFIRMED/, "cleanup receipt missing");
    await context.close();
  });
}

await test("mobile / trial drawer, context sheet, conversation composer", async () => {
  const { context, page } = await pageAt(390, 844);
  for (const file of files) {
    await open(page, file);
    await page.locator("[data-open-queue]:visible").first().click();
    await page.locator("#mobile-queue-dialog").waitFor({ state: "visible", timeout: 2000 });
    await page.locator("#mobile-queue-dialog [data-close-dialog]").click();
    await page.locator("[data-open-context]").first().click();
    await page.locator("#mobile-context-dialog").waitFor({ state: "visible", timeout: 2000 });
    await page.locator("#mobile-context-dialog [data-close-dialog]").click();
    await page.locator("[data-chat-input]").fill("移动端发送测试");
    await page.locator("[data-composer-submit]").click();
    await page.locator("[data-cancel-generation]:visible").first().waitFor({ state: "visible", timeout: 3000 });
    assert.ok((await page.locator("[data-chat-log]").innerText()).includes("移动端发送测试"));
  }
  await context.close();
});

await test("all pages load without runtime errors", async () => {
  assert.deepEqual(consoleErrors, []);
});

await browser.close();
console.log(JSON.stringify({ results, consoleErrors }, null, 2));
if (results.some((result) => !result.ok) || consoleErrors.length) process.exitCode = 1;
