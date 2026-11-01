export type Row = {id: string; model_id: string; name: string; version_number: number; source_kind: string; state: string; created_at: string; compatibility_state: string};
export type FileEntry = {path: string; size_bytes: number; sha256: string; state?: string};
export type Version = Omit<Row, 'name'> & {name?: string; files: FileEntry[]; references: {reference_type: string; reference_id: string}[]; total_bytes: number; verified_bytes: number; manifest_sha256: string | null; external?: {source_snapshot: {provider: string; region: string; path: string; fetched_at: string}; pinned_manifest: FileEntry[] | null; pinned_configuration: Record<string, unknown> | null; pinned_at: string | null; last_check_state: string; last_checked_at: string | null; last_instance_id: string | null; last_error_code: string | null}; import?: {state: string; current_path: string | null; current_bytes: number; cancel_requested: boolean; error_code: string | null; error_message: string | null; source_snapshot: {repository: string; revision: string; requested_revision?: string | null; resolved_ref?: string | null}}};
export type Limits = {file_limit_bytes: number; total_limit_bytes: number; file_count_limit: number; locked: boolean};

export function mergeVersionRow(rows: Row[], version: Version, fallbackName = ''): Row[] {
  const existing = rows.find(row => row.id === version.id);
  const merged = {...existing, ...version, name: version.name ?? existing?.name ?? fallbackName};
  return existing ? rows.map(row => row.id === version.id ? merged : row) : [merged, ...rows];
}
