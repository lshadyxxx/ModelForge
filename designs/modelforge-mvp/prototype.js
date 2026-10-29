const NAV = [["workbench", "工作台"], ["datasets", "数据集"], ["models", "模型"], ["compute", "计算环境"], ["training", "训练"], ["inference", "推理试用"]];
const VARIANTS = { A: "紧凑运营台", B: "任务流工作区", C: "计算资源控制台" };
const FLOW = [["数据集", "固定版本"], ["基础模型", "选择来源"], ["计算环境", "单 GPU + 镜像"], ["训练", "文本 SFT + LoRA"], ["模型产物", "Best / Final"], ["推理试用", "独立 vLLM"]];
const SCENARIOS = ["normal", "dependency-failure", "dataset-invalid", "import-interrupted", "resource-empty", "resource-incompatible", "training-cancelled", "artifact-sync-failure", "cleanup-failure"];
const TITLES = {
  workbench: ["工作台", "查看依赖、训练进展与 GPU 生命周期，再从当前状态进入下一步。"],
  datasets: ["数据集", "上传 messages JSONL，定位行级错误并发布不可变训练版本。"],
  models: ["模型", "导入托管模型，或登记优云公共目录中的外部只读基座。"],
  compute: ["计算环境", "从优云真实目录选择单 GPU 规格与镜像；目录、兼容性和实例状态分别核对。"],
  training: ["训练", "以固定数据版本、基础模型指纹和受控参数创建文本 SFT + LoRA 任务。"],
  inference: ["推理试用", "从 Best 或 Final Adapter 启动独立 vLLM 实例，在当前页面内完成多轮验证。"]
};
const state = {
  variant: new URLSearchParams(location.search).get("variant") || "A",
  page: "workbench", scenario: "normal", published: false, validated: false,
  importDone: false, source: "directory", selectedResource: "", trainingStatus: "",
  timer: 0, syncRestored: false, adapter: "Best", trial: "", chat: [],
  streaming: false, streamTimer: 0, streamIndex: 0, toastTimer: 0,
  importState: "idle", cleanupDone: false, datasetSelected: false, formError: ""
};
state.variant = state.variant.toUpperCase();
if (!VARIANTS[state.variant]) state.variant = "A";
function esc(value) {
  return String(value).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}
function button(label, action, style, extra) {
  return '<button type="button" class="button ' + (style || "") + '" data-action="' + action + '" ' + (extra || "") + '>' + label + "</button>";
}
function badge(label, kind) {
  return '<span class="status ' + (kind ? "status-" + kind : "") + '">' + label + "</span>";
}
function heading(title, subtitle, actions) {
  return '<div class="page-heading"><div><div class="eyebrow">ModelForge · 首版工作台</div><h1>' + title + "</h1><p>" + subtitle + '</p></div><div class="heading-actions">' + (actions || "") + '<span class="demo-pill">演示数据</span></div></div>';
}
function section(title, subtitle, body, action) {
  return '<section class="section"><div class="section-heading"><div><h2>' + title + "</h2>" + (subtitle ? "<p>" + subtitle + "</p>" : "") + "</div>" + (action || "") + '</div><div class="section-body">' + body + "</div></section>";
}
function table(headers, rows) {
  return '<div class="table-wrap"><table><thead><tr>' + headers.map(function (h) { return "<th>" + h + "</th>"; }).join("") + "</tr></thead><tbody>" + rows.join("") + "</tbody></table></div>";
}
function navLinks() {
  return NAV.map(function (item) {
    return '<button type="button" class="nav-link ' + (state.page === item[0] ? "is-active" : "") + '" data-action="navigate" data-page="' + item[0] + '"' + (state.page === item[0] ? ' aria-current="page"' : "") + ">" + item[1] + "</button>";
  }).join("");
}
function renderSidebar() {
  const rail = document.getElementById("side-rail");
  if (state.variant === "B") { rail.innerHTML = ""; return; }
  if (state.variant === "A") {
    rail.innerHTML = '<div class="side-brand"><span class="brand-mark">M</span><span><strong>ModelForge</strong><small>模型工程台</small></span></div><div class="side-section-label">工作区</div><nav class="side-nav-list" aria-label="主导航">' + navLinks() + '</nav><div class="side-footer"><span class="demo-pill">演示环境</span><br><br>不连接服务、云账号或 GPU。</div>';
    return;
  }
  const map = {
    workbench: ["全局状态", "最近任务", "待清理实例"], datasets: ["版本列表", "校验报告", "引用关系"],
    models: ["模型来源", "传输状态", "文件指纹"], compute: ["GPU 目录", "镜像目录", "运行实例"],
    training: ["任务列表", "配置快照", "产物同步"], inference: ["试用实例", "模型绑定", "空闲回收"]
  };
  rail.innerHTML = '<div class="side-brand"><span class="brand-mark">M</span><span><strong>MODEL FORGE</strong><small>CONTROL PLANE · DEMO</small></span></div><div class="side-section-label">当前视图</div><div class="context-rail">' + map[state.page].map(function (item, i) {
    return '<button type="button" class="context-filter ' + (i === 0 ? "is-active" : "") + '" data-action="filter">' + item + "</button>";
  }).join("") + '</div><div class="side-footer">演示目录<br>来源：原型样例数据</div>';
}
function dependencyRow() {
  const down = state.scenario === "dependency-failure";
  const values = [["API", "演示：可访问"], ["PostgreSQL", down ? "演示：连接失败" : "演示：正常"], ["MinIO", down ? "演示：不可用" : "演示：正常"], ["Worker HTTP 探针", down ? "演示：不可达" : "演示：可达"], ["优云目录", down ? "演示：查询失败" : "演示：示例数据"]];
  return '<div class="dependency-row">' + values.map(function (item, i) {
    return '<div class="dependency ' + (down && i > 0 ? "is-down" : "") + '"><span>' + item[0] + "</span><strong>" + item[1] + "</strong></div>";
  }).join("") + "</div>";
}
function renderWorkflow() {
  const strip = document.getElementById("workflow-strip");
  if (state.variant !== "B") { strip.innerHTML = ""; return; }
  const order = ["datasets", "models", "compute", "training", "models", "inference"];
  const active = order.indexOf(state.page);
  strip.innerHTML = '<div class="flow-band" aria-label="MVP 主流程">' + FLOW.map(function (item, i) {
    return '<div class="flow-band-step ' + (i === active ? "is-current" : "") + '"><span class="flow-dot">' + String(i + 1).padStart(2, "0") + "</span><span><strong>" + item[0] + "</strong><br>" + item[1] + "</span></div>";
  }).join("") + "</div>";
}
function renderInspector() {
  const node = document.getElementById("inspector");
  if (state.variant === "A") { node.innerHTML = ""; return; }
  if (state.variant === "B") {
    const label = (NAV.find(function (item) { return item[0] === state.page; }) || [null, "工作台"])[1];
    node.innerHTML = '<h2 class="inspector-title">当前流程检查</h2><div class="inspector-block"><span class="eyebrow">入口</span><strong>' + label + '</strong><p>入口可直达；任务成功、产物可用和实例释放分别核对。</p></div><div class="inspector-block"><span class="eyebrow">数据来源</span><strong>原型演示</strong><p>目录、依赖、Loss 和回复都是静态样例，不代表真实连接。</p></div><div class="inspector-block"><span class="eyebrow">下一步</span><strong>' + (state.page === "workbench" ? "上传数据或模型" : "查看当前状态") + '</strong><p>失败时保留任务和实例关联，再按状态提供恢复操作。</p></div>';
    return;
  }
  const line = state.page === "compute" ? "实例状态与租约分开显示" : state.page === "training" ? "训练退出、产物可用、实例释放分开显示" : state.page === "inference" ? "进程停止、实例删除、租约释放分开显示" : "来源、文件校验、兼容状态分开显示";
  const catalog = state.scenario === "resource-empty" ? "演示：无库存" : state.scenario === "resource-incompatible" ? "演示：无兼容组合" : "演示：示例目录";
  node.innerHTML = '<h2 class="inspector-title">运行检查器 <span class="demo-pill">演示</span></h2><div class="inspector-block"><span class="eyebrow">状态原则</span><strong>' + line + '</strong><p>目录可见不等于兼容，训练成功不等于产物可用，实例停止不等于资源释放。</p></div><div class="inspector-block"><span class="eyebrow">GPU 租约</span><strong>' + esc(state.selectedResource || "尚未选择") + '</strong><p>首期单 GPU。实例未知时不释放租约。</p></div><div class="inspector-block"><span class="eyebrow">优云目录</span><strong>' + catalog + '</strong><p>未连接优云；真实目录、库存和镜像状态由后端返回。</p></div>';
}
function renderWorkbench() {
  const t = TITLES.workbench;
  const actions = '<div class="inline-actions">' + button("上传数据集", "navigate", "button-primary", 'data-page="datasets"') + button("导入模型", "navigate", "", 'data-page="models"') + button("创建训练", "navigate", "", 'data-page="training"') + "</div>";
  const rows = [
    '<tr><td><strong>ft-2026-1042</strong><span class="cell-sub">尝试 01 · 演示</span></td><td>Base-Example-01<span class="cell-sub">support-v3</span></td><td>' + badge("演示：训练成功") + '</td><td>' + (state.scenario === "artifact-sync-failure" && !state.syncRestored ? badge("演示：回传失败", "error") : badge("演示：Best / Final 可用")) + '</td><td>' + badge("演示：已释放") + "</td></tr>",
    '<tr><td><strong>ft-2026-1041</strong><span class="cell-sub">尝试 02 · 演示</span></td><td>Base-Example-01<span class="cell-sub">support-v2</span></td><td>' + badge("演示：失败", "error") + '</td><td>' + badge("演示：未发布", "muted") + '</td><td>' + badge("演示：已删除") + "</td></tr>"
  ];
  const recent = table(["训练任务", "模型 / 数据", "任务状态", "产物同步", "实例"], rows);
  if (state.variant === "B") {
    const flow = '<ol class="flow-steps">' + FLOW.map(function (item, i) {
      return '<li class="flow-step ' + (i < 2 ? "is-done" : i === 2 ? "is-current" : "") + '"><strong>' + String(i + 1).padStart(2, "0") + " · " + item[0] + "</strong><span>" + item[1] + "</span></li>";
    }).join("") + "</ol>";
    return heading(t[0], t[1], actions) + dependencyRow() + section("从数据到试用", "主流程状态与可执行下一步", flow + actions) + section("最近任务与待处理事项", "训练、产物与实例状态分别呈现。", recent + '<div class="callout callout-info">目录、Loss 和依赖均为原型样例，不连接 PostgreSQL、MinIO、Worker、GPU 或优云。</div>');
  }
  if (state.variant === "C") {
    const metrics = '<div class="metric-strip"><div class="metric"><span>GPU 租约</span><strong>空闲</strong><span>演示状态</span></div><div class="metric"><span>运行实例</span><strong>01</strong><span>演示计数</span></div><div class="metric"><span>训练任务</span><strong>02</strong><span>演示计数</span></div><div class="metric"><span>待清理</span><strong>' + (state.scenario === "cleanup-failure" ? "01" : "00") + '</strong><span>演示状态</span></div></div>';
    const cleanup = dependencyRow() + '<ul class="rule-list"><li><span>训练产物回传</span>' + (state.scenario === "artifact-sync-failure" && !state.syncRestored ? badge("待恢复", "error") : badge("已核验")) + '</li><li><span>推理实例回收</span>' + (state.scenario === "cleanup-failure" ? badge("删除失败", "error") : badge("可核验")) + "</li></ul>";
    return heading(t[0], t[1], actions) + '<div class="resource-layout"><div>' + section("单 GPU 运行状态", "真实规格由优云目录查询；此处全部是演示值。", metrics) + section("最近任务", "", recent) + "</div><div>" + section("依赖与清理", "", cleanup) + "</div></div>";
  }
  const metrics = '<div class="metric-strip section"><div class="metric"><span>近 7 日训练</span><strong>04</strong><span>演示计数</span></div><div class="metric"><span>可用 Adapter</span><strong>02</strong><span>演示资产</span></div><div class="metric"><span>GPU 租约</span><strong>空闲</strong><span>演示状态</span></div><div class="metric"><span>待清理实例</span><strong>' + (state.scenario === "cleanup-failure" ? "01" : "00") + '</strong><span>演示状态</span></div></div>';
  return heading(t[0], t[1], actions) + dependencyRow() + metrics + section("最近训练任务", "训练、产物同步与云实例释放是三个独立状态。", recent) + section("从这里继续", "", actions);
}
function renderDatasets() {
  const invalid = state.scenario === "dataset-invalid";
  let check = '<div class="microcopy">待执行演示校验。正式服务按物理行号返回字段路径和原因。</div>';
  if (invalid) check = '<div class="callout callout-error"><strong>演示校验失败</strong> · 第 8 行，messages[2].role：assistant 内容为空，不能作为监督目标。不是实际文件校验。</div>';
  else if (state.validated) check = '<div class="callout callout-info">演示校验通过：1,248 条有效样本；单轮 71%，多轮 29%。实际实施由服务端逐行校验。</div>';
  const version = state.published ? "v4" : "v3";
  const rows = [
    '<tr><td><strong>support-sft-' + version + '</strong><span class="cell-sub">messages JSONL · 演示版本</span></td><td>1,248</td><td>' + (invalid && !state.published ? badge("演示：有错误", "error") : badge("演示：通过")) + '</td><td>10% · 固定拆分</td><td>' + badge("未引用", "muted") + "</td></tr>",
    '<tr><td><strong>support-sft-v2</strong><span class="cell-sub">messages JSONL · 演示版本</span></td><td>936</td><td>' + badge("演示：已发布") + '</td><td>10%</td><td>' + badge("训练引用", "info") + "</td></tr>"
  ];
  const sample = '<pre class="sample-code">{"messages":[{"role":"user","content":"请介绍 ModelForge。"},{"role":"assistant","content":"ModelForge 管理微调与推理生命周期。"}]}</pre>';
  const details = '<div class="split"><div><div class="inline-actions">' + button("选择演示 JSONL", "dataset-select") + button("校验 messages JSONL", "validate-dataset", "button-primary") + button(state.published ? "版本已发布" : "发布不可变版本", "publish-dataset", "", state.published || invalid ? "disabled" : "") + "</div>" + check + sample + '<p class="microcopy">容量初始方案：单文件 100 MiB · 最多 100,000 个样本 · 单行 1 MiB；实施时按实测锁定。</p></div><div><div class="eyebrow">拟发布版本</div><ul class="rule-list"><li><span>文件</span><strong>support-sft.jsonl</strong></li><li><span>编码</span><strong>UTF-8</strong></li><li><span>版本规则</span><strong>不可变</strong></li><li><span>正式存储</span><strong>MinIO + PostgreSQL</strong></li></ul></div></div>';
  return heading(TITLES.datasets[0], TITLES.datasets[1], button("下载原始文件", "demo-action")) + section("新建数据版本", "仅支持 messages JSONL；每个非空物理行是一条对话。", details) + section("数据集版本", "正式文件保存在 MinIO，版本和引用关系记录在 PostgreSQL。", table(["版本", "样本", "校验", "验证集", "引用"], rows));
}
function renderModels() {
  const interrupted = state.scenario === "import-interrupted" && !state.importDone;
  const sourceNames = { directory: "完整目录上传", modelscope: "ModelScope 公开仓库", huggingface: "Hugging Face 公开仓库", ucloud: "优云公共模型目录" };
  const sourceItems = [["directory", "完整目录"], ["modelscope", "ModelScope"], ["huggingface", "Hugging Face"], ["ucloud", "优云公共模型"]];
  const sourceTabs = sourceItems.map(function (item) {
    return '<button type="button" class="source-tab ' + (state.source === item[0] ? "is-active" : "") + '" data-action="model-source" data-source="' + item[0] + '">' + item[1] + "</button>";
  }).join("");
  let form = "";
  if (state.source === "directory") form = '<div class="field"><label for="model-path">模型目录</label><input id="model-path" value="本地示例目录 /models/base-example" readonly></div><div class="inline-actions section">' + button("模拟选择目录", "start-import", "button-primary") + button(interrupted ? "恢复失败文件" : "重试导入", "resume-import", "", interrupted ? "" : "disabled") + "</div>";
  else if (state.source === "ucloud") form = '<div class="field"><label>优云公共模型目录</label><input value="/public-models/示例模型" readonly></div><div class="inline-actions section">' + button("登记外部只读引用", "start-import", "button-primary") + "</div>";
  else form = '<div class="form-grid"><div class="field"><label for="repo-name">公开仓库标识</label><input id="repo-name" value="organization/model-example"></div><div class="field"><label for="revision">revision（可选）</label><input id="revision" value="main"></div></div><div class="inline-actions section">' + button("解析版本并导入", "start-import", "button-primary") + "</div>";
  const progress = '<div class="file-progress"><span>config.json</span><span class="progress-track"><span class="progress-fill" style="width:100%"></span></span>' + badge("已校验") + '</div><div class="file-progress"><span>tokenizer.json</span><span class="progress-track"><span class="progress-fill" style="width:100%"></span></span>' + badge("已校验") + '</div><div class="file-progress"><span>model-00001.safetensors</span><span class="progress-track"><span class="progress-fill ' + (interrupted ? "is-failed" : "") + '" style="width:' + (interrupted ? "42%" : state.importDone ? "100%" : "68%") + '"></span></span>' + (interrupted ? badge("中断待重传", "error") : state.importDone ? badge("已校验") : badge("演示：传输中", "info")) + "</div>";
  const note = interrupted ? '<div class="callout callout-error">演示导入中断：已校验文件可复用，失败文件重新传输。真实进度和 SHA-256 必须来自服务端。</div>' : state.importDone ? '<div class="callout callout-info">演示导入完成；正式版本需写入 MinIO 并回读校验。</div>' : '<p class="microcopy">正式数据集、托管模型和 Adapter 使用 MinIO；优云公共基座按内容指纹引用，不复制入库。</p>';
  const rows = [
    '<tr><td><strong>Base-Example-01</strong><span class="cell-sub">优云公共目录 · 外部只读</span></td><td>' + badge("演示：指纹已核对", "info") + '</td><td>BaseModel</td><td>' + badge("演示：可用") + '</td><td>不复制到 MinIO</td></tr>',
    '<tr><td><strong>support-sft-ft1042</strong><span class="cell-sub">Attempt 01 · Best Adapter</span></td><td>' + (state.scenario === "artifact-sync-failure" && !state.syncRestored ? badge("演示：回传失败", "error") : badge("演示：可用")) + '</td><td>训练产物</td><td>MinIO</td><td>验证 Loss 0.84</td></tr>'
  ];
  const content = '<div class="model-source-row">' + sourceTabs + '</div><div class="split section-body"><div>' + form + note + '</div><div><div class="eyebrow">文件级传输清单 · 演示</div>' + progress + '<p class="microcopy">容量初始方案：单文件 20 GiB、目录总量 100 GiB、最多 10,000 个文件；须经传输实测锁定。</p></div></div>';
  return heading(TITLES.models[0], TITLES.models[1], button("刷新来源目录", "refresh-catalog")) + section("导入模型", "当前来源：" + sourceNames[state.source] + "。公共仓库仅支持公开模型。", content) + section("模型资产与来源", "外部只读基座与 MinIO 托管版本不能混为同一存储状态。", table(["模型 / 版本", "校验", "类型", "状态", "存储 / 指标"], rows));
}
function renderCompute() {
  const empty = state.scenario === "resource-empty";
  const incompatible = state.scenario === "resource-incompatible";
  const rows = empty ? ['<tr><td colspan="5"><div class="empty-state">演示：当前筛选无可用库存。真实接口须区分目录成功但无库存与查询失败。</div></td></tr>'] : [
    '<tr><td><strong>GPU Example A</strong><span class="cell-sub">24 GiB · 演示规格</span></td><td>区域示例-1</td><td>' + (incompatible ? badge("演示：不兼容", "error") : badge("演示：有库存")) + '</td><td>Image Example 01</td><td>' + (incompatible ? badge("缺少推理运行时", "error") : badge("演示：可选")) + "</td></tr>",
    '<tr><td><strong>GPU Example B</strong><span class="cell-sub">48 GiB · 演示规格</span></td><td>区域示例-2</td><td>' + badge("演示：有库存") + '</td><td>Image Example 02</td><td>' + (incompatible ? badge("基座目录不可见", "error") : badge("演示：待验证", "warn")) + "</td></tr>"
  ];
  const selection = esc(state.selectedResource || "未选择");
  const instances = table(["实例", "用途", "关联", "云状态", "清理 / 租约"], [
    '<tr><td><strong>demo-instance-01</strong></td><td>训练</td><td>ft-2026-1042</td><td>' + badge("演示：Running", "info") + '</td><td>' + badge("演示：已释放") + "</td></tr>",
    '<tr><td><strong>demo-instance-02</strong></td><td>推理</td><td>trial-2026-004</td><td>' + badge("演示：删除失败", "error") + '</td><td>' + button("重试清理", "retry-cleanup", "button-small") + "</td></tr>"
  ]);
  const choices = table(["GPU / 显存", "区域", "库存", "镜像", "兼容检查"], rows) + '<div class="inline-actions section">' + button(state.selectedResource ? "已选：" + selection : "选择 GPU Example A", "select-resource", "button-primary", empty || incompatible ? "disabled" : "") + button("查看公共模型目录", "model-directory") + "</div>";
  const rules = '<ul class="rule-list"><li><span>目录新鲜度</span>' + badge("演示：刚刷新", "info") + '</li><li><span>当前选择</span><strong>' + selection + '</strong></li><li><span>挂载能力</span>' + (incompatible ? badge("演示：不可用", "error") : badge("演示：待核验", "warn")) + '</li><li><span>实例已创建</span>' + badge("否", "muted") + '</li></ul><div class="callout callout-error">清理失败时保留实例 ID 与租约；请求超时不代表远端资源已释放。</div>';
  return heading(TITLES.compute[0], TITLES.compute[1], button("刷新目录", "refresh-catalog")) + '<div class="callout callout-info">目录、库存和镜像都是演示样例。实际产品区分规格存在、当前库存、镜像兼容和实例 Running，不预选 GPU、模型或镜像。</div><div class="resource-layout"><div>' + section("单 GPU 规格与镜像", "规格值仅展示选择控件，不是推荐或验收硬件。", choices) + section("实例清单", "实例、训练进程、删除结果和 GPU 租约分别核对。", instances) + '</div><div>' + section("规格选择检查", "", rules) + "</div></div>";
}
function renderTraining() {
  const scenarioRunning = state.scenario === "training-cancelled";
  const current = state.trainingStatus || (scenarioRunning ? "running" : "success");
  const running = current === "running" || current === "stopping";
  const syncFail = state.scenario === "artifact-sync-failure" && !state.syncRestored;
  const cancelled = current === "cancelled";
  const success = current === "success";
  const artifact = cancelled || running ? badge("演示：未发布", "muted") : syncFail ? badge("演示：回传待恢复", "error") : badge("演示：已校验");
  const stages = [
    ["校验输入", "数据版本与基座指纹"], ["申请实例", "库存与单 GPU 租约"],
    ["远程训练", current === "stopping" ? "停止中 · 等待远端退出" : cancelled ? "演示：已取消" : running ? "运行中 / 可取消" : "演示：训练成功"], ["产物回传", cancelled ? "取消 · 不发布部分产物" : running ? "尚未开始" : syncFail ? "待恢复" : "演示：Best / Final"],
    ["释放实例", cancelled ? "演示：停止后已删除" : running || syncFail ? "未释放 · 租约占用" : "演示：已释放"], ["平台试用", success && !syncFail ? "可选择 Best / Final" : "尚不可用"]
  ];
  const steps = '<ol class="flow-steps">' + stages.map(function (item, i) {
    const cls = i < 2 || (i === 2 && (success || cancelled)) || (i === 3 && success && !syncFail) ? "is-done" : (i === 2 && running || i === 3 && success && syncFail ? "is-current" : "");
    return '<li class="flow-step ' + cls + '"><strong>' + String(i + 1).padStart(2, "0") + " · " + item[0] + "</strong><span>" + item[1] + "</span></li>";
  }).join("") + "</ol>";
  const advanced = '<details class="details"><summary>受控高级参数（首版初始方案）</summary><div class="details-content"><div class="form-grid"><div class="field"><label for="batch">单设备 Batch</label><input id="batch" type="number" value="1"></div><div class="field"><label for="accumulation">梯度累积</label><input id="accumulation" type="number" value="8"></div><div class="field"><label for="rank">LoRA rank</label><select id="rank"><option>8 · 初始建议</option><option>16</option><option>32</option></select></div><div class="field"><label for="alpha">LoRA alpha</label><input id="alpha" type="number" value="16"></div><div class="field"><label for="warmup">warmup ratio</label><input id="warmup" type="number" value="0.1" step="0.01"></div><div class="field"><label for="split">验证拆分</label><input id="split" value="10% · seed 42" readonly></div></div><p class="microcopy">初始方案须用真实目录、兼容性和 GPU 结果锁定。拒绝自由 YAML，不静默改写参数。</p></div></details>';
  const form = '<div class="form-grid"><div class="field"><label for="data-version">数据集版本</label><select id="data-version"><option>support-sft-v3 · 演示版本</option><option>support-sft-v2 · 演示版本</option></select></div><div class="field"><label for="base-model">基础模型来源</label><select id="base-model"><option>优云外部只读 · Example-01</option><option>MinIO 托管 · Imported-02</option></select></div><div class="field"><label for="gpu-image">GPU / 镜像</label><select id="gpu-image"><option>由界面选择 · 示例规格</option><option>兼容项从真实目录提供</option></select></div><div class="field"><label for="epochs">训练轮数</label><input id="epochs" type="number" value="3" min="1" max="100"></div><div class="field"><label for="learning-rate">学习率</label><input id="learning-rate" type="number" value="0.0002" step="0.0001"></div><div class="field"><label for="sequence">最大序列长度</label><select id="sequence"><option>2048 · 初始建议</option><option>兼容预设提供</option></select></div></div>' + advanced;
  const controls = '<div class="inline-actions section">' + button("提交演示任务", "start-training", "button-primary", running ? "disabled" : "") + (running ? button(current === "stopping" ? "正在核对远程停止…" : "取消训练", "cancel-training", "button-danger") : "") + "</div>";
  const chart = '<svg viewBox="0 0 500 96" role="img" aria-label="演示训练与验证 Loss"><path d="M0 76 C40 69 53 55 90 58 S145 48 180 46 S226 35 265 39 S320 27 360 30 S420 18 500 16" fill="none" stroke="currentColor" stroke-width="3"></path><path d="M0 88 C42 78 57 70 92 72 S145 62 180 68 S226 48 265 55 S318 44 360 49 S420 37 500 36" fill="none" stroke="#c45938" stroke-width="2" stroke-dasharray="5 5"></path></svg>';
  const results = '<div class="split"><div><div class="eyebrow">训练与验证指标 · 演示 Loss</div>' + chart + '<div class="inline-actions">' + badge("训练 Loss 0.41", "info") + badge("验证 Loss 0.36", "warn") + '</div></div><div><div class="eyebrow">Best / Final Adapter</div><ul class="rule-list"><li><span>Best · 最低有效验证 Loss</span>' + artifact + '</li><li><span>Final · 最后成功输出</span>' + artifact + '</li><li><span>训练实例</span>' + (syncFail ? badge("演示：保留待恢复", "warn") : badge("演示：已释放")) + "</li></ul>" + (syncFail ? button("恢复产物同步", "recover-sync", "button-small") : "") + "</div></div>";
  return heading(TITLES.training[0], TITLES.training[1]) + section("创建训练任务", "文本 SFT + LoRA · 固定 10% 验证集 · 参数初始方案", form + controls) + section("任务进展", "实例 Running、训练退出、产物可用、实例已释放分别记录。", steps + results);
}
function renderChat() {
  if (!state.chat.length) return '<div class="empty-state">开始对话后，演示内容显示在这里。真实服务仅在所选 Adapter 加载且 vLLM 就绪后开放输入。</div>';
  return state.chat.map(function (item) {
    const who = item.role === "user" ? "你" : "ModelForge · 原型演示回复";
    const text = item.streaming ? '<span id="streaming-output">' + esc(item.text) + '</span><span class="stream-cursor">▋</span>' : esc(item.text);
    return '<div class="chat-message ' + item.role + '"><span class="eyebrow">' + who + "</span><div>" + text + "</div>" + (item.partial ? '<div class="microcopy">已停止 · 部分回复未作为完整历史发送</div>' : "") + "</div>";
  }).join("");
}
function renderInference() {
  const active = state.trial === "ready";
  const exists = ["ready", "ending", "cleanup-failed"].includes(state.trial);
  const failed = state.trial === "cleanup-failed";
  const trialControl = exists ? button(state.trial === "ending" ? "正在核对删除…" : "结束试用", "end-trial", "button-danger", state.trial === "ending" || failed ? "disabled" : "") : button("启动演示试用", "start-trial", "button-primary");
  const send = state.streaming ? button("停止生成", "stop-generation", "button-danger") : '<button type="submit" class="button button-primary" ' + (!active ? "disabled" : "") + ">发送</button>";
  const compose = '<form id="chat-form" class="chat-compose"><textarea name="prompt" aria-label="输入消息" placeholder="' + (active ? "输入一条消息…" : "启动试用后可输入") + '"' + (!active || state.streaming ? " disabled" : "") + "></textarea>" + send + "</form>";
  const versions = '<div class="field"><span class="field-label">Adapter 版本</span><div class="segmented"><button type="button" class="segment-button ' + (state.adapter === "Best" ? "is-active" : "") + '" data-action="choose-adapter" data-adapter="Best">Best</button><button type="button" class="segment-button ' + (state.adapter === "Final" ? "is-active" : "") + '" data-action="choose-adapter" data-adapter="Final">Final</button></div></div>';
  const meta = '<div class="trial-meta"><div><span class="eyebrow">基础模型</span><strong>Base-Example-01</strong></div><div><span class="eyebrow">GPU / 镜像</span><strong>界面选择</strong></div><div><span class="eyebrow">Adapter</span><strong>' + state.adapter + ' · ft-1042</strong></div><div><span class="eyebrow">空闲回收</span><strong>15:00 · 演示计时</strong></div></div>';
  const notice = failed ? '<div class="callout callout-error">演示清理失败：实例 ID 保留、租约仍占用。需重试核对删除结果。</div>' + button("重试清理", "retry-cleanup", "button-small") : '<div class="callout callout-info">试用另建独立 GPU 实例。停止生成只结束当前回复，不删除实例。</div>';
  const settings = versions + meta + '<div class="inline-actions section">' + trialControl + button("清空当前对话", "clear-chat", "button-quiet", state.chat.length ? "" : "disabled") + "</div>" + notice;
  const chat = '<section class="chat-window"><div class="chat-top"><div><strong>当前页面会话</strong><div class="microcopy">不保存历史 · 回复为原型演示</div></div>' + badge(active ? "演示：vLLM 就绪" : "尚未启动", active ? "info" : "muted") + '</div><div id="chat-messages" class="chat-messages">' + renderChat() + "</div>" + compose + "</section>";
  return heading(TITLES.inference[0], TITLES.inference[1]) + '<div class="chat-layout">' + chat + "<div>" + section("试用配置", "选择明确的训练产物版本。", settings) + "</div></div>";
}
function content() {
  return {
    workbench: renderWorkbench, datasets: renderDatasets, models: renderModels,
    compute: renderCompute, training: renderTraining, inference: renderInference
  }[state.page]();
}
function render() {
  document.getElementById("app").className = "app-shell shell-" + state.variant.toLowerCase();
  renderSidebar();
  document.getElementById("top-navigation").innerHTML = state.variant === "A" ? "" : navLinks();
  renderWorkflow();
  renderInspector();
  document.getElementById("screen").innerHTML = content();
  document.getElementById("screen").dataset.screenLabel = TITLES[state.page][0];
  refineScreen();
  document.getElementById("variant-key").textContent = state.variant;
  document.getElementById("variant-name").textContent = VARIANTS[state.variant];
  document.querySelectorAll(".switch-key").forEach(function (node) { node.classList.toggle("is-current", node.dataset.variant === state.variant); });
  document.getElementById("scenario-select").value = state.scenario;
}
function setVariant(value) {
  const keys = Object.keys(VARIANTS);
  const index = keys.indexOf(state.variant);
  state.variant = value || keys[(index + keys.length) % keys.length];
  const url = new URL(location.href);
  url.searchParams.set("variant", state.variant);
  history.replaceState(null, "", url);
  render();
}
function toast(message) {
  let node = document.getElementById("prototype-toast");
  if (!node) {
    node = document.createElement("div");
    node.id = "prototype-toast";
    node.className = "prototype-toast";
    node.setAttribute("role", "status");
    document.body.append(node);
  }
  node.textContent = message;
  node.classList.add("is-visible");
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(function () { node.classList.remove("is-visible"); }, 2400);
}
function navigate(page) {
  if (!NAV.some(function (item) { return item[0] === page; })) return;
  state.page = page;
  render();
  document.getElementById("screen").focus({ preventScroll: true });
}
function stopStream(partial) {
  clearInterval(state.streamTimer);
  if (state.streaming) {
    const item = state.chat[state.chat.length - 1];
    if (item && item.role === "assistant") { item.streaming = false; item.partial = partial; }
  }
  state.streaming = false;
}
function refineScreen() {
  const root = document.getElementById("screen");
  if (state.page === "datasets") {
    const publish = root.querySelector('[data-action="publish-dataset"]');
    if (publish) publish.disabled = state.published || !state.validated || !state.datasetSelected || state.scenario === "dataset-invalid";
    if (state.validated && !state.published && state.scenario !== "dataset-invalid") {
      root.insertAdjacentHTML("beforeend", section("样本预览 · 演示", "完整对话样本为划分单位；不拆开多轮消息。", '<div class="sample-code">user：如何准备训练？<br>assistant：先发布校验通过的数据版本。<br>user：验证集呢？<br>assistant：从固定版本划分，默认 10%，保存拆分清单。</div>'));
    }
  }
  if (state.page === "models") {
    const body = root.querySelector('.section .split');
    if (body && state.importState !== "idle" && state.importState !== "complete") body.insertAdjacentHTML("beforeend", '<div class="inline-actions">' + button("取消导入", "cancel-import", "button-danger") + '</div>');
    if (state.source === "ucloud") {
      const detail = root.querySelector('.section .split > div:last-child');
      if (detail) detail.innerHTML = '<div class="eyebrow">外部只读引用 · 演示</div><ul class="rule-list"><li><span>来源目录</span><strong>/public-models/示例模型</strong></li><li><span>内容指纹</span>' + badge("执行前核对", "warn") + '</li><li><span>平台保管副本</span><strong>否 · 不复制 MinIO</strong></li></ul><p class="microcopy">训练与独立推理必须核对同一基座身份；文件变化时阻止加载。</p>';
    }
    if (state.importState === "cancelled") root.insertAdjacentHTML("beforeend", '<div class="callout">演示导入已取消：不发布半成品；已校验文件可在重新选择同一目录后复用。</div>');
    root.insertAdjacentHTML("beforeend", '<div class="inline-actions">' + button("查看文件与版本来源", "show-model-details") + button("删除被引用版本", "delete-protected", "button-danger") + '</div>');
  }
  if (state.page === "workbench") {
    if (state.scenario === "artifact-sync-failure" && !state.syncRestored) {
      const last = root.querySelector('table tbody tr:first-child td:last-child');
      if (last) last.innerHTML = badge("保留实例 · 待回传", "warn");
    }
    if (state.scenario === "dependency-failure") root.insertAdjacentHTML("afterbegin", '<div class="callout callout-error">演示故障：API 仍可响应，PostgreSQL / MinIO 不就绪，Worker HTTP 探针不可达。健康响应不能替代真实读写验收。</div>');
  }
  if (state.page === "compute") {
    const rows = root.querySelectorAll('table');
    const instanceTable = rows[rows.length - 1];
    if (instanceTable) {
      const firstStatus = instanceTable.querySelector('tbody tr:first-child td:nth-child(4)');
      if (firstStatus) firstStatus.innerHTML = badge("演示：已删除");
      const last = instanceTable.querySelector('tbody tr:last-child');
      if (last) {
        last.cells[3].innerHTML = state.cleanupDone ? badge("演示：已删除") : badge("演示：删除失败", "error");
        last.cells[4].innerHTML = state.cleanupDone ? badge("演示：租约已释放") : button("重试清理", "retry-cleanup", "button-small");
      }
    }
  }
  if (state.page === "training") {
    const current = state.trainingStatus || (state.scenario === "training-cancelled" ? "running" : "success");
    const syncFail = state.scenario === "artifact-sync-failure" && !state.syncRestored;
    const resourceBadge = root.querySelector('.rule-list li:last-child .status');
    if (resourceBadge) resourceBadge.outerHTML = current === "running" || current === "stopping" ? badge("演示：运行 / 租约占用", "warn") : current === "cancelled" ? badge("演示：停止后已删除") : syncFail ? badge("保留唯一输出", "warn") : badge("演示：已释放");
    if (state.formError) root.querySelector('.section-body').insertAdjacentHTML("beforeend", '<p class="field-error" role="alert">' + esc(state.formError) + '</p>');
    root.insertAdjacentHTML("beforeend", section("日志与配置快照 · 演示", "运行状态、错误阶段和已取得的日志分别保存。", '<pre class="sample-code runtime-log">[demo] attempt=01 dataset=support-v3 split=seed42\n[demo] base identity=example-sha256 image=example-image\n[demo] state=' + esc(current) + '\n[demo] 所有日志和指标均为样例，无远程进程。</pre>' + (current === "cancelled" ? '<div class="callout">训练已取消，不发布部分 Adapter。重试会创建新 Attempt。</div>' + button("重试 · 新 Attempt", "start-training") : "")));
  }
  if (state.page === "inference") {
    root.querySelectorAll('[data-action="choose-adapter"]').forEach(function (node) { node.disabled = !!state.trial; });
    const topStatus = root.querySelector('.chat-top .status');
    if (topStatus) topStatus.outerHTML = state.trial === "ending" ? badge("回收中 · 拒绝新请求", "warn") : state.trial === "cleanup-failed" ? badge("清理失败 · 租约占用", "error") : state.trial === "ready" ? badge("演示：vLLM 就绪", "info") : badge("尚未启动", "muted");
    const clear = root.querySelector('[data-action="clear-chat"]');
    if (clear) clear.disabled = state.streaming || !state.chat.length;
    const meta = root.querySelector('.trial-meta');
    if (meta) meta.insertAdjacentHTML("afterend", '<details class="details"><summary>生成参数 · 初始方案</summary><div class="form-grid"><div class="field"><label for="temperature">temperature</label><input id="temperature" type="number" min="0" max="2" step="0.1" value="0.7"></div><div class="field"><label for="top-p">top_p</label><input id="top-p" type="number" min="0.01" max="1" step="0.01" value="0.9"></div><div class="field"><label for="tokens">最大输出 token</label><input id="tokens" type="number" value="512"></div></div></details>');
    if (state.trial === "ready") root.insertAdjacentHTML("beforeend", '<div class="inline-actions section">' + button("演示：空闲 15 分钟已到期", "idle-expire", "", state.streaming ? "disabled" : "") + '<span class="microcopy">此按钮推进演示时间，真实产品由后端计时。</span></div>');
  }
}
function runTraining() {
  state.trainingStatus = "running";
  render();
  clearTimeout(state.timer);
  state.timer = setTimeout(function () {
    if (state.trainingStatus === "running") { state.trainingStatus = "success"; render(); toast("演示训练结束；Loss 与产物状态均为样例。"); }
  }, 4200);
  toast("创建了演示任务，不会连接 GPU 或优云。");
}
function cancelTraining() {
  if (state.trainingStatus !== "running" && state.scenario !== "training-cancelled") return;
  clearTimeout(state.timer);
  state.trainingStatus = "stopping";
  render();
  state.timer = setTimeout(function () { state.trainingStatus = "cancelled"; render(); toast("演示停止核对完成，示例实例进入删除状态。"); }, 1600);
}
function streamReply(prompt) {
  state.chat.push({ role: "user", text: prompt });
  state.chat.push({ role: "assistant", text: "", streaming: true, partial: false });
  state.streaming = true;
  state.streamIndex = 0;
  render();
  const answer = "这是一条原型演示回复，用来展示多轮流式交互状态。真实回复必须来自已加载的微调 Adapter。";
  state.streamTimer = setInterval(function () {
    state.streamIndex += 2;
    const item = state.chat[state.chat.length - 1];
    item.text = answer.slice(0, state.streamIndex);
    const node = document.getElementById("streaming-output");
    if (node) node.textContent = item.text;
    if (state.streamIndex >= answer.length) { clearInterval(state.streamTimer); state.streaming = false; item.streaming = false; render(); }
  }, 65);
}
document.addEventListener("click", function (event) {
  const target = event.target.closest("[data-action]");
  if (!target) return;
  const action = target.dataset.action;
  if (target.disabled) return;
  if (action === "navigate") return navigate(target.dataset.page);
  if (action === "variant-prev" || action === "variant-next") {
    const keys = Object.keys(VARIANTS), index = keys.indexOf(state.variant), delta = action === "variant-next" ? 1 : -1;
    return setVariant(keys[(index + delta + keys.length) % keys.length]);
  }
  if (action === "variant-select") return setVariant(target.dataset.variant);
  if (action === "filter") { document.querySelectorAll(".context-filter").forEach(function (n) { n.classList.remove("is-active"); }); target.classList.add("is-active"); return; }
  if (action === "dataset-select") { state.datasetSelected = true; render(); return toast("选中演示文件；没有读取或上传本地文件。"); }
  if (action === "validate-dataset") { if (!state.datasetSelected) return toast("请先选择演示 JSONL。"); state.validated = true; render(); return toast(state.scenario === "dataset-invalid" ? "演示校验发现第 8 行错误。" : "演示校验通过；尚未连接真实服务。"); }
  if (action === "publish-dataset") {
    if (state.scenario === "dataset-invalid" || !state.validated) return toast("未通过校验，阻止发布。");
    state.published = true; render(); return toast("演示版本已发布。");
  }
  if (action === "demo-action") return toast("这是原型按钮，没有调用服务。");
  if (action === "model-source") { state.source = target.dataset.source; render(); return; }
  if (action === "start-import") { state.importDone = false; state.importState = "running"; render(); return toast(state.scenario === "import-interrupted" ? "演示导入中断；可按文件恢复。" : "演示导入已启动，没有实际传输文件。"); }
  if (action === "cancel-import") { clearTimeout(state.timer); state.importState = "cancelled"; state.importDone = false; render(); return; }
  if (action === "show-model-details") return toast("演示来源：公开仓库固定 revision / 优云基座指纹 / Attempt 01；文件路径与 SHA-256 由真实后端返回。");
  if (action === "delete-protected") return toast("拒绝删除：演示版本被 ft-2026-1042 引用。");
  if (action === "resume-import") { state.timer = setTimeout(function () { state.importDone = true; render(); toast("演示文件校验完成；不代表 MinIO 已写入。"); }, 900); return; }
  if (action === "refresh-catalog") return toast("演示目录已刷新；没有调用优云 API。");
  if (action === "select-resource") {
    if (state.scenario === "resource-empty" || state.scenario === "resource-incompatible") return toast("演示状态下没有可选的兼容资源。");
    state.selectedResource = "GPU Example A · 演示"; render(); return toast("已选择演示资源，没有创建云实例。");
  }
  if (action === "model-directory") return navigate("models");
  if (action === "retry-cleanup") { state.cleanupDone = true; state.trial = ""; render(); return toast("演示：重试确认实例已删除后释放租约。"); }
  if (action === "start-training") {
    const epochs = document.getElementById("epochs");
    const rate = document.getElementById("learning-rate");
    if (epochs && (!Number.isInteger(Number(epochs.value)) || Number(epochs.value) < 1 || Number(epochs.value) > 100) || rate && (Number(rate.value) < 0.0000001 || Number(rate.value) > 0.01)) { state.formError = "训练轮数须为 1–100 整数，学习率须在 0.0000001–0.01。"; render(); return; }
    state.formError = ""; return runTraining();
  }
  if (action === "cancel-training") return cancelTraining();
  if (action === "recover-sync") { state.syncRestored = true; render(); return toast("演示回传已恢复；未执行 MinIO 写入。"); }
  if (action === "choose-adapter") { if (state.trial) return; state.adapter = target.dataset.adapter; render(); return; }
  if (action === "start-trial") { state.trial = "ready"; state.chat = []; render(); return toast("演示 vLLM 已就绪；没有创建 GPU 实例。"); }
  if (action === "stop-generation") {
    if (!state.streaming) return;
    clearInterval(state.streamTimer); state.streaming = false;
    const item = state.chat[state.chat.length - 1]; item.streaming = false; item.partial = true;
    render(); return toast("演示生成已停止；实例仍保留。");
  }
  if (action === "clear-chat") { if (state.streaming) return; state.chat = []; render(); return; }
  if (action === "end-trial" || action === "idle-expire") {
    if (!state.trial || state.trial === "ending") return;
    stopStream(true); state.trial = "ending"; render();
    state.timer = setTimeout(function () {
      state.trial = state.scenario === "cleanup-failure" ? "cleanup-failed" : "";
      render(); toast(state.trial ? "演示删除失败；实例与租约状态保留。" : "演示试用已结束。");
    }, 1000);
  }
});
document.addEventListener("change", function (event) {
  if (event.target.id !== "scenario-select") return;
  stopStream(true); clearTimeout(state.timer);
  state.scenario = SCENARIOS.includes(event.target.value) ? event.target.value : "normal";
  state.validated = false; state.importDone = false; state.syncRestored = false;
  state.trainingStatus = state.scenario === "training-cancelled" ? "running" : "";
  state.trial = ""; state.chat = []; state.cleanupDone = false; state.formError = "";
  if (state.scenario === "dataset-invalid") state.published = false;
  const landing = { "dependency-failure": "workbench", "dataset-invalid": "datasets", "import-interrupted": "models", "resource-empty": "compute", "resource-incompatible": "compute", "training-cancelled": "training", "artifact-sync-failure": "training", "cleanup-failure": "inference" };
  if (landing[state.scenario]) state.page = landing[state.scenario];
  render();
});
document.addEventListener("submit", function (event) {
  if (event.target.id !== "chat-form") return;
  event.preventDefault();
  const prompt = event.target.elements.prompt.value.trim();
  if (!prompt || state.streaming || state.trial !== "ready") return;
  streamReply(prompt);
});
document.addEventListener("keydown", function (event) {
  if (event.target.matches("input, textarea, select, [contenteditable='true']")) return;
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
  event.preventDefault();
  const keys = Object.keys(VARIANTS), index = keys.indexOf(state.variant), delta = event.key === "ArrowRight" ? 1 : -1;
  setVariant(keys[(index + delta + keys.length) % keys.length]);
});
render();
