import {mkdir, writeFile} from "node:fs/promises";
import {pathToFileURL} from "node:url";

const root = "<project-root>/design/ai-training-report-2026-11-06";
const shots = `${root}/screenshots`;
const successId = "fbc8a03d-27e3-4ef2-8253-c23ac8a599ac";
const failedId = "f3801f77-48e1-4b30-b6f3-5448f4a7bb4f";
const cancelledId = "4caec70d-eb19-445f-8b08-97fdec64276d";
await mkdir(shots, {recursive: true});

const task = await taskSpace("modelforge-ai-training-report-2026-11-06");
const page = task.page("p1");
console.log({spaceId: task.spaceId, page: page.label});

await page.cdp("Page.addScriptToEvaluateOnNewDocument", {
  source: `
    window.__qaErrors = [];
    window.addEventListener("error", (event) => {
      window.__qaErrors.push({type: "error", message: String(event.message || event.error)});
    });
    window.addEventListener("unhandledrejection", (event) => {
      window.__qaErrors.push({type: "unhandledrejection", message: String(event.reason)});
    });
    const originalError = console.error;
    console.error = (...args) => {
      window.__qaErrors.push({type: "console.error", message: args.map(String).join(" ")});
      originalError.apply(console, args);
    };
  `,
});

async function viewport(width, height, mobile = false) {
  await page.cdp("Emulation.setDeviceMetricsOverride", {
    width, height, deviceScaleFactor: 1, mobile,
    screenWidth: width, screenHeight: height,
  });
}

function url(file, query) {
  return `${pathToFileURL(`${root}/${file}`).href}?${query}`;
}

async function capture(path, targetUrl, selector, delay = 0) {
  await page.goto(targetUrl, {waitUntil: "domcontentloaded", timeout: 30000});
  await page.waitForSelector(selector, {state: "visible", timeout: 15000});
  if (delay) await page.waitForTimeout(delay);
  const layout = await page.cdp("Page.getLayoutMetrics");
  const content = layout.cssContentSize || layout.contentSize;
  const state = await page.evaluate(() => ({
    title: document.title,
    innerWidth,
    innerHeight,
    htmlScrollWidth: document.documentElement.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth,
    bodyHeight: document.body.scrollHeight,
    h1: [...document.querySelectorAll("h1")].map((node) => node.textContent?.trim()),
    errors: window.__qaErrors || [],
  }));
  const shot = await page.cdp("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: true,
    clip: {x: 0, y: 0, width: content.width, height: content.height, scale: 1},
  });
  await writeFile(path, Buffer.from(shot.data, "base64"));
  console.log(JSON.stringify({path, ...state, contentWidth: content.width, contentHeight: content.height}, null, 2));
}

await viewport(1440, 1000, false);
await capture(`${shots}/a-failed-desktop.png`, url("option-a.html", `attempt=${failedId}&view=report`), ".verdict-grid");
await capture(`${shots}/b-report-desktop.png`, url("option-b.html", `attempt=${successId}&view=report`), ".report-layout");
await capture(`${shots}/b-failed-desktop.png`, url("option-b.html", `attempt=${failedId}&view=report`), ".report-layout");
await capture(`${shots}/c-failed-desktop.png`, url("option-c.html", `attempt=${failedId}&view=report`), ".report-grid");
await capture(`${shots}/c-loading-desktop.png`, url("option-c.html", `attempt=${successId}&view=loading`), ".loading-grid", 260);
await capture(`${shots}/c-empty-desktop.png`, url("option-c.html", `attempt=${cancelledId}&view=empty`), ".empty-grid");

await viewport(390, 844, true);
await capture(`${shots}/a-report-mobile.png`, url("option-a.html", `attempt=${successId}&view=report`), ".verdict-grid");
await capture(`${shots}/b-report-mobile.png`, url("option-b.html", `attempt=${successId}&view=report`), ".report-layout");
await capture(`${shots}/c-report-mobile.png`, url("option-c.html", `attempt=${successId}&view=report`), ".report-grid");
