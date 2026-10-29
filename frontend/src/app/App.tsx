import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchStatus, type PlatformStatus, type ComponentName } from '../shared/http';

const components: {id: ComponentName; label: string; description: string; mark: string}[] = [
  {id: 'api', label: 'API 服务', description: '控制面进程响应', mark: 'A'},
  {id: 'postgres', label: 'PostgreSQL', description: '真实数据库查询', mark: 'P'},
  {id: 'minio', label: 'MinIO', description: '已认证的存储桶检查', mark: 'M'},
  {id: 'worker', label: 'Worker', description: '独立进程 HTTP 探针', mark: 'W'},
];
function Icon({name}: {name: string}) {
  const paths: Record<string, string> = {overview: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z', data: 'M4 4h16v16H4z M8 8h8 M8 12h8 M8 16h5', model: 'M12 3l9 5-9 5-9-5z M3 12l9 5 9-5 M3 16l9 5 9-5', compute: 'M4 4h16v12H4z M8 20h8 M12 16v4', training: 'M4 18l6-6 4 3 6-10 M14 5h6v6', chat: 'M4 4h16v13H9l-5 4z M8 9h8 M8 13h5', next: 'M5 19L19 5 M6 5h13v13'};
  return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}
function time(value?: string) {return value ? new Date(value).toLocaleTimeString('zh-CN', {hour12: false}) : '尚未检查';}

export function App() {
  const [status, setStatus] = useState<PlatformStatus | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  const refresh = useCallback(async () => {
    if (controller.current) return;
    const request = new AbortController();
    controller.current = request;
    setBusy(true);
    const timer = window.setTimeout(() => request.abort(), 7000);
    try {
      const data = await fetchStatus(request.signal);
      if (mounted.current) {setStatus(data); setError('');}
    } catch {
      if (mounted.current) setError('无法获取实时状态。请检查 API 服务与本地连接，然后重试。');
    } finally {
      clearTimeout(timer);
      if (controller.current === request) controller.current = null;
      if (mounted.current) setBusy(false);
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5000);
    const focus = () => void refresh();
    window.addEventListener('focus', focus);
    return () => {mounted.current = false; clearInterval(timer); window.removeEventListener('focus', focus); controller.current?.abort(); controller.current = null;};
  }, [refresh]);
  const allUp = status && !error && Object.values(status.components).every(item => item.state === 'up');
  return <div className="app-shell">
    <a className="skip" href="#main">跳到工作台</a>
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark">M</span><span>ModelForge<small>模型微调工作台</small></span></div>
      <nav aria-label="主导航">
        <a href="#main" className="nav-item active" aria-current="page"><Icon name="overview" />工作台</a>
        {['数据集', '模型', '计算环境', '训练', '推理试用'].map((label, index) => <div key={label} className="nav-item future" aria-disabled="true"><Icon name={['data','model','compute','training','chat'][index]} />{label}<small>后续接入</small></div>)}
      </nav>
      <div className="sidebar-foot"><i />本地控制面<small>基础骨架 · 第一阶段</small></div>
    </aside>
    <div className="workspace">
      <header className="topbar"><span>个人工作空间 <b>/</b> 工作台</span><span className="environment">本机访问</span></header>
      <main id="main" tabIndex={-1}>
        <div className="page-heading"><div><h1>工作台</h1><p>先确认控制面与存储连接，再开始后续模型工作。</p></div><button onClick={() => void refresh()} disabled={busy}>{busy ? '检查中…' : '刷新状态'}</button></div>
        {error && <div className="notice error" role="alert"><strong>实时检查暂时中断</strong><p>{error}</p>{status && <small>下方保留上次结果，已过期；不表示服务当前可用。</small>}</div>}
        <section className="panel" aria-labelledby="status-title">
          <div className="section-heading"><div><h2 id="status-title">平台运行状态</h2><p>每 5 秒检查一次，结果来自实际服务。</p></div><span className={'badge ' + (error ? 'warn' : allUp ? 'ok' : status ? 'warn' : 'neutral')}>{error ? '状态未知' : allUp ? '连接正常' : status ? '需要关注' : '正在检查'}</span></div>
          <div className="status-grid">{components.map(component => {
            const item = status?.components[component.id];
            const state = error ? 'stale' : item?.state ?? 'unknown';
            return <article className="status-card" key={component.id}>
              <div className="card-top"><span className="service-mark" aria-hidden="true">{component.mark}</span><span className={'badge ' + (state === 'up' ? 'ok' : state === 'down' ? 'bad' : 'neutral')}>{state === 'up' ? '正常' : state === 'down' ? '不可用' : state === 'stale' ? '已过期' : '检查中'}</span></div>
              <h3>{component.label}</h3><p className="description">{component.description}</p>
              <p className="status-message">{state === 'stale' ? '等待重新连接，当前状态未知' : item?.message ?? '正在连接服务，请稍候'}</p>
              <div className="card-meta"><time dateTime={item?.checked_at}>{time(item?.checked_at)}</time>{item && <span>{item.duration_ms} ms</span>}</div>
            </article>;
          })}</div>
          <div className="readiness"><span className={'dot ' + (status?.ready && !error ? 'green' : 'amber')} /><strong>{error ? '依赖就绪状态未知' : status ? status.ready ? 'API 依赖已就绪' : 'API 依赖尚未就绪' : '正在检查依赖'}</strong><span>就绪检查包括 PostgreSQL 和 MinIO；Worker 存活单独呈现。</span></div>
        </section>
        <div className="lower-grid">
          <section className="panel scope"><div className="section-heading"><div><h2>当前交付范围</h2><p>基础设施先行，业务流程分批接入。</p></div><span className="badge neutral">阶段 01</span></div><ul className="scope-list"><li><div><strong>本地控制面</strong><p>Web、API 与独立 Worker，通过 Compose 启停。</p></div></li><li><div><strong>正式文件存储</strong><p>PostgreSQL 记录元数据，MinIO 保存文件内容。</p></div></li><li><div><strong>真实读写验证</strong><p>使用独立验证脚本完成上传、回读校验、删除与重启后核对。</p></div></li></ul></section>
          <section className="panel next"><div className="section-heading"><h2>接下来</h2></div><div className="next-symbol"><Icon name="next" /></div><h3>连接数据，再组织训练</h3><p>后续逐步接入数据集、模型资产、优云资源与训练任务。训练和推理入口将在对应功能验收后开放。</p><div className="note">当前状态检查不代表文件读写验收，也不代表 GPU 或训练环境已可用。</div></section>
        </div>
        <footer>ModelForge · 本地基础骨架<span>正式数据持久化至 docker-db/</span></footer>
      </main>
    </div>
  </div>;
}
