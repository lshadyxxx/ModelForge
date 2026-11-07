const fs = await import("node:fs/promises");

const task = await taskSpace(142);
const page = task.page("p1");
const root =
  "<project-root>/design/ai-training-report-2026-11-06/screenshots";

function dimensions(buffer) {
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
    bytes: buffer.length,
  };
}

async function saveCdp(name, options) {
  const shot = await page.cdp("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    ...options,
  });
  if (!shot?.data) throw new Error("screenshot data missing");
  const buffer = Buffer.from(shot.data, "base64");
  await fs.writeFile(`${root}/${name}`, buffer);
  return {name, ...dimensions(buffer)};
}

await page.cdp("Emulation.setDeviceMetricsOverride", {
  width: 1584,
  height: 1131,
  deviceScaleFactor: 0.9090909091,
  mobile: false,
  scale: 1,
  screenWidth: 1584,
  screenHeight: 1131,
});
await page.evaluate(() => {
  document.querySelector(".diagnosis-findings-section")?.scrollIntoView({block: "start"});
});
await page.waitForTimeout(250);

const results = [];
results.push(
  await saveCdp("scroll-test-beyond.png", {
    captureBeyondViewport: true,
    clip: {x: 0, y: 0, width: 1584, height: 1100, scale: 1},
  }),
  await saveCdp("scroll-test-viewport.png", {
    captureBeyondViewport: false,
    clip: {x: 0, y: 0, width: 1584, height: 1100, scale: 1},
  }),
  await saveCdp("scroll-test-viewport-native.png", {
    captureBeyondViewport: false,
  }),
);

await page.cdp("Emulation.setDeviceMetricsOverride", {
  width: 1584,
  height: 1103,
  deviceScaleFactor: 0.9090909091,
  mobile: false,
  scale: 1,
  screenWidth: 1584,
  screenHeight: 1103,
});
await page.waitForTimeout(150);
results.push(
  await saveCdp("scroll-test-viewport-1440x1000.png", {
    captureBeyondViewport: false,
  }),
);

console.log(JSON.stringify({
  scrollY: await page.evaluate(() => scrollY),
  results,
}, null, 2));
