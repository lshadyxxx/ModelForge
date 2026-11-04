import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('<home>/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');

const base = 'http://127.0.0.1:4321';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const showcaseDir = path.join(root, 'review/showcase');
const stateDir = path.join(root, 'review/states');
await mkdir(showcaseDir, { recursive: true });
await mkdir(stateDir, { recursive: true });

const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-extensions'],
});

const errors = [];

async function pageAt(width, height) {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 1,
    locale: 'zh-CN',
    colorScheme: 'light',
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push({ kind: 'console', message: message.text(), url: page.url() });
  });
  page.on('pageerror', (error) => errors.push({ kind: 'pageerror', message: error.message, url: page.url() }));
  return { context, page };
}

async function open(page, query = '') {
  await page.goto(`${base}/forge-relay.html${query}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(180);
}

async function shot(page, directory, name, fullPage = false) {
  await page.screenshot({ path: path.join(directory, name), fullPage, animations: 'disabled' });
}

{
  const { context, page } = await pageAt(1440, 1000);
  await page.goto(`${base}/index.html`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(180);
  await shot(page, showcaseDir, '00-review-index-1440.png');
  await context.close();
}

{
  const { context, page } = await pageAt(1440, 1000);
  for (const [name, query] of [
    ['running', ''],
    ['success', '?scenario=success'],
    ['waiting', '?scenario=waiting'],
    ['loading', '?scenario=loading'],
    ['empty', '?scenario=empty'],
    ['error', '?scenario=error'],
    ['trial_error', '?scenario=trial_error&view=inference'],
  ]) {
    await open(page, query);
    await shot(page, stateDir, `f4-${name}-1440.png`);
  }

  await open(page, '');
  await shot(page, showcaseDir, '01-f4-relay-running-1440.png');

  await open(page, '?scenario=success');
  await shot(page, showcaseDir, '02-f4-relay-success-1440.png');

  await open(page, '?scenario=success&view=artifacts');
  await shot(page, showcaseDir, '03-f4-relay-artifacts-1440.png');

  await open(page, '?view=create&step=4');
  await shot(page, showcaseDir, '04-f4-relay-create-1440.png');

  await open(page, '?scenario=success&view=inference');
  await page.locator('.prompt').first().click();
  await page.waitForTimeout(1600);
  await shot(page, showcaseDir, '05-f4-relay-inference-1440.png');
  await context.close();
}

{
  const { context, page } = await pageAt(390, 844);
  await open(page, '?scenario=success');
  await shot(page, showcaseDir, '06-f4-relay-mobile-390.png');
  await page.locator('.mobile-action').evaluate((node) => { node.style.display = 'none'; });
  await shot(page, showcaseDir, '06-f4-relay-mobile-full-390.png', true);
  await page.goto(`${base}/index.html`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(180);
  await shot(page, showcaseDir, '00-review-index-390.png', true);
  await context.close();
}

await browser.close();
console.log(JSON.stringify({ showcaseDir, stateDir, errors }, null, 2));
if (errors.length) process.exitCode = 1;
