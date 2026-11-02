const task = await taskSpace("ModelForge model redesign prototypes 20261103");
console.log({ spaceId: task.spaceId, pages: (await task.pages()).map((page) => page.label) });

const page = task.page("p1");
await page.goto("http://127.0.0.1:4312/modelforge-models-redesign/index.html#c");
await page.waitForSelector(".studio-layout");
await page.cdp("Emulation.setDeviceMetricsOverride", {
  width: 1440,
  height: 1000,
  deviceScaleFactor: 1,
  mobile: false,
});

const observation = await page.evaluate(() => ({
  title: document.title,
  hash: location.hash,
  bodyWidth: document.body.scrollWidth,
  viewportWidth: document.documentElement.clientWidth,
  bodyHeight: document.body.scrollHeight,
  selectedVariant: document.querySelector(".variant-tab[aria-selected='true']")?.textContent?.trim(),
  selectedFamily: document.querySelector(".family-index-item.selected strong")?.textContent?.trim(),
  selectedVersion: document.querySelector(".version-picker-large .active span")?.textContent?.trim(),
  errors: [...document.querySelectorAll(".empty-result strong")].map((node) => node.textContent?.trim()),
}));

const screenshot = await page.screenshot({
  path: "<project-root>/designs/modelforge-models-redesign/review/c-desktop-v1.png",
});

console.log({ observation, screenshot });
console.log(await page.snapshot());
