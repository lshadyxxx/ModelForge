import { useEffect, useMemo, useRef, useState } from 'react';
import type { Image } from '../api';
import { ComputeIcon } from './ComputeIcon';
import { ComputeDialog } from './ComputeDialog';
import { ComputeStatusBadge } from './ComputeStatusBadge';
import { secureRequestId } from './compute-api';
import { unavailableQuote, type ComputeQuote } from './compute-model';
import { quoteObservedAt, quoteRate } from './compute-quote';
import {
  selectionKey,
  type EnvironmentDraft,
} from './compute-catalog';
import { ImageCatalogPicker } from './ImageCatalogPicker';
import {
  imageAvailability,
  imageFamily,
  imageMonogram,
  imagePlatform,
  imageTypeLabel,
  resolveImageSelection,
} from './image-catalog';
import type { ComputeCatalogOption } from './ResourceMarket';
import type {
  ComputeConfigurationView,
  ComputeEnvironmentView,
} from './compute-ui-types';

export type CreateEnvironmentPayload = {
  requestId: string;
  name: string;
  spec: {
    region: string;
    zone: string;
    gpuType: string;
    cpu: number;
    memoryMb: number;
    imageId: string;
    cpuPlatform: string;
    chargeType: string;
    bootDiskGb: number;
    bootDiskType: string;
  };
};

export type InventoryCheck = {
  state: 'checking' | 'available' | 'out_of_stock' | 'unknown' | 'error';
  checkedAt?: string;
  error?: string;
  quote?: ComputeQuote;
};

export type CreateAccepted = {
  environmentId?: string;
  operationId: string;
  acceptedAt: string;
};

const stepLabels = ['选择资源', '确认环境', '费用归属', '创建监控'];

function errorId(field: string) {
  return `mf-create-${field}-error`;
}

function runwayState(
  index: number,
  accepted: boolean,
  environment: ComputeEnvironmentView | null,
) {
  if (!accepted) {
    return index === 0 ? 'current' : 'pending';
  }
  if (!environment) {
    return index === 0 ? 'done' : index === 1 ? 'current' : 'pending';
  }
  if (
    environment.status === 'failed' ||
    environment.status === 'unavailable' ||
    environment.status === 'unknown'
  ) {
    return index === 0 ? 'done' : index === 1 ? 'failed' : 'pending';
  }
  if (environment.status === 'creating') {
    return index === 0 ? 'done' : index === 1 ? 'current' : 'pending';
  }
  if (environment.status === 'starting') {
    return index <= 1 ? 'done' : index === 2 ? 'current' : 'pending';
  }
  if (environment.status === 'running') {
    if (environment.lease.state === 'held') return 'done';
    return index <= 3 ? 'done' : 'current';
  }
  return index <= 1 ? 'done' : 'pending';
}

export function CreateEnvironmentWizard({
  options,
  initialDraft,
  initialInventory = { state: 'unknown' },
  configuration,
  images,
  imageType,
  imagesLoading,
  imagesError = '',
  imagesStale = false,
  imageTotal,
  onRetryImages,
  onClose,
  onCheckInventory,
  onCreate,
  trackedEnvironment,
}: {
  options: ComputeCatalogOption[];
  initialDraft: EnvironmentDraft;
  initialInventory?: InventoryCheck;
  configuration: ComputeConfigurationView | null;
  images: Image[];
  imageType: string;
  imagesLoading: boolean;
  imagesError?: string;
  imagesStale?: boolean;
  imageTotal?: number;
  onRetryImages: () => void;
  onClose: () => void;
  onCheckInventory: (payload: {
    option: ComputeCatalogOption;
    imageId: string;
    bootDiskGb: number;
    signal: AbortSignal;
  }) => Promise<InventoryCheck>;
  onCreate: (payload: CreateEnvironmentPayload) => Promise<CreateAccepted>;
  trackedEnvironment: ComputeEnvironmentView | null;
}) {
  const initialOption = initialDraft.option;
  const [step, setStep] = useState(2);
  const [selectedId, setSelectedId] = useState(initialOption.id);
  const selected =
    options.find((option) => option.id === selectedId) ?? initialOption;
  const defaultName = useMemo(
    () =>
      `forge-${selected.gpuType.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${new Date()
        .toISOString()
        .slice(5, 10)
        .replace('-', '')}`,
    [selected.gpuType],
  );
  const [name, setName] = useState(defaultName);
  const [imageId, setImageId] = useState(() =>
    resolveImageSelection(images, [
      initialDraft.imageId,
      initialOption.imageId,
    ]),
  );
  const [imagePickerOpen, setImagePickerOpen] = useState(false);
  const [imageAnnouncement, setImageAnnouncement] = useState('');
  const [bootDiskGb, setBootDiskGb] = useState(initialDraft.bootDiskGb);
  const [acknowledged, setAcknowledged] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [inventory, setInventory] = useState<InventoryCheck>(initialInventory);
  const [accepted, setAccepted] = useState<CreateAccepted | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [requestId] = useState(() => secureRequestId());
  const errorSummary = useRef<HTMLDivElement>(null);
  const imageBrowseRef = useRef<HTMLButtonElement>(null);
  const inventoryController = useRef<AbortController | null>(null);
  const initialSelectionKey = useRef(selectionKey(initialDraft));
  const useInitialInventory = useRef(
    initialInventory.state === 'available'
    || initialInventory.state === 'out_of_stock',
  );
  const selectedImage =
    images.find((image) => image.CompShareImageId === imageId) ?? null;
  const selectedImageAvailability = selectedImage
    ? imageAvailability(selectedImage)
    : null;
  const selectedImageFamily = selectedImage
    ? selectedImage.ImageType === 'App'
      ? imageFamily(selectedImage).label
      : imagePlatform(selectedImage).label
    : '';

  useEffect(() => {
    const nextImageId = resolveImageSelection(images, [
      imageId,
      initialDraft.imageId,
      selected.imageId,
    ]);
    if (nextImageId !== imageId) {
      setImageId(nextImageId);
      setInventory({ state: 'unknown' });
    }
  }, [imageId, images, initialDraft.imageId, selected.imageId]);

  useEffect(() => {
    if (step === 2) return;
    setImagePickerOpen(false);
  }, [step]);

  useEffect(() => {
    if (step !== 2) return;
    if (imagesLoading || imagesStale) {
      inventoryController.current?.abort();
      setInventory((current) =>
        current.state === 'unknown' ? current : { state: 'unknown' },
      );
      return;
    }
    if (!imageId || imagesError || !selectedImage) {
      inventoryController.current?.abort();
      setInventory((current) =>
        current.state === 'unknown' ? current : { state: 'unknown' },
      );
      return;
    }
    const currentSelectionKey = selectionKey({
      option: selected,
      imageId,
      bootDiskGb,
    });
    if (
      useInitialInventory.current
      && currentSelectionKey === initialSelectionKey.current
    ) {
      useInitialInventory.current = false;
      return;
    }
    useInitialInventory.current = false;
    inventoryController.current?.abort();
    const controller = new AbortController();
    inventoryController.current = controller;
    setInventory({ state: 'checking' });
    void onCheckInventory({
      option: selected,
      imageId,
      bootDiskGb,
      signal: controller.signal,
    })
      .then((result) => {
        if (!controller.signal.aborted) setInventory(result);
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setInventory({
          state: 'error',
          error:
            error instanceof Error ? error.message : '库存查询结果不可确认。',
        });
      });
    return () => controller.abort();
  }, [
    bootDiskGb,
    imageId,
    imagesError,
    imagesLoading,
    imagesStale,
    onCheckInventory,
    selected,
    selectedImage,
    step,
  ]);

  useEffect(
    () => () => {
      inventoryController.current?.abort();
    },
    [],
  );

  const chooseOption = (option: ComputeCatalogOption) => {
    setSelectedId(option.id);
    setImageId(resolveImageSelection(images, [option.imageId]));
    setInventory({ state: 'unknown' });
    setImagePickerOpen(false);
    setImageAnnouncement('');
    setBootDiskGb(option.diskMinGiB ?? 60);
    setAcknowledged(false);
    setAccepted(null);
    setSubmitError('');
    setErrors({});
  };

  const closeImagePicker = () => {
    setImagePickerOpen(false);
    window.requestAnimationFrame(() => imageBrowseRef.current?.focus());
  };

  const selectImage = (nextImageId: string) => {
    const nextImage = images.find(
      (image) => image.CompShareImageId === nextImageId,
    );
    if (!nextImage || !imageAvailability(nextImage).available) return;
    setImageId(nextImage.CompShareImageId);
    setInventory({ state: 'unknown' });
    setImageAnnouncement(
      `已选择 ${nextImage.Name}，库存与报价需要重新核对。`,
    );
    setErrors((current) => {
      const next = { ...current };
      delete next.image;
      delete next.inventory;
      delete next.quote;
      return next;
    });
  };

  const validate = (target: number) => {
    const next: Record<string, string> = {};
    if (!selectedImage || !imageId) {
      next.image = imagesLoading
        ? '正在读取运行镜像目录，请等待目录加载完成。'
        : imagesError
          ? '运行镜像目录读取失败，请重新读取后再继续。'
          : '选择一个目录可用且仍有效的运行镜像。';
    }
    if (name.trim().length < 3 || name.trim().length > 120) {
      next.name = '实例名称需为 3–120 个字符。';
    }
    const min = selected.diskMinGiB ?? 1;
    const max = selected.diskMaxGiB ?? 1_000_000;
    if (!Number.isInteger(bootDiskGb) || bootDiskGb < min || bootDiskGb > max) {
      next.disk = `系统盘需为 ${min}–${max} GiB 的整数。`;
    }
    if (target === 3 && inventory.state === 'out_of_stock') {
      next.inventory = '当前精确库存不足，请返回并选择其他配置。';
    }
    if (target === 3 && inventory.state !== 'available') {
      next.inventory = '库存尚未确认可用，不能进入创建确认。';
    }
    if (
      target === 3
      && configuration?.writeEnabled
      && inventory.quote?.state !== 'available'
    ) {
      next.quote = '未取得可验证的官方报价，后端将拒绝真实创建。';
    }
    if (step === 3 && !acknowledged) {
      next.ack = '请确认资源费用、归属与写入边界。';
    }
    setErrors(next);
    if (Object.keys(next).length) {
      requestAnimationFrame(() => errorSummary.current?.focus());
      return false;
    }
    return true;
  };

  const next = () => {
    if (step === 1) {
      if (!selected) {
        setErrors({ resource: '选择一个真实目录返回的配置。' });
        requestAnimationFrame(() => errorSummary.current?.focus());
        return;
      }
      setStep(2);
      return;
    }
    if (step === 2) {
      if (imagesLoading || imagesStale) {
        setErrors({
          image: imagesLoading
            ? '正在读取运行镜像目录，请等待目录加载完成。'
            : '筛选条件已变化，旧镜像目录不能用于提交。',
        });
        requestAnimationFrame(() => errorSummary.current?.focus());
        return;
      }
      if (validate(3)) setStep(3);
      return;
    }
    if (step === 3) {
      if (!validate(4)) return;
      if (!configuration?.writeEnabled) {
        setStep(4);
        return;
      }
      void submit();
    }
  };

  const submit = async () => {
    setSubmitting(true);
    setSubmitError('');
    try {
      const result = await onCreate({
        requestId,
        name: name.trim(),
        spec: {
          region: selected.region,
          zone: selected.zone,
          gpuType: selected.gpuType,
          cpu: selected.cpu,
          memoryMb: selected.memoryGiB * 1024,
          imageId,
          cpuPlatform: selected.cpuPlatform,
          chargeType: selected.chargeType,
          bootDiskGb,
          bootDiskType: selected.diskType,
        },
      });
      setAccepted(result);
      setStep(4);
    } catch (error) {
      setSubmitError(
        error instanceof Error ? error.message : '创建请求未被服务端接受。',
      );
      setStep(4);
    } finally {
      setSubmitting(false);
    }
  };

  const retry = () => {
    setSubmitError('');
    setAccepted(null);
    void submit();
  };

  const acceptedState =
    accepted &&
    configuration?.writeEnabled &&
    !submitError &&
    Boolean(trackedEnvironment || accepted.environmentId);

  return (
    <ComputeDialog
      labelledBy="mf-create-title"
      onClose={() => {
        if (!submitting) onClose();
      }}
      dismissible={!submitting}
    >
      <div className="mf-dialog-head">
        <div>
          <span className="mf-compute-eyebrow">
            <ComputeIcon name="bolt" />
            GUIDED ENVIRONMENT
          </span>
          <h2 id="mf-create-title">新建计算环境</h2>
          <p>
            四步确认资源、运行镜像、库存和归属。写入请求成功后仍需等待实例与 GPU
            租约事实。
          </p>
        </div>
        <button
          type="button"
          className="mf-icon-button"
          aria-label="关闭新建计算环境"
          onClick={onClose}
          disabled={submitting}
        >
          <ComputeIcon name="close" />
        </button>
      </div>
      <div className="mf-dialog-steps" aria-label="新建环境步骤">
        {stepLabels.map((label, index) => (
          <span
            key={label}
            className={
              step === index + 1 ? 'active' : step > index + 1 ? 'done' : ''
            }
            aria-current={step === index + 1 ? 'step' : undefined}
          >
            <i>
              {step > index + 1 ? (
                <ComputeIcon name="check" size={12} />
              ) : (
                index + 1
              )}
            </i>
            <b>{label}</b>
          </span>
        ))}
      </div>

      <div className="mf-dialog-body">
        <div className="mf-dialog-main">
          {(Object.keys(errors).length > 0 || submitError) && (
            <div
              className="mf-error-summary"
              role="alert"
              tabIndex={-1}
              ref={errorSummary}
            >
              <strong>还有信息需要处理</strong>
              {Object.entries(errors).map(([field, message]) => (
                <a href={`#mf-create-${field}`} key={field}>
                  {message}
                </a>
              ))}
              {submitError && <span>{submitError}</span>}
            </div>
          )}

          {step === 1 && (
            <>
              <h3>选择资源组合</h3>
              <p>
                资源目录只表示供应商可见；库存、预留和兼容性将在后续步骤分别核对。
              </p>
              <div className="mf-create-grid">
                {options.slice(0, 6).map((option) => (
                  <button
                    type="button"
                    className="mf-create-option"
                    aria-pressed={option.id === selectedId}
                    key={option.id}
                    onClick={() => chooseOption(option)}
                  >
                    <span className="mf-market-card-top">
                      <span className="mf-market-card-title">
                        <span className="mf-gpu-mark">GPU</span>
                        <span>
                          <strong>{option.gpuType}</strong>
                          <small>
                            {option.graphicsMemoryGb} GB · {option.cpu} 核 ·{' '}
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
                    <small>
                      {option.region} · {option.zone} · {option.imageName}
                    </small>
                    <span>
                      {quoteRate(option.quote ?? unavailableQuote())
                        ?? '核对后报价'} · 兼容性未验证
                    </span>
                  </button>
                ))}
              </div>
              <div className="mf-compatibility-strip">
                <ComputeIcon name="shield" />
                <span>
                  <strong>目录可见、库存可用、训练兼容是三种不同事实</strong>
                  <small>
                    没有真实模型、镜像和训练基线证据时，不会显示“已验证兼容”。
                  </small>
                </span>
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <h3>确认环境与运行镜像</h3>
              <p>实例名称和资源规格固定后不会在创建重试中变化。</p>
              <div className="mf-environment-summary">
                <span className="mf-gpu-mark large">{selected.gpuType.slice(0, 8)}</span>
                <div>
                  <strong>
                    {selected.graphicsMemoryGb} GB · {selected.cpu} 核 /{' '}
                    {selected.memoryGiB} GiB
                  </strong>
                  <small>
                    {selected.region} · {selected.zone}
                  </small>
                </div>
                <div>
                  <span>目录可见</span>
                  <strong>{selected.compatibility === 'verified' ? '兼容已验证' : '兼容未验证'}</strong>
                </div>
              </div>
              <div className="mf-form-grid" style={{ marginTop: 12 }}>
                <label className="mf-field">
                  <span>实例名称</span>
                  <input
                    id="mf-create-name"
                    value={name}
                    maxLength={120}
                    aria-invalid={Boolean(errors.name)}
                    aria-describedby={errors.name ? errorId('name') : undefined}
                    onChange={(event) => setName(event.target.value)}
                  />
                  {errors.name && (
                    <small className="mf-field-error" id={errorId('name')}>
                      {errors.name}
                    </small>
                  )}
                </label>
                <div
                  className={`mf-wizard-image-field${imagePickerOpen ? ' is-open' : ''}`}
                  id="mf-create-image"
                  aria-invalid={Boolean(errors.image)}
                  aria-describedby={
                    errors.image ? errorId('image') : undefined
                  }
                  data-testid="wizard-image-field"
                >
                  <div className="mf-wizard-image-head">
                    <span className="mf-image-option-mark large" aria-hidden="true">
                      {selectedImage ? imageMonogram(selectedImage) : 'IMG'}
                    </span>
                    <div className="mf-wizard-image-copy">
                      <span className="mf-wizard-image-label">运行镜像</span>
                      <strong data-testid="wizard-selected-image">
                        {selectedImage?.Name
                          ?? (imagesLoading
                            ? '正在读取运行镜像目录'
                            : imagesError
                              ? '运行镜像目录读取失败'
                              : '当前目录没有可用运行镜像')}
                      </strong>
                      <div className="mf-wizard-image-meta">
                        {selectedImage ? (
                          <>
                            <span
                              className={`mf-image-status ${selectedImageAvailability?.tone ?? 'warning'}`}
                            >
                              <i aria-hidden="true" />
                              {selectedImageAvailability?.label
                                ?? '目录状态未知'}
                            </span>
                            <span>{imageTypeLabel(selectedImage.ImageType)}</span>
                            <span>{selectedImageFamily}</span>
                            <code>{selectedImage.CompShareImageId}</code>
                          </>
                        ) : (
                          <span>
                            {imagesLoading
                              ? '目录返回前不会沿用未经确认的镜像。'
                              : imagesError
                                ? '重新读取目录后再选择运行镜像。'
                                : '目录可用项为空，不能进入费用步骤。'}
                          </span>
                        )}
                      </div>
                    </div>
                    <button
                      ref={imageBrowseRef}
                      type="button"
                      className="mf-image-browse mf-wizard-image-browse"
                      aria-expanded={imagePickerOpen}
                      aria-controls="mf-create-image-catalog"
                      onClick={() => setImagePickerOpen((open) => !open)}
                      disabled={submitting}
                      data-testid="wizard-image-picker-trigger"
                    >
                      <ComputeIcon name="search" size={15} />
                      <span>
                        {imagePickerOpen ? '收起镜像目录' : '浏览镜像目录'}
                      </span>
                      <small>
                        {imagesLoading
                          ? '读取中'
                          : imagesError
                            ? '读取失败'
                            : imageTotal && imageTotal > images.length
                              ? `${images.length}/${imageTotal}`
                              : `${images.length} 个`}
                      </small>
                      <ComputeIcon
                        name="chevron-down"
                        size={14}
                        className={imagePickerOpen ? 'is-open' : ''}
                      />
                    </button>
                  </div>
                  <p className="mf-wizard-image-boundary">
                    目录可用只表示镜像存在，不表示已通过当前 GPU、磁盘和运行时
                    兼容验证。
                  </p>
                  {imagePickerOpen && (
                    <div
                      id="mf-create-image-catalog"
                      className="mf-wizard-image-catalog"
                    >
                      <ImageCatalogPicker
                        images={images}
                        imageType={imageType}
                        selectedImageId={imageId}
                        loading={imagesLoading}
                        stale={imagesStale}
                        error={imagesError}
                        disabled={submitting}
                        total={imageTotal}
                        onSelect={selectImage}
                        onClose={closeImagePicker}
                        onRetry={onRetryImages}
                      />
                    </div>
                  )}
                  <span className="mf-sr-only" role="status" aria-live="polite">
                    {imageAnnouncement}
                  </span>
                  {errors.image && (
                    <small className="mf-field-error" id={errorId('image')}>
                      {errors.image}
                    </small>
                  )}
                </div>
                <label className="mf-field">
                  <span>系统盘容量（GiB）</span>
                  <input
                    id="mf-create-disk"
                    type="number"
                    min={selected.diskMinGiB ?? 1}
                    max={selected.diskMaxGiB ?? 1_000_000}
                    step={1}
                    value={bootDiskGb}
                    aria-invalid={Boolean(errors.disk)}
                    aria-describedby={errors.disk ? errorId('disk') : undefined}
                    onChange={(event) => setBootDiskGb(Number(event.target.value))}
                  />
                  {errors.disk && (
                    <small className="mf-field-error" id={errorId('disk')}>
                      {errors.disk}
                    </small>
                  )}
                </label>
                <label className="mf-field">
                  <span>磁盘类型</span>
                  <input value={selected.diskType} readOnly />
                </label>
              </div>
              <div
                className={
                  inventory.state === 'available'
                    ? 'mf-compatibility-strip'
                    : 'mf-compatibility-strip'
                }
                id="mf-create-inventory"
                aria-live="polite"
              >
                <ComputeIcon
                  name={inventory.state === 'available' ? 'check' : 'clock'}
                />
                <span>
                  <strong>
                    {inventory.state === 'checking'
                      ? '正在执行精确库存预检'
                      : inventory.state === 'available'
                        ? '查询时存在匹配库存'
                        : inventory.state === 'out_of_stock'
                          ? '查询时库存不足'
                          : inventory.state === 'error'
                            ? '库存结果不可确认'
                            : '尚未取得库存结果'}
                  </strong>
                  <small>
                    {inventory.checkedAt
                      ? `查询时间 ${new Date(inventory.checkedAt).toLocaleString(
                          'zh-CN',
                          { hour12: false },
                        )}；快照不保留资源。`
                      : inventory.error ??
                        '这里只展示供应商查询快照，不代表预留成功。'}
                  </small>
                </span>
              </div>
              {errors.inventory && (
                <p className="mf-field-error" role="alert">
                  {errors.inventory}
                </p>
              )}
            </>
          )}

          {step === 3 && (
            <>
              <h3>费用归属与创建确认</h3>
              <p>
                官方折后价与库存查询共用当前精确规格。报价是查询时快照，最终费用以供应商账单为准。
              </p>
              <div className="mf-cost-panel" id="mf-create-quote">
                <span>QUOTE STATUS</span>
                <strong>
                  {quoteRate(inventory.quote ?? unavailableQuote())
                    ?? '报价待核对'}
                </strong>
                <small>
                  {inventory.quote?.state === 'available'
                    ? `优云官方折后价 · 查询于 ${
                      quoteObservedAt(inventory.quote) ?? '未知时间'
                    } · 不低于 1 小时按供应商规则计费`
                    : inventory.quote?.description
                      ?? '未取得可验证报价；系统不会推断金额。'}
                </small>
                <div>
                  <span>资源归属</span>
                  <b>个人工作空间</b>
                </div>
                <div>
                  <span>计费方式</span>
                  <b>{chargeLabel(selected.chargeType)}</b>
                </div>
                {inventory.quote?.breakdown && (
                  <div>
                    <span>报价构成</span>
                    <b>
                      实例 ¥{inventory.quote.breakdown.instance.toFixed(2)} ·
                      系统盘 ¥{inventory.quote.breakdown.systemDisks.toFixed(2)}
                    </b>
                  </div>
                )}
              </div>
              <dl className="mf-confirm-list">
                <div>
                  <dt>实例名称</dt>
                  <dd>{name.trim()}</dd>
                </div>
                <div>
                  <dt>资源组合</dt>
                  <dd>
                    {selected.gpuType} · {selected.cpu} 核 /{' '}
                    {selected.memoryGiB} GiB
                  </dd>
                </div>
                <div>
                  <dt>地域 / 镜像</dt>
                  <dd>
                    {selected.region} /{' '}
                    {selectedImage?.Name
                      ?? selected.imageName
                      ?? '未选择'}
                  </dd>
                </div>
                <div>
                  <dt>报价 / 兼容</dt>
                  <dd>
                    {quoteRate(inventory.quote ?? unavailableQuote())
                      ?? '报价待核对'} / 兼容性未验证
                  </dd>
                </div>
                <div>
                  <dt>GPU 租约</dt>
                  <dd>创建后由服务端绑定，当前尚未预留</dd>
                </div>
              </dl>
              <label className="mf-ack">
                <input
                  type="checkbox"
                  checked={acknowledged}
                  onChange={(event) => {
                    setAcknowledged(event.target.checked);
                    setErrors((current) => {
                      const next = { ...current };
                      delete next.ack;
                      return next;
                    });
                  }}
                  aria-invalid={Boolean(errors.ack)}
                />
                <span>
                  我理解：查询快照不保留资源；创建可能产生真实云费用；停止不等于删除，删除前仍需确认关联任务、产物和 GPU
                  租约。
                </span>
              </label>
              {errors.ack && (
                <p className="mf-field-error" role="alert">
                  {errors.ack}
                </p>
              )}
              {errors.quote && (
                <p className="mf-field-error" role="alert">
                  {errors.quote}
                </p>
              )}
              {!configuration?.writeEnabled && (
                <div className="mf-compatibility-strip">
                  <ComputeIcon name="lock" />
                  <span>
                    <strong>当前后端未开放实例写入</strong>
                    <small>
                      {configuration?.reason ??
                        '可继续查看四步向导和创建轨道，但不会调用供应商创建接口。'}
                    </small>
                  </span>
                </div>
              )}
            </>
          )}

          {step === 4 && (
            <div aria-live="polite">
              <h3>创建监控</h3>
              <p>
                {configuration?.writeEnabled
                  ? '写请求成功仅代表已受理。实例、运行时与 GPU 租约必须以轮询到的事实为准。'
                  : '当前处于只读能力边界，下面展示的是创建后将使用的运行轨道，不会发起真实写入。'}
              </p>
              <div className="mf-create-runway">
                <ol className="mf-lifecycle" aria-label="创建运行轨道">
                  {[
                    '资源确认',
                    '实例创建',
                    '运行时准备',
                    '健康探针',
                    '租约绑定',
                  ].map((label, index) => {
                    const state = runwayState(
                      index,
                      Boolean(accepted),
                      trackedEnvironment,
                    );
                    return (
                      <li
                        className={`mf-lifecycle-step ${state}`}
                        key={label}
                      >
                        <i>
                          {state === 'done' ? (
                            <ComputeIcon name="check" size={12} />
                          ) : (
                            index + 1
                          )}
                        </i>
                        <strong>{label}</strong>
                        <small>
                          {state === 'done'
                            ? '事实已确认'
                            : state === 'current'
                              ? '正在等待'
                              : state === 'failed'
                                ? '需要核对'
                                : '尚未开始'}
                        </small>
                      </li>
                    );
                  })}
                </ol>
                <div className="mf-create-runway-facts">
                  <span>
                    目标：{selected.gpuType} · {selected.region}
                  </span>
                  <span>
                    {accepted
                      ? `已受理：${new Date(accepted.acceptedAt).toLocaleTimeString(
                          'zh-CN',
                          { hour12: false },
                        )}`
                      : '尚未发出创建命令'}
                  </span>
                </div>
              </div>
              <div className="mf-progress">
                <div>
                  <span>
                    {trackedEnvironment?.statusDetail ??
                      (acceptedState
                        ? '等待服务端事实同步'
                        : configuration?.writeEnabled
                          ? submitError
                            ? '创建请求未被接受'
                            : '正在提交创建请求'
                          : '只读模式：未发起创建')}
                  </span>
                  <b>
                    {trackedEnvironment?.status === 'running'
                      ? '运行中'
                      : accepted
                        ? '已受理'
                        : '等待'}
                  </b>
                </div>
                <i>
                  <b
                    style={{
                      width:
                        trackedEnvironment?.status === 'running'
                          ? '100%'
                          : accepted
                            ? '50%'
                            : '12%',
                    }}
                  />
                </i>
                <ol>
                  <li className={accepted ? 'done' : 'current'}>
                    加入创建命令与请求 ID
                  </li>
                  <li className={accepted ? 'done' : ''}>
                    服务端固定规格并预检库存
                  </li>
                  <li className={trackedEnvironment ? 'current' : ''}>
                    等待供应商实例与镜像事实
                  </li>
                  <li
                    className={
                      trackedEnvironment?.status === 'running' ? 'done' : ''
                    }
                  >
                    健康探针和 GPU 租约绑定
                  </li>
                </ol>
              </div>
              {submitError && (
                <div className="mf-compute-error" role="alert">
                  <ComputeIcon name="alert" />
                  <span>
                    <strong>创建请求未被接受</strong>
                    <br />
                    {submitError}
                  </span>
                  <button type="button" className="mf-secondary" onClick={retry}>
                    重试
                  </button>
                </div>
              )}
              {!configuration?.writeEnabled && (
                <div className="mf-compatibility-strip">
                  <ComputeIcon name="lock" />
                  <span>
                    <strong>只读预览，无云资源产生</strong>
                    <small>
                      要实际创建，需要后端显式开启实例写入；本次不会调用 CreateCompShareInstance。
                    </small>
                  </span>
                </div>
              )}
            </div>
          )}
        </div>

        <aside className="mf-wizard-aside" aria-label="配置摘要">
          <span className="mf-compute-eyebrow">RUNWAY PREVIEW</span>
          <strong>{selected.gpuType}</strong>
          <small>
            {selected.graphicsMemoryGb} GB · {selected.cpu} 核 ·{' '}
            {selected.memoryGiB} GiB
          </small>
          <div className="mf-wizard-route-mini" aria-hidden="true">
            {[1, 2, 3, 4].map((index) => (
              <span key={index} style={{ display: 'contents' }}>
                <i
                  className={
                    step > index ? 'done' : step === index ? 'active' : ''
                  }
                >
                  {step > index ? <ComputeIcon name="check" size={11} /> : index}
                </i>
                {index < 4 && <span />}
              </span>
            ))}
          </div>
          <dl>
            <div>
              <dt>地域</dt>
              <dd>{selected.region}</dd>
            </div>
            <div>
              <dt>可用区</dt>
              <dd>{selected.zone}</dd>
            </div>
            <div>
              <dt>镜像</dt>
              <dd>
                {selectedImage?.Name
                  ?? selected.imageName
                  ?? '未选择'}
              </dd>
            </div>
            <div>
              <dt>库存</dt>
              <dd>
                {inventory.state === 'available'
                  ? '查询时有库存'
                  : inventory.state === 'checking'
                    ? '查询中'
                    : '待确认'}
              </dd>
            </div>
            <div>
              <dt>报价</dt>
              <dd>
                {quoteRate(inventory.quote ?? unavailableQuote())
                  ?? '待核对'}
              </dd>
            </div>
          </dl>
          <div className="mf-inline-note">
            <ComputeIcon name="shield" />
            <span>兼容性未验证 · 库存与目录必须按查询时间重新核对</span>
          </div>
        </aside>
      </div>

      <div className="mf-dialog-foot">
        <span>
          {step === 4
            ? configuration?.writeEnabled
              ? '创建事实以服务端轮询结果为准'
              : '只读预览 · 不产生云资源或费用'
            : '步骤可返回修改；提交期间禁止重复操作'}
        </span>
        <div>
          {step > 1 && step < 4 && (
            <button
              type="button"
              className="mf-secondary"
              onClick={() => {
                setErrors({});
                setStep((value) => value - 1);
              }}
              disabled={submitting}
            >
              上一步
            </button>
          )}
          {step < 3 && (
            <button
              type="button"
              className="mf-primary"
              onClick={next}
              disabled={
                step === 2
                && (
                  inventory.state === 'checking'
                  || imagesLoading
                  || imagesStale
                  || Boolean(imagesError)
                  || !selectedImage
                )
              }
            >
              继续
              <ComputeIcon name="arrow-right" />
            </button>
          )}
          {step === 3 && (
            <button
              type="button"
              className={`mf-primary${submitting ? ' is-loading' : ''}`}
              onClick={next}
              disabled={submitting || !acknowledged}
            >
              {!configuration?.writeEnabled
                ? '进入只读轨道'
                : submitting
                  ? '正在受理'
                  : '确认创建'}
            </button>
          )}
          {step === 4 && (
            <button type="button" className="mf-secondary" onClick={onClose}>
              关闭
            </button>
          )}
        </div>
      </div>
    </ComputeDialog>
  );
}

function chargeLabel(value: string) {
  return (
    {
      Postpay: '后付费',
      Day: '按天',
      Month: '按月',
      Dynamic: '动态计费',
      Spot: '竞价计费',
    }[value] ?? value
  );
}
