import {writeFile} from "node:fs/promises";
import {pathToFileURL} from "node:url";

const root = "<project-root>/design/ai-training-report-2026-11-06";
const successId = "fbc8a03d-27e3-4ef2-8253-c23ac8a599ac";
const failedId = "f3801f77-48e1-4b30-b6f3-5448f4a7bb4f";
const cancelledId = "4caec70d-eb19-445f-8b08-97fdec64276d";

const task = await taskSpace("modelforge-ai-training-report-2026-11-06");
const page = task.page("p1");
console.log({spaceId: task.spaceId, page: page.label});

await page.cdp("Page.addScriptToEvaluateOnNewDocument", {
  source: `
    window.__qaErrors = [];
    window.addEventListener("error", (event) => {
      window.__qaErrors.push({type: "error", message: String(event.message || event.error)});
    });
    window.addEventListener("unhandledrejection", (event) => {
      window.__qaErrors.push({type: "unhandledrejection", message: String(event.reason)});
    });
    const originalError = console.error;
    console.error = (...args) => {
      window.__qaErrors.push({type: "console.error", message: args.map(String).join(" ")});
      originalError.apply(console, args);
    };
  `,
});

await page.cdp("Emulation.setDeviceMetricsOverride", {
  width: 1440,
  height: 1000,
  deviceScaleFactor: 1,
  mobile: false,
  screenWidth: 1440,
  screenHeight: 1000,
});

function url(file, query) {
  return `${pathToFileURL(`${root}/${file}`).href}?${query}`;
}

async function openReport(file, viewSelector, query = `attempt=${successId}&view=report`) {
  await page.goto(url(file, query), {waitUntil: "domcontentloaded", timeout: 30000});
  await page.waitForSelector(viewSelector, {state: "visible", timeout: 15000});
}

async function clickSelector(selector) {
  return page.evaluate((target) => {
    const node = document.querySelector(target);
    if (!node) return false;
    node.click();
    return true;
  }, selector);
}

async function textOf(selector) {
  return page.evaluate((target) => document.querySelector(target)?.innerText?.replace(/\s+/g, " ").trim() || "", selector);
}

async function errors() {
  return page.evaluate(() => window.__qaErrors || []);
}

const results = {};

for (const config of [
  {
    key: "A",
    file: "option-a.html",
    reportSelector: ".finding",
    findingSelector: ".finding",
    loadingSelector: ".loading-view",
    inspectorSelector: ".inspector-body",
    copyAction: "copy-report",
  },
  {
    key: "B",
    file: "option-b.html",
    reportSelector: ".finding-row",
    findingSelector: ".finding-row",
    loadingSelector: ".loading-sheet",
    inspectorSelector: ".finding-list",
    copyAction: "copy-summary",
  },
  {
    key: "C",
    file: "option-c.html",
    reportSelector: ".finding-entry",
    findingSelector: ".finding-entry",
    loadingSelector: ".loading-grid",
    inspectorSelector: "#report-evidence",
    copyAction: "copy-summary",
  },
]) {
  await openReport(config.file, config.reportSelector);
  const initial = await page.evaluate((selector) => ({
    findings: document.querySelectorAll(selector).length,
    hasApply: Boolean(document.querySelector('[data-action="apply-experiment"]')),
    hasRegenerate: Boolean(document.querySelector('[data-action="regenerate"]')),
    bodyOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }), config.findingSelector);

  await clickSelector('[data-filter="attention"]');
  await page.waitForFunction(
    ({selector}) => document.querySelectorAll(selector).length === 2,
    {selector: config.findingSelector},
    {timeout: 5000},
  );
  const filtered = await page.evaluate((selector) => ({
    findings: document.querySelectorAll(selector).length,
    activeFilter: document.querySelector('[data-filter].is-active')?.dataset.filter || "",
  }), config.findingSelector);
  await clickSelector('[data-filter="all"]');

  const beforeEvidence = await textOf(config.inspectorSelector);
  await clickSelector('[data-evidence="E-04"]');
  await page.waitForTimeout(200);
  const afterEvidence = await textOf(config.inspectorSelector);
  let evidenceExpanded = beforeEvidence !== afterEvidence;
  if (config.key === "B") {
    await page.waitForSelector("#evidenceDialog:not([hidden])", {state: "visible", timeout: 5000});
    evidenceExpanded = (await textOf("#evidenceDialogBody")).includes("GPU memory snapshot");
    await clickSelector('#evidenceDialog [data-dialog-close]');
    await page.waitForSelector("#evidenceDialog", {state: "hidden", timeout: 5000});
  }
  if (config.key === "C") {
    const rawVisible = await page.evaluate(() => Boolean(document.querySelector("#report-evidence details.raw-evidence")));
    const opened = await clickSelector('[data-action="open-evidence"]');
    if (opened) {
      await page.waitForSelector("#evidenceDialog:not([hidden])", {state: "visible", timeout: 5000});
      evidenceExpanded = (await textOf("#evidenceDialogBody")).includes("GPU memory snapshot");
      await clickSelector('#evidenceDialog [data-dialog-close]');
      await page.waitForSelector("#evidenceDialog", {state: "hidden", timeout: 5000});
    }
    results[`${config.key}_rawEvidenceAvailable`] = rawVisible;
  }

  await clickSelector('[data-action="apply-experiment"]');
  await page.waitForSelector("#applyDialog:not([hidden])", {state: "visible", timeout: 5000});
  const dialogText = await textOf("#applyDialogBody");
  if (config.key === "C") {
    await page.screenshot({path: `${root}/screenshots/c-apply-dialog.png`, fullPage: false});
  }
  await page.click("#confirmApply");
  await page.waitForSelector("#applyDialog", {state: "hidden", timeout: 5000});
  await page.waitForSelector("#mf-toast.show", {state: "visible", timeout: 5000});
  const toast = await textOf("#mf-toast");

  if (config.hasRegenerate !== false) {
    await clickSelector('[data-action="regenerate"]');
    await page.waitForSelector(config.loadingSelector, {state: "visible", timeout: 5000});
    await page.waitForSelector(config.findingSelector, {state: "visible", timeout: 8000});
  }

  await clickSelector(`[data-action="${config.copyAction}"]`);
  await page.waitForSelector("#mf-toast.show", {state: "visible", timeout: 5000});
  const copyToast = await textOf("#mf-toast");

  await page.selectOption("#attemptSelect", failedId);
  await page.waitForFunction(() => document.body.innerText.includes("失败"), undefined, {timeout: 5000});
  const switched = await page.evaluate(() => ({
    selected: document.querySelector("#attemptSelect")?.value,
    bodyHasFailure: document.body.innerText.includes("失败"),
    bodyHasBootstrap: document.body.innerText.includes("bootstrap_key_install_failed"),
  }));

  results[config.key] = {
    initial,
    filtered,
    evidenceChanged: beforeEvidence !== afterEvidence,
    evidenceExpanded,
    dialogHasDraftBoundary: dialogText.includes("草稿") || dialogText.includes("未提交"),
    toast,
    regenerated: true,
    copyToast,
    switched,
    errors: await errors(),
  };
}

await page.goto(url("option-c.html", `attempt=${cancelledId}&view=empty`), {waitUntil: "domcontentloaded", timeout: 30000});
await page.waitForSelector(".empty-grid", {state: "visible", timeout: 8000});
await clickSelector('[data-action="generate"]');
await page.waitForSelector(".loading-grid", {state: "visible", timeout: 5000});
await page.waitForSelector(".limited-grid", {state: "visible", timeout: 8000});
results.C_limited = {
  text: (await textOf(".limited-wrap")).slice(0, 420),
  errors: await errors(),
};

results.finalViewport = await page.evaluate(() => ({
  width: innerWidth,
  htmlScrollWidth: document.documentElement.scrollWidth,
  bodyScrollWidth: document.body.scrollWidth,
}));

const reportPath = `${root}/qa/interaction-report.json`;
await writeFile(reportPath, JSON.stringify(results, null, 2));
console.log(JSON.stringify({reportPath, results}, null, 2));
