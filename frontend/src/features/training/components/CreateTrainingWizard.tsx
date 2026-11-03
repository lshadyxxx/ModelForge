import {useEffect, useRef, useState} from 'react';
import {api} from '../../../shared/http';
import {
  emptyInstance,
  InstanceFields,
  ManualInstanceDialog,
  type InstanceSpec,
} from '../../resources';
import {
  getRuntimeBaseline,
  modelCompatibilityReason,
  trainingPresetFromBaseline,
  type RuntimeBaseline,
} from '../../runtime';
import {createTrainingAttempt, getTrainingAttempt, type TrainingPayload} from '../api';
import {clearTrainingReuseAttempt, readTrainingReuseAttempt} from '../reuse';
import {
  formatMetric,
  shortId,
} from '../training-model';
import type {TrainingAsset, TrainingAttempt, TrainingConfig, TrainingSnapshot} from '../types';
import {TrainingIcon} from './TrainingIcon';

const initialConfig: TrainingConfig = {
  epochs: 1,
  learning_rate: 0.0002,
  cutoff_len: 512,
  batch_size: 1,
  gradient_accumulation: 1,
  lora_rank: 8,
  lora_alpha: 16,
  lora_dropout: 0,
  scheduler: 'cosine',
  warmup_ratio: 0,
  template: 'qwen3_nothink',
  seed: 42,
};

const stepLabels = ['选择输入', '计算环境', '训练参数', '确认提交'];

type Errors = Record<string, string>;

function errorId(name: string) {
  return 'training-error-' + name;
}

function fieldProps(errors: Errors, name: string) {
  return errors[name]
    ? {'aria-invalid': true, 'aria-describedby': errorId(name)}
    : {};
}

const instanceFieldNames = new Set([
  'region',
  'zone',
  'gpu_type',
  'cpu',
  'image_id',
  'boot_disk_gb',
  'boot_disk_type',
  'charge_type',
]);

function errorAnchor(name: string) {
  if (instanceFieldNames.has(name)) return '#training-instance-fieldset';
  return '#training-field-' + name;
}

function FieldError({errors, name}: {errors: Errors; name: string}) {
  return errors[name] ? <span className="training-field-error" id={errorId(name)}>{errors[name]}</span> : null;
}

function formatInstance(instance: InstanceSpec) {
  return `${instance.gpu_type || 'GPU 未选择'} · ${instance.cpu || '—'} 核 / ${instance.memory_mb ? instance.memory_mb / 1024 + ' GiB' : '—'} · ${instance.region || '—'} / ${instance.zone || '—'}`;
}

function validateInstance(instance: InstanceSpec): Errors {
  const errors: Errors = {};
  if (!instance.region) errors.region = '请选择地域。';
  if (!instance.zone) errors.zone = '请选择可用区。';
  if (!instance.gpu_type) errors.gpu_type = '请选择单卡 GPU 规格。';
  if (!instance.cpu || !instance.memory_mb) errors.cpu = '请选择 CPU / 内存组合。';
  if (!instance.image_id) errors.image_id = '请选择运行镜像。';
  if (!Number.isFinite(instance.boot_disk_gb) || instance.boot_disk_gb < 1) errors.boot_disk_gb = '系统盘必须大于 0 GB。';
  if (!instance.boot_disk_type) errors.boot_disk_type = '请选择系统盘类型。';
  if (!instance.charge_type) errors.charge_type = '请选择计费方式。';
  return errors;
}

function validateConfig(config: TrainingConfig): Errors {
  const errors: Errors = {};
  if (!Number.isFinite(config.seed) || config.seed < 0 || config.seed > 2147483647) errors.seed = '随机种子必须在 0 到 2147483647 之间。';
  if (!Number.isFinite(config.epochs) || config.epochs < 1) errors.epochs = '训练轮数必须大于等于 1。';
  if (!Number.isFinite(config.learning_rate) || config.learning_rate <= 0) errors.learning_rate = '学习率必须大于 0。';
  return errors;
}

export function CreateTrainingWizard({
  onCancel,
  onCreated,
}: {
  onCancel: () => void;
  onCreated: (attempt: TrainingAttempt) => void;
}) {
  const [step, setStep] = useState(1);
  const [name, setName] = useState('');
  const [dataset, setDataset] = useState('');
  const [model, setModel] = useState('');
  const [config, setConfig] = useState<TrainingConfig>(initialConfig);
  const [instance, setInstance] = useState<InstanceSpec>(emptyInstance);
  const [datasets, setDatasets] = useState<TrainingAsset[]>([]);
  const [models, setModels] = useState<TrainingAsset[]>([]);
  const [runtime, setRuntime] = useState<RuntimeBaseline | null>(null);
  const [assetsLoading, setAssetsLoading] = useState(true);
  const [assetsError, setAssetsError] = useState('');
  const [reuseNotice, setReuseNotice] = useState('');
  const [reusedSnapshot, setReusedSnapshot] = useState<TrainingSnapshot | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [showErrors, setShowErrors] = useState(false);
  const [confirmInstance, setConfirmInstance] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const summaryRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    const reuseAttemptId = readTrainingReuseAttempt();
    setAssetsLoading(true);
    setAssetsError('');
    Promise.all([
      api<TrainingAsset[]>('/datasets', {signal: controller.signal}),
      api<TrainingAsset[]>('/models', {signal: controller.signal}),
      getRuntimeBaseline(controller.signal),
      reuseAttemptId ? getTrainingAttempt(reuseAttemptId, controller.signal) : Promise.resolve(null),
    ]).then(([datasetRows, modelRows, baseline, reused]) => {
      const published = datasetRows.filter((row) => row.state === 'published');
      const available = modelRows
        .filter((row) => row.state === 'available')
        .map((row) => ({...row, version_id: row.id ?? row.version_id}));
      setDatasets(published);
      setModels(available);
      setRuntime(baseline);
      if (reused) {
        setStep(4);
        setName((reused.name + ' · 配置复用').slice(0, 160));
        setDataset(reused.snapshot.dataset.id);
        setModel(reused.snapshot.base.id);
        setConfig(reused.snapshot.config);
        setInstance(reused.snapshot.instance);
        setReusedSnapshot(reused.snapshot);
        setReuseNotice(`已载入 Attempt #${reused.number} 的数据集、基座、训练参数和实例规格。`);
        clearTrainingReuseAttempt(reuseAttemptId);
      } else {
        setConfig((current) => trainingPresetFromBaseline(current, baseline));
      }
    }).catch((error) => {
      if (!controller.signal.aborted) setAssetsError(error instanceof Error ? error.message : String(error));
    }).finally(() => {
      if (!controller.signal.aborted) setAssetsLoading(false);
    });
    return () => controller.abort();
  }, [reloadKey]);

  const selectedDataset = datasets.find((row) => row.version_id === dataset);
  const selectedModel = models.find((row) => row.version_id === model);
  const modelReason = selectedModel && runtime ? modelCompatibilityReason(selectedModel, runtime) : '';
  const stepErrorMap: Errors = step === 1
    ? {
        ...(name.trim() ? {} : {name: '请填写任务名称，再继续下一步。'}),
        ...(dataset ? {} : {dataset: '请选择已发布的数据版本。'}),
        ...(model ? {} : {model: '请选择已验证的基础模型。'}),
        ...(model && modelReason ? {model: modelReason} : {}),
      }
    : step === 2
      ? validateInstance(instance)
      : step === 3
        ? validateConfig(config)
        : {};
  const errors = showErrors ? stepErrorMap : {};
  const allErrors = Object.values(errors);

  useEffect(() => {
    if (showErrors && allErrors.length) summaryRef.current?.focus();
  }, [allErrors.length, showErrors, step]);

  function goNext() {
    if (assetsError || !runtime) {
      setActionError(assetsError || '运行基线尚未载入，暂时不能提交训练。');
      return;
    }
    if (Object.keys(stepErrorMap).length) {
      setShowErrors(true);
      return;
    }
    setShowErrors(false);
    setActionError('');
    setStep((current) => Math.min(4, current + 1));
    window.scrollTo({top: 0, behavior: 'smooth'});
  }

  function goBack() {
    if (step === 1) {
      onCancel();
      return;
    }
    setShowErrors(false);
    setStep((current) => Math.max(1, current - 1));
    window.scrollTo({top: 0, behavior: 'smooth'});
  }

  async function submit() {
    setConfirmInstance(false);
    setBusy(true);
    setActionError('');
    const payload: TrainingPayload = {
      name: name.trim(),
      dataset_version_id: dataset,
      base_model_version_id: model,
      config,
      instance,
    };
    try {
      const attempt = await createTrainingAttempt(payload);
      onCreated(attempt);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  return <div className="training-page-shell training-create-page">
    <header className="training-create-heading">
      <button type="button" className="training-back" onClick={onCancel}><TrainingIcon name="back" size={16}/>训练工作台</button>
      <div><span className="training-eyebrow">NEW TRAINING / IMMUTABLE INPUT</span><h1>新建训练任务</h1><p>冻结数据版本、基座、训练参数和单 GPU 实例要求。提交不会自动购买云资源。</p></div>
    </header>
    <section className="training-create-panel">
      <ol className="training-create-steps" aria-label="新建训练步骤">
        {stepLabels.map((label, index) => {
          const number = index + 1;
          return <li key={label} className={step === number ? 'active' : step > number ? 'done' : ''} aria-current={step === number ? 'step' : undefined}>
            <span>{step > number ? <TrainingIcon name="check" size={12}/> : number}</span><div><b>{label}</b><small>0{number} / 04</small></div>
          </li>;
        })}
      </ol>
      {reuseNotice && <div className="training-inline-success" role="status"><TrainingIcon name="check" size={16}/>{reuseNotice}</div>}
      {assetsError && <div className="training-notice danger" role="alert">
        <TrainingIcon name="alert" size={18}/>
        <div><strong>无法载入训练输入</strong><p>{assetsError}</p></div>
        <button type="button" className="quiet" onClick={() => setReloadKey((value) => value + 1)}>重新读取</button>
      </div>}
      {actionError && <div className="training-notice danger" role="alert"><TrainingIcon name="alert" size={18}/><div><strong>当前操作未完成</strong><p>{actionError}</p></div></div>}
      {assetsLoading && !assetsError && <div className="training-inline-loading" role="status"><span/><div><strong>正在读取训练输入</strong><p>核对已发布数据集、可用模型和当前训练兼容基线。</p></div></div>}
      <form noValidate onSubmit={(event) => {event.preventDefault(); if (step < 4) goNext(); else setConfirmInstance(true);}}>
        {showErrors && allErrors.length > 0 && <div className="training-form-errors" role="alert" tabIndex={-1} ref={summaryRef}>
          <TrainingIcon name="alert" size={18}/>
          <div><strong>还有 {allErrors.length} 项需要处理</strong><ul>{Object.entries(errors).map(([key, message]) => <li key={key}><a href={errorAnchor(key)}>{message}</a></li>)}</ul></div>
        </div>}
        {step === 1 && <div className="training-step-panel">
          <div className="training-step-heading"><span>01</span><div><h2>任务与冻结输入</h2><p>任务名称只用于识别；数据版本和基座会在提交时固化身份与内容指纹。</p></div></div>
          <div className="training-form-grid">
            <label className="span-two" id="training-field-name">
              <span>任务名称 <b>必填</b></span>
              <input {...fieldProps(errors, 'name')} value={name} maxLength={160} onChange={(event) => setName(event.target.value)} placeholder="例如：客服意图分类 LoRA r2"/>
              <FieldError errors={errors} name="name"/>
            </label>
            <label id="training-field-dataset">
              <span>已发布数据版本 <b>必填</b></span>
              <select {...fieldProps(errors, 'dataset')} value={dataset} onChange={(event) => setDataset(event.target.value)}>
                <option value="">选择数据集版本</option>
                {datasets.map((row) => <option key={row.version_id} value={row.version_id}>{row.name} · v{row.version_number}</option>)}
              </select>
              <FieldError errors={errors} name="dataset"/>
              {selectedDataset && <small>{shortId(selectedDataset.version_id)} · 内容 {shortId(selectedDataset.manifest_sha256, 12)}</small>}
            </label>
            <label id="training-field-model">
              <span>可用基础模型 <b>必填</b></span>
              <select {...fieldProps(errors, 'model')} value={model} onChange={(event) => setModel(event.target.value)}>
                <option value="">选择基础模型版本</option>
                {models.map((row) => {
                  const reason = runtime ? modelCompatibilityReason(row, runtime) : '';
                  return <option key={row.version_id} value={row.version_id} disabled={Boolean(reason)}>{row.name} · v{row.version_number}{reason ? ' · 未支持' : ''}</option>;
                })}
              </select>
              <FieldError errors={errors} name="model"/>
              {selectedModel && <small>{selectedModel.format_summary?.model_type || '架构未标注'} · 指纹 {shortId(selectedModel.manifest_sha256, 12)}</small>}
            </label>
          </div>
          <div className="training-baseline-card">
            <TrainingIcon name="lock" size={18}/>
            <div><strong>{assetsLoading ? '正在读取兼容基线' : runtime ? `${runtime.model.display_name} 训练基线` : '训练基线不可用'}</strong>
              <p>{runtime ? `${runtime.model.architecture} · ${runtime.training.hardware.gpu_type} · ${runtime.training.hardware.region}/${runtime.training.hardware.zone} · 状态 ${runtime.status}` : '只有内容指纹、参数和硬件/镜像同时匹配的受支持组合才能提交。'}</p>
            </div>
            {runtime && <span>{runtime.status === 'partial' ? '部分收口' : '已收口'}</span>}
          </div>
        </div>}
        {step === 2 && <div className="training-step-panel" id="training-instance-fieldset">
          <div className="training-step-heading"><span>02</span><div><h2>单 GPU 计算环境</h2><p>当前平台不会自动创建收费实例。这里冻结的是你在优云控制台需要手动创建的规格。</p></div></div>
          <InstanceFields value={instance} onChange={setInstance} disabled={assetsLoading || busy}/>
          <div className="training-instance-preview">
            <TrainingIcon name="gpu" size={18}/>
            <div><span>当前选择</span><strong>{formatInstance(instance)}</strong><small>镜像 {instance.image_id || '未选择'} · {instance.boot_disk_gb || 0} GB {instance.boot_disk_type || ''} · {instance.charge_type || '未选择计费'}</small></div>
          </div>
        </div>}
        {step === 3 && <div className="training-step-panel">
          <div className="training-step-heading"><span>03</span><div><h2>训练参数</h2><p>首版只开放真实跑通的参数 preset。锁定字段来自兼容基线，随机种子可调整。</p></div></div>
          {!runtime ? <div className="training-inline-empty">运行基线不可用，无法配置训练参数。</div> : <div className="training-parameter-groups">
            <fieldset>
              <legend>训练与调度</legend>
              <div className="training-parameter-grid">
                <label><span>训练轮数 <i>锁定</i></span><input disabled type="number" value={config.epochs} readOnly/><small>Epochs</small></label>
                <label><span>学习率 <i>锁定</i></span><input disabled type="number" value={config.learning_rate} readOnly/><small>Learning Rate</small></label>
                <label><span>最大 Token <i>锁定</i></span><input disabled type="number" value={config.cutoff_len} readOnly/><small>Cutoff Length</small></label>
                <label><span>批大小 <i>锁定</i></span><input disabled type="number" value={config.batch_size} readOnly/><small>Batch Size</small></label>
                <label><span>梯度累积 <i>锁定</i></span><input disabled type="number" value={config.gradient_accumulation} readOnly/><small>Gradient Accumulation</small></label>
                <label><span>学习率调度 <i>锁定</i></span><input disabled value={config.scheduler} readOnly/><small>Scheduler</small></label>
                <label><span>预热比例 <i>锁定</i></span><input disabled type="number" value={config.warmup_ratio} readOnly/><small>Warmup Ratio</small></label>
              </div>
            </fieldset>
            <fieldset>
              <legend>LoRA 与可复现性</legend>
              <div className="training-parameter-grid">
                <label><span>LoRA Rank <i>锁定</i></span><input disabled type="number" value={config.lora_rank} readOnly/><small>Adapter Rank</small></label>
                <label><span>LoRA Alpha <i>锁定</i></span><input disabled type="number" value={config.lora_alpha} readOnly/><small>Adapter Alpha</small></label>
                <label><span>LoRA Dropout <i>锁定</i></span><input disabled type="number" value={config.lora_dropout} readOnly/><small>Regularization</small></label>
                <label><span>模型模板 <i>锁定</i></span><input disabled value={config.template} readOnly/><small>Chat Template</small></label>
                <label id="training-field-seed"><span>随机种子 <b>可编辑</b></span><input {...fieldProps(errors, 'seed')} type="number" min={0} max={2147483647} step={1} value={config.seed} onChange={(event) => setConfig({...config, seed: Number(event.target.value)})}/><FieldError errors={errors} name="seed"/><small>Seed</small></label>
              </div>
            </fieldset>
          </div>}
          <div className="training-config-note"><TrainingIcon name="info" size={16}/><p>固定训练 / 验证拆分会被复用；执行前仍会使用真实 tokenizer 检查每条样本是否超过最大 Token。</p></div>
        </div>}
        {step === 4 && <div className="training-step-panel">
          <div className="training-step-heading"><span>04</span><div><h2>确认冻结输入</h2><p>提交后，以下身份和参数会写入不可变 Attempt 快照。重试会创建新的 Attempt。</p></div></div>
          <div className="training-review-grid">
            <article><span>任务</span><strong>{name}</strong><small>{datasets.length} 个数据集版本可选 · {models.length} 个模型版本可用</small></article>
            <article><span>数据版本</span><strong>{selectedDataset?.name || shortId(dataset)}</strong><small>{dataset || '未选择'} · {reusedSnapshot ? `拆分 ${shortId(reusedSnapshot.dataset.split_sha256, 12)}` : '拆分指纹在提交后固化'}</small></article>
            <article><span>基础模型</span><strong>{selectedModel?.name || shortId(model)}</strong><small>{selectedModel?.format_summary?.model_type || '架构未标注'} · {shortId(selectedModel?.manifest_sha256 || model, 14)}</small></article>
            <article><span>计算环境</span><strong>{instance.gpu_type} · {instance.cpu} 核</strong><small>{instance.region} / {instance.zone} · {instance.memory_mb / 1024} GiB · {instance.image_id}</small></article>
          </div>
          <div className="training-review-parameters">
            <h3>训练参数</h3>
            <dl>
              <div><dt>Epochs</dt><dd>{config.epochs}</dd></div>
              <div><dt>Learning Rate</dt><dd>{config.learning_rate}</dd></div>
              <div><dt>Cutoff</dt><dd>{config.cutoff_len}</dd></div>
              <div><dt>Batch / Accum</dt><dd>{config.batch_size} / {config.gradient_accumulation}</dd></div>
              <div><dt>LoRA Rank / Alpha</dt><dd>{config.lora_rank} / {config.lora_alpha}</dd></div>
              <div><dt>Scheduler</dt><dd>{config.scheduler}</dd></div>
              <div><dt>Template</dt><dd>{config.template}</dd></div>
              <div><dt>Seed</dt><dd>{config.seed}</dd></div>
            </dl>
          </div>
          <div className="training-boundary-card">
            <TrainingIcon name="alert" size={19}/>
            <div><strong>提交不会购买或预留 GPU</strong><p>提交后任务进入“等待实例”。你需要按冻结规格在优云控制台手动创建收费实例，确认 Running 后回到详情页填写实例 ID，并授权平台在安全完成或取消后停止、删除实例。</p></div>
          </div>
          <details className="training-raw-details"><summary>查看提交 payload</summary><pre>{JSON.stringify({name: name.trim(), dataset_version_id: dataset, base_model_version_id: model, instance, config}, null, 2)}</pre></details>
        </div>}
        <footer className="training-create-footer">
          <div><span>步骤 {step} / 4</span><i style={{width: `${step * 25}%`}}/></div>
          <div>{step > 1 && <button type="button" className="secondary" onClick={goBack} disabled={busy}>上一步</button>}
            {step < 4 ? <button type="submit" disabled={assetsLoading || Boolean(assetsError)}>{assetsLoading ? '正在读取输入…' : '下一步'}<TrainingIcon name="arrow" size={15}/></button> : <button type="submit" disabled={busy || assetsLoading || Boolean(assetsError)}>{busy ? '正在提交…' : '提交训练任务'}</button>}
          </div>
        </footer>
      </form>
    </section>
    {confirmInstance && <ManualInstanceDialog purpose="训练" instance={instance} busy={busy} onCancel={() => setConfirmInstance(false)} onConfirm={() => void submit()}/>}
  </div>;

}
