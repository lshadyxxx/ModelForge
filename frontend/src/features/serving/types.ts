import type {InstanceSpec} from '../resources';

export type ServingRoute = {
  trialId: string;
  create: boolean;
};

export type LifecycleAction =
  | 'reserved'
  | 'creation_requested'
  | 'instance_bound'
  | 'execution_requested'
  | 'process_exited'
  | 'cleanup_allowed'
  | 'instance_stopped'
  | 'deletion_failed'
  | 'deletion_confirmed'
  | 'released'
  | string;

export type LifecycleEvent = {
  action: LifecycleAction;
  recorded_at: string;
};

export type TrialLifecycle =
  | {status: 'not_reserved'}
  | {status: 'unavailable'; error_code: string}
  | {
      status: 'tracked';
      creation: {
        state: 'not_requested' | 'requested' | 'bound' | string;
      };
      process: {
        state: 'not_started' | 'unknown' | 'exited' | string;
        exit_code: number | null;
        cancelled: boolean;
        exited_at: string | null;
      };
      instance: {
        state: 'none' | 'unknown' | 'stopped' | 'deleted' | string;
        stopped_at: string | null;
        deleted_at: string | null;
      };
      cleanup: {
        policy: 'discard' | 'outputs_persisted' | null;
        state: 'not_requested' | 'pending' | 'failed' | 'confirmed' | string;
        error_code: string | null;
      };
      lease: {
        state: 'held' | 'released' | string;
        created_at: string;
        released_at: string | null;
      };
      events: LifecycleEvent[];
    };

export type ServingTrial = {
  id: string;
  state: string;
  adapter_id: string;
  instance_id?: string | null;
  lease_id?: string | null;
  error_code?: string | null;
  stop_requested: boolean;
  request_state: string;
  request_cancel_requested: boolean;
  last_activity_at: string;
  created_at?: string;
  updated_at?: string;
  stream_alive_until?: string | null;
  snapshot: {
    base: {
      id: string;
      fingerprint: string;
    };
    instance: InstanceSpec;
    adapter_fingerprint: string;
    config?: {
      template?: string;
      cutoff_len?: number;
      lora_rank?: number;
    };
    compatibility?: unknown;
  };
  lifecycle?: TrialLifecycle;
};

export type TrialViewState =
  | {kind: 'loading'}
  | {kind: 'invalid_route'; trialId: string}
  | {kind: 'queued'}
  | {kind: 'waiting_instance'}
  | {kind: 'preparing'}
  | {kind: 'ready'}
  | {kind: 'generating'}
  | {kind: 'cancelling'}
  | {kind: 'request_unknown'}
  | {
      kind: 'ending';
      phase: 'stop_requested' | 'process_exited' | 'cleanup_pending' | 'lease_pending';
    }
  | {kind: 'blocked'}
  | {kind: 'ended'; receipt: 'complete' | 'no_instance' | 'incomplete'}
  | {kind: 'unknown'; rawState: string; rawRequestState: string};

export type ReceiptConclusion = 'reclaimed' | 'no_instance' | 'incomplete';

export type ServingTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

export type TrialPresentation = {
  label: string;
  shortLabel: string;
  description: string;
  tone: ServingTone;
  canChat: boolean;
};

export type QueueSummary = {
  active: number;
  waiting: number;
  ready: number;
  attention: number;
};
