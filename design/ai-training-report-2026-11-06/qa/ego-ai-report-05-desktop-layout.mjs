const task = await taskSpace(142);
const page = task.page("p1");
const attempt = "fbc8a03d-27e3-4ef2-8253-c23ac8a599ac";

await page.cdp("Emulation.setDeviceMetricsOverride", {
  width: 1584,
  height: 1131,
  deviceScaleFactor: 1,
  mobile: false,
  scale: 1,
  screenWidth: 1584,
  screenHeight: 1131,
});
await page.goto(
  `http://127.0.0.1:8092/?attempt=${attempt}&tab=diagnosis#training`,
  {waitUntil: "domcontentloaded", timeout: 30000},
);
await page.waitForSelector(".diagnosis-report", {timeout: 30000});
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(300);

const report = await page.evaluate(() => {
  const selectors = [
    ".app-shell",
    ".workspace",
    "main",
    ".training-detail-page",
    ".training-detail-content",
    ".diagnosis-page",
    ".diagnosis-report",
    ".diagnosis-conclusion",
    ".diagnosis-gate-summary",
  ];
  return {
    scroller: {
      scrollX,
      innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
    },
    nodes: selectors.map((selector) => {
      const node = document.querySelector(selector);
      if (!node) return {selector, missing: true};
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return {
        selector,
        left: Math.round(rect.left * 10) / 10,
        right: Math.round(rect.right * 10) / 10,
        width: Math.round(rect.width * 10) / 10,
        scrollWidth: node.scrollWidth,
        clientWidth: node.clientWidth,
        overflowX: style.overflowX,
        gridTemplateColumns: style.gridTemplateColumns,
        minWidth: style.minWidth,
        padding: style.padding,
      };
    }),
  };
});

console.log(JSON.stringify({taskSpaceId: task.spaceId, report}, null, 2));
