import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("<home>/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
const url = process.argv[2] || "http://127.0.0.1:4322/conversation-lab.html?scenario=ready";
const viewportWidth = Number(process.argv[3] || 390);
const page = await browser.newPage({ viewport: { width: viewportWidth, height: 844 } });
await page.goto(url, { waitUntil: "networkidle" });
const report = await page.evaluate(() => {
  const width = document.documentElement.clientWidth;
  const offenders = [...document.querySelectorAll("*")].map((node) => {
    const rect = node.getBoundingClientRect();
    return { tag: node.tagName, cls: node.className?.toString().slice(0, 120), left: rect.left, right: rect.right, width: rect.width, text: node.textContent?.trim().slice(0, 50) };
  }).filter((item) => item.right > width + 1 || item.left < -1).sort((a, b) => b.right - a.right).slice(0, 30);
  return { scrollWidth: document.documentElement.scrollWidth, clientWidth: width, offenders };
});
const detail = await page.evaluate(() => {
  const nodes = [...document.querySelectorAll(".v3-topbar, .v3-topbar > *, .v3-top-right > *, .v3-lifecycle, .v3-lifecycle > *")];
  return nodes.map((node) => {
    const rect = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    return { tag: node.tagName, cls: node.className, display: style.display, flex: style.flex, width: rect.width, left: rect.left, right: rect.right, text: node.textContent?.trim().slice(0, 24) };
  });
});
const actions = await page.evaluate(() => [...document.querySelectorAll(".v1-page-actions button, .v2-top-actions button, .v3-top-right button")].map((button) => {
  const icon = button.querySelector(".icon");
  const svg = button.querySelector("svg");
  const rect = button.getBoundingClientRect();
  return {
    text: button.textContent.trim(),
    html: button.innerHTML.slice(0, 180),
    width: rect.width,
    display: getComputedStyle(button).display,
    iconDisplay: icon ? getComputedStyle(icon).display : null,
    svgDisplay: svg ? getComputedStyle(svg).display : null,
    svgWidth: svg?.getBoundingClientRect().width || 0,
    color: getComputedStyle(button).color,
  };
}));
const layout = await page.evaluate(() => [...document.querySelectorAll(".v3-shell, .v3-shell > *, .v3-stage, .v3-console, .v3-console > *, .v1-main, .v1-desk, .v1-chat")].map((node) => {
  const rect = node.getBoundingClientRect();
  const style = getComputedStyle(node);
  return { tag: node.tagName, cls: node.className, top: rect.top, bottom: rect.bottom, height: rect.height, rows: style.gridTemplateRows, minHeight: style.minHeight, heightStyle: style.height, display: style.display };
}));
console.log(JSON.stringify({ ...report, detail, actions, layout }, null, 2));
await browser.close();
