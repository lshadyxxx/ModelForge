import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import './compute-prototype.css';

type Scheme = 'a' | 'b' | 'c';
type Scenario = 'ready' | 'loading' | 'empty' | 'error' | 'missing';
type InstanceStatus = 'running' | 'creating' | 'stopped' | 'failed' | 'unavailable';
type Action = 'stop' | 'delete';
type Tab = 'instances' | 'catalog';
type IconName = 'grid' | 'server' | 'plus' | 'refresh' | 'chevron' | 'check' | 'pause' | 'trash' | 'alert' | 'clock' | 'wallet' | 'search' | 'close' | 'copy' | 'bolt' | 'shield' | 'sliders';

type Spec = {
  id: string;
  gpu: string;
  memory: string;
  cpu: string;
  ram: string;
  region: string;
  zone: string;
  image: string;
  price: number;
  stock: number;
  compatibility: string;
};

type Instance = {
  id: string;
  name: string;
  specId: string;
  status: InstanceStatus;
  relation: string;
  owner: string;
  cost: string;
  hourly: string;
  lease: string;
  health: string;
  note?: string;
  updated: string;
};

const SPECS: Spec[] = [
  {id: '4090-64-sh2', gpu: '4090', memory: '24 GB', cpu: '16 核', ram: '64 GB', region: '上海二B', zone: 'cn-sh2-02', image: 'Ubuntu-nvidia 22.04', price: 4.86, stock: 3, compatibility: '训练基线待绑定'},
  {id: '4090-94-sh2', gpu: '4090', memory: '24 GB', cpu: '16 核', ram: '94 GB', region: '上海二B', zone: 'cn-sh2-02', image: 'Ubuntu-nvidia 22.04', price: 5.12, stock: 1, compatibility: '训练基线已绑定'},
  {id: '4090-96-hb2', gpu: '4090', memory: '24 GB', cpu: '16 核', ram: '96 GB', region: '华北二A', zone: 'cn-bj2-03', image: 'Ubuntu 24.04', price: 4.98, stock: 2, compatibility: '兼容性未验证'},
  {id: '905090-64-sh2', gpu: '5090', memory: '32 GB', cpu: '16 核', ram: '94 GB', region: '上海二B', zone: 'cn-sh2-02', image: 'Ubuntu-nvidia 22.04', price: 7.2, stock: 2, compatibility: '兼容性未验证'},
  {id: '4090-48-94-sh2', gpu: '4090 48G', memory: '48 GB', cpu: '16 核', ram: '94 GB', region: '上海二B', zone: 'cn-sh2-02', image: 'Ubuntu-nvidia 22.04', price: 6.92, stock: 1, compatibility: '适用于大显存训练'},
  {id: 'cpu-32', gpu: 'CPU', memory: '无 GPU', cpu: '8 核', ram: '32 GB', region: '上海二B', zone: 'cn-sh2-02', image: 'Ubuntu 24.04', price: 0.85, stock: 4, compatibility: '仅 CPU 调试'},
];

const INITIAL_INSTANCES: Instance[] = [
  {id: 'uhost-mf-031', name: 'forge-train-qwen3-03', specId: '4090-94-sh2', status: 'running', relation: '训练 · Qwen3-0.6B · Attempt #A-031', owner: '个人工作空间', cost: '¥6.65', hourly: '¥5.12/时 · 示例', lease: '持有 · 1/1', health: '训练进程正常', updated: '1 小时 18 分'},
  {id: 'uhost-mf-038', name: 'forge-infer-4090-08', specId: '4090-48-94-sh2', status: 'creating', relation: '推理试用 · Best Adapter · #T-011', owner: '个人工作空间', cost: '¥4.71', hourly: '¥6.92/时 · 示例', lease: '准备绑定', health: '正在加载运行镜像', updated: '2 分钟'},
  {id: 'uhost-mf-027', name: 'eval-sandbox-07', specId: '4090-64-sh2', status: 'stopped', relation: '无关联任务', owner: '个人工作空间', cost: '¥3.21', hourly: '已停止计算', lease: '已释放', health: '系统盘仍可能计费', updated: '昨天 18:42'},
  {id: 'uhost-mf-022', name: 'baseline-retest-02', specId: '4090-64-sh2', status: 'failed', relation: '训练 · 启动检查失败 · #A-024', owner: '个人工作空间', cost: '¥0.84', hourly: '已停止计费', lease: '待核对', health: '启动失败', note: '进程退出码 137，需要核对显存与租约', updated: '今天 10:26'},
  {id: 'uhost-mf-019', name: 'infer-east-03', specId: 'cpu-32', status: 'unavailable', relation: '推理试用 · 已结束 · #T-011', owner: '个人工作空间', cost: '—', hourly: '报价不可用', lease: '不可确认', health: '供应商状态超时', note: '实例状态查询超时，不能自动视为空闲', updated: '今天 09:08'},
];

const STATUS: Record<InstanceStatus, {label: string; icon: IconName; tone: string}> = {
  running: {label: '运行中', icon: 'check', tone: 'ok'},
  creating: {label: '创建中', icon: 'clock', tone: 'info'},
  stopped: {label: '已停止', icon: 'pause', tone: 'neutral'},
  failed: {label: '失败', icon: 'alert', tone: 'danger'},
  unavailable: {label: '不可用', icon: 'shield', tone: 'warning'},
};

const SCHEMES: {id: Scheme; tag: string; title: string; subtitle: string}[] = [
  {id: 'a', tag: 'A / OPS', title: '算力调度台', subtitle: '实例优先 · 高密度扫描'},
  {id: 'b', tag: 'B+ / HYBRID', title: '算力交换台', subtitle: '市场 · 运维 · 向导'},
  {id: 'c', tag: 'C / RUNWAY', title: '运行轨道', subtitle: '创建引导 · 生命周期'},
];

function Glyph({name, size = 16}: {name: IconName; size?: number}) {
  const paths: Record<IconName, ReactNode> = {
    grid: <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>,
    server: <><rect x="3" y="4" width="18" height="6" rx="1"/><rect x="3" y="14" width="18" height="6" rx="1"/><path d="M7 7h.01M7 17h.01M11 7h6M11 17h6"/></>,
    plus: <path d="M12 5v14M5 12h14"/>,
    refresh: <><path d="M20 11a8 8 0 10-2.3 6"/><path d="M20 4v7h-7"/></>,
    chevron: <path d="M6 9l6 6 6-6"/>,
    check: <path d="M5 12l4 4L19 6"/>,
    pause: <><path d="M8 5v14M16 5v14"/></>,
    trash: <><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"/></>,
    alert: <><path d="M12 3l9 17H3z"/><path d="M12 9v5M12 17h.01"/></>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    wallet: <><path d="M3 6h16a2 2 0 012 2v11H5a2 2 0 01-2-2z"/><path d="M3 7V5a2 2 0 012-2h12v3M16 12h5"/></>,
    search: <><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></>,
    close: <path d="M6 6l12 12M18 6L6 18"/>,
    copy: <><rect x="8" y="8" width="12" height="12" rx="1"/><path d="M16 8V4H4v12h4"/></>,
    bolt: <path d="M13 2L4 14h7l-1 8 9-12h-7z"/>,
    shield: <><path d="M12 3l8 3v6c0 5-4 8-8 9-4-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-5"/></>,
    sliders: <><path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="2"/><circle cx="15" cy="17" r="2"/></>,
  };
  return <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

function money(value: number) {
  return '¥' + value.toFixed(2);
}

function schemeFromLocation(): Scheme {
  const value = new URLSearchParams(location.search).get('scheme');
  return value === 'a' || value === 'b' || value === 'c' ? value : 'b';
}

function StatusPill({status, compact = false}: {status: InstanceStatus; compact?: boolean}) {
  const meta = STATUS[status];
  return <span className={`cp-status cp-status-${meta.tone}${compact ? ' compact' : ''}`}><Glyph name={meta.icon} size={13}/><span>{meta.label}</span></span>;
}

function ScenarioControl({value, onChange}: {value: Scenario; onChange: (value: Scenario) => void}) {
  const options: [Scenario, string][] = [['ready', '正常'], ['loading', '加载'], ['empty', '空'], ['error', '错误'], ['missing', '缺真实数据']];
  return <div className="cp-scenario-control" role="group" aria-label="原型状态演练">{options.map(([id, label]) => <button type="button" key={id} aria-pressed={value === id} onClick={() => onChange(id)}>{label}</button>)}</div>;
}

function PreviewHeader({scheme, onScheme, scenario, onScenario, onRefresh}: {scheme: Scheme; onScheme: (scheme: Scheme) => void; scenario: Scenario; onScenario: (scenario: Scenario) => void; onRefresh: () => void}) {
  return <>
    <section className="cp-preview-header" aria-labelledby="cp-preview-title">
      <div className="cp-preview-copy">
        <span className="cp-kicker">COMPUTE ENVIRONMENT · SOURCE PROTOTYPE</span>
        <h1 id="cp-preview-title">计算环境 / 设计预览</h1>
        <p>直接运行在 ModelForge 源项目与真实应用外壳内。示例数据不写入数据库，也不连接云写接口。</p>
      </div>
      <div className="cp-preview-actions">
        <a className="cp-exit-link" href="./#compute">退出预览</a>
        <button type="button" className="cp-primary cp-refresh" onClick={onRefresh}><Glyph name="refresh"/>刷新示例</button>
      </div>
    </section>
    <section className="cp-preview-strip">
      <div className="cp-scheme-switch" role="tablist" aria-label="切换设计方向">
        {SCHEMES.map(item => <button type="button" key={item.id} role="tab" aria-selected={scheme === item.id} className={scheme === item.id ? 'active' : ''} onClick={() => onScheme(item.id)}><span>{item.tag}</span><strong>{item.title}</strong><small>{item.subtitle}</small></button>)}
      </div>
      <div className="cp-sample-boundary">
        <div><span className="cp-live-dot"/><strong>源项目原型 · 演示数据</strong></div>
        <p>价格、库存、实例与错误均为示例；真实目录当前为只读，不产生云资源或费用。</p>
        <ScenarioControl value={scenario} onChange={onScenario}/>
      </div>
    </section>
  </>;
}

function MetricStrip({instances, scheme}: {instances: Instance[]; scheme: Scheme}) {
  const count = (status: InstanceStatus) => instances.filter(item => item.status === status).length;
  if (scheme === 'b') {
    return <div className="cp-metrics cp-b-metrics">
      <article><span>可用配置</span><strong>{SPECS.filter(item => item.stock > 0).length}</strong><small>示例库存大于 0</small></article>
      <article><span>我的实例</span><strong>{instances.length}</strong><small>{count('running')} 运行 · {count('creating')} 创建中</small></article>
      <article><span>今日示例估算</span><strong>¥15.41</strong><small>非真实账单</small></article>
      <article className="ownership"><div><span>资源归属</span><strong>个人工作空间 · 1 个 GPU 租约</strong><small>训练与推理共用互斥边界</small></div><b>1 / 1</b></article>
    </div>;
  }
  return <div className="cp-metrics cp-a-metrics">
    <article><span>当前实例</span><strong>{instances.length}</strong><small>{count('running')} 运行 · {count('creating')} 创建中</small></article>
    <article className={count('failed') + count('unavailable') > 0 ? 'attention' : ''}><span>需要处理</span><strong>{count('failed') + count('unavailable')}</strong><small>失败或状态不可确认</small></article>
    <article><span>示例费用 / 今日</span><strong>¥15.41</strong><small>不代表真实账单</small></article>
    <article><span>目录新鲜度</span><strong>刚刚</strong><small>库存与价格需重新查询</small></article>
    <article className="quota"><span>GPU 租约</span><strong>1 / 1</strong><small>由训练 Attempt #A-031 持有</small></article>
  </div>;
}

type Filters = {gpu: string; cpu: string; image: string; region: string; price: string; stock: string};

function FilterFields({filters, setFilters}: {filters: Filters; setFilters: (value: Filters) => void}) {
  const update = (key: keyof Filters, value: string) => setFilters({...filters, [key]: value});
  return <div className="cp-filter-fields">
    <label>GPU / 硬件<select value={filters.gpu} onChange={event => update('gpu', event.target.value)}><option value="all">全部 GPU</option>{[...new Set(SPECS.map(item => item.gpu))].map(item => <option key={item}>{item}</option>)}</select></label>
    <label>CPU / 内存<select value={filters.cpu} onChange={event => update('cpu', event.target.value)}><option value="all">全部 CPU / 内存</option>{[...new Set(SPECS.map(item => `${item.cpu} / ${item.ram}`))].map(item => <option key={item}>{item}</option>)}</select></label>
    <label>地域<select value={filters.region} onChange={event => update('region', event.target.value)}><option value="all">全部地域</option>{[...new Set(SPECS.map(item => item.region))].map(item => <option key={item}>{item}</option>)}</select></label>
    <label>运行镜像<select value={filters.image} onChange={event => update('image', event.target.value)}><option value="all">全部镜像</option>{[...new Set(SPECS.map(item => item.image))].map(item => <option key={item}>{item}</option>)}</select></label>
    <label>价格（示例）<select value={filters.price} onChange={event => update('price', event.target.value)}><option value="all">全部价格</option><option value="low">¥5 以下</option><option value="mid">¥5–7</option><option value="high">¥7 以上</option></select></label>
    <label>库存状态<select value={filters.stock} onChange={event => update('stock', event.target.value)}><option value="all">全部库存</option><option value="available">有示例库存</option><option value="scarce">仅 1 台</option></select></label>
  </div>;
}

function applyFilters(items: Spec[], filters: Filters) {
  return items.filter(item => {
    if (filters.gpu !== 'all' && item.gpu !== filters.gpu) return false;
    if (filters.cpu !== 'all' && `${item.cpu} / ${item.ram}` !== filters.cpu) return false;
    if (filters.image !== 'all' && item.image !== filters.image) return false;
    if (filters.region !== 'all' && item.region !== filters.region) return false;
    if (filters.price === 'low' && item.price >= 5) return false;
    if (filters.price === 'mid' && (item.price < 5 || item.price > 7)) return false;
    if (filters.price === 'high' && item.price <= 7) return false;
    if (filters.stock === 'available' && item.stock < 1) return false;
    if (filters.stock === 'scarce' && item.stock !== 1) return false;
    return true;
  });
}

function SpecOption({spec, selected, onSelect}: {spec: Spec; selected: boolean; onSelect: () => void}) {
  return <button type="button" className={`cp-spec-card${selected ? ' selected' : ''}`} aria-pressed={selected} onClick={onSelect}>
    <span className="cp-spec-mark">GPU</span>
    <span className="cp-spec-main"><span><strong>{spec.gpu}</strong><small>{spec.memory} · {spec.cpu} · {spec.ram}</small></span><span><b>{money(spec.price)}</b><small>/时 · 示例</small></span></span>
    <span className="cp-spec-meta"><span>{spec.region} · {spec.image}</span><span className={spec.stock === 1 ? 'scarce' : ''}>{spec.stock === 1 ? '仅 1 台' : `示例库存 ${spec.stock}`}</span><span>{spec.compatibility}</span></span>
  </button>;
}

function SelectionPanel({spec, onCreate}: {spec: Spec; onCreate: () => void}) {
  return <aside className="cp-selection-panel">
    <div className="cp-panel-head"><span>当前选择</span><StatusPill status="running" compact/></div>
    <span className="cp-kicker">SELECTED · 示例配置</span>
    <h2>{spec.gpu} / {spec.ram}</h2>
    <p>{spec.memory} · {spec.cpu} · {spec.region}</p>
    <div className="cp-selected-price"><strong>{money(spec.price)}</strong><span>/时 · 示例</span></div>
    <dl><div><dt>运行镜像</dt><dd>{spec.image}</dd></div><div><dt>库存</dt><dd>{spec.stock} 台</dd></div><div><dt>兼容性</dt><dd>{spec.compatibility}</dd></div><div><dt>归属</dt><dd>个人工作空间</dd></div></dl>
    <div className="cp-note"><Glyph name="shield"/><span>目录可见、库存可用、兼容验证和实例运行分别判断。</span></div>
    <button type="button" className="cp-primary cp-wide" onClick={onCreate}><Glyph name="plus"/>新建计算环境</button>
    <p className="cp-microcopy">示例价 {money(spec.price)}/时。停止不等于删除，存储费用可能继续。</p>
  </aside>;
}

function InstanceTable({instances, onDetail, onAction, dense = false}: {instances: Instance[]; onDetail: (id: string) => void; onAction: (action: Action, id: string) => void; dense?: boolean}) {
  return <div className={`cp-instance-table${dense ? ' dense' : ''}`}>
    <div className="cp-instance-head"><span>实例与关联</span><span>规格 / 地域</span><span>示例费用</span><span>状态</span><span>操作</span></div>
    {instances.map(item => {
      const spec = SPECS.find(record => record.id === item.specId) ?? SPECS[0];
      return <article className="cp-instance-row" key={item.id}>
        <button type="button" className="cp-instance-name" onClick={() => onDetail(item.id)}><span className="cp-gpu-chip">{spec.gpu}</span><span><strong>{item.name}</strong><small>{item.relation} · {item.owner}</small></span></button>
        <div className="cp-instance-spec"><span>{spec.gpu} · {spec.memory}</span><small>{spec.cpu} / {spec.ram} · {spec.region}</small></div>
        <div className="cp-instance-cost"><span>{item.cost}</span><small>{item.hourly}</small></div>
        <div className="cp-instance-status"><StatusPill status={item.status}/><small>{item.health}</small></div>
        <div className="cp-row-actions"><button type="button" onClick={() => onDetail(item.id)}>详情</button>{item.status === 'running' && <button type="button" onClick={() => onAction('stop', item.id)}>停止</button>}{item.status !== 'unavailable' && <button type="button" className="danger-text" onClick={() => onAction('delete', item.id)}>删除</button>}</div>
      </article>;
    })}
  </div>;
}

function AView({instances, spec, setSpec, tab, setTab, filters, setFilters, statusFilter, setStatusFilter, onCreate, onDetail, onAction}: {
  instances: Instance[]; spec: Spec; setSpec: (id: string) => void; tab: Tab; setTab: (tab: Tab) => void; filters: Filters; setFilters: (filters: Filters) => void; statusFilter: string; setStatusFilter: (status: string) => void; onCreate: () => void; onDetail: (id: string) => void; onAction: (action: Action, id: string) => void;
}) {
  const list = statusFilter === 'all' ? instances : instances.filter(item => item.status === statusFilter);
  const specs = applyFilters(SPECS, filters);
  return <div className="cp-a">
    <div className="cp-variant-title"><div><span className="cp-kicker"><Glyph name="grid"/> COMPUTE OPERATIONS · 方案 A</span><h2>算力调度台</h2><p>先看实例、异常与租约，再进入配置选择。</p></div><button className="cp-primary" onClick={onCreate} type="button"><Glyph name="plus"/>新建环境</button></div>
    <MetricStrip instances={instances} scheme="a"/>
    <div className="cp-a-tabs" role="tablist" aria-label="计算环境视图"><button type="button" role="tab" aria-selected={tab === 'instances'} onClick={() => setTab('instances')}>实例控制台 <span>{instances.length}</span></button><button type="button" role="tab" aria-selected={tab === 'catalog'} onClick={() => setTab('catalog')}>配置目录 <span>{specs.length}</span></button><span>只读目录 · 写操作为示例</span></div>
    {tab === 'instances' ? <div className="cp-a-workbench">
      <aside className="cp-a-filter">
        <div className="cp-panel-head"><span>实例筛选</span><button type="button">重置</button></div>
        {(['all', 'running', 'creating', 'stopped', 'failed', 'unavailable'] as const).map(id => <button type="button" key={id} className={statusFilter === id ? 'active' : ''} onClick={() => setStatusFilter(id)}><span>{id === 'all' ? '全部实例' : STATUS[id].label}</span><b>{id === 'all' ? instances.length : instances.filter(item => item.status === id).length}</b></button>)}
        <span className="cp-filter-label">资源筛选</span>
        <FilterFields filters={filters} setFilters={setFilters}/>
      </aside>
      <section className="cp-a-list">
        <div className="cp-list-caption"><span>{list.length} 台实例 · 先定状态与归属</span><button type="button"><Glyph name="refresh"/>刷新</button></div>
        {list.length ? <InstanceTable instances={list} onDetail={onDetail} onAction={onAction} dense/> : <EmptyVariant onCreate={onCreate}/>}
        <div className="cp-event-strip"><span>最近状态事件</span><small>forge-infer-4090-08 正在加载运行镜像</small><time>12:52</time></div>
      </section>
      <SelectionPanel spec={spec} onCreate={onCreate}/>
    </div> : <div className="cp-a-catalog"><div className="cp-catalog-filter"><div className="cp-panel-head"><span>筛选可用配置</span><small>{specs.length} 个示例组合</small></div><FilterFields filters={filters} setFilters={setFilters}/></div><div className="cp-catalog-grid">{specs.map(item => <SpecOption key={item.id} spec={item} selected={item.id === spec.id} onSelect={() => setSpec(item.id)}/>)}</div></div>}
  </div>;
}

function BActiveRunway({item, onDetail, onAction}: {item: Instance; onDetail: (id: string) => void; onAction: (action: Action, id: string) => void}) {
  const spec = SPECS.find(record => record.id === item.specId) ?? SPECS[0];
  return <section className="cp-runway-card cp-b-runway-card" aria-labelledby="cp-b-active-title">
    <div className="cp-runway-top"><div><span className="cp-kicker">ACTIVE ENVIRONMENT · 示例</span><h2 id="cp-b-active-title">{item.name}</h2><p>{item.relation} · {spec.region}</p></div><StatusPill status={item.status}/></div>
    <div className="cp-route" aria-label="运行环境生命周期">
      <div className="done"><i><Glyph name="check" size={13}/></i><strong>资源确认</strong><small>库存已核验</small></div>
      <div className="done"><i><Glyph name="check" size={13}/></i><strong>实例创建</strong><small>已完成</small></div>
      <div className="done"><i><Glyph name="check" size={13}/></i><strong>运行时准备</strong><small>镜像已加载</small></div>
      <div className="current"><i>4</i><strong>健康探针</strong><small>{item.health}</small></div>
      <div><i>5</i><strong>就绪</strong><small>可处理任务</small></div>
    </div>
    <div className="cp-runway-facts">
      <div><span>GPU / 规格</span><strong>{spec.gpu} · {spec.memory}</strong></div>
      <div><span>CPU / 内存</span><strong>{spec.cpu} / {spec.ram}</strong></div>
      <div><span>GPU 租约</span><strong>{item.lease}</strong></div>
      <div><span>示例费用</span><strong>{item.cost} · {item.hourly}</strong></div>
    </div>
    <div className="cp-telemetry">
      <div><span>GPU 利用率</span><strong>72%</strong><i><b style={{width: '72%'}}/></i></div>
      <div><span>显存占用</span><strong>18 / 24 GB</strong><i><b style={{width: '75%'}}/></i></div>
      <div><span>最近心跳</span><strong>12 秒前</strong><small>示例探针正常</small></div>
    </div>
    <div className="cp-runway-actions"><button type="button" className="cp-secondary" onClick={() => onDetail(item.id)}><Glyph name="search"/>查看运行详情</button><button type="button" className="cp-secondary" onClick={() => onAction('stop', item.id)}><Glyph name="pause"/>停止环境</button></div>
  </section>;
}

function BExceptionQueue({instances, onDetail}: {instances: Instance[]; onDetail: (id: string) => void}) {
  const exceptions = instances.filter(item => item.status === 'failed' || item.status === 'unavailable');
  return <aside className="cp-b-exception-panel">
    <div className="cp-b-panel-title"><div><span className="cp-kicker">EXCEPTION QUEUE</span><h3>异常队列</h3></div><b>{exceptions.length}</b></div>
    <p>失败、状态不可确认和待核对租约优先于普通实例。</p>
    <div className="cp-b-exception-list">{exceptions.map(item => {
      const meta = STATUS[item.status];
      return <button type="button" key={item.id} onClick={() => onDetail(item.id)}>
        <span className={`cp-exception-icon ${meta.tone}`}><Glyph name={meta.icon}/></span>
        <span><strong>{item.name}</strong><small>{item.note ?? item.health}</small></span>
        <span className="cp-exception-action">处理</span>
      </button>;
    })}</div>
    {!exceptions.length && <div className="cp-all-clear"><Glyph name="check"/><span><strong>当前没有异常</strong><small>仍须定期核对租约和清理结果。</small></span></div>}
    <div className="cp-exception-boundary"><Glyph name="shield"/><span>不自动释放租约，不自动把失败实例当作空闲。</span></div>
  </aside>;
}

function BEventTimeline({instances}: {instances: Instance[]}) {
  const latest = instances.find(item => item.status === 'creating') ?? instances[0];
  return <aside className="cp-b-event-panel">
    <div className="cp-b-panel-title"><div><span className="cp-kicker">EVENT STREAM</span><h3>最近事件</h3></div><small>示例时间线</small></div>
    <div className="cp-event-list">
      <div><i className="info"/><span><strong>{latest?.name ?? '实例状态流'}</strong><small>{latest?.health ?? '等待实例事件'}</small></span><time>刚刚</time></div>
      <div><i className="danger"/><span><strong>baseline-retest-02 启动失败</strong><small>进程退出，GPU 租约保持待核对。</small></span><time>10:26</time></div>
      <div><i className="ok"/><span><strong>forge-train-qwen3-03 健康探针通过</strong><small>训练进程正常，租约 1 / 1。</small></span><time>11:42</time></div>
    </div>
    <button type="button" className="cp-secondary cp-wide"><Glyph name="refresh"/>刷新事件与租约</button>
  </aside>;
}

function BView({instances, spec, setSpec, tab, setTab, filters, setFilters, onCreate, onDetail, onAction}: {
  instances: Instance[]; spec: Spec; setSpec: (id: string) => void; tab: Tab; setTab: (tab: Tab) => void; filters: Filters; setFilters: (filters: Filters) => void; onCreate: () => void; onDetail: (id: string) => void; onAction: (action: Action, id: string) => void;
}) {
  const specs = applyFilters(SPECS, filters);
  const active = instances.find(item => item.status === 'running') ?? instances[0];
  const exceptions = instances.filter(item => item.status === 'failed' || item.status === 'unavailable');
  return <div className="cp-b">
    <div className="cp-b-hero"><div><span className="cp-kicker"><Glyph name="bolt"/> COMPUTE EXCHANGE · B+ 混合工作台</span><h2>把规格比较清楚，<em>再把实例管明白。</em></h2><p>保留资源市场与实例控制台的双区域结构，并把异常队列、事件时间线和新建向导收进同一操作链。</p></div><button className="cp-primary" onClick={onCreate} type="button"><Glyph name="plus"/>选择配置</button></div>
    <MetricStrip instances={instances} scheme="b"/>
    {exceptions.length > 0 && <div className="cp-b-attention-rail"><span className="cp-attention-icon"><Glyph name="alert"/></span><div><strong>{exceptions.length} 个环境需要处理</strong><small>{exceptions.map(item => item.name).join(' · ')}</small></div><button type="button" onClick={() => setTab('instances')}>进入异常队列<Glyph name="chevron"/></button></div>}
    <div className="cp-b-tabs" role="tablist" aria-label="资源市场或实例控制台"><button type="button" role="tab" aria-selected={tab === 'catalog'} onClick={() => setTab('catalog')}>资源市场</button><button type="button" role="tab" aria-selected={tab === 'instances'} onClick={() => setTab('instances')}>实例控制台 <span>{instances.length}</span>{exceptions.length > 0 && <i className="cp-tab-alert">{exceptions.length}</i>}</button><small>目录快照刚刚刷新 · 示例兼容待验证</small></div>
    {tab === 'catalog' ? <div className="cp-market-grid">
      <aside className="cp-market-filter"><div className="cp-panel-head"><span>筛选配置</span><button type="button">展开</button></div><FilterFields filters={filters} setFilters={setFilters}/><div className="cp-filter-foot"><Glyph name="shield"/><span>筛选结果只代表示例目录，不预留库存。</span></div></aside>
      <section className="cp-market-results"><div className="cp-market-results-head"><span>{specs.length} 个示例组合 · 对齐 CPU、内存、镜像和价格</span><div><button type="button" className="active">推荐</button><button type="button">价格从低到高</button><button type="button">库存优先</button></div></div><div className="cp-market-cards">{specs.map((item, index) => <button type="button" key={item.id} className={`cp-market-card${item.id === spec.id ? ' selected' : ''}${index === 0 ? ' featured' : ''}`} onClick={() => setSpec(item.id)}><span className="cp-market-card-top"><span className="cp-gpu-chip">{item.gpu}</span><span>{item.stock === 1 ? '仅 1 台' : `示例库存 ${item.stock}`}</span></span><strong>{item.gpu}</strong><small>{item.memory} · {item.cpu} · {item.ram}</small><span className="cp-market-card-price">{money(item.price)}<small>/时 · 示例</small></span><span className="cp-market-card-facts"><span>{item.region}</span><span>{item.image}</span><span>{item.compatibility}</span></span><span className="cp-market-card-action">选择此配置</span></button>)}</div></section>
      <SelectionPanel spec={spec} onCreate={onCreate}/>
    </div> : <div className="cp-b-console">
      <div className="cp-console-head"><div><span className="cp-kicker">INSTANCE FLEET · 示例</span><h3>{instances.length} 台环境</h3><p>{instances.filter(item => item.status === 'running').length} 运行 · {instances.filter(item => item.status === 'creating').length} 创建中 · {exceptions.length} 待处理</p></div><button type="button" className="cp-secondary"><Glyph name="refresh"/>刷新状态</button></div>
      <div className="cp-b-console-overview">{active && <BActiveRunway item={active} onDetail={onDetail} onAction={onAction}/>}<BExceptionQueue instances={instances} onDetail={onDetail}/></div>
      <div className="cp-b-console-lower"><section className="cp-b-fleet-panel"><div className="cp-b-panel-title"><div><span className="cp-kicker">INSTANCE FLEET</span><h3>全部实例</h3></div><small>状态优先于原始 ID</small></div><InstanceTable instances={instances} onDetail={onDetail} onAction={onAction}/><div className="cp-console-guide"><div><Glyph name="pause"/><span><strong>停止 ≠ 删除</strong><small>停止后仍可能保留系统盘费用。</small></span></div><div><Glyph name="shield"/><span><strong>删除前核对清理</strong><small>任务、产物和 GPU 租约必须分别确认。</small></span></div></div></section><BEventTimeline instances={instances}/></div>
    </div>}
  </div>;
}

function CView({instances, spec, setSpec, tab, setTab, filters, setFilters, onCreate, onDetail, onAction}: {
  instances: Instance[]; spec: Spec; setSpec: (id: string) => void; tab: Tab; setTab: (tab: Tab) => void; filters: Filters; setFilters: (filters: Filters) => void; onCreate: () => void; onDetail: (id: string) => void; onAction: (action: Action, id: string) => void;
}) {
  const active = instances.find(item => item.status === 'running') ?? instances[0];
  const specs = applyFilters(SPECS, filters);
  return <div className="cp-c">
    <div className="cp-c-heading"><div><span className="cp-kicker"><Glyph name="bolt"/> LIFECYCLE RUNWAY · 方案 C</span><h2>运行轨道</h2><p>把资源选择、创建进度、运行验证和回收处理串成一条路径。</p></div><button type="button" className="cp-primary" onClick={onCreate}><Glyph name="plus"/>新建环境</button></div>
    <div className="cp-tabs cp-c-tabs" role="tablist"><button type="button" role="tab" aria-selected={tab === 'instances'} onClick={() => setTab('instances')}>运行轨道</button><button type="button" role="tab" aria-selected={tab === 'catalog'} onClick={() => setTab('catalog')}>配置目录</button><span>示例状态 · 不连接供应商</span></div>
    {tab === 'instances' ? <>
      <div className="cp-c-board">
        <section className="cp-runway-card">{active ? <><div className="cp-runway-top"><div><span className="cp-kicker">ACTIVE ENVIRONMENT · 示例</span><h2>{active.name}</h2><p>{active.relation} · {SPECS.find(item => item.id === active.specId)?.region}</p></div><StatusPill status={active.status}/></div><div className="cp-route" aria-label="环境生命周期"><div className="done"><i><Glyph name="check" size={13}/></i><strong>资源确认</strong><small>库存已核验</small></div><div className="done"><i><Glyph name="check" size={13}/></i><strong>实例创建</strong><small>已完成</small></div><div className="done"><i><Glyph name="check" size={13}/></i><strong>运行时准备</strong><small>镜像已加载</small></div><div className="current"><i>4</i><strong>健康探针</strong><small>训练进程正常</small></div><div><i>5</i><strong>就绪</strong><small>可处理任务</small></div></div><div className="cp-runway-facts"><div><span>GPU / 规格</span><strong>{SPECS.find(item => item.id === active.specId)?.gpu} · {SPECS.find(item => item.id === active.specId)?.memory}</strong></div><div><span>CPU / 内存</span><strong>{SPECS.find(item => item.id === active.specId)?.cpu} / {SPECS.find(item => item.id === active.specId)?.ram}</strong></div><div><span>GPU 租约</span><strong>{active.lease}</strong></div><div><span>示例费用</span><strong>{active.cost} · {active.hourly}</strong></div></div><div className="cp-telemetry"><div><span>GPU 利用率</span><strong>72%</strong><i><b style={{width: '72%'}}/></i></div><div><span>显存占用</span><strong>18 / 24 GB</strong><i><b style={{width: '75%'}}/></i></div><div><span>最近心跳</span><strong>12 秒前</strong><small>示例探针正常</small></div></div><div className="cp-runway-actions"><button type="button" className="cp-secondary" onClick={() => onDetail(active.id)}><Glyph name="search"/>查看运行详情</button><button type="button" className="cp-secondary" onClick={() => onAction('stop', active.id)}><Glyph name="pause"/>停止环境</button></div></> : <EmptyVariant onCreate={onCreate}/>}</section>
        <aside className="cp-launch-card"><span className="cp-kicker">QUICK LAUNCH</span><h3>从一个明确配置开始</h3><p>先确认库存、镜像与示例费用，再进入四步向导。</p><div className="cp-launch-options">{SPECS.slice(0, 3).map(item => <button type="button" aria-pressed={item.id === spec.id} key={item.id} onClick={() => setSpec(item.id)}><span><strong>{item.gpu} · {item.ram}</strong><small>{item.region} · {item.image}</small></span><b>{money(item.price)}</b></button>)}</div><button type="button" className="cp-primary cp-wide" onClick={onCreate}><Glyph name="plus"/>进入四步创建</button><button type="button" className="cp-secondary cp-wide" onClick={() => setTab('catalog')}>比较全部配置</button><small className="cp-launch-note">已选择：{spec.gpu} · {spec.cpu} / {spec.ram} · 示例 {money(spec.price)}/时</small></aside>
      </div>
      <div className="cp-c-lower"><section className="cp-all-envs"><div className="cp-section-title"><div><span className="cp-kicker">ALL ENVIRONMENTS · 示例</span><h3>全部环境</h3></div><span>{instances.length} 台实例 · 状态优先于 ID</span></div><InstanceTable instances={instances} onDetail={onDetail} onAction={onAction}/></section><aside className="cp-checks"><span className="cp-kicker">NEXT CHECK</span><h3>需要处理</h3><div className="danger"><Glyph name="alert"/><span><strong>启动失败 · 1</strong><small>baseline-retest-02 需要核对进程与租约。</small></span></div><div className="warning"><Glyph name="shield"/><span><strong>状态不可确认 · 1</strong><small>infer-east-03 正在等待供应商事实。</small></span></div><div><Glyph name="wallet"/><span><strong>费用提示</strong><small>停止计算不保证停止全部存储计费。</small></span></div></aside></div>
    </> : <div className="cp-c-catalog"><div className="cp-catalog-filter"><div className="cp-panel-head"><span>配置目录</span><small>{specs.length} 个示例组合</small></div><FilterFields filters={filters} setFilters={setFilters}/></div><div className="cp-catalog-grid">{specs.map(item => <SpecOption key={item.id} spec={item} selected={item.id === spec.id} onSelect={() => setSpec(item.id)}/>)}</div></div>}
  </div>;
}

function EmptyVariant({onCreate}: {onCreate: () => void}) {
  return <div className="cp-empty"><span><Glyph name="server" size={22}/></span><h3>还没有计算环境</h3><p>真实实例接口当前返回空列表。你可以从明确标注的示例配置开始，检查创建流程与状态表达。</p><button type="button" className="cp-primary" onClick={onCreate}><Glyph name="plus"/>新建示例环境</button></div>;
}

function ScenarioSurface({scenario, onRetry, onCreate}: {scenario: Scenario; onRetry: () => void; onCreate: () => void}) {
  if (scenario === 'loading') return <div className="cp-state-surface" role="status" aria-live="polite"><div className="cp-skeleton"><i/><i/><i/></div><h2>正在同步计算环境</h2><p>示例：正在读取实例、库存、报价时间与 GPU 租约，不使用旧快照冒充当前状态。</p></div>;
  if (scenario === 'error') return <div className="cp-state-surface error" role="alert"><span><Glyph name="alert" size={24}/></span><h2>实例状态读取失败</h2><p>示例错误：供应商状态查询超时。无法确认租约是否释放，不能把实例视为空闲。</p><button type="button" className="cp-primary" onClick={onRetry}><Glyph name="refresh"/>重试示例查询</button></div>;
  if (scenario === 'empty') return <div className="cp-state-surface"><EmptyVariant onCreate={onCreate}/></div>;
  return null;
}

function ModalFrame({children, onClose, className, titleId}: {children: ReactNode; onClose: () => void; className: string; titleId: string}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    dialog.showModal();
    return () => {if (dialog.open) dialog.close();};
  }, []);
  return <dialog ref={ref} className={'cp-dialog ' + className} aria-labelledby={titleId} onCancel={event => {event.preventDefault(); onClose();}}>
    {children}
  </dialog>;
}

const STEP_LABELS = {
  a: ['资源', '费用', '确认'],
  b: ['选择资源', '确认环境', '费用归属', '创建监控'],
  c: ['选择资源', '确认环境', '费用归属', '创建监控'],
};

function CreateDialog({scheme, spec, onSpec, onClose, onCreate}: {scheme: Scheme; spec: Spec; onSpec: (id: string) => void; onClose: () => void; onCreate: () => void}) {
  const total = STEP_LABELS[scheme].length;
  const guided = scheme === 'b' || scheme === 'c';
  const [step, setStep] = useState(1);
  const [ack, setAck] = useState(false);
  const progress = Math.round(((step - 1) / total) * 100);
  return <ModalFrame onClose={onClose} titleId="cp-create-title" className={`cp-create-dialog scheme-${scheme}`}>
    <div className="cp-dialog-head"><div><span className="cp-kicker"><Glyph name="plus"/> {(scheme === 'c' ? 'GUIDED RUNWAY' : scheme === 'b' ? 'GUIDED CHECKOUT' : 'CREATE COMPUTE')} · 交互示例</span><h2 id="cp-create-title">新建计算环境</h2><p>{guided ? '四步向导把资源、兼容性、费用与创建监控放在一条可返回的路径上。' : '资源选择、费用归属和创建边界集中确认，不调用真实云写接口。'}</p></div><button type="button" className="cp-icon-button" aria-label="关闭创建流程" onClick={onClose}><Glyph name="close"/></button></div>
    <div className="cp-dialog-steps">{STEP_LABELS[scheme].map((label, index) => <span key={label} className={step === index + 1 ? 'active' : step > index + 1 ? 'done' : ''}><i>{step > index + 1 ? <Glyph name="check" size={12}/> : index + 1}</i><b>{label}</b></span>)}</div>
    <div className="cp-dialog-body">
      <div className="cp-dialog-main">
        {step === 1 && <><h3>选择资源组合</h3><p>地域、GPU、CPU/内存、镜像和示例价格共同决定下一步核对项。</p><div className="cp-create-specs">{SPECS.slice(0, 4).map(item => <SpecOption key={item.id} spec={item} selected={item.id === spec.id} onSelect={() => onSpec(item.id)}/>)}</div><div className="cp-boundary"><Glyph name="shield"/><span>示例库存不等于已预留；兼容性未验证时不会标记为可训练。</span></div></>}
        {step === 2 && guided && <><h3>确认环境与镜像</h3><p>在进入费用步骤前，先确认资源组合、地域、运行镜像和兼容边界。</p><div className="cp-environment-card"><span className="cp-environment-gpu">{spec.gpu}</span><div><strong>{spec.memory} · {spec.cpu} / {spec.ram}</strong><small>{spec.region} · {spec.zone}</small></div><div><span>运行镜像</span><strong>{spec.image}</strong></div><div><span>示例库存</span><strong>{spec.stock} 台</strong></div></div><div className="cp-compatibility-strip"><Glyph name="shield"/><span><strong>兼容性：{spec.compatibility}</strong><small>镜像存在和库存有货不等于训练基线已验证。</small></span></div></>}
        {step === 2 && !guided && <><h3>核对示例费用</h3><p>以下金额、计费方式和资源归属均为原型演示，不代表真实报价、余额或账单。</p><div className="cp-cost-panel"><span>示例报价</span><strong>{spec.gpu} · {spec.cpu} / {spec.ram}</strong><small>{spec.region} · {spec.image}</small><div><span>GPU 计算</span><b>{money(spec.price)}/时</b></div><div><span>系统盘 100 GB（示例）</span><b>¥0.20/时</b></div><div className="total"><span>运行 2 小时示例估算</span><b>{money((spec.price + 0.2) * 2)}</b></div></div><div className="cp-boundary"><Glyph name="wallet"/><span>停止计算不必然停止全部存储费用；资源归属为个人工作空间。</span></div></>}
        {step === 3 && <><h3>{guided ? '费用归属与创建确认' : '确认创建边界'}</h3><p>金额、计费方式和资源归属均为原型演示；真实系统必须等待实例、运行时与 GPU 租约事实。</p>{guided && <div className="cp-cost-panel compact"><span>示例报价</span><strong>{money(spec.price)}<small>/时</small></strong><div><span>系统盘 100 GB（示例）</span><b>¥0.20/时</b></div><div className="total"><span>运行 2 小时示例估算</span><b>{money((spec.price + 0.2) * 2)}</b></div></div>}<dl className="cp-confirm-list"><div><dt>资源组合</dt><dd>{spec.gpu} · {spec.cpu} / {spec.ram}</dd></div><div><dt>地域 / 镜像</dt><dd>{spec.region} / {spec.image}</dd></div><div><dt>库存 / 兼容</dt><dd>示例有货 / {spec.compatibility}</dd></div><div><dt>资源归属</dt><dd>个人工作空间</dd></div></dl><label className="cp-ack"><input type="checkbox" checked={ack} onChange={event => setAck(event.target.checked)}/><span>我理解这是交互原型：不会创建、预留或购买真实云资源。</span></label></>}
        {step === 4 && <div className="cp-progress-panel" role="status" aria-live="polite"><span className="cp-kicker">RUNWAY MONITOR · 示例</span><h3>创建监控</h3><p>创建意图已进入运行轨道。真实实现必须等待库存、实例、运行时和 GPU 租约证据。</p><div className="cp-create-runway"><div className="cp-route"><div className="done"><i><Glyph name="check" size={12}/></i><strong>资源和费用</strong><small>已确认</small></div><div className="done"><i><Glyph name="check" size={12}/></i><strong>创建意图</strong><small>已记录</small></div><div className="current"><i>3</i><strong>准备镜像</strong><small>约 75%</small></div><div><i>4</i><strong>进程探针</strong><small>等待中</small></div><div><i>5</i><strong>租约绑定</strong><small>等待中</small></div></div><div className="cp-create-runway-facts"><span>目标：{spec.gpu} · {spec.region}</span><span>示例进度不会调用云接口</span></div></div><div className="cp-progress"><div><span>准备运行镜像</span><b>75%</b></div><i><b/></i><ol><li className="done">资源、环境与费用已确认</li><li className="done">创建意图已记录</li><li className="current">正在准备运行镜像与工作负载</li><li>等待进程探针与 GPU 租约绑定</li></ol></div><div className="cp-boundary"><Glyph name="alert"/><span>此处仅模拟创建轨道，不会产生真实云资源或费用。</span></div></div>}
      </div>
      {guided && <aside className="cp-wizard-preview"><span className="cp-kicker">RUNWAY PREVIEW</span><strong>{spec.gpu}</strong><small>{spec.memory} · {spec.cpu} · {spec.ram}</small><div className="cp-preview-route"><i className={step > 1 ? 'done' : 'active'}>1</i><span/><i className={step > 2 ? 'done' : step === 2 ? 'active' : ''}>2</i><span/><i className={step > 3 ? 'done' : step === 3 ? 'active' : ''}>3</i><span/><i className={step === 4 ? 'active' : ''}>4</i></div><dl><div><dt>地域</dt><dd>{spec.region}</dd></div><div><dt>镜像</dt><dd>{spec.image}</dd></div><div><dt>库存</dt><dd>{spec.stock} 台</dd></div><div><dt>示例单价</dt><dd>{money(spec.price)}/时</dd></div></dl><div className="cp-boundary"><Glyph name="shield"/><span>兼容性未验证 · 价格与库存必须重新查询</span></div></aside>}
    </div>
    <div className="cp-dialog-foot"><span>{step === 4 ? '示例创建轨道进行中' : '不会真实创建或收费'} <i style={{width: progress + '%'}}/></span><div>{step > 1 && step < total && <button type="button" className="cp-secondary" onClick={() => setStep(value => value - 1)}>上一步</button>}{step < total - 1 ? <button type="button" className="cp-primary" onClick={() => setStep(value => value + 1)}>继续</button> : step === total - 1 ? <button type="button" className="cp-primary" disabled={!ack} onClick={() => guided ? setStep(4) : onCreate()}>{guided ? '进入创建监控' : '开始模拟创建'}</button> : <button type="button" className="cp-primary" onClick={onCreate}>查看创建中实例</button>}</div></div>
  </ModalFrame>;
}

function DetailDialog({item, onClose, onAction}: {item: Instance; onClose: () => void; onAction: (action: Action, id: string) => void}) {
  const spec = SPECS.find(record => record.id === item.specId) ?? SPECS[0];
  return <ModalFrame onClose={onClose} titleId="cp-detail-title" className="cp-detail-dialog">
    <div className="cp-detail-hero"><div><span className="cp-kicker">INSTANCE DOSSIER · 示例数据</span><h2 id="cp-detail-title">{item.name}</h2><p>{item.relation} · {item.owner}</p><StatusPill status={item.status}/></div><button type="button" className="cp-icon-button" aria-label="关闭实例详情" onClick={onClose}><Glyph name="close"/></button></div>
    <div className="cp-detail-grid"><div className="cp-detail-facts"><div><span>实例 ID</span><strong>{item.id}</strong></div><div><span>GPU / 显存</span><strong>{spec.gpu} / {spec.memory}</strong></div><div><span>CPU / 内存</span><strong>{spec.cpu} / {spec.ram}</strong></div><div><span>地域</span><strong>{spec.region} · {spec.zone}</strong></div><div><span>运行镜像</span><strong>{spec.image}</strong></div><div><span>GPU 租约</span><strong>{item.lease}</strong></div>{item.note && <div className="wide alert"><span>需要核对</span><strong>{item.note}</strong></div>}</div><div className="cp-detail-side"><span className="cp-kicker">费用 · 示例</span><strong className="cp-detail-cost">{item.cost}</strong><small>{item.hourly} · 不代表供应商账单</small><button type="button" className="cp-secondary cp-wide"><Glyph name="copy"/>复制实例 ID</button>{item.status === 'running' && <button type="button" className="cp-secondary cp-wide" onClick={() => onAction('stop', item.id)}><Glyph name="pause"/>停止运行</button>}{item.status !== 'unavailable' && <button type="button" className="cp-danger-outline cp-wide" onClick={() => onAction('delete', item.id)}><Glyph name="trash"/>删除环境</button>}<p>资源归属：{item.owner}。删除前应核对关联任务、产物和清理结果。</p></div></div>
    <div className="cp-detail-timeline"><span className="cp-kicker">RECENT EVENTS · 示例</span><div><i className="done"><Glyph name="check" size={11}/></i><span><strong>实例意图已记录</strong><small>资源、规格与状态分开保存</small></span><time>今天 11:42</time></div><div><i className="done"><Glyph name="check" size={11}/></i><span><strong>运行镜像已准备</strong><small>{spec.image} · 示例镜像</small></span><time>+1 分钟</time></div><div><i><Glyph name="check" size={11}/></i><span><strong>{STATUS[item.status].label}</strong><small>{item.health}</small></span><time>{item.updated}</time></div></div>
    <div className="cp-dialog-foot"><span>示例实例 · 费用不代表真实账单</span><button type="button" className="cp-secondary" onClick={onClose}>关闭</button></div>
  </ModalFrame>;
}

function DangerDialog({item, action, onClose, onConfirm}: {item: Instance; action: Action; onClose: () => void; onConfirm: () => void}) {
  const [value, setValue] = useState('');
  const [checked, setChecked] = useState(false);
  const [error, setError] = useState(false);
  const valid = action === 'delete' ? value === item.name : checked;
  return <ModalFrame onClose={onClose} titleId="cp-danger-title" className="cp-danger-dialog">
    <div className="cp-dialog-head"><div><span className="cp-danger-symbol"><Glyph name={action === 'delete' ? 'trash' : 'pause'}/></span><div><h2 id="cp-danger-title">{action === 'delete' ? '删除这个示例环境？' : '停止运行中的示例环境？'}</h2><p>{action === 'delete' ? '真实删除需要先确认任务、租约、产物与清理状态。' : '停止会中断工作负载，但不等同于删除或租约已释放。'}</p></div></div><button type="button" className="cp-icon-button" aria-label="关闭危险操作确认" onClick={onClose}><Glyph name="close"/></button></div>
    <div className="cp-danger-summary"><div><span>实例</span><strong>{item.name}</strong></div><div><span>关联任务</span><strong>{item.relation}</strong></div><div><span>GPU 租约</span><strong>{item.lease}</strong></div><div><span>费用影响</span><strong>{item.hourly}</strong></div></div>
    <div className="cp-danger-body"><p>{action === 'delete' ? '原型只会移除本地示例记录，不会停止或删除真实云实例。' : '原型只会把当前示例状态改为已停止，不会改动真实进程。'}</p>{action === 'delete' ? <label>输入实例名称 <strong>{item.name}</strong> 以继续<input type="text" value={value} onChange={event => {const next = event.target.value;setValue(next);setError(next.length > 0 && next !== item.name);}} autoFocus/></label> : <label className="cp-ack"><input type="checkbox" checked={checked} onChange={event => {setChecked(event.target.checked);setError(false);}}/><span>我理解停止会中断当前工作负载，并确认这只是原型演示。</span></label>}{error && <p className="cp-inline-error" role="alert"><Glyph name="alert"/>名称不一致，未执行删除。</p>}</div>
    <div className="cp-dialog-foot"><span>危险操作需再次确认</span><div><button type="button" className="cp-secondary" onClick={onClose}>取消</button><button type="button" className="cp-danger" disabled={!valid} onClick={onConfirm}>{action === 'delete' ? '确认删除示例环境' : '确认停止示例环境'}</button></div></div>
  </ModalFrame>;
}

export function ComputeEnvironmentPrototype() {
  const initialScheme = schemeFromLocation();
  const initialView = new URLSearchParams(location.search).get('view');
  const [scheme, setScheme] = useState<Scheme>(initialScheme);
  const [scenario, setScenario] = useState<Scenario>('ready');
  const [instances, setInstances] = useState<Instance[]>(INITIAL_INSTANCES);
  const [tab, setTab] = useState<Tab>(initialView === 'console' ? 'instances' : initialView === 'market' ? 'catalog' : initialScheme === 'a' || initialScheme === 'c' ? 'instances' : 'catalog');
  const [filters, setFilters] = useState<Filters>({gpu: 'all', cpu: 'all', image: 'all', region: 'all', price: 'all', stock: 'all'});
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedSpecId, setSelectedSpecId] = useState('4090-94-sh2');
  const [createOpen, setCreateOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [danger, setDanger] = useState<{action: Action; id: string} | null>(null);
  const [toast, setToast] = useState('');
  const timeoutRef = useRef<number | null>(null);
  const spec = SPECS.find(item => item.id === selectedSpecId) ?? SPECS[1];
  const detail = instances.find(item => item.id === detailId) ?? null;
  const dangerItem = instances.find(item => item.id === danger?.id) ?? null;

  useEffect(() => () => {if (timeoutRef.current) window.clearTimeout(timeoutRef.current);}, []);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(''), 3500);
    return () => window.clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    window.scrollTo({top: 0, behavior: 'auto'});
  }, [scheme]);

  const changeScheme = (next: Scheme) => {
    setScheme(next);
    setTab(next === 'a' ? 'instances' : next === 'b' ? 'catalog' : 'instances');
    setScenario('ready');
    setDetailId(null);
    setDanger(null);
    const url = new URL(location.href);
    url.searchParams.set('scheme', next);
    history.replaceState(null, '', url);
  };

  const refreshScenario = () => {
    setScenario('loading');
    timeoutRef.current = window.setTimeout(() => setScenario('ready'), 700);
  };

  const activeInstances = useMemo(() => scenario === 'empty' ? [] : instances, [scenario, instances]);

  const finishCreate = () => {
    const id = `uhost-mf-${String(Date.now()).slice(-3)}`;
    const created: Instance = {id, name: `forge-preview-${scheme}-${String(Date.now()).slice(-4)}`, specId: spec.id, status: 'creating', relation: '新建环境 · 原型示例', owner: '个人工作空间', cost: '—', hourly: `${money(spec.price)}/时 · 示例`, lease: '等待绑定', health: '正在记录创建意图', updated: '刚刚'};
    setInstances(value => [created, ...value]);
    setCreateOpen(false);
    setDetailId(id);
    setToast('示例环境已进入创建中；未创建真实云资源。');
    timeoutRef.current = window.setTimeout(() => {
      setInstances(value => value.map(item => item.id === id ? {...item, status: 'running', health: '示例环境已运行', lease: '持有 · 1/1', cost: '¥0.00', updated: '刚刚'} : item));
      setToast('示例实例已进入运行中；真实状态仍需等待供应商事实。');
    }, 1600);
  };

  const performDanger = () => {
    if (!danger) return;
    if (danger.action === 'delete') {
      setInstances(value => value.filter(item => item.id !== danger.id));
      setDetailId(null);
      setToast('示例环境已从列表移除；未调用真实删除接口。');
    } else {
      setInstances(value => value.map(item => item.id === danger.id ? {...item, status: 'stopped', health: '计算已停止，系统盘仍可能计费', lease: '已释放', hourly: '已停止计算', updated: '刚刚'} : item));
      setToast('示例环境已停止；真实实现仍需核对进程与租约。');
    }
    setDanger(null);
  };

  return <section className="cp-preview-root" data-scheme={scheme}>
    <PreviewHeader scheme={scheme} onScheme={changeScheme} scenario={scenario} onScenario={setScenario} onRefresh={refreshScenario}/>
    {scenario === 'missing' && <div className="cp-warning-banner" role="status"><Glyph name="alert"/><div><strong>真实价格与实例能力暂不完整</strong><p>当前后端目录没有统一价格字段，实例列表实际为空。下面继续展示明确标注的交互示例，不把它们当成真实监控或账单。</p></div><button type="button" onClick={() => setScenario('ready')}>继续查看示例</button></div>}
    {scenario === 'loading' || scenario === 'error' || scenario === 'empty' ? <ScenarioSurface scenario={scenario} onRetry={() => setScenario('ready')} onCreate={() => setCreateOpen(true)}/> : <>
      {scheme === 'a' && <AView instances={activeInstances} spec={spec} setSpec={setSelectedSpecId} tab={tab === 'catalog' ? 'catalog' : 'instances'} setTab={setTab} filters={filters} setFilters={setFilters} statusFilter={statusFilter} setStatusFilter={setStatusFilter} onCreate={() => setCreateOpen(true)} onDetail={setDetailId} onAction={(action, id) => setDanger({action, id})}/>}
      {scheme === 'b' && <><div className="cp-b-bridge"><span>源项目内预览 · 应用外壳和导航均来自 ModelForge</span><span>只读 · 示例写操作</span></div><BView instances={activeInstances} spec={spec} setSpec={setSelectedSpecId} tab={tab} setTab={setTab} filters={filters} setFilters={setFilters} onCreate={() => setCreateOpen(true)} onDetail={setDetailId} onAction={(action, id) => setDanger({action, id})}/></>}
      {scheme === 'c' && <CView instances={activeInstances} spec={spec} setSpec={setSelectedSpecId} tab={tab === 'catalog' ? 'catalog' : 'instances'} setTab={setTab} filters={filters} setFilters={setFilters} onCreate={() => setCreateOpen(true)} onDetail={setDetailId} onAction={(action, id) => setDanger({action, id})}/>}
    </>}
    {createOpen && <CreateDialog scheme={scheme} spec={spec} onSpec={setSelectedSpecId} onClose={() => setCreateOpen(false)} onCreate={finishCreate}/>}
    {detail && <DetailDialog item={detail} onClose={() => setDetailId(null)} onAction={(action, id) => setDanger({action, id})}/>}
    {dangerItem && danger && <DangerDialog item={dangerItem} action={danger.action} onClose={() => setDanger(null)} onConfirm={performDanger}/>}
    <div className={`cp-toast${toast ? ' visible' : ''}`} role="status" aria-live="polite"><Glyph name="check"/><span>{toast}</span></div>
  </section>;
}
