export type FormatSummary = {
  model_type?: string;
  validation?: string;
  runtime_verified?: boolean;
  [key: string]: unknown;
};
export type Row = {
  id: string;
  model_id: string;
  name: string;
  version_number: number;
  source_kind: string;
  state: string;
  created_at: string;
  updated_at?: string;
  compatibility_state: string;
  bucket?: string | null;
  manifest_sha256?: string | null;
  format_summary?: FormatSummary | null;
};
export type FileEntry = {path: string; size_bytes: number; sha256: string; state?: string};
export type Version = Omit<Row, 'name'> & {name?: string; files: FileEntry[]; references: {reference_type: string; reference_id: string}[]; total_bytes: number; verified_bytes: number; manifest_sha256: string | null; external?: {source_snapshot: {provider: string; region: string; path: string; fetched_at: string}; pinned_manifest: FileEntry[] | null; pinned_configuration: Record<string, unknown> | null; pinned_at: string | null; last_check_state: string; last_checked_at: string | null; last_instance_id: string | null; last_error_code: string | null}; import?: {state: string; current_path: string | null; current_bytes: number; cancel_requested: boolean; error_code: string | null; error_message: string | null; source_snapshot: {repository: string; revision: string; requested_revision?: string | null; resolved_ref?: string | null}}};
export type Limits = {file_limit_bytes: number; total_limit_bytes: number; file_count_limit: number; locked: boolean};
export type ModelGroup = {
  id: string;
  name: string;
  versions: Row[];
  latest: Row;
};
export type ModelStatusSummary = {
  label: string;
  tone: 'ok' | 'warn' | 'bad' | 'neutral';
  available: number;
  transferring: number;
  pending: number;
  errors: number;
};
export type ModelFilter = 'all' | 'modelscope' | 'directory' | 'ucloud_public' | 'pending' | 'errors' | 'verified';

export type ModelImportProgress = {
  transferredBytes: number;
  totalBytes: number;
  percent: number;
  verifiedFiles: number;
  totalFiles: number;
  currentBytes: number;
  currentFileSize: number | null;
  currentPercent: number | null;
};

const errorStates = new Set(['delete_failed', 'upload_failed', 'failed', 'mismatch']);
const transferringStates = new Set(['uploading', 'queued', 'running']);
const pendingStates = new Set(['pending', 'awaiting_verification', 'cancelled', 'deleting']);

export function mergeVersionRow(rows: Row[], version: Version, fallbackName = ''): Row[] {
  const existing = rows.find(row => row.id === version.id);
  const merged = {...existing, ...version, name: version.name ?? existing?.name ?? fallbackName};
  return existing ? rows.map(row => row.id === version.id ? merged : row) : [merged, ...rows];
}

export function modelShortId(identifier: string): string {
  return identifier.slice(0, 8).toUpperCase();
}

export function modelImportProgress(
  version: Pick<Version, 'files' | 'total_bytes' | 'verified_bytes' | 'import'>,
): ModelImportProgress {
  const totalBytes = Math.max(0, Number(version.total_bytes) || 0);
  const verifiedBytes = Math.min(totalBytes, Math.max(0, Number(version.verified_bytes) || 0));
  const currentBytes = Math.max(0, Number(version.import?.current_bytes) || 0);
  const currentFile = version.import?.current_path
    ? version.files.find((file) => file.path === version.import?.current_path)
    : undefined;
  const currentContribution = currentFile?.state === 'verified'
    ? 0
    : Math.min(currentFile?.size_bytes ?? currentBytes, currentBytes);
  const transferredBytes = Math.min(totalBytes, verifiedBytes + currentContribution);
  const percent = totalBytes > 0 ? transferredBytes / totalBytes * 100 : 0;
  const currentFileBytes = currentFile
    ? Math.min(currentFile.size_bytes, currentBytes)
    : currentContribution;
  const currentFileSize = currentFile?.size_bytes ?? null;
  return {
    transferredBytes,
    totalBytes,
    percent,
    verifiedFiles: version.files.filter((file) => file.state === 'verified').length,
    totalFiles: version.files.length,
    currentBytes: currentFileBytes,
    currentFileSize,
    currentPercent: currentFileSize
      ? Math.min(100, currentFileBytes / currentFileSize * 100)
      : null,
  };
}

export function groupModelRows(rows: Row[]): ModelGroup[] {
  const groups = new Map<string, Row[]>();
  for (const row of rows) {
    const versions = groups.get(row.model_id) ?? [];
    versions.push(row);
    groups.set(row.model_id, versions);
  }
  return [...groups.entries()].map(([id, versions]) => {
    const ordered = [...versions].sort((left, right) => right.version_number - left.version_number);
    return {id, name: ordered[0]?.name || id, versions: ordered, latest: ordered[0]};
  }).sort((left, right) => {
    const leftTime = new Date(left.latest.updated_at ?? left.latest.created_at).getTime();
    const rightTime = new Date(right.latest.updated_at ?? right.latest.created_at).getTime();
    return rightTime - leftTime;
  });
}

export function summarizeModelGroup(group: ModelGroup): ModelStatusSummary {
  const available = group.versions.filter((version) => version.state === 'available').length;
  const transferring = group.versions.filter((version) => transferringStates.has(version.state)).length;
  const pending = group.versions.filter((version) => pendingStates.has(version.state)).length;
  const errors = group.versions.filter((version) => errorStates.has(version.state)).length;
  const parts: string[] = [];
  if (errors) parts.push(`${errors} 异常`);
  if (transferring) parts.push(`${transferring} 传输中`);
  if (pending) parts.push(`${pending} 待处理`);
  if (available) parts.push(`${available} 可用`);
  const tone = errors ? 'bad' : transferring || pending ? 'warn' : available ? 'ok' : 'neutral';
  return {
    label: parts.join(' · ') || '尚无状态',
    tone,
    available,
    transferring,
    pending,
    errors,
  };
}

export function filterModelGroups(groups: ModelGroup[], query: string, filter: ModelFilter): ModelGroup[] {
  const normalized = query.trim().toLowerCase();
  return groups.filter((group) => {
    const matchesQuery = !normalized
      || group.name.toLowerCase().includes(normalized)
      || group.id.toLowerCase().includes(normalized)
      || group.versions.some((version) =>
        version.id.toLowerCase().includes(normalized)
        || version.source_kind.toLowerCase().includes(normalized),
      );
    if (!matchesQuery) return false;
    if (filter === 'all') return true;
    if (filter === 'modelscope' || filter === 'directory' || filter === 'ucloud_public') {
      return group.versions.some((version) => version.source_kind === filter);
    }
    if (filter === 'pending') {
      return group.versions.some((version) =>
        pendingStates.has(version.state) || transferringStates.has(version.state),
      );
    }
    if (filter === 'errors') {
      return group.versions.some((version) => errorStates.has(version.state));
    }
    return group.versions.some((version) => version.compatibility_state === 'verified');
  });
}
