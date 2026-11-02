import {api} from '../../shared/http.ts';

export type TrainingPreset = {
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

export type CompatibilityHardware = {
  region: string;
  zone: string;
  gpu_type: string;
  cpu: number;
  memory_mb: number;
  image_id: string;
  cpu_platform: 'Auto' | 'Intel/Auto' | 'Amd/Auto';
  charge_type: 'Month' | 'Day' | 'Postpay';
  boot_disk_gb: number;
  boot_disk_type: 'CLOUD_SSD' | 'CLOUD_RSSD';
  device_memory_bytes: number;
};

export type RuntimeBaseline = {
  id: string;
  sha256: string;
  status: 'partial' | 'complete';
  generated_at: string;
  model: {
    display_name: string;
    architecture: string;
    allowed_fingerprints: string[];
    max_model_len: number;
  };
  training: {
    runtime_lock_id: string;
    runtime_lock_sha256: string;
    hardware: CompatibilityHardware;
    verified_preset: TrainingPreset;
  };
  inference: {
    runtime_lock_id: string;
    runtime_lock_sha256: string;
    hardware: CompatibilityHardware;
    config: {lora_rank: number; max_model_len: number; template: string};
    gpu_memory_utilization: number;
    loaded_device_memory_bytes: number;
    conversation: {
      max_messages: number;
      max_content_chars_per_message: number;
      max_total_content_chars: number;
      max_tokens_default: number;
      max_tokens_limit: number;
    };
  };
  capacity: {
    dataset: Record<string, number | string | boolean>;
    model: Record<string, number | string | boolean>;
  };
  evidence: {
    training_attempt_id: string;
    training_exit_code: number;
    trained_steps: number;
    average_train_loss: number;
    eval_loss: number;
    adapter_best_id: string;
    adapter_best_fingerprint: string;
    adapter_final_id: string;
    adapter_final_fingerprint: string;
    inference_trial_id: string;
    training_peak_memory: 'pending' | 'measured';
    training_peak_attempt_id: string | null;
    training_peak_device_used_bytes: number | null;
    training_peak_torch_allocated_bytes: number | null;
    training_peak_torch_reserved_bytes: number | null;
    training_peak_sample_count: number | null;
    training_peak_sample_interval_ms: number | null;
    capacity_limits: 'protected_not_locked' | 'locked';
  };
  closure_gaps: string[];
  blocked_combinations: {code: string; reason: string}[];
};

export function getRuntimeBaseline(signal?: AbortSignal): Promise<RuntimeBaseline> {
  return api<RuntimeBaseline>('/runtime/baseline', {signal});
}
