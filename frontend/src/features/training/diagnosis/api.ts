import {api, json} from '../../../shared/http';
import type {
  DiagnosisConfig,
  DiagnosisComparisonCandidates,
  DiagnosisComparisonChoice,
  DiagnosisDraft,
  DiagnosisJob,
  DiagnosisLatest,
} from '../types';

function attemptPath(attemptId: string) {
  return '/training/attempts/' + encodeURIComponent(attemptId) + '/diagnosis-reports';
}

export function getDiagnosisConfig(signal?: AbortSignal) {
  return api<DiagnosisConfig>('/training/diagnosis/config', {signal});
}

export function getLatestDiagnosis(attemptId: string, signal?: AbortSignal) {
  return api<DiagnosisLatest>(attemptPath(attemptId) + '/latest', {signal});
}

export function listDiagnosisReports(attemptId: string, signal?: AbortSignal) {
  return api<DiagnosisLatest[]>(attemptPath(attemptId), {signal});
}

function comparisonBody(choice: DiagnosisComparisonChoice) {
  if (choice.mode === 'explicit') {
    return {
      comparison_mode: 'explicit',
      baseline_attempt_id: choice.attemptId,
    };
  }
  return {comparison_mode: choice.mode};
}

export function createDiagnosis(
  attemptId: string,
  comparison: DiagnosisComparisonChoice = {mode: 'auto'},
  signal?: AbortSignal,
) {
  return api<DiagnosisJob>(
    attemptPath(attemptId),
    {...json('POST', comparisonBody(comparison)), signal},
  );
}

export function getDiagnosisComparisonCandidates(
  attemptId: string,
  signal?: AbortSignal,
) {
  return api<DiagnosisComparisonCandidates>(
    '/training/attempts/' + encodeURIComponent(attemptId)
      + '/diagnosis-comparison-candidates?limit=20',
    {signal},
  );
}

export function regenerateDiagnosis(jobId: string, signal?: AbortSignal) {
  return api<DiagnosisJob>(
    '/training/diagnosis-jobs/' + encodeURIComponent(jobId) + '/regenerate',
    {...json('POST'), signal},
  );
}

export function getDiagnosisJob(jobId: string, signal?: AbortSignal) {
  return api<DiagnosisJob>(
    '/training/diagnosis-jobs/' + encodeURIComponent(jobId) + '/status',
    {signal},
  );
}

export function getDiagnosisReport(reportId: string, signal?: AbortSignal) {
  return api<DiagnosisLatest>(
    '/training/diagnosis-reports/' + encodeURIComponent(reportId),
    {signal},
  );
}

export function createDiagnosisDraft(
  reportId: string,
  experimentId: string,
  signal?: AbortSignal,
) {
  return api<DiagnosisDraft>(
    '/training/diagnosis-reports/' + encodeURIComponent(reportId) + '/draft',
    {...json('POST', {experiment_id: experimentId}), signal},
  );
}

