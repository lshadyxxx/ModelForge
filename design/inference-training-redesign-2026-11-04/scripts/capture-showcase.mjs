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
let phase = 'init';

function mark(value) {
  phase = value;
}

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
    if (message.type() === 'error') errors.push({ phase, kind: 'console', message: message.text(), url: page.url() });
  });
  page.on('pageerror', (error) => errors.push({ phase, kind: 'pageerror', message: error.message, stack: error.stack, url: page.url() }));
  return { context, page };
}

async function open(page, file, query = '') {
  mark(`${file}${query}`);
  await page.goto(`${base}/${file}${query}`, { waitUntil: 'networkidle' });
  await page.evaluate(() => {
    const dock = document.querySelector('.state-dock');
    if (dock) dock.style.display = 'none';
  });
  await page.waitForTimeout(180);
}

async function shot(page, dir, name, fullPage = false) {
  await page.screenshot({ path: path.join(dir, name), fullPage, animations: 'disabled' });
}

async function interactiveInference(page, file) {
  mark(`${file} inference`);
  await open(page, file, '?scenario=success');
  const openInference = page.locator('[data-action="open-inference"]:visible, [data-action="open-serving"]:visible').first();
  await openInference.click();
  const prompt = page.locator('.prompt:visible, .prompt-chip:visible').first();
  await prompt.waitFor({ state: 'visible', timeout: 4000 });
  await prompt.click();
  await page.waitForTimeout(1600);
}

{
  const { context, page } = await pageAt(1440, 1000);
  await open(page, 'index.html');
  await shot(page, showcaseDir, '00-review-index-1440.png');
  await context.close();
}

{
  const { context, page } = await pageAt(390, 844);
  await open(page, 'index.html');
  await shot(page, showcaseDir, '00-review-index-390.png', true);
  await context.close();
}

{
  const { context, page } = await pageAt(1440, 1000);
  for (const scenario of ['running', 'success', 'waiting', 'loading', 'empty', 'error']) {
    await open(page, 'forge-runway.html', scenario === 'running' ? '' : `?scenario=${scenario}`);
    await shot(page, stateDir, `f1-${scenario}-1440.png`);
  }
  await open(page, 'forge-runway.html');
  await shot(page, showcaseDir, '01-f1-runway-running-1440.png');
  await open(page, 'forge-runway.html', '?scenario=success');
  await shot(page, showcaseDir, '02-f1-runway-success-1440.png');
  await open(page, 'forge-runway.html', '?view=create&step=4');
  await shot(page, showcaseDir, '03-f1-runway-create-1440.png');
  await interactiveInference(page, 'forge-runway.html');
  await shot(page, showcaseDir, '04-f1-runway-inference-1440.png');
  await context.close();
}

{
  const { context, page } = await pageAt(390, 844);
  await open(page, 'forge-runway.html', '?scenario=success');
  await shot(page, showcaseDir, '05-f1-runway-mobile-390.png');
  await shot(page, showcaseDir, '05-f1-runway-mobile-full-390.png', true);
  await context.close();
}

{
  const { context, page } = await pageAt(1440, 1000);
  for (const scenario of ['running', 'success', 'waiting', 'loading', 'empty', 'error']) {
    await open(page, 'signal-deck.html', scenario === 'running' ? '' : `?scenario=${scenario}`);
    await shot(page, stateDir, `f2-${scenario}-1440.png`);
  }
  await open(page, 'signal-deck.html');
  await shot(page, showcaseDir, '01-f2-signal-running-1440.png');
  await open(page, 'signal-deck.html', '?scenario=success');
  await shot(page, showcaseDir, '02-f2-signal-success-1440.png');
  await open(page, 'signal-deck.html');
  await page.locator('[data-action="open-create"]').first().click();
  for (let i = 0; i < 3; i += 1) await page.locator('[data-action="drawer-next"]').click();
  await shot(page, showcaseDir, '03-f2-signal-create-1440.png');
  await interactiveInference(page, 'signal-deck.html');
  await shot(page, showcaseDir, '04-f2-signal-inference-1440.png');
  await context.close();
}

{
  const { context, page } = await pageAt(390, 844);
  await open(page, 'signal-deck.html', '?scenario=success');
  await shot(page, showcaseDir, '05-f2-signal-mobile-390.png');
  await shot(page, showcaseDir, '05-f2-signal-mobile-full-390.png', true);
  await context.close();
}

{
  const { context, page } = await pageAt(1440, 1000);
  for (const [name, query] of [
    ['running', ''],
    ['success', '?scenario=success&view=artifacts'],
    ['waiting', '?scenario=waiting'],
    ['loading', '?scenario=loading'],
    ['empty', '?scenario=empty'],
    ['error', '?scenario=error'],
    ['trial_error', '?scenario=trial_error&view=inference'],
  ]) {
    await open(page, 'forge-bench.html', query);
    await shot(page, stateDir, `f3-${name}-1440.png`);
  }
  await open(page, 'forge-bench.html');
  await shot(page, showcaseDir, '01-f3-bench-running-1440.png');
  await open(page, 'forge-bench.html', '?scenario=success&view=artifacts');
  await shot(page, showcaseDir, '02-f3-bench-success-1440.png');
  await open(page, 'forge-bench.html', '?view=create&step=4');
  await shot(page, showcaseDir, '03-f3-bench-create-1440.png');
  await interactiveInference(page, 'forge-bench.html');
  await shot(page, showcaseDir, '04-f3-bench-inference-1440.png');
  await context.close();
}

{
  const { context, page } = await pageAt(390, 844);
  await open(page, 'forge-bench.html', '?scenario=success&view=artifacts');
  await shot(page, showcaseDir, '05-f3-bench-mobile-390.png');
  await shot(page, showcaseDir, '05-f3-bench-mobile-full-390.png', true);
  await context.close();
}

await browser.close();
console.log(JSON.stringify({ showcaseDir, stateDir, errors }, null, 2));
if (errors.length) process.exitCode = 1;
