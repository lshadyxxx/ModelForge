import {useState} from 'react';
import {
  executionModeDescriptor,
  formatBytes,
  formatDateTime,
  formatEpoch,
  formatLearningRate,
  formatMetric,
  isManagedAttempt,
  isTerminalAttempt,
  lifecycleConclusion,
  managedBudgetSummary,
  normalizeExecutionMode,
  normalizeMetrics,
  provisioningStateLabel,
  shortId,
  trainingErrorDescription,
  trainingLifecycle,
  trainingStage,
  trainingState,
} from '../training-model';
import type {TrainingAttempt, TrainingTab} from '../types';
import {CopyValue} from './CopyValue';
import {LifecycleRail} from './LifecycleRail';
import {TrainingIcon} from './TrainingIcon';
import {TrainingStatusBadge} from './TrainingStatusBadge';

function DetailMetric({
  label,
  value,
  note,
}: {
  label: string;
  value: string | number;
  note: string;
}) {
  return <div className="training-detail-metric">
    <span>{label}</span>
    <strong>{value}</strong>
    <small>{note}</small>
  </div>;
}

function FactRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return <div className="training-detail-fact">
    <dt>{label}</dt>
    <dd>{children}</dd>
  </div>;
}

function WaitingInstancePanel({
  attempt,
  busy,
  onBind,
}: {
  attempt: TrainingAttempt;
  busy: boolean;
  onBind: (instanceId: string, acknowledgeCleanup: boolean) => Promise<void>;
}) {
  const [instanceId, setInstanceId] = useState('');
  const [acknowledgeCleanup, setAcknowledgeCleanup] = useState(false);
  const [error, setError] = useState('');
  const instance = attempt.snapshot.instance;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const normalized = instanceId.trim();
    if (!normalized) {
      setError('请填写实例 ID。');
      return;
    }
    if (!acknowledgeCleanup) {
      setError('请确认授权平台在训练安全完成或取消后停止、删除该实例。');
      return;
    }
    setError('');
    await onBind(normalized, acknowledgeCleanup);
  };

  return <section className="training-handoff-panel">
    <header>
      <div><span className="training-kicker">MANUAL HANDOFF</span><h2>创建并关联单 GPU 实例</h2></div>
      <span className="training-handoff-badge"><TrainingIcon name="clock" size={14}/>等待实例</span>
    </header>
    <div className="training-handoff-grid">
      <div className="training-handoff-spec">
        <h3>按冻结规格手动创建</h3>
        <dl>
          <FactRow label="地域 / 可用区"><code>{instance.region || '—'} / {instance.zone || '—'}</code></FactRow>
          <FactRow label="GPU">{instance.gpu_type || '—'}</FactRow>
          <FactRow label="CPU / 内存">{instance.cpu || '—'} 核 / {instance.memory_mb ? `${instance.memory_mb / 1024} GiB` : '—'}</FactRow>
          <FactRow label="运行镜像"><CopyValue value={instance.image_id} label="镜像 ID"/></FactRow>
          <FactRow label="系统盘">{instance.boot_disk_gb || '—'} GB · {instance.boot_disk_type || '—'}</FactRow>
        </dl>
        <p>平台不会调用云厂商创建接口，也不会预留或购买资源。请在优云控制台创建实例，确认 Running 后再关联。</p>
      </div>
      <form className="training-bind-form" onSubmit={(event) => void submit(event)} noValidate>
        <label>
          <span>实例 ID <b>必填</b></span>
          <input
            value={instanceId}
            onChange={(event) => setInstanceId(event.target.value)}
            placeholder="例如：uhost-xxxxxxxx"
            aria-invalid={Boolean(error && !instanceId.trim())}
            aria-describedby={error ? 'training-bind-error' : 'training-bind-hint'}
          />
        </label>
        <label className="training-check-row">
          <input
            type="checkbox"
            checked={acknowledgeCleanup}
            onChange={(event) => setAcknowledgeCleanup(event.target.checked)}
          />
          <span>此实例由我创建。我授权平台在训练安全完成或取消后停止并删除该实例。</span>
        </label>
        <p id="training-bind-hint">关联前只检查实例身份；训练运行时兼容性由 Worker 继续核对。</p>
        {error && <p className="training-field-error" id="training-bind-error" role="alert">{error}</p>}
        <button type="submit" disabled={busy}>{busy ? '正在关联…' : '核对并关联实例'}</button>
      </form>
    </div>
  </section>;
}

export function RunOverview({
  attempt,
  busy,
  onBind,
  onOpenTab,
}: {
  attempt: TrainingAttempt;
  busy: boolean;
  onBind: (instanceId: string, acknowledgeCleanup: boolean) => Promise<void>;
  onOpenTab: (tab: TrainingTab) => void;
}) {
  const metrics = normalizeMetrics(attempt.metrics);
  const lifecycle = trainingLifecycle(attempt);
  const state = trainingState(attempt.state);
  const terminal = isTerminalAttempt(attempt);
  const managed = isManagedAttempt(attempt);
  const mode = executionModeDescriptor(normalizeExecutionMode(attempt.execution_mode));
  const budget = managedBudgetSummary(attempt);
  const evidentialFiles = attempt.execution_manifest?.files ?? [];

  return <div className="training-detail-stack">
    <section className="training-detail-hero">
      <div className="training-detail-state">
        <span className={`training-state-mark ${state.tone}`}><i/></span>
        <div><span>当前状态</span><TrainingStatusBadge attempt={attempt}/><p>{state.description}</p></div>
      </div>
      <div className="training-detail-stage">
        <span>{mode.label} · 运行阶段</span>
        <strong>{trainingStage(attempt.stage)}</strong>
        <small>{attempt.cancel_requested && !terminal ? '已请求取消，等待安全退出与回收确认' : `更新于 ${formatDateTime(attempt.updated_at)}`}</small>
      </div>
      <div className="training-detail-actions">
        <button type="button" className="secondary" onClick={() => onOpenTab('analysis')}>查看分析 <TrainingIcon name="arrow" size={14}/></button>
        {attempt.state === 'succeeded' && <button type="button" className="quiet" onClick={() => onOpenTab('artifacts')}>核对训练产物</button>}
      </div>
    </section>

    <div className="training-detail-grid">
      <div className="training-detail-main">
        <section className="training-detail-panel">
          <header><div><span className="training-kicker">LIFECYCLE</span><h2>{managed ? '托管执行生命周期' : '五阶段生命周期'}</h2></div><span>{lifecycleConclusion(attempt)}</span></header>
          <LifecycleRail nodes={lifecycle} conclusion={lifecycleConclusion(attempt)}/>
        </section>

        <section className="training-detail-panel">
          <header><div><span className="training-kicker">LATEST SAMPLES</span><h2>最新真实指标</h2></div><button type="button" className="training-text-link" onClick={() => onOpenTab('analysis')}>完整分析 <TrainingIcon name="arrow" size={14}/></button></header>
          <div className="training-detail-metrics">
            <DetailMetric label="最新 Step" value={metrics.latestStep ?? '—'} note={metrics.latestEpoch === null ? 'Epoch 未上报' : `Epoch ${formatEpoch(metrics.latestEpoch)}`}/>
            <DetailMetric label="Train Loss" value={formatMetric(metrics.latestTrainLoss)} note={`${metrics.train.length} 个真实采样`}/>
            <DetailMetric label="Eval Loss" value={formatMetric(metrics.latestEvalLoss)} note={metrics.bestEval ? `最优 ${formatMetric(metrics.bestEval.value, 4)} @ step ${metrics.bestEval.step}` : '尚无验证采样'}/>
            <DetailMetric label="Learning Rate" value={formatLearningRate(metrics.latestLearningRate)} note={`${metrics.learningRate.length} 个真实采样`}/>
          </div>
        </section>

        {managed && <section className="training-managed-run-panel">
          <header>
            <div><span className="training-kicker">MANAGED EXECUTION</span><h2>平台托管执行边界</h2></div>
            <span className="training-execution-badge"><TrainingIcon name="shield" size={14}/>平台托管</span>
          </header>
          <div className="training-managed-run-grid">
            <article><span>费用守卫</span><strong>{provisioningStateLabel('cost_guard_state', attempt.provisioning?.cost_guard_state)}</strong><small>{budget.deadline ? `截止 ${budget.deadline}` : `${budget.window} · ${budget.budget}`}</small></article>
            <article><span>安全首启</span><strong>{provisioningStateLabel('credential_state', attempt.provisioning?.credential_state)}</strong><small>临时密码与实例密钥不进入 API 响应</small></article>
            <article><span>运行环境</span><strong>{provisioningStateLabel('runtime_state', attempt.provisioning?.runtime_state)}</strong><small>{attempt.runtime_report?.lock_id ? `锁 ${shortId(attempt.runtime_report.lock_id, 12)}` : '预检通过后才传输训练输入'}</small></article>
            <article><span>产物归档</span><strong>{provisioningStateLabel('artifact_state', attempt.provisioning?.artifact_state)}</strong><small>{attempt.provisioning?.artifact_verified_at ? `校验于 ${formatDateTime(attempt.provisioning.artifact_verified_at)}` : '正式存储回读校验后才标记可用'}</small></article>
          </div>
          <p className="training-managed-boundary"><TrainingIcon name="info" size={15}/>平台会在训练结束、失败或取消后停止并删除实例；若供应商确认未完成，Attempt 会停留在回收阶段且租约不释放。</p>
        </section>}

        {!managed && attempt.state === 'waiting_instance' && <WaitingInstancePanel attempt={attempt} busy={busy} onBind={onBind}/>}

        <section className="training-detail-panel">
          <header><div><span className="training-kicker">RUN IDENTITY</span><h2>运行事实</h2></div><span>只展示接口返回事实</span></header>
          <dl className="training-detail-facts">
            <FactRow label="Attempt ID"><CopyValue value={attempt.id} label="Attempt ID" display={shortId(attempt.id, 12)}/></FactRow>
            <FactRow label="任务 ID"><CopyValue value={attempt.task_id} label="任务 ID" display={shortId(attempt.task_id, 12)}/></FactRow>
            <FactRow label="执行方式">{mode.label}{managed && attempt.snapshot.training_image_profile?.id ? <small> · {attempt.snapshot.training_image_profile.id}</small> : null}</FactRow>
            <FactRow label="实例 ID"><CopyValue value={attempt.instance_id} label="实例 ID" display={attempt.instance_id || '尚未关联'}/></FactRow>
            <FactRow label="租约 ID"><CopyValue value={attempt.lease_id} label="租约 ID" display={attempt.lease_id || '尚未建立'}/></FactRow>
            <FactRow label="数据版本"><CopyValue value={attempt.snapshot.dataset.id} label="数据集版本 ID" display={shortId(attempt.snapshot.dataset.id, 12)}/></FactRow>
            <FactRow label="基座模型"><CopyValue value={attempt.snapshot.base.id} label="基座模型版本 ID" display={shortId(attempt.snapshot.base.id, 12)}/></FactRow>
            <FactRow label="GPU 规格">{attempt.snapshot.instance.gpu_type || '—'} <small>{attempt.snapshot.instance.region || '—'} / {attempt.snapshot.instance.zone || '—'}</small></FactRow>
            <FactRow label="创建时间">{formatDateTime(attempt.created_at)}</FactRow>
          </dl>
          <p className="training-boundary-note"><TrainingIcon name="info" size={15}/>实例 ID 和租约 ID 只证明曾经建立身份，不代表当前实例正在运行或租约仍被持有。</p>
        </section>
      </div>

      <aside className="training-detail-side">
        <section className="training-detail-panel">
          <header><div><span className="training-kicker">EVIDENCE</span><h2>运行证据</h2></div><TrainingIcon name="database" size={17}/></header>
          <dl className="training-evidence-list">
            <FactRow label="退出码">{attempt.exit_code ?? '—'}</FactRow>
            <FactRow label="Outcome">{attempt.outcome || '—'}</FactRow>
            <FactRow label="错误代码">{attempt.error_code ? <code>{attempt.error_code}</code> : '无'}</FactRow>
            <FactRow label="运行锁">{attempt.runtime_report?.lock_id ? <code>{shortId(attempt.runtime_report.lock_id, 12)}</code> : '未上报'}</FactRow>
            <FactRow label="证据文件">{attempt.execution_manifest ? `${evidentialFiles.length} 个` : '未上报'}</FactRow>
            <FactRow label="诊断缺口">{attempt.execution_manifest?.diagnostic_gap ? '存在' : '未报告'}</FactRow>
            <FactRow label="显存峰值">{formatBytes(attempt.runtime_report?.training_memory?.device_peak_used_bytes)}</FactRow>
          </dl>
          {attempt.error_code && <div className="training-evidence-error"><TrainingIcon name="alert" size={16}/><p>{trainingErrorDescription(attempt.error_code)}</p></div>}
          {evidentialFiles.length > 0 && <details className="training-evidence-files">
            <summary>查看执行证据文件</summary>
            <ul>{evidentialFiles.map((file) => <li key={file.path}><code>{file.path}</code><small>{formatBytes(file.size)}{file.sha256 ? ` · ${shortId(file.sha256, 12)}` : ''}</small></li>)}</ul>
          </details>}
        </section>

        <section className="training-detail-panel training-next-step">
          <header><div><span className="training-kicker">NEXT CHECK</span><h2>下一步核对</h2></div></header>
          <ol>
            <li className={terminal ? 'done' : ''}><span>01</span><div><strong>确认实例与进程</strong><p>{managed ? '平台负责创建、费用守卫、安全首启和进程观察；只查看接口事实。' : '等待状态推进，或在等待实例时填写实例 ID。'}</p></div></li>
            <li className={metrics.train.length ? 'done' : ''}><span>02</span><div><strong>检查 Loss 与学习率</strong><p>只使用 trainer 实际写入的指标判断趋势。</p></div></li>
            <li className={attempt.state === 'succeeded' ? '' : 'muted'}><span>03</span><div><strong>核对 Best / Final 产物</strong><p>成功状态不等于 Adapter 已 2/2 可用。</p></div></li>
            <li className="muted"><span>04</span><div><strong>独立推理验收</strong><p>产物可用后再进入推理试用，不自动启动服务。</p></div></li>
          </ol>
        </section>
      </aside>
    </div>
  </div>;
}
