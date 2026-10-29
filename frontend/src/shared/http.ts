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
