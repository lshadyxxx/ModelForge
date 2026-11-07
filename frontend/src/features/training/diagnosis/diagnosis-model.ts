import type {DiagnosisReport} from '../types';

export function reportSummaryForClipboard(report: DiagnosisReport) {
  return [
    `ModelForge AI 训练诊断 · Attempt ${report.attempt_id}`,
    `训练健康度：${report.health.label}`,
    `可交付性：${report.delivery.label}`,
    '',
    report.summary,
    '',
    `报告版本 v${report.version} · ${report.report_digest.slice(0, 12)}`,
  ].join('\n');
}
