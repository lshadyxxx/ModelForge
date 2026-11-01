import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { bytes, date, Detail, Empty, Failure, Badge } from '../../shared/assets';
import { api, ApiError } from '../../shared/http';

type Row = {dataset_id: string; version_id: string; name: string; version_number: number; state: string; size_bytes: number; sample_count: number; version_created_at: string};
type Version = {id: string; dataset_id: string; dataset_name: string; version_number: number; state: string; sha256: string; sample_count: number; size_bytes: number; validation_errors: {line: number; path: string; message: string}[]; preview: {line: number; messages: {role: string; content: string}[]}[]; split_sha256: string | null; split_ratio: number | null; split_seed: number | null; split: {train_count: number; validation_count: number; sample_count: number; requested_ratio: number; actual_ratio: number; seed: number} | null; references: {reference_type: string; reference_id: string}[]};
type Limits = {file_limit_bytes: number; sample_limit: number; line_limit_bytes: number; locked: boolean};

const labels: Record<string, string> = {draft: '待发布', published: '已发布', invalid: '校验不通过', pending: '待处理', upload_failed: '上传失败', deleting: '删除中', delete_failed: '删除失败'};
function State({value}: {value: string}) {return <Badge label={labels[value] ?? value} tone={value === 'published' ? 'ok' : ['invalid', 'upload_failed', 'delete_failed'].includes(value) ? 'bad' : 'neutral'}/>;}

export function Datasets({writable}: {writable: boolean}) {
  const [rows, setRows] = useState<Row[]>([]);
  const [limits, setLimits] = useState<Limits | null>(null);
  const [selected, setSelected] = useState<Version | null>(null);
  const [name, setName] = useState('');
  const [target, setTarget] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [listLoaded, setListLoaded] = useState(false);
  const [listFailed, setListFailed] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const generation = useRef(0);
  const picker = useRef<HTMLInputElement>(null);
  const load = useCallback(async () => {setLoading(true); setListFailed(false); try {const [items, config] = await Promise.all([api<Row[]>('/datasets'), api<Limits>('/datasets/limits')]); setRows(items); setLimits(config); setListLoaded(true);} catch (error) {setListFailed(true); throw error;} finally {setLoading(false);}}, []);
  useEffect(() => {void load().catch(setError); return () => {generation.current++;};}, [load]);
  async function choose(id: string) {const request = ++generation.current; setSelected(null); setConfirmDelete(false); try {const version = await api<Version>('/dataset-versions/' + id); if (request === generation.current) setSelected(version);} catch (e) {setError(e);}}
  async function act(operation: () => Promise<void>) {if (busy) return; setBusy(true); setError(null); setMessage(''); try {await operation();} catch (e) {setError(e);} finally {setBusy(false);}}
  async function upload(event: FormEvent) {event.preventDefault(); await act(async () => {
    if (!file) throw new Error('请选择 messages JSONL 文件。');
    if (!limits) throw new Error('容量配置尚未读取，请刷新。');
    if (file.size > limits.file_limit_bytes) throw new Error('文件超过服务端配置上限：' + bytes(limits.file_limit_bytes));
    let id: string | undefined;
    try {const row = await api<Version>(target ? '/datasets/' + target + '/versions' : '/datasets?name=' + encodeURIComponent(name.trim()), {method: 'POST', headers: {'Content-Type': 'application/x-ndjson'}, body: file}); id = row.id; setMessage('文件已存入 MinIO，校验结果来自服务端。'); setFile(null); if (picker.current) picker.current.value = '';}
    catch (e) {if (e instanceof ApiError && e.details && typeof e.details === 'object' && 'version_id' in e.details) id = String(e.details.version_id); throw e;}
    finally {await load(); if (id) await choose(id);}
  });}
  const versions = [...new Map(rows.map(row => [row.dataset_id, row.name])).entries()];
  return <>
    <div className="page-heading"><div><h1>数据集</h1><p>固定原始内容、校验与版本，再组织训练输入。</p></div><button className="secondary" disabled={loading || busy} onClick={() => void act(load)}>刷新列表</button></div>
    <Failure error={error}/>{message && <p className="success-message" role="status">{message}</p>}
    {!writable && <p className="notice">依赖状态不可用或未知，上传、发布和删除已暂停；恢复后可重试。</p>}
    <section className="panel asset-form"><h2>上传 messages JSONL</h2><p className="muted">每行一条对话，支持 system / user / assistant；原始文件持久保存到 MinIO。</p>
      <form onSubmit={upload}><fieldset disabled={busy || !writable || !limits}>
        <div className="form-grid"><label>上传目标<select value={target} onChange={event => setTarget(event.target.value)}><option value="">新建数据集</option>{versions.map(([id, label]) => <option key={id} value={id}>{label}（新增版本）</option>)}</select></label>
        {!target && <label>数据集名称<input required maxLength={120} value={name} onChange={event => setName(event.target.value)} placeholder="例如：客服问答"/></label>}
        <label>JSONL 文件<input ref={picker} type="file" accept=".jsonl,application/x-ndjson" required onChange={event => setFile(event.target.files?.[0] ?? null)}/></label></div>
        <p className="muted">{limits ? '当前上限：' + bytes(limits.file_limit_bytes) + ' / 文件，' + limits.sample_limit.toLocaleString() + ' 条有效样本，' + bytes(limits.line_limit_bytes) + ' / 行。' + (limits.locked ? '限额已锁定。' : '初始限额，尚未完成容量锁定。') : '正在读取服务端限额…'}</p>
        <button type="submit">{busy ? '正在处理…' : '上传并校验'}</button>
      </fieldset></form>
      <details><summary>查看单轮与多轮格式示例</summary><pre>{JSON.stringify({messages: [{role: 'user', content: '你好'}, {role: 'assistant', content: '你好，请问需要什么帮助？'}]}) + '\n' + JSON.stringify({messages: [{role: 'system', content: '你是一名助手'}, {role: 'user', content: '介绍一下 LoRA'}, {role: 'assistant', content: 'LoRA 是一种参数高效微调方法。'}, {role: 'user', content: '适合什么场景？'}, {role: 'assistant', content: '适合使用较少训练参数进行任务适配。'}]})}</pre></details>
    </section>
    <section className="panel asset-list"><div className="section-heading"><h2>数据集版本</h2><span className="muted">{loading ? '正在读取…' : listFailed ? (listLoaded ? rows.length + ' 个版本（上次成功读取，可能已过期）' : '未能读取版本') : rows.length + ' 个版本'}</span></div>
      {!listLoaded ? <p className="muted">{listFailed ? '列表读取失败，请点击刷新重试。' : '正在加载版本列表…'}</p> : !loading && !listFailed && !rows.length ? <Empty>尚无数据集。上传 JSONL 后，可查看校验、预览并发布版本。</Empty> : <div className="table-scroll"><table><thead><tr><th>名称 / 版本</th><th>状态</th><th>样本 / 大小</th><th>创建时间</th><th>操作</th></tr></thead><tbody>{rows.map(row => <tr key={row.version_id} aria-selected={selected?.id === row.version_id}><td>{row.name}<small>v{row.version_number}</small></td><td><State value={row.state}/></td><td>{row.sample_count.toLocaleString()} 条<small>{bytes(row.size_bytes)}</small></td><td>{date(row.version_created_at)}</td><td><button className="text-button" onClick={() => void choose(row.version_id)}>查看详情</button></td></tr>)}</tbody></table></div>}
    </section>
    {selected && <Detail><div className="section-heading"><h2>{selected.dataset_name} · v{selected.version_number}</h2><State value={selected.state}/></div>
      <dl className="metadata"><dt>版本 ID</dt><dd>{selected.id}</dd><dt>源文件 SHA-256</dt><dd>{selected.sha256}</dd><dt>验证集拆分</dt><dd>{selected.split ? '训练 ' + selected.split.train_count.toLocaleString() + ' 条 / 验证 ' + selected.split.validation_count.toLocaleString() + ' 条（共 ' + selected.split.sample_count.toLocaleString() + ' 条）；实际比例 ' + (selected.split.actual_ratio * 100).toLocaleString('zh-CN', {maximumFractionDigits: 6}) + '%，请求目标 ' + (selected.split.requested_ratio * 100).toLocaleString('zh-CN', {maximumFractionDigits: 6}) + '%，seed ' + selected.split.seed : selected.split_sha256 ? '拆分已保存，计数暂未读取，请刷新详情。' : '尚未创建'}</dd></dl>
      <div className="actions"><button className="secondary" disabled={busy || !writable || !['draft','published'].includes(selected.state)} onClick={() => void act(async () => {await api('/dataset-versions/' + selected.id + '/split', {method: 'POST'}); await choose(selected.id); setMessage('服务端拆分已保存；重复请求复用相同清单。');})}>保存 10% 验证集拆分</button>
      <button disabled={busy || !writable || selected.state !== 'draft'} onClick={() => void act(async () => {await api('/dataset-versions/' + selected.id + '/publish', {method: 'POST'}); await load(); await choose(selected.id); setMessage('不可变版本已发布。');})}>发布版本</button>
      {['draft','invalid','published'].includes(selected.state) && <a className="button-link secondary" href={'/api/v1/dataset-versions/' + selected.id + '/content'} download={selected.dataset_name + '-v' + selected.version_number + '.jsonl'}>下载原始文件</a>}
      <button className="danger secondary" disabled={busy || !writable || selected.references.length > 0} onClick={() => setConfirmDelete(true)}>删除版本</button></div>
      {confirmDelete && <div className="confirm-bar" role="alert"><p>删除当前版本和正式存储对象？此操作不可恢复。</p><button className="danger" disabled={busy || !writable} onClick={() => void act(async () => {await api('/dataset-versions/' + selected.id, {method: 'DELETE'}); generation.current++; setSelected(null); setConfirmDelete(false); await load(); setMessage('版本及对象已删除。');})}>确认删除</button><button className="secondary" onClick={() => setConfirmDelete(false)}>保留版本</button></div>}
      {selected.references.length > 0 && <div className="inline-note">该版本被引用，不能删除。<pre>{JSON.stringify(selected.references, null, 2)}</pre></div>}
      {selected.validation_errors.length > 0 && <div className="detail-body"><h3>按行校验错误</h3><ul className="error-list">{selected.validation_errors.map((item, index) => <li key={index}>第 {item.line} 行 · {item.path}：{item.message}</li>)}</ul></div>}
      <div className="detail-body"><h3>样本预览</h3>{selected.preview.length ? selected.preview.map((sample, index) => <details key={index} open={index === 0}><summary>第 {sample.line} 行 · {sample.messages.length} 条消息</summary>{sample.messages.map((entry, item) => <div className="message-preview" key={item}><strong>{entry.role}</strong><p>{entry.content}</p></div>)}</details>) : <p className="muted">没有可预览的有效样本。</p>}</div>
    </Detail>}
  </>;
}
