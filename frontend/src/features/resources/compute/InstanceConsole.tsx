import { ComputeIcon } from './ComputeIcon';
import { ComputeStatusBadge } from './ComputeStatusBadge';
import { unavailableQuote } from './compute-model';
import { quoteRate } from './compute-quote';
import type {
  ComputeAction,
  ComputeEnvironmentView,
  ComputeEvent,
} from './compute-ui-types';

type RunwayState = 'pending' | 'current' | 'done' | 'failed';

function step(label: string, detail: string, state: RunwayState) {
  return { label, detail, state };
}

function runwaySteps(environment: ComputeEnvironmentView) {
  const created = ['running', 'stopping', 'stopped', 'failed'].includes(
    environment.status,
  );
  const runtimeReady = ['running', 'stopping'].includes(environment.status);
  const leaseHeld = environment.lease.state === 'held';
  const problem =
    environment.status === 'failed' ||
    environment.status === 'unavailable' ||
    environment.status === 'unknown';
  return [
    step(
      '资源确认',
      environment.spec.gpuType ? `${environment.spec.gpuType} 配置已固定` : '等待配置',
      environment.spec.gpuType ? 'done' : 'current',
    ),
    step(
      '实例创建',
      environment.providerInstanceId ? '实例身份已绑定' : '等待供应商实例',
      created ? 'done' : problem ? 'failed' : 'current',
    ),
    step(
      '运行时准备',
      runtimeReady ? environment.spec.imageName ?? '镜像已加载' : '等待运行镜像',
      runtimeReady ? 'done' : problem ? 'failed' : created ? 'current' : 'pending',
    ),
    step(
      '健康探针',
      environment.monitor.provider === 'ucloud'
        ? environment.statusDetail
        : '监控来源不可确认',
      environment.status === 'running'
        ? 'done'
        : problem
          ? 'failed'
          : runtimeReady
            ? 'current'
            : 'pending',
    ),
    step(
      '租约绑定',
      environment.lease.label,
      leaseHeld
        ? 'done'
        : environment.lease.state === 'review'
          ? 'failed'
          : environment.status === 'running'
            ? 'current'
            : 'pending',
    ),
  ];
}

function Runway({
  environment,
}: {
  environment: ComputeEnvironmentView;
}) {
  return (
    <ol className="mf-lifecycle" aria-label="计算环境生命周期">
      {runwaySteps(environment).map((item, index) => (
        <li className={`mf-lifecycle-step ${item.state}`} key={item.label}>
          <i>{item.state === 'done' ? <ComputeIcon name="check" size={12} /> : index + 1}</i>
          <strong>{item.label}</strong>
          <small>{item.detail}</small>
        </li>
      ))}
    </ol>
  );
}

function monitorMetric(
  environment: ComputeEnvironmentView,
  key: string,
  fallbackLabel: string,
) {
  return environment.monitor.metrics.find((metric) => metric.key === key);
}

function ActiveRunway({
  environment,
  onDetail,
  onAction,
}: {
  environment: ComputeEnvironmentView;
  onDetail: (environment: ComputeEnvironmentView) => void;
  onAction: (action: ComputeAction, environment: ComputeEnvironmentView) => void;
}) {
  const gpu = monitorMetric(environment, 'gpu_util', 'GPU 利用率');
  const memory = monitorMetric(environment, 'gpu_memory_used', '显存占用');
  const heartbeat = monitorMetric(environment, 'heartbeat', '最近心跳');
  return (
    <section className="mf-runway" aria-labelledby="mf-active-runway-title">
      <div className="mf-runway-top">
        <div>
          <span className="mf-compute-eyebrow">
            <ComputeIcon name="bolt" />
            ACTIVE ENVIRONMENT
          </span>
          <h2 id="mf-active-runway-title">{environment.name}</h2>
          <p>
            {environment.relation.label} · {environment.spec.region} ·{' '}
            {environment.spec.zone}
          </p>
        </div>
        <ComputeStatusBadge
          label={environment.statusLabel}
          tone={environment.statusTone}
        />
      </div>

      <Runway environment={environment} />

      <div className="mf-runway-facts">
        <div>
          <span>GPU / 规格</span>
          <strong>
            {environment.spec.gpuType || '未记录'} ·{' '}
            {environment.spec.memoryGiB
              ? `${environment.spec.memoryGiB} GiB`
              : '内存未知'}
          </strong>
        </div>
        <div>
          <span>CPU / 内存</span>
          <strong>
            {environment.spec.cpu || '—'} 核 / {environment.spec.memoryGiB || '—'} GiB
          </strong>
        </div>
        <div>
          <span>GPU 租约</span>
          <strong>{environment.lease.label}</strong>
        </div>
        <div>
          <span>费用</span>
          <strong>
            {quoteRate(environment.quote ?? unavailableQuote()) ?? '待核对'}
          </strong>
        </div>
      </div>

      <div className="mf-telemetry">
        <div>
          <span>{gpu?.label ?? 'GPU 利用率'}</span>
          <strong>{gpu?.value ?? '不可确认'}</strong>
          <i>
            <b
              style={{
                width: `${Math.max(0, Math.min(100, gpu?.percent ?? 0))}%`,
              }}
            />
          </i>
        </div>
        <div>
          <span>{memory?.label ?? '显存占用'}</span>
          <strong>{memory?.value ?? '不可确认'}</strong>
          <i>
            <b
              style={{
                width: `${Math.max(0, Math.min(100, memory?.percent ?? 0))}%`,
              }}
            />
          </i>
        </div>
        <div>
          <span>{heartbeat?.label ?? '最近心跳'}</span>
          <strong>{heartbeat?.value ?? '监控超时'}</strong>
          <small>
            {environment.monitor.checkedAt
              ? `核对于 ${new Date(environment.monitor.checkedAt).toLocaleString(
                  'zh-CN',
                  { hour12: false },
                )}`
              : '真实监控来源不可用'}
          </small>
        </div>
      </div>

      <div className="mf-runway-actions">
        <button
          type="button"
          className="mf-secondary"
          onClick={() => onDetail(environment)}
        >
          <ComputeIcon name="search" />
          查看运行详情
        </button>
        {environment.actions.includes('stop') && (
          <button
            type="button"
            className="mf-secondary"
            onClick={() => onAction('stop', environment)}
          >
            <ComputeIcon name="pause" />
            停止环境
          </button>
        )}
        {environment.actions.includes('start') && (
          <button
            type="button"
            className="mf-secondary"
            onClick={() => onAction('start', environment)}
          >
            <ComputeIcon name="play" />
            启动环境
          </button>
        )}
      </div>
    </section>
  );
}

function ExceptionQueue({
  environments,
  onDetail,
}: {
  environments: ComputeEnvironmentView[];
  onDetail: (environment: ComputeEnvironmentView) => void;
}) {
  const exceptions = environments.filter(
    (environment) =>
      environment.statusTone === 'danger' ||
      environment.status === 'unavailable' ||
      environment.status === 'unknown' ||
      environment.lease.state === 'review' ||
      environment.cleanup.state === 'failed',
  );
  return (
    <aside
      className="mf-panel mf-exception-panel"
      aria-labelledby="mf-exception-title"
    >
      <div className="mf-panel-heading">
        <div>
          <span className="mf-compute-eyebrow">EXCEPTION QUEUE</span>
          <h3 id="mf-exception-title">异常队列</h3>
        </div>
        <b aria-label={`${exceptions.length} 个环境待处理`}>{exceptions.length}</b>
      </div>
      <p>只优先展示已确认失败、不可用、清理失败或租约待核对的实例。</p>
      <div className="mf-exception-list">
        {exceptions.map((environment) => (
          <button
            type="button"
            key={environment.id}
            onClick={() => onDetail(environment)}
          >
            <span
              className={`mf-exception-icon${
                environment.statusTone === 'warning' ? ' warning' : ''
              }`}
            >
              <ComputeIcon
                name={environment.statusTone === 'warning' ? 'shield' : 'alert'}
              />
            </span>
            <span>
              <strong>{environment.name}</strong>
              <small>
                {environment.cleanup.state === 'failed'
                  ? environment.cleanup.errorCode ?? '删除或清理失败'
                  : environment.lease.state === 'review'
                    ? 'GPU 租约待核对，不能视为空闲'
                    : environment.statusDetail}
              </small>
            </span>
            <span className="mf-exception-link">处理</span>
          </button>
        ))}
      </div>
      {!exceptions.length && (
        <div className="mf-all-clear">
          <ComputeIcon name="check" />
          <span>
            <strong>当前没有已确认异常</strong>
            <small>仍须定期核对租约与清理结果。</small>
          </span>
        </div>
      )}
      <div className="mf-exception-boundary">
        <ComputeIcon name="shield" />
        <span>未知状态只显示“待核对”，不会自动当作失败、空闲或已删除。</span>
      </div>
    </aside>
  );
}

function EventTimeline({
  environments,
}: {
  environments: ComputeEnvironmentView[];
}) {
  const events = environments
    .flatMap((environment) =>
      environment.events.map((event) => ({ environment, event })),
    )
    .sort(
      (left, right) =>
        Date.parse(right.event.recordedAt) - Date.parse(left.event.recordedAt),
    )
    .slice(0, 6);
  return (
    <aside className="mf-panel mf-event-panel" aria-labelledby="mf-event-title">
      <div className="mf-panel-heading">
        <div>
          <span className="mf-compute-eyebrow">EVENT STREAM</span>
          <h3 id="mf-event-title">最近事件</h3>
        </div>
        <small>仅真实采集或租约事件</small>
      </div>
      {events.length ? (
        <div className="mf-event-list">
          {events.map(({ environment, event }, index) => (
            <div key={`${environment.id}-${event.id ?? event.recordedAt}-${index}`}>
              <i className={eventTone(event)} />
              <span>
                <strong>{environment.name}</strong>
                <small>{event.label}</small>
              </span>
              <time dateTime={event.recordedAt}>
                {new Date(event.recordedAt).toLocaleTimeString('zh-CN', {
                  hour: '2-digit',
                  minute: '2-digit',
                  hour12: false,
                })}
              </time>
            </div>
          ))}
        </div>
      ) : (
        <div className="mf-event-empty">
          没有可展示的真实事件来源。租约事件、状态观测或供应商事件持久化后才会出现在这里。
        </div>
      )}
    </aside>
  );
}

function eventTone(event: ComputeEvent) {
  const action = event.action.toLowerCase();
  if (action.includes('fail') || action.includes('error') || action.includes('delete')) {
    return 'danger';
  }
  if (action.includes('run') || action.includes('bound') || action.includes('reserved')) {
    return 'ok';
  }
  return 'info';
}

function Fleet({
  environments,
  loading,
  error,
  onRetry,
  onDetail,
  onAction,
}: {
  environments: ComputeEnvironmentView[];
  loading: boolean;
  error: string;
  onRetry: () => void;
  onDetail: (environment: ComputeEnvironmentView) => void;
  onAction: (action: ComputeAction, environment: ComputeEnvironmentView) => void;
}) {
  return (
    <section className="mf-panel mf-fleet-panel" aria-labelledby="mf-fleet-title">
      <div className="mf-panel-heading">
        <div>
          <span className="mf-compute-eyebrow">INSTANCE FLEET</span>
          <h3 id="mf-fleet-title">全部实例</h3>
        </div>
        <small>状态、任务、租约与清理分别呈现</small>
      </div>
      <span className="mf-sr-only" role="status" aria-live="polite" aria-atomic="true">
        {loading
          ? '正在同步实例状态'
          : error
            ? '实例状态同步失败'
            : `实例控制台共 ${environments.length} 个环境`}
      </span>
      {error && (
        <div className="mf-compute-error" role="alert">
          <ComputeIcon name="alert" />
          <span>
            <strong>实例状态读取失败</strong>
            <br />
            {error}
          </span>
          <button type="button" className="mf-secondary" onClick={onRetry}>
            重试
          </button>
        </div>
      )}
      {loading && (
        <div aria-label="正在加载实例列表" aria-busy="true">
          {[0, 1, 2].map((index) => (
            <div className="mf-skeleton" key={index} style={{ marginTop: 8 }} />
          ))}
        </div>
      )}
      {!loading && !error && environments.length === 0 && (
        <div className="mf-compute-empty">
          <span>
            <ComputeIcon name="server" size={22} />
          </span>
          <h3>还没有托管计算环境</h3>
          <p>
            真实实例列表为空。你可以从资源市场选择配置，并在服务端写入能力和 GPU
            租约均开放后创建环境。
          </p>
        </div>
      )}
      {!loading && !error && environments.length > 0 && (
        <div className="mf-fleet">
          <div className="mf-fleet-head" aria-hidden="true">
            <span>实例与关联</span>
            <span>规格 / 地域</span>
            <span>费用</span>
            <span>状态</span>
            <span>操作</span>
          </div>
          {environments.map((environment) => (
            <article className="mf-fleet-row" key={environment.id}>
              <button
                type="button"
                className="mf-fleet-name"
                onClick={() => onDetail(environment)}
              >
                <span className="mf-gpu-mark">
                  {(environment.spec.gpuType || 'ENV').slice(0, 6)}
                </span>
                <span>
                  <strong>{environment.name}</strong>
                  <small>
                    {environment.relation.label} · {environment.ownershipLabel}
                  </small>
                </span>
              </button>
              <div className="mf-fleet-spec">
                <span>
                  {environment.spec.gpuType || '规格未记录'} ·{' '}
                  {environment.spec.memoryGiB || '—'} GiB
                </span>
                <small>
                  {environment.spec.cpu || '—'} 核 · {environment.spec.region || '—'}
                </small>
              </div>
              <div className="mf-fleet-quote">
                {quoteRate(environment.quote ?? unavailableQuote()) ?? '待核对'}
              </div>
              <div className="mf-fleet-status">
                <ComputeStatusBadge
                  label={environment.statusLabel}
                  tone={environment.statusTone}
                />
                <small>{environment.statusDetail}</small>
              </div>
              <div className="mf-fleet-actions">
                <button
                  type="button"
                  onClick={() => onDetail(environment)}
                >
                  详情
                </button>
                {environment.actions.includes('start') && (
                  <button
                    type="button"
                    onClick={() => onAction('start', environment)}
                  >
                    启动
                  </button>
                )}
                {environment.actions.includes('stop') && (
                  <button
                    type="button"
                    onClick={() => onAction('stop', environment)}
                  >
                    停止
                  </button>
                )}
                {environment.actions.includes('delete') && (
                  <button
                    type="button"
                    className="danger-text"
                    onClick={() => onAction('delete', environment)}
                  >
                    删除
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
      <div className="mf-console-guide">
        <div>
          <ComputeIcon name="pause" />
          <span>
            <strong>停止 ≠ 删除</strong>
            <small>停止计算后，系统盘或对象存储费用仍可能继续。</small>
          </span>
        </div>
        <div>
          <ComputeIcon name="shield" />
          <span>
            <strong>删除前核对清理</strong>
            <small>关联任务、产物与 GPU 租约必须分别有事实来源。</small>
          </span>
        </div>
      </div>
    </section>
  );
}

export function InstanceConsole({
  environments,
  loading,
  error,
  refreshedAt,
  onRefresh,
  onRetry,
  onDetail,
  onAction,
}: {
  environments: ComputeEnvironmentView[];
  loading: boolean;
  error: string;
  refreshedAt?: string;
  onRefresh: () => void;
  onRetry: () => void;
  onDetail: (environment: ComputeEnvironmentView) => void;
  onAction: (action: ComputeAction, environment: ComputeEnvironmentView) => void;
}) {
  const active =
    environments.find((environment) => environment.status === 'running') ??
    environments.find((environment) =>
      ['creating', 'starting', 'stopping'].includes(environment.status),
    ) ??
    environments[0];
  return (
    <div className="mf-console">
      <div className="mf-console-head">
        <div>
          <span className="mf-compute-eyebrow">INSTANCE CONTROL PLANE</span>
          <h2>{environments.length} 台计算环境</h2>
          <p>
            {refreshedAt
              ? `状态读取：${new Date(refreshedAt).toLocaleString('zh-CN', {
                  hour12: false,
                })}`
              : '尚未取得实例状态时间'}
          </p>
        </div>
        <button
          type="button"
          className="mf-secondary"
          onClick={onRefresh}
          disabled={loading}
        >
          <ComputeIcon name="refresh" />
          {loading ? '刷新中' : '刷新状态'}
        </button>
      </div>
      <div className="mf-console-overview">
        {active ? (
          <ActiveRunway
            environment={active}
            onDetail={onDetail}
            onAction={onAction}
          />
        ) : (
          <div className="mf-panel mf-compute-empty">
            <span>
              <ComputeIcon name="activity" size={22} />
            </span>
            <h3>等待首个真实环境</h3>
            <p>实例创建并绑定后，这里会展示生命周期、监控与租约事实。</p>
          </div>
        )}
        <ExceptionQueue environments={environments} onDetail={onDetail} />
      </div>
      <div className="mf-console-lower">
        <Fleet
          environments={environments}
          loading={loading}
          error={error}
          onRetry={onRetry}
          onDetail={onDetail}
          onAction={onAction}
        />
        <EventTimeline environments={environments} />
      </div>
    </div>
  );
}
