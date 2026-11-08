import {formatDateTime} from '../training-model';
import type {
  DiagnosisCoverage,
  DiagnosisEvidencePack,
  DiagnosisEvidenceRef,
} from '../types';
import {TrainingIcon} from '../components/TrainingIcon';

const kindLabels: Record<string, string> = {
  attempt: 'Attempt',
  metrics: '指标',
  token_preflight: 'Token 预检',
  runtime: '运行时',
  memory: '显存',
  manifest: '执行清单',
  provisioning: '云供应',
  logs: '日志',
  adapter: 'Adapter',
  inference_trial: '推理 Trial',
  inference_acceptance: '推理验收',
  comparison: '历史对比',
};

const coverageLabels: Record<string, string> = {
  available: '已读取',
  missing: '未上报',
  not_reached: '未到达',
  not_applicable: '不适用',
  conflict: '有冲突',
  unavailable: '读取失败',
};

export function EvidenceChip({
  evidenceId,
  evidence,
}: {
  evidenceId: string;
  evidence?: DiagnosisEvidenceRef;
}) {
  return <a
    className={`diagnosis-evidence-chip ${evidence?.coverage ?? 'missing'}`}
    href={`#diagnosis-evidence-${evidenceId}`}
    title={evidence?.source_locator ?? evidenceId}
    onClick={(event) => {
      event.preventDefault();
      const target = document.getElementById(`diagnosis-evidence-${evidenceId}`);
      if (target instanceof HTMLDetailsElement) {
        target.open = true;
        window.requestAnimationFrame(() => {
          target.scrollIntoView({block: "start", behavior: "auto"});
        });
      }
    }}
  >
    <TrainingIcon name="database" size={12}/>{evidenceId}
    <span>{kindLabels[evidence?.kind ?? ''] ?? evidence?.kind ?? '证据'}</span>
  </a>;
}

function coverageTone(item: DiagnosisCoverage) {
  if (item.status === 'available') return 'ok';
  if (item.status === 'conflict' || item.status === 'unavailable') return 'danger';
  return 'neutral';
}

export function EvidenceInspector({
  evidencePack,
}: {
  evidencePack: DiagnosisEvidencePack;
}) {
  const baseline = evidencePack.comparison?.baseline ?? null;
  const baselineEvidence = baseline?.evidence ?? [];
  const comparisonEvidence = evidencePack.evidence.filter(
    (item) => item.kind === 'comparison',
  );
  const subjectEvidence = evidencePack.evidence.filter(
    (item) => item.kind !== 'comparison',
  );
  const allEvidence = [...evidencePack.evidence, ...baselineEvidence];
  const groups = [
    {
      key: 'subject',
      label: '当前运行',
      detail: evidencePack.attempt_id,
      rows: subjectEvidence,
    },
    ...(baseline ? [{
      key: 'baseline',
      label: '历史基线',
      detail: baseline.attempt_id,
      rows: baselineEvidence,
    }] : []),
    ...(comparisonEvidence.length ? [{
      key: 'comparison',
      label: '比较结果',
      detail: evidencePack.comparison?.comparison_result.policy_version ?? 'comparison',
      rows: comparisonEvidence,
    }] : []),
  ];
  return <section className="diagnosis-evidence-section" aria-labelledby="diagnosis-evidence-title">
    <header className="diagnosis-section-heading">
      <div>
        <span className="training-kicker">EVIDENCE LEDGER</span>
        <h2 id="diagnosis-evidence-title">证据台账</h2>
      </div>
      <span>{allEvidence.length} 条引用 · 截止 {formatDateTime(evidencePack.evidence_cutoff_at)}</span>
    </header>
    <div className="diagnosis-coverage-grid">
      {evidencePack.coverage
        .filter((item, index, rows) => rows.findIndex((candidate) => candidate.category === item.category) === index)
        .map((item) => <article key={item.category} className={coverageTone(item)}>
          <span>{kindLabels[item.category] ?? item.category}</span>
          <strong>{coverageLabels[item.status] ?? item.status}</strong>
          <small>{item.reason || (item.evidence_ids.join(' · ') || '无证据引用')}</small>
        </article>)}
    </div>
    <div className="diagnosis-evidence-groups">
      {groups.map((group) => <section key={group.key} className="diagnosis-evidence-group">
        <header>
          <span>{group.label}</span>
          <code>{group.detail}</code>
          <small>{group.rows.length} 条</small>
        </header>
        <div className="diagnosis-evidence-list">
          {group.rows.map((item) => <details
            key={item.id}
            id={`diagnosis-evidence-${item.id}`}
            className={`diagnosis-evidence-item ${item.coverage}`}
          >
            <summary>
              <span className="diagnosis-evidence-id"><TrainingIcon name="database" size={14}/>{item.id}</span>
              <span>
                <strong>{kindLabels[item.kind] ?? item.kind}</strong>
                <small>{item.source_locator}</small>
              </span>
              <span className={`diagnosis-evidence-status ${item.coverage}`}>
                {coverageLabels[item.coverage] ?? item.coverage}
              </span>
            </summary>
            <dl>
              <div><dt>字段路径</dt><dd><code>{item.field_path || '—'}</code></dd></div>
              <div><dt>观测时间</dt><dd>{formatDateTime(item.observed_at)}</dd></div>
              <div><dt>来源摘要</dt><dd><code>{item.source_digest || '未形成 digest'}</code></dd></div>
              {item.unavailable_reason && <div><dt>不可用原因</dt><dd><code>{item.unavailable_reason}</code></dd></div>}
            </dl>
            {item.excerpt && <pre>{item.excerpt}</pre>}
          </details>)}
        </div>
      </section>)}
    </div>
    <p className="diagnosis-evidence-boundary">
      <TrainingIcon name="lock" size={14}/>
      EvidencePack 在生成时冻结；digest <code>{evidencePack.canonical_digest.slice(0, 16)}…</code>。
      后续 Adapter 或训练事实变化时，旧报告标记 stale，不原地改写。
    </p>
  </section>;
}
