const variant = document.body.dataset.variant || 'a';
const isB2 = variant === 'b2';
const params = new URLSearchParams(location.search);
const chromeHidden = params.get('chrome') === '0';
document.body.classList.toggle('proto-chrome-hidden', chromeHidden);

const root = document.querySelector('#app');
const chromeRoot = document.querySelector('#proto-root');
const modalRoot = document.querySelector('#modal-root');
const toastRoot = document.querySelector('#toast-root');
const mainLabel = document.querySelector('#document-title') || document.querySelector('title');

const icons = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  data: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',
  model: '<path d="M12 3l9 5-9 5-9-5 9-5z"/><path d="M3 12l9 5 9-5M3 16l9 5 9-5"/>',
  compute: '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>',
  training: '<path d="M4 18l6-6 4 3 6-10"/><path d="M14 5h6v6"/>',
  chat: '<path d="M4 4h16v13H9l-5 4 5-4"/><path d="M8 9h8M8 13h5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  refresh: '<path d="M20 11a8 8 0 10-2.34 5.66M20 4v7h-7"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  arrowUpRight: '<path d="M7 17L17 7M8 7h9v9"/>',
  chevronDown: '<path d="M6 9l6 6 6-6"/>',
  chevronRight: '<path d="M9 18l6-6-6-6"/>',
  chevronLeft: '<path d="M15 18l-6-6 6-6"/>',
  check: '<path d="M20 6L9 17l-5-5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  alert: '<path d="M12 3l9 17H3L12 3z"/><path d="M12 9v5M12 17h.01"/>',
  x: '<path d="M18 6L6 18M6 6l12 12"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
  filter: '<path d="M4 5h16M7 12h10M10 19h4"/>',
  terminal: '<path d="M4 4h16v16H4z"/><path d="M7 9l3 3-3 3M13 15h4"/>',
  file: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>',
  sliders: '<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>',
  lock: '<rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 018 0v3"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
  activity: '<path d="M3 12h4l2-7 4 14 2-7h6"/>',
  layers: '<path d="M12 3l9 5-9 5-9-5 9-5z"/><path d="M3 12l9 5 9-5M3 16l9 5 9-5"/>',
  cpu: '<rect x="7" y="7" width="10" height="10" rx="2"/><path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3"/>',
  bell: '<path d="M18 8a6 6 0 00-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="1"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 00-1-1H5a1 1 0 00-1 1v10a1 1 0 001 1h3"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  spark: '<path d="M13 2L4 14h7l-2 8 9-12h-7l2-8z"/>',
  play: '<path d="M8 5l11 7-11 7V5z"/>',
  logout: '<path d="M10 17l5-5-5-5M15 12H3M14 4h6v16h-6"/>',
};

function icon(name, size = 18) {
  return `<svg class="mf-icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.grid}</svg>`;
}

function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

const labels = {
  queued: '排队中',
  waiting_instance: '等待实例',
  preparing: '准备输入',
  running: '训练中',
  syncing: '同步产物',
  cleanup: '回收实例',
  succeeded: '已成功',
  failed: '已失败',
  cancelled: '已取消',
};

const tones = {
  queued: 'neutral',
  waiting_instance: 'waiting',
  preparing: 'running',
  running: 'running',
  syncing: 'running',
  cleanup: 'waiting',
  succeeded: 'success',
  failed: 'danger',
  cancelled: 'neutral',
};

const steps = [
  { name: '选择输入', hint: '数据集与基座' },
  { name: '选择算力', hint: '实例与镜像' },
  { name: '训练参数', hint: '锁定兼容预设' },
  { name: '确认提交', hint: '冻结完整快照' },
];

const paramsPreview = {
  epochs: 2,
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
};

const lossSeries = [0.8215, 0.7868, 0.7412, 0.6994, 0.6628, 0.6153, 0.5801, 0.5438, 0.5148, 0.4869, 0.4614, 0.4362];
const evalSeries = [
  { index: 2, value: 0.7021 },
  { index: 5, value: 0.5984 },
  { index: 8, value: 0.4239 },
  { index: 11, value: 0.3218 },
];

const jobs = [
  {
    id: 'attempt-07',
    number: 7,
    name: '客服意图 LoRA · Qwen3',
    base: 'Qwen3-0.6B',
    baseVersion: 'v1',
    dataset: '客服意图数据',
    datasetVersion: 'v3',
    state: 'running',
    stage: '训练中',
    progress: 62,
    step: 104,
    totalSteps: 168,
    loss: 0.4362,
    evalLoss: 0.3218,
    learningRate: '1.45e-4',
    elapsed: '23 分 18 秒',
    created: '今天 10:08',
    updated: '10:32:12',
    gpu: 'RTX 4090',
    instance: 'u-4090-02-7fca',
    region: 'cn-bj2 / cn-bj2-02',
    samples: 120,
    throughput: '2.8 samples/s',
    artifact: false,
    note: 'Best / Final Adapter 将在训练结束并同步后发布',
  },
  {
    id: 'attempt-03',
    number: 3,
    name: '售后情绪识别 · LoRA',
    base: 'Qwen3-0.6B',
    baseVersion: 'v1',
    dataset: '售后话术修订',
    datasetVersion: 'v2',
    state: 'waiting_instance',
    stage: '等待手动创建实例',
    progress: 6,
    step: 0,
    totalSteps: 146,
    loss: null,
    evalLoss: null,
    learningRate: '2.00e-4',
    elapsed: '4 分 06 秒',
    created: '今天 10:15',
    updated: '10:19:05',
    gpu: 'RTX 4090',
    instance: '尚未关联',
    region: 'cn-bj2 / cn-bj2-02',
    samples: 84,
    throughput: '—',
    artifact: false,
    note: '需要先在优云控制台创建实例，再关联实例 ID',
  },
  {
    id: 'attempt-06',
    number: 6,
    name: 'FAQ 改写适配 · SFT',
    base: 'Qwen3-0.6B',
    baseVersion: 'v1',
    dataset: 'FAQ 改写语料',
    datasetVersion: 'v4',
    state: 'succeeded',
    stage: '产物已同步',
    progress: 100,
    step: 146,
    totalSteps: 146,
    loss: 0.3112,
    evalLoss: 0.2148,
    learningRate: '1.04e-5',
    elapsed: '41 分 52 秒',
    created: '今天 09:22',
    updated: '10:04:18',
    gpu: 'RTX 4090',
    instance: 'u-4090-02-6bd1',
    region: 'cn-bj2 / cn-bj2-02',
    samples: 152,
    throughput: '3.4 samples/s',
    artifact: true,
    note: 'Best 与 Final Adapter 已通过 MinIO 校验，可用于推理试用',
  },
  {
    id: 'attempt-05',
    number: 5,
    name: '多轮对话增强 · LoRA',
    base: 'Qwen3-0.6B',
    baseVersion: 'v1',
    dataset: '客服意图数据',
    datasetVersion: 'v2',
    state: 'failed',
    stage: '远程进程异常退出',
    progress: 28,
    step: 41,
    totalSteps: 148,
    loss: 0.6234,
    evalLoss: null,
    learningRate: '2.00e-4',
    elapsed: '12 分 07 秒',
    created: '昨天 18:40',
    updated: '昨天 18:52',
    gpu: 'RTX 4090',
    instance: 'u-4090-02-4df8',
    region: 'cn-bj2 / cn-bj2-02',
    samples: 120,
    throughput: '2.6 samples/s',
    artifact: false,
    errorCode: 'runtime_exited',
    note: '远程进程以非零状态退出；实例停止与租约释放已确认',
  },
  {
    id: 'attempt-04',
    number: 4,
    name: '客服摘要 · 基线复测',
    base: 'Qwen3-0.6B',
    baseVersion: 'v1',
    dataset: '客服摘要小样',
    datasetVersion: 'v1',
    state: 'cancelled',
    stage: '用户取消',
    progress: 43,
    step: 63,
    totalSteps: 146,
    loss: 0.5594,
    evalLoss: null,
    learningRate: '2.00e-4',
    elapsed: '08 分 21 秒',
    created: '昨天 16:12',
    updated: '昨天 16:20',
    gpu: 'RTX 4090',
    instance: 'u-4090-02-3e18',
    region: 'cn-bj2 / cn-bj2-02',
    samples: 68,
    throughput: '2.9 samples/s',
    artifact: false,
    note: '取消已完成，未发布部分 Adapter，实例与租约均已回收',
  },
];

const logs = [
  ['10:08:51', 'INFO', '提交训练任务，冻结输入快照与兼容基线'],
  ['10:09:03', 'INFO', 'Worker 领取 Attempt #7，等待关联远程实例'],
  ['10:09:28', 'INFO', '实例 u-4090-02-7fca 已关联，开始准备远程工作目录'],
  ['10:10:04', 'INFO', '数据集 split-4f82b9d1 下载完成，SHA-256 校验通过'],
  ['10:10:22', 'INFO', '基座 Qwen3-0.6B 指纹与兼容基线一致'],
  ['10:11:09', 'INFO', 'Token 预检完成：120 条样本，0 条截断'],
  ['10:11:16', 'INFO', '启动 LLaMA-Factory 0.9.5 / CUDA 12.4 / RTX 4090'],
  ['10:12:02', 'INFO', 'trainable params: 2,162,688 || all params: 598,451,200'],
  ['10:19:44', 'STEP', 'step 20/168 · loss 0.8215 · lr 2.00e-4'],
  ['10:23:16', 'STEP', 'step 40/168 · loss 0.6628 · lr 1.94e-4 · eval_loss 0.7021'],
  ['10:27:04', 'STEP', 'step 60/168 · loss 0.5801 · lr 1.82e-4'],
  ['10:30:51', 'STEP', 'step 80/168 · loss 0.4869 · lr 1.64e-4 · eval_loss 0.4239'],
  ['10:32:12', 'STEP', 'step 104/168 · loss 0.4362 · lr 1.45e-4'],
  ['10:32:15', 'INFO', 'checkpoint step-100 已生成，等待训练结束后统一回传'],
];

const createDefaults = {
  step: 1,
  name: '客服意图 LoRA · Qwen3',
  dataset: '客服意图数据 · v3',
  base: 'Qwen3-0.6B · v1',
  hardware: '已验收 · RTX 4090 / 12C / 64GB',
  image: 'LLaMA-Factory 0.9.5',
  region: 'cn-bj2 · cn-bj2-02',
  billing: '按量后付费',
  seed: 42,
  note: '',
  error: '',
  errorField: '',
};

const state = {
  view: parseView(),
  selectedId: 'attempt-07',
  detailTab: parseTab(),
  filter: 'all',
  createStep: 1,
  create: { ...createDefaults },
  modal: null,
  toast: null,
  query: '',
};

let lastModalTrigger = null;

function parseView() {
  const value = location.hash.replace('#', '').split('/')[0];
  return ['overview', 'create', 'detail'].includes(value) ? value : 'overview';
}

function parseTab() {
  const value = location.hash.replace('#', '').split('/')[1];
  return ['overview', 'analysis', 'logs', 'artifacts', 'config'].includes(value) ? value : 'overview';
}

function navigate(view, tab = 'overview') {
  state.view = view;
  if (view === 'detail') state.detailTab = tab;
  const hash = view === 'detail' && tab !== 'overview' ? `#detail/${tab}` : `#${view}`;
  history.replaceState(null, '', hash);
  render();
  requestAnimationFrame(() => {
    const main = document.querySelector('#main');
    if (main) {
      main.setAttribute('tabindex', '-1');
      main.focus({ preventScroll: true });
    }
  });
}

function selectedJob() {
  return jobs.find(job => job.id === state.selectedId) || jobs[0];
}

function stateIndex(job) {
  if (job.state === 'waiting_instance' || job.state === 'queued') return 1;
  if (job.state === 'preparing') return 1;
  if (job.state === 'running') return 2;
  if (job.state === 'syncing') return 3;
  if (job.state === 'cleanup') return 4;
  if (job.state === 'succeeded') return 5;
  if (job.state === 'failed') return 2;
  return 4;
}

function status(job, extra = '') {
  return `<span class="status-pill ${tones[job.state] || 'neutral'} ${extra}"><i class="status-dot"></i>${labels[job.state] || job.state}</span>`;
}

function short(value, length = 8) {
  return value ? `${value.slice(0, length)}…` : '—';
}

function metric(value, digits = 4) {
  return value == null ? '—' : Number(value).toFixed(digits);
}

function normalizeTypeFloor(scope = document) {
  const candidates = scope.querySelectorAll(
    '#app *, #modal-root *, #toast-root *, #proto-root *'
  );
  candidates.forEach(element => {
    if (element.closest('.visually-hidden')) return;
    const tag = element.tagName;
    const isControl = ['INPUT', 'SELECT', 'TEXTAREA'].includes(tag);
    const hasDirectText = [...element.childNodes].some(
      node => node.nodeType === Node.TEXT_NODE && node.textContent.trim()
    );
    if (!isControl && !hasDirectText) return;
    const floor = ['P', 'LI', 'BLOCKQUOTE'].includes(tag) ? 12 : 11;
    const current = Number.parseFloat(getComputedStyle(element).fontSize);
    if (Number.isFinite(current) && current < floor) {
      element.style.setProperty('font-size', `${floor}px`, 'important');
    }
  });
}

function sparkPoints(values, width = 110, height = 26, pad = 2) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  return values.map((value, index) => {
    const x = pad + ((width - pad * 2) * index) / Math.max(1, values.length - 1);
    const y = pad + ((height - pad * 2) * (max - value)) / span;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
}

function sparkline(values, color = 'currentColor', width = 110, height = 26) {
  return `<svg class="sparkline" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" preserveAspectRatio="none" aria-hidden="true"><polyline points="${sparkPoints(values, width, height)}" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

function b2LossChart(job) {
  const current = job || jobs[0];
  const hasSamples = current.loss != null;
  if (!hasSamples) {
    return `<div class="b2-loss-chart b2-loss-chart-empty" role="img" aria-label="尚未收到训练 Loss 与验证 Loss 采样">
      <div class="b2-chart-empty">
        <span class="b2-chart-empty-axis" aria-hidden="true"></span>
        <div><strong>等待首个训练指标</strong><p>训练进程开始后，Loss 会在 step 20 左右产生第一个可比较采样。</p></div>
      </div>
    </div>`;
  }

  const isSucceeded = current.state === 'succeeded';
  const trainPoints = isSucceeded
    ? [
        { step: 20, value: 0.8612 },
        { step: 40, value: 0.7148 },
        { step: 70, value: 0.5682 },
        { step: 100, value: 0.4316 },
        { step: 124, value: 0.3578 },
        { step: current.step, value: current.loss },
      ]
    : [
        { step: 20, value: 0.8215 },
        { step: 40, value: 0.6628 },
        { step: 60, value: 0.5801 },
        { step: 80, value: 0.4869 },
        { step: current.step, value: current.loss },
      ];
  const evalPoints = current.evalLoss == null
    ? []
    : isSucceeded
      ? [
          { step: 40, value: 0.6912 },
          { step: 80, value: 0.4028 },
          { step: 120, value: 0.2584 },
          { step: current.step, value: current.evalLoss },
        ]
      : [
          { step: 40, value: 0.7021 },
          { step: 80, value: 0.4239 },
          { step: current.step, value: current.evalLoss },
        ];

  const yMin = 0.15;
  const yMax = 0.9;
  const xMax = Math.max(1, current.totalSteps);
  const xPct = step => (step / xMax) * 100;
  const yPct = value => ((yMax - value) / (yMax - yMin)) * 100;
  const linePoints = points => points.map(point => `${(xPct(point.step) * 10).toFixed(1)},${(yPct(point.value) * 10).toFixed(1)}`).join(' ');
  const areaPath = `M ${xPct(trainPoints[0].step) * 10} 1000 ${trainPoints.map(point => `L ${xPct(point.step) * 10} ${yPct(point.value) * 10}`).join(' ')} L ${xPct(trainPoints.at(-1).step) * 10} 1000 Z`;
  const ticks = [0.8, 0.6, 0.4, 0.2];
  const xTicks = [0, 40, 80, 120, current.totalSteps].filter((value, index, list) => value <= xMax && list.indexOf(value) === index);
  const firstLoss = trainPoints[0].value;
  const lastLoss = trainPoints.at(-1).value;
  const drop = ((lastLoss - firstLoss) / firstLoss) * 100;
  const bestEval = evalPoints.length ? Math.min(...evalPoints.map(point => point.value)) : null;
  const evalGap = bestEval == null ? null : lastLoss - bestEval;
  const currentAtEnd = xPct(current.step) > 90;
  const pointMarkup = (points, kind, labels) => points.map((point, index) => {
    const label = labels.has(index) ? labels.get(index) : '';
    const edgeEnd = currentAtEnd && index === points.length - 1;
    return `<span class="b2-chart-point ${kind} ${edgeEnd ? 'edge-end' : ''}" style="left:${xPct(point.step)}%;top:${yPct(point.value)}%" title="step ${point.step} · ${kind === 'train' ? 'train' : 'eval'} ${point.value.toFixed(4)}"><i></i>${label ? `<b style="--label-y:${kind === 'train' ? '-18px' : '13px'}">${label}</b>` : ''}</span>`;
  }).join('');

  return `<div class="b2-loss-chart" role="img" aria-label="训练 Loss 从 step ${trainPoints[0].step} 的 ${firstLoss.toFixed(4)} 下降到 step ${current.step} 的 ${lastLoss.toFixed(4)}；${bestEval == null ? '暂无验证 Loss' : `验证最优 Loss ${bestEval.toFixed(4)}`}；当前 ${current.step} / ${current.totalSteps} steps">
    <div class="b2-chart-plot">
      <div class="b2-chart-yaxis" aria-hidden="true">
        <span class="b2-chart-axis-name">LOSS</span>
        ${ticks.map(value => `<span style="top:${yPct(value)}%">${value.toFixed(2)}</span>`).join('')}
      </div>
      <div class="b2-chart-canvas">
        ${ticks.map(value => `<i class="b2-chart-gridline" style="top:${yPct(value)}%" aria-hidden="true"></i>`).join('')}
        ${ticks.map(value => `<i class="b2-chart-tickmark" style="top:${yPct(value)}%" aria-hidden="true"></i>`).join('')}
        <i class="b2-chart-now-line ${currentAtEnd ? 'edge-end' : ''}" style="left:${xPct(current.step)}%" aria-hidden="true"></i>
        <span class="b2-chart-now-label mono ${currentAtEnd ? 'edge-end' : ''}" style="left:${xPct(current.step)}%">当前 ${current.step}</span>
        <svg class="b2-chart-vectors" viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true">
          <path class="b2-chart-area" d="${areaPath}"/>
          <polyline class="b2-chart-train-line" points="${linePoints(trainPoints)}"/>
          ${evalPoints.length ? `<polyline class="b2-chart-eval-line" points="${linePoints(evalPoints)}"/>` : ''}
        </svg>
        ${pointMarkup(trainPoints, 'train', new Map([[0, firstLoss.toFixed(4)], [trainPoints.length - 1, lastLoss.toFixed(4)]]))}
        ${pointMarkup(evalPoints, 'eval', new Map([[evalPoints.length - 1, bestEval == null ? '' : bestEval.toFixed(4)]]))}
      </div>
    </div>
    <div class="b2-chart-xaxis" aria-hidden="true">
      ${xTicks.map((value, index) => `<span style="left:${xPct(value)}%">${value}${index === xTicks.length - 1 ? ' steps' : ''}</span>`).join('')}
    </div>
    <footer class="b2-chart-insights">
      <span><i class="train"></i>训练 Loss</span>
      <strong class="positive mono">↓ ${Math.abs(drop).toFixed(1)}%</strong>
      <span class="b2-chart-insight-copy">较首个采样</span>
      ${bestEval == null ? '' : `<span class="b2-chart-insight-divider"></span><span><i class="eval"></i>验证最优</span><strong class="mono">${bestEval.toFixed(4)}</strong><span class="b2-chart-insight-copy">领先训练 ${evalGap.toFixed(4)}</span>`}
    </footer>
  </div>`;
}

function b2MonitorChart({
  points,
  currentStep,
  yMin = 0,
  yMax,
  yTicks,
  formatY = value => String(value),
  color = '#245ad0',
  threshold = null,
  thresholdLabel = '',
  ariaLabel,
}) {
  const xMax = Math.max(1, currentStep);
  const xPct = step => (step / xMax) * 100;
  const yPct = value => ((yMax - value) / (yMax - yMin)) * 100;
  const linePoints = points.map(point => `${(xPct(point.step) * 10).toFixed(1)},${(yPct(point.value) * 10).toFixed(1)}`).join(' ');
  const areaPath = `M ${xPct(points[0].step) * 10} 1000 ${points.map(point => `L ${xPct(point.step) * 10} ${yPct(point.value) * 10}`).join(' ')} L ${xPct(points.at(-1).step) * 10} 1000 Z`;
  const xTicks = [...new Set([0, Math.round(currentStep / 2), currentStep])];

  return `<div class="b2-monitor-chart" style="--metric:${color}" role="img" aria-label="${esc(ariaLabel)}">
    <div class="b2-monitor-plot">
      <div class="b2-monitor-yaxis" aria-hidden="true">
        ${yTicks.map(value => `<span style="top:${yPct(value)}%">${formatY(value)}</span>`).join('')}
      </div>
      <div class="b2-monitor-canvas">
        ${yTicks.map(value => `<i class="b2-monitor-gridline" style="top:${yPct(value)}%" aria-hidden="true"></i>`).join('')}
        ${threshold == null ? '' : `<i class="b2-monitor-threshold" style="top:${yPct(threshold)}%" aria-hidden="true"></i><span class="b2-monitor-threshold-label" style="top:${yPct(threshold)}%">${esc(thresholdLabel)}</span>`}
        <svg class="b2-monitor-vectors" viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true">
          <path class="b2-monitor-area" d="${areaPath}"/>
          <polyline class="b2-monitor-line" points="${linePoints}"/>
        </svg>
        ${points.map(point => `<span class="b2-monitor-point ${threshold != null && point.value > threshold ? 'warning' : ''}" style="left:${xPct(point.step)}%;top:${yPct(point.value)}%" title="step ${point.step} · ${formatY(point.value)}"><i></i></span>`).join('')}
      </div>
    </div>
    <div class="b2-monitor-xaxis" aria-hidden="true">
      ${xTicks.map((value, index) => `<span style="left:${xPct(value)}%">${value}${index === xTicks.length - 1 ? ' steps' : ''}</span>`).join('')}
    </div>
  </div>`;
}

function b2MonitorCard({
  kicker,
  title,
  value,
  sub,
  status,
  tone = 'ok',
  chart,
  notes,
}) {
  return `<article class="b2-monitor-card ${tone === 'warning' ? 'has-warning' : ''}">
    <header>
      <div><span class="b2-kicker">${kicker}</span><h4>${title}</h4></div>
      <div class="b2-monitor-reading"><strong class="mono">${value}</strong><span>${sub}</span></div>
    </header>
    ${chart}
    <footer>
      <span class="b2-monitor-state ${tone}">${status}</span>
      ${notes.map(note => `<span>${note}</span>`).join('')}
    </footer>
  </article>`;
}

function analysisContent(job) {
  if (job.loss == null) {
    return `<div class="b2-analysis-empty">
      <span>${icon('activity', 22)}</span>
      <div><h3>尚未收到训练指标</h3><p>实例关联且训练进程开始上报后，这里会显示学习率、梯度范数、显存和吞吐曲线。</p></div>
      <span class="b2-monitor-state waiting">等待首个采样</span>
    </div>`;
  }

  const currentStep = Math.max(1, job.step);
  const throughput = Number.parseFloat(String(job.throughput).match(/[\d.]+/)?.[0] || '2.8');
  const currentLr = Number.parseFloat(job.learningRate) || 1.45e-4;
  const startLr = 2e-4;
  const currentMemory = job.state === 'succeeded' ? 17.4 : 18.6;
  const peakMemory = currentMemory + 0.6;
  const memoryHeadroom = 24 - currentMemory;
  const gradient = job.state === 'succeeded' ? 0.76 : 0.84;
  const stepFractions = [0, 0.24, 0.48, 0.72, 1];
  const lrPoints = stepFractions.map(fraction => {
    const cosine = 0.5 + 0.5 * Math.cos(Math.PI * fraction);
    return {
      step: Math.round(currentStep * fraction),
      value: currentLr + (startLr - currentLr) * cosine,
    };
  });
  const gradFractions = [0.08, 0.23, 0.4, 0.57, 0.74, 0.9, 1];
  const gradValues = [0.68, 0.74, 0.89, 1.12, 0.87, 0.79, gradient];
  const gradPoints = gradFractions.map((fraction, index) => ({
    step: Math.round(currentStep * fraction),
    value: gradValues[index],
  }));
  const memoryFractions = [0.18, 0.38, 0.58, 0.79, 1];
  const memoryPoints = memoryFractions.map((fraction, index) => ({
    step: Math.round(currentStep * fraction),
    value: 8.2 + (currentMemory - 8.2) * [0, 0.42, 0.78, 0.95, 1][index],
  }));
  const throughputFractions = [0.18, 0.38, 0.58, 0.79, 1];
  const throughputPoints = throughputFractions.map((fraction, index) => ({
    step: Math.round(currentStep * fraction),
    value: throughput * [0.86, 0.92, 0.97, 1.02, 1][index],
  }));
  const lrFormat = value => value === 0
    ? '0'
    : value >= 1e-4
      ? `${Number((value / 1e-4).toFixed(1))}e-4`
      : `${Number((value / 1e-5).toFixed(0))}e-5`;
  const currentState = job.state === 'succeeded'
    ? '训练已完成，关键诊断指标均已保留'
    : job.state === 'running'
      ? '训练过程稳定，Loss 仍在下降'
      : '训练已结束，保留截至最后采样的诊断记录';
  const alertDetail = job.state === 'running'
    ? `step 58 触发 1 次梯度裁剪；显存尚余 ${memoryHeadroom.toFixed(1)} GB，吞吐保持在 ${throughput.toFixed(1)} samples/s 左右。`
    : job.state === 'succeeded'
      ? `Loss、学习率、梯度、显存和吞吐记录完整；最终显存峰值距上限仍有 ${(24 - peakMemory).toFixed(1)} GB。`
      : `保留截至 step ${currentStep} 的采样，可结合实时日志定位停止前后的变化；不补造缺失数据。`;
  const eventItems = [
    { step: 40, title: '首次验证', detail: 'eval 0.7021' },
    { step: 58, title: '梯度裁剪', detail: 'norm 1.12', tone: 'warning' },
    { step: 80, title: '再次验证', detail: 'eval 0.4239' },
    { step: 100, title: 'Checkpoint', detail: 'step-100 已生成' },
    { step: currentStep, title: '当前采样', detail: `train ${metric(job.loss)}`, tone: 'current' },
  ].filter(event => event.step <= currentStep);

  return `<div class="b2-analysis">
    <section class="b2-analysis-alert">
      <span class="b2-analysis-alert-icon">${icon('activity', 18)}</span>
      <div><strong>${currentState}</strong><p>${alertDetail}</p></div>
      <span class="b2-analysis-sample mono">最近采样 step ${currentStep}</span>
    </section>

    <section class="b2-analysis-grid" aria-label="训练运行诊断图表">
      ${b2MonitorCard({
        kicker: 'LEARNING RATE',
        title: '学习率调度',
        value: job.learningRate,
        sub: '当前 LR',
        status: '与 cosine 配置一致',
        chart: b2MonitorChart({
          points: lrPoints,
          currentStep,
          yMax: 2.2e-4,
          yTicks: [0, 1e-4, 2e-4],
          formatY: lrFormat,
          color: '#245ad0',
          ariaLabel: `学习率从 ${lrFormat(startLr)} 按 cosine 衰减至 ${job.learningRate}`,
        }),
        notes: ['warmup 0', '无手动改参记录'],
      })}
      ${b2MonitorCard({
        kicker: 'GRADIENT NORM',
        title: '梯度范数',
        value: gradient.toFixed(2),
        sub: '当前值',
        status: '1 次裁剪',
        tone: 'warning',
        chart: b2MonitorChart({
          points: gradPoints,
          currentStep,
          yMax: 1.3,
          yTicks: [0, 0.4, 0.8, 1.2],
          formatY: value => value === 0 ? '0' : value.toFixed(1),
          color: '#b06a17',
          threshold: 1,
          thresholdLabel: '裁剪阈值 1.00',
          ariaLabel: '梯度范数在 step 58 到达 1.12，触发一次梯度裁剪，当前为 0.84',
        }),
        notes: ['step 58 · norm 1.12', 'Loss 未反弹'],
      })}
      ${b2MonitorCard({
        kicker: 'GPU MEMORY',
        title: '显存占用',
        value: `${currentMemory.toFixed(1)} / 24 GB`,
        sub: '已用 / 上限',
        status: `余量 ${memoryHeadroom.toFixed(1)} GB`,
        chart: b2MonitorChart({
          points: memoryPoints,
          currentStep,
          yMax: 26,
          yTicks: [0, 8, 16, 24],
          formatY: value => String(value),
          color: '#1d8c74',
          threshold: 24,
          thresholdLabel: '容量上限',
          ariaLabel: `GPU 显存当前占用 ${currentMemory.toFixed(1)} GB，峰值 ${peakMemory.toFixed(1)} GB，上限 24 GB`,
        }),
        notes: [`峰值 ${peakMemory.toFixed(1)} GB`, 'GPU util 94%'],
      })}
      ${b2MonitorCard({
        kicker: 'THROUGHPUT',
        title: '数据吞吐',
        value: throughput.toFixed(1),
        sub: 'samples/s',
        status: '波动正常',
        chart: b2MonitorChart({
          points: throughputPoints,
          currentStep,
          yMax: Math.max(4, Math.ceil(throughput + 1)),
          yTicks: [0, 1, 2, 3, 4],
          formatY: value => String(value),
          color: '#4e6f9f',
          ariaLabel: `训练吞吐稳定在每秒 ${throughput.toFixed(1)} 个样本左右`,
        }),
        notes: ['step time 3.2 s', '无长时间停顿'],
      })}
    </section>

    <section class="b2-analysis-events">
      <header><div><span class="b2-kicker">EVENT TRACE</span><h4>关键事件</h4></div><span>按 step 排序</span></header>
      <div class="b2-analysis-event-track">
        ${eventItems.map(event => `<div class="${event.tone || ''}"><span class="mono">${event.step}</span><strong>${event.title}</strong><small>${event.detail}</small></div>`).join('')}
      </div>
    </section>

    <section class="b2-analysis-note">
      ${icon('alert', 16)}
      <div><strong>任务级指标尚未上报</strong><p>当前运行仅记录 Eval Loss。accuracy、F1 等业务指标需要训练运行时明确上报后才展示，不生成推断曲线。</p></div>
    </section>
  </div>`;
}

function lossChart(mode = 'a', height = 180, job = null) {
  if (mode === 'b2') return b2LossChart(job);
  const width = 760;
  const pad = { left: 8, right: 10, top: 10, bottom: 18 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const values = [...lossSeries, ...evalSeries.map(point => point.value)];
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const point = (value, index) => {
    const x = pad.left + (plotW * index) / Math.max(1, lossSeries.length - 1);
    const y = pad.top + (plotH * (max - value)) / span;
    return [x, y];
  };
  const points = lossSeries.map(point);
  const line = points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const evalPoints = evalSeries.map(({ index, value }) => point(value, index));
  const area = [
    `M ${pad.left} ${pad.top + plotH}`,
    ...points.map(([x, y]) => `L ${x.toFixed(1)} ${y.toFixed(1)}`),
    `L ${pad.left + plotW} ${pad.top + plotH}`,
    'Z',
  ].join(' ');
  const grid = [0.2, 0.4, 0.6, 0.8].map(ratio => {
    const y = pad.top + plotH * ratio;
    return `<line x1="${pad.left}" y1="${y.toFixed(1)}" x2="${pad.left + plotW}" y2="${y.toFixed(1)}" class="chart-grid"/>`;
  }).join('');
  const labels = mode === 'c' ? `<text x="${pad.left}" y="${height - 2}" class="chart-label">0</text><text x="${pad.left + plotW / 2}" y="${height - 2}" text-anchor="middle" class="chart-label">84</text><text x="${pad.left + plotW}" y="${height - 2}" text-anchor="end" class="chart-label">168 steps</text>` : '';
  const fill = mode === 'a' ? '' : `<path d="${area}" fill="currentColor" class="chart-area"/>`;
  return `<svg class="loss-chart ${mode}" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="训练 Loss 从 0.8215 下降到 0.4362，验证 Loss 最新为 0.3218">${grid}${fill}<polyline points="${line}" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" class="chart-train"/>${evalPoints.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="3.4" class="chart-eval"/>`).join('')}${labels}</svg>`;
}

function progress(job) {
  return `<div class="progress-track" aria-label="训练进度 ${job.progress}%"><span style="width:${job.progress}%"></span></div>`;
}

function stageStrip(job, mode = 'a') {
  const current = stateIndex(job);
  const stageNames = ['任务提交', '输入准备', '训练执行', '产物同步', '实例回收'];
  return `<ol class="stage-strip ${mode}">${stageNames.map((name, index) => {
    const done = current > index || job.state === 'succeeded';
    const active = current === index && job.state !== 'succeeded';
    const failed = job.state === 'failed' && index === 2;
    const succeededTimes = ['10:08:51', '10:10:22', '10:48:05', '10:49:12', '10:52:40'];
    const stageDetail = mode === 'b2' && job.state === 'succeeded'
      ? succeededTimes[index]
      : index === 0 ? '10:08:51' : index === 1 ? (current >= 1 ? '10:10:22' : '待开始') : index === 2 ? (current >= 2 ? '进行中' : '待开始') : index === 3 ? (current >= 3 ? '待完成' : '未开始') : (current >= 4 ? '待完成' : '未开始');
    return `<li class="${done ? 'done' : ''} ${active ? 'active' : ''} ${failed ? 'failed' : ''}"><span class="stage-node">${done ? icon('check', 13) : failed ? icon('x', 13) : `<b>${index + 1}</b>`}</span><span class="stage-copy"><strong>${name}</strong><small>${stageDetail}</small></span></li>`;
  }).join('')}</ol>`;
}

function pageEyebrow(text) {
  return `<span class="page-eyebrow">${esc(text)}</span>`;
}

function button(label, action, kind = 'primary', iconName = '', extra = '') {
  return `<button type="button" class="btn ${kind} ${extra}" data-action="${action}">${iconName ? icon(iconName, 16) : ''}<span>${esc(label)}</span></button>`;
}

function linkButton(label, href, kind = 'quiet', iconName = '') {
  return `<a class="btn ${kind}" href="${href}">${iconName ? icon(iconName, 16) : ''}<span>${esc(label)}</span></a>`;
}

function renderChrome() {
  if (chromeHidden) {
    chromeRoot.innerHTML = '';
    return;
  }
  chromeRoot.innerHTML = `<div class="proto-bar">
    <div class="proto-brand"><strong>TRAINING REDESIGN</strong><span>同一训练语义，三种工作方式</span></div>
    <span class="proto-meta">本地静态原型 · 不调用训练 API</span>
    <nav class="proto-tabs" aria-label="设计方案切换">
      <a href="a-console.html${location.hash || '#overview'}" ${variant === 'a' ? 'aria-current="page"' : ''}><b>A</b> 工程控制台</a>
      <a href="b-forge.html${location.hash || '#overview'}" ${variant === 'b' ? 'aria-current="page"' : ''}><b>B</b> 锻造工作台</a>
      <a href="b2-forge.html${location.hash || '#overview'}" ${isB2 ? 'aria-current="page"' : ''}><b>B2</b> 统一工作台</a>
      <a href="c-lab.html${location.hash || '#overview'}" ${variant === 'c' ? 'aria-current="page"' : ''}><b>C</b> 实验工作室</a>
    </nav>
  </div>`;
}

function aNav() {
  return `<aside class="a-sidebar">
    <a class="a-brand" href="#overview" aria-label="ModelForge 工作台">
      <span class="brand-mark">M</span>
      <span class="brand-copy"><strong>ModelForge</strong><small>模型微调工作台</small></span>
    </a>
    <nav class="a-nav" aria-label="主导航">
      <a href="#" data-other>${icon('grid')}<span>工作台</span></a>
      <a href="#" data-other>${icon('data')}<span>数据集</span></a>
      <a href="#" data-other>${icon('model')}<span>模型</span></a>
      <a href="#" data-other>${icon('compute')}<span>计算环境</span></a>
      <a href="#overview" class="active" aria-current="page">${icon('training')}<span>训练</span><b>5</b></a>
      <a href="#" data-other>${icon('chat')}<span>推理试用</span></a>
    </nav>
    <div class="a-side-foot">
      <span class="system-state"><i></i>控制面在线</span>
      <small>PostgreSQL · MinIO · Worker</small>
      <span class="a-version">MF / 0.1.0</span>
    </div>
  </aside>`;
}

function bNav() {
  return `<header class="b-masthead">
    <a class="b-brand" href="#overview"><span class="b-mark">M</span><span><strong>ModelForge</strong><small>模型锻造工作台</small></span></a>
    <nav class="b-nav" aria-label="主导航">
      <a href="#" data-other>工作台</a>
      <a href="#" data-other>数据集</a>
      <a href="#" data-other>模型</a>
      <a href="#" data-other>计算环境</a>
      <a href="#overview" class="active" aria-current="page">训练</a>
      <a href="#" data-other>推理试用</a>
    </nav>
    <div class="b-mast-actions">
      <span class="b-system"><i></i>控制面在线</span>
      <button type="button" class="b-icon-btn" aria-label="通知" data-other>${icon('bell', 17)}</button>
      <span class="b-avatar">LS</span>
    </div>
  </header>`;
}

function b2Nav() {
  const links = [
    ['grid', '工作台', false],
    ['data', '数据集', false],
    ['model', '模型', false],
    ['compute', '计算环境', false],
    ['training', '训练', true],
    ['chat', '推理试用', false],
  ];
  return `<aside class="b2-sidebar">
    <a class="b2-brand" href="#overview" aria-label="ModelForge 训练工作台">
      <span class="b2-brand-mark" aria-hidden="true">M</span>
      <span class="b2-brand-copy"><strong>ModelForge</strong><small>模型微调工作台</small></span>
    </a>
    <nav class="b2-nav" aria-label="主导航">
      ${links.map(([iconName, label, active]) => `<a href="${active ? '#overview' : '#'}" class="${active ? 'active' : ''}" ${active ? 'aria-current="page"' : 'data-other'}>${icon(iconName, 18)}<span>${label}</span>${active ? '<b>5</b>' : ''}</a>`).join('')}
    </nav>
    <div class="b2-side-foot">
      <span class="b2-health"><i></i>控制面在线</span>
      <small>PostgreSQL · MinIO · Worker</small>
      <span class="b2-version mono">MF / 0.1.0</span>
    </div>
  </aside>`;
}

function b2Topbar() {
  return `<header class="b2-topbar">
    <div class="b2-breadcrumb"><span>个人工作空间</span><i>/</i><strong>训练</strong></div>
    <div class="b2-top-actions">
      <span class="b2-dependency"><i></i>依赖已就绪</span>
      <button type="button" class="b2-icon-btn" data-other aria-label="通知">${icon('bell', 17)}</button>
      <span class="b2-avatar">LS</span>
    </div>
  </header>`;
}

function cNav() {
  const links = [
    ['grid', '工作台'],
    ['data', '数据集'],
    ['model', '模型'],
    ['compute', '计算环境'],
    ['training', '训练'],
    ['chat', '推理试用'],
  ];
  return `<aside class="c-rail">
    <a class="c-logo" href="#overview" aria-label="ModelForge">M</a>
    <nav aria-label="主导航">
      ${links.map(([iconName, label], index) => `<a href="${index === 4 ? '#overview' : '#'}" class="${index === 4 ? 'active' : ''}" ${index === 4 ? 'aria-current="page"' : 'data-other'} aria-label="${label}" title="${label}">${icon(iconName, 19)}</a>`).join('')}
    </nav>
    <div class="c-rail-foot"><span class="c-health-dot"></span><button type="button" data-other aria-label="退出">${icon('logout', 17)}</button></div>
  </aside>`;
}

function shellA(content) {
  return `<div class="a-app">${aNav()}<div class="a-canvas"><header class="a-topbar"><div class="a-breadcrumb"><span>个人工作空间</span><b>/</b><strong>训练</strong></div><div class="a-topmeta"><span class="a-health"><i></i>依赖已就绪</span><span>本机访问</span><span class="a-topdivider"></span><button type="button" data-other aria-label="通知">${icon('bell', 16)}</button><span class="a-operator">LS</span></div></header><main id="main">${content}<footer class="a-footer"><span>ModelForge · Training Control Plane</span><span>本地静态原型 · 不触发真实训练</span></footer></main></div></div>`;
}

function shellB(content) {
  return `<div class="b-app">${bNav()}<main id="main">${content}<footer class="b-footer"><span>MODELFORGE / FORGE OPERATIONS</span><span>训练任务是一份可追溯的锻造记录。</span><span>本地静态原型</span></footer></main></div>`;
}

function shellB2(content) {
  return `<div class="b2-app">${b2Nav()}<div class="b2-shell">${b2Topbar()}<main id="main" class="b2-main">${content}<footer class="b2-footer"><span>ModelForge · Training Workspace</span><span>本地静态原型 · 不触发真实训练</span></footer></main></div></div>`;
}

function shellC(content) {
  return `<div class="c-app">${cNav()}<div class="c-canvas"><header class="c-topbar"><div><span class="c-product">ModelForge</span><span class="c-separator">/</span><strong>模型训练</strong></div><label class="c-global-search">${icon('search', 15)}<span class="visually-hidden">搜索训练任务</span><input type="search" placeholder="搜索任务、数据或 Adapter" data-other></label><div class="c-top-actions"><span class="c-system-state"><i></i>系统正常</span><button type="button" data-other aria-label="通知">${icon('bell', 17)}</button><span class="c-user">LS</span></div></header><main id="main">${content}<footer class="c-footer"><span>MODELFORGE · TRAINING LAB</span><span>本地静态原型 · 不触发真实训练</span></footer></main></div></div>`;
}

function renderShell(content) {
  if (isB2) return shellB2(content);
  if (variant === 'b') return shellB(content);
  if (variant === 'c') return shellC(content);
  return shellA(content);
}

function jobMatches(job) {
  if (state.filter === 'running' && !['running', 'syncing', 'preparing', 'cleanup'].includes(job.state)) return false;
  if (state.filter === 'attention' && !['failed', 'waiting_instance'].includes(job.state)) return false;
  if (state.filter === 'succeeded' && job.state !== 'succeeded') return false;
  const query = state.query.trim().toLowerCase();
  if (!query) return true;
  return [job.name, job.dataset, job.base, `attempt ${job.number}`].join(' ').toLowerCase().includes(query);
}

function filteredJobs() {
  return jobs.filter(jobMatches);
}

function stats() {
  return {
    total: jobs.length,
    running: jobs.filter(job => ['running', 'syncing', 'preparing'].includes(job.state)).length,
    attention: jobs.filter(job => ['failed', 'waiting_instance'].includes(job.state)).length,
    artifacts: 3,
  };
}

function filterButtons() {
  const items = [
    ['all', '全部', jobs.length],
    ['running', '运行中', stats().running],
    ['attention', '需处理', stats().attention],
    ['succeeded', '已成功', jobs.filter(job => job.state === 'succeeded').length],
  ];
  return `<div class="filter-tabs" role="group" aria-label="筛选训练任务">${items.map(([key, label, count]) => `<button type="button" data-filter="${key}" class="${state.filter === key ? 'active' : ''}" aria-pressed="${state.filter === key}">${label}<b>${count}</b></button>`).join('')}</div>`;
}

function rowA(job) {
  return `<button type="button" class="a-job-row ${job.id === state.selectedId ? 'selected' : ''}" data-job="${job.id}" data-search="${esc([job.name, job.dataset, job.base].join(' '))}">
    <span class="a-job-main"><span class="a-status-mark ${tones[job.state]}"></span><span><strong>${esc(job.name)}</strong><small>${esc(job.dataset)} · ${job.datasetVersion} / ${esc(job.base)} · ${job.baseVersion}</small></span></span>
    <span class="a-job-attempt mono">#${String(job.number).padStart(2, '0')}</span>
    <span class="a-job-state">${status(job)}</span>
    <span class="a-job-progress"><span>${job.progress}%</span>${progress(job)}<small>${job.step}/${job.totalSteps} steps</small></span>
    <span class="a-job-loss mono">${metric(job.loss)}</span>
    <span class="a-job-time">${job.updated}</span>
    <span class="a-row-arrow">${icon('chevronRight', 15)}</span>
  </button>`;
}

function selectedPanelA(job) {
  return `<aside class="a-inspector">
    <header class="a-inspector-head"><div><span>FOCUSED ATTEMPT</span><h2>Attempt #${String(job.number).padStart(2, '0')}</h2></div>${status(job)}</header>
    <div class="a-inspector-name"><strong>${esc(job.name)}</strong><span>${esc(job.dataset)} · ${job.datasetVersion} → ${esc(job.base)}</span></div>
    <div class="a-inspector-progress"><div><span>训练进度</span><strong>${job.step}<small> / ${job.totalSteps} steps</small></strong></div>${progress(job)}<div class="a-progress-caption"><span>${job.progress}%</span><span>${job.elapsed}</span></div></div>
    <div class="a-live-chart"><div class="chart-caption"><span>LIVE LOSS</span><strong class="mono">${metric(job.loss)}</strong><small>eval ${metric(job.evalLoss)}</small></div>${lossChart('a', 150)}</div>
    <dl class="a-inspector-facts">
      <div><dt>GPU</dt><dd>${esc(job.gpu)}</dd></div>
      <div><dt>吞吐</dt><dd>${esc(job.throughput)}</dd></div>
      <div><dt>实例</dt><dd class="mono">${esc(job.instance)}</dd></div>
      <div><dt>更新</dt><dd class="mono">${job.updated}</dd></div>
    </dl>
    <div class="a-note">${icon(job.state === 'failed' ? 'alert' : 'layers', 15)}<span>${esc(job.note)}</span></div>
    <div class="a-inspector-actions"><button type="button" class="a-primary" data-action="open-job" data-job="${job.id}">查看运行详情 ${icon('arrow', 15)}</button><button type="button" class="a-quiet" data-action="copy-id" data-id="${job.id}">${icon('copy', 15)}</button></div>
  </aside>`;
}

function overviewA() {
  const s = stats();
  const selected = selectedJob();
  return `<div class="a-page">
    <header class="a-page-head"><div>${pageEyebrow('TRAINING CONTROL PLANE')}<h1>训练控制台</h1><p>用冻结输入、执行证据与产物状态管理每一次 SFT + LoRA Attempt。</p></div><div class="a-page-actions">${button('刷新状态', 'refresh', 'quiet', 'refresh')}${button('新建训练', 'new-training', 'primary', 'plus')}</div></header>
    <section class="a-command-bar" aria-label="训练运行概况">
      <div class="a-command-lead"><span class="status-dot"></span><span><strong>运行边界正常</strong><small>单 GPU 租约 · 训练与推理互斥</small></span></div>
      <div class="a-command-metric"><span>历史 Attempt</span><strong class="mono">${String(s.total).padStart(2, '0')}</strong></div>
      <div class="a-command-metric"><span>正在运行</span><strong class="mono">${String(s.running).padStart(2, '0')}</strong></div>
      <div class="a-command-metric attention"><span>需要处理</span><strong class="mono">${String(s.attention).padStart(2, '0')}</strong></div>
      <div class="a-command-metric"><span>可用 Adapter</span><strong class="mono">0${s.artifacts}</strong></div>
      <div class="a-gpu-strip"><i></i><span><strong>RTX 4090</strong><small>1 卡租约中 · 作业 #07</small></span></div>
    </section>
    <div class="a-dashboard-grid">
      <section class="a-jobs-panel">
        <header class="a-panel-head"><div><span>ATTEMPT INDEX</span><h2>训练尝试</h2></div><div class="a-jobs-tools"><label class="a-search">${icon('search', 14)}<span class="visually-hidden">搜索训练任务</span><input type="search" placeholder="搜索任务 / 数据 / 基座" data-job-search></label><button type="button" class="a-icon-btn" data-other aria-label="更多筛选">${icon('filter', 15)}</button></div></header>
        <div class="a-filter-row">${filterButtons()}<span class="a-filter-meta">按最后更新时间排序</span></div>
        <div class="a-table-head"><span>任务与输入</span><span>ATTEMPT</span><span>状态</span><span>进度</span><span>LOSS</span><span>更新</span><span></span></div>
        <div class="a-job-list">${filteredJobs().map(rowA).join('') || '<div class="empty-result">没有匹配当前筛选条件的训练任务。</div>'}</div>
        <footer class="a-table-foot"><span>显示 ${filteredJobs().length} / ${jobs.length} 个 Attempt</span><button type="button" data-other>查看任务归档 ${icon('arrowUpRight', 13)}</button></footer>
      </section>
      ${selectedPanelA(selected)}
    </div>
    <div class="a-lower-grid">
      <section class="a-queue-panel"><header class="a-panel-head"><div><span>EXECUTION QUEUE</span><h2>下一步行动</h2></div><span class="a-mini-badge">2 项</span></header><div class="a-action-list"><a href="#detail" data-action="open-job" data-job="attempt-03"><span class="a-action-code">01</span><span><strong>关联手动创建的收费实例</strong><small>售后情绪识别 · Attempt #03 · 等待实例 ID</small></span>${icon('arrow', 15)}</a><a href="#detail" data-action="open-job" data-job="attempt-05"><span class="a-action-code danger">02</span><span><strong>检查远程进程异常退出</strong><small>runtime_exited · 诊断日志与租约释放已保留</small></span>${icon('arrow', 15)}</a></div></section>
      <section class="a-artifact-panel"><header class="a-panel-head"><div><span>ARTIFACT GATE</span><h2>产物发布</h2></div><span class="a-mini-badge ok">3 可用</span></header><div class="a-artifact-row"><span class="a-artifact-icon">${icon('model', 18)}</span><span><strong>FAQ 改写适配 · Attempt #06</strong><small>Best 0.2148 / Final 146 steps</small></span><span class="a-ready">${icon('check', 13)} MinIO 已校验</span></div><div class="a-artifact-row"><span class="a-artifact-icon">${icon('model', 18)}</span><span><strong>客服摘要 · Attempt #02</strong><small>Best 0.2846 / Final 132 steps</small></span><span class="a-ready">${icon('check', 13)} 可试用</span></div></section>
      <section class="a-policy-panel"><header class="a-panel-head"><div><span>RUNTIME BASELINE</span><h2>兼容边界</h2></div><span class="a-mini-badge">partial</span></header><dl><div><dt>基座</dt><dd>Qwen3-0.6B</dd></div><div><dt>GPU</dt><dd>单卡 RTX 4090</dd></div><div><dt>训练栈</dt><dd>LLaMA-Factory 0.9.5</dd></div><div><dt>推理栈</dt><dd>vLLM 0.32.0</dd></div></dl><p>${icon('alert', 14)} 容量边界与更广模型矩阵仍未锁定。</p></section>
    </div>
  </div>`;
}

function overviewB() {
  const active = jobs[0];
  const selected = selectedJob();
  return `<div class="b-page">
    <header class="b-hero">
      <div class="b-hero-index">07</div>
      <div class="b-hero-copy">${pageEyebrow('TRAINING LEDGER / 2026.11.03')}<h1>训练铸程台</h1><p>把数据、基座与算力压进同一条可追溯的铸程记录。观察每一次温度、损失与产物的变化。</p><div class="b-hero-stats"><span><b>${jobs.length}</b> 次尝试</span><span><b>${stats().running}</b> 条运行中</span><span><b>${stats().attention}</b> 项待处理</span><span><b>03</b> 份 Adapter</span></div></div>
      <div class="b-hero-actions">${button('刷新状态', 'refresh', 'b-outline', 'refresh')}${button('开始新锻造', 'new-training', 'b-solid', 'plus')}</div>
    </header>
    <section class="b-spotlight">
      <article class="b-active-run">
        <div class="b-active-top"><span class="b-live">${icon('activity', 15)} LIVE RUN</span>${status(active, 'b-status')}<span class="b-attempt mono">ATTEMPT 07 / 10:08 — NOW</span></div>
        <div class="b-active-title"><h2>${esc(active.name)}</h2><span>${esc(active.dataset)} ${active.datasetVersion} → ${esc(active.base)} ${active.baseVersion}</span></div>
        <div class="b-active-progress"><strong>${active.progress}<small>%</small></strong><div><span>${active.step} / ${active.totalSteps} STEPS</span><div class="b-progress"><i style="width:${active.progress}%"></i></div><small>${active.elapsed} · ${esc(active.throughput)}</small></div></div>
        <div class="b-active-chart"><div class="b-chart-head"><span>训练 / 验证 LOSS</span><strong class="mono">${metric(active.loss)}</strong><small>eval ${metric(active.evalLoss)}</small></div>${lossChart('b', 190)}</div>
        <div class="b-active-foot"><span><b>${esc(active.gpu)}</b><small>${esc(active.region)}</small></span><span><b class="mono">${esc(active.instance)}</b><small>手动实例 · 租约持有中</small></span><div><button type="button" data-action="open-job" data-job="${active.id}">查看锻造记录 ${icon('arrow', 15)}</button></div></div>
      </article>
      <aside class="b-queue">
        <header><span>下一批工作</span><b class="mono">QUEUE / ${stats().attention}</b></header>
        <a href="#detail" data-action="open-job" data-job="attempt-03"><span class="b-queue-no mono">03</span><span><strong>售后情绪识别</strong><small>等待手动实例 ID</small></span><em>${status(jobs[1])}</em></a>
        <a href="#detail" data-action="open-job" data-job="attempt-05"><span class="b-queue-no mono danger">05</span><span><strong>多轮对话增强</strong><small>远程进程异常退出</small></span><em>${status(jobs[3])}</em></a>
        <div class="b-queue-rule"><span>运行边界</span><p>同一个 GPU 租约不会同时承载训练和推理。释放确认前不创建下一台实例。</p></div>
        <div class="b-queue-foot"><span class="status-dot"></span><span><strong>RTX 4090 租约中</strong><small>作业 #07 占用 1 卡</small></span></div>
      </aside>
    </section>
    <section class="b-ledger">
      <header class="b-section-head"><div>${pageEyebrow('ATTEMPT REGISTER')}<h2>全部锻造记录</h2></div><div class="b-ledger-tools">${filterButtons()}<label class="b-search">${icon('search', 14)}<span class="visually-hidden">搜索训练任务</span><input type="search" placeholder="搜索任务 / 数据 / 基座" data-job-search></label></div></header>
      <div class="b-register">
        ${filteredJobs().map(job => `<button type="button" class="b-register-row ${job.id === selected.id ? 'selected' : ''}" data-job="${job.id}" data-search="${esc([job.name, job.dataset, job.base].join(' '))}">
          <span class="b-register-no mono">${String(job.number).padStart(2, '0')}</span>
          <span class="b-register-title"><strong>${esc(job.name)}</strong><small>${esc(job.dataset)} ${job.datasetVersion} · ${esc(job.base)} ${job.baseVersion}</small></span>
          <span>${status(job)}</span>
          <span class="b-register-progress"><b>${job.progress}%</b>${sparkline(job.loss == null ? [0.7, 0.7, 0.7] : [0.79, 0.71, 0.62, 0.51, 0.44], tones[job.state] === 'danger' ? '#b13f32' : '#d66b42')}</span>
          <span class="b-register-loss"><small>EVAL LOSS</small><b class="mono">${metric(job.evalLoss)}</b></span>
          <span class="b-register-time"><small>${job.updated}</small><b>${job.elapsed}</b></span>
          <span class="b-register-arrow">${icon('arrowUpRight', 16)}</span>
        </button>`).join('') || '<div class="b-empty">没有匹配当前筛选条件的记录。</div>'}
      </div>
    </section>
    <section class="b-lower">
      <article class="b-delivered"><span>${pageEyebrow('RECENTLY DELIVERED')}</span><h3>Best / Final 已发布</h3><p>FAQ 改写适配 · Attempt #06</p><div><span><small>BEST EVAL LOSS</small><b class="mono">0.2148</b></span><span><small>FINAL STEP</small><b class="mono">146</b></span><span><small>STORAGE</small><b>MinIO verified</b></span></div><a href="#detail/artifacts" data-action="open-job" data-job="attempt-06">打开产物证据 ${icon('arrow', 15)}</a></article>
      <article class="b-baseline"><span>${pageEyebrow('FORGE BOUNDARY')}</span><h3>兼容基线仍为 partial</h3><p>Qwen3-0.6B × RTX 4090 × LLaMA-Factory 0.9.5 已完成当前组合验证；容量边界和更广模型矩阵尚未锁定。</p><ul><li>内容指纹不匹配的基座不可进入训练</li><li>训练前执行真实 tokenizer 预检</li><li>失败与取消不发布部分 Adapter</li></ul></article>
      <article class="b-pulse"><span>${pageEyebrow('SYSTEM PULSE')}</span><div class="b-pulse-main"><strong>4/4</strong><small>服务响应正常</small></div><dl><div><dt>API</dt><dd>4ms</dd></div><div><dt>PostgreSQL</dt><dd>12ms</dd></div><div><dt>MinIO</dt><dd>18ms</dd></div><div><dt>Worker</dt><dd>7ms</dd></div></dl></article>
    </section>
  </div>`;
}

function overviewB2() {
  const active = jobs[0];
  const selected = selectedJob();
  return `<div class="b-page b2-page b2-overview">
    <header class="b2-page-head">
      <div class="b2-page-heading">
        <h1>训练工作台</h1>
        <p>创建、观察并验收每一次 SFT + LoRA 训练。冻结输入、执行状态与产物证据保持可追溯。</p>
      </div>
      <div class="b2-page-actions">${button('刷新状态', 'refresh', 'quiet', 'refresh')}${button('新建训练', 'new-training', 'primary', 'plus')}</div>
    </header>

    <section class="b2-summary-strip" aria-label="训练运行概况">
      <div><span>历史 Attempt</span><strong class="mono">${String(jobs.length).padStart(2, '0')}</strong><small>全部保留可追溯记录</small></div>
      <div><span>正在运行</span><strong class="mono">${String(stats().running).padStart(2, '0')}</strong><small>单 GPU 租约占用 1 卡</small></div>
      <div class="attention"><span>需要处理</span><strong class="mono">${String(stats().attention).padStart(2, '0')}</strong><small>等待实例与进程异常</small></div>
      <div><span>可用 Adapter</span><strong class="mono">03</strong><small>Best / Final 已完成校验</small></div>
    </section>

    <div class="b2-overview-grid">
      <article class="b2-current-run">
        <header class="b2-card-head">
          <div class="b2-live-label"><span class="b2-live-dot"></span><span>当前训练</span>${status(active)}</div>
          <span class="b2-attempt-id mono">ATTEMPT #${String(active.number).padStart(2, '0')} · ${active.created}</span>
        </header>
        <div class="b2-run-title">
          <div><h2>${esc(active.name)}</h2><p>${esc(active.dataset)} ${active.datasetVersion} → ${esc(active.base)} ${active.baseVersion} · ${esc(active.gpu)}</p></div>
          <button type="button" data-action="open-job" data-job="${active.id}">查看运行详情 ${icon('arrow', 15)}</button>
        </div>
        <div class="b2-run-progress">
          <div class="b2-progress-total"><strong>${active.progress}<small>%</small></strong><span>${active.step} / ${active.totalSteps} steps</span></div>
          <div class="b2-progress-copy"><div><span>训练进度</span><b>${active.elapsed} · ${esc(active.throughput)}</b></div>${progress(active)}<small>当前阶段：${esc(active.stage)}，预计按 token 预算继续执行</small></div>
        </div>
        <dl class="b2-live-facts">
          <div><dt>Train Loss</dt><dd class="mono">${metric(active.loss)}</dd><small>最近 20 step ↓ 4.8%</small></div>
          <div><dt>Eval Loss</dt><dd class="mono">${metric(active.evalLoss)}</dd><small>step ${active.step} · 有效</small></div>
          <div><dt>Learning Rate</dt><dd class="mono">${esc(active.learningRate)}</dd><small>cosine · warmup 0</small></div>
          <div><dt>吞吐</dt><dd class="mono">${esc(active.throughput)}</dd><small>batch 1 · grad accum 1</small></div>
        </dl>
        <div class="b2-curve-panel">
          <header>
            <div><strong>训练 / 验证 Loss</strong></div>
            <div class="b2-legend"><span><i class="train"></i>train</span><span><i class="eval"></i>eval</span><span class="mono">step ${active.step} / ${active.totalSteps}</span></div>
          </header>
          ${lossChart('b2', 172, active)}
        </div>
        <section class="b2-health-strip" aria-label="训练运行健康度">
          <header><div><strong>运行健康度</strong><span>最近采样 step ${active.step}</span></div><button type="button" data-action="open-job" data-job="${active.id}" data-tab="analysis">运行分析 ${icon('arrow', 14)}</button></header>
          <div>
            <span><small>Learning Rate</small><b class="mono">${esc(active.learningRate)}</b><em>cosine · 与配置一致</em></span>
            <span><small>Gradient Norm</small><b class="mono">0.84</b><em class="warning">阈值 1.00 · 1 次裁剪</em></span>
            <span><small>显存</small><b class="mono">18.6 / 24 GB</b><em>峰值 19.2 GB · 无 OOM</em></span>
            <span><small>吞吐</small><b class="mono">${esc(active.throughput)}</b><em>step time 3.2 s</em></span>
          </div>
        </section>
        <footer class="b2-run-foot">
          <span><small>执行实例</small><b class="mono">${esc(active.instance)}</b><em>${esc(active.region)} · 租约持有中</em></span>
          <span><small>输入样本</small><b class="mono">${active.samples} 条</b><em>data ${active.datasetVersion} · base ${active.baseVersion}</em></span>
          <span><small>产物门禁</small><b>0 / 2 未发布</b><em>训练结束并校验后发布</em></span>
        </footer>
      </article>

      <aside class="b2-inbox">
        <section class="b2-attention-card">
          <header><div><h2>下一步行动</h2></div><b class="mono">${String(stats().attention).padStart(2, '0')}</b></header>
          <a href="#detail" data-action="open-job" data-job="attempt-03">
            <span class="b2-action-index mono">03</span>
            <span><strong>等待手动创建实例</strong><small>售后情绪识别 · 需要回填实例 ID</small></span>
            ${icon('chevronRight', 15)}
          </a>
          <a href="#detail" data-action="open-job" data-job="attempt-05">
            <span class="b2-action-index danger mono">05</span>
            <span><strong>远程进程异常退出</strong><small>runtime_exited · 实例已停止并释放</small></span>
            ${icon('chevronRight', 15)}
          </a>
          <div class="b2-boundary-note">${icon('alert', 15)}<p><strong>运行边界</strong> 同一 GPU 租约不会同时承载训练与推理；释放确认前不创建下一台实例。</p></div>
        </section>

        <section class="b2-resource-card">
          <header><div><h2>计算资源</h2></div><span class="b2-resource-state"><i></i>占用中</span></header>
          <div class="b2-resource-main"><strong class="mono">1 / 1</strong><span><b>RTX 4090 · 24 GB</b><small>当前由 Attempt #07 持有</small></span></div>
          <div class="b2-capacity-track"><span></span></div>
          <dl>
            <div><dt>地域</dt><dd>cn-bj2 / cn-bj2-02</dd></div>
            <div><dt>实例</dt><dd class="mono">${esc(active.instance)}</dd></div>
            <div><dt>释放条件</dt><dd>产物同步与进程退出均确认</dd></div>
          </dl>
        </section>
      </aside>
    </div>

    <section class="b2-ledger">
      <header class="b2-ledger-head">
        <div><h2>全部训练记录</h2><p>状态、进度、指标与最近更新时间在同一行内对齐，便于快速定位。</p></div>
        <div class="b2-ledger-tools">${filterButtons()}<label class="b2-search">${icon('search', 15)}<span class="visually-hidden">搜索训练任务</span><input type="search" placeholder="搜索任务 / 数据 / 基座" data-job-search></label></div>
      </header>
      <div class="b2-table" aria-label="训练记录">
        <div class="b2-table-head">
          <span>任务与输入</span><span>状态</span><span>进度</span><span>Train / Eval Loss</span><span>最近更新</span><span></span>
        </div>
        ${filteredJobs().map(job => `<button type="button" class="b2-table-row ${job.id === selected.id ? 'selected' : ''}" data-job="${job.id}" data-search="${esc([job.name, job.dataset, job.base].join(' '))}">
          <span class="b2-row-task"><span class="b2-row-index mono">#${String(job.number).padStart(2, '0')}</span><span><strong>${esc(job.name)}</strong><small>${esc(job.dataset)} ${job.datasetVersion} · ${esc(job.base)} ${job.baseVersion} · ${job.samples} 条样本</small></span></span>
          <span class="b2-row-status">${status(job)}</span>
          <span class="b2-row-progress"><span><b>${job.progress}%</b><small>${job.step} / ${job.totalSteps} steps</small></span><i><em style="width:${job.progress}%"></em></i></span>
          <span class="b2-row-metric"><b class="mono">${metric(job.loss)}</b><small class="mono">eval ${metric(job.evalLoss)}</small></span>
          <span class="b2-row-update"><b class="mono">${job.updated}</b><small>${job.elapsed}</small></span>
          <span class="b2-row-arrow">${icon('chevronRight', 15)}</span>
        </button>`).join('') || '<div class="b2-empty">没有匹配当前筛选条件的训练记录。</div>'}
      </div>
      <footer class="b2-ledger-foot"><span>显示 ${filteredJobs().length} / ${jobs.length} 个 Attempt</span><button type="button" data-other>查看完整归档 ${icon('arrowUpRight', 13)}</button></footer>
    </section>

    <section class="b2-bottom-panel">
      <article>
        <h3>最近产物已发布</h3>
        <p>FAQ 改写适配 · Attempt #06 已通过 MinIO 写入与回读校验。</p>
        <dl><div><dt>Best Eval</dt><dd class="mono">0.2148</dd></div><div><dt>Final Step</dt><dd class="mono">146</dd></div><div><dt>发布门禁</dt><dd>2 / 2</dd></div></dl>
        <a href="#detail/artifacts" data-action="open-job" data-job="attempt-06">打开产物证据 ${icon('arrow', 14)}</a>
      </article>
      <article>
        <h3>兼容基线仍为 partial</h3>
        <p>Qwen3-0.6B × RTX 4090 × LLaMA-Factory 0.9.5 已完成当前组合验证，容量边界与更广模型矩阵仍未锁定。</p>
        <ul><li>基座内容指纹不匹配时不可提交</li><li>训练前执行真实 tokenizer 预检</li><li>失败或取消不发布部分 Adapter</li></ul>
      </article>
      <article>
        <h3>系统状态</h3>
        <div class="b2-service-score"><strong>4 / 4</strong><span><b>依赖已就绪</b><small>最近检查 10:32:18</small></span></div>
        <dl class="b2-service-list"><div><dt>API</dt><dd class="mono">4 ms</dd></div><div><dt>PostgreSQL</dt><dd class="mono">12 ms</dd></div><div><dt>MinIO</dt><dd class="mono">18 ms</dd></div><div><dt>Worker</dt><dd class="mono">7 ms</dd></div></dl>
      </article>
    </section>
  </div>`;
}

function runListC() {
  return `<aside class="c-runlist">
    <div class="c-runlist-head"><div><span>RUNS</span><strong>训练记录</strong></div><button type="button" data-action="new-training" aria-label="新建训练">${icon('plus', 16)}</button></div>
    <label class="c-search">${icon('search', 14)}<span class="visually-hidden">搜索训练任务</span><input type="search" placeholder="搜索训练任务" data-job-search></label>
    <div class="c-runlist-filters">${filterButtons()}</div>
    <div class="c-run-items">${filteredJobs().map(job => `<button type="button" class="c-run-item ${job.id === state.selectedId ? 'selected' : ''}" data-job="${job.id}" data-search="${esc([job.name, job.dataset, job.base].join(' '))}">
      <span class="c-run-top"><span class="mono">#{${String(job.number).padStart(2, '0')}}</span>${status(job)}</span>
      <strong>${esc(job.name)}</strong>
      <small>${esc(job.dataset)} ${job.datasetVersion} · ${job.progress}%</small>
      <span class="c-run-spark">${sparkline(job.loss == null ? [0.65, 0.65, 0.65, 0.65] : [0.79, 0.72, 0.61, 0.52, 0.44], tones[job.state] === 'danger' ? '#c14b4a' : '#0c62d6', 90, 22)}<b class="mono">${metric(job.evalLoss)}</b></span>
    </button>`).join('') || '<div class="c-empty">暂无匹配记录</div>'}</div>
    <div class="c-runlist-foot"><span>${filteredJobs().length} of ${jobs.length} attempts</span><span class="mono">120 SAMPLES</span></div>
  </aside>`;
}

function contextC(job) {
  return `<aside class="c-context">
    <header><span>RUN CONTEXT</span><button type="button" data-other aria-label="更多">${icon('more', 17)}</button></header>
    <div class="c-context-block"><small>INPUT SNAPSHOT</small><strong>${esc(job.dataset)} · ${job.datasetVersion}</strong><span>${job.samples} samples · split 10%</span><span class="mono">split-4f82b9d1</span></div>
    <div class="c-context-block"><small>BASE MODEL</small><strong>${esc(job.base)} · ${job.baseVersion}</strong><span>Qwen3 · external readonly</span><span class="mono">Qwen3-0.6B-20261102-r1</span></div>
    <div class="c-context-block"><small>COMPUTE</small><strong>${esc(job.gpu)} · 24 GB</strong><span>${esc(job.region)}</span><span class="mono">${esc(job.instance)}</span></div>
    <div class="c-context-block"><small>OUTPUT</small><strong>${job.artifact ? 'Best / Final Adapter' : '尚未发布'}</strong><span>${esc(job.note)}</span></div>
    <div class="c-context-block subtle"><small>TRAINING MODE</small><strong>SFT + LoRA</strong><span>qwen3_nothink · rank 8 · cutoff 512</span></div>
    <button type="button" class="c-context-link" data-action="view-tab" data-tab="config">查看冻结输入与参数 ${icon('arrow', 14)}</button>
  </aside>`;
}

function inspectorC(job) {
  return `<section class="c-inspector">
    <header class="c-inspector-head"><div><span>ATTEMPT #${String(job.number).padStart(2, '0')}</span><h1>${esc(job.name)}</h1><p>${esc(job.dataset)} ${job.datasetVersion} → ${esc(job.base)} ${job.baseVersion}</p></div><div class="c-head-actions">${status(job)}<button type="button" data-action="open-job" data-job="${job.id}">${icon('arrowUpRight', 15)}</button></div></header>
    <div class="c-hero-metrics">
      <article class="c-metric-main"><span>训练进度</span><div><strong>${job.progress}<small>%</small></strong>${status(job)}</div>${progress(job)}<p>${job.step} of ${job.totalSteps} steps · ${job.elapsed}</p></article>
      <article><span>Train Loss</span><strong class="mono">${metric(job.loss)}</strong><small>最近 20 step ↓ 4.8%</small></article>
      <article><span>Eval Loss</span><strong class="mono">${metric(job.evalLoss)}</strong><small>${job.evalLoss ? '最低有效验证 Loss' : '尚未取得验证结果'}</small></article>
      <article><span>Learning Rate</span><strong class="mono">${job.learningRate}</strong><small>cosine · warmup 0</small></article>
    </div>
    <div class="c-chart-card">
      <header><div><span>LOSS PROFILE</span><strong>训练与验证 Loss</strong></div><div class="c-legend"><span><i class="train"></i>train</span><span><i class="eval"></i>eval</span></div></header>
      ${lossChart('c', 215)}
    </div>
    <div class="c-tabbar" role="tablist" aria-label="运行详情视图">
      ${detailTabs(job)}
      <span class="c-tabbar-note">自动刷新 2.5s</span>
    </div>
    <div class="c-tab-content">${detailContent(job, true)}</div>
  </section>`;
}

function overviewC() {
  const job = selectedJob();
  return `<div class="c-page">
    <header class="c-pagehead"><div>${pageEyebrow('TRAINING / SIGNAL LAB')}<h1>训练实验台</h1><p>把训练任务当作可观测实验：左侧定位运行，中间读取信号，右侧核对冻结输入与产物。</p></div><div class="c-pagehead-actions">${button('刷新', 'refresh', 'c-soft', 'refresh')}${button('新建训练', 'new-training', 'c-primary', 'plus')}</div></header>
    <div class="c-overview-grid">${runListC()}${inspectorC(job)}${contextC(job)}</div>
    <section class="c-bottom-strip">
      <article><span>NEXT ACTION</span><strong>关联实例以继续训练</strong><p>售后情绪识别 · Attempt #03 正在等待手动创建收费实例。</p><button type="button" data-action="open-job" data-job="attempt-03">处理等待任务 ${icon('arrow', 14)}</button></article>
      <article class="attention"><span>ATTENTION</span><strong>1 个远程进程异常退出</strong><p>日志与实例回收证据已保留，未发布部分 Adapter。</p><button type="button" data-action="open-job" data-job="attempt-05">查看诊断 ${icon('arrow', 14)}</button></article>
      <article class="capacity"><span>GPU CAPACITY</span><strong>1 / 1 租约占用</strong><div class="c-capacity-bar"><span style="width:100%"></span></div><p>RTX 4090 · 当前由训练 Attempt #07 持有。推理试用需等待租约释放。</p></article>
      <article class="artifact"><span>ARTIFACTS</span><strong>3 个 Adapter 可用</strong><p>Best / Final 只在训练成功、产物回传并完成 MinIO 校验后发布。</p><a href="#detail/artifacts" data-action="open-job" data-job="attempt-06">打开产物 ${icon('arrow', 14)}</a></article>
    </section>
  </div>`;
}

function fieldA() {
  return '';
}

function inputStep() {
  const c = state.create;
  const nameError = state.create.errorField === 'name' ? state.create.error : '';
  return `<section class="form-section">
    <header><span>01 / 04</span><div><h2>任务与输入</h2><p>冻结数据集版本、基座版本与任务身份。后续 Attempt 只能复用同一份输入快照。</p></div></header>
    <div class="field-grid">
      <label class="field span-2 ${nameError ? 'has-error' : ''}"><span>任务名称 <b>必填</b></span><input id="field-name" data-create-field="name" value="${esc(c.name)}" maxlength="160" placeholder="例如：客服意图 LoRA · Qwen3" aria-invalid="${nameError ? 'true' : 'false'}" aria-describedby="hint-name${nameError ? ' error-name' : ''}"><small id="hint-name">用于在任务账本中识别本次训练，最多 160 个字符。</small>${nameError ? `<span class="field-error" id="error-name">${icon('alert', 14)}${esc(nameError)}</span>` : ''}</label>
      <label class="field"><span>已发布数据版本</span><select data-create-field="dataset"><option>${esc(c.dataset)}</option><option>售后话术修订 · v2</option><option>FAQ 改写语料 · v4</option></select><small>120 条有效样本 · 训练 108 / 验证 12</small></label>
      <label class="field"><span>已验证基础模型</span><select data-create-field="base"><option>${esc(c.base)}</option><option disabled>Qwen3-1.7B · v2（未进入兼容基线）</option></select><small>内容指纹已列入当前兼容基线</small></label>
    </div>
    <div class="baseline-callout"><span class="callout-icon">${icon('check', 15)}</span><div><strong>输入组合可提交</strong><p>Qwen3-0.6B × qwen3 · RTX 4090 · 当前训练栈匹配。提交后数据集拆分与指纹将写入不可变快照。</p></div></div>
  </section>`;
}

function computeStep() {
  const c = state.create;
  return `<section class="form-section">
    <header><span>02 / 04</span><div><h2>执行边界</h2><p>首版只使用已验收的单卡组合。平台不会采购或预留收费实例。</p></div></header>
    <div class="compute-choice selected"><span class="compute-check">${icon('check', 14)}</span><div><span class="compute-kicker">VERIFIED BLUEPRINT</span><strong>${esc(c.hardware)}</strong><p>${esc(c.region)} · ${esc(c.image)} · 100 GB CLOUD_SSD</p></div><span class="compute-badge">兼容基线</span></div>
    <div class="field-grid compute-fields">
      <label class="field"><span>地域 / 可用区</span><input data-create-field="region" value="${esc(c.region)}" disabled></label>
      <label class="field"><span>运行镜像</span><input data-create-field="image" value="${esc(c.image)}" disabled></label>
      <label class="field"><span>计费方式</span><input data-create-field="billing" value="${esc(c.billing)}" disabled></label>
      <label class="field"><span>实例归属</span><input value="手动创建 · 平台停止并删除" disabled></label>
    </div>
    <div class="execution-warning"><span>${icon('alert', 16)}</span><div><strong>训练开始前仍需手动创建收费实例</strong><p>提交任务后进入“等待实例”。你需要在优云控制台创建符合规格的实例，并回填实例 ID 与清理授权。</p></div></div>
  </section>`;
}

function paramsStep() {
  const c = state.create;
  const seedError = state.create.errorField === 'seed' ? state.create.error : '';
  const rows = [
    ['训练轮数', paramsPreview.epochs, '固定'],
    ['学习率', paramsPreview.learning_rate, '固定'],
    ['最大 Token', paramsPreview.cutoff_len, '固定'],
    ['批大小', paramsPreview.batch_size, '固定'],
    ['梯度累积', paramsPreview.gradient_accumulation, '固定'],
    ['LoRA Rank', paramsPreview.lora_rank, '固定'],
    ['LoRA Alpha', paramsPreview.lora_alpha, '固定'],
    ['LoRA Dropout', paramsPreview.lora_dropout, '固定'],
    ['调度器', paramsPreview.scheduler, '固定'],
    ['预热比例', paramsPreview.warmup_ratio, '固定'],
    ['模型模板', paramsPreview.template, '固定'],
  ];
  return `<section class="form-section">
    <header><span>03 / 04</span><div><h2>训练参数</h2><p>当前仅开放真实跑通的参数预设；除随机种子外，各项与已验证运行时绑定。</p></div></header>
    <div class="locked-banner"><span>${icon('lock', 15)}</span><div><strong>兼容参数已锁定</strong><p>修改参数会使任务偏离当前兼容基线，提交将被后端拒绝。</p></div><span class="mono">${esc(paramsPreview.template)}</span></div>
    <div class="param-grid">${rows.map(([label, value, tag]) => `<div class="param-item"><span>${label}</span><strong class="mono">${value}</strong><small>${tag}</small></div>`).join('')}</div>
    <label class="field seed-field ${seedError ? 'has-error' : ''}"><span>训练随机种子 <b>可调整</b></span><input id="field-seed" data-create-field="seed" type="number" min="0" max="2147483647" value="${esc(c.seed)}" aria-invalid="${seedError ? 'true' : 'false'}" aria-describedby="hint-seed${seedError ? ' error-seed' : ''}"><small id="hint-seed">仅影响数据顺序与初始化噪声，不改变兼容基线。</small>${seedError ? `<span class="field-error" id="error-seed">${icon('alert', 14)}${esc(seedError)}</span>` : ''}</label>
  </section>`;
}

function reviewStep() {
  const c = state.create;
  return `<section class="form-section">
    <header><span>04 / 04</span><div><h2>提交确认</h2><p>核对任务身份、冻结输入与执行边界。提交后不会触发云购买。</p></div></header>
    <dl class="review-list">
      <div><dt>任务名称</dt><dd>${esc(c.name)}</dd></div>
      <div><dt>数据集</dt><dd>${esc(c.dataset)} <small>120 samples · split 10%</small></dd></div>
      <div><dt>基座模型</dt><dd>${esc(c.base)} <small>内容指纹已匹配</small></dd></div>
      <div><dt>执行实例</dt><dd>${esc(c.hardware)} <small>${esc(c.region)}</small></dd></div>
      <div><dt>训练方式</dt><dd>SFT + LoRA <small>qwen3_nothink · rank 8 · cutoff 512</small></dd></div>
      <div><dt>随机种子</dt><dd class="mono">${esc(c.seed)}</dd></div>
    </dl>
    <label class="field note-field"><span>备注 <i>可选</i></span><textarea data-create-field="note" rows="3" placeholder="记录本次训练的目的或判断依据">${esc(c.note)}</textarea></label>
    <div class="confirm-contract">${icon('lock', 16)}<p>提交后冻结数据集、基座、参数和实例规格；重试会创建新的 Attempt，不覆盖历史输入与产物。</p></div>
  </section>`;
}

function createSummary() {
  const c = state.create;
  return `<aside class="create-summary">
    <header><span>RUN MANIFEST</span><strong>任务冻结预览</strong></header>
    <dl>
      <div><dt>数据集</dt><dd data-bind="dataset">${esc(c.dataset)}</dd></div>
      <div><dt>基座</dt><dd data-bind="base">${esc(c.base)}</dd></div>
      <div><dt>算力</dt><dd data-bind="hardware">${esc(c.hardware)}</dd></div>
      <div><dt>方法</dt><dd>SFT + LoRA</dd></div>
      <div><dt>种子</dt><dd class="mono" data-bind="seed">${esc(c.seed)}</dd></div>
    </dl>
    <div class="summary-gate"><span class="status-dot"></span><div><strong>所有输入已就绪</strong><p>提交后立即进入“等待手动创建实例”。</p></div></div>
    <div class="summary-limit"><span>运行约束</span><p>单 GPU 互斥 · 训练成功但产物回传失败时保留实例 · 取消不发布部分 Adapter。</p></div>
    <button type="button" class="summary-submit" data-action="open-submit">${state.createStep === 4 ? '提交训练任务' : '继续填写'}</button>
    <p class="summary-hint">${state.createStep === 4 ? '不会产生云购买操作' : `第 ${state.createStep} / 4 步`}</p>
  </aside>`;
}

function createHeader(mode) {
  return `<header class="create-heading ${mode}"><div>${pageEyebrow('NEW TRAINING / FROZEN INPUT')}<h1>创建训练任务</h1><p>按四个步骤固定输入、执行边界与训练参数。每一步都可返回修改，提交时才形成不可变快照。</p></div><div class="create-head-actions">${button('返回训练', 'back-overview', 'quiet', 'chevronLeft')}<span class="create-draft">草稿保存于页面内</span></div></header>`;
}

function stepNav(mode = 'a') {
  return `<nav class="create-steps ${mode}" aria-label="创建训练步骤">${steps.map((step, index) => `<button type="button" data-goto-step="${index + 1}" class="${state.createStep === index + 1 ? 'active' : ''} ${state.createStep > index + 1 ? 'done' : ''}" ${index + 1 > state.createStep ? 'aria-disabled="true"' : ''}><span>${state.createStep > index + 1 ? icon('check', 13) : String(index + 1).padStart(2, '0')}</span><span><strong>${step.name}</strong><small>${step.hint}</small></span></button>`).join('')}</nav>`;
}

function formErrorMarkup() {
  if (!state.create.error) return '';
  return `<div class="form-error" role="alert" aria-live="assertive" data-form-error tabindex="-1">${icon('alert', 16)}<span>${esc(state.create.error)}</span></div>`;
}

function focusFormError() {
  requestAnimationFrame(() => {
    const summary = document.querySelector('[data-form-error]');
    if (summary) summary.focus();
  });
}

function focusCreateStep() {
  requestAnimationFrame(() => {
    const heading = document.querySelector('.form-section h2');
    if (!heading) return;
    heading.setAttribute('tabindex', '-1');
    heading.focus({ preventScroll: false });
  });
}

function focusCurrentDetail() {
  requestAnimationFrame(() => {
    const heading = document.querySelector('.a-detail-titleline h1, .b-detail-title h1, .b2-detail-title-row h1, .c-inspector-head h1');
    if (!heading) return;
    heading.setAttribute('tabindex', '-1');
    heading.focus({ preventScroll: false });
  });
}

function createA() {
  const body = state.createStep === 1 ? inputStep() : state.createStep === 2 ? computeStep() : state.createStep === 3 ? paramsStep() : reviewStep();
  return `<div class="a-page create-page">
    ${createHeader('a')}
    ${stepNav('a')}
    ${formErrorMarkup()}
    <div class="create-grid">${body}${createSummary()}</div>
    <div class="create-actions"><button type="button" class="btn quiet" data-action="prev-step" ${state.createStep === 1 ? 'disabled' : ''}>${icon('chevronLeft', 15)}上一步</button><span>步骤 ${state.createStep} / 4</span>${state.createStep < 4 ? `<button type="button" class="btn primary" data-action="next-step">下一步${icon('chevronRight', 15)}</button>` : `<button type="button" class="btn primary" data-action="open-submit">${icon('play', 15)}确认并提交</button>`}</div>
  </div>`;
}

function createB() {
  const body = state.createStep === 1 ? inputStep() : state.createStep === 2 ? computeStep() : state.createStep === 3 ? paramsStep() : reviewStep();
  return `<div class="b-page b-create-page">
    <header class="b-create-head"><div>${pageEyebrow('NEW FORGE ORDER / 04 STEPS')}<h1>签下一份训练锻造单</h1><p>每一步都在收紧边界。提交之后，数据、基座、参数与算力会一起被压入同一条不可变记录。</p></div><div class="b-order-stamp"><span>DRAFT</span><strong>${String(state.createStep).padStart(2, '0')}</strong><small>OF 04</small></div></header>
    <div class="b-create-layout">
      ${stepNav('b')}
      <div class="b-form-column">
        ${formErrorMarkup()}
        ${body}
        <div class="create-actions b-create-actions"><button type="button" class="btn b-outline" data-action="prev-step" ${state.createStep === 1 ? 'disabled' : ''}>${icon('chevronLeft', 15)}上一步</button>${state.createStep < 4 ? `<button type="button" class="btn b-solid" data-action="next-step">下一步 ${icon('arrow', 15)}</button>` : `<button type="button" class="btn b-solid" data-action="open-submit">签下并提交 ${icon('play', 15)}</button>`}</div>
      </div>
      ${createSummary()}
    </div>
  </div>`;
}

function createB2() {
  const body = state.createStep === 1 ? inputStep() : state.createStep === 2 ? computeStep() : state.createStep === 3 ? paramsStep() : reviewStep();
  return `<div class="b-page b2-page b2-create-page">
    <header class="b2-page-head b2-create-head">
      <div class="b2-page-heading">
        <h1>新建训练任务</h1>
        <p>按四个步骤固定输入、执行边界与训练参数。提交后形成不可变快照，重试不会覆盖历史 Attempt。</p>
      </div>
      <div class="b2-page-actions"><span class="b2-draft-state"><i></i>草稿保存于当前页面</span>${button('返回训练', 'back-overview', 'quiet', 'chevronLeft')}</div>
    </header>
    <div class="b2-create-layout">
      <aside class="b2-stepper">
        <header><span class="b2-kicker">配置步骤</span><strong class="mono">${state.createStep} / 4</strong></header>
        ${stepNav('b2')}
        <div class="b2-step-note">${icon('lock', 15)}<p><strong>提交时冻结</strong>数据版本、基座指纹、参数预设与实例规格会一起写入运行快照。</p></div>
      </aside>
      <section class="b2-create-main">
        ${formErrorMarkup()}
        ${body}
        <div class="b2-create-actions">
          <button type="button" class="btn quiet" data-action="prev-step" ${state.createStep === 1 ? 'disabled' : ''}>${icon('chevronLeft', 15)}上一步</button>
          <span>步骤 ${state.createStep} / 4</span>
          ${state.createStep < 4 ? `<button type="button" class="btn primary" data-action="next-step">下一步 ${icon('arrow', 15)}</button>` : `<button type="button" class="btn primary" data-action="open-submit">确认并提交 ${icon('play', 15)}</button>`}
        </div>
      </section>
      ${createSummary()}
    </div>
  </div>`;
}

function createC() {
  const body = state.createStep === 1 ? inputStep() : state.createStep === 2 ? computeStep() : state.createStep === 3 ? paramsStep() : reviewStep();
  return `<div class="c-page c-create-page">
    <header class="c-pagehead"><div>${pageEyebrow('NEW RUN / CONFIGURATION')}<h1>配置训练任务</h1><p>数据、模型与参数将以固定快照进入训练队列。当前页面只构建配置，不购买算力。</p></div><div class="c-pagehead-actions">${button('取消', 'back-overview', 'c-soft')}</div></header>
    ${stepNav('c')}
    ${formErrorMarkup()}
    <div class="c-create-grid"><div class="c-form-panel">${body}<div class="create-actions c-create-actions"><button type="button" class="btn c-soft" data-action="prev-step" ${state.createStep === 1 ? 'disabled' : ''}>${icon('chevronLeft', 15)}上一步</button><span>步骤 ${state.createStep} / 4</span>${state.createStep < 4 ? `<button type="button" class="btn c-primary" data-action="next-step">继续 ${icon('arrow', 15)}</button>` : `<button type="button" class="btn c-primary" data-action="open-submit">提交训练 ${icon('play', 15)}</button>`}</div></div>${createSummary()}</div>
  </div>`;
}

function detailTabs(job) {
  const tabs = [
    ['overview', '运行总览', 'activity'],
    ['analysis', '运行分析', 'spark'],
    ['logs', '实时日志', 'terminal'],
    ['artifacts', 'Checkpoint / 产物', 'layers'],
    ['config', '冻结输入', 'sliders'],
  ];
  return tabs.map(([key, label, iconName]) => `<button type="button" role="tab" data-detail-tab="${key}" aria-selected="${state.detailTab === key}" class="${state.detailTab === key ? 'active' : ''}">${icon(iconName, 15)}<span>${label}</span>${key === 'artifacts' ? `<b>${job.artifact ? 2 : 0}</b>` : ''}</button>`).join('');
}

function logConsole(job, mode = 'a') {
  return `<div class="console ${mode}">
    <header><div><span class="console-dot red"></span><span class="console-dot amber"></span><span class="console-dot green"></span><strong>Attempt #${String(job.number).padStart(2, '0')} / remote.log</strong></div><div><span>${icon('terminal', 13)} SSE</span><button type="button" data-other aria-label="下载日志">${icon('download', 14)}</button></div></header>
    <div class="console-toolbar"><button type="button" class="active" data-other>全部</button><button type="button" data-other>INFO</button><button type="button" data-other>STEP</button><label>${icon('search', 13)}<span class="visually-hidden">搜索日志</span><input type="search" placeholder="筛选日志" data-log-search></label><span class="console-follow"><i></i>跟随最新</span></div>
    <div class="console-body" role="log" aria-live="off">${logs.map(([time, level, content], index) => `<div class="log-line ${level.toLowerCase()}" data-log-line="${esc([time, level, content].join(' '))}"><span class="log-no">${String(index + 1).padStart(3, '0')}</span><span class="log-time">${time}</span><span class="log-level">${level}</span><span class="log-text">${esc(content)}</span></div>`).join('')}<div class="log-cursor"><span>›</span> 等待远程进程继续输出…</div></div>
    <footer><span>最后事件 10:32:15</span><span>偏移 14.2 KB</span><span>无日志缺口</span></footer>
  </div>`;
}

function artifactCards(job) {
  if (!job.artifact) {
    return `<div class="artifact-empty">
      <span class="artifact-empty-icon">${icon('layers', 24)}</span>
      <div><h3>产物尚未发布</h3><p>${esc(job.note)}。Checkpoint 只在训练完成后统一回传，不将临时远程文件暴露为可部署产物。</p><dl><div><dt>已生成 Checkpoint</dt><dd class="mono">step-100</dd></div><div><dt>回传策略</dt><dd>训练结束后统一同步</dd></div><div><dt>发布门禁</dt><dd>MinIO 清单 + SHA-256</dd></div></dl></div>
    </div>`;
  }
  return `<div class="artifact-grid">
    <article class="artifact-card best"><header><span>BEST</span><strong>${icon('check', 13)} MinIO 已校验</strong></header><h3>验证 Loss 0.2148</h3><p>最低有效验证 Loss 对应的 Adapter，证据链绑定 Attempt #06。</p><dl><div><dt>Adapter ID</dt><dd class="mono">adp_best_8c21f4</dd></div><div><dt>指纹</dt><dd class="mono">sha256:4e62…f0a1</dd></div><div><dt>文件</dt><dd>3 个固定文件</dd></div></dl><div class="artifact-actions">${button('下载 BEST Adapter', 'download-artifact', 'primary', 'download')}${button('用于推理试用', 'use-serving', 'quiet', 'arrowUpRight')}</div></article>
    <article class="artifact-card final"><header><span>FINAL</span><strong>${icon('check', 13)} MinIO 已校验</strong></header><h3>Step 146 完成</h3><p>训练最终状态产出的 Adapter；可与 Best 分别进入推理试用。</p><dl><div><dt>Adapter ID</dt><dd class="mono">adp_final_6b92ad</dd></div><div><dt>指纹</dt><dd class="mono">sha256:90c1…b31e</dd></div><div><dt>文件</dt><dd>3 个固定文件</dd></div></dl><div class="artifact-actions">${button('下载 FINAL Adapter', 'download-artifact', 'primary', 'download')}${button('用于推理试用', 'use-serving', 'quiet', 'arrowUpRight')}</div></article>
    <article class="artifact-card checkpoint"><header><span>CHECKPOINTS</span><strong>3 个远程步骤</strong></header><h3>最终产物已同步</h3><p>中间 Checkpoint 作为诊断记录保留，不作为正式可部署模型。</p><ul><li><span class="mono">checkpoint-50</span><span>已归档</span></li><li><span class="mono">checkpoint-100</span><span>已归档</span></li><li><span class="mono">checkpoint-146</span><span>已用于 Final</span></li></ul></article>
  </div>`;
}

function configTable(job) {
  return `<div class="config-layout">
    <section class="config-block"><header><span>INPUT SNAPSHOT</span><h3>输入证据</h3></header><dl><div><dt>数据集版本</dt><dd>${esc(job.dataset)} · ${job.datasetVersion}<small class="mono">d4de75d9-3c9b-4e63-9ae6-16a6130f53f0</small></dd></div><div><dt>拆分摘要</dt><dd class="mono">split-4f82b9d1</dd></div><div><dt>基座模型</dt><dd>${esc(job.base)} · ${job.baseVersion}<small class="mono">Qwen3-0.6B-20261102-r1</small></dd></div><div><dt>内容指纹</dt><dd class="mono">8b4fce91…f0a1e72c</dd></div><div><dt>运行镜像</dt><dd>LLaMA-Factory 0.9.5 <small>CUDA 12.4 · PyTorch 2.6</small></dd></div></dl></section>
    <section class="config-block"><header><span>PARAMETER PRESET</span><h3>训练参数</h3></header><div class="config-param-grid">${Object.entries(paramsPreview).map(([key, value]) => `<div><span>${key}</span><strong class="mono">${value}</strong></div>`).join('')}</div><p class="config-note">${icon('lock', 14)} 除随机种子外，参数由兼容基线锁定。</p></section>
    <section class="config-block full"><header><span>FROZEN MANIFEST</span><h3>完整不可变快照</h3></header><pre>${esc(JSON.stringify({
      attempt: job.number,
      dataset: { name: job.dataset, version: job.datasetVersion, split_sha256: 'split-4f82b9d1' },
      base: { name: job.base, version: job.baseVersion, fingerprint: 'Qwen3-0.6B-20261102-r1' },
      instance: { gpu: job.gpu, region: job.region, image: 'LLaMA-Factory 0.9.5', billing: 'Postpay' },
      config: paramsPreview,
      frozen_at: '2026-11-03T02:08:51Z',
    }, null, 2))}</pre></section>
  </div>`;
}

function detailContent(job, compact = false) {
  if (state.detailTab === 'logs') return logConsole(job, variant);
  if (state.detailTab === 'artifacts') return artifactCards(job);
  if (state.detailTab === 'config') return configTable(job);
  if (state.detailTab === 'analysis') return analysisContent(job);
  if (compact) {
    const remoteProcess = ['running', 'preparing'].includes(job.state)
      ? { title: '运行中', detail: '远程训练进程持续输出 step 与 Loss', tone: 'running' }
      : job.state === 'succeeded'
        ? { title: '已退出 · exit 0', detail: '进程退出已确认，训练结果已落盘', tone: 'success' }
        : job.state === 'failed'
          ? { title: '异常退出 · exit 1', detail: job.errorCode || 'runtime_exited', tone: 'danger' }
          : job.state === 'waiting_instance'
            ? { title: '未启动', detail: '等待手动创建并绑定收费实例', tone: 'waiting' }
            : { title: '已退出', detail: '退出记录已保留，未发布部分产物', tone: 'neutral' };
    const resource = ['waiting_instance', 'queued'].includes(job.state)
      ? { title: '实例未创建', detail: 'GPU 租约未占用', tone: 'waiting' }
      : ['succeeded', 'failed', 'cancelled'].includes(job.state)
        ? { title: '已清理 · 已释放', detail: '实例删除与租约释放已确认', tone: 'success' }
        : { title: '实例运行中', detail: `${esc(job.instance)} · 租约持有中`, tone: 'running' };
    return `<div class="compact-run-overview">
      <div class="compact-status-grid">
        <article class="tone-running"><span>训练执行</span><strong>${esc(job.stage)}</strong><p>${labels[job.state]} · 阶段事实来自后端 state / outcome</p></article>
        <article class="tone-${remoteProcess.tone}"><span>远程进程</span><strong>${remoteProcess.title}</strong><p>${remoteProcess.detail}</p></article>
        <article class="tone-${job.artifact ? 'success' : 'waiting'}"><span>Best / Final</span><strong>${job.artifact ? '2 / 2 可用' : '0 / 2 未发布'}</strong><p>${job.artifact ? 'MinIO 写入与回读校验均已通过' : '训练结束并完成原子发布后才开放下载与试用'}</p></article>
        <article class="tone-${resource.tone}"><span>实例与租约</span><strong>${resource.title}</strong><p>${resource.detail}</p></article>
      </div>
      <div class="compact-run-bottom">
        <section class="compact-events">
          <header><div><span>RECENT EVENTS</span><strong>最近执行事件</strong></div><button type="button" data-action="view-tab" data-tab="logs">打开完整日志 ${icon('arrow', 14)}</button></header>
          ${logs.slice(-4).map(([time, level, content]) => `<div><span class="mono">${time}</span><b>${level}</b><span>${esc(content)}</span></div>`).join('')}
        </section>
        <aside class="compact-gate">
          <span>NEXT CHECKPOINT</span>
          <strong>${job.artifact ? '产物验收已完成' : esc(job.stage)}</strong>
          <p>${esc(job.note)}</p>
          <div><span>训练进度</span><b>${job.progress}%</b></div>
          ${progress(job)}
          <button type="button" data-action="view-tab" data-tab="artifacts">查看产物门禁 ${icon('arrowUpRight', 14)}</button>
        </aside>
      </div>
    </div>`;
  }
  return `<div class="overview-detail">
    <div class="detail-metric-strip">
      <div><span>训练进度</span><strong>${job.progress}%</strong><small>${job.step} / ${job.totalSteps} steps</small></div>
      <div><span>当前 Train Loss</span><strong class="mono">${metric(job.loss)}</strong><small>最近 20 step ↓ 4.8%</small></div>
      <div><span>最新 Eval Loss</span><strong class="mono">${metric(job.evalLoss)}</strong><small>step 80 · 有效</small></div>
      <div><span>吞吐</span><strong class="mono">${esc(job.throughput)}</strong><small>${esc(job.gpu)} · 24 GB</small></div>
    </div>
    <div class="overview-detail-grid">
      <section class="detail-chart"><header><div><span>LOSS PROFILE</span><strong>训练与验证 Loss</strong></div><div class="chart-legend"><span><i></i>train</span><span><i></i>eval</span></div></header>${lossChart(variant, 240)}</section>
      <aside class="detail-now"><span>NOW RUNNING</span><strong>${esc(job.stage)}</strong><p>${esc(job.note)}</p>${progress(job)}<dl><div><dt>实例</dt><dd class="mono">${esc(job.instance)}</dd></div><div><dt>区域</dt><dd>${esc(job.region)}</dd></div><div><dt>运行时长</dt><dd>${job.elapsed}</dd></div><div><dt>ETL</dt><dd>已完成</dd></div></dl></aside>
    </div>
    <div class="recent-log-mini"><header><div><span>RECENT EVENTS</span><strong>最近日志</strong></div><button type="button" data-action="view-tab" data-tab="logs">打开完整日志 ${icon('arrow', 14)}</button></header>${logs.slice(-4).map(([time, level, content]) => `<div><span class="mono">${time}</span><b>${level}</b><span>${esc(content)}</span></div>`).join('')}</div>
    ${!job.artifact ? `<div class="artifact-gate">${icon('lock', 16)}<div><strong>Best / Final 仍被产物门禁锁定</strong><p>训练结束、产物同步并通过 MinIO 校验后发布；临时 Checkpoint 不参与推理。</p></div><span>等待同步</span></div>` : ''}
  </div>`;
}

function detailA() {
  const job = selectedJob();
  return `<div class="a-page detail-page">
    <header class="a-detail-heading"><div><button type="button" class="a-back" data-action="back-overview">${icon('chevronLeft', 15)}返回训练列表</button><div class="a-detail-titleline"><h1>${esc(job.name)}</h1>${status(job)}</div><p>Attempt #${String(job.number).padStart(2, '0')} · ${esc(job.dataset)} ${job.datasetVersion} → ${esc(job.base)} ${job.baseVersion}</p></div><div class="a-page-actions">${['running', 'syncing'].includes(job.state) ? button('取消训练', 'request-cancel', 'danger-outline', 'stop') : button('创建重试 Attempt', 'retry', 'quiet', 'refresh')}${button('用于推理试用', 'use-serving', 'primary', 'chat')}</div></header>
    ${stageStrip(job, 'a')}
    <div class="a-detail-grid">
      <section class="a-detail-main">
        <div class="a-detail-meta"><span><small>ATTEMPT</small><strong class="mono">${job.id}</strong></span><span><small>实例</small><strong class="mono">${esc(job.instance)}</strong></span><span><small>创建</small><strong>${job.created}</strong></span><span><small>运行时长</small><strong>${job.elapsed}</strong></span><span><small>错误码</small><strong class="${job.errorCode ? 'danger' : ''}">${job.errorCode || '—'}</strong></span></div>
        <div class="a-tabbar" role="tablist" aria-label="运行详情视图">${detailTabs(job)}</div>
        <div class="a-tab-content">${detailContent(job)}</div>
      </section>
      <aside class="a-evidence">
        <header><span>RUN EVIDENCE</span><h2>执行证据</h2></header>
        <div class="a-evidence-status"><span class="status-dot"></span><div><strong>${labels[job.state]}</strong><p>${esc(job.note)}</p></div></div>
        <dl><div><dt>GPU</dt><dd>${esc(job.gpu)} · 24 GB</dd></div><div><dt>区域</dt><dd>${esc(job.region)}</dd></div><div><dt>镜像</dt><dd>LLaMA-Factory 0.9.5</dd></div><div><dt>样本</dt><dd>${job.samples} 条</dd></div><div><dt>数据指纹</dt><dd class="mono">8b4fce91…f0a1</dd></div><div><dt>基座指纹</dt><dd class="mono">Qwen3-…r1</dd></div><div><dt>租约</dt><dd><span class="a-lease">持有中</span></dd></div></dl>
        <div class="a-evidence-actions">${button('复制完整快照', 'copy-snapshot', 'quiet', 'copy')}${button('查看平台日志', 'view-tab', 'quiet', 'terminal')}</div>
        <div class="a-evidence-note">${icon('alert', 15)}<p>实例停止、租约释放和产物可用是三个相互独立的确认事实。</p></div>
      </aside>
    </div>
  </div>`;
}

function detailB() {
  const job = selectedJob();
  return `<div class="b-page b-detail-page">
    <header class="b-detail-hero">
      <div class="b-detail-top"><button type="button" data-action="back-overview">${icon('chevronLeft', 15)}返回记录</button><span class="mono">ATTEMPT #${String(job.number).padStart(2, '0')} / ${job.created}</span>${status(job)}</div>
      <div class="b-detail-title"><div><span class="page-eyebrow">TRAINING RECORD</span><h1>${esc(job.name)}</h1><p>${esc(job.dataset)} ${job.datasetVersion} → ${esc(job.base)} ${job.baseVersion} · ${esc(job.gpu)}</p></div><div class="b-detail-progress"><strong>${job.progress}<small>%</small></strong><span>${job.step} / ${job.totalSteps} steps</span></div></div>
      <div class="b-detail-actions">${['running', 'syncing'].includes(job.state) ? button('取消并安全回收', 'request-cancel', 'b-danger', 'stop') : button('创建重试 Attempt', 'retry', 'b-outline', 'refresh')}${button('推理试用', 'use-serving', 'b-solid', 'chat')}</div>
      <div class="b-detail-chart">${lossChart('b', 190)}</div>
    </header>
    ${stageStrip(job, 'b')}
    <div class="b-detail-layout">
      <section class="b-detail-workbench"><div class="b-tabbar" role="tablist" aria-label="运行详情视图">${detailTabs(job)}</div><div class="b-tab-content">${detailContent(job, true)}</div></section>
      <aside class="b-detail-aside"><div class="b-aside-head">${pageEyebrow('EVIDENCE SEAL')}<h2>锻造证据</h2><p>${esc(job.note)}</p></div><dl><div><dt>实例</dt><dd class="mono">${esc(job.instance)}</dd></div><div><dt>区域</dt><dd>${esc(job.region)}</dd></div><div><dt>运行时长</dt><dd>${job.elapsed}</dd></div><div><dt>样本</dt><dd>${job.samples} 条</dd></div><div><dt>数据指纹</dt><dd class="mono">8b4fce91…f0a1</dd></div><div><dt>基座指纹</dt><dd class="mono">Qwen3-0.6B-r1</dd></div></dl><div class="b-aside-rule"><span>状态边界</span><p>远程进程退出、产物可用与 GPU 租约释放分别确认。</p></div><button type="button" data-action="copy-snapshot">复制完整冻结快照 ${icon('copy', 14)}</button></aside>
    </div>
  </div>`;
}

function detailB2() {
  const job = selectedJob();
  return `<div class="b-page b2-page b2-detail-page">
    <header class="b2-detail-head">
      <div class="b2-detail-top">
        <button type="button" class="b2-back" data-action="back-overview">${icon('chevronLeft', 15)}返回训练记录</button>
        <span class="mono">ATTEMPT #${String(job.number).padStart(2, '0')} · ${job.created}</span>
        ${status(job)}
      </div>
      <div class="b2-detail-title-row">
        <div><h1>${esc(job.name)}</h1><p>${esc(job.dataset)} ${job.datasetVersion} → ${esc(job.base)} ${job.baseVersion} · ${esc(job.gpu)} · ${esc(job.region)}</p></div>
        <div class="b2-detail-actions">
          ${['running', 'syncing'].includes(job.state) ? button('取消并安全回收', 'request-cancel', 'b-danger', 'stop') : button('创建重试 Attempt', 'retry', 'quiet', 'refresh')}
          ${job.state === 'succeeded' ? button('用于推理试用', 'use-serving', 'primary', 'chat') : `<button type="button" class="btn quiet" disabled title="当前 GPU 租约由训练占用">${icon('chat', 16)}<span>推理试用 · 租约占用</span></button>`}
        </div>
      </div>
      <dl class="b2-detail-kpis">
        <div><dt>训练进度</dt><dd class="mono">${job.progress}%</dd><small>${job.step} / ${job.totalSteps} steps</small></div>
        <div><dt>Train Loss</dt><dd class="mono">${metric(job.loss)}</dd><small>最近有效采样</small></div>
        <div><dt>Eval Loss</dt><dd class="mono">${metric(job.evalLoss)}</dd><small>${job.evalLoss ? '最低有效验证 Loss' : '尚未取得结果'}</small></div>
        <div><dt>Learning Rate</dt><dd class="mono">${esc(job.learningRate)}</dd><small>cosine · warmup 0</small></div>
        <div><dt>运行时长</dt><dd>${job.elapsed}</dd><small>${esc(job.throughput)}</small></div>
      </dl>
    </header>

    <section class="b2-detail-curve" aria-label="训练与验证 Loss 曲线">
      <header><div><strong>训练 / 验证 Loss</strong></div><div class="b2-legend"><span><i class="train"></i>train</span><span><i class="eval"></i>eval</span><span class="mono">step ${job.step} / ${job.totalSteps} · 自动刷新 2.5s</span></div></header>
      ${lossChart('b2', 176, job)}
    </section>

    ${stageStrip(job, 'b2')}

    <div class="b2-detail-layout">
      <section class="b2-detail-workbench">
        <div class="b2-tabbar" role="tablist" aria-label="运行详情视图">${detailTabs(job)}</div>
        <div class="b2-tab-content">${detailContent(job, true)}</div>
      </section>
      <aside class="b2-evidence-panel">
        <header><div><h2>运行证据</h2></div><span class="b2-evidence-state"><i></i>${labels[job.state]}</span></header>
        <div class="b2-evidence-summary">${icon(job.state === 'failed' ? 'alert' : 'lock', 16)}<p>${esc(job.note)}</p></div>
        <dl>
          <div><dt>实例</dt><dd class="mono">${esc(job.instance)}</dd></div>
          <div><dt>区域</dt><dd>${esc(job.region)}</dd></div>
          <div><dt>运行时长</dt><dd>${job.elapsed}</dd></div>
          <div><dt>样本</dt><dd>${job.samples} 条</dd></div>
          <div><dt>数据指纹</dt><dd class="mono">8b4fce91…f0a1</dd></div>
          <div><dt>基座指纹</dt><dd class="mono">Qwen3-0.6B-r1</dd></div>
          <div><dt>租约</dt><dd>${['succeeded', 'failed', 'cancelled'].includes(job.state) ? '已释放' : '持有中'}</dd></div>
        </dl>
        <div class="b2-evidence-rule"><span>状态边界</span><p>远程进程退出、Best / Final 可用与 GPU 租约释放，是三个需要分别确认的事实。</p></div>
        <button type="button" class="b2-copy-snapshot" data-action="copy-snapshot">复制完整冻结快照 ${icon('copy', 14)}</button>
      </aside>
    </div>
  </div>`;
}

function detailC() {
  const job = selectedJob();
  return `<div class="c-page c-detail-page">
    <div class="c-overview-grid c-detail-grid">${runListC()}
      <section class="c-inspector c-inspector-detail">
        <header class="c-inspector-head"><div><button type="button" class="c-back" data-action="back-overview">${icon('chevronLeft', 14)}全部训练</button><span>ATTEMPT #${String(job.number).padStart(2, '0')}</span><h1>${esc(job.name)}</h1><p>${esc(job.dataset)} ${job.datasetVersion} → ${esc(job.base)} ${job.baseVersion}</p></div><div class="c-head-actions">${status(job)}<button type="button" data-action="copy-snapshot" aria-label="复制快照">${icon('copy', 15)}</button></div></header>
        <div class="c-detail-command"><div>${stageStrip(job, 'c')}</div><div class="c-detail-actions">${['running', 'syncing'].includes(job.state) ? button('取消训练', 'request-cancel', 'c-danger', 'stop') : button('重试', 'retry', 'c-soft', 'refresh')}${button('推理试用', 'use-serving', 'c-primary', 'chat')}</div></div>
        <div class="c-hero-metrics">${['running', 'syncing', 'succeeded'].includes(job.state) ? `<article class="c-metric-main"><span>训练进度</span><div><strong>${job.progress}<small>%</small></strong>${status(job)}</div>${progress(job)}<p>${job.step} of ${job.totalSteps} steps · ${job.elapsed}</p></article>` : `<article class="c-metric-main"><span>当前状态</span><div><strong class="state-word">${labels[job.state]}</strong>${status(job)}</div><p>${esc(job.stage)} · ${job.elapsed}</p></article>`}<article><span>Train Loss</span><strong class="mono">${metric(job.loss)}</strong><small>最近有效采样</small></article><article><span>Eval Loss</span><strong class="mono">${metric(job.evalLoss)}</strong><small>${job.evalLoss ? '最低有效验证 Loss' : '尚未取得验证结果'}</small></article><article><span>Learning Rate</span><strong class="mono">${job.learningRate}</strong><small>cosine · warmup 0</small></article></div>
        <div class="c-chart-card"><header><div><span>LOSS PROFILE</span><strong>训练与验证 Loss</strong></div><div class="c-legend"><span><i class="train"></i>train</span><span><i class="eval"></i>eval</span></div></header>${lossChart('c', 215)}</div>
        <div class="c-tabbar" role="tablist" aria-label="运行详情视图">${detailTabs(job)}<span class="c-tabbar-note">自动刷新 2.5s</span></div><div class="c-tab-content">${detailContent(job, true)}</div>
      </section>
      ${contextC(job)}
    </div>
  </div>`;
}

function renderApp() {
  let content;
  if (state.view === 'create') content = isB2 ? createB2() : variant === 'b' ? createB() : variant === 'c' ? createC() : createA();
  else if (state.view === 'detail') content = isB2 ? detailB2() : variant === 'b' ? detailB() : variant === 'c' ? detailC() : detailA();
  else content = isB2 ? overviewB2() : variant === 'b' ? overviewB() : variant === 'c' ? overviewC() : overviewA();
  root.innerHTML = renderShell(content);
  mainLabel.textContent = state.view === 'create' ? '新建训练 · ModelForge' : state.view === 'detail' ? `${selectedJob().name} · ModelForge` : isB2 ? '训练工作台 · ModelForge' : `训练 · ModelForge`;
  attachEnhancements();
}

function getModalFocusable() {
  return [...modalRoot.querySelectorAll(
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  )].filter(element => element.getClientRects().length > 0);
}

function setBackgroundInert(value) {
  if (root) root.inert = value;
  if (chromeRoot) chromeRoot.inert = value;
}

function openModal(kind, trigger = document.activeElement) {
  lastModalTrigger = trigger instanceof HTMLElement ? trigger : null;
  state.modal = kind;
  renderModal();
  normalizeTypeFloor(document);
  setBackgroundInert(true);
  requestAnimationFrame(() => {
    const target = modalRoot.querySelector('[data-autofocus]') || modalRoot.querySelector('.mf-modal');
    target?.focus();
  });
}

function closeModal({ restoreFocus = true } = {}) {
  const trigger = lastModalTrigger;
  state.modal = null;
  renderModal();
  setBackgroundInert(false);
  lastModalTrigger = null;
  if (restoreFocus && trigger?.isConnected) {
    requestAnimationFrame(() => trigger.focus());
  }
}

function trapModalFocus(event) {
  if (!state.modal || event.key !== 'Tab') return;
  const focusable = getModalFocusable();
  if (!focusable.length) {
    event.preventDefault();
    modalRoot.querySelector('.mf-modal')?.focus();
    return;
  }
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function renderModal() {
  if (!state.modal) {
    modalRoot.innerHTML = '';
    return;
  }
  const job = selectedJob();
  if (state.modal === 'submit') {
    const c = state.create;
    modalRoot.innerHTML = `<div class="modal-backdrop" data-modal-backdrop role="presentation">
      <div class="mf-modal" role="dialog" aria-modal="true" aria-labelledby="submit-title" aria-describedby="submit-desc" tabindex="-1">
        <header class="mf-modal-head"><div><small>SUBMIT / FROZEN INPUT</small><h2 id="submit-title">确认提交训练任务</h2></div><button type="button" class="mf-modal-close" data-action="close-modal" aria-label="关闭">${icon('x', 16)}</button></header>
        <div class="mf-modal-body">
          <p id="submit-desc">提交后立即冻结以下输入，并进入“等待手动创建实例”。平台不会购买或预留 GPU。</p>
          <dl class="mf-modal-facts"><dt>任务名称</dt><dd>${esc(c.name)}</dd><dt>数据集</dt><dd>${esc(c.dataset)}</dd><dt>基座</dt><dd>${esc(c.base)}</dd><dt>执行边界</dt><dd>${esc(c.hardware)}</dd><dt>方法</dt><dd>SFT + LoRA · seed ${esc(c.seed)}</dd></dl>
        </div>
        <div class="mf-modal-actions"><button type="button" class="quiet" data-action="close-modal" data-autofocus>返回检查</button><button type="button" class="primary" data-action="confirm-submit">${icon('play', 15)}确认进入等待实例</button></div>
      </div>
    </div>`;
    return;
  }
  if (state.modal === 'cancel') {
    modalRoot.innerHTML = `<div class="modal-backdrop" data-modal-backdrop role="presentation">
      <div class="mf-modal" role="dialog" aria-modal="true" aria-labelledby="cancel-title" aria-describedby="cancel-desc" tabindex="-1">
        <header class="mf-modal-head"><div><small>SAFE CANCEL / CLEANUP</small><h2 id="cancel-title">取消并回收本次训练？</h2></div><button type="button" class="mf-modal-close" data-action="close-modal" aria-label="关闭">${icon('x', 16)}</button></header>
        <div class="mf-modal-body">
          <p id="cancel-desc">平台会等待远程进程确认退出，再停止并删除关联实例。取消不会发布部分 Adapter，也不会跳过租约释放核对。</p>
          <dl class="mf-modal-facts"><dt>Attempt</dt><dd>#${String(job.number).padStart(2, '0')} · ${esc(job.name)}</dd><dt>实例</dt><dd class="mono">${esc(job.instance)}</dd><dt>当前进度</dt><dd>${job.step} / ${job.totalSteps} steps · ${job.progress}%</dd><dt>产物策略</dt><dd>不发布部分 Adapter</dd></dl>
        </div>
        <div class="mf-modal-actions"><button type="button" class="quiet" data-action="close-modal" data-autofocus>继续训练</button><button type="button" class="danger" data-action="confirm-cancel">${icon('stop', 15)}确认取消并回收</button></div>
      </div>
    </div>`;
  }
}

function renderToast() {
  if (!state.toast) {
    toastRoot.innerHTML = '';
    return;
  }
  toastRoot.innerHTML = `<div class="toast" role="status">${icon('check', 17)}<div><strong>${esc(state.toast.title)}</strong><p>${esc(state.toast.message)}</p></div></div>`;
}

function render() {
  renderChrome();
  renderApp();
  renderModal();
  renderToast();
  normalizeTypeFloor(document);
}

function attachEnhancements() {
  const search = document.querySelector('[data-job-search]');
  if (search) {
    search.value = state.query;
    search.addEventListener('input', event => {
      state.query = event.target.value;
      filterVisibleRows();
    });
    filterVisibleRows();
  }
  const form = document.querySelector('.form-section');
  if (form) {
    form.querySelectorAll('[data-create-field]').forEach(input => {
      const sync = () => {
        state.create[input.dataset.createField] = input.value;
        document.querySelectorAll(`[data-bind="${input.dataset.createField}"]`).forEach(node => {
          node.textContent = input.value || '未填写';
        });
        if (input.dataset.createField === state.create.errorField) {
          state.create.error = '';
          state.create.errorField = '';
          input.setAttribute('aria-invalid', 'false');
          input.setAttribute('aria-describedby', input.id === 'field-name' ? 'hint-name' : 'hint-seed');
          input.closest('.field')?.classList.remove('has-error');
          input.closest('.field')?.querySelector('.field-error')?.remove();
          document.querySelector('[data-form-error]')?.remove();
        }
      };
      input.addEventListener('input', sync);
      input.addEventListener('change', sync);
    });
  }
  const logSearch = document.querySelector('[data-log-search]');
  if (logSearch) {
    logSearch.addEventListener('input', event => {
      const query = event.target.value.trim().toLowerCase();
      document.querySelectorAll('[data-log-line]').forEach(line => {
        line.hidden = Boolean(query) && !line.dataset.logLine.toLowerCase().includes(query);
      });
    });
  }
}

function filterVisibleRows() {
  const rows = [...document.querySelectorAll('[data-search]')];
  const query = state.query.trim().toLowerCase();
  rows.forEach(row => {
    const matchesFilter = (() => {
      const job = jobs.find(item => item.id === row.dataset.job);
      return job ? jobMatches(job) : true;
    })();
    const matchesQuery = !query || row.dataset.search.toLowerCase().includes(query);
    row.hidden = !(matchesFilter && matchesQuery);
  });
}

function captureCreate() {
  document.querySelectorAll('[data-create-field]').forEach(input => {
    state.create[input.dataset.createField] = input.value;
  });
}

function validateStep() {
  captureCreate();
  const fail = (message, field = '') => ({ message, field });
  if (state.createStep === 1) {
    if (!state.create.name.trim()) return fail('请填写任务名称，再继续下一步。', 'name');
    if (!state.create.dataset) return fail('请选择已发布的数据版本。', 'dataset');
    if (!state.create.base) return fail('请选择已验证的基础模型。', 'base');
  }
  if (state.createStep === 3) {
    const seed = Number(state.create.seed);
    if (!Number.isInteger(seed) || seed < 0 || seed > 2147483647) {
      return fail('随机种子必须是 0 到 2147483647 之间的整数。', 'seed');
    }
  }
  return fail('');
}

function addCreatedJob() {
  const c = state.create;
  const nextNumber = Math.max(...jobs.map(job => job.number)) + 1;
  const created = {
    ...jobs[1],
    id: `attempt-${nextNumber}`,
    number: nextNumber,
    name: c.name.trim() || '未命名训练任务',
    dataset: c.dataset.split(' · ')[0],
    datasetVersion: c.dataset.split(' · ')[1] || 'v1',
    base: c.base.split(' · ')[0],
    baseVersion: c.base.split(' · ')[1] || 'v1',
    state: 'waiting_instance',
    stage: '等待手动创建实例',
    progress: 6,
    created: '刚刚',
    updated: '刚刚',
    loss: null,
    evalLoss: null,
    step: 0,
    artifact: false,
    note: '任务已提交，等待在优云控制台手动创建实例并关联实例 ID。',
  };
  jobs.unshift(created);
  state.selectedId = created.id;
  state.view = 'overview';
  state.createStep = 1;
  state.create = { ...createDefaults };
  history.replaceState(null, '', '#overview');
  state.toast = {
    title: `Attempt #${String(nextNumber).padStart(2, '0')} 已进入等待实例`,
    message: '输入已冻结。下一步需要手动创建收费实例，并回填实例 ID 与清理授权。',
  };
  window.setTimeout(() => {
    state.toast = null;
    renderToast();
  }, 5200);
  return created;
}

function cancelSelectedJob() {
  const job = selectedJob();
  job.state = 'cleanup';
  job.stage = '等待远程进程退出并回收实例';
  job.note = '已请求取消。平台会等待远程进程退出、停止并删除实例、确认租约释放后再标记取消完成。';
  state.toast = {
    title: '取消请求已记录',
    message: `Attempt #${String(job.number).padStart(2, '0')} 进入安全回收流程，不会发布部分 Adapter。`,
  };
  window.setTimeout(() => {
    state.toast = null;
    renderToast();
  }, 4600);
}

document.addEventListener('click', event => {
  const jobTarget = event.target.closest('[data-job]');
  const actionTarget = event.target.closest('[data-action]');
  const filterTarget = event.target.closest('[data-filter]');
  const stepTarget = event.target.closest('[data-goto-step]');
  const tabTarget = event.target.closest('[data-detail-tab]');
  const other = event.target.closest('[data-other]');

  if (event.target.matches('[data-modal-backdrop]')) {
    closeModal();
    return;
  }
  if (filterTarget) {
    event.preventDefault();
    state.filter = filterTarget.dataset.filter;
    render();
    return;
  }
  if (tabTarget) {
    event.preventDefault();
    state.detailTab = tabTarget.dataset.detailTab;
    navigate('detail', state.detailTab);
    return;
  }
  if (stepTarget) {
    event.preventDefault();
    const target = Number(stepTarget.dataset.gotoStep);
    if (target <= state.createStep) {
      captureCreate();
      state.createStep = target;
      state.create.error = '';
      state.create.errorField = '';
      render();
      focusCreateStep();
    }
    return;
  }
  if (actionTarget) {
    event.preventDefault();
    const action = actionTarget.dataset.action;
    if (action === 'new-training') {
      state.view = 'create';
      state.createStep = 1;
      state.create.error = '';
      state.create.errorField = '';
      navigate('create');
      return;
    }
    if (action === 'back-overview') {
      navigate('overview');
      return;
    }
    if (action === 'open-job' || jobTarget) {
      state.selectedId = actionTarget.dataset.job || jobTarget.dataset.job || state.selectedId;
      state.detailTab = actionTarget.dataset.tab || 'overview';
      navigate('detail', state.detailTab);
      return;
    }
    if (action === 'next-step') {
      const validation = validateStep();
      state.create.error = validation.message;
      state.create.errorField = validation.field;
      if (state.create.error) {
        render();
        focusFormError();
        return;
      }
      if (state.createStep < 4) state.createStep += 1;
      render();
      focusCreateStep();
      return;
    }
    if (action === 'prev-step') {
      captureCreate();
      if (state.createStep > 1) state.createStep -= 1;
      state.create.error = '';
      state.create.errorField = '';
      render();
      focusCreateStep();
      return;
    }
    if (action === 'open-submit') {
      const validation = validateStep();
      state.create.error = validation.message;
      state.create.errorField = validation.field;
      if (state.create.error) {
        render();
        focusFormError();
        return;
      }
      if (state.createStep !== 4) {
        state.createStep = 4;
        render();
        focusCreateStep();
        return;
      }
      openModal('submit', actionTarget);
      return;
    }
    if (action === 'confirm-submit') {
      closeModal({ restoreFocus: false });
      const created = addCreatedJob();
      render();
      requestAnimationFrame(() => {
        document.querySelector(`[data-job="${created.id}"]`)?.focus();
      });
      return;
    }
    if (action === 'view-tab') {
      state.detailTab = actionTarget.dataset.tab || 'overview';
      navigate('detail', state.detailTab);
      return;
    }
    if (action === 'request-cancel') {
      openModal('cancel', actionTarget);
      return;
    }
    if (action === 'confirm-cancel') {
      closeModal({ restoreFocus: false });
      cancelSelectedJob();
      render();
      focusCurrentDetail();
      return;
    }
    if (action === 'close-modal') {
      closeModal();
      return;
    }
    if (action === 'copy-id' || action === 'copy-snapshot') {
      state.toast = { title: '已复制到剪贴板', message: action === 'copy-id' ? 'Attempt ID 已复制。' : '冻结快照摘要已复制。' };
      navigator.clipboard?.writeText(action === 'copy-id' ? actionTarget.dataset.id : 'ModelForge frozen training snapshot').catch(() => {});
      renderToast();
      window.setTimeout(() => {
        state.toast = null;
        renderToast();
      }, 2800);
      return;
    }
    if (action === 'download-artifact') {
      state.toast = { title: '原型不下载真实文件', message: '正式实现会调用 Adapter 导出接口，并在下载前再次核对 manifest 与 SHA-256。' };
      renderToast();
      window.setTimeout(() => {
        state.toast = null;
        renderToast();
      }, 3600);
      return;
    }
    if (action === 'use-serving' || action === 'retry') {
      state.toast = {
        title: action === 'retry' ? '重试入口已准备' : '将进入独立推理试用',
        message: action === 'retry' ? '正式实现会创建新的 Attempt，并复用本次不可变输入。' : '正式实现必须先确认当前 GPU 租约释放，再创建新的推理实例。',
      };
      renderToast();
      window.setTimeout(() => {
        state.toast = null;
        renderToast();
      }, 3600);
      return;
    }
    if (action === 'refresh') {
      state.toast = { title: '状态已刷新', message: '原型使用静态数据；正式页面会通过 HTTP 与 SSE 读取真实训练状态。' };
      renderToast();
      window.setTimeout(() => {
        state.toast = null;
        renderToast();
      }, 3000);
      return;
    }
  }
  if (jobTarget) {
    event.preventDefault();
    state.selectedId = jobTarget.dataset.job;
    navigate('detail');
    return;
  }
  if (other) {
    event.preventDefault();
    state.toast = { title: '训练模块设计原型', message: '该入口只展示本页范围，不连接其他业务模块。' };
    renderToast();
    window.setTimeout(() => {
      state.toast = null;
      renderToast();
    }, 2800);
  }
});

document.addEventListener('keydown', event => {
  trapModalFocus(event);
  if (event.key === 'Escape' && state.modal) {
    event.preventDefault();
    closeModal();
  }
});

window.addEventListener('hashchange', () => {
  state.view = parseView();
  state.detailTab = parseTab();
  render();
});

render();
