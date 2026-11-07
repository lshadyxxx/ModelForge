const root = "<project-root>/design/ai-training-report-2026-11-06";
const task = await taskSpace(106);
const page = task.page("p1");
await page.cdp("Emulation.setDeviceMetricsOverride", {
  width: 1440,
  height: 1000,
  deviceScaleFactor: 1,
  mobile: false,
  screenWidth: 1440,
  screenHeight: 1000,
});
await page.goto(`file:///${root}/option-a.html?view=report`, {waitUntil: "load", timeout: 30000});
await page.waitForSelector("details.finding", {state: "visible", timeout: 15000});
const leafText = await page.evaluate(() =>
  [...document.querySelectorAll("body *")]
    .filter((element) => element.children.length === 0)
    .map((element) => {
      const style = getComputedStyle(element);
      const text = element.textContent.trim().replace(/\s+/g, " ");
      return {
        tag: element.tagName.toLowerCase(),
        className: typeof element.className === "string" ? element.className : "",
        text: text.slice(0, 90),
        fontSize: parseFloat(style.fontSize),
        color: style.color,
        background: style.backgroundColor,
        visible: element.getClientRects().length > 0 && style.visibility !== "hidden" && style.display !== "none",
      };
    })
    .filter((item) => item.visible && item.text && item.fontSize < 12)
    .slice(0, 120),
);
console.log(JSON.stringify(leafText, null, 2));
