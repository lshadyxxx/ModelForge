import { api, json } from '../../shared/http.ts';
import { hashFile } from '../../shared/sha256.ts';
import { type FileEntry, type Limits, type Version } from './api.ts';

/** Own the complete directory transfer, including immutable resume identity. */
export async function uploadModelDirectory({files, name, resumeId, limits, signal, onProgress, onVersion}: {
  files: File[]; name: string; resumeId?: string; limits: Limits; signal: AbortSignal;
  onProgress: (text: string) => void; onVersion: (version: Version) => void;
}): Promise<Version> {
  if (!files.length) throw new Error('请先选择完整模型目录。');
  if (files.length > limits.file_count_limit || files.reduce((sum, file) => sum + file.size, 0) > limits.total_limit_bytes || files.some(file => file.size > limits.file_limit_bytes)) throw new Error('所选目录超过服务端文件数量或容量限制。');
  const paths = files.map(file => ({file, path: file.webkitRelativePath ? file.webkitRelativePath.split('/').slice(1).join('/') : file.name}));
  const manifest: FileEntry[] = [];
  for (const item of paths) {
    onProgress('正在计算 SHA-256：' + item.path);
    const sha256 = await hashFile(item.file, signal, read => onProgress('计算摘要 ' + item.path + ' · ' + read.toLocaleString() + ' / ' + item.file.size.toLocaleString() + ' B'));
    manifest.push({path: item.path, size_bytes: item.file.size, sha256});
  }
  let id = resumeId;
  let uploadPaths = manifest.map(item => item.path);
  let reused = 0;
  if (id) {
    const result = await api<{reusable_paths: string[]; upload_paths: string[]}>('/model-versions/' + id + '/resume', {...json('POST', {files: manifest}), signal});
    uploadPaths = result.upload_paths;
    reused = result.reusable_paths.length;
  } else {
    const version = await api<Version>('/models/directory-imports', {...json('POST', {name, files: manifest}), signal});
    id = version.id;
  }
  const readVersion = async () => {
    const version = await api<Version>('/model-versions/' + id, {signal});
    onVersion(version);
    return version;
  };
  await readVersion();
  for (const item of paths.filter(item => uploadPaths.includes(item.path))) {
    signal.throwIfAborted();
    onProgress('上传 ' + item.path + ' · 已复用 ' + reused + ' 个文件；以服务端回读校验为准');
    await api('/model-versions/' + id + '/files?path=' + encodeURIComponent(item.path), {method: 'PUT', body: item.file, signal});
    await readVersion();
  }
  signal.throwIfAborted();
  onProgress('所有文件上传完毕，正在请求服务端完整回读校验…');
  await api('/model-versions/' + id + '/complete', {method: 'POST', signal});
  return readVersion();
}
