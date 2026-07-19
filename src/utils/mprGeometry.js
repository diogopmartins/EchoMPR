/** Oblique MPR geometry helpers (mm-space basis + voxel sampling). */

export function identityBasis() {
  return {
    x: [1, 0, 0],
    y: [0, 1, 0],
    z: [0, 0, 1],
  };
}

export function vecLen(v) {
  return Math.hypot(v[0], v[1], v[2]);
}

export function normalize(v) {
  const L = vecLen(v) || 1;
  return [v[0] / L, v[1] / L, v[2] / L];
}

export function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

export function scale(v, s) {
  return [v[0] * s, v[1] * s, v[2] * s];
}

export function add(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function sub(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

/** Rodrigues rotation of vector `v` around unit axis `k` by `angle` radians. */
export function rotateAroundAxis(v, k, angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const t = 1 - c;
  const [x, y, z] = normalize(k);
  const R = [
    [t * x * x + c, t * x * y - s * z, t * x * z + s * y],
    [t * x * y + s * z, t * y * y + c, t * y * z - s * x],
    [t * x * z - s * y, t * y * z + s * x, t * z * z + c],
  ];
  return [
    R[0][0] * v[0] + R[0][1] * v[1] + R[0][2] * v[2],
    R[1][0] * v[0] + R[1][1] * v[1] + R[1][2] * v[2],
    R[2][0] * v[0] + R[2][1] * v[1] + R[2][2] * v[2],
  ];
}

/**
 * Rotate the two in-plane axes around `normalKey` ('x'|'y'|'z').
 * Keeps planes mutually orthogonal.
 */
export function rotateBasisInPlane(basis, normalKey, angleRad) {
  const normal = normalize(basis[normalKey]);
  const keys = ['x', 'y', 'z'].filter((k) => k !== normalKey);
  const a = normalize(rotateAroundAxis(basis[keys[0]], normal, angleRad));
  let b = normalize(cross(normal, a));
  if (dot(b, basis[keys[1]]) < 0) b = scale(b, -1);
  return {
    x: normalKey === 'x' ? normal : keys[0] === 'x' ? a : b,
    y: normalKey === 'y' ? normal : keys[0] === 'y' ? a : b,
    z: normalKey === 'z' ? normal : keys[0] === 'z' ? a : b,
  };
}

export function spacingMm(volume) {
  return {
    x: volume.spacingCm.x * 10,
    y: volume.spacingCm.y * 10,
    z: volume.spacingCm.z * 10,
  };
}

export function voxelToMm(volume, c) {
  const s = spacingMm(volume);
  return [c.x * s.x, c.y * s.y, c.z * s.z];
}

export function mmToVoxel(volume, m) {
  const s = spacingMm(volume);
  return {
    x: m[0] / s.x,
    y: m[1] / s.y,
    z: m[2] / s.z,
  };
}

export function clampCenter(volume, c) {
  return {
    x: Math.min(volume.dims.x - 1, Math.max(0, c.x)),
    y: Math.min(volume.dims.y - 1, Math.max(0, c.y)),
    z: Math.min(volume.dims.z - 1, Math.max(0, c.z)),
  };
}

function trilinear(vol, dims, x, y, z) {
  if (x < 0 || y < 0 || z < 0 || x > dims.x - 1 || y > dims.y - 1 || z > dims.z - 1) {
    return 0;
  }
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const z0 = Math.floor(z);
  const x1 = Math.min(x0 + 1, dims.x - 1);
  const y1 = Math.min(y0 + 1, dims.y - 1);
  const z1 = Math.min(z0 + 1, dims.z - 1);
  const fx = x - x0;
  const fy = y - y0;
  const fz = z - z0;

  const idx = (xi, yi, zi) => zi * dims.y * dims.x + yi * dims.x + xi;
  const c000 = vol[idx(x0, y0, z0)];
  const c100 = vol[idx(x1, y0, z0)];
  const c010 = vol[idx(x0, y1, z0)];
  const c110 = vol[idx(x1, y1, z0)];
  const c001 = vol[idx(x0, y0, z1)];
  const c101 = vol[idx(x1, y0, z1)];
  const c011 = vol[idx(x0, y1, z1)];
  const c111 = vol[idx(x1, y1, z1)];

  const c00 = c000 * (1 - fx) + c100 * fx;
  const c10 = c010 * (1 - fx) + c110 * fx;
  const c01 = c001 * (1 - fx) + c101 * fx;
  const c11 = c011 * (1 - fx) + c111 * fx;
  const c0 = c00 * (1 - fy) + c10 * fy;
  const c1 = c01 * (1 - fy) + c11 * fy;
  return c0 * (1 - fz) + c1 * fz;
}

/**
 * Build in-plane right/down axes with a stable world-up so reference lines can tilt.
 */
export function planeAxes(normal, worldUpHint = [0, 0, 1]) {
  let N = normalize(normal);
  let up = sub(worldUpHint, scale(N, dot(worldUpHint, N)));
  if (vecLen(up) < 1e-4) {
    const alt = Math.abs(N[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    up = sub(alt, scale(N, dot(alt, N)));
  }
  up = normalize(up);
  const right = normalize(cross(up, N));
  const down = normalize(cross(N, right));
  return { right, down, normal: N };
}

export function viewSpec(axis) {
  // normalKey = this view's plane normal in the triad
  // lineA/lineB = the other two planes (for reference line colors)
  if (axis === 'axial') {
    return {
      normalKey: 'z',
      lineA: { key: 'x', color: '#e53935' }, // sagittal
      lineB: { key: 'y', color: '#43a047' }, // coronal
      worldUp: [0, 1, 0],
    };
  }
  if (axis === 'coronal') {
    return {
      normalKey: 'y',
      lineA: { key: 'x', color: '#e53935' },
      lineB: { key: 'z', color: '#1e88e5' },
      worldUp: [0, 0, 1],
    };
  }
  return {
    normalKey: 'x',
    lineA: { key: 'y', color: '#43a047' },
    lineB: { key: 'z', color: '#1e88e5' },
    worldUp: [0, 0, 1],
  };
}

/** In-plane FOV (mm) for a view so we don't undersample vs native voxels. */
function viewFovMm(volume, axis) {
  const sp = spacingMm(volume);
  const { dims } = volume;
  if (axis === 'axial') {
    return { w: dims.x * sp.x, h: dims.y * sp.y };
  }
  if (axis === 'coronal') {
    return { w: dims.x * sp.x, h: dims.z * sp.z };
  }
  return { w: dims.y * sp.y, h: dims.z * sp.z };
}

export function isNearAxisAligned(basis, eps = 0.985) {
  return (
    Math.abs(basis.x[0]) > eps &&
    Math.abs(basis.y[1]) > eps &&
    Math.abs(basis.z[2]) > eps
  );
}

/**
 * Sample an oblique plane through center at a target pixel size.
 * options: { width, height, zoom } — matches pane aspect and fills the view.
 * Uses view-sized FOV (not full 3D diagonal) so voxels stay sharp like the cart.
 */
export function sampleObliquePlane(volume, t, center, basis, axis, options = {}) {
  const spec = viewSpec(axis);
  const normal = basis[spec.normalKey];
  const { right, down } = planeAxes(normal, spec.worldUp);
  const zoom = Math.max(0.25, Math.min(8, options.zoom || 1));

  const width = Math.max(64, Math.min(1280, Math.round(options.width || 512)));
  const height = Math.max(64, Math.min(1280, Math.round(options.height || 512)));

  // FOV matches this plane's physical size (+ small pad), anisotropic pixels
  const fov = viewFovMm(volume, axis);
  const pad = 1.06;
  const stepX = (fov.w * pad) / (width * zoom);
  const stepY = (fov.h * pad) / (height * zoom);

  const ti = Math.max(0, Math.min(volume.dims.t - 1, t | 0));
  const vol = volume.voxels.subarray(
    ti * volume.volumeSize,
    ti * volume.volumeSize + volume.volumeSize
  );

  const centerMm = voxelToMm(volume, center);
  const data = new Uint8Array(width * height);
  const cx = (width - 1) / 2;
  const cy = (height - 1) / 2;

  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) {
      const mm = add(
        add(centerMm, scale(right, (i - cx) * stepX)),
        scale(down, (j - cy) * stepY)
      );
      const vox = mmToVoxel(volume, mm);
      data[j * width + i] = trilinear(
        vol,
        volume.dims,
        vox.x,
        vox.y,
        vox.z
      );
    }
  }

  const toImageDir = (planeNormal) => {
    let dir = cross(planeNormal, normal);
    if (vecLen(dir) < 1e-6) return { u: 1, v: 0 };
    dir = normalize(dir);
    // Account for anisotropic display scaling
    return { u: dot(dir, right) / stepX, v: dot(dir, down) / stepY };
  };

  const dirA = toImageDir(basis[spec.lineA.key]);
  const dirB = toImageDir(basis[spec.lineB.key]);

  return {
    data,
    width,
    height,
    axis,
    center,
    pixelMm: (stepX + stepY) * 0.5,
    zoom,
    dirs: {
      a: { ...dirA, color: spec.lineA.color, planeKey: spec.lineA.key },
      b: { ...dirB, color: spec.lineB.color, planeKey: spec.lineB.key },
    },
    normalKey: spec.normalKey,
  };
}

/** Move center along the view normal by `deltaVoxels` (approx). */
export function nudgeCenterAlongNormal(volume, center, basis, normalKey, delta) {
  const n = basis[normalKey];
  const sp = spacingMm(volume);
  const mm = voxelToMm(volume, center);
  const stepMm = delta * Math.min(sp.x, sp.y, sp.z);
  return clampCenter(volume, mmToVoxel(volume, add(mm, scale(n, stepMm))));
}

/** Translate center in the view plane from image delta (pixels). */
export function translateCenterInPlane(
  volume,
  center,
  basis,
  axis,
  dImgU,
  dImgV
) {
  const spec = viewSpec(axis);
  const { right, down } = planeAxes(basis[spec.normalKey], spec.worldUp);
  const sp = spacingMm(volume);
  const pixelMm = Math.min(sp.x, sp.y, sp.z);
  const mm = voxelToMm(volume, center);
  const next = add(add(mm, scale(right, dImgU * pixelMm)), scale(down, dImgV * pixelMm));
  return clampCenter(volume, mmToVoxel(volume, next));
}

/**
 * Move a specific MPR plane by dragging its reference line.
 * `dirU/dirV` = line direction in image space; drag delta projected onto the
 * perpendicular moves the center along that plane's normal.
 */
export function movePlaneByLineDrag(
  volume,
  center,
  basis,
  axis,
  planeKey,
  dirU,
  dirV,
  dImgU,
  dImgV
) {
  const spec = viewSpec(axis);
  const { right, down } = planeAxes(basis[spec.normalKey], spec.worldUp);
  const sp = spacingMm(volume);
  const pixelMm = Math.min(sp.x, sp.y, sp.z);

  const len = Math.hypot(dirU, dirV) || 1;
  const lu = dirU / len;
  const lv = dirV / len;
  // Perpendicular in image space
  const pu = -lv;
  const pv = lu;
  const dragAlongPerp = dImgU * pu + dImgV * pv;

  // Map image perpendicular back to 3D to get signed step along plane normal
  const perp3 = add(scale(right, pu), scale(down, pv));
  const planeN = basis[planeKey];
  const sign = Math.sign(dot(perp3, planeN)) || 1;

  const mm = voxelToMm(volume, center);
  const next = add(mm, scale(planeN, sign * dragAlongPerp * pixelMm));
  return clampCenter(volume, mmToVoxel(volume, next));
}
