import { mmToVoxel, voxelToMm } from './mprGeometry';

const PATCH = 2;
const patchOffsets = [];
for (let z = -PATCH; z <= PATCH; z += 1) {
  for (let y = -PATCH; y <= PATCH; y += 1) {
    for (let x = -PATCH; x <= PATCH; x += 1) {
      patchOffsets.push(x, y, z);
    }
  }
}
const PATCH_N = patchOffsets.length / 3;
const COARSE = [-3, -1, 0, 1, 3];

function mod(value, count) {
  return ((value % count) + count) % count;
}

function clamp(value, lo, hi) {
  return Math.max(lo, Math.min(hi, value));
}

function readPatch(out, voxels, base, dims, x, y, z) {
  const strideY = dims.x;
  const strideZ = dims.y * dims.x;
  const x0 = Math.round(x);
  const y0 = Math.round(y);
  const z0 = Math.round(z);
  let mean = 0;
  for (let i = 0; i < PATCH_N; i += 1) {
    const xi = x0 + patchOffsets[i * 3];
    const yi = y0 + patchOffsets[i * 3 + 1];
    const zi = z0 + patchOffsets[i * 3 + 2];
    let value = 0;
    if (xi >= 0 && yi >= 0 && zi >= 0 && xi < dims.x && yi < dims.y && zi < dims.z) {
      value = voxels[base + zi * strideZ + yi * strideY + xi];
    }
    out[i] = value;
    mean += value;
  }
  mean /= PATCH_N;
  let energy = 0;
  for (let i = 0; i < PATCH_N; i += 1) {
    out[i] -= mean;
    energy += out[i] * out[i];
  }
  return energy;
}

function correlation(ref, refEnergy, sample, sampleEnergy) {
  if (refEnergy < 1 || sampleEnergy < 1) return -1;
  let dot = 0;
  for (let i = 0; i < PATCH_N; i += 1) dot += ref[i] * sample[i];
  return dot / Math.sqrt(refEnergy * sampleEnergy);
}

function trackStep(voxels, dims, volumeSize, fromT, toT, from, guess, ref, sample, seedRef) {
  const refEnergy = readPatch(ref, voxels, fromT * volumeSize, dims, from.x, from.y, from.z);
  if (refEnergy < 1) return { x: from.x, y: from.y, z: from.z, matched: false };
  const toBase = toT * volumeSize;
  let bestScore = 0.3;
  let best = { x: from.x, y: from.y, z: from.z };
  let matched = false;
  const consider = (x, y, z) => {
    const energy = readPatch(sample, voxels, toBase, dims, x, y, z);
    let ncc = correlation(ref, refEnergy, sample, energy);
    if (ncc < 0) return;
    if (seedRef) {
      const nccSeed = correlation(seedRef.samples, seedRef.energy, sample, energy);
      if (nccSeed > 0) ncc = ncc * 0.82 + nccSeed * 0.18;
    }
    const dx = x - guess.x;
    const dy = y - guess.y;
    const dz = z - guess.z;
    const score = ncc - 0.012 * (dx * dx + dy * dy + dz * dz);
    if (score > bestScore) {
      bestScore = score;
      best = { x, y, z };
      matched = true;
    }
  };
  const sx = Math.round(guess.x);
  const sy = Math.round(guess.y);
  const sz = Math.round(guess.z);
  for (let iz = 0; iz < COARSE.length; iz += 1) {
    for (let iy = 0; iy < COARSE.length; iy += 1) {
      for (let ix = 0; ix < COARSE.length; ix += 1) {
        consider(sx + COARSE[ix], sy + COARSE[iy], sz + COARSE[iz]);
      }
    }
  }
  const fx = Math.round(best.x);
  const fy = Math.round(best.y);
  const fz = Math.round(best.z);
  for (let dz = -1; dz <= 1; dz += 1) {
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        consider(fx + dx, fy + dy, fz + dz);
      }
    }
  }
  return { ...best, matched };
}

function trackWrapped(volume, start, seed, dir) {
  const { dims, voxels, volumeSize } = volume;
  const count = dims.t;
  const path = new Array(count);
  path[start] = { x: seed.x, y: seed.y, z: seed.z };
  const ref = new Float32Array(PATCH_N);
  const sample = new Float32Array(PATCH_N);
  const seedSamples = new Float32Array(PATCH_N);
  const seedEnergy = readPatch(seedSamples, voxels, start * volumeSize, dims, seed.x, seed.y, seed.z);
  const seedRef = seedEnergy > 1 ? { samples: seedSamples, energy: seedEnergy } : null;
  let pos = { x: seed.x, y: seed.y, z: seed.z };
  let vx = 0;
  let vy = 0;
  let vz = 0;
  for (let step = 1; step < count; step += 1) {
    const fromT = mod(start + dir * (step - 1), count);
    const toT = mod(start + dir * step, count);
    const next = trackStep(
      voxels,
      dims,
      volumeSize,
      fromT,
      toT,
      pos,
      { x: pos.x + vx, y: pos.y + vy, z: pos.z + vz },
      ref,
      sample,
      seedRef
    );
    if (next.matched) {
      vx = clamp(next.x - pos.x, -3, 3);
      vy = clamp(next.y - pos.y, -3, 3);
      vz = clamp(next.z - pos.z, -3, 3);
      pos = { x: next.x, y: next.y, z: next.z };
    } else {
      vx = 0;
      vy = 0;
      vz = 0;
    }
    path[toT] = { x: pos.x, y: pos.y, z: pos.z };
  }
  return path;
}

function blendPaths(forward, backward, start, count) {
  const out = new Array(count);
  for (let t = 0; t < count; t += 1) {
    if (t === start) {
      out[t] = { ...forward[t] };
      continue;
    }
    const forwardSteps = mod(t - start, count);
    const backwardSteps = mod(start - t, count);
    const weight = forwardSteps + backwardSteps;
    const gone = forward[t];
    const back = backward[t];
    out[t] = {
      x: (gone.x * backwardSteps + back.x * forwardSteps) / weight,
      y: (gone.y * backwardSteps + back.y * forwardSteps) / weight,
      z: (gone.z * backwardSteps + back.z * forwardSteps) / weight,
    };
  }
  return out;
}

function dist3(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function norm3(v) {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}

function smoothCyclic(vectors, radius) {
  const count = vectors.length;
  const out = new Array(count);
  for (let i = 0; i < count; i += 1) {
    const acc = [0, 0, 0];
    let weight = 0;
    for (let k = -radius; k <= radius; k += 1) {
      const w = radius + 1 - Math.abs(k);
      const sample = vectors[mod(i + k, count)];
      acc[0] += sample[0] * w;
      acc[1] += sample[1] * w;
      acc[2] += sample[2] * w;
      weight += w;
    }
    out[i] = [acc[0] / weight, acc[1] / weight, acc[2] / weight];
  }
  return out;
}

/**
 * Follow both clicked points through every frame.
 * Forward and backward tracks are blended so the cine loops,
 * then the pair is rebuilt at the original separation so the valve stays rigid.
 */
export function trackValvePoints(volume, timeIndex, pointA, pointB) {
  const count = volume.dims.t;
  if (count < 2) {
    return [{ t: 0, a: pointA.slice(), b: pointB.slice() }];
  }
  const seeds = [mmToVoxel(volume, pointA), mmToVoxel(volume, pointB)];
  const tracked = seeds.map((seed) => {
    const forward = trackWrapped(volume, timeIndex, seed, 1);
    const backward = trackWrapped(volume, timeIndex, seed, -1);
    return blendPaths(forward, backward, timeIndex, count).map((voxel) => voxelToMm(volume, voxel));
  });
  const length = dist3(pointA, pointB);
  const seedDir = norm3([
    pointB[0] - pointA[0],
    pointB[1] - pointA[1],
    pointB[2] - pointA[2],
  ]);
  const centers = [];
  const dirs = [];
  for (let t = 0; t < count; t += 1) {
    const a = tracked[0][t];
    const b = tracked[1][t];
    centers.push([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]);
    let dir = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    if (dir[0] * seedDir[0] + dir[1] * seedDir[1] + dir[2] * seedDir[2] < 0) {
      dir = [-dir[0], -dir[1], -dir[2]];
    }
    dirs.push(norm3(dir));
  }
  const smoothCenters = smoothCyclic(centers, 2);
  const smoothDirs = smoothCyclic(dirs, 2).map((dir) => norm3(dir));
  const half = length / 2;
  const keys = [];
  for (let t = 0; t < count; t += 1) {
    const center = t === timeIndex
      ? [(pointA[0] + pointB[0]) / 2, (pointA[1] + pointB[1]) / 2, (pointA[2] + pointB[2]) / 2]
      : smoothCenters[t];
    const dir = t === timeIndex ? seedDir : smoothDirs[t];
    keys.push({
      t,
      a: [
        center[0] - dir[0] * half,
        center[1] - dir[1] * half,
        center[2] - dir[2] * half,
      ],
      b: [
        center[0] + dir[0] * half,
        center[1] + dir[1] * half,
        center[2] + dir[2] * half,
      ],
    });
  }
  keys[timeIndex] = { t: timeIndex, a: pointA.slice(), b: pointB.slice() };
  return keys;
}
