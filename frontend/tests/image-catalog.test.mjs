import assert from 'node:assert/strict';
import test from 'node:test';

import {
  availableCatalogImage,
  filterImageCatalog,
  imageAvailability,
  imageCatalogCategories,
  imageFamily,
  imageMonogram,
  imagePlatform,
  imageTypeLabel,
  preferredAvailableImage,
  resolveImageSelection,
} from '../src/features/resources/compute/image-catalog.ts';

function image(overrides) {
  return {
    CompShareImageId: 'compshareImage-default',
    Name: 'Ubuntu-nvidia 22.04',
    ImageType: 'System',
    Status: 'Available',
    Author: '优云智算',
    Tags: [],
    ...overrides,
  };
}

test('offline images are not selectable defaults', () => {
  const offline = image({
    CompShareImageId: 'offline-1',
    Name: 'PyTorch:24.04-py3',
    ImageType: 'App',
    Status: 'Offline',
  });
  const available = image({
    CompShareImageId: 'available-1',
    Name: 'vLLM v0.25.1',
    ImageType: 'App',
  });

  assert.equal(imageAvailability(offline).available, false);
  assert.equal(imageAvailability(offline).label, '目录下线');
  assert.equal(imageAvailability(available).available, true);
  assert.equal(preferredAvailableImage([offline, available])?.CompShareImageId, 'available-1');
});

test('preferred image still favors the CUDA Ubuntu system image', () => {
  const preferred = preferredAvailableImage([
    image({ CompShareImageId: 'windows', Name: 'Windows-nvidia 2022 64位' }),
    image({ CompShareImageId: 'ubuntu', Name: 'Ubuntu-nvidia 22.04' }),
    image({ CompShareImageId: 'plain', Name: 'Ubuntu 24.04 64位' }),
  ]);

  assert.equal(preferred?.CompShareImageId, 'ubuntu');
});

test('image selection keeps only a currently available candidate', () => {
  const offline = image({
    CompShareImageId: 'offline',
    Name: 'PyTorch:24.04-py3',
    ImageType: 'App',
    Status: 'Offline',
  });
  const available = image({
    CompShareImageId: 'available',
    Name: 'Ubuntu-nvidia 24.04',
  });

  assert.equal(availableCatalogImage([offline, available], 'offline'), undefined);
  assert.equal(availableCatalogImage([offline, available], 'available')?.CompShareImageId, 'available');
  assert.equal(
    resolveImageSelection([offline, available], ['offline', 'missing', 'available']),
    'available',
  );
  assert.equal(resolveImageSelection([offline], ['offline']), '');
});

test('system images are grouped by platform', () => {
  const images = [
    image({ CompShareImageId: 'linux', Name: 'Ubuntu 22.04 64位' }),
    image({ CompShareImageId: 'windows', Name: 'Windows 2022 64位' }),
    image({ CompShareImageId: 'other', Name: 'Custom appliance' }),
  ];

  assert.equal(imagePlatform(images[0]).label, 'Linux');
  assert.equal(imagePlatform(images[1]).label, 'Windows');
  assert.deepEqual(
    imageCatalogCategories(images, 'System').map((item) => [item.key, item.count]),
    [
      ['all', 3],
      ['linux', 1],
      ['windows', 1],
      ['other', 1],
    ],
  );
});

test('app images are grouped by their directory family', () => {
  const images = [
    image({ CompShareImageId: 'vllm', Name: 'vLLM v0.25.1', ImageType: 'App' }),
    image({ CompShareImageId: 'comfy', Name: 'ComfyUI基础镜像0.30.0', ImageType: 'App' }),
    image({ CompShareImageId: 'torch', Name: 'cuda130_torch291_py312', ImageType: 'App' }),
    image({ CompShareImageId: 'cuda', Name: 'cuda132_python312', ImageType: 'App' }),
    image({ CompShareImageId: 'other', Name: 'Custom image', ImageType: 'App' }),
  ];

  assert.equal(imageFamily(images[0]).label, '推理服务');
  assert.equal(imageFamily(images[1]).label, '视觉工作流');
  assert.equal(imageFamily(images[2]).label, '训练框架');
  assert.equal(imageFamily(images[3]).label, '基础运行时');
  assert.deepEqual(
    imageCatalogCategories(images, 'App').map((item) => [item.key, item.count]),
    [
      ['all', 5],
      ['inference', 1],
      ['visual', 1],
      ['framework', 1],
      ['runtime', 1],
      ['other', 1],
    ],
  );
});

test('search covers names, IDs, descriptions, tags and authors', () => {
  const images = [
    image({
      CompShareImageId: 'compshareImage-1t4y5aeosple',
      Name: 'vLLM v0.25.1',
      ImageType: 'App',
      Tags: ['推理服务'],
      Description: 'OpenAI compatible runtime',
    }),
    image({
      CompShareImageId: 'compshareImage-comfy',
      Name: 'ComfyUI基础镜像',
      ImageType: 'App',
      Author: '优云智算',
    }),
  ];

  assert.deepEqual(
    filterImageCatalog(images, 'App', 'all', 'openai').map(
      (item) => item.CompShareImageId,
    ),
    ['compshareImage-1t4y5aeosple'],
  );
  assert.deepEqual(
    filterImageCatalog(images, 'App', 'all', '推理').map(
      (item) => item.CompShareImageId,
    ),
    ['compshareImage-1t4y5aeosple'],
  );
  assert.deepEqual(
    filterImageCatalog(images, 'App', 'visual', '').map(
      (item) => item.CompShareImageId,
    ),
    ['compshareImage-comfy'],
  );
});

test('monograms distinguish systems and app families', () => {
  assert.equal(
    imageMonogram(image({ Name: 'Windows 2022 64位' })),
    'Win',
  );
  assert.equal(
    imageMonogram(image({ Name: 'vLLM v0.25.1', ImageType: 'App' })),
    'vL',
  );
  assert.equal(
    imageMonogram(image({ Name: 'ComfyUI基础镜像', ImageType: 'App' })),
    'Co',
  );
  assert.equal(
    imageMonogram(
      image({
        Name: 'modelforge-training-base-qwen3',
        ImageType: 'Custom',
      }),
    ),
    'My',
  );
});

test('custom images use a dedicated label without changing system and app labels', () => {
  assert.equal(imageTypeLabel(undefined), '系统镜像');
  assert.equal(imageTypeLabel('System'), '系统镜像');
  assert.equal(imageTypeLabel('App'), '应用镜像');
  assert.equal(imageTypeLabel('Custom'), '自定义镜像');
});
