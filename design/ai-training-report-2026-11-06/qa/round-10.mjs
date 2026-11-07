import {mkdir, writeFile} from "node:fs/promises";

const root = "<project-root>/design/ai-training-report-2026-11-06";
const shots = `${root}/screenshots`;
await mkdir(shots, {recursive: true});

const task = await taskSpace(106);
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
    width,
    height,
    deviceScaleFactor: 1,
    mobile,
    screenWidth: width,
    screenHeight: height,
  });
}

async function layoutState() {
  return page.evaluate(() => ({
    title: document.title,
    viewport: document.documentElement.clientWidth,
    htmlScrollWidth: document.documentElement.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth,
    bodyHeight: document.body.scrollHeight,
    errors: window.__qaErrors || [],
  }));
}

async function waitForImages() {
  await page.waitForFunction(
    () => [...document.images].every((image) => image.complete && image.naturalWidth > 0),
    undefined,
    {timeout: 10000},
  );
}

await viewport(1440, 1000, false);
await page.goto(`file:///${root}/index.html`, {waitUntil: "load", timeout: 30000});
await page.waitForSelector(".prototype-grid", {state: "visible", timeout: 15000});
await waitForImages();
const indexDesktop = await layoutState();
const indexCopy = await page.evaluate(() => {
  const card = document.querySelector(".prototype-card");
  return {
    version: card?.querySelector(".prototype-version")?.textContent?.trim(),
    baselineHref: [...card.querySelectorAll(".prototype-links a")]
      .find((link) => link.textContent.includes("优化前基线"))?.getAttribute("href"),
    brokenImages: [...document.images].filter((image) => !image.naturalWidth).map((image) => image.src),
  };
});
await page.screenshot({path: `${shots}/index-desktop.png`, fullPage: true});

await viewport(390, 844, true);
await page.goto(`file:///${root}/index.html`, {waitUntil: "load", timeout: 30000});
await page.waitForSelector(".prototype-grid", {state: "visible", timeout: 15000});
await waitForImages();
const indexMobile = await layoutState();
await page.screenshot({path: `${shots}/index-mobile.png`, fullPage: true});

await viewport(1440, 1000, false);
await page.goto(
  `file:///${root}/option-a.html?attempt=4caec70d-eb19-445f-8b08-97fdec64276d&view=empty`,
  {waitUntil: "load", timeout: 30000},
);
await page.waitForSelector(".empty-main", {state: "visible", timeout: 15000});
const emptyDesktop = await layoutState();
await page.screenshot({path: `${shots}/a-empty-desktop-v2.png`, fullPage: true});
await page.click('.empty-main [data-action="generate-report"]');
await page.waitForSelector(".loading-view", {state: "visible", timeout: 5000});
const loadingDesktop = await layoutState();
await page.screenshot({path: `${shots}/a-loading-desktop-v2.png`, fullPage: true});
await page.waitForFunction(
  () => document.body.innerText.includes("LIMITED REVIEW / ADVISORY"),
  undefined,
  {timeout: 8000},
);
const limitedDesktop = await layoutState();
await page.screenshot({path: `${shots}/a-limited-desktop-v2.png`, fullPage: true});

const report = {
  indexDesktop,
  indexCopy,
  indexMobile,
  emptyDesktop,
  loadingDesktop,
  limitedDesktop,
};
await writeFile(`${root}/qa/round-10-result.json`, JSON.stringify(report, null, 2), "utf8");
console.log(JSON.stringify(report, null, 2));
