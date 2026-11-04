import {useEffect, useState} from 'react';
import type {AdapterVersion} from '../../models';
import {formatClock, shortId, trialPresentation} from '../serving-model';
import type {ServingTrial, TrialViewState} from '../types';
import {ServingIcon} from './ServingIcon';

export function CurrentTrialHeader({
  trial,
  view,
  adapter,
  stale,
  lastLoadedAt,
  onRefresh,
}: {
  trial: ServingTrial;
  view: TrialViewState;
  adapter?: AdapterVersion;
  stale: boolean;
  lastLoadedAt: string;
  onRefresh: () => void;
}) {
  const presentation = trialPresentation(view);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(timer);
  }, [copied]);

  async function copyId() {
    try {
      await navigator.clipboard.writeText(trial.id);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return <header className="serving-trial-header">
    <div className="serving-trial-identity">
      <div className="serving-trial-title-row">
        <span className="serving-kicker">ACTIVE TRIAL</span>
        <span className={'serving-status-pill ' + presentation.tone}>
          <i/>{presentation.label}
        </span>
        {stale && <span className="serving-stale-pill">数据已过期</span>}
      </div>
      <div className="serving-trial-title">
        <h2>Trial {shortId(trial.id)}</h2>
        <button type="button" className="serving-copy-button" onClick={() => void copyId()} aria-label="复制完整 Trial ID">
          <ServingIcon name={copied ? 'check' : 'copy'} size={13}/>{copied ? '已复制' : '复制 ID'}
        </button>
      </div>
      <p>{presentation.description}</p>
    </div>
    <div className="serving-trial-actions">
      <span>{adapter ? `${adapter.role === 'best' ? 'Best' : 'Final'} · ${shortId(adapter.source_attempt_id)}` : 'Adapter 信息待读取'}</span>
      <span>更新 {lastLoadedAt ? formatClock(lastLoadedAt) : '—'}</span>
      <button type="button" className="serving-icon-button" aria-label="刷新当前试用" title="刷新当前试用" onClick={onRefresh}>
        <ServingIcon name="refresh" size={16}/>
      </button>
    </div>
  </header>;
}
