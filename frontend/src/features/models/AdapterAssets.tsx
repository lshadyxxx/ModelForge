import {useEffect, useState} from 'react';
import {adapterDownloadUrl, latestAdapterPair, listAdapters, type AdapterVersion} from './adapters';
import {bytes, date} from '../../shared/assets';
import type {Version} from './api';

const packageFiles = ['manifest.json', 'adapter_config.json', 'adapter_model.safetensors'];

type Props = {
  rows?: AdapterVersion[];
  baseVersion?: Version | null;
  attemptId?: string;
  loading?: boolean;
  error?: string;
};

function roleLabel(role: string) {
  return role === 'best' ? 'BEST' : role === 'final' ? 'FINAL' : role.toUpperCase();
}

function pairMessage(row: AdapterVersion, baseVersion?: Version | null) {
  const expected = baseVersion?.manifest_sha256 ?? row.snapshot.base.fingerprint;
  const responseFingerprint = row.snapshot.base.fingerprint;
  const runtimeFingerprint = row.snapshot.compatibility?.model_fingerprint;
  if (!expected) return {ok: false, text: 'Adapter 记录中缺少可用于配对的内容指纹。'};
  if (baseVersion && row.snapshot.base.id !== baseVersion.id) {
    return {ok: false, text: 'Adapter 绑定的基座版本与当前模型版本不一致。'};
  }
  if (responseFingerprint !== expected) {
    return {ok: false, text: 'Adapter 响应中的基座指纹与当前基座不一致。'};
  }
  if (runtimeFingerprint && runtimeFingerprint !== expected) {
    return {ok: false, text: '训练兼容记录中的基座指纹与当前基座不一致。'};
  }
  return {
    ok: true,
    text: baseVersion
      ? '当前基座版本、基座指纹与训练兼容记录一致。'
      : 'Adapter 绑定的基座与本次 Attempt 的兼容记录一致；尚未与模型模块中的当前版本再次交叉核对。',
  };
}

function attemptPair(rows: AdapterVersion[], attemptId?: string): AdapterVersion[] {
  if (!attemptId) return [];
  const roles = new Map<string, AdapterVersion>();
  for (const row of rows.filter((item) => item.source_attempt_id === attemptId)) {
    if (!roles.has(row.role)) roles.set(row.role, row);
  }
  return ['best', 'final'].flatMap((role) => roles.get(role) ? [roles.get(role)!] : []);
}

export function AdapterAssets({
  rows,
  baseVersion = null,
  attemptId,
  loading = false,
  error = '',
}: Props) {
  const [loadedRows, setLoadedRows] = useState<AdapterVersion[]>([]);
  const [localLoading, setLocalLoading] = useState(rows === undefined);
  const [localError, setLocalError] = useState('');
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const sourceRows = rows ?? loadedRows;
  const pair = baseVersion ? latestAdapterPair(sourceRows, baseVersion.id) : attemptPair(sourceRows, attemptId);
  const checkKey = baseVersion?.id ?? (pair.map((row) => row.id).join(',') || attemptId || '');

  useEffect(() => setChecked({}), [checkKey]);

  useEffect(() => {
    if (rows !== undefined) {
      setLocalLoading(false);
      setLocalError('');
      return;
    }
    if (!attemptId) {
      setLoadedRows([]);
      setLocalLoading(false);
      return;
    }
    const request = new AbortController();
    setLocalLoading(true);
    setLocalError('');
    void listAdapters(request.signal, attemptId)
      .then(setLoadedRows)
      .catch((loadError) => {
        if (!request.signal.aborted) setLocalError(loadError instanceof Error ? loadError.message : String(loadError));
      })
      .finally(() => {
        if (!request.signal.aborted) setLocalLoading(false);
      });
    return () => request.abort();
  }, [attemptId, rows]);

  const busy = loading || localLoading;
  const message = error || localError;

  if (busy && !pair.length) {
    return <section className="model-adapter-section"><p className="model-muted" role="status">正在读取训练产物…</p></section>;
  }
  if (message && !pair.length) {
    return <section className="model-adapter-section"><p className="model-inline-error" role="alert">训练产物读取失败：{message}</p></section>;
  }
  if (!baseVersion && !attemptId) {
    return <section className="model-adapter-section"><div className="model-empty-result"><strong>请选择一个模型版本或训练 Attempt</strong><p>训练产物会绑定精确的基座版本与指纹。</p></div></section>;
  }
  if (!pair.length) {
    return <section className="model-adapter-section">
      <div className="model-adapter-intro">
        <span>TRAINING ARTIFACTS</span>
        <h3>尚无 Best / Final Adapter</h3>
        <p>训练成功、产物回传并核对 MinIO 对象后，才能在这里下载和用于推理试用。</p>
      </div>
    </section>;
  }

  return <section className="model-adapter-section" aria-label="Best 和 Final 训练产物">
    <div className="model-adapter-intro">
      <span>TRAINING ARTIFACTS</span>
      <h3>基座 → Attempt → Adapter</h3>
      <p>{baseVersion ? '只展示当前基座版本最新一次成功 Attempt 的 Best / Final 产物。' : '只展示当前训练 Attempt 的 Best / Final 产物。'}Adapter 是增量权重，不能独立启动。</p>
      <p>下载链接调用真实 Adapter 导出接口。配对按钮只核对当前 API 响应中的基座版本、基座指纹、Adapter 指纹与训练兼容记录，不会额外启动服务端推理。</p>
    </div>
    <div className="model-adapter-grid">
      {pair.map((row) => {
        const pairing = pairMessage(row, baseVersion);
        const baseName = baseVersion?.name ?? baseVersion?.model_id ?? row.snapshot.base.id;
        const baseLabel = baseVersion ? `${baseName} · v${baseVersion.version_number}` : baseName;
        const baseFingerprint = baseVersion?.manifest_sha256 ?? row.snapshot.base.fingerprint;
        return <article className={`model-adapter-card ${row.role}`} key={row.id}>
          <header>
            <div><span>{roleLabel(row.role)}</span><strong>{row.state === 'available' ? 'MinIO 已校验' : '同步中'}</strong></div>
            <span className={`model-badge ${row.state === 'available' ? 'ok' : 'warn'}`}>{row.state === 'available' ? '可用' : row.state}</span>
          </header>
          <h3>{row.role === 'best' ? `验证 Loss ${row.metrics.eval_loss?.toFixed(4) ?? '—'}` : `Step ${row.metrics.step ?? '—'} 完成`}</h3>
          <dl>
            <dt>Adapter 版本</dt><dd><code>{row.id}</code></dd>
            <dt>Adapter 指纹</dt><dd><code>{row.fingerprint}</code></dd>
            <dt>来源 Attempt</dt><dd><code>{row.source_attempt_id}</code></dd>
            <dt>数据集版本</dt><dd><code>{row.snapshot.dataset.id}</code><small>SHA-256 {row.snapshot.dataset.sha256}</small></dd>
            <dt>基座模型</dt><dd>{baseLabel}<code>{row.snapshot.base.id}</code></dd>
            <dt>基座指纹</dt><dd><code>{baseFingerprint || '尚未固化'}</code></dd>
            <dt>创建时间</dt><dd>{row.created_at ? date(row.created_at) : '—'}</dd>
          </dl>
          <div className={`model-pairing ${checked[row.id] ? pairing.ok ? 'ok' : 'bad' : 'pending'}`}>
            <strong>{checked[row.id] ? pairing.ok ? '配对校验通过' : '配对校验失败' : '配对结果待核对'}</strong>
            <span>{checked[row.id] ? pairing.text : '点击“校验基座与 Adapter 配对”，使用当前响应字段做本地一致性核对。'}</span>
          </div>
          <div className="model-package-files">
            <span>Adapter 包固定包含</span>
            <ul>{packageFiles.map((file) => <li key={file}><code>{file}</code></li>)}</ul>
          </div>
          <div className="model-artifact-actions">
            {row.state === 'available' && row.role === 'best' && <a className="model-button primary" href={adapterDownloadUrl(row.id)} download={`modelforge-best-${row.id.slice(0, 8)}.zip`} aria-label="下载 BEST Adapter 包">下载 BEST Adapter 包</a>}
            {row.state === 'available' && row.role === 'final' && <a className="model-button primary" href={adapterDownloadUrl(row.id)} download={`modelforge-final-${row.id.slice(0, 8)}.zip`} aria-label="下载 FINAL Adapter 包">下载 FINAL Adapter 包</a>}
            {row.state === 'available' && !['best', 'final'].includes(row.role) && <a className="model-button primary" href={adapterDownloadUrl(row.id)} download={`modelforge-${row.role}-${row.id.slice(0, 8)}.zip`} aria-label={`下载 ${roleLabel(row.role)} Adapter 包`}>下载 {roleLabel(row.role)} Adapter 包</a>}
            <button type="button" className="model-button secondary" aria-label={`校验 ${roleLabel(row.role)} Adapter 与基座配对`} onClick={() => setChecked((current) => ({...current, [row.id]: true}))}>校验基座与 Adapter 配对</button>
            <a className="model-button secondary" href="#serving" aria-label={`使用 ${roleLabel(row.role)} Adapter 进行推理试用`}>用于推理试用</a>
          </div>
          <details>
            <summary>查看完整指标与产物清单</summary>
            <dl>
              <dt>指标</dt><dd><pre>{JSON.stringify(row.metrics, null, 2)}</pre></dd>
              <dt>文件</dt><dd><pre>{JSON.stringify(row.manifest, null, 2)}</pre></dd>
            </dl>
            <p>已同步产物大小：{bytes(Number((row.manifest as Array<{size?: number}> | null)?.reduce((sum, file) => sum + (file.size ?? 0), 0) ?? 0))}</p>
          </details>
          <p className="model-contract">LoRA Adapter 不能独立启动。部署时必须加载基座 <strong>{baseName}</strong>，并使用与训练基线兼容的 PEFT 或 vLLM LoRA 运行时。</p>
        </article>;
      })}
    </div>
  </section>;
}
