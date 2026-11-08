import {useCallback, useEffect, useRef, useState} from 'react';
import {
  createDiagnosis,
  createDiagnosisDraft,
  getDiagnosisConfig,
  getDiagnosisComparisonCandidates,
  getDiagnosisJob,
  getLatestDiagnosis,
  regenerateDiagnosis,
} from './api';
import type {
  DiagnosisConfig,
  DiagnosisComparisonCandidates,
  DiagnosisComparisonChoice,
  DiagnosisDraft,
  DiagnosisJob,
  DiagnosisLatest,
} from '../types';
import {baselineSelectionChanged} from './diagnosis-model';

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function useDiagnosis(attemptId: string) {
  const [config, setConfig] = useState<DiagnosisConfig | null>(null);
  const [latest, setLatest] = useState<DiagnosisLatest | null>(null);
  const [job, setJob] = useState<DiagnosisJob | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState<DiagnosisDraft | null>(null);
  const [draftError, setDraftError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [comparisonCandidates, setComparisonCandidates] =
    useState<DiagnosisComparisonCandidates | null>(null);
  const [candidatesLoading, setCandidatesLoading] = useState(false);
  const [candidatesError, setCandidatesError] = useState('');
  const [baselineChoice, setBaselineChoiceState] =
    useState<DiagnosisComparisonChoice>({mode: 'auto'});
  const mounted = useRef(true);
  const attemptRef = useRef(attemptId);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (attemptRef.current === attemptId) return;
    attemptRef.current = attemptId;
    setLatest(null);
    setJob(null);
    setDraft(null);
    setDraftError('');
    setError('');
    setComparisonCandidates(null);
    setCandidatesError('');
    setBaselineChoiceState({mode: 'auto'});
  }, [attemptId]);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError('');
    try {
      const [nextConfig, nextLatest] = await Promise.all([
        getDiagnosisConfig(signal),
        getLatestDiagnosis(attemptId, signal),
      ]);
      if (signal?.aborted || !mounted.current) return;
      setConfig(nextConfig);
      setLatest(nextLatest);
      const latestJob = nextLatest.latest_job;
      setJob(latestJob ?? null);
    } catch (failure) {
      if (signal?.aborted || !mounted.current) return;
      setError(errorMessage(failure));
    } finally {
      if (!signal?.aborted && mounted.current) setLoading(false);
    }
  }, [attemptId]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  useEffect(() => {
    if (!job || !['queued', 'running'].includes(job.state)) return;
    let stopped = false;
    let timer = 0;
    const poll = async () => {
      try {
        const next = await getDiagnosisJob(job.job_id);
        if (stopped || !mounted.current) return;
        setJob(next);
        if (next.state === 'ready') {
          const report = await getLatestDiagnosis(attemptId);
          if (stopped || !mounted.current) return;
          setLatest(report);
        }
      } catch (failure) {
        if (!stopped && mounted.current) setError(errorMessage(failure));
      }
    };
    timer = window.setInterval(() => void poll(), 1600);
    void poll();
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [attemptId, job?.job_id, job?.state]);

  const loadCandidates = useCallback(async (signal?: AbortSignal) => {
    setCandidatesLoading(true);
    setCandidatesError('');
    try {
      const next = await getDiagnosisComparisonCandidates(attemptId, signal);
      if (signal?.aborted || !mounted.current) return null;
      setComparisonCandidates(next);
      return next;
    } catch (failure) {
      if (signal?.aborted || !mounted.current) return null;
      setCandidatesError(errorMessage(failure));
      return null;
    } finally {
      if (!signal?.aborted && mounted.current) setCandidatesLoading(false);
    }
  }, [attemptId]);

  const startJob = useCallback(async (request: () => Promise<DiagnosisJob>) => {
    setSubmitting(true);
    setError('');
    setDraftError('');
    try {
      const next = await request();
      setJob(next);
      return next;
    } catch (failure) {
      setError(errorMessage(failure));
      return null;
    } finally {
      setSubmitting(false);
    }
  }, []);

  const generate = useCallback(
    () => startJob(() => {
      const report = latest?.report;
      const pendingChange = baselineSelectionChanged(
        baselineChoice,
        report,
        comparisonCandidates,
      );
      if (report && !pendingChange) {
        return regenerateDiagnosis(report.job_id);
      }
      if (!report && job?.state === 'failed' && !pendingChange) {
        return regenerateDiagnosis(job.job_id);
      }
      return createDiagnosis(attemptId, baselineChoice);
    }),
    [
      attemptId,
      baselineChoice,
      comparisonCandidates,
      job?.job_id,
      job?.state,
      latest?.report,
      startJob,
    ],
  );
  const regenerate = useCallback(
    () => startJob(() => {
      if (!latest?.report) throw new Error('当前没有可重新生成的报告。');
      return regenerateDiagnosis(latest.report.job_id);
    }),
    [latest?.report, startJob],
  );

  const setBaselineChoice = useCallback((choice: DiagnosisComparisonChoice) => {
    setBaselineChoiceState(choice);
  }, []);

  const baselineChanged = baselineSelectionChanged(
    baselineChoice,
    latest?.report,
    comparisonCandidates,
  );

  const applyExperiment = useCallback(async (experimentId: string) => {
    if (!latest?.report) return null;
    setDraftError('');
    try {
      const next = await createDiagnosisDraft(latest.report.id, experimentId);
      setDraft(next);
      return next;
    } catch (failure) {
      setDraftError(errorMessage(failure));
      return null;
    }
  }, [latest?.report]);

  return {
    config,
    latest,
    job,
    loading,
    error,
    submitting,
    draft,
    draftError,
    reload: () => load(),
    comparisonCandidates,
    candidatesLoading,
    candidatesError,
    loadCandidates,
    baselineChoice,
    setBaselineChoice,
    baselineChanged,
    generate,
    regenerate,
    applyExperiment,
    clearDraft: () => setDraft(null),
    clearError: () => setError(''),
  };
}
