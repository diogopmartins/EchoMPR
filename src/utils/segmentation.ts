/**
 * Voxel segmentation helpers: smoothing, seeded region growing with a leak
 * cut, brush editing, and resampling masks for display.
 *
 * Masks are Uint8Array with one byte per voxel of a single timepoint, in the
 * same (Z, Y, X) order as the volume; non-zero means "inside".
 */
import { add, dot, mmToVoxel, scale, spacingMm, sub, voxelToMm } from './mprGeometry';
import type { SampledSlice, Vec3, Volume, VolumeDims, VoxelCoord } from './types';

type Dims3 = Pick<VolumeDims, 'x' | 'y' | 'z'>;
type VolumeGeom = Pick<Volume, 'dims' | 'spacingCm'>;

export const idx3 = (dims: Dims3, x: number, y: number, z: number) =>
  (z * dims.y + y) * dims.x + x;

/** Separable box blur of radius r (window 2r+1) with clamped edges. */
export function boxBlur(src: Uint8Array, dims: Dims3, r = 1): Uint8Array {
  if (r <= 0) return src.slice();
  const { x: nx, y: ny, z: nz } = dims;
  let a = new Float32Array(src);
  let b = new Float32Array(src.length);
  const pass = (len: number, stride: number, lines: number[]) => {
    const w = 2 * r + 1;
    for (const start of lines) {
      let acc = 0;
      for (let k = -r; k <= r; k++) acc += a[start + Math.min(len - 1, Math.max(0, k)) * stride];
      for (let i = 0; i < len; i++) {
        b[start + i * stride] = acc / w;
        const out = Math.max(0, i - r);
        const inn = Math.min(len - 1, i + r + 1);
        acc += a[start + inn * stride] - a[start + out * stride];
      }
    }
    [a, b] = [b, a];
  };
  const linesX: number[] = [];
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) linesX.push(idx3(dims, 0, y, z));
  pass(nx, 1, linesX);
  const linesY: number[] = [];
  for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) linesY.push(idx3(dims, x, 0, z));
  pass(ny, nx, linesY);
  const linesZ: number[] = [];
  for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) linesZ.push(idx3(dims, x, y, 0));
  pass(nz, nx * ny, linesZ);
  const out = new Uint8Array(src.length);
  for (let i = 0; i < out.length; i++) out[i] = Math.round(a[i]);
  return out;
}

export function roundVoxel(v: VoxelCoord, dims: Dims3): VoxelCoord {
  return {
    x: Math.max(0, Math.min(dims.x - 1, Math.round(v.x))),
    y: Math.max(0, Math.min(dims.y - 1, Math.round(v.y))),
    z: Math.max(0, Math.min(dims.z - 1, Math.round(v.z))),
  };
}

/**
 * Suggest an upper intensity threshold for growing a dark blood pool from
 * `seed`: halfway between the local blood level and the surrounding wall.
 * The wall level is the median, over 26 rays cast from the seed, of the
 * brightest voxel met within `reach` voxels.
 */
export function autoThreshold(
  smoothed: Uint8Array,
  dims: Dims3,
  seed: VoxelCoord,
  reach = 40
): number {
  const s = roundVoxel(seed, dims);
  const at = (x: number, y: number, z: number) =>
    x < 0 || y < 0 || z < 0 || x >= dims.x || y >= dims.y || z >= dims.z
      ? -1
      : smoothed[idx3(dims, x, y, z)];
  let sum = 0;
  let n = 0;
  for (let dz = -1; dz <= 1; dz++)
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const v = at(s.x + dx, s.y + dy, s.z + dz);
        if (v >= 0) {
          sum += v;
          n++;
        }
      }
  const blood = sum / Math.max(1, n);
  const peaks: number[] = [];
  for (let dz = -1; dz <= 1; dz++)
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy && !dz) continue;
        let peak = -1;
        for (let k = 1; k <= reach; k++) {
          const v = at(s.x + dx * k, s.y + dy * k, s.z + dz * k);
          if (v < 0) break;
          if (v > peak) peak = v;
        }
        if (peak >= 0) peaks.push(peak);
      }
  peaks.sort((a, b) => a - b);
  const wall = peaks.length ? peaks[Math.floor(peaks.length / 2)] : 255;
  const t = Math.round(blood + 0.5 * Math.max(0, wall - blood));
  return Math.max(Math.round(blood) + 4, Math.min(250, t));
}

const NEIGHBORS = (dims: Dims3) => [1, -1, dims.x, -dims.x, dims.x * dims.y, -dims.x * dims.y];

/** 6-connected flood fill from `start` over voxels where `inside(i)` holds. */
function flood(dims: Dims3, start: number, inside: (i: number) => boolean): Uint8Array {
  const n = dims.x * dims.y * dims.z;
  const mask = new Uint8Array(n);
  if (!inside(start)) return mask;
  const queue = new Int32Array(n);
  let head = 0;
  let tail = 0;
  queue[tail++] = start;
  mask[start] = 1;
  const plane = dims.x * dims.y;
  while (head < tail) {
    const i = queue[head++];
    const x = i % dims.x;
    const y = Math.floor(i / dims.x) % dims.y;
    const z = Math.floor(i / plane);
    const cand = [
      x + 1 < dims.x ? i + 1 : -1,
      x > 0 ? i - 1 : -1,
      y + 1 < dims.y ? i + dims.x : -1,
      y > 0 ? i - dims.x : -1,
      z + 1 < dims.z ? i + plane : -1,
      z > 0 ? i - plane : -1,
    ];
    for (const j of cand) {
      if (j < 0 || mask[j] || !inside(j)) continue;
      mask[j] = 1;
      queue[tail++] = j;
    }
  }
  return mask;
}

/** Morphological erosion (6-neighbourhood), `iterations` times. */
export function erode(mask: Uint8Array, dims: Dims3, iterations = 1): Uint8Array {
  let cur = mask;
  const plane = dims.x * dims.y;
  for (let it = 0; it < iterations; it++) {
    const next = new Uint8Array(cur.length);
    for (let z = 0; z < dims.z; z++)
      for (let y = 0; y < dims.y; y++)
        for (let x = 0; x < dims.x; x++) {
          const i = idx3(dims, x, y, z);
          if (!cur[i]) continue;
          if (x === 0 || y === 0 || z === 0 || x === dims.x - 1 || y === dims.y - 1 || z === dims.z - 1)
            continue;
          if (cur[i + 1] && cur[i - 1] && cur[i + dims.x] && cur[i - dims.x] && cur[i + plane] && cur[i - plane])
            next[i] = 1;
        }
    cur = next;
  }
  return cur;
}

/** Morphological dilation (6-neighbourhood), optionally limited to `within`. */
export function dilate(
  mask: Uint8Array,
  dims: Dims3,
  iterations = 1,
  within?: Uint8Array
): Uint8Array {
  let cur = mask;
  const offsets = NEIGHBORS(dims);
  const plane = dims.x * dims.y;
  for (let it = 0; it < iterations; it++) {
    const next = cur.slice();
    for (let i = 0; i < cur.length; i++) {
      if (!cur[i]) continue;
      const x = i % dims.x;
      const y = Math.floor(i / dims.x) % dims.y;
      const z = Math.floor(i / plane);
      const ok = [x + 1 < dims.x, x > 0, y + 1 < dims.y, y > 0, z + 1 < dims.z, z > 0];
      for (let k = 0; k < 6; k++) {
        if (!ok[k]) continue;
        const j = i + offsets[k];
        if (!within || within[j]) next[j] = 1;
      }
    }
    cur = next;
  }
  return cur;
}

/** Nearest voxel to `seed` (within `radius`) where `inside` holds, or -1. */
function nearestInside(
  dims: Dims3,
  seed: VoxelCoord,
  radius: number,
  inside: (i: number) => boolean
): number {
  const s = roundVoxel(seed, dims);
  let best = -1;
  let bestD = Infinity;
  for (let dz = -radius; dz <= radius; dz++)
    for (let dy = -radius; dy <= radius; dy++)
      for (let dx = -radius; dx <= radius; dx++) {
        const x = s.x + dx;
        const y = s.y + dy;
        const z = s.z + dz;
        if (x < 0 || y < 0 || z < 0 || x >= dims.x || y >= dims.y || z >= dims.z) continue;
        const d = dx * dx + dy * dy + dz * dz;
        const i = idx3(dims, x, y, z);
        if (d < bestD && inside(i)) {
          bestD = d;
          best = i;
        }
      }
  return best;
}

export interface GrowOptions {
  /** Voxels with smoothed intensity ≤ threshold are grown into. */
  threshold: number;
  /** Erode-then-reconstruct iterations that cut thin leaks (0 = off). */
  leakCut?: number;
  /** Ellipsoidal limit around the seed, in voxels per axis. */
  maxRadius?: VoxelCoord;
}

/**
 * Grow a dark region (e.g. a blood pool) from `seed` over `smoothed` voxels.
 * With `leakCut` > 0 the grown mask is eroded, the component holding the
 * seed kept, and then dilated back inside the original mask, which removes
 * bridges thinner than about 2·leakCut voxels.
 */
export function regionGrow(
  smoothed: Uint8Array,
  dims: Dims3,
  seed: VoxelCoord,
  { threshold, leakCut = 0, maxRadius }: GrowOptions
): Uint8Array {
  const s = roundVoxel(seed, dims);
  const plane = dims.x * dims.y;
  const inRadius = (i: number) => {
    if (!maxRadius) return true;
    const x = i % dims.x;
    const y = Math.floor(i / dims.x) % dims.y;
    const z = Math.floor(i / plane);
    return (
      ((x - s.x) / maxRadius.x) ** 2 + ((y - s.y) / maxRadius.y) ** 2 + ((z - s.z) / maxRadius.z) ** 2 <=
      1
    );
  };
  const inside = (i: number) => smoothed[i] <= threshold && inRadius(i);
  const start = nearestInside(dims, s, 3, inside);
  if (start < 0) return new Uint8Array(smoothed.length);
  const grown = flood(dims, start, inside);
  if (!leakCut) return grown;

  const core = erode(grown, dims, leakCut);
  const coreStart = nearestInside(dims, s, leakCut + 3, (i) => core[i] === 1);
  if (coreStart < 0) return grown;
  const kept = flood(dims, coreStart, (i) => core[i] === 1);
  return dilate(kept, dims, leakCut, grown);
}

export function countMask(mask: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i]) n++;
  return n;
}

/** Voxel count → millilitres (spacing is in cm, so voxel volume is in cm³ = mL). */
export function maskVolumeMl(count: number, spacingCm: VoxelCoord): number {
  return count * spacingCm.x * spacingCm.y * spacingCm.z;
}

/**
 * Paint (value 1) or erase (value 0) a disc of `radiusMm` lying in the plane
 * through `centerMm` with `normal`, `halfThicknessMm` thick on each side.
 * Returns the change in inside-voxel count.
 */
export function paintDisc(
  mask: Uint8Array,
  volume: VolumeGeom,
  centerMm: Vec3,
  normal: Vec3,
  radiusMm: number,
  halfThicknessMm: number,
  value: 0 | 1
): number {
  const { dims } = volume;
  const sp = spacingMm(volume);
  const c = mmToVoxel(volume, centerMm);
  const reach = Math.max(radiusMm, halfThicknessMm);
  const lo = (v: number, s: number) => Math.max(0, Math.floor(v - reach / s));
  const hi = (v: number, s: number, n: number) => Math.min(n - 1, Math.ceil(v + reach / s));
  let delta = 0;
  for (let z = lo(c.z, sp.z); z <= hi(c.z, sp.z, dims.z); z++)
    for (let y = lo(c.y, sp.y); y <= hi(c.y, sp.y, dims.y); y++)
      for (let x = lo(c.x, sp.x); x <= hi(c.x, sp.x, dims.x); x++) {
        const d = sub(voxelToMm(volume, { x, y, z }), centerMm);
        const along = dot(d, normal);
        if (Math.abs(along) > halfThicknessMm) continue;
        const inPlane = sub(d, scale(normal, along));
        if (dot(inPlane, inPlane) > radiusMm * radiusMm) continue;
        const i = idx3(dims, x, y, z);
        if (mask[i] !== value) {
          delta += value ? 1 : -1;
          mask[i] = value;
        }
      }
  return delta;
}

/**
 * Nearest-neighbour sample of a mask on the same grid as a displayed slice,
 * so it can be drawn over the pane pixel for pixel.
 */
export function sampleMaskOnSlice(
  mask: Uint8Array,
  volume: VolumeGeom,
  slice: Pick<SampledSlice, 'width' | 'height' | 'viewOrigin' | 'right' | 'down' | 'stepX' | 'stepY'>
): Uint8Array {
  const { dims } = volume;
  const { width, height, right, down, stepX, stepY } = slice;
  const out = new Uint8Array(width * height);
  const origin = voxelToMm(volume, slice.viewOrigin);
  const cx = (width - 1) / 2;
  const cy = (height - 1) / 2;
  const sp = spacingMm(volume);
  // Voxel-space increments per pixel step, so the inner loop is additions only.
  const du = { x: (right[0] * stepX) / sp.x, y: (right[1] * stepX) / sp.y, z: (right[2] * stepX) / sp.z };
  const dv = { x: (down[0] * stepY) / sp.x, y: (down[1] * stepY) / sp.y, z: (down[2] * stepY) / sp.z };
  const base = mmToVoxel(volume, add(add(origin, scale(right, -cx * stepX)), scale(down, -cy * stepY)));
  for (let j = 0; j < height; j++) {
    let vx = base.x + dv.x * j;
    let vy = base.y + dv.y * j;
    let vz = base.z + dv.z * j;
    for (let i = 0; i < width; i++) {
      const x = Math.round(vx);
      const y = Math.round(vy);
      const z = Math.round(vz);
      if (x >= 0 && y >= 0 && z >= 0 && x < dims.x && y < dims.y && z < dims.z) {
        out[j * width + i] = mask[(z * dims.y + y) * dims.x + x];
      }
      vx += du.x;
      vy += du.y;
      vz += du.z;
    }
  }
  return out;
}

/**
 * Average a mask into a cubic `res`³ grid spanning the volume box (cell
 * centres at (i + 0.5) / res), for iso-surfacing in the 3D view.
 */
export function maskToField(mask: Uint8Array, dims: Dims3, res: number): Float32Array {
  const field = new Float32Array(res * res * res);
  const counts = new Float32Array(res * res * res);
  const fx = res / dims.x;
  const fy = res / dims.y;
  const fz = res / dims.z;
  for (let z = 0; z < dims.z; z++) {
    const gz = Math.min(res - 1, Math.floor((z + 0.5) * fz));
    for (let y = 0; y < dims.y; y++) {
      const gy = Math.min(res - 1, Math.floor((y + 0.5) * fy));
      const row = (z * dims.y + y) * dims.x;
      const grow = (gz * res + gy) * res;
      for (let x = 0; x < dims.x; x++) {
        const g = grow + Math.min(res - 1, Math.floor((x + 0.5) * fx));
        counts[g] += 1;
        if (mask[row + x]) field[g] += 1;
      }
    }
  }
  for (let i = 0; i < field.length; i++) {
    if (counts[i] > 0) {
      field[i] /= counts[i];
    } else {
      // Grid finer than the volume along an axis: copy the nearest voxel.
      const gx = i % res;
      const gy = Math.floor(i / res) % res;
      const gz = Math.floor(i / (res * res));
      const x = Math.min(dims.x - 1, Math.floor(((gx + 0.5) / res) * dims.x));
      const y = Math.min(dims.y - 1, Math.floor(((gy + 0.5) / res) * dims.y));
      const z = Math.min(dims.z - 1, Math.floor(((gz + 0.5) / res) * dims.z));
      field[i] = mask[idx3(dims, x, y, z)] ? 1 : 0;
    }
  }
  return field;
}
