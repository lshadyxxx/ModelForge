const task = await taskSpace(142);
const page = task.page("p1");

await page.cdp("Emulation.setDeviceMetricsOverride", {
  width: 429,
  height: 883,
  deviceScaleFactor: 1,
  mobile: false,
  scale: 1,
  screenWidth: 429,
  screenHeight: 883,
});
await page.reload({waitUntil: "domcontentloaded", timeout: 30000});
await page.waitForSelector(".diagnosis-report", {timeout: 30000});
await page.waitForTimeout(250);

const overflow = await page.evaluate(() => {
  const viewport = innerWidth;
  return [...document.querySelectorAll("body *")]
    .map((node) => {
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return {
        tag: node.tagName.toLowerCase(),
        className: typeof node.className === "string" ? node.className : "",
        id: node.id,
        text: node.textContent?.replace(/\s+/g, " ").trim().slice(0, 100),
        left: Math.round(rect.left * 10) / 10,
        right: Math.round(rect.right * 10) / 10,
        width: Math.round(rect.width * 10) / 10,
        overflowX: style.overflowX,
        clipboard: style.clipPath,
        position: style.position,
      };
    })
    .filter((item) => item.right > viewport + 0.5 || item.left < -0.5)
    .slice(0, 80);
});

console.log(JSON.stringify({
  taskSpaceId: task.spaceId,
  viewport: await page.evaluate(() => ({
    width: innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth,
  })),
  overflow,
}, null, 2));
