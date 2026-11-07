import type {InstanceSpec} from '../resources';

export type TrainingExecutionMode = 'managed' | 'manual';

export type TrainingImageProfile = {
  id: string;
  provider_profile: string;
  label: string;
  description: string;
  image_id: string | null;
  image_group_id: string | null;
  image_type: 'System' | 'App' | 'Custom' | 'Community';
  runtime_source: 'cold_install' | 'prebuilt';
  status: 'available' | 'not_published' | 'blocked';
  evidence: string;
};

export type TrainingImageCatalog = {
  schema: number;
  id: string;
  sha256: string;
  baseline_id: string;
  baseline_sha256: string;
  profiles: TrainingImageProfile[];
};

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
  execution_mode?: TrainingExecutionMode;
  training_image_profile?: {
    id?: string;
    provider_profile?: string;
    image_id?: string | null;
    image_group_id?: string | null;
    image_type?: string;
    runtime_source?: string;
    profiles_sha256?: string;
  } | null;
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

export type TrainingProvisioning = {
  attempt_id: string;
  provider_profile: string;
  training_image_profile_id: string;
  training_image_profile_sha256: string;
  image_id: string | null;
  image_group_id: string | null;
  project_id: string;
  request_fingerprint: string;
  request_disposition: string;
  provider_state: string;
  provider_observed_at?: string | null;
  cost_guard_state: string;
  cost_guard_deadline?: string | null;
  cost_guard_set_at?: string | null;
  credential_state: string;
  bootstrap_profile: string;
  host_key_fingerprint?: string | null;
  endpoint_epoch?: number | null;
  runtime_state: string;
  artifact_state: string;
  artifact_verified_at?: string | null;
  last_error_code?: string | null;
  created_at?: string;
  updated_at?: string;
};

export type TrainingRemoteJob = {
  attempt_id: string;
  instance_id: string;
  launch_state: string;
  remote_dir: string;
  argv_hash: string;
  input_manifest_hash: string;
  requested_at?: string | null;
  observed_at?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
  exit_code?: number | null;
  cancelled?: boolean | null;
  group_exited?: boolean | null;
};

export type TrainingAttemptSummary = {
  id: string;
  task_id: string;
  number: number;
  execution_mode?: TrainingExecutionMode;
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
  provisioning?: TrainingProvisioning | null;
  remote_job?: TrainingRemoteJob | null;
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

export type TrainingTab =
  | 'overview'
  | 'analysis'
  | 'diagnosis'
  | 'logs'
  | 'artifacts'
  | 'config';

export type DiagnosisCoverageStatus =
  | 'available'
  | 'missing'
  | 'not_reached'
  | 'not_applicable'
  | 'conflict'
  | 'unavailable';

export type DiagnosisEvidenceRef = {
  id: string;
  kind: string;
  source_locator: string;
  field_path?: string | null;
  observed_at?: string | null;
  source_version?: string | null;
  source_digest?: string | null;
  excerpt?: string | null;
  coverage: DiagnosisCoverageStatus;
  unavailable_reason?: string | null;
};

export type DiagnosisCoverage = {
  category: string;
  status: DiagnosisCoverageStatus;
  reason?: string | null;
  evidence_ids: string[];
};

export type DiagnosisEvidencePack = {
  schema_version: string;
  attempt_id: string;
  evidence_cutoff_at: string;
  attempt_state: string;
  source_revision: {
    attempt_updated_at: string;
    snapshot_sha256: string;
    metrics_digest?: string | null;
    runtime_digest?: string | null;
    manifest_digest?: string | null;
    adapter_revision?: string | null;
    inference_revision?: string | null;
  };
  coverage: DiagnosisCoverage[];
  evidence: DiagnosisEvidenceRef[];
  facts: Record<string, unknown>;
  conflicts: Array<{
    code: string;
    description: string;
    blocking: boolean;
  }>;
  canonical_digest: string;
};

export type DiagnosisClaim = {
  id: string;
  layer: 'observation' | 'inference' | 'recommendation' | 'limitation';
  text: string;
  evidence_ids: string[];
  basis_claim_ids: string[];
  confidence: 'high' | 'medium' | 'low';
  limitations: string[];
};

export type DiagnosisFinding = {
  id: string;
  category:
    | 'loss_eval'
    | 'runtime'
    | 'token'
    | 'memory'
    | 'artifact'
    | 'failure'
    | 'coverage';
  severity: 'blocked' | 'attention' | 'passed' | 'info';
  epistemic_status: 'observed' | 'inferred' | 'unknown';
  title: string;
  observation: DiagnosisClaim;
  inference?: DiagnosisClaim | null;
  recommendation?: DiagnosisClaim | null;
  evidence_ids: string[];
};

export type DiagnosisNextExperiment = {
  id: string;
  priority: 'P0' | 'P1' | 'P2';
  title: string;
  hypothesis: string;
  evidence_ids: string[];
  preconditions: string[];
  config_patch?: Record<string, unknown> | null;
  draft_only: true;
};

export type DiagnosisReport = {
  schema_version: string;
  id: string;
  job_id: string;
  attempt_id: string;
  version: number;
  report_mode: 'full' | 'limited';
  freshness: 'current' | 'stale';
  integrity: 'consistent' | 'conflict';
  health: {
    status: 'healthy' | 'attention' | 'blocked' | 'partial' | 'unknown';
    label: string;
    rationale: string;
    evidence_ids: string[];
  };
  delivery: {
    status:
      | 'not_deliverable'
      | 'artifact_deliverable_model_unverified'
      | 'ready_for_release_review'
      | 'unknown';
    label: string;
    rationale: string;
    evidence_ids: string[];
  };
  summary: string;
  claims: DiagnosisClaim[];
  findings: DiagnosisFinding[];
  limitations: Array<{
    code: string;
    text: string;
    affected_axis?: 'health' | 'delivery' | null;
    evidence_ids: string[];
  }>;
  next_experiments: DiagnosisNextExperiment[];
  source_revision: DiagnosisEvidencePack['source_revision'];
  policy_version: string;
  graph_version: string;
  prompt_version: string;
  generator_version: string;
  model_name: string;
  input_digest: string;
  report_digest: string;
  generated_at: string;
  published_at: string;
};

export type DiagnosisJob = {
  job_id: string;
  attempt_id: string;
  state: 'queued' | 'running' | 'ready' | 'failed';
  error_code?: string | null;
  created_at: string;
  started_at?: string | null;
  finished_at?: string | null;
  latest_report_id?: string | null;
  report_version?: number | null;
  usage?: {
    schema: string;
    model_calls: number;
    reported_calls: number;
    unreported_calls: number;
    prompt_tokens?: number | null;
    completion_tokens?: number | null;
    total_tokens?: number | null;
    latency_ms: number;
    cost_estimate?: number | null;
    cost_note: string;
  } | null;
  created?: boolean;
};

export type DiagnosisLatest = {
  report: DiagnosisReport | null;
  state: 'absent' | 'ready';
  latest_job?: DiagnosisJob | null;
  evidence?: DiagnosisEvidencePack | null;
  evidence_digest?: string | null;
  created_at?: string | null;
};

export type DiagnosisConfig = {
  enabled: boolean;
  model_configured: boolean;
  scope: 'terminal_attempt_only';
  trigger: 'manual';
  ai_role: 'advisory_diagnosis_not_gate';
};

export type DiagnosisDraft = {
  status: 'unsubmitted_draft';
  report_id: string;
  attempt_id: string;
  experiment_id: string;
  base_attempt_config: TrainingConfig;
  config_patch: Record<string, unknown>;
  draft_config: TrainingConfig;
  notice: string;
};

export type TrainingRoute = {
  legacy: boolean;
  create: boolean;
  attemptId: string;
  tab: TrainingTab;
};
