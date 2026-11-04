import type {
  QueueSummary,
  ReceiptConclusion,
  ServingRoute,
  ServingTone,
  ServingTrial,
  TrialLifecycle,
  TrialPresentation,
  TrialViewState,
} from './types';

export function parseServingRoute(search: string): ServingRoute {
  const query = new URLSearchParams(search);
  return {
    trialId: (query.get('trial') ?? '').trim(),
    create: query.get('view') === 'create',
  };
}

export function servingRouteQuery(route: ServingRoute): string {
  const query = new URLSearchParams();
  const trialId = route.trialId.trim();
  if (trialId) query.set('trial', trialId);
  if (route.create) query.set('view', 'create');
  const value = query.toString();
  return value ? `?${value}` : '';
}

export function shortId(value: string | null | undefined, length = 8): string {
  if (!value) return '—';
  return value.length <= length ? value : value.slice(0, length);
}

export function formatDateTime(value?: string | null): string {
  if (!value) return '尚未记录';
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return value;
  return new Date(parsed).toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

export function formatClock(value?: string | null): string {
  if (!value) return '尚未记录';
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return value;
  return new Date(parsed).toLocaleTimeString('zh-CN', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function formatRemaining(lastActivityAt: string, nowMs: number): string {
  const lastActivity = Date.parse(lastActivityAt);
  if (!Number.isFinite(lastActivity)) return '回收时间待确认';
  const seconds = Math.max(0, Math.ceil((lastActivity + 15 * 60_000 - nowMs) / 1000));
  if (seconds === 0) return '即将请求回收';
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? `${minutes} 分 ${rest} 秒` : `${minutes} 分钟`;
}

export function classifyReceipt(lifecycle?: TrialLifecycle): ReceiptConclusion {
  if (!lifecycle) return 'incomplete';
  if (lifecycle.status === 'not_reserved') return 'no_instance';
  if (lifecycle.status === 'unavailable') return 'incomplete';
  if (lifecycle.lease.state !== 'released' || !lifecycle.lease.released_at) return 'incomplete';

  const neverCreated = lifecycle.creation.state === 'not_requested'
    && lifecycle.instance.state === 'none'
    && lifecycle.process.state === 'not_started'
    && lifecycle.cleanup.state === 'not_requested';
  if (neverCreated) return 'no_instance';

  const instanceReclaimed = lifecycle.process.state !== 'unknown'
    && lifecycle.instance.state === 'deleted'
    && lifecycle.cleanup.state === 'confirmed';
  return instanceReclaimed ? 'reclaimed' : 'incomplete';
}

function endingPhase(trial: ServingTrial): Extract<TrialViewState, {kind: 'ending'}> {
  const lifecycle = trial.lifecycle;
  if (lifecycle?.status === 'tracked') {
    if (lifecycle.instance.state === 'deleted' && lifecycle.lease.state === 'held') {
      return {kind: 'ending', phase: 'lease_pending'};
    }
    if (lifecycle.cleanup.state !== 'not_requested') {
      return {kind: 'ending', phase: 'cleanup_pending'};
    }
    if (lifecycle.process.state === 'exited') {
      return {kind: 'ending', phase: 'process_exited'};
    }
  }
  return {kind: 'ending', phase: 'stop_requested'};
}

export function deriveTrialView(trial: ServingTrial): TrialViewState {
  const state = trial.state || 'unknown';
  const requestState = trial.request_state || 'unknown';

  if (state === 'blocked') return {kind: 'blocked'};
  if (state === 'stopped') {
    const receipt = classifyReceipt(trial.lifecycle);
    return {
      kind: 'ended',
      receipt: receipt === 'reclaimed' ? 'complete' : receipt === 'no_instance' ? 'no_instance' : 'incomplete',
    };
  }
  if (requestState === 'unknown') return {kind: 'request_unknown'};
  if (trial.stop_requested || state === 'stopping') return endingPhase(trial);
  if (requestState === 'cancelling' || trial.request_cancel_requested) return {kind: 'cancelling'};
  if (requestState === 'running') {
    if (state === 'ready') return {kind: 'generating'};
    if (state === 'preparing') return {kind: 'preparing'};
    return {kind: 'unknown', rawState: state, rawRequestState: requestState};
  }
  if (state === 'waiting_instance') return {kind: 'waiting_instance'};
  if (state === 'preparing') return {kind: 'preparing'};
  if (state === 'queued') return {kind: 'queued'};
  if (state === 'ready' && requestState === 'idle') return {kind: 'ready'};
  return {kind: 'unknown', rawState: state, rawRequestState: requestState};
}

export function trialPresentation(view: TrialViewState): TrialPresentation {
  switch (view.kind) {
    case 'loading':
      return {label: '正在读取', shortLabel: '读取中', description: '正在读取试用详情与运行事实。', tone: 'neutral', canChat: false};
    case 'invalid_route':
      return {label: '找不到试用', shortLabel: '无效', description: '这条试用记录不存在或地址无效，队列不会被自动改写。', tone: 'danger', canChat: false};
    case 'queued':
      return {label: '已入队', shortLabel: '排队', description: '后台正在为这次试用申请独立 GPU 租约。', tone: 'info', canChat: false};
    case 'waiting_instance':
      return {label: '等待独立实例', shortLabel: '等实例', description: '请手动创建一台独立 GPU 实例，再回到这里关联。', tone: 'warning', canChat: false};
    case 'preparing':
      return {label: '正在准备推理', shortLabel: '准备中', description: '正在核验运行时、基座与 Adapter，并通过真实生成探测后才算就绪。', tone: 'info', canChat: false};
    case 'ready':
      return {label: '可以试用', shortLabel: '就绪', description: '服务已通过真实 Adapter 探测，可以开始当前页面会话。', tone: 'success', canChat: true};
    case 'generating':
      return {label: '正在生成', shortLabel: '生成中', description: '请求正在推理，增量输出会在下方实时出现。', tone: 'info', canChat: false};
    case 'cancelling':
      return {label: '正在停止生成', shortLabel: '停止中', description: '已提交停止请求，正在等待远端确认当前生成退出。', tone: 'warning', canChat: false};
    case 'request_unknown':
      return {label: '上次生成状态未知', shortLabel: '待核对', description: '后台尚未确认上一请求结果。为避免重复占用，暂不允许继续发送。', tone: 'warning', canChat: false};
    case 'ending': {
      const labels = {
        stop_requested: ['正在结束', '停止已提交，后台正在等待远端进程与实例事实。'],
        process_exited: ['进程已退出', '正在核对实例删除、清理结果与 GPU 租约。'],
        cleanup_pending: ['正在回收实例', '清理请求已发出，实例删除与租约释放尚未同时确认。'],
        lease_pending: ['实例已删除，等待释放租约', '实例删除事实已出现，但 GPU 租约仍未确认释放。'],
      } as const;
      const [label, description] = labels[view.phase];
      return {label, shortLabel: '结束中', description, tone: 'warning', canChat: false};
    }
    case 'blocked':
      return {label: '需要处理', shortLabel: '阻塞', description: '运行时已退出或出现需要人工核对的错误，服务和实例不会被伪装成成功。', tone: 'danger', canChat: false};
    case 'ended': {
      if (view.receipt === 'complete') {
        return {label: '已结束 · 实例已回收', shortLabel: '已回收', description: '进程退出、实例删除、清理确认与租约释放均有记录。', tone: 'success', canChat: false};
      }
      if (view.receipt === 'no_instance') {
        return {label: '已结束 · 未占用实例', shortLabel: '已结束', description: '这次试用没有留下云实例或 GPU 租约。', tone: 'neutral', canChat: false};
      }
      return {label: '已结束 · 回收事实待核对', shortLabel: '待核对', description: 'Trial 已停止，但完整回收事实尚不可读或尚未全部成立。', tone: 'warning', canChat: false};
    }
    case 'unknown':
      return {
        label: '状态尚未识别',
        shortLabel: '未知',
        description: `后端返回 ${view.rawState} / ${view.rawRequestState}；页面不会把它推断为可用。`,
        tone: 'warning',
        canChat: false,
      };
  }
}

export function isAttentionState(view: TrialViewState): boolean {
  return ['blocked', 'request_unknown', 'invalid_route', 'unknown'].includes(view.kind)
    || (view.kind === 'ended' && view.receipt === 'incomplete');
}

export function queuePresentation(trial: ServingTrial): TrialPresentation {
  const view = deriveTrialView(trial);
  if (trial.state === 'stopped' && !trial.lifecycle) {
    return {
      label: '已结束 · 打开详情核对回收事实',
      shortLabel: '已结束',
      description: '队列只读取试用摘要；进程、实例、清理和租约事实需要在详情中核对。',
      tone: 'neutral',
      canChat: false,
    };
  }
  return trialPresentation(view);
}

export function summarizeTrials(trials: ServingTrial[]): QueueSummary {
  return trials.reduce<QueueSummary>((summary, trial) => {
    const view = deriveTrialView(trial);
    if (['queued', 'preparing', 'generating', 'cancelling', 'ending'].includes(view.kind)) summary.active += 1;
    if (view.kind === 'waiting_instance') summary.waiting += 1;
    if (view.kind === 'ready') summary.ready += 1;
    if (isAttentionState(view) && !(trial.state === 'stopped' && !trial.lifecycle)) summary.attention += 1;
    return summary;
  }, {active: 0, waiting: 0, ready: 0, attention: 0});
}

export function toneClass(tone: ServingTone): string {
  return `is-${tone}`;
}

export function servingErrorMessage(code: string, fallback?: string): string {
  const messages: Record<string, string> = {
    gpu_busy: '已有训练或试用占用 GPU。请先完成现有实例回收，再创建新的试用。',
    base_region_mismatch: '所选地域与基座固定地域不一致，请选择基座支持的地域。',
    trial_not_waiting: '这条试用已不在等待实例阶段。页面将刷新，请按最新状态操作。',
    manual_binding_ack_required: '必须确认你拥有该实例，并授权平台在结束后停止和删除它。',
    manual_instance_not_running: '实例不存在、未处于 Running，或规格与冻结要求不一致。',
    manual_binding_conflict: '该实例或 GPU 租约已有关联记录，不能重复绑定。',
    gpu_instance_conflict: '实例身份与当前试用记录冲突，请核对后刷新。',
    gpu_creation_conflict: '当前 GPU 已有创建意图或绑定，不能重复提交。',
    trial_busy: '当前试用已有活动或未确认的生成请求，请等待状态恢复。',
    gpu_release_unverified: '实例回收事实尚未全部成立，平台不会显示已释放。',
    gpu_runtime_incompatible: '实例运行时与已锁定的推理环境不一致，请更换实例。',
    adapter_probe_pending: '服务仍在执行真实 Adapter 探测，请稍后刷新。',
    remote_launch_unconfirmed: '远端启动或退出事实缺失，实例会被保留以供核对。',
    remote_process_unknown: '远端进程状态无法确认，当前不能继续生成。',
    request_state_unknown: '上一请求结果未知，请等待后台核对完成。',
    remote_request_unconfirmed: '流式连接已断开，结果尚未确认；已保留当前页面的部分输出。',
    lifecycle_unavailable: '回收事实暂时不可读，请保留实例并稍后刷新核对。',
    not_found: '找不到这条试用记录，它可能已被删除。',
    validation_error: '地址中的试用标识无效。',
    network_error: '连接中断，结果可能尚未确认。请保留页面并重试读取。',
  };
  return messages[code] ?? fallback ?? code;
}
