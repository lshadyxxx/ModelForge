import {mkdir} from "node:fs/promises";

const root = "<project-root>/design/ai-training-report-2026-11-06";
const shots = `${root}/screenshots`;
await mkdir(shots, {recursive: true});

const task = await taskSpace("modelforge ai report option a refine 20261106");
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

async function viewport(width, height, mobile = false) {
  await page.cdp("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 1,
    mobile,
    screenWidth: width,
    screenHeight: height,
  });
}

async function state() {
  return page.evaluate(() => {
    const openFindings = [...document.querySelectorAll("details.finding[open]")];
    const reportRail = document.getElementById("reportRailNav");
    const reportJump = document.querySelector(".report-jump");
    const chartCard = document.querySelector(".chart-card");
    const limitCard = document.querySelector(".chart-section .limit-card");
    return {
      title: document.title,
      url: location.href,
      viewport: document.documentElement.clientWidth,
      htmlScrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
      bodyHeight: document.body.scrollHeight,
      findings: document.querySelectorAll("details.finding").length,
      openFindings: openFindings.length,
      evidenceIndexRows: document.querySelectorAll(".evidence-index button").length,
      reportRailHidden: reportRail?.hidden ?? null,
      reportJumpVisible: Boolean(reportJump) && getComputedStyle(reportJump).display !== "none",
      chartCardHeight: chartCard ? Math.round(chartCard.getBoundingClientRect().height) : null,
      limitCardHeight: limitCard ? Math.round(limitCard.getBoundingClientRect().height) : null,
      toast: document.querySelector("[role=status]")?.textContent?.trim() || "",
      errors: window.__qaErrors || [],
    };
  });
}

await viewport(1440, 1000, false);
await page.goto(`file:///${root}/option-a.html?view=report`, {waitUntil: "load", timeout: 30000});
await page.waitForSelector("details.finding", {state: "visible", timeout: 15000});
const desktopInitial = await state();
await page.screenshot({path: `${shots}/a-report-desktop.png`, fullPage: true});

await page.click('[data-filter="attention"]');
await page.waitForFunction(() => document.querySelectorAll("details.finding").length === 2);
const desktopFiltered = await page.evaluate(() => ({
  findings: document.querySelectorAll("details.finding").length,
  openFindings: document.querySelectorAll("details.finding[open]").length,
  activeFilter: document.querySelector('[data-filter][aria-pressed="true"]')?.dataset.filter,
}));

await page.click('[data-filter="all"]');
await page.waitForFunction(() => document.querySelectorAll("details.finding").length === 8);
await page.click(".evidence-index button[data-evidence='E-04']");
await page.waitForFunction(() => document.querySelector(".evidence-tag")?.textContent.includes("E-04"));
const evidenceSelection = await page.evaluate(() => ({
  inspector: document.querySelector(".evidence-tag")?.textContent.trim(),
  activeIndex: document.querySelector(".evidence-index button.is-active")?.dataset.evidence,
}));

await page.click("details#F-03 > summary");
const expandedFinding = await page.evaluate(() => document.querySelector("details#F-03")?.open ?? null);

await page.click('button[data-action="apply-experiment"][data-experiment-id="X-02"]');
await page.waitForSelector("#applyDialog:not([hidden])", {state: "visible", timeout: 5000});
await page.screenshot({path: `${shots}/a-apply-dialog-v2.png`, fullPage: false});
const applyDialog = await page.evaluate(() => ({
  open: !document.getElementById("applyDialog")?.hidden,
  boundary: document.getElementById("applyDialogDescription")?.textContent.trim(),
}));
await page.click("#applyDialog .mf-dialog-actions [data-dialog-close]");

await page.goto(`file:///${root}/option-a.html`, {waitUntil: "load", timeout: 30000});
await page.waitForSelector(".entry-hero", {state: "visible", timeout: 15000});
const entryState = await state();
await page.screenshot({path: `${shots}/a-entry-v2.png`, fullPage: true});

await page.goto(`file:///${root}/option-a.html?attempt=f3801f77-48e1-4b30-b6f3-5448f4a7bb4f&view=report`, {waitUntil: "load", timeout: 30000});
await page.waitForSelector("details.finding", {state: "visible", timeout: 15000});
const failedState = await state();
const failedCopy = await page.evaluate(() => ({
  headline: document.querySelector(".report-heading h1")?.textContent.trim(),
  nextAction: document.querySelector(".summary-next strong")?.textContent.trim(),
  hasFakeLoss: document.body.innerText.includes("Train Loss 0.000"),
}));
await page.screenshot({path: `${shots}/a-failed-desktop.png`, fullPage: true});

await viewport(390, 844, true);
await page.goto(`file:///${root}/option-a.html?view=report`, {waitUntil: "load", timeout: 30000});
await page.waitForSelector(".report-jump", {state: "visible", timeout: 15000});
const mobileState = await state();
await page.screenshot({path: `${shots}/a-report-mobile.png`, fullPage: true});

console.log(JSON.stringify({
  desktopInitial,
  desktopFiltered,
  evidenceSelection,
  expandedFinding,
  applyDialog,
  entryState,
  failedState,
  failedCopy,
  mobileState,
}, null, 2));
