const fs = await import("node:fs/promises");

const task = await taskSpace(142);
const page = task.page("p1");
const attempt = "4caec70d-eb19-445f-8b08-97fdec64276d";
const root =
  "<project-root>/design/ai-training-report-2026-11-06/screenshots";

await page.cdp("Emulation.setDeviceMetricsOverride", {
  width: 1584,
  height: 1131,
  deviceScaleFactor: 0.9090909091,
  mobile: false,
  scale: 1,
  screenWidth: 1584,
  screenHeight: 1131,
});
await page.goto(
  `http://127.0.0.1:8092/?attempt=${attempt}&tab=diagnosis&qa=${Date.now()}#training`,
  {waitUntil: "domcontentloaded", timeout: 30000},
);
await page.waitForSelector(".diagnosis-empty-state", {timeout: 30000});
await page.waitForTimeout(300);
const shot = await page.cdp("Page.captureScreenshot", {
  format: "png",
  fromSurface: true,
  captureBeyondViewport: false,
});
if (!shot?.data) throw new Error("screenshot data missing");
const path = `${root}/implementation-ai-report-empty-desktop-20261107.png`;
await fs.writeFile(path, Buffer.from(shot.data, "base64"));

console.log(JSON.stringify({
  path,
  state: await page.evaluate(() => ({
    title: document.querySelector(".diagnosis-empty-state h2")?.textContent?.trim(),
    action: document.querySelector(".diagnosis-empty-state button")?.textContent?.replace(/\s+/g, " ").trim(),
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: innerWidth,
    overflowX: document.documentElement.scrollWidth > innerWidth,
    issues: window.__qaIssues || [],
  })),
}, null, 2));
