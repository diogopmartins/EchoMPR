/**
 * Pre- and post-processing for ONNX segmentation models (e.g. mitral leaflets
 * trained on MVSeg2023 with scripts/train_mvseg.py).
 *
 * Model contract:
 * - input  float32 [1, 1, D, H, W]: an isotropic cube of `roi` voxels per side
 *   at `spacingMm`, centred on the chosen point, axes (z, y, x) of the
 *   volume, intensities scaled to [0, 1];
 * - output float32 [1, C, D, H, W]: per-class scores; label = argmax over C,
 *   0 = background.
 */
import { mmToVoxel, spacingMm as volSpacingMm, voxelToMm } from './mprGeometry';
import { getVolumeAtTime } from './philipsVolume';
import type { Vec3, Volume } from './types';

type SampleVolume = Pick<Volume, 'dims' | 'spacingCm' | 'voxels' | 'volumeSize'>;

export interface RoiSpec {
  /** Voxels per side of the cubic model input. */
  roi: number;
  /** Isotropic spacing of the model input, in mm. */
  spacingMm: number;
  /** Centre of the cube in volume-local mm. */
  centerMm: Vec3;
}

export const DEFAULT_AI_SPEC = { roi: 128, spacingMm: 0.6 };
// MVSeg2023 label values: 1 = posterior leaflet, 2 = anterior leaflet.
export const DEFAULT_AI_LABELS = ['Posterior leaflet', 'Anterior leaflet'];
export const AI_LABEL_COLORS = ['#ff7043', '#42a5f5', '#9ccc65', '#ffca28', '#ab47bc'];

/** Volume-local mm of ROI voxel (i, j, k) = (x, y, z) index in the cube. */
function roiToMm(spec: RoiSpec, i: number, j: number, k: number): Vec3 {
  const half = (spec.roi - 1) / 2;
  return [
    spec.centerMm[0] + (i - half) * spec.spacingMm,
    spec.centerMm[1] + (j - half) * spec.spacingMm,
    spec.centerMm[2] + (k - half) * spec.spacingMm,
  ];
}

/** Trilinear resample of one timepoint into the model's input cube, scaled to [0, 1]. */
export function resampleRoi(volume: SampleVolume, t: number, spec: RoiSpec): Float32Array {
  const { dims } = volume;
  const vol = getVolumeAtTime(volume as Volume, t);
  const n = spec.roi;
  const out = new Float32Array(n * n * n);
  const at = (x: number, y: number, z: number) => vol[(z * dims.y + y) * dims.x + x];
  let o = 0;
  for (let k = 0; k < n; k++) {
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++, o++) {
        const v = mmToVoxel(volume, roiToMm(spec, i, j, k));
        if (v.x < 0 || v.y < 0 || v.z < 0 || v.x > dims.x - 1 || v.y > dims.y - 1 || v.z > dims.z - 1) {
          continue;
        }
        const x0 = Math.floor(v.x);
        const y0 = Math.floor(v.y);
        const z0 = Math.floor(v.z);
        const x1 = Math.min(x0 + 1, dims.x - 1);
        const y1 = Math.min(y0 + 1, dims.y - 1);
        const z1 = Math.min(z0 + 1, dims.z - 1);
        const fx = v.x - x0;
        const fy = v.y - y0;
        const fz = v.z - z0;
        const c00 = at(x0, y0, z0) * (1 - fx) + at(x1, y0, z0) * fx;
        const c10 = at(x0, y1, z0) * (1 - fx) + at(x1, y1, z0) * fx;
        const c01 = at(x0, y0, z1) * (1 - fx) + at(x1, y0, z1) * fx;
        const c11 = at(x0, y1, z1) * (1 - fx) + at(x1, y1, z1) * fx;
        const c0 = c00 * (1 - fy) + c10 * fy;
        const c1 = c01 * (1 - fy) + c11 * fy;
        out[o] = (c0 * (1 - fz) + c1 * fz) / 255;
      }
    }
  }
  return out;
}

/** Argmax over the class axis of a [1, C, N] (flattened) score tensor. */
export function argmaxLabels(scores: Float32Array, classes: number): Uint8Array {
  const n = scores.length / classes;
  if (!Number.isInteger(n)) throw new Error(`Output size ${scores.length} is not divisible by ${classes} classes`);
  const labels = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    let best = 0;
    let bestV = scores[i];
    for (let c = 1; c < classes; c++) {
      const v = scores[c * n + i];
      if (v > bestV) {
        bestV = v;
        best = c;
      }
    }
    labels[i] = best;
  }
  return labels;
}

/**
 * Map an ROI label cube back onto the volume grid (nearest neighbour).
 * Returns one binary mask per foreground class (labels 1 … classes-1).
 */
export function roiLabelsToMasks(
  labels: Uint8Array,
  classes: number,
  volume: Pick<Volume, 'dims' | 'spacingCm' | 'volumeSize'>,
  spec: RoiSpec
): Uint8Array[] {
  const { dims } = volume;
  const n = spec.roi;
  const masks = Array.from({ length: classes - 1 }, () => new Uint8Array(volume.volumeSize));
  const half = (n - 1) / 2;
  const sp = volSpacingMm(volume);
  const halfExtent = (half + 0.5) * spec.spacingMm;
  const c = mmToVoxel(volume, spec.centerMm);
  const lo = (v: number, s: number) => Math.max(0, Math.floor(v - halfExtent / s));
  const hi = (v: number, s: number, len: number) => Math.min(len - 1, Math.ceil(v + halfExtent / s));
  for (let z = lo(c.z, sp.z); z <= hi(c.z, sp.z, dims.z); z++)
    for (let y = lo(c.y, sp.y); y <= hi(c.y, sp.y, dims.y); y++)
      for (let x = lo(c.x, sp.x); x <= hi(c.x, sp.x, dims.x); x++) {
        const mm = voxelToMm(volume, { x, y, z });
        const i = Math.round((mm[0] - spec.centerMm[0]) / spec.spacingMm + half);
        const j = Math.round((mm[1] - spec.centerMm[1]) / spec.spacingMm + half);
        const k = Math.round((mm[2] - spec.centerMm[2]) / spec.spacingMm + half);
        if (i < 0 || j < 0 || k < 0 || i >= n || j >= n || k >= n) continue;
        const label = labels[(k * n + j) * n + i];
        if (label > 0 && label < classes) masks[label - 1][(z * dims.y + y) * dims.x + x] = 1;
      }
  return masks;
}

/** Cube side from a static [1, 1, D, H, W] input shape, or null if not fixed/cubic. */
export function roiFromInputShape(shape: ReadonlyArray<number | string> | undefined): number | null {
  if (!shape || shape.length !== 5) return null;
  const [d, h, w] = shape.slice(2);
  if (typeof d !== 'number' || d !== h || h !== w || d <= 0) return null;
  return d;
}
