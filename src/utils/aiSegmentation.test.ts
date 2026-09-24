import {
  argmaxLabels,
  resampleRoi,
  roiFromInputShape,
  roiLabelsToMasks,
} from './aiSegmentation';
import { voxelToMm } from './mprGeometry';
import { countMask, idx3, maskVolumeMl } from './segmentation';
import type { Volume } from './types';

const dims = { x: 40, y: 36, z: 30 };
const spacingCm = { x: 0.05, y: 0.05, z: 0.06 };
const C = { x: 20, y: 18, z: 15 };

/** Bright ball (radius 6 mm) on a dark background, plus a gradient along x. */
function makeVolume(): Volume {
  const voxels = new Uint8Array(dims.x * dims.y * dims.z);
  for (let z = 0; z < dims.z; z++)
    for (let y = 0; y < dims.y; y++)
      for (let x = 0; x < dims.x; x++) {
        const d = Math.hypot((x - C.x) * 0.5, (y - C.y) * 0.5, (z - C.z) * 0.6);
        voxels[idx3(dims, x, y, z)] = d < 6 ? 220 : x * 2;
      }
  return {
    dims: { t: 1, ...dims },
    spacingCm,
    frameTimeMs: 40,
    bitsAllocated: 8,
    samplesPerPixel: 1,
    isPhilipsCartesian: true,
    voxels,
    volumeSize: voxels.length,
    meta: { patientName: '', patientId: '', studyDate: '', modality: 'US', manufacturer: '', imageComments: '' },
  };
}

describe('resampleRoi', () => {
  test('samples a centred cube in (z, y, x) order, scaled to [0, 1]', () => {
    const vol = makeVolume();
    const spec = { roi: 16, spacingMm: 1, centerMm: voxelToMm(vol, C) };
    const cube = resampleRoi(vol, 0, spec);
    expect(cube).toHaveLength(16 ** 3);
    // Centre of the cube is inside the ball
    const mid = (8 * 16 + 8) * 16 + 8;
    expect(cube[mid]).toBeCloseTo(220 / 255, 2);
    // Along x (fastest axis) at a corner row, the background gradient increases
    const row = (1 * 16 + 1) * 16;
    expect(cube[row + 15]).toBeGreaterThan(cube[row]);
    expect(Math.max(...Array.from(cube))).toBeLessThanOrEqual(1);
  });

  test('fills outside the volume with zeros', () => {
    const vol = makeVolume();
    const cube = resampleRoi(vol, 0, { roi: 8, spacingMm: 5, centerMm: [0, 0, 0] });
    expect(cube[0]).toBe(0);
  });
});

describe('argmaxLabels', () => {
  test('picks the highest class per voxel', () => {
    // 3 classes × 4 voxels, laid out [class][voxel]
    const scores = new Float32Array([
      0.9, 0.1, 0.2, 0.0,
      0.05, 0.8, 0.1, 0.3,
      0.05, 0.1, 0.7, 0.2,
    ]);
    expect(Array.from(argmaxLabels(scores, 3))).toEqual([0, 1, 2, 1]);
  });

  test('rejects a size that does not match the class count', () => {
    expect(() => argmaxLabels(new Float32Array(10), 3)).toThrow();
  });
});

describe('roiLabelsToMasks', () => {
  test('a threshold "model" round-trips to the ball in the volume', () => {
    const vol = makeVolume();
    const spec = { roi: 48, spacingMm: 0.4, centerMm: voxelToMm(vol, C) };
    const cube = resampleRoi(vol, 0, spec);
    // Fake 2-class output: background score 0.5, foreground = intensity
    const scores = new Float32Array(cube.length * 2);
    scores.fill(0.5, 0, cube.length);
    scores.set(cube, cube.length);
    const labels = argmaxLabels(scores, 2);
    const [mask] = roiLabelsToMasks(labels, 2, vol, spec);
    const ml = maskVolumeMl(countMask(mask), vol.spacingCm);
    const expected = ((4 / 3) * Math.PI * 6 ** 3) / 1000;
    expect(Math.abs(ml - expected) / expected).toBeLessThan(0.12);
    expect(mask[idx3(dims, C.x, C.y, C.z)]).toBe(1);
    expect(mask[idx3(dims, 2, 2, 2)]).toBe(0);
  });

  test('one mask per foreground class', () => {
    const vol = makeVolume();
    const spec = { roi: 4, spacingMm: 1, centerMm: voxelToMm(vol, C) };
    const labels = new Uint8Array(64).fill(2);
    const masks = roiLabelsToMasks(labels, 3, vol, spec);
    expect(masks).toHaveLength(2);
    expect(countMask(masks[0])).toBe(0);
    expect(countMask(masks[1])).toBeGreaterThan(0);
  });
});

describe('roiFromInputShape', () => {
  test('reads a static cubic input shape', () => {
    expect(roiFromInputShape([1, 1, 96, 96, 96])).toBe(96);
    expect(roiFromInputShape([1, 1, 'D', 'H', 'W'])).toBeNull();
    expect(roiFromInputShape([1, 1, 64, 96, 96])).toBeNull();
    expect(roiFromInputShape(undefined)).toBeNull();
  });
});
