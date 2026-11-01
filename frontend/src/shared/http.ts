export class ApiError extends Error {
  status: number;
  code: string;
  details?: unknown;
  requestId?: string;
  constructor(status: number, code: string, message: string, details?: unknown, requestId?: string) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
    this.requestId = requestId;
  }
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  let response: Response;
  try {response = await fetch('/api/v1' + path, {cache: 'no-store', ...options});}
  catch (error) {if (error instanceof DOMException && error.name === 'AbortError') throw error; throw new ApiError(0, 'network_error', '连接中断，结果可能尚未确认。请刷新版本状态后重试。');}
  const body = response.status === 204 ? undefined : await response.json().catch(() => undefined);
  if (!response.ok) throw new ApiError(response.status, body?.error?.code ?? 'http_error', body?.error?.message ?? '服务暂时无法响应，请重试。', body?.error?.details, body?.request_id);
  if (response.status !== 204 && body === undefined) throw new ApiError(response.status, 'invalid_response', '服务响应无效，请刷新后重试。');
  return body as T;
}

export function json(method: string, body?: unknown): RequestInit {return {method, headers: {'Content-Type': 'application/json'}, ...(body === undefined ? {} : {body: JSON.stringify(body)})};}
export type ComponentName = 'api' | 'postgres' | 'minio' | 'worker';
export type ComponentStatus = {state: 'up' | 'down'; checked_at: string; duration_ms: number; code: string; message: string};
export type PlatformStatus = {ready: boolean; checked_at: string; components: Record<ComponentName, ComponentStatus>};
export async function fetchStatus(signal: AbortSignal): Promise<PlatformStatus> {
  const response = await fetch('/api/v1/status', {signal, cache: 'no-store'});
  if (!response.ok) throw new Error('状态服务暂时无法响应');
  const data: unknown = await response.json();
  if (!data || typeof data !== 'object' || !('components' in data) || !('ready' in data) || typeof data.ready !== 'boolean') throw new Error('状态响应无效');
  const result = data as PlatformStatus;
  for (const name of ['api', 'postgres', 'minio', 'worker'] as const) {
    const item = result.components[name];
    if (!item || !['up', 'down'].includes(item.state) || typeof item.message !== 'string' || !Number.isFinite(Date.parse(item.checked_at))) throw new Error('状态响应不完整');
  }
  return result;
}
