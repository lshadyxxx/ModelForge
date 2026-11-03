import type { ReactNode } from 'react';
import type { ComputeQuote } from './compute-model';

export type ComputeStatus =
  | 'creating'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'stopped'
  | 'deleting'
  | 'failed'
  | 'unavailable'
  | 'unknown';

export type StatusTone = 'ok' | 'info' | 'neutral' | 'warning' | 'danger';

export type LeaseState =
  | 'unbound'
  | 'held'
  | 'releasing'
  | 'released'
  | 'review'
  | 'unknown';

export type RelationKind = 'training' | 'trial' | 'manual' | 'none' | 'unknown';

export type CleanupState =
  | 'not_requested'
  | 'stopping'
  | 'deleting'
  | 'failed'
  | 'confirmed'
  | 'unknown';

export type Freshness = 'fresh' | 'stale' | 'unconfirmed';

export type ComputeAction = 'start' | 'stop' | 'delete';

export type ComputeMetric = {
  key: string;
  label: string;
  value: string;
  max?: number;
  percent?: number;
};

export type ComputeEvent = {
  id?: string | number;
  action: string;
  label: string;
  recordedAt: string;
  source: 'platform' | 'lease' | 'provider' | 'observation';
};

export type ComputeEnvironmentView = {
  id: string;
  name: string;
  providerInstanceId?: string;
  status: ComputeStatus;
  statusLabel: string;
  statusTone: StatusTone;
  statusDetail: string;
  spec: {
    region: string;
    zone: string;
    gpuType: string;
    cpu: number;
    memoryGiB: number;
    imageId: string;
    imageName?: string;
    cpuPlatform?: string;
    chargeType?: string;
    bootDiskGiB?: number;
    bootDiskType?: string;
  };
  lease: {
    state: LeaseState;
    label: string;
    reservationId?: string;
    ownerLabel?: string;
    events?: ComputeEvent[];
  };
  relation: {
    kind: RelationKind;
    id?: string;
    label: string;
  };
  cleanup: {
    state: CleanupState;
    label: string;
    errorCode?: string;
  };
  monitor: {
    provider: 'ucloud' | 'unavailable';
    checkedAt?: string;
    metrics: ComputeMetric[];
    errorCode?: string;
  };
  ownership: 'platform' | 'managed' | 'unmanaged';
  ownershipLabel: string;
  freshness: Freshness;
  freshnessLabel: string;
  quote: ComputeQuote;
  actions: ComputeAction[];
  createdAt?: string;
  updatedAt?: string;
  events: ComputeEvent[];
};

export type ComputeConfigurationView = {
  configured: boolean;
  defaultRegion: string | null;
  mode: 'read_only' | 'read_write';
  writeEnabled: boolean;
  reason?: string;
};

export type EnvironmentCollectionView = {
  items: ComputeEnvironmentView[];
  total: number;
  fetchedAt: string;
  source: 'platform' | 'provider' | 'mixed';
  degraded: boolean;
  warnings: string[];
};

export type ComputeNotice = {
  id: number;
  tone: 'ok' | 'error';
  message: string;
};

export type ActionDialogState = {
  action: ComputeAction;
  environment: ComputeEnvironmentView;
} | null;

export type ComputeIconRenderer = (name: string, size?: number) => ReactNode;
