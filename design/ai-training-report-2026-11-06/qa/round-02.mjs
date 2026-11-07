import {mkdir, writeFile} from "node:fs/promises";
import {pathToFileURL} from "node:url";

const root = "<project-root>/design/ai-training-report-2026-11-06";
const shots = `${root}/screenshots`;
await mkdir(shots, {recursive: true});

const task = await taskSpace("modelforge-ai-training-report-2026-11-06");
const page = task.page("p1");
console.log({spaceId: task.spaceId, page: page.label});

await page.cdp("Emulation.setDeviceMetricsOverride", {
  width: 1440,
  height: 1000,
  deviceScaleFactor: 1,
  mobile: false,
  screenWidth: 1440,
  screenHeight: 1000,
});

const pageUrl = `${pathToFileURL(`${root}/option-a.html`).href}?view=report`;
await page.goto(pageUrl, {waitUntil: "domcontentloaded", timeout: 30000});
await page.waitForSelector(".report-shell", {state: "visible", timeout: 15000});

const layout = await page.cdp("Page.getLayoutMetrics");
const content = layout.cssContentSize || layout.contentSize;
const state = await page.evaluate(() => ({
  innerWidth,
  outerWidth,
  innerHeight,
  devicePixelRatio,
  visualScale: window.visualViewport?.scale,
  screenWidth: screen.width,
  htmlClientWidth: document.documentElement.clientWidth,
  htmlScrollWidth: document.documentElement.scrollWidth,
  bodyScrollWidth: document.body.scrollWidth,
  errors: window.__qaErrors || [],
}));
console.log(JSON.stringify({layout, state}, null, 2));

const capture = await page.cdp("Page.captureScreenshot", {
  format: "png",
  fromSurface: true,
  captureBeyondViewport: true,
  clip: {
    x: 0,
    y: 0,
    width: content.width,
    height: content.height,
    scale: 1,
  },
});
const target = `${shots}/a-report-desktop.png`;
await writeFile(target, Buffer.from(capture.data, "base64"));
console.log({screenshot: target, contentWidth: content.width, contentHeight: content.height});
