import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { test } from 'node:test';
import { hashFile, Sha256 } from '../src/shared/sha256.ts';

test('incremental digest matches independent crypto at padding and block boundaries', () => {
  for (const size of [0, 1, 55, 56, 63, 64, 65, 119, 120, 127, 128, 129, 1025, 1048579]) {
    const data = randomBytes(size);
    for (const chunkSize of [1, 17, 64, 4096]) {
      const digest = new Sha256();
      for (let i = 0; i < size; i += chunkSize) digest.update(data.subarray(i, i + chunkSize));
      assert.equal(digest.digest(), createHash('sha256').update(data).digest('hex'));
    }
  }
});

test('file hashing uses bounded slices and reports completed bytes', async () => {
  const data = randomBytes(4 * 1024 ** 2 + 113);
  const reads = [], progress = [];
  const file = {size: data.length, slice(start, end) {
    reads.push([start, end]);
    assert.ok(end - start <= 4 * 1024 ** 2);
    return new Blob([data.subarray(start, end)]);
  }};
  const digest = await hashFile(file, new AbortController().signal, value => progress.push(value));
  assert.equal(digest, createHash('sha256').update(data).digest('hex'));
  assert.deepEqual(progress, [4 * 1024 ** 2, data.length]);
  assert.equal(reads.length, 2);
});

test('cancellation stops before reading another file chunk', async () => {
  const controller = new AbortController();
  let reads = 0;
  const file = {size: 8 * 1024 ** 2, slice(start, end) {
    reads++;
    return new Blob([new Uint8Array(end - start)]);
  }};
  await assert.rejects(hashFile(file, controller.signal, () => controller.abort()), {name: 'AbortError'});
  assert.equal(reads, 1);
});
