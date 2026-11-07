const task = await taskSpace(131);
const page = task.page("p1");
const shot =
  "<project-root>/design/ai-training-report-2026-11-06/screenshots/implementation-disabled-mobile.png";

await page.cdp("Emulation.setDeviceMetricsOverride", {
  width: 390,
  height: 844,
  deviceScaleFactor: 1,
  mobile: true,
  scale: 1,
  screenWidth: 390,
  screenHeight: 844,
});
await page.reload({waitUntil: "domcontentloaded", timeout: 30000});
await page.waitForSelector(".diagnosis-disabled-state", {timeout: 20000});
const mobileShot = await page.screenshot({path: shot});
console.log(await page.evaluate(() => {
  const node = document.querySelector(".diagnosis-disabled-state");
  const rect = node?.getBoundingClientRect();
  return {
    title: document.title,
    viewport: innerWidth,
    viewportHeight: innerHeight,
    devicePixelRatio,
    htmlScrollWidth: document.documentElement.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth,
    disabledRect: rect
      ? {left: rect.left, right: rect.right, width: rect.width}
      : null,
    consoleErrors: window.__diagnosisConsoleErrors ?? [],
  };
}), {mobileShot});
