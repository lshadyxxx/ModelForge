import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
} from 'react';

import { bytes, date, Empty, Failure } from '../../shared/assets.tsx';
import { ApiError } from '../../shared/http.ts';
import {
  appendDatasetSamplePage,
  createDataset,
  createDatasetVersion,
  datasetShortId,
  datasetStateLabel,
  deleteDatasetVersion,
  deriveDatasetVersion,
  fetchDatasetLimits,
  fetchDatasetRows,
  fetchDatasetSamples,
  fetchDatasetVersion,
  groupDatasetRows,
  publishDatasetVersion,
  splitDatasetVersion,
  type DatasetGroup,
  type DatasetLimits,
  type DatasetMessage,
  type DatasetPreviewSample,
  type DatasetSample,
  type DatasetSamplePage,
  type DatasetVersion,
  type DatasetVersionRow,
} from './api.ts';

type StatusFilter = 'all' | 'published' | 'draft' | 'attention';
type SampleView = 'dialog' | 'json' | 'checks';
type UploadTarget = 'new' | 'existing';

const statusFilters: {value: StatusFilter; label: string}[] = [
  {value: 'all', label: '全部'},
  {value: 'published', label: '已发布'},
  {value: 'draft', label: '待发布'},
  {value: 'attention', label: '需处理'},
];

const attentionStates = new Set(['invalid', 'upload_failed', 'delete_failed']);

function Glyph({name}: {name: string}) {
  const paths: Record<string, string[]> = {
    upload: ['M12 16V4m0 0L7 9m5-5 5 5M5 15v4h14v-4'],
    refresh: ['M20 11a8 8 0 1 0-2 6M20 4v7h-7'],
    search: ['M20 20l-4-4', 'M18 11a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z'],
    layers: ['m12 3 9 5-9 5-9-5 9-5Z', 'm3 12 9 5 9-5M3 16l9 5 9-5'],
    check: ['m5 12 4 4L19 6'],
    chevron: ['m6 9 6 6 6-6'],
    arrowLeft: ['M19 12H5m5-5-5 5 5 5'],
    arrowRight: ['M5 12h14m-5-5 5 5-5 5'],
    download: ['M12 4v12m0 0 5-5m-5 5-5-5M5 20h14'],
    trash: ['M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5'],
    close: ['m6 6 12 12M18 6 6 18'],
    info: ['M12 11v6M12 7h.01', 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z'],
    data: ['M4 4h16v16H4z', 'M8 8h8M8 12h8M8 16h5'],
    split: ['M6 4v5c0 3 2 5 5 5h7', 'M6 20v-5c0-3 2-5 5-5h7', 'm15 11 3 3-3 3', 'm15 6 3 3-3 3'],
    edit: ['M4 20h4l10-10-4-4L4 16v4Z', 'm12.5 7.5 4 4'],
    plus: ['M12 5v14M5 12h14'],
    minus: ['M5 12h14'],
  };

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {paths[name]?.map((path) => <path d={path} key={path} />)}
    </svg>
  );
}

function StateBadge({state}: {state: string}) {
  const tone = state === 'published' ? 'ok' : attentionStates.has(state) ? 'bad' : 'neutral';
  return <span className={`dataset-state ${tone}`}>{datasetStateLabel(state)}</span>;
}

function latestSplitLabel(version: DatasetVersion | null) {
  if (!version?.split) return '尚未固定拆分';
  return `训练 ${version.split.train_count.toLocaleString('zh-CN')} · 验证 ${version.split.validation_count.toLocaleString('zh-CN')}`;
}

function percent(value: number | null | undefined) {
  if (value == null) return '—';
  return `${(value * 100).toLocaleString('zh-CN', {maximumFractionDigits: 3})}%`;
}

function rawSample(sample: DatasetPreviewSample | DatasetSample | undefined) {
  if (!sample) return '';
  if ('raw' in sample) return sample.raw;
  return JSON.stringify({messages: sample.messages}, null, 2);
}

function roleLabel(role: DatasetMessage['role']) {
  return ({system: '系统', user: '用户', assistant: '助手'} as const)[role];
}

function versionMatchesFilter(row: DatasetVersionRow, filter: StatusFilter) {
  if (filter === 'all') return true;
  if (filter === 'attention') return attentionStates.has(row.state);
  return row.state === filter;
}

function filterGroups(groups: DatasetGroup[], query: string, filter: StatusFilter) {
  const normalized = query.trim().toLowerCase();
  return groups.flatMap((group) => {
    const matchesIdentity = !normalized
      || group.name.toLowerCase().includes(normalized)
      || group.id.toLowerCase().includes(normalized)
      || datasetShortId(group.id).toLowerCase().includes(normalized);
    if (!matchesIdentity) return [];
    const versions = group.versions.filter((version) => versionMatchesFilter(version, filter));
    return versions.length ? [{...group, versions, latest: versions[0]}] : [];
  });
}

export function Datasets({writable}: {writable: boolean}) {
  const [rows, setRows] = useState<DatasetVersionRow[]>([]);
  const [limits, setLimits] = useState<DatasetLimits | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<DatasetVersion | null>(null);
  const [selectedLoading, setSelectedLoading] = useState(false);
  const [samplePage, setSamplePage] = useState<DatasetSamplePage | null>(null);
  const [samplePageLoading, setSamplePageLoading] = useState(false);
  const [samplePageError, setSamplePageError] = useState<unknown>(null);
  const [sampleDraft, setSampleDraft] = useState<DatasetMessage[] | null>(null);
  const [deriving, setDeriving] = useState(false);
  const [detailRevision, setDetailRevision] = useState(0);
  const [listLoading, setListLoading] = useState(true);
  const [listLoaded, setListLoaded] = useState(false);
  const [listFailed, setListFailed] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [datasetQuery, setDatasetQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [sampleLine, setSampleLine] = useState(1);
  const [sampleView, setSampleView] = useState<SampleView>('dialog');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadTarget, setUploadTarget] = useState<UploadTarget>('existing');
  const [uploadDatasetId, setUploadDatasetId] = useState('');
  const [uploadName, setUploadName] = useState('');
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerIndex, setPickerIndex] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const pickerOptions = useRef<(HTMLButtonElement | null)[]>([]);
  const samplePageRequest = useRef<AbortController | null>(null);
  const derivationRequestId = useRef<string | null>(null);
  const mounted = useRef(true);

  const groups = useMemo(() => groupDatasetRows(rows), [rows]);
  const duplicateNames = useMemo(() => {
    const counts = new Map<string, number>();
    for (const group of groups) counts.set(group.name, (counts.get(group.name) ?? 0) + 1);
    return new Set([...counts.entries()].filter(([, count]) => count > 1).map(([name]) => name));
  }, [groups]);
  const visibleGroups = useMemo(
    () => filterGroups(groups, datasetQuery, statusFilter),
    [datasetQuery, groups, statusFilter],
  );
  const selectedRow = useMemo(
    () => rows.find((row) => row.version_id === selectedId) ?? null,
    [rows, selectedId],
  );
  const selectedGroup = useMemo(
    () => groups.find((group) => group.id === (selected?.dataset_id ?? selectedRow?.dataset_id)) ?? null,
    [groups, selected, selectedRow],
  );
  const previousVersion = useMemo(() => {
    if (!selectedGroup || !selected) return null;
    if (selected.derived_from_version_id) {
      return selectedGroup.versions.find((version) => version.version_id === selected.derived_from_version_id) ?? null;
    }
    return selectedGroup.versions.find((version) => version.version_number < selected.version_number) ?? null;
  }, [selected, selectedGroup]);

  const overview = useMemo(() => {
    const published = rows.filter((row) => row.state === 'published').length;
    const draft = rows.filter((row) => row.state === 'draft').length;
    const attention = rows.filter((row) => attentionStates.has(row.state)).length;
    const duplicateItems = groups.filter((group) => duplicateNames.has(group.name)).length;
    const latest = rows.reduce<DatasetVersionRow | null>((current, row) => {
      if (!current) return row;
      return Date.parse(row.version_created_at) > Date.parse(current.version_created_at) ? row : current;
    }, null);
    return {
      sampleCount: rows.reduce((total, row) => total + row.sample_count, 0),
      sizeBytes: rows.reduce((total, row) => total + row.size_bytes, 0),
      published,
      draft,
      attention,
      duplicateItems,
      latest,
    };
  }, [duplicateNames, groups, rows]);

  const previewSamples: DatasetSample[] = samplePage?.samples.length
    ? samplePage.samples
    : (selected?.preview ?? []).map((sample) => ({
        ...sample,
        raw: JSON.stringify({messages: sample.messages}),
        split: null,
      }));
  const selectedSample = previewSamples.find((sample) => sample.line === sampleLine) ?? previewSamples[0];
  const selectedSampleIndex = selectedSample ? previewSamples.indexOf(selectedSample) : -1;
  const lineErrors = selected?.validation_errors.filter((item) => item.line === selectedSample?.line) ?? [];

  const load = useCallback(async () => {
    setListLoading(true);
    setListFailed(false);
    try {
      const [items, config] = await Promise.all([fetchDatasetRows(), fetchDatasetLimits()]);
      if (!mounted.current) return;
      setRows(items);
      setLimits(config);
      setListLoaded(true);
    } catch (caught) {
      if (!mounted.current) return;
      setListFailed(true);
      setError(caught);
    } finally {
      if (mounted.current) setListLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
    };
  }, [load]);

  useEffect(() => {
    if (!rows.length) {
      if (selectedId !== null) setSelectedId(null);
      if (selected !== null) setSelected(null);
      return;
    }
    if (!selectedId || !rows.some((row) => row.version_id === selectedId)) {
      setSelectedId(rows[0].version_id);
    }
  }, [rows, selected, selectedId]);

  useEffect(() => {
    if (!selectedId) return;
    const controller = new AbortController();
    setSelected(null);
    setSelectedLoading(true);
    setConfirmDelete(false);
    setError(null);
    void fetchDatasetVersion(selectedId, controller.signal)
      .then((version) => {
        setSelected(version);
        setSampleLine(version.preview[0]?.line ?? 1);
        setSampleView('dialog');
      })
      .catch((caught) => {
        if (!(caught instanceof DOMException && caught.name === 'AbortError')) setError(caught);
      })
      .finally(() => {
        if (!controller.signal.aborted) setSelectedLoading(false);
      });
    return () => controller.abort();
  }, [detailRevision, selectedId]);

  useEffect(() => {
    if (!selectedId) {
      samplePageRequest.current?.abort();
      setSamplePage(null);
      setSamplePageLoading(false);
      setSamplePageError(null);
      setSampleDraft(null);
      return;
    }
    samplePageRequest.current?.abort();
    const controller = new AbortController();
    samplePageRequest.current = controller;
    setSamplePage(null);
    setSamplePageLoading(true);
    setSamplePageError(null);
    setSampleDraft(null);
    void fetchDatasetSamples(selectedId, 0, 50, controller.signal)
      .then((page) => {
        setSamplePage(page);
        setSampleLine((current) => (
          page.samples.some((sample) => sample.line === current)
            ? current
            : page.samples[0]?.line ?? 1
        ));
      })
      .catch((caught) => {
        if (!(caught instanceof DOMException && caught.name === 'AbortError')) setSamplePageError(caught);
      })
      .finally(() => {
        if (!controller.signal.aborted) setSamplePageLoading(false);
      });
    return () => {
      controller.abort();
      if (samplePageRequest.current === controller) samplePageRequest.current = null;
    };
  }, [detailRevision, selectedId]);

  useEffect(() => {
    setSampleDraft(null);
    derivationRequestId.current = null;
  }, [sampleLine, selectedId]);

  useEffect(() => {
    if (!uploadOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [uploadOpen]);

  useEffect(() => {
    if (!uploadOpen) return;
    const close = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (pickerOpen) {
        setPickerOpen(false);
        return;
      }
      setUploadOpen(false);
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [pickerOpen, uploadOpen]);

  useEffect(() => {
    if (!pickerOpen) return;
    window.requestAnimationFrame(() => {
      pickerOptions.current[pickerIndex]?.focus();
    });
  }, [pickerIndex, pickerOpen]);

  async function refreshAll() {
    if (busy) return;
    setBusy(true);
    setError(null);
    setMessage('');
    try {
      await load();
      setDetailRevision((value) => value + 1);
    } finally {
      setBusy(false);
    }
  }

  function openUpload() {
    setError(null);
    setMessage('');
    setUploadOpen(true);
    setUploadTarget(groups.length ? 'existing' : 'new');
    setUploadDatasetId(selected?.dataset_id ?? groups[0]?.id ?? '');
    setUploadName('');
    setUploadFile(null);
    setPickerOpen(false);
    if (fileInput.current) fileInput.current.value = '';
  }

  function closeUpload() {
    if (busy) return;
    setUploadOpen(false);
    setPickerOpen(false);
    setUploadFile(null);
    if (fileInput.current) fileInput.current.value = '';
  }

  function chooseUploadDataset(group: DatasetGroup) {
    setUploadDatasetId(group.id);
    setPickerOpen(false);
    setError(null);
  }

  function pickerKeyboard(event: KeyboardEvent<HTMLButtonElement>, groupIndex: number) {
    if (event.key === 'Escape') {
      event.preventDefault();
      setPickerOpen(false);
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    if (event.key === 'Home') setPickerIndex(0);
    else if (event.key === 'End') setPickerIndex(groups.length - 1);
    else setPickerIndex((groupIndex + (event.key === 'ArrowDown' ? 1 : -1) + groups.length) % groups.length);
  }

  function sampleKeyboard(event: KeyboardEvent<HTMLElement>) {
    if (sampleDraft || !selectedSample || previewSamples.length < 2) return;
    if (!['ArrowUp', 'ArrowDown'].includes(event.key)) return;
    const target = event.target;
    if (target instanceof HTMLElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
    event.preventDefault();
    const offset = event.key === 'ArrowDown' ? 1 : -1;
    const next = Math.min(previewSamples.length - 1, Math.max(0, selectedSampleIndex + offset));
    setSampleLine(previewSamples[next].line);
  }

  async function loadMoreSamples() {
    if (!selected || samplePage?.next_offset == null || samplePageLoading) return;
    const expectedVersionId = selected.id;
    const controller = new AbortController();
    samplePageRequest.current?.abort();
    samplePageRequest.current = controller;
    setSamplePageLoading(true);
    setSamplePageError(null);
    try {
      const next = await fetchDatasetSamples(
        expectedVersionId,
        samplePage.next_offset,
        samplePage.limit,
        controller.signal,
      );
      if (!controller.signal.aborted) {
        setSamplePage((current) => appendDatasetSamplePage(current, next, expectedVersionId));
      }
    } catch (caught) {
      if (!(caught instanceof DOMException && caught.name === 'AbortError')) {
        setSamplePageError(caught);
      }
    } finally {
      if (!controller.signal.aborted) {
        setSamplePageLoading(false);
        if (samplePageRequest.current === controller) samplePageRequest.current = null;
      }
    }
  }

  function beginEdit() {
    if (!selectedSample) return;
    derivationRequestId.current = null;
    setError(null);
    setMessage('');
    setSampleView('dialog');
    setSampleDraft(selectedSample.messages.map((message) => ({...message})));
  }

  function updateDraftMessage(index: number, patch: Partial<DatasetMessage>) {
    derivationRequestId.current = null;
    setSampleDraft((current) => current?.map((message, messageIndex) => (
      messageIndex === index ? {...message, ...patch} : message
    )) ?? null);
  }

  function addDraftMessage() {
    derivationRequestId.current = null;
    setSampleDraft((current) => [...(current ?? []), {role: 'assistant', content: ''}]);
  }

  function removeDraftMessage(index: number) {
    derivationRequestId.current = null;
    setSampleDraft((current) => current?.filter((_, messageIndex) => messageIndex !== index) ?? null);
  }

  async function submitDerived(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || !selectedSample || !sampleDraft || deriving) return;
    const expectedSha256 = samplePage?.sha256 ?? selected.sha256;
    const requestId = derivationRequestId.current ?? crypto.randomUUID();
    derivationRequestId.current = requestId;
    setDeriving(true);
    setError(null);
    setMessage('');
    let derivedId: string | undefined;
    try {
      const derived = await deriveDatasetVersion(
        selected.id,
        requestId,
        expectedSha256,
        selectedSample.line,
        sampleDraft,
      );
      derivedId = derived.id;
      derivationRequestId.current = null;
      setMessage(`已从 v${selected.version_number} 派生 v${derived.version_number}，原版本保持不变。`);
    } catch (caught) {
      if (caught instanceof ApiError && caught.details && typeof caught.details === 'object' && 'version_id' in caught.details) {
        derivedId = String(caught.details.version_id);
        derivationRequestId.current = null;
      }
      setError(caught);
    } finally {
      setDeriving(false);
    }
    if (derivedId) {
      setSampleDraft(null);
      await load();
      setSelectedId(derivedId);
    }
  }

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setError(null);
    setMessage('');
    if (!uploadFile) {
      setError(new Error('请选择 messages JSONL 文件。'));
      return;
    }
    if (!limits) {
      setError(new Error('容量配置尚未读取，请刷新后重试。'));
      return;
    }
    if (uploadFile.size > limits.file_limit_bytes) {
      setError(new Error(`文件超过服务端配置上限：${bytes(limits.file_limit_bytes)}。`));
      return;
    }
    if (uploadTarget === 'new' && !uploadName.trim()) {
      setError(new Error('请输入数据集名称。'));
      return;
    }
    if (uploadTarget === 'existing' && !uploadDatasetId) {
      setError(new Error('请选择要追加版本的数据集。'));
      return;
    }

    setBusy(true);
    let versionId: string | undefined;
    try {
      const version = uploadTarget === 'new'
        ? await createDataset(uploadName.trim(), uploadFile)
        : await createDatasetVersion(uploadDatasetId, uploadFile);
      versionId = version.id;
      setMessage(`文件已写入 MinIO 并完成服务端校验：${version.dataset_name} · v${version.version_number}。`);
      setUploadOpen(false);
    } catch (caught) {
      if (caught instanceof ApiError && caught.details && typeof caught.details === 'object' && 'version_id' in caught.details) {
        versionId = String(caught.details.version_id);
      }
      setError(caught);
      if (versionId) setUploadOpen(false);
    } finally {
      setBusy(false);
      setUploadFile(null);
      if (fileInput.current) fileInput.current.value = '';
    }
    await load();
    if (versionId) setSelectedId(versionId);
  }

  async function runOperation(operation: () => Promise<string>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    setMessage('');
    try {
      const result = await operation();
      setMessage(result);
      await load();
      setDetailRevision((value) => value + 1);
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }

  async function removeVersion() {
    if (!selected) return;
    await runOperation(async () => {
      await deleteDatasetVersion(selected.id);
      setSelectedId(null);
      setSelected(null);
      return '数据集版本及其正式存储对象已删除。';
    });
  }

  return (
    <>
      <div className="dataset-page-heading">
        <div>
          <h1>数据审阅工作室</h1>
          <p>从真实版本与对象存储状态进入单个数据集，在同一工作区完成核对、审阅和发布判断。</p>
        </div>
        <div className="dataset-heading-actions">
          <button className="secondary" type="button" disabled={busy || listLoading} onClick={() => void refreshAll()}>
            <Glyph name="refresh" />{busy ? '刷新中' : '刷新'}
          </button>
          <button type="button" disabled={!writable || !limits} onClick={openUpload}>
            <Glyph name="upload" />上传 JSONL
          </button>
        </div>
      </div>

      <Failure error={error} />
      {message && <p className="success-message" role="status">{message}</p>}
      {!writable && <p className="notice">依赖状态不可用或未知，上传、发布和删除已暂停。</p>}
      {listFailed && listLoaded && <p className="notice">列表刷新失败，当前保留上次成功读取的数据，内容可能已过期。</p>}

      <section className="prod-overview" aria-label="数据集整体统计">
        <div className={`prod-overview-health ${overview.attention ? 'attention' : ''}`}>
          <span><Glyph name={overview.attention ? 'info' : 'check'} /></span>
          <div>
            <strong>{rows.length ? overview.attention ? '存在待处理版本' : '版本记录已载入' : '等待首个数据集'}</strong>
            <small>{rows.length ? '状态来自 PostgreSQL；对象内容需通过详情或下载核验' : '上传 JSONL 后生成真实版本记录'}</small>
          </div>
        </div>
        <div className="prod-overview-main">
          <span>整体统计</span>
          <strong>{groups.length} 个数据集 · {rows.length} 个版本</strong>
          <small>{overview.latest ? `最近更新 ${date(overview.latest.version_created_at)}` : '尚无版本记录'}</small>
        </div>
        {[
          ['有效样本', overview.sampleCount.toLocaleString('zh-CN'), '跨全部版本'],
          ['版本文件', bytes(overview.sizeBytes), '按版本元数据汇总'],
          ['已发布', `${overview.published} / ${rows.length}`, `${overview.draft} 个待发布`],
          ['校验异常', String(overview.attention), overview.attention ? '需要处理' : '当前无阻塞'],
          ['同名数据集', String(overview.duplicateItems), '均以不可变 ID 区分'],
        ].map(([label, value, detail]) => (
          <div className="prod-overview-metric" key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
            <small>{detail}</small>
          </div>
        ))}
      </section>

      <section className="dataset-studio">
        <aside className="dataset-tree-pane" aria-label="数据集与版本">
          <div className="dataset-pane-heading">
            <div><h2>数据集与版本</h2><small>{groups.length} 组 · {duplicateNames.size} 组同名</small></div>
            <Glyph name="layers" />
          </div>
          <div className="dataset-tree-tools">
            <label className="dataset-search">
              <Glyph name="search" />
              <input
                type="search"
                value={datasetQuery}
                onChange={(event) => setDatasetQuery(event.target.value)}
                placeholder="名称、DT 编号或完整 ID"
                aria-label="搜索数据集"
              />
            </label>
            <div className="dataset-filter" aria-label="版本状态筛选">
              {statusFilters.map((item) => (
                <button
                  className={statusFilter === item.value ? 'active' : ''}
                  key={item.value}
                  type="button"
                  onClick={() => setStatusFilter(item.value)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
          <div className="dataset-tree-list">
            {listLoading && !listLoaded ? (
              <div className="dataset-pane-loading">正在读取真实数据集…</div>
            ) : visibleGroups.length ? visibleGroups.map((group) => (
              <article className={`dataset-tree-item ${group.id === selectedGroup?.id ? 'active' : ''}`} key={group.id}>
                <button
                  className="dataset-tree-identity"
                  type="button"
                  onClick={() => setSelectedId(group.latest.version_id)}
                  title={group.id}
                >
                  <span>
                    <strong>{group.name}</strong>
                    {duplicateNames.has(group.name) && <i>同名</i>}
                  </span>
                  <code>{datasetShortId(group.id)}</code>
                </button>
                <div className="dataset-tree-meta">
                  <span>{group.versions.length} 个版本</span>
                  <span>{group.latest.sample_count.toLocaleString('zh-CN')} 条</span>
                  <span>{date(group.latest.version_created_at)}</span>
                </div>
                <div className="dataset-version-chips">
                  {group.versions.map((version) => (
                    <button
                      className={`${version.version_id === selectedId ? 'active' : ''} ${attentionStates.has(version.state) ? 'attention' : ''}`}
                      key={version.version_id}
                      type="button"
                      onClick={() => setSelectedId(version.version_id)}
                      aria-pressed={version.version_id === selectedId}
                      title={`${datasetStateLabel(version.state)} · ${version.sample_count} 条样本`}
                    >
                      <i />
                      v{version.version_number}
                    </button>
                  ))}
                </div>
              </article>
            )) : (
              <Empty>{groups.length ? '没有符合搜索或状态筛选的版本。' : '尚无数据集。上传 JSONL 后生成第一个版本。'}</Empty>
            )}
          </div>
        </aside>

        <section
          className="dataset-review-pane"
          aria-label="样本审阅"
          tabIndex={0}
          onKeyDown={sampleKeyboard}
        >
          <div className="dataset-review-toolbar">
            <div>
              <strong>
                {selected
                  ? `${selected.dataset_name} · v${selected.version_number} · ${selectedSample ? `第 ${selectedSample.line} 行` : '样本预览'}`
                  : selectedLoading ? '正在读取版本详情…' : '选择版本开始审阅'}
              </strong>
              <small>
                {selected
                  ? `${datasetStateLabel(selected.state)} · ${selected.sample_count.toLocaleString('zh-CN')} 条有效样本 · 已载入 ${previewSamples.length} 条`
                  : selectedRow ? `${datasetStateLabel(selectedRow.state)} · ${selectedRow.sample_count} 条样本` : '真实数据来自 PostgreSQL 与 MinIO'}
              </small>
            </div>
            <div className="dataset-review-actions">
              <div className="dataset-segments" aria-label="样本视图">
                {([
                  ['dialog', '对话'],
                  ['json', 'JSONL'],
                  ['checks', '校验'],
                ] as const).map(([value, label]) => (
                  <button
                    className={sampleView === value ? 'active' : ''}
                    key={value}
                    type="button"
                    disabled={!selectedSample}
                    onClick={() => setSampleView(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <button
                className="secondary"
                type="button"
                disabled={!selectedSample || selectedSampleIndex <= 0}
                onClick={() => {
                  setSampleDraft(null);
                  setSampleLine(previewSamples[selectedSampleIndex - 1].line);
                }}
                aria-keyshortcuts="ArrowUp"
              >
                <Glyph name="arrowLeft" />上一行
              </button>
              <button
                className="secondary"
                type="button"
                disabled={!selectedSample || selectedSampleIndex >= previewSamples.length - 1}
                onClick={() => {
                  setSampleDraft(null);
                  setSampleLine(previewSamples[selectedSampleIndex + 1].line);
                }}
                aria-keyshortcuts="ArrowDown"
              >
                下一行<Glyph name="arrowRight" />
              </button>
              {selected && ['draft', 'invalid', 'published'].includes(selected.state) && (
                <button
                  className="secondary"
                  type="button"
                  disabled={!writable || !selectedSample || deriving}
                  onClick={beginEdit}
                >
                  <Glyph name="edit" />编辑并派生
                </button>
              )}
            </div>
          </div>

          {samplePageError != null && (
            <div className="dataset-inline-alert dataset-sample-page-alert">
              <strong>完整样本分页暂未载入</strong>
              <p>{samplePageError instanceof Error ? samplePageError.message : '服务端样本分页读取失败。'}</p>
              <button className="text-button" type="button" onClick={() => setDetailRevision((value) => value + 1)}>
                重试
              </button>
            </div>
          )}

          {!selected ? (
            <div className="dataset-review-empty">
              {selectedLoading || samplePageLoading ? '正在校验版本并读取样本预览…' : '从左侧选择数据集和版本，或上传第一份 JSONL。'}
            </div>
          ) : (
            <div className="dataset-sample-workspace">
              <aside className="dataset-sample-index" aria-label="样本列表">
                <div><span>物理行</span><span>预览</span></div>
                <div className="dataset-sample-list">
                  {previewSamples.map((sample) => (
                    <button
                      className={sample.line === selectedSample?.line ? 'active' : ''}
                      key={sample.line}
                      type="button"
                      onClick={() => {
                        setSampleDraft(null);
                        setSampleLine(sample.line);
                      }}
                    >
                      <span>{sample.line}</span>
                      <span>
                        <strong>{sample.messages.find((message) => message.role === 'user')?.content ?? '无用户消息'}</strong>
                        <small>
                          {sample.messages.length} 条消息
                          {sample.split === 'train' ? ' · 训练' : sample.split === 'validation' ? ' · 验证' : ' · 未拆分'}
                        </small>
                      </span>
                    </button>
                  ))}
                </div>
                {samplePage?.next_offset != null && (
                  <button
                    className="dataset-sample-load-more"
                    type="button"
                    disabled={samplePageLoading}
                    onClick={() => void loadMoreSamples()}
                  >
                    {samplePageLoading ? '正在载入…' : `载入更多 · ${previewSamples.length}/${samplePage.sample_count}`}
                  </button>
                )}
              </aside>
              <div className="dataset-sample-reader">
                <div className="dataset-sample-heading">
                  <div>
                    <h3>{selectedSample ? `物理行 ${selectedSample.line}` : '没有可预览样本'}</h3>
                    <p>
                      {selectedSample
                        ? `${selectedSample.messages.length} 条消息 · ${selectedSample.split === 'train' ? '训练集' : selectedSample.split === 'validation' ? '验证集' : '尚未固定拆分'}`
                        : `服务校验错误 ${selected.validation_errors.length} 条`}
                    </p>
                  </div>
                  <StateBadge state={selected.state} />
                </div>
                <div className="dataset-sample-body">
                  {selected.validation_errors.length > 0 && (
                    <div className="dataset-inline-alert">
                      <strong>服务端校验未通过</strong>
                      <ul>
                        {selected.validation_errors.slice(0, 8).map((item, index) => (
                          <li key={`${item.line}-${item.path}-${index}`}>第 {item.line} 行 · {item.path}：{item.message}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {sampleDraft ? (
                    <form className="dataset-sample-editor" onSubmit={(event) => void submitDerived(event)}>
                      <div className="dataset-editor-heading">
                        <div>
                          <span>派生新版本</span>
                          <h4>编辑物理行 {selectedSample?.line}</h4>
                          <p>保存后会重新校验整个 JSONL，并生成新的草稿版本；当前 v{selected.version_number} 不会被覆盖。</p>
                        </div>
                        <code>base {(samplePage?.sha256 ?? selected.sha256).slice(0, 10)}…</code>
                      </div>
                      <div className="dataset-editor-messages">
                        {sampleDraft.map((message, index) => (
                          <article className={`role-${message.role}`} key={`${index}-${message.role}`}>
                            <label>
                              <span>消息 {index + 1} · 角色</span>
                              <select
                                value={message.role}
                                aria-label={`消息 ${index + 1} 角色`}
                                onChange={(event) => updateDraftMessage(index, {
                                  role: event.target.value as DatasetMessage['role'],
                                })}
                              >
                                <option value="system">system · 系统</option>
                                <option value="user">user · 用户</option>
                                <option value="assistant">assistant · 助手</option>
                              </select>
                            </label>
                            <label>
                              <span>content</span>
                              <textarea
                                value={message.content}
                                aria-label={`消息 ${index + 1} 内容`}
                                onChange={(event) => updateDraftMessage(index, {content: event.target.value})}
                              />
                            </label>
                            <button
                              className="dataset-editor-remove"
                              type="button"
                              aria-label={`删除消息 ${index + 1}`}
                              disabled={sampleDraft.length === 1 || deriving}
                              onClick={() => removeDraftMessage(index)}
                            >
                              <Glyph name="minus" />
                            </button>
                          </article>
                        ))}
                      </div>
                      <button className="dataset-editor-add" type="button" disabled={deriving} onClick={addDraftMessage}>
                        <Glyph name="plus" />添加 assistant 消息
                      </button>
                      <div className="dataset-editor-actions">
                        <p>服务端会核验基准 SHA-256；若版本在此期间变化，将拒绝覆盖并提示刷新。</p>
                        <div>
                          <button className="secondary" type="button" disabled={deriving} onClick={() => setSampleDraft(null)}>
                            取消
                          </button>
                          <button type="submit" disabled={deriving || !writable}>
                            {deriving ? '正在校验并派生…' : `派生 v${(selectedGroup?.latest.version_number ?? selected.version_number) + 1}`}
                          </button>
                        </div>
                      </div>
                    </form>
                  ) : !selectedSample ? (
                    <Empty>该版本没有可展示的有效样本预览。</Empty>
                  ) : sampleView === 'json' ? (
                    <pre className="dataset-json-view">{rawSample(selectedSample)}</pre>
                  ) : sampleView === 'checks' ? (
                    <div className="dataset-check-list">
                      {[
                        ['JSON 与字段', lineErrors.length ? `${lineErrors.length} 个错误` : '服务端解析通过'],
                        ['角色顺序', selectedSample.messages[0]?.role === 'system' ? 'system → user → assistant' : 'user → assistant'],
                        ['消息内容', `${selectedSample.messages.filter((message) => message.content.trim()).length} / ${selectedSample.messages.length} 条非空`],
                        ['拆分清单', selected.split ? latestSplitLabel(selected) : '尚未生成固定拆分'],
                        ['内容身份', selected.sha256],
                      ].map(([label, value]) => (
                        <div key={label}>
                          <span><Glyph name="check" /></span>
                          <strong>{label}</strong>
                          <small title={value}>{value}</small>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="dataset-message-stack">
                      {selectedSample.messages.map((entry, index) => (
                        <article className={`role-${entry.role}`} key={`${entry.role}-${index}`}>
                          <span>{entry.role.slice(0, 1).toUpperCase()}</span>
                          <div><strong>{roleLabel(entry.role)}</strong><p>{entry.content}</p></div>
                        </article>
                      ))}
                    </div>
                  )}
                </div>
                <div className="dataset-sample-footer">
                  <span>{selectedSample ? `第 ${selectedSample.line} 行 · ${selectedSample.messages.length} 条消息` : '无预览'}</span>
                  <span>
                    {samplePage
                      ? `已载入 ${previewSamples.length} / ${samplePage.sample_count} 条 · 每页 ${samplePage.limit} 条`
                      : `兼容预览 ${limits?.preview_samples ?? '—'} 条`}
                  </span>
                </div>
              </div>
            </div>
          )}
        </section>

        <aside className="dataset-quality-pane" aria-label="版本检查与操作">
          <div className="dataset-pane-heading">
            <div><h2>版本检查</h2><small>{selected ? `${datasetShortId(selected.dataset_id)} · v${selected.version_number}` : '未选择版本'}</small></div>
            {selected && <StateBadge state={selected.state} />}
          </div>
          {!selected ? (
            <div className="dataset-quality-empty">{selectedLoading ? '正在读取版本质量信息…' : '选择版本后查看拆分、身份和引用。'}</div>
          ) : (
            <div className="dataset-quality-body">
              <section>
                <h3>当前版本概览</h3>
                <div className="dataset-quality-kpis">
                  <div><span>有效样本</span><strong>{selected.sample_count.toLocaleString('zh-CN')}</strong></div>
                  <div><span>训练 / 验证</span><strong>{selected.split ? `${selected.split.train_count} / ${selected.split.validation_count}` : '—'}</strong></div>
                  <div><span>实际验证比例</span><strong>{percent(selected.split?.actual_ratio)}</strong></div>
                  <div><span>文件大小</span><strong>{bytes(selected.size_bytes)}</strong></div>
                </div>
              </section>
              <section>
                <h3>发布状态</h3>
                <div className="dataset-quality-callout">
                  <strong>{datasetStateLabel(selected.state)}</strong>
                  <p>{selected.state === 'published' ? '版本已固定并可用于训练。' : selected.state === 'draft' ? '版本通过校验，发布后会生成固定拆分。' : '请根据校验错误修正原始内容后再处理。'}</p>
                </div>
                <div className="dataset-quality-tags">
                  <span>{selected.validation_errors.length} errors</span>
                  <span>{selected.split_sha256 ? '拆分已核验' : '拆分待生成'}</span>
                </div>
              </section>
              <section>
                <h3>固定拆分</h3>
                {selected.split ? (
                  <>
                    <div className="dataset-split-bar"><i style={{width: `${selected.split.actual_ratio * 100}%`}} /></div>
                    <div className="dataset-split-labels"><span>训练 {selected.split.train_count} 条</span><span>验证 {selected.split.validation_count} 条 · seed {selected.split.seed}</span></div>
                    <p className="dataset-small-note">请求目标 {percent(selected.split.requested_ratio)}，实际 {percent(selected.split.actual_ratio)}。</p>
                  </>
                ) : (
                  <p className="dataset-small-note">发布版本时由服务端按 10% 验证集和 seed 42 生成固定拆分。</p>
                )}
              </section>
              <section>
                <h3>不可变身份</h3>
                <dl className="dataset-identity-list">
                  <dt>dataset</dt><dd><code>{datasetShortId(selected.dataset_id)}</code></dd>
                  <dt>version</dt><dd>v{selected.version_number}</dd>
                  <dt>SHA-256</dt><dd title={selected.sha256}>{selected.sha256.slice(0, 8)}…{selected.sha256.slice(-8)}</dd>
                  <dt>物理行</dt><dd>{selected.line_count.toLocaleString('zh-CN')}</dd>
                  {selected.derived_from_version_id && (
                    <>
                      <dt>派生来源</dt>
                      <dd title={selected.derived_from_version_id}>
                        {previousVersion ? `v${previousVersion.version_number}` : selected.derived_from_version_id.slice(0, 8)}
                      </dd>
                    </>
                  )}
                </dl>
              </section>
              <section>
                <h3>版本血缘</h3>
                {previousVersion ? (
                  <button className="dataset-lineage" type="button" onClick={() => setSelectedId(previousVersion.version_id)}>
                    <span><small>{selected.derived_from_version_id ? '派生来源' : '上一版本'}</small><strong>v{previousVersion.version_number}</strong></span>
                    <Glyph name="arrowRight" />
                    <span><small>当前版本</small><strong>v{selected.version_number}</strong></span>
                  </button>
                ) : <p className="dataset-small-note">{selected.derived_from_version_id ? '派生来源版本已删除。' : '这是当前数据集的首个版本。'}</p>}
              </section>
              <section>
                <h3>引用与风险</h3>
                <dl className="dataset-risk-list">
                  <dt>训练任务引用</dt><dd>{selected.references.length}</dd>
                  <dt>派生版本</dt><dd>{selected.derived_versions.length}</dd>
                  <dt>删除保护</dt><dd>{selected.references.length || selected.derived_versions.length ? '已启用' : '允许删除'}</dd>
                </dl>
                {selected.derived_versions.length > 0 && (
                  <p className="dataset-small-note">先处理派生版本，再删除当前来源版本。</p>
                )}
              </section>
              <section className="dataset-actions">
                <h3>操作</h3>
                {selected.state === 'draft' && (
                  <button
                    type="button"
                    disabled={busy || !writable}
                    onClick={() => void runOperation(async () => {
                      await publishDatasetVersion(selected.id);
                      return `已发布 ${selected.dataset_name} · v${selected.version_number}。`;
                    })}
                  >发布版本</button>
                )}
                {['draft', 'published'].includes(selected.state) && !selected.split && (
                  <button
                    className="secondary"
                    type="button"
                    disabled={busy || !writable}
                    onClick={() => void runOperation(async () => {
                      await splitDatasetVersion(selected.id);
                      return '服务端拆分已保存；重复请求会复用同一清单。';
                    })}
                  >
                    <Glyph name="split" />保存 10% 验证集拆分
                  </button>
                )}
                {['draft', 'invalid', 'published'].includes(selected.state) && (
                  <a
                    className="dataset-secondary-link"
                    href={`/api/v1/dataset-versions/${selected.id}/content`}
                    download={`${selected.dataset_name}-v${selected.version_number}.jsonl`}
                  >
                    <Glyph name="download" />下载原始 JSONL
                  </a>
                )}
                <button
                  className="dataset-danger-button"
                  type="button"
                  disabled={busy || !writable || selected.references.length > 0 || selected.derived_versions.length > 0}
                  onClick={() => setConfirmDelete(true)}
                >
                  <Glyph name="trash" />删除版本
                </button>
                {confirmDelete && (
                  <div className="dataset-confirm-delete">
                    <p>
                      <strong>{datasetShortId(selected.dataset_id)} · v{selected.version_number} · {selected.dataset_name}</strong>
                      <span>将删除该版本和正式存储对象，此操作不可恢复。</span>
                    </p>
                    <button className="dataset-danger-button" type="button" disabled={busy} onClick={() => void removeVersion()}>确认删除</button>
                    <button className="secondary" type="button" disabled={busy} onClick={() => setConfirmDelete(false)}>保留版本</button>
                  </div>
                )}
                {selected.references.length > 0 && (
                  <p className="dataset-small-note"><Glyph name="info" />版本已被训练任务引用，引用解除前不能删除。</p>
                )}
              </section>
            </div>
          )}
        </aside>
      </section>

      {uploadOpen && (
        <div className="dataset-upload-layer">
          <button className="dataset-upload-scrim" type="button" aria-label="关闭上传面板" onClick={closeUpload} />
          <aside className="dataset-upload-drawer" role="dialog" aria-modal="true" aria-labelledby="dataset-upload-title">
            <header>
              <div>
                <h2 id="dataset-upload-title">上传 messages JSONL</h2>
                <p>选择目标、校验内容，再提交不可变版本。</p>
              </div>
              <button type="button" aria-label="关闭上传面板" disabled={busy} onClick={closeUpload}><Glyph name="close" /></button>
            </header>
            <form onSubmit={(event) => void upload(event)}>
              <div className="dataset-upload-body">
                <section>
                  <div className="dataset-upload-step"><span>01</span><strong>选择版本目标</strong></div>
                  <div className="dataset-upload-targets">
                    <button
                      className={uploadTarget === 'new' ? 'active' : ''}
                      type="button"
                      onClick={() => {
                        setUploadTarget('new');
                        setPickerOpen(false);
                      }}
                    >
                      <strong>新建数据集</strong><small>从 v1 开始</small>
                    </button>
                    <button
                      className={uploadTarget === 'existing' ? 'active' : ''}
                      type="button"
                      disabled={!groups.length}
                      onClick={() => {
                        setUploadTarget('existing');
                        setPickerOpen(false);
                      }}
                    >
                      <strong>追加已有数据集</strong><small>自动生成下一版本</small>
                    </button>
                  </div>
                  {uploadTarget === 'new' ? (
                    <label className="dataset-upload-field">
                      <span>数据集名称</span>
                      <input maxLength={120} value={uploadName} onChange={(event) => setUploadName(event.target.value)} placeholder="例如：客服问答" />
                      <small>新数据集将获得独立 dataset_id；同名名称不会合并。</small>
                    </label>
                  ) : (
                    <div className="dataset-upload-field">
                      <span id="dataset-upload-picker-label">已有数据集 · 名称相同时请核对 ID</span>
                      <div className="dataset-upload-picker">
                        <button
                          className={pickerOpen ? 'open' : ''}
                          type="button"
                          title={groups.find((item) => item.id === uploadDatasetId)?.id ?? groups[0]?.id}
                          aria-labelledby="dataset-upload-picker-label"
                          aria-expanded={pickerOpen}
                          aria-haspopup="listbox"
                          onClick={() => {
                            const activeIndex = Math.max(0, groups.findIndex((group) => group.id === uploadDatasetId));
                            setPickerIndex(activeIndex);
                            setPickerOpen((open) => !open);
                          }}
                          onKeyDown={(event) => {
                            if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
                            event.preventDefault();
                            setPickerIndex(Math.max(0, groups.findIndex((group) => group.id === uploadDatasetId)));
                            setPickerOpen(true);
                          }}
                        >
                          <span className="dataset-picker-glyph"><Glyph name="layers" /></span>
                          {(() => {
                            const group = groups.find((item) => item.id === uploadDatasetId) ?? groups[0];
                            return (
                              <span>
                                <strong>{group?.name ?? '选择数据集'}</strong>
                                <small>{group ? `${group.versions.length} 个版本 · 最新 v${group.latest.version_number} · ${group.latest.sample_count} 条有效样本 · ${datasetStateLabel(group.latest.state)}` : '尚无可追加的数据集'}</small>
                              </span>
                            );
                          })()}
                          <code>{datasetShortId(groups.find((item) => item.id === uploadDatasetId)?.id ?? groups[0]?.id ?? '')}</code>
                          <i><Glyph name="chevron" /></i>
                        </button>
                        {pickerOpen && (
                          <div className="dataset-upload-picker-menu" role="listbox" aria-labelledby="dataset-upload-picker-label">
                            <div><strong>选择目标数据集</strong><small>{groups.length} 项 · ID 为唯一匹配依据</small></div>
                            {groups.map((group, index) => (
                              <button
                                ref={(node) => {
                                  pickerOptions.current[index] = node;
                                }}
                                className={group.id === uploadDatasetId ? 'selected' : ''}
                                key={group.id}
                                type="button"
                                title={group.id}
                                role="option"
                                aria-selected={group.id === uploadDatasetId}
                                onClick={() => chooseUploadDataset(group)}
                                onKeyDown={(event) => pickerKeyboard(event, index)}
                              >
                                <span>
                                  <span>
                                    <strong>{group.name}</strong>
                                    <code>{datasetShortId(group.id)}</code>
                                    {duplicateNames.has(group.name) && <i>同名</i>}
                                  </span>
                                  <small>{group.versions.length} 个版本 · 最新 v{group.latest.version_number} · {group.latest.sample_count} 条有效样本</small>
                                </span>
                                <StateBadge state={group.latest.state} />
                                <b>{group.id === uploadDatasetId && <Glyph name="check" />}</b>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </section>

                <section>
                  <div className="dataset-upload-step"><span>02</span><strong>选择文件</strong></div>
                  <label className={`dataset-file-drop ${uploadFile ? 'has-file' : ''}`}>
                    <input
                      ref={fileInput}
                      type="file"
                      accept=".jsonl,application/x-ndjson"
                      required
                      onChange={(event: ChangeEvent<HTMLInputElement>) => setUploadFile(event.target.files?.[0] ?? null)}
                    />
                    <span><Glyph name={uploadFile ? 'data' : 'upload'} /></span>
                    <strong>{uploadFile?.name ?? '拖入 JSONL，或点击选择文件'}</strong>
                    <small>{uploadFile ? `${bytes(uploadFile.size)} · 等待服务端校验` : '仅接收 UTF-8 messages JSONL，每行一条对话'}</small>
                  </label>
                </section>

                <section>
                  <div className="dataset-upload-step"><span>03</span><strong>服务端限制</strong></div>
                  <div className="dataset-limit-grid">
                    <div><span>单文件上限</span><strong>{limits ? bytes(limits.file_limit_bytes) : '读取中'}</strong></div>
                    <div><span>有效样本上限</span><strong>{limits?.sample_limit.toLocaleString('zh-CN') ?? '读取中'}</strong></div>
                    <div><span>单行上限</span><strong>{limits ? bytes(limits.line_limit_bytes) : '读取中'}</strong></div>
                    <div><span>错误展示</span><strong>{limits ? `${limits.validation_error_limit} 条` : '读取中'}</strong></div>
                  </div>
                  <p className="dataset-upload-note"><Glyph name="info" />原始内容会写入 MinIO 并回读核验；校验失败的版本仍会保留用于定位问题。</p>
                </section>
              </div>
              <footer>
                <span><Glyph name="info" />{limits?.locked ? '服务端限额已锁定' : '服务端限额当前为初始配置'}</span>
                <div>
                  <button className="secondary" type="button" disabled={busy} onClick={closeUpload}>取消</button>
                  <button type="submit" disabled={busy || !uploadFile || !limits}>{busy ? '正在上传并校验…' : uploadTarget === 'new' ? '创建 v1' : `追加 v${(groups.find((group) => group.id === uploadDatasetId)?.latest.version_number ?? 0) + 1}`}</button>
                </div>
              </footer>
            </form>
          </aside>
        </div>
      )}
    </>
  );
}
