import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {ApiError} from '../../shared/http';
import {listAdapters, type AdapterVersion} from '../models';
import {getRuntimeBaseline, type RuntimeBaseline} from '../runtime';
import {
  bindServingInstance,
  cancelServingRequest,
  createServingTrial,
  getServingTrial,
  listServingTrials,
  openServingChat,
  stopServingTrial,
  type ServingChatInput,
} from './api';
import {BindInstancePanel} from './components/BindInstancePanel';
import {CreateTrialDialog} from './components/CreateTrialDialog';
import {ServingIcon} from './components/ServingIcon';
import {ServingQueue} from './components/ServingQueue';
import {ServingSession} from './components/ServingSession';
import {StopTrialDialog} from './components/StopTrialDialog';
import {TrialContextPanel} from './components/TrialContextPanel';
import {parseSseFrames, requestMessages, type Message} from './conversation';
import {
  deriveTrialView,
  parseServingRoute,
  servingErrorMessage,
  servingRouteQuery,
  summarizeTrials,
} from './serving-model';
import type {
  ServingRoute,
  ServingTrial,
  TrialViewState,
} from './types';
import './serving.css';

function timeLabel() {
  return new Date().toLocaleTimeString('zh-CN', {hour12: false});
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return servingErrorMessage(error.code, error.message);
  if (error instanceof Error) return error.message;
  return String(error);
}

function routeError(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 404 || error.status === 422);
}

function CenterSkeleton() {
  return <section className="serving-column serving-main serving-main-skeleton" role="status" aria-label="正在加载当前试用">
    <div className="serving-skeleton-head"><span/><span/><span/></div>
    <div className="serving-skeleton-body">
      <span className="wide"/><span/><span className="mid"/><span className="tall"/>
    </div>
  </section>;
}

function InvalidRoute({
  trialId,
  onBack,
}: {
  trialId: string;
  onBack: () => void;
}) {
  return <section className="serving-column serving-main serving-route-error">
    <span className="serving-route-error-icon"><ServingIcon name="alert" size={26}/></span>
    <span className="serving-kicker">TRIAL NOT FOUND</span>
    <h2>找不到这条试用记录</h2>
    <p>地址中的标识可能无效，记录也可能已被删除。页面保留当前 URL，没有自动选择队列中的其他 Trial。</p>
    <code>{trialId}</code>
    <div><button type="button" onClick={onBack}>返回队列</button></div>
  </section>;
}

function DetailError({
  message,
  onRefresh,
  onBack,
}: {
  message: string;
  onRefresh: () => void;
  onBack: () => void;
}) {
  return <section className="serving-column serving-main serving-route-error">
    <span className="serving-route-error-icon warning"><ServingIcon name="refresh" size={25}/></span>
    <span className="serving-kicker">DETAIL UNAVAILABLE</span>
    <h2>暂时无法读取试用详情</h2>
    <p>{message}</p>
    <div><button type="button" onClick={onRefresh}>重新读取</button><button type="button" className="secondary" onClick={onBack}>返回队列</button></div>
  </section>;
}

function EmptyWorkbench({
  hasTrials,
  onCreate,
  onOpenQueue,
}: {
  hasTrials: boolean;
  onCreate: () => void;
  onOpenQueue: () => void;
}) {
  return <section className="serving-column serving-main serving-landing">
    <div className="serving-landing-head">
      <span className="serving-landing-mark"><ServingIcon name="spark" size={24}/></span>
      <span className="serving-kicker">ONE TRIAL · ONE CLEAR PATH</span>
      <h2>把「训练成功」和「可以用」分开。</h2>
      <p>选择一条 Trial，确认它绑定了什么，完成一次真实对话，然后安全结束并核对回收事实。</p>
      <div className="serving-landing-actions">
        {hasTrials && <button type="button" onClick={onOpenQueue}><ServingIcon name="queue" size={15}/>从试用队列选择</button>}
        <button type="button" className={hasTrials ? 'secondary' : ''} onClick={onCreate}><ServingIcon name="plus" size={15}/>创建推理试用</button>
        {!hasTrials && <a className="serving-secondary-link" href="#training">查看训练产物</a>}
      </div>
    </div>
    <div className="serving-landing-flow">
      <article><span>01</span><div><strong>选一条 Trial</strong><p>队列刷新不会改变当前选择，复制 URL 可恢复当前上下文。</p></div><ServingIcon name="queue" size={19}/></article>
      <article><span>02</span><div><strong>确认实例与身份</strong><p>Adapter、基座指纹、实例规格和 GPU 租约始终可见。</p></div><ServingIcon name="gpu" size={19}/></article>
      <article><span>03</span><div><strong>生成并安全结束</strong><p>会话只在当前页面；结束后四项回收事实分别核对。</p></div><ServingIcon name="check" size={19}/></article>
    </div>
    <div className="serving-landing-note"><ServingIcon name="info" size={16}/><p>当前页面不会自动购买 GPU，也不会把停止请求显示成实例已回收。</p></div>
  </section>;
}

function Notice({
  tone,
  title,
  children,
  action,
}: {
  tone: 'warning' | 'danger';
  title: string;
  children: string;
  action?: {label: string; run: () => void};
}) {
  return <div className={`serving-page-notice ${tone}`} role={tone === 'danger' ? 'alert' : 'status'}>
    <ServingIcon name="alert" size={17}/>
    <div><strong>{title}</strong><p>{children}</p></div>
    {action && <button type="button" onClick={action.run}>{action.label}</button>}
  </div>;
}

export function Serving() {
  const [route, setRoute] = useState<ServingRoute>(() => parseServingRoute(location.search));
  const [trials, setTrials] = useState<ServingTrial[]>([]);
  const [adapters, setAdapters] = useState<AdapterVersion[]>([]);
  const [runtime, setRuntime] = useState<RuntimeBaseline | null>(null);
  const [runtimeError, setRuntimeError] = useState('');
  const [listLoading, setListLoading] = useState(true);
  const [listRefreshing, setListRefreshing] = useState(false);
  const [listError, setListError] = useState('');
  const [listStale, setListStale] = useState(false);
  const [listLoadedAt, setListLoadedAt] = useState('');
  const [detail, setDetail] = useState<ServingTrial | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [detailStale, setDetailStale] = useState(false);
  const [detailLoadedAt, setDetailLoadedAt] = useState('');
  const [invalidRoute, setInvalidRoute] = useState(false);
  const [detailRevision, setDetailRevision] = useState(0);
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState('');
  const [maxTokens, setMaxTokens] = useState(128);
  const [temperature, setTemperature] = useState(0.7);
  const [topP, setTopP] = useState(0.9);
  const [sending, setSending] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [actionError, setActionError] = useState('');
  const [busyAction, setBusyAction] = useState<'' | 'create' | 'bind' | 'stop'>('');
  const [bindingOpen, setBindingOpen] = useState(false);
  const [stoppingOpen, setStoppingOpen] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const listPending = useRef(false);
  const listAbort = useRef<AbortController | null>(null);
  const trialsRef = useRef<ServingTrial[]>([]);
  const detailRef = useRef<ServingTrial | null>(null);
  const invalidRef = useRef(false);
  const lastTrialRef = useRef('');
  const mounted = useRef(false);
  const stream = useRef<AbortController | null>(null);
  const streamGeneration = useRef(0);
  const queueTrigger = useRef<HTMLButtonElement>(null);
  const contextTrigger = useRef<HTMLButtonElement>(null);

  const visibleDetail = detail?.id === route.trialId ? detail : null;
  const rawView = visibleDetail ? deriveTrialView(visibleDetail) : null;
  const view: TrialViewState | null = rawView
    ? sending && rawView.kind !== 'ended' ? {kind: 'generating'}
      : cancelling && rawView.kind !== 'ended' ? {kind: 'cancelling'}
        : rawView
    : null;
  const selectedAdapter = useMemo(
    () => adapters.find((adapter) => adapter.id === visibleDetail?.adapter_id),
    [adapters, visibleDetail?.adapter_id],
  );
  const queueTrials = useMemo(() => trials.map((trial) => (
    trial.id === visibleDetail?.id ? {...trial, lifecycle: visibleDetail.lifecycle} : trial
  )), [trials, visibleDetail]);
  const listSummary = useMemo(() => summarizeTrials(queueTrials), [queueTrials]);

  const navigate = useCallback((next: ServingRoute, mode: 'push' | 'replace' = 'push', top = false) => {
    const search = servingRouteQuery(next);
    history[mode === 'push' ? 'pushState' : 'replaceState'](null, '', location.pathname + search + '#serving');
    setRoute(next);
    if (top) window.scrollTo({top: 0, behavior: 'smooth'});
  }, []);

  const refreshList = useCallback(async () => {
    if (listPending.current) return;
    listPending.current = true;
    const request = new AbortController();
    listAbort.current = request;
    if (trialsRef.current.length) setListRefreshing(true);
    try {
      const rows = await listServingTrials(request.signal);
      if (request.signal.aborted) return;
      setTrials(rows);
      setListError('');
      setListStale(false);
      setListLoadedAt(timeLabel());
    } catch (error) {
      if (request.signal.aborted) return;
      setListError(errorMessage(error));
      setListStale(trialsRef.current.length > 0);
    } finally {
      if (listAbort.current === request) listAbort.current = null;
      listPending.current = false;
      if (mounted.current) {
        setListLoading(false);
        setListRefreshing(false);
      }
    }
  }, []);

  const refreshDetailNow = useCallback(() => {
    invalidRef.current = false;
    setInvalidRoute(false);
    setActionError('');
    setDetailRevision((value) => value + 1);
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      streamGeneration.current += 1;
      stream.current?.abort();
      listAbort.current?.abort();
    };
  }, []);

  useEffect(() => {
    trialsRef.current = trials;
  }, [trials]);

  useEffect(() => {
    detailRef.current = detail;
  }, [detail]);

  useEffect(() => {
    const onPopState = () => setRoute(parseServingRoute(location.search));
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    const onServingNav = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const link = target.closest('a.nav-item[href="#serving"]');
      if (!link || (!route.trialId && !route.create)) return;
      event.preventDefault();
      navigate({trialId: '', create: false}, 'push', true);
    };
    document.addEventListener('click', onServingNav, true);
    return () => document.removeEventListener('click', onServingNav, true);
  }, [navigate, route.create, route.trialId]);

  useEffect(() => {
    const controller = new AbortController();
    Promise.allSettled([
      getRuntimeBaseline(controller.signal),
      listAdapters(controller.signal),
    ]).then(([runtimeResult, adapterResult]) => {
      if (controller.signal.aborted) return;
      if (runtimeResult.status === 'fulfilled') {
        setRuntime(runtimeResult.value);
        setRuntimeError('');
        setMaxTokens(runtimeResult.value.inference.conversation.max_tokens_default);
      } else {
        setRuntimeError(errorMessage(runtimeResult.reason));
      }
      if (adapterResult.status === 'fulfilled') setAdapters(adapterResult.value);
    });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    let timer = 0;
    const stop = () => {
      if (timer) window.clearInterval(timer);
      timer = 0;
    };
    const start = () => {
      stop();
      if (document.visibilityState !== 'visible') return;
      void refreshList();
      timer = window.setInterval(() => {
        if (document.visibilityState === 'visible') void refreshList();
      }, 3000);
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') start();
      else stop();
    };
    start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
      listAbort.current?.abort();
      listAbort.current = null;
      listPending.current = false;
    };
  }, [refreshList]);

  useEffect(() => {
    streamGeneration.current += 1;
    stream.current?.abort();
    stream.current = null;
    setSending(false);
    setCancelling(false);
    setMessages([]);
    setText('');
    setActionError('');
    setBindingOpen(false);
    setStoppingOpen(false);
    setDetailLoading(Boolean(route.trialId));
    setDetailError('');
    setDetailStale(false);
    setDetailLoadedAt('');
    if (!route.trialId) {
      setDetail(null);
      setInvalidRoute(false);
      invalidRef.current = false;
    }
  }, [route.trialId]);

  useEffect(() => {
    if (!visibleDetail || visibleDetail.request_state === 'idle') setCancelling(false);
  }, [visibleDetail]);

  useEffect(() => {
    const trialId = route.trialId;
    if (!trialId) return;
    if (lastTrialRef.current !== trialId) {
      lastTrialRef.current = trialId;
      invalidRef.current = false;
      setInvalidRoute(false);
    }
    let timer = 0;
    let pending = false;
    const request = new AbortController();
    const refresh = async () => {
      if (pending || request.signal.aborted || invalidRef.current) return;
      pending = true;
      const matchesTrial = detailRef.current?.id === trialId;
      if (!matchesTrial) setDetailLoading(true);
      try {
        const row = await getServingTrial(trialId, request.signal);
        if (request.signal.aborted) return;
        setDetail(row);
        setInvalidRoute(false);
        invalidRef.current = false;
        setDetailError('');
        setDetailStale(false);
        setDetailLoadedAt(timeLabel());
      } catch (error) {
        if (request.signal.aborted) return;
        if (routeError(error)) {
          invalidRef.current = true;
          setInvalidRoute(true);
          setDetail(null);
          setDetailError('');
        } else if (detailRef.current?.id === trialId) {
          setDetailError(errorMessage(error));
          setDetailStale(true);
        } else {
          setDetailError(errorMessage(error));
        }
      } finally {
        pending = false;
        if (!request.signal.aborted) setDetailLoading(false);
      }
    };
    const stop = () => {
      if (timer) window.clearInterval(timer);
      timer = 0;
    };
    const start = () => {
      stop();
      if (document.visibilityState !== 'visible') return;
      void refresh();
      timer = window.setInterval(() => {
        if (document.visibilityState === 'visible') void refresh();
      }, 2500);
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') start();
      else stop();
    };
    start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
      request.abort();
    };
  }, [detailRevision, route.trialId]);

  useEffect(() => {
    if (!queueOpen && !contextOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setQueueOpen(false);
      setContextOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [contextOpen, queueOpen]);

  function selectTrial(identifier: string) {
    setQueueOpen(false);
    setActionError('');
    navigate({trialId: identifier, create: false}, 'push', true);
  }

  function openCreate() {
    setActionError('');
    setQueueOpen(false);
    navigate({trialId: route.trialId, create: true}, 'push');
  }

  function closeCreate() {
    if (busyAction) return;
    setActionError('');
    navigate({trialId: route.trialId, create: false}, 'replace');
  }

  function openQueue() {
    setContextOpen(false);
    setQueueOpen(true);
    window.requestAnimationFrame(() => document.querySelector<HTMLElement>('#serving-queue [data-drawer-close]')?.focus());
  }

  function closeQueue() {
    setQueueOpen(false);
    window.requestAnimationFrame(() => queueTrigger.current?.focus());
  }

  function openContext() {
    setQueueOpen(false);
    setContextOpen(true);
    window.requestAnimationFrame(() => document.querySelector<HTMLElement>('.serving-context-shell [aria-label="关闭运行事实"]')?.focus());
  }

  function closeContext() {
    setContextOpen(false);
    window.requestAnimationFrame(() => contextTrigger.current?.focus());
  }

  async function createTrial(adapterId: string, instance: Parameters<typeof createServingTrial>[1]) {
    setBusyAction('create');
    setActionError('');
    try {
      const created = await createServingTrial(adapterId, instance);
      setTrials((current) => [created, ...current.filter((row) => row.id !== created.id)]);
      setDetail(created);
      setDetailLoading(false);
      setInvalidRoute(false);
      invalidRef.current = false;
      setMessages([]);
      navigate({trialId: created.id, create: false}, 'push', true);
      void refreshList();
    } catch (error) {
      setActionError(errorMessage(error));
    } finally {
      setBusyAction('');
    }
  }

  async function bindInstance(instanceId: string, acknowledgeCleanup: boolean) {
    if (!visibleDetail) return;
    setBusyAction('bind');
    setActionError('');
    try {
      const updated = await bindServingInstance(visibleDetail.id, instanceId, acknowledgeCleanup);
      setDetail(updated);
      setDetailStale(false);
      setBindingOpen(false);
      void refreshList();
      refreshDetailNow();
    } catch (error) {
      setActionError(errorMessage(error));
    } finally {
      setBusyAction('');
    }
  }

  async function requestStop() {
    if (!visibleDetail) return;
    setBusyAction('stop');
    setActionError('');
    try {
      const updated = await stopServingTrial(visibleDetail.id);
      setDetail(updated);
      setDetailStale(false);
      setStoppingOpen(false);
      setTrials((current) => current.map((row) => row.id === updated.id ? updated : row));
      refreshDetailNow();
    } catch (error) {
      setActionError(errorMessage(error));
    } finally {
      setBusyAction('');
    }
  }

  async function sendMessage() {
    if (!visibleDetail || rawView?.kind !== 'ready' || !runtime || !text.trim() || sending || detailStale) return;
    const userText = text.trim();
    const history: Message[] = [...messages, {role: 'user', content: userText}];
    const visible = [...history, {role: 'assistant' as const, content: ''}];
    const request: ServingChatInput = {
      messages: requestMessages(history),
      max_tokens: maxTokens,
      temperature,
      top_p: topP,
    };
    const controller = new AbortController();
    stream.current?.abort();
    stream.current = controller;
    const current = ++streamGeneration.current;
    const trialId = visibleDetail.id;
    let completed = false;
    setMessages(visible);
    setText('');
    setSending(true);
    setCancelling(false);
    setActionError('');
    const append = (delta: string) => {
      if (!mounted.current || current !== streamGeneration.current) return;
      setMessages((rows) => rows.map((message, index) => index === rows.length - 1
        ? {...message, content: message.content + delta}
        : message));
    };
    try {
      const response = await openServingChat(trialId, request, controller.signal);
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const {value, done} = await reader.read();
        buffer += decoder.decode(value, {stream: !done});
        const parsed = parseSseFrames(buffer);
        buffer = parsed.rest;
        for (const frame of parsed.frames) {
          if (!frame.data) continue;
          let payload: Record<string, unknown>;
          try {
            payload = JSON.parse(frame.data) as Record<string, unknown>;
          } catch {
            throw new Error('流式响应格式无法确认，已保留当前页面的部分输出。');
          }
          if (frame.event === 'delta' && typeof payload.text === 'string') append(payload.text);
          if (frame.event === 'error') {
            throw new Error(servingErrorMessage(String(payload.code ?? 'remote_request_unconfirmed')));
          }
          if (frame.event === 'done') {
            completed = true;
            if (payload.partial && current === streamGeneration.current) {
              setMessages((rows) => rows.map((message, index) => index === rows.length - 1
                ? {...message, partial: true}
                : message));
            }
          }
        }
        if (done) break;
      }
      if (!completed) throw new Error('连接结束，但生成结果尚未确认。');
    } catch (error) {
      if (mounted.current && current === streamGeneration.current) {
        const abort = error instanceof DOMException && error.name === 'AbortError';
        if (!abort) setActionError(errorMessage(error));
        setMessages((rows) => rows.map((message, index) => index === rows.length - 1
          ? {...message, partial: true}
          : message));
      }
    } finally {
      if (!completed) {
        void cancelServingRequest(trialId).catch(() => undefined);
      }
      if (mounted.current && current === streamGeneration.current) {
        setSending(false);
        setCancelling(false);
        setDetailRevision((value) => value + 1);
      }
      if (stream.current === controller) stream.current = null;
    }
  }

  async function cancelGeneration() {
    if (!visibleDetail || cancelling) return;
    setCancelling(true);
    setActionError('');
    try {
      const updated = await cancelServingRequest(visibleDetail.id);
      setDetail(updated);
      setDetailRevision((value) => value + 1);
    } catch (error) {
      setCancelling(false);
      setActionError(errorMessage(error));
    }
  }

  const createOpen = route.create;
  const showCenterSkeleton = route.trialId
    ? !visibleDetail && detailLoading && !invalidRoute && !detailError
    : listLoading && !trials.length;

  return <div className="serving-page">
    <header className="serving-page-heading">
      <div>
        <span className="serving-eyebrow">SERVING / INDEPENDENT INFERENCE</span>
        <h1>推理试用工作台</h1>
        <p>从已同步 Adapter 创建独立试用，验证真实生成，并把停止请求与实例回收事实分开。</p>
      </div>
      <div className="serving-heading-actions">
        <span>队列读取 <strong>{listLoadedAt || '尚未刷新'}</strong></span>
        <button ref={queueTrigger} type="button" className="serving-mobile-queue-toggle secondary" onClick={openQueue}><ServingIcon name="queue" size={15}/>试用队列</button>
        <button type="button" className="serving-mobile-context-toggle secondary" onClick={openContext}><ServingIcon name="panel" size={15}/>运行事实</button>
        <button type="button" className="secondary" onClick={() => {void refreshList(); refreshDetailNow();}} disabled={listRefreshing}><ServingIcon name="refresh" size={15}/>{listRefreshing ? '刷新中' : '刷新'}</button>
        <button type="button" onClick={openCreate}><ServingIcon name="plus" size={15}/>新建试用</button>
      </div>
    </header>

    {listError && <Notice
      tone={listStale ? 'warning' : 'danger'}
      title={listStale ? '队列刷新失败，保留上次结果' : '无法读取试用队列'}
      action={{label: '重新读取', run: () => void refreshList()}}
    >{listError}</Notice>}
    {!listError && listStale && <Notice tone="warning" title="当前显示上次队列结果" action={{label: '重新读取', run: () => void refreshList()}}>最近一次刷新失败。数据可能已经过期，发送操作会保持禁用。</Notice>}
    {detailStale && visibleDetail && <Notice tone="warning" title="当前 Trial 详情已过期" action={{label: '重新读取', run: refreshDetailNow}}>{detailError || `最近一次详情读取失败。页面保留 ${detailLoadedAt || '上次'} 的结果。`}</Notice>}

    {(queueOpen || contextOpen) && <button type="button" className="serving-scrim" aria-label="关闭侧栏" onClick={() => {
      setQueueOpen(false);
      setContextOpen(false);
    }}/>}

    <div className="serving-workbench">
      <ServingQueue
        trials={queueTrials}
        adapters={adapters}
        selectedId={route.trialId}
        loading={listLoading}
        refreshing={listRefreshing}
        lastLoadedAt={listLoadedAt}
        mobileOpen={queueOpen}
        onSelect={selectTrial}
        onCreate={openCreate}
        onRefresh={() => void refreshList()}
        onClose={closeQueue}
      />

      {showCenterSkeleton ? <CenterSkeleton/> : !route.trialId ? <EmptyWorkbench
        hasTrials={trials.length > 0}
        onCreate={openCreate}
        onOpenQueue={openQueue}
      /> : invalidRoute ? <InvalidRoute
        trialId={route.trialId}
        onBack={() => navigate({trialId: '', create: false}, 'push', true)}
      /> : !visibleDetail && detailError ? <DetailError
        message={detailError}
        onRefresh={refreshDetailNow}
        onBack={() => navigate({trialId: '', create: false}, 'push', true)}
      /> : visibleDetail && view ? <ServingSession
        trial={visibleDetail}
        view={view}
        adapter={selectedAdapter}
        runtime={runtime}
        runtimeError={runtimeError}
        stale={detailStale}
        lastLoadedAt={detailLoadedAt}
        messages={messages}
        text={text}
        sending={sending}
        cancelling={cancelling}
        actionError={actionError}
        maxTokens={maxTokens}
        temperature={temperature}
        topP={topP}
        onText={setText}
        onMaxTokens={setMaxTokens}
        onTemperature={setTemperature}
        onTopP={setTopP}
        onSend={() => void sendMessage()}
        onStop={() => void cancelGeneration()}
        onClear={() => setMessages([])}
        onOpenBind={() => {setActionError(''); setBindingOpen(true);}}
        onCreate={openCreate}
        onRefresh={refreshDetailNow}
      /> : <CenterSkeleton/>}

      <TrialContextPanel
        trial={visibleDetail}
        view={view}
        adapter={selectedAdapter}
        mobileOpen={contextOpen}
        onOpenBind={() => {setActionError(''); setBindingOpen(true);}}
        onStop={() => {setActionError(''); setStoppingOpen(true);}}
        onClose={closeContext}
      />
    </div>

    <div className="serving-page-foot">
      <span><i className={listSummary.attention ? 'attention' : ''}/>{listSummary.attention ? `${listSummary.attention} 条试用需要核对` : '队列中暂无需要人工核对的状态'}</span>
      <span>Serving F1.1 · 会话不持久化 · 状态事实来自后端</span>
    </div>

    {createOpen && <CreateTrialDialog
      adapters={adapters}
      runtime={runtime}
      runtimeError={runtimeError}
      busy={busyAction === 'create'}
      error={busyAction === 'create' ? '' : actionError}
      onClose={closeCreate}
      onCreate={createTrial}
    />}
    {bindingOpen && visibleDetail && <BindInstancePanel
      trial={visibleDetail}
      busy={busyAction === 'bind'}
      error={busyAction === 'bind' ? '' : actionError}
      onClose={() => {if (!busyAction) {setBindingOpen(false); setActionError('');}}}
      onBind={bindInstance}
    />}
    {stoppingOpen && visibleDetail && <StopTrialDialog
      trial={visibleDetail}
      busy={busyAction === 'stop'}
      error={busyAction === 'stop' ? '' : actionError}
      onClose={() => {if (!busyAction) {setStoppingOpen(false); setActionError('');}}}
      onConfirm={() => void requestStop()}
    />}
  </div>;
}
