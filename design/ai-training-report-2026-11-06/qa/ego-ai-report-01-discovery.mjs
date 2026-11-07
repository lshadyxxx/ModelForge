const task = await taskSpace("modelforge-ai-report-final-20261107");
const page = task.page("p1");
const attempt = "fbc8a03d-27e3-4ef2-8253-c23ac8a599ac";

await page.cdp("Emulation.setDeviceMetricsOverride", {
  width: 1440,
  height: 1000,
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

await page.goto(
  `http://127.0.0.1:8092/?attempt=${attempt}&tab=diagnosis#training`,
  {waitUntil: "domcontentloaded", timeout: 30000},
);
await page.waitForSelector(".diagnosis-report", {timeout: 30000});
await page.waitForTimeout(600);

console.log(JSON.stringify({
  taskSpaceId: task.spaceId,
  url: await page.url(),
  title: await page.title(),
  state: await page.evaluate(() => ({
    viewport: {width: innerWidth, height: innerHeight},
    documentWidth: document.documentElement.scrollWidth,
    reportVersion: document.querySelector(".diagnosis-report-meta")?.textContent?.trim(),
    gateCards: [...document.querySelectorAll(".diagnosis-gate-card")].map(
      (node) => node.textContent?.replace(/\s+/g, " ").trim(),
    ),
    buttons: [...document.querySelectorAll("button")].map((node) => ({
      text: node.textContent?.replace(/\s+/g, " ").trim(),
      disabled: node.disabled,
      className: node.className,
    })).filter((item) => item.text),
    issues: window.__qaIssues || [],
  })),
  snapshot: await page.snapshot({scope: "full_page"}),
}, null, 2));
