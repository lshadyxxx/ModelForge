import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type InputHTMLAttributes,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { bytes, date, Failure } from '../../shared/assets';
import { api, json } from '../../shared/http';
import { AdapterAssets } from './AdapterAssets';
import { listAdapters, type AdapterVersion } from './adapters';
import {
  filterModelGroups,
  groupModelRows,
  mergeVersionRow,
  modelShortId,
  summarizeModelGroup,
  type Limits,
  type ModelFilter,
  type ModelGroup,
  type Row,
  type Version,
} from './api';
import { uploadModelDirectory } from './directory-upload';
import { registerExternalBase } from './external-base';
import { ExternalBaseForm } from './ExternalBaseForm';

const directoryAttributes = { webkitdirectory: '', directory: '' } as InputHTMLAttributes<HTMLInputElement>;

const statusLabels: Record<string, string> = {
  awaiting_verification: '待实例核对',
  external_observed: '外部文件已观察',
  mismatch: '内容不一致',
  pending: '待处理',
  upload_failed: '上传失败',
  uploading: '传输中',
  available: '文件已校验',
  cancelled: '已取消',
  failed: '失败',
  queued: '排队中',
  running: '下载中',
  succeeded: '已完成',
  verified: '已回读校验',
  deleting: '删除中',
  delete_failed: '删除失败',
  unverified: '兼容性未验证',
};

type SourceKind = 'modelscope' | 'directory' | 'ucloud_public';
type DetailTab = 'overview' | 'files' | 'lineage';
type Tone = 'ok' | 'warn' | 'bad' | 'neutral';

const tabs: {id: DetailTab; label: string}[] = [
  {id: 'overview', label: '验证总览'},
  {id: 'files', label: '文件清单'},
  {id: 'lineage', label: '训练产物与血缘'},
];

function statusTone(value: string): Tone {
  if (['available', 'verified', 'succeeded', 'external_observed'].includes(value)) return 'ok';
  if (['failed', 'upload_failed', 'delete_failed', 'mismatch'].includes(value)) return 'bad';
  if (['uploading', 'queued', 'running', 'pending', 'awaiting_verification', 'unverified', 'cancelled', 'deleting'].includes(value)) return 'warn';
  return 'neutral';
}

function ModelState({value, label, tone}: {value: string; label?: string; tone?: Tone}) {
  const resolvedTone = tone ?? statusTone(value);
  return <span className={`model-badge ${resolvedTone}`}>{label ?? statusLabels[value] ?? value}</span>;
}

function sourceLabel(source: string) {
  if (source === 'ucloud_public') return '优云外部只读';
  if (source === 'modelscope') return 'ModelScope';
  return '目录上传';
}

function sourceMark(source: string) {
  if (source === 'ucloud_public') return 'U';
  if (source === 'modelscope') return 'MS';
  return 'DIR';
}

function sourceDetail(version: Version) {
  if (version.import) {
    return {
      title: 'ModelScope 固定快照',
      primary: version.import.source_snapshot.repository,
      secondary: version.import.source_snapshot.revision,
    };
  }
  if (version.external) {
    return {
      title: '优云公共目录快照',
      primary: version.external.source_snapshot.path,
      secondary: version.external.source_snapshot.region,
    };
  }
  return {
    title: '完整目录上传',
    primary: version.files.length + ' 个文件',
    secondary: 'config / tokenizer / weights',
  };
}

function fileCategory(path: string) {
  const lower = path.toLowerCase();
  if (lower.includes('tokenizer') || lower.endsWith('vocab.json') || lower.endsWith('merges.txt')) return 'Tokenizer';
  if (lower.endsWith('.safetensors') || lower.endsWith('.bin') || lower.endsWith('.pt')) return '权重';
  if (lower.endsWith('.json') || lower.endsWith('.jinja') || lower.endsWith('.yaml') || lower.endsWith('.yml')) return '配置';
  return '其他';
}

function ErrorText({error}: {error: unknown}) {
  return error ? <Failure error={error} /> : null;
}

function dialogBackdropClose(event: MouseEvent<HTMLDialogElement>) {
  if (event.target === event.currentTarget) event.currentTarget.close();
}

export function Models({writable, workerUp}: {writable: boolean; workerUp: boolean}) {
  const [rows, setRows] = useState<Row[]>([]);
  const [limits, setLimits] = useState<Limits | null>(null);
  const [selected, setSelected] = useState<Version | null>(null);
  const [adapters, setAdapters] = useState<AdapterVersion[]>([]);
  const [adapterLoading, setAdapterLoading] = useState(true);
  const [adapterError, setAdapterError] = useState('');
  const [adapterRevision, setAdapterRevision] = useState(0);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<ModelFilter>('all');
  const [detailTab, setDetailTab] = useState<DetailTab>('overview');
  const [sourceKind, setSourceKind] = useState<SourceKind>('modelscope');
  const [name, setName] = useState('');
  const [directoryName, setDirectoryName] = useState('');
  const [repository, setRepository] = useState('');
  const [revision, setRevision] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [listLoaded, setListLoaded] = useState(false);
  const [listFailed, setListFailed] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [message, setMessage] = useState('');
  const [transfer, setTransfer] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [cleanup, setCleanup] = useState<{version_id: string; state: string; details?: unknown} | null>(null);
  const selectedId = useRef<string | null>(null);
  const selection = useRef(0);
  const uploadController = useRef<AbortController | null>(null);
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const tabRefs = useRef<Record<DetailTab, HTMLButtonElement | null>>({overview: null, files: null, lineage: null});

  const groups = useMemo(() => groupModelRows(rows), [rows]);
  const filteredGroups = useMemo(() => filterModelGroups(groups, query, filter), [groups, query, filter]);
  const selectedGroup = useMemo(
    () => selected ? groups.find((group) => group.id === selected.model_id) ?? null : null,
    [groups, selected],
  );
  const metrics = useMemo(() => {
    const available = rows.filter((row) => row.state === 'available').length;
    const verified = rows.filter((row) => row.compatibility_state === 'verified').length;
    const pending = rows.filter((row) => ['uploading', 'queued', 'running', 'pending', 'awaiting_verification', 'cancelled', 'deleting'].includes(row.state)).length;
    const errors = rows.filter((row) => ['failed', 'upload_failed', 'delete_failed', 'mismatch'].includes(row.state)).length;
    return {families: groups.length, versions: rows.length, available, verified, pending, errors};
  }, [groups.length, rows]);

  const load = useCallback(async () => {
    setLoading(true);
    setListFailed(false);
    try {
      const [items, config] = await Promise.all([
        api<Row[]>('/models'),
        api<Limits>('/models/limits'),
      ]);
      setRows(items);
      setLimits(config);
      setListLoaded(true);
    } catch (loadError) {
      setListFailed(true);
      throw loadError;
    } finally {
      setLoading(false);
    }
  }, []);

  const readVersion = useCallback(async (id: string) => {
    const row = await api<Version>('/model-versions/' + id);
    setRows((items) => mergeVersionRow(items, row));
    if (selectedId.current === id) setSelected(row);
    return row;
  }, []);

  const choose = useCallback(async (id: string) => {
    const serial = ++selection.current;
    selectedId.current = id;
    setSelected(null);
    setConfirmDelete(false);
    try {
      const row = await api<Version>('/model-versions/' + id);
      setRows((items) => mergeVersionRow(items, row));
      if (serial === selection.current) setSelected(row);
    } catch (chooseError) {
      if (serial === selection.current) {
        selectedId.current = null;
        setError(chooseError);
      }
    }
  }, []);

  useEffect(() => {
    void load().catch(setError);
    return () => {
      selection.current++;
      selectedId.current = null;
      uploadController.current?.abort();
    };
  }, [load]);

  useEffect(() => {
    if (!listLoaded || selected) return;
    const currentId = selectedId.current;
    if (currentId && rows.some((row) => row.id === currentId)) return;
    const candidate = filteredGroups[0]?.latest ?? groups[0]?.latest;
    if (candidate) void choose(candidate.id);
  }, [choose, filteredGroups, groups, listLoaded, rows, selected]);

  useEffect(() => {
    let cancelled = false;
    let timer = 0;
    let request: AbortController | null = null;

    async function poll() {
      request = new AbortController();
      if (!cancelled) setAdapterLoading(true);
      try {
        const current = await listAdapters(request.signal);
        if (!cancelled) {
          setAdapters(current);
          setAdapterError('');
        }
      } catch (pollError) {
        if (!cancelled && !(pollError instanceof DOMException && pollError.name === 'AbortError')) {
          setAdapterError(pollError instanceof Error ? pollError.message : String(pollError));
        }
      } finally {
        if (!cancelled) {
          setAdapterLoading(false);
          timer = window.setTimeout(() => void poll(), 5000);
        }
      }
    }

    void poll();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      request?.abort();
    };
  }, [adapterRevision]);

  useEffect(() => {
    const polling = !!selected && (
      ['uploading', 'queued', 'running', 'deleting'].includes(selected.state)
      || !!selected.import && ['queued', 'running'].includes(selected.import.state)
    );
    if (!polling) return;
    let stopped = false;
    let pending = false;
    const timer = window.setInterval(() => {
      if (pending || !selected) return;
      pending = true;
      void readVersion(selected.id)
        .then(() => {
          if (!stopped) setError(null);
        })
        .catch((pollError) => {
          if (!stopped) setError(pollError);
        })
        .finally(() => {
          pending = false;
        });
    }, 2500);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [readVersion, selected?.id, selected?.import?.state, selected?.state]);

  async function act(operation: () => Promise<void>) {
    if (busy) return false;
    setBusy(true);
    setError(null);
    setMessage('');
    try {
      await operation();
      return true;
    } catch (operationError) {
      if (operationError instanceof DOMException && operationError.name === 'AbortError') {
        setMessage('本次传输已停止。请刷新版本状态，再选择相同目录恢复；已校验文件可复用。');
      } else {
        setError(operationError);
      }
      return false;
    } finally {
      setBusy(false);
      setTransfer('');
      uploadController.current = null;
    }
  }

  function openSourceDialog(source: SourceKind = 'modelscope') {
    setSourceKind(source);
    if (!dialogRef.current?.open) dialogRef.current?.showModal();
    window.setTimeout(() => dialogRef.current?.querySelector<HTMLElement>('[data-dialog-autofocus]')?.focus(), 0);
  }

  function closeSourceDialog() {
    dialogRef.current?.close();
  }

  async function importPublic(event: FormEvent) {
    event.preventDefault();
    const completed = await act(async () => {
      const row = await api<Version>('/models/modelscope-imports', json('POST', {
        name: name.trim(),
        repository: repository.trim(),
        revision: revision || null,
      }));
      await load();
      await choose(row.id);
      setMessage('已固定来源快照，Worker 将按该 commit 下载。');
    });
    if (completed) closeSourceDialog();
  }

  async function uploadDirectory(resumeId?: string) {
    const completed = await act(async () => {
      if (!limits) throw new Error('容量配置尚未读取，请刷新。');
      const request = new AbortController();
      uploadController.current = request;
      await uploadModelDirectory({
        files,
        name: directoryName.trim(),
        resumeId,
        limits,
        signal: request.signal,
        onProgress: setTransfer,
        onVersion: (row) => {
          setRows((items) => mergeVersionRow(items, row, directoryName.trim()));
          selectedId.current = row.id;
          selection.current++;
          setConfirmDelete(false);
          setSelected(row);
        },
      });
      await load();
      setMessage('模型文件已全部回读校验。兼容性尚未验证，不能据此开始训练。');
    });
    if (completed) closeSourceDialog();
  }

  async function submitDirectory(event: FormEvent) {
    event.preventDefault();
    await uploadDirectory();
  }

  async function resumeSelectedDirectory() {
    if (!selected) return;
    if (!files.length) {
      setMessage('请重新选择同一模型目录；平台会按相对路径和 SHA-256 复用已校验文件。');
      openSourceDialog('directory');
      return;
    }
    await uploadDirectory(selected.id);
  }

  async function refreshAll() {
    await act(async () => {
      await load();
      if (selected) await readVersion(selected.id);
      setAdapterRevision((value) => value + 1);
      setMessage('模型、版本详情和训练产物状态已刷新。');
    });
  }

  function selectGroup(group: ModelGroup) {
    setDetailTab('overview');
    if (selected?.model_id === group.id) return;
    void choose(group.latest.id);
  }

  function selectVersion(id: string) {
    setDetailTab('overview');
    void choose(id);
  }

  function setTab(tab: DetailTab, focus = false) {
    setDetailTab(tab);
    if (focus) window.requestAnimationFrame(() => tabRefs.current[tab]?.focus());
  }

  function tabKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next = index;
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    else return;
    event.preventDefault();
    setTab(tabs[next].id, true);
  }

  async function retryImport() {
    if (!selected) return;
    await act(async () => {
      await api('/model-versions/' + selected.id + '/retry-import', {method: 'POST'});
      await readVersion(selected.id);
      await load();
      setMessage('已按原固定快照重新提交导入。');
    });
  }

  async function cancelImport() {
    if (!selected) return;
    await act(async () => {
      await api('/model-versions/' + selected.id + '/cancel', {method: 'POST'});
      await readVersion(selected.id);
      await load();
      setMessage('已请求取消；Worker 确认停止前，状态仍可能显示为运行中。');
    });
  }

  async function deleteSelected() {
    if (!selected) return;
    const removing = selected;
    await act(async () => {
      const result = await api<{storage_cleanup?: string}|undefined>(
        '/model-versions/' + removing.id,
        {method: 'DELETE'},
      );
      if (result?.storage_cleanup === 'pending') {
        setCleanup({version_id: removing.id, state: 'pending'});
      }
      selection.current++;
      selectedId.current = null;
      setSelected(null);
      setConfirmDelete(false);
      await load();
      setMessage(
        result?.storage_cleanup === 'pending'
          ? '版本已移除，存储清理仍待完成。'
          : removing.external
            ? '外部基座登记已删除，优云公共文件保留。'
            : '版本与托管文件已删除。',
      );
    });
  }

  function currentPrimaryAction(extraClass = '') {
    if (!selected) return null;
    const className = `model-button primary ${extraClass}`.trim();
    if (selected.import && ['queued', 'running'].includes(selected.import.state)) {
      return <button type="button" className={className} disabled={busy || !writable || selected.import.cancel_requested} onClick={() => void cancelImport()}>{selected.import.cancel_requested ? '等待取消确认' : '请求取消导入'}</button>;
    }
    if (selected.source_kind === 'directory' && ['uploading', 'cancelled'].includes(selected.state)) {
      return <button type="button" className={className} disabled={busy || !writable} onClick={() => void resumeSelectedDirectory()}>继续上传目录</button>;
    }
    if (selected.import && ['failed', 'cancelled'].includes(selected.import.state)) {
      return <button type="button" className={className} disabled={busy || !writable || !workerUp} onClick={() => void retryImport()}>按固定快照重试</button>;
    }
    if (selected.state === 'available') {
      return <a className={className} href="#training">进入训练配置</a>;
    }
    if (selected.external) {
      return <button type="button" className={className} onClick={() => setTab('overview')}>查看实例核对要求</button>;
    }
    return <button type="button" className={className} disabled={busy} onClick={() => void act(async () => {await readVersion(selected.id); setMessage('当前版本状态已刷新。');})}>刷新当前状态</button>;
  }

  function renderRailCheck(label: string, value: string, tone: Tone) {
    return <div className="model-rail-check">
      <span className={`model-check-dot ${tone}`} aria-hidden="true">{tone === 'ok' ? '✓' : tone === 'bad' ? '!' : '·'}</span>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>;
  }

  function renderEvidenceSpine(version: Version) {
    const fileReady = version.state === 'available';
    const fingerprintReady = !!version.manifest_sha256;
    const compatibilityReady = version.compatibility_state === 'verified';
    const steps = [
      ['01', '来源固定', version.external ? '外部只读快照' : version.import ? 'commit 快照' : '目录清单', 'done'],
      ['02', '文件回读', `${version.files.length} 个文件`, fileReady ? 'done' : statusTone(version.state) === 'bad' ? 'failed' : 'active'],
      ['03', '指纹固化', fingerprintReady ? 'manifest 已生成' : '尚未固化', fingerprintReady ? 'done' : 'pending'],
      ['04', '运行兼容', compatibilityReady ? '兼容基线已绑定' : statusLabels[version.compatibility_state] ?? '未验证', compatibilityReady ? 'done' : 'pending'],
      ['05', '训练产物', version.references.length ? `${version.references.length} 个引用` : '当前无引用', version.references.length ? 'done' : 'pending'],
    ] as const;
    return <ol className="model-evidence-spine" aria-label="版本证据链">
      {steps.map(([number, label, detail, state]) => <li key={label} className={state}>
        <i aria-hidden="true">{state === 'done' ? '✓' : number}</i>
        <span>{label}</span>
        <small>{detail}</small>
      </li>)}
    </ol>;
  }

  function renderReferences(version: Version): ReactNode {
    return <section className="model-evidence-block model-references" aria-labelledby="model-reference-title">
      <div className="model-block-heading">
        <div><span>REFERENCE GUARD</span><h3 id="model-reference-title">引用与删除保护</h3></div>
        <ModelState value={version.references.length ? 'available' : 'unverified'} label={version.references.length ? `${version.references.length} 个引用` : '暂无引用'} tone={version.references.length ? 'ok' : 'neutral'}/>
      </div>
      {version.references.length ? <div className="model-reference-list">
        {version.references.map((reference) => <article key={reference.reference_type + reference.reference_id}>
          <strong>{reference.reference_type}</strong>
          <code>{reference.reference_id}</code>
        </article>)}
      </div> : <p className="model-muted">当前版本未被培训或推理记录引用。删除仍会先由服务端重新检查引用；删除失败时版本元数据会保留以便重试。</p>}
    </section>;
  }

  const selectedSource = selected ? sourceDetail(selected) : null;
  const fileSummary = selected ? selected.files.reduce<Record<string, number>>((summary, file) => {
    const category = fileCategory(file.path);
    summary[category] = (summary[category] ?? 0) + 1;
    return summary;
  }, {}) : {};
  const selectedImportActive = !!selected?.import && ['queued', 'running'].includes(selected.import.state);
  const deleteBlocked = !selected || selected.references.length > 0 || selectedImportActive;

  return <div className="model-studio-page">
    <div className="page-heading model-page-heading">
      <div>
        <span className="model-eyebrow">C · MODEL VALIDATION STUDIO</span>
        <h1>模型验证工作室</h1>
        <p>先确认当前模型和训练准入，再检查固定来源、文件指纹、实例核对与训练产物。</p>
      </div>
      <div className="model-heading-actions">
        <button type="button" className="model-button secondary" disabled={busy || loading} onClick={() => void refreshAll()}>刷新状态</button>
        <button type="button" className="model-button primary" disabled={busy || !writable} onClick={() => openSourceDialog('modelscope')}>＋ 添加模型</button>
      </div>
    </div>

    <div className="model-page-feedback">
      <ErrorText error={error}/>
      {message && <p role="status" className="success-message model-page-message">{message}</p>}
      {!writable && <p className="notice">存储依赖不可用或未知，写操作暂停；请恢复依赖后刷新。</p>}
      {!workerUp && <p className="model-boundary-note">Worker 不可用：ModelScope 后台导入暂停。目录上传和外部基座登记不依赖 Worker。</p>}
    </div>

    <section className="model-metrics" aria-label="模型整体统计">
      <article><span>模型族</span><strong>{metrics.families}</strong><small>按不可变 model_id 分组</small></article>
      <article><span>模型版本</span><strong>{metrics.versions}</strong><small>{metrics.available} 个版本可用</small></article>
      <article><span>兼容已验证</span><strong>{metrics.verified}</strong><small>训练准入仍由训练页复核</small></article>
      <article><span>待处理</span><strong>{metrics.pending}</strong><small>传输、排队或等待核对</small></article>
      <article className={metrics.errors ? 'has-alert' : ''}><span>异常</span><strong>{metrics.errors}</strong><small>{metrics.errors ? '需要人工处理' : '当前无异常'}</small></article>
      <article className="model-metrics-note"><i aria-hidden="true"/><div><strong>状态分层正常</strong><small>文件、兼容和实例核对独立记录</small></div></article>
    </section>

    {!listLoaded && <section className="model-studio-state" role="status"><strong>{listFailed ? '模型列表读取失败' : '正在读取模型验证工作台…'}</strong><p>{listFailed ? '点击“刷新状态”重试。' : '正在连接 PostgreSQL、MinIO 与模型 API。'}</p></section>}
    {listLoaded && !rows.length && <section className="model-studio-state"><strong>尚无模型</strong><p>可以导入公开 ModelScope 仓库、上传完整目录，或登记优云公共基座。</p><button type="button" className="model-button primary" disabled={!writable} onClick={() => openSourceDialog('modelscope')}>添加第一个模型</button></section>}
    {listLoaded && rows.length > 0 && <div className="model-studio-layout">
      <aside className="model-family-index" aria-label="模型族索引">
        <div className="model-index-heading">
          <div><h2>模型族</h2><span>{filteredGroups.length} / {groups.length} 组 · {rows.length} 个版本</span></div>
          <button type="button" className="model-icon-button" aria-label="添加模型" disabled={!writable} onClick={() => openSourceDialog('modelscope')}>＋</button>
        </div>
        <label className="model-search">
          <span aria-hidden="true">⌕</span>
          <span className="sr-only">搜索模型</span>
          <input type="search" value={query} placeholder="搜索名称、ID、版本 ID…" onChange={(event) => setQuery(event.target.value)}/>
        </label>
        <label className="model-filter">
          <span className="sr-only">筛选模型</span>
          <select value={filter} onChange={(event) => setFilter(event.target.value as ModelFilter)}>
            <option value="all">全部来源与状态</option>
            <option value="modelscope">ModelScope</option>
            <option value="directory">目录上传</option>
            <option value="ucloud_public">优云外部只读</option>
            <option value="pending">待处理</option>
            <option value="errors">仅看异常</option>
            <option value="verified">兼容已验证</option>
          </select>
        </label>
        <div className="model-family-list">
          {filteredGroups.length ? filteredGroups.map((group) => {
            const summary = summarizeModelGroup(group);
            const isSelected = selected?.model_id === group.id;
            return <button type="button" className={`model-family-item ${isSelected ? 'selected' : ''}`} key={group.id} aria-pressed={isSelected} onClick={() => selectGroup(group)}>
              <span className={`model-source-mark ${group.latest.source_kind}`}>{sourceMark(group.latest.source_kind)}</span>
              <span className="model-family-copy">
                <strong title={group.name}>{group.name}</strong>
                <small><code>{modelShortId(group.id)}</code> · {sourceLabel(group.latest.source_kind)} · {group.versions.length} 版本</small>
              </span>
              <span className="model-family-status"><ModelState value={summary.tone} label={summary.label} tone={summary.tone}/></span>
            </button>;
          }) : <div className="model-empty-result"><strong>没有匹配的模型</strong><p>调整搜索词或筛选条件后重试。</p><button type="button" className="model-text-button" onClick={() => {setQuery('');setFilter('all');}}>清除筛选</button></div>}
        </div>
      </aside>

      <section className="model-evidence-workbench" aria-label="当前模型证据工作台">
        {!selected && <div className="model-workbench-loading" role="status"><strong>正在读取当前模型版本…</strong><p>版本详情将从 <code>/model-versions/:id</code> 获取。</p></div>}
        {selected && <>
          <header className="model-workbench-head">
            <div className="model-workbench-title">
              <span>CURRENT EVIDENCE</span>
              <h2>{selectedGroup?.name ?? selected.name ?? selected.model_id}<b> · v{selected.version_number}</b></h2>
              <p><code>{modelShortId(selected.id)}</code> · {sourceLabel(selected.source_kind)} · {bytes(selected.total_bytes)}</p>
              <div className="model-workbench-status">
                <ModelState value={selected.state}/>
                <ModelState value={selected.compatibility_state}/>
                <span>{selected.format_summary?.model_type ?? '架构未记录'}</span>
              </div>
            </div>
            <div className="model-version-picker-wrap">
              <div className="model-version-picker" role="group" aria-label="切换模型版本">
                {selectedGroup?.versions.map((version) => <button type="button" key={version.id} className={version.id === selected.id ? 'active' : ''} aria-pressed={version.id === selected.id} onClick={() => selectVersion(version.id)}>
                  <span>v{version.version_number}</span>
                  <small>{statusLabels[version.state] ?? version.state}</small>
                </button>)}
              </div>
            </div>
            <div className="model-mobile-primary">{currentPrimaryAction('mobile-block')}</div>
          </header>

          {renderEvidenceSpine(selected)}

          <div className="model-workbench-tabs" role="tablist" aria-label="模型证据">
            {tabs.map((tab, index) => <button
              type="button"
              role="tab"
              id={`model-workbench-tab-${tab.id}`}
              key={tab.id}
              aria-selected={detailTab === tab.id}
              aria-controls={`model-workbench-panel-${tab.id}`}
              tabIndex={detailTab === tab.id ? 0 : -1}
              ref={(node) => {tabRefs.current[tab.id] = node;}}
              onClick={() => setTab(tab.id)}
              onKeyDown={(event) => tabKeyDown(event, index)}
            >{tab.label}{tab.id === 'files' ? <span>{selected.files.length}</span> : tab.id === 'lineage' ? <span>{selected.references.length || '—'}</span> : null}</button>)}
          </div>

          <div className="model-workbench-panel" id="model-workbench-panel-overview" role="tabpanel" aria-labelledby="model-workbench-tab-overview" tabIndex={0} hidden={detailTab !== 'overview'}>
            {selected.import && ['queued', 'running'].includes(selected.import.state) && <section className="model-import-progress">
              <div><strong>后台导入进行中</strong><ModelState value={selected.import.state}/></div>
              <p><code>{selected.import.current_path ?? '等待 Worker 领取任务'}</code><span>{bytes(selected.import.current_bytes)} 已传输</span></p>
              <p>Worker 会按固定 commit 继续导入；取消请求不会提前改写最终状态。</p>
            </section>}
            {selected.import?.error_code && <div className="model-inline-error" role="alert"><strong>{selected.import.error_code}</strong><p>{selected.import.error_message}</p></div>}
            <div className="model-overview-grid">
              <section className="model-evidence-block" aria-labelledby="model-identity-title">
                <div className="model-block-heading"><div><span>IMMUTABLE IDENTITY</span><h3 id="model-identity-title">不可变身份</h3></div><ModelState value={selected.state}/></div>
                <dl className="model-kv">
                  <dt>model_id</dt><dd><code>{selected.model_id}</code></dd>
                  <dt>版本</dt><dd>v{selected.version_number} · <code>{selected.id}</code></dd>
                  <dt>文件规模</dt><dd>{selected.files.length} 个文件 · {bytes(selected.total_bytes)}</dd>
                  <dt>已回读</dt><dd>{bytes(selected.verified_bytes)}</dd>
                  <dt>创建时间</dt><dd>{date(selected.created_at)}</dd>
                  {selected.updated_at && <><dt>最近更新</dt><dd>{date(selected.updated_at)}</dd></>}
                  {selected.bucket && <><dt>对象存储桶</dt><dd><code>{selected.bucket}</code></dd></>}
                </dl>
              </section>
              <section className="model-evidence-block" aria-labelledby="model-source-title">
                <div className="model-block-heading"><div><span>SOURCE SNAPSHOT</span><h3 id="model-source-title">来源快照</h3></div><ModelState value={selected.external ? selected.external.last_check_state : selected.import?.state ?? selected.state}/></div>
                <dl className="model-kv">
                  <dt>{selectedSource?.title}</dt><dd><strong>{selectedSource?.primary}</strong><code>{selectedSource?.secondary}</code></dd>
                  <dt>来源类型</dt><dd>{sourceLabel(selected.source_kind)}</dd>
                  {selected.import && <>
                    <dt>请求版本</dt><dd>{selected.import.source_snapshot.requested_revision || '默认分支'}</dd>
                    <dt>固定 commit</dt><dd><code>{selected.import.source_snapshot.revision}</code></dd>
                    <dt>解析引用</dt><dd>{selected.import.source_snapshot.resolved_ref || '直接指定 commit'}</dd>
                  </>}
                  {selected.external && <>
                    <dt>公共目录 / 地域</dt><dd>{selected.external.source_snapshot.path} · {selected.external.source_snapshot.region}</dd>
                    <dt>目录查询时间</dt><dd>{date(selected.external.source_snapshot.fetched_at)}</dd>
                    <dt>最近实例核对</dt><dd><ModelState value={selected.external.last_check_state}/>{selected.external.last_checked_at ? ` · ${date(selected.external.last_checked_at)}` : ''}{selected.external.last_instance_id ? <code>{selected.external.last_instance_id}</code> : null}</dd>
                    <dt>首次固化时间</dt><dd>{selected.external.pinned_at ? date(selected.external.pinned_at) : '尚未固化'}</dd>
                  </>}
                </dl>
                {selected.external?.last_error_code && <p className="model-inline-error">实例核对错误：{selected.external.last_error_code}</p>}
              </section>
            </div>
            <section className="model-evidence-block model-file-summary" aria-labelledby="model-file-summary-title">
              <div className="model-block-heading"><div><span>FILE COVERAGE</span><h3 id="model-file-summary-title">文件类别</h3></div><button type="button" className="model-text-button" onClick={() => setTab('files')}>查看全部 {selected.files.length} 项</button></div>
              <div className="model-category-grid">
                {['配置', 'Tokenizer', '权重', '其他'].map((category) => <article key={category}>
                  <span>{category === '配置' ? 'C' : category === 'Tokenizer' ? 'T' : category === '权重' ? 'W' : '·'}</span>
                  <div><strong>{category}</strong><small>{category === '配置' ? 'config / generation / template' : category === 'Tokenizer' ? 'tokenizer / vocab / merges' : category === '权重' ? 'safetensors / bin / pt' : 'README 与元数据'}</small></div>
                  <b>{fileSummary[category] ?? 0}</b>
                </article>)}
              </div>
            </section>
            <section className="model-fingerprint-band">
              <span>FIXED MANIFEST · SHA-256</span>
              <code>{selected.manifest_sha256 ?? '完整回读校验后才能固化'}</code>
            </section>
          </div>

          <div className="model-workbench-panel" id="model-workbench-panel-files" role="tabpanel" aria-labelledby="model-workbench-tab-files" tabIndex={0} hidden={detailTab !== 'files'}>
            <section className="model-evidence-block">
              <div className="model-block-heading"><div><span>VERIFIED FILES</span><h3>完整文件清单</h3></div><span className="model-muted">{bytes(selected.verified_bytes)} / {bytes(selected.total_bytes)}</span></div>
              {selected.files.length ? <div className="model-table-scroll">
                <table className="model-file-table">
                  <thead><tr><th>相对路径</th><th>类别</th><th>大小</th><th>回读状态</th><th>SHA-256</th></tr></thead>
                  <tbody>{selected.files.map((file) => <tr key={file.path}>
                    <td><code>{file.path}</code></td>
                    <td>{fileCategory(file.path)}</td>
                    <td>{bytes(file.size_bytes)}</td>
                    <td>{file.state ? <ModelState value={file.state}/> : <span className="model-muted">未记录</span>}</td>
                    <td><code>{file.sha256}</code></td>
                  </tr>)}</tbody>
                </table>
              </div> : <div className="model-empty-result"><strong>尚无文件清单</strong><p>外部目录只说明查询时路径存在；绑定实际实例并读取后才能固化文件。</p></div>}
            </section>
          </div>

          <div className="model-workbench-panel" id="model-workbench-panel-lineage" role="tabpanel" aria-labelledby="model-workbench-tab-lineage" tabIndex={0} hidden={detailTab !== 'lineage'}>
            <AdapterAssets rows={adapters} baseVersion={selectedGroup ? {...selected, name: selectedGroup.name} : selected} loading={adapterLoading} error={adapterError}/>
            {renderReferences(selected)}
          </div>
        </>}
      </section>

      {selected && <aside className="model-validation-rail" aria-label="验证与操作">
        <div className="model-rail-heading"><div><span>VERIFICATION</span><h2>验证与操作</h2></div><ModelState value={selected.compatibility_state}/></div>
        <div className="model-rail-checks">
          {renderRailCheck('文件回读', selected.state === 'available' ? `${selected.files.length} / ${selected.files.length}` : `${selected.files.length} 个已记录`, selected.state === 'available' ? 'ok' : statusTone(selected.state))}
          {renderRailCheck('Manifest', selected.manifest_sha256 ? '已固化' : '待固化', selected.manifest_sha256 ? 'ok' : 'warn')}
          {selected.external && renderRailCheck('实例核对', statusLabels[selected.external.last_check_state] ?? selected.external.last_check_state, statusTone(selected.external.last_check_state))}
          {renderRailCheck('运行兼容', selected.compatibility_state === 'verified' ? '已验证' : '未验证', selected.compatibility_state === 'verified' ? 'ok' : 'warn')}
          {renderRailCheck('引用保护', String(selected.references.length), selected.references.length ? 'ok' : 'neutral')}
        </div>
        <section className={`model-rail-callout ${statusTone(selected.state)}`}>
          <strong>{selected.state === 'available' ? '文件已可用' : statusLabels[selected.state] ?? selected.state}</strong>
          <p>{selected.compatibility_state === 'verified' ? '训练页仍会复核架构、内容指纹、参数、GPU、镜像和容量。' : selected.external ? '目录存在不等于可挂载、可训练或内容一致，必须在实际实例上核对。' : '文件可用与运行兼容是两个独立结果；未经兼容验证不能据此开始训练。'}</p>
        </section>
        <div className="model-rail-actions">
          <div className="model-rail-primary">{currentPrimaryAction('rail-block')}</div>
          <button type="button" className="model-button secondary" disabled={busy} onClick={() => void act(async () => {await readVersion(selected.id); setMessage('当前版本详情已刷新。');})}>刷新版本详情</button>
          {selected.import && ['failed', 'cancelled'].includes(selected.import.state) && <button type="button" className="model-button secondary" disabled={busy || !writable || !workerUp} onClick={() => void retryImport()}>按固定快照重试</button>}
        </div>
        <div className="model-danger-zone">
          <div><strong>危险操作</strong><p>{selected.references.length ? '版本被引用，服务端会拒绝删除。' : selectedImportActive ? '后台导入结束前不能删除。' : selected.external ? '仅删除平台登记，优云公共文件保留。' : '版本与托管文件将被删除。'}</p></div>
          <button type="button" className="model-button danger-secondary" disabled={busy || !writable || deleteBlocked} onClick={() => setConfirmDelete(true)}>删除模型版本</button>
          {confirmDelete && <div className="model-confirm" role="alert">
            <p>{selected.external ? '确认删除此平台登记？' : '确认删除此版本及托管文件？'}</p>
            <button type="button" className="model-button danger" disabled={busy || !writable} onClick={() => void deleteSelected()}>确认删除</button>
            <button type="button" className="model-button secondary" onClick={() => setConfirmDelete(false)}>保留版本</button>
          </div>}
        </div>
      </aside>}
    </div>}

    {cleanup && <section className="model-cleanup" aria-labelledby="model-cleanup-title">
      <div><span>STORAGE CLEANUP</span><h2 id="model-cleanup-title">存储清理：{cleanup.state}</h2><p>版本查询 404 不代表 MinIO 对象已清理。版本：<code>{cleanup.version_id}</code></p></div>
      <button type="button" className="model-button secondary" disabled={busy} onClick={() => void act(async () => {
        const result = await api<{state?: string}>('/model-versions/' + cleanup.version_id + '/storage-cleanup');
        setCleanup({...cleanup, state: result.state ?? '待核对', details: result});
      })}>核对清理状态</button>
      {cleanup.details != null && <pre>{JSON.stringify(cleanup.details, null, 2)}</pre>}
    </section>}

    <p className="model-studio-footnote"><span aria-hidden="true">◇</span>文件已校验只代表正式对象可读取；运行兼容必须绑定架构、内容指纹、参数、GPU、镜像和容量基线。</p>

    <dialog
      ref={dialogRef}
      className="model-source-dialog"
      aria-labelledby="model-source-dialog-title"
      onClick={dialogBackdropClose}
    >
      <header className="model-dialog-head">
        <div><span>ADD MODEL ASSET</span><h2 id="model-source-dialog-title">添加模型</h2><p>先选择来源。三种来源的生命周期和可追溯边界不同。</p></div>
        <button type="button" className="model-icon-button" aria-label="关闭添加模型" data-dialog-autofocus onClick={closeSourceDialog}>×</button>
      </header>
      <div className="model-dialog-body">
        <div className="model-source-choices" role="group" aria-label="模型来源">
          {([
            ['modelscope', '01', '下载公开模型', '固定 ModelScope commit，由 Worker 后台导入并回读校验。', '自动下载'],
            ['directory', '02', '上传完整目录', '复制 config、tokenizer 与权重到 ModelForge 正式存储。', '平台托管'],
            ['ucloud_public', '03', '登记优云公共基座', '只保存外部只读引用，不复制公共目录权重。', '外部引用'],
          ] as const).map(([value, code, title, description, tag]) => <button type="button" key={value} className={`model-source-choice ${sourceKind === value ? 'selected' : ''}`} aria-pressed={sourceKind === value} onClick={() => setSourceKind(value)}>
            <span>{code}</span><div><strong>{title}</strong><small>{description}</small><em>{tag}</em></div><i aria-hidden="true">{sourceKind === value ? '✓' : ''}</i>
          </button>)}
        </div>
        <div className="model-dialog-section-label"><span>配置来源</span><small>{sourceLabel(sourceKind)}</small></div>

        {sourceKind === 'modelscope' && <form className="model-dialog-form" onSubmit={importPublic}>
          <fieldset disabled={busy || !writable || !workerUp}>
            <div className="model-form-grid">
              <label>模型名称<input required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} placeholder="例如 Qwen3-0.6B"/></label>
              <label>ModelScope 仓库<input required pattern="[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+" value={repository} onChange={(event) => setRepository(event.target.value)} placeholder="owner/model"/></label>
              <label className="span-two">版本（可留空）<input maxLength={255} value={revision} onChange={(event) => setRevision(event.target.value)} placeholder="默认分支 / 分支名 / 完整 commit"/></label>
            </div>
            <div className="model-form-explainer"><span>01</span><p>提交时先固定 commit，再创建 Worker 导入作业。重试保持同一快照，不跟随分支移动。标签暂不支持。</p></div>
            <div className="model-dialog-actions"><button type="button" className="model-button secondary" onClick={closeSourceDialog}>取消</button><button type="submit" className="model-button primary" disabled={busy || !writable || !workerUp}>{busy ? '正在处理…' : '固定版本并创建导入'}</button></div>
          </fieldset>
        </form>}

        {sourceKind === 'directory' && <form className="model-dialog-form" onSubmit={submitDirectory}>
          <fieldset disabled={busy || !writable}>
            <div className="model-form-grid">
              <label>模型名称<input required maxLength={120} value={directoryName} onChange={(event) => setDirectoryName(event.target.value)} placeholder="例如 客服助手基础模型"/></label>
              <div className="model-form-label span-two"><span>选择完整模型目录</span><label className="model-file-drop">
                <input {...directoryAttributes} type="file" multiple onChange={(event) => setFiles(Array.from(event.target.files ?? []))}/>
                <span><strong>{files.length ? `已选择 ${files.length} 个文件` : '选择 config、tokenizer 与权重目录'}</strong><small>{files.length ? bytes(files.reduce((sum, file) => sum + file.size, 0)) + ' · 逐文件计算 SHA-256' : '保留相对路径，逐文件计算并回读 SHA-256'}</small></span>
              </label></div>
            </div>
            {limits && <p className="model-form-note">上限：{bytes(limits.file_limit_bytes)}/文件，{bytes(limits.total_limit_bytes)}/目录，{limits.file_count_limit} 个文件。{limits.locked ? '限额已锁定。' : '初始限额，尚未锁定。'}</p>}
            {transfer && <p className="model-form-note" role="status">{transfer}</p>}
            <div className="model-form-explainer"><span>02</span><p>先提交文件清单，再逐文件上传并回读校验。中断后重新选择相同目录，可复用已校验文件。</p></div>
            <div className="model-dialog-actions">
              {busy && uploadController.current && <button type="button" className="model-button secondary" onClick={() => uploadController.current?.abort()}>停止本次传输</button>}
              {selected?.source_kind === 'directory' && ['uploading', 'cancelled'].includes(selected.state) && <button type="button" className="model-button secondary" disabled={busy || !files.length} onClick={() => void uploadDirectory(selected.id)}>恢复所选版本</button>}
              <button type="button" className="model-button secondary" onClick={closeSourceDialog}>取消</button>
              <button type="submit" className="model-button primary" disabled={busy || !files.length || !directoryName.trim()}>{busy ? '正在计算并上传…' : '创建版本并上传'}</button>
            </div>
          </fieldset>
        </form>}

        {sourceKind === 'ucloud_public' && <ExternalBaseForm busy={busy} writable={writable} onRegister={async (baseName, region, path, directory) => {
          const completed = await act(async () => {
            const row = await registerExternalBase(baseName, region, path, directory);
            await load();
            await choose(row.id);
            setMessage('外部基座已登记，尚未核对实际实例文件，不能据此启动训练。');
          });
          if (completed) closeSourceDialog();
        }}/>}

        <div className="model-dialog-boundary"><span aria-hidden="true">◇</span><p>提交只创建待处理版本。文件可用、实例内容一致和运行兼容是三个独立结果。</p></div>
      </div>
    </dialog>
  </div>;
}
