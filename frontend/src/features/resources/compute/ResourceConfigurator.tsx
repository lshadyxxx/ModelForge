import { useEffect, useMemo, useRef, useState } from 'react';
import { SelectMenu } from '../../../shared/SelectMenu';
import type { Image } from '../api';
import { ComputeIcon } from './ComputeIcon';
import { ComputeStatusBadge } from './ComputeStatusBadge';
import type { InventoryCheck } from './CreateEnvironmentWizard';
import { unavailableQuote, type ComputeQuote } from './compute-model';
import { quoteObservedAt, quoteRate } from './compute-quote';
import type { ComputeConfigurationView } from './compute-ui-types';
import { ImageCatalogPicker } from './ImageCatalogPicker';
import {
  imageAvailability,
  imageFamily,
  imagePlatform,
  imageTypeLabel,
  preferredAvailableImage,
} from './image-catalog';
import {
  selectionKey,
  type EnvironmentDraft,
} from './compute-catalog';
import type {
  ComputeCatalogOption,
  MarketFilters,
} from './ResourceMarket';

type OptionValue = {
  value: string;
  label: string;
};

type GpuGroup = {
  key: string;
  gpuType: string;
  graphicsMemoryGb: number;
  option: ComputeCatalogOption;
};

function gpuLabel(value: string) {
  return /^\d+$/.test(value) ? `RTX ${value}` : value;
}

function inventoryTone(state: InventoryCheck['state']) {
  if (state === 'available') return 'ok' as const;
  if (state === 'out_of_stock') return 'warning' as const;
  if (state === 'error') return 'danger' as const;
  return 'neutral' as const;
}

function inventoryLabel(checking: boolean, state: InventoryCheck['state']) {
  if (checking) return '正在核对';
  if (state === 'available') return '查询时有货';
  if (state === 'out_of_stock') return '查询时无库存';
  if (state === 'error') return '查询失败';
  return '尚未核对';
}

function groupedGpus(options: ComputeCatalogOption[]): GpuGroup[] {
  const groups = new Map<string, GpuGroup>();
  for (const option of options) {
    const key = `${option.gpuType}|${option.graphicsMemoryGb}`;
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        gpuType: option.gpuType,
        graphicsMemoryGb: option.graphicsMemoryGb,
        option,
      });
    }
  }
  return [...groups.values()];
}

export function ResourceConfigurator({
  options,
  selectedId,
  onSelect,
  filters,
  onFiltersChange,
  regionOptions,
  zoneOptions,
  images,
  imageTotal,
  loading,
  error,
  stale,
  queryTime,
  configuration,
  onCheck,
  onRetry,
  onCreate,
  onClearFilters,
}: {
  options: ComputeCatalogOption[];
  selectedId: string;
  onSelect: (id: string) => void;
  filters: MarketFilters;
  onFiltersChange: (next: MarketFilters) => void;
  regionOptions: OptionValue[];
  zoneOptions: OptionValue[];
  images: Image[];
  imageTotal?: number;
  loading: boolean;
  error: string;
  stale: boolean;
  queryTime?: string;
  configuration: ComputeConfigurationView | null;
  onCheck: (selection: EnvironmentDraft & {
    signal: AbortSignal;
  }) => Promise<InventoryCheck>;
  onRetry: () => void;
  onCreate: (draft: EnvironmentDraft, inventory: InventoryCheck) => void;
  onClearFilters: () => void;
}) {
  const selected =
    options.find((option) => option.id === selectedId) ?? options[0] ?? null;
  const gpus = useMemo(() => groupedGpus(options), [options]);
  const cpuVariants = useMemo(
    () =>
      options
        .filter(
          (option) =>
            selected
            && option.gpuType === selected.gpuType
            && option.graphicsMemoryGb === selected.graphicsMemoryGb,
        )
        .sort(
          (left, right) =>
            left.memoryGiB - right.memoryGiB || left.cpu - right.cpu,
        ),
    [options, selected],
  );
  const [imageId, setImageId] = useState('');
  const [imagePickerOpen, setImagePickerOpen] = useState(false);
  const [bootDiskGb, setBootDiskGb] = useState(60);
  const [checking, setChecking] = useState(false);
  const [inventory, setInventory] = useState<InventoryCheck>({
    state: 'unknown',
  });
  const checkController = useRef<AbortController | null>(null);
  const imageBrowseRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setImageId((current) => {
      if (
        images.some(
          (image) =>
            image.CompShareImageId === current
            && imageAvailability(image).available,
        )
      ) {
        return current;
      }
      if (
        selected
        && images.some(
          (image) =>
            image.CompShareImageId === selected.imageId
            && imageAvailability(image).available,
        )
      ) {
        return selected.imageId;
      }
      return preferredAvailableImage(images)?.CompShareImageId ?? '';
    });
  }, [images, selected]);

  useEffect(() => {
    if (!selected) return;
    setBootDiskGb((current) => {
      const min = selected.diskMinGiB ?? 1;
      const max = selected.diskMaxGiB ?? 1_000_000;
      return current >= min && current <= max
        ? current
        : selected.diskMinGiB ?? 60;
    });
  }, [selected]);

  const selectedImage =
    images.find((image) => image.CompShareImageId === imageId) ?? null;
  const activeOption = selected
    ? {
        ...selected,
        imageId,
        imageName: selectedImage?.Name ?? selected.imageName,
        selectedBootDiskGiB: bootDiskGb,
      }
    : null;
  const activeDraft =
    activeOption && imageId
      ? { option: activeOption, imageId, bootDiskGb }
      : null;
  const activeSelectionKey = activeDraft ? selectionKey(activeDraft) : '';
  const diskMinGiB = selected?.diskMinGiB ?? 1;
  const diskMaxGiB = selected?.diskMaxGiB ?? 1_000_000;
  const diskValid =
    Number.isInteger(bootDiskGb)
    && bootDiskGb >= diskMinGiB
    && bootDiskGb <= diskMaxGiB;

  useEffect(() => {
    checkController.current?.abort();
    checkController.current = null;
    setChecking(false);
    setInventory({ state: 'unknown' });
  }, [
    activeSelectionKey,
    filters.imageType,
    filters.region,
    filters.zone,
  ]);

  useEffect(
    () => () => {
      checkController.current?.abort();
    },
    [],
  );

  const quote: ComputeQuote =
    inventory.quote ?? unavailableQuote();
  const quoteLabel = quoteRate(quote);
  const checkedAt = inventory.checkedAt;
  const visibleRegions = regionOptions.filter((option) => option.value);
  const visibleZones = zoneOptions.filter((option) => option.value);
  const selectedAvailability = selectedImage
    ? imageAvailability(selectedImage)
    : null;
  const selectedFamily = selectedImage
    ? selectedImage.ImageType === 'App'
      ? imageFamily(selectedImage).label
      : imagePlatform(selectedImage).label
    : '';

  function updateScope(patch: Partial<MarketFilters>) {
    onFiltersChange({
      ...filters,
      ...patch,
      imageName: '',
      gpuType: '',
      cpuMemory: '',
      price: '',
      stock: 'all',
    });
  }

  function chooseGpu(group: GpuGroup) {
    const matching =
      options.find(
        (option) =>
          option.gpuType === group.gpuType
          && option.graphicsMemoryGb === group.graphicsMemoryGb
          && option.cpu === selected?.cpu
          && option.memoryGiB === selected?.memoryGiB,
      )
      ?? options.find(
        (option) =>
          option.gpuType === group.gpuType
          && option.graphicsMemoryGb === group.graphicsMemoryGb,
      );
    if (matching) onSelect(matching.id);
  }

  function closeImagePicker() {
    setImagePickerOpen(false);
    window.requestAnimationFrame(() => imageBrowseRef.current?.focus());
  }

  async function checkSelection() {
    if (!activeDraft || !diskValid) return;
    checkController.current?.abort();
    const controller = new AbortController();
    checkController.current = controller;
    setChecking(true);
    setInventory({ state: 'checking' });
    try {
      const result = await onCheck({
        ...activeDraft,
        signal: controller.signal,
      });
      if (!controller.signal.aborted) setInventory(result);
    } catch (caught) {
      if (!controller.signal.aborted) {
        setInventory({
          state: 'error',
          error:
            caught instanceof Error
              ? caught.message
              : '库存与报价不可确认，不能推断为有货。',
        });
      }
    } finally {
      if (checkController.current === controller) {
        checkController.current = null;
        setChecking(false);
      }
    }
  }

  if (loading && !options.length) {
    return (
      <div className="mf-configurator mf-configurator-loading" aria-busy="true">
        <div className="mf-config-main">
          <div className="mf-skeleton config-wide" />
          <div className="mf-skeleton config-main" />
        </div>
        <aside className="mf-config-summary">
          <div className="mf-skeleton config-summary" />
        </aside>
        <span className="mf-sr-only" role="status">正在读取资源目录</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mf-config-state" role="alert">
        <span><ComputeIcon name="alert" size={22} /></span>
        <div>
          <h2>资源目录读取失败</h2>
          <p>{error}</p>
        </div>
        <button type="button" className="mf-secondary" onClick={onRetry}>
          <ComputeIcon name="refresh" />
          重新读取
        </button>
      </div>
    );
  }

  if (!options.length) {
    return (
      <div className="mf-config-state">
        <span><ComputeIcon name="search" size={22} /></span>
        <div>
          <h2>当前地域没有可用配置</h2>
          <p>没有结果不等于库存为零。可以切换地域或恢复默认条件。</p>
        </div>
        <button type="button" className="mf-secondary" onClick={onClearFilters}>
          恢复默认条件
        </button>
      </div>
    );
  }

  return (
    <div
      className={`mf-configurator${imagePickerOpen ? ' has-open-image-catalog' : ''}`}
    >
      <div className="mf-config-main">
        {stale && (
          <div className="mf-compute-warning" role="status">
            <ComputeIcon name="clock" />
            <span>筛选条件已变化，旧目录结果不会被采用。</span>
          </div>
        )}

        <section className="mf-config-image" aria-labelledby="mf-image-title">
          <div className="mf-config-image-mark">
            <ComputeIcon name="image" size={24} />
          </div>
          <div className="mf-config-image-copy">
            <span className="mf-config-kicker">运行环境</span>
            <h2 id="mf-image-title">
              {selectedImage?.Name ?? '尚无可用运行镜像'}
            </h2>
            <p>
              {imageTypeLabel(selectedImage?.ImageType)}
              {selectedImage && (
                <>
                  <span
                    className={`mf-image-status ${selectedAvailability?.tone ?? 'warning'}`}
                  >
                    <i aria-hidden="true" />
                    {selectedAvailability?.label}
                  </span>
                  <span>{selectedFamily}</span>
                  <span className="mono">
                    {selectedImage.CompShareImageId}
                  </span>
                </>
              )}
            </p>
          </div>
          <div className="mf-config-image-actions">
            <div className="mf-config-segment" role="group" aria-label="镜像类型">
              {[
                { value: 'System', label: '系统镜像' },
                { value: 'App', label: '应用镜像' },
              ].map((item) => (
                <button
                  key={item.value}
                  type="button"
                  aria-pressed={filters.imageType === item.value}
                  onClick={() =>
                    updateScope({ imageType: item.value })
                  }
                >
                  {item.label}
                </button>
              ))}
            </div>
            <button
              ref={imageBrowseRef}
              type="button"
              className="mf-image-browse"
              aria-expanded={imagePickerOpen}
              aria-controls="mf-image-catalog"
              onClick={() => setImagePickerOpen((open) => !open)}
            >
              <ComputeIcon name="search" size={15} />
              <span>
                {imagePickerOpen ? '收起镜像目录' : '浏览镜像目录'}
              </span>
              <small>{images.length ? `${images.length} 个` : '—'}</small>
              <ComputeIcon
                name="chevron-down"
                size={14}
                className={imagePickerOpen ? 'is-open' : ''}
              />
            </button>
          </div>
          {imagePickerOpen && (
            <div id="mf-image-catalog" className="mf-image-catalog-slot">
              <ImageCatalogPicker
                images={images}
                imageType={filters.imageType}
                selectedImageId={imageId}
                loading={loading}
                stale={stale}
                error={error}
                total={imageTotal}
                onSelect={setImageId}
                onClose={closeImagePicker}
                onRetry={onRetry}
              />
            </div>
          )}
        </section>

        <section className="mf-config-card" aria-labelledby="mf-config-basic">
          <header className="mf-config-card-head">
            <div>
              <span className="mf-config-index">01</span>
              <div>
                <h2 id="mf-config-basic">实例配置</h2>
                <p>先确定地域和资源规格，再核对库存与官方报价。</p>
              </div>
            </div>
            <span className="mf-config-directory-time">
              {queryTime
                ? `目录 ${new Date(queryTime).toLocaleTimeString('zh-CN', {
                    hour: '2-digit',
                    minute: '2-digit',
                    hour12: false,
                  })}`
                : '目录时间未知'}
            </span>
          </header>

          <fieldset className="mf-config-fieldset">
            <legend>地域</legend>
            <div
              className="mf-region-tabs"
              role="radiogroup"
              aria-label="选择地域"
            >
              {visibleRegions.map((region) => (
                <button
                  key={region.value}
                  type="button"
                  role="radio"
                  aria-checked={filters.region === region.value}
                  onClick={() => updateScope({ region: region.value, zone: '' })}
                >
                  <strong>{region.label}</strong>
                  <small>{region.value}</small>
                </button>
              ))}
            </div>
          </fieldset>

          <div className="mf-config-field-row">
            <label className="mf-config-field">
              <span>可用区</span>
              <SelectMenu
                value={filters.zone}
                options={visibleZones}
                onChange={(zone) => updateScope({ zone })}
                ariaLabel="选择可用区"
                placeholder="选择可用区"
                emptyText="当前地域没有可用区"
                disabled={loading || !visibleZones.length}
              />
              <small>目录只返回对应地域下可见的可用区。</small>
            </label>
            <div className="mf-config-field">
              <span>实例类型</span>
              <div className="mf-config-readonly">
                <ComputeIcon name="server" />
                <div>
                  <strong>云主机 · uhost</strong>
                  <small>当前只查询单卡 GPU 实例</small>
                </div>
              </div>
            </div>
          </div>

          <fieldset className="mf-config-fieldset">
            <legend>GPU 型号</legend>
            <div
              className="mf-gpu-choices"
              role="radiogroup"
              aria-label="选择 GPU 型号"
            >
              {gpus.map((group) => {
                const active =
                  selected?.gpuType === group.gpuType
                  && selected.graphicsMemoryGb === group.graphicsMemoryGb;
                return (
                  <button
                    type="button"
                    role="radio"
                    aria-checked={active}
                    className={active ? 'is-active' : ''}
                    key={group.key}
                    onClick={() => chooseGpu(group)}
                  >
                    <span className="mf-gpu-choice-mark">GPU</span>
                    <span>
                      <strong>{gpuLabel(group.gpuType)}</strong>
                      <small>{group.graphicsMemoryGb} GB 显存 · 单卡</small>
                    </span>
                    <i aria-hidden="true">
                      {active && <ComputeIcon name="check" size={12} />}
                    </i>
                  </button>
                );
              })}
            </div>
          </fieldset>

          <div className="mf-config-field-row">
            <div className="mf-config-field">
              <span>GPU 数量</span>
              <div className="mf-config-locked-value">
                <strong>1 卡</strong>
                <small>当前方案只支持单卡实例</small>
              </div>
            </div>
            <fieldset className="mf-config-field">
              <legend>CPU / 内存</legend>
              <div
                className="mf-cpu-choices"
                role="radiogroup"
                aria-label="选择 CPU 和内存"
              >
                {cpuVariants.map((option) => (
                  <button
                    key={`${option.cpu}-${option.memoryGiB}`}
                    type="button"
                    role="radio"
                    aria-checked={option.id === selected?.id}
                    className={option.id === selected?.id ? 'is-active' : ''}
                    onClick={() => onSelect(option.id)}
                  >
                    <strong>{option.cpu}C</strong>
                    <span>{option.memoryGiB} GiB</span>
                  </button>
                ))}
              </div>
            </fieldset>
          </div>

          <div className="mf-config-field-row storage">
            <label className="mf-config-field">
              <span>系统盘容量</span>
              <div className="mf-disk-input">
                <input
                  type="number"
                  min={diskMinGiB}
                  max={diskMaxGiB}
                  step={1}
                  value={bootDiskGb}
                  aria-invalid={!diskValid}
                  onChange={(event) => setBootDiskGb(Number(event.target.value))}
                />
                <span>GiB</span>
              </div>
              <small className={diskValid ? '' : 'is-error'}>
                {diskValid
                  ? `可设置 ${diskMinGiB}–${diskMaxGiB} GiB`
                  : `系统盘需为 ${diskMinGiB}–${diskMaxGiB} GiB 的整数`}
              </small>
            </label>
            <div className="mf-config-field">
              <span>磁盘类型</span>
              <div className="mf-config-readonly compact">
                <ComputeIcon name="server" />
                <div>
                  <strong>{selected?.diskType ?? 'CLOUD_SSD'}</strong>
                  <small>来自当前供应商目录</small>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="mf-config-fact-strip" aria-label="目录事实边界">
          <div>
            <span>目录可见</span>
            <strong>不等于有货</strong>
          </div>
          <div>
            <span>库存有货</span>
            <strong>不保留资源</strong>
          </div>
          <div>
            <span>兼容性</span>
            <strong>{selected?.compatibility === 'verified' ? '已验证' : '未验证'}</strong>
          </div>
          <div>
            <span>写入能力</span>
            <strong>{configuration?.writeEnabled ? '已开放' : '只读'}</strong>
          </div>
        </section>
      </div>

      <aside className="mf-config-summary" aria-labelledby="mf-summary-title">
        <header>
          <div>
            <span className="mf-config-kicker">CONFIGURATION</span>
            <h2 id="mf-summary-title">当前配置</h2>
          </div>
          <ComputeStatusBadge
            label={inventoryLabel(checking, inventory.state)}
            tone={inventoryTone(inventory.state)}
            compact
          />
        </header>

        <div className="mf-config-summary-hero">
          <span className="mf-gpu-mark large">GPU</span>
          <div>
            <strong>{gpuLabel(selected?.gpuType ?? '')}</strong>
            <small>
              {selected?.graphicsMemoryGb ?? 0} GB 显存 · 1 卡
            </small>
          </div>
        </div>

        <dl className="mf-config-summary-facts">
          <div>
            <dt>地域 / 可用区</dt>
            <dd>
              {visibleRegions.find((item) => item.value === filters.region)?.label
                ?? filters.region}
              {' · '}
              {filters.zone}
            </dd>
          </div>
          <div>
            <dt>CPU / 系统内存</dt>
            <dd>{selected?.cpu ?? 0}C / {selected?.memoryGiB ?? 0} GiB</dd>
          </div>
          <div>
            <dt>运行镜像</dt>
            <dd>{selectedImage?.Name ?? '尚未选择'}</dd>
          </div>
          <div>
            <dt>系统盘</dt>
            <dd>{bootDiskGb} GiB · {selected?.diskType ?? 'CLOUD_SSD'}</dd>
          </div>
          <div>
            <dt>计费方式</dt>
            <dd>后付费 · Postpay</dd>
          </div>
          <div>
            <dt>资源归属</dt>
            <dd>个人工作空间</dd>
          </div>
        </dl>

        <section
          className="mf-config-check"
          aria-labelledby="mf-check-title"
          aria-busy={checking}
        >
          <div>
            <h3 id="mf-check-title">库存与报价</h3>
            <small aria-live="polite">
              {inventory.state === 'error'
                ? inventory.error
                : checkedAt
                  ? `核对于 ${new Date(checkedAt).toLocaleString('zh-CN', {
                      hour12: false,
                    })}`
                  : '按当前完整规格查询，不预留资源'}
            </small>
          </div>
          <button
            type="button"
            className="mf-secondary"
            onClick={() => void checkSelection()}
            disabled={checking || !activeDraft || !diskValid || loading || stale}
          >
            <ComputeIcon name="refresh" />
            {checking ? '核对中' : checkedAt ? '重新核对' : '核对库存与报价'}
          </button>
        </section>

        <div className="mf-config-price">
          <span>官方折后价</span>
          <strong>{quoteLabel ?? '待核对'}</strong>
          <small>
            {quoteLabel && quoteObservedAt(quote)
              ? `查询于 ${quoteObservedAt(quote)}，以供应商账单为准`
              : '未取得可验证报价时不展示估算金额'}
          </small>
        </div>

        <button
          type="button"
          className="mf-primary mf-config-submit"
          onClick={() => activeDraft && onCreate(activeDraft, inventory)}
          disabled={!activeDraft || !diskValid || loading || stale}
        >
          <ComputeIcon name="plus" />
          {configuration?.writeEnabled ? '继续创建环境' : '查看创建条件'}
        </button>
        <p className="mf-config-boundary">
          <ComputeIcon name="shield" />
          <span>
            目录可见、库存可用和兼容已验证是三种不同事实。停止实例不等于删除，
            系统盘等存储费用仍可能产生。
          </span>
        </p>
      </aside>

      <div className="mf-config-mobile-bar">
        <span>
          <small>{inventoryLabel(checking, inventory.state)}</small>
          <strong>{quoteLabel ?? '待核对报价'}</strong>
        </span>
        <button
          type="button"
          className="mf-primary"
          onClick={() => activeDraft && onCreate(activeDraft, inventory)}
          disabled={!activeDraft || !diskValid || loading || stale}
        >
          {configuration?.writeEnabled ? '继续创建' : '查看条件'}
        </button>
      </div>
    </div>
  );
}
