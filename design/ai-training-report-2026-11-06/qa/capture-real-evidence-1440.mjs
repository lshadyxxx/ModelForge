const { writeFile } = await import("node:fs/promises");

const base =
  "http://127.0.0.1:8092/?attempt=fbc8a03d-27e3-4ef2-8253-c23ac8a599ac";
const failed =
  "http://127.0.0.1:8092/?attempt=f3801f77-48e1-4b30-b6f3-5448f4a7bb4f";
const output =
  "<project-root>/design/ai-training-report-2026-11-06/evidence";

const task = await taskSpace("modelforge-ai-evidence-final-20261106");
const page = task.page("p1");

await page.cdp("Emulation.setDeviceMetricsOverride", {
  width: 1584,
  height: 1100,
  deviceScaleFactor: 1,
  mobile: false,
});

const captures = [
  ["real-training-overview-1440-v2.png", `${base}&tab=overview#training`],
  ["real-training-analysis-1440-v2.png", `${base}&tab=analysis#training`],
  ["real-training-artifacts-1440-v2.png", `${base}&tab=artifacts#training`],
  ["real-training-failure-1440-v2.png", `${failed}&tab=overview#training`],
];

const results = [];
for (const [name, url] of captures) {
  await page.goto(url, { waitUntil: "load", timeout: 20000 });
  await page.waitForLoadState("load");
  await page.waitForTimeout(800);
  const viewport = await page.evaluate(() => ({
    innerWidth: window.innerWidth,
    htmlScrollWidth: document.documentElement.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth,
    title: document.title,
  }));
  const shot = await page.cdp("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: false,
    clip: { x: 0, y: 0, width: 1440, height: 1000, scale: 1 },
  });
  const path = `${output}/${name}`;
  await writeFile(path, Buffer.from(shot.data, "base64"));
  results.push({ name, path, viewport });
}

console.log(JSON.stringify({ spaceId: task.spaceId, results }, null, 2));
await task.finish({ keep: [] });
