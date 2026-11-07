import {mkdir, writeFile} from "node:fs/promises";
import {pathToFileURL} from "node:url";

const root = "<project-root>/design/ai-training-report-2026-11-06";
const shots = `${root}/screenshots`;
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

async function capture(path, url, selector) {
  await page.goto(url, {waitUntil: "domcontentloaded", timeout: 30000});
  await page.waitForSelector(selector, {state: "visible", timeout: 15000});
  const layout = await page.cdp("Page.getLayoutMetrics");
  const content = layout.cssContentSize || layout.contentSize;
  const state = await page.evaluate(() => ({
    title: document.title,
    innerWidth,
    innerHeight,
    htmlClientWidth: document.documentElement.clientWidth,
    htmlScrollWidth: document.documentElement.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth,
    bodyHeight: document.body.scrollHeight,
    h1: [...document.querySelectorAll("h1")].map((node) => node.textContent?.trim()),
    formsInForms: [...document.querySelectorAll("form form")].length,
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

const url = (query) => `${pathToFileURL(`${root}/option-b.html`).href}?${query}`;

await viewport(1440, 1000, false);
await capture(`${shots}/b-report-desktop.png`, url("view=report"), ".report-layout");

await viewport(390, 844, true);
await capture(`${shots}/b-report-mobile.png`, url("view=report"), ".report-layout");

