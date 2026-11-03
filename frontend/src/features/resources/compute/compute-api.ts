import { ApiError, api, json } from '../../../shared/http.ts';
import {
  normalizeConfiguration,
  normalizeEnvironment,
  normalizeEnvironmentCollection,
  type ComputeConfiguration,
  type ComputeEnvironment,
  type ComputeEnvironmentCollection,
} from './compute-model.ts';

export type ComputeRequest = <T>(path: string, options?: RequestInit) => Promise<T>;

export const computePaths = Object.freeze({
  configuration: '/resources/ucloud/configuration',
  environments: '/resources/compute/environments',
  environment: (id: string) => `/resources/compute/environments/${encodeURIComponent(id)}`,
  create: '/resources/compute/environments',
  start: (id: string) => `/resources/compute/environments/${encodeURIComponent(id)}/start`,
  stop: (id: string) => `/resources/compute/environments/${encodeURIComponent(id)}/stop`,
  delete: (id: string) => `/resources/compute/environments/${encodeURIComponent(id)}`,
});

export type ComputeOperationAccepted = Readonly<{
  accepted: true;
  state: 'accepted' | 'succeeded';
  operationId: string;
  environmentId: string | null;
  acceptedAt: string | null;
  message: string;
}>;

export type CreateComputeEnvironmentSpec = Readonly<{
  region: string;
  zone: string;
  gpu_type: string;
  cpu: number;
  memory_mb: number;
  image_id: string;
  image_name?: string;
  cpu_platform: string;
  charge_type: string;
  boot_disk_gb: number;
  boot_disk_type: string;
}>;

export type CreateComputeEnvironmentInput = Readonly<{
  name: string;
  resource_owner?: string;
  spec: CreateComputeEnvironmentSpec;
}>;

export type DeleteComputeEnvironmentOptions = Readonly<{
  acknowledgeDataLoss?: boolean;
  cleanupPolicy?: 'discard' | 'outputs_persisted';
  signal?: AbortSignal;
  requestId?: string;
}>;

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : {};
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function dateText(value: unknown): string | null {
  const candidate = text(value);
  return candidate && Number.isFinite(Date.parse(candidate)) ? candidate : null;
}

export function normalizeOperationAccepted(raw: unknown): ComputeOperationAccepted {
  const source = asRecord(raw);
  const command = asRecord(source.command);
  if (Object.keys(command).length) {
    const operationId = text(command.id);
    const commandState = text(command.state)?.toLowerCase();
    if (!operationId || (commandState !== 'accepted' && commandState !== 'succeeded')) {
      throw new ApiError(
        200,
        text(command.error_code) ?? 'operation_not_accepted',
        commandState === 'failed'
          ? '计算环境操作未成功，请查看错误并刷新状态。'
          : '计算环境操作响应无效，请刷新状态后再确认。',
      );
    }
    return {
      accepted: true,
      state: commandState,
      operationId,
      environmentId: text(asRecord(source.environment).id)
        ?? text(source.environment_id ?? source.environmentId),
      acceptedAt: dateText(command.updated_at ?? command.created_at),
      message: commandState === 'succeeded' ? '操作已完成，请刷新确认最终状态。' : '操作已受理，最终状态以刷新结果为准。',
    };
  }
  const operationId = text(source.operation_id ?? source.operationId);
  if (source.accepted !== true || !operationId) {
    throw new ApiError(
      200,
      'invalid_response',
      '计算环境操作响应无效，请刷新状态后再确认，避免重复提交。',
    );
  }
  return {
    accepted: true,
    state: 'accepted',
    operationId,
    environmentId: text(source.environment_id ?? source.environmentId),
    acceptedAt: dateText(source.accepted_at ?? source.acceptedAt),
    message: text(source.message) ?? '操作已受理，最终状态以刷新结果为准。',
  };
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function secureRequestId(): string {
  if (typeof globalThis.crypto?.randomUUID !== 'function') {
    throw new ApiError(0, 'secure_random_unavailable', '浏览器不支持安全请求 ID，未发送写操作。');
  }
  return globalThis.crypto.randomUUID();
}

export class ComputeApi {
  private readonly request: ComputeRequest;
  private readonly requestIdFactory: () => string;

  constructor(
    request: ComputeRequest = api,
    requestIdFactory: () => string = secureRequestId,
  ) {
    this.request = request;
    this.requestIdFactory = requestIdFactory;
  }

  async getConfiguration(signal?: AbortSignal): Promise<ComputeConfiguration> {
    const raw = await this.request<unknown>(
      computePaths.configuration,
      signal ? {signal} : {},
    );
    return normalizeConfiguration(raw);
  }

  async listEnvironments(signal?: AbortSignal): Promise<ComputeEnvironmentCollection> {
    const raw = await this.request<unknown>(
      computePaths.environments,
      signal ? {signal} : {},
    );
    return normalizeEnvironmentCollection(raw);
  }

  async getEnvironment(id: string, signal?: AbortSignal): Promise<ComputeEnvironment> {
    this.requireIdentifier(id);
    const raw = await this.request<unknown>(
      computePaths.environment(id),
      signal ? {signal} : {},
    );
    return normalizeEnvironment(raw);
  }

  async createEnvironment(
    input: CreateComputeEnvironmentInput,
    signal?: AbortSignal,
    requestId?: string,
  ): Promise<ComputeOperationAccepted> {
    return this.write(computePaths.create, {...input}, signal, requestId);
  }

  async startEnvironment(
    id: string,
    signal?: AbortSignal,
    requestId?: string,
  ): Promise<ComputeOperationAccepted> {
    this.requireIdentifier(id);
    return this.write(computePaths.start(id), {}, signal, requestId);
  }

  async stopEnvironment(
    id: string,
    signal?: AbortSignal,
    requestId?: string,
  ): Promise<ComputeOperationAccepted> {
    this.requireIdentifier(id);
    return this.write(computePaths.stop(id), {}, signal, requestId);
  }

  async deleteEnvironment(
    id: string,
    confirmName: string,
    options: DeleteComputeEnvironmentOptions | AbortSignal = {},
  ): Promise<ComputeOperationAccepted> {
    this.requireIdentifier(id);
    if (!confirmName.trim()) {
      throw new ApiError(0, 'confirmation_required', '请输入完整环境名称后再确认删除。');
    }
    const signal = options instanceof AbortSignal ? options : options.signal;
    const payload: Record<string, unknown> = {confirm_name: confirmName};
    if (!(options instanceof AbortSignal)) {
      if (options.acknowledgeDataLoss !== undefined) payload.acknowledge_data_loss = options.acknowledgeDataLoss;
      if (options.cleanupPolicy) payload.cleanup_policy = options.cleanupPolicy;
    }
    return this.write(
      computePaths.delete(id),
      payload,
      signal,
      options instanceof AbortSignal ? undefined : options.requestId,
      'DELETE',
    );
  }

  private requireIdentifier(id: string): void {
    if (!id.trim()) {
      throw new ApiError(0, 'environment_id_required', '缺少环境 ID，未发送写操作。');
    }
  }

  private nextRequestId(): string {
    const id = this.requestIdFactory();
    if (!uuidPattern.test(id)) {
      throw new ApiError(0, 'secure_random_unavailable', '无法生成有效请求 ID，未发送写操作。');
    }
    return id;
  }

  private async write(
    path: string,
    payload: Record<string, unknown>,
    signal?: AbortSignal,
    explicitRequestId?: string,
    method = 'POST',
  ): Promise<ComputeOperationAccepted> {
    if (explicitRequestId && !uuidPattern.test(explicitRequestId)) {
      throw new ApiError(
        0,
        'secure_random_unavailable',
        '请求 ID 无效，未发送写操作。',
      );
    }
    const requestId = explicitRequestId ?? this.nextRequestId();
    const raw = await this.request<unknown>(path, {
      ...json(method, payload),
      headers: {'Content-Type': 'application/json', 'Idempotency-Key': requestId},
      ...(signal ? {signal} : {}),
    });
    return normalizeOperationAccepted(raw);
  }
}

export const computeApi = new ComputeApi();

export function fetchComputeConfiguration(signal?: AbortSignal): Promise<ComputeConfiguration> {
  return computeApi.getConfiguration(signal);
}

export function fetchComputeEnvironments(signal?: AbortSignal): Promise<ComputeEnvironmentCollection> {
  return computeApi.listEnvironments(signal);
}

export function fetchComputeEnvironment(id: string, signal?: AbortSignal): Promise<ComputeEnvironment> {
  return computeApi.getEnvironment(id, signal);
}

export function createComputeEnvironment(
  input: CreateComputeEnvironmentInput,
  signal?: AbortSignal,
  requestId?: string,
): Promise<ComputeOperationAccepted> {
  return computeApi.createEnvironment(input, signal, requestId);
}

export function startComputeEnvironment(
  id: string,
  signal?: AbortSignal,
  requestId?: string,
): Promise<ComputeOperationAccepted> {
  return computeApi.startEnvironment(id, signal, requestId);
}

export function stopComputeEnvironment(
  id: string,
  signal?: AbortSignal,
  requestId?: string,
): Promise<ComputeOperationAccepted> {
  return computeApi.stopEnvironment(id, signal, requestId);
}

export function deleteComputeEnvironment(
  id: string,
  confirmName: string,
  options: DeleteComputeEnvironmentOptions | AbortSignal = {},
): Promise<ComputeOperationAccepted> {
  return computeApi.deleteEnvironment(id, confirmName, options);
}
