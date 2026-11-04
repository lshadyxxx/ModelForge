import {useState} from 'react';
import type {ServingTrial} from '../types';
import {ServingDialog} from './ServingDialog';
import {ServingIcon} from './ServingIcon';

export function BindInstancePanel({
  trial,
  busy,
  error,
  onClose,
  onBind,
}: {
  trial: ServingTrial;
  busy: boolean;
  error: string;
  onClose: () => void;
  onBind: (instanceId: string, acknowledgeCleanup: boolean) => Promise<void>;
}) {
  const [instanceId, setInstanceId] = useState(trial.instance_id ?? '');
  const [ack, setAck] = useState(false);
  const [localError, setLocalError] = useState('');
  const instance = trial.snapshot.instance;

  return <ServingDialog titleId="serving-bind-title" className="serving-bind-dialog" onClose={() => !busy && onClose()}>
    <header className="serving-dialog-head">
      <div><span>MANUAL INSTANCE</span><h2 id="serving-bind-title">关联独立 GPU 实例</h2><p>只接受与冻结要求完全匹配、处于 Running 的独立实例。</p></div>
      <button type="button" className="serving-icon-button" aria-label="关闭关联实例" onClick={() => !busy && onClose()}><ServingIcon name="close" size={18}/></button>
    </header>
    <div className="serving-bind-body">
      <section className="serving-bind-requirement">
        <div><span className="serving-kicker">FROZEN REQUIREMENT</span><h3>{instance.gpu_type || '单 GPU 实例'}</h3><p>{instance.region || '—'} / {instance.zone || '—'} · {instance.cpu || '—'} 核 / {instance.memory_mb ? `${instance.memory_mb / 1024} GiB` : '—'}</p></div>
        <dl>
          <div><dt>镜像</dt><dd><code>{instance.image_id || '—'}</code></dd></div>
          <div><dt>系统盘</dt><dd>{instance.boot_disk_gb} GB · {instance.boot_disk_type}</dd></div>
          <div><dt>计费</dt><dd>{instance.charge_type}</dd></div>
          <div><dt>Trial</dt><dd><code>{trial.id.slice(0, 12)}</code></dd></div>
        </dl>
      </section>
      <form onSubmit={(event) => {
        event.preventDefault();
        const value = instanceId.trim();
        if (!/^[A-Za-z0-9_-]{1,120}$/.test(value)) {
          setLocalError('实例 ID 只能包含字母、数字、下划线和连字符，长度为 1–120。');
          return;
        }
        if (!ack) {
          setLocalError('必须确认实例归属，并授权平台停止和删除该实例。');
          return;
        }
        setLocalError('');
        void onBind(value, ack);
      }}>
        <fieldset disabled={busy}>
          <label className="serving-field">
            <span>优云实例 ID</span>
            <input
              required
              value={instanceId}
              maxLength={120}
              pattern="[A-Za-z0-9_-]{1,120}"
              placeholder="例如 uh-xxxxxxxx"
              data-dialog-autofocus
              onChange={(event) => setInstanceId(event.target.value)}
            />
            <small>必须是独立于训练、当前 Running，且未关联其他平台执行的实例。</small>
          </label>
          <label className="serving-check-label">
            <input type="checkbox" checked={ack} onChange={(event) => setAck(event.target.checked)}/>
            <span><strong>我拥有这台实例，并授权平台在结束后停止、删除它</strong><small>平台会核对实例规格与运行时；提交不代表实例已经回收。</small></span>
          </label>
          {(localError || error) && <div className="serving-form-error" role="alert"><ServingIcon name="alert" size={16}/><div><strong>无法关联实例</strong><p>{localError || error}</p></div></div>}
          <div className="serving-bind-warning"><ServingIcon name="alert" size={16}/><p>如果实例规格、镜像或归属不匹配，后端会拒绝关联。不要复用训练中的实例。</p></div>
          <footer className="serving-dialog-actions">
            <button type="button" className="secondary" disabled={busy} onClick={onClose}>返回</button>
            <button type="submit" disabled={busy}>{busy ? '正在核对…' : '核对并关联'}</button>
          </footer>
        </fieldset>
      </form>
    </div>
  </ServingDialog>;
}
