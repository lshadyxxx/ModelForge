const fs = await import("node:fs/promises");

const task = await taskSpace(142);
const page = task.page("p1");
const attempt = "fbc8a03d-27e3-4ef2-8253-c23ac8a599ac";
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
    captureBeyondViewport: true,
    ...options,
  });
  if (!shot?.data) throw new Error("screenshot data missing");
  const buffer = Buffer.from(shot.data, "base64");
  await fs.writeFile(`${root}/${name}`, buffer);
  return {name, ...dimensions(buffer)};
}

await page.goto(
  `http://127.0.0.1:8092/?attempt=${attempt}&tab=diagnosis&qa=${Date.now()}#training`,
  {waitUntil: "domcontentloaded", timeout: 30000},
);
await page.waitForSelector(".diagnosis-report", {timeout: 30000});
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(300);

const results = [];
for (const deviceScaleFactor of [1, 0.9090909091]) {
  await page.cdp("Emulation.setDeviceMetricsOverride", {
    width: 1584,
    height: 1131,
    deviceScaleFactor,
    mobile: false,
    scale: 1,
    screenWidth: 1584,
    screenHeight: 1131,
  });
  await page.waitForTimeout(150);
  const state = await page.evaluate(() => ({
    innerWidth,
    innerHeight,
    devicePixelRatio,
    visualViewportWidth: visualViewport?.width,
    visualViewportScale: visualViewport?.scale,
  }));
  results.push({deviceScaleFactor, state});
  results.push(
    await saveCdp(`dpr-test-${deviceScaleFactor}-native.png`, {}),
    await saveCdp(`dpr-test-${deviceScaleFactor}-clip-1440.png`, {
      clip: {x: 0, y: 0, width: 1440, height: 1000, scale: 1},
    }),
    await saveCdp(`dpr-test-${deviceScaleFactor}-clip-1584.png`, {
      clip: {x: 0, y: 0, width: 1584, height: 1100, scale: 1},
    }),
  );
}

console.log(JSON.stringify(results, null, 2));
