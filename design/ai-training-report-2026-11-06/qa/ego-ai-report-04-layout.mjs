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
await page.waitForTimeout(200);

const chain = await page.evaluate(() => {
  const target = document.querySelector(".diagnosis-report");
  const rows = [];
  let node = target;
  while (node && node !== document.documentElement) {
    const rect = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    rows.push({
      tag: node.tagName.toLowerCase(),
      className: typeof node.className === "string" ? node.className : "",
      width: Math.round(rect.width * 10) / 10,
      left: Math.round(rect.left * 10) / 10,
      right: Math.round(rect.right * 10) / 10,
      clientWidth: node.clientWidth,
      scrollWidth: node.scrollWidth,
      display: style.display,
      gridTemplateColumns: style.gridTemplateColumns,
      minWidth: style.minWidth,
      widthStyle: style.width,
      padding: style.padding,
      margin: style.margin,
      overflowX: style.overflowX,
    });
    node = node.parentElement;
  }
  return rows;
});

console.log(JSON.stringify({taskSpaceId: task.spaceId, chain}, null, 2));
