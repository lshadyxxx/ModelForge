import {AdapterAssets} from './AdapterAssets';
import { useCallback, useEffect, useRef, useState, type FormEvent, type InputHTMLAttributes } from 'react';
import { bytes, date, Detail, Empty, Failure, Badge } from '../../shared/assets';
import { api, json } from '../../shared/http';
import { mergeVersionRow, type Row, type Version, type Limits } from './api';
import { uploadModelDirectory } from './directory-upload';
import { ExternalBaseForm } from './ExternalBaseForm';
import { registerExternalBase } from './external-base';

const directoryAttributes = {webkitdirectory: '', directory: ''} as InputHTMLAttributes<HTMLInputElement>;

const labels: Record<string, string> = {awaiting_verification: '待实例核对', external_observed: '外部文件已观察', mismatch: '内容不一致', pending: '待处理', upload_failed: '上传失败', uploading: '传输中', available: '文件已校验', cancelled: '已取消', failed: '失败', queued: '排队中', running: '下载中', succeeded: '已完成', verified: '已回读校验', deleting: '删除中', delete_failed: '删除失败', unverified: '兼容性未验证'};
function State({value}: {value: string}) {return <Badge label={labels[value] ?? value} tone={['available', 'verified', 'succeeded'].includes(value) ? 'ok' : ['failed', 'upload_failed', 'delete_failed'].includes(value) ? 'bad' : 'neutral'}/>;}

export function Models({writable, workerUp}: {writable: boolean; workerUp: boolean}) {
  const [rows, setRows] = useState<Row[]>([]);
  const [limits, setLimits] = useState<Limits | null>(null);
  const [selected, setSelected] = useState<Version | null>(null);
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
  const controller = useRef<AbortController | null>(null);
  const load = useCallback(async () => {setLoading(true); setListFailed(false); try {const [items, config] = await Promise.all([api<Row[]>('/models'), api<Limits>('/models/limits')]); setRows(items); setLimits(config); setListLoaded(true);} catch (error) {setListFailed(true); throw error;} finally {setLoading(false);}}, []);
  const readVersion = useCallback(async (id: string) => {const row = await api<Version>('/model-versions/' + id); setRows(items => mergeVersionRow(items, row)); if (selectedId.current === id) setSelected(row); return row;}, []);
  async function choose(id: string) {const serial = ++selection.current; selectedId.current = id; setSelected(null); setConfirmDelete(false); try {const row = await api<Version>('/model-versions/' + id); if (serial === selection.current) setSelected(row);} catch(e) {setError(e);}}
  useEffect(() => {void load().catch(setError); return () => {controller.current?.abort(); selection.current++; selectedId.current = null;};}, [load]);
  useEffect(() => {if (!selected?.import || !['queued','running'].includes(selected.import.state)) return; let stopped=false; let pending=false; const timer=window.setInterval(() => {if(pending)return;pending=true;void readVersion(selected.id).then(()=>{if(!stopped)setError(null);}).catch(e=>{if(!stopped)setError(e);}).finally(()=>{pending=false;});},2000);return()=>{stopped=true;clearInterval(timer);};}, [selected?.id, selected?.import?.state, readVersion]);
  async function act(operation: () => Promise<void>) {if (busy) return; setBusy(true); setError(null); setMessage(''); try {await operation();} catch(e) {if(e instanceof DOMException && e.name==='AbortError') setMessage('本次传输已停止。请刷新版本状态，再选择相同目录恢复；已校验文件可复用。'); else setError(e);} finally {setBusy(false); setTransfer(''); controller.current=null;}}
  async function importPublic(event: FormEvent) {event.preventDefault(); await act(async () => {const row=await api<Version>('/models/modelscope-imports',json('POST',{name:name.trim(),repository:repository.trim(),revision:revision || null}));await load();await choose(row.id);setMessage('已固定来源快照，Worker 将按该 commit 下载。');});}
  async function uploadDirectory(resumeId?: string) {await act(async () => {
    if (!limits) throw new Error('容量配置尚未读取，请刷新。');
    const request = new AbortController();
    controller.current = request;
    await uploadModelDirectory({files, name: directoryName.trim(), resumeId, limits, signal: request.signal,
      onProgress: setTransfer,
      onVersion: row => {setRows(items => mergeVersionRow(items, row, directoryName.trim())); selectedId.current = row.id; selection.current++; setConfirmDelete(false); setSelected(row);},
    });
    await load();
    setMessage('模型文件已全部回读校验。兼容性尚未验证，不能据此开始训练。');
  });}
  const detailPath=selected ? '/model-versions/'+selected.id : '';
  return <>
    <div className="page-heading"><div><h1>模型</h1><p>管理正式模型文件与不可变来源；文件可用和训练兼容分别判断。</p></div><button className="secondary" disabled={busy || loading} onClick={() => void act(async()=>{await load();if(selected)await readVersion(selected.id);})}>刷新状态</button></div>
    <Failure error={error}/>{message && <p role="status" className="success-message">{message}</p>}
    {!writable && <p className="notice">存储依赖不可用或未知，写操作暂停；请恢复依赖后刷新。</p>}
    {!workerUp && <p className="inline-note">Worker 状态不可用或未知，后台下载暂停。目录上传不依赖 Worker。</p>}
    <ExternalBaseForm busy={busy} writable={writable} onRegister={(name,region,path,directory)=>act(async()=>{const row=await registerExternalBase(name,region,path,directory);await load();await choose(row.id);setMessage('外部基座已登记，尚未核对实际实例文件，不能据此启动训练。');})}/>
    <section className="panel asset-form"><h2>从 ModelScope 导入</h2><p className="muted">仅公开、无需登录的模型。默认分支或命名分支在提交时解析为固定 commit；重试不跟随分支移动。</p>
      <form onSubmit={importPublic}><fieldset disabled={busy || !writable || !workerUp}><div className="form-grid"><label>模型名称<input required maxLength={120} value={name} onChange={event=>setName(event.target.value)}/></label><label>仓库 ID<input required pattern="[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+" placeholder="owner/model" value={repository} onChange={event=>setRepository(event.target.value)}/></label><label>版本（可留空）<input maxLength={255} placeholder="默认分支 / 分支名 / 完整 commit" value={revision} onChange={event=>setRevision(event.target.value)}/></label></div><p className="muted">标签暂不支持；分支与标签同名时请使用 refs/heads/分支名。Hugging Face 暂缓。</p><button type="submit">{busy ? '正在处理…' : '固定版本并后台导入'}</button></fieldset></form>
    </section>
    <section className="panel asset-form"><h2>上传完整模型目录</h2><p className="muted">保留 config、tokenizer、权重与相对路径；逐文件计算摘要、传输并回读校验。单文件中断后重新上传。</p>
      <div className="form-grid"><label>上传模型名称<input maxLength={120} disabled={busy} value={directoryName} onChange={event=>setDirectoryName(event.target.value)}/></label><label>选择模型目录<input {...directoryAttributes} type="file" multiple disabled={busy} onChange={event=>setFiles(Array.from(event.target.files ?? []))}/></label></div>
      <p className="muted">{files.length ? '已选 '+files.length+' 个文件，共 '+bytes(files.reduce((sum,file)=>sum+file.size,0))+'。' : '请选择完整目录。'}{limits && ' 上限：'+bytes(limits.file_limit_bytes)+'/文件，'+bytes(limits.total_limit_bytes)+'/目录，'+limits.file_count_limit+' 个文件。'+(limits.locked?'限额已锁定。':'初始限额，尚未锁定。')}</p>
      <div className="actions"><button disabled={busy || !writable || !limits || !files.length || !directoryName.trim()} onClick={()=>void uploadDirectory()}>创建版本并上传</button>{selected?.source_kind==='directory' && ['uploading','cancelled'].includes(selected.state) && <button className="secondary" disabled={busy || !writable || !files.length} onClick={()=>void uploadDirectory(selected.id)}>恢复所选版本，复用已校验文件</button>}{busy && controller.current && <button className="secondary" onClick={()=>controller.current?.abort()}>停止本次传输</button>}</div>
      {transfer && <p role="status" className="transfer-message">{transfer}</p>}
    </section>
    <section className="panel asset-list"><div className="section-heading"><h2>模型版本</h2><span className="muted">{loading ? '正在读取…' : listFailed ? (listLoaded ? rows.length + ' 个版本（上次成功读取，可能已过期）' : '未能读取版本') : rows.length + ' 个版本'}</span></div>{!listLoaded ? <p className="muted">{listFailed ? '列表读取失败，请点击刷新重试。' : '正在加载版本列表…'}</p> : !loading && !listFailed && !rows.length ? <Empty>尚无模型。上传完整目录，或从 ModelScope 导入公开仓库。</Empty> : <div className="table-scroll"><table><thead><tr><th>名称 / 版本</th><th>来源</th><th>文件状态</th><th>兼容性</th><th>操作</th></tr></thead><tbody>{rows.map(row=><tr key={row.id}><td>{row.name}<small>v{row.version_number} · {date(row.created_at)}</small></td><td>{row.source_kind==='ucloud_public'?'优云外部只读':row.source_kind==='modelscope'?'ModelScope':'目录上传'}</td><td><State value={row.state}/></td><td><State value={row.compatibility_state}/></td><td><button className="text-button" disabled={busy} onClick={()=>void choose(row.id)}>查看详情</button></td></tr>)}</tbody></table></div>}</section>
    {selected && <Detail><div className="section-heading"><h2>模型版本 v{selected.version_number}</h2><State value={selected.state}/></div><dl className="metadata"><dt>版本 ID</dt><dd>{selected.id}</dd><dt>文件清单摘要</dt><dd>{selected.manifest_sha256 ?? '待实际实例完整核对后固化'}</dd><dt>{selected.external ? '外部已观察文件' : '服务端已验证'}</dt><dd>{selected.external ? bytes(selected.total_bytes)+' · 无 MinIO 副本' : bytes(selected.verified_bytes)+' / '+bytes(selected.total_bytes)} · 兼容性未验证</dd>{selected.external && <><dt>公共目录 / 地域</dt><dd>{selected.external.source_snapshot.path} · {selected.external.source_snapshot.region}</dd><dt>目录查询时间</dt><dd>{date(selected.external.source_snapshot.fetched_at)}</dd><dt>最近实例核对</dt><dd><State value={selected.external.last_check_state}/>{selected.external.last_checked_at && ' · '+date(selected.external.last_checked_at)}{selected.external.last_instance_id && ' · '+selected.external.last_instance_id}</dd><dt>首次固化时间</dt><dd>{selected.external.pinned_at ? date(selected.external.pinned_at) : '尚未固化'}</dd>{selected.external.last_error_code && <><dt>核对错误</dt><dd>{selected.external.last_error_code}</dd></>}</>}{selected.import && <><dt>原始仓库 / 请求版本</dt><dd>{selected.import.source_snapshot.repository} · {selected.import.source_snapshot.requested_revision === undefined ? '原请求版本未记录' : selected.import.source_snapshot.requested_revision || '默认分支'}</dd><dt>固定 commit</dt><dd>{selected.import.source_snapshot.revision}</dd><dt>解析引用</dt><dd>{selected.import.source_snapshot.resolved_ref || '直接指定 commit'}</dd><dt>后台导入</dt><dd><State value={selected.import.state}/>{selected.import.cancel_requested && ' · 已请求取消，等待 Worker 确认停止'}{selected.import.current_path && <p>{selected.import.current_path} · 当前下载 {bytes(selected.import.current_bytes)}</p>}</dd></>}</dl>
      {selected.import?.error_code && <div className="notice">{selected.import.error_code}：{selected.import.error_message}</div>}
      <div className="actions"><button className="secondary" disabled={busy} onClick={()=>void act(async()=>{await readVersion(selected.id);})}>刷新版本详情</button>{selected.import && ['failed','cancelled'].includes(selected.import.state) && <button disabled={busy || !writable || !workerUp} onClick={()=>void act(async()=>{await api(detailPath+'/retry-import',{method:'POST'});await readVersion(selected.id);await load();})}>按固定快照重试</button>}
      {selected.state==='uploading' && <button className="secondary" disabled={busy || !writable || selected.import?.cancel_requested} onClick={()=>void act(async()=>{await api(detailPath+'/cancel',{method:'POST'});await readVersion(selected.id);await load();})}>请求取消导入</button>}
      <button className="secondary danger" disabled={busy || !writable || selected.references.length>0 || !!selected.import && ['queued','running'].includes(selected.import.state)} onClick={()=>setConfirmDelete(true)}>删除模型版本</button></div>
      {confirmDelete && <div className="confirm-bar" role="alert"><p>{selected.external ? '删除此平台登记？优云公共文件保留。被引用版本会由服务端拒绝。' : '删除此版本和托管文件？被引用或活动导入会由服务端拒绝。'}</p><button className="danger" disabled={busy || !writable} onClick={()=>void act(async()=>{const result=await api<{storage_cleanup?: string}|undefined>(detailPath,{method:'DELETE'});if(result?.storage_cleanup==='pending')setCleanup({version_id:selected.id,state:'pending'});setSelected(null);selectedId.current=null;setConfirmDelete(false);await load();setMessage(result?.storage_cleanup==='pending'?'版本已移除，存储清理仍待完成。':selected.external?'外部基座登记已删除，公共文件保留。':'版本与托管文件已删除。');})}>确认删除</button><button className="secondary" onClick={()=>setConfirmDelete(false)}>保留版本</button></div>}
      {selected.references.length>0 && <div className="inline-note">当前版本被引用，不能删除。<pre>{JSON.stringify(selected.references,null,2)}</pre></div>}
      <div className="table-scroll"><table><thead><tr><th>相对路径</th><th>大小</th><th>校验状态</th><th>SHA-256</th></tr></thead><tbody>{selected.files.map(file=><tr key={file.path}><td>{file.path}</td><td>{bytes(file.size_bytes)}</td><td><State value={file.state ?? 'pending'}/></td><td><code>{file.sha256}</code></td></tr>)}</tbody></table></div>
    </Detail>}
    {cleanup && <section className="panel asset-form"><h2>存储清理：{cleanup.state}</h2><p className="muted">版本查询 404 不代表对象已清理。版本：{cleanup.version_id}</p><button className="secondary" onClick={()=>void act(async()=>{const result=await api<{state?: string}>('/model-versions/'+cleanup.version_id+'/storage-cleanup');setCleanup({...cleanup,state:result.state ?? '待核对',details:result});})}>核对清理状态</button>{cleanup.details != null && <pre>{JSON.stringify(cleanup.details,null,2)}</pre>}</section>}
    <p className="inline-note">训练与独立推理每次重新核对固定的基础模型指纹。Best / Final 的同步状态、指标和来源见下方；文件校验不代表运行兼容。</p>
    <AdapterAssets/>
  </>;
}
