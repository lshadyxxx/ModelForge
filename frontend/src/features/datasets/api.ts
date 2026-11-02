import { api } from '../../shared/http.ts';

export type MessageRole = 'system' | 'user' | 'assistant';

export type DatasetMessage = {
  role: MessageRole;
  content: string;
};

export type DatasetPreviewSample = {
  line: number;
  messages: DatasetMessage[];
};

export type DatasetSample = DatasetPreviewSample & {
  raw: string;
  split: 'train' | 'validation' | null;
};

export type DatasetSamplePage = {
  version_id: string;
  sha256: string;
  line_count: number;
  sample_count: number;
  offset: number;
  limit: number;
  next_offset: number | null;
  samples: DatasetSample[];
};

export type DatasetValidationError = {
  line: number;
  path: string;
  message: string;
};

export type DatasetReference = {
  reference_type: string;
  reference_id: string;
  created_at?: string;
};

export type DatasetDerivedVersion = {
  version_id: string;
  version_number: number;
  created_at?: string;
};

export type DatasetVersionRow = {
  dataset_id: string;
  name: string;
  dataset_created_at?: string;
  version_id: string;
  version_number: number;
  state: string;
  size_bytes: number;
  sha256: string;
  sample_count: number;
  line_count: number;
  version_created_at: string;
  published_at: string | null;
};

export type DatasetVersion = {
  id: string;
  dataset_id: string;
  dataset_name: string;
  version_number: number;
  state: string;
  bucket: string;
  object_key: string;
  size_bytes: number;
  sha256: string;
  line_count: number;
  sample_count: number;
  validation_errors: DatasetValidationError[];
  preview: DatasetPreviewSample[];
  split_sha256: string | null;
  split_ratio: number | null;
  split_seed: number | null;
  split: {
    train_count: number;
    validation_count: number;
    sample_count: number;
    requested_ratio: number;
    actual_ratio: number;
    seed: number;
  } | null;
  references: DatasetReference[];
  derived_versions: DatasetDerivedVersion[];
  created_at?: string;
  updated_at?: string;
  published_at?: string | null;
  derived_from_version_id: string | null;
};

export type DatasetLimits = {
  file_limit_bytes: number;
  sample_limit: number;
  line_limit_bytes: number;
  validation_error_limit: number;
  preview_samples: number;
  configuration_version: string;
  locked: boolean;
};

export type DatasetGroup = {
  id: string;
  name: string;
  versions: DatasetVersionRow[];
  latest: DatasetVersionRow;
};

export const datasetStateLabels: Record<string, string> = {
  draft: '待发布',
  published: '已发布',
  invalid: '校验不通过',
  pending: '待处理',
  upload_failed: '上传失败',
  deleting: '删除中',
  delete_failed: '删除失败',
};

export function datasetStateLabel(state: string) {
  return datasetStateLabels[state] ?? state;
}

export function datasetShortId(datasetId: string) {
  return `DT-${datasetId.replaceAll('-', '').slice(0, 8).toUpperCase()}`;
}

export function groupDatasetRows(rows: DatasetVersionRow[]): DatasetGroup[] {
  const grouped = new Map<string, DatasetVersionRow[]>();
  for (const row of rows) {
    const versions = grouped.get(row.dataset_id) ?? [];
    versions.push(row);
    grouped.set(row.dataset_id, versions);
  }
  return [...grouped.entries()]
    .map(([id, versions]) => {
      versions.sort((left, right) => right.version_number - left.version_number);
      return { id, name: versions[0].name, versions, latest: versions[0] };
    })
    .sort((left, right) => {
      const leftTime = Date.parse(left.latest.version_created_at);
      const rightTime = Date.parse(right.latest.version_created_at);
      return rightTime - leftTime;
    });
}

export function fetchDatasetRows(signal?: AbortSignal) {
  return api<DatasetVersionRow[]>('/datasets', { signal });
}

export function fetchDatasetLimits(signal?: AbortSignal) {
  return api<DatasetLimits>('/datasets/limits', { signal });
}

export function fetchDatasetVersion(versionId: string, signal?: AbortSignal) {
  return api<DatasetVersion>(`/dataset-versions/${versionId}`, { signal });
}

export function fetchDatasetSamples(
  versionId: string,
  offset = 0,
  limit = 50,
  signal?: AbortSignal,
) {
  const query = new URLSearchParams({ offset: String(offset), limit: String(limit) });
  return api<DatasetSamplePage>(`/dataset-versions/${versionId}/samples?${query}`, { signal });
}

export function appendDatasetSamplePage(
  current: DatasetSamplePage | null,
  next: DatasetSamplePage,
  expectedVersionId: string,
) {
  if (
    !current
    || current.version_id !== expectedVersionId
    || next.version_id !== expectedVersionId
  ) {
    return current;
  }
  return {
    ...next,
    offset: current.offset,
    samples: [...current.samples, ...next.samples],
  };
}

export function createDataset(name: string, file: File, signal?: AbortSignal) {
  return api<DatasetVersion>(`/datasets?name=${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-ndjson' },
    body: file,
    signal,
  });
}

export function createDatasetVersion(datasetId: string, file: File, signal?: AbortSignal) {
  return api<DatasetVersion>(`/datasets/${datasetId}/versions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-ndjson' },
    body: file,
    signal,
  });
}

export function splitDatasetVersion(versionId: string) {
  return api<DatasetVersion>(`/dataset-versions/${versionId}/split`, { method: 'POST' });
}

export function publishDatasetVersion(versionId: string) {
  return api<DatasetVersion>(`/dataset-versions/${versionId}/publish`, { method: 'POST' });
}

export function deriveDatasetVersion(
  versionId: string,
  requestId: string,
  expectedSha256: string,
  line: number,
  messages: DatasetMessage[],
) {
  return api<DatasetVersion>(`/dataset-versions/${versionId}/derived`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      request_id: requestId,
      expected_sha256: expectedSha256,
      line,
      messages,
    }),
  });
}

export function deleteDatasetVersion(versionId: string) {
  return api<void>(`/dataset-versions/${versionId}`, { method: 'DELETE' });
}
