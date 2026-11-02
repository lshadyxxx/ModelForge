const task = await taskSpace(33);
const page = task.page("p1");
await page.goto("http://127.0.0.1:4312/modelforge-models-redesign/index.html#c");
await page.waitForSelector(".studio-layout");
await page.cdp("Emulation.setDeviceMetricsOverride", {
  width: 1440,
  height: 1000,
  deviceScaleFactor: 1,
  mobile: false,
});

const inspect = () => page.evaluate(() => ({
  hash: location.hash,
  variant: document.querySelector(".variant-tab[aria-selected='true'] strong")?.textContent?.trim(),
  pageTitle: document.querySelector("main h1")?.textContent?.trim(),
  viewportWidth: document.documentElement.clientWidth,
  bodyWidth: document.body.scrollWidth,
  horizontalOverflow: document.body.scrollWidth > document.documentElement.clientWidth,
  selectedFamily: document.querySelector(".model-table-row.selected .model-copy strong, .family-index-item.selected strong")?.textContent?.trim(),
  selectedVersion: document.querySelector(".version-chip.active, .version-picker-large button.active span")?.textContent?.trim(),
  familyCount: document.querySelectorAll(".model-table-row, .family-index-item, .ledger-entry").length,
  errorText: [...document.querySelectorAll("[role='alert'], .error-message")].map((node) => node.textContent?.trim()).filter(Boolean),
}));

const desktopC = await inspect();

await page.click("loc=role:tab[name*='模型资产台']");
await page.waitForSelector(".registry-layout");
const desktopA = await inspect();

await page.click("loc=role:tab[name*='来源血缘账本']");
await page.waitForSelector(".ledger-list");
const desktopB = await inspect();

await page.click("loc=role:tab[name*='验证工作室']");
await page.waitForSelector(".studio-layout");
await page.click("button.primary[data-action='open-drawer']");
await page.waitForSelector(".source-drawer");
const drawerModelScope = await page.evaluate(() => ({
  open: Boolean(document.querySelector(".source-drawer")),
  selectedSource: document.querySelector(".source-choice.selected strong")?.textContent?.trim(),
  fieldLabels: [...document.querySelectorAll(".source-drawer .form-grid label")].map((node) => node.firstChild?.textContent?.trim()).filter(Boolean),
  activeElement: document.activeElement?.getAttribute("aria-label") || document.activeElement?.textContent?.trim()?.slice(0, 40),
}));

await page.click("loc=role:button[name*='上传完整目录']");
await page.waitForSelector(".source-drawer input[type='file']");
const drawerDirectory = await page.evaluate(() => ({
  selectedSource: document.querySelector(".source-choice.selected strong")?.textContent?.trim(),
  hasDirectoryInput: Boolean(document.querySelector(".source-drawer input[type='file'][webkitdirectory]")),
  submitText: document.querySelector(".source-drawer button[type='submit']")?.textContent?.trim(),
}));

await page.press("body", "Escape");
await page.waitForFunction(() => !document.querySelector(".source-drawer"));

await page.fill("#model-search", "Qwen3");
await page.waitForFunction(() => document.querySelectorAll(".family-index-item").length === 3);
const searchResult = await page.evaluate(() => ({
  count: document.querySelectorAll(".family-index-item").length,
  names: [...document.querySelectorAll(".family-index-item strong")].map((node) => node.textContent?.trim()),
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

await page.click("loc=role:tab[name*='验证工作室']");
await page.waitForSelector(".studio-layout");
const mobileC = await inspect();

await page.click("loc=role:tab[name*='模型资产台']");
await page.waitForSelector(".registry-layout");
const mobileA = await inspect();

await page.click("loc=role:tab[name*='来源血缘账本']");
await page.waitForSelector(".ledger-list");
const mobileB = await inspect();

await page.click("loc=role:tab[name*='验证工作室']");
await page.waitForSelector(".studio-layout");

console.log(JSON.stringify({
  desktopC,
  desktopA,
  desktopB,
  drawerModelScope,
  drawerDirectory,
  searchResult,
  errorFilter,
  importingVersion,
  filesView,
  mobileC,
  mobileA,
  mobileB,
}, null, 2));

console.log(await page.snapshot({ scope: "full_page" }));
