import {useMemo, useState} from 'react';
import {SelectMenu} from '../../../shared/SelectMenu';
import type {AdapterVersion} from '../../models';
import type {RuntimeBaseline} from '../../runtime';
import {adapterCompatibilityReason} from '../../runtime';
import type {InstanceSpec} from '../../resources';
import {emptyInstance, InstanceFields, ManualInstanceDialog} from '../../resources';
import {ServingDialog} from './ServingDialog';
import {ServingIcon} from './ServingIcon';

export function CreateTrialDialog({
  adapters,
  runtime,
  runtimeError,
  busy,
  error,
  onClose,
  onCreate,
}: {
  adapters: AdapterVersion[];
  runtime: RuntimeBaseline | null;
  runtimeError: string;
  busy: boolean;
  error: string;
  onClose: () => void;
  onCreate: (adapterId: string, instance: InstanceSpec) => Promise<void>;
}) {
  const [adapterId, setAdapterId] = useState('');
  const [instance, setInstance] = useState<InstanceSpec>(emptyInstance);
  const [confirm, setConfirm] = useState(false);
  const [localError, setLocalError] = useState('');

  const adapterOptions = useMemo(() => adapters.map((adapter) => {
    const reason = adapterCompatibilityReason(adapter, runtime);
    return {
      value: adapter.id,
      label: `${adapter.role === 'best' ? 'Best' : 'Final'} · Attempt ${adapter.source_attempt_id.slice(0, 8)}`,
      description: reason ?? `eval loss ${adapter.metrics.eval_loss ?? '—'} · ${adapter.fingerprint.slice(0, 12)}`,
      disabled: Boolean(reason) || adapter.state !== 'available',
    };
  }), [adapters, runtime]);

  function validate() {
    if (!adapterId) return '请选择已同步且兼容的 Adapter。';
    if (!instance.region || !instance.zone || !instance.gpu_type || !instance.cpu || !instance.memory_mb || !instance.image_id) {
      return '请完整填写地域、可用区、单卡 GPU、CPU / 内存和运行镜像。';
    }
    return '';
  }

  return <>
    <ServingDialog titleId="serving-create-title" className="serving-create-dialog" onClose={() => !busy && onClose()}>
      <header className="serving-dialog-head">
        <div><span>SERVING / NEW TRIAL</span><h2 id="serving-create-title">创建独立推理试用</h2><p>固定 Adapter 与单卡实例要求。创建记录不会自动购买云资源。</p></div>
        <button type="button" className="serving-icon-button" aria-label="关闭创建试用" onClick={() => !busy && onClose()}><ServingIcon name="close" size={18}/></button>
      </header>
      <form className="serving-dialog-form" onSubmit={(event) => {
        event.preventDefault();
        const message = validate();
        if (message) {
          setLocalError(message);
          return;
        }
        setLocalError('');
        setConfirm(true);
      }}>
        <fieldset disabled={busy}>
          <section className="serving-dialog-section">
            <div className="serving-dialog-section-head">
              <span className="serving-step-number">01</span>
              <div><h3>选择训练产物</h3><p>只列出已同步 Adapter；不兼容项保留原因并禁用。</p></div>
            </div>
            <label className="serving-field">
              <span>已同步 Adapter</span>
              <SelectMenu
                value={adapterId}
                options={adapterOptions}
                onChange={setAdapterId}
                placeholder={adapters.length ? '选择 Best / Final Adapter' : '还没有已同步 Adapter'}
                emptyText="没有匹配的训练产物"
                searchPlaceholder="按 Attempt 或指纹搜索"
                ariaLabel="已同步 Adapter"
                required
              />
            </label>
            {runtime && <div className="serving-runtime-baseline">
              <span><ServingIcon name="check" size={15}/></span>
              <div><strong>{runtime.model.display_name}</strong><p>{runtime.inference.hardware.gpu_type} · 模型长度 {runtime.model.max_model_len} · 最大生成 {runtime.inference.conversation.max_tokens_limit} Token</p></div>
            </div>}
            {runtimeError && <div className="serving-form-error" role="alert"><ServingIcon name="alert" size={15}/>{runtimeError}</div>}
          </section>

          <section className="serving-dialog-section">
            <div className="serving-dialog-section-head">
              <span className="serving-step-number">02</span>
              <div><h3>固定单卡实例要求</h3><p>10 个持久字段连同镜像目录与筛选辅助项全部保留。</p></div>
            </div>
            <details className="serving-instance-fields" open>
              <summary>展开实例配置 <small>冻结后用于绑定核对</small></summary>
              <InstanceFields value={instance} onChange={setInstance} disabled={busy}/>
            </details>
          </section>

          {(localError || error) && <div className="serving-form-error" role="alert">
            <ServingIcon name="alert" size={16}/><div><strong>无法创建试用</strong><p>{localError || error}</p></div>
          </div>}

          <div className="serving-dialog-boundary">
            <ServingIcon name="info" size={16}/>
            <p>创建成功后进入“等待独立实例”。平台不会调用优云创建接口；请在控制台手动创建 Running 实例，再回到工作台关联。</p>
          </div>
          <footer className="serving-dialog-actions">
            <button type="button" className="secondary" disabled={busy} onClick={onClose}>取消</button>
            <button type="submit" disabled={busy || !runtime || !adapterId}><ServingIcon name="plus" size={15}/>{busy ? '正在创建…' : '生成手动创建要求'}</button>
          </footer>
        </fieldset>
      </form>
    </ServingDialog>
    {confirm && <ManualInstanceDialog
      purpose="独立推理"
      instance={instance}
      busy={busy}
      onCancel={() => setConfirm(false)}
      onConfirm={() => {
        setConfirm(false);
        void onCreate(adapterId, instance);
      }}
    />}
  </>;
}
