const { writeFile } = await import("node:fs/promises");

const attempt = "fbc8a03d-27e3-4ef2-8253-c23ac8a599ac";
const base = `http://127.0.0.1:8092/?attempt=${attempt}`;
const output =
  "<project-root>/design/ai-training-report-2026-11-06/screenshots";

const task = await taskSpace("modelforge-ai-final-verify-20261106");
const page = task.page("p1");

await page.cdp("Emulation.setDeviceMetricsOverride", {
  width: 1584,
  height: 1100,
  deviceScaleFactor: 1,
  mobile: false,
});
await page.cdp("Page.addScriptToEvaluateOnNewDocument", {
  source: `
    window.__qaIssues = [];
    const originalError = console.error.bind(console);
    console.error = (...args) => {
      window.__qaIssues.push({type: "console", text: args.map(String).join(" ")});
      originalError(...args);
    };
    window.addEventListener("error", (event) => {
      window.__qaIssues.push({type: "error", text: String(event.message || event.error)});
    });
    window.addEventListener("unhandledrejection", (event) => {
      window.__qaIssues.push({type: "rejection", text: String(event.reason)});
    });
  `,
});

async function inspect(name, url, width, height) {
  await page.goto(url, { waitUntil: "load", timeout: 20000 });
  await page.waitForLoadState("load");
  await page.waitForTimeout(900);
  const state = await page.evaluate(() => ({
    innerWidth: window.innerWidth,
    htmlScrollWidth: document.documentElement.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth,
    title: document.title,
    issues: window.__qaIssues || [],
  }));
  const shot = await page.cdp("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: false,
    clip: { x: 0, y: 0, width, height, scale: 1 },
  });
  const path = `${output}/${name}`;
  await writeFile(path, Buffer.from(shot.data, "base64"));
  return { name, path, ...state };
}

const desktopOverview = await inspect(
  "implementation-entry-desktop-v2.png",
  `${base}&tab=overview#training`,
  1440,
  1000,
);
const desktopDiagnosis = await inspect(
  "implementation-disabled-desktop-v2.png",
  `${base}&tab=diagnosis#training`,
  1440,
  1000,
);

await page.cdp("Emulation.setDeviceMetricsOverride", {
  width: 429,
  height: 929,
  deviceScaleFactor: 1,
  mobile: false,
});
const mobileDiagnosis = await inspect(
  "implementation-disabled-mobile-v2.png",
  `${base}&tab=diagnosis#training`,
  390,
  844,
);

console.log(JSON.stringify({
  spaceId: task.spaceId,
  desktopOverview,
  desktopDiagnosis,
  mobileDiagnosis,
}, null, 2));
await task.finish({ keep: [] });
