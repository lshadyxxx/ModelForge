import {api, json} from '../../shared/http';
import type {LogChunk, TrainingAttempt, TrainingAttemptSummary, TrainingConfig} from './types';

export type TrainingPayload = {
  name: string;
  dataset_version_id: string;
  base_model_version_id: string;
  config: TrainingConfig;
  instance: TrainingAttempt['snapshot']['instance'];
};

export function listTrainingAttempts(signal?: AbortSignal) {
  return api<TrainingAttemptSummary[]>('/training/attempts', {signal});
}

export function getTrainingAttempt(identifier: string, signal?: AbortSignal) {
  return api<TrainingAttempt>('/training/attempts/' + encodeURIComponent(identifier), {signal});
}

export async function listTrainingLogs(identifier: string, signal?: AbortSignal) {
  const result: LogChunk[] = [];
  let offset = 0;
  for (let page = 0; page < 100; page += 1) {
    const chunk = await api<LogChunk[]>(
      '/training/attempts/' + encodeURIComponent(identifier) + '/logs?offset=' + offset,
      {signal},
    );
    result.push(...chunk);
    if (chunk.length < 100) break;
    const next = chunk[chunk.length - 1]?.next_offset;
    if (!Number.isFinite(next) || Number(next) <= offset) break;
    offset = Number(next);
  }
  return result;
}

export function createTrainingAttempt(payload: TrainingPayload, signal?: AbortSignal) {
  return api<TrainingAttempt>('/training/tasks', {...json('POST', payload), signal});
}

export function bindTrainingInstance(
  identifier: string,
  instanceId: string,
  acknowledgeCleanup: boolean,
  signal?: AbortSignal,
) {
  return api<TrainingAttempt>(
    '/training/attempts/' + encodeURIComponent(identifier) + '/instance',
    {
      ...json('POST', {
        instance_id: instanceId,
        acknowledge_cleanup: acknowledgeCleanup,
      }),
      signal,
    },
  );
}

export function cancelTrainingAttempt(identifier: string, signal?: AbortSignal) {
  return api<TrainingAttempt>(
    '/training/attempts/' + encodeURIComponent(identifier) + '/cancel',
    {...json('POST'), signal},
  );
}

export function retryTrainingAttempt(identifier: string, signal?: AbortSignal) {
  return api<TrainingAttempt>(
    '/training/attempts/' + encodeURIComponent(identifier) + '/retry',
    {...json('POST'), signal},
  );
}
