import type { Image, Specification } from '../api';
import type { ComputeCatalogOption } from './ResourceMarket';
import { preferredAvailableImage } from './image-catalog.ts';

export type EnvironmentDraft = {
  option: ComputeCatalogOption;
  imageId: string;
  bootDiskGb: number;
};

export function selectionKey({
  option,
  imageId,
  bootDiskGb,
}: EnvironmentDraft): string {
  return [
    option.region,
    option.zone,
    option.gpuType,
    option.graphicsMemoryGb,
    option.cpu,
    option.memoryGiB,
    option.cpuPlatform,
    option.chargeType,
    option.diskType,
    bootDiskGb,
    imageId,
  ].join('|');
}

function allowedDisk(specification: Specification) {
  const disks = specification.Disks.flatMap((group) => group.BootDisk);
  return (
    disks.find(
      (disk) => disk.Name === 'CLOUD_SSD' || disk.Name === 'CLOUD_RSSD',
    ) ?? null
  );
}

function allowedCpuPlatform(
  platforms: string[],
  fallback: string[],
): 'Auto' | 'Intel/Auto' | 'Amd/Auto' {
  const values = new Set([...platforms, ...fallback]);
  if (values.has('Auto')) return 'Auto';
  if (values.has('Intel/Auto')) return 'Intel/Auto';
  if (values.has('Amd/Auto')) return 'Amd/Auto';
  return 'Auto';
}

export function buildCatalogOptions(
  specifications: Specification[],
  images: Image[],
  region: string,
  zone: string,
): ComputeCatalogOption[] {
  const defaultImage = preferredAvailableImage(images);
  if (!defaultImage) return [];
  const options: ComputeCatalogOption[] = [];
  for (const specification of specifications) {
    if (specification.Zone && specification.Zone !== zone) continue;
    const disk = allowedDisk(specification);
    if (!disk) continue;
    for (const machine of specification.MachineSizes.filter(
      (item) => item.Gpu === 1,
    )) {
      for (const combination of machine.Collection) {
        for (const memoryGiB of combination.Memory) {
          options.push({
            id: [
              region,
              specification.Zone,
              specification.Name,
              machine.Gpu,
              combination.Cpu,
              memoryGiB,
              defaultImage.CompShareImageId,
              disk.Name,
            ].join('|'),
            region,
            zone: specification.Zone,
            zoneLabel: specification.Zone,
            gpuType: specification.Name,
            graphicsMemoryGb: specification.GraphicsMemory.Value,
            cpu: combination.Cpu,
            memoryGiB,
            cpuPlatform: allowedCpuPlatform(
              combination.MinimalCpuPlatform,
              Object.keys(specification.CpuPlatforms).flatMap((vendor) =>
                specification.CpuPlatforms[vendor].map(
                  (platform) => `${vendor}/${platform}`,
                ),
              ),
            ),
            imageId: defaultImage.CompShareImageId,
            imageName: defaultImage.Name,
            imageType: defaultImage.ImageType,
            diskType: disk.Name,
            diskMinGiB: disk.MinimalSize ?? undefined,
            diskMaxGiB: disk.MaximalSize ?? undefined,
            chargeType: 'Postpay',
            availability:
              specification.Status === 'SoldOut' ? 'out_of_stock' : 'unknown',
            availabilityLabel:
              specification.Status === 'SoldOut' ? '目录显示售罄' : '尚未查库存',
            compatibility: 'unverified',
          });
        }
      }
    }
  }
  return options;
}
