import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('<home>/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');

const pageName = process.argv[2] || 'forge-runway.html';
const query = process.argv[3] || '';
const width = Number(process.argv[4] || 1440);
const height = Number(process.argv[5] || 1000);
const outName = process.argv[6] || 'check.png';
const outDir = path.resolve('design/inference-training-redesign-2026-11-04/review/final');
await mkdir(outDir, { recursive: true });

const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-extensions'],
});
const context = await browser.newContext({
  viewport: { width, height },
  deviceScaleFactor: 1,
  locale: 'zh-CN',
  colorScheme: 'light',
});
const page = await context.newPage();
const errors = [];
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(`console: ${message.text()}`);
});
page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
await page.goto(`http://127.0.0.1:4321/${pageName}${query}`, { waitUntil: 'networkidle' });
await page.waitForTimeout(350);
const metrics = await page.evaluate(() => ({
  scrollWidth: document.documentElement.scrollWidth,
  clientWidth: document.documentElement.clientWidth,
  bodyWidth: document.body.getBoundingClientRect().width,
  h1: document.querySelector('h1')?.textContent?.trim() || '',
  buttons: [...document.querySelectorAll('button')].filter((button) => {
    const rect = button.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && (rect.width < 40 || rect.height < 40);
  }).slice(0, 12).map((button) => ({
    text: button.textContent?.trim().slice(0, 30) || '',
    width: Math.round(button.getBoundingClientRect().width),
    height: Math.round(button.getBoundingClientRect().height),
  })),
}));
await page.screenshot({ path: path.join(outDir, outName), fullPage: true, animations: 'disabled' });
console.log(JSON.stringify({ url: page.url(), metrics, errors }, null, 2));
await browser.close();
