import {isTerminalAttempt} from '../training-model';
import type {TrainingAttempt, TrainingTab} from '../types';
import {TrainingIcon} from '../components/TrainingIcon';
import {useDiagnosisView} from './DiagnosisContext';
import {comparisonEntryLine, shortId} from './diagnosis-model';

export function AiReportEntryCard({
  attempt,
  onOpenTab,
}: {
  attempt: TrainingAttempt;
  onOpenTab: (tab: TrainingTab) => void;
}) {
  const diagnosis = useDiagnosisView();
  const report = diagnosis.latest?.report;
  const running = diagnosis.job && ['queued', 'running'].includes(diagnosis.job.state);
  const failed = diagnosis.job?.state === 'failed';
  const comparisonLine = comparisonEntryLine(report?.comparison);

  return <section className="training-detail-panel diagnosis-entry-card">
    <header>
      <div><span className="training-kicker">AI ADVISORY</span><h2>智能训练诊断</h2></div>
      <TrainingIcon name="spark" size={18}/>
    </header>
    {report ? <>
      <div className="diagnosis-entry-gates">
        <span className={`health ${report.health.status}`}>{report.health.label}</span>
        <span className={`delivery ${report.delivery.status}`}>{report.delivery.label}</span>
      </div>
      <p>{report.summary}</p>
      <div className="diagnosis-entry-meta">
        <span>v{report.version}</span>
        <span>AI advisory</span>
        <span>{report.findings.length} 条发现</span>
      </div>
      {comparisonLine && <div className="diagnosis-entry-comparison">
        <span>{comparisonLine}</span>
        {report.comparison && report.comparison.comparability_status !== 'no_baseline' &&
          <small>
            模型效果：{report.comparison.model_effect.status === 'unverified'
              ? '未验证'
              : report.comparison.model_effect.status}
            {report.baseline_attempt_id
              ? ` · 基线 ${shortId(report.baseline_attempt_id)}`
              : ''}
          </small>}
      </div>}
      <button type="button" className="secondary" onClick={() => onOpenTab('diagnosis')}>
        查看完整诊断 <TrainingIcon name="arrow" size={14}/>
      </button>
    </> : running ? <>
      <div className="diagnosis-entry-running"><span className="training-spinner"/><span>AI 报告生成中</span></div>
      <p>{diagnosis.job?.comparison_mode === 'none'
        ? '正在生成单运行诊断；原始运行分析仍可正常使用。'
        : '正在对比历史训练并生成可审计报告；原始运行分析仍可正常使用。'}</p>
      <button type="button" className="secondary" onClick={() => onOpenTab('diagnosis')}>查看生成进度</button>
    </> : <>
      <p>{failed
        ? '上次生成未发布半成品；可在诊断页重试。'
        : !diagnosis.config?.enabled
          ? 'AI 报告当前未启用；原始 Loss、日志和产物不受影响。'
          : isTerminalAttempt(attempt)
            ? '训练已结束，可按需生成终态 AI 诊断；打开页面不会自动调用模型。'
            : '训练结束后才能生成终态诊断。'}</p>
      <button type="button" className="secondary" onClick={() => onOpenTab('diagnosis')}>
        <TrainingIcon name="spark" size={14}/>打开 AI 诊断
      </button>
    </>}
  </section>;
}
