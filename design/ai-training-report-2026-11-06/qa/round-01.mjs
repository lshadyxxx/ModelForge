import {mkdir} from "node:fs/promises";

const root = "<project-root>/design/ai-training-report-2026-11-06";
const evidence = `${root}/evidence`;
await mkdir(evidence, {recursive: true});

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

async function desktop() {
  await page.cdp("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });
}

async function capture(path, selector, url, options = {}) {
  if (url) {
    await page.goto(url, {waitUntil: "domcontentloaded", timeout: 30000});
  }
  await page.waitForSelector(selector, {state: "visible", timeout: 30000});
  await page.screenshot({path, fullPage: options.fullPage ?? true});
  const state = await page.evaluate(({selector}) => {
    const target = document.querySelector(selector);
    const bodyText = document.body.innerText;
    return {
      title: document.title,
      url: location.href,
      width: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
      h1: [...document.querySelectorAll("h1")].map((node) => node.textContent?.trim()),
      targetText: target?.textContent?.replace(/\s+/g, " ").trim().slice(0, 1200),
      errors: window.__qaErrors || [],
      hasTraining: bodyText.includes("训练工作台"),
      bodyHeight: document.body.scrollHeight,
    };
  }, {selector});
  console.log(JSON.stringify({path, ...state}, null, 2));
}

await desktop();
const successId = "fbc8a03d-27e3-4ef2-8253-c23ac8a599ac";
const failedId = "f3801f77-48e1-4b30-b6f3-5448f4a7bb4f";

await capture(
  `${evidence}/real-training-workbench-1440.png`,
  ".training-page-shell",
  "http://127.0.0.1:8092/#training",
);
await capture(
  `${evidence}/real-training-overview-1440.png`,
  ".training-detail-page",
  `http://127.0.0.1:8092/?attempt=${successId}#training`,
);
await capture(
  `${evidence}/real-training-analysis-1440.png`,
  ".training-analysis-page",
  `http://127.0.0.1:8092/?attempt=${successId}&tab=analysis#training`,
);
await capture(
  `${evidence}/real-training-artifacts-1440.png`,
  ".training-artifacts-page",
  `http://127.0.0.1:8092/?attempt=${successId}&tab=artifacts#training`,
);
await capture(
  `${evidence}/real-training-failure-1440.png`,
  ".training-detail-page",
  `http://127.0.0.1:8092/?attempt=${failedId}#training`,
);

console.log(await page.snapshot());
