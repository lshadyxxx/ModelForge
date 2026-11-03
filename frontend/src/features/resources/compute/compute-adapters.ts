import {
  cleanupStateDictionary,
  freshnessDictionary,
  leaseStateDictionary,
  ownershipDictionary,
  providerStatusDictionary,
  relationDictionary,
  type ComputeConfiguration,
  type ComputeEnvironment,
  type ComputeEnvironmentEvent,
  type ComputeMonitorMetric,
} from './compute-model.ts';
import type {
  CleanupState,
  ComputeConfigurationView,
  ComputeEnvironmentView,
  ComputeEvent,
  ComputeMetric,
  ComputeStatus,
  LeaseState,
  RelationKind,
  StatusTone,
} from './compute-ui-types.ts';

const statusLabels: Record<ComputeStatus, string> = {
  creating: '创建中',
  starting: '启动中',
  running: '运行中',
  stopping: '停止中',
  stopped: '已停止',
  deleting: '删除中',
  failed: '失败',
  unavailable: '不可用',
  unknown: '待核对',
};

const statusTones: Record<ComputeStatus, StatusTone> = {
  creating: 'info',
  starting: 'info',
  running: 'ok',
  stopping: 'info',
  stopped: 'neutral',
  deleting: 'info',
  failed: 'danger',
  unavailable: 'danger',
  unknown: 'warning',
};

const ownershipLabels = {
  platform: '平台工作流',
  managed: '平台纳管',
  unmanaged: '未纳管',
  unknown: '归属待核对',
} as const;

const relationLabels: Record<RelationKind, string> = {
  training: '训练任务',
  trial: '推理试用',
  manual: '手动环境',
  none: '未关联任务',
  unknown: '关联待核对',
};

const leaseLabels: Record<LeaseState, string> = {
  unbound: '租约未绑定',
  held: '租约持有中',
  releasing: '租约释放中',
  released: '租约已释放',
  review: '租约待核对',
  unknown: '租约待核对',
};

const cleanupLabels: Record<CleanupState, string> = {
  not_requested: '未请求清理',
  stopping: '停止清理中',
  deleting: '删除确认中',
  failed: '清理失败',
  confirmed: '清理已确认',
  unknown: '清理待核对',
};

const eventActionLabels: Record<string, string> = {
  create_requested: '创建命令已记录',
  price_verified: '官方报价已核对',
  create_succeeded: '创建结果已确认',
  create_timeout: '创建结果等待核对',
  created: '实例创建事实已记录',
  bound: 'GPU 租约已绑定',
  released: 'GPU 租约已释放',
  start_requested: '启动命令已记录',
  stop_requested: '停止命令已记录',
  delete_requested: '删除命令已记录',
  observed_running: '供应商报告运行中',
  observed_stopped: '供应商报告已停止',
  cloud_instance_not_found: '供应商未返回目标实例',
  cleanup_failed: '清理结果失败',
  task_output_persisted: '任务产物已持久化',
};

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function metricValue(metric: ComputeMonitorMetric): string {
  const numeric = typeof metric.value === 'number' ? metric.value : null;
  if (numeric === null) return String(metric.value);
  const rendered = Number.isInteger(numeric) ? String(numeric) : numeric.toFixed(1);
  return metric.unit ? `${rendered}${metric.unit}` : rendered;
}

function metricPercent(metric: ComputeMonitorMetric): number | undefined {
  const value = typeof metric.value === 'number' ? metric.value : Number(metric.value);
  if (!Number.isFinite(value)) return undefined;
  if (metric.max && metric.max > 0) return Math.max(0, Math.min(100, (value / metric.max) * 100));
  if (metric.unit === '%') return Math.max(0, Math.min(100, value));
  return undefined;
}

function toMetrics(environment: ComputeEnvironment): ComputeMetric[] {
  const metrics: ComputeMetric[] = environment.monitor.metrics.map((metric) => ({
    key: metric.key,
    label: metric.label,
    value: metricValue(metric),
    max: metric.max ?? undefined,
    percent: metricPercent(metric),
  }));
  if (environment.monitor.checkedAt) {
    metrics.push({
      key: 'heartbeat',
      label: '最近监控核对',
      value: new Date(environment.monitor.checkedAt).toLocaleTimeString('zh-CN', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }),
    });
  }
  return metrics;
}

function eventLabel(event: ComputeEnvironmentEvent): string {
  const key = event.action.toLowerCase().replace(/[\s-]+/g, '_');
  return eventActionLabels[key] ?? event.label;
}

function toEvent(event: ComputeEnvironmentEvent): ComputeEvent | null {
  if (!event.recordedAt) return null;
  return {
    id: event.id ?? `${event.action}-${event.recordedAt}`,
    action: event.action,
    label: eventLabel(event),
    recordedAt: event.recordedAt,
    source: event.source === 'lease' ? 'lease' : 'observation',
  };
}

function allEvents(environment: ComputeEnvironment): ComputeEvent[] {
  const seen = new Set<string>();
  return [...environment.events, ...environment.lease.events]
    .map(toEvent)
    .filter((event): event is ComputeEvent => Boolean(event))
    .filter((event) => {
      const key = `${event.id ?? ''}:${event.action}:${event.recordedAt}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((left, right) => Date.parse(right.recordedAt) - Date.parse(left.recordedAt));
}

function statusDetail(environment: ComputeEnvironment): string {
  if (environment.status === 'unknown') {
    return '供应商生命周期未知，记录保留并等待核对，不会按失败、空闲或已删除处理。';
  }
  if (environment.status === 'unavailable') {
    return environment.providerState
      ? `供应商报告 ${environment.providerState}，实例不可用。`
      : '供应商未返回可确认的实例，当前不可用。';
  }
  if (environment.status === 'failed') {
    return environment.cleanup.errorCode
      ? `已确认失败；清理错误 ${environment.cleanup.errorCode}。`
      : '已确认失败，请结合事件、租约和清理状态核对。';
  }
  if (environment.freshness !== 'fresh') {
    return `${providerStatusDictionary[environment.status].description} 当前状态快照已过期或新鲜度未知。`;
  }
  if (environment.lease.state === 'review') return '供应商状态可读，但 GPU 租约事实待核对。';
  return providerStatusDictionary[environment.status].description;
}

export function toEnvironmentView(environment: ComputeEnvironment): ComputeEnvironmentView {
  const status = environment.status as ComputeStatus;
  const relationLabel = environment.relation.label
    ?? (environment.relation.id
      ? `${relationLabels[environment.relation.kind]} · ${environment.relation.id.slice(0, 8)}`
      : relationLabels[environment.relation.kind]);
  return {
    id: environment.id,
    name: environment.name,
    providerInstanceId: environment.providerInstanceId ?? undefined,
    status,
    statusLabel: statusLabels[status],
    statusTone: statusTones[status],
    statusDetail: statusDetail(environment),
    spec: {
      region: environment.spec.region ?? '',
      zone: environment.spec.zone ?? '',
      gpuType: environment.spec.gpuType ?? '',
      cpu: environment.spec.cpu ?? 0,
      memoryGiB: environment.spec.memoryMb ? Math.round(environment.spec.memoryMb / 1024) : 0,
      imageId: environment.spec.imageId ?? '',
      imageName: environment.spec.imageName ?? undefined,
      cpuPlatform: environment.spec.cpuPlatform ?? undefined,
      chargeType: environment.spec.chargeType ?? undefined,
      bootDiskGiB: environment.spec.bootDiskGb ?? undefined,
      bootDiskType: environment.spec.bootDiskType ?? undefined,
    },
    lease: {
      state: environment.lease.state as LeaseState,
      label: leaseLabels[environment.lease.state],
      reservationId: environment.lease.reservationId ?? undefined,
      ownerLabel:
        environment.lease.ownerKind === 'training'
          ? '训练任务持有'
          : environment.lease.ownerKind === 'trial'
            ? '推理试用持有'
            : '持有者待核对',
      events: environment.lease.events
        .map(toEvent)
        .filter((event): event is ComputeEvent => Boolean(event)),
    },
    relation: {
      kind: environment.relation.kind as RelationKind,
      id: environment.relation.id ?? undefined,
      label: relationLabel,
    },
    cleanup: {
      state: environment.cleanup.state as CleanupState,
      label: cleanupLabels[environment.cleanup.state],
      errorCode: environment.cleanup.errorCode ?? undefined,
    },
    monitor: {
      provider: environment.monitor.provider,
      checkedAt: environment.monitor.checkedAt ?? undefined,
      metrics: toMetrics(environment),
      errorCode: environment.monitor.errorCode ?? undefined,
    },
    ownership: environment.ownership === 'unknown' ? 'unmanaged' : environment.ownership,
    ownershipLabel: ownershipLabels[environment.ownership],
    freshness: environment.freshness,
    freshnessLabel: freshnessDictionary[environment.freshness].label,
    quote: environment.quote,
    actions: [...environment.actions],
    createdAt: environment.createdAt ?? undefined,
    updatedAt: environment.updatedAt ?? undefined,
    events: allEvents(environment),
  };
}

export function toConfigurationView(configuration: ComputeConfiguration): ComputeConfigurationView {
  return {
    configured: configuration.configured,
    defaultRegion: configuration.defaultRegion,
    mode: configuration.mode === 'read_write' ? 'read_write' : 'read_only',
    writeEnabled: configuration.writeEnabled,
    reason:
      configuration.reason
      ?? (configuration.writeEnabled
        ? undefined
        : '后端未开启计算环境写入能力；本轮仅允许目录、库存和实例只读查看。'),
  };
}

export function statusDescription(
  environment: ComputeEnvironment,
): string {
  return environment.status === 'unknown'
    ? providerStatusDictionary.unknown.description
    : providerStatusDictionary[environment.status].description;
}

export function leaseDescription(environment: ComputeEnvironment): string {
  return leaseStateDictionary[environment.lease.state].description;
}

export function cleanupDescription(environment: ComputeEnvironment): string {
  return cleanupStateDictionary[environment.cleanup.state].description;
}

export function ownershipDescription(environment: ComputeEnvironment): string {
  return ownershipDictionary[environment.ownership].description;
}

export function relationDescription(environment: ComputeEnvironment): string {
  return relationDictionary[environment.relation.kind].description;
}

export function usableMonitorNumber(metric: ComputeMonitorMetric): number | null {
  return finite(metric.value);
}
