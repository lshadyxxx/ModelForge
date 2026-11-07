const task = await taskSpace(142);
const page = task.page("p1");
const values = [];

for (const deviceScaleFactor of [1, 0.9090909091, 1.1]) {
  try {
    await page.cdp("Emulation.setDeviceMetricsOverride", {
      width: 1584,
      height: 1131,
      deviceScaleFactor,
      mobile: false,
      scale: 1,
      screenWidth: 1584,
      screenHeight: 1131,
    });
    await page.waitForTimeout(100);
    values.push(await page.evaluate((factor) => ({
      requestedDeviceScaleFactor: factor,
      innerWidth,
      innerHeight,
      devicePixelRatio,
      outerWidth,
      outerHeight,
      screenWidth: screen.width,
      visualViewportWidth: visualViewport?.width,
      visualViewportScale: visualViewport?.scale,
    }), deviceScaleFactor));
  } catch (error) {
    values.push({
      requestedDeviceScaleFactor: deviceScaleFactor,
      error: String(error),
    });
  }
}

console.log(JSON.stringify({taskSpaceId: task.spaceId, values}, null, 2));
