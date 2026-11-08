import {useEffect, useMemo, useState} from 'react';
import {
  formatDateTime,
  isTerminalAttempt,
} from '../training-model';
import type {
  DiagnosisEvidencePack,
  DiagnosisNextExperiment,
  DiagnosisReport,
  TrainingAttempt,
} from '../types';
import {TrainingIcon} from '../components/TrainingIcon';
import {reportSummaryForClipboard} from './diagnosis-model';
import {EvidenceInspector} from './EvidenceInspector';
import {FindingLedger} from './FindingLedger';
import {BaselineSelector} from './BaselineSelector';
import {ComparisonPanel} from './ComparisonPanel';
import {
  DiagnosisEmptyState,
  DiagnosisFailedState,
  DiagnosisGeneratingState,
  DiagnosisInlineNotice,
  DiagnosisLoadingState,
} from './ReportStates';
import {useDiagnosisView, type DiagnosisView} from './DiagnosisContext';

function reportTone(report: DiagnosisReport) {
  if (report.integrity === 'conflict' || report.health.status === 'blocked') return 'danger';
  if (report.health.status === 'attention' || report.health.status === 'partial') return 'warning';
  if (report.health.status === 'healthy') return 'success';
  return 'neutral';
}

function deliveryTone(report: DiagnosisReport) {
  if (report.delivery.status === 'not_deliverable') return 'danger';
  if (report.delivery.status === 'ready_for_release_review') return 'success';
  if (report.delivery.status === 'artifact_deliverable_model_unverified') return 'warning';
  return 'neutral';
}

function GateSummary({report}: {report: DiagnosisReport}) {
  return <section className="diagnosis-gate-summary" aria-label="确定性双门禁结论">
    <article className={`diagnosis-gate-card ${reportTone(report)}`}>
      <span className="diagnosis-gate-index">01 / TRAINING HEALTH</span>
      <div>
        <span>训练健康度</span>
        <strong>{report.health.label}</strong>
      </div>
      <p>{report.health.rationale}</p>
      <small>状态由 GateEngine 计算，AI 只负责解释。</small>
    </article>
    <article className={`diagnosis-gate-card ${deliveryTone(report)}`}>
      <span className="diagnosis-gate-index">02 / DELIVERY</span>
      <div>
        <span>产物可交付性</span>
        <strong>{report.delivery.label}</strong>
      </div>
      <p>{report.delivery.rationale}</p>
      <small>可进入发布评审 ≠ 生产可用；Trial ready ≠ 独立推理验收。</small>
    </article>
  </section>;
}

function MetricEvidenceStrip({pack}: {pack: DiagnosisEvidencePack}) {
  const facts = pack.facts;
  const metrics = facts.metrics && typeof facts.metrics === 'object'
    ? facts.metrics as {
      counts?: {train?: number; eval?: number; learning_rate?: number};
      latest_eval?: {eval_loss?: number; step?: number};
      lowest_eval?: {eval_loss?: number; step?: number};
    }
    : {};
  const memory = facts.memory && typeof facts.memory === 'object'
    ? facts.memory as {device_peak_used_bytes?: number}
    : {};
  const adapters = facts.adapters && typeof facts.adapters === 'object'
    ? facts.adapters as {
      best?: {state?: string} | null;
      final?: {state?: string} | null;
    }
    : {};
  const availableAdapters = ['best', 'final'].filter(
    (role) => adapters[role as 'best' | 'final']?.state === 'available',
  ).length;
  const latestEval = metrics.latest_eval?.eval_loss;
  const lowestEval = metrics.lowest_eval?.eval_loss;
  const memoryBytes = memory.device_peak_used_bytes;
  return <section className="diagnosis-metric-strip">
    <article><span>Train 采样</span><strong>{metrics.counts?.train ?? '—'}</strong><small>trainer_state 已写入</small></article>
    <article><span>Eval 采样</span><strong>{metrics.counts?.eval ?? '—'}</strong><small>单点不能判断趋势</small></article>
    <article><span>最新 Eval</span><strong>{Number.isFinite(latestEval) ? Number(latestEval).toFixed(4) : '—'}</strong><small>最低 {Number.isFinite(lowestEval) ? Number(lowestEval).toFixed(4) : '—'}</small></article>
    <article><span>Adapter</span><strong>{availableAdapters}/2</strong><small>Best / Final 可用状态</small></article>
    <article><span>显存峰值</span><strong>{Number.isFinite(memoryBytes) ? `${(Number(memoryBytes) / 1024 ** 3).toFixed(2)} GiB` : '未上报'}</strong><small>结束后快照，非实时曲线</small></article>
  </section>;
}

function ExperimentList({
  report,
  draftError,
  onApply,
}: {
  report: DiagnosisReport;
  draftError: string;
  onApply: (experimentId: string) => void;
}) {
  return <section className="diagnosis-experiments" aria-labelledby="diagnosis-experiment-title">
    <header className="diagnosis-section-heading">
      <div><span className="training-kicker">NEXT EXPERIMENTS</span><h2 id="diagnosis-experiment-title">下一步实验</h2></div>
      <span>仅创建未提交草稿</span>
    </header>
    {draftError && <div className="diagnosis-inline-error" role="alert">{draftError}</div>}
    <div className="diagnosis-experiment-list">
      {report.next_experiments.length === 0
        ? <div className="diagnosis-filter-empty">当前证据不足以提出可执行实验；请先补齐验证或推理验收。</div>
        : report.next_experiments.map((experiment: DiagnosisNextExperiment) => <article
          key={experiment.id}
          className={`diagnosis-experiment ${experiment.priority.toLowerCase()}`}
        >
          <span className="diagnosis-priority">{experiment.priority}</span>
          <div>
            <h3>{experiment.title}</h3>
            <p>{experiment.hypothesis}</p>
            {experiment.preconditions.length > 0 && <ul>
              {experiment.preconditions.map((item) => <li key={item}>{item}</li>)}
            </ul>}
            <div className="diagnosis-experiment-footer">
              <span>{experiment.evidence_ids.join(' · ') || '无直接证据'}</span>
              {experiment.config_patch
                ? <button type="button" className="secondary" onClick={() => onApply(experiment.id)}>
                  应用建议配置
                </button>
                : <small>该建议不包含自动配置草稿</small>}
            </div>
          </div>
        </article>)}
    </div>
  </section>;
}

function DraftPanel({
  draft,
  onClose,
}: {
  draft: NonNullable<DiagnosisView['draft']>;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState('');
  const content = JSON.stringify(draft.draft_config, null, 2);
  const copy = async () => {
    setCopyError('');
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
    } catch {
      setCopyError('浏览器未允许写入剪贴板，请手动复制预览内容。');
    }
  };
  return <section className="diagnosis-draft-panel" aria-labelledby="diagnosis-draft-title">
    <header>
      <div><span className="training-kicker">UNSUBMITTED DRAFT</span><h2 id="diagnosis-draft-title">建议配置草稿</h2></div>
      <button type="button" className="quiet" onClick={onClose} aria-label="关闭建议草稿"><TrainingIcon name="x" size={16}/></button>
    </header>
    <p>{draft.notice}</p>
    <div className="diagnosis-draft-grid">
      <div>
        <span>配置变更</span>
        <pre>{JSON.stringify(draft.config_patch, null, 2)}</pre>
      </div>
      <div>
        <span>草稿预览</span>
        <pre>{content}</pre>
      </div>
    </div>
    <footer>
      <span><TrainingIcon name="lock" size={14}/>不会自动提交、创建 GPU 或修改历史 Attempt。</span>
      <button type="button" className="secondary" onClick={() => void copy()}>
        <TrainingIcon name="copy" size={14}/>{copied ? '已复制' : '复制配置草稿'}
      </button>
    </footer>
    {copyError && <div className="diagnosis-inline-error" role="alert">{copyError}</div>}
  </section>;
}

export function AiDiagnosisTab({attempt}: {attempt: TrainingAttempt}) {
  const diagnosis = useDiagnosisView();
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState('');
  const report = diagnosis.latest?.report ?? null;
  const evidencePack = diagnosis.latest?.evidence ?? null;
  const terminal = isTerminalAttempt(attempt);
  const generating = diagnosis.job
    ? ['queued', 'running'].includes(diagnosis.job.state)
    : false;
  const jobFailed = diagnosis.job?.state === 'failed' && !report;
  const usage = report && diagnosis.job?.job_id === report.job_id
    ? diagnosis.job.usage
    : null;
  const summary = useMemo(() => report ? reportSummaryForClipboard(report) : '', [report]);
  const succeeded = attempt.state === 'succeeded';

  useEffect(() => {
    if (!succeeded || !diagnosis.config?.enabled) return;
    void diagnosis.loadCandidates();
  }, [diagnosis.config?.enabled, diagnosis.loadCandidates, succeeded]);

  const copySummary = async () => {
    if (!summary) return;
    setCopyError('');
    try {
      await navigator.clipboard.writeText(summary);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopyError('浏览器未允许写入剪贴板，请手动选择摘要文本复制。');
    }
  };

  if (diagnosis.loading && !diagnosis.latest) return <DiagnosisLoadingState/>;

  return <div className="diagnosis-page">
    <header className="diagnosis-page-heading">
      <div>
        <span className="training-kicker">AI ADVISORY / EVIDENCE-BOUND</span>
        <h1>{report ? '这次训练做对了吗？' : 'AI 智能报告分析'}</h1>
        <p>只解释本次 Attempt 的冻结证据；不替代硬门禁，不用 Loss 推断业务效果。</p>
      </div>
      <div className="diagnosis-page-actions">
        {report && <button type="button" className="secondary" onClick={() => void copySummary()}>
          <TrainingIcon name="copy" size={14}/>{copied ? '已复制摘要' : '复制摘要'}
        </button>}
        {report && diagnosis.config?.enabled && <button
          type="button"
          className="secondary"
          onClick={() => void (
            diagnosis.baselineChanged
              ? diagnosis.generate()
              : diagnosis.regenerate()
          )}
          disabled={diagnosis.submitting || generating}
        >
          <TrainingIcon name="refresh" size={14}/>{diagnosis.submitting || generating
            ? '生成中…'
            : diagnosis.baselineChanged
              ? '用新基线重新生成'
              : '重新生成'}
        </button>}
        <button type="button" className="quiet" onClick={() => void diagnosis.reload()} disabled={diagnosis.loading}>
          <TrainingIcon name="refresh" size={14}/>刷新
        </button>
      </div>
    </header>
    {copyError && <div className="diagnosis-inline-error" role="alert">{copyError}</div>}

    {succeeded && diagnosis.config && <BaselineSelector
      choice={diagnosis.baselineChoice}
      candidates={diagnosis.comparisonCandidates}
      loading={diagnosis.candidatesLoading}
      error={diagnosis.candidatesError}
      disabled={!diagnosis.config.enabled || generating || diagnosis.submitting}
      onChange={diagnosis.setBaselineChoice}
      onRetry={() => void diagnosis.loadCandidates()}
    />}
    {!succeeded && terminal && <DiagnosisInlineNotice tone="neutral" title="失败复盘不做训练效果对比">
      本次 Attempt 未成功结束。报告只整理失败证据与可恢复动作，不比较历史训练信号。
    </DiagnosisInlineNotice>}
    {report && diagnosis.baselineChanged && <DiagnosisInlineNotice tone="info" title="基线选择尚未应用">
      当前仍展示旧报告冻结的基线。点击“用新基线重新生成”会创建新版本，不覆盖旧报告。
    </DiagnosisInlineNotice>}

    {diagnosis.error && <DiagnosisInlineNotice tone="danger" title="AI 诊断读取失败">
      {diagnosis.error}。原始运行分析、日志和产物不受影响。
    </DiagnosisInlineNotice>}
    {!diagnosis.config?.enabled && report && <DiagnosisInlineNotice tone="neutral" title="AI 生成当前关闭">
      现有报告仍可只读查看；不能重新生成。
    </DiagnosisInlineNotice>}
    {generating && <DiagnosisInlineNotice tone="info" title="新报告正在生成">
      {report ? '当前展示上一版不可变报告；新版通过校验后才会替换 latest。' : '报告通过证据、Gate 和 Validator 校验前不会发布。'}
    </DiagnosisInlineNotice>}
    {report?.report_mode === 'limited' && <DiagnosisInlineNotice tone="warning" title="有限复盘模式">
      本次 Attempt 没有形成完整训练过程结论；报告只整理可读事实，不补造 Loss、日志或根因。
    </DiagnosisInlineNotice>}
    {report?.freshness === 'stale' && <DiagnosisInlineNotice tone="warning" title="报告依据已过期">
      Attempt 或冻结来源已变化。以下内容保留为历史版本，不应继续作为 latest 事实。
    </DiagnosisInlineNotice>}
    {report?.integrity === 'conflict' && <DiagnosisInlineNotice tone="danger" title="证据存在阻断性冲突">
      Gate 保留冲突并为训练健康度给出阻断结论；报告没有静默选择其中一侧。
    </DiagnosisInlineNotice>}

    {!report && diagnosis.loading && <DiagnosisLoadingState/>}
    {!report && generating && <DiagnosisGeneratingState job={diagnosis.job}/>}
    {!report && jobFailed && <DiagnosisFailedState
      job={diagnosis.job}
      enabled={Boolean(diagnosis.config?.enabled)}
      busy={diagnosis.submitting}
      onRetry={() => void diagnosis.generate()}
    />}
    {!report && !generating && !jobFailed && diagnosis.config && <DiagnosisEmptyState
      enabled={diagnosis.config.enabled}
      terminal={terminal}
      busy={diagnosis.submitting}
      onGenerate={() => void diagnosis.generate()}
    />}

    {report && <article className="diagnosis-report">
      <div className="diagnosis-report-meta">
        <span>REPORT v{report.version} · {report.report_mode === 'full' ? '完整诊断' : '有限复盘'}</span>
        <span>{formatDateTime(report.generated_at)} · {report.model_name}</span>
        {usage && <span>
          模型调用 {usage.model_calls} 次 · {usage.total_tokens == null ? 'tokens 未上报' : `${usage.total_tokens.toLocaleString('zh-CN')} tokens`} · {(usage.latency_ms / 1000).toFixed(1)}s
        </span>}
        <span>digest {report.report_digest.slice(0, 12)}…</span>
      </div>

      <section className="diagnosis-conclusion">
        <div className={`diagnosis-conclusion-mark ${reportTone(report)}`}>
          <TrainingIcon name={report.health.status === 'healthy' ? 'check' : report.health.status === 'blocked' ? 'alert' : 'spark'} size={24}/>
        </div>
        <div>
          <span className="training-kicker">CONCLUSION / ADVISORY</span>
          <p>{report.summary}</p>
        </div>
      </section>

      {report.comparison
        ? <ComparisonPanel comparison={report.comparison} pack={evidencePack}/>
        : <DiagnosisInlineNotice tone="neutral" title="历史版本报告">
          这份报告生成于历史对比上线前，只包含单运行诊断；重新生成后会使用当前比较契约。
        </DiagnosisInlineNotice>}

      <div className="diagnosis-current-run-label">
        <span>CURRENT RUN</span>
        <small>以下结论只描述本次 Attempt，不被历史对比覆盖。</small>
      </div>
      <GateSummary report={report}/>
      {evidencePack && <MetricEvidenceStrip pack={evidencePack}/>}

      <FindingLedger findings={report.findings} evidence={evidencePack?.evidence ?? []}/>

      <section className="diagnosis-limitations" aria-labelledby="diagnosis-limitations-title">
        <header className="diagnosis-section-heading">
          <div><span className="training-kicker">BOUNDARIES</span><h2 id="diagnosis-limitations-title">限制与无法判断</h2></div>
          <span>{report.limitations.length} 项</span>
        </header>
        <ul>{report.limitations.map((item) => <li key={item.code}>
          <TrainingIcon name="info" size={14}/>
          <div><code>{item.code}</code><p>{item.text}</p></div>
        </li>)}</ul>
      </section>

      <ExperimentList
        report={report}
        draftError={diagnosis.draftError}
        onApply={(experimentId) => void diagnosis.applyExperiment(experimentId)}
      />

      {evidencePack
        ? <EvidenceInspector evidencePack={evidencePack}/>
        : <DiagnosisInlineNotice tone="warning" title="证据索引不可用">
          已发布报告仍可阅读，但当前不能展开原始证据。
        </DiagnosisInlineNotice>}
    </article>}

    {diagnosis.draft && <DraftPanel draft={diagnosis.draft} onClose={diagnosis.clearDraft}/>}
  </div>;
}
