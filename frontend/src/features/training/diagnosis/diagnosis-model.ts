import type {
  DiagnosisComparisonCandidate,
  DiagnosisComparisonCandidates,
  DiagnosisComparisonChoice,
  DiagnosisComparisonResult,
  DiagnosisReport,
} from '../types';

export const trainingSignalLabels: Record<
  DiagnosisComparisonResult['training_signal'],
  string
> = {
  improved: '训练信号较基线改善',
  worsened: '训练信号较基线恶化',
  mixed: '训练信号与健康信号方向冲突',
  flat: '训练信号基本持平',
  inconclusive: '训练信号无法判断',
};

export const confidenceLabels: Record<
  DiagnosisComparisonResult['confidence'],
  string
> = {
  high: '高置信度',
  medium: '中等置信度',
  low: '低置信度',
  none: '无置信度',
};

export const deliverySignalLabels: Record<
  DiagnosisComparisonResult['delivery_signal'],
  string
> = {
  improved: '交付信号改善',
  worsened: '交付信号恶化',
  same: '交付信号持平',
  inconclusive: '交付信号无法判断',
};

export const comparabilityLabels: Record<
  DiagnosisComparisonResult['comparability_status'],
  string
> = {
  strict: '严格可比',
  conditional: '有条件可比',
  not_comparable: '不可比',
  no_baseline: '没有基线',
};

const metricLabels: Record<string, string> = {
  best_eval_loss: 'Best Adapter Eval Loss',
  final_eval_loss: 'Final Adapter Eval Loss',
  latest_eval_loss: '最新 Eval Loss',
  lowest_eval_loss: '最低 Eval Loss',
  final_train_loss: '最终 Train Loss',
  token_overflow_count: 'Token 溢出数量',
};

const classificationLabels: Record<string, string> = {
  optimization: '优化参数',
  budget: '训练预算',
  input_processing: '输入处理',
  stochasticity: '随机性',
};

const confounderLabels: Record<string, string> = {
  runtime_lock_changed: 'Runtime lock 不一致',
  training_image_changed: '训练镜像变化',
  gpu_changed: 'GPU 变化',
  template_changed: 'Template 变化',
  seed_changed: 'Seed 变化',
  cutoff_changed: 'Cutoff 变化',
  multiple_parameters_changed: '多参数共同变化',
  adapter_role_mismatch: 'Adapter 角色不一致',
  baseline_metrics_missing: '基线指标不足',
  subject_metrics_missing: '当前指标不足',
  eval_coverage_low: 'Eval 覆盖不足',
  baseline_source_unavailable: '基线来源不可用',
  subject_source_unavailable: '当前来源不可用',
};

export function metricLabel(name: string) {
  return metricLabels[name] ?? name;
}

export function classificationLabel(value: string) {
  return classificationLabels[value] ?? value;
}

export function confounderLabel(code: string) {
  return confounderLabels[code] ?? code;
}

export function shortId(value?: string | null) {
  return value ? value.slice(0, 8) : '—';
}

export function formatComparisonValue(value?: number | null, name?: string) {
  if (value == null || !Number.isFinite(Number(value))) return '未上报';
  const number = Number(value);
  if (name === 'token_overflow_count') return String(number);
  return number.toFixed(4);
}

export function formatDelta(value?: number | null, name?: string) {
  if (value == null || !Number.isFinite(Number(value))) return '无法计算';
  const number = Number(value);
  if (name === 'token_overflow_count') {
    return `${number > 0 ? '+' : ''}${number}`;
  }
  return `${number > 0 ? '+' : ''}${number.toFixed(4)}`;
}

export function formatRelativeDelta(value?: number | null) {
  if (value == null || !Number.isFinite(Number(value))) return '未上报';
  const number = Number(value);
  return `${number > 0 ? '+' : ''}${(number * 100).toFixed(2)}%`;
}

export function comparisonEntryLine(
  comparison?: DiagnosisComparisonResult | null,
) {
  if (!comparison) return '';
  if (comparison.comparability_status === 'no_baseline') {
    return '未找到同一基座与数据集的成功历史运行';
  }
  if (comparison.comparability_status === 'not_comparable') {
    return '历史运行存在，但数据切分或基座不一致';
  }
  return [
    '较基线：',
    trainingSignalLabels[comparison.training_signal],
    ' · ',
    confidenceLabels[comparison.confidence],
  ].join('');
}

export function candidateLabel(candidate: DiagnosisComparisonCandidate) {
  const metrics = candidate.best_eval_loss == null
    ? 'Best Eval 未上报'
    : `Best Eval ${candidate.best_eval_loss.toFixed(4)}`;
  return [
    `#${candidate.attempt_number}`,
    candidate.task_name,
    new Date(candidate.created_at).toLocaleDateString('zh-CN'),
    metrics,
    candidate.comparability_preview === 'strict'
      ? '严格可比'
      : candidate.comparability_preview === 'conditional'
        ? '有混杂因素'
        : '指标不足',
  ].join(' · ');
}

export function baselineSelectionKey(choice: DiagnosisComparisonChoice) {
  return choice.mode === 'explicit' ? `explicit:${choice.attemptId}` : choice.mode;
}

export function baselineSelectionChanged(
  choice: DiagnosisComparisonChoice,
  report: DiagnosisReport | null | undefined,
  candidates: DiagnosisComparisonCandidates | null | undefined,
) {
  if (!report) return false;
  if (choice.mode === 'none') return report.baseline_attempt_id != null;
  if (choice.mode === 'explicit') {
    return report.baseline_attempt_id !== choice.attemptId;
  }
  if (!candidates) return false;
  const suggestion = candidates?.suggested_baseline_attempt_id ?? null;
  if (suggestion == null) return report.baseline_attempt_id != null;
  return report.baseline_attempt_id !== suggestion;
}

export function reportSummaryForClipboard(report: DiagnosisReport) {
  const lines = [
    `ModelForge AI 训练诊断 · Attempt ${report.attempt_id}`,
    `训练健康度：${report.health.label}`,
    `可交付性：${report.delivery.label}`,
  ];
  if (report.comparison) {
    lines.push(
      `比较基线：${report.baseline_attempt_id || '无'}`,
      `可比性：${comparabilityLabels[report.comparison.comparability_status]}`,
      `训练信号：${trainingSignalLabels[report.comparison.training_signal]} · ${confidenceLabels[report.comparison.confidence]}`,
      `模型效果：${report.comparison.model_effect.status === 'unverified' ? '未验证' : report.comparison.model_effect.status}`,
    );
    if (report.comparison.parameter_changes.length > 0) {
      lines.push(`参数变化：${report.comparison.parameter_changes.map(
        (item) => item.field,
      ).join('、')}`);
    }
  }
  lines.push(
    '',
    report.summary,
    '',
    `报告版本 v${report.version} · ${report.report_digest.slice(0, 12)}`,
  );
  return lines.join('\n');
}
