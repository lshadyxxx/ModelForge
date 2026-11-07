import type { Image } from '../api';

export type ImageCategoryKey =
  | 'all'
  | 'linux'
  | 'windows'
  | 'inference'
  | 'visual'
  | 'framework'
  | 'runtime'
  | 'other';

export type ImageAvailability = {
  available: boolean;
  label: string;
  tone: 'ok' | 'neutral' | 'warning';
};

export type ImageCategory = {
  key: ImageCategoryKey;
  label: string;
  count: number;
};

export function imageTypeLabel(value: string | undefined) {
  if (value === 'Custom') return '自定义镜像';
  return value === 'App' ? '应用镜像' : '系统镜像';
}

export function imageAvailability(image: Image): ImageAvailability {
  const status = image.Status.trim().toLowerCase();
  if (status === 'available') {
    return { available: true, label: '目录可用', tone: 'ok' };
  }
  if (status === 'offline') {
    return { available: false, label: '目录下线', tone: 'neutral' };
  }
  return {
    available: false,
    label: image.Status.trim() || '目录状态未知',
    tone: 'warning',
  };
}

export function imagePlatform(image: Image) {
  if (/windows/i.test(image.Name)) {
    return { key: 'windows' as const, label: 'Windows' };
  }
  if (/ubuntu|linux|debian|centos|rocky/i.test(image.Name)) {
    return { key: 'linux' as const, label: 'Linux' };
  }
  return { key: 'other' as const, label: '其他平台' };
}

export function imageFamily(image: Image) {
  const name = image.Name;
  if (/comfyui|sd[-_ ]?webui|stable[-_ ]?diffusion/i.test(name)) {
    return { key: 'visual' as const, label: '视觉工作流' };
  }
  if (/vllm|sglang|ollama|tensorrt|triton/i.test(name)) {
    return { key: 'inference' as const, label: '推理服务' };
  }
  if (/pytorch|tensorflow|torch/i.test(name)) {
    return { key: 'framework' as const, label: '训练框架' };
  }
  if (/cuda|python|conda/i.test(name)) {
    return { key: 'runtime' as const, label: '基础运行时' };
  }

  const tags = image.Tags.join(' ');
  if (/comfyui|sd[-_ ]?webui|stable[-_ ]?diffusion/i.test(tags)) {
    return { key: 'visual' as const, label: '视觉工作流' };
  }
  if (/pytorch|tensorflow/i.test(tags)) {
    return { key: 'framework' as const, label: '训练框架' };
  }
  return { key: 'other' as const, label: '其他应用' };
}

function imageCategoryKey(image: Image): ImageCategoryKey {
  return image.ImageType === 'App'
    ? imageFamily(image).key
    : imagePlatform(image).key;
}

export function imageCatalogCategories(
  images: Image[],
  imageType: string,
): ImageCategory[] {
  const definitions =
    imageType === 'App'
      ? [
          { key: 'inference' as const, label: '推理服务' },
          { key: 'visual' as const, label: '视觉工作流' },
          { key: 'framework' as const, label: '训练框架' },
          { key: 'runtime' as const, label: '基础运行时' },
          { key: 'other' as const, label: '其他应用' },
        ]
      : [
          { key: 'linux' as const, label: 'Linux' },
          { key: 'windows' as const, label: 'Windows' },
          { key: 'other' as const, label: '其他平台' },
        ];
  const counts = new Map<ImageCategoryKey, number>();
  for (const image of images) {
    const key = imageCategoryKey(image);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [
    { key: 'all', label: '全部', count: images.length },
    ...definitions
      .map((item) => ({ ...item, count: counts.get(item.key) ?? 0 }))
      .filter((item) => item.count > 0),
  ];
}

function searchText(image: Image) {
  return [
    image.Name,
    image.CompShareImageId,
    image.Description ?? '',
    image.Author,
    ...image.Tags,
  ]
    .join('\n')
    .normalize('NFKC')
    .toLocaleLowerCase('zh-CN');
}

export function filterImageCatalog(
  images: Image[],
  imageType: string,
  category: ImageCategoryKey,
  query: string,
) {
  const normalizedQuery = query.trim().normalize('NFKC').toLocaleLowerCase('zh-CN');
  return images.filter((image) => {
    if (category !== 'all' && imageCategoryKey(image) !== category) return false;
    if (
      imageType === 'App'
      && category === 'linux'
      && imagePlatform(image).key !== 'linux'
    ) {
      return false;
    }
    return !normalizedQuery || searchText(image).includes(normalizedQuery);
  });
}

export function preferredAvailableImage(images: Image[]): Image | undefined {
  const available = images.filter((image) => imageAvailability(image).available);
  return (
    available.find((image) => /ubuntu.*nvidia/i.test(image.Name))
    ?? available.find((image) => /nvidia.*ubuntu/i.test(image.Name))
    ?? available.find((image) => /ubuntu/i.test(image.Name))
    ?? available[0]
  );
}

export function availableCatalogImage(
  images: Image[],
  imageId: string | undefined,
): Image | undefined {
  if (!imageId) return undefined;
  return images.find(
    (image) =>
      image.CompShareImageId === imageId
      && imageAvailability(image).available,
  );
}

export function resolveImageSelection(
  images: Image[],
  candidates: Array<string | undefined>,
): string {
  for (const imageId of candidates) {
    const image = availableCatalogImage(images, imageId);
    if (image) return image.CompShareImageId;
  }
  return preferredAvailableImage(images)?.CompShareImageId ?? '';
}

export function imageMonogram(image: Image) {
  if (image.ImageType === 'Custom') return 'My';
  if (image.ImageType === 'System') {
    const platform = imagePlatform(image);
    if (platform.key === 'windows') return 'Win';
    if (platform.key === 'linux') return 'Lx';
    return 'Sys';
  }
  const family = imageFamily(image);
  if (family.key === 'inference') {
    if (/vllm/i.test(image.Name)) return 'vL';
    if (/sglang/i.test(image.Name)) return 'SG';
    if (/ollama/i.test(image.Name)) return 'OL';
    return 'API';
  }
  if (family.key === 'visual') {
    if (/comfyui/i.test(image.Name)) return 'Co';
    if (/sd[-_ ]?webui|stable[-_ ]?diffusion/i.test(image.Name)) return 'SD';
    return 'Vi';
  }
  if (family.key === 'framework') {
    if (/tensorflow/i.test(image.Name)) return 'Tf';
    if (/pytorch|torch/i.test(image.Name)) return 'Py';
    return 'FW';
  }
  if (family.key === 'runtime') return 'Cu';
  return 'App';
}
