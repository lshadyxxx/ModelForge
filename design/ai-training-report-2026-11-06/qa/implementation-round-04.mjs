const task = await taskSpace(131);
const page = task.page("p1");
const attempt = "fbc8a03d-27e3-4ef2-8253-c23ac8a599ac";
const shotRoot =
  "<project-root>/design/ai-training-report-2026-11-06/screenshots";

await page.cdp("Page.addScriptToEvaluateOnNewDocument", {
  source: `
    window.__diagnosisConsoleErrors = [];
    const originalError = console.error.bind(console);
    console.error = (...args) => {
      window.__diagnosisConsoleErrors.push(args.map(String).join(" "));
      originalError(...args);
    };
    window.addEventListener("error", (event) => {
      window.__diagnosisConsoleErrors.push("window.error: " + event.message);
    });
    window.addEventListener("unhandledrejection", (event) => {
      window.__diagnosisConsoleErrors.push(
        "unhandledrejection: " + String(event.reason)
      );
    });
  `,
});

await page.cdp("Emulation.setDeviceMetricsOverride", {
  width: 1584,
  height: 1100,
  deviceScaleFactor: 1,
  mobile: false,
  scale: 1,
  screenWidth: 1584,
  screenHeight: 1100,
});

await page.goto(
  `http://127.0.0.1:8092/?attempt=${attempt}#training`,
  {waitUntil: "domcontentloaded", timeout: 30000},
);
await page.waitForSelector(".diagnosis-entry-card", {timeout: 20000});
await page.evaluate(() => {
  document.querySelector(".diagnosis-entry-card")?.scrollIntoView({
    block: "center",
  });
});
await page.waitForTimeout(250);
const entryShot = await page.screenshot({
  path: `${shotRoot}/implementation-entry-desktop.png`,
});
const entry = await page.evaluate(() => ({
  viewport: innerWidth,
  htmlScrollWidth: document.documentElement.scrollWidth,
  bodyScrollWidth: document.body.scrollWidth,
  text: document.querySelector(".diagnosis-entry-card")?.textContent?.trim(),
  consoleErrors: window.__diagnosisConsoleErrors ?? [],
}));

await page.goto(
  `http://127.0.0.1:8092/?attempt=${attempt}&tab=diagnosis#training`,
  {waitUntil: "domcontentloaded", timeout: 30000},
);
await page.waitForSelector(".diagnosis-disabled-state", {timeout: 20000});
const disabledShot = await page.screenshot({
  path: `${shotRoot}/implementation-disabled-desktop.png`,
});
const desktop = await page.evaluate(() => ({
  viewport: innerWidth,
  htmlScrollWidth: document.documentElement.scrollWidth,
  bodyScrollWidth: document.body.scrollWidth,
  disabledText: document.querySelector(".diagnosis-disabled-state")
    ?.textContent?.trim(),
  tabIsActive: document.querySelector(".training-detail-tabs .active")
    ?.textContent?.trim(),
  consoleErrors: window.__diagnosisConsoleErrors ?? [],
}));

await page.cdp("Emulation.setDeviceMetricsOverride", {
  width: 429,
  height: 929,
  deviceScaleFactor: 1,
  mobile: true,
  scale: 1,
  screenWidth: 429,
  screenHeight: 929,
});
await page.reload({waitUntil: "domcontentloaded", timeout: 30000});
await page.waitForSelector(".diagnosis-disabled-state", {timeout: 20000});
const mobileShot = await page.screenshot({
  path: `${shotRoot}/implementation-disabled-mobile.png`,
});
const mobile = await page.evaluate(() => ({
  viewport: innerWidth,
  viewportHeight: innerHeight,
  htmlScrollWidth: document.documentElement.scrollWidth,
  bodyScrollWidth: document.body.scrollWidth,
  disabledRect: (() => {
    const node = document.querySelector(".diagnosis-disabled-state");
    if (!node) return null;
    const rect = node.getBoundingClientRect();
    return {left: rect.left, right: rect.right, width: rect.width};
  })(),
  consoleErrors: window.__diagnosisConsoleErrors ?? [],
}));

console.log({entryShot, entry, disabledShot, desktop, mobileShot, mobile});
