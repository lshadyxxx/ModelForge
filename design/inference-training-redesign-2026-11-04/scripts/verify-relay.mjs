import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('<home>/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');

const base = 'http://127.0.0.1:4321';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
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

async function goto(page, query = '') {
  await page.goto(`${base}/forge-relay.html${query}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(180);
}

async function visible(locator, timeout = 5000) {
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

await test('layout sweep: 1440 / 1024 / 768 / 390, no overflow, one H1', async () => {
  const widths = [1440, 1024, 768, 390];
  const cases = [
    '',
    '?scenario=success',
    '?scenario=success&view=artifacts',
    '?scenario=success&view=inference',
    '?scenario=waiting',
    '?scenario=error',
    '?scenario=empty',
    '?view=create&step=4'
  ];
  for (const width of widths) {
    const { context, page } = await newPage(width, width === 390 ? 844 : 1000);
    for (const query of cases) {
      await goto(page, query);
      const metrics = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        h1Count: document.querySelectorAll('h1').length,
        h1: document.querySelector('h1')?.textContent?.trim() || '',
      }));
      assert.equal(metrics.scrollWidth, metrics.clientWidth, `${query || 'default'} @${width} has horizontal overflow`);
      assert.equal(metrics.h1Count, 1, `${query || 'default'} @${width} should have exactly one h1`);
      assert.ok(metrics.h1, `${query || 'default'} @${width} has no h1`);
    }
    await context.close();
  }
});

await test('merged success: receipt → artifact track → URL-restored inference → stop', async () => {
  const { context, page } = await newPage();
  await goto(page, '?scenario=success');
  await visible(page.locator('.acceptance-receipt'));
  assert.match(await page.locator('.acceptance-receipt').innerText(), /2 \/ 2/);
  assert.match(await page.locator('.acceptance-track').innerText(), /5 \/ 6 已确认/);
  await page.locator('.phase-node[data-step="3"]').click();
  await visible(page.locator('.release-board'));
  assert.match(await page.locator('.tab.active').innerText(), /产物/);
  await page.locator('[data-action="open-inference"]:visible').first().click();
  await visible(page.locator('.handoff-banner'));
  const url = new URL(page.url());
  assert.equal(url.searchParams.get('attempt'), '5bb29e33');
  assert.equal(url.searchParams.get('adapter'), 'adapter-best-06');
  assert.equal(url.searchParams.get('role'), 'best');
  assert.equal(url.searchParams.get('base'), 'Qwen3-0.6B-20261102-r1');
  await page.reload({ waitUntil: 'networkidle' });
  await visible(page.locator('.handoff-banner'));
  assert.match(await page.locator('.handoff-banner').innerText(), /attempt=5bb29e33/);
  await page.locator('.prompt').first().click();
  await visible(page.locator('[data-action="stop-generation"]'));
  await page.waitForTimeout(220);
  await page.locator('[data-action="stop-generation"]').click();
  assert.match(await page.locator('#chat-stream').innerText(), /已停止生成/);
  await page.locator('[data-action="request-stop"]').first().click();
  await visible(page.locator('#action-dialog'));
  assert.match(await page.locator('#action-dialog').innerText(), /结束|回收|实例/);
  await page.locator('[data-action="close-dialog"]').click();
  await context.close();
});

await test('create validation → waiting → bind → running', async () => {
  const { context, page } = await newPage();
  await goto(page, '?view=create');
  await page.locator('#task-name').fill('');
  await page.locator('[data-action="wizard-next"]').click();
  await visible(page.locator('#form-error'));
  await page.locator('#task-name').fill('客服意图 LoRA · 合流版验收');
  for (let i = 0; i < 3; i += 1) await page.locator('[data-action="wizard-next"]').click();
  await page.locator('[data-action="wizard-submit"]').click();
  await visible(page.locator('#action-dialog'));
  await page.locator('[data-action="confirm-create"]').click();
  await visible(page.locator('[data-action="request-bind"]').first(), 7000);
  assert.match(await page.locator('.acceptance-track').innerText(), /等待你绑定实例/);
  await page.locator('[data-action="request-bind"]').first().click();
  await visible(page.locator('#bind-instance'));
  await page.locator('#bind-instance').fill('u-4090-02-7fca');
  await page.locator('#bind-ack').check();
  await page.locator('[data-action="confirm-bind"]').click();
  await visible(page.locator('.chart-wrap'), 7000);
  assert.match(await page.locator('.acceptance-track').innerText(), /当前训练执行/);
  await context.close();
});

await test('empty workspace has no fabricated runs or gates', async () => {
  const { context, page } = await newPage();
  await goto(page, '?scenario=empty');
  assert.equal(await page.locator('.run-card').count(), 0);
  assert.equal((await page.locator('.count-badge').innerText()).trim(), '0');
  assert.match(await page.locator('.ledger').innerText(), /0 RUNS/);
  const gates = await page.locator('.gate-list').innerText();
  assert.equal((gates.match(/DONE/g) || []).length, 0);
  assert.match(gates, /没有运行/);
  await context.close();
});

await test('failed preflight is explicit and recoverable', async () => {
  const { context, page } = await newPage();
  await goto(page, '?scenario=error');
  assert.match(await page.locator('.acceptance-track').innerText(), /1 个阻断/);
  assert.match(await page.locator('.error-board').innerText(), /训练没有启动/);
  await page.locator('[data-action="request-cleanup"]').click();
  await visible(page.locator('#action-dialog'));
  assert.match(await page.locator('#action-dialog').innerText(), /回收|实例/);
  await page.locator('[data-action="close-dialog"]').click();
  await context.close();
});

await test('trial failure keeps training evidence but separates the held inference GPU', async () => {
  const { context, page } = await newPage();
  await goto(page, '?scenario=trial_error&view=inference');
  assert.match(await page.locator('.acceptance-track').innerText(), /推理阻断/);
  const gates = await page.locator('.gate-list').innerText();
  assert.match(gates, /Best \/ Final 产物/);
  assert.match(gates, /2 \/ 2 · SHA-256 PASS/);
  assert.match(gates, /训练资源回收/);
  assert.match(gates, /模型加载失败/);
  const resources = page.locator('.command-section').filter({ hasText: 'RESOURCE / 资源' });
  assert.match(await resources.innerText(), /trial-lease-c2a1 · held/);
  assert.match(await resources.innerText(), /推理 GPU 仍计费/);
  await context.close();
});

await test('mobile queue and fixed next action preserve the handoff', async () => {
  const { context, page } = await newPage(390, 844);
  await goto(page, '?scenario=success');
  await page.locator('[data-action="toggle-queue"]').click();
  await visible(page.locator('.queue-close'));
  await page.locator('[data-action="close-queue"]').click();
  await visible(page.locator('.mobile-action'));
  await page.locator('.mobile-action [data-action="open-inference"]').click();
  await visible(page.locator('.handoff-banner'));
  assert.match(await page.locator('.handoff-banner').innerText(), /A#6/);
  await context.close();
});

await test('review portal exposes F4 and switches its preview tabs', async () => {
  const { context, page } = await newPage();
  await page.goto(`${base}/index.html`, { waitUntil: 'networkidle' });
  assert.equal(await page.locator('.scheme').count(), 4);
  assert.match(await page.locator('#merged').innerText(), /RECOMMENDED TO BUILD/);
  await page.locator('#merged [data-shot*="artifacts"]').click();
  assert.match(await page.locator('#merged [data-preview]').getAttribute('src'), /03-f4-relay-artifacts/);
  await context.close();
});

await test('F4 opens directly from disk without a server', async () => {
  const { context, page } = await newPage();
  const url = `${pathToFileURL(path.join(root, 'forge-relay.html')).href}?scenario=success`;
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(250);
  await visible(page.locator('.acceptance-receipt'));
  assert.match(await page.locator('.acceptance-receipt').innerText(), /2 \/ 2/);
  await context.close();
});

await browser.close();

console.log(JSON.stringify({ results, consoleErrors }, null, 2));
const failed = results.filter((result) => !result.ok);
if (failed.length || consoleErrors.length) process.exitCode = 1;
