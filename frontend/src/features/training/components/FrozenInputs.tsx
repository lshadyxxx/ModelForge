import {formatDateTime} from '../training-model';
import type {TrainingAttempt} from '../types';
import {CopyValue} from './CopyValue';
import {TrainingIcon} from './TrainingIcon';

function InputSection({
  title,
  kicker,
  children,
}: {
  title: string;
  kicker: string;
  children: React.ReactNode;
}) {
  return <section className="training-frozen-section">
    <header><span className="training-kicker">{kicker}</span><h2>{title}</h2></header>
    {children}
  </section>;
}

function ValueRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return <div className="training-frozen-row"><dt>{label}</dt><dd>{children}</dd></div>;
}

export function FrozenInputs({attempt}: {attempt: TrainingAttempt}) {
  const {snapshot} = attempt;
  const config = snapshot.config;
  const instance = snapshot.instance;
  const compatibility = snapshot.compatibility;
  return <div className="training-frozen-page">
    <section className="training-frozen-heading">
      <div><span className="training-kicker">IMMUTABLE ATTEMPT INPUT</span><h2>冻结输入与运行参数</h2><p>这是提交时写入 Attempt 快照的身份和参数。重试会创建新的 Attempt，而不是修改这一份记录。</p></div>
      <span className="training-frozen-time"><TrainingIcon name="lock" size={15}/>创建于 {formatDateTime(attempt.created_at)}</span>
    </section>

    <div className="training-frozen-grid">
      <InputSection title="数据集版本" kicker="DATASET">
        <dl>
          <ValueRow label="版本 ID"><CopyValue value={snapshot.dataset.id} label="数据集版本 ID"/></ValueRow>
          <ValueRow label="内容 SHA-256"><CopyValue value={snapshot.dataset.sha256} label="数据集内容 SHA-256"/></ValueRow>
          <ValueRow label="拆分 SHA-256"><CopyValue value={snapshot.dataset.split_sha256} label="数据集拆分 SHA-256"/></ValueRow>
          <ValueRow label="样本数">{snapshot.dataset.sample_count ?? '未载入'}</ValueRow>
        </dl>
      </InputSection>

      <InputSection title="基座模型" kicker="BASE MODEL">
        <dl>
          <ValueRow label="版本 ID"><CopyValue value={snapshot.base.id} label="基座模型版本 ID"/></ValueRow>
          <ValueRow label="内容指纹"><CopyValue value={snapshot.base.fingerprint} label="基座模型内容指纹"/></ValueRow>
          <ValueRow label="架构">{snapshot.base.format_summary?.model_type || '架构未标注'}</ValueRow>
          <ValueRow label="来源类型">{snapshot.base.source_kind || '未标注'}</ValueRow>
        </dl>
      </InputSection>
    </div>

    <InputSection title="训练参数" kicker="TRAINING CONFIG">
      <dl className="training-frozen-config">
        <ValueRow label="Epochs"><code>{config.epochs}</code></ValueRow>
        <ValueRow label="Learning Rate"><code>{config.learning_rate}</code></ValueRow>
        <ValueRow label="Cutoff Length"><code>{config.cutoff_len}</code></ValueRow>
        <ValueRow label="Batch Size"><code>{config.batch_size}</code></ValueRow>
        <ValueRow label="Gradient Accumulation"><code>{config.gradient_accumulation}</code></ValueRow>
        <ValueRow label="LoRA Rank"><code>{config.lora_rank}</code></ValueRow>
        <ValueRow label="LoRA Alpha"><code>{config.lora_alpha}</code></ValueRow>
        <ValueRow label="LoRA Dropout"><code>{config.lora_dropout}</code></ValueRow>
        <ValueRow label="Scheduler"><code>{config.scheduler}</code></ValueRow>
        <ValueRow label="Warmup Ratio"><code>{config.warmup_ratio}</code></ValueRow>
        <ValueRow label="Template"><code>{config.template}</code></ValueRow>
        <ValueRow label="Seed"><code>{config.seed}</code></ValueRow>
      </dl>
    </InputSection>

    <div className="training-frozen-grid">
      <InputSection title="计算实例要求" kicker="COMPUTE REQUEST">
        <dl>
          <ValueRow label="地域 / 可用区"><code>{instance.region || '—'} / {instance.zone || '—'}</code></ValueRow>
          <ValueRow label="GPU">{instance.gpu_type || '—'}</ValueRow>
          <ValueRow label="CPU / 内存">{instance.cpu || '—'} 核 / {instance.memory_mb ? `${instance.memory_mb / 1024} GiB` : '—'}</ValueRow>
          <ValueRow label="CPU 平台">{instance.cpu_platform || '—'}</ValueRow>
          <ValueRow label="运行镜像"><CopyValue value={instance.image_id} label="运行镜像 ID"/></ValueRow>
          <ValueRow label="系统盘">{instance.boot_disk_gb || '—'} GB · {instance.boot_disk_type || '—'}</ValueRow>
          <ValueRow label="计费方式">{instance.charge_type || '—'}</ValueRow>
        </dl>
      </InputSection>

      <InputSection title="兼容基线" kicker="COMPATIBILITY">
        {compatibility ? <dl>
          <ValueRow label="Baseline ID"><CopyValue value={compatibility.baseline_id} label="兼容基线 ID"/></ValueRow>
          <ValueRow label="Baseline SHA-256"><CopyValue value={compatibility.baseline_sha256} label="兼容基线 SHA-256"/></ValueRow>
          <ValueRow label="模型指纹"><CopyValue value={compatibility.model_fingerprint} label="兼容基线模型指纹"/></ValueRow>
          <ValueRow label="Runtime Lock"><CopyValue value={compatibility.training_runtime_lock_id} label="训练运行时锁 ID"/></ValueRow>
        </dl> : <div className="training-frozen-empty"><TrainingIcon name="info" size={16}/><p>该 Attempt 没有返回结构化兼容基线字段；请以下方原始快照为准。</p></div>}
      </InputSection>
    </div>

    <details className="training-frozen-raw">
      <summary>查看完整原始 snapshot JSON</summary>
      <pre>{JSON.stringify(snapshot, null, 2)}</pre>
    </details>
  </div>;
}
