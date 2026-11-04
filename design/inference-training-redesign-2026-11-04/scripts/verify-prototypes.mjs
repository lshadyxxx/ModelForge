import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('<home>/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');

const base = 'http://127.0.0.1:4321';
const results = [];
const consoleErrors = [];

const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-extensions'],
});

async function newPage(width = 1440, height = 1000) {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 1,
    locale: 'zh-CN',
    colorScheme: 'light',
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(`console: ${message.text()}`);
  });
  page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`));
  return { context, page };
}

async function goto(page, file, query = '') {
  await page.goto(`${base}/${file}${query}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(180);
}

async function visible(locator, timeout = 4000) {
  await locator.waitFor({ state: 'visible', timeout });
}

async function test(name, fn) {
  const started = Date.now();
  try {
    await fn();
    results.push({ name, ok: true, ms: Date.now() - started });
  } catch (error) {
    results.push({ name, ok: false, ms: Date.now() - started, error: error.message });
  }
}

async function layoutSweep() {
  const widths = [1440, 1024, 768, 390];
  const cases = [
    ['forge-runway.html', ''],
    ['forge-runway.html', '?scenario=success'],
    ['forge-runway.html', '?scenario=empty'],
    ['signal-deck.html', ''],
    ['signal-deck.html', '?scenario=success'],
    ['signal-deck.html', '?scenario=error'],
    ['forge-bench.html', ''],
    ['forge-bench.html', '?scenario=success'],
    ['forge-bench.html', '?scenario=error'],
    ['forge-bench.html', '?view=create&step=4'],
  ];

  for (const width of widths) {
    const { context, page } = await newPage(width, width === 390 ? 844 : 1000);
    for (const [file, query] of cases) {
      await goto(page, file, query);
      const metrics = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        h1Count: document.querySelectorAll('h1').length,
        h1: document.querySelector('h1')?.textContent?.trim() || '',
      }));
      assert.equal(metrics.scrollWidth, metrics.clientWidth, `${file}${query} @${width} has horizontal overflow`);
      assert.equal(metrics.h1Count, 1, `${file}${query} @${width} should have exactly one h1`);
      assert.ok(metrics.h1, `${file}${query} @${width} has no h1`);
    }
    await context.close();
  }
}

await test('layout sweep: 1440 / 1024 / 768 / 390, no overflow, exactly one H1', layoutSweep);

await test('F1: create → validate → waiting → bind → running', async () => {
  const { context, page } = await newPage();
  await goto(page, 'forge-runway.html');
  await page.locator('[data-action="new-training"]').first().click();
  await visible(page.locator('#task-name'));
  await page.locator('#task-name').fill('');
  await page.locator('[data-action="wizard-next"]').click();
  await visible(page.locator('#form-error'));
  await page.locator('#task-name').fill('客服意图 LoRA · 验收测试');
  await page.locator('[data-action="wizard-next"]').click();
  await page.locator('[data-action="wizard-next"]').click();
  await page.locator('[data-action="wizard-next"]').click();
  await page.locator('[data-action="wizard-submit"]').click();
  await visible(page.locator('#action-dialog'));
  await page.locator('[data-action="confirm-submit"]').click();
  await visible(page.locator('[data-action="bind-instance"]').first(), 5000);
  await page.locator('[data-action="bind-instance"]').first().click();
  await visible(page.locator('#bind-instance'));
  await page.locator('[data-action="confirm-bind"]').click();
  await page.locator('#bind-instance').fill('u-4090-02-7fca');
  await page.locator('#bind-ack').check();
  await page.locator('[data-action="confirm-bind"]').click();
  await visible(page.locator('[data-action="request-cancel"]').first(), 5000);
  assert.match(await page.locator('body').innerText(), /训练中|step 80/);
  await context.close();
});

await test('F1: success artifact → inference chat → cleanup dialog', async () => {
  const { context, page } = await newPage();
  await goto(page, 'forge-runway.html', '?scenario=success');
  await page.locator('[data-action="open-serving"]').first().click();
  await visible(page.locator('.prompt-chip').first());
  await page.locator('.prompt-chip').first().click();
  await visible(page.locator('.message.assistant'));
  await page.waitForFunction(() => (document.querySelector('.message.assistant p')?.textContent || '').length > 40, null, { timeout: 5000 });
  await page.locator('[data-action="stop-inference"]').click();
  await visible(page.locator('#action-dialog'));
  assert.match(await page.locator('#action-dialog').innerText(), /结束.*回收|删除独立推理实例/);
  await page.locator('[data-action="close-dialog"]').click();
  await context.close();
});

await test('F1: log filter + failure state', async () => {
  const { context, page } = await newPage();
  await goto(page, 'forge-runway.html', '?view=detail&tab=logs');
  await visible(page.locator('#log-search'));
  await page.locator('#log-search').fill('step 80');
  await page.waitForTimeout(250);
  assert.equal(await page.locator('.log-line').count(), 1);
  await page.locator('#log-level').selectOption('ERROR');
  await page.waitForTimeout(250);
  assert.equal(await page.locator('.log-line').count(), 0);
  await goto(page, 'forge-runway.html', '?scenario=error');
  await visible(page.locator('.error-board'));
  assert.match(await page.locator('.error-board').innerText(), /Attempt #7/);
  await context.close();
});

await test('F2: create drawer → waiting → bind → running', async () => {
  const { context, page } = await newPage();
  await goto(page, 'signal-deck.html');
  await page.locator('[data-action="open-create"]').first().click();
  await visible(page.locator('.drawer'));
  for (let i = 0; i < 3; i += 1) await page.locator('[data-action="drawer-next"]').click();
  await visible(page.locator('[data-action="drawer-submit"]'));
  await page.locator('[data-action="drawer-submit"]').click();
  await visible(page.locator('#action-dialog'));
  await page.locator('[data-action="confirm-create"]').click();
  await visible(page.locator('[data-action="bind-instance"]').first(), 4000);
  await page.locator('[data-action="bind-instance"]').first().click();
  await visible(page.locator('#bind-instance'));
  await page.locator('#bind-instance').fill('u-4090-02-7fca');
  await page.locator('#bind-ack').check();
  await page.locator('[data-action="confirm-bind"]').click();
  await visible(page.locator('.chart-panel'), 4000);
  await context.close();
});

await test('F2: success artifact → inference chat', async () => {
  const { context, page } = await newPage();
  await goto(page, 'signal-deck.html', '?scenario=success');
  assert.match(await page.locator('.tab.active').innerText(), /产物门禁/);
  await page.locator('[data-action="open-inference"]').last().click();
  await visible(page.locator('.prompt').first());
  await page.locator('.prompt').first().click();
  await visible(page.locator('.message.assistant'));
  await page.waitForFunction(() => (document.querySelector('.message.assistant p')?.textContent || '').length > 40, null, { timeout: 5000 });
  await context.close();
});

await test('F2: log filter + waiting/error headers stay consistent', async () => {
  const { context, page } = await newPage();
  await goto(page, 'signal-deck.html', '?view=logs');
  await page.locator('#log-query').fill('step 80');
  await page.waitForTimeout(220);
  assert.equal(await page.locator('.log-row').count(), 1);
  await page.locator('#log-level').selectOption('ERROR');
  await page.waitForTimeout(220);
  assert.equal(await page.locator('.log-row').count(), 0);
  await goto(page, 'signal-deck.html', '?scenario=error');
  assert.match(await page.locator('.workspace-head').innerText(), /A#7/);
  assert.match(await page.locator('.error-head').innerText(), /A#7/);
  await goto(page, 'signal-deck.html', '?scenario=waiting');
  assert.match(await page.locator('.workspace-head').innerText(), /A#2/);
  assert.match(await page.locator('.waiting-head').innerText(), /A#2/);
  await context.close();
});

await test('F3: create validation → waiting → bind → running', async () => {
  const { context, page } = await newPage();
  await goto(page, 'forge-bench.html', '?view=create');
  await page.locator('#task-name').fill('');
  await page.locator('[data-action="wizard-next"]').click();
  await visible(page.locator('#form-error'));
  await page.locator('#task-name').fill('客服意图 LoRA · 验收测试');
  for (let i = 0; i < 3; i += 1) await page.locator('[data-action="wizard-next"]').click();
  await page.locator('[data-action="wizard-submit"]').click();
  await visible(page.locator('#action-dialog'));
  await page.locator('[data-action="confirm-create"]').click();
  await visible(page.locator('[data-action="request-bind"]').first(), 5000);
  await page.locator('[data-action="request-bind"]').first().click();
  await visible(page.locator('#bind-instance'));
  await page.locator('#bind-instance').fill('u-4090-02-7fca');
  await page.locator('#bind-ack').check();
  await page.locator('[data-action="confirm-bind"]').click();
  await visible(page.locator('.chart-wrap'), 5000);
  await context.close();
});

await test('F3: artifact → inference → stream stop', async () => {
  const { context, page } = await newPage();
  await goto(page, 'forge-bench.html', '?scenario=success&view=artifacts');
  await page.locator('[data-action="open-inference"]:visible').first().click();
  await visible(page.locator('.prompt').first());
  await page.locator('.prompt').first().click();
  await visible(page.locator('[data-action="stop-generation"]'));
  await page.waitForTimeout(260);
  await page.locator('[data-action="stop-generation"]').click();
  await page.waitForTimeout(120);
  assert.match(await page.locator('#chat-stream').innerText(), /已停止生成/);
  await context.close();
});

await test('F3: cancel + failed-instance cleanup dialogs + queue close', async () => {
  const { context, page } = await newPage(390, 844);
  await goto(page, 'forge-bench.html');
  await page.locator('[data-action="toggle-queue"]').click();
  await visible(page.locator('.queue-close'));
  await page.locator('[data-action="close-queue"]').click();
  await page.locator('[data-action="request-cancel"]').click();
  await visible(page.locator('#action-dialog'));
  await page.locator('[data-action="confirm-cancel"]').click();
  await page.waitForTimeout(120);
  await goto(page, 'forge-bench.html', '?scenario=error');
  await page.locator('[data-action="request-cleanup"]').click();
  await visible(page.locator('#action-dialog'));
  assert.match(await page.locator('#action-dialog').innerText(), /回收.*实例|实例.*回收/);
  await page.locator('[data-action="close-dialog"]').click();
  await context.close();
});

await browser.close();

console.log(JSON.stringify({ results, consoleErrors }, null, 2));
const failed = results.filter((result) => !result.ok);
if (failed.length || consoleErrors.length) process.exitCode = 1;
