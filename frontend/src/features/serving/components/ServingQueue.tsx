import {useMemo, useState} from 'react';
import type {AdapterVersion} from '../../models';
import {
  queuePresentation,
  shortId,
  summarizeTrials,
} from '../serving-model';
import type {ServingTrial} from '../types';
import {ServingIcon} from './ServingIcon';

function adapterCopy(adapter?: AdapterVersion) {
  if (!adapter) return 'Adapter';
  return `${adapter.role === 'best' ? 'Best' : 'Final'} · ${shortId(adapter.source_attempt_id)}`;
}

export function ServingQueue({
  trials,
  adapters,
  selectedId,
  loading,
  refreshing,
  lastLoadedAt,
  mobileOpen,
  onSelect,
  onCreate,
  onRefresh,
  onClose,
}: {
  trials: ServingTrial[];
  adapters: AdapterVersion[];
  selectedId: string;
  loading: boolean;
  refreshing: boolean;
  lastLoadedAt: string;
  mobileOpen: boolean;
  onSelect: (identifier: string) => void;
  onCreate: () => void;
  onRefresh: () => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const summary = useMemo(() => summarizeTrials(trials), [trials]);
  const adapterMap = useMemo(() => new Map(adapters.map((adapter) => [adapter.id, adapter])), [adapters]);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return trials;
    return trials.filter((trial) => [
      trial.id,
      trial.adapter_id,
      trial.instance_id ?? '',
      trial.error_code ?? '',
      adapterCopy(adapterMap.get(trial.adapter_id)),
    ].join(' ').toLowerCase().includes(needle));
  }, [adapterMap, query, trials]);

  return <aside
    id="serving-queue"
    className={'serving-column serving-queue' + (mobileOpen ? ' is-open' : '')}
    aria-label="推理试用队列"
  >
    <header className="serving-queue-head">
      <div>
        <span className="serving-kicker">TRIAL QUEUE</span>
        <h2>试用队列</h2>
      </div>
      <button type="button" className="serving-icon-button serving-drawer-close" aria-label="关闭试用队列" onClick={onClose} data-drawer-close>
        <ServingIcon name="close" size={17}/>
      </button>
    </header>
    <div className="serving-queue-summary" aria-label="试用队列摘要">
      <span><strong>{trials.length}</strong> 全部</span>
      <span><i className="is-success"/><strong>{summary.ready}</strong> 就绪</span>
      <span><i className="is-warning"/><strong>{summary.waiting}</strong> 等实例</span>
      {summary.attention > 0 && <span className="attention"><i className="is-danger"/><strong>{summary.attention}</strong> 关注</span>}
    </div>
    <div className="serving-queue-tools">
      <label className="serving-search">
        <ServingIcon name="search" size={15}/>
        <span className="serving-sr-only">搜索试用</span>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索 ID 或 Adapter"
        />
      </label>
      <button
        type="button"
        className="serving-icon-button"
        aria-label="刷新试用队列"
        title="刷新试用队列"
        onClick={onRefresh}
        disabled={refreshing}
      ><ServingIcon name="refresh" size={16} className={refreshing ? 'is-spinning' : ''}/></button>
    </div>
    <div className="serving-queue-list" aria-busy={loading || refreshing}>
      {loading && !trials.length ? <div className="serving-queue-skeleton" aria-label="正在读取试用队列">
        <span/><span/><span/><span/>
      </div> : !trials.length ? <div className="serving-queue-empty">
        <span className="serving-empty-symbol"><ServingIcon name="spark" size={21}/></span>
        <strong>还没有推理试用</strong>
        <p>选择已同步的 Adapter，创建第一条独立试用记录。</p>
        <button type="button" onClick={onCreate}>创建试用</button>
      </div> : !filtered.length ? <div className="serving-queue-empty compact">
        <ServingIcon name="search" size={20}/>
        <strong>没有匹配项</strong>
        <p>换一个 Trial ID、Adapter ID 或状态关键词。</p>
        <button type="button" className="secondary" onClick={() => setQuery('')}>清除搜索</button>
      </div> : filtered.map((trial) => {
        const presentation = queuePresentation(trial);
        const adapter = adapterMap.get(trial.adapter_id);
        return <button
          type="button"
          key={trial.id}
          className={'serving-queue-item' + (trial.id === selectedId ? ' is-selected' : '')}
          aria-current={trial.id === selectedId ? 'true' : undefined}
          onClick={() => onSelect(trial.id)}
        >
          <span className={'serving-state-dot ' + presentation.tone}/>
          <span className="serving-queue-item-main">
            <span className="serving-queue-item-top">
              <strong>Trial {shortId(trial.id)}</strong>
              <small>{presentation.shortLabel}</small>
            </span>
            <span className="serving-queue-item-meta">{adapterCopy(adapter)}</span>
            <span className="serving-queue-item-foot">
              <code>{trial.instance_id ? '实例 ' + shortId(trial.instance_id, 11) : '尚未关联实例'}</code>
              <ServingIcon name="arrow" size={13}/>
            </span>
          </span>
        </button>;
      })}
    </div>
    <footer className="serving-queue-foot">
      <span>{lastLoadedAt ? `读取于 ${lastLoadedAt}` : '等待首次读取'}</span>
      <button type="button" onClick={onCreate}><ServingIcon name="plus" size={15}/>新建</button>
    </footer>
  </aside>;
}
