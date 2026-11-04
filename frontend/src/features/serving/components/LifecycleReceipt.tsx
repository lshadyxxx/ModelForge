import {classifyReceipt, formatDateTime} from '../serving-model';
import type {TrialLifecycle, TrialViewState} from '../types';
import {ServingIcon} from './ServingIcon';

const actionLabels: Record<string, string> = {
  reserved: '建立 GPU 租约',
  creation_requested: '记录创建意图',
  instance_bound: '绑定手动实例',
  execution_requested: '请求启动运行时',
  process_exited: '确认进程退出',
  cleanup_allowed: '授权清理',
  instance_stopped: '确认实例停止',
  deletion_failed: '实例删除失败',
  deletion_confirmed: '确认实例删除',
  released: '确认 GPU 租约释放',
};

function Fact({
  icon,
  label,
  value,
  meta,
  tone = 'neutral',
}: {
  icon: string;
  label: string;
  value: string;
  meta?: string;
  tone?: string;
}) {
  return <div className={`serving-receipt-fact ${tone}`}>
    <span><ServingIcon name={icon} size={15}/></span>
    <div><dt>{label}</dt><dd>{value}</dd>{meta && <small>{meta}</small>}</div>
  </div>;
}

export function LifecycleReceipt({
  lifecycle,
  view,
}: {
  lifecycle?: TrialLifecycle;
  view: TrialViewState;
}) {
  const conclusion = classifyReceipt(lifecycle);
  const complete = view.kind === 'ended' && view.receipt === 'complete';
  const noInstance = lifecycle?.status === 'not_reserved'
    || (view.kind === 'ended' && view.receipt === 'no_instance');
  const unavailable = lifecycle?.status === 'unavailable';
  const tracked = lifecycle?.status === 'tracked' ? lifecycle : null;
  const processTone = tracked?.process.state === 'exited' ? 'success' : tracked?.process.state === 'unknown' ? 'warning' : 'neutral';
  const instanceTone = tracked?.instance.state === 'deleted' ? 'success' : ['unknown', 'stopped'].includes(tracked?.instance.state ?? '') ? 'warning' : 'neutral';
  const cleanupTone = tracked?.cleanup.state === 'confirmed' ? 'success' : tracked?.cleanup.state === 'failed' ? 'danger' : tracked?.cleanup.state === 'pending' ? 'warning' : 'neutral';
  const leaseTone = tracked?.lease.state === 'released' ? 'success' : tracked ? 'warning' : 'neutral';

  return <section className={'serving-receipt' + (complete ? ' is-complete' : '')}>
    <header className="serving-receipt-head">
      <div>
        <span className="serving-kicker">RECLAMATION RECEIPT</span>
        <h3>回收回执</h3>
      </div>
      <span className={'serving-receipt-conclusion ' + (complete ? 'success' : conclusion === 'no_instance' ? 'neutral' : 'warning')}>
        <ServingIcon name={complete ? 'check' : conclusion === 'no_instance' ? 'info' : 'alert'} size={14}/>
        {complete ? '四类事实一致' : conclusion === 'no_instance' ? '无实例遗留' : '事实待核对'}
      </span>
    </header>
    {unavailable ? <div className="serving-receipt-unavailable" role="status">
      <ServingIcon name="alert" size={17}/>
      <div><strong>回执暂时不可读</strong><p>HTTP 详情仍可用，但生命周期投影失败。不能据此显示已回收。</p></div>
    </div> : !tracked ? <div className="serving-receipt-unavailable neutral">
      <ServingIcon name="info" size={17}/>
      <div><strong>{noInstance ? '这次 Trial 没有占用云实例' : '尚未形成回收回执'}</strong><p>{noInstance ? '未建立 GPU 租约，或租约在创建实例前已安全释放。' : '结束 Trial 后，这里会显示进程、实例、清理和租约四类事实。'}</p></div>
    </div> : <>
      <dl className="serving-receipt-grid">
        <Fact
          icon="activity"
          label="远端进程"
          value={tracked.process.state === 'exited' ? `已退出${tracked.process.exit_code === null ? '' : ` · code ${tracked.process.exit_code}`}` : tracked.process.state === 'unknown' ? '事实未知' : '尚未启动'}
          meta={tracked.process.state === 'exited' ? `${tracked.process.cancelled ? '主动停止' : '进程自然退出'} · ${formatDateTime(tracked.process.exited_at)}` : '必须显式确认，不以停止请求代替'}
          tone={processTone}
        />
        <Fact
          icon="gpu"
          label="云实例"
          value={tracked.instance.state === 'deleted' ? '已删除' : tracked.instance.state === 'stopped' ? '已停止，待删除' : tracked.instance.state === 'unknown' ? '事实未知' : '未创建'}
          meta={tracked.instance.deleted_at ? formatDateTime(tracked.instance.deleted_at) : tracked.instance.stopped_at ? `停止于 ${formatDateTime(tracked.instance.stopped_at)}` : '等待云资源事实'}
          tone={instanceTone}
        />
        <Fact
          icon="trash"
          label="清理确认"
          value={tracked.cleanup.state === 'confirmed' ? '已确认' : tracked.cleanup.state === 'failed' ? '删除失败' : tracked.cleanup.state === 'pending' ? '处理中' : '尚未请求'}
          meta={tracked.cleanup.error_code || (tracked.cleanup.policy ? `策略 ${tracked.cleanup.policy}` : '结束 Trial 后产生清理意图')}
          tone={cleanupTone}
        />
        <Fact
          icon="check"
          label="GPU 租约"
          value={tracked.lease.state === 'released' ? '已释放' : '仍持有'}
          meta={tracked.lease.released_at ? formatDateTime(tracked.lease.released_at) : '实例删除且清理确认后才允许释放'}
          tone={leaseTone}
        />
      </dl>
      {conclusion === 'incomplete' && view.kind !== 'ending' && <p className="serving-receipt-warning">Trial 已停止，但完整回收事实不成立。请保留实例并核对，不能把停止请求当作已删除。</p>}
      <details className="serving-receipt-events">
        <summary><span>生命周期事件</span><small>{tracked.events.length} 条白名单事件</small></summary>
        {tracked.events.length ? <ol>{tracked.events.slice().reverse().map((event, index) => <li key={`${event.recorded_at}-${index}`}>
          <span><i/></span>
          <div><strong>{actionLabels[event.action] ?? event.action}</strong><time dateTime={event.recorded_at}>{formatDateTime(event.recorded_at)}</time></div>
        </li>)}</ol> : <p>已建立租约，但还没有可显示的生命周期事件。</p>}
      </details>
    </>}
  </section>;
}
