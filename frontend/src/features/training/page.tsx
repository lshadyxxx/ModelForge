import {useCallback, useEffect, useRef, useState} from 'react';
import {
  bindTrainingInstance,
  cancelTrainingAttempt,
  getTrainingAttempt,
  listTrainingAttempts,
  listTrainingLogs,
  retryTrainingAttempt,
} from './api';
import {TrainingLegacy} from './TrainingLegacy';
import {AttemptDetail} from './components/AttemptDetail';
import {CreateTrainingWizard} from './components/CreateTrainingWizard';
import {TrainingIcon} from './components/TrainingIcon';
import {TrainingWorkbench} from './components/TrainingWorkbench';
import {
  formatDateTime,
  parseTrainingRoute,
  trainingRouteQuery,
} from './training-model';
import type {
  LogChunk,
  TrainingAttempt,
  TrainingAttemptSummary,
  TrainingRoute,
  TrainingTab,
} from './types';
import './training.css';

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function currentTimeLabel() {
  return new Date().toLocaleTimeString('zh-CN', {hour12: false});
}

export function Training() {
  const [route, setRoute] = useState<TrainingRoute>(() => parseTrainingRoute(location.search));
  const [attempts, setAttempts] = useState<TrainingAttemptSummary[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listRefreshing, setListRefreshing] = useState(false);
  const [listError, setListError] = useState('');
  const [listStale, setListStale] = useState(false);
  const [lastLoadedAt, setLastLoadedAt] = useState('');
  const [detail, setDetail] = useState<TrainingAttempt | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [detailStale, setDetailStale] = useState(false);
  const [logs, setLogs] = useState<LogChunk[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsError, setLogsError] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const [detailRevision, setDetailRevision] = useState(0);
  const [logsRevision, setLogsRevision] = useState(0);
  const attemptsRef = useRef<TrainingAttemptSummary[]>([]);
  const detailRef = useRef<TrainingAttempt | null>(null);
  const listPending = useRef(false);
  const listAbort = useRef<AbortController | null>(null);

  useEffect(() => {
    attemptsRef.current = attempts;
  }, [attempts]);

  useEffect(() => {
    detailRef.current = detail;
  }, [detail]);

  useEffect(() => {
    const onPopState = () => setRoute(parseTrainingRoute(location.search));
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const navigate = useCallback((next: Partial<TrainingRoute>) => {
    setRoute((current) => {
      const value: TrainingRoute = {
        legacy: next.legacy ?? current.legacy,
        create: next.create ?? false,
        attemptId: next.attemptId ?? '',
        tab: next.tab ?? 'overview',
      };
      const search = trainingRouteQuery(value);
      history.pushState(null, '', location.pathname + search + '#training');
      return value;
    });
    window.scrollTo({top: 0, behavior: 'smooth'});
  }, []);

  useEffect(() => {
    const onTrainingNav = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const link = target.closest('a.nav-item[href="#training"]');
      if (!link) return;
      if (route.create || route.attemptId) {
        event.preventDefault();
        navigate({create: false, attemptId: '', tab: 'overview'});
      }
    };
    document.addEventListener('click', onTrainingNav, true);
    return () => document.removeEventListener('click', onTrainingNav, true);
  }, [navigate, route.attemptId, route.create]);

  const refreshList = useCallback(async () => {
    if (listPending.current) return;
    listPending.current = true;
    setListRefreshing(true);
    const request = new AbortController();
    listAbort.current = request;
    try {
      const rows = await listTrainingAttempts(request.signal);
      if (request.signal.aborted) return;
      setAttempts(rows);
      setListError('');
      setListStale(false);
      setLastLoadedAt(currentTimeLabel());
    } catch (error) {
      if (request.signal.aborted) return;
      const message = errorMessage(error);
      setListError(message);
      setListStale(attemptsRef.current.length > 0);
    } finally {
      if (!request.signal.aborted) {
        setListLoading(false);
        setListRefreshing(false);
      }
      if (listAbort.current === request) listAbort.current = null;
      listPending.current = false;
    }
  }, []);

  useEffect(() => {
    if (route.legacy || route.create) {
      setListLoading(false);
      return;
    }
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
  }, [refreshList, route.create, route.legacy]);

  useEffect(() => {
    const attemptId = route.attemptId;
    if (!attemptId || route.legacy || route.create) {
      setDetail(null);
      setDetailError('');
      setDetailStale(false);
      setLogs([]);
      setLogsError('');
      return;
    }
    let timer = 0;
    let pending = false;
    const request = new AbortController();
    setDetail((current) => current?.id === attemptId ? current : null);
    setLogs((current) => current.length ? [] : current);

    const refresh = async (withLogs: boolean) => {
      if (pending || request.signal.aborted) return;
      pending = true;
      if (!detailRef.current) setDetailLoading(true);
      if (withLogs) setLogsLoading(true);
      try {
        const [attemptResult, logResult] = await Promise.allSettled([
          getTrainingAttempt(attemptId, request.signal),
          withLogs ? listTrainingLogs(attemptId, request.signal) : Promise.resolve(null),
        ]);
        if (request.signal.aborted) return;
        if (attemptResult.status === 'fulfilled') {
          setDetail(attemptResult.value);
          setDetailError('');
          setDetailStale(false);
        } else {
          const failure = attemptResult.reason;
          if (!(failure instanceof DOMException && failure.name === 'AbortError')) {
            setDetailError(errorMessage(failure));
            setDetailStale((current) => current || Boolean(detailRef.current));
          }
        }
        if (withLogs) {
          if (logResult.status === 'fulfilled' && logResult.value !== null) {
            setLogs(logResult.value);
            setLogsError('');
          } else if (logResult.status === 'rejected') {
            const failure = logResult.reason;
            if (!(failure instanceof DOMException && failure.name === 'AbortError')) {
              setLogsError(errorMessage(failure));
            }
          }
        }
      } finally {
        pending = false;
        if (!request.signal.aborted) {
          setDetailLoading(false);
          setLogsLoading(false);
        }
      }
    };

    const stop = () => {
      if (timer) window.clearInterval(timer);
      timer = 0;
    };
    const start = () => {
      stop();
      if (document.visibilityState !== 'visible') return;
      void refresh(route.tab === 'logs');
      timer = window.setInterval(() => {
        if (document.visibilityState === 'visible') void refresh(route.tab === 'logs');
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
  }, [detailRevision, logsRevision, route.attemptId, route.create, route.legacy, route.tab]);

  async function performAction(action: () => Promise<TrainingAttempt>) {
    setBusy(true);
    setActionError('');
    try {
      const updated = await action();
      setDetail(updated);
      setDetailError('');
      setDetailStale(false);
      setAttempts((current) => {
        const exists = current.some((row) => row.id === updated.id);
        return exists ? current.map((row) => row.id === updated.id ? updated : row) : [updated, ...current];
      });
      void refreshList();
      return updated;
    } catch (error) {
      setActionError(errorMessage(error));
      return null;
    } finally {
      setBusy(false);
    }
  }

  if (route.legacy) return <TrainingLegacy/>;

  if (route.create) {
    return <CreateTrainingWizard
      onCancel={() => navigate({create: false, attemptId: '', tab: 'overview'})}
      onCreated={(attempt) => {
        setAttempts((current) => [attempt, ...current.filter((row) => row.id !== attempt.id)]);
        setDetail(attempt);
        navigate({create: false, attemptId: attempt.id, tab: 'overview'});
        void refreshList();
      }}
    />;
  }

  if (route.attemptId) {
    const visibleAttempt = detail?.id === route.attemptId ? detail : null;
    if (!visibleAttempt && !detailError) {
      return <div className="training-page-shell">
        <div className="training-detail-loading" role="status" aria-label="正在加载训练运行详情">
          <span className="training-spinner"/>
          <div><strong>正在读取训练运行</strong><p>加载 Attempt 身份、生命周期、日志和产物边界。</p></div>
        </div>
      </div>;
    }
    if (!visibleAttempt) {
      return <div className="training-page-shell">
        <button type="button" className="training-back" onClick={() => navigate({attemptId: '', create: false, tab: 'overview'})}><TrainingIcon name="back" size={16}/>训练工作台</button>
        <section className="training-error-panel">
          <TrainingIcon name="alert" size={24}/>
          <div><h2>无法打开发训练运行</h2><p>{detailError || '该 Attempt 不存在，或当前连接无法读取详情。'}</p><button type="button" onClick={() => setDetailRevision((value) => value + 1)}>重新读取</button></div>
        </section>
      </div>;
    }
    return <AttemptDetail
      attempt={visibleAttempt}
      tab={route.tab}
      logs={logs}
      logsLoading={logsLoading}
      logsError={logsError}
      stale={detailStale || listStale}
      refreshError={detailError}
      busy={busy}
      actionError={actionError}
      onBack={() => navigate({attemptId: '', create: false, tab: 'overview'})}
      onOpenTab={(tab: TrainingTab) => navigate({attemptId: visibleAttempt.id, create: false, tab})}
      onRefresh={() => setDetailRevision((value) => value + 1)}
      onRefreshLogs={() => setLogsRevision((value) => value + 1)}
      onBind={async (instanceId, acknowledgeCleanup) => {
        await performAction(() => bindTrainingInstance(visibleAttempt.id, instanceId, acknowledgeCleanup));
      }}
      onCancel={async () => {
        await performAction(() => cancelTrainingAttempt(visibleAttempt.id));
      }}
      onRetry={async () => {
        const created = await performAction(() => retryTrainingAttempt(visibleAttempt.id));
        if (created) navigate({attemptId: created.id, create: false, tab: 'overview'});
      }}
    />;
  }

  return <TrainingWorkbench
    attempts={attempts}
    loading={listLoading}
    refreshing={listRefreshing}
    stale={listStale}
    error={listError}
    lastLoadedAt={lastLoadedAt}
    onRefresh={() => void refreshList()}
    onCreate={() => navigate({create: true, attemptId: '', tab: 'overview'})}
    onOpenAttempt={(attemptId, tab = 'overview') => navigate({create: false, attemptId, tab})}
  />;
}
