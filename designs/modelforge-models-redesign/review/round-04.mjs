const task = await taskSpace(33);
const page = task.page("p1");

const drawerDirectory = await page.evaluate(() => ({
  open: Boolean(document.querySelector(".source-drawer")),
  selectedSource: document.querySelector(".source-choice.selected strong")?.textContent?.trim(),
  hasDirectoryInput: Boolean(document.querySelector(".source-drawer input[type='file'][webkitdirectory]")),
  submitText: document.querySelector(".source-drawer button[type='submit']")?.textContent?.trim(),
}));

await page.keyboard.press("Escape");
await page.waitForFunction(() => !document.querySelector(".source-drawer"));

await page.fill("#model-search", "Qwen3");
await page.waitForFunction(() => document.querySelectorAll(".family-index-item").length === 3);
const searchResult = await page.evaluate(() => ({
  count: document.querySelectorAll(".family-index-item").length,
  names: [...document.querySelectorAll(".family-index-item strong")].map((node) => node.textContent?.trim()),
  bodyWidth: document.body.scrollWidth,
  viewportWidth: document.documentElement.clientWidth,
}));

await page.fill("#model-search", "");
await page.selectOption("#model-filter", "errors");
await page.waitForFunction(() => document.querySelectorAll(".family-index-item").length === 1);
const errorFilter = await page.evaluate(() => ({
  count: document.querySelectorAll(".family-index-item").length,
  name: document.querySelector(".family-index-item strong")?.textContent?.trim(),
  state: document.querySelector(".family-index-item .badge")?.textContent?.trim(),
}));

await page.selectOption("#model-filter", "all");
await page.click(".family-index-item[data-id='MDL-7A2F']");
await page.waitForSelector(".version-picker-large button[data-id='905cc3a7-c891-436f-8958-1bb4cd6bdc21']");
await page.click(".version-picker-large button[data-id='905cc3a7-c891-436f-8958-1bb4cd6bdc21']");
await page.waitForFunction(() => document.querySelector(".workbench-head h2")?.textContent?.includes("v2"));
const importingVersion = await page.evaluate(() => ({
  heading: document.querySelector(".workbench-head h2")?.textContent?.trim(),
  importBlock: Boolean(document.querySelector(".import-progress-block")),
  progress: document.querySelector(".progress-track i")?.getAttribute("style"),
  currentPath: document.querySelector(".import-progress-block code")?.textContent?.trim(),
  compatibility: document.querySelector(".rail-heading .badge")?.textContent?.trim(),
}));

await page.click("button[data-action='detail-tab'][data-tab='files']");
await page.waitForSelector(".file-list");
const filesView = await page.evaluate(() => ({
  fileRows: document.querySelectorAll(".file-row").length,
  pendingFiles: document.querySelectorAll(".file-row.is-pending").length,
  hashes: [...document.querySelectorAll(".file-hash code")].slice(0, 2).map((node) => node.textContent?.trim()),
}));

await page.cdp("Emulation.setDeviceMetricsOverride", {
  width: 390,
  height: 844,
  deviceScaleFactor: 1,
  mobile: true,
});

const inspectMobile = () => page.evaluate(() => ({
  hash: location.hash,
  variant: document.querySelector(".variant-tab[aria-selected='true'] strong")?.textContent?.trim(),
  pageTitle: document.querySelector("main h1")?.textContent?.trim(),
  viewportWidth: document.documentElement.clientWidth,
  bodyWidth: document.body.scrollWidth,
  horizontalOverflow: document.body.scrollWidth > document.documentElement.clientWidth,
  visibleVariantTabs: [...document.querySelectorAll(".variant-tab")].every((node) => {
    const box = node.getBoundingClientRect();
    return box.left >= 0 && box.right <= document.documentElement.clientWidth + 1;
  }),
}));

await page.click(".variant-tab[data-variant='c']");
await page.waitForSelector(".studio-layout");
const mobileC = await inspectMobile();

await page.click(".variant-tab[data-variant='a']");
await page.waitForSelector(".registry-layout");
const mobileA = await inspectMobile();

await page.click(".variant-tab[data-variant='b']");
await page.waitForSelector(".ledger-list");
const mobileB = await inspectMobile();

await page.click(".variant-tab[data-variant='c']");
await page.waitForSelector(".studio-layout");
await page.click("button.primary[data-action='open-drawer']");
await page.waitForSelector(".source-drawer");
const mobileDrawer = await page.evaluate(() => {
  const drawer = document.querySelector(".source-drawer");
  const box = drawer?.getBoundingClientRect();
  return {
    open: Boolean(drawer),
    left: box?.left,
    right: box?.right,
    width: box?.width,
    viewportWidth: document.documentElement.clientWidth,
    bodyWidth: document.body.scrollWidth,
  };
});
await page.keyboard.press("Escape");
await page.waitForFunction(() => !document.querySelector(".source-drawer"));

console.log(JSON.stringify({
  drawerDirectory,
  searchResult,
  errorFilter,
  importingVersion,
  filesView,
  mobileC,
  mobileA,
  mobileB,
  mobileDrawer,
}, null, 2));
