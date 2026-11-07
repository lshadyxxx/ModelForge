const fs = await import("node:fs/promises");
const task = await taskSpace(131);
const page = task.page("p1");
const attempt = "fbc8a03d-27e3-4ef2-8253-c23ac8a599ac";
const shotRoot =
  "<project-root>/design/ai-training-report-2026-11-06/screenshots";

async function captureViewport(path) {
  const scrollY = await page.evaluate(() => window.scrollY);
  const result = await page.cdp("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: true,
    clip: {
      x: 0,
      y: scrollY,
      width: 1440,
      height: 1000,
      scale: 1,
    },
  });
  if (!result?.data) throw new Error("screenshot data missing");
  await fs.writeFile(path, Buffer.from(result.data, "base64"));
  return {path, scrollY, dataLength: result.data.length};
}

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
const entry = await captureViewport(
  `${shotRoot}/implementation-entry-desktop.png`,
);

await page.goto(
  `http://127.0.0.1:8092/?attempt=${attempt}&tab=diagnosis#training`,
  {waitUntil: "domcontentloaded", timeout: 30000},
);
await page.waitForSelector(".diagnosis-disabled-state", {timeout: 20000});
const disabled = await captureViewport(
  `${shotRoot}/implementation-disabled-desktop.png`,
);
const layout = await page.evaluate(() => ({
  viewport: innerWidth,
  viewportHeight: innerHeight,
  text: document.querySelector(".diagnosis-disabled-state")?.textContent?.trim(),
  consoleErrors: window.__diagnosisConsoleErrors ?? [],
}));

console.log({entry, disabled, layout});
