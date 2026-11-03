import {trainingState} from '../training-model';
import type {TrainingAttemptSummary} from '../types';

export function TrainingStatusBadge({
  attempt,
  compact = false,
}: {
  attempt: TrainingAttemptSummary;
  compact?: boolean;
}) {
  const state = trainingState(attempt.state);
  const waitingForCancel = attempt.cancel_requested
    && !['succeeded', 'failed', 'cancelled'].includes(attempt.state);
  return <span className={`training-status ${state.tone}${compact ? ' compact' : ''}`}>
    <i/>{state.label}
    {waitingForCancel ? ' · 取消等待确认' : ''}
  </span>;
}
