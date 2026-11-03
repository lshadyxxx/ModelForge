import type {InstanceSpec} from '../resources';

export type TrainingAsset = {
  id?: string;
  version_id: string;
  name: string;
  state: string;
  version_number: number;
  manifest_sha256?: string;
  format_summary?: {model_type?: string} | null;
};

export type TrainingConfig = {
  epochs: number;
  learning_rate: number;
  cutoff_len: number;
  batch_size: number;
  gradient_accumulation: number;
  lora_rank: number;
  lora_alpha: number;
  lora_dropout: number;
  scheduler: string;
  warmup_ratio: number;
  template: string;
  seed: number;
};

export type TrainingSnapshot = {
  dataset: {
    id: string;
    sha256: string;
    split_sha256: string;
    sample_count?: number;
    [key: string]: unknown;
  };
  base: {
    id: string;
    fingerprint: string;
    source_kind?: string;
    format_summary?: {model_type?: string} | null;
    [key: string]: unknown;
  };
  config: TrainingConfig;
  instance: InstanceSpec;
  compatibility?: {
    baseline_id?: string;
    baseline_sha256?: string;
    model_fingerprint?: string;
    training_runtime_lock_id?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

export type TrainingMetric = {
  step?: number;
  epoch?: number;
  loss?: number;
  eval_loss?: number;
  learning_rate?: number;
};

export type TrainingMemory = {
  status?: string;
  sample_interval_ms?: number;
  sample_count?: number;
  device_peak_used_bytes?: number | null;
  torch_peak_memory_allocated_bytes?: number | null;
  torch_peak_memory_reserved_bytes?: number | null;
  sampler_error?: string | null;
};

export type RuntimeReport = {
  phase?: string;
  ready?: boolean;
  lock_id?: string;
  lock_sha256?: string;
  gpu?: string;
  memory_bytes?: number;
  python?: string;
  cuda?: string;
  template?: string;
  versions?: Record<string, string>;
  training_memory?: TrainingMemory;
  mismatches?: Array<{field?: string; expected?: unknown; actual?: unknown}>;
  [key: string]: unknown;
};

export type ExecutionManifest = {
  diagnostic_gap?: boolean;
  code?: string;
  bucket?: string;
  files?: Array<{
    path: string;
    size?: number;
    sha256?: string;
    object_key?: string;
  }>;
};

export type TrainingAttemptSummary = {
  id: string;
  task_id: string;
  number: number;
  name: string;
  state: string;
  stage: string;
  cancel_requested: boolean;
  lease_id?: string | null;
  instance_id?: string | null;
  outcome?: string | null;
  exit_code?: number | null;
  error_code?: string | null;
  metrics?: TrainingMetric[] | null;
  runtime_report?: RuntimeReport | null;
  token_preflight?: {
    samples?: Array<{split?: string; source_line?: number; tokens?: number}>;
    overflow?: unknown[];
  } | null;
  execution_manifest?: ExecutionManifest | null;
  log_offset?: number;
  snapshot_sha256?: string;
  created_at: string;
  updated_at: string;
};

export type TrainingAttempt = TrainingAttemptSummary & {
  snapshot: TrainingSnapshot;
};

export type LogChunk = {
  offset_bytes: number;
  next_offset: number;
  content: string;
  gap: boolean;
};

export type TrainingTab = 'overview' | 'analysis' | 'logs' | 'artifacts' | 'config';

export type TrainingRoute = {
  legacy: boolean;
  create: boolean;
  attemptId: string;
  tab: TrainingTab;
};
