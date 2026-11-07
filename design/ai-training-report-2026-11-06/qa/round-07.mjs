import {writeFile} from "node:fs/promises";
import {pathToFileURL} from "node:url";

const root = "<project-root>/design/ai-training-report-2026-11-06";
const shots = `${root}/screenshots`;
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

async function capture(path) {
  const target = `${pathToFileURL(`${root}/index.html`).href}`;
  await page.goto(target, {waitUntil: "domcontentloaded", timeout: 30000});
  await page.waitForSelector(".prototype-grid", {state: "visible", timeout: 15000});
  await page.waitForFunction(() => [...document.images].every((image) => image.complete), undefined, {timeout: 10000});
  const layout = await page.cdp("Page.getLayoutMetrics");
  const content = layout.cssContentSize || layout.contentSize;
  const state = await page.evaluate(() => ({
    title: document.title,
    innerWidth,
    innerHeight,
    htmlScrollWidth: document.documentElement.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth,
    bodyHeight: document.body.scrollHeight,
    brokenImages: [...document.images].filter((image) => !image.naturalWidth).map((image) => image.src),
    cards: document.querySelectorAll(".prototype-card").length,
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
await capture(`${shots}/index-desktop.png`);

await viewport(390, 844, true);
await capture(`${shots}/index-mobile.png`);
