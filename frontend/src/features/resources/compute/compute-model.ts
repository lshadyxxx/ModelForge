export const providerLifecycleStatuses = [
  'creating',
  'running',
  'stopping',
  'stopped',
  'failed',
  'unavailable',
  'unknown',
] as const;

export type ProviderLifecycleStatus = (typeof providerLifecycleStatuses)[number];

export const leaseStates = ['unbound', 'held', 'releasing', 'released', 'review', 'unknown'] as const;
export type ComputeLeaseState = (typeof leaseStates)[number];

export const relationKinds = ['training', 'trial', 'none', 'unknown'] as const;
export type ComputeRelationKind = (typeof relationKinds)[number];

export const cleanupStates = ['not_requested', 'stopping', 'deleting', 'failed', 'confirmed', 'unknown'] as const;
export type ComputeCleanupState = (typeof cleanupStates)[number];

export const freshnessStates = ['fresh', 'stale', 'unconfirmed'] as const;
export type ComputeFreshness = (typeof freshnessStates)[number];

export const ownershipStates = ['platform', 'managed', 'unmanaged', 'unknown'] as const;
export type ComputeOwnership = (typeof ownershipStates)[number];

export type ComputeCompatibility = 'verified' | 'unverified' | 'unknown';
export type ComputeInventoryState = 'available_snapshot' | 'out_of_stock' | 'stale' | 'unknown';
export type ComputeManagement = 'environment' | 'workflow' | 'unmanaged' | 'unknown';
export type ComputeTone = 'neutral' | 'info' | 'positive' | 'caution' | 'critical';
export type ComputeStateIcon =
  | 'activity'
  | 'alert'
  | 'arrow-right'
  | 'bolt'
  | 'check'
  | 'clock'
  | 'cpu'
  | 'image'
  | 'lock'
  | 'pause'
  | 'play'
  | 'refresh'
  | 'server'
  | 'shield'
  | 'sliders'
  | 'trash'
  | 'wallet';

export type ComputeStateDescriptor = Readonly<{
  label: string;
  description: string;
  tone: ComputeTone;
  icon: ComputeStateIcon;
}>;

export const providerStatusDictionary: Readonly<Record<ProviderLifecycleStatus, ComputeStateDescriptor>> = {
  creating: {
    label: '创建中',
    description: '供应商正在准备实例，完成前不会推断实例已可连接。',
    tone: 'info',
    icon: 'refresh',
  },
  running: {
    label: '运行中',
    description: '供应商报告实例正在运行；仍需结合 GPU 租约与任务关联判断是否可执行。',
    tone: 'positive',
    icon: 'play',
  },
  stopping: {
    label: '停止中',
    description: '停止命令已受理，最终状态仍以再次刷新为准。',
    tone: 'caution',
    icon: 'pause',
  },
  stopped: {
    label: '已停止',
    description: '实例当前处于停止状态，是否可再次启动由供应商返回的操作能力决定。',
    tone: 'neutral',
    icon: 'shield',
  },
  failed: {
    label: '创建或运行失败',
    description: '供应商报告了失败状态，请查看事件与清理状态后再重试。',
    tone: 'critical',
    icon: 'alert',
  },
  unavailable: {
    label: '不可用',
    description: '实例不可用或无法观察到，不能将其视为可执行资源。',
    tone: 'critical',
    icon: 'alert',
  },
  unknown: {
    label: '状态待确认',
    description: '缺少可信状态或供应商返回了未识别值，请刷新后再操作。',
    tone: 'caution',
    icon: 'sliders',
  },
};

export const leaseStateDictionary: Readonly<Record<ComputeLeaseState, ComputeStateDescriptor>> = {
  unbound: {
    label: '租约未绑定',
    description: 'GPU 租约尚未绑定到供应商实例。',
    tone: 'neutral',
    icon: 'lock',
  },
  held: {
    label: '租约持有中',
    description: '平台记录该实例占用了 GPU 租约。',
    tone: 'positive',
    icon: 'shield',
  },
  releasing: {
    label: '租约释放中',
    description: '释放流程尚未完成，请等待刷新确认。',
    tone: 'caution',
    icon: 'refresh',
  },
  released: {
    label: '租约已释放',
    description: '平台记录 GPU 租约已经释放。',
    tone: 'neutral',
    icon: 'check',
  },
  review: {
    label: '租约待核对',
    description: '租约事实存在冲突或证据不足，应停止创建和危险操作并人工核对。',
    tone: 'critical',
    icon: 'alert',
  },
  unknown: {
    label: '租约未知',
    description: '没有可信的租约快照，不能推断资源已被占用或已释放。',
    tone: 'caution',
    icon: 'sliders',
  },
};

export const relationDictionary: Readonly<Record<ComputeRelationKind, ComputeStateDescriptor>> = {
  training: {
    label: '训练任务',
    description: '该环境关联到一次训练尝试。',
    tone: 'info',
    icon: 'arrow-right',
  },
  trial: {
    label: '推理试用',
    description: '该环境关联到一次推理试用。',
    tone: 'info',
    icon: 'arrow-right',
  },
  none: {
    label: '未关联任务',
    description: '该环境当前没有任务关联记录。',
    tone: 'neutral',
    icon: 'server',
  },
  unknown: {
    label: '关联待确认',
    description: '缺少任务关联证据，不能据此释放实例或结束任务。',
    tone: 'caution',
    icon: 'sliders',
  },
};

export const cleanupStateDictionary: Readonly<Record<ComputeCleanupState, ComputeStateDescriptor>> = {
  not_requested: {
    label: '未请求清理',
    description: '尚未发起停止或删除清理。',
    tone: 'neutral',
    icon: 'clock',
  },
  stopping: {
    label: '停止清理中',
    description: '停止流程已开始，需刷新确认供应商实例状态。',
    tone: 'caution',
    icon: 'pause',
  },
  deleting: {
    label: '删除确认中',
    description: '删除已受理，完成前不得视为已释放。',
    tone: 'caution',
    icon: 'trash',
  },
  failed: {
    label: '清理失败',
    description: '清理未完成，请根据错误代码排查并保留现有证据。',
    tone: 'critical',
    icon: 'alert',
  },
  confirmed: {
    label: '清理已确认',
    description: '供应商删除结果已确认，平台记录清理完成。',
    tone: 'positive',
    icon: 'check',
  },
  unknown: {
    label: '清理状态待确认',
    description: '缺少清理记录，不能把停止操作视为删除完成。',
    tone: 'caution',
    icon: 'sliders',
  },
};

export const freshnessDictionary: Readonly<Record<ComputeFreshness, ComputeStateDescriptor>> = {
  fresh: {
    label: '刚刷新',
    description: '最近一次状态读取仍在声明的新鲜窗口内。',
    tone: 'positive',
    icon: 'clock',
  },
  stale: {
    label: '数据已过期',
    description: '状态快照已过期，执行写操作前应先刷新。',
    tone: 'caution',
    icon: 'clock',
  },
  unconfirmed: {
    label: '新鲜度未确认',
    description: '响应未提供可信的新鲜度，不能把快照当作实时状态。',
    tone: 'caution',
    icon: 'sliders',
  },
};

export const ownershipDictionary: Readonly<Record<ComputeOwnership, ComputeStateDescriptor>> = {
  platform: {
    label: '平台环境',
    description: '由当前平台目录或聚合接口托管的标准环境。',
    tone: 'info',
    icon: 'server',
  },
  managed: {
    label: '已纳管',
    description: '平台拥有该环境的受控操作与生命周期记录。',
    tone: 'positive',
    icon: 'shield',
  },
  unmanaged: {
    label: '未纳管',
    description: '该环境没有完整的平台生命周期记录，不自动开放启动、停止或删除。',
    tone: 'caution',
    icon: 'alert',
  },
  unknown: {
    label: '归属待确认',
    description: '缺少资源归属证据，不自动开放危险操作。',
    tone: 'caution',
    icon: 'sliders',
  },
};

export const compatibilityDictionary: Readonly<Record<ComputeCompatibility, ComputeStateDescriptor>> = {
  verified: {
    label: '兼容性已验证',
    description: '存在针对该配置的兼容性验证证据。',
    tone: 'positive',
    icon: 'check',
  },
  unverified: {
    label: '兼容性未验证',
    description: '目录可见不代表镜像、规格与平台兼容，创建前仍需后端精确校验。',
    tone: 'caution',
    icon: 'sliders',
  },
  unknown: {
    label: '兼容性未知',
    description: '没有兼容性证据。',
    tone: 'caution',
    icon: 'sliders',
  },
};

export const inventoryStateDictionary: Readonly<Record<ComputeInventoryState, ComputeStateDescriptor>> = {
  available_snapshot: {
    label: '目录快照显示有资源',
    description: '这是查询时的目录快照，不构成库存预留，也不证明规格兼容。',
    tone: 'info',
    icon: 'server',
  },
  out_of_stock: {
    label: '目录快照显示无资源',
    description: '查询时未找到足够的资源，实际结果仍以后端精确校验为准。',
    tone: 'caution',
    icon: 'alert',
  },
  stale: {
    label: '库存快照已过期',
    description: '库存查询结果已经过期，请重新查询。',
    tone: 'caution',
    icon: 'clock',
  },
  unknown: {
    label: '库存未知',
    description: '没有可用的库存快照，不能推断有货或无货。',
    tone: 'neutral',
    icon: 'sliders',
  },
};

export type ComputeQuoteBreakdown = Readonly<{
  instance: number;
  systemDisks: number;
  dataDisks: number;
  image: number;
}>;

export type ComputeQuote = Readonly<{
  state: 'available' | 'unavailable';
  code: string;
  label: string;
  description: string;
  currency: 'CNY' | null;
  hourly: number | null;
  amount: number | null;
  unit: 'hour' | 'day' | 'month' | null;
  estimatedTotal: number | null;
  chargedAt: string | null;
  chargeType: string | null;
  breakdown: ComputeQuoteBreakdown | null;
  originalAmount: number | null;
  discountType: number | null;
  errorCode: string | null;
}>;

export function unavailableQuote(
  description = '未取得可验证的官方报价，无法推断金额。',
  errorCode: string | null = null,
): ComputeQuote {
  return {
    state: 'unavailable',
    code: 'quote_unavailable',
    label: '报价不可用',
    description,
    currency: null,
    hourly: null,
    amount: null,
    unit: null,
    estimatedTotal: null,
    chargedAt: null,
    chargeType: null,
    breakdown: null,
    originalAmount: null,
    discountType: null,
    errorCode,
  };
}

export type ComputeMonitorMetric = Readonly<{
  key: string;
  label: string;
  value: number | string;
  unit: string | null;
  max: number | null;
}>;

export type ComputeMonitor = Readonly<{
  provider: 'ucloud' | 'unavailable';
  checkedAt: string | null;
  metrics: ComputeMonitorMetric[];
  errorCode: string | null;
}>;

export type ComputeEventSource = 'lease' | 'observation' | 'unknown';

export type ComputeEnvironmentEvent = Readonly<{
  id: string | null;
  action: string;
  label: string;
  recordedAt: string | null;
  source: ComputeEventSource;
}>;

export type ComputeEnvironmentSpec = Readonly<{
  region: string | null;
  zone: string | null;
  gpuType: string | null;
  cpu: number | null;
  memoryMb: number | null;
  imageId: string | null;
  imageName: string | null;
  cpuPlatform: string | null;
  chargeType: string | null;
  bootDiskGb: number | null;
  bootDiskType: string | null;
}>;

export type ComputeEnvironmentLease = Readonly<{
  reservationId: string | null;
  state: ComputeLeaseState;
  ownerKind: 'training' | 'trial' | 'unknown';
  ownerId: string | null;
  events: ComputeEnvironmentEvent[];
}>;

export type ComputeEnvironmentRelation = Readonly<{
  kind: ComputeRelationKind;
  id: string | null;
  label: string | null;
  state: string | null;
  active: boolean;
}>;

export type ComputeEnvironmentCleanup = Readonly<{
  state: ComputeCleanupState;
  errorCode: string | null;
}>;

export type ComputeEnvironmentInventory = Readonly<{
  state: ComputeInventoryState;
  checkedAt: string | null;
  source: 'catalog_snapshot' | 'unknown';
}>;

export type ComputeAction = 'start' | 'stop' | 'delete';

export type ComputeEnvironment = Readonly<{
  id: string;
  name: string;
  resourceOwner: string | null;
  providerInstanceId: string | null;
  providerState: string | null;
  status: ProviderLifecycleStatus;
  spec: ComputeEnvironmentSpec;
  lease: ComputeEnvironmentLease;
  relation: ComputeEnvironmentRelation;
  cleanup: ComputeEnvironmentCleanup;
  monitor: ComputeMonitor;
  management: ComputeManagement;
  ownership: ComputeOwnership;
  freshness: ComputeFreshness;
  freshnessObservedAt: string | null;
  compatibility: ComputeCompatibility;
  inventory: ComputeEnvironmentInventory;
  quote: ComputeQuote;
  actions: ComputeAction[];
  events: ComputeEnvironmentEvent[];
  createdAt: string | null;
  updatedAt: string | null;
  identityAvailable: boolean;
  warnings: string[];
}>;

export type ComputeEnvironmentCollection = Readonly<{
  items: ComputeEnvironment[];
  total: number;
  fetchedAt: string | null;
  source: string;
  sourceState: 'ready' | 'stale' | 'unavailable' | 'unknown';
  degraded: boolean;
  warnings: string[];
}>;

export type ComputeConfiguration = Readonly<{
  configured: boolean;
  defaultRegion: string | null;
  mode: 'read_only' | 'read_write' | 'unknown';
  writeEnabled: boolean;
  reason: string | null;
  warnings: string[];
}>;

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : {};
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function nonNegativeInteger(value: unknown): number | null {
  const parsed = finiteNumber(value);
  return parsed !== null && Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function dateText(value: unknown): string | null {
  const candidate = text(value);
  return candidate && Number.isFinite(Date.parse(candidate)) ? candidate : null;
}

function mergedWarnings(...groups: unknown[][]): string[] {
  const result: string[] = [];
  for (const group of groups) {
    for (const item of group) {
      const warning = text(item);
      if (warning && !result.includes(warning)) result.push(warning);
    }
  }
  return result;
}

function normalizedToken(value: unknown): string {
  return text(value)?.toLowerCase().replace(/[\s-]+/g, '_').trim() ?? '';
}

const providerStatusAliases: Readonly<Record<string, ProviderLifecycleStatus>> = {
  creating: 'creating',
  starting: 'creating',
  booting: 'creating',
  initializing: 'creating',
  pending: 'creating',
  running: 'running',
  started: 'running',
  active: 'running',
  stopping: 'stopping',
  shutting_down: 'stopping',
  stopped: 'stopped',
  shutdown: 'stopped',
  terminating: 'stopping',
  deleting: 'stopping',
  cleanup_failed: 'failed',
  deleted: 'unavailable',
  failed: 'failed',
  error: 'failed',
  unavailable: 'unavailable',
  offline: 'unavailable',
  unknown: 'unknown',
};

export function normalizeProviderStatus(value: unknown): ProviderLifecycleStatus {
  return providerStatusAliases[normalizedToken(value)] ?? 'unknown';
}

const leaseStateAliases: Readonly<Record<string, ComputeLeaseState>> = {
  unbound: 'unbound',
  held: 'held',
  active: 'held',
  releasing: 'releasing',
  released: 'released',
  review: 'review',
  needs_review: 'review',
  unknown: 'unknown',
};

export function normalizeLeaseState(value: unknown): ComputeLeaseState {
  return leaseStateAliases[normalizedToken(value)] ?? 'unknown';
}

export function normalizeRelationKind(value: unknown): ComputeRelationKind {
  const token = normalizedToken(value);
  return token === 'training' || token === 'trial' || token === 'none'
    ? token
    : 'unknown';
}

export function normalizeCleanupState(value: unknown): ComputeCleanupState {
  const token = normalizedToken(value);
  if (token === 'cleanup_failed') return 'failed';
  if (token === 'deleted') return 'confirmed';
  return token === 'not_requested' || token === 'stopping' || token === 'deleting'
    || token === 'failed' || token === 'confirmed'
    ? token
    : 'unknown';
}

export function normalizeFreshness(value: unknown): ComputeFreshness {
  const token = normalizedToken(asRecord(value).state ?? value);
  return token === 'fresh' || token === 'stale' || token === 'unconfirmed'
    ? token
    : 'unconfirmed';
}

export function normalizeOwnership(value: unknown): ComputeOwnership {
  const token = normalizedToken(value);
  return token === 'platform' || token === 'managed' || token === 'unmanaged'
    ? token
    : 'unknown';
}

export function normalizeManagement(value: unknown): ComputeManagement {
  const token = normalizedToken(value);
  return token === 'environment' || token === 'workflow' || token === 'unmanaged'
    ? token
    : 'unknown';
}

export function normalizeCompatibility(value: unknown): ComputeCompatibility {
  const token = normalizedToken(value);
  return token === 'verified' || token === 'unknown' ? token : 'unverified';
}

export function normalizeInventoryState(value: unknown): ComputeInventoryState {
  const token = normalizedToken(value);
  return token === 'available_snapshot' || token === 'out_of_stock' || token === 'stale'
    ? token
    : 'unknown';
}

function normalizeSpec(raw: unknown): ComputeEnvironmentSpec {
  const spec = asRecord(raw);
  return {
    region: text(spec.region),
    zone: text(spec.zone),
    gpuType: text(spec.gpu_type),
    cpu: finiteNumber(spec.cpu),
    memoryMb: finiteNumber(spec.memory_mb),
    imageId: text(spec.image_id),
    imageName: text(spec.image_name),
    cpuPlatform: text(spec.cpu_platform),
    chargeType: text(spec.charge_type),
    bootDiskGb: finiteNumber(spec.boot_disk_gb),
    bootDiskType: text(spec.boot_disk_type),
  };
}

function normalizeEvents(
  raw: unknown,
  defaultSource: ComputeEventSource,
  warnings: string[],
): ComputeEnvironmentEvent[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    warnings.push('事件字段格式无效，已忽略。');
    return [];
  }
  const events: ComputeEnvironmentEvent[] = [];
  let invalid = 0;
  for (const value of raw) {
    const event = asRecord(value);
    const action = text(event.action) ?? text(event.label);
    const label = text(event.label) ?? action;
    if (!action || !label) {
      invalid += 1;
      continue;
    }
    const sourceToken = normalizedToken(event.source);
    const source: ComputeEventSource = sourceToken === 'lease'
      ? 'lease'
      : sourceToken === 'observation' || sourceToken === 'platform' || sourceToken === 'provider'
        ? 'observation'
        : defaultSource;
    events.push({
      id: text(event.id),
      action,
      label,
      recordedAt: dateText(event.recorded_at ?? event.recordedAt),
      source,
    });
  }
  if (invalid) warnings.push(`${invalid} 条事件缺少必要字段，已忽略。`);
  return events;
}

function normalizeMonitor(raw: unknown): ComputeMonitor {
  const monitor = asRecord(raw);
  const metrics: ComputeMonitorMetric[] = [];
  const metricSources = Array.isArray(monitor.metrics)
    ? monitor.metrics
    : Array.isArray(monitor.items)
      ? monitor.items.flatMap((item) => {
        const metricsValue = asRecord(item).Metrics;
        return Array.isArray(metricsValue) ? metricsValue : [];
      })
      : [];
  if (metricSources.length) {
    for (const value of metricSources) {
      const metric = asRecord(value);
      const key = text(metric.key ?? metric.MetricKey);
      if (!key) continue;
      let metricValue = typeof metric.value === 'string' ? text(metric.value) : finiteNumber(metric.value);
      if (metricValue === null && Array.isArray(metric.Results)) {
        for (const series of metric.Results) {
          const values = asRecord(series).Values;
          if (!Array.isArray(values) || values.length === 0) continue;
          metricValue = finiteNumber(asRecord(values.at(-1)).Value);
          if (metricValue !== null) break;
        }
      }
      if (metricValue === null) continue;
      metrics.push({
        key,
        label: text(metric.label ?? metric.Label ?? metric.Name) ?? key,
        value: metricValue,
        unit: text(metric.unit) ?? null,
        max: finiteNumber(metric.max),
      });
    }
  }
  const monitorState = normalizedToken(monitor.state);
  const providerAvailable = normalizedToken(monitor.provider) === 'ucloud'
    || monitorState === 'ready'
    || monitorState === 'empty'
    || Array.isArray(monitor.items);
  return {
    provider: providerAvailable && monitorState !== 'unavailable' ? 'ucloud' : 'unavailable',
    checkedAt: dateText(monitor.checked_at ?? monitor.checkedAt ?? monitor.fetched_at),
    metrics,
    errorCode: text(monitor.error_code ?? monitor.errorCode),
  };
}

function normalizeInventory(raw: unknown): ComputeEnvironmentInventory {
  const inventory = asRecord(raw);
  const state = normalizeInventoryState(inventory.state ?? raw);
  return {
    state,
    checkedAt: dateText(inventory.checked_at ?? inventory.checkedAt),
    source: state === 'unknown' ? 'unknown' : 'catalog_snapshot',
  };
}

export function normalizeQuote(raw: unknown): ComputeQuote {
  const quote = asRecord(raw);
  if (normalizedToken(quote.state) !== 'available') {
    return unavailableQuote(
      text(quote.description) ?? undefined,
      text(quote.error_code ?? quote.errorCode),
    );
  }
  const amount = finiteNumber(quote.amount);
  const hourly = finiteNumber(quote.hourly);
  const rawBreakdown = asRecord(quote.breakdown);
  const breakdown =
    Object.keys(rawBreakdown).length
      ? {
        instance: finiteNumber(rawBreakdown.instance) ?? 0,
        systemDisks: finiteNumber(rawBreakdown.system_disks) ?? 0,
        dataDisks: finiteNumber(rawBreakdown.data_disks) ?? 0,
        image: finiteNumber(rawBreakdown.image) ?? 0,
      }
      : null;
  if (amount === null || amount < 0 || hourly !== null && hourly < 0) {
    return unavailableQuote(
      '官方报价字段无效，已停止费用展示。',
      'quote_invalid',
    );
  }
  const unitToken = normalizedToken(quote.unit);
  const unit =
    unitToken === 'hour' || unitToken === 'day' || unitToken === 'month'
      ? unitToken
      : null;
  return {
    state: 'available',
    code: text(quote.code) ?? 'quote_observed',
    label: text(quote.label) ?? '官方报价',
    description:
      text(quote.description)
      ?? '官方折后价格；仅代表当前报价快照，最终账单以供应商为准。',
    currency: text(quote.currency) === 'CNY' ? 'CNY' : null,
    hourly,
    amount,
    unit,
    estimatedTotal: hourly,
    chargedAt: dateText(quote.observed_at ?? quote.observedAt),
    chargeType: text(quote.charge_type ?? quote.chargeType),
    breakdown,
    originalAmount: finiteNumber(
      quote.original_amount ?? quote.originalAmount,
    ),
    discountType: finiteNumber(
      quote.discount_type ?? quote.discountType,
    ),
    errorCode: null,
  };
}

function normalizeLease(
  raw: unknown,
  warnings: string[],
  fallbackReservationId: string | null = null,
): ComputeEnvironmentLease {
  const lease = asRecord(raw);
  const ownerToken = normalizedToken(lease.owner_kind ?? lease.ownerKind);
  const ownerKind = ownerToken === 'attempt' || ownerToken === 'training'
    ? 'training'
    : ownerToken === 'trial'
      ? 'trial'
      : 'unknown';
  return {
    reservationId: text(lease.reservation_id ?? lease.reservationId ?? lease.id) ?? fallbackReservationId,
    state: normalizeLeaseState(lease.state),
    ownerKind,
    ownerId: text(lease.owner_id ?? lease.ownerId),
    events: normalizeEvents(lease.events, 'lease', warnings),
  };
}

function normalizeRelation(raw: unknown, associations: unknown): ComputeEnvironmentRelation {
  let relation = asRecord(raw);
  if (!text(relation.kind) && Array.isArray(associations) && associations.length) {
    const candidates = associations.map(asRecord);
    relation = candidates.find((item) => item.active === true) ?? candidates[0];
  }
  const relationToken = normalizedToken(relation.kind);
  return {
    kind: normalizeRelationKind(relationToken === 'inference' ? 'trial' : relationToken),
    id: text(relation.id),
    label: text(relation.label),
    state: text(relation.state),
    active: relation.active === true,
  };
}

function normalizeActions(
  rawActions: unknown,
  rawCapabilities: unknown,
  ownership: ComputeOwnership,
  options: {idAvailable: boolean; nameAvailable: boolean},
  warnings: string[],
): ComputeAction[] {
  const capabilities = asRecord(rawCapabilities);
  const raw = Array.isArray(rawActions)
    ? rawActions
    : Object.keys(capabilities).length
      ? [
        ...(capabilities.start === true ? ['start'] : []),
        ...(capabilities.stop === true ? ['stop'] : []),
        ...(capabilities.delete === true ? ['delete'] : []),
      ]
      : [];
  if (!raw.length) return [];
  const actions = new Set<ComputeAction>();
  let ignored = 0;
  for (const value of raw) {
    const token = normalizedToken(value);
    if (token === 'start' || token === 'stop' || token === 'delete') actions.add(token);
    else ignored += 1;
  }
  if (ignored) warnings.push(`${ignored} 个未识别的操作已忽略。`);
  if (ownership === 'unmanaged' || ownership === 'unknown') {
    if (actions.size) warnings.push('资源未纳管或归属待确认，写操作已关闭。');
    return [];
  }
  if (!options.idAvailable) {
    actions.delete('start');
    actions.delete('stop');
    actions.delete('delete');
  }
  if (!options.nameAvailable) actions.delete('delete');
  return [...actions];
}

export function normalizeEnvironment(raw: unknown, fallbackIndex = 0): ComputeEnvironment {
  const source = asRecord(raw);
  const warnings: string[] = [];
  if (Object.keys(source).length === 0) warnings.push('计算环境记录不是有效对象，已按待确认数据展示。');

  const id = text(source.id) ?? '';
  if (!id) warnings.push('记录缺少环境 ID，已关闭写操作。');
  const rawName = text(source.name);
  if (!rawName) warnings.push('记录缺少名称，已使用占位名称。');
  const name = rawName ?? `未命名环境 ${fallbackIndex + 1}`;

  const rawStatus = source.status ?? source.state ?? source.State;
  const statusToken = normalizedToken(rawStatus);
  const status = normalizeProviderStatus(rawStatus);
  if (status === 'unknown' || !text(rawStatus)) warnings.push('供应商生命周期状态未知，已按待确认处理。');

  const lease = normalizeLease(
    source.lease,
    warnings,
    text(source.lease_id ?? source.leaseId),
  );
  if (lease.state === 'unknown') warnings.push('GPU 租约状态未知。');

  const management = normalizeManagement(source.management);
  const ownership = text(source.ownership)
    ? normalizeOwnership(source.ownership)
    : management === 'unmanaged' || source.managed === false
      ? 'unmanaged'
      : management === 'environment'
        ? 'managed'
        : management === 'workflow'
          ? 'platform'
          : source.managed === true
            ? 'managed'
            : 'unknown';
  if (ownership === 'unknown') warnings.push('资源归属未知，未自动开放写操作。');
  const freshness = normalizeFreshness(source.freshness);
  if (freshness === 'unconfirmed') warnings.push('快照新鲜度未确认。');
  const freshnessObservedAt = dateText(asRecord(source.freshness).observed_at);

  const specRecord = asRecord(source.spec);
  const spec = normalizeSpec(specRecord);
  if (Object.keys(specRecord).length === 0) warnings.push('规格字段缺失，已按未知展示。');

  const cleanupRecord = asRecord(source.cleanup);
  const relationRecord = asRecord(source.relation);
  const inventoryRecord = asRecord(source.inventory);
  let cleanupState = normalizeCleanupState(cleanupRecord.state);
  if (cleanupState === 'unknown') {
    if (statusToken === 'deleting') cleanupState = 'deleting';
    else if (statusToken === 'deleted') cleanupState = 'confirmed';
    else if (statusToken === 'cleanup_failed') cleanupState = 'failed';
  }
  const cleanupError = text(cleanupRecord.error_code ?? cleanupRecord.errorCode)
    ?? (cleanupState === 'failed' ? text(source.last_error_code ?? source.lastErrorCode) : null);
  const actions = normalizeActions(source.actions, source.capabilities, ownership, {
    idAvailable: Boolean(id),
    nameAvailable: Boolean(rawName),
  }, warnings);

  return {
    id,
    name,
    resourceOwner: text(source.resource_owner ?? source.resourceOwner),
    providerInstanceId: text(source.provider_instance_id ?? source.providerInstanceId),
    providerState: text(source.provider_state ?? source.providerState),
    status,
    spec,
    lease,
    relation: normalizeRelation(relationRecord, source.associations),
    cleanup: {
      state: cleanupState,
      errorCode: cleanupError,
    },
    monitor: normalizeMonitor(source.monitor),
    management,
    ownership,
    freshness,
    freshnessObservedAt,
    compatibility: normalizeCompatibility(source.compatibility ?? specRecord.compatibility),
    inventory: normalizeInventory(inventoryRecord.state ? inventoryRecord : source.inventory),
    quote: normalizeQuote(source.pricing ?? source.quote),
    actions,
    events: normalizeEvents(source.events, 'observation', warnings),
    createdAt: dateText(source.created_at ?? source.createdAt),
    updatedAt: dateText(source.updated_at ?? source.updatedAt),
    identityAvailable: Boolean(id),
    warnings: mergedWarnings(warnings, Array.isArray(source.warnings) ? source.warnings : []),
  };
}

export function normalizeEnvironmentCollection(raw: unknown): ComputeEnvironmentCollection {
  const source = asRecord(raw);
  const warnings: string[] = [];
  const rawItems = Array.isArray(source.items) ? source.items : [];
  if (!Array.isArray(source.items)) warnings.push('环境列表响应缺少 items，已按空列表处理。');

  const items: ComputeEnvironment[] = [];
  for (let index = 0; index < rawItems.length; index += 1) {
    const rawItem = rawItems[index];
    if (Object.keys(asRecord(rawItem)).length === 0) {
      warnings.push(`第 ${index + 1} 条环境记录格式无效，已忽略。`);
      continue;
    }
    items.push(normalizeEnvironment(rawItem, index));
  }

  const summary = asRecord(source.summary);
  const sourceMetadata = asRecord(source.source);
  const sourceErrors = Array.isArray(sourceMetadata.errors) ? sourceMetadata.errors : [];
  const providedTotal = nonNegativeInteger(source.total) ?? nonNegativeInteger(summary.total);
  const total = providedTotal === null ? items.length : Math.max(providedTotal, items.length);
  if (providedTotal === null) warnings.push('环境总数缺失，已使用当前列表长度。');

  const fetchedAt = dateText(
    source.fetched_at
    ?? source.fetchedAt
    ?? source.observed_at
    ?? sourceMetadata.fetched_at,
  );
  if (!fetchedAt) warnings.push('环境列表缺少可信抓取时间。');
  for (const value of sourceErrors) {
    const error = asRecord(value);
    const message = text(error.message) ?? text(error.code);
    if (message) warnings.push(message);
  }
  const sourceState = normalizedToken(sourceMetadata.state);
  const normalizedSourceState = sourceState === 'ready' || sourceState === 'stale' || sourceState === 'unavailable'
    ? sourceState
    : 'unknown';

  return {
    items,
    total,
    fetchedAt,
    source: text(source.source) ?? 'aggregate',
    sourceState: normalizedSourceState,
    degraded: source.degraded === true
      || sourceMetadata.state === 'stale'
      || sourceMetadata.state === 'unavailable'
      || sourceState === 'stale'
      || sourceState === 'unavailable'
      || sourceErrors.length > 0,
    warnings: mergedWarnings(warnings, Array.isArray(source.warnings) ? source.warnings : []),
  };
}

export function normalizeConfiguration(raw: unknown): ComputeConfiguration {
  const source = asRecord(raw);
  const warnings: string[] = [];
  const configured = source.configured === true;
  if (typeof source.configured !== 'boolean') warnings.push('响应未提供可信的配置状态，已按未配置处理。');

  const modeToken = normalizedToken(source.mode);
  const mode = modeToken === 'read_only' || modeToken === 'read_write'
    ? modeToken
    : 'unknown';
  if (mode === 'unknown') warnings.push('供应商配置模式未知，已按只读处理。');

  const requestedWrite = source.write_enabled === true;
  if (typeof source.write_enabled !== 'boolean') warnings.push('响应未提供写权限字段，已按只读处理。');
  if (requestedWrite && mode !== 'read_write') warnings.push('写权限与配置模式冲突，已按只读处理。');

  return {
    configured,
    defaultRegion: text(source.default_region ?? source.defaultRegion),
    mode,
    writeEnabled: requestedWrite && mode === 'read_write',
    reason: text(source.reason),
    warnings,
  };
}

export type ComputeEnvironmentFilters = Readonly<{
  query?: string;
  regions?: readonly string[];
  zones?: readonly string[];
  gpuTypes?: readonly string[];
  cpuPlatforms?: readonly string[];
  imageIds?: readonly string[];
  statuses?: readonly ProviderLifecycleStatus[];
  leaseStates?: readonly ComputeLeaseState[];
  relationKinds?: readonly ComputeRelationKind[];
  cleanupStates?: readonly ComputeCleanupState[];
  ownerships?: readonly ComputeOwnership[];
  freshnessStates?: readonly ComputeFreshness[];
  inventoryStates?: readonly ComputeInventoryState[];
  minCpu?: number;
  maxCpu?: number;
  minMemoryMb?: number;
  maxMemoryMb?: number;
  attentionOnly?: boolean;
}>;

function selected<T extends string>(value: string | null, choices: readonly T[] | undefined): boolean {
  return !choices?.length || (value !== null && (choices as readonly string[]).includes(value));
}

export function matchesEnvironmentFilters(
  environment: ComputeEnvironment,
  filters: ComputeEnvironmentFilters = {},
): boolean {
  const search = filters.query?.trim().toLocaleLowerCase();
  if (search) {
    const haystack = [
      environment.id,
      environment.name,
      environment.providerInstanceId,
      environment.spec.region,
      environment.spec.zone,
      environment.spec.gpuType,
      environment.spec.cpuPlatform,
      environment.spec.imageId,
      environment.spec.imageName,
    ].filter((value): value is string => Boolean(value)).join(' ').toLocaleLowerCase();
    if (!haystack.includes(search)) return false;
  }

  if (!selected(environment.spec.region, filters.regions)) return false;
  if (!selected(environment.spec.zone, filters.zones)) return false;
  if (!selected(environment.spec.gpuType, filters.gpuTypes)) return false;
  if (!selected(environment.spec.cpuPlatform, filters.cpuPlatforms)) return false;
  if (!selected(environment.spec.imageId, filters.imageIds)) return false;
  if (filters.statuses?.length && !filters.statuses.includes(environment.status)) return false;
  if (filters.leaseStates?.length && !filters.leaseStates.includes(environment.lease.state)) return false;
  if (filters.relationKinds?.length && !filters.relationKinds.includes(environment.relation.kind)) return false;
  if (filters.cleanupStates?.length && !filters.cleanupStates.includes(environment.cleanup.state)) return false;
  if (filters.ownerships?.length && !filters.ownerships.includes(environment.ownership)) return false;
  if (filters.freshnessStates?.length && !filters.freshnessStates.includes(environment.freshness)) return false;
  if (filters.inventoryStates?.length && !filters.inventoryStates.includes(environment.inventory.state)) return false;
  if (filters.minCpu !== undefined && (environment.spec.cpu === null || environment.spec.cpu < filters.minCpu)) return false;
  if (filters.maxCpu !== undefined && (environment.spec.cpu === null || environment.spec.cpu > filters.maxCpu)) return false;
  if (filters.minMemoryMb !== undefined && (environment.spec.memoryMb === null || environment.spec.memoryMb < filters.minMemoryMb)) return false;
  if (filters.maxMemoryMb !== undefined && (environment.spec.memoryMb === null || environment.spec.memoryMb > filters.maxMemoryMb)) return false;
  if (filters.attentionOnly && environmentAttention(environment).length === 0) return false;
  return true;
}

export type ComputeAttention = Readonly<{
  code: string;
  label: string;
  description: string;
  tone: ComputeTone;
  icon: ComputeStateIcon;
}>;

function attentionFrom(code: string, descriptor: ComputeStateDescriptor): ComputeAttention {
  return {code, label: descriptor.label, description: descriptor.description, tone: descriptor.tone, icon: descriptor.icon};
}

export function environmentAttention(environment: ComputeEnvironment): ComputeAttention[] {
  const result: ComputeAttention[] = [];
  if (environment.status === 'failed' || environment.status === 'unavailable' || environment.status === 'unknown') {
    result.push(attentionFrom(`status:${environment.status}`, providerStatusDictionary[environment.status]));
  }
  if (environment.lease.state === 'review') {
    result.push(attentionFrom('lease:review', leaseStateDictionary.review));
  }
  if (environment.cleanup.state === 'failed') {
    result.push(attentionFrom('cleanup:failed', cleanupStateDictionary.failed));
  }
  if (environment.freshness !== 'fresh') {
    result.push(attentionFrom(`freshness:${environment.freshness}`, freshnessDictionary[environment.freshness]));
  }
  if (environment.ownership === 'unmanaged' || environment.ownership === 'unknown') {
    result.push(attentionFrom(`ownership:${environment.ownership}`, ownershipDictionary[environment.ownership]));
  }
  if (environment.status === 'running' && environment.monitor.provider === 'unavailable') {
    result.push({
      code: 'monitor:unavailable',
      label: '监控暂不可用',
      description: '实例可能正在运行，但当前没有可信监控数据。',
      tone: 'caution',
      icon: 'sliders',
    });
  }
  return result;
}

export type ComputeEnvironmentSort = 'attention' | 'name' | 'created_desc' | 'updated_desc' | 'gpu';

function statusAttentionRank(status: ProviderLifecycleStatus): number {
  if (status === 'failed' || status === 'unavailable' || status === 'unknown') return 0;
  if (status === 'creating' || status === 'stopping') return 1;
  if (status === 'stopped') return 2;
  return 3;
}

function dateMillis(value: string | null): number {
  if (!value) return Number.NEGATIVE_INFINITY;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

export function sortEnvironments(
  environments: readonly ComputeEnvironment[],
  sort: ComputeEnvironmentSort = 'attention',
): ComputeEnvironment[] {
  const rows = [...environments];
  rows.sort((left, right) => {
    let compared = 0;
    if (sort === 'name') {
      compared = left.name.localeCompare(right.name, 'zh-CN');
    } else if (sort === 'created_desc') {
      compared = dateMillis(right.createdAt) - dateMillis(left.createdAt);
    } else if (sort === 'updated_desc') {
      compared = dateMillis(right.updatedAt) - dateMillis(left.updatedAt);
    } else if (sort === 'gpu') {
      compared = (left.spec.gpuType ?? '\uffff').localeCompare(right.spec.gpuType ?? '\uffff', 'zh-CN');
    } else {
      const attention = environmentAttention(left).length === 0 ? 1 : 0;
      const otherAttention = environmentAttention(right).length === 0 ? 1 : 0;
      compared = otherAttention - attention
        || statusAttentionRank(left.status) - statusAttentionRank(right.status)
        || dateMillis(right.updatedAt) - dateMillis(left.updatedAt);
    }
    return compared || left.name.localeCompare(right.name, 'zh-CN') || left.id.localeCompare(right.id);
  });
  return rows;
}

export type ComputeEnvironmentSummary = Readonly<{
  total: number;
  running: number;
  transitioning: number;
  stopped: number;
  failed: number;
  unavailable: number;
  unknown: number;
  unmanaged: number;
  attention: number;
  byStatus: Readonly<Record<ProviderLifecycleStatus, number>>;
}>;

export function summarizeEnvironments(
  environments: readonly ComputeEnvironment[],
): ComputeEnvironmentSummary {
  const byStatus = Object.fromEntries(providerLifecycleStatuses.map((status) => [status, 0])) as Record<ProviderLifecycleStatus, number>;
  let attention = 0;
  let unmanaged = 0;
  for (const environment of environments) {
    byStatus[environment.status] += 1;
    if (environmentAttention(environment).length) attention += 1;
    if (environment.ownership === 'unmanaged') unmanaged += 1;
  }
  return {
    total: environments.length,
    running: byStatus.running,
    transitioning: byStatus.creating + byStatus.stopping,
    stopped: byStatus.stopped,
    failed: byStatus.failed,
    unavailable: byStatus.unavailable,
    unknown: byStatus.unknown,
    unmanaged,
    attention,
    byStatus,
  };
}

export type LatestRequestToken = Readonly<{
  id: number;
  signal: AbortSignal;
}>;

export type LatestRequestScope = Readonly<{
  begin: () => LatestRequestToken;
  isCurrent: (token: LatestRequestToken) => boolean;
  finish: (token: LatestRequestToken) => void;
  abort: () => void;
}>;

export function createLatestRequestScope(): LatestRequestScope {
  let sequence = 0;
  let current: {token: LatestRequestToken; controller: AbortController} | null = null;
  return {
    begin() {
      current?.controller.abort();
      const controller = new AbortController();
      const token = {id: ++sequence, signal: controller.signal};
      current = {token, controller};
      return token;
    },
    isCurrent(token) {
      return current?.token.id === token.id && !token.signal.aborted;
    },
    finish(token) {
      if (current?.token.id === token.id) current = null;
    },
    abort() {
      current?.controller.abort();
      current = null;
    },
  };
}
