import { useEffect, useMemo, useState } from 'react';
import { ComputeIcon } from './ComputeIcon';
import { ComputeStatusBadge } from './ComputeStatusBadge';
import type { ComputeConfigurationView } from './compute-ui-types';
import { unavailableQuote, type ComputeQuote } from './compute-model';
import { quoteObservedAt, quoteRate } from './compute-quote';

export type MarketAvailability = 'unknown' | 'available' | 'out_of_stock';

export type ComputeCatalogOption = {
  id: string;
  region: string;
  zone: string;
  zoneLabel?: string;
  gpuType: string;
  graphicsMemoryGb: number;
  cpu: number;
  memoryGiB: number;
  cpuPlatform: string;
  imageId: string;
  imageName: string;
  imageType?: string;
  diskType: string;
  diskMinGiB?: number;
  diskMaxGiB?: number;
  chargeType: string;
  availability: MarketAvailability;
  availabilityLabel: string;
  capacityCheckedAt?: string;
  compatibility: 'unverified' | 'verified';
  quote?: ComputeQuote;
};

export type MarketFilters = {
  region: string;
  zone: string;
  gpuType: string;
  cpuMemory: string;
  imageType: string;
  imageName: string;
  price: string;
  stock: 'all' | 'available' | 'out_of_stock' | 'unknown';
};

type OptionValue = {
  value: string;
  label: string;
};

export function ResourceMarket({
  options,
  selectedId,
  onSelect,
  filters,
  onFiltersChange,
  regionOptions,
  zoneOptions,
  gpuOptions,
  cpuMemoryOptions,
  imageTypeOptions,
  imageNameOptions,
  loading,
  error,
  stale,
  queryTime,
  configuration,
  checking,
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
  gpuOptions: OptionValue[];
  cpuMemoryOptions: OptionValue[];
  imageTypeOptions: OptionValue[];
  imageNameOptions: OptionValue[];
  loading: boolean;
  error: string;
  stale: boolean;
  queryTime?: string;
  configuration: ComputeConfigurationView | null;
  checking: boolean;
  onCheck: () => void;
  onRetry: () => void;
  onCreate: (option: ComputeCatalogOption) => void;
  onClearFilters: () => void;
}) {
  const [sort, setSort] = useState<'default' | 'price' | 'stock'>('default');
  const [visibleCount, setVisibleCount] = useState(8);
  const sortedOptions = useMemo(() => {
    if (sort === 'price') {
      return [...options].sort((left, right) => {
        const leftRate = left.quote?.state === 'available' ? left.quote.hourly : null;
        const rightRate = right.quote?.state === 'available' ? right.quote.hourly : null;
        if (leftRate === null && rightRate === null) return 0;
        if (leftRate === null) return 1;
        if (rightRate === null) return -1;
        return leftRate - rightRate;
      });
    }
    if (sort !== 'stock') return options;
    const rank = { available: 0, unknown: 1, out_of_stock: 2 } as const;
    return [...options].sort(
      (left, right) =>
        rank[left.availability] - rank[right.availability]
        || left.gpuType.localeCompare(right.gpuType, 'zh-CN'),
    );
  }, [options, sort]);
  const quotedCount = options.filter(
    (option) => option.quote?.state === 'available',
  ).length;
  const selected = sortedOptions.find((item) => item.id === selectedId) ?? sortedOptions[0];
  const visibleOptions = sortedOptions.slice(0, visibleCount);
  useEffect(() => {
    setVisibleCount(8);
  }, [filters]);
  const set = <K extends keyof MarketFilters>(key: K, value: MarketFilters[K]) =>
    onFiltersChange({ ...filters, [key]: value });

  return (
    <div className="mf-market-layout">
      <aside className="mf-panel mf-market-filter" aria-labelledby="mf-market-filter-title">
        <div className="mf-panel-heading">
          <div>
            <h2 id="mf-market-filter-title">筛选配置</h2>
            <small>只筛选已查询目录，不预留资源</small>
          </div>
          <button
            type="button"
            className="mf-quiet"
            onClick={onClearFilters}
            disabled={loading}
          >
            重置
          </button>
        </div>
        <div className="mf-filter-fields">
          <label className="mf-field">
            <span>地域</span>
            <select
              value={filters.region}
              onChange={(event) => {
                onFiltersChange({
                  ...filters,
                  region: event.target.value,
                  zone: '',
                  gpuType: '',
                  cpuMemory: '',
                  imageType: 'System',
                  imageName: '',
                  stock: 'all',
                });
              }}
            >
              {regionOptions.map((option) => (
                <option value={option.value} key={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="mf-field">
            <span>可用区</span>
            <select
              value={filters.zone}
              onChange={(event) => {
                onFiltersChange({
                  ...filters,
                  zone: event.target.value,
                  gpuType: '',
                  cpuMemory: '',
                  stock: 'all',
                });
              }}
              disabled={!filters.region}
            >
              {zoneOptions.map((option) => (
                <option value={option.value} key={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="mf-field">
            <span>GPU / 硬件</span>
            <select
              value={filters.gpuType}
              onChange={(event) => {
                onFiltersChange({
                  ...filters,
                  gpuType: event.target.value,
                  cpuMemory: '',
                  stock: 'all',
                });
              }}
            >
              {gpuOptions.map((option) => (
                <option value={option.value} key={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="mf-field">
            <span>CPU / 内存</span>
            <select
              value={filters.cpuMemory}
              onChange={(event) => set('cpuMemory', event.target.value)}
            >
              {cpuMemoryOptions.map((option) => (
                <option value={option.value} key={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="mf-field">
            <span>镜像类型</span>
            <select
              value={filters.imageType}
              onChange={(event) => set('imageType', event.target.value)}
            >
              {imageTypeOptions.map((option) => (
                <option value={option.value} key={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="mf-field">
            <span>运行镜像</span>
            <select
              value={filters.imageName}
              onChange={(event) => set('imageName', event.target.value)}
            >
              {imageNameOptions.map((option) => (
                <option value={option.value} key={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="mf-field">
            <span>价格状态</span>
            <select
              value={filters.price}
              onChange={(event) => set('price', event.target.value)}
              aria-describedby="mf-price-boundary"
            >
              <option value="">全部报价状态</option>
              <option value="available">已有官方报价</option>
              <option value="pending">报价待核对</option>
            </select>
          </label>
          <label className="mf-field">
            <span>库存快照</span>
            <select
              value={filters.stock}
              onChange={(event) =>
                set('stock', event.target.value as MarketFilters['stock'])
              }
            >
              <option value="all">全部库存</option>
              <option value="available">查询时有库存</option>
              <option value="out_of_stock">库存不足</option>
              <option value="unknown">尚未查库存</option>
            </select>
          </label>
        </div>
        <p className="mf-filter-boundary" id="mf-price-boundary">
          <ComputeIcon name="shield" />
          <span>
            首次精确库存核对时同步查询官方折后价。未取得报价时明确显示待核对，不估算金额；库存仍不等于预留或训练兼容。
          </span>
        </p>
      </aside>

      <section className="mf-panel mf-market-results" aria-labelledby="mf-market-result-title">
        <div className="mf-market-results-head">
          <div>
            <strong id="mf-market-result-title">
              {loading ? '正在刷新真实资源目录' : `${options.length} 个单卡配置`}
            </strong>
            <small>
              {queryTime
                ? `目录查询：${new Date(queryTime).toLocaleString('zh-CN', { hour12: false })}`
                : '尚未取得目录查询时间'}
              {stale ? ' · 当前筛选条件已变化，旧结果不会被采用' : ''}
            </small>
          </div>
          <div className="mf-segment-control" role="group" aria-label="目录排序">
            <button
              type="button"
              aria-pressed={sort === 'default'}
              onClick={() => setSort('default')}
            >
              默认顺序
            </button>
            <button
              type="button"
              aria-pressed={sort === 'price'}
              onClick={() => setSort('price')}
              disabled={quotedCount === 0}
              title={
                quotedCount
                  ? '按已有官方小时价从低到高排序'
                  : '完成至少一次精确库存核对后可排序'
              }
            >
              价格排序
            </button>
            <button
              type="button"
              aria-pressed={sort === 'stock'}
              onClick={() => setSort('stock')}
            >
              库存优先
            </button>
          </div>
        </div>

        <span className="mf-sr-only" role="status" aria-live="polite" aria-atomic="true">
          {loading
            ? '正在加载资源市场目录'
            : error
              ? '资源市场目录加载失败'
              : `资源市场共 ${options.length} 个配置`}
        </span>

        {error && (
          <div className="mf-compute-error" role="alert">
            <ComputeIcon name="alert" />
            <span>
              <strong>资源目录读取失败</strong>
              <br />
              {error}
            </span>
            <button type="button" className="mf-secondary" onClick={onRetry}>
              <ComputeIcon name="refresh" />
              重试
            </button>
          </div>
        )}

        {!error && loading && (
          <div aria-label="正在加载资源目录" aria-busy="true">
            <div className="mf-market-cards">
              {[0, 1, 2, 3].map((index) => (
                <div className="mf-skeleton card" key={index} />
              ))}
            </div>
          </div>
        )}

        {!error && !loading && options.length === 0 && (
          <div className="mf-market-empty">
            <span>
              <ComputeIcon name="search" size={22} />
            </span>
            <h3>当前条件没有配置</h3>
            <p>
              调整地域、可用区、GPU 或 CPU/内存组合后重新查询。没有结果不等于库存为零。
            </p>
            <button type="button" className="mf-primary" onClick={onClearFilters}>
              清除筛选
            </button>
          </div>
        )}

        {!error && !loading && options.length > 0 && (
          <div className="mf-market-cards">
            {visibleOptions.map((option) => (
              <button
                type="button"
                className="mf-market-card"
                aria-pressed={option.id === selected?.id}
                key={option.id}
                onClick={() => onSelect(option.id)}
              >
                <span className="mf-market-card-top">
                  <span className="mf-market-card-title">
                    <span className="mf-gpu-mark">GPU</span>
                    <span>
                      <strong>{option.gpuType}</strong>
                      <small>
                        {option.graphicsMemoryGb} GB 显存 · {option.cpu} 核 ·{' '}
                        {option.memoryGiB} GiB
                      </small>
                    </span>
                  </span>
                  <ComputeStatusBadge
                    label={option.availabilityLabel}
                    tone={
                      option.availability === 'available'
                        ? 'ok'
                        : option.availability === 'out_of_stock'
                          ? 'warning'
                          : 'neutral'
                    }
                  />
                </span>
                <span className="mf-market-card-facts">
                  <span>
                    <small>地域 / 可用区</small>
                    <strong>
                      {option.region} · {option.zone}
                    </strong>
                  </span>
                  <span>
                    <small>运行镜像</small>
                    <strong>{option.imageName}</strong>
                  </span>
                  <span>
                    <small>CPU 平台</small>
                    <strong>{option.cpuPlatform}</strong>
                  </span>
                  <span>
                    <small>兼容性</small>
                    <strong>
                      {option.compatibility === 'verified'
                        ? '已验证'
                        : '未验证'}
                    </strong>
                  </span>
                </span>
                <span className="mf-market-card-footer">
                  <span
                    className={
                      option.quote?.state === 'available'
                        ? 'mf-quote-available'
                        : 'mf-quote-unavailable'
                    }
                    title={
                      option.quote?.state === 'available'
                        ? `官方折后价格；查询于 ${quoteObservedAt(option.quote) ?? '未知时间'}`
                        : '点击“核对库存与报价”后查询官方报价'
                    }
                  >
                    {quoteRate(option.quote ?? unavailableQuote())
                      ?? '核对后报价'}
                  </span>
                  <span className="mf-market-card-action">
                    {option.id === selected?.id ? '已选择' : '选择配置'}
                    <ComputeIcon name="arrow-right" size={13} />
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}
        {!error && !loading && sortedOptions.length > visibleOptions.length && (
          <div className="mf-market-more">
            <span>
              已显示 {visibleOptions.length} / {sortedOptions.length} 个配置
            </span>
            <button
              type="button"
              className="mf-secondary"
              onClick={() => setVisibleCount((count) => count + 8)}
            >
              显示更多
              <ComputeIcon name="chevron-down" />
            </button>
          </div>
        )}
      </section>

      <aside className="mf-panel mf-selection-card" aria-labelledby="mf-selection-title">
        <div className="mf-panel-heading">
          <div>
            <h2 id="mf-selection-title">当前选择</h2>
            <small>确认目录、库存与归属后再创建</small>
          </div>
          {selected && (
            <ComputeStatusBadge
              label={selected.availabilityLabel}
              tone={
                selected.availability === 'available'
                  ? 'ok'
                  : selected.availability === 'out_of_stock'
                    ? 'warning'
                    : 'neutral'
              }
            />
          )}
        </div>
        {selected ? (
          <>
            <span className="mf-compute-eyebrow">SELECTED CONFIG</span>
            <h2>
              {selected.gpuType} / {selected.memoryGiB} GiB
            </h2>
            <p>
              {selected.cpu} 核 · {selected.region} · {selected.imageName}
            </p>
            <dl className="mf-selection-facts">
              <div>
                <dt>目录库存</dt>
                <dd>{selected.availabilityLabel}</dd>
              </div>
              <div>
                <dt>查询时间</dt>
                <dd>
                  {selected.capacityCheckedAt
                    ? new Date(selected.capacityCheckedAt).toLocaleString('zh-CN', {
                        hour12: false,
                      })
                    : '尚未查询'}
                </dd>
              </div>
              <div>
                <dt>兼容性</dt>
                <dd>
                  {selected.compatibility === 'verified'
                    ? '已验证'
                    : '未验证'}
                </dd>
              </div>
              <div>
                <dt>资源归属</dt>
                <dd>个人工作空间</dd>
              </div>
              <div>
                <dt>价格</dt>
                <dd>
                  {quoteRate(selected.quote ?? unavailableQuote())
                    ?? '核对后报价'}
                </dd>
              </div>
            </dl>
            <div className="mf-inline-note">
              <ComputeIcon name="shield" />
              <span>
                {selected.quote?.state === 'available'
                  ? `官方折后价查询于 ${quoteObservedAt(selected.quote) ?? '未知时间'}；价格变化以供应商账单为准。`
                  : '点击“核对库存与报价”查询当前精确规格；没有真实价格时不估算费用。'}{' '}
                服务端仍会校验 GPU 租约与权限。
              </span>
            </div>
            <div className="mf-selection-actions" style={{ marginTop: 10 }}>
              <button
                type="button"
                className="mf-secondary"
                onClick={onCheck}
                disabled={checking}
              >
                <ComputeIcon name="refresh" />
                {checking ? '核对库存与报价中' : '核对库存与报价'}
              </button>
              <button
                type="button"
                className="mf-primary mf-wide"
                onClick={() => onCreate(selected)}
                disabled={loading || !selected.imageId}
                title={
                  configuration?.writeEnabled
                    ? undefined
                    : configuration?.reason ??
                      '当前后端未开启实例写入能力，可继续查看向导边界'
                }
              >
                <ComputeIcon name="plus" />
                {configuration?.writeEnabled ? '配置并创建' : '查看创建条件'}
              </button>
            </div>
            <small>停止不等于删除，停止后系统盘等存储费用仍可能继续产生。</small>
          </>
        ) : (
          <div className="mf-market-empty" style={{ minHeight: 220 }}>
            <span>
              <ComputeIcon name="server" size={22} />
            </span>
            <h3>先选择一个配置</h3>
            <p>真实目录加载后再确认库存、镜像与创建边界。</p>
          </div>
        )}
      </aside>
    </div>
  );
}
