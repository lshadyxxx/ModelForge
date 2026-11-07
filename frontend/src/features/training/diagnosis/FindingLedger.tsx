import {useState} from 'react';
import type {
  DiagnosisClaim,
  DiagnosisEvidenceRef,
  DiagnosisFinding,
} from '../types';
import {TrainingIcon} from '../components/TrainingIcon';
import {EvidenceChip} from './EvidenceInspector';

const severityLabels = {
  blocked: '阻断',
  attention: '需关注',
  passed: '通过',
  info: '信息',
} as const;

const categoryLabels: Record<DiagnosisFinding['category'], string> = {
  loss_eval: 'Loss / Eval',
  runtime: '运行时',
  token: 'Token 预检',
  memory: '显存',
  artifact: '产物',
  failure: '失败过程',
  coverage: '证据覆盖',
};

const layerLabels: Record<DiagnosisClaim['layer'], string> = {
  observation: '观测',
  inference: '推断',
  recommendation: '建议',
  limitation: '限制',
};

function ClaimBlock({
  claim,
  evidenceById,
}: {
  claim: DiagnosisClaim;
  evidenceById: Map<string, DiagnosisEvidenceRef>;
}) {
  return <div className={`diagnosis-claim-layer ${claim.layer}`}>
    <span>{layerLabels[claim.layer]}</span>
    <div>
      <p>{claim.text}</p>
      <div className="diagnosis-claim-footer">
        <small>置信度 {claim.confidence}</small>
        {claim.evidence_ids.map((evidenceId) => <EvidenceChip
          key={evidenceId}
          evidenceId={evidenceId}
          evidence={evidenceById.get(evidenceId)}
        />)}
      </div>
    </div>
  </div>;
}

export function FindingLedger({
  findings,
  evidence,
}: {
  findings: DiagnosisFinding[];
  evidence: DiagnosisEvidenceRef[];
}) {
  const [severity, setSeverity] = useState<'all' | DiagnosisFinding['severity']>('all');
  const evidenceById = new Map(evidence.map((item) => [item.id, item]));
  const counts = {
    all: findings.length,
    blocked: findings.filter((item) => item.severity === 'blocked').length,
    attention: findings.filter((item) => item.severity === 'attention').length,
    passed: findings.filter((item) => item.severity === 'passed').length,
    info: findings.filter((item) => item.severity === 'info').length,
  };
  const visible = severity === 'all'
    ? findings
    : findings.filter((item) => item.severity === severity);

  return <section className="diagnosis-findings-section" aria-labelledby="diagnosis-findings-title">
    <header className="diagnosis-section-heading">
      <div>
        <span className="training-kicker">FINDINGS / SEVERITY</span>
        <h2 id="diagnosis-findings-title">关键发现</h2>
      </div>
      <div className="diagnosis-severity-filter" role="group" aria-label="按严重度筛选关键发现">
        {(['all', 'blocked', 'attention', 'passed'] as const).map((value) => <button
          key={value}
          type="button"
          className={severity === value ? 'active' : ''}
          aria-pressed={severity === value}
          onClick={() => setSeverity(value)}
        >
          {value === 'all' ? '全部' : severityLabels[value]}
          <span>{counts[value]}</span>
        </button>)}
      </div>
    </header>
    <div className="diagnosis-finding-list">
      {visible.length === 0 && <div className="diagnosis-filter-empty">当前筛选下没有关键发现。</div>}
      {visible.map((finding, index) => <details
        key={finding.id}
        className={`diagnosis-finding ${finding.severity}`}
        open={index === 0}
      >
        <summary>
          <span className={`diagnosis-severity-mark ${finding.severity}`}>
            {finding.severity === 'passed' && <TrainingIcon name="check" size={13}/>}
            {finding.severity === 'blocked' && <TrainingIcon name="alert" size={13}/>}
          </span>
          <span className="diagnosis-finding-title">
            <small>{categoryLabels[finding.category]} · {severityLabels[finding.severity]}</small>
            <strong>{finding.title}</strong>
          </span>
          <span className={`diagnosis-epistemic ${finding.epistemic_status}`}>
            {finding.epistemic_status === 'observed' ? '已观测' : finding.epistemic_status === 'inferred' ? '推断' : '无法判断'}
          </span>
          <TrainingIcon name="arrow" size={15}/>
        </summary>
        <div className="diagnosis-finding-body">
          <ClaimBlock claim={finding.observation} evidenceById={evidenceById}/>
          {finding.inference && <ClaimBlock claim={finding.inference} evidenceById={evidenceById}/>}
          {finding.recommendation && <ClaimBlock claim={finding.recommendation} evidenceById={evidenceById}/>}
          <div className="diagnosis-finding-evidence">
            <span>证据</span>
            {finding.evidence_ids.map((evidenceId) => <EvidenceChip
              key={evidenceId}
              evidenceId={evidenceId}
              evidence={evidenceById.get(evidenceId)}
            />)}
          </div>
        </div>
      </details>)}
    </div>
  </section>;
}
