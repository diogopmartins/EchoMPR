import { identityBasis, sampleObliquePlane, voxelToMm } from './mprGeometry';
import {
  autoThreshold,
  boxBlur,
  countMask,
  dilate,
  erode,
  idx3,
  maskToField,
  maskVolumeMl,
  paintDisc,
  regionGrow,
  sampleMaskOnSlice,
} from './segmentation';
import type { Volume } from './types';

const dims = { x: 48, y: 44, z: 40 };
const spacingCm = { x: 0.05, y: 0.05, z: 0.06 };
const C = { x: 20, y: 22, z: 20 };
const R = 9; // chamber radius in voxels (x/y)

/**
 * Dark ellipsoidal "chamber" (blood) inside a bright wall, a second dark
 * pocket, and optionally a thin dark channel joining them.
 */
function phantom({ channel = false } = {}) {
  const n = dims.x * dims.y * dims.z;
  const v = new Uint8Array(n);
  for (let z = 0; z < dims.z; z++)
    for (let y = 0; y < dims.y; y++)
      for (let x = 0; x < dims.x; x++) {
        const d = Math.hypot(x - C.x, y - C.y, ((z - C.z) * 6) / 5);
        const pocket = Math.hypot(x - 40, y - 22, z - 20);
        let val = 120 + ((x * 7 + y * 13 + z * 5) % 11);
        if (d < R + 4) val = 200;
        if (d < R) val = 25 + ((x + y + z) % 9);
        if (pocket < 4) val = 30;
        if (channel && Math.abs(y - 22) <= 0 && Math.abs(z - 20) <= 0 && x > C.x && x < 40) val = 30;
        v[idx3(dims, x, y, z)] = val;
      }
  return v;
}

const volume = (voxels: Uint8Array): Volume => ({
  dims: { t: 1, ...dims },
  spacingCm,
  frameTimeMs: 40,
  bitsAllocated: 8,
  samplesPerPixel: 1,
  isPhilipsCartesian: true,
  voxels,
  volumeSize: voxels.length,
  meta: { patientName: '', patientId: '', studyDate: '', modality: 'US', manufacturer: '', imageComments: '' },
});

// Ellipsoid semi-axes in voxels: R, R, R*5/6
const trueCount = (4 / 3) * Math.PI * R * R * ((R * 5) / 6);

describe('boxBlur', () => {
  test('keeps a constant volume constant and preserves the mean', () => {
    const flat = new Uint8Array(dims.x * dims.y * dims.z).fill(77);
    expect(boxBlur(flat, dims, 2).every((v) => v === 77)).toBe(true);
    const p = phantom();
    const mean = (a: Uint8Array) => a.reduce((s, x) => s + x, 0) / a.length;
    expect(Math.abs(mean(boxBlur(p, dims, 1)) - mean(p))).toBeLessThan(1);
  });
});

describe('regionGrow', () => {
  test('fills the chamber from a seed with the auto threshold', () => {
    const smooth = boxBlur(phantom(), dims, 1);
    const threshold = autoThreshold(smooth, dims, C);
    expect(threshold).toBeGreaterThan(40);
    expect(threshold).toBeLessThan(160);
    const mask = regionGrow(smooth, dims, C, { threshold });
    const n = countMask(mask);
    expect(Math.abs(n - trueCount) / trueCount).toBeLessThan(0.15);
    expect(mask[idx3(dims, 40, 22, 20)]).toBe(0); // separate pocket not reached
  });

  test('starts from a nearby dark voxel if the seed lands on the wall', () => {
    const smooth = boxBlur(phantom(), dims, 1);
    const mask = regionGrow(smooth, dims, { x: C.x + R + 1, y: C.y, z: C.z }, { threshold: 90 });
    expect(countMask(mask)).toBeGreaterThan(trueCount * 0.8);
  });

  test('leak cut stops growth through a thin channel', () => {
    const vol = phantom({ channel: true });
    const leaky = regionGrow(vol, dims, C, { threshold: 90 });
    expect(leaky[idx3(dims, 40, 22, 20)]).toBe(1);
    const cut = regionGrow(vol, dims, C, { threshold: 90, leakCut: 1 });
    expect(cut[idx3(dims, 40, 22, 20)]).toBe(0);
    expect(Math.abs(countMask(cut) - trueCount) / trueCount).toBeLessThan(0.15);
  });

  test('respects a maximum radius', () => {
    const vol = phantom();
    const mask = regionGrow(vol, dims, C, { threshold: 90, maxRadius: { x: 4, y: 4, z: 4 } });
    expect(countMask(mask)).toBeLessThanOrEqual(Math.ceil((4 / 3) * Math.PI * 64) + 30);
  });

  test('returns an empty mask when nothing is below threshold', () => {
    expect(countMask(regionGrow(phantom(), dims, C, { threshold: 5 }))).toBe(0);
  });
});

describe('morphology', () => {
  test('erode then dilate restores a large block', () => {
    const m = new Uint8Array(dims.x * dims.y * dims.z);
    for (let z = 10; z < 20; z++) for (let y = 10; y < 20; y++) for (let x = 10; x < 20; x++) m[idx3(dims, x, y, z)] = 1;
    expect(countMask(erode(m, dims, 1))).toBe(512);
    // 8³ core plus one voxel on each of its 6 faces (6-neighbourhood adds no edges)
    expect(countMask(dilate(erode(m, dims, 1), dims, 1, m))).toBe(512 + 6 * 64);
  });
});

describe('paintDisc', () => {
  test('paints a disc of the expected volume and erases it again', () => {
    const vol = volume(phantom());
    const mask = new Uint8Array(vol.voxels.length);
    const center = voxelToMm(vol, C);
    const added = paintDisc(mask, vol, center, [0, 0, 1], 5, 0.3, 1);
    // One z slice (0.6 mm thick > 2·0.3 mm), disc radius 5 mm at 0.5 mm pixels
    expect(Math.abs(added - Math.PI * 100) / (Math.PI * 100)).toBeLessThan(0.1);
    expect(paintDisc(mask, vol, center, [0, 0, 1], 5, 0.3, 0)).toBe(-added);
    expect(countMask(mask)).toBe(0);
  });
});

describe('sampleMaskOnSlice', () => {
  test('overlay area on an axial slice matches the chamber cross-section', () => {
    const vol = volume(phantom());
    const mask = regionGrow(vol.voxels, dims, C, { threshold: 90 });
    const slice = sampleObliquePlane(vol, 0, C, identityBasis(), 'axial', { width: 256, height: 256, zoom: 1 });
    const overlay = sampleMaskOnSlice(mask, vol, slice);
    const areaMm2 = countMask(overlay) * slice.pixelMm * slice.pixelMm;
    const expected = Math.PI * (R * 0.5) ** 2;
    expect(Math.abs(areaMm2 - expected) / expected).toBeLessThan(0.15);
    // Centre pixel of the slice is inside the chamber
    expect(overlay[Math.round(slice.crossV) * slice.width + Math.round(slice.crossU)]).toBe(1);
  });
});

describe('volume and field', () => {
  test('maskVolumeMl uses cm³ per voxel', () => {
    expect(maskVolumeMl(1000, { x: 0.1, y: 0.1, z: 0.1 })).toBeCloseTo(1, 9);
  });

  test('maskToField preserves the filled fraction', () => {
    const mask = regionGrow(phantom(), dims, C, { threshold: 90 });
    const field = maskToField(mask, dims, 24);
    const frac = field.reduce((s, v) => s + v, 0) / field.length;
    expect(Math.abs(frac - countMask(mask) / mask.length)).toBeLessThan(0.01);
  });
});
