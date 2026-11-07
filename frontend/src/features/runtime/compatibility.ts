import type {RuntimeBaseline, TrainingPreset} from './api.ts';

type ModelLike = {
  manifest_sha256?: string;
  fingerprint?: string;
  format_summary?: {model_type?: string} | null;
};

type AdapterLike = {
  id?: string;
  fingerprint?: string;
  snapshot?: {
    base?: {fingerprint?: string};
    config?: {template?: string; cutoff_len?: number; lora_rank?: number};
    compatibility?: {baseline_id?: string; baseline_sha256?: string; model_fingerprint?: string};
  };
};

const TRAINING_TEMPLATE_BY_ARCHITECTURE: Record<string, string> = {
  qwen3: 'qwen3_nothink',
  qwen2: 'qwen',
  qwen: 'qwen',
  llama: 'llama3',
  llama3: 'llama3',
  mistral: 'mistral',
};

export function trainingTemplateForModel(asset: ModelLike): string | null {
  return TRAINING_TEMPLATE_BY_ARCHITECTURE[asset.format_summary?.model_type ?? ''] ?? null;
}

export function trainingModelGuidance(
  asset: ModelLike,
  baseline: RuntimeBaseline | null,
): {blocking: string; warning: string} {
  if (!baseline) return {blocking: '兼容基线尚未载入', warning: ''};
  const architecture = asset.format_summary?.model_type;
  if (!architecture) return {blocking: '模型缺少可识别的架构信息', warning: ''};
  const template = trainingTemplateForModel(asset);
  if (!template) return {blocking: `当前训练运行时没有 ${architecture} 架构的模板映射`, warning: ''};
  const fingerprint = asset.manifest_sha256 ?? asset.fingerprint;
  if (!fingerprint) return {blocking: '模型缺少完整内容指纹', warning: ''};
  if (!baseline.model.allowed_fingerprints.includes(fingerprint)) {
    return {
      blocking: '',
      warning: `可进入训练；该模型尚未列入实测基线，使用 ${template} 模板，产物需要重新完成推理验收。`,
    };
  }
  return {blocking: '', warning: ''};
}

export function modelCompatibilityReason(asset: ModelLike, baseline: RuntimeBaseline | null): string | null {
  if (!baseline) return '兼容基线尚未载入';
  const architecture = asset.format_summary?.model_type;
  if (architecture !== baseline.model.architecture) return `仅支持 ${baseline.model.architecture} 架构`;
  const fingerprint = asset.manifest_sha256 ?? asset.fingerprint;
  if (!fingerprint || !baseline.model.allowed_fingerprints.includes(fingerprint)) return '模型完整内容指纹未列入兼容基线';
  return null;
}

export function adapterCompatibilityReason(asset: AdapterLike, baseline: RuntimeBaseline | null): string | null {
  if (!baseline) return '兼容基线尚未载入';
  const snapshot = asset.snapshot;
  const fingerprint = snapshot?.base?.fingerprint;
  if (!fingerprint || !baseline.model.allowed_fingerprints.includes(fingerprint)) return 'Adapter 绑定的基座不在兼容基线中';
  const config = snapshot?.config;
  if (config?.template !== baseline.inference.config.template
    || config?.cutoff_len !== baseline.inference.config.max_model_len
    || config?.lora_rank !== baseline.inference.config.lora_rank) return 'Adapter 训练参数与已实测推理预设不一致';
  if (snapshot?.compatibility) {
    if (snapshot.compatibility.baseline_id !== baseline.id
      || snapshot.compatibility.baseline_sha256 !== baseline.sha256
      || snapshot.compatibility.model_fingerprint !== fingerprint) return 'Adapter 绑定的是旧版兼容基线';
  } else {
    const legacy = new Map([
      [baseline.evidence.adapter_best_id, baseline.evidence.adapter_best_fingerprint],
      [baseline.evidence.adapter_final_id, baseline.evidence.adapter_final_fingerprint],
    ]);
    if (!asset.id || !asset.fingerprint || legacy.get(asset.id) !== asset.fingerprint) {
      return 'Adapter 没有绑定当前兼容基线，需重新验证';
    }
  }
  return null;
}

export function trainingPresetFromBaseline<T extends TrainingPreset>(current: T, baseline: RuntimeBaseline | null): T {
  return baseline ? {...current, ...baseline.training.verified_preset} : current;
}
