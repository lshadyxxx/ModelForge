const fs = await import("node:fs/promises");

const task = await taskSpace(142);
const page = task.page("p1");
const root =
  "<project-root>/design/ai-training-report-2026-11-06/screenshots";
const successAttempt = "fbc8a03d-27e3-4ef2-8253-c23ac8a599ac";
const failedAttempt = "f3801f77-48e1-4b30-b6f3-5448f4a7bb4f";
const nonce = Date.now();

function trainingUrl(attemptId, tab) {
  return (
    `http://127.0.0.1:8092/?attempt=${attemptId}&tab=${tab}` +
    `&qa=${nonce}#training`
  );
}

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

async function capture(name) {
  const shot = await page.cdp("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: false,
  });
  if (!shot?.data) throw new Error("screenshot data missing");
  const path = `${root}/${name}`;
  await fs.writeFile(path, Buffer.from(shot.data, "base64"));
  return path;
}

async function pageState(label) {
  return {
    label,
    url: await page.url(),
    layout: await page.evaluate(() => ({
      viewportWidth: innerWidth,
      viewportHeight: innerHeight,
      documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
      overflowX: document.documentElement.scrollWidth > innerWidth,
      devicePixelRatio,
      visualViewportScale: visualViewport?.scale,
      issues: window.__qaIssues || [],
    })),
  };
}

async function openReport(attemptId) {
  await page.goto(
    trainingUrl(attemptId, "diagnosis"),
    {waitUntil: "domcontentloaded", timeout: 30000},
  );
  await page.waitForSelector(".diagnosis-report", {timeout: 30000});
  await page.waitForTimeout(500);
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
await page.cdp("Network.enable");
await page.cdp("Network.setCacheDisabled", {cacheDisabled: true});

await page.goto(
  trainingUrl(successAttempt, "overview"),
  {waitUntil: "domcontentloaded", timeout: 30000},
);
await page.waitForSelector(".diagnosis-entry-card", {timeout: 30000});
await page.evaluate(() => {
  document.querySelector(".diagnosis-entry-card")?.scrollIntoView({block: "center"});
});
await page.waitForTimeout(300);
const entryPath = await capture(
  "implementation-ai-report-entry-desktop-20261107.png",
);
const entryState = await pageState("entry");

await openReport(successAttempt);
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(200);
const successPath = await capture(
  "implementation-ai-report-success-desktop-20261107.png",
);
const successState = await pageState("success");
await page.click(".diagnosis-page-actions button:nth-of-type(1)");
await page.waitForTimeout(150);
const copySummaryState = await page.evaluate(() => ({
  buttonText: document.querySelector(
    ".diagnosis-page-actions button:nth-of-type(1)",
  )?.textContent?.replace(/\s+/g, " ").trim(),
  error: document.querySelector(".diagnosis-inline-error")?.textContent?.trim() || '',
}));
await page.waitForTimeout(1700);

await page.click(".diagnosis-severity-filter button:nth-of-type(3)");
await page.waitForTimeout(250);
const filterState = await page.evaluate(() => ({
  active: document.querySelector(".diagnosis-severity-filter button.active")?.textContent?.trim(),
  visibleFindings: [...document.querySelectorAll(".diagnosis-finding")]
    .filter((node) => node.getClientRects().length > 0).length,
}));
await page.evaluate(() => {
  document.querySelector(".diagnosis-findings-section")?.scrollIntoView({block: "start"});
});
await page.waitForTimeout(250);
const findingsPath = await capture(
  "implementation-ai-report-findings-desktop-20261107.png",
);

await page.evaluate(() => {
  const memory = document.querySelector("#diagnosis-evidence-E-MEMORY");
  if (memory instanceof HTMLDetailsElement) memory.open = true;
  memory?.scrollIntoView({block: "center"});
});
await page.waitForTimeout(250);
const evidenceExpanded = await page.evaluate(() => {
  const memory = document.querySelector("#diagnosis-evidence-E-MEMORY");
  return {
    open: memory instanceof HTMLDetailsElement ? memory.open : false,
    text: memory?.textContent?.replace(/\s+/g, " ").trim().slice(0, 260),
  };
});
const evidencePath = await capture(
  "implementation-ai-report-evidence-desktop-20261107.png",
);

await page.click(
  ".diagnosis-experiment-list article:nth-of-type(2) .diagnosis-experiment-footer button",
);
await page.waitForSelector(".diagnosis-draft-panel", {timeout: 20000});
await page.evaluate(() => {
  document.querySelector(".diagnosis-draft-panel")?.scrollIntoView({block: "center"});
});
await page.waitForTimeout(300);
const draftState = await page.evaluate(() => ({
  title: document.querySelector("#diagnosis-draft-title")?.textContent?.trim(),
  notice: document.querySelector(".diagnosis-draft-panel > p")?.textContent?.trim(),
  patch: document.querySelector(".diagnosis-draft-grid pre")?.textContent?.trim(),
  issues: window.__qaIssues || [],
}));
const draftPath = await capture(
  "implementation-ai-report-apply-draft-desktop-20261107.png",
);
await page.click(".diagnosis-draft-panel footer button");
await page.waitForTimeout(150);
const copyDraftState = await page.evaluate(() => ({
  buttonText: document.querySelector(
    ".diagnosis-draft-panel footer button",
  )?.textContent?.replace(/\s+/g, " ").trim(),
  error: Array.from(document.querySelectorAll(".diagnosis-inline-error"))
    .map((node) => node.textContent?.trim())
    .filter(Boolean),
}));

await openReport(failedAttempt);
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(200);
const failurePath = await capture(
  "implementation-ai-report-failure-desktop-20261107.png",
);
const failureState = await pageState("failure");

await page.cdp("Emulation.setDeviceMetricsOverride", {
  width: 429,
  height: 924,
  deviceScaleFactor: 0.9090909091,
  mobile: false,
  scale: 1,
  screenWidth: 429,
  screenHeight: 924,
});
await openReport(successAttempt);
await page.evaluate(() => {
  const report = document.querySelector(".diagnosis-report");
  if (report) window.scrollTo(0, report.getBoundingClientRect().top + window.scrollY - 12);
});
await page.waitForTimeout(250);
const mobilePath = await capture(
  "implementation-ai-report-success-mobile-20261107.png",
);
const mobileState = await pageState("mobile-success");

console.log(JSON.stringify({
  taskSpaceId: task.spaceId,
  screenshots: {
    entryPath,
    successPath,
    findingsPath,
    evidencePath,
    draftPath,
    failurePath,
    mobilePath,
  },
  entryState,
  successState,
  copySummaryState,
  filterState,
  evidenceExpanded,
  draftState,
  copyDraftState,
  failureState,
  mobileState,
}, null, 2));
