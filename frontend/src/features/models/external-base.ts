import { api, json } from '../../shared/http.ts';
import { matchesFilters, type Directory, type PublicModel } from '../resources/api.ts';
import type { Version } from './api.ts';

export async function registerExternalBase(name: string, region: string, path: string, directory: Directory<PublicModel> | null): Promise<Version> {
  if (!name.trim() || !region || !path || !matchesFilters(directory, {Region:region})
      || directory!.items.filter(item => item.Path === path).length !== 1) {
    throw new Error('请重新读取当前地域的公共模型目录并选择唯一条目。');
  }
  return api<Version>('/models/external-bases', json('POST', {name:name.trim(), region, path}));
}
