import { useState } from 'react';
import { ComputeIcon } from './ComputeIcon';
import { ComputeDialog } from './ComputeDialog';
import { ComputeStatusBadge } from './ComputeStatusBadge';
import { unavailableQuote } from './compute-model';
import { quoteObservedAt, quoteRate } from './compute-quote';
import type {
  ComputeAction,
  ComputeEnvironmentView,
} from './compute-ui-types';

function displayDate(value?: string) {
  if (!value) return '未记录';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '未记录';
  return date.toLocaleString('zh-CN', { hour12: false });
}

export function EnvironmentDetail({
  environment,
  busy,
  onClose,
  onRefresh,
  onAction,
}: {
  environment: ComputeEnvironmentView;
  busy: boolean;
  onClose: () => void;
  onRefresh: () => void;
  onAction: (action: ComputeAction, environment: ComputeEnvironmentView) => void;
}) {
  const [copied, setCopied] = useState('');

  const copy = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(`${label}已复制。`);
    } catch {
      setCopied('复制失败，请展开并手动选择文本。');
    }
  };

  return (
    <ComputeDialog
      labelledBy="mf-detail-title"
      className="mf-detail-dialog"
      onClose={onClose}
    >
      <div className="mf-detail-hero">
        <div>
          <span className="mf-compute-eyebrow">INSTANCE DOSSIER</span>
          <h2 id="mf-detail-title">{environment.name}</h2>
          <p>
            {environment.relation.label} · {environment.ownershipLabel}
          </p>
          <ComputeStatusBadge
            label={environment.statusLabel}
            tone={environment.statusTone}
          />
        </div>
        <button
          type="button"
          className="mf-icon-button"
          aria-label="关闭实例详情"
          onClick={onClose}
        >
          <ComputeIcon name="close" />
        </button>
      </div>

      <div className="mf-detail-grid">
        <div className="mf-detail-facts">
          <div>
            <span>环境 ID</span>
            <strong>{environment.id}</strong>
          </div>
          <div>
            <span>供应商实例 ID</span>
            <strong>{environment.providerInstanceId ?? '尚未绑定'}</strong>
          </div>
          <div>
            <span>GPU / 显存</span>
            <strong>
              {environment.spec.gpuType || '未记录'} /{' '}
              {environment.spec.memoryGiB
                ? `${environment.spec.memoryGiB} GiB`
                : '未知'}
            </strong>
          </div>
          <div>
            <span>CPU / 内存</span>
            <strong>
              {environment.spec.cpu || '—'} 核 /{' '}
              {environment.spec.memoryGiB || '—'} GiB
            </strong>
          </div>
          <div>
            <span>地域 / 可用区</span>
            <strong>
              {environment.spec.region || '未记录'} ·{' '}
              {environment.spec.zone || '未记录'}
            </strong>
          </div>
          <div>
            <span>运行镜像</span>
            <strong>
              {environment.spec.imageName ?? (environment.spec.imageId || '未记录')}
            </strong>
          </div>
          <div>
            <span>GPU 租约</span>
            <strong>{environment.lease.label}</strong>
          </div>
          <div>
            <span>清理状态</span>
            <strong>{environment.cleanup.label}</strong>
          </div>
          <div>
            <span>状态证据</span>
            <strong>{environment.freshnessLabel}</strong>
          </div>
          <div>
            <span>最近更新</span>
            <strong>{displayDate(environment.updatedAt)}</strong>
          </div>
          <div className={environment.statusTone === 'danger' ? 'wide alert' : 'wide'}>
            <span>当前判断</span>
            <strong>{environment.statusDetail}</strong>
          </div>
          {environment.cleanup.errorCode && (
            <div className="wide alert">
              <span>清理错误</span>
              <strong>{environment.cleanup.errorCode}</strong>
            </div>
          )}
          <div className="wide">
            <span>监控证据</span>
            {environment.monitor.provider === 'ucloud' &&
            environment.monitor.metrics.length ? (
              <div className="mf-detail-monitor">
                {environment.monitor.metrics.map((metric) => (
                  <div key={metric.key}>
                    <span>{metric.label}</span>
                    <strong>{metric.value}</strong>
                    {metric.percent !== undefined && (
                      <small>{Math.round(metric.percent)}%</small>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <strong>
                监控来源不可确认
                {environment.monitor.errorCode
                  ? ` · ${environment.monitor.errorCode}`
                  : ''}
              </strong>
            )}
          </div>
        </div>

        <aside className="mf-detail-side" aria-label="费用与操作">
          <span className="mf-compute-eyebrow">COST & OWNERSHIP</span>
          <div className="mf-cost-panel" style={{ marginTop: 8 }}>
            <strong>
              {quoteRate(environment.quote ?? unavailableQuote())
                ?? '报价待核对'}
            </strong>
            <small>
              {environment.quote?.state === 'available'
                ? `官方折后价 · 查询于 ${
                  quoteObservedAt(environment.quote) ?? '未知时间'
                }；实际账单以供应商为准。`
                : environment.quote?.description
                  ?? '未取得可信报价，不显示估算金额。'}
            </small>
            {environment.quote?.breakdown && (
              <div>
                <span>报价构成</span>
                <b>
                  实例 ¥{environment.quote.breakdown.instance.toFixed(2)} · 系统盘 ¥
                  {environment.quote.breakdown.systemDisks.toFixed(2)}
                </b>
              </div>
            )}
            <div>
              <span>资源归属</span>
              <b>{environment.ownershipLabel}</b>
            </div>
            <div>
              <span>关联任务</span>
              <b>{environment.relation.label}</b>
            </div>
          </div>
          <div className="mf-detail-side-actions">
            <button
              type="button"
              className="mf-secondary mf-wide"
              onClick={() => void copy(environment.id, '环境 ID')}
            >
              <ComputeIcon name="copy" />
              复制环境 ID
            </button>
            {environment.providerInstanceId && (
              <button
                type="button"
                className="mf-secondary mf-wide"
                onClick={() =>
                  void copy(environment.providerInstanceId!, '实例 ID')
                }
              >
                <ComputeIcon name="copy" />
                复制实例 ID
              </button>
            )}
            <button
              type="button"
              className="mf-secondary mf-wide"
              onClick={onRefresh}
              disabled={busy}
            >
              <ComputeIcon name="refresh" />
              {busy ? '刷新中' : '刷新状态与监控'}
            </button>
            {environment.actions.includes('start') && (
              <button
                type="button"
                className="mf-secondary mf-wide"
                onClick={() => onAction('start', environment)}
              >
                <ComputeIcon name="play" />
                启动环境
              </button>
            )}
            {environment.actions.includes('stop') && (
              <button
                type="button"
                className="mf-secondary mf-wide"
                onClick={() => onAction('stop', environment)}
              >
                <ComputeIcon name="pause" />
                停止环境
              </button>
            )}
            {environment.actions.includes('delete') && (
              <button
                type="button"
                className="mf-danger-outline mf-wide"
                onClick={() => onAction('delete', environment)}
              >
                <ComputeIcon name="trash" />
                删除环境
              </button>
            )}
            {!environment.actions.length && (
              <div className="mf-inline-note">
                <ComputeIcon name="lock" />
                <span>
                  当前实例不由平台托管，或服务端能力尚未开放。只读详情仍保留以便核对。
                </span>
              </div>
            )}
          </div>
          <p>
            停止计算不保证停止全部存储计费；删除不等于 GPU
            租约已释放。危险操作会再次核对关联任务、产物和清理状态。
          </p>
        </aside>
      </div>

      <section className="mf-detail-timeline" aria-labelledby="mf-detail-events-title">
        <span className="mf-compute-eyebrow" id="mf-detail-events-title">
          RECENT EVENTS
        </span>
        {environment.events.length ? (
          environment.events.map((event, index) => (
            <div key={`${event.id ?? event.recordedAt}-${index}`}>
              <i>
                <ComputeIcon name="check" size={11} />
              </i>
              <span>
                <strong>{event.label}</strong>
                <small>
                  来源：
                  {
                    {
                      platform: '平台状态',
                      lease: 'GPU 租约',
                      provider: '供应商状态',
                      observation: '状态观测',
                    }[event.source]
                  }
                </small>
              </span>
              <time dateTime={event.recordedAt}>
                {displayDate(event.recordedAt)}
              </time>
            </div>
          ))
        ) : (
          <div className="mf-event-empty">
            没有真实事件来源。只有租约写入、状态观测或供应商事实持久化后才会生成时间线。
          </div>
        )}
      </section>

      <div className="mf-dialog-foot">
        <span role="status" aria-live="polite">
          {copied || '真实实例事实 · 不含虚构费用或事件'}
        </span>
        <button type="button" className="mf-secondary" onClick={onClose}>
          关闭
        </button>
      </div>
    </ComputeDialog>
  );
}
