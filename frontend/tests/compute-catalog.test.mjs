import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildCatalogOptions,
  selectionKey,
} from '../src/features/resources/compute/compute-catalog.ts';

const specification = {
  Name: '4090',
  Zone: 'cn-bj2-03',
  Status: 'Normal',
  Description: '',
  GraphicsMemory: { Value: 24 },
  MachineSizes: [
    {
      Gpu: 1,
      Collection: [32, 48, 64].map((memory) => ({
        Cpu: 14,
        Memory: [memory],
        MinimalCpuPlatform: ['Auto'],
      })),
    },
  ],
  Disks: [
    {
      Name: 'CLOUD_SSD',
      BootDisk: [
        {
          Name: 'CLOUD_SSD',
          MinimalSize: 20,
          MaximalSize: 1000,
        },
      ],
    },
  ],
  CpuPlatforms: {},
};

const images = Array.from({ length: 9 }, (_, index) => ({
  CompShareImageId: `image-${index + 1}`,
  Name: `System image ${index + 1}`,
  ImageType: 'System',
  Status: 'Available',
  Author: '',
  Tags: [],
}));

test('catalog options count hardware combinations, not image choices', () => {
  const options = buildCatalogOptions(
    [specification],
    images,
    'cn-bj2',
    'cn-bj2-03',
  );

  assert.equal(options.length, 3);
  assert.deepEqual(
    options.map((option) => option.memoryGiB),
    [32, 48, 64],
  );
  assert.ok(options.every((option) => option.imageId === 'image-1'));
  assert.equal(new Set(options.map((option) => option.id)).size, 3);
});

test('the selected directory image becomes the default image', () => {
  const options = buildCatalogOptions(
    [specification],
    [images[2]],
    'cn-bj2',
    'cn-bj2-03',
  );

  assert.equal(options.length, 3);
  assert.ok(options.every((option) => option.imageId === 'image-3'));
});

test('a CUDA Ubuntu image is preferred over an arbitrary first image', () => {
  const mixedImages = [
    images[0],
    {
      ...images[0],
      CompShareImageId: 'image-ubuntu-cuda',
      Name: 'Ubuntu-nvidia 22.04',
    },
  ];
  const options = buildCatalogOptions(
    [specification],
    mixedImages,
    'cn-bj2',
    'cn-bj2-03',
  );

  assert.ok(
    options.every((option) => option.imageId === 'image-ubuntu-cuda'),
  );
});

test('inventory and quote identity includes image, disk and complete hardware', () => {
  const [option] = buildCatalogOptions(
    [specification],
    images,
    'cn-bj2',
    'cn-bj2-03',
  );

  const baseline = selectionKey({
    option,
    imageId: 'image-1',
    bootDiskGb: 60,
  });
  const changedImage = selectionKey({
    option,
    imageId: 'image-2',
    bootDiskGb: 60,
  });
  const changedDisk = selectionKey({
    option,
    imageId: 'image-1',
    bootDiskGb: 80,
  });
  const changedCpu = selectionKey({
    option: { ...option, cpu: 16 },
    imageId: 'image-1',
    bootDiskGb: 60,
  });

  assert.notEqual(baseline, changedImage);
  assert.notEqual(baseline, changedDisk);
  assert.notEqual(baseline, changedCpu);
  assert.match(baseline, /image-1$/);
});
