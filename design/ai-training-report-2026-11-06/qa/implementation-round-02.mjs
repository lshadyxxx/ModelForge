const task = await taskSpace(131);
const page = task.page("p1");

await page.cdp("Emulation.setPageScaleFactor", {pageScaleFactor: 1});
await page.cdp("Emulation.setDeviceMetricsOverride", {
  width: 1440,
  height: 1000,
  deviceScaleFactor: 1,
  mobile: false,
  scale: 1,
  screenWidth: 1440,
  screenHeight: 1000,
});
const first = await page.evaluate(() => ({
  innerWidth,
  innerHeight,
  outerWidth,
  outerHeight,
  devicePixelRatio,
  visualScale: visualViewport?.scale,
  screenWidth: screen.width,
  screenHeight: screen.height,
}));

await page.cdp("Emulation.setDeviceMetricsOverride", {
  width: 1584,
  height: 1100,
  deviceScaleFactor: 1,
  mobile: false,
  scale: 1,
  screenWidth: 1584,
  screenHeight: 1100,
});
const second = await page.evaluate(() => ({
  innerWidth,
  innerHeight,
  outerWidth,
  outerHeight,
  devicePixelRatio,
  visualScale: visualViewport?.scale,
  screenWidth: screen.width,
  screenHeight: screen.height,
}));

console.log({first, second});
