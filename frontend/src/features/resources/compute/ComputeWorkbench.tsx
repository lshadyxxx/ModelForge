import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { api, json } from '../../../shared/http';
import {
  directoryPath,
  fetchDirectory,
  imageDirectoryQuery,
  type Capacity,
  type Configuration,
  type Image,
  type Specification,
  type Zone,
} from '../api';
import { ComputeIcon } from './ComputeIcon';
import { CreateEnvironmentWizard } from './CreateEnvironmentWizard';
import {
  buildCatalogOptions,
  type EnvironmentDraft,
} from './compute-catalog';
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
  createComputeEnvironment,
  deleteComputeEnvironment,
  fetchComputeConfiguration,
  fetchComputeEnvironments,
  startComputeEnvironment,
  stopComputeEnvironment,
} from './compute-api';
import { toConfigurationView, toEnvironmentView } from './compute-adapters';
import {
  normalizeQuote,
  type ComputeEnvironmentCollection,
} from './compute-model';
import {
  type ComputeCatalogOption,
  type MarketAvailability,
  type MarketFilters,
} from './ResourceMarket';
import { ResourceConfigurator } from './ResourceConfigurator';
import type {
  ActionDialogState,
  ComputeAction,
  ComputeConfigurationView,
  ComputeEnvironmentView,
  ComputeNotice,
} from './compute-ui-types';
import './compute-workbench.css';

type WorkbenchTab = 'market' | 'console';

type CatalogSnapshot = {
  region: string;
  zone: string;
  imageType: string;
} | null;

const emptyFilters: MarketFilters = {
  region: '',
  zone: '',
  gpuType: '',
  cpuMemory: '',
  imageType: 'System',
  imageName: '',
  price: '',
  stock: 'all',
};

function messageOf(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : '请求失败，请重试或刷新状态。';
}

function sleep(milliseconds: number) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function optionValue(value: string, label: string) {
  return { value, label };
}

function regionLabel(zone: Zone): string {
  return zone.Describe.replace(/\s*[A-Za-z]$/, '').trim() || zone.Region;
}

function applyMarketFilters(
  options: ComputeCatalogOption[],
  filters: MarketFilters,
  availability: Record<string, MarketAvailability>,
): ComputeCatalogOption[] {
  return options.filter((option) => {
    if (filters.gpuType && option.gpuType !== filters.gpuType) return false;
    if (
      filters.cpuMemory
      && `${option.cpu}|${option.memoryGiB}` !== filters.cpuMemory
    ) {
      return false;
    }
    if (filters.imageName && option.imageName !== filters.imageName) return false;
    if (
      filters.price === 'available'
      && option.quote?.state !== 'available'
    ) {
      return false;
    }
    if (
      filters.price === 'pending'
      && option.quote?.state === 'available'
    ) {
      return false;
    }
    const state = availability[option.id] ?? option.availability;
    if (filters.stock !== 'all' && state !== filters.stock) return false;
    return true;
  });
}

export function ComputeWorkbench() {
  const [tab, setTab] = useState<WorkbenchTab>('market');
  const [configuration, setConfiguration] =
    useState<ComputeConfigurationView | null>(null);
  const [configurationError, setConfigurationError] = useState('');
  const [configurationLoading, setConfigurationLoading] = useState(true);
  const [zones, setZones] = useState<Zone[]>([]);
  const [zonesLoading, setZonesLoading] = useState(true);
  const [zonesError, setZonesError] = useState('');
  const [filters, setFilters] = useState<MarketFilters>(emptyFilters);
  const [specifications, setSpecifications] = useState<Specification[]>([]);
  const [images, setImages] = useState<Image[]>([]);
  const [imageTotal, setImageTotal] = useState(0);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState('');
  const [catalogFetchedAt, setCatalogFetchedAt] = useState<string>();
  const [catalogReloadKey, setCatalogReloadKey] = useState(0);
  const [catalogSnapshot, setCatalogSnapshot] = useState<CatalogSnapshot>(null);
  const [availability, setAvailability] = useState<
    Record<string, MarketAvailability>
  >({});
  const [selectedId, setSelectedId] = useState('');
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardDraft, setWizardDraft] = useState<EnvironmentDraft | null>(null);
  const [wizardInventory, setWizardInventory] = useState<InventoryCheck>({
    state: 'unknown',
  });
  const [trackedEnvironmentId, setTrackedEnvironmentId] = useState('');
  const [environments, setEnvironments] = useState<ComputeEnvironmentView[]>([]);
  const [environmentCollection, setEnvironmentCollection] =
    useState<ComputeEnvironmentCollection | null>(null);
  const [environmentsLoading, setEnvironmentsLoading] = useState(true);
  const [environmentsError, setEnvironmentsError] = useState('');
  const [detailId, setDetailId] = useState('');
  const [detailBusy, setDetailBusy] = useState(false);
  const [actionDialog, setActionDialog] = useState<ActionDialogState>(null);
  const [notice, setNotice] = useState<ComputeNotice | null>(null);
  const noticeSequence = useRef(0);
  const noticeTimer = useRef<number | null>(null);
  const catalogController = useRef<AbortController | null>(null);
  const environmentController = useRef<AbortController | null>(null);
  const detailController = useRef<AbortController | null>(null);
  const zonesController = useRef<AbortController | null>(null);
  const configController = useRef<AbortController | null>(null);
  const initializedScope = useRef(false);
  const mounted = useRef(false);

  const notify = useCallback((tone: ComputeNotice['tone'], message: string) => {
    if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current);
    const next = {
      id: ++noticeSequence.current,
      tone,
      message,
    };
    setNotice(next);
    noticeTimer.current = window.setTimeout(() => {
      setNotice((current) => (current?.id === next.id ? null : current));
    }, 7000);
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      catalogController.current?.abort();
      environmentController.current?.abort();
      detailController.current?.abort();
      zonesController.current?.abort();
      configController.current?.abort();
      if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current);
    };
  }, []);

  const readConfiguration = useCallback(async () => {
    configController.current?.abort();
    const controller = new AbortController();
    configController.current = controller;
    setConfigurationLoading(true);
    setConfigurationError('');
    try {
      const result = await fetchComputeConfiguration(controller.signal);
      if (!controller.signal.aborted) {
        setConfiguration(toConfigurationView(result));
        if (result.warnings.length) {
          setConfigurationError(result.warnings.join(' '));
        }
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        setConfiguration({
          configured: false,
          defaultRegion: null,
          mode: 'read_only',
          writeEnabled: false,
          reason: messageOf(error),
        });
        setConfigurationError(messageOf(error));
      }
    } finally {
      if (configController.current === controller) {
        configController.current = null;
        if (mounted.current) setConfigurationLoading(false);
      }
    }
  }, []);

  const readZones = useCallback(async () => {
    zonesController.current?.abort();
    const controller = new AbortController();
    zonesController.current = controller;
    setZonesLoading(true);
    setZonesError('');
    try {
      const result = await fetchDirectory<Zone>(
        '/resources/ucloud/zones',
        controller.signal,
      );
      if (!controller.signal.aborted) setZones(result.items);
    } catch (error) {
      if (!controller.signal.aborted) setZonesError(messageOf(error));
    } finally {
      if (zonesController.current === controller) {
        zonesController.current = null;
        if (mounted.current) setZonesLoading(false);
      }
    }
  }, []);

  const readEnvironments = useCallback(
    async (skeleton = false): Promise<ComputeEnvironmentCollection | null> => {
      environmentController.current?.abort();
      const controller = new AbortController();
      environmentController.current = controller;
      if (skeleton) setEnvironmentsLoading(true);
      setEnvironmentsError('');
      try {
        const result = await fetchComputeEnvironments(controller.signal);
        if (!controller.signal.aborted) {
          setEnvironmentCollection(result);
          startTransition(() => {
            setEnvironments(result.items.map(toEnvironmentView));
          });
        }
        return result;
      } catch (error) {
        if (!controller.signal.aborted) setEnvironmentsError(messageOf(error));
        return null;
      } finally {
        if (environmentController.current === controller) {
          environmentController.current = null;
          if (mounted.current) setEnvironmentsLoading(false);
        }
      }
    },
    [],
  );

  useEffect(() => {
    void readConfiguration();
    void readZones();
    void readEnvironments(true);
  }, [readConfiguration, readEnvironments, readZones]);

  useEffect(() => {
    if (!zones.length || configurationLoading || initializedScope.current) return;
    const defaultRegion =
      zones.find((zone) => zone.Region === configuration?.defaultRegion)?.Region
      ?? zones.find((zone) => !zone.IsPod)?.Region
      ?? zones[0]?.Region
      ?? '';
    const defaultZone =
      zones.find(
        (zone) => zone.Region === defaultRegion && !zone.IsPod,
      )?.Zone
      ?? zones.find((zone) => zone.Region === defaultRegion)?.Zone
      ?? '';
    initializedScope.current = true;
    setFilters((current) => ({
      ...current,
      region: current.region || defaultRegion,
      zone: current.zone || defaultZone,
    }));
  }, [configuration?.defaultRegion, configurationLoading, zones]);

  useEffect(() => {
    if (!filters.region) {
      setSpecifications([]);
      setImages([]);
      setImageTotal(0);
      setCatalogSnapshot(null);
      return;
    }
    catalogController.current?.abort();
    const controller = new AbortController();
    catalogController.current = controller;
    setCatalogLoading(true);
    setCatalogError('');
    const imageQuery = imageDirectoryQuery(
      filters.region,
      filters.zone,
      '',
      filters.imageType,
      0,
      100,
    );
    void Promise.all([
      fetchDirectory<Specification>(
        directoryPath('specs', {
          region: filters.region,
          zone: filters.zone,
          instance_type: 'uhost',
        }),
        controller.signal,
      ),
      fetchDirectory<Image>(imageQuery.path, controller.signal),
    ])
      .then(([specResult, imageResult]) => {
        if (controller.signal.aborted) return;
        startTransition(() => {
          setSpecifications(specResult.items);
          setImages(imageResult.items);
          setImageTotal(imageResult.total);
          setCatalogFetchedAt(specResult.fetched_at);
          setCatalogSnapshot({
            region: filters.region,
            zone: filters.zone,
            imageType: filters.imageType,
          });
        });
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setSpecifications([]);
        setImages([]);
        setImageTotal(0);
        setCatalogError(
          `${messageOf(error)} 未保留不一致的旧筛选结果，请刷新后重试。`,
        );
      })
      .finally(() => {
        if (catalogController.current === controller) {
          catalogController.current = null;
          if (mounted.current) setCatalogLoading(false);
        }
      });
    return () => controller.abort();
  }, [catalogReloadKey, filters.imageType, filters.region, filters.zone]);

  const baseOptions = useMemo(
    () => {
      const relevantImages = filters.imageName
        ? images.filter((image) => image.Name === filters.imageName)
        : images;
      return buildCatalogOptions(
        specifications,
        relevantImages,
        catalogSnapshot?.region ?? filters.region,
        catalogSnapshot?.zone ?? filters.zone,
      ).map((option) => ({
        ...option,
        availability: availability[option.id] ?? option.availability,
        availabilityLabel:
          availability[option.id] === 'available'
            ? '查询时有库存'
            : availability[option.id] === 'out_of_stock'
              ? '查询时库存不足'
              : availability[option.id] === 'unknown'
                ? '尚未查库存'
                : option.availabilityLabel,
      }));
    },
    [
      availability,
      catalogSnapshot?.region,
      filters.imageName,
      filters.region,
      images,
      specifications,
    ],
  );

  const marketOptions = useMemo(
    () => applyMarketFilters(baseOptions, filters, availability),
    [availability, baseOptions, filters],
  );

  useEffect(() => {
    if (!marketOptions.length) {
      setSelectedId('');
      return;
    }
    setSelectedId((current) =>
      marketOptions.some((option) => option.id === current)
        ? current
        : marketOptions[0].id,
    );
  }, [marketOptions]);

  const catalogStale = Boolean(
    catalogSnapshot
    && (
      catalogSnapshot.region !== filters.region
      || catalogSnapshot.zone !== filters.zone
      || catalogSnapshot.imageType !== filters.imageType
    ),
  );

  const regionOptions = useMemo(
    () => {
      const seen = new Set<string>();
      return [
        optionValue('', '请选择地域'),
        ...zones.flatMap((zone) => {
          if (seen.has(zone.Region)) return [];
          seen.add(zone.Region);
          return [optionValue(zone.Region, regionLabel(zone))];
        }),
      ];
    },
    [zones],
  );
  const zoneOptions = useMemo(
    () => [
      optionValue('', '全部可用区'),
      ...zones
        .filter((zone) => zone.Region === filters.region)
        .map((zone) =>
          optionValue(
            zone.Zone,
            `${zone.Describe} · ${zone.Zone}`,
          ),
        ),
    ],
    [filters.region, zones],
  );
  const environmentSummary = useMemo(() => ({
    total: environments.length,
    running: environments.filter((environment) => environment.status === 'running').length,
    transitioning: environments.filter((environment) =>
      ['creating', 'starting', 'stopping', 'deleting'].includes(environment.status),
    ).length,
    stopped: environments.filter((environment) => environment.status === 'stopped').length,
    attention: environments.filter(
      (environment) =>
        environment.statusTone === 'danger'
        || environment.statusTone === 'warning'
        || environment.lease.state === 'review'
        || environment.cleanup.state === 'failed'
        || environment.freshness !== 'fresh'
        || environment.ownership === 'unmanaged',
    ).length,
  }), [environments]);

  const selectedDetail =
    environments.find((environment) => environment.id === detailId) ?? null;
  const heldLeaseCount = environments.filter(
    (environment) => environment.lease.state === 'held',
  ).length;
  const trackedEnvironment =
    environments.find((environment) => environment.id === trackedEnvironmentId)
    ?? null;

  const refreshAll = useCallback(async () => {
    await Promise.all([
      readConfiguration(),
      readZones(),
      readEnvironments(false),
    ]);
    setCatalogReloadKey((value) => value + 1);
  }, [readConfiguration, readEnvironments, readZones]);

  const checkInventory = useCallback(
    async ({
      option,
      imageId,
      bootDiskGb,
      signal,
    }: {
      option: ComputeCatalogOption;
      imageId: string;
      bootDiskGb: number;
      signal: AbortSignal;
    }): Promise<InventoryCheck> => {
      const requestController = new AbortController();
      let timedOut = false;
      const forwardAbort = () => requestController.abort();
      if (signal.aborted) requestController.abort();
      else signal.addEventListener('abort', forwardAbort, { once: true });
      const timeout = window.setTimeout(() => {
        timedOut = true;
        requestController.abort();
      }, 45_000);
      try {
        const result = await api<{
          items: Capacity[];
          fetched_at: string;
          state: string;
          quote?: unknown;
        }>('/resources/ucloud/capacity', {
          ...json('POST', {
            region: option.region,
            zone: option.zone,
            gpu_type: option.gpuType,
            cpu: option.cpu,
            memory_mb: option.memoryGiB * 1024,
            cpu_platform: option.cpuPlatform,
            image_id: imageId,
            charge_type: option.chargeType,
            disks: [
              {
                IsBoot: true,
                Type: option.diskType,
                Size: bootDiskGb,
              },
            ],
          }),
          signal: requestController.signal,
        });
        const exact = result.items.find(
          (item) =>
            item.Gpu === 1
            && item.Cpu === option.cpu
            && item.Mem * 1024 === option.memoryGiB * 1024,
        );
        const state: InventoryCheck['state'] = exact?.ResourceEnough
          ? 'available'
          : 'out_of_stock';
        if (signal.aborted) throw new Error('库存查询已取消');
        setAvailability((current) => ({
          ...current,
          [option.id]: state,
        }));
        const quote = normalizeQuote(result.quote);
        return {
          state,
          checkedAt: result.fetched_at,
          quote,
        };
      } catch (error) {
        if (signal.aborted) throw error;
        setAvailability((current) => ({
          ...current,
          [option.id]: 'unknown',
        }));
        if (timedOut) {
          return {
            state: 'error',
            error:
              '库存与报价查询超过 45 秒，结果不可确认；不会据此推断有货，请稍后重试。',
            quote: normalizeQuote(null),
          };
        }
        return {
          state: 'error',
          error: `${messageOf(error)} 库存不可确认，不能推断有货或无货。`,
          quote: normalizeQuote(null),
        };
      } finally {
        window.clearTimeout(timeout);
        signal.removeEventListener('abort', forwardAbort);
      }
    },
    [],
  );

  const pollEnvironment = useCallback(
    async (environmentId: string) => {
      for (let attempt = 0; attempt < 20; attempt += 1) {
        await sleep(attempt === 0 ? 500 : 1500);
        if (!mounted.current) return;
        const collection = await readEnvironments(false);
        const current = collection?.items.find(
          (environment) => environment.id === environmentId,
        );
        if (!current) continue;
        setTrackedEnvironmentId(environmentId);
        if (
          !['creating', 'starting', 'stopping']
            .includes(current.status)
        ) {
          return;
        }
      }
    },
    [readEnvironments],
  );

  const createEnvironment = useCallback(
    async (payload: CreateEnvironmentPayload): Promise<CreateAccepted> => {
      const accepted = await createComputeEnvironment(
        {
          name: payload.name,
          spec: {
            region: payload.spec.region,
            zone: payload.spec.zone,
            gpu_type: payload.spec.gpuType,
            cpu: payload.spec.cpu,
            memory_mb: payload.spec.memoryMb,
            image_id: payload.spec.imageId,
            cpu_platform: payload.spec.cpuPlatform,
            charge_type: payload.spec.chargeType,
            boot_disk_gb: payload.spec.bootDiskGb,
            boot_disk_type: payload.spec.bootDiskType,
          },
        },
        undefined,
        payload.requestId,
      );
      if (accepted.environmentId) {
        setTrackedEnvironmentId(accepted.environmentId);
        void pollEnvironment(accepted.environmentId);
      }
      notify(
        'ok',
        accepted.environmentId
          ? `${payload.name} 的创建命令已受理；正在等待实例与租约事实。`
          : `${payload.name} 的创建命令已受理；正在等待服务端返回环境事实。`,
      );
      return {
        environmentId: accepted.environmentId ?? undefined,
        operationId: accepted.operationId,
        acceptedAt: accepted.acceptedAt ?? new Date().toISOString(),
      };
    },
    [notify, pollEnvironment],
  );

  const refreshDetail = useCallback(async () => {
    if (!detailId) return;
    detailController.current?.abort();
    const controller = new AbortController();
    detailController.current = controller;
    setDetailBusy(true);
    try {
      const collection = await readEnvironments(false);
      const current = collection?.items.find(
        (environment) => environment.id === detailId,
      );
      if (current) {
        notify('ok', `已刷新 ${current.name} 的实例、租约与监控事实。`);
      } else if (!controller.signal.aborted) {
        notify('error', '环境已不在当前列表中；保留现有详情供核对。');
      }
    } finally {
      if (detailController.current === controller) {
        detailController.current = null;
        if (mounted.current) setDetailBusy(false);
      }
    }
  }, [detailId, notify, readEnvironments]);

  const confirmAction = useCallback(
    async (
      action: ComputeAction,
      requestId: string,
    ): Promise<CommandAccepted> => {
      if (!actionDialog) throw new Error('缺少待执行的计算环境。');
      if (!configuration?.writeEnabled) {
        throw new Error(
          configuration?.reason
            ?? '后端当前未开启计算环境写入能力，命令未发送。',
        );
      }
      const target = actionDialog.environment;
      const result =
        action === 'start'
          ? await startComputeEnvironment(target.id, undefined, requestId)
          : action === 'stop'
            ? await stopComputeEnvironment(target.id, undefined, requestId)
            : await deleteComputeEnvironment(target.id, target.name, {
              acknowledgeDataLoss: true,
              cleanupPolicy: 'discard',
              requestId,
            });
      notify(
        'ok',
        `${target.name} 的${
          action === 'start' ? '启动' : action === 'stop' ? '停止' : '删除'
        }命令已受理，最终结果等待实例、清理和租约事实同步。`,
      );
      void pollEnvironment(target.id);
      return {
        operationId: result.operationId,
        acceptedAt: result.acceptedAt ?? new Date().toISOString(),
        message:
          action === 'delete'
            ? '删除命令已受理，清理结果仍待确认。'
            : action === 'stop'
              ? '停止命令已受理，租约与存储状态仍待确认。'
              : '启动命令已受理，供应商状态仍待确认。',
      };
    },
    [actionDialog, configuration, notify, pollEnvironment],
  );

  const onOpenWizard = (
    draft: EnvironmentDraft,
    inventory: InventoryCheck,
  ) => {
    setWizardDraft(draft);
    setWizardInventory(inventory);
    setWizardOpen(true);
  };

  const changeTab = (next: WorkbenchTab) => {
    setTab(next);
  };

  const handleTabKey = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    current: WorkbenchTab,
  ) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const next = current === 'market' ? 'console' : 'market';
    changeTab(next);
    requestAnimationFrame(() => {
      document.getElementById(`mf-tab-${next}`)?.focus();
    });
  };

  return (
    <div className="mf-compute">
      <header className="mf-compute-heading">
        <div>
          <span className="mf-compute-eyebrow">
            <ComputeIcon name="grid" />
            COMPUTE OPERATIONS
          </span>
          <h1>计算环境</h1>
          <p>
            按真实资源目录组装单卡环境；库存、官方报价与兼容性分别核对，
            创建后在实例控制台跟踪生命周期、GPU 租约与清理事实。
          </p>
        </div>
        <div className="mf-compute-heading-actions">
          <button
            type="button"
            className="mf-secondary"
            onClick={() => void refreshAll()}
            disabled={configurationLoading || zonesLoading || catalogLoading}
          >
            <ComputeIcon name="refresh" />
            {catalogLoading || zonesLoading ? '同步中' : '刷新事实'}
          </button>
        </div>
      </header>

      <span className="mf-sr-only" role="status" aria-live="polite" aria-atomic="true">
        {notice?.message ?? ''}
      </span>
      {notice && (
        <div
          className={
            notice.tone === 'ok'
              ? 'mf-compute-mode-banner'
              : 'mf-compute-error'
          }
          role={notice.tone === 'error' ? 'alert' : 'status'}
        >
          <ComputeIcon name={notice.tone === 'ok' ? 'check' : 'alert'} />
          <span>{notice.message}</span>
          <button
            type="button"
            className="mf-quiet"
            aria-label="关闭通知"
            onClick={() => setNotice(null)}
          >
            <ComputeIcon name="close" />
          </button>
        </div>
      )}

      <div className="mf-compute-mode-banner">
        <ComputeIcon
          name={configuration?.writeEnabled ? 'shield' : 'lock'}
        />
        <span>
          <strong>
            {configurationLoading
              ? '正在读取后端能力'
              : configuration?.writeEnabled
                ? '实例写入已由后端显式开放'
                : '当前为真实数据只读模式'}
          </strong>
          {' · '}
          {configurationError
            ? configurationError
            : configuration?.reason
              ?? '官方报价与库存均为带查询时间的快照；不编造报价、实例或事件。'}
        </span>
      </div>

      {(environmentCollection?.degraded
        || environmentCollection?.sourceState === 'stale'
        || (environmentCollection?.warnings.length ?? 0) > 0) && (
        <div className="mf-compute-warning" role="status">
          <ComputeIcon name="clock" />
          <span>
            <strong>实例聚合存在降级或过期证据</strong>
            {' · '}
            {environmentCollection?.warnings.join(' ') ||
              '部分供应商事实不可确认；未知记录仍保留并进入异常队列。'}
          </span>
        </div>
      )}

      {zonesError && (
        <div className="mf-compute-error" role="alert">
          <ComputeIcon name="alert" />
          <span>
            <strong>地域目录读取失败</strong>
            {' · '}
            {zonesError}
          </span>
          <button
            type="button"
            className="mf-secondary"
            onClick={() => void readZones()}
          >
            重试
          </button>
        </div>
      )}

      <nav className="mf-compute-tabs" role="tablist" aria-label="计算环境工作区">
        <button
          id="mf-tab-market"
          type="button"
          role="tab"
          aria-selected={tab === 'market'}
          aria-controls="mf-compute-market"
          tabIndex={tab === 'market' ? 0 : -1}
          onClick={() => changeTab('market')}
          onKeyDown={(event) => handleTabKey(event, 'market')}
        >
          <ComputeIcon name="grid" />
          资源与配置
          <span className="mf-compute-tab-count">{marketOptions.length}</span>
        </button>
        <button
          id="mf-tab-console"
          type="button"
          role="tab"
          aria-selected={tab === 'console'}
          aria-controls="mf-compute-console"
          tabIndex={tab === 'console' ? 0 : -1}
          onClick={() => changeTab('console')}
          onKeyDown={(event) => handleTabKey(event, 'console')}
        >
          <ComputeIcon name="server" />
          实例控制台
          <span className="mf-compute-tab-count">{environments.length}</span>
          {environmentSummary.attention > 0 && (
            <span className="mf-compute-tab-alert">
              {environmentSummary.attention} 待处理
            </span>
          )}
        </button>
        <small>目录可见 ≠ 库存可用 ≠ 兼容已验证</small>
      </nav>

      {tab === 'market' ? (
        <section
          id="mf-compute-market"
          role="tabpanel"
          aria-labelledby="mf-tab-market"
        >
          <ResourceConfigurator
            options={marketOptions}
            selectedId={selectedId}
            onSelect={setSelectedId}
            filters={filters}
            onFiltersChange={setFilters}
            regionOptions={regionOptions}
            zoneOptions={zoneOptions}
            images={images}
            imageTotal={imageTotal}
            loading={catalogLoading || zonesLoading}
            error={catalogError || zonesError}
            stale={catalogStale}
            queryTime={catalogFetchedAt}
            configuration={configuration}
            onCheck={checkInventory}
            onRetry={() => setCatalogReloadKey((value) => value + 1)}
            onCreate={onOpenWizard}
            onClearFilters={() =>
              setFilters((current) => ({
                ...emptyFilters,
                region: current.region,
                imageType: current.imageType,
              }))
            }
          />
        </section>
      ) : (
        <section
          id="mf-compute-console"
          role="tabpanel"
          aria-labelledby="mf-tab-console"
        >
          <section
            className="mf-compute-metrics"
            aria-label="计算环境关键指标"
          >
            <article className="mf-compute-metric">
              <span>实例总数</span>
              <strong>{environmentSummary.total}</strong>
              <small>
                {environmentSummary.running} 运行 ·{' '}
                {environmentSummary.transitioning} 变更中 ·{' '}
                {environmentSummary.stopped} 已停止
              </small>
            </article>
            <article
              className={
                environmentSummary.attention
                  ? 'mf-compute-metric attention'
                  : 'mf-compute-metric'
              }
            >
              <span>需要核对</span>
              <strong>{environmentSummary.attention}</strong>
              <small>失败、不可用、未知、租约或清理异常</small>
            </article>
            <article className="mf-compute-metric">
              <span>硬件组合</span>
              <strong>{marketOptions.length}</strong>
              <small>
                {catalogFetchedAt
                  ? `目录查询 ${new Date(catalogFetchedAt).toLocaleTimeString(
                      'zh-CN',
                      {
                        hour: '2-digit',
                        minute: '2-digit',
                        hour12: false,
                      },
                    )}`
                  : '尚未取得目录查询时间'}
              </small>
            </article>
            <article className="mf-compute-metric ownership">
              <div>
                <span>资源归属</span>
                <strong>个人工作空间</strong>
                <small>训练与推理共用 GPU 租约边界</small>
              </div>
              <b aria-label={`${heldLeaseCount} 个 GPU 租约持有中`}>
                <span>{heldLeaseCount}</span>
                <small>GPU 租约</small>
              </b>
            </article>
          </section>
          <InstanceConsole
            environments={environments}
            loading={environmentsLoading}
            error={environmentsError}
            refreshedAt={environmentCollection?.fetchedAt ?? undefined}
            onRefresh={() => void readEnvironments(false)}
            onRetry={() => void readEnvironments(true)}
            onDetail={(environment) => setDetailId(environment.id)}
            onAction={(action, environment) =>
              setActionDialog({ action, environment })
            }
          />
        </section>
      )}

      {wizardOpen && wizardDraft && (
        <CreateEnvironmentWizard
          options={marketOptions}
          initialDraft={wizardDraft}
          initialInventory={wizardInventory}
          configuration={configuration}
          images={images}
          imageType={filters.imageType}
          imagesLoading={catalogLoading}
          imagesError={catalogError}
          imagesStale={catalogStale}
          imageTotal={imageTotal}
          onRetryImages={() => setCatalogReloadKey((value) => value + 1)}
          onClose={() => {
            setWizardOpen(false);
            setWizardDraft(null);
            setWizardInventory({ state: 'unknown' });
          }}
          onCheckInventory={checkInventory}
          onCreate={createEnvironment}
          trackedEnvironment={trackedEnvironment}
        />
      )}

      {selectedDetail && (
        <EnvironmentDetail
          environment={selectedDetail}
          busy={detailBusy}
          onClose={() => setDetailId('')}
          onRefresh={() => void refreshDetail()}
          onAction={(action, environment) =>
            setActionDialog({ action, environment })
          }
        />
      )}

      {actionDialog && (
        <DangerousActionDialog
          action={actionDialog.action}
          environment={actionDialog.environment}
          onClose={() => setActionDialog(null)}
          onConfirm={confirmAction}
        />
      )}
    </div>
  );
}
