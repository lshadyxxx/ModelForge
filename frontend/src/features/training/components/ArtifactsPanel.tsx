import {useEffect, useMemo, useState} from 'react';
import {AdapterAssets, listAdapters, type AdapterVersion} from '../../models';
import {isTerminalAttempt} from '../training-model';
import type {TrainingAttempt} from '../types';
import {TrainingIcon} from './TrainingIcon';

function pairRows(rows: AdapterVersion[], attemptId: string) {
  const matching = rows.filter((row) => row.source_attempt_id === attemptId);
  return ['best', 'final'].flatMap((role) => {
    const row = matching.find((item) => item.role === role);
    return row ? [row] : [];
  });
}

export function ArtifactsPanel({attempt}: {attempt: TrainingAttempt}) {
  const [rows, setRows] = useState<AdapterVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const terminal = isTerminalAttempt(attempt);
  const pair = useMemo(() => pairRows(rows, attempt.id), [rows, attempt.id]);

  useEffect(() => {
    const request = new AbortController();
    setLoading(true);
    setError('');
    void listAdapters(request.signal, attempt.id)
      .then(setRows)
      .catch((loadError) => {
        if (!request.signal.aborted) {
          setError(loadError instanceof Error ? loadError.message : String(loadError));
        }
      })
      .finally(() => {
        if (!request.signal.aborted) setLoading(false);
      });
    return () => request.abort();
  }, [attempt.id, revision]);

  const gate = loading && !rows.length
    ? {label: '读取中', tone: 'neutral'}
    : error && !rows.length
      ? {label: '产物状态未确认', tone: 'warning'}
      : pair.length === 2
        ? {label: 'Best / Final 2 / 2', tone: 'success'}
        : {label: `Best / Final ${pair.length} / 2`, tone: pair.length ? 'info' : 'neutral'};

  return <div className="training-artifacts-page">
    <section className="training-artifacts-heading">
      <div>
        <span className="training-kicker">ARTIFACT GATE</span>
        <h2>Best / Final 训练产物</h2>
        <p>训练成功只证明 Attempt 已完成；Adapter 是否可用必须由独立产物接口确认。</p>
      </div>
      <span className={`training-artifact-gate ${gate.tone}`}><i/>{gate.label}</span>
    </section>

    {!terminal && <div className="training-artifact-banner neutral">
      <TrainingIcon name="clock" size={17}/><div><strong>当前 Attempt 尚未进入终态</strong><p>产物可能还没有发布。这里仍会读取真实 Adapter 列表，不用状态推测 0/2。</p></div>
    </div>}
    {terminal && attempt.state === 'succeeded' && !loading && !error && pair.length < 2 && <div className="training-artifact-banner warning">
      <TrainingIcon name="alert" size={17}/><div><strong>训练已成功，但 Best / Final 尚未齐全</strong><p>继续在产物接口核对同步、指纹和可用状态；不要据此宣称已完成推理验收。</p></div>
    </div>}
    {attempt.state === 'failed' || attempt.state === 'cancelled' ? <div className="training-artifact-banner neutral">
      <TrainingIcon name="info" size={17}/><div><strong>本次 Attempt 不会发布部分 Adapter</strong><p>{attempt.state === 'failed' ? '失败运行保留诊断证据；如需继续，创建新的 Attempt。' : '取消运行不会把部分权重发布为可用产物。'}</p></div>
    </div> : null}
    {error && <div className="training-artifact-banner danger">
      <TrainingIcon name="alert" size={17}/><div><strong>无法确认训练产物</strong><p>{error}</p></div>
      <button type="button" className="secondary" onClick={() => setRevision((value) => value + 1)}>重新读取</button>
    </div>}

    <div className="training-artifacts-body">
      <AdapterAssets rows={rows} attemptId={attempt.id} loading={loading} error={error}/>
    </div>
  </div>;
}
