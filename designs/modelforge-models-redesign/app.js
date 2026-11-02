const appRoot = document.querySelector("#app");
const drawerRoot = document.querySelector("#drawer-root");
const toastRoot = document.querySelector("#toast-root");

const families = [
  {
    id: "MDL-7A2F",
    name: "Qwen3-0.6B",
    source: "modelscope",
    repository: "Qwen/Qwen3-0.6B",
    note: "托管模型 · 真实训练与推理基线",
    updatedAt: "2026-11-02 18:24",
    versions: [
      {
        id: "51f7b869-9894-424b-bc5d-dba013723ddb",
        shortId: "MV-51F7",
        version: 1,
        state: "available",
        compatibility: "verified",
        createdAt: "2026-11-02 18:24",
        bytes: 1519209873,
        files: 11,
        manifest: "ffeb1654eaf9f55ac1ece9d1396c006cb17ff6d18f2d21a120fd0cef28a0166a",
        sourceSnapshot: {
          title: "ModelScope 固定快照",
          primary: "Qwen/Qwen3-0.6B",
          secondary: "commit 09b42cad3d112e832108974449ccb5e8e0f5b5d1",
          fetchedAt: "2026-10-30 23:12",
        },
        references: 2,
        importState: "succeeded",
        compatibilityText: "RTX 4090 · CUDA 13.2 · LLaMA-Factory 0.9.5",
      },
      {
        id: "905cc3a7-c891-436f-8958-1bb4cd6bdc21",
        shortId: "MV-905C",
        version: 2,
        state: "uploading",
        compatibility: "unverified",
        createdAt: "2026-11-03 01:08",
        bytes: 974320185,
        totalBytes: 1519209873,
        files: 8,
        totalFiles: 11,
        manifest: null,
        sourceSnapshot: {
          title: "ModelScope 固定快照",
          primary: "Qwen/Qwen3-0.6B",
          secondary: "commit 09b42cad…b5d1 · 复用 8 个已验证文件",
          fetchedAt: "2026-11-03 01:08",
        },
        references: 0,
        importState: "running",
        currentPath: "model-00002-of-00002.safetensors",
        progress: 63,
        compatibilityText: "文件回读完成前不能判断运行兼容",
      },
    ],
  },
  {
    id: "MDL-9C41",
    name: "Qwen3-0.6B · 优云公共基座",
    source: "ucloud_public",
    note: "外部只读引用 · 不复制权重",
    updatedAt: "2026-11-01 16:42",
    versions: [
      {
        id: "7c903b45-70d5-4fac-8592-9ff7cbb13310",
        shortId: "MV-7C90",
        version: 1,
        state: "awaiting_verification",
        compatibility: "unverified",
        createdAt: "2026-11-01 16:42",
        bytes: 1519209873,
        files: 11,
        manifest: null,
        sourceSnapshot: {
          title: "优云公共目录快照",
          primary: "华北二 · cn-wlcb-01",
          secondary: "/model/ModelScope/Qwen/Qwen3-0.6B",
          fetchedAt: "2026-11-01 16:42",
        },
        externalCheck: "awaiting_verification",
        lastInstance: "尚未绑定实际训练实例",
        references: 0,
        compatibilityText: "目录存在不等于可挂载、可训练或内容一致",
      },
    ],
  },
  {
    id: "MDL-3E8A",
    name: "客服助手基础模型",
    source: "directory",
    note: "完整目录上传 · 异常待恢复",
    updatedAt: "2026-11-02 21:10",
    versions: [
      {
        id: "bc08a975-4a25-4d0c-a6b0-7ce093d7a6fb",
        shortId: "MV-BC08",
        version: 1,
        state: "delete_failed",
        compatibility: "unverified",
        createdAt: "2026-11-02 20:54",
        bytes: 2387041280,
        files: 14,
        manifest: "4248bdca4e51bd5520b0ee146391409c99dc7677c64cd0c42ccd73bcab2bdbe9",
        sourceSnapshot: {
          title: "完整目录上传",
          primary: "14 个文件 · config / tokenizer / weights",
          secondary: "最近失败：对象存储清理未完成",
          fetchedAt: "2026-11-02 21:10",
        },
        error: "delete_failed：MinIO 对象仍在，元数据已保留以便重试。",
        references: 0,
        compatibilityText: "删除异常；不得将此状态视为可训练",
      },
    ],
  },
  {
    id: "MDL-6B20",
    name: "Qwen3-0.6B 归档副本",
    source: "directory",
    note: "完整目录上传 · 兼容性未验证",
    updatedAt: "2026-10-31 14:06",
    versions: [
      {
        id: "94118df5-c08f-4939-97fb-efc771cc98b8",
        shortId: "MV-9411",
        version: 1,
        state: "available",
        compatibility: "unverified",
        createdAt: "2026-10-31 14:06",
        bytes: 1519209873,
        files: 11,
        manifest: "87ba0cdb7ee1f63de45364e2f6f45c890a60a5a17308abf2e63ad173d14f8e8d",
        sourceSnapshot: {
          title: "完整目录上传",
          primary: "11 个文件 · 回读 SHA-256 全部一致",
          secondary: "来源目录 modelforge-qwen3-archive",
          fetchedAt: "2026-10-31 14:06",
        },
        references: 0,
        compatibilityText: "文件可用；尚未加载模型或执行训练兼容基线",
      },
    ],
  },
];

const fileCatalog = [
  ["config.json", 726, "660db3b73d788119c04535e48cf9be5f55bc3100841a718637ae695b442f27dd", "config"],
  ["generation_config.json", 242, "51a26d2ed7fbee966d8a12d7fc8ec39173e56108504522784a73f92d0e0f24d0", "config"],
  ["model.safetensors", 1503300328, "f47f71177f32bcd101b7573ec9171e6a57f4f4d31148d38e382306f42996874b", "weights"],
  ["tokenizer.json", 11422654, "a8c7a09c1f39bab43e81f7cb5cdc221af97100f9b31e4383787976ea79c0c020", "tokenizer"],
  ["tokenizer_config.json", 10201, "4fe5f772e3cfc51fbfcefb02bc84b15292ac4ce30d83c2ebbf2bc31997b834f4", "tokenizer"],
  ["vocab.json", 2776833, "ca8b596a8db3b923e1d8a98d15e8f93f81bba05af55b7d4d304595b49e7e7a4e", "tokenizer"],
  ["merges.txt", 1671839, "41e4da0e7b8be6e7f6d39e2a9f3aa1ad397451baa343af29603ff6fed8e95f90", "tokenizer"],
  ["special_tokens_map.json", 771, "3b9d5f6ba095fa0a7ffdb8a82cf4197348c028018b7a0d060ad3d5559349d987", "tokenizer"],
  ["added_tokens.json", 707, "e18e0ab32f4b90f9f7f02f99f46b5880fe01df45c00a7fea1c48c5ba7ae6e1ac", "tokenizer"],
  ["chat_template.jinja", 4113, "12a1fbe1d93b72544bc93f80a5077a9cbe5a8f391327bdfd7ef0bbf46c9f4f28", "config"],
  ["README.md", 4724, "5a4ab3b831355788ef74ad2cc256aaf09d5c2f6d0e9d1aab90264ff78fb99c41", "other"],
];

const state = {
  variant: "c",
  theme: "light",
  density: "comfortable",
  selectedFamily: "MDL-7A2F",
  selectedVersion: "51f7b869-9894-424b-bc5d-dba013723ddb",
  search: "",
  filter: "all",
  detailTab: "overview",
  source: "modelscope",
  drawer: false,
  toast: "",
  focusRequest: null,
};

const sourceLabels = {
  modelscope: "ModelScope",
  directory: "目录上传",
  ucloud_public: "优云外部只读",
};

const stateLabels = {
  available: "文件已校验",
  uploading: "传输中",
  awaiting_verification: "待实例核对",
  delete_failed: "清理失败",
  upload_failed: "上传失败",
  failed: "导入失败",
  mismatch: "内容不一致",
  verified: "兼容已验证",
  unverified: "兼容未验证",
  running: "后台导入中",
  succeeded: "导入完成",
  external_observed: "外部文件已观察",
};

const adapterArchiveFiles = Object.freeze([
  "manifest.json",
  "adapter_config.json",
  "adapter_model.safetensors",
]);

const adapterArtifacts = {
  best: {
    id: "a515ea2c-74f9-5982-b5aa-5c4985eb3604",
    fingerprint: "a17222afbb6dcd3987bbc541379422bf42c0fa2c27e1448b6327ccbda21ae80c",
    sourceAttemptId: "fbbe9980-1b83-44b9-9880-422efb4a1f4d",
    dataset: {
      name: "live-gpu-sft-20261101-r1",
      version: 1,
      id: "dc344d8b-41ca-459a-9eb6-3c276eeb93a2",
    },
    heading: "验证 Loss 0.2148",
  },
  final: {
    id: "ff6b1e74-67bb-543c-b03f-b9e151e40cf1",
    fingerprint: "1e811e2128d4671c291899e4b65e718893e63410fbb4ddfb1318a81a29563bf0",
    sourceAttemptId: "fbbe9980-1b83-44b9-9880-422efb4a1f4d",
    dataset: {
      name: "live-gpu-sft-20261101-r1",
      version: 1,
      id: "dc344d8b-41ca-459a-9eb6-3c276eeb93a2",
    },
    heading: "22 steps 完成",
  },
};

const familyErrorStates = ["delete_failed", "upload_failed", "failed", "mismatch"];
const familyTransferStates = ["uploading", "running"];
const familyVerificationStates = ["awaiting_verification"];

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatBytes(bytes) {
  if (bytes === null || bytes === undefined) return "—";
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GiB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${bytes} B`;
}

function sourceIcon(source) {
  if (source === "modelscope") return "MS";
  if (source === "ucloud_public") return "U";
  return "DIR";
}

function tone(value) {
  if (["available", "verified", "succeeded"].includes(value)) return "ok";
  if (["delete_failed", "upload_failed", "failed", "mismatch"].includes(value)) return "bad";
  if (["uploading", "awaiting_verification", "running", "unverified"].includes(value)) return "warn";
  return "neutral";
}

function badge(value, customLabel) {
  return `<span class="badge ${tone(value)}"><i aria-hidden="true"></i>${escapeHtml(customLabel || stateLabels[value] || value)}</span>`;
}

function icon(name) {
  const paths = {
    dashboard: '<rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect>',
    datasets: '<ellipse cx="12" cy="5" rx="8" ry="3"></ellipse><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5"></path><path d="M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"></path>',
    models: '<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z"></path><path d="m4 7.5 8 4.5 8-4.5M12 12v9"></path>',
    compute: '<rect x="3" y="4" width="18" height="14" rx="1"></rect><path d="M8 21h8M12 18v3M7 8h10M7 12h6"></path>',
    train: '<path d="m4 17 6-6-6-6"></path><path d="m12 19 8-8-8-8"></path>',
    inference: '<path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z"></path>',
    plus: '<path d="M12 5v14M5 12h14"></path>',
    refresh: '<path d="M20 6v5h-5"></path><path d="M4 18v-5h5"></path><path d="M18.5 9A7 7 0 0 0 6.6 5.4L4 8M5.5 15A7 7 0 0 0 17.4 18.6L20 16"></path>',
    search: '<circle cx="11" cy="11" r="7"></circle><path d="m20 20-4-4"></path>',
    chevron: '<path d="m9 18 6-6-6-6"></path>',
    ledger: '<path d="M6 3h12a2 2 0 0 1 2 2v16H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"></path><path d="M8 7h8M8 11h8M8 15h5"></path>',
    close: '<path d="m6 6 12 12M18 6 6 18"></path>',
    upload: '<path d="M12 16V4M7 9l5-5 5 5"></path><path d="M4 16v4h16v-4"></path>',
    download: '<path d="M12 4v11M7 10l5 5 5-5"></path><path d="M4 19h16"></path>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2"></rect><path d="M16 8V4H4v12h4"></path>',
    external: '<path d="M14 4h6v6M20 4l-9 9"></path><path d="M18 13v6H5V6h6"></path>',
    warning: '<path d="M12 3 2.8 20h18.4L12 3Z"></path><path d="M12 9v5M12 17h.01"></path>',
    check: '<path d="m4 12 5 5L20 6"></path>',
    lock: '<rect x="5" y="10" width="14" height="11" rx="2"></rect><path d="M8 10V7a4 4 0 0 1 8 0v3"></path>',
    arrow: '<path d="M5 12h14M14 7l5 5-5 5"></path>',
  };
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name] || ""}</svg>`;
}

function selectedFamily() {
  return families.find((item) => item.id === state.selectedFamily) || families[0];
}

function selectedVersion() {
  const family = selectedFamily();
  return family.versions.find((item) => item.id === state.selectedVersion) || family.versions[0];
}

function selectFamily(id) {
  const family = families.find((item) => item.id === id);
  if (!family) return;
  state.selectedFamily = family.id;
  state.selectedVersion = family.versions[0].id;
  state.detailTab = "overview";
}

function allVersions() {
  return families.flatMap((family) => family.versions.map((version) => ({ family, version })));
}

function stats() {
  const versions = allVersions();
  return {
    families: families.length,
    versions: versions.length,
    available: versions.filter(({ version }) => version.state === "available").length,
    verified: versions.filter(({ version }) => version.compatibility === "verified").length,
    importing: versions.filter(({ version }) => version.state === "uploading").length,
    errors: versions.filter(({ version }) => ["delete_failed", "upload_failed", "failed", "mismatch"].includes(version.state)).length,
    pendingVerify: versions.filter(({ version }) => version.state === "awaiting_verification").length,
    adapters: 2,
  };
}

function filteredFamilies() {
  const query = state.search.trim().toLowerCase();
  return families.filter((family) => {
    const matchesQuery = !query || [family.name, family.id, family.repository, ...family.versions.map((version) => version.shortId)]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(query));
    const matchesFilter = state.filter === "all"
      || (state.filter === "errors" && family.versions.some((version) => ["delete_failed", "upload_failed", "failed", "mismatch"].includes(version.state)))
      || (state.filter === "pending" && family.versions.some((version) => ["uploading", "awaiting_verification"].includes(version.state)))
      || (state.filter === "verified" && family.versions.some((version) => version.compatibility === "verified"))
      || family.source === state.filter;
    return matchesQuery && matchesFilter;
  });
}

function familyStatusSummary(family) {
  const versions = family.versions || [];
  const error = versions.find((version) => familyErrorStates.includes(version.state));
  const transferring = versions.filter((version) => familyTransferStates.includes(version.state)).length;
  const verifying = versions.filter((version) => familyVerificationStates.includes(version.state)).length;
  const available = versions.filter((version) => version.state === "available").length;
  const parts = [];

  if (error) parts.push("1 异常");
  if (available) parts.push(`${available} 可用`);
  if (transferring) parts.push(`${transferring} 传输中`);
  if (verifying) parts.push(`${verifying} 待核对`);

  if (!parts.length && versions.length) {
    parts.push(`${versions.length} 个版本待处理`);
  }

  return {
    state: error?.state || (transferring ? "uploading" : verifying ? "awaiting_verification" : available ? "available" : "neutral"),
    label: parts.join(" · ") || "暂无版本",
    available,
    transferring,
    verifying,
    errors: error ? 1 : 0,
  };
}

function navItem(name, label, iconName) {
  return `<a class="nav-item ${name === "models" ? "active" : ""}" href="#${name}" data-action="nav" aria-current="${name === "models" ? "page" : "false"}">
    ${icon(iconName)}<span>${label}</span>${name === "models" ? "<small>4</small>" : ""}
  </a>`;
}

function shell(content) {
  return `<div class="app-shell">
    <aside class="sidebar" aria-label="主导航">
      <a class="brand" href="#models" data-action="nav">
        <span class="brand-mark">M</span>
        <span><strong>ModelForge</strong><small>模型微调工作台</small></span>
      </a>
      <nav>
        ${navItem("dashboard", "工作台", "dashboard")}
        ${navItem("datasets", "数据集", "datasets")}
        ${navItem("models", "模型", "models")}
        ${navItem("compute", "计算环境", "compute")}
        ${navItem("training", "训练", "train")}
        ${navItem("inference", "推理试用", "inference")}
      </nav>
      <div class="sidebar-foot">
        <span><i></i>本地控制面</span>
        <small>PostgreSQL · MinIO 已连接</small>
      </div>
    </aside>
    <div class="workspace">
      <header class="topbar">
        <div class="breadcrumbs"><span>个人工作空间</span><b>/</b><strong>模型</strong></div>
        <div class="topbar-meta">
          <span class="system-state"><i></i>对象存储已连接</span>
          <span>本机访问</span>
        </div>
      </header>
      <main id="workspace" tabindex="-1">${content}</main>
    </div>
  </div>`;
}

function pageHeading(title, description, variantTag) {
  return `<div class="page-heading">
    <div>
      <p class="eyebrow">${variantTag}</p>
      <h1>${title}</h1>
      <p>${description}</p>
    </div>
    <div class="heading-actions">
      <button class="button secondary" type="button" data-action="refresh">${icon("refresh")}<span>刷新状态</span></button>
      <button class="button primary" type="button" data-action="open-drawer">${icon("plus")}<span>添加模型</span></button>
    </div>
  </div>`;
}

function metricStrip(variant = "a") {
  const value = stats();
  const items = [
    ["模型家族", value.families, "以不可变 model_id 分组"],
    ["模型版本", value.versions, `${value.available} 个版本可用`],
    ["兼容已验证", value.verified, "可进入训练基线检查"],
    [variant === "c" ? "待处理" : "导入任务", value.importing + value.pendingVerify, `${value.importing} 传输中 · ${value.pendingVerify} 待核对`],
    ["异常", value.errors, value.errors ? "需要人工处理" : "当前无异常"],
  ];
  return `<section class="metric-strip" aria-label="模型整体统计">
    ${items.map(([label, number, note], index) => `<article class="${index === items.length - 1 && Number(number) > 0 ? "has-alert" : ""}">
      <span>${label}</span>
      <strong>${number}</strong>
      <small>${note}</small>
    </article>`).join("")}
    <article class="health-note">
      <span class="health-icon">${icon("check")}</span>
      <div><strong>状态分层正常</strong><small>文件、兼容、实例核对独立记录</small></div>
    </article>
  </section>`;
}

function modelRow(family) {
  const selected = family.id === state.selectedFamily;
  const versions = family.versions;
  const version = selected
    ? selectedVersion()
    : versions.reduce((latest, current) => current.version > latest.version ? current : latest, versions[0]);
  const summary = familyStatusSummary(family);
  const error = versions.find((item) => familyErrorStates.includes(item.state));
  return `<article class="model-table-row ${selected ? "selected" : ""}">
    <button class="model-identity" type="button" data-action="select-family" data-id="${family.id}" aria-pressed="${selected}">
      <span class="source-mark source-${family.source}">${sourceIcon(family.source)}</span>
      <span class="model-copy">
        <strong title="${escapeHtml(family.name)}">${escapeHtml(family.name)}</strong>
        <small><code>${family.id}</code> · ${sourceLabels[family.source]}</small>
      </span>
    </button>
    <div class="version-cell">
      <div class="version-chips">
        ${versions.map((item) => `<button type="button" class="version-chip ${item.id === state.selectedVersion ? "active" : ""} ${tone(item.state)}" data-action="select-version" data-family="${family.id}" data-id="${item.id}" title="${stateLabels[item.state]}" aria-pressed="${item.id === state.selectedVersion}">
          v${item.version}<i aria-hidden="true"></i>
        </button>`).join("")}
      </div>
      <small>${versions.length} 个不可变版本</small>
    </div>
    <div class="file-cell">
      ${badge(summary.state, summary.label)}
      <small>${version.files} 文件 · ${formatBytes(version.bytes)}</small>
    </div>
    <div class="compat-cell">
      ${badge(version.compatibility)}
      <small>${version.compatibility === "verified" ? "训练基线已绑定" : "不能据此开始训练"}</small>
    </div>
    <div class="updated-cell">
      <strong>${family.updatedAt.slice(5)}</strong>
      ${error ? `<small class="danger-text">${error.error ? "对象清理待重试" : "需要处理"}</small>` : `<small>${sourceLabels[family.source]}</small>`}
    </div>
    <button class="row-open" type="button" data-action="select-family" data-id="${family.id}" aria-label="查看 ${family.name}">
      ${icon("chevron")}
    </button>
  </article>`;
}

function registryTable() {
  const rows = filteredFamilies();
  return `<section class="registry-panel">
    <div class="panel-toolbar">
      <div>
        <h2>模型资产</h2>
        <p>按模型家族归档，同名记录仍用不可变 ID 区分。</p>
      </div>
      <div class="table-tools">
        <label class="search-control">
          ${icon("search")}
          <span class="sr-only">搜索模型</span>
          <input id="model-search" type="search" placeholder="搜索名称、ID、仓库…" value="${escapeHtml(state.search)}">
        </label>
        <label class="filter-control">
          <span class="sr-only">筛选模型</span>
          <select id="model-filter">
            <option value="all" ${state.filter === "all" ? "selected" : ""}>全部来源</option>
            <option value="modelscope" ${state.filter === "modelscope" ? "selected" : ""}>ModelScope</option>
            <option value="directory" ${state.filter === "directory" ? "selected" : ""}>目录上传</option>
            <option value="ucloud_public" ${state.filter === "ucloud_public" ? "selected" : ""}>优云外部只读</option>
            <option value="pending" ${state.filter === "pending" ? "selected" : ""}>待处理</option>
            <option value="errors" ${state.filter === "errors" ? "selected" : ""}>仅看异常</option>
            <option value="verified" ${state.filter === "verified" ? "selected" : ""}>兼容已验证</option>
          </select>
        </label>
      </div>
    </div>
    <div class="model-table">
      <div class="model-table-head" aria-hidden="true">
        <span>模型 / ID</span><span>版本</span><span>文件</span><span>运行兼容</span><span>最近更新</span><span></span>
      </div>
      ${rows.length ? rows.map(modelRow).join("") : `<div class="empty-result">${icon("search")}<strong>没有匹配的模型</strong><p>调整搜索词或来源筛选后重试。</p></div>`}
    </div>
    <footer class="panel-footer">
      <span>${rows.length} / ${families.length} 个模型家族</span>
      <button class="text-button" type="button" data-action="clear-filter">清除筛选</button>
    </footer>
  </section>`;
}

function fileRows(version) {
  if (version.sourceSnapshot.title.includes("优云") && !version.manifest) {
    return `<div class="empty-evidence compact">
      ${icon("external")}
      <div><strong>尚未在实例上固化文件清单</strong><p>目录快照只说明查询时路径存在；绑定实际实例并完成读取后，才能核对 config、tokenizer 与权重指纹。</p></div>
    </div>`;
  }
  return `<div class="file-list">
    ${fileCatalog.slice(0, Math.min(version.files, fileCatalog.length)).map(([path, size, hash, group], index) => {
      const uploaded = version.state === "uploading" ? index < version.files : true;
      return `<details class="file-row ${uploaded ? "is-verified" : "is-pending"}" ${index === 0 ? "open" : ""}>
        <summary>
          <span class="file-kind">${group === "weights" ? "W" : group === "tokenizer" ? "T" : group === "config" ? "C" : "·"}</span>
          <span class="file-name"><strong>${path}</strong><small>${group} · ${formatBytes(size)}</small></span>
          ${badge(uploaded ? "available" : "uploading", uploaded ? "回读校验通过" : "等待上传")}
          ${icon("chevron")}
        </summary>
        <div class="file-hash"><span>SHA-256</span><code>${hash}</code><button type="button" class="icon-button small" data-action="copy" data-copy="${hash}" aria-label="复制 SHA-256">${icon("copy")}</button></div>
      </details>`;
    }).join("")}
    ${version.files > fileCatalog.length ? `<p class="more-files">另有 ${version.files - fileCatalog.length} 个文件，正式实现按页读取 manifest。</p>` : ""}
  </div>`;
}

function sourceSnapshot(version) {
  return `<section class="evidence-block source-snapshot">
    <div class="block-heading"><span>来源快照</span>${badge(version.importState || version.externalCheck || "verified", version.importState ? stateLabels[version.importState] : version.externalCheck ? stateLabels[version.externalCheck] : "快照已固定")}</div>
    <dl>
      <dt>${version.sourceSnapshot.title}</dt>
      <dd><strong>${escapeHtml(version.sourceSnapshot.primary)}</strong><code>${escapeHtml(version.sourceSnapshot.secondary)}</code></dd>
      <dt>查询时间</dt><dd>${version.sourceSnapshot.fetchedAt}</dd>
      <dt>清单摘要</dt><dd><code>${version.manifest || "尚未固化"}</code></dd>
    </dl>
  </section>`;
}

function importBlock(version) {
  if (version.importState !== "running" && version.importState !== "failed") return "";
  return `<section class="import-progress-block">
    <div class="block-heading">
      <div><span>后台导入</span><strong>${stateLabels[version.importState]}</strong></div>
      ${version.importState === "running" ? `<button class="text-button danger-text" type="button" data-action="demo-action" data-message="已请求取消；Worker 确认停止前，状态不会改写。">请求取消</button>` : `<button class="text-button" type="button" data-action="demo-action" data-message="将按固定 commit 重试，不跟随分支移动。">按固定快照重试</button>`}
    </div>
    <div class="progress-track"><i style="width:${version.progress || 0}%"></i></div>
    <p><code>${escapeHtml(version.currentPath || "等待 Worker 领取任务")}</code><span>${formatBytes(version.bytes)} / ${formatBytes(version.totalBytes || version.bytes)}</span></p>
    <small>已复用 8 个已验证文件；传输中断后可继续完成版本，不修改已固定 manifest。</small>
  </section>`;
}

function errorBlock(version) {
  if (!version.error) return "";
  return `<section class="error-block">
    ${icon("warning")}
    <div><strong>对象存储清理未完成</strong><p>${version.error}</p></div>
    <button type="button" class="button secondary compact-button" data-action="demo-action" data-message="已开始重新核对 MinIO 对象；在对象确认消失前不会移除版本元数据。">重试清理</button>
  </section>`;
}

function detailTabList(prefix, className, label, tabs) {
  return `<div class="${className}" role="tablist" aria-label="${label}" aria-orientation="horizontal">
    ${tabs.map(([key, text]) => `<button id="${prefix}-tab-${key}" type="button" role="tab" aria-selected="${state.detailTab === key}" aria-controls="${prefix}-panel-${key}" tabindex="${state.detailTab === key ? "0" : "-1"}" data-action="detail-tab" data-tab="${key}">${text}</button>`).join("")}
  </div>`;
}

function detailPanel(prefix, className, panels) {
  return Object.entries(panels).map(([key, content]) => {
    const selected = state.detailTab === key;
    return `<div id="${prefix}-panel-${key}" class="${className}" role="tabpanel" aria-labelledby="${prefix}-tab-${key}" tabindex="${selected ? "0" : "-1"}"${selected ? "" : " hidden"}>${content}</div>`;
  }).join("");
}

function versionPrimaryAction(version, extraClass = "") {
  if (version.state === "uploading") {
    return `<button class="button primary ${extraClass}" type="button" data-action="demo-action" data-message="将复用已经回读验证的文件，只重传未完成对象。">继续上传</button>`;
  }
  if (version.state === "awaiting_verification") {
    return `<button class="button primary ${extraClass}" type="button" data-action="demo-action" data-message="绑定实际实例后核对固定来源与文件内容指纹。">在实例上核对</button>`;
  }
  return `<button class="button primary ${extraClass}" type="button" data-action="demo-action" data-message="正式页面会在训练提交前再次检查模型、Adapter、硬件和镜像。">进入训练配置</button>`;
}

function inspectorTabs(version) {
  return detailTabList("inspector", "inspector-tabs", "模型版本详情", [
    ["overview", "验证概览"],
    ["files", `文件清单 ${version.files}`],
    ["lineage", version.compatibility === "verified" ? "训练产物 2" : "引用与血缘"],
  ]);
}

function inspectorOverview(family, version) {
  return `<div class="inspector-body">
    ${sourceSnapshot(version)}
    ${importBlock(version)}
    ${errorBlock(version)}
    <section class="validation-summary">
      <div class="block-heading"><span>训练准入</span>${badge(version.compatibility)}</div>
      <div class="check-grid">
        <article><span>文件回读</span><strong>${version.state === "uploading" ? `${version.files}/${version.totalFiles} 文件` : `${version.files}/${version.files} 文件`}</strong><small>${version.state === "uploading" ? "传输仍在进行" : "大小与 SHA-256 已核对"}</small></article>
        <article><span>内容指纹</span><strong>${version.manifest ? "已固化" : "待固化"}</strong><small>${version.manifest ? version.manifest.slice(0, 12) + "…" : "不能只凭目录路径判断"}</small></article>
        <article><span>运行兼容</span><strong>${version.compatibility === "verified" ? "已验证" : "未验证"}</strong><small>${version.compatibilityText}</small></article>
        <article><span>引用保护</span><strong>${version.references}</strong><small>${version.references ? "版本被训练记录引用" : "当前无引用"}</small></article>
      </div>
    </section>
    <section class="identity-block">
      <div class="block-heading"><span>不可变身份</span><button class="icon-button small" type="button" data-action="copy" data-copy="${version.id}" aria-label="复制版本 ID">${icon("copy")}</button></div>
      <dl>
        <dt>model_id</dt><dd><code>${family.id}</code></dd>
        <dt>version</dt><dd>v${version.version} · <code>${version.id}</code></dd>
        <dt>文件大小</dt><dd>${formatBytes(version.bytes)}</dd>
        <dt>创建时间</dt><dd>${version.createdAt}</dd>
      </dl>
    </section>
  </div>`;
}

function fingerprintValue(label, value) {
  return `<span class="fingerprint-value"><code>${escapeHtml(value)}</code><button type="button" class="icon-button small" data-action="copy" data-copy="${escapeHtml(value)}" aria-label="复制${label}">${icon("copy")}</button></span>`;
}

function artifactCard(role, artifact, family, version) {
  const roleLabel = role.toUpperCase();
  const actionLabel = role === "best" ? "BEST" : "FINAL";
  return `<article class="artifact-card ${role}">
    <header><span>${roleLabel}</span>${badge("available", "已同步可用")}</header>
    <h3>${artifact.heading}</h3>
    <dl>
      <dt>Adapter 版本</dt><dd><code>${artifact.id}</code></dd>
      <dt>Adapter 指纹</dt><dd>${fingerprintValue("Adapter 指纹", artifact.fingerprint)}</dd>
      <dt>来源 Attempt</dt><dd><code>${artifact.sourceAttemptId}</code></dd>
      <dt>数据集</dt><dd>${escapeHtml(artifact.dataset.name)} · v${artifact.dataset.version}<code>${artifact.dataset.id}</code></dd>
      <dt>基座模型</dt><dd>${escapeHtml(family.name)} · v${version.version}<code>${version.id}</code></dd>
      <dt>基座指纹</dt><dd>${fingerprintValue("基座指纹", version.manifest || "尚未固化")}</dd>
    </dl>
    <div class="artifact-archive" aria-label="Adapter 包文件">
      <span>Adapter 包固定包含</span>
      <ul>${adapterArchiveFiles.map((file) => `<li><code>${file}</code></li>`).join("")}</ul>
    </div>
    <div class="artifact-actions">
      <button type="button" class="button primary compact-button" aria-label="下载 ${actionLabel} Adapter 包" data-action="demo-action" data-message="原型演示：正式页面会再次核对清单和摘要后，从受支持接口下载 ${actionLabel} Adapter 包。">${icon("download")}<span>下载 ${actionLabel} Adapter 包</span></button>
      <button type="button" class="button secondary compact-button" aria-label="校验 ${actionLabel} Adapter 与基座配对" data-action="pair-check" data-role="${roleLabel}">校验基座与 Adapter 配对</button>
      <button type="button" class="button secondary compact-button" aria-label="使用 ${actionLabel} Adapter 进行推理试用" data-action="demo-action" data-message="原型不创建推理 Trial；正式页面会先核对基座与 ${actionLabel} Adapter 指纹。">用于推理试用</button>
    </div>
    <p class="artifact-contract">LoRA Adapter 不能独立启动。部署时必须加载基座模型 <strong>${escapeHtml(family.name)}</strong>，并核对指纹 <code>${version.manifest || "尚未固化"}</code>。</p>
  </article>`;
}

function adapterCards(family, version) {
  return `<div class="artifact-section">
    <div class="artifact-intro">
      <span>训练产物</span>
      <strong>基座 → Attempt → Adapter</strong>
      <p>产物独立同步到 MinIO，并绑定同一个基座与数据集。Adapter 是增量权重，不能独立启动；下载包固定包含 ${adapterArchiveFiles.map((file) => `<code>${file}</code>`).join("、")}。</p>
    </div>
    ${artifactCard("best", adapterArtifacts.best, family, version)}
    ${artifactCard("final", adapterArtifacts.final, family, version)}
  </div>`;
}

function inspector(family = selectedFamily(), version = selectedVersion()) {
  const overviewBody = `
    ${sourceSnapshot(version)}${importBlock(version)}${errorBlock(version)}
    <section class="validation-summary">
      <div class="block-heading"><span>训练准入</span>${badge(version.compatibility)}</div>
      <div class="check-grid">
        <article><span>文件回读</span><strong>${version.state === "uploading" ? `${version.files}/${version.totalFiles} 文件` : `${version.files}/${version.files} 文件`}</strong><small>${version.state === "uploading" ? "传输仍在进行" : "大小与 SHA-256 已核对"}</small></article>
        <article><span>内容指纹</span><strong>${version.manifest ? "已固化" : "待固化"}</strong><small>${version.manifest ? version.manifest.slice(0, 12) + "…" : "不能只凭目录路径判断"}</small></article>
        <article><span>运行兼容</span><strong>${version.compatibility === "verified" ? "已验证" : "未验证"}</strong><small>${version.compatibilityText}</small></article>
        <article><span>引用保护</span><strong>${version.references}</strong><small>${version.references ? "版本被训练记录引用" : "当前无引用"}</small></article>
      </div>
    </section>
    <section class="identity-block">
      <div class="block-heading"><span>不可变身份</span><button class="icon-button small" type="button" data-action="copy" data-copy="${version.id}" aria-label="复制版本 ID">${icon("copy")}</button></div>
      <dl>
        <dt>model_id</dt><dd><code>${family.id}</code></dd>
        <dt>version</dt><dd>v${version.version} · <code>${version.id}</code></dd>
        <dt>文件大小</dt><dd>${formatBytes(version.bytes)}</dd>
        <dt>创建时间</dt><dd>${version.createdAt}</dd>
      </dl>
    </section>`;
  const filesBody = `${sourceSnapshot(version)}${fileRows(version)}`;
  const lineageBody = family.source === "modelscope" && version.compatibility === "verified" ? adapterCards(family, version) : `<section class="lineage-block">
        <div class="block-heading"><span>版本血缘与引用</span>${badge(version.references ? "available" : "unverified", version.references ? `${version.references} 个引用` : "暂无引用")}</div>
        <div class="lineage-path">
          <span>${sourceLabels[family.source]}</span>${icon("arrow")}<span>v${version.version}</span>${icon("arrow")}<span>${version.compatibility === "verified" ? "训练兼容基线" : "尚未进入训练"}</span>
        </div>
        <p class="plain-note">${version.references ? "此版本已被训练任务引用，删除会被服务端拒绝。" : "当前版本没有训练引用；仍需单独确认运行兼容性。"}</p>
      </section>`;
  return `<aside class="inspector" aria-label="当前模型版本检查器">
    <header class="inspector-head">
      <div>
        <span>当前模型版本</span>
        <h2>${escapeHtml(family.name)}</h2>
        <p>v${version.version} · <code>${version.shortId}</code> · ${sourceLabels[family.source]}</p>
      </div>
      <button type="button" class="icon-button" data-action="demo-action" data-message="版本 ID 已复制。" aria-label="复制版本信息">${icon("copy")}</button>
    </header>
    <div class="inspector-alert ${tone(version.state)}">
      <span>${icon(["delete_failed", "failed", "mismatch"].includes(version.state) ? "warning" : version.compatibility === "verified" ? "check" : "external")}</span>
      <div><strong>${stateLabels[version.state]}</strong><small>${version.compatibilityText}</small></div>
    </div>
    ${inspectorTabs(version)}
    ${detailPanel("inspector", "inspector-body", {
      overview: overviewBody,
      files: filesBody,
      lineage: lineageBody,
    })}
    <footer class="inspector-actions">
      ${version.state === "uploading"
        ? `<button type="button" class="button primary" data-action="demo-action" data-message="恢复会复用已经回读验证的文件，仅重传未完成对象。">继续上传</button>`
        : version.state === "awaiting_verification"
          ? `<button type="button" class="button primary" data-action="demo-action" data-message="绑定实际实例后，将核对 config、tokenizer 和权重内容指纹。">在实例上核对</button>`
          : `<button type="button" class="button primary" data-action="demo-action" data-message="文件与兼容性均为单向状态；正式系统会再次执行训练前置检查。">进入训练配置</button>`}
      <button type="button" class="button secondary" data-action="refresh">${icon("refresh")}刷新版本</button>
      <button type="button" class="text-button danger-text inspect-delete" data-action="demo-action" data-message="${version.references ? "该版本被训练记录引用，删除已由服务端拒绝。" : version.error ? "请先完成对象清理重试，再删除版本。" : "原型不执行破坏性删除。"}">删除版本</button>
    </footer>
  </aside>`;
}

function variantA() {
  return `${pageHeading("模型资产台", "快速定位模型家族、核对不可变版本，并判断文件与运行兼容状态。", "A · REGISTRY WORKBENCH")}
    ${metricStrip("a")}
    <div class="registry-layout">
      ${registryTable()}
      ${inspector()}
    </div>
    <section class="recent-job-bar">
      <div><span class="job-icon">${icon("upload")}</span><div><strong>后台导入作业</strong><small>Qwen3-0.6B · v2 · 63% · model-00002-of-00002.safetensors</small></div></div>
      <div class="mini-progress"><i style="width:63%"></i></div>
      <button type="button" class="text-button" data-action="select-family" data-id="MDL-7A2F">查看任务</button>
    </section>`;
}

function evidenceNode(label, stateText, status) {
  return `<div class="evidence-node ${status}"><i>${status === "ok" ? icon("check") : status === "bad" ? icon("warning") : icon("external")}</i><span>${label}</span><strong>${stateText}</strong></div>`;
}

function ledgerRow(family) {
  const selected = family.id === state.selectedFamily;
  const version = family.versions.find((item) => item.id === state.selectedVersion) || family.versions[0];
  const waiting = ["uploading", "awaiting_verification"].includes(version.state);
  const error = ["delete_failed", "failed", "mismatch"].includes(version.state);
  return `<article class="ledger-entry ${selected ? "selected" : ""}">
    <header>
      <button type="button" class="ledger-identity" data-action="select-family" data-id="${family.id}">
        <span>${sourceIcon(family.source)}</span>
        <div><h2>${escapeHtml(family.name)}</h2><p><code>${family.id}</code> · ${sourceLabels[family.source]}</p></div>
      </button>
      <div class="ledger-version-picker">
        ${family.versions.map((item) => `<button class="${item.id === version.id ? "active" : ""}" type="button" data-action="select-version" data-family="${family.id}" data-id="${item.id}" aria-pressed="${item.id === version.id}">v${item.version}</button>`).join("")}
      </div>
      <div class="fingerprint-seal">
        <span>CONTENT SEAL</span>
        <code>${version.manifest ? version.manifest.slice(0, 15) : "NOT PINNED"}</code>
        <small>${version.manifest ? "manifest sha256" : "待实际实例核对"}</small>
      </div>
    </header>
    <div class="ledger-chain">
      ${evidenceNode("来源", family.source === "ucloud_public" ? "公共目录" : family.source === "modelscope" ? "commit 已固定" : "完整目录", "ok")}
      <span class="chain-line"></span>
      ${evidenceNode("文件", version.state === "uploading" ? `${version.files}/${version.totalFiles}` : version.state === "delete_failed" ? "清理异常" : `${version.files} 项`, error ? "bad" : "ok")}
      <span class="chain-line"></span>
      ${evidenceNode("指纹", version.manifest ? "已固化" : "待固化", version.manifest ? "ok" : waiting ? "wait" : "bad")}
      <span class="chain-line"></span>
      ${evidenceNode("实例", version.state === "awaiting_verification" ? "待核对" : family.source === "ucloud_public" ? "已观察" : "托管已验证", version.state === "awaiting_verification" ? "wait" : "ok")}
      <span class="chain-line"></span>
      ${evidenceNode("训练准入", version.compatibility === "verified" ? "已绑定" : "未验证", version.compatibility === "verified" ? "ok" : "wait")}
    </div>
    ${selected ? `<div class="ledger-detail">
      <div class="ledger-detail-main">
        <div class="detail-kicker">当前证据</div>
        <h3>${version.shortId} · v${version.version}</h3>
        <p>${version.compatibilityText}</p>
        <div class="ledger-facts">
          <span><small>文件总量</small><strong>${formatBytes(version.bytes)}</strong></span>
          <span><small>版本引用</small><strong>${version.references}</strong></span>
          <span><small>创建时间</small><strong>${version.createdAt}</strong></span>
        </div>
      </div>
      <div class="ledger-detail-source">
        <span>${version.sourceSnapshot.title}</span>
        <strong>${escapeHtml(version.sourceSnapshot.primary)}</strong>
        <code>${escapeHtml(version.sourceSnapshot.secondary)}</code>
        <button type="button" class="button secondary compact-button" data-action="detail-tab" data-tab="files">查看文件证据</button>
      </div>
      <div class="ledger-artifacts">
        ${version.compatibility === "verified" ? `<span>2 个可用 Adapter</span><strong>Best · Final</strong><small>验证 Loss 0.2148 · 退出码 0</small>` : `<span>训练产物</span><strong>尚无</strong><small>通过兼容基线后才可进入训练</small>`}
      </div>
    </div>` : ""}
  </article>`;
}

function variantB() {
  return `${pageHeading("来源血缘账本", "沿来源、文件指纹、实例核对和训练准入展开每个不可变版本。", "B · PROVENANCE LEDGER")}
    <section class="ledger-summary">
      <div><span>证据覆盖</span><strong>3 / 5</strong><small>版本具备可追溯来源快照</small></div>
      <div><span>固定内容指纹</span><strong>3</strong><small>commit 或 manifest SHA-256</small></div>
      <div><span>兼容基线</span><strong>1</strong><small>RTX 4090 · CUDA 13.2</small></div>
      <div class="ledger-legend"><span><i class="ok"></i>已验证</span><span><i class="wait"></i>待核对</span><span><i class="bad"></i>异常</span></div>
    </section>
    <div class="ledger-toolbar">
      <label class="search-control dark-search">${icon("search")}<span class="sr-only">搜索模型账本</span><input id="model-search" type="search" placeholder="搜索来源、模型 ID、commit…" value="${escapeHtml(state.search)}"></label>
      <label class="filter-control"><span class="sr-only">筛选账本</span><select id="model-filter">
        <option value="all" ${state.filter === "all" ? "selected" : ""}>全部账本</option>
        <option value="modelscope" ${state.filter === "modelscope" ? "selected" : ""}>ModelScope</option>
        <option value="directory" ${state.filter === "directory" ? "selected" : ""}>目录上传</option>
        <option value="ucloud_public" ${state.filter === "ucloud_public" ? "selected" : ""}>优云外部只读</option>
        <option value="errors" ${state.filter === "errors" ? "selected" : ""}>异常</option>
      </select></label>
    </div>
    <section class="ledger-list" aria-label="模型来源血缘账本">
      ${filteredFamilies().map(ledgerRow).join("") || `<div class="empty-result">${icon("ledger")}<strong>没有匹配的账本</strong><p>调整搜索词或来源筛选后重试。</p></div>`}
    </section>
    <div class="ledger-footnote">${icon("lock")}目录路径不是版本，标签不是 commit，一次性查询也不等于实际实例内容核对。</div>`;
}

function familyIndexItem(family) {
  const selected = family.id === state.selectedFamily;
  const summary = familyStatusSummary(family);
  return `<button class="family-index-item ${selected ? "selected" : ""}" type="button" data-action="select-family" data-id="${family.id}" aria-pressed="${selected}">
    <span class="source-mark source-${family.source}">${sourceIcon(family.source)}</span>
    <span class="family-index-copy">
      <strong>${escapeHtml(family.name)}</strong>
      <small><code>${family.id}</code> · ${family.versions.length} 版本</small>
    </span>
    <span class="family-index-state">${badge(summary.state, summary.label)}</span>
    <span class="family-index-date">${family.updatedAt.slice(5)}</span>
  </button>`;
}

function evidenceSpine(version) {
  const sourceOk = Boolean(version.sourceSnapshot);
  const filesOk = version.state === "available";
  const fingerprintOk = Boolean(version.manifest);
  const instanceOk = version.state !== "awaiting_verification";
  const compatOk = version.compatibility === "verified";
  return `<ol class="evidence-spine">
    <li class="${sourceOk ? "done" : ""}"><i>${sourceOk ? icon("check") : "1"}</i><span>来源固定</span><small>${version.sourceSnapshot.title}</small></li>
    <li class="${filesOk ? "done" : version.state === "uploading" ? "active" : "failed"}"><i>${filesOk ? icon("check") : version.state === "uploading" ? icon("upload") : icon("warning")}</i><span>文件完整</span><small>${version.files} 个文件</small></li>
    <li class="${fingerprintOk ? "done" : "pending"}"><i>${fingerprintOk ? icon("check") : "3"}</i><span>指纹固化</span><small>${fingerprintOk ? "manifest sha256" : "尚未固化"}</small></li>
    <li class="${instanceOk ? "done" : "active"}"><i>${instanceOk ? icon("check") : icon("external")}</i><span>实例核对</span><small>${instanceOk ? "内容一致" : "等待实际实例"}</small></li>
    <li class="${compatOk ? "done" : "pending"}"><i>${compatOk ? icon("check") : "5"}</i><span>训练准入</span><small>${compatOk ? "兼容基线" : "未验证"}</small></li>
  </ol>`;
}

function assetStack() {
  return `<div class="asset-stack-visual" aria-label="模型资产栈：来源、托管文件、兼容基线、Adapter 产物">
    <div class="stack-layer source"><span>01</span><strong>来源引用</strong><small>commit / 公共目录</small></div>
    <div class="stack-layer files"><span>02</span><strong>文件 manifest</strong><small>大小 · SHA-256</small></div>
    <div class="stack-layer compat"><span>03</span><strong>运行兼容基线</strong><small>硬件 · 镜像 · 参数</small></div>
    <div class="stack-layer adapter"><span>04</span><strong>训练产物</strong><small>Best / Final</small></div>
  </div>`;
}

function validationRail(family, version) {
  const checks = [
    ["MinIO 回读", version.state === "available" ? `${version.files}/${version.files}` : `${version.files}/${version.totalFiles || version.files}`, version.state === "available" ? "ok" : version.state === "uploading" ? "wait" : "bad"],
    ["结构入口", version.state === "available" ? "config + tokenizer + weights" : "等待完整目录", version.state === "available" ? "ok" : "wait"],
    ["内容指纹", version.manifest ? "已固化" : "未固化", version.manifest ? "ok" : "wait"],
    ["运行兼容", version.compatibility === "verified" ? "已验证" : "未验证", version.compatibility === "verified" ? "ok" : "wait"],
    ["引用保护", String(version.references), version.references ? "ok" : "neutral"],
  ];
  return `<section class="validation-rail">
    <div class="rail-heading"><span>验证与操作</span>${badge(version.compatibility)}</div>
    ${assetStack()}
    <div class="validation-checks">
      ${checks.map(([label, value, status]) => `<div><span class="check-state ${status}">${status === "ok" ? icon("check") : status === "bad" ? icon("warning") : "·"}</span><span>${label}</span><strong>${value}</strong></div>`).join("")}
    </div>
    ${version.error ? errorBlock(version) : ""}
    <div class="rail-callout ${tone(version.state)}">
      ${icon(version.compatibility === "verified" ? "check" : "external")}
      <div><strong>${version.compatibility === "verified" ? "可以进入训练配置" : stateLabels[version.state]}</strong><p>${version.compatibilityText}</p></div>
    </div>
    <div class="rail-actions">
      ${versionPrimaryAction(version)}
    </div>
  </section>`;
}

function workbenchContent(family, version) {
  const filesBody = `${sourceSnapshot(version)}${fileRows(version)}`;
  const lineageBody = family.source === "modelscope" && version.compatibility === "verified" ? adapterCards(family, version) : `<section class="lineage-block">
      <div class="block-heading"><span>版本血缘与引用</span>${badge(version.references ? "available" : "unverified", version.references ? `${version.references} 个引用` : "暂无引用")}</div>
      <div class="lineage-path"><span>${sourceLabels[family.source]}</span>${icon("arrow")}<span>v${version.version}</span>${icon("arrow")}<span>${version.compatibility === "verified" ? "训练兼容基线" : "尚未进入训练"}</span></div>
      <p class="plain-note">${version.references ? "此版本已被训练任务引用，删除会被服务端拒绝。" : "当前版本没有训练引用；仍需单独确认运行兼容性。"}</p>
    </section>`;
  const overviewBody = `
    ${importBlock(version)}
    <section class="source-overview">
      <div class="block-heading"><span>来源与版本</span>${badge(version.importState || version.externalCheck || "verified", version.importState ? stateLabels[version.importState] : version.externalCheck ? stateLabels[version.externalCheck] : "来源已固定")}</div>
      <div class="source-overview-grid">
        <div><span>来源类型</span><strong>${sourceLabels[family.source]}</strong><small>${escapeHtml(family.note)}</small></div>
        <div><span>固定标识</span><strong>${escapeHtml(version.sourceSnapshot.primary)}</strong><code>${escapeHtml(version.sourceSnapshot.secondary)}</code></div>
        <div><span>目录规模</span><strong>${version.files} 个文件</strong><small>${formatBytes(version.bytes)} · 单文件逐一校验</small></div>
        <div><span>创建时间</span><strong>${version.createdAt}</strong><small>版本创建后不可改写</small></div>
      </div>
    </section>
    <section class="file-group-preview">
      <div class="block-heading"><span>文件类别</span><button class="text-button" type="button" data-action="detail-tab" data-tab="files">查看全部 ${version.files} 项</button></div>
      <div class="category-grid">
        <article><span>C</span><div><strong>配置</strong><small>config.json · generation_config.json</small></div><b>2</b></article>
        <article><span>T</span><div><strong>Tokenizer</strong><small>tokenizer / vocab / merges</small></div><b>5</b></article>
        <article><span>W</span><div><strong>权重</strong><small>model.safetensors</small></div><b>1</b></article>
        <article><span>·</span><div><strong>其他</strong><small>模板说明与元数据</small></div><b>${Math.max(0, version.files - 8)}</b></article>
      </div>
    </section>
    <section class="fingerprint-band">
      <span>FIXED MANIFEST · SHA-256</span>
      <code>${version.manifest || "待完整回读后固化"}</code>
      ${version.manifest ? `<button class="icon-button small" type="button" data-action="copy" data-copy="${version.manifest}" aria-label="复制清单摘要">${icon("copy")}</button>` : ""}
    </section>
  `;
  return detailPanel("workbench", "workbench-content", {
    overview: overviewBody,
    files: filesBody,
    lineage: lineageBody,
  });
}

function variantC() {
  const family = selectedFamily();
  const version = selectedVersion();
  return `<div class="validation-studio-page">
    ${pageHeading("模型验证工作室", "先看当前模型与训练准入，再检查文件指纹、实例核对和训练产物。", "C · VALIDATION STUDIO")}
    ${metricStrip("c")}
    <div class="studio-layout">
      <aside class="family-index" id="model-family-index" aria-label="模型家族列表">
        <div class="index-heading"><div><h2>模型家族</h2><span>${families.length} 组 · ${stats().versions} 个版本</span></div><button type="button" class="icon-button small" data-action="open-drawer" aria-label="添加模型">${icon("plus")}</button></div>
        <label class="search-control">${icon("search")}<span class="sr-only">搜索模型家族</span><input id="model-search" type="search" placeholder="搜索名称或 ID" value="${escapeHtml(state.search)}"></label>
        <label class="filter-control full"><span class="sr-only">筛选模型</span><select id="model-filter">
          <option value="all" ${state.filter === "all" ? "selected" : ""}>全部来源与状态</option>
          <option value="modelscope" ${state.filter === "modelscope" ? "selected" : ""}>ModelScope</option>
          <option value="directory" ${state.filter === "directory" ? "selected" : ""}>目录上传</option>
          <option value="ucloud_public" ${state.filter === "ucloud_public" ? "selected" : ""}>优云外部只读</option>
          <option value="pending" ${state.filter === "pending" ? "selected" : ""}>待处理</option>
          <option value="errors" ${state.filter === "errors" ? "selected" : ""}>仅看异常</option>
          <option value="verified" ${state.filter === "verified" ? "selected" : ""}>兼容已验证</option>
        </select></label>
        <p class="mobile-scroll-hint">左右滑动查看更多模型家族</p>
        <div class="family-list">
          ${filteredFamilies().map(familyIndexItem).join("") || `<div class="empty-result compact"><strong>没有匹配项</strong><p>清除筛选后重试。</p></div>`}
        </div>
      </aside>
      <section class="evidence-workbench">
        <header class="workbench-head">
          <div>
            <span class="workbench-kicker">CURRENT EVIDENCE</span>
            <h2>${escapeHtml(family.name)} <b>· v${version.version}</b></h2>
            <p><code>${version.shortId}</code> · ${sourceLabels[family.source]} · ${formatBytes(version.bytes)}</p>
            <div class="workbench-state">${badge(version.state)}<span>${version.compatibilityText}</span></div>
          </div>
          <div class="version-picker-wrap">
            <span class="mobile-scroll-hint">左右滑动切换版本</span>
            <div class="version-picker-large" aria-label="模型版本">
              ${family.versions.map((item) => `<button type="button" class="${item.id === version.id ? "active" : ""} ${tone(item.state)}" data-action="select-version" data-family="${family.id}" data-id="${item.id}" aria-pressed="${item.id === version.id}">
                <span>v${item.version}</span><small>${stateLabels[item.state]}</small>
              </button>`).join("")}
            </div>
          </div>
          <div class="workbench-mobile-action">${versionPrimaryAction(version)}</div>
        </header>
        <div class="evidence-spine-wrap">
          <p class="mobile-scroll-hint">左右滑动查看完整证据链</p>
          ${evidenceSpine(version)}
        </div>
        ${detailTabList("workbench", "workbench-tabs", "模型证据", [
          ["overview", "证据总览"],
          ["files", `文件清单 <span>${version.files}</span>`],
          ["lineage", `引用与训练产物 <span>${version.references || "—"}</span>`],
        ])}
        ${workbenchContent(family, version)}
      </section>
      ${validationRail(family, version)}
    </div>
    <div class="studio-footnote">${icon("lock")}文件已校验只代表正式对象可读取；运行兼容必须绑定架构、内容指纹、参数、GPU、镜像和容量基线。</div>
  </div>`;
}

function focusSelector(request) {
  if (!request) return "";
  if (request.kind === "detail-tab") {
    const scope = state.variant === "c" ? ".workbench-tabs" : ".inspector-tabs";
    return `${scope} [data-action="detail-tab"][data-tab="${request.tab}"]`;
  }
  if (request.kind === "family") {
    if (state.variant === "c") return `.family-index-item[data-action="select-family"][data-id="${request.id}"]`;
    if (state.variant === "b") return `.ledger-identity[data-action="select-family"][data-id="${request.id}"]`;
    return `.model-identity[data-action="select-family"][data-id="${request.id}"]`;
  }
  if (request.kind === "version") {
    if (state.variant === "c") return `.version-picker-large [data-action="select-version"][data-id="${request.id}"]`;
    if (state.variant === "b") return `.ledger-version-picker [data-action="select-version"][data-id="${request.id}"]`;
    return `.version-chip[data-action="select-version"][data-id="${request.id}"]`;
  }
  if (request.kind === "filter") return "#model-filter";
  if (request.kind === "search") return "#model-search";
  if (request.kind === "action") return `[data-action="${request.action}"]`;
  return "";
}

function setDetailTab(tab, restoreFocus = true) {
  if (!["overview", "files", "lineage"].includes(tab)) return;
  state.detailTab = tab;
  state.focusRequest = restoreFocus ? { kind: "detail-tab", tab } : null;
  renderApp();
}

function renderApp() {
  document.body.dataset.variant = state.variant;
  document.body.dataset.theme = state.theme;
  document.body.dataset.density = state.density;
  appRoot.innerHTML = shell(state.variant === "a" ? variantA() : state.variant === "b" ? variantB() : variantC());
  document.querySelectorAll("[data-variant]").forEach((button) => {
    if (button.classList.contains("variant-tab")) {
      const selected = button.dataset.variant === state.variant;
      button.setAttribute("aria-selected", String(selected));
      button.tabIndex = selected ? 0 : -1;
    }
  });
  const themeButton = document.querySelector('[data-action="toggle-theme"]');
  if (themeButton) themeButton.setAttribute("aria-label", state.theme === "light" ? "切换到深色主题" : "切换到浅色主题");
  renderDrawer();
  renderToast();
  const request = state.focusRequest;
  state.focusRequest = null;
  const selector = focusSelector(request);
  if (selector) document.querySelector(selector)?.focus();
}

function drawerSourceCard(key, code, title, description, tag) {
  return `<button type="button" class="source-choice ${state.source === key ? "selected" : ""}" data-action="select-source" data-source="${key}" aria-pressed="${state.source === key}">
    <span class="source-choice-code">${code}</span>
    <span><strong>${title}</strong><small>${description}</small><em>${tag}</em></span>
    <i>${state.source === key ? icon("check") : ""}</i>
  </button>`;
}

function sourceForm() {
  if (state.source === "modelscope") {
    return `<form id="model-source-form">
      <div class="form-grid">
        <label>模型登记名称<input name="name" required maxlength="120" placeholder="例如 Qwen3-0.6B"></label>
        <label>ModelScope 仓库<input name="repository" required pattern="[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+" placeholder="owner/model"></label>
        <label class="span-2">分支、标签或完整 commit <input name="revision" placeholder="留空使用默认分支，并解析为固定 commit"></label>
      </div>
      <div class="form-explainer"><span>01</span><p>提交时先固定 commit，再创建 Worker 导入作业。重试保持同一快照，不会跟随分支移动。</p></div>
      <div class="form-actions"><button class="button secondary" type="button" data-action="close-drawer">取消</button><button class="button primary" type="submit">固定版本并创建导入</button></div>
    </form>`;
  }
  if (state.source === "directory") {
    return `<form id="model-source-form">
      <div class="form-grid">
        <label>模型登记名称<input name="name" required maxlength="120" placeholder="例如 客服助手基础模型"></label>
        <label class="span-2">选择完整模型目录<div class="file-drop"><input type="file" multiple webkitdirectory directory><span>${icon("upload")}<strong>选择 config、tokenizer 与权重目录</strong><small>保留相对路径，逐文件计算 SHA-256</small></span></div></label>
      </div>
      <div class="form-explainer"><span>02</span><p>先提交文件清单，再逐文件传输并回读校验。中断后只重传未完成对象。</p></div>
      <div class="form-actions"><button class="button secondary" type="button" data-action="close-drawer">取消</button><button class="button primary" type="submit">创建版本并开始上传</button></div>
    </form>`;
  }
  return `<form id="model-source-form">
    <div class="form-grid">
      <label>基座登记名称<input name="name" required maxlength="120" placeholder="例如 Qwen3-0.6B · 优云公共基座"></label>
      <label>公共模型地域<select name="region"><option>华北二 · cn-wlcb-01</option><option>北京一 · cn-bj2-03</option></select></label>
      <label class="span-2">公共目录条目<select name="path"><option>/model/ModelScope/Qwen/Qwen3-0.6B</option><option>/model/ModelScope/Qwen/Qwen2.5-1.5B-Instruct</option></select></label>
    </div>
    <div class="catalog-proof"><span>目录查询快照</span><strong>2026-11-01 16:42 · 2 个匹配项</strong><small>目录返回不代表完整目录、可挂载、可训练或内容一致。</small></div>
    <div class="form-explainer"><span>03</span><p>此流程只登记外部只读引用，不复制权重。登记完成后保持“待实例核对”。</p></div>
    <div class="form-actions"><button class="button secondary" type="button" data-action="close-drawer">取消</button><button class="button primary" type="submit">登记外部基座</button></div>
  </form>`;
}

function renderDrawer() {
  if (!state.drawer) {
    drawerRoot.innerHTML = "";
    document.body.classList.remove("drawer-open");
    return;
  }
  drawerRoot.innerHTML = `<div class="drawer-backdrop" data-action="close-drawer"></div>
    <aside class="source-drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title">
      <header class="drawer-head">
        <div><span>ADD MODEL ASSET</span><h2 id="drawer-title">添加模型</h2><p>先选择来源。三种来源的生命周期和可追溯边界不同。</p></div>
        <button type="button" class="icon-button" data-action="close-drawer" aria-label="关闭添加模型">${icon("close")}</button>
      </header>
      <div class="drawer-scroll">
        <section class="source-choices" aria-label="模型来源类型">
          ${drawerSourceCard("modelscope", "01", "下载公开模型", "固定 ModelScope commit，由 Worker 后台导入并回读校验。", "自动下载")}
          ${drawerSourceCard("directory", "02", "上传完整目录", "复制 config、tokenizer、权重到 ModelForge 正式存储。", "平台托管")}
          ${drawerSourceCard("ucloud_public", "03", "登记优云公共基座", "只保存外部只读引用，不复制公共目录权重。", "外部引用")}
        </section>
        <div class="drawer-section-label"><span>配置来源</span><small>${sourceLabels[state.source]}</small></div>
        ${sourceForm()}
        <div class="drawer-boundary">${icon("lock")}<p>提交只创建待处理版本。文件可用、实例内容一致和运行兼容是三个独立结果。</p></div>
      </div>
    </aside>`;
  document.body.classList.add("drawer-open");
  requestAnimationFrame(() => drawerRoot.querySelector(".source-drawer")?.querySelector("button, input, select")?.focus());
}

function renderToast() {
  if (!state.toast) {
    toastRoot.innerHTML = "";
    return;
  }
  toastRoot.innerHTML = `<div class="toast" role="status" aria-live="polite" aria-atomic="true">${icon("check")}<span>${escapeHtml(state.toast)}</span><button type="button" data-action="dismiss-toast" aria-label="关闭提示">${icon("close")}</button></div>`;
}

function showToast(message) {
  state.toast = message;
  renderToast();
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    state.toast = "";
    renderToast();
  }, 4200);
}

function setVariant(variant) {
  if (!["a", "b", "c"].includes(variant)) return;
  state.variant = variant;
  state.detailTab = "overview";
  if (window.location.hash !== `#${variant}`) history.replaceState(null, "", `#${variant}`);
  renderApp();
  document.querySelector(`.variant-tab[data-variant="${variant}"]`)?.focus();
}

function closeDrawer() {
  const previouslyFocused = document.activeElement;
  state.drawer = false;
  renderDrawer();
  const trigger = document.querySelector('[data-action="open-drawer"]');
  if (trigger && previouslyFocused?.closest(".source-drawer")) trigger.focus();
}

document.addEventListener("click", (event) => {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const action = button.dataset.action;
  if (action === "nav") {
    event.preventDefault();
    if (button.getAttribute("href") !== "#models") showToast("原型仅展示模型模块；其他入口保留应用导航位置。");
    return;
  }
  if (action === "set-variant") setVariant(button.dataset.variant);
  if (action === "toggle-theme") {
    state.theme = state.theme === "light" ? "dark" : "light";
    state.focusRequest = { kind: "action", action: "toggle-theme" };
    renderApp();
  }
  if (action === "toggle-density") {
    state.density = state.density === "comfortable" ? "compact" : "comfortable";
    state.focusRequest = { kind: "action", action: "toggle-density" };
    renderApp();
  }
  if (action === "select-family") {
    selectFamily(button.dataset.id);
    state.focusRequest = { kind: "family", id: button.dataset.id };
    renderApp();
  }
  if (action === "select-version") {
    state.selectedFamily = button.dataset.family;
    state.selectedVersion = button.dataset.id;
    state.detailTab = "overview";
    state.focusRequest = { kind: "version", id: button.dataset.id };
    renderApp();
  }
  if (action === "detail-tab") setDetailTab(button.dataset.tab);
  if (action === "clear-filter") {
    state.search = "";
    state.filter = "all";
    state.focusRequest = { kind: "search" };
    renderApp();
  }
  if (action === "open-drawer") {
    state.drawer = true;
    renderDrawer();
  }
  if (action === "close-drawer") closeDrawer();
  if (action === "select-source") {
    state.source = button.dataset.source;
    renderDrawer();
  }
  if (action === "refresh") showToast("状态已刷新。页面仍分别显示文件、兼容和实例核对结果。");
  if (action === "pair-check") {
    const role = button.dataset.role || "当前";
    showToast(`${role} Adapter 与基座指纹配对通过（原型模拟）；正式页面会重新校验清单、基座和 Adapter 指纹。`);
  }
  if (action === "demo-action") showToast(button.dataset.message || "原型操作已记录；未写入真实业务数据。");
  if (action === "copy") {
    const value = button.dataset.copy || button.closest("div")?.querySelector("code")?.textContent || "";
    if (navigator.clipboard && value) navigator.clipboard.writeText(value).catch(() => {});
    showToast("已复制标识；原型不写入数据库或对象存储。");
  }
  if (action === "dismiss-toast") {
    state.toast = "";
    renderToast();
  }
});

document.addEventListener("input", (event) => {
  if (event.target.id === "model-search") {
    state.search = event.target.value;
    const position = event.target.selectionStart;
    renderApp();
    const next = document.querySelector("#model-search");
    if (next) {
      next.focus();
      next.setSelectionRange(position, position);
    }
  }
});

document.addEventListener("change", (event) => {
  if (event.target.id === "model-filter") {
    state.filter = event.target.value;
    state.focusRequest = { kind: "filter" };
    renderApp();
  }
});

document.addEventListener("submit", (event) => {
  if (event.target.id !== "model-source-form") return;
  event.preventDefault();
  const source = sourceLabels[state.source];
  state.drawer = false;
  renderApp();
  showToast(`${source}来源已提交。原型只模拟待处理版本，不写入 PostgreSQL 或 MinIO。`);
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && state.drawer) closeDrawer();
  if (event.key === "Tab" && state.drawer) {
    const focusable = [...drawerRoot.querySelectorAll("button:not(:disabled), input:not(:disabled), select:not(:disabled)")];
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
  }
  const variantTab = event.target.closest(".variant-tab");
  if (variantTab && ["ArrowLeft", "ArrowRight"].includes(event.key)) {
    const order = ["a", "b", "c"];
    const current = order.indexOf(state.variant);
    const next = event.key === "ArrowRight" ? (current + 1) % order.length : (current - 1 + order.length) % order.length;
    setVariant(order[next]);
    return;
  }
  const detailTab = event.target.closest('[role="tab"][data-action="detail-tab"]');
  if (detailTab && ["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
    const tabList = detailTab.closest('[role="tablist"]');
    const tabs = [...tabList.querySelectorAll('[role="tab"][data-action="detail-tab"]')];
    const index = tabs.indexOf(detailTab);
    let nextIndex = index;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % tabs.length;
    if (event.key === "ArrowLeft") nextIndex = (index - 1 + tabs.length) % tabs.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = tabs.length - 1;
    event.preventDefault();
    setDetailTab(tabs[nextIndex].dataset.tab);
  }
});

const hashVariant = window.location.hash.replace("#", "");
if (["a", "b", "c"].includes(hashVariant)) state.variant = hashVariant;
renderApp();
