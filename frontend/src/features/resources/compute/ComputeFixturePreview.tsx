import { useMemo, useState } from 'react';
import type { Image } from '../api';
import { ComputeIcon } from './ComputeIcon';
import { CreateEnvironmentWizard } from './CreateEnvironmentWizard';
import type {
  CreateAccepted,
  CreateEnvironmentPayload,
  InventoryCheck,
} from './CreateEnvironmentWizard';
import { DangerousActionDialog } from './DangerousActionDialog';
import type { CommandAccepted } from './DangerousActionDialog';
import { EnvironmentDetail } from './EnvironmentDetail';
import { InstanceConsole } from './InstanceConsole';
import {
  ResourceMarket,
  type ComputeCatalogOption,
  type MarketAvailability,
  type MarketFilters,
} from './ResourceMarket';
import type {
  ActionDialogState,
  ComputeAction,
  ComputeConfigurationView,
  ComputeEnvironmentView,
} from './compute-ui-types';
import { normalizeQuote, unavailableQuote } from './compute-model';
import './compute-workbench.css';

type Tab = 'market' | 'console';
type Scenario = 'ready' | 'loading' | 'empty' | 'error' | 'truncated';

const fixtureImages: Image[] = [
  {
    CompShareImageId: 'fixture-image-torch',
    Name: 'Ubuntu-nvidia 22.04',
    ImageType: 'System',
    Status: 'Available',
    Author: 'fixture',
    Tags: ['Linux'],
    Description: '本地夹具系统镜像，不代表真实兼容基线',
  },
  {
    CompShareImageId: 'fixture-image-vllm',
    Name: 'vLLM Runtime 0.9',
    ImageType: 'App',
    Status: 'Available',
    Author: 'fixture',
    Tags: ['推理服务'],
    Description: '本地夹具应用镜像',
  },
  {
    CompShareImageId: 'fixture-image-cpu',
    Name: 'Ubuntu 22.04 CPU',
    ImageType: 'System',
    Status: 'Available',
    Author: 'fixture',
    Tags: ['Linux'],
    Description: '本地夹具 CPU 镜像',
  },
  {
    CompShareImageId: 'fixture-image-offline',
    Name: 'PyTorch:24.04-py3',
    ImageType: 'App',
    Status: 'Offline',
    Author: 'fixture',
    Tags: ['训练框架'],
    Description: '用于验证下线状态不可选',
  },
  {
    CompShareImageId: 'fixture-image-offline-system',
    Name: 'Ubuntu 20.04 legacy',
    ImageType: 'System',
    Status: 'Offline',
    Author: 'fixture',
    Tags: ['Linux'],
    Description: '用于验证系统目录下线状态不可选',
  },
];

const now = new Date();
const isoMinutesAgo = (minutes: number) =>
  new Date(now.getTime() - minutes * 60_000).toISOString();
const fixtureQuote = unavailableQuote('开发夹具未提供可信报价。');
const fixtureAvailableQuote = normalizeQuote({
  state: 'available',
  code: 'fixture_example_quote',
  label: '示例报价',
  description: '仅用于开发夹具视觉验收，不是真实账户报价。',
  currency: 'CNY',
  hourly: 1.66,
  amount: 1.66,
  unit: 'hour',
  charge_type: 'Postpay',
  observed_at: isoMinutesAgo(2),
  breakdown: {
    instance: 1.48,
    system_disks: 0.18,
    data_disks: 0,
    image: 0,
  },
});

const fixtureEvents = [
  {
    id: 'fixture-event-1',
    action: 'observed_running',
    label: '供应商报告运行中',
    recordedAt: isoMinutesAgo(2),
    source: 'observation' as const,
  },
  {
    id: 'fixture-event-2',
    action: 'bound',
    label: 'GPU 租约已绑定',
    recordedAt: isoMinutesAgo(7),
    source: 'lease' as const,
  },
  {
    id: 'fixture-event-3',
    action: 'created',
    label: '实例创建事实已记录',
    recordedAt: isoMinutesAgo(11),
    source: 'observation' as const,
  },
];

const environments: ComputeEnvironmentView[] = [
  {
    id: 'fixture-00000000-0000-4000-8000-000000000031',
    name: 'forge-train-qwen3-03',
    providerInstanceId: 'fixture-uhost-031',
    status: 'running',
    statusLabel: '运行中',
    statusTone: 'ok',
    statusDetail: '供应商报告实例正在运行，GPU 租约和训练关联均已确认。',
    spec: {
      region: '华北二',
      zone: 'cn-wlcb-01',
      gpuType: '4090',
      cpu: 16,
      memoryGiB: 94,
      imageId: 'fixture-image-torch',
      imageName: 'Ubuntu-nvidia 22.04',
      cpuPlatform: 'Auto',
      chargeType: 'Postpay',
      bootDiskGiB: 100,
      bootDiskType: 'CLOUD_SSD',
    },
    lease: {
      state: 'held',
      label: '租约持有中',
      reservationId: 'fixture-lease-031',
      ownerLabel: '训练任务持有',
      events: [fixtureEvents[1]],
    },
    relation: {
      kind: 'training',
      id: 'fixture-attempt-A031',
      label: '训练 · Qwen3-0.6B · Attempt A-031',
    },
    cleanup: { state: 'not_requested', label: '未请求清理' },
    monitor: {
      provider: 'ucloud',
      checkedAt: isoMinutesAgo(1),
      metrics: [
        { key: 'gpu_util', label: 'GPU 利用率', value: '72%', percent: 72 },
        { key: 'gpu_memory_used', label: '显存占用', value: '18 / 24 GiB', percent: 75 },
      ],
    },
    ownership: 'managed',
    ownershipLabel: '平台纳管',
    freshness: 'fresh',
    freshnessLabel: '刚刷新',
    quote: fixtureQuote,
    actions: ['stop', 'delete'],
    createdAt: isoMinutesAgo(95),
    updatedAt: isoMinutesAgo(2),
    events: fixtureEvents,
  },
  {
    id: 'fixture-00000000-0000-4000-8000-000000000038',
    name: 'forge-infer-5090-08',
    providerInstanceId: 'fixture-uhost-038',
    status: 'creating',
    statusLabel: '创建中',
    statusTone: 'info',
    statusDetail: '供应商正在创建实例，尚未取得可运行事实。',
    spec: {
      region: '华北二',
      zone: 'cn-wlcb-01',
      gpuType: '5090',
      cpu: 16,
      memoryGiB: 94,
      imageId: 'fixture-image-vllm',
      imageName: 'vLLM Runtime 0.9',
      cpuPlatform: 'Auto',
      chargeType: 'Postpay',
    },
    lease: { state: 'unbound', label: '租约未绑定', ownerLabel: '持有者待核对' },
    relation: {
      kind: 'trial',
      id: 'fixture-trial-011',
      label: '推理试用 · Best Adapter · T-011',
    },
    cleanup: { state: 'not_requested', label: '未请求清理' },
    monitor: {
      provider: 'unavailable',
      metrics: [],
      errorCode: 'monitor_pending_runtime',
    },
    ownership: 'managed',
    ownershipLabel: '平台纳管',
    freshness: 'fresh',
    freshnessLabel: '刚刷新',
    quote: fixtureQuote,
    actions: ['delete'],
    createdAt: isoMinutesAgo(3),
    updatedAt: isoMinutesAgo(1),
    events: [],
  },
  {
    id: 'fixture-00000000-0000-4000-8000-000000000022',
    name: 'baseline-retest-02',
    providerInstanceId: 'fixture-uhost-022',
    status: 'failed',
    statusLabel: '失败',
    statusTone: 'danger',
    statusDetail: '已确认失败；清理未完成，租约待核对。',
    spec: {
      region: '华北二',
      zone: 'cn-wlcb-01',
      gpuType: '4090',
      cpu: 16,
      memoryGiB: 64,
      imageId: 'fixture-image-torch',
      imageName: 'Ubuntu-nvidia 22.04',
      cpuPlatform: 'Auto',
      chargeType: 'Postpay',
    },
    lease: {
      state: 'review',
      label: '租约待核对',
      reservationId: 'fixture-lease-022',
      ownerLabel: '持有者待核对',
    },
    relation: {
      kind: 'training',
      id: 'fixture-attempt-A024',
      label: '训练 · 启动检查失败 · A-024',
    },
    cleanup: {
      state: 'failed',
      label: '清理失败',
      errorCode: 'cloud_terminate_timeout',
    },
    monitor: {
      provider: 'unavailable',
      metrics: [],
      errorCode: 'monitor_runtime_unavailable',
    },
    ownership: 'managed',
    ownershipLabel: '平台纳管',
    freshness: 'stale',
    freshnessLabel: '数据已过期',
    quote: fixtureQuote,
    actions: ['delete'],
    createdAt: isoMinutesAgo(180),
    updatedAt: isoMinutesAgo(40),
    events: [
      {
        id: 'fixture-event-failed',
        action: 'cleanup_failed',
        label: '清理结果失败',
        recordedAt: isoMinutesAgo(40),
        source: 'observation',
      },
    ],
  },
  {
    id: 'fixture-00000000-0000-4000-8000-000000000019',
    name: 'infer-east-03',
    providerInstanceId: 'fixture-uhost-019',
    status: 'unavailable',
    statusLabel: '不可用',
    statusTone: 'danger',
    statusDetail: '供应商未返回目标实例，当前不可用。',
    spec: {
      region: '华北二',
      zone: 'cn-wlcb-01',
      gpuType: '4090',
      cpu: 8,
      memoryGiB: 32,
      imageId: 'fixture-image-cpu',
      imageName: 'Ubuntu 24.04',
      cpuPlatform: 'Auto',
      chargeType: 'Postpay',
    },
    lease: {
      state: 'released',
      label: '租约已释放',
      reservationId: 'fixture-lease-019',
      ownerLabel: '推理试用持有',
    },
    relation: {
      kind: 'trial',
      id: 'fixture-trial-009',
      label: '推理试用 · 已结束 · T-009',
    },
    cleanup: { state: 'confirmed', label: '清理已确认' },
    monitor: {
      provider: 'unavailable',
      metrics: [],
      errorCode: 'cloud_instance_not_found',
    },
    ownership: 'managed',
    ownershipLabel: '平台纳管',
    freshness: 'fresh',
    freshnessLabel: '刚刷新',
    quote: fixtureQuote,
    actions: [],
    createdAt: isoMinutesAgo(300),
    updatedAt: isoMinutesAgo(11),
    events: [],
  },
  {
    id: 'fixture-00000000-0000-4000-8000-000000000004',
    name: 'orphan-state-04',
    providerInstanceId: 'fixture-uhost-004',
    status: 'unknown',
    statusLabel: '待核对',
    statusTone: 'warning',
    statusDetail: '供应商生命周期未知，记录保留并等待核对。',
    spec: {
      region: '华北二',
      zone: 'cn-wlcb-01',
      gpuType: '4090',
      cpu: 16,
      memoryGiB: 64,
      imageId: 'fixture-image-torch',
      imageName: 'Ubuntu-nvidia 22.04',
      cpuPlatform: 'Auto',
      chargeType: 'Postpay',
    },
    lease: { state: 'unknown', label: '租约待核对', ownerLabel: '持有者待核对' },
    relation: { kind: 'unknown', label: '关联待核对' },
    cleanup: { state: 'unknown', label: '清理待核对' },
    monitor: {
      provider: 'unavailable',
      metrics: [],
      errorCode: 'provider_state_unknown',
    },
    ownership: 'unmanaged',
    ownershipLabel: '未纳管',
    freshness: 'unconfirmed',
    freshnessLabel: '新鲜度未确认',
    quote: fixtureQuote,
    actions: [],
    createdAt: isoMinutesAgo(500),
    updatedAt: isoMinutesAgo(21),
    events: [],
  },
  {
    id: 'fixture-00000000-0000-4000-8000-000000000027',
    name: 'eval-sandbox-07',
    providerInstanceId: 'fixture-uhost-027',
    status: 'stopped',
    statusLabel: '已停止',
    statusTone: 'neutral',
    statusDetail: '供应商报告实例已停止；存储费用可能继续。',
    spec: {
      region: '华北二',
      zone: 'cn-wlcb-01',
      gpuType: '4090',
      cpu: 16,
      memoryGiB: 64,
      imageId: 'fixture-image-torch',
      imageName: 'Ubuntu-nvidia 22.04',
      cpuPlatform: 'Auto',
      chargeType: 'Postpay',
      bootDiskGiB: 100,
      bootDiskType: 'CLOUD_SSD',
    },
    lease: { state: 'released', label: '租约已释放', ownerLabel: '训练任务持有' },
    relation: { kind: 'none', label: '未关联任务' },
    cleanup: { state: 'stopping', label: '停止清理中' },
    monitor: {
      provider: 'ucloud',
      checkedAt: isoMinutesAgo(30),
      metrics: [],
    },
    ownership: 'managed',
    ownershipLabel: '平台纳管',
    freshness: 'fresh',
    freshnessLabel: '刚刷新',
    quote: fixtureQuote,
    actions: ['start', 'delete'],
    createdAt: isoMinutesAgo(900),
    updatedAt: isoMinutesAgo(30),
    events: [],
  },
];

const options: ComputeCatalogOption[] = [
  {
    id: 'fixture-4090-94',
    region: '华北二',
    zone: 'cn-wlcb-01',
    zoneLabel: '华北二A',
    gpuType: '4090',
    graphicsMemoryGb: 24,
    cpu: 16,
    memoryGiB: 94,
    cpuPlatform: 'Auto',
    imageId: 'fixture-image-torch',
    imageName: 'Ubuntu-nvidia 22.04',
    imageType: 'System',
    diskType: 'CLOUD_SSD',
    diskMinGiB: 60,
    diskMaxGiB: 500,
    chargeType: 'Postpay',
    availability: 'available',
    availabilityLabel: '查询时有库存',
    capacityCheckedAt: isoMinutesAgo(2),
    compatibility: 'unverified',
    quote: fixtureAvailableQuote,
  },
  {
    id: 'fixture-4090-64',
    region: '华北二',
    zone: 'cn-wlcb-01',
    zoneLabel: '华北二A',
    gpuType: '4090',
    graphicsMemoryGb: 24,
    cpu: 16,
    memoryGiB: 64,
    cpuPlatform: 'Auto',
    imageId: 'fixture-image-torch',
    imageName: 'Ubuntu-nvidia 22.04',
    imageType: 'System',
    diskType: 'CLOUD_SSD',
    diskMinGiB: 60,
    diskMaxGiB: 500,
    chargeType: 'Postpay',
    availability: 'out_of_stock',
    availabilityLabel: '查询时库存不足',
    capacityCheckedAt: isoMinutesAgo(2),
    compatibility: 'unverified',
  },
  {
    id: 'fixture-5090-94',
    region: '华北二',
    zone: 'cn-wlcb-01',
    zoneLabel: '华北二A',
    gpuType: '5090',
    graphicsMemoryGb: 32,
    cpu: 16,
    memoryGiB: 94,
    cpuPlatform: 'Auto',
    imageId: 'fixture-image-vllm',
    imageName: 'vLLM Runtime 0.9',
    imageType: 'System',
    diskType: 'CLOUD_SSD',
    diskMinGiB: 80,
    diskMaxGiB: 500,
    chargeType: 'Postpay',
    availability: 'unknown',
    availabilityLabel: '尚未查库存',
    compatibility: 'unverified',
  },
];

const baseFilters: MarketFilters = {
  region: '华北二',
  zone: 'cn-wlcb-01',
  gpuType: '',
  cpuMemory: '',
  imageType: 'System',
  imageName: '',
  price: '',
  stock: 'all',
};

export function ComputeFixturePreview() {
  const [tab, setTab] = useState<Tab>('market');
  const [scenario, setScenario] = useState<Scenario>('ready');
  const [filters, setFilters] = useState<MarketFilters>(baseFilters);
  const [selectedId, setSelectedId] = useState(options[0].id);
  const [wizard, setWizard] = useState<ComputeCatalogOption | null>(null);
  const [detailId, setDetailId] = useState('');
  const [action, setAction] = useState<ActionDialogState>(null);
  const [availability, setAvailability] = useState<Record<string, MarketAvailability>>(
    Object.fromEntries(options.map((option) => [option.id, option.availability])),
  );
  const configuration: ComputeConfigurationView = {
    configured: true,
    defaultRegion: '华北二',
    mode: 'read_only',
    writeEnabled: false,
    reason: '开发夹具仅用于交互与状态验收，不会发送任何云端写命令。',
  };
  const filtered = useMemo(
    () =>
      options
        .filter((option) => !filters.gpuType || option.gpuType === filters.gpuType)
        .map((option) => ({
          ...option,
          availability: availability[option.id],
          availabilityLabel:
            availability[option.id] === 'available'
              ? '查询时有库存'
              : availability[option.id] === 'out_of_stock'
                ? '查询时库存不足'
                : '尚未查库存',
        })),
    [availability, filters.gpuType],
  );
  const detail = environments.find((environment) => environment.id === detailId) ?? null;
  const marketOptions =
    scenario === 'empty' || scenario === 'error' || scenario === 'loading'
      ? []
      : filtered;
  const wizardImageType = wizard?.imageType ?? 'System';
  const visibleFixtureImages =
    scenario === 'empty' || scenario === 'error' || scenario === 'loading'
      ? []
      : fixtureImages.filter((image) => image.ImageType === wizardImageType);
  const fixtureImageTotal =
    scenario === 'truncated' ? 120 : visibleFixtureImages.length;
  const attentionCount = environments.filter(
    (environment) =>
      environment.statusTone === 'danger'
      || environment.status === 'unavailable'
      || environment.status === 'unknown'
      || environment.lease.state === 'review'
      || environment.cleanup.state === 'failed',
  ).length;
  const heldLeaseCount = environments.filter(
    (environment) => environment.lease.state === 'held',
  ).length;

  const checkInventory = async (): Promise<InventoryCheck> => {
    await new Promise((resolve) => window.setTimeout(resolve, 350));
    return {
      state: 'available',
      checkedAt: new Date().toISOString(),
      quote: fixtureAvailableQuote,
    };
  };

  const accepted = async (actionName: ComputeAction): Promise<CommandAccepted> => ({
    operationId: `fixture-command-${actionName}`,
    acceptedAt: new Date().toISOString(),
    message: `开发夹具：${actionName} 命令已模拟受理，未连接云端。`,
  });

  return (
    <div className="mf-compute">
      <header className="mf-compute-heading">
        <div>
          <span className="mf-compute-eyebrow">
            <ComputeIcon name="grid" />
            DEVELOPMENT FIXTURE
          </span>
          <h1>计算环境 · 状态验收</h1>
          <p>
            使用同一套正式组件演示创建、运行、失败、不可用、未知、停止、危险确认与事件时间线。
          </p>
        </div>
        <div className="mf-compute-heading-actions">
          <button
            type="button"
            className="mf-secondary"
            onClick={() => {
              setScenario('loading');
              window.setTimeout(() => setScenario('ready'), 900);
            }}
          >
            <ComputeIcon name="refresh" />
            重放加载
          </button>
          <button
            type="button"
            className="mf-primary"
            onClick={() => setWizard(filtered[0])}
          >
            <ComputeIcon name="plus" />
            新建计算环境
          </button>
        </div>
      </header>

      <div className="mf-compute-warning" role="status">
        <ComputeIcon name="alert" />
        <span>
          <strong>仅限开发夹具</strong> · 页面中的实例、库存、时间与状态均为状态覆盖用示例；
          不进入正式数据路径，不显示示例价格，也不会调用真实云写接口。
        </span>
      </div>

      <div className="mf-compute-mode-banner">
        <ComputeIcon name="lock" />
        <span>
          <strong>正式写入能力保持关闭</strong> · {configuration.reason}
        </span>
      </div>

      <section className="mf-compute-metrics" aria-label="开发夹具指标">
        <article className="mf-compute-metric">
          <span>夹具实例</span>
          <strong>{environments.length}</strong>
          <small>6 种生命周期状态</small>
        </article>
        <article className="mf-compute-metric attention">
          <span>异常队列</span>
          <strong>{attentionCount}</strong>
          <small>失败、不可用、未知、清理失败</small>
        </article>
        <article className="mf-compute-metric">
          <span>目录配置</span>
          <strong>{filtered.length}</strong>
          <small>库存状态示例</small>
        </article>
        <article className="mf-compute-metric ownership">
          <div>
            <span>资源归属</span>
            <strong>开发夹具</strong>
            <small>不连接训练或推理任务</small>
          </div>
          <b aria-label={`${heldLeaseCount} 个 GPU 租约持有中`}>
            <span>{heldLeaseCount}</span>
            <small>GPU 租约</small>
          </b>
        </article>
      </section>

      <div className="mf-compute-warning">
        <ComputeIcon name="alert" size={15} />
        <span>
          <strong>状态演练</strong>
        </span>
        <div className="mf-segment-control" role="group" aria-label="目录状态演练">
          {(['ready', 'loading', 'empty', 'error', 'truncated'] as const).map((state) => (
            <button
              type="button"
              key={state}
              aria-pressed={scenario === state}
              onClick={() => setScenario(state)}
              data-fixture-image-state={state}
            >
              {
                {
                  ready: '正常',
                  loading: '加载',
                  empty: '空',
                  error: '错误',
                  truncated: '截断',
                }[state]
              }
            </button>
          ))}
        </div>
      </div>

      <nav className="mf-compute-tabs" role="tablist" aria-label="开发夹具工作区">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'market'}
          onClick={() => setTab('market')}
        >
          <ComputeIcon name="grid" />
          资源市场
          <span className="mf-compute-tab-count">{filtered.length}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'console'}
          onClick={() => setTab('console')}
        >
          <ComputeIcon name="server" />
          实例控制台
          <span className="mf-compute-tab-count">{environments.length}</span>
          <span className="mf-compute-tab-alert">{attentionCount} 待处理</span>
        </button>
        <small>开发夹具 · 不进入生产构建数据路径</small>
      </nav>

      {tab === 'market' ? (
        <ResourceMarket
          options={marketOptions}
          selectedId={selectedId}
          onSelect={setSelectedId}
          filters={filters}
          onFiltersChange={setFilters}
          regionOptions={[{ value: '华北二', label: '华北二' }]}
          zoneOptions={[{ value: 'cn-wlcb-01', label: '华北二A · cn-wlcb-01' }]}
          gpuOptions={[
            { value: '', label: '全部 GPU' },
            { value: '4090', label: '4090' },
            { value: '5090', label: '5090' },
          ]}
          cpuMemoryOptions={[
            { value: '', label: '全部 CPU / 内存' },
            { value: '16|64', label: '16 核 / 64 GiB' },
            { value: '16|94', label: '16 核 / 94 GiB' },
          ]}
          imageTypeOptions={[{ value: 'System', label: '系统镜像' }]}
          imageNameOptions={[
            { value: '', label: '全部运行镜像' },
            { value: 'Ubuntu-nvidia 22.04', label: 'Ubuntu-nvidia 22.04 · System' },
            { value: 'vLLM Runtime 0.9', label: 'vLLM Runtime 0.9 · System' },
          ]}
          loading={scenario === 'loading'}
          error={scenario === 'error' ? '夹具：目录查询失败，可重试；未使用旧结果。' : ''}
          stale={false}
          queryTime={isoMinutesAgo(1)}
          configuration={configuration}
          checking={false}
          onCheck={() => {
            setScenario('loading');
            window.setTimeout(() => setScenario('ready'), 900);
          }}
          onRetry={() => setScenario('ready')}
          onCreate={(option) => setWizard(option)}
          onClearFilters={() => setFilters(baseFilters)}
        />
      ) : (
        <InstanceConsole
          environments={environments}
          loading={false}
          error=""
          refreshedAt={isoMinutesAgo(1)}
          onRefresh={() => undefined}
          onRetry={() => undefined}
          onDetail={(environment) => setDetailId(environment.id)}
          onAction={(nextAction, environment) =>
            setAction({ action: nextAction, environment })
          }
        />
      )}

      {wizard && (
        <CreateEnvironmentWizard
          options={filtered}
          initialDraft={{
            option: wizard,
            imageId: wizard.imageId,
            bootDiskGb: wizard.diskMinGiB ?? 60,
          }}
          configuration={configuration}
          images={visibleFixtureImages}
          imageType={wizardImageType}
          imagesLoading={scenario === 'loading'}
          imagesError={
            scenario === 'error'
              ? '夹具：运行镜像目录读取失败，可重试；未使用旧结果。'
              : ''
          }
          imagesStale={false}
          imageTotal={fixtureImageTotal}
          onRetryImages={() => undefined}
          onClose={() => setWizard(null)}
          onCheckInventory={checkInventory}
          onCreate={async (payload): Promise<CreateAccepted> => ({
            operationId: 'fixture-create-command',
            acceptedAt: new Date().toISOString(),
            environmentId: payload.requestId,
          })}
          trackedEnvironment={null}
        />
      )}

      {detail && (
        <EnvironmentDetail
          environment={detail}
          busy={false}
          onClose={() => setDetailId('')}
          onRefresh={() => undefined}
          onAction={(nextAction, environment) =>
            setAction({ action: nextAction, environment })
          }
        />
      )}

      {action && (
        <DangerousActionDialog
          action={action.action}
          environment={action.environment}
          onClose={() => setAction(null)}
          onConfirm={accepted}
        />
      )}
    </div>
  );
}
