const task = await taskSpace("modelforge-ai-diagnosis-2026-11-06");
const page = task.page("p1");
console.log({spaceId: task.spaceId, page: page.label});

await page.cdp("Emulation.setDeviceMetricsOverride", {
  width: 1440,
  height: 1000,
  deviceScaleFactor: 1,
  mobile: false,
});

const attempt = "fbc8a03d-27e3-4ef2-8253-c23ac8a599ac";
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
  path: "<project-root>/design/ai-training-report-2026-11-06/screenshots/implementation-entry-1440.png",
});
const entryText = await page.evaluate(() =>
  document.querySelector(".diagnosis-entry-card")?.textContent?.trim()
);
console.log({entryShot, entryText});

await page.goto(
  `http://127.0.0.1:8092/?attempt=${attempt}&tab=diagnosis#training`,
  {waitUntil: "domcontentloaded", timeout: 30000},
);
await page.waitForSelector(".diagnosis-disabled-state", {timeout: 20000});
const disabledShot = await page.screenshot({
  path: "<project-root>/design/ai-training-report-2026-11-06/screenshots/implementation-disabled-1440.png",
});
const desktop = await page.evaluate(() => ({
  title: document.title,
  viewport: innerWidth,
  htmlScrollWidth: document.documentElement.scrollWidth,
  bodyScrollWidth: document.body.scrollWidth,
  disabledText: document.querySelector(".diagnosis-disabled-state")?.textContent?.trim(),
  hasGenerateButton: [...document.querySelectorAll("button")].some(
    (button) => button.textContent?.includes("生成 AI 诊断"),
  ),
}));
console.log({disabledShot, desktop});
