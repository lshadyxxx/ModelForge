import type {
  DiagnosisComparisonResult,
  DiagnosisEvidencePack,
  DiagnosisEvidenceRef,
} from '../types';
import {TrainingIcon} from '../components/TrainingIcon';
import {EvidenceChip} from './EvidenceInspector';
import {
  classificationLabel,
  comparabilityLabels,
  confidenceLabels,
  confounderLabel,
  deliverySignalLabels,
  formatComparisonValue,
  formatDelta,
  formatRelativeDelta,
  metricLabel,
  shortId,
  trainingSignalLabels,
} from './diagnosis-model';

function signalTone(result: DiagnosisComparisonResult) {
  if (result.comparability_status === 'no_baseline') return 'neutral';
  if (result.comparability_status === 'not_comparable') return 'danger';
  if (result.training_signal === 'improved') return 'blue';
  if (result.training_signal === 'worsened') return 'danger';
  if (result.training_signal === 'mixed') return 'warning';
  return 'neutral';
}

function confidenceDetail(result: DiagnosisComparisonResult) {
  if (result.confidence === 'none') return '没有可比较的训练信号';
  if (result.confidence === 'low') {
    return result.confounders.some((item) => item.code === 'eval_coverage_low')
      ? '双方 Eval 覆盖不足，不能当作稳定趋势'
      : '存在降低归因强度的因素，结论只作排查线索';
  }
  if (result.confidence === 'medium') {
    return '在冻结指标与比较策略下可解释，仍需独立推理验收';
  }
  return '比较键、指标覆盖和运行条件均满足当前策略';
}

function paramValue(value: unknown) {
  if (value == null || value === '') return '未上报';
  if (typeof value === 'number') {
    return Number.isInteger(value) ? String(value) : String(Number(value.toPrecision(6)));
  }
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

function groupValue(value: string) {
  return value.length > 18 ? `${value.slice(0, 12)}…${value.slice(-4)}` : value;
}

export function ComparisonPanel({
  comparison,
  pack,
}: {
  comparison: DiagnosisComparisonResult;
  pack: DiagnosisEvidencePack | null;
}) {
  const baseline = pack?.comparison?.baseline ?? null;
  const evidence = [
    ...(pack?.evidence ?? []),
    ...(baseline?.evidence ?? []),
  ];
  const evidenceById = new Map<string, DiagnosisEvidenceRef>(
    evidence.map((item) => [item.id, item]),
  );
  const noBaseline = comparison.comparability_status === 'no_baseline';
  const notComparable = comparison.comparability_status === 'not_comparable';
  const selection = comparison.selection;
  const modelEffectUnverified = comparison.model_effect.status === 'unverified';

  return <section className="diagnosis-comparison" aria-labelledby="diagnosis-comparison-title">
    <header className="diagnosis-comparison-heading">
      <div>
        <span className="training-kicker">HISTORICAL COMPARISON</span>
        <h2 id="diagnosis-comparison-title">这次训练比上次更好吗？</h2>
        <p>只比较训练信号与交付信号；没有同评测集分数时，不判断真实模型效果。</p>
      </div>
      <span className={`diagnosis-comparability ${comparison.comparability_status}`}>
        {comparabilityLabels[comparison.comparability_status]}
      </span>
    </header>

    <div className="diagnosis-comparison-baseline">
      <div>
        <span>当前运行</span>
        <strong>Attempt {shortId(pack?.attempt_id)}</strong>
        <small>{selection.mode === 'explicit' ? '用户指定比较' : selection.selection_rule}</small>
      </div>
      <TrainingIcon name="arrow" size={18}/>
      <div>
        <span>历史基线</span>
        <strong>
          {comparison.selection.resolved_attempt_id
            ? `Attempt ${shortId(comparison.selection.resolved_attempt_id)}`
            : '没有基线'}
        </strong>
        <small>
          {noBaseline
            ? '无可比历史'
            : notComparable
              ? '硬比较键不一致'
              : '同一基座 · 同一数据集 · 同一 split'}
        </small>
      </div>
    </div>

    <div className="diagnosis-comparison-status-grid">
      <article className={signalTone(comparison)}>
        <span>训练信号</span>
        <strong>{trainingSignalLabels[comparison.training_signal]}</strong>
        <small>{confidenceDetail(comparison)}</small>
      </article>
      <article className="neutral">
        <span>置信度</span>
        <strong>{confidenceLabels[comparison.confidence]}</strong>
        <small>{confidenceDetail(comparison)}</small>
      </article>
      <article className={comparison.delivery_signal === 'worsened' ? 'danger' : 'neutral'}>
        <span>交付信号</span>
        <strong>{deliverySignalLabels[comparison.delivery_signal]}</strong>
        <small>交付状态来自两次运行的确定性 Gate</small>
      </article>
      <article className="unverified">
        <span>模型效果</span>
        <strong>{modelEffectUnverified ? '未验证' : comparison.model_effect.status}</strong>
        <small>{comparison.model_effect.note}</small>
      </article>
    </div>

    {noBaseline && <div className="diagnosis-comparison-blocked-state">
      <TrainingIcon name="info" size={19}/>
      <div>
        <strong>未找到可比历史</strong>
        <p>当前基座、数据集和 split 还没有另一次带可读 Eval 指标的成功运行。当前报告仍可独立判断训练健康度与可交付性。</p>
      </div>
    </div>}
    {notComparable && <div className="diagnosis-comparison-blocked-state danger" role="alert">
      <TrainingIcon name="alert" size={19}/>
      <div>
        <strong>历史运行不可比</strong>
        <p>基座、数据集或 split 的冻结哈希不一致，不能据此判断本次训练信号变好或变差。</p>
      </div>
    </div>}

    {!noBaseline && !notComparable && <>
      <div className="diagnosis-comparison-grid">
        <section aria-labelledby="diagnosis-parameter-title">
          <header>
            <div>
              <span className="training-kicker">PARAMETER DIFF</span>
              <h3 id="diagnosis-parameter-title">参数变化 · {comparison.parameter_changes.length} 项</h3>
            </div>
            {comparison.parameter_changes.length > 1 &&
              <span className="diagnosis-comparison-flag">禁止单参数归因</span>}
          </header>
          {comparison.parameter_changes.length === 0
            ? <div className="diagnosis-comparison-empty">
              训练参数没有变化。本次更接近重复运行，差异可能来自随机性或运行环境。
            </div>
            : <div className="diagnosis-comparison-table-wrap">
              <table>
                <caption>基线到当前运行的训练参数变化</caption>
                <thead><tr><th>参数</th><th>基线</th><th>当前</th><th>类型</th></tr></thead>
                <tbody>{comparison.parameter_changes.map((item) => <tr key={item.field}>
                  <td><code>{item.field}</code></td>
                  <td>{paramValue(item.baseline_value)}</td>
                  <td>{paramValue(item.subject_value)}</td>
                  <td>{classificationLabel(item.classification)}</td>
                </tr>)}</tbody>
              </table>
            </div>}
        </section>

        <section aria-labelledby="diagnosis-metric-title">
          <header>
            <div>
              <span className="training-kicker">METRIC DELTA</span>
              <h3 id="diagnosis-metric-title">指标对比</h3>
            </div>
            <span className="diagnosis-comparison-flag neutral">2% 阈值</span>
          </header>
          <div className="diagnosis-comparison-table-wrap">
            <table>
              <caption>当前运行与历史基线的冻结指标</caption>
              <thead><tr><th>指标</th><th>基线</th><th>当前</th><th>绝对差</th><th>相对差</th></tr></thead>
              <tbody>{comparison.metric_deltas.map((item) => <tr key={item.name}>
                <td>{metricLabel(item.name)}</td>
                <td>{formatComparisonValue(item.baseline_value, item.name)}</td>
                <td>{formatComparisonValue(item.subject_value, item.name)}</td>
                <td>{formatDelta(item.absolute_delta, item.name)}</td>
                <td>{formatRelativeDelta(item.relative_delta)}</td>
              </tr>)}</tbody>
            </table>
          </div>
        </section>
      </div>

      <section className="diagnosis-comparison-factors" aria-labelledby="diagnosis-comparison-factor-title">
        <header>
          <div>
            <span className="training-kicker">CONFOUNDERS / LIMITS</span>
            <h3 id="diagnosis-comparison-factor-title">混杂因素与限制 · {comparison.confounders.length} 项</h3>
          </div>
          <span>{comparison.policy_version}</span>
        </header>
        {comparison.confounders.length === 0
          ? <div className="diagnosis-comparison-empty">未发现当前策略覆盖的混杂因素。</div>
          : <ul>{comparison.confounders.map((item) => <li key={`${item.code}-${item.field ?? ''}`}>
            <span className={`diagnosis-factor-mark ${item.blocking ? 'danger' : 'warning'}`}>
              {confounderLabel(item.code)}
            </span>
            <p>{item.text}</p>
            {item.field && <code>{item.field}</code>}
          </li>)}</ul>}
        {comparison.regressions.length > 0 && <div className="diagnosis-regression-list">
          <span>过程回退</span>
          {comparison.regressions.map((item) => <code key={item.code}>{item.code}</code>)}
        </div>}
        <p className="diagnosis-comparison-boundary">
          <TrainingIcon name="lock" size={14}/>
          这些因素降低归因强度，但不阻止展示已经观测到的训练信号。
        </p>
      </section>
    </>}

    <footer className="diagnosis-comparison-evidence">
      <div>
        <span>基线硬键</span>
        <code title={comparison.group.base_fingerprint}>
          base {groupValue(comparison.group.base_fingerprint)}
        </code>
        <code title={comparison.group.dataset_sha256}>
          data {groupValue(comparison.group.dataset_sha256)}
        </code>
        <code title={comparison.group.dataset_split_sha256}>
          split {groupValue(comparison.group.dataset_split_sha256)}
        </code>
      </div>
      <div className="diagnosis-comparison-evidence-chips">
        {comparison.evidence_ids.slice(0, 5).map((evidenceId) => <EvidenceChip
          key={evidenceId}
          evidenceId={evidenceId}
          evidence={evidenceById.get(evidenceId)}
        />)}
      </div>
    </footer>
  </section>;
}
