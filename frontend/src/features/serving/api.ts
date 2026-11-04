import {api, ApiError, json} from '../../shared/http';
import type {InstanceSpec} from '../resources';
import type {ServingTrial} from './types';

export function listServingTrials(signal?: AbortSignal): Promise<ServingTrial[]> {
  return api<ServingTrial[]>('/serving/trials', {signal});
}

export function getServingTrial(identifier: string, signal?: AbortSignal): Promise<ServingTrial> {
  return api<ServingTrial>('/serving/trials/' + encodeURIComponent(identifier), {signal});
}

export function createServingTrial(adapterId: string, instance: InstanceSpec): Promise<ServingTrial> {
  return api<ServingTrial>('/serving/trials', json('POST', {
    adapter_id: adapterId,
    instance,
  }));
}

export function bindServingInstance(
  identifier: string,
  instanceId: string,
  acknowledgeCleanup: boolean,
): Promise<ServingTrial> {
  return api<ServingTrial>('/serving/trials/' + encodeURIComponent(identifier) + '/instance', json('POST', {
    instance_id: instanceId,
    acknowledge_cleanup: acknowledgeCleanup,
  }));
}

export function stopServingTrial(identifier: string): Promise<ServingTrial> {
  return api<ServingTrial>('/serving/trials/' + encodeURIComponent(identifier) + '/stop', json('POST'));
}

export async function cancelServingRequest(identifier: string): Promise<ServingTrial> {
  return api<ServingTrial>('/serving/trials/' + encodeURIComponent(identifier) + '/cancel-request', json('POST'));
}

export type ServingChatInput = {
  messages: {role: 'user' | 'assistant' | 'system'; content: string}[];
  max_tokens: number;
  temperature: number;
  top_p: number;
};

export async function openServingChat(
  identifier: string,
  body: ServingChatInput,
  signal: AbortSignal,
): Promise<Response> {
  let response: Response;
  try {
    response = await fetch('/api/v1/serving/trials/' + encodeURIComponent(identifier) + '/chat', {
      ...json('POST', body),
      signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError(0, 'network_error', '流式连接中断，结果可能尚未确认。');
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => undefined) as {
      error?: {code?: string; message?: string; details?: unknown};
      request_id?: string;
    } | undefined;
    throw new ApiError(
      response.status,
      payload?.error?.code ?? 'http_error',
      payload?.error?.message ?? '服务暂时不能开始生成。',
      payload?.error?.details,
      payload?.request_id,
    );
  }
  if (!response.body) throw new ApiError(response.status, 'invalid_response', '流式响应不可用。');
  return response;
}
