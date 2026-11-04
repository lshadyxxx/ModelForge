import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import type { Image } from '../api';
import { ComputeIcon } from './ComputeIcon';
import {
  filterImageCatalog,
  imageAvailability,
  imageCatalogCategories,
  imageFamily,
  imageMonogram,
  imagePlatform,
  imageTypeLabel,
  preferredAvailableImage,
  type ImageCategoryKey,
} from './image-catalog';

type ImageCatalogPickerProps = {
  images: Image[];
  imageType: string;
  selectedImageId: string;
  loading: boolean;
  stale: boolean;
  error?: string;
  disabled?: boolean;
  total?: number;
  onSelect: (imageId: string) => void;
  onClose: () => void;
  onRetry: () => void;
};

export function ImageCatalogPicker({
  images,
  imageType,
  selectedImageId,
  loading,
  stale,
  error = '',
  disabled = false,
  total,
  onSelect,
  onClose,
  onRetry,
}: ImageCatalogPickerProps) {
  const generatedId = useId().replace(/:/g, '');
  const titleId = `mf-image-catalog-title-${generatedId}`;
  const listId = `mf-image-catalog-list-${generatedId}`;
  const panelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const optionRefs = useRef(new Map<string, HTMLDivElement>());
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<ImageCategoryKey>('all');
  const [candidateId, setCandidateId] = useState('');
  const busy = loading || stale;
  const totalCount = Math.max(total ?? images.length, images.length);
  const truncated = totalCount > images.length;
  const categories = useMemo(
    () => imageCatalogCategories(images, imageType),
    [imageType, images],
  );
  const filteredImages = useMemo(
    () => filterImageCatalog(images, imageType, category, query),
    [category, imageType, images, query],
  );
  const availableCount = images.filter(
    (image) => imageAvailability(image).available,
  ).length;
  const selectedImage =
    images.find((image) => image.CompShareImageId === selectedImageId) ?? null;
  const candidate =
    images.find((image) => image.CompShareImageId === candidateId) ?? null;
  const candidateAvailability = candidate
    ? imageAvailability(candidate)
    : null;
  const candidateIndex = filteredImages.findIndex(
    (image) => image.CompShareImageId === candidateId,
  );

  useEffect(() => {
    panelRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    setQuery('');
    setCategory('all');
  }, [imageType]);

  useEffect(() => {
    const currentCandidate = filteredImages.find(
      (image) => image.CompShareImageId === candidateId,
    );
    if (
      currentCandidate
      && imageAvailability(currentCandidate).available
    ) {
      return;
    }
    const currentSelection = filteredImages.find(
      (image) =>
        image.CompShareImageId === selectedImageId
        && imageAvailability(image).available,
    );
    setCandidateId(
      currentSelection?.CompShareImageId
      ?? preferredAvailableImage(filteredImages)?.CompShareImageId
      ?? '',
    );
  }, [candidateId, filteredImages, selectedImageId]);

  function commit(image = candidate) {
    if (
      disabled
      || !image
      || !imageAvailability(image).available
      || image.CompShareImageId === selectedImageId
    ) {
      return;
    }
    onSelect(image.CompShareImageId);
    onClose();
  }

  function focusAndScroll(imageId: string) {
    setCandidateId(imageId);
    listRef.current?.focus({ preventScroll: true });
    window.requestAnimationFrame(() => {
      optionRefs.current.get(imageId)?.scrollIntoView({ block: 'nearest' });
    });
  }

  function moveCandidate(direction: 1 | -1) {
    const selectable = filteredImages.filter(
      (image) => imageAvailability(image).available,
    );
    if (!selectable.length) return;
    const current = selectable.findIndex(
      (image) => image.CompShareImageId === candidateId,
    );
    const nextIndex =
      current < 0
        ? direction === 1
          ? 0
          : selectable.length - 1
        : (current + direction + selectable.length) % selectable.length;
    focusAndScroll(selectable[nextIndex].CompShareImageId);
  }

  function handleListKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (disabled) return;
    const selectable = filteredImages.filter(
      (image) => imageAvailability(image).available,
    );
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      moveCandidate(event.key === 'ArrowDown' ? 1 : -1);
      return;
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      const target =
        event.key === 'Home' ? selectable[0] : selectable[selectable.length - 1];
      if (target) focusAndScroll(target.CompShareImageId);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      commit();
    }
  }

  function handleSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (disabled) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      listRef.current?.focus();
    }
  }

  return (
    <div
      ref={panelRef}
      className="mf-image-catalog"
      role="region"
      aria-labelledby={titleId}
      data-testid="image-catalog"
      tabIndex={-1}
    >
      <header className="mf-image-catalog-head">
        <div>
          <h3 id={titleId}>选择运行镜像</h3>
          <p>
            {busy
              ? `正在读取${imageTypeLabel(imageType)}目录`
              : `${imageTypeLabel(imageType)} · ${images.length} 个已载入 · ${availableCount} 个可用${truncated ? ` · 目录共 ${totalCount} 个` : ''}`}
          </p>
        </div>
        <button
          type="button"
          className="mf-image-close"
          onClick={onClose}
          aria-label="收起镜像目录"
          title="收起镜像目录"
        >
          <ComputeIcon name="close" size={17} />
        </button>
      </header>

      {error ? (
        <div className="mf-image-catalog-error" role="alert">
          <span>
            <ComputeIcon name="alert" size={22} />
          </span>
          <h4>镜像目录读取失败</h4>
          <p>{error}</p>
          <div>
            <button
              type="button"
              className="mf-secondary"
              onClick={onRetry}
              disabled={disabled}
            >
              <ComputeIcon name="refresh" />
              重新读取目录
            </button>
            <button type="button" className="mf-quiet" onClick={onClose}>
              关闭
            </button>
          </div>
        </div>
      ) : busy ? (
        <div
          className="mf-image-catalog-loading"
          aria-busy="true"
          aria-live="polite"
        >
          <div className="mf-image-catalog-loading-toolbar">
            <div className="mf-skeleton" />
            <div className="mf-skeleton" />
          </div>
          <div className="mf-image-catalog-loading-body">
            <div className="mf-image-catalog-loading-list">
              {[0, 1, 2, 3, 4].map((item) => (
                <div className="mf-skeleton" key={item} />
              ))}
            </div>
            <div className="mf-skeleton loading-detail" />
          </div>
          <span className="mf-sr-only" role="status">
            正在读取当前地域的镜像目录
          </span>
        </div>
      ) : images.length === 0 ? (
        <div className="mf-image-catalog-empty">
          <span>
            <ComputeIcon name="image" size={22} />
          </span>
          <h4>当前条件下没有镜像</h4>
          <p>
            目录没有返回镜像，不代表当前地域不能创建实例。可以刷新目录或
            切换镜像类型后重试。
          </p>
          <div>
            <button
              type="button"
              className="mf-secondary"
              onClick={onRetry}
              disabled={disabled}
            >
              <ComputeIcon name="refresh" />
              刷新镜像目录
            </button>
            <button type="button" className="mf-quiet" onClick={onClose}>
              关闭
            </button>
          </div>
        </div>
      ) : (
        <>
          {truncated && (
            <div className="mf-image-catalog-limit" role="status">
              <ComputeIcon name="alert" size={15} />
              <p>
                目录共 {totalCount} 项，当前仅载入 {images.length} 项；
                未载入条目不能在本页判断为不存在。
              </p>
            </div>
          )}
          <div className="mf-image-catalog-toolbar">
            <label className="mf-image-search">
              <ComputeIcon name="search" size={16} />
              <span className="mf-sr-only">搜索运行镜像</span>
              <input
                ref={searchRef}
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={handleSearchKeyDown}
                placeholder="搜索名称、ID、标签或作者"
                autoComplete="off"
                disabled={disabled}
                data-testid="image-catalog-search"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => {
                    setQuery('');
                    searchRef.current?.focus();
                  }}
                  aria-label="清空镜像搜索"
                  disabled={disabled}
                >
                  <ComputeIcon name="close" size={13} />
                </button>
              )}
            </label>
            <span className="mf-image-result-count" aria-live="polite">
              {filteredImages.length} / {images.length} 个结果
            </span>
          </div>

          <div
            className="mf-image-categories"
            role="group"
            aria-label="筛选镜像类别"
          >
            {categories.map((item) => (
              <button
                key={item.key}
                type="button"
                aria-pressed={category === item.key}
                onClick={() => setCategory(item.key)}
                disabled={disabled}
              >
                <span>{item.label}</span>
                <small>{item.count}</small>
              </button>
            ))}
          </div>

          {filteredImages.length === 0 ? (
            <div className="mf-image-catalog-empty compact">
              <span>
                <ComputeIcon name="search" size={21} />
              </span>
              <h4>没有匹配的镜像</h4>
              <p>
                当前搜索没有命中名称、ID、标签或作者。可以清空搜索，
                或切换到“全部”类别继续选择。
              </p>
              <button
                type="button"
                className="mf-secondary"
                disabled={disabled}
                onClick={() => {
                  setQuery('');
                  setCategory('all');
                  window.requestAnimationFrame(() =>
                    searchRef.current?.focus(),
                  );
                }}
              >
                清空搜索与筛选
              </button>
            </div>
          ) : (
            <div className="mf-image-workspace">
              <div className="mf-image-list-pane">
                <div
                  ref={listRef}
                  id={listId}
                  className="mf-image-list"
                  role="listbox"
                  aria-label={`${imageTypeLabel(imageType)}目录`}
                  aria-activedescendant={
                    candidateId
                      ? `${listId}-option-${candidateId}`
                      : undefined
                  }
                  aria-disabled={disabled || undefined}
                  tabIndex={0}
                  onKeyDown={handleListKeyDown}
                  data-testid="image-catalog-list"
                >
                  {filteredImages.map((image) => {
                    const availability = imageAvailability(image);
                    const active = image.CompShareImageId === candidateId;
                    const current = image.CompShareImageId === selectedImageId;
                    const family =
                      image.ImageType === 'App'
                        ? imageFamily(image).label
                        : imagePlatform(image).label;
                    return (
                      <div
                        key={image.CompShareImageId}
                        id={`${listId}-option-${image.CompShareImageId}`}
                        ref={(node) => {
                          if (node) optionRefs.current.set(image.CompShareImageId, node);
                          else optionRefs.current.delete(image.CompShareImageId);
                        }}
                        role="option"
                        aria-selected={active}
                        aria-disabled={!availability.available || undefined}
                        className={[
                          'mf-image-option',
                          active ? 'is-active' : '',
                          current ? 'is-current' : '',
                          availability.available ? '' : 'is-unavailable',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        data-testid={`image-option-${image.CompShareImageId}`}
                        data-image-status={image.Status}
                        data-image-available={availability.available}
                        onClick={() => {
                          if (disabled || !availability.available) return;
                          setCandidateId(image.CompShareImageId);
                          listRef.current?.focus({ preventScroll: true });
                        }}
                        onDoubleClick={() => {
                          if (!disabled && availability.available) commit(image);
                        }}
                      >
                        <span className="mf-image-option-mark" aria-hidden="true">
                          {imageMonogram(image)}
                        </span>
                        <span className="mf-image-option-copy">
                          <strong>{image.Name}</strong>
                          <small>
                            {family}
                            {image.Description ? ` · ${image.Description}` : ''}
                          </small>
                        </span>
                        <span
                          className={`mf-image-option-state ${availability.tone}`}
                        >
                          {current ? '当前' : availability.label}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              <aside className="mf-image-detail" aria-label="镜像详情">
                {candidate && candidateAvailability?.available ? (
                  <>
                    <div className="mf-image-detail-head">
                      <span className="mf-image-option-mark large" aria-hidden="true">
                        {imageMonogram(candidate)}
                      </span>
                      <div>
                        <span>
                          {imageTypeLabel(candidate.ImageType)} ·{' '}
                          {candidate.ImageType === 'App'
                            ? imageFamily(candidate).label
                            : imagePlatform(candidate).label}
                        </span>
                        <h4>{candidate.Name}</h4>
                      </div>
                    </div>

                    <dl className="mf-image-detail-facts">
                      <div>
                        <dt>目录状态</dt>
                        <dd>
                          <span
                            className={`mf-image-status ${candidateAvailability.tone}`}
                          >
                            <i aria-hidden="true" />
                            {candidateAvailability.label}
                          </span>
                        </dd>
                      </div>
                      <div>
                        <dt>镜像来源</dt>
                        <dd>{candidate.Author || '目录未提供'}</dd>
                      </div>
                      <div>
                        <dt>镜像 ID</dt>
                        <dd className="mono">{candidate.CompShareImageId}</dd>
                      </div>
                      <div>
                        <dt>说明与标签</dt>
                        <dd>
                          {candidate.Description
                            || candidate.Tags.join('、')
                            || '目录未提供说明'}
                        </dd>
                      </div>
                    </dl>

                    {candidate.CompShareImageId === selectedImageId && (
                      <div className="mf-image-current-note">
                        <ComputeIcon name="check" size={14} />
                        当前配置正在使用该镜像
                      </div>
                    )}
                  </>
                ) : (
                  <div className="mf-image-detail-placeholder">
                    <ComputeIcon name="image" size={22} />
                    <p>从左侧目录选择一个可用镜像查看详情。</p>
                  </div>
                )}

                <div className="mf-image-detail-boundary">
                  <ComputeIcon name="shield" size={15} />
                  <p>
                    目录可用只表示镜像存在，不表示已通过当前 GPU、磁盘和
                    运行时组合的兼容验证。
                  </p>
                </div>
              </aside>
            </div>
          )}

          <footer className="mf-image-catalog-footer">
            <p>
              替换镜像后，已有的库存与报价核对结果会失效，需要重新核对。
            </p>
            <div>
              <button type="button" className="mf-secondary" onClick={onClose}>
                关闭
              </button>
              <button
                type="button"
                className="mf-primary"
                onClick={() => commit()}
                disabled={
                  disabled
                  || !candidate
                  || !candidateAvailability?.available
                  || candidate.CompShareImageId === selectedImageId
                  || candidateIndex < 0
                }
                data-testid="image-catalog-commit"
              >
                <ComputeIcon name="check" />
                {candidate?.CompShareImageId === selectedImageId
                  ? '当前已使用'
                  : '使用此镜像'}
              </button>
            </div>
          </footer>
        </>
      )}
    </div>
  );
}
