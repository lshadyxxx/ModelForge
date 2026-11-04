import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('<home>/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');

const root = path.resolve(process.cwd());
const outDir = path.join(root, 'design', 'inference-training-redesign-2026-11-04', 'review', 'baseline');
await mkdir(outDir, { recursive: true });

const now = new Date('2026-11-04T00:22:14+08:00').toISOString();
const status = {
  ready: true,
  checked_at: now,
  components: {
    api: { state: 'up', checked_at: now, duration_ms: 4, code: 'ok', message: 'API 正常响应' },
    postgres: { state: 'up', checked_at: now, duration_ms: 12, code: 'ok', message: '数据库查询正常' },
    minio: { state: 'up', checked_at: now, duration_ms: 18, code: 'ok', message: '存储桶检查通过' },
    worker: { state: 'up', checked_at: now, duration_ms: 7, code: 'ok', message: 'Worker 心跳正常' },
  },
};

const modelId = '2f2bd9f7-d8c5-4710-b94d-6273c9ea3712';
const modelFingerprint = 'Qwen3-0.6B-20261102-r1';
const hardware = {
  region: 'cn-bj2',
  zone: 'cn-bj2-02',
  gpu_type: 'RTX 4090',
  cpu: 12,
  memory_mb: 65536,
  image_id: 'img-vllm-0.32.0',
  cpu_platform: 'Auto',
  charge_type: 'Postpay',
  boot_disk_gb: 100,
  boot_disk_type: 'CLOUD_SSD',
  device_memory_bytes: 25757220864,
};
const baseline = {
  id: 'qwen3-0.6b-rtx4090-cn-bj2-partial-20261102-r1',
  sha256: 'f0f4a1d4658c31f9dbe4da150b6c9f87d3cd03a0db48e38c67e0e0a9337e0021',
  status: 'partial',
  generated_at: now,
  model: {
    display_name: 'Qwen3-0.6B',
    architecture: 'qwen3',
    allowed_fingerprints: [modelFingerprint],
    max_model_len: 4096,
  },
  training: {
    runtime_lock_id: 'llamafactory-0.9.5-cu124',
    runtime_lock_sha256: '4f80b30f5b6e',
    hardware: { ...hardware, image_id: 'img-llamafactory-0.9.5' },
    verified_preset: {
      epochs: 1,
      learning_rate: 0.0002,
      cutoff_len: 512,
      batch_size: 1,
      gradient_accumulation: 1,
      lora_rank: 8,
      lora_alpha: 16,
      lora_dropout: 0,
      scheduler: 'cosine',
      warmup_ratio: 0,
      template: 'qwen3_nothink',
      seed: 42,
    },
  },
  inference: {
    runtime_lock_id: 'vllm-0.32.0',
    runtime_lock_sha256: 'd925',
    hardware,
    config: { lora_rank: 8, max_model_len: 512, template: 'qwen3_nothink' },
    gpu_memory_utilization: 0.85,
    loaded_device_memory_bytes: 22332555264,
    conversation: {
      max_messages: 24,
      max_content_chars_per_message: 4000,
      max_total_content_chars: 24000,
      max_tokens_default: 512,
      max_tokens_limit: 2048,
    },
  },
  capacity: { dataset: {}, model: {} },
  evidence: {
    training_attempt_id: '8e024600-d9a8-43cf-a159-cde62f6e4a1b',
    training_exit_code: 0,
    trained_steps: 168,
    average_train_loss: 0.4362,
    eval_loss: 0.3218,
    adapter_best_id: 'adapter-best-01',
    adapter_best_fingerprint: 'best-fingerprint',
    adapter_final_id: 'adapter-final-01',
    adapter_final_fingerprint: 'final-fingerprint',
    inference_trial_id: 'trial-01',
    training_peak_memory: 'measured',
  },
  closure_gaps: ['容量边界实测与更广模型/GPU/镜像兼容矩阵未完成'],
  blocked_combinations: [],
};

const adapters = [
  {
    id: 'adapter-best-01',
    role: 'best',
    state: 'available',
    source_attempt_id: '8e024600-d9a8-43cf-a159-cde62f6e4a1b',
    fingerprint: 'best-fingerprint',
    created_at: now,
    snapshot: {
      base: { id: modelId, fingerprint: modelFingerprint },
      dataset: { id: 'd4de75d9', sha256: '8b4fce913f17b320' },
      config: { template: 'qwen3_nothink', cutoff_len: 512, lora_rank: 8 },
      compatibility: {
        baseline_id: baseline.id,
        baseline_sha256: baseline.sha256,
        model_fingerprint: modelFingerprint,
      },
    },
    metrics: { eval_loss: 0.3218, train_loss: 0.4362, steps: 80 },
    manifest: {},
  },
  {
    id: 'adapter-final-01',
    role: 'final',
    state: 'available',
    source_attempt_id: '8e024600-d9a8-43cf-a159-cde62f6e4a1b',
    fingerprint: 'final-fingerprint',
    created_at: now,
    snapshot: {
      base: { id: modelId, fingerprint: modelFingerprint },
      dataset: { id: 'd4de75d9', sha256: '8b4fce913f17b320' },
      config: { template: 'qwen3_nothink', cutoff_len: 512, lora_rank: 8 },
      compatibility: {
        baseline_id: baseline.id,
        baseline_sha256: baseline.sha256,
        model_fingerprint: modelFingerprint,
      },
    },
    metrics: { eval_loss: 0.3389, train_loss: 0.4362, steps: 80 },
    manifest: {},
  },
];

const trial = {
  id: 'fdb5a28c-9c2f-44cf-a3ad-31c301a12b10',
  state: 'ready',
  adapter_id: 'adapter-best-01',
  instance_id: 'u-4090-11-c2a1',
  stop_requested: false,
  request_state: 'idle',
  request_cancel_requested: false,
  last_activity_at: now,
  snapshot: {
    base: { id: modelId, fingerprint: modelFingerprint },
    instance: hardware,
    adapter_fingerprint: 'best-fingerprint',
    config: { template: 'qwen3_nothink', cutoff_len: 512, lora_rank: 8 },
  },
};

const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-extensions'],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  deviceScaleFactor: 1,
  locale: 'zh-CN',
  colorScheme: 'light',
});
const page = await context.newPage();
const errors = [];
page.on('console', message => {
  if (message.type() === 'error') errors.push(message.text());
});
page.on('pageerror', error => errors.push(error.message));

await page.route('**/api/v1/**', async route => {
  const url = new URL(route.request().url());
  const pathname = url.pathname;
  let body = {};
  if (pathname.endsWith('/status')) body = status;
  else if (pathname.endsWith('/runtime/baseline')) body = baseline;
  else if (pathname.endsWith('/resources/ucloud/zones')) body = {
    items: [{ Region: 'cn-bj2', Zone: 'cn-bj2-02', Describe: '华北二A' }],
    total: 1,
  };
  else if (pathname.endsWith('/serving/adapters')) body = adapters;
  else if (pathname.endsWith('/serving/trials')) body = [trial];
  else if (pathname.includes('/serving/trials/')) body = trial;
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
});

await page.goto('http://127.0.0.1:5176/#serving', { waitUntil: 'networkidle' });
await page.waitForTimeout(500);
console.log(JSON.stringify({ pageErrors: errors, url: page.url(), title: await page.title(), bodyText: (await page.locator('body').innerText()).slice(0, 500) }, null, 2));
await page.screenshot({
  path: path.join(outDir, 'serving-overview-1440.png'),
  fullPage: true,
});
if (await page.getByRole('button', { name: '打开试用' }).count()) await page.getByRole('button', { name: '打开试用' }).click();
await page.waitForTimeout(600);
await page.screenshot({
  path: path.join(outDir, 'serving-detail-1440.png'),
  fullPage: true,
});

await page.setViewportSize({ width: 390, height: 844 });
await page.goto('http://127.0.0.1:5176/#serving', { waitUntil: 'networkidle' });
await page.waitForTimeout(500);
await page.screenshot({
  path: path.join(outDir, 'serving-overview-390.png'),
  fullPage: true,
});
if (await page.getByRole('button', { name: '打开试用' }).count()) await page.getByRole('button', { name: '打开试用' }).click();
await page.waitForTimeout(600);
await page.screenshot({
  path: path.join(outDir, 'serving-detail-390.png'),
  fullPage: true,
});

console.log(JSON.stringify({
  screenshots: [
    path.join(outDir, 'serving-overview-1440.png'),
    path.join(outDir, 'serving-detail-1440.png'),
    path.join(outDir, 'serving-overview-390.png'),
    path.join(outDir, 'serving-detail-390.png'),
  ],
  errors,
}, null, 2));

await browser.close();
