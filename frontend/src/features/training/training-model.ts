import type {
  LogChunk,
  TrainingAttemptSummary,
  TrainingMetric,
  TrainingRoute,
  TrainingTab,
} from './types';

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
  cleanup: {
    label: '回收实例',
    description: '训练结果已固定，正在等待进程退出、实例清理和租约释放。',
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
  manual_instance: '手动实例',
  inputs: '准备输入',
  training: '训练进程',
  logs: '补齐日志',
  artifacts: '同步产物',
  cleanup: '回收实例',
  finished: '已结束',
};

const errorDictionary: Record<string, string> = {
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

const activeStates = new Set(['queued', 'waiting_instance', 'preparing', 'running', 'syncing', 'cleanup']);
const terminalStates = new Set(['succeeded', 'failed', 'cancelled']);
const allowedTabs = new Set<TrainingTab>(['overview', 'analysis', 'logs', 'artifacts', 'config']);

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

export function trainingErrorDescription(code?: string | null) {
  if (!code) return '';
  return errorDictionary[code] ?? `服务返回错误代码 ${code}，请查看日志和运行证据。`;
}

export function isActiveAttempt(attempt: TrainingAttemptSummary) {
  return activeStates.has(attempt.state);
}

export function isTerminalAttempt(attempt: TrainingAttemptSummary) {
  return terminalStates.has(attempt.state);
}

export function needsAttention(attempt: TrainingAttemptSummary) {
  return (
    attempt.state === 'failed' ||
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

export function trainingLifecycle(attempt: TrainingAttemptSummary): LifecycleNode[] {
  const labels = ['排队', '实例准备', '训练', '产物', '回收'];
  const keys = ['queue', 'prepare', 'train', 'artifacts', 'cleanup'];
  let activeIndex = 0;
  if (attempt.state === 'waiting_instance' || attempt.state === 'preparing') activeIndex = 1;
  else if (attempt.state === 'running') activeIndex = 2;
  else if (attempt.state === 'syncing') activeIndex = 3;
  else if (attempt.state === 'cleanup') activeIndex = 4;
  if (attempt.state === 'succeeded') {
    return labels.map((label, index) => ({key: keys[index], label, status: 'done'}));
  }
  if (attempt.state === 'failed' || attempt.state === 'cancelled') {
    const terminalIndex = evidenceLifecycleIndex(attempt);
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
