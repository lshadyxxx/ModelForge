import { api } from '../../shared/http.ts';

export type Directory<T> = {items: T[]; total: number; state: 'ready' | 'empty' | 'out_of_stock'; fetched_at: string; source: 'ucloud'; compatibility: 'unverified'; filters: Record<string, unknown>};
export type Configuration = {configured: boolean; default_region: string | null; mode: 'read_only' | 'read_write'; write_enabled: boolean; reason: string | null};
export type Zone = {Region: string; Zone: string; Describe: string; IsPod: boolean};
export type Specification = {Name: string; Zone: string; Status: string; Description: string; GraphicsMemory: {Value: number}; MachineSizes: {Gpu: number; Collection: {Cpu: number; Memory: number[]; MinimalCpuPlatform: string[]}[]}[]; Disks: {Name: string; BootDisk: {Name: string; MinimalSize: number | null; MaximalSize: number | null}[]}[]; CpuPlatforms: Record<string, string[]>};
export type ImageSupportZone = {Region?: string; Zone: string; Status?: string};
export type Image = {CompShareImageId: string; Name: string; ImageType: string; Status: string; Author: string; Tags: string[]; Description?: string; Zone?: string; ImageSupportZone?: ImageSupportZone[]};
export type PublicModel = {Name: string; Path: string; Size: string; Tag: string};
export type Capacity = {Gpu: number; Cpu: number; Mem: number; ResourceEnough: boolean};

export const DEFAULT_IMAGE_TYPE = 'System';

export function directoryPath(kind: string, parameters: Record<string, string | number | undefined>) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(parameters)) if (value !== undefined && value !== '') query.set(key, String(value));
  return '/resources/ucloud/' + kind + (query.size ? '?' + query.toString() : '');
}

export function imageDirectoryQuery(region: string, zone: string, name: string, imageType: string, offset = 0, limit = 20) {
  const selectedType = imageType || DEFAULT_IMAGE_TYPE;
  const trimmedName = name.trim();
  return {
    path: directoryPath('images', {region, zone, name: trimmedName, image_type: selectedType, offset, limit}),
    filters: {Region: region, ...(zone ? {Zone: zone} : {}), ...(trimmedName ? {Name: trimmedName} : {}), ImageType: selectedType, Limit: limit},
  };
}

export function matchesFilters<T>(directory: Directory<T> | null, expected: Record<string, unknown>, ignored: string[] = []) {
  if (!directory) return false;
  const actual = Object.fromEntries(Object.entries(directory.filters).filter(([key]) => !ignored.includes(key)));
  const target = Object.fromEntries(Object.entries(expected).filter(([key]) => !ignored.includes(key)));
  const stable = (value: unknown): unknown => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object'
    ? Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, stable(item)])) : value;
  return JSON.stringify(stable(actual)) === JSON.stringify(stable(target));
}

export function fetchDirectory<T>(path: string, signal: AbortSignal): Promise<Directory<T>> {
  return api<Directory<T>>(path, {signal});
}
