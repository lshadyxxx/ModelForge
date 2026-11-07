import type {DiagnosisJob} from '../types';
import {TrainingIcon} from '../components/TrainingIcon';

export function DiagnosisLoadingState() {
  return <div className="diagnosis-state-card" role="status">
    <span className="training-spinner"/>
    <div>
      <span className="training-kicker">LOADING ADVISORY</span>
      <h2>正在读取 AI 诊断</h2>
      <p>只读取已发布报告与冻结证据，不会在打开页面时自动调用模型。</p>
    </div>
  </div>;
}

export function DiagnosisEmptyState({
  enabled,
  terminal,
  busy,
  onGenerate,
}: {
  enabled: boolean;
  terminal: boolean;
  busy: boolean;
  onGenerate: () => void;
}) {
  if (!enabled) {
    return <section className="diagnosis-state-card diagnosis-disabled-state">
      <TrainingIcon name="shield" size={24}/>
      <div>
        <span className="training-kicker">FEATURE FLAG OFF</span>
        <h2>AI 智能报告尚未启用</h2>
        <p>这不影响运行总览、原始 Loss、日志和产物核对。启用后才会创建诊断作业。</p>
      </div>
    </section>;
  }
  if (!terminal) {
    return <section className="diagnosis-state-card">
      <TrainingIcon name="clock" size={24}/>
      <div>
        <span className="training-kicker">TERMINAL ATTEMPT REQUIRED</span>
        <h2>训练结束后才能生成终态报告</h2>
        <p>当前 Attempt 尚未成功、失败或取消。平台不会在运行中固化健康结论。</p>
      </div>
    </section>;
  }
  return <section className="diagnosis-empty-state">
    <div className="diagnosis-empty-mark"><TrainingIcon name="spark" size={30}/></div>
    <span className="training-kicker">ADVISORY DIAGNOSIS</span>
    <h2>把已有证据整理成可追溯的诊断</h2>
    <p>回答四个问题：训练是否做对、过程是否健康、产物能否下发、下一步怎么改。AI 不替代硬门禁，也不宣称模型可用。</p>
    <div className="diagnosis-empty-boundaries">
      <span><TrainingIcon name="check" size={14}/>双门禁由确定性代码计算</span>
      <span><TrainingIcon name="check" size={14}/>关键结论可展开证据</span>
      <span><TrainingIcon name="check" size={14}/>无证据时明确写无法判断</span>
    </div>
    <button type="button" onClick={onGenerate} disabled={busy}>
      <TrainingIcon name="spark" size={16}/>{busy ? '正在创建诊断作业…' : '生成 AI 诊断'}
    </button>
    <small>仅为提示性诊断；不创建 GPU、不提交训练、不写回历史 Attempt。</small>
  </section>;
}

export function DiagnosisGeneratingState({job}: {job: DiagnosisJob | null}) {
  const running = job?.state === 'running';
  return <section className="diagnosis-state-card diagnosis-generating-state" role="status">
    <span className="training-spinner"/>
    <div>
      <span className="training-kicker">GENERATING / {running ? 'RUNNING' : 'QUEUED'}</span>
      <h2>{running ? '正在生成可审计报告' : '诊断作业已入队'}</h2>
      <p>{running
        ? 'Worker 正在冻结证据、计算双门禁并调用结构化模型。报告通过校验前不会发布。'
        : '等待独立 Worker 领取；页面可继续查看原始运行分析和日志。'}</p>
      {job && <code className="diagnosis-job-id">job {job.job_id}</code>}
    </div>
  </section>;
}

export function DiagnosisFailedState({
  job,
  enabled,
  busy,
  onRetry,
}: {
  job: DiagnosisJob | null;
  enabled: boolean;
  busy: boolean;
  onRetry: () => void;
}) {
  return <section className="diagnosis-state-card diagnosis-failed-state" role="alert">
    <TrainingIcon name="alert" size={24}/>
    <div>
      <span className="training-kicker">GENERATION FAILED</span>
      <h2>本次报告未发布</h2>
      <p>没有展示半成品。原始训练事实仍可查看；可重新发起生成。</p>
      <div className="diagnosis-error-code">
        <span>稳定错误码</span><code>{job?.error_code || 'diagnosis_unavailable'}</code>
      </div>
      {enabled && <button type="button" className="secondary" onClick={onRetry} disabled={busy}>
        <TrainingIcon name="refresh" size={15}/>{busy ? '正在重试…' : '重新生成报告'}
      </button>}
    </div>
  </section>;
}

export function DiagnosisInlineNotice({
  tone,
  title,
  children,
}: {
  tone: 'info' | 'warning' | 'danger' | 'neutral';
  title: string;
  children: React.ReactNode;
}) {
  return <div className={`diagnosis-inline-notice ${tone}`} role={tone === 'danger' ? 'alert' : 'status'}>
    <TrainingIcon name={tone === 'info' ? 'info' : 'alert'} size={17}/>
    <div><strong>{title}</strong><p>{children}</p></div>
  </div>;
}
