import { useState } from 'react';
import { ComputeDialog } from './ComputeDialog';
import { ComputeIcon } from './ComputeIcon';
import { secureRequestId } from './compute-api';
import type {
  ComputeAction,
  ComputeEnvironmentView,
} from './compute-ui-types';

export type CommandAccepted = {
  operationId: string;
  acceptedAt: string;
  message: string;
};

const actionTitle: Record<ComputeAction, string> = {
  start: '启动这个计算环境？',
  stop: '停止这个计算环境？',
  delete: '删除这个计算环境？',
};

export function DangerousActionDialog({
  action,
  environment,
  onClose,
  onConfirm,
}: {
  action: ComputeAction;
  environment: ComputeEnvironmentView;
  onClose: () => void;
  onConfirm: (action: ComputeAction, requestId: string) => Promise<CommandAccepted>;
}) {
  const [confirmName, setConfirmName] = useState('');
  const [acknowledged, setAcknowledged] = useState(action === 'start');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [accepted, setAccepted] = useState<CommandAccepted | null>(null);
  const [requestId] = useState(() => secureRequestId());

  const valid =
    acknowledged && (action !== 'delete' || confirmName === environment.name);

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setError('');
    try {
      setAccepted(await onConfirm(action, requestId));
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : '命令未被服务端接受，请重试。',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <ComputeDialog
      labelledBy="mf-danger-title"
      className="mf-danger-dialog"
      onClose={() => {
        if (!busy) onClose();
      }}
      dismissible={!busy}
    >
      <div className="mf-dialog-head">
        <div className="mf-danger-head">
          <span className="mf-danger-symbol">
            <ComputeIcon name={action === 'delete' ? 'trash' : action === 'stop' ? 'pause' : 'play'} />
          </span>
          <div>
            <h2 id="mf-danger-title">{actionTitle[action]}</h2>
            <p>
              {action === 'delete'
                ? '删除必须确认任务、GPU 租约、产物和清理状态；请求成功只表示已受理。'
                : action === 'stop'
                  ? '停止会中断工作负载，但不等同于删除或 GPU 租约已释放。'
                  : '启动会恢复供应商实例计费；最终状态以轮询到的实例与租约事实为准。'}
            </p>
          </div>
        </div>
        <button
          type="button"
          className="mf-icon-button"
          aria-label="关闭操作确认"
          onClick={onClose}
          disabled={busy}
        >
          <ComputeIcon name="close" />
        </button>
      </div>

      <div className="mf-danger-summary">
        <div>
          <span>实例</span>
          <strong>{environment.name}</strong>
        </div>
        <div>
          <span>关联任务</span>
          <strong>{environment.relation.label}</strong>
        </div>
        <div>
          <span>GPU 租约</span>
          <strong>{environment.lease.label}</strong>
        </div>
        <div>
          <span>费用影响</span>
          <strong>
            {action === 'stop'
              ? '停止计算计费；存储费用可能继续'
              : action === 'delete'
                ? '删除后仍需核对实际账单'
                : '启动后可能继续产生云费用'}
          </strong>
        </div>
      </div>

      <div className="mf-danger-body">
        {accepted ? (
          <div className="mf-all-clear" role="status" aria-live="polite">
            <ComputeIcon name="clock" />
            <span>
              <strong>命令已受理：{accepted.message}</strong>
              <small>
                操作 ID {accepted.operationId} ·{' '}
                {new Date(accepted.acceptedAt).toLocaleString('zh-CN', {
                  hour12: false,
                })}
                。关闭后将持续轮询真实实例与租约事实。
              </small>
            </span>
          </div>
        ) : (
          <>
            <p>
              {action === 'delete'
                ? '高风险提示：实例删除后可能不可恢复；关联产物若未持久化会丢失。GPU 租约只有通过服务端清理事实后才能释放。'
                : action === 'stop'
                  ? '当前工作负载将中断。系统盘、快照或其他存储资源可能继续计费。'
                  : '启动不会创建新实例，但会恢复计算资源使用与潜在费用。'}
            </p>
            {action === 'delete' ? (
              <>
                <label>
                  输入实例名称 <strong>{environment.name}</strong> 以继续
                  <input
                    type="text"
                    value={confirmName}
                    autoComplete="off"
                    onChange={(event) => setConfirmName(event.target.value)}
                    aria-invalid={
                      confirmName.length > 0 && confirmName !== environment.name
                    }
                    aria-describedby="mf-danger-name-error"
                    data-dialog-autofocus
                  />
                </label>
                <label className="mf-ack">
                  <input
                    type="checkbox"
                    checked={acknowledged}
                    onChange={(event) => setAcknowledged(event.target.checked)}
                  />
                  <span>
                    我确认已核对关联任务、GPU 租约和产物持久化状态，并理解删除可能不可恢复。
                  </span>
                </label>
              </>
            ) : (
              <label className="mf-ack">
                <input
                  type="checkbox"
                  checked={acknowledged}
                  onChange={(event) => setAcknowledged(event.target.checked)}
                  data-dialog-autofocus
                />
                <span>
                  {action === 'stop'
                    ? '我理解停止会中断工作负载，并且存储计费和 GPU 租约需要另行核对。'
                    : '我理解启动会恢复云资源使用和潜在费用，最终状态以真实轮询结果为准。'}
                </span>
              </label>
            )}
            {confirmName.length > 0 &&
              confirmName !== environment.name &&
              action === 'delete' && (
                <p className="mf-inline-error" id="mf-danger-name-error" role="alert">
                  <ComputeIcon name="alert" />
                  名称不一致，服务端不会接受删除。
                </p>
              )}
            {error && (
              <p className="mf-inline-error" role="alert">
                <ComputeIcon name="alert" />
                {error}
              </p>
            )}
          </>
        )}
      </div>

      <div className="mf-dialog-foot">
        <span>
          {accepted
            ? '已受理等待事实'
            : action === 'delete'
              ? '不可逆外部操作需再次确认'
              : '高风险操作需再次确认'}
        </span>
        <div>
          <button type="button" className="mf-secondary" onClick={onClose}>
            {accepted ? '关闭' : '取消'}
          </button>
          {!accepted && (
            <button
              type="button"
              className={`${action === 'start' ? 'mf-primary' : 'mf-danger'}${
                busy ? ' is-loading' : ''
              }`}
              disabled={!valid || busy}
              onClick={() => void submit()}
            >
              {busy
                ? '正在提交'
                : action === 'delete'
                  ? '确认删除'
                  : action === 'stop'
                    ? '确认停止'
                    : '确认启动'}
            </button>
          )}
        </div>
      </div>
    </ComputeDialog>
  );
}
