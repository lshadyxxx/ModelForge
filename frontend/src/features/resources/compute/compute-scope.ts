import type { Zone } from '../api';

export type ComputeScopeOption = {
  value: string;
  label: string;
  region: string;
  zone: string;
  isPod: boolean;
};

export function buildScopeOptions(zones: Zone[]): ComputeScopeOption[] {
  const seen = new Set<string>();
  return zones.flatMap((zone) => {
    const region = zone.Region.trim();
    const zoneId = zone.Zone.trim();
    if (!region || !zoneId || seen.has(zoneId)) return [];
    seen.add(zoneId);
    return [{
      value: zoneId,
      label: zone.Describe.trim() || zoneId,
      region,
      zone: zoneId,
      isPod: Boolean(zone.IsPod),
    }];
  });
}

export function findScopeOption(
  options: ComputeScopeOption[],
  region: string,
  zone: string,
): ComputeScopeOption | null {
  return (
    options.find(
      (option) => option.region === region && option.zone === zone,
    ) ?? null
  );
}
