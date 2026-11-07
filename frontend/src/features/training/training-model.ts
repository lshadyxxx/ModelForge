import type {
  LogChunk,
  TrainingAttemptSummary,
  TrainingConfig,
  TrainingExecutionMode,
  TrainingImageCatalog,
  TrainingImageProfile,
  TrainingMetric,
  TrainingRoute,
  TrainingTab,
} from './types';
import type {TrainingPayload} from './api';
import type {InstanceSpec} from '../resources';

export type TrainingTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

export type TrainingStateDescriptor = {
  label: string;
  description: string;
  tone: TrainingTone;
};

export type LifecycleStatus = 'pending' | 'active' | 'done' | 'failed' | 'cancelled';

export type LifecycleNode = {
  key: string;
  label: string;
  status: LifecycleStatus;
};

export type MetricPoint = {
  step: number;
  value: number;
};

export type NormalizedMetrics = {
  train: MetricPoint[];
  evaluation: MetricPoint[];
  learningRate: MetricPoint[];
  latestStep: number | null;
  latestTrainLoss: number | null;
  latestEvalLoss: number | null;
  latestLearningRate: number | null;
  bestEval: MetricPoint | null;
  latestEpoch: number | null;
};

export type LogLevel = 'error' | 'warn' | 'info' | 'debug' | 'other';

export type TrainingLogLine = {
  index: number;
  level: LogLevel;
  text: string;
};

const stateDictionary: Record<string, TrainingStateDescriptor> = {
  queued: {
    label: '排队',
    description: '任务已提交，等待 Worker 领取并建立训练租约。',
    tone: 'info',
  },
  provisioning: {
    label: '创建实例',
    description: '平台正在创建唯一托管实例，并在付费前重新核对库存和报价。',
    tone: 'info',
  },
  provisioning_unknown: {
    label: '云实例待核对',
    description: '创建请求的供应商结果尚未确认。平台会先对账，不会自动重复创建收费实例。',
    tone: 'warning',
  },
  cost_guard: {
    label: '费用守卫',
    description: '平台正在设置运行窗口、总额和小时报价上限，未通过时不会启动训练。',
    tone: 'info',
  },
  bootstrap: {
    label: '安全首启',
    description: '平台正在安装首启凭据并关闭密码登录；凭据不会进入页面或 API 响应。',
    tone: 'info',
  },
  runtime: {
    label: '运行环境预检',
    description: '平台正在核对 GPU、Python、CUDA 与固定训练运行时是否一致。',
    tone: 'info',
  },
  preflight: {
    label: '运行环境预检',
    description: '平台正在核对训练输入和运行时锁，未通过时不会启动训练。',
    tone: 'info',
  },
  training: {
    label: '训练中',
    description: '远程训练进程正在运行，指标和日志按当前接口轮询。',
    tone: 'success',
  },
  waiting_instance: {
    label: '等待实例',
    description: '需要在优云控制台创建符合冻结规格的实例，再回到平台关联。',
    tone: 'warning',
  },
  preparing: {
    label: '准备输入',
    description: '正在核对运行环境并传输数据集、基座和训练配置。',
    tone: 'info',
  },
  running: {
    label: '训练中',
    description: '远程训练进程正在运行，指标和日志按当前接口轮询。',
    tone: 'success',
  },
  syncing: {
    label: '同步产物',
    description: '训练进程已退出，正在回传产物并核对正式存储。',
    tone: 'info',
  },
  artifact_sync_failed: {
    label: '产物同步失败',
    description: '训练已经结束，但产物未通过存储回读校验；实例和租约仍会保留到安全回收。',
    tone: 'danger',
  },
  cleanup: {
    label: '回收实例',
    description: '训练结果已固定，正在等待进程退出、实例清理和租约释放。',
    tone: 'warning',
  },
  cleanup_pending: {
    label: '等待回收确认',
    description: '平台已请求停止或删除实例，但尚未取得供应商终态确认；租约不会被提前释放。',
    tone: 'warning',
  },
  succeeded: {
    label: '已成功',
    description: '训练和实例回收已结束；产物可用性仍需由 Adapter 接口独立确认。',
    tone: 'success',
  },
  failed: {
    label: '已失败',
    description: '本次 Attempt 已终止，保留错误代码、日志和诊断证据。',
    tone: 'danger',
  },
  cancelled: {
    label: '已取消',
    description: '本次 Attempt 已终止，不发布部分 Adapter。',
    tone: 'neutral',
  },
  blocked: {
    label: '等待处理',
    description: '当前条件不足，需先处理平台给出的阻塞原因。',
    tone: 'warning',
  },
};

const stageDictionary: Record<string, string> = {
  queue: '排队',
  provisioning: '创建云实例',
  provisioning_unknown: '核对云实例',
  cost_guard: '费用守卫',
  bootstrap: '安全首启',
  runtime: '运行环境预检',
  preflight: '运行环境预检',
  manual_instance: '手动实例',
  inputs: '准备输入',
  training: '训练进程',
  logs: '补齐日志',
  syncing: '同步产物',
  artifacts: '同步产物',
  artifact_sync_failed: '产物同步失败',
  cleanup: '回收实例',
  cleanup_pending: '等待回收确认',
  finished: '已结束',
};

const errorDictionary: Record<string, string> = {
  cloud_not_configured: '尚未配置优云凭据，平台不能创建托管训练实例。',
  cloud_write_disabled: '优云写入开关尚未启用，平台不会创建收费实例。',
  training_image_profile_required: '托管训练必须选择一个已批准的训练镜像 profile。',
  training_image_profile_unsupported: '所选训练镜像 profile 不存在，或与当前兼容基线不匹配。',
  training_image_profile_mismatch: '所选训练镜像与实例镜像不一致，请重新选择训练镜像 profile。',
  manual_image_profile_not_allowed: '手动实例不能声明平台托管的训练镜像 profile。',
  attempt_execution_mode_locked: 'Attempt 的执行方式在创建时已冻结，不能切换托管或手动模式。',
  base_region_mismatch: '外部基座模型与训练实例必须位于同一地域。',
  training_image_unavailable: '训练镜像当前不可用，平台不会继续创建实例。',
  budget_exceeded: '实例报价或窗口估算超过已授权费用上限，训练已停止。',
  cost_guard_unavailable: '费用守卫未设置成功，训练不会启动。',
  provisioning_conflict: '发现多个候选实例，平台无法确认唯一归属，已停止自动推进。',
  provisioning_unknown: '云实例创建结果未知，必须先对账，不能重复创建。',
  bootstrap_failed: '安全首启或凭据治理失败，训练不会启动。',
  runtime_preflight_failed: '运行环境与固定训练运行时不一致，训练不会启动。',
  training_failed: '训练进程以失败状态退出，请查看日志与诊断证据。',
  oom: 'GPU 显存不足，训练进程发生 OOM。',
  token_overflow: '存在超过最大 Token 的样本，训练在执行前被阻止。',
  runtime_incompatible: '实例运行时与训练基线不兼容。',
  gpu_runtime_incompatible: '实例运行时未通过训练兼容预检。',
  runtime_baseline_changed: '训练基线在提交前后发生变化。',
  runtime_model_unsupported: '当前模型不在受支持训练基线中。',
  runtime_hardware_unsupported: '当前 GPU 或实例规格不在受支持基线中。',
  cloud_invalid_response: '云供应商返回了无法核对的结果。',
  remote_process_unknown: '远程进程退出状态无法确认，实例将保留等待核对。',
  execution_evidence_missing: '执行证据不完整，实例将保留以恢复证据。',
  execution_sync_failed: '产物同步或回读校验失败。',
  attempt_active: '当前任务仍有未结束的 Attempt，不能创建重试。',
};

const activeStates = new Set([
  'queued',
  'provisioning',
  'cost_guard',
  'bootstrap',
  'runtime',
  'preflight',
  'training',
  'waiting_instance',
  'preparing',
  'running',
  'syncing',
  'cleanup',
]);
const unresolvedStates = [
  'provisioning_unknown',
  'blocked',
  'artifact_sync_failed',
  'cleanup_pending',
];
const terminalStates = new Set(['succeeded', 'failed', 'cancelled']);
const allowedTabs = new Set<TrainingTab>([
  'overview',
  'analysis',
  'diagnosis',
  'logs',
  'artifacts',
  'config',
]);

export function trainingState(value: string): TrainingStateDescriptor {
  return stateDictionary[value] ?? {
    label: value || '状态待确认',
    description: '接口返回了当前界面尚未识别的状态；请刷新后核对原始值。',
    tone: 'warning',
  };
}

export function trainingStage(value: string) {
  return stageDictionary[value] ?? value ?? '—';
}

export function normalizeExecutionMode(value?: string | null): TrainingExecutionMode {
  return value === 'managed' ? 'managed' : 'manual';
}

export function isManagedAttempt(attempt: TrainingAttemptSummary) {
  return normalizeExecutionMode(attempt.execution_mode) === 'managed'
    || Boolean(attempt.provisioning);
}

export function executionModeDescriptor(mode?: string | null) {
  return normalizeExecutionMode(mode) === 'managed'
    ? {
        label: '平台托管',
        shortLabel: '托管',
        description: '平台创建单台收费实例，完成费用守卫、安全首启、运行时预检、训练和回收。',
      }
    : {
        label: '手动实例',
        shortLabel: '手动',
        description: '你在优云控制台创建实例，再把实例身份关联到本 Attempt。',
      };
}

export function imageProfileStatus(profile: TrainingImageProfile) {
  if (profile.status === 'available') {
    return {label: '可使用', tone: 'success' as const, selectable: true};
  }
  if (profile.status === 'blocked') {
    return {label: '已阻止', tone: 'danger' as const, selectable: false};
  }
  return {label: '未发布', tone: 'warning' as const, selectable: false};
}

export function availableTrainingProfiles(catalog: TrainingImageCatalog | null) {
  return catalog?.profiles.filter((profile) => imageProfileStatus(profile).selectable) ?? [];
}

export function defaultTrainingImageProfile(catalog: TrainingImageCatalog | null) {
  const profiles = availableTrainingProfiles(catalog);
  return profiles.find((profile) => profile.runtime_source === 'prebuilt') ?? profiles[0] ?? null;
}

export function trainingImageProfileById(
  catalog: TrainingImageCatalog | null,
  identifier?: string | null,
) {
  if (!identifier) return null;
  return catalog?.profiles.find((profile) => profile.id === identifier) ?? null;
}

export function buildTrainingPayload(values: {
  name: string;
  datasetVersionId: string;
  baseModelVersionId: string;
  config: TrainingConfig;
  instance: InstanceSpec;
  executionMode: TrainingExecutionMode;
  trainingImageProfileId?: string | null;
}): TrainingPayload {
  const managed = values.executionMode === 'managed';
  return {
    name: values.name,
    dataset_version_id: values.datasetVersionId,
    base_model_version_id: values.baseModelVersionId,
    config: values.config,
    instance: values.instance,
    execution_mode: values.executionMode,
    ...(managed && values.trainingImageProfileId
      ? {training_image_profile_id: values.trainingImageProfileId}
      : {}),
  };
}

export function managedBudgetSummary(attempt?: TrainingAttemptSummary | null) {
  const deadline = attempt?.provisioning?.cost_guard_deadline;
  return {
    window: '最长 75 分钟',
    budget: '总额上限 5 CNY',
    hourly: '小时上限 3 CNY',
    deadline: deadline ? formatDateTime(deadline) : null,
  };
}

const provisioningLabels: Record<string, Record<string, string>> = {
  cost_guard_state: {
    pending: '待设置',
    set: '已设置',
    failed: '设置失败',
    cleared: '已解除',
  },
  credential_state: {
    pending: '待执行',
    key_installed: '公钥已安装',
    rotated: '密码已轮换',
    password_disabled: '密码已禁用',
    failed: '首启失败',
  },
  runtime_state: {
    pending: '待预检',
    probing: '预检中',
    preflight_ready: '预检通过',
    failed: '预检失败',
  },
  artifact_state: {
    pending: '未开始',
    uploading: '同步中',
    verified: '已校验',
    failed: '同步失败',
  },
};

export function provisioningStateLabel(kind: string, value?: string | null) {
  if (!value) return '等待执行';
  return provisioningLabels[kind]?.[value] ?? value;
}

export function trainingErrorDescription(code?: string | null) {
  if (!code) return '';
  return errorDictionary[code] ?? `服务返回错误代码 ${code}，请查看日志和运行证据。`;
}

export function isActiveAttempt(attempt: TrainingAttemptSummary) {
  return activeStates.has(attempt.state) || unresolvedStates.includes(attempt.state);
}

export function isTerminalAttempt(attempt: TrainingAttemptSummary) {
  return terminalStates.has(attempt.state);
}

export function needsAttention(attempt: TrainingAttemptSummary) {
  return (
    attempt.state === 'failed' ||
    unresolvedStates.includes(attempt.state) ||
    Boolean(attempt.error_code) ||
    (attempt.cancel_requested && !isTerminalAttempt(attempt))
  );
}

export function summarizeAttempts(attempts: TrainingAttemptSummary[]) {
  return {
    active: attempts.filter(isActiveAttempt).length,
    waiting: attempts.filter((attempt) => attempt.state === 'waiting_instance').length,
    succeeded: attempts.filter((attempt) => attempt.state === 'succeeded').length,
    attention: attempts.filter(needsAttention).length,
  };
}

function updatedTime(attempt: TrainingAttemptSummary) {
  const value = Date.parse(attempt.updated_at);
  return Number.isFinite(value) ? value : 0;
}

export function chooseCurrentAttempt(attempts: TrainingAttemptSummary[], selectedId = '') {
  if (selectedId) {
    const selected = attempts.find((attempt) => attempt.id === selectedId);
    if (selected) return selected;
  }
  return [...attempts].sort((left, right) => {
    const active = Number(isActiveAttempt(right)) - Number(isActiveAttempt(left));
    if (active !== 0) return active;
    return updatedTime(right) - updatedTime(left);
  })[0] ?? null;
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function seriesFor(metrics: TrainingMetric[], key: 'loss' | 'eval_loss' | 'learning_rate') {
  const points = new Map<number, MetricPoint>();
  metrics.forEach((metric) => {
    if (!finiteNumber(metric.step) || !finiteNumber(metric[key])) return;
    points.set(metric.step, {step: metric.step, value: metric[key]});
  });
  return [...points.values()].sort((left, right) => left.step - right.step);
}

export function normalizeMetrics(input?: TrainingMetric[] | null): NormalizedMetrics {
  const metrics = Array.isArray(input) ? input : [];
  const train = seriesFor(metrics, 'loss');
  const evaluation = seriesFor(metrics, 'eval_loss');
  const learningRate = seriesFor(metrics, 'learning_rate');
  let latestTrainLoss: number | null = null;
  let latestEvalLoss: number | null = null;
  let latestLearningRate: number | null = null;
  let latestStep: number | null = null;
  let latestEpoch: number | null = null;
  for (const metric of metrics) {
    if (finiteNumber(metric.step) && (latestStep === null || metric.step >= latestStep)) latestStep = metric.step;
    if (finiteNumber(metric.epoch) && (latestEpoch === null || metric.epoch >= latestEpoch)) latestEpoch = metric.epoch;
    if (finiteNumber(metric.loss)) latestTrainLoss = metric.loss;
    if (finiteNumber(metric.eval_loss)) latestEvalLoss = metric.eval_loss;
    if (finiteNumber(metric.learning_rate)) latestLearningRate = metric.learning_rate;
  }
  const bestEval = evaluation.length
    ? evaluation.reduce((best, point) => point.value < best.value ? point : best)
    : null;
  return {
    train,
    evaluation,
    learningRate,
    latestStep,
    latestTrainLoss,
    latestEvalLoss,
    latestLearningRate,
    latestEpoch,
    bestEval,
  };
}

function evidenceLifecycleIndex(attempt: TrainingAttemptSummary) {
  if (normalizeMetrics(attempt.metrics).train.length) return 2;
  if (attempt.runtime_report || attempt.token_preflight || attempt.execution_manifest?.files?.length) return 1;
  if (attempt.instance_id) return 1;
  return 0;
}

function managedActiveIndex(attempt: TrainingAttemptSummary) {
  if (attempt.state === 'running') return 3;
  if (attempt.state === 'syncing' || attempt.state === 'artifact_sync_failed') return 4;
  if (attempt.state === 'cleanup' || attempt.state === 'cleanup_pending') return 5;
  if (attempt.state === 'queued') return 0;
  if (attempt.stage === 'cost_guard') return 1;
  if (['bootstrap', 'runtime', 'preflight', 'inputs'].includes(attempt.stage)) return 2;
  if (attempt.stage === 'training') return 3;
  if (attempt.stage === 'artifacts') return 4;
  if (attempt.stage === 'cleanup') return 5;
  return 0;
}

function managedTerminalIndex(attempt: TrainingAttemptSummary) {
  if (attempt.state === 'cleanup' || attempt.state === 'cleanup_pending') return 5;
  if (attempt.execution_manifest?.files?.length) return 4;
  if (normalizeMetrics(attempt.metrics).train.length) return 3;
  if (attempt.stage === 'cost_guard') return 1;
  if (['bootstrap', 'runtime', 'preflight', 'inputs'].includes(attempt.stage)) return 2;
  if (attempt.stage === 'training') return 3;
  if (attempt.stage === 'artifacts') return 4;
  return 0;
}

export function trainingLifecycle(attempt: TrainingAttemptSummary): LifecycleNode[] {
  const managed = isManagedAttempt(attempt);
  const labels = managed
    ? ['创建实例', '费用守卫', '首启与运行时', '训练', '产物同步', '回收']
    : ['排队', '实例准备', '训练', '产物', '回收'];
  const keys = managed
    ? ['provision', 'guard', 'runtime', 'train', 'artifacts', 'cleanup']
    : ['queue', 'prepare', 'train', 'artifacts', 'cleanup'];
  let activeIndex = 0;
  if (managed) {
    activeIndex = managedActiveIndex(attempt);
  } else {
    if (attempt.state === 'waiting_instance' || attempt.state === 'preparing') activeIndex = 1;
    else if (attempt.state === 'running') activeIndex = 2;
    else if (attempt.state === 'syncing') activeIndex = 3;
    else if (attempt.state === 'cleanup') activeIndex = 4;
  }
  if (attempt.state === 'succeeded') {
    return labels.map((label, index) => ({key: keys[index], label, status: 'done'}));
  }
  if (attempt.state === 'failed' || attempt.state === 'cancelled') {
    const terminalIndex = managed ? managedTerminalIndex(attempt) : evidenceLifecycleIndex(attempt);
    return labels.map((label, index) => ({
      key: keys[index],
      label,
      status: index < terminalIndex
        ? 'done'
        : index === terminalIndex
          ? attempt.state === 'failed' ? 'failed' : 'cancelled'
          : 'pending',
    }));
  }
  return labels.map((label, index) => ({
    key: keys[index],
    label,
    status: index < activeIndex ? 'done' : index === activeIndex ? 'active' : 'pending',
  }));
}

export function lifecycleConclusion(attempt: TrainingAttemptSummary) {
  const nodes = trainingLifecycle(attempt);
  const terminal = [...nodes].reverse().find((node) => ['active', 'failed', 'cancelled'].includes(node.status));
  if (attempt.state === 'succeeded') return '全部阶段已完成';
  if (attempt.state === 'failed') return terminal ? `${terminal.label}阶段终止` : '训练失败';
  if (attempt.state === 'cancelled') return terminal ? `${terminal.label}阶段已取消` : '训练已取消';
  return terminal ? `当前在${terminal.label}阶段` : '等待阶段信息';
}

export function filterAttempts(attempts: TrainingAttemptSummary[], state: string, query: string) {
  const needle = query.trim().toLocaleLowerCase('zh-CN');
  return attempts.filter((attempt) => {
    if (state !== 'all') {
      if (state === 'active' && !isActiveAttempt(attempt)) return false;
      if (state === 'attention' && !needsAttention(attempt)) return false;
      if (!['active', 'attention'].includes(state) && attempt.state !== state) return false;
    }
    if (!needle) return true;
    return [attempt.name, attempt.id, attempt.instance_id ?? '', attempt.error_code ?? '']
      .join(' ')
      .toLocaleLowerCase('zh-CN')
      .includes(needle);
  });
}

export function logLevel(text: string): LogLevel {
  if (/\b(traceback|exception|error|failed|fatal)\b/i.test(text)) return 'error';
  if (/\b(warn|warning)\b/i.test(text)) return 'warn';
  if (/\b(info)\b/i.test(text)) return 'info';
  if (/\b(debug)\b/i.test(text)) return 'debug';
  return 'other';
}

export function parseLogLines(chunks: LogChunk[]): TrainingLogLine[] {
  const text = chunks.map((chunk) => chunk.content).join('').replace(/\r\n?/g, '\n');
  if (!text) return [];
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines.map((line, index) => ({
    index: index + 1,
    level: logLevel(line),
    text: line,
  }));
}

export function filterLogLines(lines: TrainingLogLine[], level: string, query: string) {
  const needle = query.trim().toLocaleLowerCase('zh-CN');
  return lines.filter((line) => {
    if (level !== 'all' && line.level !== level) return false;
    return !needle || line.text.toLocaleLowerCase('zh-CN').includes(needle);
  });
}

export function parseTrainingRoute(search: string): TrainingRoute {
  const params = new URLSearchParams(search);
  const tab = params.get('tab') as TrainingTab | null;
  return {
    legacy: params.get('training') === 'legacy',
    create: params.get('view') === 'create',
    attemptId: params.get('attempt')?.trim() ?? '',
    tab: tab && allowedTabs.has(tab) ? tab : 'overview',
  };
}

export function trainingRouteQuery(
  values: Partial<{legacy: boolean; create: boolean; attemptId: string; tab: TrainingTab}>,
) {
  const params = new URLSearchParams();
  if (values.legacy) params.set('training', 'legacy');
  if (values.create) params.set('view', 'create');
  if (values.attemptId) params.set('attempt', values.attemptId);
  if (values.attemptId && values.tab && values.tab !== 'overview') params.set('tab', values.tab);
  const query = params.toString();
  return query ? '?' + query : '';
}

export function formatMetric(value: number | null | undefined, digits = 4) {
  return finiteNumber(value) ? value.toFixed(digits) : '—';
}

export function formatLearningRate(value: number | null | undefined) {
  if (!finiteNumber(value)) return '—';
  if (value === 0) return '0';
  return value >= 0.001 ? value.toFixed(6) : value.toExponential(2);
}

export function formatEpoch(value: number | null | undefined) {
  return finiteNumber(value) ? value.toFixed(2) : '—';
}

export function formatDateTime(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '—';
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date);
}

export function formatBytes(value?: number | null) {
  if (!finiteNumber(value) || value < 0) return '—';
  if (value < 1024) return `${value} B`;
  const units = ['KiB', 'MiB', 'GiB', 'TiB'];
  let current = value / 1024;
  let index = 0;
  while (current >= 1024 && index < units.length - 1) {
    current /= 1024;
    index += 1;
  }
  return `${current.toFixed(current >= 100 ? 0 : current >= 10 ? 1 : 2)} ${units[index]}`;
}

export function shortId(value?: string | null, length = 8) {
  if (!value) return '—';
  return value.length <= length ? value : value.slice(0, length);
}

export function metricPointSummary(points: MetricPoint[]) {
  if (!points.length) return '无采样';
  const first = points[0];
  const last = points[points.length - 1];
  return `${points.length} 个采样 · step ${first.step}–${last.step}`;
}
