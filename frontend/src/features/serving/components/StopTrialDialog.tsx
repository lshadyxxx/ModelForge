import type {ServingTrial} from '../types';
import {ServingDialog} from './ServingDialog';
import {ServingIcon} from './ServingIcon';

export function StopTrialDialog({
  trial,
  busy,
  error,
  onClose,
  onConfirm,
}: {
  trial: ServingTrial;
  busy: boolean;
  error: string;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const activeRequest = trial.request_state !== 'idle';
  return <ServingDialog titleId="serving-stop-title" className="serving-stop-dialog" onClose={() => !busy && onClose()}>
    <header className="serving-dialog-head">
      <div><span className="serving-danger-kicker">SAFE STOP</span><h2 id="serving-stop-title">结束这次推理试用？</h2><p>停止请求不会立即等于实例已回收。</p></div>
      <button type="button" className="serving-icon-button" aria-label="关闭结束确认" onClick={() => !busy && onClose()}><ServingIcon name="close" size={18}/></button>
    </header>
    <div className="serving-stop-body">
      <div className="serving-stop-warning"><ServingIcon name="alert" size={20}/><div>
        <strong>提交后平台将请求远端进程退出，并完成实例停止、删除与 GPU 租约释放。</strong>
        <p>工作台会显示“结束中”，只有进程、实例、清理和租约四类事实一致时才显示“实例已回收”。</p>
      </div></div>
      {activeRequest && <div className="serving-stop-request"><ServingIcon name="activity" size={17}/><p>当前仍有生成状态 <code>{trial.request_state}</code>。平台会先请求取消，再等待进程退出；无法确认时会保留实例。</p></div>}
      <dl className="serving-stop-facts">
        <div><dt>Trial</dt><dd><code>{trial.id.slice(0, 12)}</code></dd></div>
        <div><dt>实例</dt><dd><code>{trial.instance_id || '尚未关联'}</code></dd></div>
        <div><dt>清理策略</dt><dd>discard · 不保留推理实例临时文件</dd></div>
      </dl>
      {error && <div className="serving-form-error" role="alert"><ServingIcon name="alert" size={16}/><div><strong>未能提交结束请求</strong><p>{error}</p></div></div>}
      <footer className="serving-dialog-actions">
        <button type="button" className="secondary" disabled={busy} autoFocus onClick={onClose}>保留当前试用</button>
        <button type="button" className="serving-danger-solid" disabled={busy} onClick={onConfirm}>
          <ServingIcon name="trash" size={15}/>{busy ? '正在提交…' : '确认结束并开始回收'}
        </button>
      </footer>
    </div>
  </ServingDialog>;
}
