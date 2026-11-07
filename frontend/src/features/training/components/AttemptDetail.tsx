import {useState, type ReactNode} from 'react';
import {
  executionModeDescriptor,
  formatDateTime,
  isManagedAttempt,
  isTerminalAttempt,
  trainingErrorDescription,
  trainingStage,
  trainingState,
} from '../training-model';
import type {LogChunk, TrainingAttempt, TrainingTab} from '../types';
import {ArtifactsPanel} from './ArtifactsPanel';
import {FrozenInputs} from './FrozenInputs';
import {RunAnalysis} from './RunAnalysis';
import {RunOverview} from './RunOverview';
import {TrainingDialog} from './TrainingDialog';
import {TrainingIcon, type TrainingIconName} from './TrainingIcon';
import {TrainingLogs} from './TrainingLogs';
import {TrainingStatusBadge} from './TrainingStatusBadge';
import {AiDiagnosisTab} from '../diagnosis/AiDiagnosisTab';
import {DiagnosisProvider} from '../diagnosis/DiagnosisContext';

const tabs: Array<{id: TrainingTab; label: string; icon: TrainingIconName}> = [
  {id: 'overview', label: '运行总览', icon: 'play'},
  {id: 'analysis', label: '运行分析', icon: 'sliders'},
  {id: 'diagnosis', label: 'AI 诊断', icon: 'spark'},
  {id: 'logs', label: '训练日志', icon: 'terminal'},
  {id: 'artifacts', label: '训练产物', icon: 'layers'},
  {id: 'config', label: '冻结输入', icon: 'lock'},
];

function DialogActions({
  busy,
  confirmLabel,
  onClose,
  onConfirm,
  danger = false,
}: {
  busy: boolean;
  confirmLabel: string;
  onClose: () => void;
  onConfirm: () => void;
  danger?: boolean;
}) {
  return <div className="training-dialog-actions">
    <button type="button" className="secondary" onClick={onClose} disabled={busy}>返回</button>
    <button type="button" className={danger ? 'danger' : ''} onClick={onConfirm} disabled={busy}>{busy ? '正在提交…' : confirmLabel}</button>
  </div>;
}

export function AttemptDetail({
  attempt,
  tab,
  logs,
  logsLoading,
  logsError,
  stale,
  refreshError,
  busy,
  actionError,
  onBack,
  onOpenTab,
  onRefresh,
  onRefreshLogs,
  onBind,
  onCancel,
  onRetry,
}: {
  attempt: TrainingAttempt;
  tab: TrainingTab;
  logs: LogChunk[];
  logsLoading: boolean;
  logsError: string;
  stale: boolean;
  refreshError: string;
  busy: boolean;
  actionError: string;
  onBack: () => void;
  onOpenTab: (tab: TrainingTab) => void;
  onRefresh: () => void;
  onRefreshLogs: () => void;
  onBind: (instanceId: string, acknowledgeCleanup: boolean) => Promise<void>;
  onCancel: () => Promise<void>;
  onRetry: () => Promise<void>;
}) {
  const [cancelOpen, setCancelOpen] = useState(false);
  const [retryOpen, setRetryOpen] = useState(false);
  const terminal = isTerminalAttempt(attempt);
  const state = trainingState(attempt.state);
  const managed = isManagedAttempt(attempt);
  const mode = executionModeDescriptor(attempt.execution_mode);
  const diagnosticGap = Boolean(attempt.execution_manifest?.diagnostic_gap);

  let content: ReactNode;
  if (tab === 'analysis') content = <RunAnalysis attempt={attempt}/>;
  else if (tab === 'diagnosis') content = <AiDiagnosisTab attempt={attempt}/>;
  else if (tab === 'logs') content = <TrainingLogs
    attemptId={attempt.id}
    chunks={logs}
    loading={logsLoading}
    error={logsError}
    diagnosticGap={diagnosticGap}
    onReload={onRefreshLogs}
  />;
  else if (tab === 'artifacts') content = <ArtifactsPanel attempt={attempt}/>;
  else if (tab === 'config') content = <FrozenInputs attempt={attempt}/>;
  else content = <RunOverview attempt={attempt} busy={busy} onBind={onBind} onOpenTab={onOpenTab}/>;

  const detailPage = <div className="training-detail-page">
    <button type="button" className="training-back" onClick={onBack}><TrainingIcon name="back" size={16}/>训练工作台</button>
    <header className="training-detail-heading">
      <div className="training-detail-title">
        <span className="training-eyebrow">RUN DETAIL / ATTEMPT #{attempt.number} / {managed ? 'MANAGED' : 'MANUAL'}</span>
        <h1>{attempt.name}</h1>
        <p><code>{attempt.id}</code> · {mode.label} · {trainingStage(attempt.stage)} · 更新于 {formatDateTime(attempt.updated_at)}</p>
      </div>
      <div className="training-detail-heading-actions">
        <TrainingStatusBadge attempt={attempt}/>
        <button type="button" className="secondary" onClick={onRefresh} disabled={busy}><TrainingIcon name="refresh" size={15}/>刷新</button>
        {!terminal && <button type="button" className="danger secondary" onClick={() => setCancelOpen(true)} disabled={busy || attempt.cancel_requested}>取消训练</button>}
        {terminal && <button type="button" onClick={() => setRetryOpen(true)} disabled={busy}>创建重试 Attempt</button>}
      </div>
    </header>

    {(stale || refreshError) && <div className="training-notice" role="status">
      <TrainingIcon name="alert" size={18}/>
      <div><strong>{refreshError ? '运行状态刷新失败' : '当前显示上次结果'}</strong><p>{refreshError || '最近一次成功读取后连接中断；页面保留旧快照，可能已过期。'}</p></div>
      <button type="button" className="quiet" onClick={onRefresh}>重新读取</button>
    </div>}
    {actionError && <div className="training-notice danger" role="alert">
      <TrainingIcon name="alert" size={18}/>
      <div><strong>当前操作未完成</strong><p>{actionError}</p></div>
    </div>}
    {attempt.cancel_requested && !terminal && <div className="training-notice warning" role="status">
      <TrainingIcon name="clock" size={18}/>
      <div><strong>取消请求待确认</strong><p>已请求取消，但远程进程可能仍在运行。页面不会在收到终态前显示“已取消”。</p></div>
    </div>}
    {diagnosticGap && <div className="training-notice warning" role="status">
      <TrainingIcon name="alert" size={18}/>
      <div><strong>运行证据存在缺口</strong><p>执行清单报告了诊断缺口；日志、指标或产物可能不完整。</p></div>
    </div>}
    {attempt.error_code && <div className="training-notice danger" role="alert">
      <TrainingIcon name="alert" size={18}/>
      <div><strong>{attempt.error_code}</strong><p>{trainingErrorDescription(attempt.error_code)}</p></div>
    </div>}

    <nav className="training-detail-tabs" aria-label="运行详情页签">
      {tabs.map((item) => <button
        key={item.id}
        type="button"
        className={tab === item.id ? 'active' : ''}
        aria-current={tab === item.id ? 'page' : undefined}
        onClick={() => onOpenTab(item.id)}
      ><TrainingIcon name={item.icon} size={15}/>{item.label}</button>)}
    </nav>

    <div className={`training-detail-content training-tone-${state.tone}`}>{content}</div>

    {cancelOpen && <TrainingDialog titleId="training-cancel-title" onClose={() => setCancelOpen(false)}>
      <div className="training-dialog-heading"><span>SAFE CANCEL</span><h2 id="training-cancel-title">确认取消本次训练？</h2></div>
      <div className="training-dialog-warning"><TrainingIcon name="alert" size={19}/><p>平台会请求远程进程退出，并等待实例停止与回收确认。取消不会发布部分 Adapter，也不会把当前 Attempt 改成成功。</p></div>
      <p>当前阶段：{trainingStage(attempt.stage)}。如果进程已经结束，最终状态仍以后端回收结果为准。</p>
      <DialogActions busy={busy} confirmLabel="确认取消并安全回收" danger onClose={() => setCancelOpen(false)} onConfirm={() => {setCancelOpen(false); void onCancel();}}/>
    </TrainingDialog>}

    {retryOpen && <TrainingDialog titleId="training-retry-title" onClose={() => setRetryOpen(false)}>
      <div className="training-dialog-heading"><span>NEW ATTEMPT</span><h2 id="training-retry-title">创建新的重试 Attempt？</h2></div>
      <p>{managed
        ? '重试会复制本次冻结输入并创建一个新的托管 Attempt；新 Attempt 通过费用守卫后会创建新的单台收费实例。'
        : '重试会复制本次冻结输入并创建新的 Attempt，不会修改当前记录，也不会自动购买 GPU。'}</p>
      <dl className="training-retry-summary">
        <dt>数据版本</dt><dd><code>{attempt.snapshot.dataset.id}</code></dd>
        <dt>基座模型</dt><dd><code>{attempt.snapshot.base.id}</code></dd>
        <dt>GPU 规格</dt><dd>{attempt.snapshot.instance.gpu_type || '—'}</dd>
        <dt>执行方式</dt><dd>{mode.label}{managed && attempt.snapshot.training_image_profile?.id ? ` · ${attempt.snapshot.training_image_profile.id}` : ''}</dd>
      </dl>
      <DialogActions busy={busy} confirmLabel="创建重试 Attempt" onClose={() => setRetryOpen(false)} onConfirm={() => {setRetryOpen(false); void onRetry();}}/>
    </TrainingDialog>}
  </div>;

  return tab === 'overview' || tab === 'diagnosis'
    ? <DiagnosisProvider attemptId={attempt.id}>{detailPage}</DiagnosisProvider>
    : detailPage;
}
