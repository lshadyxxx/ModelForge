import {useEffect, useState} from 'react';
import type {AdapterVersion} from '../../models';
import {formatDateTime, formatRemaining, shortId, trialPresentation} from '../serving-model';
import type {ServingTrial, TrialViewState} from '../types';
import {LifecycleReceipt} from './LifecycleReceipt';
import {ServingIcon} from './ServingIcon';

function Copyable({value, label}: {value: string; label: string}) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1400);
    return () => window.clearTimeout(timer);
  }, [copied]);
  return <span className="serving-copyable">
    <code title={value}>{value}</code>
    <button
      type="button"
      aria-label={`复制${label}`}
      title={`复制${label}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
        } catch {
          setCopied(false);
        }
      }}
    ><ServingIcon name={copied ? 'check' : 'copy'} size={12}/></button>
  </span>;
}

function NoTrialContext() {
  return <section className="serving-column serving-context" aria-label="试用运行事实">
    <header className="serving-context-head"><div><span className="serving-kicker">RUN FACTS</span><h2>运行事实</h2></div><ServingIcon name="panel" size={17}/></header>
    <div className="serving-context-empty">
      <span className="serving-empty-symbol"><ServingIcon name="panel" size={22}/></span>
      <h3>选择一条 Trial</h3>
      <p>这里会显示冻结的 Adapter、基座指纹、实例要求、空闲回收倒计时和四类回收事实。</p>
      <ol className="serving-context-guide">
        <li><span>01</span><div><strong>确认身份</strong><small>Adapter 与基座指纹必须可追溯。</small></div></li>
        <li><span>02</span><div><strong>验证生成</strong><small>只有通过真实探测后才可发送。</small></div></li>
        <li><span>03</span><div><strong>安全结束</strong><small>进程、实例、清理与租约分别核对。</small></div></li>
      </ol>
    </div>
  </section>;
}

export function TrialContextPanel({
  trial,
  view,
  adapter,
  mobileOpen,
  onOpenBind,
  onStop,
  onClose,
}: {
  trial: ServingTrial | null;
  view: TrialViewState | null;
  adapter?: AdapterVersion;
  mobileOpen: boolean;
  onOpenBind: () => void;
  onStop: () => void;
  onClose: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  const readyIdle = view?.kind === 'ready';
  useEffect(() => {
    if (!readyIdle) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [readyIdle]);

  if (!trial || !view) return <div className={'serving-context-shell' + (mobileOpen ? ' is-open' : '')}>
    <div className="serving-drawer-only-close">
      <button type="button" className="serving-icon-button" onClick={onClose} aria-label="关闭运行事实"><ServingIcon name="close" size={17}/></button>
    </div>
    <NoTrialContext/>
  </div>;

  const presentation = trialPresentation(view);
  const canStop = !['ended', 'invalid_route'].includes(view.kind);
  const idleLabel = readyIdle
    ? `${formatRemaining(trial.last_activity_at, now)} 后请求回收`
    : trial.stop_requested ? '结束流程已启动' : '就绪且空闲后开始计时';
  const instance = trial.snapshot.instance;

  return <div className={'serving-context-shell' + (mobileOpen ? ' is-open' : '')}>
    <div className="serving-drawer-only-close">
      <button type="button" className="serving-icon-button" onClick={onClose} aria-label="关闭运行事实"><ServingIcon name="close" size={17}/></button>
    </div>
    <section className="serving-column serving-context" aria-label="当前试用运行事实">
      <header className="serving-context-head">
        <div><span className="serving-kicker">RUN FACTS</span><h2>运行事实</h2></div>
        <span className={'serving-context-state ' + presentation.tone}><i/>{presentation.shortLabel}</span>
      </header>
      <div className="serving-context-body">
        <section className="serving-context-section">
          <div className="serving-section-title"><span>MODEL BINDING</span><strong>模型绑定</strong></div>
          <dl className="serving-context-facts">
            <div><dt>Adapter</dt><dd><Copyable value={trial.adapter_id} label="Adapter ID"/></dd></div>
            <div><dt>产物角色</dt><dd>{adapter ? `${adapter.role === 'best' ? 'Best' : 'Final'} · Attempt ${shortId(adapter.source_attempt_id)}` : '等待 Adapter 列表'}</dd></div>
            <div><dt>内容指纹</dt><dd><Copyable value={trial.snapshot.adapter_fingerprint} label="Adapter 指纹"/></dd></div>
            <div><dt>基座版本</dt><dd><Copyable value={trial.snapshot.base.id} label="基座版本"/></dd></div>
            <div><dt>基座指纹</dt><dd><Copyable value={trial.snapshot.base.fingerprint} label="基座指纹"/></dd></div>
          </dl>
        </section>

        <section className="serving-context-section serving-runtime-card">
          <div className="serving-section-title"><span>INSTANCE & LEASE</span><strong>实例与租约</strong></div>
          <div className="serving-runtime-line">
            <span className="serving-runtime-icon"><ServingIcon name="gpu" size={17}/></span>
            <div><span>{instance.gpu_type || '单 GPU 实例'}</span><strong>{trial.instance_id ? shortId(trial.instance_id, 16) : '尚未关联实例'}</strong></div>
            {view.kind === 'waiting_instance' && <button type="button" onClick={onOpenBind}>关联</button>}
          </div>
          <dl className="serving-context-facts compact">
            <div><dt>地域 / 可用区</dt><dd>{instance.region || '—'} / {instance.zone || '—'}</dd></div>
            <div><dt>CPU / 内存</dt><dd>{instance.cpu || '—'} 核 / {instance.memory_mb ? `${instance.memory_mb / 1024} GiB` : '—'}</dd></div>
            <div><dt>GPU 租约</dt><dd>{trial.lease_id ? <Copyable value={trial.lease_id} label="租约 ID"/> : '尚未建立'}</dd></div>
            <div><dt>空闲回收</dt><dd className={view.kind === 'ready' ? 'serving-countdown' : ''}>{idleLabel}</dd></div>
            <div><dt>最近活动</dt><dd>{formatDateTime(trial.last_activity_at)}</dd></div>
          </dl>
        </section>

        <LifecycleReceipt lifecycle={trial.lifecycle} view={view}/>

        {trial.error_code && <div className="serving-context-error">
          <ServingIcon name="alert" size={16}/>
          <div><strong>当前错误事实</strong><code>{trial.error_code}</code></div>
        </div>}
      </div>
      {canStop && <footer className="serving-context-foot">
        <button type="button" className="serving-danger-button" onClick={onStop} disabled={trial.stop_requested || trial.state === 'stopping'}>
          <ServingIcon name="trash" size={15}/>
          {trial.stop_requested || trial.state === 'stopping' ? '结束与回收处理中' : '结束试用并回收'}
        </button>
        <p>不会自动购买实例；只对当前已绑定实例执行停止和删除。</p>
      </footer>}
    </section>
  </div>;
}
