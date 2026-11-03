import {useMemo, useState} from 'react';
import {
  chooseCurrentAttempt,
  filterAttempts,
  formatDateTime,
  formatEpoch,
  formatLearningRate,
  formatMetric,
  isActiveAttempt,
  lifecycleConclusion,
  needsAttention,
  normalizeMetrics,
  shortId,
  summarizeAttempts,
  trainingErrorDescription,
  trainingLifecycle,
  trainingStage,
  trainingState,
  type TrainingTone,
} from '../training-model';
import type {TrainingAttemptSummary} from '../types';
import {LifecycleRail} from './LifecycleRail';
import {MetricChart} from './MetricChart';
import {TrainingIcon} from './TrainingIcon';
import {TrainingStatusBadge} from './TrainingStatusBadge';

function SummaryMetric({
  label,
  value,
  note,
  tone,
  icon,
}: {
  label: string;
  value: number | string;
  note: string;
  tone?: TrainingTone;
  icon: 'play' | 'clock' | 'check' | 'alert';
}) {
  return <article className={'training-summary-metric' + (tone ? ' ' + tone : '')}>
    <span className="training-summary-icon"><TrainingIcon name={icon} size={16}/></span>
    <div><span>{label}</span><strong>{value}</strong><small>{note}</small></div>
  </article>;
}

function ActiveAttempt({
  attempt,
  onOpenAttempt,
}: {
  attempt: TrainingAttemptSummary;
  onOpenAttempt: (identifier: string, tab?: 'overview' | 'analysis' | 'logs' | 'artifacts' | 'config') => void;
}) {
  const metrics = useMemo(() => normalizeMetrics(attempt.metrics), [attempt.metrics]);
  const lifecycle = useMemo(() => trainingLifecycle(attempt), [attempt]);
  const state = trainingState(attempt.state);
  const active = isActiveAttempt(attempt);
  const latestLabel = metrics.latestStep === null ? '尚无真实采样' : `最新 step ${metrics.latestStep}`;
  const chartSeries = [
    {
      key: 'train',
      label: 'Train Loss',
      color: '#78a8ff',
      points: metrics.train,
    },
    {
      key: 'eval',
      label: 'Eval Loss',
      color: '#72d3a4',
      points: metrics.evaluation,
      showDots: true,
    },
  ];
  return <section className="training-active-panel">
    <header className="training-panel-heading">
      <div>
        <span className="training-kicker">{active ? 'CURRENT ATTEMPT' : 'LATEST ATTEMPT'}</span>
        <h2>{attempt.name}</h2>
        <p>Attempt #{attempt.number} · {trainingStage(attempt.stage)} · 更新于 {formatDateTime(attempt.updated_at)}</p>
      </div>
      <TrainingStatusBadge attempt={attempt}/>
    </header>
    <div className="training-active-body">
      <div className="training-active-summary">
        <div>
          <span className={`training-state-copy ${state.tone}`}>{state.description}</span>
          {attempt.error_code && <p className="training-inline-risk"><TrainingIcon name="alert" size={15}/>{trainingErrorDescription(attempt.error_code)}</p>}
        </div>
        <div className="training-active-metrics">
          <div><span>最新 Step</span><strong>{metrics.latestStep ?? '—'}</strong><small>{metrics.latestEpoch === null ? 'Epoch 未上报' : `Epoch ${formatEpoch(metrics.latestEpoch)}`}</small></div>
          <div><span>Train Loss</span><strong>{formatMetric(metrics.latestTrainLoss)}</strong><small>{latestLabel}</small></div>
          <div><span>Eval Loss</span><strong>{formatMetric(metrics.latestEvalLoss)}</strong><small>{metrics.bestEval ? `最优 ${formatMetric(metrics.bestEval.value, 4)} @ step ${metrics.bestEval.step}` : '验证采样尚未上报'}</small></div>
          <div><span>Learning Rate</span><strong>{formatLearningRate(metrics.latestLearningRate)}</strong><small>来自 trainer metrics</small></div>
        </div>
        <LifecycleRail nodes={lifecycle} conclusion={lifecycleConclusion(attempt)}/>
        <div className="training-active-actions">
          <button type="button" onClick={() => onOpenAttempt(attempt.id, 'overview')}>查看运行详情 <TrainingIcon name="arrow" size={14}/></button>
          <button type="button" className="secondary" onClick={() => onOpenAttempt(attempt.id, 'analysis')}>运行分析</button>
          <button type="button" className="quiet" onClick={() => onOpenAttempt(attempt.id, 'logs')}>查看日志</button>
        </div>
      </div>
      <div className="training-active-chart">
        <MetricChart
          title="训练 / 验证 Loss"
          subtitle={metrics.train.length || metrics.evaluation.length ? `${latestLabel} · 仅显示已上报的真实采样` : '当前 Attempt 尚未上报 Loss'}
          series={chartSeries}
          formatValue={(value) => value.toFixed(Math.abs(value) < 0.1 ? 3 : 2)}
          emptyText="训练开始并写入 trainer_state 后，这里才会出现真实 Loss。"
        />
      </div>
    </div>
  </section>;
}

function AttentionPanel({
  attempts,
  onOpenAttempt,
}: {
  attempts: TrainingAttemptSummary[];
  onOpenAttempt: (identifier: string, tab?: 'overview' | 'analysis' | 'logs' | 'artifacts' | 'config') => void;
}) {
  const rows = attempts.filter(needsAttention).slice(0, 4);
  return <section className="training-side-panel">
    <header><div><span>ATTENTION</span><h2>待处理事项</h2></div><b>{rows.length}</b></header>
    {rows.length ? <div className="training-attention-list">
      {rows.map((attempt) => <button key={attempt.id} type="button" onClick={() => onOpenAttempt(attempt.id, 'overview')}>
        <span className={`training-attention-dot ${trainingState(attempt.state).tone}`}><i/></span>
        <span>
          <strong>{attempt.cancel_requested && !['succeeded', 'failed', 'cancelled'].includes(attempt.state) ? '取消请求待确认' : attempt.state === 'failed' ? '训练失败' : '需要核对'}</strong>
          <small>{attempt.error_code || `${attempt.name} · Attempt #${attempt.number}`}</small>
        </span>
        <TrainingIcon name="arrow" size={14}/>
      </button>)}
    </div> : <div className="training-side-empty"><TrainingIcon name="check" size={18}/><div><strong>当前没有需处理项</strong><p>失败、错误代码和未完成的取消请求会出现在这里。</p></div></div>}
  </section>;
}

function FactPanel({
  attempt,
  onOpenAttempt,
}: {
  attempt: TrainingAttemptSummary;
  onOpenAttempt: (identifier: string, tab?: 'overview' | 'analysis' | 'logs' | 'artifacts' | 'config') => void;
}) {
  return <section className="training-side-panel training-facts-panel">
    <header><div><span>RUN FACTS</span><h2>运行事实</h2></div><TrainingIcon name="database" size={17}/></header>
    <dl>
      <dt>任务 ID</dt><dd><code>{shortId(attempt.task_id, 12)}</code></dd>
      <dt>快照指纹</dt><dd><code>{shortId(attempt.snapshot_sha256, 12)}</code><small>数据、基座与参数在详情页读取</small></dd>
      <dt>实例</dt><dd><code>{attempt.instance_id || '尚未关联'}</code></dd>
      <dt>租约 ID</dt><dd><code>{attempt.lease_id || '尚未建立'}</code></dd>
    </dl>
    <button type="button" className="training-text-link" onClick={() => onOpenAttempt(attempt.id, 'config')}>查看完整冻结输入 <TrainingIcon name="arrow" size={14}/></button>
  </section>;
}

function AttemptLedger({
  attempts,
  onOpenAttempt,
}: {
  attempts: TrainingAttemptSummary[];
  onOpenAttempt: (identifier: string, tab?: 'overview' | 'analysis' | 'logs' | 'artifacts' | 'config') => void;
}) {
  const [state, setState] = useState('all');
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => filterAttempts(attempts, state, query), [attempts, state, query]);
  return <section className="training-ledger">
    <header className="training-panel-heading training-ledger-heading">
      <div><span className="training-kicker">ATTEMPT LEDGER</span><h2>训练尝试</h2><p>每次重试都是独立 Attempt；保留失败、取消和产物证据。</p></div>
      <div className="training-ledger-tools">
        <label className="training-search">
          <TrainingIcon name="search" size={15}/>
          <span className="training-sr-only">搜索训练任务</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索任务、ID 或错误代码"/>
        </label>
        <label className="training-select-wrap">
          <span className="training-sr-only">筛选训练状态</span>
          <select value={state} onChange={(event) => setState(event.target.value)}>
            <option value="all">全部状态</option>
            <option value="active">活动运行</option>
            <option value="attention">需要关注</option>
            <option value="succeeded">已成功</option>
            <option value="failed">已失败</option>
            <option value="cancelled">已取消</option>
          </select>
        </label>
      </div>
    </header>
    {filtered.length ? <div className="training-table-wrap">
      <table className="training-ledger-table">
        <thead><tr><th>任务</th><th>Attempt</th><th>状态</th><th>阶段</th><th>最新指标</th><th>更新时间</th><th><span className="training-sr-only">操作</span></th></tr></thead>
        <tbody>
          {filtered.map((attempt) => {
            const metrics = normalizeMetrics(attempt.metrics);
            return <tr key={attempt.id}>
              <td data-label="任务"><strong>{attempt.name}</strong><small><code>{shortId(attempt.id)}</code></small></td>
              <td data-label="Attempt"><span className="training-mono">#{attempt.number}</span></td>
              <td data-label="状态"><TrainingStatusBadge attempt={attempt} compact/></td>
              <td data-label="阶段"><span>{trainingStage(attempt.stage)}</span>{attempt.error_code && <small>{attempt.error_code}</small>}</td>
              <td data-label="最新指标"><span className="training-mono">{metrics.latestStep === null ? '—' : `step ${metrics.latestStep}`}</span><small>{metrics.latestTrainLoss === null ? 'Loss 未上报' : `train ${formatMetric(metrics.latestTrainLoss)}`}</small></td>
              <td data-label="更新时间"><time dateTime={attempt.updated_at}>{formatDateTime(attempt.updated_at)}</time></td>
              <td data-label="操作"><button type="button" className="training-row-action" onClick={() => onOpenAttempt(attempt.id, 'overview')}>详情 <TrainingIcon name="arrow" size={14}/></button></td>
            </tr>;
          })}
        </tbody>
      </table>
    </div> : <div className="training-filter-empty"><TrainingIcon name="search" size={20}/><strong>没有符合条件的 Attempt</strong><p>调整状态筛选或搜索词后再试。</p><button type="button" className="secondary" onClick={() => {setState('all'); setQuery('');}}>清除筛选</button></div>}
  </section>;
}

export function TrainingWorkbench({
  attempts,
  loading,
  refreshing,
  stale,
  error,
  lastLoadedAt,
  onRefresh,
  onCreate,
  onOpenAttempt,
}: {
  attempts: TrainingAttemptSummary[];
  loading: boolean;
  refreshing: boolean;
  stale: boolean;
  error: string;
  lastLoadedAt: string;
  onRefresh: () => void;
  onCreate: () => void;
  onOpenAttempt: (identifier: string, tab?: 'overview' | 'analysis' | 'logs' | 'artifacts' | 'config') => void;
}) {
  const summary = summarizeAttempts(attempts);
  const current = chooseCurrentAttempt(attempts);
  const summaryUnknown = Boolean(error) && !attempts.length;
  if (loading && !attempts.length) {
    return <div className="training-page-shell">
      <div className="training-page-heading"><div><span>TRAINING</span><h1>训练工作台</h1><p>加载训练任务与真实运行状态。</p></div></div>
      <div className="training-loading-grid" role="status" aria-label="正在加载训练工作台">
        <div/><div/><div/><div/><div className="wide"/><div className="wide tall"/>
      </div>
    </div>;
  }
  return <div className="training-page-shell">
    <div className="training-page-heading">
      <div>
        <span className="training-eyebrow">TRAINING / SFT + LORA</span>
        <h1>训练工作台</h1>
        <p>创建、观察并验收每一次 SFT + LoRA 训练。冻结输入、执行状态与产物证据保持可追溯。</p>
      </div>
      <div className="training-heading-actions">
        <span>最后读取 <strong>{lastLoadedAt || '尚未刷新'}</strong></span>
        <button type="button" className="secondary" onClick={onRefresh} disabled={refreshing}><TrainingIcon name="refresh" size={15}/>{refreshing ? '刷新中' : '刷新'}</button>
        <button type="button" onClick={onCreate}><TrainingIcon name="plus" size={16}/>新建训练</button>
      </div>
    </div>
    {(error || stale) && <div className="training-notice" role="status">
      <TrainingIcon name="alert" size={18}/>
      <div><strong>{error ? '训练状态刷新失败' : '当前显示上次结果'}</strong><p>{error || `最近一次成功读取：${lastLoadedAt}。数据可能已过期。`}</p></div>
      <button type="button" className="quiet" onClick={onRefresh}>重新读取</button>
    </div>}
    <section className="training-summary-strip" aria-label="训练任务摘要">
      <SummaryMetric label="活动运行" value={summaryUnknown ? '—' : summary.active} note={summaryUnknown ? '最近读取失败，状态待确认' : '排队、实例、准备、训练、同步或回收'} tone={!summaryUnknown && summary.active ? 'info' : undefined} icon="play"/>
      <SummaryMetric label="等待实例" value={summaryUnknown ? '—' : summary.waiting} note={summaryUnknown ? '最近读取失败，状态待确认' : '需要手动创建并关联实例'} tone={!summaryUnknown && summary.waiting ? 'warning' : undefined} icon="clock"/>
      <SummaryMetric label="已成功" value={summaryUnknown ? '—' : summary.succeeded} note={summaryUnknown ? '最近读取失败，状态待确认' : '产物可继续进入独立推理验收'} icon="check"/>
      <SummaryMetric label="需要关注" value={summaryUnknown ? '—' : summary.attention} note={summaryUnknown ? '最近读取失败，状态待确认' : '失败、错误代码或取消请求待确认'} tone={!summaryUnknown && summary.attention ? 'danger' : undefined} icon="alert"/>
    </section>
    {error && !attempts.length ? <section className="training-error-panel">
      <TrainingIcon name="alert" size={24}/>
      <div><h2>暂时无法读取训练任务</h2><p>{error}</p><button type="button" onClick={onRefresh}>重试读取</button></div>
    </section> : !attempts.length ? <section className="training-empty-panel">
      <div className="training-empty-symbol"><TrainingIcon name="gpu" size={26}/></div>
      <div><span>READY TO TRAIN</span><h2>还没有训练 Attempt</h2><p>先准备已发布数据集和可用基座，然后按受支持的单 GPU 规格创建第一个训练任务。</p><div><button type="button" onClick={onCreate}>新建训练</button><a className="secondary" href="#datasets">准备数据集</a></div></div>
    </section> : <>
      <div className="training-workbench-grid">
        <div className="training-workbench-main">
          {current && <ActiveAttempt attempt={current} onOpenAttempt={onOpenAttempt}/>}
        </div>
        <aside className="training-workbench-side">
          <AttentionPanel attempts={attempts} onOpenAttempt={onOpenAttempt}/>
          {current && <FactPanel attempt={current} onOpenAttempt={onOpenAttempt}/>}
        </aside>
      </div>
      <AttemptLedger attempts={attempts} onOpenAttempt={onOpenAttempt}/>
    </>}
  </div>;
}
