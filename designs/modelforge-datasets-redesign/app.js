const svg = (paths) => `<svg viewBox="0 0 24 24" aria-hidden="true">${paths}</svg>`;

const icons = {
  upload: svg('<path d="M12 16V4m0 0L7 9m5-5 5 5M5 15v4h14v-4"></path>'),
  search: svg('<circle cx="11" cy="11" r="6.5"></circle><path d="m16 16 4 4"></path>'),
  check: svg('<path d="m5 12 4 4L19 6"></path>'),
  arrowRight: svg('<path d="M5 12h14m-5-5 5 5-5 5"></path>'),
  chevronRight: svg('<path d="m9 6 6 6-6 6"></path>'),
  data: svg('<ellipse cx="12" cy="5.5" rx="7" ry="3"></ellipse><path d="M5 5.5v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6M5 11.5v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6"></path>'),
  model: svg('<path d="m12 3 8 4.5-8 4.5-8-4.5L12 3Z"></path><path d="m4 12 8 4.5 8-4.5M4 16.5 12 21l8-4.5"></path>'),
  overview: svg('<rect x="3" y="3" width="7" height="7" rx="1"></rect><rect x="14" y="3" width="7" height="7" rx="1"></rect><rect x="3" y="14" width="7" height="7" rx="1"></rect><rect x="14" y="14" width="7" height="7" rx="1"></rect>'),
  compute: svg('<rect x="3" y="4" width="18" height="13" rx="2"></rect><path d="M8 21h8M12 17v4"></path>'),
  train: svg('<path d="m4 18 6-6 4 3 6-10"></path><path d="M14 5h6v6"></path>'),
  chat: svg('<path d="M4 4h16v13H9l-5 4V4Z"></path><path d="M8 9h8M8 13h5"></path>'),
  edit: svg('<path d="m4 20 4.5-1 9.8-9.8a2.1 2.1 0 0 0-3-3L5.5 16 4 20Z"></path><path d="m13.8 7.7 3 3"></path>'),
  chevronDown: svg('<path d="m6 9 6 6 6-6"></path>'),
  download: svg('<path d="M12 4v12m0 0 5-5m-5 5-5-5M5 20h14"></path>'),
  trash: svg('<path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"></path>'),
  more: svg('<circle cx="5" cy="12" r="1"></circle><circle cx="12" cy="12" r="1"></circle><circle cx="19" cy="12" r="1"></circle>'),
  file: svg('<path d="M6 3h8l4 4v14H6V3Z"></path><path d="M14 3v5h5M9 13h6M9 17h6"></path>'),
  info: svg('<circle cx="12" cy="12" r="9"></circle><path d="M12 11v6M12 7h.01"></path>'),
  layers: svg('<path d="m12 3 9 5-9 5-9-5 9-5Z"></path><path d="m3 12 9 5 9-5M3 16l9 5 9-5"></path>'),
  link: svg('<path d="M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1"></path><path d="M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1"></path>'),
  close: svg('<path d="m6 6 12 12M18 6 6 18"></path>'),
  refresh: svg('<path d="M20 11a8 8 0 1 0-2 6M20 4v7h-7"></path>'),
  columns: svg('<rect x="3" y="4" width="18" height="16" rx="2"></rect><path d="M9 4v16M15 4v16"></path>'),
};

const datasets = [
  {
    id: "d3e1c4dc-c10d-48f1-89a8-5bdfa2ee54b2",
    shortId: "DT-3E1C",
    name: "客服123",
    updatedAt: "今天 23:06",
    versions: [
      {
        id: "d3f06883-d864-4cd0-9505-618801e100d7",
        number: 2,
        state: "published",
        sampleCount: 24,
        sizeBytes: 7325,
        createdAt: "2026/11/2 23:06:40",
        sha256: "4b80450534c6ade2fc7efa98b96b02f6815d777f0aac1f0140dc300777b9d5eb",
        split: { train: 22, validation: 2, seed: 42 },
      },
      {
        id: "386f6665-2e98-4f37-a7f5-32cf36ff77f1",
        number: 1,
        state: "published",
        sampleCount: 24,
        sizeBytes: 7325,
        createdAt: "2026/11/2 23:04:24",
        sha256: "4b80450534c6ade2fc7efa98b96b02f6815d777f0aac1f0140dc300777b9d5eb",
        split: { train: 22, validation: 2, seed: 42 },
      },
    ],
  },
  {
    id: "4323e5cf-d95a-4db5-8ab5-40e081220f74",
    shortId: "DT-4323",
    name: "客服123",
    updatedAt: "今天 23:02",
    versions: [
      {
        id: "4fe0fe13-ba44-4876-8307-7d55d72518c2",
        number: 1,
        state: "published",
        sampleCount: 24,
        sizeBytes: 7325,
        createdAt: "2026/11/2 23:02:55",
        sha256: "4b80450534c6ade2fc7efa98b96b02f6815d777f0aac1f0140dc300777b9d5eb",
        split: { train: 22, validation: 2, seed: 42 },
      },
    ],
  },
  {
    id: "b47cd67d-84a2-45f1-9c3c-8c67018a063a",
    shortId: "DT-B47C",
    name: "live-gpu-sft-20261101-r1",
    updatedAt: "昨天 19:26",
    versions: [
      {
        id: "dc344d8b-41ca-459a-9eb6-3c276eeb93a2",
        number: 1,
        state: "published",
        sampleCount: 24,
        sizeBytes: 4836,
        createdAt: "2026/11/1 19:26:25",
        sha256: "a78a2f1ed4565f45a233eb6f87dc4cadb10972858d394bc2c619a589a85290c8",
        split: { train: 22, validation: 2, seed: 42 },
      },
    ],
  },
];

const samples = [
  {
    line: 1,
    title: "LoRA 基础解释",
    messages: [
      { role: "system", content: "你是 ModelForge 的训练助手，请用简洁、准确的中文回答。" },
      { role: "user", content: "什么是 LoRA？" },
      { role: "assistant", content: "LoRA 是一种参数高效微调方法。它冻结基础模型权重，只训练低秩适配矩阵，从而显著减少可训练参数、显存占用和产物大小。" },
    ],
  },
  {
    line: 2,
    title: "显存不足排查",
    messages: [
      { role: "user", content: "训练时报显存不足，应该先检查什么？" },
      { role: "assistant", content: "先核对最大序列长度、批大小、梯度累积和 LoRA rank，再检查是否误启用了全参数训练。一次只调整一个参数，并保留失败日志。" },
    ],
  },
  {
    line: 3,
    title: "模型产物选择",
    messages: [
      { role: "user", content: "Best Adapter 和 Final Adapter 有什么区别？" },
      { role: "assistant", content: "Best Adapter 对应验证指标最好的检查点，Final Adapter 对应训练结束时保存的检查点。选择时要同时核对验证集和独立测试结果。" },
    ],
  },
  {
    line: 4,
    title: "数据集版本规则",
    messages: [
      { role: "user", content: "为什么已发布的数据集不能直接修改？" },
      { role: "assistant", content: "训练任务会引用固定版本。直接修改会使历史训练无法复现，因此已发布版本应保持不变，通过创建新版本记录修改。" },
    ],
  },
  {
    line: 5,
    title: "验证集比例",
    messages: [
      { role: "user", content: "为什么设置 10% 验证集后实际比例是 8.33%？" },
      { role: "assistant", content: "验证集按完整样本分组，无法拆开重复内容。样本较少时，系统会从可行组合中选择最接近目标比例的拆分。" },
    ],
  },
  {
    line: 6,
    title: "训练日志证据",
    messages: [
      { role: "user", content: "如何判断训练是否真的成功？" },
      { role: "assistant", content: "需要同时核对进程退出码、训练日志、产物回读校验和实例回收状态。只有页面显示成功不足以证明闭环完成。" },
    ],
  },
  {
    line: 7,
    title: "学习率调整",
    messages: [
      { role: "user", content: "LoRA 微调应从多高的学习率开始？" },
      { role: "assistant", content: "可以从一个受控的小范围基线开始，例如 1e-4 到 3e-4，再用相同验证集比较。具体值还取决于模型、数据量和目标任务。" },
    ],
  },
  {
    line: 8,
    title: "MinIO 与元数据",
    messages: [
      { role: "user", content: "PostgreSQL 和 MinIO 分别保存什么？" },
      { role: "assistant", content: "PostgreSQL 保存版本、状态、样本计数和校验摘要等元数据；MinIO 保存不可变的原始 JSONL 与拆分清单。" },
    ],
  },
];

const navItems = [
  ["overview", "工作台", "overview"],
  ["datasets", "数据集", "data"],
  ["models", "模型", "model"],
  ["compute", "计算环境", "compute"],
  ["training", "训练", "train"],
  ["serving", "推理试用", "chat"],
];

const storedVariant = window.location.hash.replace("#", "");
const state = {
  variant: ["a", "b", "c"].includes(storedVariant) ? storedVariant : "c",
  theme: localStorage.getItem("mf-dataset-theme") || "light",
  density: localStorage.getItem("mf-dataset-density") || "comfortable",
  datasetId: "d3e1c4dc-c10d-48f1-89a8-5bdfa2ee54b2",
  versionId: "d3f06883-d864-4cd0-9505-618801e100d7",
  sampleLine: 1,
  sampleView: "dialog",
  editing: false,
  datasetQuery: "",
  statusFilter: "all",
  derivedVersions: {},
  upload: {
    open: false,
    target: "existing",
    datasetId: "d3e1c4dc-c10d-48f1-89a8-5bdfa2ee54b2",
    newDatasetName: "",
    file: null,
    phase: "idle",
    demo: false,
    pickerOpen: false,
    pickerIndex: 0,
  },
  toast: null,
};

const root = document.documentElement;
const app = document.getElementById("app");
const drawerRoot = document.getElementById("drawer-root");
const toastRoot = document.getElementById("toast-root");
let toastTimer = null;

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getDataset(id = state.datasetId) {
  return datasets.find((dataset) => dataset.id === id) || datasets[0];
}

function getVersions(dataset = getDataset()) {
  const derived = state.derivedVersions[dataset.id] || [];
  return [...dataset.versions, ...derived].sort((left, right) => right.number - left.number);
}

function getVersion(dataset = getDataset(), id = state.versionId) {
  return getVersions(dataset).find((version) => version.id === id) || getVersions(dataset)[0];
}

function getAllDatasetVersions() {
  return datasets.flatMap((dataset) => getVersions(dataset));
}

function statusClass(status) {
  return status === "published" ? "status-published" : status === "draft" ? "status-draft" : "status-danger";
}

function statusLabel(status) {
  return status === "published" ? "已发布" : status === "draft" ? "待发布" : "校验不通过";
}

function statusBadge(status) {
  return `<span class="status ${statusClass(status)}">${statusLabel(status)}</span>`;
}

function formatBytes(bytes) {
  return bytes >= 1024 ? `${(bytes / 1024).toFixed(2)} KiB` : `${bytes} B`;
}

function shortHash(hash) {
  return `${hash.slice(0, 8)}…${hash.slice(-6)}`;
}

function nextVersionNumber(datasetId) {
  const dataset = getDataset(datasetId);
  return Math.max(...getVersions(dataset).map((version) => version.number), 0) + 1;
}

function selectedMessages() {
  return samples.find((sample) => sample.line === Number(state.sampleLine)) || samples[0];
}

function showToast(title, message) {
  window.clearTimeout(toastTimer);
  state.toast = { title, message };
  renderToast();
  toastTimer = window.setTimeout(() => {
    state.toast = null;
    renderToast();
  }, 3600);
}

function renderToast() {
  toastRoot.innerHTML = state.toast
    ? `<div class="toast" role="status"><strong>${escapeHtml(state.toast.title)}</strong>${escapeHtml(state.toast.message)}</div>`
    : "";
}

function productFrame(content, label) {
  return `
    <div class="product-shell variant-${state.variant}" data-screen-label="${escapeHtml(label)}">
      <aside class="app-rail" aria-label="ModelForge 主导航">
        <a class="app-brand" href="#" aria-label="ModelForge 工作台">
          <span class="app-brand-mark">M</span>
          <span><strong>ModelForge</strong><small>模型微调工作台</small></span>
        </a>
        <nav class="app-nav">
          ${navItems.map(([id, labelText, iconName]) => `
            <a class="nav-item ${id === "datasets" ? "is-active" : ""}" href="#${id}" ${id === "datasets" ? 'aria-current="page"' : 'tabindex="-1"'}>
              ${icons[iconName]}<span>${labelText}</span>
            </a>
          `).join("")}
        </nav>
        <div class="rail-status">
          <strong><i class="live-dot"></i>本地控制面</strong>
          PostgreSQL · MinIO 已连接
        </div>
      </aside>
      <div class="product-main">
        <header class="context-bar">
          <div class="breadcrumb">个人工作空间 <span aria-hidden="true">/</span> <strong>数据集</strong></div>
          <div class="context-meta">
            <span class="verified-chip">${icons.check}对象存储已核验</span>
            <span>本机访问</span>
          </div>
        </header>
        <main class="workspace" id="workspace" tabindex="-1">
          ${content}
        </main>
      </div>
    </div>
  `;
}

function pageHeading({ title, description, actionLabel = "上传 JSONL", secondary }) {
  return `
    <div class="page-heading">
      <div>
        <h1>${escapeHtml(title)}</h1>
        <p>${escapeHtml(description)}</p>
      </div>
      <div class="heading-actions">
        ${secondary || ""}
        <button class="button button-primary" type="button" data-action="open-upload">
          ${icons.upload}${escapeHtml(actionLabel)}
        </button>
      </div>
    </div>
  `;
}

function summaryStrip() {
  const versions = getAllDatasetVersions();
  const sampleCount = versions.reduce((total, version) => total + version.sampleCount, 0);
  const draftCount = versions.filter((version) => version.state === "draft").length;
  return `
    <div class="summary-strip" aria-label="数据集摘要">
      <div class="summary-item"><span>数据集</span><strong>${datasets.length}</strong><small>按不可变 ID 分组</small></div>
      <div class="summary-item"><span>版本</span><strong>${versions.length}</strong><small>${draftCount ? `${draftCount} 个待发布` : "全部已发布"}</small></div>
      <div class="summary-item"><span>有效样本</span><strong>${sampleCount.toLocaleString("zh-CN")}</strong><small>跨全部版本</small></div>
      <div class="summary-item"><span>校验异常</span><strong>0</strong><small>当前版本无阻塞</small></div>
    </div>
  `;
}

function datasetMatches(dataset) {
  const query = state.datasetQuery.trim().toLowerCase();
  const versions = getVersions(dataset);
  const queryMatched = !query
    || dataset.name.toLowerCase().includes(query)
    || dataset.shortId.toLowerCase().includes(query)
    || dataset.id.toLowerCase().includes(query);
  const statusMatched = state.statusFilter === "all" || versions.some((version) => version.state === state.statusFilter);
  return queryMatched && statusMatched;
}

function sampleMiniList(limit = 4) {
  return samples.slice(0, limit).map((sample) => `
    <button class="sample-mini ${sample.line === state.sampleLine ? "is-active" : ""}" type="button" data-action="select-sample" data-line="${sample.line}">
      <span class="sample-line">${sample.line}</span>
      <span><strong>${escapeHtml(sample.title)}</strong><small>${sample.messages.length} 条消息</small></span>
      <span class="sample-ok" title="校验通过">${icons.check}</span>
    </button>
  `).join("");
}

function messageStack({ editable = false, compact = false } = {}) {
  const sample = selectedMessages();
  const roleLabels = { system: "系统", user: "用户", assistant: "助手" };
  return `
    <div class="message-stack" ${compact ? 'style="gap:6px"' : ""}>
      ${sample.messages.map((message, index) => `
        <div class="message-card role-${message.role}">
          <span class="role-token">${message.role === "assistant" ? "A" : message.role === "system" ? "S" : "U"}</span>
          <div>
            <strong>${roleLabels[message.role] || escapeHtml(message.role)}</strong>
            ${editable
              ? `<textarea rows="${message.role === "system" ? 2 : 3}" data-sample-role="${message.role}" data-message-index="${index}" aria-label="${roleLabels[message.role] || message.role}内容">${escapeHtml(message.content)}</textarea>`
              : `<p>${escapeHtml(message.content)}</p>`}
          </div>
        </div>
      `).join("")}
    </div>
  `;
}

function splitBlock(version) {
  const validationPercent = version.sampleCount ? Math.max(8, Math.round((version.split.validation / version.sampleCount) * 100)) : 10;
  return `
    <div>
      <div class="split-bar" style="--train:${100 - validationPercent}%"><span></span><span></span></div>
      <div class="split-labels"><span>训练 ${version.split.train} 条</span><span>验证 ${version.split.validation} 条 · seed ${version.split.seed}</span></div>
    </div>
  `;
}

function versionActions(version) {
  return `
    <div class="action-row">
      ${version.state === "draft"
        ? `<button class="button button-primary button-small" type="button" data-action="publish-version">发布版本</button>`
        : `<button class="button button-small" type="button" data-action="edit-version">${icons.edit}编辑为新版本</button>`}
      <button class="button button-small" type="button" data-action="download-version">${icons.download}下载 JSONL</button>
      <button class="button button-danger button-small" type="button" data-action="delete-version">${icons.trash}删除</button>
    </div>
  `;
}

function renderDatasetBrowserA() {
  const filtered = datasets.filter(datasetMatches);
  return `
    <aside class="panel dataset-browser" aria-label="数据集列表">
      <div class="panel-header">
        <div class="panel-title"><h2>数据集</h2><p>版本按不可变 ID 归组</p></div>
        <span class="count-badge">${filtered.length} 组</span>
      </div>
      <div class="dataset-browser-tools">
        <label class="search-field">
          <span class="sr-only">搜索数据集</span>
          ${icons.search}
          <input type="search" value="${escapeHtml(state.datasetQuery)}" data-input="dataset-query" placeholder="名称、ID 后四位或完整 ID">
        </label>
        <div class="segmented" aria-label="筛选版本状态">
          <button class="segment ${state.statusFilter === "all" ? "is-active" : ""}" type="button" data-action="set-status-filter" data-status="all">全部</button>
          <button class="segment ${state.statusFilter === "published" ? "is-active" : ""}" type="button" data-action="set-status-filter" data-status="published">已发布</button>
          <button class="segment ${state.statusFilter === "draft" ? "is-active" : ""}" type="button" data-action="set-status-filter" data-status="draft">待发布</button>
        </div>
      </div>
      <div class="dataset-list">
        ${filtered.length ? filtered.map((dataset) => {
          const versions = getVersions(dataset);
          return `
            <button class="dataset-item ${dataset.id === state.datasetId ? "is-active" : ""}" type="button" data-action="select-dataset" data-dataset-id="${dataset.id}" title="${dataset.id}">
              <span class="dataset-item-main">
                <span class="dataset-item-name">${escapeHtml(dataset.name)}</span>
                <span class="dataset-item-meta"><span class="id-chip">${dataset.shortId}</span><span>更新 ${escapeHtml(dataset.updatedAt)}</span></span>
                <span class="dataset-item-meta" style="margin-top:7px"><span>最新 v${versions[0].number}</span><span>·</span><span>${versions[0].sampleCount} 条样本</span></span>
              </span>
              <span class="version-count" title="${versions.length} 个版本">${versions.length}</span>
            </button>
          `;
        }).join("") : `<div class="empty-state"><strong>没有匹配的数据集</strong>按名称或完整数据集 ID 搜索。</div>`}
      </div>
      <div class="browser-foot">
        <div class="inline-meta"><span>同名保护</span><span>·</span><span>以 ID 后四位区分</span></div>
        <button class="button button-small" type="button" data-action="open-upload">${icons.upload}新建或追加版本</button>
      </div>
    </aside>
  `;
}

function renderVersionWorkspaceA() {
  const dataset = getDataset();
  const versions = getVersions(dataset);
  return `
    <section class="panel version-workspace" aria-label="版本列表">
      <div class="selected-dataset-header">
        <div class="selected-dataset-title">
          <h2>${escapeHtml(dataset.name)}</h2>
          <p><span class="id-chip">${dataset.shortId}</span> <span class="mono">${dataset.id}</span></p>
        </div>
        <span class="count-badge">${versions.length} 个版本</span>
      </div>
      <div class="version-list">
        ${versions.map((version) => `
          <button class="version-row ${version.id === state.versionId ? "is-active" : ""}" type="button" data-action="select-version" data-dataset-id="${dataset.id}" data-version-id="${version.id}" aria-pressed="${version.id === state.versionId}">
            <span class="version-number">v${version.number}</span>
            <span class="version-main">
              <strong>${version.sampleCount} 条有效样本 · ${formatBytes(version.sizeBytes)}</strong>
              <small>${statusBadge(version.state)} <span class="mono">SHA ${shortHash(version.sha256)}</span></small>
            </span>
            <span class="version-stat">${version.split.train} / ${version.split.validation}<small>训练 / 验证</small></span>
            <span class="version-time">${version.createdAt.split(" ").slice(1).join(" ")}</span>
          </button>
        `).join("")}
      </div>
      <div class="version-workspace-foot">
        <span class="inline-meta"><span class="mono">v1 → v${versions[0].number}</span><span>·</span><span>发布后内容不可变</span></span>
        <button class="button button-small" type="button" data-action="open-upload">${icons.upload}追加 v${nextVersionNumber(dataset.id)}</button>
      </div>
    </section>
  `;
}

function renderInspectorA() {
  const dataset = getDataset();
  const version = getVersion(dataset);
  return `
    <aside class="panel inspector" aria-label="版本详情与样本预览">
      <div class="panel-header">
        <div class="panel-title"><h2>${dataset.name} · v${version.number}</h2><p>校验、拆分与样本审阅</p></div>
        ${statusBadge(version.state)}
      </div>
      <div class="inspector-body">
        <section class="inspector-section">
          <h3 class="section-label"><span>版本信息</span><span class="mono">${version.sampleCount} samples</span></h3>
          <dl class="metadata-grid">
            <dt>版本 ID</dt><dd><code>${version.id}</code></dd>
            <dt>源文件</dt><dd>${formatBytes(version.sizeBytes)} · UTF-8 JSONL</dd>
            <dt>SHA-256</dt><dd><code title="${version.sha256}">${shortHash(version.sha256)}</code></dd>
            <dt>训练拆分</dt><dd>${splitBlock(version)}</dd>
          </dl>
          ${versionActions(version)}
          ${version.state === "published" ? `<div class="inline-note">${icons.info}已发布版本只读。编辑样本会派生一个待发布的新版本。</div>` : ""}
        </section>
        <section class="inspector-section">
          <h3 class="section-label"><span>样本预览</span><button class="text-button" type="button" data-action="edit-version">${state.editing ? "编辑中" : "编辑样本"}</button></h3>
          ${state.editing ? `<div class="editor-banner"><span><strong>新草稿编辑态</strong>保存后生成 v${nextVersionNumber(dataset.id)}，原 v${version.number} 保持不变。</span><button class="button button-primary button-small" type="button" data-action="save-derived">保存草稿</button></div>` : ""}
          <div class="sample-mini-list">${sampleMiniList(3)}</div>
          ${messageStack({ editable: state.editing })}
        </section>
      </div>
    </aside>
  `;
}

function renderVariantA() {
  return `
    ${pageHeading({
      title: "数据集",
      description: "按数据集归组版本，先确认对象身份，再查看校验、拆分和样本内容。",
      secondary: `<button class="button" type="button" data-action="refresh">${icons.refresh}刷新</button>`,
    })}
    ${summaryStrip()}
    <div class="operations-grid">
      ${renderDatasetBrowserA()}
      ${renderVersionWorkspaceA()}
      ${renderInspectorA()}
    </div>
  `;
}

function renderLedgerRows() {
  const filtered = datasets.filter(datasetMatches);
  if (!filtered.length) {
    return `<div class="empty-state"><strong>没有匹配的数据集</strong>清除搜索或切换状态筛选后重试。</div>`;
  }
  return filtered.map((dataset) => {
    const versions = getVersions(dataset);
    return `
      <div class="ledger-row ${dataset.id === state.datasetId ? "is-active" : ""}">
        <div class="ledger-identity">
          <h3>${escapeHtml(dataset.name)}</h3>
          <p>${versions.length} 个版本 · 最新 v${versions[0].number} · 更新 ${escapeHtml(dataset.updatedAt)}</p>
          <div class="identity-chips">
            <span class="id-chip" title="${dataset.id}">${dataset.shortId}</span>
            <span class="count-badge">${versions[0].sampleCount} 条样本</span>
          </div>
        </div>
        <div class="version-track" aria-label="${escapeHtml(dataset.name)} 的版本序列">
          ${versions.slice().reverse().map((version) => `
            <button class="version-node ${dataset.id === state.datasetId && version.id === state.versionId ? "is-active" : ""}" type="button" data-action="select-version" data-dataset-id="${dataset.id}" data-version-id="${version.id}" title="${statusLabel(version.state)} · ${version.createdAt}">
              v${version.number}
            </button>
          `).join("")}
        </div>
        <div class="ledger-row-actions">
          ${statusBadge(versions[0].state)}
          <button class="ledger-select" type="button" data-action="select-dataset" data-dataset-id="${dataset.id}" aria-label="打开 ${escapeHtml(dataset.name)} ${dataset.shortId}">${icons.chevronRight}</button>
        </div>
      </div>
    `;
  }).join("");
}

function renderLineageCompare(dataset, version) {
  const versions = getVersions(dataset);
  const previous = versions
    .filter((candidate) => candidate.number < version.number)
    .sort((left, right) => right.number - left.number)[0];
  if (!previous) {
    return `<div class="inline-note">${icons.info}这是该数据集的首个版本，暂无可比较的上一版本。</div>`;
  }
  const sameHash = previous.sha256 === version.sha256;
  return `
    <div class="lineage-compare">
      <div class="lineage-side"><strong>v${previous.number}</strong><small>${shortHash(previous.sha256)}</small></div>
      <span class="lineage-arrow">${icons.arrowRight}</span>
      <div class="lineage-side"><strong>v${version.number}</strong><small>${shortHash(version.sha256)}</small></div>
    </div>
    <div class="lineage-same">${sameHash ? "内容指纹相同：该版本没有改变原始样本，仅新增了不可变版本记录。" : "内容指纹不同：训练输入已变化，建议先审阅样本差异再发布。"}</div>
  `;
}

function renderLedgerDetail() {
  const dataset = getDataset();
  const version = getVersion(dataset);
  return `
    <aside class="panel ledger-detail" aria-label="当前版本详情">
      <div class="ledger-detail-hero">
        <div class="ledger-detail-kicker"><h2>${escapeHtml(dataset.name)} · v${version.number}</h2>${statusBadge(version.state)}</div>
        <p><span class="id-chip">${dataset.shortId}</span> 版本 ID <span class="mono">${version.id}</span></p>
      </div>
      <div class="ledger-detail-body">
        <section class="quality-block">
          <h3 class="section-label"><span>版本血缘</span><span>SHA-256</span></h3>
          ${renderLineageCompare(dataset, version)}
        </section>
        <section class="quality-block">
          <h3 class="section-label"><span>发布快照</span><span>${version.sampleCount} samples</span></h3>
          <dl class="metadata-grid">
            <dt>源文件</dt><dd>${formatBytes(version.sizeBytes)} · UTF-8 JSONL</dd>
            <dt>训练 / 验证</dt><dd>${version.split.train} / ${version.split.validation} · seed ${version.split.seed}</dd>
            <dt>创建时间</dt><dd>${version.createdAt}</dd>
          </dl>
          ${splitBlock(version)}
          ${versionActions(version)}
        </section>
        <section class="quality-block">
          <h3 class="section-label"><span>样本预览</span><button class="text-button" type="button" data-action="edit-version">编辑为新版本</button></h3>
          <div class="sample-mini-list">${sampleMiniList(3)}</div>
          ${messageStack({ editable: state.editing })}
          ${state.editing ? `<div class="editor-banner"><span><strong>编辑会派生 v${nextVersionNumber(dataset.id)}</strong>原发布版本保持只读。</span><button class="button button-primary button-small" type="button" data-action="save-derived">保存草稿</button></div>` : ""}
        </section>
      </div>
    </aside>
  `;
}

function renderVariantB() {
  const dataset = getDataset();
  return `
    ${pageHeading({
      title: "数据集账本",
      description: "每个数据集是一条独立账本，版本沿同一轨道增长；同名数据集通过不可变 ID 明确区分。",
      actionLabel: "上传文件",
      secondary: `<span class="prototype-chip">内容指纹驱动版本追溯</span>`,
    })}
    <section class="upload-band" aria-label="上传入口">
      <div class="upload-band-title">
        <span class="upload-band-icon">${icons.upload}</span>
        <div><h2>创建数据集或追加版本</h2><p>选择已有数据集时，系统自动使用同一 dataset_id 并生成下一个版本号，不再把同名文件混在同一张平面表中。</p></div>
      </div>
      <div class="upload-band-actions">
        <button class="button button-quiet" type="button" data-action="open-upload-version">追加到 ${escapeHtml(dataset.shortId)}</button>
        <button class="button" type="button" data-action="open-upload">${icons.upload}选择 JSONL</button>
      </div>
    </section>
    ${summaryStrip()}
    <div class="ledger-grid">
      <section class="panel ledger-panel">
        <div class="ledger-toolbar">
          <label class="search-field">
            <span class="sr-only">搜索数据集</span>
            ${icons.search}
            <input type="search" value="${escapeHtml(state.datasetQuery)}" data-input="dataset-query" placeholder="名称、DT 编号或完整 dataset_id">
          </label>
          <div class="segmented" aria-label="筛选版本状态">
            <button class="segment ${state.statusFilter === "all" ? "is-active" : ""}" type="button" data-action="set-status-filter" data-status="all">全部</button>
            <button class="segment ${state.statusFilter === "published" ? "is-active" : ""}" type="button" data-action="set-status-filter" data-status="published">已发布</button>
            <button class="segment ${state.statusFilter === "draft" ? "is-active" : ""}" type="button" data-action="set-status-filter" data-status="draft">待发布</button>
          </div>
        </div>
        <div class="dataset-ledger">${renderLedgerRows()}</div>
      </section>
      ${renderLedgerDetail()}
    </div>
  `;
}

function renderStudioOverview() {
  const versions = getAllDatasetVersions();
  const publishedCount = versions.filter((version) => version.state === "published").length;
  const draftCount = versions.length - publishedCount;
  const totalSamples = versions.reduce((total, version) => total + version.sampleCount, 0);
  const totalBytes = versions.reduce((total, version) => total + version.sizeBytes, 0);
  const sameNameGroups = datasets.filter((dataset) => datasets.filter((candidate) => candidate.name === dataset.name).length > 1).length;
  const latest = datasets[0];

  return `
    <section class="studio-overview" aria-label="数据集整体统计">
      <div class="studio-overview-summary">
        <span class="overview-label">整体统计</span>
        <strong>${datasets.length} 个数据集 · ${versions.length} 个版本</strong>
        <p>最近更新 ${escapeHtml(latest.updatedAt)} · 对象存储回读正常</p>
      </div>
      <div class="studio-overview-metrics">
        <div class="studio-overview-metric"><span>有效样本</span><strong>${totalSamples.toLocaleString("zh-CN")}</strong><small>跨全部版本</small></div>
        <div class="studio-overview-metric"><span>原始数据</span><strong>${formatBytes(totalBytes)}</strong><small>MinIO 对象总量</small></div>
        <div class="studio-overview-metric"><span>已发布</span><strong>${publishedCount}<i> / ${versions.length}</i></strong><small>${draftCount ? draftCount + " 个待发布" : "全部可训练"}</small></div>
        <div class="studio-overview-metric"><span>校验异常</span><strong>0</strong><small>当前无阻塞</small></div>
        <div class="studio-overview-metric"><span>同名数据集</span><strong>${sameNameGroups}</strong><small>均以不可变 ID 区分</small></div>
      </div>
      <div class="studio-overview-health">
        <span class="health-seal">${icons.check}</span>
        <div><strong>数据集链路正常</strong><small>版本、拆分与对象均可用</small></div>
      </div>
    </section>
  `;
}

function renderStudioTree() {
  const filtered = datasets.filter(datasetMatches);
  const sameNameGroups = new Set(
    datasets.filter((dataset) => datasets.filter((candidate) => candidate.name === dataset.name).length > 1).map((dataset) => dataset.name),
  ).size;
  return `
    <aside class="studio-tree">
      <div class="studio-pane-header"><h2>数据集与版本</h2><span>${datasets.length} 组 · ${sameNameGroups} 组同名</span></div>
      <div class="studio-search">
        <label class="search-field">
          <span class="sr-only">搜索数据集</span>
          ${icons.search}
          <input type="search" value="${escapeHtml(state.datasetQuery)}" data-input="dataset-query" placeholder="搜索名称或 ID">
        </label>
      </div>
      <div class="studio-datasets">
        ${filtered.map((dataset) => {
          const versions = getVersions(dataset);
          return `
            <div class="studio-dataset ${dataset.id === state.datasetId ? "is-active" : ""}">
              <button class="studio-dataset-head" type="button" data-action="select-dataset" data-dataset-id="${dataset.id}" aria-current="${dataset.id === state.datasetId ? "true" : "false"}" style="border:0;background:transparent;padding:0;cursor:pointer;text-align:left;width:100%;color:inherit">
                <strong>${escapeHtml(dataset.name)}</strong>
                <small class="id-chip">${dataset.shortId}</small>
              </button>
              <div class="studio-dataset-meta"><span>${versions.length} 个版本</span><span>最新 ${versions[0].sampleCount} 条</span><span>${escapeHtml(dataset.updatedAt)}</span></div>
              <div class="studio-version-list">
                ${versions.slice().reverse().map((version) => `
                  <button class="studio-version-chip ${version.id === state.versionId ? "is-active" : ""}" type="button" data-action="select-version" data-dataset-id="${dataset.id}" data-version-id="${version.id}" aria-pressed="${version.id === state.versionId}" title="${statusLabel(version.state)} · ${version.sampleCount} 条样本"><span class="version-chip-dot ${version.state === "draft" ? "is-draft" : ""}"></span>v${version.number}</button>
                `).join("")}
              </div>
            </div>
          `;
        }).join("") || `<div class="empty-state"><strong>没有匹配项</strong>尝试完整 ID。</div>`}
      </div>
    </aside>
  `;
}

function renderSampleIndex() {
  return `
    <aside class="sample-index" aria-label="样本列表">
      <div class="sample-index-head"><span>物理行号</span><span>校验</span></div>
      <div class="sample-list">
        ${samples.map((sample) => `
          <button class="sample-list-item ${sample.line === state.sampleLine ? "is-active" : ""}" type="button" data-action="select-sample" data-line="${sample.line}">
            <span class="sample-line">${sample.line}</span>
            <span><strong>${escapeHtml(sample.title)}</strong><small>${sample.messages.length} 条消息</small></span>
          </button>
        `).join("")}
      </div>
    </aside>
  `;
}

function renderSampleView(sample, editing) {
  if (state.sampleView === "json") {
    return `
      <div class="sample-data-view" aria-label="原始消息 JSON">
        <div class="sample-data-head">
          <span class="inline-meta"><span class="mono">source line ${sample.line}</span><span>·</span><span>UTF-8</span></span>
          <span class="status status-published">JSON 可解析</span>
        </div>
        <pre>${escapeHtml(JSON.stringify({ messages: sample.messages }, null, 2))}</pre>
      </div>
    `;
  }
  if (state.sampleView === "checks") {
    const checks = [
      ["顶层结构", "messages 数组存在且类型正确"],
      ["角色顺序", sample.messages[0]?.role === "system" ? "system → user → assistant" : "user → assistant"],
      ["消息内容", `${sample.messages.length} / ${sample.messages.length} 条非空`],
      ["字段校验", "0 个错误、0 个警告"],
      ["拆分归属", `seed 42 中归入${["6", "16"].includes(String(sample.line)) ? "验证集" : "训练集"}`],
    ];
    return `
      <div class="sample-check-view" aria-label="字段与拆分校验">
        ${checks.map(([label, value]) => `
          <div class="sample-check-row">
            <span class="preflight-icon">✓</span>
            <div><strong>${escapeHtml(label)}</strong><small>${escapeHtml(value)}</small></div>
            <span>通过</span>
          </div>
        `).join("")}
      </div>
    `;
  }
  return messageStack({ editable: editing });
}

function renderSampleStudio() {
  const dataset = getDataset();
  const version = getVersion(dataset);
  const sample = selectedMessages();
  return `
    <section class="sample-studio" aria-label="样本审阅与编辑">
      <div class="sample-toolbar">
        <div class="sample-toolbar-title">
          <strong>${escapeHtml(dataset.name)} · v${version.number} · 第 ${sample.line} 行</strong>
          <small>${statusLabel(version.state)} · ${version.sampleCount} 条有效样本 · 第 ${sample.line} 行校验通过</small>
        </div>
        <div class="sample-toolbar-actions">
          <div class="segmented sample-view-switch" aria-label="样本视图">
            <button class="segment ${state.sampleView === "dialog" ? "is-active" : ""}" type="button" data-action="set-sample-view" data-view="dialog">对话</button>
            <button class="segment ${state.sampleView === "json" ? "is-active" : ""}" type="button" data-action="set-sample-view" data-view="json">JSONL</button>
            <button class="segment ${state.sampleView === "checks" ? "is-active" : ""}" type="button" data-action="set-sample-view" data-view="checks">校验</button>
          </div>
          <button class="button button-small" type="button" data-action="select-previous-sample">上一行</button>
          <button class="button button-small" type="button" data-action="select-next-sample">下一行</button>
          <button class="button button-primary button-small" type="button" data-action="edit-version" ${state.sampleView !== "dialog" ? 'title="切换到对话视图后编辑"' : ""}>${icons.edit}${state.editing ? "正在编辑" : "编辑样本"}</button>
        </div>
      </div>
      <div class="sample-workspace">
        ${renderSampleIndex()}
        <div class="sample-reader">
          <div class="sample-reader-head">
            <div><h3>${escapeHtml(sample.title)}</h3><p>messages · ${sample.messages.length} 条 · source line ${sample.line}</p></div>
            <span class="status status-published">校验通过</span>
          </div>
          <div class="sample-reader-body">
            ${state.editing ? `
              <div class="editor-banner">
                <span><strong>不可变发布策略</strong>${version.state === "published" ? `当前 v${version.number} 已发布。保存修改将创建 v${nextVersionNumber(dataset.id)} 草稿，不会覆盖当前训练输入。` : "修改只保存到当前待发布草稿。"}</span>
                <button class="button button-primary button-small" type="button" data-action="save-derived">保存为 v${nextVersionNumber(dataset.id)} 草稿</button>
              </div>
            ` : `<div class="inline-note">${icons.info}预览模式为只读。点击“编辑样本”会基于当前版本派生新草稿，并保留原始内容指纹。</div>`}
            ${renderSampleView(sample, state.editing)}
          </div>
          <div class="sample-reader-foot">
            <span class="inline-meta"><span>第 ${sample.line} 行</span><span>·</span><span>${sample.messages.length} 条消息</span><span>·</span><span>无字段错误</span><span>·</span><span>${["6", "16"].includes(String(sample.line)) ? "验证集" : "训练集"}</span></span>
            <span class="sample-keyboard-hint"><kbd>↑</kbd><kbd>↓</kbd> 切换样本</span>
          </div>
        </div>
      </div>
    </section>
  `;
}

function renderQualityPanel() {
  const dataset = getDataset();
  const version = getVersion(dataset);
  const versions = getVersions(dataset);
  const previous = versions
    .filter((candidate) => candidate.number < version.number)
    .sort((left, right) => right.number - left.number)[0];
  const splitRatio = version.sampleCount ? ((version.split.validation / version.sampleCount) * 100).toFixed(3) : "0.000";
  return `
    <aside class="quality-panel" aria-label="版本质量与发布">
      <div class="studio-pane-header"><h2>版本检查</h2><span>${dataset.shortId} · v${version.number}</span></div>
      <div class="quality-body">
        <section class="quality-block quality-kpi-block">
          <h3>当前版本概览</h3>
          <div class="quality-kpis">
            <div><span>有效样本</span><strong>${version.sampleCount}</strong></div>
            <div><span>训练 / 验证</span><strong>${version.split.train} / ${version.split.validation}</strong></div>
            <div><span>实际验证比例</span><strong>${splitRatio}%</strong></div>
            <div><span>文件大小</span><strong>${formatBytes(version.sizeBytes)}</strong></div>
          </div>
        </section>
        <section class="quality-block">
          <h3>发布状态</h3>
          <div class="quality-callout">
            <strong>${statusLabel(version.state)} · 可用于训练</strong>
            <p>${version.sampleCount} 条样本全部通过字段与角色顺序校验，原始文件已在对象存储回读核验。</p>
          </div>
          <div class="inline-meta"><span class="status status-published">0 errors</span><span class="status status-published">MinIO verified</span></div>
        </section>
        <section class="quality-block">
          <h3>固定拆分</h3>
          ${splitBlock(version)}
          <div class="inline-note">${icons.info}实际比例 ${splitRatio}%，请求目标 10%；验证物理行 6、16。</div>
        </section>
        <section class="quality-block">
          <h3>不可变身份</h3>
          <dl class="metadata-grid">
            <dt>dataset</dt><dd><code>${dataset.shortId}</code></dd>
            <dt>version</dt><dd><code>v${version.number}</code></dd>
            <dt>SHA-256</dt><dd><code title="${version.sha256}">${shortHash(version.sha256)}</code></dd>
            <dt>大小</dt><dd>${formatBytes(version.sizeBytes)}</dd>
          </dl>
        </section>
        <section class="quality-block">
          <h3>版本血缘</h3>
          ${previous ? `
            <div class="quality-lineage">
              <div><span>上一版本</span><strong>v${previous.number}</strong><small>${previous.sampleCount} 条</small></div>
              <span class="lineage-arrow">${icons.arrowRight}</span>
              <div><span>当前版本</span><strong>v${version.number}</strong><small>${version.sampleCount} 条</small></div>
            </div>
            <div class="lineage-same">${previous.sha256 === version.sha256 ? "内容指纹相同：当前版本未改变样本内容。" : "内容指纹不同：当前版本包含新的训练输入。"}</div>
          ` : `<div class="inline-note">${icons.info}这是当前数据集的首个版本。</div>`}
        </section>
        <section class="quality-block">
          <h3>引用与风险</h3>
          <div class="reference-list">
            <div class="reference-item"><span>训练任务引用</span><strong>0</strong></div>
            <div class="reference-item"><span>删除保护</span><strong>允许删除</strong></div>
          </div>
        </section>
        <section class="quality-block">
          <h3>操作</h3>
          <div class="quality-actions">
            <button class="button button-primary" type="button" data-action="${version.state === "draft" ? "publish-version" : "edit-version"}">${version.state === "draft" ? "发布版本" : "编辑为新版本"}</button>
            <button class="button" type="button" data-action="download-version">${icons.download}下载原始 JSONL</button>
          </div>
          <div class="inline-note warning">${icons.info}有训练任务引用后，版本与存储对象将进入删除保护。</div>
        </section>
      </div>
    </aside>
  `;
}

function renderVariantC() {
  return `
    <div class="studio-heading">
      <div>
        <h1>数据审阅工作室</h1>
        <p>从整体资产统计进入单个数据集，在逐行样本审阅中完成版本核对、编辑与发布判断。</p>
      </div>
      <div class="heading-actions">
        <button class="button" type="button" data-action="refresh">${icons.refresh}刷新</button>
        <button class="button button-primary" type="button" data-action="open-upload">${icons.upload}上传 JSONL</button>
      </div>
    </div>
    ${renderStudioOverview()}
    <div class="studio-shell">
      ${renderStudioTree()}
      ${renderSampleStudio()}
      ${renderQualityPanel()}
    </div>
  `;
}

function renderApp() {
  root.dataset.theme = state.theme;
  root.dataset.density = state.density;
  document.querySelectorAll(".variant-tab").forEach((button) => {
    button.setAttribute("aria-selected", String(button.dataset.variant === state.variant));
  });

  if (state.variant === "a") {
    app.innerHTML = productFrame(renderVariantA(), "A · 三栏操作台");
  } else if (state.variant === "b") {
    app.innerHTML = productFrame(renderVariantB(), "B · 版本账本");
  } else {
    app.innerHTML = productFrame(renderVariantC(), "C · 数据审阅工作室");
  }

  revealStudioSelection();

  if (document.activeElement?.dataset.input === "dataset-query") {
    window.requestAnimationFrame(() => {
      const input = document.querySelector('[data-input="dataset-query"]');
      input?.focus();
      input?.setSelectionRange(input.value.length, input.value.length);
    });
  }
}

function revealStudioSelection() {
  if (state.variant !== "c" || !window.matchMedia("(max-width: 820px)").matches) return;
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      const reveal = (containerSelector, activeSelector) => {
        const container = document.querySelector(containerSelector);
        const active = document.querySelector(activeSelector);
        if (!container || !active || container.scrollWidth <= container.clientWidth) return;
        const containerRect = container.getBoundingClientRect();
        const activeRect = active.getBoundingClientRect();
        container.scrollLeft += activeRect.left - containerRect.left - (container.clientWidth - activeRect.width) / 2;
      };
      reveal(".studio-datasets", ".studio-dataset.is-active");
      reveal(".sample-list", ".sample-list-item.is-active");
    });
  });
}

function renderUploadDrawer() {
  if (!state.upload.open) {
    drawerRoot.innerHTML = "";
    document.body.style.overflow = "";
    return;
  }
  document.body.style.overflow = "hidden";
  const targetDataset = getDataset(state.upload.datasetId);
  const nextNumber = state.upload.target === "existing" ? nextVersionNumber(targetDataset.id) : 1;
  const fileName = state.upload.file?.name || "";
  const fileSize = state.upload.file?.size;
  const valid = state.upload.phase === "valid";
  const validating = state.upload.phase === "validating";
  const pickerIndex = Math.min(Math.max(0, state.upload.pickerIndex), datasets.length - 1);
  const targetVersions = getVersions(targetDataset);
  const targetLatestVersion = targetVersions[0];
  const datasetOptions = datasets.map((dataset, index) => {
    const versions = getVersions(dataset);
    const latest = versions[0];
    const sameNameCount = datasets.filter((candidate) => candidate.name === dataset.name).length;
    const selected = dataset.id === state.upload.datasetId;
    return `
      <button
        class="dataset-picker-option ${selected ? "is-selected" : ""}"
        id="upload-dataset-option-${index}"
        type="button"
        role="option"
        aria-selected="${selected}"
        tabindex="${index === pickerIndex ? "0" : "-1"}"
        data-action="select-upload-dataset"
        data-dataset-id="${dataset.id}"
        data-picker-index="${index}"
      >
        <span class="dataset-picker-option-main">
          <span class="dataset-picker-option-title">
            <strong>${escapeHtml(dataset.name)}</strong>
            <code class="id-chip">${dataset.shortId}</code>
            ${sameNameCount > 1 ? `<span class="duplicate-name-tag">同名</span>` : ""}
          </span>
          <span class="dataset-picker-option-meta">
            <span>${versions.length} 个版本</span>
            <span>最新 v${latest.number}</span>
            <span>${latest.sampleCount} 条有效样本</span>
            <span class="picker-status ${latest.state === "draft" ? "is-draft" : ""}">${statusLabel(latest.state)}</span>
          </span>
        </span>
        <span class="dataset-picker-option-check">${selected ? icons.check : ""}</span>
      </button>
    `;
  }).join("");

  drawerRoot.innerHTML = `
    <div class="drawer-scrim" data-action="close-upload"></div>
    <aside class="upload-drawer" role="dialog" aria-modal="true" aria-labelledby="upload-title">
      <header class="drawer-head">
        <div><h2 id="upload-title">上传 messages JSONL</h2><p>选择目标、校验内容，再提交不可变版本</p></div>
        <button class="icon-button" type="button" data-action="close-upload" aria-label="关闭上传面板">${icons.close}</button>
      </header>
      <div class="drawer-body">
        <section class="drawer-step">
          <div class="step-heading"><span class="step-number">01</span><strong>选择版本目标</strong></div>
          <div class="destination-toggle">
            <button class="destination-option ${state.upload.target === "new" ? "is-active" : ""}" type="button" data-action="set-upload-target" data-target="new">
              <strong>新建数据集</strong><small>从 v1 开始</small>
            </button>
            <button class="destination-option ${state.upload.target === "existing" ? "is-active" : ""}" type="button" data-action="set-upload-target" data-target="existing">
              <strong>追加已有数据集</strong><small>自动生成下一版本</small>
            </button>
          </div>
          ${state.upload.target === "new" ? `
            <label>
              <span class="field-label">数据集名称</span>
              <input class="text-control" type="text" data-input="new-dataset-name" value="${escapeHtml(state.upload.newDatasetName)}" placeholder="例如：客服问答">
            </label>
            <div class="inline-note">${icons.info}新数据集将获得独立 dataset_id；即使名称相同，也不会与已有数据集混合。</div>
          ` : `
            <div class="dataset-picker-field">
              <span class="field-label" id="upload-dataset-label">已有数据集 · 名称相同时请核对 ID</span>
              <div class="dataset-combobox ${state.upload.pickerOpen ? "is-open" : ""}">
                <button
                  class="dataset-combobox-trigger"
                  type="button"
                  data-action="toggle-upload-dataset"
                  aria-labelledby="upload-dataset-label upload-dataset-current"
                  aria-haspopup="listbox"
                  aria-expanded="${state.upload.pickerOpen}"
                  aria-controls="upload-dataset-menu"
                >
                  <span class="dataset-combobox-icon">${icons.layers}</span>
                  <span class="dataset-combobox-copy">
                    <span class="dataset-combobox-title" id="upload-dataset-current">
                      <strong>${escapeHtml(targetDataset.name)}</strong>
                      <code class="id-chip">${targetDataset.shortId}</code>
                    </span>
                    <small>${targetVersions.length} 个版本 · 最新 v${targetLatestVersion.number} · ${targetLatestVersion.sampleCount} 条有效样本 · ${statusLabel(targetLatestVersion.state)}</small>
                  </span>
                  <span class="dataset-combobox-chevron">${icons.chevronDown}</span>
                </button>
                ${state.upload.pickerOpen ? `
                  <div class="dataset-picker-menu" id="upload-dataset-menu" role="listbox" aria-labelledby="upload-dataset-label">
                    <div class="dataset-picker-menu-head">
                      <span>选择目标数据集</span>
                      <small>${datasets.length} 项 · ID 为唯一匹配依据</small>
                    </div>
                    <div class="dataset-picker-options">${datasetOptions}</div>
                  </div>
                ` : ""}
              </div>
            </div>
            <div class="destination-summary">
              <div><strong>${escapeHtml(targetDataset.name)}</strong><p><span class="id-chip">${targetDataset.shortId}</span> 新版本由后端按 dataset_id 自动递增</p></div>
              <span class="next-version">v${nextNumber}</span>
            </div>
          `}
        </section>

        <section class="drawer-step">
          <div class="step-heading"><span class="step-number">02</span><strong>选择文件</strong></div>
          <label class="file-drop ${state.upload.file ? "has-file" : ""}">
            <input type="file" accept=".jsonl,application/x-ndjson" data-input="dataset-file">
            <span class="file-drop-icon">${state.upload.file ? icons.file : icons.upload}</span>
            <strong>${state.upload.file ? escapeHtml(fileName) : "拖入 JSONL，或点击选择文件"}</strong>
            <p>${state.upload.file ? `${formatBytes(fileSize)} · 等待服务端校验` : "仅接收 UTF-8 messages JSONL，每行一条对话"}</p>
            <small>${state.upload.file ? "如需替换，点击此处重新选择" : "支持 system / user / assistant 单轮和多轮内容"}</small>
          </label>
          <div class="action-row">
            <button class="button button-small" type="button" data-action="choose-demo-file">使用演示文件</button>
            <span class="muted" style="font-size:9px">${state.upload.demo ? "已载入 24 条演示样本" : "未读取本机文件内容"}</span>
          </div>
          ${state.upload.file ? `
            <div class="selected-file">
              <div><strong>${escapeHtml(fileName)}</strong><small>${formatBytes(fileSize)} · ${state.upload.demo ? "演示数据" : "本地待上传文件"}</small></div>
              <button class="text-button" type="button" data-action="clear-file">移除</button>
            </div>
          ` : ""}
        </section>

        <section class="drawer-step">
          <div class="step-heading"><span class="step-number">03</span><strong>预检</strong></div>
          <div class="preflight-list">
            <div class="preflight-item ${state.upload.file ? "" : "is-pending"}"><span class="preflight-icon">${state.upload.file ? "✓" : "·"}</span><span>目标身份与下一版本号</span><span>${state.upload.target === "new" ? "新数据集" : targetDataset.shortId + " · v" + nextNumber}</span></div>
            <div class="preflight-item ${state.upload.file ? "" : "is-pending"}"><span class="preflight-icon">${state.upload.file ? "✓" : "·"}</span><span>文件类型与容量</span><span>${state.upload.file ? formatBytes(fileSize) : "未选择"}</span></div>
            <div class="preflight-item ${validating ? "is-running" : valid ? "" : "is-pending"}"><span class="preflight-icon">${validating ? "…" : valid ? "✓" : "·"}</span><span>逐行 messages 校验</span><span>${validating ? `<span class="progress-state">正在校验</span>` : valid ? "24 / 24 通过" : "待运行"}</span></div>
            <div class="preflight-item ${valid ? "" : "is-pending"}"><span class="preflight-icon">${valid ? "✓" : "·"}</span><span>确定训练 / 验证拆分</span><span>${valid ? "22 / 2 · seed 42" : "待生成"}</span></div>
          </div>
          ${valid ? `
            <div class="validation-result">
              <div><span>有效样本</span><strong>24</strong></div>
              <div><span>错误</span><strong>0</strong></div>
              <div><span>文件大小</span><strong>7.15 KiB</strong></div>
            </div>
          ` : ""}
        </section>

        <section class="drawer-step">
          <div class="step-heading"><span class="step-number">04</span><strong>服务端限制</strong></div>
          <div class="limit-grid">
            <div class="limit-item"><span>单文件上限</span><strong>100 MiB</strong></div>
            <div class="limit-item"><span>有效样本上限</span><strong>100,000</strong></div>
            <div class="limit-item"><span>单行上限</span><strong>1 MiB</strong></div>
            <div class="limit-item"><span>校验错误展示</span><strong>最多 100 条</strong></div>
          </div>
          <div class="inline-note">${icons.info}原型不会上传文件。正式流程会将原始内容写入 MinIO，并在回读成功后保存版本元数据。</div>
        </section>
      </div>
      <footer class="drawer-foot">
        <span class="drawer-foot-note">${icons.info}校验通过后才能保存</span>
        <div class="drawer-foot-actions">
          <button class="button" type="button" data-action="close-upload">取消</button>
          ${valid
            ? `<button class="button button-primary" type="button" data-action="submit-upload">保存为 v${nextNumber}</button>`
            : `<button class="button button-primary" type="button" data-action="verify-upload" ${state.upload.file && !validating ? "" : "disabled"}>${validating ? "校验中…" : "上传并校验"}</button>`}
        </div>
      </footer>
    </aside>
  `;
  if (state.upload.pickerOpen) {
    focusUploadControl(`#upload-dataset-option-${pickerIndex}`);
  }
}

function focusUploadControl(selector) {
  window.requestAnimationFrame(() => drawerRoot.querySelector(selector)?.focus());
}

function selectDataset(datasetId) {
  const dataset = getDataset(datasetId);
  const versions = getVersions(dataset);
  state.datasetId = dataset.id;
  state.versionId = versions[0].id;
  state.sampleLine = 1;
  state.sampleView = "dialog";
  state.editing = false;
  state.upload.datasetId = dataset.id;
  renderApp();
}

function selectVersion(datasetId, versionId) {
  const dataset = getDataset(datasetId);
  const version = getVersion(dataset, versionId);
  state.datasetId = dataset.id;
  state.versionId = version.id;
  state.sampleLine = 1;
  state.sampleView = "dialog";
  state.editing = false;
  state.upload.datasetId = dataset.id;
  renderApp();
}

function openUpload(mode = "new") {
  state.upload.open = true;
  state.upload.target = mode;
  state.upload.datasetId = state.datasetId;
  state.upload.phase = "idle";
  state.upload.file = null;
  state.upload.demo = false;
  state.upload.pickerOpen = false;
  state.upload.pickerIndex = Math.max(0, datasets.findIndex((dataset) => dataset.id === state.upload.datasetId));
  renderUploadDrawer();
  animateUploadDrawer();
  focusUploadControl(".drawer-head [data-action='close-upload']");
}

function animateUploadDrawer() {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const drawer = drawerRoot.querySelector(".upload-drawer");
  const scrim = drawerRoot.querySelector(".drawer-scrim");
  const easing = "cubic-bezier(0.2, 0.8, 0.2, 1)";
  drawer?.animate(
    [
      { transform: "translateX(28px)", opacity: 0 },
      { transform: "translateX(0)", opacity: 1 },
    ],
    { duration: 220, easing },
  );
  scrim?.animate(
    [{ opacity: 0 }, { opacity: 1 }],
    { duration: 180, easing },
  );
}

function closeUpload() {
  state.upload.open = false;
  state.upload.pickerOpen = false;
  renderUploadDrawer();
}

function startEdit() {
  const version = getVersion();
  state.sampleView = "dialog";
  state.editing = true;
  renderApp();
  showToast(
    version.state === "published" ? "已进入派生编辑模式" : "已进入草稿编辑模式",
    version.state === "published"
      ? `保存后会创建 v${nextVersionNumber(getDataset().id)}，原 v${version.number} 保持不变。`
      : "修改会保存在当前待发布草稿中。"
  );
}

function saveDerivedVersion() {
  const dataset = getDataset();
  const version = getVersion(dataset);
  const number = nextVersionNumber(dataset.id);
  const draft = {
    ...version,
    id: `prototype-v${number}-${Date.now()}`,
    number,
    state: "draft",
    createdAt: "刚刚 · 原型草稿",
    sha256: `${version.sha256.slice(0, -8)}c0ffee42`,
  };
  state.derivedVersions[dataset.id] = [...(state.derivedVersions[dataset.id] || []), draft];
  state.versionId = draft.id;
  state.sampleView = "dialog";
  state.editing = false;
  renderApp();
  showToast("草稿已创建", `${dataset.name} · v${number} 已生成。原型仅模拟版本派生，未写入数据库或对象存储。`);
}

function publishCurrentVersion() {
  const dataset = getDataset();
  const version = getVersion(dataset);
  const derived = state.derivedVersions[dataset.id] || [];
  const current = derived.find((item) => item.id === version.id);
  if (current) {
    current.state = "published";
    current.createdAt = "刚刚 · 已发布";
    showToast("版本已发布", `${dataset.name} · v${current.number} 在原型中切换为已发布。`);
  } else {
    showToast("已经发布", `${dataset.name} · v${version.number} 当前状态为${statusLabel(version.state)}。`);
  }
  renderApp();
}

function handleAction(action, element) {
  switch (action) {
    case "set-variant": {
      const variant = element.dataset.variant;
      if (!["a", "b", "c"].includes(variant)) return;
      state.variant = variant;
      history.replaceState(null, "", `#${variant}`);
      state.editing = false;
      renderApp();
      return;
    }
    case "toggle-theme":
      state.theme = state.theme === "light" ? "dark" : "light";
      localStorage.setItem("mf-dataset-theme", state.theme);
      root.dataset.theme = state.theme;
      return;
    case "toggle-density":
      state.density = state.density === "comfortable" ? "compact" : "comfortable";
      localStorage.setItem("mf-dataset-density", state.density);
      root.dataset.density = state.density;
      return;
    case "select-dataset":
      selectDataset(element.dataset.datasetId);
      return;
    case "select-version":
      selectVersion(element.dataset.datasetId, element.dataset.versionId);
      return;
    case "select-sample":
      state.sampleLine = Number(element.dataset.line);
      renderApp();
      return;
    case "select-previous-sample":
      state.sampleLine = Math.max(1, state.sampleLine - 1);
      renderApp();
      return;
    case "select-next-sample":
      state.sampleLine = Math.min(samples.length, state.sampleLine + 1);
      renderApp();
      return;
    case "set-sample-view":
      state.sampleView = element.dataset.view;
      renderApp();
      return;
    case "set-status-filter":
      state.statusFilter = element.dataset.status;
      renderApp();
      return;
    case "open-upload":
      openUpload("new");
      return;
    case "open-upload-version":
      openUpload("existing");
      return;
    case "close-upload":
      closeUpload();
      return;
    case "set-upload-target":
      state.upload.target = element.dataset.target;
      state.upload.phase = "idle";
      state.upload.pickerOpen = false;
      renderUploadDrawer();
      focusUploadControl(`[data-action="set-upload-target"][data-target="${element.dataset.target}"]`);
      return;
    case "toggle-upload-dataset": {
      state.upload.pickerOpen = !state.upload.pickerOpen;
      state.upload.pickerIndex = Math.max(0, datasets.findIndex((dataset) => dataset.id === state.upload.datasetId));
      renderUploadDrawer();
      if (!state.upload.pickerOpen) focusUploadControl('[data-action="toggle-upload-dataset"]');
      return;
    }
    case "select-upload-dataset":
      state.upload.datasetId = element.dataset.datasetId;
      state.upload.phase = "idle";
      state.upload.pickerOpen = false;
      state.upload.pickerIndex = Number(element.dataset.pickerIndex);
      renderUploadDrawer();
      focusUploadControl('[data-action="toggle-upload-dataset"]');
      return;
    case "choose-demo-file":
      state.upload.file = { name: "modelforge-sft-smoke-20261102.jsonl", size: 7325 };
      state.upload.demo = true;
      state.upload.phase = "idle";
      renderUploadDrawer();
      focusUploadControl('[data-action="verify-upload"]');
      return;
    case "clear-file":
      state.upload.file = null;
      state.upload.demo = false;
      state.upload.phase = "idle";
      renderUploadDrawer();
      return;
    case "verify-upload":
      verifyUpload();
      return;
    case "submit-upload":
      submitUpload();
      return;
    case "edit-version":
      startEdit();
      return;
    case "save-derived":
      saveDerivedVersion();
      return;
    case "publish-version":
      publishCurrentVersion();
      return;
    case "download-version":
      showToast("原型下载入口", "正式产品将下载经 SHA-256 回读核验的原始 JSONL；原型不生成伪造文件。");
      return;
    case "delete-version":
      showToast("删除需要二次确认", "正式实现会先检查训练引用，再确认删除 MinIO 对象和数据库记录。");
      return;
    case "view-raw":
      showToast("原始 JSONL 预览", "原型保留消息级编辑器；正式实现可增加只读源码视图，并与字段校验错误联动。");
      return;
    case "refresh":
      showToast("列表已刷新", "原型状态来自当前页面；正式产品会重新读取真实版本与状态。");
      return;
    default:
  }
}

function verifyUpload() {
  if (!state.upload.file) return;
  state.upload.phase = "validating";
  renderUploadDrawer();
  window.setTimeout(() => {
    if (!state.upload.open || !state.upload.file) return;
    state.upload.phase = "valid";
    renderUploadDrawer();
  }, 750);
}

function submitUpload() {
  const target = state.upload.target === "existing"
    ? getDataset(state.upload.datasetId)
    : { name: state.upload.newDatasetName || "未命名数据集", shortId: "NEW" };
  const number = state.upload.target === "existing" ? nextVersionNumber(target.id) : 1;
  closeUpload();
  showToast(
    "原型已模拟保存",
    `${target.name} · v${number} 校验与拆分已完成。未写入 PostgreSQL 或 MinIO。`
  );
}

document.addEventListener("click", (event) => {
  const target = event.target.closest("[data-action]");
  if (!target) return;
  handleAction(target.dataset.action, target);
});

document.addEventListener("input", (event) => {
  const target = event.target;
  if (target.dataset.input === "dataset-query") {
    state.datasetQuery = target.value;
    renderApp();
    return;
  }
  if (target.dataset.input === "new-dataset-name") {
    state.upload.newDatasetName = target.value;
    return;
  }
  if (target.dataset.sampleRole) {
    const sample = selectedMessages();
    const index = Number(target.dataset.messageIndex);
    if (sample.messages[index]) sample.messages[index].content = target.value;
  }
});

document.addEventListener("change", (event) => {
  const target = event.target;
  if (target.dataset.input === "dataset-file") {
    const file = target.files?.[0];
    if (!file) return;
    state.upload.file = { name: file.name, size: file.size };
    state.upload.demo = false;
    state.upload.phase = "idle";
    renderUploadDrawer();
  }
});

document.addEventListener("keydown", (event) => {
  const picker = document.querySelector(".dataset-combobox");
  const inPicker = Boolean(picker && event.target instanceof Element && picker.contains(event.target));
  const pickerTrigger = event.target instanceof Element
    ? event.target.closest('[data-action="toggle-upload-dataset"]')
    : null;

  if (state.upload.open && !state.upload.pickerOpen && pickerTrigger && ["ArrowDown", "ArrowUp"].includes(event.key)) {
    event.preventDefault();
    state.upload.pickerOpen = true;
    state.upload.pickerIndex = Math.max(0, datasets.findIndex((dataset) => dataset.id === state.upload.datasetId));
    renderUploadDrawer();
    return;
  }

  if (state.upload.open && state.upload.pickerOpen && inPicker) {
    if (event.key === "Escape") {
      event.preventDefault();
      state.upload.pickerOpen = false;
      renderUploadDrawer();
      focusUploadControl('[data-action="toggle-upload-dataset"]');
      return;
    }
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      if (event.key === "Home") state.upload.pickerIndex = 0;
      else if (event.key === "End") state.upload.pickerIndex = datasets.length - 1;
      else state.upload.pickerIndex = (state.upload.pickerIndex + (event.key === "ArrowDown" ? 1 : -1) + datasets.length) % datasets.length;
      const options = [...drawerRoot.querySelectorAll(".dataset-picker-option")];
      options.forEach((option, index) => {
        option.tabIndex = index === state.upload.pickerIndex ? 0 : -1;
      });
      options[state.upload.pickerIndex]?.focus();
      return;
    }
    if (["Enter", " "].includes(event.key) && event.target.matches(".dataset-picker-option")) {
      event.preventDefault();
      handleAction("select-upload-dataset", event.target);
      return;
    }
  }

  if (event.key === "Escape" && state.upload.open) {
    closeUpload();
    return;
  }
  if (!state.upload.open && state.variant === "c" && ["ArrowUp", "ArrowDown"].includes(event.key) && !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName)) {
    event.preventDefault();
    state.sampleLine = event.key === "ArrowUp"
      ? Math.max(1, state.sampleLine - 1)
      : Math.min(samples.length, state.sampleLine + 1);
    renderApp();
    return;
  }
  if (!state.upload.open) return;
  if (event.key !== "Tab") return;
  const focusable = [...drawerRoot.querySelectorAll("button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled)")];
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
});

window.addEventListener("hashchange", () => {
  const next = window.location.hash.replace("#", "");
  if (["a", "b", "c"].includes(next) && next !== state.variant) {
    state.variant = next;
    renderApp();
  }
});

renderApp();
renderUploadDrawer();
