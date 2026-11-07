const task = await taskSpace(131);
const page = task.page("p1");

await page.keyboard.press("Control+0");
await page.waitForTimeout(200);
await page.cdp("Emulation.setDeviceMetricsOverride", {
  width: 1440,
  height: 1000,
  deviceScaleFactor: 1,
  mobile: false,
  scale: 1,
  screenWidth: 1440,
  screenHeight: 1000,
});
console.log(await page.evaluate(() => ({
  innerWidth,
  innerHeight,
  devicePixelRatio,
  visualScale: visualViewport?.scale,
  screenWidth: screen.width,
})));
